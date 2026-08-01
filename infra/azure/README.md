# pplCRM Azure infrastructure (Bicep)

Per-region data + compute plane, parameterized by region so US/EU are a param change rather than a
manual re-walk of `deploy/PROD-CHECKLIST.md`. Region 1 (Canada Central) was stood up by hand first;
these templates mirror those exact resources and are the reproducible path for regions 2+.

Two templates, two deploy paths:

| Template           | Contents                            | Deployed by                                                          |
| ------------------ | ----------------------------------- | -------------------------------------------------------------------- |
| `main.bicep`       | Postgres + Blob (the data plane)    | **Manually** — needs `pgAdminPassword` on the CLI                    |
| `monitoring.bicep` | Probes, action group, metric alerts | **CI** (`.github/workflows/deploy-infra.yml`) — needs no DB password |

The split is deliberate: `monitoring.bicep` references the existing Postgres server (`existing`
keyword) instead of provisioning it, so CI can deploy alert changes on merge without the DB admin
password ever entering GitHub.

`monitoring.bicep` does need one GitHub Actions secret: **`OPS_ALERT_SMS_NUMBER`**, the on-call
mobile number for the SMS alert receiver. It is a personal number, so it is not committed to
`canadacentral-monitoring.bicepparam`; the workflow passes it as `-p opsAlertSmsNumber=` and
**fails the job outright if the secret is unset**, because a deploy without it would silently
produce an action group with no SMS receiver. See `deploy/GO-LIVE-CHECKLIST.md` §1.

## What main.bicep provisions (manual)

- **PostgreSQL Flexible Server** (`pplcrm-pg-<regionCode>`, Burstable B1ms, PG 16)
- The **`pplcrm` database**
- The **`azure.extensions` allow-list** (`PG_TRGM,PGCRYPTO`) the schema baseline needs
- **Firewall rules**: Allow-Azure-Services (for the Container App) + optional admin client IP
- **Blob storage** account (`pplcrm<regionCode>storage`, Standard_LRS, no public access) + private `uploads` container

_WIP — the `pplcrm-api` Container App is appended when the checklist reaches §3._

## What monitoring.bicep provisions (CI, PROD-CHECKLIST §9)

- **Log Analytics workspace** + workspace-based **Application Insights**
- **Standard availability tests** (5-min, 5 regions, expect 200): `api.pplcrm.com/healthz` (503 on
  DB-down = failure by design), `app.pplcrm.com`, `go.pplcrm.com`, an optional tenant
  `*.pplforms.com` host (`formsProbeUrl`), and — once the backend ships `GET /healthz/worker` —
  the job-worker dead-man heartbeat (`enableWorkerProbe`)
- **Action group `pplcrm-ops-ag`**: Azure mobile-app push + email to `opsAlertEmail`, plus an SMS
  receiver when `opsAlertSmsNumber` is supplied (the `smsAlertReceiverConfiguredOut` output says
  whether one was created)
- **Metric alerts**: availability failures, Container App restarts / zero replicas (the workflow
  looks up `containerAppResourceId`; skipped until the app exists), Postgres
  cpu/storage/connection saturation

Config changes (thresholds, probe targets, `enableWorkerProbe`) are commits to
`canadacentral-monitoring.bicepparam` / `monitoring.bicep` — merging to main deploys them. The
workflow can also be run on demand via **workflow_dispatch**. Prerequisite: the
`AZURE_CREDENTIALS` service principal must be able to create `Microsoft.Insights` /
`Microsoft.OperationalInsights` resources in the RG (Contributor covers it).

After the first monitoring deploy:

1. Portal → `pplcrm-appinsights-cad` → Availability: all tests green within ~10 minutes.
2. Portal → `pplcrm-ops-ag` → **Test action group**: confirm the phone push + email arrive
   (push requires being signed into the Azure mobile app).
3. Once the backend exposes `GET /healthz/worker` **and its `ops_heartbeats` migration has run in
   prod**, set `enableWorkerProbe = true` in `canadacentral-monitoring.bicepparam` and merge —
   that adds the worker probe + alert. Enabling it earlier 404-alerts.

## Deploy a region (manual data plane)

```bash
# 1. Resource group for the region
az group create -n pplcrm-cad-prod -l canadacentral

# 2. Deploy (password passed on the CLI, never committed)
az deployment group create \
  -g pplcrm-cad-prod \
  -f infra/azure/main.bicep \
  -p infra/azure/canadacentral.bicepparam \
  -p pgAdminPassword='<admin password>' \
  -p adminClientIp="$(curl -s https://api.ipify.org)"
```

Dry-run first with `az deployment group what-if` (same flags) — existing pg/storage resources must
show **NoChange**.

For a new region, copy both `.bicepparam` files → e.g. `eastus.bicepparam` +
`eastus-monitoring.bicepparam`, change `location`/`regionCode`, drop the `pgServerName` pin (so it
uses the `pplcrm-pg-<regionCode>` convention), deploy `main.bicep` into that region's resource
group, and point a workflow job at the new monitoring params.

## Not covered here (deliberately)

- **Global/shared** resources: Cloudflare DNS/TLS, GHCR images, Cloudflare Pages/Workers.
- **Multi-region tenant routing / residency** (which tenant hits which regional backend) — an
  unsolved _design_ task, tracked separately. Standing up more regions without it yields isolated
  backends with no routing between them.
