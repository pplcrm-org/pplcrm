# uptime-edge

Cloudflare Worker that is the **external "is it up" probe** for the pplCRM backend. It replaced the
Azure Monitor availability web tests on 2026-09-16 (they billed per execution — ~CAD 27/mo, half the
Azure invoice — while a Worker cron trigger is free on the plan in use). Because it runs on
Cloudflare, not Azure, it still pages when the entire Azure region is unreachable.

What it does (see [`src/index.ts`](src/index.ts)):

| Piece                                   | Behaviour                                                                                                                                                                                      |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cron trigger `*/2 * * * *`              | Every 2 minutes, probes each `TARGETS` entry (`api.pplcrm.com/healthz`, `api.pplcrm.com/healthz/worker`). One in-run retry after 10 s.                                                         |
| `UptimeMonitor` Durable Object (SQLite) | Holds the consecutive-failure count and an `alerted` flag per target. `FAIL_THRESHOLD = 2` runs ⇒ an outage is paged after ~4 minutes, **once**; recovery is paged once. Nothing repeats.      |
| Notifications                           | SMS via Twilio to `OPS_ALERT_SMS_NUMBER` (10-digit national number, `OPS_ALERT_SMS_COUNTRY_CODE` prepended) **and** email via Postmark to `OPS_ALERT_EMAIL`. Each channel fails independently. |
| `GET /status`                           | Public, read-only JSON: last run time and per-target state. The daily health report reads it.                                                                                                  |
| `POST /test-alert`                      | `Authorization: Bearer $UPTIME_ADMIN_KEY` — sends a real SMS + email so the channels can be verified (the equivalent of Azure's "Test action group").                                          |

## Deploy

CI: `.github/workflows/deploy-infra.yml` job **`uptime`** runs on any change under
`infra/uptime-edge/` (or `workflow_dispatch`). It pushes the secrets below from GitHub Actions
secrets on every deploy and **fails before deploying if any is missing** — a probe that cannot
page anyone is worse than none, because it looks like coverage.

| GitHub secret           | Purpose                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN`  | Worker deploy (shared with deploy.yml)                             |
| `CLOUDFLARE_ACCOUNT_ID` | Worker deploy (shared with deploy.yml)                             |
| `TWILIO_ACCOUNT_SID`    | Same account the backend uses for volunteer SMS codes              |
| `TWILIO_AUTH_TOKEN`     |                                                                    |
| `TWILIO_FROM_NUMBER`    | E.164 sender, e.g. `+14165550100`                                  |
| `OPS_ALERT_SMS_NUMBER`  | On-call mobile, 10 digits (already set for the Azure action group) |
| `POSTMARK_SERVER_TOKEN` | Same Postmark server the backend uses for pplCRM→user mail         |
| `UPTIME_ADMIN_KEY`      | Random string; only gates `POST /test-alert`                       |

Manual deploy from this directory (needs `CLOUDFLARE_API_TOKEN` in the environment):
`npx wrangler deploy`, then `npx wrangler secret put <NAME>` for each secret above.

## Verify after the first deploy

1. `curl https://pplcrm-uptime.<account>.workers.dev/status` — `lastRunAt` advances every 2 min and
   both targets show `"lastOk": true`. (The exact hostname is printed by the deploy step.)
2. Run the `deploy-infra.yml` workflow by hand with **Send a test alert = true**, or
   `curl -X POST -H "Authorization: Bearer $UPTIME_ADMIN_KEY" .../test-alert`. Expect one SMS
   and one email within a minute; the response says `sent` / `failed: …` per channel.

## Changing what is probed

Edit `TARGETS` in `wrangler.toml` and merge. Keep `/healthz` on the 2-minute cron — the marketing
site's security page promises probes "every few minutes" (see the `pplcrm-website-claims` skill).
The worker heartbeat is a 20-minute signal, so probing it faster than that buys nothing but is
free here, unlike on Azure.

## Known limits

- Single vantage point per run (whichever Cloudflare location runs the cron). The in-run retry plus
  the two-run threshold replace Azure's "2 of 3 regions" rule.
- Nothing watches the watcher. If Cloudflare stopped running the cron, `/status` would go stale;
  the daily health report surfaces that (it reports `lastRunAt` older than 10 minutes as a gap).
