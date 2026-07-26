import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseRepository } from '../../lib/base.repo';
import { StorageService } from '../../lib/storage.service';

const graphGet = vi.fn();
const graphApi = vi.fn(() => ({ get: graphGet }));

vi.mock('@microsoft/microsoft-graph-client', () => ({
  Client: { init: () => ({ api: graphApi }) },
}));

const { MsSyncService } = await import('./ms-sync.service');

// The Graph adapter carries the same two invariants as the Gmail one, and the same consequence for
// getting them wrong: an initial sync must be bounded to 48 hours, and the deletion sweep must only
// judge mail inside the window it actually fetched. An expired delta link forces the sweep path on
// an established mailbox, so an unscoped sweep here destroys history without anyone pressing
// anything.
describe('MsSyncService initial window (integration)', () => {
  const db = (BaseRepository as any)._db;
  const rand = () => String(Math.floor(Math.random() * 100000000) + 10000000);

  const INBOX = '11';
  const HOUR_MS = 60 * 60 * 1000;

  let tenantId: string;
  let userId: string;
  let campaignId: string;
  let savedDeltaLinks: string[];

  function makeOAuthStub(deltaLink: string | null) {
    return {
      getValidToken: async () => 'test-token',
      getDeltaLink: async () => deltaLink,
      saveDeltaLink: async (_t: string, _c: string, value: string) => {
        savedDeltaLinks.push(value);
      },
    };
  }

  /** Every URL the service asked Graph for, in order. */
  const requestedUrls = () => graphApi.mock.calls.map((c) => String(c[0]));

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
        preview: `ms:${providerId}`,
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
  }

  const survives = async (providerId: string) =>
    !!(await db
      .selectFrom('emails')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('preview', '=', `ms:${providerId}`)
      .executeTakeFirst());

  beforeEach(async () => {
    tenantId = rand();
    userId = rand();
    campaignId = rand();
    savedDeltaLinks = [];

    graphApi.mockClear();
    // Empty folders: the state in which a badly-scoped sweep concludes the mailbox was emptied.
    graphGet.mockReset();
    graphGet.mockResolvedValue({ value: [], '@odata.deltaLink': 'https://graph/delta-next' });

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
    const service = new MsSyncService(db, makeOAuthStub(null) as any);

    await service.syncTenant(tenantId, campaignId, userId);

    const inboxUrl = requestedUrls().find((u) => u.includes('/mailFolders/inbox/')) ?? '';
    const iso = /receivedDateTime ge ([^&]+)/.exec(inboxUrl)?.[1];
    expect(iso).toBeTruthy();

    const hoursBack = (Date.now() - new Date(String(iso)).getTime()) / HOUR_MS;
    expect(hoursBack).toBeGreaterThan(47.5);
    expect(hoursBack).toBeLessThan(48.5);
  });

  it('bounds every initial folder request, so none is unfiltered', async () => {
    const service = new MsSyncService(db, makeOAuthStub(null) as any);

    await service.syncTenant(tenantId, campaignId, userId);

    const deltaUrls = requestedUrls().filter((u) => u.includes('/messages/delta'));
    expect(deltaUrls.length).toBe(4); // inbox, sentitems, deleteditems, junkemail
    for (const url of deltaUrls) {
      expect(url).toContain('receivedDateTime ge ');
    }
  });

  it('resumes from the stored delta link instead of rebuilding a windowed URL', async () => {
    const stored = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=abc';
    const service = new MsSyncService(db, makeOAuthStub(JSON.stringify({ inbox: stored })) as any);

    await service.syncTenant(tenantId, campaignId, userId);

    expect(requestedUrls()).toContain(stored);
  });

  it('restarts bounded after a 410 Gone, not unfiltered', async () => {
    // An expired delta link must not become a back door to enumerating the whole mailbox.
    let firstCall = true;
    graphGet.mockImplementation(async () => {
      if (firstCall) {
        firstCall = false;
        const err: any = new Error('Gone');
        err.statusCode = 410;
        throw err;
      }
      return { value: [], '@odata.deltaLink': 'https://graph/delta-next' };
    });

    const stored = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=expired';
    const service = new MsSyncService(db, makeOAuthStub(JSON.stringify({ inbox: stored })) as any);

    await service.syncTenant(tenantId, campaignId, userId);

    const retryUrl = requestedUrls().find((u, i) => i > 0 && u.includes('/mailFolders/inbox/messages/delta'));
    expect(retryUrl).toContain('receivedDateTime ge ');
  });

  it('does not delete mail older than the window when the delta link is cleared', async () => {
    await seedEmail('OLD_MESSAGE', 24 * 30); // a month old
    await seedEmail('RECENT_MESSAGE', 1); // inside the window

    const service = new MsSyncService(db, makeOAuthStub(JSON.stringify({ _needs_full_sync: true })) as any);

    await service.syncTenant(tenantId, campaignId, userId);

    expect(await survives('OLD_MESSAGE')).toBe(true);
    expect(await survives('RECENT_MESSAGE')).toBe(false);
  });

  it('skips messages older than the window even if Graph ignores the filter', async () => {
    // Graph's $filter support on delta is narrow, so the page loop re-checks each message. If that
    // check regresses, an unfiltered response would ingest the entire mailbox.
    graphGet.mockResolvedValue({
      value: [
        {
          id: 'ANCIENT',
          subject: 'Old news',
          from: { emailAddress: { address: 'sender@example.com' } },
          toRecipients: [],
          body: { content: '<p>old</p>' },
          receivedDateTime: new Date(Date.now() - 24 * 30 * HOUR_MS).toISOString(),
          internetMessageId: '<ancient@example.com>',
        },
      ],
      '@odata.deltaLink': 'https://graph/delta-next',
    });

    const service = new MsSyncService(db, makeOAuthStub(null) as any);
    const result = await service.syncTenant(tenantId, campaignId, userId);

    expect(result.inserted).toBe(0);
    expect(await survives('ANCIENT')).toBe(false);
  });

  it('checkpoints after each folder rather than only at the end', async () => {
    const service = new MsSyncService(db, makeOAuthStub(null) as any);

    await service.syncTenant(tenantId, campaignId, userId);

    expect(savedDeltaLinks.length).toBe(4);
    expect(Object.keys(JSON.parse(savedDeltaLinks[0]))).toEqual(['inbox']);
  });
});
