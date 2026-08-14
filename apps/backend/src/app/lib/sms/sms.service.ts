import type { Kysely, Transaction } from 'kysely';
import { getPlanDef } from '@common';
import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import { env } from '../../../env';
import { InternalError } from '../../errors/app-errors';
import { logger } from '../../logger';
import { BaseRepository } from '../base.repo';

/** Deadline for the Twilio HTTP call — a hung provider connection must not stall a worker slot. */
const TWILIO_TIMEOUT_MS = 15_000;

export interface SendSmsOptions {
  /** E.164 destination — normalize with `normalizeE164()` before calling. */
  to: string;
  body: string;
  tenant_id?: string | null;
}

/**
 * Transactional SMS via the Twilio REST API. Mirrors TransactionalEmailService:
 * plain HTTP (no SDK), and a dev mock that logs instead of sending when the
 * Twilio credentials are unset — so local dev and tests never need an account.
 *
 * Send through `enqueueSms()` inside the business transaction (transactional
 * outbox) — never call `sendSms()` directly from request handlers.
 */
export class SmsService {
  private accountSid = env.twilioAccountSid;
  private authToken = env.twilioAuthToken;
  private fromNumber = env.twilioFromNumber;

  public async sendSms(options: SendSmsOptions): Promise<void> {
    if (!this.accountSid || !this.authToken || !this.fromNumber) {
      logger.info({ from: this.fromNumber, to: options.to, body: options.body }, '[TWILIO DEV MOCK] SMS Outbound');
      return;
    }

    try {
      const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
      const form = new URLSearchParams({
        To: options.to,
        From: this.fromNumber,
        Body: options.body,
      });
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`,
        {
          method: 'POST',
          signal: AbortSignal.timeout(TWILIO_TIMEOUT_MS),
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${auth}`,
          },
          body: form.toString(),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Twilio API responded with status ${response.status}: ${errorText}`);
      }
    } catch (error) {
      throw new InternalError('Failed to send SMS', undefined, { cause: error });
    }
  }

  public async enqueueSms(options: SendSmsOptions, trx?: Transaction<Models> | Kysely<Models>): Promise<void> {
    // NOTE: `as any` retained deliberately — the insert passes a `BigInt` tenant_id
    // that the Kysely model types as `string | null`; a typed handle would reject it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see NOTE above; BigInt tenant_id vs Kysely string-id model. pplcrm-any-exceptions
    const dbClient = (trx || BaseRepository.dbInstance) as any;

    // The pipe-level gate the email side gets from assertTenantMaySendTransactional. SMS
    // recipients are always audience-chosen numbers, and every message costs real Twilio money
    // on the platform account, so a suspended workspace sends nothing, and an UNPAID demo
    // workspace sends nothing ("nothing you do in the demo reaches a real person" — the demo
    // elevation opened the Movement-only volunteer flows that mint these texts, REVIEW7 C1).
    // Skip-and-log rather than throw: the business write this rides in (a turf assignment, a
    // route handoff) must still land — same drop semantics as the mail worker's send-or-drop.
    if (options.tenant_id) {
      const tenant = await (dbClient as Kysely<Models>)
        .selectFrom('tenants')
        .select(['suspended_at', 'demo_mode_at', 'subscription_plan'])
        .where('id', '=', options.tenant_id)
        .executeTakeFirst();
      const storedPlanPaid = getPlanDef(tenant?.subscription_plan)?.purchasable === true;
      if (tenant?.suspended_at || (tenant?.demo_mode_at && !storedPlanPaid)) {
        logger.warn(
          {
            tenantId: options.tenant_id,
            to: options.to,
            suspended: !!tenant?.suspended_at,
            demoMode: !!tenant?.demo_mode_at,
          },
          'SMS withheld — workspace is suspended or in demo mode',
        );
        return;
      }
    }

    await dbClient
      .insertInto('background_jobs')
      .values({
        tenant_id: options.tenant_id ? BigInt(options.tenant_id) : null,
        queue: 'default',
        status: 'pending',
        payload: JSON.stringify({
          type: 'send-sms',
          to: options.to,
          body: options.body,
        }),
        run_at: new Date(),
        max_attempts: 5,
      })
      .execute();
  }
}
