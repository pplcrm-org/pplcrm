---
name: pplcrm-quality-gate
description: "Explains why `nx lint` passing does NOT mean the pre-commit hook will pass, and how to verify a change the way the hook actually does before committing. USE WHEN preparing to commit, when a commit was rejected by the pre-commit hook after lint looked clean, or when fixing @typescript-eslint/no-floating-promises or no-misused-promises. EXAMPLES: 'before committing', 'nx lint passed but the hook rejected it', 'no-misused-promises on my event handler'."
---

# pplcrm Quality Gate

## The one thing to know

**`nx lint <project>` and the pre-commit hook enforce DIFFERENT rules. A green `nx lint` does not mean the hook will pass.** This is not a caching or stale-file problem — the two commands load different ESLint config files.

- The pre-commit hook (`.husky/pre-commit` → `npx lint-staged`) runs plain `eslint` from the **repo root**, so ESLint loads the **root** `eslint.config.cjs`. That file declares the type-aware rules:
  ```
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/no-misused-promises': 'error',
  ```
- `nx lint <project>` runs the `@nx/eslint:lint` executor, which loads the **project-local** config (e.g. `apps/frontend/eslint.config.cjs`). Whether that enforces the root's promise rules depends on whether the project config spreads the root config in — and the four projects are split:
  - **backend** and **common**: their configs spread in the root config (`...require('../../eslint.config.cjs')`), so `nx lint backend` / `nx lint common` enforce the promise rules **and** their own project rules. For these two, `nx lint` is a superset of the hook.
  - **frontend** and **uxcommon**: their configs do **not** spread the root, so under `nx lint frontend` / `nx lint uxcommon`, `no-floating-promises` and `no-misused-promises` are **not enforced at all**. This is where the gap still lives. (They aren't merged yet because each has pre-existing violations that would surface: frontend trips `@angular-eslint/no-output-native` in `multiselect-filter.ts`/`singleselect-filter.ts`, uxcommon trips `@angular-eslint/prefer-inject` in several files. Fixing those and spreading the root config there too is the intended follow-up.)

Verified with a throwaway file containing one floating promise:

| Command                                                           | Result                                           |
| ----------------------------------------------------------------- | ------------------------------------------------ |
| `npx eslint <file>` (root config, = hook path)                    | **error** `no-floating-promises`                 |
| `npx nx lint frontend` on the same file under `apps/frontend/src` | did **not** report it                            |
| `npx nx lint backend` on the same file under `apps/backend/src`   | **error** — backend now composes the root config |

## Verify the way the hook does (authoritative)

Run plain ESLint from the repo root on exactly the files you changed, with the same flag lint-staged uses (see `lint-staged` in the root `package.json`):

```bash
npx eslint <changed-file-1> <changed-file-2> --report-unused-disable-directives-severity=off
```

If that exits 0, the pre-commit hook's `*.{ts,html}` step will pass. This is the single check that matters for the hook. The full CLAUDE.md pipeline (`prettier --write .`, `nx lint frontend`, `nx lint backend`, builds, tests) is still required before a PR — `nx lint backend` is the only path that enforces the tenant-safety rule (see `pplcrm-tenant-safety`), so neither check alone is sufficient.

Heads-up on **pre-existing failures** — check whether the flagged lines/tests are yours before burning time:

- ~~`nx lint backend` fails on 2 `donation_pledges` `no-unscoped-db-query` errors~~ — fixed; `nx lint backend` passes clean as of 2026-07-21.
- ~~`nx test backend` has 18 pre-existing failing tests (web-forms/events/volunteer-events public-submission specs)~~ — fixed; those all pass as of 2026-07-24. `job-claim.spec.ts` can still fail in the full parallel run but passes in isolation (test-parallelism flake).
- ~~`nx test frontend` has **2 pre-existing failing tests** (`services/api/user-message.spec.ts`, `layout/sidebar/sidebar.spec.ts`)~~ — both pass as of 2026-07-25; `nx run-many -t test -p frontend backend common uxcommon` is fully green (1188 tests).
- ~~Deploy CI has **no test step**, which is how broken specs land on main.~~ — fixed 2026-07-25, see below.

## Diagnostic-free target failures under Claude Code's sandbox (2026-07-30)

A sandboxed nx target can fail printing nothing usable:

```
❯ Building...
/*! 🌼 daisyUI 5.5.23 */

 NX   Running target build for project companion failed
```

**Do not read a missing diagnostic as proof the cause is environmental.** The first time this was
investigated the cause was a real bug in a checked-in config file (cause 1 below), and "it's the
sandbox" would have shipped it. Get the real error before concluding anything:

```bash
NG_BUILD_MAX_WORKERS=1 npx nx build <project> --skip-nx-cache
```

Nx's default parallelism turns the underlying failure into a ~100-line esbuild goroutine dump
(`fatal error: all goroutines are asleep - deadlock`) — that is the Go binary parked in
`sendRequest` waiting on a Node process that already died, not a bug in esbuild. Serialised to one
worker, the actual message appears. `--verbose` alone does not do this.

### 1. `existsSync` + `process.loadEnvFile` in a vite config — real bug, fixed in code

```
NX   Failed to process project graph.
   - apps/backend/vite.config.ts:
     Error: ENOENT: no such file or directory, open '.../.env.test'
         at process.loadEnvFile (node:internal/process/per_thread:360:7)
         at buildViteTargets (node_modules/@nx/vite/dist/src/plugins/plugin.js:113:29)
```

The sandbox denies **reading** `.env*` but still permits `stat`, so an `existsSync` guard returns
`true` and `process.loadEnvFile` then throws. Two consequences worth remembering:

- `@nx/vite` evaluates **every** vite config to infer targets during project-graph construction, so
  the backend's config took down an unrelated `nx build frontend`. Every nx command builds the
  graph, so this class of bug breaks `test` and `lint` too — never scope its workaround to builds.
- Presence never implies readability. Env-file loading in this repo is best-effort and belongs in a
  `try`/`catch` — see [apps/backend/vite.config.ts](../../../apps/backend/vite.config.ts) and the
  older, correct [global-setup.ts](../../../apps/backend/src/test-setup/global-setup.ts).

### 2. LMDB + POSIX named semaphores — real hazard, but not what breaks builds here

Verified: `open()` from `lmdb` dies **silently on SIGABRT (exit 134)** inside the sandbox, both for a
fresh path and for the existing `.angular/cache/<ver>/<project>/angular-compiler.db`, and succeeds
unsandboxed. `@angular/build` wraps `new LmdbCacheStore(...)` in a `try`/`catch`
(`esbuild/angular/compiler-plugin.js`), but `LmdbCacheStore#ensureCacheFile()` opens **lazily** on
the first `get`/`has` — outside that catch — so the abort is uncatchable and stderr stays empty.

It is not the observed cause, though: after fix 1, `npx nx build frontend --skip-nx-cache` passes
**inside** the sandbox (verified twice), and `angular-compiler.db`'s mtime never moves while
`.tsbuildinfo` in the same directory does — the production `application` builder never opens the
store. Unverified: `build` for companion/backend, `nx test`, and `nx serve` (dev-server prebundling
and i18n inlining are the paths that would exercise the cache).

If something does hit it, `CI=1` disables Angular's persistent cache (`utils/normalize-cache.js`,
default `environment: 'local'`) and `CI=1 npx nx build frontend` passes sandboxed — prefer that to
un-sandboxing.

### Why builds are still excluded from the sandbox

`.claude/settings.json` keeps **build-only** entries in `sandbox.excludedCommands` as a hedge for the
projects nobody has checked yet — not because builds provably cannot be sandboxed; the frontend one
demonstrably can. Never widen those globs to bare `run-many*`/`affected*`: that silently
un-sandboxes `test` and `lint`. Before adding any target to that list, run the
`NG_BUILD_MAX_WORKERS=1` repro above and fix what it shows you.

## CI runs this gate now (2026-07-25)

`.github/workflows/verify.yml` runs **lint / test / build / e2e** on every PR, and `deploy.yml`
declares `needs: verify`, so a red gate blocks the production deploy. Before this, `deploy.yml` went
from `npm ci` straight to a rollout with no verification at all — which is exactly how the
`frontend-e2e` suite reached **45/55 failing** without anyone noticing.

Things worth knowing about that workflow:

- **The `lint` job runs both lint paths**, for the disjoint-rule-set reason this whole skill is
  about. The root-config step is scoped to **changed files** (same as the hook) because the repo has
  13 pre-existing root-config errors in 6 files — `@angular-eslint/no-input-rename` in
  `sticky-pin.directive.ts`, `no-output-native` in the two datagrid filters + `side-drawer` +
  `tagitem`, and `no-undef` in `apps/website/tools/social/render.mjs`. Clearing those means renaming
  public component inputs/outputs and updating every template that binds them. Once they're fixed,
  that step can go repo-wide.
- **The `test` job provisions a real Postgres** and reuses `apps/backend/scripts/setup-test-db.sh`,
  so it follows automatically if the role model changes. It also sets `ALLOW_MOCK_PAYMENTS` and
  `ALLOW_MOCK_DOMAIN_VERIFICATION` — both fail closed, and `settings/controller.spec.ts` asserts
  against the latter.
- **The `e2e` job runs the whole suite**, which is currently `signin.spec.ts` alone (12 tests). The
  other four specs (`persons-grid`, `email-client`, `volunteer-events`, `web-forms`) were **deleted**
  2026-07-25, not repaired: all 33 failures were stale against the two-step-signin rework, and the
  5 that "passed" asserted nothing — three were wrapped in `if (await x.isVisible())` so the body
  was skipped entirely, and the two web-forms ones mocked the whole HTML response and then asserted
  against the markup the test itself had written. They would have passed with the backend deleted.
  The `@smoke` tags still in `signin.spec.ts` mark the highest-value journeys for a future
  post-deploy production check; they do **not** scope the CI step.

  The lesson worth keeping: a vacuously-passing e2e test is worse than a missing one, because it
  reads as coverage. When adding specs here, assert against something the app actually produces —
  if you mock the response you're asserting on, you're testing your own fixture.

- **`prettier --check .` is deliberately NOT a CI gate.** `deploy/GO-LIVE-CHECKLIST.md` is
  non-idempotent under prettier (it oscillates between two indent levels on a deeply-nested code
  fence), so the check can never go green. The hook formats changed files, which is enough.
- Stray `vitest` worker processes from an interrupted run can hold test-DB connections and make subsequent backend runs hang until timeout — `pkill -f vitest` before rerunning.

The other hook step is formatting only:

```bash
npx prettier --write <changed-files>
```

## Spec files: a second, smaller divergence

`nx lint` and the hook also disagree about `*.spec.ts`, which matters because tests are where floating/misused promises are easiest to introduce:

- Root config turns `no-explicit-any` **off** for specs but leaves the two promise rules **on** — verified: plain `eslint` on a spec with a floating promise still errors.
- The backend tenant rule explicitly ignores specs: `ignores: ['**/*.spec.ts']` in `apps/backend/eslint.config.cjs`.

Net effect: a frontend/uxcommon `*.spec.ts` can look clean under `nx lint` yet still trip `no-floating-promises` / `no-misused-promises` in the hook. Writing tests is owned by **`pplcrm-testing`** — see it for runner/layout conventions; this skill only covers the lint interaction.

## Real fixes for the two enforced rules

### no-floating-promises — mark fire-and-forget with `void`

From commit `50bf870c` ("fix no-floating-promises — prefix fire-and-forget calls with void"), `apps/frontend/src/app/auth/auth-service.ts`:

```ts
// before — Router.navigate returns a Promise nobody awaits → error
this.router.navigate(['/signin']);
// after
void this.router.navigate(['/signin']);
```

Use `void` only when you genuinely don't care about the result. If you need the outcome or error, `await` it (inside an `async` fn) or `.catch()` it instead.

### no-misused-promises — never pass an async callback where `void` is expected

From commit `fe68e37b` ("fix no-misused-promises — sync ngOnInit wrappers, extract async callbacks"), `apps/frontend/src/app/auth/cancel-deletion-page/cancel-deletion-page.ts`:

```ts
// before — async ngOnInit + async setInterval callback both misuse a Promise
public async ngOnInit() {
  this.sessionPollInterval = setInterval(async () => {
    const user = await this.auth.getCurrentUser().catch(() => null);
    if (!user) await this.auth.signOut();
  }, 5000);
}
// after — sync wrapper delegates to a named async method, callback returns void
public ngOnInit(): void {
  void this.loadOnInit();
}
private async loadOnInit(): Promise<void> {
  this.sessionPollInterval = setInterval(() => void this.pollSession(), 5000);
}
private async pollSession(): Promise<void> {
  const user = await this.auth.getCurrentUser().catch(() => null);
  if (!user) await this.auth.signOut();
}
```

The pattern: give the `void`-returning slot (Angular lifecycle hook, `setInterval`, DOM event handler, `mockImplementation`) a **synchronous** callback with an explicit `: void`, and either `void`-launch or extract the async work into a named `async` method.

## Honest note on `require-await`

`@typescript-eslint/require-await` is **not enforced by any config in this repo** — it is absent from the root and every project `eslint.config.cjs`, and an `async` function with no `await` passes plain `eslint` cleanly. If you see a `require-await` complaint it is coming from your editor/tsserver settings, not this repo's gate. Do not spend commit-blocking effort on it unless a real `eslint` run flags it. (The fix, if ever enforced, is trivial: drop the unused `async`, or add the missing `await`.)

## Non-goals

- **Nx executor mechanics / caching** — owned by the global `nx-run-tasks` / `nx-workspace` skills. This skill only covers why the two lint paths differ in _rule set_.
- **The `local/no-unscoped-db-query` tenant rule** (which _is_ on in `nx lint` but off for specs) — owned by **`pplcrm-tenant-safety`**.
- **Test structure, runner, and file placement** — owned by **`pplcrm-testing`**; this skill only notes the spec-vs-lint interaction.
- **Running the change to confirm behavior** — use `/verify` after the lint gate is green.
