import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PersonsRouter } from '../modules/persons/trpc.router';
import { HouseholdsRouter } from '../modules/households/trpc.router';
import { BaseRepository } from './base.repo';
import { hashToken } from './token-hash';

/**
 * Cross-tenant IDOR probe — the highest-stakes invariant in a multi-tenant CRM.
 *
 * This is deliberately NOT the same test as `rls-tenant-isolation.spec.ts`. That spec proves the
 * Postgres RLS *mechanism* works when a tenant is bound via `runWithTenant`. This one attacks the
 * surface an actual attacker reaches: a fully authenticated tRPC session for tenant A, calling
 * real procedures with tenant B's record IDs. It exercises the whole stack the request takes —
 * `isAuthed` (session lookup + `runWithTenant`), the router, the controller's app-level
 * `.where('tenant_id', …)` filters, and the RLS policy underneath them.
 *
 * Why that distinction matters: the `local/no-unscoped-db-query` lint rule is explicitly "a
 * tripwire, not a proof" (pplcrm-tenant-safety) and has documented blind spots — a query built
 * across two statements, or scoped inside a subquery, passes lint while leaking. Only an
 * end-to-end probe like this one can catch that class of bug.
 *
 * Assertion style: these tests assert that tenant B's DATA NEVER COMES BACK and is never mutated,
 * rather than asserting a specific TRPCError code. Returning `undefined` and throwing NOT_FOUND
 * are both secure; returning B's row is the breach. Pinning the error code would make the spec
 * brittle against a legitimate refactor without making it any stronger as a security test.
 *
 * Callers are built with `createCaller`, which DOES run the `isAuthed` middleware — so each tenant
 * needs a real `authusers` row and a real active `sessions` row whose `session_id` column holds
 * the HASH of the plaintext token the context carries.
 */
const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);
const db = BaseRepository.dbInstance;

interface SeededTenant {
  tenantId: string;
  userId: string;
  campaignId: string;
  householdId: string;
  personId: string;
  /** Plaintext session token; the DB stores only its hash. */
  sessionToken: string;
  personFirstName: string;
}

async function seedTenant(label: string): Promise<SeededTenant> {
  const tenantId = rand();
  const userId = rand();
  const campaignId = rand();
  const householdId = rand();
  const sessionToken = `idor-probe-${label}-${rand()}`;
  const personFirstName = `Person-${label}-${rand()}`;

  await db
    .insertInto('tenants')
    .values({ id: tenantId, name: `IDOR Probe ${label}` })
    .execute();
  await db
    .insertInto('authusers')
    .values({
      id: userId,
      tenant_id: tenantId,
      email: `idor-${userId}@example.com`,
      password: 'password',
      first_name: 'Idor',
      last_name: label,
      verified: true,
      // 'owner' deliberately: the strongest role, so a leak can never be attributed to some
      // incidental role restriction rather than to genuine tenant scoping.
      role: 'owner',
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();
  await db.updateTable('tenants').set({ admin_id: userId, createdby_id: userId }).where('id', '=', tenantId).execute();

  await db
    .insertInto('sessions')
    .values({
      id: rand(),
      session_id: hashToken(sessionToken),
      user_id: userId,
      tenant_id: tenantId,
      ip_address: '127.0.0.1',
      status: 'active',
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
    })
    .execute();

  await db
    .insertInto('campaigns')
    .values({
      id: campaignId,
      tenant_id: tenantId,
      admin_id: userId,
      name: `IDOR Campaign ${label}`,
      kind: 'office',
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();
  await db
    .insertInto('households')
    .values({
      id: householdId,
      tenant_id: tenantId,
      campaign_id: campaignId,
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();

  const person = await db
    .insertInto('persons')
    .values({
      tenant_id: tenantId,
      campaign_id: campaignId,
      household_id: householdId,
      first_name: personFirstName,
      createdby_id: userId,
      updatedby_id: userId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  return {
    tenantId,
    userId,
    campaignId,
    householdId,
    personId: String(person.id),
    sessionToken,
    personFirstName,
  };
}

async function purgeTenant(t: SeededTenant): Promise<void> {
  // The probe's own calls write activity rows, which FK-reference authusers — so these must go
  // before the user, or teardown trips fk_user_activity_createdby.
  await db.deleteFrom('user_activity').where('tenant_id', '=', t.tenantId).execute();
  await db.deleteFrom('persons').where('tenant_id', '=', t.tenantId).execute();
  await db.deleteFrom('households').where('tenant_id', '=', t.tenantId).execute();
  await db.deleteFrom('campaigns').where('tenant_id', '=', t.tenantId).execute();
  await db.deleteFrom('sessions').where('tenant_id', '=', t.tenantId).execute();
  await db.updateTable('tenants').set({ admin_id: null, createdby_id: null }).where('id', '=', t.tenantId).execute();
  await db.deleteFrom('authusers').where('tenant_id', '=', t.tenantId).execute();
  await db.deleteFrom('tenants').where('id', '=', t.tenantId).execute();
}

/** The tRPC context a signed-in request carries, for the given seeded tenant. */
function ctxFor(t: SeededTenant): { auth: { tenant_id: string; user_id: string; session_id: string } } {
  return { auth: { tenant_id: t.tenantId, user_id: t.userId, session_id: t.sessionToken } };
}

/** Resolve whatever a call did — value or throw — into a single inspectable result. */
async function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await p };
  } catch (error) {
    return { ok: false, error };
  }
}

/** Read a person straight from the DB, bypassing all app scoping, to verify real-world effect. */
async function readPersonRaw(id: string): Promise<{ first_name: string | null } | undefined> {
  return db.selectFrom('persons').select('first_name').where('id', '=', id).executeTakeFirst();
}

describe('Cross-tenant API isolation (IDOR probe)', () => {
  let tenantA: SeededTenant;
  let tenantB: SeededTenant;

  beforeAll(async () => {
    tenantA = await seedTenant('A');
    tenantB = await seedTenant('B');
  });

  afterAll(async () => {
    if (tenantA) await purgeTenant(tenantA);
    if (tenantB) await purgeTenant(tenantB);
  });

  describe('control: the probe is actually wired up', () => {
    // Without this, every assertion below could pass simply because the caller is broken —
    // a test that denies everything proves nothing about isolation.
    it('lets tenant A read its OWN person, so denials below are meaningful', async () => {
      const caller = PersonsRouter.createCaller(ctxFor(tenantA));
      const result = await settle(caller.getById(tenantA.personId));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeTruthy();
        expect(result.value.first_name).toBe(tenantA.personFirstName);
      }
    });
  });

  describe('reads', () => {
    it("never returns another tenant's person by direct id", async () => {
      const caller = PersonsRouter.createCaller(ctxFor(tenantA));
      const result = await settle(caller.getById(tenantB.personId));

      // Throwing is fine. Returning B's row is the breach.
      if (result.ok) {
        expect(result.value ?? null).toBeNull();
      }
    });

    it("never includes another tenant's persons in a list read", async () => {
      const caller = PersonsRouter.createCaller(ctxFor(tenantA));
      const result = await settle(caller.getAll({}));

      expect(result.ok).toBe(true);
      if (result.ok) {
        const rows: Array<{ id?: unknown; first_name?: unknown }> = Array.isArray(result.value)
          ? result.value
          : ((result.value as { rows?: Array<{ id?: unknown; first_name?: unknown }> })?.rows ?? []);
        const ids = rows.map((r) => String(r.id));
        const names = rows.map((r) => String(r.first_name));

        expect(ids).not.toContain(tenantB.personId);
        expect(names).not.toContain(tenantB.personFirstName);
      }
    });

    it("never includes another tenant's households in a list read", async () => {
      const caller = HouseholdsRouter.createCaller(ctxFor(tenantA));
      const result = await settle(caller.getAll());

      expect(result.ok).toBe(true);
      if (result.ok) {
        const rows: Array<{ id?: unknown }> = Array.isArray(result.value)
          ? result.value
          : ((result.value as { rows?: Array<{ id?: unknown }> })?.rows ?? []);
        expect(rows.map((r) => String(r.id))).not.toContain(tenantB.householdId);
      }
    });
  });

  describe('writes', () => {
    it("never mutates another tenant's person", async () => {
      const caller = PersonsRouter.createCaller(ctxFor(tenantA));
      await settle(caller.update({ id: tenantB.personId, data: { first_name: 'PWNED' } }));

      // Whether the call threw or silently no-op'd, B's row must be untouched.
      const after = await readPersonRaw(tenantB.personId);
      expect(after?.first_name).toBe(tenantB.personFirstName);
    });

    it("never deletes another tenant's person", async () => {
      const caller = PersonsRouter.createCaller(ctxFor(tenantA));
      await settle(caller.delete(tenantB.personId));

      const after = await readPersonRaw(tenantB.personId);
      expect(after).toBeTruthy();
      expect(after?.first_name).toBe(tenantB.personFirstName);
    });
  });

  describe('session binding', () => {
    it("rejects a valid session token replayed against another tenant's id", async () => {
      // The classic forged-context attack: real credentials, swapped tenant_id. The session
      // lookup in `isAuthed` is itself tenant-scoped, so this must fail authentication rather
      // than silently granting access to tenant B.
      const forged = {
        auth: { tenant_id: tenantB.tenantId, user_id: tenantA.userId, session_id: tenantA.sessionToken },
      };
      const caller = PersonsRouter.createCaller(forged);
      const result = await settle(caller.getById(tenantB.personId));

      expect(result.ok).toBe(false);
    });
  });
});
