import { env } from '../../../env';
import { InternalError } from '../../errors/app-errors';
import { logger } from '../../logger';

export interface NewsletterRecipient {
  email: string;
  /** Per-recipient SendGrid substitutions (token -> resolved value) for merge fields. */
  substitutions?: Record<string, string>;
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
  /** RFC 8058 one-click target for sends that bypass SendGrid subscription tracking (the
   * automation path). Emits `List-Unsubscribe` + `List-Unsubscribe-Post` message headers.
   * Only meaningful for single-recipient sends — the URL is per-recipient. */
  listUnsubscribeUrl?: string;
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
        ...(options.listUnsubscribeUrl
          ? {
              headers: {
                'List-Unsubscribe': `<${options.listUnsubscribeUrl}>`,
                'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
              },
            }
          : {}),
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
        const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`SendGrid API responded with status ${response.status}: ${errorText}`);
        }

        deliveredCount += chunk.length;
      } catch (error) {
        throw new InternalError('Failed to send newsletter via SendGrid', undefined, { cause: error });
      }
    }

    return deliveredCount;
  }
}
