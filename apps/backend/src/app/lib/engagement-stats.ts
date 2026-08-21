import { sql } from 'kysely';

/**
 * The activity-history rule fields (2026-08-20): computed numbers a smart-list rule can
 * compare — days since the last gift / door knock / newsletter open / event registration /
 * volunteer shift, dollars given this calendar year, and an active-pledge yes/no. Served by
 * one LEFT JOIN LATERAL (`pstats` on people queries, `hstats` on household queries) whose
 * select list is all correlated scalar subqueries, so it returns exactly one row per parent
 * and never multiplies the outer row (same reasoning as the `hd_areas` electoral lateral).
 *
 * Campaign scoping: donations, pledges, knocks and event registrations are facts of one
 * campaign context, so they filter on the caller's `options.campaignId` — same contract as
 * `campaign_person_facts` ('0' matches nothing, and a stored list definition gets the list's
 * own campaign merged in by scopedDefinition). Newsletter opens and volunteer shifts are
 * tenant-wide: an open is an open, and `volunteer_events` carries no campaign column.
 *
 * "Days ago" fields are NULL when the thing never happened, which the rule builder's
 * "is set" / "is not set" operators read as has-happened / never.
 */
export const PERSON_STATS_RULE_FIELDS = [
  'last_donation_days',
  'donation_total_year',
  'has_active_pledge',
  'last_knock_days',
  'last_newsletter_open_days',
  'last_event_days',
  'last_shift_days',
] as const;

/** Households have doors, not wallets or inboxes — only knock recency applies. */
export const HOUSEHOLD_STATS_RULE_FIELDS = ['last_knock_days'] as const;

/**
 * Whether any active column filter or rule node references one of `fields` — the count query
 * attaches the stats lateral only then, keeping its predicate identical to the data query's
 * without paying the per-row subqueries when nothing reads them. Mirrors
 * referencesElectoralAreas: answers on PRESENCE, erring toward true.
 */
export function referencesStatsFields(
  filterModel: Record<string, { op?: string; value?: unknown } | undefined>,
  advancedFilterModel: unknown,
  fields: readonly string[],
): boolean {
  const fieldSet = new Set<string>(fields);
  for (const [key, filter] of Object.entries(filterModel)) {
    if (!filter || !fieldSet.has(key)) continue;
    const op = filter.op ?? 'contains';
    if (op === 'isEmpty' || op === 'isNotEmpty') return true;
    if (filter.value != null && String(filter.value).trim() !== '') return true;
  }
  return nodeReferencesFields(advancedFilterModel, fieldSet);
}

/** Rule nodes (new shape or legacy) carry a string `field`; group nodes carry `rules`. */
function nodeReferencesFields(node: unknown, fields: ReadonlySet<string>): boolean {
  if (node == null || typeof node !== 'object') return false;
  const rec = node as { field?: unknown; rules?: unknown };
  if (typeof rec.field === 'string') return fields.has(rec.field);
  if (Array.isArray(rec.rules)) return rec.rules.some((child) => nodeReferencesFields(child, fields));
  return false;
}

/** columnMapping entries for the person-stats lateral — spread in only while it is attached. */
export function personStatsMapping(): Record<string, { col: string; isCast?: boolean; numeric?: boolean }> {
  return {
    last_donation_days: { col: 'pstats.last_donation_days', numeric: true },
    donation_total_year: { col: 'pstats.donation_total_year', numeric: true },
    has_active_pledge: { col: 'pstats.has_active_pledge::text', isCast: true },
    last_knock_days: { col: 'pstats.last_knock_days', numeric: true },
    last_newsletter_open_days: { col: 'pstats.last_newsletter_open_days', numeric: true },
    last_event_days: { col: 'pstats.last_event_days', numeric: true },
    last_shift_days: { col: 'pstats.last_shift_days', numeric: true },
  };
}

/** columnMapping entries for the household-stats lateral. */
export function householdStatsMapping(): Record<string, { col: string; isCast?: boolean; numeric?: boolean }> {
  return { last_knock_days: { col: 'hstats.last_knock_days', numeric: true } };
}

/* eslint-disable @typescript-eslint/no-explicit-any -- dynamic Kysely builders (see
   pplcrm-any-exceptions): these run inside leftJoinLateral callbacks whose builder type is
   the caller's, and the correlated-subquery select items defeat the generic inference. */

/**
 * The person-stats lateral: `SELECT (subq) AS x, … ` with no FROM, one scalar subquery per
 * field, each correlated to the outer `persons` row. Alias `pstats`.
 */
export function personStatsLateral(eb: any, campaignId: string): any {
  return eb
    .selectNoFrom([
      eb
        .selectFrom('donations as d')
        .select(sql<number | null>`(current_date - max(d.created_at)::date)`.as('v'))
        .whereRef('d.tenant_id', '=', 'persons.tenant_id')
        .whereRef('d.person_id', '=', 'persons.id')
        .where('d.campaign_id', '=', campaignId)
        .where('d.status', '=', 'succeeded')
        .where('d.refunded_at', 'is', null)
        .as('last_donation_days'),
      eb
        .selectFrom('donations as d')
        .select(sql<number | null>`(sum(d.amount) / 100.0)`.as('v'))
        .whereRef('d.tenant_id', '=', 'persons.tenant_id')
        .whereRef('d.person_id', '=', 'persons.id')
        .where('d.campaign_id', '=', campaignId)
        .where('d.status', '=', 'succeeded')
        .where('d.refunded_at', 'is', null)
        .where('d.created_at', '>=', sql`date_trunc('year', now())`)
        .as('donation_total_year'),
      eb
        .selectFrom('donation_pledges as dp')
        .select(sql<boolean>`(count(*) > 0)`.as('v'))
        .whereRef('dp.tenant_id', '=', 'persons.tenant_id')
        .whereRef('dp.person_id', '=', 'persons.id')
        .where('dp.campaign_id', '=', campaignId)
        .where('dp.status', '=', 'active')
        .as('has_active_pledge'),
      eb
        .selectFrom('turf_knocks as k')
        .innerJoin('turfs as t', (join: any) =>
          join.onRef('t.id', '=', 'k.turf_id').onRef('t.tenant_id', '=', 'k.tenant_id'),
        )
        .select(sql<number | null>`(current_date - max(k.knocked_at)::date)`.as('v'))
        .whereRef('k.tenant_id', '=', 'persons.tenant_id')
        .whereRef('k.household_id', '=', 'persons.household_id')
        .where('t.campaign_id', '=', campaignId)
        // 'cleared' rows are the append-only "outcome toggled off" trail, excluded everywhere.
        .where('k.outcome', '<>', 'cleared')
        .as('last_knock_days'),
      eb
        .selectFrom('person_newsletter_engagements as pne')
        .select(sql<number | null>`(current_date - max(pne.last_opened_at)::date)`.as('v'))
        .whereRef('pne.tenant_id', '=', 'persons.tenant_id')
        .whereRef('pne.email', '=', 'persons.email')
        .as('last_newsletter_open_days'),
      eb
        .selectFrom('event_registrations as er')
        .innerJoin('events as ev', (join: any) =>
          join.onRef('ev.id', '=', 'er.event_id').onRef('ev.tenant_id', '=', 'er.tenant_id'),
        )
        .select(sql<number | null>`(current_date - max(er.created_at)::date)`.as('v'))
        .whereRef('er.tenant_id', '=', 'persons.tenant_id')
        .whereRef('er.person_id', '=', 'persons.id')
        .where('er.status', '<>', 'cancelled')
        .where('ev.campaign_id', '=', campaignId)
        .as('last_event_days'),
      eb
        .selectFrom('volunteer_shifts as vs')
        .innerJoin('volunteer_events as ve', (join: any) =>
          join.onRef('ve.id', '=', 'vs.event_id').onRef('ve.tenant_id', '=', 'vs.tenant_id'),
        )
        // The shift's own start time, not the signup date — "when they last served". Future
        // signups deliberately don't count until the shift has happened.
        .select(sql<number | null>`(current_date - max(ve.start_time)::date)`.as('v'))
        .whereRef('vs.tenant_id', '=', 'persons.tenant_id')
        .whereRef('vs.person_id', '=', 'persons.id')
        .where('vs.status', '<>', 'cancelled')
        .where('ve.start_time', '<=', sql`now()`)
        .as('last_shift_days'),
    ])
    .as('pstats');
}

/** The household-stats lateral: knock recency correlated to the outer `households` row. */
export function householdStatsLateral(eb: any, campaignId: string): any {
  return eb
    .selectNoFrom([
      eb
        .selectFrom('turf_knocks as k')
        .innerJoin('turfs as t', (join: any) =>
          join.onRef('t.id', '=', 'k.turf_id').onRef('t.tenant_id', '=', 'k.tenant_id'),
        )
        .select(sql<number | null>`(current_date - max(k.knocked_at)::date)`.as('v'))
        .whereRef('k.tenant_id', '=', 'households.tenant_id')
        .whereRef('k.household_id', '=', 'households.id')
        .where('t.campaign_id', '=', campaignId)
        .where('k.outcome', '<>', 'cleared')
        .as('last_knock_days'),
    ])
    .as('hstats');
}

/* eslint-enable @typescript-eslint/no-explicit-any */
