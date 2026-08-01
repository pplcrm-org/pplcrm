import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Transaction } from 'kysely';
import { z } from 'zod';
import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import { fingerprintFull, fingerprintStreet } from '../../lib/address-normalize';
import { deleteFileRowIfUnreferenced } from '../../lib/file-references';
import { logger } from '../../logger';
import { hashToken } from '../../lib/token-hash';
import { hashPassword } from '../../lib/password-hash';
import { backfillPersonPublicIds } from '../../lib/person-public-id';
import { legMinutes, roadKm } from '../../lib/routing/geo';
import type { LatLng } from '../../lib/routing/geo';
import { SERVICE_MINUTES_PER_STOP, SHARE_TOKEN_TTL_DAYS } from '../../lib/routing/route-constants';
import { backfillMissingSlugs } from '../../lib/slug';
import { DuplicateMaintenanceService } from '../persons/services/duplicate-maintenance.service';
import { extractBodyText } from '../emails/services/email-body-text';
import { buildDemoAttachment } from './demo-attachment-assets';
import type { DemoDataset, DemoEngagementDef, DemoNewsletterDef } from './demo-data-types';

/**
 * Everything `seedDemoData` created, keyed by table — stored as a `settings`
 * row so exit-demo can delete exactly these rows (and nothing the user created
 * meanwhile). The starter web forms and the starter tag/issue vocabulary
 * (auth/onboarding-seed.ts) are deliberately NOT here: they survive exiting
 * demo mode.
 */
export const DemoSeedManifestObj = z.object({
  version: z.literal(1),
  companies: z.array(z.string()),
  households: z.array(z.string()),
  persons: z.array(z.string()),
  /**
   * Legacy demo tag/issue ids. Tags and issues are starter vocabulary now
   * (seeded by auth/onboarding-seed.ts, kept on exit), so new manifests leave
   * this empty — it remains so manifests written before the change still
   * delete their rows.
   */
  tags: z.array(z.string()),
  tasks: z.array(z.string()),
  lists: z.array(z.string()),
  teams: z.array(z.string()),
  volunteer_events: z.array(z.string()),
  newsletters: z.array(z.string()),
  /** Demo teammates (authusers ids). */
  users: z.array(z.string()),
  emails: z.array(z.string()),
  /**
   * `files` rows behind the demo inbox attachments. `email_attachments` CASCADEs from
   * `emails`, but `files` does not — without this the rows (and their blobs) would
   * outlive exit-demo. Optional-with-default so manifests written before attachments
   * existed still parse.
   */
  files: z.array(z.string()).default([]),
  // Canvassing (§13) and Deliveries (§14) rows. Optional-with-default so a
  // manifest written before these features (or an empty test manifest) still
  // parses on exit-demo — a missing key just deletes nothing.
  turfs: z.array(z.string()).default([]),
  turf_assignments: z.array(z.string()).default([]),
  turf_knocks: z.array(z.string()).default([]),
  delivery_requests: z.array(z.string()).default([]),
  delivery_routes: z.array(z.string()).default([]),
  delivery_route_stops: z.array(z.string()).default([]),
  // Fundraising (§12) sample gifts + monthly pledges. The donation FORMS
  // survive exit (they are starter forms); these recorded gifts do not.
  donations: z.array(z.string()).default([]),
  donation_pledges: z.array(z.string()).default([]),
});
export type DemoSeedManifest = z.infer<typeof DemoSeedManifestObj>;

export const DEMO_MANIFEST_SETTINGS_KEY = 'demo_seed_manifest';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS);
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY_MS);
const hoursAgo = (n: number) => new Date(Date.now() - n * HOUR_MS);

interface SeedParams {
  tenant_id: string;
  user_id: string;
  campaign_id: string;
  placeholder_household_id: string;
  /** The starter forms created by seedStarterForms — submissions attach to two of them. */
  forms: { id: string; slug: string }[];
  /**
   * The demo workspace to seed, chosen by organization mode (see `demo-datasets.ts`). The seeder
   * is deliberately dataset-agnostic: everything vertical-specific lives in the data, so a mode
   * whose story has no doors simply arrives with `turfs: []`.
   */
  dataset: DemoDataset;
}

/**
 * Seeds the realistic demo dataset for a brand-new tenant, inside the signup
 * transaction. Returns the manifest it also persisted to `settings`; sets
 * `tenants.demo_mode_at` as the final step so the flag and the data are atomic.
 *
 * Geocoding is pre-baked (real coordinates + ward names in the dataset), so no
 * geocode_household jobs are enqueued and no Google API calls happen at signup.
 */
export async function seedDemoData(params: SeedParams, trx: Transaction<Models>): Promise<DemoSeedManifest> {
  const { tenant_id, user_id, campaign_id, placeholder_household_id, dataset } = params;
  const audit = { tenant_id, createdby_id: user_id, updatedby_id: user_id };

  // ── Demo teammates (real authusers so Users/assignment/inbox look staffed;
  //    random unguessable password + reserved-domain email = can never sign in).
  //    authusers.email is globally unique, so the address carries the tenant
  //    slug: <local>@<slug>.example.com — still an RFC 2606 reserved domain.
  const tenantRow = await trx.selectFrom('tenants').select('slug').where('id', '=', tenant_id).executeTakeFirst();
  const demoEmailDomain = `${tenantRow?.slug ?? `tenant-${tenant_id}`}.example.com`;
  const demoUserPassword = await hashPassword(randomUUID());
  const userRows = await trx
    .insertInto('authusers')
    .values(
      dataset.users.map((u) => ({
        ...audit,
        email: `${u.emailLocal}@${demoEmailDomain}`,
        first_name: u.first_name,
        last_name: u.last_name,
        role: u.role,
        password: demoUserPassword,
        password_reset_code: null,
        password_reset_code_created_at: null,
        verified: true,
        two_factor_enabled: false,
        two_factor_code: null,
        two_factor_expires_at: null,
        deletion_scheduled_at: null,
        deactivated_at: null,
        previous_email: null,
        previous_role: null,
        passkey_setup_dismissed_at: null,
      })),
    )
    .returning('id')
    .execute();
  const userIdByKey = new Map(dataset.users.map((u, i) => [u.key, String(userRows[i]?.id)]));
  // Mirrors AuthController.createProfile: profile id == authuser id.
  await trx
    .insertInto('profiles')
    .values(
      userRows.map((u) => ({
        id: String(u.id),
        tenant_id,
        auth_id: String(u.id),
        createdby_id: user_id,
        updatedby_id: user_id,
      })),
    )
    .execute();

  // ── Companies ─────────────────────────────────────────────────────────────
  const companyRows = await trx
    .insertInto('companies')
    .values(
      dataset.companies.map((c) => ({
        ...audit,
        name: c.name,
        description: c.description,
        website: c.website,
        email: c.email,
        phone: c.phone,
        industry: c.industry,
      })),
    )
    .returning('id')
    .execute();
  const companyIdByKey = new Map(dataset.companies.map((c, i) => [c.key, String(companyRows[i]?.id)]));

  // ── Households (geocode pre-baked: success + lat/lng + ward) ─────────────
  const householdRows = await trx
    .insertInto('households')
    .values(
      dataset.households.map((h) => {
        const address = {
          street_num: h.street_num,
          street1: h.street1,
          city: dataset.city,
          state: dataset.state,
          zip: h.zip,
          country: dataset.country,
        };
        return {
          ...audit,
          campaign_id,
          ...address,
          home_phone: h.home_phone ?? null,
          notes: h.notes ?? null,
          lat: h.lat,
          lng: h.lng,
          ward: h.ward,
          formatted_address: `${h.street_num} ${h.street1}, ${dataset.city}, ${dataset.state} ${h.zip}, ${dataset.country}`,
          geocoding_status: 'success',
          address_fp_street: fingerprintStreet(address),
          address_fp_full: fingerprintFull(address),
        };
      }),
    )
    .returning('id')
    .execute();
  const householdIdByKey = new Map(dataset.households.map((h, i) => [h.key, String(householdRows[i]?.id)]));

  // ── Persons (created_at staggered so the dashboard growth chart is real) ──
  const personRows = await trx
    .insertInto('persons')
    .values(
      dataset.persons.map((p) => ({
        ...audit,
        campaign_id,
        household_id: p.household ? householdIdByKey.get(p.household) : placeholder_household_id,
        company_id: p.company ? companyIdByKey.get(p.company) : null,
        first_name: p.first_name,
        last_name: p.last_name,
        email: p.email ?? null,
        mobile: p.mobile ?? null,
        notes: p.notes ?? null,
        do_not_contact: p.doNotContact ?? false,
        volunteer_status: p.volunteerStatus ?? null,
        staff_status: p.staffStatus ?? null,
        created_at: daysAgo(p.createdDaysAgo),
      })),
    )
    .returning('id')
    .execute();
  const personIdByKey = new Map(dataset.persons.map((p, i) => [p.key, String(personRows[i]?.id)]));
  const personByKey = new Map(dataset.persons.map((p) => [p.key, p]));

  await backfillPersonPublicIds(trx, tenant_id);
  await backfillMissingSlugs(trx, 'households', tenant_id);
  await backfillMissingSlugs(trx, 'companies', tenant_id);

  // ── Tag/issue attachments — the vocabulary itself is starter data seeded by
  //    seedStarterTags (auth/onboarding-seed.ts) before this runs, and it
  //    survives exit-demo. The demo dataset only maps demo persons/households
  //    onto it by name; those mappings die with the demo rows.
  const allTags = await trx.selectFrom('tags').select(['id', 'name']).where('tenant_id', '=', tenant_id).execute();
  const tagIdByName = new Map(allTags.map((t) => [t.name, String(t.id)]));

  const personTagRows = dataset.persons.flatMap((p) =>
    (p.tags ?? []).flatMap((tagName) => {
      const tag_id = tagIdByName.get(tagName);
      const person_id = personIdByKey.get(p.key);
      return tag_id && person_id ? [{ ...audit, person_id, tag_id }] : [];
    }),
  );
  if (personTagRows.length > 0) {
    await trx.insertInto('map_peoples_tags').values(personTagRows).execute();
  }

  const householdTagRows = dataset.households.flatMap((h) =>
    (h.tags ?? []).flatMap((tagName) => {
      const tag_id = tagIdByName.get(tagName);
      const household_id = householdIdByKey.get(h.key);
      return tag_id && household_id ? [{ ...audit, household_id, tag_id }] : [];
    }),
  );
  if (householdTagRows.length > 0) {
    await trx.insertInto('map_households_tags').values(householdTagRows).execute();
  }

  // ── Issue assignments (starter issues live in the tags table, type 'issue') ─
  const issueAssignmentRows = dataset.issueAssignments.flatMap((assignment) =>
    assignment.people.flatMap((personKey) => {
      const person_id = personIdByKey.get(personKey);
      const tag_id = tagIdByName.get(assignment.issue);
      return person_id && tag_id ? [{ ...audit, person_id, tag_id }] : [];
    }),
  );
  if (issueAssignmentRows.length > 0) {
    await trx.insertInto('map_peoples_tags').values(issueAssignmentRows).execute();
  }

  // ── Campaign-scoped facts + newsletter consent (Campaigns §15) ────────────
  const factRows = dataset.persons
    .filter((p) => p.supportLevel || p.votingStatus)
    .map((p) => ({
      ...audit,
      campaign_id,
      person_id: personIdByKey.get(p.key) as string,
      support_level: p.supportLevel ?? null,
      support_source: p.supportLevel ? 'import' : null,
      support_recorded_by: p.supportLevel ? user_id : null,
      support_recorded_at: p.supportLevel ? daysAgo(p.createdDaysAgo) : null,
      voting_status: p.votingStatus ?? null,
      voting_source: p.votingStatus ? 'import' : null,
      voting_recorded_by: p.votingStatus ? user_id : null,
      voting_recorded_at: p.votingStatus ? daysAgo(Math.max(p.createdDaysAgo - 1, 0)) : null,
    }));
  if (factRows.length > 0) {
    await trx.insertInto('campaign_person_facts').values(factRows).execute();
  }

  const subscriptionRows = dataset.persons
    .filter((p) => p.subscribed && p.email)
    .map((p) => ({
      ...audit,
      campaign_id,
      person_id: personIdByKey.get(p.key) as string,
      email: p.email as string,
      status: 'subscribed',
      consent_source: 'import',
      consent_at: daysAgo(p.createdDaysAgo),
    }));
  if (subscriptionRows.length > 0) {
    await trx.insertInto('campaign_subscriptions').values(subscriptionRows).execute();
  }

  // ── Tasks ─────────────────────────────────────────────────────────────────
  const taskRows = await trx
    .insertInto('tasks')
    .values(
      dataset.tasks.map((t) => ({
        ...audit,
        name: t.name,
        details: t.details,
        status: t.status,
        priority: t.priority,
        position: t.position,
        due_at: t.dueInDays != null ? daysFromNow(t.dueInDays) : null,
        completed_at: t.completedDaysAgo != null ? daysAgo(t.completedDaysAgo) : null,
        assigned_to: t.assignToOwner ? user_id : t.assignToUser ? (userIdByKey.get(t.assignToUser) ?? null) : null,
      })),
    )
    .returning('id')
    .execute();

  // ── Lists ─────────────────────────────────────────────────────────────────
  const listRows = !dataset.lists.length
    ? []
    : await trx
        .insertInto('lists')
        .values(
          dataset.lists.map((l) => ({
            ...audit,
            campaign_id,
            name: l.name,
            description: l.description,
            object: 'people' as const,
            is_dynamic: false,
            status: 'idle' as const,
          })),
        )
        .returning('id')
        .execute();
  const listMemberRows = dataset.lists.flatMap((l, i) =>
    l.members.flatMap((personKey) => {
      const person_id = personIdByKey.get(personKey);
      const list_id = listRows[i]?.id;
      return person_id && list_id ? [{ ...audit, list_id: String(list_id), person_id }] : [];
    }),
  );
  if (listMemberRows.length > 0) {
    await trx.insertInto('map_lists_persons').values(listMemberRows).execute();
  }

  // ── Team ──────────────────────────────────────────────────────────────────
  const team = await trx
    .insertInto('teams')
    .values({
      ...audit,
      name: dataset.team.name,
      description: dataset.team.description,
      team_lead_user_id: user_id,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const teamMemberRows = dataset.team.members.flatMap((personKey) => {
    const person_id = personIdByKey.get(personKey);
    return person_id ? [{ ...audit, team_id: String(team.id), person_id }] : [];
  });
  if (teamMemberRows.length > 0) {
    await trx.insertInto('map_teams_persons').values(teamMemberRows).execute();
  }

  // ── Volunteer events + shifts ─────────────────────────────────────────────
  const eventIds: string[] = [];
  for (const ev of dataset.volunteerEvents) {
    const start = daysFromNow(ev.startInDays);
    start.setHours(10, 0, 0, 0);
    const end = new Date(start.getTime() + ev.durationHours * 60 * 60 * 1000);
    const event = await trx
      .insertInto('volunteer_events')
      .values({
        ...audit,
        name: ev.name,
        description: ev.description,
        location_address: ev.location_address,
        start_time: start,
        end_time: end,
        capacity: ev.capacity,
        is_private: false,
        send_reminder: false,
        send_signup_confirmation: false,
        send_volunteer_alert: false,
        slug: ev.slug,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    eventIds.push(String(event.id));
    const shiftRows = ev.shifts.flatMap((s) => {
      const person_id = personIdByKey.get(s.person);
      return person_id ? [{ ...audit, event_id: String(event.id), person_id, status: s.status }] : [];
    });
    if (shiftRows.length > 0) {
      await trx.insertInto('volunteer_shifts').values(shiftRows).execute();
    }
  }

  // ── Newsletters — aggregates DERIVED from the engagement spec ─────────────
  const newsletterIds: string[] = [];
  for (const nl of dataset.newsletters) {
    const sendDate = nl.sentDaysAgo != null ? daysAgo(nl.sentDaysAgo) : null;
    const stats = deriveNewsletterStats(nl);
    const newsletter = await trx
      .insertInto('newsletters')
      .values({
        ...audit,
        campaign_id,
        name: nl.name,
        status: nl.status,
        subject: nl.subject,
        preview_text: nl.preview_text,
        audience_description: nl.audience_description,
        html_content: nl.html_content,
        plain_text_content: nl.plain_text_content,
        send_date: sendDate,
        total_recipients: stats.totalRecipients,
        delivered_count: stats.delivered,
        bounce_count: stats.bounces,
        unique_opens: stats.uniqueOpens,
        unique_clicks: stats.uniqueClicks,
        unsubscribe_count: stats.unsubscribes,
        open_rate: stats.openRate,
        click_rate: stats.clickRate,
        top_links: JSON.stringify(stats.topLinks),
        last_engagement_at:
          sendDate && stats.lastEngagementHours > 0 ? hoursAfter(sendDate, stats.lastEngagementHours) : null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    newsletterIds.push(String(newsletter.id));

    if (sendDate && nl.engagement && nl.engagement.length > 0) {
      // sg_event_id is globally unique — prefix with the tenant so every signup's
      // seeded events coexist.
      const eventRows = buildNewsletterEvents(`${tenant_id}-${nl.key}`, nl.engagement, sendDate).flatMap((e) => {
        const person = personByKey.get(e.person);
        return person?.email
          ? [
              {
                tenant_id,
                newsletter_id: String(newsletter.id),
                email: person.email,
                event_type: e.event_type,
                sg_event_id: e.sg_event_id,
                url: e.url,
                reason: e.reason,
                bounce_type: e.bounce_type,
                timestamp: e.timestamp,
              },
            ]
          : [];
      });
      if (eventRows.length > 0) {
        await trx.insertInto('newsletter_events').values(eventRows).execute();
      }
    }
  }

  // ── Form submissions (against two of the starter forms) ──────────────────
  const formIdBySlug = new Map(params.forms.map((f) => [f.slug, f.id]));
  const submissionRows = dataset.submissions.flatMap((s) => {
    const form_id = formIdBySlug.get(s.formSlug);
    const person_id = personIdByKey.get(s.person);
    return form_id && person_id
      ? [
          {
            tenant_id,
            form_id,
            person_id,
            answers: JSON.stringify(s.answers),
            created_at: daysAgo(s.daysAgo),
          },
        ]
      : [];
  });
  if (submissionRows.length > 0) {
    await trx.insertInto('form_submissions').values(submissionRows).execute();
  }

  // ── Inbox/sent emails (folder ids: '11' = Inbox, '3' = Sent) ──────────────
  const OFFICE_EMAIL = 'office@example.org';
  const emailIds: string[] = [];
  let attachmentCount = 0;
  for (const e of dataset.emails) {
    const person = personByKey.get(e.person);
    const personEmail = person?.email ?? OFFICE_EMAIL;
    const personName = person ? `${person.first_name} ${person.last_name}` : null;
    const isInbox = e.folder === 'inbox';
    const assigned_to = e.assignTo === 'owner' ? user_id : e.assignTo ? (userIdByKey.get(e.assignTo) ?? null) : null;
    const sentAt = daysAgo(e.daysAgo);
    const email = await trx
      .insertInto('emails')
      .values({
        ...audit,
        campaign_id,
        folder_id: isInbox ? '11' : '3',
        from_email: isInbox ? personEmail : OFFICE_EMAIL,
        to_email: isInbox ? OFFICE_EMAIL : personEmail,
        subject: e.subject,
        // `preview` is the PROVIDER DEDUPE KEY. Demo mail was never synced from anywhere, so
        // it has no key and this stays null — writing the snippet here (as this seeder used
        // to) is what masked the bug where the inbox rendered the dedupe key as the snippet.
        preview: null,
        preview_text: e.preview_text,
        status: e.status,
        assigned_to,
        is_favourite: e.is_favourite ?? false,
        created_at: sentAt,
        // The inbox sorts on date_sent, so demo mail has to carry the same backdated timestamp
        // as created_at or every seeded message stacks up at "now".
        date_sent: sentAt,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    emailIds.push(String(email.id));

    // The header row `emails.date_sent` is denormalized FROM. Writers are required to keep the
    // two in step, and the sweep reads the header side.
    //
    // The Message-ID deliberately uses `.invalid` (RFC 2606, never resolvable). The ingester
    // adopts a local, untagged message when a synced one carries a matching Message-ID — and
    // demo mail is untagged by definition now that `preview` is null. A reserved domain no real
    // provider can emit means a genuine sync can never collide with, and silently swallow, a
    // demo message.
    await trx
      .insertInto('email_headers')
      .values({
        ...audit,
        email_id: String(email.id),
        headers_json: null,
        raw_headers: `Message-ID: <demo-${email.id}@demo.invalid>`,
        date_sent: sentAt,
      })
      .execute();
    await trx
      .insertInto('email_bodies')
      .values({
        ...audit,
        email_id: String(email.id),
        body_html: e.body_html,
        // Demo bodies are a few hundred bytes, far under INLINE_BODY_MAX_BYTES, so they
        // stay inline exactly as the ingester would keep them — `storage_key` stays null.
        // `body_text` is not optional though: it is what the GIN index covers, and the
        // ingester always writes it. Omitting it would leave demo mail unsearchable the
        // day search ships, which reads as a search bug rather than missing seed data.
        body_text: extractBodyText(e.body_html),
      })
      .execute();
    await trx
      .insertInto('email_recipients')
      .values({
        ...audit,
        email_id: String(email.id),
        kind: 'to' as const,
        name: isInbox ? null : personName,
        email: isInbox ? OFFICE_EMAIL : personEmail,
        pos: 0,
      })
      .execute();

    // Attachments are seeded as METADATA ONLY here — filename, type and size, with a null
    // `file_id`. The payloads are built and uploaded afterwards by the
    // `materialize_demo_attachments` job enqueued below.
    //
    // Uploading inline instead would put blob I/O in the signup path: it adds latency to every
    // signup, turns a storage outage into a signup failure, and strands blobs when the signup
    // transaction rolls back. This is exactly the case the transactional outbox exists for.
    //
    // `remote_ref` carries the asset key, which is what the deferred-attachment shape is for:
    // the row describes the attachment while pointing at where its payload can still be got.
    let attachmentPos = 0;
    for (const assetKey of e.attachments ?? []) {
      attachmentPos++;
      const asset = buildDemoAttachment(assetKey);
      await trx
        .insertInto('email_attachments')
        .values({
          ...audit,
          email_id: String(email.id),
          filename: asset.filename,
          content_type: asset.content_type,
          size_bytes: asset.size_bytes,
          cid: null,
          is_inline: false,
          pos: attachmentPos,
          file_id: null,
          remote_ref: `demo:${assetKey}`,
        })
        .execute();
      attachmentCount++;
    }
  }

  // Transactional outbox: queued in the same transaction as the rows it completes, so a
  // rolled-back signup cannot leave a job pointing at data that never existed.
  if (attachmentCount > 0) {
    await trx
      .insertInto('background_jobs')
      .values({
        tenant_id,
        payload: JSON.stringify({ type: 'materialize_demo_attachments', tenant_id, user_id }),
      })
      .execute();
  }

  // ── Canvassing: turfs, doors, tokenised assignments, knocks (§13) ─────────
  //    Progress is DERIVED from the knocks at read time — we store only the
  //    lifecycle status and the raw knock rows (never counters). Knock times
  //    are relative to now so the derived display state is stable.
  const round1 = (n: number): number => Math.round(n * 10) / 10;
  const householdGeoByKey = new Map<string, LatLng>(dataset.households.map((h) => [h.key, { lat: h.lat, lng: h.lng }]));

  const turfIds: string[] = [];
  const turfAssignmentIds: string[] = [];
  const turfKnockIds: string[] = [];
  for (const turf of dataset.turfs) {
    const coords = turf.households.map((k) => householdGeoByKey.get(k)).filter((c): c is LatLng => c != null);
    const centroid_lat = coords.length > 0 ? coords.reduce((s, c) => s + c.lat, 0) / coords.length : null;
    const centroid_lng = coords.length > 0 ? coords.reduce((s, c) => s + c.lng, 0) / coords.length : null;
    const turfRow = await trx
      .insertInto('turfs')
      .values({
        ...audit,
        campaign_id,
        name: turf.name,
        status: turf.status,
        list_id: null,
        target_doors: turf.households.length,
        centroid_lat,
        centroid_lng,
        ward: turf.ward,
        notes: turf.notes ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const turf_id = String(turfRow.id);
    turfIds.push(turf_id);

    const doorRows = turf.households.flatMap((k) => {
      const household_id = householdIdByKey.get(k);
      return household_id ? [{ ...audit, turf_id, household_id }] : [];
    });
    if (doorRows.length > 0) {
      await trx.insertInto('turf_households').values(doorRows).execute();
    }

    if (turf.assigned) {
      // The token is the bearer credential for the account-less Companion, so
      // it is a real random secret (24 bytes base64url), exactly like the app.
      const assignment = await trx
        .insertInto('turf_assignments')
        .values({
          ...audit,
          turf_id,
          team_id: String(team.id),
          token_hash: hashToken(randomBytes(24).toString('base64url')),
          status: 'active',
          assigned_at: daysAgo(2),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      turfAssignmentIds.push(String(assignment.id));
    }

    const knockRows = (turf.knocks ?? []).flatMap((knock) => {
      const household_id = householdIdByKey.get(knock.household);
      if (!household_id) return [];
      const person_id = knock.person ? (personIdByKey.get(knock.person) ?? null) : null;
      return [
        {
          ...audit,
          turf_id,
          household_id,
          person_id,
          outcome: knock.outcome,
          response: knock.response ?? null,
          notes: knock.notes ?? null,
          source: 'companion',
          canvasser_name: knock.canvasser,
          client_knock_id: `demo-${turf.key}-${knock.household}`,
          knocked_at: hoursAgo(knock.knockedHoursAgo),
        },
      ];
    });
    if (knockRows.length > 0) {
      const insertedKnocks = await trx.insertInto('turf_knocks').values(knockRows).returning('id').execute();
      turfKnockIds.push(...insertedKnocks.map((r) => String(r.id)));
    }
  }

  // ── Deliveries: yard-sign requests, routes, stops (§14) ───────────────────
  //    "Routed" is derived from an active (pending) stop, so a request stays
  //    'approved' while it sits on a pending stop and 'delivered' once its stop
  //    is delivered — the seeded statuses already encode that. Route leg/est
  //    numbers are computed from the real coordinates with the routing engine's
  //    own geo helpers, never hand-faked.
  const requestRows = !dataset.deliveryRequests.length
    ? []
    : await trx
        .insertInto('delivery_requests')
        .values(
          dataset.deliveryRequests.map((r) => ({
            ...audit,
            campaign_id,
            household_id: householdIdByKey.get(r.household) as string,
            person_id: r.person ? (personIdByKey.get(r.person) ?? null) : null,
            web_form_id: null,
            source: r.source ?? 'manual',
            status: r.status,
            notes: r.notes ?? null,
            skip_reason: r.skipReason ?? null,
            created_at: daysAgo(r.createdDaysAgo),
          })),
        )
        .returning('id')
        .execute();
  const deliveryRequestIdByKey = new Map(dataset.deliveryRequests.map((r, i) => [r.key, String(requestRows[i]?.id)]));
  const deliveryRequestIds = requestRows.map((r) => String(r.id));

  const deliveryRouteIds: string[] = [];
  const deliveryStopIds: string[] = [];
  for (const route of dataset.deliveryRoutes) {
    const start: LatLng = { lat: route.startLat, lng: route.startLng };
    let travelMinutes = 0;
    let est_km = 0;
    const legs: number[] = [];
    let prev = start;
    for (const stop of route.stops) {
      const reqDef = dataset.deliveryRequests.find((r) => r.key === stop.request);
      const coord = (reqDef ? householdGeoByKey.get(reqDef.household) : undefined) ?? start;
      legs.push(round1(legMinutes(prev, coord)));
      travelMinutes += legMinutes(prev, coord);
      est_km += roadKm(prev, coord);
      prev = coord;
    }
    const routeRow = await trx
      .insertInto('delivery_routes')
      .values({
        ...audit,
        campaign_id,
        name: route.name,
        status: route.status,
        volunteer_person_id: route.volunteerPerson ? (personIdByKey.get(route.volunteerPerson) ?? null) : null,
        start_address: route.startAddress,
        start_lat: route.startLat,
        start_lng: route.startLng,
        est_minutes: round1(travelMinutes + SERVICE_MINUTES_PER_STOP * route.stops.length),
        est_km: round1(est_km),
        scheduled_for: route.scheduledInDays != null ? daysFromNow(route.scheduledInDays) : null,
        // Only the sha256 hash is ever stored; the raw token is discarded here
        // (staff re-share to get a fresh live link).
        share_token_hash: route.shared
          ? createHash('sha256').update(randomBytes(24).toString('base64url')).digest('hex')
          : null,
        share_token_expires_at: route.shared ? daysFromNow(SHARE_TOKEN_TTL_DAYS) : null,
        params: JSON.stringify({
          drivers: 1,
          service_minutes: SERVICE_MINUTES_PER_STOP,
          avg_speed_kmh: 30,
          include_return_leg: false,
        }),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const route_id = String(routeRow.id);
    deliveryRouteIds.push(route_id);

    const stopRows = route.stops.flatMap((stop, i) => {
      const request_id = deliveryRequestIdByKey.get(stop.request);
      return request_id
        ? [
            {
              ...audit,
              route_id,
              request_id,
              seq: i + 1,
              leg_minutes: legs[i] ?? 0,
              status: stop.status,
              reason: stop.reason ?? null,
              acted_at: stop.actedHoursAgo != null ? hoursAgo(stop.actedHoursAgo) : null,
              acted_via: stop.actedVia ?? null,
            },
          ]
        : [];
    });
    if (stopRows.length > 0) {
      const insertedStops = await trx.insertInto('delivery_route_stops').values(stopRows).returning('id').execute();
      deliveryStopIds.push(...insertedStops.map((r) => String(r.id)));
    }
  }

  // ── Fundraising: monthly pledges + recorded gifts (§12) ───────────────────
  //    The donation "giving page" forms are starter forms (survive exit); these
  //    recorded gifts populate the Donations page ledger + stats and ARE demo
  //    data. Only 'succeeded' gifts and 'active' pledges count toward the page
  //    numbers, so that is what we seed. Amounts are already in cents.
  const pledgeRows = !dataset.pledges.length
    ? []
    : await trx
        .insertInto('donation_pledges')
        .values(
          dataset.pledges.map((p) => {
            const person = personByKey.get(p.person);
            return {
              ...audit,
              campaign_id,
              person_id: personIdByKey.get(p.person) ?? null,
              monthly_amount: p.monthlyAmountCents,
              status: 'active',
              started_at: daysAgo(p.startedDaysAgo),
              next_billing_date: daysFromNow(p.nextBillingInDays),
              first_name: person?.first_name ?? null,
              last_name: person?.last_name ?? null,
              email: person?.email ?? null,
              stripe_subscription_id: null,
              stripe_customer_id: null,
            };
          }),
        )
        .returning('id')
        .execute();
  const pledgeIdByKey = new Map(dataset.pledges.map((p, i) => [p.key, String(pledgeRows[i]?.id)]));
  const donationPledgeIds = pledgeRows.map((r) => String(r.id));

  // donations has no createdby_id/updatedby_id columns — only tenant_id.
  const donationRows = !dataset.donations.length
    ? []
    : await trx
        .insertInto('donations')
        .values(
          dataset.donations.map((d) => {
            const person = personByKey.get(d.person);
            return {
              tenant_id,
              campaign_id,
              person_id: personIdByKey.get(d.person) ?? null,
              amount: d.amountCents,
              status: 'succeeded',
              method: d.method,
              receipt_sent: d.receiptSent ?? true,
              pledge_id: d.pledge ? (pledgeIdByKey.get(d.pledge) ?? null) : null,
              first_name: person?.first_name ?? null,
              last_name: person?.last_name ?? null,
              email: person?.email ?? null,
              stripe_session_id: null,
              created_at: daysAgo(d.createdDaysAgo),
            };
          }),
        )
        .returning('id')
        .execute();
  const donationIds = donationRows.map((r) => String(r.id));

  // ── Duplicates queue (§9.3) ───────────────────────────────────────────────
  //    The dataset deliberately contains the leftovers of a March CSV import
  //    (see the *-import keys in demo-seed-data), and the "Clean up duplicate
  //    entries" task points at them. Run the real sweep over the rows we just
  //    inserted rather than hand-writing potential_duplicates rows, so the
  //    group keys and reason strings are byte-identical to what the nightly
  //    cron would produce — otherwise the first sweep after signup would
  //    rewrite the queue and any "Not duplicates" dismissal made in between
  //    would stop matching. potential_duplicates cascades on person /
  //    household / company delete, so exit-demo takes these with it and they
  //    need no manifest entry.
  await new DuplicateMaintenanceService().recomputeAllDuplicates(tenant_id, trx);

  // ── Manifest + flag (atomic with the data) ────────────────────────────────
  const manifest: DemoSeedManifest = {
    version: 1,
    companies: [...companyIdByKey.values()],
    households: [...householdIdByKey.values()],
    persons: [...personIdByKey.values()],
    tags: [],
    tasks: taskRows.map((t) => String(t.id)),
    lists: listRows.map((l) => String(l.id)),
    teams: [String(team.id)],
    volunteer_events: eventIds,
    newsletters: newsletterIds,
    users: [...userIdByKey.values()],
    emails: emailIds,
    // Populated by the materialize_demo_attachments job, which appends the ids it creates.
    files: [],
    turfs: turfIds,
    turf_assignments: turfAssignmentIds,
    turf_knocks: turfKnockIds,
    delivery_requests: deliveryRequestIds,
    delivery_routes: deliveryRouteIds,
    delivery_route_stops: deliveryStopIds,
    donations: donationIds,
    donation_pledges: donationPledgeIds,
  };

  await trx
    .insertInto('settings')
    .values({
      tenant_id,
      key: DEMO_MANIFEST_SETTINGS_KEY,
      value: JSON.stringify(manifest),
      createdby_id: user_id,
      updatedby_id: user_id,
    })
    .execute();

  await trx.updateTable('tenants').set({ demo_mode_at: new Date() }).where('id', '=', tenant_id).execute();

  return manifest;
}

interface DeleteParams {
  tenant_id: string;
  user_id: string;
  manifest: DemoSeedManifest;
  placeholder_household_id: string;
}

/**
 * Deletes everything the manifest tracks, in FK-safe order, inside the caller's
 * transaction. Junction/child rows that would CASCADE anyway are deleted
 * explicitly so the intent is auditable; the one FK with NO cascade
 * (persons.household_id) is handled first by re-pointing any person the user
 * created inside a demo household at the tenant's placeholder household.
 * Clears the manifest settings row and the tenant's demo flag last.
 *
 * Returns the blob storage keys the caller must purge AFTER the transaction commits.
 * Deleting them inside would orphan real files if the transaction then rolled back —
 * the rows would come back and their payloads would not.
 */
export async function deleteDemoData(params: DeleteParams, trx: Transaction<Models>): Promise<string[]> {
  const { tenant_id, user_id, manifest: m, placeholder_household_id } = params;

  if (m.households.length > 0) {
    let repoint = trx
      .updateTable('persons')
      .set({ household_id: placeholder_household_id, updatedby_id: user_id })
      .where('tenant_id', '=', tenant_id)
      .where('household_id', 'in', m.households);
    if (m.persons.length > 0) {
      repoint = repoint.where('id', 'not in', m.persons);
    }
    await repoint.execute();
  }

  if (m.persons.length > 0) {
    await trx
      .deleteFrom('form_submissions')
      .where('tenant_id', '=', tenant_id)
      .where('person_id', 'in', m.persons)
      .execute();
    await trx
      .deleteFrom('campaign_person_facts')
      .where('tenant_id', '=', tenant_id)
      .where('person_id', 'in', m.persons)
      .execute();
    await trx
      .deleteFrom('campaign_subscriptions')
      .where('tenant_id', '=', tenant_id)
      .where('person_id', 'in', m.persons)
      .execute();
    await trx
      .deleteFrom('map_peoples_tags')
      .where('tenant_id', '=', tenant_id)
      .where('person_id', 'in', m.persons)
      .execute();
    await trx
      .deleteFrom('map_lists_persons')
      .where('tenant_id', '=', tenant_id)
      .where('person_id', 'in', m.persons)
      .execute();
  }

  if (m.volunteer_events.length > 0) {
    await trx
      .deleteFrom('volunteer_shifts')
      .where('tenant_id', '=', tenant_id)
      .where('event_id', 'in', m.volunteer_events)
      .execute();
    await trx
      .deleteFrom('volunteer_events')
      .where('tenant_id', '=', tenant_id)
      .where('id', 'in', m.volunteer_events)
      .execute();
  }

  if (m.teams.length > 0) {
    await trx
      .deleteFrom('map_teams_persons')
      .where('tenant_id', '=', tenant_id)
      .where('team_id', 'in', m.teams)
      .execute();
    await trx.deleteFrom('teams').where('tenant_id', '=', tenant_id).where('id', 'in', m.teams).execute();
  }

  if (m.lists.length > 0) {
    await trx
      .deleteFrom('map_lists_persons')
      .where('tenant_id', '=', tenant_id)
      .where('list_id', 'in', m.lists)
      .execute();
    await trx.deleteFrom('lists').where('tenant_id', '=', tenant_id).where('id', 'in', m.lists).execute();
  }

  if (m.tasks.length > 0) {
    await trx.deleteFrom('tasks').where('tenant_id', '=', tenant_id).where('id', 'in', m.tasks).execute();
  }

  const blobKeysToPurge: string[] = [];
  if (m.emails.length > 0) {
    // email_bodies/recipients/headers/comments/attachments/read_states/trash all CASCADE.
    await trx.deleteFrom('emails').where('tenant_id', '=', tenant_id).where('id', 'in', m.emails).execute();
  }

  if (m.newsletters.length > 0) {
    await trx
      .deleteFrom('newsletter_events')
      .where('tenant_id', '=', tenant_id)
      .where('newsletter_id', 'in', m.newsletters)
      .execute();
    await trx
      .deleteFrom('person_newsletter_engagements')
      .where('tenant_id', '=', tenant_id)
      .where('newsletter_id', 'in', m.newsletters)
      .execute();
    await trx.deleteFrom('newsletters').where('tenant_id', '=', tenant_id).where('id', 'in', m.newsletters).execute();
  }

  // Deliveries (§14) — stops reference both routes and requests, so drop stops
  // first, then requests and routes. All reference persons/households, so this
  // must run before those are deleted below.
  if (m.delivery_routes.length > 0) {
    await trx
      .deleteFrom('delivery_route_stops')
      .where('tenant_id', '=', tenant_id)
      .where('route_id', 'in', m.delivery_routes)
      .execute();
  }
  if (m.delivery_requests.length > 0) {
    await trx
      .deleteFrom('delivery_requests')
      .where('tenant_id', '=', tenant_id)
      .where('id', 'in', m.delivery_requests)
      .execute();
  }
  if (m.delivery_routes.length > 0) {
    await trx
      .deleteFrom('delivery_routes')
      .where('tenant_id', '=', tenant_id)
      .where('id', 'in', m.delivery_routes)
      .execute();
  }

  // Canvassing (§13) — knocks/assignments/doors are children of turfs and also
  // reference persons/households; drop them before persons/households below.
  if (m.turfs.length > 0) {
    await trx.deleteFrom('turf_knocks').where('tenant_id', '=', tenant_id).where('turf_id', 'in', m.turfs).execute();
    await trx
      .deleteFrom('turf_assignments')
      .where('tenant_id', '=', tenant_id)
      .where('turf_id', 'in', m.turfs)
      .execute();
    await trx
      .deleteFrom('turf_households')
      .where('tenant_id', '=', tenant_id)
      .where('turf_id', 'in', m.turfs)
      .execute();
    await trx.deleteFrom('turfs').where('tenant_id', '=', tenant_id).where('id', 'in', m.turfs).execute();
  }

  // Fundraising (§12) — gifts reference pledges (ON DELETE SET NULL), so drop
  // gifts first, then pledges. Both reference persons (SET NULL) but are demo
  // data, so delete them explicitly before persons below.
  if (m.donations.length > 0) {
    await trx.deleteFrom('donations').where('tenant_id', '=', tenant_id).where('id', 'in', m.donations).execute();
  }
  if (m.donation_pledges.length > 0) {
    await trx
      .deleteFrom('donation_pledges')
      .where('tenant_id', '=', tenant_id)
      .where('id', 'in', m.donation_pledges)
      .execute();
  }

  if (m.persons.length > 0) {
    await trx.deleteFrom('persons').where('tenant_id', '=', tenant_id).where('id', 'in', m.persons).execute();
  }
  if (m.households.length > 0) {
    await trx
      .deleteFrom('map_households_tags')
      .where('tenant_id', '=', tenant_id)
      .where('household_id', 'in', m.households)
      .execute();
    await trx.deleteFrom('households').where('tenant_id', '=', tenant_id).where('id', 'in', m.households).execute();
  }
  if (m.companies.length > 0) {
    await trx.deleteFrom('companies').where('tenant_id', '=', tenant_id).where('id', 'in', m.companies).execute();
  }

  // Tags/issues are starter vocabulary now and never enter new manifests
  // (they survive exit-demo). This block handles legacy manifests that still
  // list tag ids; the deletable guard keeps any protected tag even if a
  // manifest were ever to contain one by mistake.
  if (m.tags.length > 0) {
    await trx
      .deleteFrom('tags')
      .where('tenant_id', '=', tenant_id)
      .where('id', 'in', m.tags)
      .where('deletable', '=', true)
      .execute();
  }

  // Demo teammates last: everything they were assigned is either deleted above
  // or explicitly detached here (most authusers FKs have no ON DELETE action).
  if (m.users.length > 0) {
    const demoUserIds = m.users.filter((id) => id !== user_id);
    if (demoUserIds.length > 0) {
      await trx
        .updateTable('tasks')
        .set({ assigned_to: null })
        .where('tenant_id', '=', tenant_id)
        .where('assigned_to', 'in', demoUserIds)
        .execute();
      await trx
        .updateTable('persons')
        .set({ assigned_to: null })
        .where('tenant_id', '=', tenant_id)
        .where('assigned_to', 'in', demoUserIds)
        .execute();
      await trx
        .updateTable('emails')
        .set({ assigned_to: null })
        .where('tenant_id', '=', tenant_id)
        .where('assigned_to', 'in', demoUserIds)
        .execute();
      await trx
        .updateTable('teams')
        .set({ team_lead_user_id: null })
        .where('tenant_id', '=', tenant_id)
        .where('team_lead_user_id', 'in', demoUserIds)
        .execute();
      await trx
        .deleteFrom('email_read_states')
        .where('tenant_id', '=', tenant_id)
        .where('user_id', 'in', demoUserIds)
        .execute();
      await trx
        .deleteFrom('notifications')
        .where('tenant_id', '=', tenant_id)
        .where('user_id', 'in', demoUserIds)
        .execute();
      await trx
        .deleteFrom('user_activity')
        .where('tenant_id', '=', tenant_id)
        .where('user_id', 'in', demoUserIds)
        .execute();
      await trx.deleteFrom('sessions').where('tenant_id', '=', tenant_id).where('user_id', 'in', demoUserIds).execute();
      await trx
        .deleteFrom('map_campaigns_users')
        .where('tenant_id', '=', tenant_id)
        .where('user_id', 'in', demoUserIds)
        .execute();
      await trx.deleteFrom('profiles').where('tenant_id', '=', tenant_id).where('auth_id', 'in', demoUserIds).execute();
      // Never the caller, never an owner — belt and braces on top of the manifest.
      await trx
        .deleteFrom('authusers')
        .where('tenant_id', '=', tenant_id)
        .where('id', 'in', demoUserIds)
        .where('role', '!=', 'owner')
        .execute();
    }
  }

  // `files` is NOT reached by the emails cascade — email_attachments references it, not the other
  // way round — so the demo attachment files are deleted explicitly, and their blobs handed back
  // to the caller to delete after commit.
  //
  // This runs LAST, after every other demo row is gone, and each file goes through the shared
  // reference check. Both parts matter. Exiting demo mode does NOT delete the workspace — it
  // requires a paid subscription and leaves a live tenant with real data behind — and uploads are
  // sha256-deduped tenant-wide, so a real record can genuinely come to point at a demo file: a
  // user uploading a file with the same bytes gets the demo row back from FilesController
  // .registerFile, and a real synced email with matching bytes reuses it too. Running last means
  // any holder the check still finds is real user data rather than demo data awaiting deletion.
  for (const fileId of m.files) {
    try {
      const key = await deleteFileRowIfUnreferenced(trx, tenant_id, fileId, { includeEntityOwnership: true });
      if (key) blobKeysToPurge.push(key);
    } catch (err) {
      // Leaving a demo file behind is a small storage leak; failing the exit is a broken workspace.
      logger.error({ err, tenant_id, fileId }, 'Exit demo: failed to remove a demo attachment file');
    }
  }

  await trx
    .deleteFrom('settings')
    .where('tenant_id', '=', tenant_id)
    .where('key', '=', DEMO_MANIFEST_SETTINGS_KEY)
    .execute();
  await trx.updateTable('tenants').set({ demo_mode_at: null }).where('id', '=', tenant_id).execute();

  return blobKeysToPurge;
}

const hoursAfter = (base: Date, hours: number) => new Date(base.getTime() + hours * 60 * 60 * 1000);

interface DerivedNewsletterStats {
  totalRecipients: number;
  delivered: number;
  bounces: number;
  uniqueOpens: number;
  uniqueClicks: number;
  unsubscribes: number;
  openRate: number;
  clickRate: number;
  topLinks: { url: string; clicks: number }[];
  lastEngagementHours: number;
}

/**
 * Derives the stored aggregate columns from the engagement spec so the report
 * page numbers always reconcile with the raw newsletter_events rows.
 */
function deriveNewsletterStats(nl: DemoNewsletterDef): DerivedNewsletterStats {
  const engagement = nl.engagement ?? [];
  const totalRecipients = nl.recipients?.length ?? 0;
  const bounces = engagement.filter((e) => e.bounce).length;
  const delivered = Math.max(totalRecipients - bounces, 0);
  const uniqueOpens = engagement.filter((e) => e.opens > 0).length;
  const uniqueClicks = engagement.filter((e) => (e.clicks?.length ?? 0) > 0).length;
  const unsubscribes = engagement.filter((e) => e.unsubscribed).length;
  const rate = (n: number) => (delivered > 0 ? Math.round((n / delivered) * 1000) / 10 : 0);

  const clicksByUrl = new Map<string, number>();
  for (const e of engagement) {
    for (const url of e.clicks ?? []) {
      clicksByUrl.set(url, (clicksByUrl.get(url) ?? 0) + 1);
    }
  }
  const topLinks = [...clicksByUrl.entries()]
    .map(([url, clicks]) => ({ url, clicks }))
    .sort((a, b) => b.clicks - a.clicks);

  return {
    totalRecipients,
    delivered,
    bounces,
    uniqueOpens,
    uniqueClicks,
    unsubscribes,
    openRate: rate(uniqueOpens),
    clickRate: rate(uniqueClicks),
    topLinks,
    lastEngagementHours: engagement.length > 0 ? 72 : 0,
  };
}

interface BuiltNewsletterEvent {
  person: string;
  event_type: 'open' | 'click' | 'bounce' | 'unsubscribe';
  sg_event_id: string;
  url: string | null;
  reason: string | null;
  bounce_type: string | null;
  timestamp: Date;
}

/**
 * Expands the per-person engagement spec into raw event rows with timestamps
 * deterministically spread over the 72 hours after the send — enough variance
 * for a believable hourly timeline without a randomness dependency.
 */
function buildNewsletterEvents(
  newsletterKey: string,
  engagement: DemoEngagementDef[],
  sendDate: Date,
): BuiltNewsletterEvent[] {
  const events: BuiltNewsletterEvent[] = [];
  engagement.forEach((entry, i) => {
    for (let k = 0; k < entry.opens; k++) {
      events.push({
        person: entry.person,
        event_type: 'open',
        sg_event_id: `demo-${newsletterKey}-${entry.person}-open-${k}`,
        url: null,
        reason: null,
        bounce_type: null,
        timestamp: hoursAfter(sendDate, ((i * 5 + k * 13) % 71) + 1),
      });
    }
    (entry.clicks ?? []).forEach((url, j) => {
      events.push({
        person: entry.person,
        event_type: 'click',
        sg_event_id: `demo-${newsletterKey}-${entry.person}-click-${j}`,
        url,
        reason: null,
        bounce_type: null,
        timestamp: hoursAfter(sendDate, ((i * 7 + j * 9 + 3) % 70) + 2),
      });
    });
    if (entry.bounce) {
      events.push({
        person: entry.person,
        event_type: 'bounce',
        sg_event_id: `demo-${newsletterKey}-${entry.person}-bounce`,
        url: null,
        reason:
          entry.bounce === 'hard'
            ? '550 5.1.1 The email account does not exist'
            : '421 4.7.0 Mailbox temporarily unavailable',
        bounce_type: entry.bounce === 'hard' ? 'bounce' : 'blocked',
        timestamp: hoursAfter(sendDate, 1),
      });
    }
    if (entry.unsubscribed) {
      events.push({
        person: entry.person,
        event_type: 'unsubscribe',
        sg_event_id: `demo-${newsletterKey}-${entry.person}-unsub`,
        url: null,
        reason: null,
        bounce_type: null,
        timestamp: hoursAfter(sendDate, ((i * 11) % 60) + 8),
      });
    }
  });
  return events;
}
