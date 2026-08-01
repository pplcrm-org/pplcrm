import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseRepository } from '../../lib/base.repo';
import { StorageService } from '../../lib/storage.service';
import { EmailRepo } from '../emails/repositories/email.repo';
import { SPECIAL_FOLDERS } from '../../../../../../libs/common/src';

// `graphGet` receives the URL that was passed to `client.api(...)`, so a test can answer
// per-folder. Tests that do not care keep using `mockResolvedValue`, which ignores the argument.
const graphGet = vi.fn();
const graphApi = vi.fn((url: string) => ({ get: () => graphGet(url) }));

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
  const SENT = '3';
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

  async function seedEmail(
    providerId: string,
    ageHours: number,
    crmState: { assigned_to?: string | null; status?: string; is_favourite?: boolean; folder_id?: string } = {},
  ) {
    const created = await db
      .insertInto('emails')
      .values({
        tenant_id: tenantId,
        campaign_id: campaignId,
        folder_id: crmState.folder_id ?? INBOX,
        from_email: 'sender@example.com',
        to_email: `user-${userId}@example.com`,
        subject: `Message ${providerId}`,
        preview: `ms:${providerId}`,
        assigned_to: crmState.assigned_to ?? null,
        is_favourite: crmState.is_favourite ?? false,
        status: crmState.status ?? 'open',
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

  async function seedComment(emailId: string, text: string) {
    await db
      .insertInto('email_comments')
      .values({
        tenant_id: tenantId,
        email_id: emailId,
        author_id: userId,
        comment: text,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
  }

  /** The stored row for a provider id, or undefined if it was destroyed. */
  const rowFor = async (providerId: string) =>
    await db
      .selectFrom('emails')
      .select(['id', 'detached_at', 'assigned_to', 'status', 'is_favourite'])
      .where('tenant_id', '=', tenantId)
      .where('preview', '=', `ms:${providerId}`)
      .executeTakeFirst();

  const survives = async (providerId: string) => !!(await rowFor(providerId));

  const isDetached = async (providerId: string) => {
    const row = await rowFor(providerId);
    return !!row && row.detached_at !== null;
  };

  const commentsOn = async (emailId: string) => {
    const rows = await db
      .selectFrom('email_comments')
      .select('comment')
      .where('tenant_id', '=', tenantId)
      .where('email_id', '=', emailId)
      .execute();
    return rows.map((r: { comment: string }) => r.comment);
  };

  /** One Graph message payload, shaped the way the delta endpoint returns it. */
  const graphMessage = (id: string, internetMessageId: string) => ({
    id,
    subject: 'Round trip',
    from: { emailAddress: { address: 'sender@example.com' } },
    toRecipients: [{ emailAddress: { address: `user-${userId}@example.com` } }],
    body: { content: '<p>hello</p>' },
    receivedDateTime: new Date().toISOString(),
    internetMessageId,
  });

  /** Answer `messages` for one folder's delta only; every other folder comes back empty. */
  function respondForFolder(wellKnownName: string, messages: unknown[]) {
    graphGet.mockImplementation(async (url: string) => ({
      value: String(url).includes(`/mailFolders/${wellKnownName}/`) ? messages : [],
      '@odata.deltaLink': 'https://graph/delta-next',
    }));
  }

  const respondForInbox = (messages: unknown[]) => respondForFolder('inbox', messages);

  /**
   * Delta links for all four folders, so no folder takes the initial-sync path (and no folder runs
   * the reconciliation sweep). The URLs keep the real `/mailFolders/<name>/` shape because
   * `respondForInbox` decides what to return by matching on it.
   */
  const storedDelta = (wellKnownName: string) =>
    `https://graph.microsoft.com/v1.0/me/mailFolders/${wellKnownName}/messages/delta?$deltatoken=stored`;

  const storedDeltaMap = () =>
    JSON.stringify({
      inbox: storedDelta('inbox'),
      sentitems: storedDelta('sentitems'),
      deleteditems: storedDelta('deleteditems'),
      junkemail: storedDelta('junkemail'),
    });

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
    for (const table of ['email_comments', 'email_recipients', 'email_attachments', 'email_headers', 'email_bodies']) {
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

  it('does not touch mail older than the window when the delta link is cleared', async () => {
    await seedEmail('OLD_MESSAGE', 24 * 30); // a month old
    await seedEmail('RECENT_MESSAGE', 1); // inside the window

    const service = new MsSyncService(db, makeOAuthStub(JSON.stringify({ _needs_full_sync: true })) as any);

    await service.syncTenant(tenantId, campaignId, userId);

    // Outside the fetched window, so the sweep has no opinion about it at all.
    expect(await isDetached('OLD_MESSAGE')).toBe(false);
    // Inside the window and not returned by the server: detached (hidden), never destroyed.
    expect(await survives('RECENT_MESSAGE')).toBe(true);
    expect(await isDetached('RECENT_MESSAGE')).toBe(true);
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

  // A folder-scoped Graph delta marks a message `@removed` when it LEAVES the folder — archived,
  // dragged elsewhere, filed by a rule — not only when it is deleted. This used to hard-delete the
  // CRM's copy and every child row with it, so archiving a message in Outlook destroyed the
  // internal comments the team had written on it, who it was assigned to, and its triage status.
  describe('a message that leaves the folder upstream', () => {
    it('keeps the row and everything the CRM added to it', async () => {
      const emailId = await seedEmail('ARCHIVED', 2, {
        assigned_to: userId,
        status: 'closed',
        is_favourite: true,
      });
      await seedComment(emailId, 'Chased this with the volunteer coordinator');

      respondForInbox([{ id: 'ARCHIVED', '@removed': { reason: 'deleted' } }]);
      const service = new MsSyncService(db, makeOAuthStub(storedDeltaMap()) as any);

      await service.syncTenant(tenantId, campaignId, userId);

      const row = await rowFor('ARCHIVED');
      expect(row).toBeTruthy();
      expect(row?.detached_at).not.toBeNull();
      expect(String(row?.assigned_to)).toBe(userId);
      expect(row?.status).toBe('closed');
      expect(row?.is_favourite).toBe(true);
      expect(await commentsOn(emailId)).toEqual(['Chased this with the volunteer coordinator']);
    });

    it('stops appearing in the Inbox listing but is still reachable by id', async () => {
      const emailId = await seedEmail('ARCHIVED', 2);

      const repo = new EmailRepo();
      const before = await repo.getByFolderWithAttachmentFlag(userId, tenantId, campaignId, INBOX);
      expect(before.map((e: { id: string }) => String(e.id))).toContain(emailId);

      respondForInbox([{ id: 'ARCHIVED', '@removed': { reason: 'deleted' } }]);
      const service = new MsSyncService(db, makeOAuthStub(storedDeltaMap()) as any);
      await service.syncTenant(tenantId, campaignId, userId);

      const after = await repo.getByFolderWithAttachmentFlag(userId, tenantId, campaignId, INBOX);
      expect(after.map((e: { id: string }) => String(e.id))).not.toContain(emailId);

      // A link from a notification, a mention or an activity entry still opens it, so the
      // comments on it are not orphaned somewhere no one can reach.
      expect(await repo.getEmailWithHeadersAndRecipients(tenantId, emailId)).toBeTruthy();
    });

    it('stays on the assignee’s worklist, because someone in the CRM put it there', async () => {
      await seedEmail('ARCHIVED', 2, { assigned_to: userId, status: 'open' });

      respondForInbox([{ id: 'ARCHIVED', '@removed': { reason: 'deleted' } }]);
      const service = new MsSyncService(db, makeOAuthStub(storedDeltaMap()) as any);
      await service.syncTenant(tenantId, campaignId, userId);

      const repo = new EmailRepo();
      const assigned = await repo.getByFolderWithAttachmentFlag(
        userId,
        tenantId,
        campaignId,
        SPECIAL_FOLDERS.ASSIGNED_TO_ME,
      );
      expect(assigned.length).toBe(1);

      // …but the Inbox badge (unread count) no longer counts it.
      const counts = await repo.getEmailCountsByFolder(userId, tenantId, campaignId);
      expect(counts[INBOX]).toBe(0);
    });

    it('stops being counted in that folder’s badge', async () => {
      // The Inbox badge is an unread count; every other real folder's badge is the plain per-folder
      // row count, which is a separate query and needs its own guard.
      await seedEmail('ARCHIVED_SENT', 2, { folder_id: SENT });

      const repo = new EmailRepo();
      const before = await repo.getEmailCountsByFolder(userId, tenantId, campaignId);
      expect(before[SENT]).toBe(1);

      respondForFolder('sentitems', [{ id: 'ARCHIVED_SENT', '@removed': { reason: 'deleted' } }]);
      const service = new MsSyncService(db, makeOAuthStub(storedDeltaMap()) as any);
      await service.syncTenant(tenantId, campaignId, userId);

      const after = await repo.getEmailCountsByFolder(userId, tenantId, campaignId);
      expect(after[SENT] ?? 0).toBe(0);
    });

    it('re-attaches the original row when the message comes back, under a new provider id', async () => {
      // Moving a message out of the Inbox and back in is ordinary. Graph issues a NEW message id on
      // the way back, so only the stable Message-ID header can recognise it as the same item —
      // without that, the round trip would leave a hidden row behind and insert a duplicate.
      const imid = '<round-trip@example.com>';
      const emailId = await seedEmail('ORIGINAL', 2);
      await db
        .updateTable('email_headers')
        .set({ raw_headers: `Message-ID: ${imid}\r\n` })
        .where('tenant_id', '=', tenantId)
        .where('email_id', '=', emailId)
        .execute();
      await seedComment(emailId, 'Reply drafted, waiting on the candidate');

      respondForInbox([{ id: 'ORIGINAL', '@removed': { reason: 'deleted' } }]);
      await new MsSyncService(db, makeOAuthStub(storedDeltaMap()) as any).syncTenant(tenantId, campaignId, userId);
      expect(await isDetached('ORIGINAL')).toBe(true);

      respondForInbox([graphMessage('MOVED_BACK', imid)]);
      await new MsSyncService(db, makeOAuthStub(storedDeltaMap()) as any).syncTenant(tenantId, campaignId, userId);

      const inboxRows = await db
        .selectFrom('emails')
        .select(['id', 'detached_at', 'preview'])
        .where('tenant_id', '=', tenantId)
        .where('folder_id', '=', INBOX)
        .execute();

      expect(inboxRows.length).toBe(1); // re-attached, not duplicated
      expect(String(inboxRows[0].id)).toBe(emailId); // the SAME row, so the comment came back with it
      expect(inboxRows[0].detached_at).toBeNull();
      expect(inboxRows[0].preview).toBe('ms:MOVED_BACK');
      expect(await commentsOn(emailId)).toEqual(['Reply drafted, waiting on the candidate']);
    });

    it('re-attaches when the message comes back under the same provider id', async () => {
      const emailId = await seedEmail('SAME_ID', 2);
      await seedComment(emailId, 'Ask the treasurer about this');

      respondForInbox([{ id: 'SAME_ID', '@removed': { reason: 'deleted' } }]);
      await new MsSyncService(db, makeOAuthStub(storedDeltaMap()) as any).syncTenant(tenantId, campaignId, userId);
      expect(await isDetached('SAME_ID')).toBe(true);

      respondForInbox([graphMessage('SAME_ID', '<same-id@example.com>')]);
      await new MsSyncService(db, makeOAuthStub(storedDeltaMap()) as any).syncTenant(tenantId, campaignId, userId);

      expect(await isDetached('SAME_ID')).toBe(false);
      expect(await commentsOn(emailId)).toEqual(['Ask the treasurer about this']);
    });
  });

  it('checkpoints after each folder rather than only at the end', async () => {
    const service = new MsSyncService(db, makeOAuthStub(null) as any);

    await service.syncTenant(tenantId, campaignId, userId);

    expect(savedDeltaLinks.length).toBe(4);
    expect(Object.keys(JSON.parse(savedDeltaLinks[0]))).toEqual(['inbox']);
  });
});
