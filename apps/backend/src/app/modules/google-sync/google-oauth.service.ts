import type { Insertable, Kysely } from 'kysely';
import type { GoogleOauthTokens, Models } from '../../../../../../libs/common/src/lib/kysely.models';
import { PreconditionFailedError } from '../../errors/app-errors';
import { decryptSecret, encryptSecret } from '../../lib/secret-crypto';
import { logger } from '../../logger';

export const NEEDS_FULL_SYNC = JSON.stringify({ _needs_full_sync: true });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
];

/** Deadline for Google OAuth token/profile HTTP calls — a hung connection must not stall a worker slot. */
const GOOGLE_OAUTH_TIMEOUT_MS = 15_000;

export class GoogleOAuthService {
  private readonly db: Kysely<Models>;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;

  constructor(db: Kysely<Models>, config: { clientId: string; clientSecret: string; redirectUri: string }) {
    this.db = db;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.redirectUri = config.redirectUri;
  }

  public getAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: GOOGLE_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent', // force consent to ensure refresh token is returned
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  public async handleCallback(code: string, connectedBy: string, tenantId: string, campaignId: string): Promise<void> {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      signal: AbortSignal.timeout(GOOGLE_OAUTH_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Failed to acquire token from Google: ${errorText}`);
    }

    const data: unknown = await res.json();
    const tokenData = isRecord(data) ? data : {};
    const accessToken = typeof tokenData['access_token'] === 'string' ? tokenData['access_token'] : '';
    // Google only returns a refresh token on initial consent
    const refreshToken = typeof tokenData['refresh_token'] === 'string' ? tokenData['refresh_token'] : '';
    const expiresIn = typeof tokenData['expires_in'] === 'number' ? tokenData['expires_in'] : 3600;
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    // Fetch user profile to get Google email
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      signal: AbortSignal.timeout(GOOGLE_OAUTH_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    let googleEmail: string | null = null;
    if (profileRes.ok) {
      const profile: unknown = await profileRes.json();
      googleEmail = isRecord(profile) && typeof profile['email'] === 'string' ? profile['email'] : null;
    }

    let refreshTokenPlain: string;
    if (!refreshToken) {
      // If we don't have refresh token in this callback, try keeping the existing one
      const existing = await this.db
        .selectFrom('google_oauth_tokens')
        .select('refresh_token')
        .where('tenant_id', '=', tenantId)
        .where('campaign_id', '=', campaignId)
        .executeTakeFirst();
      // Reuse the stored refresh token; decrypt it to plaintext so it is
      // re-encrypted uniformly below (avoids double-encryption).
      refreshTokenPlain = existing?.refresh_token ? decryptSecret(existing.refresh_token) : '';
    } else {
      refreshTokenPlain = refreshToken;
    }

    if (!refreshTokenPlain) {
      throw new Error('Consent required to obtain refresh token. Please disconnect and reconnect.');
    }

    // Encrypt the mailbox tokens at the DB write boundary (both the insert values
    // and the onConflict update below read these fields).
    const insertObj: Insertable<GoogleOauthTokens> = {
      tenant_id: tenantId,
      campaign_id: campaignId,
      user_id: connectedBy,
      access_token: encryptSecret(accessToken),
      refresh_token: encryptSecret(refreshTokenPlain),
      expires_at: expiresAt,
      google_email: googleEmail,
      delta_link: NEEDS_FULL_SYNC,
      synced_at: null,
    };

    // Wrap the token upsert and initial sync job in a transaction (transactional outbox pattern)
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('google_oauth_tokens')
        .values(insertObj)
        .onConflict((oc) =>
          oc.columns(['tenant_id', 'campaign_id']).doUpdateSet({
            user_id: connectedBy,
            access_token: insertObj.access_token,
            refresh_token: insertObj.refresh_token,
            expires_at: insertObj.expires_at,
            google_email: insertObj.google_email,
            delta_link: NEEDS_FULL_SYNC,
            synced_at: null,
            last_sync_error: null,
            last_sync_error_at: null,
            updated_at: new Date(),
          }),
        )
        .execute();

      await trx
        .insertInto('background_jobs')
        .values({
          tenant_id: tenantId,
          queue: 'default',
          status: 'pending',
          payload: JSON.stringify({ type: 'google_sync', tenantId, campaignId, requestedBy: connectedBy }),
          run_at: new Date(),
          max_attempts: 3,
        })
        .execute();
    });
  }

  public async getValidToken(tenantId: string, campaignId: string): Promise<string> {
    const row = await this.db
      .selectFrom('google_oauth_tokens')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('campaign_id', '=', campaignId)
      .executeTakeFirst();

    if (!row) {
      // PreconditionFailedError (412), not a plain Error: a plain Error maps to a 500 whose
      // message production replaces with a generic string, so the client could never tell
      // "nothing connected" apart from a real failure (the sync UI's reconnect prompt was dead).
      throw new PreconditionFailedError('No Google account connected for this campaign');
    }

    // Decrypt at the DB read boundary so the rest of this method works in plaintext.
    row.access_token = decryptSecret(row.access_token);
    row.refresh_token = decryptSecret(row.refresh_token);

    const isExpired = new Date(row.expires_at) < new Date(Date.now() + 60_000); // refresh 1 min early
    if (!isExpired) {
      return row.access_token;
    }

    // Refresh token
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      signal: AbortSignal.timeout(GOOGLE_OAUTH_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: row.refresh_token,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) {
      // The raw Google response stays in the server log only: a 412's message reaches the
      // client, so embedding `errorText` here would hand Google's error body to the browser.
      const errorText = await res.text();
      logger.error({ status: res.status, errorText }, 'Google token refresh failed');
      throw new PreconditionFailedError('Token refresh failed. Tenant must reconnect their Google account');
    }

    const data: unknown = await res.json();
    const tokenData = isRecord(data) ? data : {};
    const newAccessToken = typeof tokenData['access_token'] === 'string' ? tokenData['access_token'] : '';
    const newExpiresIn = typeof tokenData['expires_in'] === 'number' ? tokenData['expires_in'] : 3600;
    const newExpiry = new Date(Date.now() + newExpiresIn * 1000);
    const newRefreshToken =
      typeof tokenData['refresh_token'] === 'string' ? tokenData['refresh_token'] : row.refresh_token;

    await this.db
      .updateTable('google_oauth_tokens')
      .set({
        access_token: encryptSecret(newAccessToken),
        refresh_token: encryptSecret(newRefreshToken),
        expires_at: newExpiry,
        updated_at: new Date(),
      })
      .where('tenant_id', '=', tenantId)
      .where('campaign_id', '=', campaignId)
      .execute();

    return newAccessToken;
  }

  public async getConnectionStatus(
    tenantId: string,
    campaignId: string,
  ): Promise<{
    connected: boolean;
    googleEmail: string | null;
    syncedAt: Date | null;
    lastSyncError: string | null;
    lastSyncErrorAt: Date | null;
  }> {
    const row = await this.db
      .selectFrom('google_oauth_tokens')
      .select(['google_email', 'synced_at', 'last_sync_error', 'last_sync_error_at'])
      .where('tenant_id', '=', tenantId)
      .where('campaign_id', '=', campaignId)
      .executeTakeFirst();

    return {
      connected: !!row,
      googleEmail: row?.google_email ?? null,
      syncedAt: row?.synced_at ? new Date(row.synced_at) : null,
      lastSyncError: row?.last_sync_error ?? null,
      lastSyncErrorAt: row?.last_sync_error_at ? new Date(row.last_sync_error_at) : null,
    };
  }

  public async disconnect(tenantId: string, campaignId: string): Promise<void> {
    await this.db
      .deleteFrom('google_oauth_tokens')
      .where('tenant_id', '=', tenantId)
      .where('campaign_id', '=', campaignId)
      .execute();
  }

  public async saveDeltaLink(tenantId: string, campaignId: string, deltaLink: string): Promise<void> {
    await this.db
      .updateTable('google_oauth_tokens')
      .set({
        delta_link: deltaLink,
        synced_at: new Date(),
        last_sync_error: null,
        last_sync_error_at: null,
        updated_at: new Date(),
      })
      .where('tenant_id', '=', tenantId)
      .where('campaign_id', '=', campaignId)
      .execute();
  }

  public async recordSyncError(tenantId: string, campaignId: string, error: string): Promise<void> {
    await this.db
      .updateTable('google_oauth_tokens')
      .set({ last_sync_error: error, last_sync_error_at: new Date(), updated_at: new Date() })
      .where('tenant_id', '=', tenantId)
      .where('campaign_id', '=', campaignId)
      .execute();
  }

  public async getDeltaLink(tenantId: string, campaignId: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('google_oauth_tokens')
      .select('delta_link')
      .where('tenant_id', '=', tenantId)
      .where('campaign_id', '=', campaignId)
      .executeTakeFirst();
    return row?.delta_link ?? null;
  }

  public async resetDeltaLink(tenantId: string, campaignId: string): Promise<void> {
    await this.db
      .updateTable('google_oauth_tokens')
      .set({ delta_link: NEEDS_FULL_SYNC, updated_at: new Date() })
      .where('tenant_id', '=', tenantId)
      .where('campaign_id', '=', campaignId)
      .execute();
  }
}
