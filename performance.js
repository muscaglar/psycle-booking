/**
 * performance.js — Performance enhancements for Psycle Booking PWA
 *
 * A. Debounced instructor search (200ms)
 * B. Virtual scrolling with IntersectionObserver for large result sets (50+ cards)
 * C. Stale-while-revalidate API response caching for static lists
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


// ── B. Virtual Scrolling with IntersectionObserver ─────────────────

/**
 * Observe `.class-card-placeholder` elements and render their actual content
 * when they scroll into the viewport (with a 200px prefetch margin).
 */
const _virtualScrollObserver = (typeof IntersectionObserver !== 'undefined')
  ? new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          const placeholder = entry.target;
          _virtualScrollObserver.unobserve(placeholder);
          _hydrateCard(placeholder);
        });
      },
      { rootMargin: '200px 0px' }
    )
  : null;

/**
 * Hydrate a placeholder div by injecting its real card HTML (stored in a data attribute).
 */
function _hydrateCard(placeholder) {
  const html = placeholder.dataset.cardHtml;
  if (!html) return;
  const temp = document.createElement('div');
  temp.innerHTML = html;
  const card = temp.firstElementChild;
  if (card) {
    placeholder.replaceWith(card);
  }
}

/**
 * Call after rendering placeholders to start observing them.
 * Observes all `.class-card-placeholder` elements currently in the DOM.
 */
function initVirtualScroll() {
  if (!_virtualScrollObserver) return;
  const placeholders = document.querySelectorAll('.class-card-placeholder');
  placeholders.forEach(el => _virtualScrollObserver.observe(el));
}

/**
 * Create a placeholder div that has the same approximate height as a real card
 * but defers actual content rendering until scrolled into view.
 *
 * @param {string} cardHtml - Full HTML string of the real card
 * @param {string} eventId  - The event ID for keying
 * @returns {string} Placeholder HTML string
 */
function _makePlaceholder(cardHtml, eventId) {
  // Escape the HTML for safe embedding in a data attribute
  const escaped = cardHtml
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<div class="class-card-placeholder" data-id="${eventId}" data-card-html="${escaped}" style="min-height:110px;"></div>`;
}

// Monkey-patch render() and eventCard() to use virtual scrolling when event count > 50.
(function patchRenderForVirtualScroll() {
  if (typeof render !== 'function' || typeof eventCard !== 'function') {
    console.warn('[perf] render/eventCard not found — skipping virtual scroll patch');
    return;
  }

  const _origRender = render;
  const _origEventCard = eventCard;
  let _virtualMode = false;

  // Wrap eventCard to return placeholders in virtual mode
  window.eventCard = function (evt, instrMap, studioMap, locationMap, typeMap) {
    const realHtml = _origEventCard(evt, instrMap, studioMap, locationMap, typeMap);
    if (_virtualMode) {
      return _makePlaceholder(realHtml, evt.id);
    }
    return realHtml;
  };

  window.render = function (events, relations, filters, done) {
    // Enable virtual mode for large result sets
    _virtualMode = (events.length > 50);

    // Call the original render
    _origRender(events, relations, filters, done);

    // After render, observe any new placeholders
    if (_virtualMode) {
      initVirtualScroll();
    }

    _virtualMode = false;
  };
})();


// ── C. API Response Caching (Stale-While-Revalidate) ───────────────

const CACHE_PREFIX = 'psycle_cache_';
const TTL_24H = 24 * 60 * 60 * 1000; // 24 hours in ms

/**
 * Fetch JSON from `path` with localStorage caching.
 * Returns cached data immediately if available.
 * Always revalidates in the background (stale-while-revalidate).
 * If no cache exists, fetches from network and caches the result.
 *
 * @param {string}  path  - API path (e.g. '/instructors')
 * @param {number}  ttlMs - Cache TTL in milliseconds
 * @returns {Promise<any>} Parsed JSON response
 */
async function cachedFetch(path, ttlMs) {
  const cacheKey = CACHE_PREFIX + path.replace(/^\//, '');
  let cached = null;

  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) cached = JSON.parse(raw);
  } catch {
    // Corrupt cache entry — ignore
  }

  if (cached && cached.data) {
    // Return cached data immediately, revalidate in background
    _revalidateInBackground(path, cacheKey);
    return cached.data;
  }

  // No cache at all — must fetch from network
  const data = await _fetchAndCache(path, cacheKey);
  return data;
}

/**
 * Fetch from network using the un-patched apiFetch, store in cache, return parsed JSON.
 */
async function _fetchAndCache(path, cacheKey) {
  const fetchFn = window._origApiFetchForCache || window.apiFetch;
  const res = await fetchFn(path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  try {
    localStorage.setItem(cacheKey, JSON.stringify({
      data: data,
      timestamp: Date.now(),
    }));
  } catch {
    // localStorage full or unavailable — non-fatal
  }
  return data;
}

/**
 * Fire-and-forget background revalidation. Updates cache silently.
 */
function _revalidateInBackground(path, cacheKey) {
  _fetchAndCache(path, cacheKey).catch(() => {
    // Background refresh failed — stale cache remains usable
  });
}

/**
 * Patch apiFetch so that GET requests to cacheable endpoints are served
 * from localStorage when cache data is available, with background revalidation.
 *
 * The init IIFE in app.js dispatches /instructors, /locations, /event-types
 * before this script loads (synchronous call inside the async IIFE).
 * To handle this, we also eagerly pre-populate the global arrays from cache below.
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
  // Expose original for _fetchAndCache to use (avoids infinite recursion)
  window._origApiFetchForCache = _origApiFetch;

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

    if (cached && cached.data) {
      // Return cached data as a fake Response, revalidate in background
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
 * Eager cache pre-population: the init IIFE in app.js fires its fetchJson calls
 * synchronously before this script loads, so the apiFetch patch above cannot
 * intercept those initial requests. However, on repeat visits the cache already
 * has data from a previous session. We read it here and pre-populate the global
 * arrays (instructors, locations, eventTypes) so the UI can render immediately
 * without waiting for the network.
 *
 * When the init IIFE's network responses arrive, they overwrite these arrays
 * with fresh data — so this is truly stale-while-revalidate for the init data.
 */
(function eagerCachePrePopulate() {
  function readCache(key) {
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      return entry && entry.data ? entry.data : null;
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
    console.log('[perf] Pre-populated instructors from cache (%d)', visible.length);
  }

  if (cachedLocations && typeof locations !== 'undefined' && locations.length === 0) {
    const visible = (cachedLocations.data || cachedLocations).filter(l => l.is_visible && l.handle !== 'psycle-at-home');
    locations.push(...visible);
    // Re-render the location dropdown
    const lSel = document.getElementById('locationSelect');
    if (lSel && lSel.options.length <= 1) {
      lSel.innerHTML = '<option value="">All Studios</option>' +
        visible.map(l => `<option value="${l.id}">${escapeHTML(l.name.replace('Psycle ', ''))}</option>`).join('');
    }
    console.log('[perf] Pre-populated locations from cache (%d)', visible.length);
  }

  if (cachedEventTypes && typeof eventTypes !== 'undefined' && eventTypes.length === 0) {
    const types = cachedEventTypes.data || cachedEventTypes;
    if (Array.isArray(types)) {
      eventTypes.push(...types);
      if (typeof renderCategoryPills === 'function') renderCategoryPills();
      console.log('[perf] Pre-populated eventTypes from cache (%d)', types.length);
    }
  }
})();

console.log('[perf] Performance enhancements loaded: debounced search, virtual scroll, API caching');
