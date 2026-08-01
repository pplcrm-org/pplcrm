# pplforms-edge

Cloudflare Worker that serves `*.pplforms.com` — the public tenant surfaces (form `/f/:slug`, event
RSVP `/e/:slug`, volunteer `/v/:slug`, donation `/d/:slug`). It replaces what would otherwise be an
nginx VM: it serves the built Angular SPA as static assets, reverse-proxies `/api/*` to the CRM
backend, and serves the server-rendered donation page by rewriting `/d/:slug` → the backend's
`/api/forms/d/:slug`. Every public call is same-origin, which is why backend CORS stays locked to the
CRM origin. See [`src/index.ts`](src/index.ts) for the reasoning.

On any host whose subdomain names an organization, the Worker **sets `?t=<org>` from that subdomain
on every request it forwards**, overwriting whatever the caller supplied. This applies to both the
`/d/:slug` rewrite and the `/api/*` proxy. Without it the subdomain was only a default: a link of the
form `https://trusted-org.pplforms.com/d/<slug>?t=other-org` rendered another organization's donation
page under a trusted organization's hostname, and the payment settled into that other organization's
connected Stripe account. On the apex and on `www` the subdomain names no organization, so the query
string is forwarded untouched.

## One-time setup

1. **Add `pplforms.com` as a Cloudflare zone.** Point the registrar's nameservers at the two
   Cloudflare NS. Wait for the zone to show **Active**.
2. **Confirm Universal SSL covers the wildcard.** SSL/TLS → Edge Certificates should list a cert
   for `pplforms.com` and `*.pplforms.com`. Universal SSL covers **one level** only
   (`riverton.pplforms.com` ✓, `a.b.pplforms.com` ✗) — which matches the resolver rejecting nested
   labels. Set the zone's SSL/TLS mode to **Full (strict)**.
3. **Add a proxied wildcard DNS record** so Cloudflare answers for the subdomains and the Worker
   route fires. In the `pplforms.com` zone, DNS → Records:
   - Type `AAAA`, Name `*`, IPv6 `100::` (the discard prefix — traffic never reaches it; the Worker
     intercepts), **Proxied (orange)**.
   - (An `A *` → `192.0.2.1` proxied works equally; the address is a placeholder either way.)
4. **Set the backend base domain.** In the backend's prod environment, set
   `PUBLIC_BASE_DOMAIN=pplforms.com` (frontend `environment.prod.ts` already has
   `publicBaseDomain: 'pplforms.com'`). The backend still reads the `?t=<org>` query first; behind
   this Worker that value is always the one the subdomain dictates, so Host-based resolution is the
   fallback for requests that reach the API hostname directly rather than through the Worker.

## Deploy

From this directory:

```bash
# 1. Build the SPA that the Worker serves (outputs ../../dist/apps/frontend/browser)
npx nx build frontend --configuration=production

# 2. Authenticate once (or use CLOUDFLARE_API_TOKEN in CI)
npx wrangler login

# 3. Publish the Worker + upload the static assets + bind the route
npx wrangler deploy
```

> Verify the asset directory after the first build. Angular's application builder emits to
> `dist/apps/frontend/browser`; if your build emits directly to `dist/apps/frontend`, update
> `[assets].directory` in `wrangler.toml`.

Redeploy (`npx wrangler deploy`) on every frontend release — the static assets are uploaded at
deploy time, so a new SPA build isn't live until you redeploy.

## Verify

```bash
# Static SPA (any org subdomain) — expect 200 and the app shell HTML
curl -sSI https://riverton.pplforms.com/f/some-slug | head -n1

# Same-origin API proxy — expect the backend's JSON (404 "Form not found." for a bogus slug on a
# real org, NOT the SPA index.html). Swap `riverton` for a real org subdomain.
curl -sS "https://riverton.pplforms.com/api/forms/f/does-not-exist?t=riverton" | head -c 200; echo

# Donation page rewrite — /d/:slug should reach the backend's server-rendered page (donation HTML
# for a real published slug; 403 for an org that hasn't acknowledged residency; 404 for a bogus one).
curl -sS "https://riverton.pplforms.com/d/does-not-exist" -o /dev/null -w '%{http_code}\n'
```

If `/api/*` returns the SPA HTML instead of the backend's JSON, `run_worker_first` isn't taking
effect — confirm your `wrangler` version supports it under `[assets]` and that the deploy picked up
`wrangler.toml`.

## Notes

- **Body size:** uploads inherit Cloudflare's 100 MB request-body ceiling; the backend caps
  multipart at 50 MB. The Worker streams the body through (`duplex: 'half'`), so it adds no limit of
  its own.
- **`go.pplcrm.com` (companion apps)** is the same shape — static companion SPA + `/api` proxy — and
  can be a sibling Worker modeled on this one.
