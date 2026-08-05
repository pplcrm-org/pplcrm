import { createHmac } from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { env } from '../../env';
import { decodeOAuthState, encodeOAuthState } from './oauth-state';

/**
 * The OAuth `state` parameter is the only thing binding a mailbox-connect
 * callback to a specific (userId, tenantId, campaignId). If a forged state were
 * accepted, an attacker could have a victim's mailbox tokens stored under the
 * attacker's tenant. These tests pin the four ways a state must be refused:
 * bad signature, expired, malformed, and signed with the wrong secret.
 */

/** Sign a payload the way the module does, so tests can build states the verifier accepts. */
function signWithRealSecret(data: string): string {
  return createHmac('sha256', env.sharedSecret).update(data).digest('base64url');
}

/** Build a state string whose signature is valid but whose body is arbitrary. */
function stateWithBody(body: unknown): string {
  const data = Buffer.from(JSON.stringify(body)).toString('base64url');
  return `${data}.${signWithRealSecret(data)}`;
}

const PAYLOAD = {
  userId: '10000001',
  tenantId: '20000002',
  campaignId: '30000003',
  returnTo: '/settings/email',
};

describe('oauth-state', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock('../../env');
    vi.resetModules();
  });

  describe('round trip', () => {
    it('decodes back to the exact payload it encoded', () => {
      const decoded = decodeOAuthState(encodeOAuthState(PAYLOAD));
      expect(decoded).toEqual(PAYLOAD);
    });

    it('omits returnTo when none was supplied', () => {
      const decoded = decodeOAuthState(encodeOAuthState({ userId: '1', tenantId: '2', campaignId: '3' }));
      expect(decoded).toEqual({ userId: '1', tenantId: '2', campaignId: '3', returnTo: undefined });
    });

    it('produces a two-part `<data>.<signature>` string', () => {
      const state = encodeOAuthState(PAYLOAD);
      expect(state.split('.')).toHaveLength(2);
    });
  });

  describe('tamper detection', () => {
    it('rejects a state whose signature was altered', () => {
      const state = encodeOAuthState(PAYLOAD);
      const dot = state.lastIndexOf('.');
      const sig = state.slice(dot + 1);
      // Flip one character of the signature, keeping the length identical so the
      // comparison reaches timingSafeEqual rather than the length short-circuit.
      const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
      expect(decodeOAuthState(`${state.slice(0, dot)}.${flipped}`)).toBeNull();
    });

    it('rejects a signature of the wrong length', () => {
      const state = encodeOAuthState(PAYLOAD);
      const dot = state.lastIndexOf('.');
      expect(decodeOAuthState(`${state.slice(0, dot)}.short`)).toBeNull();
    });

    it('rejects a payload swapped to another tenant while keeping the old signature', () => {
      const state = encodeOAuthState(PAYLOAD);
      const sig = state.slice(state.lastIndexOf('.') + 1);
      const attackerBody = Buffer.from(JSON.stringify({ ...PAYLOAD, tenantId: '99999999', iat: Date.now() })).toString(
        'base64url',
      );
      expect(decodeOAuthState(`${attackerBody}.${sig}`)).toBeNull();
    });

    it('rejects a state signed with a different shared secret', async () => {
      vi.resetModules();
      vi.doMock('../../env', () => ({ env: { sharedSecret: 'a-completely-different-shared-secret' } }));
      const foreign = await import('./oauth-state');

      const forged = foreign.encodeOAuthState(PAYLOAD);

      // Verified by the module loaded with the real secret.
      expect(decodeOAuthState(forged)).toBeNull();
      // Sanity check: the forged state is well-formed under its own secret.
      expect(foreign.decodeOAuthState(forged)).toEqual(PAYLOAD);
    });
  });

  describe('TTL', () => {
    it('accepts a state just inside the 10 minute window', () => {
      const state = encodeOAuthState(PAYLOAD);
      vi.useFakeTimers();
      vi.setSystemTime(new Date(Date.now() + 9 * 60 * 1000));
      expect(decodeOAuthState(state)).toEqual(PAYLOAD);
    });

    it('rejects a state older than 10 minutes', () => {
      const state = encodeOAuthState(PAYLOAD);
      vi.useFakeTimers();
      vi.setSystemTime(new Date(Date.now() + 11 * 60 * 1000));
      expect(decodeOAuthState(state)).toBeNull();
    });
  });

  describe('malformed input', () => {
    const badInputs: Array<[string, string | undefined | null]> = [
      ['undefined', undefined],
      ['null', null],
      ['empty string', ''],
      ['no separator', 'abcdefg'],
      ['leading dot only', '.signature'],
      ['empty signature', 'YWJj.'],
      ['dot alone', '.'],
    ];

    for (const [label, input] of badInputs) {
      it(`rejects ${label} without throwing`, () => {
        expect(() => decodeOAuthState(input)).not.toThrow();
        expect(decodeOAuthState(input)).toBeNull();
      });
    }

    it('rejects a correctly signed body that is not JSON', () => {
      const data = Buffer.from('this is not json').toString('base64url');
      expect(decodeOAuthState(`${data}.${signWithRealSecret(data)}`)).toBeNull();
    });

    it('rejects a correctly signed body with no iat', () => {
      expect(stateWithBody({ ...PAYLOAD })).toBeTruthy();
      expect(decodeOAuthState(stateWithBody({ ...PAYLOAD }))).toBeNull();
    });

    it('rejects a correctly signed body whose iat is not a number', () => {
      expect(decodeOAuthState(stateWithBody({ ...PAYLOAD, iat: String(Date.now()) }))).toBeNull();
    });

    it('rejects a correctly signed body that is JSON null', () => {
      expect(decodeOAuthState(stateWithBody(null))).toBeNull();
    });

    for (const missing of ['userId', 'tenantId', 'campaignId'] as const) {
      it(`rejects a correctly signed body missing ${missing}`, () => {
        const body: Record<string, unknown> = { ...PAYLOAD, iat: Date.now() };
        delete body[missing];
        expect(decodeOAuthState(stateWithBody(body))).toBeNull();
      });
    }
  });
});
