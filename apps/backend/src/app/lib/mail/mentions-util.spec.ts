import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationsRepo } from '../../modules/notifications/repositories/notifications.repo';
import { useTestTransaction } from '../test-utils/db-test-isolation';
import { processMentions } from './mentions-util';
import { TransactionalEmailService } from './transactional-mail.service';
import { TransactionalSendBlockedError } from './transactional-send-guard';

const rand = () => String(Math.floor(Math.random() * 100000000) + 1000000);

/**
 * Delivering @mention notifications used to run every recipient under one try/catch around the
 * whole loop. The first failure — a mail provider fault, or the anti-abuse gate refusing to send
 * for this workspace — therefore abandoned everyone mentioned after that person in the same
 * comment, and logged one line about it.
 */
describe('processMentions', () => {
  const ctx = useTestTransaction();
  let tenantId: string;
  let authorId: string;
  let aliceId: string;
  let bobId: string;

  const addUser = async (id: string, firstName: string, email: string, deletedAt: Date | null = null) => {
    await ctx.trx
      .insertInto('authusers')
      .values({
        id,
        tenant_id: tenantId,
        email,
        password: 'password',
        first_name: firstName,
        last_name: 'Tester',
        role: 'user',
        verified: true,
        deleted_at: deletedAt,
        createdby_id: id,
        updatedby_id: id,
      })
      .execute();
  };

  /** Addresses the run tried to email, in call order. */
  const attempted = (spy: { mock: { calls: Array<[{ to: string }]> } }): string[] =>
    spy.mock.calls.map((call) => call[0].to);

  const run = () =>
    processMentions(
      ctx.trx,
      tenantId,
      'Hey @alice and @bob, please take a look',
      'https://app.example/tasks/1',
      authorId,
    );

  beforeEach(async () => {
    tenantId = rand();
    authorId = rand();
    aliceId = rand();
    bobId = rand();

    await ctx.trx.insertInto('tenants').values({ id: tenantId, name: 'Mentions Tenant' }).execute();
    await addUser(authorId, 'Author', `author-${authorId}@example.com`);
    await addUser(aliceId, 'Alice', `alice-${aliceId}@example.com`);
    await addUser(bobId, 'Bob', `bob-${bobId}@example.com`);

    // In-app notifications write through their own repository on the shared connection, which
    // would escape this test's transaction. They are not what these tests are about.
    vi.spyOn(NotificationsRepo.prototype, 'pushNotification').mockResolvedValue(undefined as never);
  });

  // Without this, vi.spyOn hands back the same spy on the next test and its recorded calls carry
  // over, so a per-recipient assertion silently counts the previous test's messages too.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('notifies everyone mentioned even when the gate refuses the first message it tries', async () => {
    const sendMail = vi
      .spyOn(TransactionalEmailService.prototype, 'sendMail')
      .mockRejectedValue(new TransactionalSendBlockedError('Tenant is suspended — transactional mail withheld.'));

    await run();

    expect(attempted(sendMail).sort()).toEqual([`alice-${aliceId}@example.com`, `bob-${bobId}@example.com`].sort());
  });

  it('carries on to the next recipient after an ordinary delivery failure', async () => {
    const sendMail = vi
      .spyOn(TransactionalEmailService.prototype, 'sendMail')
      .mockRejectedValue(new Error('Postmark 503'));

    await run();

    expect(attempted(sendMail)).toHaveLength(2);
  });

  it('attributes each message to the workspace so a bounce can be traced back to it', async () => {
    const sendMail = vi.spyOn(TransactionalEmailService.prototype, 'sendMail').mockResolvedValue(undefined);

    await run();

    expect(sendMail.mock.calls.every((call) => call[0].tenant_id === tenantId)).toBe(true);
  });

  it('never emails a user whose account was deleted', async () => {
    // Deleted accounts keep their row for foreign-key integrity with their identity scrubbed.
    const goneId = rand();
    await addUser(goneId, 'Alice', `gone-${goneId}@example.com`, new Date());
    const sendMail = vi.spyOn(TransactionalEmailService.prototype, 'sendMail').mockResolvedValue(undefined);

    await run();

    expect(attempted(sendMail)).not.toContain(`gone-${goneId}@example.com`);
  });
});
