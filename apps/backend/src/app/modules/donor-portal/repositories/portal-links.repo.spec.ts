import { beforeEach, describe, expect, it } from 'vitest';

import { generateToken, hashToken } from '../../../lib/token-hash';
import { useTestTransaction } from '../../../lib/test-utils/db-test-isolation';
import { PortalLinksRepo } from './portal-links.repo';

/**
 * The giving-portal bearer tokens. Everything here runs inside a rolled-back test
 * transaction — the repo methods all accept a trx, so no rows ever reach the shared DB.
 *
 * The contract under test:
 *  - only a live link resolves (not expired, not revoked, actually minted);
 *  - the raw token never touches the table (sha256 at rest);
 *  - several live links per person coexist and die together on staff revocation;
 *  - statusForPerson counts live links only, while remembering every mint/use.
 */

const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

describe('PortalLinksRepo', () => {
  const ctx = useTestTransaction();
  const repo = new PortalLinksRepo();

  let tenantId: string;
  let personId: string;

  beforeEach(async () => {
    tenantId = rand();
    const userId = rand();
    const householdId = rand();

    await ctx.trx.insertInto('tenants').values({ id: tenantId, name: 'Portal Links Tenant' }).execute();
    await ctx.trx
      .insertInto('authusers')
      .values({
        id: userId,
        tenant_id: tenantId,
        email: `portal-links-${userId}@example.com`,
        password: 'password',
        first_name: 'Portal',
        last_name: 'Admin',
        verified: true,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    await ctx.trx
      .insertInto('households')
      .values({ id: householdId, tenant_id: tenantId, createdby_id: userId, updatedby_id: userId })
      .execute();
    const person = await ctx.trx
      .insertInto('persons')
      .values({
        tenant_id: tenantId,
        household_id: householdId,
        first_name: 'Dana',
        last_name: 'Donor',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    personId = String(person.id);
  });

  it('resolves a freshly minted token to its tenant and person', async () => {
    const minted = await repo.mint({ tenant_id: tenantId, person_id: personId }, ctx.trx);

    const resolved = await repo.resolveByToken(minted.token, ctx.trx);

    expect(resolved).not.toBeNull();
    expect(resolved?.tenant_id).toBe(tenantId);
    expect(resolved?.person_id).toBe(personId);
    expect(resolved?.id).toBeTruthy();
  });

  it('does not resolve an expired link', async () => {
    const minted = await repo.mint({ tenant_id: tenantId, person_id: personId }, ctx.trx);
    await ctx.trx
      .updateTable('donor_portal_links')
      .set({ expires_at: new Date(Date.now() - 60_000) })
      .where('tenant_id', '=', tenantId)
      .where('person_id', '=', personId)
      .execute();

    expect(await repo.resolveByToken(minted.token, ctx.trx)).toBeNull();
  });

  it('does not resolve a revoked link', async () => {
    const minted = await repo.mint({ tenant_id: tenantId, person_id: personId }, ctx.trx);
    await ctx.trx
      .updateTable('donor_portal_links')
      .set({ revoked_at: new Date() })
      .where('tenant_id', '=', tenantId)
      .where('person_id', '=', personId)
      .execute();

    expect(await repo.resolveByToken(minted.token, ctx.trx)).toBeNull();
  });

  it('does not resolve a token that was never minted', async () => {
    expect(await repo.resolveByToken(generateToken(), ctx.trx)).toBeNull();
  });

  it('stores the sha256 hash, never the raw bearer token', async () => {
    const minted = await repo.mint({ tenant_id: tenantId, person_id: personId }, ctx.trx);

    const row = await ctx.trx
      .selectFrom('donor_portal_links')
      .select('token_hash')
      .where('tenant_id', '=', tenantId)
      .where('person_id', '=', personId)
      .executeTakeFirstOrThrow();

    expect(row.token_hash).not.toBe(minted.token);
    expect(row.token_hash).toBe(hashToken(minted.token));
  });

  it('keeps two live links working independently — minting a second must not kill the first', async () => {
    const first = await repo.mint({ tenant_id: tenantId, person_id: personId }, ctx.trx);
    const second = await repo.mint({ tenant_id: tenantId, person_id: personId }, ctx.trx);

    const resolvedFirst = await repo.resolveByToken(first.token, ctx.trx);
    const resolvedSecond = await repo.resolveByToken(second.token, ctx.trx);

    expect(resolvedFirst?.person_id).toBe(personId);
    expect(resolvedSecond?.person_id).toBe(personId);
    expect(resolvedFirst?.id).not.toBe(resolvedSecond?.id);
  });

  it('revokeAllForPerson kills every live link at once', async () => {
    const first = await repo.mint({ tenant_id: tenantId, person_id: personId }, ctx.trx);
    const second = await repo.mint({ tenant_id: tenantId, person_id: personId }, ctx.trx);

    const revoked = await repo.revokeAllForPerson({ tenant_id: tenantId, person_id: personId }, ctx.trx);

    expect(revoked).toBe(2);
    expect(await repo.resolveByToken(first.token, ctx.trx)).toBeNull();
    expect(await repo.resolveByToken(second.token, ctx.trx)).toBeNull();
  });

  it('statusForPerson counts only live links while remembering every mint', async () => {
    // One live, one expired, one revoked — only the first is "live".
    await repo.mint({ tenant_id: tenantId, person_id: personId }, ctx.trx);
    const expired = await repo.mint({ tenant_id: tenantId, person_id: personId }, ctx.trx);
    const revoked = await repo.mint({ tenant_id: tenantId, person_id: personId }, ctx.trx);
    await ctx.trx
      .updateTable('donor_portal_links')
      .set({ expires_at: new Date(Date.now() - 60_000) })
      .where('token_hash', '=', hashToken(expired.token))
      .execute();
    await ctx.trx
      .updateTable('donor_portal_links')
      .set({ revoked_at: new Date() })
      .where('token_hash', '=', hashToken(revoked.token))
      .execute();

    const status = await repo.statusForPerson({ tenant_id: tenantId, person_id: personId }, ctx.trx);

    expect(status.live_count).toBe(1);
    expect(status.last_created_at).not.toBeNull();
    expect(status.expires_at).not.toBeNull();
    // Nothing ever opened one of these links.
    expect(status.last_used_at).toBeNull();
  });
});
