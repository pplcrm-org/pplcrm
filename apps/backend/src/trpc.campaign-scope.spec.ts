import { vi, describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { authProcedure, router } from './trpc';
import { BaseRepository } from './app/lib/base.repo';
import { pinnedCampaignId } from './app/lib/tenant-context';

/**
 * Campaigns §15 scope enforcement (finding C4).
 *
 * Two failure modes are covered here, both of which were live:
 *
 *  1. Scoping was opt-in from the client. `campaignScope()` returned null when the
 *     request carried no `campaignId`, so a pinned Editor who simply omitted it read
 *     every campaign in the tenant. The pin is now server-derived and always applied.
 *  2. The input guard only ran for roles literally equal to 'user' or 'viewer', so a
 *     null-role account (reachable via invite — see C2) escaped it entirely.
 *
 * There was previously no spec anywhere for this middleware.
 */

const OFFICE_CAMPAIGN_ID = '900';
const ASSIGNED_CAMPAIGN_ID = '100';
const OTHER_CAMPAIGN_ID = '200';

interface DbUser {
  role: string | null;
  campaign_id: string | null;
}

/**
 * Stand in for the three lookups `isAuthed` performs: the caller's authusers row,
 * their session, and (for unassigned callers) the tenant's office campaign.
 */
function mockDb(user: DbUser): void {
  const qb = (result: unknown): Record<string, unknown> => {
    const builder: Record<string, unknown> = {
      select: vi.fn(() => builder),
      where: vi.fn(() => builder),
      executeTakeFirst: vi.fn().mockResolvedValue(result),
    };
    return builder;
  };

  vi.spyOn(BaseRepository, 'dbInstance', 'get').mockReturnValue({
    selectFrom: vi.fn((table: string) => {
      if (table === 'authusers') return qb({ ...user, verified: true });
      if (table === 'sessions') return qb({ id: 's1', expires_at: null });
      if (table === 'campaigns') return qb({ id: OFFICE_CAMPAIGN_ID });
      return qb(undefined);
    }),
  } as never);
}

/** Reports the pin that was in force when the procedure body ran. */
const TestRouter = router({
  probe: authProcedure.input(z.any().optional()).query(() => ({ pinned: pinnedCampaignId() })),
});

const AUTH = { tenant_id: '10', user_id: '20', session_id: 's1' };
const call = (input?: unknown): Promise<{ pinned: string | null }> =>
  TestRouter.createCaller({ auth: AUTH } as never).probe(input);

describe('isAuthed campaign scoping', () => {
  beforeEach(() => vi.restoreAllMocks());

  describe('pins the caller to their assigned campaign', () => {
    it.each([['user'], ['viewer'], [null]])('role %s is pinned even with no campaign in the input', async (role) => {
      mockDb({ role, campaign_id: ASSIGNED_CAMPAIGN_ID });

      // The request names no campaign at all — this is the case that used to
      // disable scoping and expose every campaign in the tenant.
      await expect(call({})).resolves.toEqual({ pinned: ASSIGNED_CAMPAIGN_ID });
    });

    it('falls back to the office campaign when the caller has no assignment', async () => {
      mockDb({ role: 'user', campaign_id: null });
      await expect(call({})).resolves.toEqual({ pinned: OFFICE_CAMPAIGN_ID });
    });

    it('leaves admins and owners unpinned so they can work across campaigns', async () => {
      for (const role of ['admin', 'owner']) {
        mockDb({ role, campaign_id: ASSIGNED_CAMPAIGN_ID });
        await expect(call({})).resolves.toEqual({ pinned: null });
      }
    });
  });

  describe('refuses a campaign id that disagrees with the pin', () => {
    it.each([['user'], ['viewer'], [null]])('role %s cannot name another campaign', async (role) => {
      mockDb({ role, campaign_id: ASSIGNED_CAMPAIGN_ID });

      await expect(call({ campaignId: OTHER_CAMPAIGN_ID })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(call({ campaign_id: OTHER_CAMPAIGN_ID })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('allows naming the campaign the caller is actually pinned to', async () => {
      mockDb({ role: 'user', campaign_id: ASSIGNED_CAMPAIGN_ID });
      await expect(call({ campaignId: ASSIGNED_CAMPAIGN_ID })).resolves.toEqual({ pinned: ASSIGNED_CAMPAIGN_ID });
    });

    it('finds a campaign id nested inside the input', async () => {
      mockDb({ role: 'user', campaign_id: ASSIGNED_CAMPAIGN_ID });
      await expect(call({ options: { campaignId: OTHER_CAMPAIGN_ID } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  // The guard reads getRawInput(), i.e. BEFORE Zod validation, so it cannot assume the
  // value has the shape the schema will demand. A non-scalar under a campaign key used to
  // be skipped silently rather than refused.
  describe('fails closed on a campaign key it cannot compare', () => {
    it.each([
      ['an array', { campaignId: [OTHER_CAMPAIGN_ID] }],
      ['an object', { campaignId: { v: OTHER_CAMPAIGN_ID } }],
      ['a boolean', { campaignId: true }],
    ])('rejects %s', async (_label, input) => {
      mockDb({ role: 'user', campaign_id: ASSIGNED_CAMPAIGN_ID });
      await expect(call(input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('still treats an absent or empty campaign id as "no filter"', async () => {
      mockDb({ role: 'user', campaign_id: ASSIGNED_CAMPAIGN_ID });
      await expect(call({ campaignId: '' })).resolves.toEqual({ pinned: ASSIGNED_CAMPAIGN_ID });
      await expect(call({ campaignId: null })).resolves.toEqual({ pinned: ASSIGNED_CAMPAIGN_ID });
    });
  });
});
