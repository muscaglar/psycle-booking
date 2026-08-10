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

// ── Category mapping for smart filters ──────────────────────────
const CATEGORY_MAP = [
  { key: 'RIDE',     label: 'Ride',     color: '#e94560', prefixes: ['RIDE'] },
  { key: 'STRENGTH', label: 'Strength', color: '#4a9eff', prefixes: ['STRENGTH', 'LIFT', 'WEIGHTS', 'TREAD'] },
  { key: 'YOGA',     label: 'Yoga',     color: '#9b59b6', prefixes: ['YOGA', 'FLOW', 'RESTORE', 'MEDITATION'] },
  { key: 'HIIT',     label: 'HIIT',     color: '#e67e22', prefixes: ['HIIT', 'CIRCUIT', 'INTERVAL'] },
  { key: 'PILATES',  label: 'Pilates',  color: '#27ae60', prefixes: ['PILATES', 'REFORMER'] },
  { key: 'LAGREE',   label: 'Lagree',   color: '#1abc9c', prefixes: ['LAGREE', 'MEGAFORMER'] },
  { key: 'BARRE',    label: 'Barre',    color: '#e91e8c', prefixes: ['BARRE'] },
  { key: 'OTHER',    label: 'Other',    color: '#888',    prefixes: [] },
];

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

/** Get slot label from an event ID via the cache */
function slotLabelForEvent(eventId) {
  const evt = _eventCache[String(eventId)];
  return evt ? slotLabel(evt._typeName) : 'Spot';
}

/**
 * Pluralize a slot noun, preserving case: Bench -> Benches; Bike -> Bikes,
 * Bed -> Beds, Spot -> Spots (and the lowercase variants used in the picker).
 */
function pluralizeSlotLabel(label) {
  if (!label) return label;
  return /^bench$/i.test(label) ? label + 'es' : label + 's';
}

/**
 * Format a booked slot list with the correct noun for the class type.
 * e.g. formatSlots('Bench', [12, 15]) -> "Benches 12 & 15", ('Bike', [7]) -> "Bike 7"
 */
function formatSlots(label, slots) {
  if (!slots || !slots.length) return '';
  const noun = slots.length === 1 ? label : pluralizeSlotLabel(label);
  return noun + ' ' + slots.join(' & ');
}

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
  if (!sid) return escapeHTML(name);
  return '<span class="instructor-link" onclick="event.stopPropagation();window._features_openInstructorModal(\'' +
    safeName + '\',\'' + sid + '\')">' + escapeHTML(name) + '</span>';
}

// selectedCategories is managed by state.js

// ── Strength sub-filter ──────────────────────────────────────────
const STRENGTH_SUBS = [
  { key: 'UPPER', label: 'Upper', match: 'Upper Body', color: '#4a9eff' },
  { key: 'LOWER', label: 'Lower', match: 'Lower Body', color: '#4a9eff' },
  { key: 'FULL',  label: 'Full Body', match: 'Full Body',  color: '#4a9eff' },
];
// selectedStrengthSubs is managed by state.js (default: all selected)

// ── Reformer sub-filter (variants of the Pilates category) ───────
// Mirrors STRENGTH_SUBS: shown when Pilates is selected, matches the
// variant word in the type name ("REFORMER: Signature 55" / "REFORMER:
// Strength 50"). A class matching neither sub always shows.
const REFORMER_SUBS = [
  { key: 'SIGNATURE', label: 'Signature', match: 'Signature', color: '#27ae60' },
  { key: 'STRENGTH',  label: 'Strength',  match: 'Strength',  color: '#27ae60' },
];
// selectedReformerSubs is managed by state.js (default: all selected)

function renderReformerSubPills() {
  const container = document.getElementById('reformerSubPills');
  if (!container) return;
  const pilatesActive = selectedCategories.has('PILATES');
  container.style.display = pilatesActive ? 'flex' : 'none';
  if (!pilatesActive) return;
  container.innerHTML = REFORMER_SUBS.map(s => {
    const active = selectedReformerSubs.has(s.key);
    return `<button class="sub-pill${active ? ' active' : ''}"
      style="color:${s.color};border-color:${s.color};${active ? `background:${s.color}` : ''}"
      onclick="toggleReformerSub('${s.key}')">${s.label}</button>`;
  }).join('');
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
  container.innerHTML = STRENGTH_SUBS.map(s => {
    const active = selectedStrengthSubs.has(s.key);
    return `<button class="sub-pill${active ? ' active' : ''}"
      style="color:${s.color};border-color:${s.color};${active ? `background:${s.color}` : ''}"
      onclick="toggleStrengthSub('${s.key}')">${s.label}</button>`;
  }).join('');
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

// Supersede guard: fetchMyBookings is fired concurrently from many places
// (visibility, pull-to-refresh, post-booking, offline replay). Only the
// NEWEST call may rebuild _myBookings — a slow, stale response landing after
// a fresh booking would otherwise wipe that booking from local state.
let _bookingsSeq = 0;

// Local writes to _myBookings (book / join / leave / cancel / claim). A fetch
// that STARTED before the last write is working from a stale server snapshot:
// it must not "release" buttons and should heal itself with a re-run.
let _bookingsLocalWriteAt = 0;
function _noteLocalBookingWrite() { _bookingsLocalWriteAt = Date.now(); }

// Hydrate _eventCache for the given event ids from GET /events/{id}.
async function _hydrateEventDetails(ids) {
  await Promise.all(ids.map(async evtId => {
    try {
      const r = await apiFetch(`/events/${evtId}`);
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
// replace it — confirmModal is single-instance).
function _dialogOpen() {
  if (document.getElementById('psycleConfirmOverlay')) return true;
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
    if (_dialogOpen()) { _allocAnnounceTimer = setTimeout(show, 700); return; }
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
    let replaced = false;
    _announceShowing = true;
    confirmModal({
      title: "You're in — Psycle gave you a spot",
      body: `Your waitlist place for ${line}${more} is now a confirmed booking. It's in My Bookings (and your calendar/widget if you sync).`,
      warn: "Psycle's normal 12-hour cancellation policy applies to it from now on.",
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

const WAITLISTS_DEADLINE_MS = 5000; // don't let a slow /waitlists stall the bookings pipeline

// Resolves to true when THIS call's response was applied to _myBookings
// (false = superseded by a newer call or failed) so callers that need
// fresh state can detect a no-op and retry.
async function fetchMyBookings() {
  const mySeq = ++_bookingsSeq;
  const startedAt = Date.now();
  if (!getBearerToken()) {
    _myBookings = {};
    renderMyBookings(); // still render — the signed-out empty state lives there
    return true;
  }
  try {
    // Waitlist places are a separate resource; fetch them alongside bookings.
    const waitlistsPromise = fetchMyWaitlists(startedAt).catch(() => null);
    const res = await apiFetch('/bookings?limit=200');
    if (mySeq !== _bookingsSeq) return false; // a newer fetch superseded this one
    if (!res.ok) return false;
    const data = await res.json();
    if (mySeq !== _bookingsSeq) return false;
    const list = Array.isArray(data) ? data : (data.data || []);

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
    // silently showing none, and tell the user in My Bookings.
    _waitlistsUnavailable = !waitlistsRead && !_lastWaitlistEntries;
    if (_waitlistsUnavailable) {
      const mem = _readWaitlistPlaces();
      Object.keys(mem.places || {}).forEach(id => {
        if (!next[id] && _eventCache[id]) next[id] = { bookingId: null, slots: [], slotBookings: {}, waitlisted: true, waitlist: { id: mem.places[id], status: 'waiting', addedAt: null, expiresAt: null, unverified: true } };
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
    if (diff && !racedLocalWrite) {
      if (diff.newlyAllocated.length) _announceAllocations(diff.newlyAllocated, diff);
      else _persistPlacesNow(diff.allocated);
    }
    PsycleEvents.emit('bookings:loaded', _myBookings);
    renderMyBookings();
    _resyncDiscoverButtons(!racedLocalWrite && waitlistsRead);
    if (racedLocalWrite) setTimeout(() => { if (_myBookings === next) fetchMyBookings(); }, 250);

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
        if (!entries || _myBookings !== next) return;
        // A join/leave/cancel since this pass started makes the late snapshot
        // untrustworthy (it could resurrect a place just left) — re-run instead.
        if (_bookingsLocalWriteAt > startedAt) { fetchMyBookings(); return; }
        _waitlistsUnavailable = false;
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
          if (lateDiff.newlyAllocated.length) _announceAllocations(lateDiff.newlyAllocated, lateDiff);
          else _persistPlacesNow(lateDiff.allocated);
        }
        renderMyBookings();
        _resyncDiscoverButtons(true);
      }).catch(() => {});
    }
    return true;
  } catch (e) { console.warn('[psycle] fetchMyBookings failed:', e); return false; }
}
let _waitlistsUnavailable = false; // last pass couldn't read /waitlists at all (My Bookings shows a note)

// Refresh bookings when the page becomes visible after being hidden
document.addEventListener('visibilitychange', function () {
  if (!document.hidden && getBearerToken()) fetchMyBookings();
});

// Toast (toastTimer managed by state.js)
function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

// ── Discover empty state: signed-out users get one clear action ───
function updateDiscoverEmptyState() {
  const signedIn = !!currentUser;
  const qa = document.getElementById('discoverQuickWrap');
  const si = document.getElementById('discoverSignin');
  if (qa) qa.style.display = signedIn ? '' : 'none';
  if (si) si.style.display = signedIn ? 'none' : '';
  // "My favourites" is dead weight until favourites exist
  const fav = document.getElementById('qaFavs');
  if (fav) fav.style.display = favouriteInstructors && favouriteInstructors.size > 0 ? '' : 'none';
}

// Auth check
async function checkAuth() {
  const pill = document.getElementById('authPill');
  const gear = document.getElementById('settingsGear');
  if (!getBearerToken()) {
    currentUser = null;
    pill.innerHTML = `<a href="#" onclick="event.preventDefault();openLoginPopup()" class="signin-pill">Sign in</a>`;
    if (gear) gear.hidden = true;
    updateDiscoverEmptyState();
    return;
  }
  if (gear) gear.hidden = false;
  try {
    const res = await fetch(apiUrl('/profile'), {
      headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${getBearerToken()}` }
    });
    if (res.ok) {
      const data = await res.json();
      currentUser = data.data || data;
      // Extract active subscription info — prefer one with max_bookings (capped plan),
      // fall back to any active subscription (unlimited plan)
      const subs = currentUser.subscriptions || [];
      _activeSubscription = subs.find(s => s.status === 'active' && s.max_bookings > 0)
        || subs.find(s => s.status === 'active' && s.period_start)
        || null;
      const name = currentUser.first_name || currentUser.email || 'You';
      const initial = (name.trim()[0] || '?').toUpperCase();
      // Redesign: the header avatar shows the rider's initials.
      if (gear) {
        const _fn = (currentUser.first_name || '').trim();
        const _ln = (currentUser.last_name || '').trim();
        const inits = ((_fn[0] || name.trim()[0] || '?') + (_ln[0] || '')).toUpperCase();
        gear.innerHTML = '<span>' + escapeHTML(inits) + '</span>';
      }
      // Top bar shows only the avatar when signed in — sign-out lives in the
      // Membership tab now.
      pill.innerHTML = '';
      updateDiscoverEmptyState();
      fetchMyBookings();
      // After first login, offer to sync booking history
      setTimeout(function () { showHistorySyncPrompt(); }, 1500);
    } else if (res.status === 401 || res.status === 403) {
      showSessionExpired();
    } else {
      // Transient server trouble (5xx / 429) is NOT an expired session —
      // never destroy the stored token for it. Show signed-out UI for now;
      // the next visibility change / launch re-checks with the kept token.
      currentUser = null;
      pill.innerHTML = `<a href="#" onclick="event.preventDefault();openLoginPopup()" class="signin-pill">Sign in</a>`;
      toast(`Psycle is unreachable right now (${res.status}) — your session has been kept`, 'info');
      updateDiscoverEmptyState();
    }
  } catch {
    currentUser = null;
    pill.innerHTML = `<a href="#" onclick="event.preventDefault();openLoginPopup()" class="signin-pill">Sign in</a>`;
    updateDiscoverEmptyState();
  }
}

function showHistorySyncPrompt() {
  // Only show if history hasn't been synced and we have a token
  if (localStorage.getItem('psycle_history_synced')) return;
  if (!getBearerToken()) return;
  var history = [];
  try { history = JSON.parse(localStorage.getItem('psycle_class_history') || '[]'); } catch (e) {}
  if (history.length > 10) return; // already has substantial history

  // Remove any existing prompt
  document.getElementById('syncPromptOverlay')?.remove();

  var overlay = document.createElement('div');
  overlay.id = 'syncPromptOverlay';
  overlay.className = 'modal-overlay';
  overlay.style.display = 'flex';
  overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };

  var userName = (currentUser && currentUser.first_name) ? currentUser.first_name : '';

  overlay.innerHTML =
    '<div class="modal" style="max-width:400px">' +
      '<div class="modal-header">' +
        '<div>' +
          '<div class="modal-title">Welcome' + (userName ? ', ' + escapeHTML(userName) : '') + '!</div>' +
          '<div class="modal-subtitle">One more step to get the most out of your experience</div>' +
        '</div>' +
        '<button class="modal-close" onclick="document.getElementById(\'syncPromptOverlay\').remove()">&times;</button>' +
      '</div>' +
      '<div style="padding:0 20px 8px;font-size:13px;color:var(--text-muted,#aaa);line-height:1.6">' +
        'Import your full booking history from Psycle to unlock personalised insights, instructor discovery, and class analytics.' +
      '</div>' +
      '<div class="modal-actions" style="gap:8px">' +
        '<button class="btn btn-ghost" onclick="document.getElementById(\'syncPromptOverlay\').remove()">Skip for now</button>' +
        '<button class="btn" id="syncPromptBtn" onclick="startSyncFromPrompt()">Sync my history</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);
}

async function startSyncFromPrompt() {
  var btn = document.getElementById('syncPromptBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing...'; }
  if (typeof window._explore_syncHistory === 'function') {
    await window._explore_syncHistory();
  }
  var overlay = document.getElementById('syncPromptOverlay');
  if (overlay) overlay.remove();
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
  // Never carry one account's waitlist memory into the next.
  _lastWaitlistEntries = null;
  try { localStorage.removeItem(WAITLIST_PLACES_KEY); } catch (e) {}
  checkAuth();
}

function showSessionExpired() {
  currentUser = null;
  _lastWaitlistEntries = null; // whoever signs in next starts from the server's list
  if (typeof cancelTokenExpiryCheck === 'function') cancelTokenExpiryCheck();
  if (window._secureTokenStore) window._secureTokenStore.clear();
  else localStorage.removeItem('psycle_bearer_token');
  document.getElementById('sessionBanner').style.display = 'flex';
  const pill = document.getElementById('authPill');
  pill.innerHTML = `<a href="#" onclick="event.preventDefault();openLoginPopup()" class="signin-pill">Sign in</a>`;
  const gear = document.getElementById('settingsGear');
  if (gear) gear.hidden = true;
  updateDiscoverEmptyState();
}

// Token from login is now received via postMessage (security.js).
// Clean up any legacy URL token params.
(function() {
  const params = new URLSearchParams(location.search);
  if (params.has('psycle_token')) {
    history.replaceState({}, '', location.pathname);
  }
})();

// Re-check auth when tab becomes visible — handles the case where the login
// popup stored a token in localStorage but postMessage was lost because this
// tab was suspended by the OS (common on mobile).
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState !== 'visible' || currentUser) return;
  var legacy = localStorage.getItem('psycle_bearer_token');
  if (legacy) {
    if (window._secureTokenStore) {
      window._secureTokenStore.set(legacy).then(function() { checkAuth(); });
    } else {
      checkAuth();
    }
  }
});

// Init — wait for security module to decrypt stored token
if (IS_FILE) document.getElementById('corsBanner').style.display = 'block';
(window.securityReady || Promise.resolve()).then(function() {
  checkAuth();
  if (typeof scheduleTokenExpiryCheck === 'function') scheduleTokenExpiryCheck();
});

(async () => {
  await (window.securityReady || Promise.resolve());
  const fetchJson = path => apiFetch(path).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });

  const [iRes, lRes, tRes] = await Promise.all([
    fetchJson('/instructors'),
    fetchJson('/locations'),
    fetchJson('/event-types'),
  ]).catch(err => {
    document.getElementById('results').innerHTML = `<div class="status" style="color:#e94560">
      Failed to load: ${escapeHTML(err.message)}<br><small style="color:#666">Check the console for details.</small>
    </div>`;
    throw err;
  });

  instructors = iRes.data.filter(i => i.is_visible).sort((a, b) => a.full_name.localeCompare(b.full_name));
  // Exclude non-studio entries: the at-home stream and the "- Stock Room"
  // back-office location (it's not a bookable studio).
  locations = lRes.data.filter(l => l.is_visible && l.handle !== 'psycle-at-home' && !/stock\s*room/i.test(l.name || ''));
  eventTypes = tRes.data || [];

  renderInstrDropdown();

  // Pre-select favourites if any saved — but only when there's no saved
  // instructor filter to restore. interactions.js restores
  // psycle_saved_filters on its own timer; racing it and ADDING favourites
  // on top would corrupt the user's last-used selection.
  let _hasSavedInstrFilter = false;
  try {
    const _sf = JSON.parse(localStorage.getItem('psycle_saved_filters') || 'null');
    _hasSavedInstrFilter = !!(_sf && Array.isArray(_sf.instructorIds) && _sf.instructorIds.length > 0);
  } catch (e) {}
  if (favouriteInstructors.size > 0 && !_hasSavedInstrFilter) {
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
  document.getElementById('startDate').value = today;
  document.getElementById('daysAhead').value = 7;
  // Mark "7 days" as the default active quick button
  document.querySelectorAll('.date-quick-btn').forEach(b => {
    if (b.textContent.trim() === '7 days') b.classList.add('active');
  });

  updateDiscoverEmptyState();
  updateFiltersSummary();

  // Pre-load the full timetable on launch: restore the last view instantly
  // (kills the empty-state → results layout jump), then let search() hydrate
  // the cached window (instant smart filtering) and revalidate in the
  // background. Always run search when signed in so the window loads even on
  // a fresh session with no last-results.
  if (getBearerToken()) {
    const shown = restoreLastResults();
    setTimeout(() => { try { search(); } catch {} }, shown ? 800 : 200);
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
  // If the window for the current date range is already cached, re-filter it
  // client-side instantly — no debounce, no network. This makes every filter
  // (including instructor) update results immediately, so there's no Search button.
  const wk = (typeof currentWindowDates === 'function') ? currentWindowDates().windowKey : null;
  if (wk && window._windowKey === wk && Array.isArray(window._windowEvents) && window._windowRelations) {
    clearTimeout(_autoSearchTimer); // pending debounced search is obsolete
    renderFromWindow(currentFilters());
    return;
  }
  clearTimeout(_autoSearchTimer);
  _autoSearchTimer = setTimeout(() => search(), 600);
}

// One-line digest of the active filters, shown in the collapsed
// Filters bar so its state is readable without expanding.
function updateFiltersSummary() {
  const el = document.getElementById('controlsSummary');
  if (!el) return;
  const parts = [];
  const modeLabels = { today: 'Today', tomorrow: 'Tomorrow', week: '7 days', '2week': '14 days' };
  if (_dateQuickMode && modeLabels[_dateQuickMode]) {
    parts.push(modeLabels[_dateQuickMode]);
  } else {
    const d = document.getElementById('startDate')?.value;
    if (d) {
      const [y, m, dd] = d.split('-').map(Number);
      parts.push(new Date(y, m - 1, dd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
    }
  }
  if (selectedLocations.size === 1) {
    const l = locations.find(x => selectedLocations.has(String(x.id)));
    if (l) parts.push(l.name.replace('Psycle ', ''));
  } else if (selectedLocations.size > 1) {
    parts.push(selectedLocations.size + ' studios');
  }
  if (selectedInstructors.size === 1) {
    const i = instructors.find(x => String(x.id) === [...selectedInstructors][0]);
    if (i) parts.push(i.full_name.split(' ')[0]);
  } else if (selectedInstructors.size > 1) {
    parts.push(selectedInstructors.size + ' instructors');
  }
  if (selectedCategories.size > 0) {
    parts.push([...selectedCategories].map(k => {
      const c = CATEGORY_MAP.find(c => c.key === k);
      return c ? c.label : k;
    }).join(' · '));
  }
  el.textContent = parts.join(' · ');
}

function setDateQuick(mode) {
  const now = new Date();
  const todayStr = localDateStr(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = localDateStr(tomorrow);

  _dateQuickMode = mode;
  document.querySelectorAll('.date-quick-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');

  const daysGroup = document.getElementById('daysAheadGroup');

  if (mode === 'today') {
    document.getElementById('startDate').value = todayStr;
    document.getElementById('daysAhead').value = 1;
  } else if (mode === 'tomorrow') {
    document.getElementById('startDate').value = tomorrowStr;
    document.getElementById('daysAhead').value = 1;
  } else if (mode === '2week') {
    document.getElementById('startDate').value = todayStr;
    document.getElementById('daysAhead').value = 14;
  } else {
    document.getElementById('startDate').value = todayStr;
    document.getElementById('daysAhead').value = 7;
  }
  triggerAutoSearch();
}

// Clear active quick-btn highlight when date/days inputs are changed manually
function onDateInputChange() {
  _dateQuickMode = null;
  document.querySelectorAll('.date-quick-btn').forEach(b => b.classList.remove('active'));
  const daysGroup = document.getElementById('daysAheadGroup');
  if (daysGroup) daysGroup.style.display = '';
  triggerAutoSearch();
}

// ── Collapsible filters (mobile) ─────────────────────────────────
// Redesign: filters are shown inline by default (the design has no collapse
// header); the toggle is hidden via CSS, but kept functional as a fallback.
let _filtersCollapsed = false;

function applyFiltersCollapsedState() {
  const body = document.getElementById('controlsBody');
  const chevron = document.getElementById('controlsChevron');
  if (body) body.style.display = _filtersCollapsed ? 'none' : '';
  if (chevron) chevron.classList.toggle('collapsed', _filtersCollapsed);
}

function toggleFilters() {
  _filtersCollapsed = !_filtersCollapsed;
  applyFiltersCollapsedState();
}
applyFiltersCollapsedState();

function clearFilters() {
  selectedInstructors.clear();
  // Re-apply favourites if any saved
  if (favouriteInstructors.size > 0) {
    favouriteInstructors.forEach(id => {
      if (instructors.some(i => String(i.id) === id)) selectedInstructors.add(id);
    });
  }
  document.getElementById('instrSearch').value = '';
  selectedLocations.clear();
  selectedCategories.clear();
  selectedStrengthSubs.clear();
  selectedStrengthSubs.add('UPPER'); selectedStrengthSubs.add('LOWER'); selectedStrengthSubs.add('FULL');
  selectedReformerSubs.clear();
  REFORMER_SUBS.forEach(s => selectedReformerSubs.add(s.key));
  renderInstrChips();
  renderStrengthSubPills();
  renderReformerSubPills();
  refreshFacetCounts(); // re-renders the instructor dropdown, studio chips, and class-type pills
  document.getElementById('startDate').value = localDateStr();
  document.getElementById('daysAhead').value = 7;
  document.getElementById('results').innerHTML = '<div class="status">Pick an instructor, studio, or date to search.</div>';
}

function setStatus(html) {
  document.getElementById('results').innerHTML = `<div class="status">${html}</div>`;
}

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
    const newEvents = batch.filter(e => !seenIds.has(e.id));
    if (newEvents.length === 0) break;
    newEvents.forEach(e => seenIds.add(e.id));
    locEvents = locEvents.concat(newEvents);
    if (!locRelations) locRelations = res.relations;
    else mergeRelations(locRelations, res.relations);
    if (batch.length < limit) break;
    // Advance start to 1 second after the last event to get the next page
    const sorted = batch.map(e => e.start_at).sort(); const lastTs = sorted[sorted.length - 1];
    const next = new Date(lastTs.replace(' ', 'T') + 'Z');
    next.setSeconds(next.getSeconds() + 1);
    windowStart = next.toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
  }
  return { events: locEvents, relations: locRelations };
}

let _searchSeq = 0;

// ── Pre-loaded timetable window + stale-while-revalidate cache ───────
// On launch we hydrate the full all-studios window from localStorage
// (instant smart filtering), then revalidate in the background so
// availability stays fresh. Studio/instructor/type filtering is entirely
// client-side over this window; only a date change or explicit Search
// re-fetches. Booking is validated server-side, so brief staleness can't
// cause a bad booking.
const WINDOW_CACHE_KEY = 'psycle_window_cache';
const WINDOW_CACHE_TTL = 24 * 60 * 60 * 1000;

function currentWindowDates() {
  const startDate = document.getElementById('startDate').value;
  const days = parseInt(document.getElementById('daysAhead').value) || 14;
  let endDateStr;
  if (_dateQuickMode === 'today' || _dateQuickMode === 'tomorrow') {
    endDateStr = startDate;
  } else {
    const [y, m, d] = startDate.split('-').map(Number);
    const end = new Date(y, m - 1, d + days);
    endDateStr = [end.getFullYear(), String(end.getMonth() + 1).padStart(2, '0'), String(end.getDate()).padStart(2, '0')].join('-');
  }
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
    }));
  refreshFacetCounts();
}

function _setWindow(windowKey, events, relations, fetchedAt) {
  window._windowKey = windowKey;
  window._windowEvents = events;
  window._windowRelations = relations;
  window._windowFetchedAt = fetchedAt || Date.now();
}

function _persistWindow(windowKey, events, relations) {
  try {
    localStorage.setItem(WINDOW_CACHE_KEY, JSON.stringify({ key: windowKey, fetchedAt: Date.now(), events, relations }));
  } catch (e) { /* quota / serialization — non-fatal; the in-memory cache still works */ }
}

function _readWindowCache() {
  try {
    const c = JSON.parse(localStorage.getItem(WINDOW_CACHE_KEY) || 'null');
    if (c && c.events && c.relations && c.fetchedAt && (Date.now() - c.fetchedAt) < WINDOW_CACHE_TTL) return c;
  } catch (e) {}
  return null;
}

function renderFromWindow(filters) {
  // An instant cached render owns the view from this moment: supersede any
  // in-flight search for a different range, or its late progressive renders
  // would append foreign day-groups on top of this view and restamp the
  // window key to the abandoned range.
  _searchSeq++;
  const cont = document.getElementById('results');
  if (cont) cont.innerHTML = '';
  render(window._windowEvents, window._windowRelations, filters, true);
  if (typeof refreshFacetCounts === 'function') refreshFacetCounts();
  renderLastUpdated();
}

// Unified Discover search (instructor / studio / class). Filters the cached
// window instantly; the per-dimension pill counts stay selection-based.
function onDiscoverSearch(v) {
  window._discoverQuery = (v || '').trim().toLowerCase();
  // Instant path only when the cached window matches the SELECTED range —
  // renderFromWindow supersedes in-flight fetches, and rendering a stale
  // range here would strand the fetch for the range the user actually picked.
  const wk = (typeof currentWindowDates === 'function') ? currentWindowDates().windowKey : null;
  if (window._windowEvents && wk && window._windowKey === wk) renderFromWindow(currentFilters());
  else if (typeof triggerAutoSearch === 'function') triggerAutoSearch();
}

// ── Pick-a-date calendar (redesign) ─────────────────────────────────
let _calMonth = null; // { y, m }
function toggleDatePicker() {
  const el = document.getElementById('datePicker');
  const btn = document.getElementById('pickDateBtn');
  if (!el) return;
  const willOpen = el.style.display === 'none' || !el.style.display;
  if (willOpen) {
    if (!_calMonth) { const d = new Date(); _calMonth = { y: d.getFullYear(), m: d.getMonth() }; }
    renderCalendar();
    el.style.display = '';
    if (btn) btn.classList.add('active');
  } else {
    el.style.display = 'none';
    if (btn) btn.classList.remove('active');
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
  document.querySelectorAll('.date-quick-btn').forEach(b => b.classList.remove('active'));
  const el = document.getElementById('datePicker'); if (el) el.style.display = 'none';
  const btn = document.getElementById('pickDateBtn'); if (btn) btn.classList.remove('active');
  if (typeof onDateInputChange === 'function') onDateInputChange();
  else if (typeof triggerAutoSearch === 'function') triggerAutoSearch();
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
    const click = past ? '' : ` onclick="pickCalDate('${ds}')"`;
    cells += `<button class="${cls}"${click}>${d}${dot}</button>`;
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

// Background refresh: silently re-fetch the current window, update the
// cache + facets, and re-render unless the user has moved on. No spinner.
async function revalidateWindow() {
  if (!getBearerToken()) return;
  const { startDate, endDateStr, windowKey } = currentWindowDates();
  const mySeq = ++_searchSeq;
  const stale = () => mySeq !== _searchSeq;
  let result;
  try { result = await fetchFullWindow(startDate, endDateStr, stale); }
  catch (e) { return; }
  if (!result || !result.relations) return;
  if (currentWindowDates().windowKey !== windowKey) return; // date changed mid-flight
  _setWindow(windowKey, result.events, result.relations);
  _persistWindow(windowKey, result.events, result.relations);
  _buildFacetClasses(result.events, result.relations);
  if (stale()) return; // a newer user action owns the view
  renderFromWindow(currentFilters());
}

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
  el.innerHTML = 'Updated ' + _relativeTime(window._windowFetchedAt) +
    ' · <button type="button" class="refresh-link" onclick="refreshWindow()">Refresh</button>';
}

// Manual refresh — silently re-fetch the current window (results stay
// visible while loading) and restamp "last updated".
async function refreshWindow() {
  const el = document.getElementById('lastUpdated');
  const btn = el && el.querySelector('.refresh-link');
  if (btn) { btn.textContent = 'Refreshing…'; btn.disabled = true; }
  try { await revalidateWindow(); } catch (e) {}
  renderLastUpdated();
}

async function search(opts) {
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

  // For today/tomorrow quick picks, end = same day (don't bleed into next day)
  let endDateStr;
  if (_dateQuickMode === 'today' || _dateQuickMode === 'tomorrow') {
    endDateStr = startDate;
  } else {
    // Parse YYYY-MM-DD manually to avoid UTC/local timezone shift
    const [y, m, d] = startDate.split('-').map(Number);
    const endDate = new Date(y, m - 1, d + days);
    endDateStr = [
      endDate.getFullYear(),
      String(endDate.getMonth() + 1).padStart(2, '0'),
      String(endDate.getDate()).padStart(2, '0')
    ].join('-');
  }

  const windowKey = startDate + '|' + endDateStr;
  const filters = { instructorId, locationIds, categoryKeys, startDate, endDateStr, strengthSubs: new Set(selectedStrengthSubs), reformerSubs: new Set(selectedReformerSubs) };

  // 1. In-memory window: studio/instructor/type filtering is entirely
  //    client-side, so when only those change (same date range) we re-render
  //    from the cached window instantly — no refetch.
  if (!force && window._windowKey === windowKey && Array.isArray(window._windowEvents) && window._windowRelations) {
    renderFromWindow(filters);
    return;
  }

  // 2. Persistent window (cross-launch): on first load only (no in-memory
  //    window yet) AND only when the cached date range matches the current
  //    one, hydrate instantly with NO network call. Otherwise fall through to
  //    a real fetch. A later date change has an in-memory window, so it also
  //    falls through to a fetch for that range.
  if (!force && !window._windowEvents) {
    const cached = _readWindowCache();
    if (cached && cached.key === windowKey) {
      // Daily model: a fresh (<24h), same-range cache loads with no network
      // call. It's refreshed only when it ages out (>24h), the date range
      // changes (new key → cache miss → fetch), or the user taps Refresh /
      // pull-to-refresh. Booking re-fetches live availability regardless.
      _setWindow(windowKey, cached.events, cached.relations, cached.fetchedAt);
      _buildFacetClasses(cached.events, cached.relations);
      renderFromWindow(filters);
      return;
    }
  }

  const btn = document.getElementById('searchBtn');
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Stop';
    btn.onclick = () => { window._searchAborted = true; };
  }
  window._searchAborted = false;

  setStatus('<span class="spinner"></span>Connecting…');

  let allEvents = [], relations = null;
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
          const sorted = batch.map(e => e.start_at).sort(); const lastTs = sorted[sorted.length - 1];
          const next = new Date(lastTs.replace(' ', 'T') + 'Z');
          next.setSeconds(next.getSeconds() + 1);
          windowStart = next.toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);
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

      const promises = locationsToFetch.map(async loc => {
        try {
          const { events, relations: rel } = await fetchEventsForLocation(loc.id, startDate, endDateStr, seenIds, stale);
          if (stale()) return;
          allEvents = allEvents.concat(events);
          if (!relations) relations = rel;
          else if (rel) mergeRelations(relations, rel);
        } catch (e) {
          failedStudios.push(loc.name ? loc.name.replace('Psycle ', '') : String(loc.id));
        } finally {
          done++;
          if (!stale() && relations) render(allEvents, relations, filters, done === total);
        }
      });

      await Promise.all(promises);

      if (!stale() && failedStudios.length) {
        if (failedStudios.length === total) throw new Error('All studios failed to load');
        toast(`Couldn't load ${failedStudios.join(', ')} — showing the other studios`, 'info');
      }
    }

    if (!stale()) {
      if (!relations) setStatus('No classes found.');
      else {
        _setWindow(windowKey, allEvents, relations);
        _persistWindow(windowKey, allEvents, relations);
        render(allEvents, relations, filters, true);
        _buildFacetClasses(allEvents, relations);
        renderLastUpdated();
      }
    }

  } catch (e) {
    if (!stale()) showSearchError(e);
  } finally {
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
        else setStatus('Search stopped — tap Search to retry.');
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
      banner.textContent = "Showing your last results — couldn't reach Psycle";
      container.insertBefore(banner, container.firstChild);
    }
    return;
  }

  setStatus(`<span style="color:#e94560">${escapeHTML(cat.userMessage || ('Error: ' + (e && e.message || 'Unknown error')))}</span>`);
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

async function bookClass(eventId, btn, studioId) {
  if (!currentUser) {
    toast('Connect your Psycle account first', 'error');
    showTokenDialog();
    return;
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

  // Already holding a waitlist place (no seat): the only sensible action is
  // managing that place — never the bike picker or a second join (Psycle
  // allows one place per person per class).
  if (_myBookings[String(eventId)]?.waitlisted) {
    try { await leaveWaitlist(eventId, btn); } finally { delete btn.dataset.busy; }
    return;
  }

  btn.disabled = true;
  btn.textContent = '…';

  try {
    const res = await apiFetch(`/events/${eventId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const detail = await res.json();
    // detail.slots = AVAILABLE (bookable) slot IDs
    const availableSlotIds = new Set((detail.slots || []).map(Number));

    const evtData = detail.data || {};
    const cached = _eventCache[String(eventId)] || {};
    const isFullyBooked = evtData.is_fully_booked ?? cached.is_fully_booked;
    const isWaitlistable = evtData.is_waitlistable ?? cached.is_waitlistable;
    const myBooking = _myBookings[String(eventId)];

    const studio = _studioMap[studioId];
    const layout = studio?.layout;
    const hasLayout = studio?.has_layout && layout?.slots?.length > 0;

    // Full class and we're not in it → waitlist path (a separate resource:
    // PUT /waitlists/{eventId}). There's no seat to pick, so never open the
    // bike picker here.
    const noSeatsLeft = isFullyBooked || (hasLayout && availableSlotIds.size === 0);
    if (noSeatsLeft && !myBooking) {
      btn.disabled = false;
      if (!isWaitlistable) {
        btn.textContent = 'Full';
        toast('This class is full', 'info');
        return;
      }
      btn.textContent = 'Join Waitlist';
      await confirmJoinWaitlist(eventId, btn);
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
        confirmText: 'Book it',
      });
      if (ok) {
        await submitBooking(eventId, [onlySlotId], btn);
      } else {
        btn.disabled = false;
        btn.textContent = 'Book';
      }
      return;
    }

    if (hasLayout) {
      btn.disabled = false;
      btn.textContent = 'Book';
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
      showBikePicker(eventId, btn, layout, availableSlotIds, mySlots, studio.name);
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
        warn: "Psycle's normal 12-hour cancellation policy applies.",
        confirmText: heldAlready ? 'Book one more' : 'Book it',
        cancelText: 'Not now',
      });
      if (!ok) {
        btn.disabled = false;
        if (heldAlready) applyBookedState(btn, eventId, myBooking); else btn.textContent = 'Book';
        return;
      }
      await submitBooking(eventId, null, btn, studio && studio.has_layout === false ? { spaces: 1 } : {});
    }
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Book';
    toast(e.message, 'error');
  } finally {
    delete btn.dataset.busy;
  }
}

function showBikePicker(eventId, btn, layout, availableSlotIds, mySlotIds, studioName) {
  _bookingContext = { eventId, btn };
  _selectedSlots = [];

  const hasMySlots = mySlotIds.size > 0;
  const _sl = slotLabelForEvent(eventId).toLowerCase();
  const _SL = slotLabelForEvent(eventId);
  document.getElementById('modalTitle').textContent = hasMySlots ? 'Your booking' : `Select your ${pluralizeSlotLabel(_sl)}`;

  // Feature 4: Enhanced class summary header
  const _evt = _eventCache[String(eventId)];
  if (_evt) {
    const _d = new Date(_evt.start_at);
    const _days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const _months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const _h = _d.getHours(), _m = _d.getMinutes();
    const _ampm = _h >= 12 ? 'pm' : 'am';
    const _h12 = _h % 12 || 12;
    const _timeStr = `${_h12}:${String(_m).padStart(2,'0')}${_ampm}`;
    const _dateStr = `${_days[_d.getDay()]} ${_d.getDate()} ${_months[_d.getMonth()]}`;
    const line1 = [_evt._typeName, _evt._instrName, `${_dateStr}, ${_timeStr}`].filter(Boolean).join(' \u00b7 ');
    const line2 = [_evt._locName, _evt._studioName].filter(Boolean).join(' \u00b7 ');
    const sub = document.getElementById('modalSubtitle');
    sub.innerHTML = `<span class="modal-subtitle-line">${escapeHTML(line1)}</span><br><span class="modal-subtitle-line">${escapeHTML(line2)}</span>`;
  } else {
    document.getElementById('modalSubtitle').textContent = studioName;
  }

  document.getElementById('modalHint').textContent = hasMySlots
    ? `Your ${pluralizeSlotLabel(_sl)} shown in green — click to cancel. Select another to book.`
    : `Select up to ${MAX_SEATS} ${pluralizeSlotLabel(_sl)}`;
  // Fully reset the confirm button on every open — changeSpot() overrides the
  // label and handler for swap mode, and without this reset those overrides
  // (and a stale "Swapping..." label) would leak into later normal bookings.
  const _confirmBtn = document.getElementById('confirmBookBtn');
  _confirmBtn.disabled = true;
  _confirmBtn.textContent = 'Confirm booking';
  _confirmBtn.onclick = confirmBikeBooking;

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

  let inner = objects.map(obj =>
    `<rect x="${sx(obj.x)}" y="${sy(obj.y)}" width="${SLOT}" height="${SLOT}"
      rx="4" fill="#1a1a0a" stroke="#333" stroke-dasharray="3,3"/>
    <text x="${sx(obj.x)+SLOT/2}" y="${sy(obj.y)+SLOT/2+4}" text-anchor="middle"
      fill="#555" font-size="9" font-family="sans-serif">★</text>`
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
    const click = isMine
      ? (isChangeSpot ? `onclick="setChangeSpotTarget(${slot.id})"` : `onclick="cancelBikeSlot(${slot.id}, ${eventId})"`)
      : isAvailable ? `onclick="selectBike(${slot.id})"` : '';
    return `<g class="bike-slot ${cls}" data-slot="${slot.id}" ${click}>
      <rect x="${sx(slot.x)}" y="${sy(slot.y)}" width="${SLOT}" height="${SLOT}" rx="6" stroke-width="1.5"/>
      <text x="${sx(slot.x)+SLOT/2}" y="${sy(slot.y)+SLOT/2+4}"
        text-anchor="middle" font-family="sans-serif" font-size="11">${label}</text>
    </g>`;
  }).join('');

  svg.innerHTML = inner;
  document.getElementById('bikeModal').style.display = 'flex';

  // Pre-select the usual slot so Confirm is enabled (without auto-confirming).
  if (usualAvailable) {
    _selectedSlots = [Number(usualSlot)];
    const _slU = slotLabelForEvent(eventId);
    document.getElementById('modalHint').textContent =
      `${_slU} ${usualSlot} is your usual — selected. Confirm or pick another.`;
    document.getElementById('confirmBookBtn').disabled = false;
  }
}

function selectBike(slotId) {
  const id = Number(slotId);
  const swapMode = !!window._changeSpotContext;
  const idx = _selectedSlots.indexOf(id);
  if (idx !== -1) {
    // deselect
    _selectedSlots.splice(idx, 1);
    document.querySelector(`.bike-slot[data-slot="${id}"]`)?.classList.replace('selected', 'available');
  } else {
    // A swap replaces exactly one seat, so swap mode is single-select.
    const maxSel = swapMode ? 1 : MAX_SEATS;
    while (_selectedSlots.length >= maxSel) {
      const evicted = _selectedSlots.shift();
      document.querySelector(`.bike-slot[data-slot="${evicted}"]`)?.classList.replace('selected', 'available');
    }
    _selectedSlots.push(id);
    document.querySelector(`.bike-slot[data-slot="${id}"]`)?.classList.replace('available', 'selected');
  }
  if (swapMode) {
    // Keep the change-spot chips + swap hint instead of the generic booking hint.
    renderChangeSpotHint();
    document.getElementById('confirmBookBtn').disabled = _selectedSlots.length === 0;
    return;
  }
  const count = _selectedSlots.length;
  const _sl2 = _bookingContext ? slotLabelForEvent(_bookingContext.eventId) : 'Spot';
  document.getElementById('modalHint').textContent =
    count === 0 ? `Select up to ${MAX_SEATS} ${pluralizeSlotLabel(_sl2.toLowerCase())}`
    : count === 1 ? `${_sl2} ${_selectedSlots[0]} selected — pick a second or confirm`
    : `${formatSlots(_sl2, _selectedSlots)} selected`;
  document.getElementById('confirmBookBtn').disabled = count === 0;
}

function closeBikePicker() {
  document.getElementById('bikeModal').style.display = 'none';
  _bookingContext = null;
  _selectedSlots = [];
  // Abandoning a swap must not leave its context or button overrides behind —
  // a stale context would make the next booking's confirm cancel the wrong class.
  window._changeSpotContext = null;
  const confirmBtn = document.getElementById('confirmBookBtn');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Confirm booking';
    confirmBtn.onclick = confirmBikeBooking;
  }
}

async function confirmBikeBooking() {
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
  return { places, allocated, newlyAllocated };
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
const WAITLIST_OFFER_WINDOW_MS = 150 * 60000; // generous: FAQ says ≤2h (or after 10pm for 6–9am classes)
const _offerProbeAt = {};
// Resolves to { probed, changed, allocated } — `changed` when a card should
// re-render, `allocated` when a probed place turned out to be a seat already
// (caller reloads bookings). Dead (cancelled/expired) places are dropped.
async function _probeWaitlistOffers(bookings) {
  const now = Date.now();
  const result = { probed: 0, changed: false, allocated: false };
  const candidates = Object.keys(bookings).filter(id => {
    const b = bookings[id];
    if (!b || !b.waitlisted || !b.waitlist || !b.waitlist.id) return false;
    if (now - (_offerProbeAt[b.waitlist.id] || 0) < 90000) return false;
    if (_waitlistOfferPending(b.waitlist, now)) return true;
    const evt = _eventCache[id];
    const startMs = evt ? _waitlistTimeMs(evt.start_at) : NaN;
    if (isNaN(startMs) || startMs <= now) return false;
    if (startMs - now <= WAITLIST_OFFER_WINDOW_MS) return true;
    // Early classes (6–9am): offers go out from 10pm the night before.
    const h = new Date(startMs).getHours();
    return h >= 6 && h <= 9 && startMs - now <= 11 * 3600000 && new Date(now).getHours() >= 22;
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
function _markSeatFreed(eventId) {
  const evt = _eventCache[String(eventId)];
  if (evt) evt.is_fully_booked = false;
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
function _bookingIdsFor(booking, explicitId) {
  const perSlot = booking?.slotBookings ? Object.values(booking.slotBookings).filter(Boolean) : [];
  if (perSlot.length) return perSlot;
  // Slot-less (no-layout) bookings: every record id we read for the event.
  const all = Array.isArray(booking?.bookingIds) ? booking.bookingIds.filter(Boolean) : [];
  if (all.length) return all;
  if (explicitId) return [explicitId];
  return booking?.bookingId ? [booking.bookingId] : [];
}

// Field NAMES of the first entry go to diagnostics (never values) so a shape
// change in this unofficial resource shows up in bug reports.
function _recordWaitlistShape(kind, sample) {
  try {
    if (sample && window.PsycleDiag && typeof window.PsycleDiag.record === 'function') {
      window.PsycleDiag.record(kind, sample);
    }
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
    if (page === 1 && list.length) _recordWaitlistShape('waitlist', list[0]);
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

function _waitlistClassLine(eventId) {
  const evt = _eventCache[String(eventId)];
  if (!evt) return '';
  let when = '';
  const d = new Date(String(evt.start_at).replace(' ', 'T'));
  if (!isNaN(d.getTime())) {
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const h = d.getHours(), m = d.getMinutes();
    when = `${days[d.getDay()]} ${d.getDate()}, ${h % 12 || 12}:${String(m).padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`;
  }
  return [evt._typeName, evt._instrName, when].filter(Boolean).join(' · ');
}

// Ask first, then join. Used by bookClass (Discover card, class detail sheet,
// rebook flows) — the one consent dialog before PUT /waitlists.
async function confirmJoinWaitlist(eventId, btn) {
  const line = _waitlistClassLine(eventId);
  const ok = await confirmModal({
    title: 'Join the waitlist?',
    body: (line ? line + ' is full. ' : 'This class is full. ') +
      'Psycle fills freed-up spots from the waitlist automatically, first come first served — keep a credit free so you can be booked in. Close to class time they email an offer instead, which you can also accept here in My Bookings.',
    warn: 'One waitlist place per person. Once you’re given a spot the normal 12-hour cancellation policy applies; the waitlist closes 30 minutes before class.',
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
  btn.textContent = '…';
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
    // chargeable seat) — never report that as a plain failure.
    const unsure = () => {
      fail('Join Waitlist', "Couldn't confirm with Psycle whether you joined — check My Bookings in a moment", 'info');
      setTimeout(() => { try { fetchMyBookings(); } catch (err) {} }, 3000);
      return false;
    };
    if (res.ok && data && data.success === false) {
      return fail('Failed — retry', message || "Psycle didn't add you to the waitlist");
    } else if (res.ok) {
      entry = _waitlistEntryFromResponse(data, eventId);
      if (data && data.waitlist) _recordWaitlistShape('waitlist-join', data.waitlist);
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
      return fail('Failed — retry', e.message || "Couldn't join the waitlist");
    } else {
      fail('Join Waitlist', "Couldn't confirm with Psycle whether you joined — check My Bookings in a moment", 'info');
      setTimeout(() => { try { fetchMyBookings(); } catch (err) {} }, 3000);
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
    return fail('Failed — retry', e.message || "Couldn't join the waitlist");
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
    const ok = await confirmModal({
      title: 'Leave the waitlist?',
      body: line ? `${line}. You'll lose your place in the queue.` : "You'll lose your place in the queue.",
      warn: hasSeat ? '' : 'If Psycle has only just given you a spot, that booking stays — it will show in My Bookings.',
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
  btn.textContent = '…';
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
      : ((e && e.message) || "Couldn't leave the waitlist"), 'error');
    setTimeout(() => { try { fetchMyBookings(); } catch (err) {} }, 1500);
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
  btn.textContent = '…';
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
    _recordWaitlistShape('waitlist-offer', data.data || null);
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
    const ok = await confirmModal({
      title: 'Claim this spot?',
      body: (line ? line + '. ' : '') +
        (free ? `${free} space${free === 1 ? '' : 's'} free right now — it isn't held for you. ` : 'A space is free right now — it isn’t held for you. ') +
        'This books you into the class' +
        (credits > 0 ? ` and uses ${credits} credit${credits === 1 ? '' : 's'}` + (have > 0 ? ` (you have ${have})` : '') + '.' : '.'),
      warn: "Psycle's normal 12-hour cancellation policy applies once you're booked.",
      confirmText: 'Claim spot',
      cancelText: 'Not now',
    });
    if (!ok) { restore(); return false; }
    btn.textContent = '…';
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
    toast(e.message || "Couldn't claim the spot", 'error');
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
  btn.textContent = '…';
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
      const bookingId = data?.data?.id || data?.id;
      if (bookingId) btn.dataset.bookingId = bookingId;
      btn.dataset.eventId = eventId;
      // Update local bookings state
      const slotsArr = slots ? slots.map(Number) : [];
      const slotBookings = {};
      // The API creates one booking per slot; after a fresh book we only know the
      // returned bookingId — map all slots to it (fetchMyBookings will correct later)
      slotsArr.forEach(s => { slotBookings[s] = bookingId; });
      // A place we held on the waitlist for this class is superseded by the seat
      // (kept attached; forgotten as a "held place" so it can't later be
      // mistaken for a Psycle allocation).
      const prevEntry = _myBookings[String(eventId)];
      const prevPlace = prevEntry?.waitlist;
      // Keep every record id we know of (a no-layout "one more space" adds a
      // record next to the existing one) so a whole cancel removes them all.
      const prevIds = (!slotsArr.length && prevEntry && !prevEntry.waitlisted && !(prevEntry.slots || []).length) ? _bookingIdsFor(prevEntry) : [];
      const bookingIds = [...prevIds, ...(bookingId != null && !prevIds.includes(bookingId) ? [bookingId] : [])];
      _myBookings[String(eventId)] = { bookingId: bookingId || prevEntry?.bookingId || null, bookingIds, slots: slotsArr, slotBookings, waitlisted: false };
      if (prevPlace) { _myBookings[String(eventId)].waitlist = prevPlace; _rememberPlace(eventId, null); }
      _noteLocalBookingWrite();
      // Remember the booked slot(s) per studio+instructor for next time.
      if (slotsArr.length) _recordBikeHistory(eventId, slotsArr);
      btn.onclick = () => confirmUnbook(bookingId || null, eventId, btn);
      showBookingConfirmation(eventId, slotsArr);
      refreshUpcomingPanel();
      PsycleEvents.emit('booking:complete', eventId, slotsArr, btn);
    } else if (res.status === 409 || (data.message || '').toLowerCase().includes('already')) {
      btn.textContent = 'Already booked ✓';
      btn.className = 'book-btn booked';
      btn.disabled = true;
      toast("You're already in this class", 'info');
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
    btn.textContent = 'Failed — retry';
    btn.disabled = false;
    toast(e.message, 'error');
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
    const h = d.getHours(), m = d.getMinutes();
    const ampm = h >= 12 ? 'pm' : 'am';
    const h12 = h % 12 || 12;
    dateTimeStr = `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}, ${h12}:${String(m).padStart(2,'0')}${ampm}`;
  }

  // Build slot label
  const slotStr = formatSlots(_SL, slotsArr);

  // Class info line
  const classLine = [typeName, instrName].filter(Boolean).join(' \u00b7 ');

  const el = document.createElement('div');
  el.id = 'bookingConfirmation';
  el.className = 'booking-confirmation';
  el.innerHTML = `
    <div class="bc-content">
      <div class="bc-check">&#10003;</div>
      <div class="bc-text">
        <div class="bc-title">${opts.waitlist ? (opts.already ? 'Already on the waitlist' : 'On the waitlist!') : 'Booked!'}</div>
        <div class="bc-detail">${escapeHTML(classLine)}</div>
        ${dateTimeStr ? `<div class="bc-detail bc-dim">${escapeHTML(dateTimeStr)}</div>` : ''}
        ${opts.waitlist ? `<div class="bc-detail bc-dim">Psycle books you in automatically if a spot frees up — keep a credit free</div>` : ''}
        ${slotStr ? `<div class="bc-slot">${slotStr}</div>` : ''}
      </div>
    </div>
    <div class="bc-actions">
      <button class="bc-btn bc-btn-secondary" onclick="dismissBookingConfirmation();(typeof switchTab==='function'?switchTab('bookings'):scrollToUpcoming())">View my bookings</button>
      <button class="bc-btn bc-btn-primary" onclick="dismissBookingConfirmation()">Done</button>
    </div>
  `;
  document.body.appendChild(el);

  // Trigger animation on next frame
  requestAnimationFrame(() => { el.classList.add('show'); });

  // Auto-dismiss after 5 seconds
  _confirmationTimer = setTimeout(dismissBookingConfirmation, 5000);
}

function dismissBookingConfirmation() {
  clearTimeout(_confirmationTimer);
  _confirmationTimer = null;
  const el = document.getElementById('bookingConfirmation');
  if (!el) return;
  el.classList.remove('show');
  el.addEventListener('transitionend', () => el.remove(), { once: true });
  // Fallback removal if transition doesn't fire
  setTimeout(() => { if (el.parentNode) el.remove(); }, 400);
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
 * confirmModal({ title, body, warn?, confirmText?, cancelText?, danger? })
 *   → Promise<boolean>
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
    overlay.innerHTML = `
      <div class="confirm-dialog" role="dialog" aria-modal="true" tabindex="-1">
        ${opts.title ? `<div class="confirm-title">${escapeHTML(opts.title)}</div>` : ''}
        ${opts.body ? `<div class="confirm-body">${escapeHTML(opts.body)}</div>` : ''}
        ${opts.warn ? `<div class="confirm-warn">${escapeHTML(opts.warn)}</div>` : ''}
        <div class="confirm-actions">
          <button class="confirm-btn confirm-btn-cancel">${escapeHTML(opts.cancelText || 'Keep booking')}</button>
          <button class="confirm-btn ${opts.danger ? 'confirm-btn-danger' : 'confirm-btn-primary'}">${escapeHTML(opts.confirmText || 'Confirm')}</button>
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
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 180);
      document.removeEventListener('keydown', onKey);
      // Restore focus to the element that opened the modal
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        try { previouslyFocused.focus(); } catch {}
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
window.confirmModal = confirmModal;

/**
 * Turn a failed cancel into a user-friendly message. Distinguishes session
 * expiry (401), offline, and server errors (prefers server `message`).
 * 403 is a policy denial (e.g. inside the late-cancel window) with a valid
 * session — show the server's reason, not "session expired".
 */
function describeCancelError(failedResponse, data, err) {
  if (err) {
    // Network error bubbled up from fetch()
    if (!navigator.onLine || /network|failed to fetch/i.test(err.message || '')) {
      return "You're offline — we'll retry when you're back online.";
    }
    return err.message || 'Cancel failed';
  }
  if (failedResponse) {
    if (failedResponse.status === 401) {
      return 'Session expired — sign in and try again.';
    }
    if ((data && data.message)) return data.message;
    if (failedResponse.status === 403) {
      return "Psycle wouldn't allow this cancellation (it may be inside the late-cancel window).";
    }
    return `Cancel failed (${failedResponse.status})`;
  }
  return 'Cancel failed';
}

/**
 * Ask the user to confirm cancelling a booking. When the class is inside
 * Psycle's 12-hour late-cancel window the modal surfaces a warning about
 * likely charges. Returns Promise<boolean>.
 */
function confirmCancelWithPolicy(eventId, base) {
  // (Waitlist places never reach this gate: confirmUnbook/upcomingCancel hand
  // them to leaveWaitlist, which owns its own dialog.)
  const evt = _eventCache[String(eventId)];
  const msUntil = evt ? (new Date(evt.start_at).getTime() - Date.now()) : Infinity;
  const hoursUntil = msUntil / 3600000;
  if (isFinite(hoursUntil) && hoursUntil < 12 && hoursUntil > -0.5) {
    let remaining;
    if (hoursUntil < 0) remaining = 'has already started';
    else if (hoursUntil < 1) remaining = `starts in ${Math.max(1, Math.round(hoursUntil * 60))} min`;
    else remaining = `starts in ${Math.floor(hoursUntil)}h ${Math.round((hoursUntil % 1) * 60)}m`;
    return confirmModal({
      title: base,
      warn: `This class ${remaining}. Cancellations inside 12 hours are usually charged by Psycle.`,
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

async function cancelBikeSlot(slotId, eventId) {
  const booking = _myBookings[String(eventId)];
  const _sl3 = slotLabelForEvent(eventId);
  if (!(await confirmCancelWithPolicy(eventId, `Cancel your ${_sl3} ${slotId} booking?`))) return;
  // update hint immediately
  document.getElementById('modalHint').textContent = 'Cancelling…';
  try {
    const resolvedId = booking?.slotBookings?.[slotId] || booking?.bookingId;
    const path = resolvedId ? `/bookings/${resolvedId}` : `/bookings?event_id=${eventId}`;
    const res = await apiFetch(path, { method: 'DELETE' });
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
    }
  } catch (e) {
    document.getElementById('modalHint').textContent = 'Cancel failed — try again';
    toast(describeCancelError(null, null, e), 'error');
  }
}

async function confirmUnbook(bookingId, eventId, btn) {
  // A waitlist place is not a booking: it lives at /waitlists/{entryId} and
  // must never reach the DELETE /bookings paths below (a 404 there reads as
  // "cancelled" while the place survives server-side).
  if (_myBookings[String(eventId)]?.waitlisted) return leaveWaitlist(eventId, btn);
  if (!(await confirmCancelWithPolicy(eventId, 'Cancel this booking?'))) return;
  btn.disabled = true;
  btn.textContent = '…';
  const booking = _myBookings[String(eventId)];

  const bookingIds = _bookingIdsFor(booking, bookingId);

  // Offline: queue the cancel and optimistically clear local state.
  if (!navigator.onLine && typeof queueOfflineCancel === 'function') {
    queueOfflineCancel(eventId, bookingIds);
    _dropBookingKeepPlace(eventId);
    _afterCardCancel(btn, eventId);
    refreshUpcomingPanel();
    toast("You're offline — cancel queued", 'info');
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
      }
    }
  } catch (e) {
    // Network failure after the confirm — queue instead of losing the intent.
    if (!navigator.onLine && typeof queueOfflineCancel === 'function') {
      queueOfflineCancel(eventId, bookingIds);
      _dropBookingKeepPlace(eventId);
      _afterCardCancel(btn, eventId);
      refreshUpcomingPanel();
      toast("You're offline — cancel queued", 'info');
      PsycleEvents.emit('booking:cancelled', eventId);
      return;
    }
    btn.disabled = false;
    btn.textContent = 'Booked ✓';
    toast(describeCancelError(null, null, e), 'error');
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

function eventCard(evt, instrMap, studioMap, locationMap, typeMap) {
  const instr = instrMap[evt.instructor_id];
  const studio = studioMap[evt.studio_id];
  const loc = studio ? locationMap[studio.location_id] : null;
  const type = typeMap[evt.event_type_id];

  const dt = new Date(evt.start_at);
  const hours = dt.getHours();
  const mins = dt.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  const h12 = hours % 12 || 12;

  const locName = loc ? loc.name.replace('Psycle ', '') : '';
  const studioName = studio ? studio.name : '';

  let badges = `<span class="badge">${evt.duration}min</span>`;
  const isFull = evt.is_fully_booked && !evt.is_waitlistable;
  const isWaitlist = evt.is_fully_booked && evt.is_waitlistable;
  if (isFull) badges += `<span class="badge full">Full</span>`;
  else if (isWaitlist) badges += `<span class="badge waitlist">Waitlist</span>`;
  if (evt.is_live_stream) badges += `<span class="badge highlight">Online</span>`;

  const myBooking = _myBookings[String(evt.id)];

  // Feature: capacity urgency chip — only with a real remaining count, and
  // only when the class is bookable (not booked, full, or waitlist).
  if (!myBooking && !isFull && !isWaitlist && typeof evt.capacity_remaining === 'number') {
    const rem = evt.capacity_remaining;
    if (rem >= 1 && rem <= 3) {
      badges += `<span class="badge avail-urgent">Only ${rem} left</span>`;
    } else if (rem >= 4 && rem <= 7) {
      badges += `<span class="badge avail-soft">${rem} spots left</span>`;
    }
  }

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

  // Availability line, in the redesign's wording.
  let spotsHtml = '';
  if (!myBooking) {
    if (isFull) spotsHtml = '<span class="cc-spots">Waitlist only</span>';
    else if (isWaitlist) spotsHtml = '<span class="cc-spots">Waitlist open</span>';
    else if (typeof evt.capacity_remaining === 'number') {
      const r = evt.capacity_remaining;
      if (r <= 0) spotsHtml = '<span class="cc-spots">Waitlist only</span>';
      else if (r <= 3) spotsHtml = `<span class="cc-spots low">Only ${r} left</span>`;
      else spotsHtml = `<span class="cc-spots">${r} spots left</span>`;
    }
  }
  const onlineMeta = evt.is_live_stream ? '<div class="cc-meta"><span class="badge highlight">Online</span></div>' : '';

  return `<div class="class-card${myBooking ? (myBooking.waitlisted ? ' is-waitlisted' : ' is-booked') : ''}" data-id="${evt.id}" data-studio-id="${evt.studio_id}"
    onclick="openClassDetail(${evt.id})" style="cursor:pointer">
    <div class="cc-time">
      <span class="cc-time-h">${h12}:${mins}<span class="cc-ampm">${ampm}</span></span>
      <span class="cc-dur">${evt.duration} min</span>
    </div>
    <div class="cc-rule"></div>
    <div class="cc-info">
      <span class="cc-name">${escapeHTML(type?.name || 'Class')}</span>
      <span class="cc-sub">${instrLink(instr?.full_name, instr?.id)}${window.tierBadgeHTML ? window.tierBadgeHTML(instr?.id) : ''}${locName ? ' · ' + escapeHTML(locName) : ''}</span>
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

function render(events, relations, filters, done) {
  if (!relations) return; // nothing to map without relation data
  const instrMap = Object.fromEntries((relations.instructors || []).map(i => [i.id, i]));
  const studioMap = Object.fromEntries((relations.studios || []).map(s => [s.id, s]));
  const locationMap = Object.fromEntries((relations.locations || []).map(l => [l.id, l]));
  const typeMap = Object.fromEntries((relations.event_types || []).map(t => [t.id, t]));
  Object.assign(_studioMap, studioMap); // expose globally for bookClass

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
    };
  });

  const now = new Date();

  // (Facet counts are rebuilt at the data source — _buildFacetClasses() on
  // fetch/hydrate/revalidate — not here, so they don't depend on render's
  // progressive `done` flag and stay correct on multi-location fetches.)

  const filtered = events.filter(e => {
    // Never show classes that have already started
    if (new Date(e.start_at) < now) return false;
    if (filters.instructorId.length && !filters.instructorId.includes(String(e.instructor_id))) return false;
    // Category filter
    const typeName = typeMap[e.event_type_id]?.name || '';
    if (filters.categoryKeys && filters.categoryKeys.size > 0) {
      const cat = getCategory(typeName);
      if (!filters.categoryKeys.has(cat.key)) return false;
    }
    // Strength sub-filter — only applies when this is a strength class
    // and not all subs are selected (all = no filtering)
    if (filters.strengthSubs && filters.strengthSubs.size < 3) {
      const cat = getCategory(typeName);
      if (cat.key === 'STRENGTH') {
        const matchedSub = STRENGTH_SUBS.find(s => typeName.includes(s.match));
        if (matchedSub && !filters.strengthSubs.has(matchedSub.key)) return false;
      }
    }
    // Reformer sub-filter — same semantics for Pilates variants
    if (filters.reformerSubs && filters.reformerSubs.size < REFORMER_SUBS.length) {
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
    return true;
  });

  const container = document.getElementById('results');

  if (filtered.length === 0 && done) {
    container.innerHTML = '<div class="no-results">No classes found for these filters.</div>';
    return;
  }

  // Group by day
  const byDay = {};
  filtered.forEach(e => {
    const day = e.start_at.split('T')[0];
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
  if (done) refreshUpcomingPanel();
  // Incrementally update day groups
  const sortedDays = Object.keys(byDay).sort();
  for (const day of sortedDays) {
    // Sort by time
    const dayEvents = byDay[day].sort((a, b) => a.start_at.localeCompare(b.start_at));
    const date = new Date(day + 'T12:00:00');
    const dayLabel = date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    let group = container.querySelector(`[data-day="${day}"]`);
    if (!group) {
      group = document.createElement('div');
      group.className = 'day-group';
      group.dataset.day = day;
      group.innerHTML = `<div class="day-header">${dayLabel}</div><div class="day-body"></div>`;
      const existing = [...container.querySelectorAll('[data-day]')];
      const after = existing.find(el => el.dataset.day > day);
      after ? container.insertBefore(group, after) : container.appendChild(group);
    }

    const body = group.querySelector('.day-body');

    // All of the day's classes in ONE list, mixed across types and time-sorted
    // (no per-category sections) — so multiple selected class types interleave.
    let grid = body.querySelector('.class-grid');
    if (!grid) {
      grid = document.createElement('div');
      grid.className = 'class-grid';
      body.appendChild(grid);
    }
    const existingIds = new Set([...grid.querySelectorAll('[data-id]')].map(el => el.dataset.id));
    for (const evt of dayEvents) { // dayEvents is already time-sorted above
      if (existingIds.has(String(evt.id))) continue;
      const newCard = document.createElement('div');
      newCard.innerHTML = eventCard(evt, instrMap, studioMap, locationMap, typeMap);
      const card = newCard.firstElementChild;
      const existing = [...grid.querySelectorAll('[data-id]')];
      const insertBefore = existing.find(el => {
        const elEvt = dayEvents.find(e => String(e.id) === el.dataset.id);
        return elEvt && elEvt.start_at > evt.start_at;
      });
      insertBefore ? grid.insertBefore(card, insertBefore) : grid.appendChild(card);
    }
  }

  // Feature 13: Persist search results to sessionStorage for tab-switch restore
  if (done) {
    try {
      sessionStorage.setItem('psycle_last_results', JSON.stringify({ events, relations, filters: {
        instructorId: filters.instructorId,
        locationIds: filters.locationIds || [],
        categoryKeys: [...(filters.categoryKeys || [])],
        startDate: filters.startDate,
        endDateStr: filters.endDateStr,
        strengthSubs: [...(filters.strengthSubs || [])],
        reformerSubs: [...(filters.reformerSubs || [])],
        _isTodaySchedule: filters._isTodaySchedule || false,
      }}));
    } catch (e) { console.warn('[psycle] sessionStorage save failed:', e); }
  }
}

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
  let html = `<button class="loc-chip${allActive ? ' active' : ''}" onclick="toggleLocation('')">All</button>`;
  html += locations.map(l => {
    const active = selectedLocations.has(String(l.id));
    const n = counts ? (counts[String(l.id)] || 0) : null;
    const dim = (counts && n === 0 && !active) ? ' dimmed' : '';
    const badge = n != null ? `<span class="chip-count">${n}</span>` : '';
    return `<button class="loc-chip${active ? ' active' : ''}${dim}" onclick="toggleLocation('${l.id}')">${escapeHTML(l.name.replace('Psycle ', ''))}${badge}</button>`;
  }).join('');
  box.innerHTML = html;
  updateLocationHint();
}

function toggleLocation(id) {
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
  hint.textContent = selectedLocations.size === 0 ? '— all studios (slower)' : '';
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

// ── Favourite instructors (persisted to localStorage) ────────────
const FAV_KEY = 'psycle_fav_instructors';

function loadFavourites() {
  try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]')); }
  catch { return new Set(); }
}

function saveFavourites(favs) {
  localStorage.setItem(FAV_KEY, JSON.stringify([...favs]));
}

// Initialize favourites into PsycleState from localStorage
favouriteInstructors = loadFavourites();

function toggleFavourite(id, e) {
  e.stopPropagation();
  const sid = String(id);
  if (favouriteInstructors.has(sid)) favouriteInstructors.delete(sid);
  else favouriteInstructors.add(sid);
  saveFavourites(favouriteInstructors);
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
    return `<span class="instr-chip">${escapeHTML(name)}
      <button type="button" onmousedown="event.preventDefault();removeInstructor('${id}')" title="Remove">×</button>
    </span>`;
  }).join('');
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
    : '<div class="instr-option" style="color:#555;cursor:default">No matches</div>';
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
  container.innerHTML = catsToShow.map(cat => {
    const active = selectedCategories.has(cat.key);
    const n = counts ? (counts[cat.key] || 0) : null;
    const dim = (counts && n === 0 && !active) ? ' dimmed' : '';
    const badge = n != null ? `<span class="pill-count">${n}</span>` : '';
    return `<button class="cat-pill${active ? ' active' : ''}${dim}"
      onclick="toggleCategory('${cat.key}')">${cat.label}${badge}</button>`;
  }).join('');
}

function toggleCategory(key) {
  if (selectedCategories.has(key)) selectedCategories.delete(key);
  else selectedCategories.add(key);
  refreshFacetCounts();
  renderStrengthSubPills();
  renderReformerSubPills();
  triggerAutoSearch();
}
// ────────────────────────────────────────────────────────────────

// Allow pressing Enter to search — scoped to the filters panel so Enter
// inside dialogs/modals elsewhere doesn't fire a surprise search.
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (document.getElementById('psycleConfirmOverlay')) return;
  if (!e.target || !e.target.closest || !e.target.closest('#controlsPanel')) return;
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
function getCountdownText(eventDate, now) {
  const diff = eventDate.getTime() - now.getTime();
  if (diff <= 0) return null; // past

  const diffHours = diff / (1000 * 60 * 60);
  const todayStr = localDateStr(now);
  const eventDayStr = localDateStr(eventDate);

  // Check if tomorrow
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = localDateStr(tomorrow);

  if (eventDayStr === todayStr) {
    const hrs = Math.floor(diffHours);
    const mins = Math.round((diffHours - hrs) * 60);
    if (hrs === 0) return `In ${mins}min`;
    if (mins === 0) return `In ${hrs}h`;
    return `In ${hrs}h ${mins}m`;
  } else if (eventDayStr === tomorrowStr) {
    const h = eventDate.getHours();
    const m = eventDate.getMinutes().toString().padStart(2, '0');
    const ampm = h >= 12 ? 'pm' : 'am';
    const h12 = h % 12 || 12;
    return `Tomorrow ${h12}:${m}${ampm}`;
  }
  return null; // not today or tomorrow
}

function renderMyBookings() {
  const panel = document.getElementById('upcomingPanel');
  const list = document.getElementById('upcomingList');
  const countEl = document.getElementById('upcomingCount');

  const now = new Date();
  const all = Object.entries(_myBookings)
    .map(([evtId, booking]) => {
      const evt = _eventCache[evtId];
      return evt ? { evt, booking, evtId } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.evt.start_at.localeCompare(b.evt.start_at));

  const upcoming = all.filter(({ evt }) => new Date(evt.start_at) > now);
  // A waitlist place that never became a seat is not an attended class.
  const past = all.filter(({ evt, booking }) => new Date(evt.start_at) <= now && !booking.waitlisted);

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
    if (histBtn) histBtn.style.display = (currentUser && histCount > 0) ? '' : 'none';
    if (emptyEl) {
      emptyEl.style.display = '';
      emptyEl.innerHTML = currentUser
        ? `<div class="tab-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></svg></div>
           <div class="tab-empty-title">Nothing booked<br>— yet</div>
           <div class="tab-empty-sub">Find your next ride, lift, or flow and it'll show up here.</div>
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
    const day = item.evt.start_at.split('T')[0];
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(item);
  });

  let html = '';
  if (_waitlistsUnavailable && currentUser) {
    html += `<div class="mb-waitlist-status" style="margin:0 0 8px">Couldn't load your waitlist places from Psycle just now — pull to refresh. Anything shown as Waitlisted below is from earlier.</div>`;
  }

  // Membership / credits info bar + billing period
  var periodStart = null, periodEnd = null, nextPeriodStart = null;
  const fmtDate = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  // period_end from API is the START of the next period — display as last day of current period
  const fmtEndDate = d => { var prev = new Date(d); prev.setDate(prev.getDate() - 1); return fmtDate(prev); };
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
      const made = Number(_activeSubscription.bookings_made) || 0;
      const max = _activeSubscription.max_bookings || 0;
      const planName = _activeSubscription.name || 'Subscription';
      const periodLabel = periodStart && periodEnd ? `${fmtDate(periodStart)} — ${fmtEndDate(periodEnd)}` : '';
      if (max > 0) {
        const pct = Math.round((made / max) * 100);
        html += `<div class="sub-bar">
          <div class="sub-bar-text">
            <span class="sub-bar-name">Membership: ${escapeHTML(planName)}</span>
            <span class="sub-bar-count">${made}/${max} classes${periodLabel ? ' · ' + periodLabel : ''}</span>
          </div>
          <div class="sub-progress"><div class="sub-progress-fill" style="width:${Math.min(pct, 100)}%"></div></div>
        </div>`;
      } else {
        html += `<div class="sub-bar">
          <div class="sub-bar-text">
            <span class="sub-bar-name">Membership: ${escapeHTML(planName)}</span>
            <span class="sub-bar-count">${made > 0 ? made + ' classes booked' : 'Unlimited'}${periodLabel ? ' · ' + periodLabel : ''}</span>
          </div>
        </div>`;
      }
    }
  } else if (creditsRemaining > 0 || availableCredits.length > 0) {
    const totalCredits = creditsRemaining || availableCredits.reduce(function (sum, c) { return sum + (Number(c.remaining) || 0); }, 0);
    html += `<div class="sub-bar">
      <div class="sub-bar-text">
        <span class="sub-bar-name">Credit Pack</span>
        <span class="sub-bar-count">${totalCredits} credit${totalCredits !== 1 ? 's' : ''} remaining</span>
      </div>
    </div>`;
  }

  // Past bookings toggle
  if (past.length > 0) {
    html += `<div style="padding:0 4px 10px;text-align:right">
      <button class="btn-ghost" onclick="togglePastBookings()" style="font-size:11px;padding:4px 10px;border:1px solid var(--border,#333);border-radius:5px;color:var(--text-dim,#888);background:none;cursor:pointer">
        ${_showPastBookings ? 'Hide' : 'Show'} ${past.length} past class${past.length !== 1 ? 'es' : ''}
      </button>
    </div>`;
  }

  // Bucket bookings by billing period
  var currentPeriodItems = [];
  var nextPeriodItems = [];
  var otherItems = [];

  let _countdownShown = 0;
  const sortedDays = Object.keys(byDay).sort();

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
  const planName = _activeSubscription?.name || 'Subscription';
  const periods = _activeSubscription?.upcoming_billing_periods || [];

  if (hasPeriodSplit && _activeSubscription) {
    const max = _activeSubscription.max_bookings || 0;
    const made = Number(_activeSubscription.bookings_made || 0);
    const pct = max > 0 ? Math.round((made / max) * 100) : 0;
    const periodLabel = periodStart && periodEnd ? `${fmtDate(periodStart)} — ${fmtEndDate(periodEnd)}` : '';

    // Current period sub-bar (open)
    html += `<div class="mb-period-section">`;
    html += `<div class="mb-period-bar" onclick="this.parentElement.classList.toggle('collapsed')">`;
    html += `<div class="mb-period-bar-text">`;
    html += `<span class="sub-bar-name">${escapeHTML(planName)}</span>`;
    html += `<span class="sub-bar-count">${max > 0 ? made + '/' + max + ' classes' : (made > 0 ? made + ' classes' : 'Unlimited')}${periodLabel ? ' · ' + periodLabel : ''}</span>`;
    html += `</div>`;
    if (max > 0) {
      html += `<div class="sub-progress"><div class="sub-progress-fill" style="width:${Math.min(pct, 100)}%"></div></div>`;
    }
    html += `<span class="mb-period-chevron">▼</span>`;
    html += `</div>`;
    html += `<div class="mb-period-body">`;
  }

  // Render by day (with next period section injected between)
  var periodSeparatorShown = false;
  for (const day of sortedDays) {
    const dayItems = byDay[day];
    const date = new Date(day + 'T12:00:00');
    const isPast = date < now && day !== localDateStr(now);
    const dayLabel = date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

    // Close current period section and open next period section
    if (hasPeriodSplit && !periodSeparatorShown && periodEnd && date >= periodEnd) {
      periodSeparatorShown = true;

      // Close current period body + section
      html += `</div></div>`;

      // Next period sub-bar (collapsible, starts open)
      const nextPeriod = periods.length > 0 ? periods[0] : null;
      const nextLabel = nextPeriod
        ? `${fmtDate(parsePsycleDate(nextPeriod.start))} — ${fmtDate(parsePsycleDate(nextPeriod.end))}`
        : '';
      const nextMax = _activeSubscription?.max_bookings || 0;

      html += `<div class="mb-period-section">`;
      html += `<div class="mb-period-bar mb-period-bar-next" onclick="this.parentElement.classList.toggle('collapsed')">`;
      html += `<div class="mb-period-bar-text">`;
      const nextBooked = nextPeriodItems.filter(item => !item.booking.waitlisted).length;
      html += `<span class="sub-bar-name">${escapeHTML(planName)}</span>`;
      html += `<span class="sub-bar-count">${nextBooked}/${nextMax > 0 ? nextMax : '∞'} classes · ${nextLabel}</span>`;
      html += `</div>`;
      if (nextMax > 0) {
        const nextPct = Math.round((nextBooked / nextMax) * 100);
        html += `<div class="sub-progress"><div class="sub-progress-fill" style="width:${Math.min(nextPct, 100)}%"></div></div>`;
      }
      html += `<span class="mb-period-chevron">▼</span>`;
      html += `</div>`;
      html += `<div class="mb-period-body">`;
    }

    html += `<div class="mb-day-group${isPast ? ' mb-past' : ''}">`;
    html += `<div class="mb-day-header">${dayLabel}</div>`;
    html += `<div class="class-grid">`;

    for (const { evt, booking, evtId } of dayItems) {
      const dt = new Date(evt.start_at);
      const hours = dt.getHours();
      const mins = dt.getMinutes().toString().padStart(2, '0');
      const ampm = hours >= 12 ? 'pm' : 'am';
      const h12 = hours % 12 || 12;
      const typeName = evt._typeName || 'Class';
      const instrName = evt._instrName || '';
      const locName = evt._locName || '';
      const studioName = evt._studioName || '';
      const eventPast = dt <= now;

      const slots = booking.slots || [];
      const isPlace = !!booking.waitlisted;              // waitlist place, no seat
      const place = booking.waitlist || null;            // {id,status,expiresAt,offer?} when on the waitlist
      const spotFree = !!(place && place.offer && place.offer.available);   // a probe saw a claimable spot
      const offerOpen = !!place && (spotFree || _waitlistOfferPending(place, now.getTime()));

      let badges = `<span class="badge">${evt.duration}min</span>`;
      if (isPlace) badges += `<span class="badge waitlist">${offerOpen ? (spotFree ? 'Spot available' : 'Spot offered') : 'Waitlisted'}</span>`;
      if (booking.fromWaitlist && !isPlace) badges += `<span class="badge waitlist">From waitlist</span>`;
      if (evt.is_live_stream) badges += `<span class="badge highlight">Online</span>`;
      if (eventPast && !isPlace) badges += `<span class="badge attended">Attended</span>`;

      // Countdown badge for the next 2 upcoming classes you hold a seat in
      if (!eventPast && !isPlace && _countdownShown < 2) {
        const cdText = getCountdownText(dt, now);
        if (cdText) {
          badges += `<span class="mb-countdown">${cdText}</span>`;
          _countdownShown++;
        }
      }

      // Seat chips + cancel
      let seatHtml = '';
      if (slots.length > 0) {
        const _slUp = slotLabelForEvent(evtId);
        const chips = slots.map(slot => {
          if (eventPast) return `<span class="up-seat-chip" style="opacity:0.5">${_slUp} ${slot}</span>`;
          return `<span class="up-seat-chip">${_slUp} ${slot}<button onclick="event.stopPropagation();upcomingSeatCancel(${evtId}, ${slot}, this)" title="Cancel ${_slUp} ${slot}">&times;</button></span>`;
        }).join('');
        seatHtml = `<div class="up-seats" style="margin-top:8px">${chips}`;
        if (!eventPast && slots.length > 1) {
          seatHtml += `<button class="up-cancel-all" onclick="event.stopPropagation();upcomingCancel(${evtId}, this)">Cancel All</button>`;
        }
        seatHtml += `</div>`;
      } else if (!isPlace && (booking.bookingIds || []).length > 1) {
        // No-layout studio with more than one space held (each is a record).
        seatHtml = `<div class="up-seats" style="margin-top:8px"><span class="up-seat-chip">${(booking.bookingIds || []).length} spaces</span></div>`;
      }

      // Waitlist status line (place only, or a place held on top of a seat)
      let placeHtml = '';
      if (place && !eventPast) {
        let statusText;
        if (place.unverified) {
          statusText = "On the waitlist (couldn't re-check with Psycle just now — pull to refresh)";
        } else if (offerOpen) {
          let by = '';
          if (place.expiresAt) {
            const ex = new Date(_waitlistTimeMs(place.expiresAt));
            if (!isNaN(ex.getTime())) by = ` — accept by ${ex.getHours() % 12 || 12}:${String(ex.getMinutes()).padStart(2, '0')}${ex.getHours() >= 12 ? 'pm' : 'am'}`;
          }
          statusText = spotFree
            ? `A spot is free right now${by} — it isn't held for you, claim it before someone else does`
            : `A spot has opened up${by}`;
        } else if (isPlace) {
          statusText = 'On the waitlist · Psycle books you in automatically if a spot frees up (keep a credit free)';
        } else {
          statusText = 'You also hold a waitlist place for this class';
        }
        placeHtml = `<div class="mb-waitlist-status${offerOpen ? ' is-offer' : ''}">${escapeHTML(statusText)}</div>`;
        if (!isPlace) {
          placeHtml += `<div class="booking-actions"><button class="booking-action-btn" onclick="event.stopPropagation();leaveWaitlist(${evtId}, this)" title="Give up the extra waitlist place">Leave waitlist</button></div>`;
        }
      }

      // Primary button for seatless entries: Cancel (no-layout seat) / Leave or Claim (place)
      let cancelBtn = '';
      if (!eventPast && slots.length === 0) {
        if (isPlace && offerOpen) {
          cancelBtn = `<button class="book-btn mb-primary-btn" onclick="event.stopPropagation();claimWaitlistSpot(${evtId}, this)">Claim spot</button>`;
        } else if (isPlace) {
          cancelBtn = `<button class="book-btn booked mb-primary-btn" onclick="event.stopPropagation();leaveWaitlist(${evtId}, this)">Leave waitlist</button>`;
        } else {
          cancelBtn = `<button class="book-btn booked mb-primary-btn" onclick="event.stopPropagation();upcomingCancel(${evtId}, this)">Cancel booking</button>`;
        }
      }

      // Action buttons (upcoming only)
      let rebookBtn = '';
      if (!eventPast) {
        const hoursUntil = (dt - now) / 3600000;
        const canChange = hoursUntil > 12;

        rebookBtn = `<div class="booking-actions">`;

        if (isPlace) {
          // A place has no seat to add/change. Offer the other waitlist action:
          // check whether a spot can be claimed right now, or leave when an
          // offer is showing (Claim is then the primary button).
          rebookBtn += offerOpen
            ? `<button class="booking-action-btn" onclick="event.stopPropagation();leaveWaitlist(${evtId}, this)" title="Give up your waitlist place">Leave waitlist</button>`
            : `<button class="booking-action-btn" onclick="event.stopPropagation();claimWaitlistSpot(${evtId}, this)" title="Ask Psycle whether a spot is free to claim right now">Check for a spot</button>`;
        } else {
          // Add a spot — opens bike picker to book an additional slot
          if (slots.length < 2) {
            rebookBtn += `<button class="booking-action-btn" onclick="event.stopPropagation();bookClass(${evtId}, this, ${evt.studio_id})" title="Add another spot">+ Add spot</button>`;
          }

          // Change spot — only if >12h away and class not full
          if (canChange && slots.length > 0) {
            rebookBtn += `<button class="booking-action-btn" onclick="event.stopPropagation();changeSpot(${evtId})" title="Change to a different spot">Change spot</button>`;
          }
        }

        rebookBtn += `<button class="booking-action-btn" onclick="event.stopPropagation();findSimilar(${evtId})" title="Find similar classes">↻ Similar</button>`;
        if (evt._locAddress || evt._locFullName || evt._locName) {
          rebookBtn += `<button class="booking-action-btn" onclick="event.stopPropagation();openMapForBooking(${evtId})" title="Open the studio in Maps">📍 Map</button>`;
        }
        rebookBtn += `</div>`;
      }

      html += `<div class="class-card ${isPlace ? 'is-waitlisted' : 'is-booked'} my-booking-card" data-id="${evtId}" data-studio-id="${evt.studio_id}"
        onclick="scrollToClass(${evtId}, event)" style="cursor:pointer" title="Jump to class in search results">
        <div class="class-time">${h12}:${mins}<span class="class-time-ampm">${ampm}</span></div>
        <div class="class-info">
          <div class="class-type">${escapeHTML(typeName)}</div>
          <div class="class-instructor">${instrLink(instrName, evt.instructor_id)}${window.tierBadgeHTML ? window.tierBadgeHTML(evt.instructor_id) : ''}</div>
          <div class="class-location">${escapeHTML(locName)}${studioName ? ' · ' + escapeHTML(studioName) : ''}</div>
          <div class="class-meta">${badges}</div>
          ${seatHtml}
          ${placeHtml}
          ${cancelBtn}
          ${rebookBtn}
        </div>
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

  list.innerHTML = html;
}

function scrollToClass(eventId, e) {
  // Don't fire if any cancel/seat-chip/rebook/similar/share button was clicked
  if (e.target.classList.contains('up-cancel') ||
      e.target.classList.contains('up-cancel-all') ||
      e.target.classList.contains('rebook-btn') ||
      e.target.classList.contains('find-similar-btn') ||
      e.target.classList.contains('share-class-btn') ||
      e.target.closest('.up-seat-chip') ||
      e.target.closest('.find-similar-popup')) return;
  const card = document.querySelector(`.class-card[data-id="${eventId}"]`);
  if (!card) {
    toast('Run a search first to see the class in results', 'info');
    return;
  }
  // Scroll card into view
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  // Flash highlight
  card.style.transition = 'box-shadow 0.15s';
  card.style.boxShadow = '0 0 0 2px #5dba5d, 0 0 16px rgba(93,186,93,0.4)';
  setTimeout(() => { card.style.boxShadow = ''; }, 1800);
}

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
  const alreadyBooked = Object.keys(_myBookings).some(bookedId => {
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
  if (alreadyBooked) {
    toast('Already booked for next week', 'info');
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

  const res = await apiFetch('/events?' + params);
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
    // Show alternatives — set date filters and trigger search
    document.getElementById('startDate').value = dayStr;
    document.getElementById('daysAhead').value = 1;
    search();
    toast('No exact match — showing alternatives for ' + dayStr, 'info');
  } else {
    toast('No matching class found next week at this location', 'info');
  }
}

// ── Change Spot ─────────────────────────────────────────────────
// Opens bike picker. When user selects a new spot, cancels old + books new.
window.changeSpot = async function(eventId) {
  // A fresh multi-seat booking maps every seat to the single returned booking
  // id until fetchMyBookings corrects it — swapping off that stale map would
  // cancel the wrong seat. Refresh ONLY when the local record looks
  // suspicious (optimistic null id, or seats sharing one booking id), and
  // retry once if a concurrent fetch superseded ours without applying.
  const _mapLooksStale = (b) => {
    if (!b) return true;
    if (b.bookingId === null) return true;
    if ((b.slots || []).length > 1) {
      const distinct = new Set(Object.values(b.slotBookings || {}).map(String));
      return distinct.size < b.slots.length;
    }
    return false;
  };
  if (_mapLooksStale(_myBookings[String(eventId)])) {
    try {
      const applied = await fetchMyBookings();
      if (!applied) await fetchMyBookings();
    } catch (e) { /* fall back to local state */ }
  }
  const booking = _myBookings[String(eventId)];
  const evt = _eventCache[String(eventId)];
  if (!booking || !evt) return;

  const hoursUntil = (new Date(evt.start_at) - new Date()) / 3600000;
  if (hoursUntil <= 12) {
    toast('Cannot change spot within 12 hours of class (incurs a fee)', 'error');
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
    const layout = studio?.layout;
    if (!studio?.has_layout || !layout?.slots?.length) {
      toast('No layout available for this studio', 'error');
      return;
    }

    // Default to the first booked slot. If the user has multiple, the
    // modalHint renders chips so they can pick which one to swap without
    // leaving the map view.
    const slotToChange = booking.slots[0];
    window._changeSpotContext = {
      eventId: eventId,
      slotToChange: slotToChange,
      bookingId: booking.slotBookings?.[slotToChange] || booking.bookingId,
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
    toast('Failed to load spots: ' + e.message, 'error');
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
      return '<button type="button" class="' + cls + '" onclick="setChangeSpotTarget(' + s + ')">' +
        label + ' ' + s + '</button>';
    }).join('');
    hint.innerHTML = 'Changing: <span class="change-chip-row">' + chips + '</span>' + tail;
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
  ctx.slotToChange = slot;
  ctx.bookingId = ctx.booking.slotBookings?.[slot] || ctx.booking.bookingId;
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
    // Step 1: cancel the old seat (skipped if a previous attempt already did).
    if (!ctx.cancelDone) {
      const cancelPath = ctx.bookingId ? '/bookings/' + ctx.bookingId : '/bookings?event_id=' + ctx.eventId;
      let cancelRes;
      try {
        cancelRes = await apiFetch(cancelPath, { method: 'DELETE' });
      } catch (e) {
        // Nothing cancelled yet — fully safe to retry.
        failRetryable('Swap failed: ' + e.message);
        return;
      }
      // 404 = the booking is already gone (e.g. an earlier attempt landed
      // server-side) — treat as cancelled rather than a dead end.
      if (!cancelRes.ok && cancelRes.status !== 204 && cancelRes.status !== 404) {
        const cErr = await cancelRes.json().catch(() => ({}));
        failRetryable('Swap failed: ' + (cErr.message || 'could not release your current ' + low));
        return;
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

    if (bookRes && (bookRes.ok || bookRes.status === 201)) {
      toast(label + ' changed: ' + ctx.slotToChange + ' → ' + newSlot, 'success');
      _adjustBikeHistoryForSwap(ctx.eventId, ctx.slotToChange, newSlot);
      closeBikePicker(); // resets the confirm button and clears the swap context
      fetchMyBookings();
      PsycleEvents.emit('booking:complete', ctx.eventId, [newSlot]);
      return;
    }

    // Booking the new seat failed — try to win the original seat back, then
    // let the SERVER say whether we actually hold it (a 409 on the recovery
    // POST is ambiguous: "you already have it" vs "someone else took it").
    const bErr = bookRes ? await bookRes.json().catch(() => ({})) : {};
    const reason = bookErr ? bookErr.message : (bErr.message || 'could not book ' + low + ' ' + newSlot);
    try { await postSeat(ctx.slotToChange); } catch (e) { /* judged by the refetch below */ }

    let recovered = false;
    try {
      await fetchMyBookings();
      const after = _myBookings[String(ctx.eventId)];
      recovered = !!after && (after.slots || []).map(Number).includes(Number(ctx.slotToChange));
      if (recovered) {
        // Retarget the context at the CURRENT booking record for that seat so
        // a retried swap cancels the right one.
        ctx.booking = after;
        ctx.bookingId = after.slotBookings?.[ctx.slotToChange] || after.bookingId;
        ctx.cancelDone = false;
      }
    } catch (e) { /* recovered stays false */ }

    if (recovered) {
      failRetryable('Swap failed: ' + reason + ' — kept ' + label + ' ' + ctx.slotToChange + '. Tap Swap to retry.');
    } else {
      failRetryable('Swap failed: ' + reason + ' — and ' + label + ' ' + ctx.slotToChange +
        ' could not be restored. Check My Bookings and rebook.');
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
  const h = origDate.getHours() % 12 || 12;
  const m = origDate.getMinutes().toString().padStart(2, '0');
  const ap = origDate.getHours() >= 12 ? 'pm' : 'am';
  const timeLabel = `${h}:${m}${ap}`;
  const instrName = evt._instrName || 'this instructor';
  const typeName = evt._typeName || 'Class';

  const popup = document.createElement('div');
  popup.className = 'find-similar-popup';
  popup.innerHTML =
    '<div class="find-similar-title">Find similar</div>' +
    '<button class="find-similar-option" data-action="next-week">' +
      '<span class="find-similar-icon">&#128197;</span>' +
      '<span class="find-similar-label">Same class next week</span>' +
      '<span class="find-similar-desc">' + escapeHTML(typeName) + ' with ' + escapeHTML(instrName) + ', ' + dayName + ' ' + timeLabel + '</span>' +
    '</button>' +
    '<button class="find-similar-option" data-action="same-instructor">' +
      '<span class="find-similar-icon">&#128100;</span>' +
      '<span class="find-similar-label">Same instructor, any time</span>' +
      '<span class="find-similar-desc">All classes with ' + escapeHTML(instrName) + ' this week</span>' +
    '</button>' +
    '<button class="find-similar-option" data-action="same-time">' +
      '<span class="find-similar-icon">&#128336;</span>' +
      '<span class="find-similar-label">Same time, any instructor</span>' +
      '<span class="find-similar-desc">' + dayName + 's at ' + timeLabel + ', any instructor</span>' +
    '</button>';

  // Position near the trigger button
  triggerBtn.style.position = 'relative';
  triggerBtn.parentElement.style.position = 'relative';
  triggerBtn.parentElement.appendChild(popup);

  // Handle option clicks
  popup.addEventListener('click', function(e) {
    const option = e.target.closest('.find-similar-option');
    if (!option) return;
    const action = option.dataset.action;
    popup.remove();

    if (action === 'next-week') {
      // Existing rebookNextWeek logic
      rebookNextWeek(eventId);
    } else if (action === 'same-instructor') {
      // Set instructor filter and search this week
      selectedInstructors.clear();
      selectedInstructors.add(String(evt.instructor_id));
      if (typeof renderInstrChips === 'function') renderInstrChips();
      const today = new Date();
      const todayStr = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
      document.getElementById('startDate').value = todayStr;
      document.getElementById('daysAhead').value = 7;
      switchTab('discover');
      search();
      toast('Showing classes with ' + instrName, 'info');
    } else if (action === 'same-time') {
      // Search for classes on the same day of week, next occurrence
      selectedInstructors.clear();
      if (typeof renderInstrChips === 'function') renderInstrChips();
      // Find next occurrence of this weekday (this week or next)
      const today = new Date();
      const todayDay = today.getDay();
      const targetDay = origDate.getDay();
      let daysUntil = targetDay - todayDay;
      if (daysUntil < 0) daysUntil += 7;
      if (daysUntil === 0 && today.getHours() > origDate.getHours()) daysUntil = 7;
      const targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() + daysUntil);
      const targetStr = [targetDate.getFullYear(), String(targetDate.getMonth() + 1).padStart(2, '0'), String(targetDate.getDate()).padStart(2, '0')].join('-');
      // Also show the week after
      document.getElementById('startDate').value = targetStr;
      document.getElementById('daysAhead').value = 8;
      switchTab('discover');
      search();
      toast('Showing ' + dayName + ' classes around ' + timeLabel, 'info');
    }
  });

  // Dismiss when clicking outside
  function dismissPopup(e) {
    if (!popup.contains(e.target) && e.target !== triggerBtn) {
      popup.remove();
      document.removeEventListener('click', dismissPopup, true);
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
  const h = dt.getHours() % 12 || 12;
  const m = dt.getMinutes().toString().padStart(2, '0');
  const ap = dt.getHours() >= 12 ? 'pm' : 'am';
  const timeLabel = `${h}:${m}${ap}`;

  const typeName = evt._typeName || 'Class';
  const instrName = evt._instrName || '';
  const locName = evt._locName || '';

  const instrPart = instrName ? (' with ' + instrName) : '';
  const locPart = locName ? (' at ' + locName) : '';

  const message = `I'm going to ${typeName}${instrPart} on ${dayName} ${dayNum} ${monthName} at ${timeLabel}${locPart}. Book a spot! https://psyclelondon.com/pages/timetable`;

  if (navigator.share) {
    navigator.share({ text: message }).catch(function() {});
  } else if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(message).then(function() {
      toast('Copied to clipboard!', 'success');
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
    toast('Copied to clipboard!', 'success');
  }
};

async function upcomingCancel(eventId, btn) {
  const booking = _myBookings[String(eventId)];
  if (!booking) return;
  // Waitlist places are left via /waitlists — never DELETE /bookings (a 404
  // there would read as "cancelled" while the place survives server-side).
  if (booking.waitlisted) return leaveWaitlist(eventId, btn);
  if (!(await confirmCancelWithPolicy(eventId, 'Cancel this booking?'))) return;
  btn.disabled = true;
  btn.textContent = '…';

  const bookingIds = _bookingIdsFor(booking);

  // Offline: queue + optimistic.
  if (!navigator.onLine && typeof queueOfflineCancel === 'function') {
    queueOfflineCancel(eventId, bookingIds);
    _dropBookingKeepPlace(eventId);
    _syncCardButtonsForEvent(eventId);
    refreshUpcomingPanel();
    toast("You're offline — cancel queued", 'info');
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
    } else {
      btn.disabled = false;
      btn.textContent = 'Cancel';
      const failed = results.find(r => !isOk(r));
      const data = await failed.json().catch(() => ({}));
      toast(describeCancelError(failed, data), 'error');
      if (results.some(isOk) && typeof fetchMyBookings === 'function') {
        fetchMyBookings();
      }
    }
  } catch (e) {
    if (!navigator.onLine && typeof queueOfflineCancel === 'function') {
      queueOfflineCancel(eventId, bookingIds);
      _dropBookingKeepPlace(eventId);
      _syncCardButtonsForEvent(eventId);
      refreshUpcomingPanel();
      toast("You're offline — cancel queued", 'info');
      PsycleEvents.emit('booking:cancelled', eventId);
      return;
    }
    btn.disabled = false;
    btn.textContent = 'Cancel';
    toast(describeCancelError(null, null, e), 'error');
  }
}

async function upcomingSeatCancel(eventId, slotId, btn) {
  const booking = _myBookings[String(eventId)];
  if (!booking) return;
  const _sl4 = slotLabelForEvent(eventId);
  if (!(await confirmCancelWithPolicy(eventId, `Cancel ${_sl4} ${slotId}?`))) return;
  btn.disabled = true;
  const chip = btn.closest('.up-seat-chip');
  if (chip) chip.style.opacity = '0.5';
  // Use the per-slot booking ID for precise cancellation
  const slotBookingId = booking.slotBookings?.[slotId] || booking.bookingId;
  try {
    const path = slotBookingId ? `/bookings/${slotBookingId}` : `/bookings?event_id=${eventId}`;
    const res = await apiFetch(path, { method: 'DELETE' });
    if (res.ok || res.status === 204 || res.status === 200) {
      // Remove this slot from local state
      booking.slots = booking.slots.filter(s => s !== Number(slotId));
      if (booking.slotBookings) delete booking.slotBookings[slotId];
      if (booking.slots.length === 0) _dropBookingKeepPlace(eventId);
      _noteLocalBookingWrite();
      _markSeatFreed(eventId);
      // Update the corresponding class card in results if rendered
      _syncCardButtonsForEvent(eventId);
      refreshUpcomingPanel();
      toast(`${_sl4} ${slotId} cancelled`, 'info');
      PsycleEvents.emit('seat:cancelled', eventId, slotId);
    } else {
      btn.disabled = false;
      if (chip) chip.style.opacity = '';
      const data = await res.json().catch(() => ({}));
      toast(describeCancelError(res, data), 'error');
    }
  } catch (e) {
    btn.disabled = false;
    if (chip) chip.style.opacity = '';
    toast(describeCancelError(null, null, e), 'error');
  }
}

// _eventCache managed by state.js

// ── Class Detail Sheet ──────────────────────────────────────────
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
  const hours = dt.getHours();
  const mins = dt.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  const h12 = hours % 12 || 12;
  const timeStr = h12 + ':' + mins + ampm;

  const typeName = evt._typeName || 'Class';
  const locName = evt._locName || '';
  const studioName = evt._studioName || '';
  const duration = evt.duration || '';

  // Availability info
  let availHtml = '';
  if (evt.is_fully_booked && !evt.is_waitlistable) {
    availHtml = '<span class="cds-avail cds-avail-full">Full</span>';
  } else if (evt.is_fully_booked && evt.is_waitlistable) {
    availHtml = '<span class="cds-avail cds-avail-waitlist">Waitlist available</span>';
  } else if (evt.capacity != null && evt.capacity_remaining != null) {
    availHtml = '<span class="cds-avail">' + escapeHTML(String(evt.capacity_remaining)) + ' spots available</span>';
  } else if (duration) {
    availHtml = '<span class="cds-avail">' + escapeHTML(String(duration)) + ' min</span>';
  }

  // Booking state
  const myBooking = _myBookings[String(eventId)];
  const safeEventId = Number(eventId) || 0;
  const safeStudioId = Number(evt.studio_id) || 0;
  let bookBtnHtml;
  if (myBooking && myBooking.waitlisted) {
    // A waitlist place: manage it directly (no Discover card needed in the DOM).
    bookBtnHtml = '<button class="cds-book-btn booked" onclick="event.stopPropagation();document.getElementById(\'classDetailOverlay\').remove();leaveWaitlist(' + safeEventId + ', null);">Waitlisted ✓</button>';
  } else if (myBooking) {
    const bookedLabel = (myBooking.slots || []).length ? formatSlots(slotLabelForEvent(eventId), myBooking.slots) + ' ✓' : 'Booked ✓';
    bookBtnHtml = '<button class="cds-book-btn booked" onclick="event.stopPropagation();document.getElementById(\'classDetailOverlay\').remove();var b=document.querySelector(\'.book-btn[data-event-id=\\x22' + eventId + '\\x22]\');if(b)b.click();">' + escapeHTML(bookedLabel) + '</button>';
  } else if (evt.is_fully_booked && !evt.is_waitlistable) {
    bookBtnHtml = '<button class="cds-book-btn" disabled>Full</button>';
  } else if (evt.is_fully_booked && evt.is_waitlistable) {
    // Prefer the rendered card button (keeps its label in sync); otherwise
    // join directly with a detached button.
    bookBtnHtml = '<button class="cds-book-btn waitlist" onclick="event.stopPropagation();document.getElementById(\'classDetailOverlay\').remove();var b=document.querySelector(\'.class-card:not(.my-booking-card) .book-btn[data-event-id=\\x22' + safeEventId + '\\x22]\');if(b){b.click();}else{bookClass(' + safeEventId + ', document.createElement(\'button\'), ' + safeStudioId + ');}">Join Waitlist</button>';
  } else {
    bookBtnHtml = '<button class="cds-book-btn" onclick="event.stopPropagation();document.getElementById(\'classDetailOverlay\').remove();var b=document.querySelector(\'.book-btn[data-event-id=\\x22' + eventId + '\\x22]\');if(b)b.click();">Book</button>';
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
    ? '<button class="cds-view-instr" onclick="document.getElementById(\'classDetailOverlay\').remove();window._features_openInstructorModal(\'' + safeInstrName + '\',\'' + instrId + '\')">View instructor profile</button>'
    : '';

  // Build overlay
  const overlay = document.createElement('div');
  overlay.id = 'classDetailOverlay';
  overlay.className = 'modal-overlay';
  overlay.style.display = 'flex';
  overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };

  overlay.innerHTML =
    '<div class="class-detail-sheet">' +
      '<div class="cds-handle"></div>' +
      '<button class="modal-close cds-close" onclick="document.getElementById(\'classDetailOverlay\').remove()">&times;</button>' +
      '<div class="cds-header">' +
        (photo ? '<img class="cds-photo" src="' + escapeHTML(photo) + '" alt="' + escapeHTML(instrName) + '">' : '<div class="cds-photo-placeholder"></div>') +
        '<div class="cds-header-info">' +
          '<div class="cds-instr-name">' + escapeHTML(instrName) + ' ' + tierBadge + '</div>' +
          '<div class="cds-type">' + escapeHTML(typeName) + '<span class="cds-duration-badge">' + escapeHTML(String(duration)) + ' min</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="cds-details">' +
        '<div class="cds-detail-row"><span class="cds-icon">&#128197;</span><span>' + escapeHTML(dayStr) + ' at ' + escapeHTML(timeStr) + '</span></div>' +
        '<div class="cds-detail-row"><span class="cds-icon">&#128205;</span><span>' + escapeHTML(locName) + (studioName ? ' &middot; ' + escapeHTML(studioName) : '') + '</span></div>' +
        (availHtml ? '<div class="cds-detail-row"><span class="cds-icon">&#9898;</span>' + availHtml + '</div>' : '') +
      '</div>' +
      (bioExcerpt ? '<div class="cds-bio">' + escapeHTML(bioExcerpt) + '</div>' : '') +
      keywordsHtml +
      '<div class="cds-actions">' +
        bookBtnHtml +
        viewInstrHtml +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);
};

// ════════════════════════════════════════════════════════════════
// Feature: Weekly Template Booking Engine
// localStorage 'psycle_weekly_template' = array of
//   { dayOfWeek:0-6 (0=Sun), hour, minute, locationId, eventTypeId,
//     instructorId, label }
// The planner UI in tabs.js calls saveWeeklyTemplate/loadWeeklyTemplate/
// bookWeeklyTemplate; this is the implementation behind those hooks.
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

// Date of the given weekday (0=Sun..6=Sat) within the upcoming 7 days
// (today counts as day 0). Returns a YYYY-MM-DD string.
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

    const studio = _studioMap[studioId];
    const layout = studio?.layout;
    const hasLayout = studio?.has_layout && layout?.slots?.length > 0;

    const noSeatsLeft = isFullyBooked || (hasLayout && availableSlotIds.size === 0);
    if (noSeatsLeft) {
      if (_myBookings[String(eventId)]?.waitlisted) return 'skipped'; // already hold a place
      if (!isWaitlistable) return 'failed';
      const joined = await joinWaitlist(eventId, btn, { quiet: true });
      return joined ? 'waitlisted' : 'failed';
    }

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
    return btn.classList.contains('booked') ? 'booked' : 'failed';
  } catch (e) {
    console.warn('[psycle] headless book failed:', eventId, e);
    return 'failed';
  }
}

// For each template entry: find its date in the upcoming 7 days, fetch that
// day's events at the entry's location, pick the best match (same type, and
// same instructor if specified, within ±20 min), skip if already booked,
// otherwise book it headlessly. One failure never aborts the rest.
// Resolves to { booked, waitlisted, failed, skipped }.
let _templateBookingInFlight = false;
async function bookWeeklyTemplate() {
  const counts = { booked: 0, waitlisted: 0, failed: 0, skipped: 0 };
  // Re-entrancy guard: a double tap on "Book my week" must not run two
  // concurrent sweeps (both would pass the already-booked checks and
  // double-book every entry).
  if (_templateBookingInFlight) return counts;
  _templateBookingInFlight = true;
  try {
    return await _bookWeeklyTemplateInner(counts);
  } finally {
    _templateBookingInFlight = false;
  }
}

async function _bookWeeklyTemplateInner(counts) {
  const template = loadWeeklyTemplate();
  if (!template.length) return counts;
  if (!currentUser) { counts.failed = template.length; return counts; }

  const TOLERANCE_MIN = 20;

  // Cache per-day event fetches so multiple entries on the same day+location
  // share one network call.
  const dayCache = {};
  const fetchDay = async (dayStr, locId) => {
    const key = dayStr + '|' + locId;
    if (dayCache[key]) return dayCache[key];
    const p = (async () => {
      const params = new URLSearchParams({
        start: dayStr + ' 00:00:00',
        end: dayStr + ' 23:59:59',
        location: locId,
        limit: 200,
      });
      const res = await apiFetch('/events?' + params);
      if (!res.ok) return [];
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
    })().catch(() => []);
    dayCache[key] = p;
    return p;
  };

  const tasks = template.map(async entry => {
    try {
      const targetMin = (Number(entry.hour) || 0) * 60 + (Number(entry.minute) || 0);
      const dayStr = _upcomingWeekdayDate(entry.dayOfWeek, new Date(), targetMin);
      const locId = _resolveTemplateLocationId(entry.locationId);

      // Already booked something matching this slot? (same type, instructor if
      // set, on the target day, within tolerance) → skip.
      const already = Object.keys(_myBookings).some(bookedId => {
        const be = _eventCache[bookedId];
        if (!be || !be.start_at) return false;
        if (localDateStr(new Date(be.start_at)) !== dayStr) return false;
        if (entry.eventTypeId != null && be.event_type_id !== entry.eventTypeId) return false;
        if (entry.instructorId != null && be.instructor_id !== entry.instructorId) return false;
        const bMin = new Date(be.start_at).getHours() * 60 + new Date(be.start_at).getMinutes();
        return Math.abs(bMin - targetMin) <= TOLERANCE_MIN;
      });
      if (already) { counts.skipped++; return; }

      const events = await fetchDay(dayStr, locId);
      if (!events.length) { counts.failed++; return; }

      // Best match: same type, same instructor (if set), closest time within ±20m.
      let best = null, bestDelta = Infinity;
      for (const e of events) {
        if (entry.eventTypeId != null && e.event_type_id !== entry.eventTypeId) continue;
        if (entry.instructorId != null && e.instructor_id !== entry.instructorId) continue;
        const eMin = new Date(e.start_at).getHours() * 60 + new Date(e.start_at).getMinutes();
        const delta = Math.abs(eMin - targetMin);
        if (delta <= TOLERANCE_MIN && delta < bestDelta) { best = e; bestDelta = delta; }
      }
      if (!best) { counts.failed++; return; }

      // Don't double-book the exact event we found.
      if (_myBookings[String(best.id)]) { counts.skipped++; return; }

      const result = await _bookEventHeadless(best.id, best.studio_id);
      if (result === 'booked') counts.booked++;
      else if (result === 'waitlisted') counts.waitlisted++;
      else if (result === 'skipped') counts.skipped++;
      else counts.failed++;
    } catch (e) {
      console.warn('[psycle] template entry failed:', entry, e);
      counts.failed++;
    }
  });

  await Promise.allSettled(tasks);
  if (typeof fetchMyBookings === 'function') { try { await fetchMyBookings(); } catch {} }
  return counts;
}

// Analyse psycle_class_history for day-of-week + time + type slots booked
// 2+ times; return candidate template entries (same shape). Names in history
// are resolved back to numeric IDs via the loaded instructors/eventTypes.
function detectRecurringSlots() {
  let history = [];
  try { history = JSON.parse(localStorage.getItem('psycle_class_history') || '[]'); } catch { return []; }
  if (!Array.isArray(history) || !history.length) return [];

  const typeByName = {};
  if (typeof eventTypes !== 'undefined') {
    eventTypes.forEach(t => { if (t.name) typeByName[t.name.toLowerCase()] = t.id; });
  }
  const instrByName = {};
  if (typeof instructors !== 'undefined') {
    instructors.forEach(i => { if (i.full_name) instrByName[i.full_name.toLowerCase()] = i.id; });
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
      buckets[key] = { dow, mins: [], typeName, instrName: h.instrName || '', count: 0 };
    }
    buckets[key].count++;
    buckets[key].mins.push(mins);
  });

  const candidates = [];
  Object.values(buckets).forEach(b => {
    if (b.count < 2) return; // recurring = booked 2+ times
    const avg = Math.round(b.mins.reduce((a, c) => a + c, 0) / b.mins.length);
    const hour = Math.floor(avg / 60), minute = avg % 60;
    candidates.push({
      dayOfWeek: b.dow,
      hour,
      minute,
      locationId: null, // history doesn't carry a numeric location id
      eventTypeId: typeByName[b.typeName.toLowerCase()] ?? null,
      instructorId: instrByName[(b.instrName || '').toLowerCase()] ?? null,
      label: b.typeName + (b.instrName ? ' · ' + b.instrName : ''),
      _count: b.count,
    });
  });

  // Most-booked slots first.
  return candidates.sort((a, b) => (b._count || 0) - (a._count || 0));
}

window.loadWeeklyTemplate = loadWeeklyTemplate;
window.saveWeeklyTemplate = saveWeeklyTemplate;
window.clearWeeklyTemplate = clearWeeklyTemplate;
window.bookWeeklyTemplate = bookWeeklyTemplate;
window.detectRecurringSlots = detectRecurringSlots;

// ════════════════════════════════════════════════════════════════
// Feature: Saved / Recent searches + presets
// 'psycle_recent_searches' = array (cap 5), deduped by a signature of
// instructors + locations + categories + date-mode.
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
    dateMode: _dateQuickMode || null,
    startDate: document.getElementById('startDate')?.value || '',
    daysAhead: document.getElementById('daysAhead')?.value || '7',
  };
}

// Order-independent signature for dedup: sorted ids + sorted categories +
// date mode (or explicit start date when no quick mode is active).
function _searchSignature(s) {
  const instr = [...(s.instructors || [])].map(String).sort().join(',');
  const locs = [...(s.locations || [])].map(String).sort().join(',');
  const cats = [...(s.categories || [])].map(String).sort().join(',');
  const date = s.dateMode || ('date:' + (s.startDate || '') + '+' + (s.daysAhead || ''));
  return ['i:' + instr, 'l:' + locs, 'c:' + cats, 'd:' + date].join('|');
}

// Human label for a saved/recent search pill.
function _searchLabel(s) {
  const parts = [];
  const modeLabels = { today: 'Today', tomorrow: 'Tomorrow', week: '7 days', '2week': '14 days' };
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
  return parts.length ? parts.join(' · ') : 'All classes';
}

function getRecentSearches() {
  try {
    const arr = JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
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
        _dateQuickMode = 'week';
        document.getElementById('startDate').value = localDateStr();
        document.getElementById('daysAhead').value = 7;
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
  if (typeof updateFiltersSummary === 'function') updateFiltersSummary();
}

// Apply a saved search object: set the filter globals + inputs, re-render
// chips, and run the search.
function applySavedSearch(obj) {
  if (!obj) return;
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

  _dateQuickMode = obj.dateMode || null;
  if (obj.startDate) document.getElementById('startDate').value = obj.startDate;
  if (obj.daysAhead) document.getElementById('daysAhead').value = obj.daysAhead;
  const modeLabels = { today: 'Today', tomorrow: 'Tomorrow', week: '7 days', '2week': '14 days' };
  document.querySelectorAll('.date-quick-btn').forEach(b => {
    b.classList.toggle('active', !!_dateQuickMode && b.textContent.trim() === modeLabels[_dateQuickMode]);
  });

  _syncFilterUI();
  if (typeof switchTab === 'function') switchTab('discover');
  search();
}

// Apply a preset by key, then search.
function applySearchPreset(key) {
  const preset = getSearchPresets().find(p => p.key === key);
  if (!preset) return;
  preset.apply();
  _syncFilterUI();
  if (typeof switchTab === 'function') switchTab('discover');
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
// Feature: Onboarding tour (first run only)
// ════════════════════════════════════════════════════════════════
const ONBOARDING_KEY = 'psycle_onboarded_v1';

// Centred modal carousel — just shows the key things. No element targeting,
// so nothing can misalign. Icons are trusted static SVGs (inherit accent).
const _OB_ICON = {
  logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="13" r="3"/><circle cx="18" cy="13" r="3"/><path d="M9 13c1-1.7 2-1.7 3 0s2 1.7 3 0"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></svg>',
  bars: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 20v-6M12 20V8M19 20V5"/></svg>',
};

const ONBOARDING_STEPS = [
  { icon: _OB_ICON.logo, title: 'Psync', body: 'An independent companion for booking Psycle classes.' },
  { icon: _OB_ICON.search, title: 'Search and book', body: 'Filter the timetable by instructor, studio, type or time, then book in a tap. Your usual bike is remembered.' },
  { icon: _OB_ICON.calendar, title: 'Plan the week', body: 'View the week ahead, save it as a template, and rebook your regulars in one tap.' },
  { icon: _OB_ICON.bars, title: 'Track your training', body: 'Streaks, cost per class and instructor suggestions, from your booking history.' },
];

let _onboardIdx = 0;

function _onboardCleanup() {
  document.getElementById('onboardOverlay')?.remove();
  document.removeEventListener('keydown', _onboardKey);
}

function _onboardFinish(thenSignIn) {
  try { localStorage.setItem(ONBOARDING_KEY, '1'); } catch {}
  const ov = document.getElementById('onboardOverlay');
  if (ov) { ov.classList.remove('show'); setTimeout(_onboardCleanup, 220); }
  else _onboardCleanup();
  if (thenSignIn && typeof openLoginPopup === 'function') openLoginPopup();
}

function _onboardKey(e) {
  if (e.key === 'Escape') _onboardFinish();
  else if (e.key === 'ArrowRight' || e.key === 'Enter') _onboardAdvance();
  else if (e.key === 'ArrowLeft' && _onboardIdx > 0) { _onboardIdx--; _onboardRender(); }
}

function _onboardAdvance() {
  if (_onboardIdx >= ONBOARDING_STEPS.length - 1) {
    _onboardFinish(!currentUser); // last step → finish, opening sign-in if signed out
    return;
  }
  _onboardIdx++;
  _onboardRender();
}

function _onboardRender() {
  const card = document.querySelector('#onboardOverlay .onboard-card');
  if (!card) return;
  const step = ONBOARDING_STEPS[_onboardIdx];
  const isLast = _onboardIdx === ONBOARDING_STEPS.length - 1;
  const cta = isLast ? (currentUser ? 'Get started' : 'Sign in') : 'Next';
  card.innerHTML =
    '<button class="onboard-skip" data-onboard="skip">Skip</button>' +
    `<div class="onboard-icon">${step.icon}</div>` +
    `<div class="onboard-title">${escapeHTML(step.title)}</div>` +
    `<div class="onboard-body">${escapeHTML(step.body)}</div>` +
    `<div class="onboard-dots">${ONBOARDING_STEPS.map((_, i) =>
      `<span class="onboard-dot${i === _onboardIdx ? ' active' : ''}"></span>`).join('')}</div>` +
    `<button class="onboard-cta" data-onboard="next">${cta}</button>`;
  // replay the per-step content animation
  card.classList.remove('step-in');
  void card.offsetWidth;
  card.classList.add('step-in');
}

function startOnboarding() {
  _onboardCleanup();
  _onboardIdx = 0;

  const overlay = document.createElement('div');
  overlay.id = 'onboardOverlay';
  overlay.className = 'onboard-overlay';
  overlay.innerHTML = '<div class="onboard-card" role="dialog" aria-modal="true" aria-label="Welcome to Psync"></div>';
  overlay.addEventListener('click', e => {
    const act = e.target.closest('[data-onboard]')?.dataset.onboard;
    if (act === 'skip') { _onboardFinish(); return; }
    if (act === 'next') { _onboardAdvance(); return; }
    // Tapping the backdrop does nothing — avoids accidental dismissal.
  });
  document.body.appendChild(overlay);
  document.addEventListener('keydown', _onboardKey);

  requestAnimationFrame(() => { overlay.classList.add('show'); _onboardRender(); });
}

function replayOnboarding() {
  try { localStorage.removeItem(ONBOARDING_KEY); } catch {}
  startOnboarding();
}
window.replayOnboarding = replayOnboarding;

// First-run trigger: only for genuinely new users. A returning/signed-in user
// who already has booking history shouldn't be interrupted.
function _maybeStartOnboarding() {
  try {
    if (localStorage.getItem(ONBOARDING_KEY)) return;
    let hist = [];
    try { hist = JSON.parse(localStorage.getItem('psycle_class_history') || '[]'); } catch {}
    if (Array.isArray(hist) && hist.length > 3) {
      // Existing user — mark onboarded silently rather than nag.
      localStorage.setItem(ONBOARDING_KEY, '1');
      return;
    }
    // Brief delay so the app paints behind the welcome modal first.
    setTimeout(() => {
      if (!document.getElementById('onboardOverlay')) startOnboarding();
    }, 700);
  } catch {}
}

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
  if (document.getElementById('travelNotice')) return;

  const results = document.getElementById('results');
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

// Returns the single best-predicted recurring class, or null. Shape:
// { dayOfWeek, hour, minute, eventTypeId, instructorId, label, score, daysUntil }.
function predictNextClass() {
  let history = [];
  try { history = JSON.parse(localStorage.getItem('psycle_class_history') || '[]'); } catch { return null; }
  if (!Array.isArray(history) || history.length < 2) return null;

  const typeByName = {};
  if (typeof eventTypes !== 'undefined') {
    eventTypes.forEach(t => { if (t.name) typeByName[t.name.toLowerCase()] = t.id; });
  }
  const instrByName = {};
  if (typeof instructors !== 'undefined') {
    instructors.forEach(i => { if (i.full_name) instrByName[i.full_name.toLowerCase()] = i.id; });
  }

  const now = Date.now();
  const buckets = {};
  history.forEach(h => {
    if (!h || h.cancelledAt || !h.date) return;
    const dt = new Date(String(h.date).replace(' ', 'T'));
    if (isNaN(dt.getTime())) return;
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
    const todayDow = new Date().getDay();
    let daysUntil = (b.dow - todayDow + 7) % 7;
    if (daysUntil === 0) daysUntil = 7; // it's today but likely already passed → next week

    // Recency: more recent attendance scores higher (decay over ~60 days).
    const daysSince = b.lastTs ? (now - b.lastTs) / 86400000 : 999;
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

// One-tap path into search for a predicted class: set type/instructor + the
// next occurrence date, then search.
function bookPrediction(pred) {
  if (!pred) return;
  selectedInstructors.clear();
  selectedCategories.clear();
  selectedStrengthSubs.clear();
  ['UPPER', 'LOWER', 'FULL'].forEach(k => selectedStrengthSubs.add(k));
  selectedReformerSubs.clear();
  REFORMER_SUBS.forEach(s => selectedReformerSubs.add(s.key));

  if (pred.instructorId != null) selectedInstructors.add(String(pred.instructorId));

  const target = new Date();
  target.setHours(0, 0, 0, 0);
  target.setDate(target.getDate() + (pred.daysUntil || 0));
  _dateQuickMode = null;
  document.getElementById('startDate').value = localDateStr(target);
  document.getElementById('daysAhead').value = 1;
  document.querySelectorAll('.date-quick-btn').forEach(b => b.classList.remove('active'));

  _syncFilterUI();
  if (typeof switchTab === 'function') switchTab('discover');
  search();
  const when = new Date(target).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
  toast('Showing ' + pred.label + ' for ' + when, 'info');
}

// Render the gentle "Book again?" hint on the My Bookings tab.
function renderRebookHint() {
  const panel = document.getElementById('upcomingPanel');
  document.getElementById('rebookHint')?.remove();
  if (!currentUser) return;
  const pred = predictNextClass();
  if (!pred) return;

  const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][pred.dayOfWeek];
  const ampm = pred.hour >= 12 ? 'pm' : 'am';
  const h12 = pred.hour % 12 || 12;
  const timeStr = h12 + ':' + String(pred.minute).padStart(2, '0') + ampm;

  const el = document.createElement('div');
  el.id = 'rebookHint';
  el.className = 'rebook-hint';
  el.innerHTML =
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
      const ampm = pred.hour >= 12 ? 'pm' : 'am';
      const h12 = pred.hour % 12 || 12;
      const timeStr = h12 + ':' + String(pred.minute).padStart(2, '0') + ampm;

      const btn = document.createElement('button');
      btn.className = 'find-similar-option find-similar-predicted';
      btn.dataset.action = 'predicted';
      btn.innerHTML =
        '<span class="find-similar-icon">&#10024;</span>' +
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
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
