import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';
import type { FastifyRequest } from 'fastify';

/**
 * The workspace API key must be stored and looked up by SHA-256 hash, never plaintext
 * (SECURITY-REVIEW.md 2.4) — this is the single key mechanism behind the public
 * submission endpoints, the Zapier inbound routes, and the API Keys settings page.
 */
const mocks = vi.hoisted(() => ({
  getByKeyHash: vi.fn(),
  updateLastUsed: vi.fn(),
  tenantPlan: vi.fn(),
}));

vi.mock('../modules/settings/repositories/workspace-api-keys.repo', () => ({
  WorkspaceApiKeysRepo: class {
    getByKeyHash = mocks.getByKeyHash;
    updateLastUsed = mocks.updateLastUsed;
  },
}));

// The plan gate reads tenants.subscription_plan through the shared Kysely instance. Stubbing the
// builder chain keeps this file a pure unit test — the enforcement itself is covered end-to-end in
// the settings controller spec.
vi.mock('./base.repo', () => ({
  BaseRepository: {
    dbInstance: {
      selectFrom: () => ({
        select: () => ({
          where: () => ({ executeTakeFirst: () => mocks.tenantPlan() }),
        }),
      }),
    },
  },
}));

import { generateApiKey, hashApiKey } from './api-key';
import { lookupTenantByApiKey, tenantIdFromOptionalApiKey } from './validate-api-key';

function reqWithAuth(authorization?: string): FastifyRequest {
  return { headers: authorization ? { authorization } : {} } as FastifyRequest;
}

describe('workspace API key lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateLastUsed.mockResolvedValue(undefined);
    mocks.tenantPlan.mockResolvedValue({ subscription_plan: 'grassroots' });
  });

  it('generates ws_-prefixed high-entropy keys', () => {
    const key = generateApiKey();
    expect(key).toMatch(/^ws_/);
    expect(key.length).toBeGreaterThan(40);
    expect(generateApiKey()).not.toBe(key);
  });

  it('looks up by hash (never plaintext) and stamps last_used_at on a hit', async () => {
    const key = generateApiKey();
    mocks.getByKeyHash.mockResolvedValue({ id: '9', tenant_id: '42' });

    const tenant = await lookupTenantByApiKey(key);

    expect(tenant).toBe('42');
    expect(mocks.getByKeyHash).toHaveBeenCalledWith(hashApiKey(key));
    expect(mocks.getByKeyHash).not.toHaveBeenCalledWith(key);
    expect(mocks.updateLastUsed).toHaveBeenCalledWith('42', '9');
  });

  it('returns null for an unknown key without touching last_used_at', async () => {
    mocks.getByKeyHash.mockResolvedValue(undefined);

    expect(await lookupTenantByApiKey('ws_unknown')).toBeNull();
    expect(mocks.updateLastUsed).not.toHaveBeenCalled();
  });

  describe('tenantIdFromOptionalApiKey', () => {
    it('returns null when no Authorization header is present (anonymous browser path)', async () => {
      expect(await tenantIdFromOptionalApiKey(reqWithAuth())).toBeNull();
      expect(mocks.getByKeyHash).not.toHaveBeenCalled();
    });

    it('resolves the tenant for a valid Bearer key', async () => {
      mocks.getByKeyHash.mockResolvedValue({ id: '1', tenant_id: '7' });
      expect(await tenantIdFromOptionalApiKey(reqWithAuth('Bearer ws_good'))).toBe('7');
    });

    it('throws UNAUTHORIZED for an unknown key — a misconfigured integration must fail loudly', async () => {
      mocks.getByKeyHash.mockResolvedValue(undefined);
      await expect(tenantIdFromOptionalApiKey(reqWithAuth('Bearer ws_bad'))).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('throws UNAUTHORIZED for a malformed Authorization header', async () => {
      await expect(tenantIdFromOptionalApiKey(reqWithAuth('Bearer   '))).rejects.toBeInstanceOf(TRPCError);
      expect(mocks.getByKeyHash).not.toHaveBeenCalled();
    });
  });

  describe('plan gate (GATED_FEATURES.api)', () => {
    it('stops resolving a real key once the tenant drops to Free', async () => {
      const key = generateApiKey();
      mocks.getByKeyHash.mockResolvedValue({ id: '9', tenant_id: '42' });
      mocks.tenantPlan.mockResolvedValue({ subscription_plan: 'free' });

      // Gating only key ISSUANCE would leave every already-issued key working forever, so a
      // downgrade would not actually revoke API access — this is the check that makes it real.
      expect(await lookupTenantByApiKey(key)).toBeNull();
      expect(mocks.updateLastUsed).not.toHaveBeenCalled();
    });

    it('reports a plan miss as a plain invalid key, never as billing status', async () => {
      mocks.getByKeyHash.mockResolvedValue({ id: '9', tenant_id: '42' });
      mocks.tenantPlan.mockResolvedValue({ subscription_plan: 'free' });

      // The caller is unauthenticated; "this workspace is on the free plan" would leak a
      // tenant's billing status to anyone holding a stale key.
      await expect(tenantIdFromOptionalApiKey(reqWithAuth('Bearer ws_downgraded'))).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        message: 'Invalid API key.',
      });
    });
  });
});
