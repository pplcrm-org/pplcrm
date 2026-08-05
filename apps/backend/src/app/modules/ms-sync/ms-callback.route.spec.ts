import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The route builds a real MsOAuthService (and therefore a real MSAL client) the first
// time a request gets past the state check. Test env has no Microsoft credentials, so
// the MSAL client is replaced with an inert stand-in; this spec is about state handling.
vi.mock('@azure/msal-node', () => ({
  ConfidentialClientApplication: class {
    public getAuthCodeUrl(): Promise<string> {
      return Promise.resolve('https://login.microsoftonline.test/authorize');
    }
    public getTokenCache(): { serialize: () => string } {
      return { serialize: (): string => JSON.stringify({ RefreshToken: {} }) };
    }
  },
}));

import { env } from '../../../env';
import { encodeOAuthState } from '../../lib/oauth-state';
import msSyncCallbackRoute from './ms-callback.route';
import { MsOAuthService } from './ms-oauth.service';

/**
 * The callback is the point where a mailbox gets bound to an account. What is pinned here:
 *  - a missing or forged `state` never reaches MsOAuthService.handleCallback, so an attacker
 *    cannot have a victim's mailbox stored under their own tenant;
 *  - an internal failure redirects with a fixed code, never with the raw error text.
 */

const FRONTEND = env.apiUrl.replace(':3000', ':4200');

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(msSyncCallbackRoute, { prefix: '/auth/ms' });
  return app;
}

describe('microsoft OAuth callback route', () => {
  let app: FastifyInstance;
  let handleCallback: ReturnType<typeof vi.spyOn>;

  const VALID_STATE = (): string =>
    encodeOAuthState({ campaignId: '30000003', tenantId: '20000002', userId: '10000001' });

  beforeEach(async () => {
    app = await buildApp();
    handleCallback = vi
      .spyOn(MsOAuthService.prototype, 'handleCallback')
      .mockResolvedValue(undefined) as unknown as ReturnType<typeof vi.spyOn>;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  async function get(query: Record<string, string>): Promise<{ location: string; statusCode: number }> {
    const res = await app.inject({ method: 'GET', query, url: '/auth/ms/callback' });
    return { location: String(res.headers['location'] ?? ''), statusCode: res.statusCode };
  }

  it('rejects a forged state and never runs the token exchange', async () => {
    const { location, statusCode } = await get({ code: 'auth-code', state: 'forged.state' });

    expect(statusCode).toBe(302);
    expect(location).toBe(`${FRONTEND}/settings?ms_error=invalid_state`);
    expect(handleCallback).not.toHaveBeenCalled();
  });

  it('rejects a state whose signature was tampered with', async () => {
    const state = VALID_STATE();
    const dot = state.lastIndexOf('.');
    const sig = state.slice(dot + 1);
    const tampered = `${state.slice(0, dot)}.${(sig[0] === 'A' ? 'B' : 'A') + sig.slice(1)}`;

    const { location } = await get({ code: 'auth-code', state: tampered });

    expect(location).toContain('ms_error=invalid_state');
    expect(handleCallback).not.toHaveBeenCalled();
  });

  it('rejects a request with no state at all', async () => {
    const { location } = await get({ code: 'auth-code' });

    expect(location).toBe(`${FRONTEND}/settings?ms_error=missing_code`);
    expect(handleCallback).not.toHaveBeenCalled();
  });

  it('rejects a request with no code', async () => {
    const { location } = await get({ state: VALID_STATE() });

    expect(location).toBe(`${FRONTEND}/settings?ms_error=missing_code`);
    expect(handleCallback).not.toHaveBeenCalled();
  });

  it('passes the identity from a valid state to the token exchange', async () => {
    const { location } = await get({ code: 'auth-code', state: VALID_STATE() });

    expect(location).toBe(`${FRONTEND}/settings?ms_connected=1`);
    expect(handleCallback).toHaveBeenCalledWith('auth-code', '10000001', '20000002', '30000003');
  });

  it('does not reflect internal error text when the token exchange fails', async () => {
    handleCallback.mockRejectedValue(new Error('client_secret aBc123 rejected by login.microsoftonline.com'));

    const { location } = await get({ code: 'auth-code', state: VALID_STATE() });

    expect(location).toBe(`${FRONTEND}/settings?ms_error=connection_failed`);
    expect(location).not.toContain('aBc123');
    expect(location).not.toContain('client_secret');
  });

  it('ignores a protocol-relative returnTo (open redirect)', async () => {
    const state = encodeOAuthState({
      campaignId: '30000003',
      returnTo: '//evil.example.com/steal',
      tenantId: '20000002',
      userId: '10000001',
    });

    const { location } = await get({ code: 'auth-code', state });

    expect(location).toBe(`${FRONTEND}/settings?ms_connected=1`);
    expect(location).not.toContain('evil.example.com');
  });
});
