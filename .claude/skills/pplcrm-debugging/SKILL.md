---
name: pplcrm-debugging
description: "Tracing a failed request through the backend error plumbing (AppError → tRPC → Pino) to the client toast, plus this stack's silent-failure traps. USE WHEN debugging a runtime failure, a useless 'Something went wrong' toast, a stuck spinner, a swallowed error, or when someone gives you a correlationId / support code. EXAMPLES: 'why did this fail in production but the toast is generic', 'user gave me a support code, find the log', 'the spinner never stops'."
---

# Debugging pplCRM

## The one thing that will waste your time if you don't know it

**tRPC errors carry NO correlationId to the client.** CLAUDE.md §3 describes a
`correlationId`+Pino sanitization pattern as if it's universal — it is **not** wired into the tRPC
path. The only correlationId that ever reaches a human is the background-sync **"support code"**
generated in `apps/backend/src/app/lib/jobs/worker.ts`
(`Math.random().toString(36).slice(2, 10).toUpperCase()`), surfaced via
`oauthSvc.recordSyncError(... 'Sync failed — support code: ${correlationId}')`.

So there are two completely different failure paths, debugged differently:

1. **A user hands you a "support code" (e.g. `A1B2C3D4`)** → it's a Microsoft/Google sync job that
   died. Grep the logs for that literal code (see below).
2. **A tRPC toast** ("Not found", "Something went wrong, please try again", a validation message) →
   there is no id. You correlate by **timestamp + the underlying stack trace** in the server log,
   not by an id.

Since 2026-07-21, unexpected 500s (tRPC `INTERNAL_SERVER_ERROR`), unhandled Fastify route errors,
and every background-job/webhook failure are ALSO captured to **Sentry** when `SENTRY_DSN` is set
(prod) — with the full stack and a `trpcPath`/`jobType` tag, so check Sentry before grepping logs.
PII is scrubbed at the source (`apps/backend/src/instrument.ts`); see `pplcrm-observability`.

## The tRPC round trip (cite these when tracing)

A procedure throws → the client shows a toast. Every hop:

1. **Throw** — a procedure/repo throws an `AppError` subclass (`apps/backend/src/app/errors/app-errors.ts`:
   `NotFoundError`, `BadRequestError`, `ForbiddenError`, `ConflictError`, `InternalError`, …), a raw
   `Error`, or a `TRPCError`.
2. **Map** — `errorMappingMiddleware` (`apps/backend/src/trpc.ts`) wraps every `publicProcedure`
   and calls `toTRPCError(err)` (`apps/backend/src/app/errors/to-trpc-errors.ts`), which
   maps `AppError.status` → a tRPC code (400→`BAD_REQUEST`, 404→`NOT_FOUND`, etc.).
3. **The production-vs-dev message split** — `to-trpc-errors.ts` checks
   `const isDevOrTest = process.env['NODE_ENV'] !== 'production';`. In dev/test the underlying cause is
   appended to the message: `` `${err.message} (Cause: ${err.cause.message})` ``.
   **In production that append is skipped** — the client gets only the safe default message
   (e.g. `NotFoundError`'s `'Not found'`, `InternalError`'s `'Something went wrong, please try again'`).
   This is _the_ reason a prod toast is useless while the same bug is obvious locally. The real cause
   lives only in the server log.
4. **Log + format** — `errorFormatter` (`apps/backend/src/trpc.ts`) runs on every tRPC error:
   `logger.error({ err: error }, 'tRPC Error')` and, if there's a cause,
   `logger.error({ err: error.cause }, 'tRPC Error Cause')`. **The `'tRPC Error Cause'` line is
   the gold** — its serialized stack points at the file:line that actually threw. Note it does _not_ log
   the tRPC `path`, so you can't grep by procedure name here; match on the stack/message.
   (`errorFormatter` also collapses all sign-in failures to a generic message, so a
   bad-password toast is deliberately vague; that's not a bug.)
5. **Client receives** — `TRPCClientError` in the frontend link (`apps/frontend/src/app/services/api/trpc-service.ts`)
   is wrapped into `ApiError(msg, err)`, then `errorSvc.handle(finalErr)`.
6. **Toast** — `ErrorService.handle` (`apps/frontend/src/app/services/error.service.ts`) calls
   `this.alerts.showError(error.message)`; sibling branches handle bare
   `TRPCClientError`s and non-tRPC originals. `UNAUTHORIZED` short-circuits into a redirect
   to `/signin` instead of a toast. So the toast text == the server's
   `shape.message` from step 3/4.

REST routes (webhooks, file up/downloads) do **not** use this path — they hit the Fastify
`setErrorHandler` in `apps/backend/src/app/plugins/jsend-error-handler.plugin.ts`, which logs
unknown errors as `app.log.error({ err }, 'Unhandled error')` and returns a JSend envelope.

## Grepping Pino output

Both loggers (`apps/backend/src/app/logger.ts` for the standalone `logger` that tRPC/workers use;
`apps/backend/src/fastify.server.ts` for the Fastify request logger) use `pino-pretty` **only
outside production** — log lines are human-pretty in local/dev runs, plain JSON in production (for
Log Analytics). Grep by the literal message label or the code string:

```bash
# A tRPC failure and its root cause (run against your captured server output / log file):
grep -A20 "tRPC Error Cause"      # the stack that actually threw — start here
grep "tRPC Error"                 # the mapped/sanitized error the client saw

# A user's background-sync "support code" (worker.ts logs correlationId + userId):
grep -i "A1B2C3D4"                # matches the correlationId field in the log line
                                  # (the 'support code' sentence itself goes to the DB token record, not the log)
grep "sync permanently failed"    # all MS/Google sync deaths (worker.ts)

# REST/webhook path:
grep "Unhandled error"            # jsend-error-handler.plugin.ts
```

There is no request-id on the `'tRPC Error'` lines (they go through the standalone `logger`, not
Fastify's per-request logger), so correlate a tRPC failure by **timestamp + stack**, not by reqId.

## Silent-failure traps specific to this codebase

1. **Aborted requests are toasted-swallowed by design.** `trpc-service.ts` guards the handler with
   `if (!meta?.skipErrorHandler && !isAbortError(err))` — an aborted in-flight request produces **no
   toast and no error surfaced**. `TRPCService.abort()` fires on component
   teardown and superseded loads. If a load "silently does nothing," confirm it wasn't aborted before
   hunting for a thrown error. Callers can also opt out entirely via `context.skipErrorHandler`.

2. **A discarded loading-gate disposer = permanently stuck gate.** `createLoadingGate().begin()`
   (`libs/uxcommon/src/loading-gate.ts`) returns a disposer; the gate's `pendingCount` only
   decrements when you call it. The correct pattern is try/finally, e.g. in
   `person-view.ts` (`const end = this._loading.begin(); try { … } finally { end(); }`). If you
   call `begin()` and **throw away the return value**, `visible` flips true after the 300ms delay and
   never resets. Real example of the discard shape:
   `apps/frontend/src/app/experiences/emails/ui/email-details/email-details.ts` —
   `this.noEmailMsgDelay.begin();`
   — there it's deliberate (a fallback message that should stay shown), but the identical code in a
   load path is a stuck-spinner bug. When a spinner never stops, grep the component for a `begin()`
   whose disposer isn't `end()`-ed in a `finally`.

3. **A floating promise on a fire-and-forget tRPC call swallows the failure.** ESLint's
   `no-floating-promises` forces every promise to be handled, and the common quick fix is a bare
   `.catch(() => console.error(...))` — which means the error is logged to the browser console but
   **never toasted**. Real example (same file as above):
   `this.store.loadEmailWithHeaders(e.id).catch((err) => console.error('Failed to load email header:', err))`.
   If data silently fails to appear with no toast, check the browser console for a swallowed
   `.catch` before assuming the request never fired.

4. **A preloaded chunk that failed to import poisons that route for the whole session.** `app.config.ts`
   uses `withPreloading(PreloadAllModules)`, so every lazy route is `import()`ed in the background after
   first paint — and Angular's `PreloadAllModules` swallows preload failures (`catchError(() => of(null))`).
   Per the module spec a failed module URL stays failed in the document's module map, so the user's later
   click on that route fails **instantly, with no network request**, while the chunk is perfectly healthy on
   the server. On app.pplcrm.com (Cloudflare Pages, `/*  /index.html  200`) a momentarily missing chunk comes
   back as HTML, so the symptom reads `Failed to load module script: … MIME type of "text/html"` followed by
   `TypeError: Failed to fetch dynamically imported module: …/chunk-XXXX.js`. Don't go hunting the deploy —
   `curl -I` the chunk first; it usually 200s. `apps/frontend/src/app/routing/stale-bundle.ts` recognises
   all four engines' wording; `withNavigationErrorHandler` hard-loads the target URL once (a fresh document
   is the only cure), and `ErrorService` shows `STALE_BUNDLE_MESSAGE` when the one-per-30s claim is refused.

## Non-goals

- **TRPCError codes / how to throw them / transaction & outbox conventions** → `pplcrm-trpc-backend`.
  This skill is about _reading_ a failure after the fact, not authoring the endpoint.
- **Generic Node/Angular/browser debugging** (breakpoints, `--inspect`, DevTools) — out of scope; every
  tip here is about this repo's specific wiring.
- **Reproducing/driving a change to confirm a fix** → use the `/verify` and `/run` slash-command skills.
