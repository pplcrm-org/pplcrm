---
name: pplcrm-lists
description: The Lists feature (§8) — smart vs static membership, the rule-builder field contract (what a rule field must be wired into on BOTH sides or it is silently dropped), campaign scoping of a stored definition, and the built-in undeletable "All Subscribers" / "All Volunteers" lists. USE WHEN adding or changing a field the rule builder can filter on, touching modules/lists or experiences/lists, debugging a smart list that matches nothing or the wrong people, changing what a list definition stores, or working on the built-in/system lists. EXAMPLES 'add "last donated" to the list rule dropdown', 'my smart list matches zero people', 'why can I not delete All Volunteers', 'make a new built-in list'.
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
   `modules/households/repositories/households.repo.ts`. Booleans and numerics need
   `{ col: 'x.y::text', isCast: true }` — every operator is ILIKE-based, so the rule
   compares against `'true'` / `'false'`.
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
