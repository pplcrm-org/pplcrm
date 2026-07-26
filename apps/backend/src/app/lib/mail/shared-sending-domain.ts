import { env } from '../../../env';
import { logger } from '../../logger';

/**
 * The platform sending domain (`send.pplcrm.com`): what a tenant sends from when it has no domain
 * of its own to authenticate.
 *
 * This exists because "just send from your Gmail address" is not an option we can offer. You
 * cannot DKIM-sign as `gmail.com` (Google holds the key) and SendGrid's IPs are not in gmail.com's
 * SPF record, so both authentication paths fail and DMARC alignment fails with them. Since
 * February 2024 Gmail and Yahoo require bulk senders to pass alignment, and Yahoo/AOL have
 * published `p=reject` on consumer domains for a decade. Mail "from" a Gmail address via a third
 * party is filtered or rejected, and the resulting bounces and complaints would trip our own
 * tenant-pausing tripwires. Allowing it would only punish the tenant for using it.
 *
 * So the tenant sends as `<slug>@send.pplcrm.com` (DMARC-aligned, because we own and sign that
 * domain) with their own address as Reply-To, and replies still reach them.
 *
 * Reputation is pooled across every tenant on this domain. That is a deliberate trade, contained
 * by the layers that already exist: the free-tier SendGrid subuser isolating IP reputation,
 * per-tenant phone verification, and the bounce/complaint tripwires that pause a tenant before it
 * can poison the pool.
 */

function domainOf(email: string): string {
  return email.toLowerCase().trim().split('@')[1] ?? '';
}

/**
 * The configured platform sending domain, or null when the option is switched off.
 *
 * Fails CLOSED when it is misconfigured to the transactional domain. Reputation at Gmail and
 * Yahoo attaches to the From domain and the DKIM `d=` domain regardless of which ESP's IPs carried
 * the message, so sharing a domain with `POSTMARK_FROM_EMAIL` would let one tenant's spam
 * complaints degrade delivery of password resets and email verification. The failure mode is not
 * "newsletters land in spam", it is "nobody can get back into their account" — so a misconfigured
 * value disables the feature loudly rather than quietly accepting the risk.
 */
export function sharedSendingDomain(): string | null {
  const configured = env.sendgridSharedSendingDomain?.toLowerCase().trim();
  if (!configured) return null;

  const transactional = domainOf(env.postmarkFromEmail);
  if (configured === transactional) {
    logger.error(
      { configured, transactional },
      'SENDGRID_SHARED_SENDING_DOMAIN is the transactional sending domain. Tenant bulk mail would ' +
        'share reputation with password resets and verification email. Shared sending is disabled ' +
        'until this points at a separate authenticated domain.',
    );
    return null;
  }

  return configured;
}

/** True when `email` is on the platform sending domain (whoever it belongs to). */
export function isSharedSendingAddress(email: string | null | undefined): boolean {
  const domain = sharedSendingDomain();
  if (!domain || !email) return false;
  return domainOf(email) === domain;
}

/**
 * This tenant's address on the platform domain, or null when the tenant has no slug or the option
 * is off. The slug is already a unique, DNS-safe, reserved-word-checked label (see
 * `RESERVED_SUBDOMAINS` in libs/common), which is exactly the guarantee a local part needs.
 */
export function sharedSendingAddressFor(slug: string | null | undefined): string | null {
  const domain = sharedSendingDomain();
  if (!domain || !slug) return null;
  return `${slug.toLowerCase().trim()}@${domain}`;
}

/**
 * Whether `email` is the address this specific tenant is allowed to send from on the platform
 * domain. Identity, not just syntax: without the slug comparison a tenant could set its From to
 * another tenant's `<slug>@send.pplcrm.com` and send mail under their name.
 */
export function isOwnSharedSendingAddress(email: string | null | undefined, slug: string | null | undefined): boolean {
  const own = sharedSendingAddressFor(slug);
  if (!own || !email) return false;
  return email.toLowerCase().trim() === own;
}
