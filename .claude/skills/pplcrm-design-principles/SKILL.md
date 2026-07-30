---
name: pplcrm-design-principles
description: "The app-wide UI/UX doctrine for pplCRM — the three orientation questions, disclosure over suppression, guide-don't-error, one-idiom-per-job, semantic color tokens, DaisyUI-first/CSS-over-JS, and the motion rules. USE WHEN designing or building ANY new UI (page, dialog, form, grid feature, empty state, error message), adding an animation/transition/hover effect, choosing colors, type sizes or button labels, writing user-facing copy, reviewing a UI change for polish/consistency, deciding how to surface an error or disabled state, or when asked to 'make it beautiful/modern/professional'. EXAMPLES: 'what color should this badge be', 'how should I word this error', 'should this button be disabled?', 'flash the row after save'."
---

# pplCRM design principles

The doctrine every UI decision in this app answers to. Written down so it survives any one
developer or agent. The approved source design proposals are the two artifacts:
[Grid · View · Edit — "One shell, three questions"](https://claude.ai/code/artifact/0d26dc20-3a1c-4a36-a9e9-3edeac8b2c0b)
and [Newsletter UX](https://claude.ai/code/artifact/c765baa0-9498-47ac-9a79-09e6540ebbb3).
This skill is the durable distillation; when in doubt, re-read those.

[UX-GUIDELINES.md](UX-GUIDELINES.md) in this directory is the **lookup reference** — open it
when you need an exact button class string (its §B), an idiom for a job §4 below doesn't list
(§A), a specific type/density value (§C), a pinned ruling (§D), or the leak rules for URLs and
error copy (§E). It is not required reading for every change; this file is. Where this
doctrine is silent, that document rules.

## 0. The north star: beauty is a trust proxy

The bar, verbatim from the product owner: _"the first-time user should look at it and think —
there is so much attention to detail in the frontend, the rest of it must be reliable as well."_

Users cannot see your test suite or your tenant-scoping lint rule. They infer reliability and
security from surface care: aligned edges, consistent casing, colors that survive theme switch,
buttons that say what they do. **Sloppy or inconsistent UI reads as broken functionality** — a
rainbow of off-palette stat tiles quietly says "assembled from parts", and the user starts
distrusting the data too. So polish is not decoration here; it is the confidence mechanism.

Corollary: never ship a "works but ugly" intermediate state to a user-visible surface. If the
full pattern is too big for this change, do the smaller thing _completely_ instead.

## 1. Every screen answers three questions

Judge every page — new or changed — against these before anything else:

| Question              | What it means concretely                                                                                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Where am I?**       | The title is the **record's real name** ("Amira Hassan"), never the template's name ("Person Profile"). Entity type is an eyebrow above the title. Status is a chip beside the name, not buried in a field.                                                   |
| **Where was I?**      | A named breadcrumb trail reflecting **real hierarchy** (People / Amira Hassan / Edit). No fake "Home" crumb — the sidebar logo is the way home. Returning to a grid restores it exactly (filters, page, scroll): "back" means _back_, not "start over".       |
| **Where am I going?** | Destinations carry **numbers before clicks**: tab labels have counts ("Donations 12"), the grid states "5,012 total · 43 match your filters", the detail pager says "4 of 43 filtered", a bulk action says "Send to 1,284 people". Nothing is a mystery door. |

The mechanics that implement this on detail pages (pc-detail-layout, pc-breadcrumbs,
injectRecordNavigation) are owned by **`pplcrm-page-layout-ux`** — use its checklist. This
section is the _why_ that also governs pages that skill doesn't cover (wizards, settings,
dialogs, dashboards).

## 2. Disclosure over suppression — narrate state, never hide it

A first-time user trusts the app when it narrates its own state. Whenever the UI is doing
something on the user's behalf — filtering, selecting, hiding, disabling, holding unsaved
work — it must **say so, with numbers**:

- **Filters** are visible, removable chips plus a count sentence — never state hidden inside a
  dropdown. Live example: the datagrid's chips row with "Clear all"
  (`apps/frontend/src/app/shared/components/datagrid/datagrid.html`).
- **Disabled controls explain themselves.** A greyed button with no reason is a
  confidence-killer. Either attach a state-aware tooltip that names the unmet condition
  ("Select exactly 2 people to merge — 1 selected") or hide the control if it would mislead.
  Never a bare `[disabled]` with a generic tip.
- **Dirty state is narrated, not implied**: "Unsaved changes · 2 fields" in the header, and the
  leave-guard dialog names the fields at risk (see §4).
- **Selections narrate scale**: "All 25 rows on this page are selected — select all 5,012."
- **No hover-only affordances.** If an action exists, it is visible at rest. (The old
  hover-revealed open-record icon was replaced by an always-visible first-column link for
  exactly this reason.)
- **No dead or misleading affordances.** A control must do exactly what its placement implies —
  a bookmark star on a record page that actually bookmarks the _section_ is a bug, and was
  fixed by scoping the favourite toggle to exact-route matches
  (`apps/frontend/src/app/layout/favourite-toggle/favourite-toggle.ts`).

## 3. Guide, don't error

When we can guide the user, we guide — an error message that just states failure and lets the
user guess is a design defect. In order of preference:

1. **Prevent** — make the invalid path unreachable, and say why it's unreachable (the
   explained-disabled pattern above; "Simple filters are active — clear them to use the query
   builder").
2. **Coach inline** — validation message under the field with an error icon, as the user types.
   The Save button **stays enabled** even when the form is invalid; clicking it scrolls to the
   first problem. A disabled save with no explanation is the classic dead end.
3. **Offer the exit** — every empty or failed state ends with one concrete action. The canonical
   empty state is icon + plain sentence naming the cause + one action button
   (see `datagrid.html`: funnel icon, "No results match these filters", "Clear all filters"
   button). Empty tabs use the same pattern with the record's own next step: "Not part of a
   household yet" → **Assign household**. Never an italic grey "No tags assigned" string.
4. **Fail specifically** — when something truly fails, the toast says what failed in the user's
   terms, not the exception's. Raw backend errors never reach the client (that boundary is
   owned by `pplcrm-trpc-backend`/`pplcrm-debugging`); the frontend's job is to translate the
   sanitized failure into "what should I do now".

Error/confirm copy rule: **specific enough to earn the interruption**. "Leave without saving?
Your changes to Amira Hassan (email and mobile phone) are not saved yet." Vague warnings train
users to ignore dialogs.

Corollary — **offer the way out, not just the ways to lose**. A leave prompt whose only options
are "Discard" and "Keep editing" is a trap: it interrupts the user to tell them their work is at
risk, then refuses to rescue it. Where the page can save, the prompt is a three-way `choose()`
— **Save changes** (emphasized default) / **Discard changes** / **Keep editing** — and a failed
save keeps the user on the form with their edits intact. The shared implementation is
`confirmDiscardIfDirty(recordName, save?)` in
`apps/frontend/src/app/services/unsaved-changes-guard.ts`; pass the save handler unless the page
genuinely cannot save (it falls back to the two-way confirm without one). The handler must not
navigate — the router is already mid-navigation — which is what each form's `save(done, stayPut)`
`stayPut` flag is for.

## 4. One idiom per job — the consistency contract

The difference between "designed" and "assembled" is that the same problem is always solved the
same way. These are the assigned idioms; do not invent a parallel one:

| Job                             | The one idiom                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Never                                                                                                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page frame (record views)       | `pc-detail-layout` (see `pplcrm-page-layout-ux`)                                                                                                                                                                                                                                                                                                                                                                                                                                                 | hand-rolled headers/shells                                                                                                                                                                                       |
| Door from a page to its guide   | `pc-grid-header`'s `helpArticle` input (a Help Center article id) — the ⓘ panel ends with "Read the full guide". The datagrid resolves it from the route for free via `helpArticleForRoute()` (`apps/frontend/src/app/shared/help-doors.ts`, integrity-tested so a renamed article cannot leave a dead door), and the navbar's avatar menu offers "Help for this page" from the same map. Add the section to that map when you add a page                                                        | a bespoke "Learn more" link per page, or leaving a jargon-heavy page with no way into the Help Center                                                                                                            |
| Blocking decision               | `ConfirmDialogService` (`libs/uxcommon/src/components/confirm-dialog.service.ts`) — `variant: 'danger'` for destructive; `confirm()` supports styling **cancel as the safe default** (`emphasizeCancel`), and `choose()` is the idiom whenever there is a third, non-lossy way out (leave prompts: Save / Discard / Keep editing)                                                                                                                                                                | browser `confirm()`, hand-rolled modals                                                                                                                                                                          |
| Form/tool dialog (real content) | `pc-modal-shell` (`libs/uxcommon/src/components/modal-shell/modal-shell.ts`) — house header (primary icon, bold title, ghost-circle close), `[pc-modal-footer]` action slot, declarative `[open]` or imperative `show()`/`close()`                                                                                                                                                                                                                                                               | hand-rolled `<dialog>`/`.modal-box` chrome per feature                                                                                                                                                           |
| Fire-and-forget feedback        | `AlertService.showSuccess/showError/showInfo` (`libs/uxcommon/src/components/alerts/alert-service.ts`)                                                                                                                                                                                                                                                                                                                                                                                           | `window.alert`, inline banners                                                                                                                                                                                   |
| Empty state                     | `pc-empty-state` (`libs/uxcommon/src/components/empty-state/empty-state.ts`) — icon + sentence naming the cause + one projected action; `bordered` off inside already-framed surfaces (the datagrid's in-table empty is the same pattern inline)                                                                                                                                                                                                                                                 | italic grey placeholder text, bespoke dashed containers                                                                                                                                                          |
| Kicker / section micro-label    | the `.pc-eyebrow` utility (`styles.css`) — one pinned size/weight/tracking/opacity; pair only with margin utilities                                                                                                                                                                                                                                                                                                                                                                              | hand-rolled `uppercase tracking-* text-base-content/NN` stacks                                                                                                                                                   |
| Panel / card shell              | the `.pc-panel` utility (`styles.css`) — rounded-xl, hairline base-200 border, base-100 surface, soft shadow; pair with padding/spacing utilities only (`pc-panel p-5`)                                                                                                                                                                                                                                                                                                                          | inlined `rounded-* border border-base-* bg-base-100 shadow-*` stacks                                                                                                                                             |
| Status chip                     | `pc-status-badge` (`libs/uxcommon/src/components/status-badge/status-badge.ts`) for any chip whose color communicates record state (`type`: success/warning/error/info/neutral/ghost); plain count/tag chips stay raw `badge`                                                                                                                                                                                                                                                                    | per-callsite `badge badge-success` status recipes deciding the state→color map locally                                                                                                                           |
| Async status                    | one indicator per surface via `createLoadingGate()` (`libs/uxcommon/src/loading-gate.ts`) — suppresses flicker under ~300ms; skeleton guard for first load                                                                                                                                                                                                                                                                                                                                       | double indicators (progress bar _and_ pulsing overlay), spinners that flash on fast responses                                                                                                                    |
| Icon/state toggle               | `pc-swap` (`libs/uxcommon/src/components/swap/swap.ts`) — DaisyUI swap with `rotate` (default) or `flip`                                                                                                                                                                                                                                                                                                                                                                                         | JS-driven icon switching, bespoke toggle CSS                                                                                                                                                                     |
| Tabs (page/record sections)     | one component in two variants — `pc-tab-bar` / `pc-tabs` (`libs/uxcommon/src/components/tabs/tabs.ts`) with count badges, labels only. `variant="underline"` for tabs that **switch surface** (People/Households/Companies, Forms/Responses, Requests/Routes); `variant="pill"` (default) for tabs **within** one surface (record sections, status filter rows). `pc-grain-tabs` is the reference underline row and renders through this component                                               | DaisyUI `tabs-lifted`/`tabs-bordered`/`tabs-box`, a `join` button group used as tabs, hand-rolled tab rows of either look                                                                                        |
| Row / kebab (⋯) actions         | `pc-row-actions` (`libs/uxcommon/src/components/row-actions/row-actions.ts`) — the ⋯ trigger + popover menu; project `<li>` items, pass `[label]`. Renders as a top-layer `popover` dropdown so it is never clipped by the table shell's scroll box. See `pplcrm-table`                                                                                                                                                                                                                          | a hand-rolled `dropdown dropdown-end` per page (drifts on width/z-index; gets clipped by `overflow` ancestors)                                                                                                   |
| Destructive action placement    | demoted to the ⋯ overflow menu (`pc-row-actions`), behind the danger confirm                                                                                                                                                                                                                                                                                                                                                                                                                     | Delete at equal rank beside Edit in the header                                                                                                                                                                   |
| Reorder / drag placement        | `@angular/cdk/drag-drop` — handle-only drag when the row holds interactive content (checkboxes, inputs, links); whole-card drag on kanban cards. `*cdkDragPlaceholder` uses the shared `.pc-drop-indicator` (slim rows) or `.pc-drop-slot` (card-sized) from `styles.css`; optimistic apply with rollback + error toast; always keep a click/keyboard path (up/down buttons, "+" insert). Live: newsletter blocks, tasks board, subtasks, form fields, workflow steps, route stops, ticket types | native HTML5 dragstart for new surfaces (no touch support; the datagrid header reorder is grandfathered legacy), hand-rolled pointer dragging, per-surface placeholder styling                                   |
| Any other dropdown menu         | popover-mode DaisyUI dropdown: trigger `button [attr.popovertarget]` + `ul[popover]` pinned with `anchor-name`/`position-anchor`, closed via `hidePopover()` after selection (live: `pc-email-assign`, and `pc-row-actions` which it mirrors)                                                                                                                                                                                                                                                    | focus-based `.dropdown` (`tabindex="0"` + `:focus-within`) — Safari never focuses clicked buttons, so mousedown blurs the trigger and the menu dismisses before the item's `click` fires; this bug shipped twice |

**Cursor affordance:** every clickable (route, button, link) shows `cursor-pointer`. A base-layer
rule in `apps/frontend/src/styles.css` covers `a`, enabled `button`/`[role=button]`, and `summary`
(needed because Tailwind v4 preflight makes buttons `cursor: default`, and route-reuse
reattachment can drop the UA `a[href]` pointer in Chromium). Any _other_ clickable element
(a `(click)` on a div/span/li, or inside a shared component's template) must carry the
`cursor-pointer` utility itself. Overlay/backdrop click-to-dismiss targets are the exception:
they keep the default cursor so they don't advertise themselves as buttons.

**Casing and copy:** sentence case everywhere ("Save person", "Add filter") — never ALL CAPS,
never bare verbs when a noun clarifies ("Save person" beats "Save" beats "SUBMIT"). Buttons
state exactly what they will do, with numbers when acting on a set. Create actions are labeled
**"New {noun}"** ("New person", "New campaign"), never "Add"/"Add person" — the datagrid toolbar
derives this from `entityNoun`, so every grid config must set it.

**Punctuation — the em-dash is not a default.** In user-facing copy (help articles, labels,
toasts, dialog/empty-state/error text, placeholders, tooltips), do **not** reach for the em-dash
(`—`) to join clauses. It reads as one long breathless thought; two clear sentences or a semicolon
almost always read better. Rank your options in this order:

1. **Two sentences** (a period, capitalize the next word) when the second clause can stand alone. This is the default fix and covers most cases.
2. **A semicolon** when the clauses are tightly linked and a full stop feels too hard.
3. **A colon** when a label introduces its explanation or a list ("Offline: 3 results queued").
4. **A comma or parentheses** for a short non-essential aside; convert dash-bracketed asides ("X — aside — Y") to commas or parentheses.
5. **Keep an em-dash only** when it is genuinely the best tool and every alternative reads worse (rare). Never keep one out of habit.

Legitimate non-prose dashes stay: the standalone `—` empty-value glyph in a grid cell or
interpolation, list-option separators between interpolated values, and en-dashes/hyphens in
ranges or times (`4–8 pm`, `9–5`). This rule is about **prose that connects clauses**, not glyphs.
Applies to the in-app Help Center too. (This skill's own dev-facing prose is exempt; the rule
governs what ships to users.)

**Button roles have one class string each** — main `btn-primary` (right-most, one per surface),
cancel `btn-outline btn-accent`, secondary `btn-outline btn-primary` (the outline is the
demotion — a secondary action shares the primary hue rather than adding a second one), archive
`btn-outline btn-warning`, delete `btn-outline btn-error`, icon-only tertiary
`btn-ghost btn-xs btn-circle`. The full table with sizes, placement, and exceptions is
**UX-GUIDELINES §B** — apply it verbatim; any other combination is drift. Button rounding comes
only from the `--radius-field` token in `styles.css` (both themes) — never a `rounded-*` utility
on a button. Every list page's header is `pc-grid-header` with actions projected right — never a
hand-rolled h1 + button row.

## 5. Color: semantic tokens only

The app has two DaisyUI themes defined in `apps/frontend/src/styles.css` — `light`
(primary `#0ea5e9`) and `dark` (primary `#3ea6ff`, dark
surfaces `#0b1220`–`#1a2b45`). Every token differs between them, which is exactly why:

- **Only semantic classes**: `text-base-content`, `bg-base-200`, `text-primary`, `btn-error`,
  `badge-success`. A hardcoded hue (`text-indigo-500`, `bg-[#0a66c2]`) renders identically in
  both themes and therefore _breaks_ dark mode. This is the #1 recurring violation — the old
  stat tiles hardcoded six decorative hues (indigo/emerald/amber/purple/pink/violet) and are
  the anti-example; do not copy any surviving instances.
- **Color must mean something.** Neutral content uses `base-content` shades with `primary`
  icons; color returns only to _say_ something — `success` when a number is good news, `error`
  when it needs attention, `warning` for unsaved/dirty state. Decorative rainbow = "assembled
  from parts".
- No `tailwind.config.js` exists or should exist — Tailwind v4 is configured in CSS. New tokens
  are a theme change in `styles.css`, made in **both** theme blocks, not a one-off utility.
- This applies **inside animations too**: the datagrid's saved-row flash animates
  `color-mix(in srgb, var(--color-success) 50%, transparent)` (`datagrid.css`), so the
  flash is theme-correct for free. Never hardcode a hue in a keyframe.

## 6. Prefer the platform: DaisyUI first, CSS over JavaScript

The implementation preference ladder, in order:

1. **A DaisyUI component or modifier** — `btn`, `badge`, `tab`, `tooltip`, `collapse`,
   `dropdown`, `swap`, `skeleton`, `loading`, `toast`… Check DaisyUI's catalog before building
   _any_ new widget; it ships theme-token styling, states, and accessibility for free.
2. **Plain CSS** — a transition, a keyframe, a `:hover`/`:focus-visible` rule, a grid/flex
   layout. Shared keyframes live in the `@layer utilities` block of `styles.css`;
   component-scoped ones next to the component (`datagrid.css`).
3. **TypeScript, last** — only when genuine state logic is involved (what to show, when),
   never to move pixels. The datagrid's cell flash is the model split: TS decides _which_
   cells flashed (the `flashedCells` signal in `datagrid.ts`); CSS does all the animating
   (`td.cell-flash` in `datagrid.css`).

**`btn-outline` always pairs with a color modifier.** `btn-outline` alone renders in
`base-content` and reads as a disabled/dead button next to real DaisyUI buttons. Which color is
not a per-callsite choice — it comes from the action's **role** (UX-GUIDELINES §B):
`btn-primary` for secondary actions, `btn-accent` for cancel/dismiss, `btn-error` for
destructive, `btn-warning` for archive. A bare `btn-outline`/`btn-outline btn-sm`/etc. with no
color class is never correct — fix it on sight.

This is already the house reality — the frontend has **zero** `@angular/animations` usage and
no JS animation library; keep it that way. Worked example: `pc-swap`
(`swap.ts`) is a complete animated icon toggle in ~10 lines of template — a DaisyUI
`swap swap-rotate` label, two `pc-icon`s, no animation code at all. It's used in the sidebar,
navbar, and email compose. That's the bar: if your animated widget needs a `setInterval`, a
resize observer, or manual style mutation, you're on the wrong rung of the ladder.

Old complicated approaches (jQuery-style class juggling, `ngClass` timers for transitions,
measuring DOM to animate heights) are rejected in review even when they work.

## 7. Motion: subtle, purposeful, CSS-only

Animation here is micro-delight in service of narration — the same disclosure principle as §2,
expressed in time. A good animation answers a state question the user would otherwise have to
infer: _did my save land? where did that panel come from? is this toggled on?_ If you cannot
name the state change an animation narrates, cut it.

**The blessed vocabulary** — reuse before inventing:

- **Enter/exit**: `animate-up/down/left/right`, `animate-drop` (scale-fade), and the matching
  `animate-exit-*` set — all defined once in `styles.css`, all **0.3s ease-in-out**.
  That is the house timing; don't introduce new durations casually.
- **Success feedback**: the saved-cell flash — `row-saved-flash`, 1.2s ease-out fading from
  50% success-color to transparent (`datagrid.css`), triggered after inline save and
  undo/redo. This is the canonical "your change landed" moment; reuse the pattern (semantic
  token, one-shot, fade to nothing) for any new mutation feedback.
- **Attention**: `animate-flash` (1s opacity pulse, runs once) for drawing the eye to a thing
  that just changed elsewhere on screen.
- **Toggles**: `pc-swap` rotate/flip (§6).
- **Spinners**: `animate-spin` only while genuinely working, and only behind a loading gate
  (e.g. `tool-button.ts`) so nothing spins on a sub-300ms response.

**The rules:**

- **Felt, not watched.** Transitions are 150–300ms and run once. Feedback fades may take ~1.2s
  to decay. Nothing loops except a spinner that is honestly still working.
- **Motion never blocks input** and never delays data appearing. Animate the container's
  entrance, not the user's wait.
- **Animate `transform` and `opacity`** (plus `background-color` for flashes) — exactly what
  the existing keyframes do. Never animate layout (width/height/top/margin): it's janky and
  it moves things out from under the cursor.
- **One moment of motion per interaction.** A save may flash the cell — it does not also
  bounce the button and slide the toast in from three directions.
- **Honor `prefers-reduced-motion`.** The global guard exists at the bottom of `styles.css`
  (`@media (prefers-reduced-motion: reduce)` collapsing all animation/transition durations) —
  new animations are covered automatically; don't add per-component opt-outs.
- New keyframes, if truly needed, go in the `@layer utilities` block of `styles.css` (app-wide)
  or the component's own CSS file (scoped), use `var(--color-*)` tokens (§5), and get an
  `animate-*` utility name consistent with the existing set.

## 8. Typography & hierarchy

- App font is **Inter** at body weight 400 — Roboto 300 is retired (300 is too fragile below
  14px, especially in dark mode). Inter is **self-hosted** via the `@fontsource-variable/inter`
  package, imported at the top of `styles.css` and bundled at build time — the SPA makes no
  external font requests; never add a `fonts.googleapis.com` link to `index.html`. (The
  backend's public event/web-form pages still load Roboto from Google Fonts — a separate,
  unmigrated surface as of July 2026.)
- **Body text is `text-xs` (12px) app-wide** — grids, detail pages, settings, activity logs,
  dialogs. Enforced globally by the `body` font-size rule in `styles.css`, so unsized elements
  default to 12px and larger type is always an explicit opt-in. `text-sm` is the one-notch-up
  reserved for `pc-detail-item` values and weighted section headings; the Help Center is the
  deliberate larger exception. The full numeric scale lives in UX-GUIDELINES §C.
- Headings earn weight (600–700), so **weight is hierarchy** — don't reach for size or color
  first. Monospace is `ui-monospace`/system mono, reserved for IDs, routes, and kbd hints.
- Kickers/eyebrows are small uppercase tracked labels; record names are the big type.
- Tabular numerals for counts and money so columns don't shimmy.
- Hover states are subtle (the grid row's primary edge stripe) and never the only signal (§2).

## 9. Proposing new design work

For anything bigger than applying the existing patterns — a new page type, a new flow — the
owner wants a **visual artifact mockup in the app's own theme first** (white cards,
`#0ea5e9` primary, uppercase kickers, the mock-kit style of the two source artifacts), reviewed
before implementation. Pins-and-annotations format: show the mock, then a numbered list
explaining each design decision and the principle it serves. Do not jump straight to code for
novel UI.

## 10. The ten-second litmus test

Before shipping any UI change, ask:

1. Does the page still answer the three questions (§1)?
2. Is anything hidden that the user would want narrated — a filter, a selection, unsaved work,
   a reason for a disabled control (§2)?
3. Does every failure/empty path end in a guided next step, not a dead end (§3)?
4. Did I reuse the assigned idiom for every job I touched (§4)?
5. Toggle the dark theme: does everything still read (§5)?
6. Is every new behavior on the lowest possible rung — DaisyUI, then CSS, then TS (§6)?
7. Does every animation narrate a state change, run once, use the house timing, and live in
   CSS (§7)?
8. Read every button label aloud: sentence case, verb + noun, honest about scale (§4)?

Then run the `pplcrm-page-layout-ux` checklist if a record page changed, and the
`pplcrm-quality-gate` pipeline before committing.

## Non-goals

- **Detail-page composition mechanics** (layout/header/breadcrumbs/pager/activity-log wiring
  and its per-page checklist) → `pplcrm-page-layout-ux`.
- **Component-internal code conventions** (signals, `form()`, loading-gate call pattern,
  `pc-icon` names/sizes) → `pplcrm-angular-components`.
- **Backend error sanitization and tracing** → `pplcrm-trpc-backend`, `pplcrm-debugging`.
- **Chart/data-viz styling** → the global `dataviz` skill.
