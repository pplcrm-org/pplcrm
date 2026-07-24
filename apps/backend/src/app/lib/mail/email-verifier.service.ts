import { Resolver } from 'node:dns/promises';

import { isDisposableEmail } from './disposable-email-domains';

/**
 * In-house email verification for contact import (no third-party service).
 *
 * What it does, per unique imported address:
 *  - disposable-domain check (reuses the signup block list) → suppress
 *  - typo-domain suggestion (gmial.com → gmail.com) → report only, never auto-fix
 *  - role-account detection (info@, admin@) → report only, never suppress (org mailboxes are
 *    legitimate CRM contacts)
 *  - MX/DNS resolution → a domain with no MX AND no A/AAAA record is dead → suppress
 *
 * What it deliberately does NOT do: SMTP mailbox probing. Azure blocks outbound port 25, and the
 * existing bounce tripwires already catch dead mailboxes reactively. So this is a DOMAIN-level
 * check — it proves a domain can't receive mail, not that a specific mailbox exists.
 *
 * FAIL-OPEN is absolute: only definitive DNS negatives (ENOTFOUND/ENODATA) and disposable domains
 * ever cause suppression. Timeouts, SERVFAIL, throttling, or an exhausted time budget resolve to
 * `unknown` and are treated as valid — a flaky resolver must never suppress a real supporter.
 */

/** Per-DNS-query timeout. One try only (see resolver construction) — a slow domain is `unknown`, not retried forever. */
export const DNS_LOOKUP_TIMEOUT_MS = 5_000;
/** Max concurrent domain lookups. Bounds load on the resolver and keeps a 10k-row import's few-hundred domains flowing. */
export const DNS_CONCURRENCY = 10;
/** Whole-import wall-clock budget for DNS. Domains unresolved when it expires are `unknown` (fail-open). */
export const VERIFICATION_TIME_BUDGET_MS = 120_000;

/** Import list-quality tripwire needs a minimum sample so a tiny dirty import doesn't pause a tenant. */
export const IMPORT_TRIPWIRE_MIN_EMAILS = 100;
/**
 * Bad = dead-domain + disposable. Bands are deliberately looser than the 5% hard-bounce tripwire:
 * a no-MX domain is a weaker signal than a real bounce (hand-collected lists carry honest typos),
 * so only an egregious rate — purchased/scraped-list territory — reacts.
 */
export const IMPORT_BAD_EMAIL_WARN_RATE = 0.08;
export const IMPORT_BAD_EMAIL_PAUSE_RATE = 0.2;

/** Cap on typo suspects retained in the stored summary / report email. */
export const TYPO_SUSPECT_SAMPLE_CAP = 100;

/** Injectable so unit tests never touch the network. Methods mirror node:dns Resolver. */
export interface DomainResolver {
  resolveMx(domain: string): Promise<unknown[]>;
  resolve4(domain: string): Promise<unknown[]>;
  resolve6(domain: string): Promise<unknown[]>;
}

/** `ok` = has MX or A/AAAA; `dead` = definitively none; `unknown` = couldn't determine (fail-open → valid). */
export type DomainStatus = 'ok' | 'dead' | 'unknown';

export type ImportTripwireOutcome = 'none' | 'warn' | 'pause';

export interface EmailVerificationSummary {
  checked: number;
  valid: number;
  dead_domain: number;
  disposable: number;
  already_suppressed: number;
  unverifiable: number;
  role_accounts: number;
  suppressed_new: number;
  typo_suspects: Array<{ email: string; suggested_domain: string }>;
  tripwire: ImportTripwireOutcome;
}

/** Common misspellings of the big free providers. Report-only — we never rewrite a user's data. */
const TYPO_DOMAINS: Record<string, string> = {
  'gmial.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmal.com': 'gmail.com',
  'gamil.com': 'gmail.com',
  'gmaill.com': 'gmail.com',
  'gnail.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gmail.con': 'gmail.com',
  'hotmial.com': 'hotmail.com',
  'hotmai.com': 'hotmail.com',
  'hotmali.com': 'hotmail.com',
  'hotmail.co': 'hotmail.com',
  'hotmail.con': 'hotmail.com',
  'yaho.com': 'yahoo.com',
  'yahooo.com': 'yahoo.com',
  'yahoo.co': 'yahoo.com',
  'yhaoo.com': 'yahoo.com',
  'outlok.com': 'outlook.com',
  'outllook.com': 'outlook.com',
  'outook.com': 'outlook.com',
  'iclod.com': 'icloud.com',
  'icoud.com': 'icloud.com',
  'iclould.com': 'icloud.com',
  'live.co': 'live.com',
  'aol.co': 'aol.com',
};

/** Non-personal mailbox prefixes — legitimate in a CRM (an org's shared inbox), so flagged, never suppressed. */
const ROLE_LOCAL_PARTS = new Set<string>([
  'info',
  'admin',
  'support',
  'sales',
  'contact',
  'office',
  'hello',
  'team',
  'help',
  'billing',
  'hr',
  'jobs',
  'careers',
  'marketing',
  'enquiries',
  'inquiries',
  'noreply',
  'no-reply',
  'donotreply',
  'webmaster',
  'postmaster',
  'abuse',
]);

/** Lowercased registrable domain of an address, or null if it has no `@domain` part. */
export function domainOfEmail(email: string): string | null {
  const domain = email.toLowerCase().trim().split('@')[1];
  return domain && domain.length > 0 ? domain : null;
}

/** A known-typo domain's correction, or null. Never used to rewrite — only to suggest in the report. */
export function suggestTypoDomain(domain: string): string | null {
  return TYPO_DOMAINS[domain.toLowerCase()] ?? null;
}

/** True when the local part is a shared/role mailbox (info@, admin@, …). */
export function isRoleAccount(email: string): boolean {
  const localPart = email.toLowerCase().trim().split('@')[0];
  return localPart ? ROLE_LOCAL_PARTS.has(localPart) : false;
}

/**
 * Maps a DNS error to a domain status. Only ENOTFOUND (no such domain) and ENODATA (domain
 * exists, no record of this type) are definitive negatives; everything else — timeouts,
 * SERVFAIL, refusals, throttling — is `unknown` and treated as valid (fail-open).
 */
export function classifyDomainError(err: unknown): DomainStatus {
  const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : '';
  return code === 'ENOTFOUND' || code === 'ENODATA' ? 'dead' : 'unknown';
}

/**
 * The pure list-quality tripwire. `null` below the min sample or below the warn band, else the band.
 * Mirrors `evaluateTripwires` in send-guards.ts.
 */
export function evaluateImportListQuality(stats: {
  checked: number;
  dead: number;
  disposable: number;
}): 'pause' | 'warn' | null {
  if (stats.checked < IMPORT_TRIPWIRE_MIN_EMAILS) return null;
  const badRate = (stats.dead + stats.disposable) / stats.checked;
  if (badRate >= IMPORT_BAD_EMAIL_PAUSE_RATE) return 'pause';
  if (badRate >= IMPORT_BAD_EMAIL_WARN_RATE) return 'warn';
  return null;
}

/** Resolves once, rejects after `ms` — belt-and-braces around the resolver's own per-try timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('dns_timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export class EmailVerifierService {
  private readonly resolver: DomainResolver;
  private readonly cache = new Map<string, DomainStatus>();

  constructor(resolver?: DomainResolver) {
    this.resolver = resolver ?? new Resolver({ timeout: DNS_LOOKUP_TIMEOUT_MS, tries: 1 });
  }

  /**
   * `dead` only when MX AND A AND AAAA all return definitive negatives (RFC 5321: a host with an
   * A/AAAA record but no MX still accepts mail). Any `unknown` along the way wins → `unknown`.
   */
  async resolveDomainStatus(domain: string): Promise<DomainStatus> {
    try {
      const mx = await withTimeout(this.resolver.resolveMx(domain), DNS_LOOKUP_TIMEOUT_MS);
      if (mx.length > 0) return 'ok';
    } catch (err) {
      if (classifyDomainError(err) === 'unknown') return 'unknown';
    }
    // No MX (or ENODATA on MX): fall back to A/AAAA per RFC 5321.
    let sawDefinitiveNegative = false;
    for (const lookup of [this.resolver.resolve4.bind(this.resolver), this.resolver.resolve6.bind(this.resolver)]) {
      try {
        const records = await withTimeout(lookup(domain), DNS_LOOKUP_TIMEOUT_MS);
        if (records.length > 0) return 'ok';
        sawDefinitiveNegative = true;
      } catch (err) {
        if (classifyDomainError(err) === 'unknown') return 'unknown';
        sawDefinitiveNegative = true;
      }
    }
    return sawDefinitiveNegative ? 'dead' : 'unknown';
  }

  /**
   * Resolves the status of each unique domain, cached, at most `DNS_CONCURRENCY` in flight, within
   * `VERIFICATION_TIME_BUDGET_MS`. Domains not resolved before the budget expires are `unknown`.
   */
  async verifyDomains(domains: string[]): Promise<Map<string, DomainStatus>> {
    const unique = [...new Set(domains.map((d) => d.toLowerCase()))];
    const deadline = timeNow() + VERIFICATION_TIME_BUDGET_MS;
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (cursor < unique.length) {
        const domain = unique[cursor++];
        if (domain === undefined || this.cache.has(domain)) continue;
        if (timeNow() >= deadline) {
          this.cache.set(domain, 'unknown');
          continue;
        }
        try {
          this.cache.set(domain, await this.resolveDomainStatus(domain));
        } catch {
          this.cache.set(domain, 'unknown');
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(DNS_CONCURRENCY, unique.length) }, () => worker()));

    const result = new Map<string, DomainStatus>();
    for (const domain of unique) result.set(domain, this.cache.get(domain) ?? 'unknown');
    return result;
  }
}

/** Wall-clock read isolated so the deadline logic stays testable via the injected resolver's pacing. */
function timeNow(): number {
  return Date.now();
}

/**
 * Classifies a set of syntactically-valid, lowercased emails against a resolved domain-status map
 * and the tenant's already-suppressed set, producing the summary and the list of emails to
 * newly suppress. Pure given its inputs — no DNS, no DB — so it is fully unit-testable.
 */
export function classifyEmails(
  emails: string[],
  domainStatus: Map<string, DomainStatus>,
  alreadySuppressed: ReadonlySet<string>,
): { summary: Omit<EmailVerificationSummary, 'tripwire'>; toSuppress: string[] } {
  const toSuppress: string[] = [];
  const typoSuspects: Array<{ email: string; suggested_domain: string }> = [];
  let valid = 0;
  let deadDomain = 0;
  let disposable = 0;
  let alreadySuppressedCount = 0;
  let unverifiable = 0;
  let roleAccounts = 0;

  for (const email of emails) {
    const domain = domainOfEmail(email);
    if (!domain) continue;

    if (isRoleAccount(email)) roleAccounts++;
    const typo = suggestTypoDomain(domain);
    if (typo && typoSuspects.length < TYPO_SUSPECT_SAMPLE_CAP) {
      typoSuspects.push({ email, suggested_domain: typo });
    }

    if (alreadySuppressed.has(email)) {
      alreadySuppressedCount++;
      continue;
    }

    if (isDisposableEmail(email)) {
      disposable++;
      toSuppress.push(email);
      continue;
    }

    const status = domainStatus.get(domain) ?? 'unknown';
    if (status === 'dead') {
      deadDomain++;
      toSuppress.push(email);
    } else if (status === 'unknown') {
      unverifiable++;
      valid++;
    } else {
      valid++;
    }
  }

  return {
    summary: {
      checked: emails.length,
      valid,
      dead_domain: deadDomain,
      disposable,
      already_suppressed: alreadySuppressedCount,
      unverifiable,
      role_accounts: roleAccounts,
      suppressed_new: toSuppress.length,
      typo_suspects: typoSuspects,
    },
    toSuppress,
  };
}
