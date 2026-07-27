import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { WebFormsController } from './controller';
import { BaseRepository } from '../../lib/base.repo';
import { sql } from 'kysely';

async function createTestSeed(db: any) {
  const rand = () => String(Math.floor(Math.random() * 100000000) + 10000000);
  const tenantId = rand();
  const userId = rand();
  const campaignId = rand();
  const householdId = rand();

  // 1. Tenant (slug is the public subdomain identity — globally unique).
  // Grassroots because forms are gated on it (GATED_FEATURES.forms) and submitFormPublic
  // enforces that on the public submit path too, not just on authoring.
  const tenantSlug = `test-${tenantId}`;
  await db
    .insertInto('tenants')
    .values({
      id: tenantId,
      name: 'Test Tenant',
      slug: tenantSlug,
      subscription_plan: 'grassroots',
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

  // Update tenant admin, creator, and placeholder household
  await db
    .updateTable('tenants')
    .set({
      admin_id: userId,
      createdby_id: userId,
      placeholder_household_id: householdId,
    })
    .where('id', '=', tenantId)
    .execute();

  return { tenantId, tenantSlug, userId, campaignId, householdId };
}

async function cleanTenant(db: any, tenantId: string) {
  await db
    .updateTable('tenants')
    .set({ admin_id: null, createdby_id: null, placeholder_household_id: null })
    .where('id', '=', tenantId)
    .execute();
  await db.deleteFrom('map_peoples_tags').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('map_lists_persons').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('persons').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('households').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tags').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('lists').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('web_forms').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('user_activity').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('background_jobs').where('tenant_id', '=', tenantId).execute();
  await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
}

describe('WebFormsController Integration', () => {
  const controller = new WebFormsController();
  const db = (BaseRepository as any)._db;
  let tenantId: string;
  let tenantSlug: string;
  let userId: string;
  let campaignId: string;
  let householdId: string;

  const tenant = () => ({ id: tenantId, slug: tenantSlug });

  beforeEach(async () => {
    const seed = await createTestSeed(db);
    tenantId = seed.tenantId;
    tenantSlug = seed.tenantSlug;
    userId = seed.userId;
    campaignId = seed.campaignId;
    householdId = seed.householdId;
  });

  afterEach(async () => {
    await cleanTenant(db, tenantId);
  });

  it('should successfully submit form and create a new contact with tags and lists', async () => {
    // 1. Create a List
    const listId = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('lists')
      .values({
        id: listId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        name: 'Newsletter Subscribers',
        object: 'people',
        is_dynamic: false,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // 2. Create a Web Form definition
    const formId = randomUUID();
    await db
      .insertInto('web_forms')
      .values({
        id: formId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        name: 'Newsletter Form',
        slug: 'newsletter-form',
        description: 'Public newsletter signup form',
        redirect_url: 'https://example.com/thankyou',
        target_tags: JSON.stringify(['newsletter', 'public-form']),
        target_lists: JSON.stringify([listId]),
        status: 'published',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // List targeting is read from map_web_forms_lists (the controller write
    // paths keep it in sync; this spec inserts the form row directly).
    await db
      .insertInto('map_web_forms_lists')
      .values({
        tenant_id: tenantId,
        web_form_id: formId,
        list_id: listId,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // 3. Submit the form
    const payload = {
      email: 'visitor@example.com',
      first_name: 'John',
      last_name: 'Doe',
      mobile: '555-0199',
      notes: 'I would like to receive updates.',
    };

    const res = await controller.submitFormPublic(tenant(), 'newsletter-form', payload, '127.0.0.1');
    expect(res.redirect_url).toBe('https://example.com/thankyou');

    // Verify background job was queued
    const job = await db
      .selectFrom('background_jobs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where(sql`payload->>'type'`, '=', 'send-webform-notifications')
      .where(sql`payload->>'formId'`, '=', formId)
      .executeTakeFirst();
    expect(job).toBeDefined();
    expect(['pending', 'completed', 'processed']).toContain(job.status);

    // 4. Verify Contact Creation
    const person = await db
      .selectFrom('persons')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('email', '=', 'visitor@example.com')
      .executeTakeFirst();

    expect(person).toBeDefined();
    expect(person.first_name).toBe('John');
    expect(person.last_name).toBe('Doe');
    expect(person.mobile).toBe('555-0199');
    expect(person.notes).toBe('I would like to receive updates.');
    expect(person.household_id).toBe(householdId);

    // 5. Verify Tag Mapping
    const personTags = await db
      .selectFrom('map_peoples_tags')
      .innerJoin('tags', 'tags.id', 'map_peoples_tags.tag_id')
      .select('tags.name')
      .where('map_peoples_tags.tenant_id', '=', tenantId)
      .where('map_peoples_tags.person_id', '=', person.id)
      .execute();

    const tagNames = personTags.map((t: any) => t.name);
    expect(tagNames).toContain('newsletter');
    expect(tagNames).toContain('public-form');
    expect(tagNames).toContain('source: newsletter form');

    // 6. Verify List Mapping
    const personLists = await db
      .selectFrom('map_lists_persons')
      .select('list_id')
      .where('tenant_id', '=', tenantId)
      .where('person_id', '=', person.id)
      .execute();

    const assignedLists = personLists.map((l: any) => l.list_id);
    expect(assignedLists).toContain(listId);
  });

  it('should non-destructively merge details when email already exists', async () => {
    // 1. Pre-insert an existing person with minimal details
    const existingPersonId = String(Math.floor(Math.random() * 100000000) + 10000000);
    await db
      .insertInto('persons')
      .values({
        id: existingPersonId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        household_id: householdId,
        email: 'dup@example.com',
        first_name: 'Existing',
        notes: 'Original notes',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // 2. Create Web Form definition
    const formId = randomUUID();
    await db
      .insertInto('web_forms')
      .values({
        id: formId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        name: 'Newsletter Form',
        slug: 'newsletter-merge-form',
        status: 'published',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // 3. Submit form with new details
    const payload = {
      email: 'dup@example.com',
      last_name: 'Submitter',
      mobile: '12345678',
      notes: 'New form signup.',
    };

    await controller.submitFormPublic(tenant(), 'newsletter-merge-form', payload, '127.0.0.1');

    // 4. Verify Person fields are merged non-destructively
    const person = await db
      .selectFrom('persons')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', existingPersonId)
      .executeTakeFirst();

    expect(person.first_name).toBe('Existing'); // Unchanged
    expect(person.last_name).toBe('Submitter'); // Filled in
    expect(person.mobile).toBe('12345678'); // Filled in
    expect(person.notes).toContain('Original notes'); // Appended
    expect(person.notes).toContain('New form signup.');
  });

  it('should block submissions if honeypot field is filled', async () => {
    // Create Web Form
    const formId = randomUUID();
    await db
      .insertInto('web_forms')
      .values({
        id: formId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        name: 'Newsletter Form',
        slug: 'newsletter-honeypot-form',
        status: 'published',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // Submit with honeypot field _hp filled
    const payload = {
      email: 'bot@example.com',
      _hp: 'im-a-bot-123',
    };

    const res = await controller.submitFormPublic(tenant(), 'newsletter-honeypot-form', payload, '127.0.0.1');
    expect(res.redirect_url).toBeNull();

    // Verify no person was created
    const person = await db
      .selectFrom('persons')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('email', '=', 'bot@example.com')
      .executeTakeFirst();

    expect(person).toBeUndefined();
  });

  it('should NOT tag donor on donation form submits — donor is derived from donations (§15)', async () => {
    // 1. Create a Web Form definition of type donation
    const formId = randomUUID();
    await db
      .insertInto('web_forms')
      .values({
        id: formId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        name: 'Donation Form Test',
        slug: 'donation-form-test',
        status: 'published',
        form_type: 'donation',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // 2. Submit the donation form
    const payload = {
      email: 'donor@example.com',
      first_name: 'Jane',
      last_name: 'Doe',
      amount: '50.00',
      country: 'CA',
      state: 'ON',
      street1: '123 Main St',
      city: 'Toronto',
      zip: 'M5V 2T6',
    };

    try {
      await controller.submitFormPublic(tenant(), 'donation-form-test', payload, '127.0.0.1');
    } catch (_err) {
      // Mock Stripe key redirect or exception is fine
    }

    // 3. Verify Contact Creation, Household Address, and Tag Mapping
    const person = await db
      .selectFrom('persons')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('email', '=', 'donor@example.com')
      .executeTakeFirstOrThrow();

    expect(person.household_id).not.toBeNull();

    const hh = await db
      .selectFrom('households')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', person.household_id as any)
      .executeTakeFirstOrThrow();

    expect(hh.street1).toBe('123 Main St');
    expect(hh.city).toBe('Toronto');
    expect(hh.zip).toBe('M5V 2T6');

    const personTags = await db
      .selectFrom('map_peoples_tags')
      .innerJoin('tags', 'tags.id', 'map_peoples_tags.tag_id')
      .select('tags.name')
      .where('map_peoples_tags.tenant_id', '=', tenantId)
      .where('map_peoples_tags.person_id', '=', person.id)
      .execute();

    const tagNames = personTags.map((t: any) => t.name);
    // "Donor" retired as a tag (§15): it is derived from the donations table.
    expect(tagNames).not.toContain('donor');
    expect(tagNames).toContain('source: donation form test');
  });

  it('should validate user-configured required fields on standard form submission', async () => {
    // 1. Create a web form with a required field 'mobile:required'
    const formId = crypto.randomUUID();
    await db
      .insertInto('web_forms')
      .values({
        id: formId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        form_type: 'standard',
        name: 'Required Fields Test',
        slug: 'required-fields-test',
        fields: JSON.stringify(['first_name', 'mobile:required']),
        status: 'published',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // 2. Submit the form without the required mobile field
    const payloadWithoutMobile = {
      email: 'missing-mobile@example.com',
      first_name: 'Jane',
    };

    await expect(
      controller.submitFormPublic(tenant(), 'required-fields-test', payloadWithoutMobile, '127.0.0.2'),
    ).rejects.toThrow('Mobile / Phone is required.');

    // 3. Submit the form with the required mobile field
    const payloadWithMobile = {
      email: 'has-mobile@example.com',
      first_name: 'Jane',
      mobile: '555-0000',
    };

    const res = await controller.submitFormPublic(tenant(), 'required-fields-test', payloadWithMobile, '127.0.0.3');
    expect(res).toBeDefined();

    // 4. Verify Contact Creation
    const person = await db
      .selectFrom('persons')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('email', '=', 'has-mobile@example.com')
      .executeTakeFirstOrThrow();

    expect(person.mobile).toBe('555-0000');
  });
});

describe('WebFormsController lifecycle', () => {
  const controller = new WebFormsController();
  const db = (BaseRepository as any)._db;
  let tenantId: string;
  let tenantSlug: string;
  let userId: string;
  let campaignId: string;

  const auth = () => ({ tenant_id: tenantId, user_id: userId, session_id: 'test-session', name: 'Test User' });
  const tenant = () => ({ id: tenantId, slug: tenantSlug });

  beforeEach(async () => {
    const seed = await createTestSeed(db);
    tenantId = seed.tenantId;
    tenantSlug = seed.tenantSlug;
    userId = seed.userId;
    campaignId = seed.campaignId;
  });

  afterEach(async () => {
    await db.deleteFrom('form_submissions').where('tenant_id', '=', tenantId).execute();
    await cleanTenant(db, tenantId);
  });

  it('creates a draft from a template with normalized fields, a slug, and template copy', async () => {
    const form = await controller.createForm({ name: 'June phone bank signup', type: 'signup' }, auth() as any);

    expect(form.status).toBe('draft');
    expect(form.type).toBe('signup');
    expect(form.slug).toBe('june-phone-bank-signup');
    expect(form.submit_label).toBe('Sign me up');

    const fields = form.fields as Array<{ key: string; on: boolean; required: boolean }>;
    const email = fields.find((f) => f.key === 'email');
    expect(email).toMatchObject({ on: true, required: true });
    // Standard optional catalog fields are merged in, off by default.
    expect(fields.find((f) => f.key === 'street1')).toMatchObject({ on: false });
  });

  it('gives duplicate names distinct slugs within a tenant', async () => {
    const first = await controller.createForm({ name: 'Volunteer signup', type: 'signup' }, auth() as any);
    const second = await controller.createForm({ name: 'Volunteer signup', type: 'signup' }, auth() as any);
    expect(first.slug).toBe('volunteer-signup');
    expect(second.slug).toBe('volunteer-signup-2');
  });

  it('keeps the email field on+required even when a live update tries to disable it', async () => {
    const form = await controller.createForm({ name: 'Contact form', type: 'signup' }, auth() as any);
    const tampered = (form.fields as Array<Record<string, unknown>>).map((f) =>
      f['key'] === 'email' ? { ...f, on: false, required: false } : f,
    );
    const updated = await controller.updateFormLive(form.id, { fields: tampered as any }, auth() as any);
    const email = (updated.fields as Array<{ key: string; on: boolean; required: boolean }>).find(
      (f) => f.key === 'email',
    );
    expect(email).toMatchObject({ on: true, required: true });
  });

  it('walks publish → unpublish → archive → restore, and restore lands in draft', async () => {
    const form = await controller.createForm({ name: 'Lifecycle form', type: 'signup' }, auth() as any);
    expect((await controller.publishForm(form.id, auth() as any)).status).toBe('published');
    expect((await controller.unpublishForm(form.id, auth() as any)).status).toBe('draft');
    const archived = await controller.archiveForm(form.id, auth() as any);
    expect(archived.status).toBe('archived');
    expect(archived.archived_at).not.toBeNull();
    expect((await controller.restoreForm(form.id, auth() as any)).status).toBe('draft');
  });

  it('refuses to delete a published form and allows deleting a zero-response draft', async () => {
    const published = await controller.createForm({ name: 'Keep me', type: 'signup' }, auth() as any);
    await controller.publishForm(published.id, auth() as any);
    await expect(controller.deleteForm(published.id, auth() as any)).rejects.toThrow(/draft with no responses/i);

    const draft = await controller.createForm({ name: 'Throwaway', type: 'signup' }, auth() as any);
    await expect(controller.deleteForm(draft.id, auth() as any)).resolves.toBeDefined();
    const gone = await db
      .selectFrom('web_forms')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', draft.id)
      .executeTakeFirst();
    expect(gone).toBeUndefined();
  });

  it('records a submission (splitting full_name) and surfaces it in getFormSubmissions', async () => {
    const form = await controller.createForm({ name: 'Signup live', type: 'signup' }, auth() as any);
    await controller.publishForm(form.id, auth() as any);

    await controller.submitFormPublic(
      tenant(),
      form.slug,
      { email: 'responder@example.com', full_name: 'Rey Poll', availability: 'Event day' },
      '127.0.0.9',
    );

    const res = await controller.getFormSubmissions(form.id, tenantId);
    expect(res.total).toBe(1);
    expect(res.items[0]?.person_name).toBe('Rey Poll');
    expect(res.items[0]?.answers['availability']).toBe('Event day');

    const person = await db
      .selectFrom('persons')
      .select(['first_name', 'last_name'])
      .where('tenant_id', '=', tenantId)
      .where('email', '=', 'responder@example.com')
      .executeTakeFirstOrThrow();
    expect(person.first_name).toBe('Rey');
    expect(person.last_name).toBe('Poll');
  });

  it('serves a published form by slug and shows unpublished ones as closed', async () => {
    const form = await controller.createForm({ name: 'Public slug demo', type: 'signup' }, auth() as any);

    const asDraft = await controller.getPublicFormBySlug(form.slug!, tenantId);
    expect(asDraft.status).toBe('closed');

    await controller.publishForm(form.id, auth() as any);
    const asPublished = await controller.getPublicFormBySlug(form.slug!, tenantId);
    expect(asPublished.status).toBe('open');
    if (asPublished.status === 'open') {
      expect(asPublished.form.fields.every((f) => f.on)).toBe(true);
      expect(asPublished.form.fields.some((f) => f.key === 'email')).toBe(true);
    }

    await expect(controller.getPublicFormBySlug('no-such-slug-xyz', tenantId)).rejects.toThrow();
  });

  it('resolves the same slug to the right tenant (no cross-tenant misrouting)', async () => {
    const seedB = await createTestSeed(db);
    const authB = { tenant_id: seedB.tenantId, user_id: seedB.userId, session_id: 'session-b', name: 'B' };
    try {
      const a = await controller.createForm({ name: 'Volunteer signup', type: 'signup' }, auth() as any);
      const b = await controller.createForm({ name: 'Volunteer signup', type: 'signup' }, authB as any);
      expect(a.slug).toBe('volunteer-signup');
      expect(b.slug).toBe('volunteer-signup'); // same slug in a different tenant is allowed

      await controller.publishForm(a.id, auth() as any);
      await controller.publishForm(b.id, authB as any);

      const ra = await controller.getPublicFormBySlug('volunteer-signup', tenantId);
      const rb = await controller.getPublicFormBySlug('volunteer-signup', seedB.tenantId);
      expect(ra.status).toBe('open');
      expect(rb.status).toBe('open');
      if (ra.status === 'open' && rb.status === 'open') {
        expect(ra.form.id).toBe(a.id);
        expect(rb.form.id).toBe(b.id);
        expect(ra.form.id).not.toBe(rb.form.id);
      }
    } finally {
      await db.deleteFrom('form_submissions').where('tenant_id', '=', seedB.tenantId).execute();
      await cleanTenant(db, seedB.tenantId);
    }
  });

  it('includes donation forms in listForms (unified list) but still 404s them on the public /f/:slug lookup', async () => {
    await controller.createForm({ name: 'Signup A', type: 'signup' }, auth() as any);
    await db
      .insertInto('web_forms')
      .values({
        id: randomUUID(),
        tenant_id: tenantId,
        campaign_id: campaignId,
        name: 'Donation page',
        slug: 'donation-page',
        status: 'published',
        form_type: 'donation',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    // Donation forms are surfaced in the unified Forms list; the frontend routes clicks on them to
    // the /donation-pages (Stripe) editor, keying off form_type, which must survive to the client.
    const forms = await controller.listForms(tenantId);
    expect(forms.some((f: any) => f.name === 'Signup A')).toBe(true);
    const donationRow = forms.find((f: any) => f.name === 'Donation page');
    expect(donationRow).toBeDefined();
    expect((donationRow as any).form_type).toBe('donation');

    // Donation forms have slugs like every form, but only resolve on the /d/ donation page —
    // the /f/ SPA page (no amount field) must 404 them.
    await expect(controller.getPublicFormBySlug('donation-page', tenantId)).rejects.toThrow();
    const donation = await controller.getDonationFormPublic(tenantId, 'donation-page');
    expect(donation?.name).toBe('Donation page');
  });

  it('refuses public submissions once the tenant drops to the Free plan', async () => {
    const form = await controller.createForm({ name: 'Downgrade guard', type: 'signup' }, auth() as any);
    await controller.publishForm(form.id, auth() as any);

    await db.updateTable('tenants').set({ subscription_plan: 'free' }).where('id', '=', tenantId).execute();

    // Gating only the authoring router left every already-embedded form quietly accepting
    // submissions after a downgrade — the tRPC gate stopped you editing the form, not using it.
    await expect(
      controller.submitFormPublic(
        tenant(),
        form.slug,
        { email: 'late@example.com', full_name: 'Too Late' },
        '127.0.0.55',
      ),
    ).rejects.toThrow(/Grassroots plan/);

    const submissions = await db
      .selectFrom('form_submissions')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('form_id', '=', form.id)
      .execute();
    expect(submissions).toHaveLength(0);
  });
});
