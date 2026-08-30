import type { Transaction } from 'kysely';
import { sql } from 'kysely';

import { BaseRepository } from '../../../lib/base.repo';
import { chunk } from '../../../lib/chunk';
import type { Models, OperationDataType } from '../../../../../../../libs/common/src/lib/kysely.models';

export interface TurfProgress {
  attempted: number;
  conversations: number;
  last_knock_at: Date | null;
}

export interface ResponseMix {
  supporter: number;
  undecided: number;
  non_supporter: number;
  not_voting: number;
  already_voted: number;
  no_answer: number;
}

export interface FieldReport {
  doors: number;
  conversations: number;
  contactRatePct: number;
  supportIds: number;
  responseMix: ResponseMix;
  perDay: { day: string; conversations: number; no_answer: number }[];
  byHour: { hour: number; conversations: number; attempts: number }[];
  byTeam: { team_id: string | null; team_name: string; doors: number; conversations: number; supportIds: number }[];
  topCanvassers: { name: string; doors: number }[];
}

/** One door's knock history inside a turf, rolled up for the turf detail page. */
export interface DoorActivity {
  attempts: number;
  conversations: number;
  last_outcome: string;
  last_response: string | null;
  last_canvasser: string | null;
  last_knocked_at: Date;
}

/**
 * What one canvasser did on one turf. Keyed by the name stored on the knock —
 * `turf_knocks` carries `canvasser_name`, not a volunteer id, so this is the only
 * attribution the data actually supports (the field report groups the same way).
 */
export interface CanvasserWork {
  name: string;
  doors: number;
  conversations: number;
  last_knock_at: Date | null;
}

/** The most recent real visit to one door, across every turf in a campaign. */
export interface LastDoorKnock {
  canvasser_name: string | null;
  conversation: boolean;
  knocked_at: Date;
}

const CONVERSATION = 'conversation';

/** The append-only "outcome toggled off" marker — a reset, not a visit. */
const CLEARED = 'cleared';

/** Payload bound for the live board's day-of-knocks read, far above any real day. */
const LIVE_KNOCK_EVENTS_CAP = 20_000;

/** One knock as the Live tab consumes it — see `getEventsSince`. */
export interface LiveKnockEvent {
  turf_id: string;
  canvasser_name: string | null;
  household_id: string;
  knocked_at: Date;
  conversation: boolean;
  support_id: boolean;
}

export class TurfKnocksRepo extends BaseRepository<'turf_knocks'> {
  constructor() {
    super('turf_knocks');
  }

  /**
   * Insert a knock, idempotent on the (tenant_id, turf_id, client_knock_id)
   * partial unique index — so an offline Companion re-sending a queued knock
   * never double-counts. Returns the new id, or null if it already existed.
   */
  public async insertIdempotent(
    row: OperationDataType<'turf_knocks', 'insert'>,
    trx?: Transaction<Models>,
  ): Promise<string | null> {
    const inserted = await this.getInsert(trx)
      .values(row)
      .onConflict((oc) =>
        oc.columns(['tenant_id', 'turf_id', 'client_knock_id']).where('client_knock_id', 'is not', null).doNothing(),
      )
      .returning('id')
      .executeTakeFirst();
    return inserted?.id != null ? String(inserted.id) : null;
  }

  /** Derived progress for every turf in the tenant, keyed by turf_id. */
  public async getProgressByTenant(tenant_id: string, trx?: Transaction<Models>): Promise<Map<string, TurfProgress>> {
    const rows = await this.getSelect(trx)
      .where('tenant_id', '=', tenant_id)
      .groupBy('turf_id')
      .select([
        'turf_id',
        sql<number>`COUNT(DISTINCT household_id)`.as('attempted'),
        sql<number>`COUNT(*) FILTER (WHERE outcome = ${CONVERSATION})`.as('conversations'),
        sql<string>`MAX(knocked_at)`.as('last_knock_at'),
      ])
      .execute();

    const map = new Map<string, TurfProgress>();
    for (const r of rows) {
      map.set(String(r.turf_id), {
        attempted: Number(r.attempted ?? 0),
        conversations: Number(r.conversations ?? 0),
        last_knock_at: r.last_knock_at ? new Date(String(r.last_knock_at)) : null,
      });
    }
    return map;
  }

  /** Doors knocked + conversations + response mix within a window (default: today). */
  public async getWindowSummary(
    input: { tenant_id: string; from: Date; to: Date },
    trx?: Transaction<Models>,
  ): Promise<{ doors: number; conversations: number; responseMix: ResponseMix }> {
    const row = await this.getSelect(trx)
      .where('tenant_id', '=', input.tenant_id)
      .where('knocked_at', '>=', input.from)
      .where('knocked_at', '<', input.to)
      .select(() => [
        sql<number>`COUNT(DISTINCT household_id)`.as('doors'),
        sql<number>`COUNT(*) FILTER (WHERE outcome = ${CONVERSATION})`.as('conversations'),
        sql<number>`COUNT(*) FILTER (WHERE response = 'supporter')`.as('supporter'),
        sql<number>`COUNT(*) FILTER (WHERE response = 'undecided')`.as('undecided'),
        sql<number>`COUNT(*) FILTER (WHERE response = 'non_supporter')`.as('non_supporter'),
        sql<number>`COUNT(*) FILTER (WHERE response = 'not_voting')`.as('not_voting'),
        sql<number>`COUNT(*) FILTER (WHERE response = 'already_voted')`.as('already_voted'),
        sql<number>`COUNT(*) FILTER (WHERE outcome <> ${CONVERSATION})`.as('no_answer'),
      ])
      .executeTakeFirst();

    return {
      doors: Number(row?.doors ?? 0),
      conversations: Number(row?.conversations ?? 0),
      responseMix: {
        supporter: Number(row?.supporter ?? 0),
        undecided: Number(row?.undecided ?? 0),
        non_supporter: Number(row?.non_supporter ?? 0),
        not_voting: Number(row?.not_voting ?? 0),
        already_voted: Number(row?.already_voted ?? 0),
        no_answer: Number(row?.no_answer ?? 0),
      },
    };
  }

  /**
   * The latest knock per (household, person) in a turf — the raw material the
   * Companion payload derives door/person state from. `person_id` null rows are
   * door-level (outcomes + the anonymous household survey). Only survey fields
   * that are safe to echo back are selected — never notes or contact info
   * (payload minimization, spec §2).
   */
  public async getCompanionState(
    input: { tenant_id: string; turf_id: string },
    trx?: Transaction<Models>,
  ): Promise<
    {
      household_id: string;
      person_id: string | null;
      outcome: string;
      response: string | null;
      issues: string[];
      wants_volunteer: boolean;
      wants_yard_sign: boolean;
      set_dnc: boolean;
      subscribe: boolean;
    }[]
  > {
    const rows = await this.getSelect(trx)
      .where('tenant_id', '=', input.tenant_id)
      .where('turf_id', '=', input.turf_id)
      .distinctOn(['household_id', 'person_id'])
      .orderBy('household_id')
      .orderBy('person_id')
      .orderBy('knocked_at', 'desc')
      .select([
        'household_id',
        'person_id',
        'outcome',
        'response',
        'issues',
        'wants_volunteer',
        'wants_yard_sign',
        'set_dnc',
        'subscribe',
      ])
      .execute();
    return rows.map((r) => ({
      household_id: String(r.household_id),
      person_id: r.person_id == null ? null : String(r.person_id),
      outcome: String(r.outcome),
      response: r.response == null ? null : String(r.response),
      issues: Array.isArray(r.issues) ? r.issues.map(String) : [],
      wants_volunteer: Boolean(r.wants_volunteer),
      wants_yard_sign: Boolean(r.wants_yard_sign),
      set_dnc: Boolean(r.set_dnc),
      subscribe: Boolean(r.subscribe),
    }));
  }

  /**
   * The most recent visit to each of these doors, campaign-wide and inside a window.
   *
   * Deliberately NOT scoped to one turf: the volunteer standing at the door cares that
   * somebody came, not which turf they were holding when they came. It IS scoped to one
   * campaign, because a door canvassed for a different race is a different conversation
   * and saying otherwise would put another campaign's work on this screen.
   *
   * `cleared` rows are excluded — that marker means an outcome was undone, so counting it
   * as a visit would tell a volunteer someone was here when the record says the opposite.
   */
  public async getLastKnockByHousehold(
    input: { tenant_id: string; campaign_id: string; household_ids: string[]; since: Date },
    trx?: Transaction<Models>,
  ): Promise<Map<string, LastDoorKnock>> {
    const map = new Map<string, LastDoorKnock>();
    // Chunked: a list refresh on an unmapped turf can grow one to universe size, and this walk
    // over its doors must degrade to more queries — not a failed statement. DISTINCT ON stays
    // correct per chunk because chunks never share a household. See chunk.ts.
    for (const ids of chunk(input.household_ids)) {
      const rows = await this.getSelect(trx)
        .innerJoin('turfs', 'turfs.id', 'turf_knocks.turf_id')
        .where('turf_knocks.tenant_id', '=', input.tenant_id)
        .where('turfs.tenant_id', '=', input.tenant_id)
        .where('turfs.campaign_id', '=', input.campaign_id)
        .where('turf_knocks.household_id', 'in', ids)
        .where('turf_knocks.knocked_at', '>=', input.since)
        .where('turf_knocks.outcome', '<>', CLEARED)
        .distinctOn('turf_knocks.household_id')
        .orderBy('turf_knocks.household_id')
        .orderBy('turf_knocks.knocked_at', 'desc')
        .select([
          'turf_knocks.household_id as household_id',
          'turf_knocks.canvasser_name as canvasser_name',
          'turf_knocks.outcome as outcome',
          'turf_knocks.knocked_at as knocked_at',
        ])
        .execute();

      for (const r of rows) {
        map.set(String(r.household_id), {
          canvasser_name: r.canvasser_name == null ? null : String(r.canvasser_name),
          conversation: String(r.outcome) === CONVERSATION,
          knocked_at: new Date(String(r.knocked_at)),
        });
      }
    }
    return map;
  }

  /** Last outcome per household in a turf, for door-list / map colouring. */
  public async getLastOutcomeByHousehold(
    input: { tenant_id: string; turf_id: string },
    trx?: Transaction<Models>,
  ): Promise<Map<string, string>> {
    const rows = await this.getSelect(trx)
      .where('tenant_id', '=', input.tenant_id)
      .where('turf_id', '=', input.turf_id)
      .groupBy('household_id')
      .select(['household_id', sql<string>`(ARRAY_AGG(outcome ORDER BY knocked_at DESC))[1]`.as('last_outcome')])
      .execute();
    const map = new Map<string, string>();
    for (const r of rows) map.set(String(r.household_id), String(r.last_outcome));
    return map;
  }

  /**
   * Every knocked door in one turf, rolled up: how many times it was tried, how
   * many of those were conversations, and what the most recent visit was. Doors
   * with no knock simply have no entry — the caller pairs this with the turf's
   * door list, so absence reads as "not yet knocked".
   */
  public async getDoorActivity(
    input: { tenant_id: string; turf_id: string },
    trx?: Transaction<Models>,
  ): Promise<Map<string, DoorActivity>> {
    const rows = await this.getSelect(trx)
      .where('tenant_id', '=', input.tenant_id)
      .where('turf_id', '=', input.turf_id)
      .groupBy('household_id')
      .select([
        'household_id',
        sql<number>`COUNT(*)`.as('attempts'),
        sql<number>`COUNT(*) FILTER (WHERE outcome = ${CONVERSATION})`.as('conversations'),
        sql<string>`(ARRAY_AGG(outcome ORDER BY knocked_at DESC))[1]`.as('last_outcome'),
        sql<string | null>`(ARRAY_AGG(response ORDER BY knocked_at DESC))[1]`.as('last_response'),
        sql<string | null>`(ARRAY_AGG(canvasser_name ORDER BY knocked_at DESC))[1]`.as('last_canvasser'),
        sql<string>`MAX(knocked_at)`.as('last_knocked_at'),
      ])
      .execute();

    const map = new Map<string, DoorActivity>();
    for (const r of rows) {
      map.set(String(r.household_id), {
        attempts: Number(r.attempts ?? 0),
        conversations: Number(r.conversations ?? 0),
        last_outcome: String(r.last_outcome),
        last_response: r.last_response == null ? null : String(r.last_response),
        last_canvasser: r.last_canvasser == null ? null : String(r.last_canvasser),
        last_knocked_at: new Date(String(r.last_knocked_at)),
      });
    }
    return map;
  }

  /**
   * Every real knock since `since`, flat — the Live tab's raw material. The controller
   * groups these per shift by (turf_id, canvasser_name, time window), which is the only
   * attribution `turf_knocks` supports (knocks carry a name, not a volunteer id).
   * `cleared` markers are excluded: an undone outcome is a reset, not a visit. Capped
   * defensively; a workspace's single day of knocking sits far below the cap.
   */
  public async getEventsSince(
    input: { tenant_id: string; since: Date },
    trx?: Transaction<Models>,
  ): Promise<LiveKnockEvent[]> {
    const rows = await this.getSelect(trx)
      .select(['turf_id', 'canvasser_name', 'household_id', 'knocked_at', 'outcome', 'response'])
      .where('tenant_id', '=', input.tenant_id)
      .where('knocked_at', '>=', input.since)
      .where('outcome', '<>', CLEARED)
      .orderBy('knocked_at', 'asc')
      .limit(LIVE_KNOCK_EVENTS_CAP)
      .execute();
    return rows.map((r) => ({
      turf_id: String(r.turf_id),
      canvasser_name: r.canvasser_name == null ? null : String(r.canvasser_name),
      household_id: String(r.household_id),
      // Not String()-round-tripped: that truncates milliseconds, and a knock landing in
      // the same second its shift opened would fall just outside the shift's window.
      knocked_at: new Date(r.knocked_at),
      conversation: String(r.outcome) === CONVERSATION,
      support_id: r.response === 'supporter',
    }));
  }

  /**
   * Per-canvasser work on one turf. `doors` counts distinct households so a
   * volunteer who tried the same door twice isn't credited twice, which is also
   * how the turf's own progress is derived.
   */
  public async getCanvasserWork(
    input: { tenant_id: string; turf_id: string },
    trx?: Transaction<Models>,
  ): Promise<CanvasserWork[]> {
    const rows = await this.getSelect(trx)
      .where('tenant_id', '=', input.tenant_id)
      .where('turf_id', '=', input.turf_id)
      .where('canvasser_name', 'is not', null)
      .groupBy('canvasser_name')
      .select([
        'canvasser_name as name',
        sql<number>`COUNT(DISTINCT household_id)`.as('doors'),
        sql<number>`COUNT(*) FILTER (WHERE outcome = ${CONVERSATION})`.as('conversations'),
        sql<string>`MAX(knocked_at)`.as('last_knock_at'),
      ])
      .execute();

    return rows.map((r) => ({
      name: String(r.name),
      doors: Number(r.doors ?? 0),
      conversations: Number(r.conversations ?? 0),
      last_knock_at: r.last_knock_at ? new Date(String(r.last_knock_at)) : null,
    }));
  }

  /** Full field-report aggregation over a window, joined to teams via assignments. */
  public async getFieldReport(
    input: { tenant_id: string; from: Date; to: Date },
    trx?: Transaction<Models>,
  ): Promise<FieldReport> {
    const tenant_id = input.tenant_id;
    const base = this.getSelect(trx)
      .where('turf_knocks.tenant_id', '=', tenant_id)
      .where('turf_knocks.knocked_at', '>=', input.from)
      .where('turf_knocks.knocked_at', '<', input.to);

    const totals = await base
      .select(() => [
        sql<number>`COUNT(*)`.as('attempts'),
        sql<number>`COUNT(*) FILTER (WHERE outcome = ${CONVERSATION})`.as('conversations'),
        sql<number>`COUNT(*) FILTER (WHERE response = 'supporter')`.as('supporter'),
        sql<number>`COUNT(*) FILTER (WHERE response = 'undecided')`.as('undecided'),
        sql<number>`COUNT(*) FILTER (WHERE response = 'non_supporter')`.as('non_supporter'),
        sql<number>`COUNT(*) FILTER (WHERE response = 'not_voting')`.as('not_voting'),
        sql<number>`COUNT(*) FILTER (WHERE response = 'already_voted')`.as('already_voted'),
      ])
      .executeTakeFirst();

    const perDayRows = await base
      .groupBy(sql`DATE(knocked_at)`)
      .orderBy(sql`DATE(knocked_at)`)
      .select(() => [
        sql<string>`DATE(knocked_at)::text`.as('day'),
        sql<number>`COUNT(*) FILTER (WHERE outcome = ${CONVERSATION})`.as('conversations'),
        sql<number>`COUNT(*) FILTER (WHERE outcome <> ${CONVERSATION})`.as('no_answer'),
      ])
      .execute();

    const byHourRows = await base
      .groupBy(sql`EXTRACT(HOUR FROM knocked_at)`)
      .orderBy(sql`EXTRACT(HOUR FROM knocked_at)`)
      .select(() => [
        sql<number>`EXTRACT(HOUR FROM knocked_at)::int`.as('hour'),
        sql<number>`COUNT(*) FILTER (WHERE outcome = ${CONVERSATION})`.as('conversations'),
        sql<number>`COUNT(*)`.as('attempts'),
      ])
      .execute();

    // One team per turf, deliberately via a DISTINCT ON subquery rather than a plain
    // join on turf_assignments. A turf accumulates one row per assignment ever made
    // (revoked ones are kept for history) and can now hold several active volunteers
    // at once, so joining the table directly multiplies every knock by the number of
    // assignment rows on its turf — the counts below would silently inflate.
    const byTeamRows = await this.getSelect(trx)
      .leftJoin(
        (eb) =>
          eb
            .selectFrom('turf_assignments')
            .select(['turf_id', 'team_id'])
            .distinctOn('turf_id')
            .where('tenant_id', '=', tenant_id)
            .where('status', '=', 'active')
            .orderBy('turf_id')
            .orderBy('assigned_at', 'desc')
            .as('ta'),
        (join) => join.onRef('ta.turf_id', '=', 'turf_knocks.turf_id'),
      )
      .leftJoin('teams', 'teams.id', 'ta.team_id')
      .where('turf_knocks.tenant_id', '=', tenant_id)
      .where('turf_knocks.knocked_at', '>=', input.from)
      .where('turf_knocks.knocked_at', '<', input.to)
      .groupBy(['ta.team_id', 'teams.name'])
      .select([
        'ta.team_id as team_id',
        'teams.name as team_name',
        sql<number>`COUNT(*)`.as('doors'),
        sql<number>`COUNT(*) FILTER (WHERE turf_knocks.outcome = ${CONVERSATION})`.as('conversations'),
        sql<number>`COUNT(*) FILTER (WHERE turf_knocks.response = 'supporter')`.as('support_ids'),
      ])
      .execute();

    const topRows = await base
      .where('canvasser_name', 'is not', null)
      .groupBy('canvasser_name')
      .orderBy(sql`COUNT(*)`, 'desc')
      .limit(10)
      .select(['canvasser_name as name', sql<number>`COUNT(*)`.as('doors')])
      .execute();

    const attempts = Number(totals?.attempts ?? 0);
    const conversations = Number(totals?.conversations ?? 0);
    const supporters = Number(totals?.supporter ?? 0);

    return {
      doors: attempts,
      conversations,
      contactRatePct: attempts > 0 ? Math.round((conversations / attempts) * 100) : 0,
      supportIds: supporters,
      responseMix: {
        supporter: supporters,
        undecided: Number(totals?.undecided ?? 0),
        non_supporter: Number(totals?.non_supporter ?? 0),
        not_voting: Number(totals?.not_voting ?? 0),
        already_voted: Number(totals?.already_voted ?? 0),
        no_answer: attempts - conversations,
      },
      perDay: perDayRows.map((r) => ({
        day: String(r.day),
        conversations: Number(r.conversations ?? 0),
        no_answer: Number(r.no_answer ?? 0),
      })),
      byHour: byHourRows.map((r) => ({
        hour: Number(r.hour ?? 0),
        conversations: Number(r.conversations ?? 0),
        attempts: Number(r.attempts ?? 0),
      })),
      byTeam: byTeamRows.map((r) => ({
        team_id: r.team_id == null ? null : String(r.team_id),
        team_name: r.team_name ? String(r.team_name) : 'Unassigned',
        doors: Number(r.doors ?? 0),
        conversations: Number(r.conversations ?? 0),
        supportIds: Number(r.support_ids ?? 0),
      })),
      topCanvassers: topRows.map((r) => ({ name: String(r.name), doors: Number(r.doors ?? 0) })),
    };
  }
}
