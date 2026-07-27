import { TRPCError } from '@trpc/server';
import { createSigner, createVerifier } from 'fast-jwt';
import type { IAuthKeyPayload, SettingsEntryType } from '../../../../../../libs/common/src';
import { env } from '../../../env';

interface VerifiedDomainEntry {
  domain: string;
  domainAuthId?: string | number;
  linkBrandingId?: string | number;
  /** The label the click-tracking CNAME lives at (`<linkSubdomain>.<domain>`). Stored because
   * `email` is only the default — a collision forces a different one, and the DNS checklist and
   * every later re-verify have to point at the label actually in use. */
  linkSubdomain?: string;
  spf?: boolean;
  dkim?: boolean;
  dmarc?: boolean;
  linkBranded?: boolean;
  status?: string;
  domainAuthDns?: Record<string, { valid?: boolean; host?: string; data?: string } | undefined>;
  linkBrandingDns?: Record<string, { valid?: boolean; host?: string; data?: string } | undefined>;
  /** Platform-key mode only: whether the parent-level records were associated with the
   * subuser the tenant sends through. Retried on verify until true — subuser sends are
   * unsigned without it. */
  subuserAssociated?: boolean;
}

import { randomInt, timingSafeEqual } from 'crypto';

import { BaseController } from '../../lib/base.controller';
import { BadRequestError, ConflictError, TooManyRequestsError } from '../../errors/app-errors';
import { SendGridWhitelabelService } from '../../lib/mail/sendgrid-whitelabel.service';
import { TransactionalEmailService } from '../../lib/mail/transactional-mail.service';
import { checkRateLimit } from '../../lib/rate-limiter';
import { maskPhone, normalizeE164 } from '../../lib/sms/phone';
import { SmsService } from '../../lib/sms/sms.service';
import { hashToken } from '../../lib/token-hash';
import {
  isOwnSharedSendingAddress,
  isSharedSendingAddress,
  sharedSendingAddressFor,
} from '../../lib/mail/shared-sending-domain';
import { phoneVerificationRequired } from '../newsletters/send-guards';
import { DEFAULT_LINK_SUBDOMAIN, getPlanDef, isValidDnsLabel, normalizeDnsLabel } from '@common';
import { assertPlanSelected } from '../demo/demo-guard';
import { DEMO_MANIFEST_SETTINGS_KEY } from '../demo/demo-seed';
import { STRIPE_ACCOUNT_ID_KEY, STRIPE_ACCOUNT_STATUS_KEY } from '../donations/stripe-connect';

/** Server-managed settings keys that must never be written via the public upsert: the
 * verified sender/domain lists back the newsletter send guards, the Stripe Connect account
 * id/status back the donations fail-closed gate, and the demo manifest drives demo-data
 * deletion. A direct write to any of them is a guard bypass or data corruption. */
/** Read-only key the snapshot derives (tenant slug + platform domain); never a stored row. */
export const PLATFORM_FROM_EMAIL_KEY = 'communications.platform_from_email';

const SERVER_MANAGED_SETTINGS_MESSAGES: Record<string, string> = {
  'communications.verified_emails': 'Verified emails list cannot be modified directly.',
  [PLATFORM_FROM_EMAIL_KEY]: 'Your pplCRM sending address is assigned automatically.',
  'communications.verified_domains': 'Verified domains list cannot be modified directly.',
  [STRIPE_ACCOUNT_ID_KEY]: 'Stripe connection settings cannot be modified directly.',
  [STRIPE_ACCOUNT_STATUS_KEY]: 'Stripe connection settings cannot be modified directly.',
  [DEMO_MANIFEST_SETTINGS_KEY]: 'This setting is managed by pplCRM and cannot be modified directly.',
};
import { SettingsRepo } from './repositories/settings.repo';

const PHONE_CODE_TTL_MS = 10 * 60 * 1000;
const PHONE_CODE_MAX_ATTEMPTS = 5;

// Rate limiting in-memory storage to prevent verification spam/abuse
const verificationRequestTimestamps = new Map<string, number>(); // key: `${tenant_id}:${email}`, value: timestamp
const tenantVerificationTimestamps = new Map<string, number[]>(); // key: tenant_id, value: array of timestamps
const domainVerificationTimestamps = new Map<string, number>(); // key: `${tenant_id}:${domain}`, value: timestamp
const tenantDomainVerificationTimestamps = new Map<string, number[]>(); // key: tenant_id, value: array of timestamps

/** Postgres unique-violation, narrowed without asserting a shape onto an unknown catch binding. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === '23505';
}

export class SettingsController extends BaseController<'settings', SettingsRepo> {
  private mailService = new TransactionalEmailService();

  constructor() {
    super(new SettingsRepo());
  }

  public async getCurrentCampaignId(auth: IAuthKeyPayload) {
    const row = await this.getRepo().getByKey({
      tenant_id: auth.tenant_id,
      key: 'current_campaign',
    });

    if (!row) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Current campaign setting not found.',
      });
    }

    const value = row.value;

    if (typeof value === 'number' || typeof value === 'string') {
      return String(value);
    }

    if (value && typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
      const id = (value as Record<string, unknown>)['id'];
      if (typeof id === 'number' || typeof id === 'string') {
        return String(id);
      }
    }

    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Current campaign setting is malformed.',
    });
  }

  public async getSnapshot(auth: IAuthKeyPayload) {
    const rows = await this.getRepo().getAllForTenant(auth.tenant_id);

    const snapshot = rows.reduce<Record<string, unknown>>((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {});

    // Derived, not stored: this tenant's address on the platform sending domain. It comes from the
    // tenant slug plus server config, neither of which the client can see, and it has to appear
    // alongside the verified addresses so the From picker can offer exactly what the save
    // validation and the send guard will accept. Null when the feature is off.
    const tenant = await this.getRepo()
      .db.selectFrom('tenants')
      .select('slug')
      .where('id', '=', auth.tenant_id)
      .executeTakeFirst();
    snapshot[PLATFORM_FROM_EMAIL_KEY] = sharedSendingAddressFor(tenant?.slug ?? null);

    return snapshot;
  }

  public async upsert(auth: IAuthKeyPayload, entries: SettingsEntryType[]) {
    // 1. Block direct updates to server-managed keys (SERVER_MANAGED_SETTINGS_MESSAGES).
    //    Ordinary workspace settings are deliberately NOT demo-gated — the demo guard covers
    //    only outward-facing actions (verification, sync, sending, invites, Stripe Connect).
    for (const entry of entries) {
      const blockedMessage = SERVER_MANAGED_SETTINGS_MESSAGES[entry.key];
      if (blockedMessage) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: blockedMessage });
      }
    }

    // 2. Validate default from and reply-to emails
    const defaultFromEntry = entries.find((e) => e.key === 'communications.default_from_email');
    const replyToEntry = entries.find((e) => e.key === 'communications.reply_to');

    if (defaultFromEntry || replyToEntry) {
      const snapshot = await this.getSnapshot(auth);
      const verifiedEmailsRaw = snapshot['communications.verified_emails'];
      const verifiedEmails = Array.isArray(verifiedEmailsRaw)
        ? verifiedEmailsRaw.map((e) => String(e).toLowerCase().trim())
        : [];

      if (defaultFromEntry && typeof defaultFromEntry.value === 'string') {
        const val = defaultFromEntry.value.toLowerCase().trim();
        // Mirror the send guard (hasVerifiedSendingDomain) exactly, rather than the weaker
        // "is it in verified_emails" test this used to apply. Single-sender verification proves
        // the address is yours; it does NOT make bulk mail from it deliverable, because DMARC
        // aligns on the DOMAIN. Accepting a verified Gmail here produced the worst possible
        // shape: configured, verified, and then refused at the moment of sending. Refuse it at
        // the point of choice instead, and name both real ways forward.
        if (val && !(await this.isSendableFromAddress(auth.tenant_id, val, snapshot))) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: isSharedSendingAddress(val)
              ? 'That pplCRM sending address belongs to another workspace.'
              : `Bulk email can only be sent from a domain you have verified, or from your own pplCRM sending address. Verify ${val.split('@')[1] ?? 'that domain'} under Domains, or choose your pplCRM address and set this one as your Reply-to.`,
          });
        }
      }

      if (replyToEntry && typeof replyToEntry.value === 'string') {
        const val = replyToEntry.value.toLowerCase().trim();
        if (val && !verifiedEmails.includes(val)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Email address must be verified before it can be configured as a Reply-to Email.',
          });
        }
      }
    }

    await this.getRepo().upsertMany({
      tenant_id: auth.tenant_id,
      user_id: auth.user_id,
      entries: entries.map((entry) => ({
        key: entry.key,
        value: entry.value,
      })),
    });

    return this.getSnapshot(auth);
  }

  /**
   * Whether `email` is this tenant's own address on the platform sending domain. Compared against
   * the tenant's slug rather than just the domain: the domain is shared, so a domain-only check
   * would let any tenant send as any other.
   */
  private async isOwnPlatformAddress(tenant_id: string, email: string): Promise<boolean> {
    if (!isSharedSendingAddress(email)) return false;
    const tenant = await this.getRepo()
      .db.selectFrom('tenants')
      .select('slug')
      .where('id', '=', tenant_id)
      .executeTakeFirst();
    return isOwnSharedSendingAddress(email, tenant?.slug ?? null);
  }

  /**
   * The same test the pre-send gate applies: an address is usable as the default From only if its
   * domain is DKIM-verified for this tenant, or it is this tenant's own platform address. Keeping
   * the two in sync is the point — a From address that saves but cannot send is a trap.
   */
  private async isSendableFromAddress(
    tenant_id: string,
    email: string,
    snapshot: Record<string, unknown>,
  ): Promise<boolean> {
    if (await this.isOwnPlatformAddress(tenant_id, email)) return true;

    const domain = email.split('@')[1];
    if (!domain) return false;

    const raw = snapshot['communications.verified_domains'];
    const domains = Array.isArray(raw) ? (raw as { domain?: string; status?: string }[]) : [];
    return domains.some((d) => d.domain?.toLowerCase().trim() === domain && d.status === 'verified');
  }

  /**
   * Sending-phone verification (anti-abuse): Free-plan tenants must verify a mobile number by
   * SMS before their first newsletter send (send-guards enforces it). One number per tenant;
   * the 6-digit code is stored hashed on the tenant row — never in settings, whose snapshot is
   * client-readable.
   */
  public async getPhoneVerificationStatus(auth: IAuthKeyPayload) {
    const tenant = await this.getRepo()
      .db.selectFrom('tenants')
      .select(['sending_phone', 'sending_phone_verified_at', 'pending_phone', 'subscription_plan'])
      .where('id', '=', auth.tenant_id)
      .executeTakeFirst();
    return {
      verified: tenant?.sending_phone_verified_at != null,
      verifiedAt: tenant?.sending_phone_verified_at ?? null,
      phone: tenant?.sending_phone ? maskPhone(tenant.sending_phone) : null,
      pendingPhone: tenant?.pending_phone ? maskPhone(tenant.pending_phone) : null,
      // Whether a send is gated on it. Shares the send guard's predicate rather than restating
      // the rule, so the settings page can never disagree with what sending actually enforces.
      required: phoneVerificationRequired(),
    };
  }

  public async requestPhoneVerification(auth: IAuthKeyPayload, phone: string) {
    await assertPlanSelected(this.getRepo().db, auth.tenant_id);
    const normalized = normalizeE164(phone);
    if (!normalized) {
      throw new BadRequestError('Enter a valid mobile number, including the country code for non-US numbers.');
    }
    // Throttle per tenant (code farming) and per destination number (SMS-bombing a victim).
    checkRateLimit(`phoneVerifyRequest:${auth.tenant_id}`, 3, 60 * 60 * 1000);
    checkRateLimit(`phoneVerifyRequest:${normalized}`, 3, 60 * 60 * 1000);

    const code = String(randomInt(100000, 1000000));
    const smsService = new SmsService();
    await this.getRepo()
      .transaction()
      .execute(async (trx) => {
        await trx
          .updateTable('tenants')
          .set({
            pending_phone: normalized,
            phone_verification_code_hash: hashToken(code),
            phone_verification_expires_at: new Date(Date.now() + PHONE_CODE_TTL_MS),
            phone_verification_attempts: 0,
          })
          .where('id', '=', auth.tenant_id)
          .execute();
        await smsService.enqueueSms(
          {
            to: normalized,
            body: `Your pplCRM verification code is ${code}. It expires in 10 minutes.`,
            tenant_id: auth.tenant_id,
          },
          trx,
        );
      });

    return { success: true, phone: maskPhone(normalized) };
  }

  public async confirmPhoneVerification(auth: IAuthKeyPayload, code: string) {
    checkRateLimit(`phoneVerifyConfirm:${auth.tenant_id}`, 10, 15 * 60 * 1000);
    const db = this.getRepo().db;
    const tenant = await db
      .selectFrom('tenants')
      .select([
        'pending_phone',
        'phone_verification_code_hash',
        'phone_verification_expires_at',
        'phone_verification_attempts',
      ])
      .where('id', '=', auth.tenant_id)
      .executeTakeFirst();

    if (!tenant?.pending_phone || !tenant.phone_verification_code_hash) {
      throw new BadRequestError('No phone verification is in progress. Request a new code first.');
    }
    if (Number(tenant.phone_verification_attempts) >= PHONE_CODE_MAX_ATTEMPTS) {
      throw new TooManyRequestsError('Too many incorrect codes. Request a new code and try again.');
    }
    const expiresAt = tenant.phone_verification_expires_at ? new Date(tenant.phone_verification_expires_at) : null;
    if (!expiresAt || expiresAt.getTime() < Date.now()) {
      throw new BadRequestError('That code has expired. Request a new one.');
    }

    const expected = Buffer.from(tenant.phone_verification_code_hash, 'hex');
    const actual = Buffer.from(hashToken(code.trim()), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      await db
        .updateTable('tenants')
        .set((eb) => ({ phone_verification_attempts: eb('phone_verification_attempts', '+', 1) }))
        .where('id', '=', auth.tenant_id)
        .execute();
      throw new BadRequestError('Incorrect code. Check the SMS and try again.');
    }

    await db
      .updateTable('tenants')
      .set({
        sending_phone: tenant.pending_phone,
        sending_phone_verified_at: new Date(),
        pending_phone: null,
        phone_verification_code_hash: null,
        phone_verification_expires_at: null,
        phone_verification_attempts: 0,
      })
      .where('id', '=', auth.tenant_id)
      .execute();

    await this.userActivity.log({
      tenant_id: auth.tenant_id,
      user_id: auth.user_id,
      activity: 'update',
      entity: 'settings',
      metadata: { action: 'sending_phone_verified', phone: maskPhone(tenant.pending_phone) },
    });

    return { success: true, phone: maskPhone(tenant.pending_phone) };
  }

  public async requestEmailVerification(auth: IAuthKeyPayload, email: string) {
    await assertPlanSelected(this.getRepo().db, auth.tenant_id);
    const normalized = email.toLowerCase().trim();
    const rateLimitKey = `${auth.tenant_id}:${normalized}`;
    const now = Date.now();

    // 1. Per-email verification limit: max once per minute
    const lastRequest = verificationRequestTimestamps.get(rateLimitKey);
    if (lastRequest && now - lastRequest < 60000) {
      const remainingSeconds = Math.ceil((60000 - (now - lastRequest)) / 1000);
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: `Please wait ${remainingSeconds} seconds before requesting verification again for this email.`,
      });
    }

    // 2. Tenant-wide verification limit: max 5 requests per minute
    let tenantRequests = tenantVerificationTimestamps.get(auth.tenant_id) || [];
    tenantRequests = tenantRequests.filter((t) => now - t < 60000);
    if (tenantRequests.length >= 5) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message:
          'Rate limit exceeded. You can only request up to 5 verification emails per minute across your campaign.',
      });
    }

    const key = process.env['SHARED_SECRET'] || env.sharedSecret;
    if (!key) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Server misconfiguration: SHARED_SECRET is missing.',
      });
    }

    const signer = createSigner({
      algorithm: 'HS256',
      key,
      expiresIn: '24h',
    });

    const token = signer({
      tenant_id: auth.tenant_id,
      email: normalized,
      purpose: 'verify-sender-email',
    });

    const verificationLink = `${env.appUrl}/verify-sender-email?token=${token}`;

    await this.mailService.enqueueMail({
      to: normalized,
      tenant_id: auth.tenant_id,
      subject: 'Verify your sender email address',
      text: `Hi,\n\nWe need to verify this email address before your pplCRM campaign can send from it. Verify it using this link: ${verificationLink}\n\nThis link expires in 24 hours.`,
      html: `<h2>Verify your sender email address</h2>
<p>We need to verify this email address before your pplCRM campaign can send from it. Click the button below to verify it:</p>
<div class="btn-container">
  <a href="${verificationLink}" class="btn">Verify sender email</a>
</div>
<p class="warning">For security, this link expires in 24 hours.</p>`,
    });

    // Record timestamps if successful
    tenantRequests.push(now);
    tenantVerificationTimestamps.set(auth.tenant_id, tenantRequests);
    verificationRequestTimestamps.set(rateLimitKey, now);

    return { success: true };
  }

  public async verifySenderEmail(token: string) {
    const key = process.env['SHARED_SECRET'] || env.sharedSecret;
    if (!key) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Server misconfiguration: SHARED_SECRET is missing.',
      });
    }

    const verifier = createVerifier({
      algorithms: ['HS256'],
      key,
      ignoreExpiration: false,
    });

    try {
      const payload = await verifier(token);
      if (!payload || payload.purpose !== 'verify-sender-email' || !payload.tenant_id || !payload.email) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid verification token.',
        });
      }

      const tenantId = String(payload.tenant_id);
      const email = String(payload.email).toLowerCase().trim();

      const row = await this.getRepo().getByKey({
        tenant_id: tenantId,
        key: 'communications.verified_emails',
      });

      let currentList: string[] = [];
      if (row && Array.isArray(row.value)) {
        currentList = row.value.map((e) => String(e).toLowerCase().trim());
      }

      if (!currentList.includes(email)) {
        currentList.push(email);

        const tenant = await this.getRepo()
          .db.selectFrom('tenants')
          .select('admin_id')
          .where('id', '=', tenantId)
          .executeTakeFirst();
        const adminId = tenant?.admin_id ? String(tenant.admin_id) : '1';

        await this.getRepo().upsertMany({
          tenant_id: tenantId,
          user_id: adminId,
          entries: [{ key: 'communications.verified_emails', value: currentList }],
        });
      }

      return { success: true, email };
    } catch (err) {
      if (err instanceof TRPCError) throw err;
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Invalid or expired verification token.',
      });
    }
  }

  public async scheduleTenantDeletion(auth: IAuthKeyPayload) {
    const tenant = await this.getRepo()
      .db.selectFrom('tenants')
      .selectAll()
      .where('id', '=', auth.tenant_id)
      .executeTakeFirst();
    if (!tenant) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Tenant not found.',
      });
    }

    if (String(tenant.admin_id) !== String(auth.user_id)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only the organization administrator can schedule deletion.',
      });
    }

    const deletionDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await this.getRepo()
      .db.updateTable('tenants')
      .set({ deletion_scheduled_at: deletionDate })
      .where('id', '=', auth.tenant_id)
      .execute();

    const admin = await this.getRepo()
      .db.selectFrom('authusers')
      .select(['email', 'first_name'])
      .where('id', '=', auth.user_id)
      .executeTakeFirst();

    if (admin && admin.email) {
      await this.mailService.sendMail({
        to: admin.email,
        tenant_id: auth.tenant_id,
        subject: 'Your organization is scheduled for deletion',
        text: `Hi ${admin.first_name || 'there'},\n\nYour organization ${tenant.name} has been scheduled for deletion on ${deletionDate.toLocaleDateString()}.\n\nTo cancel, open your organization settings: ${env.appUrl}/settings`,
        html: `<h2>Organization scheduled for deletion</h2>
<p>Hi ${admin.first_name || 'there'},</p>
<p>The organization <strong>${tenant.name}</strong> has been scheduled for permanent deletion on <strong>${deletionDate.toLocaleDateString()}</strong>.</p>
<p>All data under this organization, including campaigns, contacts, lists, workflows, and user accounts, will be permanently deleted. To cancel the deletion, click the button below:</p>
<div class="btn-container">
  <a href="${env.appUrl}/settings" class="btn">Open organization settings</a>
</div>
<p class="warning">If you did not schedule this deletion, please contact support immediately.</p>`,
      });
    }

    return { success: true, deletion_scheduled_at: deletionDate };
  }

  public async cancelTenantDeletion(auth: IAuthKeyPayload) {
    const tenant = await this.getRepo()
      .db.selectFrom('tenants')
      .selectAll()
      .where('id', '=', auth.tenant_id)
      .executeTakeFirst();
    if (!tenant) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Tenant not found.',
      });
    }

    if (String(tenant.admin_id) !== String(auth.user_id)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only the organization administrator can cancel deletion.',
      });
    }

    await this.getRepo()
      .db.updateTable('tenants')
      .set({ deletion_scheduled_at: null })
      .where('id', '=', auth.tenant_id)
      .execute();

    const admin = await this.getRepo()
      .db.selectFrom('authusers')
      .select(['email', 'first_name'])
      .where('id', '=', auth.user_id)
      .executeTakeFirst();

    if (admin && admin.email) {
      await this.mailService.sendMail({
        to: admin.email,
        tenant_id: auth.tenant_id,
        subject: 'Your organization deletion was canceled',
        text: `Your request to delete organization ${tenant.name} has been canceled, and your organization is fully restored.`,
        html: `<h2>Organization deletion canceled</h2>
<p>Your request to delete organization <strong>${tenant.name}</strong> has been canceled. Your organization and all associated campaign data are fully restored.</p>`,
      });
    }

    return { success: true };
  }

  /**
   * Resolve the SendGrid credentials the domain-whitelabel operations must run under,
   * mirroring the newsletter send path (lib/jobs/handlers/newsletter.handlers.ts): a
   * tenant-owned API key always wins, with operations running on-behalf-of the tenant's own
   * subuser. Without one, operations run on the PLATFORM key at the parent level — so every
   * tenant, including Free, gets real SendGrid DNS records and real DKIM instead of mock
   * records that can never authenticate their mail. `associateSubuser` is then the subuser
   * the tenant's mail actually flows through (their whitelabel subuser, or the shared
   * free-tier subuser on the Free plan); the created records must be associated with it or
   * subuser sends stay unsigned.
   */
  private async resolveWhitelabelCredentials(tenantId: string): Promise<{
    apiKey: string | undefined;
    subuser: string | undefined;
    associateSubuser: string | undefined;
  }> {
    const db = this.getRepo().db;
    const settingsRows = await db
      .selectFrom('settings')
      .select(['key', 'value'])
      .where('tenant_id', '=', tenantId)
      .where('key', 'in', ['communications.sendgrid_api_key', 'communications.sendgrid_subuser_username'])
      .execute();

    const settingsMap: Record<string, unknown> = {};
    for (const row of settingsRows) {
      settingsMap[row.key] = row.value;
    }

    const rawKey = settingsMap['communications.sendgrid_api_key'];
    const rawSubuser = settingsMap['communications.sendgrid_subuser_username'];
    const ownApiKey = typeof rawKey === 'string' && rawKey.trim() !== '' ? rawKey : undefined;
    const ownSubuser = typeof rawSubuser === 'string' && rawSubuser.trim() !== '' ? rawSubuser : undefined;

    if (ownApiKey) {
      return { apiKey: ownApiKey, subuser: ownSubuser, associateSubuser: undefined };
    }

    const tenant = await db
      .selectFrom('tenants')
      .select(['subscription_plan'])
      .where('id', '=', tenantId)
      .executeTakeFirst();
    const planKey = getPlanDef(tenant?.subscription_plan)?.key ?? 'free';
    const associateSubuser = ownSubuser ?? (planKey === 'free' ? env.sendgridFreeTierSubuser : undefined);

    return { apiKey: env.sendgridApiKey, subuser: undefined, associateSubuser };
  }

  public async addVerifiedDomain(auth: IAuthKeyPayload, domain: string, linkSubdomain?: string) {
    await assertPlanSelected(this.getRepo().db, auth.tenant_id);
    const domainVal = domain.toLowerCase().trim();
    const linkLabel = this.assertLinkSubdomain(linkSubdomain);

    const row = await this.getRepo().getByKey({
      tenant_id: auth.tenant_id,
      key: 'communications.verified_domains',
    });
    const currentList: VerifiedDomainEntry[] = Array.isArray(row?.value)
      ? (row?.value as unknown as VerifiedDomainEntry[])
      : [];

    if (currentList.some((d) => d.domain === domainVal)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'This domain is already added.',
      });
    }

    const creds = await this.resolveWhitelabelCredentials(auth.tenant_id);
    const sendgridSvc = new SendGridWhitelabelService();
    const domainAuth = await sendgridSvc.createDomainAuthentication(domainVal, creds.apiKey, creds.subuser);
    const linkBranding = await sendgridSvc.createLinkBranding(domainVal, creds.apiKey, creds.subuser, linkLabel);

    // Platform-key mode: the records live at the parent level but the tenant's mail is sent
    // on-behalf-of a subuser — associate both with it. Failures are recorded and retried on
    // every verify, and verification never succeeds until the association holds.
    let subuserAssociated = false;
    if (creds.associateSubuser) {
      const domainOk = await sendgridSvc.associateDomainWithSubuser(
        domainAuth.id,
        creds.associateSubuser,
        creds.apiKey,
      );
      const linkOk = await sendgridSvc.associateLinkWithSubuser(linkBranding.id, creds.associateSubuser, creds.apiKey);
      subuserAssociated = domainOk && linkOk;
    }

    const newEntry = {
      domain: domainVal,
      status: 'pending',
      spf: false,
      dkim: false,
      dmarc: false,
      domainAuthId: domainAuth.id,
      linkBrandingId: linkBranding.id,
      linkSubdomain: linkBranding.subdomain || linkLabel,
      domainAuthDns: domainAuth.dns,
      linkBrandingDns: linkBranding.dns,
      linkBranded: false,
      ...(creds.associateSubuser ? { subuserAssociated } : {}),
    };

    const updatedList = [...currentList, newEntry];

    await this.getRepo().upsertMany({
      tenant_id: auth.tenant_id,
      user_id: auth.user_id,
      entries: [{ key: 'communications.verified_domains', value: updatedList }],
    });

    return updatedList;
  }

  /** Validates a caller-supplied click-tracking label, falling back to the default. */
  private assertLinkSubdomain(value: string | undefined): string {
    if (value == null || value.trim() === '') return DEFAULT_LINK_SUBDOMAIN;
    const label = normalizeDnsLabel(value);
    if (!isValidDnsLabel(label)) {
      throw new BadRequestError(
        'A link subdomain must be a single DNS label: lowercase letters, numbers and hyphens, ' +
          'not starting or ending with a hyphen.',
      );
    }
    return label;
  }

  /**
   * Move a domain's click-tracking CNAME to a different label.
   *
   * The collision that makes this necessary is usually discovered *after* the domain is added —
   * you find out `email.<domain>` is taken when you go to create the record. Without this the only
   * way out is deleting the whole domain and starting over, which also throws away a
   * possibly-already-validated DKIM setup.
   *
   * Recreates only the link branding: the old SendGrid record is deleted (an abandoned one would
   * keep answering for a host the tenant no longer points at us) and the domain drops back to
   * pending, since the new CNAME cannot be in DNS yet.
   */
  public async setLinkSubdomain(auth: IAuthKeyPayload, domain: string, subdomain: string) {
    await assertPlanSelected(this.getRepo().db, auth.tenant_id);
    const domainVal = domain.toLowerCase().trim();
    const linkLabel = this.assertLinkSubdomain(subdomain);

    const row = await this.getRepo().getByKey({
      tenant_id: auth.tenant_id,
      key: 'communications.verified_domains',
    });
    if (!row || !Array.isArray(row.value)) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Domain configuration not found.' });
    }

    const currentList = row.value as unknown as VerifiedDomainEntry[];
    const domainEntry = currentList.find((d) => d.domain === domainVal);
    if (!domainEntry) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Domain ${domainVal} not found in verified domains list.`,
      });
    }

    const currentLabel = domainEntry.linkSubdomain ?? DEFAULT_LINK_SUBDOMAIN;
    if (currentLabel === linkLabel) {
      return currentList;
    }

    const creds = await this.resolveWhitelabelCredentials(auth.tenant_id);
    const sendgridSvc = new SendGridWhitelabelService();

    const linkBranding = await sendgridSvc.createLinkBranding(domainVal, creds.apiKey, creds.subuser, linkLabel);

    // Only once the replacement exists — a failed create would otherwise leave the tenant with
    // no link branding at all and a domain that can never verify.
    if (domainEntry.linkBrandingId) {
      await sendgridSvc
        .deleteLinkBranding(Number(domainEntry.linkBrandingId), creds.apiKey, creds.subuser)
        .catch(() => undefined);
    }

    let subuserAssociated = domainEntry.subuserAssociated ?? false;
    if (creds.associateSubuser) {
      const linkOk = await sendgridSvc.associateLinkWithSubuser(linkBranding.id, creds.associateSubuser, creds.apiKey);
      subuserAssociated = subuserAssociated && linkOk;
    }

    const updatedList = currentList.map((d) =>
      d.domain === domainVal
        ? {
            ...d,
            linkBrandingId: linkBranding.id,
            linkSubdomain: linkBranding.subdomain || linkLabel,
            linkBrandingDns: linkBranding.dns,
            linkBranded: false,
            status: 'pending',
            ...(creds.associateSubuser ? { subuserAssociated } : {}),
          }
        : d,
    );

    await this.getRepo().upsertMany({
      tenant_id: auth.tenant_id,
      user_id: auth.user_id,
      entries: [{ key: 'communications.verified_domains', value: updatedList }],
    });

    await this.userActivity.log({
      tenant_id: auth.tenant_id,
      user_id: auth.user_id,
      activity: 'update',
      entity: 'settings',
      metadata: { action: 'link_subdomain_changed', domain: domainVal, from: currentLabel, to: linkLabel },
    });

    return updatedList;
  }

  public async verifyVerifiedDomain(auth: IAuthKeyPayload, domain: string) {
    await assertPlanSelected(this.getRepo().db, auth.tenant_id);
    const domainVal = domain.toLowerCase().trim();
    const rateLimitKey = `${auth.tenant_id}:${domainVal}`;
    const now = Date.now();

    // 1. Per-domain verification check limit: max once per minute
    const lastRequest = domainVerificationTimestamps.get(rateLimitKey);
    if (lastRequest && now - lastRequest < 60000) {
      const remainingSeconds = Math.ceil((60000 - (now - lastRequest)) / 1000);
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: `Please wait ${remainingSeconds} seconds before verifying this domain again.`,
      });
    }

    // 2. Tenant-wide domain verification limit: max 5 checks per minute
    let tenantRequests = tenantDomainVerificationTimestamps.get(auth.tenant_id) || [];
    tenantRequests = tenantRequests.filter((t) => now - t < 60000);
    if (tenantRequests.length >= 5) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: 'Rate limit exceeded. You can only verify up to 5 domains per minute across your campaign.',
      });
    }

    const row = await this.getRepo().getByKey({
      tenant_id: auth.tenant_id,
      key: 'communications.verified_domains',
    });

    if (!row || !Array.isArray(row.value)) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Domain configuration not found.',
      });
    }

    const currentList = row.value as unknown as VerifiedDomainEntry[];
    const domainEntry = currentList.find((d) => d.domain === domainVal);

    if (!domainEntry) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Domain ${domainVal} not found in verified domains list.`,
      });
    }

    // Record timestamps if validation can proceed
    tenantRequests.push(now);
    tenantDomainVerificationTimestamps.set(auth.tenant_id, tenantRequests);
    domainVerificationTimestamps.set(rateLimitKey, now);

    // Resolve credentials the same way the send path does (tenant key, else platform key).
    const creds = await this.resolveWhitelabelCredentials(auth.tenant_id);
    const apiKey = creds.apiKey;
    const subuser = creds.subuser;
    const hasValidKey = !!apiKey && apiKey.trim().startsWith('SG.') && apiKey.trim().length > 20;

    const sendgridSvc = new SendGridWhitelabelService();

    // Platform-key mode: if the add-time subuser association failed (SendGrid hiccup), retry
    // it here — the domain must not verify while subuser sends would go out unsigned.
    let subuserAssociated = domainEntry.subuserAssociated === true;
    if (hasValidKey && creds.associateSubuser && !subuserAssociated) {
      const domainOk = domainEntry.domainAuthId
        ? await sendgridSvc.associateDomainWithSubuser(Number(domainEntry.domainAuthId), creds.associateSubuser, apiKey)
        : false;
      const linkOk = domainEntry.linkBrandingId
        ? await sendgridSvc.associateLinkWithSubuser(Number(domainEntry.linkBrandingId), creds.associateSubuser, apiKey)
        : false;
      subuserAssociated = domainOk && linkOk;
    }
    // Association is only load-bearing in platform-key mode with a real key; elsewhere the
    // records already live where the mail is sent from.
    const subuserOk = !hasValidKey || !creds.associateSubuser || subuserAssociated;

    let spfVerified = false;
    let dkimVerified = false;
    let linkBranded = false;
    let dmarcVerified = false;

    // Check with SendGrid if IDs are present
    if (domainEntry.domainAuthId) {
      const authRes = await sendgridSvc.validateDomainAuthentication(Number(domainEntry.domainAuthId), apiKey, subuser);
      spfVerified = !!authRes.validationResults?.['mail_cname'];
      dkimVerified = !!authRes.validationResults?.['dkim1'] && !!authRes.validationResults?.['dkim2'];
    }

    if (domainEntry.linkBrandingId) {
      linkBranded = await sendgridSvc.validateLinkBranding(Number(domainEntry.linkBrandingId), apiKey, subuser);
    }

    // Check DMARC via live DNS check
    dmarcVerified = await sendgridSvc.verifyDmarc(domainVal);

    // No valid SendGrid key: fall back to live CNAME checks so a correctly configured domain
    // can still verify against real DNS. Auto-passing every check is a local-dev convenience
    // behind an EXPLICIT opt-in (ALLOW_MOCK_DOMAIN_VERIFICATION=true) — a missing or
    // misconfigured key in a real deploy must not silently mark domains verified and open
    // the send guards (fail closed, same rule as ALLOW_MOCK_PAYMENTS).
    if (!hasValidKey) {
      const realSpf = await sendgridSvc.verifyCname(
        domainEntry.domainAuthDns?.['mail_cname']?.host || '',
        domainEntry.domainAuthDns?.['mail_cname']?.data,
      );
      const realDkim1 = await sendgridSvc.verifyCname(
        domainEntry.domainAuthDns?.['dkim1']?.host || '',
        domainEntry.domainAuthDns?.['dkim1']?.data,
      );
      const realDkim2 = await sendgridSvc.verifyCname(
        domainEntry.domainAuthDns?.['dkim2']?.host || '',
        domainEntry.domainAuthDns?.['dkim2']?.data,
      );
      const realLink = await sendgridSvc.verifyCname(
        domainEntry.linkBrandingDns?.['domain']?.host || '',
        domainEntry.linkBrandingDns?.['domain']?.data,
      );

      const mockPass = env.allowMockDomainVerification;
      spfVerified = realSpf || mockPass;
      dkimVerified = (realDkim1 && realDkim2) || mockPass;
      linkBranded = realLink || mockPass;
      dmarcVerified = dmarcVerified || mockPass;
    }

    const updatedList = currentList.map((d) => {
      if (d.domain === domainVal) {
        // DMARC is recommended but not required for verified status: the sending records
        // (SPF + DKIM + link branding) authenticate the mail; DMARC is the tenant's own
        // anti-spoofing policy and must not block their ability to send. The subuser
        // association IS required (platform-key mode) — without it the DNS can be perfect
        // and the tenant's mail still goes out unsigned.
        const isVerified = spfVerified && dkimVerified && linkBranded && subuserOk;
        return {
          ...d,
          spf: spfVerified,
          dkim: dkimVerified,
          dmarc: dmarcVerified,
          linkBranded,
          ...(creds.associateSubuser ? { subuserAssociated } : {}),
          status: isVerified ? 'verified' : 'pending',
          domainAuthDns: {
            ...d.domainAuthDns,
            mail_cname: d.domainAuthDns?.['mail_cname']
              ? { ...d.domainAuthDns['mail_cname'], valid: spfVerified }
              : undefined,
            dkim1: d.domainAuthDns?.['dkim1'] ? { ...d.domainAuthDns['dkim1'], valid: dkimVerified } : undefined,
            dkim2: d.domainAuthDns?.['dkim2'] ? { ...d.domainAuthDns['dkim2'], valid: dkimVerified } : undefined,
          },
          linkBrandingDns: {
            ...d.linkBrandingDns,
            domain: d.linkBrandingDns?.['domain'] ? { ...d.linkBrandingDns['domain'], valid: linkBranded } : undefined,
          },
        };
      }
      return d;
    });

    await this.getRepo().upsertMany({
      tenant_id: auth.tenant_id,
      user_id: auth.user_id,
      entries: [{ key: 'communications.verified_domains', value: updatedList }],
    });

    return updatedList;
  }

  public async deleteVerifiedDomain(auth: IAuthKeyPayload, domain: string) {
    await assertPlanSelected(this.getRepo().db, auth.tenant_id);
    const domainVal = domain.toLowerCase().trim();

    const row = await this.getRepo().getByKey({
      tenant_id: auth.tenant_id,
      key: 'communications.verified_domains',
    });

    if (!row || !Array.isArray(row.value)) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Domain configuration not found.',
      });
    }

    const currentList = row.value as unknown as VerifiedDomainEntry[];
    const domainEntry = currentList.find((d) => d.domain === domainVal);

    if (!domainEntry) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Domain ${domainVal} not found in verified domains list.`,
      });
    }

    // Resolve credentials the same way add/verify do, so the delete reaches the SendGrid
    // account the records were actually created under.
    const creds = await this.resolveWhitelabelCredentials(auth.tenant_id);

    const sendgridSvc = new SendGridWhitelabelService();

    // Delete from SendGrid
    if (domainEntry.domainAuthId) {
      await sendgridSvc.deleteDomainAuthentication(Number(domainEntry.domainAuthId), creds.apiKey, creds.subuser);
    }
    if (domainEntry.linkBrandingId) {
      await sendgridSvc.deleteLinkBranding(Number(domainEntry.linkBrandingId), creds.apiKey, creds.subuser);
    }

    const updatedList = currentList.filter((d) => d.domain !== domainVal);

    await this.getRepo().upsertMany({
      tenant_id: auth.tenant_id,
      user_id: auth.user_id,
      entries: [{ key: 'communications.verified_domains', value: updatedList }],
    });

    return updatedList;
  }

  /**
   * Issue a key into the tenant's first free slot.
   *
   * A workspace may hold two at once (KEY_SLOTS), which is what makes rotation non-destructive:
   * issue the second key, move the integrations across, then revoke the first. There is no
   * "regenerate" any more — replacing a key in place is precisely the outage this replaces.
   */
  public async createApiKey(auth: IAuthKeyPayload) {
    // Dynamic import: plan-gate pulls in the tRPC root, which transitively imports the routers
    // that import this controller. A static import here would close that cycle.
    const { assertPlanFeature } = await import('../billing/plan-gate');
    await assertPlanFeature(this.getRepo().db, auth.tenant_id, 'api');

    const { generateApiKey, hashApiKey, getKeyPreview } = await import('../../lib/api-key');
    const { WorkspaceApiKeysRepo, KEY_SLOTS, MAX_KEYS_PER_TENANT } =
      await import('./repositories/workspace-api-keys.repo');
    const repo = new WorkspaceApiKeysRepo();

    const existing = await repo.listByTenantId(auth.tenant_id);
    if (existing.length >= MAX_KEYS_PER_TENANT) {
      throw new ConflictError(
        `A workspace can hold ${MAX_KEYS_PER_TENANT} API keys. Revoke one before creating another.`,
      );
    }

    const taken = new Set(existing.map((row) => Number(row.slot)));
    const slot = KEY_SLOTS.find((candidate) => !taken.has(candidate));
    if (slot == null) {
      throw new ConflictError(
        `A workspace can hold ${MAX_KEYS_PER_TENANT} API keys. Revoke one before creating another.`,
      );
    }

    const rawKey = generateApiKey();

    try {
      await repo.createInSlot(auth.tenant_id, slot, hashApiKey(rawKey), getKeyPreview(rawKey));
    } catch (err) {
      // uq_workspace_api_keys_tenant_slot: two concurrent creates both saw the slot free. The
      // constraint is the real cap — without this the loser would surface as a raw 500.
      if (isUniqueViolation(err)) {
        throw new ConflictError('Another API key was just created. Reload the page and try again.');
      }
      throw err;
    }

    // The raw key is returned exactly once and never stored — only its hash and a short preview.
    return { key: rawKey, preview: getKeyPreview(rawKey), slot };
  }

  /** The tenant's keys, previews only. Never gated on plan: a downgraded tenant must still be
   * able to see and revoke credentials it can no longer use. */
  public async listApiKeys(auth: IAuthKeyPayload) {
    const { WorkspaceApiKeysRepo } = await import('./repositories/workspace-api-keys.repo');
    const rows = await new WorkspaceApiKeysRepo().listByTenantId(auth.tenant_id);

    return rows.map((row) => ({
      slot: Number(row.slot),
      preview: row.key_preview,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
    }));
  }

  /**
   * Revoke one key without issuing a replacement.
   *
   * Two distinct jobs, now that a workspace can hold two keys: revoking the older half of a
   * rotation once traffic has moved, and switching API access off entirely. Neither is served by
   * replacing a key in place. Not plan-gated for the same reason as `listApiKeys` — taking a
   * credential out of service must never require an upgrade.
   */
  public async revokeApiKey(auth: IAuthKeyPayload, slot: number) {
    const { WorkspaceApiKeysRepo } = await import('./repositories/workspace-api-keys.repo');

    await new WorkspaceApiKeysRepo().deleteByTenantAndSlot(auth.tenant_id, slot);
  }
}
