/**
 * Recovery for a lazy-route chunk the browser could not import.
 *
 * Every dynamic `import()` in this app is a lazy route, and every chunk filename is content-hashed,
 * so a deploy replaces the whole set at once. app.pplcrm.com is a Cloudflare Pages site whose
 * `/*  /index.html  200` SPA fallback answers a missing asset with HTML rather than a 404, so a
 * request for a chunk that is momentarily unavailable comes back as a page — which the browser
 * rejects with "Expected a JavaScript-or-Wasm module script but the server responded with a MIME
 * type of text/html", surfacing to us as a `TypeError`.
 *
 * Two things make this outlive the moment it happens:
 *
 * 1. `withPreloading(PreloadAllModules)` imports every lazy chunk in the background after first
 *    paint, and Angular's `PreloadAllModules` swallows preload failures (`catchError(() => of(null))`).
 *    So a single hiccup during that burst is invisible.
 * 2. Per the module spec, a module URL that failed to load stays failed in the document's module
 *    map. The later real navigation re-runs the same `import()` and fails instantly — no retry, no
 *    network request — with the server perfectly healthy.
 *
 * Retrying in-page therefore cannot work; only a fresh document can. Hence a hard navigation, and
 * a one-per-cooldown claim so a genuinely missing chunk cannot turn into a reload loop.
 */

/** Shown when the app could not load a page's code and a hard reload was not available. */
export const STALE_BUNDLE_MESSAGE =
  'That page could not be loaded. Refresh the page to pick up the latest version of the app.';

/** How the four engines word a failed dynamic `import()`, lowercased. */
const STALE_BUNDLE_MESSAGES = [
  'failed to fetch dynamically imported module', // Chrome / Edge
  'error loading dynamically imported module', // Firefox
  'importing a module script failed', // Safari
  'failed to load module script', // Chrome, when the response MIME type is wrong
] as const;

const RELOAD_MARKER_KEY = 'pplcrm.stale-bundle-reload';

/**
 * Long enough to outlast one reload-and-navigate cycle (so a chunk that is genuinely gone from the
 * deployment reloads once and then reports itself), short enough that a second, unrelated failure
 * minutes later still self-heals.
 */
const RELOAD_COOLDOWN_MS = 30_000;

/** True when `error` is the browser refusing a lazy chunk, whatever engine phrased it. */
export function isStaleBundleError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (!message) return false;
  const lowered = message.toLowerCase();
  return STALE_BUNDLE_MESSAGES.some((known) => lowered.includes(known));
}

/**
 * Asks for permission to hard-reload, recording the attempt so the next one inside the cooldown is
 * refused. Returns false when the caller must tell the user instead — either a reload just
 * happened (so reloading again would loop) or `sessionStorage` is unavailable, which leaves no way
 * to tell a first failure from a loop.
 */
export function claimReloadForStaleBundle(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_MARKER_KEY));
    if (Number.isFinite(last) && Date.now() - last < RELOAD_COOLDOWN_MS) return false;
    sessionStorage.setItem(RELOAD_MARKER_KEY, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}
