import { randomInt } from 'node:crypto';

import type { Transaction } from 'kysely';
import * as QRCode from 'qrcode';

import { hashVerificationCode, verificationCodeMatches } from './verification-code-hash';
import { checkDurableRateLimit } from '../../lib/durable-rate-limiter';

import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import type {
  AddJoinCodeType,
  JoinCodePhoneSendResult,
  JoinCodeQr,
  JoinCodeRow,
  UpdateJoinCodeType,
  CompanionAccessKind,
  CompanionAccessPayload,
  CompanionApprovalPayload,
  CompanionContact,
  CompanionJoinStartResult,
  CompanionJoinStartType,
  CompanionLinkKind,
  CompanionOrganizerDecisionType,
  CompanionOrganizerPayload,
  CompanionOrganizerPending,
  CompanionVerifyChannel,
  CompanionVerifyConfirmResult,
  CompanionVerifyKind,
  CompanionVolunteerRow,
  IAuthKeyPayload,
} from '../../../../../../libs/common/src';
import { BadRequestError, ForbiddenError, NotFoundError, UnauthorizedError } from '../../errors/app-errors';
import { insertPersonWithPublicId } from '../../lib/person-public-id';
import { notificationEnabled } from '../../lib/profile-preferences';
import { publicOrgName } from '../../lib/public-tenant';
import { checkRateLimit } from '../../lib/rate-limiter';
import { TransactionalEmailService } from '../../lib/mail/transactional-mail.service';
import { SmsService } from '../../lib/sms/sms.service';
import { maskEmail, maskPhone, normalizeE164 } from '../../lib/sms/phone';
import { generateToken, hashToken } from '../../lib/token-hash';
import { UserActivityRepo } from '../../lib/user-activity.repo';
import { turfAssignmentExpiry, volunteerLinksExpire } from '../../lib/volunteer-link-policy';
import { env } from '../../../env';
import { TurfAssignmentsRepo, generateTurfToken } from '../canvassing/repositories/turf-assignments.repo';
import { DeliveryRoutesRepo } from '../deliveries/repositories/delivery-routes.repo';
import { NotificationsRepo } from '../notifications/repositories/notifications.repo';
import { ApprovalTokensRepo } from './repositories/approval-tokens.repo';
import { CompanionSessionsRepo } from './repositories/companion-sessions.repo';
import { JoinCodesRepo, type ResolvedJoinCode } from './repositories/join-codes.repo';
import { OrganizerTokensRepo, type ResolvedOrganizerToken } from './repositories/organizer-tokens.repo';
import { CompanionVolunteersRepo, type CompanionVolunteer } from './repositories/companion-volunteers.repo';

const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_MAX_ATTEMPTS = 5;
const SESSION_TTL_DAYS = 30;
const VERIFY_START_LIMIT = 3; // sends per token per window
const VERIFY_START_WINDOW_MS = 15 * 60 * 1000;
const VERIFY_CONFIRM_LIMIT = 15; // confirms per token per window (attempt lockout is per code)
const VERIFY_CONFIRM_WINDOW_MS = 15 * 60 * 1000;
/** Ceiling on code sends per volunteer link per day — bounds the indefinite SMS drip the
 *  per-window limit alone allowed (finding M6). Far above any real "resend it" loop. */
const VERIFY_SENDS_PER_DAY = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a scanned QR stays redeemable before the volunteer has to scan again. */
const JOIN_CLAIM_TTL_MS = 30 * 60 * 1000;
/**
 * How long an approve-by-text link lives.
 *
 * Short on purpose: it is a bearer credential sitting in an SMS history, and a volunteer
 * still waiting three days later is a conversation, not a tap. Approval never becomes
 * impossible — the Volunteer access page is always there.
 */
const APPROVAL_TOKEN_TTL_MS = 72 * 60 * 60 * 1000;
/** Per-IP burst limit on the join form — a scanned poster is not a signup firehose. */
const JOIN_START_LIMIT = 5;
const JOIN_START_WINDOW_MS = 15 * 60 * 1000;
/** Per-code daily ceiling. Bounds what one leaked poster can cost in SMS and person rows. */
const JOIN_START_PER_CODE_PER_DAY = 200;

/**
 * One message for every reason a scan can fail: unknown code, revoked, expired, used up,
 * suspended org, previously-revoked volunteer. Distinguishing them would turn this
 * endpoint into an oracle for which codes exist and who is already in the database.
 */
const JOIN_REFUSAL = 'That code is not accepting new volunteers. Check with your organizer.';

/**
 * How long the organizer's phone link lives.
 *
 * The length of a canvass launch, not of a campaign. It is a bearer credential in an SMS
 * that can approve everyone who scans one poster, so it is deliberately the shortest
 * lifetime that still covers "text it to myself at 9am, use it all morning". Re-sending is
 * one tap from the CRM; a link that outlived the event would be a standing grant nobody
 * remembers holding.
 */
const ORGANIZER_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
/** Sends per admin per window — this texts a real phone and costs real money. */
const ORGANIZER_SEND_LIMIT = 5;
const ORGANIZER_SEND_WINDOW_MS = 60 * 60 * 1000;

/** The URL a join QR encodes. Built server-side so the companion origin is never guessed. */
function joinUrl(code: string): string {
  return `${env.companionUrl}/j/${code}`;
}

/**
 * The QR module matrix for a URL.
 *
 * Always a matrix, never an image: the client draws one `<svg>` from it, so nothing renders
 * a binary here, nothing is cached as a file, and the code scales to a projector without
 * going fuzzy.
 */
function qrMatrix(url: string): boolean[][] {
  const { modules } = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const matrix: boolean[][] = [];
  for (let row = 0; row < modules.size; row++) {
    const cells: boolean[] = [];
    for (let col = 0; col < modules.size; col++) cells.push(modules.data[row * modules.size + col] === 1);
    matrix.push(cells);
  }
  return matrix;
}

/** An unselected `<select>` sends '' — that means "none", not "leave it alone". */
function emptyToNull(value: string | null | undefined): string | null {
  return value == null || value === '' ? null : value;
}

function toDateOrNull(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** What a capability link resolves to, whichever app it belongs to. */
interface ResolvedLink {
  tenant_id: string;
  /** Person the link was assigned to; null = staff never attached one. */
  volunteer_person_id: string | null;
  /** The staff account behind the link — actor for activity attribution. */
  organizer_id: string;
}

/** Who a device session belongs to, resolved without any capability link. */
export interface ResolvedCompanionSession {
  tenant_id: string;
  volunteer_id: string;
  person_id: string;
  /** Per-volunteer roam override; null = inherit the workspace setting. */
  can_roam: boolean | null;
  /**
   * The campaign of the join code they came in through, when it named one — provenance,
   * not authorization. It is what a roaming volunteer with no assignment yet is scoped
   * to, so a poster for one campaign doesn't open the whole workspace.
   */
  join_campaign_id: string | null;
}

interface PersonContacts {
  first_name: string | null;
  email: string | null;
  /** E.164, already normalized — null when the mobile on file can't be normalized. */
  sms: string | null;
}

/**
 * The companion access layer (COMPANION-APPS-PLAN.md §2). The capability token
 * says WHAT may be touched (one turf / one route); the companion session says
 * WHO is touching it. Both are required on every companion data request —
 * `requireSession()` is the guard the canvass/deliveries public controllers
 * call. Nothing here ever reveals whether a contact exists beyond masked
 * values for the link's own volunteer.
 */
export class CompanionAccessController {
  private activityRepo = new UserActivityRepo();
  private approvalTokensRepo = new ApprovalTokensRepo();
  private joinCodesRepo = new JoinCodesRepo();
  private mailService = new TransactionalEmailService({ defaultAudience: 'account' });
  private notificationsRepo = new NotificationsRepo();
  private organizerTokensRepo = new OrganizerTokensRepo();
  private routesRepo = new DeliveryRoutesRepo();
  private sessionsRepo = new CompanionSessionsRepo();
  private smsService = new SmsService();
  private turfAssignmentsRepo = new TurfAssignmentsRepo();
  private volunteersRepo = new CompanionVolunteersRepo();

  /** GET /api/companion/access — tell the gate UI what to render. */
  public async getAccess(
    kind: CompanionAccessKind,
    token: string | null,
    sessionToken: string | null,
  ): Promise<CompanionAccessPayload> {
    // Two kinds are not capability links and resolve differently. Handled up front so
    // the link path below stays exactly what it was.
    if (kind === 'session') return this.accessForSession(sessionToken);
    if (!token) return { state: 'dead' };
    if (kind === 'join') return this.accessForJoin(token, sessionToken);

    const link = await this.resolveLink(kind, token);
    if (!link) return { state: 'dead' };

    const organizationName = await publicOrgName(link.tenant_id);
    const organizerName = await this.organizerFirstName(link.tenant_id, link.organizer_id);
    if (!link.volunteer_person_id) return { state: 'unassigned', organizerName, organizationName };

    const person = await this.personContacts(link.tenant_id, link.volunteer_person_id);
    if (!person) return { state: 'unassigned', organizerName, organizationName };

    const volunteer = await this.volunteersRepo.findByPerson({
      tenant_id: link.tenant_id,
      person_id: link.volunteer_person_id,
    });
    if (volunteer?.status === 'revoked') return { state: 'dead' };

    const base = {
      volunteerName: person.first_name ?? undefined,
      organizerName,
      organizationName,
    };

    const session = await this.findUsableSession(sessionToken, link.tenant_id, volunteer);
    if (session) {
      return volunteer?.status === 'approved' ? { state: 'ready', ...base } : { state: 'pending_approval', ...base };
    }

    return { state: 'need_verification', ...base, contacts: this.contactsOf(person) };
  }

  /** POST /api/companion/verify/start — send a one-time code to a contact on file. */
  public async verifyStart(
    kind: CompanionVerifyKind,
    token: string,
    channel: CompanionVerifyChannel,
  ): Promise<{ masked: string }> {
    checkRateLimit(`companion-verify-start:${token}`, VERIFY_START_LIMIT, VERIFY_START_WINDOW_MS);

    const link = await this.resolveVerifySubject(kind, token);
    if (!link || !link.volunteer_person_id) throw new NotFoundError('This link is not active.');

    // A suspended organization (under abuse review) must not be able to burn verification SMS/email
    // cost. Companion codes sit outside the newsletter send-guard chain, so this path needs its own
    // check — otherwise a suspended tenant keeps emitting outbound SMS/email here.
    const org = await this.volunteersRepo.db
      .selectFrom('tenants')
      .select('suspended_at')
      .where('id', '=', link.tenant_id)
      .executeTakeFirst();
    if (org?.suspended_at) {
      throw new ForbiddenError('This organization is temporarily unavailable. Please contact your organizer.');
    }

    // NOT gated on sending_paused_at, deliberately: a hard-bounce pause halts newsletters
    // but must not strand volunteers already in the field — only a full suspension (abuse
    // review) closes this path. See the spec that pins this behaviour.
    //
    // The abuse the pause would otherwise have covered (finding M6) is cost, not content:
    // whoever holds a link could drip 3 SMS every 15 minutes indefinitely, ~288/day, on the
    // platform's Twilio account. A per-token daily ceiling bounds that without touching the
    // legitimate "I didn't get the code, resend" loop.
    await checkDurableRateLimit(
      `companionVerifyStart:day:${link.tenant_id}:${link.volunteer_person_id}`,
      VERIFY_SENDS_PER_DAY,
      DAY_MS,
      'Too many verification codes have been sent for this link today. Contact your organizer.',
    );

    const person = await this.personContacts(link.tenant_id, link.volunteer_person_id);
    if (!person) throw new NotFoundError('This link is not active.');

    const destination = channel === 'email' ? person.email : person.sms;
    if (!destination) throw new BadRequestError('That contact method is not on file for this link.');

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const orgName = await publicOrgName(link.tenant_id);

    await this.volunteersRepo.transaction().execute(async (trx) => {
      const volunteer = await this.volunteersRepo.ensureForPerson(
        { tenant_id: link.tenant_id, person_id: String(link.volunteer_person_id), created_by: link.organizer_id },
        trx,
      );
      if (volunteer.status === 'revoked') throw new NotFoundError('This link is not active.');
      await this.volunteersRepo.setVerifyCode(
        {
          tenant_id: link.tenant_id,
          id: volunteer.id,
          code_hash: hashVerificationCode(volunteer.id, code),
          expires_at: new Date(Date.now() + CODE_TTL_MS),
          channel,
        },
        trx,
      );
      if (channel === 'email') {
        await this.mailService.enqueueMail(
          {
            to: destination,
            subject: `Your ${orgName} verification code`,
            text: `Your verification code is ${code}. It expires in 10 minutes. If you didn't request this, ignore this message.`,
            html: `<h2>Verify it's you</h2><p>Enter this code on the volunteer page to continue. It expires in 10 minutes.</p><div class="otp-container"><span class="otp-code">${code}</span></div><p class="warning">If you didn't request this code, you can ignore this message.</p>`,
            tenant_id: link.tenant_id,
          },
          trx,
        );
      } else {
        await this.smsService.enqueueSms(
          {
            to: destination,
            body: `${orgName} code: ${code}. Expires in 10 minutes.`,
            tenant_id: link.tenant_id,
          },
          trx,
        );
      }
    });

    return { masked: channel === 'email' ? maskEmail(destination) : maskPhone(destination) };
  }

  /** POST /api/companion/verify/confirm — check the code, mint a device session. */
  public async verifyConfirm(
    kind: CompanionVerifyKind,
    token: string,
    code: string,
    userAgent: string | null,
  ): Promise<CompanionVerifyConfirmResult> {
    checkRateLimit(`companion-verify-confirm:${token}`, VERIFY_CONFIRM_LIMIT, VERIFY_CONFIRM_WINDOW_MS);

    const link = await this.resolveVerifySubject(kind, token);
    if (!link || !link.volunteer_person_id) throw new NotFoundError('This link is not active.');

    const volunteer = await this.volunteersRepo.findByPerson({
      tenant_id: link.tenant_id,
      person_id: link.volunteer_person_id,
    });
    if (!volunteer || volunteer.status === 'revoked') throw new NotFoundError('This link is not active.');
    if (!volunteer.verify_code_hash || !volunteer.verify_code_expires_at) {
      throw new BadRequestError('Request a new code first.');
    }
    if (volunteer.verify_code_expires_at < new Date()) {
      throw new BadRequestError('That code has expired. Request a new one.');
    }
    if (volunteer.verify_attempts >= CODE_MAX_ATTEMPTS) {
      await this.volunteersRepo.clearVerifyCode({ tenant_id: link.tenant_id, id: volunteer.id });
      throw new BadRequestError('Too many attempts. Request a new code.');
    }
    // Constant-time, and keyed+bound to this volunteer — see verification-code-hash.
    if (!verificationCodeMatches(volunteer.id, code, volunteer.verify_code_hash)) {
      await this.volunteersRepo.bumpVerifyAttempts({ tenant_id: link.tenant_id, id: volunteer.id });
      throw new BadRequestError("That code didn't match. Check it and try again.");
    }

    const wasApproved = volunteer.status === 'approved';
    const sessionToken = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

    await this.volunteersRepo.transaction().execute(async (trx) => {
      await this.volunteersRepo.markVerified({ tenant_id: link.tenant_id, id: volunteer.id }, trx);
      // The claim was a one-shot handshake between the scan and this moment. Burning it
      // here means a QR screenshot cannot be replayed into someone else's signup.
      if (kind === 'join') {
        await this.volunteersRepo.clearJoinClaim({ tenant_id: link.tenant_id, id: volunteer.id }, trx);
      }
      await this.sessionsRepo.create(
        {
          tenant_id: link.tenant_id,
          volunteer_id: volunteer.id,
          token_hash: hashToken(sessionToken),
          expires_at: expiresAt,
          user_agent: userAgent,
        },
        trx,
      );
      if (!wasApproved) {
        await this.notifyAdminsOfPendingVolunteer(link, volunteer.id, trx);
      }
      await this.activityRepo.log(
        {
          tenant_id: link.tenant_id,
          user_id: link.organizer_id,
          activity: 'update',
          entity: 'companion_volunteers',
          entity_id: volunteer.id,
          metadata: {
            action: 'volunteer_verified',
            message: wasApproved
              ? 'Volunteer verified a new device via companion link'
              : 'Volunteer verified their contact and is waiting for approval',
            via: 'companion link',
          },
        },
        trx,
      );
    });

    return {
      status: wasApproved ? 'ready' : 'pending_approval',
      sessionToken,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * The guard every companion data endpoint calls: validates the device
   * session, that it belongs to the link's volunteer, and that the volunteer
   * is approved. Throws UnauthorizedError (no/invalid session — the gate
   * re-verifies) or ForbiddenError (valid session, not approved).
   */
  public async requireSession(
    sessionToken: string | null | undefined,
    link: { tenant_id: string; volunteer_person_id: string | null },
  ): Promise<void> {
    if (!link.volunteer_person_id) throw new UnauthorizedError('This link needs to be re-sent by your organizer.');
    if (!sessionToken) throw new UnauthorizedError('Verification required.');

    const session = await this.sessionsRepo.findByTokenHash(hashToken(sessionToken));
    if (!session || session.tenant_id !== link.tenant_id) throw new UnauthorizedError('Verification required.');
    if (session.revoked_at || session.expires_at < new Date()) throw new UnauthorizedError('Verification required.');

    const volunteer = await this.volunteersRepo.findById({ tenant_id: link.tenant_id, id: session.volunteer_id });
    if (!volunteer || volunteer.person_id !== link.volunteer_person_id) {
      throw new UnauthorizedError('Verification required.');
    }
    if (volunteer.status !== 'approved') throw new ForbiddenError('Waiting for organizer approval.');

    await this.sessionsRepo.touchLastUsed({ tenant_id: link.tenant_id, id: session.id });
  }

  /**
   * Identify the volunteer from their device session alone, with no capability link.
   *
   * `requireSession` answers "may the holder of this session open THIS link?" — it
   * needs a link to check against. Surfaces that exist before a link does (picking a
   * turf, switching turfs) need the other direction: "who is this, and what tenant
   * are they in?" The session row already carries `tenant_id` and `volunteer_id`, so
   * this is a lookup, not a new trust model — approval remains the trust decision and
   * an unapproved volunteer is still refused.
   *
   * Deliberately a sibling rather than a change to `requireSession`: every existing
   * `/t/:token` and `/r/:token` caller keeps its link-first check untouched.
   */
  public async resolveSession(sessionToken: string | null | undefined): Promise<ResolvedCompanionSession> {
    if (!sessionToken) throw new UnauthorizedError('Verification required.');

    const session = await this.sessionsRepo.findByTokenHash(hashToken(sessionToken));
    if (!session) throw new UnauthorizedError('Verification required.');
    if (session.revoked_at || session.expires_at < new Date()) throw new UnauthorizedError('Verification required.');

    const volunteer = await this.volunteersRepo.findById({
      tenant_id: session.tenant_id,
      id: session.volunteer_id,
    });
    if (!volunteer) throw new UnauthorizedError('Verification required.');
    if (volunteer.status !== 'approved') throw new ForbiddenError('Waiting for organizer approval.');

    await this.sessionsRepo.touchLastUsed({ tenant_id: session.tenant_id, id: session.id });

    // Only the QR path leaves a join code behind, so most sessions skip this read.
    const joinCode = volunteer.join_code_id
      ? await this.joinCodesRepo.findById({ tenant_id: session.tenant_id, id: volunteer.join_code_id })
      : null;

    return {
      tenant_id: session.tenant_id,
      volunteer_id: volunteer.id,
      person_id: volunteer.person_id,
      can_roam: volunteer.can_roam ?? null,
      join_campaign_id: joinCode?.campaign_id ?? null,
    };
  }

  // ----------------------------------------------------------- QR join path --

  /**
   * POST /api/companion/join/start — someone scanned a QR and told us who they are.
   *
   * This is the only path that writes into `persons` without an authenticated caller,
   * so the guards matter more than the happy path:
   *
   * - Per-IP burst limit and a durable per-code daily ceiling bound what one leaked
   *   poster can cost in SMS and rolodex rows.
   * - `max_uses` is enforced by the UPDATE's own WHERE clause, so two simultaneous
   *   scans of the last slot cannot both win.
   * - A suspended organization cannot burn outbound cost here, mirroring `verifyStart`.
   * - Every refusal is the same message (`JOIN_REFUSAL`), so this cannot be used to
   *   probe which codes exist.
   *
   * The response shape is identical whether or not the person already existed. The
   * amount of WORK differs slightly (an INSERT in one case), which is a timing signal
   * an attacker holding a valid join code could in principle measure; that is a
   * deliberate accepted residual — closing it fully would mean writing a throwaway row
   * on every request. What it can never leak is a name, a contact, or a yes/no answer.
   *
   * Approval is untouched by any of this: a scanner is still a stranger until an admin
   * says otherwise.
   */
  public async joinStart(input: CompanionJoinStartType, ip: string): Promise<CompanionJoinStartResult> {
    checkRateLimit(`companion-join-start:${ip}`, JOIN_START_LIMIT, JOIN_START_WINDOW_MS);

    const joinCode = await this.joinCodesRepo.resolveByCode(input.code);
    if (!joinCode || !this.joinCodeUsable(joinCode)) throw new NotFoundError(JOIN_REFUSAL);

    await checkDurableRateLimit(
      `companionJoin:day:${joinCode.tenant_id}:${joinCode.id}`,
      JOIN_START_PER_CODE_PER_DAY,
      DAY_MS,
      JOIN_REFUSAL,
    );

    const org = await this.volunteersRepo.db
      .selectFrom('tenants')
      .select('suspended_at')
      .where('id', '=', joinCode.tenant_id)
      .executeTakeFirst();
    if (org?.suspended_at) throw new NotFoundError(JOIN_REFUSAL);

    const email = input.email ? input.email.trim().toLowerCase() : null;
    const sms = input.mobile ? normalizeE164(input.mobile) : null;
    const destination = email ?? sms;
    if (!destination) throw new BadRequestError('Enter an email or a mobile number we can text.');
    const channel: CompanionVerifyChannel = email ? 'email' : 'sms';

    const verifyCode = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const claim = generateToken();
    const orgName = await publicOrgName(joinCode.tenant_id);

    await this.volunteersRepo.transaction().execute(async (trx) => {
      // Counted first: if the code is exhausted or was revoked between the check above
      // and now, nothing else in this transaction should have happened.
      const counted = await this.joinCodesRepo.bumpUseCount({ tenant_id: joinCode.tenant_id, id: joinCode.id }, trx);
      if (!counted) throw new NotFoundError(JOIN_REFUSAL);

      const personId = await this.findOrCreateJoiner({ joinCode, input, email, sms }, trx);
      const volunteer = await this.volunteersRepo.ensureForPerson(
        { tenant_id: joinCode.tenant_id, person_id: personId, created_by: joinCode.created_by },
        trx,
      );
      // A previously-revoked volunteer does not get back in by scanning a poster.
      if (volunteer.status === 'revoked') throw new NotFoundError(JOIN_REFUSAL);

      await this.volunteersRepo.setVerifyCode(
        {
          tenant_id: joinCode.tenant_id,
          id: volunteer.id,
          code_hash: hashVerificationCode(volunteer.id, verifyCode),
          expires_at: new Date(Date.now() + CODE_TTL_MS),
          channel,
        },
        trx,
      );
      await this.volunteersRepo.setJoinClaim(
        {
          tenant_id: joinCode.tenant_id,
          id: volunteer.id,
          claim_hash: hashToken(claim),
          expires_at: new Date(Date.now() + JOIN_CLAIM_TTL_MS),
          join_code_id: joinCode.id,
          user_id: joinCode.created_by,
        },
        trx,
      );

      if (channel === 'email') {
        await this.mailService.enqueueMail(
          {
            to: destination,
            subject: `Your ${orgName} verification code`,
            text: `Your verification code is ${verifyCode}. It expires in 10 minutes. If you didn't request this, ignore this message.`,
            html: `<h2>Verify it's you</h2><p>Enter this code on the volunteer page to continue. It expires in 10 minutes.</p><div class="otp-container"><span class="otp-code">${verifyCode}</span></div><p class="warning">If you didn't request this code, you can ignore this message.</p>`,
            tenant_id: joinCode.tenant_id,
          },
          trx,
        );
      } else {
        await this.smsService.enqueueSms(
          {
            to: destination,
            body: `${orgName} code: ${verifyCode}. Expires in 10 minutes.`,
            tenant_id: joinCode.tenant_id,
          },
          trx,
        );
      }
    });

    return { masked: channel === 'email' ? maskEmail(destination) : maskPhone(destination), channel, claim };
  }

  // ------------------------------------------------------- approve by text --

  /** GET /api/companion/approve/:token — who is asking, so the admin knows what they're deciding. */
  public async getApprovalRequest(token: string): Promise<CompanionApprovalPayload> {
    const approval = await this.approvalTokensRepo.resolveByToken(token);
    if (!approval || approval.expires_at < new Date()) return { state: 'dead' };

    const volunteer = await this.volunteersRepo.findById({
      tenant_id: approval.tenant_id,
      id: approval.volunteer_id,
    });
    if (!volunteer) return { state: 'dead' };

    const person = await this.personContacts(approval.tenant_id, volunteer.person_id);
    const base = {
      volunteerName: person?.first_name ?? 'A volunteer',
      volunteerContact: person?.email ? maskEmail(person.email) : person?.sms ? maskPhone(person.sms) : undefined,
      organizationName: await publicOrgName(approval.tenant_id),
      joiningLabel: await this.volunteerJoiningLabel(approval.tenant_id, volunteer),
    };

    // Decided already — by this admin, by another, or in the CRM. Say who and when
    // rather than showing a dead end to someone who did nothing wrong.
    if (approval.used_at || volunteer.status === 'approved' || volunteer.status === 'revoked') {
      return {
        ...base,
        state: 'decided',
        decision: volunteer.status === 'approved' ? 'approved' : 'revoked',
        decidedByName: await this.approverName(approval.tenant_id, volunteer.id),
        decidedAt: approval.used_at?.toISOString(),
      };
    }

    return { ...base, state: 'pending', requestedAt: volunteer.verified_at?.toISOString() };
  }

  /**
   * POST /api/companion/approve/:token — the tap.
   *
   * Delegates to the same `approveVolunteer` / `revokeVolunteer` the CRM calls, so
   * activity logging, session revocation and the join-code turf placement all live in
   * one place and cannot drift between the two surfaces.
   */
  public async actOnApprovalRequest(token: string, decision: 'approve' | 'decline'): Promise<CompanionApprovalPayload> {
    const approval = await this.approvalTokensRepo.resolveByToken(token);
    if (!approval || approval.expires_at < new Date() || approval.used_at) {
      return this.getApprovalRequest(token);
    }

    const volunteer = await this.volunteersRepo.findById({
      tenant_id: approval.tenant_id,
      id: approval.volunteer_id,
    });
    if (!volunteer) return { state: 'dead' };
    // Someone got here first. Report what happened instead of overwriting it.
    if (volunteer.status === 'approved' || volunteer.status === 'revoked') return this.getApprovalRequest(token);

    // The tapping admin is the actor, which is the entire point of minting one token
    // per admin rather than one per volunteer.
    const auth = { tenant_id: approval.tenant_id, user_id: approval.admin_user_id } as IAuthKeyPayload;
    if (decision === 'approve') await this.approveVolunteer(auth, volunteer.id);
    else await this.revokeVolunteer(auth, volunteer.id);
    await this.approvalTokensRepo.markUsedForVolunteer({
      tenant_id: approval.tenant_id,
      volunteer_id: volunteer.id,
    });

    return this.getApprovalRequest(token);
  }

  // ------------------------------------------------------- join code admin --

  public async getJoinCodes(auth: IAuthKeyPayload, campaignId: string | null): Promise<JoinCodeRow[]> {
    const rows = await this.joinCodesRepo.getForCampaign({ tenant_id: auth.tenant_id, campaign_id: campaignId });
    return rows.map((r) => ({ ...r, url: joinUrl(r.code) }));
  }

  public async createJoinCode(auth: IAuthKeyPayload, input: AddJoinCodeType): Promise<JoinCodeRow> {
    const { id } = await this.joinCodesRepo.createCode({
      tenant_id: auth.tenant_id,
      campaign_id: emptyToNull(input.campaign_id),
      turf_id: emptyToNull(input.turf_id),
      label: input.label ?? null,
      expires_at: toDateOrNull(input.expires_at),
      max_uses: input.max_uses ?? null,
      user_id: auth.user_id,
    });
    await this.activityRepo.log({
      tenant_id: auth.tenant_id,
      user_id: auth.user_id,
      activity: 'create',
      entity: 'campaign_join_codes',
      entity_id: id,
      metadata: { action: 'join_code_created', turf_id: emptyToNull(input.turf_id), message: 'Created a join code' },
    });
    return this.requireJoinCodeRow(auth, id);
  }

  public async updateJoinCode(auth: IAuthKeyPayload, id: string, input: UpdateJoinCodeType): Promise<JoinCodeRow> {
    const existing = await this.joinCodesRepo.findById({ tenant_id: auth.tenant_id, id });
    if (!existing) throw new NotFoundError('Join code not found.');
    await this.joinCodesRepo.setDetails({
      tenant_id: auth.tenant_id,
      id,
      label: input.label ?? existing.label,
      expires_at: input.expires_at === undefined ? existing.expires_at : toDateOrNull(input.expires_at),
      max_uses: input.max_uses === undefined ? existing.max_uses : (input.max_uses ?? null),
      user_id: auth.user_id,
    });
    if (input.status && input.status !== existing.status) {
      await this.joinCodesRepo.setStatus({
        tenant_id: auth.tenant_id,
        id,
        status: input.status,
        user_id: auth.user_id,
      });
    }
    return this.requireJoinCodeRow(auth, id);
  }

  /**
   * Retire a code and mint its replacement with the same settings.
   *
   * Destructive in a way that is invisible from the CRM: any poster, flyer or screenshot
   * carrying the old code stops working the moment this returns. The confirm dialog on
   * the button is what makes that visible — see the Volunteer access page.
   */
  public async rotateJoinCode(auth: IAuthKeyPayload, id: string): Promise<JoinCodeRow> {
    const existing = await this.joinCodesRepo.findById({ tenant_id: auth.tenant_id, id });
    if (!existing) throw new NotFoundError('Join code not found.');

    const created = await this.joinCodesRepo.transaction().execute(async (trx) => {
      await this.joinCodesRepo.setStatus(
        { tenant_id: auth.tenant_id, id, status: 'revoked', user_id: auth.user_id },
        trx,
      );
      // The poster and the phone link that was texted alongside it have to die together —
      // otherwise the printed code stops working while the credential handed out with it
      // keeps approving people.
      await this.organizerTokensRepo.revokeForJoinCode({ tenant_id: auth.tenant_id, join_code_id: id }, trx);
      return this.joinCodesRepo.createCode(
        {
          tenant_id: auth.tenant_id,
          campaign_id: existing.campaign_id,
          turf_id: existing.turf_id,
          label: existing.label,
          expires_at: existing.expires_at,
          max_uses: existing.max_uses,
          user_id: auth.user_id,
        },
        trx,
      );
    });

    await this.activityRepo.log({
      tenant_id: auth.tenant_id,
      user_id: auth.user_id,
      activity: 'update',
      entity: 'campaign_join_codes',
      entity_id: created.id,
      metadata: { action: 'join_code_rotated', replaced_id: id, message: 'Rotated a join code' },
    });
    return this.requireJoinCodeRow(auth, created.id);
  }

  public async revokeJoinCode(auth: IAuthKeyPayload, id: string): Promise<void> {
    const existing = await this.joinCodesRepo.findById({ tenant_id: auth.tenant_id, id });
    if (!existing) throw new NotFoundError('Join code not found.');
    await this.joinCodesRepo.transaction().execute(async (trx) => {
      await this.joinCodesRepo.setStatus(
        { tenant_id: auth.tenant_id, id, status: 'revoked', user_id: auth.user_id },
        trx,
      );
      await this.organizerTokensRepo.revokeForJoinCode({ tenant_id: auth.tenant_id, join_code_id: id }, trx);
    });
    await this.activityRepo.log({
      tenant_id: auth.tenant_id,
      user_id: auth.user_id,
      activity: 'update',
      entity: 'campaign_join_codes',
      entity_id: id,
      metadata: { action: 'join_code_revoked', message: 'Revoked a join code' },
    });
  }

  /**
   * The QR bitmap for a code.
   *
   * Returns the module matrix, never an image: the client draws one `<svg>` from it, so
   * nothing renders a binary here, nothing is cached as a file, and the QR scales to a
   * projector without going fuzzy.
   */
  public async joinCodeQr(auth: IAuthKeyPayload, id: string): Promise<JoinCodeQr> {
    const existing = await this.joinCodesRepo.findById({ tenant_id: auth.tenant_id, id });
    if (!existing) throw new NotFoundError('Join code not found.');
    const url = joinUrl(existing.code);
    return { code: existing.code, url, matrix: qrMatrix(url) };
  }

  /**
   * "Send to my phone" — text the caller the organizer link for this code.
   *
   * To *themselves*, never to a number they type: this mints a credential that can approve
   * volunteers, and a free-text destination would turn one admin's session into a way to
   * hand that credential to anyone. The only destination is the mobile already on their own
   * profile.
   *
   * No mobile on file returns `no_mobile` rather than throwing. The admin did nothing wrong,
   * and the useful answer is "add one in Personal settings", which is a sentence on the
   * screen and not a red toast (§3).
   */
  public async sendJoinCodeToPhone(auth: IAuthKeyPayload, id: string): Promise<JoinCodePhoneSendResult> {
    checkRateLimit(`companion-organizer-send:${auth.user_id}`, ORGANIZER_SEND_LIMIT, ORGANIZER_SEND_WINDOW_MS);

    const code = await this.joinCodesRepo.findById({ tenant_id: auth.tenant_id, id });
    if (!code) throw new NotFoundError('Join code not found.');
    if (code.status !== 'active') throw new BadRequestError('That code has been revoked. Create a new one first.');

    const profile = await this.volunteersRepo.db
      .selectFrom('profiles')
      .select('mobile')
      .where('tenant_id', '=', auth.tenant_id)
      .where('auth_id', '=', auth.user_id)
      .executeTakeFirst();
    const to = normalizeE164(profile?.mobile ?? null);
    if (!to) return { status: 'no_mobile' };

    const token = generateToken();
    const orgName = await publicOrgName(auth.tenant_id);
    const label = (await this.joinCodeLabel(code)) ?? orgName;

    await this.volunteersRepo.transaction().execute(async (trx) => {
      await this.organizerTokensRepo.create(
        {
          tenant_id: auth.tenant_id,
          join_code_id: id,
          admin_user_id: auth.user_id,
          token,
          expires_at: new Date(Date.now() + ORGANIZER_TOKEN_TTL_MS),
        },
        trx,
      );
      await this.smsService.enqueueSms(
        {
          to,
          body: `${orgName}: sign-up page for ${label}. ${env.companionUrl}/o/${token}`,
          tenant_id: auth.tenant_id,
        },
        trx,
      );
    });

    await this.activityRepo.log({
      tenant_id: auth.tenant_id,
      user_id: auth.user_id,
      activity: 'update',
      entity: 'campaign_join_codes',
      entity_id: id,
      metadata: { action: 'join_code_sent_to_phone', message: 'Texted themselves the organizer link' },
    });
    return { status: 'sent', masked: maskPhone(to) };
  }

  // -------------------------------------------------- organizer mobile page --

  /**
   * GET /api/companion/organizer/:token — the whole page, polled.
   *
   * The page an organizer actually holds at a launch: the QR big enough to show a room,
   * and the people who have scanned it standing in front of them waiting to be let in.
   * When they are standing right there, texting each approval back and forth is a worse
   * version of a list they could just look at.
   *
   * Everything it can see is scoped to the one join code the token names, so this is
   * strictly narrower than the admin's own Volunteer access page — it cannot show, or
   * decide on, anyone who did not scan this poster.
   */
  public async getOrganizerPage(token: string): Promise<CompanionOrganizerPayload> {
    const resolved = await this.resolveOrganizerToken(token);
    if (!resolved) return { state: 'dead' };
    const { organizer, code } = resolved;

    const [pending, approved] = await Promise.all([
      this.volunteersRepo.getForJoinCode({
        tenant_id: organizer.tenant_id,
        join_code_id: organizer.join_code_id,
        statuses: ['verified'],
      }),
      this.volunteersRepo.getForJoinCode({
        tenant_id: organizer.tenant_id,
        join_code_id: organizer.join_code_id,
        statuses: ['approved'],
      }),
    ]);

    const url = joinUrl(code.code);
    return {
      state: 'live',
      organizationName: await publicOrgName(organizer.tenant_id),
      joiningLabel: await this.joinCodeLabel(code),
      code: code.code,
      url,
      matrix: qrMatrix(url),
      expiresAt: organizer.expires_at.toISOString(),
      approvedCount: approved.length,
      pending: pending.map(
        (v): CompanionOrganizerPending => ({
          volunteer_id: v.id,
          name: `${v.first_name ?? ''} ${v.last_name ?? ''}`.trim() || 'A volunteer',
          contact: v.email ? maskEmail(v.email) : this.maskedMobile(v.mobile),
          requestedAt: v.verified_at?.toISOString(),
        }),
      ),
    };
  }

  /**
   * POST /api/companion/organizer/:token/decide — approve or decline one person, inline.
   *
   * Delegates to the same `approveVolunteer` / `revokeVolunteer` every other surface calls,
   * acting as the admin who minted the link, so turf placement, activity logging and
   * session revocation cannot drift between the CRM, the SMS link and this page.
   *
   * The membership check is the security boundary: a volunteer id that did not come in
   * through THIS code is refused, so guessing ids cannot widen the token's reach.
   */
  public async decideOnOrganizerPage(
    token: string,
    input: CompanionOrganizerDecisionType,
  ): Promise<CompanionOrganizerPayload> {
    const resolved = await this.resolveOrganizerToken(token);
    if (!resolved) return { state: 'dead' };
    const { organizer } = resolved;

    const volunteer = await this.volunteersRepo.findById({
      tenant_id: organizer.tenant_id,
      id: input.volunteer_id,
    });
    if (!volunteer || volunteer.join_code_id !== organizer.join_code_id) {
      throw new NotFoundError('That volunteer is not on this list.');
    }
    // Someone already decided — from the CRM, from an SMS link, or on another phone.
    // Re-rendering the list is the honest answer; it will simply no longer contain them.
    if (volunteer.status === 'approved' || volunteer.status === 'revoked') return this.getOrganizerPage(token);

    const auth = { tenant_id: organizer.tenant_id, user_id: organizer.admin_user_id } as IAuthKeyPayload;
    if (input.decision === 'approve') await this.approveVolunteer(auth, volunteer.id);
    else await this.revokeVolunteer(auth, volunteer.id);

    return this.getOrganizerPage(token);
  }

  // ---------------------------------------------------------------- admin API

  public async getAllVolunteers(tenant_id: string): Promise<CompanionVolunteerRow[]> {
    return this.volunteersRepo.getAllWithPerson(tenant_id);
  }

  public async pendingCount(tenant_id: string): Promise<number> {
    return this.volunteersRepo.pendingCount(tenant_id);
  }

  public async approveVolunteer(auth: IAuthKeyPayload, id: string): Promise<void> {
    const volunteer = await this.volunteersRepo.findById({ tenant_id: auth.tenant_id, id });
    if (!volunteer) throw new NotFoundError('Volunteer not found.');
    await this.volunteersRepo.transaction().execute(async (trx) => {
      await this.volunteersRepo.approve({ tenant_id: auth.tenant_id, id, admin_id: auth.user_id }, trx);
      // A turf-scoped QR promises "scan this and you're walking Maple with us". That
      // promise is kept here rather than at scan time, so a volunteer who is never
      // approved (or is declined) never holds an assignment.
      const placedOn = await this.placeOnJoinCodeTurf(auth, volunteer, trx);
      await this.activityRepo.log(
        {
          tenant_id: auth.tenant_id,
          user_id: auth.user_id,
          activity: 'update',
          entity: 'companion_volunteers',
          entity_id: id,
          metadata: {
            action: 'volunteer_approved',
            message: 'Approved companion app access',
            ...(placedOn ? { turf_id: placedOn, via: 'join code' } : {}),
          },
        },
        trx,
      );
    });
    // Outstanding approve-by-text links for this person are now stale whichever surface
    // decided. Left outside the transaction on purpose: failing to tidy up a spent
    // token must never roll back an approval that already happened.
    await this.approvalTokensRepo.markUsedForVolunteer({ tenant_id: auth.tenant_id, volunteer_id: id });
  }

  /**
   * Pin one volunteer to their assigned turfs, or trust one to roam, without moving the
   * workspace setting. `null` hands them back to whatever the workspace says.
   */
  public async setVolunteerRoam(auth: IAuthKeyPayload, id: string, canRoam: boolean | null): Promise<void> {
    const volunteer = await this.volunteersRepo.findById({ tenant_id: auth.tenant_id, id });
    if (!volunteer) throw new NotFoundError('Volunteer not found.');
    await this.volunteersRepo.transaction().execute(async (trx) => {
      await this.volunteersRepo.setCanRoam(
        { tenant_id: auth.tenant_id, id, can_roam: canRoam, user_id: auth.user_id },
        trx,
      );
      await this.activityRepo.log(
        {
          tenant_id: auth.tenant_id,
          user_id: auth.user_id,
          activity: 'update',
          entity: 'companion_volunteers',
          entity_id: id,
          metadata: {
            action: 'volunteer_roam_changed',
            can_roam: canRoam,
            message:
              canRoam == null
                ? 'Turf access follows the workspace setting'
                : canRoam
                  ? 'Allowed to pick their own turfs'
                  : 'Limited to assigned turfs',
          },
        },
        trx,
      );
    });
  }

  public async revokeVolunteer(auth: IAuthKeyPayload, id: string): Promise<void> {
    const volunteer = await this.volunteersRepo.findById({ tenant_id: auth.tenant_id, id });
    if (!volunteer) throw new NotFoundError('Volunteer not found.');
    await this.volunteersRepo.transaction().execute(async (trx) => {
      await this.volunteersRepo.revoke({ tenant_id: auth.tenant_id, id, admin_id: auth.user_id }, trx);
      await this.sessionsRepo.revokeForVolunteer({ tenant_id: auth.tenant_id, volunteer_id: id }, trx);
      await this.activityRepo.log(
        {
          tenant_id: auth.tenant_id,
          user_id: auth.user_id,
          activity: 'update',
          entity: 'companion_volunteers',
          entity_id: id,
          metadata: { action: 'volunteer_revoked', message: 'Revoked companion app access' },
        },
        trx,
      );
    });
    await this.approvalTokensRepo.markUsedForVolunteer({ tenant_id: auth.tenant_id, volunteer_id: id });
  }

  // ------------------------------------------------------------------ helpers

  /** Resolve either kind of capability token to its tenant + volunteer. */
  public async resolveLink(kind: CompanionLinkKind, token: string): Promise<ResolvedLink | null> {
    if (kind === 'turf') {
      const assignment = await this.turfAssignmentsRepo.resolveByToken(token);
      if (!assignment) return null;
      if (assignment.expires_at && assignment.expires_at < new Date()) return null;
      return {
        tenant_id: assignment.tenant_id,
        volunteer_person_id: assignment.volunteer_person_id,
        organizer_id: assignment.created_by,
      };
    }

    // kind === 'route' — mirrors DeliveriesController.isTokenUsable (uniform
    // dead-link semantics: canceled always fails; missing/past expiry fails only
    // while the workspace enforces link expiry — a live policy, Workspace → App).
    const route = await this.routesRepo.findByTokenHash(hashToken(token));
    if (!route) return null;
    if (String(route.status) === 'canceled') return null;
    if (await volunteerLinksExpire(this.routesRepo.db, String(route.tenant_id))) {
      const exp = route.share_token_expires_at;
      if (!exp || new Date(String(exp)) <= new Date()) return null;
    }
    return {
      tenant_id: String(route.tenant_id),
      volunteer_person_id: route.volunteer_person_id == null ? null : String(route.volunteer_person_id),
      organizer_id: String(route.createdby_id),
    };
  }

  /**
   * What the gate should render for a device session with no link in hand.
   *
   * This is where a QR joiner lives after they are through verification: their turf
   * assignment token is hashed and unrecoverable, so there is no `/t/:token` URL to send
   * them back to. The session is the credential.
   */
  private async accessForSession(sessionToken: string | null): Promise<CompanionAccessPayload> {
    const resolved = await this.sessionVolunteer(sessionToken);
    if (!resolved) return { state: 'dead' };
    const { tenant_id, volunteer } = resolved;
    const person = await this.personContacts(tenant_id, volunteer.person_id);
    const base = {
      volunteerName: person?.first_name ?? undefined,
      organizationName: await publicOrgName(tenant_id),
    };
    return volunteer.status === 'approved' ? { state: 'ready', ...base } : { state: 'pending_approval', ...base };
  }

  /**
   * What the gate should render for a scanned join code.
   *
   * A returning volunteer — someone who already has a session in this organization —
   * skips straight to their real state rather than being asked to introduce themselves
   * again. The tenant check matters: a session from a DIFFERENT organization must not
   * short-circuit this code's flow.
   */
  private async accessForJoin(code: string, sessionToken: string | null): Promise<CompanionAccessPayload> {
    const joinCode = await this.joinCodesRepo.resolveByCode(code);
    if (!joinCode || !this.joinCodeUsable(joinCode)) return { state: 'dead' };

    const shared = {
      organizationName: await publicOrgName(joinCode.tenant_id),
      organizerName: await this.organizerFirstName(joinCode.tenant_id, joinCode.created_by),
      joiningLabel: await this.joinCodeLabel(joinCode),
    };

    const resolved = await this.sessionVolunteer(sessionToken);
    if (resolved && resolved.tenant_id === joinCode.tenant_id) {
      const person = await this.personContacts(resolved.tenant_id, resolved.volunteer.person_id);
      return {
        ...shared,
        volunteerName: person?.first_name ?? undefined,
        state: resolved.volunteer.status === 'approved' ? 'ready' : 'pending_approval',
      };
    }

    return { ...shared, state: 'need_identity' };
  }

  private async approverName(tenant_id: string, volunteerId: string): Promise<string | undefined> {
    const row = await this.volunteersRepo.db
      .selectFrom('companion_volunteers')
      .innerJoin('authusers', (join) =>
        join
          .onRef('authusers.id', '=', 'companion_volunteers.approved_by')
          .onRef('authusers.tenant_id', '=', 'companion_volunteers.tenant_id'),
      )
      .select(['authusers.first_name', 'authusers.last_name'])
      .where('companion_volunteers.tenant_id', '=', tenant_id)
      .where('companion_volunteers.id', '=', volunteerId)
      .executeTakeFirst();
    if (!row?.first_name) return undefined;
    return `${row.first_name} ${row.last_name ?? ''}`.trim();
  }

  private contactsOf(person: PersonContacts): CompanionContact[] {
    const contacts: CompanionContact[] = [];
    if (person.email) contacts.push({ channel: 'email', masked: maskEmail(person.email) });
    if (person.sms) contacts.push({ channel: 'sms', masked: maskPhone(person.sms) });
    return contacts;
  }

  private async findUsableSession(
    sessionToken: string | null,
    tenant_id: string,
    volunteer: CompanionVolunteer | null,
  ): Promise<boolean> {
    if (!sessionToken || !volunteer) return false;
    const session = await this.sessionsRepo.findByTokenHash(hashToken(sessionToken));
    if (!session || session.tenant_id !== tenant_id) return false;
    if (session.volunteer_id !== volunteer.id) return false;
    if (session.revoked_at || session.expires_at < new Date()) return false;
    return true;
  }

  /**
   * Tell the admins someone is waiting — and, for the one who invited them, offer the
   * one-tap version.
   *
   * Fires from `verifyConfirm`, which means it covers BOTH front doors: today's
   * assignment-link path and the QR join path. Extending it once was the whole reason
   * approve-by-text did not need a second code path.
   *
   * An approval token is minted per admin so the eventual `approved_by` records who
   * actually tapped. Only the inviter is texted, and only if they opted in — the rest
   * get the email and bell they always got.
   */
  private async notifyAdminsOfPendingVolunteer(
    link: ResolvedLink,
    volunteerId: string,
    trx: Transaction<Models>,
  ): Promise<void> {
    const person = await this.personContacts(link.tenant_id, String(link.volunteer_person_id));
    const volunteerName = person?.first_name ?? 'A volunteer';
    const admins = await this.volunteersRepo.db
      .selectFrom('authusers')
      .select(['id', 'email', 'first_name'])
      .where('tenant_id', '=', link.tenant_id)
      .where('role', 'in', ['admin', 'owner'])
      .where('deactivated_at', 'is', null)
      .where('deleted_at', 'is', null)
      .execute();
    const approvePath = '/volunteer-access';
    const approveUrl = `${env.appUrl}${approvePath}`;
    const orgName = await publicOrgName(link.tenant_id);
    const expiresAt = new Date(Date.now() + APPROVAL_TOKEN_TTL_MS);

    for (const admin of admins) {
      const approvalToken = generateToken();
      await this.approvalTokensRepo.create(
        {
          tenant_id: link.tenant_id,
          volunteer_id: volunteerId,
          admin_user_id: String(admin.id),
          token: approvalToken,
          expires_at: expiresAt,
        },
        trx,
      );
      if (String(admin.id) === link.organizer_id) {
        await this.textInviterForApproval(
          { tenant_id: link.tenant_id, admin_id: String(admin.id), volunteerName, orgName, token: approvalToken },
          trx,
        );
      }
      await this.mailService.enqueueMail(
        {
          to: admin.email,
          subject: `${volunteerName} is waiting for companion app approval`,
          audience: 'staff',
          text: `${volunteerName} verified their contact and is waiting for approval to use their volunteer link. Approve them at ${approveUrl}`,
          html: `<h2>Volunteer waiting for approval</h2><p>${volunteerName} verified their contact and is waiting for approval to use their volunteer link.</p><div class="btn-container"><a class="btn" href="${approveUrl}">Review in pplCRM</a></div>`,
          tenant_id: link.tenant_id,
        },
        trx,
      );
      // In-app bell notification — links straight to the Volunteer access page.
      await this.notificationsRepo.pushNotification(
        {
          tenant_id: link.tenant_id,
          user_id: String(admin.id),
          title: 'Volunteer waiting for approval',
          message: `${volunteerName} verified their contact and is waiting for approval to use their volunteer link.`,
          type: 'info',
          link: approvePath,
        },
        trx,
      );
    }
  }

  /** A phone we could never text is not a contact worth showing half of. */
  private maskedMobile(mobile: string | null): string | undefined {
    const normalized = normalizeE164(mobile);
    return normalized ? maskPhone(normalized) : undefined;
  }

  /**
   * An organizer link plus the code it names, or null for every reason it might not work.
   *
   * Uniform on purpose: expired, revoked, a code that was rotated out from under it, or a
   * code someone revoked all answer the same 'dead'. This is a URL anyone can hold, so
   * explaining which of those it was tells a stranger about the workspace.
   */
  private async resolveOrganizerToken(
    token: string,
  ): Promise<{ organizer: ResolvedOrganizerToken; code: ResolvedJoinCode } | null> {
    const organizer = await this.organizerTokensRepo.resolveByToken(token);
    if (!organizer || organizer.revoked_at || organizer.expires_at < new Date()) return null;
    const code = await this.joinCodesRepo.findById({
      tenant_id: organizer.tenant_id,
      id: organizer.join_code_id,
    });
    if (!code || code.status !== 'active') return null;
    return { organizer, code };
  }

  /** Re-read a code as the admin list shows it, so create/update/rotate all answer the same shape. */
  private async requireJoinCodeRow(auth: IAuthKeyPayload, id: string): Promise<JoinCodeRow> {
    const code = await this.joinCodesRepo.findById({ tenant_id: auth.tenant_id, id });
    if (!code) throw new NotFoundError('Join code not found.');
    const rows = await this.getJoinCodes(auth, code.campaign_id);
    const row = rows.find((r) => r.id === id);
    if (!row) throw new NotFoundError('Join code not found.');
    return row;
  }

  private async organizerFirstName(tenant_id: string, user_id: string): Promise<string | undefined> {
    const row = await this.volunteersRepo.db
      .selectFrom('authusers')
      .select('first_name')
      .where('tenant_id', '=', tenant_id)
      .where('id', '=', user_id)
      .executeTakeFirst();
    return row?.first_name ?? undefined;
  }

  private async personContacts(tenant_id: string, person_id: string): Promise<PersonContacts | null> {
    const row = await this.volunteersRepo.db
      .selectFrom('persons')
      .select(['first_name', 'email', 'mobile'])
      .where('tenant_id', '=', tenant_id)
      .where('id', '=', person_id)
      .executeTakeFirst();
    if (!row) return null;
    return {
      first_name: row.first_name,
      email: row.email,
      sms: normalizeE164(row.mobile),
    };
  }

  /**
   * Match the scanner to someone already in the rolodex, or create them.
   *
   * Matching first is the whole point: an organizer's existing volunteer who scans the
   * Saturday poster must not become a second copy of themselves. Email matches on the
   * normalized address; mobile matches the raw value OR its E.164 form, because stored
   * numbers were typed by humans and were never normalized on the way in.
   *
   * A created person goes into the tenant's placeholder household (`persons.household_id`
   * is NOT NULL and this is the established answer for someone with no address) and is
   * marked `volunteer_status = 'prospective'` — they show up in the rolodex immediately,
   * and Duplicates can reconcile them later against a record we failed to match.
   */
  private async findOrCreateJoiner(
    input: {
      joinCode: ResolvedJoinCode;
      input: CompanionJoinStartType;
      email: string | null;
      sms: string | null;
    },
    trx: Transaction<Models>,
  ): Promise<string> {
    const { joinCode, email, sms } = input;
    const raw = input.input.mobile?.trim() ?? null;

    let match = trx.selectFrom('persons').select('id').where('tenant_id', '=', joinCode.tenant_id).limit(1);
    match = email
      ? match.where((eb) => eb(eb.fn('lower', ['email']), '=', email))
      : match.where((eb) => eb.or([eb('mobile', '=', sms), ...(raw ? [eb('mobile', '=', raw)] : [])]));
    const existing = await match.executeTakeFirst();
    if (existing?.id != null) return String(existing.id);

    const tenant = await trx
      .selectFrom('tenants')
      .select('placeholder_household_id')
      .where('id', '=', joinCode.tenant_id)
      .executeTakeFirst();
    if (tenant?.placeholder_household_id == null) throw new NotFoundError(JOIN_REFUSAL);

    // The volunteer has no CRM account, so the code's creator is the responsible actor
    // — the same honest-attribution rule synced knocks follow (§22.7).
    return insertPersonWithPublicId(input.input.first_name, input.input.last_name ?? null, async (publicId, slug) => {
      const created = await trx
        .insertInto('persons')
        .values({
          tenant_id: joinCode.tenant_id,
          campaign_id: joinCode.campaign_id,
          household_id: String(tenant.placeholder_household_id),
          first_name: input.input.first_name,
          last_name: input.input.last_name ?? null,
          email,
          mobile: sms,
          volunteer_status: 'prospective',
          public_id: publicId,
          slug,
          createdby_id: joinCode.created_by,
          updatedby_id: joinCode.created_by,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return String(created.id);
    });
  }

  /** A code is usable while it is active, unexpired, and has slots left. */
  private joinCodeUsable(code: ResolvedJoinCode): boolean {
    if (code.status !== 'active') return false;
    if (code.expires_at && code.expires_at < new Date()) return false;
    if (code.max_uses != null && code.use_count >= code.max_uses) return false;
    return true;
  }

  /** "Maple Ward — turf 3" / the campaign name — what the scanner is signing up for. */
  private async joinCodeLabel(code: ResolvedJoinCode): Promise<string | undefined> {
    if (code.turf_id) {
      const turf = await this.volunteersRepo.db
        .selectFrom('turfs')
        .select('name')
        .where('tenant_id', '=', code.tenant_id)
        .where('id', '=', code.turf_id)
        .executeTakeFirst();
      if (turf?.name) return String(turf.name);
    }
    if (code.campaign_id) {
      const campaign = await this.volunteersRepo.db
        .selectFrom('campaigns')
        .select('name')
        .where('tenant_id', '=', code.tenant_id)
        .where('id', '=', code.campaign_id)
        .executeTakeFirst();
      if (campaign?.name) return String(campaign.name);
    }
    return code.label ?? undefined;
  }

  /**
   * Put a newly-approved QR joiner on the turf their code named.
   *
   * Silently does nothing when the code had no turf, the turf is gone or retired, or
   * they are already on it — none of those are reasons to fail an approval. Returns the
   * turf id when a placement happened, so the activity entry can say so.
   */
  private async placeOnJoinCodeTurf(
    auth: IAuthKeyPayload,
    volunteer: CompanionVolunteer,
    trx: Transaction<Models>,
  ): Promise<string | null> {
    if (!volunteer.join_code_id) return null;
    const code = await this.joinCodesRepo.findById({ tenant_id: auth.tenant_id, id: volunteer.join_code_id }, trx);
    if (!code?.turf_id) return null;

    const turf = await trx
      .selectFrom('turfs')
      .select(['id', 'status', 'campaign_id'])
      .where('tenant_id', '=', auth.tenant_id)
      .where('id', '=', code.turf_id)
      .executeTakeFirst();
    if (!turf || String(turf.status) === 'retired') return null;

    const existing = await this.turfAssignmentsRepo.findActiveForVolunteer(
      { tenant_id: auth.tenant_id, turf_id: code.turf_id, volunteer_person_id: volunteer.person_id },
      trx,
    );
    if (existing) return code.turf_id;

    await this.turfAssignmentsRepo.create(
      {
        tenant_id: auth.tenant_id,
        turf_id: code.turf_id,
        team_id: null,
        token: generateTurfToken(),
        user_id: auth.user_id,
        volunteer_person_id: volunteer.person_id,
        expires_at: await turfAssignmentExpiry(trx, auth.tenant_id, String(turf.campaign_id ?? '')),
      },
      trx,
    );
    // No link is sent: they are already holding the app that this approval opens.
    return code.turf_id;
  }

  /**
   * On the join path the credential is the one-shot claim minted by `joinStart`, not
   * the join code itself — the code names an organization, the claim names a person.
   * Everything downstream (rate limits, code TTL, session minting) is identical.
   */
  private async resolveVerifySubject(kind: CompanionVerifyKind, token: string): Promise<ResolvedLink | null> {
    if (kind !== 'join') return this.resolveLink(kind, token);

    const volunteer = await this.volunteersRepo.findByJoinClaim(hashToken(token));
    if (!volunteer || volunteer.status === 'revoked') return null;
    const code = volunteer.join_code_id
      ? await this.joinCodesRepo.findById({ tenant_id: volunteer.tenant_id, id: volunteer.join_code_id })
      : null;
    if (!code) return null;
    return {
      tenant_id: volunteer.tenant_id,
      volunteer_person_id: volunteer.person_id,
      organizer_id: code.created_by,
    };
  }

  /** The session → volunteer lookup shared by the two link-free access states. */
  private async sessionVolunteer(
    sessionToken: string | null,
  ): Promise<{ tenant_id: string; volunteer: CompanionVolunteer } | null> {
    if (!sessionToken) return null;
    const session = await this.sessionsRepo.findByTokenHash(hashToken(sessionToken));
    if (!session || session.revoked_at || session.expires_at < new Date()) return null;
    const volunteer = await this.volunteersRepo.findById({
      tenant_id: session.tenant_id,
      id: session.volunteer_id,
    });
    if (!volunteer || volunteer.status === 'revoked') return null;
    return { tenant_id: session.tenant_id, volunteer };
  }

  /**
   * The one-tap approval SMS, sent to the admin who invited this volunteer unless they
   * turned `companion_approval_sms` off. Opt-out like every other preference: a volunteer
   * blocked at a door is the costlier failure, so this defaults on.
   *
   * No mobile on file, or opted out, is not an error: the email and bell notification
   * went out regardless, so there is nothing to recover from.
   */
  private async textInviterForApproval(
    input: { tenant_id: string; admin_id: string; volunteerName: string; orgName: string; token: string },
    trx: Transaction<Models>,
  ): Promise<void> {
    const profile = await this.volunteersRepo.db
      .selectFrom('profiles')
      .select(['mobile', 'preferences'])
      .where('tenant_id', '=', input.tenant_id)
      .where('auth_id', '=', input.admin_id)
      .executeTakeFirst();
    if (!profile) return;
    if (!notificationEnabled(profile.preferences, 'companion_approval_sms')) return;
    const to = normalizeE164(profile.mobile);
    if (!to) return;

    await this.smsService.enqueueSms(
      {
        to,
        body: `${input.orgName}: ${input.volunteerName} wants to help. Approve: ${env.companionUrl}/a/${input.token}`,
        tenant_id: input.tenant_id,
      },
      trx,
    );
  }

  /** What a volunteer joined through, for the approval screen. */
  private async volunteerJoiningLabel(tenant_id: string, volunteer: CompanionVolunteer): Promise<string | undefined> {
    if (!volunteer.join_code_id) return undefined;
    const code = await this.joinCodesRepo.findById({ tenant_id, id: volunteer.join_code_id });
    return code ? this.joinCodeLabel(code) : undefined;
  }
}
