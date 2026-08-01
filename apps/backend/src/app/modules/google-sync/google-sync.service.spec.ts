import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseRepository } from '../../lib/base.repo';
import { StorageService } from '../../lib/storage.service';
import { GoogleSyncService } from './google-sync.service';

// The initial-sync window and the deletion sweep are coupled, and getting the coupling wrong
// destroys data: the sweep deletes local mail the server did not return, so if it runs over the
// whole archive while the fetch only covers 48 hours, everything older is treated as deleted.
// "Re-sync recent mail" clears the watermark, which is exactly the state these tests cover.
describe('GoogleSyncService initial window (integration)', () => {
  const db = (BaseRepository as any)._db;
  const rand = () => String(Math.floor(Math.random() * 100000000) + 10000000);

  const INBOX = '11';
  const HOUR_MS = 60 * 60 * 1000;

  let tenantId: string;
  let userId: string;
  let campaignId: string;
  let service: GoogleSyncService;
  let savedDeltaLinks: string[];
  let issuedQueries: string[];

  /** Minimal stand-in for GoogleOAuthService: only what syncTenant actually calls. */
  function makeOAuthStub(deltaLink: string | null) {
    return {
      getValidToken: async () => 'test-token',
      getDeltaLink: async () => deltaLink,
      saveDeltaLink: async (_t: string, _c: string, value: string) => {
        savedDeltaLinks.push(value);
      },
    };
  }

  /**
   * Stand in for the Gmail REST API. Records the `q` of every list call and returns no messages,
   * which is the state that makes the sweep dangerous: the server says "nothing here", and a
   * badly-scoped sweep concludes the entire mailbox was deleted.
   */
  function stubGmail(messageIds: string[] = []) {
    issuedQueries = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const parsed = new URL(String(url));
        if (parsed.pathname.endsWith('/messages')) {
          issuedQueries.push(parsed.searchParams.get('q') ?? '');
          return {
            ok: true,
            status: 200,
            json: async () => ({ messages: messageIds.map((id) => ({ id })) }),
          };
        }
        return { ok: false, status: 404, text: async () => 'not found' };
      }),
    );
  }

  async function seedEmail(providerId: string, ageHours: number) {
    const created = await db
      .insertInto('emails')
      .values({
        tenant_id: tenantId,
        campaign_id: campaignId,
        folder_id: INBOX,
        from_email: 'sender@example.com',
        to_email: `user-${userId}@example.com`,
        subject: `Message ${providerId}`,
        preview: `google:${providerId}`,
        assigned_to: null,
        is_favourite: false,
        status: 'open',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await db
      .insertInto('email_headers')
      .values({
        tenant_id: tenantId,
        email_id: String(created.id),
        headers_json: JSON.stringify({ internetMessageId: `<${providerId}@example.com>` }),
        raw_headers: `Message-ID: <${providerId}@example.com>\r\n`,
        date_sent: new Date(Date.now() - ageHours * HOUR_MS),
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();

    return String(created.id);
  }

  const rowFor = async (providerId: string) =>
    await db
      .selectFrom('emails')
      .select(['id', 'detached_at'])
      .where('tenant_id', '=', tenantId)
      .where('preview', '=', `google:${providerId}`)
      .executeTakeFirst();

  const survives = async (providerId: string) => !!(await rowFor(providerId));

  const isDetached = async (providerId: string) => {
    const row = await rowFor(providerId);
    return !!row && row.detached_at !== null;
  };

  beforeEach(async () => {
    tenantId = rand();
    userId = rand();
    campaignId = rand();
    savedDeltaLinks = [];

    vi.spyOn(StorageService.prototype, 'upload').mockResolvedValue(undefined);
    vi.spyOn(StorageService.prototype, 'delete').mockResolvedValue(undefined);

    await db.insertInto('tenants').values({ id: tenantId, name: 'Test Tenant' }).execute();
    await db
      .insertInto('authusers')
      .values({
        id: userId,
        tenant_id: tenantId,
        email: `user-${userId}@example.com`,
        password: 'password',
        first_name: 'Test',
        last_name: 'User',
        verified: true,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
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
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const table of ['email_recipients', 'email_attachments', 'email_headers', 'email_bodies']) {
      await db.deleteFrom(table).where('tenant_id', '=', tenantId).execute();
    }
    await db.deleteFrom('emails').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  it('bounds a first sync to the last 48 hours', async () => {
    stubGmail();
    service = new GoogleSyncService(db, makeOAuthStub(null) as any);

    await service.syncTenant(tenantId, campaignId, userId);

    const inboxQuery = issuedQueries.find((q) => q.startsWith('label:INBOX')) ?? '';
    const after = Number(/after:(\d+)/.exec(inboxQuery)?.[1]);
    expect(after).toBeGreaterThan(0);

    const hoursBack = (Date.now() / 1000 - after) / 3600;
    expect(hoursBack).toBeGreaterThan(47.5);
    expect(hoursBack).toBeLessThan(48.5);
  });

  it('always carries an after: clause, so no query is unbounded', async () => {
    stubGmail();
    service = new GoogleSyncService(db, makeOAuthStub(null) as any);

    await service.syncTenant(tenantId, campaignId, userId);

    expect(issuedQueries.length).toBeGreaterThan(0);
    for (const q of issuedQueries) {
      expect(q).toMatch(/after:\d+/);
    }
  });

  it('resumes from the stored watermark on an incremental sync', async () => {
    const watermark = Math.floor(Date.now() / 1000) - 600; // ten minutes ago
    stubGmail();
    service = new GoogleSyncService(db, makeOAuthStub(JSON.stringify({ INBOX: watermark })) as any);

    await service.syncTenant(tenantId, campaignId, userId);

    const inboxQuery = issuedQueries.find((q) => q.startsWith('label:INBOX')) ?? '';
    // The watermark minus the 60s overlap buffer, not the 48h window.
    expect(inboxQuery).toContain(`after:${watermark - 60}`);
  });

  it('does not touch mail older than the window when the watermark is cleared', async () => {
    // The regression this guards: pressing "Re-sync recent mail" on an established mailbox.
    await seedEmail('OLD_MESSAGE', 24 * 30); // a month old
    await seedEmail('RECENT_MESSAGE', 1); // within the window

    stubGmail([]); // server returns nothing for the window
    service = new GoogleSyncService(db, makeOAuthStub(JSON.stringify({ _needs_full_sync: true })) as any);

    await service.syncTenant(tenantId, campaignId, userId);

    // Outside the fetched window, so the sweep has no opinion about it at all.
    expect(await survives('OLD_MESSAGE')).toBe(true);
    expect(await isDetached('OLD_MESSAGE')).toBe(false);
    // Inside the window and absent from the server's response: reconciled away by DETACHING it —
    // hidden from the folder, row and everything the CRM added to it kept. This comparison also
    // trusts a sender-supplied `Date:` header, so it can be wrong; destroying on it was unsafe.
    expect(await survives('RECENT_MESSAGE')).toBe(true);
    expect(await isDetached('RECENT_MESSAGE')).toBe(true);
  });

  it('checkpoints after each folder rather than only at the end', async () => {
    stubGmail();
    service = new GoogleSyncService(db, makeOAuthStub(null) as any);

    await service.syncTenant(tenantId, campaignId, userId);

    // One save per synced folder (Inbox, Sent, Trash, Spam), so a late failure cannot discard
    // the progress of the folders that already succeeded.
    expect(savedDeltaLinks.length).toBe(4);
    expect(Object.keys(JSON.parse(savedDeltaLinks[0]))).toEqual(['INBOX']);
  });
});
