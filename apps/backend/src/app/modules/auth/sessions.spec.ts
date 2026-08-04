import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ForbiddenError, NotFoundError } from '../../errors/app-errors';
import { BaseRepository } from '../../lib/base.repo';
import { hashToken } from '../../lib/token-hash';
import { AuthController } from './controller';

vi.mock('../../lib/hibp', () => ({
  getPwnedCount: vi.fn().mockResolvedValue(0),
}));

/**
 * The "where am I signed in" endpoints, against a real database, because the thing worth proving
 * is the SQL: that the list cannot reach another user or another workspace, that the two
 * credential columns never come back, and that revoking is authorised by ownership rather than by
 * knowing a row id.
 *
 * Fixtures are inserted directly rather than through signUp: `tenants` needs only a name and
 * `authusers` only an email and password, so two workspaces and three users cost three inserts and
 * clean up in three deletes.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixtures build partial rows the
// Insertable<> types (reasonably) demand in full; every column that matters here is spelled out.
const db = BaseRepository.dbInstance as any;

const HOUR_MS = 60 * 60 * 1000;

let controller: AuthController;

/** Workspace A, with two colleagues in it. Workspace B holds an unrelated third user. */
let tenantA: string;
let tenantB: string;
let alice: string;
let bob: string;
let carol: string;

/** Alice's own browser: the plaintext session id her access token would carry. */
let aliceCurrentPlain: string;
let aliceCurrentId: string;

function rand(): string {
  return String(Math.floor(Math.random() * 100000000) + 10000000);
}

async function makeTenant(): Promise<string> {
  const row = await db
    .insertInto('tenants')
    .values({ name: `Sessions-${rand()}` })
    .returning('id')
    .executeTakeFirstOrThrow();
  return String(row.id);
}

async function makeUser(tenant_id: string): Promise<string> {
  const row = await db
    .insertInto('authusers')
    .values({ tenant_id, email: `sessions-${rand()}@example.com`, password: 'not-a-real-hash' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return String(row.id);
}

async function makeSession(input: {
  user_id: string;
  tenant_id: string;
  plainSessionId: string;
  status?: string;
  expiresAt?: Date | null;
  ip?: string;
  userAgent?: string;
}): Promise<string> {
  const row = await db
    .insertInto('sessions')
    .values({
      user_id: input.user_id,
      tenant_id: input.tenant_id,
      session_id: hashToken(input.plainSessionId),
      refresh_token: hashToken(`refresh-${input.plainSessionId}`),
      status: input.status ?? 'active',
      ip_address: input.ip ?? '203.0.113.9',
      user_agent: input.userAgent ?? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/126.0',
      expires_at: input.expiresAt === undefined ? new Date(Date.now() + 24 * HOUR_MS) : input.expiresAt,
      last_used_at: new Date(),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return String(row.id);
}

function authFor(user_id: string, tenant_id: string, plainSessionId: string) {
  return { user_id, tenant_id, session_id: plainSessionId, role: 'admin' };
}

beforeEach(async () => {
  controller = new AuthController();
  tenantA = await makeTenant();
  tenantB = await makeTenant();
  alice = await makeUser(tenantA);
  bob = await makeUser(tenantA);
  carol = await makeUser(tenantB);

  aliceCurrentPlain = `alice-current-${rand()}`;
  aliceCurrentId = await makeSession({
    user_id: alice,
    tenant_id: tenantA,
    plainSessionId: aliceCurrentPlain,
    ip: '198.51.100.4',
  });
});

afterEach(async () => {
  for (const tenant of [tenantA, tenantB]) {
    await db.deleteFrom('sessions').where('tenant_id', '=', tenant).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenant).execute();
    await db.deleteFrom('tenants').where('id', '=', tenant).execute();
  }
});

describe('listSessions', () => {
  it('returns only the caller’s own sessions, never a colleague’s and never another workspace’s', async () => {
    const aliceOther = await makeSession({ user_id: alice, tenant_id: tenantA, plainSessionId: `alice-2-${rand()}` });
    await makeSession({ user_id: bob, tenant_id: tenantA, plainSessionId: `bob-1-${rand()}` });
    await makeSession({ user_id: carol, tenant_id: tenantB, plainSessionId: `carol-1-${rand()}` });

    const rows = await controller.listSessions(authFor(alice, tenantA, aliceCurrentPlain));

    expect(rows.map((r) => r.id).sort()).toEqual([aliceCurrentId, aliceOther].sort());
  });

  it('never hands the browser a credential', async () => {
    const rows = await controller.listSessions(authFor(alice, tenantA, aliceCurrentPlain));

    expect(rows).toHaveLength(1);
    // session_id and refresh_token are hashes of the tokens the auth gates accept. Neither the
    // column nor its value may appear anywhere in the payload.
    const serialised = JSON.stringify(rows);
    expect(serialised).not.toContain('session_id');
    expect(serialised).not.toContain('refresh_token');
    expect(serialised).not.toContain(hashToken(aliceCurrentPlain));
    expect(serialised).not.toContain(aliceCurrentPlain);
  });

  it('marks the session making the request, and only that one', async () => {
    await makeSession({ user_id: alice, tenant_id: tenantA, plainSessionId: `alice-2-${rand()}` });

    const rows = await controller.listSessions(authFor(alice, tenantA, aliceCurrentPlain));

    expect(rows.filter((r) => r.is_current).map((r) => r.id)).toEqual([aliceCurrentId]);
  });

  it('hides sessions that can no longer authenticate', async () => {
    // Both of these are refused by the auth middleware, so showing them would invite the user to
    // "sign out" something that is already dead.
    await makeSession({
      user_id: alice,
      tenant_id: tenantA,
      plainSessionId: `alice-rotated-${rand()}`,
      status: 'rotated',
    });
    await makeSession({
      user_id: alice,
      tenant_id: tenantA,
      plainSessionId: `alice-expired-${rand()}`,
      expiresAt: new Date(Date.now() - HOUR_MS),
    });

    const rows = await controller.listSessions(authFor(alice, tenantA, aliceCurrentPlain));

    expect(rows.map((r) => r.id)).toEqual([aliceCurrentId]);
  });

  it('reports the device details the user needs to recognise a session', async () => {
    const rows = await controller.listSessions(authFor(alice, tenantA, aliceCurrentPlain));

    expect(rows[0]?.ip_address).toBe('198.51.100.4');
    expect(rows[0]?.user_agent).toContain('Chrome');
    expect(rows[0]?.created_at).toBeInstanceOf(Date);
  });
});

describe('revokeSession', () => {
  it('ends one of the caller’s own sessions', async () => {
    const target = await makeSession({ user_id: alice, tenant_id: tenantA, plainSessionId: `alice-2-${rand()}` });

    const result = await controller.revokeSession(authFor(alice, tenantA, aliceCurrentPlain), target);

    expect(result).toEqual({ success: true, was_current: false });
    const left = await controller.listSessions(authFor(alice, tenantA, aliceCurrentPlain));
    expect(left.map((r) => r.id)).toEqual([aliceCurrentId]);
  });

  it('reports when the revoked session was the caller’s own, so the cookie can be cleared', async () => {
    const result = await controller.revokeSession(authFor(alice, tenantA, aliceCurrentPlain), aliceCurrentId);

    expect(result).toEqual({ success: true, was_current: true });
  });

  it('refuses a colleague’s session with FORBIDDEN, not UNAUTHORIZED, and leaves it running', async () => {
    const bobSession = await makeSession({ user_id: bob, tenant_id: tenantA, plainSessionId: `bob-1-${rand()}` });

    // UNAUTHORIZED would force-sign-out the caller, who is signed in perfectly well.
    await expect(
      controller.revokeSession(authFor(alice, tenantA, aliceCurrentPlain), bobSession),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const survivor = await db
      .selectFrom('sessions')
      .select('id')
      .where('id', '=', bobSession)
      .where('tenant_id', '=', tenantA)
      .executeTakeFirst();
    expect(survivor).toBeDefined();
  });

  it('cannot reach a session in another workspace', async () => {
    const carolSession = await makeSession({ user_id: carol, tenant_id: tenantB, plainSessionId: `carol-1-${rand()}` });

    await expect(
      controller.revokeSession(authFor(alice, tenantA, aliceCurrentPlain), carolSession),
    ).rejects.toBeInstanceOf(NotFoundError);

    const survivor = await db
      .selectFrom('sessions')
      .select('id')
      .where('id', '=', carolSession)
      .where('tenant_id', '=', tenantB)
      .executeTakeFirst();
    expect(survivor).toBeDefined();
  });

  it('reports a session that is already gone as not found', async () => {
    const target = await makeSession({ user_id: alice, tenant_id: tenantA, plainSessionId: `alice-2-${rand()}` });
    await db.deleteFrom('sessions').where('id', '=', target).where('tenant_id', '=', tenantA).execute();

    await expect(controller.revokeSession(authFor(alice, tenantA, aliceCurrentPlain), target)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('revokeOtherSessions', () => {
  it('ends every other session of the caller’s, including rotated ones, and keeps this one', async () => {
    await makeSession({ user_id: alice, tenant_id: tenantA, plainSessionId: `alice-2-${rand()}` });
    // A rotated row's refresh token is still replayable for a short grace window, so leaving it
    // behind would let a device we just signed out mint a fresh session from its old cookie.
    await makeSession({
      user_id: alice,
      tenant_id: tenantA,
      plainSessionId: `alice-rotated-${rand()}`,
      status: 'rotated',
    });

    const result = await controller.revokeOtherSessions(authFor(alice, tenantA, aliceCurrentPlain));

    expect(result).toEqual({ revoked: 2 });
    const remaining = await db
      .selectFrom('sessions')
      .select('id')
      .where('user_id', '=', alice)
      .where('tenant_id', '=', tenantA)
      .execute();
    expect(remaining.map((r: { id: string }) => String(r.id))).toEqual([aliceCurrentId]);
  });

  it('leaves colleagues and other workspaces alone', async () => {
    const bobSession = await makeSession({ user_id: bob, tenant_id: tenantA, plainSessionId: `bob-1-${rand()}` });
    const carolSession = await makeSession({ user_id: carol, tenant_id: tenantB, plainSessionId: `carol-1-${rand()}` });

    await controller.revokeOtherSessions(authFor(alice, tenantA, aliceCurrentPlain));

    const others = await db
      .selectFrom('sessions')
      .select('id')
      .where('id', 'in', [bobSession, carolSession])
      .where('tenant_id', 'in', [tenantA, tenantB])
      .execute();
    expect(others).toHaveLength(2);
  });

  it('reports zero when this is the only device', async () => {
    const result = await controller.revokeOtherSessions(authFor(alice, tenantA, aliceCurrentPlain));

    expect(result).toEqual({ revoked: 0 });
  });
});
