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
// 'cloud' is the default (set as <html data-theme="cloud"> so the first
// paint is correct). The header sun/moon button quick-flips between the
// light/dark bases (Cloud ↔ Graphite); flavour themes are picked in
// Membership → Theme (or deep-linked with ?theme=id).

const THEME_KEY = 'psycle_theme';

// `mono: true` = a near-monochrome theme by design: class types wear the
// theme's own accent ladder there unless the member chose "bold" (section A2).
const APP_THEMES = [
  { id: 'cloud',     name: 'Cloud',     base: 'light', bg: '#e6e9ee', accent: '#1b2130' },
  { id: 'linen',     name: 'Linen',     base: 'light', bg: '#e8e1d5', accent: '#b5573c' },
  { id: 'graphite',  name: 'Graphite',  base: 'dark',  bg: '#12161f', accent: '#dde3ec' },
  { id: 'terminal',  name: 'Terminal',  base: 'dark',  bg: '#060906', accent: '#2bd96b', mono: true },
  { id: 'synthwave', name: 'Synthwave', base: 'dark',  bg: '#140a24', accent: '#ff2d95' },
  { id: 'gameboy',   name: 'Handheld',  base: 'dark',  bg: '#0f380f', accent: '#9bbc0f', mono: true },
  { id: 'blueprint', name: 'Blueprint', base: 'dark',  bg: '#0a1c30', accent: '#38bdf8' },
];

const DEFAULT_THEME = 'cloud';
window.APP_THEMES = APP_THEMES;

function _themeById(id) {
  for (var i = 0; i < APP_THEMES.length; i++) {
    if (APP_THEMES[i].id === id) return APP_THEMES[i];
  }
  return null;
}

function _applyTheme(id) {
  // Always set an explicit attribute — Cloud (the default) is a real
  // [data-theme="cloud"] block, so there is no attribute-less base.
  document.documentElement.setAttribute('data-theme', id);
  // Status area / PWA chrome follows the theme background
  const meta = document.querySelector('meta[name="theme-color"]');
  const t = _themeById(id);
  if (meta && t) meta.setAttribute('content', t.bg);
  // The class-type colours follow the theme's base (light / dark palette
  // side) and step aside on the mono themes — see section A2.
  _applyClassColours();
}

function _resolveTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (_themeById(saved)) return saved;
  // No (valid) preference — follow the system (dark → Graphite, else Cloud)
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'graphite';
  return DEFAULT_THEME;
}

window.getAppTheme = _resolveTheme;

window.setAppTheme = function (id) {
  if (!_themeById(id)) return;
  // Applied first, saved second: with localStorage full the save threw and
  // the tap did nothing at all. security.js's setter frees the app's own
  // caches and retries, so the choice nearly always sticks as well.
  _applyTheme(id);
  try {
    if (typeof window._psycleSafeSetItem === 'function') window._psycleSafeSetItem(THEME_KEY, id);
    else localStorage.setItem(THEME_KEY, id);
  } catch (e) {}
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

  // iOS: after a storage purge the saved theme is only back in localStorage
  // once native-bridge (the last script) has restored it from Preferences —
  // after the lines above ran, so that launch wore the system default. Only
  // when it actually differs: no repaint on an ordinary launch.
  if (window._psycleNativeRestoreReady) {
    window._psycleNativeRestoreReady.then(function () {
      var id = _resolveTheme();
      if (document.documentElement.getAttribute('data-theme') === id) return;
      _applyTheme(id);
      updateThemeIcon();
    });
    // Same purge, same cure for the class colours (psycle_class_colours is
    // mirrored too). A no-op when what is on screen is already right.
    window._psycleNativeRestoreReady.then(function () { _applyClassColours(); });
  }
}

function toggleTheme() {
  // Quick toggle flips between the light/dark bases Cloud ↔ Graphite
  // (and exits any flavour theme).
  const cur = _themeById(_resolveTheme());
  const next = cur && cur.base === 'light' ? 'graphite' : 'cloud';
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
  // Looked up at tap time, not bound now: reliability.js (loaded later) wraps
  // window.toggleTheme to log the flip, and a handler holding THIS function
  // never went through that wrapper — no tap on the button was ever logged.
  btn.onclick = function () { window.toggleTheme(); };
  // authPill is nested inside a wrapper div, NOT a direct child of <header> —
  // inserting into header with a reference node from another parent throws
  // NotFoundError (and the toggle never rendered). Insert next to the pill
  // in its real parent instead.
  if (authPill && authPill.parentNode) {
    authPill.parentNode.insertBefore(btn, authPill.nextSibling);
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


// ── A2. Class-type colours ──────────────────────────────────────
// In Crisp Colour, colour means CLASS TYPE and nothing else. Each of the
// eight categories of app.js's CATEGORY_MAP (keys lower-cased) wears one
// swatch of ONE curated palette, at one of three intensities:
//   off   cards stay the neutral surface; the colour shows only in the
//         pictogram tile and small marks
//   soft  THE DEFAULT — a card tint about half-way between the boards' tint
//         and the surface
//   bold  the boards as drawn
// Stored in localStorage psycle_class_colours =
//   {"v":1,"intensity":"soft","map":{"ride":"cobalt", …}}   (only the member's
//   own choices are kept in `map`; everything else follows DEFAULTS)
// mirrored on iOS (SYNC_KEYS) and carried by settings export / import.
//
// apply() writes, on <html>:
//   data-ct-intensity="off|soft|bold"
//   --ct-<key>-tint / -wash / -base / -deep / -ring / -drop   for all eight keys
//   --ct-on-base                                              the label on a base fill
// (tint = the card ground at the chosen intensity; wash = always the bold
// tint — the calm pictogram tile of "soft"; base = the strong fill; deep =
// the ink of the hue; ring / drop = the glow.)
// css/theme.css ends with the same values for the default map as plain CSS
// (so a page paints right before this file runs, and tests hold the two
// together); css/crisp.css maps them onto [data-ct="<key>"] as --ct-tint,
// --ct-wash, --ct-base, --ct-deep, --ct-ring, --ct-drop. Components read only
// those.
//
// Every value below is precomputed — no colour maths at runtime, no
// color-mix(), no oklch() (iOS 15). tests/suites/9a-foundation.js checks every
// swatch × role × base against the ink it carries:
//   light  ink 700 / ink 500 on a tint ≥ 4.5, deep on a tint ≥ 7, white on base ≥ 4.5
//   dark   text / muted of every dark theme on a tint ≥ 4.5, deep on a tint ≥ 7,
//          white on base ≥ 4.5
// `ring` and `drop` are the base at 18–26% and 50%: the glow of what is yours.
// On a dark base `deep` is the pale ink of the hue (the light side's bold tint).
//
// Terminal and Handheld are near-monochrome by design (APP_THEMES `mono`):
// there apply() writes nothing and css/theme.css maps every class type onto
// the theme's own accent ladder — the pictograms still tell types apart —
// unless the member explicitly chose "bold".

// ── pure:class-colours:start ── (DOM-free; tests/suites/9a-foundation.js evaluates this block)
var CLASS_COLOUR_KEY = 'psycle_class_colours';
var CLASS_COLOUR_KEYS = ['ride', 'strength', 'yoga', 'hiit', 'pilates', 'lagree', 'barre', 'other'];
var CLASS_COLOUR_INTENSITIES = ['off', 'soft', 'bold'];
var CLASS_COLOUR_ROLES = ['tint', 'wash', 'base', 'deep', 'ring', 'drop'];
var CLASS_COLOUR_DEFAULT_INTENSITY = 'soft';
var CLASS_COLOUR_DEFAULTS = {
  ride: 'cobalt', strength: 'ember', yoga: 'jade', hiit: 'sun',
  pilates: 'violet', lagree: 'teal', barre: 'orchid', other: 'slate',
};
// In hue order (the order a swatch row shows them), the neutral last. The
// first five bold tints, bases and deeps are the boards', value for value.
var CLASS_COLOUR_PALETTE = {
  cobalt: {
    name: 'Cobalt',
    light: { tintSoft: '#E9F0FF', tintBold: '#D6E2FF', base: '#2D5FD6', deep: '#1A3785', ring: 'rgba(45, 95, 214, 0.18)', drop: 'rgba(45, 95, 214, 0.5)' },
    dark:  { tintSoft: '#1F2C4A', tintBold: '#233560', base: '#3A6EE7', deep: '#D6E2FF', ring: 'rgba(58, 110, 231, 0.26)', drop: 'rgba(58, 110, 231, 0.5)' },
  },
  sky: {
    name: 'Sky',
    light: { tintSoft: '#E2F2FD', tintBold: '#C7E6FC', base: '#0574B7', deep: '#004271', ring: 'rgba(5, 116, 183, 0.18)', drop: 'rgba(5, 116, 183, 0.5)' },
    dark:  { tintSoft: '#1A2D44', tintBold: '#193855', base: '#147ABE', deep: '#C7E6FC', ring: 'rgba(20, 122, 190, 0.26)', drop: 'rgba(20, 122, 190, 0.5)' },
  },
  teal: {
    name: 'Teal',
    light: { tintSoft: '#DEF3F9', tintBold: '#BFE8F3', base: '#057890', deep: '#004858', ring: 'rgba(5, 120, 144, 0.18)', drop: 'rgba(5, 120, 144, 0.5)' },
    dark:  { tintSoft: '#1A2E3E', tintBold: '#1A394B', base: '#177F97', deep: '#BFE8F3', ring: 'rgba(23, 127, 151, 0.26)', drop: 'rgba(23, 127, 151, 0.5)' },
  },
  jade: {
    name: 'Jade',
    light: { tintSoft: '#E0F4EF', tintBold: '#C4EBDF', base: '#0A7A64', deep: '#064A3C', ring: 'rgba(10, 122, 100, 0.18)', drop: 'rgba(10, 122, 100, 0.5)' },
    dark:  { tintSoft: '#1B2F39', tintBold: '#1C3A40', base: '#1D836D', deep: '#C4EBDF', ring: 'rgba(29, 131, 109, 0.26)', drop: 'rgba(29, 131, 109, 0.5)' },
  },
  moss: {
    name: 'Moss',
    light: { tintSoft: '#E6F3DC', tintBold: '#D0E9B9', base: '#487C25', deep: '#254A17', ring: 'rgba(72, 124, 37, 0.18)', drop: 'rgba(72, 124, 37, 0.5)' },
    dark:  { tintSoft: '#222F2F', tintBold: '#283A2F', base: '#4E822C', deep: '#D0E9B9', ring: 'rgba(78, 130, 44, 0.26)', drop: 'rgba(78, 130, 44, 0.5)' },
  },
  sun: {
    name: 'Sun',
    light: { tintSoft: '#F7F0CB', tintBold: '#F2E398', base: '#A26403', deep: '#623800', ring: 'rgba(162, 100, 3, 0.18)', drop: 'rgba(162, 100, 3, 0.5)' },
    dark:  { tintSoft: '#2E2B2B', tintBold: '#3F3326', base: '#A5670B', deep: '#F2E398', ring: 'rgba(165, 103, 11, 0.26)', drop: 'rgba(165, 103, 11, 0.5)' },
  },
  ember: {
    name: 'Ember',
    light: { tintSoft: '#FEEBE7', tintBold: '#FFD8D0', base: '#CC3A1F', deep: '#7A1E0C', ring: 'rgba(204, 58, 31, 0.18)', drop: 'rgba(204, 58, 31, 0.5)' },
    dark:  { tintSoft: '#35252F', tintBold: '#4B292D', base: '#D34126', deep: '#FFD8D0', ring: 'rgba(211, 65, 38, 0.26)', drop: 'rgba(211, 65, 38, 0.5)' },
  },
  rose: {
    name: 'Rose',
    light: { tintSoft: '#FEEBEE', tintBold: '#FFD9DE', base: '#C62C58', deep: '#76162E', ring: 'rgba(198, 44, 88, 0.18)', drop: 'rgba(198, 44, 88, 0.5)' },
    dark:  { tintSoft: '#352537', tintBold: '#4B283D', base: '#D33A62', deep: '#FFD9DE', ring: 'rgba(211, 58, 98, 0.26)', drop: 'rgba(211, 58, 98, 0.5)' },
  },
  orchid: {
    name: 'Orchid',
    light: { tintSoft: '#FBEAF8', tintBold: '#FAD6F2', base: '#B82A8E', deep: '#6E1454', ring: 'rgba(184, 42, 142, 0.18)', drop: 'rgba(184, 42, 142, 0.5)' },
    dark:  { tintSoft: '#33253F', tintBold: '#48284C', base: '#C83B9C', deep: '#FAD6F2', ring: 'rgba(200, 59, 156, 0.26)', drop: 'rgba(200, 59, 156, 0.5)' },
  },
  violet: {
    name: 'Violet',
    light: { tintSoft: '#F1EDFF', tintBold: '#E6DCFF', base: '#7045D0', deep: '#42238C', ring: 'rgba(112, 69, 208, 0.18)', drop: 'rgba(112, 69, 208, 0.5)' },
    dark:  { tintSoft: '#292949', tintBold: '#36305F', base: '#825AE6', deep: '#E6DCFF', ring: 'rgba(130, 90, 230, 0.26)', drop: 'rgba(130, 90, 230, 0.5)' },
  },
  slate: {
    name: 'Slate',
    light: { tintSoft: '#ECF0F6', tintBold: '#DBE2EE', base: '#57647B', deep: '#313B4D', ring: 'rgba(87, 100, 123, 0.18)', drop: 'rgba(87, 100, 123, 0.5)' },
    dark:  { tintSoft: '#262D3D', tintBold: '#2F3748', base: '#68758D', deep: '#DBE2EE', ring: 'rgba(104, 117, 141, 0.26)', drop: 'rgba(104, 117, 141, 0.5)' },
  },
};
// The label on a base fill. Every base above carries white at ≥ 4.5:1.
var CLASS_COLOUR_ON_BASE = '#FFFFFF';

function _ccOwn(obj, k) { return !!obj && Object.prototype.hasOwnProperty.call(obj, k); }

// "RIDE" / "ride" / anything else → one of CLASS_COLOUR_KEYS ("other" when unknown).
function _ccKey(key) {
  var k = String(key == null ? '' : key).toLowerCase();
  return CLASS_COLOUR_KEYS.indexOf(k) !== -1 ? k : 'other';
}

// What a stored or imported value may say: { intensity?, map: { key: swatch } }
// holding ONLY known keys, known swatches and a known intensity — or null when
// it is not a class-colours object at all (wrong type, wrong version, nothing
// usable in it). Stored data is untrusted: own properties only, and a swatch
// name such as "constructor" is not a swatch.
function _ccChoices(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !_ccOwn(value, 'v') || value.v !== 1) return null;
  var out = { map: {} }, any = false;
  var intensity = _ccOwn(value, 'intensity') ? value.intensity : undefined;
  if (typeof intensity === 'string' && CLASS_COLOUR_INTENSITIES.indexOf(intensity) !== -1) {
    out.intensity = intensity;
    any = true;
  }
  var map = _ccOwn(value, 'map') ? value.map : undefined;
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    CLASS_COLOUR_KEYS.forEach(function (k) {
      if (_ccOwn(map, k) && typeof map[k] === 'string' && _ccOwn(CLASS_COLOUR_PALETTE, map[k])) {
        out.map[k] = map[k];
        any = true;
      }
    });
  }
  return any ? out : null;
}

// For settings import and for storage: a parsed value → the object worth
// storing ({ v: 1, intensity, map: only the explicit choices }), or null.
function _ccStorable(value) {
  var c = _ccChoices(value);
  return c ? { v: 1, intensity: c.intensity || CLASS_COLOUR_DEFAULT_INTENSITY, map: c.map } : null;
}

// Any value → the full state in effect: { v, intensity, map: all eight keys }.
function _ccClean(value) {
  var c = _ccChoices(value) || { map: {} };
  var map = {};
  CLASS_COLOUR_KEYS.forEach(function (k) { map[k] = _ccOwn(c.map, k) ? c.map[k] : CLASS_COLOUR_DEFAULTS[k]; });
  return { v: 1, intensity: c.intensity || CLASS_COLOUR_DEFAULT_INTENSITY, map: map };
}

// The object to store after set(partial): what was stored plus the valid
// parts of `partial` ({ intensity?, map?: { key: swatch } }). Invalid parts
// are ignored, never stored.
function _ccMerge(stored, partial) {
  var cur = _ccChoices(stored) || { map: {} };
  var inc = _ccChoices({ v: 1, intensity: partial && partial.intensity, map: partial && partial.map }) || { map: {} };
  var map = {};
  CLASS_COLOUR_KEYS.forEach(function (k) {
    if (_ccOwn(inc.map, k)) map[k] = inc.map[k];
    else if (_ccOwn(cur.map, k)) map[k] = cur.map[k];
  });
  return { v: 1, intensity: inc.intensity || cur.intensity || CLASS_COLOUR_DEFAULT_INTENSITY, map: map };
}

// Every custom property apply() manages (written, or removed on a mono theme).
function _ccPropNames() {
  var names = [];
  CLASS_COLOUR_KEYS.forEach(function (k) {
    CLASS_COLOUR_ROLES.forEach(function (r) { names.push('--ct-' + k + '-' + r); });
  });
  names.push('--ct-on-base');
  return names;
}

// state (from _ccClean) + the theme's base ('light' | 'dark') + whether the
// theme is mono → { intensity, mono, base, props: { '--ct-ride-tint': '#…', … } }.
// "off" still carries the soft tint: chips and seats keep a pale class ground;
// only the CARD goes neutral, and that is css/crisp.css's job
// (html[data-ct-intensity="off"]).
function _ccPlan(state, base, monoTheme) {
  var side = base === 'dark' ? 'dark' : 'light';
  var intensity = CLASS_COLOUR_INTENSITIES.indexOf(state && state.intensity) !== -1 ? state.intensity : CLASS_COLOUR_DEFAULT_INTENSITY;
  var mono = !!monoTheme && intensity !== 'bold';
  var props = {};
  if (!mono) {
    CLASS_COLOUR_KEYS.forEach(function (k) {
      var name = state && state.map && _ccOwn(CLASS_COLOUR_PALETTE, state.map[k]) ? state.map[k] : CLASS_COLOUR_DEFAULTS[k];
      var sw = CLASS_COLOUR_PALETTE[name][side];
      props['--ct-' + k + '-tint'] = intensity === 'bold' ? sw.tintBold : sw.tintSoft;
      props['--ct-' + k + '-wash'] = sw.tintBold;
      props['--ct-' + k + '-base'] = sw.base;
      props['--ct-' + k + '-deep'] = sw.deep;
      props['--ct-' + k + '-ring'] = sw.ring;
      props['--ct-' + k + '-drop'] = sw.drop;
    });
    props['--ct-on-base'] = CLASS_COLOUR_ON_BASE;
  }
  return { intensity: intensity, mono: mono, base: side, props: props };
}
// ── pure:class-colours:end ──

var _ccLastSig = null;
var _ccResolved = { sig: null, byKey: {} };

function _ccReadStored() {
  try { return JSON.parse(localStorage.getItem(CLASS_COLOUR_KEY) || 'null'); } catch (e) { return null; }
}

// Writes the plan for the theme on screen. Cheap to call again: nothing is
// touched (and nothing is announced) when the outcome is what is there already.
// `unsaved` = choices that could not be stored (set() with localStorage full):
// they are shown for this page all the same.
function _applyClassColours(unsaved) {
  var root = document.documentElement;
  var theme = _themeById(root.getAttribute('data-theme')) || _themeById(DEFAULT_THEME);
  var state = _ccClean(unsaved || _ccReadStored());
  var plan = _ccPlan(state, theme.base, !!theme.mono);
  if (root.getAttribute('data-ct-intensity') !== plan.intensity) root.setAttribute('data-ct-intensity', plan.intensity);
  var sig = plan.base + '|' + (plan.mono ? 'mono' : 'palette') + '|' + JSON.stringify(state);
  if (sig === _ccLastSig) return plan;
  _ccLastSig = sig;
  _ccPropNames().forEach(function (name) {
    if (_ccOwn(plan.props, name)) root.style.setProperty(name, plan.props[name]);
    else root.style.removeProperty(name);
  });
  if (typeof PsycleEvents !== 'undefined') {
    PsycleEvents.emit('classcolours:changed', { intensity: state.intensity, map: state.map, base: plan.base, mono: plan.mono });
  }
  return plan;
}

function _ccSave(choices) {
  var json = JSON.stringify(choices);
  try {
    if (typeof window._psycleSafeSetItem === 'function') return window._psycleSafeSetItem(CLASS_COLOUR_KEY, json) !== false;
    localStorage.setItem(CLASS_COLOUR_KEY, json);
    return true;
  } catch (e) { return false; }
}

window.PsycleClassColours = {
  KEY: CLASS_COLOUR_KEY,
  KEYS: CLASS_COLOUR_KEYS,
  INTENSITIES: CLASS_COLOUR_INTENSITIES,
  PALETTE: CLASS_COLOUR_PALETTE,
  DEFAULTS: CLASS_COLOUR_DEFAULTS,
  DEFAULT_INTENSITY: CLASS_COLOUR_DEFAULT_INTENSITY,

  // → { v: 1, intensity, map: { ride: 'cobalt', … all eight } } — what is in effect.
  get: function () { return _ccClean(_ccReadStored()); },

  // partial = { intensity?: 'off'|'soft'|'bold', map?: { ride: 'sky', … } }.
  // Invalid parts are ignored. Returns the state now in effect. With
  // localStorage full the choice is still shown for this page (as setAppTheme
  // does); security.js's setter frees the app's own caches and retries first.
  set: function (partial) {
    var next = _ccMerge(_ccReadStored(), partial || {});
    var saved = _ccSave(next);
    _applyClassColours(saved ? null : next);
    return _ccClean(next);
  },

  // Back to DEFAULTS at "soft". reset({ keepIntensity: true }) forgets only
  // the per-type choices.
  reset: function (opts) {
    var keep = opts && opts.keepIntensity ? _ccClean(_ccReadStored()).intensity : null;
    try {
      if (keep && keep !== CLASS_COLOUR_DEFAULT_INTENSITY) _ccSave({ v: 1, intensity: keep, map: {} });
      else localStorage.removeItem(CLASS_COLOUR_KEY);
    } catch (e) {}
    _applyClassColours();
    return _ccClean(_ccReadStored());
  },

  apply: function () { return _applyClassColours(); },

  // For settings import: a parsed value → the choices worth storing, or null.
  clean: function (value) { return _ccStorable(value); },

  // The literal colours in effect for one class type, read back from the page
  // (so the mono themes and the CSS defaults answer too) — for a canvas, which
  // cannot paint var(). { key, swatch, tint, base, deep, onBase }
  // Remembered per theme + plan: a list that asks once per row (the Stats
  // bars, the instructor tags) costs one style read per class type.
  resolve: function (key) {
    var k = _ccKey(key);
    var sig = String(document.documentElement.getAttribute('data-theme')) + '|' + _ccLastSig;
    if (_ccResolved.sig !== sig) _ccResolved = { sig: sig, byKey: {} };
    var hit = _ccResolved.byKey[k];
    if (!hit) {
      hit = { key: k, swatch: _ccClean(_ccReadStored()).map[k], tint: '', base: '', deep: '', onBase: '' };
      try {
        var cs = getComputedStyle(document.documentElement);
        var read = function (name) { return String(cs.getPropertyValue(name) || '').trim(); };
        hit.tint = read('--ct-' + k + '-tint');
        hit.base = read('--ct-' + k + '-base');
        hit.deep = read('--ct-' + k + '-deep');
        hit.onBase = read('--ct-on-base');
      } catch (e) {}
      // Not kept while the stylesheet is still loading (nothing to read yet).
      if (hit.base) _ccResolved.byKey[k] = hit;
    }
    return { key: hit.key, swatch: hit.swatch, tint: hit.tint, base: hit.base, deep: hit.deep, onBase: hit.onBase };
  },
};


// ── B. Skeleton Loading Cards ───────────────────────────────────
// Geometry mirrors the real .class-card (js/app.js eventCard), as Crisp Colour
// draws it: the time block leads, then title / instructor · studio /
// availability lines, and ONE pill at the right. Neutral surface — a class
// colour is only known once the class is. CSS: the base in theme.css, the
// shape in css/crisp.css (crisp:9b-discover).

function skeletonCardHTML() {
  return `<div class="skeleton-card" aria-hidden="true">
    <div class="skeleton-time">
      <div class="skeleton-bar sk-time-hour"></div>
      <div class="skeleton-bar sk-time-ampm"></div>
    </div>
    <div class="skeleton-info">
      <div class="skeleton-bar sk-type"></div>
      <div class="skeleton-bar sk-instr"></div>
      <div class="skeleton-bar sk-loc"></div>
    </div>
    <div class="skeleton-bar sk-button"></div>
  </div>`;
}

// A faint bike-grid placeholder, sized from a studio layout's slot
// count, hinting at the shape of the studio currently being searched.
function skeletonStudioHTML(name, slotCount) {
  const count = Math.max(1, Math.min(60, Number(slotCount) || 0));
  if (!count) return '';
  let dots = '';
  for (let i = 0; i < count; i++) {
    dots += '<span class="skeleton-bike"></span>';
  }
  const label = name ? escapeHTML(name) : '';
  return `<div class="skeleton-studio" aria-hidden="true">
    <div class="skeleton-bar sk-studio-label">${label}</div>
    <div class="skeleton-bike-grid">${dots}</div>
  </div>`;
}

// Context-aware: when exactly one studio is selected and its layout is
// known, prepend a bike-grid placeholder shaped from that studio's slot
// count. Otherwise fall back to the plain card skeletons. Reads the
// selection itself so call sites stay a zero-arg showSkeletonLoading().
function showSkeletonLoading() {
  const container = document.getElementById('results');
  if (!container) return;

  let studioHTML = '';
  if (typeof selectedLocations !== 'undefined' && selectedLocations.size === 1
      && typeof _studioMap !== 'undefined' && _studioMap) {
    const selId = [...selectedLocations][0];
    // selectedLocations holds *location* ids; find studios in _studioMap
    // that belong to it and carry a usable layout. Fall back to a direct
    // id match for cases where the selection is keyed by studio id.
    let studio = null;
    for (const key in _studioMap) {
      const s = _studioMap[key];
      if (!s) continue;
      const matchesLoc = String(s.location_id) === String(selId);
      const matchesStudio = String(s.id) === String(selId);
      if ((matchesLoc || matchesStudio) && s.layout && s.layout.slots && s.layout.slots.length) {
        studio = s;
        break;
      }
    }
    if (studio) {
      studioHTML = skeletonStudioHTML(studio.name, studio.layout.slots.length);
    }
  }

  container.innerHTML = `<div class="skeleton-grid" id="skeletonGrid">
    ${studioHTML}${skeletonCardHTML().repeat(6)}
  </div>`;
}

function hideSkeletonLoading() {
  const grid = document.getElementById('skeletonGrid');
  if (grid) grid.remove();
}


// ── C. Empty State Illustration ─────────────────────────────────

// The ways out of an empty list. app.js names them by id; the handlers live
// here as fixed strings, so nothing app- or API-supplied reaches an onclick.
const EMPTY_STATE_ACTIONS = {
  tomorrow: { label: 'Tomorrow', onclick: "setDateQuick('tomorrow')" },
  week: { label: 'Next 7 days', onclick: "setDateQuick('week')" },
  clear: { label: 'Clear filters', onclick: 'clearFilters()' },
  // A forced search, not refreshWindow(): it shows the studios that answer,
  // where a refresh commits nothing unless every studio does.
  retry: { label: 'Try again', onclick: 'search({ force: true })' },
};

function renderEmptyState(message) {
  // app.js knows WHY the list is empty (today has run out / the filters match
  // nothing / more days are still loading) — this block used to be a sentence
  // with nothing to tap. Absent (or throwing), the plain copy below stands.
  let ctx = null;
  try { if (typeof _discoverEmptyContext === 'function') ctx = _discoverEmptyContext(); } catch (e) {}
  if (ctx && ctx.loading) {
    return '<div class="status empty-loading"><span class="spinner"></span>Checking the latest timetable…</div>';
  }
  const msg = escapeHTML((ctx && ctx.title) || message || 'No classes found for these filters.');
  // A second line only when app.js has one that adds something (a cause, a
  // time): the buttons below already are the ways on.
  const sub = escapeHTML((ctx && ctx.sub) || '');
  const actions = ((ctx && ctx.actions) || []).map((id, i) => {
    const a = Object.prototype.hasOwnProperty.call(EMPTY_STATE_ACTIONS, id) ? EMPTY_STATE_ACTIONS[id] : null;
    return a ? `<button type="button" class="empty-action${i === 0 ? ' primary' : ''}" onclick="${a.onclick}">${a.label}</button>` : '';
  }).join('');
  // Crisp Colour: a plain line and the ways on — no illustration (the boards
  // draw none, and this one was the last drawing on Discover).
  return `<div class="empty-state">
    <div class="empty-title">${msg}</div>
    ${sub ? `<div class="empty-subtitle">${sub}</div>` : ''}
    ${actions ? `<div class="empty-actions">${actions}</div>` : ''}
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
    // Skip the skeleton when a cached window exists — those searches re-filter
    // instantly from cache, so the skeleton would just flash.
    if (!window._windowEvents) showSkeletonLoading();
    // No haptic here: search() is almost never a tap. It runs by itself ~1s
    // after every signed-in launch and 600ms after each filter change, so the
    // phone buzzed unprompted. Real taps tick where they happen (selectBike,
    // the dialogs, the booking result).
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
