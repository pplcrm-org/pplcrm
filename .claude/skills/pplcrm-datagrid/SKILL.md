---
name: pplcrm-datagrid
description: "The custom DataGrid (pc-datagrid): the AbstractAPIService DI contract, ColumnDef shape, server-side fetch options, inline editing with undo + cell flash, selection/bulk actions, the grid→detail record-navigation handoff, and the DI traps that break grid tests. USE WHEN adding a list/grid page for an entity, adding or changing grid columns, wiring inline editing or a custom cell renderer, changing toolbar actions (delete/export/import/add), debugging a grid that loads nothing, or writing tests that touch a grid. EXAMPLES: 'make the status column editable', 'why does my grid test never call getAll', 'my grid renders no rows'."
---

# pplCRM DataGrid (`pc-datagrid`)

The grid is a **house-built component**, not AG Grid — `ColumnDef` mimics a slice of AG Grid's
API for familiarity, but only what `grid-defaults.ts` declares actually works. Everything lives
in `apps/frontend/src/app/shared/components/datagrid/`: `datagrid.ts` (the `DataGrid`
component), `controllers/` (fetch, editing, keyboard, pinning, reorder, resizing, virtualizer),
`services/` (data, filters, selection, columns, tag-options, …), `ui/` (toolbar, filter
dropdowns/panel, row), `undo-redo-mgr.ts`, and `datagrid.tokens.ts` (config token).

## The DI contract: the grid finds its data source itself

A grid page never passes data in. `FetchController` (and other grid services) `inject(AbstractAPIService)`,
so the hosting component **must provide the entity service under that token** plus the config token:

```ts
// teams-grid.ts — the minimal real consumer; copy this shape
providers: [
  { provide: AbstractAPIService, useExisting: TeamsService },
  provideDataGridConfig({ messages: { exportEntity: 'teams', exportFileName: 'teams-export.csv' } }),
],
```

Template: `<pc-datagrid title="Teams" [colDefs]="col" [disableDelete]="false" [disableView]="false"
[addRoute]="'add'" plusIcon="add-group">`. Toolbar features are opt-in/out via inputs —
`disableDelete`/`disableView`/`disableExport`/`disableImport`/`disableMerge`/`disableRefresh`,
`allowFilter`, `enableSelection`, `rowCanSelect`, `showToolbar`, `showArchiveIcon`,
`showColumnsButton` (the toolbar Columns picker; off for fixed-column grids like Donations),
`showQueryBuilder` (the Advanced-query-builder entry points; off keeps simple filters) — read the
input block in `datagrid.ts` for the full list before adding a new input; the flag you want
probably exists. `provideDataGridConfig` merges per-grid copy (delete/export dialog text,
failure messages) and `pageSize` over `DEFAULT_DATA_GRID_CONFIG` (`datagrid.tokens.ts`).

**Always set `entityNoun`/`entityNounPlural` in `provideDataGridConfig`** — the toolbar's
create button derives its label from it as **"New {noun}"** ("New person", "New household");
without it the button says just "New" (a UX-guidelines violation, §4b). The same nouns feed
the export menu label and bulk-action messages.

Simple grid: `teams-grid.ts`. Full-featured grid (tag options, custom delete confirm, loading
gate): `persons-grid.ts`. Every grid's `(importCSV)` handler navigates to the shared CSV import
wizard (`/imports/new?type=people|companies|households|tasks`, spec §17) — the old in-grid
modal importer (`pc-csv-importer`) was deleted; the per-entity mapping heuristics now live in
`experiences/imports/import-entity-config.ts`.

Two Wave-0 additions: `totalSentence` (string input, e.g. "5,012 people total") replaces the
header's default "{n} total" wording and composes with the filtered count ("43 match your
filters · 5,012 people total"); and a `[pcGridBelowHeader]` content-projection slot renders
between the header and the toolbar — the People grain tabs (`pc-grain-tabs` in
`shared/components/grain-tabs/`, switching /people ↔ /households ↔ /companies) project there
on all three People-grain grids.

## Height contract: the grid scrolls, the pagination footer stays pinned

The grid fills whatever height the page grants (`:host { display:block; height:100%; min-height:0 }`
in `datagrid.css`); inside, the table scroller is `flex-1 overflow-auto`, column headers are
sticky (`thead th` pins at `top:0`, z-30 above the z-10/z-20 pinned body cells), and the
pagination row sits **outside** the scroller so it's always visible at the bottom. On the last
page an "End of list · N {nouns}" divider renders under the final row so a short page reads as
complete, not as missing data. Grain/titled grids pad themselves `px-6 pt-6 pb-2` (deliberately
tight below the pinned footer).

**A standalone grid page must pass viewport height down or the footer un-pins and the whole
page scrolls.** The routed component needs `host: { class: 'block h-full' }` and its wrapper div
`h-full min-h-0` (see `persons-grid`/`households-grid`/`companies-grid`). If the grid stacks
with siblings (header above, footer copy below — see `lists-grid`), keep the wrapper `h-full
flex-col` and give `<pc-datagrid>` itself `class="min-h-0 flex-1"`. In auto-height parents
(list-view tabs) `height:100%` resolves to auto and the grid grows naturally with the page; in a
definite-height box (list-form's `h-96` preview) it fills the box and scrolls internally.

## Filter entry points: the chip row, not the toolbar

The filter **entry points** live in the **filter-chip row** in `datagrid.html` (rendered when
`showToolbar()` and any of `allowFilter()/showTagFilter()/showIssueFilter()/showListFilter()`),
**not** in the desktop toolbar. The row is: a muted funnel marker · the active `filterChips()`
(soft-primary `bg-primary/10` pills with an ✕, removed via `removeFilterChip`) · `Clear all` ·
then four always-present **dashed-border pills** — `+ Add filter`, `Tags`, `Issues`, `Lists`.
The Tags/Issues/Lists pills are DaisyUI `<details class="dropdown">` hosting the same
`pc-dg-filter-dropdown` + `pc-multiselect-filter`/`pc-singleselect-filter` pickers the toolbar
used to own, bound to the grid's `selectedTags/selectedIssues/selectedListId` + toggle methods.
`+ Add filter` is a quick field→operator→value popover that writes one entry into the shared
`filterValues` model (`applyAddFilter`) — the same model column/panel filters use, so it lands
as one removable `kind:'column'` chip; it does **not** fork a parallel filter representation.

The **desktop toolbar** (`ui/datagrid-toolbar.html`) is now a single rounded/bordered button
group — Refresh · Undo · Redo · │ · Import/Export · │ · Filter-funnel (`onToggleFilters`, tinted
via `anyFilterActive()`) · Filter-panel (query builder) · │ · Columns · Archive — with the solid
`+ New {noun}` button **outside** the group, always right-most. The Tags/Issues/Lists icon buttons were removed from
the desktop toolbar (the mobile toolbar still has its own combined filter dropdown).

The All/Donors/Volunteers segmented control (`narrowTypeOptions`/`showNarrowTypeFilter`) is still
a shared capability but is **no longer wired on the People grid** — donor/volunteer are tag
filters. To re-enable a segmented control on some grid, pass `[narrowTypeOptions]`.

## Columns: `ColumnDef` in `grid-defaults.ts`

`{ field, headerName, editable }` is the common case. Also supported: `valueFormatter`
(display), `valueGetter`/`valueSetter` (read/write indirection), `cellRenderer` (returns string
or `HTMLElement`), `cellClass`, `comparator`, `hide`, `tagColumn`, `onCellClicked`,
`isCellInteractive`. Props beyond that interface are silently ignored — don't paste AG Grid
options and expect them to work. Rows are `GridRow = Record<string, unknown>` (`types.ts`);
formatters/getters receive `CellParams` (`data`, `value`, `newValue`, `colDef`).

## Fetching is server-side; the grid only holds a page

`FetchController.loadPage` assembles `getAllOptions` — search term, tag/issue filters, the
column filter model, advanced-filter model (query builder), sort state, archive mode, `listId` —
and calls `AbstractAPIService.getAll` / `getAllArchived`, all inside the grid's own loading
gate. `totalCountAll` comes from the response `count`; paging math derives from it. So:

- A grid that renders but never shows rows usually means the `AbstractAPIService` provider is
  missing/wrong, not a template bug. Fetch failures toast `config.messages.loadFailed`.
- New filter behavior belongs in the options the backend understands (see `getAllOptionsType`
  in `libs/common`) — not in client-side row filtering.

## Inline editing: optimistic, undoable, flashed

`EditingController.commitSingleCell` is the whole story: honor `valueSetter` if present,
otherwise assign; skip if unchanged; call `AbstractAPIService.update(id, payload)`; **on failure
revert the row, pop the undo snapshot, toast "Update failed"**; on success update row caches,
toast "Row updated", and flash the cell (`triggerCellFlash` → `td.cell-flash` keyframe in
`datagrid.css`, the canonical success-feedback motion from `pplcrm-design-principles` §7).
Undo/redo (`undo-redo-mgr.ts`) snapshots rows/selection/filters/sorting/paging as
`GridSnapshot` (`types.ts`) around every commit — if you add a new mutation path, push a
snapshot the same way or undo will skip your change. Rows with `deletable: false` block edits
to `name` (`shouldBlockEdit`).

## Selection, bulk actions, and the grid→detail handoff

Selection state is a `selectedIdSet` in `GridStoreService`; `selectAllMatching()` asks the
backend for **all ids matching the current filters** (not just the page), enabling the
"all N matching" selection sentence and bulk actions. Delete/export run through
`ConfirmDialogService` with copy from the config token.

On record open the grid calls `captureRecordNavContext(entityKey)` →
`fetchCtrl.selectAllMatching()` → `recordNav.setContext(entityKey, ids, count)`. That context is
what powers the detail page's "N of M filtered" pager and J/K navigation — consumption side is
owned by `pplcrm-page-layout-ux`. If prev/next is missing on a detail page, check this handoff
fired (it requires arriving via the grid, by design).

## Test traps (all three have burned real sessions)

1. **Provide service mocks via DI, at TestBed setup.** `FetchController` injects
   `AbstractAPIService` itself — swapping a service property on the component instance after
   creation silently misses the fetch path. Use
   `providers: [{ provide: AbstractAPIService, useValue: mock }]`.
2. **`whenStable()` does not flush the grid's init.** `ngOnInit` kicks off fire-and-forget
   async work that `whenStable()` doesn't track — flush with `setTimeout`/tick loops before
   asserting on rows.
3. Components that render `pc-record-activities` alongside a grid need an `ActivityService`
   mock or TestBed creation fails.

General Vitest conventions → `pplcrm-testing`.

## Shared visual contract with `pc-table`

The grid's **look** (micro-caps header, cell density, shell border/radius) is not its own — it
comes from the global `.pc-table` / `.pc-table-shell` token contract in `styles.css`, which the
lighter `pc-table` shell also consumes so bespoke tables (Tags/Issues/Donations) stay identical.
The grid's `<table>` carries `class="table pc-table …"`, its `<th>` deliberately omits font/size
utilities (the shared `.pc-table thead th` rule supplies the micro-caps), and `datagrid.css`
reads `--pc-table-cell-py` for density. The grid keeps its **zebra + `hover:bg-base-300/40`** as a
scale adaptation that overrides the shared subtle hover — base-300 as the hue because a base-200
tint would vanish on the base-200 zebra stripes, at 40% opacity so hovering is a wash, not a flash. If you change the grid's table
typography/density/border, you are changing every table in the app — do it in the token contract,
not inline. Full details in **`pplcrm-table`**.

## Non-goals

- **The lighter presentational table for non-grid surfaces, and the shared token contract** → `pplcrm-table`.
- **Detail-page composition and the pager that consumes the nav context** → `pplcrm-page-layout-ux`.
- **Design rules the grid already embodies** (filter chips, empty state, saved-flash motion,
  semantic tokens) → `pplcrm-design-principles`; don't restyle the grid against them.
- **The backend `getAll` implementation** behind `AbstractAPIService` → `pplcrm-trpc-backend`.
- **Adding the whole entity the grid lists** (service, routes, detail view) → `pplcrm-add-entity`;
  this skill is only the grid step.
