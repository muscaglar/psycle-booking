/**
 * performance.js — Performance enhancements for Psycle Booking PWA
 *
 * A. Debounced instructor search (200ms)
 * C. Stale-while-revalidate API response caching for static lists
 *
 * (B, placeholder-based virtual scrolling, is gone: it had been switched off
 * since the redesign — the placeholder→card swap read as the list "refreshing"
 * — yet still wrapped eventCard() and render() on every call.)
 *
 * Loaded after app.js and reliability.js. Monkey-patches globals defined there.
 */

// ── A. Debounce Utility ────────────────────────────────────────────

/**
 * Returns a debounced version of `fn` that delays invocation until
 * `ms` milliseconds have elapsed since the last call.
 */
function debounce(fn, ms) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

// Wrap the instructor search input with a debounced handler.
// The HTML wires `oninput="filterInstrDropdown()"` on #instrSearch — we replace it
// with a debounced version so rapid typing doesn't re-render the dropdown on every keystroke.
(function patchInstrSearchDebounce() {
  if (typeof filterInstrDropdown !== 'function') {
    console.warn('[perf] filterInstrDropdown not found — skipping debounce patch');
    return;
  }

  const _origFilterInstrDropdown = filterInstrDropdown;
  const debouncedFilter = debounce(_origFilterInstrDropdown, 200);

  // Replace the global so any inline oninput="filterInstrDropdown()" calls use the debounced version.
  window.filterInstrDropdown = debouncedFilter;

  // Also patch the input element directly in case the browser cached the inline handler reference.
  function patchInputElement() {
    const input = document.getElementById('instrSearch');
    if (input) {
      input.oninput = debouncedFilter;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', patchInputElement);
  } else {
    patchInputElement();
  }
})();


// ── C. API Response Caching (Stale-While-Revalidate) ───────────────

const CACHE_PREFIX = 'psycle_cache_';
const TTL_24H = 24 * 60 * 60 * 1000; // 24 hours in ms

// ── pure:static-cache:start ── (DOM-free; tests/suites/offline.js evaluates this block)
// Does the entry hold a list worth serving at all? An empty or poisoned 200
// that got cached must never be the answer: app.js's init IIFE would take it
// as the studio list, and since a background refresh only lands in
// localStorage, Discover sat on "Loading studios…" for the whole launch.
function _staticCacheHasList(cached) {
  const list = cached && cached.data && cached.data.data;
  return Array.isArray(list) && list.length > 0;
}
// Is a cached static list still good enough to skip the network altogether?
// Only inside its TTL — and only when the clock has not gone backwards since
// it was written (a back-dated device clock must not pin the entry for ever).
// A usable list outside that: serve it, but refresh behind it.
function _staticCacheIsFresh(cached, ttlMs, nowMs) {
  if (!_staticCacheHasList(cached)) return false;
  const age = nowMs - (Number(cached.timestamp) || 0);
  return age >= 0 && age < ttlMs;
}
// What the patched apiFetch does with the entry it found:
//   'cache'      a usable list inside its TTL — the whole answer, no request;
//   'revalidate' a usable list that is old, or whose age can't be trusted —
//                served at once, refreshed behind the caller;
//   'network'    nothing servable — the caller waits for the network, and its
//                answer overwrites whatever was there.
function _staticCacheDecision(cached, ttlMs, nowMs) {
  if (!_staticCacheHasList(cached)) return 'network';
  return _staticCacheIsFresh(cached, ttlMs, nowMs) ? 'cache' : 'revalidate';
}
// ── pure:static-cache:end ──

/**
 * Patch apiFetch so that GET requests to cacheable endpoints are served
 * from localStorage when cache data is available. A copy younger than its TTL
 * is the whole answer (no request); an older one is returned at once and
 * refreshed in the background (stale-while-revalidate). A copy with no list in
 * it (an empty or malformed 200 that got cached) is never served.
 *
 * app.js's init IIFE asks for /instructors, /locations and /event-types only
 * once every module has run (it waits for DOMContentLoaded — all of them are
 * deferred scripts), so this patch, and reliability.js's retrying apiFetch
 * underneath it, are in place: three requests saved per launch inside the TTL,
 * and a refresh past it is retried like any other GET. Waiting for
 * securityReady alone was not enough: IndexedDB has usually answered while the
 * scripts were still arriving, so init carried on in the microtask right after
 * app.js — before this file existed — and all three went out bare on most warm
 * launches. A background refresh only lands in localStorage — the in-memory
 * lists pick it up on the next launch.
 */
(function patchApiFetchForCaching() {
  const CACHEABLE_PATHS = {
    '/instructors':  TTL_24H,
    '/locations':    TTL_24H,
    '/event-types':  TTL_24H,
  };

  if (typeof apiFetch !== 'function') {
    console.warn('[perf] apiFetch not found — skipping cache patch');
    return;
  }

  const _origApiFetch = apiFetch;

  window.apiFetch = function patchedApiFetch(path, opts) {
    // Only cache GET requests (no opts.method or method === 'GET')
    const method = (opts && opts.method) ? opts.method.toUpperCase() : 'GET';
    if (method !== 'GET') {
      return _origApiFetch(path, opts);
    }

    // Check if this path is cacheable
    const ttl = CACHEABLE_PATHS[path];
    if (!ttl) {
      return _origApiFetch(path, opts);
    }

    const cacheKey = CACHE_PREFIX + path.replace(/^\//, '');
    let cached = null;
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) cached = JSON.parse(raw);
    } catch {
      // ignore
    }

    // An entry without a usable list is treated as no cache: the network is
    // awaited below (and its answer overwrites the bad entry), so a failure
    // reaches the caller's Reload error instead of an endless spinner.
    const decision = _staticCacheDecision(cached, ttl, Date.now());
    if (decision !== 'network') {
      // Return cached data as a fake Response. Inside the TTL that is all —
      // `ttl` used to be a truthiness test only, so all three lists were
      // re-downloaded on every launch. Past it (or for a copy that can't be
      // trusted) revalidate in the background — through _origApiFetch, which
      // is reliability.js's retrying wrapper.
      if (decision === 'revalidate') {
        _origApiFetch(path, opts).then(async (res) => {
          if (res.ok) {
            try {
              const data = await res.json();
              localStorage.setItem(cacheKey, JSON.stringify({
                data: data,
                timestamp: Date.now(),
              }));
            } catch {}
          }
        }).catch(() => {});
      }

      // Return a Response-like object so callers can chain .then(r => r.json())
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(cached.data),
      });
    }

    // No cache — do a real fetch and cache the result
    return _origApiFetch(path, opts).then(async (res) => {
      if (res.ok) {
        // Clone so we can read the body for caching while the caller reads the original
        const clone = res.clone();
        try {
          const data = await clone.json();
          localStorage.setItem(cacheKey, JSON.stringify({
            data: data,
            timestamp: Date.now(),
          }));
        } catch {}
      }
      return res;
    });
  };
})();

/**
 * Eager cache pre-population: app.js's init IIFE is still waiting on
 * securityReady (slow on iOS) when this script loads. On repeat visits the
 * cache already has data from a previous session, so we read it here and
 * pre-populate the global arrays (instructors, locations, eventTypes): the
 * filters render immediately instead of after the token has been decrypted.
 *
 * When the init IIFE's own answers arrive (the cached copy again inside the
 * TTL, the network otherwise) it re-assigns these arrays.
 */
(function eagerCachePrePopulate() {
  function readCache(key) {
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      // A poisoned entry (no list in it) used to throw in the .filter below.
      return _staticCacheHasList(entry) ? entry.data : null;
    } catch {
      return null;
    }
  }

  const cachedInstructors = readCache('instructors');
  const cachedLocations   = readCache('locations');
  const cachedEventTypes  = readCache('event-types');

  // Only pre-populate if the globals exist and are still empty
  // (meaning the init IIFE hasn't resolved yet)
  if (cachedInstructors && typeof instructors !== 'undefined' && instructors.length === 0) {
    const visible = (cachedInstructors.data || cachedInstructors).filter(i => i.is_visible);
    visible.sort((a, b) => a.full_name.localeCompare(b.full_name));
    // Assign to the global array (mutate in place so existing references see it)
    instructors.push(...visible);
    // Re-render the dropdown if it exists
    if (typeof renderInstrDropdown === 'function') renderInstrDropdown();
  }

  if (cachedLocations && typeof locations !== 'undefined' && locations.length === 0) {
    const visible = (cachedLocations.data || cachedLocations).filter(l => l.is_visible && l.handle !== 'psycle-at-home');
    locations.push(...visible);
    // Re-render the studio chips
    if (typeof renderLocationChips === 'function') renderLocationChips();
  }

  if (cachedEventTypes && typeof eventTypes !== 'undefined' && eventTypes.length === 0) {
    const types = cachedEventTypes.data || cachedEventTypes;
    if (Array.isArray(types)) {
      eventTypes.push(...types);
      if (typeof renderCategoryPills === 'function') renderCategoryPills();
    }
  }
})();

