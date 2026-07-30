# pplCRM UX Guidelines — the lookup reference

**This is a reference, not required reading.** The doctrine — the _why_, and every principle
§0–§10 — lives in `SKILL.md` next to this file. Open this document when you need one of the
things the doctrine deliberately doesn't pin down:

| You need                                                                                                       | Section                                                                 |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| The exact class string for a button role                                                                       | [§B. Buttons](#b-buttons--the-vocabulary-one-class-string-per-role)     |
| An idiom for a job SKILL.md §4 doesn't list (multi-select filter, panel collapse, touch picker, bulk confirm…) | [§A. Extended idiom table](#a-extended-idiom-table)                     |
| A concrete pixel/weight value (type scale, sidebar, chips, timestamps)                                         | [§C. Typography & density](#c-typography--density)                      |
| Rulings the doctrine states as a principle but not as a number                                                 | [§D. Pinned rulings](#d-pinned-rulings)                                 |
| Whether a URL or error message leaks something                                                                 | [§E. Security is a surface property](#e-security-is-a-surface-property) |

Source: rulings made during the North Star prototype (`pplCRM North Star.dc.html` — open it
with Design notes on; the pins are the annotated spec). Where the doctrine and this document
disagree, the doctrine wins; where the doctrine is silent, this document rules.

## A. Extended idiom table

SKILL.md §4 assigns the idiom for the common jobs. This table covers **jobs it doesn't list**,
plus the exact geometry for ones it names without pinning.

| Job                           | The one idiom                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blocking decision (geometry)  | The **safe** action is the one styled primary — "Keep person", "Keep editing". The body must be specific enough to earn the interruption: name the fields or the count.                                                                                                                                                                                                                                                                                                                   |
| Toast (geometry)              | Max **3 stacked**; duplicates coalesce with a ×N badge; 3-line clamp; one clause — "Did X — consequence".                                                                                                                                                                                                                                                                                                                                                                                 |
| Tabs (geometry)               | `variant="underline"`: 13px labels, plain tabular-num counts, 2px primary underline on active, hairline track. `variant="pill"`: rounded-full, primary-tinted active, badge counts. Labels only, never icons; route-linked variants set `route` on the option.                                                                                                                                                                                                                            |
| Collapsible secondary content | A quiet tab row with counts (Comments 2 · Activity 6; active = primary + 600 + 2px underline; "Hide" link only while open) — or a labeled bar for panels. Pick one per surface, never both. This is a **toggle** idiom, NOT page tabs — page sections use `pc-tab-bar`.                                                                                                                                                                                                                   |
| Assign many records to one    | `pc-entity-picker` (`libs/uxcommon/src/components/entity-picker/entity-picker.ts`) — **one** panel holding search + the current selection as removable chips + a checkbox list, all driven by the `selectedIds` model. Options are `{id, label, hint?, badge?}`; the header narrates "3 of 42 volunteers selected". Never a native `<select multiple>`, and never a second read-only "currently assigned" pane beside it — that pane drifts out of sync with what will actually be saved. |
| Multi-select filter           | Checkbox picker with per-item counts; OR semantics; lands as **one** chip ("Tags: any of donor, host").                                                                                                                                                                                                                                                                                                                                                                                   |
| Status chip (geometry)        | One shape everywhere: 99px pill, 600 weight, semantic tint — warning = needs attention, info = in progress, success = done/good, neutral = inert. (Which component: `pc-status-badge`, SKILL.md §4.)                                                                                                                                                                                                                                                                                      |
| Bulk action confirm           | Preflight naming the list **and** the count; the confirm button repeats the number.                                                                                                                                                                                                                                                                                                                                                                                                       |
| Overflow (⋯) menu contents    | Labeled items with icons, dividers by group. Secondary verbs (Star, Mark as unread, Print) live here, not in the first-class row.                                                                                                                                                                                                                                                                                                                                                         |
| Related action variants       | One button + menu (Reply ▾ → Reply / Reply all / Forward), never N sibling icons.                                                                                                                                                                                                                                                                                                                                                                                                         |
| Panel collapse                | Double-chevron ⟪⟫ at panel top; collapses to an icon rail, never to nothing.                                                                                                                                                                                                                                                                                                                                                                                                              |
| Touch pickers                 | Bottom sheet, 44px rows, confirm repeats scale — implemented by the `pc-dropdown-sheet` utility (`apps/frontend/src/styles.css`). Wear it on any `.dropdown-content` or popover-mode dropdown panel and move desktop geometry behind `sm:` prefixes (`sm:w-56 sm:mt-1 sm:rounded-box`); it supplies the grab handle, scrim, 44px rows, and safe-area padding below `sm`.                                                                                                                  |

## B. Buttons — the vocabulary (one class string per role)

Every action button wears exactly the classes its **role** assigns. No other color/variant
combinations, no per-button decorations (`shadow-*`, `hover:scale-*`, `font-semibold`,
`hover:btn-*`), no `rounded-*` utilities on buttons — rounding comes from the `--radius-field`
token pinned in both theme blocks of `styles.css`.

| Role                 | Classes                                             | Rules                                                                                                                                                            |
| -------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main action          | `btn btn-primary`                                   | ONE per surface; **right-most** in any action cluster. Create actions are labeled **"New {noun}"** ("New person", "New campaign") — never "Add"/"Add person"     |
| Cancel / dismiss     | `btn btn-outline btn-accent`                        | Dialog cancels included. Exception: danger confirm-dialogs style the SAFE action `btn-primary` — `ConfirmDialogService` does this for you                        |
| Secondary action     | `btn btn-outline btn-secondary`                     | Everything actionable that isn't the main action, cancel, archive, or delete. Never `btn-outline btn-accent` (that reads as Cancel) or `btn-outline btn-primary` |
| Archive / unarchive  | `btn btn-outline btn-warning`                       | Never solid `btn-warning`                                                                                                                                        |
| Delete / destructive | `btn btn-outline btn-error`                         | Never solid `btn-error`, never a bare `text-error` label styled as a button. Inside a ⋯ overflow menu, a plain `text-error` menu item is the idiom               |
| Icon-only tertiary   | `btn btn-ghost btn-xs btn-circle` (or `btn-square`) | Needs a `title`/tooltip; color at rest if it means something (`text-error` for a per-row trash) — **never** hover-only color (`hover:btn-error`)                 |

**Sizes:** `btn-sm` at page/toolbar level (the default); `btn-xs` in dense inline contexts
(detail-header actions, in-grid rows); `w-full` allowed on auth pages and full-width card CTAs.
No one-off `min-h-*`, `px-6`, `min-w-[…]` sizing.

**Placement:** the main action is always the right-most button of its cluster; secondary actions
sit to its left; destructive actions are demoted to the ⋯ overflow or the end of a bulk bar.
Empty states keep their single CTA `btn-primary` even when the same action is secondary
elsewhere — it's the only action there.

**Toggle/selected states** (segmented pickers, day selectors) may bind `btn-accent`/`btn-outline`
conditionally to show selection — that's a state, not an action role, and is exempt from the table.

**Live reference implementation:** `pc-form-actions`
(`libs/uxcommon/src/components/form-actions/`) — save/delete/cancel already wear exactly these
classes. The list-page header (`pc-grid-header`,
`libs/uxcommon/src/components/grid-header/grid-header.ts`) is the one header idiom for EVERY
list page (datagrid pages get it automatically; custom pages project their action buttons into it).

## C. Typography & density

The numeric scale behind SKILL.md §8. Weight is hierarchy — reach for it before size or color.

- **Body/main text is `text-xs` (12px) everywhere** — detail pages, grids, settings panels,
  activity logs, dialogs. Enforced globally: the `body` rule in `styles.css` sets
  `font-size: 0.75rem` with the matching line-height, so unsized elements default to 12px and
  anything larger is an explicit opt-in — never rely on an element having no `text-*` class to
  get bigger type. One notch up (`text-sm`, 13–14px) is reserved for the field-value emphasis in
  `pc-detail-item` and for section headings paired with weight (`text-sm font-bold`). Never
  `text-base` or an arbitrary `text-[13px]` for body copy. Deliberate exception: the Help Center
  reads like documentation and stays larger.
- **Micro-labels** (eyebrows, section headers, column headers): the `.pc-eyebrow` utility
  (`styles.css`) — 11px / 600 / UPPERCASE / .08em / base-content 55%, the pinned canonical of the
  10–11.5px band. Don't hand-roll `uppercase tracking-*` stacks.
- **Sidebar:** headings 10.5px/500/.09em/45%; items 13px/.03em, active 600 + primary; count
  badges 10.5px/600 tabular-nums pills.
- **Page titles** 22px/700 (record names on detail pages); list pages use the quiet
  `pc-grid-header` title instead of a big h1. Card titles 15px/600; table text 12px (`text-xs`);
  chips 10–12px/500–600; activity-log timestamps `text-[10px]`.
- Tabular numerals on every count, range, and money value. Touch targets ≥44px.
- Font is **Inter** at body weight 400, self-hosted via `@fontsource-variable/inter` (imported in
  `styles.css`, bundled at build) — never add a `fonts.googleapis.com` link to the SPA.
  Monospace stays `ui-monospace` / system mono, for IDs, routes, and kbd hints.

## D. Pinned rulings

Cases where the doctrine states a principle and this is the specific answer.

- **A nameless record still answers "where am I?"** — the title falls back to "Unnamed person";
  it never goes blank.
- **The name is the door.** Record-opening text is underlined **at rest** (22%-opacity underline,
  3px offset), primary on hover. Not a hover-revealed affordance.
- **Explained-disabled has two forms:** a state-aware tooltip on desktop ("Select exactly 2 people
  to merge — 3 selected"), and **inline sub-text on touch**, where no hover exists.
- **Read-only is a surface with a reason and an exit**, never a disabled input — "Addresses belong
  to households… Edit on household".
- **Background work narrates itself:** "Sync now" sits beside "Synced 2 min ago"; result toasts
  count what changed.
- **Collapsing may hide detail, never identity** — collapsed rails keep the avatar; collapsed
  folder items keep icons plus count tooltips.
- **Chips are the single source of filter truth.** Panels and query builders are authoring UIs;
  whatever they produce lands as chips plus a count sentence ("43 match your filters · 5,012
  people total").
- **Counts go everywhere destinations are offered:** tab labels ("Donations 12"), folders
  ("Open 12"), segments ("Donors 611"), bulk actions ("Send to 1,284 people"), import confirms
  ("Import 131 people").

## E. Security is a surface property

URLs, titles, and copy never leak tenant IDs, internal keys, or template names. Routes use record
slugs — households and companies by name, and persons by an **opaque `public_id`**
(`/people/joseph-4t9k-2xpm`, no count-leaking name slug). Raw backend errors never reach the
UI — translate to "what should I do now".
