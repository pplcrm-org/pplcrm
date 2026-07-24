import type {
  CreateClickersListResultType,
  ExportCsvInputType,
  ExportCsvResponseType,
  IAuthKeyPayload,
  MarketingEmailTopLinkType,
  NewsletterReportBounceType,
  NewsletterReportEngagedType,
  NewsletterReportLinkType,
  NewsletterReportType,
  PreflightResult,
  RunPreflightType,
} from '../../../../../../libs/common/src';
import type { Models, OperationDataType } from '../../../../../../libs/common/src/lib/kysely.models';
import type { Transaction } from 'kysely';
import { TRPCError } from '@trpc/server';
import { sql } from 'kysely';

import { env } from '../../../env';
import { BaseController } from '../../lib/base.controller';
import { CampaignsRepo } from '../campaigns/repositories/campaigns.repo';
import { ListsController } from '../lists/controller';
import { NewslettersRepo } from './repositories/newsletters.repo';
import { BadRequestError, ConflictError, NotFoundError } from '../../errors/app-errors';
import { assertNotDemoMode } from '../demo/demo-guard';
import {
  assertTenantMaySendNewsletter,
  assertTenantSendingNotBlocked,
  loadSendingTenant,
  monthlyEmailCap,
  sendWindow,
  sentEmailsSince,
} from './send-guards';
import { checkRateLimit } from '../../lib/rate-limiter';
import { NewsletterEmailService } from '../../lib/mail/newsletter-mail.service';
import {
  extractMergeTokens,
  htmlToPlainText,
  renderNewsletterHtml,
  resolveMergeSubstitutions,
} from '../../lib/mail/newsletter-render';
import { newsletterPreflight } from './preflight.service';

const DEFAULT_FROM_NAME = 'pplCRM Team';
// Fallback sender for TEST/preview sends only (sendTestEmail), which are allowed before a tenant has
// verified a sending domain so they can preview to themselves. Real broadcasts never use this — they
// require the tenant's own verified-domain From address (see send-guards assertTenantMaySendNewsletter).
const DEFAULT_FROM_EMAIL = 'hello@pplcrm.com';

export interface SendTestEmailInput {
  subject: string;
  html: string;
  text?: string;
  to: string;
  fromName?: string;
  fromEmail?: string;
}

/** What the composer's Review step shows before send. `cap: null` = unlimited (enterprise). */
export interface SendQuota {
  cap: number | null;
  used: number;
  remaining: number | null;
  /** ISO timestamp of the next allowance reset; null when unlimited. */
  resetsAt: string | null;
}

export class NewslettersController extends BaseController<'newsletters', NewslettersRepo> {
  private readonly campaignsRepo = new CampaignsRepo();

  constructor() {
    super(new NewslettersRepo());
  }

  /**
   * map_newsletters_lists is the source of truth for list targeting (the
   * legacy JSONB target_lists column is still dual-written by callers during
   * the transition, but nothing reads it for behavior anymore).
   */
  public override async add(row: OperationDataType<'newsletters', 'insert'>, trx?: Transaction<Models>) {
    const pending = row as Record<string, unknown>;
    // Scheduling is server-validated here because it has no dedicated endpoint (the router only
    // has send/cancelSchedule): a `scheduled` row with a null send_date would sit invisible
    // forever — the cron fires `send_date <= now`, which NULL never matches.
    if (pending['status'] === 'scheduled') {
      this.assertSchedulable(pending['send_date'], true);
    }
    // Every newsletter belongs to a campaign (§15). Callers that predate the
    // context switcher fall back to the tenant's office context.
    if (!pending['campaign_id']) {
      const campaigns = await this.campaignsRepo.getSwitcherList({ tenant_id: String(pending['tenant_id']) });
      const office = campaigns.find((c) => c.kind === 'office');
      if (!office) throw new BadRequestError('No campaign context exists for this organization.');
      pending['campaign_id'] = String(office.id);
    }
    const result = await super.add(row, trx);
    const rowObj = row as Record<string, unknown>;
    const resultObj = result as Record<string, unknown> | undefined;
    if (resultObj?.['id'] != null && rowObj['target_lists'] !== undefined) {
      await this.syncTargetLists(
        String(rowObj['tenant_id']),
        String(resultObj['id']),
        rowObj['target_lists'],
        String(rowObj['createdby_id'] ?? resultObj['createdby_id']),
        trx,
      );
    }
    return result;
  }

  /** Content fields whose value the deliverability preflight scores. Editing any of these after a
   * send has been enqueued would let the sent content diverge from the scored content (a preflight
   * TOCTOU), so they are frozen once the newsletter leaves the draft/paused states. */
  private static readonly SCORED_CONTENT_FIELDS = ['subject', 'html_content', 'plain_text_content'] as const;

  /** A `scheduled` newsletter must carry a real send_date (the frontend enforces this, but
   * scheduling flows through generic CRUD add/update, so the backend must too). `requireFuture`
   * additionally rejects past dates when the caller is actively (re)scheduling. */
  private assertSchedulable(sendDate: unknown, requireFuture: boolean): void {
    if (sendDate == null) {
      throw new BadRequestError(
        'Scheduling a newsletter requires a send date. Pick a date and time, or save it as a draft.',
      );
    }
    const when = sendDate instanceof Date ? sendDate : new Date(String(sendDate));
    if (Number.isNaN(when.getTime())) {
      throw new BadRequestError('The scheduled send date is not a valid date.');
    }
    if (requireFuture && when.getTime() <= Date.now()) {
      throw new BadRequestError('The scheduled send time must be in the future.');
    }
  }

  public override async update(input: {
    tenant_id: string;
    id: string;
    row: OperationDataType<'newsletters', 'update'>;
  }) {
    const rowObj = input.row as Record<string, unknown>;
    // The current row is needed by both the frozen-content and the scheduling checks — fetch it
    // lazily, at most once.
    let current: Record<string, unknown> | undefined;
    const loadCurrent = async (): Promise<Record<string, unknown> | undefined> => {
      current ??= (await this.getOneById({ tenant_id: input.tenant_id, id: input.id })) as
        | Record<string, unknown>
        | undefined;
      return current;
    };

    const editsScoredContent = NewslettersController.SCORED_CONTENT_FIELDS.some((field) => rowObj[field] !== undefined);
    if (editsScoredContent) {
      const status = (await loadCurrent())?.['status'];
      if (status === 'queuing' || status === 'sending' || status === 'sent') {
        throw new BadRequestError(
          'This newsletter is already sending or has been sent — its content can no longer be edited.',
        );
      }
    }

    // Scheduling guard (see `add`): a newsletter that is (or stays) `scheduled` must keep a
    // non-null send_date. The future-time requirement applies only when this update itself
    // (re)schedules — sets the status or a new date; an update that merely edits other fields
    // of an already-scheduled newsletter must not fail just because its send time has arrived
    // (the cron is about to fire it, and a past-but-set date fires fine).
    const providesSendDate = rowObj['send_date'] !== undefined;
    const effectiveStatus =
      rowObj['status'] !== undefined
        ? rowObj['status']
        : providesSendDate
          ? (await loadCurrent())?.['status']
          : undefined;
    if (effectiveStatus === 'scheduled') {
      const effectiveSendDate = providesSendDate ? rowObj['send_date'] : (await loadCurrent())?.['send_date'];
      this.assertSchedulable(effectiveSendDate, rowObj['status'] === 'scheduled' || providesSendDate);
    }

    const result = await super.update(input);
    const resultObj = result as Record<string, unknown> | undefined;
    if (rowObj['target_lists'] !== undefined) {
      await this.syncTargetLists(
        input.tenant_id,
        input.id,
        rowObj['target_lists'],
        String(rowObj['updatedby_id'] ?? resultObj?.['createdby_id']),
      );
    }
    return result;
  }

  /** Tolerates every legacy payload shape: {include, exclude}, bare array, JSON string, CSV string. */
  private parseTargetListSets(value: unknown): { include: string[]; exclude: string[] } {
    let parsed: unknown = value;
    if (typeof parsed === 'string') {
      const raw = parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return {
          include: raw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          exclude: [],
        };
      }
    }
    if (Array.isArray(parsed)) {
      return { include: parsed.map((v) => String(v)), exclude: [] };
    }
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      const toIds = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)) : []);
      return { include: toIds(obj['include']), exclude: toIds(obj['exclude']) };
    }
    return { include: [], exclude: [] };
  }

  /** Replace the newsletter's map_newsletters_lists rows; ids that don't resolve to a live list in the tenant are dropped. */
  private async syncTargetLists(
    tenant_id: string,
    newsletterId: string,
    rawTargetLists: unknown,
    actorId: string,
    trx?: Transaction<Models>,
  ): Promise<void> {
    const db = trx ?? this.getRepo().db;
    const { include, exclude } = this.parseTargetListSets(rawTargetLists);

    const candidates = [...new Set([...include, ...exclude])].filter((id) => /^\d+$/.test(id));
    let liveIds = new Set<string>();
    if (candidates.length > 0) {
      const rows = await db
        .selectFrom('lists')
        .select('id')
        .where('tenant_id', '=', tenant_id)
        .where('id', 'in', candidates)
        .execute();
      liveIds = new Set(rows.map((r) => String(r.id)));
    }

    await db
      .deleteFrom('map_newsletters_lists')
      .where('tenant_id', '=', tenant_id)
      .where('newsletter_id', '=', newsletterId)
      .execute();

    const values = [
      ...[...new Set(include)].filter((id) => liveIds.has(id)).map((id) => ({ list_id: id, mode: 'include' as const })),
      ...[...new Set(exclude)].filter((id) => liveIds.has(id)).map((id) => ({ list_id: id, mode: 'exclude' as const })),
    ].map((v) => ({
      tenant_id,
      newsletter_id: newsletterId,
      list_id: v.list_id,
      mode: v.mode,
      createdby_id: actorId,
      updatedby_id: actorId,
    }));
    if (values.length > 0) {
      await db.insertInto('map_newsletters_lists').values(values).execute();
    }
  }

  public override async exportCsv(
    input: ExportCsvInputType & { tenant_id: string },
    auth?: IAuthKeyPayload,
  ): Promise<ExportCsvResponseType> {
    if (auth) {
      const result = await this.getRepo().getAllWithCount(auth.tenant_id, input?.options as any);
      const rows = (result?.rows ?? []).map((row) => ({ ...(row as Record<string, unknown>) }));
      const response = this.buildCsvResponse(rows, input) as {
        csv: string;
        fileName: string;
        columns: string[];
        rowCount: number;
      };
      await this.userActivity.log({
        tenant_id: auth.tenant_id,
        user_id: auth.user_id,
        activity: 'export',
        entity: 'newsletters',
        quantity: response.rowCount,
        metadata: {
          requested_columns: Array.isArray(input.columns) ? input.columns.slice(0, 12) : [],
          returned_columns: response.columns.slice(0, 12),
          file_name: response.fileName,
        },
      });
      return response;
    }
    return super.exportCsv(input, auth);
  }

  public async buildRecipientQuery(tenant_id: string, newsletter: Record<string, unknown>): Promise<any> {
    let includeTags: string[] = [];
    let excludeTags: string[] = [];

    // List targeting lives in map_newsletters_lists (FK-backed, so no dangling ids).
    const listRows = await this.getRepo()
      .db.selectFrom('map_newsletters_lists')
      .select(['list_id', 'mode'])
      .where('tenant_id', '=', tenant_id)
      .where('newsletter_id', '=', String(newsletter['id']))
      .execute();
    const includeListIds = listRows.filter((r) => r.mode === 'include').map((r) => String(r.list_id));
    const excludeListIds = listRows.filter((r) => r.mode === 'exclude').map((r) => String(r.list_id));

    // segments is jsonb (returns pre-parsed object from Kysely) or legacy text string.
    // It stays JSONB deliberately: it holds tag *names*, not ids.
    const parseJsonField = (value: unknown): unknown => {
      if (value == null) return null;
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }
      return value; // already parsed object from jsonb column
    };

    const segmentsObj = parseJsonField(newsletter['segments']);
    if (Array.isArray(segmentsObj)) {
      includeTags = segmentsObj as string[];
    } else if (segmentsObj && typeof segmentsObj === 'object') {
      const obj = segmentsObj as Record<string, unknown>;
      includeTags = Array.isArray(obj['include']) ? (obj['include'] as string[]) : [];
      excludeTags = Array.isArray(obj['exclude']) ? (obj['exclude'] as string[]) : [];
    } else if (typeof segmentsObj === 'string' && segmentsObj) {
      includeTags = (segmentsObj as string)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }

    const db = this.getRepo().db;
    const campaignId = String(newsletter['campaign_id']);
    let query = db
      .selectFrom('persons')
      .where('persons.tenant_id', '=', tenant_id)
      .where('persons.email', 'is not', null)
      .where('persons.email', '!=', '')
      // Sendability (§15) = subscribed in THIS campaign ∧ address not suppressed ∧ not DNC(email).
      // 1. Per-campaign consent: an explicit subscribed row in the newsletter's campaign.
      .where((eb) =>
        eb.exists(
          db
            .selectFrom('campaign_subscriptions')
            .select('campaign_subscriptions.person_id')
            .where('campaign_subscriptions.tenant_id', '=', tenant_id)
            .where('campaign_subscriptions.campaign_id', '=', campaignId)
            .where('campaign_subscriptions.status', '=', 'subscribed')
            .where(sql<boolean>`campaign_subscriptions.person_id = persons.id`),
        ),
      )
      // 2. Global address health: hard bounces / spam complaints kill the address everywhere.
      .where((eb) =>
        eb.not(
          eb.exists(
            db
              .selectFrom('email_suppressions')
              .select('email_suppressions.id')
              .where('email_suppressions.tenant_id', '=', tenant_id)
              // Case-insensitive: suppressions are stored lowercased but persons keep mixed case.
              .where(sql<boolean>`lower(email_suppressions.email) = lower(persons.email)`),
          ),
        ),
      )
      // 3. Person-level do-not-contact (null channel list = all channels).
      .where(
        sql<boolean>`NOT (persons.do_not_contact AND (persons.do_not_contact_channels IS NULL OR 'email' = ANY(persons.do_not_contact_channels)))`,
      );

    query = query.where((eb) => {
      const conditions = [];
      if (includeListIds.length > 0) {
        conditions.push(
          eb.exists(
            db
              .selectFrom('map_lists_persons')
              .select('person_id')
              .where('map_lists_persons.tenant_id', '=', tenant_id)
              .where(sql<boolean>`map_lists_persons.person_id = persons.id`)
              .where('map_lists_persons.list_id', 'in', includeListIds),
          ),
        );
      }
      if (includeTags.length > 0) {
        conditions.push(
          eb.exists(
            db
              .selectFrom('map_peoples_tags')
              .innerJoin('tags', 'tags.id', 'map_peoples_tags.tag_id')
              .select('map_peoples_tags.person_id')
              .where('map_peoples_tags.tenant_id', '=', tenant_id)
              .where(sql<boolean>`map_peoples_tags.person_id = persons.id`)
              .where('tags.name', 'in', includeTags),
          ),
        );
      }

      if (conditions.length === 0) {
        return eb.val(false);
      }
      return eb.or(conditions);
    });

    if (excludeListIds.length > 0) {
      query = query.where((eb) =>
        eb.not(
          eb.exists(
            db
              .selectFrom('map_lists_persons')
              .select('person_id')
              .where('map_lists_persons.tenant_id', '=', tenant_id)
              .where(sql<boolean>`map_lists_persons.person_id = persons.id`)
              .where('map_lists_persons.list_id', 'in', excludeListIds),
          ),
        ),
      );
    }

    if (excludeTags.length > 0) {
      query = query.where((eb) =>
        eb.not(
          eb.exists(
            db
              .selectFrom('map_peoples_tags')
              .innerJoin('tags', 'tags.id', 'map_peoples_tags.tag_id')
              .select('map_peoples_tags.person_id')
              .where('map_peoples_tags.tenant_id', '=', tenant_id)
              .where(sql<boolean>`map_peoples_tags.person_id = persons.id`)
              .where('tags.name', 'in', excludeTags),
          ),
        ),
      );
    }

    // A resend targets the ORIGINAL's audience minus anyone who engaged with it (opened or
    // clicked). Evaluated at send time, so late opens between creating the resend and sending
    // it still drop out. Note the asymmetry Apple Mail Privacy Protection introduces: MPP
    // machine-opens make Apple users look like openers, so a resend reaches fewer people than
    // truly didn't read — the safe direction.
    const resendOfId = newsletter['resend_of_id'];
    if (resendOfId != null && resendOfId !== '') {
      query = query.where((eb) =>
        eb.not(
          eb.exists(
            db
              .selectFrom('newsletter_events')
              .select('newsletter_events.id')
              .where('newsletter_events.tenant_id', '=', tenant_id)
              .where('newsletter_events.newsletter_id', '=', String(resendOfId))
              .where('newsletter_events.event_type', 'in', ['open', 'click'])
              .where(sql<boolean>`lower(newsletter_events.email) = lower(persons.email)`),
          ),
        ),
      );
    }

    return query;
  }

  public async sendNewsletter(tenant_id: string, id: string, userId: string): Promise<any> {
    // Sending is locked during the demo test drive (no plan yet, no sender identity).
    await assertNotDemoMode(this.getRepo().db, tenant_id);
    const newsletter = (await this.getOneById({ tenant_id, id })) as Record<string, unknown> | undefined;
    if (!newsletter) {
      throw new NotFoundError('Newsletter not found');
    }
    if (newsletter['status'] === 'sent' || newsletter['status'] === 'queuing' || newsletter['status'] === 'sending') {
      throw new BadRequestError('Newsletter has already been sent or is currently sending');
    }

    const db = this.getRepo().db;
    const baseQuery = await this.buildRecipientQuery(tenant_id, newsletter);

    // Get total count of unique recipients using a distinct count query
    const countResult = await baseQuery
      .select(({ fn }: any) => fn.count(sql`DISTINCT persons.email`).as('count'))
      .executeTakeFirst();
    const totalRecipients = Number(countResult?.count || 0);

    if (totalRecipients === 0) {
      throw new BadRequestError('No recipients found for the selected lists or tags');
    }

    // A 'paused' newsletter (tripwire fired mid-send) resumes from where it stopped once the
    // tenant is unblocked, instead of double-sending the recipients before the pause point.
    const resumeOffset = newsletter['status'] === 'paused' ? Number(newsletter['send_offset'] ?? 0) : 0;
    const resumeDelivered = resumeOffset > 0 ? Number(newsletter['delivered_count'] ?? 0) : 0;
    // Keyset resume point (last email sent). Paired with the offset above; the worker pages with
    // `WHERE email > cursor`, so this is what actually prevents re-sending the pre-pause recipients.
    const resumeCursor =
      newsletter['status'] === 'paused' && typeof newsletter['send_cursor'] === 'string'
        ? newsletter['send_cursor']
        : null;

    // Anti-abuse gate: identity prerequisites, tripwire pauses, free-tier warm-up cap.
    await assertTenantMaySendNewsletter(db, tenant_id, totalRecipients - resumeOffset);

    // Content gate: the deliverability score must clear the blocked band. A check the composer
    // already ran on this exact content is reused from the cache — no recompute, no AI spend.
    const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
    await newsletterPreflight.assertNewsletterContentSendable(db, tenant_id, {
      id,
      subject: str(newsletter['subject']),
      html_content: str(newsletter['html_content']),
      plain_text_content: str(newsletter['plain_text_content']),
    });

    // Claim the newsletter and enqueue its send job atomically. The status flip is a CONDITIONAL
    // update (only a newsletter not already sent/queuing/sending can be claimed) so two concurrent
    // callers — two browser tabs, or a manual "Send now" racing the scheduled-newsletter cron — can
    // never both pass: exactly one row is updated, and the loser gets a ConflictError instead of a
    // second job that would email the whole audience twice. Doing the flip and the job insert in one
    // transaction also upholds the outbox rule: a crash between them can't strand the newsletter in
    // `queuing` with no job to run it.
    const claimed = await db.transaction().execute(async (trx) => {
      const row = await trx
        .updateTable('newsletters')
        .set({
          status: 'queuing',
          total_recipients: totalRecipients,
          delivered_count: resumeDelivered,
          updatedby_id: userId,
          updated_at: new Date(),
        })
        .where('tenant_id', '=', tenant_id)
        .where('id', '=', id)
        .where('status', 'not in', ['sent', 'queuing', 'sending'])
        .returningAll()
        .executeTakeFirst();

      if (!row) return null;

      await trx
        .insertInto('background_jobs')
        .values({
          tenant_id,
          queue: 'default',
          status: 'pending',
          payload: JSON.stringify({
            type: 'send-newsletter',
            newsletterId: id,
            tenantId: tenant_id,
            userId: userId,
            offset: resumeOffset,
            deliveredCount: resumeDelivered,
            cursor: resumeCursor,
          }),
          run_at: new Date(),
        })
        .execute();

      return row;
    });

    if (!claimed) {
      // Another request claimed it between our status read and the conditional update.
      throw new ConflictError('Newsletter has already been sent or is currently sending');
    }

    return claimed;
  }

  /** Take a `scheduled` newsletter off the calendar: back to draft, send_date cleared. The
   * scheduled-newsletters cron only fires rows still in `scheduled`, so this is the whole
   * cancellation — there is no queued job to hunt down. */
  public async cancelSchedule(tenant_id: string, id: string, userId: string): Promise<void> {
    const newsletter = (await this.getOneById({ tenant_id, id })) as Record<string, unknown> | undefined;
    if (!newsletter) throw new NotFoundError('Newsletter not found');
    if (newsletter['status'] !== 'scheduled') {
      throw new BadRequestError('This newsletter is not scheduled');
    }
    await this.update({
      tenant_id,
      id,
      row: { status: 'draft', send_date: null, updatedby_id: userId, updated_at: new Date() },
    });
    await this.userActivity.log({
      tenant_id,
      user_id: userId,
      activity: 'update',
      entity: 'newsletters',
      metadata: { action: 'cancel_schedule', newsletter_id: id, name: newsletter['name'] ?? null },
    });
  }

  /**
   * One-shot follow-up of a sent newsletter to the recipients who didn't open or click it.
   * Creates a clone (same content and audience definition, new subject) linked via
   * `resend_of_id` — buildRecipientQuery excludes the original's engagers at send time — and
   * sends it immediately through the normal guarded path (preflight, caps, tripwires).
   *
   * Industry-standard guardrails: exactly one resend per original (partial unique index backs
   * this up), and the subject must actually change — an identical subject re-lands in the same
   * ignored-mail context and mostly earns unsubscribes.
   */
  public async resendToNonOpeners(
    tenant_id: string,
    id: string,
    subject: string,
    userId: string,
  ): Promise<{ id: string }> {
    await assertNotDemoMode(this.getRepo().db, tenant_id);
    const original = (await this.getOneById({ tenant_id, id })) as Record<string, unknown> | undefined;
    if (!original) throw new NotFoundError('Newsletter not found');
    if (original['status'] !== 'sent') {
      throw new BadRequestError('Only a sent newsletter can be resent to non-openers');
    }
    if (original['resend_of_id'] != null) {
      throw new BadRequestError('This newsletter is already a resend; it cannot be resent again');
    }

    const trimmedSubject = subject.trim();
    if (!trimmedSubject) throw new BadRequestError('Give the resend a subject line');
    const originalSubject = typeof original['subject'] === 'string' ? original['subject'].trim() : '';
    if (trimmedSubject.toLowerCase() === originalSubject.toLowerCase()) {
      throw new BadRequestError('Change the subject line: a resend with the same subject mostly earns unsubscribes');
    }

    const db = this.getRepo().db;
    const existing = await db
      .selectFrom('newsletters')
      .select('id')
      .where('tenant_id', '=', tenant_id)
      .where('resend_of_id', '=', id)
      .executeTakeFirst();
    if (existing) {
      throw new BadRequestError('This newsletter was already resent to non-openers once, which is the limit');
    }

    // Count the real audience first (original's audience minus engagers) so an "everyone
    // opened" resend is refused with a plain explanation instead of leaving a junk draft.
    const previewQuery = await this.buildRecipientQuery(tenant_id, { ...original, resend_of_id: id });
    const previewCount = await previewQuery
      .select(({ fn }: any) => fn.count(sql`DISTINCT persons.email`).as('count'))
      .executeTakeFirst();
    if (Number(previewCount?.count || 0) === 0) {
      throw new BadRequestError(
        'Everyone who received this newsletter opened or clicked it. There is no one to resend to.',
      );
    }

    const asJsonString = (v: unknown): string | null =>
      v == null ? null : typeof v === 'string' ? v : JSON.stringify(v);
    const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

    const resend = (await this.add({
      tenant_id,
      campaign_id: String(original['campaign_id']),
      resend_of_id: id,
      name: `${String(original['name'] ?? 'Newsletter')} (resend)`,
      status: 'draft',
      subject: trimmedSubject,
      preview_text: str(original['preview_text']),
      html_content: str(original['html_content']),
      plain_text_content: str(original['plain_text_content']),
      audience_description: str(original['audience_description']),
      target_lists: asJsonString(original['target_lists']),
      segments: asJsonString(original['segments']),
      createdby_id: userId,
      updatedby_id: userId,
    } as OperationDataType<'newsletters', 'insert'>)) as Record<string, unknown> | undefined;
    if (!resend?.['id']) throw new BadRequestError('Could not create the resend');
    const resendId = String(resend['id']);

    await this.userActivity.log({
      tenant_id,
      user_id: userId,
      activity: 'create',
      entity: 'newsletters',
      entity_id: resendId,
      metadata: { action: 'resend_to_non_openers', original_id: id, original_name: original['name'] ?? null },
    });

    // Goes through the full guarded send path; a refusal (preflight, caps, pauses) leaves the
    // clone as an ordinary draft the user can fix or delete.
    await this.sendNewsletter(tenant_id, resendId, userId);
    return { id: resendId };
  }

  /** Interactive deliverability check for the composer — lint + SpamAssassin + AI, cached by hash. */
  public async runPreflight(tenant_id: string, input: RunPreflightType): Promise<PreflightResult> {
    return newsletterPreflight.runPreflight(this.getRepo().db, tenant_id, input);
  }

  /** The tenant's monthly newsletter-email allowance, for the composer's Review & send step.
   * Mirrors the math the pre-send gate enforces (send-guards) so what the UI shows is exactly
   * what the server will allow. */
  public async getSendQuota(tenant_id: string): Promise<SendQuota> {
    const db = this.getRepo().db;
    const tenant = await loadSendingTenant(db, tenant_id);
    const cap = monthlyEmailCap(tenant.plan, tenant.subscription_quantity);
    const window = sendWindow(tenant.subscription_ends_at, new Date());
    const used = await sentEmailsSince(db, tenant_id, window.start);
    if (!Number.isFinite(cap)) {
      return { cap: null, used, remaining: null, resetsAt: null };
    }
    return { cap, used, remaining: Math.max(0, cap - used), resetsAt: window.resetsAt.toISOString() };
  }

  public async sendTestEmail(tenant_id: string, input: SendTestEmailInput): Promise<{ to: string; delivered: number }> {
    await assertNotDemoMode(this.getRepo().db, tenant_id);
    const db = this.getRepo().db;

    // Test sends are single-recipient but still outbound mail: blocked while the tenant is
    // suspended/paused, and throttled so they can't be scripted into a bulk channel.
    assertTenantSendingNotBlocked(await loadSendingTenant(db, tenant_id));
    checkRateLimit(`sendTestEmail:${tenant_id}`, 20, 60 * 60 * 1000);

    // Resolve the sender: prefer the caller-supplied from name/email, then the workspace
    // Communications settings, then the platform preview fallback. Unlike a real broadcast, a test
    // send is allowed before domain verification (you're previewing to yourself), so the fallback is
    // acceptable here only.
    const settingsRows = await db
      .selectFrom('settings')
      .select(['key', 'value'])
      .where('tenant_id', '=', tenant_id)
      .where('key', 'in', [
        'communications.sendgrid_api_key',
        'communications.sendgrid_subuser_username',
        'communications.default_from_name',
        'communications.default_from_email',
        'communications.reply_to',
      ])
      .execute();

    const settingsMap: Record<string, string> = {};
    for (const row of settingsRows) {
      if (typeof row.value === 'string') {
        settingsMap[row.key] = row.value;
      }
    }

    const fromName = input.fromName || settingsMap['communications.default_from_name'] || DEFAULT_FROM_NAME;
    const fromEmail = input.fromEmail || settingsMap['communications.default_from_email'] || DEFAULT_FROM_EMAIL;
    const replyTo = settingsMap['communications.reply_to'] || undefined;
    const sendgridApiKey = settingsMap['communications.sendgrid_api_key'];
    const subuserUsername = settingsMap['communications.sendgrid_subuser_username'];

    // Apply the same send-time render as the real send so the test reflects what recipients receive:
    // block-JSON stripped, relative images made absolute, merge tokens resolved (to their fallbacks
    // here, since a test address carries no person record).
    const html = renderNewsletterHtml(input.html, { baseUrl: env.appUrl, previewText: null });
    const mergeTokens = extractMergeTokens(input.subject, html, input.text);
    const substitutions = mergeTokens.length ? resolveMergeSubstitutions(mergeTokens, { email: input.to }) : undefined;

    const mailSvc = new NewsletterEmailService();
    const delivered = await mailSvc.sendNewsletter({
      fromName,
      fromEmail,
      replyTo,
      recipients: [{ email: input.to, substitutions }],
      subject: input.subject,
      html,
      // Same multipart guarantee as the real send: derive the text part when none was written.
      text: input.text || htmlToPlainText(html),
      sendgridApiKey,
      subuserUsername,
    });

    return { to: input.to, delivered };
  }

  /**
   * Everything the newsletter report page renders in one call.
   *
   * Engagement detail lives in two places: raw `newsletter_events` (recent) and
   * the `person_newsletter_engagements` rollup (raw rows are aggregated into it
   * and deleted by the prune job). The two are disjoint by construction, so
   * per-email numbers are the sum of both sources.
   */
  public async getReport(tenant_id: string, id: string): Promise<NewsletterReportType> {
    const newsletter = (await this.getOneById({ tenant_id, id })) as Record<string, unknown> | undefined;
    if (!newsletter) throw new NotFoundError('Newsletter not found');
    const db = this.getRepo().db;

    // --- per-email engagement, merged from raw events + the rollup ------------
    const rawAgg = await db
      .selectFrom('newsletter_events')
      .select([
        'email',
        sql<number>`COUNT(*) FILTER (WHERE event_type = 'open')`.as('opens'),
        sql<number>`COUNT(*) FILTER (WHERE event_type = 'click')`.as('clicks'),
        sql<number>`COUNT(DISTINCT url) FILTER (WHERE event_type = 'click' AND url IS NOT NULL)`.as('links'),
        sql<boolean>`BOOL_OR(event_type = 'bounce' AND COALESCE(bounce_type, '') <> 'blocked')`.as('hard_bounced'),
        sql<boolean>`BOOL_OR(event_type = 'bounce' AND bounce_type = 'blocked')`.as('soft_bounced'),
        sql<boolean>`BOOL_OR(event_type = 'dropped')`.as('dropped'),
        sql<string | null>`MAX(reason) FILTER (WHERE event_type IN ('bounce', 'dropped'))`.as('bounce_reason'),
        sql<Date | null>`MAX(timestamp) FILTER (WHERE event_type IN ('bounce', 'dropped'))`.as('bounced_at'),
        sql<boolean>`BOOL_OR(event_type = 'unsubscribe')`.as('unsubscribed'),
        sql<boolean>`BOOL_OR(event_type = 'spamreport')`.as('spam_reported'),
        sql<Date | null>`MAX(timestamp) FILTER (WHERE event_type = 'spamreport')`.as('spam_reported_at'),
      ])
      .where('newsletter_id', '=', id)
      .where('tenant_id', '=', tenant_id)
      .groupBy('email')
      .execute();

    const rollup = await db
      .selectFrom('person_newsletter_engagements')
      .select(['email', 'open_count', 'click_count', 'hard_bounced', 'soft_bounced', 'has_unsubscribed', 'bounced_at'])
      .where('newsletter_id', '=', id)
      .where('tenant_id', '=', tenant_id)
      .execute();

    interface EmailEngagement {
      opens: number;
      clicks: number;
      links: number;
      hard: boolean;
      soft: boolean;
      dropped: boolean;
      reason: string | null;
      bouncedAt: Date | null;
      unsubscribed: boolean;
      spamReported: boolean;
      spamReportedAt: Date | null;
    }
    const byEmail = new Map<string, EmailEngagement>();
    const entryFor = (email: string): EmailEngagement => {
      let e = byEmail.get(email);
      if (!e) {
        e = {
          opens: 0,
          clicks: 0,
          links: 0,
          hard: false,
          soft: false,
          dropped: false,
          reason: null,
          bouncedAt: null,
          unsubscribed: false,
          spamReported: false,
          spamReportedAt: null,
        };
        byEmail.set(email, e);
      }
      return e;
    };
    for (const r of rollup) {
      const e = entryFor(r.email);
      e.opens += Number(r.open_count);
      e.clicks += Number(r.click_count);
      e.hard = e.hard || r.hard_bounced;
      e.soft = e.soft || r.soft_bounced;
      e.unsubscribed = e.unsubscribed || r.has_unsubscribed;
      e.bouncedAt = e.bouncedAt ?? (r.bounced_at ? new Date(r.bounced_at as unknown as string) : null);
    }
    for (const r of rawAgg) {
      const e = entryFor(r.email);
      e.opens += Number(r.opens);
      e.clicks += Number(r.clicks);
      e.links += Number(r.links);
      e.hard = e.hard || r.hard_bounced;
      e.soft = e.soft || r.soft_bounced;
      e.dropped = e.dropped || r.dropped;
      e.reason = e.reason ?? r.bounce_reason;
      e.bouncedAt = e.bouncedAt ?? (r.bounced_at ? new Date(r.bounced_at as unknown as string) : null);
      e.unsubscribed = e.unsubscribed || r.unsubscribed;
      e.spamReported = e.spamReported || r.spam_reported;
      e.spamReportedAt =
        e.spamReportedAt ?? (r.spam_reported_at ? new Date(r.spam_reported_at as unknown as string) : null);
    }

    const bounceKind = (e: EmailEngagement): 'hard' | 'soft' | 'dropped' | null =>
      e.hard ? 'hard' : e.soft ? 'soft' : e.dropped ? 'dropped' : null;

    // --- bounce rows, CRM-matched --------------------------------------------
    const MAX_BOUNCE_ROWS = 500;
    const bounceEntries = [...byEmail.entries()]
      .map(([email, e]) => ({ email, e, kind: bounceKind(e) }))
      .filter((b): b is { email: string; e: EmailEngagement; kind: 'hard' | 'soft' | 'dropped' } => b.kind !== null)
      .sort((a, b) => (b.e.bouncedAt?.getTime() ?? 0) - (a.e.bouncedAt?.getTime() ?? 0));

    const engagedEntries = [...byEmail.entries()]
      .filter(([, e]) => e.opens + e.clicks > 0)
      .sort(([, a], [, b]) => b.clicks - a.clicks || b.opens - a.opens)
      .slice(0, 5);

    const matchEmails = [
      ...new Set(
        [...bounceEntries.slice(0, MAX_BOUNCE_ROWS).map((b) => b.email), ...engagedEntries.map(([email]) => email)].map(
          (m) => m.toLowerCase(),
        ),
      ),
    ];
    const personsByEmail = new Map<string, { id: string; public_id: string | null; name: string }>();
    if (matchEmails.length > 0) {
      const matches = await db
        .selectFrom('persons')
        .select(['id', 'public_id', 'first_name', 'last_name', 'email'])
        .where('tenant_id', '=', tenant_id)
        .where(sql<string>`LOWER(persons.email)`, 'in', matchEmails)
        .execute();
      for (const p of matches) {
        if (!p.email) continue;
        const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
        personsByEmail.set(String(p.email).toLowerCase(), {
          id: String(p.id),
          public_id: p.public_id,
          name: name || 'Unnamed person',
        });
      }
    }
    const personFor = (email: string) => personsByEmail.get(email.toLowerCase()) ?? null;

    const bounceRows: NewsletterReportBounceType[] = bounceEntries.slice(0, MAX_BOUNCE_ROWS).map((b) => ({
      email: b.email,
      kind: b.kind,
      reason: b.e.reason,
      occurred_at: b.e.bouncedAt,
      person: personFor(b.email),
    }));

    const mostEngaged: NewsletterReportEngagedType[] = engagedEntries.map(([email, e]) => ({
      email,
      opens: e.opens,
      clicks: e.clicks,
      links: e.links,
      person: personFor(email),
    }));

    // --- hourly timeline (raw events only — empty once pruned) ----------------
    const timeline = await db
      .selectFrom('newsletter_events')
      .select([
        sql<string>`to_char(timestamp, 'YYYY-MM-DD HH24:00')`.as('time_bucket'),
        sql<number>`COUNT(id) FILTER (WHERE event_type = 'open')`.as('opens'),
        sql<number>`COUNT(id) FILTER (WHERE event_type = 'click')`.as('clicks'),
      ])
      .where('newsletter_id', '=', id)
      .where('tenant_id', '=', tenant_id)
      .where('event_type', 'in', ['open', 'click'])
      .groupBy('time_bucket')
      .orderBy('time_bucket', 'asc')
      .execute();
    const timelinePoints = timeline.map((t) => ({
      time: t.time_bucket,
      opens: Number(t.opens),
      clicks: Number(t.clicks),
    }));

    const sendDate = newsletter['send_date'] ? new Date(newsletter['send_date'] as string) : null;
    let opensIn24hPct: number | null = null;
    if (sendDate && timelinePoints.length > 0) {
      const cutoff = sendDate.getTime() + 24 * 60 * 60 * 1000;
      let within = 0;
      let total = 0;
      for (const t of timelinePoints) {
        total += t.opens;
        // Bucket keys are Postgres-local hour strings; treat them as local time.
        if (new Date(t.time.replace(' ', 'T')).getTime() <= cutoff) within += t.opens;
      }
      opensIn24hPct = total > 0 ? (within / total) * 100 : null;
    }

    // --- links: stored top_links are authoritative for clicks (they survive
    // pruning); unique-people counts only exist while raw events do ------------
    const linkAgg = await db
      .selectFrom('newsletter_events')
      .select(['url', sql<number>`COUNT(*)`.as('clicks'), sql<number>`COUNT(DISTINCT email)`.as('people')])
      .where('newsletter_id', '=', id)
      .where('tenant_id', '=', tenant_id)
      .where('event_type', '=', 'click')
      .where('url', 'is not', null)
      .groupBy('url')
      .execute();
    const peopleByUrl = new Map(
      linkAgg.map((l) => [String(l.url), { clicks: Number(l.clicks), people: Number(l.people) }]),
    );

    let storedLinks: MarketingEmailTopLinkType[] = [];
    const rawTopLinks = newsletter['top_links'];
    if (Array.isArray(rawTopLinks)) {
      storedLinks = rawTopLinks as MarketingEmailTopLinkType[];
    } else if (typeof rawTopLinks === 'string' && rawTopLinks) {
      try {
        const parsed: unknown = JSON.parse(rawTopLinks);
        if (Array.isArray(parsed)) storedLinks = parsed as MarketingEmailTopLinkType[];
      } catch {
        storedLinks = [];
      }
    }
    const linkUrls = new Set<string>([...storedLinks.map((l) => l.url), ...peopleByUrl.keys()]);
    const allLinks: NewsletterReportLinkType[] = [...linkUrls]
      .map((url) => {
        const stored = storedLinks.find((l) => l.url === url);
        const raw = peopleByUrl.get(url);
        const clicks = Math.max(stored?.clicks ?? 0, raw?.clicks ?? 0);
        // A people count from a partial event window would understate — only
        // report it when the raw window still covers every recorded click.
        const people = raw && raw.clicks >= clicks ? raw.people : null;
        return { url, clicks, people };
      })
      .sort((a, b) => b.clicks - a.clicks);

    // --- audience composition (current list membership — see report footer) ---
    const audienceLists: { id: string; name: string; mode: 'include' | 'exclude'; members: number }[] = [];
    let overlapRemoved = 0;
    let suppressedSkipped = 0;
    const listRows = await db
      .selectFrom('map_newsletters_lists')
      .innerJoin('lists', 'lists.id', 'map_newsletters_lists.list_id')
      .select(['lists.id as id', 'lists.name as name', 'map_newsletters_lists.mode as mode'])
      .where('map_newsletters_lists.tenant_id', '=', tenant_id)
      .where('lists.tenant_id', '=', tenant_id)
      .where('map_newsletters_lists.newsletter_id', '=', id)
      .execute();
    const includeIds = listRows.filter((l) => l.mode === 'include').map((l) => String(l.id));
    if (listRows.length > 0) {
      const allIds = listRows.map((l) => String(l.id));
      const memberCounts = await db
        .selectFrom('map_lists_persons')
        .select(['list_id', sql<number>`COUNT(DISTINCT person_id)`.as('members')])
        .where('tenant_id', '=', tenant_id)
        .where('list_id', 'in', allIds)
        .groupBy('list_id')
        .execute();
      const membersByList = new Map(memberCounts.map((m) => [String(m.list_id), Number(m.members)]));
      for (const l of listRows) {
        audienceLists.push({
          id: String(l.id),
          name: String(l.name),
          mode: l.mode === 'exclude' ? 'exclude' : 'include',
          members: membersByList.get(String(l.id)) ?? 0,
        });
      }
      if (includeIds.length > 0) {
        const distinctRow = await db
          .selectFrom('map_lists_persons')
          .select(sql<number>`COUNT(DISTINCT person_id)`.as('distinct_members'))
          .where('tenant_id', '=', tenant_id)
          .where('list_id', 'in', includeIds)
          .executeTakeFirst();
        const includeSum = audienceLists.filter((l) => l.mode === 'include').reduce((sum, l) => sum + l.members, 0);
        overlapRemoved = Math.max(0, includeSum - Number(distinctRow?.distinct_members ?? 0));

        const suppressedRow = await db
          .selectFrom('map_lists_persons')
          .innerJoin('persons', 'persons.id', 'map_lists_persons.person_id')
          .select(sql<number>`COUNT(DISTINCT persons.id)`.as('suppressed'))
          .where('map_lists_persons.tenant_id', '=', tenant_id)
          .where('persons.tenant_id', '=', tenant_id)
          .where('map_lists_persons.list_id', 'in', includeIds)
          .where((eb) =>
            eb.exists(
              db
                .selectFrom('email_suppressions')
                .select('email_suppressions.id')
                .where('email_suppressions.tenant_id', '=', tenant_id)
                // Case-insensitive: suppressions are stored lowercased but persons keep mixed case.
                .where(sql<boolean>`lower(email_suppressions.email) = lower(persons.email)`),
            ),
          )
          .executeTakeFirst();
        suppressedSkipped = Number(suppressedRow?.suppressed ?? 0);
      }
    }

    // --- the last 5 sends in this campaign, ending with this one --------------
    let previousSends: NewsletterReportType['previous_sends'] = [];
    if (sendDate) {
      let prevQuery = db
        .selectFrom('newsletters')
        .select([
          'id',
          'name',
          'send_date',
          'open_rate',
          'click_rate',
          'unsubscribe_count',
          'bounce_count',
          'delivered_count',
          'total_recipients',
        ])
        .where('tenant_id', '=', tenant_id)
        .where('status', '=', 'sent')
        .where('send_date', 'is not', null)
        .where((eb) => eb.or([eb('send_date', '<', sendDate), eb('id', '=', id)]))
        .orderBy('send_date', 'desc')
        .limit(5);
      const campaignId = newsletter['campaign_id'];
      prevQuery =
        campaignId != null
          ? prevQuery.where('campaign_id', '=', String(campaignId))
          : prevQuery.where('campaign_id', 'is', null);
      const prevRows = await prevQuery.execute();
      previousSends = prevRows.reverse().map((r) => {
        const delivered = Number(r.delivered_count ?? 0);
        const recipients = Number(r.total_recipients ?? 0);
        return {
          id: String(r.id),
          name: String(r.name),
          send_date: r.send_date ? new Date(r.send_date as unknown as string) : null,
          open_rate: Number(r.open_rate ?? 0),
          click_rate: Number(r.click_rate ?? 0),
          unsubscribe_rate: delivered > 0 ? (Number(r.unsubscribe_count ?? 0) / delivered) * 100 : 0,
          bounce_rate: recipients > 0 ? (Number(r.bounce_count ?? 0) / recipients) * 100 : 0,
        };
      });
    }

    // --- sender identity (workspace Communications settings) ------------------
    const fromRows = await db
      .selectFrom('settings')
      .select(['key', 'value'])
      .where('tenant_id', '=', tenant_id)
      .where('key', 'in', ['communications.default_from_name', 'communications.default_from_email'])
      .execute();
    const fromMap: Record<string, string> = {};
    for (const row of fromRows) {
      if (typeof row.value === 'string') fromMap[row.key] = row.value;
    }
    const fromName = fromMap['communications.default_from_name'] ?? null;
    const fromEmail = fromMap['communications.default_from_email'] ?? null;

    // --- totals ----------------------------------------------------------------
    const hard = bounceEntries.filter((b) => b.kind === 'hard').length;
    const soft = bounceEntries.filter((b) => b.kind === 'soft').length;
    const dropped = bounceEntries.filter((b) => b.kind === 'dropped').length;
    const unsubTotal = Math.max(
      [...byEmail.values()].filter((e) => e.unsubscribed).length,
      Number(newsletter['unsubscribe_count'] ?? 0),
    );
    const spamRows = [...byEmail.entries()]
      .filter(([, e]) => e.spamReported)
      .map(([email, e]) => ({ email: email || null, occurred_at: e.spamReportedAt }));
    const spamTotal = Math.max(spamRows.length, Number(newsletter['spam_complaint_count'] ?? 0));
    const clickers = [...byEmail.values()].filter((e) => e.clicks > 0);

    return {
      timeline: timelinePoints,
      opens_in_24h_pct: opensIn24hPct,
      bounces: { total: bounceEntries.length, hard, soft, dropped, rows: bounceRows },
      top_links: allLinks.slice(0, 6),
      tracked_links: allLinks.length,
      total_clicks: clickers.reduce((sum, e) => sum + e.clicks, 0),
      unique_clickers: clickers.length,
      most_engaged: mostEngaged,
      unsubscribes: { total: unsubTotal, reasons: unsubTotal > 0 ? [{ reason: null, count: unsubTotal }] : [] },
      spam_reports: { total: spamTotal, rows: spamRows },
      audience: { lists: audienceLists, overlap_removed: overlapRemoved, suppressed_skipped: suppressedSkipped },
      previous_sends: previousSends,
      from: fromName || fromEmail ? { name: fromName, email: fromEmail } : null,
    };
  }

  /**
   * "Create list of N clickers" — a static snapshot list of every CRM person
   * whose address clicked this newsletter, so the next send can target the
   * people who acted on this one.
   */
  public async createClickersList(auth: IAuthKeyPayload, id: string): Promise<CreateClickersListResultType> {
    const tenant_id = auth.tenant_id;
    const newsletter = (await this.getOneById({ tenant_id, id })) as Record<string, unknown> | undefined;
    if (!newsletter) throw new NotFoundError('Newsletter not found');
    const db = this.getRepo().db;

    const rawClickers = await db
      .selectFrom('newsletter_events')
      .select('email')
      .distinct()
      .where('newsletter_id', '=', id)
      .where('tenant_id', '=', tenant_id)
      .where('event_type', '=', 'click')
      .execute();
    const rolledUpClickers = await db
      .selectFrom('person_newsletter_engagements')
      .select('email')
      .where('newsletter_id', '=', id)
      .where('tenant_id', '=', tenant_id)
      .where('click_count', '>', 0)
      .execute();
    const emails = [
      ...new Set([...rawClickers, ...rolledUpClickers].map((r) => r.email.toLowerCase()).filter(Boolean)),
    ];
    if (emails.length === 0) throw new BadRequestError('No one has clicked this newsletter yet.');

    const persons = await db
      .selectFrom('persons')
      .select('id')
      .where('tenant_id', '=', tenant_id)
      .where(sql<string>`LOWER(persons.email)`, 'in', emails)
      .execute();
    const memberIds = [...new Set(persons.map((p) => String(p.id)))];
    if (memberIds.length === 0) {
      throw new BadRequestError('None of the clickers match a person in the CRM, so there is no one to add.');
    }

    const listsController = new ListsController();
    const newsletterName = String(newsletter['name'] ?? 'newsletter');
    // Lists cap names at 100 chars — leave room for a " (n)" de-dup suffix.
    const baseName = `Clicked · ${newsletterName}`.slice(0, 90);
    const description = `People who clicked "${newsletterName}" — snapshot taken ${new Date().toISOString().slice(0, 10)}.`;
    const campaignId = newsletter['campaign_id'] != null ? String(newsletter['campaign_id']) : undefined;

    const MAX_NAME_ATTEMPTS = 5;
    for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt++) {
      const name = attempt === 0 ? baseName : `${baseName} (${attempt + 1})`;
      try {
        const list = (await listsController.addList(
          { name, description, object: 'people', is_dynamic: false, member_ids: memberIds, campaign_id: campaignId },
          auth,
        )) as Record<string, unknown>;
        return { id: String(list['id']), name, members: memberIds.length };
      } catch (err: unknown) {
        const isNameConflict = err instanceof TRPCError && err.code === 'CONFLICT';
        if (!isNameConflict || attempt === MAX_NAME_ATTEMPTS - 1) throw err;
      }
    }
    // Unreachable — the loop either returns or rethrows on its last attempt.
    throw new BadRequestError('Could not find a free list name.');
  }
}
