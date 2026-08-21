import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BaseRepository } from '../../lib/base.repo';
import { HouseholdRepo } from '../households/repositories/households.repo';
import { PersonsRepo } from '../persons/repositories/persons.repo';

/**
 * End-to-end proof of the activity-history rule fields (engagement-stats.ts) against real
 * Postgres: the numeric operators compile, the pstats/hstats laterals correlate to the right
 * rows, campaign scoping holds, and NULL reads as "never happened". This is the spec that
 * catches a broken lateral or a silently-dropped rule — the frontend parity spec only proves
 * the field NAMES line up.
 */

const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number): Date => new Date(Date.now() - n * DAY_MS);

interface Seed {
  tenantId: string;
  userId: string;
  campaignA: string;
  campaignB: string;
  household1: string;
  household2: string;
  personActive: string;
  personQuiet: string;
}

async function seed(db: typeof BaseRepository.dbInstance): Promise<Seed> {
  const tenantId = rand();
  const userId = rand();
  const campaignA = rand();
  const campaignB = rand();
  const household1 = rand();
  const household2 = rand();
  const personActive = rand();
  const personQuiet = rand();

  await db.insertInto('tenants').values({ id: tenantId, name: 'Rule Fields Test' }).execute();
  await db
    .insertInto('authusers')
    .values({
      id: userId,
      tenant_id: tenantId,
      email: `t-${userId}@example.com`,
      password: 'x',
      first_name: 'Rule',
      last_name: 'Tester',
      verified: true,
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();
  for (const id of [campaignA, campaignB]) {
    await db
      .insertInto('campaigns')
      .values({
        id,
        tenant_id: tenantId,
        admin_id: userId,
        name: `C-${id}`,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
  }
  for (const [id, num] of [
    [household1, '1'],
    [household2, '2'],
  ] as const) {
    await db
      .insertInto('households')
      .values({
        id,
        tenant_id: tenantId,
        campaign_id: campaignA,
        street_num: num,
        street1: 'Elm St',
        city: 'Testville',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
  }
  for (const [id, householdId, first, email] of [
    [personActive, household1, 'Avery', `active-${personActive}@example.com`],
    [personQuiet, household2, 'Quinn', `quiet-${personQuiet}@example.com`],
  ] as const) {
    await db
      .insertInto('persons')
      .values({
        id,
        tenant_id: tenantId,
        campaign_id: campaignA,
        household_id: householdId,
        first_name: first,
        last_name: 'Person',
        email,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
  }

  // Donations for the active person in campaign A: $150.00 five days ago (this year) and an
  // old gift 400 days ago — so last-donation recency and this-year total diverge.
  await db
    .insertInto('donations')
    .values([
      {
        tenant_id: tenantId,
        campaign_id: campaignA,
        person_id: personActive,
        amount: 15000,
        status: 'succeeded',
        created_at: daysAgo(5),
      },
      {
        tenant_id: tenantId,
        campaign_id: campaignA,
        person_id: personActive,
        amount: 5000,
        status: 'succeeded',
        created_at: daysAgo(400),
      },
    ])
    .execute();
  await db
    .insertInto('donation_pledges')
    .values({
      tenant_id: tenantId,
      campaign_id: campaignA,
      person_id: personActive,
      monthly_amount: 2500,
      status: 'active',
    })
    .execute();

  // A knock on household 1's door three days ago, on a campaign-A turf.
  const turfId = rand();
  await db
    .insertInto('turfs')
    .values({
      id: turfId,
      tenant_id: tenantId,
      campaign_id: campaignA,
      name: 'Turf 1',
      status: 'active',
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();
  await db
    .insertInto('turf_knocks')
    .values({
      tenant_id: tenantId,
      turf_id: turfId,
      household_id: household1,
      outcome: 'conversation',
      source: 'companion',
      knocked_at: daysAgo(3),
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();

  // A newsletter open ten days ago, keyed by the active person's email.
  const newsletterId = rand();
  await db
    .insertInto('newsletters')
    .values({
      id: newsletterId,
      tenant_id: tenantId,
      campaign_id: campaignA,
      name: 'Test letter',
      status: 'sent',
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();
  await db
    .insertInto('person_newsletter_engagements')
    .values({
      tenant_id: tenantId,
      newsletter_id: newsletterId,
      email: `active-${personActive}@example.com`,
      open_count: 2,
      click_count: 0,
      has_unsubscribed: false,
      hard_bounced: false,
      soft_bounced: false,
      first_opened_at: daysAgo(30),
      last_opened_at: daysAgo(10),
    })
    .execute();

  // An event registration 20 days ago (campaign A event).
  const eventId = rand();
  await db
    .insertInto('events')
    .values({
      id: eventId,
      tenant_id: tenantId,
      campaign_id: campaignA,
      name: 'Rally',
      slug: `rally-${eventId}`,
      start_time: daysAgo(15),
      end_time: daysAgo(15),
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();
  await db
    .insertInto('event_registrations')
    .values({
      tenant_id: tenantId,
      event_id: eventId,
      person_id: personActive,
      status: 'attended',
      created_at: daysAgo(20),
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();

  // A volunteer shift that started seven days ago, attended.
  const shiftEventId = rand();
  await db
    .insertInto('volunteer_events')
    .values({
      id: shiftEventId,
      tenant_id: tenantId,
      name: 'Phone bank',
      slug: `phone-bank-${shiftEventId}`,
      start_time: daysAgo(7),
      end_time: daysAgo(7),
      is_private: false,
      send_reminder: false,
      send_signup_confirmation: false,
      send_volunteer_alert: false,
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();
  await db
    .insertInto('volunteer_shifts')
    .values({
      tenant_id: tenantId,
      event_id: shiftEventId,
      person_id: personActive,
      status: 'attended',
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();

  return { tenantId, userId, campaignA, campaignB, household1, household2, personActive, personQuiet };
}

async function cleanup(db: typeof BaseRepository.dbInstance, tenantId: string): Promise<void> {
  await db.deleteFrom('volunteer_shifts').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('volunteer_events').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('event_registrations').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('events').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('person_newsletter_engagements').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('newsletters').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('turf_knocks').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('turfs').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('donation_pledges').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('donations').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('persons').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('households').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
  await db.updateTable('tenants').set({ admin_id: null, createdby_id: null }).where('id', '=', tenantId).execute();
  await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
}

function ruleModel(field: string, op: string, value: string) {
  return {
    kind: 'group' as const,
    id: 'root',
    conjunction: 'AND' as const,
    rules: [{ kind: 'rule' as const, id: 'r1', field, op, value }],
  };
}

describe('activity-history rule fields (engagement-stats laterals + numeric operators)', () => {
  const personsRepo = new PersonsRepo();
  const householdsRepo = new HouseholdRepo();
  const db = BaseRepository.dbInstance;
  let s: Seed;

  beforeEach(async () => {
    s = await seed(db);
  });

  afterEach(async () => {
    await cleanup(db, s.tenantId);
  });

  async function matchingPersonIds(field: string, op: string, value: string, campaignId?: string): Promise<string[]> {
    const res = await personsRepo.getAllWithAddress({
      tenant_id: s.tenantId,
      options: { campaignId: campaignId ?? s.campaignA, advancedFilterModel: ruleModel(field, op, value) },
    });
    return res.rows.map((r) => String(r['id'])).sort();
  }

  it('last_donation_days: "is at most 30" matches the recent donor only; "is not set" matches the never-donor', async () => {
    expect(await matchingPersonIds('last_donation_days', 'lte', '30')).toEqual([s.personActive]);
    expect(await matchingPersonIds('last_donation_days', 'gt', '30')).toEqual([]);
    expect(await matchingPersonIds('last_donation_days', 'isEmpty', '')).toEqual([s.personQuiet]);
  });

  it('donation_total_year sums only this calendar year, in dollars', async () => {
    // $150 five days ago counts; the $50 gift 400 days ago does not.
    expect(await matchingPersonIds('donation_total_year', 'gte', '100')).toEqual([s.personActive]);
    expect(await matchingPersonIds('donation_total_year', 'gte', '151')).toEqual([]);
  });

  it('has_active_pledge answers yes/no through the boolean cast', async () => {
    expect(await matchingPersonIds('has_active_pledge', 'eq', 'true')).toEqual([s.personActive]);
    expect(await matchingPersonIds('has_active_pledge', 'eq', 'false')).toEqual([s.personQuiet]);
  });

  it('last_knock_days reads the household door through the campaign turf', async () => {
    expect(await matchingPersonIds('last_knock_days', 'lte', '10')).toEqual([s.personActive]);
    expect(await matchingPersonIds('last_knock_days', 'isEmpty', '')).toEqual([s.personQuiet]);
  });

  it('last_newsletter_open_days keys on the person email', async () => {
    expect(await matchingPersonIds('last_newsletter_open_days', 'lte', '30')).toEqual([s.personActive]);
    expect(await matchingPersonIds('last_newsletter_open_days', 'gt', '30')).toEqual([]);
  });

  it('last_event_days counts non-cancelled registrations on this campaign', async () => {
    expect(await matchingPersonIds('last_event_days', 'lte', '30')).toEqual([s.personActive]);
    expect(await matchingPersonIds('last_event_days', 'lte', '10')).toEqual([]);
  });

  it('last_shift_days measures the shift date, not the signup', async () => {
    expect(await matchingPersonIds('last_shift_days', 'lte', '10')).toEqual([s.personActive]);
    expect(await matchingPersonIds('last_shift_days', 'lte', '3')).toEqual([]);
  });

  it('campaign scoping: another campaign sees no donations, knocks or events', async () => {
    expect(await matchingPersonIds('last_donation_days', 'lte', '3650', s.campaignB)).toEqual([]);
    expect(await matchingPersonIds('last_knock_days', 'lte', '3650', s.campaignB)).toEqual([]);
    expect(await matchingPersonIds('last_event_days', 'lte', '3650', s.campaignB)).toEqual([]);
    // Newsletter opens and shifts are deliberately workspace-wide.
    expect(await matchingPersonIds('last_newsletter_open_days', 'lte', '3650', s.campaignB)).toEqual([s.personActive]);
    expect(await matchingPersonIds('last_shift_days', 'lte', '3650', s.campaignB)).toEqual([s.personActive]);
  });

  it('an unparseable numeric value drops the rule (matches everyone) instead of erroring', async () => {
    expect(await matchingPersonIds('last_donation_days', 'lte', 'abc')).toEqual([s.personActive, s.personQuiet].sort());
  });

  it('household lists get knock recency too', async () => {
    const res = await householdsRepo.getAllWithPeopleCount({
      tenant_id: s.tenantId,
      options: { campaignId: s.campaignA, advancedFilterModel: ruleModel('last_knock_days', 'lte', '10') },
    });
    expect(res.rows.map((r) => String(r['id']))).toEqual([s.household1]);
    const never = await householdsRepo.getAllWithPeopleCount({
      tenant_id: s.tenantId,
      options: { campaignId: s.campaignA, advancedFilterModel: ruleModel('last_knock_days', 'isEmpty', '') },
    });
    expect(never.rows.map((r) => String(r['id']))).toEqual([s.household2]);
  });

  it('the preview rows carry the stat columns the rules filter on (select parity)', async () => {
    const res = await personsRepo.getAllWithAddress({
      tenant_id: s.tenantId,
      options: { campaignId: s.campaignA, advancedFilterModel: ruleModel('last_donation_days', 'lte', '30') },
    });
    const row = res.rows.find((r) => String(r['id']) === s.personActive);
    expect(row).toBeDefined();
    expect(Number(row?.['last_donation_days'])).toBe(5);
    expect(Number(row?.['donation_total_year'])).toBe(150);
    expect(row?.['has_active_pledge']).toBe(true);
    expect(Number(row?.['last_knock_days'])).toBe(3);
  });
});
