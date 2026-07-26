import { DEFAULT_LINK_SUBDOMAIN } from '@common';
import { promises as dns } from 'dns';
import { logger } from '../../logger';

export interface DNSVerificationRecord {
  host: string;
  type: string;
  data: string;
  valid: boolean;
}

export interface DomainAuthData {
  id: number;
  domain: string;
  subdomain: string;
  dns: {
    mail_cname?: DNSVerificationRecord;
    dkim1?: DNSVerificationRecord;
    dkim2?: DNSVerificationRecord;
  };
}

export interface LinkBrandingData {
  id: number;
  domain: string;
  subdomain: string;
  valid: boolean;
  dns: {
    domain?: DNSVerificationRecord;
  };
}

interface SgDnsRecord {
  host: string;
  type: string;
  data: string;
  valid?: boolean;
}

interface SgDomainAuthResponse {
  id: number;
  domain: string;
  subdomain: string;
  dns?: {
    mail_cname?: SgDnsRecord;
    dkim1?: SgDnsRecord;
    dkim2?: SgDnsRecord;
  };
}

interface SgLinkBrandingResponse {
  id: number;
  domain: string;
  subdomain: string;
  valid?: boolean;
  dns?: {
    domain?: SgDnsRecord;
  };
}

interface SgValidateResponse {
  valid?: boolean;
  validation_results?: Record<string, { valid?: boolean } | undefined>;
}

export class SendGridWhitelabelService {
  private isValidApiKey(apiKey?: string): boolean {
    if (!apiKey) return false;
    const trimmed = apiKey.trim();
    // Typical SendGrid API key starts with SG.
    return trimmed.length > 20 && trimmed.startsWith('SG.');
  }

  private async request<T = unknown>(
    path: string,
    options: {
      method: string;
      body?: unknown;
      apiKey?: string;
      subuser?: string;
    },
  ): Promise<T> {
    const { method, body, apiKey, subuser } = options;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };

    if (subuser) {
      headers['on-behalf-of'] = subuser;
    }

    const response = await fetch(`https://api.sendgrid.com/v3${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`SendGrid API responded with ${response.status}: ${text}`);
    }

    if (response.status === 204) {
      return {} as T;
    }

    return response.json();
  }

  public async createDomainAuthentication(domain: string, apiKey?: string, subuser?: string): Promise<DomainAuthData> {
    if (!this.isValidApiKey(apiKey)) {
      // Return simulated/mock domain auth records
      const mockId = Math.floor(100000 + Math.random() * 900000);
      return {
        id: mockId,
        domain,
        subdomain: 'em',
        dns: {
          mail_cname: {
            host: `em.${domain}`,
            type: 'CNAME',
            data: `u${mockId}.wl.sendgrid.net`,
            valid: false,
          },
          dkim1: {
            host: `s1._domainkey.${domain}`,
            type: 'CNAME',
            data: `s1.domainkey.u${mockId}.wl.sendgrid.net`,
            valid: false,
          },
          dkim2: {
            host: `s2._domainkey.${domain}`,
            type: 'CNAME',
            data: `s2.domainkey.u${mockId}.wl.sendgrid.net`,
            valid: false,
          },
        },
      };
    }

    try {
      const res = await this.request<SgDomainAuthResponse>('/whitelabel/domains', {
        method: 'POST',
        apiKey,
        subuser,
        body: {
          domain,
          subdomain: 'em',
          automatic_security: true,
          custom_spf: false,
          default: false,
        },
      });

      return {
        id: res.id,
        domain: res.domain,
        subdomain: res.subdomain,
        dns: {
          mail_cname: res.dns?.mail_cname ? { ...res.dns.mail_cname, valid: !!res.dns.mail_cname.valid } : undefined,
          dkim1: res.dns?.dkim1 ? { ...res.dns.dkim1, valid: !!res.dns.dkim1.valid } : undefined,
          dkim2: res.dns?.dkim2 ? { ...res.dns.dkim2, valid: !!res.dns.dkim2.valid } : undefined,
        },
      };
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        '[SendGridWhitelabelService] real API call failed, falling back to mock',
      );
      return this.createDomainAuthentication(domain, undefined);
    }
  }

  /**
   * Create the click-tracking (link branding) record.
   *
   * `subdomain` is caller-chosen because `email` is not always available: a tenant may already
   * be using `email.<their-domain>` for a marketing site or an old mail host, and with a
   * hardcoded label they could never verify at all — link branding is required for verified
   * status, so the CNAME collision locked them out of sending entirely with no workaround.
   */
  public async createLinkBranding(
    domain: string,
    apiKey?: string,
    subuser?: string,
    subdomain: string = DEFAULT_LINK_SUBDOMAIN,
  ): Promise<LinkBrandingData> {
    if (!this.isValidApiKey(apiKey)) {
      const mockId = Math.floor(100000 + Math.random() * 900000);
      return {
        id: mockId,
        domain,
        subdomain,
        valid: false,
        dns: {
          domain: {
            host: `${subdomain}.${domain}`,
            type: 'CNAME',
            data: 'sendgrid.net',
            valid: false,
          },
        },
      };
    }

    try {
      const res = await this.request<SgLinkBrandingResponse>('/whitelabel/links', {
        method: 'POST',
        apiKey,
        subuser,
        body: {
          domain,
          subdomain,
          default: false,
        },
      });

      return {
        id: res.id,
        domain: res.domain,
        subdomain: res.subdomain,
        valid: !!res.valid,
        dns: {
          domain: res.dns?.domain ? { ...res.dns.domain, valid: !!res.dns.domain.valid } : undefined,
        },
      };
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        '[SendGridWhitelabelService] real Link Branding API failed, falling back to mock',
      );
      return this.createLinkBranding(domain, undefined, undefined, subdomain);
    }
  }

  public async validateDomainAuthentication(
    id: number,
    apiKey?: string,
    subuser?: string,
  ): Promise<{ valid: boolean; validationResults: Record<string, boolean> }> {
    if (!this.isValidApiKey(apiKey)) {
      return {
        valid: true,
        validationResults: {
          mail_cname: true,
          dkim1: true,
          dkim2: true,
        },
      };
    }

    try {
      const res = await this.request<SgValidateResponse>(`/whitelabel/domains/${id}/validate`, {
        method: 'POST',
        apiKey,
        subuser,
      });

      const validationResults: Record<string, boolean> = {};
      if (res.validation_results) {
        for (const k of Object.keys(res.validation_results)) {
          validationResults[k] = !!res.validation_results[k]?.valid;
        }
      }

      return {
        valid: !!res.valid,
        validationResults,
      };
    } catch (err) {
      // Fail closed: an API failure must not mark a domain verified, or the send
      // guards would open on the strength of an outage or a revoked key.
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        '[SendGridWhitelabelService] Validate domain API failed, treating records as unverified',
      );
      return {
        valid: false,
        validationResults: {},
      };
    }
  }

  public async validateLinkBranding(id: number, apiKey?: string, subuser?: string): Promise<boolean> {
    if (!this.isValidApiKey(apiKey)) {
      return true;
    }

    try {
      const res = await this.request<SgValidateResponse>(`/whitelabel/links/${id}/validate`, {
        method: 'POST',
        apiKey,
        subuser,
      });

      return !!res.valid;
    } catch (err) {
      // Fail closed (same rule as validateDomainAuthentication).
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        '[SendGridWhitelabelService] Validate link branding API failed, treating record as unverified',
      );
      return false;
    }
  }

  /**
   * Associate a parent-account authenticated domain with a subuser, so mail sent
   * on-behalf-of that subuser is DKIM-signed with the domain. Used in platform-key mode,
   * where the domain auth is created at the parent level but the tenant's mail flows
   * through a subuser (e.g. the shared free-tier subuser). Returns false on failure so the
   * caller can record it and retry — never throws.
   */
  public async associateDomainWithSubuser(id: number, username: string, apiKey?: string): Promise<boolean> {
    if (!this.isValidApiKey(apiKey) || !username) return false;

    try {
      await this.request(`/whitelabel/domains/${id}/subuser`, {
        method: 'POST',
        apiKey,
        body: { username },
      });
      return true;
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        '[SendGridWhitelabelService] Associate domain with subuser failed',
      );
      return false;
    }
  }

  /** Same as associateDomainWithSubuser, for a parent-account link-branding record. */
  public async associateLinkWithSubuser(id: number, username: string, apiKey?: string): Promise<boolean> {
    if (!this.isValidApiKey(apiKey) || !username) return false;

    try {
      await this.request(`/whitelabel/links/${id}/subuser`, {
        method: 'POST',
        apiKey,
        body: { username },
      });
      return true;
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        '[SendGridWhitelabelService] Associate link branding with subuser failed',
      );
      return false;
    }
  }

  public async deleteDomainAuthentication(id: number, apiKey?: string, subuser?: string): Promise<void> {
    if (!this.isValidApiKey(apiKey)) return;

    try {
      await this.request(`/whitelabel/domains/${id}`, {
        method: 'DELETE',
        apiKey,
        subuser,
      });
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        '[SendGridWhitelabelService] Delete domain authentication failed',
      );
    }
  }

  public async deleteLinkBranding(id: number, apiKey?: string, subuser?: string): Promise<void> {
    if (!this.isValidApiKey(apiKey)) return;

    try {
      await this.request(`/whitelabel/links/${id}`, {
        method: 'DELETE',
        apiKey,
        subuser,
      });
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        '[SendGridWhitelabelService] Delete link branding failed',
      );
    }
  }

  public async verifyDmarc(domain: string): Promise<boolean> {
    try {
      const records = await dns.resolveTxt(`_dmarc.${domain}`);
      return records.some((r) => r.join('').toUpperCase().includes('V=DMARC1'));
    } catch {
      return false;
    }
  }

  public async verifyCname(host: string, expectedData?: string): Promise<boolean> {
    try {
      const records = await dns.resolveCname(host);
      if (expectedData) {
        return records.some((r) => r.toLowerCase().trim() === expectedData.toLowerCase().trim());
      }
      return records.length > 0;
    } catch {
      return false;
    }
  }
}
