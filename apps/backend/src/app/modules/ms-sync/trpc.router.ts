import { authProcedure, router } from '../../../trpc';
import { MsOAuthService, NEEDS_FULL_SYNC } from './ms-oauth.service';
import { MsSyncService } from './ms-sync.service';
import { BaseRepository } from '../../lib/base.repo';
import { env } from '../../../env';
import { z } from 'zod';
import { idSchema } from '@common';
import { sql } from 'kysely';
import { encodeOAuthState } from '../../lib/oauth-state';
import { assertNotDemoMode } from '../demo/demo-guard';
import { assertPlanFeature } from '../billing/plan-gate';
import { BadRequestError } from '../../errors/app-errors';

let _oauthSvc: MsOAuthService | null = null;
let _syncSvc: MsSyncService | null = null;

/** Mailbox sync is optional per deployment (the env vars are optional by design). */
function isConfigured(): boolean {
  return !!env.msClientId && !!env.msClientSecret;
}

function getServices() {
  // msal-node's ConfidentialClientApplication rejects an empty clientSecret at
  // construction with a raw invalid_client_credential error — fail with
  // user-facing copy before it gets the chance.
  if (!isConfigured()) {
    throw new BadRequestError('Microsoft email sync is not configured on this server.');
  }
  if (!_oauthSvc || !_syncSvc) {
    const db = BaseRepository.dbInstance; // reuse the shared Kysely instance
    _oauthSvc = new MsOAuthService(db, {
      clientId: env.msClientId ?? '',
      clientSecret: env.msClientSecret ?? '',
      tenantId: env.msTenantId ?? 'common',
      redirectUri: env.msRedirectUri ?? `${env.apiUrl}/auth/ms/callback`,
    });
    _syncSvc = new MsSyncService(db, _oauthSvc);
  }
  return { oauthSvc: _oauthSvc, syncSvc: _syncSvc };
}

// Campaigns §15 — mailbox connections are per-campaign. The active context is
// supplied by the client (the same activeCampaignId() it passes everywhere).
const campaignInput = z.object({ campaignId: idSchema });

function getAuthUrl() {
  return authProcedure
    .input(z.object({ campaignId: idSchema, returnTo: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      // Mailbox sync is configuration — locked during the demo test drive, and paid-only
      // (the shared inbox is Grassroots+; connecting is the entry point, so the query form
      // of the gate matters here even though planFeatureGate would only catch mutations).
      await assertNotDemoMode(BaseRepository.dbInstance, ctx.auth.tenant_id);
      await assertPlanFeature(BaseRepository.dbInstance, ctx.auth.tenant_id, 'inbox');
      const { oauthSvc } = getServices();
      const state = encodeOAuthState({
        userId: ctx.auth.user_id,
        tenantId: ctx.auth.tenant_id,
        campaignId: input.campaignId,
        returnTo: input.returnTo,
      });
      const url = await oauthSvc.getAuthUrl(state);
      return { url };
    });
}

function getConnectionStatus() {
  return authProcedure.input(campaignInput).query(async ({ ctx, input }) => {
    // Unconfigured is a normal state (e.g. local dev): render the section calmly
    // instead of erroring on load.
    if (!isConfigured()) {
      return {
        configured: false,
        connected: false,
        msEmail: null,
        syncedAt: null,
        lastSyncError: null,
        lastSyncErrorAt: null,
        syncing: false,
      };
    }
    const { oauthSvc } = getServices();
    const db = BaseRepository.dbInstance;
    const status = await oauthSvc.getConnectionStatus(ctx.auth.tenant_id, input.campaignId);

    const activeJob = await db
      .selectFrom('background_jobs')
      .select('id')
      .where('status', 'in', ['pending', 'processing'])
      .where('tenant_id', '=', ctx.auth.tenant_id)
      .where(sql`payload->>'type'`, '=', 'ms_sync')
      .where(sql`payload->>'campaignId'`, '=', input.campaignId)
      .executeTakeFirst();

    return {
      configured: true,
      ...status,
      syncing: !!activeJob,
    };
  });
}

function syncNow() {
  return authProcedure.input(campaignInput).mutation(async ({ ctx, input }) => {
    const db = BaseRepository.dbInstance;
    await assertPlanFeature(db, ctx.auth.tenant_id, 'inbox');

    const existing = await db
      .selectFrom('background_jobs')
      .select('id')
      .where('status', 'in', ['pending', 'processing'])
      .where('tenant_id', '=', ctx.auth.tenant_id)
      .where(sql`payload->>'type'`, '=', 'ms_sync')
      .where(sql`payload->>'campaignId'`, '=', input.campaignId)
      .executeTakeFirst();

    if (!existing) {
      await db
        .insertInto('background_jobs')
        .values({
          tenant_id: ctx.auth.tenant_id,
          queue: 'default',
          status: 'pending',
          payload: JSON.stringify({
            type: 'ms_sync',
            tenantId: ctx.auth.tenant_id,
            campaignId: input.campaignId,
            requestedBy: ctx.auth.user_id,
          }),
          run_at: new Date(),
          max_attempts: 3,
        })
        .execute();
    }

    return { inserted: 0, queued: true };
  });
}

function disconnect() {
  return authProcedure
    .input(
      z.object({
        campaignId: idSchema,
        removeLocalEmails: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { oauthSvc, syncSvc } = getServices();

      if (input.removeLocalEmails) {
        await syncSvc.removeAllLocalEmails(ctx.auth.tenant_id, input.campaignId);
      }

      await oauthSvc.disconnect(ctx.auth.tenant_id, input.campaignId);
      return { success: true };
    });
}

function resetSync() {
  return authProcedure.input(campaignInput).mutation(async ({ ctx, input }) => {
    await assertPlanFeature(BaseRepository.dbInstance, ctx.auth.tenant_id, 'inbox');
    const { oauthSvc } = getServices();
    await oauthSvc.saveDeltaLink(ctx.auth.tenant_id, input.campaignId, NEEDS_FULL_SYNC);
    return { success: true };
  });
}
// `disconnect` and `getConnectionStatus` are deliberately NOT plan-gated: taking a credential
// out of service must never require an upgrade (same principle as revokeApiKey), and the
// settings page renders the status section on every plan.

export const MsSyncRouter = router({
  getAuthUrl: getAuthUrl(),
  getConnectionStatus: getConnectionStatus(),
  syncNow: syncNow(),
  disconnect: disconnect(),
  resetSync: resetSync(),
});
