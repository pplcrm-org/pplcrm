import { logger } from '../../logger';
import type { SendMailOptions, TransactionalEmailService } from './transactional-mail.service';
import { TransactionalSendBlockedError } from './transactional-send-guard';

/**
 * Send one transactional message from a background job, dropping it if the anti-abuse gate
 * refuses it.
 *
 * The gate (./transactional-send-guard.ts) throws {@link TransactionalSendBlockedError} when the
 * workspace is suspended, has sending paused, or is over its hourly cap for that audience. Its
 * own doc comment says callers in the job worker should catch and drop rather than retry: none
 * of those conditions clears inside a retry window, so a retry only burns the job's attempts and
 * dead-letters it.
 *
 * This deliberately lives outside {@link TransactionalEmailService} rather than being a method on
 * it. Dropping is the right policy for a background job and the wrong policy for a request path,
 * where the caller usually needs to know the message did not go out. Taking the service as an
 * argument also lets each job keep its own `defaultAudience`.
 *
 * Every error other than a gate refusal propagates, so the worker still retries a genuine
 * delivery failure.
 *
 * @param context short description of what the message was, for the log line
 * @returns true when the message was handed to the provider, false when the gate withheld it
 */
export async function sendMailOrDrop(
  mailService: TransactionalEmailService,
  message: SendMailOptions,
  context: string,
): Promise<boolean> {
  try {
    await mailService.sendMail(message);
    return true;
  } catch (err) {
    if (err instanceof TransactionalSendBlockedError) {
      logger.warn(
        {
          context,
          to: message.to,
          tenantId: message.tenant_id ?? null,
          audience: message.audience ?? null,
          reason: err.message,
        },
        'Transactional email withheld by the send guard — dropped rather than retried',
      );
      return false;
    }
    throw err;
  }
}
