import type {
  AddTurfType,
  AssignTurfType,
  CompanionClaimSegmentType,
  CompanionDoorOutcome,
  CompanionHousehold,
  CompanionOpAck,
  CompanionOpType,
  CompanionPerson,
  CompanionPersonResult,
  CompanionSegmentClaim,
  CompanionSurveyPrefill,
  CompanionSurveyType,
  CompanionTurfChoice,
  CompanionTurfChoices,
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
import { SUPPORT_LEVELS, TASK_OPEN_STATUSES, VOTING_STATUSES } from '../../../../../../libs/common/src';

import { env } from '../../../env';
import { assertVolunteerLinkResendAllowed } from '../../lib/volunteer-link-resend-limit';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../errors/app-errors';
import { BaseController } from '../../lib/base.controller';
import { volunteerMayRoam } from '../../lib/canvass-roam-policy';
import { notifyVolunteerOfLink, type VolunteerLinkSendResult } from '../../lib/mail/volunteer-link-notify';
import { publicMessageOf } from '../../lib/public-route-errors';
import { publicOrgName } from '../../lib/public-tenant';
import { turfAssignmentExpiry } from '../../lib/volunteer-link-policy';
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
import { type TurfCanvasser, TurfAssignmentsRepo, generateTurfToken } from './repositories/turf-assignments.repo';
import {
  TurfKnocksRepo,
  type CanvasserWork,
  type FieldReport,
  type ResponseMix,
} from './repositories/turf-knocks.repo';
import { TurfSegmentClaimsRepo } from './repositories/turf-segment-claims.repo';
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

/**
 * `support_level` / `voting_status` are plain text columns, so a row written before a
 * vocabulary changed (or by an import) can hold a value the union no longer names. Narrow
 * rather than cast: an unrecognized value reads as "unknown" at the door, which is true.
 */
function isSupportLevel(v: unknown): v is SupportLevel {
  return typeof v === 'string' && (SUPPORT_LEVELS as readonly string[]).includes(v);
}

function isVotingStatus(v: unknown): v is VotingStatus {
  return typeof v === 'string' && (VOTING_STATUSES as readonly string[]).includes(v);
}

/**
 * Task-name prefix for "Error in data" reports. Also the dedupe key — one open review task
 * per person, matched by this prefix rather than by a flag column.
 */
const DATA_ERROR_TASK_PREFIX = 'Check door data:';

/** Door-level outcomes the Companion can render and re-record. */
const COMPANION_DOOR_OUTCOMES: readonly CompanionDoorOutcome[] = ['no_answer', 'inaccessible', 'refused', 'moved'];

/** Person-level no-conversation codes, in the same order the survey screen offers them. */
const COMPANION_PERSON_RESULTS: readonly CompanionPersonResult[] = [
  'not_home',
  'moved',
  'refused',
  'deceased',
  'data_error',
];

function isCompanionDoorOutcome(v: string): v is CompanionDoorOutcome {
  return (COMPANION_DOOR_OUTCOMES as readonly string[]).includes(v);
}

/**
 * The stored knock outcome as a person card reads it, or null.
 *
 * Null covers `cleared` and anything a future vocabulary adds: an outcome this build does
 * not understand shows as no result rather than as a wrong one.
 */
function personResultOf(outcome: string): CompanionPersonResult | null {
  return COMPANION_PERSON_RESULTS.find((r) => r === outcome) ?? null;
}

/** One resident as the companion payload needs them — see `peopleByHousehold`. */
interface ResidentRow {
  id: string;
  name: string;
  last_name: string | null;
  dnc: boolean;
  deceased: boolean;
  senior: boolean | null;
}

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
  /** Everyone currently walking this turf. Several volunteers can share one turf. */
  canvassers: TurfCanvasser[];
  /** Whether any active companion link exists. The raw token is never returned (M5). */
  has_link: boolean;
  last_activity_at: string | null;
}

/**
 * What a companion data request has been authorized against, whether it arrived with a
 * capability link or a device session. Structurally the useful subset of a resolved
 * assignment, so both paths feed the same payload/ops code.
 */
interface CompanionContext {
  /** The assignment row — the identity a street claim is filed under. */
  id: string;
  tenant_id: string;
  turf_id: string;
  volunteer_person_id: string | null;
  created_by: string;
  expires_at: Date | null;
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

/** One door on the turf detail page: where it is, who lives there, what happened. */
export interface TurfDoor {
  household_id: string;
  walk_order: number;
  address: string;
  lat: number | null;
  lng: number | null;
  status: CoverageStatus;
  attempts: number;
  last_outcome: string | null;
  last_response: string | null;
  last_canvasser: string | null;
  last_knocked_at: string | null;
  residents: { id: string; name: string; dnc: boolean }[];
}

/**
 * A canvasser as the turf detail page shows them: their roster membership (when
 * they're still on it) plus the work credited to their name.
 *
 * Knocks store `canvasser_name`, not a volunteer id, so work is matched to the
 * roster by name — and someone taken off the roster keeps their credit here with
 * `active: false` rather than having their doors vanish from the turf.
 */
export interface TurfRosterEntry {
  assignment_id: string | null;
  person_id: string | null;
  name: string;
  team_name: string | null;
  assigned_at: string | null;
  expires_at: string | null;
  active: boolean;
  doors: number;
  conversations: number;
  last_knock_at: string | null;
}

export interface TurfDetail {
  id: string;
  name: string;
  status: TurfDisplayStatus;
  list_id: string | null;
  list_name: string | null;
  campaign_name: string;
  ward: string | null;
  door_count: number;
  attempted: number;
  conversations: number;
  last_activity_at: string | null;
  centroid_lat: number | null;
  centroid_lng: number | null;
  /** Dashed outline of the turf — the convex hull of its geocoded doors. */
  boundary: LatLng[];
  canvassers: TurfRosterEntry[];
  doors: TurfDoor[];
}

const UNASSIGNED_WARD = 'Unassigned';
const MIN_HULL_POINTS = 3;

// A turf is "in the field" if a knock landed within this window.
const IN_FIELD_WINDOW_MS = 6 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * How long a street claim stands before it stops being believed.
 *
 * Long enough to cover a canvass shift without a volunteer having to re-claim the street
 * they are visibly standing on; short enough that a phone locked at the end of the
 * afternoon is not still telling Sunday's group that Scott Blvd is taken. Nobody is ever
 * blocked by a stale claim — the cost of getting this wrong is only a misleading label.
 */
const SEGMENT_CLAIM_TTL_MS = 6 * 60 * 60 * 1000;
const COMPANION_SOURCE = 'companion';

export class CanvassingController extends BaseController<'turfs', TurfsRepo> {
  private readonly turfHouseholds = new TurfHouseholdsRepo();
  private readonly assignments = new TurfAssignmentsRepo();
  private readonly knocks = new TurfKnocksRepo();
  private readonly segmentClaims = new TurfSegmentClaimsRepo();
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
    const [rows, progress, canvassers] = await Promise.all([
      this.turfsRepo().getTurfs(auth.tenant_id),
      this.knocks.getProgressByTenant(auth.tenant_id),
      this.assignments.canvassersByTurf({ tenant_id: auth.tenant_id }),
    ]);
    return rows.map((r) => {
      const p = progress.get(r.id);
      const attempted = p?.attempted ?? 0;
      const lastAt = p?.last_knock_at ?? null;
      const roster = canvassers.get(r.id) ?? [];
      return {
        id: r.id,
        name: r.name,
        status: this.displayStatus(r, attempted, lastAt, roster.length > 0),
        list_id: r.list_id,
        list_name: r.list_name,
        ward: r.ward,
        centroid_lat: r.centroid_lat,
        centroid_lng: r.centroid_lng,
        door_count: r.door_count,
        attempted,
        conversations: p?.conversations ?? 0,
        canvassers: roster,
        has_link: roster.length > 0,
        last_activity_at: lastAt ? lastAt.toISOString() : null,
      };
    });
  }

  /**
   * One turf, opened: its doors with what happened at each, and the people
   * walking it with the work credited to them. Everything here is derived at read
   * time from `turf_knocks` exactly like the list page (§22.6) — the detail view
   * adds no stored state of its own.
   */
  public async getTurfDetail(auth: IAuthKeyPayload, turfId: string): Promise<TurfDetail> {
    const tenant_id = auth.tenant_id;
    const row = await this.turfsRepo().getTurfRow({ tenant_id, id: turfId });
    if (!row) throw new NotFoundError('Turf not found');

    const [doorRows, activity, roster, work, campaign] = await Promise.all([
      this.turfHouseholds.getDoors({ tenant_id, turf_id: turfId }),
      this.knocks.getDoorActivity({ tenant_id, turf_id: turfId }),
      this.assignments.canvassersByTurf({ tenant_id, turf_id: turfId }),
      this.knocks.getCanvasserWork({ tenant_id, turf_id: turfId }),
      this.companionCampaign(tenant_id, String(row.campaign_id ?? '')),
    ]);
    const residents = await this.peopleByHousehold(
      tenant_id,
      doorRows.map((d) => d.household_id),
    );

    const doors: TurfDoor[] = doorRows.map((d, i) => {
      const a = activity.get(d.household_id);
      return {
        household_id: d.household_id,
        walk_order: d.walk_order ?? i + 1,
        address: this.formatAddress(d),
        lat: d.lat,
        lng: d.lng,
        status: a == null ? 'not_yet' : a.conversations > 0 ? 'conversation' : 'attempted',
        attempts: a?.attempts ?? 0,
        last_outcome: a?.last_outcome ?? null,
        last_response: a?.last_response ?? null,
        last_canvasser: a?.last_canvasser ?? null,
        last_knocked_at: a ? a.last_knocked_at.toISOString() : null,
        residents: residents.get(d.household_id) ?? [],
      };
    });

    let attempted = 0;
    let conversations = 0;
    let lastAt: Date | null = null;
    for (const a of activity.values()) {
      attempted += 1;
      conversations += a.conversations;
      if (!lastAt || a.last_knocked_at > lastAt) lastAt = a.last_knocked_at;
    }

    const canvassers = this.rosterWithWork(roster.get(turfId) ?? [], work);
    const boundary = convexHull(
      doors.filter((d) => d.lat != null && d.lng != null).map((d) => ({ lat: Number(d.lat), lng: Number(d.lng) })),
    );

    return {
      id: row.id,
      name: row.name,
      status: this.displayStatus(row, attempted, lastAt, (roster.get(turfId) ?? []).length > 0),
      list_id: row.list_id,
      list_name: row.list_name,
      campaign_name: campaign.name,
      ward: row.ward,
      door_count: row.door_count,
      attempted,
      conversations,
      last_activity_at: lastAt ? lastAt.toISOString() : null,
      centroid_lat: row.centroid_lat,
      centroid_lng: row.centroid_lng,
      boundary: boundary.length >= MIN_HULL_POINTS ? boundary : [],
      canvassers,
      doors,
    };
  }

  /**
   * Pair the active roster with the work credited to each name, then append the
   * names that knocked here but are no longer on the roster. Losing your link
   * doesn't unmake the doors you walked, so those rows stay — marked inactive.
   */
  private rosterWithWork(roster: TurfCanvasser[], work: CanvasserWork[]): TurfRosterEntry[] {
    const key = (name: string): string => name.trim().toLowerCase();
    const byName = new Map(work.map((w) => [key(w.name), w]));

    const entries: TurfRosterEntry[] = roster.map((c) => {
      const w = byName.get(key(c.name));
      byName.delete(key(c.name));
      return {
        assignment_id: c.assignment_id,
        person_id: c.person_id,
        name: c.name,
        team_name: c.team_name,
        assigned_at: c.assigned_at,
        expires_at: c.expires_at,
        active: true,
        doors: w?.doors ?? 0,
        conversations: w?.conversations ?? 0,
        last_knock_at: w?.last_knock_at ? w.last_knock_at.toISOString() : null,
      };
    });

    for (const w of byName.values()) {
      entries.push({
        assignment_id: null,
        person_id: null,
        name: w.name,
        team_name: null,
        assigned_at: null,
        expires_at: null,
        active: false,
        doors: w.doors,
        conversations: w.conversations,
        last_knock_at: w.last_knock_at ? w.last_knock_at.toISOString() : null,
      });
    }
    return entries;
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
        // Retire only THIS volunteer's previous link on this turf, not everyone's:
        // several volunteers can walk one turf together, so assigning a second
        // person must add them to the roster rather than evict the first.
        // Re-assigning the same person still rotates their token, because the raw
        // value is hashed and cannot be re-displayed.
        await this.assignments.revokeForVolunteer(
          {
            tenant_id: auth.tenant_id,
            turf_id: input.turf_id,
            volunteer_person_id: volunteerPersonId,
            user_id: auth.user_id,
          },
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
        // Capped like the deliveries re-send (H3): repeated assign/unassign of the same turf
        // would otherwise be an unlimited SMS bomber aimed at the person's number.
        await assertVolunteerLinkResendAllowed(auth.tenant_id, input.turf_id, person.mobile);
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

  /** The active roster for one turf — who is walking it right now. */
  public async getTurfCanvassers(auth: IAuthKeyPayload, turfId: string): Promise<TurfCanvasser[]> {
    const turf = await this.turfsRepo().getTurfCore({ tenant_id: auth.tenant_id, id: turfId });
    if (!turf) throw new NotFoundError('Turf not found');
    const byTurf = await this.assignments.canvassersByTurf({ tenant_id: auth.tenant_id, turf_id: turfId });
    return byTurf.get(turfId) ?? [];
  }

  /**
   * Take one volunteer off a turf, leaving the rest of the roster walking it.
   *
   * Their link stops resolving immediately. Knocks they already synced stay — the
   * work happened, and `turf_knocks.canvasser_name` keeps crediting them.
   */
  public async removeVolunteerFromTurf(
    auth: IAuthKeyPayload,
    input: { turf_id: string; volunteer_person_id: string },
  ): Promise<void> {
    const turf = await this.turfsRepo().getTurfCore({ tenant_id: auth.tenant_id, id: input.turf_id });
    if (!turf) throw new NotFoundError('Turf not found');

    const roster = await this.assignments.canvassersByTurf({
      tenant_id: auth.tenant_id,
      turf_id: input.turf_id,
    });
    const onTurf = (roster.get(input.turf_id) ?? []).some((c) => c.person_id === input.volunteer_person_id);
    if (!onTurf) throw new NotFoundError('That volunteer is not on this turf.');

    await this.assignments.revokeForVolunteer({
      tenant_id: auth.tenant_id,
      turf_id: input.turf_id,
      volunteer_person_id: input.volunteer_person_id,
      user_id: auth.user_id,
    });

    await this.userActivity.log({
      tenant_id: auth.tenant_id,
      user_id: auth.user_id,
      activity: 'update',
      entity: 'turf',
      entity_id: input.turf_id,
      metadata: {
        action: 'canvasser_removed',
        volunteer_person_id: input.volunteer_person_id,
        message: 'Removed a canvasser from the turf',
      },
    });
  }

  /** Shared with the companion-access layer's QR-join path — see volunteer-link-policy. */
  private assignmentExpiry(tenant_id: string, campaign_id: string): Promise<Date> {
    return turfAssignmentExpiry(this.knocks.db, tenant_id, campaign_id);
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
    const turf = await this.turfsRepo().getTurfCore({ tenant_id: auth.tenant_id, id });
    if (!turf) throw new NotFoundError('Turf not found');

    const row = {
      ...(input.name != null ? { name: input.name } : {}),
      ...(input.status != null ? { status: input.status } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      updatedby_id: auth.user_id,
      updated_at: new Date(),
    } as OperationDataType<'turfs', 'update'>;
    await this.turfsRepo().update({ tenant_id: auth.tenant_id, id, row });

    // A rename is the one thing about a turf staff change by hand, and the name is
    // load-bearing: canvassers already walking it see it in the Companion and the field
    // report files the turf under it. The turf's own activity log is where someone looks
    // to find out who changed it, so it is recorded in the `changes` shape the log renders.
    if (input.name != null && input.name !== turf.name) {
      await this.userActivity.log({
        tenant_id: auth.tenant_id,
        user_id: auth.user_id,
        activity: 'update',
        entity: 'turf',
        entity_id: id,
        metadata: { changes: { name: { from: turf.name, to: input.name } } },
      });
    }
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
    return this.companionTurfPayload(assignment);
  }

  /**
   * The same payload, reached by device session + turf id instead of a capability link.
   *
   * This is what lets a volunteer switch turfs. Turf tokens are hashed, so the ones they
   * already hold can never be listed back to them — handing out links is a one-way door.
   * Session-first sidesteps that: the session proves who they are, and an active
   * assignment on the turf proves they belong on it.
   */
  public async getCompanionTurfBySession(sessionToken: string | null, turfId: string): Promise<CompanionTurfPayload> {
    return this.companionTurfPayload(await this.assignmentForSession(sessionToken, turfId));
  }

  private async companionTurfPayload(assignment: CompanionContext): Promise<CompanionTurfPayload> {
    const tenant_id = assignment.tenant_id;
    const turf_id = assignment.turf_id;

    const turf = await this.turfsRepo().getTurfCore({ tenant_id, id: turf_id });
    if (!turf) throw new NotFoundError('Turf not found');

    const [doorRows, state, campaign, canvasserName, claims] = await Promise.all([
      this.turfHouseholds.getDoors({ tenant_id, turf_id }),
      this.knocks.getCompanionState({ tenant_id, turf_id }),
      this.companionCampaign(tenant_id, String(turf.campaign_id ?? '')),
      this.personFirstLast(tenant_id, String(assignment.volunteer_person_id)),
      this.segmentClaims.activeForTurf({ tenant_id, turf_id }),
    ]);

    const campaignId = String(turf.campaign_id ?? '');
    const householdIds = doorRows.map((d) => d.household_id);
    const people = await this.peopleByHousehold(tenant_id, householdIds);
    const personIds = [...people.values()].flat().map((p) => p.id);
    // Prior ID and open sign requests are what turn a list of addresses into a walk list:
    // they say which door is worth the next ten minutes. Both are read AFTER the residents
    // because both are keyed off them.
    const [priorFacts, yardSignDoors] = await Promise.all([
      this.priorFactsByPerson(tenant_id, campaignId, personIds),
      this.openYardSignHouseholds(tenant_id, campaignId, householdIds),
    ]);

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
      const doorOutcome = ds != null && isCompanionDoorOutcome(ds.outcome) ? ds.outcome : null;
      const hhSurvey = ds && ds.outcome === 'conversation' ? this.toPrefill(ds) : null;
      return {
        id: d.household_id,
        walk_order: d.walk_order ?? i + 1,
        address: this.formatAddress(d),
        // Kept separate so the companion can group doors by street; `address` stays the
        // one thing the UI renders.
        street: d.street1,
        street_num: d.street_num,
        apt: d.apt,
        lat: d.lat,
        lng: d.lng,
        dnc: residents.length > 0 && residents.every((p) => p.dnc),
        yard_sign: yardSignDoors.has(d.household_id),
        door_outcome: doorOutcome,
        hh_survey: hhSurvey,
        people: residents.map((p): CompanionPerson => {
          const ps = personState.get(`${d.household_id}:${p.id}`);
          const prior = priorFacts.get(p.id);
          const result = ps == null ? null : ps.outcome === 'conversation' ? 'canvassed' : personResultOf(ps.outcome);
          return {
            id: p.id,
            name: p.name,
            last_name: p.last_name,
            dnc: p.dnc,
            support: prior?.support ?? null,
            voting_status: prior?.voting_status ?? null,
            deceased: p.deceased,
            senior: p.senior,
            result,
            survey: ps && ps.outcome === 'conversation' ? this.toPrefill(ps) : null,
          };
        }),
      };
    });

    return {
      campaign_name: campaign.name,
      turf_id,
      turf_name: String(turf.name),
      canvasser_name: canvasserName,
      script: campaign.script,
      issues: campaign.issues,
      expires_at: assignment.expires_at ? assignment.expires_at.toISOString() : null,
      households,
      segment_claims: claims.map(
        (c): CompanionSegmentClaim => ({
          street_key: c.street_key,
          street: c.street_label,
          canvasser_name: c.canvasser_name,
          claimed_at: c.claimed_at.toISOString(),
          mine: c.assignment_id === assignment.id,
        }),
      ),
    };
  }

  /**
   * "I'm taking Scott Blvd" — or, with a null key, "I'm back on the whole turf".
   *
   * Advisory throughout: this writes a note for the rest of the group and changes nothing
   * about what anyone may knock. It cannot fail in a way worth interrupting a volunteer
   * over, which is why the client fires it and forgets it — the worst outcome is that the
   * group's picture of who is where is briefly stale, exactly as it was before any of this
   * existed.
   *
   * A claim outlives neither the shift nor the assignment: `SEGMENT_CLAIM_TTL_MS` is what
   * stops a phone going into a pocket at 4pm from telling tomorrow's group that a street
   * is taken.
   */
  public async claimSegment(
    sessionToken: string | null,
    turfId: string,
    input: CompanionClaimSegmentType,
  ): Promise<{ ok: true }> {
    const assignment = await this.assignmentForSession(sessionToken, turfId);
    const tenant_id = assignment.tenant_id;
    const key = input.street_key?.trim() ?? null;

    if (!key) {
      await this.segmentClaims.release({ tenant_id, turf_id: turfId, assignment_id: assignment.id });
      return { ok: true };
    }

    await this.segmentClaims.claim({
      tenant_id,
      turf_id: turfId,
      assignment_id: assignment.id,
      volunteer_person_id: String(assignment.volunteer_person_id),
      street_key: key,
      // Falling back to the key keeps the row readable even if a client ever sends only
      // the key; the label is only ever display text.
      street_label: input.street?.trim() || key,
      canvasser_name: await this.personFirstLast(tenant_id, String(assignment.volunteer_person_id)),
      expires_at: new Date(Date.now() + SEGMENT_CLAIM_TTL_MS),
    });
    return { ok: true };
  }

  /**
   * What this volunteer can walk: the turfs they are on, plus — only when they may
   * roam — the unclaimed rest of their campaign.
   *
   * Occupied turfs are NOT filtered out of `available`. Joining a turf someone is
   * already on is the group-canvassing case, so each carries its canvasser count and
   * the volunteer decides.
   */
  public async getMyTurfs(sessionToken: string | null): Promise<CompanionTurfChoices> {
    const session = await this.companionAccess.resolveSession(sessionToken);
    const tenant_id = session.tenant_id;

    const [mineIds, rows, progress, canvassers, mayRoam, campaigns] = await Promise.all([
      this.assignments.activeTurfIdsForVolunteer({ tenant_id, volunteer_person_id: session.person_id }),
      this.turfsRepo().getTurfs(tenant_id),
      this.knocks.getProgressByTenant(tenant_id),
      this.assignments.canvassersByTurf({ tenant_id }),
      volunteerMayRoam(this.knocks.db, { tenant_id, can_roam: session.can_roam }),
      this.campaignsRepo.getSwitcherList({ tenant_id }),
    ]);

    const mineSet = new Set(mineIds);
    const myCampaigns = this.roamableCampaigns({ campaigns, mineIds, session, turfs: rows });
    const campaignNames = new Map(campaigns.map((c) => [String(c.id), c.name]));

    const toChoice = (r: (typeof rows)[number]): CompanionTurfChoice => {
      const p = progress.get(r.id);
      return {
        turf_id: r.id,
        name: r.name,
        ward: r.ward,
        doors: r.door_count,
        attempted: p?.attempted ?? 0,
        canvassers: (canvassers.get(r.id) ?? []).length,
        centroid_lat: r.centroid_lat,
        centroid_lng: r.centroid_lng,
        campaign_name: campaignNames.get(String(r.campaign_id ?? '')) ?? null,
      };
    };

    return {
      may_roam: mayRoam,
      mine: rows.filter((r) => mineSet.has(r.id)).map(toChoice),
      available: mayRoam
        ? rows
            .filter((r) => !mineSet.has(r.id) && r.status !== 'retired')
            .filter((r) => myCampaigns.has(String(r.campaign_id ?? '')))
            .map(toChoice)
        : [],
    };
  }

  /**
   * Which campaigns a roaming volunteer may reach.
   *
   * Placed volunteers stay inside the campaigns they already work in — roaming widens
   * reach, it does not cross campaigns. A volunteer with no assignment yet is the case
   * roaming exists FOR: approval is the trust decision, so they bootstrap from the
   * campaign their join code named, or from every active campaign in the workspace when
   * they came in some other way. Archived campaigns are read-only history and are never
   * a bootstrap, but an existing assignment in one still counts — that turf is already
   * theirs and the picker must keep showing it.
   *
   * Both the picker and self-claim read this, so a listed turf is always claimable.
   */
  private roamableCampaigns(input: {
    campaigns: readonly { id: unknown; status: string }[];
    mineIds: readonly string[];
    session: { join_campaign_id: string | null };
    turfs: readonly TurfRow[];
  }): Set<string> {
    const mineSet = new Set(input.mineIds);
    const placed = input.turfs.filter((r) => mineSet.has(r.id)).map((r) => String(r.campaign_id ?? ''));
    if (placed.length > 0) return new Set(placed);

    const active = new Set(input.campaigns.filter((c) => c.status !== 'archived').map((c) => String(c.id)));
    const fromJoinCode = input.session.join_campaign_id;
    if (fromJoinCode && active.has(fromJoinCode)) return new Set([fromJoinCode]);
    return active;
  }

  /**
   * Self-claim a turf. Mints this volunteer's own assignment exactly as an organizer
   * would, so everything downstream is identical to being placed by hand.
   *
   * Refused when the volunteer may not roam — enforced here, not merely hidden in the
   * picker, because the endpoint is reachable directly.
   */
  public async claimTurf(sessionToken: string | null, turfId: string): Promise<{ turf_id: string }> {
    const session = await this.companionAccess.resolveSession(sessionToken);
    const tenant_id = session.tenant_id;

    const existing = await this.assignments.findActiveForVolunteer({
      tenant_id,
      turf_id: turfId,
      volunteer_person_id: session.person_id,
    });
    // Already on it — return success rather than an error. Two taps on a slow
    // connection should not read as a failure.
    if (existing) return { turf_id: turfId };

    if (!(await volunteerMayRoam(this.knocks.db, { tenant_id, can_roam: session.can_roam }))) {
      throw new ForbiddenError('Your organizer assigns turfs for this campaign.');
    }

    const turf = await this.turfsRepo().getTurfCore({ tenant_id, id: turfId });
    if (!turf) throw new NotFoundError('Turf not found');
    if (turf.status === 'retired') throw new BadRequestError('That turf has been retired.');

    // Same campaign guard as the picker, so a guessed turf id cannot reach further
    // than the list would have offered.
    const [mineIds, all, campaigns] = await Promise.all([
      this.assignments.activeTurfIdsForVolunteer({ tenant_id, volunteer_person_id: session.person_id }),
      this.turfsRepo().getTurfs(tenant_id),
      this.campaignsRepo.getSwitcherList({ tenant_id }),
    ]);
    const myCampaigns = this.roamableCampaigns({ campaigns, mineIds, session, turfs: all });
    if (!myCampaigns.has(String(turf.campaign_id ?? ''))) {
      throw new ForbiddenError('That turf belongs to another campaign.');
    }

    // A volunteer has no CRM account, so the responsible actor is the staff member who
    // cut the turf — the same honest-attribution rule synced knocks follow (§22.7).
    // Metadata records who actually did it and through what.
    const actor = turf.createdby_id;
    const token = generateTurfToken();
    const expiresAt = await this.assignmentExpiry(tenant_id, String(turf.campaign_id ?? ''));
    await this.assignments.transaction().execute(async (trx) => {
      await this.assignments.create(
        {
          tenant_id,
          turf_id: turfId,
          team_id: null,
          token,
          user_id: actor,
          volunteer_person_id: session.person_id,
          expires_at: expiresAt,
        },
        trx,
      );
      await this.turfsRepo().update(
        { tenant_id, id: turfId, row: { status: 'active', updatedby_id: actor, updated_at: new Date() } },
        trx,
      );
    });

    const volunteerName = await this.personFirstLast(tenant_id, session.person_id);
    await this.userActivity.log({
      tenant_id,
      user_id: actor,
      activity: 'assign',
      entity: 'turf',
      entity_id: turfId,
      metadata: {
        action: 'turf_self_claimed',
        volunteer_person_id: session.person_id,
        message: `${volunteerName} started on this turf`,
        via: 'Canvass Companion',
      },
    });

    return { turf_id: turfId };
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
    return this.applyCompanionOps(assignment, ops);
  }

  /** Sync results for a turf reached by session + turf id (see `getCompanionTurfBySession`). */
  public async postCompanionResultsBySession(
    sessionToken: string | null,
    turfId: string,
    ops: CompanionOpType[],
  ): Promise<{ acks: CompanionOpAck[] }> {
    return this.applyCompanionOps(await this.assignmentForSession(sessionToken, turfId), ops);
  }

  private async applyCompanionOps(
    assignment: CompanionContext,
    ops: CompanionOpType[],
  ): Promise<{ acks: CompanionOpAck[] }> {
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
        // Acks go back to an unauthenticated companion device — only the app's own
        // error family carries client-safe messages (same rule as the public routes).
        acks.push({
          op_id: op.op_id,
          status: 'rejected',
          error: publicMessageOf(err, 'Could not record this result.'),
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
        await insertKnock({ person_id: personId, outcome: op.payload.result, notes: op.payload.note ?? null });
        await this.applyPersonResultSideEffects(trx, {
          tenant_id,
          turf_id,
          person_id: personId,
          actor,
          result: op.payload.result,
          note: op.payload.note ?? null,
        });
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

  /**
   * The writes a one-tap person code triggers, in the op's transaction.
   *
   * `not_home` / `moved` / `refused` are reports of a visit and change nothing about the
   * person — the knock row IS the record. The two that do change something are corrections
   * to the file, and both were previously impossible to make from a doorstep:
   *
   * - **deceased** stamps `deceased_at` and sets `do_not_contact`. Sending one more letter
   *   to a dead person is the single most damaging thing a campaign's data can do, so the
   *   suppression is not optional and does not wait for staff review. The date is only ever
   *   set once — a second report must not overwrite when we first learned it.
   * - **data_error** writes nothing to the person. A volunteer saying "this record is
   *   wrong" is a report, not a diagnosis, and guessing which field they meant would be
   *   worse than leaving it alone. It opens a task for the campaign admin instead, so a
   *   human with the full record decides. One open task per person at a time — a family of
   *   four with a wrong address should not become four identical tasks.
   */
  private async applyPersonResultSideEffects(
    trx: Transaction<Models>,
    input: {
      tenant_id: string;
      turf_id: string;
      person_id: string;
      actor: string;
      result: CompanionPersonResult;
      note: string | null;
    },
  ): Promise<void> {
    const { tenant_id, person_id, actor, result, note } = input;

    if (result === 'deceased') {
      await trx
        .updateTable('persons')
        .set({ deceased_at: new Date(), do_not_contact: true, updatedby_id: actor, updated_at: new Date() })
        .where('tenant_id', '=', tenant_id)
        .where('id', '=', person_id)
        .where('deceased_at', 'is', null)
        .execute();
      // The DNC has to land even on a person already marked deceased by an earlier knock —
      // the guarded update above skips them entirely.
      await trx
        .updateTable('persons')
        .set({ do_not_contact: true, updatedby_id: actor, updated_at: new Date() })
        .where('tenant_id', '=', tenant_id)
        .where('id', '=', person_id)
        .where('do_not_contact', '=', false)
        .execute();
      return;
    }

    if (result !== 'data_error') return;

    const open = await trx
      .selectFrom('tasks')
      .select(['id'])
      .where('tenant_id', '=', tenant_id)
      .where('person_id', '=', person_id)
      .where('status', 'in', [...TASK_OPEN_STATUSES])
      .where('name', 'like', `${DATA_ERROR_TASK_PREFIX}%`)
      .executeTakeFirst();
    if (open) return;

    const person = await trx
      .selectFrom('persons')
      .select(['first_name', 'last_name'])
      .where('tenant_id', '=', tenant_id)
      .where('id', '=', person_id)
      .executeTakeFirst();
    const who = [person?.first_name, person?.last_name].filter(Boolean).join(' ') || 'a resident';
    const campaignId = await this.resolveKnockCampaignId(tenant_id, input.turf_id);
    const admin = campaignId
      ? await trx
          .selectFrom('campaigns')
          .select(['admin_id'])
          .where('tenant_id', '=', tenant_id)
          .where('id', '=', campaignId)
          .executeTakeFirst()
      : null;

    await trx
      .insertInto('tasks')
      .values({
        tenant_id,
        name: `${DATA_ERROR_TASK_PREFIX} ${who}`.slice(0, 200),
        details: note?.trim()
          ? `A canvasser flagged this record at the door:\n\n${note.trim()}`
          : 'A canvasser flagged this record at the door without saying what was wrong.',
        status: 'todo',
        priority: 'low',
        person_id,
        // Falls back to the staff account whose link is being walked. Somebody real owns it
        // either way — an unassigned task is one nobody notices.
        assigned_to: admin?.admin_id != null ? String(admin.admin_id) : actor,
        createdby_id: actor,
        updatedby_id: actor,
      } as OperationDataType<'tasks', 'insert'>)
      .execute();
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

      // "65 or older" — exactly two transitions, never a blanket write.
      //
      // The toggle ships `false` on every survey, including the overwhelming majority where
      // nobody thought about age, so writing it straight through would assert "under 65"
      // about the entire turf. Instead: an ON toggle sets true where it is not already
      // true, and an OFF toggle only clears a value that was actually true — which is a
      // canvasser correcting a mis-tap or an earlier mistake, since the client pre-fills the
      // toggle from what the CRM already holds. A never-recorded person stays NULL.
      if (survey.senior) {
        await trx
          .updateTable('persons')
          .set({ senior: true, updated_at: new Date(), updatedby_id: actor })
          .where('tenant_id', '=', tenant_id)
          .where('id', '=', personId)
          .where((eb) => eb.or([eb('senior', 'is', null), eb('senior', '=', false)]))
          .execute();
      } else {
        await trx
          .updateTable('persons')
          .set({ senior: false, updated_at: new Date(), updatedby_id: actor })
          .where('tenant_id', '=', tenant_id)
          .where('id', '=', personId)
          .where('senior', '=', true)
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

  /**
   * Authorize a session-first request against one turf.
   *
   * Two independent checks, and both matter: the session says who they are (and that an
   * admin approved them), the active assignment says they belong on this turf. Roaming
   * changes who may CREATE an assignment — never who may read one they do not have.
   */
  private async assignmentForSession(sessionToken: string | null, turfId: string): Promise<CompanionContext> {
    const session = await this.companionAccess.resolveSession(sessionToken);
    const mine = await this.assignments.findActiveForVolunteer({
      tenant_id: session.tenant_id,
      turf_id: turfId,
      volunteer_person_id: session.person_id,
    });
    if (!mine) throw new NotFoundError('You are not on this turf.');
    if (mine.expires_at && mine.expires_at < new Date()) {
      throw new NotFoundError('This canvassing link is invalid or has been retired.');
    }
    return mine;
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

  /**
   * Residents per household — names, DNC, and the two door-recorded person flags.
   *
   * Still payload-minimized (spec §2): no emails, phones, donations or notes. `last_name`
   * travels separately from the joined `name` so the walk list can fold a shared surname
   * into one line instead of printing it once per resident on a phone-width row.
   */
  private async peopleByHousehold(tenant_id: string, household_ids: string[]): Promise<Map<string, ResidentRow[]>> {
    const map = new Map<string, ResidentRow[]>();
    if (household_ids.length === 0) return map;
    const rows = await this.knocks.db
      .selectFrom('persons')
      .select(['id', 'household_id', 'first_name', 'last_name', 'do_not_contact', 'deceased_at', 'senior'])
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
        last_name: r.last_name ?? null,
        dnc: Boolean(r.do_not_contact),
        deceased: r.deceased_at != null,
        senior: r.senior ?? null,
      });
      map.set(hid, list);
    }
    return map;
  }

  /**
   * Support + turnout as the CRM already knows them, for the people at these doors.
   *
   * Read from `campaign_person_facts` in the TURF's campaign, so a writ-period walk shows
   * the election's read on a voter rather than the office's. Empty map when the turf has
   * no campaign — an unknown context must show "unknown", never another campaign's answer.
   */
  private async priorFactsByPerson(
    tenant_id: string,
    campaign_id: string,
    person_ids: string[],
  ): Promise<Map<string, { support: SupportLevel | null; voting_status: VotingStatus | null }>> {
    const map = new Map<string, { support: SupportLevel | null; voting_status: VotingStatus | null }>();
    if (!campaign_id || person_ids.length === 0) return map;
    const rows = await this.knocks.db
      .selectFrom('campaign_person_facts')
      .select(['person_id', 'support_level', 'voting_status'])
      .where('tenant_id', '=', tenant_id)
      .where('campaign_id', '=', campaign_id)
      .where('person_id', 'in', person_ids)
      .execute();
    for (const r of rows) {
      map.set(String(r.person_id), {
        support: isSupportLevel(r.support_level) ? r.support_level : null,
        voting_status: isVotingStatus(r.voting_status) ? r.voting_status : null,
      });
    }
    return map;
  }

  /**
   * Which of these doors already has a yard sign coming.
   *
   * "Open" is the same pair of statuses the Deliveries intake guard uses (`new` |
   * `approved`) — a delivered sign is a sign already in the ground, and the walk list marks
   * that differently from one still owed. Campaign-scoped for the same reason as the facts
   * above: a request raised for the office is not a promise the election campaign made.
   */
  private async openYardSignHouseholds(
    tenant_id: string,
    campaign_id: string,
    household_ids: string[],
  ): Promise<Set<string>> {
    if (!campaign_id || household_ids.length === 0) return new Set<string>();
    const rows = await this.knocks.db
      .selectFrom('delivery_requests')
      .select(['household_id'])
      .where('tenant_id', '=', tenant_id)
      .where('campaign_id', '=', campaign_id)
      .where('household_id', 'in', household_ids)
      .where('status', 'in', ['new', 'approved'])
      .execute();
    return new Set(rows.map((r) => String(r.household_id)));
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

  private displayStatus(
    row: TurfRow,
    attempted: number,
    lastAt: Date | null,
    hasCanvassers: boolean,
  ): TurfDisplayStatus {
    switch (row.status) {
      case 'retired':
        return 'retired';
      case 'draft':
        return 'draft';
      case 'active': {
        if (row.door_count > 0 && attempted >= row.door_count) return 'complete';
        if (lastAt && Date.now() - lastAt.getTime() <= IN_FIELD_WINDOW_MS) return 'in_field';
        // Volunteers can be removed from the roster one at a time, so an 'active'
        // turf can end up with nobody on it. Reading that back as "assigned" would
        // claim someone is walking it. Derive the truth from the roster instead of
        // writing turfs.status on every removal.
        return hasCanvassers ? 'assigned' : 'draft';
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
    apt?: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
  }): string {
    const line = [d.street_num, d.street1].filter(Boolean).join(' ');
    // The unit goes second, where a courier and a canvasser both look for it. Bare digits
    // get "Unit" in front so "302" can't read as part of the street number.
    const apt = d.apt?.trim();
    const unit = apt ? (/^[\d\s-]+$/.test(apt) ? `Unit ${apt}` : apt) : null;
    const tail = [d.city, d.state, d.zip].filter(Boolean).join(', ');
    return [line, unit, tail].filter(Boolean).join(', ') || 'Address unavailable';
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
