import { describe, expect, it } from 'vitest';

import { resolveAutomationSendConsent } from './automation-consent';

interface FakeResults {
  suppressed?: boolean;
  dnc?: boolean;
  subscriptions?: { status: string }[];
}

/** Minimal Kysely stand-in: each table resolves to its canned result, chain calls are inert. */
function fakeDb(results: FakeResults) {
  return {
    selectFrom(table: string) {
      const chain = {
        select: () => chain,
        where: () => chain,
        executeTakeFirst: async () => {
          if (table === 'email_suppressions') return results.suppressed ? { id: '1' } : undefined;
          if (table === 'persons') return results.dnc ? { id: '9' } : undefined;
          return undefined;
        },
        execute: async () => results.subscriptions ?? [],
      };
      return chain;
    },
    // Spec files run with no-explicit-any off (backend eslint config): test double for the handle.
  } as any;
}

const person = { id: '9', email: 'amira@example.org' };

describe('resolveAutomationSendConsent (relationship class)', () => {
  it('blocks a suppressed address first', async () => {
    const result = await resolveAutomationSendConsent(fakeDb({ suppressed: true }), '1', person, 'relationship');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/bounced or complained/);
  });

  it('blocks a do-not-contact person', async () => {
    const result = await resolveAutomationSendConsent(fakeDb({ dnc: true }), '1', person, 'relationship');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/do-not-contact/);
  });

  it('blocks someone unsubscribed from every campaign', async () => {
    const result = await resolveAutomationSendConsent(
      fakeDb({ subscriptions: [{ status: 'unsubscribed' }, { status: 'pending' }] }),
      '1',
      person,
      'relationship',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/unsubscribed/);
  });

  it('allows someone with at least one subscribed row', async () => {
    const result = await resolveAutomationSendConsent(
      fakeDb({ subscriptions: [{ status: 'unsubscribed' }, { status: 'subscribed' }] }),
      '1',
      person,
      'relationship',
    );
    expect(result.ok).toBe(true);
  });

  it('allows someone with no subscription history at all (relationship mail)', async () => {
    const result = await resolveAutomationSendConsent(fakeDb({}), '1', person, 'relationship');
    expect(result.ok).toBe(true);
  });
});

describe('resolveAutomationSendConsent (marketing class)', () => {
  it('still blocks a suppressed address and a do-not-contact person', async () => {
    expect((await resolveAutomationSendConsent(fakeDb({ suppressed: true }), '1', person, 'marketing')).ok).toBe(false);
    expect((await resolveAutomationSendConsent(fakeDb({ dnc: true }), '1', person, 'marketing')).ok).toBe(false);
  });

  it('blocks someone with no subscription history at all — the difference from relationship', async () => {
    const result = await resolveAutomationSendConsent(fakeDb({}), '1', person, 'marketing');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/never subscribed/);
  });

  it('blocks someone whose rows are all non-subscribed', async () => {
    const result = await resolveAutomationSendConsent(
      fakeDb({ subscriptions: [{ status: 'unsubscribed' }, { status: 'pending' }] }),
      '1',
      person,
      'marketing',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/unsubscribed/);
  });

  it('allows someone with at least one subscribed row', async () => {
    const result = await resolveAutomationSendConsent(
      fakeDb({ subscriptions: [{ status: 'subscribed' }] }),
      '1',
      person,
      'marketing',
    );
    expect(result.ok).toBe(true);
  });
});
