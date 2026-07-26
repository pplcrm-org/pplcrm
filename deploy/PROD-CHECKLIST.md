# pplCRM Production Go-Live Checklist

> **STATUS 2026-07-21: initial bring-up is COMPLETE.** Everything below was executed and the stack is
> live in test/pipeline mode (topology table in [`GO-LIVE-CHECKLIST.md`](./GO-LIVE-CHECKLIST.md) §0).
> Unchecked boxes below are historical — they were done but not ticked during the deploy sprint. All
> _remaining_ work (test→live keys, provider approvals, data wipe, scaling) is tracked in
> `GO-LIVE-CHECKLIST.md`; work from that file, not this one.

Target stack: **Azure** (Container Apps API + Postgres + Blob, Canada Central) + **Cloudflare** (DNS, TLS,
Pages for the marketing site + `app.`, Workers for `go.` and `*.pplforms.com`). No edge VM; `api.pplcrm.com`
(the `pplcrm-api` Container App) is the only Azure compute.
Full rationale in `~/.claude/plans/deployment-plan-we-had-indexed-fox.md`. Work top to bottom.

Origins: `pplcrm.com` (marketing) · `app.pplcrm.com` (CRM) · `api.pplcrm.com` (backend) ·
`go.pplcrm.com` (companion) · `*.pplforms.com` (per-org public forms/events/donations).

---

## 0. Accounts & tooling

- [ ] Azure subscription with permission to create resources in **Canada Central**.
- [ ] Cloudflare account (Free is fine) managing DNS for `pplcrm.com` **and** `pplforms.com` (register `pplforms.com` if not owned).
- [x] `*.pplforms.com` origin — **DECIDED 2026-07-15: Cloudflare Worker** (`infra/pplforms-edge`, committed):
      serves the SPA as static assets + proxies `/api/*` same-origin (see §1).
- [x] `app.pplcrm.com` / `go.pplcrm.com` origin — **DECIDED 2026-07-15: fully serverless (Option B).** `app.` → a
      **Cloudflare Pages** project (static CRM SPA, `dist/apps/frontend`). `go.` → a **Cloudflare Worker** (companion
      SPA `dist/apps/companion` + `/api/*` proxy, templated off `infra/pplforms-edge`). **No VM, and the
      `pplcrm-edge` Caddy Container App is retired** — remove its `deploy.yml` step; `deploy/Caddyfile` +
      `Caddy.Dockerfile` become dead. Build tasks tracked in §1/§3/§5.
- [ ] GitHub repo admin (to set Actions secrets/variables and GHCR package visibility).
- [ ] Local tooling: `az` CLI, `docker`, `git`. (Decide: GitHub-runner deploy vs. hand-run.)
- [ ] Decide the companion subdomain name — plan uses `go.pplcrm.com` (rename in `environment.prod.ts` if different).

## 1. Domains & DNS (Cloudflare)

**Cloudflare Free is sufficient to launch.** The paid tiers (Pro/Business/Enterprise) sell security/perf
hardening (WAF, bot management, rate limiting, advanced DDoS, SLA) — nice later, not required. Free gives
DNS, Pages, Universal SSL, proxied CDN, and basic DDoS.

The single subdomains under the serverless edge (§0). Universal SSL covers them on Free. Several records are
created **when their target exists** (noted inline), so this section interleaves with §3 (backend) and §5
(Pages/Worker deploys) rather than being added all up-front:

- [ ] **SSL/TLS mode → Full (strict)** on **both** zones (`pplcrm.com` + `pplforms.com`). Can be set now. Only
      materially matters for `api.pplcrm.com` (validates the ACA managed cert); harmless for the Pages/Worker hosts,
      which have no external origin.
- [ ] `pplcrm.com` (apex + `www`) → **Cloudflare Pages** (marketing). Add from the marketing Pages project's
      **Custom domains** tab — it auto-creates the proxied records (do NOT hand-add). — §5.
- [ ] `app.pplcrm.com` → **Cloudflare Pages** (CRM SPA, a **second** Pages project serving `dist/apps/frontend`).
      Add `app.pplcrm.com` under that project's Custom domains tab (auto-creates the proxied CNAME). — §5.
- [ ] `go.pplcrm.com` → **Worker**. Add a **proxied** placeholder record (`AAAA go` → `100::`) so Cloudflare
      answers, then bind the `go` Worker to route `go.pplcrm.com/*`. — Worker built at §3, deployed at §5.
- [ ] `api.pplcrm.com` → **proxied** (orange) CNAME to the `pplcrm-api` Container App FQDN, **and** bind
      `api.pplcrm.com` as a custom domain on that Container App (managed cert). — once the app exists (§3).

**`*.pplforms.com` (per-org tenant subdomains).** (Facts re-verified 2026-07-15 against current Cloudflare/Azure
docs.) Cloudflare **proxies wildcard records on ALL plans** (since Sept 2021 — "Wildcard proxy for everyone"), and
Free's **Universal SSL already covers `*.pplforms.com`** (first-level wildcard) — no Advanced Certificate Manager
needed. Azure Container Apps custom domains are exact-hostname-only (no wildcard bindings), so wildcard traffic
can't land on the ACA edge directly — but that does **not** force a VM, because the API stays on `api.pplcrm.com`.
**DECIDED 2026-07-15 — Cloudflare Worker** (`infra/pplforms-edge`, committed): it serves the built Angular SPA as
static assets and reverse-proxies `/api/*` to `api.pplcrm.com` so every public call is **same-origin** — which is
why backend CORS stays locked to the CRM origin (do **not** widen it). No origin cert, no static IP, no NSG cron;
static requests + `/api/*` proxy invocations sit within Cloudflare's free tier. Everything stays on Cloudflare Free.

- [ ] `*.pplforms.com` → **proxied** (orange) placeholder wildcard record (`AAAA *` → `100::`, or `A *` →
      `192.0.2.1`) so Cloudflare answers for the subdomains and the Worker route (`*.pplforms.com/*`) fires.
- [ ] SSL/TLS mode **Full (strict)**; confirm Universal SSL lists `*.pplforms.com` under Edge Certificates.
- [ ] Deploy the Worker per `infra/pplforms-edge/README.md` (`nx build frontend` → `wrangler deploy`).
- [ ] Tenant resolves via the `?t=<org>` query the SPA appends from its own subdomain; the Host-based fallback
      needs `PUBLIC_BASE_DOMAIN=pplforms.com` (§4, now set in `deploy.yml`).

Not chosen (recorded so it isn't relitigated from stale facts):
**VM + Caddy** — an always-on box with a wildcard Origin CA cert, a static IP, and an NSG-lock-to-Cloudflare cron
is more machinery than serving a static SPA + one proxied path prefix warrants; superseded by the Worker.
**`pplcrm-edge` Container App** — an always-on min-1 replica bills ~US$10–15/mo for the same static-serving job;
not needed. **Azure Front Door** (Standard ~US$35/mo base + egress) supports wildcard managed certs (GA June 2025)
but layers a second CDN behind Cloudflare and needs Host-header surgery for ACA. Revisit only if the Worker's free
tier is outgrown.

## 2. Azure — data layer

- [ ] Create **Azure Database for PostgreSQL Flexible Server** in Canada Central; note host/port.
- [ ] Create the `pplcrm` database.
- [ ] Run `apps/backend/scripts/setup-db-roles.sql` **as a superuser**, substituting `:owner_pw`,
      `:app_pw`, `:current_owner` → creates `pplcrm_owner` (DDL/migrations) and `pplcrm_app` (runtime, RLS-bound).
- [ ] Confirm the runtime role is **`pplcrm_app`**, never the owner (RLS depends on it).
- [ ] Configure Postgres firewall/VNet so (a) the Container Apps env and (b) the migrate runner can reach it.
- [ ] Create the **Azure Blob** storage account + `uploads` container in Canada Central; grab the connection string.
- [ ] (Optional) tighten the Blob container CORS from the code's default `*`.

## 3. Azure — compute

- [ ] Register providers (fresh subscription): `az provider register --namespace Microsoft.App --wait`,
      `--namespace Microsoft.OperationalInsights --wait`, `--namespace Microsoft.Insights --wait`, and
      `--namespace Microsoft.AlertsManagement --wait` (the last two are needed by monitoring.bicep —
      availability tests/action groups/metric alerts fail with `MissingSubscriptionRegistration` without them).
- [ ] Create a **Container Apps environment** in Canada Central (hosts only `pplcrm-api`; the `*.pplforms.com` and
      `go.` edges are Cloudflare Workers, and `app.` is Cloudflare Pages — none of them run here).
- [ ] Grant pull access to **GHCR** for the backend image `ghcr.io/pplcrm-org/pplcrm/backend` (registry credential
      on the app, or make the GHCR package public).
- [ ] Create app **`pplcrm-api`** — **deferred to §5**: it needs the CI-built image _and_ the §4 env vars, so it's
      created there in one shot. Target config: ingress **external**, **targetPort 3000**, **min 1 / max 1** replica,
      liveness probe `GET /`, readiness probe `GET /healthz` (probes are YAML-only — exact patch in
      GO-LIVE-CHECKLIST §10; liveness must NOT hit `/healthz` or a DB outage restart-loops the app).
- [ ] Bind custom domain `api.pplcrm.com` (managed cert) + add the proxied `api.` CNAME (§1) — **after the app
      exists (§5)**.

Edge for `app.` / `go.` — **serverless (Option B, §0): NO VM.** `app.pplcrm.com` → a Cloudflare **Pages** project
serving `dist/apps/frontend`; `go.pplcrm.com` → a Cloudflare **Worker** (companion SPA + `/api/*` proxy). Both are
built/deployed in §5. The `pplcrm-edge` Caddy Container App is **retired** — don't create it, remove its `deploy.yml`
step; `deploy/Caddyfile` + `Caddy.Dockerfile` are dead and can be deleted.

## 4. Secrets & config

Set the backend env on `pplcrm-api` (from `.env.production.example`). Required first:

- [ ] `SHARED_SECRET` (generate, e.g. `openssl rand -base64 48`).
- [ ] `OAUTH_TOKEN_ENC_KEY` (generate — REQUIRED if any real mailbox is connected; else tokens store plaintext).
- [ ] DB: `DB_HOST`, `DB_PORT`, `DB_NAME=pplcrm`, `DB_USER=pplcrm_app`, `DB_PASSWORD`, `DB_SSL=true`.
- [ ] `DB_MIGRATION_USER=pplcrm_owner`, `DB_MIGRATION_PASSWORD` (used only by the migrate step).
- [ ] Origins: `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=3000`, `API_URL=https://api.pplcrm.com`,
      `APP_URL=https://app.pplcrm.com`, `TRUST_PROXY=1`. (`PUBLIC_BASE_DOMAIN=pplforms.com` and
      `COMPANION_URL=https://go.pplcrm.com` are now set on `pplcrm-api` by `deploy.yml` via
      `--set-env-vars` — no separate manual step.)
- [ ] `MIGRATE_ON_BOOT=false`.
- [ ] Blob: `AZURE_STORAGE_CONNECTION_STRING`, `AZURE_STORAGE_CONTAINER=uploads`.
- [ ] **Confirm `ALLOW_MOCK_PAYMENTS` is NOT set** anywhere (would accept forged payments).
- [ ] Integration keys (mock silently if unset): Stripe (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
      `STRIPE_PLAN_GRASSROOTS_PRICE_ID`, `STRIPE_PLAN_MOVEMENT_PRICE_ID`), Postmark
      (`POSTMARK_SERVER_TOKEN`, `POSTMARK_FROM_EMAIL`, `POSTMARK_WEBHOOK_TOKEN`), SendGrid
      (`SENDGRID_API_KEY`, `SENDGRID_WEBHOOK_VERIFICATION_KEY`, `SENDGRID_FREE_TIER_SUBUSER`,
      `SENDGRID_SHARED_SENDING_DOMAIN` — see "Platform sending domain" below), Twilio
      (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`), Google (`GOOGLE_MAPS_API_KEY`,
      `GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_REDIRECT_URI=https://api.pplcrm.com/auth/google/callback`),
      Microsoft (`MS_CLIENT_ID/SECRET`, `MS_TENANT_ID`, `MS_REDIRECT_URI=https://api.pplcrm.com/auth/ms/callback`).

### Platform sending domain (`send.pplcrm.com`)

What a tenant sends from when it has no domain of its own to authenticate. Without it, anyone
whose only address is a Gmail or Outlook account cannot send at all: you cannot DKIM-sign as
`gmail.com`, so DMARC alignment fails and mailbox providers filter or reject the mail.

**It must be a domain of its own, never `pplcrm.com`.** Reputation at Gmail and Yahoo attaches to
the From domain and the DKIM `d=` domain regardless of which ESP's IPs carried the message, so
sharing a domain with Postmark's transactional mail would let one tenant's spam complaints degrade
delivery of password resets and email verification. The backend refuses to enable the feature (and
logs an error) if `SENDGRID_SHARED_SENDING_DOMAIN` matches the domain in `POSTMARK_FROM_EMAIL`.

- [ ] In SendGrid → Sender Authentication, **authenticate `send.pplcrm.com` as a new domain**
      (automated security on). This is separate from the existing `pplcrm.com` authentication —
      which appears in the list under its generated return-path subdomain (`em####.pplcrm.com`) and
      must be left alone for transactional mail. The new one appears the same way
      (`em####.send.pplcrm.com`); the DKIM signing domain is `send.pplcrm.com`.
- [ ] Add the three generated CNAMEs to Cloudflare DNS, **Proxy status: DNS only**. Proxying breaks
      them. Then verify in SendGrid.
- [ ] **Associate the domain authentication with `SENDGRID_FREE_TIER_SUBUSER`.** Parent-level
      authentication does NOT sign mail sent `on-behalf-of` a subuser (see the comment on
      `resolveWhitelabelCredentials` — "subuser sends stay unsigned"), and free-plan newsletters go
      out through that subuser. Skipping this breaks DKIM alignment for exactly the tenants the
      shared domain exists to serve, while paid tenants on the parent key look fine.
      API: `POST /v3/whitelabel/domains/{id}/subuser`.
- [ ] Add a DMARC TXT record at `_dmarc.send.pplcrm.com`. Start at `p=none` with a `rua=` address,
      then tighten to `p=quarantine`/`p=reject` once reports are clean. This is a second DMARC
      record alongside `_dmarc.pplcrm.com`, which is correct: they are different names, and the
      explicit subdomain record is what lets the two domains carry independent policies. (Two
      records at the SAME name is the broken case — receivers discard the policy entirely.)
- [ ] If `rua=` points at a mailbox on a different domain than the record's own (e.g.
      `_dmarc.send.pplcrm.com` reporting to `hello@pplcrm.com`), publish the external-destination
      authorization so stricter receivers still send reports:
      `send.pplcrm.com._report._dmarc.pplcrm.com  TXT  "v=DMARC1"`.
- [ ] Set `SENDGRID_SHARED_SENDING_DOMAIN=send.pplcrm.com` on `pplcrm-api`.
- [ ] Send one real newsletter **from a FREE-plan tenant** (the subuser path — a paid tenant will
      not exercise it) and confirm `d=send.pplcrm.com` in the received headers, plus the
      `List-Unsubscribe` check in `docs/deliverability-w1-list-unsubscribe.md`.
- [ ] **Update the website copy in the same change as the env var.** While the feature is off the
      site's "sent from your own verified domain" wording is still true; switching it on is what
      makes that wording wrong. The pages are listed in the `pplcrm-website-claims` skill under
      "Platform sending domain" (EULA §8, security page, privacy subprocessors, the FAQ's "Why do
      I verify a domain before sending?"), and the legal documents need their `updated:` dates
      bumped.

GitHub Actions (for the CI pipeline in `.github/workflows/deploy.yml`):

- [ ] Secrets: `VITE_GOOGLE_MAPS_API_KEY`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_MIGRATION_USER`,
      `DB_MIGRATION_PASSWORD`, `SHARED_SECRET`, `AZURE_CREDENTIALS`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- [ ] Variables: `AZURE_RESOURCE_GROUP=pplcrm-cad-prod`, `AZURE_API_APP=pplcrm-api`, `CF_PAGES_PROJECT`
      (add `AZURE_EDGE_APP`/`AZURE_EDGE_VM` only if you keep an `app.`/`go.` edge runtime — §0).
- [ ] Add a **Worker deploy step** to `.github/workflows/deploy.yml` for `infra/pplforms-edge`
      (`wrangler deploy`, reusing `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`). The workflow currently still runs
      `az containerapp update` on a `pplcrm-edge` Container App — reconcile that with the §0 `app.`/`go.` decision
      (drop it if they move off ACA, or repoint it).
- [ ] Ensure the **migrate job's runner can reach Postgres** (public endpoint + firewall allow, or self-hosted runner in the VNet).
- [ ] `VITE_GOOGLE_MAPS_API_KEY` restricted by HTTP referrer at Google (it ships to the browser).

## 5. First deploy

- [ ] Create the Cloudflare **Pages** project for the marketing site (`CF_PAGES_PROJECT`), custom domain `pplcrm.com`.
- [ ] Push `feat/production-deployment` and open/merge the PR (workflow triggers on `main`), **or** run each step by hand:
  - [ ] `npx nx run-many -t build -p backend frontend companion website --configuration=production` (with `VITE_GOOGLE_MAPS_API_KEY`).
  - [ ] Build & push images: `apps/backend/Dockerfile` → GHCR `backend` (and `deploy/Caddy.Dockerfile` → GHCR
        `edge` **only if** you keep an `app.`/`go.` VM — §0).
  - [ ] **Migrate** as owner: `npx tsx apps/backend/src/app/kyselyinit.ts` with `DB_MIGRATION_*` env (from repo root).
  - [ ] `az containerapp update` `pplcrm-api` to the new image tag; `app.`/`go.` edge (if kept):
        `az vm run-command invoke` (docker pull + restart) — §0.
  - [ ] `wrangler pages deploy dist/apps/website --project-name=<CF_PAGES_PROJECT>`.
  - [ ] Deploy the forms Worker: from `infra/pplforms-edge`, `wrangler deploy` (serves `*.pplforms.com`; see its README).

## 6. Register with third-party providers (first launch)

All webhook/redirect URLs are on **`api.pplcrm.com`**:

- [ ] Stripe billing webhook → `POST /api/billing/webhook` (secret = `STRIPE_WEBHOOK_SECRET`).
- [ ] Stripe donations **Connect** webhook → `POST /api/donations/webhook` (one platform endpoint, no
      per-tenant token; secret = `STRIPE_CONNECT_WEBHOOK_SECRET`) — see "Stripe Connect (donations)".
- [ ] Postmark bounce/complaint webhook → `POST /api/postmark/webhook` (header `X-Postmark-Webhook-Token`).
- [ ] SendGrid signed-event webhook → `POST /api/newsletters/webhook`.
- [ ] Google OAuth: add redirect `https://api.pplcrm.com/auth/google/callback` in Google Cloud console.
- [ ] Microsoft OAuth: add redirect `https://api.pplcrm.com/auth/ms/callback` in the Azure app registration.
- [ ] Verify sending domains (SPF/DKIM) in Postmark + SendGrid for your from-addresses.

### Stripe Tax (platform billing — Dashboard setup, no env vars)

Subscription Checkout is created with `automatic_tax` enabled; until Tax is configured in the
Dashboard, **live checkout-session creation fails**. One-time setup in the platform Stripe account
(test mode and live mode separately):

- [ ] Enable Stripe Tax (Dashboard → Settings → Tax) and set the **origin/head-office address**.
- [ ] Set the **preset product tax code** to the SaaS (business-use) code and **default tax
      behavior = exclusive** (tax is added on top of listed plan prices — decided 2026-07-16).
- [ ] Set `tax_behavior = exclusive` on both live plan Prices (`STRIPE_PLAN_GRASSROOTS_PRICE_ID`,
      `STRIPE_PLAN_MOVEMENT_PRICE_ID`).
- [ ] Add **tax registrations** for every jurisdiction where we're registered to collect.
      Everywhere else Stripe calculates zero tax and charges no Tax fee — that is correct behavior,
      not a bug.
- [ ] Billing Portal configuration: allow customers to **update billing address** (keeps the
      renewal-invoice tax location current) — Settings → Billing → Customer portal.
- [ ] Ongoing (operations, not launch): watch Dashboard → Tax → **Thresholds** and add
      registrations as economic-nexus thresholds are crossed.
- [ ] Donations are intentionally **excluded** from Stripe Tax — the campaign is merchant of
      record there. Do not enable tax on the donations path.

### Stripe Connect (donations — Dashboard setup)

Donations run as **Connect direct charges** on each tenant's connected account (Express dashboard,
Stripe-owned losses, campaign pays Stripe's processing fees; platform takes
`DONATIONS_PLATFORM_FEE_PERCENT` = 1%). One-time setup in the platform Stripe account (test and
live separately):

- [ ] Enable Connect and **complete the platform profile** (Dashboard → Connect → Settings).
- [ ] Set Connect **branding** (name, icon, colors) — it appears in tenants' hosted onboarding and
      their Express dashboard.
- [ ] Create a webhook endpoint with **"Listen to events on Connected accounts"** at
      `https://api.pplcrm.com/api/donations/webhook`, subscribed to: `checkout.session.completed`,
      `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.updated`,
      `customer.subscription.deleted`, `charge.refunded`, `charge.dispute.created`,
      `charge.dispute.closed`, `account.updated`. Its signing secret is
      `STRIPE_CONNECT_WEBHOOK_SECRET` (distinct from the billing endpoint's `STRIPE_WEBHOOK_SECRET`).
- [ ] Cost note: Express-dashboard connected accounts carry Stripe's per-**monthly-active**-account
      fee (~US$2) — priced into the Express choice (decided 2026-07-16).
- [ ] Tenants onboard **in-app** (Workspace → Donations → "Connect with Stripe"); nothing to do per
      tenant in the platform Dashboard.

## 7. App-level / per-tenant config

- [ ] Decide & document the **data-residency** posture (Canada-only v1 recommended; donations are
      Stripe-only and Stripe stores payment data in the US — disclosed in the privacy policy).
- [ ] Per-tenant donation setup happens in-app: Stripe Connect onboarding (no keys); plus
      `donations.residency_acknowledged` (donations are **fail-closed** until acknowledged).
- [ ] Per-tenant sending: `communications.sendgrid_api_key` + verified domains (in-app).

## 8. Verification (smoke test after deploy)

- [ ] `curl https://api.pplcrm.com/healthz` → 200 `{status:"ok"}` (DB reachable); `GET /` → 200. (CI now
      runs this automatically after every backend deploy — the "Smoke test backend /healthz" step in
      `deploy.yml` fails the workflow if the new revision doesn't answer.)
- [ ] `curl https://api.pplcrm.com/healthz/worker` → 200 `{status:"ok"}` once the ops watchdog has run
      (≤5 min after boot); 503 `{status:"stale"}` means the in-process job worker isn't beating.
- [ ] `https://app.pplcrm.com` loads; sign up a throwaway tenant; verify email actually arrives (Postmark).
- [ ] Cross-origin works: CRM (app.) reaches tRPC (api.) — you're logged in and data loads.
- [ ] `https://<org>.pplforms.com/f/<slug>` loads a public form; submit it (confirms wildcard DNS/TLS + `?t=` tenant resolution).
- [ ] `https://go.pplcrm.com/t/<token>` (or `/r/<token>`) loads with no asset 404s.
- [ ] `https://<org>.pplforms.com/d/<slug>` renders donation checkout (the Worker rewrites `/d/*` → the backend's
      `/api/forms/d/*` and injects `?t=<org>`); unacknowledged-residency tenant is blocked (**403**).
- [ ] A map view shows real tiles (not grey) — confirms `VITE_GOOGLE_MAPS_API_KEY`.
- [ ] Fire a Stripe test event + a Postmark test bounce → rows land in `webhook_events` / `email_suppressions` and drain.
- [ ] `https://pplcrm.com` loads; "Log in" deep-links to `https://app.pplcrm.com/signin`; `/api/geo-rates` returns a region.
- [ ] Logs are production JSON (not pino-pretty); `NODE_ENV=production`.

## 9. Post-launch / operations

- [ ] Confirm the in-process worker/cron is running (background jobs draining; no stuck `background_jobs`).
- [x] Set up alerting on `/healthz` failures, Container App restarts, and DB connection saturation
      (keep `DB_POOL_MAX` under Postgres `max_connections`). **Done in bicep, deployed by CI** —
      `infra/azure/monitoring.bicep` provisions App Insights availability tests (api/app/go/forms +
      optional `/healthz/worker`), an action group (Azure app push + email to `opsAlertEmail`), and
      metric alerts (Container App restarts/replicas, Postgres cpu/storage/connections). The
      `deploy-infra.yml` workflow deploys it on any change under `infra/azure/` monitoring files
      (or via workflow_dispatch) — no secrets needed; see `infra/azure/README.md`. Test with the
      action group's "Test action group" button.
- [ ] Verify DB backups / point-in-time restore are enabled on the Flexible Server.
- [ ] Establish the migration workflow going forward: **new timestamped migration files only**, never edit applied ones.
- [ ] Plan secret rotation (`SHARED_SECRET`, `OAUTH_TOKEN_ENC_KEY` — rotating the latter forces mailbox re-consent).
- [ ] Decide scale-out policy (safe via `SELECT … FOR UPDATE SKIP LOCKED`, but start at 1 replica).
