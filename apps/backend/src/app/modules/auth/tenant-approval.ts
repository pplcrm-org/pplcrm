import { TENANT_PENDING_APPROVAL_MESSAGE, TENANT_PENDING_APPROVAL_REASON } from '@common';

import { BaseRepository } from '../../lib/base.repo';
import { ForbiddenError } from '../../errors/app-errors';
import { env } from '../../../env';
import { generateToken, hashToken } from '../../lib/token-hash';

/**
 * The closed-beta gate.
 *
 * Signing up creates the whole workspace as usual — tenant, owner, seed data, verification
 * email — but leaves `tenants.approval_status = 'pending'`. pplCRM ops gets a mail with a
 * one-click approve/decline link (routes/tenant-approval.route.ts); until it is approved,
 * every path that mints a session refuses.
 *
 * Enforced at session issuance rather than per-request because that is the one choke point
 * all three sign-in paths (password, 2FA, passkey) already pass through, and refusing there
 * means an unapproved workspace never holds a token at all — there is nothing to leak and
 * nothing to revoke.
 *
 * The tenants table is on the tenant-safety allow-list: these lookups are keyed by the
 * tenant's own id (or by an unguessable token that names exactly one tenant), which is the
 * documented exception, not an unscoped query. See pplcrm-tenant-safety.
 */

/** `tenants.approval_status`. 'declined' is an ops decision, not a different user message. */
export type TenantApprovalStatus = 'pending' | 'approved' | 'declined';

/** What signUp decides once and threads into the tenant insert and the ops mail. */
export interface NewTenantApproval {
  status: TenantApprovalStatus;
  token: string;
  tokenHash: string;
}

const db = new BaseRepository('tenants').db;

/**
 * The status a newly created tenant starts in.
 *
 * Fails closed: only an explicit `AUTO_APPROVE_TENANTS=true` (local dev and the test suite,
 * where nobody is around to click the ops link) skips the queue.
 */
export function initialApprovalStatus(): TenantApprovalStatus {
  return env.autoApproveTenants ? 'approved' : 'pending';
}

/**
 * Mint the single-use secret behind the ops approve/decline links. Only the hash is stored,
 * so a database leak yields no working link.
 */
export function mintApprovalToken(): { token: string; tokenHash: string } {
  const token = generateToken();
  return { token, tokenHash: hashToken(token) };
}

/**
 * Refuse to issue a session for a workspace that has not been let into the beta.
 *
 * Call this on every path that mints tokens, immediately before it does. Throws the shared
 * 403 carrying `reason: TENANT_PENDING_APPROVAL` so the sign-in page can show the waitlist
 * panel rather than a bare toast.
 *
 * A missing tenant row is treated as not-approved: this is a gate, and the only safe answer
 * to "I could not find out" is no.
 */
export async function assertTenantApprovedForSignIn(tenantId: string | null | undefined): Promise<void> {
  if (tenantId == null) {
    throw new ForbiddenError(TENANT_PENDING_APPROVAL_MESSAGE, { reason: TENANT_PENDING_APPROVAL_REASON });
  }

  const tenant = await db.selectFrom('tenants').select('approval_status').where('id', '=', tenantId).executeTakeFirst();

  if (tenant?.approval_status !== 'approved') {
    throw new ForbiddenError(TENANT_PENDING_APPROVAL_MESSAGE, { reason: TENANT_PENDING_APPROVAL_REASON });
  }
}

/** Both ops decisions, and the "no decision yet" state the pending link still resolves to. */
export interface ApprovalDecisionTarget {
  tenantId: string;
  tenantName: string;
  status: TenantApprovalStatus;
  ownerEmail: string | null;
  ownerFirstName: string | null;
}

/**
 * Resolve an ops link's token to the tenant it was minted for.
 *
 * The token is the entire authentication for that route, so it is compared as a hash and
 * names exactly one tenant. Returns null for anything unknown — including a token that was
 * already spent, since the hash is cleared once ops decides.
 */
export async function findTenantByApprovalToken(token: string): Promise<ApprovalDecisionTarget | null> {
  if (!token) return null;

  const row = await db
    .selectFrom('tenants')
    .leftJoin('authusers', 'authusers.id', 'tenants.admin_id')
    .select([
      'tenants.id as id',
      'tenants.name as name',
      'tenants.approval_status as approval_status',
      'authusers.email as owner_email',
      'authusers.first_name as owner_first_name',
    ])
    .where('tenants.approval_token_hash', '=', hashToken(token))
    .executeTakeFirst();

  if (!row) return null;

  return {
    tenantId: String(row.id),
    tenantName: row.name,
    status: row.approval_status,
    ownerEmail: row.owner_email,
    ownerFirstName: row.owner_first_name,
  };
}

/**
 * Record an ops decision and spend the token.
 *
 * The token hash is cleared either way, which is what makes the link single-use: a second
 * click (or a mail scanner replaying it) resolves to nothing rather than re-deciding.
 * Returns false when the row moved underneath us — the caller reports "already decided"
 * instead of claiming a change it did not make.
 */
export async function recordApprovalDecision(tenantId: string, decision: 'approved' | 'declined'): Promise<boolean> {
  const now = new Date();
  const result = await db
    .updateTable('tenants')
    .set({
      approval_status: decision,
      approval_token_hash: null,
      approved_at: decision === 'approved' ? now : null,
      declined_at: decision === 'declined' ? now : null,
    })
    .where('id', '=', tenantId)
    // Only a still-pending tenant may be decided, so a replayed link cannot flip an
    // approved workspace back out of the product.
    .where('approval_status', '=', 'pending')
    .executeTakeFirst();

  return Number(result.numUpdatedRows ?? 0) > 0;
}
