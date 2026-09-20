const CACHE = 'psycle-58f76483';
const SHELL = [
  './psycle-finder.html',
  './index.html',
  './login.html',
  './manifest.json',
  './fonts/sofia-sans-condensed.woff2',
  './fonts/sofia-sans.woff2',
  './css/crisp.css',
  './css/discover-layout-fix.css',
  './css/explore.css',
  './css/features.css',
  './css/redesign.css',
  './css/settings.css',
  './css/styles.css',
  './css/tabs.css',
  './css/theme.css',
  './js/api-client.js',
  './js/app.js',
  './js/calendar.js',
  './js/diagnostic.js',
  './js/explore.js',
  './js/facets.js',
  './js/features.js',
  './js/interactions.js',
  './js/performance.js',
  './js/reliability.js',
  './js/security.js',
  './js/settings.js',
  './js/state.js',
  './js/tabs.js',
  './js/theme.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    // cache: 'reload' bypasses the browser HTTP cache. Without it a
    // conditional revalidation can return 304, which makes addAll reject
    // (silently failing the whole install), and stale cached bytes can
    // defeat the version bump.
    caches.open(CACHE)
      .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// How long a page navigation waits for the network before the cached copy of
// that page is shown instead (see the isHtml branch below).
const NAV_TIMEOUT_MS = 3000;

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Always network-first for API calls
  if (url.hostname.includes('psycle.codexfit') || url.hostname.includes('corsproxy')) {
    return; // fall through to network
  }

  // Network-first for HTML documents so a new deploy (with a bumped CACHE
  // version) takes effect on the next load instead of being served stale.
  // Falls back to cache when offline.
  const isHtml =
    e.request.mode === 'navigate' ||
    (e.request.destination === 'document') ||
    url.pathname.endsWith('.html') ||
    url.pathname === '/' || url.pathname.endsWith('/');

  if (isHtml) {
    // Opening one of OUR pages: network-first still, but not hostage to a
    // stalled connection. fetch() only rejects once the browser gives up —
    // tens of seconds of white screen on one bar of signal, with the whole
    // shell sitting in the cache. When a copy of the page asked for is cached,
    // the network gets NAV_TIMEOUT_MS to answer before that copy is shown;
    // the request carries on behind it (waitUntil) so the cache still
    // refreshes for next time. Same-origin navigations only — isHtml also
    // matches any URL ending in "/" or ".html" — and only for a page that IS
    // cached: anything else keeps the plain path below.
    if (e.request.mode === 'navigate' && url.origin === self.location.origin) {
      let stored = Promise.resolve();
      const net = fetch(e.request).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          stored = caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      });
      e.waitUntil(net.then(() => stored, () => {}));
      e.respondWith(
        // ignoreSearch: "?theme=…" and other query strings open the same page.
        // A cache that cannot be read counts as "nothing cached".
        caches.match(e.request, { ignoreSearch: true }).catch(() => undefined).then(cached => {
          if (!cached) {
            return net.catch(() => caches.match('./psycle-finder.html').then(c => c || Response.error()));
          }
          return Promise.race([
            net.catch(() => cached),
            new Promise(resolve => setTimeout(() => resolve(cached), NAV_TIMEOUT_MS)),
          ]);
        })
      );
      return;
    }

    e.respondWith(
      fetch(e.request)
        .then(res => {
          // Cache a clone of the fresh HTML for offline fallback
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(e.request).then(c => c || caches.match('./psycle-finder.html')))
    );
    return;
  }

  // Cache-first for static assets (JS/CSS/images), with runtime caching of
  // anything that wasn't in the precache SHELL — a hand-maintained (or
  // generated) SHELL can lag behind new assets, and without this fallback
  // those assets would 404 offline despite the app "supporting offline".
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
