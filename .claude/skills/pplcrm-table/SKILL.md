---
name: pplcrm-table
description: The lightweight presentational table shell (pc-table) and the shared .pc-table token contract in styles.css that every tabular surface obeys. USE WHEN building a non-datagrid table (an admin/vocabulary/ledger list), styling any table, deciding between pc-datagrid and pc-table, or changing table header/density/border look. EXAMPLES 'add a table to the settings page', 'why are my table headers not micro-caps', 'change the table row density everywhere'.
---

# pc-table & the shared table token contract

Two tools render tabular data in this app, and they deliberately share one **visual
contract** so every table reads as the same product (design §4 "one idiom per job", §8
typography). Pick the right one, and never hand-roll a third table look.

## Which one?

| Use                                                                    | When                                                                                                                                                                                                                                                            | It owns                                                                                                                                                  |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`pc-datagrid`** (`apps/frontend/src/app/shared/components/datagrid`) | A generic, homogeneous "rolodex" of records: persons, companies, households, lists, events, shifts, tasks, teams, campaigns, deliveries, forms, files, workflows.                                                                                               | Server-side fetch/sort/filter, inline editing + undo, selection → bulk actions, CSV export/import, grid→detail record-navigation. See `pplcrm-datagrid`. |
| **`pc-table`** (`libs/uxcommon/src/components/table/table.ts`)         | A bespoke table whose interaction idiom does **not** fit a generic column grid — admin/vocabulary tables (Tags, Issues), a financial ledger (Donations, Pledges), anything with merge/rename actions, callouts, proportional bars, aggregates, or custom cells. | **Chrome only**: the bordered shell, the micro-caps header row, cell density, the skeleton-loading idiom, an optional footer. Nothing else.              |

**Do not force a bespoke table into `pc-datagrid`** — you will re-implement its escape hatches
and lose. **Do not hand-roll a raw `<table>`** — you will drift off the shared look (this is
exactly the drift `pc-table` was created to end: Tags/Issues/Donations had three different
shells, header styles, hovers and loading treatments before the 2026-07-09 unification).

## The shared token contract (single source of truth)

Defined **globally** in `apps/frontend/src/styles.css` — a `:root` custom-property block plus a
`@layer components` block with `.pc-table-shell` and `.pc-table`:

- `--pc-table-header-size` (10.5px) / `--pc-table-header-tracking` (0.07em) → the refined
  micro-caps header eyebrow (§8). Applied via `.pc-table thead th`.
- `--pc-table-body-size` (0.75rem = `text-xs`) → **the default size of every body cell**,
  applied via `.pc-table tbody`. DaisyUI's `.table` would otherwise leave bodies at `text-sm`.
  **Never add `text-sm` to a data cell** — that re-introduces the pre-contract drift. Prose
  inside a body (a guided empty state) may still opt up with a per-instance `text-sm` utility.
- `--pc-table-cell-py` (0.375rem) → row density. Applied via `.pc-table :where(th, td)`.
- `--pc-table-radius` (0.75rem) + `border-base-300` + `bg-base-100` → the `.pc-table-shell`.
- `.pc-table tbody tr:hover` → a subtle `base-200` row hover.

**Change a value here and every table — both `pc-table` and the datagrid — moves together.**
That is the whole point. Never re-introduce a per-table header size, shell border, or hover.

Why global (not component-scoped CSS): `pc-table` **projects** each page's bespoke `<tr>`/`<td>`
into its own `<tbody>`, and Angular's emulated encapsulation cannot reach projected rows. Global
component classes reach both the projected content and the datagrid's own markup — which is what
lets one contract cover both.

### How the datagrid consumes it

`datagrid.html`'s `<table>` carries `class="table pc-table …"` and its `<th>` no longer sets
`text-xs uppercase font-medium` (the `.pc-table thead th` rule now provides the micro-caps);
its `<tbody>` likewise no longer sets `text-xs` (the `.pc-table tbody` body-size rule provides it);
`datagrid.css` reads `padding-block: var(--pc-table-cell-py)`; the scroller border is
`border-base-300`. The datagrid keeps its **zebra striping + `hover:bg-base-300`** — a deliberate
scale adaptation for long data tables that overrides the shared hover from the Tailwind utilities
layer. Zebra is _not_ part of the shared chrome; short admin tables don't want it.

## Using pc-table

Import `Table` from `@uxcommon/components/table/table` (exported from `@uxcommon` too) and add it
to the component `imports`. The consumer keeps full control of every cell and of the **empty
state** (per-entity by design — §3: name the cause + one action; a shared empty state would be
wrong).

```html
<pc-table [loading]="loading()" [columns]="5" [skeletonRows]="5">
  <!-- header cells → projected into <thead><tr> -->
  <ng-container pcTableHead>
    <th>Tag</th>
    <th>People</th>
    <th>Last applied</th>
    <th class="w-10"></th>
  </ng-container>

  <!-- default slot: body rows + this page's own empty state. Rendered only when NOT loading;
       pc-table shows skeleton rows while loading() is true, so DO NOT also render a skeleton here. -->
  @if (visibleRows().length === 0) {
  <tr>
    <td colspan="5" class="py-12 text-center">…guided empty state with one action…</td>
  </tr>
  } @else { @for (row of visibleRows(); track row.id) {
  <tr [class.animate-saved-flash]="highlightId() === row.id">
    …bespoke cells…
  </tr>
  } }

  <!-- optional: caption/pagination hint inside the shell, below the table -->
  <div pcTableFooter class="px-4 py-3 text-xs text-base-content/50 border-t border-base-200">
    Showing the latest {{ shown() }} of {{ total() }}
  </div>
</pc-table>
```

Inputs: `columns` (required — colspan for skeleton rows), `loading` (default false),
`skeletonRows` (default 5). Slots: `[pcTableHead]`, default (body), `[pcTableFooter]`.

### Traps

- **`columns` must equal the real column count** or the loading skeleton won't span the table.
- **Don't render your own skeleton** in the default slot — pass `[loading]` and let `pc-table` do
  it, or you get double indicators (§4). If a page already shows a top `progress` bar for load
  (e.g. Donations), leave `loading` unset so you don't stack two indicators.
- **Saved-row flash** is the app-wide `animate-saved-flash` utility toggled by the consumer — not
  something `pc-table` owns. Reuse it for mutation feedback (§7).
- **Conditional `<ng-content>` is fine** here (Angular 22 control flow) — that's how the body slot
  is hidden during load; see `tool-button.ts` for the same pattern.

## Two ways to consume the contract

1. **The `<pc-table>` component** — for a **standalone** table that owns its bordered shell.
   Gives you the shell + header slot + skeleton + footer. Use this by default.
2. **The `.pc-table` class alone** — for a table **embedded in a card/panel** that already
   supplies the border (e.g. canvassing's turf/coverage/team tables inside `card` sections, the
   list-view newsletter table). Wrapping those in `<pc-table>` would double the border, so
   instead put `class="table pc-table"` on the raw `<table>`: the global rules still give it the
   shared micro-caps header + density, and the card stays the container. Also the right choice
   for a **non-list comparison matrix** (duplicates-people: fields-as-rows), where the component's
   header slot doesn't fit — the class binds it to the density token without imposing list chrome.

Rule of thumb: **has its own border → `<pc-table>`; lives inside a bordered card → `.pc-table`
class.** Either way the header/density/typography come from the one contract.

## Per-row ⋯ actions — always `pc-row-actions`, never a hand-rolled dropdown

For the trailing row-actions menu (rename/merge/delete, assign, copy link…), use
`pc-row-actions` (`libs/uxcommon/src/components/row-actions/row-actions.ts`). Project the
`<li>` items and pass `[label]` (name the record: `[label]="'Actions for ' + row.name"`);
keep destructive items last with `class="text-error"`:

```html
<td class="text-right">
  <pc-row-actions [label]="'Actions for ' + row.name">
    <li><button type="button" (click)="rename(row)">Rename</button></li>
    <li><button type="button" class="text-error" (click)="delete(row)">Delete</button></li>
  </pc-row-actions>
</td>
```

**Why it exists / why not a bare `dropdown`:** `.pc-table-shell` sets `overflow-x: auto`, which
per the CSS spec forces `overflow-y: auto` too — so the shell is a scroll container and a normal
absolutely-positioned `.dropdown-content` is **clipped** at the shell's edge (this is the exact
bug that motivated the component; no `z-index` fixes ancestor clipping). `pc-row-actions` renders
the menu as a native **`popover`** (top layer) anchored to its trigger via CSS anchor positioning

- `position-try-fallbacks: flip-block`, so it escapes every `overflow` ancestor and flips above
  the trigger near the viewport bottom. Five pages had each hand-rolled the same DaisyUI dropdown
  and drifted on width/z-index/trigger element before this was unified (2026-07-17). The same
  applies to the `.pc-table`-class-only / card-embedded case (canvassing) — the card is also an
  `overflow` context, so use `pc-row-actions` there too.

## Consumers today

Component (`<pc-table>`): Tags, Issues, Donations, Pledges, Users (`users/ui/users-page.html` —
summary line, inline role select, kebab menu, seat-aware invite dialog), deliveries-requests,
deliveries-routes, imports/exports (`imports-page.html`, two tables), forms submissions
(`forms-page.html`), donations tax-tier settings (`settings/donations/donations-settings.html`),
newsletters (`newsletters/ui/newsletters-page.html` — stat tiles + campaign table with per-row
Send…/View report actions).
Class-only (`.pc-table`): canvassing (`canvassing-page.html`, three card-embedded tables),
list-view newsletters (`lists/ui/list-view.html`), duplicates-people comparison matrix. Read one
of the matching kind before adding the next — copy the proven structure.
