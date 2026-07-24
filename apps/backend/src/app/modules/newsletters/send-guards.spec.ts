import { describe, expect, it, vi } from 'vitest';

import {
  FREE_WARMUP_DAILY_CAP,
  FREE_WARMUP_DAYS,
  TRIPWIRE_MIN_RECIPIENTS,
  applyAutomationTripwires,
  evaluateTripwires,
  hasPaymentHold,
  monthlyEmailCap,
  needsPhoneVerification,
  planKeyOf,
  sendWindow,
  warmupDailyCap,
  type SendingTenant,
} from './send-guards';

function tenantWith(overrides: Partial<SendingTenant>): SendingTenant {
  return {
    id: '1',
    plan: 'grassroots',
    subscription_quantity: 1,
    subscription_ends_at: null,
    subscription_status: 'active',
    created_at: null,
    suspended_at: null,
    sending_paused_at: null,
    sending_phone_verified_at: null,
    ...overrides,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe('planKeyOf', () => {
  it('resolves known plans and legacy aliases', () => {
    expect(planKeyOf('movement')).toBe('movement');
    expect(planKeyOf('Grassroots')).toBe('grassroots');
    expect(planKeyOf('starter')).toBe('free'); // legacy alias
  });

  it('fails closed to free for unknown or missing values', () => {
    expect(planKeyOf(null)).toBe('free');
    expect(planKeyOf(undefined)).toBe('free');
    expect(planKeyOf('who-knows')).toBe('free');
  });
});

describe('warmupDailyCap', () => {
  const now = new Date('2026-07-14T12:00:00Z');

  it('caps a brand-new free tenant', () => {
    const createdAt = new Date(now.getTime() - 1 * DAY_MS);
    expect(warmupDailyCap('free', createdAt, now)).toBe(FREE_WARMUP_DAILY_CAP);
  });

  it('lifts the cap once the warm-up window passes', () => {
    const createdAt = new Date(now.getTime() - (FREE_WARMUP_DAYS + 1) * DAY_MS);
    expect(warmupDailyCap('free', createdAt, now)).toBeNull();
  });

  it('still caps exactly at the boundary minus a millisecond', () => {
    const createdAt = new Date(now.getTime() - FREE_WARMUP_DAYS * DAY_MS + 1);
    expect(warmupDailyCap('free', createdAt, now)).toBe(FREE_WARMUP_DAILY_CAP);
  });

  it('never applies to paid plans, even brand-new ones', () => {
    const createdAt = new Date(now.getTime() - 1 * DAY_MS);
    expect(warmupDailyCap('grassroots', createdAt, now)).toBeNull();
    expect(warmupDailyCap('movement', createdAt, now)).toBeNull();
    expect(warmupDailyCap('enterprise', createdAt, now)).toBeNull();
  });

  it('fails closed when the creation date is unknown', () => {
    expect(warmupDailyCap('free', null, now)).toBe(FREE_WARMUP_DAILY_CAP);
  });
});

describe('monthlyEmailCap', () => {
  it('multiplies the billed bracket subscriber cap by the plan multiplier (2x/8x/12x)', () => {
    expect(monthlyEmailCap('free', 1)).toBe(2_000); // 1,000 × 2
    expect(monthlyEmailCap('grassroots', 1)).toBe(8_000); // 1,000 × 8
    expect(monthlyEmailCap('grassroots', 2)).toBe(20_000); // 2,500 × 8
    expect(monthlyEmailCap('movement', 6)).toBe(240_000); // 20,000 × 12
  });

  it('is uncapped for enterprise (no pricing ladder)', () => {
    expect(monthlyEmailCap('enterprise', 1)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('sendWindow', () => {
  it('meters the UTC calendar month when there is no billing cycle (free tenants)', () => {
    const { start, resetsAt } = sendWindow(null, new Date('2026-07-14T12:00:00Z'));
    expect(start.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(resetsAt.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('uses the current billing cycle on a monthly subscription', () => {
    const endsAt = new Date('2026-07-19T09:00:00Z'); // renewal 5 days from "now"
    const { start, resetsAt } = sendWindow(endsAt, new Date('2026-07-14T12:00:00Z'));
    expect(start.toISOString()).toBe('2026-06-19T09:00:00.000Z');
    expect(resetsAt.toISOString()).toBe('2026-07-19T09:00:00.000Z');
  });

  it('still resets monthly on an annual subscription (endsAt far in the future)', () => {
    const endsAt = new Date('2027-03-19T09:00:00Z');
    const { start, resetsAt } = sendWindow(endsAt, new Date('2026-07-14T12:00:00Z'));
    expect(start.toISOString()).toBe('2026-06-19T09:00:00.000Z');
    expect(resetsAt.toISOString()).toBe('2026-07-19T09:00:00.000Z');
  });

  it('steps forward so the window always contains now when the subscription has lapsed', () => {
    const endsAt = new Date('2026-03-19T09:00:00Z'); // months in the past
    const now = new Date('2026-07-14T12:00:00Z');
    const { start, resetsAt } = sendWindow(endsAt, now);
    expect(start <= now).toBe(true);
    expect(resetsAt > now).toBe(true);
    expect(start.toISOString()).toBe('2026-06-19T09:00:00.000Z');
    expect(resetsAt.toISOString()).toBe('2026-07-19T09:00:00.000Z');
  });

  // Regression: a 29th–31st billing anchor must not drift when stepping back through shorter months
  // (the old iterative setMonth turned "Feb 31" into early March, landing the meter days off cycle).
  it('does not drift a month-end anchor stepping through shorter months (annual, ends on the 31st)', () => {
    const endsAt = new Date('2027-05-31T09:00:00Z');
    const { start, resetsAt } = sendWindow(endsAt, new Date('2026-07-14T12:00:00Z'));
    expect(start.toISOString()).toBe('2026-06-30T09:00:00.000Z'); // June has 30 days → clamped, not July 1
    expect(resetsAt.toISOString()).toBe('2026-07-31T09:00:00.000Z');
  });

  it('clamps a 31st anchor to the target month length (February)', () => {
    const endsAt = new Date('2026-03-31T09:00:00Z');
    const { start, resetsAt } = sendWindow(endsAt, new Date('2026-02-15T12:00:00Z'));
    expect(start.toISOString()).toBe('2026-01-31T09:00:00.000Z');
    expect(resetsAt.toISOString()).toBe('2026-02-28T09:00:00.000Z'); // clamped to Feb 28, no overflow
  });
});

describe('hasPaymentHold', () => {
  it('holds a paid tenant whose subscription is past_due or unpaid', () => {
    expect(hasPaymentHold(tenantWith({ subscription_status: 'past_due' }))).toBe(true);
    expect(hasPaymentHold(tenantWith({ plan: 'movement', subscription_status: 'unpaid' }))).toBe(true);
  });

  it('never holds an active/trialing paid tenant', () => {
    expect(hasPaymentHold(tenantWith({ subscription_status: 'active' }))).toBe(false);
    expect(hasPaymentHold(tenantWith({ subscription_status: 'trialing' }))).toBe(false);
  });

  it('never holds free or enterprise tenants (no self-serve invoice to fail)', () => {
    expect(hasPaymentHold(tenantWith({ plan: 'free', subscription_status: 'past_due' }))).toBe(false);
    expect(hasPaymentHold(tenantWith({ plan: 'enterprise', subscription_status: 'unpaid' }))).toBe(false);
  });
});

describe('evaluateTripwires', () => {
  it('ignores sends below the minimum sample size', () => {
    expect(
      evaluateTripwires({ totalRecipients: TRIPWIRE_MIN_RECIPIENTS - 1, hardBounces: 10, spamReports: 10 }),
    ).toBeNull();
  });

  it('pauses on a hard-bounce rate above 5%', () => {
    expect(evaluateTripwires({ totalRecipients: 100, hardBounces: 6, spamReports: 0 })).toBe('pause');
  });

  it('does not pause at exactly 5%', () => {
    expect(evaluateTripwires({ totalRecipients: 100, hardBounces: 5, spamReports: 0 })).toBeNull();
  });

  it('suspends on a spam-complaint rate above 1%', () => {
    expect(evaluateTripwires({ totalRecipients: 100, hardBounces: 0, spamReports: 2 })).toBe('suspend');
  });

  it('does not suspend at exactly 1%', () => {
    expect(evaluateTripwires({ totalRecipients: 100, hardBounces: 0, spamReports: 1 })).toBeNull();
  });

  it('prefers suspension when both tripwires fire', () => {
    expect(evaluateTripwires({ totalRecipients: 100, hardBounces: 20, spamReports: 5 })).toBe('suspend');
  });

  it('stays quiet on a healthy send', () => {
    expect(evaluateTripwires({ totalRecipients: 1000, hardBounces: 10, spamReports: 0 })).toBeNull();
  });
});

describe('needsPhoneVerification', () => {
  it('requires verification only on Free without a verified number', () => {
    expect(needsPhoneVerification(tenantWith({ plan: 'free' }))).toBe(true);
    expect(needsPhoneVerification(tenantWith({ plan: 'free', sending_phone_verified_at: new Date() }))).toBe(false);
    expect(needsPhoneVerification(tenantWith({ plan: 'grassroots' }))).toBe(false);
  });
});

/**
 * Minimal Kysely stand-in for `applyAutomationTripwires`: the send-log SUM and the
 * workflow_runs bounce/complaint aggregate come back canned, and every `updateTable(...).set`
 * is recorded so the pause/suspend writes can be asserted.
 */
function makeTripwireDb(opts: { sent: number; hardBounces: number; spamReports: number }) {
  const updates: { table: string; values: Record<string, unknown> }[] = [];
  const selectBuilder = (table: string): Record<string, unknown> => {
    const b: Record<string, unknown> = {};
    b['select'] = vi.fn(() => b);
    b['where'] = vi.fn(() => b);
    b['executeTakeFirst'] = vi.fn(async () =>
      table === 'newsletter_send_log'
        ? { total: opts.sent }
        : { hard_bounces: opts.hardBounces, spam_reports: opts.spamReports },
    );
    return b;
  };
  const db = {
    selectFrom: vi.fn(selectBuilder),
    updateTable: vi.fn((table: string) => {
      const u: Record<string, unknown> = {};
      u['set'] = vi.fn((values: Record<string, unknown>): Record<string, unknown> => {
        updates.push({ table, values });
        return u;
      });
      u['where'] = vi.fn(() => u);
      u['execute'] = vi.fn(async () => []);
      return u;
    }),
  };
  return { db, updates };
}

describe('applyAutomationTripwires', () => {
  it('pauses sending when the automation hard-bounce rate exceeds 5%', async () => {
    const { db, updates } = makeTripwireDb({ sent: 100, hardBounces: 6, spamReports: 0 });
    await applyAutomationTripwires(db as any, '1');
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe('tenants');
    expect(updates[0].values['sending_paused_at']).toBeInstanceOf(Date);
    expect(updates[0].values['sending_paused_reason']).toBe('automation_hard_bounce_rate');
  });

  it('suspends the tenant when the automation spam-complaint rate exceeds 1%', async () => {
    const { db, updates } = makeTripwireDb({ sent: 100, hardBounces: 0, spamReports: 2 });
    await applyAutomationTripwires(db as any, '1');
    // suspendTenant sets suspended_at, then also pauses sending.
    expect(updates.map((u) => u.table)).toEqual(['tenants', 'tenants']);
    expect(updates[0].values['suspended_at']).toBeInstanceOf(Date);
    expect(updates[1].values['sending_paused_reason']).toBe('automation_spam_complaint_rate');
  });

  it('does nothing below the minimum sample, however bad the rates', async () => {
    const { db, updates } = makeTripwireDb({
      sent: TRIPWIRE_MIN_RECIPIENTS - 1,
      hardBounces: TRIPWIRE_MIN_RECIPIENTS - 1,
      spamReports: TRIPWIRE_MIN_RECIPIENTS - 1,
    });
    await applyAutomationTripwires(db as any, '1');
    expect(updates).toHaveLength(0);
    // Short-circuits after the send-log SUM — the runs aggregate is never queried.
    expect(db.selectFrom).toHaveBeenCalledTimes(1);
  });

  it('stays quiet exactly at the thresholds (5% bounces / 1% complaints)', async () => {
    const { db, updates } = makeTripwireDb({ sent: 100, hardBounces: 5, spamReports: 1 });
    await applyAutomationTripwires(db as any, '1');
    expect(updates).toHaveLength(0);
  });
});
