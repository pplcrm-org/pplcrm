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
- ~~`nx test backend` has 18 pre-existing failing tests (web-forms/events/volunteer-events public-submission specs)~~ — fixed; those all pass as of 2026-07-24. `job-claim.spec.ts` can still fail in the full parallel run but passes in isolation (test-parallelism flake). Deploy CI has **no test step**, which is how broken specs land on main.
- `nx test frontend` has **2 pre-existing failing tests** (verified failing at HEAD `42aac912` on 2026-07-24, files untouched since): `services/api/user-message.spec.ts` ("shows a TRPCClientError message as-is" — a directly-constructed `TRPCClientError` has `data == null`, so `isServerUnreachable` classifies it as an outage and returns the unreachable message; spec predates the outage-message commit `303d096f`) and `layout/sidebar/sidebar.spec.ts` ("should honor collapse state…" — stale since the mobile-nav rework `fa816a4e`).
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
