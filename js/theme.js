/**
 * theme.js — UX polish: dark/light toggle, skeleton loading,
 * empty-state illustrations, haptic feedback
 *
 * Loaded BEFORE app.js. Polls for global functions (search, render,
 * submitBooking, setStatus) and wraps them to add skeleton states,
 * empty-state illustrations, and haptic feedback.
 *
 * Depends on: DOM only (wraps app.js functions once available)
 * Exposes on window (as bare globals):
 *   initTheme, toggleTheme, skeletonCardHTML, showSkeletonLoading,
 *   hideSkeletonLoading, renderEmptyState, haptic
 */

// ── A. Themes ───────────────────────────────────────────────────
// Every theme is a [data-theme="id"] token block in css/theme.css.
// 'dark' is the :root default (no attribute). The header sun/moon
// button quick-flips between the light/dark bases; flavour themes are
// picked in Membership → Theme (or deep-linked with ?theme=id).

const THEME_KEY = 'psycle_theme';

const APP_THEMES = [
  { id: 'dark',      name: 'Noir',      base: 'dark',  bg: '#09090b', accent: '#e94560' },
  { id: 'light',     name: 'Daylight',  base: 'light', bg: '#f7f7f8', accent: '#e94560' },
  { id: 'terminal',  name: 'Terminal',  base: 'dark',  bg: '#060906', accent: '#2bd96b' },
  { id: 'synthwave', name: 'Synthwave', base: 'dark',  bg: '#140a24', accent: '#ff2d95' },
  { id: 'gameboy',   name: 'Handheld',  base: 'dark',  bg: '#0f380f', accent: '#9bbc0f' },
  { id: 'blueprint', name: 'Blueprint', base: 'dark',  bg: '#0a1c30', accent: '#38bdf8' },
];
window.APP_THEMES = APP_THEMES;

function _themeById(id) {
  for (var i = 0; i < APP_THEMES.length; i++) {
    if (APP_THEMES[i].id === id) return APP_THEMES[i];
  }
  return null;
}

function _applyTheme(id) {
  if (id === 'dark') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', id);
  }
  // Status area / PWA chrome follows the theme background
  const meta = document.querySelector('meta[name="theme-color"]');
  const t = _themeById(id);
  if (meta && t) meta.setAttribute('content', t.bg);
}

function _resolveTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (_themeById(saved)) return saved;
  // No (valid) preference — follow the system
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}

window.getAppTheme = _resolveTheme;

window.setAppTheme = function (id) {
  if (!_themeById(id)) return;
  localStorage.setItem(THEME_KEY, id);
  _applyTheme(id);
  updateThemeIcon();
  haptic('tap');
  if (typeof PsycleEvents !== 'undefined') PsycleEvents.emit('theme:changed', id);
};

function initTheme() {
  // ?theme=synthwave deep link (also handy for testing)
  try {
    const param = new URLSearchParams(location.search).get('theme');
    if (param && _themeById(param)) localStorage.setItem(THEME_KEY, param);
  } catch (e) {}

  _applyTheme(_resolveTheme());
  injectThemeToggle();
  updateThemeIcon();

  // Listen for system theme changes (auto-follows when no manual override)
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () {
      var saved = localStorage.getItem(THEME_KEY);
      if (!_themeById(saved)) {
        _applyTheme(_resolveTheme());
        updateThemeIcon();
      }
    });
  }
}

function toggleTheme() {
  // Quick toggle flips between the light/dark bases (and exits any
  // flavour theme). First tap with no preference flips the system theme.
  const cur = _themeById(_resolveTheme());
  const next = cur && cur.base === 'light' ? 'dark' : 'light';
  window.setAppTheme(next);
}

function injectThemeToggle() {
  const header = document.querySelector('header');
  if (!header || document.getElementById('themeToggleBtn')) return;
  // Place on the right side, after the auth pill
  const authPill = document.getElementById('authPill');
  const btn = document.createElement('button');
  btn.id = 'themeToggleBtn';
  btn.className = 'theme-toggle';
  btn.setAttribute('aria-label', 'Toggle dark/light mode');
  btn.setAttribute('title', 'Toggle dark/light mode');
  btn.onclick = toggleTheme;
  if (authPill && authPill.nextSibling) {
    header.insertBefore(btn, authPill.nextSibling);
  } else {
    header.appendChild(btn);
  }
}

function updateThemeIcon() {
  const btn = document.getElementById('themeToggleBtn');
  if (!btn) return;
  const cur = _themeById(_resolveTheme());
  const isLight = !!(cur && cur.base === 'light');

  // Sun = currently light, Moon = currently dark
  const sunSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
  const moonSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

  if (isLight) {
    btn.innerHTML = sunSvg;
    btn.title = 'Theme: light — click for dark';
  } else {
    btn.innerHTML = moonSvg;
    btn.title = 'Theme: dark — click for light';
  }
}


// ── B. Skeleton Loading Cards ───────────────────────────────────

function skeletonCardHTML() {
  return `<div class="skeleton-card">
    <div class="skeleton-time">
      <div class="skeleton-bar"></div>
      <div class="skeleton-bar"></div>
    </div>
    <div class="skeleton-info">
      <div class="skeleton-bar"></div>
      <div class="skeleton-bar"></div>
      <div class="skeleton-bar"></div>
      <div class="skeleton-bar"></div>
      <div class="skeleton-bar"></div>
    </div>
  </div>`;
}

function showSkeletonLoading() {
  const container = document.getElementById('results');
  if (!container) return;
  container.innerHTML = `<div class="skeleton-grid" id="skeletonGrid">
    ${skeletonCardHTML().repeat(6)}
  </div>`;
}

function hideSkeletonLoading() {
  const grid = document.getElementById('skeletonGrid');
  if (grid) grid.remove();
}


// ── C. Empty State Illustration ─────────────────────────────────

function renderEmptyState(message) {
  const msg = message || 'No classes found for these filters.';
  // Inline SVG: magnifying glass with a small cycling figure
  return `<div class="empty-state">
    <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- Magnifying glass -->
      <circle cx="34" cy="34" r="20" stroke="var(--text-ghost, #555)" stroke-width="3" fill="none"/>
      <line x1="48.5" y1="48.5" x2="64" y2="64" stroke="var(--text-ghost, #555)" stroke-width="3" stroke-linecap="round"/>
      <!-- Cyclist inside the glass -->
      <!-- Wheels -->
      <circle cx="27" cy="40" r="5" stroke="var(--accent, #e94560)" stroke-width="1.5" fill="none"/>
      <circle cx="41" cy="40" r="5" stroke="var(--accent, #e94560)" stroke-width="1.5" fill="none"/>
      <!-- Frame -->
      <polyline points="27,40 34,32 41,40 34,32 34,38" stroke="var(--text-dim, #888)" stroke-width="1.5" fill="none" stroke-linejoin="round"/>
      <!-- Handlebars -->
      <line x1="34" y1="32" x2="39" y2="30" stroke="var(--text-dim, #888)" stroke-width="1.5" stroke-linecap="round"/>
      <!-- Seat -->
      <line x1="30" y1="31" x2="34" y2="32" stroke="var(--text-dim, #888)" stroke-width="1.5" stroke-linecap="round"/>
      <!-- Head -->
      <circle cx="34" cy="27" r="2.5" fill="var(--text-dim, #888)"/>
    </svg>
    <div class="empty-title">${msg}</div>
    <div class="empty-subtitle">Try adjusting your filters, selecting a different date range, or choosing another studio.</div>
  </div>`;
}


// ── D. Haptic Feedback ──────────────────────────────────────────

function haptic(type) {
  if (!navigator.vibrate) return;
  switch (type) {
    case 'success':
      navigator.vibrate(50);
      break;
    case 'error':
      navigator.vibrate([30, 50, 30]);
      break;
    case 'tap':
      navigator.vibrate(10);
      break;
  }
}


// ── Hook into existing functions ────────────────────────────────

(function hookSearch() {
  // Wait for the global `search` function to exist, then wrap it
  if (typeof window.search !== 'function') {
    // Retry after app.js loads
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', hookSearch);
      return;
    }
    // app.js might load after theme.js; poll briefly
    let attempts = 0;
    const poll = setInterval(() => {
      attempts++;
      if (typeof window.search === 'function') {
        clearInterval(poll);
        wrapSearch();
        wrapRender();
        wrapSubmitBooking();
      }
      if (attempts > 50) clearInterval(poll);
    }, 100);
    return;
  }
  wrapSearch();
  wrapRender();
  wrapSubmitBooking();
})();

function wrapSearch() {
  if (window._themeSearchWrapped) return;
  window._themeSearchWrapped = true;
  const originalSearch = window.search;
  window.search = async function() {
    showSkeletonLoading();
    haptic('tap');
    return originalSearch.apply(this, arguments);
  };
}

function wrapRender() {
  if (window._themeRenderWrapped) return;
  window._themeRenderWrapped = true;
  const originalRender = window.render;
  window.render = function(events, relations, filters, done) {
    // Remove skeleton on first real data
    hideSkeletonLoading();
    // If no results and done, use our empty state
    if (events && relations) {
      // We need to check if after filtering there are results.
      // Delegate to original render and then check the DOM for the no-results div.
      const result = originalRender.apply(this, arguments);
      // After render, replace the plain "no results" with our empty state
      const container = document.getElementById('results');
      const noResults = container && container.querySelector('.no-results');
      if (noResults) {
        noResults.outerHTML = renderEmptyState(noResults.textContent.trim());
      }
      return result;
    }
    return originalRender.apply(this, arguments);
  };
}

function wrapSubmitBooking() {
  if (window._themeBookingWrapped) return;
  window._themeBookingWrapped = true;
  const originalSubmit = window.submitBooking;
  window.submitBooking = async function(eventId, slots, btn) {
    const result = await originalSubmit.apply(this, arguments);
    // Check the button state after submission to determine success/failure
    // The original function modifies btn.className — check it
    requestAnimationFrame(() => {
      if (btn.classList.contains('booked')) {
        haptic('success');
      } else if (btn.textContent.includes('Failed') || btn.textContent.includes('retry')) {
        haptic('error');
      }
    });
    return result;
  };
}


// ── Also hook into setStatus to remove skeleton ─────────────────
(function hookSetStatus() {
  if (typeof window.setStatus !== 'function') {
    let attempts = 0;
    const poll = setInterval(() => {
      attempts++;
      if (typeof window.setStatus === 'function') {
        clearInterval(poll);
        doHookSetStatus();
      }
      if (attempts > 50) clearInterval(poll);
    }, 100);
    return;
  }
  doHookSetStatus();
})();

function doHookSetStatus() {
  if (window._themeSetStatusWrapped) return;
  window._themeSetStatusWrapped = true;
  const originalSetStatus = window.setStatus;
  window.setStatus = function(html) {
    hideSkeletonLoading();
    // If this is a "no classes found" message, replace with empty state
    if (html && typeof html === 'string' && html.toLowerCase().includes('no classes found')) {
      const container = document.getElementById('results');
      if (container) {
        container.innerHTML = renderEmptyState('No classes found.');
        return;
      }
    }
    return originalSetStatus.apply(this, arguments);
  };
}


// ── Initialize on load ──────────────────────────────────────────
initTheme();
