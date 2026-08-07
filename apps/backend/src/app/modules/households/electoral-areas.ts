import type { AliasedRawBuilder, Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';

import type { Models, OperationDataType } from '../../../../../../libs/common/src/lib/kysely.models';

type Db = Kysely<Models> | Transaction<Models>;

/**
 * Electoral geography for households, read and written through `household_districts`.
 *
 * A household is inside several boundaries at the same time — a federal riding AND a state
 * legislative district AND a municipal ward AND a precinct. The three old text columns on
 * `households` (district, precinct, ward) could hold three answers, so every geocoding pass
 * overwrote the previous one. `household_districts` holds one row per household per boundary set
 * instead, with UNIQUE (household_id, set_id), and the meaning of a set lives in
 * `boundary_sets.role`, never in the area's name (a Toronto ward elects a councillor; a
 * Massachusetts ward elects nobody and only groups precincts).
 *
 * Two derived values come out of that table for grids and smart lists:
 *
 * | Field | What it is |
 * | --- | --- |
 * | `electoral_area` | The household's area in ONE set — the campaign's seat set. Single value, so it sorts and compares exactly. |
 * | `any_electoral_area` | Every area the household is in, joined together. This is what makes "everyone in precinct 12" expressible when the precinct set is not the campaign's seat set. |
 */

/** Separator between area names in `any_electoral_area`. Display and matching both see it. */
export const ELECTORAL_AREA_SEPARATOR = ' · ';

/**
 * Which boundary set supplies the single-valued `electoral_area` column.
 *
 * Resolution order:
 *  1. A seat-area set matching the active campaign's jurisdiction, and its region and chamber when
 *     the campaign names them (a set covering the whole country has a NULL region and still
 *     matches; a US state legislature draws its two houses on two different maps, which is why
 *     chamber is compared at all).
 *  2. Any set the workspace holds, seat-area sets first and then newest. A workspace whose only map
 *     is a precinct list still gets a usable column.
 *  3. None — the column is NULL and the grid shows nothing, which is the honest answer for a
 *     workspace that has not imported, uploaded or drawn a map yet.
 */
export async function resolveSeatSetId(db: Db, tenantId: string, campaignId?: string | null): Promise<string | null> {
  const campaign = campaignId
    ? await db
        .selectFrom('campaigns')
        .select(['jurisdiction', 'office_region', 'chamber'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', campaignId)
        .executeTakeFirst()
    : undefined;

  const jurisdiction = campaign?.jurisdiction ?? null;
  const region = campaign?.office_region ?? null;
  const chamber = campaign?.chamber ?? null;

  if (jurisdiction) {
    let matchQuery = db
      .selectFrom('boundary_sets')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('role', '=', 'seat_area')
      .where('jurisdiction', '=', jurisdiction);
    if (region) {
      matchQuery = matchQuery.where((eb) => eb.or([eb('region', 'is', null), eb('region', '=', region)]));
    }
    if (chamber) {
      matchQuery = matchQuery.where((eb) => eb.or([eb('chamber', 'is', null), eb('chamber', '=', chamber)]));
    }
    // `id desc` breaks created_at ties deterministically: one multi-row INSERT (an import creating
    // several sets) stamps every row with the same now().
    const matched = await matchQuery.orderBy('created_at', 'desc').orderBy('id', 'desc').limit(1).executeTakeFirst();
    if (matched?.id != null) return String(matched.id);
  }

  const fallback = await db
    .selectFrom('boundary_sets')
    .select('id')
    .where('tenant_id', '=', tenantId)
    .orderBy(sql`(role = 'seat_area')`, 'desc')
    .orderBy('created_at', 'desc')
    // Same tie: single-statement inserts share now(), so the newest id decides.
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  return fallback?.id != null ? String(fallback.id) : null;
}

/**
 * Where a household sits relative to the seat the campaign is actually contesting.
 *
 * Most campaigns do not need to know which of Ontario's 124 ridings a door is in. They need to know
 * whether it is in THEIRS. These are the only four answers, and they are deliberately distinct:
 *
 * | Value | Means |
 * | --- | --- |
 * | `in` | Inside the riding this campaign is running in. |
 * | `other` | Inside the map, in a different riding. The riding's name is still on the household. |
 * | `outside` | Checked, and inside none of the map's areas — outside Ontario, or outside Canada. |
 * | `unknown` | Not answered yet: no coordinates, or no match pass since the map was added. |
 *
 * `outside` and `unknown` are the pair worth keeping apart. Both show no riding, and conflating
 * them would tell someone their Vancouver donor is "not in Milton" before anything had looked.
 */
export type SeatStatus = 'in' | 'other' | 'outside' | 'unknown';

/** The seat set, when it was added, and every area the campaign represents. */
export interface SeatContext {
  setId: string | null;
  /** The seat set's `updated_at` (falling back to `created_at`). See {@link seatStatusSelect}. */
  setStampedAt: Date | null;
  /**
   * Every area the campaign represents, trimmed. Empty when it represents none.
   *
   * Usually one — a provincial candidate contests one riding. Several for a seat made of several
   * areas, such as a regional councillor elected by two wards; a door in either is in their
   * territory. Empty for an at-large office (a mayor, a governor), which contests a whole city or
   * state rather than one area of it, so there is nothing to be inside or outside of. That is the
   * distinction that keeps a mayoral campaign seeing every ward listed rather than one singled out.
   *
   * NOT `campaigns.seat_name`, which is the single district name printed on a tax receipt and, for
   * a municipal candidate, is the city rather than the ward.
   */
  seatAreaNames: readonly string[];
}

/**
 * Everything the seat-status expression needs, resolved once per request.
 *
 * Split from {@link resolveSeatSetId} rather than folded into it because that function has other
 * callers (tag ranking) that want only the id and should not pay for the extra reads.
 */
export async function resolveSeatContext(db: Db, tenantId: string, campaignId?: string | null): Promise<SeatContext> {
  const setId = await resolveSeatSetId(db, tenantId, campaignId);

  const set =
    setId == null
      ? undefined
      : await db
          .selectFrom('boundary_sets')
          .select(['created_at', 'updated_at'])
          .where('tenant_id', '=', tenantId)
          .where('id', '=', setId)
          .executeTakeFirst();

  const areas = campaignId
    ? await db
        .selectFrom('campaign_areas')
        .select(['name'])
        .where('tenant_id', '=', tenantId)
        .where('campaign_id', '=', campaignId)
        .execute()
    : [];

  const seatAreaNames = areas.map((area) => area.name.trim()).filter((name) => name.length > 0);
  const stamped = set?.updated_at ?? set?.created_at ?? null;

  return { setId, setStampedAt: stamped == null ? null : new Date(stamped), seatAreaNames };
}

/**
 * The `seat_status` column: in my riding, another riding, outside the map, or not answered yet.
 *
 * Reads two things the lateral join cannot supply on its own — `hd_areas.electoral_area` from the
 * lateral, and `households.boundary_checked_at` from the outer query — so this belongs in the outer
 * SELECT next to them, not inside `electoralAreaSelects`.
 *
 * The `boundary_checked_at` comparison is what makes `outside` truthful. That column records when a
 * match pass last examined the household **at all**, not per map, so a household matched last week
 * against a ward map has a non-NULL stamp and has still never been tested against a riding map
 * added this morning. Reporting that household as "outside Ontario" would be a confident wrong
 * answer, so a stamp older than the map itself reads as `unknown` until the match job catches up.
 */
export function seatStatusSelect(
  seatSetId: string | null,
  seatAreaNames: readonly string[],
  setStampedAt: Date | null,
): AliasedRawBuilder<SeatStatus | null, 'seat_status'> {
  // No map, or an office that represents no named area: the question does not apply, and NULL says
  // so more honestly than inventing a fifth state.
  if (seatSetId == null || seatAreaNames.length === 0) {
    return sql<SeatStatus | null>`null::text`.as('seat_status');
  }

  const checked =
    setStampedAt == null
      ? sql<boolean>`households.boundary_checked_at is not null`
      : sql<boolean>`households.boundary_checked_at is not null and households.boundary_checked_at >= ${setStampedAt}`;

  // Compared case-insensitively and trimmed: an area name is typed by a person in the campaign form
  // and read from a publisher's file on the map, so "milton " and "Milton" must not read as two
  // different ridings. `= any(...)` rather than a chain of ORs so a seat made of a dozen areas
  // builds one parameter instead of a dozen.
  const wanted = seatAreaNames.map((name) => name.trim().toLowerCase());

  return sql<SeatStatus>`case
    when hd_areas.electoral_area is not null
      and lower(btrim(hd_areas.electoral_area)) = any(${wanted}) then 'in'
    when hd_areas.electoral_area is not null then 'other'
    when ${checked} then 'outside'
    else 'unknown'
  end`.as('seat_status');
}

/**
 * The same four-way answer as {@link seatStatusSelect}, for ONE household on a detail page.
 *
 * The list screens get this as a column inside their own query. A record page loads one household
 * and cannot reuse that, so this answers it directly. The rules are identical on purpose — a person
 * reading "Outside the map" on a list and something different on the record would be a defect —
 * including the timestamp comparison that keeps a household checked before the map was added
 * reading as unanswered rather than as outside it.
 *
 * Returns null when the question does not apply: no household, no map for this office, or a
 * campaign that represents no named area because it is elected at large.
 */
export async function seatStatusForHousehold(
  db: Db,
  tenantId: string,
  householdId: string | null,
  campaignId: string | null,
): Promise<SeatStatus | null> {
  if (!householdId) return null;

  const seat = await resolveSeatContext(db, tenantId, campaignId);
  if (seat.setId == null || seat.seatAreaNames.length === 0) return null;

  const [area, household] = await Promise.all([
    db
      .selectFrom('household_districts')
      .select(['name'])
      .where('tenant_id', '=', tenantId)
      .where('household_id', '=', householdId)
      .where('set_id', '=', seat.setId)
      .executeTakeFirst(),
    db
      .selectFrom('households')
      .select(['boundary_checked_at'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', householdId)
      .executeTakeFirst(),
  ]);

  if (area?.name) {
    const wanted = new Set(seat.seatAreaNames.map((name) => name.trim().toLowerCase()));
    return wanted.has(area.name.trim().toLowerCase()) ? 'in' : 'other';
  }

  const checkedAt = household?.boundary_checked_at == null ? null : new Date(household.boundary_checked_at);
  if (checkedAt == null) return 'unknown';
  if (seat.setStampedAt != null && checkedAt < seat.setStampedAt) return 'unknown';
  return 'outside';
}

/** The two grid/rule field keys that read the lateral `hd_areas` aliases. */
const ELECTORAL_FIELD_KEYS: readonly string[] = ['electoral_area', 'any_electoral_area'];

/**
 * Whether a grid request's filters actually read the electoral columns.
 *
 * The COUNT half of a grid query pays for the lateral aggregate over `household_districts` on
 * every row and never reads its output, so the repos attach that join to the count only when this
 * returns true. It answers on PRESENCE (a column filter that would apply, or any rule node naming
 * an electoral field), erring toward true: a rule the rule-builder later drops for an empty value
 * costs one redundant join, while a false negative would be a query that references an alias whose
 * join is missing.
 */
export function referencesElectoralAreas(
  filterModel: Record<string, { op?: string; value?: unknown } | undefined>,
  advancedFilterModel: unknown,
): boolean {
  for (const key of ELECTORAL_FIELD_KEYS) {
    const filter = filterModel[key];
    if (!filter) continue;
    const op = filter.op ?? 'contains';
    // Mirrors applyColumnFilter's no-op rule: only isEmpty/isNotEmpty apply without a value.
    if (op === 'isEmpty' || op === 'isNotEmpty') return true;
    if (filter.value != null && String(filter.value).trim() !== '') return true;
  }
  return advancedNodeReferencesElectoral(advancedFilterModel);
}

/** Rule nodes (new shape or legacy) carry a string `field`; group nodes carry `rules`. */
function advancedNodeReferencesElectoral(node: unknown): boolean {
  if (node == null || typeof node !== 'object') return false;
  const rec = node as { field?: unknown; rules?: unknown };
  if (typeof rec.field === 'string') return ELECTORAL_FIELD_KEYS.includes(rec.field);
  if (Array.isArray(rec.rules)) return rec.rules.some((child) => advancedNodeReferencesElectoral(child));
  return false;
}

/**
 * The two aggregate expressions selected inside a lateral join over `household_districts`.
 *
 * The caller aliases the table as `hd` and correlates it to its own household, e.g.
 *
 * ```ts
 * .leftJoinLateral(
 *   (eb) => eb.selectFrom('household_districts as hd')
 *     .whereRef('hd.household_id', '=', 'households.id')
 *     .whereRef('hd.tenant_id', '=', 'households.tenant_id')
 *     .select(electoralAreaSelects(seatSetId))
 *     .as('hd_areas'),
 *   (join) => join.onTrue(),
 * )
 * ```
 *
 * The subquery aggregates with no GROUP BY, so it returns exactly one row per household even when
 * the household matches no boundary at all. That is the point: a plain join would multiply every
 * household row by its number of boundaries, and the surrounding queries aggregate tags with
 * `array_agg`, which would then repeat every tag once per boundary.
 */
export function electoralAreaSelects(
  seatSetId: string | null,
): [AliasedRawBuilder<string | null, 'electoral_area'>, AliasedRawBuilder<string | null, 'any_electoral_area'>] {
  const seat =
    seatSetId == null
      ? sql<string | null>`null::text`
      : sql<string | null>`max(hd.name) filter (where hd.set_id = ${seatSetId})`;
  return [
    seat.as('electoral_area'),
    sql<string | null>`string_agg(distinct hd.name, ${sql.lit(ELECTORAL_AREA_SEPARATOR)} order by hd.name)`.as(
      'any_electoral_area',
    ),
  ];
}

/**
 * A correlated scalar version of `any_electoral_area`, for queries that cannot carry a lateral join
 * (the duplicate-comparison select builds its own `selectFrom('potential_duplicates')` chain).
 * `householdsTable` is the alias the outer query gave the households table.
 */
export function anyElectoralAreaSubquery(householdsTable = 'households') {
  const table = sql.raw(householdsTable);
  return sql<string | null>`(
    select string_agg(distinct hd.name, ${sql.lit(ELECTORAL_AREA_SEPARATOR)} order by hd.name)
    from household_districts hd
    where hd.household_id = ${table}.id and hd.tenant_id = ${table}.tenant_id
  )`;
}

/**
 * One boundary a household falls inside, named together with the map that drew it.
 *
 * The map's label travels with the area on purpose: "Ward 4" and "Ottawa Centre" say nothing on
 * their own, and a household is normally inside several boundaries at once, so a reader has to be
 * told which map each answer came from. This is the shape the household detail page renders, one
 * row per entry.
 */
export interface HouseholdAreaListing {
  /** `boundary_sets.label` — what this workspace calls the map, e.g. "Wards". */
  set_label: string;
  /** `household_districts.name` — the area itself, e.g. "Ward 4". */
  name: string;
}

/**
 * Display order for one household's boundaries: seat areas first, then subdivisions, then
 * localities.
 *
 * A seat area elects somebody, so it is the answer a campaign asks for first. A subdivision
 * (precinct, polling division) is a piece of one, useful once the seat is known. A locality (city,
 * township) is context rather than a contest. Within a rank the map's own label breaks the tie, so
 * two loads of the same household list its boundaries in the same order every time.
 */
const AREA_ROLE_ORDER = sql`case bs.role when 'seat_area' then 0 when 'subdivision' then 1 else 2 end`;

/**
 * Every boundary each of the given households falls inside, keyed by household id.
 *
 * Takes a list of households and issues ONE query for all of them, so a page showing many
 * households does not turn into one query per household — and, since the rows arrive already
 * joined to their sets, never one query per boundary either. A household with no boundaries is
 * simply absent from the returned map; callers treat that as an empty list, which is the honest
 * answer for a workspace that has not imported, uploaded or drawn a map yet.
 *
 * Rows whose name is blank are dropped rather than shown as an empty line.
 */
export async function listHouseholdAreas(
  db: Db,
  tenantId: string,
  householdIds: readonly string[],
): Promise<Map<string, HouseholdAreaListing[]>> {
  const byHousehold = new Map<string, HouseholdAreaListing[]>();
  if (householdIds.length === 0) return byHousehold;

  const rows = await db
    .selectFrom('household_districts as hd')
    .innerJoin('boundary_sets as bs', (join) =>
      join.onRef('bs.id', '=', 'hd.set_id').onRef('bs.tenant_id', '=', 'hd.tenant_id'),
    )
    .select(['hd.household_id as household_id', 'bs.label as set_label', 'hd.name as name'])
    .where('hd.tenant_id', '=', tenantId)
    .where('hd.household_id', 'in', [...householdIds])
    .where('hd.name', '!=', '')
    .orderBy(AREA_ROLE_ORDER)
    .orderBy('bs.label')
    .orderBy('hd.name')
    .execute();

  for (const row of rows) {
    const householdId = String(row.household_id);
    const areas = byHousehold.get(householdId) ?? [];
    areas.push({ set_label: row.set_label, name: row.name });
    byHousehold.set(householdId, areas);
  }
  return byHousehold;
}

/** Every boundary ONE household falls inside, in display order. Empty when it is on no map. */
export async function getHouseholdAreas(
  db: Db,
  tenantId: string,
  householdId: string,
): Promise<HouseholdAreaListing[]> {
  const byHousehold = await listHouseholdAreas(db, tenantId, [householdId]);
  return byHousehold.get(String(householdId)) ?? [];
}

/**
 * One electoral column a CSV may carry, and the boundary set its values land in.
 *
 * Accepting these columns is the cheapest way a workspace gets real electoral geography: a
 * purchased US voter file already names the congressional district, both legislative district
 * numbers and the precinct on every row, so taking them writes `household_districts` directly with
 * no polygon data and — this is the part that matters — no paid address lookup at all.
 *
 * Each column gets its OWN set rather than sharing one, because a file that carries both a city
 * council "District" column and a "CD" column is naming two genuinely different boundaries, and
 * collapsing them would recreate the overwrite bug this whole table exists to fix.
 *
 * `role` follows the ordinary meaning of the word. Ward is a seat area, which is right in Ontario
 * and for US council wards and wrong in Massachusetts; a Massachusetts workspace that imports both
 * a Ward and a Precinct column still ends up with the precinct set marked `subdivision`, which is
 * what turf cutting reads, so the practical outcome is correct there too.
 */
export interface ImportedAreaSetSpec {
  /** The import field key. The CSV wizard maps a header to this, and the row arrives under it. */
  field: string;
  /** `boundary_sets.slug` — unique per tenant, so the set is created once and reused. */
  slug: string;
  /** `boundary_sets.label` — what a person sees in the boundaries list. */
  label: string;
  /** `boundary_sets.role` — where an area's meaning lives. */
  role: 'seat_area' | 'subdivision';
}

export const IMPORTED_AREA_SETS: readonly ImportedAreaSetSpec[] = [
  {
    field: 'electoral_district',
    slug: 'imported-electoral-district',
    label: 'Districts / ridings (from a spreadsheet)',
    role: 'seat_area',
  },
  {
    field: 'congressional_district',
    slug: 'imported-congressional-district',
    label: 'Congressional districts (from a spreadsheet)',
    role: 'seat_area',
  },
  {
    field: 'legislative_district',
    slug: 'imported-legislative-district',
    label: 'Legislative districts (from a spreadsheet)',
    role: 'seat_area',
  },
  {
    field: 'state_house_district',
    slug: 'imported-state-house-district',
    label: 'State house districts (from a spreadsheet)',
    role: 'seat_area',
  },
  {
    field: 'state_senate_district',
    slug: 'imported-state-senate-district',
    label: 'State senate districts (from a spreadsheet)',
    role: 'seat_area',
  },
  { field: 'ward', slug: 'imported-ward', label: 'Wards (from a spreadsheet)', role: 'seat_area' },
  {
    field: 'precinct',
    slug: 'imported-precinct',
    label: 'Precincts / polling divisions (from a spreadsheet)',
    role: 'subdivision',
  },
] as const;

/** The import field keys, in the order the wizard should offer them. */
export const IMPORTED_AREA_FIELDS: readonly string[] = IMPORTED_AREA_SETS.map((s) => s.field);

const SPEC_BY_FIELD = new Map(IMPORTED_AREA_SETS.map((s) => [s.field, s]));

/**
 * Pull the electoral values out of one raw import row, trimmed, blanks dropped.
 * Returns an empty object when the file carried none, which is the common case.
 */
export function readImportedAreas(raw: Record<string, string>): Record<string, string> {
  const areas: Record<string, string> = {};
  for (const spec of IMPORTED_AREA_SETS) {
    const value = (raw[spec.field] ?? '').toString().trim();
    if (value.length > 0) areas[spec.field] = value;
  }
  return areas;
}

/**
 * Create the `source: 'import'` boundary sets for the fields this file actually carried, on first
 * use, and return their ids by field. Sets carry no polygons at all — the area name arrived already
 * assigned per household, so there is nothing to match against.
 *
 * Idempotent: UNIQUE (tenant_id, slug) absorbs a concurrent or repeated import.
 */
export async function ensureImportedBoundarySets(
  db: Db,
  tenantId: string,
  userId: string,
  fields: readonly string[],
  jurisdiction: string,
): Promise<Map<string, string>> {
  const specs = fields.map((f) => SPEC_BY_FIELD.get(f)).filter((s): s is ImportedAreaSetSpec => s != null);
  if (specs.length === 0) return new Map();

  await db
    .insertInto('boundary_sets')
    .values(
      specs.map(
        (spec) =>
          ({
            tenant_id: tenantId,
            slug: spec.slug,
            label: spec.label,
            jurisdiction,
            role: spec.role,
            source: 'import',
            createdby_id: userId,
          }) as OperationDataType<'boundary_sets', 'insert'>,
      ),
    )
    .onConflict((oc) => oc.columns(['tenant_id', 'slug']).doNothing())
    .execute();

  const rows = await db
    .selectFrom('boundary_sets')
    .select(['id', 'slug'])
    .where('tenant_id', '=', tenantId)
    .where(
      'slug',
      'in',
      specs.map((s) => s.slug),
    )
    .execute();

  const idBySlug = new Map(rows.map((r) => [r.slug, String(r.id)]));
  const idByField = new Map<string, string>();
  for (const spec of specs) {
    const id = idBySlug.get(spec.slug);
    if (id) idByField.set(spec.field, id);
  }
  return idByField;
}

/** One (household, boundary set) pair to record. */
export interface HouseholdAreaRow {
  household_id: string;
  set_id: string;
  name: string;
  code: string | null;
}

/**
 * Insert or refresh `household_districts` rows on whatever handle is passed, WITHOUT opening a
 * transaction of its own.
 *
 * That restriction is the whole reason this exists next to `applyHouseholdMatches` in
 * lib/gis/boundary-match.ts. That function opens its own transaction, and Kysely does not implement
 * a nested transaction as a savepoint — `TransactionBuilder.execute` issues a fresh BEGIN and a
 * COMMIT on the same connection, so calling it from inside an existing transaction would commit the
 * outer one early. Callers that already hold a transaction (the CSV import, `addMany`) use this;
 * callers that do not (a single household edited in the UI) use `applyHouseholdMatches`, which also
 * clears stale geometry-derived rows.
 *
 * A fresh household has no rows yet, so "insert" and "replace" are the same thing here. The
 * conflict clause covers a re-import of an address the workspace already had.
 */
export async function upsertHouseholdAreas(
  db: Db,
  tenantId: string,
  rows: readonly HouseholdAreaRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  await db
    .insertInto('household_districts')
    .values(
      rows.map(
        (row) =>
          ({
            tenant_id: tenantId,
            household_id: row.household_id,
            set_id: row.set_id,
            name: row.name,
            code: row.code,
          }) as OperationDataType<'household_districts', 'insert'>,
      ),
    )
    .onConflict((oc) =>
      oc.columns(['household_id', 'set_id']).doUpdateSet({
        name: (eb) => eb.ref('excluded.name'),
        code: (eb) => eb.ref('excluded.code'),
        matched_at: sql<Date>`now()`,
      }),
    )
    .execute();
  return rows.length;
}

/**
 * Write one batch of households' imported areas into `household_districts`. The file is
 * authoritative, so a repeated import of the same address refreshes the name rather than being
 * ignored.
 */
export async function writeImportedAreas(
  db: Db,
  tenantId: string,
  entries: readonly { household_id: string; areas: Record<string, string> }[],
  setIdByField: ReadonlyMap<string, string>,
): Promise<number> {
  const rows: HouseholdAreaRow[] = [];
  for (const entry of entries) {
    for (const [field, name] of Object.entries(entry.areas)) {
      const setId = setIdByField.get(field);
      if (!setId) continue;
      rows.push({ household_id: entry.household_id, set_id: setId, name, code: null });
    }
  }
  return upsertHouseholdAreas(db, tenantId, rows);
}
