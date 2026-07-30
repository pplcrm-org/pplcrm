---
name: pplcrm-angular-components
description: "Conventions for building component-internal state, forms, loading, and icons in the Angular 22 frontend (signals-only, the form() signal-forms helper, createLoadingGate, pc-icon). USE WHEN adding or editing a component under apps/frontend/src/app/**, wiring an add/edit form, gating a spinner on a tRPC call, or placing a pc-icon. EXAMPLES: 'why is my form always invalid', 'the spinner flickers on fast responses', 'what values can pc-icon name take'."
---

# pplCRM Angular Component Conventions

Component-internal conventions only: state, forms, loading gates, icons. For page assembly
(detail-layout, breadcrumbs, record nav, activity log placement) see `pplcrm-page-layout-ux`.
For the Zod `AddXObj`/`UpdateXObj` triad that feeds these forms see `pplcrm-schemas-validation`.

Canonical live reference for everything below:
`apps/frontend/src/app/experiences/users/ui/user-view.ts` and `.html` (the merged
view+edit user page), with `experiences/profile/profile-page.ts` for `disabled()`.

## `form()` is Angular's signal-forms API, not a project helper

`form()` and every validator come from `@angular/forms/signals` — nothing form-related is
defined in this repo:

```ts
// user-view.ts
import { form, required, email } from '@angular/forms/signals';
// profile-page.ts additionally imports `disabled` and `FormField`
```

The same module also provides `submit`, `minLength`, `pattern`, `validate`,
`validateStandardSchema`, and the `FormField` type — import them, do not hand-roll them.

## Form pattern: signal payload → `form()` → `[formField]` → `.invalid()`

Three moving parts. From `user-view.ts`:

```ts
// 1. A plain signal holding the raw payload
protected readonly payload = signal({ email: '', first_name: '', last_name: '' });

// 2. form() wraps the signal; the schema fn wires validators per field
protected readonly form = form(this.payload, (p) => {
  required(p.email);
  email(p.email);
  required(p.first_name);
});
```

Per-field `disabled()` takes a reactive predicate — from `profile-page.ts`:

```ts
disabled(p.email, () => this.isViewer() || this.saving());
```

Bind each field in the template with `[formField]` — pass the **field node** (`form.email`, no
call parens), not the payload value. From `user-view.html` (same pattern for `pc-select` and
`pc-toggle`, e.g. in `persons/ui/person-form.html`):

```html
<pc-input id="email" label="Email address" type="email" [formField]="form.email"></pc-input>
```

`pc-input`/`pc-select`/`pc-toggle` (under `libs/uxcommon/src/components/`) already render the
field's error state — they read `formField()().invalid()` and `.errors()` internally (see
`input.ts`), so you do not write per-field error markup yourself.

Validate on submit by **calling** the form to get its root state. From `user-view.ts`:

```ts
this.form().markAsTouched(); // force-show validation before first blur
if (this.form().invalid() || !this.id()) return;
// ... after a successful save:
this.form().reset(); // clears dirty/touched, re-syncs to payload
```

Gotcha: `[formField]="form.email"` in the template is the field node (no parens), but in
TypeScript you **call** it — `this.form()` gives the root field state exposing `.invalid()`,
`.markAsTouched()`, `.reset()`. Forgetting the `()` in TS is the usual "why won't `.invalid()`
resolve" mistake.

## Loading gate: suppress spinner flicker on sub-300ms responses

`createLoadingGate()` (`libs/uxcommon/src/loading-gate.ts`) returns `{ begin, visible, loaded, active }`.
`begin()` returns a disposer; the spinner only appears if the work outlasts `delay` (default
300ms) and, once shown, stays at least `minDuration` (default 300ms). This is why you must use
its begin/end contract instead of a naked boolean signal.

**Empty states must be gated on the gate's `loaded` signal** — never on `visible` (it stays
false for the first 300ms by design, so `!visible() && rows().length === 0` flashes the empty
state before the first fetch lands) and never on a bare `rows().length === 0`. `loaded` flips
true when the first operation completes, ungated by the delay. The idiom is
`@if (loaded() && rows().length === 0) { <pc-empty-state …> }` — during first load the list body
stays blank and the gated spinner/progress bar covers the slow case. The datagrid's version of
this is its `isEmptyState` computed (`datagrid.ts`), which folds in `hasLoaded()`,
`!isLoading()`, zero rows, and no active filters.

**First-load skeletons are gated the same way** — `@if (!loaded()) { skeleton rows }`, never on
`visible` (the 300ms delay would flash the empty state first; this bug shipped once on the
Automations list). Skeletons render from the first frame; the delayed `visible` is only for
spinners/progress bars. For surfaces that refetch after first load (folder switches, filters),
the gate's `active` signal is the ungated "a fetch is in flight right now" flag: use
`@if (active()) { skeleton } @else { empty state }` inside the empty branch so an empty
mid-refetch list never claims "no data" (live example: the email list's `@empty` block).

Wire-up and call site from `user-view.ts`:

```ts
import { createLoadingGate } from '@uxcommon/loading-gate';

private readonly _loading = createLoadingGate();
protected readonly loading = this._loading.visible;   // signal<boolean> for the template

private async load() {
  const end = this._loading.begin();
  this.error.set(null);
  try {
    const user = await this.users.getById(this.id());
    this.detail.set(user);
    // ...
  } finally {
    end();                     // ALWAYS in finally — a skipped end() = stuck spinner
  }
}
```

`end()` in `finally` is mandatory. It is idempotent (guarded by an internal `done` flag), so
calling it twice is safe; never calling it leaves `pendingCount` above zero and the gate never
hides. Note: `loading` gates the initial skeleton; use a separate `saving`/`resettingPassword`
boolean signal (see `saving`/`resettingPassword` in `user-view.ts`) to disable buttons during
in-progress actions — don't reuse the gate for both.

## Request guard: stale responses must not land

Any component that reloads on an input change (detail views reloading on `id()` via prev/next
record navigation) must pair the loading gate with `createRequestGuard()`
(`libs/uxcommon/src/request-guard.ts`) — otherwise a slow earlier response overwrites the newer
record when the user navigates quickly:

```ts
import { createRequestGuard } from '@uxcommon/request-guard';

private readonly _requestGuard = createRequestGuard();

protected async loadAllData(id: string) {
  const isCurrent = this._requestGuard.begin();
  const end = this._loading.begin();
  try {
    const data = await this.svc.getById(id);
    if (!isCurrent()) return; // superseded — do not land stale data
    this.detail.set(data);
  } finally {
    end();
  }
}
```

Check `isCurrent()` after **every** await before writing signals (see `person-view.ts` for the
multi-await shape). All `*-view` detail components use this; `people-in-household.ts` keeps its
own richer sequence counter because it also guards pagination appends.

## pc-icon: required `name`, integer `[size]` only

`libs/uxcommon/src/components/icons/icon.ts`:

- `name` is `input.required<PcIconNameType>()` — required, and must be a valid `PcIconNameType`.
- `size` is `input<number>(6)`, default 6.

`PcIconNameType = keyof typeof icons`. The `icons` object has many entries — do **not**
memorize or paste a subset here, it will rot. Read the live list in
`libs/uxcommon/src/components/icons/icons.index.ts` (mostly Heroicons; `unknown` is the
fallback). A bad name silently falls back to the `unknown` icon.

Whole integers only for `[size]`. The size renders as Tailwind classes `w-${size} h-${size}`,
so `[size]="4"` → `w-4 h-4`. Do not pass decimals (`[size]="3.5"`) and do not put
width/height/`size-*` utilities on `<pc-icon>` — its class-scrubber strips them. Real usage:
`<pc-icon name="lock-closed" [size]="4"></pc-icon>` (`user-view.html`).

**Size values are Tailwind spacing units, not pixels** (`[size]="4"` = 16px, `6` = 24px,
`10` = 40px). Because the classes are built at runtime, Tailwind's scanner can't see them —
every size in use must be in the `@source inline("{w,h}-{2,3,4,...}")` safelist near the top of
`apps/frontend/src/styles.css`. Using a size outside that list silently renders an unsized
icon; add the new value to the safelist in the same change. Sizes in use: 2–8, 10, 12, 16.

## A `<select>`'s current value goes on the `<option>`, never on the select

This project has no `ngModel`, so a plain `<select>` is bound by hand — and the obvious
way is silently wrong whenever the options come from `@for`:

```html
<!-- WRONG: reads correct, shows the first option forever -->
<select [value]="chosen()" (change)="onChange($event)">
  @for (opt of options; track opt.value) {
  <option [value]="opt.value">{{ opt.label }}</option>
  }
</select>

<!-- RIGHT -->
<select (change)="onChange($event)">
  @for (opt of options; track opt.value) {
  <option [value]="opt.value" [selected]="opt.value === chosen()">{{ opt.label }}</option>
  }
</select>
```

The select's `[value]` update binding runs **before** `@for` has created any `<option>`, so
the browser has nothing to match, drops the value, and settles on the first option once the
options appear. Angular then never re-writes it, because the bound value hasn't changed. The
failure is invisible to the type checker and to a build: it looks like a persistence bug
("I set it, came back, and it reverted"), and on a form it means the UI says one thing while
the payload saves another. Static `<option>` lists are unaffected — they exist by update
time — but use `[selected]` there too rather than relying on that.

Fixed twice on 2026-07-29 (`volunteer-access-page.html` turf access, `add-connection-drawer.ts`
relationship type). `volunteer-access-page.spec.ts` is the regression test: render, then
assert `select.value`.

## Signals-only state, `inject()` at the field level

No `Subject`/`BehaviorSubject`/manual subscriptions for state. Use `signal()`, `computed()`,
`effect()`, `input.required()`, `output()`. Inject dependencies as class fields with `inject()`,
never via the constructor. From `user-view.ts`:

```ts
readonly id = input.required<string>();                      // required input

private readonly alerts = inject(AlertService);              // field-level inject()
private readonly users = inject(UserAdminService);

protected readonly detail = signal<IAuthUserDetail | null>(null);
protected readonly currentUserRole = computed(() => this.auth.getUser()?.role);
```

Reserve the constructor for `effect()` wiring, and use `untracked()` inside an effect when the
body should not re-subscribe to signals it reads (see the effect in `user-view.ts`).

### Never read a required input from the constructor (NG0950)

An input — routed (`withComponentInputBinding()`) or template-bound (`[turfId]="…"`) — is set
**after** the component is constructed (`RouterOutlet.activateWith` creates the component, then
calls the input binder; a template's update pass runs after its creation pass). So any
constructor-time `this.someRequiredInput()` throws `NG0950`, and the throw lands wherever your
initial load's `catch` sends it — which is how the failure disguises itself:

- `approve-page.ts` (`/a/:token`) turned it into `state: 'dead'`, so **every** approve-by-text
  link rendered "This approval link isn't active" with no request ever reaching the backend.
  Fixed 2026-07-29; `approve-page.spec.ts` is the regression test (create the component, then
  `componentRef.setInput` — the same order the router uses — and assert the service was called
  with the token).
- `organizer-page.ts` (`/o/:token`) had the same bug, hidden by its 20s poll: the page flashed
  dead and healed itself on the next tick.
- `assign-turf-dialog.ts` had it too, and answered with an empty canvasser roster.

Kick off initial loads from `ngOnInit()` (the value is bound by then) or from an `effect()` when
the load must re-run as the input changes (`turf-detail-page.ts`). Reading an **optional** input
in the constructor doesn't throw — it silently reads the default, which is worse.

### …but never call `inject()` from `ngOnInit()` (NG0203)

The injection context is open during field initialization and the constructor, and closed by the
time any lifecycle hook runs. So the mirror-image mistake is moving work into `ngOnInit()` and
taking `inject(DestroyRef)` along with it:

```ts
// ✗ NG0203 the moment the component mounts — the whole view fails to render
public ngOnInit(): void {
  const timer = setInterval(() => void this.store.refresh(), REFRESH_MS);
  inject(DestroyRef).onDestroy(() => clearInterval(timer));
}

// ✓ constructor — nothing here needs an input, so there is no reason to wait
constructor() {
  const timer = setInterval(() => void this.store.refresh(), REFRESH_MS);
  inject(DestroyRef).onDestroy(() => clearInterval(timer));
}
```

`canvass-list.ts` did the first version, so selecting a turf in the Canvass Companion threw
`NG0203` instead of opening the walk list (fixed 2026-07-30). Timers, listeners and other
teardown-needing setup belong in the constructor — they don't depend on an input, so the reason
to defer to `ngOnInit()` doesn't apply. If you genuinely need both an input and a `DestroyRef`,
inject the `DestroyRef` as a class field and use it from the hook.

## Non-goals

- Page composition — `pc-detail-header`, `pc-breadcrumbs`, `<pc-record-activities>`, record
  prev/next nav, AlertService-vs-confirm-dialog decisions: **`pplcrm-page-layout-ux`**.
- The Zod `AddXObj`/`UpdateXObj` schema triad the payload maps to: **`pplcrm-schemas-validation`**.
- tRPC procedure/service wiring behind `this.users.getById(...)`: **`pplcrm-trpc-backend`**.
- After changes, run the checks in **`pplcrm-quality-gate`** and then `/verify`.
