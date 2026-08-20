---
name: pplcrm-testing
description: "Writing and running Vitest unit tests, isolating backend specs that share one Postgres, and why a spec can pass `nx lint` yet be rejected by the pre-commit hook. USE WHEN adding or editing a `*.spec.ts`, running project tests, mocking with `vi.spyOn`/`vi.fn`, or chasing a backend spec that only fails when the whole suite runs. EXAMPLES: 'how do I run just one test file', 'mock the mail service in a backend test', 'this spec passes alone but is flaky in CI'."
---

# Testing in pplCRM (Vitest)

## The runner: Vitest is live, Jest is dead weight

Every `test` target runs **`vitest run`** in the project's own directory (`project.json` for
backend, frontend, and uxcommon all define `"command": "vitest run"` with the project as `cwd`).
Root `nx test` fans out to all three via an `nx:noop` target in `nx.json`.

Per-project Vitest config lives in `apps/backend/vite.config.ts`, `apps/frontend/vite.config.ts`, `libs/uxcommon/vite.config.mts`. The root `vitest.config.ts` only aggregates frontend + uxcommon for editor/workspace runs. Backend runs `environment: 'node'`; frontend runs `environment: 'jsdom'` with `setupFiles: ['src/test-setup.ts']`.

**Jest is vestigial — do not use it.** `jest.config.ts`, `jest.preset.cjs`, and per-project jest configs still exist (Angular generator leftovers; `nx.json` still defaults `unitTestRunner: jest`), but **nothing invokes them**: no `project.json` has a jest target, no `package.json` script runs jest, and `@nx/jest` is not in `nx.json` `plugins`. Ignore those files; write Vitest.

## Where specs live and how to run them

Specs sit **next to their source** as `<name>.spec.ts` (not in a separate `__tests__` dir). Vitest `include` glob is `{src,tests}/**/*.{test,spec}.{...ts...}` (`apps/backend/vite.config.ts`). Real examples:

- `apps/backend/src/app/modules/tasks/trpc.router.spec.ts` (beside `trpc.router.ts`)
- `apps/frontend/src/app/experiences/users/ui/user-view.spec.ts` (beside `user-view.ts`)

Run commands:

```bash
npx nx test backend            # whole backend suite
npx nx test frontend           # whole frontend suite
npx nx test                    # all three projects
# single file — run vitest from the project dir (matches the configured cwd):
cd apps/frontend && npx vitest run src/app/layout/favourite-toggle/favourite-toggle.spec.ts
```

Backend specs need Postgres reachable — DB env is injected by `apps/backend/vite.config.ts` (`test.env`), so the DB in that block must exist locally.

**Coverage ratchet (CI-enforced for three projects):** verify.yml runs frontend, common, and uxcommon with `--coverage`, which enforces the thresholds in each project's vite config (re-baselined to measured reality 2026-08-20). Backend is deliberately outside the gate: V8 instrumentation slows the DB-heavy suite enough that demo-seed.spec.ts exceeds even the 30s test timeout. If your change deletes tests or adds untested code in one of the three gated projects, check before pushing: `tools/quiet.sh npx nx test common --args=--coverage` (same for `frontend` / `uxcommon`).

**Trap: `nx test backend --args="apps/backend/src/..."` reports success while running ZERO tests.** Vitest's cwd is `apps/backend`, so a repo-root-prefixed path filter matches no files — and the config sets `passWithNoTests: true`, so the run prints success anyway. A whole batch of specs was once "verified" this way without ever executing. Path filters must be `src/`-relative (`--args="src/app/modules/x/y.spec.ts"`), and after any filtered run, confirm the reported test count is non-zero and plausible for the file.

**Rebuilding the test DB:** if `globalSetup` dies with `corrupted migrations` (e.g. a new migration file sorts before one already applied — happens with in-flight work in a shared worktree), drop and re-provision the disposable test DB; the next run rebuilds the schema from the baseline: `psql -U "$(whoami)" -d postgres -c 'DROP DATABASE IF EXISTS pplcrm_test' && apps/backend/scripts/setup-test-db.sh` (check `pg_stat_activity` for open connections first).

## Backend isolation: one shared Postgres, spec files in parallel

There is no DB mocking layer — every backend spec hits the same local database, and Vitest runs spec _files_ concurrently. Two helpers in `apps/backend/src/app/lib/test-utils/` cover the two different ways that bites. **A spec that passes alone but fails in a full run is almost always one of these.**

**Default: `useTestTransaction()`** (`db-test-isolation.ts`) — opens a real transaction before each test and always rolls it back, so writes vanish even when the test throws, and are never visible to another file. Pass `ctx.trx` into the code under test. Reach for this first; hand-rolled `afterEach` deletes leak rows whenever a test fails or the process is killed.

```ts
const ctx = useTestTransaction();
it('adds a row', async () => {
  await repo.add({ row: { ... } }, ctx.trx);
});
```

**When rollback can't help: `useExclusiveDbLock(key)`** (`exclusive-db-lock.ts`) — for code that reads or sweeps a table _globally_, where the contention is between files, not tests. `claimNextPendingJob` picks the lowest-id runnable row in the whole `background_jobs` table, so a `pending` row another spec file committed mid-run is a real claimable job: it breaks the FIFO assertion _and_ gets stolen from the file that inserted it. A whole-table statement selected by age is the other qualifying case, and it fails in both directions — it can delete another file's rows, and it blocks on rows a concurrent claimer holds open, which shows up as a test timeout rather than a wrong value. Every file touching that resource takes the same advisory-lock key and they take turns; the rest of the suite stays parallel. Call it once at file top level, outside any `describe`:

```ts
useExclusiveDbLock(DB_TEST_LOCKS.BACKGROUND_JOB_QUEUE);
```

Keys live in `DB_TEST_LOCKS` — add one per shared resource, never reuse an unrelated file's. The lock is held by a transaction (`startTransaction()` pins one pooled connection) and taken with `pg_advisory_xact_lock`, so it releases on rollback _and_ on a mid-run crash — a wedged file can't block the next run.

`DB_TEST_LOCKS` in `exclusive-db-lock.ts` is the source of truth for which files hold what; `grep -rn useExclusiveDbLock apps/backend/src` gives the live list. As of 2026-08-20:

| Key                    | Holders                                                                                                                                                                                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BACKGROUND_JOB_QUEUE` | `lib/jobs/job-claim.spec.ts`, `lib/jobs/worker.retry-backoff.spec.ts`, `lib/jobs/worker.reliability.spec.ts`, `lib/jobs/job-handlers.spec.ts`, `lib/jobs/handlers/maintenance.detached-emails.spec.ts`, `lib/jobs/handlers/maintenance.exports-retention.spec.ts` (the last two run whole-table age sweeps over `emails` / `data_exports`) |
| `RECEIPT_COUNTERS`     | `lib/jobs/handlers/receipts.handlers.spec.ts`, `modules/donations/receipts/cancel-reissue-refusals.spec.ts`, `modules/donations/receipts/controller.spec.ts`, `modules/donations/repositories/receipt-counter.spec.ts`                                                                                                                     |

## Mocking conventions (copy these — they're real)

**Backend, no TestBed** — mock with `vi.spyOn` / `vi.fn().mockReturnThis()` and drive tRPC through `Router.createCaller(...)`. From `apps/backend/src/app/modules/tasks/trpc.router.spec.ts`:

```ts
import { vi, describe, it, expect, beforeEach } from 'vitest';
// ...
vi.spyOn(BaseRepository, 'dbInstance', 'get').mockReturnValue({
  selectFrom: vi.fn().mockReturnValue(mockQB),
} as any);
// ...
const caller = TasksRouter.createCaller({ auth: { tenant_id: '1', user_id: '1', session_id: 's1' } as any } as any);
const result = await caller.update({ id: '1', data: { assigned_to: '3' } });
```

**Frontend components** — Angular `TestBed.configureTestingModule` with `providers: [{ provide: Service, useValue: mockObj }]`, mocks built from `vi.fn()`. See `apps/frontend/src/app/experiences/users/ui/user-view.spec.ts`. Standalone components go in `imports:`, not `declarations:`.

`as any` casts are intentionally allowed in specs — the root ESLint config turns off `no-explicit-any` for `**/*.spec.ts`. That exemption is spec-only; the promise rules below are **not** exempted.

**Never write `// eslint-disable-next-line @typescript-eslint/no-explicit-any` in a frontend spec.** It is redundant (the rule is already off there) and it is a hard **error** under `nx lint frontend`: that project's config doesn't register the rule at all, so the directive fails with `Definition for rule '…' was not found`. The plain `eslint` the pre-commit hook runs accepts it, so this passes the hook and breaks `nx lint` — the mirror image of the gap described below, and a reason to run both. Just write the `any`.

### Components that extend `TRPCService`

Some components (e.g. `experiences/settings/billing/billing-settings.ts`) call tRPC directly instead of going through a service. `api` is built in the `TRPCService` constructor, so it can't be swapped via `providers:` — assign it on the instance, and do it **before the first `detectChanges()`**, because that's when `ngOnInit` fires its first queries:

```ts
const fixture = TestBed.createComponent(BillingSettingsComponent);
(fixture.componentInstance as any).api = mockApi; // ← before detectChanges
fixture.detectChanges();
await fixture.whenStable();
```

The base class also injects `Router`, `ErrorService` and `TokenService`; providing a mock `Router` is usually enough (the other two resolve fine on their own).

### `window.location` cannot be stubbed in jsdom

Both `window.location` and `Location.prototype.href` are non-configurable in the jsdom we run, so `Object.defineProperty`, `vi.spyOn(window, 'location', 'get')` and `vi.stubGlobal('location', …)` all throw `Cannot redefine property`. Assigning `location.href` doesn't throw, but it never changes the value and prints a `Not implemented: navigation` stack per test.

So code that redirects the browser needs a one-line seam to be testable — see `redirectTo()` in `billing-settings.ts`, which both the Stripe Checkout and portal handoffs go through, and which the spec replaces with `vi.spyOn(component as any, 'redirectTo')`.

### The async-callback gotcha (this is where specs break the commit)

Specs are full of callbacks passed into void-return slots (`mockImplementation`, event handlers, array callbacks). Passing an `async`/Promise-returning function there trips `@typescript-eslint/no-misused-promises`. **The fix that this repo already uses**: give the callback an explicit `: void` return and do the work synchronously. Real example from `apps/backend/src/app/modules/auth/trpc.router.spec.ts`:

```ts
const mailSpy = vi.spyOn((controller as any).mailService, 'sendMail').mockImplementation((msg: any): void => {
  const match = String(msg?.text ?? '').match(/\b(\d{6})\b/);
  if (match) sentOtp = match[1];
});
```

Only reach for `async` in `mockImplementation` when the caller actually awaits the result (e.g. the mocked `upsert` in `apps/frontend/src/app/experiences/settings/settings-page.spec.ts`, whose return value is awaited).

## Why a spec passes `nx lint` but the commit hook rejects it

This is the single most common surprise: `nx lint` and the pre-commit hook load **different
ESLint configs**, and for frontend/uxcommon the promise rules (`no-floating-promises`,
`no-misused-promises`) only exist on the hook's path. The full mechanism (which project configs
spread the root config, verification table) is owned by `pplcrm-quality-gate` — read it there.

**Practical rule:** before committing a spec, run the hook's actual command on it, not `nx lint`:

```bash
npx eslint <your-spec>.spec.ts --report-unused-disable-directives-severity=off
```

If that exits 0, the pre-commit hook will pass. Green `nx lint` alone does not guarantee it.

## Non-goals

- **The three promise/async rules in depth** (before/after fixes, the full nx-lint-vs-hook command sequence): owned by `pplcrm-quality-gate`. This skill only covers how that gap manifests _in specs_ and the one-line verify command.
- **Multi-tenant query scoping** (`local/no-unscoped-db-query`): owned by `pplcrm-tenant-safety`. Note that rule ignores `**/*.spec.ts`, so tenant scoping is not lint-enforced in tests — scope test cleanup yourself.
- **What to build** (schemas, routers, components you're writing tests _for_): `pplcrm-schemas-validation`, `pplcrm-trpc-backend`, `pplcrm-angular-components`.
- **Running/verifying the app end-to-end**: use the `/verify` and `/run` commands.
