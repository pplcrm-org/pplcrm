---
name: pplcrm-observability
description: "How pplCRM knows the service is down before a user does — Azure Monitor availability probes + alerting (in bicep), /healthz vs /healthz/worker semantics, the ops_watchdog cron + ops_heartbeats dead-man's switch, backend-only Sentry with PII scrubbing, and the CI post-deploy smoke test. USE WHEN adding or changing a health endpoint, changing alert thresholds or probe targets, adding a background job that must be monitored, investigating a fired alert or a stale-heartbeat 503, touching Sentry config/scrubbing, or wiring monitoring for a new surface. EXAMPLES: 'the worker probe is alerting', 'why did I get an ops digest email', 'is Sentry allowed in the browser?'."
---

# pplCRM observability

Two halves: **"is it up"** (external Azure Monitor probes — they alert even when the whole backend
is dead) and **"who tells the operator"** (the in-app ops watchdog — it digests failures the probes
can't see). Don't blur them: anything that must fire when the process is DOWN cannot live in the
process.

## The external half — Azure Monitor (infra as code)

All in `infra/azure/monitoring.bicep` + `canadacentral-monitoring.bicepparam`, **deployed by CI**:
`.github/workflows/deploy-infra.yml` runs `az deployment group create` on any merge touching those
files (or via workflow_dispatch). No secrets — monitoring.bicep references the existing Postgres
server via `existing` instead of provisioning it, which is why it's split from the manual,
password-bearing `main.bicep`. Provisioned:

- **Availability tests** (App Insights standard webtests, every 5 min from 5 regions, expect 200):
  `api.pplcrm.com/healthz`, `app.pplcrm.com`, `go.pplcrm.com`, optional `formsProbeUrl` tenant
  host, and — only with `enableWorkerProbe = true` — `api.pplcrm.com/healthz/worker`.
- **Action group `pplcrm-ops-ag`**: Azure mobile-app push + email to `opsAlertEmail`
  (set in `canadacentral-monitoring.bicepparam`). Test via portal → action group → "Test action group".
- **Metric alerts**: per-test availability (2+ locations failing / 5 min), Container App
  `RestartCount`/`Replicas` (the workflow looks up `containerAppResourceId`; skipped until the
  hand-created app exists), Postgres `cpu_percent` > 90, `storage_percent` > 80,
  `active_connections` > `pgConnectionAlertThreshold` (40; B1ms max ≈ 50).

Changing a threshold, probe target, or the `enableWorkerProbe` flag = edit
`monitoring.bicep`/`canadacentral-monitoring.bicepparam` and **merge to main** — CI deploys it;
there is no portal-only config to drift. The security page claims "probes every few minutes that
page us" — if you weaken this materially, update `security-content.ts` (see `pplcrm-website-claims`).

## Health endpoints (`apps/backend/src/app/routes.ts`)

| Endpoint              | Means                                                                                                                 | Used by                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `GET /`               | process is up (no DB touch)                                                                                           | Container App **liveness** probe                               |
| `GET /healthz`        | Postgres reachable (`select 1`), else 503; body carries `build` = the image's commit SHA (`BUILD_SHA`, 'dev' locally) | Container App **readiness**, CI smoke test, availability probe |
| `GET /healthz/worker` | ops watchdog heartbeat fresh (< 20 min), else 503 `{status:"stale"}`                                                  | availability probe only                                        |

Rules: liveness must NEVER check the DB (a DB outage would restart-loop the app); `/healthz` must
NEVER include worker/queue state (a jammed queue must not pull the API from ingress). The probe
YAML patch lives in `deploy/GO-LIVE-CHECKLIST.md` §10 (probes are YAML-only; `az containerapp
update` has no probe flags).

## The internal half — ops watchdog + dead-man's switch

`ops_watchdog` is a self-rescheduling cron job (every 5 min), same pattern as the other crons:
payload in `job-payloads.ts`, handler `lib/jobs/handlers/ops.handlers.ts`, dispatch in
`job-handlers.ts`, and — like every recurring job — an entry in `CRON_JOBS`
(`lib/jobs/cron-registry.ts`). That registry is the single source of truth for the recurring set:
`worker.start()` seeds every entry (advisory-locked `seedCronJob` in `reschedule.ts`),
`rescheduleCronJobOnFailure` re-seeds any permanently-failed entry at its registry interval (so a
cron chain can't silently die), and handlers pull their `scheduleNextRun` interval from it.
`cron-registry.spec.ts` hard-codes the expected type list as a drift tripwire. Each cycle it:

1. Digests **new** `status='failed'` rows in `background_jobs` (grouped by `payload->>'type'`) and
   `webhook_events`, queue backlog (oldest runnable pending job > 15 min), and tenants newly
   `sending_paused_at` — watermarked via `details.last_checked_at`, so nothing is reported twice.
2. Emails the digest to `OPS_ALERT_EMAIL` **directly** through `TransactionalEmailService` — never
   via `enqueueMail`, because the queue may be the sick component. Unset env = log-only.
   Identical digests are suppressed for 6 h. The fingerprint is per failure _category_ plus an
   order-of-magnitude bucket of its count (`job:<type>:m<log10>`), so a steady trickle stays
   suppressed but a category crossing a decade (9→10, 99→100) re-alerts immediately.
3. Upserts `ops_heartbeats` (`name='ops_watchdog'`) — the dead-man beat `GET /healthz/worker`
   reads. The beat lands only after a full claim→execute→complete cycle, which is exactly why the
   external probe catches a wedged worker loop, a lost LISTEN connection, or a poison-job jam
   while HTTP stays healthy. Stale threshold: 20 min (`WORKER_HEARTBEAT_STALE_MS`, routes.ts).

**New background jobs are covered automatically** — the watchdog watches `background_jobs`
generically. No per-job wiring needed.

Investigating a stale-heartbeat alert: worker logs (`Background Job Worker`), then
`select * from ops_heartbeats;` and `select status, count(*) from background_jobs group by 1;`.
The `details` jsonb holds the last watermark/fingerprint. `ops_heartbeats` is deliberately global
(no `tenant_id`) — it and the watchdog queries are cross-tenant by design; `lib/jobs/handlers/`
is outside the `local/no-unscoped-db-query` rule's scope (`modules/**` only).

## Sentry (backend ONLY)

- Init in `apps/backend/src/instrument.ts` — **must stay the first import of `main.ts`**. Disabled
  entirely when `SENTRY_DSN` unset. Errors only (`tracesSampleRate: 0`), `sendDefaultPii: false`.
- `beforeSend` strips cookies, `authorization`, `x-companion-session`, request bodies, user
  email/IP. This scrubbing is a **published privacy commitment** (privacy policy subprocessor
  entry) — widening what Sentry receives requires updating `privacy-content.ts` in the same change.
- Capture points: `setupFastifyErrorHandler` (fastify.server.ts), `trpc.ts` errorFormatter
  (INTERNAL_SERVER_ERROR only — mapped AppErrors stay out), and the two worker catch paths
  (worker.ts, webhook-worker.ts) since job failures never cross a request path.
- **Never add a browser/Angular Sentry SDK** without first updating the privacy policy: the site
  claims nothing from Sentry runs in the browser and no third-party scripts exist client-side.

## Edge + CI

- Both edge Workers (`infra/go-edge`, `infra/pplforms-edge`) wrap the backend proxy in
  try/catch + `AbortSignal.timeout(30s)`: network-level failure → JSON 503
  (`{status:'unavailable'}`, `retry-after: 30`); pplforms' `/d/*` browser navigations get a tiny
  inline HTML page. Backend 5xx _responses_ pass through untouched — only thrown fetches are caught.
- `deploy.yml` "Smoke test backend /healthz": after `az containerapp update`, polls
  `https://api.pplcrm.com/healthz` 12×15 s and fails the workflow (before edge deploys) unless it
  gets HTTP 200 **and** a `build` field equal to the deployed `github.sha`. The SHA check exists
  because single-revision Container Apps keep the OLD revision serving (and answering 200) when
  the new one never becomes healthy; `BUILD_SHA` is baked in as a Docker build arg in the image
  job, using the same `github.sha` as the image tag. The failure message distinguishes
  "answered with a different build (old revision still serving)" from "never answered 200".

## Gotchas

- `enableWorkerProbe` starts `false`: flipping it on before the backend serving `/healthz/worker`
  is deployed and migrated 404-alerts forever. Order: backend deploy + migration → then flip the
  flag in `canadacentral-monitoring.bicepparam` and merge (CI deploys it).
- The `ops_heartbeats` migration seeds the row at migration time, so a worker that never runs is
  stale-from-birth → alerts. That direction is intentional.
- `/healthz/worker` treats a missing table (migration not yet applied) as stale (503) — also
  intentional; don't "fix" it to 200.
- Both `logger.ts` and `fastify.server.ts` must keep the env-aware pino transport (pretty only
  outside production) — prod logs are JSON for Log Analytics.
