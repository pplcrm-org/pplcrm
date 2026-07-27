# Abuse & Threat Report — pplCRM

**Date:** 2026-07-27
**Branch audited:** `fix/pre-launch-hardening` (at commit `7b400cb4`)
**Scope:** Application-layer abuse by a malicious user. Static source audit, no dynamic testing.
**Status:** Findings only — no code was changed.

---

## 1. Executive summary

pplCRM is about to launch as a multi-tenant SaaS holding voter and supporter PII, processing
donations, and sending email on shared reputation. That combination makes a hostile signup
valuable: it buys an outbound mail pipe, paid third-party APIs, and shared blob storage for the
price of an email address.

The security fundamentals here are genuinely good — sessions, password hashing, CSRF, SQL
injection, frontend XSS, webhook signature verification, and donation money-flow are all
correctly built, and several of them are better than typical for a pre-launch product
(see §6). The findings below are gaps in _authorization and abuse control_, not in cryptography
or hygiene.

**Five critical findings. All are exploitable today.**

| ID     | One-line summary                                                                        | Impact                                                                                  |
| ------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **C1** | `files.registerFile` accepts an arbitrary `storageKey` from the client                  | Any tenant reads and deletes any other tenant's exports, imports, and uploads           |
| **C2** | Every user-management guard tests `role === 'user'`, but `role` is nullable             | An invited user with no role promotes a confederate to owner                            |
| **C3** | `activateMockPlan` is gated on the Stripe key being _absent_, not on an explicit opt-in | If a prod Stripe secretref fails to resolve, any owner self-grants the top plan         |
| **C4** | Campaign scope is supplied by the client, not derived from the session                  | A campaign-pinned editor reads and acts across every campaign in the tenant             |
| **C5** | The Postmark transactional pipe has no anti-abuse gates at all                          | A free tenant sends mass phishing from pplCRM's own domain, invisible to every tripwire |

**Recommendation:** treat C1, C2, and C3 as launch blockers. C1 is a cross-tenant data breach
reachable by any account on any plan; C2 is privilege escalation; C3 converts a routine
deployment misconfiguration into free revenue loss. C4 and C5 should also land before the
product is open to untrusted signups, but they are contained if the initial customer set is
known and small.

A structural note that runs through several findings: the anti-abuse layer documented in
`pplcrm-sending-guards` is real and well-built, but it protects **one** pipe (SendGrid
newsletters). The second outbound pipe (Postmark transactional) and the paid-API surfaces
(Claude, Twilio, Azure storage) grew up outside it. The gaps are not oversights in the guard
logic — they are surfaces the guard was never wired to.

---

## 2. Method and scope

The audit modelled three attacker tiers against the source:

1. **Anonymous internet** — public REST routes, token-capability links (`/t/`, `/r/`, `/f/`,
   `/d/`, unsubscribe), webhooks, OAuth callbacks, and the unauthenticated tRPC procedures.
2. **Authenticated tenant** — a legitimate signup, including a free-tier one, acting against
   the platform's shared resources (mail reputation, paid APIs, storage) and other tenants.
3. **Low-privilege member inside a tenant** — an invited user, viewer, or campaign-pinned
   editor acting against their own organization.

Every finding below was confirmed by reading the referenced source. File and line anchors were
verified against the branch at the time of writing; the branch is active, so re-confirm anchors
before acting on an individual item.

**Not covered:** dependency CVE scanning, Azure IAM / network / firewall configuration, dynamic
or penetration testing against a running instance, physical and social engineering, and the
correctness of third-party services themselves. Absence of a finding in those areas is not
evidence of their soundness.

**Severity model:** severity is damage-if-exploited weighted by ease of reach. "Reachable by"
names the _lowest_ privilege that works — the most important column in this report.

---

## 3. Critical findings

### C1 — Cross-tenant blob read and delete via unvalidated `storageKey`

**Reachable by:** any authenticated user, any plan, no special role.
**Source:** `apps/backend/src/app/modules/files/trpc.router.ts:43` ·
`apps/backend/src/app/modules/files/controller.ts:50-121` ·
`apps/backend/src/app/modules/files/routes/files.route.ts:46-58`

The upload flow is two steps, and the first step is correct. `files.getUploadUrl` mints the
storage key **server-side** and returns a 15-minute write SAS:

```ts
const storageKey = `uploads/${ctx.auth.tenant_id}/${fileUUID}_${input.filename}`;
```

The second step then throws that away. `files.registerFile` declares
`storageKey: z.string()` and accepts whatever the client sends. Neither the router nor
`FilesController.registerFile` ever checks that the key matches the one that was minted, or
that it even begins with the caller's own tenant prefix.

The download route looks tenant-safe at a glance, and this is what makes the bug easy to miss:

```ts
const file = await db.selectFrom('files').selectAll()
  .where('tenant_id', '=', tenantId)   // ← scopes the ROW
  .where('id', '=', id)
  .executeTakeFirst();
...
const buffer = await storageService.download(file.storage_key);  // ← trusts the KEY
```

The `tenant_id` filter is real, but it protects the wrong thing. The row belongs to the
attacker — they created it. The `storage_key` inside that row is attacker-controlled, and
line 58 dereferences it verbatim.

**Attack:**

1. `files.registerFile({ storageKey: 'exports/<victim_tenant_id>/<export_id>.csv', filename: 'x.csv' })`
2. `GET /api/files/download/<new_id>` → the victim tenant's full CSV export.

`files.delete` (`controller.ts:120-137`) follows the same path, so the same trick gives
cross-tenant blob **deletion**. Target keys are predictably shaped and enumerable: exports at
`export.handlers.ts:120`, import sources at `tasks/controller.ts:381`.

This defeats the tenant-isolation model wholesale, and it is invisible to the
`local/no-unscoped-db-query` lint rule — every query on the path _is_ correctly scoped. The
leak is in the blob layer, which the rule cannot see.

**Remedy.** Stop accepting the key. Have `getUploadUrl` return an opaque signed handle — an
HMAC over `(key, tenant_id, expiry)` — and have `registerFile` accept the handle and re-derive
the key server-side. The handle is unforgeable and already carries the tenant, so the check
becomes structural rather than a validation someone can later forget.

A cheaper interim fix is to reject any key not matching `^uploads/<ctx.auth.tenant_id>/`, but
prefer the handle: the prefix check is one refactor away from being dropped.

Separately, sanitize `input.filename` for path components at `trpc.router.ts:32` — it is
interpolated into the key unescaped.

**Regression test.** `registerFile` with a foreign-tenant key throws `FORBIDDEN`; with a
well-formed but never-minted same-tenant key throws; the happy path still registers. Add the
matching case for `files.delete`.

---

### C2 — `role IS NULL` bypasses every user-management guard

**Reachable by:** an invited user in a tenant with no `access.default_role` setting.
**Source:** `apps/backend/src/app/modules/auth/controller.ts:816` (creation) ·
`:1556`, `:1576`, `:1582` (guards)

`authusers.role` is nullable, and the schema explicitly permits it —
`apps/backend/src/app/_migrations/schema.sql:119` declares `role text` with a CHECK at `:141`
of the form `((role IS NULL) OR (role = ANY (...)))`. A NULL-role account is not hypothetical:
`inviteUser` at `controller.ts:816` does `let role = input.role ?? null`, and if the tenant has
no `access.default_role` setting configured, that NULL is what gets inserted.

Every guard in `updateUser` is written as **deny-if-editor** rather than allow-if-privileged:

| Line    | Guard                                                               | NULL-role result                           |
| ------- | ------------------------------------------------------------------- | ------------------------------------------ |
| `:1556` | `if (callerRole === 'user' && userId !== auth.user_id)`             | passes — may target any user in the tenant |
| `:1576` | `if (callerRole === 'user') { if (isRoleChange) throw }`            | passes — **may change other users' roles** |
| `:1582` | `if (callerRole === 'admin') { ...owner promote/demote guards... }` | never runs — owner protections skipped     |

**Attack.** An invited user with no role signs in and calls `users.updateUserProfile`
(`apps/backend/src/app/modules/users/trpc.router.ts:18`, a plain `authProcedure`) with
`{ id: <second account they control>, data: { role: 'owner' } }`. Changing _one's own_ role is
correctly blocked at `:1568`, so the escalation goes through a confederate account — which an
attacker who can trigger one invite can usually obtain.

The fix shape is already present in the same function. The campaign-assignment branch at
`:1630` is written correctly:

```ts
if (callerRole !== 'admin' && callerRole !== 'owner') {
  throw new ForbiddenError('Only admins and owners can assign users to campaigns.');
}
```

That single fail-closed branch among fail-open siblings suggests drift rather than intent — the
newer code got it right and the older code was never revisited.

**Remedy.** Invert all three guards to deny-by-default, matching `:1630`. Then close the source:
default to `'user'` at `controller.ts:816` rather than NULL, backfill existing NULL roles, and
make the column `NOT NULL` in a migration so the state becomes unrepresentable. Do all three —
the guard fix alone leaves a nullable role for the next feature to trip over.

**Regression test.** A NULL-role caller and a `'user'`-role caller both receive `FORBIDDEN` when
changing another user's role; an admin still succeeds; an admin still cannot promote to owner.

---

### C3 — Tenant owner self-grants the top plan when Stripe is misconfigured

**Reachable by:** any tenant owner or admin — _conditional_ on `STRIPE_SECRET_KEY` failing to
resolve in production.
**Source:** `apps/backend/src/app/modules/billing/controller.ts:788`, `:824` ·
`apps/backend/src/app/lib/stripe-platform-client.ts:9`

`activateMockPlan` has exactly one guard:

```ts
if (!isMockMode) {
  throw new Error('This helper is only available in local Mock Mode');
}
```

and `isMockMode` is defined as `stripe === null` — that is, **the Stripe key being absent or
containing the string "MockKey"**. Mock mode is inferred from a missing credential, not
declared by an operator.

This contradicts a rule the codebase writes down for itself. `apps/backend/src/env.ts:129-131`
states that money-touching mock paths "require an EXPLICIT opt-in, never merely
`NODE_ENV !== production`" — and the donation path honours it (`web-forms-public.route.ts:477`
correctly checks `env.allowMockPayments`). The billing path does not. `deploy/PROD-CHECKLIST.md:129`
confirms the failure mode is understood and live: _"Integration keys (mock silently if unset)."_

**Attack.** A production deploy where the Stripe secretref typos, the Key Vault reference
unmounts, or the secret is rotated without updating the app. The backend **boots normally** —
there is no startup assertion. Any tenant owner then calls:

```ts
billing.activateMockPlan({ plan: 'movement', quantity: <tier max>, interval: 'year' })
```

Lines `:800-812` write `subscription_plan`, `subscription_status: 'active'`, a year-out expiry,
and a fabricated `stripe_subscription_id` directly onto `tenants`. Every downstream entitlement
check reads that column — `plan-gate.ts`, `send-guards.ts:207`, `usage-limits.ts`,
`workflows.handlers.ts:65` — so the tenant receives the top tier, all feature gates, and the
full send and seat caps for free.

The state is also **self-healing in the wrong direction**: `syncSubscriptionFromStripe` cannot
correct it, because that function short-circuits in mock mode too (`:368`). The fabricated
subscription persists until someone notices manually.

`cancelMockPlan` (`:824`) carries the identical guard.

**Remedy.** One line at each site:

```ts
if (!isMockMode || !env.allowMockPayments) throw new Error(...)
```

More importantly, fix the class of bug: make the backend **refuse to boot in production** when
`STRIPE_SECRET_KEY` is unset, rather than silently degrading to a mode where money is fictional.
`env.ts:162-177` already does exactly this for `TRUST_PROXY` and is the pattern to copy. Silent
degradation to mock is the root cause; the missing `allowMockPayments` check is only what makes
it exploitable.

**Regression test.** With `ALLOW_MOCK_PAYMENTS` unset and no Stripe key, `activateMockPlan`
throws. Add a config test asserting production boot fails without a Stripe key.

---

### C4 — Campaign scope is client-supplied, so a pinned editor acts across campaigns

**Reachable by:** any editor pinned to a single campaign.
**Source:** `apps/backend/src/trpc.ts:129-146`, `:224-240` ·
`apps/backend/src/app/lib/base.repo.ts:246`, `:259-263` ·
`apps/backend/src/app/lib/crud-router.ts:30, 50, 58`

The campaign guard scans raw tRPC input for keys named `campaignId` / `campaign_id` and denies
on mismatch against the caller's assigned campaign. Where a campaign id is present, it works —
`campaigns.upsertPersonFact`, `campaigns.setSubscription`, and `emails.getEmails` are all
correctly blocked, and the REST mirror at `emails-api.route.ts:423-436` matches.

But it is the **only** campaign check in the system, and being input-shaped rather than
data-shaped, it has two structural holes.

**Hole 1 — by-id procedures carry no campaign key, so the guard never fires.** Input is a bare
`idSchema`; the controller then scopes by `tenant_id` alone. Affected:

- `newsletters.send` / `getReport` / `cancelSchedule` / `resendToNonOpeners`
  (`modules/newsletters/trpc.router.ts:33-47`, resolving via `getOneById({tenant_id, id})` at
  `newsletters/controller.ts:466, 570, 816`). **A campaign-A editor can send campaign B's
  newsletter** — an irreversible action against the wrong audience.
- `emails.getEmailBody` / `getEmailHeader` / `getEmailWithHeaders` / `getAttachmentsByEmailId`
  (`modules/emails/trpc.router.ts:76-96`). `emails.campaign_id` is NOT NULL and mailboxes are
  per-campaign, yet any campaign's mail is readable by id.
- Every `createCrudRouter` `getById` / `update` / `delete` (`lib/crud-router.ts:30, 50, 58`),
  which covers each table in `CAMPAIGN_SCOPED_TABLES`: `lists`, `web_forms`, `donations`,
  `events`, `turfs`, `delivery_requests`, `delivery_routes`.

**Hole 2 — omitting the campaign id returns every campaign's rows.** `campaignScope()` returns
`null` when the option is absent, and `getAll` then applies no campaign filter at all:

```ts
protected campaignScope(options?: QueryParams<T>): string | null {
  const campaignId = (options as { campaignId?: string } | undefined)?.campaignId;
  if (!campaignId) return null;           // ← absent means unscoped, not "use my campaign"
  return CAMPAIGN_SCOPED_TABLES.has(String(this.table)) ? campaignId : null;
}
```

A pinned editor calls `newsletters.getAll` / `donations.getAll` / `lists.getAll` with
`options: {}` and enumerates the entire tenant across all campaigns. Campaign scoping is
**opt-in from the client** for a scope the server claims to pin — the wrong default.

Additionally, `campaigns.getPersonFacts` (`modules/campaigns/trpc.router.ts:47` →
`controller.ts:205`) filters on `{tenant_id, person_id}` only and returns support level and
voting status for _all_ campaigns, to any authenticated caller.

**Remedy.** Make campaign scope **server-derived**. When `ctx.auth.campaign_id` is set, inject
it as the effective scope inside `campaignScope()` and on the crud-router by-id path, and reject
a client-supplied value that differs from it. The client should be able to _narrow_ within its
assignment, never to widen or omit its way out.

Also harden the guard itself to fail closed. `trpc.ts:140` records a campaign id only when the
value is a non-empty string or number, and the `else` at `:142` does not recurse into a
campaign-named key — so `{campaignId: ['<other id>']}` is skipped rather than rejected. Zod
rejects those shapes downstream today, so this is not currently exploitable, but the guard runs
on `getRawInput()` _before_ validation, which means its safety depends on a property it does not
itself enforce. The `depth > 4` cutoff at `:133` has the same character. Failing closed on an
unexpected shape costs one line.

**Regression test.** A campaign-A editor receives `FORBIDDEN` on `newsletters.send` for a
campaign-B id; `getAll` with `options: {}` returns only campaign-A rows. Note there is currently
**no spec anywhere** for `collectCampaignIds` or the guard block — `grep` finds it only in
`trpc.ts` — so this is new coverage, not an extension.

---

### C5 — The Postmark transactional pipe is an ungated spam and phishing relay

**Reachable by:** free tier, no verified domain, no phone verification.
**Source:** `apps/backend/src/app/lib/mail/transactional-mail.service.ts:194` ·
`apps/backend/src/app/lib/jobs/handlers/notifications.handlers.ts:316-325` ·
`apps/backend/src/app/modules/events/trpc.router.ts:64`

The anti-abuse layer described in `pplcrm-sending-guards` is well-built and does what it says —
suspension and pause checks, DKIM-verified domain, free-tier phone verification, a 7-day warm-up
cap, monthly plan allowance, preflight content scoring, bounce and complaint tripwires, and a
per-tenant hourly cap in the outbox worker. All of it applies to **one pipe: SendGrid
newsletters and automations.**

The second pipe has none of it. `TransactionalMailService.sendMail` (`:194`) performs no
suspension check, no pause check, no domain or phone gate, no allowance accounting, no preflight,
and no rate limiting — while sending from the platform address with the pplCRM logo and template.
Anything that reaches it is a DKIM-signed email carrying pplCRM's own reputation.

Reaching it is easy. The `events` module is **not** in `GATED_FEATURES`
(`libs/common/src/lib/billing/plans.ts` lists `forms`, `api`, `donations`, `automations`,
`lists`, `volunteers`, `canvassing`, `deliveries`, `companions` — no `events`), and every
procedure in `modules/events/trpc.router.ts` is a plain `authProcedure` with no
`planFeatureGate`. A free tenant has full access.

`events.addRegistration` (`:64`) enqueues a confirmation per registration, and the handler
interpolates tenant-controlled strings into HTML **without escaping**
(`notifications.handlers.ts:316-325`):

```ts
subject: `Registration confirmed: ${event.name}`,
html: `<h2>Registration confirmed</h2>
<p>You're registered for <strong>"${event.name}"</strong>!</p>
... <p><strong>Location:</strong> ${event.location_address || 'TBD'}</p> ...`
```

with contact details built at `:310` as
`` `Email: <a href="mailto:${event.contact_email}">…</a>` ``. The schema permits it:
`libs/common/src/lib/schemas/events.schema.ts:17, 19, 29` allows `name` at 200 chars,
`location_address` at 500, and `contact_email` as `z.string().max(255)` — **not** email-validated,
landing inside an `href` attribute. `lib/mail/sanitize-util.ts:7` exists and is never called
here.

**Attack.** Free signup → `persons.importMany` a large address list → create one event named:

```html
</strong><h2>Your payroll deposit failed</h2><a href="https://evil.tld">Verify now</a>
```

→ loop `events.addRegistration` across every person. The result is mass phishing sent from
pplCRM's Postmark domain, with pplCRM's logo header, that touches none of the preflight AI, the
verified-domain gate, phone verification, the warm-up cap, or the monthly allowance.

**The abuse is also invisible.** `sendMail` attaches `Metadata.tenant_id` only when the caller
passes it (`transactional-mail.service.ts:237`), and none of the `notifications.handlers.ts`
call sites do. The Postmark bounce webhook therefore cannot tenant-scope suppressions, and **no
tripwire ever fires** on this pipe — the platform's reputation degrades with nothing attributing
it to a tenant.

The same unescaped, ungated shape appears throughout:

| Path                     | Source                                        | Attacker-controlled input                       |
| ------------------------ | --------------------------------------------- | ----------------------------------------------- |
| Event reminder           | `notifications.handlers.ts:382-392`           | `event.name`, `location_address`                |
| Form autoresponder       | `notifications.handlers.ts:216-224`           | `form.name` in subject and body                 |
| Form admin alert         | `notifications.handlers.ts:236-246`           | `form.name`, `payload.notes` (10k chars)        |
| Volunteer signup / shift | `notifications.handlers.ts:62-70`, `:177-190` | `event.name`, `location_address`                |
| Task assignment          | `modules/tasks/controller.ts:81-92`, `:201`   | display name, `payload.details`                 |
| Invitation               | `modules/auth/controller.ts:2185-2189`        | inviter display name, in subject and `<strong>` |
| Volunteer link           | `lib/mail/volunteer-link-notify.ts:47-51`     | `orgName`, turf/route name                      |
| Export ready             | `lib/base.controller.ts:326-333`              | display name, `fileName`                        |

The invitation case deserves separate emphasis: `inviter` is the inviting user's self-chosen
`first_name`, spliced raw into an email delivered to a **third party** who has no prior
relationship with the tenant. A display name of
`<a href="https://evil/">Click to activate</a>` renders as a link inside a legitimate,
DKIM-signed pplCRM invitation.

**Remedy.** Four parts, in priority order:

1. Route every `sendMail` call through an `assertTenantMaySendTransactional` gate — at minimum
   suspension and pause checks plus a per-tenant hourly cap on recipient-facing mail.
2. Always pass `Metadata.tenant_id` so bounce and complaint tripwires can attribute. Consider
   making `tenant_id` a required parameter of `sendMail` so the compiler enforces it.
3. Escape every interpolation. `lib/mail/sanitize-util.ts:7` already exists and is currently
   called by **none** of the 47 `html:` templates in the backend.
4. Validate `contact_email` as an email address.

`newsletters.sendTest` (`modules/newsletters/controller.ts:713-733`) is the model to copy — it
pins the recipient to the caller's own DB-read address and rate-limits 20/hour. That reasoning
was simply never applied to the transactional paths.

**Regression test.** A suspended tenant's registration confirmation is not sent; an event name
containing HTML is escaped in the rendered body; every `sendMail` call site carries
`tenant_id` metadata (assertable with a lint rule or a required parameter).

---

## 4. High findings

### H1 — SSRF via tenant-supplied Zapier webhook URL

**Source:** `apps/backend/src/app/modules/zapier/zapier.service.ts:102` ·
`zapier.trpc.router.ts:25`

The subscription URL is validated only as `z.string().url('Must be a valid URL').max(2048)` —
no scheme allow-list, no private/link-local/loopback range block, no DNS-rebinding guard, no
redirect cap. `zapier.service.ts:102` then POSTs to it from inside the Azure Container Apps
network on every matching CRM event.

Any authenticated user can subscribe
`http://169.254.169.254/metadata/instance?api-version=2021-02-01` or `http://127.0.0.1:3000/…`.
The request is blind — the response body is discarded — but the status code is logged at `:109`,
which makes it a usable oracle for internal host and port scanning. The 15-second
`AbortSignal.timeout` is the only limiting factor.

**Remedy.** Allow-list `https:` only; resolve the hostname and reject RFC-1918, link-local,
loopback, and ULA ranges **at request time** rather than only at subscribe time (checking only
at subscribe time is defeated by DNS rebinding); set `redirect: 'manual'`. An egress allow-list
of known hook hosts is stronger still if the integration surface is narrow.

**Test.** Subscribing to loopback, metadata, and private-range URLs is rejected; a
`https://hooks.zapier.com/...` URL is accepted.

---

### H2 — Client-supplied `sizeBytes` bypasses the storage quota

**Source:** `apps/backend/src/app/modules/files/trpc.router.ts:42` ·
`apps/backend/src/app/modules/files/controller.ts:79-108`

The quota check is real but reads a client-declared number:
`sizeBytes: z.number().nullable().optional()`, with no `.min()`, never reconciled against the
blob's actual `Content-Length`. The enforcement is wrapped in `if (sizeBytes > 0)`, so declaring
`0` skips the check entirely:

```ts
const sizeBytes = input.sizeBytes || 0;
if (sizeBytes > 0) {           // ← declare 0 and the whole block is skipped
  ... quota enforcement ...
}
```

Upload 5 GB through the SAS URL, register with `sizeBytes: 0` — unlimited storage on the free
plan. A negative value would additionally corrupt the `getTotalBytes` accounting.

**Remedy.** Read the real blob size server-side via `getProperties()` after upload and use that
value; treat a mismatch against the declared size as a rejected upload. Constrain the schema to
`.int().nonnegative()`.

**Test.** Registering with `sizeBytes: 0` after a large upload still enforces the quota.

---

### H3 — Unlimited Twilio SMS to an arbitrary number with attacker-authored text

**Source:** `apps/backend/src/app/modules/deliveries/controller.ts:583` ·
`apps/backend/src/app/modules/canvassing/controller.ts:431`

`resendVolunteerLink` has no rate limit. It re-mints a token and sends an SMS whose body is
`` `${orgName}: your ${kindLabel} is ready. Open your personal link: ${url}` ``, where `orgName`
comes from tenant settings.

**Attack.** Create a person whose `mobile` is a victim's number, create a route, assign it, then
loop `deliveries.resendVolunteerLink` — SMS bombing an arbitrary number with an attacker-chosen
prefix, billed to the platform's Twilio account. The canvassing assign/unassign loop at
`canvassing/controller.ts:431` is the same hole.

The correct pattern already exists in this codebase: phone verification at
`modules/settings/controller.ts:263-264` limits 3/hour **per tenant and per destination number**.

**Remedy.** Apply that same dual limiter here, and cap total resends per assignment.

**Test.** The fourth resend within the window is rejected.

---

### H4 — Paid Claude preflight reachable by any free tenant; limiter is per-process

**Source:** `apps/backend/src/app/modules/newsletters/trpc.router.ts:57` ·
`preflight.service.ts:46`, `:214` · `apps/backend/src/app/lib/rate-limiter.ts:8`

`newsletters.runPreflight` is a plain `authProcedure` — no plan gate, no verified-domain
requirement, no phone verification. Its only protection is `AI_CHECKS_PER_HOUR = 30`, enforced
by an **in-process `Map`** whose own header comment concedes the problem:

> does NOT coordinate across instances, so running more than one backend replica effectively
> multiplies every limit by the replica count

It also resets on every deploy. That yields 720 Claude calls/day per tenant as a floor,
multiplied by replicas, with scripted signups scaling it linearly — the disposable-email block
(`lib/mail/disposable-email-domains.ts`) is the only signup friction. Per-call cost is bounded
(`AI_TEXT_CAP = 8_000`, `AI_MAX_TOKENS = 2_048`) but aggregate cost is not.

Minor, same file: the Postmark spamcheck fetch at `:203` runs _before_ `checkRateLimit` at
`:214`, so it is not covered by the limit at all.

**Remedy.** Gate `runPreflight` behind a paid plan, or minimally behind a verified domain — a
tenant with no domain cannot send anyway, so there is no legitimate reason for it to be
consuming AI review. Move the counter to Postgres or Redis so it is genuinely per-tenant rather
than per-process, and add a monthly ceiling. Move the spamcheck fetch after the limiter.

**Test.** The 31st call within an hour is rejected across two simulated instances.

---

### H5 — `OAUTH_TOKEN_ENC_KEY` unset means silent plaintext mailbox tokens at rest

**Source:** `apps/backend/src/env.ts:150` · `apps/backend/src/app/lib/secret-crypto.ts:29-31`, `:43`

The key is optional in the schema. When unset, `KEY = null` and `encryptSecret()` returns its
input unchanged — no exception, no warning log, no boot failure. `env.ts:147-149` states the key
"MUST be set in any environment that connects real mailboxes," but nothing enforces it.

The consequence is that every tenant's Gmail and Microsoft Graph **refresh tokens** sit in
cleartext in `google_oauth_tokens` / `ms_graph_tokens`. Anyone with a database read — a backup
copy, a support query, a read-replica credential — obtains persistent access to customer
mailboxes.

This is the same failure pattern as C3: a missing credential silently degrades into a weaker
mode instead of stopping the process.

**Remedy.** Refuse to boot in production without the key, mirroring the existing `TRUST_PROXY`
guard at `env.ts:162-177`. Add a startup assertion, and a migration to re-encrypt any rows
already stored in plaintext.

**Test.** Production configuration without the key fails startup.

---

### H6 — Uncapped export queue

**Source:** `apps/backend/src/app/modules/exports/controller.ts:34`

`exports.queueExport` has no rate limit and no cap on pending exports per tenant. Each job
streams a full table to blob storage (`export.handlers.ts:120-126`) and then sends an email
(`:195`). Export blobs are **not** counted against the `files` storage quota.

Looping the mutation a few thousand times produces unbounded queue depth, unbounded
unaccounted disk, and an email fan-out. `lib/jobs/job-claim.ts:12` provides per-tenant
in-flight fairness (`inFlightCap = workerConcurrency - 1`, default 3), which limits concurrency
but not any of the three.

**Remedy.** Cap pending exports per tenant (three is consistent with the existing in-flight
cap), rate-limit the mutation, count `exports/` blobs against the storage quota, and TTL-expire
old export blobs.

**Test.** The fourth queued export while three are pending is rejected.

---

## 5. Medium findings

Report-worthy, but each is either lower-impact or harder to reach than the above. Suggested as a
tracked second wave rather than launch blockers.

**M1 — No per-account sign-in lockout.** `modules/auth/trpc.router.ts:76` rate-limits 10/15min
keyed on IP only; there is no `failed_attempts` or `locked_until` anywhere (the
`two_factor_attempts` counter covers only the OTP step). A botnet spreading attempts across IPs
faces no ceiling against a single known email. Compounded by the in-process limiter (H4).

**M2 — No global rate limit and no `bodyLimit`.** `fastify.server.ts` registers no
`@fastify/rate-limit` — every limit in the system is hand-rolled and per-route — and never sets
`bodyLimit`, leaving Fastify's 1 MiB default. CSV import `rows` arrays have **no `.max()`**
(`modules/persons/trpc.router.ts:200` and the household/company/task siblings), so imports are
bounded today only by that accidental 1 MiB: raising `bodyLimit` for any unrelated reason
instantly opens an unbounded import. Multipart sets `fileSize: 50MB` but no `files` or `fields`
count limit.

**M3 — Unthrottled public endpoints that touch the database.** `/healthz` and `/healthz/worker`
(`app/routes.ts:90`, `:105`) run queries per request. `GET /api/forms/f/:slug`, `/d/:slug`, and
`/api/forms/success` (`web-forms-public.route.ts:470-520`) each perform two or more queries with
**zero** rate limiting — while every sibling public surface (events, volunteer events,
unsubscribe) does throttle, which again reads as drift rather than intent.

**M4 — Tenant newsletter HTML is never sanitized before send.** `lib/mail/newsletter-render.ts:88-93`
strips editor block-data and rewrites relative image URLs but applies no DOMPurify — asymmetric
with the mailbox-compose path, which does sanitize (`modules/emails/controller.ts:522`). The
exposure is outbound only (the CRM renders it safely via the Angular sanitizer and a sandboxed
iframe), but a compromised editor account can send arbitrary markup from the tenant's verified
domain.

**M5 — Weak or permanent capability tokens.** Companion OTP codes are **unsalted SHA-256** over a
10⁶ space (`companion-access/controller.ts:138, 151`) — a rainbow table reverses them instantly
given database read access. Canvass turf tokens are stored **plaintext**
(`turf-assignments.repo.ts:93-102`), unlike delivery tokens, which are correctly hashed. Turf
expiry can be `null` when the campaign has no end date (`canvassing/controller.ts:464-471`),
producing a permanently valid capability. `auth.cancelTenantDeletionByToken` uses a deterministic
HMAC of the tenant id with **no TTL, no nonce, and no rate limit** (`auth/controller.ts:912-914`),
so one leaked cancel URL is a permanent capability.

_Note the online brute-force ceiling on the OTP is adequate_ — 3 codes × 5 attempts per 15
minutes per token is roughly 950 years expected. The finding is about at-rest reversal, not
guessing.

**M6 — Companion `verify/start` is an SMS cost amplifier.** Anyone holding a valid capability
link can force 3 SMS per 15 minutes per token indefinitely (~288/day/token) against the
platform's Twilio bill. Only `suspended_at` blocks it; `paused_at` is not checked
(`companion-access/controller.ts:115-130`).

**M7 — Email enumeration oracles remain.** `auth.signUp` throws distinctly via
`verifyUserDoesNotExist` (`auth/controller.ts:1437`), and `auth.checkEmail` reveals passkey
presence. `signIn`, `verify2FA`, and `sendPasswordResetEmail` were all explicitly hardened
against enumeration, which makes these two look like drift rather than an accepted trade-off.

**M8 — Password-reset mail bombing; two procedures with no limit at all.**
`sendPasswordResetEmail` is IP-limited (3/hour) but **not** email-limited — unlike
`resendVerificationEmail`, which correctly limits both (`auth/trpc.router.ts:221-222`). Rotating
source IPs mail-bombs a single victim. `auth.renewAuthToken` (`:46`) and
`auth.passkeyAuthenticationOptions` (`:249`) have **no** rate limit whatsoever.

**M9 — No log redaction; a bearer-secret is logged.** Pino has no `redact` configuration
(`app/logger.ts:7-10`). Concretely, `modules/zapier/zapier.service.ts:109` and `:113` log the
full `sub.webhook_url` at `error` level on every failure — Zapier and Make hook URLs are
bearer-secret-in-URL, so a flapping integration writes the tenant's webhook credential into
production logs.

**M10 — Azure storage CORS is globally `*` with DELETE.** `lib/storage.service.ts:36-45` calls
`setProperties({ cors: [{ allowedOrigins: '*', allowedMethods: 'GET,HEAD,POST,PUT,DELETE,OPTIONS',
allowedHeaders: '*', exposedHeaders: '*' }] })` — a **service-wide** setting, not per-container —
and re-applies it on every single upload. Any tenant requesting an upload URL keeps the whole
storage account pinned to that policy.

**M11 — No file-type or MIME validation.** There is no extension allow-list, MIME allow-list, or
magic-byte sniffing anywhere in the files module or `lib/storage.service.ts`. Client-declared
`mimeType` is stored verbatim and echoed back as the download `Content-Type`
(`files.route.ts:59`). `Content-Disposition: attachment` (`:60`) does mitigate direct rendering,
but the platform still functions as an open file host on its own domain — and, combined with C1,
on a container reachable by write SAS.

**M12 — `SHARED_SECRET` accepts any non-empty string.** `env.ts:35` validates it as
`z.string().min(1)` with no entropy floor and no production-specific check, despite being the
sole HS256 signing key for both session JWTs and scoped download tokens. A one-character secret
boots cleanly.

**M13 — Assorted input-validation gaps.**
Donation `amountCents: z.number()` is missing `.int().positive()`
(`modules/donations/trpc.router.ts:41, 61, 83`), inconsistent with `limit_amount` two lines
below at `:160`.
`rowOffsetSchema` has no maximum (`libs/common/src/lib/schemas/core.schema.ts:83`), so
`offset: 999999999` reaches Postgres as an OFFSET scan — note `limit` _is_ correctly capped at
`MAX_PAGE_SIZE = 5000`.
`verifyEmail` calls `getCodeAge` with `executeTakeFirstOrThrow` **before** the null check
(`auth/controller.ts:1950-1965`), so an unknown code surfaces as a 500 rather than the intended
`BadRequestError`.
`files.deleteMany` performs up to 2000 serial DB-plus-blob round-trips in a single request
(`files/controller.ts:139`).
Webhook raw-body detection uses `req.url.includes('/billing/webhook')` substring matching
(`fastify.server.ts:76-81`), so any path _containing_ that string skips JSON parsing.

**M14 — Minor authorization leaks.** `modules/userprofiles/trpc.router.ts:7` returns any tenant
user's full `profiles` row, including `preferences`, to any authenticated caller — viewers
included. `modules/exports/controller.ts:135` scopes export deletion by tenant but not by owner,
so any editor can delete another user's queued export.

---

## 6. Verified clean

Stated explicitly, because the absence of a finding above should be readable as a result rather
than as a gap in coverage.

**Sessions and credentials.** HS256 with `algorithms: ['HS256']` pinned on verify
(`lib/auth-util.ts:6-10`), which blocks algorithm-confusion and `none` attacks. 30-minute access
tokens; refresh tokens are opaque random values stored hashed, rotated on every use, with a
replay-detection grace window (`auth-tokens.ts:43-44`, `controller.ts:975-985`). Cookie flags
are correct — `httpOnly`, `secure`, `sameSite: 'lax'` (`auth-cookie.ts:58-64`). Argon2id at
64 MB / t=3 (`lib/password-hash.ts:3-8`) with a constant-time dummy-verify path that closes the
sign-in enumeration oracle (`controller.ts:1301-1320`).

**Revocation.** Re-checked at the middleware on **every** request, not merely at issue time
(`trpc.ts:190-204`, `lib/rest-auth.ts:85-98`). `role` is deliberately _not_ a signed JWT claim —
it is re-read from `authusers` per request (`trpc.ts:166-171`) — so role changes take effect
immediately. Sessions are destroyed on password reset, tenant pause, tenant delete, admin email
change, and user deletion.

**CSRF.** No exposure found. `renewAuthToken` is the only cookie-authenticated route and is a
POST mutation, which `SameSite=lax` blocks cross-site; CORS is pinned to a single origin with
values forced after the options spread (`fastify.server.ts:60`). Every other state-changing
surface requires a bearer header, and REST explicitly refuses query-string tokens
(`rest-auth.ts:42-49`). Both companion apps authenticate with an `X-Companion-Session` **header**,
not a cookie, so they are structurally CSRF-immune.

**SQL injection.** None. Every `sql.raw` call site resolves through a server-side `columnMapping`
allow-list (`lib/base.repo.ts:612-636`, `:704`) with values always bound as parameters; all
other `` sql`…${x}` `` uses are Kysely-parameterized bindings, not concatenation. _(Nit: the
allow-list lookup at `:704` is a raw property read, so `field: "constructor"` yields
`sql.raw(undefined)` — a 500, not an injection; `Object.prototype.hasOwnProperty.call` closes
it.)_

**Frontend XSS.** All sinks are sanitized. `libs/uxcommon/src/pipes/sanitize-html.pipe.ts` runs
DOMPurify with an explicit allow-list before `bypassSecurityTrustHtml`; the datagrid renderer
does the same (`datagrid.ts:1333`). The one raw `bypassSecurityTrustHtml`
(`template-thumb.ts:49`) is genuinely safe — bound only to `[srcdoc]` of a fully-restricted
`sandbox=""` iframe. `apps/companion` and `apps/website` have zero `innerHTML` or
`bypassSecurityTrust*` usage. CSP is tight: `script-src 'self'`, `object-src 'none'`,
`frame-ancestors 'none'`, HSTS 180d.

**Server-rendered HTML.** Every interpolation on the public form page, the donation page, the
unsubscribe pages, and the ops digest passes through a local `escapeHtml`. _(The email templates
are the exception — see C5.)_

**Webhooks.** All four verify signatures and **fail closed** when the secret is unset: Stripe
platform and Connect via `constructEvent`, SendGrid via ECDSA P-256 with a 10-minute freshness
window checked before verification, Postmark via `timingSafeEqual` on a shared token. Replay is
handled by unique constraints on `stripe_event_id` and `sg_event_id`.

**Money flow.** Plan and seat state is Stripe-derived on every real path — signature-verified
webhooks or a live `subscriptions.retrieve`, never client input. `selectFreePlan` correctly
refuses while a paid subscription is live. Donation currency is hardcoded, the destination
account is resolved from backend-written settings behind a fail-closed
`assertStripeConnectReady`, and the platform fee is computed server-side. _(The exception is
C3.)_

**Tenant isolation at the query layer.** The `no-unscoped-db-query` `ignoreTables` allow-list
(`authusers`, `sessions`, `tenants`) is sound — each is keyed by a globally-unique,
non-tenant-derived value — and all 11 `eslint-disable` sites in `apps/backend` are individually
justified (six are callback-form false positives with the scope inside the subquery; the rest
are credential lookups where the token _is_ the tenant proof). _(C1 is a blob-layer leak the
rule structurally cannot see, and C4 is a campaign-layer gap orthogonal to tenant scoping.)_

**Other.** Mailbox sync re-trigger is idempotent (checks for an existing pending job before
inserting). Geocoding is plan-gated with a 25,000/day per-tenant budget that counts the existing
backlog first. `trustProxy` refuses to boot in production when unset — which correctly prevents
every per-IP limit from collapsing into a single bucket. No self-hosted tracking pixel or click
redirect exists (delegated to SendGrid), and Twilio is outbound-only, so neither presents a
surface.

---

## 7. Suggested remediation order

**Before launch — cross-tenant and revenue integrity.**
C1 (blob IDOR), C2 (role escalation), C3 (plan self-grant). Each is a small, well-contained
change. C1 and C3 additionally warrant the structural fix, not just the patch: an opaque upload
handle for C1, and refuse-to-boot-on-missing-credential for C3 (which also resolves H5).

**Before opening to untrusted signups — abuse and cost control.**
C5 and C4 first — C5 puts the platform's sending reputation in an attacker's hands with no
attribution trail, and C4 breaks the campaign isolation the product promises. Then H1–H6.
H5 folds naturally into the C3 boot-assertion work.

**Tracked backlog — defense in depth.**
M1–M14. Two clusters are worth doing as single coordinated efforts rather than piecemeal:

- _Rate limiting_ (M1, M2, M3, M8, and the limiter half of H4): the current per-route,
  in-process, hand-rolled approach cannot hold under multiple replicas. A shared-store limiter
  plus a global default would retire most of these findings at once.
- _Email escaping_ (the escaping half of C5, plus M4): 47 templates share one fix and one
  helper that already exists.

---

## 8. Notes for maintainers

Several findings contradict invariants that project skills currently imply. Per the CLAUDE.md
stale-skill rule, these should get a "known gaps" note when the corresponding fix lands:

- **`pplcrm-sending-guards`** — reads as though it covers outbound email generally. It covers
  the SendGrid newsletter pipe only; the Postmark transactional pipe is ungated (C5).
- **`pplcrm-tenant-safety`** — correctly documents what the lint rule cannot catch, but neither
  the blob-key layer (C1) nor the campaign layer (C4) is in that list.
- **`pplcrm-campaigns`** — describes `options.campaignId` scoping without noting that omitting
  the option disables scoping entirely, and that by-id procedures are unscoped (C4).

Two related observations about the shape of these bugs, offered as a review heuristic rather
than as findings:

**Fail-open on missing credentials.** C3 and H5 are the same bug in different modules: an absent
secret silently selects a weaker mode instead of halting startup. `TRUST_PROXY` (`env.ts:162-177`)
already implements the correct pattern and is worth generalizing to every security-relevant
credential.

**Deny-lists where allow-lists belong.** C2 (`role === 'user'`), C4 (input-key scanning), and C1
(trusting a client key while scoping the row) all check for the _bad_ case rather than requiring
the _good_ one. In each, a correct sibling already exists in the same file or module —
`:1630` for C2, `sendTest` for C5, `getUploadUrl` for C1 — which suggests these are drift from an
understood standard rather than gaps in understanding.
