import { afterEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

import { assertProductionSecrets, envSchema } from './env';

/**
 * Unit tests for the production boot guard. Importing ./env parses process.env at module
 * load, but under vitest NODE_ENV is 'test' and vite.config.ts injects the required DB
 * vars, so the import itself is side-effect-safe here; the guard's production branch is
 * exercised by stubbing NODE_ENV per test.
 */

/** A parsed env that satisfies every production check — tests break one field at a time. */
const VALID_PRODUCTION_ENV = {
  DB_USER: 'user',
  DB_NAME: 'db',
  DB_PASSWORD: 'password',
  SHARED_SECRET: 's'.repeat(32),
  OAUTH_TOKEN_ENC_KEY: 'k'.repeat(32),
  STRIPE_SECRET_KEY: 'sk_live_realkey',
  STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_connect',
  SENDGRID_WEBHOOK_VERIFICATION_KEY: 'sendgrid_verification_key',
  POSTMARK_WEBHOOK_TOKEN: 'postmark_token',
};

function parseWith(overrides: Record<string, string | undefined> = {}): z.infer<typeof envSchema> {
  return envSchema.parse({ ...VALID_PRODUCTION_ENV, ...overrides });
}

describe('assertProductionSecrets', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does nothing outside production even when secrets are missing', () => {
    vi.stubEnv('NODE_ENV', 'test');
    expect(() =>
      assertProductionSecrets(
        parseWith({
          STRIPE_CONNECT_WEBHOOK_SECRET: undefined,
          SENDGRID_WEBHOOK_VERIFICATION_KEY: undefined,
          POSTMARK_WEBHOOK_TOKEN: undefined,
        }),
      ),
    ).not.toThrow();
  });

  it('accepts a fully configured production env', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => assertProductionSecrets(parseWith())).not.toThrow();
  });

  describe('webhook secrets must be set and non-blank in production', () => {
    const cases: { field: string; consequence: RegExp }[] = [
      { field: 'STRIPE_CONNECT_WEBHOOK_SECRET', consequence: /donation webhook is rejected/ },
      { field: 'SENDGRID_WEBHOOK_VERIFICATION_KEY', consequence: /bounce\/spam-complaint events are never recorded/ },
      { field: 'POSTMARK_WEBHOOK_TOKEN', consequence: /Postmark delivery\/bounce event is rejected/ },
    ];

    for (const { field, consequence } of cases) {
      it(`rejects an unset ${field}`, () => {
        vi.stubEnv('NODE_ENV', 'production');
        expect(() => assertProductionSecrets(parseWith({ [field]: undefined }))).toThrow(field);
        expect(() => assertProductionSecrets(parseWith({ [field]: undefined }))).toThrow(consequence);
      });

      it(`rejects a blank ${field}`, () => {
        vi.stubEnv('NODE_ENV', 'production');
        expect(() => assertProductionSecrets(parseWith({ [field]: '   ' }))).toThrow(field);
      });
    }
  });

  it('still enforces the pre-existing checks (guard not weakened)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => assertProductionSecrets(parseWith({ SHARED_SECRET: 'short' }))).toThrow(/SHARED_SECRET/);
    expect(() => assertProductionSecrets(parseWith({ OAUTH_TOKEN_ENC_KEY: undefined }))).toThrow(/OAUTH_TOKEN_ENC_KEY/);
    expect(() => assertProductionSecrets(parseWith({ STRIPE_SECRET_KEY: undefined }))).toThrow(/STRIPE_SECRET_KEY/);
  });
});
