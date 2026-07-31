import { env } from '../../../env';
import { InternalError } from '../../errors/app-errors';
import { logger } from '../../logger';

const SENDGRID_SEND_URL = 'https://api.sendgrid.com/v3/mail/send';

// ── Transient-failure policy for a single SendGrid chunk request ──────────────────────────────
// Total-request timeout (same AbortSignal.timeout idiom as lib/hibp.ts).
const SENDGRID_REQUEST_TIMEOUT_MS = 30_000;
// Attempts INCLUDING the first — 3 total means at most 2 in-place retries.
const SENDGRID_MAX_ATTEMPTS = 3;
// Exponential backoff between attempts: ~1s after the first failure, ~4s after the second…
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_BACKOFF_FACTOR = 4;
// …plus up to this much random jitter so parallel sends don't retry in lockstep.
const RETRY_JITTER_MAX_MS = 250;
// A 429 Retry-After asking for longer than this is not "reasonable" — clamp it.
const RETRY_AFTER_CAP_MS = 30_000;
const MS_PER_SECOND = 1_000;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_REQUEST_TIMEOUT = 408;
const HTTP_SERVER_ERROR_MIN = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Transient HTTP statuses worth retrying in place. Every other non-2xx (bad request, auth,
 * payload too large…) is permanent and must fail immediately — retrying cannot fix it. */
function isRetryableStatus(status: number): boolean {
  return status === HTTP_TOO_MANY_REQUESTS || status === HTTP_REQUEST_TIMEOUT || status >= HTTP_SERVER_ERROR_MIN;
}

/** Jittered exponential backoff before the retry that follows failure number `attempt`. */
function backoffDelayMs(attempt: number): number {
  return RETRY_BASE_DELAY_MS * RETRY_BACKOFF_FACTOR ** (attempt - 1) + Math.random() * RETRY_JITTER_MAX_MS;
}

/** A reasonable (numeric seconds, non-negative, capped) Retry-After delay, or null to use backoff. */
function retryAfterDelayMs(response: Response): number | null {
  const header = response.headers.get('Retry-After');
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds * MS_PER_SECOND, RETRY_AFTER_CAP_MS);
}

export interface NewsletterRecipient {
  email: string;
  /** Per-recipient SendGrid substitutions (token -> resolved value) for merge fields. */
  substitutions?: Record<string, string>;
  /**
   * RFC 8058 one-click target for this recipient. Emitted as `List-Unsubscribe` +
   * `List-Unsubscribe-Post` on this recipient's personalization, so a 1,000-recipient batch
   * still gives every person their own signed link. It has to live here rather than on the
   * message: the URL is per-recipient, and a batch-wide header would hand everyone the first
   * person's unsubscribe token.
   */
  listUnsubscribeUrl?: string;
}

export interface NewsletterAttachment {
  /** Base64-encoded file content. */
  content: string;
  filename: string;
  type?: string;
  disposition?: 'attachment' | 'inline';
}

export interface SendNewsletterOptions {
  fromName: string;
  fromEmail: string;
  replyTo?: string;
  recipients: NewsletterRecipient[];
  subject: string;
  html: string;
  text?: string;
  sendgridApiKey?: string;
  subuserUsername?: string;
  newsletterId?: string;
  tenantId?: string;
  attachments?: NewsletterAttachment[];
  /** Extra SendGrid custom args echoed back on every webhook event (e.g. workflow_run_id for
   * automation sends). Merged over the newsletterId/tenantId pair. */
  customArgs?: Record<string, string>;
  /** Set false when the body carries its own unsubscribe link (automation emails use the
   * app's HMAC unsubscribe route) instead of SendGrid's `<% unsubscribe %>` substitution. */
  subscriptionTracking?: boolean;
}

export class NewsletterEmailService {
  public async sendNewsletter(options: SendNewsletterOptions): Promise<number> {
    const apiKey = options.sendgridApiKey || env.sendgridApiKey;

    if (!apiKey) {
      logger.info(
        {
          from: `"${options.fromName}" <${options.fromEmail}>`,
          replyTo: options.replyTo || null,
          recipientCount: options.recipients.length,
          subject: options.subject,
        },
        '[SENDGRID DEV MOCK] Newsletter Outbound',
      );
      return options.recipients.length;
    }

    const seen = new Set<string>();
    const uniqueRecipients = options.recipients.filter((r) => {
      const email = r.email?.trim();
      if (!email || seen.has(email)) return false;
      seen.add(email);
      return true;
    });
    if (uniqueRecipients.length === 0) return 0;

    // SendGrid allows up to 1000 personalizations per API request
    const CHUNK_SIZE = 1000;
    let deliveredCount = 0;

    for (let i = 0; i < uniqueRecipients.length; i += CHUNK_SIZE) {
      const chunk = uniqueRecipients.slice(i, i + CHUNK_SIZE);
      const personalizations = chunk.map((r) => ({
        to: [{ email: r.email }],
        // Per-recipient merge-field values. Keeps the whole batch a single request while still
        // personalizing content (SendGrid replaces the tokens in subject/html/text per recipient).
        ...(r.substitutions && Object.keys(r.substitutions).length > 0 ? { substitutions: r.substitutions } : {}),
        // Per-personalization headers so each recipient gets their OWN one-click link. Gmail and
        // Yahoo's bulk-sender rules require this pair; a message-level header cannot carry it
        // because the token names a specific person.
        ...(r.listUnsubscribeUrl
          ? {
              headers: {
                'List-Unsubscribe': `<${r.listUnsubscribeUrl}>`,
                'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
              },
            }
          : {}),
      }));

      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      };

      if (options.subuserUsername) {
        headers['on-behalf-of'] = options.subuserUsername;
      }

      const body = {
        personalizations,
        from: {
          email: options.fromEmail,
          name: options.fromName,
        },
        ...(options.replyTo ? { reply_to: { email: options.replyTo } } : {}),
        subject: options.subject,
        // SendGrid requires text/plain (when present) to come before text/html in this array.
        content: [
          ...(options.text
            ? [
                {
                  type: 'text/plain',
                  value: options.text,
                },
              ]
            : []),
          {
            type: 'text/html',
            value: options.html,
          },
        ],
        ...(() => {
          const customArgs: Record<string, string> = {
            ...(options.newsletterId && options.tenantId
              ? { newsletter_id: options.newsletterId, tenant_id: options.tenantId }
              : {}),
            ...(options.tenantId ? { tenant_id: options.tenantId } : {}),
            ...(options.customArgs ?? {}),
          };
          return Object.keys(customArgs).length > 0 ? { custom_args: customArgs } : {};
        })(),
        ...(options.attachments?.length
          ? {
              attachments: options.attachments.map((a) => ({
                content: a.content,
                filename: a.filename,
                type: a.type,
                disposition: a.disposition || 'attachment',
              })),
            }
          : {}),
        // Enable subscription tracking so SendGrid replaces the `<% unsubscribe %>` substitution tag in
        // the server-appended footer with a working, per-recipient unsubscribe URL. Open/click
        // tracking are set explicitly so engagement data never depends on per-subuser account
        // defaults; text links stay unwrapped so the plain part keeps human-readable URLs.
        tracking_settings: {
          subscription_tracking:
            options.subscriptionTracking === false
              ? { enable: false }
              : {
                  enable: true,
                  substitution_tag: '<% unsubscribe %>',
                },
          open_tracking: { enable: true },
          click_tracking: { enable: true, enable_text: false },
        },
      };

      try {
        await this.postChunkWithRetry(headers, JSON.stringify(body));
        deliveredCount += chunk.length;
      } catch (error) {
        throw new InternalError('Failed to send newsletter via SendGrid', undefined, { cause: error });
      }
    }

    return deliveredCount;
  }

  /**
   * POSTs one chunk to SendGrid, retrying transient failures (network error/timeout/abort, 429,
   * 408, 5xx) in place — up to SENDGRID_MAX_ATTEMPTS total — so a routine blip doesn't fail the
   * whole job and turn into a silently skipped batch under the caller's at-most-once cursor.
   * Non-retryable 4xx (bad request, auth) throw immediately. A 429's Retry-After header is
   * honored (capped at RETRY_AFTER_CAP_MS) instead of the backoff.
   *
   * Deliberate, bounded exception to at-most-once: retrying after a timeout or connection reset —
   * where we never saw the response — can deliver this ONE chunk twice if SendGrid had already
   * accepted the request. Considered and accepted (2026-07-31): a rare duplicated chunk beats the
   * alternative, where the job-level retry resumes past the batch and every recipient in it is
   * silently skipped.
   */
  private async postChunkWithRetry(headers: Record<string, string>, body: string): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(SENDGRID_SEND_URL, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(SENDGRID_REQUEST_TIMEOUT_MS),
        });
      } catch (networkError) {
        if (attempt >= SENDGRID_MAX_ATTEMPTS) throw networkError;
        logger.warn(
          { attempt, err: networkError },
          'SendGrid request failed before a response (network/timeout) — retrying chunk in place',
        );
        await sleep(backoffDelayMs(attempt));
        continue;
      }

      if (response.ok) return;

      const errorText = await response.text();
      const httpError = new Error(`SendGrid API responded with status ${response.status}: ${errorText}`);
      if (!isRetryableStatus(response.status) || attempt >= SENDGRID_MAX_ATTEMPTS) throw httpError;

      const retryAfterMs = response.status === HTTP_TOO_MANY_REQUESTS ? retryAfterDelayMs(response) : null;
      logger.warn(
        { attempt, status: response.status, retryAfterMs },
        'SendGrid responded with a transient error — retrying chunk in place',
      );
      await sleep(retryAfterMs ?? backoffDelayMs(attempt));
    }
  }
}
