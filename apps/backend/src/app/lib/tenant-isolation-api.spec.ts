import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PersonsRouter } from '../modules/persons/trpc.router';
import { HouseholdsRouter } from '../modules/households/trpc.router';
import { DonationsRouter } from '../modules/donations/trpc.router';
import { EmailsRouter } from '../modules/emails/trpc.router';
import { FilesRouter } from '../modules/files/trpc.router';
import { ExportsRouter } from '../modules/exports/trpc.router';
import { BaseRepository } from './base.repo';
import { hashToken } from './token-hash';

/**
 * Cross-tenant IDOR probe — the highest-stakes invariant in a multi-tenant CRM.
 *
 * This is deliberately NOT the same test as `rls-tenant-isolation.spec.ts`. That spec proves the
 * Postgres RLS *mechanism* works when a tenant is bound via `runWithTenant`. This one attacks the
 * surface an actual attacker reaches: a fully authenticated tRPC session for tenant A, calling
 * real procedures with tenant B's record IDs. It exercises the whole stack the request takes —
 * `isAuthed` (session lookup + `runWithTenant`), the router, the controller's app-level
 * `.where('tenant_id', …)` filters, and the RLS policy underneath them.
 *
 * Why that distinction matters: the `local/no-unscoped-db-query` lint rule is explicitly "a
 * tripwire, not a proof" (pplcrm-tenant-safety) and has documented blind spots — a query built
 * across two statements, or scoped inside a subquery, passes lint while leaking. Only an
 * end-to-end probe like this one can catch that class of bug.
 *
 * Assertion style: these tests assert that tenant B's DATA NEVER COMES BACK and is never mutated,
 * rather than asserting a specific TRPCError code. Returning `undefined` and throwing NOT_FOUND
 * are both secure; returning B's row is the breach. Pinning the error code would make the spec
 * brittle against a legitimate refactor without making it any stronger as a security test.
 *
 * Callers are built with `createCaller`, which DOES run the `isAuthed` middleware — so each tenant
 * needs a real `authusers` row and a real active `sessions` row whose `session_id` column holds
 * the HASH of the plaintext token the context carries.
 */
const rand = (): string => String(Math.floor(Math.random() * 100000000) + 10000000);
const db = BaseRepository.dbInstance;

interface SeededTenant {
  tenantId: string;
  userId: string;
  campaignId: string;
  householdId: string;
  personId: string;
  /** Plaintext session token; the DB stores only its hash. */
  sessionToken: string;
  personFirstName: string;

  // ── The four highest-leakage read surfaces this file also probes ──────────────
  // Each is one minimal record per tenant, with a unique marker string on it, so a probe can
  // prove the *data* never crosses the tenant wall (not merely that an error was thrown).
  donationId: string;
  /** Donor name recorded on the donation row — the marker searched for in ledger reads. */
  donationDonorName: string;
  /** A monthly pledge, the mutation target for cancelPledge. */
  pledgeId: string;
  emailId: string;
  emailSubject: string;
  /** Marker inside the email body blob — must never surface to another tenant. */
  emailBodyMarker: string;
  /** Attachment filename — the closest thing emails have to a storage-key leak. */
  attachmentFilename: string;
  fileId: string;
  fileFilename: string;
  /** Blob storage key — the pointer a cross-tenant read must never hand back. */
  fileStorageKey: string;
  exportId: string;
  exportFileName: string;
  /** Export blob storage key — the download pointer that must stay tenant-private. */
  exportStorageKey: string;
}

async function seedTenant(label: string): Promise<SeededTenant> {
  const tenantId = rand();
  const userId = rand();
  const campaignId = rand();
  const householdId = rand();
  const sessionToken = `idor-probe-${label}-${rand()}`;
  const personFirstName = `Person-${label}-${rand()}`;

  await db
    .insertInto('tenants')
    .values({
      id: tenantId,
      name: `IDOR Probe ${label}`,
      // A paid plan on purpose: the donations router gates mutations and the emails router gates
      // BOTH reads and mutations behind Grassroots+ (plan-gate.ts). On the default Free plan those
      // gates would deny every donation/email call — including the control tests — so a green run
      // would prove nothing about tenant scoping. Grassroots lets the calls reach the controller's
      // `.where('tenant_id', …)` filters, which is the wall under test.
      subscription_plan: 'grassroots',
    })
    .execute();
  await db
    .insertInto('authusers')
    .values({
      id: userId,
      tenant_id: tenantId,
      email: `idor-${userId}@example.com`,
      password: 'password',
      first_name: 'Idor',
      last_name: label,
      verified: true,
      // 'owner' deliberately: the strongest role, so a leak can never be attributed to some
      // incidental role restriction rather than to genuine tenant scoping.
      role: 'owner',
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();
  await db.updateTable('tenants').set({ admin_id: userId, createdby_id: userId }).where('id', '=', tenantId).execute();

  await db
    .insertInto('sessions')
    .values({
      id: rand(),
      session_id: hashToken(sessionToken),
      user_id: userId,
      tenant_id: tenantId,
      ip_address: '127.0.0.1',
      status: 'active',
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
    })
    .execute();

  await db
    .insertInto('campaigns')
    .values({
      id: campaignId,
      tenant_id: tenantId,
      admin_id: userId,
      name: `IDOR Campaign ${label}`,
      kind: 'office',
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();
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

  const person = await db
    .insertInto('persons')
    .values({
      tenant_id: tenantId,
      campaign_id: campaignId,
      household_id: householdId,
      first_name: personFirstName,
      createdby_id: userId,
      updatedby_id: userId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  // ── Donations ────────────────────────────────────────────────────────────────
  const donationDonorName = `Donor-${label}-${rand()}`;
  const donation = await db
    .insertInto('donations')
    .values({
      tenant_id: tenantId,
      campaign_id: campaignId,
      // `succeeded` so it appears in the ledger list read (the ledger shows received money only).
      amount: 5000,
      status: 'succeeded',
      method: 'cash',
      first_name: donationDonorName,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  const pledge = await db
    .insertInto('donation_pledges')
    .values({
      tenant_id: tenantId,
      campaign_id: campaignId,
      monthly_amount: 2500,
      status: 'active',
      createdby_id: userId,
      updatedby_id: userId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  // ── Emails (+ body blob + attachment) ────────────────────────────────────────
  const emailSubject = `Subject-${label}-${rand()}`;
  const emailBodyMarker = `BodyMarker-${label}-${rand()}`;
  const attachmentFilename = `secret-${label}-${rand()}.pdf`;
  const email = await db
    .insertInto('emails')
    .values({
      tenant_id: tenantId,
      campaign_id: campaignId,
      // Folder id 11 is Inbox, and detached_at defaults null, so the message is listable
      // (EMAIL_FOLDERS in libs/common/src/lib/emails.ts).
      folder_id: '11',
      from_email: `sender-${label}@example.com`,
      to_email: `to-${label}@example.com`,
      subject: emailSubject,
      status: 'open',
      createdby_id: userId,
      updatedby_id: userId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('email_bodies')
    .values({
      tenant_id: tenantId,
      email_id: String(email.id),
      body_html: `<p>${emailBodyMarker}</p>`,
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();
  await db
    .insertInto('email_attachments')
    .values({
      tenant_id: tenantId,
      email_id: String(email.id),
      filename: attachmentFilename,
      content_type: 'application/pdf',
      size_bytes: 123,
      is_inline: false,
      pos: 0,
      createdby_id: userId,
      updatedby_id: userId,
    })
    .execute();

  // ── Files (blob-backed row) ──────────────────────────────────────────────────
  const fileFilename = `file-${label}-${rand()}.pdf`;
  const fileStorageKey = `uploads/${tenantId}/${rand()}_${fileFilename}`;
  const file = await db
    .insertInto('files')
    .values({
      tenant_id: tenantId,
      filename: fileFilename,
      mime_type: 'application/pdf',
      size_bytes: 4096,
      storage_key: fileStorageKey,
      uploaded_by: userId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  // ── Data exports (blob-backed, completed) ────────────────────────────────────
  const exportFileName = `export-${label}-${rand()}.csv`;
  const exportStorageKey = `exports/${tenantId}/${rand()}.csv`;
  const exportRow = await db
    .insertInto('data_exports')
    .values({
      tenant_id: tenantId,
      user_id: userId,
      entity: 'persons',
      file_name: exportFileName,
      status: 'completed',
      row_count: 3,
      storage_key: exportStorageKey,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  return {
    tenantId,
    userId,
    campaignId,
    householdId,
    personId: String(person.id),
    sessionToken,
    personFirstName,
    donationId: String(donation.id),
    donationDonorName,
    pledgeId: String(pledge.id),
    emailId: String(email.id),
    emailSubject,
    emailBodyMarker,
    attachmentFilename,
    fileId: String(file.id),
    fileFilename,
    fileStorageKey,
    exportId: String(exportRow.id),
    exportFileName,
    exportStorageKey,
  };
}

async function purgeTenant(t: SeededTenant): Promise<void> {
  // The probe's own calls write activity rows, which FK-reference authusers — so these must go
  // before the user, or teardown trips fk_user_activity_createdby.
  await db.deleteFrom('user_activity').where('tenant_id', '=', t.tenantId).execute();
  // The extra probe records. Order matters: attachments/bodies reference emails, and donations
  // reference pledges/persons/campaigns — so children before parents, and all before the
  // authusers/campaigns/persons deletes below.
  await db.deleteFrom('email_attachments').where('tenant_id', '=', t.tenantId).execute();
  await db.deleteFrom('email_bodies').where('tenant_id', '=', t.tenantId).execute();
  await db.deleteFrom('emails').where('tenant_id', '=', t.tenantId).execute();
  await db.deleteFrom('data_exports').where('tenant_id', '=', t.tenantId).execute();
  await db.deleteFrom('files').where('tenant_id', '=', t.tenantId).execute();
  await db.deleteFrom('donations').where('tenant_id', '=', t.tenantId).execute();
  await db.deleteFrom('donation_pledges').where('tenant_id', '=', t.tenantId).execute();
  await db.deleteFrom('persons').where('tenant_id', '=', t.tenantId).execute();
  await db.deleteFrom('households').where('tenant_id', '=', t.tenantId).execute();
  await db.deleteFrom('campaigns').where('tenant_id', '=', t.tenantId).execute();
  await db.deleteFrom('sessions').where('tenant_id', '=', t.tenantId).execute();
  await db.updateTable('tenants').set({ admin_id: null, createdby_id: null }).where('id', '=', t.tenantId).execute();
  await db.deleteFrom('authusers').where('tenant_id', '=', t.tenantId).execute();
  await db.deleteFrom('tenants').where('id', '=', t.tenantId).execute();
}

/** The tRPC context a signed-in request carries, for the given seeded tenant. */
function ctxFor(t: SeededTenant): { auth: { tenant_id: string; user_id: string; session_id: string } } {
  return { auth: { tenant_id: t.tenantId, user_id: t.userId, session_id: t.sessionToken } };
}

/** Resolve whatever a call did — value or throw — into a single inspectable result. */
async function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await p };
  } catch (error) {
    return { ok: false, error };
  }
}

/** Read a person straight from the DB, bypassing all app scoping, to verify real-world effect. */
async function readPersonRaw(id: string): Promise<{ first_name: string | null } | undefined> {
  return db.selectFrom('persons').select('first_name').where('id', '=', id).executeTakeFirst();
}

// Raw readers for the four extra tables — same purpose as readPersonRaw: check the row's real
// state after a cross-tenant mutation attempt, bypassing every app-level and RLS scope. (RLS is
// inert here: these specs run with no tenant bound to the async context, so the GUC is empty and
// the policy allows all — see pplcrm-tenant-safety.)
async function readDonationRaw(id: string): Promise<{ status: string; first_name: string | null } | undefined> {
  return db.selectFrom('donations').select(['status', 'first_name']).where('id', '=', id).executeTakeFirst();
}
async function readPledgeRaw(id: string): Promise<{ status: string; cancelled_at: Date | null } | undefined> {
  return db.selectFrom('donation_pledges').select(['status', 'cancelled_at']).where('id', '=', id).executeTakeFirst();
}
async function readEmailRaw(
  id: string,
): Promise<{ status: string | null; deleted_at: Date | null; subject: string | null } | undefined> {
  return db.selectFrom('emails').select(['status', 'deleted_at', 'subject']).where('id', '=', id).executeTakeFirst();
}
async function readFileRaw(id: string): Promise<{ filename: string; storage_key: string } | undefined> {
  return db.selectFrom('files').select(['filename', 'storage_key']).where('id', '=', id).executeTakeFirst();
}
async function readExportRaw(
  id: string,
): Promise<{ status: string; file_name: string; storage_key: string | null } | undefined> {
  return db
    .selectFrom('data_exports')
    .select(['status', 'file_name', 'storage_key'])
    .where('id', '=', id)
    .executeTakeFirst();
}

/** Flatten either a bare array or a `{ rows }` page into a row array — list endpoints use both shapes. */
function rowsOf(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
  const maybe = (value as { rows?: unknown } | null)?.rows;
  return Array.isArray(maybe) ? (maybe as Array<Record<string, unknown>>) : [];
}

/** Whole-payload string scan — the strongest "B's data never comes back" check: it catches a leaked
 * marker no matter how deeply it is nested (storage keys, body content, download URLs, nested rows). */
function payloadContains(value: unknown, needle: string): boolean {
  return JSON.stringify(value ?? null).includes(needle);
}

describe('Cross-tenant API isolation (IDOR probe)', () => {
  let tenantA: SeededTenant;
  let tenantB: SeededTenant;

  beforeAll(async () => {
    tenantA = await seedTenant('A');
    tenantB = await seedTenant('B');
  });

  afterAll(async () => {
    if (tenantA) await purgeTenant(tenantA);
    if (tenantB) await purgeTenant(tenantB);
  });

  describe('control: the probe is actually wired up', () => {
    // Without this, every assertion below could pass simply because the caller is broken —
    // a test that denies everything proves nothing about isolation.
    it('lets tenant A read its OWN person, so denials below are meaningful', async () => {
      const caller = PersonsRouter.createCaller(ctxFor(tenantA));
      const result = await settle(caller.getById(tenantA.personId));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeTruthy();
        expect(result.value.first_name).toBe(tenantA.personFirstName);
      }
    });
  });

  describe('reads', () => {
    it("never returns another tenant's person by direct id", async () => {
      const caller = PersonsRouter.createCaller(ctxFor(tenantA));
      const result = await settle(caller.getById(tenantB.personId));

      // Throwing is fine. Returning B's row is the breach.
      if (result.ok) {
        expect(result.value ?? null).toBeNull();
      }
    });

    it("never includes another tenant's persons in a list read", async () => {
      const caller = PersonsRouter.createCaller(ctxFor(tenantA));
      const result = await settle(caller.getAll({}));

      expect(result.ok).toBe(true);
      if (result.ok) {
        const rows: Array<{ id?: unknown; first_name?: unknown }> = Array.isArray(result.value)
          ? result.value
          : ((result.value as { rows?: Array<{ id?: unknown; first_name?: unknown }> })?.rows ?? []);
        const ids = rows.map((r) => String(r.id));
        const names = rows.map((r) => String(r.first_name));

        expect(ids).not.toContain(tenantB.personId);
        expect(names).not.toContain(tenantB.personFirstName);
      }
    });

    it("never includes another tenant's households in a list read", async () => {
      const caller = HouseholdsRouter.createCaller(ctxFor(tenantA));
      const result = await settle(caller.getAll());

      expect(result.ok).toBe(true);
      if (result.ok) {
        const rows: Array<{ id?: unknown }> = Array.isArray(result.value)
          ? result.value
          : ((result.value as { rows?: Array<{ id?: unknown }> })?.rows ?? []);
        expect(rows.map((r) => String(r.id))).not.toContain(tenantB.householdId);
      }
    });
  });

  describe('writes', () => {
    it("never mutates another tenant's person", async () => {
      const caller = PersonsRouter.createCaller(ctxFor(tenantA));
      await settle(caller.update({ id: tenantB.personId, data: { first_name: 'PWNED' } }));

      // Whether the call threw or silently no-op'd, B's row must be untouched.
      const after = await readPersonRaw(tenantB.personId);
      expect(after?.first_name).toBe(tenantB.personFirstName);
    });

    it("never deletes another tenant's person", async () => {
      const caller = PersonsRouter.createCaller(ctxFor(tenantA));
      await settle(caller.delete(tenantB.personId));

      const after = await readPersonRaw(tenantB.personId);
      expect(after).toBeTruthy();
      expect(after?.first_name).toBe(tenantB.personFirstName);
    });
  });

  describe('session binding', () => {
    it("rejects a valid session token replayed against another tenant's id", async () => {
      // The classic forged-context attack: real credentials, swapped tenant_id. The session
      // lookup in `isAuthed` is itself tenant-scoped, so this must fail authentication rather
      // than silently granting access to tenant B.
      const forged = {
        auth: { tenant_id: tenantB.tenantId, user_id: tenantA.userId, session_id: tenantA.sessionToken },
      };
      const caller = PersonsRouter.createCaller(forged);
      const result = await settle(caller.getById(tenantB.personId));

      expect(result.ok).toBe(false);
    });
  });

  // ── Donations ──────────────────────────────────────────────────────────────────
  // Worst-case leak: gift amounts, donor identities and pledge commitments — money data under a
  // named donor, plus a legal contribution-limit surface.
  describe('donations router', () => {
    it('lets tenant A read its OWN donation, so the denials below are meaningful', async () => {
      const caller = DonationsRouter.createCaller(ctxFor(tenantA));
      const result = await settle(caller.getDonation(tenantA.donationId));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeTruthy();
        expect(payloadContains(result.value, tenantA.donationDonorName)).toBe(true);
      }
    });

    it("never returns another tenant's donation by direct id", async () => {
      const caller = DonationsRouter.createCaller(ctxFor(tenantA));
      const result = await settle(caller.getDonation(tenantB.donationId));

      if (result.ok) {
        expect(payloadContains(result.value, tenantB.donationDonorName)).toBe(false);
        expect(payloadContains(result.value, tenantB.donationId)).toBe(false);
      }
    });

    it("never includes another tenant's donations in the ledger list", async () => {
      const caller = DonationsRouter.createCaller(ctxFor(tenantA));
      const result = await settle(caller.getAll({}));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(rowsOf(result.value).map((r) => String(r.id))).not.toContain(tenantB.donationId);
        expect(payloadContains(result.value, tenantB.donationDonorName)).toBe(false);
      }
    });

    it("never returns another tenant's donations via a person-history read", async () => {
      const caller = DonationsRouter.createCaller(ctxFor(tenantA));
      // B's person id, queried by A: scoping is on tenant, so B's own person must return nothing.
      const result = await settle(caller.getPersonDonationHistory(tenantB.personId));

      if (result.ok) {
        expect(rowsOf(result.value).map((r) => String(r.id))).not.toContain(tenantB.donationId);
        expect(payloadContains(result.value, tenantB.donationDonorName)).toBe(false);
      }
    });

    it("never includes another tenant's pledges in the pledge list", async () => {
      const caller = DonationsRouter.createCaller(ctxFor(tenantA));
      const result = await settle(caller.listPledges());

      if (result.ok) {
        expect(rowsOf(result.value).map((r) => String(r.id))).not.toContain(tenantB.pledgeId);
      }
    });

    it("never cancels another tenant's pledge", async () => {
      const caller = DonationsRouter.createCaller(ctxFor(tenantA));
      await settle(caller.cancelPledge({ pledgeId: tenantB.pledgeId }));

      // Whether the call threw or silently no-op'd, B's pledge must still be active and uncancelled.
      const after = await readPledgeRaw(tenantB.pledgeId);
      expect(after?.status).toBe('active');
      expect(after?.cancelled_at ?? null).toBeNull();
    });
  });

  // ── Emails (shared inbox) ────────────────────────────────────────────────────────
  // Worst-case leak: private message subjects, body content, and attachment names from another
  // workspace's mailbox.
  describe('emails router', () => {
    it('lets tenant A read its OWN email header, so the denials below are meaningful', async () => {
      const caller = EmailsRouter.createCaller(ctxFor(tenantA));
      const result = await settle(caller.getEmailHeader(tenantA.emailId));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(payloadContains(result.value, tenantA.emailSubject)).toBe(true);
      }
    });

    it("never returns another tenant's email header by direct id", async () => {
      const caller = EmailsRouter.createCaller(ctxFor(tenantA));
      const result = await settle(caller.getEmailHeader(tenantB.emailId));

      if (result.ok) {
        expect(payloadContains(result.value, tenantB.emailSubject)).toBe(false);
        expect(payloadContains(result.value, tenantB.emailId)).toBe(false);
      }
    });

    it("never returns another tenant's email body content", async () => {
      const caller = EmailsRouter.createCaller(ctxFor(tenantA));
      const result = await settle(caller.getEmailBody(tenantB.emailId));

      if (result.ok) {
        expect(payloadContains(result.value, tenantB.emailBodyMarker)).toBe(false);
      }
    });

    it("never includes another tenant's emails in a folder list read", async () => {
      const caller = EmailsRouter.createCaller(ctxFor(tenantA));
      // Inbox folder ('11'), scoped to A's own campaign — B's message must never appear here.
      const result = await settle(caller.getEmails({ campaignId: tenantA.campaignId, folderId: '11' }));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(rowsOf(result.value).map((r) => String(r.id))).not.toContain(tenantB.emailId);
        expect(payloadContains(result.value, tenantB.emailSubject)).toBe(false);
      }
    });

    it("never returns another tenant's attachment metadata", async () => {
      const caller = EmailsRouter.createCaller(ctxFor(tenantA));
      const result = await settle(caller.getAttachmentsByEmailId(tenantB.emailId));

      if (result.ok) {
        expect(payloadContains(result.value, tenantB.attachmentFilename)).toBe(false);
      }
    });

    it("never mutates another tenant's email", async () => {
      const caller = EmailsRouter.createCaller(ctxFor(tenantA));
      await settle(caller.setStatus({ id: tenantB.emailId, status: 'closed' }));

      // B's message must keep its original open status and never be soft-deleted by A's call.
      const after = await readEmailRaw(tenantB.emailId);
      expect(after?.status).toBe('open');
      expect(after?.deleted_at ?? null).toBeNull();
      expect(after?.subject).toBe(tenantB.emailSubject);
    });
  });

  // ── Files ──────────────────────────────────────────────────────────────────────
  // Worst-case leak: a blob storage key from another tenant — the pointer that the download route
  // would dereference into raw file bytes (pplcrm-tenant-safety, blob-storage blind spot).
  describe('files router', () => {
    it('lets tenant A see its OWN file in the list, so the denials below are meaningful', async () => {
      const caller = FilesRouter.createCaller(ctxFor(tenantA));
      const result = await settle(caller.getAll());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(rowsOf(result.value).map((r) => String(r.id))).toContain(tenantA.fileId);
      }
    });

    it("never includes another tenant's file (nor its storage key) in the list", async () => {
      const caller = FilesRouter.createCaller(ctxFor(tenantA));
      const result = await settle(caller.getAll());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(rowsOf(result.value).map((r) => String(r.id))).not.toContain(tenantB.fileId);
        expect(payloadContains(result.value, tenantB.fileStorageKey)).toBe(false);
        expect(payloadContains(result.value, tenantB.fileFilename)).toBe(false);
      }
    });

    it("never exposes another tenant's file through the usage summary", async () => {
      const caller = FilesRouter.createCaller(ctxFor(tenantA));
      const result = await settle(caller.getUsageSummary());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(payloadContains(result.value, tenantB.fileStorageKey)).toBe(false);
        expect(payloadContains(result.value, tenantB.fileFilename)).toBe(false);
      }
    });

    it("never deletes another tenant's file", async () => {
      const caller = FilesRouter.createCaller(ctxFor(tenantA));
      await settle(caller.delete(tenantB.fileId));

      // B's file row and its storage key must be untouched (deleting the row would also orphan the blob).
      const after = await readFileRaw(tenantB.fileId);
      expect(after).toBeTruthy();
      expect(after?.storage_key).toBe(tenantB.fileStorageKey);
      expect(after?.filename).toBe(tenantB.fileFilename);
    });
  });

  // ── Exports ──────────────────────────────────────────────────────────────────────
  // Worst-case leak: another tenant's exported CSV of their whole dataset, or the storage key that
  // the download route turns into that file.
  describe('exports router', () => {
    it('lets tenant A see its OWN export in the list, so the denials below are meaningful', async () => {
      const caller = ExportsRouter.createCaller(ctxFor(tenantA));
      const result = await settle(caller.list());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(rowsOf(result.value).map((r) => String(r.id))).toContain(tenantA.exportId);
      }
    });

    it("never includes another tenant's export (nor its storage key) in the list", async () => {
      const caller = ExportsRouter.createCaller(ctxFor(tenantA));
      const result = await settle(caller.list());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(rowsOf(result.value).map((r) => String(r.id))).not.toContain(tenantB.exportId);
        expect(payloadContains(result.value, tenantB.exportStorageKey)).toBe(false);
        expect(payloadContains(result.value, tenantB.exportFileName)).toBe(false);
      }
    });

    it("never deletes another tenant's export", async () => {
      const caller = ExportsRouter.createCaller(ctxFor(tenantA));
      await settle(caller.delete({ id: tenantB.exportId }));

      // B's export row must survive intact — deleting it would also drop the underlying blob.
      const after = await readExportRaw(tenantB.exportId);
      expect(after).toBeTruthy();
      expect(after?.status).toBe('completed');
      expect(after?.file_name).toBe(tenantB.exportFileName);
    });
  });
});
