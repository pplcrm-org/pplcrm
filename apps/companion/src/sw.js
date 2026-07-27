/* global self, caches, fetch, Response, URL */
/**
 * Companion service worker.
 *
 * Runs in the ServiceWorkerGlobalScope, not the window — hence the `global` declaration above,
 * which is how a flat ESLint config learns about `self`/`caches`/`fetch` here. It is plain JS on
 * purpose: it is copied verbatim to the output root as an asset, never bundled.
 *
 * The problem this solves: canvassers and delivery drivers work in dead zones. `canvass-store.ts`
 * already queues their actions in localStorage so a shift survives losing signal — but if the tab
 * was reloaded or reopened with no connection, the app shell itself never loaded, so they could
 * not reach that queue at all. The offline machinery was there; the page to run it in was not.
 *
 * Deliberately hand-written rather than @angular/service-worker: ngsw needs a build-time asset
 * manifest, and this app's need is narrower — keep the shell reachable, never interfere with data.
 *
 * Strategy, in short: the shell is cache-first so it boots with no network; navigations are
 * network-first so a deploy is picked up as soon as there is signal; API calls are never touched,
 * because a stale answer about who has been canvassed is worse than an honest failure the store
 * already knows how to queue around.
 */

// Bump to evict everything from older builds. Hashed filenames make collisions unlikely, but this
// is the escape hatch if a bad asset is ever cached.
const CACHE = 'pplcrm-companion-v1';

/** Requests that must always hit the network — see the note about stale canvass data above. */
function isApiRequest(url) {
  return url.pathname.startsWith('/api/');
}

/** Build output we are willing to serve from cache: same-origin static assets. */
function isCacheableAsset(url) {
  return (
    url.origin === self.location.origin &&
    /\.(?:js|css|woff2?|ttf|png|jpe?g|svg|webp|ico|webmanifest)$/i.test(url.pathname)
  );
}

self.addEventListener('install', (event) => {
  // Cache the shell up front so the very first offline reload works, even if the volunteer never
  // navigated anywhere else. Failure is non-fatal: runtime caching below still fills in.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(['/', '/index.html']))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (isApiRequest(url)) return; // straight to the network, always

  // Navigations: network-first, falling back to the cached shell. Angular routes are client-side,
  // so any path resolves to index.html — which is what makes /t/:token and /r/:token work offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html').then((cached) => cached ?? Response.error())),
    );
    return;
  }

  if (!isCacheableAsset(url)) return;

  // Assets: cache-first. Filenames are content-hashed by the build, so a hit is always correct.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
