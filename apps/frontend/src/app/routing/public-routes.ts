/**
 * Routes reachable without an authenticated session. A stray UNAUTHORIZED/401 from a background
 * query on one of these pages must NOT evict the visitor to /signin — the whole point of a reset
 * link, public form, or subscription-confirmation page is that guests land on it. Keep this in sync
 * with the public (unguarded) entries in app.routes.ts.
 *
 * Prefixes ending in '/' match a path segment family (e.g. '/f/' → '/f/:slug'); the rest match the
 * exact path or a deeper child of it.
 */
export const PUBLIC_ROUTE_PREFIXES = [
  '/signin',
  '/signup',
  '/resetpassword',
  '/new-password',
  '/verify-sender-email',
  '/verify-email',
  '/confirm-subscription',
  '/cancel-deletion',
  '/resume-account',
  '/volunteer',
  '/f/',
  '/e/',
  '/v/',
  '/g',
] as const;

export function isPublicRoute(url: string): boolean {
  const path = url.split(/[?#]/)[0] ?? url;
  return PUBLIC_ROUTE_PREFIXES.some((prefix) =>
    prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix || path.startsWith(`${prefix}/`),
  );
}

/**
 * Whether the visitor is currently on a public page, robust to app-startup timing.
 *
 * During `provideAppInitializer` the Angular Router has not yet processed the deep link, so
 * `Router.url` is still '/', even though the browser address bar already holds e.g. '/new-password'.
 * The startup `currentUser()` probe 401s for a guest at exactly that moment, so a check against
 * `Router.url` alone would wrongly bounce a guest off a public page. Trust either source.
 */
export function isCurrentRoutePublic(routerUrl: string): boolean {
  if (isPublicRoute(routerUrl)) return true;
  if (typeof window === 'undefined') return false;
  return isPublicRoute(window.location.pathname);
}
