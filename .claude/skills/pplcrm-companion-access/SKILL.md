---
name: pplcrm-companion-access
description: The volunteer access layer gating both companion apps (canvass /t/:token, deliveries /r/:token) — verify-a-code + once-per-volunteer admin approval + hashed device sessions, the requireSession() guard, QR join codes (/j/:code), and approve-by-text (/a/:token). USE WHEN touching modules/companion-access, companion_volunteers / companion_sessions / companion_ops / campaign_join_codes / companion_approval_tokens, the /api/companion endpoints, the pc-companion-gate component, Twilio SMS, X-Companion-Session handling, or the /volunteer-access admin page. EXAMPLES 'why does the volunteer see a verify screen', 'add a volunteer who is not in the CRM', 'the approve-by-text link is dead', 'the code SMS never arrives'.
---

# Companion access layer (COMPANION-APPS-PLAN.md §2/§4)

A companion capability link is not enough on its own. Two credentials ride every
companion data request:

- the **capability token** (in the URL: `/t/:token` turf, `/r/:token` route) says
  **WHAT** may be touched — one turf or one route; it also resolves the tenant;
- the **device session** (`X-Companion-Session` header) says **WHO** is touching it —
  a volunteer who verified a one-time code sent to their email/SMS on file AND has
  been approved once by an admin.

## Data model

The companion tables live in the squashed baseline (`_migrations/schema.sql`), not in a
dated migration — the old `2026-07-12-companion-apps.ts` no longer exists. New columns
need a new dated file (see `pplcrm-migrations`).

| Table                        | What it is                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `companion_volunteers`       | One row per (tenant, person) ever sent a link. `status`: `invited` → `verified` (code confirmed, awaiting admin) → `approved` \| `revoked`. Carries the hashed verify code + attempt count.                                                                                                                                                                                                               |
| `companion_sessions`         | A verified device. Only `sha256(token)` stored (`lib/token-hash.ts`); raw token returned once; 30-day expiry; `revoked_at` set for all rows on volunteer revoke.                                                                                                                                                                                                                                          |
| `companion_ops`              | Write-once idempotency ledger for BOTH apps: PK `(tenant_id, op_id)`, `scope` 'canvass'/'deliveries'. Insert `ON CONFLICT DO NOTHING`; a conflict means "already applied".                                                                                                                                                                                                                                |
| `campaign_join_codes`        | A shareable QR/typeable code that puts a **stranger** into this gate. `code` is 8 Crockford-ish chars (no 0/O/1/I) and UNIQUE **globally** — a scan has no tenant context, so the code resolves it. `turf_id` set = everyone who scans lands on that turf; null = they land on the turf picker. `status`/`expires_at`/`max_uses`/`use_count` bound it. Migration `2026-07-28-zz-companion-join-codes.ts`. |
| `companion_approval_tokens`  | One-tap "approve this volunteer" links, minted **per admin** so `approved_by` records who actually tapped. sha256 only, 72-hour TTL, single use (`markUsedForVolunteer` burns every outstanding row for that volunteer once anyone decides).                                                                                                                                                              |
| `companion_organizer_tokens` | The credential behind `/o/:token`, the organizer's launch page. sha256 only, 12-hour TTL, **multi-use but scoped to ONE `join_code_id`** — it can approve the people who scanned that poster and nothing else in the workspace. `revoked_at` set by `revokeForJoinCode` whenever the code is rotated or revoked. Migration `2026-07-28-zzz-street-claims-organizer.ts`.                                   |

`companion_volunteers` also carries the QR-join handshake: `join_claim_hash` +
`join_claim_expires_at` (30 min, one live claim per person — a second scan replaces the
first) and `join_code_id` (provenance, kept after the claim is burned).

Assignments carry the volunteer identity: `turf_assignments.volunteer_person_id`
(+ `expires_at`) and `delivery_routes.volunteer_person_id`. An assignment without a
person yields the gate's `unassigned` state — staff must (re)assign.

**Assignment auto-sends the link**: both `assignTurf` (canvassing) and
`assignVolunteer` (deliveries) enqueue the volunteer's personal `/t/` / `/r/` URL
by email and/or SMS via `lib/mail/volunteer-link-notify.ts` inside the assignment
transaction (URL base `env.companionUrl` / `COMPANION_URL`; prod
`https://go.pplcrm.com`), returning `sent: { email, sms }` so the UI can warn when
the person has no contacts on file.

## Backend (`apps/backend/src/app/modules/companion-access/`)

Public REST at `/api/companion` (`routes/companion-public.route.ts`, per-IP limited):

- `GET /access?kind=turf|route|join|session[&token=…]` (+ optional session header) →
  `{ state, … }` where state ∈
  `dead | unassigned | need_identity | need_verification | pending_approval | ready`
  (`CompanionAccessPayload` in `libs/common/.../companion-access.schema.ts`). Errors
  return a uniform `{state:'dead'}` — never leak why a link failed. Contacts are only
  ever masked (`maskEmail`/`maskPhone` in `lib/sms/phone.ts`).
- `POST /verify/start {kind, token, channel}` — 6-digit code, hashed at rest, 10-min
  TTL, 3 sends/15 min/token (`checkRateLimit`), delivered via the transactional
  outbox: `enqueueMail` or `enqueueSms` inside the same transaction as the code write.
- `POST /verify/confirm {kind, token, code}` — 5 wrong attempts kills the code;
  success mints the session (raw token returned once) and, on first verification,
  emails every tenant admin/owner. The session is minted even while
  `pending_approval` — it is simply unusable until approval, so the gate just polls
  `GET /access` until `ready`; the volunteer never re-enters a code.
- `POST /join/start {code, first_name, last_name?, email? | mobile?}` → `{masked,
channel, claim}` — the QR path. See below.
- `GET|POST /approve/:token` — approve-by-text. GET says who is asking; POST carries
  `{decision: 'approve'|'decline'}` and delegates to the same `approveVolunteer` /
  `revokeVolunteer` the CRM calls, so logging, session revocation and the join-code
  turf placement never fork.

**Two of the four `kind`s are not capability links.** `join` names an ORGANIZATION, not
a person, so it grants nothing on its own; `session` carries no token at all (the
device session is the whole credential) and is what the companion's `/canvass` route
uses. `COMPANION_LINK_KINDS` still means just `turf|route`; the wider set is
`COMPANION_ACCESS_KINDS`, and `COMPANION_VERIFY_KINDS` (`turf|route|join`) is what can
send + confirm a code.

### The QR join path (`/j/:code`)

The only public endpoint that writes into `persons`. `joinStart`, in one transaction:
per-IP burst limit -> durable per-code daily ceiling -> `bumpUseCount` **first** (the
`max_uses` guard is in the UPDATE's own WHERE, so two simultaneous scans of the last
slot cannot both win) -> match an existing person by normalized email or by
raw-or-E.164 mobile -> else create them in `tenants.placeholder_household_id` with
`volunteer_status='prospective'` -> `ensureForPerson` -> `setVerifyCode` ->
`setJoinClaim` -> enqueue the code.

Every refusal — unknown code, revoked, expired, exhausted, suspended tenant,
previously-revoked volunteer — answers with the **single** `JOIN_REFUSAL` message.
Distinguishing them would make this an oracle for which codes exist and who is already
in the database. (Response _shape_ is identical whether or not the person existed; the
amount of work differs by one INSERT, an accepted timing residual documented in the
controller.)

`verifyStart`/`verifyConfirm` with `kind='join'` take the **claim**, not the code —
`resolveVerifySubject` is the seam. Confirming burns the claim so a screenshotted QR
cannot be replayed. A turf-scoped code places the volunteer on its turf at
**approval** time (`placeOnJoinCodeTurf` inside `approveVolunteer`), never at scan
time — a declined stranger must never have held an assignment.

**The guard**: `CompanionAccessController.requireSession(sessionToken, {tenant_id,
volunteer_person_id})` — call it from any companion data endpoint after resolving the
capability token (see canvassing `getCompanionTurf` / deliveries `getPublicRoute`).
Throws `UnauthorizedError` (no/invalid/mismatched session → gate re-verifies) or
`ForbiddenError` (valid but unapproved). Let those status codes (401/403) reach the
client — the gate needs them to render the right state; keep uniform 404 for dead
tokens.

**The other direction**: `resolveSession(sessionToken)` answers "who is this?" with no
capability link at all, returning
`{ tenant_id, volunteer_id, person_id, can_roam, join_campaign_id }` (the last one is the
campaign their join code named, provenance a roaming volunteer with no assignment yet is
scoped to — see `pplcrm-canvassing` → `roamableCampaigns()`).
It exists because turf tokens are hashed and can never be handed back out, so a
volunteer switching turfs has no link to present — the session is the credential, and
an active `turf_assignments` row is the per-turf authorization on top of it. Same
refusals as the guard (`UnauthorizedError` for a dead session, `ForbiddenError` for
unapproved). **Add surfaces alongside `requireSession`, never by loosening it** — every
existing `/t/:token` and `/r/:token` caller depends on its link-first check.

`companion_volunteers.can_roam` (boolean, nullable) overrides the workspace
`app.canvass_volunteer_roam` setting for one person; null inherits. See
`pplcrm-canvassing` → "Session-first access, and roaming".

### The organizer's launch page (`/o/:token`)

At a real launch the organizer is standing next to the people signing up, so texting an
approval link per person is a worse version of a list they could look at. `/o/:token` is
that list: the join QR (full-screenable), the typeable code, and everyone who scanned it
with **Approve** inline. It polls at the gate's 20 s cadence.

Minted by `joinCodes.sendToMyPhone` (admin/owner), which texts **the caller's own
`profiles.mobile`** — never a typed destination, because this credential can approve
volunteers. No mobile on file returns `{status:'no_mobile'}` rather than throwing; the
panel narrates "add one to your profile" (§3, guide don't error).

`profiles.mobile` is set by the user themselves on the **Profile page** (`experiences/profile`,
the `mobile` key on `UpdateAuthUserObj` → `AuthController.syncProfile`). It is stored
E.164-normalized and `updateUser` refuses a number `normalizeE164` can't reach — so anything
in that column is textable, and the two SMS senders never have to re-validate it.

Containment, all three deliberate: scoped to one `join_code_id` (`decideOnOrganizerPage`
refuses a `volunteer_id` whose `join_code_id` doesn't match — guessing ids widens
nothing), 12-hour TTL, and `resolveOrganizerToken` refuses once the code is no longer
`active`, so **rotating the poster kills the phone link with it**. Decisions delegate to
the same `approveVolunteer`/`revokeVolunteer` every other surface calls, acting as the
admin who minted the link.

Admin tRPC (`joinCodes` router): `getForCampaign`, `qr` (returns `{code, url, matrix}`
— a module matrix, **never** a rendered image) as `authProcedure`; `create`, `update`,
`rotate`, `revoke`, `sendToMyPhone` as admin/owner + `planFeatureGate('companions')`.
Rotating kills whatever is printed on the poster, which is why the UI confirms first.

Admin tRPC (`companionAccess` router): `getAll`, `pendingCount`, `approve(id)`,
`revoke(id)`, `setRoam(id, can_roam)` (admin/owner only; revoke cascades to every session). Mutations are
plan-gated via `planFeatureGate('companions')` — Movement-only, matching the two
companion surfaces (turf assignments and delivery routes are both Movement-gated, so
approvals below Movement would be a dead end); reads stay open. Staff-side volunteer
management (teams, volunteer-events) is a separate `volunteers` gate at Grassroots.

## SMS (`apps/backend/src/app/lib/sms/`)

`SmsService` mirrors `TransactionalEmailService`: plain HTTP to Twilio, a
`[TWILIO DEV MOCK]` log line when `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/
`TWILIO_FROM_NUMBER` are unset (dev and tests never need an account), and
`enqueueSms()` → `background_jobs` type `send-sms` for the outbox. `normalizeE164()`
is the gatekeeper — a mobile that can't be normalized simply isn't offered as a
verification channel. It lives in `@common` (`libs/common/src/lib/phone.ts`) and is
re-exported from `lib/sms/phone` for every backend caller, so the Profile page's mobile
field rejects an un-textable number with the exact rule the sender applies.

**Approve-by-text** rides on `notifyAdminsOfPendingVolunteer`, which fires from
`verifyConfirm` for BOTH front doors (assignment link and QR join) — extending it once
is why approve-by-text needed no second code path. It mints a token per admin/owner,
then texts **only the inviter** (`link.organizer_id`: the assignment's or the join
code's `createdby_id`), and only when `companion_approval_sms` is on (opt-out, like every
other preference) and `profiles.mobile` normalizes. That key is the only SMS preference
and has no `_in_app` twin — see `pplcrm-notifications`. An inviter who isn't an admin gets
no token and no text, which is correct: they couldn't approve anyway.

## Frontend

- **Gate component** (`apps/companion/src/app/gate/companion-gate.ts`): wrap any
  companion surface in `<pc-companion-gate kind="…" [token]="…">…</pc-companion-gate>`;
  content projects only when `ready`. `CompanionSessionService` (companion-api.ts)
  stores the session in localStorage (`pc-companion-session`) and `headers()` builds
  the `X-Companion-Session` header for data fetches. The gate owns the whole
  who-are-you state machine including the QR-join identity form — **do not fork it**;
  `JoinPage` (`/j/:code`) is a ~30-line wrapper for exactly that reason. `token` is
  optional (absent for `kind='session'`), and `verifyToken` is the internal swap that
  puts the join claim in the credential slot.
- **Companion routes** (`app.routes.ts`): `/` (`HomePage` — type-your-join-code),
  `/t/:token`, `/r/:token`, `/j/:code` (QR join), `/a/:token` (`ApprovePage` —
  approve-by-text, deliberately in the companion app so an SMS opens a thumb-sized page
  with no sign-in), and `/canvass` (session-first; no URL credential at all).
  `/canvass` exists because turf tokens are hashed: once someone joins by QR there is
  no `/t/:token` to hand them. The **root must stay a real page**: the CRM's join card
  prints "Can't scan? Enter this code at `<host>`", so letting `/` fall through to the
  `**` dead-link catch-all makes the app call its own printed instructions dead.
  `HomePage` normalizes to `JOIN_CODE_ALPHABET`, pre-checks the code with
  `getAccess('join', code)` so a typo stays an inline correction, then routes to
  `/j/:code`.
- **Admin page** `/volunteer-access`
  (`apps/frontend/src/app/experiences/volunteer-access/`), a pc-table with
  Approve/Revoke; sidebar ADMIN entry with a pendingCount badge (loaded in
  `layout/sidebar/sidebar.ts` like the other badges).

## Traps

- The intentionally un-tenant-scoped queries here are
  `CompanionSessionsRepo.findByTokenHash`, `JoinCodesRepo.resolveByCode`,
  `ApprovalTokensRepo.resolveByToken` and
  `CompanionVolunteersRepo.findByJoinClaim` — in every case the token/code IS the
  credential and is what resolves the tenant. Same pattern as
  `delivery_routes.findByTokenHash`; listed in `pplcrm-tenant-safety`.
- Verification codes and sessions store **hashes only**; if you ever need to show a
  token again, you can't — mint a new one.
- Rate limiting is in-process (SECURITY-REVIEW §4.1 caveat applies).
- `resolveLink`'s route branch enforces the delivery link's 30-day expiry only
  while the Workspace → App policy allows (`app.volunteer_links_expire`, default
  ON — `lib/volunteer-link-policy.ts`); keep it in lockstep with
  `DeliveriesController.isTokenUsable` or the gate and the data endpoint will
  disagree about whether a link is dead. Turf `expires_at` is unaffected
  (per-assignment, staff-set).
- Tests: fabricate an approved volunteer + session directly (see
  `mintApprovedSession` in `canvassing/controller.spec.ts`) instead of driving the
  whole verify journey; that journey is covered once in
  `companion-access/controller.spec.ts`.
