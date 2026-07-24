import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '../../../env';
import { TransactionalEmailService } from './transactional-mail.service';

/**
 * Locks in the shared footer contract: every email keeps the "not marketing, no
 * unsubscribe link" sentence, and only preference-gated notification emails
 * (notificationSettingsLink: true) additionally link to /settings/notifications
 * in both the HTML footer and the plain-text body.
 */
describe('TransactionalEmailService', () => {
  let savedServerToken: string | undefined;
  let fetchMock: ReturnType<typeof vi.fn>;

  const baseOptions = {
    to: 'user@example.com',
    subject: 'Test subject',
    text: 'Plain body',
    html: '<p>Hello</p>',
  };

  const settingsUrl = `${env.appUrl}/settings/notifications`;

  /** The parsed JSON body of the nth fetch call. */
  function sentBody(call = 0): { HtmlBody: string; TextBody: string } {
    return JSON.parse(fetchMock.mock.calls[call]?.[1]?.body as string) as { HtmlBody: string; TextBody: string };
  }

  beforeEach(() => {
    savedServerToken = env.postmarkServerToken;
    env.postmarkServerToken = 'test-token';
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: (): Promise<string> => Promise.resolve('') });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    env.postmarkServerToken = savedServerToken;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('logs a dev mock and never calls Postmark when no server token is configured', async () => {
    env.postmarkServerToken = undefined;
    const service = new TransactionalEmailService();
    await service.sendMail({ ...baseOptions });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('omits the notification-settings link by default (account/security mail)', async () => {
    const service = new TransactionalEmailService();
    await service.sendMail({ ...baseOptions });
    const body = sentBody();
    expect(body.HtmlBody).not.toContain(settingsUrl);
    expect(body.TextBody).toBe('Plain body');
    expect(body.HtmlBody).toContain('It is not marketing, so it has no unsubscribe link.');
  });

  it('adds the notification-settings link to the footer when flagged', async () => {
    const service = new TransactionalEmailService();
    await service.sendMail({ ...baseOptions, notificationSettingsLink: true });
    const body = sentBody();
    expect(body.HtmlBody).toContain(`<a href="${settingsUrl}">notification settings</a>`);
    // The link is control, not unsubscribe — the transactional sentence must survive.
    expect(body.HtmlBody).toContain('It is not marketing, so it has no unsubscribe link.');
  });

  it('appends the settings URL to the plain-text body only when flagged', async () => {
    const service = new TransactionalEmailService();
    await service.sendMail({ ...baseOptions, notificationSettingsLink: true });
    expect(sentBody().TextBody).toBe(`Plain body\n\nChoose what you're notified about: ${settingsUrl}`);
  });
});
