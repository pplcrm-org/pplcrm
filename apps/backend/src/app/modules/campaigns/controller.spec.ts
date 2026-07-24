import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CampaignsController } from './controller';
import { CampaignsRepo } from './repositories/campaigns.repo';
import { BaseRepository } from '../../lib/base.repo';
import { BadRequestError, NotFoundError } from '../../errors/app-errors';
import type { IAuthKeyPayload } from '@common';

function rand() {
  return String(Math.floor(Math.random() * 100000000) + 10000000);
}

async function createTestSeed(db: any) {
  const tenantId = rand();
  const userId = rand();
  const officeId = rand();

  await db.insertInto('tenants').values({ id: tenantId, name: 'Test Tenant' }).execute();

  await db
    .insertInto('authusers')
    .values({
      id: userId,
      tenant_id: tenantId,
      email: `test-${userId}@example.com`,
      password: 'password',
      first_name: 'Test',
      last_name: 'User',
      verified: true,
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();

  // kind defaults to 'office' — this is the permanent context every tenant has.
  await db
    .insertInto('campaigns')
    .values({
      id: officeId,
      tenant_id: tenantId,
      admin_id: userId,
      name: 'Test Office',
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();

  await db.updateTable('tenants').set({ admin_id: userId, createdby_id: userId }).where('id', '=', tenantId).execute();

  return { tenantId, userId, officeId };
}

async function cleanTenant(db: any, tenantId: string) {
  await db.updateTable('tenants').set({ admin_id: null, createdby_id: null }).where('id', '=', tenantId).execute();
  await db.deleteFrom('user_activity').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('profiles').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('campaign_subscriptions').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('email_suppressions').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('campaign_person_facts').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('delivery_route_stops').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('delivery_requests').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('delivery_routes').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('persons').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('households').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
}

async function createPerson(db: any, tenantId: string, campaignId: string, userId: string): Promise<string> {
  const household = await db
    .insertInto('households')
    .values({ tenant_id: tenantId, campaign_id: campaignId, createdby_id: userId, updatedby_id: userId })
    .returning('id')
    .executeTakeFirstOrThrow();
  const person = await db
    .insertInto('persons')
    .values({
      tenant_id: tenantId,
      campaign_id: campaignId,
      household_id: household.id,
      first_name: `Person-${rand()}`,
      last_name: 'Facts',
      createdby_id: userId,
      updatedby_id: userId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return String(person.id);
}

describe('CampaignsController', () => {
  const controller = new CampaignsController();
  const db = (BaseRepository as any)._db;
  let tenantId: string;
  let userId: string;
  let officeId: string;
  let auth: IAuthKeyPayload;

  beforeEach(async () => {
    const seed = await createTestSeed(db);
    tenantId = seed.tenantId;
    userId = seed.userId;
    officeId = seed.officeId;

    auth = {
      tenant_id: tenantId,
      user_id: userId,
      name: 'Test User',
      session_id: 'test-session',
    } as IAuthKeyPayload;
  });

  afterEach(async () => {
    await cleanTenant(db, tenantId);
  });

  it('creates an election campaign as active', async () => {
    const created = await controller.addCampaign(
      { name: 'Riverdale 2026', kind: 'election', description: null, notes: null, startdate: null, enddate: null },
      auth,
    );
    expect(created).toBeTruthy();

    const rows = await controller.getSwitcherList(auth);
    const election = rows.find((c) => c.name === 'Riverdale 2026');
    expect(election?.kind).toBe('election');
    expect(election?.status).toBe('active');
  });

  it('refuses a second office context', async () => {
    await expect(
      controller.addCampaign(
        { name: 'Second Office', kind: 'office', description: null, notes: null, startdate: null, enddate: null },
        auth,
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('archives and unarchives an election but never the office', async () => {
    await controller.addCampaign(
      { name: 'Race', kind: 'election', description: null, notes: null, startdate: null, enddate: null },
      auth,
    );
    const rows = await controller.getSwitcherList(auth);
    const election = rows.find((c) => c.kind === 'election');
    expect(election).toBeTruthy();
    // election must exist per the assertion above; String() also guards undefined
    const electionId = String(election?.id);

    await controller.archive(electionId, auth);
    let refreshed = await controller.getSwitcherList(auth);
    expect(refreshed.find((c) => String(c.id) === electionId)?.status).toBe('archived');

    await controller.unarchive(electionId, auth);
    refreshed = await controller.getSwitcherList(auth);
    expect(refreshed.find((c) => String(c.id) === electionId)?.status).toBe('active');

    await expect(controller.archive(officeId, auth)).rejects.toBeInstanceOf(BadRequestError);
  });

  it('pins editors to their assigned campaign and reverts them to office on archive', async () => {
    await controller.addCampaign(
      { name: 'Pin Race', kind: 'election', description: null, notes: null, startdate: null, enddate: null },
      auth,
    );
    const rows = await controller.getSwitcherList(auth);
    const electionId = String(rows.find((c) => c.kind === 'election')?.id);

    await db.updateTable('authusers').set({ campaign_id: electionId }).where('id', '=', userId).execute();

    // Editor: exactly the assigned campaign, no switching surface.
    const editorAuth = { ...auth, role: 'user' } as IAuthKeyPayload;
    let ctx = await controller.getContext(editorAuth);
    expect(ctx.active_campaign_id).toBe(electionId);
    expect(ctx.campaigns).toHaveLength(1);

    // Admin: every campaign stays visible.
    const adminCtx = await controller.getContext({ ...auth, role: 'admin' } as IAuthKeyPayload);
    expect(adminCtx.campaigns.length).toBeGreaterThan(1);

    // Archiving the election clears its members back to the office context.
    await controller.archive(electionId, auth);
    const me = await db.selectFrom('authusers').select('campaign_id').where('id', '=', userId).executeTakeFirst();
    expect(me?.campaign_id).toBeNull();
    ctx = await controller.getContext(editorAuth);
    expect(ctx.active_campaign_id).toBe(officeId);
  });

  it('archiving declines the campaign’s open yard-sign requests and cancels its live routes', async () => {
    await controller.addCampaign(
      { name: 'Sweep Race', kind: 'election', description: null, notes: null, startdate: null, enddate: null },
      auth,
    );
    const rows = await controller.getSwitcherList(auth);
    const electionId = String(rows.find((c) => c.name === 'Sweep Race')?.id);

    // One open request sitting on a live (assigned) route of the same campaign.
    const household = await db
      .insertInto('households')
      .values({ tenant_id: tenantId, campaign_id: electionId, createdby_id: userId, updatedby_id: userId })
      .returning('id')
      .executeTakeFirstOrThrow();
    const request = await db
      .insertInto('delivery_requests')
      .values({
        tenant_id: tenantId,
        campaign_id: electionId,
        household_id: household.id,
        source: 'manual',
        status: 'approved',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const route = await db
      .insertInto('delivery_routes')
      .values({
        tenant_id: tenantId,
        campaign_id: electionId,
        name: 'Sweep route',
        status: 'assigned',
        start_address: '1 Test Way',
        start_lat: 45.0,
        start_lng: -75.0,
        est_minutes: 10,
        est_km: 2,
        params: JSON.stringify({}),
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const stop = await db
      .insertInto('delivery_route_stops')
      .values({
        tenant_id: tenantId,
        route_id: route.id,
        request_id: request.id,
        seq: 1,
        leg_minutes: 2,
        status: 'pending',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await controller.archive(electionId, auth);

    // Archived campaign no longer holds the household's one-open-request slot: the request is
    // declined, its stop skipped, and the route canceled.
    const afterRequest = await db
      .selectFrom('delivery_requests')
      .select('status')
      .where('id', '=', request.id)
      .executeTakeFirstOrThrow();
    expect(afterRequest.status).toBe('declined');
    const afterStop = await db
      .selectFrom('delivery_route_stops')
      .select('status')
      .where('id', '=', stop.id)
      .executeTakeFirstOrThrow();
    expect(afterStop.status).toBe('skipped');
    const afterRoute = await db
      .selectFrom('delivery_routes')
      .select('status')
      .where('id', '=', route.id)
      .executeTakeFirstOrThrow();
    expect(afterRoute.status).toBe('canceled');

    // The household's activity feed records the auto-decline (honest attribution).
    const activity = await db
      .selectFrom('user_activity')
      .select(['metadata'])
      .where('tenant_id', '=', tenantId)
      .where('entity', '=', 'households')
      .where('entity_id', '=', String(household.id))
      .execute();
    const declines = activity.filter(
      (r: { metadata: unknown }) => (r.metadata as { action?: string })?.action === 'yard_sign_status',
    );
    expect(declines.length).toBeGreaterThan(0);

    // The household is free again: a new campaign can record a fresh request.
    const fresh = await db
      .insertInto('delivery_requests')
      .values({
        tenant_id: tenantId,
        campaign_id: officeId,
        household_id: household.id,
        source: 'manual',
        status: 'new',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    expect(fresh.id).toBeTruthy();
  });

  it('never hard-deletes campaigns', async () => {
    await expect(controller.delete()).rejects.toBeInstanceOf(BadRequestError);
    await expect(controller.deleteMany()).rejects.toBeInstanceOf(BadRequestError);
  });

  it('falls back to the office context when no preference is stored', async () => {
    const ctx = await controller.getContext(auth);
    expect(ctx.active_campaign_id).toBe(officeId);
    expect(ctx.campaigns.some((c) => c.id === officeId)).toBe(true);
  });

  it('rejects switching to a campaign from another tenant', async () => {
    await expect(controller.setActiveCampaign('999999999', auth)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('upserts person facts independently and clears back to Unknown', async () => {
    const personId = await createPerson(db, tenantId, officeId, userId);

    // Set support only — voting stays Unknown.
    await controller.upsertPersonFact({ campaign_id: officeId, person_id: personId, support_level: 'leaning' }, auth);
    let facts = await controller.getPersonFacts(personId, auth);
    expect(facts).toHaveLength(1);
    expect(facts[0]?.support_level).toBe('leaning');
    expect(facts[0]?.voting_status).toBeNull();

    // Set voting — the earlier support reading must survive.
    await controller.upsertPersonFact(
      { campaign_id: officeId, person_id: personId, voting_status: 'voted_advance' },
      auth,
    );
    facts = await controller.getPersonFacts(personId, auth);
    expect(facts[0]?.support_level).toBe('leaning');
    expect(facts[0]?.voting_status).toBe('voted_advance');

    // Explicit null resets to Unknown without touching the other fact.
    await controller.upsertPersonFact({ campaign_id: officeId, person_id: personId, support_level: null }, auth);
    facts = await controller.getPersonFacts(personId, auth);
    expect(facts[0]?.support_level).toBeNull();
    expect(facts[0]?.voting_status).toBe('voted_advance');
  });

  it('keeps facts independent per campaign', async () => {
    const personId = await createPerson(db, tenantId, officeId, userId);
    await controller.addCampaign(
      { name: 'Race 2026', kind: 'election', description: null, notes: null, startdate: null, enddate: null },
      auth,
    );
    const rows = await controller.getSwitcherList(auth);
    const electionId = String(rows.find((c) => c.kind === 'election')?.id);

    await controller.upsertPersonFact({ campaign_id: officeId, person_id: personId, support_level: 'strong' }, auth);
    await controller.upsertPersonFact({ campaign_id: electionId, person_id: personId, support_level: 'against' }, auth);

    const facts = await controller.getPersonFacts(personId, auth);
    expect(facts).toHaveLength(2);
    const byCampaign = new Map(facts.map((f) => [String(f.campaign_id), f.support_level]));
    expect(byCampaign.get(officeId)).toBe('strong');
    expect(byCampaign.get(electionId)).toBe('against');
  });

  it('rejects fact writes into an archived campaign', async () => {
    const personId = await createPerson(db, tenantId, officeId, userId);
    await controller.addCampaign(
      { name: 'Old Race', kind: 'election', description: null, notes: null, startdate: null, enddate: null },
      auth,
    );
    const rows = await controller.getSwitcherList(auth);
    const electionId = String(rows.find((c) => c.kind === 'election')?.id);
    await controller.archive(electionId, auth);

    await expect(
      controller.upsertPersonFact({ campaign_id: electionId, person_id: personId, support_level: 'strong' }, auth),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('manages per-campaign subscriptions with derived global layers', async () => {
    const household = await db
      .insertInto('households')
      .values({ tenant_id: tenantId, campaign_id: officeId, createdby_id: userId, updatedby_id: userId })
      .returning('id')
      .executeTakeFirstOrThrow();
    const person = await db
      .insertInto('persons')
      .values({
        tenant_id: tenantId,
        campaign_id: officeId,
        household_id: household.id,
        first_name: 'Subscriber',
        last_name: 'Test',
        email: `sub-${rand()}@example.com`,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returning(['id', 'email'])
      .executeTakeFirstOrThrow();
    const personId = String(person.id);

    await controller.addCampaign(
      { name: 'Race', kind: 'election', description: null, notes: null, startdate: null, enddate: null },
      auth,
    );
    const rows = await controller.getSwitcherList(auth);
    const electionId = String(rows.find((c) => c.kind === 'election')?.id);

    // Subscribe in the office, unsubscribe in the election — independent rows.
    await controller.setSubscription({ campaign_id: officeId, person_id: personId, status: 'subscribed' }, auth);
    await controller.setSubscription({ campaign_id: electionId, person_id: personId, status: 'unsubscribed' }, auth);

    const payload = await controller.getPersonSubscriptions(personId, auth);
    expect(payload.subscriptions).toHaveLength(2);
    const byCampaign = new Map(payload.subscriptions.map((s) => [String(s.campaign_id), s.status]));
    expect(byCampaign.get(officeId)).toBe('subscribed');
    expect(byCampaign.get(electionId)).toBe('unsubscribed');
    expect(payload.do_not_contact).toBe(false);
    expect(payload.suppressions).toHaveLength(0);

    // A suppression for the address shows up in the payload (global layer 2).
    await db
      .insertInto('email_suppressions')
      .values({ tenant_id: tenantId, email: person.email, reason: 'hard_bounce', occurred_at: new Date() })
      .execute();
    const suppressed = await controller.getPersonSubscriptions(personId, auth);
    expect(suppressed.suppressions.map((s) => s.reason)).toContain('hard_bounce');
  });

  it('refuses to subscribe a person with no email address', async () => {
    const personId = await createPerson(db, tenantId, officeId, userId);
    await expect(
      controller.setSubscription({ campaign_id: officeId, person_id: personId, status: 'subscribed' }, auth),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('scopes campaign-scoped tables by options.campaignId in the base getAll', async () => {
    await controller.addCampaign(
      { name: 'Scoped Race', kind: 'election', description: null, notes: null, startdate: null, enddate: null },
      auth,
    );
    const rows = await controller.getSwitcherList(auth);
    const electionId = String(rows.find((c) => c.kind === 'election')?.id);

    for (const [name, campaign] of [
      ['Office list', officeId],
      ['Election list', electionId],
    ] as const) {
      await db
        .insertInto('lists')
        .values({
          tenant_id: tenantId,
          campaign_id: campaign,
          name,
          object: 'people',
          is_dynamic: false,
          createdby_id: userId,
          updatedby_id: userId,
        })
        .execute();
    }

    const listsRepo = new BaseRepository<'lists'>('lists' as never);
    const office = await listsRepo.getAllWithCounts({ tenant_id: tenantId, options: { campaignId: officeId } });
    expect(office.count).toBe(1);
    expect(office.rows[0]?.['name']).toBe('Office list');

    const election = await listsRepo.getAllWithCounts({ tenant_id: tenantId, options: { campaignId: electionId } });
    expect(election.count).toBe(1);
    expect(election.rows[0]?.['name']).toBe('Election list');

    // Without the option, both contexts' rows come back (tenant-wide).
    const all = await listsRepo.getAllWithCounts({ tenant_id: tenantId, options: {} });
    expect(all.count).toBe(2);

    await db.deleteFrom('lists').where('tenant_id', '=', tenantId).execute();
  });

  it('carries over support (never voting), and subscriptions only with the explicit flag', async () => {
    const personId = await createPerson(db, tenantId, officeId, userId);
    const person = await db
      .selectFrom('persons')
      .select(['id'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', personId)
      .executeTakeFirstOrThrow();
    await db
      .updateTable('persons')
      .set({ email: `carry-${rand()}@example.com` })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', person.id)
      .execute();

    // Office data: support + voting + a subscription.
    await controller.upsertPersonFact(
      { campaign_id: officeId, person_id: personId, support_level: 'leaning', voting_status: 'voted_eday' },
      auth,
    );
    await controller.setSubscription({ campaign_id: officeId, person_id: personId, status: 'subscribed' }, auth);

    await controller.addCampaign(
      { name: 'Next Race', kind: 'election', description: null, notes: null, startdate: null, enddate: null },
      auth,
    );
    const rows = await controller.getSwitcherList(auth);
    const electionId = String(rows.find((c) => c.kind === 'election')?.id);

    // Without the flag: support copies, voting never, subscriptions untouched.
    const first = await controller.carryOver(
      { source_campaign_id: officeId, target_campaign_id: electionId, copy_support: true, copy_subscriptions: false },
      auth,
    );
    expect(first.support_copied).toBe(1);
    expect(first.subscriptions_copied).toBe(0);

    const facts = await controller.getPersonFacts(personId, auth);
    const electionFact = facts.find((f) => String(f.campaign_id) === electionId);
    expect(electionFact?.support_level).toBe('leaning');
    expect(electionFact?.support_source).toBe('carryover');
    expect(electionFact?.voting_status).toBeNull();

    let payload = await controller.getPersonSubscriptions(personId, auth);
    expect(payload.subscriptions.some((s) => String(s.campaign_id) === electionId)).toBe(false);

    // With the flag: subscriptions copy as 'copied'; the earlier support row is not clobbered.
    const second = await controller.carryOver(
      { source_campaign_id: officeId, target_campaign_id: electionId, copy_support: true, copy_subscriptions: true },
      auth,
    );
    expect(second.support_copied).toBe(0);
    expect(second.subscriptions_copied).toBe(1);

    payload = await controller.getPersonSubscriptions(personId, auth);
    const copied = payload.subscriptions.find((s) => String(s.campaign_id) === electionId);
    expect(copied?.status).toBe('subscribed');
    expect(copied?.consent_source).toBe('copied');

    // Guards: same campaign, archived target.
    await expect(
      controller.carryOver(
        { source_campaign_id: officeId, target_campaign_id: officeId, copy_support: true, copy_subscriptions: false },
        auth,
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
    await controller.archive(electionId, auth);
    await expect(
      controller.carryOver(
        { source_campaign_id: officeId, target_campaign_id: electionId, copy_support: true, copy_subscriptions: false },
        auth,
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('assertWritable blocks archived campaigns and missing ones', async () => {
    const repo = new CampaignsRepo();
    await controller.addCampaign(
      { name: 'Done Race', kind: 'election', description: null, notes: null, startdate: null, enddate: null },
      auth,
    );
    const rows = await controller.getSwitcherList(auth);
    const election = rows.find((c) => c.kind === 'election');
    const electionId = String(election?.id);

    await expect(repo.assertWritable({ tenant_id: tenantId, campaign_id: electionId })).resolves.toBeUndefined();

    await controller.archive(electionId, auth);
    await expect(repo.assertWritable({ tenant_id: tenantId, campaign_id: electionId })).rejects.toBeInstanceOf(
      BadRequestError,
    );
    await expect(repo.assertWritable({ tenant_id: tenantId, campaign_id: '999999999' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
