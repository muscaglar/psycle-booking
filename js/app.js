/**
 * app.js — Core application logic for Psycle Booking PWA
 *
 * Loaded AFTER state.js and security.js. Provides:
 *   - API client (apiFetch, apiUrl, getBearerToken)
 *   - Auth flow (checkAuth, openLoginPopup, showSessionExpired)
 *   - Class search, filtering, and rendering
 *   - Booking, cancellation, and bike picker
 *   - Instructor multi-select, category pills, favourites
 *   - Upcoming bookings panel (My Bookings)
 *
 * Depends on: state.js (PsycleState, PsycleEvents), security.js (_secureTokenStore)
 *
 * Exposes on window (all as bare globals via state.js accessors):
 *   apiFetch, apiUrl, getBearerToken, search, render, eventCard, toast,
 *   checkAuth, openLoginPopup, showSessionExpired, clearToken,
 *   submitBooking, bookClass, confirmUnbook, cancelBikeSlot,
 *   showBikePicker, closeBikePicker, selectBike, confirmBikeBooking,
 *   confirmSpotChoice, planWeeklyTemplate, templateSpotsFor,
 *   templatePlanCaution, bookWeeklyTemplate, _bookingHorizon,
 *   fetchMyBookings, renderMyBookings, refreshUpcomingPanel,
 *   renderInstrDropdown, renderInstrChips, toggleInstructor,
 *   removeInstructor, toggleFavourite, applyFavouritesAsFilter,
 *   saveFavourites, renderCategoryPills, toggleCategory,
 *   renderStrengthSubPills, toggleStrengthSub, setDateQuick,
 *   onDateInputChange, slotLabel, slotLabelForEvent, instrLink,
 *   escapeHTML (from security.js), getCategory, CATEGORY_MAP
 */
const DIRECT_API = 'https://psycle.codexfit.com/api/v1/customer';
const PROXY = 'https://corsproxy.io/?';
const IS_FILE = location.protocol === 'file:';

// ── pure:core:start ── (DOM-free; tests/suites/facets-core.js evaluates these blocks)
// Format a Date as YYYY-MM-DD in LOCAL time. toISOString() converts to UTC,
// which makes "today" wrong in the evening for timezones west of UTC.
function localDateStr(d = new Date()) {
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}
const today = localDateStr();

// Parse an API datetime that may be 'YYYY-MM-DD HH:MM:SS' — iOS WebKit
// returns Invalid Date for the space-separated form, so normalize to ISO.
function parsePsycleDate(v) {
  return v ? new Date(String(v).replace(' ', 'T')) : null;
}
// ── pure:core:end ──

// ── pure:gym-time:start ── (DOM-free; tests/suites/bookings-card.js evaluates this block)
// Psycle is a UK gym: a naive 'YYYY-MM-DD HH:MM[:SS]' from the API is London
// wall clock, whatever zone the device is in. The 12h late-cancel cutoff
// (_cancelDeadline) and waitlist accept-by times (_waitlistTimeMs) need the
// REAL instant: parsed device-locally, a member abroad on the web app / PWA was
// promised "Free cancel until…" inside Psycle's charge window. This is the iOS
// bridge's resolver (ios-app/www/native-bridge.js), kept here as well because
// the web build never loads the bridge; in the app the bridge loads later and
// re-exports its own copy — tests/suites/bookings-card.js holds the two to the
// same answers. Only those two callers read it: card times, the calendar
// export, reminders and the widget still parse start_at device-locally.
let _gymWallFmt = null; // lazy: reports London wall clock for an instant

// UTC ms for a London wall-clock reading (DST-correct, device zone irrelevant).
// Starts from the same reading taken as UTC, then corrects by the offset London
// reports there — looped, because the correction can itself cross a clock
// change. Throws when the engine has no Europe/London data.
function _gymWallToUtcMs(y, mo, d, h, mi, s) {
  if (!_gymWallFmt) {
    _gymWallFmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  }
  const target = Date.UTC(y, mo - 1, d, h, mi, s || 0); // the clock reading, as if UTC
  let guess = target;
  for (let k = 0; k < 3; k++) {
    const wall = {};
    _gymWallFmt.formatToParts(new Date(guess)).forEach(p => { if (p.type !== 'literal') wall[p.type] = Number(p.value); });
    // London wall clock at `guess`, re-read as a UTC epoch, minus what we want.
    const deltaMs = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - target;
    if (deltaMs === 0) break;
    guess -= deltaMs;
  }
  return guess;
}

// Absolute UTC ms of an API class time. Only the naive shape is London wall
// clock; an epoch number or a string carrying its own Z / ±hh:mm offset is
// already an instant and goes to the engine's parser. NaN when nothing parses.
function _gymClassStartMs(startAt) {
  if (typeof startAt === 'number') return isFinite(startAt) ? startAt : NaN;
  const s = String(startAt == null ? '' : startAt).trim();
  if (!s) return NaN;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(s);
  if (m) {
    try {
      return _gymWallToUtcMs(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0));
    } catch (e) {
      // No Europe/London data in this engine: the device-local parse below is
      // still right on a UK device.
    }
  }
  const t = Date.parse(s.replace(' ', 'T'));
  return isNaN(t) ? Date.parse(s) : t; // e.g. "YYYY-MM-DD HH:MM:SS +01:00"
}
if (typeof window !== 'undefined') window._psycleClassStartMs = _gymClassStartMs;
// ── pure:gym-time:end ──

function apiUrl(path) {
  return IS_FILE
    ? PROXY + encodeURIComponent(DIRECT_API + path)
    : DIRECT_API + path;
}

function getBearerToken() {
  if (window._secureTokenStore) return window._secureTokenStore.get();
  return localStorage.getItem('psycle_bearer_token') || '';
}

function apiFetch(path, opts = {}) {
  const token = getBearerToken();
  const headers = { 'Accept': 'application/json', ...(opts.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  // 15s timeout so hung requests fail instead of leaving the UI stuck.
  // reliability.js replaces this function with one that additionally retries,
  // but the timeout also lives there.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);

  return fetch(apiUrl(path), { ...opts, headers, signal: ctrl.signal })
    .then(res => {
      clearTimeout(timer);
      // Only 401 means the session is dead. 403 is how the API says "not
      // allowed" for business rules (plan doesn't cover the class, inside
      // the late-cancel window, ...) with a perfectly valid token — treating
      // it as expiry logged users out mid-booking.
      if (res.status === 401 && getBearerToken()) {
        showSessionExpired();
      }
      return res;
    })
    .catch(err => {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') throw new Error('Request timed out');
      throw err;
    });
}

// Global state is managed by state.js (PsycleState) with backward-compatible
// window accessors, so instructors, locations, eventTypes, currentUser,
// _studioMap, _myBookings etc. are available as bare globals.

// ── pure:core:start ──
// ── Category mapping for smart filters ──────────────────────────
// A category no longer carries a colour of its own: colour means class type,
// the member chooses it, and it lives in the --ct-<key>-* tokens that
// window.PsycleClassColours (js/theme.js) writes. A component gets its class
// type as data-ct="<key lower-cased>" (classTypeKey) and css/crisp.css does the
// rest. `color` stays readable for the older call sites (the Stats bars, the
// instructor tags, the share-image canvas): it answers with the class BASE
// colour in effect — a literal a canvas can paint — and, where there is no
// page to ask, with the token itself.
const CATEGORY_MAP = [
  { key: 'RIDE',     label: 'Ride',     prefixes: ['RIDE'] },
  { key: 'STRENGTH', label: 'Strength', prefixes: ['STRENGTH', 'LIFT', 'WEIGHTS', 'TREAD'] },
  { key: 'YOGA',     label: 'Yoga',     prefixes: ['YOGA', 'FLOW', 'RESTORE', 'MEDITATION'] },
  { key: 'HIIT',     label: 'HIIT',     prefixes: ['HIIT', 'CIRCUIT', 'INTERVAL'] },
  { key: 'PILATES',  label: 'Pilates',  prefixes: ['PILATES', 'REFORMER'] },
  { key: 'LAGREE',   label: 'Lagree',   prefixes: ['LAGREE', 'MEGAFORMER'] },
  { key: 'BARRE',    label: 'Barre',    prefixes: ['BARRE'] },
  { key: 'OTHER',    label: 'Other',    prefixes: [] },
];
CATEGORY_MAP.forEach(function (cat) {
  Object.defineProperty(cat, 'color', {
    enumerable: true,
    get: function () {
      var token = 'var(--ct-' + cat.key.toLowerCase() + '-base)';
      try {
        if (typeof window !== 'undefined' && window.PsycleClassColours) {
          return window.PsycleClassColours.resolve(cat.key).base || token;
        }
      } catch (e) {}
      return token;
    },
  });
});

function getCategory(typeName) {
  const n = (typeName || '').toUpperCase();
  // Equipment-defined categories win over discipline words in the name:
  // "LAGREE: Upper Body & Core" is Lagree (not Strength), and
  // "REFORMER: Strength" is a reformer class (not Strength) — match these
  // BEFORE the generic loop so variant names can never leak into other
  // buckets via includes(). Order-independent by design: don't rely on
  // CATEGORY_MAP ordering for correctness.
  if (n.includes('LAGREE') || n.includes('MEGAFORMER')) return CATEGORY_MAP.find(c => c.key === 'LAGREE');
  if (n.includes('REFORMER')) return CATEGORY_MAP.find(c => c.key === 'PILATES');
  for (const cat of CATEGORY_MAP) {
    if (cat.key === 'OTHER') continue;
    if (cat.prefixes.some(p => n.startsWith(p) || n.includes(p))) return cat;
  }
  return CATEGORY_MAP.find(c => c.key === 'OTHER');
}

/**
 * Get the slot label for a class type.
 * Ride → Bike, Reformer/Pilates → Bed, Lagree → Machine (Megaformer),
 * Strength → Bench, else → Spot
 */
function slotLabel(typeName) {
  const n = (typeName || '').toUpperCase();
  if (n.includes('REFORMER')) return 'Bed';
  const cat = getCategory(typeName);
  if (!cat) return 'Spot';
  if (cat.key === 'RIDE') return 'Bike';
  if (cat.key === 'PILATES') return 'Bed';
  if (cat.key === 'LAGREE') return 'Machine';
  if (cat.key === 'STRENGTH') return 'Bench';
  return 'Spot';
}
// ── pure:core:end ──

// ── pure:class-type:start ── (DOM-free; tests/suites/9a-foundation.js evaluates this block)
// Crisp Colour: a class type is shown by its COLOUR (data-ct → css/crisp.css)
// and by its PICTOGRAM — one family of inline stroke SVGs on a 24 grid, round
// caps and joins, drawn in currentColor so the tile decides the ink. Never an
// emoji. Bike, bench, reformer bed, mat and barre are the boards' own marks;
// the bolt (HIIT), the two-post machine (Lagree) and the pulse (anything else)
// were drawn to sit with them.
var CLASS_PICTOGRAMS = {
  ride: '<circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/><path d="M5.5 16.5h7l-3-7.5h6l3 7.5"/><path d="M12.5 16.5l3-7.5"/><path d="M8 6.5h3.5"/><path d="M15.5 9l-.8-3h2.6"/>',
  strength: '<rect x="3" y="11" width="18" height="3.5" rx="1.75"/><path d="M6.5 14.5V19"/><path d="M17.5 14.5V19"/><path d="M8 6.5h8"/><path d="M8 4.5v4"/><path d="M16 4.5v4"/>',
  yoga: '<path d="M3 19h14"/><circle cx="17" cy="15.5" r="3.5"/><circle cx="17" cy="15.5" r="0.6"/>',
  hiit: '<path d="M13.5 3L6 13.5h5.5L10.5 21 18 10.5h-5.5z"/>',
  pilates: '<path d="M2.5 17.5h19"/><path d="M5 17.5V20"/><path d="M19 17.5V20"/><rect x="8" y="13" width="8" height="4.5" rx="1.5"/><path d="M4.5 17.5v-6"/><path d="M3 11.5h3"/><path d="M19.5 17.5V7.5"/><path d="M19.5 8.5l-4 4.5"/>',
  lagree: '<path d="M2.5 17.5h19"/><path d="M5 17.5V20"/><path d="M19 17.5V20"/><rect x="9" y="13" width="6" height="4.5" rx="1.5"/><path d="M4.5 17.5V9.5"/><path d="M3 9.5h3"/><path d="M19.5 17.5V9.5"/><path d="M18 9.5h3"/><path d="M6.5 15.25H9"/>',
  barre: '<path d="M2.5 8h19"/><path d="M6 5v14.5"/><path d="M18 5v14.5"/><path d="M6 13h12"/><path d="M3.5 19.5h5"/><path d="M15.5 19.5h5"/>',
  other: '<path d="M2.5 12.5H7l2.5-6.5 4.5 12 2.5-5.5h5"/>',
};

// "RIDE: 45" → "ride". The value of data-ct for a class of that type.
function classTypeKey(typeName) {
  var cat = getCategory(typeName);
  var key = String((cat && cat.key) || 'OTHER').toLowerCase();
  return Object.prototype.hasOwnProperty.call(CLASS_PICTOGRAMS, key) ? key : 'other';
}

// The pictogram of a category, as an SVG string: classPictogram('RIDE', 18).
// `key` is a CATEGORY_MAP key in either case (anything else → the neutral
// mark); `size` is the px box (8–96, default 18). Decorative by contract —
// aria-hidden, no title, no id — so the component names the class in text.
// The stroke thickens as the mark shrinks, as on the boards (2 at 24px, 2.2 at
// 18px, 2.5 at 13px). Nothing caller-supplied reaches the markup.
function classPictogram(key, size) {
  var k = String(key == null ? '' : key).toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(CLASS_PICTOGRAMS, k)) k = 'other';
  var px = Math.round(Number(size));
  if (!(px >= 8 && px <= 96)) px = 18;
  var stroke = px <= 14 ? 2.5 : px <= 16 ? 2.3 : px <= 19 ? 2.2 : px <= 22 ? 2.1 : 2;
  return '<svg class="ct-pic" width="' + px + '" height="' + px + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + stroke +
    '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + CLASS_PICTOGRAMS[k] + '</svg>';
}

// THE TIME BLOCK of the class card — built here, ONCE, for every wearer of the
// full-size component: Discover's eventCard, My Bookings' live card and its
// saved copy, and the Class colours preview (js/tabs.js). The 24-hour time
// ("18:30", from _clock24 — pure:clock) leads in the display face, over ONE
// small line: the duration alone ("45 min"), as on the approved boards. Every
// time is five tabular digits wide, so every card's text starts on the same
// grid line. A held class says its day first. css/crisp.css 9b.7 styles all
// of it from `.class-card[data-ct] .cc-time…`.
//   o.hours 0–23 · o.mins 0–59 (a number or "05") · o.duration minutes (optional)
//   o.dayHtml  "Thu 24", ALREADY escaped by the caller (optional)
//   o.hook     a wearer's own layout hook on the block ("mb-when")
// Apart from dayHtml only numbers reach the markup.
function _ccTimeHTML(o) {
  o = o || {};
  var clock = _clock24(o.hours, o.mins), dur = Number(o.duration);
  var hook = String(o.hook == null ? '' : o.hook).replace(/[^\w -]/g, '');
  return '<div class="cc-time' + (hook ? ' ' + hook : '') + '">' +
    (o.dayHtml ? '<span class="mb-day">' + o.dayHtml + '</span>' : '') +
    '<span class="cc-time-h">' + (clock || '--:--') + '</span>' +
    (dur > 0 ? '<span class="cc-dur">' + dur + ' min</span>' : '') +
  '</div>';
}
// ── pure:class-type:end ──

/** Get slot label from an event ID via the cache */
function slotLabelForEvent(eventId) {
  const evt = _eventCache[String(eventId)];
  return evt ? slotLabel(evt._typeName) : 'Spot';
}

// ── pure:core:start ──
/**
 * Pluralize a slot noun, preserving case: Bench -> Benches; Bike -> Bikes,
 * Bed -> Beds, Spot -> Spots (and the lowercase variants used in the picker).
 */
function pluralizeSlotLabel(label) {
  if (!label) return label;
  return /^bench$/i.test(label) ? label + 'es' : label + 's';
}

// ── pure:copy:start ── (DOM-free; tests/suites/copy.js evaluates this block)
/**
 * A count with its noun: "0 classes", "1 class", "2 classes". Counts used to
 * be glued to a fixed plural ("1 classes booked", "1 instructors"), which is
 * what a NEW member reads everywhere on day one. Pass `many` only where
 * adding "s" is wrong (class → classes). Named _plural, not _count: `_count`
 * is already a property on the rebook candidates further down.
 */
function _plural(n, one, many) {
  return n + ' ' + (Number(n) === 1 ? one : (many || one + 's'));
}
// ── pure:copy:end ──

/**
 * Format a booked slot list with the correct noun for the class type.
 * e.g. formatSlots('Bench', [12, 15]) -> "Benches 12 & 15", ('Bike', [7]) -> "Bike 7",
 * ('Bed', [1, 2, 3]) -> "Beds 1, 2 & 3" (three or four — the usual week books up
 * to four — read as a list: "5 & 6 & 11 & 10" did not).
 */
function formatSlots(label, slots) {
  if (!slots || !slots.length) return '';
  const noun = slots.length === 1 ? label : pluralizeSlotLabel(label);
  return noun + ' ' + (slots.length > 2 ? slots.slice(0, -1).join(', ') + ' & ' + slots[slots.length - 1] : slots.join(' & '));
}
// ── pure:core:end ──

/**
 * Wrap an instructor name in a clickable link that opens their profile modal.
 */
function instrLink(name, instrId) {
  if (!name) return '';
  var safeName = escapeForJsString(name);
  var sid = instrId ? String(instrId) : '';
  if (!sid && typeof instructors !== 'undefined') {
    var match = instructors.find(function (i) { return i.full_name === name; });
    if (match) sid = String(match.id);
  }
  // The id can come out of stored history (so: out of an imported settings
  // file) and it sits in a quoted handler argument below — as `name` does.
  sid = escapeForJsString(sid);
  if (!sid) return escapeHTML(name);
  // role + tabindex: a span is otherwise unreachable by keyboard and unnamed as
  // a control (Enter/Space arrive through the one delegated [role="button"] handler).
  return '<span class="instructor-link" role="button" tabindex="0" onclick="event.stopPropagation();window._features_openInstructorModal(\'' +
    safeName + '\',\'' + sid + '\')">' + escapeHTML(name) + '</span>';
}

// selectedCategories is managed by state.js

// ── Strength sub-filter ──────────────────────────────────────────
const STRENGTH_SUBS = [
  { key: 'UPPER', label: 'Upper', match: 'Upper Body' },
  { key: 'LOWER', label: 'Lower', match: 'Lower Body' },
  { key: 'FULL',  label: 'Full Body', match: 'Full Body' },
];
// selectedStrengthSubs is managed by state.js (default: all selected)

// ── Reformer sub-filter (variants of the Pilates category) ───────
// Mirrors STRENGTH_SUBS: shown when Pilates is selected, matches the
// variant word in the type name ("REFORMER: Signature 55" / "REFORMER:
// Strength 50"). A class matching neither sub always shows.
const REFORMER_SUBS = [
  { key: 'SIGNATURE', label: 'Signature', match: 'Signature' },
  { key: 'STRENGTH',  label: 'Strength',  match: 'Strength' },
];
// selectedReformerSubs is managed by state.js (default: all selected)

// Every pill row is rebuilt from state on each press, which destroys the very
// button that was pressed: focus fell to <body>, so the new aria-pressed was
// never spoken, the next Tab left the row and a second Space scrolled the
// page. A row keeps its order across a repaint, so the button at the same
// index is the pressed one's successor. `selector`: the row's buttons, where
// they are not the box's direct children (the picker's change-chips).
function _repaintKeepingFocus(box, html, selector) {
  const items = () => Array.from((selector && typeof box.querySelectorAll === 'function' ? box.querySelectorAll(selector) : box.children) || []);
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  const at = active ? items().indexOf(active) : -1;
  box.innerHTML = html;
  const next = at > -1 ? items()[at] : null;
  if (next && typeof next.focus === 'function') { try { next.focus({ preventScroll: true }); } catch (e) {} }
}

function renderReformerSubPills() {
  const container = document.getElementById('reformerSubPills');
  if (!container) return;
  const pilatesActive = selectedCategories.has('PILATES');
  container.style.display = pilatesActive ? 'flex' : 'none';
  if (!pilatesActive) return;
  _repaintKeepingFocus(container, REFORMER_SUBS.map(s => {
    const active = selectedReformerSubs.has(s.key);
    // No inline colours (here or on the strength pills): an inline style beats
    // the stylesheet, and .sub-pill in redesign.css is themed per token.
    return `<button class="sub-pill${active ? ' active' : ''}" aria-pressed="${active}"
      onclick="toggleReformerSub('${s.key}')">${s.label}</button>`;
  }).join(''));
}

function toggleReformerSub(key) {
  if (selectedReformerSubs.has(key)) {
    // Don't allow deselecting all
    if (selectedReformerSubs.size === 1) return;
    selectedReformerSubs.delete(key);
  } else {
    selectedReformerSubs.add(key);
  }
  renderReformerSubPills();
  triggerAutoSearch();
}

function renderStrengthSubPills() {
  const container = document.getElementById('strengthSubPills');
  if (!container) return;
  const strengthActive = selectedCategories.has('STRENGTH');
  container.style.display = strengthActive ? 'flex' : 'none';
  if (!strengthActive) return;
  _repaintKeepingFocus(container, STRENGTH_SUBS.map(s => {
    const active = selectedStrengthSubs.has(s.key);
    return `<button class="sub-pill${active ? ' active' : ''}" aria-pressed="${active}"
      onclick="toggleStrengthSub('${s.key}')">${s.label}</button>`;
  }).join(''));
}

function toggleStrengthSub(key) {
  if (selectedStrengthSubs.has(key)) {
    // Don't allow deselecting all
    if (selectedStrengthSubs.size === 1) return;
    selectedStrengthSubs.delete(key);
  } else {
    selectedStrengthSubs.add(key);
  }
  renderStrengthSubPills();
  triggerAutoSearch();
}

// ── pure:core:start ──
// Extract slot numbers from any API format:
//   [7, 15]                          → [7, 15]
//   [{id:7, label:"12"}, ...]        → [12, ...]  (prefer label for display)
//   [{slot_id:7, number:12}, ...]    → [12, ...]
//   "7"                              → [7]
function _parseSlots(raw) {
  if (!raw) return [];
  if (!Array.isArray(raw)) raw = [raw];
  return raw.map(s => {
    if (s == null) return 0;
    if (typeof s === 'number') return s;
    if (typeof s === 'string') return Number(s) || 0;
    // Object: prefer label/number for display, fall back to id
    return Number(s.label ?? s.number ?? s.slot_number ?? s.id ?? s.slot_id ?? 0);
  }).filter(Boolean);
}
// ── pure:core:end ──

// Supersede guard: fetchMyBookings is fired concurrently from many places
// (visibility, pull-to-refresh, post-booking, offline replay). Only the
// NEWEST call may rebuild _myBookings — a slow, stale response landing after
// a fresh booking would otherwise wipe that booking from local state.
let _bookingsSeq = 0;

// An empty _myBookings alone can't tell "nothing booked" from "couldn't ask".
// 'failed' = this session's list has never loaded and the last /bookings
// attempt failed: My Bookings then offers Retry instead of the confirmed-empty
// "Nothing booked" hero. Once 'loaded', a failed REFRESH keeps the last good
// list — empty or not — like every other failed refresh here.
let _bookingsLoadState = 'pending'; // 'pending' | 'loaded' | 'failed'

// A /bookings attempt failed (never called for a superseded one — the newer
// call owns the screen). A 401 has already ended the session by the time it
// gets here: that is showSessionExpired's repaint, not a load failure.
function _noteBookingsLoadFailed() {
  if (_bookingsLoadState === 'loaded' || !getBearerToken()) return;
  _bookingsLoadState = 'failed';
  if (!Object.keys(_myBookings).length) renderMyBookings();
}

// Local writes to _myBookings (book / join / leave / cancel / claim). A fetch
// that STARTED before the last write is working from a stale server snapshot:
// it must not "release" buttons and should heal itself with a re-run.
let _bookingsLocalWriteAt = 0;
function _noteLocalBookingWrite() { _bookingsLocalWriteAt = Date.now(); }

// Hydrate _eventCache for the given event ids from GET /events/{id}.
// One retry, not the default three: My Bookings' first paint can wait on this,
// and a single hung request (15s x 4 + backoff) held it for over a minute.
// Every later fetchMyBookings asks again for whatever is still missing.
async function _hydrateEventDetails(ids) {
  await Promise.all(ids.map(async evtId => {
    try {
      const r = await apiFetch(`/events/${evtId}`, { retries: 1 });
      if (!r.ok) return;
      const d = await r.json();
      const evt = d.data || d;
      const rels = d.relations || {};
      const instrMap = Object.fromEntries((rels.instructors || []).map(i => [i.id, i]));
      const studioMap = Object.fromEntries((rels.studios || []).map(s => [s.id, s]));
      const locationMap = Object.fromEntries((rels.locations || []).map(l => [l.id, l]));
      const typeMap = Object.fromEntries((rels.event_types || []).map(t => [t.id, t]));
      Object.assign(_studioMap, studioMap);
      const type = typeMap[evt.event_type_id];
      const instr = instrMap[evt.instructor_id];
      const studio = studioMap[evt.studio_id];
      const loc = studio ? locationMap[studio.location_id] : null;
      _eventCache[evtId] = {
        ...evt,
        _typeName: type?.name || 'Class',
        _instrName: instr?.full_name || '',
        _locName: loc ? loc.name.replace('Psycle ', '') : '',
        _locFullName: loc ? loc.name : '',
        _locAddress: loc ? (loc.address || '') : '',
        _studioName: studio ? studio.name : '',
      };
    } catch (e) { console.warn('[psycle] event detail failed:', evtId, e); }
  }));
}

// A waitlist entry already carries its class — seed _eventCache from it for
// any event GET /events/{id} couldn't hydrate so the place still renders.
function _seedEventCacheFromEntries(map, entries) {
  (entries || []).forEach(entry => {
    const id = String(entry.eventId);
    if (map[id] && !_eventCache[id]) {
      const seeded = _eventCacheEntryFromWaitlist(entry.event);
      if (seeded) _eventCache[id] = seeded;
    }
  });
}

// ── Saved class details (My Bookings' first paint) ───────────────
// _eventCache is memory-only, so after a relaunch every held class cost one
// GET /events/{id} BEFORE My Bookings, the tab badge, the widget and the
// calendar sync could move. The details of the classes in the last confirmed
// list are kept in psycle_booked_event_details and stand in — flagged
// _fromSnapshot — for ids THIS /bookings answer names and nothing else knows
// yet; fetchMyBookings re-reads them straight after its render. Never a source
// of bookings: what is held only ever comes from the server's list (the saved
// copy of My Bookings is the offline story, and stays out of app state).

// ── pure:event-details:start ── (DOM-free; tests/suites/event-details.js evaluates this block)
const EVENT_DETAILS_MAX_ITEMS = 60;
const EVENT_DETAILS_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // since a real /events/{id} last confirmed them

// One class → the slim record kept between launches, or null. Used on the way
// out AND on the way in: storage is not trusted (hand-edited, half-written,
// another build), and the card renderers interpolate the ids into markup and
// inline handlers — so everything numeric is coerced, as the waitlist seed does.
// `id` = the _myBookings key, for a cache entry that carries none of its own.
function _slimEventDetails(evt, id) {
  if (!evt || typeof evt !== 'object') return null;
  const eventId = Number(id != null ? id : evt.id);
  const start = String(evt.start_at == null ? '' : evt.start_at).trim();
  if (!(eventId > 0) || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(start)) return null;
  const num = v => (Number(v) > 0 ? Number(v) : null);
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max || 120) : '');
  const duration = Number(evt.duration);
  return {
    id: eventId,
    start_at: start,
    duration: duration > 0 && duration < 600 ? Math.round(duration) : 0,
    studio_id: num(evt.studio_id),
    instructor_id: num(evt.instructor_id),
    event_type_id: num(evt.event_type_id),
    is_live_stream: !!evt.is_live_stream,
    _typeName: str(evt._typeName) || 'Class',
    _instrName: str(evt._instrName),
    _locName: str(evt._locName),
    _locFullName: str(evt._locFullName),
    _locAddress: str(evt._locAddress, 200),
    _studioName: str(evt._studioName),
  };
}

// A stored item → an _eventCache record, or null: malformed, or not confirmed
// by a real /events/{id} for too long. Availability (full / waitlistable /
// spots) is deliberately not kept — bookClass and the sheet read it fresh.
function _eventCacheEntryFromSnapshot(item, nowMs) {
  const slim = _slimEventDetails(item);
  const seenAt = Number(item && item.seenAt);
  if (!slim || !(seenAt > 0) || nowMs - seenAt > EVENT_DETAILS_MAX_AGE_MS) return null;
  slim._fromSnapshot = true; // provenance: last launch's details — every fetchMyBookings re-reads these
  slim._snapshotSeenAt = seenAt;
  return slim;
}

// What is in storage → { [eventId]: _eventCache record }, or null.
function _coerceEventDetailsSnapshot(raw, nowMs) {
  let snap = raw;
  if (typeof raw === 'string') { try { snap = JSON.parse(raw); } catch (e) { return null; } }
  if (!snap || typeof snap !== 'object' || snap.v !== 1 || !Array.isArray(snap.items)) return null;
  const byId = {};
  snap.items.slice(0, EVENT_DETAILS_MAX_ITEMS).forEach(item => {
    const entry = _eventCacheEntryFromSnapshot(item, nowMs);
    if (entry) byId[String(entry.id)] = entry;
  });
  return byId;
}

// The record to store: the classes in `bookings` and no others, so it prunes
// itself as classes pass or are cancelled. Details still standing in from the
// last snapshot keep the time they were really confirmed — re-saving them on
// every launch must not keep them alive for ever.
function _buildEventDetailsSnapshot(bookings, eventCache, nowMs) {
  const items = [];
  Object.keys(bookings || {}).forEach(id => {
    const evt = (eventCache || {})[id];
    const slim = _slimEventDetails(evt, id);
    if (!slim) return;
    slim.seenAt = evt._fromSnapshot ? (Number(evt._snapshotSeenAt) || 0) : nowMs;
    items.push(slim);
  });
  return { v: 1, items: items.slice(0, EVENT_DETAILS_MAX_ITEMS) };
}

// Did anything a card, the calendar event or the widget shows about a class
// move between two records of it? (start_at in one form: the API sends
// 'YYYY-MM-DD HH:MM:SS', the waitlist seed the T form.)
function _eventDetailsDiffer(a, b) {
  if (!a || !b) return !!a !== !!b;
  const start = e => String(e.start_at || '').replace(' ', 'T').slice(0, 19);
  if (start(a) !== start(b)) return true;
  if (['duration', 'studio_id', 'instructor_id', 'event_type_id'].some(k => (Number(a[k]) || 0) !== (Number(b[k]) || 0))) return true;
  if (['_typeName', '_instrName', '_locName', '_studioName'].some(k => String(a[k] || '') !== String(b[k] || ''))) return true;
  return !!a.is_live_stream !== !!b.is_live_stream;
}
// ── pure:event-details:end ──

const EVENT_DETAILS_KEY = 'psycle_booked_event_details';

// Stand-in details for `ids` — only ever ids the server's list has just named
// and _eventCache knows nothing about.
function _seedEventCacheFromSnapshot(ids) {
  let byId = null;
  try { byId = _coerceEventDetailsSnapshot(localStorage.getItem(EVENT_DETAILS_KEY), Date.now()); } catch (e) {}
  if (!byId) return;
  ids.forEach(id => { if (!_eventCache[id] && byId[id]) _eventCache[id] = byId[id]; });
}

// Only from a list Psycle confirmed this session (as the saved copy): before
// that _myBookings can be empty or hold just the class booked a moment ago.
function _saveEventDetailsSnapshot() {
  if (_bookingsLoadState !== 'loaded' || !getBearerToken()) return;
  try {
    localStorage.setItem(EVENT_DETAILS_KEY, JSON.stringify(_buildEventDetailsSnapshot(_myBookings, _eventCache, Date.now())));
  } catch (e) {}
}

// Re-read the classes this pass painted from saved details. It runs AFTER the
// render, so a slow /events/{id} no longer holds My Bookings back. Repaint and
// re-announce only when something shown has really moved (a needless
// bookings:loaded is a calendar reconcile and a widget write; a needless render
// blinks the list) — and only while this pass's map is still the live one: a
// newer pass re-reads whatever it still finds flagged.
function _refreshSeededEventDetails(next, ids) {
  const seeded = {};
  ids.forEach(id => { seeded[id] = _eventCache[id]; });
  _hydrateEventDetails(ids).then(() => {
    if (_myBookings !== next) return;
    const reread = ids.filter(id => _eventCache[id] !== seeded[id]);
    if (!reread.length) return; // Psycle didn't answer for any of them — the next pass asks again
    const moved = reread.some(id => _eventDetailsDiffer(seeded[id], _eventCache[id]));
    if (moved) {
      PsycleEvents.emit('bookings:loaded', _myBookings); // the listener below saves the fresh details
      renderMyBookings();
    } else {
      _saveEventDetailsSnapshot(); // confirmed as they were: their age starts again
    }
  }).catch(() => {});
}

if (typeof PsycleEvents !== 'undefined' && typeof PsycleEvents.on === 'function') {
  PsycleEvents.on('bookings:loaded', () => _saveEventDetailsSnapshot());
  // Sign-out and session expiry: the next member starts from the server. A
  // token that is merely not in memory yet (crypto set-up timed out on a slow
  // launch — see the saved copy's listener) is not an ending; every real one
  // removes the stored keys before it emits. A localStorage that throws still
  // deletes.
  PsycleEvents.on('auth:changed', () => {
    if (getBearerToken()) return;
    try {
      if (localStorage.getItem('psycle_bearer_token_enc') || localStorage.getItem('psycle_bearer_token')) return;
    } catch (e) {}
    try { localStorage.removeItem(EVENT_DETAILS_KEY); } catch (e) {}
  });
}

// Re-apply the held state to every rendered Discover button, and release
// cards whose booking/place no longer exists (unless a local write may have
// raced this snapshot).
function _resyncDiscoverButtons(allowRelease) {
  const midFlight = btn => btn.dataset.busy === '1' || btn.textContent === '…';
  if (allowRelease) {
    document.querySelectorAll('.class-card:not(.my-booking-card) .book-btn.booked').forEach(btn => {
      const id = btn.closest('.class-card')?.dataset?.id;
      if (id && !_myBookings[String(id)] && !midFlight(btn)) _syncCardButtonsForEvent(id);
    });
  }
  Object.entries(_myBookings).forEach(([evtId, booking]) => {
    document.querySelectorAll(`.class-card[data-id="${Number(evtId)}"]:not(.my-booking-card) .book-btn`).forEach(btn => {
      if (midFlight(btn)) return; // a booking flow is in progress on this button
      applyBookedState(btn, Number(evtId), booking);
    });
  });
}

// True while a user-facing dialog is up (a background announcement must not
// replace it — confirmModal is single-instance). The usual-week sheet counts:
// it has its own id, and a run inside it re-reads /bookings after every seat —
// each of those used to be a chance for "Spot opened", the offline-booking ask
// or the sync prompt to open over (or, at a lower z-index, UNDER) the run.
function _dialogOpen() {
  if (document.getElementById('psycleConfirmOverlay') || document.getElementById('usualWeekSheet')) return true;
  const bike = document.getElementById('bikeModal');
  return !!(bike && bike.style.display && bike.style.display !== 'none');
}

let _allocAnnounceTimer = null;
let _announceShowing = false;
const _pendingAnnounce = { allocated: {}, emitted: {} }; // allocations found but not yet acknowledged

// Persist the place memory from the LIVE state at write time (never from an
// older snapshot — a join/leave/claim may have updated it in between): held
// (seatless) places come from _myBookings; `allocated` keeps what's remembered
// while it is still a seat (or was marked moments ago), plus this pass's finds
// — minus anything still waiting to be announced.
function _persistPlacesNow(diffAllocated) {
  const cur = _readWaitlistPlaces();
  const now = Date.now();
  const places = _heldPlacesOf(_myBookings);
  const allocated = {};
  const isSeat = id => !!(_myBookings[id] && !_myBookings[id].waitlisted && (_myBookings[id].bookingId || (_myBookings[id].slots || []).length));
  const recent = iso => { const t = Date.parse(iso); return !isNaN(t) && now - t < 120000; };
  Object.keys(cur.allocated || {}).forEach(id => { if (isSeat(id) || recent(cur.allocated[id])) allocated[id] = cur.allocated[id]; });
  Object.keys(diffAllocated || {}).forEach(id => { allocated[id] = diffAllocated[id]; });
  // Not yet acknowledged by the user: keep it looking like a held place so a
  // relaunch before the dialog is dismissed announces it again.
  Object.keys(_pendingAnnounce.allocated).forEach(id => {
    delete allocated[id];
    if (cur.places && cur.places[id]) places[id] = cur.places[id];
  });
  _writeWaitlistPlaces({ places, allocated });
}

// Announce waitlist places Psycle turned into real (chargeable) seats. Waits
// for any open dialog to close first; the allocation is only recorded as
// announced once the user has actually dismissed the dialog (a dialog that
// gets displaced by another one re-arms itself).
function _announceAllocations(eventIds, diffToPersist) {
  (eventIds || []).map(String).forEach(id => {
    _pendingAnnounce.allocated[id] = (diffToPersist && diffToPersist.allocated && diffToPersist.allocated[id]) || new Date().toISOString();
  });
  if (!Object.keys(_pendingAnnounce.allocated).length) return;
  const show = () => {
    // …or for the welcome, which a signed-in member can replay from Settings:
    // it is full-screen and above confirmModal, so the dialog opened UNDER it,
    // took focus there, and the Escape that closed the welcome answered this
    // too — a chargeable seat recorded as announced, never seen. (Checked here
    // and not in _dialogOpen(): launch rendering must not wait for the welcome.)
    if (_dialogOpen() || document.getElementById('onboardOverlay')) { _allocAnnounceTimer = setTimeout(show, 700); return; }
    _allocAnnounceTimer = null;
    const ids = Object.keys(_pendingAnnounce.allocated);
    if (!ids.length) return;
    const fresh = ids.filter(id => !_pendingAnnounce.emitted[id]);
    if (fresh.length) {
      fresh.forEach(id => { _pendingAnnounce.emitted[id] = true; });
      PsycleEvents.emit('waitlist:allocated', fresh.map(Number));
      if (typeof haptic === 'function') { try { haptic('success'); } catch {} }
    }
    const line = _waitlistClassLine(ids[0]) || 'a class';
    const more = ids.length > 1 ? ` (+${ids.length - 1} more)` : '';
    // Worked out as the dialog goes up (it can wait behind another one). Both
    // parts are advisory: nothing here may stop the announcement itself.
    // "The 12-hour policy applies from now on" reads as time to decide, and an
    // allocation found under 12h out has none — say which it is. One class
    // only: two deadlines don't fit one sentence.
    let warn = "Psycle's normal 12-hour cancellation policy applies to it from now on.";
    try {
      const dl = ids.length === 1 && _eventCache[ids[0]] ? _cancelDeadline(_eventCache[ids[0]].start_at) : null;
      if (dl && dl.hoursUntil > 0) {
        warn = dl.insideWindow
          ? `This class ${_startsInPhrase(_hoursMinsLeft(dl.hoursUntil))} — cancelling it now is usually charged by Psycle.`
          : `Free cancel until ${dl.label} — after that Psycle's 12-hour cancellation policy applies.`;
      }
    } catch (e) {}
    // The usual pattern is a fallback booked for the same time: the member now
    // holds two chargeable seats, and nothing else says so.
    try {
      const clashLine = ids.map(id => _clashLabel(_clashFor(id))).find(Boolean);
      if (clashLine) warn = clashLine + '. ' + warn;
    } catch (e) {}
    let replaced = false;
    _announceShowing = true;
    confirmModal({
      title: "You're in — Psycle gave you a spot",
      body: `Your waitlist place for ${line}${more} is now a confirmed booking. It's in My Bookings (and your calendar/widget if you sync).`,
      warn,
      confirmText: 'View my bookings',
      cancelText: 'OK',
      onReplaced: () => { replaced = true; },
    }).then(go => {
      _announceShowing = false;
      clearTimeout(_allocAnnounceTimer);
      if (replaced) { _allocAnnounceTimer = setTimeout(show, 700); return; }
      // Acknowledged: record as announced and stop treating them as pending.
      const acked = {};
      ids.forEach(id => { acked[id] = _pendingAnnounce.allocated[id]; delete _pendingAnnounce.allocated[id]; delete _pendingAnnounce.emitted[id]; });
      _persistPlacesNow(acked);
      // Allocations that arrived while this dialog was up get their own turn.
      if (Object.keys(_pendingAnnounce.allocated).length) _allocAnnounceTimer = setTimeout(show, 400);
      if (go && typeof switchTab === 'function') switchTab('bookings');
    });
  };
  clearTimeout(_allocAnnounceTimer);
  if (!_announceShowing) show();
}

// The other ending: a remembered place that is now neither a place nor a seat.
// Mostly that is the member leaving (here, or in Psycle's own app) or a class
// long gone — nothing to say. Only when the waitlist has just CLOSED on it (the
// last 30 minutes before class) is it news, and without a word the card simply
// vanished: indistinguishable from a glitch. NOT once the class has started:
// /bookings lists upcoming classes only, so a place Psycle DID turn into a seat
// the member attended is absent from both lists too — "ended without a booking"
// would be false, about a class they were charged for. Said once per
// place, never for one left from this app, and worded so it stays true however
// the place ended. The class is read from the cache or, on a cold launch, from
// the saved bookings copy — it still holds the place until 'bookings:loaded'
// rewrites it, so this runs before that emit.
const _placesLeftHere = {}; // eventId → true once leaveWaitlist has dealt with it this session
const _endedPlacesTold = {};
function _noteEndedPlaces(ids) {
  const told = [];
  (ids || []).map(String).forEach(id => {
    if (_endedPlacesTold[id] || _placesLeftHere[id]) return;
    try {
      let startAt = _eventCache[id] && _eventCache[id].start_at;
      let label = startAt ? _waitlistClassLine(id) : '';
      if (!startAt && typeof _readBookingsSnapshot === 'function' && currentUser) {
        const snap = _readBookingsSnapshot();
        const it = snap && snap.owner === String(currentUser.id) ? snap.items.find(x => x.id === id && x.waitlisted) : null;
        if (it) { startAt = it.start_at; label = [it.type, it.instructor].filter(Boolean).join(' · '); }
      }
      const startMs = _waitlistTimeMs(startAt);
      if (isNaN(startMs) || Date.now() >= startMs || _waitlistPhase(startAt) !== 'closed') return;
      _endedPlacesTold[id] = true;
      told.push(label || 'a class');
    } catch (e) { /* advisory */ }
  });
  if (!told.length) return;
  toast(told.length === 1
    ? `Your waitlist place for ${told[0]} ended without a booking — that waitlist has closed`
    : `Your waitlist places for ${told[0]} (+${told.length - 1} more) ended without a booking — those waitlists have closed`, 'info');
}

const WAITLISTS_DEADLINE_MS = 5000; // don't let a slow /waitlists stall the bookings pipeline

// Resolves to true when THIS call's response was applied to _myBookings
// (false = superseded by a newer call or failed) so callers that need
// fresh state can detect a no-op and retry.
async function fetchMyBookings() {
  const mySeq = ++_bookingsSeq;
  const startedAt = Date.now();
  if (!getBearerToken()) {
    _myBookings = {};
    _bookingsLoadState = 'pending'; // whoever signs in next starts from the server's answer
    renderMyBookings(); // still render — the signed-out empty state lives there
    return true;
  }
  try {
    // Waitlist places are a separate resource; fetch them alongside bookings.
    const waitlistsPromise = fetchMyWaitlists(startedAt).catch(() => null);
    const res = await apiFetch('/bookings?limit=200');
    if (mySeq !== _bookingsSeq) return false; // a newer fetch superseded this one
    if (!res.ok) { _noteBookingsLoadFailed(); return false; }
    const data = await res.json();
    if (mySeq !== _bookingsSeq) return false;
    const list = Array.isArray(data) ? data : (data.data || []);
    // (typeof: the suites run this function on its own, without the helper.)
    if (list.length && typeof _recordShape === 'function') _recordShape('booking', list[0]);

    // Build the new map locally and swap it in ONCE (right before emit) so no
    // consumer ever observes a half-built, places-free state.
    // The API returns one record per seat. Multiple seats for the same
    // event_id appear as separate booking records, each with its own
    // id (bookingId) and slot number.  We accumulate them — including
    // slot-less records (no-layout studios book by count), so a whole-booking
    // cancel can remove every space and the card can say how many are held.
    const next = {};
    list.forEach(b => {
      const evtId = String(b.event_id);
      const slotNum = Number(b.slot) || 0; // API field is "slot" (singular)
      if (!next[evtId]) next[evtId] = { bookingId: b.id, bookingIds: [], slots: [], slotBookings: {}, waitlisted: false };
      if (b.id != null && !next[evtId].bookingIds.includes(b.id)) next[evtId].bookingIds.push(b.id);
      if (slotNum) {
        next[evtId].slots.push(slotNum);
        next[evtId].slotBookings[slotNum] = b.id;
      }
    });

    // Merge waitlist places in so My Bookings, the badges and Leave/Claim all
    // see them. A real booking for the same event wins (an auto-allocated
    // place shows up in /bookings and drops out of /waitlists). A slow list
    // must not stall bookings: after a deadline we go with the last good one
    // and re-merge when the late answer lands.
    let late = false;
    let waitlistEntries = await Promise.race([
      waitlistsPromise,
      new Promise(r => setTimeout(() => r('late'), WAITLISTS_DEADLINE_MS)),
    ]);
    if (waitlistEntries === 'late') { late = true; waitlistEntries = null; }
    if (mySeq !== _bookingsSeq) return false;
    // Authoritative = actually read this pass, every page. Only then may
    // absences drive the allocation diff / memory.
    const waitlistsRead = waitlistEntries !== null;
    const waitlistsComplete = waitlistsRead && !waitlistEntries.incomplete;
    if (!waitlistsRead) waitlistEntries = _lastWaitlistEntries || [];
    _mergeWaitlistsIntoBookings(next, waitlistEntries, Date.now());
    // Couldn't read the list and have nothing from earlier this session: keep
    // remembered places visible (as "Waitlisted", unverified) rather than
    // silently showing none, and tell the user in My Bookings. Whether or not
    // the class is cached — the hydrate step below fetches it; on a cold launch
    // the cache only holds what Discover loaded, and a places-only member was
    // told "Nothing booked". 'late' = the list is still on its way (the late
    // merge below repaints): only 'failed' earns the error-style note.
    _waitlistsUnavailable = (!waitlistsRead && !_lastWaitlistEntries) ? (late ? 'late' : 'failed') : false;
    if (_waitlistsUnavailable) {
      const mem = _readWaitlistPlaces();
      Object.keys(mem.places || {}).forEach(id => {
        if (!next[id]) next[id] = { bookingId: null, slots: [], slotBookings: {}, waitlisted: true, waitlist: { id: mem.places[id], status: 'waiting', addedAt: null, expiresAt: null, unverified: true } };
      });
    }
    // Carry a recent offer probe result across the swap (probes are throttled,
    // so the new map would otherwise lose "Spot available" for ~90s).
    Object.keys(next).forEach(id => {
      const prev = _myBookings[id]?.waitlist, cur = next[id].waitlist;
      if (cur && prev && prev.id === cur.id && prev.offer && Date.now() - (prev.offer.checkedAt || 0) < 120000) cur.offer = prev.offer;
    });

    // A place we held last time that is now a real seat was ALLOCATED by
    // Psycle (chargeable, 12h policy). Compute now (for the badge); persist +
    // announce only once this pass is definitely the one being applied.
    let diff = null;
    if (waitlistsComplete) {
      diff = _diffWaitlistPlaces(_readWaitlistPlaces(), next, Date.now());
      Object.keys(diff.allocated).forEach(id => { if (next[id]) next[id].fromWaitlist = true; });
    }

    // Fetch event details for any bookings not yet in _eventCache.
    // This makes "My Bookings" self-sufficient — no search required.
    // Classes the last confirmed list already described are painted from those
    // saved details (and re-read after the render, below): only ids nothing
    // knows about still hold the first paint back.
    const unknown = Object.keys(next).filter(id => !_eventCache[id]);
    if (unknown.length) _seedEventCacheFromSnapshot(unknown);
    const uncached = Object.keys(next).filter(id => !_eventCache[id] || _eventCache[id]._fromWaitlist);
    if (uncached.length > 0) {
      if (uncached.some(id => !_eventCache[id])) showBookingSkeleton(uncached.length);
      await _hydrateEventDetails(uncached);
    }
    _seedEventCacheFromEntries(next, waitlistEntries);

    if (mySeq !== _bookingsSeq) return false; // superseded while fetching details
    // This snapshot predates a local book/cancel/join/leave: show it, but leave
    // the durable side (memory, announcements, releasing buttons) to the heal
    // re-run below, which reads fresh data.
    const racedLocalWrite = _bookingsLocalWriteAt > startedAt;
    _myBookings = next;
    _bookingsLoadState = 'loaded';
    if (diff && !racedLocalWrite) {
      _noteEndedPlaces(diff.ended); // before the emit below rewrites the saved copy it may read
      if (diff.newlyAllocated.length) _announceAllocations(diff.newlyAllocated, diff);
      else _persistPlacesNow(diff.allocated);
    }
    PsycleEvents.emit('bookings:loaded', _myBookings);
    renderMyBookings();
    _resyncDiscoverButtons(!racedLocalWrite && waitlistsRead);
    if (racedLocalWrite) setTimeout(() => { if (_myBookings === next) fetchMyBookings(); }, 250);

    // Classes painted from saved details are confirmed with Psycle now that
    // the list is up (a render() merge keeps the flag, a real re-read drops it).
    const seededIds = Object.keys(next).filter(id => _eventCache[id] && _eventCache[id]._fromSnapshot);
    if (seededIds.length) _refreshSeededEventDetails(next, seededIds);

    // Close to class time Psycle offers spots by email instead of allocating —
    // ask about places in that window so "Claim spot" shows straight away.
    // Runs after the render so a slow probe never stalls My Bookings.
    if (waitlistsRead) {
      _probeWaitlistOffers(next).then(result => {
        if (_myBookings !== next || !result || !result.probed) return; // map replaced since
        if (result.changed) renderMyBookings();
        if (result.allocated) fetchMyBookings(); // a probed place is a seat now — reload the truth
      }).catch(() => {});
    }

    // The waitlist list missed the deadline: merge it in when it arrives.
    if (late) {
      waitlistsPromise.then(async entries => {
        if (_myBookings !== next) return;
        // Late AND failed: only now is "couldn't load your waitlist places" true.
        if (!entries) {
          if (_waitlistsUnavailable === 'late') { _waitlistsUnavailable = 'failed'; renderMyBookings(); }
          return;
        }
        // A join/leave/cancel since this pass started makes the late snapshot
        // untrustworthy (it could resurrect a place just left) — re-run instead.
        if (_bookingsLocalWriteAt > startedAt) { fetchMyBookings(); return; }
        _waitlistsUnavailable = false;
        // The remembered stand-ins (above) give way to the real list: one Psycle
        // lists is replaced by its entry — under whatever id it has now, since
        // the merge keeps the first place it meets — and one a COMPLETE list
        // lacks is gone, not "couldn't re-check" until the next fetch.
        const listed = new Set(entries.map(e => String(e.eventId)));
        Object.keys(next).forEach(id => {
          const p = next[id].waitlist;
          if (next[id].waitlisted && p && p.unverified && (listed.has(id) || !entries.incomplete)) delete next[id];
        });
        _mergeWaitlistsIntoBookings(next, entries, Date.now());
        const missing = entries.map(e => String(e.eventId)).filter(id => next[id] && (!_eventCache[id] || _eventCache[id]._fromWaitlist));
        if (missing.length) await _hydrateEventDetails(missing);
        _seedEventCacheFromEntries(next, entries);
        if (_myBookings !== next || _bookingsLocalWriteAt > startedAt) return;
        // A complete late list is as authoritative as a timely one: run the
        // allocation diff now rather than leaving it to some later fetch.
        if (!entries.incomplete) {
          const lateDiff = _diffWaitlistPlaces(_readWaitlistPlaces(), next, Date.now());
          Object.keys(lateDiff.allocated).forEach(id => { if (next[id]) next[id].fromWaitlist = true; });
          _noteEndedPlaces(lateDiff.ended);
          if (lateDiff.newlyAllocated.length) _announceAllocations(lateDiff.newlyAllocated, lateDiff);
          else _persistPlacesNow(lateDiff.allocated);
        }
        renderMyBookings();
        // No bookings:loaded follows a late merge: places that only arrived here
        // would otherwise wait for the next fetch before the re-check is armed.
        if (typeof _syncWaitlistRecheck === 'function') _syncWaitlistRecheck(false);
        _resyncDiscoverButtons(true);
        // Places that arrived late are full classes too ("Available only").
        if (typeof _showOwnFullClasses === 'function') _showOwnFullClasses();
      }).catch(() => {});
    }
    return true;
  } catch (e) {
    console.warn('[psycle] fetchMyBookings failed:', e);
    if (mySeq === _bookingsSeq) _noteBookingsLoadFailed();
    return false;
  }
}
let _waitlistsUnavailable = false; // false | 'late' | 'failed': last pass couldn't read /waitlists at all (My Bookings shows a note once it has FAILED)

// The Retry button on My Bookings' "Couldn't load your bookings" hero. Success
// and failure both repaint the tab, so the button only needs restoring when
// it is still on screen (this call was superseded and the newer one is slow).
async function retryBookingsLoad(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Retrying…'; }
  let applied = false, mySeq = 0;
  try {
    const attempt = fetchMyBookings();
    mySeq = _bookingsSeq; // the number that call just took (synchronously)
    applied = await attempt;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Retry'; }
  }
  // Superseded is not failed: the newer call may be about to succeed.
  const stillFailed = !applied && mySeq === _bookingsSeq && _bookingsLoadState === 'failed';
  // The list loaded, but not one of its classes did (see renderMyBookings): the
  // same hero is back up under a 'loaded' state, and a silent Retry looks dead.
  const held = Object.keys(_myBookings);
  const stillUndrawn = applied && held.length > 0 && !held.some(id => _eventCache[id]);
  if (stillFailed || stillUndrawn) toast("Still can't load your bookings — check your connection", 'error');
}

// Refresh bookings when the page becomes visible after being hidden
document.addEventListener('visibilitychange', function () {
  if (document.hidden || !getBearerToken()) return;
  fetchMyBookings();
  // Plan usage / credits may have moved on another device (throttled). An
  // unverified session is _healAuth's job, not a numbers refresh.
  if (currentUser) refreshProfile();
});

// ── pure:a11y:start ── (DOM-free; tests/suites/a11y.js evaluates this block)
// How long a toast stays up. A fixed 3.5s was too short for the two-line
// errors about a chargeable booking: reading time scales with length, between
// the old 3.5s floor and a 10s cap. Takes anything — toast(e.message) can be
// handed undefined, and a NaN delay would hide the toast at once.
function _toastDuration(text) {
  const len = String(text == null ? '' : text).length;
  return Math.min(10000, Math.max(3500, 1500 + len * 60));
}

// Messages that reach announce() within one tick are spoken together, in
// order: "Spot claimed" is followed at once by the Booked! sheet's line, and
// replacing the first with the second would lose whichever came first — which
// can be an error. An exact repeat is said once.
function _joinAnnouncements(queue) {
  const out = [];
  (queue || []).forEach(m => {
    const s = String(m == null ? '' : m).trim();
    if (s && out[out.length - 1] !== s) out.push(s);
  });
  return out.join(' ');
}

// Which of the open aria-modal dialogs is on top: the highest z-index and,
// among equals, the one later in the document (built overlays are appended to
// <body> as they open — a confirm over the picker comes after it). `dialogs`:
// [{ z }] in document order, z = the layer's computed z-index ('auto' → NaN →
// 0). → its index, or -1 when none is open.
function _topDialogIndex(dialogs) {
  const list = Array.isArray(dialogs) ? dialogs : [];
  const zOf = d => Number(d && d.z) || 0;
  let top = -1;
  list.forEach((d, i) => { if (top === -1 || zOf(d) >= zOf(list[top])) top = i; });
  return top;
}
// ── pure:a11y:end ──

// Say something to screen-reader users. The ~130 toasts, the session banner
// and the Booked! sheet were all silent. Two fixed regions (polite / assertive)
// rather than a role on #toast: a role swapped at the moment of the message is
// unreliable in VoiceOver. Cleared first and written a beat later so the same
// text twice running ("Booking cancelled") is announced both times.
const _srQueue = { srStatus: [], srAlert: [] };
const _srTimers = {};
const _srInDialog = {}; // region id → the in-dialog copy last written to (see _dialogLiveRegion)
function announce(text, assertive) {
  const id = assertive ? 'srAlert' : 'srStatus';
  let el = document.getElementById(id);
  if (!el) {
    // A page shell that predates the regions (or a test page): make one.
    if (!document.body) return;
    el = document.createElement('div');
    el.id = id;
    el.className = 'sr-only';
    el.setAttribute('role', assertive ? 'alert' : 'status');
    el.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
    el.setAttribute('aria-atomic', 'true');
    document.body.appendChild(el);
  }
  _srQueue[id].push(text);
  el.textContent = '';
  // The same line goes inside an open aria-modal dialog too (made now, written
  // with the page's region a beat later). A copy left in ANOTHER dialog by the
  // last message is emptied here: its own clean-up timer is cancelled below.
  const inDialog = _dialogLiveRegion(id, assertive);
  if (_srInDialog[id] && _srInDialog[id] !== inDialog) _srInDialog[id].textContent = '';
  _srInDialog[id] = inDialog;
  if (inDialog) inDialog.textContent = '';
  clearTimeout(_srTimers[id]);
  _srTimers[id] = setTimeout(() => {
    const line = _joinAnnouncements(_srQueue[id]);
    _srQueue[id] = [];
    el.textContent = line;
    if (inDialog) inDialog.textContent = line;
    // Not left behind for someone swiping through the page a minute later.
    _srTimers[id] = setTimeout(() => { el.textContent = ''; if (inDialog) inDialog.textContent = ''; }, _toastDuration(line));
  }, 50);
}

// A screen reader treats everything outside an open aria-modal dialog as inert
// — #srStatus / #srAlert included — so a toast raised while one is up ("Bike 12
// cancelled" in the picker, an error under a confirm) was never spoken. The
// line is ALSO written to a region INSIDE the top-most open dialog: made on
// demand, one per politeness (no role swapped at runtime, as above), kept for
// that dialog's next message and gone with the dialog. null = no dialog open.
function _dialogLiveRegion(id, assertive) {
  try {
    if (typeof document.querySelectorAll !== 'function') return null; // a test page without one
    // Open = rendered: the token dialog and the picker are static markup inside
    // a display:none overlay while closed. And not on its way out: a dismissed
    // confirm (the usual-week sheet, the tour) stays rendered — top layer, still
    // aria-modal — for the ~200ms of its fade, and the toast its answer raised
    // ("You're offline — nothing was cancelled") went into a region that was
    // removed with it; the picker still open underneath never got one.
    const open = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]'))
      .map(d => ({ el: d, layer: d.closest('body > *') || d }))
      .filter(o => o.el.getClientRects().length > 0 && !o.layer._psycleClosing)
      .map(o => ({ el: o.el, z: parseInt(getComputedStyle(o.layer).zIndex, 10) }));
    const top = _topDialogIndex(open);
    if (top === -1) return null;
    const dialog = open[top].el;
    let region = dialog.querySelector('[data-sr-region="' + id + '"]');
    if (!region) {
      region = document.createElement('div');
      region.className = 'sr-only';
      region.setAttribute('data-sr-region', id);
      region.setAttribute('role', assertive ? 'alert' : 'status');
      region.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
      region.setAttribute('aria-atomic', 'true');
      dialog.appendChild(region);
    }
    return region;
  } catch (e) { return null; } // an announcement must never break the toast that carries it
}

// Toast (toastTimer managed by state.js)
function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  const text = String(msg ?? '');
  // The visible write stays synchronous — callers and the verify recipe read
  // #toast straight after the call.
  el.textContent = text;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), _toastDuration(text));
  announce(text, type === 'error');
}

// ── Discover empty state: signed-out users get one clear action ───
function updateDiscoverEmptyState() {
  // A stored token means signed in until Psycle says otherwise: a pending or
  // failed /profile check must not swap the quick actions for a Sign-in CTA
  // (the timetable loads with the kept token either way).
  const signedIn = !!currentUser || !!getBearerToken();
  const qa = document.getElementById('discoverQuickWrap');
  const si = document.getElementById('discoverSignin');
  if (qa) qa.style.display = signedIn ? '' : 'none';
  if (si) si.style.display = signedIn ? 'none' : '';
  // "My favourites" is dead weight until favourites exist
  const fav = document.getElementById('qaFavs');
  if (fav) fav.style.display = favouriteInstructors && favouriteInstructors.size > 0 ? '' : 'none';
}

// ── pure:session:start ── (DOM-free helpers; tests/suites/session.js evaluates this block)

// What one /profile attempt says about the session. `status` is the HTTP
// status, or 0 when the request never completed (offline / timeout). Only 401
// means the token is dead — the same rule as apiFetch. A 403 is a denial (a
// business rule, a WAF or rate limiter in front of Psycle) with a perfectly
// valid token, and this runs on every foreground / 'online' / Retry while
// Psycle is misbehaving, so reading it as expiry would sign members out.
// Any other failure with a stored token is 'unverified' — still signed in as
// far as we know — so the token is kept and the UI offers Retry, never Sign in.
function _sessionStateFor(hasToken, status) {
  if (!hasToken) return 'signed-out';
  if (status >= 200 && status < 300) return 'signed-in';
  if (status === 401) return 'expired';
  return 'unverified';
}

// Which hero a tab shows while there is no currentUser:
//   'signin'    no token — signing in is the one action that matters
//   'retry'     token kept, but the last /profile check couldn't reach Psycle
//   'checking'  token present and the first check hasn't settled yet
function _authGateViewFor(hasToken, unverified) {
  if (!hasToken) return 'signin';
  return unverified ? 'retry' : 'checking';
}

// The subscription behind the usage bar / Membership card: prefer a capped
// plan (max_bookings), fall back to any active one with a billing period
// (unlimited plan).
function _pickActiveSubscription(subs) {
  const list = Array.isArray(subs) ? subs : [];
  return list.find(s => s && s.status === 'active' && s.max_bookings > 0)
    || list.find(s => s && s.status === 'active' && s.period_start)
    || null;
}

// The first-run "sync my history" prompt is an offer, not a nag: never again
// after a completed sync, an explicit dismissal, or once real history exists.
function _shouldOfferHistorySync(s) {
  return !!(s && s.hasToken && !s.synced && !s.dismissed && !(s.historyCount > 10));
}

// The member in a /profile body — `{data: {...}}` or the bare object — or null when the
// body is not a profile at all. An ARRAY is an object to typeof: `[]` (or `{data: []}`)
// once read as a signed-in member with no name, no plan and no id, where the rule is
// "a 200 whose body cannot be read as a profile is unverified" (see Session states).
function _profileFrom(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const user = Object.prototype.hasOwnProperty.call(data, 'data') && data.data != null ? data.data : data;
  if (!user || typeof user !== 'object' || Array.isArray(user)) return null;
  return user;
}
// ── pure:session:end ──

// Auth check
//
// ONE event tells every module the session changed:
//   PsycleEvents.emit('auth:changed', { signedIn, initial, unverified })
//     signedIn    a /profile check succeeded — currentUser is set
//     initial     true only for the first outcome of this page load; listeners
//                 that start work the launch path already does (search()) skip it
//     unverified  a token is stored but Psycle couldn't be reached: NOT signed
//                 out — show Retry (authGateHTML), never a Sign-in CTA
// Emitted by checkAuth (every outcome), clearToken and showSessionExpired.
// 'profile:updated' (currentUser) fires whenever a /profile body was applied —
// plan usage, credits and the plan itself may have moved.
let _authInFlight = null;     // { token, promise } — see checkAuth
let _lastProfileId = null;    // customer id of the last applied /profile — see _applyProfile
let _authUnverified = false;  // token kept, last /profile check couldn't reach Psycle
let _authSettledOnce = false; // the first auth:changed of a page load carries initial:true
let _gearIconHTML = null;     // header avatar's default icon, restored when no profile is known

function _emitAuthChanged(signedIn) {
  const initial = !_authSettledOnce;
  _authSettledOnce = true;
  PsycleEvents.emit('auth:changed', { signedIn: !!signedIn, initial, unverified: _authUnverified });
}

// ── pure:data-owner:start ── (DOM-free; tests/suites/data-owner.js evaluates this block)
// Whose data is on this device. History, rankings, favourites, bike prefs, the
// usual bike, the weekly template… were keyed to the INSTALL, not the member:
// a second account signing in here inherited all of it, was never offered its
// own history sync, and a manual sync merged both members' classes for good.
//
// psycle_data_owner is the customer id the stored data belongs to. Data moves
// ONLY when a verified /profile names a DIFFERENT customer — never on sign-out
// or expiry (the same member nearly always comes back):
//   • no stamp yet → an install from before stamps existed: adopt it as this
//     member's, move nothing (a wipe here would cost every existing member
//     their history on update) — UNLESS the history stamp such an install
//     already carries (features.js, psycle_class_history_owner) names someone
//     else: then that member is the owner, and this is a switch away from them;
//   • their small hand-entered keys go into psycle_account_stash under their
//     id (the two most recent members are kept) and come back when they return;
//   • what Psycle can rebuild (class history + its sync flags) is cleared, so
//     the newcomer is offered their own sync; the offline queue is dropped —
//     a queued booking must never replay under someone else's token.
// The stash is written BEFORE anything is removed, and when it cannot be
// written nothing is touched (tried again on the next /profile).
const DATA_OWNER_KEY = 'psycle_data_owner';
const ACCOUNT_STASH_KEY = 'psycle_account_stash';
const ACCOUNT_STASH_MAX_OWNERS = 2;
const ACCOUNT_STASH_MAX_VALUE = 262144; // chars per stashed value — these are small lists
const ACCOUNT_STASH_KEYS = [
  'psycle_instructor_tiers', 'psycle_fav_instructors', 'psycle_bike_prefs', 'psycle_bike_history',
  'psycle_weekly_template', 'psycle_recent_searches', 'psycle_notify_watchlist',
];
const ACCOUNT_CLEAR_KEYS = [
  'psycle_class_history', 'psycle_history_synced', 'psycle_history_prompt_dismissed',
  'psycle_calendar_data', 'psycle_offline_queue',
  // Rebuildable per-account caches other modules keep (absent = a no-op). The
  // top-up's "N too many" note with its stamp: left behind, a Settings import
  // told the newcomer the leaver's "61 past classes are not in it yet" and held
  // their weekly top-up back for a week (explore.js).
  'psycle_history_topup_at', 'psycle_history_topup_skipped', 'psycle_booked_event_details',
  // Whose history that was (features.js _historyIsMine only ever WRITES it when
  // absent): left on the leaver, the newcomer's /bookings reconcile and weekly
  // top-up were refused for good. Keep it LAST — until it goes, a switch
  // inferred from it (see _swapAccountData) can still be resumed.
  'psycle_class_history_owner',
];
const HISTORY_OWNER_STAMP_KEY = 'psycle_class_history_owner';

// 'none' (no id to go by) · 'adopt' · 'same' · 'switch'
function _dataOwnerPlan(storedOwner, newId) {
  if (newId == null || String(newId) === '') return 'none';
  if (storedOwner == null || storedOwner === '') return 'adopt';
  return String(storedOwner) === String(newId) ? 'same' : 'switch';
}

// An owner id the stash can be keyed by (anything else is dropped on parse).
function _isStashOwnerId(id) {
  return typeof id === 'string' && /^[\w.:-]{1,64}$/.test(id) && id !== '__proto__' && id !== 'constructor' && id !== 'prototype';
}

// The stash as stored → { ownerId: { savedAt, pending, keys: { key: rawValue } } }.
// Anything unexpected is dropped rather than trusted: it is read back into
// localStorage keys, and it may have come through the iOS Preferences mirror.
function _parseAccountStash(raw) {
  const out = Object.create(null);
  let parsed = null;
  try { parsed = JSON.parse(raw || 'null'); } catch (e) { return out; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
  Object.keys(parsed).forEach(id => {
    const entry = parsed[id];
    if (!_isStashOwnerId(id)) return;
    if (!entry || typeof entry !== 'object' || !entry.keys || typeof entry.keys !== 'object') return;
    const keys = Object.create(null);
    ACCOUNT_STASH_KEYS.forEach(k => {
      const v = Object.prototype.hasOwnProperty.call(entry.keys, k) ? entry.keys[k] : null;
      if (typeof v === 'string' && v.length <= ACCOUNT_STASH_MAX_VALUE) keys[k] = v;
    });
    out[id] = {
      savedAt: typeof entry.savedAt === 'string' ? entry.savedAt : '',
      pending: typeof entry.pending === 'string' ? entry.pending : '',
      keys,
    };
  });
  return out;
}

// Move the stored per-account data to `newId`. `store` is localStorage (or a
// stand-in); `write(key, value)` → boolean is the quota-aware setter from
// security.js when there is one. Never throws. Returns what happened:
//   { action: 'none'|'same'|'adopt'|'switch'|'error', from, to, restored, cleared }
function _swapAccountData(store, newId, nowIso, write) {
  const res = { action: 'error', from: null, to: null, restored: [], cleared: [] };
  const put = (k, v) => {
    try {
      if (typeof write === 'function') return write(k, v) !== false;
      store.setItem(k, v);
      return true;
    } catch (e) { return false; }
  };
  const get = k => { try { return store.getItem(k); } catch (e) { return null; } };
  let stored = null;
  try { stored = store.getItem(DATA_OWNER_KEY); } catch (e) { return res; }
  // An install updated from the build before this stamp has none — but it does
  // say whose HISTORY it holds. When that is somebody else, "adopt" would hand
  // the newcomer their history, rankings and bike prefs, and stash those under
  // the wrong id the day the real owner came back. Treat them as the owner.
  if ((stored == null || stored === '') && newId != null) {
    const h = get(HISTORY_OWNER_STAMP_KEY);
    if (_isStashOwnerId(h) && h !== String(newId)) stored = h;
  }
  const plan = _dataOwnerPlan(stored, newId);
  if (plan === 'none' || plan === 'same') { res.action = plan; return res; }
  const to = String(newId);
  res.to = to;
  if (plan === 'adopt') {
    if (put(DATA_OWNER_KEY, to)) res.action = 'adopt';
    return res;
  }

  const from = String(stored);
  res.from = from;
  const stash = _parseAccountStash(get(ACCOUNT_STASH_KEY));
  // A switch to this same member that was cut short (the app was killed
  // between the steps below) already holds the leaver's complete set — and by
  // now localStorage may be half the newcomer's. Trust the stash, not the keys.
  const resumed = !!stash[from] && stash[from].pending === to;
  if (!resumed) {
    const keys = Object.create(null);
    ACCOUNT_STASH_KEYS.forEach(k => {
      const v = get(k);
      if (typeof v === 'string' && v !== '' && v.length <= ACCOUNT_STASH_MAX_VALUE) keys[k] = v;
    });
    stash[from] = { savedAt: String(nowIso || ''), pending: to, keys };
  }
  // Two members kept, oldest out — never the one leaving or the one arriving.
  const others = Object.keys(stash).filter(id => id !== from && id !== to)
    .sort((a, b) => String(stash[a].savedAt).localeCompare(String(stash[b].savedAt)));
  while (others.length > ACCOUNT_STASH_MAX_OWNERS - 1) delete stash[others.shift()];

  // 1. The leaver's data is safe on disk before a single key is removed.
  if (!put(ACCOUNT_STASH_KEY, JSON.stringify(stash))) return res;
  // 2. Nothing of theirs stays behind for the newcomer.
  ACCOUNT_STASH_KEYS.concat(ACCOUNT_CLEAR_KEYS).forEach(k => {
    try {
      if (store.getItem(k) !== null) { store.removeItem(k); res.cleared.push(k); }
    } catch (e) {}
  });
  // 3. A returning member gets their own back.
  const theirs = stash[to] ? stash[to].keys : null;
  let restoredAll = true;
  if (theirs) {
    Object.keys(theirs).forEach(k => {
      if (put(k, theirs[k])) res.restored.push(k);
      else restoredAll = false;
    });
  }
  // 4. Stamp — only now is the switch done; until then a re-run resumes it.
  if (!put(DATA_OWNER_KEY, to)) return res;
  res.action = 'switch';
  // 5. Tidy the stash (a failure here costs nothing: see `resumed` above).
  if (restoredAll) delete stash[to];
  if (stash[from]) stash[from].pending = '';
  put(ACCOUNT_STASH_KEY, JSON.stringify(stash));
  return res;
}
// ── pure:data-owner:end ──

// _applyProfile's one call into the above, plus the in-memory copies of what
// just changed on disk. Everything that renders from these keys is repainted
// by the profile:updated / auth:changed / bookings:loaded that follow a
// sign-in; 'data:owner-changed' is for modules that keep their own copy.
function _claimDataOwner(id) {
  let res = null;
  try {
    res = _swapAccountData(localStorage, id, new Date().toISOString(),
      typeof window._psycleSafeSetItem === 'function' ? window._psycleSafeSetItem : null);
  } catch (e) { return; } // no localStorage (the test harness) or one that throws: never in a sign-in's way
  if (!res || res.action !== 'switch') return;
  try { favouriteInstructors = loadFavourites(); } catch (e) {}
  try { renderInstrDropdown(); renderInstrChips(); } catch (e) {}
  try { PsycleEvents.emit('data:owner-changed', { from: res.from, to: res.to }); } catch (e) {}
}

// Apply a GET /profile body to app state. Shared by checkAuth and
// refreshProfile so both pick the subscription the same way. Returns false
// (state untouched) for a body that isn't a profile.
function _applyProfile(data) {
  const user = _profileFrom(data);
  if (!user) return false;
  _authUnverified = false;
  // A DIFFERENT customer than the last one on this page. Session expiry keeps
  // _myBookings on purpose (same member: the cards and widget stay true until
  // they sign back in) — but signing in as someone else must never paint those
  // under the new account: profile:updated below re-renders a non-empty map,
  // and a failed /bookings would leave them up with live Cancel buttons.
  // Repainted BEFORE currentUser is set, so the tab reads "Checking your
  // Psycle account…" rather than a "Nothing booked" nobody has confirmed.
  if (user.id != null) {
    if (_lastProfileId != null && String(_lastProfileId) !== String(user.id)) {
      const hadBookings = Object.keys(_myBookings).length > 0;
      _myBookings = {};
      _lastWaitlistEntries = null;
      _bookingsLoadState = 'pending'; // this customer's list has not loaded yet
      if (hadBookings) {
        renderMyBookings();
        _resyncDiscoverButtons(true);
      }
    }
    _lastProfileId = user.id;
    // What is STORED per account (history, rankings, usual bike…) follows the
    // same rule, across launches — before currentUser is set and anything
    // repaints. Guarded twice over: nothing here may get in a sign-in's way.
    try { if (typeof _claimDataOwner === 'function') _claimDataOwner(user.id); } catch (e) {}
  }
  currentUser = user;
  _activeSubscription = _pickActiveSubscription(user.subscriptions);
  // Redesign: the header avatar shows the rider's initials.
  const gear = document.getElementById('settingsGear');
  if (gear) {
    const name = user.first_name || user.email || 'You';
    const _fn = (user.first_name || '').trim();
    const _ln = (user.last_name || '').trim();
    const inits = ((_fn[0] || name.trim()[0] || '?') + (_ln[0] || '')).toUpperCase();
    gear.innerHTML = '<span>' + escapeHTML(inits) + '</span>';
  }
  PsycleEvents.emit('profile:updated', currentUser);
  return true;
}

// Single-flight per token: 'online' and visibilitychange fire together on
// resume, and bookClass awaits this too — they all share one /profile request.
// A call made under a DIFFERENT token (sign-in / sign-out while a check is in
// flight) starts afresh, and the older run drops its answer.
async function checkAuth() {
  const token = getBearerToken();
  if (_authInFlight && _authInFlight.token === token) return _authInFlight.promise;
  let settle;
  const run = { token, promise: new Promise(r => { settle = r; }) };
  _authInFlight = run;
  try {
    await _checkAuthOnce(token);
  } finally {
    if (_authInFlight === run) _authInFlight = null;
    settle();
  }
}

async function _checkAuthOnce(token) {
  const pill = document.getElementById('authPill');
  const gear = document.getElementById('settingsGear');
  if (gear && _gearIconHTML === null) _gearIconHTML = gear.innerHTML;
  if (!token) {
    currentUser = null;
    _authUnverified = false;
    pill.innerHTML = `<a href="#" onclick="event.preventDefault();openLoginPopup()" class="signin-pill">Sign in</a>`;
    if (gear) gear.hidden = true;
    updateDiscoverEmptyState();
    _emitAuthChanged(false);
    return;
  }
  if (gear) gear.hidden = false;
  // A stored token means signed in until Psycle says otherwise — no Sign-in
  // pill while we check (it only comes back if the session really is dead).
  // Signed in, the top bar shows only the avatar; sign-out lives in Membership.
  pill.innerHTML = '';
  // 15s cap: on a dead connection fetch() can hang for minutes, and everything
  // awaiting this (bookClass, Retry) would hang with it.
  let status = 0, data = null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(apiUrl('/profile'), {
      headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` },
      signal: ctrl.signal,
    });
    status = res.status;
    if (res.ok) data = await res.json();
  } catch { status = 0; }
  clearTimeout(timer);
  // Signed out / signed in as someone else while we waited: this answer is
  // about a session that no longer exists — the newer run owns the UI.
  if (getBearerToken() !== token) return;

  let state = _sessionStateFor(true, status);
  // A 200 whose body isn't a profile proves nothing either way.
  if (state === 'signed-in' && !_applyProfile(data)) { state = 'unverified'; status = 0; }
  if (state === 'signed-in') {
    // A sign-in also answers the "session expired" banner (only a deliberate
    // sign-out used to hide it, so it outlived a popup re-login).
    const banner = document.getElementById('sessionBanner');
    if (banner) banner.style.display = 'none';
    updateDiscoverEmptyState();
    // Field names only, for API-drift diagnostics. (typeof: the suites run
    // this function on its own, without the helper.)
    if (typeof _recordShape === 'function') _recordShape('profile', currentUser);
    // (A failed load repaints My Bookings itself — see _noteBookingsLoadFailed;
    // a superseded one leaves the screen to the newer call.)
    fetchMyBookings();
    // After first login, offer to sync booking history
    setTimeout(function () { showHistorySyncPrompt(); }, 1500);
    _emitAuthChanged(true);
  } else if (state === 'expired') {
    showSessionExpired();
  } else {
    // Offline, a timeout, server trouble (5xx / 429) or a 403 denial is NOT an
    // expired session — never destroy the stored token for it, and never tell
    // a member to sign in. The tabs offer Retry; 'online' and the next
    // foreground re-check by themselves (see _healAuth).
    const firstFailure = !_authUnverified;
    currentUser = null;
    _activeSubscription = null;
    _authUnverified = true;
    if (gear && _gearIconHTML !== null) gear.innerHTML = _gearIconHTML; // not a previous account's initials
    if (firstFailure && status) toast(`Psycle is unreachable right now (${status}) — your session has been kept`, 'info');
    updateDiscoverEmptyState();
    // As showSessionExpired: an empty tab now shows the "Can't reach Psycle"
    // hero, which only a repaint takes down once the check heals.
    if (!Object.keys(_myBookings).length) _bookingsLoadState = 'pending';
    renderMyBookings();
    _emitAuthChanged(false);
  }
}

// Plan usage ("7 of 12 classes"), credits and cost-per-class all come from
// /profile, which used to be read once at launch — so they stayed wrong after
// every booking or cancel until the app was reopened. Re-read it when the app
// returns to the foreground, comes back online, or a booking / seat / waitlist
// change may have moved the numbers. Goes through apiFetch (timeout, retries,
// and the one global 401 path); any other failure keeps the last good profile
// and NEVER touches the token.
const PROFILE_REFRESH_MIN_GAP_MS = 30000;
let _profileRefreshAt = 0;
let _profileRefreshInFlight = null;
let _profileRefreshQueued = false;
let _profileRefreshTimer = null;

// force = something just changed, so the 30s throttle doesn't apply.
function refreshProfile(force) {
  const token = getBearerToken();
  if (!token) return Promise.resolve(false);
  // Not verified yet this session: that needs the whole sign-in path (avatar,
  // bookings, banner), not just fresh numbers.
  if (!currentUser) return checkAuth().then(() => !!currentUser);
  if (_profileRefreshInFlight) {
    // An answer already on its way may predate the change — go again after it.
    if (force) _profileRefreshQueued = true;
    return _profileRefreshInFlight;
  }
  if (!force && Date.now() - _profileRefreshAt < PROFILE_REFRESH_MIN_GAP_MS) return Promise.resolve(false);
  const run = (async () => {
    try {
      const res = await apiFetch('/profile');
      if (!res.ok) return false;
      const data = await res.json();
      // Signed out or switched account mid-flight: not this session's profile.
      if (getBearerToken() !== token || !currentUser) return false;
      const applied = _applyProfile(data);
      // Only a refresh that LANDED counts toward the throttle: stamped before
      // the request, a resume with no signal (all retries fail in ~8s) then
      // swallowed the 'online' catch-up that follows. No bursts either way —
      // the single-flight check above comes first.
      if (applied) _profileRefreshAt = Date.now();
      return applied;
    } catch { return false; }
  })();
  _profileRefreshInFlight = run;
  run.then(() => {
    if (_profileRefreshInFlight === run) _profileRefreshInFlight = null;
    if (_profileRefreshQueued) { _profileRefreshQueued = false; refreshProfile(true); }
  });
  return run;
}

// ~1s after a change: lets Psycle settle the count, and folds a burst of
// events (a booking emits several) into one request.
function _refreshProfileSoon() {
  clearTimeout(_profileRefreshTimer);
  _profileRefreshTimer = setTimeout(() => refreshProfile(true), 1000);
}

if (typeof PsycleEvents !== 'undefined') {
  ['booking:complete', 'booking:cancelled', 'seat:cancelled', 'waitlist:claimed', 'waitlist:allocated'].forEach(evt => {
    PsycleEvents.on(evt, _refreshProfileSoon);
  });
  PsycleEvents.on('profile:updated', () => {
    // The usage bar lives inside the bookings list. With nothing booked there
    // is no bar to refresh — and re-rendering then would flash "Nothing
    // booked" at sign-in, before the first /bookings answer lands.
    if (Object.keys(_myBookings).length) renderMyBookings();
  });
  PsycleEvents.on('auth:changed', s => {
    // (Discover's presets repaint via the updateDiscoverEmptyState wrapper.)
    try { renderRebookHint(); } catch {}
    // A sign-in AFTER launch (login popup, token dialog, a healed connection)
    // has no timetable yet: the launch path only searches when a token already
    // existed. `initial` is skipped because that launch search is already
    // running — a second one would double-fetch or flash "No classes found".
    // A search that died with the old session leaves its error (and "Sign in")
    // in the list while an earlier window is still loaded: run it again too.
    if (s && s.signedIn && !s.initial && locations.length &&
        (!window._windowEvents || document.querySelector('#results .status-error'))) {
      try { search(); } catch {}
    }
  });
}

// Hero for a tab that looks signed out although a token is still stored
// (My Bookings, Membership). '' when there is genuinely no session — the
// caller then shows its own Sign-in CTA.
function authGateHTML() {
  const view = _authGateViewFor(!!getBearerToken(), _authUnverified);
  if (view === 'signin') return '';
  if (view === 'checking') {
    return `<div class="tab-empty-title">One moment</div>
           <div class="tab-empty-sub">Checking your Psycle account…</div>`;
  }
  return `<div class="tab-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8.8a15 15 0 0 1 20 0M5 12.5a10.5 10.5 0 0 1 14 0M8.5 16a6 6 0 0 1 7 0M12 20h.01M3 3l18 18"/></svg></div>
           <div class="tab-empty-title">Can't reach<br>Psycle</div>
           <div class="tab-empty-sub">You're still signed in — we just couldn't confirm your account. Check your connection and try again.</div>
           <button class="tab-empty-btn" onclick="retryAuth(this)">Retry</button>`;
}

// The Retry button on that hero. A settled check re-renders the hero, so the
// button only needs restoring for the case where it is still on screen.
async function retryAuth(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Retrying…'; }
  try {
    await checkAuth();
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Retry'; }
  }
  if (!currentUser && getBearerToken()) toast("Still can't reach Psycle — check your connection", 'error');
}

// Skip / × / backdrop all mean "not now, and don't ask again". Without a
// remembered answer the prompt re-armed 1.5s after EVERY launch for anyone
// with little local history; Explore's banner keeps a "Sync now" entry point,
// so a permanent dismissal loses nothing. (Mirrored to Preferences on iOS.)
const HISTORY_PROMPT_DISMISSED_KEY = 'psycle_history_prompt_dismissed';
let _syncPromptTimer = null;
let _syncPromptDefers = 0;

function _dismissSyncPrompt() {
  try { localStorage.setItem(HISTORY_PROMPT_DISMISSED_KEY, '1'); } catch (e) {}
  document.getElementById('syncPromptOverlay')?.remove();
  toast('You can sync your history any time from the Stats tab', 'info');
}

function showHistorySyncPrompt() {
  // Only show if history hasn't been synced (or the offer declined) and we have a token
  var history = [];
  try { history = JSON.parse(localStorage.getItem('psycle_class_history') || '[]'); } catch (e) {}
  if (!_shouldOfferHistorySync({
    hasToken: !!getBearerToken(),
    synced: !!localStorage.getItem('psycle_history_synced'),
    dismissed: !!localStorage.getItem(HISTORY_PROMPT_DISMISSED_KEY),
    historyCount: Array.isArray(history) ? history.length : 0,
  })) return;

  // Already up (every successful checkAuth arms this) — rebuilding it would
  // reset a sync that is in progress.
  if (document.getElementById('syncPromptOverlay')) return;

  // Never stack on another dialog, the class sheet, the "Booked!" sheet or the
  // first-run welcome — come back when it's gone. Bounded, so a stuck overlay
  // can't keep this polling all session. The welcome is judged by its overlay
  // alone: it is inserted while app.js is evaluated (in the iOS app its holding
  // cover carries the same id until the launch has its answer), long before a
  // checkAuth can arm this. A missing completion flag is NOT "still to come":
  // a launch on a #bookings link skips the welcome and leaves the flag unset,
  // and the newcomer who signed in there was never offered the sync.
  // Nor UNDER a panel: Settings, Diagnostics, an instructor profile, history
  // and the year review all sit above .modal-overlay, and the focus stack
  // takes the last overlay to open for the top one — focus was pulled into a
  // prompt nobody could see, and the Escape meant for the panel dismissed the
  // offer for good. Every overlay the stack knows, bar this one.
  var busy = _dialogOpen() || document.getElementById('classDetailOverlay') ||
    document.getElementById('bookingConfirmation') ||
    document.getElementById('onboardOverlay') ||
    _OVERLAYS.some(([id]) => id !== 'syncPromptOverlay' && _overlayIsOpen(document.getElementById(id)));
  clearTimeout(_syncPromptTimer);
  if (busy) {
    if (_syncPromptDefers++ < 40) _syncPromptTimer = setTimeout(showHistorySyncPrompt, 3000);
    return;
  }
  _syncPromptDefers = 0;

  var overlay = document.createElement('div');
  overlay.id = 'syncPromptOverlay';
  overlay.className = 'modal-overlay';
  overlay.style.display = 'flex';
  // A stray backdrop tap mid-sync must not throw the progress away.
  overlay.onclick = function (e) {
    if (e.target !== overlay) return;
    var syncBtn = document.getElementById('syncPromptBtn');
    if (!(syncBtn && syncBtn.disabled)) _dismissSyncPrompt();
  };

  // Says what it is. (It was headed "Welcome, <name>!" over a subtitle about
  // "your experience" — the first-run welcome has already said hello.)
  overlay.innerHTML =
    '<div class="modal" style="max-width:400px" role="dialog" aria-modal="true" aria-labelledby="syncPromptTitle" tabindex="-1">' +
      '<div class="modal-header">' +
        '<div>' +
          '<div class="modal-title" id="syncPromptTitle">Sync your booking history?</div>' +
        '</div>' +
        '<button class="modal-close" onclick="_dismissSyncPrompt()" aria-label="Close">&times;</button>' +
      '</div>' +
      '<div style="padding:0 20px 8px;font-size:13px;color:var(--text-muted,#aaa);line-height:1.6">' +
        'Brings in your past bookings from Psycle, so your Stats and suggestions are accurate.' +
      '</div>' +
      '<div class="modal-actions" style="gap:8px">' +
        '<button class="btn btn-ghost" onclick="_dismissSyncPrompt()">Not now</button>' +
        '<button class="btn" id="syncPromptBtn" onclick="startSyncFromPrompt()">Sync my history</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);
}

async function startSyncFromPrompt() {
  var btn = document.getElementById('syncPromptBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing...'; }
  // explore.js writes its page / detail progress into this button too, so a
  // long sync isn't a static "Syncing...".
  try {
    if (typeof window._explore_syncHistory === 'function') {
      await window._explore_syncHistory();
    }
  } finally {
    // Whatever happened, never strand the user behind a disabled button.
    var overlay = document.getElementById('syncPromptOverlay');
    if (overlay) overlay.remove();
  }
}

function openLoginPopup() {
  const w = 420, h = 520;
  const left = (screen.width - w) / 2, top = (screen.height - h) / 2;
  const popup = window.open('./login.html', 'psycle_login',
    `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,status=no`);
  if (!popup) {
    // Popup blocked — fall back to navigation
    location.href = './login.html';
  }
}

function showTokenDialog() {
  document.getElementById('tokenInput').value = '';
  document.getElementById('saveTokenBtn').disabled = true;
  document.getElementById('tokenDialog').style.display = 'flex';
}

function closeTokenDialog() {
  document.getElementById('tokenDialog').style.display = 'none';
}

function validateToken() {
  const val = document.getElementById('tokenInput').value.trim();
  document.getElementById('saveTokenBtn').disabled = val.length < 10;
}

async function saveToken() {
  // Users paste straight from devtools — tolerate a copied "Bearer " prefix
  // and wrapping quotes rather than sending a doubled Authorization header.
  const token = document.getElementById('tokenInput').value.trim()
    .replace(/^["']+|["']+$/g, '')
    .replace(/^bearer\s+/i, '')
    .trim();
  if (window._secureTokenStore) await window._secureTokenStore.set(token);
  else localStorage.setItem('psycle_bearer_token', token);
  closeTokenDialog();
  await checkAuth();
  if (currentUser) {
    toast(`Connected as ${currentUser.first_name || currentUser.email}`, 'success');
    if (typeof scheduleTokenExpiryCheck === 'function') scheduleTokenExpiryCheck();
  } else if (getBearerToken()) {
    // Still stored = Psycle couldn't be reached, not a rejected token (a 401
    // clears it). It's re-checked on Retry / when the connection returns.
    toast("Can't reach Psycle to check that token — it's been kept", 'error');
  } else toast('Token not recognised — try again', 'error');
}

function clearToken() {
  // Deliberate sign-out: disarm the old token's expiry timers so they can't
  // pop "session expiring/expired" UI at a signed-out user hours later.
  if (typeof cancelTokenExpiryCheck === 'function') cancelTokenExpiryCheck();
  const banner = document.getElementById('sessionBanner');
  if (banner) banner.style.display = 'none';
  if (window._secureTokenStore) window._secureTokenStore.clear();
  else localStorage.removeItem('psycle_bearer_token');
  currentUser = null;
  _activeSubscription = null; // or Membership keeps the previous account's plan card
  // Never carry one account's waitlist memory into the next.
  _lastWaitlistEntries = null;
  try { localStorage.removeItem(WAITLIST_PLACES_KEY); } catch (e) {}
  if (typeof _dropFocusStash === 'function') _dropFocusStash(); // nor filters a shortcut set aside
  if (typeof _releaseDateRow === 'function') _releaseDateRow(); // nor a date row a notification put up
  // Empty the previous account's bookings at the source. With the token gone,
  // fetchMyBookings takes its no-token branch: it bumps _bookingsSeq (a
  // /bookings answer still in flight can't put them back), clears the map and
  // re-renders — synchronously, so native-bridge's clearToken wrapper then
  // blanks the widget and cancels the T-90 reminders from a truly empty map.
  // It emits nothing, on purpose: 'bookings:loaded' with an empty map means
  // "the server confirmed no bookings" to the calendar sync, which would then
  // delete every synced event. The badge, planner, pill and Membership hear
  // about it through auth:changed instead (checkAuth's no-token branch).
  fetchMyBookings();
  _resyncDiscoverButtons(true);
  checkAuth();
}

// Sign-out sits one stray tap away from a full email + password login, so the
// Membership button asks first.
async function confirmSignOut() {
  const ok = await confirmModal({
    title: 'Sign out?',
    body: "You'll need your Psycle email and password to sign back in. Your bookings stay safe with Psycle.",
    confirmText: 'Sign out',
    cancelText: 'Stay signed in',
    danger: true,
  });
  if (ok) clearToken();
}

function showSessionExpired() {
  currentUser = null;
  _activeSubscription = null; // Membership must not keep showing the plan card
  _authUnverified = false;
  _lastWaitlistEntries = null; // whoever signs in next starts from the server's list
  if (typeof cancelTokenExpiryCheck === 'function') cancelTokenExpiryCheck();
  if (window._secureTokenStore) window._secureTokenStore.clear();
  else localStorage.removeItem('psycle_bearer_token');
  const banner = document.getElementById('sessionBanner');
  // Spoken once, when the banner appears: every 401 still in flight lands here.
  if (banner.style.display !== 'flex' && typeof announce === 'function') {
    announce('Your session has expired. Sign in again to carry on.', true);
  }
  banner.style.display = 'flex';
  const pill = document.getElementById('authPill');
  pill.innerHTML = `<a href="#" onclick="event.preventDefault();openLoginPopup()" class="signin-pill">Sign in</a>`;
  const gear = document.getElementById('settingsGear');
  if (gear) gear.hidden = true;
  updateDiscoverEmptyState();
  // _myBookings is deliberately kept (the bookings still exist server-side and
  // the widget keeps serving them until re-login), so only an EMPTY tab needs
  // repainting: "Nothing booked" → the Sign-in hero. That hero is no longer the
  // confirmed-empty list, so the state goes back to 'pending': if the /bookings
  // that follows a re-login fails, _noteBookingsLoadFailed must repaint (Retry)
  // — left 'loaded' it bails, and a signed-in member keeps a Sign-in CTA.
  if (!Object.keys(_myBookings).length) { _bookingsLoadState = 'pending'; renderMyBookings(); }
  _emitAuthChanged(false);
}

// Token from login is now received via postMessage (security.js).
// Clean up any legacy URL token params.
(function() {
  const params = new URLSearchParams(location.search);
  if (params.has('psycle_token')) {
    history.replaceState({}, '', location.pathname);
  }
})();

// Re-check auth when there is no verified session. Two cases:
//  - the login popup stored a token in localStorage but postMessage was lost
//    because this tab was suspended by the OS (common on mobile);
//  - a token is stored but /profile couldn't be reached (launched offline, or
//    a Psycle blip). security.js removes the plaintext key on every normal
//    save, so waiting for THAT key meant a member who launched on the Tube
//    stayed half signed-out until they killed the app.
function _healAuth() {
  if (currentUser) return;
  var legacy = localStorage.getItem('psycle_bearer_token');
  if (legacy && window._secureTokenStore) {
    window._secureTokenStore.set(legacy).then(function() { checkAuth(); });
  } else if (legacy || getBearerToken()) {
    checkAuth();
  }
}
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible') _healAuth();
});
// Signal is back: heal an unverified session, or catch the numbers up.
window.addEventListener('online', function() {
  if (currentUser) refreshProfile();
  else _healAuth();
  // Discover only had a resume hook: a partial window shown at an offline
  // launch stayed up, with no spinner, until the next tap. A reconnect is also
  // what ends the failed-refresh back-off. Last and on its own — nothing here
  // may get in the way of the auth healing above.
  try { _revalFailedAt = 0; _discoverResumed(); } catch (e) {}
});

// ── Offline indicator ────────────────────────────────────────────
// Nothing said "you're offline": requests just spun, then failed. A bar under
// the header says so the moment the browser knows. navigator.onLine can read
// false on a working connection (some VPN / desktop set-ups), so any answer
// from Psycle takes the bar down again, and it can be dismissed.
function _setOfflineBanner(show) {
  let el = document.getElementById('offlineBanner');
  if (!show) { if (el) el.style.display = 'none'; return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'offlineBanner';
    el.className = 'app-banner';
    el.setAttribute('role', 'status');
    el.innerHTML = `<span>You're offline — times and availability may be out of date.</span>
      <button type="button" class="app-banner-close" aria-label="Dismiss" onclick="this.parentNode.style.display='none'">×</button>`;
  }
  // (Re)anchored under the session banner on every show. tabs.js moves that
  // banner when it builds the tab shell; a bar shown before then simply stays
  // where the banner was — still between the header and the content.
  const anchor = document.getElementById('sessionBanner');
  if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(el, anchor.nextSibling);
  else document.body.insertBefore(el, document.body.firstChild);
  el.style.display = 'flex';
}
window.addEventListener('offline', function() { _setOfflineBanner(true); });
window.addEventListener('online', function() { _setOfflineBanner(false); });
if (typeof PsycleEvents !== 'undefined') {
  ['profile:updated', 'bookings:loaded'].forEach(evt => PsycleEvents.on(evt, () => _setOfflineBanner(false)));
}
if (navigator.onLine === false) _setOfflineBanner(true); // launched offline: no 'offline' event will say so

// Init — wait for security module to decrypt stored token
if (IS_FILE) document.getElementById('corsBanner').style.display = 'block';
(window.securityReady || Promise.resolve()).then(function() {
  // tabs.js paints My Bookings ~50ms after load — on iOS before the stored
  // token is restored and decrypted, so that paint is the "Sign in" hero, and
  // nothing took it down until /profile answered (15s+ on a weak signal, longer
  // while /bookings retries). The token is readable now: paint once more, so
  // the saved copy with "Checking…" (or the "One moment" gate) is what stays
  // up through /profile and /bookings. (Guarded: nothing here may keep
  // checkAuth from running.)
  try {
    if (getBearerToken() && !currentUser && !Object.keys(_myBookings).length) renderMyBookings();
  } catch (e) {}
  checkAuth();
  if (typeof scheduleTokenExpiryCheck === 'function') scheduleTokenExpiryCheck();
});

// ── pure:init-gate:start ── (DOM-free; tests/suites/3d-leftovers.js evaluates this block)
// Resolves once every module after this one has run. They are all deferred
// scripts, so that is DOMContentLoaded; 'load' backs it up for a copy injected
// after DOMContentLoaded has already fired, and a finished document never waits.
function _laterModulesLoaded(doc, win) {
  if (!doc || doc.readyState === 'complete') return Promise.resolve();
  return new Promise(resolve => {
    doc.addEventListener('DOMContentLoaded', resolve, { once: true });
    win.addEventListener('load', resolve, { once: true });
  });
}
// ── pure:init-gate:end ──
// Armed NOW, while this script runs and DOMContentLoaded cannot have fired yet.
// Armed only after securityReady it could miss the event — in the iOS app
// securityReady waits for the native bridge, the LAST script — and init would
// sit waiting for 'load' (every font and image).
const _modulesLoaded = _laterModulesLoaded(document, window);

(async () => {
  await (window.securityReady || Promise.resolve());
  // securityReady has usually settled before this script even runs (IndexedDB
  // answers while the scripts are still arriving), and this function then
  // carried on in the microtask right after app.js — BEFORE reliability.js and
  // performance.js had wrapped apiFetch. The three lists below went out bare on
  // most warm launches: no retries, and the 24h reference cache never consulted.
  await _modulesLoaded;
  const fetchJson = path => apiFetch(path).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });

  const [iRes, lRes, tRes] = await Promise.all([
    fetchJson('/instructors'),
    fetchJson('/locations'),
    fetchJson('/event-types'),
  ]).catch(err => {
    // A friendly line and a Reload button — "check the console" is no help on a phone.
    showInitError(err);
    throw err;
  });

  instructors = iRes.data.filter(i => i.is_visible).sort((a, b) => a.full_name.localeCompare(b.full_name));
  // Exclude non-studio entries: the at-home stream and the "- Stock Room"
  // back-office location (it's not a bookable studio).
  locations = lRes.data.filter(l => l.is_visible && l.handle !== 'psycle-at-home' && !/stock\s*room/i.test(l.name || ''));
  eventTypes = tRes.data || [];

  renderInstrDropdown();

  // Pre-select favourites — on a first run only, i.e. while no filter state
  // has ever been saved. After that psycle_saved_filters is the authority
  // (interactions.js restores it on its own timer; racing it and ADDING
  // favourites on top would corrupt the last-used selection), and that
  // includes a saved EMPTY instructor list: "Clear filters" and removing the
  // last chip are persisted, so cleared has to mean cleared on the next launch
  // too. The ★ Favs button stays one tap away.
  let _sf = null;
  try { _sf = JSON.parse(localStorage.getItem('psycle_saved_filters') || 'null'); } catch (e) {}
  const _hasSavedFilters = !!_sf && typeof _sf === 'object';
  if (favouriteInstructors.size > 0 && !_hasSavedFilters) {
    favouriteInstructors.forEach(id => {
      if (instructors.some(i => String(i.id) === id)) selectedInstructors.add(id);
    });
  }
  renderInstrChips();
  renderInstrDropdown();

  renderLocationChips();

  renderCategoryPills();
  renderStrengthSubPills();
  renderReformerSubPills();
  // The date row comes from the saved filters as well, not a blanket today/7.
  // On a cache-warm launch restoreFilters (interactions.js) can run BEFORE
  // this point — it only waits for instructors/locations, which performance.js
  // pre-fills while we are still awaiting securityReady (slow on iOS). Writing
  // today/7 here and lighting "7 days" by hand, with _dateQuickMode left
  // alone, then lost the saved range and left no pill lit. Deriving the same
  // state restoreFilters does makes the order irrelevant; nothing saved is
  // week / today / 7, as before.
  const _ds = _restoredDateState(_sf, localDateStr());
  _dateQuickMode = _ds.mode;
  document.getElementById('startDate').value = _ds.startDate;
  document.getElementById('daysAhead').value = _ds.daysAhead;
  _syncDatePills();
  _revealActiveDatePill(); // a saved "Next week" / "14 days" is past a phone's right edge

  updateDiscoverEmptyState();
  updateFiltersSummary();

  // Pre-load the full timetable on launch: restore the last view instantly
  // (kills the empty-state → results layout jump), then let search() hydrate
  // the cached window (instant smart filtering) and revalidate in the
  // background. Always run search when signed in so the window loads even on
  // a fresh session with no last-results.
  if (getBearerToken()) {
    const shown = restoreLastResults();
    // restoreFilters' debounced search can beat the 800ms path; a second
    // search() then would tear the fresh list down and build it again. Only a
    // search that could load counts (_loadableSearchStarted): one tapped while
    // /locations was still loading had no studios to fetch ("No classes
    // found"), and skipping the launch search for it left Discover there.
    setTimeout(() => { if (_loadableSearchStarted) return; try { search(); } catch {} }, shown ? 800 : 200);
  } else {
    restoreLastResults();
  }
})();

// _dateQuickMode managed by state.js (default: 'week')

// ── Live filters: changes auto-run the search (debounced) ─────────
// Stays inert until signed in (avoids error spam pre-auth). The Search
// button still works for explicit refreshes; overlapping searches are
// superseded via _searchSeq.
let _autoSearchTimer = null;
function triggerAutoSearch() {
  updateFiltersSummary();
  if (!getBearerToken()) return;
  // Left open past midnight with no resume in between (a desktop tab): the
  // date row still means yesterday. Rolling it searches by itself.
  if (_rollDiscoverForward()) return;
  // If the loaded window already holds the selected date range, re-filter it
  // client-side instantly — no debounce, no network. This makes every filter
  // (including instructor, and Today / Tomorrow / a picked day inside the
  // loaded week) update results immediately, so there's no Search button.
  // Numbers older than WINDOW_FRESH_MS are then refreshed silently.
  const wd = currentWindowDates();
  if (_windowCovers(wd.startDate, wd.endDateStr)) {
    clearTimeout(_autoSearchTimer); // pending debounced search is obsolete
    renderFromWindow(currentFilters());
    _revalidateIfStale();
    return;
  }
  clearTimeout(_autoSearchTimer);
  _autoSearchTimer = setTimeout(() => search(), 600);
}

// ── pure:filter-summary:start ── (DOM-free; tests/suites/8a-filters.js evaluates this block)
// The active filters as the collapsed Filters bar shows them: one removable
// chip each — [{kind, id, label}] (+ `name` where the spoken name needs more
// than the label). Plain arrays in, plain objects out.
//   state: { locationIds, categories, strengthSubs, reformerSubs, timeBands,
//            availableOnly, instructorIds, favouriteIds, topTierIds }
//   maps:  { locations: [{id, name}], instructors: [{id, name}],
//            categories / strengthSubs / reformerSubs / timeBands: [{key, label}] }
// Lists, not objects: studios, class types and time bands read in the panel's
// own order, and an object keyed by numeric ids would hand them back sorted by
// id. The date is not here — its row is always on screen. A selected id the
// lists do not know still gets a chip: it IS filtering, and the chip is the
// way to lift it.
function _filterSummaryChips(state, maps) {
  const s = state || {}, m = maps || {};
  const strs = v => (Array.isArray(v) ? v : []).map(String);
  const list = v => (Array.isArray(v) ? v : []).filter(d => d && typeof d === 'object');
  const chips = [];

  // Studios, named as the panel's chips are ("Psycle " is dropped there too).
  const locs = strs(s.locationIds);
  const knownLocs = list(m.locations);
  knownLocs.forEach(l => {
    if (locs.indexOf(String(l.id)) === -1) return;
    chips.push({ kind: 'location', id: String(l.id), label: String(l.name || 'Studio').replace('Psycle ', '') });
  });
  locs.forEach(id => {
    if (!knownLocs.some(l => String(l.id) === id)) chips.push({ kind: 'location', id, label: 'Studio' });
  });

  // Class types. A narrowed sub-type row reads on its parent's chip
  // ("Strength · Upper"): removing the chip removes the class type, as its pill
  // does — the sub-pills only exist while it is on.
  const cats = strs(s.categories);
  const narrowed = (defs, picked) => {
    const on = list(defs).filter(d => picked.indexOf(String(d.key)) !== -1);
    return (on.length && on.length < list(defs).length) ? on.map(d => d.label) : [];
  };
  const subsOf = { STRENGTH: narrowed(m.strengthSubs, strs(s.strengthSubs)), PILATES: narrowed(m.reformerSubs, strs(s.reformerSubs)) };
  const knownCats = list(m.categories);
  const catChip = (key, label) => ({
    kind: 'category', id: key,
    label: [label].concat(Object.prototype.hasOwnProperty.call(subsOf, key) ? subsOf[key] : []).join(' · '),
  });
  knownCats.forEach(c => { if (cats.indexOf(String(c.key)) !== -1) chips.push(catChip(String(c.key), c.label)); });
  cats.forEach(key => { if (!knownCats.some(c => String(c.key) === key)) chips.push(catChip(key, key)); });

  // The Time row.
  const bands = strs(s.timeBands);
  const knownBands = list(m.timeBands);
  knownBands.forEach(b => { if (bands.indexOf(String(b.key)) !== -1) chips.push({ kind: 'time', id: String(b.key), label: b.label }); });
  bands.forEach(key => { if (!knownBands.some(b => String(b.key) === key)) chips.push({ kind: 'time', id: key, label: key }); });
  if (s.availableOnly === true) chips.push({ kind: 'available', id: '', label: 'Available only' });

  // Instructors, in the order they were picked (the panel's own chips). ★ Favs
  // and S/A select a whole set in one tap, so that set reads as ONE chip while
  // it still IS that set: every selected id belongs to it, and every member of
  // it that is on the instructor list is selected. One instructor is a name.
  const instrs = strs(s.instructorIds);
  const knownInstrs = list(m.instructors);
  const isSet = group => {
    const g = strs(group);
    return instrs.length > 1 && instrs.every(id => g.indexOf(id) !== -1) &&
      g.every(id => instrs.indexOf(id) !== -1 || !knownInstrs.some(i => String(i.id) === id));
  };
  if (isSet(s.favouriteIds)) chips.push({ kind: 'favs', id: '', label: 'Favourites' });
  else if (isSet(s.topTierIds)) chips.push({ kind: 'tier', id: '', label: 'S/A', name: 'instructors ranked S or A' });
  else {
    instrs.forEach(id => {
      const i = knownInstrs.find(x => String(x.id) === id);
      chips.push({ kind: 'instructor', id, label: (i && i.name) ? String(i.name) : 'Instructor' });
    });
  }
  return chips;
}

// What the Filters bar is called: the count is part of the NAME — the badge
// beside the word is decoration to a screen reader.
function _filtersBarName(count) {
  return count > 0 ? 'Filters, ' + count + ' active' : 'Filters';
}
// ── pure:filter-summary:end ──

// The Filters bar's digest: a count on the bar and one removable chip per
// active filter in #controlsSummary (the chips show while the panel is
// collapsed — css/redesign.css), plus "Clear" while anything is on. The date
// is not repeated here: its row is always on screen.
function updateFiltersSummary() {
  _mirrorDatePillAria(); // every date-row change ends up here (triggerAutoSearch, restoreFilters, the presets)
  const el = document.getElementById('controlsSummary');
  if (!el) return;
  _followStarsInSummary();
  // ★ Favs / S-A are only worth comparing against a multi-instructor filter.
  const many = selectedInstructors.size > 1;
  const chips = _filterSummaryChips({
    locationIds: [...selectedLocations], categories: [...selectedCategories],
    strengthSubs: [...selectedStrengthSubs], reformerSubs: [...selectedReformerSubs],
    timeBands: [...selectedTimeBands], availableOnly: _availableOnly === true,
    instructorIds: [...selectedInstructors],
    favouriteIds: many ? [...favouriteInstructors] : [],
    topTierIds: many ? _topTierInstructorIds() : [],
  }, {
    locations: locations, instructors: instructors.map(i => ({ id: i.id, name: i.full_name })),
    categories: CATEGORY_MAP, strengthSubs: STRENGTH_SUBS, reformerSubs: REFORMER_SUBS, timeBands: TIME_BANDS,
  });

  const bar = document.getElementById('controlsToggle');
  const count = document.getElementById('controlsCount');
  if (count) { count.textContent = chips.length ? String(chips.length) : ''; count.hidden = !chips.length; }
  if (bar) bar.setAttribute('aria-label', _filtersBarName(chips.length));
  // The header's "Clear filters" (>=1024px, where this bar is hidden) follows
  // the same rule as the bar's own "Clear" below: there only while a filter is on.
  const clearAll = document.getElementById('discClearBtn');
  if (clearAll) {
    // Enter on it clears the last filter, and hiding (display: none) the button
    // that holds the focus drops the focus to <body> — a keyboard or screen-
    // reader user lost their place. It is handed on, as a removed chip's is
    // below: to the lit date range, the first stop of the filter column and
    // always on screen there.
    const held = document.activeElement === clearAll;
    clearAll.hidden = !chips.length;
    if (held && clearAll.hidden) {
      const to = document.querySelector('#controlsPanel .date-quick-btn.active') || document.querySelector('#controlsPanel .date-quick-btn');
      if (to && typeof to.focus === 'function') { try { to.focus(); } catch (e) {} }
    }
  }

  // kind + id ride on the button as data: an id can come out of storage, and an
  // attribute is escaped once where a quoted handler argument needs it twice.
  // Colour means class type: ONLY a class-type chip wears one (data-ct, its
  // category key lower-cased — css/crisp.css dresses an unknown key as "other");
  // studios, times and instructors stay neutral.
  const html = chips.map(c =>
    `<button type="button" class="filter-chip" data-kind="${escapeHTML(c.kind)}" data-id="${escapeHTML(c.id)}"${c.kind === 'category' ? ` data-ct="${escapeHTML(String(c.id).toLowerCase())}"` : ''} onclick="removeFilterChip(this)" aria-label="Remove filter: ${escapeHTML(c.name || c.label)}"><span class="filter-chip-label">${escapeHTML(c.label)}</span><span class="filter-chip-x" aria-hidden="true">×</span></button>`
  ).join('') + (chips.length ? '<button type="button" class="controls-clear" onclick="clearFilters()" aria-label="Clear all filters">Clear</button>' : '');
  if (el._summaryHtml === html) return; // same chips: nothing to rebuild under a finger or a focus ring
  el._summaryHtml = html;
  // A removed chip takes the focus with it: it goes to the chip now in its
  // place (then "Clear"), and to the bar once nothing is left to remove.
  const hadFocus = !!document.activeElement && el.contains(document.activeElement);
  _repaintKeepingFocus(el, html, 'button');
  if (hadFocus && !el.contains(document.activeElement) && bar && typeof bar.focus === 'function') {
    try { bar.focus({ preventScroll: true }); } catch (e) {}
  }
}

// A star can change where no filter toggle runs (the instructor sheet, the
// Membership tab), and "Favourites" is only that chip while the selection still
// IS the starred set. Wired on the summary's first paint, not at load: this
// file's own launch-time `favouriteInstructors = loadFavourites()` must not
// paint a summary before the Time row's state exists further down.
let _summaryFollowsStars = false;
function _followStarsInSummary() {
  if (_summaryFollowsStars || typeof PsycleState === 'undefined' || typeof PsycleState.subscribe !== 'function') return;
  _summaryFollowsStars = true;
  PsycleState.subscribe('favouriteInstructors', () => updateFiltersSummary());
}

// × on a summary chip. Every kind goes through the SAME function the panel's own
// control calls — a bare call, so it is the copy interactions.js wraps with
// saveFilters — and that is what releases the focus stash, saves, refreshes the
// counts and re-filters the list. Only while that filter is really on: a toggle
// called for a chip that has gone stale would switch the filter ON.
function _removeFilter(kind, id) {
  const sid = String(id == null ? '' : id);
  if (kind === 'location') { if (!selectedLocations.has(sid)) return false; toggleLocation(sid); }
  else if (kind === 'category') { if (!selectedCategories.has(sid)) return false; toggleCategory(sid); }
  else if (kind === 'time') { if (!selectedTimeBands.has(sid)) return false; toggleTimeBand(sid); }
  else if (kind === 'available') { if (!_availableOnly) return false; toggleAvailableOnly(); }
  else if (kind === 'instructor') { if (!selectedInstructors.has(sid)) return false; removeInstructor(sid); }
  else if (kind === 'favs' || kind === 'tier') {
    // One chip for the whole set: all but the last leave quietly, and the last
    // goes through removeInstructor — ONE repaint, search and save, and its
    // "last chip" rule (a shortcut's set-aside filters come back) still runs.
    const ids = [...selectedInstructors];
    if (!ids.length) return false;
    ids.slice(0, -1).forEach(i => selectedInstructors.delete(i));
    removeInstructor(ids[ids.length - 1]);
  } else return false;
  return true;
}

function removeFilterChip(btn) {
  if (!btn || typeof btn.getAttribute !== 'function') return;
  const labelEl = typeof btn.querySelector === 'function' ? btn.querySelector('.filter-chip-label') : null;
  const label = labelEl ? labelEl.textContent : '';
  // Stale (the filter went some other way since it was painted): just repaint.
  if (!_removeFilter(btn.getAttribute('data-kind'), btn.getAttribute('data-id'))) { updateFiltersSummary(); return; }
  if (label && typeof announce === 'function') announce(label + ' filter removed');
}

// ── pure:filters:start ── (DOM-free date-range helpers; tests/suites/filters.js evaluates this block)
// 'YYYY-MM-DD' plus n days. Split by hand and built in LOCAL time so the day
// never shifts through UTC — the device is not always on UK time.
function _addDaysStr(ds, n) {
  const [y, m, d] = String(ds).split('-').map(Number);
  const t = new Date(y, m - 1, d + n);
  return [t.getFullYear(), String(t.getMonth() + 1).padStart(2, '0'), String(t.getDate()).padStart(2, '0')].join('-');
}

// What each date preset means today. null for anything that is not a preset
// (the mode also arrives from localStorage, so it is matched as an own key).
function _dateModeWindow(mode, todayStr) {
  const labels = { today: 'Today', tomorrow: 'Tomorrow', week: '7 days', nextweek: 'Next week', '2week': '14 days' };
  if (!Object.prototype.hasOwnProperty.call(labels, mode)) return null;
  if (mode === 'nextweek') {
    // Monday to Sunday of the week Psycle opens for booking on Monday at noon:
    // the Monday AFTER today (on a Monday that is a week away — today's week
    // opened seven days ago). daysAhead 6, because _windowEndDate counts the
    // days after the first: Monday + 6 is that Sunday.
    const [y, m, d] = String(todayStr).split('-').map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    return { startDate: _addDaysStr(todayStr, ((8 - dow) % 7) || 7), daysAhead: 6, label: labels[mode] };
  }
  // "7 days" is seven days and "14 days" fourteen, today included: daysAhead
  // counts the days AFTER the first, as for Next week. They were 7 and 14 —
  // today + 7 — and the day strip drew eight pills under "7 days", fifteen
  // under "14 days".
  return {
    startDate: mode === 'tomorrow' ? _addDaysStr(todayStr, 1) : todayStr,
    daysAhead: mode === '2week' ? 13 : mode === 'week' ? 6 : 1,
    label: labels[mode],
  };
}

// Last day of the fetch window. A one-day range ends on its own start day
// however it was chosen (Today/Tomorrow, the calendar, the planner, rebook),
// so a picked Saturday does not bleed into Sunday. The rule reads the INPUTS
// only: every Today/Tomorrow writer also sets daysAhead=1, and a mode left
// stale by a flow that moved the inputs (Find similar asks for a week) must
// not shrink that range to one day. `mode` stays in the signature for the two
// callers, which have to keep producing the same window key.
function _windowEndDate(startDate, days, mode) {
  return days <= 1 ? startDate : _addDaysStr(startDate, days);
}

// What the date row should show: the preset pill to light and, for a single
// chosen day, the date to print on the calendar button. A preset only counts
// while the inputs still ARE its window — the planner and rebook flows move
// the date without touching the mode, and "7 days" must not stay lit over one day.
function _datePillState(mode, startDate, daysAhead, todayStr) {
  const days = parseInt(daysAhead, 10);
  const w = _dateModeWindow(mode, todayStr);
  if (w && w.startDate === startDate && w.daysAhead === days) return { label: w.label, picked: null };
  const isDate = /^\d{4}-\d{2}-\d{2}$/.test(String(startDate || ''));
  return { label: null, picked: (isDate && days === 1) ? startDate : null };
}

// Saved date filter → the state to restore. Presets are re-derived from today
// (they shift daily). A picked date only survives while it is still ahead:
// render() drops started classes, so restoring last Saturday would open the
// app on "No classes found" with nothing lit — that falls back to the week.
function _restoredDateState(saved, todayStr) {
  const s = saved || {};
  const w = _dateModeWindow(s.dateQuickMode, todayStr);
  if (w) return { mode: s.dateQuickMode, startDate: w.startDate, daysAhead: w.daysAhead };
  const week = _dateModeWindow('week', todayStr);
  const start = String(s.startDate || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(start) && start >= todayStr) {
    const days = parseInt(s.daysAhead, 10);
    return { mode: null, startDate: start, daysAhead: days > 0 ? days : week.daysAhead };
  }
  return { mode: 'week', startDate: week.startDate, daysAhead: week.daysAhead };
}

// The scrollLeft that brings one item of a scroll row fully into view, with
// `pad` to spare on the side it was cut off at — unchanged when it already
// is. Everything in the row's own content coordinates.
function _scrollLeftToReveal(scrollLeft, viewW, itemLeft, itemW, pad) {
  const cur = Number(scrollLeft) || 0;
  if (!(viewW > 0) || !(itemW > 0) || isNaN(itemLeft)) return cur;
  const gap = pad > 0 ? pad : 0;
  if (itemLeft - gap < cur) return Math.max(0, itemLeft - gap);
  if (itemLeft + itemW + gap > cur + viewW) return Math.max(0, itemLeft + itemW + gap - viewW);
  return cur;
}
// ── pure:filters:end ──

// A reload with "Next week" (or any later pill) saved lit a pill that sat
// clipped at the row's right edge: the row is wider than a 390px window and
// opens at its start. Moved by the ROW's own scrollLeft, never scrollIntoView()
// — that scrolls every scrollable ancestor too, and the page would jump on
// launch. For a restore / a programmatic change only: _syncDatePills also runs
// on every background search, which must not drag a row the member scrolled.
// A row that is not laid out (another tab is up) measures 0 and cannot be
// moved yet — a reload on #bookings, or a launch from a widget tap, restored
// "Next week" like that and nothing came back to it. It is owed instead:
// switchTab (tabs.js) reveals it, once, when Discover is next shown.
function _revealActiveDatePill() {
  try {
    const row = document.querySelector('.date-presets');
    const pill = row && row.querySelector('.date-quick-btn.active');
    if (!pill) return;
    if (!(row.clientWidth > 0)) { window._datePillRevealOwed = true; return; }
    if (!(row.scrollWidth > row.clientWidth)) return;
    const rowBox = row.getBoundingClientRect(), box = pill.getBoundingClientRect();
    // One row gap to spare (a token, read off the row), so the pill does not end flush against the edge.
    const pad = parseFloat(getComputedStyle(row).columnGap) || 0;
    const next = _scrollLeftToReveal(row.scrollLeft, row.clientWidth, box.left - rowBox.left + row.scrollLeft, box.width, pad);
    if (next !== row.scrollLeft) row.scrollLeft = next;
  } catch (e) { /* a nicety: never in the way of the restore that called it */ }
}

// The date pills' selected state was a CSS class only — a screen reader heard
// "Today, button" lit or not. .active is written from many places (here, the
// presets, onDateInputChange), so it is mirrored rather than set beside each
// one. The calendar button's .active means "open, or carrying a date": it
// says whether its calendar is expanded instead.
function _mirrorDatePillAria() {
  const picker = document.getElementById('datePicker');
  document.querySelectorAll('.date-quick-btn').forEach(b => {
    if (b.id === 'pickDateBtn') b.setAttribute('aria-expanded', String(!!picker && picker.style.display !== 'none'));
    else b.setAttribute('aria-pressed', String(b.classList.contains('active')));
  });
}

// Paint the date row from state (mode + the two inputs), never from whichever
// element was tapped: the empty-state shortcuts, presets, saved searches and
// the planner all change the range without a pill click.
let _pickDateBtnIdle = null; // the calendar button's own icon nodes + name, to put back
function _syncDatePills() {
  const st = _datePillState(_dateQuickMode, document.getElementById('startDate')?.value || '',
    document.getElementById('daysAhead')?.value, localDateStr());
  const btn = document.getElementById('pickDateBtn');
  document.querySelectorAll('.date-quick-btn').forEach(b => {
    if (b !== btn) b.classList.toggle('active', !!st.label && b.textContent.trim() === st.label);
  });
  if (!btn) return;
  if (!_pickDateBtnIdle) {
    _pickDateBtnIdle = { nodes: Array.from(btn.childNodes), name: btn.getAttribute('aria-label') || 'Pick a date', labelled: false };
  }
  if (st.picked) {
    // Text replaces the icon: the pill is a plain (non-flex) button, so an
    // icon + label pair would wrap onto two lines inside it.
    const [y, m, d] = st.picked.split('-').map(Number);
    const label = new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    btn.textContent = label;
    btn.setAttribute('aria-label', _pickDateBtnIdle.name + ' (showing ' + label + ')');
    _pickDateBtnIdle.labelled = true;
  } else if (_pickDateBtnIdle.labelled) {
    btn.textContent = '';
    _pickDateBtnIdle.nodes.forEach(n => btn.appendChild(n));
    btn.setAttribute('aria-label', _pickDateBtnIdle.name);
    _pickDateBtnIdle.labelled = false;
  }
  // Lit while it carries a date, and while its calendar is open.
  const picker = document.getElementById('datePicker');
  btn.classList.toggle('active', !!st.picked || (!!picker && picker.style.display !== 'none'));
  _mirrorDatePillAria(); // search() repaints this row without going through updateFiltersSummary
}

function setDateQuick(mode) {
  if (typeof _releaseDateRow === 'function') _releaseDateRow(); // a pill tap: the date row is the member's own again
  _applyDateQuick(mode);
}

// The preset itself. Split from setDateQuick because THAT name is the one
// interactions.js wraps with saveFilters — a pill tap is the member's choice
// and becomes what the next launch restores. The Monday-reminder tap shows
// "Next week" through here instead: a notification must not change the
// launch default.
function _applyDateQuick(mode) {
  // An unknown mode behaves as the default week view.
  const todayStr = localDateStr();
  if (!_dateModeWindow(mode, todayStr)) mode = 'week';
  const w = _dateModeWindow(mode, todayStr);
  _dateQuickMode = mode;
  document.getElementById('startDate').value = w.startDate;
  document.getElementById('daysAhead').value = w.daysAhead;
  _syncDatePills();
  triggerAutoSearch();
}

// …nor may the member's NEXT tap change it: every wrapped toggle (a studio
// chip, a class type, the Time row) has saveFilters snapshot the LIVE date row,
// so one chip tapped on the reminder's "Next week" saved it as the launch
// default after all. While window._dateRowHeld is set (_onBookingWeekOpened),
// saveFilters (interactions.js) keeps the date it already has stored, and the
// overnight roll re-applies the preset unsaved. A date the member picks
// themselves — a pill, the calendar, Clear filters, a recent search — makes the
// row theirs again; sign-out forgets it. (typeof window: the suites run the
// callers without one.)
function _releaseDateRow() {
  if (typeof window !== 'undefined') window._dateRowHeld = false;
}

// Clear active quick-btn highlight when date/days inputs are changed manually
function onDateInputChange() {
  if (typeof _releaseDateRow === 'function') _releaseDateRow(); // a date of the member's own choosing
  _dateQuickMode = null;
  document.querySelectorAll('.date-quick-btn').forEach(b => b.classList.remove('active'));
  const daysGroup = document.getElementById('daysAheadGroup');
  if (daysGroup) daysGroup.style.display = '';
  triggerAutoSearch();
}

// ── The Filters bar (below 1024px) ───────────────────────────────
// The date row is always on screen; Time / Location / Class Type / Instructor
// sit in #controlsBody behind ONE bar. Collapsed at every launch and never
// stored: it stays as the member left it for this page only, and a "find it"
// shortcut (_focusSearch) does not open it — the chips beside the bar say what
// the shortcut set. The state is a class on #controlsPanel, never an inline
// display: at >=1024px the stylesheet keeps the panel open and hides the bar
// whatever this says, and nothing is measured, scrolled or searched here — the
// bar is a real button that is not repainted, so focus stays on it.
let _filtersCollapsed = true;

function applyFiltersCollapsedState() {
  const panel = document.getElementById('controlsPanel');
  const bar = document.getElementById('controlsToggle');
  if (panel) panel.classList.toggle('filters-collapsed', _filtersCollapsed);
  if (bar) bar.setAttribute('aria-expanded', String(!_filtersCollapsed));
}

function toggleFilters() {
  _filtersCollapsed = !_filtersCollapsed;
  applyFiltersCollapsedState();
  // The chips were out of sight while the panel was open, and a star toggled in
  // its instructor list changes what "Favourites" means: repaint on the way back.
  if (_filtersCollapsed) updateFiltersSummary();
}
applyFiltersCollapsedState();

function clearFilters() {
  // Cleared means cleared: favourites are NOT re-selected here (the Favs
  // button is one tap away) — re-adding them left "Clear" still filtering.
  if (typeof _dropFocusStash === 'function') _dropFocusStash(); // …and what a shortcut set aside is not brought back
  if (typeof _releaseDateRow === 'function') _releaseDateRow(); // the week it resets to is the member's choice, and saved
  selectedInstructors.clear();
  document.getElementById('instrSearch').value = '';
  selectedLocations.clear();
  selectedCategories.clear();
  selectedStrengthSubs.clear();
  selectedStrengthSubs.add('UPPER'); selectedStrengthSubs.add('LOWER'); selectedStrengthSubs.add('FULL');
  selectedReformerSubs.clear();
  REFORMER_SUBS.forEach(s => selectedReformerSubs.add(s.key));
  selectedTimeBands.clear();
  _availableOnly = false;
  renderInstrChips();
  renderStrengthSubPills();
  renderReformerSubPills();
  renderTimePills();
  // The date goes back to the default week as a whole — mode, inputs and
  // pills together. Resetting only the inputs left "Tomorrow" lit over
  // today's classes, and that mismatch is what saveFilters then persisted.
  const week = _dateModeWindow('week', localDateStr());
  _dateQuickMode = 'week';
  document.getElementById('startDate').value = week.startDate;
  document.getElementById('daysAhead').value = week.daysAhead;
  const picker = document.getElementById('datePicker');
  if (picker) picker.style.display = 'none';
  _syncDatePills();
  refreshFacetCounts(); // re-renders the instructor dropdown, studio chips, and class-type pills
  // Show every class again. There is no Search button to press, so the old
  // static "Pick an instructor…" line just left the list blank (and wiped
  // the sign-in prompt); triggerAutoSearch stays inert while signed out.
  triggerAutoSearch();
}

function setStatus(html) {
  document.getElementById('results').innerHTML = `<div class="status">${html}</div>`;
}

// ── pure:filters:start ── (events paging; tests/suites/filters.js evaluates this block)
// `start` for the next /events page: ONE SECOND BEFORE the last class on the
// full page just read. Stepping forward (+1s) skipped any class sharing that
// last start time but cut off by the page limit; stepping back re-reads the
// boundary second instead, and seenIds drops the overlap. Epoch arithmetic on
// purpose: start_at is a naive wall-clock string parsed as UTC, and
// setSeconds() works in DEVICE-local time, which jumps an hour across a DST
// gap (New York, 07:00 on spring-forward day: "-1s" landed on 07:59:59).
function _nextEventsPageStart(batch) {
  const lastTs = batch.map(e => e.start_at).sort().pop();
  const next = new Date(Date.parse(String(lastTs).replace(' ', 'T') + 'Z') - 1000);
  return next.toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
}
// ── pure:filters:end ──

async function fetchEventsForLocation(locId, startDate, endDateStr, seenIds, isStale) {
  const limit = 200;
  let windowStart = startDate + ' 00:00:00';
  const windowEnd  = endDateStr + ' 23:59:59';
  let locEvents = [], locRelations = null;

  while (true) {
    if (isStale ? isStale() : window._searchAborted) break;
    const params = new URLSearchParams({ start: windowStart, end: windowEnd, location: locId, limit });
    const res = await apiFetch(`/events?${params}`).then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
    const batch = res.data || [];
    // (typeof: the suites run this function on its own, without the helper.)
    if (batch.length && typeof _recordShape === 'function') _recordShape('event', batch[0]);
    const newEvents = batch.filter(e => !seenIds.has(e.id));
    if (newEvents.length === 0) break;
    newEvents.forEach(e => seenIds.add(e.id));
    locEvents = locEvents.concat(newEvents);
    if (!locRelations) locRelations = res.relations;
    else mergeRelations(locRelations, res.relations);
    if (batch.length < limit) break;
    // Next page overlaps this one by a second; seenIds drops the repeats and
    // a page with nothing new ends the loop above.
    windowStart = _nextEventsPageStart(batch);
  }
  return { events: locEvents, relations: locRelations };
}

let _searchSeq = 0;
// A search has started that could actually load a timetable: a token AND
// studios to fetch. Before the init IIFE has them (a tap during a cold launch,
// or before the stored token is decrypted) search() finds nothing — the launch
// search must still run after one of those, and only those.
let _loadableSearchStarted = false;

// ── Pre-loaded timetable window + stale-while-revalidate cache ───────
// On launch we hydrate the full all-studios window from localStorage
// (instant smart filtering), then revalidate in the background so
// availability stays fresh. Studio/instructor/type filtering is entirely
// client-side over this window; only a date change or explicit Search
// re-fetches. Booking is validated server-side, so brief staleness can't
// cause a bad booking.
const WINDOW_CACHE_KEY = 'psycle_window_cache';
const WINDOW_CACHE_TTL = 24 * 60 * 60 * 1000;

// ── pure:window:start ── (DOM-free window-range helpers; tests/suites/window.js evaluates this block)
// How long a loaded window is re-filtered with no network call at all. Past
// it the classes still render at once, but a silent revalidate follows:
// "spots left" must never look fresher than it is.
const WINDOW_FRESH_MS = 15 * 60 * 1000;

// 'start|end' → { start, end }; null for anything that is not two ISO days in
// order (the key also comes back from localStorage).
function _parseWindowKey(key) {
  const m = /^(\d{4}-\d{2}-\d{2})\|(\d{4}-\d{2}-\d{2})$/.exec(String(key || ''));
  return (m && m[1] <= m[2]) ? { start: m[1], end: m[2] } : null;
}

// Does the window `key` hold every day of start..end? (ISO days sort as strings.)
function _keyCovers(key, start, end) {
  const w = _parseWindowKey(key);
  return !!w && !!start && !!end && start <= end && w.start <= start && end <= w.end;
}

// Is a class's day inside start..end? The loaded window can be wider than the
// selection, so render() and the facet counts both bound the days with this.
// A missing bound bounds nothing (a restored legacy search has none). The day
// is the first 10 characters of the T- and the space-form start_at alike.
function _dayInRange(startAt, start, end) {
  const day = String(startAt).slice(0, 10);
  return !(start && day < start) && !(end && day > end);
}

// Psycle opens the next booking week on Mondays at 12:00 UK time (the app's own
// Monday reminder says so). These are that instant: the latest one at or before
// `now`, and the first one after it. Walked over calendar days — London's date
// is the UTC date or the day after, hence one day of slack at the near end —
// and resolved through the London helper (pure:gym-time), never the device
// zone. null when that helper, or Europe/London itself, is not available.
function _releaseFrom(now, dir) {
  try {
    const n = new Date(now);
    for (let k = -1; k <= 8; k++) {
      const c = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + dir * k));
      if (c.getUTCDay() !== 1) continue;
      const t = _gymWallToUtcMs(c.getUTCFullYear(), c.getUTCMonth() + 1, c.getUTCDate(), 12, 0, 0);
      if (dir < 0 ? t <= now : t > now) return t;
    }
  } catch (e) { /* fall through: callers keep their clock-only rule */ }
  return null;
}
function _lastReleaseMs(now) { return _releaseFrom(now, -1); }
function _nextReleaseMs(now) { return _releaseFrom(now, 1); }

// ── pure:horizon:start ── (nested in pure:window; tests/suites/14a-usual-week-sheet.js evaluates it too)
// HOW FAR AHEAD PSYCLE BOOKS — OBSERVED, NOT AN API CONTRACT. The API never
// says when booking opens (an event carries `bookable_until` only). Read off
// Psycle's public timetable on Saturday 2026-09-19 (Oxford Circus, occupancy
// per day): real bookings ran through Thu 8 Oct, classes were LISTED through
// Thu 15 Oct. So each Monday-12:00 release opens ONE 7-day batch — the Friday
// 18 days on to the Thursday 24 days on (14 Sept opened Fri 2 → Thu 8 Oct) —
// and the timetable lists one batch further than is open (credit types with an
// `extended_booking_period` may book that one early). The rule this replaced —
// "a Monday–Sunday week opens at noon on the Monday before it" — was wrong:
// next week and the week after are long open.
// ADVISORY ONLY: defaults, notes, which dates a reminder is about. Nothing may
// BLOCK on it — a class that is listed can always be tried, and Psycle's own
// answer stands.
const RELEASE_OPENS_FROM_DAYS = 18;  // release Monday → the first day it opens (a Friday)
const RELEASE_OPENS_TO_DAYS = 24;    // … → the last day it opens (a Thursday)
const RELEASE_LISTED_EXTRA_DAYS = 7; // listed but not yet open: one batch more

// Calendar arithmetic on 'YYYY-MM-DD' through UTC, where every day has 24 hours.
function _horizonAddDays(dayStr, n) {
  const p = String(dayStr).split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
}

// A release is Monday 12:00 in London — 11:00 or 12:00 UTC — so the instant's
// UTC date IS that Monday, whatever zone the device is in.
function _horizonDayOf(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// The Monday-noon release that reaches `dayStr`: the latest Monday on or before
// (day − `reachDays`). null for anything that is not a day, or without London data.
function _releaseReaching(dayStr, reachDays) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayStr || ''));
  if (!m) return null;
  try {
    const edge = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] - reachDays));
    const sinceMonday = (edge.getUTCDay() + 6) % 7;
    return _gymWallToUtcMs(edge.getUTCFullYear(), edge.getUTCMonth() + 1, edge.getUTCDate() - sinceMonday, 12, 0, 0);
  } catch (e) { return null; }
}

// When booking for a day opens, and when the day first appears on the timetable
// (a batch earlier). Observed model — see above.
function _dayOpensMs(dayStr) { return _releaseReaching(dayStr, RELEASE_OPENS_FROM_DAYS); }
function _dayListedMs(dayStr) { return _releaseReaching(dayStr, RELEASE_OPENS_FROM_DAYS + RELEASE_LISTED_EXTRA_DAYS); }

// What is open, what is listed, and what the next release brings. null when the
// clock or Europe/London cannot be read — callers then say nothing about it.
//   openThrough / listedThrough  'YYYY-MM-DD' (London)
//   lastRelease / nextRelease    ms
//   lastBatch / nextBatch        { from, to } — the Friday → Thursday each opens
function _bookingHorizon(nowMs) {
  const now = Number(nowMs);
  const last = _lastReleaseMs(now), next = _nextReleaseMs(now);
  if (!(last > 0) || !(next > 0)) return null;
  const lastDay = _horizonDayOf(last), nextDay = _horizonDayOf(next);
  const openThrough = _horizonAddDays(lastDay, RELEASE_OPENS_TO_DAYS);
  return {
    openThrough,
    listedThrough: _horizonAddDays(openThrough, RELEASE_LISTED_EXTRA_DAYS),
    lastRelease: last,
    nextRelease: next,
    lastBatch: { from: _horizonAddDays(lastDay, RELEASE_OPENS_FROM_DAYS), to: openThrough },
    nextBatch: { from: _horizonAddDays(nextDay, RELEASE_OPENS_FROM_DAYS), to: _horizonAddDays(nextDay, RELEASE_OPENS_TO_DAYS) },
  };
}
// ── pure:horizon:end ──
// (_weekOpensMs — "a Monday–Sunday week opens at noon on the Monday before it"
// — is gone with the rule it stood for: a week does not open as one. Its
// readers ask per DAY now: _dayOpensMs / _dayListedMs above.)

// A stamp from the future (the clock was moved back) is NOT fresh — it would
// otherwise pass for fresh until the clock caught up with it. Nor is a
// timetable fetched BEFORE the latest release: loaded at 11:58 on a Monday it
// passed for fresh until 12:13, so every chip tap and resume kept re-rendering
// a list without the week that had just opened.
function _windowIsFresh(fetchedAt, now) {
  const age = now - fetchedAt;
  if (!fetchedAt || !(age >= 0 && age < WINDOW_FRESH_MS)) return false;
  const release = _lastReleaseMs(now);
  return !(release && fetchedAt < release);
}

// What a persisted window can give a launch that asks for start..end:
//   'covers'  — it holds the whole range: adopt it as it is, under its own key;
//   'overlap' — it holds the first days only (yesterday's week, opened this
//               morning): show those at once, then fetch the real range;
//   null      — nothing usable.
function _cachePlan(cachedKey, start, end) {
  const w = _parseWindowKey(cachedKey);
  if (!w || !start || !end || start > end) return null;
  if (w.start <= start && end <= w.end) return 'covers';
  return (w.start <= start && start <= w.end) ? 'overlap' : null;
}

// The range a revalidate fetches. A window that covers the selection is
// refreshed as a whole — refreshing "Today" must not shrink the loaded week to
// one day — minus days already gone, and never cutting into the selection.
// Anything else fetches exactly what is selected.
function _revalRange(windowKey, selStart, selEnd, todayStr) {
  if (!_keyCovers(windowKey, selStart, selEnd)) return { startDate: selStart, endDateStr: selEnd };
  const w = _parseWindowKey(windowKey);
  const start = w.start >= todayStr ? w.start : (todayStr < selStart ? todayStr : selStart);
  return { startDate: start, endDateStr: w.end };
}

// The preset to re-apply when the app is looked at on a different day than the
// one its date row was derived for (`lastDay`); null = leave the dates alone.
//  - a preset whose inputs still ARE its window as of lastDay follows the
//    calendar: Today stays "today", Tomorrow becomes the new tomorrow;
//  - any other range that now starts in the past (a picked day that has gone)
//    falls back to the week — render() would drop every class in it;
//  - a range still ahead was chosen on purpose and stays.
// (The inputs are compared, not just the mode: flows that move the date can
// leave a stale mode behind, and that must not drag a future date to today.)
function _rollForwardMode(s) {
  if (!s || !s.today || s.today === s.lastDay) return null;
  const was = _dateModeWindow(s.mode, s.lastDay);
  if (was && was.startDate === s.startDate && was.daysAhead === parseInt(s.daysAhead, 10)) return s.mode;
  return (/^\d{4}-\d{2}-\d{2}$/.test(String(s.startDate || '')) && s.startDate < s.today) ? 'week' : null;
}

// Did any class start in [fromMs, toMs)? Same clock and same edge as render()'s
// "already started" test (start < now), so a resume re-renders exactly when
// that test would now drop a card it kept at fromMs. An unparseable start_at
// never counts (NaN compares false).
function _anyStartedBetween(events, fromMs, toMs) {
  return (events || []).some(e => {
    const t = new Date(e.start_at).getTime();
    return t >= fromMs && t < toMs;
  });
}
// ── pure:window:end ──

// Is the selected range inside the window already in memory?
function _windowCovers(startDate, endDateStr) {
  return Array.isArray(window._windowEvents) && !!window._windowRelations &&
    _keyCovers(window._windowKey, startDate, endDateStr);
}

function currentWindowDates() {
  const startDate = document.getElementById('startDate').value;
  const days = parseInt(document.getElementById('daysAhead').value) || 14;
  const endDateStr = _windowEndDate(startDate, days, _dateQuickMode);
  return { startDate, endDateStr, windowKey: startDate + '|' + endDateStr };
}

function currentFilters() {
  const { startDate, endDateStr } = currentWindowDates();
  return {
    instructorId: [...selectedInstructors],
    locationIds: [...selectedLocations],
    categoryKeys: new Set(selectedCategories),
    startDate, endDateStr,
    strengthSubs: new Set(selectedStrengthSubs),
    reformerSubs: new Set(selectedReformerSubs),
    timeBands: new Set(selectedTimeBands),
    availableOnly: _availableOnly,
  };
}

// Lite per-event view that powers the cascading facet counts. Rebuilt
// whenever the window data changes (fetch / hydrate / revalidate) — NOT on
// filter changes (those reuse it), which keeps counts stable + correct.
function _buildFacetClasses(events, relations) {
  const studioMap = Object.fromEntries((relations.studios || []).map(s => [s.id, s]));
  const typeMap = Object.fromEntries((relations.event_types || []).map(t => [t.id, t]));
  const now = new Date();
  window._facetClasses = (events || [])
    .filter(e => new Date(e.start_at) >= now)
    .map(e => ({
      instr: String(e.instructor_id),
      loc: String((studioMap[e.studio_id] || {}).location_id || ''),
      cat: getCategory((typeMap[e.event_type_id] || {}).name || '').key,
      start_at: e.start_at,
      id: String(e.id), full: !!e.is_fully_booked, // the "Available only" pill narrows the counts too
    }));
  refreshFacetCounts();
}

// `partial`: the events do not fill the key's whole range (an older cache
// adopted for a newer range while the real fetch runs, or a search that lost a
// studio). Such a window is never persisted and never counts as fresh,
// whatever its stamp says — the next render from it refetches quietly.
function _setWindow(windowKey, events, relations, fetchedAt, partial) {
  window._windowKey = windowKey;
  window._windowEvents = events;
  window._windowRelations = relations;
  window._windowFetchedAt = fetchedAt || Date.now();
  window._windowPartial = !!partial;
  // The last day an adopted cache really held (search(), 'overlap' — the only
  // caller that sets it, right after this): the key claims days past it.
  window._windowHeldEnd = null;
  // Why the last load behind this window failed (a categorizeError message),
  // for "Couldn't check these dates": a 503 is not the member's connection.
  // Never 'auth' — the session banner owns that, and it would outlive the
  // re-login.
  window._windowLoadError = null;
}

function _persistWindow(windowKey, events, relations) {
  try {
    localStorage.setItem(WINDOW_CACHE_KEY, JSON.stringify({ key: windowKey, fetchedAt: Date.now(), events, relations }));
  } catch (e) { return; /* quota / serialization — non-fatal; the in-memory cache still works */ }
  // This cache is megabytes in a bucket of about five (half that on WebKit).
  // When it only just fitted, every SMALL write after it failed instead: the
  // sign-in token, a favourite, history. A cache must never be what fills the
  // bucket — if 64K more does not fit beside it, it goes. (The pad key is not
  // one the iOS bridge mirrors.)
  try {
    localStorage.setItem('psycle_quota_probe', new Array(65537).join('x'));
    localStorage.removeItem('psycle_quota_probe');
  } catch (e) {
    try { localStorage.removeItem('psycle_quota_probe'); localStorage.removeItem(WINDOW_CACHE_KEY); } catch (e2) {}
  }
}

function _readWindowCache() {
  try {
    const c = JSON.parse(localStorage.getItem(WINDOW_CACHE_KEY) || 'null');
    if (c && c.events && c.relations && c.fetchedAt && (Date.now() - c.fetchedAt) < WINDOW_CACHE_TTL) return c;
  } catch (e) {}
  return null;
}

let _windowRenderedAt = 0; // when the list was last built from the window (on resume: has a class started since?)
// `quiet`: nobody asked for this render (a background refresh landed, a
// resume). The rebuilt cards must not replay their entrance — the top of the
// list blinked under the member's eyes (css/tabs.css reads data-quiet). Only
// when cards are already up: "Checking…" / empty → list keeps its entrance.
function renderFromWindow(filters, quiet) {
  // An instant cached render owns the view from this moment: supersede any
  // in-flight search for a different range, or its late progressive renders
  // would append foreign day-groups on top of this view and restamp the
  // window key to the abandoned range.
  _searchSeq++;
  _windowRenderedAt = Date.now();
  const cont = document.getElementById('results');
  if (cont) {
    cont.toggleAttribute('data-quiet', !!quiet && !!cont.querySelector('.class-card'));
    cont.innerHTML = '';
  }
  render(window._windowEvents, window._windowRelations, filters, true);
  if (typeof refreshFacetCounts === 'function') refreshFacetCounts();
  renderLastUpdated();
}

// "Available only" never hides the member's own class — but the launch render
// runs before /bookings has answered (search() does not wait for it), so a
// held class that is full, or any waitlisted one, was filtered out as somebody
// else's. The bookings landing only relabels cards that EXIST, and a window
// under 15 minutes old is not revalidated: the class stayed missing, and the
// chip counts short, until the next filter tap. Once per set of such classes —
// one that another filter hides must not cost a render on every fetch.
let _ownFullSeen = '';
function _showOwnFullClasses() {
  if (!_availableOnly) return;
  const ids = (window._windowEvents || []).filter(e => e && e.is_fully_booked && _myBookings[String(e.id)]).map(e => String(e.id));
  const key = ids.join();
  if (key === _ownFullSeen) return;
  _ownFullSeen = key;
  if (ids.some(id => !document.querySelector(`#results .class-card[data-id="${Number(id)}"]`))) _renderWindowInPlace();
}
PsycleEvents.on('bookings:loaded', _showOwnFullClasses);

// ── Pick-a-date calendar (redesign) ─────────────────────────────────
let _calMonth = null; // { y, m }

// Escape closes the calendar and hands focus back to its button. It is an
// inline disclosure, not a modal layer: the overlay key handler further down
// knows nothing about it, and should not — this is the calendar's own keydown,
// wired the first time it opens (so it runs AFTER that handler, which has
// already claimed the key for any sheet that is up). Only when the key is the
// calendar's to take: focus in it, on its button, or nowhere (stepping a month
// rebuilds the arrow that was pressed, and Safari never focuses a clicked
// button) — Escape in the instructor search box is not ours.
let _datePickerKeysWired = false;
function _wireDatePickerKeys(el, btn) {
  if (_datePickerKeysWired) return;
  _datePickerKeysWired = true;
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.defaultPrevented || el.style.display === 'none') return;
    if (_ownKeysOverlayUp()) return; // a confirm / the tour / the usual-week sheet is on top
    const at = document.activeElement;
    if (at && at !== document.body && at !== btn && !el.contains(at)) return;
    e.preventDefault();
    toggleDatePicker(); // its close branch: hidden, pills and aria-expanded re-synced
    if (btn && typeof btn.focus === 'function') btn.focus();
  });
}

function toggleDatePicker() {
  const el = document.getElementById('datePicker');
  const btn = document.getElementById('pickDateBtn');
  if (!el) return;
  _wireDatePickerKeys(el, btn);
  // Closed is exactly display:none. Opening sets display to '' — the old
  // `|| !el.style.display` read that as closed too, so a second tap on the
  // button re-opened the calendar and the close branch below never ran.
  const willOpen = el.style.display === 'none';
  if (willOpen) {
    if (!_calMonth) { const d = new Date(); _calMonth = { y: d.getFullYear(), m: d.getMonth() }; }
    renderCalendar();
    el.style.display = '';
    if (btn) btn.classList.add('active');
    _mirrorDatePillAria(); // aria-expanded (the close branch gets there through _syncDatePills)
  } else {
    el.style.display = 'none';
    _syncDatePills(); // stays lit if it is carrying a picked date
  }
}
function calStep(dir) {
  if (!_calMonth) return;
  let { y, m } = _calMonth; m += dir;
  if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
  _calMonth = { y, m }; renderCalendar();
}
function pickCalDate(ds) {
  document.getElementById('startDate').value = ds;
  document.getElementById('daysAhead').value = 1;
  _dateQuickMode = null;
  const el = document.getElementById('datePicker'); if (el) el.style.display = 'none';
  if (typeof onDateInputChange === 'function') onDateInputChange();
  else if (typeof triggerAutoSearch === 'function') triggerAutoSearch();
  // Last: onDateInputChange un-lights every pill, the calendar button included.
  // The chosen day is printed on that button — it was shown nowhere before.
  _syncDatePills();
}
// Days (YYYY-MM-DD) that have classes in the cached window — drives the dots.
function _classDays() {
  const s = new Set();
  (window._facetClasses || []).forEach(c => { if (c.start_at) s.add(String(c.start_at).slice(0, 10)); });
  return s;
}
function renderCalendar() {
  const el = document.getElementById('datePicker');
  if (!el || !_calMonth) return;
  const { y, m } = _calMonth;
  const first = new Date(y, m, 1);
  const startW = (first.getDay() + 6) % 7; // Monday-first grid
  const days = new Date(y, m + 1, 0).getDate();
  const today = localDateStr(new Date());
  const sel = document.getElementById('startDate').value;
  const classDays = _classDays();
  const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  let cells = '';
  for (let i = 0; i < startW; i++) cells += '<span></span>';
  for (let d = 1; d <= days; d++) {
    const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const past = ds < today;
    let cls = 'cal-cell';
    if (ds === sel) cls += ' sel'; else if (past) cls += ' past'; else if (ds === today) cls += ' today';
    const dot = classDays.has(ds) ? '<span class="cal-dot"></span>' : '';
    // A gone day is disabled, not just unwired: it still took keyboard focus.
    const click = past ? ' disabled' : ` onclick="pickCalDate('${ds}')"`;
    // "17" alone says nothing to a screen reader: the full date, whether it is
    // the chosen one, and what the dot means.
    const name = new Date(y, m, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) + (dot ? ', has classes' : '');
    cells += `<button class="${cls}" aria-label="${escapeHTML(name)}" aria-pressed="${ds === sel}"${click}>${d}${dot}</button>`;
  }
  el.innerHTML =
    `<div class="cal-head"><button class="cal-nav" onclick="calStep(-1)" aria-label="Previous month">‹</button>` +
    `<span class="cal-title">${MON[m]} ${y}</span>` +
    `<button class="cal-nav" onclick="calStep(1)" aria-label="Next month">›</button></div>` +
    `<div class="cal-wd">${WD.map(w => `<span>${w}</span>`).join('')}</div>` +
    `<div class="cal-grid">${cells}</div>` +
    `<div class="cal-legend"><span class="cal-dot"></span>Days with classes</div>`;
}

// Fetch the full window (every studio) for a date range.
async function fetchFullWindow(startDate, endDateStr, stale) {
  const seenIds = new Set();
  let allEvents = [], relations = null;
  const locs = locations.filter(l => l.handle !== 'psycle-at-home');
  await Promise.all(locs.map(async loc => {
    const r = await fetchEventsForLocation(loc.id, startDate, endDateStr, seenIds, stale);
    if (stale && stale()) return;
    allEvents = allEvents.concat(r.events);
    if (!relations) relations = r.relations;
    else if (r.relations) mergeRelations(relations, r.relations);
  }));
  return { events: allEvents, relations };
}

// True while a Discover card is mid-flow: a dialog is up, or a Book button is
// waiting on the server. The flow holds that very button, so the list must
// not be rebuilt underneath it (same test as _resyncDiscoverButtons).
function _discoverBusy() {
  if (_dialogOpen()) return true;
  return Array.from(document.querySelectorAll('#results .book-btn'))
    .some(b => b.dataset.busy === '1' || b.textContent === '…');
}

// Re-render after a background refresh without yanking the page: the scroll
// offset survives (clearing #results collapses the scroller and clamps it),
// and a busy list is left alone — we come back for it, bounded like
// showHistorySyncPrompt's deferral. The window itself is already updated, so
// the next filter tap shows the new numbers either way.
let _inPlaceTimer = null, _inPlaceDefers = 0;
function _renderWindowInPlace(isRetry) {
  clearTimeout(_inPlaceTimer);
  if (!isRetry) _inPlaceDefers = 0;
  const sel = currentWindowDates();
  if (!_windowCovers(sel.startDate, sel.endDateStr)) return;  // the view moved to another range
  if (_fetchingSeq && _fetchingSeq === _searchSeq) return;     // a live search owns the list
  if (_discoverBusy()) {
    if (_inPlaceDefers++ < 40) _inPlaceTimer = setTimeout(() => _renderWindowInPlace(true), 1500);
    return;
  }
  const sc = document.querySelector('.tab-content'); // the scroller at <=640px; wider, it is the document
  const top = sc ? sc.scrollTop : 0, y = window.scrollY;
  renderFromWindow(currentFilters(), true);
  if (sc && sc.scrollTop !== top) sc.scrollTop = top;
  if (window.scrollY !== y) window.scrollTo(0, y);
}

// The sequence number of the search() that is fetching right now (0 = none).
// It is only "live" while it still equals _searchSeq — a superseded search
// keeps running until its requests return, but will never render or commit.
let _fetchingSeq = 0;
// One revalidate per range at a time: renderLastUpdated() repaints on every
// chip tap and used to hand back a live Refresh link mid-refresh.
let _revalInFlight = null; // { key, silent, moved, promise }
// A background refresh that failed is not retried for a minute — every chip
// tap over a stale window asks for one, and each costs a request per studio.
let _revalFailedAt = 0;
const REVAL_RETRY_MS = 60 * 1000;
// The provisional window a failed refresh was already handed to search() for
// (see _runRevalidate): once per window, never on every retry.
let _handoverKey = null;

// Refresh the window behind the current view: re-fetch, update the cache +
// facets, re-render in place. No spinner; the list stays up. Resolves true
// only when a COMPLETE window was committed.
//   opts.silent — nobody asked (resume, a render from a stale window): no
//                 toasts, skipped while offline and just after a failure.
function revalidateWindow(opts) {
  const silent = !!(opts && opts.silent);
  if (!getBearerToken() || !locations.length) return Promise.resolve(false);
  // A live search is already loading this view fresh; a second loader would
  // only race its renders.
  if (_fetchingSeq && _fetchingSeq === _searchSeq) return Promise.resolve(false);
  if (navigator.onLine === false) {
    // GETs retry with backoff: offline that is ~7s of failures per studio,
    // and an error-log entry for each.
    if (!silent) toast("You're offline — showing the last timetable we loaded", 'info');
    return Promise.resolve(false);
  }
  if (silent && Date.now() - _revalFailedAt < REVAL_RETRY_MS) return Promise.resolve(false);
  const sel = currentWindowDates();
  const range = _revalRange(window._windowKey, sel.startDate, sel.endDateStr, localDateStr());
  const run = { key: range.startDate + '|' + range.endDateStr, silent, moved: false, promise: null };
  // A run whose latch has tripped (the view left its range and came back) will
  // never commit: joining it made Refresh do nothing and left "Checking…" up
  // for good. It is replaced instead — its clean-up only clears the slot while
  // it still holds it.
  if (_revalInFlight && _revalInFlight.key === run.key && !_revalInFlight.moved) {
    // Join it. A Refresh tapped over a background run makes it a manual one:
    // whoever asked gets told if it fails.
    if (!silent) _revalInFlight.silent = false;
    return _revalInFlight.promise;
  }
  _revalInFlight = run;
  renderLastUpdated(); // "Refreshing…"
  run.promise = _runRevalidate(run, range).catch(() => {
    if (_revalInFlight === run) _revalInFlight = null;
    renderLastUpdated();
    return false;
  });
  return run.promise;
}

async function _runRevalidate(run, range) {
  // LATCHED "this range is no longer wanted". It deliberately ignores
  // _searchSeq: every chip tap bumps that (renderFromWindow), which made
  // fetchFullWindow drop the studios still loading — and the truncated window
  // was then committed AND persisted, so whole studios vanished for the day.
  // Only a move to a range this fetch does not hold abandons it, and once
  // abandoned it stays abandoned (studios were skipped in the meantime) even
  // if the member taps straight back. The latch lives on the run, so
  // revalidateWindow() can see a dead run and start a new one beside it.
  const gone = () => {
    if (!run.moved) {
      const now = currentWindowDates();
      run.moved = !_keyCovers(run.key, now.startDate, now.endDateStr);
    }
    return run.moved;
  };
  let result = null, err = null;
  try { result = await fetchFullWindow(range.startDate, range.endDateStr, gone); }
  catch (e) { err = e; } // one studio failing rejects the lot: never commit a partial window
  if (_revalInFlight === run) _revalInFlight = null; // before the repaints below read it
  if (!err && result && result.relations && !gone()) {
    _revalFailedAt = 0;
    _setWindow(run.key, result.events, result.relations);
    _persistWindow(run.key, result.events, result.relations);
    _buildFacetClasses(result.events, result.relations);
    _renderWindowInPlace();
    renderLastUpdated(); // also when the re-render was deferred
    return true;
  }
  if (err) {
    _revalFailedAt = Date.now();
    let cat = null;
    try { cat = window.PsycleAPI.categorizeError(err); } catch (_) {}
    if (cat && cat.type !== 'unknown' && cat.type !== 'auth') window._windowLoadError = cat.userMessage; // see _setWindow
    // A window adopted from an older cache still lacks its last day(s), and
    // this all-or-nothing refresh keeps failing for as long as ONE studio is
    // down — the member saw a short week, or "no classes" on a day nobody had
    // loaded. search() shows the studios that do answer (and says which did
    // not), so hand over to it: once per window, and only for a server error
    // — on a bad connection it would swap the cached list for an error. It
    // clears #results, so never under a booking in progress.
    if (cat && cat.type === 'server' && window._windowHeldEnd && _handoverKey !== window._windowKey &&
        !gone() && !_discoverBusy() && getBearerToken()) {
      _handoverKey = window._windowKey;
      search({ force: true });
    } else if (!run.silent && !gone() && getBearerToken()) {
      // Read at failure time: a manual Refresh may have joined a background run.
      // A dead session already has its own banner (apiFetch → showSessionExpired).
      let msg = "Couldn't refresh the timetable — check your connection and try again";
      if (cat && cat.type !== 'unknown') msg = cat.userMessage; // "Psycle's servers are having trouble…" is not a connection problem
      toast(msg, 'error');
    }
  } else if (result && !result.relations && !run.silent && !gone()) {
    // Every studio answered 200 with no classes at all. Nothing was committed
    // above — an empty 200 must not wipe a timetable (and the day's cache)
    // that was real a minute ago — and the "Updated" stamp stays as old as
    // the list is. Whoever tapped Refresh is told: it looked like a dead tap.
    toast('Psycle sent back an empty timetable — still showing the last one we loaded', 'info');
  }
  // A provisional window showed "Checking…" in place of an empty list (see
  // _discoverEmptyContext): nothing more is coming, so say what we know —
  // unless a newer run has taken this one's place (it swaps the placeholder
  // itself). A view that moved to another range is left alone in there.
  if (!_revalInFlight && document.querySelector('#results .empty-loading')) _renderWindowInPlace();
  renderLastUpdated();
  return false;
}

// Render from the window, then refresh it quietly when its numbers are old.
function _revalidateIfStale() {
  if (!window._windowPartial && _windowIsFresh(window._windowFetchedAt, Date.now())) return;
  revalidateWindow({ silent: true });
}

// ── Discover rolls forward ──────────────────────────────────────────
// The date row is derived once (launch, or a tap) and an iPhone keeps the app
// warm for days: next morning "Today" still meant yesterday — every class in
// it started, the next chip tap said "No classes found" — and nothing looked
// at Discover on resume at all.
let _discoverDay = localDateStr(); // the day the date row was last checked against

// Re-derive the date row if the day has changed. True when it moved — the
// preset was re-applied through setDateQuick, which saves it and searches.
// Not while the row is the Monday reminder's (see _releaseDateRow): rolled the
// same, but through _applyDateQuick — an app left warm overnight saved "Next
// week" as the launch default with no tap at all.
function _rollDiscoverForward() {
  const today = localDateStr();
  if (today === _discoverDay) return false;
  const startEl = document.getElementById('startDate'), daysEl = document.getElementById('daysAhead');
  const mode = _rollForwardMode({
    today, lastDay: _discoverDay, mode: _dateQuickMode,
    startDate: startEl ? startEl.value : '', daysAhead: daysEl ? daysEl.value : '',
  });
  _discoverDay = today; // before setDateQuick: it comes straight back through triggerAutoSearch
  if (!mode) return false;
  if (typeof window !== 'undefined' && window._dateRowHeld) _applyDateQuick(mode);
  else setDateQuick(mode);
  return true;
}

// Back in the foreground (the other visibility handlers reload bookings and
// heal auth; this one is Discover's). New day: roll the date row. Same day:
// drop the classes that started while we were away — only if one did, a
// rebuild is not free — and refresh numbers that have gone old (silently; it
// re-renders in place when it lands). Never under a booking in progress: a
// roll searches, and that search rebuilds the list the open picker's button
// lives in — wait for the flow to end (bounded, as above).
let _resumeTimer = null, _resumeDefers = 0;
function _discoverResumed(isRetry) {
  clearTimeout(_resumeTimer);
  if (!isRetry) _resumeDefers = 0;
  if (document.hidden || !getBearerToken()) return;
  if (_discoverBusy()) {
    if (_resumeDefers++ < 40) _resumeTimer = setTimeout(() => _discoverResumed(true), 1500);
    return;
  }
  if (_rollDiscoverForward()) return;
  const sel = currentWindowDates();
  if (!_windowCovers(sel.startDate, sel.endDateStr)) return; // nothing loaded for this view (or a search is on its way)
  renderLastUpdated(); // "Updated 3m ago" does not tick on its own
  if (_anyStartedBetween(window._windowEvents, _windowRenderedAt, Date.now())) _renderWindowInPlace();
  _revalidateIfStale();
}
document.addEventListener('visibilitychange', function () { _discoverResumed(); });

// ── "Last updated" + manual refresh (Discover filters) ──────────────
function _relativeTime(ts) {
  if (!ts) return '';
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : d + 'd ago';
}

function renderLastUpdated() {
  const el = document.getElementById('lastUpdated');
  if (!el) return;
  if (!window._windowFetchedAt) { el.innerHTML = ''; return; }
  // Painted from state, not by the click handler: every chip tap repaints this
  // label, and a refresh in flight (manual or background) must stay "Refreshing…".
  el.innerHTML = 'Updated ' + _relativeTime(window._windowFetchedAt) + ' · ' +
    (_revalInFlight
      ? '<button type="button" class="refresh-link" disabled>Refreshing…</button>'
      : '<button type="button" class="refresh-link" onclick="refreshWindow()">Refresh</button>');
}

// Manual refresh (the link above, and pull-to-refresh on Discover) — silently
// re-fetch the window (results stay visible while loading) and restamp "last
// updated". Returns the promise so the pull indicator can resolve with it.
async function refreshWindow() {
  try { await revalidateWindow(); } catch (e) {}
  renderLastUpdated();
}

// ── Monday noon: the new booking week opens ─────────────────────────
// _windowIsFresh already calls anything fetched before the release stale, but
// something has to LOOK: a member waiting on Discover at 11:58 taps nothing at
// 12:00. One timer per release does — in the foreground only (a resume goes
// through _discoverResumed, which finds the window stale by itself) and
// silently: the list stays up and is swapped in place when the fetch lands.
// A DOM timer stops counting while the app is suspended or the phone sleeps and
// resumes with what was LEFT: armed Sunday evening it would fire hours after
// noon — and the Monday reminder now fires AT the release, so a member who taps
// it is looking at this list at exactly that moment. So it is re-armed from
// the clock on every return to the foreground (below).
let _releaseTimer = null;
function _armReleaseTimer() {
  clearTimeout(_releaseTimer);
  const next = _nextReleaseMs(Date.now());
  if (!next) return;
  // At most a week away: well inside setTimeout's 24.8-day ceiling.
  _releaseTimer = setTimeout(() => {
    _armReleaseTimer(); // next Monday's
    _refreshForRelease(false);
    // Once more a minute on: a phone clock running fast asked too early (and
    // stamped that answer as post-release), and Psycle's side can land a few
    // seconds late. Not when this timer itself fired late — the app was
    // suspended, and the release is long done.
    if (Date.now() - next < 60 * 1000) setTimeout(() => _refreshForRelease(true), 60 * 1000);
  }, Math.max(0, next - Date.now()) + 3000);
}
function _refreshForRelease(again) {
  if (document.hidden || !getBearerToken()) return;
  // The second look comes 60s after the first STARTED — always inside the 60s
  // back-off a first look that FAILED set (Monday noon is Psycle's weekly
  // peak), which a silent revalidate honours: the retry could never run in the
  // one case it matters most. Clear it; a first run still in flight is joined.
  if (again) { _revalFailedAt = 0; revalidateWindow({ silent: true }); }
  else _revalidateIfStale(); // stamped before the release → stale
}
_armReleaseTimer();
document.addEventListener('visibilitychange', () => { if (!document.hidden) _armReleaseTimer(); });

// ── pure:week-opened:start ── (DOM-free; tests/suites/14c-weekly-reminder.js evaluates this block)
// WHICH dates a Monday release opens, for the reminder tap below. Observed on
// 2026-09-19 (Psycle's public timetable, read-only — not an API contract): each
// Monday 12:00 London release opens a 7-day batch, the Friday 18 days after
// that Monday to the Thursday 24 days after it (14 Sept opened Fri 2 → Thu 8
// Oct). window._bookingHorizon(now) owns that model where it exists — its
// `openThrough` is the batch's last day — and these two numbers are only the
// stand-in for a build without it. The release instant is 11:00 or 12:00 UTC,
// so its UTC date IS the London Monday: plain day arithmetic, no zone.
// It only says where a tap LANDS: nothing is refused or hidden because of it.
const OPENED_BATCH_FIRST_DAY = 18;
const OPENED_BATCH_LAST_DAY = 24;
function _isoDayPlus(ds, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ds || ''));
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n)).toISOString().slice(0, 10);
}
// → { from, to } ('YYYY-MM-DD', London days) or null when neither can say.
function _openedBatch(horizon, lastReleaseMs) {
  const through = horizon && _isoDayPlus(horizon.openThrough, 0);
  if (through) return { from: _isoDayPlus(through, -6), to: through };
  if (!(typeof lastReleaseMs === 'number' && isFinite(lastReleaseMs) && lastReleaseMs > 0)) return null;
  const monday = new Date(lastReleaseMs).toISOString().slice(0, 10);
  return { from: _isoDayPlus(monday, OPENED_BATCH_FIRST_DAY), to: _isoDayPlus(monday, OPENED_BATCH_LAST_DAY) };
}
// Where the tap goes. 'review' = My Bookings + the usual-week REVIEW sheet on
// those dates (it lists every class and books only what is ticked and confirmed
// in it — the tap itself books nothing); 'discover' = Discover on the batch's
// first day. A saved week with no sheet to open it in is 'discover' too.
function _weekOpenedRouteFor(f) {
  return (f && f.hasUsualWeek && f.canReview) ? 'review' : 'discover';
}
// ── pure:week-opened:end ──

// The Monday "New Psycle dates are open" reminder was tapped (the iOS bridge
// calls this, having put the member on My Bookings when a usual week is saved
// and on Discover when not — the same stored week read here, at the tap).
// With a usual week: its review sheet on the dates that just opened,
// bookTemplateWeek({ range: 'newest' }). NOTHING is booked by the tap — the
// sheet lists the classes and the member ticks and confirms. Without one:
// Discover on the first of those dates, as a day picked in the calendar —
// it searches, and a window fetched before the release is refreshed by the
// freshness rule, so there is no explicit refresh here to race that search.
// (It showed the 'Next week' preset until September 2026: the wrong week — that
// one opened a fortnight earlier.) NOT through onDateInputChange / setDateQuick:
// those save the filters (interactions.js), and a tapped notification became
// what every later launch opened on. Not before launch is done, though: init's
// tail and restoreFilters would each put the OLD date back. A search that
// could load only starts after both. Nor under a booking in progress (the
// search rebuilds the list the open picker's button lives in), and the review
// never over another dialog, sheet or the welcome, nor before the session is
// verified (its plan would call a signed-in member signed out). Bounded: signed
// out, or reference data that never loads, it gives up quietly — and BY THE
// CLOCK, like the bridge's own tap router: timers freeze in a suspended app, so
// a try counter alone let the poll wake hours later and rewrite the date row.
// A retry also only acts while the member is still where the tap put them:
// having moved on — "View my bookings" on the dialog that held this up — they
// are not yanked back.
const WEEK_OPENED_GIVE_UP_MS = 15000;
let _weekOpenedTimer = null, _weekOpenedTries = 0, _weekOpenedAt = 0, _weekOpenedRoute = 'discover';

function _weekOpenedUsualWeek() {
  try { return typeof loadWeeklyTemplate === 'function' && loadWeeklyTemplate().length > 0; } catch (e) { return false; }
}

// Anything the review sheet would land on top of, or a Book button mid-flight
// on either tab (the run inside the sheet must never start beside another booking).
function _weekOpenedReviewBlocked() {
  try {
    if (_dialogOpen() || _ownKeysOverlayUp() || _overlayStack.length > 0 || document.getElementById('bookingConfirmation')) return true;
    return Array.from(document.querySelectorAll('.book-btn')).some(b => b.dataset.busy === '1' || b.textContent === '…');
  } catch (e) { return true; } // cannot tell → wait (bounded by the clock above)
}

// The date row's own custom-date path — what pickCalDate writes — minus
// onDateInputChange: that name is saved by interactions.js and releases the hold.
function _showOpenedDay(day) {
  const startEl = document.getElementById('startDate'), daysEl = document.getElementById('daysAhead');
  if (!startEl || !daysEl) return false;
  window._dateRowHeld = true; // …nor may the member's next chip tap save it (see _releaseDateRow)
  _dateQuickMode = null;
  startEl.value = day;
  daysEl.value = 1;
  _syncDatePills(); // the calendar button now reads that day
  triggerAutoSearch();
  return true;
}

window._onBookingWeekOpened = function (isRetry) {
  clearTimeout(_weekOpenedTimer);
  if (isRetry !== true) {
    _weekOpenedTries = 0;
    _weekOpenedAt = Date.now();
    _weekOpenedRoute = _weekOpenedRouteFor({ hasUsualWeek: _weekOpenedUsualWeek(), canReview: typeof window.bookTemplateWeek === 'function' });
  } else {
    if (Date.now() - _weekOpenedAt > WEEK_OPENED_GIVE_UP_MS) return;
    const active = document.querySelector('.tab-panel.active');
    if (active && active.id !== (_weekOpenedRoute === 'review' ? 'tab-bookings' : 'tab-discover')) return;
  }
  const review = _weekOpenedRoute === 'review';
  // The review is already on screen (the member opened it, or an earlier tap
  // did): no second sheet. It must not wait for it either — a retry left
  // polling re-opened the sheet the moment the member closed it. But a sheet
  // opened BEFORE the 12:00 release (to be ready for it), or sitting on another
  // range, has no "Newly opened" dates — the ones this tap promised — so an
  // idle sheet is asked to show them (js/tabs.js _usualWeekSheetNewest: it
  // re-plans, books nothing, and refuses during a run or over the seat map).
  // Only the TAP itself asks: a poll that wakes seconds later must not re-list
  // a sheet the member has opened — and started ticking — in the meantime.
  if (review && document.getElementById('usualWeekSheet')) {
    if (isRetry !== true) { try { if (typeof window._usualWeekSheetNewest === 'function') window._usualWeekSheetNewest(); } catch (e) {} }
    return;
  }
  const wait = !_loadableSearchStarted ||
    (review ? (!currentUser || !getBearerToken() || _weekOpenedReviewBlocked()) : _discoverBusy());
  if (wait) {
    if (_weekOpenedTries++ < 120) _weekOpenedTimer = setTimeout(() => window._onBookingWeekOpened(true), 500);
    return;
  }
  if (review) {
    if (isRetry !== true && typeof switchTab === 'function') switchTab('bookings');
    // The sheet owns everything from here: its own session / connection /
    // bookings-loaded checks, the double-open guard, and every booking rule.
    try { Promise.resolve(window.bookTemplateWeek({ range: 'newest' })).catch(() => {}); } catch (e) {}
    return;
  }
  if (isRetry !== true && typeof switchTab === 'function') switchTab('discover');
  let horizon = null;
  try { if (typeof window._bookingHorizon === 'function') horizon = window._bookingHorizon(Date.now()); } catch (e) {}
  const batch = _openedBatch(horizon, _lastReleaseMs(Date.now()));
  // No London zone data to work the dates out from: the list as it stands, made current.
  if (!batch || !_showOpenedDay(batch.from)) { _revalidateIfStale(); return; }
  _revealActiveDatePill(); // the calendar button, when the row has been scrolled away from it
};

async function search(opts) {
  // This run already reads the latest filter state, so a debounced search
  // still pending (restoreFilters arms one at launch) is redundant: left
  // alone it rebuilt the whole list ~600ms after the first paint.
  clearTimeout(_autoSearchTimer); _autoSearchTimer = null;
  // Every date change funnels through here, including the planner / rebook
  // flows that move the inputs without a pill tap — keep the date row honest.
  _syncDatePills();
  opts = opts || {};
  const force = !!opts.force;
  const instructorId = [...selectedInstructors];
  const locationIds  = [...selectedLocations];
  const categoryKeys = new Set(selectedCategories);
  const startDate    = document.getElementById('startDate').value;
  const days         = parseInt(document.getElementById('daysAhead').value) || 14;

  // Newer searches supersede older in-flight ones (live filters overlap);
  // stale fetch loops stop fetching/rendering as soon as the seq moves on.
  const mySeq = ++_searchSeq;
  const stale = () => window._searchAborted || mySeq !== _searchSeq;
  if (getBearerToken() && locations.length) _loadableSearchStarted = true;

  // Same rule as currentWindowDates() — a one-day range ends on its start day
  // — so this key always matches the one triggerAutoSearch compares against.
  const endDateStr = _windowEndDate(startDate, days, _dateQuickMode);

  const windowKey = startDate + '|' + endDateStr;
  const filters = { instructorId, locationIds, categoryKeys, startDate, endDateStr, strengthSubs: new Set(selectedStrengthSubs), reformerSubs: new Set(selectedReformerSubs) };

  // 1. In-memory window: studio/instructor/type filtering is entirely
  //    client-side, and so is any date range INSIDE the loaded window (Today /
  //    Tomorrow / a picked day within the week — render() bounds the days), so
  //    those re-render from the cached window instantly — no refetch, and the
  //    wider window is not thrown away for a one-day one. Numbers older than
  //    WINDOW_FRESH_MS are refreshed silently right after.
  if (!force && _windowCovers(startDate, endDateStr)) {
    renderFromWindow(filters);
    _revalidateIfStale();
    return;
  }

  // 2. Persistent window (cross-launch): on first load only (no in-memory
  //    window yet), hydrate instantly from a cache (<24h) that holds the
  //    selected range, under the CACHE's own key. The list is up with no
  //    spinner; a cache older than WINDOW_FRESH_MS is then revalidated in the
  //    background, so "spots left" is never hours old for long. A later date
  //    change outside the window has an in-memory window, so it falls through
  //    to a fetch for that range.
  if (!force && !window._windowEvents) {
    const cached = _readWindowCache();
    const plan = cached ? _cachePlan(cached.key, startDate, endDateStr) : null;
    if (plan === 'covers') {
      _setWindow(cached.key, cached.events, cached.relations, cached.fetchedAt);
      _buildFacetClasses(cached.events, cached.relations);
      renderFromWindow(filters);
      _revalidateIfStale();
      return;
    }
    if (plan === 'overlap') {
      // First open of the day: yesterday's week still holds all but the last
      // day of today's. Show those days now (in memory only, flagged partial
      // — never persisted) and fetch the real range behind them.
      const held = cached.events.filter(e => _dayInRange(e.start_at, startDate, endDateStr));
      if (held.length) {
        _setWindow(windowKey, held, cached.relations, cached.fetchedAt, true);
        // The key now claims days the cache never held. If the fetch behind
        // them fails (or never runs — offline), an empty day past this one is
        // "couldn't check", not "no classes" (_discoverEmptyContext).
        window._windowHeldEnd = _parseWindowKey(cached.key).end;
        _buildFacetClasses(held, cached.relations);
        revalidateWindow({ silent: true }); // first: an empty filtered list then reads "Checking…", not "No classes"
        renderFromWindow(filters);
        return;
      }
    }
  }

  // Reference data has not landed yet (a tap during a cold launch): there are
  // no studios to fetch, and the empty loop below used to answer "No classes
  // found". Say loading instead — the launch path searches as soon as
  // /locations is in (_loadableSearchStarted stays false for this run).
  if (!locations.length) {
    if (_refDataFailed) showInitError();
    else setStatus('<span class="spinner"></span>Loading studios…');
    return;
  }

  const btn = document.getElementById('searchBtn');
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Stop';
    btn.onclick = () => { window._searchAborted = true; };
  }
  window._searchAborted = false;

  _fetchingSeq = mySeq; // from here this run is the live loader (revalidateWindow defers to it)
  // A fetched list is one the member asked for: its cards animate in, whatever
  // the last background re-render left on the container (renderFromWindow).
  const resultsEl = document.getElementById('results');
  if (resultsEl) resultsEl.removeAttribute('data-quiet');
  setStatus('<span class="spinner"></span>Connecting…');

  let allEvents = [], relations = null;
  let studiosFailed = 0; // a window missing studios is shown, but never persisted
  const seenIds = new Set();

  // Always fetch the FULL window (every studio) so the faceted counts reflect
  // the complete timetable; the studio chips filter the displayed results
  // client-side. The window is cached so subsequent studio/instructor/type
  // changes don't refetch.
  const locationsToFetch = locations.filter(l => l.handle !== 'psycle-at-home');

  try {
    if (locationsToFetch.length === 1) {
      // Single location: stream page by page so results appear progressively
      const singleLocId = locationsToFetch[0].id;
      await (async () => {
        const limit = 200;
        let windowStart = startDate + ' 00:00:00';
        const windowEnd  = endDateStr + ' 23:59:59';
        while (true) {
          if (stale()) break;
          const params = new URLSearchParams({ start: windowStart, end: windowEnd, location: singleLocId, limit });
          const res = await apiFetch(`/events?${params}`).then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
          });
          const batch = res.data || [];
          const newEvents = batch.filter(e => !seenIds.has(e.id));
          if (newEvents.length === 0) break;
          newEvents.forEach(e => seenIds.add(e.id));
          allEvents = allEvents.concat(newEvents);
          if (!relations) relations = res.relations;
          else mergeRelations(relations, res.relations);
          const done = batch.length < limit;
          if (stale()) break;
          render(allEvents, relations, filters, done);
          if (done) break;
          windowStart = _nextEventsPageStart(batch); // overlaps by 1s; seenIds drops the repeats
        }
      })();
    } else {
      // All studios: fetch each location concurrently, merge as they arrive.
      // A single failing studio must not kill the whole search or leave the
      // "found so far…" spinner running forever — it still counts toward
      // completion and gets reported once everything settles.
      const total = locationsToFetch.length;
      let done = 0;
      const failedStudios = [];
      let firstErr = null;

      const promises = locationsToFetch.map(async loc => {
        try {
          const { events, relations: rel } = await fetchEventsForLocation(loc.id, startDate, endDateStr, seenIds, stale);
          if (stale()) return;
          allEvents = allEvents.concat(events);
          if (!relations) relations = rel;
          else if (rel) mergeRelations(relations, rel);
        } catch (e) {
          firstErr = firstErr || e;
          failedStudios.push(loc.name ? loc.name.replace('Psycle ', '') : String(loc.id));
        } finally {
          done++;
          if (!stale() && relations) render(allEvents, relations, filters, done === total);
        }
      });

      await Promise.all(promises);

      if (!stale() && failedStudios.length) {
        // Rethrow the REAL cause ('HTTP 503', a TypeError…): showSearchError can
        // only fall back to the last results for an error it can classify, and
        // the generic message below classified as nothing.
        if (failedStudios.length === total) throw firstErr || new Error('All studios failed to load');
        toast(`Couldn't load ${failedStudios.join(', ')} — showing the other studios`, 'info');
      }
      studiosFailed = failedStudios.length;
    }

    if (!stale()) {
      if (!relations) setStatus('No classes found.');
      else {
        // A window that lost a studio is flagged partial: it covers every
        // in-week date tap, and stamped complete + fresh it kept the studio
        // missing for 15 minutes after it had recovered. Partial is never
        // fresh, so the next render from it refetches quietly — a minute from
        // now at the earliest (the same back-off as a failed refresh).
        _setWindow(windowKey, allEvents, relations, 0, studiosFailed > 0);
        if (studiosFailed) _revalFailedAt = Date.now();
        // Missing studios must not become tomorrow's cached timetable.
        if (!studiosFailed) _persistWindow(windowKey, allEvents, relations);
        // Stamped like renderFromWindow does, BEFORE render() reads its own
        // clock: unstamped, the first resume after any fetched load rebuilt the
        // whole list although no class had started.
        _windowRenderedAt = Date.now();
        render(allEvents, relations, filters, true);
        _buildFacetClasses(allEvents, relations);
        renderLastUpdated();
      }
    }

  } catch (e) {
    if (!stale()) showSearchError(e);
  } finally {
    if (_fetchingSeq === mySeq) _fetchingSeq = 0;
    // Only the most recent search owns the button state. (btn is null in the
    // redesigned live-filter UI, which has no standalone Search button.)
    if (mySeq === _searchSeq) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Search';
        btn.onclick = () => search({ force: true });
      }
      if (window._searchAborted) {
        // Stopped by the user — never leave a live spinner behind.
        if (relations) render(allEvents, relations, filters, true);
        else setStatus(_errorStatusHTML('Search stopped.', 'Try again', 'search()'));
      }
    }
  }
}

// Friendly search-failure handling. For offline / server / network errors we
// fall back to the last cached results (if any) with a small banner, rather
// than wiping the screen with a bare error. Defensive — never throws.
function showSearchError(e) {
  let cat = { type: 'unknown', userMessage: 'Something went wrong — please try again.' };
  try {
    if (window.PsycleAPI && typeof window.PsycleAPI.categorizeError === 'function') {
      cat = window.PsycleAPI.categorizeError(e) || cat;
    }
  } catch (_) {}
  if (cat.type !== 'unknown' && cat.type !== 'auth') window._windowLoadError = cat.userMessage; // see _setWindow

  // Both retries below are FORCED. A search that fails over a provisional
  // window (the _runRevalidate handover lands here) leaves that window in
  // memory under today's key: a plain search() found the range "covered",
  // re-rendered the held days and sent nothing — the tap made no request and
  // swapped the server's message for "Couldn't check these dates".
  const canFallBack = cat.type === 'network' || cat.type === 'server' || cat.type === 'timeout';
  let cached = false;
  if (canFallBack) {
    try { cached = sessionStorage.getItem('psycle_last_results') != null && restoreLastResults(); }
    catch (_) { cached = false; }
  }

  if (cached) {
    // Prepend a non-destructive banner above the restored results.
    const container = document.getElementById('results');
    if (container && !container.querySelector('.stale-results-banner')) {
      const banner = document.createElement('div');
      banner.className = 'stale-results-banner';
      banner.textContent = "Showing your last results — couldn't reach Psycle ";
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'refresh-link';
      retry.textContent = 'Try again';
      retry.onclick = () => search({ force: true });
      banner.appendChild(retry);
      container.insertBefore(banner, container.firstChild);
    }
    return;
  }

  // The session ended (apiFetch → showSessionExpired has already cleared the
  // token): "Try again" would send the same request unauthenticated and land
  // back here. Gated on the token being GONE — a 403 classifies as auth too,
  // and the app treats that as a live session (Retry, never Sign in).
  if (cat.type === 'auth' && !getBearerToken()) {
    setStatus(_errorStatusHTML(cat.userMessage, 'Sign in', 'openLoginPopup()'));
    return;
  }

  setStatus(_errorStatusHTML(cat.userMessage || ('Error: ' + (e && e.message || 'Unknown error')), 'Try again', 'search({ force: true })'));
}

// An error line with its one way out — the old copy said "retry" with nothing
// to tap. `label` and `onclick` are fixed strings from this file, never data;
// the message is escaped here.
function _errorStatusHTML(message, label, onclick) {
  return `<span class="status-error">${escapeHTML(message)}</span>` +
    `<div class="empty-actions"><button type="button" class="empty-action primary" onclick="${onclick}">${label}</button></div>`;
}

// Reference data (/instructors, /locations, /event-types) failed at launch.
// Nothing can be searched without it and nothing re-requests it, so the one
// useful action is a reload. search() shows this again rather than a spinner
// that would never end.
let _refDataFailed = null; // the launch failure's message, once there was one
function showInitError(err) {
  if (err || !_refDataFailed) {
    let cat = { userMessage: 'Something went wrong — please try again.' };
    try {
      if (err && window.PsycleAPI && typeof window.PsycleAPI.categorizeError === 'function') {
        cat = window.PsycleAPI.categorizeError(err) || cat;
      }
    } catch (_) {}
    _refDataFailed = "Couldn't load Psycle's studios and instructors. " + cat.userMessage;
  }
  setStatus(_errorStatusHTML(_refDataFailed, 'Reload', 'location.reload()'));
}

// WHY the Discover list is empty, for theme.js's renderEmptyState (it draws
// the block: wrapRender flattens render()'s own .no-results div to its text,
// so buttons cannot ride along in it). `actions` are ids that renderEmptyState
// maps to its own fixed handlers — nothing returned here is markup.
function _discoverEmptyContext() {
  // A provisional window (yesterday's cache shown while today's range loads)
  // cannot say "no classes" yet: the days still missing may hold them.
  if (window._windowPartial && _revalInFlight) return { loading: true };
  // Before the first real search this is only restoreLastResults() repainting
  // LAST session's list for a moment: say nothing specific about today.
  if (!_loadableSearchStarted) return null;
  const sel = currentWindowDates();
  // …and once that fetch is over (it failed, or never ran — offline), the days
  // past what the adopted cache held were still never loaded: "no classes"
  // there would be a guess. Days it did hold (Today run dry) keep their copy
  // below. 'retry' is a plain search — it shows whatever studios answer, where
  // Refresh is all-or-nothing.
  if (window._windowPartial && window._windowHeldEnd && sel.endDateStr > window._windowHeldEnd) {
    // The server's own reason when the load did fail; the connection copy is
    // for a fetch that never ran (offline) or failed in a way nobody can name.
    return { title: "Couldn't check these dates", sub: window._windowLoadError || "The latest timetable didn't load — check your connection and try again.", actions: ['retry'] };
  }
  // Dates Psycle has not put on the timetable yet: empty because of that — not
  // for lack of classes, and whatever the filters say. By the OBSERVED release
  // model (pure:horizon — advisory): new dates appear on Mondays at 12:00 UK
  // time, a batch before they can be booked. No preset reaches that far (the
  // "Next week" preset has long been open by the Monday before it — the empty
  // state that said otherwise was wrong); a date picked in the calendar can.
  // (typeof: a suite runs this function on its own.)
  const listed = typeof _dayListedMs === 'function' ? _dayListedMs(sel.startDate) : null;
  if (listed && Date.now() < listed) {
    const opens = _dayOpensMs(sel.startDate);
    const when = opens ? new Date(opens).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) : '';
    // "usually": the date is the observed model's arithmetic, not Psycle's word
    // (some credit types book a batch early) — it explains, it never promises.
    return { title: 'Not on the timetable yet', sub: 'Psycle adds new dates on Mondays at 12:00 UK time.' + (when ? ' Booking for these usually opens ' + when + '.' : ''), actions: ['week'] };
  }
  const today = localDateStr();
  const filtered = selectedInstructors.size > 0 || selectedLocations.size > 0 ||
    selectedCategories.size > 0 || !!window._discoverQuery;
  // One line each from here on: the title IS the reason, and a sentence under
  // it could only say it again. (The two returns above keep theirs — a cause
  // and a time the title cannot carry.)
  if (filtered) {
    // render()'s own title stands: "No classes found for these filters."
    return { actions: ['clear'] };
  }
  if (sel.startDate === today && sel.endDateStr === today) {
    // render() drops started classes, so late in the day "Today" runs dry.
    return { title: 'No more classes today', actions: ['tomorrow', 'week'] };
  }
  // No filter to blame (render()'s title names "these filters"): say what is true.
  return { title: 'No classes on these dates', actions: _dateQuickMode === 'week' ? [] : ['week'] };
}

function mergeRelations(base, incoming) {
  if (!incoming) return;
  for (const key of Object.keys(incoming || {})) {
    const inc = incoming[key];
    if (!Array.isArray(inc)) continue;
    if (!Array.isArray(base[key])) { base[key] = inc; continue; }
    const existingIds = new Set(base[key].map(x => x.id));
    for (const item of inc) {
      if (!existingIds.has(item.id)) base[key].push(item);
    }
  }
}

// ── Booking ──────────────────────────────────────────────────────
const MAX_SEATS = 2;
// _bookingContext and _selectedSlots managed by state.js
// The usual bike the picker auto-selected, until the first tap: that tap
// REPLACES it (it was our guess, not the member's choice) rather than adding
// a second seat — and a second credit — to the booking.
let _usualPreselected = null;

// A token but no profile means the launch /profile call failed or hasn't
// landed — not that the member is signed out. One shared re-check for every
// Book tap that finds that state; /profile has no timeout of its own, so a
// deadline keeps the tap from hanging on '…'.
let _bookAuthRecheck = null;
function _recheckAuthForBooking() {
  if (!_bookAuthRecheck) {
    _bookAuthRecheck = Promise.resolve().then(() => checkAuth()).catch(() => {}).then(() => { _bookAuthRecheck = null; });
  }
  return Promise.race([_bookAuthRecheck, new Promise(r => setTimeout(r, 8000))]);
}

// The '…' busy label. A Discover card wraps its action by WIDTH (.cc-action in
// css/redesign.css), so swapping "Join Waitlist" for '…' and back un-wraps and
// re-wraps the card — every card below it jumps, up to four times per join.
// Hold the pill at the width it has until some other label is written. The
// exits that write one are many (and spread over the wrappers), so an observer
// releases the hold instead of each of them. Anything that is not a live card
// button — a detached one, My Bookings, a test stub — just gets the label.
function _busyLabel(btn) {
  const hold = !!btn.style && !btn.style.minWidth && typeof btn.closest === 'function' &&
    typeof MutationObserver === 'function' && !!btn.closest('.cc-action');
  if (hold) btn.style.minWidth = btn.offsetWidth + 'px';
  btn.textContent = '…';
  if (!hold) return;
  const mo = new MutationObserver(() => {
    if (btn.textContent === '…') return;
    btn.style.minWidth = '';
    mo.disconnect();
  });
  mo.observe(btn, { childList: true, characterData: true, subtree: true });
}

// ── pure:clash:start ── (DOM-free; tests/suites/clash.js evaluates this block)
// ── pure:clock:start ── (DOM-free; tests/suites/10a-time24.js evaluates this block)
// THE CLOCK. Every time the app prints or speaks is 24-hour "HH:MM", zero-
// padded — "06:30", "18:30", never "6:30pm" — and this is the ONE place that
// says so: cards, sheets, dialogs, toasts, announce() lines, the share image,
// and the other modules (js/tabs.js, js/features.js, js/reliability.js call
// these two as globals, the way they call _plural). tests/suites/10a-time24.js
// fails if a 12-hour marker comes back anywhere in shipped source. Nothing
// here parses a date or asks the device zone: the digits are the caller's — a
// class's own wall-clock digits (see Gym time), or the getters of a Date it
// already holds.
// The region ALSO answers to pure:class-type, pure:bookings-card,
// pure:day-pager and pure:offline (the markers around the two functions), so
// each of those blocks can still be evaluated on its own with the formatter in
// reach; and it sits at the head of pure:clash because several suites cut that
// block out by its FIRST marker. function declarations only (a suite may
// evaluate two of these blocks in one context).
// ── pure:class-type:start ──
// ── pure:bookings-card:start ──
// ── pure:day-pager:start ──
// ── pure:offline:start ──
// _clock24(18, 30) → "18:30" · _clock24(6, '05') → "06:05". Whole hours 0–23
// and minutes 0–59, as numbers or as one or two digits of text; anything else
// (NaN, null, '', 25, markup) → '' and the caller says what it prints instead.
function _clock24(hours, mins) {
  var part = function (v, max) {
    if (typeof v === 'string' && /^\s*\d{1,2}\s*$/.test(v)) v = Number(v);
    return (typeof v === 'number' && v >= 0 && v <= max) ? Math.floor(v) : -1;
  };
  var h = part(hours, 23), m = part(mins, 59);
  if (h < 0 || m < 0) return '';
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}

// The time of an API class time, cut from its DIGITS: '2026-09-21 18:30:00',
// the 'T' form, or a bare '18:30' → "18:30". Never through Date ('YYYY-MM-DD
// HH:MM:SS' is Invalid Date on iOS WebKit), never the device zone. '' when
// there is no time to read.
function _clockOf(startAt) {
  var m = /(?:^|[T ])(\d{2}):(\d{2})(?![\d])/.exec(String(startAt == null ? '' : startAt));
  return m ? _clock24(+m[1], +m[2]) : '';
}
// ── pure:offline:end ──
// ── pure:day-pager:end ──
// ── pure:bookings-card:end ──
// ── pure:class-type:end ──
// ── pure:clock:end ──

// Nothing stopped a member booking a 7:15 Ride at Bank while holding a 7:00 at
// Oxford Circus — they found out at the door, or paid a late-cancel fee to undo
// it. Every start_at is the same naive UK wall clock, so two classes compare
// exactly on their DIGITS: read by regex into minutes — never through
// new Date('YYYY-MM-DD HH:MM:SS') (Invalid Date on iOS WebKit), and never
// through the device zone. NaN when the time can't be read.
const CLASH_DEFAULT_MIN = 45; // a class that carries no duration
const CLASH_TRAVEL_MIN = 30;  // needed between two DIFFERENT locations
function _clashStartMin(startAt) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(startAt == null ? '' : startAt).trim());
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000 : NaN;
}

// The held SEAT `evt` collides with, or null. `bookings` is _myBookings, `cache`
// is _eventCache (start_at / duration / _locName of every held class). Skipped:
// waitlist places (no seat yet), the class itself, anything with no readable
// time. kind 'overlap' = the two share minutes — touching end-to-start does
// not count, back-to-back doubles are normal. kind 'travel' = they don't, but
// they are at different locations with under CLASH_TRAVEL_MIN between them
// (only when BOTH locations are known: a missing name must not invent one).
// An overlap outranks a travel squeeze; within a kind the earliest class wins.
// opts.includePlaces (opt-in — the headless sweep and the join dialog stay on
// seats): a waitlist place that truly OVERLAPS is reported too, flagged
// `place: true`. It is only a POSSIBLE seat — Psycle may turn it into a
// chargeable one — so a real seat always outranks it, and a travel squeeze
// with a place is not worth a word.
function _findClash(evt, bookings, cache, opts) {
  if (!evt) return null;
  const start = _clashStartMin(evt.start_at);
  if (isNaN(start)) return null;
  const end = start + (Number(evt.duration) || CLASH_DEFAULT_MIN);
  const selfId = evt.id == null ? '' : String(evt.id);
  const withPlaces = !!(opts && opts.includePlaces);
  let found = null;
  Object.keys(bookings || {}).forEach(id => {
    const held = bookings[id];
    if (!held || (held.waitlisted && !withPlaces) || String(id) === selfId) return;
    const other = (cache || {})[id];
    if (!other) return;
    const oStart = _clashStartMin(other.start_at);
    if (isNaN(oStart)) return;
    const oEnd = oStart + (Number(other.duration) || CLASH_DEFAULT_MIN);
    let kind = null;
    if (start < oEnd && oStart < end) kind = 'overlap';
    else if (evt._locName && other._locName && evt._locName !== other._locName &&
      start < oEnd + CLASH_TRAVEL_MIN && oStart < end + CLASH_TRAVEL_MIN) kind = 'travel';
    const place = !!held.waitlisted;
    if (!kind || (place && kind !== 'overlap')) return;
    const better = !found || (found.place && !place) || (found.place === place && (
      (kind === 'overlap' && found.kind !== 'overlap') ||
      (kind === found.kind && oStart < found.startMin)));
    if (!better) return;
    found = {
      eventId: String(id), kind, place, startMin: oStart,
      heldIsFirst: oStart < start,
      gapMin: kind === 'travel' ? (oStart >= end ? oStart - end : start - oEnd) : 0,
      start_at: other.start_at, typeName: other._typeName || '', locName: other._locName || '',
    };
  });
  return found;
}

// One member-facing sentence for a _findClash result, no trailing full stop
// (callers append their own copy). Names are API text: callers escape. The
// time ("07:00") is cut from the digits again (see _clashStartMin): _clockOf.
function _clashLabel(clash) {
  if (!clash) return '';
  const type = clash.typeName && clash.typeName !== 'Class' ? clash.typeName : 'class';
  const what = ['your', _clockOf(clash.start_at), type].filter(Boolean).join(' ') +
    (clash.locName ? ` at ${clash.locName}` : '');
  // A waitlist place is a possible seat, never a hard clash — and not "your" class yet.
  if (clash.place) return `You're also on the waitlist for ${what.replace(/^your /, 'the ')} — if Psycle books you in, you'd hold both`;
  if (clash.kind === 'overlap') return `Clashes with ${what}`;
  const squeeze = clash.heldIsFirst
    ? (clash.gapMin > 0 ? `Starts only ${clash.gapMin} min after ${what} ends` : `Starts as ${what} ends`)
    : (clash.gapMin > 0 ? `Ends only ${clash.gapMin} min before ${what} starts` : `Ends as ${what} starts`);
  return `${squeeze} — a different location`;
}
// ── pure:clash:end ──

// _findClash for a class about to be booked / joined / opened. `fresh` is the
// just-fetched /events/{id} data when the caller has it: its time wins over the
// cached copy (the names only exist in the cache). `opts` goes to _findClash:
// { includePlaces: true } where a held waitlist place is worth a mention too.
function _clashFor(eventId, fresh, opts) {
  const evt = Object.assign({}, _eventCache[String(eventId)] || {}, { id: eventId });
  if (fresh && !isNaN(_clashStartMin(fresh.start_at))) evt.start_at = fresh.start_at;
  if (fresh && Number(fresh.duration) > 0) evt.duration = fresh.duration;
  return _findClash(evt, _myBookings, _eventCache, opts);
}

// ── pure:book-fresh:start ── (DOM-free; tests/suites/3d-leftovers.js evaluates this block)
// bookClass has just read GET /events/{id}: keep what it says about
// availability. Written to the cache entry AND to the loaded window's copy of
// the event — render() spreads the window event over the cache on every
// background re-render, so a cache-only write was undone by the next one and a
// class just learned to be full read "Book" again. A flag this payload does
// not carry is left as it was. True when something changed.
// "Full" has a third copy: the lite facet view the chip counts read under
// "Available only" (`full`, see _buildFacetClasses) — left behind, the list
// and the counts beside it disagree about this class.
function _noteFreshAvailability(eventId, evtData) {
  if (!evtData || typeof evtData !== 'object') return false;
  const win = (typeof window !== 'undefined' && Array.isArray(window._windowEvents)) ? window._windowEvents : [];
  const targets = [_eventCache[String(eventId)], win.find(e => e && String(e.id) === String(eventId))];
  let changed = false;
  ['is_fully_booked', 'is_waitlistable'].forEach(flag => {
    if (typeof evtData[flag] !== 'boolean') return;
    targets.forEach(target => {
      if (target && target[flag] !== evtData[flag]) { target[flag] = evtData[flag]; changed = true; }
    });
  });
  const facets = (typeof window !== 'undefined' && Array.isArray(window._facetClasses)) ? window._facetClasses : [];
  const facet = facets.find(c => c && c.id === String(eventId));
  if (facet && typeof evtData.is_fully_booked === 'boolean' && facet.full !== evtData.is_fully_booked) {
    facet.full = evtData.is_fully_booked;
    changed = true;
  }
  return changed;
}

// The studio's seat map out of a GET /events/{id} answer. It rides on the
// studio record in `relations` (what _hydrateEventDetails copies into
// _studioMap); the other places are tolerated in case the envelope differs.
// Only a map with seats in it counts.
function _layoutFromEventDetail(detail, studioId) {
  if (!detail || typeof detail !== 'object') return null;
  const data = (detail.data && typeof detail.data === 'object') ? detail.data : {};
  const studios = (detail.relations && Array.isArray(detail.relations.studios)) ? detail.relations.studios : [];
  const rel = studios.find(s => s && String(s.id) === String(studioId));
  return [rel && rel.layout, data.studio && data.studio.layout, data.layout, detail.layout]
    .find(l => !!l && Array.isArray(l.slots) && l.slots.length > 0) || null;
}

// The studio's own record out of the same answer, for a class whose studio
// nothing has put on _studioMap yet. The one the class itself names first: the
// id the caller holds can come from the saved class details, and a class moves
// rooms. Only a record that SAYS whether it has a seat map counts — that flag
// is what decides between the picker and the count body.
function _studioFromEventDetail(detail, studioId) {
  if (!detail || typeof detail !== 'object') return null;
  const data = (detail.data && typeof detail.data === 'object') ? detail.data : {};
  const studios = (detail.relations && Array.isArray(detail.relations.studios)) ? detail.relations.studios : [];
  const byId = id => (id == null ? null : studios.find(s => s && s.id != null && String(s.id) === String(id)));
  const rel = byId(data.studio_id) || byId(studioId);
  return (rel && typeof rel.has_layout === 'boolean') ? rel : null;
}
// ── pure:book-fresh:end ──

async function bookClass(eventId, btn, studioId) {
  // Not only an unverified session: until a /bookings snapshot has been applied
  // ('pending' at launch, 'failed' after it) every card reads "Book", held
  // classes included — and that stays true on the retry the toast below asks for.
  if (!currentUser || _bookingsLoadState !== 'loaded') {
    // Signed out: a member-facing prompt. (The token-paste dialog this used to
    // open is a developer tool and reads like one.)
    if (!getBearerToken()) {
      const signIn = await confirmModal({
        title: 'Sign in to book',
        body: 'Sign in with your Psycle account to book this class.',
        confirmText: 'Sign in',
        cancelText: 'Not now',
      });
      if (signIn) openLoginPopup();
      return;
    }
    if (btn.dataset.busy === '1') return;
    btn.dataset.busy = '1';
    const idleLabel = btn.textContent;
    const heldBefore = !!_myBookings[String(eventId)];
    btn.disabled = true;
    _busyLabel(btn);
    // A healed check only STARTS the bookings fetch (checkAuth doesn't await
    // it), and an unverified session never loaded them — so every card reads
    // "Book", held classes included. Carrying on now would offer a class the
    // member already holds as a fresh booking: a second, chargeable seat. Wait
    // for a /bookings snapshot that was really applied, still on '…'.
    let bookingsLoaded = false;
    try {
      if (!currentUser) await _recheckAuthForBooking();
      if (currentUser) bookingsLoaded = await _rereadBookingsForVerify();
    } finally { delete btn.dataset.busy; btn.disabled = false; btn.textContent = idleLabel; }
    if (!currentUser) {
      // No token left = checkAuth just expired the session and said so itself.
      if (getBearerToken()) toast("Can't reach Psycle right now — try again", 'error');
      return;
    }
    if (!bookingsLoaded) {
      if (getBearerToken()) toast("Couldn't load your bookings — try again", 'error');
      return;
    }
    // The tap was on a card that didn't know about this booking: show it rather
    // than walking a stale "Book" into a booking flow. Tapping again manages it.
    const heldNow = _myBookings[String(eventId)];
    if (heldNow && !heldBefore) {
      applyBookedState(btn, eventId, heldNow);
      toast(heldNow.waitlisted ? "You're already on the waitlist for this class" : "You're already booked into this class", 'info');
      return;
    }
  }

  // Feature: token-expiry guard. Warn BEFORE the event fetch / booking so the
  // user can refresh their session rather than have checkout fail mid-flow.
  if (typeof isTokenExpiringSoon === 'function' && isTokenExpiringSoon()) {
    const reauth = await confirmModal({
      title: 'Session expiring',
      body: 'Your Psycle session is about to expire and booking may fail. Sign in again first?',
      confirmText: 'Sign in',
      cancelText: 'Book anyway',
    });
    if (reauth) {
      openLoginPopup();
      return;
    }
  }

  // Double-tap guard: a second tap while the event fetch is in flight
  // would run the whole flow (and potentially the booking) twice.
  if (btn.dataset.busy === '1') return;
  btn.dataset.busy = '1';

  // Latest tap wins. The guard above is per BUTTON: with Psycle slow, a Book
  // tap on a second card runs alongside this one, and whichever GET landed
  // LAST used to take over the picker — the class tapped FIRST, its usual bike
  // pre-selected and Confirm live under the member's thumb. Asked after every
  // await on the way to a picker or a confirm. A picker somebody else opened
  // meanwhile (Change spot never comes through here) is not replaced either —
  // judged by what is on screen, so a picker that failed to open can't leave
  // every later tap "overtaken". (A property and a typeof rather than module
  // state: the suites run bookClass on its own.)
  const tapLabel = btn.textContent;
  const mySeq = bookClass._seq = (bookClass._seq || 0) + 1;
  const overtaken = () => {
    if (mySeq !== bookClass._seq) return true;
    if (typeof _bookingContext === 'undefined' || !_bookingContext) return false;
    const picker = document.getElementById('bikeModal');
    return !!(picker && picker.style.display && picker.style.display !== 'none');
  };
  // Hand the button back as it was, no flow having run: a held class reads as
  // held again (never "Book"); anything else gets the label it was tapped on
  // ("+ Add spot" and the sheet's detached button are not card buttons).
  const putBack = () => {
    btn.disabled = false;
    const held = _myBookings[String(eventId)];
    if (held && btn.classList && btn.classList.contains('book-btn')) applyBookedState(btn, eventId, held);
    else btn.textContent = tapLabel;
  };

  // Already holding a waitlist place (no seat): the only sensible action is
  // managing that place — never the bike picker or a second join (Psycle
  // allows one place per person per class).
  if (_myBookings[String(eventId)]?.waitlisted) {
    try { await leaveWaitlist(eventId, btn); } finally { delete btn.dataset.busy; }
    return;
  }

  btn.disabled = true;
  _busyLabel(btn);

  try {
    // An earlier attempt on this class may have booked without us hearing back:
    // find out BEFORE offering the picker again (submitBooking re-checks too).
    if (!(await _clearUnverifiedBooking(eventId, btn))) return;
    if (overtaken()) { putBack(); return; }
    // retries:1 — the default three keep a tap on '…' for over a minute.
    const res = await apiFetch(`/events/${eventId}`, { retries: 1 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const detail = await res.json();
    if (overtaken()) { putBack(); return; }
    // detail.slots = AVAILABLE (bookable) slot IDs
    const availableSlotIds = new Set((detail.slots || []).map(Number));

    const evtData = detail.data || {};
    const cached = _eventCache[String(eventId)] || {};
    const isFullyBooked = evtData.is_fully_booked ?? cached.is_fully_booked;
    const isWaitlistable = evtData.is_waitlistable ?? cached.is_waitlistable;
    const myBooking = _myBookings[String(eventId)];
    // The list keeps what was just learned, and every card of this class says
    // so now. (typeof: the suites run bookClass on its own.)
    if (typeof _noteFreshAvailability === 'function' && _noteFreshAvailability(eventId, evtData) &&
        typeof _syncCardButtonsForEvent === 'function') _syncCardButtonsForEvent(eventId);

    // A seat already held at this time: said inside the confirms / picker below
    // rather than as one more gate — the member may well mean it. Advisory, so
    // nothing that goes wrong reading the cache may stop the booking.
    let clashLine = '';
    try { clashLine = _clashLabel(_clashFor(eventId, evtData)); } catch (e) {}
    // BOOKING a seat is also where a waitlist PLACE at this time matters —
    // Psycle may book the member into that one as well. The booking confirms
    // and the picker get the places-aware line (a real seat still outranks a
    // place); joining a waitlist keeps the seats-only one.
    let bookClashLine = clashLine;
    try { bookClashLine = _clashLabel(_clashFor(eventId, evtData, { includePlaces: true })); } catch (e) {}

    let studio = _studioMap[studioId];
    // Nothing has put this class's studio on _studioMap yet: "+ Add spot" on a
    // My Bookings card painted from the saved class details gets here before
    // any list or detail read has. The answer just read carries the studio's
    // own record — use it, and keep it (under ITS id: the saved one can be old).
    if ((!studio || typeof studio.has_layout !== 'boolean') && typeof _studioFromEventDetail === 'function') {
      const rel = _studioFromEventDetail(detail, studioId);
      if (rel) { studioId = rel.id; studio = _studioMap[rel.id] = rel; }
    }
    let layout = studio?.layout;
    // The cached studio record can be without its seat map (a list response's
    // relations don't always carry one, and render() replaces the record with
    // theirs): take it from the detail just read, and keep it.
    if (studio?.has_layout && !(layout?.slots?.length > 0) && typeof _layoutFromEventDetail === 'function') {
      layout = _layoutFromEventDetail(detail, studioId);
      if (layout) studio.layout = layout;
    }
    const hasLayout = studio?.has_layout && layout?.slots?.length > 0;

    // Full class and we're not in it → waitlist path (a separate resource:
    // PUT /waitlists/{eventId}). There's no seat to pick, so never open the
    // bike picker here.
    const noSeatsLeft = isFullyBooked || (hasLayout && availableSlotIds.size === 0);
    if (noSeatsLeft && !myBooking) {
      btn.disabled = false;
      if (typeof _dropCardCounts === 'function') _dropCardCounts(eventId);
      if (!isWaitlistable) {
        btn.textContent = 'Full';
        toast('This class is full', 'info');
        return;
      }
      btn.textContent = 'Join Waitlist';
      await confirmJoinWaitlist(eventId, btn, clashLine);
      return;
    }

    // Feature: skip the bike picker when only one seat is left and the user
    // isn't already booked — there's nothing to choose, so confirm directly.
    if (hasLayout && availableSlotIds.size === 1 && !myBooking) {
      btn.disabled = false;
      btn.textContent = 'Book';
      const onlySlotId = [...availableSlotIds][0];
      const SL = slotLabelForEvent(eventId);
      // Prefer the slot's display label from the layout (may differ from its id)
      const onlySlot = (layout.slots || []).find(s => Number(s.id) === onlySlotId);
      const slotN = onlySlot ? (onlySlot.label ?? onlySlot.id) : onlySlotId;
      const ok = await confirmModal({
        title: 'Book this spot?',
        body: `Only ${SL} ${slotN} is left — book it?`,
        warn: (bookClashLine ? bookClashLine + '. ' : '') + "Psycle's normal 12-hour cancellation policy applies.",
        confirmText: 'Book it',
        cancelText: 'Not now',
      });
      if (ok) {
        await submitBooking(eventId, [onlySlotId], btn);
      } else {
        btn.disabled = false;
        btn.textContent = 'Book';
      }
      return;
    }

    // A studio WITH a seat map, and no map to be had: there is no picker to
    // open, and the confirm below books by COUNT — for has_layout === false
    // only (Psycle turns a seat studio's slot-less body down: "Booking slot
    // required"). Say so instead of offering a booking that cannot go through.
    // A studio that could not be resolved at all ends here too: the confirm
    // below used to be offered for it, and then posted no slots and no count.
    if (!hasLayout && !(studio && studio.has_layout === false)) {
      btn.disabled = false;
      // "+ Add spot" is not a card button: it gets its own label back, never
      // the card's "Bike 7 ✓" styling.
      if (btn.classList && !btn.classList.contains('book-btn')) btn.textContent = tapLabel;
      else if (myBooking && (myBooking.bookingId || (myBooking.slots || []).length)) applyBookedState(btn, eventId, myBooking);
      else btn.textContent = 'Book';
      toast("Couldn't load the studio map — try again", 'error');
      return;
    }

    if (hasLayout) {
      btn.disabled = false;
      btn.textContent = 'Book';
      // A class already held keeps reading as held behind the picker — nothing
      // restores the card when the picker is simply closed again.
      if (myBooking) putBack();
      let mySlots = new Set((_myBookings[String(eventId)]?.slots || []).map(Number));
      // If we know there's a booking but no slot IDs cached, fetch the booking detail
      if (_myBookings[String(eventId)] && mySlots.size === 0) {
        const bId = _myBookings[String(eventId)]?.bookingId;
        if (bId) {
          try {
            const bRes = await apiFetch(`/bookings/${bId}`);
            if (bRes.ok) {
              const bData = await bRes.json();
              const bDetail = bData.data || bData;
              const resolvedSlots = _parseSlots(bDetail.slots || bDetail.slot_ids || (bDetail.slot_id != null ? [bDetail.slot_id] : []));
              if (resolvedSlots.length) {
                _myBookings[String(eventId)].slots = resolvedSlots;
                mySlots = new Set(resolvedSlots);
              }
            }
          } catch {}
        }
      }
      if (overtaken()) { putBack(); return; }
      showBikePicker(eventId, btn, layout, availableSlotIds, mySlots, studio.name, { clashLine: bookClashLine });
    } else {
      // No layout: book one space — after the same explicit confirm every
      // other credit-spending path has (there's no picker step here). Only
      // send the count when the studio is positively known to be layout-less.
      const heldAlready = !!(myBooking && (myBooking.bookingId || (myBooking.slots || []).length));
      const line = _waitlistClassLine(eventId);
      const ok = await confirmModal({
        title: heldAlready ? 'Book another space?' : 'Book this class?',
        body: heldAlready
          ? `${line ? line + '. ' : ''}You already hold a space in this class — this books (and pays for) one more.`
          : (line ? `${line}. This uses one class credit.` : 'This uses one class credit.'),
        warn: (bookClashLine ? bookClashLine + '. ' : '') + "Psycle's normal 12-hour cancellation policy applies.",
        confirmText: heldAlready ? 'Book one more' : 'Book it',
        cancelText: 'Not now',
      });
      if (!ok) {
        btn.disabled = false;
        // As above: "+ Add spot" is not a card button. "Not now" left it
        // reading "Booked ✓", in the card's booked styling, under "Cancel booking".
        if (btn.classList && !btn.classList.contains('book-btn')) btn.textContent = tapLabel;
        else if (heldAlready) applyBookedState(btn, eventId, myBooking);
        else btn.textContent = 'Book';
        return;
      }
      await submitBooking(eventId, null, btn, studio && studio.has_layout === false ? { spaces: 1 } : {});
    }
  } catch (e) {
    putBack();
    // Never the raw "Load failed" / "HTTP 503". An overtaken tap fails quietly:
    // its toast would land on the class the member has moved on to.
    if (!overtaken()) toast(_friendlyError(e, "Couldn't open this class — try again"), 'error');
  } finally {
    delete btn.dataset.busy;
  }
}

// ── pure:sheets:start ── (DOM-free; tests/suites/9c-sheets.js evaluates these blocks)
// Crisp Colour sheets, picker and dialogs: the small decisions their markup
// rests on. (The class pictograms are pure:class-type, further up.)

// Line marks for a sheet row or a menu option — the pictograms' family: 24
// grid, round caps and joins, currentColor, decorative (the row says it in
// words). Never an emoji. An unknown name draws nothing, and nothing
// caller-supplied reaches the markup.
var UI_ICONS = {
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  // The caution mark of every advisory line (a clash, a dialog's warn text): a
  // ringed "!" — css/crisp.css inks it in the theme's caution colour, the
  // sentence beside it stays in the body ink. The dot is a zero-length stroke.
  caution: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.5"/><path d="M12 16.4v.01"/>',
  spots: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c0-3 2.4-5 5.5-5s5.5 2 5.5 5"/><circle cx="17.5" cy="9.5" r="2.3"/><path d="M17.5 14.2c1.9.4 3 1.9 3 4.3"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17"/><path d="M8 3v4"/><path d="M16 3v4"/>',
  person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.6 3-6 7-6s7 2.4 7 6"/>',
  again: '<path d="M19 12a7 7 0 1 1-2.1-5"/><path d="M19 4.5V8h-3.5"/>',
  tick: '<path d="M5.5 12.5l4.5 4.5 8.5-9.5"/>',
};
function _uiIcon(name, size) {
  var k = String(name == null ? '' : name);
  if (!Object.prototype.hasOwnProperty.call(UI_ICONS, k)) return '';
  var px = Math.round(Number(size));
  if (!(px >= 8 && px <= 96)) px = 19;
  return '<svg class="ui-icon" width="' + px + '" height="' + px + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' +
    (k === 'tick' ? 3 : 2) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + UI_ICONS[k] + '</svg>';
}

// What the sheet says beside its Book button: what this booking uses, and what
// is left — or null, because it only says what Psycle's own numbers can back:
//   · a capped plan counts classes PER BILLING PERIOD, so "N left this month"
//     is printed only for a class inside the period /profile is counting
//     (the same split My Bookings draws); for a later class, the use alone.
//     The period is NAMED from its own length (_mbPeriodWord, the word My
//     Bookings' usage line uses): a weekly plan reads "2 left this week", never
//     "this month", and a length that is neither says "this period";
//   · an unlimited plan has nothing to run out of: no note;
//   · no plan: the credit balance, when there is one.
// `f`: { subscription, classMs, periodStartMs, periodEndMs, creditsRemaining }.
function _sheetPlanNote(f) {
  f = f || {};
  var sub = f.subscription;
  if (sub && typeof sub === 'object') {
    var max = Number(sub.max_bookings);
    if (!(max > 0)) return null;
    var made = Math.max(0, Number(sub.bookings_made) || 0);
    var inPeriod = f.classMs >= 0 && f.periodEndMs > 0 && f.classMs < f.periodEndMs &&
      !(f.periodStartMs > 0 && f.classMs < f.periodStartMs);
    if (!inPeriod) return { main: '1 class', sub: '' };
    var left = Math.max(0, Math.round(max - made));
    var word = _mbPeriodWord(f.periodStartMs, f.periodEndMs);
    return { main: '1 class', sub: left === 0 ? 'None left this ' + word : left + ' left this ' + word };
  }
  var credits = Math.floor(Number(f.creditsRemaining));
  if (credits > 0) return { main: '1 credit', sub: credits + ' left' };
  return null;
}

// The picker's confirm button says what it will book: "Book bike 12",
// "Book benches 3 & 4" — and plain "Book" (disabled) while nothing is picked.
// A swap words its own button (changeSpot / executeSpotSwap). `verb`: the
// choose-only picker (the usual-week sheet's "Change spot") books nothing, and
// says so — "Use bike 12".
function _pickerConfirmLabel(slotWord, selected, verb) {
  var list = Array.isArray(selected) ? selected : [];
  var does = verb === 'Use' ? 'Use' : 'Book';
  if (!list.length) return does;
  var word = String(slotWord || 'Spot').toLowerCase();
  if (list.length > 1) word = /^bench$/.test(word) ? 'benches' : word + 's';
  return does + ' ' + word + ' ' + _seatList(list);
}

// "3 & 4", "3, 4 & 5" — as formatSlots lists the same seats everywhere else.
function _seatList(list) {
  return list.length > 2 ? list.slice(0, -1).join(', ') + ' & ' + list[list.length - 1] : list.join(' & ');
}

// The choose-only picker's hint: how many spots the sheet's row asks for, and
// how many are picked. The confirm button is live only at exactly `count`.
function _chooseSpotHint(slotWord, count, selected) {
  var list = Array.isArray(selected) ? selected : [];
  var n = Math.max(1, Math.floor(Number(count)) || 1);
  var word = String(slotWord || 'Spot');
  var plural = function (w) { return /^bench$/i.test(w) ? w + 'es' : w + 's'; }; // as pluralizeSlotLabel
  var one = word.toLowerCase();
  if (!list.length) return n === 1 ? 'Tap the ' + one + ' you want' : 'Pick ' + n + ' ' + plural(one);
  var picked = (list.length === 1 ? word : plural(word)) + ' ' + _seatList(list) + ' selected';
  if (list.length < n) return picked + ' — pick ' + (n - list.length) + ' more';
  return picked + ' — tap another to switch';
}
// ── pure:sheets:end ──

function showBikePicker(eventId, btn, layout, availableSlotIds, mySlotIds, studioName, opts) {
  _bookingContext = { eventId, btn };
  _selectedSlots = [];
  _usualPreselected = null;
  // CHOOSE-ONLY MODE — opts.choose = { count, preselect: [ids], done(ids | null) }:
  // the usual-week sheet's "Change spot". The REAL seat map, but it BOOKS
  // NOTHING: its confirm reads "Use bike 12" and hands the chosen ids back to
  // the sheet (confirmSpotChoice); closing it any other way answers done(null)
  // — no change. On window, like _changeSpotContext, because selectBike,
  // closeBikePicker and confirmBikeBooking all have to know. A chooser still
  // waiting when another picker opens is answered "no change" first.
  const _prevChoose = window._chooseSpotContext;
  const _choose = (opts && opts.choose && typeof opts.choose.done === 'function') ? {
    count: Math.max(1, Math.min(4, Math.floor(Number(opts.choose.count)) || 1)),
    preselect: (Array.isArray(opts.choose.preselect) ? opts.choose.preselect : []).map(Number).filter(n => Number.isFinite(n)),
    done: opts.choose.done,
  } : null;
  window._chooseSpotContext = _choose;
  if (_prevChoose && typeof _prevChoose.done === 'function') { try { _prevChoose.done(null); } catch (e) {} }

  const hasMySlots = mySlotIds.size > 0;
  const _sl = slotLabelForEvent(eventId).toLowerCase();
  const _SL = slotLabelForEvent(eventId);
  document.getElementById('modalTitle').textContent = hasMySlots ? 'Your booking' : `Select your ${pluralizeSlotLabel(_sl)}`;

  // Feature 4: Enhanced class summary header
  const _evt = _eventCache[String(eventId)];
  // Crisp Colour: the sheet wears the colour of the class being booked —
  // css/crisp.css reads data-ct for the header tint, your seats and the confirm
  // pill; the tile shows its pictogram. (typeof: the suites run this function
  // on its own. #modalTile is in the page; a cached older shell goes without.)
  const _ctKey = typeof classTypeKey === 'function' ? classTypeKey(_evt && _evt._typeName) : 'other';
  document.getElementById('bikeModal').setAttribute('data-ct', _ctKey);
  const _tileEl = document.getElementById('modalTile');
  if (_tileEl && typeof classPictogram === 'function') _tileEl.innerHTML = classPictogram(_ctKey, 20);
  if (_evt) {
    const _d = new Date(_evt.start_at);
    const _days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const _months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const _timeStr = _clock24(_d.getHours(), _d.getMinutes());
    const _dateStr = `${_days[_d.getDay()]} ${_d.getDate()} ${_months[_d.getMonth()]}`;
    const line1 = [_evt._typeName, _evt._instrName, `${_dateStr}, ${_timeStr}`].filter(Boolean).join(' \u00b7 ');
    const line2 = [_evt._locName, _evt._studioName].filter(Boolean).join(' \u00b7 ');
    const sub = document.getElementById('modalSubtitle');
    sub.innerHTML = `<span class="modal-subtitle-line">${escapeHTML(line1)}</span><br><span class="modal-subtitle-line">${escapeHTML(line2)}</span>`;
  } else {
    document.getElementById('modalSubtitle').textContent = studioName;
  }
  // A seat already held at this time (bookClass read it off the fresh event).
  // In the header because #modalHint is rewritten on every tap; never in a
  // swap — that is a class the member already holds. The subtitle is rebuilt
  // above on every open, so no earlier class's line can linger.
  const _swapOpen = !!window._changeSpotContext;
  if (!_swapOpen && opts && opts.clashLine) {
    // ONE quiet line, as on the class sheet and in the dialogs: the caution mark
    // (our own static markup) and the sentence in the header's ink.
    const _clashEl = document.createElement('span');
    _clashEl.className = 'modal-clash';
    _clashEl.innerHTML = typeof _uiIcon === 'function' ? _uiIcon('caution', 16) : '';
    const _clashText = document.createElement('span');
    _clashText.textContent = opts.clashLine; // class / studio names are API text
    _clashEl.appendChild(_clashText);
    document.getElementById('modalSubtitle').appendChild(_clashEl);
  }

  // Says what to tap, and counts: "Your bikes highlighted" was plural for one.
  document.getElementById('modalHint').textContent = hasMySlots
    ? (mySlotIds.size === 1
      ? `Tap ${_SL} ${[...mySlotIds][0]} to cancel it, or pick another ${_sl} to add one`
      : `Tap a highlighted ${_sl} to cancel it`)
    : `Select up to ${MAX_SEATS} ${pluralizeSlotLabel(_sl)}`;
  // When cancelling stops being free — the same _cancelDeadline as the card,
  // the confirmation sheet and the cancel dialog, so the four can't disagree.
  // Its OWN element under the hint: selectBike, the usual-bike pre-select and
  // renderChangeSpotHint all overwrite #modalHint. Built here rather than in
  // the page so a cached older shell still gets it. Hidden in a swap (the seat
  // is already paid for, and changeSpot refuses inside the window anyway).
  let _policyEl = document.getElementById('modalPolicy');
  if (!_policyEl) {
    _policyEl = document.createElement('div');
    _policyEl.id = 'modalPolicy';
    document.getElementById('modalHint').insertAdjacentElement('afterend', _policyEl);
  }
  const _deadline = (!_swapOpen && _evt) ? _cancelDeadline(_evt.start_at) : null;
  // late-cancel-note: the ONE class the late-cancel message wears wherever it
  // appears (here, the My Bookings badge, the Booked! sheet, the cancel dialog).
  _policyEl.className = 'modal-policy' + (_deadline && _deadline.insideWindow ? ' is-late late-cancel-note' : '');
  _policyEl.textContent = !_deadline ? ''
    : (_deadline.insideWindow
      ? 'Inside the 12-hour late-cancel window — cancelling is usually charged'
      : `Cancel by ${_deadline.label} to avoid a late-cancel charge`);
  _policyEl.style.display = _deadline ? '' : 'none';
  // Fully reset the confirm button on every open — changeSpot() overrides the
  // label and handler for swap mode, and without this reset those overrides
  // (and a stale "Swapping..." label) would leak into later normal bookings.
  const _confirmBtn = document.getElementById('confirmBookBtn');
  _confirmBtn.disabled = true;
  _confirmBtn.textContent = 'Book'; // names the seat once one is picked — _syncPickerConfirmLabel
  _confirmBtn.onclick = confirmBikeBooking;
  // The dismiss button only ever closes the sheet. Under "Your booking" (or a
  // swap) a button reading "Cancel" looks like "cancel the booking": a member
  // could walk away believing the class was cancelled — or not dare close the
  // sheet. Set on every open, both ways; found by position because the page
  // gives it no id (so a cached older shell is covered too).
  const _dismissBtn = document.querySelector('#bikeModal .modal-actions .btn-ghost');
  if (_dismissBtn) _dismissBtn.textContent = (hasMySlots || _swapOpen) ? 'Close' : 'Cancel';

  const slots = layout.slots;
  const objects = layout.objects || [];
  const allX = slots.map(s => s.x).concat(objects.map(o => o.x));
  const allY = slots.map(s => s.y).concat(objects.map(o => o.y));
  const minX = Math.min(...allX), maxX = Math.max(...allX);
  const minY = Math.min(...allY), maxY = Math.max(...allY);
  const SLOT = 40, PAD = 24;
  const rangeX = maxX - minX || 1, rangeY = maxY - minY || 1;
  const svgW = Math.min(580, Math.max(300, slots.length * 24));
  const svgH = Math.round(svgW * (rangeY / rangeX)) + PAD * 2;
  const sx = x => PAD + ((x - minX) / rangeX) * (svgW - PAD * 2 - SLOT);
  const sy = y => PAD + ((y - minY) / rangeY) * (Math.max(120, svgH) - PAD * 2 - SLOT);

  const svg = document.getElementById('bikeSvg');
  const h = Math.max(120, svgH);
  svg.setAttribute('width', svgW);
  svg.setAttribute('height', h);
  svg.setAttribute('viewBox', `0 0 ${svgW} ${h}`);
  // Scale with the sheet instead of forcing a fixed 580px into a ~290px phone
  // box (the viewBox keeps the geometry, so settings.js's pref dots still
  // land). max-width stops a small studio upscaling on desktop; min-width
  // keeps slots tappable — past that the wrap scrolls (centred below).
  svg.style.cssText = `width:100%;height:auto;max-width:${svgW}px;min-width:${Math.min(svgW, 420)}px`;

  // Podium/object colours come from theme tokens (.bike-object in styles.css).
  let inner = objects.map(obj =>
    `<rect class="bike-object" x="${sx(obj.x)}" y="${sy(obj.y)}" width="${SLOT}" height="${SLOT}"
      rx="4" stroke-dasharray="3,3"/>
    <text class="bike-object-mark" x="${sx(obj.x)+SLOT/2}" y="${sy(obj.y)+SLOT/2+4}" text-anchor="middle"
      font-size="9" font-family="sans-serif">★</text>`
  ).join('');

  // Feature: pre-select the user's "usual" slot for this studio+instructor.
  // Only for a fresh booking (no existing slots) and not during a spot swap.
  const isChangeSpot = !!window._changeSpotContext;
  const usualSlot = (!hasMySlots && !isChangeSpot) ? _usualSlotForEvent(eventId) : null;
  const usualAvailable = usualSlot != null && availableSlotIds.has(Number(usualSlot));

  inner += slots.map(slot => {
    const id = Number(slot.id);
    const isMine = mySlotIds.has(id);
    const isAvailable = availableSlotIds.has(id);
    const isUsual = usualAvailable && id === Number(usualSlot);
    const label = slot.label ?? slot.id;
    const cls = isMine ? 'mine' : isUsual ? 'selected usual' : isAvailable ? 'available' : 'taken';
    // In swap mode a tap on your own seat retargets which seat to change —
    // it must never be a live cancel button there.
    // Layout ids and labels are API text (a label is free text in Psycle's
    // layout editor): only the NUMBER goes into a handler or attribute, and the
    // label is escaped — this string becomes innerHTML.
    const click = isMine
      ? (isChangeSpot ? `onclick="setChangeSpotTarget(${id})"` : `onclick="cancelBikeSlot(${id}, ${Number(eventId)})"`)
      : isAvailable ? `onclick="selectBike(${id})"` : '';
    // Crisp Colour: a seat is a full circle (rx = half the tile; css/crisp.css
    // then sets rx from --radius-full, which Handheld zeroes — square there),
    // its number centred by the baseline, not by a font-size-dependent nudge.
    // One small mark at the top-right tells a seat apart without colour: a ring
    // on your usual, a tick on a seat you hold. Each is drawn once, here, and
    // shown by CSS from the seat's own classes — cancelBikeSlot turns `mine`
    // into `available` on the live node and the tick goes with it. Numbers only.
    const mx = sx(slot.x) + SLOT - 6, my = sy(slot.y) + 6;
    const mark = isUsual ? `<circle class="seat-mark seat-mark-usual" cx="${mx}" cy="${my}" r="4.5"/>`
      : isMine ? `<g class="seat-mark seat-mark-mine"><circle cx="${mx}" cy="${my}" r="6.5"/><path d="M${mx - 3} ${my + 0.4}l2.2 2.2 3.8-4.4"/></g>`
      : '';
    return `<g class="bike-slot ${cls}" data-slot="${id}" ${click}>
      <rect x="${sx(slot.x)}" y="${sy(slot.y)}" width="${SLOT}" height="${SLOT}" rx="${SLOT / 2}" stroke-width="1.5"/>
      <text x="${sx(slot.x)+SLOT/2}" y="${sy(slot.y)+SLOT/2}" dominant-baseline="central"
        text-anchor="middle" font-family="sans-serif" font-size="15">${escapeHTML(label)}</text>${mark}
    </g>`;
  }).join('');

  svg.innerHTML = inner;
  // Which legend entries this map needs (css/crisp.css hides the other two).
  const _pickerEl = document.getElementById('bikeModal');
  _pickerEl.setAttribute('data-held', hasMySlots ? '1' : '0');
  _pickerEl.setAttribute('data-usual', usualAvailable ? '1' : '0');
  _pickerEl.style.display = 'flex';

  // Where the map still overflows (small phones), open on the seat that
  // matters — the usual bike, a seat already held, else the first free one —
  // not on the left edge with no sign there is more. Measured after display.
  const wrap = svg.parentElement;
  if (wrap && wrap.scrollWidth > wrap.clientWidth) {
    const focusId = usualAvailable ? Number(usualSlot) : hasMySlots ? [...mySlotIds][0] : [...availableSlotIds][0];
    const focus = slots.find(s => Number(s.id) === Number(focusId));
    const box = svg.getBoundingClientRect();
    const cx = focus ? (sx(focus.x) + SLOT / 2) * (box.width / svgW) : box.width / 2;
    wrap.scrollLeft = (box.left - wrap.getBoundingClientRect().left + wrap.scrollLeft) + cx - wrap.clientWidth / 2;
  }

  // Pre-select the usual slot so Confirm is enabled (without auto-confirming).
  if (usualAvailable) {
    _selectedSlots = [Number(usualSlot)];
    _usualPreselected = Number(usualSlot);
    const _slU = slotLabelForEvent(eventId);
    document.getElementById('modalHint').textContent =
      `${_slU} ${usualSlot} is your usual — tap another to switch, or confirm.`;
    document.getElementById('confirmBookBtn').disabled = false;
  }
  // Choose-only mode, over the normal picker drawn above: the sheet's
  // suggestion is what starts selected (not the auto-picked usual), a seat
  // already held is shown but is no cancel button here, and the confirm BOOKS
  // NOTHING (confirmSpotChoice — confirmBikeBooking refuses in this mode too).
  if (_choose) {
    const preset = _choose.preselect.filter(id => availableSlotIds.has(id) && !mySlotIds.has(id)).slice(0, _choose.count);
    svg.querySelectorAll('.bike-slot').forEach(g => {
      const id = Number(g.getAttribute('data-slot'));
      if (g.classList.contains('mine')) { g.removeAttribute('onclick'); return; }
      if (g.classList.contains('selected') && preset.indexOf(id) === -1) g.classList.replace('selected', 'available');
      else if (g.classList.contains('available') && preset.indexOf(id) !== -1) g.classList.replace('available', 'selected');
    });
    _selectedSlots = preset.slice();
    _usualPreselected = null; // the first tap on another seat adds or evicts by the count — it never "replaces the usual"
    document.getElementById('modalTitle').textContent = `Choose your ${_choose.count > 1 ? pluralizeSlotLabel(_sl) : _sl}`;
    document.getElementById('modalHint').textContent = _chooseSpotHint(_SL, _choose.count, _selectedSlots);
    _confirmBtn.disabled = _selectedSlots.length !== _choose.count;
    _confirmBtn.onclick = confirmSpotChoice;
    if (_dismissBtn) _dismissBtn.textContent = 'Back'; // to the sheet, with no change
  }
  _syncBikeSlotsA11y();
  if (typeof _syncPickerConfirmLabel === 'function') _syncPickerConfirmLabel(); // "Book bike 12" for the pre-selected usual
}

// The confirm button names what it books (_pickerConfirmLabel) — or, in the
// choose-only picker, what it will hand back ("Use bike 12"). Not in a swap:
// changeSpot / executeSpotSwap word that button themselves.
function _syncPickerConfirmLabel() {
  if (window._changeSpotContext) return;
  const btn = document.getElementById('confirmBookBtn');
  if (btn) btn.textContent = _pickerConfirmLabel(_bookingContext ? slotLabelForEvent(_bookingContext.eventId) : 'Spot', _selectedSlots, window._chooseSpotContext ? 'Use' : 'Book');
}

// ── pure:booking:start ── (DOM-free; tests/suites/booking.js evaluates these blocks)
// True when a tap should REPLACE the picker's auto-selected usual bike rather
// than add to it: the only selection is still the one WE made, so the member
// is switching bikes — not asking for a second (chargeable) seat.
function _tapReplacesUsual(selected, usualPreselected, tappedId, swapMode) {
  return !swapMode && usualPreselected != null && tappedId !== usualPreselected &&
    selected.length === 1 && selected[0] === usualPreselected;
}
// ── pure:booking:end ──

// ── pure:a11y:start ──
// What one seat on the picker map tells assistive tech, read off the same
// classes that colour it (so the two can't disagree). `classes` is the seat's
// class list, `label` the number printed on it. A seat already held is an
// action (cancel it / make it the swap target), not a toggle, so it carries no
// pressed state; a taken seat stays in the map but out of the tab order.
function _bikeSlotA11y(classes, slotWord, label) {
  const has = c => (classes || []).indexOf(c) !== -1;
  const mine = has('mine'), taken = !mine && has('taken'), selected = has('selected');
  const parts = [`${slotWord} ${label}`, mine ? 'your booking' : taken ? 'taken' : selected ? 'selected' : 'available'];
  if (has('usual')) parts.push('your usual');
  if (has('pref-prefer')) parts.push('one you prefer');
  if (has('pref-avoid')) parts.push('one you avoid');
  return {
    label: parts.join(', '),
    pressed: (mine || taken) ? null : selected,
    disabled: taken,
    tabindex: taken ? -1 : 0,
  };
}
// ── pure:a11y:end ──

// The seats are SVG <g onclick> — no role, name, focus or keys, so a layout
// class could not be booked by keyboard or VoiceOver at all. One pass over the
// rendered map instead of attributes in the template: selectBike and
// cancelBikeSlot flip classes on live nodes (and settings.js adds the
// prefer / avoid marks later), and this re-reads whatever is there. The name
// comes from the seat's own <text>, so no API label is built into markup.
function _syncBikeSlotsA11y() {
  const word = _bookingContext ? slotLabelForEvent(_bookingContext.eventId) : 'Spot';
  document.querySelectorAll('#bikeSvg .bike-slot').forEach(g => {
    const text = g.querySelector('text');
    const a = _bikeSlotA11y(Array.from(g.classList), word,
      String((text && text.textContent) || g.getAttribute('data-slot') || '').trim());
    // Choose-only mode: a seat already held is shown, not offered — it has no
    // action behind it there (showBikePicker took its cancel handler away).
    if (window._chooseSpotContext && g.classList.contains('mine')) { a.disabled = true; a.tabindex = -1; }
    g.setAttribute('role', 'button');
    g.setAttribute('tabindex', String(a.tabindex));
    g.setAttribute('aria-label', a.label);
    g.setAttribute('aria-disabled', String(a.disabled));
    if (a.pressed == null) g.removeAttribute('aria-pressed');
    else g.setAttribute('aria-pressed', String(a.pressed));
  });
}

function selectBike(slotId) {
  const id = Number(slotId);
  // Only ever reached from a tap on the map, so it can tick: choosing a bike was
  // silent while programmatic searches buzzed (theme.js). Same light 'tap' the
  // dialogs use — the iOS bridge needs no new case.
  if (typeof haptic === 'function') { try { haptic('tap'); } catch {} }
  const swapMode = !!window._changeSpotContext;
  const idx = _selectedSlots.indexOf(id);
  if (idx !== -1) {
    // deselect
    _selectedSlots.splice(idx, 1);
    document.querySelector(`.bike-slot[data-slot="${id}"]`)?.classList.replace('selected', 'available');
  } else {
    // The gold `usual` ring stays on the evicted bike, so tapping it again is
    // a deliberate two-seat booking.
    if (_tapReplacesUsual(_selectedSlots, _usualPreselected, id, swapMode)) {
      _selectedSlots.shift();
      document.querySelector(`.bike-slot[data-slot="${_usualPreselected}"]`)?.classList.replace('selected', 'available');
    }
    // A swap replaces exactly one seat, so swap mode is single-select. The
    // choose-only picker takes exactly the seats its sheet row asks for.
    const maxSel = swapMode ? 1 : (window._chooseSpotContext ? window._chooseSpotContext.count : MAX_SEATS);
    while (_selectedSlots.length >= maxSel) {
      const evicted = _selectedSlots.shift();
      document.querySelector(`.bike-slot[data-slot="${evicted}"]`)?.classList.replace('selected', 'available');
    }
    _selectedSlots.push(id);
    document.querySelector(`.bike-slot[data-slot="${id}"]`)?.classList.replace('available', 'selected');
  }
  // Any manual tap ends the auto-selection: from here the picks are the member's.
  _usualPreselected = null;
  _syncBikeSlotsA11y(); // before the swap-mode return below — both paths moved classes
  if (swapMode) {
    // Keep the change-spot chips + swap hint instead of the generic booking hint.
    renderChangeSpotHint();
    document.getElementById('confirmBookBtn').disabled = _selectedSlots.length === 0;
    return;
  }
  // Choose-only mode: its own hint, and "Use …" is live only with exactly the
  // seats the sheet's row asks for.
  const choose = window._chooseSpotContext;
  if (choose) {
    const word = _bookingContext ? slotLabelForEvent(_bookingContext.eventId) : 'Spot';
    document.getElementById('modalHint').textContent = _chooseSpotHint(word, choose.count, _selectedSlots);
    document.getElementById('confirmBookBtn').disabled = _selectedSlots.length !== choose.count;
    if (typeof _syncPickerConfirmLabel === 'function') _syncPickerConfirmLabel();
    return;
  }
  const count = _selectedSlots.length;
  const _sl2 = _bookingContext ? slotLabelForEvent(_bookingContext.eventId) : 'Spot';
  document.getElementById('modalHint').textContent =
    count === 0 ? `Select up to ${MAX_SEATS} ${pluralizeSlotLabel(_sl2.toLowerCase())}`
    : count === 1 ? `${_sl2} ${_selectedSlots[0]} selected — pick a second or confirm`
    : `${formatSlots(_sl2, _selectedSlots)} selected`;
  document.getElementById('confirmBookBtn').disabled = count === 0;
  if (typeof _syncPickerConfirmLabel === 'function') _syncPickerConfirmLabel();
}

function closeBikePicker() {
  document.getElementById('bikeModal').style.display = 'none';
  _bookingContext = null;
  _selectedSlots = [];
  _usualPreselected = null;
  // Abandoning a swap must not leave its context or button overrides behind —
  // a stale context would make the next booking's confirm cancel the wrong class.
  window._changeSpotContext = null;
  const confirmBtn = document.getElementById('confirmBookBtn');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Book';
    confirmBtn.onclick = confirmBikeBooking;
  }
  // A choose-only picker (the usual-week sheet's "Change spot") closed by ×,
  // Back, Escape or the backdrop: that IS its answer — no change. The sheet is
  // waiting on it, so it is always answered, and exactly once.
  const choose = window._chooseSpotContext;
  window._chooseSpotContext = null;
  if (choose && typeof choose.done === 'function') { try { choose.done(null); } catch (e) {} }
}

// "Use bike 12": the choose-only picker hands the chosen spots back to the
// usual-week sheet. NOTHING is booked here — the sheet shows the choice, and
// only its own confirm button spends anything.
function confirmSpotChoice() {
  const choose = window._chooseSpotContext;
  if (!choose) return;
  const picked = _selectedSlots.map(Number);
  if (picked.length !== choose.count) return;
  window._chooseSpotContext = null; // closeBikePicker must not also answer "no change"
  closeBikePicker();
  try { choose.done(picked); } catch (e) {}
}

async function confirmBikeBooking() {
  // The choose-only picker never books, whatever ended up calling this (the
  // page's own onclick attribute names this function).
  if (window._chooseSpotContext) { confirmSpotChoice(); return; }
  if (!_bookingContext || _selectedSlots.length === 0) return;
  const { eventId, btn } = _bookingContext;
  const slotsToBook = [..._selectedSlots]; // capture before close
  closeBikePicker();
  await submitBooking(eventId, slotsToBook, btn);
}

// ── Waitlists ────────────────────────────────────────────────────
// Waitlist places are a SEPARATE server resource from bookings (verified
// against Psycle's own CodexFit widget + live probes, 2026-08):
//   GET    /waitlists?page=N      my active entries (paginated, 10/page)
//   GET    /waitlists/{eventId}   my entries for one event ([] if none)
//   PUT    /waitlists/{eventId}   join → {success, waitlist:{id,…}}; a 2nd PUT
//                                 → 422 "You are already on this waitlist"
//                                 (ONE place per person per class)
//   DELETE /waitlists/{entryId}   leave (re-delete → 500 "already been cancelled")
//   GET    /waitlist/{entryId}    entry + event availability (the emailed-offer page)
//   POST   /waitlist/{entryId}    {confirmed:true} → accept an offered spot (books a seat)
// They never appear in GET /bookings and POST /bookings without slots is
// rejected ("Booking slot required"), so nothing here touches /bookings.
// In app state a place lives on the event's _myBookings entry:
//   { bookingId:null, slots:[], slotBookings:{}, waitlisted:true, waitlist:{id,status,…} }
// `waitlisted` keeps its long-standing meaning — "no real seat for this
// event" — which calendar/widget/reminders/history already key off. A real
// booking that also carries a place keeps waitlisted:false with `.waitlist`
// attached.
const WAITLIST_MAX_PAGES = 10;
// Retired: places used to be guessed client-side and remembered here. The
// server list is the truth now; drop the stale marker so it can't linger.
try { localStorage.removeItem('psycle_waitlisted_events'); } catch (e) {}

// ── waitlist:pure:start ── (DOM-free helpers; tests/unit.js evaluates this block)
// Normalise one API waitlist entry (GET /waitlists item, GET /waitlist/{id}
// data, or the minimal PUT response object) into the shape the app uses.
// Returns null when no entry id can be found.
function _normaliseWaitlistEntry(raw, fallbackEventId) {
  if (!raw || typeof raw !== 'object') return null;
  const id = Number(raw.id);
  if (!id) return null;
  const ev = (raw.event && typeof raw.event === 'object') ? raw.event : null;
  const eventId = Number(raw.event_id ?? ev?.id ?? fallbackEventId) || null;
  const status = typeof raw.status === 'string' ? raw.status.toLowerCase() : '';
  return {
    id,
    eventId,
    status: status || 'waiting',
    addedAt: raw.added_at || raw.created_at || null,
    expiresAt: raw.expires_at || null,
    allocatedAt: raw.allocated_at || null,
    cancelledAt: raw.cancelled_at || null,
    event: ev,
  };
}

// An entry still holds a place unless the server says it was cancelled,
// allocated (it is then a real booking in GET /bookings) or expired.
function _isActiveWaitlistEntry(entry) {
  if (!entry) return false;
  if (entry.cancelledAt || entry.allocatedAt) return false;
  return !/^(cancelled|canceled|allocated|booked|expired|removed)$/.test(entry.status || '');
}

// Server timestamps on waitlist entries: ISO with Z/offset (added_at) parse
// as-is; a naive 'YYYY-MM-DD HH:MM:SS' is gym (Europe/London) wall-clock —
// resolve it through the native bridge's London resolver when present.
function _waitlistTimeMs(value) {
  if (value == null || value === '') return NaN;
  const s = String(value).trim();
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) return Date.parse(s.replace(' ', 'T'));
  if (typeof window !== 'undefined' && typeof window._psycleClassStartMs === 'function') {
    const ms = window._psycleClassStartMs(s);
    if (!isNaN(ms)) return ms;
  }
  return new Date(s.replace(' ', 'T')).getTime();
}

// A spot is being OFFERED (Psycle emails close to class time instead of
// auto-allocating) when the entry carries an unexpired accept-by deadline or
// a status other than plain waiting.
function _waitlistOfferPending(entry, nowMs) {
  if (!_isActiveWaitlistEntry(entry)) return false;
  if (entry.expiresAt) {
    const t = _waitlistTimeMs(entry.expiresAt);
    return isNaN(t) ? true : t > (nowMs == null ? Date.now() : nowMs);
  }
  return /offer|notif|invite|pending_confirm/.test(entry.status || '');
}

// Close to class Psycle stops filling freed spots from the waitlist and emails
// a first-come offer instead. Two clocks, deliberately apart: the app ASKS
// (GET /waitlist/{id}) from a generous 2.5h out — asking early costs one GET —
// but only SAYS "offers, not auto-booking" from Psycle's own 2h, because said
// any earlier it denies a booking that still happens. Both open at 10pm the
// evening before for 6–9am classes; the waitlist shuts 30 minutes before class.
const WAITLIST_OFFER_WINDOW_MS = 150 * 60000; // generous: FAQ says ≤2h (or after 10pm for 6–9am classes)
const WAITLIST_OFFERS_FROM_MS = 120 * 60000;
const WAITLIST_CLOSES_MS = 30 * 60000;

// "After 10pm the evening before", for a 6–9am class with `leftMs` to go. Read
// off the class's own wall-clock digits: (h+2) hours before an h:mm class IS
// 22:00 the day before, so neither the device zone nor midnight gets a say —
// `new Date(now).getHours() >= 22` went false at 00:00 and an early class was
// not asked about again until 2.5h before it.
function _waitlistEarlyOffersOpen(startAt, leftMs) {
  const m = /[T ](\d{2}):(\d{2})/.exec(String(startAt == null ? '' : startAt));
  if (!m) return false;
  const h = +m[1];
  return h >= 6 && h <= 9 && leftMs <= ((h + 2) * 60 + +m[2]) * 60000;
}

// Should the app be asking Psycle whether this class has a spot to claim?
function _inWaitlistOfferWindow(startAt, nowMs) {
  const left = _waitlistTimeMs(startAt) - (nowMs == null ? Date.now() : nowMs);
  if (isNaN(left) || left <= 0) return false;
  return left <= WAITLIST_OFFER_WINDOW_MS || _waitlistEarlyOffersOpen(startAt, left);
}

// What a seatless place can still expect, for the copy: 'auto' (Psycle books
// you in), 'offers' (it emails an offer — claim it), 'closed' (inside the last
// 30 minutes, or started). A time that can't be read claims nothing: 'auto'.
function _waitlistPhase(startAt, nowMs) {
  const left = _waitlistTimeMs(startAt) - (nowMs == null ? Date.now() : nowMs);
  if (isNaN(left)) return 'auto';
  if (left <= WAITLIST_CLOSES_MS) return 'closed';
  return (left <= WAITLIST_OFFERS_FROM_MS || _waitlistEarlyOffersOpen(startAt, left)) ? 'offers' : 'auto';
}

// Pull the created/affected entry out of any of the response envelopes the
// waitlist endpoints use: {waitlist:{…}} | {data:[…]} | {data:{…}}.
function _waitlistEntryFromResponse(data, eventId) {
  if (!data || typeof data !== 'object') return null;
  let raw = null;
  if (data.waitlist && typeof data.waitlist === 'object') raw = data.waitlist;
  else if (Array.isArray(data.data)) raw = data.data.find(e => e && !e.cancelled_at) || data.data[0] || null;
  else if (data.data && typeof data.data === 'object') raw = data.data;
  return _normaliseWaitlistEntry(raw, eventId);
}

function _isAlreadyOnWaitlistResponse(status, message) {
  return (status === 422 || status === 409) && /already on th(is|e) waitlist/i.test(String(message || ''));
}

// DELETE /waitlists/{id}: gone is gone — a 404, or the server's 500
// "Cannot cancel waitlist as has already been cancelled", both mean the
// place no longer exists.
function _waitlistLeaveSucceeded(ok, status, message) {
  if (ok || status === 204 || status === 404 || status === 410) return true;
  return /already been cancel|already cancel|not on th(is|e) waitlist/i.test(String(message || ''));
}

// Build an _eventCache-compatible record from the event object embedded in a
// waitlist entry (used only when GET /events/{id} could not hydrate it).
// start_at is normalised to the 'YYYY-MM-DDTHH:MM:SS' form the renderers
// (and iOS WebKit's Date parser) expect.
function _eventCacheEntryFromWaitlist(ev) {
  if (!ev || typeof ev !== 'object' || !ev.id || !ev.start_at) return null;
  const studio = (ev.studio && typeof ev.studio === 'object') ? ev.studio : {};
  const loc = (studio.location && typeof studio.location === 'object') ? studio.location : {};
  const instr = (ev.instructor && typeof ev.instructor === 'object') ? ev.instructor : {};
  const type = (ev.event_type && typeof ev.event_type === 'object') ? ev.event_type : {};
  const locName = typeof loc.name === 'string' ? loc.name : '';
  const str = v => (typeof v === 'string' ? v : '');
  const start = String(ev.start_at).trim().replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(start)) return null;
  // Everything numeric is coerced here: these values are interpolated into
  // markup and inline handlers by the renderers.
  return {
    id: Number(ev.id) || null,
    start_at: start,
    duration: Number(ev.duration_in_minutes > 1 ? ev.duration_in_minutes : ev.duration) || 0,
    studio_id: Number(ev.studio_id ?? studio.id) || null,
    instructor_id: Number(ev.instructor_id ?? instr.id) || null,
    event_type_id: Number(ev.event_type_id ?? type.id) || null,
    is_fully_booked: (ev.is_fully_booked ?? ev.is_class_full ?? true) !== false,
    is_waitlistable: (ev.is_waitlistable ?? true) !== false,
    is_live_stream: !!ev.is_live_stream,
    capacity_remaining: typeof ev.available_slot_count === 'number' ? ev.available_slot_count : undefined,
    _typeName: str(type.name) || 'Class',
    _instrName: str(instr.full_name) || [str(instr.first_name), str(instr.last_name)].filter(Boolean).join(' ') || '',
    _locName: locName ? locName.replace('Psycle ', '') : '',
    _locFullName: locName,
    _locAddress: str(loc.address),
    _studioName: str(studio.name),
    _fromWaitlist: true, // provenance marker (diagnostics): seeded from a waitlist entry, not /events/{id}
  };
}

// Merge normalised, active entries into a bookings map (mutates + returns it).
// A real booking for the same event always wins: it keeps waitlisted:false
// and just carries the place as `.waitlist`. Entries whose class started more
// than an hour ago (when nowMs is given) are stale and skipped.
function _mergeWaitlistsIntoBookings(bookings, entries, nowMs) {
  (entries || []).forEach(entry => {
    if (!entry || !entry.eventId || !_isActiveWaitlistEntry(entry)) return;
    if (nowMs != null && entry.event && entry.event.start_at) {
      const startMs = _waitlistTimeMs(entry.event.start_at);
      if (!isNaN(startMs) && startMs < nowMs - 3600000) return;
    }
    const key = String(entry.eventId);
    const place = { id: entry.id, status: entry.status, addedAt: entry.addedAt, expiresAt: entry.expiresAt };
    const existing = bookings[key];
    if (existing) {
      if (existing.waitlist && existing.waitlist.id !== place.id) return; // one place per event; keep the first
      existing.waitlist = place;
      if (!existing.slots) existing.slots = [];
      if (!existing.slotBookings) existing.slotBookings = {};
      existing.waitlisted = !existing.bookingId && existing.slots.length === 0;
    } else {
      bookings[key] = { bookingId: null, slots: [], slotBookings: {}, waitlisted: true, waitlist: place };
    }
  });
  return bookings;
}

// What GET /waitlist/{entryId} says about claiming right now.
function _waitlistOfferFromDetail(data, nowMs) {
  const d = (data && (data.data || data.waitlist)) || data || {};
  const ev = (d && d.event && typeof d.event === 'object') ? d.event : {};
  const free = Array.isArray(ev.available_slots) ? ev.available_slots.length
    : (typeof ev.available_slot_count === 'number' ? ev.available_slot_count : null);
  const isClassFull = ev.is_class_full === true || free === 0;
  const credits = Number(ev.required_credits);
  return {
    // Conservative: only an explicit is_class_full:false (plus a non-zero
    // free count when one is given) reads as "a spot can be claimed".
    available: ev.is_class_full === false && (free == null || free > 0),
    free,
    isClassFull,
    requiredCredits: credits > 0 ? credits : null,
    checkedAt: nowMs == null ? Date.now() : nowMs,
  };
}

// Compare the places we held last time (persisted {eventId: entryId}) with
// the freshly merged bookings map: a place that vanished while the same event
// is now a REAL booking was allocated by Psycle (chargeable, 12h policy) — the
// user must be told. Returns the new places map, the still-relevant allocated
// set, and the event ids allocated since last time.
// Only SEATLESS places are remembered: a place merely attached to a seat the
// user booked themselves must never later read as "Psycle allocated it".
function _heldPlacesOf(bookings) {
  const places = {};
  Object.keys(bookings || {}).forEach(id => {
    const b = bookings[id];
    if (b && b.waitlisted && b.waitlist && b.waitlist.id) places[id] = b.waitlist.id;
  });
  return places;
}
function _diffWaitlistPlaces(prev, bookings, nowMs) {
  const now = nowMs == null ? Date.now() : nowMs;
  const prevPlaces = (prev && prev.places && typeof prev.places === 'object') ? prev.places : {};
  const prevAllocated = (prev && prev.allocated && typeof prev.allocated === 'object') ? prev.allocated : {};
  const places = _heldPlacesOf(bookings);
  const isSeat = id => !!(bookings[id] && !bookings[id].waitlisted && (bookings[id].bookingId || (bookings[id].slots || []).length));
  // Recent marks (e.g. a claim pre-marked seconds ago) survive even if the
  // seat hasn't shown up in this snapshot yet.
  const recent = iso => { const t = Date.parse(iso); return !isNaN(t) && now - t < 120000; };
  const newlyAllocated = Object.keys(prevPlaces).filter(id => !places[id] && isSeat(id) && !prevAllocated[id]);
  const allocated = {};
  Object.keys(prevAllocated).forEach(id => { if (isSeat(id) || recent(prevAllocated[id])) allocated[id] = prevAllocated[id]; });
  newlyAllocated.forEach(id => { allocated[id] = new Date(now).toISOString(); });
  // Remembered places that are now neither a place nor a seat: left, expired,
  // or the waitlist closed on them. The caller decides if that is worth a word.
  const ended = Object.keys(prevPlaces).filter(id => !places[id] && !isSeat(id));
  return { places, allocated, newlyAllocated, ended };
}
// ── waitlist:pure:end ──

// Persisted between launches so an allocation that happened while the app was
// closed is still announced: { places: {eventId: entryId}, allocated: {eventId: iso} }.
const WAITLIST_PLACES_KEY = 'psycle_waitlist_places';
// Owner-stamped: a memory written for another Psycle account (session expiry
// → someone else signs in) must never drive that user's announcements.
function _readWaitlistPlaces() {
  const empty = { places: {}, allocated: {} };
  try {
    const v = JSON.parse(localStorage.getItem(WAITLIST_PLACES_KEY) || 'null');
    if (!v || typeof v !== 'object') return empty;
    const me = currentUser && currentUser.id != null ? String(currentUser.id) : null;
    // A memory stamped for someone must only be honoured for that someone —
    // an unknown reader (profile not loaded yet) gets nothing rather than a
    // possibly foreign account's places.
    if (v.owner != null && (me == null || String(v.owner) !== me)) return empty;
    return { places: (v.places && typeof v.places === 'object') ? v.places : {}, allocated: (v.allocated && typeof v.allocated === 'object') ? v.allocated : {} };
  } catch (e) { return empty; }
}
function _writeWaitlistPlaces(v) {
  try {
    const me = currentUser && currentUser.id != null ? currentUser.id : null;
    if (me == null) {
      // Don't (re)stamp a memory we can't attribute; leave a stamped one alone.
      const existing = JSON.parse(localStorage.getItem(WAITLIST_PLACES_KEY) || 'null');
      if (existing && existing.owner != null) return;
    }
    localStorage.setItem(WAITLIST_PLACES_KEY, JSON.stringify({ owner: me, places: v.places || {}, allocated: v.allocated || {} }));
  } catch (e) {}
}
function _rememberPlace(eventId, entryId) {
  const v = _readWaitlistPlaces();
  if (entryId) v.places[String(eventId)] = entryId; else delete v.places[String(eventId)];
  _writeWaitlistPlaces(v);
}
// The user claimed the spot themselves: badge it "From waitlist" but don't
// announce it as a surprise allocation on the next fetch.
function _markPlaceClaimed(eventId) {
  const v = _readWaitlistPlaces();
  delete v.places[String(eventId)];
  v.allocated[String(eventId)] = new Date().toISOString();
  _writeWaitlistPlaces(v);
}

// Near class time Psycle stops auto-allocating and OFFERS spots instead (an
// email with a confirm link). Probe GET /waitlist/{id} for places whose class
// is within that window so the card can say "Spot available — Claim" the
// moment the app is opened. Throttled per entry; a handful per pass at most.
// (The window itself — WAITLIST_OFFER_WINDOW_MS, _inWaitlistOfferWindow — is
// in the waitlist:pure block.)
const _offerProbeAt = {};
// A seatless place worth asking about right now: Psycle says an offer is out,
// or its class is inside the offer window. Shared by the probe and the
// re-check below so the two can't disagree about which places count.
function _placeNeedsOfferCheck(b, id, now) {
  if (!b || !b.waitlisted || !b.waitlist || !b.waitlist.id) return false;
  if (_waitlistOfferPending(b.waitlist, now)) return true;
  const evt = _eventCache[id];
  return !!evt && _inWaitlistOfferWindow(evt.start_at, now);
}
// Resolves to { probed, changed, allocated } — `changed` when a card should
// re-render, `allocated` when a probed place turned out to be a seat already
// (caller reloads bookings). Dead (cancelled/expired) places are dropped.
async function _probeWaitlistOffers(bookings) {
  const now = Date.now();
  const result = { probed: 0, changed: false, allocated: false };
  const candidates = Object.keys(bookings).filter(id => {
    const b = bookings[id];
    return _placeNeedsOfferCheck(b, id, now) && now - (_offerProbeAt[b.waitlist.id] || 0) >= 90000;
  }).slice(0, 3);
  result.probed = candidates.length;
  await Promise.all(candidates.map(async id => {
    const b = bookings[id];
    const entryId = b.waitlist.id;
    _offerProbeAt[entryId] = now;
    try {
      const res = await apiFetch(`/waitlist/${Number(entryId)}`, { retries: 0 });
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      if (!data) return;
      const entry = _normaliseWaitlistEntry(data.data || data.waitlist || data, id);
      if (entry && (entry.allocatedAt || /^(allocated|booked)$/.test(entry.status))) {
        result.allocated = true; // it's a seat now — the reload will show it (and announce)
        return;
      }
      if (entry && !_isActiveWaitlistEntry(entry)) {
        // Cancelled/expired since the list was read: drop the place.
        if (bookings[id] === b) {
          if (b.bookingId || (b.slots || []).length) { delete b.waitlist; b.waitlisted = false; }
          else delete bookings[id];
        }
        result.changed = true;
        return;
      }
      if (entry) { b.waitlist.status = entry.status; b.waitlist.expiresAt = entry.expiresAt; }
      b.waitlist.offer = _waitlistOfferFromDetail(data, now);
      result.changed = true;
    } catch (e) { /* a probe is best-effort */ }
  }));
  return result;
}

// My Bookings left open close to class: the probe above only runs when the
// bookings are refetched (launch, resume, pull-to-refresh), so the card could
// sit on "Waitlisted" while a spot was there for the taking. Ask again every
// couple of minutes — only with the tab on screen, online, and a place worth
// asking about (the probe's own 90s-per-entry throttle still applies); the
// ticker is dropped while the page is hidden or no place is held. It only
// ever LOOKS: claiming stays a tap plus the confirm in claimWaitlistSpot.
const WAITLIST_RECHECK_MS = 120000;
let _waitlistRecheckTimer = null;
let _waitlistRecheckBusy = false;
let _waitlistRepaintOwed = false; // an offer changed while a dialog / busy button was up

// A repaint swaps every card button out: never under a dialog or the class
// sheet, never while one of those buttons is mid-request (its handler would
// restore a detached node, and the fresh one would take a second tap), and
// never from under an open "Similar" popup or More menu — they live inside
// their card.
function _bookingsRepaintSafe() {
  return !_dialogOpen() && !document.getElementById('classDetailOverlay') &&
    !document.querySelector('#upcomingList button:disabled, #upcomingList .find-similar-popup, #upcomingList .mb-more-btn[aria-expanded="true"]');
}

// What the cards show for each seatless place: its offer state and where it
// stands on Psycle's clock. The probe rewrites `offer` on every pass (its
// `changed` is always true) and a repaint for nothing can land mid-tap — so the
// ticker compares THIS, and repaints only when it moved.
function _placesShownSig(map) {
  const now = Date.now();
  return JSON.stringify(Object.keys(map).filter(id => map[id] && map[id].waitlisted).map(id => {
    const p = map[id].waitlist;
    const evt = _eventCache[id];
    return [id, p && p.status, p && p.expiresAt, !!(p && p.offer && p.offer.available), evt ? _waitlistPhase(evt.start_at, now) : ''];
  }));
}
let _waitlistShownSig = null; // as of the last paint of My Bookings (renderMyBookings stamps it; re-read whenever the ticker is re-armed)

async function _waitlistRecheckTick() {
  if (_waitlistRecheckBusy || document.hidden || !navigator.onLine || !getBearerToken()) return;
  if (document.querySelector('.tab-panel.active')?.id !== 'tab-bookings') return;
  if (!_bookingsRepaintSafe()) return;
  if (_waitlistRepaintOwed) { _waitlistRepaintOwed = false; _waitlistShownSig = _placesShownSig(_myBookings); renderMyBookings(); }
  const map = _myBookings;
  const now = Date.now();
  if (!Object.keys(map).some(id => _placeNeedsOfferCheck(map[id], id, now))) return;
  _waitlistRecheckBusy = true;
  try {
    const result = await _probeWaitlistOffers(map);
    if (_myBookings !== map) return; // a fetch landed meanwhile: it repainted, and re-armed this
    if (result && result.allocated) { fetchMyBookings(); return; } // a seat now — reload the truth (it announces itself)
    // Differs when the probe found something new, or when the clock alone moved
    // a card on since the last repaint (books you in → offers → closed).
    const sig = _placesShownSig(map);
    if (sig === _waitlistShownSig) return;
    if (!_bookingsRepaintSafe()) { _waitlistRepaintOwed = true; return; }
    _waitlistShownSig = sig;
    renderMyBookings();
  } catch (e) {
    /* best-effort, like the probe */
  } finally {
    _waitlistRecheckBusy = false;
  }
}

// `repainted`: the caller sits right next to a repaint of My Bookings (a fetch
// applied, a join / leave) — what the cards show from here on is re-read.
function _syncWaitlistRecheck(repainted) {
  if (repainted) { _waitlistShownSig = _placesShownSig(_myBookings); _waitlistRepaintOwed = false; }
  const want = !document.hidden && !!getBearerToken() &&
    Object.keys(_myBookings).some(id => _myBookings[id] && _myBookings[id].waitlisted);
  if (want && !_waitlistRecheckTimer) {
    _waitlistRecheckTimer = setInterval(_waitlistRecheckTick, WAITLIST_RECHECK_MS);
  } else if (!want && _waitlistRecheckTimer) {
    clearInterval(_waitlistRecheckTimer);
    _waitlistRecheckTimer = null;
  }
}
if (typeof PsycleEvents !== 'undefined') {
  ['bookings:loaded', 'waitlist:joined', 'waitlist:left', 'auth:changed'].forEach(evt => {
    try { PsycleEvents.on(evt, () => { try { _syncWaitlistRecheck(evt !== 'auth:changed'); } catch (e) {} }); } catch (e) {}
  });
}
document.addEventListener('visibilitychange', () => { try { _syncWaitlistRecheck(false); } catch (e) {} });

// After a real booking is cancelled locally: keep any waitlist place the
// entry also carried (it still exists server-side), otherwise drop the entry.
function _dropBookingKeepPlace(eventId) {
  const key = String(eventId);
  const place = _myBookings[key]?.waitlist;
  if (place) _myBookings[key] = { bookingId: null, slots: [], slotBookings: {}, waitlisted: true, waitlist: place };
  else delete _myBookings[key];
  _noteLocalBookingWrite();
  _markSeatFreed(eventId);
}
// The user just gave a seat back, so the search-time "full" flag is stale —
// let the Discover card offer Book again instead of Join Waitlist / Full.
// Every copy, not the cache alone: render() tests the WINDOW's event under
// "Available only" (and spreads it back over the cache), and the class is no
// longer the member's own — still "full" there, it left the list on the next
// filter tap, with the seat just freed in it, until a revalidate.
function _markSeatFreed(eventId) {
  _noteFreshAvailability(eventId, { is_fully_booked: false });
}

// After a Discover-card cancel: resync every card button for the event from
// state (a kept place → "Waitlisted ✓", full → "Join Waitlist"/"Full", else
// "Book"), and put a non-card button (detail sheet proxy, headless) back to Book.
function _afterCardCancel(btn, eventId) {
  if (btn && !btn.closest('.class-card')) {
    btn.textContent = 'Book';
    btn.className = 'book-btn';
    btn.disabled = false;
    btn.removeAttribute('data-booking-id');
    const studioId = btn.dataset.studioId || _eventCache[String(eventId)]?.studio_id || 0;
    btn.onclick = (e) => { if (e) e.stopPropagation(); bookClass(eventId, btn, studioId); };
  }
  _syncCardButtonsForEvent(eventId);
}

// Booking ids to DELETE for an event's real seats: per-slot ids when known,
// else the entry/explicit booking id. (slotBookings is {} — truthy — for
// seatless entries, so it can't be used as the sole discriminator.)
// Each id ONCE: seats booked in one POST share the id it returned until
// /bookings is re-read, and a second DELETE of it 404s — which every caller
// counts as "gone", i.e. as if the other seat had been cancelled too.
function _bookingIdsFor(booking, explicitId) {
  const once = ids => ids.filter((id, i) => id && ids.findIndex(x => String(x) === String(id)) === i);
  const perSlot = booking?.slotBookings ? once(Object.values(booking.slotBookings)) : [];
  if (perSlot.length) return perSlot;
  // Slot-less (no-layout) bookings: every record id we read for the event.
  const all = Array.isArray(booking?.bookingIds) ? once(booking.bookingIds) : [];
  if (all.length) return all;
  if (explicitId) return [explicitId];
  return booking?.bookingId ? [booking.bookingId] : [];
}

// Field NAMES of one sample go to diagnostics (never values) so a shape change
// in this unofficial API shows up in bug reports — and, for the fields
// PsycleAPI.SCHEMAS calls required, as the safe-mode banner. Bookings, events
// and the profile come through here as well as the waitlist resources, so at
// most one sample a minute per kind: a search reads /events once per studio,
// and every record is a localStorage write.
const _shapeRecordedAt = {};
function _recordShape(kind, sample) {
  try {
    if (!sample || !window.PsycleDiag || typeof window.PsycleDiag.record !== 'function') return;
    const now = Date.now();
    if (now - (_shapeRecordedAt[kind] || 0) < 60000) return;
    _shapeRecordedAt[kind] = now;
    window.PsycleDiag.record(kind, sample);
  } catch (e) { /* diagnostics must never break the flow */ }
}

let _lastWaitlistEntries = null; // last good GET /waitlists result (survives a transient failure)

// Page through GET /waitlists. Resolves to normalised ACTIVE entries, or
// null when the list could not be read at all (callers keep prior state).
// If a later page fails the array carries `incomplete: true` — callers may
// show what was read but must not treat absences as authoritative.
async function fetchMyWaitlists(startedAt) {
  startedAt = startedAt || Date.now();
  const all = [];
  let readAny = false;
  let complete = false;
  for (let page = 1; page <= WAITLIST_MAX_PAGES; page++) {
    let res;
    try {
      res = await apiFetch(`/waitlists?page=${page}`, { retries: 1 });
    } catch (e) {
      console.warn('[psycle] waitlists fetch failed:', e);
      break;
    }
    if (!res.ok) { console.warn('[psycle] waitlists HTTP', res.status); break; }
    const data = await res.json().catch(() => null);
    if (!data) break;
    readAny = true;
    const list = Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : []);
    if (page === 1 && list.length) _recordShape('waitlist', list[0]);
    list.forEach(raw => { const e = _normaliseWaitlistEntry(raw); if (e) all.push(e); });
    const meta = data.meta || {};
    const lastPage = Number(meta.last_page) || 1;
    if (!list.length || page >= lastPage) { complete = true; break; }
    if (page === WAITLIST_MAX_PAGES) console.warn('[psycle] waitlists truncated at', WAITLIST_MAX_PAGES, 'pages');
  }
  if (!readAny) return null;
  let active = all.filter(_isActiveWaitlistEntry);
  if (!complete) {
    // Keep previously-known entries we couldn't re-read this pass.
    const seen = new Set(active.map(e => e.id));
    (_lastWaitlistEntries || []).forEach(e => { if (!seen.has(e.id)) active.push(e); });
    active.incomplete = true;
  }
  // Only a NEWER read may replace the fallback (a slow, older list must not
  // undo what a later read — or a local join/leave — established).
  if (startedAt >= _lastWaitlistEntriesAt) {
    _lastWaitlistEntries = active;
    _lastWaitlistEntriesAt = startedAt;
  }
  return active;
}
let _lastWaitlistEntriesAt = 0;

// Keep the offline/outage fallback in step with what the user just did.
function _rememberLastEntry(entry) {
  if (!entry || !entry.id) return;
  const list = (_lastWaitlistEntries || []).filter(e => e.id !== entry.id && e.eventId !== entry.eventId);
  list.push(entry);
  _lastWaitlistEntries = list;
  _lastWaitlistEntriesAt = Date.now(); // an older in-flight read must not overwrite this
}
function _forgetLastEntry(eventId, entryId) {
  _lastWaitlistEntriesAt = Date.now();
  if (!_lastWaitlistEntries) return;
  _lastWaitlistEntries = _lastWaitlistEntries.filter(e => e.id !== entryId && String(e.eventId) !== String(eventId));
}

// My entry for one event straight from the server. `known:false` means the
// server couldn't be asked (non-2xx / timeout) — that is NOT "not on it".
async function _fetchWaitlistEntryForEvent(eventId) {
  try {
    const res = await apiFetch(`/waitlists/${Number(eventId)}`, { retries: 1 });
    if (!res.ok) return { known: false, entry: null, status: res.status };
    const data = await res.json().catch(() => null);
    if (!data) return { known: false, entry: null, status: res.status };
    const list = Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : []);
    const entries = list.map(raw => _normaliseWaitlistEntry(raw, eventId)).filter(_isActiveWaitlistEntry);
    return { known: true, entry: entries[0] || null, status: res.status };
  } catch (e) {
    return { known: false, entry: null, status: 0 };
  }
}

// Re-sync every rendered Discover card button for an event with _myBookings.
function _syncCardButtonsForEvent(eventId) {
  const key = String(eventId);
  document.querySelectorAll(`.class-card[data-id="${Number(eventId)}"]:not(.my-booking-card) .book-btn`).forEach(btn => {
    const card = btn.closest('.class-card');
    const booking = _myBookings[key];
    if (booking) { applyBookedState(btn, Number(eventId), booking); return; }
    const evt = _eventCache[key] || {};
    const studioId = card?.dataset?.studioId || evt.studio_id || 0;
    card?.classList.remove('is-booked', 'is-waitlisted');
    btn.disabled = false;
    btn.removeAttribute('data-booking-id');
    // The availability line follows the button (before the 'Full' branch
    // returns): a card built as "Only 2 left" kept saying so beside "Join
    // Waitlist" / "Full", and "Waitlist open" stayed beside "Book". No number
    // is written here — the counts were not re-read — and one already on a
    // bookable card is left to the resume hook. (.cc-sub: Discover cards only.)
    const spots = card?.querySelector('.cc-spots');
    const line = _spotsHtml(evt, null, false);
    if (line) {
      if (spots) spots.outerHTML = line;
      else card?.querySelector('.cc-sub')?.insertAdjacentHTML('afterend', line);
    } else if (spots && !spots.hasAttribute('data-count')) spots.remove();
    if (evt.is_fully_booked && evt.is_waitlistable) {
      btn.textContent = 'Join Waitlist';
      btn.className = 'book-btn waitlist';
    } else if (evt.is_fully_booked) {
      // Full and the waitlist is closed (e.g. inside the last 30 min): as eventCard.
      btn.textContent = 'Full';
      btn.className = 'book-btn';
      btn.disabled = true;
      btn.onclick = (e) => { if (e) e.stopPropagation(); };
      return;
    } else {
      btn.textContent = 'Book';
      btn.className = 'book-btn';
    }
    btn.onclick = (e) => { if (e) e.stopPropagation(); bookClass(Number(eventId), btn, studioId); };
  });
}

// bookClass found no free seat in a class Psycle has not called full: no flag
// changed, so nothing re-synced the card — and "Only 2 left" must not stay
// beside the "Full" / "Join Waitlist" that tap is about to write.
function _dropCardCounts(eventId) {
  document.querySelectorAll(`.class-card[data-id="${Number(eventId)}"]:not(.my-booking-card) .cc-spots[data-count]`).forEach(el => el.remove());
}

function _waitlistClassLine(eventId) {
  const evt = _eventCache[String(eventId)];
  if (!evt) return '';
  let when = '';
  const d = new Date(String(evt.start_at).replace(' ', 'T'));
  if (!isNaN(d.getTime())) {
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    // "Fri 18" only places a class within the week. A waitlist place can be
    // held weeks ahead (and an ended one is read about weeks later): more than
    // 6 days off either way, the month is said too — "Fri 18 Sep, 11:33".
    const far = Math.abs(d.getTime() - Date.now()) > 6 * 24 * 60 * 60 * 1000;
    when = `${days[d.getDay()]} ${d.getDate()}${far ? ' ' + months[d.getMonth()] : ''}, ${_clock24(d.getHours(), d.getMinutes())}`;
  }
  return [evt._typeName, evt._instrName, when].filter(Boolean).join(' · ');
}

// Ask first, then join. Used by bookClass (Discover card, class detail sheet,
// rebook flows) — the one consent dialog before PUT /waitlists.
async function confirmJoinWaitlist(eventId, btn, clashLine) {
  const line = _waitlistClassLine(eventId);
  // Psycle turns a place into a CHARGEABLE seat on its own, so a clash with a
  // seat already held matters here as much as on a booking. bookClass passes
  // the line it built from the fresh event; any other caller gets the cache's.
  if (clashLine == null) {
    try { clashLine = _clashLabel(_clashFor(eventId)); } catch (e) { clashLine = ''; }
  }
  const ok = await confirmModal({
    title: 'Join the waitlist?',
    body: (line ? line + ' is full. ' : 'This class is full. ') +
      'Psycle fills freed-up spots from the waitlist automatically, first come first served — keep a credit free so you can be booked in. Close to class time they email an offer instead, which you can also accept here in My Bookings.',
    warn: (clashLine ? clashLine + '. ' : '') +
      'One waitlist place per person. Once you’re given a spot the normal 12-hour cancellation policy applies; the waitlist closes 30 minutes before class.',
    confirmText: 'Join waitlist',
    cancelText: 'Not now',
  });
  if (!ok) return false;
  return joinWaitlist(eventId, btn);
}

// PUT /waitlists/{eventId}. Resolves true when the user holds a place afterwards.
async function joinWaitlist(eventId, btn, opts = {}) {
  eventId = Number(eventId);
  const key = String(eventId);
  btn = btn || document.createElement('button');
  if (!navigator.onLine) {
    btn.disabled = false;
    btn.textContent = 'Join Waitlist';
    toast("You're offline — join the waitlist once you're back online", 'info');
    return false;
  }
  const origText = btn.textContent;
  btn.disabled = true;
  _busyLabel(btn);
  const fail = (label, msg, type) => {
    btn.disabled = false;
    btn.textContent = label;
    if (msg) toast(msg, type || 'error');
    return false;
  };
  let entry = null;
  let already = false;
  try {
    // retries:0 — the retry layer re-sends non-POST verbs on timeout, and a
    // PUT that landed would come back as a confusing 422 on the re-send.
    const res = await apiFetch(`/waitlists/${eventId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      retries: 0,
    });
    const data = await res.json().catch(() => ({}));
    const message = (data && (data.message || data.error)) || '';
    // "Couldn't tell": the PUT may have LANDED (a place Psycle can turn into a
    // chargeable seat) — never report that as a plain failure. Flagged on the
    // caller's opts: the usual-week run has to tell it from a refusal.
    const unsure = () => {
      opts.unsure = true;
      fail('Join Waitlist', "Couldn't confirm with Psycle whether you joined — check My Bookings in a moment", 'info');
      // Token gone by then (the session expired meanwhile): fetchMyBookings'
      // no-token branch would empty the list an expiry keeps on purpose — and
      // the next foreground would blank the widget and cancel every reminder.
      setTimeout(() => { try { if (getBearerToken()) fetchMyBookings(); } catch (err) {} }, 3000);
      return false;
    };
    if (res.ok && data && data.success === false) {
      return fail('Failed — retry', message || "Psycle didn't add you to the waitlist");
    } else if (res.ok) {
      entry = _waitlistEntryFromResponse(data, eventId);
      if (data && data.waitlist) _recordShape('waitlist-join', data.waitlist);
    } else if (_isAlreadyOnWaitlistResponse(res.status, message)) {
      already = true;
    } else if (res.status === 401) {
      return fail(origText); // session banner is shown globally
    } else if (res.status >= 500) {
      // The server may still have taken it — ask before calling it a failure.
      const chk = await _fetchWaitlistEntryForEvent(eventId);
      if (chk.known && chk.entry) entry = chk.entry;
      else if (chk.known) return fail('Failed — retry', message || "Couldn't join the waitlist");
      else return unsure();
    } else {
      return fail('Failed — retry', message || "Couldn't join the waitlist");
    }
  } catch (e) {
    // Timeout / dropped connection: disambiguate with a lookup.
    const chk = await _fetchWaitlistEntryForEvent(eventId);
    if (chk.known && chk.entry) {
      entry = chk.entry;
    } else if (chk.known) {
      return fail('Failed — retry', _friendlyError(e, "Couldn't join the waitlist"));
    } else {
      opts.unsure = true; // as unsure() above
      fail('Join Waitlist', "Couldn't confirm with Psycle whether you joined — check My Bookings in a moment", 'info');
      setTimeout(() => { try { if (getBearerToken()) fetchMyBookings(); } catch (err) {} }, 3000); // token check: as unsure() above
      return false;
    }
  }
  try {
    // Resolve the entry id from the server when the response didn't carry it.
    if (!entry || !entry.id) {
      const chk = await _fetchWaitlistEntryForEvent(eventId);
      if (chk.entry) entry = chk.entry;
      // A 2xx, yet the server positively lists no place: say so rather than
      // fabricating one the next refresh would silently remove.
      else if (chk.known && !already) return fail('Failed — retry', "Psycle didn't record a waitlist place — try again");
      else if (chk.known && already) return fail('Join Waitlist', "Psycle says you were on this waitlist, but no active place is listed — try joining again", 'info');
    }
    const place = entry
      ? { id: entry.id, status: entry.status || 'waiting', addedAt: entry.addedAt, expiresAt: entry.expiresAt }
      : { id: null, status: 'waiting', addedAt: new Date().toISOString(), expiresAt: null };
    const existing = _myBookings[key];
    if (existing && (existing.bookingId || (existing.slots || []).length)) {
      existing.waitlist = place;
      existing.waitlisted = false;
    } else {
      _myBookings[key] = { bookingId: null, slots: [], slotBookings: {}, waitlisted: true, waitlist: place };
    }
    _noteLocalBookingWrite();
    delete _placesLeftHere[key]; // back on it: how THIS place ends is news again
    if (place.id) {
      _rememberPlace(eventId, place.id);
      _rememberLastEntry({ id: place.id, eventId, status: place.status, addedAt: place.addedAt, expiresAt: place.expiresAt, allocatedAt: null, cancelledAt: null, event: null });
    }
    applyBookedState(btn, eventId, _myBookings[key]);
    _syncCardButtonsForEvent(eventId);
    if (typeof haptic === 'function') { try { haptic('success'); } catch {} }
    if (!opts.quiet) showBookingConfirmation(eventId, [], { waitlist: true, already });
    else if (already) toast("You're already on this waitlist", 'info');
    refreshUpcomingPanel();
    PsycleEvents.emit('waitlist:joined', eventId);
    return true;
  } catch (e) {
    return fail('Failed — retry', _friendlyError(e, "Couldn't join the waitlist"));
  }
}

// DELETE /waitlists/{entryId}. Resolves true when the place is gone afterwards.
async function leaveWaitlist(eventId, btn, opts = {}) {
  eventId = Number(eventId);
  const key = String(eventId);
  btn = btn || document.createElement('button');
  const booking = _myBookings[key];
  const hasSeat = !!(booking && (booking.bookingId || (booking.slots || []).length));
  if (!opts.confirmed) {
    const line = _waitlistClassLine(eventId);
    // The class sheet and the Discover card lead here from a ticked "Waitlisted"
    // button — with an offer showing, that is the opposite of what the member
    // came for. Said, not gated: a deliberate Leave must not be nagged.
    const place = booking && booking.waitlist;
    const spotOpen = !hasSeat && !!place && (!!(place.offer && place.offer.available) || _waitlistOfferPending(place));
    const ok = await confirmModal({
      title: 'Leave the waitlist?',
      body: line ? `${line}. You'll lose your place in the queue.` : "You'll lose your place in the queue.",
      warn: hasSeat ? '' : (spotOpen ? 'A spot looks free to claim right now — “Claim spot” in My Bookings takes it; leaving gives it up. ' : '') +
        'If Psycle has only just given you a spot, that booking stays — it will show in My Bookings.',
      confirmText: 'Leave waitlist',
      cancelText: 'Stay on it',
      danger: true,
    });
    if (!ok) return false;
  }
  if (!navigator.onLine) {
    toast("You're offline — leave the waitlist once you're back online", 'info');
    return false;
  }
  const origText = btn.textContent;
  btn.disabled = true;
  _busyLabel(btn);
  try {
    let entryId = booking?.waitlist?.id || null;
    if (!entryId) {
      const chk = await _fetchWaitlistEntryForEvent(eventId);
      if (!chk.known) {
        // Unknown ≠ gone: keep the place, let the user retry.
        btn.disabled = false;
        btn.textContent = origText;
        toast("Couldn't reach Psycle to find your waitlist place — try again in a moment", 'error');
        return false;
      }
      entryId = chk.entry?.id || null;
    }
    // alreadyGone: the server no longer had the place (404 / "already been
    // cancelled") — it may have been ALLOCATED into a real seat moments ago,
    // so we resync below rather than just trusting the local delete.
    let alreadyGone = !entryId;
    if (entryId) {
      const res = await apiFetch(`/waitlists/${Number(entryId)}`, { method: 'DELETE', headers: { 'Accept': 'application/json' }, retries: 1 });
      const data = await res.json().catch(() => ({}));
      const serverMsg = (data && (data.message || data.error)) || '';
      // The place may have been ALLOCATED seconds ago (now a chargeable seat):
      // say so and reload rather than reporting an error or a "left".
      if (/allocat|already (been )?booked|is now a booking/i.test(serverMsg)) {
        btn.disabled = false;
        btn.textContent = origText;
        toast('Psycle already booked you into this class from the waitlist — loading your bookings…', 'info');
        fetchMyBookings();
        return false;
      }
      const gone = res.ok ? data.success !== false : _waitlistLeaveSucceeded(false, res.status, serverMsg);
      if (!gone) {
        btn.disabled = false;
        btn.textContent = origText;
        if (res.status !== 401) {
          toast(serverMsg || (res.status === 403
            ? "Psycle wouldn't change this waitlist right now (it closes 30 minutes before class)"
            : `Couldn't leave the waitlist (${res.status})`), 'error');
        }
        return false;
      }
      alreadyGone = !res.ok;
    }
    // Re-read: a fetch may have rebuilt the entry (even into a real seat)
    // while the dialog / requests were in flight — never delete a seat here.
    const cur = _myBookings[key];
    if (cur && (cur.bookingId || (cur.slots || []).length)) {
      delete cur.waitlist;
      cur.waitlisted = false;
      _rememberPlace(eventId, null); // a place next to a seat the user booked is never an "allocation"
    } else if (cur) {
      delete _myBookings[key];
    }
    _noteLocalBookingWrite();
    _forgetLastEntry(eventId, entryId);
    _placesLeftHere[key] = true; // the member's own doing: never "ended without a booking" news
    // For a seatless place the MEMORY is deliberately kept: the resync below
    // rewrites it from the truth, and if Psycle allocated the place just
    // before our DELETE the diff can still announce the seat.
    // Discover card buttons fall back to the class's joinable state; any other
    // button (My Bookings re-renders below, detail sheet, headless) is restored.
    if (!btn.closest('.class-card:not(.my-booking-card)')) {
      btn.disabled = false;
      btn.textContent = origText;
    }
    _syncCardButtonsForEvent(eventId);
    refreshUpcomingPanel();
    if (typeof haptic === 'function') { try { haptic('tap'); } catch {} }
    toast(alreadyGone
      ? 'That place was already gone — checking whether Psycle booked you in…'
      : 'Left the waitlist', 'info');
    PsycleEvents.emit('waitlist:left', eventId);
    // Always re-read the truth: leaving is "state unknown until confirmed"
    // (an allocation may have landed either side of the DELETE).
    fetchMyBookings();
    return true;
  } catch (e) {
    btn.disabled = false;
    btn.textContent = origText;
    // Nothing queues or retries a waitlist leave — say so plainly, and re-read
    // in case the DELETE actually landed before the connection dropped.
    const net = !navigator.onLine || /network|failed to fetch|load failed|timed out/i.test((e && e.message) || '');
    toast(net
      ? "Couldn't reach Psycle — you may still be on the waitlist. Check My Bookings and try again when you're back online."
      : _friendlyError(e, "Couldn't leave the waitlist"), 'error');
    // (Only with a token: signed out, that read would empty the kept list — see joinWaitlist's unsure().)
    setTimeout(() => { try { if (getBearerToken()) fetchMyBookings(); } catch (err) {} }, 1500);
    return false;
  }
}

// The emailed-offer flow, in-app: GET /waitlist/{id} tells us whether a spot
// is free right now; only after an explicit confirm do we POST to take it.
async function claimWaitlistSpot(eventId, btn) {
  eventId = Number(eventId);
  const key = String(eventId);
  btn = btn || document.createElement('button');
  const booking = _myBookings[key];
  let entryId = booking?.waitlist?.id || null;
  if (!navigator.onLine) { toast("You're offline — try again once you're back online", 'info'); return false; }
  const origText = btn.textContent;
  btn.disabled = true;
  _busyLabel(btn);
  const restore = () => { btn.disabled = false; btn.textContent = origText; };
  try {
    if (!entryId) {
      const chk = await _fetchWaitlistEntryForEvent(eventId);
      if (!chk.known) { restore(); toast("Couldn't reach Psycle — try again in a moment", 'error'); return false; }
      entryId = chk.entry?.id || null;
    }
    if (!entryId) {
      restore();
      toast("You're no longer on this waitlist — refreshing your bookings", 'info');
      fetchMyBookings();
      return false;
    }
    const res = await apiFetch(`/waitlist/${Number(entryId)}`, { retries: 1 });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      restore();
      if (res.status !== 401) toast(data.message || data.error || `Couldn't check the waitlist (${res.status})`, 'error');
      return false;
    }
    const entry = _normaliseWaitlistEntry(data.data || data.waitlist || data, eventId);
    _recordShape('waitlist-offer', data.data || null);
    if (entry && (entry.allocatedAt || /^(allocated|booked)$/.test(entry.status))) {
      restore();
      toast("Good news — Psycle already booked you into this class", 'success');
      await fetchMyBookings();
      return true;
    }
    if (!entry || !_isActiveWaitlistEntry(entry)) {
      restore();
      toast('This waitlist place is no longer active', 'info');
      await fetchMyBookings();
      return false;
    }
    // Keep the freshest status/deadline/availability for the card.
    const offer = _waitlistOfferFromDetail(data);
    if (booking && booking.waitlist) {
      booking.waitlist.status = entry.status;
      booking.waitlist.expiresAt = entry.expiresAt;
      booking.waitlist.offer = offer;
    }
    const ev = entry.event || {};
    const free = offer.free;
    if (!offer.available) {
      restore();
      refreshUpcomingPanel();
      toast(_waitlistOfferPending(entry)
        ? 'Sorry — someone else took that spot. You’re still on the waitlist.'
        : "No spot free yet — you're still on the waitlist", 'info');
      return false;
    }
    const credits = Number(ev.required_credits);
    const have = Number(currentUser?.stats?.credits_remaining);
    const line = _waitlistClassLine(eventId);
    // A claim is always inside the offer window, so "the 12-hour policy applies
    // once you're booked" undersold it: there is no free cancel left at all.
    // Read off the entry's own (fresh) class time; today's sentence stays for a
    // time that can't be read. Advisory — never in the way of the confirm.
    let policyLine = "Psycle's normal 12-hour cancellation policy applies once you're booked.";
    try {
      const dl = _cancelDeadline(ev.start_at || _eventCache[key]?.start_at);
      if (dl && dl.hoursUntil > 0) {
        policyLine = dl.insideWindow
          ? `This class ${_startsInPhrase(_hoursMinsLeft(dl.hoursUntil))} — once claimed, cancelling is usually charged by Psycle.`
          : `Free cancel until ${dl.label} — after that Psycle's 12-hour cancellation policy applies.`;
      }
    } catch (e) {}
    // The fallback booked for the same time is a seat already held: claiming
    // on top of it means two chargeable seats. Same line as the booking confirms.
    let clashLine = '';
    try { clashLine = _clashLabel(_clashFor(eventId, ev)); } catch (e) {}
    const ok = await confirmModal({
      title: 'Claim this spot?',
      body: (line ? line + '. ' : '') +
        (free ? `${_plural(free, 'spot')} free right now — it isn't held for you. ` : 'A spot is free right now — it isn’t held for you. ') +
        'This books you into the class' +
        (credits > 0 ? ` and uses ${credits} credit${credits === 1 ? '' : 's'}` + (have > 0 ? ` (you have ${have})` : '') + '.' : '.'),
      warn: (clashLine ? clashLine + '. ' : '') + policyLine,
      confirmText: 'Claim spot',
      cancelText: 'Not now',
    });
    if (!ok) { restore(); return false; }
    _busyLabel(btn);
    let post;
    try {
      post = await apiFetch(`/waitlist/${Number(entryId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ confirmed: true }),
      });
    } catch (e) {
      // Timeout / dropped connection AFTER the POST was sent: it may have
      // booked a chargeable seat. Never report a plain failure — re-read
      // (pre-marked as our own claim so the reload doesn't also announce it
      // as a surprise allocation; undone if no seat shows up).
      const memBefore0 = _readWaitlistPlaces();
      _markPlaceClaimed(eventId);
      const applied = await fetchMyBookings();
      _syncCardButtonsForEvent(eventId);
      const now = _myBookings[key];
      if (now && !now.waitlisted && (now.bookingId || (now.slots || []).length)) {
        if (typeof haptic === 'function') { try { haptic('success'); } catch {} }
        toast("Spot claimed — you're booked in!", 'success');
        PsycleEvents.emit('booking:complete', eventId, now.slots || [], btn);
        showBookingConfirmation(eventId, now.slots || []);
        return true;
      }
      _writeWaitlistPlaces(memBefore0);
      restore();
      toast(applied === false
        ? "Couldn't confirm with Psycle whether the spot was claimed — pull to refresh My Bookings before trying again"
        : "Couldn't confirm with Psycle whether the spot was claimed — it isn't showing as booked; try again", 'error');
      return false;
    }
    const pdata = await post.json().catch(() => ({}));
    const pmsg = (pdata && (pdata.message || pdata.error)) || '';
    // A 2xx can still say no (vendor page: "someone else took this space").
    const declined = post.ok && (pdata.success === false || /someone else took|no longer available|already (been )?taken|class is full/i.test(pmsg));
    if (!post.ok || declined) {
      restore();
      if (post.status !== 401) toast(pmsg || "Couldn't claim the spot", declined ? 'info' : 'error');
      fetchMyBookings();
      return false;
    }
    PsycleEvents.emit('waitlist:claimed', eventId);
    // Pre-mark so the refetch below doesn't announce our own claim as a
    // surprise allocation; undone if no seat materialises.
    const memBefore = _readWaitlistPlaces();
    _markPlaceClaimed(eventId);
    // The seat now lives in GET /bookings; a full refresh drives calendar,
    // widget, reminders and history off the real booking — and is the only
    // thing we trust before telling the user they're booked.
    const applied = await fetchMyBookings();
    _syncCardButtonsForEvent(eventId);
    const nowBooked = _myBookings[key];
    if (nowBooked && !nowBooked.waitlisted) {
      if (typeof haptic === 'function') { try { haptic('success'); } catch {} }
      toast("Spot claimed — you're booked in!", 'success');
      if ((nowBooked.slots || []).length) _recordBikeHistory(eventId, nowBooked.slots);
      PsycleEvents.emit('booking:complete', eventId, nowBooked.slots || [], btn);
      showBookingConfirmation(eventId, nowBooked.slots || []);
    } else {
      // No seat yet: restore the memory so a later real allocation IS announced.
      _writeWaitlistPlaces(memBefore);
      restore();
      toast(applied === false
        ? "Psycle responded OK but the booking isn't showing yet — pull to refresh My Bookings"
        : "Psycle responded OK but no booking is showing yet — check My Bookings shortly", 'info');
    }
    return true;
  } catch (e) {
    restore();
    // Never the raw "Load failed". (A POST that threw never gets here — it is
    // settled against /bookings above.)
    toast(_friendlyError(e, "Couldn't claim the spot"), 'error');
    return false;
  }
}

// ── Bike-preference memory ───────────────────────────────────────
// Remembers which slots the user books, keyed by studio + instructor, so the
// bike picker can surface and pre-select their "usual" spot next time.
// Shape: { [studioId]: { [instructorId]: { [slotNumber]: count } } }
const BIKE_HISTORY_KEY = 'psycle_bike_history';

function _getBikeHistory() {
  try { return JSON.parse(localStorage.getItem(BIKE_HISTORY_KEY) || '{}'); }
  catch { return {}; }
}

function _recordBikeHistory(eventId, slots) {
  if (!slots || !slots.length) return;
  const evt = _eventCache[String(eventId)];
  if (!evt) return;
  const studioId = evt.studio_id;
  const instructorId = evt.instructor_id;
  if (studioId == null || instructorId == null) return;
  const hist = _getBikeHistory();
  const sKey = String(studioId);
  const iKey = String(instructorId);
  if (!hist[sKey]) hist[sKey] = {};
  if (!hist[sKey][iKey]) hist[sKey][iKey] = {};
  slots.map(Number).filter(Boolean).forEach(slot => {
    const slotKey = String(slot);
    hist[sKey][iKey][slotKey] = (hist[sKey][iKey][slotKey] || 0) + 1;
  });
  try { localStorage.setItem(BIKE_HISTORY_KEY, JSON.stringify(hist)); }
  catch (e) { console.warn('[psycle] bike history save failed:', e); }
}

// Most-booked slot number for an event's studio+instructor, or null.
function _usualSlotForEvent(eventId) {
  const evt = _eventCache[String(eventId)];
  if (!evt || evt.studio_id == null || evt.instructor_id == null) return null;
  const byInstr = _getBikeHistory()[String(evt.studio_id)];
  const counts = byInstr && byInstr[String(evt.instructor_id)];
  if (!counts) return null;
  let bestSlot = null, bestCount = 0;
  Object.keys(counts).forEach(slotKey => {
    const c = Number(counts[slotKey]) || 0;
    if (c > bestCount) { bestCount = c; bestSlot = Number(slotKey); }
  });
  return bestCount > 0 ? bestSlot : null;
}

// ── pure:booking:start ── (DOM-free; tests/suites/booking.js evaluates these blocks)
// A real seat — as opposed to a seatless waitlist place, or nothing.
function _isRealSeat(entry) {
  return !!(entry && !entry.waitlisted &&
    (entry.bookingId || (entry.slots || []).length || (entry.bookingIds || []).length));
}

// Every booking-record id an entry knows of (deduped, order kept).
function _knownBookingIds(entry) {
  const ids = [];
  const add = id => { if (id != null && id !== '' && !ids.some(x => String(x) === String(id))) ids.push(id); };
  if (!entry) return ids;
  (Array.isArray(entry.bookingIds) ? entry.bookingIds : []).forEach(add);
  Object.keys(entry.slotBookings || {}).forEach(k => add(entry.slotBookings[k]));
  add(entry.bookingId);
  return ids;
}

// The entry for an event after booking `newSlots` (record id `bookingId`; null
// while unknown) ON TOP OF whatever seat was already held there. "+ Add spot"
// adds to a booking — Psycle keeps one record per seat — so the seats and
// record ids already held must survive, or the app forgets a seat that stays
// booked (and chargeable) and a whole cancel removes only half of it.
// Idempotent: the optimistic entry is seeded with it, then the confirmed write
// runs it again over that seed.
function _mergeBookedSeats(prevEntry, newSlots, bookingId) {
  const prev = _isRealSeat(prevEntry) ? prevEntry : null;
  const slots = prev ? (prev.slots || []).map(Number) : [];
  const slotBookings = Object.assign({}, prev ? prev.slotBookings : null);
  (newSlots || []).map(Number).forEach(s => {
    if (!slots.includes(s)) slots.push(s);
    // One POST returns ONE id however many seats it booked, so new seats can
    // share it until /bookings is re-read — _seatCancelId never trusts that.
    if (bookingId != null) slotBookings[s] = bookingId;
  });
  const bookingIds = _knownBookingIds(prev);
  if (bookingId != null && !bookingIds.some(x => String(x) === String(bookingId))) bookingIds.push(bookingId);
  const entry = { bookingId: bookingId || (prev && prev.bookingId) || null, bookingIds, slots, slotBookings, waitlisted: false };
  if (prev && prev.fromWaitlist) entry.fromWaitlist = true;
  return entry;
}

// `entry` without seat `slotId` and its record `recordId` — what is left of a
// booking once Change spot has released that seat (null: nothing). Another
// seat still mapped to the dead id loses it, so _seatCancelId sends that seat's
// next action to /bookings rather than at a 404. Never mutates `entry`.
function _withoutSeat(entry, slotId, recordId) {
  if (!_isRealSeat(entry)) return null;
  const dead = id => recordId != null && id != null && String(id) === String(recordId);
  const slots = (entry.slots || []).map(Number).filter(s => s !== Number(slotId));
  const slotBookings = {};
  Object.keys(entry.slotBookings || {}).forEach(k => {
    if (Number(k) !== Number(slotId) && !dead(entry.slotBookings[k])) slotBookings[k] = entry.slotBookings[k];
  });
  const bookingIds = _knownBookingIds({ bookingIds: entry.bookingIds, slotBookings, bookingId: entry.bookingId }).filter(id => !dead(id));
  if (!slots.length && !bookingIds.length) return null;
  const keepsId = bookingIds.some(id => String(id) === String(entry.bookingId));
  const left = { bookingId: keepsId ? entry.bookingId : (bookingIds[0] || null), bookingIds, slots, slotBookings, waitlisted: false };
  if (entry.fromWaitlist) left.fromWaitlist = true;
  return left;
}

// The booking-record id that is provably seat `slotId`'s OWN, or null when
// local state can't say: no id yet, or an id shared with another seat (see
// above). A per-seat cancel must re-read /bookings on null — falling back to
// the entry's id can DELETE the other seat's record.
function _seatCancelId(booking, slotId) {
  if (!_isRealSeat(booking)) return null;
  const sb = booking.slotBookings || {};
  const own = sb[slotId];
  if (own != null && own !== '') {
    const shared = Object.keys(sb).some(k => String(k) !== String(slotId) && sb[k] != null && String(sb[k]) === String(own));
    return shared ? null : own;
  }
  // No per-seat id: the entry id is only this seat's when it is the ONLY seat
  // and the only record.
  const slots = (booking.slots || []).map(Number);
  const only = slots.length === 1 && slots[0] === Number(slotId) && _knownBookingIds(booking).length === 1;
  return only ? booking.bookingId || null : null;
}

// A booking entry that can't list all its records yet: fewer record ids than
// seats (two seats sharing the one id their POST returned, or a new seat whose
// 2xx carried none) — or no id at all. A whole cancel built from it DELETEs
// part of the booking (or falls back to an event-wide DELETE), then reports
// all of it cancelled — the rest stays booked, and chargeable.
function _recordIdsIncomplete(entry) {
  if (!entry || entry.waitlisted) return false;
  const known = _knownBookingIds(entry).length;
  return known === 0 || known < (entry.slots || []).length;
}

// What a re-read of /bookings says about a POST whose own answer couldn't be
// trusted. `applied`: the re-read really was applied (not failed / late /
// superseded). `entry`: the event's entry afterwards. `requested`: slot ids
// asked for ([] = a no-layout count body). `idsBefore`: records held going in.
//   booked  — everything asked for is there
//   partial — a seat is held in this class, but not (all of) what was asked for
//   none    — no seat in this class
//   unknown — couldn't tell. NEVER present this as booked or as failed.
function _bookingOutcome(applied, entry, requested, idsBefore) {
  const want = (requested || []).map(Number);
  if (applied !== true) return { kind: 'unknown', landed: [], missing: [] };
  if (!_isRealSeat(entry)) return { kind: 'none', landed: [], missing: want };
  if (want.length) {
    const have = (entry.slots || []).map(Number);
    const landed = want.filter(s => have.includes(s));
    const missing = want.filter(s => !have.includes(s));
    return { kind: missing.length ? 'partial' : 'booked', landed, missing };
  }
  // Count body: it landed if there is one more record than before.
  const grew = _knownBookingIds(entry).length > (Number(idsBefore) || 0);
  return { kind: grew ? 'booked' : 'partial', landed: [], missing: [] };
}
// ── pure:booking:end ──

// One trailing refetch shared by every POST outcome. /bookings is the only
// source of per-seat record ids, so what we write locally after a POST is
// provisional until it has been re-read.
let _bookingsRefetchTimer = null;
function _scheduleBookingsRefetch(delayMs) {
  clearTimeout(_bookingsRefetchTimer);
  // Token gone by then (session expired meanwhile): fetchMyBookings' no-token
  // branch would empty the bookings an expiry deliberately keeps.
  _bookingsRefetchTimer = setTimeout(() => { _bookingsRefetchTimer = null; if (getBearerToken()) fetchMyBookings(); }, delayMs || 400);
}

// Classes whose last POST /bookings ended with no verifiable outcome — it MAY
// have booked. No further POST for that class goes out until /bookings has
// been re-read: a blind retry is how a second seat gets booked and charged.
const _unverifiedBookings = {};
const BOOKING_VERIFY_DEADLINE_MS = 10000; // GET retries can run past a minute; a tap must settle sooner

// fetchMyBookings under a deadline. True only when a fresh /bookings snapshot
// was really applied (it resolves false when superseded by a concurrent fetch,
// so that gets one more go while the answer still matters).
// No token = nothing can be read: fetchMyBookings' signed-out branch answers
// true for an EMPTIED map, which would pass here as a verified "no seat" (the
// first go can 401 and expire the session, so the second checks again).
async function _rereadBookingsForVerify() {
  const t0 = Date.now();
  const attempt = async () => {
    if (!getBearerToken()) return false;
    if ((await fetchMyBookings()) === true) return true;
    if (!getBearerToken()) return false;
    return Date.now() - t0 < BOOKING_VERIFY_DEADLINE_MS && (await fetchMyBookings()) === true;
  };
  try {
    return (await Promise.race([attempt(), new Promise(r => setTimeout(() => r(false), BOOKING_VERIFY_DEADLINE_MS))])) === true;
  } catch (e) { return false; }
}

// A seat /bookings has confirmed: button from the server's entry, then the
// same announcements the plain success path makes.
function _announceVerifiedSeats(eventId, btn, entry, landed) {
  applyBookedState(btn, eventId, entry);
  if (landed.length) _recordBikeHistory(eventId, landed);
  showBookingConfirmation(eventId, landed);
  PsycleEvents.emit('booking:complete', eventId, landed, btn);
}

// A POST /bookings whose own answer can't be trusted: a timeout/5xx may have
// booked server-side; a 409/"already" means "you hold it" OR "someone else
// took it". Guessing is costly both ways (a wrong "failed" invites a second,
// chargeable POST; a wrong "booked" is a phantom seat) — so re-read /bookings
// and announce only what it shows. `conflict`: the server refused, as opposed
// to never answering. Never throws.
//
// Label contract (reliability.js, theme.js and _bookEventHeadless all read
// it): ✓ + .booked ONLY when /bookings shows a seat in this class. _myBookings
// is then the server's own snapshot and the optimistic wrapper leaves it be;
// every other outcome carries neither, so the wrapper drops its optimistic entry.
//
// `serverMsg`: once a re-read has shown NO seat, the server's own reason is
// the most truthful thing to say (this API answers some business refusals
// with a 500) — except an "already booked", which the re-read just disproved.
async function _settleUnverifiedBooking(eventId, slots, btn, idsBefore, conflict, serverMsg) {
  const key = String(eventId);
  const requested = slots ? slots.map(Number) : [];
  const applied = await _rereadBookingsForVerify();
  const entry = _myBookings[key];
  const outcome = _bookingOutcome(applied, entry, requested, idsBefore);
  try {
    const SL = slotLabelForEvent(eventId);
    // A framework's stock error body is not a reason: Psycle's 500 answers
    // {"message":"Server Error"}, and that raw text was toasted in place of the
    // member wording below. A real reason ("Not enough credits") still shows.
    const stock = /^(server error|internal server error|service unavailable|bad gateway|gateway time-?out|error)\.?$/i;
    const reason = (typeof serverMsg === 'string' && !stock.test(serverMsg.trim())) ? serverMsg : '';
    if (outcome.kind === 'booked') {
      delete _unverifiedBookings[key];
      _announceVerifiedSeats(eventId, btn, entry, requested);
      return;
    }
    // Anything short of "booked" after a POST that never answered may still
    // land: hold the next POST for this class until a re-read clears it.
    // Seats that DID land are announced below, once: only the missing ones stay
    // in question, or the next tap announces (and counts) them all over again.
    // ('unknown' and count bodies have no missing list — they keep `requested`.)
    if (conflict) delete _unverifiedBookings[key];
    else _unverifiedBookings[key] = { slots: (outcome.kind === 'partial' && requested.length) ? outcome.missing : requested, idsBefore };
    // What we show next is provisional (and without a ✓ the optimistic wrapper
    // restores its pre-POST entry) — let the server correct it shortly.
    _scheduleBookingsRefetch(3000);
    if (outcome.kind === 'partial') {
      // Still holding a seat here, just not (all of) what was asked for.
      if (outcome.landed.length) _announceVerifiedSeats(eventId, btn, entry, outcome.landed);
      else applyBookedState(btn, eventId, entry);
      const many = outcome.missing.length > 1;
      const what = requested.length ? formatSlots(SL, outcome.missing) : 'The extra space';
      // Nothing new landed after a 5xx that gave a reason ("Not enough
      // credits"): say it, as the 'none' branch does — or every retry re-opens
      // the picker and fails the same way. The subject stays: the button still
      // reads as booked (the seat held before), so a bare reason would not.
      const said = (!conflict && !outcome.landed.length && reason && !/already/i.test(reason)) ? reason : '';
      const notShowing = `${what} ${many ? "aren't" : "isn't"} showing as booked`;
      toast(conflict
        ? (requested.length ? `${what} ${many ? 'were' : 'was'} just taken — pick another` : "Psycle didn't add another space — you already hold one in this class")
        : (said ? `${notShowing} — Psycle said: ${said}` : `${notShowing} — check My Bookings before trying again`),
        conflict ? 'info' : 'error');
      return;
    }
    btn.className = 'book-btn';
    btn.disabled = false;
    if (outcome.kind === 'none') {
      const said = (reason && !/already/i.test(reason)) ? reason : '';
      btn.textContent = conflict ? 'Book' : 'Failed — retry';
      toast(said || (conflict
        ? (requested.length ? `That ${SL.toLowerCase()} was just taken — pick another` : "Psycle wouldn't take that booking — the class may have just filled up")
        : "Psycle didn't confirm that booking and it isn't showing in My Bookings — try again"),
        conflict ? 'info' : 'error');
    } else {
      btn.textContent = 'Unconfirmed — retry';
      toast("Couldn't confirm that booking with Psycle — check My Bookings before trying again", 'error');
    }
  } catch (e) { console.warn('[psycle] settling an unverified booking failed:', e); }
}

// Before another POST for a class whose last one is unverified: settle the
// old one first. Resolves true when it is safe to carry on booking.
async function _clearUnverifiedBooking(eventId, btn) {
  const key = String(eventId);
  const pending = _unverifiedBookings[key];
  if (!pending) return true;
  const applied = await _rereadBookingsForVerify();
  const entry = _myBookings[key];
  const outcome = _bookingOutcome(applied, entry, pending.slots, pending.idsBefore);
  const landed = outcome.kind === 'booked' ? pending.slots : outcome.landed;
  if (outcome.kind !== 'unknown') delete _unverifiedBookings[key];
  if (outcome.kind !== 'unknown' && outcome.kind !== 'booked' && !landed.length) return true; // it never landed — book normally
  // From here the answer is "do NOT send another POST" — a hiccup while saying
  // so must not turn into a thrown "Booking failed" further up.
  try {
    if (outcome.kind === 'unknown') {
      btn.className = 'book-btn';
      btn.disabled = false;
      btn.textContent = 'Unconfirmed — retry';
      toast("Still can't confirm your last booking attempt with Psycle — check My Bookings before booking again", 'error');
    } else {
      _announceVerifiedSeats(eventId, btn, entry, landed);
      toast("Your earlier booking went through — you're in", 'success');
    }
  } catch (e) { console.warn('[psycle] settling an earlier booking failed:', e); }
  return false;
}

// Real seats only (POST /bookings). Waitlist places are a different resource —
// see joinWaitlist(). `opts` stays in the signature because every wrapper in
// the monkey-patch chain forwards four arguments; a legacy {waitlist:true}
// caller is redirected rather than POSTing a body the server rejects.
async function submitBooking(eventId, slots, btn, opts = {}) {
  // slots: array of slot IDs (layout studios), or null for no-layout booking.
  // opts.spaces: for studios POSITIVELY known to have no layout, the number of
  // spaces to book — Psycle's own client sends `slots: <count>` there and the
  // server rejects a body without slots ("Booking slot required").
  if (opts && opts.waitlist) return joinWaitlist(eventId, btn);
  btn.disabled = true;
  _busyLabel(btn);
  // The one choke point every booking path shares (picker, last-seat confirm,
  // no-layout, weekly template): an earlier POST for this class that may have
  // landed is settled before another goes out.
  if (!(await _clearUnverifiedBooking(eventId, btn))) return;
  // Records held going in — how a count body is judged if this POST's own
  // answer can't be trusted.
  const idsBefore = _knownBookingIds(_isRealSeat(_myBookings[String(eventId)]) ? _myBookings[String(eventId)] : null).length;
  try {
    const body = { event_id: eventId };
    if (slots && slots.length) body.slots = slots.map(Number);
    else if (opts && Number(opts.spaces) > 0) body.slots = Number(opts.spaces);
    const res = await apiFetch('/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      const label = slots?.length ? `${formatSlots(slotLabelForEvent(eventId), slots)} ✓` : 'Booked ✓';
      btn.textContent = label;
      btn.className = 'book-btn booked';
      // The card with it, as applyBookedState does: left to the refetch below,
      // "Only 1 left" sat under "Bike 2 ✓" for a second — and for good when
      // that refetch failed (CSS hides the line on .is-booked).
      const card = typeof btn.closest === 'function' ? btn.closest('.class-card') : null;
      if (card) {
        card.classList.add('is-booked');
        card.classList.remove('is-waitlisted');
      }
      const bookingId = data?.data?.id || data?.id;
      if (bookingId) btn.dataset.bookingId = bookingId;
      btn.dataset.eventId = eventId;
      // Update local bookings state
      const slotsArr = slots ? slots.map(Number) : [];
      // A place we held on the waitlist for this class is superseded by the seat
      // (kept attached; forgotten as a "held place" so it can't later be
      // mistaken for a Psycle allocation).
      const prevEntry = _myBookings[String(eventId)];
      const prevPlace = prevEntry?.waitlist;
      // The new seat(s) JOIN whatever was already held here ("+ Add spot", or a
      // no-layout "one more space"): keep every seat and record id, so the card
      // shows them all and a cancel removes the right records. The API creates
      // one booking per slot but returns one id — new slots all map to it until
      // the refetch below corrects them.
      _myBookings[String(eventId)] = _mergeBookedSeats(prevEntry, slotsArr, bookingId);
      if (_myBookings[String(eventId)].slots.length > slotsArr.length) {
        btn.textContent = `${formatSlots(slotLabelForEvent(eventId), _myBookings[String(eventId)].slots)} ✓`;
      }
      if (prevPlace) { _myBookings[String(eventId)].waitlist = prevPlace; _rememberPlace(eventId, null); }
      delete _unverifiedBookings[String(eventId)];
      _noteLocalBookingWrite();
      // Remember the booked slot(s) per studio+instructor for next time.
      if (slotsArr.length) _recordBikeHistory(eventId, slotsArr);
      btn.onclick = () => confirmUnbook(bookingId || null, eventId, btn);
      showBookingConfirmation(eventId, slotsArr);
      refreshUpcomingPanel();
      PsycleEvents.emit('booking:complete', eventId, slotsArr, btn);
      // Swap the provisional entry for the server's (real per-seat record ids).
      _scheduleBookingsRefetch();
    } else if (res.status === 409 || res.status >= 500 || (data.message || '').toLowerCase().includes('already')) {
      // Neither says what happened: a 409/"already" is "you hold it" OR "someone
      // else took it", and a 5xx can follow a booking that did land.
      await _settleUnverifiedBooking(eventId, slots, btn, idsBefore, res.status < 500, data.message || data.error);
    } else if (res.status !== 401) {
      // 401 is handled globally by apiFetch → showSessionExpired(). Every
      // other failure — including 403 business-rule denials (plan doesn't
      // cover the class, no credits left) — surfaces the server's reason.
      btn.textContent = 'Failed — retry';
      btn.disabled = false;
      toast(data.message || data.error || `Error ${res.status}`, 'error');
    } else {
      btn.textContent = 'Book';
      btn.disabled = false;
    }
  } catch (e) {
    // Timeout / dropped connection: the POST may have booked server-side (it is
    // never auto-retried), so "Failed" would be a guess that invites a second,
    // chargeable attempt. Ask /bookings instead of surfacing a raw "Load failed".
    console.warn('[psycle] POST /bookings gave no answer:', e);
    await _settleUnverifiedBooking(eventId, slots, btn, idsBefore, false);
  }
}

// Feature 9: Post-booking confirmation overlay
let _confirmationTimer = null;
function showBookingConfirmation(eventId, slotsArr, opts = {}) {
  // Remove any existing confirmation
  dismissBookingConfirmation();

  const evt = _eventCache[String(eventId)];
  const typeName = evt?._typeName || 'Class';
  const instrName = evt?._instrName || '';
  const _SL = slotLabelForEvent(eventId);

  // Format date/time
  let dateTimeStr = '';
  if (evt?.start_at) {
    const d = new Date(evt.start_at);
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    dateTimeStr = `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}, ${_clock24(d.getHours(), d.getMinutes())}`;
  }

  // Seats only (a waitlist place has nothing to late-cancel): say up front
  // when cancelling stops being free — same helper as the card and the dialog.
  const deadline = (!opts.waitlist && evt?.start_at) ? _cancelDeadline(evt.start_at) : null;
  const cancelLine = !deadline ? ''
    : (deadline.insideWindow ? 'Inside the 12-hour late-cancel window' : `Free cancel until ${deadline.label}`);
  // Inside the window this line IS the late-cancel message, so it wears that
  // message's one class rather than being dimmed like the date above it.
  const cancelLineCls = (deadline && deadline.insideWindow) ? 'late-cancel-note' : 'bc-dim';
  // A place joined close to class is not booked in automatically any more —
  // same clock, same words as the Waitlisted card in My Bookings.
  const waitlistLine = !opts.waitlist ? ''
    : (evt?.start_at && _waitlistPhase(evt.start_at) === 'offers'
      ? 'This close to class Psycle usually emails an offer instead of booking you in — check for a spot in My Bookings (keep a credit free)'
      : 'Psycle books you in automatically if a spot frees up — keep a credit free');

  // Build slot label
  const slotStr = formatSlots(_SL, slotsArr);

  // Class info line
  const classLine = [typeName, instrName].filter(Boolean).join(' \u00b7 ');
  // Shown in the sheet and spoken below: one string, so they can't drift.
  const title = opts.waitlist ? (opts.already ? 'Already on the waitlist' : 'On the waitlist!') : 'Booked!';

  // Crisp Colour: the tick sits in the class's own colour and the seat is the
  // seat badge with the glow (it is yours now); the two buttons stay neutral
  // pills, outside the data-ct block. (typeof: the suites run this on its own.)
  const ctKey = typeof classTypeKey === 'function' ? classTypeKey(typeName) : 'other';
  const tickMark = typeof _uiIcon === 'function' ? _uiIcon('tick', 22) : '&#10003;';

  const el = document.createElement('div');
  el.id = 'bookingConfirmation';
  el.className = 'booking-confirmation';
  el.innerHTML = `
    <div class="bc-content" data-ct="${ctKey}">
      <div class="bc-check" aria-hidden="true">${tickMark}</div>
      <div class="bc-text">
        <div class="bc-title">${title}</div>
        <div class="bc-detail">${escapeHTML(classLine)}</div>
        ${dateTimeStr ? `<div class="bc-detail bc-dim">${escapeHTML(dateTimeStr)}</div>` : ''}
        ${cancelLine ? `<div class="bc-detail ${cancelLineCls}">${escapeHTML(cancelLine)}</div>` : ''}
        ${waitlistLine ? `<div class="bc-detail bc-dim">${escapeHTML(waitlistLine)}</div>` : ''}
        ${slotStr ? `<div class="bc-slot ct-badge is-seat glow-mine">${slotStr}</div>` : ''}
      </div>
    </div>
    <div class="bc-actions">
      <button class="bc-btn bc-btn-secondary pill-btn pill-neutral" onclick="dismissBookingConfirmation();(typeof switchTab==='function'?switchTab('bookings'):scrollToUpcoming())">View my bookings</button>
      <button class="bc-btn bc-btn-primary pill-btn pill-primary" onclick="dismissBookingConfirmation()">Done</button>
    </div>
  `;
  document.body.appendChild(el);

  // Trigger animation on next frame — unless it was dismissed before that frame
  // came (the usual-week run dismisses each sheet as soon as its booking
  // settles): sliding a dismissed sheet IN would flash it over the run's own.
  requestAnimationFrame(() => { if (el.id) el.classList.add('show'); });

  // The sheet slides in silently for a screen reader: say what it shows — the
  // same lines, as plain text. "& " reads as "and" in a list of seats.
  announce([title, classLine, dateTimeStr, slotStr.replace(/ & /g, ' and '), cancelLine].filter(Boolean).join('. '));

  // Auto-dismiss after 5 seconds — but never from under someone who has moved
  // into the sheet (keyboard / VoiceOver focus on its buttons): check again later.
  const autoDismiss = () => {
    if (el.isConnected && el.contains(document.activeElement)) {
      _confirmationTimer = setTimeout(autoDismiss, 5000);
      return;
    }
    dismissBookingConfirmation();
  };
  _confirmationTimer = setTimeout(autoDismiss, 5000);
}

function dismissBookingConfirmation() {
  clearTimeout(_confirmationTimer);
  _confirmationTimer = null;
  // A dismissed sheet gives up its id at once: it stays in the document while it
  // slides out, and getElementById returns the FIRST match — so two bookings
  // settling inside that window (the usual-week run) dismissed the dying sheet
  // twice and left the new one, its timer just cleared, on screen for good.
  // Whoever asks "is the Booked! sheet up?" by that id now gets the live one only.
  document.querySelectorAll('#bookingConfirmation').forEach((el) => {
    el.removeAttribute('id');
    el.classList.remove('show');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
    // Fallback removal if transition doesn't fire
    setTimeout(() => { if (el.parentNode) el.remove(); }, 400);
  });
}

function scrollToUpcoming() {
  const panel = document.getElementById('upcomingPanel');
  if (panel) {
    panel.style.display = '';
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

/**
 * Promise-based confirmation modal matching the app's visual language.
 * Replaces the native confirm() so we can render warnings with proper
 * hierarchy (title, body, optional warn line, distinct buttons).
 *
 * confirmModal({ title, body, warn?, warnClass?, confirmText?, cancelText?, danger? })
 *   → Promise<boolean>
 * warnClass: extra class on the warn line (the late-cancel dialog passes
 * 'late-cancel-note' so that message looks the same everywhere it appears).
 */
function confirmModal(opts) {
  opts = opts || {};
  return new Promise(resolve => {
    // Single-instance: a dialog we replace must SETTLE (as cancelled), or the
    // flow awaiting it hangs forever (stuck buttons, busy flags never cleared).
    const stale = document.getElementById('psycleConfirmOverlay');
    if (stale) {
      // Tell an opted-in owner it was displaced (not dismissed) so it can re-show.
      if (typeof stale._psycleReplaced === 'function') { try { stale._psycleReplaced(); } catch (e) {} }
      if (typeof stale._psycleClose === 'function') { try { stale._psycleClose(false); } catch (e) {} }
      stale.remove();
    }

    const previouslyFocused = document.activeElement;

    const overlay = document.createElement('div');
    overlay.id = 'psycleConfirmOverlay';
    overlay.className = 'confirm-overlay';
    // Named and described, so a screen reader reads the credit / late-cancel
    // copy on open instead of just "dialog". Fixed ids are safe: the dialog is
    // single-instance and a stale one is removed above, before this is built.
    const describedBy = [opts.body && 'psycleConfirmBody', opts.warn && 'psycleConfirmWarn'].filter(Boolean).join(' ');
    // Crisp Colour: a destructive choice is a CALM danger outline; the filled red
    // (.is-solid) is kept for the two confirms that cost something for good —
    // see _confirmTone, right under this function.
    const tone = _confirmTone(opts);
    // The warn line leads with the caution mark (decorative: the sentence says
    // it, and aria-describedby reads the sentence). typeof: suites run this
    // function without the pure:sheets block that holds _uiIcon.
    const warnMark = typeof _uiIcon === 'function' ? _uiIcon('caution', 16) : '';
    overlay.innerHTML = `
      <div class="confirm-dialog" role="dialog" aria-modal="true" tabindex="-1"${opts.title ? ' aria-labelledby="psycleConfirmTitle"' : ''}${describedBy ? ` aria-describedby="${describedBy}"` : ''}>
        ${opts.title ? `<div class="confirm-title" id="psycleConfirmTitle">${escapeHTML(opts.title)}</div>` : ''}
        ${opts.body ? `<div class="confirm-body" id="psycleConfirmBody">${escapeHTML(opts.body)}</div>` : ''}
        ${opts.warn ? `<div class="confirm-warn${opts.warnClass ? ' ' + escapeHTML(opts.warnClass) : ''}" id="psycleConfirmWarn">${warnMark}<span>${escapeHTML(opts.warn)}</span></div>` : ''}
        <div class="confirm-actions">
          <button class="confirm-btn confirm-btn-cancel">${escapeHTML(opts.cancelText || 'Keep booking')}</button>
          <button class="confirm-btn ${tone === 'primary' ? 'confirm-btn-primary' : 'confirm-btn-danger' + (tone === 'danger-solid' ? ' is-solid' : '')}">${escapeHTML(opts.confirmText || 'Confirm')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));

    // Light haptic when the dialog appears (native bridge on iOS, noop on web)
    if (typeof haptic === 'function') { try { haptic('tap'); } catch {} }

    let settled = false;
    const close = result => {
      if (settled) return;
      settled = true;
      overlay._psycleClosing = true; // still rendered while it fades: not a dialog to announce into (_dialogLiveRegion)
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 180);
      document.removeEventListener('keydown', onKey);
      // Restore focus to the element that opened the modal — or to its visible
      // stand-in when that element has been hidden meanwhile (_visibleOpener).
      const back = _visibleOpener(previouslyFocused);
      if (back && typeof back.focus === 'function') {
        try { back.focus(); } catch {}
      }
      if (typeof haptic === 'function') {
        try { haptic(result ? 'success' : 'tap'); } catch {}
      }
      resolve(result);
    };

    // Focus trap: keep Tab inside the dialog
    const focusables = () => Array.from(
      overlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ).filter(el => !el.disabled && el.offsetParent !== null);

    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); close(false); return; }
      if (e.key === 'Enter') {
        // A key still held from whatever opened this dialog (Enter on a Cancel
        // button, or on a seat in the picker) auto-repeats — and focus lands on
        // the confirm button 50ms in. That must never confirm a chargeable
        // action; preventDefault also stops the button's own click.
        if (e.repeat) { e.preventDefault(); return; }
        // Only hijack Enter if focus is inside the dialog (not in a textarea etc.)
        if (overlay.contains(document.activeElement) && document.activeElement.tagName !== 'TEXTAREA') {
          e.preventDefault();
          close(true);
        }
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !overlay.contains(active))) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && (active === last || !overlay.contains(active))) {
        e.preventDefault(); first.focus();
      }
    };

    overlay.querySelector('.confirm-btn-cancel').onclick = () => close(false);
    overlay.querySelector('.confirm-btn-primary, .confirm-btn-danger').onclick = () => close(true);
    overlay.onclick = e => { if (e.target === overlay) close(false); };
    overlay._psycleClose = close; // lets a replacing dialog cancel this one cleanly
    if (typeof opts.onReplaced === 'function') overlay._psycleReplaced = opts.onReplaced;
    document.addEventListener('keydown', onKey);

    // Focus the primary action so Enter confirms and screen readers land on it
    setTimeout(() => overlay.querySelector('.confirm-btn-primary, .confirm-btn-danger')?.focus(), 50);
  });
}

// ── pure:sheets:start ──
// How a confirm's action button is drawn: 'primary' | 'danger' | 'danger-solid'.
// `danger: true` alone is the calm outline — signing out, leaving a waitlist, a
// free cancel: nothing is lost that cannot be had again. The filled red is for
// the two confirms that cost something for good: a cancel inside the 12-hour
// window (its warn line wears 'late-cancel-note' — confirmCancelWithPolicy is
// the only caller that passes it) and a deletion that cannot be undone
// (`irreversible: true` — handing a calendar over to the sync). Never solid
// without `danger`: a booking confirm is never red, whatever its warn line says.
// (Kept between confirmModal and its export: tests/suites/a11y.js runs that slice.)
function _confirmTone(opts) {
  if (!opts || !opts.danger) return 'primary';
  const lateCancel = /(^|\s)late-cancel-note(\s|$)/.test(String(opts.warnClass == null ? '' : opts.warnClass));
  return (lateCancel || opts.irreversible === true) ? 'danger-solid' : 'danger';
}

// Where focus goes back to when a dialog closes. Usually the element that
// opened it — but My Bookings' "Add spot" sits in the card's More menu, and on
// a phone that menu closes (display: none) the moment the picker or confirm
// takes focus: focus() on a button in there is a no-op, and the member was
// dropped on <body>, at the top of the page. Its visible stand-in is that
// menu's own More button. (At desktop widths the menu is laid out inline, the
// item is on screen, and it takes focus back itself, as before.) Used by
// confirmModal above and by _syncOverlayStack; kept in this slice for a11y.js.
function _visibleOpener(el) {
  const menu = el && typeof el.closest === 'function' ? el.closest('.mb-more-menu') : null;
  if (!menu || menu.offsetParent !== null) return el;
  const btn = menu.parentElement ? menu.parentElement.querySelector('.mb-more-btn') : null;
  return btn && btn.offsetParent !== null ? btn : el;
}
// ── pure:sheets:end ──
window.confirmModal = confirmModal;

// ── Sheets and panels: one focus stack, one key handler ──────────────────
// Only confirmModal (above) and the first-run tour looked after the keyboard.
// The other nine overlays are plain divs opened all over the app and closed —
// mostly — by an inline `.remove()`: Escape did nothing, Tab wandered into the
// page behind, and closing one dropped focus back at the top of the document.
// Handled HERE, once, rather than per dialog: per-dialog document listeners
// would close Diagnostics AND the Settings panel under it on one Escape.
//
// [element id, how Escape closes it]. The overlay's REAL closer where it has
// one — closeBikePicker also drops the swap context, and the sync prompt must
// not be dismissed mid-sync (same rule as its backdrop) — else remove(), which
// is what that overlay's own × does. Called by name at key time, so a later
// module's wrapper is the one that runs.
const _OVERLAYS = [
  ['tokenDialog', () => closeTokenDialog()],
  ['bikeModal', () => closeBikePicker()],
  ['syncPromptOverlay', () => {
    const syncBtn = document.getElementById('syncPromptBtn');
    if (!(syncBtn && syncBtn.disabled)) _dismissSyncPrompt();
  }],
  ['classDetailOverlay', null],
  ['historyModalOverlay', null],
  ['instructorModalOverlay', null],
  ['yearReviewOverlay', null],
  ['settingsOverlay', () => window.closeSettings()],
  ['diagOverlay', () => window.closeDiagnostics()],
];
const _overlayStack = []; // { el, opener, close } in the order they opened — the last is on top

// Seven are built on open and removed on close (present = showing); the token
// dialog and the bike picker are static markup toggled by `display`.
function _overlayIsOpen(el) {
  return !!el && el.isConnected && el.style.display !== 'none';
}

// confirmModal and the tour keep their own focus and keys, above everything.
// So does the usual-week sheet (js/tabs.js): this handler's Escape would close
// whatever sits in the stack under it and, by preventDefault, stop the sheet's
// own handler from ever seeing the key.
function _ownKeysOverlayUp() {
  return !!(document.getElementById('psycleConfirmOverlay') || document.getElementById('usualWeekSheet') ||
    document.querySelector('.onboard-overlay'));
}

// Same rule as confirmModal's trap. (SVG seats have no offsetParent at all —
// undefined, not null — so the ones in the tab order count.)
function _overlayFocusables(el) {
  return Array.from(
    el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
  ).filter(n => !n.disabled && n.offsetParent !== null);
}

function _focusIntoOverlay(el) {
  let target = null;
  if (el.id === 'bikeModal') {
    // The map sits after the × in the sheet: start ON a seat — the one that
    // matters first — so the picker is usable without hunting for it.
    target = el.querySelector('.bike-slot.selected') || el.querySelector('.bike-slot.mine') ||
      el.querySelector('.bike-slot.available');
  }
  // Otherwise the panel itself (tabindex="-1"), so the dialog's name is what
  // gets read — not "Close, button" — and no input pops the iOS keyboard.
  target = target || el.querySelector('[role="dialog"]') || _overlayFocusables(el)[0];
  if (target && typeof target.focus === 'function') {
    // preventScroll: showBikePicker has just centred the map on that seat.
    try { target.focus({ preventScroll: true }); } catch (e) {}
  }
}

// Bring the stack in line with what is actually open, and move focus to match.
// Runs from the observer below (there is no close call to hook) and again
// before each key is handled. A MutationObserver callback is a microtask: by
// the time it runs, "remove the class sheet, open the instructor's profile"
// has BOTH happened, so focus goes into the new overlay instead of being
// pulled back to the card behind it.
function _syncOverlayStack() {
  const closed = [];
  let opener = null; // of the bottom-most overlay that closed — it lies outside them all
  for (let i = _overlayStack.length - 1; i >= 0; i--) {
    if (_overlayIsOpen(_overlayStack[i].el)) continue;
    closed.push(_overlayStack[i].el);
    opener = _overlayStack[i].opener;
    _overlayStack.splice(i, 1);
  }
  // Focus "fell" when it is nowhere useful. A static dialog hidden a moment ago
  // still holds activeElement until the browser's next frame.
  const fell = () => {
    const a = document.activeElement;
    return !a || a === document.body || !a.isConnected || closed.some(c => c.contains(a));
  };

  let opened = false;
  _OVERLAYS.forEach(([id, close]) => {
    const el = document.getElementById(id);
    if (!_overlayIsOpen(el) || _overlayStack.some(o => o.el === el)) return;
    // Where focus goes back to. Book disables its button while the class
    // loads, which drops focus from it — so the picker asks its own context.
    let from = fell() ? null : document.activeElement;
    if (!from && id === 'bikeModal' && _bookingContext && _bookingContext.btn) from = _bookingContext.btn;
    _overlayStack.push({ el, opener: from || opener, close });
    opened = true;
  });

  if (_ownKeysOverlayUp()) return;
  const top = _overlayStack[_overlayStack.length - 1];
  if (opened) { _focusIntoOverlay(top.el); return; }
  // Restore only if focus fell: a closer that put it somewhere on purpose wins.
  if (!closed.length || !fell()) return;
  opener = _visibleOpener(opener); // "Add spot" in a More menu that has closed → its More button
  if (opener && opener.isConnected && typeof opener.focus === 'function' && (!top || top.el.contains(opener))) {
    try { opener.focus({ preventScroll: true }); } catch (e) {}
    if (document.activeElement === opener) return;
  }
  if (top) _focusIntoOverlay(top.el); // e.g. Diagnostics closed over Settings
}

if (typeof MutationObserver === 'function' && document.body) {
  const _overlayObserver = new MutationObserver(_syncOverlayStack);
  // Every built overlay is appended to <body>: direct children are enough.
  _overlayObserver.observe(document.body, { childList: true });
  ['tokenDialog', 'bikeModal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) _overlayObserver.observe(el, { attributes: true, attributeFilter: ['style'] });
  });
}

function _activateRoleButton(el) {
  if (typeof el.click === 'function') el.click();
  else el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); // SVG has no click()
}
let _spaceDownOn = null; // the role="button" element a Space press started on

// THE document keydown for overlays and for clickable non-buttons.
document.addEventListener('keydown', function (e) {
  if (_ownKeysOverlayUp()) return;

  // Enter / Space on a div or span (or an SVG seat) that says role="button":
  // instructor names, class titles, period bars, explore names, the next-class
  // pill, picker seats. Only when the key landed on that element itself, and
  // never when a handler nearer the target already dealt with it (features.js
  // does its own class rows).
  if (e.key === 'Enter' || e.key === ' ') {
    const el = e.target;
    if (e.defaultPrevented || !el || typeof el.matches !== 'function' || !el.matches('[role="button"]:not(button)')) return;
    e.preventDefault(); // Space must not scroll the page
    if (e.repeat || el.getAttribute('aria-disabled') === 'true') return;
    // Enter acts now; Space on release — exactly as a real button does, and
    // for a reason: Space on a seat you hold opens the (chargeable) cancel
    // confirm, its danger button takes focus 50ms later, and Firefox clicks a
    // button on ANY Space keyup. Acting on keyup means the key is already up.
    if (e.key === ' ') { _spaceDownOn = el; return; }
    _activateRoleButton(el);
    return;
  }

  if (e.key !== 'Escape' && e.key !== 'Tab') return;
  _syncOverlayStack();
  const top = _overlayStack[_overlayStack.length - 1];
  if (!top) return;

  if (e.key === 'Escape') {
    if (e.defaultPrevented) return;
    e.preventDefault();
    // Only the top-most one; focus is put back by the observer.
    if (top.close) top.close(); else top.el.remove();
    return;
  }

  // Tab: keep it inside the top overlay.
  const items = _overlayFocusables(top.el);
  if (!items.length) { e.preventDefault(); return; }
  const first = items[0], last = items[items.length - 1];
  const active = document.activeElement;
  const outside = !top.el.contains(active);
  // From the panel itself (where focus lands on open) Shift+Tab would
  // otherwise walk out backwards.
  const onPanel = active === top.el.querySelector('[role="dialog"]');
  if (e.shiftKey && (active === first || outside || onPanel)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (active === last || outside)) { e.preventDefault(); first.focus(); }
});

// The other half of Space (see above): only a release on the very element the
// press started on counts — focus that moved in between (an overlay opened)
// must not turn the release into a click on whatever is focused now.
document.addEventListener('keyup', function (e) {
  if (e.key !== ' ') return;
  const el = _spaceDownOn;
  _spaceDownOn = null;
  if (!el || e.target !== el || _ownKeysOverlayUp()) return;
  e.preventDefault();
  _activateRoleButton(el);
});

/**
 * Turn a failed cancel into a user-friendly message. Distinguishes session
 * expiry (401), offline, refusals (prefers the server's `message`) and server
 * faults (5xx — never the server's text).
 * 403 is a policy denial (e.g. inside the late-cancel window) with a valid
 * session — show the server's reason, not "session expired".
 */
function describeCancelError(failedResponse, data, err, sentOnline) {
  if (err) {
    // Never a promise to retry: nothing that reaches here has queued anything.
    // Only the two whole-booking paths (confirmUnbook, upcomingCancel) hand an
    // offline cancel to reliability.js's queue — which does replay it — and
    // they say so themselves ("cancel queued. We'll send it…") and return
    // first. Per-seat cancels are never queued: here "we'll retry when you're
    // back online" left a seat booked — and charged. Never the raw text either
    // ("Load failed" on iPhone, "Request timed out"). Offline, the single
    // attempt never left the phone. Online, a DELETE is re-sent up to three
    // times and an answer that got lost may well have cancelled it — so that
    // is not ruled out: the callers re-read /bookings. `sentOnline` (the
    // per-seat callers): the phone was online when the DELETE went OUT — being
    // offline by the time it failed (wifi lost, the tube) says nothing about
    // whether it landed, so that is hedged too.
    if (!navigator.onLine && !sentOnline) return "You're offline — nothing was cancelled. Try again once you're back online.";
    return "Couldn't reach Psycle — this may not have been cancelled. Check My Bookings and try again.";
  }
  if (failedResponse) {
    if (failedResponse.status === 401) {
      return 'Session expired — sign in and try again.';
    }
    // A refusal's own text (a 403/422's "Too late to cancel") is the reason. A
    // 5xx's is not: Psycle's 500 answers {"message":"Server Error"} — a
    // framework's stock body, which was the whole toast — and says nothing of
    // whether the DELETE landed, so it gets the hedged line below (the callers
    // re-read /bookings). Same stock filter as _settleUnverifiedBooking; kept
    // inside the function because the suites slice it out on its own.
    const stock = /^(server error|internal server error|service unavailable|bad gateway|gateway time-?out|error)\.?$/i;
    const reason = (data && typeof data.message === 'string') ? data.message.trim() : '';
    if (reason && failedResponse.status < 500 && !stock.test(reason)) return reason;
    if (failedResponse.status === 403) {
      return "Psycle wouldn't allow this cancellation (it may be inside the late-cancel window).";
    }
    // No "(500)": a bare status code means nothing to a member. It is in the
    // error log all the same — reliability.js's apiFetch records the verb, the
    // path and the status of every failed answer.
    return "Psycle couldn't cancel this just now — check My Bookings.";
  }
  return 'Cancel failed';
}

// Member wording for an error THROWN on a booking / waitlist / swap path —
// never the raw "Load failed" (WebKit's fetch failure) or "HTTP 503". Narrower
// than PsycleAPI.categorizeError on purpose: that reads ANY TypeError as
// "offline" (a bug in our own code would be blamed on the member's signal) and
// a 403 as "session expired" (here a 403 is a policy refusal inside a valid
// session). So only a server fault, a rate limit, a timeout and a connection
// that really failed are mapped; anything else gets the caller's own fallback.
// api-client.js loads last — guarded, as a tap can in principle beat it.
function _friendlyError(e, fallback) {
  try {
    const api = window.PsycleAPI;
    if (!api || typeof api.categorizeError !== 'function') return fallback;
    const cat = api.categorizeError(e) || {};
    if (cat.type === 'server' || cat.type === 'timeout' || cat.type === 'rate-limit') return cat.userMessage || fallback;
    if (cat.type === 'network' && (!navigator.onLine || /load failed|failed to fetch|network/i.test((e && e.message) || ''))) {
      return cat.userMessage || fallback;
    }
  } catch (err) {}
  return fallback;
}

// ── pure:bookings-card:start ── (DOM-free; tests/suites/bookings-card.js evaluates this block)
// Psycle charges for cancelling inside 12 hours of class, and the API carries
// no deadline field — so the rule lives in this ONE helper and the booking
// card, the confirmation sheet and the cancel dialog can never disagree.
//
// `start_at` is the gym's UK wall clock with no offset, and Psycle counts the
// 12 hours from the REAL start. window._psycleClassStartMs — the Europe/London
// resolver (pure:gym-time above on the web, the bridge's copy in the iOS app;
// the one _waitlistTimeMs uses) — gives that instant, so a device that is
// abroad neither promises a free cancel inside the charge window nor holds
// back the Late-cancel badge; the deadline is then printed as London wall
// clock, like the class time beside it. Only when the resolver is missing or
// can't answer is the string parsed the way the card parses it — naive →
// device-local — which is right on a UK device.
// Returns null when the start can't be read.
let _londonPartsFmt = null; // lazy: every booking card asks, on every render

// What London's clocks read at an absolute instant: {dow, hour, minute} — or
// null when the engine has no Europe/London data (or the instant can't be
// read), and the caller keeps the device's getters. Numeric parts only, the
// weekday derived from the date: weekday and am/pm TEXT from Intl varies
// between engines.
function _londonParts(ms) {
  try {
    if (!_londonPartsFmt) {
      _londonPartsFmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      });
    }
    const p = {};
    _londonPartsFmt.formatToParts(new Date(ms)).forEach(x => { if (x.type !== 'literal') p[x.type] = Number(x.value); });
    if ([p.year, p.month, p.day, p.hour, p.minute].every(n => !isNaN(n))) {
      return {
        dow: new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(),
        hour: p.hour % 24, // some engines print midnight as 24
        minute: p.minute,
      };
    }
  } catch (e) { /* no London data: the caller's device-local digits stand */ }
  return null;
}

// "17:45" — an instant that has a London meaning (a waitlist accept-by time,
// resolved through the London resolver) printed as LONDON wall clock, like the
// class time on the card beside it. Through the device's getters a phone on
// CET read "accept by 18:45" under its 18:30 class: a deadline after the start,
// an hour past the real one. No Europe/London data in the engine → the
// resolver fell back to a device-local parse too, so the local getters match.
function _londonClock(ms) {
  const p = _londonParts(ms);
  if (p) return _clock24(p.hour, p.minute);
  const d = new Date(ms);
  return _clock24(d.getHours(), d.getMinutes());
}

function _cancelDeadline(startAt, nowMs) {
  if (startAt == null || startAt === '') return null;
  const raw = typeof startAt === 'string' ? startAt.trim() : startAt;
  let startMs = NaN;
  let london = false;
  if (typeof raw === 'string' && typeof window !== 'undefined' && typeof window._psycleClassStartMs === 'function') {
    startMs = window._psycleClassStartMs(raw);
    london = !isNaN(startMs);
  }
  if (isNaN(startMs)) startMs = new Date(typeof raw === 'string' ? raw.replace(' ', 'T') : raw).getTime();
  if (isNaN(startMs) && typeof raw === 'string') startMs = new Date(raw).getTime();
  if (isNaN(startMs)) return null;
  const now = nowMs == null ? Date.now() : nowMs;
  const deadlineMs = startMs - 12 * 3600000;
  const d = new Date(deadlineMs);
  let dow = d.getDay(), h = d.getHours(), min = d.getMinutes();
  // No Europe/London data in the engine → the bridge fell back to a
  // device-local parse too, so the local getters above already match.
  const lp = london ? _londonParts(deadlineMs) : null;
  if (lp) { dow = lp.dow; h = lp.hour; min = lp.minute; }
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow];
  return {
    deadlineMs,
    hoursUntil: (startMs - now) / 3600000,
    // AT the cutoff counts as inside — never promise a free cancel we can't be sure of.
    insideWindow: now >= deadlineMs,
    label: `${day} ${_clock24(h, min)}`, // "Sun 19:30"
  };
}

// Time left before class as whole hours + minutes, rounded ONCE on the total.
// Flooring the hour and rounding the leftover separately printed "9h 60m" at
// 9h59m40s — on the card's countdown chip AND in the cancel dialog's
// late-charge warning. Both read this, so the two can't drift apart again.
function _hoursMinsLeft(hoursUntil) {
  const total = Math.max(0, Math.round(hoursUntil * 60));
  return { hrs: Math.floor(total / 60), mins: total % 60 };
}

// "starts in 1h 45m" / "starts in 30 min", from _hoursMinsLeft's result. The
// cancel dialog's late-charge warning, the waitlist claim confirm and the
// "You're in" announcement all say it about the same 12-hour rule — worded
// once, for the same reason the arithmetic above is done once.
function _startsInPhrase(left) {
  if (left.hrs === 0) return `starts in ${Math.max(1, left.mins)} min`;
  // No "10h 0m": the card's countdown chip drops a zero minute part too
  // ("In 10h"), and the two are read side by side.
  return left.mins === 0 ? `starts in ${left.hrs}h` : `starts in ${left.hrs}h ${left.mins}m`;
}
// ── pure:bookings-card:end ──

/**
 * Ask the user to confirm cancelling a booking. When the class is inside
 * Psycle's 12-hour late-cancel window the modal surfaces a warning about
 * likely charges. Returns Promise<boolean>.
 */
function confirmCancelWithPolicy(eventId, base) {
  // (Waitlist places never reach this gate: confirmUnbook/upcomingCancel hand
  // them to leaveWaitlist, which owns its own dialog.)
  const evt = _eventCache[String(eventId)];
  // Same cutoff the booking card prints as "Free cancel until …".
  const deadline = evt ? _cancelDeadline(evt.start_at) : null;
  const hoursUntil = deadline ? deadline.hoursUntil : Infinity;
  if (deadline && deadline.insideWindow && hoursUntil > -0.5) {
    const left = _hoursMinsLeft(hoursUntil);
    const remaining = hoursUntil < 0 ? 'has already started' : _startsInPhrase(left);
    return confirmModal({
      title: base,
      warn: `This class ${remaining}. Cancellations inside 12 hours are usually charged by Psycle.`,
      // Only THIS warn is the late-cancel message; the other warn: dialogs
      // (policy reminders, clashes) keep the plain .confirm-warn.
      warnClass: 'late-cancel-note',
      confirmText: 'Cancel anyway',
      cancelText: 'Keep booking',
      danger: true,
    });
  }
  return confirmModal({
    title: base,
    confirmText: 'Cancel booking',
    cancelText: 'Keep it',
    danger: true,
  });
}

// Before a whole-booking cancel reads its record ids (call it AFTER the confirm
// dialog, then re-read the entry: an applied fetch swaps the whole map). An
// entry that can't list every record it holds is refreshed from /bookings first.
// Resolves false — and says so — when it still can't: send nothing. Offline
// included: a queued cancel we KNOW is incomplete would replay as "cancelled".
async function _readyForWholeCancel(eventId) {
  if (!_recordIdsIncomplete(_myBookings[String(eventId)])) return true;
  if (navigator.onLine && (await _rereadBookingsForVerify())) return true;
  toast("Couldn't load this booking's spots from Psycle — nothing was cancelled. Try again in a moment.", 'error');
  return false;
}

async function cancelBikeSlot(slotId, eventId) {
  const _sl3 = slotLabelForEvent(eventId);
  if (!(await confirmCancelWithPolicy(eventId, `Cancel your ${_sl3} ${slotId} booking?`))) return;
  // update hint immediately
  document.getElementById('modalHint').textContent = 'Cancelling…';
  let sentOnline = false; // was the phone online when the DELETE went out? (see describeCancelError)
  try {
    // Read AFTER the dialog: a fetch that landed meanwhile swapped the whole map.
    let booking = _myBookings[String(eventId)];
    // Only ever DELETE a record that is provably THIS seat's. Right after a
    // booking the seats can share one id (or have none yet) — the entry id may
    // be the other seat's record — so re-read /bookings rather than guess.
    let resolvedId = _seatCancelId(booking, slotId);
    if (!resolvedId) {
      // Bounded (GET retries can run past a minute); if it isn't applied the
      // stale entry still resolves to null below and nothing is sent.
      await _rereadBookingsForVerify();
      booking = _myBookings[String(eventId)];
      resolvedId = _seatCancelId(booking, slotId);
    }
    if (!resolvedId) {
      document.getElementById('modalHint').textContent = 'Nothing was cancelled — try again';
      toast(`Couldn't match ${_sl3} ${slotId} to a booking — nothing was cancelled. Pull to refresh and try again.`, 'error');
      return;
    }
    sentOnline = navigator.onLine !== false;
    const res = await apiFetch(`/bookings/${resolvedId}`, { method: 'DELETE' });
    if (res.ok || res.status === 204 || res.status === 200) {
      // Remove this slot from local state
      if (booking) {
        booking.slots = booking.slots.filter(s => s !== Number(slotId));
        if (booking.slotBookings) delete booking.slotBookings[slotId];
        if (booking.slots.length === 0) _dropBookingKeepPlace(eventId);
      }
      // Update the slot visually: mine → available
      const g = document.querySelector(`#bikeSvg .bike-slot[data-slot="${slotId}"]`);
      if (g) {
        g.classList.replace('mine', 'available');
        g.setAttribute('onclick', `selectBike(${slotId})`);
        _syncBikeSlotsA11y(); // "your booking" → "available", and a toggle again
      }
      // Update card button(s) from state (remaining seats / kept place / none)
      _noteLocalBookingWrite();
      _markSeatFreed(eventId);
      _syncCardButtonsForEvent(eventId);
      const remaining = booking?.slots?.length || 0;
      document.getElementById('modalHint').textContent = remaining
        ? `${_sl3} ${slotId} cancelled. Select another or close.`
        : `Booking cancelled. Select a ${_sl3.toLowerCase()} to rebook.`;
      toast(`${_sl3} ${slotId} cancelled`, 'info');
      PsycleEvents.emit('seat:cancelled', eventId, slotId);
    } else {
      const data = await res.json().catch(() => ({}));
      document.getElementById('modalHint').textContent = 'Cancel failed — try again';
      toast(describeCancelError(res, data), 'error');
      // A 5xx can follow a DELETE that did land (it is re-sent up to three
      // times): the toast says "check My Bookings", so make that true.
      if (res.status >= 500) _scheduleBookingsRefetch(1500);
    }
  } catch (e) {
    document.getElementById('modalHint').textContent = 'Cancel failed — try again';
    toast(describeCancelError(null, null, e, sentOnline), 'error');
    // The DELETE may have landed without its answer reaching us: let /bookings
    // say (as leaveWaitlist does). Not offline — that read could only fail —
    // but a DELETE that went out before the signal dropped is re-read the
    // moment it is back (nothing else re-reads /bookings on 'online').
    if (navigator.onLine) _scheduleBookingsRefetch(1500);
    else if (sentOnline) window.addEventListener('online', () => _scheduleBookingsRefetch(400), { once: true });
  }
}

async function confirmUnbook(bookingId, eventId, btn) {
  // A waitlist place is not a booking: it lives at /waitlists/{entryId} and
  // must never reach the DELETE /bookings paths below (a 404 there reads as
  // "cancelled" while the place survives server-side).
  if (_myBookings[String(eventId)]?.waitlisted) return leaveWaitlist(eventId, btn);
  if (!(await confirmCancelWithPolicy(eventId, 'Cancel this booking?'))) return;
  const idleLabel = btn.textContent;
  btn.disabled = true;
  _busyLabel(btn);
  const ready = await _readyForWholeCancel(eventId);
  const booking = _myBookings[String(eventId)];
  if (!ready || booking?.waitlisted) {
    // Nothing is sent. (A seat that turned into just a waitlist place while
    // the dialog was up is left through /waitlists, never DELETE /bookings.)
    btn.disabled = false;
    if (booking) applyBookedState(btn, eventId, booking); else btn.textContent = idleLabel;
    return;
  }

  const bookingIds = _bookingIdsFor(booking, bookingId);

  // Offline: queue the cancel and optimistically clear local state.
  if (!navigator.onLine && typeof queueOfflineCancel === 'function') {
    queueOfflineCancel(eventId, bookingIds);
    _dropBookingKeepPlace(eventId);
    _afterCardCancel(btn, eventId);
    refreshUpcomingPanel();
    toast("You're offline — cancel queued. We'll send it when you're back online.", 'info');
    PsycleEvents.emit('booking:cancelled', eventId);
    return;
  }

  try {
    const ids = bookingIds.length === 0 ? [null] : bookingIds;
    const results = await Promise.all(ids.map(bid => {
      const path = bid ? `/bookings/${bid}` : `/bookings?event_id=${eventId}`;
      return apiFetch(path, { method: 'DELETE' });
    }));
    // 404 = already gone (e.g. a retried DELETE landed) — counts as cancelled.
    const isOk = r => r.ok || r.status === 204 || r.status === 200 || r.status === 404;
    const allOk = results.every(isOk);
    if (allOk) {
      _dropBookingKeepPlace(eventId);
      _afterCardCancel(btn, eventId);
      refreshUpcomingPanel();
      toast('Booking cancelled', 'info');
      PsycleEvents.emit('booking:cancelled', eventId);
      // A record local state never knew of (a no-layout space whose 2xx
      // carried no id) is still booked: let /bookings put it back on show.
      _scheduleBookingsRefetch();
    } else {
      const failed = results.find(r => !isOk(r));
      const data = await failed.json().catch(() => ({}));
      btn.disabled = false;
      btn.textContent = 'Booked ✓';
      PsycleEvents.emit('booking:cancel_failed', eventId, data);
      toast(describeCancelError(failed, data), 'error');
      // Partial success possible (one seat deleted, another not) — reconcile
      // with the server so _myBookings matches reality.
      if (results.some(isOk) && typeof fetchMyBookings === 'function') {
        fetchMyBookings();
      } else if (results.some(r => r.status >= 500)) {
        // A 5xx can follow a DELETE that did land (as cancelBikeSlot).
        _scheduleBookingsRefetch(1500);
      }
    }
  } catch (e) {
    // Network failure after the confirm — queue instead of losing the intent.
    if (!navigator.onLine && typeof queueOfflineCancel === 'function') {
      queueOfflineCancel(eventId, bookingIds);
      _dropBookingKeepPlace(eventId);
      _afterCardCancel(btn, eventId);
      refreshUpcomingPanel();
      toast("You're offline — cancel queued. We'll send it when you're back online.", 'info');
      PsycleEvents.emit('booking:cancelled', eventId);
      return;
    }
    btn.disabled = false;
    btn.textContent = 'Booked ✓';
    toast(describeCancelError(null, null, e), 'error');
    // A retried DELETE may have landed unheard: /bookings says what is held.
    if (navigator.onLine) _scheduleBookingsRefetch(1500);
  }
}
// ─────────────────────────────────────────────────────────────────

function applyBookedState(btn, eventId, booking) {
  const slots = booking.slots || [];
  const slotLabel = booking.waitlisted
    ? 'Waitlisted ✓'
    : (slots.length ? `${formatSlots(slotLabelForEvent(eventId), slots)} ✓` : 'Booked ✓');
  btn.textContent = slotLabel;
  btn.className = 'book-btn booked';
  btn.disabled = false;
  if (booking.bookingId) btn.dataset.bookingId = booking.bookingId;
  else btn.removeAttribute('data-booking-id');
  btn.dataset.eventId = eventId;
  // Same routing as eventCard: a place is managed at /waitlists; a seat at a
  // layout studio re-opens the picker (view/cancel one seat, add a spot);
  // a seatless (no-layout) booking cancels directly.
  const card0 = btn.closest('.class-card');
  const studioId = card0?.dataset?.studioId || _eventCache[String(eventId)]?.studio_id || 0;
  const hasLayout = !!(_studioMap[studioId]?.has_layout);
  btn.onclick = (e) => {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    const cur = _myBookings[String(eventId)] || booking;
    if (cur.waitlisted) return leaveWaitlist(eventId, btn);
    if (hasLayout) return bookClass(eventId, btn, studioId);
    return confirmUnbook(cur.bookingId, eventId, btn);
  };
  // Card highlight: green for a seat, waitlist tint for a place.
  const card = btn.closest('.class-card');
  if (card) {
    card.classList.toggle('is-booked', !booking.waitlisted);
    card.classList.toggle('is-waitlisted', !!booking.waitlisted);
  }
}

// ── pure:discover:start ── (DOM-free; tests/suites/discover.js evaluates this block)
// Places still open in a class, or null when the API did not say. /events
// sends `capacity` + `occupancy` — never the `capacity_remaining` the cards
// used to wait for, so "Only 2 left" had never once rendered. A cache entry
// seeded from a waitlist place carries capacity_remaining alone.
function _spotsLeft(evt) {
  if (!evt) return null;
  if (Number.isFinite(evt.capacity) && Number.isFinite(evt.occupancy)) return Math.max(0, evt.capacity - evt.occupancy);
  return Number.isFinite(evt.capacity_remaining) ? Math.max(0, evt.capacity_remaining) : null;
}

// A count is only printed while the data behind it is recent: the list is
// re-filtered from memory all day (and from a day-old cache at launch), and
// this morning's "Only 2 left" is worse than no number. Twice WINDOW_FRESH_MS:
// the silent refresh that starts at 15 minutes has had its chance by then.
// Same clock as the window (`_windowFetchedAt`); a stamp from the future (the
// clock was moved back) is not fresh, as in _windowIsFresh.
const SPOTS_MAX_AGE_MS = 30 * 60 * 1000;
function _countsFresh(dataAt, now) {
  const age = now - dataAt;
  return !!dataAt && age >= 0 && age < SPOTS_MAX_AGE_MS;
}

// A card's availability line, in the redesign's wording ('' = no line). A
// class that is full with no waitlist says so ("Waitlist only" sat beside a
// disabled Full button). The count is a number only while it is recent
// (`fresh`; data-count lets the resume hook take an aged one off a live
// card), and 0 on a class Psycle still calls bookable says nothing at all.
// One builder for eventCard and the in-place button sync: the line and the
// button beside it must never be written from two readings of the class.
function _spotsHtml(evt, held, fresh) {
  if (held || !evt) return '';
  if (evt.is_fully_booked) return `<span class="cc-spots">${evt.is_waitlistable ? 'Waitlist open' : 'Fully booked'}</span>`;
  const left = fresh ? _spotsLeft(evt) : null;
  if (left >= 1 && left <= 3) return `<span class="cc-spots low" data-count>Only ${left} left</span>`;
  if (left > 3) return `<span class="cc-spots" data-count>${left} spots left</span>`;
  return '';
}

// Time-of-day bands (the Time filter row). The hour is cut from the start_at
// STRING — the gym's own wall clock, in the 'T' and the space form alike —
// never read through Date, which moves it on a device that is not on UK time.
// The labels are 24-hour like every other time in the app ("After 17:00", never
// "After 5"); the keys, the hours and everything that filters are unchanged.
const TIME_BANDS = [
  { key: 'early', label: 'Before 9:00', from: 0, to: 9 },
  { key: 'day', label: '9:00–17:00', from: 9, to: 17 },
  { key: 'evening', label: 'After 17:00', from: 17, to: 24 },
];
function _timeBandOf(startAt) {
  const h = parseInt(String(startAt).slice(11, 13), 10);
  const band = isNaN(h) ? null : TIME_BANDS.find(b => h >= b.from && h < b.to);
  return band ? band.key : null;
}
// No band chosen = any time. A class whose hour cannot be read is never
// hidden by a time filter: it is still a class on that day.
function _inTimeBands(startAt, bands) {
  if (!bands || !bands.size) return true;
  const key = _timeBandOf(startAt);
  return key === null || bands.has(key);
}

// Where each new card goes among a day's cards already on screen.
// `existingStarts`: start_at of every card in the grid, in DOM order
// (undefined for a node that is none of this day's classes — never an
// insertion point); `newStarts`: the classes to add, time-sorted. Returns,
// per new class, the index of the existing card to insert BEFORE
// (existingStarts.length = append). Both lists are time-sorted, so ONE
// forward cursor does it — the old loop re-queried the grid and searched the
// day's events again for every single card (n³ a day; ~260ms of a filter tap
// on the all-studios week). Strictly later (>) keeps equal start times in
// arrival order, as before.
function _mergeInsertPoints(existingStarts, newStarts) {
  const points = [];
  let p = 0;
  for (const start of newStarts) {
    while (p < existingStarts.length && !(existingStarts[p] > start)) p++;
    points.push(p);
  }
  return points;
}
// ── pure:discover:end ──

// ── pure:day-pager:start ── (DOM-free; tests/suites/8b-day-pager.js evaluates this block)
// A range of more than one day is shown ONE DAY AT A TIME: a strip of days
// over a pager that holds a single day's cards (render() → _paintDays). These
// are its decisions. Every day here is the 'YYYY-MM-DD' at the front of
// start_at — the gym's own calendar — and day arithmetic goes through UTC,
// where a day is always 24 hours: a naive class time is never read through
// Date, because the device is not always on UK time.
const PAGER_MAX_DAYS = 62; // no preset comes near it; a bad bound must not build a year of pills
const _PAGER_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const _PAGER_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function _pagerIsDay(day) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(day == null ? '' : day));
}

// 'YYYY-MM-DD' n days on ('' for anything that is not a day).
function _pagerAddDays(day, n) {
  if (!_pagerIsDay(day)) return '';
  const p = String(day).split('-').map(Number);
  const t = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10);
}

// Every day of start..end, in order. [] unless both are days, in order.
function _pagerDays(start, end) {
  if (!_pagerIsDay(start) || !_pagerIsDay(end) || start > end) return [];
  const days = [];
  for (let d = String(start); d && d <= end && days.length < PAGER_MAX_DAYS; d = _pagerAddDays(d, 1)) days.push(d);
  return days;
}

// The days to page over. The selected range when it has both bounds — a day
// with nothing on keeps its place in the strip. A restored legacy search has
// no bounds: it gets the days its classes fall on — as does whatever lies past
// the cap, so no class can end up on a day that has no pill.
function _pagerDayList(start, end, eventDays) {
  const range = _pagerDays(start, end);
  const last = range.length ? range[range.length - 1] : '';
  const seen = {};
  return range.concat((eventDays || []).filter(d => _pagerIsDay(d) && d > last && !seen[d] && (seen[d] = true)).sort());
}

// What a day is called. `todayStr` is handed in: the date the date row's
// Today / Tomorrow presets were built from (the device's — see _pagerModelFor).
//   rel   'Today' | 'Tomorrow' | ''
//   short the strip pill: 'Today' · 'Tomorrow' · 'Sat 20'
//   long  the pager heading and what is announced: 'Saturday 20 September'
//   head  a single day's heading, as before the pager: 'Today · 18 September'
// No year anywhere: with a count beside it the line has to fit 390px.
function _pagerDayLabel(day, todayStr) {
  if (!_pagerIsDay(day)) { const raw = String(day == null ? '' : day); return { rel: '', short: raw, long: raw, head: raw }; }
  const p = String(day).split('-').map(Number);
  const weekday = _PAGER_WEEKDAYS[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()];
  const month = _PAGER_MONTHS[p[1] - 1] || '';
  const tomorrowStr = _pagerAddDays(todayStr, 1);
  const rel = day === todayStr ? 'Today' : day === tomorrowStr ? 'Tomorrow' : '';
  const long = weekday + ' ' + p[2] + ' ' + month;
  return { rel, short: rel || (weekday.slice(0, 3) + ' ' + p[2]), long, head: rel ? rel + ' · ' + p[2] + ' ' + month : long };
}

// The strip pill as the Crisp Colour boards draw it: a small word over the day
// of the month. 'Today' is the only relative word — "Tomorrow" does not fit a
// seventh of a phone's width, and the numeral under it already says which day
// it is. (The pill's spoken name is _pagerSpoken's full date, as before.)
function _pagerPillParts(day, todayStr) {
  if (!_pagerIsDay(day)) return { word: String(day == null ? '' : day), num: '' };
  const p = String(day).split('-').map(Number);
  const weekday = _PAGER_WEEKDAYS[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()];
  return { word: day === todayStr ? 'Today' : weekday.slice(0, 3), num: String(p[2]) };
}

// The days of the strip on which the member holds a SEAT → the earliest such
// class of that day: { 'YYYY-MM-DD': { ct, name, time } }. It is what the
// pill's small class-colour dot and the "You have …" half of its spoken name
// are drawn from. Read from what is already in memory (bookings = _myBookings,
// cache = _eventCache) — nothing is ever fetched for a dot. A waitlist place is
// not yours yet, and a class that has started (o.started) is over: neither
// marks a day. The day and the time are cut from the start_at DIGITS — the
// gym's own wall clock — never read through Date.
//   o.typeKey(typeName) → the data-ct key · o.started(startAt) → boolean
function _pagerHeldDays(bookings, cache, days, o) {
  o = o || {};
  const out = {}, first = {};
  const wanted = (days || []).filter(_pagerIsDay);
  Object.keys(bookings || {}).forEach(id => {
    const b = bookings[id];
    if (!b || typeof b !== 'object' || b.waitlisted) return;
    const evt = (cache && Object.prototype.hasOwnProperty.call(cache, id)) ? cache[id] : null;
    const startAt = evt && evt.start_at ? String(evt.start_at) : '';
    const day = startAt.slice(0, 10);
    if (wanted.indexOf(day) === -1) return;
    let over = false;
    try { over = typeof o.started === 'function' && !!o.started(startAt); } catch (e) {}
    if (over) return;
    // Earliest by the TIME digits: start_at comes in the 'T' and the space form
    // alike, and as whole strings 'T07:00' sorts after ' 18:30'.
    const tod = startAt.slice(11, 19);
    if (Object.prototype.hasOwnProperty.call(first, day) && !(tod < first[day])) return;
    first[day] = tod;
    const name = String(evt._typeName || 'a class');
    let ct = 'other';
    try { if (typeof o.typeKey === 'function') ct = String(o.typeKey(evt._typeName) || 'other'); } catch (e) {}
    out[day] = { ct, name, time: _clock24(startAt.slice(11, 13), startAt.slice(14, 16)) };
  });
  return out;
}

// "…, 14 classes. You have Strength 45 at 18:30" — the dot, said.
function _pagerHeldSpoken(held) {
  if (!held) return '';
  return '. You have ' + held.name + (held.time ? ' at ' + held.time : '');
}

function _pagerCountText(n) {
  return n === 1 ? '1 class' : (n > 0 ? n + ' classes' : 'No classes');
}

// "Saturday 20 September, 14 classes" — what a screen reader hears on every
// change of day, and the name of the day's tab. A day that may not say "no
// classes" (`state`, from _pagerEmptyState) says what it is instead.
function _pagerSpoken(day, todayStr, n, state) {
  const what = state === 'unopened' ? 'not open yet' : state === 'unknown' ? 'not loaded' : _pagerCountText(n).toLowerCase();
  return _pagerDayLabel(day, todayStr).long + ', ' + what;
}

// A day with nothing to show is not always a day with no classes. What such a
// day is INSTEAD — null when "no classes" is the truth as far as anyone knows:
//   'unopened' Psycle has not put the day on the timetable yet: o.opensMs(day)
//              is when it first appears (_dayListedMs — the OBSERVED release
//              model, pure:horizon), o.now the clock. No preset reaches that far
//              (about 25 days out); a date picked in the calendar can. A day
//              that IS listed and empty really has no classes;
//   'unknown'  it lies past o.heldEnd, the last day a provisional window (an
//              older cache shown while the real range loads) really holds. It
//              was never loaded, so "no classes" would be a guess — the rule
//              _discoverEmptyContext keeps for a whole range.
// Unopened first: it is true whatever was loaded, and no retry changes it.
function _pagerEmptyState(day, n, o) {
  if (n > 0 || !_pagerIsDay(day)) return null;
  o = o || {};
  let opens = null;
  try { opens = typeof o.opensMs === 'function' ? o.opensMs(day) : null; } catch (e) {}
  if (opens && o.now < opens) return 'unopened';
  return (_pagerIsDay(o.heldEnd) && day > o.heldEnd) ? 'unknown' : null;
}

// "Booking usually opens Monday 12 October, 12:00" — the release that opens the
// day (`opensMs`: _dayOpensMs, pure:horizon), named by its date: a bare "Monday"
// would read as the next one. "usually": that date is the OBSERVED model's, not
// an answer from Psycle (the API never says when booking opens, and some credit
// types book a batch early) — so it explains, it never promises. Monday noon in
// London is 11:00 or 12:00 UTC, so the instant's UTC date IS that Monday.
function _pagerOpensText(opensMs, todayStr) {
  if (!(opensMs > 0)) return '';
  const opensDay = new Date(opensMs).toISOString().slice(0, 10);
  return opensDay === todayStr ? 'Booking usually opens today at 12:00' : 'Booking usually opens ' + _pagerDayLabel(opensDay, '').long + ', 12:00';
}

function _pagerFirstWithClasses(days, counts) {
  return (days || []).find(d => (counts && counts[d]) > 0) || null;
}

// The neighbouring day; null at either end of the range (the pager resists).
function _pagerStep(days, current, dir) {
  const i = (days || []).indexOf(current);
  if (i === -1) return null;
  return days[i + (dir < 0 ? -1 : 1)] || null;
}

// Where an empty day sends the member: the next day with classes, else the
// nearest one before it. null when no other day has any.
function _pagerJump(days, counts, current) {
  const i = (days || []).indexOf(current);
  if (i === -1) return null;
  for (let k = i + 1; k < days.length; k++) if (counts[days[k]] > 0) return { day: days[k], dir: 1 };
  for (let k = i - 1; k >= 0; k--) if (counts[days[k]] > 0) return { day: days[k], dir: -1 };
  return null;
}

// Which day is on screen. s = { days, counts, current, sameRange, chosen, done }.
//  - a new range or preset, or a day that has left the range (the midnight
//    roll-forward), starts again on the first day — and is nobody's choice;
//  - the same range keeps its day: across filter taps, a background refresh
//    re-rendering in place, and a search still streaming in;
//  - until the member picks a day themselves, a FINISHED load shows the first
//    day that has classes. While results are still arriving nothing moves:
//    "empty so far" is not "empty".
function _pagerPickDay(s) {
  const days = (s && s.days) || [];
  if (!days.length) return { day: null, chosen: false };
  const kept = !!s.sameRange && days.indexOf(s.current) !== -1;
  const chosen = kept && !!s.chosen;
  let day = kept ? s.current : days[0];
  if (!chosen && s.done) day = _pagerFirstWithClasses(days, s.counts) || day;
  return { day, chosen };
}

// The one-time "Swipe to change day" line: a touch screen, the first paged
// range ever shown — and never over or straight after the first-run welcome.
function _pagerHintWanted(f) {
  return !!f && !!f.paged && !!f.touch && !f.seen && !f.welcomeUp && !f.welcomedThisSession;
}
// ── pure:day-pager:end ──

// Are the counts in this render() pass recent enough to print? A flag, not an
// argument: eventCard is wrapped by features.js and performance.js, and both
// forward exactly five parameters.
let _cardCountsFresh = true;

// Cards outlive the data they were built from (a warm app, an evening
// offline). Back in the foreground, an aged number comes off the card; the
// silent refresh Discover's own resume hook starts rebuilds the list with
// new ones when it lands.
document.addEventListener('visibilitychange', function () {
  if (document.hidden || _countsFresh(window._windowFetchedAt, Date.now())) return;
  document.querySelectorAll('#results .cc-spots[data-count]').forEach(el => el.remove());
});

// …and a page that simply STAYS visible (a desktop tab kept open for Monday's
// release) fires none of that: no resume, no tap, no render. render() arms
// this for the moment the counts it just printed turn SPOTS_MAX_AGE_MS old.
// They come off, and the "Updated …" label beside them — it does not tick by
// itself — is repainted. No refetch: nobody asked for one, and a visible tab
// would then poll every half hour.
let _countsExpireTimer = null;
function _armCountsExpiry(dataAt) {
  clearTimeout(_countsExpireTimer);
  _countsExpireTimer = null;
  if (!_cardCountsFresh) return;
  _countsExpireTimer = setTimeout(() => {
    _countsExpireTimer = null;
    document.querySelectorAll('#results .cc-spots[data-count]').forEach(el => el.remove());
    if (typeof renderLastUpdated === 'function') renderLastUpdated();
  }, SPOTS_MAX_AGE_MS - (Date.now() - dataAt) + 1000);
}

function eventCard(evt, instrMap, studioMap, locationMap, typeMap) {
  const instr = instrMap[evt.instructor_id];
  const studio = studioMap[evt.studio_id];
  const loc = studio ? locationMap[studio.location_id] : null;
  const type = typeMap[evt.event_type_id];

  const dt = new Date(evt.start_at);

  const locName = loc ? loc.name.replace('Psycle ', '') : '';
  const studioName = studio ? studio.name : '';

  const isFull = evt.is_fully_booked && !evt.is_waitlistable;
  const isWaitlist = evt.is_fully_booked && evt.is_waitlistable;

  const myBooking = _myBookings[String(evt.id)];

  let bookLabel, bookCls, bookDisabled, bookOnclick;
  if (myBooking && myBooking.waitlisted) {
    // A waitlist place (no seat): tapping manages the place, never the picker.
    bookLabel = 'Waitlisted ✓'; bookCls = 'book-btn booked'; bookDisabled = '';
    bookOnclick = `leaveWaitlist(${Number(evt.id)}, this)`;
  } else if (myBooking) {
    bookLabel = (myBooking.slots || []).length ? `${formatSlots(slotLabel(type?.name), myBooking.slots)} ✓` : 'Booked ✓';
    bookCls = 'book-btn booked';
    bookDisabled = '';
    // Open picker to show/cancel seats; fall back to direct cancel if no layout
    const hasLayout = !!(_studioMap[evt.studio_id]?.has_layout);
    bookOnclick = hasLayout
      ? `bookClass(${evt.id}, this, ${evt.studio_id})`
      : `confirmUnbook(${Number(myBooking.bookingId) || 'null'}, ${evt.id}, this)`;
  } else if (isFull) {
    bookLabel = 'Full'; bookCls = 'book-btn'; bookDisabled = 'disabled'; bookOnclick = '';
  } else if (isWaitlist) {
    bookLabel = 'Join Waitlist'; bookCls = 'book-btn waitlist'; bookDisabled = ''; bookOnclick = `bookClass(${evt.id}, this, ${evt.studio_id})`;
  } else {
    bookLabel = 'Book'; bookCls = 'book-btn'; bookDisabled = ''; bookOnclick = `bookClass(${evt.id}, this, ${evt.studio_id})`;
  }

  // Availability line (_spotsHtml). render() decides per pass whether the
  // counts are recent enough to print.
  const spotsHtml = _spotsHtml(evt, myBooking, _cardCountsFresh);
  const onlineMeta = evt.is_live_stream ? '<div class="cc-meta"><span class="badge highlight">Online</span></div>' : '';

  // THE CLASS CARD (Crisp Colour) — one anatomy, styled by css/crisp.css from
  // `.class-card[data-ct]`, so any card built this way looks the same:
  //   root      .class-card.ct-card + data-ct (classTypeKey: the class type is
  //             the card's COLOUR) + .is-booked (glows) / .is-waitlisted (dashed)
  //   .cc-time  the 24-hour time leads, in the display face: .cc-time-h ("18:30")
  //             over the small line .cc-dur ("45 min") — _ccTimeHTML
  //             (pure:class-type), the ONE builder every wearer of the card calls
  //   .cc-info  .cc-head = .ct-tile pictogram + .cc-name · .cc-sub = .cc-who
  //             (instructor + rank) and .cc-loc (the studio, plain text) ·
  //             .cc-spots (availability) · .cc-meta (a label such as Online)
  //   .cc-action ONE pill. Its class stays exactly book-btn[ booked| waitlist]
  //             and its label plain text: the booking code rewrites both, and
  //             the ✓ label contract is read off them.
  // The "·" between instructor and studio is drawn by CSS inside .cc-loc's own
  // no-wrap unit, so a line that wraps never ends — or starts — on a bare dot.
  const ct = classTypeKey(type?.name);
  const who = instrLink(instr?.full_name, instr?.id) + (window.tierBadgeHTML ? window.tierBadgeHTML(instr?.id) : '');

  return `<div class="class-card ct-card${myBooking ? (myBooking.waitlisted ? ' is-waitlisted' : ' is-booked') : ''}" data-ct="${ct}" data-id="${evt.id}" data-studio-id="${evt.studio_id}"
    onclick="openClassDetail(${evt.id})" style="cursor:pointer">
    ${_ccTimeHTML({ hours: dt.getHours(), mins: dt.getMinutes(), duration: evt.duration })}
    <div class="cc-info">
      <span class="cc-head"><span class="ct-tile" aria-hidden="true">${classPictogram(ct, 18)}</span><span class="cc-name" role="button" tabindex="0">${escapeHTML(type?.name || 'Class')}</span></span>
      <span class="cc-sub">${who ? `<span class="cc-who">${who}</span>` : ''}${locName ? `<span class="cc-loc">${escapeHTML(locName)}</span>` : ''}</span>
      ${spotsHtml}
      ${onlineMeta}
    </div>
    <div class="cc-action">
      <button class="${bookCls}" ${bookDisabled} data-event-id="${evt.id}" data-studio-id="${evt.studio_id}"
        ${myBooking && myBooking.bookingId ? `data-booking-id="${Number(myBooking.bookingId) || ''}"` : ''}
        onclick="event.stopPropagation();${bookOnclick}">${bookLabel}</button>
    </div>
  </div>`;
}

// Feature 13's write, behind a trailing debounce: every filter tap re-renders,
// and serialising the whole window (800+ classes) inside each one was part of
// the freeze. Only the last view of a burst is worth restoring anyway. `at`
// carries the data's age across the reload (see render()'s dataAt).
let _lastResultsTimer = null;
function _saveLastResultsSoon(events, relations, filters, dataAt) {
  clearTimeout(_lastResultsTimer);
  _lastResultsTimer = setTimeout(() => {
    try {
      sessionStorage.setItem('psycle_last_results', JSON.stringify({ events, relations, at: dataAt || 0, filters: {
        instructorId: filters.instructorId,
        locationIds: filters.locationIds || [],
        categoryKeys: [...(filters.categoryKeys || [])],
        startDate: filters.startDate,
        endDateStr: filters.endDateStr,
        strengthSubs: [...(filters.strengthSubs || [])],
        reformerSubs: [...(filters.reformerSubs || [])],
        timeBands: [...(filters.timeBands instanceof Set ? filters.timeBands : selectedTimeBands)],
        availableOnly: filters.availableOnly != null ? !!filters.availableOnly : _availableOnly,
        _isTodaySchedule: filters._isTodaySchedule || false,
      }}));
    } catch (e) { console.warn('[psycle] sessionStorage save failed:', e); }
  }, 1000);
}

function render(events, relations, filters, done) {
  if (!relations) return; // nothing to map without relation data
  const instrMap = Object.fromEntries((relations.instructors || []).map(i => [i.id, i]));
  const studioMap = Object.fromEntries((relations.studios || []).map(s => [s.id, s]));
  const locationMap = Object.fromEntries((relations.locations || []).map(l => [l.id, l]));
  const typeMap = Object.fromEntries((relations.event_types || []).map(t => [t.id, t]));
  Object.assign(_studioMap, studioMap); // expose globally for bookClass

  // How old are these events? The window's own stamp when they ARE the window
  // (every filter tap, a hydrated cache); the stamp a restored session carried
  // (restoreLastResults; none = unknown = old); otherwise search() is streaming
  // them in right now, before it has committed a window to stamp.
  const dataAt = filters.dataAt != null ? filters.dataAt
    : (events === window._windowEvents ? window._windowFetchedAt : Date.now());
  _cardCountsFresh = _countsFresh(dataAt, Date.now());
  _armCountsExpiry(dataAt); // a page left visible: the numbers still come off when they age

  // Cache event metadata for the upcoming panel. Always REFRESH existing
  // entries — the class detail sheet reads availability (is_fully_booked,
  // capacity) from this cache, and an insert-only cache would pin the
  // first-seen snapshot all day while refreshed cards show current state.
  // Merge over any existing entry so richer fields written by detail
  // fetches (history sync) survive a list-shaped refresh.
  events.forEach(e => {
    const type = typeMap[e.event_type_id];
    const instr = instrMap[e.instructor_id];
    const studio = studioMap[e.studio_id];
    const loc = studio ? locationMap[studio.location_id] : null;
    _eventCache[String(e.id)] = {
      ...(_eventCache[String(e.id)] || {}),
      ...e,
      _typeName: type?.name || 'Class',
      _instrName: instr?.full_name || '',
      _locName: loc ? loc.name.replace('Psycle ', '') : '',
      _locFullName: loc ? loc.name : '',
      _locAddress: loc ? (loc.address || '') : '',
      _studioName: studio ? studio.name : '',
      _countsAt: dataAt, // how old capacity/occupancy are — the detail sheet prints a count only while recent
    };
  });

  const now = new Date();

  // (Facet counts are rebuilt at the data source — _buildFacetClasses() on
  // fetch/hydrate/revalidate — not here, so they don't depend on render's
  // progressive `done` flag and stay correct on multi-location fetches.)

  // The Time row. search() builds its own filters without these two (as does
  // a session saved before they existed), so the live pills stand in.
  const timeBands = filters.timeBands instanceof Set ? filters.timeBands : selectedTimeBands;
  const availableOnly = filters.availableOnly != null ? !!filters.availableOnly : _availableOnly;
  let hiddenByTimeRow = 0; // classes every OTHER filter kept

  const filtered = events.filter(e => {
    // Never show classes that have already started
    if (new Date(e.start_at) < now) return false;
    // Only the days asked for: the loaded window can be wider than the
    // selection (Today inside the loaded week is filtered here, not re-fetched).
    if (!_dayInRange(e.start_at, filters.startDate, filters.endDateStr)) return false;
    if (filters.instructorId.length && !filters.instructorId.includes(String(e.instructor_id))) return false;
    // Category filter
    const typeName = typeMap[e.event_type_id]?.name || '';
    if (filters.categoryKeys && filters.categoryKeys.size > 0) {
      const cat = getCategory(typeName);
      if (!filters.categoryKeys.has(cat.key)) return false;
    }
    // Strength sub-filter — only applies while Strength is a SELECTED category
    // (its sub-pills are hidden otherwise, so an old "Upper only" choice was
    // silently dropping Lower/Full Body from the all-classes list), and only
    // when not all subs are selected (all = no filtering)
    if (filters.strengthSubs && filters.categoryKeys && filters.categoryKeys.has('STRENGTH') && filters.strengthSubs.size < STRENGTH_SUBS.length) {
      const cat = getCategory(typeName);
      if (cat.key === 'STRENGTH') {
        const matchedSub = STRENGTH_SUBS.find(s => typeName.includes(s.match));
        if (matchedSub && !filters.strengthSubs.has(matchedSub.key)) return false;
      }
    }
    // Reformer sub-filter — same semantics for Pilates variants
    if (filters.reformerSubs && filters.categoryKeys && filters.categoryKeys.has('PILATES') && filters.reformerSubs.size < REFORMER_SUBS.length) {
      const cat = getCategory(typeName);
      if (cat.key === 'PILATES') {
        const matchedSub = REFORMER_SUBS.find(s => typeName.includes(s.match));
        if (matchedSub && !filters.reformerSubs.has(matchedSub.key)) return false;
      }
    }
    const locIds = (filters.locationIds && filters.locationIds.length)
      ? filters.locationIds
      : (filters.locationId ? [filters.locationId] : []); // legacy restored sessions
    if (locIds.length) {
      const studio = studioMap[e.studio_id];
      if (!studio || !locIds.includes(String(studio.location_id))) return false;
    }
    // Unified text search across instructor / studio / class
    if (window._discoverQuery) {
      const studio = studioMap[e.studio_id];
      const loc = studio ? locationMap[studio.location_id] : null;
      const hay = (typeName + ' ' + (instrMap[e.instructor_id]?.full_name || '') + ' ' +
        (loc ? loc.name : '') + ' ' + (studio ? studio.name : '')).toLowerCase();
      if (hay.indexOf(window._discoverQuery) === -1) return false;
    }
    // The Time row, LAST: what it hides is then exactly what every other
    // filter kept, which is what the empty list below has to tell apart.
    // "Available only" never hides the member's own class (booked or
    // waitlisted) — it would vanish from Discover the moment it was booked
    // full. is_fully_booked is the same flag the Book button goes by.
    if (!_inTimeBands(e.start_at, timeBands) ||
        (availableOnly && e.is_fully_booked && !_myBookings[String(e.id)])) {
      hiddenByTimeRow++;
      return false;
    }
    return true;
  });

  const container = document.getElementById('results');

  if (filtered.length === 0 && done) {
    // Classes DO match everything else — only the Time row hides them. Say so,
    // with the one tap that lifts just that row: Find similar, Rebook and Book
    // again search FOR the member (an instructor, a day) and must not dead-end
    // on an "After 17:00" saved last week, and Clear filters would throw away what
    // they just set. Not .no-results: theme.js flattens that block to its text,
    // so a button cannot ride in it (same markup as its renderEmptyState).
    if (hiddenByTimeRow > 0) {
      const names = TIME_BANDS.filter(b => timeBands.has(b.key)).map(b => b.label);
      const byTime = names.length > 0; // else "Available only" alone did it: every match is full
      if (availableOnly) names.push('Available only');
      container.innerHTML = `<div class="empty-state">
        <div class="empty-title">${byTime ? 'Nothing at these times' : 'Every class here is full'}</div>
        <div class="empty-subtitle">${hiddenByTimeRow} class${hiddenByTimeRow !== 1 ? 'es' : ''} on these dates ${hiddenByTimeRow !== 1 ? 'are' : 'is'} hidden by ${escapeHTML(names.join(' · '))}.</div>
        <div class="empty-actions"><button type="button" class="empty-action primary" onclick="clearTimeFilters()">${byTime ? 'Show all times' : 'Show full classes'}</button></div>
      </div>`;
      return;
    }
    container.innerHTML = '<div class="no-results">No classes found for these filters.</div>';
    return;
  }

  // Group by day
  const byDay = {};
  filtered.forEach(e => {
    const day = String(e.start_at).slice(0, 10); // 'YYYY-MM-DD' of the T- and the space-form alike
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(e);
  });

  const instructorName = filters.instructorId.length
    ? filters.instructorId.map(id => instrMap[id]?.full_name || instructors.find(i => i.id == id)?.full_name || id).join(', ')
    : null;

  // Ensure summary bar exists
  let summary = container.querySelector('.summary');
  if (!summary) {
    container.innerHTML = '<div class="summary"></div>';
    summary = container.querySelector('.summary');
  }
  summary.innerHTML = `${done ? '' : '<span class="spinner" style="width:12px;height:12px;border-width:2px;margin-right:6px;vertical-align:middle"></span>'}
    <strong>${filtered.length}</strong> class${filtered.length !== 1 ? 'es' : ''}
    ${instructorName ? `with <strong>${escapeHTML(instructorName)}</strong>` : ''}
    ${done ? '' : 'found so far…'}`;
  // Once the load is over the day strip carries every count: css/redesign.css
  // drops this line over a paged range (it stays while results stream in).
  summary.classList.toggle('is-settled', !!done);
  if (done) refreshUpcomingPanel();
  // The days themselves: one group for a single day, the strip + pager for a
  // range. The model is kept — a change of day repaints from it, with no
  // search and no second pass over the window. A provisional window (an older
  // cache under today's key) holds nothing past _windowHeldEnd: those days
  // are unknown, not empty.
  const heldEnd = (events === window._windowEvents && window._windowPartial && window._windowHeldEnd) || null;
  _pagerModel = _pagerModelFor(byDay, filters, done, dataAt, { instrMap, studioMap, locationMap, typeMap }, heldEnd);
  _paintDays(container, _pagerModel);

  // Feature 13: Persist search results to sessionStorage for tab-switch restore
  if (done) _saveLastResultsSoon(events, relations, filters, dataAt);
}

// ── Discover: one day at a time ──────────────────────────────────────
// A week of every studio is ~100 cards a day: as one long list, nobody could
// tell where one day ended. A range of MORE THAN ONE day is now paged — a
// strip of days (#dayStrip, a tablist; sticky on a phone) over a pager
// (#dayPager) holding ONE day's cards. Tap a day in the strip, use the
// arrow keys in the strip, or swipe the list (js/interactions.js
// hands the gesture to window._dayPagerSwipe). A single-day range is the
// day's heading and list, as before. Only the day on screen is in the DOM;
// everything that looks a card up by id already copes with one that is not
// there (the class sheet books through a button of its own).
//
// Which day is showing lives in memory only. (The brief's name for it,
// window._discoverDay, is taken: `let _discoverDay` above is the day the DATE
// ROW was last checked against, and the suites pin it.)
//   window._pagerDay      'YYYY-MM-DD' on screen; null while nothing is paged
//   window._pagerRangeKey the 'start|end' it belongs to — another range starts
//                         again on its first day
//   window._pagerChosen   the member picked it (pill, key, swipe)
// The decisions are pure:day-pager's; this is only the DOM.
window._pagerDay = null;
window._pagerRangeKey = null;
window._pagerChosen = false;
let _pagerModel = null;        // what render() last laid out (see _pagerModelFor)
let _pagerStripLeft = 0;       // the strip's own scroll offset: every filter tap rebuilds #results
let _pagerStripFocused = false; // …and would drop keyboard focus out of the strip with it
let _pagerSwap = null;         // { timer, paint }: the old day is sliding out, the new one is not painted yet
let _pagerSettleTimer = null;  // the slide-in / spring-back clean-up (styles only — safe to drop)
let _pagerHintLive = false;    // the one-time hint is up for this page session
let _pagerSawWelcome = false;  // the first-run welcome was on screen in this page session
const PAGER_HINT_KEY = 'psycle_hint_dayswipe';
const PAGER_SLIDE_MS = 150;

function _pagerModelFor(byDay, filters, done, dataAt, maps, heldEnd) {
  const shown = Object.keys(byDay).sort();
  const days = _pagerDayList(filters.startDate, filters.endDateStr, shown);
  const counts = {};
  days.forEach(d => { counts[d] = (byDay[d] || []).length; });
  // Today / Tomorrow off the clock that BUILT the range: the date row's presets
  // are the device's date (_applyDateQuick). Read off London's, a member in New
  // York at 8pm got the heading "Today · 19 September" under a lit "Tomorrow".
  const todayStr = localDateStr();
  // Days with nothing to show that may not say "no classes" (_pagerEmptyState).
  const states = {}, now = Date.now();
  days.forEach(d => { const s = _pagerEmptyState(d, counts[d], { heldEnd, now, opensMs: _dayListedMs }); if (s) states[d] = s; });
  const m = { paged: days.length > 1 && shown.length > 0, days, counts, states, byDay, maps, shown, done: !!done, dataAt, todayStr };
  if (days.length <= 1) {
    // A single day. Back on a range later, it starts on its first day: the range changed.
    window._pagerDay = null; window._pagerRangeKey = null; window._pagerChosen = false;
    return m;
  }
  // A range with nothing to show YET (a search whose first studio had nothing
  // for these filters): no strip over an empty list, and the day is left alone.
  if (!m.paged) return m;
  const rangeKey = (filters.startDate || '') + '|' + (filters.endDateStr || '');
  const pick = _pagerPickDay({
    days, counts, done, current: window._pagerDay, chosen: window._pagerChosen,
    sameRange: rangeKey === window._pagerRangeKey,
  });
  if (rangeKey !== window._pagerRangeKey) _pagerStripLeft = 0;
  window._pagerRangeKey = rangeKey;
  window._pagerDay = pick.day;
  window._pagerChosen = pick.chosen;
  return m;
}

// Lay the model out in #results. Owns every .day-group, #dayStrip and
// #dayPager in there: a group for a day that is not shown goes, and so does
// the pager's chrome when the range is a single day.
function _paintDays(container, m) {
  const mode = m.paged ? 'paged' : 'list';
  if (container.dataset.dayMode !== mode) {
    // The layout changed under a list nobody wiped (restoreLastResults over a
    // half-loaded search): start clean rather than mix the two.
    container.querySelectorAll('.day-group, #dayStrip, #dayPager').forEach(el => el.remove());
    container.dataset.dayMode = mode;
  }
  let host = container;
  const shown = m.paged ? [window._pagerDay] : m.shown;
  if (m.paged) {
    _wireDayPager(container);
    _paintDayStrip(container, m);
    host = _ensureDayPager(container, m);
  } else {
    _pagerStripFocused = false;
  }
  container.querySelectorAll('.day-group').forEach(g => { if (shown.indexOf(g.dataset.day) === -1) g.remove(); });
  _cardCountsFresh = _countsFresh(m.dataAt, Date.now()); // a change of day repaints long after render()'s pass
  for (const day of shown) _paintDayGroup(host, day, m);
}

// One day: its heading and its cards, built — or brought up to date in place
// while a search streams in studio by studio.
function _paintDayGroup(host, day, m) {
  const { instrMap, studioMap, locationMap, typeMap } = m.maps;
  // Sort by time. Plain string order, the one _mergeInsertPoints compares
  // with (and localeCompare was the slow part of sorting a week).
  const dayEvents = (m.byDay[day] || []).sort((a, b) => (a.start_at < b.start_at ? -1 : a.start_at > b.start_at ? 1 : 0));

  // By dataset, never a selector built from the day: it is API text.
  let group = Array.from(host.children).find(el => el.dataset && el.dataset.day === day);
  if (!group) {
    // A single day reads "Today · 18 September", as before. In the pager the
    // strip already says Today, so its heading is the full date — and the only
    // cue, with the strip, to which day is on screen.
    const label = _pagerDayLabel(day, m.todayStr);
    const dayLabel = escapeHTML(m.paged ? label.long : label.head);
    group = document.createElement('div');
    group.className = 'day-group';
    group.dataset.day = day;
    group.innerHTML = `<div class="day-header"><span>${dayLabel}</span><span class="day-count"></span></div><div class="day-body"></div>`;
    host.appendChild(group);
  }
  // Every pass: a day fills up studio by studio while a search streams in.
  // An empty day has no count here: the line under the heading says why it is
  // empty, and "No classes" over "No classes on this day." said it twice.
  const countEl = group.querySelector('.day-count');
  if (countEl) countEl.textContent = dayEvents.length ? _pagerCountText(dayEvents.length) : '';

  const body = group.querySelector('.day-body');

  // A day of the range with nothing on it (or nothing the filters keep): one
  // line and the one way on. Not .no-results — theme.js flattens that to text.
  // The WHOLE range empty never gets here: render() has its own block for it.
  let empty = body.querySelector('.day-empty');
  if (!dayEvents.length) {
    const old = body.querySelector('.class-grid');
    if (old) old.remove();
    const jump = m.done ? _pagerJump(m.days, m.counts, day) : null;
    if (!m.done) { if (empty) empty.remove(); return; }
    if (!empty) {
      empty = document.createElement('div');
      empty.className = 'day-empty';
      body.appendChild(empty);
    }
    // WHY it is empty decides what it may say (_pagerEmptyState). A day Psycle
    // has not listed yet says when booking for it opens. A day a provisional window never
    // held is still being checked — or could not be, and then the way on is the
    // whole-range state's own retry: a forced search shows the studios that
    // answer, where a refresh is all-or-nothing. (.empty-loading: once nothing
    // more is coming, _runRevalidate repaints whatever carries it.)
    const state = (m.states && m.states[day]) || null;
    if (state === 'unknown') {
      empty.innerHTML = _revalInFlight
        ? '<div class="day-empty-line empty-loading">Checking the latest timetable…</div>'
        : '<div class="day-empty-line">Couldn\'t check this day</div><button type="button" class="empty-action primary" data-pager-retry>Try again</button>';
      return;
    }
    const line = (state === 'unopened' && _pagerOpensText(_dayOpensMs(day), m.todayStr)) || 'No classes on this day.';
    empty.innerHTML = `<div class="day-empty-line">${escapeHTML(line)}</div>` + (jump
      ? `<button type="button" class="empty-action primary" data-pager-day="${jump.day}">${jump.dir > 0 ? 'Next' : 'Previous'} day with classes: ${escapeHTML(_pagerDayLabel(jump.day, m.todayStr).short)}</button>`
      : '');
    return;
  }
  if (empty) empty.remove();

  // All of the day's classes in ONE list, mixed across types and time-sorted
  // (no per-category sections) — so multiple selected class types interleave.
  let grid = body.querySelector('.class-grid');
  if (!grid) {
    grid = document.createElement('div');
    grid.className = 'class-grid';
    body.appendChild(grid);
  }
  // The bare global eventCard both ways: features.js (notify bell) and
  // performance.js wrap window.eventCard, and a captured reference skips them.
  const kids = Array.from(grid.children);
  if (!kids.length) {
    // An empty grid — every filter tap, renderFromWindow wipes #results first,
    // and every change of day — is built in one parse instead of a card at a time.
    grid.innerHTML = dayEvents.map(e => eventCard(e, instrMap, studioMap, locationMap, typeMap)).join('');
    return;
  }
  // Cards already up (a search streaming in studio by studio): merge the new
  // ones between them in one forward walk.
  const have = new Set(kids.map(el => el.dataset.id));
  const fresh = dayEvents.filter(e => !have.has(String(e.id)));
  if (!fresh.length) return;
  const startById = new Map(dayEvents.map(e => [String(e.id), e.start_at]));
  const points = _mergeInsertPoints(kids.map(el => startById.get(el.dataset.id)), fresh.map(e => e.start_at));
  const holder = document.createElement('div');
  fresh.forEach((evt, i) => {
    holder.innerHTML = eventCard(evt, instrMap, studioMap, locationMap, typeMap);
    grid.insertBefore(holder.firstElementChild, kids[points[i]] || null);
  });
}

// The strip's class-colour dots: a day on which the member holds a seat carries
// ONE small dot in that class's colour (css/crisp.css .day-pill-dot) — the only
// class colour in the strip, which otherwise stays neutral. Drawn from
// _myBookings + _eventCache as they stand, never fetched for, and only once
// /bookings has really been read: a list still loading says nothing about what
// is held. The decisions are pure:day-pager's _pagerHeldDays.
function _heldDaysFor(m) {
  if (!m || !m.paged || _bookingsLoadState !== 'loaded') return {};
  const now = Date.now();
  try {
    return _pagerHeldDays(_myBookings, _eventCache, m.days, {
      typeKey: classTypeKey,
      started: startAt => _classHasStarted(startAt, now, _gymClassStartMs),
    });
  } catch (e) { return {}; } // a nicety: never in the way of the strip
}

// One pill's dot, in place: added, re-coloured or taken off. Decorative — the
// pill's aria-label says it ("You have Ride 45 at 09:30"). It hangs off the
// date numeral, not the pill's corner: a corner dot ran into the word above it
// ("Today" fills the pill's width).
function _paintDayDot(pill, held) {
  let dot = pill.querySelector('.day-pill-dot');
  if (!held) { if (dot) dot.remove(); return; }
  if (!dot) {
    dot = document.createElement('span');
    dot.className = 'day-pill-dot ct-dot';
    dot.setAttribute('aria-hidden', 'true');
    (pill.querySelector('.day-pill-num') || pill).appendChild(dot);
  }
  if (dot.getAttribute('data-ct') !== held.ct) dot.setAttribute('data-ct', held.ct);
}

// A booking made, cancelled or loaded changes which days are held without a
// render(): bring the dots (and the names that say them) up to date in place.
function _repaintDayDots() {
  const strip = document.getElementById('dayStrip');
  const m = _pagerModel;
  if (!strip || !m || !m.paged) return;
  const held = _heldDaysFor(m);
  strip.querySelectorAll('.day-pill').forEach(pill => {
    const d = pill.dataset.day;
    pill.setAttribute('aria-label', _pagerSpoken(d, m.todayStr, m.counts[d] || 0, (m.states && m.states[d]) || null) + _pagerHeldSpoken(held[d]));
    _paintDayDot(pill, held[d]);
  });
}
['bookings:loaded', 'booking:complete', 'booking:cancelled', 'seat:cancelled', 'waitlist:claimed', 'waitlist:allocated', 'auth:changed']
  .forEach(name => PsycleEvents.on(name, _repaintDayDots));

// The strip: one tab per day of the range, each with its matching-class
// count. Updated IN PLACE while the days are the same (a search streaming in,
// a change of day) so focus and the row's scroll offset stay put; rebuilt
// after a wipe, and then both are put back.
function _paintDayStrip(container, m) {
  const key = m.days.join(',');
  let strip = document.getElementById('dayStrip');
  if (strip && (strip.parentNode !== container || strip.dataset.days !== key)) { strip.remove(); strip = null; }
  const built = !strip;
  if (built) {
    strip = document.createElement('div');
    strip.id = 'dayStrip';
    strip.className = 'day-strip';
    strip.setAttribute('role', 'tablist');
    strip.setAttribute('aria-label', 'Days');
    strip.dataset.days = key;
    // Crisp Colour: a small word over the day of the month over the count.
    strip.innerHTML = m.days.map(d => {
      const parts = _pagerPillParts(d, m.todayStr);
      return `<button type="button" role="tab" class="day-pill" id="dayTab-${d}" data-day="${d}" aria-controls="dayPager">` +
        `<span class="day-pill-label">${escapeHTML(parts.word)}</span><span class="day-pill-num">${escapeHTML(parts.num)}</span><span class="day-pill-count"></span></button>`;
    }).join('');
    strip.addEventListener('scroll', () => { _pagerStripLeft = strip.scrollLeft; }, { passive: true });
    strip.addEventListener('focusin', () => { _pagerStripFocused = true; });
    strip.addEventListener('focusout', e => {
      if (e.relatedTarget) { _pagerStripFocused = false; return; }
      // Focus went NOWHERE: a tap on the page, another window — or #results
      // wiped from under it (Chrome says so as the tab is removed; Safari says
      // nothing). Then the rebuild follows in this same task and reads the
      // flag before this timer clears it.
      setTimeout(() => {
        const now = document.getElementById('dayStrip');
        if (!now || !now.contains(document.activeElement)) _pagerStripFocused = false;
      }, 0);
    });
    strip.addEventListener('keydown', _dayStripKeydown);
    const summary = container.querySelector('.summary');
    container.insertBefore(strip, summary ? summary.nextSibling : container.firstChild);
  }
  const held = _heldDaysFor(m);
  strip.querySelectorAll('.day-pill').forEach(pill => {
    const d = pill.dataset.day, n = m.counts[d] || 0, on = d === window._pagerDay;
    // A day that was never loaded, or is not open for booking yet, prints no
    // "0" — that is a claim about the timetable — and the first is not quiet
    // either: nobody knows that it is empty.
    const state = (m.states && m.states[d]) || null;
    pill.classList.toggle('active', on);
    pill.classList.toggle('is-empty', n === 0 && state !== 'unknown');
    pill.classList.remove('is-target');
    pill.setAttribute('aria-selected', String(on));
    pill.setAttribute('aria-label', _pagerSpoken(d, m.todayStr, n, state) + _pagerHeldSpoken(held[d]));
    pill.tabIndex = on ? 0 : -1; // one tab stop; the arrow keys move inside it
    const countEl = pill.querySelector('.day-pill-count');
    const count = state ? '' : String(n);
    if (countEl && countEl.textContent !== count) countEl.textContent = count;
    _paintDayDot(pill, held[d]);
  });
  if (!built) return;
  // A rebuild: the row goes back to where the member left it — and only a
  // day that is out of sight moves it (a new range starts from 0, above).
  // Rebuilt while another tab is up (a resume re-renders Discover in place) it
  // has no layout box: the offset cannot be written and nothing can be
  // measured. It is owed instead — switchTab (tabs.js) pays it, as it does
  // for the date row (_revealActiveDatePill).
  window._dayStripRevealOwed = !(strip.clientWidth > 0);
  strip.scrollLeft = _pagerStripLeft;
  _revealDayPill(strip);
  // Focus that was in the strip when #results was wiped fell to <body>: hand
  // it back. Never taken from anything else that holds it by now.
  const at = document.activeElement;
  if (_pagerStripFocused && (!at || at === document.body)) {
    const sel = strip.querySelector('.day-pill.active');
    if (sel) { try { sel.focus({ preventScroll: true }); } catch (e) {} }
  } else {
    _pagerStripFocused = false;
  }
}

// Bring the selected day into view inside the strip — the ROW's own
// scrollLeft, never scrollIntoView(): that scrolls the page as well.
function _revealDayPill(strip) {
  try {
    const pill = strip.querySelector('.day-pill.active');
    if (!pill || !(strip.clientWidth > 0) || !(strip.scrollWidth > strip.clientWidth)) return;
    const rowBox = strip.getBoundingClientRect(), box = pill.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(strip).columnGap) || 0;
    const next = _scrollLeftToReveal(strip.scrollLeft, strip.clientWidth, box.left - rowBox.left + strip.scrollLeft, box.width, pad);
    if (next !== strip.scrollLeft) strip.scrollLeft = next;
    _pagerStripLeft = strip.scrollLeft;
  } catch (e) { /* a nicety */ }
}

// switchTab('discover') pays what _paintDayStrip owed (window._dayStripRevealOwed):
// the strip is laid out now, so its offset goes back and the selected day comes
// into view. Without it a member who had picked Thursday came back to a strip
// showing Today · Tomorrow · Sun, the lit pill out of sight.
function _restoreDayStrip() {
  const strip = document.getElementById('dayStrip');
  if (!strip) return;
  strip.scrollLeft = _pagerStripLeft;
  _revealDayPill(strip);
}

// A theme re-measures every pill without the strip being rebuilt: Terminal and
// Handheld swap in a monospace body face, each pill widens, the row's
// scrollLeft stays put — and the lit day (a picked Tue 22) sat cut off at the
// right edge, count and all. Picked in Membership → Appearance the strip has
// no layout box, so it is owed like a rebuild behind another tab and
// switchTab('discover') pays it; changed with Discover up (the header toggle
// out of a mono theme narrows the pills again) it is brought in at once. The
// date row's lit pill is a pill in the same kind of row: _revealActiveDatePill
// owes itself when it cannot measure. Neither moves a pill already in view.
function _revealPillsAfterThemeChange() {
  const strip = document.getElementById('dayStrip');
  if (strip) {
    if (strip.clientWidth > 0) _revealDayPill(strip);
    else window._dayStripRevealOwed = true;
  }
  _revealActiveDatePill();
}
PsycleEvents.on('theme:changed', _revealPillsAfterThemeChange);

// The pager: the tab panel of whichever day is selected. Returns the track —
// the element a swipe moves, and the host of the day's group.
function _ensureDayPager(container, m) {
  let pager = document.getElementById('dayPager');
  if (pager && pager.parentNode !== container) { pager.remove(); pager = null; }
  if (!pager) {
    pager = document.createElement('div');
    pager.id = 'dayPager';
    pager.className = 'day-pager';
    pager.setAttribute('role', 'tabpanel');
    pager.innerHTML = '<div class="day-track"></div>';
    container.appendChild(pager);
  }
  pager.setAttribute('aria-labelledby', 'dayTab-' + window._pagerDay);
  _paintDayHint(pager, m);
  return pager.querySelector('.day-track');
}

// "Swipe to change day" — once, ever. Marked seen the moment it is first
// shown; it then stays up for this page session (every filter tap rebuilds
// #results) until it is tapped away or a swipe has changed the day.
function _paintDayHint(pager, m) {
  let hint = pager.querySelector('.day-hint');
  if (!_pagerHintLive) {
    let seen = true, touch = false;
    try { seen = localStorage.getItem(PAGER_HINT_KEY) === '1'; } catch (e) {}
    try { touch = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch (e) {}
    // The welcome is up (in the iOS app, its holding cover): a hint shown now
    // would sit under it, spent. Judged by the overlay — it is inserted while
    // app.js is evaluated, before any list is drawn. A missing completion flag
    // says nothing: a launch on a #bookings link skips the welcome and leaves
    // it unset, and that newcomer is exactly who was never told about swiping.
    const welcomeUp = !!document.getElementById('onboardOverlay');
    if (welcomeUp) _pagerSawWelcome = true;
    // …or it was opened and closed with no paint of this list in between (at
    // launch, or a replay from Settings): the welcome says so itself (_onboardReveal).
    if (_pagerHintWanted({ paged: m.paged, touch, seen, welcomeUp, welcomedThisSession: _pagerSawWelcome || window._psycleWelcomeSeen === true })) {
      _pagerHintLive = true;
      try {
        if (typeof window._psycleSafeSetItem === 'function') window._psycleSafeSetItem(PAGER_HINT_KEY, '1');
        else localStorage.setItem(PAGER_HINT_KEY, '1');
      } catch (e) {}
    }
  }
  if (!_pagerHintLive) { if (hint) hint.remove(); return; }
  if (hint) return;
  hint = document.createElement('button');
  hint.type = 'button';
  hint.className = 'day-hint';
  hint.setAttribute('aria-label', 'Swipe to change day. Dismiss');
  hint.innerHTML = '<span>Swipe to change day</span><span class="day-hint-x" aria-hidden="true">×</span>';
  pager.insertBefore(hint, pager.firstChild);
}

function _dismissDayHint() {
  _pagerHintLive = false;
  const hint = document.querySelector('#dayPager .day-hint');
  if (hint) hint.remove();
}

// One click listener on #results (it outlives every wipe): day pills, the
// an empty day's way on, and the hint.
function _wireDayPager(container) {
  if (container._pagerWired) return;
  container._pagerWired = true;
  container.addEventListener('click', e => {
    const t = e.target && typeof e.target.closest === 'function' ? e.target : null;
    if (!t) return;
    if (t.closest('.day-hint')) { _dismissDayHint(); return; }
    if (t.closest('[data-pager-retry]')) { search({ force: true }); return; } // "Couldn't check this day"
    const to = t.closest('.day-pill, [data-pager-day]');
    if (to) showDiscoverDay(to.dataset.day || to.dataset.pagerDay, to.classList.contains('day-pill') ? 'tap' : 'jump');
  });
}

// Left / Right / Home / End with focus in the strip. The tab that becomes
// selected takes focus (tabs with automatic activation).
function _dayStripKeydown(e) {
  const m = _pagerModel;
  if (!m || !m.paged || e.altKey || e.ctrlKey || e.metaKey) return;
  let day = null;
  if (e.key === 'ArrowLeft') day = _pagerStep(m.days, window._pagerDay, -1);
  else if (e.key === 'ArrowRight') day = _pagerStep(m.days, window._pagerDay, 1);
  else if (e.key === 'Home') day = m.days[0];
  else if (e.key === 'End') day = m.days[m.days.length - 1];
  else return;
  e.preventDefault(); // Home / End would scroll the page
  if (day) showDiscoverDay(day, 'key');
}

function _pagerReducedMotion() {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
}

// A change of day puts the top of the day under the strip — and moves nothing
// when that is where it already is (filters still on screen above it). On a
// phone .tab-content scrolls and the strip is stuck to its top; wider, the
// document scrolls and the strip left with it, so it is brought back under
// the tab bar.
function _pagerScrollToTop() {
  const strip = document.getElementById('dayStrip'), pager = document.getElementById('dayPager');
  if (!strip || !pager) return;
  const sc = document.querySelector('.tab-content');
  const inner = !!sc && sc.scrollHeight > sc.clientHeight + 1 && getComputedStyle(sc).overflowY !== 'hidden' &&
    getComputedStyle(sc).overflowY !== 'visible';
  let edge = 0;
  if (inner) edge = sc.getBoundingClientRect().top;
  else {
    const bar = document.querySelector('.tab-bar');
    if (bar && getComputedStyle(bar).position === 'sticky') edge = Math.max(0, bar.getBoundingClientRect().bottom);
  }
  const s = strip.getBoundingClientRect();
  const delta = pager.getBoundingClientRect().top - (Math.max(s.top, edge) + s.height);
  if (delta >= -1) return;
  if (inner) sc.scrollTop += delta; else window.scrollBy(0, delta);
}

// Show another day of the loaded range. No search, nothing saved: the model
// render() kept is repainted. Refused while a Book button is mid-request or a
// dialog is up — that flow holds a button in the list (as _renderWindowInPlace).
//   how: 'tap' | 'key' | 'nav' | 'jump' | 'swipe'
function showDiscoverDay(day, how) {
  const m = _pagerModel;
  const container = document.getElementById('results');
  if (!m || !m.paged || !container || !document.getElementById('dayPager')) return false;
  if (m.days.indexOf(day) === -1 || day === window._pagerDay) return false;
  if (_discoverBusy()) return false;
  const dir = day > window._pagerDay ? 1 : -1;
  window._pagerDay = day;
  window._pagerChosen = true;
  if (how === 'swipe') _dismissDayHint();
  _paintDayStrip(container, m);
  const strip = document.getElementById('dayStrip');
  if (strip) {
    _revealDayPill(strip);
    if (how === 'key') { const sel = strip.querySelector('.day-pill.active'); if (sel) { try { sel.focus({ preventScroll: true }); } catch (e) {} } }
  }
  announce(_pagerSpoken(day, m.todayStr, m.counts[day] || 0, (m.states && m.states[day]) || null));
  _swapPagerDay(container, dir);
  return true;
}

function stepDiscoverDay(dir, how) {
  const m = _pagerModel;
  const day = m && m.paged ? _pagerStep(m.days, window._pagerDay, dir) : null;
  return day ? showDiscoverDay(day, how || 'nav') : false;
}

// Old day out, new day in: a short slide the way the days run. Reduced motion
// — or a list that has been rebuilt meanwhile — simply swaps. Whatever runs,
// the day painted is window._pagerDay AS IT IS BY THEN: two quick taps end on
// the second day, and a render() that landed in between already drew it.
function _swapPagerDay(container, dir) {
  if (_pagerSwap) clearTimeout(_pagerSwap.timer); // a second change mid-slide: one paint, of the latest day
  clearTimeout(_pagerSettleTimer);
  _pagerSwap = null;
  const track = container.querySelector('#dayPager .day-track');
  const paint = () => {
    const m = _pagerModel;
    if (!m || !m.paged || !container.isConnected) return;
    // An empty day's "Next day with classes" button is rebuilt away with the
    // day. Pressed from the keyboard, focus would fall to <body>: it goes to
    // the strip's selected day instead — the pills are the tappable (and
    // arrow-key) twin of the swipe; the heading carries no buttons.
    const at = document.activeElement;
    const held = at && typeof at.closest === 'function' && at.closest('#dayPager') ? at.closest('[data-pager-day]') : null;
    _paintDays(container, m);
    if (held) {
      const to = document.querySelector('#dayStrip .day-pill[aria-selected="true"]');
      if (to) { try { to.focus({ preventScroll: true }); } catch (e) {} }
    }
    const now = container.querySelector('#dayPager .day-track');
    // From here on this track's cards skip their own entrance: it would replay
    // under the slide, on every change of day. (Never taken off again — lifting
    // `animation: none` is what would start it.)
    if (now) now.classList.add('is-swapped');
    _pagerScrollToTop();
  };
  if (!track || _pagerReducedMotion()) { _resetDayTrack(track); paint(); return; }
  const w = (track.parentNode && track.parentNode.clientWidth) || 0;
  const slide = `transform ${PAGER_SLIDE_MS}ms ease-out, opacity ${PAGER_SLIDE_MS}ms ease-out`;
  track.style.transition = slide;
  track.style.transform = `translateX(${-dir * Math.max(w * 0.35, 48)}px)`;
  track.style.opacity = '0';
  const swap = { paint, timer: setTimeout(() => {
    if (_pagerSwap === swap) _pagerSwap = null;
    paint();
    const now = container.querySelector('#dayPager .day-track');
    if (!now) return;
    now.style.transition = 'none';
    now.style.transform = `translateX(${dir * 48}px)`;
    now.style.opacity = '0';
    void now.offsetWidth; // commit the starting point before the transition is switched back on
    now.style.transition = slide;
    now.style.transform = 'translateX(0)';
    now.style.opacity = '1';
    _pagerSettleTimer = setTimeout(() => _resetDayTrack(now), PAGER_SLIDE_MS + 30);
  }, PAGER_SLIDE_MS) };
  _pagerSwap = swap;
}

// A day still sliding out has not been painted yet. Whoever needs the list to
// BE the selected day right now (a new drag) paints it first — the timer is
// never simply dropped, or the old day would stay under the new day's tab.
function _flushPagerSwap() {
  const swap = _pagerSwap;
  if (!swap) return;
  _pagerSwap = null;
  clearTimeout(swap.timer);
  swap.paint();
}

function _resetDayTrack(track) {
  if (!track) return;
  track.style.transition = '';
  track.style.transform = '';
  track.style.opacity = '';
  track.style.willChange = '';
}

// The swipe, as js/interactions.js's _psycleSwipe reports it (that helper owns
// the gesture rules — horizontal intent, the 25% / flick release, resistance
// at an edge; this only says where it may start and what it moves).
window._dayPagerSwipe = {
  // May a touch on `target` become a day swipe?
  canStart(target) {
    const m = _pagerModel;
    if (!m || !m.paged || !target || typeof target.closest !== 'function' || !target.closest('#dayPager')) return false;
    let overlay = false;
    try { overlay = _dialogOpen() || _ownKeysOverlayUp() || _overlayStack.length > 0; } catch (e) {}
    return !overlay && !_discoverBusy();
  },
  edges() {
    const m = _pagerModel;
    return { prev: !!(m && _pagerStep(m.days, window._pagerDay, -1)), next: !!(m && _pagerStep(m.days, window._pagerDay, 1)) };
  },
  // The list follows the finger; the day it is heading for lights up in the strip.
  drag(offset, dx) {
    const m = _pagerModel;
    if (!m || _pagerReducedMotion()) return;
    _flushPagerSwap();
    clearTimeout(_pagerSettleTimer);
    const track = document.querySelector('#dayPager .day-track');
    if (!track) return;
    track.style.transition = 'none';
    track.style.willChange = 'transform';
    track.style.opacity = '';
    track.style.transform = `translateX(${offset}px)`;
    const to = _pagerStep(m.days, window._pagerDay, dx < 0 ? 1 : -1);
    document.querySelectorAll('#dayStrip .day-pill').forEach(p => p.classList.toggle('is-target', !!to && p.dataset.day === to));
  },
  // dir: 1 = next day (swiped left), -1 = previous, 0 = spring back.
  release(r) {
    document.querySelectorAll('#dayStrip .day-pill.is-target').forEach(p => p.classList.remove('is-target'));
    // The day really changed (stepDiscoverDay refuses at an edge or while a
    // search streams): one light tick under the thumb. 'tap' = a LIGHT impact in
    // the iOS app (native-bridge.js), a 10ms vibrate where the web supports it.
    if (r && r.dir && !r.cancelled && stepDiscoverDay(r.dir, 'swipe')) { if (typeof window.haptic === 'function') window.haptic('tap'); return; }
    const track = document.querySelector('#dayPager .day-track');
    if (!track || !track.style.transform) return;
    track.style.transition = `transform ${PAGER_SLIDE_MS}ms ease-out`;
    track.style.transform = 'translateX(0)';
    clearTimeout(_pagerSettleTimer);
    _pagerSettleTimer = setTimeout(() => _resetDayTrack(track), PAGER_SLIDE_MS + 30);
  },
};

// ── Studio multi-select chips ────────────────────────────────────
// selectedLocations: Set of location IDs (strings). Empty = all studios.
const selectedLocations = new Set();

// ── Faceted filter counts ────────────────────────────────────────
// The filter controls show LIVE match-counts from the fetched timetable
// window (window._facetClasses, built in render()) and dim options that
// would yield zero results given the OTHER active selections. Counts
// exclude their own dimension (via PsycleFacets), so options narrow as
// you stack filters — multi-select preserved. Until the first search
// populates the window, _facetResult is null and controls render plainly.
function discoverFacets() {
  // Count only the selected days: the window can hold the whole week while
  // "Today" is showing, and a chip must not promise classes from other days.
  // (_classDays — the calendar dots — reads _facetClasses unfiltered on purpose.)
  const { startDate, endDateStr } = currentWindowDates();
  return PsycleFacets.run(window._facetClasses || [], {
    instructor: [...selectedInstructors],
    location: [...selectedLocations],
    category: [...selectedCategories],
  }, {
    accessors: {
      instructor: c => c.instr,
      location: c => c.loc,
      category: c => c.cat,
    },
    dateFilter: c => _dayInRange(c.start_at, startDate, endDateStr) &&
      // …and only what the Time row lets through, by render()'s own two tests:
      // a chip must not count classes the list will not show.
      _inTimeBands(c.start_at, selectedTimeBands) && !(_availableOnly && c.full && !_myBookings[c.id]),
  });
}

function refreshFacetCounts() {
  window._facetResult =
    (typeof PsycleFacets !== 'undefined' && window._facetClasses && window._facetClasses.length)
      ? discoverFacets()
      : null;
  renderInstrDropdown();
  renderLocationChips();
  renderCategoryPills();
}

// value -> count map for one dimension, or null before the first search.
function _facetCounts(dim) {
  const r = window._facetResult;
  if (!r || !r.facets || !r.facets[dim]) return null;
  const m = Object.create(null);
  r.facets[dim].forEach(o => { m[o.value] = o.count; });
  return m;
}

function renderLocationChips() {
  const box = document.getElementById('locationChips');
  if (!box) return;
  const counts = _facetCounts('location');
  const allActive = selectedLocations.size === 0;
  // aria-pressed beside every .active: the selection was a CSS class only.
  let html = `<button class="loc-chip${allActive ? ' active' : ''}" aria-pressed="${allActive}" onclick="toggleLocation('')">All</button>`;
  html += locations.map(l => {
    const active = selectedLocations.has(String(l.id));
    const n = counts ? (counts[String(l.id)] || 0) : null;
    const dim = (counts && n === 0 && !active) ? ' dimmed' : '';
    const badge = n != null ? `<span class="chip-count">${n}</span>` : '';
    return `<button class="loc-chip${active ? ' active' : ''}${dim}" aria-pressed="${active}" onclick="toggleLocation('${l.id}')">${escapeHTML(l.name.replace('Psycle ', ''))}${badge}</button>`;
  }).join('');
  _repaintKeepingFocus(box, html);
  updateLocationHint();
}

function toggleLocation(id) {
  if (typeof _dropFocusStash === 'function') _dropFocusStash('loc'); // chosen by hand: theirs to save
  if (!id) {
    selectedLocations.clear();
  } else {
    const sid = String(id);
    if (selectedLocations.has(sid)) selectedLocations.delete(sid);
    else selectedLocations.add(sid);
  }
  refreshFacetCounts();
  triggerAutoSearch();
}

function updateLocationHint() {
  const hint = document.getElementById('locationHint');
  if (!hint) return;
  hint.textContent = selectedLocations.size === 0 ? '— all studios' : '';
}

// Feature 7 removed — "Today at Psycle" auto-load was noisy.
// The app now relies on Feature 13 (restore last search) or the empty state quick actions.

// ── Feature 13: Restore persisted search results ────────────────
function restoreLastResults() {
  try {
    const raw = sessionStorage.getItem('psycle_last_results');
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!saved.events || !saved.relations) return false;

    // Reconstruct Set-based filters from serialised arrays
    const filters = {
      instructorId: saved.filters.instructorId || [],
      locationIds: saved.filters.locationIds || (saved.filters.locationId ? [saved.filters.locationId] : []),
      categoryKeys: new Set(saved.filters.categoryKeys || []),
      startDate: saved.filters.startDate || '',
      endDateStr: saved.filters.endDateStr || '',
      strengthSubs: new Set(saved.filters.strengthSubs || ['UPPER', 'LOWER', 'FULL']),
      reformerSubs: new Set(saved.filters.reformerSubs || REFORMER_SUBS.map(s => s.key)),
      // A session saved before the Time row existed carries neither: any time.
      timeBands: new Set(saved.filters.timeBands || []),
      availableOnly: !!saved.filters.availableOnly,
      // When these numbers were fetched. None = unknown, and an unknown age
      // prints no "spots left" (render → _countsFresh).
      dataAt: Number(saved.at) || 0,
    };
    render(saved.events, saved.relations, filters, true);
    return true;
  } catch (e) {
    console.warn('[psycle] restoreLastResults failed:', e);
    return false;
  }
}

// ── Instructor multi-select widget ──────────────────────────────
// selectedInstructors and instrFocusIdx managed by state.js

// ── pure:stored-data:start ── (DOM-free; tests/suites/import-validate.js evaluates this block)
// What comes back out of localStorage is not ours to trust: Import settings
// writes a file someone else may have made, and on iOS the Preferences mirror
// brings it back after every purge. Ids and seat lists end up in markup and in
// inline handlers, so they are coerced HERE, where they are read — every
// consumer is then safe, whatever its template does. (Names and other free
// text stay as they are: those are escaped where they are printed.)

// An id, as it may safely sit in an attribute or a quoted handler argument.
// Psycle's are digits, but that shape is not ours to assume — any short token
// of word characters passes; anything else is no id at all.
function _cleanStoredId(v) {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  const s = String(v);
  return /^[\w.:-]{1,64}$/.test(s) ? s : '';
}

function _cleanStoredIdList(v, max) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (let i = 0; i < v.length && out.length < (max || 5000); i++) {
    const id = _cleanStoredId(v[i]);
    if (id && out.indexOf(id) === -1) out.push(id);
  }
  return out;
}

// Seat numbers: numbers, or numeric text — nothing else becomes one (Number(null)
// is 0, Number([]) is 0…).
function _cleanStoredNumbers(v) {
  if (!Array.isArray(v)) return [];
  return v.filter(x => typeof x === 'number' || (typeof x === 'string' && x.trim() !== ''))
    .map(Number).filter(n => Number.isFinite(n));
}

// psycle_class_history: plain entries of primitives plus `slots`, a list of
// numbers. Unknown primitive fields pass through (other modules add their
// own); nested objects have no business in an entry and are dropped.
// The fields every reader treats as TEXT ((typeName || '').toUpperCase(),
// date.replace(' ', 'T')…) are text or nothing: `typeName: 5` from a crafted
// backup threw in Stats, the History modal and the weekly-template detection —
// and the add-only import could never replace the row. null stays null
// (`cancelledAt: null` is what a live entry carries).
const STORED_HISTORY_TEXT_KEYS = ['typeName', 'instrName', 'locName', 'date', 'bookedAt', 'cancelledAt'];
function _cleanStoredHistory(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  v.forEach(h => {
    if (!h || typeof h !== 'object' || Array.isArray(h)) return;
    const e = {};
    Object.keys(h).forEach(k => {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') return;
      const val = h[k];
      if (k === 'slots') e.slots = _cleanStoredNumbers(val);
      else if (k === 'eventId' || k === 'instrId') e[k] = _cleanStoredId(val);
      else if (typeof val === 'string') e[k] = val.length > 300 ? val.slice(0, 300) : val;
      else if (STORED_HISTORY_TEXT_KEYS.indexOf(k) !== -1) { if (val === null) e[k] = null; } // text or nothing
      else if (val === null || typeof val === 'boolean' || (typeof val === 'number' && Number.isFinite(val))) e[k] = val;
    });
    out.push(e);
  });
  return out;
}

// psycle_instructor_tiers: { id: 'S'…'F' } and nothing else.
function _cleanStoredTiers(v) {
  const out = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  Object.keys(v).forEach(k => {
    const id = _cleanStoredId(k);
    if (id && id !== '__proto__' && id !== 'constructor' && id !== 'prototype' &&
        typeof v[k] === 'string' && /^[SABCDF]$/.test(v[k])) out[id] = v[k];
  });
  return out;
}

// psycle_bike_prefs: { studioId: { avoid: [n…], prefer: [n…] } } — seat numbers.
function _cleanStoredBikePrefs(v) {
  const out = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  Object.keys(v).forEach(k => {
    const id = _cleanStoredId(k);
    const p = v[k];
    if (!id || id === '__proto__' || id === 'constructor' || id === 'prototype') return;
    if (!p || typeof p !== 'object' || Array.isArray(p)) return;
    out[id] = { avoid: _cleanStoredNumbers(p.avoid), prefer: _cleanStoredNumbers(p.prefer) };
  });
  return out;
}
// ── pure:stored-data:end ──

// ── Favourite instructors (persisted to localStorage) ────────────
const FAV_KEY = 'psycle_fav_instructors';

function loadFavourites() {
  try { return new Set(_cleanStoredIdList(JSON.parse(localStorage.getItem(FAV_KEY) || '[]'))); }
  catch { return new Set(); }
}

// Small hand-entered settings (stars, rankings, bike prefs). A full
// localStorage used to throw out of the tap that called these — nothing was
// saved and nothing said so. Frees the app's own caches and retries first
// (security.js); false = still not saved, and the member has been told.
function _saveSetting(key, json) {
  let ok = false;
  try {
    if (typeof window._psycleSafeSetItem === 'function') ok = window._psycleSafeSetItem(key, json);
    else { localStorage.setItem(key, json); ok = true; }
  } catch (e) {}
  if (!ok && typeof toast === 'function') toast("Couldn't save that — this device's storage is full", 'error');
  return ok;
}

function saveFavourites(favs) {
  _saveSetting(FAV_KEY, JSON.stringify([...favs]));
}

// Initialize favourites into PsycleState from localStorage
favouriteInstructors = loadFavourites();
// iOS: native-bridge (the last deferred script) restores the mirrored keys
// into localStorage AFTER the line above has run. After a storage purge that
// left the Set empty for the whole launch — no stars, a dead Favs button — and
// the next star tap saved that empty Set plus one over the mirrored list.
if (window._psycleNativeRestoreReady) {
  window._psycleNativeRestoreReady.then(() => {
    favouriteInstructors = loadFavourites();
    try { renderInstrDropdown(); renderInstrChips(); updateDiscoverEmptyState(); } catch (e) {}
  });
}

// One star on or off. The change is applied to what is STORED now, never to
// the Set this page read at launch: a stale Set (the restore above, a second
// tab, another member's data swapped in) can then never overwrite the list.
function setFavourite(id, on) {
  const favs = loadFavourites();
  if (on) favs.add(String(id)); else favs.delete(String(id));
  favouriteInstructors = favs;
  saveFavourites(favs);
}

function toggleFavourite(id, e) {
  e.stopPropagation();
  const sid = String(id);
  // Direction from what the member SEES (the star they tapped), write from storage.
  setFavourite(sid, !favouriteInstructors.has(sid));
  renderInstrDropdown();
  renderInstrChips();
}

function applyFavouritesAsFilter() {
  if (favouriteInstructors.size === 0) return;
  selectedInstructors.clear();
  favouriteInstructors.forEach(id => selectedInstructors.add(id));
  renderInstrChips();
  renderInstrDropdown();
  triggerAutoSearch();
}

// ── pure:tier-filter:start ── (tests/suites/owner-tools.js evaluates this block against stub globals)
// Ids of the LOADED instructors the member ranked S or A. The tier map is
// parsed once per call (settings.js's getInstructorTier re-parses it for every
// id) and only ever compared — it can come from an imported settings file.
// Ids are taken from `instructors`, so a rank for someone who has left Psycle
// never becomes a chip that matches nothing.
function _topTierInstructorIds() {
  let tiers = null;
  try { tiers = JSON.parse(localStorage.getItem('psycle_instructor_tiers') || '{}'); } catch {}
  // An array is an object too, and ["S","A"]["1"] would rank instructor 1.
  if (!tiers || typeof tiers !== 'object' || Array.isArray(tiers)) return [];
  return instructors
    .filter(i => tiers[String(i.id)] === 'S' || tiers[String(i.id)] === 'A')
    .map(i => String(i.id));
}

// "S/A" beside "★ Favs": the same one-tap filter, from the tier ranking
// instead of the stars. interactions.js wraps it with saveFilters, like Favs.
function applyTierFilter() {
  const ids = _topTierInstructorIds();
  // Nothing ranked S/A (any more): the button is stale — take it away rather
  // than clear the member's current instructors for an empty result.
  if (ids.length === 0) { _syncTierFilterBtn(ids); return; }
  selectedInstructors.clear();
  ids.forEach(id => selectedInstructors.add(id));
  renderInstrChips();
  refreshFacetCounts();
  triggerAutoSearch();
}

// Shown only while at least one loaded instructor is ranked S or A — "any tier
// exists" would offer a filter that selects nobody to a member with B–F only.
function _syncTierFilterBtn(ids) {
  const btn = document.getElementById('tierBtn');
  if (btn) btn.style.display = (ids || _topTierInstructorIds()).length ? '' : 'none';
}
// ── pure:tier-filter:end ──

function getFilteredInstructors() {
  const q = (document.getElementById('instrSearch')?.value || '').toLowerCase().trim();
  return q ? instructors.filter(i => i.full_name.toLowerCase().includes(q)) : instructors;
}

function renderInstrChips() {
  const chips = document.getElementById('instrChips');
  if (!chips) return;
  chips.innerHTML = [...selectedInstructors].map(id => {
    const instr = instructors.find(i => String(i.id) === String(id));
    const name = instr?.full_name || id;
    const safeId = escapeForJsString(id);
    // mousedown (not click) keeps focus in the search box; a keyboard press
    // arrives as a click with detail 0 — the only one the mousedown missed.
    return `<span class="instr-chip">${escapeHTML(name)}
      <button type="button" onmousedown="event.preventDefault();removeInstructor('${safeId}')" onclick="if(event.detail===0)removeInstructor('${safeId}')" aria-label="Remove ${escapeHTML(name)}" title="Remove">×</button>
    </span>`;
  }).join('');
  // Every instructor-filter repaint passes through here (launch, chips,
  // restore, clear), so this is where the S/A button learns about new ranks.
  _syncTierFilterBtn();
}

function renderInstrDropdown() {
  const dd = document.getElementById('instrDropdown');
  if (!dd) return;
  const list = getFilteredInstructors();
  // Don't reset keyboard-nav focus if the dropdown is open (e.g. a background
  // refreshFacetCounts shouldn't break arrow-key navigation mid-use).
  if (dd.style.display === 'none') instrFocusIdx = -1;
  const counts = _facetCounts('instructor');
  // Sort: favourites first, then available-before-dimmed (zero-count last),
  // preserving the alphabetical order within each group.
  const sorted = [...list].sort((a, b) => {
    const aFav = favouriteInstructors.has(String(a.id));
    const bFav = favouriteInstructors.has(String(b.id));
    if (aFav !== bFav) return aFav ? -1 : 1;
    if (counts) {
      const aZero = (counts[String(a.id)] || 0) === 0;
      const bZero = (counts[String(b.id)] || 0) === 0;
      if (aZero !== bZero) return aZero ? 1 : -1;
    }
    return 0;
  });
  dd.innerHTML = sorted.length
    ? sorted.map((i, idx) => {
        const sel = selectedInstructors.has(String(i.id));
        const fav = favouriteInstructors.has(String(i.id));
        const n = counts ? (counts[String(i.id)] || 0) : null;
        const dim = (counts && n === 0 && !sel) ? ' dimmed' : '';
        const badge = n != null ? `<span class="instr-count">${n}</span>` : '';
        return `<div class="instr-option${sel ? ' selected' : ''}${dim}" data-id="${i.id}" data-idx="${idx}"
          onmousedown="event.preventDefault();toggleInstructor('${i.id}')">
          <span class="check">${sel ? '✓' : ''}</span>
          <span style="flex:1">${escapeHTML(i.full_name)}</span>
          ${badge}
          <span class="fav-star${fav ? ' fav-on' : ''}" title="${fav ? 'Remove favourite' : 'Add favourite'}"
            onmousedown="event.preventDefault();toggleFavourite('${i.id}',event)">★</span>
        </div>`;
      }).join('')
    : '<div class="instr-option" style="color:var(--text-dim);cursor:default">No matches</div>';
}

function toggleInstructor(id) {
  const sid = String(id);
  if (selectedInstructors.has(sid)) selectedInstructors.delete(sid);
  else selectedInstructors.add(sid);
  document.getElementById('instrSearch').value = '';
  renderInstrChips();
  refreshFacetCounts();
  triggerAutoSearch();
}

function removeInstructor(id) {
  selectedInstructors.delete(String(id));
  // × on a shortcut's instructor chip is how the member goes back to browsing:
  // their own studio / class-type / Time-row filters come back with it, BEFORE
  // the counts, the search and (interactions.js) the save read the sets.
  if (!selectedInstructors.size && typeof _restoreFocusStash === 'function') _restoreFocusStash();
  renderInstrChips();
  refreshFacetCounts();
  triggerAutoSearch();
}

function focusInstrSearch(e) {
  document.getElementById('instrSearch').focus();
}

function filterInstrDropdown() {
  renderInstrDropdown();
  document.getElementById('instrDropdown').style.display = 'block';
}

function showInstrDropdown() {
  renderInstrDropdown();
  document.getElementById('instrDropdown').style.display = 'block';
}

function hideInstrDropdown() {
  setTimeout(() => {
    document.getElementById('instrDropdown').style.display = 'none';
  }, 150);
}

function instrKeydown(e) {
  const dd = document.getElementById('instrDropdown');
  const opts = [...dd.querySelectorAll('.instr-option[data-id]')];
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    instrFocusIdx = Math.min(instrFocusIdx + 1, opts.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    instrFocusIdx = Math.max(instrFocusIdx - 1, 0);
  } else if (e.key === 'Enter' && instrFocusIdx >= 0) {
    e.preventDefault();
    toggleInstructor(opts[instrFocusIdx].dataset.id);
    return;
  } else if (e.key === 'Escape') {
    dd.style.display = 'none';
    return;
  } else if (e.key === 'Backspace' && !e.target.value && selectedInstructors.size) {
    const instrArr = [...selectedInstructors]; const last = instrArr[instrArr.length - 1];
    removeInstructor(last);
    return;
  }
  opts.forEach((o, i) => o.classList.toggle('focused', i === instrFocusIdx));
  if (instrFocusIdx >= 0) opts[instrFocusIdx]?.scrollIntoView({ block: 'nearest' });
}
// ── Category pill filter ────────────────────────────────────────
function renderCategoryPills() {
  const container = document.getElementById('categoryPills');
  if (!container) return;
  // Only show categories that exist in loaded event types
  const presentCats = new Set();
  for (const t of eventTypes) {
    presentCats.add(getCategory(t.name).key);
  }
  const catsToShow = CATEGORY_MAP.filter(c => presentCats.has(c.key) || eventTypes.length === 0);
  const counts = _facetCounts('category');
  _repaintKeepingFocus(container, catsToShow.map(cat => {
    const active = selectedCategories.has(cat.key);
    const n = counts ? (counts[cat.key] || 0) : null;
    const dim = (counts && n === 0 && !active) ? ' dimmed' : '';
    const badge = n != null ? `<span class="pill-count">${n}</span>` : '';
    // Crisp Colour: the one pill row that wears colour — each class type in its
    // own (data-ct), led by its pictogram tile.
    return `<button class="cat-pill${active ? ' active' : ''}${dim}" aria-pressed="${active}" data-ct="${cat.key.toLowerCase()}"
      onclick="toggleCategory('${cat.key}')"><span class="ct-tile is-sm is-solid" aria-hidden="true">${classPictogram(cat.key, 15)}</span>${cat.label}${badge}</button>`;
  }).join(''));
}

function toggleCategory(key) {
  if (typeof _dropFocusStash === 'function') _dropFocusStash('cat'); // chosen by hand: theirs to save
  if (selectedCategories.has(key)) selectedCategories.delete(key);
  else selectedCategories.add(key);
  refreshFacetCounts();
  renderStrengthSubPills();
  renderReformerSubPills();
  triggerAutoSearch();
}

// ── Time row: time-of-day bands + "Available only" ───────────────
// Onboarding promised filtering "by time" and there was none: an after-work
// class meant scrolling past every morning at every studio, full ones
// included. Both narrow the loaded window client-side, like the other pills.
// selectedTimeBands: TIME_BANDS keys. Empty = any time.
const selectedTimeBands = new Set();
let _availableOnly = false; // hide full classes (never the member's own — see render())

// The row reuses .location-chips + .cat-pill (css/redesign.css styles pill
// rows by those), so it needs no CSS of its own and follows every theme.
function renderTimePills() {
  const box = document.getElementById('timePills');
  if (!box) return;
  _repaintKeepingFocus(box, TIME_BANDS.map(b => {
    const active = selectedTimeBands.has(b.key);
    return `<button class="cat-pill${active ? ' active' : ''}" aria-pressed="${active}" onclick="toggleTimeBand('${b.key}')">${b.label}</button>`;
  }).join('') +
    `<button class="cat-pill${_availableOnly ? ' active' : ''}" aria-pressed="${_availableOnly}" onclick="toggleAvailableOnly()">Available only</button>`);
}
renderTimePills(); // static labels: nothing to wait for (the scripts are deferred, the row exists)

function toggleTimeBand(key) {
  if (typeof _dropFocusStash === 'function') _dropFocusStash('time'); // chosen by hand: theirs to save
  if (selectedTimeBands.has(key)) selectedTimeBands.delete(key);
  else selectedTimeBands.add(key);
  renderTimePills();
  refreshFacetCounts(); // the chip counts follow the Time row too (discoverFacets)
  triggerAutoSearch();
}

// triggerAutoSearch re-filters at once and, when the window's numbers are old,
// refreshes them silently — "full" from this morning is not worth hiding by.
function toggleAvailableOnly() {
  if (typeof _dropFocusStash === 'function') _dropFocusStash('time');
  _availableOnly = !_availableOnly;
  renderTimePills();
  refreshFacetCounts();
  triggerAutoSearch();
}

// Lift the Time row only (the empty list's button): the instructor, studio
// and dates — often just set FOR the member by Find similar / Book again —
// stay as they are.
function clearTimeFilters() {
  if (typeof _dropFocusStash === 'function') _dropFocusStash('time');
  selectedTimeBands.clear();
  _availableOnly = false;
  renderTimePills();
  refreshFacetCounts();
  triggerAutoSearch();
}

// Saved Time row → state. interactions.js restoreFilters calls this instead of
// writing the two bindings itself: it guards every app.js name with typeof,
// and a bare assignment cannot be guarded. Only known band keys come back —
// the list arrives from localStorage.
function setTimeFilters(bands, availableOnly) {
  selectedTimeBands.clear();
  (Array.isArray(bands) ? bands : []).forEach(k => {
    if (TIME_BANDS.some(b => b.key === k)) selectedTimeBands.add(k);
  });
  _availableOnly = availableOnly === true;
  renderTimePills();
}

// A flow that searches FOR the member around one time of day ("Same class
// next week", "Same time, any instructor") lands on a list the Time row still
// filters: with "After 17:00" on, every 7am class the toast announced is hidden —
// and the list is rarely EMPTY, so the "Show all times" rescue never shows.
// Additive, like the studio and class-type filters there: a row with nothing
// on gains nothing, and an hour that cannot be read adds no band.
function _admitTimeBands(startAts) {
  if (!selectedTimeBands.size) return;
  let changed = false;
  startAts.forEach(s => {
    const key = _timeBandOf(s);
    if (key && !selectedTimeBands.has(key)) { selectedTimeBands.add(key); changed = true; }
  });
  if (changed) { renderTimePills(); refreshFacetCounts(); }
}
// ────────────────────────────────────────────────────────────────

// Allow pressing Enter to search — scoped to the filters panel so Enter
// inside dialogs/modals elsewhere doesn't fire a surprise search.
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (document.getElementById('psycleConfirmOverlay')) return;
  if (!e.target || !e.target.closest || !e.target.closest('#controlsPanel')) return;
  // The Filters bar, its chips and "Clear" are buttons with a job of their own:
  // Enter there opens the panel / lifts a filter, and must not ALSO search.
  if (e.target.closest('#controlsBar')) return;
  search();
});

// ── Upcoming bookings panel ──────────────────────────────────────
// Keep backward compat — other modules call refreshUpcomingPanel
function refreshUpcomingPanel() { renderMyBookings(); }

let _showPastBookings = false;

function togglePastBookings() {
  _showPastBookings = !_showPastBookings;
  renderMyBookings();
}

// ── Skeleton loading for My Bookings ────────────────────────────
function showBookingSkeleton(count) {
  const panel = document.getElementById('upcomingPanel');
  const list = document.getElementById('upcomingList');
  if (!panel || !list) return;
  // The saved copy (see _paintSavedBookings) is already on screen: real class
  // times beat grey bars for the second until the live cards replace them.
  if (list.querySelector('.is-saved-copy')) return;
  panel.style.display = '';
  const n = Math.min(count, 6);
  let html = '';
  for (let i = 0; i < n; i++) {
    html += `<div class="mb-skeleton">
      <div class="mb-skeleton-time"></div>
      <div class="mb-skeleton-body">
        <div class="mb-skeleton-line" style="width:60%"></div>
        <div class="mb-skeleton-line" style="width:40%"></div>
        <div class="mb-skeleton-line short" style="width:30%"></div>
      </div>
    </div>`;
  }
  list.innerHTML = html;
}

// ── Countdown helper for imminent classes ────────────────────────
let _gymDayFmt = null; // lazy: the gym's (London) calendar date of an instant
// 'YYYY-MM-DD' on the gym's calendar for an instant, `addDays` later. Calendar
// arithmetic on the DATE, not +24h on the instant: the clocks-back day is 25
// hours long. Throws when the engine has no Europe/London data.
function _gymDayKey(ms, addDays) {
  if (!_gymDayFmt) {
    _gymDayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
  }
  const p = {};
  _gymDayFmt.formatToParts(new Date(ms)).forEach(x => { if (x.type !== 'literal') p[x.type] = Number(x.value); });
  return new Date(Date.UTC(p.year, p.month - 1, p.day + (addDays || 0))).toISOString().slice(0, 10);
}

// `startAt` is the API's raw (naive UK wall-clock) string. Given it, the chip
// counts from the REAL start — the instant _cancelDeadline reads — and takes
// today / tomorrow off the gym's calendar, so abroad "In 10h" can no longer sit
// beside a late-cancel warning that says 5. Without it, or without
// Europe/London data, it stays device-local: right on a UK device.
function getCountdownText(eventDate, now, startAt) {
  let startMs = eventDate.getTime();
  let todayStr = localDateStr(now);
  let eventDayStr = localDateStr(eventDate);

  // Check if tomorrow
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  let tomorrowStr = localDateStr(tomorrow);

  if (typeof startAt === 'string' && typeof window !== 'undefined' && typeof window._psycleClassStartMs === 'function') {
    try {
      const realMs = window._psycleClassStartMs(startAt);
      if (!isNaN(realMs)) {
        // All three keys before anything is swapped: a throw leaves the local set whole.
        const keys = [_gymDayKey(now.getTime(), 0), _gymDayKey(realMs, 0), _gymDayKey(now.getTime(), 1)];
        startMs = realMs;
        todayStr = keys[0];
        eventDayStr = keys[1];
        tomorrowStr = keys[2];
      }
    } catch (e) { /* no Europe/London data — stay device-local, as _cancelDeadline does */ }
  }

  const diff = startMs - now.getTime();
  if (diff <= 0) return null; // past

  const diffHours = diff / (1000 * 60 * 60);

  if (eventDayStr === todayStr) {
    const { hrs, mins } = _hoursMinsLeft(diffHours);
    // The last 30 seconds round to 0: never "In 0min" (the dialog says "1 min").
    if (hrs === 0) return mins === 0 ? 'Starting now' : `In ${mins}min`;
    if (mins === 0) return `In ${hrs}h`;
    return `In ${hrs}h ${mins}m`;
  } else if (eventDayStr === tomorrowStr) {
    return `Tomorrow ${_clock24(eventDate.getHours(), eventDate.getMinutes())}`;
  }
  return null; // not today or tomorrow
}

// ── Saved copy of My Bookings ────────────────────────────────────
// _myBookings is memory-only, so a launch with no signal — the studio door —
// had nothing to show. After every list Psycle confirms, the display fields of
// each held class are kept in psycle_bookings_snapshot and PAINTED (read-only,
// labelled "Saved copy · HH:MM") while this session has no answer from Psycle.
// They are never fed back into _myBookings / _eventCache: the iOS calendar
// reconcile, the widget and the T-90 reminders all read those, and must only
// ever follow what the server said.

// ── pure:offline:start ── (DOM-free helpers; tests/suites/offline.js evaluates this block)
const BOOKINGS_SNAPSHOT_MAX_ITEMS = 40;
const BOOKINGS_SNAPSHOT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // older says nothing useful about today

function _snapshotText(v, max) {
  return String(v == null ? '' : v).slice(0, max || 80);
}

// One item → exactly the shape the painter relies on, or null. Storage is not
// trusted: it can be hand-edited, half-written or left by another build.
function _coerceSnapshotItem(it) {
  if (!it || typeof it !== 'object') return null;
  const id = _snapshotText(it.id, 24);
  const startAt = _snapshotText(it.start_at, 32);
  if (!/^\d+$/.test(id) || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(startAt)) return null;
  const duration = Number(it.duration);
  const spaces = Number(it.spaces);
  return {
    id,
    start_at: startAt,
    duration: duration > 0 && duration < 600 ? Math.round(duration) : 0,
    type: _snapshotText(it.type, 80) || 'Class',
    instructor: _snapshotText(it.instructor, 80),
    location: _snapshotText(it.location, 80),
    studio: _snapshotText(it.studio, 80),
    slots: (Array.isArray(it.slots) ? it.slots : []).map(Number).filter(n => n > 0 && n < 10000).slice(0, 12),
    spaces: spaces > 1 && spaces < 100 ? Math.round(spaces) : 0, // no-layout studios hold a count, not seats
    waitlisted: it.waitlisted === true,
  };
}

// What is in storage → { owner, savedAt, items }, or null: unparseable, some
// other shape, no owner to tie it to, or too old to be worth showing.
function _coerceBookingsSnapshot(raw, nowMs) {
  let snap = raw;
  if (typeof raw === 'string') { try { snap = JSON.parse(raw); } catch (e) { return null; } }
  if (!snap || typeof snap !== 'object' || snap.v !== 1 || !Array.isArray(snap.items)) return null;
  const owner = _snapshotText(snap.owner, 40);
  const savedAt = Number(snap.savedAt);
  if (!owner || !(savedAt > 0) || nowMs - savedAt > BOOKINGS_SNAPSHOT_MAX_AGE_MS) return null;
  const items = snap.items.map(_coerceSnapshotItem).filter(Boolean).slice(0, BOOKINGS_SNAPSHOT_MAX_ITEMS);
  return { owner, savedAt, items };
}

// The record of what is held right now. A class whose details couldn't be
// loaded this time keeps its previous entry (with today's seats) instead of
// vanishing. Null = don't write: without an owner it can't be tied to an
// account, and whatever is stored already is the better copy.
function _buildBookingsSnapshot(bookings, eventCache, prev, owner, nowMs) {
  if (owner == null || owner === '') return null;
  const prevById = {};
  if (prev && prev.owner === String(owner)) (prev.items || []).forEach(it => { prevById[it.id] = it; });
  const items = [];
  Object.keys(bookings || {}).forEach(id => {
    const b = bookings[id] || {};
    const evt = (eventCache || {})[id];
    const known = evt
      ? { id, start_at: evt.start_at, duration: evt.duration, type: evt._typeName, instructor: evt._instrName, location: evt._locName, studio: evt._studioName }
      : prevById[id];
    if (!known) return;
    const seats = Array.isArray(b.slots) ? b.slots : [];
    const item = _coerceSnapshotItem(Object.assign({}, known, {
      slots: seats,
      spaces: seats.length ? 0 : (b.bookingIds || []).length,
      waitlisted: !!b.waitlisted,
    }));
    if (item) items.push(item);
  });
  items.sort((a, b) => a.start_at.localeCompare(b.start_at));
  return { v: 1, owner: String(owner), savedAt: nowMs, items: items.slice(0, BOOKINGS_SNAPSHOT_MAX_ITEMS) };
}

// Saved classes still worth showing: until the class has ENDED — a member
// running late still needs their bike number. `startMsOf` = _gymClassStartMs.
function _snapshotItemsToShow(items, nowMs, startMsOf) {
  return (items || []).filter(it => {
    const start = startMsOf(it.start_at);
    return !isNaN(start) && start + (it.duration || 45) * 60000 > nowMs;
  });
}

// "Saved copy · 14:05" — with the day once it is no longer today's.
function _snapshotLabel(savedAt, nowMs) {
  const d = new Date(savedAt), now = new Date(nowMs);
  const hhmm = _clock24(d.getHours(), d.getMinutes());
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return 'Saved copy · ' + (sameDay ? '' : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ', ') + hhmm;
}

// Read-only cards in the live list's markup (same day groups and card classes)
// minus everything that acts: no onclick, no buttons, no data-id — the swipe,
// Similar and button-resync code must never take one for a live booking.
// `waiting` = Psycle has been asked and not answered yet (no Retry to offer).
function _savedBookingsHTML(items, label, waiting) {
  let html = `<div class="mb-saved-note" role="status">
    <span class="mb-saved-label">${escapeHTML(label)}</span>
    <span class="mb-saved-text">${waiting
      ? 'Checking with Psycle for changes…'
      : "Can't reach Psycle right now, so this is your list as it was then. Booking, cancelling and changing spots need a connection."}</span>
    ${waiting ? '' : '<button type="button" class="booking-action-btn" onclick="retrySavedBookings(this)">Retry</button>'}
  </div>`;
  const byDay = {};
  items.forEach(it => {
    const day = it.start_at.slice(0, 10);
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(it);
  });
  Object.keys(byDay).sort().forEach(day => {
    // The card carries its own day ("Thu 24"), as the live card does: noon on
    // that date reads as the same weekday in any device zone.
    const dayLabel = new Date(day + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
    html += `<div class="mb-day-group"><div class="class-grid">`;
    byDay[day].forEach(it => {
      // The class time is a UK wall-clock string: show its own digits.
      const hours = Number(it.start_at.slice(11, 13));
      const mins = it.start_at.slice(14, 16);
      const noun = slotLabel(it.type);
      // Crisp Colour: tinted by class type, with its pictogram (typeof: this
      // block is evaluated on its own by tests/suites/offline.js).
      const ctKey = typeof classTypeKey === 'function' ? classTypeKey(it.type) : 'other';
      const tile = typeof classPictogram === 'function' ? `<span class="ct-tile" aria-hidden="true">${classPictogram(ctKey, 18)}</span>` : '';
      let seatHtml = it.slots.map(slot => `<span class="ct-badge is-seat up-seat-chip">${escapeHTML(noun)} ${Number(slot)}</span>`).join('');
      if (!seatHtml && it.spaces > 1) seatHtml = `<span class="ct-badge is-seat up-seat-chip">${Number(it.spaces)} spaces</span>`;
      const where = escapeHTML(it.location) + (it.studio ? ' · ' + escapeHTML(it.studio) : '');
      // The time block and the title row are the shared card's own (_ccTimeHTML,
      // .cc-head / .cc-name): a saved class reads exactly as it does live.
      const when = typeof _ccTimeHTML === 'function' ? _ccTimeHTML({ hours, mins, duration: it.duration, dayHtml: escapeHTML(dayLabel), hook: 'mb-when' }) : '';
      html += `<div class="class-card ct-card${it.waitlisted ? ' is-dashed is-waitlisted' : ' is-booked'} my-booking-card is-saved-copy" data-ct="${ctKey}">
        ${when}
        <div class="class-info mb-what">
          <div class="cc-head mb-title">${tile}<span class="cc-name mb-name">${escapeHTML(it.type)}</span></div>
          <div class="class-instructor cc-sub mb-meta">${it.instructor ? `<span class="cc-who">${escapeHTML(it.instructor)}</span>` : ''}${where ? `<span class="cc-loc class-location">${where}</span>` : ''}</div>
          ${(seatHtml || it.waitlisted) ? `<div class="class-meta mb-badges">${seatHtml ? `<span class="up-seats">${seatHtml}</span>` : ''}${it.waitlisted ? '<span class="badge waitlist">Waitlisted</span>' : ''}</div>` : ''}
        </div>
      </div>`;
    });
    html += `</div></div>`;
  });
  return html;
}
// ── pure:offline:end ──

const BOOKINGS_SNAPSHOT_KEY = 'psycle_bookings_snapshot';

function _readBookingsSnapshot() {
  try { return _coerceBookingsSnapshot(localStorage.getItem(BOOKINGS_SNAPSHOT_KEY), Date.now()); } catch (e) { return null; }
}

function _clearBookingsSnapshot() {
  try { localStorage.removeItem(BOOKINGS_SNAPSHOT_KEY); } catch (e) {}
}

// Only from a map Psycle has confirmed this session ('loaded'): before that
// _myBookings can be empty or hold just the class booked a moment ago, and
// writing that would throw the good copy away.
function _saveBookingsSnapshot() {
  if (_bookingsLoadState !== 'loaded' || !getBearerToken()) return;
  const owner = currentUser ? currentUser.id : _lastProfileId;
  const snap = _buildBookingsSnapshot(_myBookings, _eventCache, _readBookingsSnapshot(), owner, Date.now());
  if (!snap) return;
  try { localStorage.setItem(BOOKINGS_SNAPSHOT_KEY, JSON.stringify(snap)); } catch (e) {}
}

// Called from renderMyBookings' empty branch. True = the saved copy is up and
// the caller skips its skeleton / hero. Never once this session's list is
// known — a loaded list, even an empty one, is the truth — except when that
// list loaded but none of its classes could be drawn (`unhydrated`, as in
// renderMyBookings): then the saved entries of the classes it names are shown.
function _paintSavedBookings(panel, list, countEl, emptyEl) {
  if (!getBearerToken()) return false;
  const unhydrated = !!currentUser && Object.keys(_myBookings).some(id => !_eventCache[id]);
  const listKnown = _bookingsLoadState === 'loaded';
  if (listKnown && !unhydrated) return false;
  const snap = _readBookingsSnapshot();
  if (!snap) return false;
  // Another account's copy is never painted (auth:changed below deletes it).
  const owner = currentUser ? currentUser.id : _lastProfileId;
  if (owner != null && String(owner) !== snap.owner) return false;
  let items = _snapshotItemsToShow(snap.items, Date.now(), _gymClassStartMs);
  if (listKnown) items = items.filter(it => _myBookings[it.id]);
  if (!items.length) return false;
  // Still waiting for an answer (first /profile or /bookings in flight) vs
  // Psycle could not be reached — only the second has anything to retry.
  const waiting = currentUser
    ? (_bookingsLoadState === 'pending' && !unhydrated)
    : _authGateViewFor(true, _authUnverified) === 'checking';
  const seats = items.filter(it => !it.waitlisted).length;
  countEl.textContent = items.length > seats ? `${seats} + ${items.length - seats} waitlist` : String(seats);
  if (emptyEl) emptyEl.style.display = 'none';
  panel.style.display = '';
  list.innerHTML = _savedBookingsHTML(items, _snapshotLabel(snap.savedAt, Date.now()), waiting);
  return true;
}

// Retry on the saved copy: whichever step never got an answer.
function retrySavedBookings(btn) {
  return currentUser ? retryBookingsLoad(btn) : retryAuth(btn);
}

if (typeof PsycleEvents !== 'undefined') {
  // Every confirmed list, and every local change on top of one (the refetch
  // that follows a booking may never land if the signal drops right after).
  ['bookings:loaded', 'booking:complete', 'booking:cancelled', 'seat:cancelled',
    'waitlist:joined', 'waitlist:left', 'waitlist:claimed'].forEach(evt => {
    PsycleEvents.on(evt, () => _saveBookingsSnapshot());
  });
  // The copy belongs to one signed-in account. No token left (sign-out,
  // session expiry) or a different customer behind the new one → delete it,
  // and take it off the screen if it is up.
  PsycleEvents.on('auth:changed', s => {
    let stale = !getBearerToken();
    // No token in MEMORY is not always a session that ended: when the crypto
    // set-up times out on a slow launch, security.js keeps the stored token
    // for the next one — and that launch, offline, had no copy left to paint.
    // Every real ending (clearToken, showSessionExpired) removes the stored
    // keys before it emits. A localStorage that throws still deletes.
    if (stale) {
      try {
        if (localStorage.getItem('psycle_bearer_token_enc') || localStorage.getItem('psycle_bearer_token')) stale = false;
      } catch (e) {}
    }
    if (!stale && s && s.signedIn && currentUser && currentUser.id != null) {
      const snap = _readBookingsSnapshot();
      stale = !!snap && snap.owner !== String(currentUser.id);
    }
    if (!stale) return;
    _clearBookingsSnapshot();
    if (document.querySelector('#upcomingList .is-saved-copy')) renderMyBookings();
  });
}

// ── pure:bookings-started:start ── (DOM-free; tests/suites/3d-leftovers.js evaluates this block)
// Has this held class started? start_at is a naive London wall clock: parsed
// device-locally, a member EAST of London had a class still hours away filed
// under "past" — off My Bookings, behind the "Show past" toggle. `startMsOf` =
// _gymClassStartMs (it falls back to the device-local parse by itself where
// the engine has no Europe/London data). A time nothing can place has NOT
// started: a held class must never leave the list on a parsing accident.
function _classHasStarted(startAt, nowMs, startMsOf) {
  const ms = startMsOf(startAt);
  return !isNaN(ms) && ms <= nowMs;
}
// ── pure:bookings-started:end ──

// ── pure:bookings-card:start ── (third region: what the Crisp Colour card shows)
// ── pure:bookings-crisp:start ── (the same block under a name of its own: tests/suites/9d-bookings.js,
//    3d-leftovers.js and render-perf.js run renderMyBookings without the rest of pure:bookings-card)
// Function declarations only, nothing from the page: tests/suites/offline.js
// evaluates everything between the snapshot key and renderMyBookings in a bare vm.

// 'YYYY-MM-DD…' (a London date, straight off start_at) → "Thu 24". Read from the
// digits, as UTC: the device zone can never move a class to the day before.
function _mbShortDay(dayKey) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dayKey == null ? '' : dayKey));
  if (!m) return '';
  var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (isNaN(d.getTime()) || d.getUTCDate() !== Number(m[3])) return ''; // 2026-02-31 is no day
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()] + ' ' + d.getUTCDate();
}

// Which actions a held class shows, and which sit behind "More". The card has
// room for the one that matters (cancel / leave / claim or check) and ONE quiet
// companion; the rest are a tap away. The ORDER of `more` is the order on
// screen. A menu of one is no menu: a lone overflow action goes on the card.
//   f = { place, offerOpen, checkFirst, seats, canChange, hasMap }
//   → { primary, secondary | null, inline: [...], more: [...] }
function _mbActionPlan(f) {
  f = f || {};
  var lead = !!(f.offerOpen || f.checkFirst);
  var plan = f.place
    // A place has no seat to add or change, and "I'm going to…" is untrue for it.
    ? { primary: lead ? (f.offerOpen ? 'claim' : 'check') : 'leave', secondary: lead ? 'leave' : 'check', more: ['similar'] }
    : { primary: 'cancel', secondary: (f.canChange && Number(f.seats) > 0) ? 'change' : null, more: [] };
  if (!f.place) {
    if (!(Number(f.seats) >= 2)) plan.more.push('add');
    plan.more.push('similar');
  }
  if (f.hasMap) plan.more.push('map');
  if (!f.place) plan.more.push('share');
  plan.inline = plan.more.length === 1 ? plan.more.splice(0, 1) : [];
  return plan;
}

// The More button's name says what is behind it: "More for Ride 45: add spot,
// find similar, map, share". Plain text — the caller escapes it.
function _mbMoreName(typeName, keys) {
  var words = { add: 'add spot', similar: 'find similar', map: 'map', share: 'share' };
  var list = (keys || []).map(function (k) { return words[k]; }).filter(Boolean);
  return 'More for ' + (typeName || 'this class') + (list.length ? ': ' + list.join(', ') : '');
}

// Arrow keys inside the open menu: the item to focus next, or null when the
// key is not one of ours. Up / Left and Down / Right step and wrap.
function _mbMoreKeyStep(key, index, count) {
  if (!(count > 0)) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowDown' || key === 'ArrowRight') return index < 0 ? 0 : (index + 1) % count;
  if (key === 'ArrowUp' || key === 'ArrowLeft') return index < 0 ? count - 1 : (index - 1 + count) % count;
  return null;
}

// What a billing period is called: Psycle bills by the month, some plans by the
// week; anything else is just "period" rather than a guess.
function _mbPeriodWord(startMs, endMs) {
  var days = (Number(endMs) - Number(startMs)) / 86400000;
  if (!(days > 0)) return 'period';
  if (days >= 27.5 && days <= 31.5) return 'month';
  if (days >= 6.5 && days <= 7.5) return 'week';
  return 'period';
}

// "8 of 12 this month · Resets 12 Oct" — the plan-usage line over the cards.
//   o = { made, max, startMs, endMs, resetLabel, next }  a subscription period
//       (`next` = the period after this one; resetLabel is then its first day)
//   o = { credits }                                     a credit pack
//   → { num, rest, when, bar }   num is set in the display face;
//     bar = null | { segments, filled } | { pct }
function _mbUsageModel(o) {
  o = o || {};
  if (o.credits != null) {
    var c = Math.max(0, Number(o.credits) || 0);
    return { num: String(c), rest: (c === 1 ? 'credit' : 'credits') + ' left', when: '', bar: null };
  }
  var made = Math.max(0, Number(o.made) || 0);
  var max = Math.max(0, Number(o.max) || 0);
  var word = (o.next ? 'next ' : 'this ') + _mbPeriodWord(o.startMs, o.endMs);
  var label = o.resetLabel ? String(o.resetLabel) : '';
  if (!max) {
    // No cap to count against. (_plural: app.js pure:copy — "1 class", "2 classes".)
    var booked = made > 0 ? _plural(made, 'class', 'classes') + ' booked' : '';
    return {
      num: made > 0 ? booked.slice(0, booked.indexOf(' ')) : 'Unlimited',
      rest: made > 0 ? booked.slice(booked.indexOf(' ') + 1) + ' ' + word : word,
      when: label ? (o.next ? 'From ' : 'Renews ') + label : '',
      bar: null,
    };
  }
  var filled = Math.min(made, max);
  return {
    num: made + ' of ' + max,
    rest: word,
    when: label ? (o.next ? 'From ' : 'Resets ') + label : '',
    // One segment per class while they stay readable; a plain fill beyond that.
    bar: max <= 16 ? { segments: max, filled: filled } : { pct: Math.round((filled / max) * 100) },
  };
}

// …and its markup. `esc` = escapeHTML (the labels are dates we formatted, but
// they started as API text). The bar repeats the words beside it: aria-hidden.
function _mbUsageHtml(model, esc) {
  esc = esc || String;
  var html = '<div class="mb-usage-text"><span class="mb-usage-count"><span class="mb-usage-num">' + esc(model.num) + '</span>' +
    (model.rest ? ' ' + esc(model.rest) : '') + '</span>' +
    (model.when ? '<span class="mb-usage-when">' + esc(model.when) + '</span>' : '') + '</div>';
  var bar = model.bar;
  if (bar && bar.segments) {
    var cells = '';
    for (var i = 0; i < bar.segments; i++) cells += '<i' + (i < bar.filled ? ' class="is-on"' : '') + '></i>';
    html += '<div class="sub-progress mb-usage-bar is-segmented" aria-hidden="true">' + cells + '</div>';
  } else if (bar) {
    html += '<div class="sub-progress mb-usage-bar" aria-hidden="true"><div class="sub-progress-fill" style="width:' +
      Math.max(0, Math.min(100, Number(bar.pct) || 0)) + '%"></div></div>';
  }
  return html;
}
// ── pure:bookings-crisp:end ──
// ── pure:bookings-card:end ──

function renderMyBookings() {
  const panel = document.getElementById('upcomingPanel');
  const list = document.getElementById('upcomingList');
  const countEl = document.getElementById('upcomingCount');

  const now = new Date();
  const started = evt => _classHasStarted(evt.start_at, now.getTime(), _gymClassStartMs);
  const all = Object.entries(_myBookings)
    .map(([evtId, booking]) => {
      const evt = _eventCache[evtId];
      return evt ? { evt, booking, evtId } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.evt.start_at.localeCompare(b.evt.start_at));

  const upcoming = all.filter(({ evt }) => !started(evt));
  // A waitlist place that never became a seat is not an attended class.
  const past = all.filter(({ evt, booking }) => started(evt) && !booking.waitlisted);

  // Header count = classes you're actually in; places are called out separately.
  const upcomingSeats = upcoming.filter(({ booking }) => !booking.waitlisted).length;
  const upcomingPlaces = upcoming.length - upcomingSeats;
  countEl.textContent = upcomingPlaces ? `${upcomingSeats} + ${upcomingPlaces} waitlist` : String(upcomingSeats);

  // Empty tab: a real destination, not a blank page. Signed out → the
  // one action that matters (sign in); signed in → go find a class.
  const emptyEl = document.getElementById('bookingsEmpty');
  const histBtn = document.getElementById('historyInBookingsBtn');
  let histCount = 0;
  try { histCount = JSON.parse(localStorage.getItem('psycle_class_history') || '[]').length; } catch {}

  if (upcoming.length === 0 && past.length === 0) {
    panel.style.display = 'none';
    // Hidden is not gone: after a sign-out (or an account switch) the previous
    // member's cards stayed in the DOM inside the hidden panel.
    list.innerHTML = '';
    if (histBtn) histBtn.style.display = (currentUser && histCount > 0) ? '' : 'none';
    // Psycle hasn't answered for this session (still asking, launched offline,
    // a failed load): the read-only saved copy beats a skeleton or a Retry hero.
    // (typeof: the suites run this function on its own, without the painter.)
    if (typeof _paintSavedBookings === 'function' && _paintSavedBookings(panel, list, countEl, emptyEl)) return;
    // Signed in but /bookings never answered: "Nothing booked" would be a
    // guess (and its cards would say Book over classes already held). Just as
    // much a guess when it DID answer but no held class could be drawn — a
    // cold launch where every GET /events/{id} failed leaves `all` empty over
    // a map that is not.
    const unhydrated = currentUser && Object.keys(_myBookings).some(id => !_eventCache[id]);
    // …and while the first /bookings is still on its way: currentUser is set
    // the moment /profile lands, seconds before the list does (~10s when it
    // ends in a failure, retries included), and tabs.js's first paint — or any
    // repaint in between — read "Nothing booked — yet". Loading, not a verdict:
    // fetchMyBookings / _noteBookingsLoadFailed repaint whichever way it settles.
    if (currentUser && _bookingsLoadState === 'pending' && !unhydrated) {
      if (emptyEl) emptyEl.style.display = 'none';
      showBookingSkeleton(2);
      return;
    }
    if (emptyEl) {
      emptyEl.style.display = '';
      // A token that is still stored but unconfirmed (offline launch, Psycle
      // blip) gets Retry — telling a signed-in member to "Sign in" is wrong.
      const gate = currentUser ? '' : authGateHTML();
      emptyEl.innerHTML = gate ? gate : ((currentUser && _bookingsLoadState === 'failed') || unhydrated)
        ? `<div class="tab-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8.8a15 15 0 0 1 20 0M5 12.5a10.5 10.5 0 0 1 14 0M8.5 16a6 6 0 0 1 7 0M12 20h.01M3 3l18 18"/></svg></div>
           <div class="tab-empty-title">Couldn't load<br>your bookings</div>
           <div class="tab-empty-sub">Psycle didn't answer just now. Anything you've booked is safe — check your connection and try again.</div>
           <button class="tab-empty-btn" onclick="retryBookingsLoad(this)">Retry</button>`
        : currentUser
        ? `<div class="tab-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></svg></div>
           <div class="tab-empty-title">Nothing booked<br>— yet</div>
           <button class="tab-empty-btn" onclick="switchTab('discover')">Find a class</button>`
        : `<div class="tab-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></svg></div>
           <div class="tab-empty-title">Your bookings<br>live here</div>
           <div class="tab-empty-sub">Sign in with your Psycle account to see and manage your upcoming classes.</div>
           <button class="tab-empty-btn" onclick="openLoginPopup()">Sign in</button>`;
    }
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';
  if (histBtn) histBtn.style.display = '';
  panel.style.display = '';
  const items = _showPastBookings ? [...upcoming, ...past] : upcoming;

  // Group by day
  const byDay = {};
  items.forEach(item => {
    const day = String(item.evt.start_at).slice(0, 10); // 'YYYY-MM-DD' of the T- and the space-form alike
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(item);
  });

  let html = '';
  if (_waitlistsUnavailable === 'failed' && currentUser) { // not while 'late': that request is still in flight
    html += `<div class="mb-waitlist-status" style="margin:0 0 8px">Couldn't load your waitlist places from Psycle just now — pull to refresh. Anything shown as Waitlisted below is from earlier.</div>`;
  }

  // Membership / credits info bar + billing period
  var periodStart = null, periodEnd = null, nextPeriodStart = null;
  const fmtDate = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const userStats = currentUser?.stats || {};
  const creditsRemaining = Number(userStats.credits_remaining) || 0;
  const availableCredits = currentUser?.available_credits || [];

  if (_activeSubscription) {
    periodStart = parsePsycleDate(_activeSubscription.period_start);
    periodEnd = parsePsycleDate(_activeSubscription.period_end);
    const periods = _activeSubscription.upcoming_billing_periods || [];
    nextPeriodStart = periods.length > 0 ? parsePsycleDate(periods[0].start) : null;

    // Only show the standalone sub-bar if there's NO period split
    // (when there IS a split, the period section headers replace it)
    const willHaveSplit = periodEnd && items.some(item => new Date(item.evt.start_at) >= periodEnd);
    if (!willHaveSplit) {
      // "8 of 12 this month · Resets 12 Oct" (_mbUsageModel, pure:bookings-crisp).
      // period_end is the first day of the NEXT period: the day the count resets.
      html += `<div class="sub-bar mb-usage">${_mbUsageHtml(_mbUsageModel({
        made: _activeSubscription.bookings_made,
        max: _activeSubscription.max_bookings,
        startMs: periodStart ? periodStart.getTime() : NaN,
        endMs: periodEnd ? periodEnd.getTime() : NaN,
        resetLabel: periodEnd ? fmtDate(periodEnd) : '',
      }), escapeHTML)}</div>`;
    }
  } else if (creditsRemaining > 0 || availableCredits.length > 0) {
    const totalCredits = creditsRemaining || availableCredits.reduce(function (sum, c) { return sum + (Number(c.remaining) || 0); }, 0);
    html += `<div class="sub-bar mb-usage">${_mbUsageHtml(_mbUsageModel({ credits: totalCredits }), escapeHTML)}</div>`;
  }

  // Past bookings toggle
  if (past.length > 0) {
    html += `<div class="mb-past-toggle"><button type="button" class="mb-past-btn" onclick="togglePastBookings()">${_showPastBookings ? 'Hide' : 'Show'} ${past.length} past class${past.length !== 1 ? 'es' : ''}</button></div>`;
  }

  // Bucket bookings by billing period
  var currentPeriodItems = [];
  var nextPeriodItems = [];
  var otherItems = [];

  let _countdownShown = 0;
  const sortedDays = Object.keys(byDay).sort();
  // The one card that glows (`upcoming` is in start order; a place is no seat).
  const nextSeat = upcoming.find(({ booking }) => !booking.waitlisted);
  const nextSeatId = nextSeat ? String(nextSeat.evtId) : null;

  if (periodEnd) {
    // Split items into current vs next billing period
    for (const day of sortedDays) {
      for (const item of byDay[day]) {
        const dt = new Date(item.evt.start_at);
        if (dt < periodEnd) {
          currentPeriodItems.push(item);
        } else {
          nextPeriodItems.push(item);
        }
      }
    }
  }

  // Render period sections with full sub-bar headers
  const hasPeriodSplit = periodEnd && nextPeriodItems.length > 0;
  const periods = _activeSubscription?.upcoming_billing_periods || [];
  // The fold mark of a period bar: one stroke, round ends, like the pictograms.
  const periodChevron = '<span class="mb-period-chevron" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M6 9.5l6 6 6-6"/></svg></span>';

  if (hasPeriodSplit && _activeSubscription) {
    // Current period sub-bar (open)
    html += `<div class="mb-period-section">`;
    // A div that acts as a button: role + tabindex make it reachable (app.js's
    // one keydown turns Enter / Space into the click), and aria-expanded follows
    // the toggle. The markup always says "true" (open); a period the member had
    // folded is folded again after a rebuild by _commitBookingsHtml, which sets
    // the class AND this attribute together.
    html += `<div class="mb-period-bar" role="button" tabindex="0" aria-expanded="true" onclick="this.setAttribute('aria-expanded', String(!this.parentElement.classList.toggle('collapsed')))">`;
    html += `<div class="mb-period-bar-text mb-usage">${_mbUsageHtml(_mbUsageModel({
      made: _activeSubscription.bookings_made,
      max: _activeSubscription.max_bookings,
      startMs: periodStart ? periodStart.getTime() : NaN,
      endMs: periodEnd.getTime(),
      resetLabel: fmtDate(periodEnd),
    }), escapeHTML)}</div>`;
    html += periodChevron;
    html += `</div>`;
    html += `<div class="mb-period-body">`;
  }

  // Render by day (with next period section injected between)
  var periodSeparatorShown = false;
  for (const day of sortedDays) {
    const dayItems = byDay[day];
    const date = new Date(day + 'T12:00:00');
    // `day` is a London date: a device ahead of London is already on the next
    // one while tonight's class is still to come — never dim a day with a live class.
    const isPast = date < now && day !== localDateStr(now) && dayItems.every(({ evt }) => started(evt));
    // Each card carries its own day ("Thu 24") over its time: no day headings.
    const dayLabel = _mbShortDay(day);

    // Close current period section and open next period section
    if (hasPeriodSplit && !periodSeparatorShown && periodEnd && date >= periodEnd) {
      periodSeparatorShown = true;

      // Close current period body + section
      html += `</div></div>`;

      // Next period sub-bar (collapsible, starts open): "2 of 12 next month · From 12 Oct".
      // Seats only — a waitlist place has not used a class yet.
      const nextPeriod = periods.length > 0 ? periods[0] : null;
      const nextStart = nextPeriod ? parsePsycleDate(nextPeriod.start) : null;
      const nextEnd = nextPeriod ? parsePsycleDate(nextPeriod.end) : null;
      const nextBooked = nextPeriodItems.filter(item => !item.booking.waitlisted).length;

      html += `<div class="mb-period-section">`;
      html += `<div class="mb-period-bar mb-period-bar-next" role="button" tabindex="0" aria-expanded="true" onclick="this.setAttribute('aria-expanded', String(!this.parentElement.classList.toggle('collapsed')))">`;
      html += `<div class="mb-period-bar-text mb-usage">${_mbUsageHtml(_mbUsageModel({
        made: nextBooked,
        max: _activeSubscription?.max_bookings,
        startMs: nextStart ? nextStart.getTime() : (periodEnd ? periodEnd.getTime() : NaN),
        // Psycle gives a period's end either as its last day or as the next
        // one's first: a day either way still reads as the same month / week.
        endMs: nextEnd ? nextEnd.getTime() : NaN,
        resetLabel: fmtDate(nextStart || periodEnd),
        next: true,
      }), escapeHTML)}</div>`;
      html += periodChevron;
      html += `</div>`;
      html += `<div class="mb-period-body">`;
    }

    html += `<div class="mb-day-group${isPast ? ' mb-past' : ''}">`;
    html += `<div class="class-grid">`;

    for (const { evt, booking, evtId } of dayItems) {
      const dt = new Date(evt.start_at);
      const typeName = evt._typeName || 'Class';
      const instrName = evt._instrName || '';
      const locName = evt._locName || '';
      const studioName = evt._studioName || '';
      const eventPast = started(evt);

      const slots = booking.slots || [];
      const isPlace = !!booking.waitlisted;              // waitlist place, no seat
      const place = booking.waitlist || null;            // {id,status,expiresAt,offer?} when on the waitlist
      const spotFree = !!(place && place.offer && place.offer.available);   // a probe saw a claimable spot
      const offerOpen = !!place && (spotFree || _waitlistOfferPending(place, now.getTime()));
      // Where a seatless place stands on Psycle's clock (books you in → emails
      // offers → closed). The card said "books you in automatically" right up
      // to class, just when a spot has to be claimed instead: the status line,
      // the badge and which button leads all follow the phase.
      const phase = (isPlace && !eventPast) ? _waitlistPhase(evt.start_at, now.getTime()) : 'auto';
      const checkFirst = isPlace && !offerOpen && phase === 'offers';
      // Seats only, upcoming only: ONE 12h cutoff drives the badge, the
      // "Free cancel until" line and whether Change spot is offered.
      const deadline = (!eventPast && !isPlace) ? _cancelDeadline(evt.start_at, now.getTime()) : null;

      // Crisp Colour: the card is tinted by CLASS TYPE and leads with its
      // pictogram (typeof: the suites run this function on its own, as below).
      const ctKey = typeof classTypeKey === 'function' ? classTypeKey(typeName) : 'other';
      const tileHtml = typeof classPictogram === 'function' ? `<span class="ct-tile" aria-hidden="true">${classPictogram(ctKey, 18)}</span>` : '';
      // The time block is the shared card's (Discover prints the very same one),
      // led here by the card's own day ("Thu 24").
      const whenHtml = typeof _ccTimeHTML === 'function' ? _ccTimeHTML({ hours: dt.getHours(), mins: dt.getMinutes(), duration: evt.duration, dayHtml: dayLabel, hook: 'mb-when' }) : '';
      // The glow marks what is yours, sparingly: the NEXT class you hold a seat in.
      const isNext = String(evtId) === nextSeatId;

      // (The duration sits under the time now, not among the badges.)
      let badges = '';
      if (isPlace) badges += `<span class="badge waitlist">${offerOpen ? (spotFree ? 'Spot available' : 'Spot offered') : (phase === 'closed' ? 'Waitlist closed' : 'Waitlisted')}</span>`;
      if (booking.fromWaitlist && !isPlace) badges += `<span class="badge waitlist">From waitlist</span>`;
      if (evt.is_live_stream) badges += `<span class="badge highlight">Online</span>`;
      if (eventPast && !isPlace) badges += `<span class="badge attended">Attended</span>`;
      if (deadline && deadline.insideWindow) badges += `<span class="badge late-cancel-note">Late-cancel window</span>`;

      // Countdown badge for the next 2 upcoming classes you hold a seat in
      if (!eventPast && !isPlace && _countdownShown < 2) {
        const cdText = getCountdownText(dt, now, evt.start_at);
        if (cdText) {
          // data-start: the minute tick (below renderMyBookings) re-reads the chip from it.
          badges += `<span class="mb-countdown" data-start="${escapeHTML(evt.start_at)}">${cdText}</span>`;
          _countdownShown++;
        }
      }

      // Seat chips + cancel. Yours, so they wear the class colour (.ct-badge.is-seat).
      let seatHtml = '';
      if (slots.length > 0) {
        const _slUp = slotLabelForEvent(evtId);
        const chips = slots.map(slot => {
          if (eventPast) return `<span class="ct-badge is-seat is-past up-seat-chip">${_slUp} ${slot}</span>`;
          // The per-seat × only earns its place when there's another seat to
          // keep; a single seat is cancelled with the Cancel button below.
          if (slots.length < 2) return `<span class="ct-badge is-seat up-seat-chip">${_slUp} ${slot}</span>`;
          return `<span class="ct-badge is-seat up-seat-chip">${_slUp} ${slot}<button onclick="event.stopPropagation();upcomingSeatCancel(${evtId}, ${slot}, this)" title="Cancel ${_slUp} ${slot}" aria-label="Cancel ${_slUp} ${slot}">&times;</button></span>`;
        }).join('');
        // is-multi: each chip carries a × — the row keeps its tap targets apart (css/crisp.css).
        seatHtml = `<span class="up-seats${(!eventPast && slots.length > 1) ? ' is-multi' : ''}">${chips}</span>`;
      } else if (!isPlace && (booking.bookingIds || []).length > 1) {
        // No-layout studio with more than one space held (each is a record).
        seatHtml = `<span class="up-seats"><span class="ct-badge is-seat up-seat-chip">${(booking.bookingIds || []).length} spaces</span></span>`;
      }

      // Waitlist status line (place only, or a place held on top of a seat)
      let placeHtml = '';
      if (place && !eventPast) {
        let statusText;
        if (place.unverified) {
          statusText = _waitlistsUnavailable === 'late'
            ? 'On the waitlist (still checking with Psycle…)'
            : "On the waitlist (couldn't re-check with Psycle just now — pull to refresh)";
        } else if (offerOpen) {
          let by = '';
          if (place.expiresAt) {
            // London wall clock, like the class time above it — never the
            // device zone (_londonClock says what that read abroad).
            const exMs = _waitlistTimeMs(place.expiresAt);
            if (!isNaN(exMs)) by = ` — accept by ${_londonClock(exMs)}`;
          }
          statusText = spotFree
            ? `A spot is free right now${by} — it isn't held for you, claim it before someone else does`
            : `A spot has opened up${by}`;
        } else if (isPlace) {
          statusText = phase === 'closed'
            ? 'Waitlist closed — it shuts 30 minutes before class, so you won’t be booked in from it now'
            : phase === 'offers'
            ? 'On the waitlist · this close to class Psycle usually emails an offer instead of booking you in — tap Check for a spot (keep a credit free)'
            : 'On the waitlist · Psycle books you in automatically if a spot frees up (keep a credit free)';
        } else {
          statusText = 'You also hold a waitlist place for this class';
        }
        placeHtml = `<div class="mb-waitlist-status${offerOpen ? ' is-offer' : ''}">${escapeHTML(statusText)}</div>`;
        if (!isPlace) {
          placeHtml += `<div class="booking-actions"><button class="booking-action-btn" onclick="event.stopPropagation();leaveWaitlist(${evtId}, this)" title="Give up the extra waitlist place">Leave waitlist</button></div>`;
        }
      }

      // Primary button: Cancel (every seat booking — the chip × alone was a
      // ~10px target and the only way out of a one-seat booking) / Leave or
      // Claim (place). upcomingCancel drops every seat or space held.
      let cancelBtn = '';
      if (!eventPast) {
        if (isPlace && (offerOpen || checkFirst)) {
          // One button, two labels: both ask Psycle first and book nothing
          // without claimWaitlistSpot's own confirm. In the offer window the
          // check is the useful action, so it leads (Leave drops to the row below).
          cancelBtn = `<button class="book-btn mb-primary-btn" onclick="event.stopPropagation();claimWaitlistSpot(${evtId}, this)">${offerOpen ? 'Claim spot' : 'Check for a spot'}</button>`;
        } else if (isPlace) {
          cancelBtn = `<button class="book-btn booked mb-primary-btn" onclick="event.stopPropagation();leaveWaitlist(${evtId}, this)">Leave waitlist</button>`;
        } else {
          const held = slots.length || (booking.bookingIds || []).length;
          cancelBtn = `<button class="book-btn booked mb-primary-btn" onclick="event.stopPropagation();upcomingCancel(${evtId}, this)">${held > 1 ? `Cancel all ${held}` : 'Cancel booking'}</button>`;
        }
      }

      // Until the cutoff, say when cancelling stops being free (after it the
      // "Late-cancel window" badge above takes over).
      const deadlineHtml = (deadline && !deadline.insideWindow)
        ? `<div class="mb-cancel-deadline">Free cancel until <strong>${deadline.label}</strong></div>`
        : '';

      // The other actions (upcoming only). The card has room for the primary
      // button and ONE quiet companion — Change spot, or the other waitlist
      // action; Add spot, Find similar, Map and Share sit behind "More"
      // (_mbActionPlan, pure:bookings-crisp). css/crisp.css lays the same
      // buttons out inline at desktop widths.
      let actionsHtml = '';
      let moreHtml = '';
      if (!eventPast) {
        const plan = _mbActionPlan({
          place: isPlace, offerOpen, checkFirst, seats: slots.length,
          // Change spot — only while cancelling is still free (>12h away)
          canChange: !!deadline && !deadline.insideWindow,
          hasMap: !!(evt._locAddress || evt._locFullName || evt._locName),
        });
        const actionBtn = {
          // Add a spot — opens bike picker to book an additional slot. It keeps
          // the menu open (data-more-keep): bookClass shows its "…" on THIS button.
          add: `<button class="booking-action-btn" data-more-keep onclick="event.stopPropagation();bookClass(${evtId}, this, ${evt.studio_id})" title="Add another spot">Add spot</button>`,
          change: `<button class="booking-action-btn" onclick="event.stopPropagation();changeSpot(${evtId})" title="Change to a different spot">Change spot</button>`,
          // A place has no seat to add/change: its companion is the other
          // waitlist action (Claim or Check is the primary button while an offer
          // is showing / the offer window is open — Leave then sits here).
          leave: `<button class="booking-action-btn" onclick="event.stopPropagation();leaveWaitlist(${evtId}, this)" title="Give up your waitlist place">Leave waitlist</button>`,
          check: `<button class="booking-action-btn" onclick="event.stopPropagation();claimWaitlistSpot(${evtId}, this)" title="Ask Psycle whether a spot is free to claim right now">Check for a spot</button>`,
          // find-similar-btn is the hook findSimilar() finds its card by.
          similar: `<button class="booking-action-btn find-similar-btn" onclick="event.stopPropagation();findSimilar(${evtId})" title="Find similar classes">Find similar</button>`,
          map: `<button class="booking-action-btn" onclick="event.stopPropagation();openMapForBooking(${evtId})" title="Open the studio in Maps">Map</button>`,
          share: `<button class="booking-action-btn" onclick="event.stopPropagation();shareClass(${evtId})" title="Invite a friend to this class">Share</button>`,
        };
        actionsHtml = `<div class="booking-actions mb-actions">${cancelBtn}${deadlineHtml}${plan.secondary ? actionBtn[plan.secondary] : ''}${plan.inline.map(k => actionBtn[k]).join('')}</div>`;
        if (plan.more.length) {
          // A disclosure, not an ARIA menu: the same buttons are laid out inline
          // at desktop widths, where a role="menu" would be a lie. toggleBookingMore
          // (below) moves focus in, closes on Escape / a tap outside, steps with
          // the arrow keys. .booking-actions: a touch here never starts a swipe.
          const moreName = escapeHTML(_mbMoreName(typeName, plan.more));
          moreHtml = `<div class="booking-actions mb-more">
            <button type="button" class="mb-more-btn" aria-expanded="false" aria-controls="mbMore-${evtId}" aria-label="${moreName}" onclick="event.stopPropagation();toggleBookingMore(this)"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="5" cy="12" r="0.8"/><circle cx="12" cy="12" r="0.8"/><circle cx="19" cy="12" r="0.8"/></svg></button>
            <div class="mb-more-menu" id="mbMore-${evtId}" role="group" aria-label="${moreName}">${plan.more.map(k => actionBtn[k]).join('')}</div>
          </div>`;
        }
      }

      const whereHtml = escapeHTML(locName) + (studioName ? ' · ' + escapeHTML(studioName) : '');
      const instrHtml = instrLink(instrName, evt.instructor_id) + (window.tierBadgeHTML ? window.tierBadgeHTML(evt.instructor_id) : '');
      const cardCls = (isPlace ? ' is-dashed is-waitlisted' : ' is-booked') + (isNext ? ' glow-mine-card' : '') +
        ((deadline && deadline.insideWindow) ? ' is-late' : '');
      // More comes LAST in the markup: on a phone the stylesheet pins its button
      // to the card's corner; at desktop widths its buttons follow the action
      // row — so what is seen and what Tab reaches stay in the same order.
      html += `<div class="class-card ct-card${cardCls} my-booking-card" data-id="${evtId}" data-ct="${ctKey}" data-studio-id="${evt.studio_id}"
        onclick="openClassDetail(${evtId})" style="cursor:pointer">
        ${whenHtml}
        <div class="class-info mb-what">
          <div class="cc-head mb-title">${tileHtml}<span class="cc-name mb-name" role="button" tabindex="0">${escapeHTML(typeName)}</span></div>
          <div class="class-instructor cc-sub mb-meta">${instrHtml ? `<span class="cc-who">${instrHtml}</span>` : ''}${whereHtml ? `<span class="cc-loc class-location">${whereHtml}</span>` : ''}</div>
          ${(seatHtml || badges) ? `<div class="class-meta mb-badges">${seatHtml}${badges}</div>` : ''}
        </div>
        ${placeHtml ? `<div class="mb-status">${placeHtml}</div>` : ''}
        ${actionsHtml}
        ${moreHtml}
      </div>`;
    }
    html += `</div></div>`;
  }

  // Close the last period section if we opened one
  if (hasPeriodSplit && _activeSubscription) {
    html += `</div></div>`; // close mb-period-body + mb-period-section
  }

  // Calendar sync actions (only when real seats exist — places aren't exported)
  if (upcomingSeats > 0 && typeof renderCalendarActions === 'function') {
    html += renderCalendarActions();
  }

  // What the waitlist cards show as of THIS paint — the re-check ticker's
  // baseline. Stamped here because every painter ends up here: the fetch's own
  // offer probe and a "spot gone" claim repaint after bookings:loaded stamped
  // it, and the ticker then diffed against a card that was no longer on screen
  // (a freed spot never painted; a taken one kept reading "Claim spot").
  if (typeof _placesShownSig === 'function') _waitlistShownSig = _placesShownSig(_myBookings);
  // Usually this is the list that is already up (a foreground refetch, /profile
  // landing, the refetch after a cancel): _commitBookingsHtml then leaves the
  // DOM alone. (typeof: the suites run this function on its own, as above.)
  if (typeof _commitBookingsHtml === 'function') _commitBookingsHtml(list, html, now.getTime());
  else list.innerHTML = html;
}

// ── pure:render-perf:start ── (no document / app state; tests/suites/render-perf.js evaluates this block)
// renderMyBookings runs twice per foreground (/bookings, then /profile) and
// three times per cancel, nearly always building the HTML that is already up.
// Writing it anyway replayed every card's entrance and threw away whatever the
// member had going inside the list: the Similar popup, a collapsed period, the
// "…" of a cancel in flight, the second tap on a seat ×.

// The list minus the one thing the minute tick rewrites in place: two builds
// that differ only in a countdown chip's text are the same list.
function _bookingsHtmlKey(html) {
  return String(html).replace(/(<span\b[^>]*\bclass="mb-countdown"[^>]*>)[^<]*/g, '$1');
}

// What the chip of a class starting at `startAt` (the API's raw string, kept in
// data-start) reads at `nowMs` — built the way the card builds it.
function _countdownChipText(startAt, nowMs) {
  let dt = new Date(startAt);
  if (isNaN(dt.getTime())) dt = new Date(String(startAt).replace(' ', 'T'));
  if (isNaN(dt.getTime())) return null;
  return getCountdownText(dt, new Date(nowMs), startAt);
}

// null = started (or no longer today / tomorrow): that card is about to change
// altogether, which is the flip re-render's job, not a text swap.
function _tickCountdownChips(root, nowMs) {
  root.querySelectorAll('.mb-countdown[data-start]').forEach(chip => {
    const text = _countdownChipText(chip.getAttribute('data-start'), nowMs);
    if (text && chip.textContent !== text) chip.textContent = text;
  });
}

// Is this button waiting on Psycle? data-busy, or disabled the way a flow IN
// FLIGHT leaves it: "…" (_busyLabel), untouched (the seat × only dims its
// chip), or not ours to judge. Disabled under a label of its own is the END of
// a flow, not the middle: reliability.js parks "+ Add spot" on "Queued" when
// the signal drops mid-picker and never re-enables it (it counts on the next
// render). Read as busy, the list skip kept it dead — and the minute tick's
// flip re-render and the waitlist re-check off — for as long as the tab stayed open.
function _mbInFlight(b) {
  if (b.dataset && b.dataset.busy === '1') return true;
  if (!b.disabled) return false;
  return b._mbLabel == null || b.textContent === '…' || (b.textContent === b._mbLabel && b.className === b._mbClass);
}

// A list that stays up keeps its buttons as they are. That is only right while
// each one we rendered is untouched, or busy (disabled / data-busy: a cancel, a
// claim, a booking in flight — the very thing not to rebuild under). An IDLE
// one that reads differently was left that way by a flow that has ended: "+ Add
// spot" says "Book" once bookClass has opened the picker, submitBooking leaves
// "Failed — retry" and a book-btn class, applyBookedState even swaps the
// onclick. Only a rebuild puts all of that back, as it always did. Busy for
// over two minutes is a flow that died (no request outlives 4 × 15s): rebuild
// then too, rather than strand a dead button.
function _bookingButtonsIntact(list, nowMs) {
  let intact = true;
  list.querySelectorAll('button').forEach(b => {
    if (b._mbLabel == null) return; // not ours (the Similar popup's options)
    const busy = _mbInFlight(b);
    if (!busy) {
      b._mbBusyAt = 0;
      if (b.textContent !== b._mbLabel || b.className !== b._mbClass) intact = false;
    } else if (!b._mbBusyAt) {
      b._mbBusyAt = nowMs;
    } else if (nowMs - b._mbBusyAt > 120000) {
      intact = false;
    }
  });
  return intact;
}

// renderMyBookings' last step: put `html` on screen unless it is there already.
// What is "there" is remembered on the node, not in a variable: _mbFirst is the
// first child WE left, so the skeleton, the saved copy and the empty branch —
// which write the node directly — invalidate it just by running. Returns true
// when the DOM was written.
function _commitBookingsHtml(list, html, nowMs) {
  const key = _bookingsHtmlKey(html);
  const ours = !!list._mbFirst && list.firstChild === list._mbFirst; // our cards are still up
  list._mbAt = nowMs; // what the list shows is right as of now, written or not
  if (ours && key === list._mbKey && _bookingButtonsIntact(list, nowMs)) {
    _tickCountdownChips(list, nowMs);
    return false;
  }
  // Cards replacing cards in front of the member: no entrance (css/tabs.css
  // reads data-quiet, as for #results). Skeleton / saved copy / empty → cards
  // keeps it, and so does a rebuild in a hidden tab — nothing blinks there, and
  // the cascade on the way back to the tab is the designed one.
  list.toggleAttribute('data-quiet', ours && list.offsetParent != null);
  // A billing period the member folded away stays folded (there are 0 or 2).
  const folded = ours ? Array.from(list.querySelectorAll('.mb-period-section'), s => s.classList.contains('collapsed')) : [];
  list.innerHTML = html;
  list._mbKey = key;
  list._mbFirst = list.firstChild;
  if (folded.some(Boolean)) {
    list.querySelectorAll('.mb-period-section').forEach((s, i) => {
      if (!folded[i]) return;
      s.classList.add('collapsed');
      // The fresh bar says aria-expanded="true": keep it with the class, or
      // VoiceOver announces "expanded" over a section whose cards are hidden.
      const bar = s.querySelector('.mb-period-bar');
      if (bar) bar.setAttribute('aria-expanded', 'false');
    });
  }
  list.querySelectorAll('button').forEach(b => { b._mbLabel = b.textContent; b._mbClass = b.className; });
  return true;
}

// True when one of `times` (ms; NaN / null are skipped) fell in (sinceMs, nowMs].
function _anyInstantBetween(times, sinceMs, nowMs) {
  return times.some(ms => typeof ms === 'number' && ms > sinceMs && ms <= nowMs);
}
// ── pure:render-perf:end ──

// ── The minute tick ──────────────────────────────────────────────
// Nothing on the page followed the clock except the floating pill (settings.js,
// its own 30s timer). With My Bookings left open the card said "In 1h 10m"
// under a pill reading "40m", "Free cancel until 06:30" outlived 06:30, a class
// that had started kept its Cancel button, and Discover read "Updated just now"
// for as long as it stayed open. ONE timer: stopped while the page is hidden
// (the foreground refetch covers the way back), caught up at once on return.
// It rewrites text in place; the list is only rebuilt when a card really
// changes state, and never under the member's hands.
let _minuteTimer = null;

// Has a card changed by itself since the list was last known right? A class
// started (by the card's own device-local test, or the real London start the
// chip counts to), its free-cancel cutoff passed, a waitlist offer ran out — or
// the day turned, which puts "Tomorrow 07:00" on a card that had no chip.
function _bookingsFlipDue(sinceMs, nowMs) {
  if (localDateStr(new Date(sinceMs)) !== localDateStr(new Date(nowMs))) return true;
  try { if (_gymDayKey(sinceMs, 0) !== _gymDayKey(nowMs, 0)) return true; } catch (e) { /* no Europe/London data */ }
  return Object.keys(_myBookings).some(id => {
    const evt = _eventCache[id];
    if (!evt || !evt.start_at) return false;
    const dl = _cancelDeadline(evt.start_at, nowMs);
    const place = _myBookings[id] && _myBookings[id].waitlist;
    return _anyInstantBetween([
      new Date(evt.start_at).getTime(),
      dl ? dl.deadlineMs : NaN,
      dl ? dl.deadlineMs + 12 * 3600000 : NaN,
      place && place.expiresAt ? _waitlistTimeMs(place.expiresAt) : NaN,
    ], sinceMs, nowMs);
  });
}

// A timed rebuild must not land under the member's hands: a dialog or the bike
// picker, the Similar popup (it lives inside a card), a card mid-swipe, a
// button waiting on Psycle. The next tick tries again.
function _bookingsListBusy(list) {
  if (_dialogOpen()) return true;
  if (list.querySelector('.find-similar-popup')) return true;
  if (list.querySelector('.mb-more-btn[aria-expanded="true"]')) return true; // an open More menu, likewise
  if (Array.from(list.querySelectorAll('.my-booking-card')).some(c => c.style.transform)) return true;
  return Array.from(list.querySelectorAll('button')).some(_mbInFlight);
}

// "Updated 3m ago": only the words. The Refresh button beside them (focus, a
// "Refreshing…" in flight) is renderLastUpdated's and is not rebuilt.
function _tickLastUpdated() {
  const el = document.getElementById('lastUpdated');
  if (!el || !window._windowFetchedAt || !el.firstChild || el.firstChild.nodeType !== 3) return;
  const text = 'Updated ' + _relativeTime(window._windowFetchedAt) + ' · ';
  if (el.firstChild.nodeValue !== text) el.firstChild.nodeValue = text;
}

function _minuteTick() {
  if (document.hidden) return;
  const nowMs = Date.now();
  _tickLastUpdated();
  const list = document.getElementById('upcomingList');
  // Only over cards renderMyBookings put there — never the skeleton, the saved
  // copy or the empty list (their own paths repaint them).
  if (!list || !list._mbFirst || list.firstChild !== list._mbFirst) return;
  if (_bookingsFlipDue(list._mbAt, nowMs) && !_bookingsListBusy(list)) renderMyBookings();
  else _tickCountdownChips(list, nowMs);
}

function _armMinuteTick() {
  clearInterval(_minuteTimer);
  _minuteTimer = null;
  if (document.hidden) return;
  _minuteTick();
  _minuteTimer = setInterval(_minuteTick, 60000);
}
document.addEventListener('visibilitychange', _armMinuteTick);
_armMinuteTick();

// A seat cancelled inside the bike picker changes these cards too, and the
// picker (reachable from here through the class sheet or "+ Add spot") only
// resyncs the Discover buttons — without this the card kept the dead seat.
if (typeof PsycleEvents !== 'undefined') {
  try { PsycleEvents.on('seat:cancelled', () => { try { refreshUpcomingPanel(); } catch {} }); } catch {}
}

// ── My Bookings: the card's "More" menu ──────────────────────────
// Add spot · Find similar · Map · Share sit behind one button on a phone
// (renderMyBookings builds both; css/crisp.css shows the same buttons inline at
// desktop widths, where the More button is not displayed and none of this
// runs). A disclosure: the button carries aria-expanded / aria-controls, and
// the stylesheet shows the menu off that attribute — so opening one touches no
// class and no label, and _commitBookingsHtml's "is every button as we left
// it?" check still holds. Focus moves in on open; Escape hands it back; the
// arrow keys step through the items; a tap outside, or focus leaving, closes.
// ONE set of document listeners — the cards are rebuilt as HTML, so nothing can
// be bound to them. While a menu is open the timed repaints stand aside
// (_bookingsListBusy, _bookingsRepaintSafe).
let _mbMoreOpen = null; // { btn, menu, card }

function _mbMoreItems(menu) {
  return Array.from(menu.querySelectorAll('button')).filter(b => !b.disabled);
}

function closeBookingMore(focusBack) {
  const st = _mbMoreOpen;
  _mbMoreOpen = null;
  if (!st) return;
  st.btn.setAttribute('aria-expanded', 'false');
  if (st.card) st.card.removeAttribute('data-more-open');
  // preventScroll: closing a menu must not move the list.
  if (focusBack && st.btn.isConnected) { try { st.btn.focus({ preventScroll: true }); } catch (e) {} }
}

function toggleBookingMore(btn) {
  const menu = btn ? document.getElementById(btn.getAttribute('aria-controls')) : null;
  if (!menu) return;
  const wasOpen = !!_mbMoreOpen && _mbMoreOpen.btn === btn;
  closeBookingMore(false); // one at a time
  if (wasOpen) return;
  const card = btn.closest('.my-booking-card');
  btn.setAttribute('aria-expanded', 'true');
  // The open card rides over its neighbours: each card is a stacking context
  // of its own (entrance animation), and the next one would paint over the menu.
  if (card) card.setAttribute('data-more-open', '');
  _mbMoreOpen = { btn, menu, card };
  const first = _mbMoreItems(menu)[0];
  if (first) { try { first.focus({ preventScroll: true }); } catch (e) {} }
}
window.toggleBookingMore = toggleBookingMore;
window.closeBookingMore = closeBookingMore;

// A rebuild can take the open menu's nodes away: that is a closed menu.
function _mbMoreState() {
  if (_mbMoreOpen && !_mbMoreOpen.btn.isConnected) _mbMoreOpen = null;
  return _mbMoreOpen;
}

// Capture phase, like the Similar popup's own dismissal: ahead of every inline
// onclick. Choosing an item closes the menu BEFORE the item's handler runs, so
// focus is back on the More button by the time Find similar opens its popup.
// "Add spot" keeps it open (data-more-keep): bookClass shows its "…" on that
// button, and the picker or confirm it opens takes focus — which closes this.
document.addEventListener('click', e => {
  const st = _mbMoreState();
  if (!st) return;
  const t = e.target;
  if (!t || typeof t.closest !== 'function') return;
  if (st.btn.contains(t)) return; // its own toggle
  if (st.menu.contains(t)) {
    const item = t.closest('button');
    if (item && !item.hasAttribute('data-more-keep')) closeBookingMore(true);
    return;
  }
  closeBookingMore(false);
  // The list under the menu is all tap targets: the tap that closes it does
  // nothing else there. Another card's More button goes through in one tap.
  if (t.closest('.my-booking-card') && !t.closest('.mb-more-btn')) {
    e.stopPropagation();
    e.preventDefault();
  }
}, true);

document.addEventListener('keydown', e => {
  const st = _mbMoreState();
  if (!st) return;
  // Focus is somewhere else (a dialog opened over the list): the key is theirs.
  const active = document.activeElement;
  if (active && active !== document.body && !st.menu.contains(active) && active !== st.btn) { closeBookingMore(false); return; }
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeBookingMore(true);
    return;
  }
  const items = _mbMoreItems(st.menu);
  const next = _mbMoreKeyStep(e.key, items.indexOf(active), items.length);
  if (next == null) return;
  e.preventDefault();
  try { items[next].focus({ preventScroll: true }); } catch (err) {}
}, true);

// Tabbing out of the menu, or a dialog taking focus, closes it.
document.addEventListener('focusin', e => {
  const st = _mbMoreState();
  if (!st || st.menu.contains(e.target) || e.target === st.btn) return;
  closeBookingMore(false);
});

// ── Open a booking's studio in the maps app ──────────────────────
window.openMapForBooking = function (eventId) {
  const evt = _eventCache[String(eventId)];
  if (!evt) { toast('Location not available', 'error'); return; }
  const query = [evt._locFullName || evt._locName, evt._locAddress].filter(Boolean).join(', ');
  if (!query) { toast('No address on file for this studio', 'error'); return; }
  const q = encodeURIComponent(query);
  // maps.apple.com opens the native Maps app on iOS/macOS; Google Maps elsewhere
  const isApple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
  const url = isApple
    ? 'https://maps.apple.com/?q=' + q
    : 'https://www.google.com/maps/search/?api=1&query=' + q;
  window.open(url, '_blank', 'noopener');
};

// ── pure:bookings-card:start ──
// _eventCache entry for one /events row, carrying the display names render()
// derives from the response's relations. Merged over `existing` so richer
// fields written by detail fetches survive, and a relation the response
// happens to omit never blanks a name we already had.
function _eventCacheEntry(e, relations, existing) {
  const rel = relations || {};
  const prev = existing || {};
  const pick = (list, id) => (list || []).find(x => String(x.id) === String(id)) || null;
  const type = pick(rel.event_types, e.event_type_id);
  const instr = pick(rel.instructors, e.instructor_id);
  const studio = pick(rel.studios, e.studio_id);
  const loc = studio ? pick(rel.locations, studio.location_id) : null;
  return {
    ...prev,
    ...e,
    _typeName: type?.name || prev._typeName || 'Class',
    _instrName: instr?.full_name || prev._instrName || '',
    _locName: loc ? loc.name.replace('Psycle ', '') : (prev._locName || ''),
    _locFullName: loc ? loc.name : (prev._locFullName || ''),
    _locAddress: loc ? (loc.address || '') : (prev._locAddress || ''),
    _studioName: studio ? studio.name : (prev._studioName || ''),
  };
}
// ── pure:bookings-card:end ──

async function rebookNextWeek(eventId) {
  const evt = _eventCache[String(eventId)];
  if (!evt) { toast('Event data not available', 'error'); return; }

  // Calculate same time one week later
  const origDate = new Date(evt.start_at);
  const nextWeek = new Date(origDate);
  nextWeek.setDate(nextWeek.getDate() + 7);
  const dayStr = localDateStr(nextWeek);

  // Check if user already has a booking for the same class next week
  const origMinutesCheck = origDate.getHours() * 60 + origDate.getMinutes();
  const heldNextWeek = Object.keys(_myBookings).filter(bookedId => {
    const bookedEvt = _eventCache[bookedId];
    if (!bookedEvt) return false;
    const bookedDate = new Date(bookedEvt.start_at);
    // Same day-of-week, same instructor, same event type
    if (bookedEvt.instructor_id !== evt.instructor_id) return false;
    if (bookedEvt.event_type_id !== evt.event_type_id) return false;
    // Must be on the target next-week date
    if (localDateStr(bookedDate) !== dayStr) return false;
    // Similar time (within 30 minutes)
    const bookedMinutes = bookedDate.getHours() * 60 + bookedDate.getMinutes();
    if (Math.abs(bookedMinutes - origMinutesCheck) >= 30) return false;
    return true;
  });
  if (heldNextWeek.length) {
    // Only a real seat is "booked": a waitlist place is no seat yet, and being
    // told otherwise stops the member looking for a fallback. Stop either way —
    // carrying on would walk bookClass into its "Leave the waitlist?" branch.
    const seatHeld = heldNextWeek.some(id => !_myBookings[id].waitlisted);
    toast(seatHeld ? 'Already booked for next week' : "You're on the waitlist for next week's class — it isn't booked yet", 'info');
    return;
  }

  toast('Searching for next week...', 'info');

  // Search for events on that day at the same location
  const studio = _studioMap[evt.studio_id];
  const locationId = studio ? studio.location_id : '';

  const params = new URLSearchParams({
    start: dayStr + ' 00:00:00',
    end: dayStr + ' 23:59:59',
    location: locationId,
    limit: 200
  });

  // A dropped connection used to end here as an unhandled rejection, with
  // "Searching for next week..." the last thing the member was told.
  let res;
  try {
    res = await apiFetch('/events?' + params);
  } catch (e) {
    toast(_friendlyError(e, "Couldn't search next week's classes — try again"), 'error');
    return;
  }
  if (!res.ok) { toast('Search failed', 'error'); return; }
  const data = await res.json();
  const events = data.data || [];

  // Find exact match: same event_type_id, same instructor_id, similar time (within 30min)
  const origMinutes = origDate.getHours() * 60 + origDate.getMinutes();
  const exact = events.find(e =>
    e.event_type_id === evt.event_type_id &&
    e.instructor_id === evt.instructor_id &&
    Math.abs((new Date(e.start_at).getHours() * 60 + new Date(e.start_at).getMinutes()) - origMinutes) < 30
  );

  if (exact) {
    // Next week's class is usually outside the loaded search window. Without
    // its studio and cache entry the picker opens with no header, the
    // confirmation reads a bare "Class" and renderMyBookings skips the new
    // booking until the next refetch — so seed both before booking.
    (data.relations?.studios || []).forEach(s => { _studioMap[s.id] = s; });
    _eventCache[String(exact.id)] = _eventCacheEntry(exact, data.relations, _eventCache[String(exact.id)]);

    // Found exact match — go straight to booking
    const btn = document.createElement('button');
    btn.className = 'book-btn';
    btn.textContent = 'Book';
    document.body.appendChild(btn);
    await bookClass(exact.id, btn, exact.studio_id);
    btn.remove();
    return;
  }

  // No exact match — find same type at similar time
  const similar = events.filter(e =>
    e.event_type_id === evt.event_type_id &&
    Math.abs((new Date(e.start_at).getHours() * 60 + new Date(e.start_at).getMinutes()) - origMinutes) < 120
  );

  if (similar.length > 0) {
    // Show alternatives: that one day, on Discover. The member is on My
    // Bookings, so without the tab switch the search fills a hidden panel and
    // the toast points at nothing. The alternatives are by definition other
    // instructors at this class's location — a filter left on either would
    // hide them again.
    selectedInstructors.clear();
    if (selectedLocations.size && locationId) selectedLocations.add(String(locationId));
    // They are also all this class's TYPE: a class-type filter that lacks its
    // category ("Strength" on, rebooking a Ride), or a sub-type narrowed to
    // another variant, drops every one of them in render(). The name comes
    // from the response render() will read too — the cached one can be the
    // 'Class' placeholder, which says nothing about the category.
    const typeName = (data.relations?.event_types || []).find(t => String(t.id) === String(evt.event_type_id))?.name
      || (evt._typeName !== 'Class' ? evt._typeName : '');
    if (selectedCategories.size && typeName) selectedCategories.add(getCategory(typeName).key);
    selectedStrengthSubs.clear();
    ['UPPER', 'LOWER', 'FULL'].forEach(k => selectedStrengthSubs.add(k));
    selectedReformerSubs.clear();
    REFORMER_SUBS.forEach(s => selectedReformerSubs.add(s.key));
    // And the Time row: "After 17:00" left on hides every alternative to a 7am
    // class. Each alternative's OWN band — the ±2h window straddles them (a
    // 07:00 class has 09:00 alternatives), so the target hour is not enough.
    if (typeof _admitTimeBands === 'function') _admitTimeBands(similar.map(e => e.start_at));
    _dateQuickMode = null;
    document.getElementById('startDate').value = dayStr;
    document.getElementById('daysAhead').value = 1;
    if (typeof _syncFilterUI === 'function') _syncFilterUI();
    if (typeof switchTab === 'function') switchTab('discover');
    search();
    // 'Wed 30 Sept', as the date pill now reads — not the raw '2026-09-30'.
    toast('No exact match — showing alternatives for ' +
      nextWeek.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }), 'info');
  } else {
    toast('No matching class found next week at this location', 'info');
  }
}

// ── Change Spot ─────────────────────────────────────────────────
// Opens bike picker. When user selects a new spot, cancels old + books new.
window.changeSpot = async function(eventId) {
  // Read before the first wait: what the member tapped SINCE wins (below).
  const seqAtTap = (typeof bookClass === 'function' && bookClass._seq) || 0;
  // Painted from saved details: the studio — and so the seat map — isn't known
  // until this class has been re-read (see _ensureStudioKnown). Never the
  // "No layout available" error below for that, and never the saved studio's
  // map. (typeof: the suites run changeSpot on its own.)
  if (typeof _ensureStudioKnown === 'function' && getBearerToken() && _studioNeedsReread(eventId)) {
    toast('Loading class…', 'info');
    if (!(await _ensureStudioKnown(eventId))) {
      // (No token left = the session ended meanwhile, and said so itself.)
      if (getBearerToken()) toast("Couldn't load this class — nothing was changed. Try again in a moment.", 'error');
      return;
    }
  }
  // A fresh multi-seat booking maps every seat to the single returned booking
  // id until fetchMyBookings corrects it — swapping off that stale map would
  // cancel the wrong seat. Refresh ONLY when the local record looks
  // suspicious (a seat whose OWN record id isn't known — see _seatCancelId);
  // bounded, and retried once if a concurrent fetch superseded ours.
  const _mapLooksStale = (b) => !b || (b.slots || []).some(s => !_seatCancelId(b, s));
  if (_mapLooksStale(_myBookings[String(eventId)])) await _rereadBookingsForVerify();
  const booking = _myBookings[String(eventId)];
  const evt = _eventCache[String(eventId)];
  if (!booking || !evt) return;

  // Same cutoff as the card that offered "Change spot" — a second clock here
  // could refuse a swap the card still advertises as free.
  const deadline = _cancelDeadline(evt.start_at);
  if (deadline && deadline.insideWindow) {
    toast('Cannot change spot within 12 hours of class (incurs a fee)', 'error');
    return;
  }

  // The refresh didn't land: there is no "fall back to local state" for a
  // swap — its first step is a DELETE, and the entry id (or an event-wide
  // DELETE) can release a seat the member meant to keep.
  const slotToChange = (booking.slots || []).find(s => _seatCancelId(booking, s));
  if (slotToChange == null) {
    toast("Couldn't load this booking's spots from Psycle — nothing was changed. Try again in a moment.", 'error');
    return;
  }

  // Fetch fresh event detail to get availability
  try {
    toast('Loading available spots...', 'info');
    const res = await apiFetch('/events/' + eventId);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const detail = await res.json();
    const availableSlotIds = new Set((detail.slots || []).map(Number));

    if (availableSlotIds.size === 0) {
      toast('No other spots available — class is full', 'error');
      return;
    }

    const studio = _studioMap[evt.studio_id];
    let layout = studio?.layout;
    // Same recovery as bookClass: render() can swap the studio record for one
    // without its seat map — take it from the detail just read, and keep it.
    // (typeof: the suites run changeSpot on its own.)
    if (studio?.has_layout && !(layout?.slots?.length > 0) && typeof _layoutFromEventDetail === 'function') {
      layout = _layoutFromEventDetail(detail, evt.studio_id);
      if (layout) studio.layout = layout;
    }
    if (!studio?.has_layout || !layout?.slots?.length) {
      toast('No layout available for this studio', 'error');
      return;
    }

    // Another class was tapped while this loaded (up to 10s, with the re-read
    // above), or its picker is already up: opening now would replace that
    // picker's class and re-wire its Confirm to a swap. Theirs, quietly.
    if (typeof _pickerTakenSince === 'function' && _pickerTakenSince(seqAtTap)) return;

    // Default to the first booked slot (whose own record is known — above). If
    // the user has multiple, the modalHint renders chips so they can pick
    // which one to swap without leaving the map view.
    window._changeSpotContext = {
      eventId: eventId,
      slotToChange: slotToChange,
      bookingId: _seatCancelId(booking, slotToChange),
      booking: booking,
    };

    // Open the bike picker — user's existing slots shown as "mine"
    const mySlots = new Set(booking.slots.map(Number));
    const studioName = (evt._locName || '') + (evt._studioName ? ' · ' + evt._studioName : '');
    showBikePicker(eventId, null, layout, availableSlotIds, mySlots, studioName);

    // Override the confirm button to do swap instead of new booking
    const confirmBtn = document.getElementById('confirmBookBtn');
    if (confirmBtn) {
      const label = slotLabelForEvent(eventId);
      document.getElementById('modalTitle').textContent = 'Change your ' + label.toLowerCase();
      renderChangeSpotHint();
      confirmBtn.textContent = 'Swap ' + label.toLowerCase();
      confirmBtn.onclick = function () { executeSpotSwap(); };
    }
  } catch (e) {
    toast(_friendlyError(e, "Couldn't load the available spots — try again"), 'error');
  }
};

/** Render (or re-render) the modalHint for a Change-spot flow. Shows chips
 *  when the booking has multiple slots so the user can switch which one
 *  they're swapping without leaving the bike picker. */
function renderChangeSpotHint() {
  const ctx = window._changeSpotContext;
  if (!ctx) return;
  const hint = document.getElementById('modalHint');
  if (!hint) return;
  const label = slotLabelForEvent(ctx.eventId);
  const low = label.toLowerCase();
  const picked = _selectedSlots.length ? _selectedSlots[0] : null;
  const tail = picked != null
    ? ' &rarr; ' + label + ' ' + picked + '. Tap Swap to confirm.'
    : ' — now pick a new ' + low + ' on the layout.';
  if (ctx.booking.slots.length > 1) {
    const chips = ctx.booking.slots.map(function (s) {
      const cls = 'change-chip' + (s === ctx.slotToChange ? ' is-active' : '');
      // Which seat is being swapped was a colour only; the hint re-renders on
      // every retarget, so the pressed state here can't go stale.
      return '<button type="button" class="' + cls + '" aria-pressed="' + (s === ctx.slotToChange) + '" onclick="setChangeSpotTarget(' + s + ')">' +
        label + ' ' + s + '</button>';
    }).join('');
    // Inside the picker's focus trap a lost focus is worse: the next Tab jumps
    // to the × and the member walks every seat again to get back here.
    _repaintKeepingFocus(hint, 'Changing: <span class="change-chip-row">' + chips + '</span>' + tail, '.change-chip');
  } else if (picked != null) {
    hint.textContent = label + ' ' + ctx.slotToChange + ' → ' + label + ' ' + picked + '. Tap Swap to confirm.';
  } else {
    hint.textContent = 'Select a new ' + low + ' to replace ' + label + ' ' + ctx.slotToChange;
  }
}

window.setChangeSpotTarget = function (slot) {
  const ctx = window._changeSpotContext;
  if (!ctx) return;
  slot = Number(slot);
  if (!ctx.booking.slots.includes(slot)) return;
  // Only a seat whose OWN record is known can be the one released — the entry
  // id may be the other seat's. Otherwise the target stays where it was.
  const ownId = _seatCancelId(ctx.booking, slot);
  if (!ownId) {
    toast(`Couldn't match ${slotLabelForEvent(ctx.eventId)} ${slot} to a booking — close this and try again in a moment`, 'error');
    return;
  }
  ctx.slotToChange = slot;
  ctx.bookingId = ownId;
  renderChangeSpotHint();
};

// Keep the "usual spot" memory honest after a swap: the seat the user moved
// away from loses a count, the seat they chose gains one.
function _adjustBikeHistoryForSwap(eventId, oldSlot, newSlot) {
  const evt = _eventCache[String(eventId)];
  if (!evt || evt.studio_id == null || evt.instructor_id == null) return;
  const hist = _getBikeHistory();
  const counts = hist[String(evt.studio_id)]?.[String(evt.instructor_id)];
  if (counts) {
    const oldKey = String(Number(oldSlot));
    if (counts[oldKey]) {
      counts[oldKey] -= 1;
      if (counts[oldKey] <= 0) delete counts[oldKey];
    }
    try { localStorage.setItem(BIKE_HISTORY_KEY, JSON.stringify(hist)); } catch (e) {}
  }
  _recordBikeHistory(eventId, [Number(newSlot)]);
}

let _swapInFlight = false;
async function executeSpotSwap() {
  const ctx = window._changeSpotContext;
  if (!ctx || _selectedSlots.length === 0 || _swapInFlight) return;

  const newSlot = _selectedSlots[0];
  const label = slotLabelForEvent(ctx.eventId);
  const low = label.toLowerCase();
  const confirmBtn = document.getElementById('confirmBookBtn');
  _swapInFlight = true;
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Swapping...'; }

  // On failure the context is KEPT and the button restored, so the user can
  // simply tap Swap again — never a dead "Swapping..." button.
  const failRetryable = (msg) => {
    toast(msg, 'error');
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Swap ' + low; }
  };

  try {
    const key = String(ctx.eventId);
    // Can't tell which seat (if any) is held now — no blind retry from here.
    const closeUnconfirmed = (why) => {
      toast('Swap failed: ' + why + " — couldn't confirm which " + low + ' you hold now. Check My Bookings.', 'error');
      closeBikePicker();
      _scheduleBookingsRefetch(3000);
    };

    // Step 1: cancel the old seat (skipped if a previous attempt already did).
    if (!ctx.cancelDone) {
      // Only ever the seat's own record — never an event-wide DELETE, which
      // would release every seat held in this class to move one of them.
      if (!ctx.bookingId) {
        failRetryable("Swap failed: couldn't match your current " + low + ' to a booking — nothing was changed. Close this and try again.');
        return;
      }
      let cancelRes;
      try {
        cancelRes = await apiFetch('/bookings/' + ctx.bookingId, { method: 'DELETE' });
      } catch (e) {
        // Nothing cancelled yet — fully safe to retry. A short phrase, not the
        // raw "Load failed" (a full sentence would not read after "Swap failed:").
        failRetryable('Swap failed: no answer from Psycle. Tap Swap to try again.');
        return;
      }
      if (!cancelRes.ok && cancelRes.status !== 204 && cancelRes.status !== 404) {
        const cErr = await cancelRes.json().catch(() => ({}));
        failRetryable('Swap failed: ' + (cErr.message || 'could not release your current ' + low));
        return;
      }
      // 404 = that record is already gone. Either an earlier attempt's DELETE
      // landed without us hearing — or the entry is stale and the seat has
      // already moved (a swap whose refetch never landed, another device), so
      // the POST below would ADD a seat. Only /bookings can say which: carry on
      // only when it holds exactly the seats this swap expects to be left.
      if (cancelRes.status === 404) {
        const applied = await _rereadBookingsForVerify();
        if (!applied) { closeUnconfirmed('that ' + low + "'s booking is no longer there"); return; }
        const fresh = _isRealSeat(_myBookings[key]) ? (_myBookings[key].slots || []).map(Number) : [];
        const expected = (ctx.booking.slots || []).map(Number).filter(s => s !== Number(ctx.slotToChange));
        if (fresh.length !== expected.length || !expected.every(s => fresh.includes(s))) {
          toast('This booking changed since you opened it — nothing more was changed. Check My Bookings and try again.', 'error');
          closeBikePicker();
          return;
        }
      }
      ctx.cancelDone = true;
    }

    // Book a seat in this event. retries:0 — a timed-out POST may have booked
    // server-side, and an auto-retry could double-book.
    const postSeat = (slot) => apiFetch('/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ event_id: Number(ctx.eventId), slots: [Number(slot)] }),
      retries: 0,
    });

    // Step 2: book the new seat.
    let bookRes = null, bookErr = null;
    try { bookRes = await postSeat(newSlot); } catch (e) { bookErr = e; }

    const announceSwap = () => {
      toast(label + ' changed: ' + ctx.slotToChange + ' → ' + newSlot, 'success');
      _adjustBikeHistoryForSwap(ctx.eventId, ctx.slotToChange, newSlot);
      closeBikePicker(); // resets the confirm button and clears the swap context
      refreshUpcomingPanel();
      PsycleEvents.emit('booking:complete', ctx.eventId, [newSlot]);
    };
    const holds = (entry, slot) => _isRealSeat(entry) && (entry.slots || []).map(Number).includes(Number(slot));

    if (bookRes && (bookRes.ok || bookRes.status === 201)) {
      // Record the move locally: /bookings is only re-read afterwards, and that
      // read can fail or land late. Left on the old seat and its deleted record,
      // a second Change spot 404s that DELETE ("already gone") and books an
      // EXTRA seat, and Cancel reports a booking cancelled that is still held.
      const data = await bookRes.json().catch(() => ({}));
      const live = _myBookings[key];
      const moved = _mergeBookedSeats(_withoutSeat(live, ctx.slotToChange, ctx.bookingId), [newSlot], data?.data?.id || data?.id);
      if (live && live.fromWaitlist) moved.fromWaitlist = true;
      if (live && live.waitlist) moved.waitlist = live.waitlist;
      _myBookings[key] = moved;
      _noteLocalBookingWrite();
      announceSwap();
      _scheduleBookingsRefetch(); // swap the provisional entry for the server's
      return;
    }

    const bErr = bookRes ? await bookRes.json().catch(() => ({})) : {};
    // A thrown POST is a dropped connection or a timeout: said as that, never
    // as the raw "Load failed" / "Request timed out" inside "Swap failed: …".
    const reason = bookErr ? 'no answer from Psycle' : (bErr.message || 'could not book ' + low + ' ' + newSlot);

    // No answer, or a 5xx: the new seat MAY have booked server-side (as in
    // submitBooking). Winning the old seat back on top of that leaves BOTH held
    // — and charged — under a "Swap failed", and every retry loops the same
    // way. Ask /bookings before sending anything else; a 4xx is a refusal and
    // goes straight to the recovery below.
    if (bookErr || bookRes.status >= 500) {
      if (!(await _rereadBookingsForVerify())) { closeUnconfirmed(reason); return; }
      if (holds(_myBookings[key], newSlot)) { announceSwap(); return; }
    }

    // Booking the new seat failed — try to win the original seat back, then
    // let the SERVER say whether we actually hold it (a 409 on the recovery
    // POST is ambiguous: "you already have it" vs "someone else took it").
    try { await postSeat(ctx.slotToChange); } catch (e) { /* judged by the refetch below */ }

    // Only an APPLIED re-read says what is held now. The stale entry still
    // lists the old seat under its old, deleted record: a retried swap would
    // 404 that DELETE ("already gone") and then book a SECOND seat.
    let recovered = false, known = false, held = false, gotNew = false;
    try {
      known = await _rereadBookingsForVerify();
      const after = known ? _myBookings[key] : null;
      held = holds(after, ctx.slotToChange);
      gotNew = holds(after, newSlot); // the "failed" POST landed after all
      const backId = held ? _seatCancelId(after, ctx.slotToChange) : null;
      recovered = !!backId;
      if (held && !backId) known = false; // held, but not under a record we can name
      if (recovered) {
        // Retarget the context at the CURRENT booking record for that seat so
        // a retried swap cancels the right one.
        ctx.booking = after;
        ctx.bookingId = backId;
        ctx.cancelDone = false;
      }
    } catch (e) { known = false; }

    if (gotNew && !held) {
      announceSwap();
    } else if (gotNew) {
      // Both seats are held now — a retry would release one and hit a 409 on
      // the other, for ever. The member picks which to keep.
      toast('Swap went wrong: you now hold both ' + label + ' ' + ctx.slotToChange + ' and ' + label + ' ' + newSlot +
        " — cancel the one you don't want in My Bookings.", 'error');
      closeBikePicker();
    } else if (recovered) {
      failRetryable('Swap failed: ' + reason + ' — kept ' + label + ' ' + ctx.slotToChange + '. Tap Swap to retry.');
    } else if (known) {
      failRetryable('Swap failed: ' + reason + ' — and ' + label + ' ' + ctx.slotToChange +
        ' could not be restored. Check My Bookings and rebook.');
    } else {
      closeUnconfirmed(reason);
    }
  } finally {
    _swapInFlight = false;
  }
}

// ── Find Similar popup ──────────────────────────────────────────
window.findSimilar = function(eventId) {
  const evt = _eventCache[String(eventId)];
  if (!evt) { toast('Event data not available', 'error'); return; }

  // Remove any existing popup
  const existing = document.querySelector('.find-similar-popup');
  if (existing) existing.remove();

  // Find the triggering button
  const triggerBtn = document.querySelector(`.my-booking-card[data-id="${eventId}"] .find-similar-btn`);
  if (!triggerBtn) return;

  const origDate = new Date(evt.start_at);
  const dayName = origDate.toLocaleDateString('en-GB', { weekday: 'long' });
  const timeLabel = _clock24(origDate.getHours(), origDate.getMinutes());
  const instrName = evt._instrName || 'this instructor';
  const typeName = evt._typeName || 'Class';

  // Each option leads with a line mark (pure:sheets _uiIcon) — never an emoji.
  // (typeof: the suites run this function on its own.)
  const optIcon = name => '<span class="find-similar-icon" aria-hidden="true">' + (typeof _uiIcon === 'function' ? _uiIcon(name, 18) : '') + '</span>';
  const popup = document.createElement('div');
  popup.className = 'find-similar-popup';
  popup.innerHTML =
    '<div class="find-similar-title">Find similar</div>' +
    '<button class="find-similar-option" data-action="next-week">' +
      optIcon('calendar') +
      '<span class="find-similar-label">Same class next week</span>' +
      '<span class="find-similar-desc">' + escapeHTML(typeName) + ' with ' + escapeHTML(instrName) + ', ' + dayName + ' ' + timeLabel + '</span>' +
    '</button>' +
    '<button class="find-similar-option" data-action="same-instructor">' +
      optIcon('person') +
      '<span class="find-similar-label">Same instructor, any time</span>' +
      '<span class="find-similar-desc">All classes with ' + escapeHTML(instrName) + ' this week</span>' +
    '</button>' +
    '<button class="find-similar-option" data-action="same-time">' +
      optIcon('clock') +
      '<span class="find-similar-label">Same time, any instructor</span>' +
      '<span class="find-similar-desc">' + dayName + 's at ' + timeLabel + '</span>' +
    '</button>';

  // Position near the card's action row. The Similar button itself sits behind
  // the card's "More" menu on a phone — closed again by the time this runs — so
  // the popup hangs off the row that is always on screen (.mb-actions), not off
  // the button's own parent. (No card found: the old anchor, as before.)
  const card = typeof triggerBtn.closest === 'function' ? triggerBtn.closest('.my-booking-card') : null;
  const anchor = (card && card.querySelector('.mb-actions')) || triggerBtn.parentElement;
  anchor.style.position = 'relative';
  anchor.appendChild(popup);

  // A named group that TAKES the keyboard. Chosen from the card's More menu,
  // the popup lands BEFORE the focused More button in the markup (.mb-more is
  // last on the card): Tab went straight on to the next card with the popup
  // still open, nothing was announced, and Escape did nothing. So focus moves
  // to the first option, Escape closes the popup, and focus then goes back to
  // the card's visible trigger — the More button on a phone, Similar itself
  // where the actions are laid out inline. (typeof: the suites' fake nodes.)
  if (typeof popup.setAttribute === 'function') {
    popup.setAttribute('role', 'group');
    popup.setAttribute('aria-label', 'Find similar');
  }
  const focusBack = function() {
    const more = card ? card.querySelector('.mb-more-btn') : null;
    const back = (more && more.offsetParent !== null) ? more : triggerBtn;
    if (back && back.isConnected !== false && typeof back.focus === 'function') { try { back.focus({ preventScroll: true }); } catch (e) {} }
  };
  popup.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    popup.remove();
    focusBack();
  });
  const firstOption = typeof popup.querySelector === 'function' ? popup.querySelector('.find-similar-option') : null;
  if (firstOption && typeof firstOption.focus === 'function') { try { firstOption.focus(); } catch (e) {} }

  // The popup floats ABOVE the buttons (below, the next card — its own
  // stacking context — would paint over it), but the bookings list sits in
  // overflow:hidden panels: with too little room above, the top options were
  // clipped away. Then lay it out in the flow under the buttons instead.
  // Measured on the next frame — before first paint, and after the "book
  // again" wrapper below has added its option.
  requestAnimationFrame(function() {
    if (!popup.isConnected) return;
    const anchorTop = popup.parentElement.getBoundingClientRect().top;
    const clipper = popup.closest('.mb-period-section, .upcoming-panel');
    // The tab bar is sticky at the top on desktop (it would cover the popup);
    // on phones it is fixed at the bottom, i.e. below the anchor — ignored.
    const bar = document.querySelector('.tab-bar');
    const barBottom = bar ? bar.getBoundingClientRect().bottom : 0;
    const roomTop = Math.max(0, clipper ? clipper.getBoundingClientRect().top : 0, barBottom <= anchorTop ? barBottom : 0);
    if (anchorTop - popup.offsetHeight - 8 < roomTop) popup.classList.add('is-inline');
  });

  // Handle option clicks
  popup.addEventListener('click', function(e) {
    // The card itself is tappable (opens the class sheet) — a tap anywhere in
    // the popup must not reach it.
    e.stopPropagation();
    const option = e.target.closest('.find-similar-option');
    if (!option) return;
    const action = option.dataset.action;
    popup.remove();

    if (action === 'next-week') {
      // This one stays on My Bookings (a search, then the picker): the option
      // that held focus is gone, so hand it to the card — it is also where the
      // picker returns focus when it closes. (The other options leave for Discover.)
      focusBack();
      // Existing rebookNextWeek logic
      rebookNextWeek(eventId);
    } else if (action === 'same-instructor') {
      // This instructor, this week, anywhere and in any class type — a studio
      // or class-type filter left on Discover hid the classes the toast
      // announces. "This week" IS the week preset, and is named as such: a
      // mode left over from an earlier Today/Tomorrow tap lit nothing on the
      // date row and recorded this search as "Today".
      _focusSearch({ instructorId: evt.instructor_id, mode: 'week' });
      toast('Showing classes with ' + instrName, 'info');
    } else if (action === 'same-time') {
      // Find next occurrence of this weekday (this week or next)
      const today = new Date();
      const todayDay = today.getDay();
      const targetDay = origDate.getDay();
      let daysUntil = targetDay - todayDay;
      if (daysUntil < 0) daysUntil += 7;
      if (daysUntil === 0 && today.getHours() > origDate.getHours()) daysUntil = 7;
      const nextDate = new Date(today);
      nextDate.setDate(nextDate.getDate() + daysUntil);
      // The class's OWN day while it is still to come: this is how a held class
      // is swapped, and from Monday noon most bookings are 7+ days out — the
      // nearest occurrence of the weekday was then the week BEFORE it, and with
      // one day shown the class being swapped was not even listed. (The date is
      // read off the API's wall-clock string; a class gone by falls back to the
      // next occurrence of its weekday.)
      const classDay = String(evt.start_at).slice(0, 10);
      const targetStr = (/^\d{4}-\d{2}-\d{2}$/.test(classDay) && classDay >= localDateStr(today)) ? classDay : localDateStr(nextDate);
      const targetDate = new Date(targetStr + 'T12:00:00');
      // That ONE day, this class's own studio and class type, anyone teaching.
      // It used to be 8 days of every class at whatever studio Discover was
      // left on. The shortcut does not narrow by hour, so the toast no longer
      // claims "around 7:00am" — the day's classes list in time order.
      // The Time row is kept here (keepTimeRow — every other shortcut clears
      // it), with this class's band admitted: "After 17:00" alone would hide the
      // day's 7am classes.
      if (typeof _admitTimeBands === 'function') _admitTimeBands([evt.start_at]);
      const studio = _studioMap[evt.studio_id];
      _focusSearch({ locationId: studio ? studio.location_id : '', typeName: evt._typeName, startDate: targetStr, daysAhead: 1, keepTimeRow: true });
      toast('Showing ' + targetDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) +
        (evt._locName ? ' at ' + evt._locName : '') + ' — any instructor', 'info');
    }
  });

  // Dismiss when clicking outside
  function dismissPopup(e) {
    if (popup.contains(e.target) || e.target === triggerBtn) return;
    document.removeEventListener('click', dismissPopup, true);
    // Already closed (an option was picked, or the list re-rendered): this tap
    // is not a dismissal, so it must go through untouched.
    if (!popup.isConnected) return;
    popup.remove();
    // The list under the popup is all tap targets now — the card opens the
    // class sheet, its buttons cancel / swap — so the tap that closes the popup
    // must do nothing else there. Caught in capture, before any inline onclick.
    // Another card's Similar button goes through (it opens that card's popup),
    // and so does a tap outside the cards, e.g. the tab bar.
    const t = e.target;
    if (t && typeof t.closest === 'function' && t.closest('.my-booking-card') && !t.closest('.find-similar-btn')) {
      e.stopPropagation();
      e.preventDefault();
    }
  }
  // Delay listener to avoid immediate dismiss from the triggering click
  setTimeout(function() {
    document.addEventListener('click', dismissPopup, true);
  }, 10);
};

// ── Share a class ───────────────────────────────────────────────
window.shareClass = function(eventId) {
  const evt = _eventCache[String(eventId)];
  if (!evt) { toast('Event data not available', 'error'); return; }

  const dt = new Date(evt.start_at);
  const dayName = dt.toLocaleDateString('en-GB', { weekday: 'long' });
  const dayNum = dt.getDate();
  const monthName = dt.toLocaleDateString('en-GB', { month: 'short' });
  const timeLabel = _clock24(dt.getHours(), dt.getMinutes());

  const typeName = evt._typeName || 'Class';
  const instrName = evt._instrName || '';
  const locName = evt._locName || '';

  const instrPart = instrName ? (' with ' + instrName) : '';
  const locPart = locName ? (' at ' + locName) : '';

  const message = `I'm going to ${typeName}${instrPart} on ${dayName} ${dayNum} ${monthName} at ${timeLabel}${locPart}. Book a spot! https://psyclelondon.com/pages/timetable`;

  // ONE share path, picked by capability. In the iOS app that is the native
  // sheet, and it resolves false when the user cancels — an answer, not a
  // failure, so never fall through to a second sheet or a clipboard toast.
  if (typeof window.nativeShare === 'function') {
    Promise.resolve(window.nativeShare('Psycle class', message, null)).catch(function() {});
    return;
  }

  if (navigator.share) {
    navigator.share({ text: message }).catch(function() {});
  } else if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(message).then(function() {
      toast('Copied to clipboard', 'success');
    }).catch(function() {
      toast('Could not copy to clipboard', 'error');
    });
  } else {
    // Fallback: select from a temporary textarea
    const ta = document.createElement('textarea');
    ta.value = message;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('Copied to clipboard', 'success');
  }
};

async function upcomingCancel(eventId, btn) {
  const shown = _myBookings[String(eventId)];
  if (!shown) return;
  // Waitlist places are left via /waitlists — never DELETE /bookings (a 404
  // there would read as "cancelled" while the place survives server-side).
  if (shown.waitlisted) return leaveWaitlist(eventId, btn);
  if (!(await confirmCancelWithPolicy(eventId, 'Cancel this booking?'))) return;
  // A failed cancel puts the button back as it was ("Cancel booking" /
  // "Cancel all 2"), not a generic "Cancel".
  const origLabel = btn.textContent;
  btn.disabled = true;
  _busyLabel(btn);

  // The entry as it is NOW — a fetch that landed while the dialog was up
  // swapped the whole map — and only once every seat's record can be listed.
  const ready = await _readyForWholeCancel(eventId);
  const booking = _myBookings[String(eventId)];
  if (!ready || !booking || booking.waitlisted) {
    btn.disabled = false;
    btn.textContent = origLabel;
    if (ready) {
      // The seat went while the dialog was up (cancelled elsewhere).
      refreshUpcomingPanel();
      toast("That booking isn't showing with Psycle any more — nothing was cancelled", 'info');
    }
    return;
  }

  const bookingIds = _bookingIdsFor(booking);

  // Offline: queue + optimistic.
  if (!navigator.onLine && typeof queueOfflineCancel === 'function') {
    queueOfflineCancel(eventId, bookingIds);
    _dropBookingKeepPlace(eventId);
    _syncCardButtonsForEvent(eventId);
    refreshUpcomingPanel();
    toast("You're offline — cancel queued. We'll send it when you're back online.", 'info');
    PsycleEvents.emit('booking:cancelled', eventId);
    return;
  }

  try {
    const ids = bookingIds.length === 0 ? [null] : bookingIds;
    const results = await Promise.all(ids.map(bid => {
      const path = bid ? `/bookings/${bid}` : `/bookings?event_id=${eventId}`;
      return apiFetch(path, { method: 'DELETE' });
    }));
    // 404 counts as success: a retried DELETE whose first attempt landed
    // server-side comes back 404 — the booking is gone either way.
    const isOk = r => r.ok || r.status === 204 || r.status === 200 || r.status === 404;
    const allOk = results.every(isOk);
    if (allOk) {
      _dropBookingKeepPlace(eventId);
      // Also update any rendered search card
      _syncCardButtonsForEvent(eventId);
      refreshUpcomingPanel();
      toast('Booking cancelled', 'info');
      PsycleEvents.emit('booking:cancelled', eventId);
      _scheduleBookingsRefetch(); // as confirmUnbook: a record we never knew of must reappear
    } else {
      btn.disabled = false;
      btn.textContent = origLabel;
      const failed = results.find(r => !isOk(r));
      const data = await failed.json().catch(() => ({}));
      toast(describeCancelError(failed, data), 'error');
      if (results.some(isOk) && typeof fetchMyBookings === 'function') {
        fetchMyBookings();
      } else if (results.some(r => r.status >= 500)) {
        // As confirmUnbook: a 5xx can follow a DELETE that did land.
        _scheduleBookingsRefetch(1500);
      }
    }
  } catch (e) {
    if (!navigator.onLine && typeof queueOfflineCancel === 'function') {
      queueOfflineCancel(eventId, bookingIds);
      _dropBookingKeepPlace(eventId);
      _syncCardButtonsForEvent(eventId);
      refreshUpcomingPanel();
      toast("You're offline — cancel queued. We'll send it when you're back online.", 'info');
      PsycleEvents.emit('booking:cancelled', eventId);
      return;
    }
    btn.disabled = false;
    btn.textContent = origLabel;
    toast(describeCancelError(null, null, e), 'error');
    // As confirmUnbook: a retried DELETE may have landed unheard.
    if (navigator.onLine) _scheduleBookingsRefetch(1500);
  }
}

async function upcomingSeatCancel(eventId, slotId, btn) {
  if (!_myBookings[String(eventId)]) return;
  const _sl4 = slotLabelForEvent(eventId);
  if (!(await confirmCancelWithPolicy(eventId, `Cancel ${_sl4} ${slotId}?`))) return;
  btn.disabled = true;
  const chip = btn.closest('.up-seat-chip');
  if (chip) chip.style.opacity = '0.5';
  let sentOnline = false; // as in cancelBikeSlot
  try {
    // Same rule as cancelBikeSlot. Read AFTER the dialog (a fetch that landed
    // meanwhile swapped the whole map), and only ever DELETE the record that is
    // provably THIS seat's: right after a booking the seats can share one id or
    // have none, and the entry id — or an event-wide DELETE — is the OTHER
    // seat's record too. Re-read /bookings rather than guess.
    let resolvedId = _seatCancelId(_myBookings[String(eventId)], slotId);
    if (!resolvedId && navigator.onLine) {
      await _rereadBookingsForVerify();
      resolvedId = _seatCancelId(_myBookings[String(eventId)], slotId);
    }
    if (!resolvedId) {
      btn.disabled = false;
      if (chip) chip.style.opacity = '';
      toast(`Couldn't match ${_sl4} ${slotId} to a booking — nothing was cancelled. Pull to refresh and try again.`, 'error');
      return;
    }
    sentOnline = navigator.onLine !== false;
    const res = await apiFetch(`/bookings/${resolvedId}`, { method: 'DELETE' });
    // 404 = that seat's own record is already gone.
    if (res.ok || res.status === 204 || res.status === 200 || res.status === 404) {
      // Remove this slot from local state — the LIVE entry, not a snapshot
      // taken before an await (the map may have been swapped again).
      const booking = _myBookings[String(eventId)];
      if (booking && !booking.waitlisted) {
        booking.slots = (booking.slots || []).filter(s => s !== Number(slotId));
        if (booking.slotBookings) delete booking.slotBookings[slotId];
        if (booking.slots.length === 0) _dropBookingKeepPlace(eventId);
      }
      _noteLocalBookingWrite();
      _markSeatFreed(eventId);
      // Update the corresponding class card in results if rendered
      _syncCardButtonsForEvent(eventId);
      refreshUpcomingPanel();
      toast(`${_sl4} ${slotId} cancelled`, 'info');
      PsycleEvents.emit('seat:cancelled', eventId, slotId);
      _scheduleBookingsRefetch();
    } else {
      btn.disabled = false;
      if (chip) chip.style.opacity = '';
      const data = await res.json().catch(() => ({}));
      toast(describeCancelError(res, data), 'error');
      // Same as cancelBikeSlot: a 5xx can follow a DELETE that did land.
      if (res.status >= 500) _scheduleBookingsRefetch(1500);
    }
  } catch (e) {
    btn.disabled = false;
    if (chip) chip.style.opacity = '';
    toast(describeCancelError(null, null, e, sentOnline), 'error');
    // Same as cancelBikeSlot: the seat's DELETE may have landed unheard.
    if (navigator.onLine) _scheduleBookingsRefetch(1500);
    else if (sentOnline) window.addEventListener('online', () => _scheduleBookingsRefetch(400), { once: true });
  }
}

// _eventCache managed by state.js

// ── A held class whose studio isn't known yet ───────────────────
// A booking painted from last launch's saved details (_fromSnapshot) is on
// screen BEFORE GET /events/{id} has told _studioMap about its studio — and the
// saved studio id can itself be out of date. (A waitlist place Psycle turned
// into a seat is the same: its cache entry came from the place, not a detail
// read.) "Change spot" then answered "No layout available for this studio", and
// the sheet's booked button — it routes on has_layout — opened the cancel
// dialog instead of the picker. Both wait here first.
function _studioNeedsReread(eventId) {
  const evt = _eventCache[String(eventId)];
  return !!evt && (!!evt._fromSnapshot || evt.studio_id == null || !_studioMap[evt.studio_id]);
}

// Re-read THAT class, under the deadline a booking tap waits for /bookings
// (_rereadBookingsForVerify): one request per class however many taps. True
// once a real detail read has replaced the record — ours, or the background one
// fetchMyBookings started — and false when Psycle didn't answer in time: the
// caller then says so and stops, rather than act on details nobody confirmed.
const _studioRereads = {};
function _ensureStudioKnown(eventId) {
  const key = String(eventId);
  if (!_studioNeedsReread(key)) return Promise.resolve(true);
  if (!_studioRereads[key]) {
    const before = _eventCache[key];
    const landed = () => _eventCache[key] !== before || !_studioNeedsReread(key);
    _studioRereads[key] = Promise.race([
      _hydrateEventDetails([key]).then(landed, () => false),
      new Promise(r => setTimeout(() => r(landed()), BOOKING_VERIFY_DEADLINE_MS)),
    ]).then(ok => { delete _studioRereads[key]; return ok === true; });
  }
  return _studioRereads[key];
}

// Latest tap wins (see bookClass) — for the taps that wait BEFORE a picker
// without having taken bookClass's sequence number: the sheet's booked button
// (the re-read above, up to 10s) and Change spot. Has another class been tapped
// since `seqAtTap` was read, or is a picker up that somebody else opened? The
// sheet's tap used to reach bookClass late and take the HIGHER number: the
// class tapped since was put back silently and this, older, one opened instead.
// (typeof / .style checks: the suites run the callers against bare fakes.)
function _pickerTakenSince(seqAtTap) {
  if (((typeof bookClass === 'function' && bookClass._seq) || 0) !== seqAtTap) return true;
  const picker = typeof document.getElementById === 'function' ? document.getElementById('bikeModal') : null;
  return !!(picker && picker.style && picker.style.display && picker.style.display !== 'none');
}

// ── Class Detail Sheet ──────────────────────────────────────────
// The sheet's Book / booked button. Prefer the rendered Discover card button
// (its label stays in sync). Opened from My Bookings there often is none, so
// act through a detached button with eventCard's own routing: a seat at a
// layout studio re-opens the picker (view/cancel a seat, add one); a booking
// without a known layout goes to the cancel dialog — bookClass there would
// offer "Book another space?", the opposite of what tapping a booking means.
//
// The sheet is already gone by now, and the '…' lives on a button nobody can
// see (detached — or a card on the hidden Discover tab when opened from My
// Bookings) while GET /events/{id} runs, retries included: say something. And
// bookClass's double-tap guard is per BUTTON — a fresh detached one per tap
// would walk straight past it and open the picker twice — so guard per class.
const _sheetActionBusy = {};
async function _classDetailBookAction(eventId) {
  const id = Number(eventId) || 0;
  // A held seat whose studio isn't known yet: picker or cancel dialog (below)
  // can't be chosen until the class has been re-read — see _ensureStudioKnown.
  // Everything after this reads state afresh. (typeof: the suites run this
  // function on its own.)
  const heldSeat = _myBookings[String(id)];
  if (typeof _ensureStudioKnown === 'function' && getBearerToken() && heldSeat && !heldSeat.waitlisted && _studioNeedsReread(id)) {
    const seqAtTap = (typeof bookClass === 'function' && bookClass._seq) || 0;
    toast('Loading class…', 'info');
    if (!(await _ensureStudioKnown(id))) {
      // (No token left = the session ended meanwhile, and said so itself.)
      if (getBearerToken()) toast("Couldn't load this class — try again in a moment", 'error');
      return;
    }
    // The member tapped another class while this one loaded: theirs, quietly.
    if (typeof _pickerTakenSince === 'function' && _pickerTakenSince(seqAtTap)) return;
  }
  const studioId = Number(_eventCache[String(id)]?.studio_id) || 0;
  const booking = _myBookings[String(id)];
  // A place, or a booking without a known layout, opens its dialog at once
  // (as does signed-out): only the event fetch is worth a "Loading".
  const instant = !getBearerToken() || (!!booking && (booking.waitlisted || !_studioMap[studioId]?.has_layout));
  const cardBtn = document.querySelector('.class-card:not(.my-booking-card) .book-btn[data-event-id="' + id + '"]');
  if (cardBtn) {
    // The sheet can offer Book from fresher availability than the card was
    // built from (a watched class just re-read): the card is then still a
    // DISABLED "Full", and click() on a disabled button does nothing at all.
    // Bring it up to date first — never mid-flight, where bookClass itself has
    // disabled the button for the length of its request.
    const midFlight = cardBtn.dataset.busy === '1' || cardBtn.textContent === '…';
    if (cardBtn.disabled && !midFlight) _syncCardButtonsForEvent(id);
    if (!instant && cardBtn.offsetParent === null && cardBtn.dataset.busy !== '1') toast('Loading class…', 'info');
    cardBtn.click();
    return;
  }
  const btn = document.createElement('button');
  if (booking && !booking.waitlisted && !_studioMap[studioId]?.has_layout) {
    return confirmUnbook(booking.bookingId || null, id, btn);
  }
  if (_sheetActionBusy[id]) return;
  _sheetActionBusy[id] = true;
  if (!instant) toast('Loading class…', 'info');
  try { await bookClass(id, btn, studioId); } finally { delete _sheetActionBusy[id]; }
}

// The sheet's "Claim spot" (a waitlist place with an offer showing). Drives the
// My Bookings card's own Claim button when one is rendered, so its '…' and the
// disabled state that stops a second tap are the card's; when that button is
// not on screen (sheet opened from Discover) the first step — a GET — shows
// nothing, so say something. Books nothing by itself: claimWaitlistSpot always
// asks, with the credits and the cancel terms, before its POST.
async function _classDetailClaimAction(eventId) {
  const id = Number(eventId) || 0;
  const cardBtn = document.querySelector('.my-booking-card[data-id="' + id + '"] .mb-primary-btn:not(.booked)');
  if ((cardBtn && cardBtn.disabled) || _sheetActionBusy[id]) return; // already asking
  _sheetActionBusy[id] = true;
  if (!cardBtn || cardBtn.offsetParent === null) toast('Checking for a spot…', 'info');
  try { await claimWaitlistSpot(id, cardBtn || null); } finally { delete _sheetActionBusy[id]; }
}

window.openClassDetail = function (eventId) {
  const evt = _eventCache[String(eventId)];
  if (!evt) return;

  // Remove any existing detail sheet
  document.getElementById('classDetailOverlay')?.remove();

  // Find instructor from global instructors array
  const instrs = (typeof instructors !== 'undefined') ? instructors : [];
  const instr = instrs.find(i => String(i.id) === String(evt.instructor_id));
  const photo = instr?.photo || instr?.image_1 || '';
  const instrName = instr?.full_name || evt._instrName || '';
  const instrId = instr?.id || evt.instructor_id;
  const meta = instr?.metafields || {};
  const bio = meta.description || '';
  const bioExcerpt = bio.length > 200 ? bio.substring(0, 200) + '...' : bio;
  const keywords = (meta.keywords || '').split(/[,|]/).map(k => k.trim()).filter(Boolean);
  const tierBadge = (typeof tierBadgeHTML === 'function') ? tierBadgeHTML(instrId) : '';

  // Format date/time
  const dt = new Date(evt.start_at);
  const dayStr = dt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const clock = _clock24(dt.getHours(), dt.getMinutes()); // "19:00"

  const typeName = evt._typeName || 'Class';
  const locName = evt._locName || '';
  const studioName = evt._studioName || '';
  const duration = evt.duration || '';

  // Crisp Colour: the sheet wears its class type (data-ct → css/crisp.css), with
  // that type's pictogram; rows lead with a line mark, never an emoji.
  // (typeof: the suites run this function on its own, without these helpers.)
  const ctKey = typeof classTypeKey === 'function' ? classTypeKey(typeName) : 'other';
  const pictogram = (key, px) => (typeof classPictogram === 'function' ? classPictogram(key, px) : '');
  const rowIcon = name => '<span class="cds-icon" aria-hidden="true">' + (typeof _uiIcon === 'function' ? _uiIcon(name, 19) : '') + '</span>';

  // Availability info. The count comes from _spotsLeft (the API sends
  // capacity + occupancy; the capacity_remaining this row waited for never
  // arrives, so it fell through to a second "45 min" — the header badge
  // already says that) and only while the numbers are recent: _countsAt is
  // stamped by render(), and an entry it never touched has no known age.
  let availHtml = '';
  if (evt.is_fully_booked && !evt.is_waitlistable) {
    availHtml = '<span class="cds-avail cds-avail-full">Full</span>';
  } else if (evt.is_fully_booked && evt.is_waitlistable) {
    availHtml = '<span class="cds-avail cds-avail-waitlist">Full — waitlist open</span>';
  } else {
    const left = _countsFresh(evt._countsAt, Date.now()) ? _spotsLeft(evt) : null;
    if (left >= 1) {
      availHtml = '<span class="cds-avail' + (left <= 3 ? ' cds-avail-waitlist' : '') + '">' + left + (left === 1 ? ' spot left' : ' spots left') + '</span>';
    }
  }
  // My Bookings can open the sheet for a class that has already run (past
  // bookings shown): "12 spots available" means nothing for a finished class.
  const isPast = dt <= new Date();
  if (isPast) availHtml = '';

  // A seat already held at this time, said before the member taps Book — as ONE
  // quiet line: a row like its neighbours (body ink, no ground of its own) that
  // leads with the caution mark (css/crisp.css inks it in the theme's caution
  // colour). .cds-avail-full / -waitlist stay as hooks: overlap vs. squeeze / place.
  // Advisory: a cache entry of an odd shape must not stop the sheet opening.
  let clashHtml = '';
  if (!isPast) {
    try {
      // Places too, here: the usual waitlist pattern is a fallback booked for
      // the same time. A place is only a possible seat: it keeps the -waitlist hook.
      const clash = _clashFor(eventId, null, { includePlaces: true });
      if (clash) {
        // The other class closes the row as its own small tile (its type's colour).
        const otherKey = clash.typeName && typeof classTypeKey === 'function' ? classTypeKey(clash.typeName) : '';
        clashHtml = '<div class="cds-detail-row cds-clash">' + rowIcon('caution') + '<span class="' +
          (clash.kind === 'overlap' && !clash.place ? 'cds-avail-full' : 'cds-avail-waitlist') + '">' + escapeHTML(_clashLabel(clash)) + '</span>' +
          (otherKey ? '<span class="ct-tile is-sm" data-ct="' + otherKey + '" aria-hidden="true">' + pictogram(otherKey, 15) + '</span>' : '') + '</div>';
      }
    } catch (e) {}
  }

  // Booking state
  const myBooking = _myBookings[String(eventId)];
  const safeEventId = Number(eventId) || 0;
  // ONE action, one full-width pill (css/crisp.css primitives; cds-book-btn and
  // cds-view-instr stay as hooks). The glow goes to the action that books — or
  // to the seat that is already yours — and to nothing else on the sheet.
  const pillMain = ' pill-btn pill-primary is-block is-lg';
  const pillPlace = ' pill-btn pill-ct-outline is-block is-lg';
  const pillSecond = ' pill-btn pill-quiet is-block';
  let canBook = false; // plain "Book": the only state the plan note belongs to
  let bookBtnHtml;
  if (myBooking && myBooking.waitlisted) {
    // A waitlist place: manage it directly (no Discover card needed in the DOM).
    bookBtnHtml = '<button class="cds-book-btn booked is-place' + pillPlace + '" onclick="event.stopPropagation();document.getElementById(\'classDetailOverlay\').remove();leaveWaitlist(' + safeEventId + ', null);">Waitlisted ✓</button>';
    // An offer showing (as the My Bookings card works it out): the member came
    // from Psycle's email, or tapped their "Spot available" card — and the only
    // action here was a ticked button that opens "Leave the waitlist?". Claim
    // leads, Leave stays as the secondary action; the row above says where
    // they stand instead of "Full — waitlist open".
    const place = myBooking.waitlist || null;
    const offerOpen = !isPast && !!place && (!!(place.offer && place.offer.available) || _waitlistOfferPending(place));
    if (offerOpen) {
      bookBtnHtml = '<button class="cds-book-btn' + pillMain + ' glow-mine" onclick="event.stopPropagation();document.getElementById(\'classDetailOverlay\').remove();_classDetailClaimAction(' + safeEventId + ');">Claim spot</button>' +
        '<button class="cds-view-instr' + pillSecond + '" onclick="event.stopPropagation();document.getElementById(\'classDetailOverlay\').remove();leaveWaitlist(' + safeEventId + ', null);">Leave waitlist</button>';
    }
    if (!isPast) {
      availHtml = '<span class="cds-avail cds-avail-waitlist">' +
        (offerOpen ? (place.offer && place.offer.available ? 'A spot is free right now' : 'A spot has opened up') : 'You’re on the waitlist') + '</span>';
    }
  } else if (myBooking) {
    const seats = (myBooking.slots || []).length ? formatSlots(slotLabelForEvent(eventId), myBooking.slots) : '';
    const bookedLabel = seats ? seats + ' ✓' : 'Booked ✓';
    // A class that has run has nothing left to manage: no tick (that is the
    // live, tappable state), and the card's own word for it.
    bookBtnHtml = isPast
      ? '<button class="cds-book-btn booked' + pillMain + '" disabled>' + escapeHTML(seats ? 'Attended · ' + seats : 'Attended') + '</button>'
      : '<button class="cds-book-btn booked' + pillMain + ' glow-mine" onclick="event.stopPropagation();document.getElementById(\'classDetailOverlay\').remove();_classDetailBookAction(' + safeEventId + ');">' + escapeHTML(bookedLabel) + '</button>';
  } else if (evt.is_fully_booked && !evt.is_waitlistable) {
    bookBtnHtml = '<button class="cds-book-btn' + pillMain + '" disabled>Full</button>';
  } else if (evt.is_fully_booked && evt.is_waitlistable) {
    // Same routing as Book (card button if rendered, else a detached one) —
    // and the same per-class double-tap guard.
    bookBtnHtml = '<button class="cds-book-btn waitlist' + pillPlace + '" onclick="event.stopPropagation();document.getElementById(\'classDetailOverlay\').remove();_classDetailBookAction(' + safeEventId + ');">Join Waitlist</button>';
  } else {
    canBook = !isPast;
    bookBtnHtml = '<button class="cds-book-btn' + pillMain + ' glow-mine" onclick="event.stopPropagation();document.getElementById(\'classDetailOverlay\').remove();_classDetailBookAction(' + safeEventId + ');">Book</button>';
  }

  // When cancelling stops being free — _cancelDeadline, so the sheet, the card,
  // the picker and the cancel dialog cannot disagree — for a seat held or one
  // that can be booked (a waitlist place has nothing to late-cancel yet). Inside
  // the window it IS the late-cancel message and wears that message's one class.
  let policyHtml = '';
  if (!isPast && !(myBooking && myBooking.waitlisted) && (myBooking || !evt.is_fully_booked) && typeof _cancelDeadline === 'function') {
    const deadline = _cancelDeadline(evt.start_at);
    if (deadline) {
      policyHtml = '<div class="cds-detail-row">' + rowIcon('clock') + (deadline.insideWindow
        ? '<span class="late-cancel-note">Inside the 12-hour late-cancel window</span>'
        : '<span>Free cancel until <strong>' + escapeHTML(deadline.label) + '</strong></span>') + '</div>';
    }
  }

  // Beside Book: what the booking uses and what is left — only what Psycle's own
  // numbers can back (pure:sheets _sheetPlanNote). The period bounds are parsed
  // the way My Bookings parses them for its split.
  let noteHtml = '';
  if (canBook && typeof _sheetPlanNote === 'function') {
    const ms = d => (d && !isNaN(d.getTime()) ? d.getTime() : NaN);
    const sub = _activeSubscription || null;
    const note = _sheetPlanNote({
      subscription: sub, classMs: dt.getTime(),
      periodStartMs: sub ? ms(parsePsycleDate(sub.period_start)) : NaN,
      periodEndMs: sub ? ms(parsePsycleDate(sub.period_end)) : NaN,
      creditsRemaining: currentUser && currentUser.stats ? currentUser.stats.credits_remaining : NaN,
    });
    if (note) {
      noteHtml = '<div class="cds-note"><span class="cds-note-main">' + escapeHTML(note.main) + '</span>' +
        (note.sub ? '<span class="cds-note-sub">' + escapeHTML(note.sub) + '</span>' : '') + '</div>';
    }
  }

  // Keywords tags
  let keywordsHtml = '';
  if (keywords.length > 0) {
    keywordsHtml = '<div class="cds-keywords">' +
      keywords.map(k => '<span class="cds-keyword">' + escapeHTML(k) + '</span>').join('') +
      '</div>';
  }

  // Instructor link
  const safeInstrName = escapeForJsString(instrName);
  const viewInstrHtml = instrId
    ? '<button class="cds-view-instr' + pillSecond + '" onclick="document.getElementById(\'classDetailOverlay\').remove();window._features_openInstructorModal(\'' + safeInstrName + '\',\'' + escapeForJsString(instrId) + '\')">View instructor profile</button>'
    : '';

  // Build overlay
  const overlay = document.createElement('div');
  overlay.id = 'classDetailOverlay';
  overlay.className = 'modal-overlay';
  overlay.style.display = 'flex';
  overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };

  // Crisp Colour anatomy (the ClassSheet board). A block in the class's colour:
  // the TIME leads in the display face, the date and length under it, the
  // pictogram tile beside it; then the class name in its own deep ink, then
  // who and where (the separator rides with the place, so a wrap never leaves
  // a "·" hanging). Below, on the surface: one grouped list — free-cancel,
  // availability, clash — the bio, and ONE action with what it uses beside it.
  const whereText = [locName, studioName].filter(Boolean).join(', ');
  const rowsHtml = policyHtml +
    (availHtml ? '<div class="cds-detail-row">' + rowIcon('spots') + availHtml + '</div>' : '') +
    clashHtml;

  // The sheet has no title element of its own; its name is what it is about.
  overlay.innerHTML =
    '<div class="class-detail-sheet" data-ct="' + ctKey + '" role="dialog" aria-modal="true" tabindex="-1" aria-label="' +
      escapeHTML(instrName ? typeName + ' with ' + instrName : typeName) + '">' +
      '<div class="cds-hero ct-card">' +
        '<div class="cds-handle"></div>' +
        '<button class="modal-close cds-close" onclick="document.getElementById(\'classDetailOverlay\').remove()" aria-label="Close">&times;</button>' +
        '<div class="cds-when">' +
          '<div class="cds-when-text">' +
            '<span class="cds-time t-time is-sheet">' + clock + '</span>' +
            '<span class="cds-date">' + escapeHTML(dayStr) + (duration ? ' &middot; ' + escapeHTML(String(duration)) + ' min' : '') + '</span>' +
          '</div>' +
          '<span class="ct-tile cds-tile" aria-hidden="true">' + pictogram(ctKey, 38) + '</span>' +
        '</div>' +
        '<h2 class="cds-type">' + escapeHTML(typeName) + '</h2>' +
        ((instrName || whereText) ? '<div class="cds-who">' +
          (photo ? '<img class="cds-photo" src="' + escapeHTML(photo) + '" alt="' + escapeHTML(instrName) + '">' : '') +
          (instrName ? '<span class="cds-instr-name">' + escapeHTML(instrName) + ' ' + tierBadge + '</span>' : '') +
          (whereText ? '<span class="cds-where">' + (instrName ? '&middot; ' : '') + escapeHTML(whereText) + '</span>' : '') +
        '</div>' : '') +
      '</div>' +
      '<div class="cds-body">' +
        (rowsHtml ? '<div class="cds-details">' + rowsHtml + '</div>' : '') +
        (bioExcerpt ? '<div class="cds-bio">' + escapeHTML(bioExcerpt) + '</div>' : '') +
        keywordsHtml +
        '<div class="cds-actions">' +
          '<div class="cds-cta">' + bookBtnHtml + noteHtml + '</div>' +
          viewInstrHtml +
        '</div>' +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);
};

// An instructor photo that cannot load — offline (the timetable and the
// instructor list come out of our caches, the photo host does not) or a dead
// URL — left the browser's broken-image glyph, alt text spilling out of the
// circle. For the sheet above and the instructor modal (features.js) alike:
// `error` does not bubble, hence capture. The <img> becomes a div of the same
// class — the same circle, filled by the background both rules carry, like the
// sheet's own no-photo placeholder. The name is printed right beside it.
document.addEventListener('error', function (e) {
  const img = e.target;
  if (!img || img.tagName !== 'IMG' || !img.classList || !img.isConnected) return;
  if (!img.classList.contains('cds-photo') && !img.classList.contains('instructor-photo')) return;
  const blank = document.createElement('div');
  blank.className = img.className;
  blank.setAttribute('aria-hidden', 'true');
  img.replaceWith(blank);
}, true);

// ════════════════════════════════════════════════════════════════
// Feature: Weekly Template Booking Engine ("Your usual week")
// localStorage 'psycle_weekly_template' = array of
//   { dayOfWeek:0-6 (0=Sun), hour, minute, locationId, eventTypeId,
//     instructorId, label, locName?, seats? (1–4; absent = 1) }
// The "Your usual week" card in tabs.js calls saveWeeklyTemplate /
// loadWeeklyTemplate / planWeeklyTemplate / bookWeeklyTemplate; this is the
// implementation behind those hooks. NEVER a one-tap spend: planWeeklyTemplate
// and templateSpotsFor only read, and bookWeeklyTemplate books nothing but the
// classes the member ticked in the sheet that listed them — on exactly the
// spots that sheet showed. `seats` is where the sheet STARTS; it is coerced
// where it is read (_templateSeats) and bounded again before anything is sent.
// ════════════════════════════════════════════════════════════════
const WEEKLY_TEMPLATE_KEY = 'psycle_weekly_template';

function loadWeeklyTemplate() {
  try {
    const arr = JSON.parse(localStorage.getItem(WEEKLY_TEMPLATE_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function saveWeeklyTemplate(arr) {
  try {
    localStorage.setItem(WEEKLY_TEMPLATE_KEY, JSON.stringify(Array.isArray(arr) ? arr : []));
  } catch (e) { console.warn('[psycle] saveWeeklyTemplate failed:', e); }
}

function clearWeeklyTemplate() {
  try { localStorage.removeItem(WEEKLY_TEMPLATE_KEY); }
  catch (e) { console.warn('[psycle] clearWeeklyTemplate failed:', e); }
}

// ── pure:template:start ── (DOM-free; tests/suites/weekly-template.js evaluates this block)
// A template entry is a weekday plus a WALL-CLOCK time, and every start_at the
// API sends is the same naive UK wall clock — so matching reads the DIGITS. Not
// new Date('YYYY-MM-DD HH:MM:SS') (Invalid Date on iOS WebKit) and not the
// device zone (abroad, the 7:00 Ride parsed as 2:00 and matched nothing). It
// also makes a clock-change week a non-event: 7:00 stays 7:00.
const TEMPLATE_TOLERANCE_MIN = 20;

// { date: 'YYYY-MM-DD', min: minutes past midnight } of a naive API time, or
// null when it can't be read.
function _templateWall(startAt) {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(String(startAt == null ? '' : startAt).trim());
  return m ? { date: m[1], min: +m[2] * 60 + +m[3] } : null;
}

// Calendar arithmetic on 'YYYY-MM-DD' through UTC, where every day has 24 hours
// (a device-local setDate() walks through 23- and 25-hour days).
function _templateAddDays(dateStr, n) {
  const p = String(dateStr).split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
}

// 0=Sun..6=Sat of a 'YYYY-MM-DD'.
function _templateDow(dateStr) {
  const p = String(dateStr).split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
}

// London's calendar date and minutes past midnight at an instant — the clock
// the timetable (and its Monday-noon release) runs on. Device-local only when
// the engine has no Europe/London data.
function _templateLondonNow(nowMs) {
  const d = new Date(nowMs);
  try {
    const w = {};
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(d).forEach(p => { if (p.type !== 'literal') w[p.type] = p.value; });
    if (w.year && w.month && w.day) return { date: `${w.year}-${w.month}-${w.day}`, min: (+w.hour) * 60 + (+w.minute) };
  } catch (e) {}
  const pad = n => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, min: d.getHours() * 60 + d.getMinutes() };
}

// Seats per class. 4 is Psycle's own `max_bookable_slots` on every class read
// (observed 2026-09-19); an event that says less is believed (`max`).
const TEMPLATE_MAX_SEATS = 4;

// A saved entry's seat count: an integer 1–4, anything else 1 — storage is not
// ours to trust (an import, the iOS mirror), and this number ends up in a POST.
// A NUMBER only: the app never writes anything else there, so "3" is junk like
// any other — and it is the rule the card reads the same field by (js/tabs.js
// _uwCardSeats). The two must never disagree: the card SAYS what the sheet will
// offer to SPEND (tests/suites/14b-usual-week-card.js holds them together).
function _templateSeats(v, max) {
  let n = typeof v === 'number' ? v : 1;
  if (!(Number.isInteger(n) && n >= 1 && n <= TEMPLATE_MAX_SEATS)) n = 1;
  const cap = Number(max);
  return (Number.isInteger(cap) && cap >= 1 && cap < n) ? cap : n;
}

// How many seats a held entry is: its seats, or — a studio with no spot map
// keeps one slot-less record per space — its records. 0 for a waitlist place.
function _templateSeatsHeld(held) {
  if (!held || held.waitlisted) return 0;
  const seats = Array.isArray(held.slots) ? held.slots.length : 0;
  const records = Array.isArray(held.bookingIds) ? held.bookingIds.length : 0;
  return Math.max(1, seats || records);
}

// The slot ids a pick may send: whole positive numbers, each once, at most
// TEMPLATE_MAX_SEATS. Bounded HERE, again, whatever the sheet built.
function _templatePickSlots(v) {
  const out = [];
  (Array.isArray(v) ? v : []).forEach(s => {
    const n = (typeof s === 'number' || (typeof s === 'string' && s.trim() !== '')) ? Number(s) : NaN;
    if (Number.isInteger(n) && n > 0 && out.indexOf(n) === -1 && out.length < TEMPLATE_MAX_SEATS) out.push(n);
  });
  return out;
}

// The date ranges the sheet offers, each 7 days, in the order shown: the next 7
// days, then the next THREE Monday–Sunday weeks (Psycle books about three weeks
// ahead — pure:horizon). `horizon` is _bookingHorizon()'s answer (null: none).
// The batch the latest Monday release opened ('newest', a Friday → Thursday)
// leads the list when it is asked for (the Monday reminder's tap) or while that
// release is under 24 hours old.
function _templateRanges(nowMs, horizon, wantNewest) {
  const today = _templateLondonNow(nowMs).date;
  const monday = _templateAddDays(today, ((8 - _templateDow(today)) % 7) || 7);
  const out = [{ id: 'next7', start: today, end: _templateAddDays(today, 6) }];
  for (let k = 0; k < 3; k++) {
    const start = _templateAddDays(monday, 7 * k);
    out.push({ id: 'week' + (k + 1), start, end: _templateAddDays(start, 6) });
  }
  const batch = horizon && horizon.lastBatch;
  const age = horizon ? Number(nowMs) - Number(horizon.lastRelease) : NaN;
  if (batch && batch.from && batch.to && (wantNewest === true || (age >= 0 && age < 24 * 60 * 60 * 1000))) {
    out.unshift({ id: 'newest', start: batch.from, end: batch.to });
  }
  return out;
}

// Is this entry's class already held on `date`? A REAL seat in a class of its
// type (or, for an entry that names no type, its instructor) starting within
// the tolerance of its time — read off the cache, no network.
function _templateEntryHeld(entry, date, bookings, cache, tol) {
  if (!entry || (entry.eventTypeId == null && entry.instructorId == null)) return false;
  const limit = tol == null ? TEMPLATE_TOLERANCE_MIN : tol;
  const target = (Number(entry.hour) || 0) * 60 + (Number(entry.minute) || 0);
  const same = (a, b) => a != null && b != null && String(a) === String(b);
  return Object.keys(bookings || {}).some(id => {
    const held = bookings[id];
    const evt = (cache || {})[id];
    if (!held || held.waitlisted || !evt) return false;
    const w = _templateWall(evt.start_at);
    if (!w || w.date !== date || Math.abs(w.min - target) > limit) return false;
    return entry.eventTypeId != null ? same(evt.event_type_id, entry.eventTypeId) : same(evt.instructor_id, entry.instructorId);
  });
}

// Which range the sheet opens on: the newly opened batch when it leads the
// list; otherwise the FIRST range in which at least one usual class is not yet
// held (a week already booked is not the one to show); otherwise the next 7
// days. ctx: { ranges (_templateRanges), template, bookings, cache } — with
// none it is the next 7 days. (The old rule — "next week cannot be booked
// before Monday noon" — was wrong: see pure:horizon.)
function _templateDefaultStart(nowMs, ctx) {
  ctx = ctx || {};
  const now = _templateLondonNow(nowMs);
  const ranges = Array.isArray(ctx.ranges) && ctx.ranges.length ? ctx.ranges : _templateRanges(nowMs, null, false);
  const answer = r => ({ mode: r.id === 'next7' ? 'next7' : 'nextweek', start: r.start, id: r.id });
  if (ranges[0].id === 'newest') return answer(ranges[0]);
  const template = Array.isArray(ctx.template) ? ctx.template : [];
  const open = ranges.find(r => template.some(entry =>
    !_templateEntryHeld(entry, _templateDateFor(entry, r.start, now), ctx.bookings, ctx.cache)));
  return answer(open || ranges.find(r => r.id === 'next7') || ranges[0]);
}

// The date a template entry falls on within the 7 days from `start`. One that
// lands on London's today but has already started means its NEXT occurrence,
// not this morning's class.
function _templateDateFor(entry, start, now) {
  const date = _templateAddDays(start, (Number(entry.dayOfWeek) - _templateDow(start) + 7) % 7);
  const min = (Number(entry.hour) || 0) * 60 + (Number(entry.minute) || 0);
  return (now && date === now.date && min <= now.min) ? _templateAddDays(date, 7) : date;
}

// One template entry × one day's /events rows → the class it means and what a
// tap would do about it. ctx: { date, now ({date,min}, London), bookings
// (_myBookings), studios (_studioMap), findClash(event), tol? }.
// Candidates: on that date, not started, the entry's class type, starting
// within ±TEMPLATE_TOLERANCE_MIN of its time. A seat already held in one of
// them IS the entry ('booked') — "the 7:00" on top of a held 7:15 is a double.
// Otherwise the entry's instructor wins; with none of theirs on, the nearest
// class is offered but flagged (instructorChanged) so the sheet asks instead
// of assuming a cover is wanted. An entry naming neither a type nor an
// instructor — or no location AND a different instructor — identifies nothing.
// States: 'nomatch' | 'booked' | 'waitlisted' | 'clash' (hard overlap with a
// seat already held) | 'nolayout' (a studio nothing says has, or has not, a
// spot map: neither a seat nor a count may be guessed for it) | 'full' |
// 'waitlist' | 'book'.
// A studio is one of two kinds, by its has_layout flag ALONE: true → seats are
// chosen (a LIST response's studio record doesn't always carry the map itself,
// and _fetchTemplateDay replaces a richer cached record with it — the map is
// read later, from the class detail); false → `count`: booked by a COUNT of
// spaces, no spot to choose (CLAUDE.md "No-layout studios").
// Also on the row: `seats` (what the entry asks for, 1–4, never above the
// event's own max_bookable_slots), `heldSeats` (seats / spaces held there now)
// and `canAdd` — a class already held with FEWER seats than asked, with room
// left: the sheet may offer the missing seat(s), and only those.
function _templatePlanRow(entry, events, ctx) {
  ctx = ctx || {};
  const row = { entry, date: ctx.date, state: 'nomatch', event: null, instructorChanged: false, clash: null,
    seats: _templateSeats(entry && entry.seats), heldSeats: 0, count: false, canAdd: false };
  if (!entry || (entry.eventTypeId == null && entry.instructorId == null)) return row;
  const tol = ctx.tol == null ? TEMPLATE_TOLERANCE_MIN : ctx.tol;
  const target = (Number(entry.hour) || 0) * 60 + (Number(entry.minute) || 0);
  const same = (a, b) => a != null && b != null && String(a) === String(b);
  const bookings = ctx.bookings || {};
  const cands = [];
  (events || []).forEach(e => {
    const w = _templateWall(e && e.start_at);
    if (!w || w.date !== ctx.date) return;
    if (ctx.now && (w.date < ctx.now.date || (w.date === ctx.now.date && w.min <= ctx.now.min))) return;
    if (entry.eventTypeId != null && !same(e.event_type_id, entry.eventTypeId)) return;
    const delta = Math.abs(w.min - target);
    if (delta > tol) return;
    cands.push({ e, delta, min: w.min, mine: entry.instructorId == null || same(e.instructor_id, entry.instructorId) });
  });
  cands.sort((a, b) => a.delta - b.delta || a.min - b.min || Number(a.e.id) - Number(b.e.id));
  const seatIn = c => { const h = bookings[String(c.e.id)]; return !!h && !h.waitlisted; };
  const pick = cands.find(seatIn) || cands.find(c => c.mine) || (entry.locationId != null ? cands[0] : null);
  if (!pick) return row;
  row.event = pick.e;
  row.instructorChanged = !pick.mine;
  row.seats = _templateSeats(entry.seats, pick.e.max_bookable_slots);
  const studio = (ctx.studios || {})[pick.e.studio_id];
  const known = !!studio && (studio.has_layout === true || studio.has_layout === false);
  row.count = known && studio.has_layout === false;
  const held = bookings[String(pick.e.id)];
  if (held) {
    row.state = held.waitlisted ? 'waitlisted' : 'booked';
    row.heldSeats = _templateSeatsHeld(held);
    row.canAdd = row.state === 'booked' && known && row.heldSeats < row.seats && !pick.e.is_fully_booked;
    return row;
  }
  try { row.clash = (typeof ctx.findClash === 'function' && ctx.findClash(pick.e)) || null; } catch (e) { row.clash = null; }
  if (row.clash && row.clash.kind === 'overlap') { row.state = 'clash'; return row; }
  if (!known) { row.state = 'nolayout'; return row; }
  if (pick.e.is_fully_booked) { row.state = pick.e.is_waitlistable ? 'waitlist' : 'full'; return row; }
  row.state = 'book';
  return row;
}

// "Save my usual week": the REAL seats (never waitlist places) held over the 7
// London days from today, as template entries, Monday first. `resolveLocationId`
// turns a cached class into a real location id (or null) — studio ids are a
// different id space and must never be stored as one. Each entry remembers how
// many seats were held (`seats`, 1–4; spaces count the same where a studio has
// no spot map) — it is what the sheet STARTS from, never what it books unseen.
function _templateFromSeats(bookings, cache, now, resolveLocationId) {
  const last = _templateAddDays(now.date, 6);
  const seen = {};
  const entries = [];
  Object.keys(bookings || {}).forEach(id => {
    const held = bookings[id];
    const evt = (cache || {})[id];
    if (!held || held.waitlisted || !evt) return;
    const w = _templateWall(evt.start_at);
    if (!w || w.date < now.date || w.date > last) return;
    const locId = typeof resolveLocationId === 'function' ? resolveLocationId(evt) : null;
    const entry = {
      dayOfWeek: _templateDow(w.date),
      hour: Math.floor(w.min / 60),
      minute: w.min % 60,
      locationId: locId == null ? null : locId,
      eventTypeId: evt.event_type_id != null ? evt.event_type_id : null,
      instructorId: evt.instructor_id != null ? evt.instructor_id : null,
      label: (evt._typeName || 'Class') + (evt._instrName ? ' · ' + evt._instrName : ''),
      locName: evt._locName || '',
      seats: Math.min(TEMPLATE_MAX_SEATS, _templateSeatsHeld(held)),
    };
    const key = [entry.dayOfWeek, w.min, entry.eventTypeId, entry.instructorId, entry.locationId].join('|');
    // The same slot twice is one entry — wearing the larger seat count.
    if (seen[key]) { seen[key].seats = Math.max(seen[key].seats, entry.seats); return; }
    seen[key] = entry;
    entries.push(entry);
  });
  return entries.sort((a, b) => ((a.dayOfWeek + 6) % 7) - ((b.dayOfWeek + 6) % 7) ||
    (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute));
}

// ONE advisory line when the ticked seats are more than Psycle's own numbers
// say are left — '' otherwise. NEVER a block: the member may know better, and
// Psycle's answer is the one that counts. Same restraint as the class sheet's
// _sheetPlanNote: a capped plan counts per BILLING PERIOD, so only seats in
// classes inside the period /profile is counting are weighed; an unlimited plan
// has nothing to run out of; with no plan, a credit balance when there is one.
// f: { items: [{ classMs, seats }], subscription, periodStartMs, periodEndMs,
//      creditsRemaining, periodWord ('month' | 'week' | 'period') }
function _templatePlanCaution(f) {
  f = f || {};
  const items = Array.isArray(f.items) ? f.items : [];
  const seatsOf = it => Math.max(0, Math.floor(Number(it && it.seats)) || 0);
  const words = n => n + ' ' + (n === 1 ? 'seat' : 'seats');
  const sub = f.subscription;
  if (sub && typeof sub === 'object') {
    const max = Number(sub.max_bookings);
    if (!(max > 0)) return '';
    const left = Math.max(0, Math.round(max - Math.max(0, Number(sub.bookings_made) || 0)));
    const inPeriod = it => !!it && it.classMs >= 0 && f.periodEndMs > 0 && it.classMs < f.periodEndMs &&
      !(f.periodStartMs > 0 && it.classMs < f.periodStartMs);
    const n = items.filter(inPeriod).reduce((sum, it) => sum + seatsOf(it), 0);
    if (n <= left) return '';
    return words(n) + ' this ' + (f.periodWord || 'period') + ' — your plan shows ' + (left === 0 ? 'none' : left) + ' left';
  }
  const credits = Math.floor(Number(f.creditsRemaining));
  if (!(credits > 0)) return '';
  const total = items.reduce((sum, it) => sum + seatsOf(it), 0);
  return total > credits ? words(total) + ' — you have ' + credits + ' ' + (credits === 1 ? 'credit' : 'credits') + ' left' : '';
}
// ── pure:template:end ──

// ── pure:template-spots:start ── (DOM-free; tests/suites/14a-usual-week-sheet.js evaluates this block)
// AN OPINION ON THE SPOTS — SHOWN, NEVER SILENT. The usual-week sheet prints
// what this answers BEFORE anything is booked, and the run books exactly those
// ids or nothing (bookWeeklyTemplate). In order:
//   the member's own pick (Change spot), while it is still free;
//   adding to a class already held → the free spot closest to the seat held;
//   the usual spot for this studio + instructor (psycle_bike_history), if free;
//   a PREFERRED spot (psycle_bike_prefs) that is free — the one nearest the usual;
//   the free spot closest to the usual one, by the layout's own coordinates;
//   the first free one (lowest id).
// Never a spot on the AVOID list while another is free. Further seats are the
// free spots closest to the first (ties → lower id).
// o: { slots (layout.slots: [{id,x,y}]), free: [ids], count, usual, prefer,
//      avoid, held: [ids already held there], keep: [the member's pick] }
// → { slots: [ids] — free, at most `count`; why: 'pick' | 'near-held' | 'usual'
//     | 'preferred' | 'near-usual' | 'first' | ''; usual, usualTaken (for
//     'near-usual'); heldNear; firstSkipped ('first' passed over a lower free
//     spot the member avoids); lost: [picked ids no longer free]; filled (seats
//     added by nearness); avoided (an avoided spot had to be used); short (how
//     many seats could not be found) }
function _spotSuggestion(o) {
  o = o || {};
  const num = v => ((typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) ? Number(v) : NaN);
  const ids = list => {
    const out = [];
    (Array.isArray(list) ? list : []).forEach(v => { const n = num(v); if (Number.isFinite(n) && out.indexOf(n) === -1) out.push(n); });
    return out;
  };
  const at = {};
  (Array.isArray(o.slots) ? o.slots : []).forEach(s => { const n = num(s && s.id); if (Number.isFinite(n)) at[n] = s; });
  const free = ids(o.free).sort((a, b) => a - b);
  const count = Math.max(1, Math.min(4, Math.floor(Number(o.count)) || 1));
  const avoid = ids(o.avoid), prefer = ids(o.prefer), held = ids(o.held), keep = ids(o.keep);
  const usual = Number.isFinite(num(o.usual)) ? num(o.usual) : null;
  const isFree = id => free.indexOf(id) !== -1;
  // The map's own geometry; a seat the map cannot place is "far", then by number.
  const dist = (a, b) => {
    const p = at[a], q = at[b];
    const placed = p && q && [p.x, p.y, q.x, q.y].every(v => typeof v === 'number' && isFinite(v));
    return placed ? (p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y) : 1e12 + Math.abs(a - b);
  };
  const nearest = (anchor, pool) => pool.slice().sort((a, b) => dist(anchor, a) - dist(anchor, b) || a - b)[0];

  const chosen = keep.filter(isFree).slice(0, count);
  const lost = keep.filter(id => !isFree(id));
  let why = chosen.length ? 'pick' : '';
  // What may still be taken: never an avoided spot while another is free.
  const pool = () => {
    const rest = free.filter(id => chosen.indexOf(id) === -1);
    const liked = rest.filter(id => avoid.indexOf(id) === -1);
    return liked.length ? liked : rest;
  };
  if (!chosen.length) {
    const first = pool();
    if (first.length) {
      const preferred = first.filter(id => prefer.indexOf(id) !== -1);
      let pick;
      if (held.length) { pick = nearest(held[0], first); why = 'near-held'; }
      else if (usual != null && first.indexOf(usual) !== -1) { pick = usual; why = 'usual'; }
      else if (preferred.length) { pick = (usual != null && at[usual]) ? nearest(usual, preferred) : preferred[0]; why = 'preferred'; }
      else if (usual != null && at[usual]) { pick = nearest(usual, first); why = 'near-usual'; }
      else { pick = first[0]; why = 'first'; }
      chosen.push(pick);
    }
  }
  // 'first' that passed over a lower-numbered free spot the member avoids is
  // not literally the first free one — the reason says which first it is.
  const firstSkipped = why === 'first' && chosen.length > 0 && free[0] !== chosen[0];
  const before = chosen.length;
  while (chosen.length && chosen.length < count) {
    const more = pool();
    if (!more.length) break;
    chosen.push(nearest(chosen[0], more));
  }
  return {
    slots: chosen, why,
    usual: why === 'near-usual' ? usual : null,
    usualTaken: why === 'near-usual' ? !isFree(usual) : false,
    heldNear: why === 'near-held' ? held[0] : null,
    firstSkipped,
    lost,
    filled: chosen.length - before,
    avoided: chosen.some(id => avoid.indexOf(id) !== -1),
    short: count - chosen.length,
  };
}

// …and WHY, in a few words. `labelOf(id)` → the number printed on the seat.
function _spotWhyText(s, labelOf) {
  s = s || {};
  const name = id => String(typeof labelOf === 'function' ? labelOf(id) : id);
  let text = s.why === 'pick' ? 'your pick'
    : s.why === 'usual' ? 'your usual'
    : s.why === 'preferred' ? 'one you prefer'
    : s.why === 'near-usual' ? 'closest to your usual — ' + name(s.usual) + (s.usualTaken ? ' is taken' : ' is one you avoid')
    : s.why === 'near-held' ? 'closest to ' + name(s.heldNear) + ', which you hold'
    : s.why === 'first' ? (s.firstSkipped ? "first free you don't avoid" : 'first free') : '';
  if (text && s.filled > 0) text += ', plus the closest free';
  if (text && s.avoided) text += ' (nothing else is free)';
  const lost = Array.isArray(s.lost) ? s.lost : [];
  const names = lost.map(name); // "4", "4 & 5", "4, 5 & 6" — as formatSlots lists seats
  if (lost.length) text = (names.length > 2 ? names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1] : names.join(' & ')) + (lost.length > 1 ? ' were' : ' was') + ' just taken' + (text ? ' — ' + text : '');
  return text;
}
// ── pure:template-spots:end ──

// Resolve a template's stored id (which may be a real location id OR a
// studio_id, since _eventCache only stores studio_id) into a location id
// suitable for the `/events?location=` query.
function _resolveTemplateLocationId(id) {
  if (id == null) return '';
  const sid = String(id);
  // Already a real location id?
  if (typeof locations !== 'undefined' && locations.some(l => String(l.id) === sid)) return sid;
  // Treat as a studio id and look up its location.
  const studio = (typeof _studioMap !== 'undefined') ? _studioMap[id] : null;
  if (studio && studio.location_id != null) return String(studio.location_id);
  return sid; // best effort
}

// ── pure:core:start ── (needs localDateStr, from the first pure:core block)
// Date of the given weekday (0=Sun..6=Sat) within the upcoming 7 days
// (today counts as day 0). Returns a YYYY-MM-DD string.
// No caller since the usual-week sheet replaced the old sweep; kept because
// tests/suites/facets-core.js pins it — delete the two together.
function _upcomingWeekdayDate(dayOfWeek, fromDate = new Date(), timeMinutes = null) {
  const today0 = new Date(fromDate);
  today0.setHours(0, 0, 0, 0);
  let diff = (Number(dayOfWeek) - today0.getDay() + 7) % 7;
  // Same weekday as today: if the template's class time has already passed,
  // the user means NEXT week's occurrence, not this morning's class.
  if (diff === 0 && timeMinutes != null) {
    const nowMin = fromDate.getHours() * 60 + fromDate.getMinutes();
    if (timeMinutes <= nowMin) diff = 7;
  }
  const target = new Date(today0);
  target.setDate(target.getDate() + diff);
  return localDateStr(target);
}
// ── pure:core:end ──

// A cached class → the real location id a template entry stores: through its
// studio, else by the location's display name. null when neither resolves
// (never the studio id — see _templateFromSeats).
function _templateLocationIdFor(evt) {
  const studio = evt && evt.studio_id != null ? _studioMap[evt.studio_id] : null;
  if (studio && studio.location_id != null) return studio.location_id;
  const name = String((evt && evt._locName) || '').toLowerCase();
  const loc = name && typeof locations !== 'undefined'
    ? locations.find(l => String(l.name || '').replace('Psycle ', '').toLowerCase() === name) : null;
  return loc ? loc.id : null;
}

// Headlessly book a single resolved event the way rebookNextWeek does —
// a detached button drives bookClass(), but we never pop the bike picker:
// no-layout → submitBooking; layout → auto-pick usual/first available slot.
// Returns 'booked' | 'waitlisted' | 'skipped' | 'failed'.
async function _bookEventHeadless(eventId, studioId) {
  const btn = document.createElement('button');
  btn.className = 'book-btn';
  btn.textContent = 'Book';

  try {
    const res = await apiFetch(`/events/${eventId}`);
    if (!res.ok) return 'failed';
    const detail = await res.json();
    const availableSlotIds = new Set((detail.slots || []).map(Number));
    const evtData = detail.data || {};
    const cached = _eventCache[String(eventId)] || {};
    const isFullyBooked = evtData.is_fully_booked ?? cached.is_fully_booked;
    const isWaitlistable = evtData.is_waitlistable ?? cached.is_waitlistable;

    // This path spends credits with no confirm, so a HARD overlap with a seat
    // already held is skipped — before a waitlist join too (Psycle turns a
    // place into a chargeable seat by itself). A tight change between two
    // locations is the member's own template and stays bookable. Advisory
    // lookup: if reading the cache throws, book exactly as before.
    let clash = null;
    try { clash = _clashFor(eventId, evtData); } catch (e) {}
    if (clash && clash.kind === 'overlap') {
      console.info('[psycle] headless book skipped:', eventId, _clashLabel(clash));
      return 'skipped';
    }

    const studio = _studioMap[studioId];
    let layout = studio?.layout;
    // As bookClass: "Book my week" gets here straight after fetchDay's render()
    // replaced the studio record with a LIST response's — has_layout, no seat
    // map — so this path always saw a seat studio as map-less and POSTed with
    // no slots ("Booking slot required": every such entry counted as failed).
    // The detail just read carries the map. (typeof: the suites slice this
    // function on its own.)
    if (studio?.has_layout && !(layout?.slots?.length > 0) && typeof _layoutFromEventDetail === 'function') {
      layout = _layoutFromEventDetail(detail, studioId);
      if (layout) studio.layout = layout;
    }
    const hasLayout = studio?.has_layout && layout?.slots?.length > 0;

    const noSeatsLeft = isFullyBooked || (hasLayout && availableSlotIds.size === 0);
    if (noSeatsLeft) {
      if (_myBookings[String(eventId)]?.waitlisted) return 'skipped'; // already hold a place
      if (!isWaitlistable) return 'failed';
      const joined = await joinWaitlist(eventId, btn, { quiet: true });
      return joined ? 'waitlisted' : 'failed';
    }

    // A seat studio and still no map: there is no seat to name, and Psycle
    // turns a slot-less body down. After the block above — a FULL class needs
    // no map to join its waitlist.
    if (!hasLayout && studio?.has_layout) return 'failed';

    if (hasLayout) {
      // Auto-pick: the user's usual slot if it's free, else the first available.
      const usual = _usualSlotForEvent(eventId);
      let pick = (usual != null && availableSlotIds.has(Number(usual))) ? Number(usual) : null;
      if (pick == null) pick = [...availableSlotIds][0];
      if (pick == null) return 'failed';
      await submitBooking(eventId, [pick], btn);
    } else {
      await submitBooking(eventId, null, btn, studio && studio.has_layout === false ? { spaces: 1 } : {});
    }
    // The ✓ label contract plus a seat in state — never the CSS class alone
    // (the optimistic wrapper sets .booked BEFORE the POST is answered).
    const held = _myBookings[String(eventId)];
    return (btn.textContent.indexOf('✓') !== -1 && held && !held.waitlisted) ? 'booked' : 'failed';
  } catch (e) {
    console.warn('[psycle] headless book failed:', eventId, e);
    return 'failed';
  }
}

// Psycle's own words for a booking it refused — what submitBooking has just
// toasted (toast() writes #toast synchronously, and nothing else can run
// between that and the line that reads this). '' when there is none to read.
function _templateRefusalText() {
  try {
    const el = document.getElementById('toast');
    const text = (el && /\berror\b/.test(String(el.className || ''))) ? String(el.textContent || '').trim() : '';
    return text.length > 200 ? text.slice(0, 200) + '…' : text;
  } catch (e) { return ''; }
}

// ONE class the member ticked in the "usual week" sheet — booked EXACTLY as the
// sheet showed it, in ONE POST, or not at all. `want` is what was shown:
//   { slots: [ids] }   a seat studio: these spots and no others. If any of them
//                      is no longer free by now, NOTHING is sent ('taken', the
//                      ids on want.gone) — never a substitute: the member
//                      approved specific spots, and the sheet offers "Choose
//                      again" afterwards;
//   { spaces: n }      a studio POSITIVELY known to have no spot map
//                      (has_layout === false): a COUNT body, as bookClass sends
//                      — never a guessed count, never retried;
//   { joinOnly: true } a ticked waitlist row: it only asks "still full?" —
//                      'full' lets the caller join; a spot that has opened up
//                      is 'opened' and left for the member to choose (no spot
//                      was shown for it, so none is booked).
// A class that filled up after the sheet was shown comes back 'full' — not as a
// place Psycle can turn into a charge nobody agreed to (the caller joins only
// where that box was ticked). Holding the button is the only way to read
// submitBooking's label contract, which is where "that seat was just taken"
// (this class's problem) differs from "couldn't confirm" (the next POST could
// land twice). "Failed — retry" is two things: a POST that may still land is
// held in _unverifiedBookings ('failed' — the run stops); otherwise Psycle
// answered cleanly and said no ('refused', its words on want.said).
// A ✓ is NOT "this POST landed": the label contract only says /bookings shows a
// seat in the class — and for a class ALREADY held (the sheet's "1 of 2 seats
// held" top-up) the seat held before earns it, whatever became of this POST.
// So 'booked' also needs the booking to have GROWN by what was shown (these
// spots, newly held; or more spaces than before), and a ✓ over a POST that is
// still unverified (a lost / 5xx answer: the extra seat MAY still land) is
// 'unconfirmed' — the run stops. A ✓ with nothing new and nothing pending is
// the 409: 'taken' for shown spots, 'refused' for a count.
// Resolves 'booked' | 'partial' (a seat landed, not all that was shown) |
// 'full' | 'opened' | 'clash' | 'nolayout' | 'stale' (nothing was shown for it,
// or Psycle now allows fewer seats) | 'taken' | 'refused' | 'queued' |
// 'unconfirmed' | 'failed'.
async function _bookTemplateSeat(eventId, studioId, want) {
  const btn = document.createElement('button');
  btn.className = 'book-btn';
  btn.textContent = 'Book';
  want = want || {};
  // Bounded again here, whatever the sheet built.
  const slots = _templatePickSlots(want.slots);
  const spaces = want.spaces == null ? 0 : _templateSeats(want.spaces);

  try {
    const res = await apiFetch(`/events/${eventId}`);
    if (!res.ok) return 'failed';
    const detail = await res.json();
    const availableSlotIds = new Set((detail.slots || []).map(Number));
    const evtData = detail.data || {};
    const cached = _eventCache[String(eventId)] || {};

    // A class booked earlier in this same run can overlap this one.
    let clash = null;
    try { clash = _clashFor(eventId, evtData); } catch (e) {}
    if (clash && clash.kind === 'overlap') return 'clash';

    const studio = _studioMap[studioId];
    // Neither kind of studio, positively: neither a seat nor a count is guessed.
    if (!(studio && (studio.has_layout === true || studio.has_layout === false))) return 'nolayout';
    const isFull = !!(evtData.is_fully_booked ?? cached.is_fully_booked);
    if (want.joinOnly) {
      // Before the map: a FULL class needs none to be reported (or joined).
      if (isFull || (studio.has_layout === true && availableSlotIds.size === 0)) return 'full';
      return 'opened';
    }
    if (isFull) return 'full';
    // Psycle's own limit on seats per booking, when the class says it: what was
    // shown no longer fits → nothing is sent (never silently fewer).
    const cap = Number(evtData.max_bookable_slots ?? cached.max_bookable_slots);
    const over = n => Number.isInteger(cap) && cap >= 1 && n > cap;
    // What is held going in (read NOW: the optimistic wrapper rewrites the
    // entry before the POST is answered) — see the ✓ rule above.
    const heldBefore = _myBookings[String(eventId)];
    const seatsBefore = _templateSeatsHeld(heldBefore);
    const slotsBefore = ((heldBefore && !heldBefore.waitlisted && Array.isArray(heldBefore.slots)) ? heldBefore.slots : []).map(Number);

    if (studio.has_layout === false) {
      // COUNT body — for a studio positively known to have no spot map ONLY.
      if (!spaces || slots.length || over(spaces)) return 'stale';
      await submitBooking(eventId, null, btn, { spaces });
    } else {
      // As bookClass: the plan's own _fetchTemplateDay has just replaced the
      // studio record with a LIST response's — has_layout, not always the seat
      // map. The detail just read carries it. (typeof: the suite slices this
      // function on its own.)
      let layout = studio.layout;
      if (!(layout?.slots?.length > 0) && typeof _layoutFromEventDetail === 'function') {
        layout = _layoutFromEventDetail(detail, studioId);
        if (layout) studio.layout = layout;
      }
      // Still no map: this class only. Never 'failed' — that stops the whole run
      // and blames Psycle for a booking that was never sent.
      if (!(layout?.slots?.length > 0)) return 'nolayout';
      if (availableSlotIds.size === 0) return 'full';
      // NO auto-pick: with no spot shown there is nothing the member agreed to.
      if (!slots.length || spaces || over(slots.length)) return 'stale';
      const gone = slots.filter(s => !availableSlotIds.has(s));
      if (gone.length) { want.gone = gone; return 'taken'; }
      await submitBooking(eventId, slots, btn);
    }
    // The ✓ label contract plus a seat in state — never the CSS class alone.
    const held = _myBookings[String(eventId)];
    const label = String(btn.textContent || '');
    if (label.indexOf('✓') !== -1) {
      if (!(held && !held.waitlisted)) return 'failed';
      // The seat held BEFORE can wear the ✓ while this POST is still unverified
      // (_settleUnverifiedBooking's 'partial'): an answer that cannot be trusted
      // stops the run. (typeof: the suites slice this function on its own.)
      if (typeof _unverifiedBookings !== 'undefined' && _unverifiedBookings[String(eventId)]) return 'unconfirmed';
      if (slots.length) {
        // Every spot that was shown, NEWLY held — or it is not what the member agreed to.
        const have = (held.slots || []).map(Number);
        const landed = slots.filter(s => have.includes(s) && !slotsBefore.includes(s));
        if (landed.length === slots.length) return 'booked';
        // Some of them — or a seat nobody showed (an earlier POST for this class
        // that turned out to have landed): the booking changed, and not as agreed.
        if (landed.length || have.some(s => !slotsBefore.includes(s))) return 'partial';
        // Nothing new at all (a 409: the spot went between the GET and the POST,
        // and the ✓ is the seat held before): that class only, and "Choose again".
        want.gone = slots.filter(s => !have.includes(s));
        return 'taken';
      }
      // A COUNT body leaves no spot to look for: the spaces held must have grown.
      if (_templateSeatsHeld(held) > seatsBefore) return 'booked';
      // Not grown, nothing pending: Psycle added nothing (a 409) — or a clean 2xx
      // whose body named no record, which reads the same from here. /bookings
      // says which; if it cannot, neither can we ("when in doubt, stop").
      if (typeof _rereadBookingsForVerify !== 'function' || !(await _rereadBookingsForVerify())) return 'unconfirmed';
      if (_templateSeatsHeld(_myBookings[String(eventId)]) > seatsBefore) return 'booked';
      want.said = typeof _templateRefusalText === 'function' ? _templateRefusalText() : '';
      return 'refused';
    }
    // No ✓: submitBooking's own failure labels. 'Book' = a refusal that re-read
    // as "someone else holds it" (or a 401 — the caller checks the session).
    if (label === 'Book') { want.gone = slots.slice(); return 'taken'; }
    if (label === 'Queued') return 'queued';
    if (label.indexOf('Unconfirmed') === 0) return 'unconfirmed';
    // "Failed — retry": still pending (a lost / 5xx answer that MAY have booked)
    // → the run stops. Not pending → Psycle said no, cleanly. Can't tell → stop.
    const pending = typeof _unverifiedBookings === 'undefined' ? true : !!_unverifiedBookings[String(eventId)];
    if (label.indexOf('Failed') !== 0 || pending) {
      // What submitBooking has just toasted — Psycle's reason when its 5xx gave
      // one, else "…isn't showing in My Bookings — try again". The sheet prints
      // it on the row: by the time the run's summary is read the toast has
      // faded, and "see its message" pointed at nothing.
      if (label.indexOf('Failed') === 0 && typeof _templateRefusalText === 'function') want.told = _templateRefusalText();
      return 'failed';
    }
    want.said = typeof _templateRefusalText === 'function' ? _templateRefusalText() : '';
    return 'refused';
  } catch (e) {
    console.warn('[psycle] template seat failed:', eventId, e);
    return 'failed';
  }
}

// Executes what the member confirmed in the "usual week" sheet — and only that.
// `picks`, built from planWeeklyTemplate's rows and what the sheet SHOWED:
//   { eventId, studioId,
//     slots: [ids]   the spots shown for a seat studio — ONE POST with exactly
//                    these (see _bookTemplateSeat: if one has gone, nothing),
//     spaces: n      …or the count shown for a studio with no spot map,
//     held: n        seats the sheet showed as already held there (0: none). A
//                    pick for a held class is its "1 of 2 seats held" top-up —
//                    sent only while the booking still reads as it was shown,
//     joinIfFull     a ticked waitlist row (no slots: there was none to show),
//     mayBeClosed }  the class lies past what Psycle has opened (advisory —
//                    pure:horizon): a clean refusal there is the expected
//                    answer, shown in Psycle's words, and the run carries on.
// There is deliberately NO "book the whole template" default: with no picks
// nothing happens, so no call can spend a credit on a class that was not
// listed (with its state and its spots) and ticked. A waitlist is joined only
// for a pick whose box was ticked (joinIfFull) and only while the class is
// still full. `hooks`: { onProgress(i, result), shouldStop() }.
// Resolves to { booked, waitlisted, failed, skipped, stopped, results }:
// results[i] is { eventId, result, gone?, said?, told? } (told: what was
// toasted for a 'failed' whose POST may still land); result is 'booked' |
// 'waitlisted' | 'already' | 'clash' | 'full' | 'opened' | 'nolayout' | 'stale'
// | 'taken' | 'refused' | 'partial' | 'joinfailed' | 'queued' | 'unconfirmed'
// (a seat OR a waitlist join Psycle may have taken) | 'failed' | 'notrun';
// stopped is '' or why the run ended early ('auth' | 'bookings' | 'offline' |
// 'failed' | 'user').
let _templateBookingInFlight = false;
async function bookWeeklyTemplate(picks, hooks) {
  const counts = { booked: 0, waitlisted: 0, failed: 0, skipped: 0 };
  // Re-entrancy guard: a double tap on "Book my week" must not run two
  // concurrent sweeps (both would pass the already-booked checks and
  // double-book every entry).
  if (_templateBookingInFlight) return counts;
  _templateBookingInFlight = true;
  try {
    return await _bookWeeklyTemplateInner(counts, picks, hooks);
  } finally {
    _templateBookingInFlight = false;
  }
}

async function _bookWeeklyTemplateInner(counts, picks, hooks) {
  picks = Array.isArray(picks) ? picks.filter(p => p && p.eventId != null) : [];
  hooks = hooks || {};
  counts.stopped = '';
  counts.results = picks.map(p => ({ eventId: p.eventId, result: 'notrun' }));
  if (!picks.length) return counts;
  if (!currentUser) { counts.failed = picks.length; counts.stopped = 'auth'; return counts; }
  // The "already booked" skip below reads _myBookings. With no /bookings
  // snapshot applied yet (as bookClass) every class looks unbooked, and the
  // run would book — and charge — each class already held a second time.
  if (_bookingsLoadState !== 'loaded' && !(await _rereadBookingsForVerify())) { counts.failed = picks.length; counts.stopped = 'bookings'; return counts; }

  // SEQUENTIAL: each POST is settled (and _myBookings updated) before the next
  // starts, so a refusal can stop the run and a later class sees the seats
  // this run already took (clash, already booked).
  for (let i = 0; i < picks.length; i++) {
    const p = picks[i];
    if (typeof hooks.shouldStop === 'function' && hooks.shouldStop()) { counts.stopped = 'user'; break; }
    // Offline, submitBooking's wrapper would QUEUE the booking for later —
    // a spend at a time nobody chose.
    if (!navigator.onLine) { counts.stopped = 'offline'; break; }
    try { if (typeof hooks.onProgress === 'function') hooks.onProgress(i, 'running'); } catch (e) {}

    let result = 'failed';
    // What the sheet showed for this class — and what _bookTemplateSeat hands
    // back on it (`gone`: the shown spots that went; `said`: Psycle's refusal).
    const want = p.joinIfFull ? { joinOnly: true } : { slots: p.slots, spaces: p.spaces };
    try {
      // The sheet may be minutes old: never re-book what is held by now. A pick
      // for a class that WAS held is its top-up ("1 of 2 seats held"), and goes
      // out only while the booking still reads as the sheet showed it.
      const heldNow = _myBookings[String(p.eventId)];
      const shownHeld = Math.max(0, Math.floor(Number(p.held)) || 0);
      if (heldNow && (heldNow.waitlisted || !shownHeld || _templateSeatsHeld(heldNow) !== shownHeld)) result = 'already';
      else if (!heldNow && shownHeld) result = 'stale'; // it was cancelled meanwhile: not the booking that was shown
      else {
        result = await _bookTemplateSeat(p.eventId, p.studioId, want);
        // Still full AND its waitlist box was ticked: the one place a join is
        // allowed. quiet — the sheet reports it, not a slide-up.
        if (result === 'full' && p.joinIfFull) {
          // false is "Psycle said no" and "couldn't tell" alike — the second
          // (flagged on the opts) may be a place, i.e. a charge to come: never
          // reported as "couldn't be joined".
          const joinOpts = { quiet: true };
          const joined = await joinWaitlist(p.eventId, null, joinOpts);
          result = joined ? 'waitlisted' : (joinOpts.unsure ? 'unconfirmed' : 'joinfailed');
        }
      }
    } catch (e) {
      console.warn('[psycle] template pick failed:', p, e);
    }
    // The sheet reports every class itself; a slide-up per booking would stack over it.
    try { dismissBookingConfirmation(); } catch (e) {}

    counts.results[i].result = result;
    if (want.gone && want.gone.length) counts.results[i].gone = want.gone.slice();
    if (want.said) counts.results[i].said = want.said;
    if (want.told) counts.results[i].told = want.told;
    if (result === 'booked') counts.booked++;
    else if (result === 'waitlisted') counts.waitlisted++;
    else if (result === 'already' || result === 'clash' || result === 'full' || result === 'opened' || result === 'nolayout' || result === 'stale') counts.skipped++;
    else counts.failed++;
    try { if (typeof hooks.onProgress === 'function') hooks.onProgress(i, result, counts.results[i]); } catch (e) {}

    // Session gone (a 401 anywhere expires it): nothing after this can book.
    if (!currentUser || !getBearerToken()) { counts.stopped = 'auth'; break; }
    if (result === 'queued') { counts.stopped = 'offline'; break; }
    // Psycle refused a seat (no credits, plan doesn't cover it) or its answer
    // can't be trusted: stop rather than send the next POST into the same
    // wall. 'taken' and 'joinfailed' are that class's problem only — and so is a
    // clean refusal of a class past what Psycle has opened (mayBeClosed): that
    // "not yet" was the expected answer, and says nothing about the next class.
    if (result === 'failed' || result === 'unconfirmed' || result === 'partial' ||
        (result === 'refused' && !p.mayBeClosed)) { counts.stopped = 'failed'; break; }
  }

  if (typeof fetchMyBookings === 'function') { try { await fetchMyBookings(); } catch {} }
  return counts;
}

// One day's /events at one location, shared between entries through `dayCache`.
// Fills _eventCache / _studioMap as a search does (the booking step, the clash
// check and the sheet's labels all read them). Resolves null — not [] — when
// the day could not be read, so "no class that day" is never a guess.
function _fetchTemplateDay(dayStr, locId, dayCache) {
  const key = dayStr + '|' + locId;
  if (dayCache[key]) return dayCache[key];
  const p = (async () => {
    const params = new URLSearchParams({
      start: dayStr + ' 00:00:00',
      end: dayStr + ' 23:59:59',
      limit: 200,
    });
    // An entry with no location (detected from history) reads the whole day.
    if (locId !== '') params.set('location', locId);
    const res = await apiFetch('/events?' + params);
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    // Cache event metadata so headless booking + state stay consistent.
    const rel = data.relations || {};
    const studioMap = Object.fromEntries((rel.studios || []).map(s => [s.id, s]));
    const instrMap = Object.fromEntries((rel.instructors || []).map(i => [i.id, i]));
    const locationMap = Object.fromEntries((rel.locations || []).map(l => [l.id, l]));
    const typeMap = Object.fromEntries((rel.event_types || []).map(t => [t.id, t]));
    Object.assign(_studioMap, studioMap);
    (data.data || []).forEach(e => {
      // Overwrite, never insert-only — keeps availability fields fresh.
      const studio = studioMap[e.studio_id];
      const loc = studio ? locationMap[studio.location_id] : null;
      _eventCache[String(e.id)] = {
        ...e,
        _typeName: typeMap[e.event_type_id]?.name || 'Class',
        _instrName: instrMap[e.instructor_id]?.full_name || '',
        _locName: loc ? loc.name.replace('Psycle ', '') : '',
        _locFullName: loc ? loc.name : '',
        _locAddress: loc ? (loc.address || '') : '',
        _studioName: studio ? studio.name : '',
      };
    });
    return data.data || [];
  })().catch(() => null);
  dayCache[key] = p;
  return p;
}

// READ-ONLY plan for "Book my usual week": every template entry resolved to a
// real upcoming class and what a tap would do about it, so the confirm sheet
// can list exactly that before anything is spent. GETs only (/events per day +
// location, /bookings when no snapshot is loaded) — nothing is booked, joined
// or cancelled here. `weekStart` ('YYYY-MM-DD') is the first of the 7 days —
// any day: a Monday–Sunday week, the 7 days from today, or the Friday →
// Thursday batch a release opened. Without one the plan picks the range itself
// (_templateDefaultStart — once the bookings it judges by are loaded).
// `opts.newest`: offer the newly opened batch first (the Monday reminder's tap).
// Resolves { ok, reason, mode, weekStart, weekEnd, rows, ranges, rangeId,
// horizon }. reason (when !ok): 'empty' | 'signedout' | 'offline' | 'bookings'.
// ranges: what the sheet's date control offers (_templateRanges); rangeId: the
// one this plan is for ('' for a start that is none of them); horizon:
// _bookingHorizon() or null. rows[i]: { index, entry, date, state, eventId,
// studioId, startAt, typeName, instrName, locName, instructorChanged,
// clashLine, seats, heldSeats, count, canAdd, maxSeats, beyondOpen,
// beyondListed } — state, seats, heldSeats, count and canAdd as
// _templatePlanRow (state also 'error' when that day's timetable could not be
// read); maxSeats: the class's own max_bookable_slots when it says one;
// beyondOpen: the class lies past what Psycle has opened by the observed model
// — ADVISORY, the row stays tickable; beyondListed: the DAY lies past what the
// timetable lists by the same model (every Monday before 12:00, the Fri–Sun of
// the third week) — advisory too: it only lets a 'nomatch' there say "not on
// the timetable yet" instead of "no matching class".
async function planWeeklyTemplate(weekStart, opts) {
  opts = opts || {};
  const nowMs = Date.now();
  const now = _templateLondonNow(nowMs);
  let horizon = null;
  try { horizon = typeof _bookingHorizon === 'function' ? _bookingHorizon(nowMs) : null; } catch (e) {}
  const ranges = _templateRanges(nowMs, horizon, opts.newest === true);
  const custom = /^\d{4}-\d{2}-\d{2}$/.test(String(weekStart || ''));
  const plan = {
    ok: false, reason: '', rows: [], mode: '', ranges, rangeId: '', horizon,
    weekStart: custom ? String(weekStart) : ranges[0].start, weekEnd: '',
  };
  const settle = (start, mode) => {
    plan.weekStart = start;
    plan.weekEnd = _templateAddDays(start, 6);
    plan.mode = mode;
    plan.rangeId = (ranges.find(r => r.start === start) || { id: '' }).id;
  };
  settle(plan.weekStart, plan.weekStart === now.date ? 'next7' : 'nextweek');
  const template = loadWeeklyTemplate();
  if (!template.length) { plan.reason = 'empty'; return plan; }
  if (!currentUser || !getBearerToken()) { plan.reason = 'signedout'; return plan; }
  if (!navigator.onLine) { plan.reason = 'offline'; return plan; }
  // 'booked' / 'clash' are read off _myBookings: over an unloaded map every
  // class the member already holds would be offered again.
  if (_bookingsLoadState !== 'loaded' && !(await _rereadBookingsForVerify())) { plan.reason = 'bookings'; return plan; }
  // The range is chosen only now: "the first one with a usual class not yet
  // held" is read off the bookings just made sure of.
  if (!custom) {
    const def = _templateDefaultStart(nowMs, { ranges, template, bookings: _myBookings, cache: _eventCache });
    settle(def.start, def.mode);
  }
  const start = plan.weekStart;

  const dayCache = {};
  plan.rows = await Promise.all(template.map(async (entry, index) => {
    const date = _templateDateFor(entry, start, now);
    let row;
    try {
      const events = await _fetchTemplateDay(date, _resolveTemplateLocationId(entry.locationId), dayCache);
      row = events === null
        ? { entry, date, state: 'error', event: null, instructorChanged: false, clash: null }
        : _templatePlanRow(entry, events, {
          date, now, bookings: _myBookings, studios: _studioMap,
          // The cached copy carries _locName (the travel-squeeze half of a clash).
          findClash: e => _findClash(_eventCache[String(e.id)] || e, _myBookings, _eventCache),
        });
    } catch (e) {
      console.warn('[psycle] template plan failed:', entry, e);
      row = { entry, date, state: 'error', event: null, instructorChanged: false, clash: null };
    }
    const evt = row.event;
    const cached = (evt && _eventCache[String(evt.id)]) || {};
    const cap = evt ? Number(evt.max_bookable_slots) : NaN;
    return {
      index, entry, date: row.date, state: row.state,
      eventId: evt ? evt.id : null,
      studioId: evt ? evt.studio_id : null,
      startAt: evt ? evt.start_at : null,
      typeName: cached._typeName || '',
      instrName: cached._instrName || '',
      locName: cached._locName || entry.locName || '',
      instructorChanged: !!row.instructorChanged,
      clashLine: row.clash ? _clashLabel(row.clash) : '',
      // Coerced again where it is read: the 'error' rows above never met _templatePlanRow.
      seats: _templateSeats(row.seats == null ? (entry && entry.seats) : row.seats, cap),
      heldSeats: Math.max(0, Number(row.heldSeats) || 0),
      count: row.count === true,
      canAdd: row.canAdd === true,
      maxSeats: (Number.isInteger(cap) && cap >= 1) ? Math.min(cap, TEMPLATE_MAX_SEATS) : null,
      beyondOpen: !!(horizon && horizon.openThrough && row.date > horizon.openThrough),
      beyondListed: !!(horizon && horizon.listedThrough && row.date > horizon.listedThrough),
    };
  }));
  plan.ok = true;
  return plan;
}

// Analyse psycle_class_history for day-of-week + time + type slots booked
// 2+ times; return candidate template entries (same shape). Names in history
// are resolved back to numeric IDs via the loaded instructors/eventTypes.
function detectRecurringSlots() {
  let history = [];
  try { history = JSON.parse(localStorage.getItem('psycle_class_history') || '[]'); } catch { return []; }
  // Coerced where it is read (pure:stored-data), like every other history reader.
  if (typeof _cleanStoredHistory === 'function') history = _cleanStoredHistory(history);
  if (!Array.isArray(history) || !history.length) return [];

  const typeByName = {};
  if (typeof eventTypes !== 'undefined') {
    eventTypes.forEach(t => { if (t.name) typeByName[t.name.toLowerCase()] = t.id; });
  }
  const instrByName = {};
  if (typeof instructors !== 'undefined') {
    instructors.forEach(i => { if (i.full_name) instrByName[i.full_name.toLowerCase()] = i.id; });
  }
  // History carries the location's display name ("Bank"), not its id.
  const locByName = {};
  if (typeof locations !== 'undefined') {
    locations.forEach(l => { if (l.name) locByName[l.name.replace('Psycle ', '').toLowerCase()] = l.id; });
  }

  // Bucket by day-of-week + rounded half-hour + type name.
  const buckets = {};
  history.forEach(h => {
    if (!h || h.cancelledAt || !h.date) return;
    const dt = new Date(String(h.date).replace(' ', 'T'));
    if (isNaN(dt.getTime())) return;
    const dow = dt.getDay();
    const mins = dt.getHours() * 60 + dt.getMinutes();
    const halfHour = Math.round(mins / 30) * 30; // cluster nearby times
    const typeName = h.typeName || 'Class';
    const key = dow + '|' + halfHour + '|' + typeName.toLowerCase();
    if (!buckets[key]) {
      buckets[key] = { dow, mins: [], typeName, instrName: h.instrName || '', locs: {}, count: 0 };
    }
    buckets[key].count++;
    buckets[key].mins.push(mins);
    if (h.locName) buckets[key].locs[h.locName] = (buckets[key].locs[h.locName] || 0) + 1;
  });

  const candidates = [];
  Object.values(buckets).forEach(b => {
    if (b.count < 2) return; // recurring = booked 2+ times
    const avg = Math.round(b.mins.reduce((a, c) => a + c, 0) / b.mins.length);
    const hour = Math.floor(avg / 60), minute = avg % 60;
    // Where this slot was usually ridden — the timetable is read per location.
    const locName = Object.keys(b.locs).sort((x, y) => b.locs[y] - b.locs[x])[0] || '';
    candidates.push({
      dayOfWeek: b.dow,
      hour,
      minute,
      locationId: locByName[locName.toLowerCase()] ?? null,
      eventTypeId: typeByName[b.typeName.toLowerCase()] ?? null,
      instructorId: instrByName[(b.instrName || '').toLowerCase()] ?? null,
      label: b.typeName + (b.instrName ? ' · ' + b.instrName : ''),
      locName,
      _count: b.count,
    });
  });

  // Most-booked slots first.
  return candidates.sort((a, b) => (b._count || 0) - (a._count || 0));
}

// READ-ONLY: what the sheet needs to show its opinion on the spots of ONE
// planned class BEFORE anything is booked — a fresh GET /events/{id} (the read
// _bookTemplateSeat repeats when the row's turn comes) plus the member's own
// stored habits. Nothing is booked, joined or held here; the suggestion itself
// is pure (_spotSuggestion), so the sheet can re-run it when the seat count
// changes without reading again.
// Resolves { ok: false, reason: 'read' | 'studio' | 'nomap' } or
//   { ok: true, kind: 'count', full, max }                a studio with no spot map
//   { ok: true, kind: 'seats', full, max, layout, free, held, usual, prefer,
//     avoid, studioName, clashLine }                      a seat studio
// free / held / prefer / avoid are slot ids; `max` is the class's own
// max_bookable_slots (null when it says none).
async function templateSpotsFor(eventId, studioId) {
  try {
    const res = await apiFetch(`/events/${eventId}`);
    if (!res.ok) return { ok: false, reason: 'read' };
    const detail = await res.json();
    const evtData = (detail && detail.data) || {};
    const cached = _eventCache[String(eventId)] || {};
    const studio = _studioMap[studioId];
    // Neither kind, positively: neither a seat nor a count is guessed for it.
    if (!(studio && (studio.has_layout === true || studio.has_layout === false))) return { ok: false, reason: 'studio' };
    const cap = Number(evtData.max_bookable_slots ?? cached.max_bookable_slots);
    const max = (Number.isInteger(cap) && cap >= 1) ? Math.min(cap, TEMPLATE_MAX_SEATS) : null;
    const full = !!(evtData.is_fully_booked ?? cached.is_fully_booked);
    if (studio.has_layout === false) return { ok: true, kind: 'count', full, max };
    // As bookClass: a LIST response's studio record has no seat map; the detail has.
    let layout = studio.layout;
    if (!(layout?.slots?.length > 0)) {
      layout = _layoutFromEventDetail(detail, studioId);
      if (layout) studio.layout = layout;
    }
    if (!(layout?.slots?.length > 0)) return { ok: false, reason: 'nomap' };
    const free = (Array.isArray(detail.slots) ? detail.slots : []).map(Number).filter(n => Number.isFinite(n));
    const mine = _myBookings[String(eventId)];
    let prefs = {};
    try { prefs = _cleanStoredBikePrefs(JSON.parse(localStorage.getItem('psycle_bike_prefs') || '{}'))[String(studioId)] || {}; } catch (e) {}
    let clashLine = '';
    try { clashLine = _clashLabel(_clashFor(eventId, evtData, { includePlaces: true })); } catch (e) {}
    return {
      ok: true, kind: 'seats', full: full || free.length === 0, max, layout, free,
      held: (mine && !mine.waitlisted) ? (mine.slots || []).map(Number) : [],
      usual: _usualSlotForEvent(eventId),
      prefer: prefs.prefer || [], avoid: prefs.avoid || [],
      studioName: studio.name || '', clashLine,
    };
  } catch (e) {
    console.warn('[psycle] template spots failed:', eventId, e);
    return { ok: false, reason: 'read' };
  }
}

// The sheet's ONE advisory line about the plan (pure: _templatePlanCaution),
// fed with what /profile says — as the class sheet feeds _sheetPlanNote.
// `items`: [{ startAt, seats }] of the ticked classes. '' = nothing to say.
function templatePlanCaution(items) {
  try {
    const ms = d => (d && !isNaN(d.getTime()) ? d.getTime() : NaN);
    const sub = _activeSubscription || null;
    const startMs = sub ? ms(parsePsycleDate(sub.period_start)) : NaN;
    const endMs = sub ? ms(parsePsycleDate(sub.period_end)) : NaN;
    return _templatePlanCaution({
      items: (Array.isArray(items) ? items : []).map(it => ({ classMs: _gymClassStartMs(it && it.startAt), seats: it && it.seats })),
      subscription: sub, periodStartMs: startMs, periodEndMs: endMs,
      creditsRemaining: currentUser && currentUser.stats ? currentUser.stats.credits_remaining : NaN,
      periodWord: _mbPeriodWord(startMs, endMs),
    });
  } catch (e) { return ''; } // advisory: never in the way of the sheet
}

window.loadWeeklyTemplate = loadWeeklyTemplate;
window.saveWeeklyTemplate = saveWeeklyTemplate;
window.clearWeeklyTemplate = clearWeeklyTemplate;
window.planWeeklyTemplate = planWeeklyTemplate;
window.bookWeeklyTemplate = bookWeeklyTemplate;
window.templateSpotsFor = templateSpotsFor;
window.templatePlanCaution = templatePlanCaution;
window._bookingHorizon = _bookingHorizon; // wave 13's shared contract (the Monday reminder reads it too)
window.detectRecurringSlots = detectRecurringSlots;

// ════════════════════════════════════════════════════════════════
// Feature: Saved / Recent searches + presets
// 'psycle_recent_searches' = array (cap 5), deduped by a signature of
// instructors + locations + categories + date-mode + the Time row.
// ════════════════════════════════════════════════════════════════
const RECENT_SEARCHES_KEY = 'psycle_recent_searches';
const RECENT_SEARCHES_CAP = 5;

// Snapshot the live filter globals into a serialisable object.
function _currentSearchState() {
  return {
    instructors: [...selectedInstructors],
    locations: [...selectedLocations],
    categories: [...selectedCategories],
    strengthSubs: [...selectedStrengthSubs],
    reformerSubs: [...selectedReformerSubs],
    // The Time row filters the list like any chip: a pill that left it out
    // brought back a different list from the one it was saved from.
    timeBands: [...selectedTimeBands],
    availableOnly: _availableOnly,
    dateMode: _dateQuickMode || null,
    startDate: document.getElementById('startDate')?.value || '',
    daysAhead: document.getElementById('daysAhead')?.value || '6',
  };
}

// ── pure:core:start ──
// Order-independent signature for dedup: sorted ids + sorted categories +
// date mode (or explicit start date when no quick mode is active).
function _searchSignature(s) {
  const instr = [...(s.instructors || [])].map(String).sort().join(',');
  const locs = [...(s.locations || [])].map(String).sort().join(',');
  const cats = [...(s.categories || [])].map(String).sort().join(',');
  const date = s.dateMode || ('date:' + (s.startDate || '') + '+' + (s.daysAhead || ''));
  // The Time row: an entry saved before it existed reads as "row off".
  const bands = [...(s.timeBands || [])].map(String).sort().join(',');
  return ['i:' + instr, 'l:' + locs, 'c:' + cats, 'd:' + date, 't:' + bands, 'a:' + (s.availableOnly === true ? 1 : 0)].join('|');
}
// ── pure:core:end ──

// Human label for a saved/recent search pill.
function _searchLabel(s) {
  const parts = [];
  const modeLabels = { today: 'Today', tomorrow: 'Tomorrow', week: '7 days', nextweek: 'Next week', '2week': '14 days' };
  if (s.dateMode && modeLabels[s.dateMode]) parts.push(modeLabels[s.dateMode]);
  else if (s.startDate) {
    const [y, m, d] = s.startDate.split('-').map(Number);
    if (y && m && d) parts.push(new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
  }
  if ((s.locations || []).length === 1 && typeof locations !== 'undefined') {
    const l = locations.find(x => String(x.id) === String(s.locations[0]));
    if (l) parts.push(l.name.replace('Psycle ', ''));
  } else if ((s.locations || []).length > 1) parts.push(s.locations.length + ' studios');
  if ((s.instructors || []).length === 1 && typeof instructors !== 'undefined') {
    const i = instructors.find(x => String(x.id) === String(s.instructors[0]));
    if (i) parts.push(i.full_name.split(' ')[0]);
  } else if ((s.instructors || []).length > 1) parts.push(s.instructors.length + ' instructors');
  if ((s.categories || []).length) {
    parts.push(s.categories.map(k => {
      const c = CATEGORY_MAP.find(c => c.key === k);
      return c ? c.label : k;
    }).join(' · '));
  }
  // Named as the Time row's own pills name them: two pills that differ only
  // there must not read the same.
  const bandNames = TIME_BANDS.filter(b => (s.timeBands || []).includes(b.key)).map(b => b.label);
  if (s.availableOnly === true) bandNames.push('Available only');
  if (bandNames.length) parts.push(bandNames.join(' · '));
  return parts.length ? parts.join(' · ') : 'All classes';
}

function getRecentSearches() {
  try {
    const arr = JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || '[]');
    if (!Array.isArray(arr)) return [];
    // Stored ids become filter chips (applySavedSearch): coerced where read.
    return arr.filter(s => s && typeof s === 'object' && !Array.isArray(s)).map(s => Object.assign({}, s, {
      instructors: _cleanStoredIdList(s.instructors, 200),
      locations: _cleanStoredIdList(s.locations, 200),
    }));
  } catch { return []; }
}

function _recordRecentSearch() {
  // Skip empty searches (no filters, default date) — they aren't worth saving.
  const state = _currentSearchState();
  const sig = _searchSignature(state);
  let list = getRecentSearches().filter(s => _searchSignature(s) !== sig);
  list.unshift({ ...state, signature: sig, ts: Date.now() });
  if (list.length > RECENT_SEARCHES_CAP) list = list.slice(0, RECENT_SEARCHES_CAP);
  try { localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list)); } catch {}
  renderDiscoverPresets();
}

// Built-in presets. Each has an apply() that sets the filter globals.
function getSearchPresets() {
  return [
    {
      key: 'tonight', label: 'Tonight', apply() {
        selectedInstructors.clear();
        selectedCategories.clear();
        selectedStrengthSubs.clear();
        ['UPPER', 'LOWER', 'FULL'].forEach(k => selectedStrengthSubs.add(k));
        selectedReformerSubs.clear();
        REFORMER_SUBS.forEach(s => selectedReformerSubs.add(s.key));
        // "Tonight" used to mean all of today, 6am classes included.
        selectedTimeBands.clear();
        selectedTimeBands.add('evening');
        _dateQuickMode = 'today';
        document.getElementById('startDate').value = localDateStr();
        document.getElementById('daysAhead').value = 1;
        document.querySelectorAll('.date-quick-btn').forEach(b => {
          b.classList.toggle('active', b.textContent.trim() === 'Today');
        });
      },
    },
    {
      key: 'strength', label: 'Strength', apply() {
        selectedCategories.clear();
        selectedCategories.add('STRENGTH');
        selectedStrengthSubs.clear();
        ['UPPER', 'LOWER', 'FULL'].forEach(k => selectedStrengthSubs.add(k));
        selectedReformerSubs.clear();
        REFORMER_SUBS.forEach(s => selectedReformerSubs.add(s.key));
        // The week preset's own range (it wrote 7 by hand: eight days, and no
        // longer the window "7 days" lights up for).
        const week = _dateModeWindow('week', localDateStr());
        _dateQuickMode = 'week';
        document.getElementById('startDate').value = week.startDate;
        document.getElementById('daysAhead').value = week.daysAhead;
        document.querySelectorAll('.date-quick-btn').forEach(b => {
          b.classList.toggle('active', b.textContent.trim() === '7 days');
        });
      },
    },
    {
      key: 'favourites', label: 'Favourites',
      // Only meaningful when the user has favourites.
      available: () => typeof favouriteInstructors !== 'undefined' && favouriteInstructors.size > 0,
      apply() {
        if (typeof applyFavouritesAsFilter === 'function') applyFavouritesAsFilter();
      },
    },
  ];
}

// Re-sync the filter UI to the current globals after a programmatic change.
function _syncFilterUI() {
  if (typeof renderInstrChips === 'function') renderInstrChips();
  if (typeof renderInstrDropdown === 'function') renderInstrDropdown();
  if (typeof renderLocationChips === 'function') renderLocationChips();
  if (typeof renderCategoryPills === 'function') renderCategoryPills();
  if (typeof renderStrengthSubPills === 'function') renderStrengthSubPills();
  if (typeof renderReformerSubPills === 'function') renderReformerSubPills();
  renderTimePills();
  _syncDatePills();
  if (typeof updateFiltersSummary === 'function') updateFiltersSummary();
}

// ── The member's own filters, while a shortcut's are on screen ──────
// _focusSearch (below) replaces the studio / class-type / Time-row filters
// without saving — but only until the next tap: × on the instructor chip, a
// date pill, any wrapped toggle had saveFilters snapshot the LIVE sets, and the
// home studio was gone from that launch and every later one. What stood before
// the shortcut is kept in window._focusStash, per dimension:
//   • saveFilters (interactions.js) writes it in place of the live value;
//   • a dimension the member then changes by hand is theirs again (dropped);
//   • × on the last instructor chip — how one goes back to browsing — puts
//     what is left of it back on screen;
//   • Clear filters, a recent-search pill and sign-out forget it.
const FOCUS_STASH_DIMS = {
  loc: ['locationIds'],
  cat: ['categories', 'strengthSubs', 'reformerSubs'],
  time: ['timeBands', 'availableOnly'],
};
function _dropFocusStash(dim) {
  const st = window._focusStash;
  if (!st) return;
  if (!dim) { window._focusStash = null; return; }
  FOCUS_STASH_DIMS[dim].forEach(k => { delete st[k]; });
}
function _restoreFocusStash() {
  const st = window._focusStash;
  if (!st) return;
  window._focusStash = null;
  const put = (set, list) => { set.clear(); (list || []).forEach(v => set.add(v)); };
  if (st.locationIds) put(selectedLocations, st.locationIds);
  if (st.categories) {
    put(selectedCategories, st.categories);
    put(selectedStrengthSubs, st.strengthSubs);
    put(selectedReformerSubs, st.reformerSubs);
  }
  if (st.timeBands) { put(selectedTimeBands, st.timeBands); _availableOnly = st.availableOnly === true; }
  _syncFilterUI();
}

// The "find it" shortcuts (Find similar, Book again, View schedule / View
// classes, Stats' "Find this week") each name ONE thing, but used to change
// only that filter: with "Bank · Ride" left on Discover, "Same instructor" for
// a Strength class at Shoreditch toasted "Showing classes with Alex" over
// "Nothing matches these filters". They all start from a clean slate here and
// apply only what they pass:
//   instructorId / locationId — the one instructor / studio to keep (else none)
//   categoryKey, or typeName to derive it from — the one class type (else none)
//   mode — a date preset; or startDate (+ daysAhead, default 1) — picked days.
//          Neither: a multi-day range the member chose stays, a single day
//          (or one already gone) widens to the week — one instructor on one
//          arbitrary day is mostly an empty list.
//   keepTimeRow — leave the Time row as the caller set it (same-time admits
//          its own band first). Everyone else gets any time: with "After 17:00"
//          saved, "Book again — Tuesdays at 07:00" listed her 18:30 and not
//          the 7:00 — a list that is not EMPTY, so no "Show all times" rescue.
//          "Available only" always goes: it hid a full-but-waitlistable usual
//          class the same way.
// Not saved (no saveFilters): a shortcut must not replace the home-studio
// filter the next launch restores — nor may the member's NEXT tap save the
// shortcut's filters for it: what they had on is stashed first (see above).
function _focusSearch(o) {
  o = o || {};
  // Once per dimension: a second shortcut must not stash the first one's filters.
  const st = window._focusStash || (window._focusStash = {});
  if (!('locationIds' in st)) st.locationIds = [...selectedLocations];
  if (!('categories' in st)) {
    st.categories = [...selectedCategories];
    st.strengthSubs = [...selectedStrengthSubs];
    st.reformerSubs = [...selectedReformerSubs];
  }
  if (!('timeBands' in st)) { st.timeBands = [...selectedTimeBands]; st.availableOnly = _availableOnly === true; }
  selectedInstructors.clear();
  if (o.instructorId != null && o.instructorId !== '') selectedInstructors.add(String(o.instructorId));
  const typed = document.getElementById('instrSearch');
  if (typed) typed.value = '';
  window._discoverQuery = ''; // render() filters on it too
  selectedLocations.clear();
  if (o.locationId != null && o.locationId !== '') selectedLocations.add(String(o.locationId));
  // A class type we cannot place ('Class' is the cache's placeholder, OTHER the
  // catch-all) filters nothing rather than hiding the class being looked for.
  let cat = o.categoryKey || null;
  if (!cat && o.typeName && o.typeName !== 'Class') cat = getCategory(o.typeName).key;
  selectedCategories.clear();
  if (cat && cat !== 'OTHER') selectedCategories.add(cat);
  selectedStrengthSubs.clear();
  ['UPPER', 'LOWER', 'FULL'].forEach(k => selectedStrengthSubs.add(k));
  selectedReformerSubs.clear();
  REFORMER_SUBS.forEach(s => selectedReformerSubs.add(s.key));

  const startEl = document.getElementById('startDate'), daysEl = document.getElementById('daysAhead');
  const todayStr = localDateStr(new Date());
  let w = _dateModeWindow(o.mode, todayStr), mode = w ? o.mode : null;
  if (!w && /^\d{4}-\d{2}-\d{2}$/.test(String(o.startDate || ''))) {
    w = { startDate: o.startDate, daysAhead: parseInt(o.daysAhead, 10) > 0 ? parseInt(o.daysAhead, 10) : 1 };
  }
  if (!w && startEl && daysEl && ((parseInt(daysEl.value, 10) || 0) <= 1 || startEl.value < todayStr)) {
    w = _dateModeWindow('week', todayStr);
    mode = 'week';
  }
  if (w && startEl && daysEl) {
    _dateQuickMode = mode;
    startEl.value = w.startDate;
    daysEl.value = w.daysAhead;
  }
  if (!o.keepTimeRow) selectedTimeBands.clear();
  _availableOnly = false;

  _syncFilterUI();
  if (typeof switchTab === 'function') switchTab('discover');
  // A search made FOR the member is a fresh view: over the same range the pager
  // would keep a day they had swiped to — "Showing classes with Alex" over "No
  // classes on this day", because Alex does not teach on Sundays. Unchosen, the
  // finished render lands on the first day that has a match (_pagerPickDay).
  window._pagerChosen = false;
  search();
}

// Apply a saved search object: set the filter globals + inputs, re-render
// chips, and run the search.
function applySavedSearch(obj) {
  if (!obj) return;
  if (typeof _dropFocusStash === 'function') _dropFocusStash(); // a whole filter state of the member's choosing
  if (typeof _releaseDateRow === 'function') _releaseDateRow(); // …its date included
  selectedInstructors.clear();
  (obj.instructors || []).forEach(id => selectedInstructors.add(String(id)));
  selectedLocations.clear();
  (obj.locations || []).forEach(id => selectedLocations.add(String(id)));
  selectedCategories.clear();
  (obj.categories || []).forEach(k => selectedCategories.add(k));
  selectedStrengthSubs.clear();
  ((obj.strengthSubs && obj.strengthSubs.length) ? obj.strengthSubs : ['UPPER', 'LOWER', 'FULL'])
    .forEach(k => selectedStrengthSubs.add(k));
  selectedReformerSubs.clear();
  ((obj.reformerSubs && obj.reformerSubs.length) ? obj.reformerSubs : REFORMER_SUBS.map(s => s.key))
    .forEach(k => selectedReformerSubs.add(k));
  // An entry saved before the Time row existed has neither field: the row is
  // reset, or the pill would bring back its list minus whatever "After 17:00"
  // happens to hide today. (setTimeFilters keeps known band keys only.)
  setTimeFilters(obj.timeBands, obj.availableOnly);

  // Same rule as restoreFilters: a preset is re-derived from TODAY (a "Today"
  // recorded yesterday is not yesterday's date) and a picked date already
  // behind us falls back to the week. _syncFilterUI paints the date row.
  const d = _restoredDateState({ dateQuickMode: obj.dateMode, startDate: obj.startDate, daysAhead: obj.daysAhead }, localDateStr());
  _dateQuickMode = d.mode;
  document.getElementById('startDate').value = d.startDate;
  document.getElementById('daysAhead').value = d.daysAhead;

  _syncFilterUI();
  if (typeof switchTab === 'function') switchTab('discover');
  window._pagerChosen = false; // a fresh view, as in _focusSearch: the first day with a match
  search();
}

// Apply a preset by key, then search.
function applySearchPreset(key) {
  const preset = getSearchPresets().find(p => p.key === key);
  if (!preset) return;
  preset.apply();
  _syncFilterUI();
  if (typeof switchTab === 'function') switchTab('discover');
  window._pagerChosen = false; // a fresh view, as in _focusSearch
  search();
}

// Render preset + recent-search pills inside the Discover empty state.
function renderDiscoverPresets() {
  let host = document.getElementById('discoverSearchPresets');
  const wrap = document.getElementById('discoverQuickWrap');
  if (!wrap) return;
  if (!host) {
    host = document.createElement('div');
    host.id = 'discoverSearchPresets';
    wrap.appendChild(host);
  }
  if (!currentUser) { host.innerHTML = ''; return; }

  const presets = getSearchPresets().filter(p => !p.available || p.available());
  const recents = getRecentSearches();

  let html = '';
  if (presets.length) {
    html += '<div class="discover-pill-group"><span class="discover-pill-label">Quick picks</span>' +
      '<div class="discover-pill-row">' +
      presets.map(p =>
        `<button class="discover-pill" data-preset="${escapeHTML(p.key)}">${escapeHTML(p.label)}</button>`
      ).join('') +
      '</div></div>';
  }
  if (recents.length) {
    html += '<div class="discover-pill-group"><span class="discover-pill-label">Recent searches</span>' +
      '<div class="discover-pill-row">' +
      recents.map((r, idx) =>
        `<button class="discover-pill discover-pill-recent" data-recent="${idx}">${escapeHTML(_searchLabel(r))}</button>`
      ).join('') +
      '</div></div>';
  }
  host.innerHTML = html;
}

// Single delegated listener — no inline string onclick (XSS-safe via data-*).
document.addEventListener('click', e => {
  const presetBtn = e.target.closest('[data-preset]');
  if (presetBtn) {
    e.preventDefault();
    applySearchPreset(presetBtn.dataset.preset);
    return;
  }
  const recentBtn = e.target.closest('[data-recent]');
  if (recentBtn) {
    e.preventDefault();
    const idx = Number(recentBtn.dataset.recent);
    const list = getRecentSearches();
    if (list[idx]) applySavedSearch(list[idx]);
  }
});

window.getRecentSearches = getRecentSearches;
window.applySavedSearch = applySavedSearch;
window.getSearchPresets = getSearchPresets;
window.applySearchPreset = applySearchPreset;
window.renderDiscoverPresets = renderDiscoverPresets;

// ════════════════════════════════════════════════════════════════
// Feature: First-run welcome (full screen, four swipeable pages)
// ════════════════════════════════════════════════════════════════
const ONBOARDING_KEY = 'psycle_onboarded_v1';

// ── pure:welcome:start ── (no document / app state; tests/suites/8d-welcome.js evaluates this block)
// Should the welcome open at launch? Asked more than once per launch (see
// _maybeStartOnboarding), so every answer has to be safe to reach twice.
//   'show'  a newcomer, and nothing else wants the screen
//   'done'  not a newcomer: write the completion flag quietly, show nothing
//   'skip'  not this launch — the flag is left alone, so the next one asks again
//   'wait'  the iOS app before its storage restore has landed: the flag or a
//           token may be about to come back, so nobody is taught anything yet
function _welcomeDecision(s) {
  s = s || {};
  if (s.completed || s.smoke) return 'skip';
  // Signed in on this install at some point, or a history to show for it. A
  // member whose flag went missing (an import, a restore that brought the
  // token back but not the flag) is never walked through a tutorial over
  // their own bookings. (History > 3 was the old tour's rule.)
  if (s.hasToken || Number(s.historyCount) > 3) return 'done';
  if (s.restorePending) return 'wait';
  // A launch that is going somewhere — a #tab link, a notification or widget
  // tap on its way to a class, a sheet already open — is not the moment.
  if (s.deepLink || s.dialogUp) return 'skip';
  return 'show';
}

// The four pages: a title and ONE sentence each — except the first, whose line
// is the Crisp Colour welcome board's headline (two short sentences, set
// large). Widgets and reminders exist
// in the iOS app only, so the web build says nothing about them — and only a
// touch screen is told to swipe: the day pager's swipe is touch-only (its own
// hint is gated on a coarse pointer too), and with a mouse the days are
// stepped through with the strip, the arrow keys or a swipe. The note on
// the first page is required wording, not decoration.
function _welcomePages(native, touch) {
  return [
    { id: 'welcome', title: 'Psync', body: 'Find a class. Book a spot.',
      note: 'An independent companion for Psycle London members, not affiliated with or endorsed by Psycle.' },
    { id: 'find', title: 'Find your class', body: touch ? 'Choose your dates, then swipe between days.' : 'Choose your dates, then step through the days.' },
    { id: 'book', title: 'Book in two taps', body: 'Your usual spot is ready to confirm, and you are warned about clashes and the late-cancel window.' },
    { id: 'keep', title: 'Keep up', body: native
      ? 'Everything you hold in one place, with widgets and reminders on iPhone.'
      : 'Everything you hold in one place.' },
  ];
}

function _welcomeClamp(idx, count) {
  return Math.max(0, Math.min(Math.max(0, count - 1), Number(idx) || 0));
}

// One finger, two possible owners: the page under it (vertical) or the pager
// (horizontal). Horizontal only once it clearly is — the Discover day pager's
// rule — so a slanted scroll never turns a page. '' = too early to say.
function _welcomeSwipeAxis(dx, dy) {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax > 12 && ax > 1.5 * ay) return 'x';
  if (ay > 12) return 'y';
  return '';
}

// How far the pages follow the finger: all the way between pages, a third of
// it (it resists, then stays) where there is no page in that direction.
function _welcomeDragOffset(idx, count, dx) {
  const noPage = (idx <= 0 && dx > 0) || (idx >= count - 1 && dx < 0);
  return noPage ? dx / 3 : dx;
}

// Where a released drag lands: past a quarter of the width, or a quick flick,
// turns the page; anything less springs back.
function _welcomeSwipeTarget(idx, count, dx, width, ms) {
  const far = Math.abs(dx) > (Number(width) || 0) * 0.25;
  const flick = Math.abs(dx) > 40 && ms > 0 && ms < 250;
  if (!far && !flick) return _welcomeClamp(idx, count);
  return _welcomeClamp(idx + (dx < 0 ? 1 : -1), count);
}

// Labels for the miniature day strip, from a calendar date the caller read
// off the device (y, m 1–12, d). Decoration — never timetable data.
function _welcomeDayLabels(y, m, d, n) {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const out = [];
  for (let i = 0; i < n; i++) {
    const day = new Date(Date.UTC(y, m - 1, d + i));
    out.push(i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : names[day.getUTCDay()] + ' ' + day.getUTCDate());
  }
  return out;
}
// ── pure:welcome:end ──

let _onboardIdx = 0;
let _onboardPages = [];
let _onboardOpener = null; // what had focus when the welcome opened — it goes back there
let _onboardTurnedAt = 0; // when the page last turned (see the click handler in startOnboarding)
let _onboardLaunchSettled = false; // this launch's "should it show?" has its answer

function _onboardNative() {
  try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); } catch { return false; }
}

// `only`: the overlay a fade-out was started on. If the welcome was reopened
// during those 220ms, the timer must not take the new one away.
function _onboardCleanup(only) {
  const ov = document.getElementById('onboardOverlay');
  if (only && ov !== only) return;
  if (ov) ov.remove();
  document.removeEventListener('keydown', _onboardKey);
  const opener = _onboardOpener;
  _onboardOpener = null;
  if (opener && opener.isConnected && typeof opener.focus === 'function') {
    try { opener.focus({ preventScroll: true }); } catch {}
  }
}

function _onboardFinish(thenSignIn) {
  try { localStorage.setItem(ONBOARDING_KEY, '1'); } catch {}
  const ov = document.getElementById('onboardOverlay');
  // (_psycleClosing: fading, but no longer a dialog to announce into — see _dialogLiveRegion.)
  if (ov) { ov._psycleClosing = true; ov.classList.remove('show'); setTimeout(() => _onboardCleanup(ov), 220); }
  else _onboardCleanup();
  if (thenSignIn && typeof openLoginPopup === 'function') openLoginPopup();
}

// The buttons Tab may land on right now (Back is `hidden` on the first page,
// "Look around first" disabled everywhere but the last).
function _onboardButtons(ov) {
  return Array.from(ov.querySelectorAll('button')).filter(b => !b.disabled && !b.hidden);
}

// Own keys, like confirmModal (_ownKeysOverlayUp makes the shared overlay
// handler stand aside while .onboard-overlay exists). Enter and Space are left
// to the focused button: advancing on Enter here as well made one press on
// "Skip" do two things.
function _onboardKey(e) {
  const ov = document.getElementById('onboardOverlay');
  if (!ov || ov._psycleClosing) return;
  if (e.key === 'Escape') { e.preventDefault(); _onboardFinish(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); _onboardGo(_onboardIdx + 1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); _onboardGo(_onboardIdx - 1); }
  else if (e.key === 'Tab') {
    const items = _onboardButtons(ov);
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement);
    const to = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : (at === items.length - 1 ? 0 : at + 1);
    items[to].focus();
  }
}

// Signed out = no session at all. A stored token whose /profile check is still
// pending or couldn't reach Psycle is a member who HAS signed in — same rule as
// updateDiscoverEmptyState — so the last page must not offer "Sign in" or open
// the login page for them (they can only have come here from Settings).
function _onboardSignedOut() {
  return !currentUser && !getBearerToken();
}

function _onboardGo(idx) {
  const to = _welcomeClamp(idx, _onboardPages.length);
  const moved = to !== _onboardIdx;
  _onboardIdx = to;
  if (moved) _onboardTurnedAt = Date.now();
  _onboardRender(!moved); // not moved = a drag that sprang back, or an arrow key at either end
}

// Updated in place, never rebuilt: the dialog keeps its focus and the live
// region announce() made inside it.
function _onboardRender(quiet) {
  const ov = document.getElementById('onboardOverlay');
  const page = _onboardPages[_onboardIdx];
  if (!ov || !page) return;
  const last = _onboardIdx === _onboardPages.length - 1;
  const track = ov.querySelector('.onboard-track');
  if (track) {
    track.classList.remove('is-dragging');
    track.style.transform = `translateX(${-100 * _onboardIdx}%)`;
  }
  ov.querySelectorAll('.onboard-page').forEach((el, i) => el.setAttribute('aria-hidden', String(i !== _onboardIdx)));
  ov.querySelectorAll('.onboard-dot').forEach((el, i) => el.classList.toggle('active', i === _onboardIdx));

  const back = ov.querySelector('.onboard-back');
  const next = ov.querySelector('.onboard-next');
  const look = ov.querySelector('.onboard-look');
  const offerSignIn = last && _onboardSignedOut();
  const held = document.activeElement;
  if (back) back.hidden = _onboardIdx === 0;
  if (next) {
    next.textContent = !last ? 'Next' : offerSignIn ? 'Sign in with Psycle' : 'Done';
    next.dataset.onboard = !last ? 'next' : offerSignIn ? 'signin' : 'done';
  }
  if (look) { look.disabled = !offerSignIn; look.classList.toggle('is-off', !offerSignIn); }
  // The button that had focus may just have gone (Back, on reaching page one).
  if (next && held && (held === back || held === look) && (held.hidden || held.disabled)) next.focus();
  if (!quiet) announce(`${page.title}, ${_onboardIdx + 1} of ${_onboardPages.length}`);
}

// Miniatures of the app's own components, built from the Crisp Colour
// primitives themselves (css/crisp.css: .ct-card + data-ct, .ct-tile with the
// class pictogram, .t-time, .ct-badge, the glow) and sized by .onboard-mini-*.
// Static text only; aria-hidden decoration. `ct` is a class-type key.
function _onboardPic(ct, size) {
  // (typeof: tests run this block on its own, without the pictograms.)
  return typeof classPictogram === 'function' ? classPictogram(ct, size) : '';
}
function _onboardMiniCard(cls, ct, time, name, sub, extra, action) {
  return `<div class="onboard-mini-card ct-card${cls ? ' ' + cls : ''}" data-ct="${ct}">` +
    `<div class="onboard-mini-time t-time is-compact">${time}</div>` +
    `<div class="onboard-mini-info"><div class="onboard-mini-name"><span class="ct-tile is-sm">${_onboardPic(ct, 15)}</span>${name}</div><div class="onboard-mini-sub">${sub}</div>${extra}</div>` +
    action +
  '</div>';
}

function _onboardArt(id) {
  let inner = '';
  if (id === 'welcome') {
    // The welcome board: what colour means here — one tile per class type, in
    // its own colour with its pictogram — and that the time comes first.
    const tile = (ct, name) => `<div class="onboard-tile ct-card" data-ct="${ct}"><span class="ct-tile is-xl">${_onboardPic(ct, 28)}</span><span class="onboard-tile-name">${name}</span></div>`;
    inner = tile('ride', 'Ride') + tile('strength', 'Strength') + tile('pilates', 'Reformer') + tile('yoga', 'Yoga') + tile('barre', 'Barre') +
      '<div class="onboard-tile is-time"><span class="onboard-tile-day">Thursday</span><span class="onboard-tile-time t-time">18:30</span></div>';
  } else if (id === 'find') {
    const now = new Date();
    const days = _welcomeDayLabels(now.getFullYear(), now.getMonth() + 1, now.getDate(), 5);
    const book = '<span class="onboard-mini-pill">Book</span>';
    inner =
      '<div class="onboard-mini-strip">' + days.map((d, i) =>
        `<span class="onboard-mini-day${i === 1 ? ' is-on glow-selected' : ''}">${escapeHTML(d)}</span>`).join('') + '</div>' +
      // Two days side by side, the next one peeking in: what a swipe brings.
      '<div class="onboard-mini-lane">' +
        '<div class="onboard-mini-col">' +
          _onboardMiniCard('', 'ride', '07:00', 'Ride 45', 'Oxford Circus', '', book) +
          _onboardMiniCard('', 'strength', '18:30', 'Strength 50', 'Shoreditch', '', book) +
        '</div>' +
        '<div class="onboard-mini-col">' +
          _onboardMiniCard('', 'yoga', '06:45', 'Yoga Flow', 'Clapham', '', book) +
          _onboardMiniCard('', 'pilates', '12:15', 'Reformer 50', 'Oxford Circus', '', book) +
        '</div>' +
      '</div>';
  } else if (id === 'book') {
    const taken = [2, 3, 7, 10, 11, 14, 16];
    let seats = '';
    for (let n = 1; n <= 18; n++) {
      seats += `<span class="onboard-mini-seat${n === 9 ? ' is-on glow-mine' : taken.indexOf(n) !== -1 ? ' is-taken' : ''}">${n}</span>`;
    }
    // The seat map wears the class it is for: your seat is its colour, with the glow.
    inner = `<div class="onboard-mini-map" data-ct="ride">${seats}</div>` +
      '<div class="onboard-mini-caution">Clashes with your 07:00 Ride 45</div>';
  } else if (id === 'keep') {
    // My Bookings cards: a seat (chip + free-cancel line) and a waitlist place.
    inner =
      _onboardMiniCard('is-held glow-mine-card', 'ride', '07:00', 'Ride 45', 'Oxford Circus · Studio 1',
        '<span class="onboard-mini-chip ct-badge is-seat">Bike 9</span><div class="onboard-mini-deadline">Free cancel until Mon 19:00</div>', '') +
      _onboardMiniCard('is-waitlisted is-dashed', 'strength', '18:30', 'Strength 50', 'Shoreditch',
        '<span class="onboard-mini-badge ct-badge is-dashed">Waitlisted</span>', '');
  }
  return inner ? `<div class="onboard-art onboard-art-${id}" aria-hidden="true">${inner}</div>` : '';
}

// The mark, as the header draws it (psycle-finder.html) — its own mask id, because the
// welcome can be up over the page that already carries the header's.
const _BRAND_MARK_SVG = '<svg viewBox="136 136 752 752" aria-hidden="true" focusable="false"><defs><mask id="welcomeGrooves" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024"><rect width="1024" height="1024" fill="#fff"/><path d="M304.2 367.7A180 180 0 0 1 551.2 328.6" fill="none" stroke="#000" stroke-width="72" stroke-linecap="round"/><path d="M719.8 656.3A180 180 0 0 1 591.7 727.3" fill="none" stroke="#000" stroke-width="72" stroke-linecap="round"/></mask></defs><g mask="url(#welcomeGrooves)"><path class="bm-top" d="M201.2 476A40 40 0 0 1 161.7 429.6A290 290 0 0 1 734.3 429.6A40 40 0 0 1 694.8 476L534.5 476A16 16 0 0 1 518.8 462.9A72 72 0 0 0 377.2 462.9A16 16 0 0 1 361.5 476Z"/><path class="bm-bot" d="M822.8 548A40 40 0 0 1 862.3 594.4A290 290 0 0 1 289.7 594.4A40 40 0 0 1 329.2 548L489.5 548A16 16 0 0 1 505.2 561.1A72 72 0 0 0 646.8 561.1A16 16 0 0 1 662.5 548Z"/></g></svg>';

function _onboardPageHTML(page, i) {
  return `<section class="onboard-page" aria-hidden="${i !== 0}"><div class="onboard-page-inner">` +
    (page.id === 'welcome'
      // The wordmark with the mark (the app icon's two engraved halves, in the
      // theme's two inks), the class-type tiles, then the line as the headline.
      ? '<div class="onboard-brand"><span class="onboard-mark" aria-hidden="true">' + _BRAND_MARK_SVG +
        `</span><h2 class="onboard-wordmark">${escapeHTML(page.title)}</h2></div>` + _onboardArt(page.id)
      : _onboardArt(page.id) + `<h2 class="onboard-title">${escapeHTML(page.title)}</h2>`) +
    // (The headline: one sentence to a line, as drawn — never "Book a / spot.")
    (page.id === 'welcome'
      ? '<p class="onboard-body onboard-headline">' + String(page.body).split('. ').map((line, i, all) => `<span>${escapeHTML(i < all.length - 1 ? line + '.' : line)}</span>`).join(' ') + '</p>'
      : `<p class="onboard-body">${escapeHTML(page.body)}</p>`) +
    (page.note ? `<p class="onboard-note">${escapeHTML(page.note)}</p>` : '') +
  '</div></section>';
}

// Pages follow the finger. Every listener is passive and the viewport is
// touch-action: pan-y, so a vertical scroll (a small phone, large type) stays
// the browser's and is never fought for. Buttons and arrow keys do the same job.
function _onboardBindSwipe(ov) {
  const viewport = ov.querySelector('.onboard-viewport');
  const track = ov.querySelector('.onboard-track');
  if (!viewport || !track) return;
  let x0 = 0, y0 = 0, t0 = 0, dx = 0, axis = '', live = false;
  const stillMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const release = (cancelled) => {
    if (!live) return;
    live = false;
    if (axis !== 'x') return;
    _onboardGo(cancelled ? _onboardIdx : _welcomeSwipeTarget(_onboardIdx, _onboardPages.length, dx, viewport.clientWidth, Date.now() - t0));
  };
  viewport.addEventListener('touchstart', (e) => {
    live = e.touches.length === 1 && !ov._psycleClosing && !ov.classList.contains('is-holding');
    if (!live) return;
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now(); dx = 0; axis = '';
  }, { passive: true });
  viewport.addEventListener('touchmove', (e) => {
    if (!live) return;
    if (e.touches.length !== 1) { release(true); return; } // a second finger: not a swipe
    const mx = e.touches[0].clientX - x0;
    if (!axis) axis = _welcomeSwipeAxis(mx, e.touches[0].clientY - y0);
    if (axis === 'y') { live = false; return; }
    if (axis !== 'x') return;
    dx = mx;
    if (stillMotion()) return; // reduced motion: nothing slides — the release simply swaps the page
    track.classList.add('is-dragging');
    track.style.transform = `translateX(calc(${-100 * _onboardIdx}% + ${_welcomeDragOffset(_onboardIdx, _onboardPages.length, dx)}px))`;
  }, { passive: true });
  viewport.addEventListener('touchend', () => release(false), { passive: true });
  viewport.addEventListener('touchcancel', () => release(true), { passive: true });
}

// The last step of opening: keys and focus. Split from startOnboarding because
// the iOS launch holds the overlay as a plain cover first (_maybeStartOnboarding).
function _onboardReveal() {
  const ov = document.getElementById('onboardOverlay');
  if (!ov) return;
  ov.classList.remove('is-holding');
  ov.removeAttribute('aria-hidden');
  // Its "Find your class" page has just said "swipe between days": Discover's
  // one-time "Swipe to change day" hint keeps for a later launch
  // (_paintDayHint). Set here, not where the overlay is built — the iOS
  // holding cover teaches nothing, and a replay from Settings never repaints
  // Discover while it is up, so the hint could not see it for itself.
  window._psycleWelcomeSeen = true;
  document.removeEventListener('keydown', _onboardKey);
  document.addEventListener('keydown', _onboardKey);
  // The panel, not a button: the dialog's name is what gets read first.
  const shell = ov.querySelector('.onboard-shell');
  if (shell) { try { shell.focus({ preventScroll: true }); } catch {} }
}

// opts.atLaunch — opaque from its first frame (a fade-in would show the app
// behind it). opts.holding — the wordmark alone, no keys, no focus, until
// _onboardReveal or _onboardCleanup settles it.
function startOnboarding(opts) {
  opts = opts || {};
  _onboardCleanup();
  _onboardIdx = 0;
  let touch = _onboardNative(); // the iOS app is a touch screen whatever matchMedia makes of it
  try { touch = touch || !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); } catch {}
  _onboardPages = _welcomePages(_onboardNative(), touch);
  const active = document.activeElement;
  _onboardOpener = active && active !== document.body ? active : null;

  const overlay = document.createElement('div');
  overlay.id = 'onboardOverlay';
  overlay.className = 'onboard-overlay';
  overlay.innerHTML =
    '<div class="onboard-shell" role="dialog" aria-modal="true" aria-label="Welcome to Psync" tabindex="-1">' +
      '<button type="button" class="onboard-skip" data-onboard="skip">Skip</button>' +
      '<div class="onboard-viewport"><div class="onboard-track">' + _onboardPages.map(_onboardPageHTML).join('') + '</div></div>' +
      '<div class="onboard-foot">' +
        '<div class="onboard-dots" aria-hidden="true">' + _onboardPages.map(() => '<span class="onboard-dot"></span>').join('') + '</div>' +
        '<div class="onboard-actions">' +
          '<button type="button" class="onboard-btn onboard-back" data-onboard="back">Back</button>' +
          '<button type="button" class="onboard-btn onboard-btn-primary onboard-next" data-onboard="next">Next</button>' +
        '</div>' +
        '<button type="button" class="onboard-btn onboard-look" data-onboard="look">Look around first</button>' +
      '</div>' +
    '</div>';
  overlay.addEventListener('click', e => {
    const act = e.target.closest('[data-onboard]')?.dataset.onboard;
    if (!act || overlay._psycleClosing) return;
    // On the last page "Next" turns into "Sign in with Psycle" / "Done" under
    // the same fingertip: the second half of a double tap must not finish the
    // welcome for good and open the sign-in page.
    const justTurned = Date.now() - _onboardTurnedAt < 400;
    if (act === 'next') _onboardGo(_onboardIdx + 1);
    else if (act === 'back') _onboardGo(_onboardIdx - 1);
    else if (act === 'signin') { if (!justTurned) _onboardFinish(true); }
    else if (act === 'done') { if (!justTurned) _onboardFinish(); }
    else if (act === 'skip' || act === 'look') _onboardFinish();
  });
  // The page underneath listens for touches on document (pull-to-refresh,
  // swipe-to-cancel, the day pager): a drag on the welcome is none of theirs.
  ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(type =>
    overlay.addEventListener(type, e => e.stopPropagation(), { passive: true }));
  _onboardBindSwipe(overlay);
  if (opts.holding) { overlay.classList.add('is-holding'); overlay.setAttribute('aria-hidden', 'true'); }
  document.body.appendChild(overlay);
  _onboardRender(true);

  // .show in the same tick as the insert: no transition runs, opaque at once.
  if (opts.atLaunch) overlay.classList.add('show');
  else requestAnimationFrame(() => overlay.classList.add('show'));
  if (!opts.holding) _onboardReveal();
}

// Settings → "Show the welcome again". Clears nothing: the flag stays set, so
// leaving half-way through does not bring the welcome back at the next launch.
function replayOnboarding() {
  startOnboarding();
}
window.replayOnboarding = replayOnboarding;

// What a launch can know about the person in front of it. `early` = the first
// look, taken while this file is still being evaluated.
function _onboardLaunchFacts(early) {
  let completed = true, hasToken = false, historyCount = 0;
  try {
    // Storage that cannot be read cannot remember an answer either: better no
    // welcome than the same one at every launch (completed stays true).
    completed = !!localStorage.getItem(ONBOARDING_KEY);
    // Presence only, under the keys security.js keeps the session in — they
    // can be seen before anything is decrypted, which is what lets the first
    // look run at once.
    hasToken = !!(localStorage.getItem('psycle_bearer_token') || localStorage.getItem('psycle_bearer_token_enc') || getBearerToken());
    if (!completed && !hasToken) {
      let hist = [];
      try { hist = JSON.parse(localStorage.getItem('psycle_class_history') || '[]'); } catch {} // unreadable = no proof of anything
      historyCount = Array.isArray(hist) ? hist.length : 0;
    }
  } catch {}
  const hash = String(location.hash || '').replace('#', '');
  const panel = document.querySelector('.tab-panel.active');
  return {
    completed, hasToken, historyCount,
    smoke: !!(window.__smokeLoadErrors || window.__smokeFetchStub), // tests/smoke.html
    // native-bridge.js (the LAST script) restores purged keys from Preferences;
    // securityReady waits for it, and so does the second look.
    restorePending: !!early && _onboardNative(),
    deepLink: (!!hash && hash !== 'discover') || (!!panel && panel.id !== 'tab-discover'),
    dialogUp: _dialogOpen() || !!document.getElementById('bookingConfirmation') ||
      _OVERLAYS.some(([id]) => _overlayIsOpen(document.getElementById(id))),
  };
}

// First-run trigger: only for genuinely new users. Looked at three times per
// launch and the first answer wins: at once (below) with what localStorage
// alone can say, so a newcomer gets the welcome INSTEAD of the app's first
// frames rather than over them two seconds in; again when security.js has
// settled (the token is readable and, in the iOS app, the storage restore has
// landed); and a last time from the first-paint block at the end of this file.
function _maybeStartOnboarding(early) {
  if (_onboardLaunchSettled) return;
  if (!document.body) { // scripts in <head> without defer
    document.addEventListener('DOMContentLoaded', () => _maybeStartOnboarding(early), { once: true });
    return;
  }
  // The first look runs while app.js is still loading: nothing in here may
  // throw past this function, or everything below it in the file never runs.
  try {
    const verdict = _welcomeDecision(_onboardLaunchFacts(early === true));
    const up = document.getElementById('onboardOverlay');
    if (verdict === 'wait') {
      // Up as a cover now, so a newcomer never sees the app flash by — but the
      // wordmark alone: a member whose storage is about to come back gets a
      // splash for a moment, not a tutorial. A stuck start-up must not leave
      // it there, so the question is asked again after 5s whatever happens.
      if (!up) {
        startOnboarding({ atLaunch: true, holding: true });
        setTimeout(() => _maybeStartOnboarding(), 5000);
      }
      return;
    }
    _onboardLaunchSettled = true;
    // Existing user — mark onboarded silently rather than nag.
    if (verdict === 'done') { try { localStorage.setItem(ONBOARDING_KEY, '1'); } catch {} }
    const holding = !!up && up.classList.contains('is-holding');
    if (verdict !== 'show') { if (holding) _onboardCleanup(); return; }
    if (holding) _onboardReveal();
    else if (!up) startOnboarding({ atLaunch: true });
  } catch (e) {
    // Half a welcome is worse than none: it would sit over the whole app.
    _onboardLaunchSettled = true;
    try { _onboardCleanup(); } catch {}
  }
}
_maybeStartOnboarding(true);
(window.securityReady || Promise.resolve()).then(function () {}, function () {}).then(function () { _maybeStartOnboarding(); });

// ════════════════════════════════════════════════════════════════
// Feature: Timezone-aware travel notice
// Classes are London time. If the device isn't in Europe/London AND the
// current UTC offset differs, show a subtle, session-dismissible notice.
// ════════════════════════════════════════════════════════════════
const TRAVEL_NOTICE_DISMISS_KEY = 'psycle_travel_notice_dismissed';

// Minutes that local time is ahead of London right now (London ahead → negative).
function londonOffsetDeltaMinutes(at = new Date()) {
  try {
    const fmt = tz => {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).formatToParts(at).reduce((o, p) => { o[p.type] = p.value; return o; }, {});
      // Interpret the wall-clock reading in that zone as if it were UTC, so the
      // difference between two zones' readings equals their offset difference.
      return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    };
    const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const localMs = fmt(localTz);
    const londonMs = fmt('Europe/London');
    return Math.round((localMs - londonMs) / 60000);
  } catch { return 0; }
}

function _isAwayFromLondon() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz === 'Europe/London') return false;
    return londonOffsetDeltaMinutes() !== 0;
  } catch { return false; }
}

function renderTravelNotice() {
  if (sessionStorage.getItem(TRAVEL_NOTICE_DISMISS_KEY)) {
    document.getElementById('travelNotice')?.remove();
    return;
  }
  if (!_isAwayFromLondon()) {
    document.getElementById('travelNotice')?.remove();
    return;
  }
  const results = document.getElementById('results');
  const shown = document.getElementById('travelNotice');
  if (shown) {
    // Its place is right above #results, wherever #results lives now. tabs.js
    // takes it along when it builds the tab shell; this is for anything else
    // that moves #results — left behind, the notice sat outside the tab panels,
    // under the docked tab bar.
    if (results && shown.parentNode !== results.parentNode) results.parentNode.insertBefore(shown, results);
    return;
  }
  if (!results) return;
  const el = document.createElement('div');
  el.id = 'travelNotice';
  el.className = 'travel-notice';
  el.innerHTML =
    '<span class="travel-notice-icon">✈︎</span>' +
    '<span>You appear to be away — class times are shown in London time.</span>' +
    '<button class="travel-notice-close" data-travel-dismiss aria-label="Dismiss">&times;</button>';
  results.parentNode.insertBefore(el, results);
}

document.addEventListener('click', e => {
  if (e.target.closest('[data-travel-dismiss]')) {
    try { sessionStorage.setItem(TRAVEL_NOTICE_DISMISS_KEY, '1'); } catch {}
    document.getElementById('travelNotice')?.remove();
  }
});

window.renderTravelNotice = renderTravelNotice;
window.londonOffsetDeltaMinutes = londonOffsetDeltaMinutes;

// ════════════════════════════════════════════════════════════════
// Feature: Rebook prediction
// Scores past/recurring classes by frequency + recency + day-of-week timing
// and surfaces ONE gentle suggestion (in the findSimilar popup + a hint on
// the My Bookings tab).
// ════════════════════════════════════════════════════════════════

// ── pure:predict:start ── (DOM-free; tests/suites/predict.js evaluates this block)
// The scoring behind predictNextClass(). `heldEvents` are the _eventCache rows
// of the seats the member holds right now (waitlist places are not seats).
// features.js writes a class into the history the moment it is BOOKED, so
// without them the usual Tuesday 7:00 scored higher for having just been
// booked, and "Book again?" sat above that very booking for good.
function _predictFrom(history, heldEvents, nowMs, typeByName, instrByName) {
  if (!Array.isArray(history) || history.length < 2) return null;
  typeByName = typeByName || {};
  instrByName = instrByName || {};

  const dayStr = d => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  // The seats held, read the way the history is: weekday / minutes off the
  // class's own wall clock.
  const held = (heldEvents || []).map(e => {
    const dt = e && e.start_at ? new Date(String(e.start_at).replace(' ', 'T')) : null;
    if (!dt || isNaN(dt.getTime())) return null;
    return {
      day: dayStr(dt), mins: dt.getHours() * 60 + dt.getMinutes(),
      typeName: String(e._typeName || '').toLowerCase(), instrName: String(e._instrName || '').toLowerCase(),
    };
  }).filter(Boolean);

  const buckets = {};
  history.forEach(h => {
    if (!h || h.cancelledAt || !h.date) return;
    const dt = new Date(String(h.date).replace(' ', 'T'));
    if (isNaN(dt.getTime())) return;
    // A class still ahead is a booking, not attendance: two of them alone
    // used to read "You usually go…".
    if (dt.getTime() > nowMs) return;
    const dow = dt.getDay();
    const mins = dt.getHours() * 60 + dt.getMinutes();
    const halfHour = Math.round(mins / 30) * 30;
    const typeName = h.typeName || 'Class';
    const key = dow + '|' + halfHour + '|' + typeName.toLowerCase() + '|' + (h.instrName || '').toLowerCase();
    if (!buckets[key]) {
      buckets[key] = { dow, mins: [], typeName, instrName: h.instrName || '', count: 0, lastTs: 0 };
    }
    buckets[key].count++;
    buckets[key].mins.push(mins);
    const ts = dt.getTime();
    if (ts > buckets[key].lastTs) buckets[key].lastTs = ts;
  });

  let best = null;
  Object.values(buckets).forEach(b => {
    if (b.count < 2) return;
    const avg = Math.round(b.mins.reduce((a, c) => a + c, 0) / b.mins.length);
    const hour = Math.floor(avg / 60), minute = avg % 60;

    // Days until the next occurrence of this weekday (1..7).
    const todayDow = new Date(nowMs).getDay();
    let daysUntil = (b.dow - todayDow + 7) % 7;
    if (daysUntil === 0) daysUntil = 7; // it's today but likely already passed → next week

    // That occurrence is already booked: nothing to "book again" — the next
    // best habit gets the hint instead. Minutes are compared with the bucket's
    // average, not its half-hour key (07:15 and 07:00 round to different keys).
    // An instructor teaches one class at a time, so the class type only has to
    // match where the history names nobody.
    const next = new Date(nowMs);
    next.setHours(0, 0, 0, 0);
    next.setDate(next.getDate() + daysUntil);
    const nextDay = dayStr(next);
    const bInstr = (b.instrName || '').toLowerCase();
    if (held.some(e => e.day === nextDay && Math.abs(e.mins - avg) <= 30 && e.instrName === bInstr &&
        (!!bInstr || e.typeName === b.typeName.toLowerCase()))) return;

    // Recency: more recent attendance scores higher (decay over ~60 days).
    const daysSince = b.lastTs ? (nowMs - b.lastTs) / 86400000 : 999;
    const recency = Math.max(0, 1 - daysSince / 60);
    // Timing: the sooner the next occurrence, the higher.
    const timing = (8 - daysUntil) / 7;
    const score = b.count * 2 + recency * 3 + timing;

    if (!best || score > best.score) {
      best = {
        dayOfWeek: b.dow,
        hour, minute,
        eventTypeId: typeByName[b.typeName.toLowerCase()] ?? null,
        instructorId: instrByName[(b.instrName || '').toLowerCase()] ?? null,
        label: b.typeName + (b.instrName ? ' · ' + b.instrName : ''),
        typeName: b.typeName,
        instrName: b.instrName,
        count: b.count,
        daysUntil,
        score,
      };
    }
  });
  return best;
}
// ── pure:predict:end ──

// Returns the single best-predicted recurring class, or null. Shape:
// { dayOfWeek, hour, minute, eventTypeId, instructorId, label, score, daysUntil }.
function predictNextClass() {
  let history = [];
  try { history = JSON.parse(localStorage.getItem('psycle_class_history') || '[]'); } catch { return null; }
  // Coerced where it is read (pure:stored-data), like every other history reader.
  if (typeof _cleanStoredHistory === 'function') history = _cleanStoredHistory(history);

  const typeByName = {};
  if (typeof eventTypes !== 'undefined') {
    eventTypes.forEach(t => { if (t.name) typeByName[t.name.toLowerCase()] = t.id; });
  }
  const instrByName = {};
  if (typeof instructors !== 'undefined') {
    instructors.forEach(i => { if (i.full_name) instrByName[i.full_name.toLowerCase()] = i.id; });
  }

  const held = [];
  Object.keys(_myBookings || {}).forEach(id => {
    const b = _myBookings[id];
    if (!b || b.waitlisted) return; // a waitlist place is no seat: the class is still worth finding
    if (_eventCache[id]) held.push(_eventCache[id]);
  });
  return _predictFrom(history, held, Date.now(), typeByName, instrByName);
}

// One-tap path into search for a predicted class: set type/instructor + the
// next occurrence date, then search.
function bookPrediction(pred) {
  if (!pred) return;
  const target = new Date();
  target.setHours(0, 0, 0, 0);
  target.setDate(target.getDate() + (pred.daysUntil || 0));
  // That instructor on that day, at ANY studio: a studio filter left on
  // Discover used to hide the very class the hint names. With nobody to narrow
  // by (a name /instructors no longer lists) the class type is the next best.
  _focusSearch({
    instructorId: pred.instructorId,
    typeName: pred.instructorId == null ? pred.typeName : '',
    startDate: localDateStr(target), daysAhead: 1,
  });
  const when = new Date(target).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
  toast('Showing ' + pred.label + ' for ' + when, 'info');
}

// Render the gentle "Book again?" hint on the My Bookings tab.
function renderRebookHint() {
  const panel = document.getElementById('upcomingPanel');
  document.getElementById('rebookHint')?.remove();
  if (!currentUser) return;
  // Until /bookings has answered nobody knows which seats are held: the first
  // paint suggested the class sitting right below it. 'bookings:loaded'
  // renders the hint again.
  if (_bookingsLoadState !== 'loaded') return;
  const pred = predictNextClass();
  if (!pred) return;

  const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][pred.dayOfWeek];
  const timeStr = _clock24(pred.hour, pred.minute);

  // Its class type, as a pictogram tile in the class colour. pred.label is
  // "Type · Instructor": only the type decides the colour. (typeof + innerHTML,
  // not setAttribute: tests/suites/predict.js runs this against a bare element.)
  const ctKey = typeof classTypeKey === 'function' ? classTypeKey(pred.typeName || String(pred.label || '').split(' · ')[0]) : 'other';
  const tile = typeof classPictogram === 'function'
    ? '<span class="ct-tile is-lg" data-ct="' + ctKey + '" aria-hidden="true">' + classPictogram(ctKey, 20) + '</span>' : '';

  const el = document.createElement('div');
  el.id = 'rebookHint';
  el.className = 'rebook-hint';
  el.innerHTML = tile +
    '<div class="rebook-hint-text">' +
      '<span class="rebook-hint-eyebrow">Book again?</span>' +
      '<span class="rebook-hint-main">' + escapeHTML(pred.label) + '</span>' +
      '<span class="rebook-hint-sub">You usually go ' + escapeHTML(dayName) + 's at ' + escapeHTML(timeStr) + '</span>' +
    '</div>' +
    '<button class="rebook-hint-btn" data-rebook-predict>Find it</button>';

  // Place it just above the upcoming panel (or where it would be).
  if (panel && panel.parentNode) panel.parentNode.insertBefore(el, panel);
  else {
    const bookingsTab = document.getElementById('tab-bookings');
    if (bookingsTab) bookingsTab.insertBefore(el, bookingsTab.firstChild);
  }
}

document.addEventListener('click', e => {
  if (e.target.closest('[data-rebook-predict]')) {
    e.preventDefault();
    bookPrediction(predictNextClass());
  }
});

window.predictNextClass = predictNextClass;
window.bookPrediction = bookPrediction;
window.renderRebookHint = renderRebookHint;

// Keep the rebook hint fresh as bookings change.
if (typeof PsycleEvents !== 'undefined') {
  ['bookings:loaded', 'booking:complete', 'booking:cancelled'].forEach(evt => {
    try { PsycleEvents.on(evt, () => { try { renderRebookHint(); } catch {} }); } catch {}
  });
}

// ── Extend findSimilar with the predicted "book again" suggestion ─
// Monkey-patch (the original is defined above) so the popup gains one extra
// option when a strong prediction exists.
(function () {
  const _origFindSimilar = window.findSimilar;
  if (typeof _origFindSimilar !== 'function') return;
  window.findSimilar = function (eventId) {
    _origFindSimilar(eventId);
    try {
      const pred = predictNextClass();
      if (!pred) return;
      const popup = document.querySelector('.find-similar-popup');
      if (!popup) return;
      // Don't suggest the same class the popup is already centred on.
      const evt = _eventCache[String(eventId)];
      if (evt && pred.eventTypeId != null && evt.event_type_id === pred.eventTypeId &&
          (pred.instructorId == null || evt.instructor_id === pred.instructorId)) return;

      const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][pred.dayOfWeek];
      const timeStr = _clock24(pred.hour, pred.minute);

      const btn = document.createElement('button');
      btn.className = 'find-similar-option find-similar-predicted';
      btn.dataset.action = 'predicted';
      btn.innerHTML =
        '<span class="find-similar-icon" aria-hidden="true">' + (typeof _uiIcon === 'function' ? _uiIcon('again', 18) : '') + '</span>' +
        '<span class="find-similar-label">Book again: ' + escapeHTML(pred.label) + '</span>' +
        '<span class="find-similar-desc">You usually go ' + escapeHTML(dayName) + 's at ' + escapeHTML(timeStr) + '</span>';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        popup.remove();
        bookPrediction(pred);
      });
      popup.appendChild(btn);
    } catch (e) { /* non-intrusive — ignore */ }
  };
})();

// ── Wire the new Discover-tab surfaces into auth + first run ──────
// Re-render presets/notice when the discover empty state updates (sign in/out).
(function () {
  const _origUpdateDiscover = window.updateDiscoverEmptyState || updateDiscoverEmptyState;
  if (typeof _origUpdateDiscover === 'function') {
    window.updateDiscoverEmptyState = function () {
      _origUpdateDiscover.apply(this, arguments);
      try { renderDiscoverPresets(); } catch {}
      try { renderTravelNotice(); } catch {}
    };
    updateDiscoverEmptyState = window.updateDiscoverEmptyState;
  }
})();

// Record the search into recents once it completes (signed-in only). Wrap
// search() so we don't touch its internals.
(function () {
  const _origSearch = window.search || search;
  if (typeof _origSearch !== 'function') return;
  const wrapped = async function () {
    const r = await _origSearch.apply(this, arguments);
    try {
      if (currentUser && (selectedInstructors.size || selectedLocations.size ||
          selectedCategories.size || _dateQuickMode !== 'week')) {
        _recordRecentSearch();
      }
    } catch {}
    return r;
  };
  window.search = wrapped;
  search = wrapped;
})();

// First paint: presets, travel notice, rebook hint, and the onboarding tour.
(window.securityReady || Promise.resolve()).then(function () {
  setTimeout(function () {
    try { renderDiscoverPresets(); } catch {}
    try { renderTravelNotice(); } catch {}
    try { renderRebookHint(); } catch {}
    _maybeStartOnboarding();
  }, 1200);
});

// ── PWA Service Worker ───────────────────────────────────────────
// What happens once a NEW worker has taken over (reload, or a "new version"
// bar) lives in psycle-finder.html's inline head script, so it works even when
// this file is the stale one. Here: browsers only re-check sw.js on a
// navigation, and an installed PWA can sit open for days — so ask again when
// the app comes back to the foreground, at most hourly. In the iOS app
// native-bridge swaps navigator.serviceWorker for a register-only stub whose
// promise resolves with nothing, hence the `reg` checks.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(reg => {
    if (!reg || typeof reg.update !== 'function') return;
    let checkedAt = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || Date.now() - checkedAt < 60 * 60 * 1000) return;
      checkedAt = Date.now();
      try { reg.update().catch(() => {}); } catch {}
    });
  }).catch(() => {});
}
