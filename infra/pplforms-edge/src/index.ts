/**
 * pplforms-edge — the reverse proxy for `*.pplforms.com` (public tenant surfaces).
 *
 * Runs at the Cloudflare edge in place of a VM. Three jobs:
 *   1. Serve the built Angular SPA (public form `/f/:slug`, event RSVP `/e/:slug`, volunteer
 *      `/v/:slug`) as static assets, with SPA fallback to index.html.
 *   2. Forward the backend's public REST surface (`/api/*`) to the CRM backend.
 *   3. Serve the server-rendered donation page: rewrite `/d/:slug` → the backend's
 *      `/api/forms/d/:slug`.
 *
 * On both proxied paths the request hostname decides the tenant: `?t=<org>` is set from the
 * subdomain, overwriting anything the caller sent (see `forwardedSearch`).
 *
 * All of this makes every public call **same-origin** on `<org>.pplforms.com`, which is why backend
 * CORS stays locked to the CRM origin (do NOT widen it). See
 * apps/frontend/src/app/shared/public-pages.ts (`apiBase()` returns '' in production;
 * `donationPageUrl()` builds `<org>.pplforms.com/d/:slug`) and
 * apps/backend/src/app/lib/public-tenant.ts (tenant resolves from `?t=` first).
 *
 * The donation page's own links are relative with `?t=` baked in (form action
 * `/api/forms/submit/:slug?t=…`, success redirect `/api/forms/success`), so once it's served here
 * the submit POST and redirect ride the `/api/*` proxy above.
 */

interface Env {
  /** Static-assets binding — the built `dist/apps/frontend/browser` bundle (see wrangler.toml). */
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  /** Backend origin bound on the Container App, e.g. `https://api.pplcrm.com`. */
  BACKEND_ORIGIN: string;
}

/** The org for `<org>.pplforms.com`, or null for the apex / an unexpected host shape. */
function orgFromHost(hostname: string): string | null {
  const parts = hostname.toLowerCase().split('.');
  // `<org>.pplforms.com` → 3+ labels; the left-most label is the org.
  if (parts.length < 3) return null;
  const label = parts[0];
  return label && label !== 'www' ? label : null;
}

/**
 * The query string to forward to the backend, with `t` forced to the org in the request hostname.
 *
 * The subdomain is the authority on which tenant a public page belongs to, not a default. The
 * backend prefers `?t=` over the Host header (apps/backend/src/app/lib/public-tenant.ts,
 * `resolveTenantFromRequest`), so while this Worker only filled `t` in when the caller had omitted
 * it, `https://trusted-org.pplforms.com/d/x?t=attacker-org` rendered the attacker's donation page
 * under the trusted org's hostname — and its Stripe Connect direct charge collected the money into
 * the attacker's connected account. Overwriting `t` closes that: on an org subdomain, every proxied
 * request resolves to that org and nothing else.
 *
 * Hosts that name no org (the apex, `www`, anything under three labels) keep the caller's query
 * byte-for-byte, exactly as before — they have no subdomain to assert.
 */
function forwardedSearch(url: URL): string {
  const org = orgFromHost(url.hostname);
  if (!org) return url.search;
  const params = new URLSearchParams(url.search);
  params.set('t', org);
  // Non-empty by construction: `t` was just set.
  return `?${params.toString()}`;
}

/**
 * Map a public request URL to its backend target, or null when it should be served as a static
 * asset instead.
 */
function backendTarget(url: URL, env: Env): string | null {
  const isDonationPage = url.pathname.startsWith('/d/');
  if (!isDonationPage && !url.pathname.startsWith('/api/')) return null;
  // Both proxied paths get the subdomain's `t`: on `<org>.pplforms.com` every legitimate API call
  // (form config, submit, event RSVP) originates from that org's own page.
  const search = forwardedSearch(url);
  // Donation page: /d/:slug → /api/forms/d/:slug. Everything else under /api/* keeps its path.
  return isDonationPage
    ? `${env.BACKEND_ORIGIN}/api/forms/d/${url.pathname.slice('/d/'.length)}${search}`
    : `${env.BACKEND_ORIGIN}${url.pathname}${search}`;
}

async function proxyToBackend(request: Request, target: string): Promise<Response> {
  const originalHost = new URL(request.url).host;
  const headers = new Headers(request.headers);
  // Drop the inbound Host (`<org>.pplforms.com`) so fetch sets it from the target — the Container
  // App only routes its own bound hostname.
  headers.delete('host');
  headers.set('x-forwarded-host', originalHost); // original public host, for backend logging
  headers.set('x-forwarded-proto', 'https');

  const init: RequestInit = {
    method: request.method,
    headers,
    // Preserve backend 3xx (e.g. donation redirects to the payment provider) verbatim.
    redirect: 'manual',
    // Bound how long a dead/hung backend can hold the request open. Note this also aborts
    // slow response *bodies* — acceptable on this thin surface.
    signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
    // Required by the Streams spec when a request body is a ReadableStream.
    (init as RequestInit & { duplex: 'half' }).duplex = 'half';
  }

  return fetch(target, init);
}

const BACKEND_TIMEOUT_MS = 30_000;

const UNAVAILABLE_MESSAGE = 'pplCRM is temporarily unreachable. Please try again in a minute.';

/** The backend is down/unreachable — a browser navigation (donation page /d/*) gets a tiny page. */
function unavailableHtml(): Response {
  const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Temporarily unavailable</title>
<style>
  body { font-family: system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; background: #f6f6f7; color: #1f2328; }
  main { text-align: center; padding: 2rem; }
  h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 .5rem; }
  p { margin: 0; color: #57606a; }
</style>
<main>
  <h1>Temporarily unavailable</h1>
  <p>${UNAVAILABLE_MESSAGE}</p>
</main>
</html>`;
  return new Response(html, {
    status: 503,
    headers: { 'content-type': 'text/html; charset=utf-8', 'retry-after': '30' },
  });
}

/** API callers get JSON in the backend's jsend-ish error shape. */
function unavailableJson(): Response {
  return new Response(JSON.stringify({ status: 'unavailable', message: UNAVAILABLE_MESSAGE }), {
    status: 503,
    headers: { 'content-type': 'application/json', 'retry-after': '30' },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const target = backendTarget(url, env);

    // No backend target → the static SPA. `not_found_handling` in wrangler.toml serves index.html
    // for unmatched client routes.
    if (target == null) {
      return env.ASSETS.fetch(request);
    }

    // The await matters: without it the rejected promise escapes the try.
    try {
      return await proxyToBackend(request, target);
    } catch {
      // fetch only *throws* on network-level failure (backend down, DNS, timeout) — backend 5xx
      // responses pass through above untouched.
      return url.pathname.startsWith('/d/') ? unavailableHtml() : unavailableJson();
    }
  },
};
