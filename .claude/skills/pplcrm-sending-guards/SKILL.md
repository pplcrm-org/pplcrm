---
name: pplcrm-sending-guards
description: "The anti-abuse layer around outbound email and plan enforcement: the pre-send gates in send-guards.ts (verified domain, free-tier phone verification, 7-day warm-up cap), the newsletter preflight content gate (deliverability score 0-100, blocked band refuses the send; preflight.service.ts + libs/common preflight-lint + Claude AI review), the bounce/complaint tripwires that pause or suspend a tenant, the per-tenant hourly send cap in the outbox worker, the FEATURE_MATRIX plan gate (plan-gate.ts + GATED_FEATURES), the disposable-email signup block, the free-tier SendGrid subuser, and the Postmark bounce webhook. USE WHEN a send is blocked/paused/suspended, a 'Deliverability score N' error blocks a send, a tenant hit 'requires the Grassroots plan', changing plan feature gates or send caps/tripwire/preflight thresholds, adding a plan-gated module, un-pausing a tenant, or touching newsletter_send_log / newsletter_content_checks / tenants.sending_paused_at / phone verification. EXAMPLES: 'why can't this free tenant send', 'resume sending for tenant X', 'gate the new module to Movement', 'change the warm-up cap', 'why is this newsletter blocked at score 42'."
---

# Sending guards & plan enforcement (anti-abuse layer)

Added 2026-07-14 to stop free-tier signups being used for spam. Two subsystems: **send guards**
(newsletter sending) and **plan gates** (FEATURE_MATRIX enforcement).

## Send guards — `apps/backend/src/app/modules/newsletters/send-guards.ts`

All constants (caps, rates, messages) live at the top of that file. Enforcement points:

1. **Pre-send** — `assertTenantMaySendNewsletter(db, tenantId, plannedRecipients)` in
   `NewslettersController.sendNewsletter`. Checks, in order:
   - `tenants.suspended_at` set → FORBIDDEN (suspended accounts also can't sign in — auth checks
     the same column).
   - `tenants.sending_paused_at` set → FORBIDDEN (tripwire pause).
   - No DKIM-verified sending domain → PRECONDITION_FAILED. "Verified" = the
     `communications.default_from_email` setting's domain appears in the
     `communications.verified_domains` setting with `status: 'verified'` (the Settings → Domains
     whitelabel flow writes that). Domain verification is available on EVERY plan including
     Free — it's what keeps free-tier mail out of spam, and it's deliberately NOT plan-gated.
     Credential resolution (`settings/controller.ts` `resolveWhitelabelCredentials`) mirrors the
     send path: a tenant-owned SendGrid key wins; otherwise the domain auth + link branding are
     created on the PLATFORM key at the parent level and associated (SendGrid
     `/whitelabel/{domains,links}/{id}/subuser`) with the subuser the tenant sends through (their
     whitelabel subuser, or `SENDGRID_FREE_TIER_SUBUSER` on Free). In platform-key mode a domain
     will not reach `status: 'verified'` until that association succeeds (retried on every verify
     click, tracked as `subuserAssociated` on the entry) — perfect DNS with a failed association
     would still send unsigned mail. **Link branding is also required** for verified status
     (`isVerified = spf && dkim && linkBranded && subuserOk`), because click tracking is on
     unconditionally (`newsletter-mail.service.ts`) — an unbranded domain ships `sendgrid.net`
     links on a shared, blocklist-exposed click domain. Its label is caller-chosen
     (`linkSubdomain` on the entry, `DEFAULT_LINK_SUBDOMAIN = 'email'` from `libs/common/dns-label.ts`)
     because `email.<domain>` is often already in use; `settings.setLinkSubdomain` moves it after
     the fact by recreating only the link branding, leaving a validated DKIM setup intact. Before
     2026-07-26 the label was hardcoded and a collision locked that tenant out of sending with no
     workaround. What stays paid-only is unrelated to this: custom WEB
     domains (serving pages on the org's own domain instead of `*.pplforms.com`) — not
     implemented yet, and not part of the Domains settings flow.
   - `tenants.sending_phone_verified_at` null → PRECONDITION_FAILED, on **every plan**
     (`phoneVerificationRequired()` returns true unconditionally since 2026-07-25 — a shared
     platform sending domain means one abusive workspace hurts all of them, so paying is not the
     barrier). Phone verification lives in `settings/controller.ts` (`requestPhoneVerification` /
     `confirmPhoneVerification`, Twilio SMS via `lib/sms`, code hash stored on the tenant row —
     deliberately NOT in settings, whose snapshot is client-readable). Requesting a code needs a
     settled plan, not demo removal (see the demo/plan gate section below). UI: Workspace →
     Communications → "Sending phone verification", and step 3 of the go-live wizard.
   - Free plan and tenant younger than 7 days → warm-up cap: ≤100 emails per rolling 24h
     (`warmupDailyCap`, summed from `newsletter_send_log`).
   - Monthly plan email allowance exceeded → TOO_MANY_REQUESTS with the exact numbers and reset
     date. The allowance is `monthlyEmailCap(plan, tenants.subscription_quantity)` =
     `emailsPerSubscriber` × the billed bracket's subscriber cap (2× Free, 8× Grassroots,
     12× Movement; enterprise uncapped), metered from `newsletter_send_log` over `sendWindow()` —
     the billing cycle stepped monthly back from `subscription_ends_at` (so annual still resets
     monthly), or the UTC calendar month for free tenants. This is the plan meter (added
     2026-07-18): sending N emails requires being billed like an N-sized audience, which closes
     the "buy the lowest bracket, import a huge list, blast, cancel" hole. It works because
     upward bracket syncs are invoiced prorated IMMEDIATELY on both intervals
     (`subscription-sync.ts` `always_invoice`), so `subscription_quantity` is always paid-for.
     The composer surfaces it (newsletters.sendQuota query → "Monthly allowance" row + warning
     on Review & send; shortfall disables "Send now" but not scheduling).
   - Paid plan and `subscription_status` in `past_due`/`unpaid` → PRECONDITION_FAILED payment
     hold (`hasPaymentHold`, checked inside `assertTenantSendingNotBlocked`, so it also blocks
     test sends and stops in-flight sends per batch in the worker). This is the enforcement
     backstop for the immediate proration invoice: a declined card holds sending until the
     payment method is fixed on Workspace → Billing. Free/enterprise never hold. The status is
     written by the `customer.subscription.updated` Stripe webhook; clears automatically when
     Stripe retries succeed (status back to `active`).
     1b. **Content gate (newsletter preflight)** — `newsletterPreflight.assertNewsletterContentSendable(db,
tenantId, newsletterRow)` (`modules/newsletters/preflight.service.ts`), called in
     `NewslettersController.sendNewsletter` directly after `assertTenantMaySendNewsletter`. A
     deliverability score 0–100 is assembled from explainable deductions: the shared deterministic
     lint (`libs/common/src/lib/preflight-lint.ts` — subject patterns, base64/oversize HTML,
     shortener/raw-IP/anchor-mismatch links, image-only bodies) plus a Claude content review
     (`@anthropic-ai/sdk`, `messages.parse` + `zodOutputFormat(AiPreflightVerdictObj)`, model
     `env.anthropicModel` default claude-opus-4-8). Bands live in
     `libs/common/src/lib/schemas/content-check.schema.ts`: `PREFLIGHT_GOOD = 80`,
     `PREFLIGHT_BLOCK = 50`; `score < 50` → PRECONDITION_FAILED ("Deliverability score N — fix the
     items flagged…") on every plan. Results cache in `newsletter_content_checks` keyed
     `(tenant_id, content_hash)` (sha256 over raw subject/html/plainText via `preflightHashInput`) —
     the composer's interactive `newsletters.runPreflight` (lint + Postmark spamcheck + AI, rate
     limited 30/h/tenant) usually pre-populates it, so the send-time gate is a cache hit.
     **Fail-open:** `ANTHROPIC_API_KEY` unset or the API erroring skips the AI layer (lint still
     scores); the Postmark spamcheck runs ONLY in the interactive check, never the send gate (keeps
     tests network-free). AI verdicts `scam_or_phishing` / `pure_commercial_marketing` (confidence
     ≥0.6) carry a 90-point deduction — blocked by construction. Fundraising/auctions/events are
     explicitly allowed in the prompt. **Every check includes the AI review** — the send gate and
     interactive checks alike, on every plan (deliberate 2026-07-17 decision, reversing a brief
     risk-scoped design: the pre-send threat the AI uniquely stops is a compromised established
     account blasting clean-linked phishing through shared sending infrastructure, and that risk
     grows with tenure and list size; per-check cost is cents and marketing states the always-on
     claim). `PreflightResult.aiStatus`: 'reviewed' | 'unavailable' (key unset/API error,
     fail-open) | 'not_required' (only the composer's local quick check). Composer UI: score
     gauge + findings card on Review & send, "Check deliverability" next to Send test email.
2. **Per batch, in the worker** — `handleSendNewsletter` (`lib/jobs/handlers/newsletter.handlers.ts`)
   re-loads the tenant every batch:
   - Paused/suspended mid-send → newsletter `status = 'paused'`, resume point saved in
     `newsletters.send_offset`, job ends. A later re-send resumes from `send_offset` instead of
     double-sending (`sendNewsletter` handles `status === 'paused'`).
   - `remainingSendAllowance` (hourly cap per plan + warm-up cap + monthly plan allowance)
     trims each batch; at 0 it enqueues a continuation job (+15 min) and frees the worker slot.
     The same continuation mechanism (`deferRemainderOfSend`) also fires after 10 batches in one
     execution with `run_at = now` — pool fairness, not rate limiting.
   - **At-most-once batches (2026-07-24 decision):** the advanced keyset cursor is claimed into
     the job payload BEFORE the SendGrid call, so a crash mid-batch skips that batch on retry
     rather than re-sending up to 500 duplicates (duplicates feed the spam tripwires; gaps don't).
     Flip side: metering stays post-send, so a crashed batch goes unmetered (caps permissive by
     ≤1 batch) and `delivered_count` is best-effort — real numbers come from the webhook events.
   - Every delivered batch inserts a `newsletter_send_log` row — that table IS the meter; it is
     pruned (30 days) inside the per-tenant loop of `pruneNewsletterEvents`.
3. **Tripwires, in the SendGrid webhook** — `applyEngagementTripwires` runs after each aggregate
   recompute (`newsletters-webhook.route.ts`). On sends ≥20 recipients: hard-bounce rate >5% →
   `pauseTenantSending`; spam-complaint rate >1% → `suspendTenant` (sets `suspended_at`, blocks
   sign-in, pending human review). Both log `[abuse-tripwire]` errors via Pino.
   **Automation sends are covered too (2026-07-19):** `applyAutomationTripwires` (same file as the
   newsletter one, same thresholds/min-sample via `evaluateTripwires`) runs from the webhook for
   every tenant whose automation events included a bounce/complaint. Because automation emails are
   one-recipient sends spread over time, the sample is a rolling 7-day window
   (`AUTOMATION_TRIPWIRE_WINDOW_DAYS`): delivered sends from `newsletter_send_log`
   (`source='automation'`) vs hard bounces / spam complaints the webhook stamps onto
   `workflow_runs.bounced_at` / `spam_reported_at` (migration `2026-07-20-f`; soft `blocked`
   bounces never stamp). Pause reason strings: `automation_hard_bounce_rate` /
   `automation_spam_complaint_rate`.

4. **Import list-quality tripwire (2026-07-24)** — the contact-import background job verifies the
   imported email list in-house (no third-party service) and pauses sending on an egregious
   bad-email rate. `runImportEmailVerification` (`lib/jobs/handlers/import-verification.ts`) runs
   inside `handleImportJob` for **persons imports only**, after `processImportRows` and before the
   completion email, fail-open (a thrown check never fails the import). It uses
   `EmailVerifierService` (`lib/mail/email-verifier.service.ts`): per unique domain an MX→A/AAAA
   DNS lookup (`node:dns/promises`, injectable resolver for tests, cached, ≤10 concurrent, 5s/lookup,
   2-min whole-import budget) — **only** ENOTFOUND/ENODATA on MX+A+AAAA is `dead`; timeouts/SERVFAIL
   are `unknown` → treated valid. Dead-domain + disposable (`isDisposableEmail`) addresses get an
   `email_suppressions` row with the new **`reason: 'invalid'`** (migration
   `2026-07-24-f-import-email-verification.ts` widened `chk_esup_reason`; the sendability + automation
   consent checks are reason-agnostic so suppression is automatic). The address STAYS on the person.
   Typo domains (gmial.com) and role accounts (info@) are **report-only, never suppressed/rewritten**.
   Constants at top of `email-verifier.service.ts`: `IMPORT_TRIPWIRE_MIN_EMAILS=100`,
   `IMPORT_BAD_EMAIL_WARN_RATE=0.08` (warn: `logger.warn` + report caution), `IMPORT_BAD_EMAIL_PAUSE_RATE=0.20`
   (pause: `pauseTenantSending(db, tenantId, 'import_bad_email_rate:{import_id}')` + `[abuse-tripwire]`
   error). Looser than the 5% bounce band on purpose — no-MX is a weaker signal than a real bounce.
   The per-import summary (counts + typo suspects + tripwire) is stored on `data_imports.email_verification`
   (jsonb) and rendered into the import-completion email. Pure logic (`evaluateImportListQuality`,
   `classifyEmails`, `classifyDomainError`) is unit-tested in `email-verifier.service.spec.ts` — no DNS.

**To un-pause / un-suspend** (support action, no UI): clear `tenants.sending_paused_at` (+
`sending_paused_reason`) or `tenants.suspended_at` in the DB. A paused newsletter is then
re-sent from the UI and resumes at its `send_offset`.

**Website claims:** the 5% bounce / 1% complaint tripwires, the **import list-quality pause + DNS/disposable
suppression on import** (EULA §8, security page — both updated 2026-07-24), the warm-up cap, the
verified-domain requirement and the enforced monthly allowance (2×/8×/12× multipliers on the
security page; "enforced at send time" in EULA §8) are quoted verbatim on the marketing site
(EULA §8, security page, FAQ). The preflight is also stated publicly: the "below 50 cannot send" threshold (security page,
EULA §8 bullet, help articles) and Anthropic in the privacy policy's subprocessor list + the
US-processing residency exception. If you change `PREFLIGHT_BLOCK`, the AI provider, or what the
AI receives, update those pages in the same change — see the `pplcrm-website-claims` skill for
the full registry.

**Reputation isolation:** free-tier sends on the platform SendGrid key default to the
`SENDGRID_FREE_TIER_SUBUSER` env subuser (tenant whitelabel subuser or tenant-owned API key wins).

**Postmark side:** transactional sends attach `Metadata.tenant_id`; the
`/api/postmark/webhook` route (`modules/mail/routes/postmark-webhook.route.ts`, auth =
`X-Postmark-Webhook-Token` header matching `POSTMARK_WEBHOOK_TOKEN`) writes hard bounces /
complaints into `email_suppressions`.

**Signup:** disposable-email domains are rejected in `auth/controller.ts signUp` via
`lib/mail/disposable-email-domains.ts` (curated Set — extend it, don't replace with a huge list).

**Automation emails obey the same layer (2026-07-18; tightened 2026-07-19):** the drip worker
(`handleProcessDripWorkflows`) first applies the **plan gate at processing time** — a tenant whose
plan lacks the `automations` feature (below Grassroots; `planAllowsFeature`) has its due
enrollments deferred an hour (nothing sends, nothing advances, nothing deleted — behaves like
paused, logged once per tenant per tick as `[plan-gate]`), so a downgrade actually stops running
automations. The workflow `send_email` step then checks the step's engagement condition
(`config.send_condition`, evaluated against the previous email run's `opened_at`/`clicked_at` —
unmet → `skipped` run), consent via `modules/workflows/automation-consent.ts` (suppressed / DNC /
unsubscribed-from-all-campaigns → run recorded as `skipped`, not failed), checks
`assertTenantSendingNotBlocked` (blocked → enrollment deferred 1h, not advanced), the identity
gates — `hasVerifiedSendingDomain` and, on Free, phone verification (`needsPhoneVerification` →
`AUTOMATION_PHONE_UNVERIFIED_MESSAGE`); either missing → failed run with the fix named — and the
allowance: `remainingSendAllowance` minus the tenant's enqueued-but-unsent `send-automation-email`
jobs (in-flight accounting). **Quota is metered on actual delivery, not enqueue:** the delivery
handler (`automation-mail.handlers.ts`) writes the `newsletter_send_log` row
(`source='automation'`, `newsletter_id NULL`) after SendGrid accepts the send, gated by the job
payload's `meterOnSend` flag (legacy flagless jobs were metered at enqueue; a job that exhausts
its retries consumes nothing). `sentEmailsSince` (and therefore the warm-up/hourly/monthly caps)
includes automation volume automatically. Send-log retention is 32 days
(`SEND_LOG_RETENTION_DAYS`, newsletter.handlers.ts) so the meter outlives a 31-day billing cycle. **Delivery is SendGrid, not Postmark** (Postmark = pplCRM-to-user mail only): the
step inserts its `workflow_runs` row first, then enqueues `send-automation-email`
(`lib/jobs/handlers/automation-mail.handlers.ts`) which resolves the tenant's sending identity
(same settings keys + free-tier subuser as newsletters) and sends with
`custom_args.workflow_run_id`; the SendGrid event webhook
(`modules/newsletters/routes/newsletters-webhook.route.ts` → `applyAutomationEvent`) stamps
`opened_at`/`clicked_at` back onto the run (click also stamps open — MPP makes opens noisy) and
writes bounce/complaint suppressions. Workflow-level `exit_conditions` (jsonb string[] —
donated / opened_any_email / clicked_any_email) end an enrollment early (`status='exited'`,
run row `step_kind='exit'`). Automation emails carry a per-recipient HMAC unsubscribe link
(`modules/newsletters/unsubscribe-token.ts` → public `GET /api/unsubscribe/:token`, which flips
all the person's `campaign_subscriptions` to unsubscribed) in a server-appended footer
(`buildAutomationFooter`; SendGrid subscription tracking disabled for these sends).

**Scheduled newsletters:** `process_scheduled_newsletters` (5-min cron,
`lib/jobs/handlers/newsletter.handlers.ts`) fires `status='scheduled'` rows through
`sendNewsletter`, so guards + preflight run at fire time; failures revert to draft + notify.
Scheduling itself flows through generic CRUD add/update, so `NewslettersController.add/update`
validate server-side (`assertSchedulable`): setting `status='scheduled'` requires a non-null,
future `send_date` (BAD_REQUEST otherwise) — a NULL date would never match the cron's
`send_date <= now` and sit invisible forever. Updates that merely edit other fields of an
already-scheduled row are exempt from the future check (a just-arrived send time is about to fire).
(Recurring newsletters were removed entirely 2026-07-18 — first the auto-send mode, then the
whole feature: draft-per-cadence added little over "Schedule for later". Migration
`2026-07-20-d` drops `newsletter_schedules` and `newsletters.schedule_id`.)

**Resend to non-openers:** `newsletters.resendToNonOpeners` clones a sent newsletter
(`resend_of_id` link, partial unique index = one resend per original, new subject required and
must differ) and sends through the normal guarded path; `buildRecipientQuery` excludes anyone
with an open/click event on the original at send time. Apple MPP asymmetry: machine-opens make
Apple users look like openers, so the resend under-reaches rather than over-reaches.

## Plan gates — `apps/backend/src/app/modules/billing/plan-gate.ts`

`GATED_FEATURES` in `libs/common/src/lib/billing/plans.ts` is the machine-readable core of
FEATURE_MATRIX (keep both in sync): forms/donations/automations/lists/volunteers (staff-side
management: teams, volunteer-events)/**api** → `grassroots`+; canvassing/deliveries/companions
(companion-access) → `movement`+. `planFeatureGate(feature)` is a tRPC
middleware that blocks **mutations only** (reads stay open — disclosure over suppression);
gated routers rebind locally:

```ts
import { authProcedure as baseAuthProcedure, router } from '../../../trpc';
import { planFeatureGate } from '../billing/plan-gate';
const authProcedure = baseAuthProcedure.use(planFeatureGate('forms'));
```

`createCrudRouter` accepts the gated procedure as its 4th argument. Gated routers today:
web-forms, donations, workflows, lists, canvassing, deliveries, companion-access, teams,
volunteer-events. Unknown/missing plan values fail closed to `free`.

**Two gates are NOT tRPC middleware, because the traffic they protect is public (2026-07-27):**

- **`api`** — enforced in `lib/validate-api-key.ts` `lookupTenantByApiKey()`, the single chokepoint
  every keyed request resolves through (Zapier inbound + the server-side form/RSVP/volunteer-signup
  submits). A plan miss returns `null`, which callers surface as the same generic "Invalid API key"
  as an unknown key — saying "this workspace is on the free plan" would leak billing status to an
  unauthenticated caller. Gating only key ISSUANCE (`SettingsController.createApiKey`, which also
  calls `assertPlanFeature`) would leave every already-issued key working forever, so a downgrade
  would not actually revoke API access.
- **`forms`** — enforced in `WebFormsController.submitFormPublic`, not on the route, so the keyless
  embed (`?t=`) and the keyed server-side submit are covered by one check. Before this, the
  web-forms router gated authoring only: a downgraded tenant could not edit a form, but every
  already-embedded form kept quietly accepting submissions.

Both mean **spec tenants must seed `subscription_plan: 'grassroots'`** to exercise form submission
or keyed requests at all — the baseline seed is Free, so omitting it fails with "requires the
Grassroots plan". `BillingController.getDowngradeImpact()` backs the billing page's pre-downgrade
warning (published forms, API keys, active automations) so the cut-off is announced rather than
discovered from a drop in signups.

**Workspace API keys hold two slots** (`workspace_api_keys.slot`, UNIQUE `(tenant_id, slot)`,
migration `2026-07-27-workspace-api-keys-two-slots`) so rotation can overlap: create the second key,
move integrations across, revoke the first. There is no "regenerate" — replacing a key in place was
the outage. `listApiKeys`/`revokeApiKey` are deliberately NOT plan-gated: taking a credential out of
service must never require an upgrade.

## Demo gate vs plan gate — `apps/backend/src/app/modules/demo/demo-guard.ts`

Two guards, different questions. Confusing them deadlocks the go-live wizard, which is exactly
what happened before 2026-07-26.

| Guard                | Asks                                    | Blocks                                                                                                    |
| -------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `assertNotDemoMode`  | is the seeded demo data still in place? | sending newsletters, inviting teammates, mailbox sync (Google/MS), Stripe Connect                         |
| `assertPlanSelected` | has the tenant settled on a plan?       | phone verification, sender-email verification, domain add/verify/delete (all in `settings/controller.ts`) |

"Settled" = `hasSettledPlan(tenants.subscription_status)` from `plans.ts` — `active` or
`trialing`, which **includes Free**, since `billing.selectFree` writes `active`/`free`. A brand-new
tenant has a null status; that is what "hasn't decided" means. Don't re-inline `['active','trialing']`.

Why verification is plan-gated and not demo-gated: the wizard verifies phone and domain at steps 3
and 4, _before_ removing the demo data at step 5 — and removing the demo data itself requires a
plan. Gate verification on demo mode and step 3 becomes unreachable until step 5, which is
unreachable until step 1. The frontend mirrors this: `settings-page.ts` has `isDemoLocked`
(email-sync, donations) and a separate `isPlanLocked` (domains), and the communications
verification block keys off `tenant_plan_selected` on the signed-in user — set in
`sanitizeUser`, refreshed after any plan change.

## Test traps

- Any spec touching phone/email/domain verification must seed the tenant with
  `subscription_status: 'active'`, or it dies on `assertPlanSelected` rather than exercising the
  behaviour under test (see `createTestSeed` in `settings/controller.spec.ts`).
- Router specs that mock `BaseRepository.dbInstance` with one shared `executeTakeFirst` row must
  include `subscription_plan: 'movement'` in that row, or every mutation dies on the plan gate.
- DB-backed newsletter send tests must seed the tenant on a paid plan **and** the two settings
  rows (`communications.default_from_email` + a `verified` entry in
  `communications.verified_domains`) — see `createTestSeed` in `newsletters/controller.spec.ts`.
- Pure threshold/cap logic (`warmupDailyCap`, `evaluateTripwires`, `planKeyOf`) is unit-tested in
  `send-guards.spec.ts` — extend there, no DB needed.

## Env vars

`SENDGRID_FREE_TIER_SUBUSER` (free-pool subuser), `POSTMARK_WEBHOOK_TOKEN` (webhook auth), plus
the pre-existing `TWILIO_*` (SMS codes; dev-mocks when unset).

`ALLOW_MOCK_DOMAIN_VERIFICATION=true` — local-dev-only opt-in that lets Settings → Domains
auto-pass DNS verification when no valid SendGrid key (tenant-owned or platform
`SENDGRID_API_KEY`) is configured (set in `.env.test` for the
backend suite). Without it, domain verification fails closed: a missing/broken SendGrid key or a
SendGrid API outage leaves records unverified rather than silently opening the sending guards
(`settings/controller.ts` `verifyVerifiedDomain`, `sendgrid-whitelabel.service.ts` validate
fallbacks). Note domain `status: 'verified'` requires SPF + both DKIM records + link branding;
DMARC is recommended but optional and never blocks verification.
