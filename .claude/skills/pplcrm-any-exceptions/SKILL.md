---
name: pplcrm-any-exceptions
description: The catalogue of intentional `any` in the backend — which categories remain (dynamic Kysely builders, external Gmail/Graph JSON, tRPC shape, BigInt seams), why each is unavoidable, and how they are marked (the AnyQB alias / a scoped eslint-disable). USE WHEN you hit an `@typescript-eslint/no-explicit-any` warning in apps/backend, are reviewing an `any` and wondering if it is deliberate, or are tempted to add a new `any` or eslint-disable. EXAMPLES 'is this any intentional or a bug', 'can I add an any here', 'how do I get the backend to zero any'.
metadata:
  type: reference
---

# Backend `any` exceptions — the reviewed residue

The backend was swept for `@typescript-eslint/no-explicit-any` (409 → ~140).
What remains is **intentional** and falls into the categories below. Each is
either confined to a single named alias, marked with a scoped `eslint-disable`

- reason, or left as a plain warning because typing it would be a _lie_ or needs
  a dependency decision. **Before adding a new `any`, check whether it fits one of
  these categories — if not, it is almost certainly avoidable** (use `unknown` +
  a Zod parse or type guard; see `pplcrm-schemas-validation`). Never silence the
  rule with a bare disable — if you must, add a `-- reason` and add the site here.

The rule stays at **warn**, not error, and the remaining plain-warning `any`
are non-blocking. The value of this list is that a reviewer can tell "deliberate"
from "sloppy" at a glance, and a _new_ accidental `any` still shows up in the
warning delta.

## 1. Dynamic Kysely query builders → the `AnyQB` alias

**Where:** `lib/base.repo.ts` (the alias) + the `applyFilters` helper in every
grid repo (lists/persons/households/teams/tags/events/web-forms/workflows/
volunteer-events).
**Why unavoidable:** grid queries select columns at runtime, left-join, and add
aliased aggregates, which erases Kysely's parameterised row type. The filter/sort
helpers are genuinely generic over "some select builder".
**How marked:** one exported `type AnyQB = SelectQueryBuilder<any, any, any>` in
`base.repo.ts` with a single justified `eslint-disable`. Use `<QB extends AnyQB>`
— do **not** re-introduce a bare `SelectQueryBuilder<any, any, any>`.
**Follow-up:** the expression-builder callbacks inside those helpers
(`eb: any`, `query: any` in `base.repo.ts`) are the same category and could be
folded into a sibling `AnyEB` alias if desired.

## 2. Base-repo dynamic-read results (`{}` rows)

**Where:** `base.repo.ts` `getOneBy` / `getOneById` / `getManyBy` results, and the
`as any` casts on them in controllers (billing, lists, companies, files, …).
**Why unavoidable:** these run through `getSelectWithColumns`, which may select a
_subset_ of columns, so the result type collapses to `{}`. Casting to
`Selectable<Models[T]>` would **claim columns that were not selected** — a type
lie that invites undefined access. `getAllWithCounts` rows are typed honestly as
`Record<string, unknown>` for the same reason.
**How marked:** left as plain warnings. When you consume one, cast to the
_specific_ shape you requested (a local interface / `Selectable<…>` you know is
present), never widen back to `any`.

## 3. External REST JSON with no installed types — Gmail / MS Graph

**Where:** `modules/google-sync/google-sync.service.ts`,
`modules/ms-sync/ms-sync.service.ts`.
**Why unavoidable:** these adapters walk deeply-nested Gmail REST and MS Graph
message/attachment payloads (`msg.from?.emailAddress?.address`, recursive
`part.parts`, header arrays). No type package is installed
(`@microsoft/microsoft-graph-types` is **not** a dependency; there is no Gmail
API type either), and narrowing every optional-chained read into guards would
risk changing behaviour on malformed payloads.
**How marked:** a **file-level** `eslint-disable @typescript-eslint/no-explicit-any`
with a reason at the top of each file — these modules are external-JSON adapters
by nature, so the whole-file scope is deliberate (documented here as the reviewed
decision). Accept that a new `any` in _these two files only_ won't be flagged.
**Follow-up (dependency decision, owner's call):** `npm i -D
@microsoft/microsoft-graph-types` + a Gmail types shim would let both files be
typed and the file-level disables removed.

## 4. tRPC v11 error-formatter shape

**Where:** `src/trpc.ts` (`errorFormatter`, ~lines 62/63/71).
**Why unavoidable:** tRPC v11 does not export the `shape` / `error.cause` types
the formatter reshapes; these casts forward safe metadata and redact messages.
**How marked:** scoped `eslint-disable-next-line … -- reason` at each site.

## 5. `BigInt(tenant_id)` vs the Kysely string-id model

**Where:** `lib/mail/transactional-mail.service.ts`, `lib/sms/sms.service.ts`
(`background_jobs` enqueue), `modules/billing/usage-limits.ts` (tenant/admin
lookups).
**Why unavoidable:** these paths pass a `BigInt` tenant id where the Kysely model
types the column as `string`; changing to a string would alter the runtime value.
**How marked:** scoped `eslint-disable-next-line … -- reason` at each site.

## Non-production code

`no-explicit-any` is turned **off** for `**/_migrations/**` (applied, append-only
DDL) and `**/*.spec.ts` (test doubles) via `apps/backend/eslint.config.cjs`.

## Getting to literally zero

Would require, in rough order of effort: fold §1's `eb/query` into an `AnyEB`
alias; install the Graph/Gmail type packages (§3); and hand-type §2's read
results at each call site with the concrete requested shape. §4/§5 stay as
justified disables. This is optional — the categories above are the accepted
end state.
