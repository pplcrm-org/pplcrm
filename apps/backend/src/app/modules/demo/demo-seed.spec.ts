import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BaseRepository } from '../../lib/base.repo';
import { INLINE_BODY_MAX_BYTES } from '../emails/services/email-body-text';
import { handleMaterializeDemoAttachments } from '../../lib/jobs/handlers/demo.handlers';
import { StorageService } from '../../lib/storage.service';
import { useTestTransaction } from '../../lib/test-utils/db-test-isolation';
import { ORG_MODE_IS_ELECTORAL, ORG_MODE_MODULE_DEFAULTS, SYSTEM_LISTS } from '@common';
import { STARTER_ISSUES, STARTER_TAGS, seedStarterForms, seedStarterTags } from '../auth/onboarding-seed';
import { ensureSystemLists } from '../lists/system-lists';
import { DemoController } from './controller';
import { assertNotDemoMode } from './demo-guard';
import type { OrgMode } from '@common';
import { DEMO_DATASETS } from './demo-datasets';
import { DEMO_MANIFEST_SETTINGS_KEY, DemoSeedManifestObj, deleteDemoData, seedDemoData } from './demo-seed';
import type { DemoSeedManifest } from './demo-seed';
import {
  DEMO_COMPANIES,
  DEMO_DELIVERY_REQUESTS,
  DEMO_DELIVERY_ROUTES,
  DEMO_DONATIONS,
  DEMO_EMAILS,
  DEMO_HOUSEHOLDS,
  DEMO_LISTS,
  DEMO_NEWSLETTERS,
  DEMO_PERSONS,
  DEMO_SUBMISSIONS,
  DEMO_PLEDGES,
  DEMO_TASKS,
  DEMO_TURFS,
  DEMO_USERS,
  DEMO_VOLUNTEER_EVENTS,
} from './demo-seed-data';
import { summarizeManifest } from './controller';
import { ForbiddenError, NotFoundError } from '../../errors/app-errors';

const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);

describe('demo seeding and exit-demo', () => {
  const ctx = useTestTransaction();

  interface Fixture {
    tenant_id: string;
    user_id: string;
    campaign_id: string;
    placeholder_household_id: string;
    forms: { id: string; slug: string }[];
    manifest: DemoSeedManifest;
  }

  /** `settings.value` is jsonb: pg returns it parsed, but a string is valid too. */
  const parseManifestValue = (value: unknown): Record<string, unknown> =>
    typeof value === 'string' ? JSON.parse(value) : (value as Record<string, unknown>);

  /** The two ids the materialize job's payload carries. */
  const idsOf = (f: Fixture) => ({ tenant_id: f.tenant_id, user_id: f.user_id });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Mirrors the signUp transaction's seeding-relevant steps for one fresh tenant, in the given
   * organization mode — starter vocabulary, starter forms and demo dataset all chosen the way
   * signup chooses them.
   *
   * Defaults to 'campaign': it is the mode with every section populated (signs, turfs, a donor
   * ledger), so it is the one the DEMO_* imports below describe and the widest exercise of the
   * seeder. The per-mode suite at the bottom covers the other three against their own datasets.
   */
  async function seedFixture(mode: OrgMode = 'campaign'): Promise<Fixture> {
    const dataset = DEMO_DATASETS[mode];
    if (!dataset) throw new Error(`No demo dataset for mode "${mode}"`);
    const trx = ctx.trx;
    const tenant_id = rand();
    const user_id = rand();
    const campaign_id = rand();
    const placeholder_household_id = rand();

    await trx.insertInto('tenants').values({ id: tenant_id, name: 'Demo Spec Tenant' }).execute();
    await trx
      .insertInto('authusers')
      .values({
        id: user_id,
        tenant_id,
        email: `demo-spec-${user_id}@example.com`,
        password: 'password',
        first_name: 'Demo',
        last_name: 'Owner',
        role: 'owner',
        verified: true,
        createdby_id: user_id,
        updatedby_id: user_id,
      })
      .execute();
    await trx
      .insertInto('campaigns')
      .values({
        id: campaign_id,
        tenant_id,
        admin_id: user_id,
        name: 'Demo Spec Office',
        kind: 'office',
        status: 'active',
        createdby_id: user_id,
        updatedby_id: user_id,
      })
      .execute();
    await trx
      .insertInto('households')
      .values({
        id: placeholder_household_id,
        tenant_id,
        campaign_id,
        is_placeholder: true,
        createdby_id: user_id,
        updatedby_id: user_id,
      })
      .execute();
    await trx
      .updateTable('tenants')
      .set({ admin_id: user_id, createdby_id: user_id, placeholder_household_id })
      .where('id', '=', tenant_id)
      .execute();
    await seedStarterTags({ tenant_id, user_id, mode }, trx);
    const forms = await seedStarterForms({ tenant_id, user_id, campaign_id, mode }, trx);
    // Mirrors signup: the built-in lists (§8) are seeded alongside the starter
    // data, not with the demo dataset, which is why they survive exit-demo.
    await ensureSystemLists({ tenant_id, user_id, campaign_id }, trx);
    const manifest = await seedDemoData(
      { tenant_id, user_id, campaign_id, placeholder_household_id, forms, dataset },
      trx,
    );
    return { tenant_id, user_id, campaign_id, placeholder_household_id, forms, manifest };
  }

  const count = async (
    table:
      | 'persons'
      | 'households'
      | 'companies'
      | 'tags'
      | 'tasks'
      | 'lists'
      | 'teams'
      | 'volunteer_events'
      | 'volunteer_shifts'
      | 'newsletters'
      | 'newsletter_events'
      | 'web_forms'
      | 'form_submissions'
      | 'campaign_person_facts'
      | 'campaign_subscriptions'
      | 'map_peoples_tags'
      | 'map_households_tags'
      | 'map_lists_persons'
      | 'map_teams_persons'
      | 'emails'
      | 'authusers'
      | 'profiles'
      | 'turfs'
      | 'turf_households'
      | 'turf_assignments'
      | 'turf_knocks'
      | 'delivery_requests'
      | 'delivery_routes'
      | 'delivery_route_stops'
      | 'donations'
      | 'donation_pledges'
      | 'potential_duplicates',
    tenant_id: string,
  ): Promise<number> => {
    const rows = await ctx.trx.selectFrom(table).select('tenant_id').where('tenant_id', '=', tenant_id).execute();
    return rows.length;
  };

  it('seeds the full related demo dataset with pre-baked geocoding and no sample markers', async () => {
    const f = await seedFixture();
    const trx = ctx.trx;

    expect(await count('persons', f.tenant_id)).toBe(DEMO_PERSONS.length);
    expect(await count('households', f.tenant_id)).toBe(DEMO_HOUSEHOLDS.length + 1); // + placeholder
    expect(await count('companies', f.tenant_id)).toBe(DEMO_COMPANIES.length);
    expect(await count('tags', f.tenant_id)).toBe(STARTER_TAGS.length + STARTER_ISSUES.length);
    expect(await count('tasks', f.tenant_id)).toBe(DEMO_TASKS.length);
    expect(await count('emails', f.tenant_id)).toBe(DEMO_EMAILS.length);
    expect(await count('authusers', f.tenant_id)).toBe(DEMO_USERS.length + 1); // + owner
    expect(await count('profiles', f.tenant_id)).toBe(DEMO_USERS.length);
    expect(await count('lists', f.tenant_id)).toBe(DEMO_LISTS.length + SYSTEM_LISTS.length);
    expect(await count('teams', f.tenant_id)).toBe(1);
    expect(await count('volunteer_events', f.tenant_id)).toBe(DEMO_VOLUNTEER_EVENTS.length);
    expect(await count('newsletters', f.tenant_id)).toBe(DEMO_NEWSLETTERS.length);
    expect(await count('web_forms', f.tenant_id)).toBe(7);
    expect(await count('form_submissions', f.tenant_id)).toBe(DEMO_SUBMISSIONS.length);
    expect(await count('campaign_person_facts', f.tenant_id)).toBeGreaterThan(20);
    expect(await count('campaign_subscriptions', f.tenant_id)).toBeGreaterThan(10);
    expect(await count('map_peoples_tags', f.tenant_id)).toBeGreaterThan(20);

    // Canvassing (§13): turfs cut over the demo households, tokenised
    // assignments for the active ones, and knock rows (progress is derived).
    expect(await count('turfs', f.tenant_id)).toBe(DEMO_TURFS.length);
    expect(await count('turf_households', f.tenant_id)).toBe(DEMO_TURFS.reduce((n, t) => n + t.households.length, 0));
    expect(await count('turf_assignments', f.tenant_id)).toBe(DEMO_TURFS.filter((t) => t.assigned).length);
    expect(await count('turf_knocks', f.tenant_id)).toBe(DEMO_TURFS.reduce((n, t) => n + (t.knocks?.length ?? 0), 0));
    expect(f.manifest.turfs).toHaveLength(DEMO_TURFS.length);

    // Deliveries (§14): requests across every tab, plus the two seeded routes.
    expect(await count('delivery_requests', f.tenant_id)).toBe(DEMO_DELIVERY_REQUESTS.length);
    expect(await count('delivery_routes', f.tenant_id)).toBe(DEMO_DELIVERY_ROUTES.length);
    expect(await count('delivery_route_stops', f.tenant_id)).toBe(
      DEMO_DELIVERY_ROUTES.reduce((n, r) => n + r.stops.length, 0),
    );
    // "Routed" is derived: a request on a pending stop stays 'approved'.
    const pendingStops = await trx
      .selectFrom('delivery_route_stops')
      .select('request_id')
      .where('tenant_id', '=', f.tenant_id)
      .where('status', '=', 'pending')
      .execute();
    expect(pendingStops.length).toBeGreaterThan(0);
    const routedRequests = await trx
      .selectFrom('delivery_requests')
      .select('status')
      .where('tenant_id', '=', f.tenant_id)
      .where(
        'id',
        'in',
        pendingStops.map((s) => String(s.request_id)),
      )
      .execute();
    expect(routedRequests.every((r) => r.status === 'approved')).toBe(true);

    // Fundraising (§12): a populated Donations ledger + active monthly pledges.
    // Only 'succeeded' gifts count toward the page stats, so all seeded rows use it.
    expect(await count('donations', f.tenant_id)).toBe(DEMO_DONATIONS.length);
    expect(await count('donation_pledges', f.tenant_id)).toBe(DEMO_PLEDGES.length);
    const succeeded = await trx.selectFrom('donations').select('status').where('tenant_id', '=', f.tenant_id).execute();
    expect(succeeded.every((d) => d.status === 'succeeded')).toBe(true);
    expect(f.manifest.donations).toHaveLength(DEMO_DONATIONS.length);

    // Every person belongs to a household and has an identity; some live on the placeholder.
    const persons = await trx
      .selectFrom('persons')
      .select(['household_id', 'public_id', 'slug', 'first_name', 'last_name', 'created_at'])
      .where('tenant_id', '=', f.tenant_id)
      .execute();
    expect(persons.every((p) => p.household_id != null)).toBe(true);
    expect(persons.every((p) => p.public_id != null && p.slug != null)).toBe(true);
    expect(persons.filter((p) => String(p.household_id) === f.placeholder_household_id).length).toBeGreaterThan(5);
    expect(persons.some((p) => `${p.first_name} ${p.last_name}`.includes('['))).toBe(false);
    // created_at is staggered so the dashboard growth chart draws a curve.
    const days = new Set(persons.map((p) => new Date(p.created_at as unknown as string).toDateString()));
    expect(days.size).toBeGreaterThan(10);

    // Geocoding is pre-baked: located, with coordinates and a real ward.
    const households = await trx
      .selectFrom('households')
      .select(['geocoding_status', 'lat', 'lng', 'ward', 'slug'])
      .where('tenant_id', '=', f.tenant_id)
      .where('is_placeholder', '=', false)
      .execute();
    expect(households).toHaveLength(DEMO_HOUSEHOLDS.length);
    expect(households.every((h) => h.geocoding_status === 'success')).toBe(true);
    expect(households.every((h) => h.lat != null && h.lng != null && h.ward != null)).toBe(true);
    expect(households.every((h) => h.slug != null)).toBe(true);

    // The flag and the manifest are written atomically with the data.
    const tenant = await trx
      .selectFrom('tenants')
      .select('demo_mode_at')
      .where('id', '=', f.tenant_id)
      .executeTakeFirstOrThrow();
    expect(tenant.demo_mode_at).not.toBeNull();
    const manifestRow = await trx
      .selectFrom('settings')
      .select('value')
      .where('tenant_id', '=', f.tenant_id)
      .where('key', '=', DEMO_MANIFEST_SETTINGS_KEY)
      .executeTakeFirstOrThrow();
    expect(manifestRow.value).toBeTruthy();
    expect(f.manifest.persons).toHaveLength(DEMO_PERSONS.length);
    expect(f.manifest.households).toHaveLength(DEMO_HOUSEHOLDS.length);
    expect(f.manifest.users).toHaveLength(DEMO_USERS.length);
    expect(f.manifest.emails).toHaveLength(DEMO_EMAILS.length);

    // Issues live in the tags table with type 'issue' and carry person assignments.
    const issues = await trx
      .selectFrom('tags')
      .select('name')
      .where('tenant_id', '=', f.tenant_id)
      .where('type', '=', 'issue')
      .execute();
    expect(issues).toHaveLength(STARTER_ISSUES.length);
    // The starter vocabulary is not manifest-tracked — it survives exit-demo.
    expect(f.manifest.tags).toHaveLength(0);

    // Some tasks and inbox emails are assigned to the demo teammates.
    const assignedToDemoUsers = await trx
      .selectFrom('tasks')
      .select('id')
      .where('tenant_id', '=', f.tenant_id)
      .where('assigned_to', 'in', f.manifest.users)
      .execute();
    expect(assignedToDemoUsers.length).toBeGreaterThan(0);

    // While in demo mode, the config guard refuses (settings/domains/sync/sending use it).
    await expect(assertNotDemoMode(trx, f.tenant_id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('keeps demo bodies inline and searchable, exactly as the ingester would store them', async () => {
    const f = await seedFixture();
    const bodies = await ctx.trx
      .selectFrom('email_bodies')
      .select(['body_html', 'storage_key', 'body_text'])
      .where('tenant_id', '=', f.tenant_id)
      .execute();

    expect(bodies).toHaveLength(DEMO_EMAILS.length);
    for (const body of bodies) {
      // Every demo body is a few hundred bytes — far under INLINE_BODY_MAX_BYTES — so
      // the ingester would keep it inline too. Nothing belongs in blob storage here.
      expect(body.body_html).toBeTruthy();
      expect(Buffer.byteLength(body.body_html ?? '', 'utf8')).toBeLessThan(INLINE_BODY_MAX_BYTES);
      expect(body.storage_key).toBeNull();
      // The GIN-indexed extract search will read. Omitting it leaves demo mail
      // unsearchable the day search ships.
      expect(body.body_text).toBeTruthy();
      expect(body.body_text).not.toContain('<p>');
    }
  });

  it('puts the snippet in preview_text and leaves the dedupe key alone', async () => {
    const f = await seedFixture();
    const rows = await ctx.trx
      .selectFrom('emails')
      .select(['preview', 'preview_text'])
      .where('tenant_id', '=', f.tenant_id)
      .execute();

    expect(rows).toHaveLength(DEMO_EMAILS.length);
    for (const row of rows) {
      // Demo mail was never synced, so it owns no provider dedupe key. Writing the snippet
      // here (as this seeder used to) is what hid the bug where the inbox displayed the key.
      expect(row.preview).toBeNull();
      expect(row.preview_text).toBeTruthy();
    }
    expect(rows.map((r) => r.preview_text).sort()).toEqual(DEMO_EMAILS.map((e) => e.preview_text).sort());
  });

  it('writes an email_headers row whose Message-ID a real sync can never adopt', async () => {
    const f = await seedFixture();
    const headers = await ctx.trx
      .selectFrom('email_headers')
      .innerJoin('emails', 'emails.id', 'email_headers.email_id')
      .select(['email_headers.raw_headers', 'email_headers.date_sent', 'emails.date_sent as denormalized'])
      .where('email_headers.tenant_id', '=', f.tenant_id)
      .execute();

    expect(headers).toHaveLength(DEMO_EMAILS.length);
    for (const h of headers) {
      // `emails.date_sent` is denormalized from this column and writers must keep them in step.
      expect(h.date_sent).toEqual(h.denormalized);
      // Demo mail is untagged (preview is null), so the ingester's Message-ID adoption path
      // would claim it if a synced message ever matched. `.invalid` is reserved and
      // unresolvable, so no real provider can emit a colliding id.
      expect(h.raw_headers).toMatch(/^Message-ID: <demo-\d+@demo\.invalid>$/);
    }
  });

  it('seeds attachments as metadata plus an outbox job, doing no blob I/O during signup', async () => {
    const f = await seedFixture();
    const trx = ctx.trx;
    const expected = DEMO_EMAILS.flatMap((e) => e.attachments ?? []);
    expect(expected.length).toBeGreaterThan(0);

    const attachments = await trx
      .selectFrom('email_attachments')
      .select(['filename', 'content_type', 'size_bytes', 'file_id', 'remote_ref', 'is_inline'])
      .where('tenant_id', '=', f.tenant_id)
      .execute();
    expect(attachments).toHaveLength(expected.length);

    for (const att of attachments) {
      // Signup writes the description only. Uploading here would add latency to every signup,
      // make a storage outage a signup failure, and strand blobs on rollback.
      expect(att.file_id).toBeNull();
      expect(att.remote_ref).toMatch(/^demo:/);
      // pg returns bigint columns as strings.
      expect(Number(att.size_bytes)).toBeGreaterThan(0);
    }
    expect(await trx.selectFrom('files').select('id').where('tenant_id', '=', f.tenant_id).execute()).toHaveLength(0);

    // Transactional outbox: exactly one job, queued in the seeding transaction.
    const jobs = await trx
      .selectFrom('background_jobs')
      .select('payload')
      .where('tenant_id', '=', f.tenant_id)
      .execute();
    const materializeJobs = jobs.filter(
      (j) =>
        (typeof j.payload === 'string' ? JSON.parse(j.payload) : j.payload)?.type === 'materialize_demo_attachments',
    );
    expect(materializeJobs).toHaveLength(1);
  });

  it('materializes the attachment payloads when the job runs, deduping identical blobs', async () => {
    const f = await seedFixture();
    const trx = ctx.trx;
    const uploads: { key: string; bytes: Buffer }[] = [];
    vi.spyOn(StorageService.prototype, 'upload').mockImplementation(async (key: string, bytes: Buffer) => {
      uploads.push({ key, bytes });
    });

    await handleMaterializeDemoAttachments({ type: 'materialize_demo_attachments', ...idsOf(f) }, trx as never);

    const attachments = await trx
      .selectFrom('email_attachments')
      .select('file_id')
      .where('tenant_id', '=', f.tenant_id)
      .execute();
    expect(attachments.every((a) => a.file_id !== null)).toBe(true);

    const files = await trx
      .selectFrom('files')
      .select(['storage_key', 'sha256_hex', 'size_bytes'])
      .where('tenant_id', '=', f.tenant_id)
      .execute();

    // One blob per DISTINCT payload — an asset used twice links one row, as the ingester does.
    const uniquePayloads = new Set(DEMO_EMAILS.flatMap((e) => e.attachments ?? [])).size;
    expect(files).toHaveLength(uniquePayloads);
    expect(uploads).toHaveLength(uniquePayloads);
    for (const upload of uploads) {
      const row = files.find((r) => r.storage_key === upload.key);
      expect(Number(row?.size_bytes)).toBe(upload.bytes.length);
      expect(row?.sha256_hex).toBe(createHash('sha256').update(upload.bytes).digest('hex'));
    }

    // The manifest must learn about the new files rows, or exit-demo leaks every blob:
    // `files` is not reached by the emails cascade.
    const manifestRow = await trx
      .selectFrom('settings')
      .select('value')
      .where('tenant_id', '=', f.tenant_id)
      .where('key', '=', DEMO_MANIFEST_SETTINGS_KEY)
      .executeTakeFirstOrThrow();
    // `settings.value` is jsonb — pg hands it back parsed, not as a string.
    const stored = parseManifestValue(manifestRow.value);
    expect(stored.files).toHaveLength(uniquePayloads);
  });

  it('is idempotent: a second run of the job uploads nothing new', async () => {
    const f = await seedFixture();
    const trx = ctx.trx;
    const uploadSpy = vi.spyOn(StorageService.prototype, 'upload').mockResolvedValue(undefined);

    const job = { type: 'materialize_demo_attachments' as const, ...idsOf(f) };
    await handleMaterializeDemoAttachments(job, trx as never);
    const afterFirst = uploadSpy.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    // A retry after a partial failure must finish the remainder, not duplicate blobs.
    await handleMaterializeDemoAttachments(job, trx as never);
    expect(uploadSpy.mock.calls.length).toBe(afterFirst);
  });

  it('leaves rows metadata-only when storage is down, without failing the job', async () => {
    const f = await seedFixture();
    const trx = ctx.trx;
    vi.spyOn(StorageService.prototype, 'upload').mockRejectedValue(new Error('storage down'));

    await expect(
      handleMaterializeDemoAttachments({ type: 'materialize_demo_attachments', ...idsOf(f) }, trx as never),
    ).resolves.toBeUndefined();

    const attachments = await trx
      .selectFrom('email_attachments')
      .select(['filename', 'size_bytes', 'file_id'])
      .where('tenant_id', '=', f.tenant_id)
      .execute();
    // The rows still describe the attachment (name and size show in the UI); only the payload
    // is missing, and no `files` row claims a blob that was never written.
    expect(attachments.length).toBeGreaterThan(0);
    expect(attachments.every((a) => a.file_id === null)).toBe(true);
    expect(await trx.selectFrom('files').select('id').where('tenant_id', '=', f.tenant_id).execute()).toHaveLength(0);
  });

  it('seeds a duplicates queue the March-import leftovers explain', async () => {
    const f = await seedFixture();
    const trx = ctx.trx;

    const rows = await trx
      .selectFrom('potential_duplicates')
      .select(['group_key', 'reason', 'person_id', 'household_id', 'company_id'])
      .where('tenant_id', '=', f.tenant_id)
      .execute();
    expect(rows.length).toBeGreaterThan(0);

    // Every seeded group is a PAIR — the page only pre-selects target/source for two-card
    // groups, and a demo that opens on a three-way cluster is a worse first impression.
    const byGroup = new Map<string, typeof rows>();
    for (const row of rows) {
      byGroup.set(row.group_key, [...(byGroup.get(row.group_key) ?? []), row]);
    }
    expect([...byGroup.values()].every((g) => g.length === 2)).toBe(true);

    // One group per entity tab, and both confidence bands on the People tab:
    // a same-household name match reads as "possible", a same-address one as "high".
    const personGroups = [...byGroup.values()].filter((g) => g.every((r) => r.person_id != null));
    expect(personGroups.some((g) => g[0]?.reason.includes('Same Household'))).toBe(true);
    expect(personGroups.some((g) => g[0]?.reason.includes('Same Address'))).toBe(true);
    // ...and never the same pair under two reasons (see recomputeAllDuplicates' cross-household
    // condition) — each duplicated person appears in exactly one group.
    const personIds = rows.filter((r) => r.person_id != null).map((r) => String(r.person_id));
    expect(new Set(personIds).size).toBe(personIds.length);

    expect(
      [...byGroup.values()].some((g) =>
        g.every((r) => r.household_id != null && r.reason.includes('Matching Address')),
      ),
    ).toBe(true);
    expect(
      [...byGroup.values()].some((g) =>
        g.every((r) => r.company_id != null && r.reason.includes('Matching Company Name')),
      ),
    ).toBe(true);
  });

  it('stores newsletter aggregates that reconcile with the raw events', async () => {
    const f = await seedFixture();
    const trx = ctx.trx;

    const sent = await trx
      .selectFrom('newsletters')
      .selectAll()
      .where('tenant_id', '=', f.tenant_id)
      .where('name', '=', 'Spring community update')
      .executeTakeFirstOrThrow();
    expect(sent.status).toBe('sent');
    expect(sent.send_date).not.toBeNull();

    const events = await trx
      .selectFrom('newsletter_events')
      .select(['email', 'event_type', 'url'])
      .where('tenant_id', '=', f.tenant_id)
      .where('newsletter_id', '=', String(sent.id))
      .execute();
    expect(events.length).toBeGreaterThan(30);

    const uniqueOpeners = new Set(events.filter((e) => e.event_type === 'open').map((e) => e.email)).size;
    const uniqueClickers = new Set(events.filter((e) => e.event_type === 'click').map((e) => e.email)).size;
    const bounces = events.filter((e) => e.event_type === 'bounce').length;
    const unsubs = events.filter((e) => e.event_type === 'unsubscribe').length;
    expect(Number(sent.unique_opens)).toBe(uniqueOpeners);
    expect(Number(sent.unique_clicks)).toBe(uniqueClickers);
    expect(Number(sent.bounce_count)).toBe(bounces);
    expect(Number(sent.unsubscribe_count)).toBe(unsubs);
    expect(Number(sent.delivered_count)).toBe(Number(sent.total_recipients) - bounces);

    const topLinks: unknown = typeof sent.top_links === 'string' ? JSON.parse(sent.top_links) : sent.top_links;
    expect(Array.isArray(topLinks)).toBe(true);
    expect((topLinks as { url: string; clicks: number }[]).length).toBeGreaterThan(0);
  });

  it('exit-demo deletes exactly the manifest rows and keeps forms, starter tags/issues, and user data', async () => {
    const f = await seedFixture();
    const trx = ctx.trx;

    // Simulate work the user did while exploring: a real person inside a demo
    // household (tagged with a starter tag), and a real task.
    const demoHouseholdId = f.manifest.households[0] as string;
    const starterTag = await trx
      .selectFrom('tags')
      .select('id')
      .where('tenant_id', '=', f.tenant_id)
      .where('name', '=', String(STARTER_TAGS[0]?.name))
      .executeTakeFirstOrThrow();
    const realPerson = await trx
      .insertInto('persons')
      .values({
        tenant_id: f.tenant_id,
        campaign_id: f.campaign_id,
        household_id: demoHouseholdId,
        first_name: 'Really',
        last_name: 'Mine',
        createdby_id: f.user_id,
        updatedby_id: f.user_id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('map_peoples_tags')
      .values({
        tenant_id: f.tenant_id,
        person_id: realPerson.id,
        tag_id: starterTag.id,
        createdby_id: f.user_id,
        updatedby_id: f.user_id,
      })
      .execute();
    // A real task assigned to a demo teammate must survive with the assignment cleared.
    const realTask = await trx
      .insertInto('tasks')
      .values({
        tenant_id: f.tenant_id,
        name: 'My real task',
        assigned_to: f.manifest.users[0],
        createdby_id: f.user_id,
        updatedby_id: f.user_id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    // Materialize the attachments first, so exit-demo is tested against a workspace whose
    // demo files actually exist — the state a real user exits from.
    const uploaded: string[] = [];
    vi.spyOn(StorageService.prototype, 'upload').mockImplementation(async (key: string) => {
      uploaded.push(key);
    });
    await handleMaterializeDemoAttachments({ type: 'materialize_demo_attachments', ...idsOf(f) }, trx as never);
    expect(uploaded.length).toBeGreaterThan(0);

    // Reload the manifest: the job appended the files ids it created, and exit-demo deletes
    // exactly what the manifest lists.
    const storedManifest = await trx
      .selectFrom('settings')
      .select('value')
      .where('tenant_id', '=', f.tenant_id)
      .where('key', '=', DEMO_MANIFEST_SETTINGS_KEY)
      .executeTakeFirstOrThrow();
    const manifest = DemoSeedManifestObj.parse(parseManifestValue(storedManifest.value));

    const purgedBlobKeys = await deleteDemoData(
      {
        tenant_id: f.tenant_id,
        user_id: f.user_id,
        manifest,
        placeholder_household_id: f.placeholder_household_id,
      },
      trx,
    );

    // The attachment `files` rows go with the demo data — they are NOT reached by the
    // emails cascade — and their blob keys come back so the caller can purge them after
    // the commit. Miss this and every exit-demo leaks a blob per attachment.
    expect(await trx.selectFrom('files').select('id').where('tenant_id', '=', f.tenant_id).execute()).toHaveLength(0);
    expect(new Set(purgedBlobKeys)).toEqual(new Set(uploaded));
    expect(purgedBlobKeys.length).toBeGreaterThan(0);

    // Demo data is gone.
    expect(await count('companies', f.tenant_id)).toBe(0);
    // The demo lists are gone; the built-ins (§8) are still standing — they are
    // product-owned, so exiting demo mode must never take them with it.
    const listsAfter = await trx
      .selectFrom('lists')
      .select(['name', 'system_key'])
      .where('tenant_id', '=', f.tenant_id)
      .orderBy('system_key')
      .execute();
    expect(listsAfter.map((l) => l.name)).toEqual(SYSTEM_LISTS.map((s) => s.name));
    expect(await count('teams', f.tenant_id)).toBe(0);
    expect(await count('volunteer_events', f.tenant_id)).toBe(0);
    expect(await count('volunteer_shifts', f.tenant_id)).toBe(0);
    expect(await count('newsletters', f.tenant_id)).toBe(0);
    expect(await count('newsletter_events', f.tenant_id)).toBe(0);
    expect(await count('form_submissions', f.tenant_id)).toBe(0);
    expect(await count('campaign_person_facts', f.tenant_id)).toBe(0);
    expect(await count('campaign_subscriptions', f.tenant_id)).toBe(0);
    // Demo persons' tag/issue mappings are gone; the real person's starter-tag
    // mapping survives (both sides of it were kept).
    expect(await count('map_peoples_tags', f.tenant_id)).toBe(1);
    expect(await count('map_households_tags', f.tenant_id)).toBe(0);
    expect(await count('emails', f.tenant_id)).toBe(0);
    expect(await count('profiles', f.tenant_id)).toBe(0);
    expect(await count('authusers', f.tenant_id)).toBe(1); // owner only
    expect(await count('turfs', f.tenant_id)).toBe(0);
    expect(await count('turf_households', f.tenant_id)).toBe(0);
    expect(await count('turf_assignments', f.tenant_id)).toBe(0);
    expect(await count('turf_knocks', f.tenant_id)).toBe(0);
    expect(await count('delivery_requests', f.tenant_id)).toBe(0);
    expect(await count('delivery_routes', f.tenant_id)).toBe(0);
    expect(await count('delivery_route_stops', f.tenant_id)).toBe(0);
    expect(await count('donations', f.tenant_id)).toBe(0);
    expect(await count('donation_pledges', f.tenant_id)).toBe(0);
    // Not manifest-tracked: potential_duplicates cascades off persons/households/companies.
    expect(await count('potential_duplicates', f.tenant_id)).toBe(0);

    // Kept: starter forms (still drafts), the starter tag/issue vocabulary
    // (fully editable), and the user's own rows.
    const forms = await trx.selectFrom('web_forms').select('status').where('tenant_id', '=', f.tenant_id).execute();
    expect(forms).toHaveLength(7);
    expect(forms.every((w) => w.status === 'draft')).toBe(true);
    const tags = await trx
      .selectFrom('tags')
      .select(['name', 'deletable'])
      .where('tenant_id', '=', f.tenant_id)
      .execute();
    expect(tags).toHaveLength(STARTER_TAGS.length + STARTER_ISSUES.length);
    expect(tags.every((t) => t.deletable)).toBe(true);
    const survivingMappings = await trx
      .selectFrom('map_peoples_tags')
      .select(['person_id', 'tag_id'])
      .where('tenant_id', '=', f.tenant_id)
      .execute();
    expect(survivingMappings).toHaveLength(1);
    expect(String(survivingMappings[0]?.person_id)).toBe(String(realPerson.id));
    expect(String(survivingMappings[0]?.tag_id)).toBe(String(starterTag.id));
    const persons = await trx
      .selectFrom('persons')
      .select(['id', 'household_id'])
      .where('tenant_id', '=', f.tenant_id)
      .execute();
    expect(persons).toHaveLength(1);
    expect(String(persons[0]?.id)).toBe(String(realPerson.id));
    // The real person was re-pointed from the demo household to the placeholder.
    expect(String(persons[0]?.household_id)).toBe(f.placeholder_household_id);
    const tasks = await trx
      .selectFrom('tasks')
      .select(['id', 'assigned_to'])
      .where('tenant_id', '=', f.tenant_id)
      .execute();
    expect(tasks.map((t) => String(t.id))).toEqual([String(realTask.id)]);
    // The demo-teammate assignment was detached before the user was deleted.
    expect(tasks[0]?.assigned_to).toBeNull();
    // Only the placeholder household remains.
    const households = await trx.selectFrom('households').select('id').where('tenant_id', '=', f.tenant_id).execute();
    expect(households.map((h) => String(h.id))).toEqual([f.placeholder_household_id]);

    // Flag + manifest cleared.
    const tenant = await trx
      .selectFrom('tenants')
      .select('demo_mode_at')
      .where('id', '=', f.tenant_id)
      .executeTakeFirstOrThrow();
    expect(tenant.demo_mode_at).toBeNull();
    const manifestRow = await trx
      .selectFrom('settings')
      .select('key')
      .where('tenant_id', '=', f.tenant_id)
      .where('key', '=', DEMO_MANIFEST_SETTINGS_KEY)
      .executeTakeFirst();
    expect(manifestRow).toBeUndefined();
  });

  it('exitDemoMode throws NotFoundError when there is no manifest (already exited)', async () => {
    const controller = new DemoController();
    await expect(
      controller.exitDemoMode({ tenant_id: rand(), user_id: rand(), session_id: 'spec-session' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('exitDemoMode requires an active subscription, then succeeds', async () => {
    // The controller opens its own transaction, so this test uses real rows
    // (cleaned up in finally) instead of the rollback harness.
    const db = BaseRepository.dbInstance;
    const controller = new DemoController();
    const tenant_id = rand();
    const user_id = rand();
    const campaign_id = rand();
    const placeholder_household_id = rand();
    const auth = { tenant_id, user_id, session_id: 'spec-session' };
    const emptyManifest = {
      version: 1,
      companies: [],
      households: [],
      persons: [],
      tags: [],
      tasks: [],
      lists: [],
      teams: [],
      volunteer_events: [],
      newsletters: [],
      users: [],
      emails: [],
    };

    try {
      await db.insertInto('tenants').values({ id: tenant_id, name: 'Demo Gate Tenant' }).execute();
      await db
        .insertInto('authusers')
        .values({
          id: user_id,
          tenant_id,
          email: `demo-gate-${user_id}@example.com`,
          password: 'password',
          first_name: 'Gate',
          last_name: 'Owner',
          role: 'owner',
          verified: true,
          createdby_id: user_id,
          updatedby_id: user_id,
        })
        .execute();
      await db
        .insertInto('campaigns')
        .values({
          id: campaign_id,
          tenant_id,
          admin_id: user_id,
          name: 'Demo Gate Office',
          createdby_id: user_id,
          updatedby_id: user_id,
        })
        .execute();
      await db
        .insertInto('households')
        .values({
          id: placeholder_household_id,
          tenant_id,
          campaign_id,
          is_placeholder: true,
          createdby_id: user_id,
          updatedby_id: user_id,
        })
        .execute();
      await db
        .updateTable('tenants')
        .set({ placeholder_household_id, demo_mode_at: new Date() })
        .where('id', '=', tenant_id)
        .execute();
      await db
        .insertInto('settings')
        .values({
          tenant_id,
          key: DEMO_MANIFEST_SETTINGS_KEY,
          value: JSON.stringify(emptyManifest),
          createdby_id: user_id,
          updatedby_id: user_id,
        })
        .execute();

      // No plan → refused.
      await expect(controller.exitDemoMode(auth)).rejects.toBeInstanceOf(ForbiddenError);

      // Active subscription → exit proceeds and clears the flag + manifest.
      await db.updateTable('tenants').set({ subscription_status: 'active' }).where('id', '=', tenant_id).execute();
      const result = await controller.exitDemoMode(auth);
      expect(result.success).toBe(true);
      const tenant = await db
        .selectFrom('tenants')
        .select('demo_mode_at')
        .where('id', '=', tenant_id)
        .executeTakeFirstOrThrow();
      expect(tenant.demo_mode_at).toBeNull();
    } finally {
      await db.deleteFrom('settings').where('tenant_id', '=', tenant_id).execute();
      await db.updateTable('tenants').set({ placeholder_household_id: null }).where('id', '=', tenant_id).execute();
      await db.deleteFrom('households').where('tenant_id', '=', tenant_id).execute();
      await db.deleteFrom('campaigns').where('tenant_id', '=', tenant_id).execute();
      await db.updateTable('tenants').set({ admin_id: null, createdby_id: null }).where('id', '=', tenant_id).execute();
      await db.deleteFrom('authusers').where('tenant_id', '=', tenant_id).execute();
      await db.deleteFrom('tenants').where('id', '=', tenant_id).execute();
    }
  });

  /**
   * The exit confirm has to be specific enough to earn the interruption, and hard-coded counts
   * drift the moment the seeder changes. These come from the manifest, so they cannot.
   */
  describe('summarizeManifest', () => {
    it('reports real counts from the manifest', async () => {
      const f = await seedFixture();
      const items = summarizeManifest(f.manifest);

      const people = items.find((i) => i.label === 'people');
      expect(people?.count).toBe(f.manifest.persons.length);
      expect(people?.count).toBeGreaterThan(0);
      expect(items.find((i) => i.label === 'sample lists')?.count).toBe(f.manifest.lists.length);

      // Nothing is reported at zero — the dialog should never read "0 companies".
      expect(items.every((i) => i.count > 0)).toBe(true);

      // Tags are never in the manifest (the starter vocabulary survives exit), so a category
      // that is not deleted can never appear in the list of what will be deleted.
      expect(items.some((i) => i.label.includes('tag'))).toBe(false);
    });
  });

  /**
   * The campaign suite above proves the SEEDER works. These prove the datasets written for the
   * other three modes actually land in Postgres — the failure this catches is not a broken
   * reference (demo-datasets.spec.ts covers those statically) but a row the database rejects, or
   * a submission silently dropped because the form slug does not exist for that mode.
   *
   * Every module-dependent expectation is derived from ORG_MODE_MODULE_DEFAULTS rather than
   * hard-coded, so this stays honest for a mode like `office` that shows canvassing and deliveries
   * but hides donations.
   */
  describe.each([['office' as const], ['nonprofit' as const], ['church' as const]])('%s demo workspace', (mode) => {
    it('seeds end to end, with nothing behind a hidden module', async () => {
      const dataset = DEMO_DATASETS[mode];
      if (!dataset) throw new Error(`no dataset for ${mode}`);
      const modules = ORG_MODE_MODULE_DEFAULTS[mode];
      const f = await seedFixture(mode);

      expect(await count('persons', f.tenant_id)).toBe(dataset.persons.length);
      expect(await count('households', f.tenant_id)).toBe(dataset.households.length + 1); // + placeholder
      expect(await count('companies', f.tenant_id)).toBe(dataset.companies.length);
      expect(await count('tasks', f.tenant_id)).toBe(dataset.tasks.length);
      expect(await count('emails', f.tenant_id)).toBe(dataset.emails.length);
      expect(await count('newsletters', f.tenant_id)).toBe(dataset.newsletters.length);
      expect(await count('volunteer_events', f.tenant_id)).toBe(dataset.volunteerEvents.length);

      // Donations are seeded iff the mode shows them; an office keeps its ledger empty because
      // the association it fundraises through is a different entity with its own books.
      expect(await count('donations', f.tenant_id)).toBe(dataset.donations.length);
      expect(await count('donation_pledges', f.tenant_id)).toBe(dataset.pledges.length);
      if (!modules.donations) {
        expect(await count('donations', f.tenant_id)).toBe(0);
        expect(await count('donation_pledges', f.tenant_id)).toBe(0);
      }

      // The silent-skip failure: a submission whose form slug this mode never seeds is dropped
      // without an error, so the count is the only evidence.
      expect(await count('form_submissions', f.tenant_id)).toBe(dataset.submissions.length);

      // Tag and issue attachments likewise vanish quietly when the name does not match.
      expect(await count('map_peoples_tags', f.tenant_id)).toBeGreaterThan(0);

      // Field data exists exactly where the sidebar links to it.
      expect(await count('turfs', f.tenant_id)).toBe(modules.canvassing ? dataset.turfs.length : 0);
      expect(await count('delivery_requests', f.tenant_id)).toBe(
        modules.deliveries ? dataset.deliveryRequests.length : 0,
      );
      expect(await count('delivery_routes', f.tenant_id)).toBe(modules.deliveries ? dataset.deliveryRoutes.length : 0);

      // Support levels and voting statuses belong to organizations that run elections.
      if (ORG_MODE_IS_ELECTORAL[mode]) {
        expect(await count('campaign_person_facts', f.tenant_id)).toBeGreaterThan(0);
      } else {
        expect(await count('campaign_person_facts', f.tenant_id)).toBe(0);
      }
      expect(await count('campaign_subscriptions', f.tenant_id)).toBeGreaterThan(0);
    });

    it('exits demo mode leaving the starter vocabulary behind', async () => {
      const f = await seedFixture(mode);
      await deleteDemoData(
        {
          tenant_id: f.tenant_id,
          user_id: f.user_id,
          manifest: f.manifest,
          placeholder_household_id: f.placeholder_household_id,
        },
        ctx.trx,
      );

      expect(await count('persons', f.tenant_id)).toBe(0);
      expect(await count('donations', f.tenant_id)).toBe(0);
      // Starter tags/issues and starter forms are not demo data — they survive.
      expect(await count('tags', f.tenant_id)).toBeGreaterThan(0);
      expect(await count('web_forms', f.tenant_id)).toBeGreaterThan(0);
    });
  });
});
