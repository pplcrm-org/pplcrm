import { environment } from '../../environments/environment';

/**
 * Helpers for the tenant-subdomain public page model. Every public surface (forms /f/:slug,
 * event RSVP /e/:slug, volunteer /volunteer + /v/:slug, donations) lives on
 * `https://<tenantSlug>.<publicBaseDomain>/<path>`; the SPA passes its own subdomain to the API as
 * `?t=` so tenant resolution works on any host (including dev, where the Host header is enough in
 * Chrome via `<slug>.localhost` but not guaranteed elsewhere).
 */

/**
 * Base for public-page API calls (unauthenticated `fetch` to REST `/api/*`).
 *
 * In production these pages are served on the dedicated public origin `<org>.pplforms.com`, whose
 * reverse proxy forwards `/api` and `/d` to the backend. So public calls must be **same-origin**
 * (origin-relative `''`) — hitting the absolute `api.pplcrm.com` origin would be cross-origin and
 * CORS-blocked (CORS is deliberately locked to the CRM origin only). In dev we keep the absolute
 * `apiUrl`, which the backend CORS already allows for `localhost:4200`.
 */
export function apiBase(): string {
  return environment.production ? '' : environment.apiUrl.replace(/\/$/, '');
}

/**
 * The tenant subdomain the current page is being served on
 * (`riverton.mydomain.com` → `riverton`), or null on the bare app host.
 */
export function tenantFromHost(): string | null {
  const host = window.location.hostname.toLowerCase();
  const base = environment.publicBaseDomain.toLowerCase();
  if (!host || host === base) return null;
  const suffix = `.${base}`;
  if (!host.endsWith(suffix)) return null;
  const label = host.slice(0, -suffix.length);
  if (!label || label.includes('.')) return null;
  return label;
}

/** `?t=<tenant>` query suffix for public API calls made from a public page. */
export function tenantQuery(): string {
  const tenant = tenantFromHost();
  if (tenant) return `?t=${encodeURIComponent(tenant)}`;
  // Bare-host fallback: forward a `?t=` the current URL already carries. Dev portal links are
  // minted on the app origin with `?t=<slug>` (no wildcard DNS locally), and without this the
  // SPA silently dropped the tenant and every request 404'd. Safe in production: the pplforms
  // edge overwrites `?t=` with the real subdomain on every proxied call, so a URL-supplied
  // value can never point a tenant's page at another workspace.
  const t = new URLSearchParams(window.location.search).get('t');
  return t ? `?t=${encodeURIComponent(t)}` : '';
}

/**
 * Shareable public URL for authenticated admin UI: `https://<tenantSlug>.<base>/<path>`, falling
 * back to the current origin when no tenant subdomain is configured (dev without wildcard DNS).
 * `path` must not start with a slash.
 */
export function publicPageUrl(tenantSlug: string | null | undefined, path: string): string {
  const base = environment.publicBaseDomain;
  if (tenantSlug && base) {
    return `https://${tenantSlug}.${base}/${path}`;
  }
  return `${window.location.origin}/${path}`;
}

/**
 * Public URL for a donation page. Donation pages are **server-rendered by the backend** (they carry
 * the Stripe checkout), not an SPA route. In production they're served at
 * `<org>.pplforms.com/d/:slug` — the pplforms edge Worker rewrites `/d/*` → the backend's
 * `/api/forms/d/*` and injects `?t=<org>` from the subdomain. In dev there's no Worker, so hit the
 * backend directly with an explicit `?t=`.
 */
export function donationPageUrl(tenantSlug: string | null | undefined, slug: string): string {
  if (environment.production) {
    return publicPageUrl(tenantSlug, `d/${slug}`);
  }
  const t = tenantSlug ? `?t=${encodeURIComponent(tenantSlug)}` : '';
  return `${environment.apiUrl.replace(/\/$/, '')}/api/forms/d/${slug}${t}`;
}

/**
 * Absolute URL to a volunteer companion surface (canvass `/t/:token`, deliveries `/r/:token`). In
 * production the companion apps are path-routed on the CRM's own domain, so we use the current
 * origin; in dev they run on a separate port, so `environment.companionOrigin` overrides it —
 * otherwise a copied link would point back at the CRM host and 404. `path` must start with a slash.
 */
export function companionUrl(path: string): string {
  return `${environment.companionOrigin || window.location.origin}${path}`;
}

/** Which channels the backend sent a volunteer's personal link through on assignment. */
export interface VolunteerLinkSent {
  email: boolean;
  sms: boolean;
}

/**
 * Human phrasing for the assignment toast: 'link sent by email and text', or null when
 * nothing could be sent (no contacts on file) — callers warn and point at Copy link.
 */
export function volunteerLinkSentPhrase(sent: VolunteerLinkSent | null | undefined): string | null {
  if (!sent || (!sent.email && !sent.sms)) return null;
  const channels = [sent.email ? 'email' : null, sent.sms ? 'text' : null].filter(Boolean).join(' and ');
  return `link sent by ${channels}`;
}
