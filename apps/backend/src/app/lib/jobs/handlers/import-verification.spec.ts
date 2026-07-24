import type { Kysely } from 'kysely';
import { describe, expect, it, vi } from 'vitest';

import type { Models } from '../../../../../../../libs/common/src/lib/kysely.models';
import type { DomainResolver } from '../../mail/email-verifier.service';
import { EmailVerifierService } from '../../mail/email-verifier.service';
import { runImportEmailVerification } from './import-verification';

function dnsError(code: string): Error & { code: string } {
  const err = new Error(code) as Error & { code: string };
  err.code = code;
  return err;
}

/** Resolver where every domain is dead except those listed as ok. */
function resolverWhereOk(okDomains: string[]): DomainResolver {
  const ok = new Set(okDomains);
  return {
    resolveMx: vi.fn(async (domain: string) => (ok.has(domain) ? [{ exchange: 'mx1' }] : [])),
    resolve4: vi.fn(async (domain: string) => {
      if (ok.has(domain)) return ['1.2.3.4'];
      throw dnsError('ENOTFOUND');
    }),
    resolve6: vi.fn(async (domain: string) => {
      if (ok.has(domain)) return ['::1'];
      throw dnsError('ENOTFOUND');
    }),
  };
}

/** Minimal Kysely stand-in recording inserts/updates; canned select rows per table. */
function makeFakeDb(selectRows: Record<string, unknown[]>) {
  const inserts: { table: string; values: unknown }[] = [];
  const updates: { table: string; values: Record<string, unknown> }[] = [];

  const makeBuilder = (table: string): Record<string, unknown> => {
    const b: Record<string, unknown> = {};
    const chain = (): Record<string, unknown> => b;
    for (const m of ['select', 'where', 'onConflict']) b[m] = vi.fn(chain);
    b['set'] = vi.fn((values: Record<string, unknown>) => {
      updates.push({ table, values });
      return b;
    });
    b['values'] = vi.fn((values: unknown) => {
      inserts.push({ table, values });
      return b;
    });
    b['execute'] = vi.fn(async () => selectRows[table] ?? []);
    return b;
  };

  const db = {
    selectFrom: vi.fn((t: string) => makeBuilder(t)),
    insertInto: vi.fn((t: string) => makeBuilder(t)),
    updateTable: vi.fn((t: string) => makeBuilder(t)),
  } as unknown as Kysely<Models>;

  return { db, inserts, updates };
}

const PAYLOAD = { tenant_id: '42', import_id: 'imp1', user_id: 'u1' };

describe('runImportEmailVerification', () => {
  it('suppresses dead-domain and disposable emails with reason "invalid", lowercased', async () => {
    const { db, inserts, updates } = makeFakeDb({ email_suppressions: [] });
    const verifier = new EmailVerifierService(resolverWhereOk(['acme.org']));

    const summary = await runImportEmailVerification(
      db,
      PAYLOAD,
      [{ email: 'Jane@ACME.org' }, { email: 'bob@dead-zzz.com', email2: 'x@mailinator.com' }],
      verifier,
    );

    expect(summary).not.toBeNull();
    const suppressionInserts = inserts.filter((i) => i.table === 'email_suppressions');
    const inserted = suppressionInserts.flatMap((i) => i.values as Array<{ email: string; reason: string }>);
    const emails = inserted.map((v) => v.email).sort();
    expect(emails).toEqual(['bob@dead-zzz.com', 'x@mailinator.com']);
    expect(inserted.every((v) => v.reason === 'invalid')).toBe(true);
    // Summary persisted onto data_imports.
    expect(updates.some((u) => u.table === 'data_imports' && 'email_verification' in u.values)).toBe(true);
    expect(summary?.dead_domain).toBe(1);
    expect(summary?.disposable).toBe(1);
    expect(summary?.valid).toBe(1);
  });

  it('excludes already-suppressed addresses from new inserts', async () => {
    const { db, inserts } = makeFakeDb({ email_suppressions: [{ email: 'bob@dead-zzz.com' }] });
    const verifier = new EmailVerifierService(resolverWhereOk([]));

    const summary = await runImportEmailVerification(db, PAYLOAD, [{ email: 'bob@dead-zzz.com' }], verifier);

    expect(inserts.filter((i) => i.table === 'email_suppressions')).toHaveLength(0);
    expect(summary?.already_suppressed).toBe(1);
    expect(summary?.suppressed_new).toBe(0);
  });

  it('returns null when there are no valid emails', async () => {
    const { db } = makeFakeDb({ email_suppressions: [] });
    const verifier = new EmailVerifierService(resolverWhereOk([]));
    expect(await runImportEmailVerification(db, PAYLOAD, [{ email: 'not-an-email' }], verifier)).toBeNull();
  });

  it('pauses sending when the bad-email rate is egregious', async () => {
    const { db, updates } = makeFakeDb({ email_suppressions: [] });
    const verifier = new EmailVerifierService(resolverWhereOk([]));
    // 100 emails, all dead → 100% bad → pause band.
    const rows = Array.from({ length: 100 }, (_, i) => ({ email: `user${i}@dead-zzz-${i}.com` }));

    const summary = await runImportEmailVerification(db, PAYLOAD, rows, verifier);

    expect(summary?.tripwire).toBe('pause');
    const tenantUpdate = updates.find((u) => u.table === 'tenants');
    expect(tenantUpdate).toBeDefined();
    expect(tenantUpdate?.values['sending_paused_reason']).toBe('import_bad_email_rate:imp1');
  });

  it('does not pause below the minimum sample even if every address is bad', async () => {
    const { db, updates } = makeFakeDb({ email_suppressions: [] });
    const verifier = new EmailVerifierService(resolverWhereOk([]));
    const rows = Array.from({ length: 20 }, (_, i) => ({ email: `user${i}@dead-zzz-${i}.com` }));

    const summary = await runImportEmailVerification(db, PAYLOAD, rows, verifier);

    expect(summary?.tripwire).toBe('none');
    expect(updates.find((u) => u.table === 'tenants')).toBeUndefined();
  });

  it('returns null (fail-open) when a DB write throws', async () => {
    const { db } = makeFakeDb({ email_suppressions: [] });
    (db.updateTable as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('db down');
    });
    const verifier = new EmailVerifierService(resolverWhereOk(['acme.org']));
    expect(await runImportEmailVerification(db, PAYLOAD, [{ email: 'jane@acme.org' }], verifier)).toBeNull();
  });
});
