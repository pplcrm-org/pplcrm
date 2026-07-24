---
name: verify
description: 'How to drive the running pplCRM app end-to-end for verification — launch/attach to the dev servers, sign in with a throwaway tenant via Playwright, seed data through the UI or dev DB, and the traps (two-step signin, email verification, Vite error overlay). USE WHEN verifying a frontend/backend change against the real running app, writing a Playwright drive, or needing an authenticated session on localhost.'
---

# Verifying pplCRM against the running app

## Servers

Dev servers are usually already running: frontend `http://localhost:4200`, backend `:3000`.
Check with `lsof -nP -iTCP:4200 -iTCP:3000 -sTCP:LISTEN`. If not, `npm exec nx serve backend`
and `npm exec nx serve frontend`. HMR picks up edits — no restart needed after template changes.

## Playwright

No global install; import straight from the repo:

```js
import { chromium } from '<absolute-repo-root>/node_modules/@playwright/test/index.mjs';
```

**Trap — Vite error overlay:** any TS error anywhere in the watched workspace (including
another session's half-done backend edit) renders a `vite-error-overlay` that swallows
clicks. Strip it continuously:

```js
await page.addInitScript(() => {
  setInterval(() => document.querySelectorAll('vite-error-overlay').forEach((e) => e.remove()), 200);
});
```

## Auth: throwaway tenant

1. **Sign up** at `/signup`: placeholders "Your first name", "Organization name (or self)",
   "Enter your email", one password field; the submit button is **"JOIN"** (not "Sign up").
   **Trap — HIBP**: the live backend rejects any password seen in a breach corpus, so
   `StrongPassword123!`-style test passwords fail with "appeared in a known data breach".
   Use a unique per-run password (e.g. `Vf-${Date.now()}-Xq7!pplcrm`) and derive it from the
   same timestamp as the email so a later run can reconstruct it.
2. Signup lands on `/signin?verificationPending=true` — email verification blocks sign-in.
   Flip it in the dev DB (table is `authusers`, not `users`):
   ```bash
   psql -h localhost -U pplcrm_owner -d pplcrm \
     -c "UPDATE authusers SET verified = true WHERE email = '<the throwaway email>';"
   ```
   DB settings live in repo-root `.env.development` (`DB_NAME=pplcrm`, local trust auth).
   (Signup sometimes auto-signs-in straight to the dashboard instead — handle both.)
3. **Sign-in is two-step**: fill email → click **Continue** → password field appears →
   click **Sign in**. When the email is remembered, the password step shows immediately —
   check for an existing `input[type="password"]` before hunting for the email field.
   **Trap — passkey sign-in branch**: after **Continue**, the page may show a
   "Sign in with passkey" step instead of the password field — click **"Use password
   instead"** (ghost button) to get to it. Distinct from the post-sign-in **passkey upsell
   interstitial** (still on `/signin`) — dismiss that one with **"Skip for now"**.

**Trap — rate limits (per IP, in-memory)**: `signUp` allows **5/hour**, `signIn` **10/15min**
("Too many attempts" banner with a countdown). Failed attempts count, so don't burn signups
on retries — **reuse** the previous run's throwaway owner (reconstruct its password from its
timestamp) and only sign up when none exists.

**Trap — seat limit**: a fresh tenant is on the free plan = **1 seat**, so "Invite user" is
disabled (explained-disabled tooltip). To test invites, bump the throwaway tenant:
`UPDATE tenants SET subscription_plan = 'grassroots' WHERE id = <n>;` (3 seats;
'representative' = 10).

Clean up: `DELETE FROM tenants WHERE id=<n>` does **not** cascade everywhere
(`campaign_person_facts` FK blocks it). Leave the throwaway tenant and say so in the
report rather than hand-deleting child tables.

**Trap — sign-in rate limit:** `signIn` is capped at 10 per 15 min per IP
(`auth/trpc.router.ts`), and each drive script that signs in fresh burns one. After ~10
runs sign-in silently lands back on `/signin`. Sign in **once**, save session state with
`context.storageState({ path: 'state.json' })`, and start later scripts with
`browser.newContext({ storageState: 'state.json' })`.

## Driving a datagrid

- Row-select checkboxes are styled circles; the real `input[type=checkbox]` is hidden, so
  `.click()` fails with "not visible". Click by coordinates: `page.mouse.click(83, rowY)`
  where `rowY` comes from `getByText('<row name>').boundingBox()`.
- Toolbar buttons: `locator('button:has-text("Delete")')` matches hidden buttons elsewhere
  and times out — use `getByRole('button', { name: /Delete \d+ (person|people)/ })` and
  for the confirm dialog `getByRole('button', { name: 'Delete', exact: true })`.
- Grid delete shows a ConfirmDialog first; the toast fires after confirming.

## Seeding data

Prefer the UI (New person at `/people/add`, New task on `/tasks`). For records with no
quick create path (e.g. a **sent** newsletter for the report page), insert directly —
`newsletters` needs `tenant_id`, `campaign_id` (the tenant's office campaign),
`createdby_id`/`updatedby_id`, `name`; status default is 'sent'.

## Flows worth driving

- Detail pages: navbar crumb trail (first crumb = back), record pager "N of M" only after
  opening from a **datagrid** (tasks list is bespoke — no handoff, pager hidden by design).
- Not-found states: `/tasks/999999999`, `/newsletters/999999` — layout renders the alert;
  header action buttons must be gated on the record existing.
- Screenshots at 1440×900 into the session scratchpad.
