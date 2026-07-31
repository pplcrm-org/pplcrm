---
name: pplcrm-tenant-safety
description: "The custom local/no-unscoped-db-query ESLint rule that is the multi-tenant safety net — what trips it, the ignoreTables allow-list and why each table is on it, and the query shapes it silently cannot catch. USE WHEN a lint error says 'no-unscoped-db-query' or 'has no .where(tenant_id) filter', when writing/reviewing any backend Kysely query that could leak across tenants, when tempted to add an eslint-disable for this rule, or when changing the ignoreTables list. EXAMPLES: 'can I add ms_graph_tokens to the ignore list?', 'why does the rule not catch my query built in two steps?'."
---

# Multi-tenant query safety (`no-unscoped-db-query` + RLS)

The rule is a **tripwire, not a proof.** It catches the common mistake (a Kysely chain with no
tenant scope) but has real blind spots. A green lint does not mean a query is tenant-safe — you
still owe the manual checks below. A cross-tenant leak here is a real data breach, so treat every
`eslint-disable` of this rule as a security decision that needs a reviewer, not a lint annoyance.

**Two whole layers sit outside what this rule (or RLS) can see.** Both produced real findings in
the 2026-07-27 audit (`docs/security/abuse-threat-report-2026-07-27.md`):

- **Blob storage.** `files.registerFile` took a `storageKey` straight from the client. Every SQL
  query on the path was correctly tenant-scoped — the row lookup included `where tenant_id` — but
  the row pointed at another tenant's blob, and the download route dereferenced it. Storage keys
  are now derived from a signed, tenant-bound handle. When a row holds a pointer to something
  outside Postgres, tenant-scoping the row proves nothing about the thing it points at.
- **Campaign scope.** Tenant isolation and campaign isolation are different walls. A query can be
  perfectly tenant-scoped and still let a campaign-pinned Editor read another campaign's data.
  See `pplcrm-campaigns` — the pin is server-derived and applied in `BaseRepository`.

## Two layers, not one: the lint rule AND Postgres RLS (S-1)

Since the S-1 rollout (migration `2026-07-26-s1-row-level-security.ts`) the lint rule is **no
longer the only tenant wall.** Every base table with a `tenant_id` column (61 of them) has
`ENABLE + FORCE ROW LEVEL SECURITY` and a `tenant_isolation` policy:

```sql
USING / WITH CHECK (
  NULLIF(current_setting('app.tenant_id', true), '') IS NULL
  OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::bigint
)
```

How the GUC gets set:

- `apps/backend/src/app/lib/tenant-context.ts` holds the current tenant in an `AsyncLocalStorage`
  (`runWithTenant(tenantId, fn)` / `currentTenantId()`).
- The runtime pool's `onReserveConnection` hook (`base.repo.ts`) issues
  `select set_config('app.tenant_id', $1, false)` on **every** connection checkout, reading that
  ALS value (validated `^\d+$` or empty).
- The tRPC `isAuthed` middleware (`trpc.ts`) wraps the whole authenticated request in
  `runWithTenant(ctx.auth.tenant_id, …)`, so every downstream query is RLS-scoped.

**"Empty GUC = allow all" is deliberate.** Pre-auth "identify the tenant" queries (login/passkey,
refresh-token, webhook/api-key resolution, public event pages) and the background-job worker (some
jobs are intentionally cross-tenant, e.g. `prune_retention`) run with **no** tenant context — the
policy must not restrict them, and they stay protected by their app-level scoping. So RLS adds a
hard backstop **only on the authenticated tRPC path**, which is exactly where untrusted input
drives queries. Fastify REST routes and the worker are _not_ RLS-scoped today (GUC empty) — they
rely on app-level `.where('tenant_id', …)`. If you want RLS to also bind a REST handler, wrap its
body in `runWithTenant(tenantId, …)` _after_ the tenant is resolved (never before — that would
break the pre-auth identify query).

Two gotchas worth internalizing:

1. **This is why FORCE RLS didn't break the 528-test suite:** specs run as `pplcrm_app` with no ALS
   context, so the GUC is empty and the policy allows all. A test that wants to _prove_ isolation
   must use `runWithTenant` on a **non-transactional** `dbInstance` query — inside a
   `useTestTransaction()` the connection is reserved (and the GUC set) once at `BEGIN`, before any
   `runWithTenant`, so RLS won't re-scope mid-transaction. See `rls-tenant-isolation.spec.ts`.
2. **Cast the `NULLIF` result, not `current_setting` directly.** Postgres does not short-circuit the
   `OR`, and the GUC is set to `''` (not NULL) on unscoped checkouts, so a bare
   `current_setting(...)::bigint` throws `invalid input syntax for type bigint: ""`. `NULLIF(…, '')`
   turns empty into NULL and `NULL::bigint` is a safe no-op.

The lint rule still matters: RLS is a backstop, not a license to drop `.where('tenant_id')`. Keep
scoping in app code (clearer intent, better plans, and it's the _only_ protection on the REST/worker
paths). The rest of this doc is about that lint rule.

## The third layer: the API-level IDOR probe

`apps/backend/src/app/lib/tenant-isolation-api.spec.ts` (added 2026-07-25) is the test that covers
what neither the lint rule nor the RLS spec does — **the surface an attacker actually reaches.** It
builds a fully authenticated tRPC caller for tenant A (real `authusers` row + real active `sessions`
row keyed by `hashToken(plaintext)`) and calls real procedures with tenant B's record IDs, so it
exercises `isAuthed` → router → controller `.where('tenant_id', …)` → RLS in one path.

Know the difference before adding to either file:

| File                           | Proves                                                             |
| ------------------------------ | ------------------------------------------------------------------ |
| `rls-tenant-isolation.spec.ts` | the RLS **mechanism** works when bound via `runWithTenant`         |
| `tenant-isolation-api.spec.ts` | the **API** refuses cross-tenant reads, writes and session replays |

Two conventions to preserve if you extend it:

- **Keep the control test.** It asserts tenant A _can_ read its own person. Without it, every denial
  below could pass simply because the caller is broken — a probe that denies everything proves
  nothing.
- **Assert on data, not error codes.** Returning `undefined` and throwing `NOT_FOUND` are both
  secure; returning B's row is the breach. Pinning a `TRPCError` code makes the spec brittle against
  a legitimate refactor without making it a stronger security test.

If you change tenant scoping anywhere, the honest check is whether this probe would still go red —
it was mutation-tested (simulating a leak makes it fail), so a green run here is worth something.

## Where it lives and where it actually runs

- Rule source: `tools/eslint-rules/rules/no-unscoped-db-query.cjs`
- Registered as `local/no-unscoped-db-query` in `tools/eslint-rules/index.cjs`
- **Enabled for backend module AND lib files:** `apps/backend/eslint.config.cjs` scopes it to
  `files: ['**/src/app/modules/**/*.ts', '**/src/app/lib/**/*.ts']`,
  `ignores: ['**/*.spec.ts', '**/src/app/lib/base.repo.ts']`, severity `error`. (lib/\*\* was added
  2026-07-31: the background workers, job handlers, and mail services live there, write donations
  and send newsletters, and the RLS backstop is inert there — workers never bind the per-request
  tenant context, see `lib/tenant-context.ts`.)

So the rule does **not** run on: `apps/backend/src/app/lib/base.repo.ts` (the generic query
builder — tenant filtering is the callers' responsibility), `*.spec.ts`, migrations, or any
frontend/common code. Queries in those files get **zero** tenant-scope enforcement — they are
the manual-review frontier.

### Gotcha: plain `eslint` from the repo root does NOT enable this rule

The root `eslint.config.cjs` registers the `local` plugin but never turns the rule on. Only
`apps/backend/eslint.config.cjs` enables it, so bare `npx eslint` on a backend file leaves the
tenant rule silent. To actually exercise it:

```bash
npx nx lint backend
# or, to check one file with the backend config explicitly:
npx eslint --config apps/backend/eslint.config.cjs <path-to-a-modules-file>.ts
```

If you "test" your query with bare `npx eslint file.ts`, you get a false all-clear.

## What trips it

The rule fires when a **single contiguous** method chain:

1. contains a scope starter — `selectFrom` / `updateTable` / `deleteFrom` (`SCOPE_METHODS`), AND
2. ends in a terminal — `execute` / `executeTakeFirst` / `executeTakeFirstOrThrow` / `stream`
   (`EXECUTE_METHODS`), AND
3. has no `.where(...)` in that chain whose first string argument contains the substring
   `tenant_id`, AND
4. the table (first arg of the scope method, if a string literal) is not on `ignoreTables`.

Minimal repro that fails `npx nx lint backend`:

```ts
// ❌ inside apps/backend/src/app/modules/** or lib/**  → "Kysely query on 'persons' has no
//    .where('tenant_id', …) filter"
db.selectFrom('persons').selectAll().execute();
```

Fix — add the scope. Real correctly-scoped example from
`apps/backend/src/app/modules/teams/controller.ts`:

```ts
const rawLists = await trx
  .selectFrom('lists')
  .select(['id', 'name', 'description', 'object', 'is_dynamic'])
  .where('tenant_id', '=', auth.tenant_id)
  .where('id', 'in', finalListIds)
  .execute();
```

Note the matching is a substring check: `.where('lists.tenant_id', ...)` also
satisfies it. And it only checks that _some_ `.where` mentions `tenant_id` — it does **not** verify
the operator or value. `.where('tenant_id', 'is not', null)` would pass the linter while scoping
nothing. The rule proves a `tenant_id` filter is _present_, never that it is _correct_.

## What it silently CANNOT catch — the dangerous part

`collectChain` in the rule walks `callee.object` step by step and **stops** the moment the
chain is anything other than a `CallExpression` on a `MemberExpression`. Consequences:

1. **Broken-up chains pass silently.** Assigning the builder to an intermediate variable severs the
   walk, so the `selectFrom` is never found and the rule never fires — even with no tenant scope
   anywhere:

   ```ts
   // ⚠️ NOT flagged, and NOT tenant-safe. The rule can't see selectFrom from the .execute() call.
   const q = db.selectFrom('persons').selectAll();
   return q.execute();
   ```

   When you review or write a query split across statements, you must confirm the `tenant_id`
   scope yourself — lint gives you nothing here.

2. **Subquery/callback table forms produce false positives, not silence.** When the table is a
   callback (`selectFrom((qb) => ...)`) instead of a string literal, the outer chain has no literal
   table and no outer `tenant_id` where, so the rule _flags_ it even though `tenant_id` is filtered
   inside the subquery. This is the legitimate reason for the disables in the repo. Real example,
   `getDuplicateCount` in `apps/backend/src/app/modules/persons/repositories/persons.repo.ts`:

   ```ts
   public async getDuplicateCount(tenant_id: string): Promise<number> {
     // NOTE: unscoped by design — tenant_id filtered inside subquery
     // eslint-disable-next-line local/no-unscoped-db-query
     const countResult = await this.db
       .selectFrom((qb) =>
         qb.selectFrom('potential_duplicates')
           .innerJoin('persons', 'potential_duplicates.person_id', 'persons.id')
           .where('potential_duplicates.tenant_id', '=', tenant_id)
           // ...
           .as('sub'),
       )
       .select([sql<number>`count(group_key)`.as('total')])
       .executeTakeFirst();
   }
   ```

   The near-identical pattern is in
   `apps/backend/src/app/modules/households/repositories/households.repo.ts`. List the current
   disable sites with `grep -rn "eslint-disable-next-line local/no-unscoped-db-query"
apps/backend/src`; most pair the disable with a `NOTE:` explaining where the real scope lives.
   Match the best of them: never add a bare disable — write the `// NOTE:` sentence proving the
   tenant filter exists, then have a reviewer confirm it.

## The ignore-list (allow-list) and why each table is on it

The rule has a built-in default list, but **the enforced list is set by the `ignoreTables`
config override in `apps/backend/eslint.config.cjs`**, not the default. The live list is 7
tables:

| Table             | Why cross-tenant access is intentional                                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authusers`       | Login is by email before any tenant is known. See `passkey.controller.ts` — `.selectFrom('authusers').where('email', '=', …)`. It _selects_ `tenant_id` to establish scope for everything after.                                      |
| `sessions`        | Sign-out / session lookup is by `session_id` hash; the token carries no tenant.                                                                                                                                                       |
| `tenants`         | The tenant table itself is looked up by `id`; scoping it by `tenant_id` is circular.                                                                                                                                                  |
| `rate_limits`     | Abuse counters keyed by opaque caller-namespaced strings (an IP, an email, a tenant); no `tenant_id` column, and the limiter deliberately runs outside any tenant context. Added 2026-07-27.                                          |
| `background_jobs` | The shared job queue. The worker claims/settles/recovers rows across ALL tenants by design, keyed by globally-unique row id; `tenant_id` is nullable (cron singletons have none). Added 2026-07-31 with the lib/\*\* scope expansion. |
| `webhook_events`  | The Stripe event queue. Rows are ingested before tenant resolution (`tenant_id` nullable, filled from the connected account when resolvable) and the drain worker claims/settles by globally-unique row id. Added 2026-07-31.         |
| `ops_heartbeats`  | Platform dead-man's-switch state for `/healthz/worker`; the table has no `tenant_id` column at all. Added 2026-07-31.                                                                                                                 |

The pattern: a table is safe to allow-list only if its natural key is **globally unique and not
tenant-derived** (email, session hash, the tenant id itself, a queue row id) — or it is pure
platform infrastructure with no per-tenant business data. If the table has a `tenant_id`
column and queries key on it, it does not belong on the list.

Note the queue-table tradeoff accepted on 2026-07-31: `background_jobs` and `webhook_events` DO
have a (nullable) `tenant_id`, and allow-listing them silences the rule for module code too —
e.g. `duplicates.repo.ts#getLastSweepAt`. That was judged acceptable because every query on them
is queue machinery keyed by row id / status, and the rows' business payloads are only acted on
by handlers that scope their own queries. A tenant-facing feature that LISTS a tenant's jobs
must still hand-add the `tenant_id` filter — the linter will not remind you.

### Bearer-credential lookups: intentional, per-method, NOT allow-listed

A handful of repo methods resolve a **bearer credential to its tenant** and so cannot be
tenant-scoped — the credential is what establishes the scope. These are deliberately _not_ on
`ignoreTables` (that would silence the whole table); each is a single documented method, and
every downstream read/write is scoped by the `tenant_id` it returns. The full set:

| Method                                    | Credential                                                            |
| ----------------------------------------- | --------------------------------------------------------------------- |
| `CompanionSessionsRepo.findByTokenHash`   | sha256 of the device session token                                    |
| `DeliveryRoutesRepo.findByTokenHash`      | sha256 of the `/r/:token` share link                                  |
| `TurfAssignmentsRepo.resolveByToken`      | sha256 of the `/t/:token` capability link                             |
| `JoinCodesRepo.resolveByCode`             | the 8-char QR join code (`campaign_join_codes.code`, UNIQUE globally) |
| `ApprovalTokensRepo.resolveByToken`       | sha256 of an approve-by-text link                                     |
| `OrganizerTokensRepo.resolveByToken`      | sha256 of the `/o/:token` organizer launch-page link                  |
| `CompanionVolunteersRepo.findByJoinClaim` | sha256 of the one-shot QR-join claim                                  |

Adding a new one is the same review as adding an allow-list entry: the key must be globally
unique (a partial unique index counts), high-entropy or rate-limited, and the method must
return `tenant_id` for everything after it to scope by. Note the lint rule only tracks chains
starting at `selectFrom`/`updateTable`/`deleteFrom`, so a `BaseRepository.getSelect()` chain
like these never trips it — the discipline here is human, not mechanical.

### Cautionary tale: three tables used to be on this list and shouldn't have been

Until 2026-07-04 the list also carried `tags`, `ms_oauth_tokens`, and `google_oauth_tokens` — and
all three rationales had rotted:

- `tags` was justified as "scoping happens at the join level," but every real module query already
  scoped `tenant_id` directly. Removing it surfaced zero lint errors — the entry was pure dead
  risk.
- The two OAuth-token tables were justified as "keyed by `user_id` (globally unique)" — true when
  written, but migration `2026-06-26-email-sync-per-tenant.ts` re-keyed both tables on
  `UNIQUE (tenant_id)` and made `user_id` nullable. These tables hold access/refresh token
  secrets; an unscoped `selectFrom('ms_oauth_tokens')` would have returned every tenant's tokens
  with no lint warning. Removing them surfaced two queries still keying on `user_id` alone
  (`emails-api.route.ts`), which were fixed by adding the tenant scope.

The lesson: **allow-list rationales rot silently when the schema changes.** A migration that
changes a table's keying must re-check whether that table is on this list. If you're touching the
schema of an allow-listed table, re-justify or remove its entry in the same PR.

## Adding a table to the ignore-list — a security review, not a lint fix

Adding a table silences the rule for **every** query against it, forever, everywhere in
`modules/**` and `lib/**`. Before editing `ignoreTables` in `apps/backend/eslint.config.cjs`:

1. Prove the table has no `tenant_id` column, OR that every legitimate query genuinely must span
   tenants (auth/session/tenant-lookup shaped). If the table has a `tenant_id`, the answer is
   almost always "scope the query," not "allow-list the table."
2. Prefer the narrowest tool. A one-off intentional cross-tenant query should be a per-line
   `// eslint-disable-next-line local/no-unscoped-db-query` **with a `// NOTE:` proving safety**
   (see the ~24 existing sites — the 2026-07-31 lib/\*\* expansion added the cron-scan and
   Stripe-subscription-id ones) — not a global allow-list entry.
3. Add a one-line justification in the config comment block above `ignoreTables` in the same style
   as the existing entries, naming the safe key. An entry with no rationale is a review reject.
4. Get a second reviewer. This is the one lint change where "it makes the error go away" is exactly
   the wrong reason to merge it.

After changing the list, re-run `npx nx lint backend` and confirm nothing _else_ newly passes that
should not have.

**Known baseline:** as of 2026-07-31 (the lib/\*\* scope expansion) `npx nx lint backend` passes
with zero `no-unscoped-db-query` errors. If you see one, your diff caused it — but check the
"Heads-up" note in `pplcrm-quality-gate` in case the baseline moved again.

## Non-goals

- General Kysely query building, `Insertable`/`Updateable`, transactions, TRPCError, the
  transactional outbox → **`pplcrm-trpc-backend`**.
- Writing/altering migrations and the `schema.sql` baseline (the rule ignores migrations) →
  **`pplcrm-migrations`**.
- The full pre-commit-vs-`nx lint` gap and the general lint command sequence →
  **`pplcrm-quality-gate`**. This skill only covers the one wrinkle that this rule is off in the
  root config and on only in the backend config.
- Running a broad review/verify pass → the `/code-review`, `/security-review`, and `/verify`
  slash-command skills.
