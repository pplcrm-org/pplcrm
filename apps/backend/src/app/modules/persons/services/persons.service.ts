import { env } from '../../../../env';
import type { IAuthKeyPayload, UpdatePersonsType } from '../../../../../../../libs/common/src';
import { TRPCError } from '@trpc/server';
import { sql } from 'kysely';

import { fingerprintFull, fingerprintStreet } from '../../../lib/address-normalize';
import { backfillMissingSlugs } from '../../../lib/slug';
import { backfillPersonPublicIds, insertPersonWithPublicId } from '../../../lib/person-public-id';
import { notificationEnabled } from '../../../lib/profile-preferences';
import { HouseholdRepo } from '../../households/repositories/households.repo';
import { SettingsController } from '../../settings/controller';
import { TagsRepo } from '../../tags/repositories/tags.repo';
import { MapPersonsTagRepo } from '../repositories/map-persons-tags.repo';
import { PersonsRepo } from '../repositories/persons.repo';
import { CompaniesRepo } from '../../companies/repositories/companies.repo';
import { MapTeamsPersonsRepo } from '../../teams/repositories/map-teams-persons.repo';
import { TeamsRepo } from '../../teams/repositories/teams.repo';
import type { OperationDataType } from '../../../../../../../libs/common/src/lib/kysely.models';
import { ImportsRepo } from '../../imports/repositories/imports.repo';
import { ListsRepo } from '../../lists/repositories/lists.repo';
import { MapListsPersonsRepo } from '../../lists/repositories/map-lists-persons.repo';
import { NotificationsRepo } from '../../notifications/repositories/notifications.repo';
import { UserActivityRepo } from '../../../lib/user-activity.repo';
import { StorageService } from '../../../lib/storage.service';
import { WorkflowsController } from '../../workflows/controller';
import { TransactionalEmailService } from '../../../lib/mail/transactional-mail.service';
import { queueZapierTrigger, pickPersonFields } from '../../zapier/zapier.service';
import { logger } from '../../../logger';

export class PersonsService {
  private mapPersonsTagRepo = new MapPersonsTagRepo();
  private settingsController = new SettingsController();
  private tagsRepo = new TagsRepo();
  private mapTeamsPersonsRepo = new MapTeamsPersonsRepo();
  private teamsRepo = new TeamsRepo();
  private importsRepo = new ImportsRepo();
  private personsRepo = new PersonsRepo();
  private userActivity = new UserActivityRepo();
  private storageService = new StorageService();
  private householdRepo = new HouseholdRepo();
  private companiesRepo = new CompaniesRepo();
  private listsRepo = new ListsRepo();
  private mapListsPersonsRepo = new MapListsPersonsRepo();

  public async addPerson(payload: UpdatePersonsType, auth: IAuthKeyPayload) {
    // Enforce email uniqueness within the tenant
    const emailToCheck = payload.email?.trim();
    if (emailToCheck) {
      const existing = await this.personsRepo.findByEmail({ tenant_id: auth.tenant_id, email: emailToCheck });
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `A person with the email "${emailToCheck}" already exists.`,
        });
      }
    }

    const campaign_id = await this.settingsController.getCurrentCampaignId(auth);
    const households = new HouseholdRepo();

    let household_id = payload.household_id as string | undefined;
    if (!household_id) {
      const existingBlank = await households.getBlankHousehold({ tenant_id: auth.tenant_id });
      if (existingBlank?.id) {
        household_id = String(existingBlank.id);
      } else {
        const created = await households.add({
          row: {
            tenant_id: auth.tenant_id,
            campaign_id: String(campaign_id),
            createdby_id: auth.user_id,
            updatedby_id: auth.user_id,
          } as OperationDataType<'households', 'insert'>,
        });
        household_id = String(created?.id);
      }
    }

    // Persons are keyed by an opaque public_id, not a name slug (spec §1):
    // generate a Crockford id → insert → retry on the per-tenant unique
    // violation. The display slug `{name}-xxxx-xxxx` is derived from the same
    // public_id in one write. (Households/companies still use name slugs.)
    const result = await insertPersonWithPublicId(payload.first_name, payload.last_name, (public_id, slug) => {
      const row = {
        ...payload,
        public_id,
        slug,
        household_id,
        campaign_id,
        tenant_id: auth.tenant_id,
        createdby_id: auth.user_id,
        updatedby_id: auth.user_id,
      };
      return this.personsRepo.add({ row: row as OperationDataType<'persons', 'insert'> });
    });
    if (result && typeof result === 'object') {
      try {
        const { queueUsageLimitCheck } = await import('../../billing/usage-limits');
        await queueUsageLimitCheck(auth.tenant_id, this.personsRepo.db);
      } catch (err) {
        logger.error({ err }, 'Failed to trigger usage check in addPerson');
      }
      try {
        const workflowsController = new WorkflowsController();
        await workflowsController.triggerWorkflow(
          auth.tenant_id,
          String((result as Record<string, unknown>)['id']),
          'contact_created',
          null,
        );
      } catch (err) {
        logger.error({ err }, 'Failed to trigger contact_created workflow in add');
      }

      if (payload.assigned_to) {
        try {
          const assigneeId = String(payload.assigned_to);
          const assignee = await this.personsRepo.db
            .selectFrom('authusers')
            .leftJoin('profiles', 'profiles.auth_id', 'authusers.id')
            .select(['authusers.email', 'authusers.first_name', 'profiles.preferences as profile_preferences'])
            .where('authusers.id', '=', assigneeId)
            .executeTakeFirst();
          if (assignee) {
            const createdPerson = result as Record<string, unknown>;
            const personName =
              `${createdPerson['first_name'] || ''} ${createdPerson['last_name'] || ''}`.trim() || 'unnamed contact';
            const link = `${env.appUrl}/persons/${createdPerson['id']}`;
            if (notificationEnabled(assignee.profile_preferences, 'person_assigned_in_app')) {
              const notificationsRepo = new NotificationsRepo();
              await notificationsRepo.pushNotification({
                tenant_id: auth.tenant_id,
                user_id: assigneeId,
                title: 'Contact Assigned',
                message: `You have been assigned ownership of the contact: "${personName}"`,
                type: 'person',
                link: `/persons/${createdPerson['id']}`,
              });
            }
            if (assignee.email && notificationEnabled(assignee.profile_preferences, 'person_assigned')) {
              const mailService = new TransactionalEmailService();
              await mailService.sendMail({
                to: assignee.email,
                subject: `Contact assigned to you: ${personName}`,
                notificationSettingsLink: true,
                text: `Hi ${assignee.first_name},\n\n${auth.name} assigned you ownership of the contact ${personName}.\n\nContact details:\nEmail: ${createdPerson['email'] || 'None'}\nPhone: ${createdPerson['mobile'] || createdPerson['home_phone'] || 'None'}\n\nView the contact: ${link}`,
                html: `<h2>Contact assigned to you</h2>
<p>Hi ${assignee.first_name},</p>
<p>${auth.name} assigned you ownership of the contact <strong>${personName}</strong>.</p>
<div class="panel"><p><strong>Email:</strong> ${createdPerson['email'] || 'None'}</p><p><strong>Phone:</strong> ${createdPerson['mobile'] || createdPerson['home_phone'] || 'None'}</p></div>
<div class="btn-container">
  <a href="${link}" class="btn">View contact</a>
</div>`,
              });
            }
          }
        } catch (mailErr) {
          logger.error({ err: mailErr }, 'Failed to process contact assignment alert/notification in addPerson');
        }
      }
    }
    try {
      await this.userActivity.log({
        tenant_id: auth.tenant_id,
        user_id: auth.user_id,
        activity: 'create',
        entity: 'persons',
        entity_id: result?.id ? String(result.id) : null,
        quantity: 1,
        metadata: {
          id: result?.id,
          entity_label: `${result?.first_name || ''} ${result?.last_name || ''}`.trim() || 'Person',
          ...(auth.source ? { source: auth.source } : {}),
        },
      });
    } catch (e) {
      logger.error({ err: e }, 'Failed to log create person activity');
    }
    try {
      await queueZapierTrigger(
        this.personsRepo.db,
        auth.tenant_id,
        'person_created',
        pickPersonFields(result as Record<string, unknown>),
      );
    } catch (e) {
      logger.error({ err: e }, '[Zapier] Failed to queue person_created trigger');
    }
    return result;
  }

  public async updatePerson(id: string, data: UpdatePersonsType, auth: IAuthKeyPayload) {
    // Enforce email uniqueness within the tenant (excluding the person being updated)
    const emailToCheck = data.email?.trim();
    if (emailToCheck) {
      const existing = await this.personsRepo.findByEmail({ tenant_id: auth.tenant_id, email: emailToCheck });
      if (existing && String(existing.id) !== String(id)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `A person with the email "${emailToCheck}" already exists.`,
        });
      }
    }

    let original: Record<string, unknown> | null = null;
    try {
      original = ((await this.personsRepo.getOneBy('id', { value: id, tenant_id: auth.tenant_id })) ?? null) as Record<
        string,
        unknown
      > | null;
    } catch (err) {
      logger.error({ err }, 'Failed to fetch original person record for activity log');
    }
    const result = await this.personsRepo.update({
      tenant_id: auth.tenant_id,
      id,
      row: {
        ...data,
        updatedby_id: auth.user_id,
      } as OperationDataType<'persons', 'update'>,
    });
    if (result && typeof result === 'object') {
      const updatedPerson = result as Record<string, unknown>;
      if (data.assigned_to !== undefined && original && String(data.assigned_to) !== String(original['assigned_to'])) {
        const newAssigneeId = data.assigned_to;
        if (newAssigneeId) {
          try {
            // String conversion ensures precision is maintained down to the database driver level
            const assigneeId = String(newAssigneeId);
            const assignee = await this.personsRepo.db
              .selectFrom('authusers')
              .leftJoin('profiles', 'profiles.auth_id', 'authusers.id')
              .select(['authusers.email', 'authusers.first_name', 'profiles.preferences as profile_preferences'])
              .where('authusers.id', '=', assigneeId)
              .executeTakeFirst();

            if (assignee) {
              const personName =
                `${updatedPerson['first_name'] || ''} ${updatedPerson['last_name'] || ''}`.trim() || 'unnamed contact';
              const link = `${env.appUrl}/persons/${updatedPerson['id']}`;
              if (notificationEnabled(assignee.profile_preferences, 'person_assigned_in_app')) {
                const notificationsRepo = new NotificationsRepo();
                await notificationsRepo.pushNotification({
                  tenant_id: auth.tenant_id,
                  user_id: assigneeId,
                  title: 'Contact Assigned',
                  message: `You have been assigned ownership of the contact: "${personName}"`,
                  type: 'person',
                  link: `/persons/${updatedPerson['id']}`,
                });
              }
              if (assignee.email && notificationEnabled(assignee.profile_preferences, 'person_assigned')) {
                const mailService = new TransactionalEmailService();
                await mailService.sendMail({
                  to: assignee.email,
                  subject: `Contact assigned to you: ${personName}`,
                  notificationSettingsLink: true,
                  text: `Hi ${assignee.first_name},\n\n${auth.name} assigned you ownership of the contact ${personName}.\n\nContact details:\nEmail: ${updatedPerson['email'] || 'None'}\nPhone: ${updatedPerson['mobile'] || updatedPerson['home_phone'] || 'None'}\n\nView the contact: ${link}`,
                  html: `<h2>Contact assigned to you</h2>
<p>Hi ${assignee.first_name},</p>
<p>${auth.name} assigned you ownership of the contact <strong>${personName}</strong>.</p>
<div class="panel"><p><strong>Email:</strong> ${updatedPerson['email'] || 'None'}</p><p><strong>Phone:</strong> ${updatedPerson['mobile'] || updatedPerson['home_phone'] || 'None'}</p></div>
<div class="btn-container">
  <a href="${link}" class="btn">View contact</a>
</div>`,
                });
              }
            }
          } catch (mailErr) {
            logger.error({ err: mailErr }, 'Failed to process contact assignment alert/notification in updatePerson');
          }
        }
      }
    }
    try {
      const changes: Record<string, unknown> = {};
      const resultObj = result && typeof result === 'object' ? (result as Record<string, unknown>) : null;
      if (original && resultObj) {
        const skipKeys = ['id', 'tenant_id', 'createdby_id', 'updatedby_id', 'created_at', 'updated_at'];
        for (const key of Object.keys(data)) {
          if (skipKeys.includes(key)) continue;
          const oldVal = (original as Record<string, unknown>)[key];
          const newVal = resultObj[key];
          if (oldVal !== newVal) {
            changes[key] = { from: oldVal ?? null, to: newVal ?? null };
          }
        }
      }
      await this.userActivity.log({
        tenant_id: auth.tenant_id,
        user_id: auth.user_id,
        activity: 'update',
        entity: 'persons',
        entity_id: id ? String(id) : null,
        quantity: 1,
        metadata: {
          id,
          entity_label: resultObj
            ? `${resultObj['first_name'] || ''} ${resultObj['last_name'] || ''}`.trim() || 'Person'
            : 'Person',
          changes,
          ...(auth.source ? { source: auth.source } : {}),
        },
      });
    } catch (e) {
      logger.error({ err: e }, 'Failed to log update person activity');
    }
    try {
      await queueZapierTrigger(
        this.personsRepo.db,
        auth.tenant_id,
        'person_updated',
        pickPersonFields(result as Record<string, unknown>),
      );
    } catch (e) {
      logger.error({ err: e }, '[Zapier] Failed to queue person_updated trigger');
    }
    return result;
  }

  private stripHtmlAndTruncate(html: string | null | undefined, limit = 160): string {
    if (!html) return '';
    const text = html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (text.length <= limit) return text;
    return text.substring(0, limit) + '...';
  }

  public async getPersonActivity(person_id: string, auth: IAuthKeyPayload) {
    const person = (await this.personsRepo.getOneBy('id', { value: person_id, tenant_id: auth.tenant_id })) as Record<
      string,
      unknown
    > | null;
    if (!person) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Person not found',
      });
    }

    const emails: string[] = [];
    if (person['email']) emails.push((person['email'] as string).trim().toLowerCase());
    if (person['email2']) emails.push((person['email2'] as string).trim().toLowerCase());

    if (emails.length === 0) {
      return {
        emails: [],
        newsletters: [],
      };
    }

    const db = this.personsRepo.db;

    // 1. Fetch email conversations (sent and received)
    const conversations = await db
      .selectFrom('emails')
      .leftJoin('email_bodies', 'email_bodies.email_id', 'emails.id')
      .selectAll('emails')
      .select('email_bodies.body_html as body_html')
      .where('emails.tenant_id', '=', auth.tenant_id)
      // Recipient match goes through email_recipients — the source of truth.
      // emails.to_email is a display-only cache holding a joined "a, b" string,
      // so an exact IN match would miss multi-recipient emails (D-10).
      .where((eb) =>
        eb.or([
          eb('emails.from_email', 'in', emails),
          eb.exists(
            eb
              .selectFrom('email_recipients')
              .select('email_recipients.id')
              .whereRef('email_recipients.email_id', '=', 'emails.id')
              .where('email_recipients.tenant_id', '=', auth.tenant_id)
              .where((inner) => inner(inner.fn<string>('lower', ['email_recipients.email']), 'in', emails)),
          ),
        ]),
      )
      .orderBy('emails.created_at', 'desc')
      .limit(50)
      .execute();

    // 2. Fetch newsletter events (received, opened, clicked links, etc.)
    const newsletterEvents = await db
      .selectFrom('newsletter_events')
      .innerJoin('newsletters', 'newsletters.id', 'newsletter_events.newsletter_id')
      .select([
        'newsletter_events.id',
        'newsletter_events.event_type',
        'newsletter_events.timestamp',
        'newsletter_events.url',
        'newsletters.subject as newsletter_subject',
        'newsletters.name as newsletter_name',
      ])
      .where('newsletter_events.tenant_id', '=', auth.tenant_id)
      .where('newsletter_events.email', 'in', emails)
      .orderBy('newsletter_events.timestamp', 'desc')
      .limit(100)
      .execute();

    return {
      emails: conversations.map((mail) => {
        let snippet = '';
        if (mail.body_html) {
          snippet = this.stripHtmlAndTruncate(mail.body_html, 160);
        }
        if (!snippet && mail.preview && !/^(ms|google):/i.test(mail.preview)) {
          snippet = mail.preview;
        }
        return {
          ...mail,
          preview: snippet,
        };
      }),
      newsletters: newsletterEvents,
    };
  }

  public async attachTag(person_id: string, name: string, type: 'tag' | 'issue' = 'tag', auth: IAuthKeyPayload) {
    const randomHexColor = () =>
      '#' +
      Math.floor(Math.random() * 0xffffff)
        .toString(16)
        .padStart(6, '0');
    const row = {
      name,
      color: randomHexColor(),
      tenant_id: auth.tenant_id,
      createdby_id: auth.user_id,
      updatedby_id: auth.user_id,
      type,
    };

    const tag = await this.tagsRepo.addOrGet({
      row: row as OperationDataType<'tags', 'insert'>,
      onConflictColumn: 'name',
    });

    const result = await this.addToMap({
      tag_id: tag?.id as string | undefined,
      person_id,
      tenant_id: auth.tenant_id,
      createdby_id: auth.user_id,
      updatedby_id: auth.user_id,
    });

    if (result && tag?.id) {
      try {
        const workflowsController = new WorkflowsController();
        await workflowsController.triggerTagAdded(auth.tenant_id, person_id, String(tag.id), name);
      } catch (err) {
        logger.error({ err }, 'Failed to trigger tag_added workflow');
      }
    }

    try {
      await this.userActivity.log({
        tenant_id: auth.tenant_id,
        user_id: auth.user_id,
        activity: 'update',
        entity: 'persons',
        entity_id: person_id,
        quantity: 1,
        metadata: { id: person_id, action: `attach_${type}`, name, ...(auth.source ? { source: auth.source } : {}) },
      });
    } catch (e) {
      logger.error({ err: e }, 'Failed to log attach tag activity');
    }
    try {
      await queueZapierTrigger(this.personsRepo.db, auth.tenant_id, 'person_tag_added', {
        person_id,
        tag_name: name,
        tag_type: type,
      });
    } catch (e) {
      logger.error({ err: e }, '[Zapier] Failed to queue person_tag_added trigger');
    }

    return result;
  }

  public async detachTag(input: {
    tenant_id: string;
    person_id: string;
    name: string;
    type?: 'tag' | 'issue';
    user_id?: string;
    source?: string;
  }) {
    const tag = await this.tagsRepo.getIdByName({
      tenant_id: input.tenant_id,
      name: input.name,
      type: input.type ?? 'tag',
    });

    if (tag?.id) {
      await this.mapPersonsTagRepo.deleteMapping({
        tenant_id: input.tenant_id,
        person_id: input.person_id,
        tag_id: tag.id,
      });
    }

    try {
      if (input.user_id) {
        await this.userActivity.log({
          tenant_id: input.tenant_id,
          user_id: input.user_id,
          activity: 'update',
          entity: 'persons',
          entity_id: input.person_id,
          quantity: 1,
          metadata: {
            id: input.person_id,
            action: `detach_${input.type ?? 'tag'}`,
            name: input.name,
            ...(input.source ? { source: input.source } : {}),
          },
        });
      }
    } catch (e) {
      logger.error({ err: e }, 'Failed to log detach tag activity');
    }
    try {
      await queueZapierTrigger(this.personsRepo.db, input.tenant_id, 'person_tag_removed', {
        person_id: input.person_id,
        tag_name: input.name,
        tag_type: input.type ?? 'tag',
      });
    } catch (e) {
      logger.error({ err: e }, '[Zapier] Failed to queue person_tag_removed trigger');
    }

    const isVolunteerTag = input.name.trim().toLowerCase() === 'volunteer';
    if (!isVolunteerTag) {
      return { removed_team_ids: [], removed_teams: [] };
    }

    const teams = await this.mapTeamsPersonsRepo.getTeamsForPerson({
      tenant_id: input.tenant_id,
      person_id: input.person_id,
    });

    if (!teams.length) {
      return { removed_team_ids: [], removed_teams: [] };
    }

    await this.mapTeamsPersonsRepo.deleteByPerson({ tenant_id: input.tenant_id, person_id: input.person_id });

    for (const team of teams) {
      if (team.is_captain && team.team_id) {
        await this.teamsRepo.clearCaptain({ tenant_id: input.tenant_id, team_id: team.team_id });
      }
    }

    const removedTeams = teams
      .filter((team) => team.team_id)
      .map((team) => ({
        id: team.team_id,
        name: team.team_name ?? '',
        was_captain: team.is_captain,
      }));

    return {
      removed_team_ids: removedTeams.map((team) => team.id),
      removed_teams: removedTeams,
    };
  }

  public async importRows(
    input: {
      rows: Array<{
        first_name?: string;
        middle_names?: string;
        last_name?: string;
        email?: string;
        email2?: string;
        mobile?: string;
        notes?: string;
        home_phone?: string;
        street_num?: string;
        street1?: string;
        street2?: string;
        apt?: string;
        city?: string;
        state?: string;
        zip?: string;
        country?: string;
        company?: string;
        tags?: string;
      }>;
      tags?: string[];
      skipped?: number;
      file_name?: string | null;
      duplicate_decision?: 'merge' | 'skip' | 'import_new';
      list_name?: string;
      /** Raw uploaded CSV text, kept 90 days so the History page can offer a re-download (spec §17). */
      source_csv?: string;
      /** Rows the wizard already excluded/cleaned client-side (bad-email "Skip"), recorded for History's skip-reasons export. */
      client_skip_reasons?: Array<{ row: number; email?: string; reason: string }>;
    },
    auth: IAuthKeyPayload,
  ) {
    const campaign_id = (await this.settingsController.getCurrentCampaignId(auth)) as string;
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const autoTag = `Imported-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;

    const tags = [...(input.tags ?? []), autoTag].filter((t) => !!t && t.trim().length > 0);
    const skippedFromClient = Math.max(0, Math.floor(input.skipped ?? 0));
    const requestedFileName = (input.file_name ?? '').trim();
    const baseFileName = requestedFileName || `${autoTag}.csv`;
    const totalRows = input.rows.length + skippedFromClient;

    let hasImportableRow = false;
    for (const candidate of input.rows) {
      const sanitized = this.sanitizeRow(candidate);
      if (sanitized.first_name || sanitized.last_name || sanitized.email || sanitized.mobile || sanitized.notes) {
        hasImportableRow = true;
        break;
      }
    }

    if (!hasImportableRow) {
      const totalSkipped = skippedFromClient + input.rows.length;
      const personsBefore = await this.personsRepo.count(auth.tenant_id);
      return {
        inserted: 0,
        errors: 0,
        skipped: totalSkipped,
        tag: null,
        file_name: requestedFileName || null,
        import_id: null,
        tenant_id: auth.tenant_id,
        campaign_id,
        persons_total_after: personsBefore,
        persons_total_before: personsBefore,
        status: 'completed',
      };
    }

    const importRow = {
      tenant_id: auth.tenant_id,
      createdby_id: auth.user_id,
      updatedby_id: auth.user_id,
      file_name: baseFileName,
      source: 'persons',
      tag_name: autoTag,
      tag_id: null,
      row_count: totalRows,
      inserted_count: 0,
      error_count: 0,
      skipped_count: skippedFromClient,
      households_created: 0,
      status: 'pending',
      metadata: null,
      processed_at: now,
    } as OperationDataType<'data_imports', 'insert'>;

    const savedImport = await this.importsRepo.add({ row: importRow });
    if (!savedImport || !savedImport.id) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to create data import record',
      });
    }

    const importRecordId = String(savedImport.id);
    const storageKey = `imports/payloads/${auth.tenant_id}/${importRecordId}.json`;

    try {
      const payloadBuffer = Buffer.from(JSON.stringify(input.rows), 'utf8');
      await this.storageService.upload(storageKey, payloadBuffer, 'application/json');
    } catch (err) {
      logger.error({ err }, 'Failed to upload import payload to storage');
      await this.importsRepo.delete({ tenant_id: auth.tenant_id, id: importRecordId });
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to store import payload on server storage',
      });
    }

    // Keep the original upload downloadable for 90 days (spec §17 History
    // page footer). Best-effort: a failure here shouldn't fail the import.
    let sourceFileKey: string | null = null;
    let sourceFileSize: number | null = null;
    if (input.source_csv) {
      try {
        const sourceBuffer = Buffer.from(input.source_csv, 'utf8');
        sourceFileKey = `imports/source/${auth.tenant_id}/${importRecordId}.csv`;
        sourceFileSize = sourceBuffer.byteLength;
        await this.storageService.upload(sourceFileKey, sourceBuffer, 'text/csv');
      } catch (err) {
        logger.error({ err }, 'Failed to retain original CSV upload for the import history page');
        sourceFileKey = null;
        sourceFileSize = null;
      }
    }

    await this.importsRepo.update({
      tenant_id: auth.tenant_id,
      id: importRecordId,
      row: {
        metadata: JSON.stringify({ storage_key: storageKey }),
        source_file_key: sourceFileKey,
        source_file_size: sourceFileSize,
      },
    });

    await this.importsRepo.db
      .insertInto('background_jobs')
      .values({
        tenant_id: auth.tenant_id,
        queue: 'default',
        status: 'pending',
        payload: JSON.stringify({
          import_id: importRecordId,
          storage_key: storageKey,
          tags,
          skipped: skippedFromClient,
          campaign_id,
          tenant_id: auth.tenant_id,
          user_id: auth.user_id,
          file_name: baseFileName,
          duplicate_decision: input.duplicate_decision ?? 'skip',
          list_name: input.list_name ?? null,
          client_skip_reasons: input.client_skip_reasons ?? [],
        }),
        run_at: new Date(),
      })
      .execute();

    return {
      inserted: 0,
      errors: 0,
      skipped: skippedFromClient,
      tag: autoTag,
      file_name: baseFileName,
      import_id: importRecordId,
      tenant_id: auth.tenant_id,
      campaign_id,
      status: 'pending',
    };
  }

  public async processImportRows(
    import_id: string,
    tenant_id: string,
    user_id: string,
    campaign_id: string,
    tags: string[],
    skipped: number,
    rows: Record<string, string>[],
    options?: {
      duplicateDecision?: 'merge' | 'skip' | 'import_new';
      listName?: string;
      clientSkipReasons?: Array<{ row: number; email?: string; reason: string }>;
    },
  ) {
    const households = new HouseholdRepo();
    const duplicateDecision = options?.duplicateDecision ?? 'skip';
    const results: {
      inserted: number;
      errors: number;
      households_created: number;
      skipped: number;
      merged: number;
    } = {
      inserted: 0,
      errors: 0,
      households_created: 0,
      skipped: 0,
      merged: 0,
    };
    const importedPersonIds: string[] = [];
    // Rows kept downloadable with the reason each was skipped (History page, spec §17) —
    // seeded with the wizard's own client-side skips (bad-email "Skip"), then appended to below.
    const skipReasons: Array<{ row: number; email?: string; reason: string }> = [...(options?.clientSkipReasons ?? [])];

    const errorMessages: string[] = [];
    let cachedBlankHouseholdId: string | null = null;
    // Companies resolved so far, keyed by lower(name) — merged from each chunk's
    // transaction only after it commits, so a rolled-back create is never reused.
    const companyIdByName = new Map<string, string>();
    let autoTagId: string | null = null;
    const autoTag = tags.find((t) => t.startsWith('Imported-')) || tags[0];

    const chunkSize = 100;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);

      // 1. Sanitize and classify all valid rows in the chunk upfront
      type ValidEntry = {
        sanitized: {
          first_name?: string;
          middle_names?: string;
          last_name?: string;
          email?: string;
          email2?: string;
          mobile?: string;
          notes?: string;
          home_phone?: string;
          street_num?: string;
          street1?: string;
          street2?: string;
          apt?: string;
          city?: string;
          state?: string;
          zip?: string;
          country?: string;
          company?: string;
          tags: string[];
        };
        isBlankAddress: boolean;
        fp_street: string | null;
        fp_full: string | null;
        rowNumber: number;
      };
      const SKIP_REASONS_CAP = 500;
      const validEntries: ValidEntry[] = [];
      for (const [chunkIdx, raw] of chunk.entries()) {
        const rowNumber = i + chunkIdx + 1;
        const sanitized = this.sanitizeRow(raw);
        if (
          !sanitized.first_name &&
          !sanitized.last_name &&
          !sanitized.email &&
          !sanitized.mobile &&
          !sanitized.notes
        ) {
          results.skipped += 1;
          if (skipReasons.length < SKIP_REASONS_CAP) {
            skipReasons.push({ row: rowNumber, reason: 'Blank row: no importable fields' });
          }
          continue;
        }
        const isBlankAddress =
          !sanitized.home_phone &&
          !sanitized.street_num &&
          !sanitized.street1 &&
          !sanitized.street2 &&
          !sanitized.apt &&
          !sanitized.city &&
          !sanitized.state &&
          !sanitized.zip &&
          !sanitized.country;
        validEntries.push({
          sanitized,
          isBlankAddress,
          fp_street: isBlankAddress
            ? null
            : fingerprintStreet({
                street_num: sanitized.street_num,
                street1: sanitized.street1,
                street2: sanitized.street2,
              }),
          fp_full: isBlankAddress
            ? null
            : fingerprintFull({
                apt: sanitized.apt,
                street_num: sanitized.street_num,
                street1: sanitized.street1,
                street2: sanitized.street2,
                city: sanitized.city,
                state: sanitized.state,
                zip: sanitized.zip,
                country: sanitized.country,
              }),
          rowNumber,
        });
      }

      if (validEntries.length === 0) {
        await this.importsRepo.update({
          tenant_id: tenant_id,
          id: import_id,
          row: {
            tag_id: autoTagId,
            inserted_count: results.inserted,
            error_count: results.errors,
            skipped_count: skipped + results.skipped,
            households_created: results.households_created,
            updatedby_id: user_id,
            updated_at: new Date(),
          },
        });
        continue;
      }

      try {
        const outcome = await this.personsRepo.transaction().execute(async (trx) => {
          let localBlankHouseholdId = cachedBlankHouseholdId;
          let localAutoTagId = autoTagId;
          let householdsCreatedDelta = 0;

          // 2a. Resolve blank household once for the whole chunk
          if (validEntries.some((e) => e.isBlankAddress)) {
            if (!localBlankHouseholdId) {
              const existingBlank = await households.getBlankHousehold({ tenant_id }, trx);
              if (existingBlank?.id) {
                localBlankHouseholdId = String(existingBlank.id);
              } else {
                const created = await households.add(
                  {
                    row: {
                      tenant_id,
                      campaign_id,
                      createdby_id: user_id,
                      updatedby_id: user_id,
                      file_id: import_id,
                    } as OperationDataType<'households', 'insert'>,
                  },
                  trx,
                );
                localBlankHouseholdId = String(created?.id);
                householdsCreatedDelta += 1;
              }
            }
          }

          // 2b. Batch-resolve addressed households with a single IN query
          const fpCache = new Map<string, string>(); // fp_full -> household_id
          const uniqueFps = [
            ...new Set(validEntries.filter((e) => !e.isBlankAddress && e.fp_full).map((e) => e.fp_full as string)),
          ];
          if (uniqueFps.length > 0) {
            const existingHouseholds = await trx
              .selectFrom('households')
              .select(['id', 'address_fp_full'])
              .where('tenant_id', '=', tenant_id)
              .where('address_fp_full', 'in', uniqueFps)
              .execute();
            for (const h of existingHouseholds) {
              if (h.address_fp_full) fpCache.set(h.address_fp_full, String(h.id));
            }
          }

          // 2c. Create only missing households (deduplicated within this chunk)
          for (const entry of validEntries) {
            if (entry.isBlankAddress || !entry.fp_full) continue;
            if (fpCache.has(entry.fp_full)) continue;
            const { sanitized, fp_street, fp_full } = entry;
            const hhRow = {
              tenant_id,
              campaign_id,
              createdby_id: user_id,
              updatedby_id: user_id,
              home_phone: sanitized.home_phone ?? null,
              street_num: sanitized.street_num ?? null,
              street1: sanitized.street1 ?? null,
              street2: sanitized.street2 ?? null,
              apt: sanitized.apt ?? null,
              city: sanitized.city ?? null,
              state: sanitized.state ?? null,
              zip: sanitized.zip ?? null,
              country: sanitized.country ?? null,
              address_fp_street: fp_street,
              address_fp_full: fp_full,
              notes: null,
              file_id: import_id,
            } as OperationDataType<'households', 'insert'>;
            const household = await households.add({ row: hhRow }, trx);
            fpCache.set(fp_full, String(household?.id));
            householdsCreatedDelta += 1;
          }

          // 2c'. Resolve companies by case-insensitive name: one IN query for the
          // chunk's unmatched names, then create whatever is still missing —
          // attributed to this import via file_id so deleting the import can
          // clean them up. Kept in a chunk-local map and merged into the outer
          // cache only after commit.
          const localCompanyIdByName = new Map<string, string>(companyIdByName);
          const chunkCompanyNames = new Map<string, string>(); // lower(name) -> original casing
          for (const entry of validEntries) {
            const name = entry.sanitized.company;
            if (name && !localCompanyIdByName.has(name.toLowerCase())) {
              if (!chunkCompanyNames.has(name.toLowerCase())) chunkCompanyNames.set(name.toLowerCase(), name);
            }
          }
          if (chunkCompanyNames.size > 0) {
            const existingCompanies = await trx
              .selectFrom('companies')
              .select(['id', 'name'])
              .where('tenant_id', '=', tenant_id)
              .where(sql`lower(name)`, 'in', [...chunkCompanyNames.keys()])
              .execute();
            for (const c of existingCompanies) {
              localCompanyIdByName.set(c.name.toLowerCase(), String(c.id));
            }
            for (const [lowerName, name] of chunkCompanyNames) {
              if (localCompanyIdByName.has(lowerName)) continue;
              const created = await trx
                .insertInto('companies')
                .values({
                  tenant_id,
                  createdby_id: user_id,
                  updatedby_id: user_id,
                  name,
                  file_id: import_id,
                } as OperationDataType<'companies', 'insert'>)
                .returning('id')
                .executeTakeFirst();
              if (created?.id) localCompanyIdByName.set(lowerName, String(created.id));
            }
          }
          const companyIdFor = (entry: (typeof validEntries)[number]): string | null => {
            const name = entry.sanitized.company;
            return name ? (localCompanyIdByName.get(name.toLowerCase()) ?? null) : null;
          };

          // 2d. Duplicate-email resolution (spec §17 Review step — a single
          // decision governs every row whose email matches a person that
          // already exists; email is the match key app-wide, same as
          // Duplicates and Forms).
          //  - 'skip' (default): exclude the row; counted + reasoned below.
          //  - 'merge': fill the existing person's blank fields from the row
          //    (never overwrite), don't insert a second person.
          //  - 'import_new': insert as a brand-new person anyway; the email
          //    is cleared first so it can't collide with the unique
          //    (tenant_id, lower(email)) index — the row becomes a
          //    name-only duplicate for the Duplicates page to reconcile.
          const mergeEntries: Array<{ entry: (typeof validEntries)[number]; personId: string }> = [];
          const insertEntries: typeof validEntries = [];
          const candidateEmails = [
            ...new Set(validEntries.map((e) => e.sanitized.email).filter((email): email is string => !!email)),
          ];
          const existingByEmail = new Map<string, { id: string }>();
          if (candidateEmails.length > 0) {
            const existing = await trx
              .selectFrom('persons')
              .select(['id', 'email'])
              .where('tenant_id', '=', tenant_id)
              .where(
                sql`lower(email)`,
                'in',
                candidateEmails.map((email) => email.toLowerCase()),
              )
              .execute();
            for (const p of existing) {
              if (p.email) existingByEmail.set(p.email.toLowerCase(), { id: String(p.id) });
            }
          }

          for (const entry of validEntries) {
            const match = entry.sanitized.email ? existingByEmail.get(entry.sanitized.email.toLowerCase()) : null;
            if (!match) {
              insertEntries.push(entry);
              continue;
            }
            if (duplicateDecision === 'merge') {
              mergeEntries.push({ entry, personId: match.id });
            } else if (duplicateDecision === 'import_new') {
              // Keep the row, but the email must go so the insert doesn't
              // collide with the existing person's email.
              insertEntries.push({ ...entry, sanitized: { ...entry.sanitized, email: undefined } });
            } else {
              results.skipped += 1;
              if (skipReasons.length < SKIP_REASONS_CAP) {
                skipReasons.push({
                  row: entry.rowNumber,
                  email: entry.sanitized.email,
                  reason: 'Matches a person you already have. Duplicate decision was Skip',
                });
              }
            }
          }

          // 3. Batch insert all persons in one statement
          const personRows = insertEntries.map((entry) => {
            const { sanitized, isBlankAddress, fp_full } = entry;
            return {
              tenant_id,
              campaign_id,
              createdby_id: user_id,
              updatedby_id: user_id,
              household_id: isBlankAddress ? (localBlankHouseholdId ?? '') : (fpCache.get(fp_full ?? '') ?? ''),
              first_name: sanitized.first_name ?? null,
              middle_names: sanitized.middle_names ?? null,
              last_name: sanitized.last_name ?? null,
              email: sanitized.email ?? null,
              email2: sanitized.email2 ?? null,
              mobile: sanitized.mobile ?? null,
              home_phone: null,
              company_id: companyIdFor(entry),
              file_id: import_id,
              notes: sanitized.notes ?? null,
            };
          });
          const insertedPersons = personRows.length
            ? await trx
                .insertInto('persons')
                .values(personRows)
                .onConflict((oc) => oc.doNothing())
                .returningAll()
                .execute()
            : [];

          // Count rows silently skipped due to a duplicate email under the 'skip' decision
          const duplicatesSkipped = personRows.length - insertedPersons.length;
          if (duplicatesSkipped > 0) results.skipped += duplicatesSkipped;

          // 3b. Merge decision: fill only the existing person's blank fields — never overwrite.
          const mergedPersonIds: string[] = [];
          for (const { entry, personId } of mergeEntries) {
            await trx
              .updateTable('persons')
              .set({
                first_name: sql`COALESCE(persons.first_name, ${entry.sanitized.first_name ?? null})`,
                middle_names: sql`COALESCE(persons.middle_names, ${entry.sanitized.middle_names ?? null})`,
                last_name: sql`COALESCE(persons.last_name, ${entry.sanitized.last_name ?? null})`,
                email2: sql`COALESCE(persons.email2, ${entry.sanitized.email2 ?? null})`,
                mobile: sql`COALESCE(persons.mobile, ${entry.sanitized.mobile ?? null})`,
                company_id: sql`COALESCE(persons.company_id, ${companyIdFor(entry)})`,
                notes: sql`COALESCE(persons.notes, ${entry.sanitized.notes ?? null})`,
                updated_at: sql`now()`,
                updatedby_id: user_id,
              })
              .where('tenant_id', '=', tenant_id)
              .where('id', '=', personId)
              .execute();
            mergedPersonIds.push(personId);
          }
          results.merged += mergedPersonIds.length;

          // 4. Upsert each unique tag name exactly once (not once per row) —
          // the batch-level tags plus every name from a mapped Tags column,
          // deduplicated case-insensitively (first casing wins).
          const uniqueTagNames = new Map<string, string>(); // lower(name) -> original casing
          for (const name of [...tags, ...validEntries.flatMap((e) => e.sanitized.tags)]) {
            if (!uniqueTagNames.has(name.toLowerCase())) uniqueTagNames.set(name.toLowerCase(), name);
          }
          const tagIdByLowerName = new Map<string, string>();
          const tagRecords: Array<{ name: string; id: string }> = [];
          for (const name of uniqueTagNames.values()) {
            const row = {
              name,
              tenant_id,
              createdby_id: user_id,
              updatedby_id: user_id,
            } as OperationDataType<'tags', 'insert'>;
            const tag = await this.tagsRepo.addOrGet({ row, onConflictColumn: 'name' }, trx);
            if (name === autoTag && tag?.id != null && !localAutoTagId) localAutoTagId = String(tag.id);
            if (tag?.id) {
              tagRecords.push({ name, id: String(tag.id) });
              tagIdByLowerName.set(name.toLowerCase(), String(tag.id));
            }
          }

          // 5. Work out which tags each person gets: every batch-level tag,
          // plus the row's own Tags-column names. Inserted persons are paired
          // back to their source rows by position when the insert dropped
          // nothing; if onConflict(doNothing) dropped rows the positions no
          // longer line up, so fall back to email pairing (rows that can't be
          // paired still get the batch-level tags).
          const batchTagRecords = tagRecords.filter((t) => tags.some((n) => n.toLowerCase() === t.name.toLowerCase()));
          const rowTagRecords = (
            entry: (typeof validEntries)[number] | undefined,
          ): Array<{ name: string; id: string }> => {
            if (!entry) return batchTagRecords;
            const names = new Set([...tags, ...entry.sanitized.tags].map((n) => n.toLowerCase()));
            return tagRecords.filter((t) => names.has(t.name.toLowerCase()));
          };

          const personTags = new Map<string, Array<{ name: string; id: string }>>();
          if (insertedPersons.length === insertEntries.length) {
            insertedPersons.forEach((p, idx) => personTags.set(String(p.id), rowTagRecords(insertEntries[idx])));
          } else {
            const entryByEmail = new Map(
              insertEntries
                .filter((e) => e.sanitized.email)
                .map((e) => [(e.sanitized.email as string).toLowerCase(), e] as const),
            );
            for (const p of insertedPersons) {
              const entry = p.email ? entryByEmail.get(String(p.email).toLowerCase()) : undefined;
              personTags.set(String(p.id), rowTagRecords(entry));
            }
          }
          for (const { entry, personId } of mergeEntries) {
            personTags.set(personId, rowTagRecords(entry));
          }

          const tagMapRows = [...personTags.entries()].flatMap(([person_id, records]) =>
            records.map(({ id: tag_id }) => ({
              tenant_id,
              person_id,
              tag_id: tag_id as unknown as string,
              createdby_id: user_id,
              updatedby_id: user_id,
            })),
          );
          if (tagMapRows.length > 0) {
            // Merged persons may already carry a tag from an earlier import — don't fail the batch on that.
            await trx
              .insertInto('map_peoples_tags')
              .values(tagMapRows)
              .onConflict((oc) => oc.doNothing())
              .execute();
          }

          return {
            insertedPersons,
            mergedPersonIds,
            personTags,
            householdsCreatedDelta,
            blankHouseholdId: localBlankHouseholdId,
            companyIdByName: localCompanyIdByName,
            autoTagId: localAutoTagId,
          };
        });

        // 6. Trigger workflows outside the transaction (fire-and-forget per person)
        const workflowsController = new WorkflowsController();
        for (const person of outcome.insertedPersons) {
          const personId = String(person.id);
          importedPersonIds.push(personId);
          try {
            await workflowsController.triggerWorkflow(tenant_id, personId, 'contact_created', null);
          } catch (err) {
            logger.error({ err }, 'Failed to trigger contact_created workflow in CSV import');
          }
          for (const { name, id: tagId } of outcome.personTags.get(personId) ?? []) {
            try {
              await workflowsController.triggerTagAdded(tenant_id, personId, tagId, name);
            } catch (err) {
              logger.error({ err }, 'Failed to trigger tag_added workflow in CSV import');
            }
          }
        }
        // Merged persons aren't new contacts — only the tag_added workflow applies, and
        // they still belong in the static-list membership pass below.
        for (const personId of outcome.mergedPersonIds) {
          importedPersonIds.push(personId);
          for (const { name, id: tagId } of outcome.personTags.get(personId) ?? []) {
            try {
              await workflowsController.triggerTagAdded(tenant_id, personId, tagId, name);
            } catch (err) {
              logger.error({ err }, 'Failed to trigger tag_added workflow after CSV import merge');
            }
          }
        }

        results.inserted += outcome.insertedPersons.length;
        results.households_created += outcome.householdsCreatedDelta;
        if (outcome.blankHouseholdId) cachedBlankHouseholdId = outcome.blankHouseholdId;
        for (const [lowerName, companyId] of outcome.companyIdByName) companyIdByName.set(lowerName, companyId);
        if (!autoTagId && outcome.autoTagId) autoTagId = outcome.autoTagId;
      } catch (err: unknown) {
        // If the chunk transaction fails, count all valid rows in the chunk as errors
        results.errors += validEntries.length;
        const message = err instanceof Error ? err.message : String(err);
        errorMessages.push(message);
        logger.error({ err, message }, 'Import chunk failed');
      }

      // Update intermediate counts after each chunk
      await this.importsRepo.update({
        tenant_id: tenant_id,
        id: import_id,
        row: {
          tag_id: autoTagId,
          inserted_count: results.inserted,
          error_count: results.errors,
          skipped_count: skipped + results.skipped,
          merged_count: results.merged,
          households_created: results.households_created,
          updatedby_id: user_id,
          updated_at: new Date(),
        },
      });
    }

    // Add every imported (and merged-into) person to a static list, creating
    // it if it doesn't already exist by that exact name (spec §17 "add
    // everyone to a static list"). This runs here — not as a public
    // lists.addMembers endpoint — because processImportRows is the only
    // place that knows the final set of person ids; see pplcrm-forms-style
    // note in the wizard skill for why no new public list-membership API
    // was added for this track.
    if (options?.listName && importedPersonIds.length > 0) {
      try {
        await this.addImportedPersonsToStaticList(tenant_id, user_id, options.listName, importedPersonIds);
      } catch (err) {
        logger.error({ err }, 'Failed to add imported people to the requested static list');
      }
    }

    // Bulk-inserted rows get their identifiers in one set-based pass (spec §1):
    // persons get an opaque public_id + display slug, households a name slug.
    try {
      await backfillPersonPublicIds(this.personsRepo.db, tenant_id);
      await backfillMissingSlugs(this.personsRepo.db, 'households', tenant_id);
      await backfillMissingSlugs(this.personsRepo.db, 'companies', tenant_id);
    } catch (err) {
      logger.error({ err }, 'Failed to backfill record identifiers after import');
    }

    // Final History-page facts: every tag actually applied, and the reason
    // each skipped row was skipped (spec §17 — "skipped rows stay
    // downloadable with the reason each was skipped").
    try {
      await this.importsRepo.update({
        tenant_id,
        id: import_id,
        row: {
          merged_count: results.merged,
          tags_applied: JSON.stringify(tags),
          skip_reasons: JSON.stringify(skipReasons),
          updatedby_id: user_id,
          updated_at: new Date(),
        },
      });
    } catch (err) {
      logger.error({ err }, 'Failed to persist final import stats');
    }

    // Log the user activity
    try {
      await this.userActivity.log({
        tenant_id,
        user_id,
        activity: 'import',
        entity: 'persons',
        quantity: results.inserted,
        metadata: {
          rows_received: rows.length,
          tags_applied: tags.slice(0, 10),
          auto_tag: autoTag,
          households_created: results.households_created,
          errors: results.errors,
          skipped: skipped + results.skipped,
          import_id,
        },
      });
    } catch (e) {
      logger.error({ err: e }, 'Failed to log import activity');
    }

    if (importedPersonIds.length > 0) {
      try {
        const { queueUsageLimitCheck } = await import('../../billing/usage-limits');
        await queueUsageLimitCheck(tenant_id, this.personsRepo.db);
      } catch (err) {
        logger.error({ err }, 'Failed to queue duplicate maintenance job or usage check for imported persons');
      }
    }

    return {
      inserted: results.inserted,
      errors: results.errors,
      skipped: skipped + results.skipped,
      merged: results.merged,
      households_created: results.households_created,
      tag_id: autoTagId,
      errorMessages,
    };
  }

  /**
   * Find-or-create a static people list by exact, case-insensitive name and
   * add every given person id to it (spec §17 "add everyone to a static
   * list"). Runs inside the import job because that's the only place the
   * final imported/merged person ids are known — see the call site comment
   * in processImportRows.
   */
  private async addImportedPersonsToStaticList(
    tenant_id: string,
    user_id: string,
    listName: string,
    personIds: string[],
  ): Promise<void> {
    const trimmedName = listName.trim();
    if (!trimmedName) return;

    const existingList = await this.listsRepo.db
      .selectFrom('lists')
      .select(['id'])
      .where('tenant_id', '=', tenant_id)
      .where(sql`lower(name)`, '=', trimmedName.toLowerCase())
      .where('object', '=', 'people')
      .executeTakeFirst();

    let listId = existingList?.id != null ? String(existingList.id) : undefined;

    if (!listId) {
      const created = await this.listsRepo.add({
        row: {
          tenant_id,
          name: trimmedName,
          description: `Created by the CSV import wizard on ${new Date().toLocaleDateString()}.`,
          object: 'people',
          is_dynamic: false,
          definition: null,
          status: 'idle',
          createdby_id: user_id,
          updatedby_id: user_id,
        } as OperationDataType<'lists', 'insert'>,
      });
      if (created?.id != null) listId = String(created.id);
    }
    if (!listId) return;

    const uniqueIds = [...new Set(personIds)];
    const rows = uniqueIds.map((person_id) => ({
      tenant_id,
      list_id: listId as string,
      person_id,
      createdby_id: user_id,
      updatedby_id: user_id,
    })) as OperationDataType<'map_lists_persons', 'insert'>[];

    // A person may already belong to this list (e.g. re-running an import
    // into the same list) — the primary key is (tenant_id, list_id,
    // person_id), so skip rows that would collide instead of failing the batch.
    await this.mapListsPersonsRepo.db
      .insertInto('map_lists_persons')
      .values(rows)
      .onConflict((oc) => oc.columns(['tenant_id', 'list_id', 'person_id']).doNothing())
      .execute();
  }

  public async removeHousehold(person_id: string, auth: IAuthKeyPayload) {
    const campaign_id = (await this.settingsController.getCurrentCampaignId(auth)) as string;
    return this.personsRepo.moveToNewHousehold({
      tenant_id: auth.tenant_id,
      person_id,
      user_id: auth.user_id,
      campaign_id,
    });
  }

  public async getPotentialDuplicates(auth: IAuthKeyPayload, options?: { page?: number; pageSize?: number }) {
    return this.personsRepo.getPotentialDuplicates(auth.tenant_id, options);
  }

  /**
   * CSV import wizard Review step (spec §17) — email is the match key across
   * this app (Duplicates, Forms). Given the emails mapped from the uploaded
   * file, report which ones already belong to a person so the wizard can
   * render "N rows match people you already have" with a door to each match.
   */
  public async checkDuplicateEmails(auth: IAuthKeyPayload, emails: string[]) {
    const matches = await this.personsRepo.findManyByEmails({ tenant_id: auth.tenant_id, emails });
    return matches.map((match) => ({
      email: (match.email ?? '').toLowerCase(),
      person_id: String(match.id),
      name:
        [match.first_name, match.last_name]
          .filter((part) => !!part)
          .join(' ')
          .trim() || 'Unnamed person',
      slug: match.slug ?? null,
    }));
  }

  public async getDuplicateCounts(auth: IAuthKeyPayload) {
    const [people, households, companies] = await Promise.all([
      this.personsRepo.getDuplicateCount(auth.tenant_id),
      this.householdRepo.getDuplicateCount(auth.tenant_id),
      this.companiesRepo.getDuplicateCount(auth.tenant_id),
    ]);
    return { people, households, companies };
  }

  public async mergePersons(input: { target_id: string; source_id: string }, auth: IAuthKeyPayload) {
    const result = await this.personsRepo.mergePersons({
      tenant_id: auth.tenant_id,
      target_id: input.target_id,
      source_id: input.source_id,
      user_id: auth.user_id,
    });
    await this.userActivity.log({
      tenant_id: auth.tenant_id,
      user_id: auth.user_id,
      activity: 'merge',
      entity: 'persons',
      quantity: 1,
      metadata: {
        target_id: input.target_id,
        source_id: input.source_id,
      },
    });
    return result;
  }

  private async addToMap(row: {
    tag_id: string | undefined;
    person_id: string;
    tenant_id: string;
    createdby_id: string;
    updatedby_id: string;
  }) {
    if (!row.tag_id) {
      throw new TRPCError({
        message: 'Failed to add the tag',
        code: 'INTERNAL_SERVER_ERROR',
      });
    }

    return await this.mapPersonsTagRepo.add({
      row: row as OperationDataType<'map_peoples_tags', 'insert'>,
    });
  }

  private sanitizePhone(v?: string) {
    if (!v) return undefined;
    const digits = v.replace(/[^0-9+]/g, '');
    if (digits.startsWith('+')) return '+' + digits.slice(1).replace(/[^0-9]/g, '');
    return digits.replace(/[^0-9]/g, '');
  }

  private sanitizeRow(row: {
    first_name?: string;
    middle_names?: string;
    last_name?: string;
    email?: string;
    email2?: string;
    mobile?: string;
    notes?: string;
    home_phone?: string;
    street_num?: string;
    street1?: string;
    street2?: string;
    apt?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
    company?: string;
    tags?: string;
  }) {
    const trim = (v?: string) => (v ? v.trim() : undefined);

    let first_name = trim(row.first_name);
    const middle_names = trim(row.middle_names);
    const last_name = trim(row.last_name);
    let email = (trim(row.email) || '').toLowerCase();
    let email2 = (trim(row.email2) || '').toLowerCase();
    if (email2 && !/.+@.+\..+/.test(email2)) email2 = '';
    let mobile = this.sanitizePhone(row.mobile);
    const home_phone = this.sanitizePhone(row.home_phone);
    const notes = trim(row.notes);
    const company = trim(row.company);
    // A mapped Tags column holds comma/semicolon-separated names; over-long
    // names are dropped rather than failing the row (same 50-char cap as tags).
    const tags = (row.tags ?? '')
      .split(/[,;]/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0 && t.length <= 50);

    if (!email) {
      email = (this.findEmail(first_name || '') || this.findEmail(last_name || '') || '').toLowerCase();
    }
    if (email && !/.+@.+\..+/.test(email)) email = '';

    if (!mobile) {
      const possiblePhone = this.findPhone(first_name) || this.findPhone(last_name);
      mobile = this.sanitizePhone(possiblePhone);
    }

    if (first_name) first_name = this.stripNoise(first_name);
    if (!first_name && email) first_name = this.nameFromEmail(email);

    return {
      first_name,
      middle_names,
      last_name,
      email: email || undefined,
      email2: email2 || undefined,
      mobile,
      notes,
      home_phone,
      street_num: trim(row.street_num),
      street1: trim(row.street1),
      street2: trim(row.street2),
      apt: trim(row.apt),
      city: trim(row.city),
      state: trim(row.state),
      zip: trim(row.zip),
      country: trim(row.country),
      company,
      tags,
    };
  }

  private findEmail(text: string): string | undefined {
    const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return m?.[0];
  }

  private findPhone(text?: string): string | undefined {
    if (!text) return undefined;
    const m = text.match(/\+?\d[\d\s-]{7,}\d/);
    return m?.[0];
  }

  private stripNoise(text: string): string | undefined {
    const noEmail = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, ' ');
    const noPhone = noEmail.replace(/\+?\d[\d\s-]{7,}\d/g, ' ');
    const cleaned = noPhone
      .replace(/[,]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return cleaned || undefined;
  }

  private nameFromEmail(email: string): string | undefined {
    const local = (email || '').split('@')[0] || '';
    const token = local.split(/[._+-]/)[0] || '';
    if (!token) return undefined;
    return token.charAt(0).toUpperCase() + token.slice(1);
  }
}
