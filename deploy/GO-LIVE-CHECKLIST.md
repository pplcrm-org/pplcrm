# Go-Live Checklist (test/pipeline mode → real production)

**For the next agent.** The app is fully deployed and running in **test/pipeline mode** as of 2026-07-17.
Everything below is what to flip, verify, or harden when the owner is ready to accept real users, real
money, and real email/SMS. Nothing here is a code change unless noted — it's config, external-account
approvals, and secret swaps.

Companion docs: initial bring-up is in [`PROD-CHECKLIST.md`](./PROD-CHECKLIST.md); the hard-won
infra/deploy gotchas are in the memory file `cloudflare-edge-deploy-gotchas.md` (read it before touching
Cloudflare, wrangler, or the maps-key build).

---

## 0. Current production topology (what's already live)

| Surface                         | Platform                 | Name / notes                                                               |
| ------------------------------- | ------------------------ | -------------------------------------------------------------------------- |
| `pplcrm.com` (marketing)        | Cloudflare Pages         | project `pplcrm-website`, prod branch `main`                               |
| `app.pplcrm.com` (CRM SPA)      | Cloudflare Pages         | project `pplcrm-app`, prod branch `main`                                   |
| `api.pplcrm.com` (backend)      | Azure Container App      | `pplcrm-api` in RG `pplcrm-cad-prod`, env `pplcrm-env`, **Canada Central** |
| `go.pplcrm.com` (companion)     | Cloudflare Worker        | `go-edge` (infra/go-edge), route `go.pplcrm.com/*`                         |
| `*.pplforms.com` (public forms) | Cloudflare Worker        | `pplforms-edge` (infra/pplforms-edge), route `*.pplforms.com/*`            |
| Postgres                        | Azure PG Flexible Server | `pplcrm-pg`, **Burstable B1ms** (tiny — see §10)                           |
| Object storage                  | Azure Blob               | account `pplcrmcadstorage`, container `uploads`                            |
| Cloudflare account              | —                        | `dc5af929b1d37f58e401ddb0c5c7e85b` (owns both zones + all Workers/Pages)   |

**CI/CD:** `.github/workflows/deploy.yml`. Every push to `main` runs: build 4 apps → backend image to
GHCR (`ghcr.io/pplcrm-org/pplcrm/backend`, **private**, pulled via PAT registry secret) → `az containerapp
update` → deploy 2 Pages + 2 Workers. It is green and hands-off.

**Backend runs one process** that also runs the in-process job worker + cron (transactional outbox in
`background_jobs`). Scale is currently **min 1 / max 1**, 0.5 CPU / 1 GiB.

---

## 1. How to change backend config in production

The Container App stores every `.env.production` line as a **Container App secret** (kebab-cased:
`STRIPE_SECRET_KEY` → secret `stripe-secret-key`) and each env var references it via `secretref`.

**To swap a value (e.g. test→live Stripe key):**

```bash
az containerapp secret set -n pplcrm-api -g pplcrm-cad-prod \
  --secrets stripe-secret-key="sk_live_..."
# then restart so the running revision picks it up:
az containerapp revision restart -n pplcrm-api -g pplcrm-cad-prod \
  --revision "$(az containerapp show -n pplcrm-api -g pplcrm-cad-prod --query properties.latestRevisionName -o tsv)"
```

Keep the local `.env.production` (gitignored) in sync so a future re-provision matches. **Gotcha:** values
containing `#` must be quoted in `.env.production` (Node `--env-file` truncates at `#`; the DB passwords are
already quoted). See the memory file.

**`ALLOW_MOCK_PAYMENTS` must remain ABSENT** in production — it would let forged payment data through.

**`VITE_GOOGLE_MAPS_API_KEY` is NOT a backend secret** — it's a **GitHub Actions secret** baked into the
frontend bundle at build (placeholder + inject step in `deploy.yml`). To change it:
`gh secret set VITE_GOOGLE_MAPS_API_KEY -R pplcrm-org/pplcrm` then re-run the pipeline (a rebuild is required;
there is no live env var to flip).

---

## 2. Payments — Stripe (test → live)

Currently on **test** keys (`sk_test_...`), so upgrades run against Stripe test mode. (Re-verified
2026-07-21: `stripe-secret-key` is still `sk_test_…`.)

- [ ] Swap to **live** secrets: `stripe-secret-key` → `sk_live_...`, and the **live** price IDs
      `stripe-plan-grassroots-price-id` / `stripe-plan-movement-price-id` (the live IDs are noted in
      `.env.production` comments — verify they still exist in the live dashboard).
- [ ] **Stripe Tax needs a head-office/origin address** on the **live** account
      (dashboard → Settings → Tax). Without it, `checkout.sessions.create` 500s — this exact error hit us in
      test mode. (Billing uses automatic tax; see the `stripe-tax-and-connect-decisions` memory.)
- [ ] Register **live** webhooks (see §7) and update `stripe-webhook-secret` +
      `stripe-connect-webhook-secret` with the live signing secrets.
- [ ] **Donations are Stripe Connect** (Express, platform fee) — confirm the Connect platform is enabled on
      the live account and the Connect webhook is live. Per-tenant donation keys are entered in-app (encrypted
      in `settings`), NOT here. Donations stay **fail-closed** until a tenant sets
      `donations.residency_acknowledged`.

## 3. Email — Postmark (transactional: verification, resets, invites)

Currently the Postmark account is **pending approval** → it can ONLY send to `@pplcrm.com` recipients.
This is why signup verification email to a gmail address failed in the smoke test (not a bug).

- [x] **Request Postmark account approval** — **approved 2026-07-21.**
- [x] **Verify the `pplcrm.com` sender signature / domain** — **done 2026-07-21.** Return-Path CNAME +
      DKIM live; proven end-to-end by a live API send to an external gmail address (ErrorCode 0,
      MessageID `71935ffd-bbdd-4782-8a7d-c721e1c5491e`).
- [ ] Register the bounce/complaint webhook (§7).
- [ ] Re-test: sign up a real external address → verification email arrives. _(External delivery via the
      Postmark API already verified 2026-07-21; the full signup-flow test is part of §11.)_

> During testing we manually set `authusers.verified = true` for the test owner (user id 1) to bypass the
> email gate. Real users self-verify once Postmark works — don't ship that manual step.

## 4. Email — SendGrid (newsletters / bulk)

Key is present but the feature was **deferred** (mock mode).

- [ ] Confirm `sendgrid-api-key` is a **live** key with the right scopes.
- [x] Complete **domain authentication** (sender identity) for `pplcrm.com` in SendGrid — **confirmed
      Verified in the dashboard 2026-07-21** (DKIM CNAMEs `s1`/`s2._domainkey` live in DNS).
- [ ] Set up the **free-tier subuser** if using it to isolate free-plan sending reputation
      (`sendgrid-free-tier-subuser` is currently empty).
- [ ] Register the newsletter signed-event webhook (§7).
- Note the anti-abuse layer (send caps, warm-up, bounce tripwires) in the `pplcrm-sending-guards` skill —
  review thresholds before opening bulk send to real tenants.

## 5. SMS — Twilio (companion volunteer verification codes)

Creds present but **deferred** (mock). The companion access flow (SMS verify code) won't send real texts
until this is live.

- [x] Confirm `twilio-account-sid` / `twilio-auth-token` are live and the account is funded — **verified
      2026-07-21** (creds authenticate against the Twilio API).
- [x] `twilio-from-number` is a real, SMS-capable number — **verified owned via the Twilio API
      2026-07-21**, and the secret was fixed to E.164 (`2892789936` → `+12892789936`, revision
      restarted; local `.env.production` synced).
- [ ] Test the companion `/t/:token` or `/r/:token` verify flow end-to-end (see `pplcrm-companion-access`).

## 6. Google & Microsoft

**Google Maps (two separate keys — keep them separate):**

- [ ] **Browser key** (`VITE_GOOGLE_MAPS_API_KEY`, GitHub secret): restricted to **HTTP referrers**
      (`app.pplcrm.com/*`, `go.pplcrm.com/*`, `*.pplforms.com/*`, and localhost for dev), APIs limited to
      **Maps JavaScript API + Places API**. `ApiTargetBlockedMapError` = key not allowed for those APIs.
- [ ] **Server key** (`google-maps-api-key`): **NO referrer restriction** (server sends no Referer — would
      break geocoding); restrict by IP and to **Geocoding API**.
- [ ] Ensure **billing is enabled** on the Google Cloud project and quotas fit expected traffic.

**Google OAuth (Gmail sync):**

- [ ] The OAuth **consent screen must be Published / verified** (out of "Testing" mode) or only test users
      can connect a mailbox. May require Google app verification for restricted Gmail scopes.
- [ ] `google-redirect-uri` = `https://api.pplcrm.com/auth/google/callback` must match the console exactly.

**Microsoft Graph OAuth (Outlook mailbox sync):**

- [ ] Azure app registration: `ms-redirect-uri` = `https://api.pplcrm.com/auth/ms/callback` must match.
- [ ] Publisher verification / admin-consent as needed for multi-tenant (`ms-tenant-id=common`).

## 7. Webhooks to register (all point at `api.pplcrm.com`)

Verify each is registered in the respective **live** dashboard and its signing secret matches the backend:

| Provider                    | URL                                              | Backend secret                      |
| --------------------------- | ------------------------------------------------ | ----------------------------------- |
| Postmark (bounce/complaint) | `https://api.pplcrm.com/api/postmark/webhook`    | `postmark-webhook-token`            |
| Stripe (billing)            | `https://api.pplcrm.com/api/billing/webhook`     | `stripe-webhook-secret`             |
| Stripe Connect (donations)  | `https://api.pplcrm.com/api/donations/webhook`   | `stripe-connect-webhook-secret`     |
| SendGrid (newsletters)      | `https://api.pplcrm.com/api/newsletters/webhook` | `sendgrid-webhook-verification-key` |

## 8. Data hygiene before real launch

- [ ] Decide whether to **wipe test data**. There's a test owner account (user id 1, tenant 1, manually
      verified — re-point it to `hello@pplcrm.com` if kept) plus any test forms/donations/jobs created
      during the smoke test. The DB has no
      real users yet, so a clean reset is cheap and avoids test artifacts in production.
      _Snapshot 2026-07-21: 2 tenants, 8 authusers, 121 persons, 20 form_submissions, 30 donations._
- [x] Clear failed `background_jobs` rows — **done 2026-07-21** (38 exhausted test-period rows deleted;
      remaining rows are `completed` + future-`run_at` scheduled work, not stuck). Other test data kept
      for now per owner decision — the wipe question above stays open until real launch.
- [ ] **Migrations become forward-only once there's real data.** The current baseline was pre-ship
      re-squashed; after go-live, never delete/regenerate applied migrations — new change = new dated file
      (see `pplcrm-migrations`).

## 9. Runtime env sanity (verified correct 2026-07-21 ✓)

Re-verified against the live Container App: all expected env vars present (incl. `SENTRY_DSN`,
`OPS_ALERT_EMAIL`), **`ALLOW_MOCK_PAYMENTS` is absent**, `/healthz` 200, `/healthz/worker` 200.

- `NODE_ENV=production`, `MIGRATE_ON_BOOT=false` (migrations run manually, see below).
- `API_URL=https://api.pplcrm.com`, `APP_URL=https://app.pplcrm.com`, `PUBLIC_BASE_DOMAIN=pplforms.com`, `COMPANION_URL=https://go.pplcrm.com` (set by `deploy.yml`; volunteer link emails/texts point here).
- **CORS stays locked to `APP_URL`** — do NOT widen it to `*.pplforms.com`. The public surfaces are
  same-origin by design (the Workers proxy `/api`), so CORS never needs to open up. Widening it is a
  security regression.
- Migrations: **CI runs them** — the `migrate` job in `deploy.yml` (added 2026-07-23 after an outage
  where code shipped ahead of schema) applies pending migrations as the owner role (`PROD_DB_*`
  secrets) before the backend rolls; a migration failure blocks the deploy. The runner reaches
  Postgres via the `AllowAzureServices` firewall rule (GitHub-hosted runners are Azure IPs).
  Manual fallback: `node --env-file=.env.production --import tsx apps/backend/src/app/kyselyinit.ts`
  from an IP allow-listed on the Postgres firewall, using the quoted owner creds.
  **Firewall gotchas:** the owner's egress IP rotates (CGNAT/Starlink) — allow-list rules are /24s,
  not single IPs (`AllowAdminClient` = `153.67.41.0/24`, old ISP; `AllowAdminClientStarlink` =
  `129.222.193.0/24`, added 2026-07-23). If a manual connection ETIMEDOUTs, check
  `curl https://api.ipify.org` against the rules and widen/add accordingly.

## 10. Scaling & hardening for real traffic (currently sized for a pipeline test)

- [ ] **Postgres is Burstable B1ms** — fine for testing, undersized for production. Scale up (General
      Purpose) before real load; watch connections vs `db-pool-max` (20).
- [ ] **Container App is min 1 / max 1.** Bump `--max-replicas` for load. Scaling out is safe (the job queue
      uses `SELECT ... FOR UPDATE SKIP LOCKED`), but cron/worker run in-process on every replica — confirm no
      double-scheduling before going wide.
- [x] Add HTTP **health probes** via a YAML patch — **applied 2026-07-21** (revision
      `pplcrm-api--0000029`). Container Apps ignores the Docker HEALTHCHECK and `az containerapp
update` has no probe flags, so YAML is the only path. Liveness must stay on `GET /`
      (process-only) — pointing liveness at `/healthz` would restart-loop the app during a DB
      outage; readiness on `GET /healthz` correctly pulls it from ingress instead. For reference
      (probes survive image deploys; this only ever needs re-doing on an app re-create):

                      ```bash
                      az containerapp show -n pplcrm-api -g pplcrm-cad-prod -o yaml > /tmp/pplcrm-api.yaml
                      # edit: under properties.template.containers[0] add
                      #   probes:
                      #   - type: Startup
                      #     httpGet: { path: /, port: 3000 }
                      #     periodSeconds: 5
                      #     failureThreshold: 30
                      #   - type: Liveness
                      #     httpGet: { path: /, port: 3000 }
                      #     periodSeconds: 30
                      #     failureThreshold: 3
                      #   - type: Readiness
                      #     httpGet: { path: /healthz, port: 3000 }
                      #     periodSeconds: 30
                      #     failureThreshold: 3
                      az containerapp update -n pplcrm-api -g pplcrm-cad-prod --yaml /tmp/pplcrm-api.yaml
                      ```

                      One-time op — later `az containerapp update --image` deploys don't touch probes.

- [x] Review backups/retention on Postgres and Blob; confirm they match the retention windows the marketing
      site claims (see `pplcrm-website-claims`). **Verified 2026-07-21:** PG Flexible Server = 7-day
      retention, Canada Central, geo-redundant backup disabled — matches the site's "retained for 7 days
      in Canada" claim exactly. Blob soft-delete is **off** (site makes no blob-backup claim; deleted
      blobs vanish immediately, which is consistent with — stronger than — the deletion promise).
- [ ] Consider putting `api.pplcrm.com` behind the Cloudflare proxy (currently DNS-only/grey for the managed
      cert). Optional.

## 11. Final go-live smoke test (against live keys)

1. Sign up a **real external** email → verification email arrives (Postmark live) → verify → log in.
2. Upgrade to a paid plan → **live** Stripe checkout → webhook flips the plan → publish a form.
3. Submit a form at `<org>.pplforms.com/f/:slug`; make a test donation at `<org>.pplforms.com/d/:slug`.
4. Companion: open a `/t/:token` link, get the **real** SMS code (Twilio live), verify.
5. Connect a Gmail and an Outlook mailbox (OAuth consent works for non-test users).
6. Confirm no secrets/log spam in the browser console; maps render.

## 12. Multi-region (deferred, not designed)

US/EU expansion: the Azure infra is parameterized Bicep (`infra/azure/`), but **multi-region tenant routing
is undesigned**. Don't attempt a second region without a routing design first. Data residency strategy is in
the `donations-residency-strategy` memory.

---

### Quick reference — the latent bugs already fixed this cycle (don't reintroduce)

- esbuild prod build must keep deps **external** + `jsdom`/`dompurify` are **runtime** deps.
- `wrangler.toml` `routes` must be **top-level** (before any `[table]`) or it becomes a phantom `vars.routes`.
- The frontend `_redirects` must NOT be in the bundle a Worker serves (Pages-only; injected in CI).
- `import.meta.env` is Vite-only — the maps key is baked via esbuild `define` + CI placeholder substitution.
- The CI Cloudflare token needs **Zone · Workers Routes · Edit** (all zones).
