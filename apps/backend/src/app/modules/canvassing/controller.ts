import type {
  AddTurfType,
  AssignTurfType,
  CompanionHousehold,
  CompanionOpAck,
  CompanionOpType,
  CompanionPerson,
  CompanionSurveyPrefill,
  CompanionSurveyType,
  CompanionTurfPayload,
  CutTurfsType,
  FieldReportRangeType,
  IAuthKeyPayload,
  KnockResponse,
  SupportLevel,
  UpdateCompanionSettingsType,
  UpdateTurfType,
  VotingStatus,
} from '../../../../../../libs/common/src';

import { env } from '../../../env';
import { BadRequestError, NotFoundError } from '../../errors/app-errors';
import { BaseController } from '../../lib/base.controller';
import { notifyVolunteerOfLink, type VolunteerLinkSendResult } from '../../lib/mail/volunteer-link-notify';
import { publicOrgName } from '../../lib/public-tenant';
import { CampaignPersonFactsRepo } from '../campaigns/repositories/campaign-person-facts.repo';
import { CampaignSubscriptionsRepo } from '../campaigns/repositories/campaign-subscriptions.repo';
import { CampaignsRepo } from '../campaigns/repositories/campaigns.repo';
import { CompanionAccessController } from '../companion-access/controller';
import { ListsController } from '../lists/controller';
import type { Models, OperationDataType } from '../../../../../../libs/common/src/lib/kysely.models';
import type { Transaction } from 'kysely';
import {
  cutTurfs as clusterTurfs,
  previewCut as previewCutPlan,
  type CutPreview,
  type DoorPoint,
} from './lib/cutting-engine';
import { TurfHouseholdsRepo, type CoverageDoorRow } from './repositories/turf-households.repo';
import { TurfAssignmentsRepo, generateTurfToken } from './repositories/turf-assignments.repo';
import { TurfKnocksRepo, type FieldReport, type ResponseMix } from './repositories/turf-knocks.repo';
import { TurfsRepo, type TurfRow } from './repositories/turfs.repo';

/** What a voter said at the door → the campaign support scale (§15). */
const KNOCK_RESPONSE_TO_SUPPORT: Partial<Record<KnockResponse, SupportLevel>> = {
  supporter: 'strong',
  undecided: 'undecided',
  non_supporter: 'against',
};

/**
 * "Not voting" / "Already voted" are turnout facts, not stances — they feed
 * voting_status. Door canvassing overwhelmingly happens during the advance-poll
 * window, so "already voted" is recorded as voted_advance.
 */
const KNOCK_RESPONSE_TO_VOTING: Partial<Record<KnockResponse, VotingStatus>> = {
  not_voting: 'not_voting',
  already_voted: 'voted_advance',
};

/** Derived display status — computed from stored lifecycle + knock activity. */
export type TurfDisplayStatus = 'draft' | 'assigned' | 'in_field' | 'complete' | 'retired';

export interface TurfListItem {
  id: string;
  name: string;
  status: TurfDisplayStatus;
  list_id: string | null;
  list_name: string | null;
  ward: string | null;
  centroid_lat: number | null;
  centroid_lng: number | null;
  door_count: number;
  attempted: number;
  conversations: number;
  team_id: string | null;
  team_name: string | null;
  token: string | null;
  last_activity_at: string | null;
}

export interface FieldSummary {
  turfCount: number;
  inFieldCount: number;
  doorsAttempted: number;
  doorsTotal: number;
  waitingCount: number;
}

export interface InFieldToday {
  doorsKnocked: number;
  conversations: number;
  responseMix: ResponseMix;
}

/** How a door reads on the §13.3 Coverage map, derived from its window knocks. */
export type CoverageStatus = 'conversation' | 'attempted' | 'not_yet';

interface LatLng {
  lat: number;
  lng: number;
}

export interface CoverageDoor extends LatLng {
  status: CoverageStatus;
}

/** A turf boundary drawn as the convex hull of its doors (dashed on the map). */
export interface CoverageTurf {
  id: string;
  name: string;
  ward: string | null;
  path: LatLng[];
}

export interface CoverageWard {
  ward: string;
  doors: number;
  conversation: number;
  attempted: number;
  not_yet: number;
}

export interface Coverage {
  doors: CoverageDoor[];
  turfs: CoverageTurf[];
  byWard: CoverageWard[];
}

const UNASSIGNED_WARD = 'Unassigned';
const MIN_HULL_POINTS = 3;

// A turf is "in the field" if a knock landed within this window.
const IN_FIELD_WINDOW_MS = 6 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const COMPANION_SOURCE = 'companion';

export class CanvassingController extends BaseController<'turfs', TurfsRepo> {
  private readonly turfHouseholds = new TurfHouseholdsRepo();
  private readonly assignments = new TurfAssignmentsRepo();
  private readonly knocks = new TurfKnocksRepo();
  private readonly lists = new ListsController();
  private readonly campaignsRepo = new CampaignsRepo();
  private readonly factsRepo = new CampaignPersonFactsRepo();
  private readonly subscriptionsRepo = new CampaignSubscriptionsRepo();
  private readonly companionAccess = new CompanionAccessController();

  constructor() {
    super(new TurfsRepo());
  }

  private turfsRepo(): TurfsRepo {
    return this.getRepo();
  }

  // ------------------------------------------------------------- reads ------

  public async getTurfs(auth: IAuthKeyPayload): Promise<TurfListItem[]> {
    const [rows, progress] = await Promise.all([
      this.turfsRepo().getTurfs(auth.tenant_id),
      this.knocks.getProgressByTenant(auth.tenant_id),
    ]);
    return rows.map((r) => {
      const p = progress.get(r.id);
      const attempted = p?.attempted ?? 0;
      const lastAt = p?.last_knock_at ?? null;
      return {
        id: r.id,
        name: r.name,
        status: this.displayStatus(r, attempted, lastAt),
        list_id: r.list_id,
        list_name: r.list_name,
        ward: r.ward,
        centroid_lat: r.centroid_lat,
        centroid_lng: r.centroid_lng,
        door_count: r.door_count,
        attempted,
        conversations: p?.conversations ?? 0,
        team_id: r.team_id,
        team_name: r.team_name,
        token: r.token,
        last_activity_at: lastAt ? lastAt.toISOString() : null,
      };
    });
  }

  public async getFieldSummary(auth: IAuthKeyPayload): Promise<FieldSummary> {
    const turfs = await this.getTurfs(auth);
    let inFieldCount = 0;
    let waitingCount = 0;
    let doorsAttempted = 0;
    let doorsTotal = 0;
    for (const t of turfs) {
      doorsAttempted += t.attempted;
      doorsTotal += t.door_count;
      if (t.status === 'in_field') inFieldCount++;
      // "Waiting for a canvasser": cut but not being worked and never touched.
      if ((t.status === 'draft' || t.status === 'assigned') && t.attempted === 0) waitingCount++;
    }
    return { turfCount: turfs.length, inFieldCount, doorsAttempted, doorsTotal, waitingCount };
  }

  public async getInFieldToday(auth: IAuthKeyPayload): Promise<InFieldToday> {
    const { from, to } = this.dayWindow(new Date());
    const summary = await this.knocks.getWindowSummary({ tenant_id: auth.tenant_id, from, to });
    return { doorsKnocked: summary.doors, conversations: summary.conversations, responseMix: summary.responseMix };
  }

  public async getFieldReport(auth: IAuthKeyPayload, input: FieldReportRangeType): Promise<FieldReport> {
    const { from, to } = this.rangeToDates(input);
    return this.knocks.getFieldReport({ tenant_id: auth.tenant_id, from, to });
  }

  /**
   * §13.3 Coverage — every geocoded door in a turf, coloured by whether it was
   * talked to, knocked with no answer, or not yet reached in the window, plus a
   * dashed boundary hull per turf and a by-ward roll-up. Unlike the report tiles
   * this returns doors even when nothing has been knocked (a freshly-cut universe
   * reads as an all-grey map), so the caller shows it independently of `doors`.
   */
  public async getCoverage(auth: IAuthKeyPayload, input: FieldReportRangeType): Promise<Coverage> {
    const { from, to } = this.rangeToDates(input);
    const rows = await this.turfHouseholds.getCoverageRows({ tenant_id: auth.tenant_id, from, to });

    const doors: CoverageDoor[] = [];
    const turfPoints = new Map<string, { name: string; ward: string | null; pts: LatLng[] }>();
    const wards = new Map<string, CoverageWard>();

    for (const r of rows) {
      const status = this.coverageStatus(r);
      const point: LatLng = { lat: r.lat, lng: r.lng };
      doors.push({ ...point, status });

      let turf = turfPoints.get(r.turf_id);
      if (!turf) {
        turf = { name: r.turf_name, ward: r.ward, pts: [] };
        turfPoints.set(r.turf_id, turf);
      }
      turf.pts.push(point);

      const wardKey = r.ward ?? UNASSIGNED_WARD;
      let ward = wards.get(wardKey);
      if (!ward) {
        ward = { ward: wardKey, doors: 0, conversation: 0, attempted: 0, not_yet: 0 };
        wards.set(wardKey, ward);
      }
      ward.doors += 1;
      ward[status] += 1;
    }

    const turfs: CoverageTurf[] = [];
    for (const [id, turf] of turfPoints) {
      const path = convexHull(turf.pts);
      if (path.length >= MIN_HULL_POINTS) {
        turfs.push({ id, name: turf.name, ward: turf.ward, path });
      }
    }

    const byWard = [...wards.values()].sort((a, b) => b.doors - a.doors);
    return { doors, turfs, byWard };
  }

  private coverageStatus(r: CoverageDoorRow): CoverageStatus {
    if (r.conversations > 0) return 'conversation';
    if (r.attempts > 0) return 'attempted';
    return 'not_yet';
  }

  /** "Report exported — doors, conversations and responses by team and by day (CSV)." */
  public async exportFieldReportCsv(
    auth: IAuthKeyPayload,
    input: FieldReportRangeType,
  ): Promise<{ filename: string; content: string }> {
    const report = await this.getFieldReport(auth, input);
    const esc = (v: string | number): string => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines: string[] = [];
    lines.push('Section,Key,Doors,Conversations,Support IDs');
    lines.push(['Totals', 'all', report.doors, report.conversations, report.supportIds].map(esc).join(','));
    for (const t of report.byTeam) {
      lines.push(['By team', t.team_name, t.doors, t.conversations, t.supportIds].map(esc).join(','));
    }
    for (const d of report.perDay) {
      lines.push(['By day', d.day, d.conversations + d.no_answer, d.conversations, ''].map(esc).join(','));
    }
    return { filename: `canvass-field-report-${input.range}.csv`, content: lines.join('\n') };
  }

  // ---------------------------------------------------------- cut turfs -----

  public async previewCut(auth: IAuthKeyPayload, input: CutTurfsType): Promise<CutPreview> {
    const doors = await this.resolveUniverseDoors(auth, input.list_id);
    return previewCutPlan(doors, input.doors_per_turf);
  }

  public async cutTurfs(auth: IAuthKeyPayload, input: CutTurfsType): Promise<{ created: number; unplaced: number }> {
    const doors = await this.resolveUniverseDoors(auth, input.list_id);
    const plan = clusterTurfs(doors, input.doors_per_turf);
    if (plan.turfs.length === 0) {
      throw new BadRequestError('No geocoded doors in that list yet. Turfs are cut from located households.');
    }

    const repo = this.turfsRepo();
    // Continue turf numbering from the current count.
    const existing = await repo.getTurfs(auth.tenant_id);
    let n = existing.length;

    // Turfs are cut FOR a campaign (§15); defaults to the office context.
    const campaignId = await this.campaignsRepo.resolveForWrite({ tenant_id: auth.tenant_id });

    await repo.transaction().execute(async (trx) => {
      for (const cluster of plan.turfs) {
        n += 1;
        const row = {
          tenant_id: auth.tenant_id,
          campaign_id: campaignId,
          name: `Turf ${n}`,
          status: 'draft',
          list_id: input.list_id,
          target_doors: input.doors_per_turf,
          centroid_lat: cluster.centroid_lat,
          centroid_lng: cluster.centroid_lng,
          ward: cluster.ward,
          notes: null,
          createdby_id: auth.user_id,
          updatedby_id: auth.user_id,
        } as OperationDataType<'turfs', 'insert'>;
        const created = await repo.add({ row }, trx);
        const turfId = created?.id != null ? String(created.id) : '';
        if (!turfId) throw new NotFoundError('Failed to create turf');
        await this.turfHouseholds.addDoors(
          { tenant_id: auth.tenant_id, turf_id: turfId, household_ids: cluster.households, user_id: auth.user_id },
          trx,
        );
      }
    });

    return { created: plan.turfs.length, unplaced: plan.unplaced.length };
  }

  /** Re-sync a turf's doors with its smart list WITHOUT losing knock history. */
  public async refreshFromList(auth: IAuthKeyPayload, turfId: string): Promise<{ added: number; removed: number }> {
    const turf = await this.turfsRepo().getTurfCore({ tenant_id: auth.tenant_id, id: turfId });
    if (!turf) throw new NotFoundError('Turf not found');
    const listId = turf.list_id;
    if (!listId) throw new BadRequestError('This turf is not linked to a list, so it cannot be refreshed.');

    const members = new Set(await this.resolveUniverseHouseholdIds(auth, listId));
    const current = await this.turfHouseholds.getHouseholdIds({ tenant_id: auth.tenant_id, turf_id: turfId });
    const currentSet = new Set(current);

    // Drop doors no longer in the list; their knock rows persist (history kept).
    const removed = current.filter((h) => !members.has(h));
    // Add new list members that live in this turf's ward and aren't in ANY turf yet.
    const wardMembers = await this.wardMembersNotInAnyTurf(auth, turf.ward, members);
    const added = wardMembers.filter((h) => !currentSet.has(h));

    await this.turfsRepo()
      .transaction()
      .execute(async (trx) => {
        await this.turfHouseholds.removeDoors(
          { tenant_id: auth.tenant_id, turf_id: turfId, household_ids: removed },
          trx,
        );
        await this.turfHouseholds.addDoors(
          { tenant_id: auth.tenant_id, turf_id: turfId, household_ids: added, user_id: auth.user_id },
          trx,
        );
      });

    return { added: added.length, removed: removed.length };
  }

  // -------------------------------------------------------- assignment ------

  public async assignTurf(
    auth: IAuthKeyPayload,
    input: AssignTurfType,
  ): Promise<{ token: string; sent: VolunteerLinkSendResult }> {
    const turf = await this.turfsRepo().getTurfCore({ tenant_id: auth.tenant_id, id: input.turf_id });
    if (!turf) throw new NotFoundError('Turf not found');
    const teamId = input.team_id != null ? String(input.team_id) : null;
    const volunteerPersonId = String(input.volunteer_person_id);

    // The link is personal: the companion access layer verifies the holder
    // against this person's contacts, so they must exist (and ideally have an
    // email or mobile on file — the gate explains it if they don't).
    const person = await this.knocks.db
      .selectFrom('persons')
      .select(['first_name', 'email', 'mobile'])
      .where('tenant_id', '=', auth.tenant_id)
      .where('id', '=', volunteerPersonId)
      .executeTakeFirst();
    if (!person) throw new BadRequestError('Pick the volunteer this link belongs to.');

    const token = generateTurfToken();
    const expiresAt = await this.assignmentExpiry(auth.tenant_id, String(turf.campaign_id ?? ''));
    const orgName = await publicOrgName(auth.tenant_id);
    let sent: VolunteerLinkSendResult = { email: false, sms: false };

    await this.turfsRepo()
      .transaction()
      .execute(async (trx) => {
        await this.assignments.revokeForTurf(
          { tenant_id: auth.tenant_id, turf_id: input.turf_id, user_id: auth.user_id },
          trx,
        );
        await this.assignments.create(
          {
            tenant_id: auth.tenant_id,
            turf_id: input.turf_id,
            team_id: teamId,
            token,
            user_id: auth.user_id,
            volunteer_person_id: volunteerPersonId,
            expires_at: expiresAt,
          },
          trx,
        );
        await this.turfsRepo().update(
          {
            tenant_id: auth.tenant_id,
            id: input.turf_id,
            row: { status: 'active', updatedby_id: auth.user_id, updated_at: new Date() },
          },
          trx,
        );
        // Assignment sends the personal link — same transaction, so a rollback sends nothing.
        sent = await notifyVolunteerOfLink(
          {
            tenant_id: auth.tenant_id,
            person,
            orgName,
            kindLabel: 'canvassing turf',
            itemName: turf.name,
            url: `${env.companionUrl}/t/${encodeURIComponent(token)}`,
          },
          trx,
        );
      });

    await this.userActivity.log({
      tenant_id: auth.tenant_id,
      user_id: auth.user_id,
      activity: 'assign',
      entity: 'turf',
      entity_id: input.turf_id,
      metadata: {
        volunteer_person_id: volunteerPersonId,
        link_sent: sent,
        ...(teamId ? { team_id: teamId } : { link: 'tokenised' }),
      },
    });

    return { token, sent };
  }

  /**
   * Link expiry = the campaign's end date when one exists (spec §2: "end of the
   * canvass window"), otherwise no hard expiry (revocation still applies).
   */
  private async assignmentExpiry(tenant_id: string, campaign_id: string): Promise<Date | null> {
    if (!campaign_id) return null;
    const campaign = await this.knocks.db
      .selectFrom('campaigns')
      .select(['enddate'])
      .where('tenant_id', '=', tenant_id)
      .where('id', '=', campaign_id)
      .executeTakeFirst();
    if (!campaign?.enddate) return null;
    const end = new Date(`${campaign.enddate}T23:59:59`);
    return Number.isNaN(end.getTime()) || end <= new Date() ? null : end;
  }

  public async retireTurf(auth: IAuthKeyPayload, turfId: string): Promise<void> {
    const turf = await this.turfsRepo().getTurfCore({ tenant_id: auth.tenant_id, id: turfId });
    if (!turf) throw new NotFoundError('Turf not found');
    await this.turfsRepo()
      .transaction()
      .execute(async (trx) => {
        await this.assignments.revokeForTurf(
          { tenant_id: auth.tenant_id, turf_id: turfId, user_id: auth.user_id },
          trx,
        );
        await this.turfsRepo().update(
          {
            tenant_id: auth.tenant_id,
            id: turfId,
            row: { status: 'retired', updatedby_id: auth.user_id, updated_at: new Date() },
          },
          trx,
        );
      });
    await this.userActivity.log({
      tenant_id: auth.tenant_id,
      user_id: auth.user_id,
      activity: 'update',
      entity: 'turf',
      entity_id: turfId,
      metadata: { retired: true },
    });
  }

  public async addTurf(auth: IAuthKeyPayload, input: AddTurfType): Promise<{ id: string }> {
    const row = {
      tenant_id: auth.tenant_id,
      // The context this turf is knocked for (§15); defaults to the office.
      campaign_id: await this.campaignsRepo.resolveForWrite({
        tenant_id: auth.tenant_id,
        campaign_id: input.campaign_id,
      }),
      name: input.name,
      status: 'draft',
      list_id: input.list_id != null ? String(input.list_id) : null,
      notes: input.notes ?? null,
      createdby_id: auth.user_id,
      updatedby_id: auth.user_id,
    } as OperationDataType<'turfs', 'insert'>;
    const created = await this.turfsRepo().add({ row });
    return { id: created?.id != null ? String(created.id) : '' };
  }

  public async updateTurf(auth: IAuthKeyPayload, id: string, input: UpdateTurfType): Promise<void> {
    const row = {
      ...(input.name != null ? { name: input.name } : {}),
      ...(input.status != null ? { status: input.status } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      updatedby_id: auth.user_id,
      updated_at: new Date(),
    } as OperationDataType<'turfs', 'update'>;
    await this.turfsRepo().update({ tenant_id: auth.tenant_id, id, row });
  }

  // -------------------------------------------------- Companion (public) ----

  /**
   * Resolve a Companion token + verified device session to the full spec-§3
   * turf payload. Payload minimization is deliberate: names, walk data, and
   * prior door RESULTS only — never emails, phones, donation history, or notes.
   */
  public async getCompanionTurf(token: string, sessionToken: string | null): Promise<CompanionTurfPayload> {
    const assignment = await this.resolveActiveAssignment(token);
    await this.companionAccess.requireSession(sessionToken, {
      tenant_id: assignment.tenant_id,
      volunteer_person_id: assignment.volunteer_person_id,
    });
    const tenant_id = assignment.tenant_id;
    const turf_id = assignment.turf_id;

    const turf = await this.turfsRepo().getTurfCore({ tenant_id, id: turf_id });
    if (!turf) throw new NotFoundError('Turf not found');

    const [doorRows, state, campaign, canvasserName] = await Promise.all([
      this.turfHouseholds.getDoors({ tenant_id, turf_id }),
      this.knocks.getCompanionState({ tenant_id, turf_id }),
      this.companionCampaign(tenant_id, String(turf.campaign_id ?? '')),
      this.personFirstLast(tenant_id, String(assignment.volunteer_person_id)),
    ]);

    const householdIds = doorRows.map((d) => d.household_id);
    const people = await this.peopleByHousehold(tenant_id, householdIds);

    // Index the latest knock per (household, person).
    const doorState = new Map<string, (typeof state)[number]>();
    const personState = new Map<string, (typeof state)[number]>();
    for (const s of state) {
      if (s.person_id == null) doorState.set(s.household_id, s);
      else personState.set(`${s.household_id}:${s.person_id}`, s);
    }

    const households: CompanionHousehold[] = doorRows.map((d, i) => {
      const residents = people.get(d.household_id) ?? [];
      const ds = doorState.get(d.household_id);
      const doorOutcome =
        ds && (ds.outcome === 'no_answer' || ds.outcome === 'inaccessible' || ds.outcome === 'refused')
          ? ds.outcome
          : null;
      const hhSurvey = ds && ds.outcome === 'conversation' ? this.toPrefill(ds) : null;
      return {
        id: d.household_id,
        walk_order: d.walk_order ?? i + 1,
        address: this.formatAddress(d),
        lat: d.lat,
        lng: d.lng,
        dnc: residents.length > 0 && residents.every((p) => p.dnc),
        door_outcome: doorOutcome,
        hh_survey: hhSurvey,
        people: residents.map((p): CompanionPerson => {
          const ps = personState.get(`${d.household_id}:${p.id}`);
          const result =
            ps == null
              ? null
              : ps.outcome === 'conversation'
                ? 'canvassed'
                : ps.outcome === 'not_home' || ps.outcome === 'moved' || ps.outcome === 'refused'
                  ? ps.outcome
                  : null;
          return {
            id: p.id,
            name: p.name,
            dnc: p.dnc,
            result,
            survey: ps && ps.outcome === 'conversation' ? this.toPrefill(ps) : null,
          };
        }),
      };
    });

    return {
      campaign_name: campaign.name,
      turf_name: String(turf.name),
      canvasser_name: canvasserName,
      script: campaign.script,
      issues: campaign.issues,
      expires_at: assignment.expires_at ? assignment.expires_at.toISOString() : null,
      households,
    };
  }

  /**
   * Apply a batch of Companion ops (spec §5). Each op is idempotent via the
   * companion_ops ledger — a retried op acks `duplicate` and re-applies
   * nothing — and each op commits in its own transaction so one bad op never
   * blocks the rest of an offline queue from draining.
   */
  public async postCompanionResults(
    token: string,
    sessionToken: string | null,
    ops: CompanionOpType[],
  ): Promise<{ acks: CompanionOpAck[] }> {
    const assignment = await this.resolveActiveAssignment(token);
    await this.companionAccess.requireSession(sessionToken, {
      tenant_id: assignment.tenant_id,
      volunteer_person_id: assignment.volunteer_person_id,
    });
    const tenant_id = assignment.tenant_id;
    const turf_id = assignment.turf_id;

    const doorIds = new Set(await this.turfHouseholds.getHouseholdIds({ tenant_id, turf_id }));
    const canvasserName = await this.personFirstLast(tenant_id, String(assignment.volunteer_person_id));

    const acks: CompanionOpAck[] = [];
    for (const op of ops) {
      try {
        const ack = await this.knocks.transaction().execute(async (trx) => {
          // Idempotency ledger: a conflict means this op already applied.
          const claimed = await trx
            .insertInto('companion_ops')
            .values({ tenant_id, op_id: op.op_id, scope: 'canvass' })
            .onConflict((oc) => oc.columns(['tenant_id', 'op_id']).doNothing())
            .returning('op_id')
            .executeTakeFirst();
          if (!claimed) return { op_id: op.op_id, status: 'duplicate' } as CompanionOpAck;

          if (!doorIds.has(String(op.payload.household_id))) {
            throw new BadRequestError('That household is not part of this turf.');
          }
          return this.applyCompanionOp(trx, {
            op,
            tenant_id,
            turf_id,
            actor: assignment.created_by,
            canvasser_name: canvasserName,
          });
        });
        acks.push(ack);
      } catch (err: unknown) {
        acks.push({
          op_id: op.op_id,
          status: 'rejected',
          error: err instanceof Error ? err.message : 'Could not record this result.',
        });
      }
    }
    return { acks };
  }

  /** Apply one Companion op inside its transaction; returns the ack. */
  private async applyCompanionOp(
    trx: Transaction<Models>,
    input: {
      op: CompanionOpType;
      tenant_id: string;
      turf_id: string;
      actor: string;
      canvasser_name: string;
    },
  ): Promise<CompanionOpAck> {
    const { op, tenant_id, turf_id, actor, canvasser_name } = input;
    const householdId = String(op.payload.household_id);
    const knockedAt = this.clampRecordedAt(op.recorded_at);
    const via = `via Canvass Companion (${canvasser_name})`;

    const insertKnock = async (fields: {
      person_id: string | null;
      outcome: string;
      response?: string | null;
      notes?: string | null;
      issues?: string[];
      wants_volunteer?: boolean;
      wants_yard_sign?: boolean;
      set_dnc?: boolean;
      contact_phone?: string | null;
      contact_email?: string | null;
      subscribe?: boolean;
    }): Promise<void> => {
      const row = {
        tenant_id,
        turf_id,
        household_id: householdId,
        person_id: fields.person_id,
        outcome: fields.outcome,
        response: fields.response ?? null,
        notes: fields.notes ?? null,
        source: COMPANION_SOURCE,
        canvasser_name,
        client_knock_id: op.op_id,
        knocked_at: knockedAt,
        issues: fields.issues ?? [],
        wants_volunteer: fields.wants_volunteer ?? false,
        wants_yard_sign: fields.wants_yard_sign ?? false,
        set_dnc: fields.set_dnc ?? false,
        contact_phone: fields.contact_phone ?? null,
        contact_email: fields.contact_email ?? null,
        subscribe: fields.subscribe ?? false,
        createdby_id: actor,
        updatedby_id: actor,
      } as OperationDataType<'turf_knocks', 'insert'>;
      await this.knocks.insertIdempotent(row, trx);
    };

    const logActivity = async (entity: 'household' | 'person', entity_id: string, extra: Record<string, unknown>) => {
      await this.userActivity.log(
        {
          tenant_id,
          user_id: actor,
          activity: 'update',
          entity,
          entity_id,
          metadata: { source: COMPANION_SOURCE, via, turf_id, ...extra },
          performed_by: actor,
        },
        trx,
      );
    };

    switch (op.type) {
      case 'survey': {
        const p = op.payload;
        const personId = p.person_id != null ? String(p.person_id) : null;
        if (personId) await this.assertPersonInHousehold(trx, tenant_id, personId, householdId);
        await insertKnock({
          person_id: personId,
          outcome: 'conversation',
          response: p.support ?? null,
          notes: p.notes ?? null,
          issues: p.issues,
          wants_volunteer: p.wants_volunteer,
          wants_yard_sign: p.wants_yard_sign,
          set_dnc: p.set_dnc,
          contact_phone: p.contact_phone ?? null,
          contact_email: p.contact_email ?? null,
          subscribe: p.subscribe,
        });
        await this.applySurveySideEffects(trx, { tenant_id, turf_id, household_id: householdId, actor, survey: p });
        await logActivity('household', householdId, { outcome: 'conversation', response: p.support ?? null });
        if (personId) await logActivity('person', personId, { outcome: 'conversation', response: p.support ?? null });
        return { op_id: op.op_id, status: 'applied' };
      }
      case 'person_result': {
        const personId = String(op.payload.person_id);
        await this.assertPersonInHousehold(trx, tenant_id, personId, householdId);
        await insertKnock({ person_id: personId, outcome: op.payload.result });
        await logActivity('person', personId, { outcome: op.payload.result });
        return { op_id: op.op_id, status: 'applied' };
      }
      case 'door_outcome': {
        await insertKnock({ person_id: null, outcome: op.payload.outcome });
        await logActivity('household', householdId, { outcome: op.payload.outcome });
        return { op_id: op.op_id, status: 'applied' };
      }
      case 'clear_outcome': {
        await insertKnock({ person_id: null, outcome: 'cleared' });
        await logActivity('household', householdId, { outcome: 'cleared' });
        return { op_id: op.op_id, status: 'applied' };
      }
      case 'person_create': {
        const name = op.payload.name.trim();
        const lastSpace = name.lastIndexOf(' ');
        const first = lastSpace > 0 ? name.slice(0, lastSpace) : name;
        const last = lastSpace > 0 ? name.slice(lastSpace + 1) : null;
        const created = await trx
          .insertInto('persons')
          .values({
            tenant_id,
            household_id: householdId,
            first_name: first,
            last_name: last,
            createdby_id: actor,
            updatedby_id: actor,
          } as OperationDataType<'persons', 'insert'>)
          .returning('id')
          .executeTakeFirst();
        const personId = String(created?.id ?? '');
        if (!personId) throw new BadRequestError('Could not add this person.');
        await this.attachTagInTrx(trx, tenant_id, personId, 'Added at door', actor);
        await logActivity('person', personId, { created_at_door: true });
        return { op_id: op.op_id, status: 'applied', person_id: personId };
      }
      default: {
        const _exhaustive: never = op;
        return _exhaustive;
      }
    }
  }

  /** The follow-up writes a survey triggers (spec §3.5) — all in the op's transaction. */
  private async applySurveySideEffects(
    trx: Transaction<Models>,
    input: {
      tenant_id: string;
      turf_id: string;
      household_id: string;
      actor: string;
      survey: CompanionSurveyType;
    },
  ): Promise<void> {
    const { tenant_id, turf_id, household_id, actor, survey } = input;
    const personId = survey.person_id != null ? String(survey.person_id) : null;
    const campaignId = await this.resolveKnockCampaignId(tenant_id, turf_id);

    // Support / turnout facts (person-level only, and only with a stance).
    if (personId && survey.support && campaignId) {
      const support = KNOCK_RESPONSE_TO_SUPPORT[survey.support];
      const voting = KNOCK_RESPONSE_TO_VOTING[survey.support];
      await this.factsRepo.upsertFact(
        {
          tenant_id,
          campaign_id: campaignId,
          person_id: personId,
          user_id: actor,
          ...(support ? { support_level: support } : {}),
          ...(voting ? { voting_status: voting } : {}),
          source: 'canvass',
        },
        trx,
      );
    }

    // "Wants a yard sign" → a Deliveries intake request (spec §3.6/§4), unless
    // the household already has an open one (same guard as staff addRequest).
    if (survey.wants_yard_sign && campaignId) {
      const open = await trx
        .selectFrom('delivery_requests')
        .select(['id'])
        .where('tenant_id', '=', tenant_id)
        .where('household_id', '=', household_id)
        .where('status', 'in', ['new', 'approved'])
        .executeTakeFirst();
      if (!open) {
        await trx
          .insertInto('delivery_requests')
          .values({
            tenant_id,
            campaign_id: campaignId,
            household_id,
            person_id: personId,
            web_form_id: null,
            source: 'canvass',
            status: 'new',
            notes: null,
            createdby_id: actor,
            updatedby_id: actor,
          })
          // The pre-check above and a concurrent staff/web request can both see "no open request"
          // and race to insert. The partial unique index uq_delivery_requests_open_per_household is
          // the real guard; DO NOTHING makes the loser a no-op instead of a 23505 that would abort
          // this whole companion-op transaction. (No cast needed — 'canvass' is in the source union.)
          .onConflict((oc) => oc.doNothing())
          .execute();
      }
    }

    if (personId) {
      // "Do not contact" — the global compliance flag (§15).
      if (survey.set_dnc) {
        await trx
          .updateTable('persons')
          .set({ do_not_contact: true, updatedby_id: actor, updated_at: new Date() })
          .where('tenant_id', '=', tenant_id)
          .where('id', '=', personId)
          .execute();
      }

      // Contact capture: fill blanks only — a doorstep answer never overwrites
      // what the CRM already knows (the knock row keeps the captured value).
      if (survey.contact_phone || survey.contact_email) {
        const person = await trx
          .selectFrom('persons')
          .select(['mobile', 'email'])
          .where('tenant_id', '=', tenant_id)
          .where('id', '=', personId)
          .executeTakeFirst();
        const updates: Record<string, unknown> = {};
        if (survey.contact_phone && !person?.mobile) updates['mobile'] = survey.contact_phone;
        if (survey.contact_email && !person?.email) updates['email'] = survey.contact_email;
        if (Object.keys(updates).length > 0) {
          await trx
            .updateTable('persons')
            .set({ ...updates, updatedby_id: actor, updated_at: new Date() })
            .where('tenant_id', '=', tenant_id)
            .where('id', '=', personId)
            .execute();
        }
      }

      // "Subscribe to updates" — consent captured at the door.
      if (survey.subscribe && campaignId) {
        const person = await trx
          .selectFrom('persons')
          .select(['email'])
          .where('tenant_id', '=', tenant_id)
          .where('id', '=', personId)
          .executeTakeFirst();
        const email = survey.contact_email ?? person?.email ?? null;
        if (email) {
          await this.subscriptionsRepo.setStatus(
            {
              tenant_id,
              campaign_id: campaignId,
              person_id: personId,
              email,
              status: 'subscribed',
              consent_source: 'canvass',
              user_id: actor,
            },
            trx,
          );
        }
      }

      // "Wants to volunteer" → first-class volunteer standing (§15), a machine
      // update, not a tag. Only fills a NULL status so an existing active/former
      // classification is never clobbered.
      if (survey.wants_volunteer) {
        await trx
          .updateTable('persons')
          .set({ volunteer_status: 'prospective', updated_at: new Date(), updatedby_id: actor })
          .where('tenant_id', '=', tenant_id)
          .where('id', '=', personId)
          .where('volunteer_status', 'is', null)
          .execute();
      }
    }
  }

  /** Resolve + expiry-check an assignment token (uniform dead-link semantics). */
  private async resolveActiveAssignment(token: string) {
    const assignment = await this.assignments.resolveByToken(token);
    if (!assignment) throw new NotFoundError('This canvassing link is invalid or has been retired.');
    if (assignment.expires_at && assignment.expires_at < new Date()) {
      throw new NotFoundError('This canvassing link is invalid or has been retired.');
    }
    return assignment;
  }

  /** A person op must target a resident of that door — a token can't reach further. */
  private async assertPersonInHousehold(
    trx: Transaction<Models>,
    tenant_id: string,
    person_id: string,
    household_id: string,
  ): Promise<void> {
    const person = await trx
      .selectFrom('persons')
      .select(['id'])
      .where('tenant_id', '=', tenant_id)
      .where('id', '=', person_id)
      .where('household_id', '=', household_id)
      .executeTakeFirst();
    if (!person) throw new BadRequestError('That person is not at this door.');
  }

  /**
   * Attach a tag by name inside the op's transaction (find-or-create + map).
   * PersonsService.attachTag exists but manages its own connections/workflow
   * triggers outside a transaction — this is the minimal transactional core.
   */
  private async attachTagInTrx(
    trx: Transaction<Models>,
    tenant_id: string,
    person_id: string,
    name: string,
    actor: string,
  ): Promise<void> {
    await trx
      .insertInto('tags')
      .values({
        tenant_id,
        name,
        color: '#818789',
        type: 'tag',
        createdby_id: actor,
        updatedby_id: actor,
      } as OperationDataType<'tags', 'insert'>)
      .onConflict((oc) => oc.doNothing())
      .execute();
    const tag = await trx
      .selectFrom('tags')
      .select(['id'])
      .where('tenant_id', '=', tenant_id)
      .where('name', '=', name)
      .executeTakeFirst();
    if (!tag) return;
    await trx
      .insertInto('map_peoples_tags')
      .values({
        tenant_id,
        person_id,
        tag_id: String(tag.id),
        createdby_id: actor,
        updatedby_id: actor,
      } as OperationDataType<'map_peoples_tags', 'insert'>)
      .onConflict((oc) => oc.doNothing())
      .execute();
  }

  /** On-device timestamps keep their true door time, but never land in the future. */
  private clampRecordedAt(recordedAt: string | null | undefined): Date {
    const now = new Date();
    if (!recordedAt) return now;
    const parsed = new Date(recordedAt);
    if (Number.isNaN(parsed.getTime()) || parsed > now) return now;
    return parsed;
  }

  /** Campaign display name + companion survey vocabulary for a turf's campaign. */
  private async companionCampaign(
    tenant_id: string,
    campaign_id: string,
  ): Promise<{ name: string; issues: string[]; script: string }> {
    if (campaign_id) {
      const row = await this.knocks.db
        .selectFrom('campaigns')
        .select(['name', 'canvass_issues', 'canvass_script'])
        .where('tenant_id', '=', tenant_id)
        .where('id', '=', campaign_id)
        .executeTakeFirst();
      if (row) {
        return {
          name: String(row.name),
          issues: Array.isArray(row.canvass_issues) ? row.canvass_issues.map(String) : [],
          script: row.canvass_script ?? '',
        };
      }
    }
    return { name: '', issues: [], script: '' };
  }

  private async personFirstLast(tenant_id: string, person_id: string): Promise<string> {
    const row = await this.knocks.db
      .selectFrom('persons')
      .select(['first_name', 'last_name'])
      .where('tenant_id', '=', tenant_id)
      .where('id', '=', person_id)
      .executeTakeFirst();
    return [row?.first_name, row?.last_name].filter(Boolean).join(' ') || 'Volunteer';
  }

  /** Residents per household — names + DNC only (payload minimization, spec §2). */
  private async peopleByHousehold(
    tenant_id: string,
    household_ids: string[],
  ): Promise<Map<string, { id: string; name: string; dnc: boolean }[]>> {
    const map = new Map<string, { id: string; name: string; dnc: boolean }[]>();
    if (household_ids.length === 0) return map;
    const rows = await this.knocks.db
      .selectFrom('persons')
      .select(['id', 'household_id', 'first_name', 'last_name', 'do_not_contact'])
      .where('tenant_id', '=', tenant_id)
      .where('household_id', 'in', household_ids)
      .orderBy('id')
      .execute();
    for (const r of rows) {
      const hid = String(r.household_id);
      const list = map.get(hid) ?? [];
      list.push({
        id: String(r.id),
        name: [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Unnamed resident',
        dnc: Boolean(r.do_not_contact),
      });
      map.set(hid, list);
    }
    return map;
  }

  private toPrefill(s: {
    response: string | null;
    issues: string[];
    wants_volunteer: boolean;
    wants_yard_sign: boolean;
    set_dnc: boolean;
    subscribe: boolean;
  }): CompanionSurveyPrefill {
    return {
      support: (s.response ?? null) as CompanionSurveyPrefill['support'],
      issues: s.issues,
      wants_volunteer: s.wants_volunteer,
      wants_yard_sign: s.wants_yard_sign,
      set_dnc: s.set_dnc,
      subscribe: s.subscribe,
    };
  }

  // ------------------------------------------- Companion settings (staff) ----

  /** The survey vocabulary the Companion shows, from the write campaign. */
  public async getCompanionSettings(
    auth: IAuthKeyPayload,
    campaign_id?: string,
  ): Promise<{ campaign_id: string; campaign_name: string; issues: string[]; script: string }> {
    const resolved = await this.campaignsRepo.resolveForWrite({ tenant_id: auth.tenant_id, campaign_id });
    const campaign = await this.companionCampaign(auth.tenant_id, String(resolved));
    return {
      campaign_id: String(resolved),
      campaign_name: campaign.name,
      issues: campaign.issues,
      script: campaign.script,
    };
  }

  public async updateCompanionSettings(auth: IAuthKeyPayload, input: UpdateCompanionSettingsType): Promise<void> {
    const resolved = await this.campaignsRepo.resolveForWrite({
      tenant_id: auth.tenant_id,
      campaign_id: input.campaign_id,
    });
    await this.knocks.db
      .updateTable('campaigns')
      .set({
        canvass_issues: input.issues,
        canvass_script: input.script ?? null,
        updatedby_id: auth.user_id,
        updated_at: new Date(),
      })
      .where('tenant_id', '=', auth.tenant_id)
      .where('id', '=', String(resolved))
      .execute();
    await this.userActivity.log({
      tenant_id: auth.tenant_id,
      user_id: auth.user_id,
      activity: 'update',
      entity: 'campaign',
      entity_id: String(resolved),
      metadata: { action: 'companion_settings', issues: input.issues.length },
    });
  }

  /** The campaign a knock's support reading belongs to: the turf's own context. */
  private async resolveKnockCampaignId(tenant_id: string, turf_id: string): Promise<string | null> {
    const turf = await this.knocks.db
      .selectFrom('turfs')
      .select(['campaign_id'])
      .where('tenant_id', '=', tenant_id)
      .where('id', '=', turf_id)
      .executeTakeFirst();
    if (turf?.campaign_id) return String(turf.campaign_id);
    const campaigns = await this.campaignsRepo.getSwitcherList({ tenant_id });
    const office = campaigns.find((c) => c.kind === 'office');
    return office ? String(office.id) : null;
  }

  // ----------------------------------------------------------- helpers ------

  private displayStatus(row: TurfRow, attempted: number, lastAt: Date | null): TurfDisplayStatus {
    switch (row.status) {
      case 'retired':
        return 'retired';
      case 'draft':
        return 'draft';
      case 'active': {
        if (row.door_count > 0 && attempted >= row.door_count) return 'complete';
        if (lastAt && Date.now() - lastAt.getTime() <= IN_FIELD_WINDOW_MS) return 'in_field';
        return 'assigned';
      }
      default: {
        // Any unexpected stored status is treated as assigned rather than thrown,
        // so a future lifecycle value never breaks the whole list.
        return 'assigned';
      }
    }
  }

  private async resolveUniverseDoors(auth: IAuthKeyPayload, listId: string): Promise<DoorPoint[]> {
    const householdIds = await this.resolveUniverseHouseholdIds(auth, listId);
    return this.turfsRepo().getHouseholdsGeo({ tenant_id: auth.tenant_id, household_ids: householdIds });
  }

  /** Reuse Lists' getCurrentMembers (Wave 1C) — never re-derive membership. */
  private async resolveUniverseHouseholdIds(auth: IAuthKeyPayload, listId: string): Promise<string[]> {
    const members = await this.lists.getCurrentMembers(auth, listId);
    if (members.object === 'households') return members.ids;
    // A people list → map to their distinct households.
    return this.turfsRepo().getHouseholdIdsForPersons({ tenant_id: auth.tenant_id, person_ids: members.ids });
  }

  private async wardMembersNotInAnyTurf(
    auth: IAuthKeyPayload,
    ward: string | null,
    members: Set<string>,
  ): Promise<string[]> {
    if (members.size === 0) return [];
    const geo = await this.turfsRepo().getHouseholdsGeo({
      tenant_id: auth.tenant_id,
      household_ids: [...members],
    });
    const inWard = geo.filter((d) => (d.ward ?? null) === ward).map((d) => d.household_id);
    // Exclude households already assigned to any turf.
    const assigned = await this.householdsInAnyTurf(auth, inWard);
    return inWard.filter((h) => !assigned.has(h));
  }

  private async householdsInAnyTurf(auth: IAuthKeyPayload, householdIds: string[]): Promise<Set<string>> {
    if (householdIds.length === 0) return new Set();
    const rows = await this.turfsRepo()
      .db.selectFrom('turf_households')
      .where('tenant_id', '=', auth.tenant_id)
      .where('household_id', 'in', householdIds)
      .select('household_id')
      .distinct()
      .execute();
    return new Set(rows.map((r) => String(r.household_id)));
  }

  private formatAddress(d: {
    street_num: string | null;
    street1: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  }): string {
    const line = [d.street_num, d.street1].filter(Boolean).join(' ');
    const tail = [d.city, d.state, d.zip].filter(Boolean).join(', ');
    return [line, tail].filter(Boolean).join(', ') || 'Address unavailable';
  }

  private dayWindow(now: Date): { from: Date; to: Date } {
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const to = new Date(from.getTime() + MS_PER_DAY);
    return { from, to };
  }

  private rangeToDates(input: FieldReportRangeType): { from: Date; to: Date } {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    switch (input.range) {
      case 'today':
        return { from: startOfToday, to: new Date(startOfToday.getTime() + MS_PER_DAY) };
      case 'yesterday':
        return { from: new Date(startOfToday.getTime() - MS_PER_DAY), to: startOfToday };
      case 'week':
        return {
          from: new Date(startOfToday.getTime() - 6 * MS_PER_DAY),
          to: new Date(startOfToday.getTime() + MS_PER_DAY),
        };
      case 'month':
        return {
          from: new Date(now.getFullYear(), now.getMonth(), 1),
          to: new Date(startOfToday.getTime() + MS_PER_DAY),
        };
      case 'campaign':
        return { from: new Date(0), to: new Date(startOfToday.getTime() + MS_PER_DAY) };
      case 'custom': {
        const from = input.from ? new Date(input.from) : new Date(0);
        const to = input.to ? new Date(input.to) : new Date(startOfToday.getTime() + MS_PER_DAY);
        return { from, to };
      }
      default: {
        const _exhaustive: never = input.range;
        return { from: _exhaustive, to: now };
      }
    }
  }
}

/**
 * Convex hull (Andrew's monotone chain) of a set of lat/lng points — the honest
 * outer boundary of a turf's doors, used for the dashed coverage outline. Runs in
 * O(n log n); returns the input unchanged when there are fewer than three points.
 */
function convexHull(points: LatLng[]): LatLng[] {
  if (points.length < MIN_HULL_POINTS) return points;
  const pts = [...points].sort((a, b) => a.lng - b.lng || a.lat - b.lat);
  const cross = (o: LatLng, a: LatLng, b: LatLng): number =>
    (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);

  // One monotone-chain half; the caller feeds the points forwards then reversed.
  const half = (seq: LatLng[]): LatLng[] => {
    const acc: LatLng[] = [];
    for (const p of seq) {
      let a = acc[acc.length - 2];
      let b = acc[acc.length - 1];
      while (a && b && cross(a, b, p) <= 0) {
        acc.pop();
        a = acc[acc.length - 2];
        b = acc[acc.length - 1];
      }
      acc.push(p);
    }
    acc.pop(); // drop the shared endpoint
    return acc;
  };

  return half(pts).concat(half([...pts].reverse()));
}
