---
name: pplcrm-page-layout-ux
description: "How detail/record pages compose (pc-detail-layout + pc-detail-header + pc-breadcrumbs + record-navigation.service), and the review checklist for shipping a page change. USE WHEN building or reviewing a detail/record view, adding breadcrumbs, wiring prev/next record navigation, placing the activity log, or choosing AlertService vs confirm-dialog. EXAMPLES: 'wire prev/next record navigation', 'where does pc-record-activities go', 'review this detail page before I ship it'."
---

# pplCRM page layout & detail-page UX

This is both a how-to and a **review checklist**. Every `*-view` detail page in this app is built
from one shell (`pc-detail-layout`) and three collaborating pieces. Get the composition right and
the orientation rules (below) fall out for free.

## The shell: `pc-detail-layout`

`libs/uxcommon/src/components/detail-layout/detail-layout.ts` is the outer frame for every record
view. It owns the padded `bg-base-200/50` container, the loading/error/not-found states, and a
content slot. **Do not hand-roll a page frame** — pass inputs to this and project your body into it.

Key inputs (`detail-layout.ts`): `title` (required), `gate` (required), `eyebrow`, `crumbs`,
`icon`, `hasRecord`, `error`, `notFoundText`, `showDelete`, `deleteText`, `btn1Text`, `btn1Icon`,
plus the pager inputs `positionLabel`/`hasPrev`/`hasNext`/`prevLabel`/`nextLabel`. Outputs: `save`
(the primary/Edit button), `delete`, `prevRecord`, `nextRecord`.

It internally renders `pc-detail-header`, which renders `pc-breadcrumbs`. You almost never
reference the header or breadcrumbs directly on a page — you feed the layout and it wires them.

### Loading, not-found and refetch — the layout owns all of it

**Pass the gate object and the raw record check. Nothing else. Never a hand-derived boolean.**

```html
<pc-detail-layout [title]="pageTitle()" [gate]="_loading" [hasRecord]="!!company()"></pc-detail-layout>
```

That means the page's gate field must be `protected readonly _loading = createLoadingGate();`
(not `private`, or the template cannot bind it). A page needs no `initialized`/`loaded` signal of
its own — the gate already publishes `loaded`, and the layout reads it.

What the layout renders, in the order it decides:

| Situation                                        | Body                                  |
| ------------------------------------------------ | ------------------------------------- |
| first load, past the gate's 300ms delay          | skeleton, held for the gate's minimum |
| the load failed (`error` set)                    | error alert                           |
| first load, still inside the 300ms delay         | nothing — page chrome only            |
| load finished and returned no record             | `notFoundText` alert                  |
| a record is on screen and a refetch is in flight | that record, dimmed to 60%            |
| otherwise                                        | your projected body                   |

Why it is built this way (the numbers are not arbitrary — don't re-tune them casually):

- **Under ~300ms, no indicator at all.** GitHub Primer and NN/g both put the "show nothing"
  ceiling at about 1 second; Vue's async-component default delay is 200ms. An indicator the user
  cannot finish reading makes the page feel slower, not faster.
- **A skeleton, not a spinner, for a whole content area** (Primer, NN/g). A spinner is for one
  small module.
- **The skeleton is latched for the gate's full minimum-display window.** If a record arriving
  mid-hold swapped the skeleton out after 40ms, that swap would be exactly the flash the minimum
  exists to prevent. This is the bug the old per-page `[isLoading]="isLoading() && !record()"`
  expression caused: it cancelled the minimum-display timer.
- **A refetch keeps the previous record on screen and dims it** rather than blanking to a
  skeleton — the same call React's transitions and TanStack Query's `keepPreviousData` make. This
  is what you see pressing J/K through records.

Gotcha: your projected body should still guard its own render on the record existing (e.g.
`@if (company())` in `company-view.html`) — the layout decides _whether_ to project, but the
body's own bindings still run.

Gotcha: `showDelete` demotes Delete into an overflow (⋯) menu, not an inline button, and it
suppresses the third form-action button to keep the layout stable (`detail-header.ts`).
Set `showDelete=true` + `deleteText` and handle `(delete)` — don't add your own delete button.

## Prev/next record navigation: `record-navigation.service.ts`

The pattern lives in `apps/frontend/src/app/services/record-navigation.service.ts`. Two halves:

1. **The grid captures the filtered id set** on record open. `datagrid.ts` calls
   `selectAllMatching()` then `recordNav.setContext(entityKey, ids, count)`, keyed by the grid's
   own stripped list path (e.g. `/teams`). It is persisted to
   `sessionStorage` so a deep-link/refresh survives.

2. **The detail page consumes it** via the `injectRecordNavigation(noun, id)` helper.
   It derives the list route from the activated route itself
   (drops the record's own id segment), so you pass no
   route string. It returns a `RecordNavHandle` of signals:
   `positionLabel` ("N of M filtered"), `hasPrev`/`hasNext`, `prevLabel`/`nextLabel`,
   `goToPrev()`/`goToNext()`.

Wire it in the component (`company-view.ts`):

```ts
protected readonly recordNav = injectRecordNavigation('company', this.id);
```

Then bind the handle straight through to the layout (`company-view.html`):

```html
[positionLabel]="recordNav.positionLabel()" [hasPrev]="recordNav.hasPrev()" [hasNext]="recordNav.hasNext()"
[prevLabel]="recordNav.prevLabel()" [nextLabel]="recordNav.nextLabel()" (prevRecord)="recordNav.goToPrev()"
(nextRecord)="recordNav.goToNext()"
```

The pager renders **inside the detail header card** (`pc-detail-header`), left of the action
buttons — matching the design source. The navbar breadcrumb strip shows the trail only; the
header deliberately publishes a null pager to `BreadcrumbsService` so there is no duplicate.
`J`/`K` keys navigate next/prev while the page is open — but **only when `positionLabel` is set**
and the focus isn't in an input/textarea/select/contenteditable (`detail-layout.ts`). If the user
deep-linked straight to a record (no grid handoff), `positionLabel` is `null`, the pager is
hidden, and J/K do nothing. That's intended: no fake "1 of 1".

The `noun` argument is only for aria-labels ("Previous person"); it does not have to match the
entity key. Grep `injectRecordNavigation` for the current list of detail views using it.

## Breadcrumbs

**Two layers.** (1) Every route in `dashboard.routes.ts` declares `data: { breadcrumb: '…' }`
(a label, or a pre-built `PcBreadcrumb[]` for flat routes that conceptually nest, e.g.
`/imports/new`). `BreadcrumbDefaultsService`
(`apps/frontend/src/app/services/breadcrumb-defaults.service.ts`, started by the Dashboard
shell) publishes that default trail to the navbar on every NavigationEnd — so the strip is
never empty and never stale (route-reuse pages are detached, not destroyed, so per-page
clear-on-destroy could not be trusted). (2) Pages that know more override it after: detail
views via `pc-detail-header`'s effect, tab pages (Import/export) or record pages without the
detail shell via `BreadcrumbsService.setCrumbs()` in an effect. Effects flush after
NavigationEnd, so the page's richer trail always wins. **No page needs to `clear()` anymore.**

**A route param can never name itself, so layer 1 is not enough for a `:param` route.**
`data.breadcrumb` is a static string; on `/workspace/:section` it can only ever say
"Workspace", which is why changing sections used to leave the strip behind while the URL
moved. Any page whose URL carries a param the user chose must publish layer 2 itself, keyed
off the same signal that renders the body — `settings-page.ts` (Workspace → section),
`list-view.ts` (Lists → list name) and `forms-page.ts` (Forms → form → Edit) are the worked
examples. **The trail must match the URL segment for segment**, root included: a page at
`/workspace/campaigns/:id` publishes `Workspace › Campaigns › <name>`, not `Campaigns › <name>`.

**The first crumb doubles as the visible page title** — `pc-breadcrumbs` renders it
`text-sm font-semibold text-base-content`. List pages therefore do NOT render a visible
in-body title: `pc-grid-header`'s `title` is an `sr-only` h1 (kept for accessibility), and
bespoke pages (canvassing, deliveries) use `<h1 class="sr-only">` the same way.
Don't reintroduce a visible in-body page title, and don't hand-roll an in-page crumb row.

**The breadcrumb is the only "back" affordance on routed pages.** The first crumb links to
the list; do not add an in-body "Back to …" link or button — edit forms escape via the
header's Cancel action, nothing else. The sanctioned exceptions, all cases where a crumb
routerLink cannot do the job:

- **Mode toggles** — a page whose "sub-page" is an internal mode signal, not a route
  (the forms page's "All forms" button exits its live-edit mode; a crumb to `/forms`
  would be a no-op on the same URL).
- **Empty-state CTAs** — the icon + sentence + action idiom may route "back" as its
  action (deliveries-plan's "Back to requests").
- **End-of-flow CTAs** — a wizard's done/error screen offering "Back to import history"
  is a forward action, not header nav.
- **Responsive pane switches** — the email client's mobile back swaps master/detail panes.
- **Navbar-less public pages** — tokenized routes (`/r/:token`, public events/forms)
  have no crumb strip to lean on.

**Title-suffix slot**: tone-colored badges beside the title (a `pc-status-badge`, task
priority badges) project via `[pc-title-suffix]` — the `statusChip` input is fixed
success-tinted and only fits "positive standing" chips. See `newsletter-detail.html`
and `task-view.html`.

For detail views, build a `PcBreadcrumb[]` as a `computed` and pass it as `crumbs`. Convention
(see the `crumbs` computed in `company-view.ts`, `person-view.ts`, `team-view.ts`): first crumb
is the list page with a `route`; **last crumb is the record name with NO `route`** (it renders
as the current page). The record name also becomes the layout `title` — the crumb and the
`<h1>` say the same thing.

```ts
protected readonly crumbs = computed<PcBreadcrumb[]>(() => [
  { label: 'People', route: '/people' },
  { label: this.fullName() || 'Person' },
]);
```

Rules baked into the current design (from the owner's UX judgment, now enforced by the shell):

- **No fake "Home" crumb.** The trail must reflect real hierarchy; the sidebar logo is the way home.
- Title is the **record name**, never a template name ("Person", "Company Profile"). Fall back to
  the entity noun only while data is loading (`company()?.name || 'Company'`).
- Entity type goes in `eyebrow`, not the title.

## Activity log placement (mandatory — CLAUDE.md §4)

Every view that modifies data includes `<pc-record-activities [entity]="..." [entityId]="...">`.
Placement: inside the Activity tab panel on tabbed views
(`company-view.html`, `team-view.html`, `person-view.html`, `household-view.html`).

`entity` and `entityId` are `input.required` (`record-activities.ts`). **`entity` is the DB
table name, not the route** — `'persons'` (route is `/people`), `'companies'`, `'teams'`,
`'households'`. `entityId` is the record id from the view's required `input` (`id()`, or `id()!`
where the surrounding template hasn't null-guarded). Match the table name or the activity feed
loads nothing.

## AlertService vs confirm-dialog vs neither

- **`AlertService` (toast)** — fire-and-forget feedback after an action resolves. `showSuccess` /
  `showError` / `showInfo`, each takes a single string (`alert-service.ts`). Use for "Company
  deleted", load failures, copy-to-clipboard confirmations. Never `window.alert`, never an inline
  banner (CLAUDE.md §4).
- **`ConfirmDialogService`** (imported in views from `../../../services/shared-dialog.service`,
  which re-exports `@uxcommon/components/confirm-dialog.service`) — a blocking decision the user
  must make before you proceed. `confirm()` returns `Promise<boolean>`; `variant: 'danger'` for
  destructive actions (`confirm-dialog.service.ts`). Also `alert`, `prompt`, `choose`.
  Canonical destructive flow (`company-view.ts`):

  ```ts
  const confirmed = await this.dialogs.confirm({
    title: 'Delete Company',
    message: 'Are you sure you want to delete this company? This action cannot be undone.',
    variant: 'danger',
    confirmText: 'Delete',
  });
  if (!confirmed) return;
  ```

- **Neither** — reversible, low-stakes actions (opening a tab, navigating to Edit). Don't gate
  navigation behind a confirm.

Rule of thumb: **irreversible or lossy → confirm dialog first, toast after. Reversible → just do it,
toast if there's a result worth reporting.**

## Review checklist (run before shipping a page change)

The owner's bar: a first-time user should think the page is beautiful, because sloppy UI reads as broken.
Every page must answer three orientation questions:

- [ ] **Where am I?** Title is the record's real name (not a template label); entity type is the
      `eyebrow`; a leading `icon` if the entity has one.
- [ ] **Where was I?** Breadcrumb trail is real hierarchy, first crumb links back to the list, last
      crumb is this record with no link, no fake "Home".
- [ ] **Where am I going?** Counts shown before clicks — tab labels carry counts
      (`Employees (${employeeCount()})`, see `company-view.ts`); prev/next pager shows "N of M
      filtered" when a grid handed off context.
- [ ] `pc-detail-layout` is the frame (no hand-rolled page shell), fed `[gate]="_loading"` and a
      bare `[hasRecord]="!!record()"` — never a hand-derived loading/not-found boolean; body
      guarded on the record existing.
- [ ] Prev/next wired via `injectRecordNavigation` + bound through to the layout, or deliberately
      omitted (fine — pager self-hides with no context).
- [ ] `<pc-record-activities>` present with the correct **DB table name** as `entity` and `id()` as
      `entityId`.
- [ ] Destructive actions go through `ConfirmDialogService.confirm({ variant: 'danger' })`; feedback
      via `AlertService` toasts — never `window.alert` or inline banners.
- [ ] **Semantic DaisyUI tokens only** — `text-base-content`, `bg-primary`, `badge-neutral`, etc.
      No hardcoded Tailwind hues (`text-teal-500`, `text-amber-500`, `bg-[#0a66c2]`) — they break
      the dark theme. NOTE: some current views still violate this — stat-card hues and
      social-link brand colors in `company-view` and `person-view`; the design track lists
      converting these to semantic tokens as pending cleanup — don't copy them as the pattern.
- [ ] **Disclosure over suppression** — a disabled control says _why_ (or is hidden if it would be
      misleading); buttons state exactly what they do; no hover-only affordances; no dead/misleading
      affordances (e.g. a bookmark star on a record page that doesn't bookmark the record).
- [ ] Sentence case, one modal idiom (the dialog service), one empty-state pattern
      (icon + plain sentence + action).
- [ ] **Button vocabulary** (UX-GUIDELINES §4b): main action `btn-primary` right-most and one per
      surface; cancel `btn-outline btn-accent`; secondary `btn-outline btn-primary`; archive
      `btn-outline btn-warning`; delete `btn-outline btn-error`; create labels are "New {noun}".
      No `rounded-*`/decoration utilities on buttons.
- [ ] **Body text is `text-xs`** — no `text-sm`/`text-base`/`text-[13px]` body copy
      (UX-GUIDELINES §8; `text-sm` only for `pc-detail-item` values and weighted section headings).
- [ ] **List pages use `pc-grid-header`** (title + count sentence + actions projected right) —
      never a hand-rolled h1 + button row. Datagrid pages get it via the grid itself.

Then run `/verify` and the quality gate (see `pplcrm-quality-gate`).

## Non-goals

- **The app-wide design doctrine** (why the three questions, disclosure over suppression,
  guide-don't-error, the color/copy/idiom contract for _all_ surfaces, proposing new design
  work) → **`pplcrm-design-principles`**. This skill is its detail-page enforcement arm.
- **Component-internal conventions** — `signal()`/`computed()`/`effect()`, the `form()` helper,
  `createLoadingGate()`, `pc-icon` name/size rules → **`pplcrm-angular-components`**. (This skill
  uses those but doesn't teach them.)
- **Adding a whole new entity end-to-end** (schema → migration → tRPC → routing → experience) →
  **`pplcrm-add-entity`**.
- **Zod schema shapes** feeding the edit form → **`pplcrm-schemas-validation`**.
- **Generic review/verify workflow** → the `/code-review` and `/verify` slash commands.
