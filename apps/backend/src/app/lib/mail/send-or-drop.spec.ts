import { afterEach, describe, expect, it, vi } from 'vitest';

import { sendMailOrDrop } from './send-or-drop';
import { TransactionalEmailService } from './transactional-mail.service';
import { TransactionalSendBlockedError } from './transactional-send-guard';

/**
 * The policy every background job now shares: a message the anti-abuse gate refuses is dropped,
 * because none of the conditions behind a refusal (workspace suspended, sending paused, hourly
 * cap reached) clears inside a retry window. Anything else must still surface, or the worker
 * stops retrying genuine delivery failures.
 */
describe('sendMailOrDrop', () => {
  const service = new TransactionalEmailService({ defaultAudience: 'staff' });
  const message = {
    to: 'someone@example.com',
    subject: 'Hello',
    text: 'Hello',
    html: '<p>Hello</p>',
    tenant_id: '1',
    audience: 'staff' as const,
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports success when the message reaches the provider', async () => {
    const sendMail = vi.spyOn(TransactionalEmailService.prototype, 'sendMail').mockResolvedValue(undefined);

    await expect(sendMailOrDrop(service, message, 'test')).resolves.toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('drops a message the gate refuses, without throwing', async () => {
    vi.spyOn(TransactionalEmailService.prototype, 'sendMail').mockRejectedValue(
      new TransactionalSendBlockedError('Tenant 1 is suspended — transactional mail withheld.'),
    );

    await expect(sendMailOrDrop(service, message, 'test')).resolves.toBe(false);
  });

  it('lets an ordinary delivery failure propagate so the job can retry it', async () => {
    vi.spyOn(TransactionalEmailService.prototype, 'sendMail').mockRejectedValue(new Error('Postmark 503'));

    await expect(sendMailOrDrop(service, message, 'test')).rejects.toThrow('Postmark 503');
  });
});
