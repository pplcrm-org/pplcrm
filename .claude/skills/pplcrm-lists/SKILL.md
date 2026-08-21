---
name: pplcrm-lists
description: Lists (§8) — smart vs static membership, the rule-builder field contract (a rule field must be wired into BOTH the repo columnMapping and the frontend field list or it is silently dropped), the two electoral geography rule fields, campaign scoping of a stored definition, and the built-in undeletable "All Subscribers" / "All Volunteers" lists. USE WHEN adding or changing a field the rule builder can filter on, touching modules/lists or experiences/lists, filtering a list by riding/ward/precinct, debugging a smart list that matches nothing or the wrong people, or working on the built-in/system lists. EXAMPLES 'my smart list matches zero people', 'add "last donated" to the list rule dropdown', 'build a list of everyone in Ward 4', 'why can I not delete All Volunteers'.
---

# Lists (§8)

A list is a saved audience of `people` or `households`, reusable as a grid filter, a
newsletter audience, a canvassing universe, or a form's follow-up.

| Type                     | Membership                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| **Smart** (`is_dynamic`) | Re-runs `lists.definition` against live data. `map_lists_persons` is a _cache_ refreshed by the `refresh_list` job. |
| **Static**               | Ran its rules once at creation; `map_lists_persons` is the truth and only changes by hand.                          |

Refresh happens three ways: a `refresh_list` background job (on create and on definition
update), the explicit Refresh button, and a lazy enqueue in `ListsController.getOneById`
when a smart list is >24h stale. `getCurrentMembers()` bypasses the cache entirely and
re-runs the rules — that is what downstream consumers (turf cutting, automations, CSV
import) should call.

## Adding a field to the rule builder — both sides, or it silently disappears

`BaseRepository.buildGroupExpression` **drops any rule whose field is not in the repo's
`columnMapping`** (`base.repo.ts`, ~line 690). No error, no warning: the rule just stops
constraining the query, so the list quietly matches _more_ people than the UI promised.
That is the single most important trap in this feature.

A new field needs all of:

1. **Backend mapping** — add `field_name: { col: 'table.column' }` to `columnMapping` in
   `modules/persons/repositories/persons.repo.ts` (`getAllWithAddress`) and/or
   `modules/households/repositories/households.repo.ts`. Booleans need
   `{ col: 'x.y::text', isCast: true }` — the text operators are ILIKE-based, so the rule
   compares against `'true'` / `'false'`. Real numbers (2026-08-20) use `{ col: '...',
numeric: true }` instead: the compiler then supports `gt/gte/lt/lte/equals/notEquals`
   as numeric comparisons and `isEmpty/isNotEmpty` as bare `IS [NOT] NULL`, and drops any
   text operator. The seven activity-history fields (days since last donation / knock /
   newsletter open / event registration / shift, dollars this year, active pledge) come
   from correlated-scalar-subquery laterals built in `lib/engagement-stats.ts` (`pstats`
   on people, `hstats` on households), attached like the electoral lateral: always on a
   normal page's data query, only-when-referenced on the count and on membership full
   scans (`referencesStatsFields`). Their end-to-end spec is
   `modules/lists/engagement-rule-fields.spec.ts`.
2. **A join, if the column is not already reachable.** Campaign-scoped facts join on
   `options.campaignId` (see below).
3. **The selected columns + GROUP BY** in the same query — the list-builder's live preview
   filters the returned rows client-side (`list-form.ts` → `evalRule`, which reads
   `row[field]`), so a field that is filtered server-side but not _selected_ previews wrong.
4. **Frontend field entry** — `listFields` in
   `apps/frontend/src/app/experiences/lists/ui/list-form.ts`.
5. **Label (and choices, if it is an enum)** — `experiences/lists/services/list-rule-fields.ts`.

`list-rule-fields.ts` is the single source for field labels and enum choices. It feeds the
picker, the in-builder Summary line (`query-builder.ts`), and the Lists table's DEFINITION
sentence (`list-definition.ts`). Do not add a label anywhere else — those three used to
drift.

Status/enum fields use `inputType: 'select'` with `choices`, and the operator set
`is / is not / is set / is not set` — "is empty" is wrong for a NULL status, which means
"not a volunteer", not "an empty string".

Numeric fields use `inputType: 'number'` with `NUMERIC_OPERATORS` (list-form.ts) and are
listed in `NUMERIC_RULE_FIELDS` (list-rule-fields.ts), which the client-side preview
evaluator (`evalRule`) reads to compare as numbers — add a numeric field to that list or
the preview will string-compare it. NULL on these fields means "never happened", so they
use the is set / is not set wording too. Campaign scoping: donations, knocks and event
registrations filter on `options.campaignId` ('0' = match nothing); newsletter opens and
volunteer shifts are deliberately tenant-wide (`volunteer_events` has no campaign column).

## The two electoral geography fields (added 2026-08-02)

A household is inside several boundaries **at the same time** — a federal riding AND a provincial
riding AND a municipal ward AND a precinct — so one field cannot answer both questions people ask.
The rule builder therefore offers two, always together (`list-form.ts` → `electoral()`), on both
the people and the household field lists.

| Field                | What it is                                                                             | Operators                                                                           |
| -------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `electoral_area`     | The household's area in **one** set — the campaign's seat set. One value per household | equals, does not equal, contains, does not contain, starts with, is set, is not set |
| `any_electoral_area` | **Every** area the household is in, joined with `' · '` (`ELECTORAL_AREA_SEPARATOR`)   | contains, does not contain, is set, is not set                                      |

**`any_electoral_area` deliberately has no `equals`.** The value is a concatenation, so a household
in a riding AND a ward AND a precinct would never equal any single area name — offering the
operator would produce a list that silently matches nobody. That is the whole reason the two fields
have separate operator lists (`ELECTORAL_AREA_OPERATORS` / `ANY_ELECTORAL_AREA_OPERATORS` in
`list-form.ts`).

Both use **"is set" / "is not set"**, not "is empty": an absent area means the address has not been
placed on a map yet (`ruleOpUsesSetWording` in `list-rule-fields.ts`).

Labels: `ruleFieldLabel(field, seatLabel)` swaps in the **active campaign's own word** for
`electoral_area` — "Ward" for a Toronto council race, "Congressional district" for an Ohio one.
A campaign that declares no jurisdiction sits on the `'other'` default, whose seat word is
**"District"**, so that is the label such a workspace sees; the static "Electoral area" entry in
`RULE_FIELD_LABELS` (list-rule-fields.ts) is reached only when no seat word is passed at all. The
seat word is deliberately **not** applied to `any_electoral_area` ("Any electoral boundary"), which
spans every level at once and so belongs to no single word.

Backend: both columns are computed in `apps/backend/src/app/modules/households/electoral-areas.ts`
(`electoralAreaSelects(seatSetId)`) and mapped as `electoral_area: { col: 'hd_areas.electoral_area' }`
/ `any_electoral_area: { col: 'hd_areas.any_electoral_area' }` in **both** `persons.repo.ts`
(`getAllWithAddress`) and `households.repo.ts`. They come from a **lateral** join over
`household_districts` that aggregates with no GROUP BY — a plain join would multiply each household
row by its number of boundaries and make the surrounding `array_agg` repeat every tag once per
boundary. `resolveSeatSetId` picks the set behind the single-valued column: a `seat_area` set
matching the campaign's jurisdiction (and region/chamber when named), else any set the workspace
holds with seat areas first and newest first, else NULL — which is the honest answer for a
workspace that has imported, uploaded or drawn no map.

**The grids also carry one field per boundary map** (`area_set_<set id>`, see
`pplcrm-maps-geo`), which the grid's own "+ Add filter" and the advanced-filter
column mapping both accept. They are **not** in the rule-builder field list:
that list is static TypeScript, and these fields exist only for the maps a given
workspace holds. A stored smart list still expresses "everyone in Ward 4" with
`any_electoral_area contains`.

## Campaign scoping: why a rule on a campaign-scoped fact needs help

`persons.repo.getAllWithAddress` joins `campaign_person_facts` and
`campaign_subscriptions` on `options.campaignId`, defaulting to `'0'` (matches nothing).
The frontend stamps `campaignId` from `CampaignContextService`, but a **stored definition
does not carry one** — so when the backend re-runs a list's rules, `ListsController` merges
the list's own `campaign_id` in via `scopedDefinition()`. Any new code path that runs a
stored definition must do the same, or subscription/support/voting rules match zero rows.

## Built-in lists

Every campaign context always has **All Subscribers** and **All Volunteers**
(`libs/common/src/lib/system-lists.ts` defines both). They are ordinary smart lists plus
`lists.system_key`:

- `modules/lists/system-lists.ts` — `ensureSystemLists()` (idempotent insert, absorbed by
  the partial unique index `uq_lists_system_key`) and `queueSystemListRefreshes()`.
- Seeded at **signup** (`auth/controller.ts`, inside the tenant transaction) and lazily on
  every Lists read (`ListsController.getAllForContext`), which backfills older tenants and
  campaigns created later. Seeding into an **archived** campaign is skipped by design.
- Deliberately **not** in the demo manifest — that is what makes them survive exit-demo.
  `demo-seed.spec.ts` locks this.
- `ListsController` refuses to delete them (`FORBIDDEN`, never `UNAUTHORIZED`) or to change
  their name / object / is_dynamic / definition. Description stays editable.
- `lists.repo.getAllWithCounts` emits `deletable: system_key == null`, which is the generic
  datagrid contract (see `pplcrm-datagrid`) — bulk delete drops the row and inline rename is
  blocked without any list-specific grid code.

To add another built-in: append to `SYSTEM_LISTS`, extend the `chk_lists_system_key` CHECK
in a new migration, and confirm the rule's field is wired per the checklist above.

## Traps

- **Unique name.** `addList` rejects a duplicate name per tenant with `CONFLICT`, so a
  built-in's name is effectively reserved.
- **Two definition shapes.** Old lists store the rule tree under
  `definition.filterModel.tags_expression`; new ones under `definition.advancedFilterModel`.
  Both are read on load; write only the new one.
- **Specs that enqueue jobs.** Creating or refreshing a list commits `pending`
  `background_jobs` rows, so any spec touching this path must
  `useExclusiveDbLock(DB_TEST_LOCKS.BACKGROUND_JOB_QUEUE)` — otherwise it steals jobs from
  `job-claim.spec.ts` and breaks its FIFO assertions. See `pplcrm-testing`.
- **The plan gate.** The lists router is `planFeatureGate('lists')` (Grassroots+). Queries
  pass through; mutations are blocked on Free.
