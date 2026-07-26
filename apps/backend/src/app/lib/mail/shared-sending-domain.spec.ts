import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { env } from '../../../env';
import { logger } from '../../logger';
import {
  isOwnSharedSendingAddress,
  isSharedSendingAddress,
  sharedSendingAddressFor,
  sharedSendingDomain,
} from './shared-sending-domain';

describe('shared sending domain', () => {
  let savedDomain: string | undefined;
  let savedPostmarkFrom: string;

  beforeEach(() => {
    savedDomain = env.sendgridSharedSendingDomain;
    savedPostmarkFrom = env.postmarkFromEmail;
    env.sendgridSharedSendingDomain = 'send.pplcrm.com';
    env.postmarkFromEmail = 'hello@pplcrm.com';
  });

  afterEach(() => {
    env.sendgridSharedSendingDomain = savedDomain;
    env.postmarkFromEmail = savedPostmarkFrom;
    vi.restoreAllMocks();
  });

  it('is off when unconfigured', () => {
    env.sendgridSharedSendingDomain = undefined;
    expect(sharedSendingDomain()).toBeNull();
    expect(sharedSendingAddressFor('riverside')).toBeNull();
    expect(isSharedSendingAddress('riverside@send.pplcrm.com')).toBe(false);
  });

  it('builds the tenant address from its slug', () => {
    expect(sharedSendingAddressFor('riverside')).toBe('riverside@send.pplcrm.com');
    expect(sharedSendingAddressFor(null)).toBeNull();
  });

  it('recognises addresses on the domain, case- and whitespace-insensitively', () => {
    expect(isSharedSendingAddress('  Riverside@Send.PPLCRM.com ')).toBe(true);
    expect(isSharedSendingAddress('riverside@vote-jane.org')).toBe(false);
    expect(isSharedSendingAddress(null)).toBe(false);
  });

  /**
   * The domain is shared, so identity is the local part. A domain-only check would let any tenant
   * put another tenant's slug in its From header and send mail under their name.
   */
  it('only accepts the tenant’s OWN address on the shared domain', () => {
    expect(isOwnSharedSendingAddress('riverside@send.pplcrm.com', 'riverside')).toBe(true);
    expect(isOwnSharedSendingAddress('RIVERSIDE@send.pplcrm.com', 'riverside')).toBe(true);
    expect(isOwnSharedSendingAddress('someone-else@send.pplcrm.com', 'riverside')).toBe(false);
    expect(isOwnSharedSendingAddress('riverside@send.pplcrm.com', null)).toBe(false);
  });

  /**
   * Reputation at Gmail/Yahoo attaches to the From domain and the DKIM d= domain regardless of
   * which ESP carried the message. Sharing a domain with transactional mail would let a tenant's
   * spam complaints degrade password-reset delivery, so a misconfiguration disables the feature
   * rather than quietly accepting the risk.
   */
  it('fails CLOSED when pointed at the transactional domain', () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined as never);
    env.sendgridSharedSendingDomain = 'pplcrm.com';

    expect(sharedSendingDomain()).toBeNull();
    expect(isSharedSendingAddress('riverside@pplcrm.com')).toBe(false);
    // Closed AND loud: silently disabling would look identical to "not configured yet".
    expect(error).toHaveBeenCalled();
    expect(String(error.mock.calls[0]?.[1])).toMatch(/transactional sending domain/i);
  });

  it('allows a sibling subdomain of the transactional domain', () => {
    env.postmarkFromEmail = 'hello@pplcrm.com';
    env.sendgridSharedSendingDomain = 'send.pplcrm.com';
    expect(sharedSendingDomain()).toBe('send.pplcrm.com');
  });
});
