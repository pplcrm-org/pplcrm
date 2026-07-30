---
name: pplcrm-beta-approval
description: The closed-beta gate on new workspaces — signup succeeds but the tenant is held at approval_status='pending' until ops clicks an emailed approve/decline link, and every session-issuing path (password, 2FA, passkey) refuses until then. USE WHEN a user cannot sign in or sees "waiting for approval", when approving/declining a tenant, when touching signUp / signIn / verify2FA / verifyAuthentication, tenants.approval_status, the /api/tenant-approval route, or when a local dev signup will not let you in. EXAMPLES 'why is my new signup stuck', 'turn the beta gate off for dev', 'add another way to sign in'.
---

# The closed-beta approval gate

pplCRM is invitation-free but not open: anyone may sign up, and every new workspace is then
held until pplCRM ops approves it. This is a **tenant**-level gate, not a per-user one.

## The invariant

> An unapproved tenant never holds a session.

Enforcement is at session issuance, not per request. That is the one choke point all sign-in
paths already pass through, and refusing there means there is no token to leak and nothing to
revoke. Everything else about the workspace (the tenant row, the owner, the seed data, email
verification) is created normally while it waits.

## The pieces

| Thing                                     | Where                                                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Helpers, the assert, the token mint       | `apps/backend/src/app/modules/auth/tenant-approval.ts`                                                      |
| Shared user-facing copy + `reason` marker | `libs/common/src/lib/auth.ts` (`TENANT_PENDING_APPROVAL_*`)                                                 |
| Held at signup + ops mail                 | `modules/auth/controller.ts` → `signUp`, `createTenant`, `enqueueTenantApprovalRequest`                     |
| The three refusals                        | `controller.ts` → `signIn`, `verify2FA`; `passkey.controller.ts` → `verifyAuthentication`                   |
| Ops approve/decline page                  | `modules/auth/routes/tenant-approval.route.ts`, mounted at `/api/tenant-approval`                           |
| Columns                                   | `tenants.approval_status` / `approval_requested_at` / `approved_at` / `declined_at` / `approval_token_hash` |
| Waitlist UI                               | `apps/frontend/src/app/auth/signin-page/*` (the `approvalPending` panel)                                    |
| Dev/test opt-out                          | `AUTO_APPROVE_TENANTS=true` (set for the test run in `apps/backend/vite.config.ts`)                         |

## Adding a new way to sign in

**Call `assertTenantApprovedForSignIn(tenantId)` immediately before you mint tokens.** There
are three call sites today because there are three paths; a fourth that forgets is a silent
hole, and nothing else in the stack will catch it. Grep for `createTokens` and make sure every
caller that starts a new session is covered (session _rotation_ in `renewAuthToken` is not: an
unapproved tenant can never have obtained the session being rotated).

## Letting someone in

Normally ops clicks **Approve** in the signup email. The link is single-use and the token is
stored only as a SHA-256 hash, so there is no way to re-send the same link. To approve by hand:

```sql
UPDATE tenants
   SET approval_status = 'approved', approved_at = now(), approval_token_hash = NULL
 WHERE id = <n>;
```

The owner is emailed automatically only on the route path, so an SQL approval should be
followed by telling the customer yourself.

## Things that will bite you

- **`approval_status` DEFAULTs to `'pending'`.** That is deliberate: it is an access gate, so
  an insert that forgets to name a status must fail closed. Any new code path that creates a
  tenant must decide explicitly (see `initialApprovalStatus()`).
- **`'declined'` shows the user the same message as `'pending'`.** During a closed beta the
  honest answer to both is "not yet, we're full", and ops can still approve later. Do not add a
  distinct rejection message without deciding that is really the product you want.
- **GET on the ops link must never decide.** Outlook SafeLinks, antivirus scanners, and inbox
  previews issue GETs on every URL in an email; a GET that approved would let a mail scanner
  admit every signup. GET renders the two-button page, POST decides. The route spec pins this.
- **A decision only ever moves `pending` → decided.** `recordApprovalDecision` filters on
  `approval_status = 'pending'`, so a replayed link cannot flip an approved workspace back out
  of the product; it returns `false` and the page says "already decided".
- **Local dev will lock you out** of a workspace you just created unless you set
  `AUTO_APPROVE_TENANTS=true` before starting the backend. See the `verify` skill.
- **Invitees inherit their tenant's state.** Inviting someone into a pending workspace produces
  an account that also cannot sign in. That is correct, but it is a confusing support call.

## Related

`pplcrm-sending-guards` (the other signup-path controls: disposable email, plan gates),
`pplcrm-debugging` (tracing a refused sign-in), `verify` (driving a local signup past the gate).
