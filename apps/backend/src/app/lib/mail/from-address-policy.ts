import type { Kysely, Transaction } from 'kysely';

import type { Models } from '../../../../../../libs/common/src/lib/kysely.models';
import { isOwnSharedSendingAddress, isSharedSendingAddress } from './shared-sending-domain';

type Db = Kysely<Models> | Transaction<Models>;

/** The settings key holding the tenant's DKIM-verified sending domains. */
const VERIFIED_DOMAINS_KEY = 'communications.verified_domains';

/** One entry of `communications.verified_domains`, narrowed to the two fields this rule reads. */
interface VerifiedDomainRow {
  domain?: string;
  status?: string;
}

/** The verified status a domain entry must carry for its addresses to be sendable. */
const VERIFIED_STATUS = 'verified';

/**
 * Everything the rule needs about one tenant: its slug (which determines its own address on the
 * platform sending domain) and its verified-domain list.
 */
export interface FromAddressPolicy {
  slug: string | null;
  verifiedDomains: VerifiedDomainRow[];
}

/** Narrow an untyped settings value into the verified-domain rows the rule reads. */
export function toVerifiedDomains(value: unknown): VerifiedDomainRow[] {
  if (!Array.isArray(value)) return [];
  const rows: VerifiedDomainRow[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const record: Record<string, unknown> = entry as Record<string, unknown>;
    rows.push({
      domain: typeof record['domain'] === 'string' ? record['domain'] : undefined,
      status: typeof record['status'] === 'string' ? record['status'] : undefined,
    });
  }
  return rows;
}

/**
 * The single rule for "may this tenant put this address in the From header of bulk mail?".
 *
 * An address qualifies only if its domain is DKIM-verified for this tenant, or it is this tenant's
 * own address on the platform sending domain. Single-address ("click the link we emailed you")
 * verification is deliberately NOT enough: it proves the address is yours, but DMARC aligns on the
 * DOMAIN, so bulk mail from an address on a domain we cannot sign is filtered or rejected.
 *
 * The platform branch compares the tenant's own address rather than just the domain — the platform
 * domain is shared, so a domain-only test would let one tenant send as another.
 *
 * Every caller that decides a From address must use this function, so that an address which saves
 * is an address that sends.
 */
export function isSendableFromAddress(email: string, policy: FromAddressPolicy): boolean {
  const address = email.toLowerCase().trim();
  if (!address) return false;

  if (isSharedSendingAddress(address)) {
    return isOwnSharedSendingAddress(address, policy.slug);
  }

  const domain = address.split('@')[1];
  if (!domain) return false;

  return policy.verifiedDomains.some((d) => d.domain?.toLowerCase().trim() === domain && d.status === VERIFIED_STATUS);
}

/** Load the tenant slug and verified-domain list the rule needs, for callers holding only a db handle. */
export async function loadFromAddressPolicy(db: Db, tenantId: string): Promise<FromAddressPolicy> {
  const [tenant, domainsRow] = await Promise.all([
    db.selectFrom('tenants').select('slug').where('id', '=', tenantId).executeTakeFirst(),
    db
      .selectFrom('settings')
      .select('value')
      .where('tenant_id', '=', tenantId)
      .where('key', '=', VERIFIED_DOMAINS_KEY)
      .executeTakeFirst(),
  ]);

  return {
    slug: tenant?.slug ?? null,
    verifiedDomains: toVerifiedDomains(domainsRow?.value),
  };
}

/**
 * What to tell a user whose chosen From address fails the rule. Names both ways forward, because
 * "not allowed" without a next step is where people get stuck.
 */
export function unsendableFromAddressMessage(email: string): string {
  if (isSharedSendingAddress(email)) {
    return 'That pplCRM sending address belongs to another workspace.';
  }
  const domain = email.split('@')[1] ?? 'that domain';
  return (
    'Bulk email can only be sent from a domain you have verified, or from your own pplCRM sending ' +
    `address. Verify ${domain} under Domains, or choose your pplCRM address and set this one as your Reply-to.`
  );
}
