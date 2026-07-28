import type { Transaction } from 'kysely';
import { sql } from 'kysely';

import { BaseRepository } from '../../../lib/base.repo';
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

const CONVERSATION = 'conversation';

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
