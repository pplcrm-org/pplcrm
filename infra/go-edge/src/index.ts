/**
 * go-edge — the reverse proxy for `go.pplcrm.com` (the volunteer companion app).
 *
 * Runs at the Cloudflare edge. Two jobs:
 *   1. Serve the built companion Angular SPA as static assets, with SPA fallback to index.html:
 *      `/t/:token` canvass, `/r/:token` deliveries, `/j/:code` QR join, `/a/:token` approve-by-text,
 *      and `/canvass` (session-first — no URL credential at all).
 *   2. Forward the companion's backend surface (`/api/*`) to the CRM backend unchanged.
 *
 * This makes every companion call **same-origin** on `go.pplcrm.com`, which is why backend CORS
 * stays locked to the CRM origin (do NOT widen it). The companion resolves its tenant from the
 * opaque token or code in the path — or, on `/canvass`, from the device session header (see
 * apps/backend/src/app/modules/companion-access) — so, unlike the pplforms forms surface, there is
 * no `?t=<org>` injection and no `/d/` donation rewrite here.
 */

interface Env {
  /** Static-assets binding — the built `dist/apps/companion/browser` bundle (see wrangler.toml). */
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  /** Backend origin bound on the Container App, e.g. `https://api.pplcrm.com`. */
  BACKEND_ORIGIN: string;
}

async function proxyToBackend(request: Request, target: string): Promise<Response> {
  const originalHost = new URL(request.url).host;
  const headers = new Headers(request.headers);
  // Drop the inbound Host (go.pplcrm.com) so fetch sets it from the target — the Container App only
  // routes its own bound hostname.
  headers.delete('host');
  headers.set('x-forwarded-host', originalHost);
  headers.set('x-forwarded-proto', 'https');

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: 'manual',
    // Bound how long a dead/hung backend can hold the request open. Note this also aborts
    // slow response *bodies* — acceptable on this thin surface.
    signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
    (init as RequestInit & { duplex: 'half' }).duplex = 'half';
  }

  return fetch(target, init);
}

const BACKEND_TIMEOUT_MS = 30_000;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Companion backend surface → proxy unchanged. Everything else is the static SPA.
    if (url.pathname.startsWith('/api/')) {
      // The await matters: without it the rejected promise escapes the try. fetch only *throws* on
      // network-level failure (backend down, DNS, timeout) — backend 5xx responses pass through.
      try {
        return await proxyToBackend(request, `${env.BACKEND_ORIGIN}${url.pathname}${url.search}`);
      } catch {
        return new Response(
          JSON.stringify({
            status: 'unavailable',
            message: 'pplCRM is temporarily unreachable. Please try again in a minute.',
          }),
          { status: 503, headers: { 'content-type': 'application/json', 'retry-after': '30' } },
        );
      }
    }

    return env.ASSETS.fetch(request);
  },
};
