import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmailsController } from './controller';
import { BadRequestError, InternalError } from '../../errors/app-errors';
import { BaseRepository } from '../../lib/base.repo';
import { EmailTrashRepo } from './repositories/email-trash.repo';

describe('EmailsController Comments', () => {
  let controller: EmailsController;

  beforeEach(() => {
    controller = new EmailsController();
    vi.restoreAllMocks();
  });

  it('should throw BadRequestError if comment is empty or whitespace', async () => {
    await expect(controller.addComment('tenant-1', 'email-1', 'author-1', '')).rejects.toThrow(BadRequestError);
    await expect(controller.addComment('tenant-1', 'email-1', 'author-1', '   ')).rejects.toThrow(BadRequestError);
  });

  it('should call commentsRepo.add with the correct parameters', async () => {
    const mockCommentRow = {
      id: 'comment-123',
      tenant_id: 'tenant-1',
      email_id: 'email-1',
      author_id: 'author-1',
      comment: 'This is a test comment',
      createdby_id: 'author-1',
      updatedby_id: 'author-1',
    };

    const addSpy = vi.spyOn((controller as any).commentsRepo, 'add').mockResolvedValue(mockCommentRow);

    // role 'owner' short-circuits the campaign-scope check (these fake ids aren't real DB rows)
    const result = await controller.addComment('tenant-1', 'email-1', 'author-1', 'This is a test comment', 'owner');

    expect(addSpy).toHaveBeenCalledWith({
      row: {
        tenant_id: 'tenant-1',
        email_id: 'email-1',
        author_id: 'author-1',
        comment: 'This is a test comment',
        createdby_id: 'author-1',
        updatedby_id: 'author-1',
      },
    });
    expect(result).toEqual(mockCommentRow);
  });

  it('should throw InternalError if commentsRepo.add returns null or undefined', async () => {
    vi.spyOn((controller as any).commentsRepo, 'add').mockResolvedValue(undefined);

    await expect(controller.addComment('tenant-1', 'email-1', 'author-1', 'Some comment', 'owner')).rejects.toThrow(
      InternalError,
    );
  });
});

describe('EmailsController Integration', () => {
  const controller = new EmailsController();
  const db = (BaseRepository as any)._db;
  const rand = () => String(Math.floor(Math.random() * 100000000) + 10000000);
  let tenantId: string;
  let userId: string;
  let campaignId: string;
  let emailId: string;

  beforeEach(async () => {
    tenantId = rand();
    userId = rand();
    campaignId = rand();
    emailId = rand();

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

    // 3. Campaign (emails are campaign-scoped, §15)
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

    // 4. Email (folders are code-defined; folder_id is guarded by a CHECK constraint)
    await db
      .insertInto('emails')
      .values({
        id: emailId,
        tenant_id: tenantId,
        campaign_id: campaignId,
        folder_id: '11',
        from_email: 'sender@example.com',
        to_email: 'recipient@example.com',
        subject: 'Test Email',
        preview: 'Preview',
        is_favourite: false,
        status: 'open',
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
  });

  afterEach(async () => {
    await db.deleteFrom('email_read_states').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('email_trash').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('email_headers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('emails').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('campaigns').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('user_activity').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('notifications').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('profiles').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('authusers').where('tenant_id', '=', tenantId).execute();
    await db.deleteFrom('tenants').where('id', '=', tenantId).execute();
  });

  async function seedAssignee(preferences?: object): Promise<string> {
    const assigneeId = rand();
    await db
      .insertInto('authusers')
      .values({
        id: assigneeId,
        tenant_id: tenantId,
        email: `assignee-${assigneeId}@example.com`,
        password: 'password',
        first_name: 'Vol',
        last_name: 'Unteer',
        verified: true,
        createdby_id: userId,
        updatedby_id: userId,
      })
      .execute();
    if (preferences) {
      await db
        .insertInto('profiles')
        .values({
          id: rand(),
          tenant_id: tenantId,
          auth_id: assigneeId,
          preferences: JSON.stringify(preferences),
          createdby_id: userId,
          updatedby_id: userId,
        })
        .execute();
    }
    return assigneeId;
  }

  it('assigning an email notifies the assignee in-app and by email', async () => {
    const assigneeId = await seedAssignee();
    const sendSpy = vi.spyOn((controller as any).mailService, 'sendMail').mockResolvedValue(undefined);

    await controller.assignEmail(tenantId, emailId, assigneeId, userId, 'Vol Unteer');

    const bell = await db
      .selectFrom('notifications')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('user_id', '=', assigneeId)
      .execute();
    expect(bell).toHaveLength(1);
    expect(bell[0]?.message).toContain('Test Email');
    expect(bell[0]?.link).toBe(`/inbox?email=${emailId}`);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const mail = sendSpy.mock.calls[0][0] as { to: string; subject: string };
    expect(mail.to).toBe(`assignee-${assigneeId}@example.com`);
    expect(mail.subject).toContain('Test Email');
    sendSpy.mockRestore();
  });

  it('stays silent on self-assignment and honors turned-off preferences', async () => {
    const sendSpy = vi.spyOn((controller as any).mailService, 'sendMail').mockResolvedValue(undefined);

    // Self-assignment: no bell, no email.
    await controller.assignEmail(tenantId, emailId, userId, userId, 'Test User');
    const selfBell = await db
      .selectFrom('notifications')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('user_id', '=', userId)
      .execute();
    expect(selfBell).toHaveLength(0);
    expect(sendSpy).not.toHaveBeenCalled();

    // Email preference off, in-app on: bell only.
    const assigneeId = await seedAssignee({ notifications: { email_assigned: false } });
    await controller.assignEmail(tenantId, emailId, assigneeId, userId, 'Vol Unteer');
    const bell = await db
      .selectFrom('notifications')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('user_id', '=', assigneeId)
      .execute();
    expect(bell).toHaveLength(1);
    expect(sendSpy).not.toHaveBeenCalled();
    sendSpy.mockRestore();
  });

  it('should successfully toggle email read status', async () => {
    // 1. Read count by folder before setting read status (should be 1 because ers row doesn't exist, and is_read coalesces to false, i.e., unread)
    const countsBefore = await controller.getRepo().getEmailCountsByFolder(userId, tenantId, campaignId);
    expect(countsBefore['11']).toBe(1);

    // 2. Set read status to true (read)
    const resRead = await controller.setEmailReadStatus(tenantId, userId, emailId, true);
    expect(resRead).toEqual({ success: true, email_id: emailId, is_read: true });

    // 3. Unread count in Inbox should now be 0
    const countsAfterRead = await controller.getRepo().getEmailCountsByFolder(userId, tenantId, campaignId);
    expect(countsAfterRead['11']).toBe(0);

    // 4. Get emails by folder and verify is_read is true
    const emailsAfterRead = await controller
      .getRepo()
      .getByFolderWithAttachmentFlag(userId, tenantId, campaignId, '11');
    expect(emailsAfterRead[0].is_read).toBe(true);

    // 5. Set read status to false (unread)
    const resUnread = await controller.setEmailReadStatus(tenantId, userId, emailId, false);
    expect(resUnread).toEqual({ success: true, email_id: emailId, is_read: false });

    // 6. Unread count in Inbox should be back to 1
    const countsAfterUnread = await controller.getRepo().getEmailCountsByFolder(userId, tenantId, campaignId);
    expect(countsAfterUnread['11']).toBe(1);

    // 7. Get emails by folder and verify is_read is false
    const emailsAfterUnread = await controller
      .getRepo()
      .getByFolderWithAttachmentFlag(userId, tenantId, campaignId, '11');
    expect(emailsAfterUnread[0].is_read).toBe(false);
  });

  it('should support limit and offset parameters when fetching emails by folder', async () => {
    // Insert 3 additional emails under this tenant
    const emailIds = [rand(), rand(), rand()];
    for (const eid of emailIds) {
      await db
        .insertInto('emails')
        .values({
          id: eid,
          tenant_id: tenantId,
          campaign_id: campaignId,
          folder_id: '11',
          from_email: 'extra@example.com',
          to_email: 'recipient@example.com',
          subject: 'Extra Email',
          preview: 'Preview',
          is_favourite: false,
          status: 'open',
          createdby_id: userId,
          updatedby_id: userId,
        })
        .execute();
    }

    // Total emails in inbox should be 4 (1 seeded in beforeEach + 3 extra)
    const allEmails = await controller.getEmails(userId, tenantId, campaignId, '11');
    expect(allEmails.length).toBe(4);

    // Test Limit: should return only 2 emails
    const limitEmails = await controller.getEmails(userId, tenantId, campaignId, '11', 2);
    expect(limitEmails.length).toBe(2);

    // Test Limit and Offset: should skip the first 2 and return the remaining 2
    const pagedEmails = await controller.getEmails(userId, tenantId, campaignId, '11', 2, 2);
    expect(pagedEmails.length).toBe(2);

    // The items returned by pagination should be disjoint from the first page
    const firstPageIds = limitEmails.map((e: any) => e.id);
    const secondPageIds = pagedEmails.map((e: any) => e.id);
    for (const id of secondPageIds) {
      expect(firstPageIds).not.toContain(id);
    }
  });

  it('pages stably when emails share the same date_sent (id tiebreaker)', async () => {
    // Five more emails whose headers all carry an IDENTICAL date_sent — exactly
    // what a bulk sync produces. The sort key alone is then ambiguous: without a
    // unique tiebreaker Postgres may order ties differently per query, so
    // limit/offset pages can repeat or skip rows.
    const sameInstant = new Date('2026-07-01T12:00:00.000Z');
    const tiedIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const eid = rand();
      tiedIds.push(eid);
      await db
        .insertInto('emails')
        .values({
          id: eid,
          tenant_id: tenantId,
          campaign_id: campaignId,
          folder_id: '11',
          from_email: 'bulk@example.com',
          to_email: 'recipient@example.com',
          subject: `Bulk Email ${i}`,
          preview: 'Preview',
          is_favourite: false,
          status: 'open',
          createdby_id: userId,
          updatedby_id: userId,
        })
        .execute();
      await db
        .insertInto('email_headers')
        .values({
          id: rand(),
          tenant_id: tenantId,
          email_id: eid,
          date_sent: sameInstant,
          createdby_id: userId,
          updatedby_id: userId,
        })
        .execute();
    }

    // Page through two at a time; the concatenated pages must reconstruct the
    // whole folder with no repeats and no gaps.
    const pageSize = 2;
    const collected: string[] = [];
    for (let offset = 0; offset < 20; offset += pageSize) {
      const page = await controller.getEmails(userId, tenantId, campaignId, '11', pageSize, offset);
      collected.push(...page.map((e: any) => String(e.id)));
      if (page.length < pageSize) break;
    }

    expect(collected.length).toBe(6); // 5 tied + the seeded email
    expect(new Set(collected).size).toBe(6); // no duplicates across pages

    // Ties on date_sent resolve by id desc — a total, stable order.
    const tiedInResult = collected.filter((id) => tiedIds.includes(id));
    expect(tiedInResult).toEqual([...tiedIds].sort((a, b) => Number(b) - Number(a)));
  });

  it('should correctly move to trash, delete email_trash records via deleteByEmailIds on restore, and allow deleteMany to delete by primary key', async () => {
    // 1. Move the email to trash.
    const deleted = await controller.deleteMany(tenantId as any, [emailId]);
    expect(deleted).toBe(true);

    // Verify it is in trash folder
    const emailInDb = await controller.getRepo().getOneBy('id', { tenant_id: tenantId as any, value: emailId });
    expect(emailInDb?.folder_id).toBe('5'); // TRASH folder is '5'

    // Verify exactly one row in email_trash
    const trashRepo = new EmailTrashRepo();
    const trashRows = await trashRepo.getAll({ tenant_id: tenantId as any });
    expect(trashRows.length).toBe(1);
    expect(trashRows[0].email_id).toBe(emailId);
    expect(trashRows[0].from_folder_id).toBe('11'); // Original folder

    const _trashRowId = trashRows[0].id; // The primary key (id) of the email_trash record

    // 2. Restore from trash using restoreFromTrash.
    // This internally calls emailTrashRepo.deleteByEmailIds passing emailIds as IDs.
    const restoredCount = await controller.restoreFromTrash(tenantId, [emailId]);
    expect(restoredCount).toBe(1);

    // Verify email is back to original folder '11'
    const restoredEmail = await controller.getRepo().getOneBy('id', { tenant_id: tenantId as any, value: emailId });
    expect(restoredEmail?.folder_id).toBe('11');

    // Verify the email_trash row is deleted
    const trashRowsAfterRestore = await trashRepo.getAll({ tenant_id: tenantId as any });
    expect(trashRowsAfterRestore.length).toBe(0);

    // 3. Test deleteMany now correctly deletes by its own primary key `id` rather than `email_id`.
    // Let's add a record directly to email_trash
    await trashRepo.addFromEmails({
      tenant_id: tenantId,
      emailIds: [emailId],
      folder_id: '5',
    });

    const trashRowsForDeleteMany = await trashRepo.getAll({ tenant_id: tenantId as any });
    expect(trashRowsForDeleteMany.length).toBe(1);
    const primaryKeyId = trashRowsForDeleteMany[0].id;

    // Call deleteMany with an emailId (which was the bug - it shouldn't delete anything since primaryKeyId !== emailId)
    const deletedByWrongId = await trashRepo.deleteMany({ tenant_id: tenantId as any, ids: [emailId as any] });
    expect(deletedByWrongId).toBe(false);

    // The record should still exist!
    const trashRowsAfterWrongId = await trashRepo.getAll({ tenant_id: tenantId as any });
    expect(trashRowsAfterWrongId.length).toBe(1);

    // Call deleteMany with the actual primary key id of the email_trash row
    const deletedByPrimaryKey = await trashRepo.deleteMany({ tenant_id: tenantId as any, ids: [primaryKeyId as any] });
    expect(deletedByPrimaryKey).toBe(true);

    // Now it should be empty!
    const trashRowsAfterPrimaryKey = await trashRepo.getAll({ tenant_id: tenantId as any });
    expect(trashRowsAfterPrimaryKey.length).toBe(0);
  });
});
