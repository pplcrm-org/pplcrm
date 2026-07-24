import type { Kysely, Transaction } from 'kysely';
import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import { env } from '../../../env';
import { InternalError } from '../../errors/app-errors';
import { logger } from '../../logger';
import { BaseRepository } from '../base.repo';
import { LOGO_CID, LOGO_PNG_BASE64 } from './logo-asset';

export interface SendMailOptions {
  to: string;
  subject: string;
  text: string;
  html: string;
  tenant_id?: string | null;
  /** Adds a "choose what you're notified about" footer link to /settings/notifications.
   *  Set only on preference-gated notification emails, never account/security mail. */
  notificationSettingsLink?: boolean;
}

export class TransactionalEmailService {
  private serverToken = env.postmarkServerToken;
  // Full RFC 5322 From with a display name — a bare address lets clients show the
  // Postmark sender-signature name instead of the product name.
  private from = `"${env.postmarkFromName}" <${env.postmarkFromEmail}>`;

  private wrapInTemplate(title: string, contentHtml: string, notificationSettingsLink?: boolean): string {
    const settingsLinkHtml = notificationSettingsLink
      ? `<p>Choose what you're notified about in your <a href="${env.appUrl}/settings/notifications">notification settings</a>.</p>
        `
      : '';
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #f8fafc;
      color: #1e293b;
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      background-color: #f8fafc;
      padding: 40px 20px;
      box-sizing: border-box;
    }
    .container {
      max-width: 580px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
      border: 1px solid #e2e8f0;
    }
    .header {
      background-color: #ffffff;
      padding: 28px 32px;
      text-align: center;
      border-bottom: 1px solid #e2e8f0;
    }
    .header img {
      display: inline-block;
      width: 160px;
      max-width: 60%;
      height: auto;
      border: 0;
      outline: none;
      text-decoration: none;
    }
    .content {
      padding: 40px 32px;
      line-height: 1.6;
      font-size: 16px;
    }
    .content h2 {
      font-size: 20px;
      font-weight: 600;
      color: #0f172a;
      margin-top: 0;
      margin-bottom: 16px;
    }
    .content p {
      margin-top: 0;
      margin-bottom: 24px;
      color: #475569;
    }
    .content a {
      color: #0ea5e9;
    }
    .panel {
      background-color: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 16px 20px;
      margin: 24px 0;
    }
    .panel p {
      margin: 4px 0;
    }
    .panel ul {
      margin: 4px 0;
      padding-left: 20px;
    }
    .btn-container {
      margin: 32px 0;
      text-align: center;
    }
    .btn {
      display: inline-block;
      background-color: #0ea5e9;
      color: #ffffff !important;
      text-decoration: none;
      padding: 12px 28px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 15px;
    }
    .otp-container {
      margin: 32px auto;
      text-align: center;
    }
    .otp-code {
      display: inline-block;
      font-family: 'Courier New', Courier, monospace;
      font-size: 32px;
      font-weight: 700;
      letter-spacing: 6px;
      color: #0ea5e9;
      background-color: #f1f5f9;
      padding: 12px 24px;
      border-radius: 8px;
      border: 1px dashed #cbd5e1;
    }
    .footer {
      background-color: #f8fafc;
      padding: 24px 32px;
      text-align: center;
      border-top: 1px solid #e2e8f0;
      font-size: 13px;
      color: #64748b;
    }
    .footer p {
      margin: 8px 0;
      color: #64748b;
    }
    .footer a {
      color: #0ea5e9;
      text-decoration: none;
    }
    .warning {
      font-size: 14px;
      color: #64748b;
      background-color: #f8fafc;
      border-left: 4px solid #cbd5e1;
      padding: 12px 16px;
      margin-top: 24px;
      border-radius: 0 4px 4px 0;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <img src="cid:${LOGO_CID}" alt="pplCRM" width="160" />
      </div>
      <div class="content">
        ${contentHtml}
      </div>
      <div class="footer">
        ${settingsLinkHtml}<p>This is a transactional message about your account or a request made through pplCRM. It is not marketing, so it has no unsubscribe link.</p>
        <p>&copy; ${new Date().getFullYear()} pplCRM. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
  }

  public async sendMail(options: SendMailOptions): Promise<void> {
    const wrappedHtml = this.wrapInTemplate(options.subject, options.html, options.notificationSettingsLink);
    const text = options.notificationSettingsLink
      ? `${options.text}\n\nChoose what you're notified about: ${env.appUrl}/settings/notifications`
      : options.text;

    if (!this.serverToken) {
      logger.info(
        { from: this.from, to: options.to, subject: options.subject },
        '[POSTMARK DEV MOCK] Transactional Email Outbound',
      );
      return;
    }

    try {
      const response = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Postmark-Server-Token': this.serverToken,
        },
        body: JSON.stringify({
          From: this.from,
          To: options.to,
          Subject: options.subject,
          TextBody: text,
          HtmlBody: wrappedHtml,
          // Inline logo referenced by the header's `cid:` src. Embedded (not a remote
          // URL) so it renders even when the client blocks remote images.
          Attachments: [
            {
              Name: 'logo.png',
              Content: LOGO_PNG_BASE64,
              ContentType: 'image/png',
              ContentID: `cid:${LOGO_CID}`,
            },
          ],
          // Round-trips to the bounce/complaint webhook so suppressions can be tenant-scoped.
          ...(options.tenant_id ? { Metadata: { tenant_id: String(options.tenant_id) } } : {}),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Postmark API responded with status ${response.status}: ${errorText}`);
      }
    } catch (error) {
      throw new InternalError('Failed to send transactional email', undefined, { cause: error });
    }
  }

  public async enqueueMail(options: SendMailOptions, trx?: Transaction<Models> | Kysely<Models>): Promise<void> {
    // NOTE: `as any` retained deliberately — the insert passes a `BigInt` tenant_id
    // that the Kysely model types as `string | null`; a typed handle would reject it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see NOTE above; BigInt tenant_id vs Kysely string-id model. pplcrm-any-exceptions
    const dbClient = (trx || BaseRepository.dbInstance) as any;
    await dbClient
      .insertInto('background_jobs')
      .values({
        tenant_id: options.tenant_id ? BigInt(options.tenant_id) : null,
        queue: 'default',
        status: 'pending',
        payload: JSON.stringify({
          type: 'send-transactional-email',
          to: options.to,
          subject: options.subject,
          text: options.text,
          html: options.html,
          tenant_id: options.tenant_id ?? null,
          notificationSettingsLink: options.notificationSettingsLink ?? null,
        }),
        run_at: new Date(),
        max_attempts: 5,
      })
      .execute();
  }
}
