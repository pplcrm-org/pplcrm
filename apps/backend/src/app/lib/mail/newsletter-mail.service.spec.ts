import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '../../../env';
import { InternalError } from '../../errors/app-errors';
import { NewsletterEmailService } from './newsletter-mail.service';

/**
 * Locks in the exact SendGrid /v3/mail/send request shape. Deliverability details live here:
 * the text/plain part MUST come before text/html in `content` (SendGrid rejects the reverse),
 * tracking settings must be explicit so behavior never depends on per-subuser account defaults,
 * and free-tier sends must carry the on-behalf-of subuser header.
 */
describe('NewsletterEmailService', () => {
  const service = new NewsletterEmailService();
  let savedPlatformKey: string | undefined;
  let fetchMock: ReturnType<typeof vi.fn>;

  const recipient = (email: string, substitutions?: Record<string, string>) => ({ email, substitutions });

  const baseOptions = {
    fromName: 'Vote Jane',
    fromEmail: 'news@vote-jane.example.org',
    recipients: [recipient('a@example.com')],
    subject: 'October update',
    html: '<p>Hi</p>',
  };

  /** The parsed JSON body of the nth fetch call. */
  function sentBody(call = 0): any {
    return JSON.parse(fetchMock.mock.calls[call]?.[1]?.body as string);
  }

  function sentHeaders(call = 0): Record<string, string> {
    return fetchMock.mock.calls[call]?.[1]?.headers as Record<string, string>;
  }

  beforeEach(() => {
    savedPlatformKey = env.sendgridApiKey;
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202, text: (): string => '' } as any);
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    env.sendgridApiKey = savedPlatformKey;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('logs a dev mock and never calls SendGrid when no API key is configured', async () => {
    env.sendgridApiKey = undefined;
    const delivered = await service.sendNewsletter({ ...baseOptions });
    expect(delivered).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('puts the text/plain part BEFORE text/html when text is provided', async () => {
    await service.sendNewsletter({ ...baseOptions, sendgridApiKey: 'SG.test', text: 'Hi (plain)' });
    const content = sentBody().content;
    expect(content).toEqual([
      { type: 'text/plain', value: 'Hi (plain)' },
      { type: 'text/html', value: '<p>Hi</p>' },
    ]);
  });

  it('sends html-only content when no text part is provided', async () => {
    await service.sendNewsletter({ ...baseOptions, sendgridApiKey: 'SG.test' });
    expect(sentBody().content).toEqual([{ type: 'text/html', value: '<p>Hi</p>' }]);
  });

  it('enables subscription/open/click tracking explicitly, with text links unwrapped', async () => {
    await service.sendNewsletter({ ...baseOptions, sendgridApiKey: 'SG.test' });
    expect(sentBody().tracking_settings).toEqual({
      subscription_tracking: { enable: true, substitution_tag: '<% unsubscribe %>' },
      open_tracking: { enable: true },
      click_tracking: { enable: true, enable_text: false },
    });
  });

  it('tags every send with newsletter/tenant custom_args only when both ids are present', async () => {
    await service.sendNewsletter({ ...baseOptions, sendgridApiKey: 'SG.test', newsletterId: '7', tenantId: '3' });
    expect(sentBody().custom_args).toEqual({ newsletter_id: '7', tenant_id: '3' });

    await service.sendNewsletter({ ...baseOptions, sendgridApiKey: 'SG.test', newsletterId: '7' });
    expect(sentBody(1).custom_args).toBeUndefined();
  });

  it('sends on behalf of the subuser when one is given, and authorizes with the tenant key', async () => {
    await service.sendNewsletter({ ...baseOptions, sendgridApiKey: 'SG.tenant', subuserUsername: 'free-pool' });
    const headers = sentHeaders();
    expect(headers['on-behalf-of']).toBe('free-pool');
    expect(headers['Authorization']).toBe('Bearer SG.tenant');

    await service.sendNewsletter({ ...baseOptions, sendgridApiKey: 'SG.tenant' });
    expect(sentHeaders(1)['on-behalf-of']).toBeUndefined();
  });

  it('deduplicates repeated addresses and skips blank ones, reporting the real delivered count', async () => {
    const delivered = await service.sendNewsletter({
      ...baseOptions,
      sendgridApiKey: 'SG.test',
      recipients: [recipient('a@example.com'), recipient('a@example.com'), recipient('  '), recipient('b@example.com')],
    });
    expect(delivered).toBe(2);
    const personalizations = sentBody().personalizations;
    expect(personalizations.map((p: any) => p.to[0].email)).toEqual(['a@example.com', 'b@example.com']);
  });

  it('returns 0 without calling SendGrid when every recipient is blank or duplicate', async () => {
    const delivered = await service.sendNewsletter({
      ...baseOptions,
      sendgridApiKey: 'SG.test',
      recipients: [recipient(''), recipient('   ')],
    });
    expect(delivered).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('includes per-recipient substitutions only when non-empty', async () => {
    await service.sendNewsletter({
      ...baseOptions,
      sendgridApiKey: 'SG.test',
      recipients: [recipient('a@example.com', { '{FirstName}': 'Ada' }), recipient('b@example.com', {})],
    });
    const [a, b] = sentBody().personalizations;
    expect(a.substitutions).toEqual({ '{FirstName}': 'Ada' });
    expect(b.substitutions).toBeUndefined();
  });

  it('splits recipients into 1000-per-request chunks (SendGrid personalization limit)', async () => {
    const recipients = Array.from({ length: 1001 }, (_, i) => recipient(`p${i}@example.com`));
    const delivered = await service.sendNewsletter({ ...baseOptions, sendgridApiKey: 'SG.test', recipients });
    expect(delivered).toBe(1001);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentBody(0).personalizations).toHaveLength(1000);
    expect(sentBody(1).personalizations).toHaveLength(1);
  });

  it('wraps a SendGrid error response in InternalError (never a raw fetch error)', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: (): Promise<string> => Promise.resolve('denied'),
    } as any);
    await expect(service.sendNewsletter({ ...baseOptions, sendgridApiKey: 'SG.bad' })).rejects.toBeInstanceOf(
      InternalError,
    );
  });

  it('defaults attachment disposition and passes attachments through', async () => {
    await service.sendNewsletter({
      ...baseOptions,
      sendgridApiKey: 'SG.test',
      attachments: [{ content: 'QUJD', filename: 'flyer.pdf', type: 'application/pdf' }],
    });
    expect(sentBody().attachments).toEqual([
      { content: 'QUJD', filename: 'flyer.pdf', type: 'application/pdf', disposition: 'attachment' },
    ]);
  });

  it('only includes reply_to when a reply address is set', async () => {
    await service.sendNewsletter({ ...baseOptions, sendgridApiKey: 'SG.test', replyTo: 'reply@vote-jane.example.org' });
    expect(sentBody().reply_to).toEqual({ email: 'reply@vote-jane.example.org' });

    await service.sendNewsletter({ ...baseOptions, sendgridApiKey: 'SG.test' });
    expect(sentBody(1).reply_to).toBeUndefined();
  });

  /**
   * Transient SendGrid failures (429/408/5xx, network errors, timeouts) are retried in place —
   * up to 3 attempts — because the send job persists its resume cursor BEFORE calling this
   * service: a chunk that fails outright is skipped by the job retry, never re-sent. Permanent
   * 4xx must fail immediately (retrying a bad request or bad auth cannot succeed).
   */
  describe('transient-failure retry policy', () => {
    const okResponse = { ok: true, status: 202, text: (): string => '' };

    function failureResponse(status: number, retryAfter?: string): unknown {
      return {
        ok: false,
        status,
        headers: { get: (): string | null => retryAfter ?? null },
        text: (): Promise<string> => Promise.resolve('upstream error'),
      };
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it('attaches a total-request timeout signal to every SendGrid request', async () => {
      await service.sendNewsletter({ ...baseOptions, sendgridApiKey: 'SG.test' });
      expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    });

    it('retries once on 429 and honors the Retry-After header for the wait', async () => {
      vi.useFakeTimers();
      fetchMock.mockResolvedValueOnce(failureResponse(429, '7')).mockResolvedValueOnce(okResponse as any);

      const send = service.sendNewsletter({ ...baseOptions, sendgridApiKey: 'SG.test' });
      // Let the first (failing) request settle; the retry must now be waiting on Retry-After.
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // 1ms short of the 7s Retry-After: the retry has not fired yet…
      await vi.advanceTimersByTimeAsync(6_999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // …and at exactly 7s it does.
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await expect(send).resolves.toBe(1);
    });

    it('recovers when SendGrid returns a 5xx and the retry succeeds', async () => {
      vi.useFakeTimers();
      fetchMock.mockResolvedValueOnce(failureResponse(500)).mockResolvedValueOnce(okResponse as any);

      const send = service.sendNewsletter({ ...baseOptions, sendgridApiKey: 'SG.test' });
      await vi.runAllTimersAsync();
      await expect(send).resolves.toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('retries after a network error whose response was never seen (bounded duplicate risk, accepted)', async () => {
      vi.useFakeTimers();
      fetchMock.mockRejectedValueOnce(new Error('socket hang up')).mockResolvedValueOnce(okResponse as any);

      const send = service.sendNewsletter({ ...baseOptions, sendgridApiKey: 'SG.test' });
      await vi.runAllTimersAsync();
      await expect(send).resolves.toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('fails immediately on a permanent 4xx with NO retry', async () => {
      fetchMock.mockResolvedValue(failureResponse(400));

      await expect(service.sendNewsletter({ ...baseOptions, sendgridApiKey: 'SG.test' })).rejects.toBeInstanceOf(
        InternalError,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('throws InternalError once every attempt is exhausted', async () => {
      vi.useFakeTimers();
      fetchMock.mockResolvedValue(failureResponse(503));

      const send = service.sendNewsletter({ ...baseOptions, sendgridApiKey: 'SG.test' });
      const assertion = expect(send).rejects.toBeInstanceOf(InternalError);
      await vi.runAllTimersAsync();
      await assertion;
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  /**
   * RFC 8058 one-click. Gmail/Yahoo require the header pair on bulk mail, and the URL names a
   * specific person — so it must ride on each personalization. A message-level header would hand
   * all 1,000 recipients in a batch the first person's unsubscribe token.
   */
  describe('List-Unsubscribe (per recipient)', () => {
    it('emits the RFC 8058 header pair on the recipient that carries a URL', async () => {
      env.sendgridApiKey = 'SG.test';
      await service.sendNewsletter({
        ...baseOptions,
        recipients: [{ email: 'a@example.com', listUnsubscribeUrl: 'https://api.example.org/api/unsubscribe/tok-a' }],
      });

      const p = sentBody().personalizations[0];
      expect(p.headers['List-Unsubscribe']).toBe('<https://api.example.org/api/unsubscribe/tok-a>');
      expect(p.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    });

    it('gives every recipient in a batch their OWN token', async () => {
      env.sendgridApiKey = 'SG.test';
      await service.sendNewsletter({
        ...baseOptions,
        recipients: [
          { email: 'a@example.com', listUnsubscribeUrl: 'https://api.example.org/api/unsubscribe/tok-a' },
          { email: 'b@example.com', listUnsubscribeUrl: 'https://api.example.org/api/unsubscribe/tok-b' },
        ],
      });

      const [first, second] = sentBody().personalizations;
      expect(first.headers['List-Unsubscribe']).toContain('tok-a');
      expect(second.headers['List-Unsubscribe']).toContain('tok-b');
      // The header must never be hoisted to the message, where it would apply to everyone.
      expect(sentBody().headers).toBeUndefined();
    });

    it('omits the headers entirely when no URL is supplied', async () => {
      env.sendgridApiKey = 'SG.test';
      await service.sendNewsletter({ ...baseOptions });

      expect(sentBody().personalizations[0].headers).toBeUndefined();
      expect(sentBody().headers).toBeUndefined();
    });
  });
});
