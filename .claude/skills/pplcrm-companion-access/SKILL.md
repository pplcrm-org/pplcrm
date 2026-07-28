---
name: pplcrm-companion-access
description: The volunteer access layer gating both companion apps (canvass /t/:token, deliveries /r/:token) — verify-a-code + once-per-volunteer admin approval + hashed device sessions, the requireSession() guard, the apps/companion gate component, Twilio SMS, and the admin Volunteer access page. USE WHEN touching modules/companion-access, companion_volunteers/companion_sessions/companion_ops tables, the /api/companion endpoints, the pc-companion-gate component, SMS sending, X-Companion-Session handling, or the /volunteer-access admin page. EXAMPLES 'why does the volunteer see a verify screen', 'revoke a volunteer', 'add another companion surface behind the gate', 'the code SMS never arrives'.
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

| Table                  | What it is                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `companion_volunteers` | One row per (tenant, person) ever sent a link. `status`: `invited` → `verified` (code confirmed, awaiting admin) → `approved` \| `revoked`. Carries the hashed verify code + attempt count. |
| `companion_sessions`   | A verified device. Only `sha256(token)` stored (`lib/token-hash.ts`); raw token returned once; 30-day expiry; `revoked_at` set for all rows on volunteer revoke.                            |
| `companion_ops`        | Write-once idempotency ledger for BOTH apps: PK `(tenant_id, op_id)`, `scope` 'canvass'/'deliveries'. Insert `ON CONFLICT DO NOTHING`; a conflict means "already applied".                  |

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

- `GET /access?kind=turf|route&token=…` (+ optional session header) → `{ state, … }`
  where state ∈ `dead | unassigned | need_verification | pending_approval | ready`
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

**The guard**: `CompanionAccessController.requireSession(sessionToken, {tenant_id,
volunteer_person_id})` — call it from any companion data endpoint after resolving the
capability token (see canvassing `getCompanionTurf` / deliveries `getPublicRoute`).
Throws `UnauthorizedError` (no/invalid/mismatched session → gate re-verifies) or
`ForbiddenError` (valid but unapproved). Let those status codes (401/403) reach the
client — the gate needs them to render the right state; keep uniform 404 for dead
tokens.

**The other direction**: `resolveSession(sessionToken)` answers "who is this?" with no
capability link at all, returning `{ tenant_id, volunteer_id, person_id, can_roam }`.
It exists because turf tokens are hashed and can never be handed back out, so a
volunteer switching turfs has no link to present — the session is the credential, and
an active `turf_assignments` row is the per-turf authorization on top of it. Same
refusals as the guard (`UnauthorizedError` for a dead session, `ForbiddenError` for
unapproved). **Add surfaces alongside `requireSession`, never by loosening it** — every
existing `/t/:token` and `/r/:token` caller depends on its link-first check.

`companion_volunteers.can_roam` (boolean, nullable) overrides the workspace
`app.canvass_volunteer_roam` setting for one person; null inherits. See
`pplcrm-canvassing` → "Session-first access, and roaming".

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
verification channel.

## Frontend

- **Gate component** (`apps/companion/src/app/gate/companion-gate.ts`): wrap any
  companion surface in `<pc-companion-gate kind="…" [token]="…">…</pc-companion-gate>`;
  content projects only when `ready`. `CompanionSessionService` (companion-api.ts)
  stores the session in localStorage (`pc-companion-session`) and `headers()` builds
  the `X-Companion-Session` header for data fetches.
- **Admin page** `/volunteer-access`
  (`apps/frontend/src/app/experiences/volunteer-access/`), a pc-table with
  Approve/Revoke; sidebar ADMIN entry with a pendingCount badge (loaded in
  `layout/sidebar/sidebar.ts` like the other badges).

## Traps

- The one intentionally un-tenant-scoped query here is
  `CompanionSessionsRepo.findByTokenHash` (the hashed token IS the credential) —
  same pattern and eslint-disable as `delivery_routes.findByTokenHash`.
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
