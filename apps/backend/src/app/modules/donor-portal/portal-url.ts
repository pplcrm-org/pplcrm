import { env } from '../../../env';

/**
 * The donor's personal giving-page URL. Production: the org's public subdomain
 * (https://<slug>.pplforms.com/g/<token>). Dev, where publicBaseDomain is 'localhost':
 * the app origin with the tenant carried in `?t=` — resolveTenantFromRequest honors it.
 */
export function donorPortalUrl(tenantSlug: string, rawToken: string): string {
  const base = env.publicBaseDomain?.toLowerCase();
  if (base && base !== 'localhost') {
    return `https://${tenantSlug}.${base}/g/${rawToken}`;
  }
  return `${env.appUrl}/g/${rawToken}?t=${encodeURIComponent(tenantSlug)}`;
}

/** Append a query parameter, honest about whether the URL already carries a query string. */
export function withParam(url: string, key: string, value: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}${key}=${value}`;
}
