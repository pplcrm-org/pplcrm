import { randomInt } from 'node:crypto';

import type { Transaction } from 'kysely';

import { hashVerificationCode, verificationCodeMatches } from './verification-code-hash';
import { checkDurableRateLimit } from '../../lib/durable-rate-limiter';

import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import type {
  CompanionAccessPayload,
  CompanionContact,
  CompanionLinkKind,
  CompanionVerifyChannel,
  CompanionVerifyConfirmResult,
  CompanionVolunteerRow,
  IAuthKeyPayload,
} from '../../../../../../libs/common/src';
import { BadRequestError, ForbiddenError, NotFoundError, UnauthorizedError } from '../../errors/app-errors';
import { publicOrgName } from '../../lib/public-tenant';
import { checkRateLimit } from '../../lib/rate-limiter';
import { TransactionalEmailService } from '../../lib/mail/transactional-mail.service';
import { SmsService } from '../../lib/sms/sms.service';
import { maskEmail, maskPhone, normalizeE164 } from '../../lib/sms/phone';
import { generateToken, hashToken } from '../../lib/token-hash';
import { UserActivityRepo } from '../../lib/user-activity.repo';
import { volunteerLinksExpire } from '../../lib/volunteer-link-policy';
import { env } from '../../../env';
import { TurfAssignmentsRepo } from '../canvassing/repositories/turf-assignments.repo';
import { DeliveryRoutesRepo } from '../deliveries/repositories/delivery-routes.repo';
import { NotificationsRepo } from '../notifications/repositories/notifications.repo';
import { CompanionSessionsRepo } from './repositories/companion-sessions.repo';
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
  private mailService = new TransactionalEmailService({ defaultAudience: 'account' });
  private notificationsRepo = new NotificationsRepo();
  private routesRepo = new DeliveryRoutesRepo();
  private sessionsRepo = new CompanionSessionsRepo();
  private smsService = new SmsService();
  private turfAssignmentsRepo = new TurfAssignmentsRepo();
  private volunteersRepo = new CompanionVolunteersRepo();

  /** GET /api/companion/access — tell the gate UI what to render. */
  public async getAccess(
    kind: CompanionLinkKind,
    token: string,
    sessionToken: string | null,
  ): Promise<CompanionAccessPayload> {
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
    kind: CompanionLinkKind,
    token: string,
    channel: CompanionVerifyChannel,
  ): Promise<{ masked: string }> {
    checkRateLimit(`companion-verify-start:${token}`, VERIFY_START_LIMIT, VERIFY_START_WINDOW_MS);

    const link = await this.resolveLink(kind, token);
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
    kind: CompanionLinkKind,
    token: string,
    code: string,
    userAgent: string | null,
  ): Promise<CompanionVerifyConfirmResult> {
    checkRateLimit(`companion-verify-confirm:${token}`, VERIFY_CONFIRM_LIMIT, VERIFY_CONFIRM_WINDOW_MS);

    const link = await this.resolveLink(kind, token);
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
        await this.notifyAdminsOfPendingVolunteer(link, trx);
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

    return {
      tenant_id: session.tenant_id,
      volunteer_id: volunteer.id,
      person_id: volunteer.person_id,
      can_roam: volunteer.can_roam ?? null,
    };
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
      await this.activityRepo.log(
        {
          tenant_id: auth.tenant_id,
          user_id: auth.user_id,
          activity: 'update',
          entity: 'companion_volunteers',
          entity_id: id,
          metadata: { action: 'volunteer_approved', message: 'Approved companion app access' },
        },
        trx,
      );
    });
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

  private async notifyAdminsOfPendingVolunteer(link: ResolvedLink, trx: Transaction<Models>): Promise<void> {
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
    for (const admin of admins) {
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
}
