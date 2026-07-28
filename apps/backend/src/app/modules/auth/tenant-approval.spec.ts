import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthController } from './controller';
import { BaseRepository } from '../../lib/base.repo';
import { ForbiddenError } from '../../errors/app-errors';
import { TENANT_PENDING_APPROVAL_REASON } from '../../../../../../libs/common/src';
import { hashPassword } from '../../lib/password-hash';
import { hashToken } from '../../lib/token-hash';
import {
  assertTenantApprovedForSignIn,
  findTenantByApprovalToken,
  initialApprovalStatus,
  mintApprovalToken,
  recordApprovalDecision,
} from './tenant-approval';

/**
 * The closed-beta gate: a workspace exists but cannot be signed into until pplCRM ops
 * approves it.
 *
 * Rows are inserted directly rather than via `signUp` — a real signup seeds a whole demo
 * workspace and takes seconds, and none of that is what these assertions are about. The one
 * thing that must go through the real code path is `signIn`, since the point of the gate is
 * that it refuses to mint a session.
 */

vi.mock('../../lib/hibp', () => ({
  getPwnedCount: vi.fn().mockResolvedValue(0),
}));

const PASSWORD = 'Correct-Horse-Battery-42!';

const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

describe('tenant approval (closed-beta gate)', () => {
  const controller = new AuthController();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only access to the private db handle
  const db = (BaseRepository as any)._db;

  let tenantId: string;
  let userId: string;
  let email: string;

  /** A verified owner on a tenant in the given approval state. */
  async function seedTenant(
    approval: { status: 'pending' | 'approved' | 'declined'; tokenHash?: string | null } = { status: 'pending' },
  ): Promise<void> {
    await db
      .insertInto('tenants')
      .values({
        id: tenantId,
        name: `Approval Test Org ${tenantId}`,
        approval_status: approval.status,
        approval_requested_at: new Date(),
        approval_token_hash: approval.tokenHash ?? null,
        approved_at: approval.status === 'approved' ? new Date() : null,
        declined_at: approval.status === 'declined' ? new Date() : null,
      })
      .execute();

    await db
      .insertInto('authusers')
      .values({
        id: userId,
        tenant_id: tenantId,
        email,
        password: await hashPassword(PASSWORD),
        first_name: 'Casey',
        last_name: 'Owner',
        role: 'owner',
        verified: true,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    await db
      .updateTable('tenants')
      .set({ admin_id: userId, createdby_id: userId })
      .where('id', '=', tenantId)
      .execute();
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    tenantId = rand();
    userId = rand();
    email = `beta-${tenantId}@example.com`;
  });

  afterEach(async () => {
    await db.updateTable('tenants').set({ admin_id: null, createdby_id: null }).where('id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  // AUTO_APPROVE_TENANTS is set for the test run (see apps/backend/vite.config.ts), which is
  // why every other spec can still sign up and then sign in. Without it, new tenants are held.
  it('auto-approves new tenants only under the explicit opt-in', () => {
    expect(initialApprovalStatus()).toBe('approved');
  });

  it('stores only the hash of the ops token', () => {
    const { token, tokenHash } = mintApprovalToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(hashToken(token));
    expect(tokenHash).not.toBe(token);
  });

  it('refuses to issue a session while the workspace is pending', async () => {
    await seedTenant({ status: 'pending' });
    await expect(controller.signIn({ email, password: PASSWORD })).rejects.toThrow(ForbiddenError);
  });

  it('issues a session once the workspace is approved', async () => {
    await seedTenant({ status: 'approved' });
    const tokens = await controller.signIn({ email, password: PASSWORD });
    expect(tokens).toHaveProperty('auth_token');
    await db.deleteFrom('sessions').where('tenant_id', '=', tenantId).execute();
  });

  // A decline is an ops decision, not a different user experience: same block, same message.
  it('blocks a declined workspace exactly as it blocks a pending one', async () => {
    await seedTenant({ status: 'declined' });
    await expect(controller.signIn({ email, password: PASSWORD })).rejects.toThrow(ForbiddenError);
  });

  it('marks the 403 with a reason the sign-in page can branch on', async () => {
    await seedTenant({ status: 'pending' });
    await expect(assertTenantApprovedForSignIn(tenantId)).rejects.toMatchObject({
      status: 403,
      data: { reason: TENANT_PENDING_APPROVAL_REASON },
    });
  });

  // Fails closed: "I could not find out" is not a yes.
  it('refuses a null or unknown tenant', async () => {
    await expect(assertTenantApprovedForSignIn(null)).rejects.toThrow(ForbiddenError);
    await expect(assertTenantApprovedForSignIn(rand())).rejects.toThrow(ForbiddenError);
  });

  it('resolves an ops link to its tenant and owner, and rejects an unknown token', async () => {
    const { token, tokenHash } = mintApprovalToken();
    await seedTenant({ status: 'pending', tokenHash });

    expect(await findTenantByApprovalToken(token)).toMatchObject({
      tenantId,
      tenantName: `Approval Test Org ${tenantId}`,
      status: 'pending',
      ownerEmail: email,
      ownerFirstName: 'Casey',
    });

    expect(await findTenantByApprovalToken(mintApprovalToken().token)).toBeNull();
    expect(await findTenantByApprovalToken('')).toBeNull();
  });

  it('spends the token on decision, so a replayed link cannot decide twice', async () => {
    const { token, tokenHash } = mintApprovalToken();
    await seedTenant({ status: 'pending', tokenHash });

    expect(await recordApprovalDecision(tenantId, 'approved')).toBe(true);
    // The link is dead the moment it is used...
    expect(await findTenantByApprovalToken(token)).toBeNull();
    // ...and a second decision cannot flip an approved workspace back out of the product.
    expect(await recordApprovalDecision(tenantId, 'declined')).toBe(false);

    const tenant = await db
      .selectFrom('tenants')
      .select(['approval_status', 'approved_at', 'approval_token_hash'])
      .where('id', '=', tenantId)
      .executeTakeFirstOrThrow();
    expect(tenant.approval_status).toBe('approved');
    expect(tenant.approved_at).not.toBeNull();
    expect(tenant.approval_token_hash).toBeNull();
  });

  it('records a decline without opening the workspace', async () => {
    const { tokenHash } = mintApprovalToken();
    await seedTenant({ status: 'pending', tokenHash });

    expect(await recordApprovalDecision(tenantId, 'declined')).toBe(true);
    await expect(controller.signIn({ email, password: PASSWORD })).rejects.toThrow(ForbiddenError);
  });
});
