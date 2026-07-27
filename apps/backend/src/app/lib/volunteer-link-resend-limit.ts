import { checkDurableRateLimit } from './durable-rate-limiter';

/**
 * Caps on re-sending a volunteer their personal companion link (finding H3).
 *
 * Re-sending mints a fresh token and notifies the volunteer by email and SMS. The SMS
 * body carries a tenant-authored org name and goes to whatever number sits on the person
 * record — so, unlimited, this was an SMS bomber pointed at an arbitrary number and billed
 * to the platform's Twilio account.
 *
 * Two keys, because either alone leaves a hole: per assignment stops hammering one route,
 * per destination number stops rotating through routes to hit the same victim. This mirrors
 * the phone-verification limiter in settings/controller.ts, which already got this right.
 */

/** Re-sends allowed per route/turf assignment per window. */
const RESENDS_PER_ASSIGNMENT = 3;
/** Re-sends allowed per destination phone number per window, across all assignments. */
const RESENDS_PER_NUMBER = 5;
const WINDOW_MS = 60 * 60 * 1000;

const TOO_MANY_MESSAGE =
  'This volunteer link has been re-sent several times recently. Wait an hour before sending it again.';

/**
 * @param assignmentId the route or turf-assignment id the link belongs to
 * @param mobile the destination number, if the volunteer has one on file
 */
export async function assertVolunteerLinkResendAllowed(
  tenantId: string,
  assignmentId: string,
  mobile?: string | null,
): Promise<void> {
  await checkDurableRateLimit(
    `volunteerLinkResend:assignment:${tenantId}:${assignmentId}`,
    RESENDS_PER_ASSIGNMENT,
    WINDOW_MS,
    TOO_MANY_MESSAGE,
  );

  const normalized = (mobile ?? '').replace(/[^\d+]/g, '');
  if (normalized) {
    // Not tenant-scoped on purpose: the cost and the nuisance land on the number's owner,
    // so one tenant must not be able to reset another's budget against the same victim.
    await checkDurableRateLimit(
      `volunteerLinkResend:number:${normalized}`,
      RESENDS_PER_NUMBER,
      WINDOW_MS,
      TOO_MANY_MESSAGE,
    );
  }
}
