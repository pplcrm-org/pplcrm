import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PersonsRepo } from './persons.repo';
import { HouseholdRepo } from '../../households/repositories/households.repo';
import { CompaniesRepo } from '../../companies/repositories/companies.repo';
import { BaseRepository } from '../../../lib/base.repo';
import { DuplicateMaintenanceService } from '../services/duplicate-maintenance.service';
import { PersonsController } from '../controller';

async function createTestSeed(db: any) {
  const rand = () => String(Math.floor(Math.random() * 100000000) + 10000000);
  const tenantId = rand();
  const userId = rand();
  const campaignId = rand();
  const householdId = rand();

  // 1. Tenant
  await db
    .insertInto('tenants')
    .values({
      id: tenantId,
      name: 'Test Tenant',
    })
    .execute();

  // 2. User
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

  // Update tenant admin and creator
  await db.updateTable('tenants').set({ admin_id: userId, createdby_id: userId }).where('id', '=', tenantId).execute();

  // 3. Campaign
  await db
    .insertInto('campaigns')
    .values({
      id: campaignId,
      tenant_id: tenantId,
      admin_id: userId,
      name: 'Test Campaign',
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();

  // 4. Household
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

  return { tenantId, userId, campaignId, householdId };
}

async function cleanTenant(db: any, tenantId: string) {
  await db
    .updateTable('tenants')
    .set({ admin_id: null, createdby_id: null, placeholder_household_id: null })
    .where('id', '=', tenantId)
    .execute();
  await db.deleteFrom('potential_duplicates').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('household_districts').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('boundary_sets').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('donations').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('events').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('workflows').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('web_forms').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('person_connections').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('background_jobs').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('map_peoples_tags').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('map_households_tags').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('map_teams_persons').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('teams').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('volunteer_shifts').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('volunteer_events').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('persons').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('companies').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('households').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tags').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('settings').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('sessions').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
}

describe('PersonsRepo Integration', () => {
  const repo = new PersonsRepo();
  const db = (BaseRepository as any)._db;
  let tenantId: string;
  let userId: string;
  let campaignId: string;
  let householdId: string;

  beforeEach(async () => {
    const seed = await createTestSeed(db);
    tenantId = seed.tenantId;
    userId = seed.userId;
    campaignId = seed.campaignId;
    householdId = seed.householdId;
  });

  afterEach(async () => {
    await cleanTenant(db, tenantId);
  });

  it('should clear file_id for import', async () => {
    const importId = '123456';

    const person = await repo.add({
      row: {
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: householdId,
        first_name: 'File',
        last_name: 'User',
        file_id: importId,
        createdby_id: userId,
        updatedby_id: userId,
      },
    });

    expect(person.file_id).toBe(importId);

    const ids = await repo.getIdsByFileId({ tenant_id: tenantId, file_id: importId });
    expect(ids).toContain(person.id);

    await repo.clearFileIdForImport({ tenant_id: tenantId, import_id: importId, user_id: userId });

    const check = await repo.getOneBy('id', { tenant_id: tenantId, value: person.id });
    expect(check?.file_id).toBeNull();
  });

  it('should return household_is_placeholder true only for persons in the placeholder household', async () => {
    // 1. Create a person in the default household (householdId)
    const p1 = await repo.add({
      row: {
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: householdId,
        first_name: 'Regular',
        last_name: 'User',
        createdby_id: userId,
        updatedby_id: userId,
      },
    });

    // 2. Set householdId as the tenant's placeholder household
    await db.updateTable('tenants').set({ placeholder_household_id: householdId }).where('id', '=', tenantId).execute();

    // 3. Create a second household that is NOT a placeholder
    const otherHhId = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('households')
      .values({
        id: otherHhId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // 4. Create a person in the second household
    const p2 = await repo.add({
      row: {
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: otherHhId,
        first_name: 'Other',
        last_name: 'User',
        createdby_id: userId,
        updatedby_id: userId,
      },
    });

    // 5. Fetch all persons with address
    const result = await repo.getAllWithAddress({ tenant_id: tenantId });
    expect(result.rows).toHaveLength(2);

    const r1 = result.rows.find((r) => String(r.id) === String(p1.id));
    const r2 = result.rows.find((r) => String(r.id) === String(p2.id));

    expect(r1?.household_is_placeholder).toBe(true);
    expect(r2?.household_is_placeholder).toBe(false);
  });

  it('should fetch persons by ids, optionally restricted to volunteers', async () => {
    const p1 = await repo.add({
      row: {
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: householdId,
        first_name: 'Volunteer',
        last_name: 'One',
        volunteer_status: 'active',
        createdby_id: userId,
        updatedby_id: userId,
      },
    });

    const p2 = await repo.add({
      row: {
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: householdId,
        first_name: 'NotAVolunteer',
        last_name: 'Two',
        createdby_id: userId,
        updatedby_id: userId,
      },
    });

    // Fetch without the volunteer restriction
    const allFetched = await repo.getByIds({ tenant_id: tenantId, ids: [p1.id, p2.id] });
    expect(allFetched).toHaveLength(2);

    // Fetch restricted to volunteers (non-null volunteer_status, §15)
    const volunteersOnly = await repo.getByIds({ tenant_id: tenantId, ids: [p1.id, p2.id], requireVolunteer: true });
    expect(volunteersOnly).toHaveLength(1);
    expect(volunteersOnly[0].id).toBe(p1.id);
  });

  it('should retrieve created stats', async () => {
    await repo.add({
      row: {
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: householdId,
        first_name: 'Stats',
        last_name: 'User',
        createdby_id: userId,
        updatedby_id: userId,
      },
    });

    const stats = await repo.getCreatedStats({ tenant_id: tenantId, user_id: userId });
    expect(stats.total).toBe(1);
    expect(stats.last_created_at).toBeInstanceOf(Date);
  });

  it('should find potential duplicates by name + household and name + address', async () => {
    // 1. Name + Household duplicates (Jane Doe in same household)
    const p1 = await repo.add({
      row: {
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: householdId,
        first_name: 'Jane',
        last_name: 'Doe',
        createdby_id: userId,
        updatedby_id: userId,
      },
    });

    const p2 = await repo.add({
      row: {
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: householdId,
        first_name: 'jane',
        last_name: 'doe',
        createdby_id: userId,
        updatedby_id: userId,
      },
    });

    // 2. Name + Address duplicates (John Smith in different households but same address fingerprint)
    // Create a second household with same address fingerprint
    const householdId2 = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('households')
      .values({
        id: householdId2,
        tenant_id: tenantId,
        campaign_id: campaignId,
        address_fp_full: '123 Main St, Springfield',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // Update first household's address fingerprint to match
    await db
      .updateTable('households')
      .set({ address_fp_full: '123 Main St, Springfield' })
      .where('id', '=', householdId)
      .execute();

    const p3 = await repo.add({
      row: {
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: householdId,
        first_name: 'John',
        last_name: 'Smith',
        createdby_id: userId,
        updatedby_id: userId,
      },
    });

    const p4 = await repo.add({
      row: {
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: householdId2,
        first_name: 'john',
        last_name: 'smith',
        createdby_id: userId,
        updatedby_id: userId,
      },
    });

    const maintenanceSvc = new DuplicateMaintenanceService();
    await maintenanceSvc.recomputeAllDuplicates(tenantId);

    const { groups: dups } = await repo.getPotentialDuplicates(tenantId);
    expect(dups.length).toBeGreaterThanOrEqual(2);

    const householdGroup = dups.find((d) => d.reason.includes('Same Household'));
    expect(householdGroup).toBeDefined();
    expect(householdGroup.persons.map((p: any) => p.id)).toContain(p1.id);
    expect(householdGroup.persons.map((p: any) => p.id)).toContain(p2.id);

    const addressGroup = dups.find((d) => d.reason.includes('Same Address') && d.reason.toLowerCase().includes('john'));
    expect(addressGroup).toBeDefined();
    expect(addressGroup.persons.map((p: any) => p.id)).toContain(p3.id);
    expect(addressGroup.persons.map((p: any) => p.id)).toContain(p4.id);
  });

  it('should transactionally merge source person into target person', async () => {
    const target = await repo.add({
      row: {
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: householdId,
        first_name: 'Primary',
        last_name: 'User',
        email: 'primary@example.com',
        createdby_id: userId,
        updatedby_id: userId,
      },
    });

    const source = await repo.add({
      row: {
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: householdId,
        first_name: 'Primary',
        last_name: 'User',
        mobile: '123-456-7890',
        createdby_id: userId,
        updatedby_id: userId,
      },
    });

    const randTagId = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('tags')
      .values({
        id: randTagId,
        tenant_id: tenantId,
        name: 'MergeTag',
        deletable: true,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    await db
      .insertInto('map_peoples_tags')
      .values({
        tenant_id: tenantId,
        person_id: source.id,
        tag_id: randTagId,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    await repo.mergePersons({
      tenant_id: tenantId,
      target_id: target.id,
      source_id: source.id,
      user_id: userId,
    });

    const updatedTarget = await repo.getOneBy('id', { tenant_id: tenantId, value: target.id });
    expect(updatedTarget?.mobile).toBe('123-456-7890');

    const targetTags = await db
      .selectFrom('map_peoples_tags')
      .where('tenant_id', '=', tenantId)
      .where('person_id', '=', target.id)
      .selectAll()
      .execute();
    expect(targetTags.map((t: any) => t.tag_id)).toContain(randTagId);

    const checkSource = await repo.getOneBy('id', { tenant_id: tenantId, value: source.id });
    expect(checkSource).toBeUndefined();
  });

  // Regression: the email is copied while the source row still exists inside the merge
  // transaction, and idx_persons_tenant_email_unique forbids two rows in a tenant holding
  // the same address. Before the fix this exact shape — survivor without an email, duplicate
  // with one — failed the whole merge with a unique-constraint error from the Duplicates page.
  it('should merge the email onto an email-less target without tripping the unique email index', async () => {
    const email = `merge-email-${String(Math.floor(Math.random() * 100000000) + 10000000)}@example.com`;

    const target = await repo.add({
      row: {
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: householdId,
        first_name: 'Keeper',
        last_name: 'NoEmail',
        mobile: '555-000-1111',
        createdby_id: userId,
        updatedby_id: userId,
      },
    });

    const source = await repo.add({
      row: {
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: householdId,
        first_name: 'Keeper',
        last_name: 'NoEmail',
        email,
        createdby_id: userId,
        updatedby_id: userId,
      },
    });

    await repo.mergePersons({
      tenant_id: tenantId,
      target_id: target.id,
      source_id: source.id,
      user_id: userId,
    });

    const updatedTarget = await repo.getOneBy('id', { tenant_id: tenantId, value: target.id });
    expect(updatedTarget?.email).toBe(email);

    const checkSource = await repo.getOneBy('id', { tenant_id: tenantId, value: source.id });
    expect(checkSource).toBeUndefined();
  });

  it('should re-point donations, form submissions, shifts, workflow enrollments and connections on merge', async () => {
    const rand = () => String(Math.floor(Math.random() * 100000000) + 10000000);
    const addPerson = (first: string) =>
      repo.add({
        row: {
          tenant_id: tenantId,
          campaign_id: campaignId,
          household_id: householdId,
          first_name: first,
          last_name: 'Repoint',
          createdby_id: userId,
          updatedby_id: userId,
        },
      });
    const target = await addPerson('Target');
    const source = await addPerson('Source');
    const other = await addPerson('Other');

    // Donation (FK is ON DELETE SET NULL — would silently detach without re-pointing)
    const donationId = rand();
    await db
      .insertInto('donations')
      .values({ id: donationId, tenant_id: tenantId, campaign_id: campaignId, person_id: source.id, amount: 5000 })
      .execute();

    // Form submission (FK is ON DELETE CASCADE — would be destroyed without re-pointing)
    const form = await db
      .insertInto('web_forms')
      .values({
        tenant_id: tenantId,
        campaign_id: campaignId,
        name: 'Merge Form',
        slug: `merge-form-${rand()}`,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returning('id')
      .executeTakeFirst();
    await db
      .insertInto('form_submissions')
      .values({ tenant_id: tenantId, form_id: form.id, person_id: source.id })
      .execute();

    // Volunteer shift (CASCADE)
    const volEventId = rand();
    await db
      .insertInto('volunteer_events')
      .values({
        id: volEventId,
        tenant_id: tenantId,
        name: 'Merge Vol Event',
        slug: `merge-vol-${rand()}`,
        start_time: new Date('2026-08-01T10:00:00Z'),
        end_time: new Date('2026-08-01T12:00:00Z'),
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    const shiftId = rand();
    await db
      .insertInto('volunteer_shifts')
      .values({
        id: shiftId,
        tenant_id: tenantId,
        event_id: volEventId,
        person_id: source.id,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // Workflow enrollment (CASCADE)
    const workflowId = rand();
    await db
      .insertInto('workflows')
      .values({
        id: workflowId,
        tenant_id: tenantId,
        name: 'Merge Workflow',
        trigger_type: 'tag_added',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    const enrollmentId = rand();
    await db
      .insertInto('workflow_enrollments')
      .values({ id: enrollmentId, tenant_id: tenantId, workflow_id: workflowId, person_id: source.id })
      .execute();

    // Person connection source -> other (CASCADE on either endpoint)
    const edgeId = rand();
    await db
      .insertInto('person_connections')
      .values({
        id: edgeId,
        tenant_id: tenantId,
        from_person_id: source.id,
        to_person_id: other.id,
        relation_type: 'colleague',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    await repo.mergePersons({ tenant_id: tenantId, target_id: target.id, source_id: source.id, user_id: userId });

    const donation = await db
      .selectFrom('donations')
      .select(['person_id'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', donationId)
      .executeTakeFirst();
    expect(String(donation.person_id)).toBe(String(target.id));

    const submission = await db
      .selectFrom('form_submissions')
      .select(['person_id'])
      .where('tenant_id', '=', tenantId)
      .where('form_id', '=', form.id)
      .executeTakeFirst();
    expect(String(submission.person_id)).toBe(String(target.id));

    const shift = await db
      .selectFrom('volunteer_shifts')
      .select(['person_id'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', shiftId)
      .executeTakeFirst();
    expect(String(shift.person_id)).toBe(String(target.id));

    const enrollment = await db
      .selectFrom('workflow_enrollments')
      .select(['person_id'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', enrollmentId)
      .executeTakeFirst();
    expect(String(enrollment.person_id)).toBe(String(target.id));

    const edge = await db
      .selectFrom('person_connections')
      .select(['from_person_id', 'to_person_id'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', edgeId)
      .executeTakeFirst();
    expect(String(edge.from_person_id)).toBe(String(target.id));
    expect(String(edge.to_person_id)).toBe(String(other.id));
  });

  it('should keep the target row and drop the source duplicate on uniqueness collisions', async () => {
    const rand = () => String(Math.floor(Math.random() * 100000000) + 10000000);
    const addPerson = (first: string) =>
      repo.add({
        row: {
          tenant_id: tenantId,
          campaign_id: campaignId,
          household_id: householdId,
          first_name: first,
          last_name: 'Collide',
          createdby_id: userId,
          updatedby_id: userId,
        },
      });
    const target = await addPerson('Target');
    const source = await addPerson('Source');

    // Both registered for the same event (unique tenant+event+person); source also has a second event
    const eventId = rand();
    const event2Id = rand();
    for (const [id, name] of [
      [eventId, 'Shared Event'],
      [event2Id, 'Source-only Event'],
    ]) {
      await db
        .insertInto('events')
        .values({
          id,
          tenant_id: tenantId,
          campaign_id: campaignId,
          name,
          slug: `merge-ev-${id}`,
          start_time: new Date('2026-08-01T10:00:00Z'),
          end_time: new Date('2026-08-01T12:00:00Z'),
          createdby_id: userId,
          updatedby_id: userId,
        })
        .execute();
    }
    const targetRegId = rand();
    await db
      .insertInto('event_registrations')
      .values({
        id: targetRegId,
        tenant_id: tenantId,
        event_id: eventId,
        person_id: target.id,
        status: 'registered',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    await db
      .insertInto('event_registrations')
      .values({
        id: rand(),
        tenant_id: tenantId,
        event_id: eventId,
        person_id: source.id,
        status: 'attended',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    await db
      .insertInto('event_registrations')
      .values({
        id: rand(),
        tenant_id: tenantId,
        event_id: event2Id,
        person_id: source.id,
        status: 'registered',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // Both have a campaign fact for the same campaign (unique tenant+campaign+person)
    const targetFactId = rand();
    await db
      .insertInto('campaign_person_facts')
      .values({
        id: targetFactId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        person_id: target.id,
        support_level: 'strong',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    await db
      .insertInto('campaign_person_facts')
      .values({
        id: rand(),
        tenant_id: tenantId,
        campaign_id: campaignId,
        person_id: source.id,
        support_level: 'against',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    await repo.mergePersons({ tenant_id: tenantId, target_id: target.id, source_id: source.id, user_id: userId });

    // Shared event: exactly one registration survives — the target's
    const sharedRegs = await db
      .selectFrom('event_registrations')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('event_id', '=', eventId)
      .execute();
    expect(sharedRegs).toHaveLength(1);
    expect(String(sharedRegs[0].id)).toBe(String(targetRegId));
    expect(String(sharedRegs[0].person_id)).toBe(String(target.id));
    expect(sharedRegs[0].status).toBe('registered');

    // Source-only event: re-pointed to target
    const movedRegs = await db
      .selectFrom('event_registrations')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('event_id', '=', event2Id)
      .execute();
    expect(movedRegs).toHaveLength(1);
    expect(String(movedRegs[0].person_id)).toBe(String(target.id));

    // Campaign fact: one row, the target's values retained
    const facts = await db
      .selectFrom('campaign_person_facts')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('campaign_id', '=', campaignId)
      .execute();
    expect(facts).toHaveLength(1);
    expect(String(facts[0].id)).toBe(String(targetFactId));
    expect(String(facts[0].person_id)).toBe(String(target.id));
    expect(facts[0].support_level).toBe('strong');
  });

  it('should merge campaign subscriptions with most-restrictive consent', async () => {
    const rand = () => String(Math.floor(Math.random() * 100000000) + 10000000);
    const addPerson = (first: string, email: string) =>
      repo.add({
        row: {
          tenant_id: tenantId,
          campaign_id: campaignId,
          household_id: householdId,
          first_name: first,
          last_name: 'Consent',
          email,
          createdby_id: userId,
          updatedby_id: userId,
        },
      });
    const target = await addPerson('Target', `t-${rand()}@example.com`);
    const source = await addPerson('Source', `s-${rand()}@example.com`);

    // Second campaign where only the source is subscribed
    const campaign2Id = rand();
    await db
      .insertInto('campaigns')
      .values({
        id: campaign2Id,
        tenant_id: tenantId,
        admin_id: userId,
        name: 'Second Campaign',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    const targetSubId = rand();
    await db
      .insertInto('campaign_subscriptions')
      .values({
        id: targetSubId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        person_id: target.id,
        email: target.email,
        status: 'subscribed',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    await db
      .insertInto('campaign_subscriptions')
      .values({
        id: rand(),
        tenant_id: tenantId,
        campaign_id: campaignId,
        person_id: source.id,
        email: source.email,
        status: 'unsubscribed',
        unsubscribed_at: new Date('2026-01-01T00:00:00Z'),
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    await db
      .insertInto('campaign_subscriptions')
      .values({
        id: rand(),
        tenant_id: tenantId,
        campaign_id: campaign2Id,
        person_id: source.id,
        email: source.email,
        status: 'subscribed',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    await repo.mergePersons({ tenant_id: tenantId, target_id: target.id, source_id: source.id, user_id: userId });

    // Campaign 1: target's row survives but consent is most-restrictive → unsubscribed
    const subs1 = await db
      .selectFrom('campaign_subscriptions')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('campaign_id', '=', campaignId)
      .execute();
    expect(subs1).toHaveLength(1);
    expect(String(subs1[0].id)).toBe(String(targetSubId));
    expect(String(subs1[0].person_id)).toBe(String(target.id));
    expect(subs1[0].status).toBe('unsubscribed');
    expect(subs1[0].unsubscribed_at).not.toBeNull();

    // Campaign 2: source-only subscription re-pointed, consent unchanged
    const subs2 = await db
      .selectFrom('campaign_subscriptions')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('campaign_id', '=', campaign2Id)
      .execute();
    expect(subs2).toHaveLength(1);
    expect(String(subs2[0].person_id)).toBe(String(target.id));
    expect(subs2[0].status).toBe('subscribed');

    await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).where('id', '=', campaign2Id).execute();
  });

  it('should carry do_not_contact over to the target with channel union', async () => {
    const addPerson = (first: string, dnc: boolean, channels: string[] | null) =>
      repo.add({
        row: {
          tenant_id: tenantId,
          campaign_id: campaignId,
          household_id: householdId,
          first_name: first,
          last_name: 'Dnc',
          do_not_contact: dnc,
          do_not_contact_channels: channels,
          createdby_id: userId,
          updatedby_id: userId,
        },
      });

    // Merge 1: contactable target + DNC(email) source → target becomes DNC(email)
    const target = await addPerson('Target', false, null);
    const source1 = await addPerson('SourceEmail', true, ['email']);
    await repo.mergePersons({ tenant_id: tenantId, target_id: target.id, source_id: source1.id, user_id: userId });

    let updated = await repo.getOneBy('id', { tenant_id: tenantId, value: target.id });
    expect(updated?.do_not_contact).toBe(true);
    expect(updated?.do_not_contact_channels).toEqual(['email']);

    // Merge 2: DNC(sms) source → union of channels
    const source2 = await addPerson('SourceSms', true, ['sms']);
    await repo.mergePersons({ tenant_id: tenantId, target_id: target.id, source_id: source2.id, user_id: userId });
    updated = await repo.getOneBy('id', { tenant_id: tenantId, value: target.id });
    expect(updated?.do_not_contact).toBe(true);
    expect([...(updated?.do_not_contact_channels ?? [])].sort()).toEqual(['email', 'sms']);

    // Merge 3: DNC(all channels = null) source → null wins (all channels blocked)
    const source3 = await addPerson('SourceAll', true, null);
    await repo.mergePersons({ tenant_id: tenantId, target_id: target.id, source_id: source3.id, user_id: userId });
    updated = await repo.getOneBy('id', { tenant_id: tenantId, value: target.id });
    expect(updated?.do_not_contact).toBe(true);
    expect(updated?.do_not_contact_channels).toBeNull();
  });

  it('should incrementally detect duplicates on person insertion', async () => {
    const maintenanceSvc = new DuplicateMaintenanceService();

    // Add first person
    const p1 = await repo.add({
      row: {
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: householdId,
        first_name: 'IncFirst',
        last_name: 'IncLast',
        createdby_id: userId,
        updatedby_id: userId,
      },
    });

    // Run maintenance for p1 -> should find no duplicates yet
    await maintenanceSvc.recomputeAllDuplicates(tenantId);
    let { groups: dups } = await repo.getPotentialDuplicates(tenantId);
    expect(dups).toHaveLength(0);

    // Add second person with same name in same household
    const p2 = await repo.add({
      row: {
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: householdId,
        first_name: 'incfirst',
        last_name: 'inclast',
        createdby_id: userId,
        updatedby_id: userId,
      },
    });

    // Run maintenance for p2 -> should detect duplicate
    await maintenanceSvc.recomputeAllDuplicates(tenantId);
    const res = await repo.getPotentialDuplicates(tenantId);
    dups = res.groups;
    expect(dups).toHaveLength(1);
    expect(dups[0].reason).toContain('Matching Name at Same Household');
    expect(dups[0].persons.map((p: any) => p.id)).toContain(p1.id);
    expect(dups[0].persons.map((p: any) => p.id)).toContain(p2.id);
  });

  it('should incrementally clean up duplicates when a person is updated to be unique', async () => {
    const maintenanceSvc = new DuplicateMaintenanceService();

    // 1. Create duplicate name persons
    const _p1 = await repo.add({
      row: {
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: householdId,
        first_name: 'IncFirst',
        last_name: 'IncLast',
        createdby_id: userId,
        updatedby_id: userId,
      },
    });
    const p2 = await repo.add({
      row: {
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: householdId,
        first_name: 'incfirst',
        last_name: 'inclast',
        createdby_id: userId,
        updatedby_id: userId,
      },
    });

    // Run maintenance -> duplicate exists
    await maintenanceSvc.recomputeAllDuplicates(tenantId);
    let { groups: dups } = await repo.getPotentialDuplicates(tenantId);
    expect(dups).toHaveLength(1);

    // 2. Update p2 to have a unique name
    await repo.update({
      tenant_id: tenantId,
      id: p2.id,
      row: { first_name: 'UniqueFirst' },
    });

    // Run maintenance for updated p2 -> duplicate should be cleared
    await maintenanceSvc.recomputeAllDuplicates(tenantId);
    const res = await repo.getPotentialDuplicates(tenantId);
    dups = res.groups;
    expect(dups).toHaveLength(0);
  });

  it('should incrementally clean up duplicate groups when one duplicate is deleted', async () => {
    const maintenanceSvc = new DuplicateMaintenanceService();

    // 1. Create duplicates
    const _p1 = await repo.add({
      row: {
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: householdId,
        first_name: 'IncFirst',
        last_name: 'IncLast',
        createdby_id: userId,
        updatedby_id: userId,
      },
    });
    const p2 = await repo.add({
      row: {
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: householdId,
        first_name: 'incfirst',
        last_name: 'inclast',
        createdby_id: userId,
        updatedby_id: userId,
      },
    });

    await maintenanceSvc.recomputeAllDuplicates(tenantId);
    let { groups: dups } = await repo.getPotentialDuplicates(tenantId);
    expect(dups).toHaveLength(1);

    // 2. Fetch duplicate keys for deleted person and delete them (simulating deleteMany logic)
    const activeGroupKeys = await db
      .selectFrom('potential_duplicates')
      .select('group_key')
      .where('tenant_id', '=', tenantId)
      .where('person_id', '=', p2.id)
      .execute();
    const _groupKeys = activeGroupKeys.map((k: { group_key: string }) => k.group_key);

    await repo.delete({ tenant_id: tenantId, id: p2.id });

    // Run maintenance on the group keys -> should clear duplicates
    await maintenanceSvc.recomputeAllDuplicates(tenantId);
    const res = await repo.getPotentialDuplicates(tenantId);
    dups = res.groups;
    expect(dups).toHaveLength(0);
  });

  it('ignores a sortModel colId the query cannot serve (a saved sort on the removed ward column)', async () => {
    await repo.add({
      row: {
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: householdId,
        first_name: 'Sorted',
        last_name: 'Fine',
        createdby_id: userId,
        updatedby_id: userId,
      },
    });

    // 'ward' was a real column once, so a browser can still hold a persisted sort on it. Passed
    // through it becomes ORDER BY "ward" and Postgres rejects the whole query; it must be
    // skipped while the known column beside it still sorts.
    const result = await repo.getAllWithAddress({
      tenant_id: tenantId,
      options: {
        sortModel: [
          { colId: 'ward', sort: 'asc' },
          { colId: 'last_name', sort: 'asc' },
        ],
      },
    });
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('should filter persons using advancedFilterModel', async () => {
    // 1. Create two persons
    const p1 = await repo.add({
      row: {
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: householdId,
        first_name: 'Alice',
        last_name: 'Smith',
        email: 'alice@example.com',
        createdby_id: userId,
        updatedby_id: userId,
      },
    });

    const p2 = await repo.add({
      row: {
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: householdId,
        first_name: 'Bob',
        last_name: 'Jones',
        email: 'bob@example.com',
        createdby_id: userId,
        updatedby_id: userId,
      },
    });

    // 2. Fetch using advanced filter: first_name equals 'Alice'
    const result1 = await repo.getAllWithAddress({
      tenant_id: tenantId,
      options: {
        advancedFilterModel: {
          kind: 'group',
          id: 'root',
          conjunction: 'AND',
          rules: [
            {
              kind: 'rule',
              id: 'r1',
              field: 'first_name',
              op: 'equals',
              value: 'Alice',
            },
          ],
        },
      } as any,
    });

    expect(result1.rows).toHaveLength(1);
    expect(String(result1.rows[0].id)).toBe(p1.id);

    // 3. Fetch using advanced filter: email contains 'example' AND last_name equals 'Jones'
    const result2 = await repo.getAllWithAddress({
      tenant_id: tenantId,
      options: {
        advancedFilterModel: {
          kind: 'group',
          id: 'root',
          conjunction: 'AND',
          rules: [
            {
              kind: 'rule',
              id: 'r2',
              field: 'email',
              op: 'contains',
              value: 'example',
            },
            {
              kind: 'rule',
              id: 'r3',
              field: 'last_name',
              op: 'equals',
              value: 'Jones',
            },
          ],
        },
      } as any,
    });

    expect(result2.rows).toHaveLength(1);
    expect(String(result2.rows[0].id)).toBe(p2.id);
  });
});

describe('HouseholdRepo Duplicates', () => {
  const householdsRepo = new HouseholdRepo();
  const db = (BaseRepository as any)._db;
  let tenantId: string;
  let userId: string;
  let campaignId: string;
  let householdId: string;

  beforeEach(async () => {
    const seed = await createTestSeed(db);
    tenantId = seed.tenantId;
    userId = seed.userId;
    campaignId = seed.campaignId;
    householdId = seed.householdId;
  });

  afterEach(async () => {
    await cleanTenant(db, tenantId);
  });

  it('should exclude the placeholder household in getAllWithPeopleCount', async () => {
    // Create a household to act as the placeholder
    const placeholderHhId = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('households')
      .values({
        id: placeholderHhId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // Set it as the tenant's placeholder household
    await db
      .updateTable('tenants')
      .set({ placeholder_household_id: placeholderHhId })
      .where('id', '=', tenantId)
      .execute();

    // Fetch households
    const result = await householdsRepo.getAllWithPeopleCount({ tenant_id: tenantId });

    // The placeholder household should be hidden
    const ids = result.rows.map((row: any) => String(row.id));
    expect(ids).toContain(householdId);
    expect(ids).not.toContain(placeholderHhId);
    expect(result.count).toBe(1);
  });

  it('should find potential duplicate households by address fingerprint', async () => {
    // Modify first household address fingerprint
    await db
      .updateTable('households')
      .set({ address_fp_full: '456 Main St, Springfield' })
      .where('id', '=', householdId)
      .execute();

    // Create a second duplicate household
    const randId = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('households')
      .values({
        id: randId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        address_fp_full: '456 Main St, Springfield',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    const maintenanceSvc = new DuplicateMaintenanceService();
    await maintenanceSvc.recomputeAllDuplicates(tenantId);

    const { groups: dups } = await householdsRepo.getPotentialDuplicates(tenantId);
    expect(dups).toHaveLength(1);
    expect(dups[0].households).toHaveLength(2);
  });

  it('should merge source household into target household transactionally', async () => {
    // Set address fp for target
    await db
      .updateTable('households')
      .set({ address_fp_full: '789 Elm St, Springfield', home_phone: '111-222-3333' })
      .where('id', '=', householdId)
      .execute();

    // Create source household
    const sourceHhId = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('households')
      .values({
        id: sourceHhId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        address_fp_full: '789 Elm St, Springfield',
        notes: 'Source notes',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // Create tag to merge
    const randTagId = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('tags')
      .values({
        id: randTagId,
        tenant_id: tenantId,
        name: 'HouseholdMergeTag',
        deletable: true,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // Tag the source household
    await db
      .insertInto('map_households_tags')
      .values({
        tenant_id: tenantId,
        household_id: sourceHhId,
        tag_id: randTagId,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // Reassign person to source household to test reassigning
    const personId = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('persons')
      .values({
        id: personId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: sourceHhId,
        first_name: 'Resident',
        last_name: 'One',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    await householdsRepo.mergeHouseholds({
      tenant_id: tenantId,
      target_id: householdId,
      source_id: sourceHhId,
      user_id: userId,
    });

    // Check target household got source fields (e.g. notes)
    const updatedTarget = await householdsRepo.getOneBy('id', { tenant_id: tenantId, value: householdId });
    expect(updatedTarget?.notes).toBe('Source notes');
    expect(updatedTarget?.home_phone).toBe('111-222-3333');

    // Check tags transferred
    const targetTags = await db
      .selectFrom('map_households_tags')
      .where('tenant_id', '=', tenantId)
      .where('household_id', '=', householdId)
      .selectAll()
      .execute();
    expect(targetTags.map((t: any) => t.tag_id)).toContain(randTagId);

    // Check person household reassigned
    const person = await db.selectFrom('persons').selectAll().where('id', '=', personId).executeTakeFirst();
    expect(person?.household_id).toBe(householdId);

    // Check source household deleted
    const checkSource = await householdsRepo.getOneBy('id', { tenant_id: tenantId, value: sourceHhId });
    expect(checkSource).toBeUndefined();
  });

  it('moves boundary rows to the surviving household on merge instead of cascading them away', async () => {
    const rand = () => String(Math.floor(Math.random() * 100000000) + 10000000);
    const sourceHhId = rand();
    await db
      .insertInto('households')
      .values({
        id: sourceHhId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    const addSet = (slug: string, source: string) =>
      db
        .insertInto('boundary_sets')
        .values({
          tenant_id: tenantId,
          slug,
          label: slug,
          jurisdiction: 'other',
          role: 'seat_area',
          source,
          createdby_id: userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
    // An import-sourced set: its area names arrived in a spreadsheet, so a cascade-deleted row
    // is unrecoverable — no polygon exists to rematch from.
    const importSet = await addSet(`import-${rand()}`, 'import');
    const sharedSet = await addSet(`shared-${rand()}`, 'drawn');

    const place = (householdId2: string, setId: unknown, name: string) =>
      db
        .insertInto('household_districts')
        .values({ tenant_id: tenantId, household_id: householdId2, set_id: String(setId), name })
        .execute();
    await place(sourceHhId, importSet.id, 'CD-3');
    await place(sourceHhId, sharedSet.id, 'Ward 9');
    await place(householdId, sharedSet.id, 'Ward 1'); // target already answered for this set

    await householdsRepo.mergeHouseholds({
      tenant_id: tenantId,
      target_id: householdId,
      source_id: sourceHhId,
      user_id: userId,
    });

    const targetRows = await db
      .selectFrom('household_districts')
      .select(['set_id', 'name'])
      .where('tenant_id', '=', tenantId)
      .where('household_id', '=', householdId)
      .execute();
    const bySet = new Map(targetRows.map((r: any) => [String(r.set_id), r.name]));
    // The import-sourced row survived the merge on the target…
    expect(bySet.get(String(importSet.id))).toBe('CD-3');
    // …and the target's own row won where both households had one.
    expect(bySet.get(String(sharedSet.id))).toBe('Ward 1');

    const sourceRows = await db
      .selectFrom('household_districts')
      .select(['id'])
      .where('tenant_id', '=', tenantId)
      .where('household_id', '=', sourceHhId)
      .execute();
    expect(sourceRows).toHaveLength(0);
  });
});

describe('CompaniesRepo Duplicates', () => {
  const companiesRepo = new CompaniesRepo();
  const db = (BaseRepository as any)._db;
  let tenantId: string;
  let userId: string;
  let campaignId: string;
  let householdId: string;

  beforeEach(async () => {
    const seed = await createTestSeed(db);
    tenantId = seed.tenantId;
    userId = seed.userId;
    campaignId = seed.campaignId;
    householdId = seed.householdId;
  });

  afterEach(async () => {
    await cleanTenant(db, tenantId);
  });

  it('should find potential duplicate companies by name', async () => {
    // Create first company
    const compId1 = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('companies')
      .values({
        id: compId1,
        tenant_id: tenantId,
        name: 'Acme Corp',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // Create second duplicate company
    const compId2 = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('companies')
      .values({
        id: compId2,
        tenant_id: tenantId,
        name: ' acme corp  ', // test spacing and case
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    const maintenanceSvc = new DuplicateMaintenanceService();
    await maintenanceSvc.recomputeAllDuplicates(tenantId);

    const { groups: dups } = await companiesRepo.getPotentialDuplicates(tenantId);
    expect(dups).toHaveLength(1);
    expect(dups[0].companies).toHaveLength(2);
  });

  it('should merge source company into target company transactionally', async () => {
    // Create target
    const targetCompId = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('companies')
      .values({
        id: targetCompId,
        tenant_id: tenantId,
        name: 'Acme',
        website: 'acme.com',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // Create source
    const sourceCompId = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('companies')
      .values({
        id: sourceCompId,
        tenant_id: tenantId,
        name: 'Acme',
        description: 'Acme company description',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // Create person linked to source company
    const personId = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('persons')
      .values({
        id: personId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: householdId,
        company_id: sourceCompId,
        first_name: 'Employee',
        last_name: 'One',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    await companiesRepo.mergeCompanies({
      tenant_id: tenantId,
      target_id: targetCompId,
      source_id: sourceCompId,
      user_id: userId,
    });

    // Check target company merged fields
    const updatedTarget = await companiesRepo.getOneBy('id', { tenant_id: tenantId, value: targetCompId });
    expect(updatedTarget?.description).toBe('Acme company description');
    expect(updatedTarget?.website).toBe('acme.com');

    // Check person company reassigned
    const person = await db.selectFrom('persons').selectAll().where('id', '=', personId).executeTakeFirst();
    expect(String(person?.company_id)).toBe(targetCompId);

    // Check source deleted
    const checkSource = await companiesRepo.getOneBy('id', { tenant_id: tenantId, value: sourceCompId });
    expect(checkSource).toBeUndefined();
  });

  describe('Team Captain and Team Deletions', () => {
    const personsController = new PersonsController();

    it('should delete a person who is a regular team member without error', async () => {
      // 1. Create a person
      const personId = String(Math.floor(Math.random() * 100000000) + 10000000);
      await db
        .insertInto('persons')
        .values({
          id: personId,
          tenant_id: tenantId,
          campaign_id: campaignId,
          household_id: householdId,
          first_name: 'Regular',
          last_name: 'Member',
          createdby_id: userId,
          updatedby_id: userId,
        })
        .execute();

      // 2. Create a team
      const teamId = String(Math.floor(Math.random() * 100000000) + 10000000);
      await db
        .insertInto('teams')
        .values({
          id: teamId,
          tenant_id: tenantId,
          name: 'Regular Team',
          createdby_id: userId,
          updatedby_id: userId,
        })
        .execute();

      // 3. Map person to team
      await db
        .insertInto('map_teams_persons')
        .values({
          tenant_id: tenantId,
          team_id: teamId,
          person_id: personId,
          createdby_id: userId,
          updatedby_id: userId,
        })
        .execute();

      // 4. Try deleting the person
      const deleteResult = await personsController.deleteMany(tenantId, [personId]);
      expect(deleteResult).toBe(true);

      // Verify person is deleted
      const checkPerson = await db.selectFrom('persons').selectAll().where('id', '=', personId).executeTakeFirst();
      expect(checkPerson).toBeUndefined();

      // Verify mapping is deleted
      const checkMapping = await db
        .selectFrom('map_teams_persons')
        .selectAll()
        .where('person_id', '=', personId)
        .executeTakeFirst();
      expect(checkMapping).toBeUndefined();
    });

    it('should throw validation error if person is a team captain and force is false', async () => {
      // 1. Create a person
      const personId = String(Math.floor(Math.random() * 100000000) + 10000000);
      await db
        .insertInto('persons')
        .values({
          id: personId,
          tenant_id: tenantId,
          campaign_id: campaignId,
          household_id: householdId,
          first_name: 'Captain',
          last_name: 'Jack',
          createdby_id: userId,
          updatedby_id: userId,
        })
        .execute();

      // 2. Create a team with this person as captain
      const teamId = String(Math.floor(Math.random() * 100000000) + 10000000);
      await db
        .insertInto('teams')
        .values({
          id: teamId,
          tenant_id: tenantId,
          name: 'Pirates',
          team_captain_id: personId,
          createdby_id: userId,
          updatedby_id: userId,
        })
        .execute();

      // 3. Map person to team
      await db
        .insertInto('map_teams_persons')
        .values({
          tenant_id: tenantId,
          team_id: teamId,
          person_id: personId,
          createdby_id: userId,
          updatedby_id: userId,
        })
        .execute();

      // 4. Deleting without force should fail
      await expect(personsController.deleteMany(tenantId, [personId], false)).rejects.toThrow(
        'One or more selected people are team captains. Deleting them will remove them as captain. Do you want to proceed?',
      );

      // 5. Deleting with force should succeed, unlink captaincy, and delete person
      const deleteResult = await personsController.deleteMany(tenantId, [personId], true);
      expect(deleteResult).toBe(true);

      // Verify captaincy is nullified
      const checkTeam = await db.selectFrom('teams').selectAll().where('id', '=', teamId).executeTakeFirst();
      expect(checkTeam?.team_captain_id).toBeNull();

      // Verify mapping is deleted
      const checkMapping = await db
        .selectFrom('map_teams_persons')
        .selectAll()
        .where('person_id', '=', personId)
        .executeTakeFirst();
      expect(checkMapping).toBeUndefined();

      // Verify person is deleted
      const checkPerson = await db.selectFrom('persons').selectAll().where('id', '=', personId).executeTakeFirst();
      expect(checkPerson).toBeUndefined();
    });

    it('should delete a person who has volunteer shifts and cascade delete those shifts', async () => {
      // 1. Create a person
      const personId = String(Math.floor(Math.random() * 100000000) + 10000000);
      await db
        .insertInto('persons')
        .values({
          id: personId,
          tenant_id: tenantId,
          campaign_id: campaignId,
          household_id: householdId,
          first_name: 'Volunteer',
          last_name: 'Worker',
          createdby_id: userId,
          updatedby_id: userId,
        })
        .execute();

      // 2. Create a volunteer event
      const eventId = String(Math.floor(Math.random() * 100000000) + 10000000);
      await db
        .insertInto('volunteer_events')
        .values({
          id: eventId,
          tenant_id: tenantId,
          name: 'Food Drive',
          slug: `food-drive-${eventId}`,
          start_time: new Date(),
          end_time: new Date(Date.now() + 3600000),
          createdby_id: userId,
          updatedby_id: userId,
        })
        .execute();

      // 3. Create a volunteer shift linked to the person
      const shiftId = String(Math.floor(Math.random() * 100000000) + 10000000);
      await db
        .insertInto('volunteer_shifts')
        .values({
          id: shiftId,
          tenant_id: tenantId,
          event_id: eventId,
          person_id: personId,
          createdby_id: userId,
          updatedby_id: userId,
        })
        .execute();

      // 4. Delete the person
      const deleteResult = await personsController.deleteMany(tenantId, [personId]);
      expect(deleteResult).toBe(true);

      // Verify person is deleted
      const checkPerson = await db.selectFrom('persons').selectAll().where('id', '=', personId).executeTakeFirst();
      expect(checkPerson).toBeUndefined();

      // Verify volunteer shift is deleted cascadingly
      const checkShift = await db
        .selectFrom('volunteer_shifts')
        .selectAll()
        .where('id', '=', shiftId)
        .executeTakeFirst();
      expect(checkShift).toBeUndefined();
    });
  });
});
