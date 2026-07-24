import { describe, expect, it, vi } from 'vitest';

import type { DomainResolver, DomainStatus } from './email-verifier.service';
import {
  classifyDomainError,
  classifyEmails,
  EmailVerifierService,
  evaluateImportListQuality,
  isRoleAccount,
  suggestTypoDomain,
} from './email-verifier.service';

function dnsError(code: string): Error & { code: string } {
  const err = new Error(code) as Error & { code: string };
  err.code = code;
  return err;
}

/** A resolver where each lookup type is a vi.fn we can program per test. */
function fakeResolver(overrides: Partial<DomainResolver> = {}): DomainResolver {
  return {
    resolveMx: vi.fn(async () => []),
    resolve4: vi.fn(async () => []),
    resolve6: vi.fn(async () => []),
    ...overrides,
  };
}

describe('suggestTypoDomain', () => {
  it('suggests the correction for a known typo', () => {
    expect(suggestTypoDomain('gmial.com')).toBe('gmail.com');
    expect(suggestTypoDomain('HOTMIAL.COM')).toBe('hotmail.com');
  });
  it('returns null for a correct domain', () => {
    expect(suggestTypoDomain('gmail.com')).toBeNull();
    expect(suggestTypoDomain('some-org.org')).toBeNull();
  });
});

describe('isRoleAccount', () => {
  it('flags shared mailbox prefixes', () => {
    expect(isRoleAccount('info@acme.org')).toBe(true);
    expect(isRoleAccount('No-Reply@acme.org')).toBe(true);
  });
  it('does not flag personal addresses', () => {
    expect(isRoleAccount('jane.doe@acme.org')).toBe(false);
  });
});

describe('classifyDomainError', () => {
  it('treats ENOTFOUND / ENODATA as definitive negatives', () => {
    expect(classifyDomainError(dnsError('ENOTFOUND'))).toBe('dead');
    expect(classifyDomainError(dnsError('ENODATA'))).toBe('dead');
  });
  it('treats everything else as unknown (fail-open)', () => {
    expect(classifyDomainError(dnsError('ESERVFAIL'))).toBe('unknown');
    expect(classifyDomainError(dnsError('ETIMEOUT'))).toBe('unknown');
    expect(classifyDomainError(new Error('dns_timeout'))).toBe('unknown');
  });
});

describe('evaluateImportListQuality', () => {
  it('returns null below the minimum sample even if every address is bad', () => {
    expect(evaluateImportListQuality({ checked: 50, dead: 50, disposable: 0 })).toBeNull();
  });
  it('warns in the warn band', () => {
    expect(evaluateImportListQuality({ checked: 100, dead: 10, disposable: 0 })).toBe('warn');
  });
  it('pauses in the pause band', () => {
    expect(evaluateImportListQuality({ checked: 100, dead: 15, disposable: 10 })).toBe('pause');
  });
  it('returns null for a clean list', () => {
    expect(evaluateImportListQuality({ checked: 1000, dead: 5, disposable: 0 })).toBeNull();
  });
});

describe('EmailVerifierService.resolveDomainStatus', () => {
  it('is ok when the domain has an MX record', async () => {
    const svc = new EmailVerifierService(fakeResolver({ resolveMx: vi.fn(async () => [{ exchange: 'mx1' }]) }));
    expect(await svc.resolveDomainStatus('acme.org')).toBe('ok');
  });

  it('is ok when there is no MX but an A record (RFC 5321 fallback)', async () => {
    const svc = new EmailVerifierService(
      fakeResolver({
        resolveMx: vi.fn(async () => {
          throw dnsError('ENODATA');
        }),
        resolve4: vi.fn(async () => ['1.2.3.4']),
      }),
    );
    expect(await svc.resolveDomainStatus('acme.org')).toBe('ok');
  });

  it('is dead when MX, A and AAAA are all definitive negatives', async () => {
    const svc = new EmailVerifierService(
      fakeResolver({
        resolveMx: vi.fn(async () => {
          throw dnsError('ENOTFOUND');
        }),
        resolve4: vi.fn(async () => {
          throw dnsError('ENOTFOUND');
        }),
        resolve6: vi.fn(async () => {
          throw dnsError('ENOTFOUND');
        }),
      }),
    );
    expect(await svc.resolveDomainStatus('no-such-domain-zzz.com')).toBe('dead');
  });

  it('is unknown when any lookup fails non-definitively (fail-open)', async () => {
    const svc = new EmailVerifierService(
      fakeResolver({
        resolveMx: vi.fn(async () => {
          throw dnsError('ESERVFAIL');
        }),
      }),
    );
    expect(await svc.resolveDomainStatus('flaky.org')).toBe('unknown');
  });
});

describe('EmailVerifierService.verifyDomains', () => {
  it('caches: each unique domain is resolved exactly once across many emails', async () => {
    const resolveMx = vi.fn(async () => [{ exchange: 'mx1' }]);
    const svc = new EmailVerifierService(fakeResolver({ resolveMx }));
    const map = await svc.verifyDomains(['acme.org', 'acme.org', 'ACME.ORG', 'other.org']);
    expect(resolveMx).toHaveBeenCalledTimes(2);
    expect(map.get('acme.org')).toBe('ok');
    expect(map.get('other.org')).toBe('ok');
  });

  it('never runs more than DNS_CONCURRENCY lookups at once', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const resolveMx = vi.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return [{ exchange: 'mx1' }];
    });
    const svc = new EmailVerifierService(fakeResolver({ resolveMx }));
    const domains = Array.from({ length: 50 }, (_, i) => `d${i}.org`);
    await svc.verifyDomains(domains);
    expect(maxInFlight).toBeLessThanOrEqual(10);
  });
});

describe('classifyEmails', () => {
  const noneSuppressed = new Set<string>();

  it('suppresses dead-domain and disposable, keeps ok, counts unverifiable as valid', () => {
    const status = new Map<string, DomainStatus>([
      ['acme.org', 'ok'],
      ['dead.com', 'dead'],
      ['flaky.org', 'unknown'],
    ]);
    const { summary, toSuppress } = classifyEmails(
      ['jane@acme.org', 'bob@dead.com', 'x@mailinator.com', 'kim@flaky.org'],
      status,
      noneSuppressed,
    );
    expect(toSuppress).toEqual(['bob@dead.com', 'x@mailinator.com']);
    expect(summary.checked).toBe(4);
    expect(summary.dead_domain).toBe(1);
    expect(summary.disposable).toBe(1);
    expect(summary.unverifiable).toBe(1);
    // valid = truly-ok (jane) + unverifiable (kim, treated valid)
    expect(summary.valid).toBe(2);
    expect(summary.suppressed_new).toBe(2);
  });

  it('excludes already-suppressed addresses from new suppression', () => {
    const status = new Map<string, DomainStatus>([['dead.com', 'dead']]);
    const { summary, toSuppress } = classifyEmails(['bob@dead.com'], status, new Set(['bob@dead.com']));
    expect(toSuppress).toEqual([]);
    expect(summary.already_suppressed).toBe(1);
    expect(summary.suppressed_new).toBe(0);
  });

  it('records typo suspects and role accounts without suppressing them', () => {
    const status = new Map<string, DomainStatus>([
      ['gmial.com', 'dead'],
      ['acme.org', 'ok'],
    ]);
    const { summary } = classifyEmails(['x@gmial.com', 'info@acme.org'], status, noneSuppressed);
    expect(summary.typo_suspects).toEqual([{ email: 'x@gmial.com', suggested_domain: 'gmail.com' }]);
    expect(summary.role_accounts).toBe(1);
  });
});
