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
      if ((res.status === 401 || res.status === 403) && getBearerToken()) {
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
  { key: 'BARRE',    label: 'Barre',    color: '#e91e8c', prefixes: ['BARRE'] },
  { key: 'OTHER',    label: 'Other',    color: '#888',    prefixes: [] },
];

function getCategory(typeName) {
  const n = (typeName || '').toUpperCase();
  // Reformer is a Pilates/reformer class even when the name also contains
  // "Strength" (e.g. "Reformer Strength") — match it before the generic loop
  // so it never falls into the STRENGTH bucket via includes().
  if (n.includes('REFORMER')) return CATEGORY_MAP.find(c => c.key === 'PILATES');
  for (const cat of CATEGORY_MAP) {
    if (cat.key === 'OTHER') continue;
    if (cat.prefixes.some(p => n.startsWith(p) || n.includes(p))) return cat;
  }
  return CATEGORY_MAP.find(c => c.key === 'OTHER');
}

/**
 * Get the slot label for a class type.
 * Ride → Bike, Reformer/Pilates → Bed, Strength → Bench, else → Spot
 */
function slotLabel(typeName) {
  const n = (typeName || '').toUpperCase();
  if (n.includes('REFORMER')) return 'Bed';
  const cat = getCategory(typeName);
  if (!cat) return 'Spot';
  if (cat.key === 'RIDE') return 'Bike';
  if (cat.key === 'PILATES') return 'Bed';
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
  var safeName = escapeHTML(name).replace(/'/g, "\\'");
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

async function fetchMyBookings() {
  if (!getBearerToken()) {
    _myBookings = {};
    renderMyBookings(); // still render — the signed-out empty state lives there
    return;
  }
  try {
    const res = await apiFetch('/bookings?limit=200');
    if (!res.ok) return;
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.data || []);

    // The API returns one record per seat. Multiple seats for the same
    // event_id appear as separate booking records, each with its own
    // id (bookingId) and slot number.  We accumulate them.
    _myBookings = {};
    list.forEach(b => {
      const evtId = String(b.event_id);
      const slotNum = Number(b.slot) || 0; // API field is "slot" (singular)

      if (!_myBookings[evtId]) {
        _myBookings[evtId] = {
          bookingId: b.id,
          slots: [],
          slotBookings: {},
        };
      }
      if (slotNum) {
        _myBookings[evtId].slots.push(slotNum);
        _myBookings[evtId].slotBookings[slotNum] = b.id;
      }
    });

    // Re-apply locally-tracked waitlist status (cleared once the class passes)
    const waitlisted = _cleanWaitlisted();
    Object.keys(waitlisted).forEach(id => {
      if (_myBookings[id]) _myBookings[id].waitlisted = true;
    });

    // Fetch event details for any bookings not yet in _eventCache.
    // This makes "My Bookings" self-sufficient — no search required.
    const uncached = Object.keys(_myBookings).filter(id => !_eventCache[id]);
    if (uncached.length > 0) {
      showBookingSkeleton(uncached.length);
      await Promise.all(uncached.map(async evtId => {
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

    PsycleEvents.emit('bookings:loaded', _myBookings);
    renderMyBookings();
    // Refresh any already-rendered search result booking buttons
    Object.entries(_myBookings).forEach(([evtId, booking]) => {
      const card = document.querySelector(`.class-card[data-id="${evtId}"]:not(.my-booking-card)`);
      if (!card) return;
      const btn = card.querySelector('.book-btn');
      if (!btn || btn.classList.contains('booked')) return;
      applyBookedState(btn, Number(evtId), booking);
    });
  } catch (e) { console.warn('[psycle] fetchMyBookings failed:', e); }
}

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
    } else {
      showSessionExpired();
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
  const token = document.getElementById('tokenInput').value.trim();
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
  if (window._secureTokenStore) window._secureTokenStore.clear();
  else localStorage.removeItem('psycle_bearer_token');
  currentUser = null;
  checkAuth();
}

function showSessionExpired() {
  currentUser = null;
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

  // Pre-select favourites if any saved, otherwise start with no selection
  if (favouriteInstructors.size > 0) {
    favouriteInstructors.forEach(id => {
      if (instructors.some(i => String(i.id) === id)) selectedInstructors.add(id);
    });
  }
  renderInstrChips();
  renderInstrDropdown();

  renderLocationChips();

  renderCategoryPills();
  renderStrengthSubPills();
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
  renderInstrChips();
  renderStrengthSubPills();
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
  if (window._windowEvents) renderFromWindow(currentFilters());
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
  const filters = { instructorId, locationIds, categoryKeys, startDate, endDateStr, strengthSubs: new Set(selectedStrengthSubs) };

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
      // All studios: fetch each location concurrently, merge as they arrive
      const total = locationsToFetch.length;
      let done = 0;

      const promises = locationsToFetch.map(async loc => {
        const { events, relations: rel } = await fetchEventsForLocation(loc.id, startDate, endDateStr, seenIds, stale);
        if (stale()) return;
        allEvents = allEvents.concat(events);
        if (!relations) relations = rel;
        else if (rel) mergeRelations(relations, rel);
        done++;
        if (relations) render(allEvents, relations, filters, done === total);
      });

      await Promise.all(promises);
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
    // Only the most recent search owns the button state
    if (mySeq === _searchSeq) {
      btn.disabled = false;
      btn.textContent = 'Search';
      btn.onclick = () => search({ force: true });
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

    // Full class and we're not in it → waitlist path. There's no seat to
    // pick, so never open the bike picker here.
    const noSeatsLeft = isFullyBooked || (hasLayout && availableSlotIds.size === 0);
    if (noSeatsLeft && !myBooking) {
      btn.disabled = false;
      if (!isWaitlistable) {
        btn.textContent = 'Full';
        toast('This class is full', 'info');
        return;
      }
      btn.textContent = 'Join Waitlist';
      const ok = await confirmModal({
        title: 'Join the waitlist?',
        body: `${cached._typeName || 'This class'} is full. You'll be added to the waitlist and notified if a spot opens up.`,
        confirmText: 'Join waitlist',
        cancelText: 'Not now',
      });
      if (!ok) return;
      await submitBooking(eventId, null, btn, { waitlist: true });
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
      await submitBooking(eventId, null, btn);
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
    sub.innerHTML = `<span class="modal-subtitle-line">${line1}</span><br><span class="modal-subtitle-line">${line2}</span>`;
  } else {
    document.getElementById('modalSubtitle').textContent = studioName;
  }

  document.getElementById('modalHint').textContent = hasMySlots
    ? `Your ${pluralizeSlotLabel(_sl)} shown in green — click to cancel. Select another to book.`
    : `Select up to ${MAX_SEATS} ${pluralizeSlotLabel(_sl)}`;
  document.getElementById('confirmBookBtn').disabled = true;

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
    const click = isMine ? `onclick="cancelBikeSlot(${slot.id}, ${eventId})"` : isAvailable ? `onclick="selectBike(${slot.id})"` : '';
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
  const idx = _selectedSlots.indexOf(id);
  if (idx !== -1) {
    // deselect
    _selectedSlots.splice(idx, 1);
    document.querySelector(`.bike-slot[data-slot="${id}"]`)?.classList.replace('selected', 'available');
  } else {
    if (_selectedSlots.length >= MAX_SEATS) {
      // deselect oldest
      const evicted = _selectedSlots.shift();
      document.querySelector(`.bike-slot[data-slot="${evicted}"]`)?.classList.replace('selected', 'available');
    }
    _selectedSlots.push(id);
    document.querySelector(`.bike-slot[data-slot="${id}"]`)?.classList.replace('available', 'selected');
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
}

async function confirmBikeBooking() {
  if (!_bookingContext || _selectedSlots.length === 0) return;
  const { eventId, btn } = _bookingContext;
  const slotsToBook = [..._selectedSlots]; // capture before close
  closeBikePicker();
  await submitBooking(eventId, slotsToBook, btn);
}

// ── Waitlist tracking ────────────────────────────────────────────
// The bookings list API has no reliable waitlist status field, so we
// remember which events we joined as waitlist locally and clear entries
// once the class date passes.
const WAITLIST_KEY = 'psycle_waitlisted_events';
function _getWaitlisted() {
  try { return JSON.parse(localStorage.getItem(WAITLIST_KEY) || '{}'); } catch { return {}; }
}
function _markWaitlisted(eventId, startAt) {
  const map = _getWaitlisted();
  map[String(eventId)] = startAt || '';
  localStorage.setItem(WAITLIST_KEY, JSON.stringify(map));
}
function _cleanWaitlisted() {
  const map = _getWaitlisted();
  const now = Date.now();
  let changed = false;
  Object.entries(map).forEach(([id, startAt]) => {
    if (startAt && new Date(String(startAt).replace(' ', 'T')).getTime() < now) {
      delete map[id];
      changed = true;
    }
  });
  if (changed) localStorage.setItem(WAITLIST_KEY, JSON.stringify(map));
  return map;
}

// Verify-first instrumentation. The waitlist payload (POST {event_id} with no
// slots) is an UNVERIFIED assumption — the API may reject it, or silently
// create a normal billable booking. Capture the real server response (field
// NAMES + status only, no PII) so the next live waitlist attempt reveals the
// true contract before we trust the badge or build multi-spot support.
function _captureWaitlistResponse(eventId, res, data) {
  try {
    const body = (data && (data.data || data)) || {};
    const fields = (body && typeof body === 'object') ? Object.keys(body) : [];
    const info = 'event=' + eventId + ' status=' + res.status + ' ok=' + res.ok +
      ' fields=[' + fields.join(',') + ']' +
      ' hasBookingId=' + !!(data?.data?.id || data?.id) +
      ' hasSeat=' + !!(body.slot || body.slots || body.seat || body.seats);
    if (typeof pushError === 'function') pushError('[waitlist] ' + info);
    if (window.PsycleDiag && typeof window.PsycleDiag.record === 'function') {
      try { window.PsycleDiag.record('waitlist-response', body); } catch (e) {}
    }
    console.warn('[waitlist-diag]', info);
  } catch (e) { /* diagnostics must never break booking */ }
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

async function submitBooking(eventId, slots, btn, opts = {}) {
  // slots: array of slot IDs, or null for no-layout booking
  btn.disabled = true;
  btn.textContent = '…';
  try {
    const body = { event_id: eventId };
    if (slots && slots.length) body.slots = slots.map(Number);
    const res = await apiFetch('/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (opts.waitlist) _captureWaitlistResponse(eventId, res, data);
    if (res.ok) {
      const isWaitlist = !!opts.waitlist;
      const label = isWaitlist
        ? 'Waitlisted ✓'
        : (slots?.length ? `${formatSlots(slotLabelForEvent(eventId), slots)} ✓` : 'Booked ✓');
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
      _myBookings[String(eventId)] = { bookingId, slots: slotsArr, slotBookings, waitlisted: isWaitlist };
      // Remember the booked slot(s) per studio+instructor for next time.
      if (!isWaitlist && slotsArr.length) _recordBikeHistory(eventId, slotsArr);
      if (isWaitlist) {
        _markWaitlisted(eventId, _eventCache[String(eventId)]?.start_at);
        // Safety net (payload unverified): if the server assigned an actual
        // seat, this was a real booking, not a waitlist place — warn so the
        // user can check (and cancel) rather than be silently committed/billed.
        const _wb = data?.data || data || {};
        if (_wb.slot || _wb.slots || _wb.seat || _wb.seats) {
          toast('Heads up: this may have booked a spot, not a waitlist place — check My Bookings', 'info');
        }
      }
      btn.onclick = () => confirmUnbook(bookingId || null, eventId, btn);
      showBookingConfirmation(eventId, slotsArr, { waitlist: isWaitlist });
      refreshUpcomingPanel();
      PsycleEvents.emit('booking:complete', eventId, slotsArr, btn);
    } else if (res.status === 409 || (data.message || '').toLowerCase().includes('already')) {
      btn.textContent = 'Already booked ✓';
      btn.className = 'book-btn booked';
      btn.disabled = true;
      toast("You're already in this class", 'info');
    } else if (res.status !== 401 && res.status !== 403) {
      // 401/403 already handled globally by apiFetch → showSessionExpired()
      btn.textContent = 'Failed — retry';
      btn.disabled = false;
      const _fb = opts.waitlist ? "Couldn't join the waitlist" : `Error ${res.status}`;
      toast(data.message || data.error || _fb, 'error');
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
        <div class="bc-title">${opts.waitlist ? 'On the waitlist!' : 'Booked!'}</div>
        <div class="bc-detail">${classLine}</div>
        ${dateTimeStr ? `<div class="bc-detail bc-dim">${dateTimeStr}</div>` : ''}
        ${opts.waitlist ? `<div class="bc-detail bc-dim">You'll be notified if a spot opens up</div>` : ''}
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
    document.getElementById('psycleConfirmOverlay')?.remove();

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

    const close = result => {
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
    document.addEventListener('keydown', onKey);

    // Focus the primary action so Enter confirms and screen readers land on it
    setTimeout(() => overlay.querySelector('.confirm-btn-primary, .confirm-btn-danger')?.focus(), 50);
  });
}
window.confirmModal = confirmModal;

/**
 * Turn a failed cancel into a user-friendly message. Distinguishes session
 * expiry (401/403), offline, and server errors (prefers server `message`).
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
    if (failedResponse.status === 401 || failedResponse.status === 403) {
      return 'Session expired — sign in and try again.';
    }
    if ((data && data.message)) return data.message;
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
  // Leaving a waitlist isn't a late cancel — no fee warning needed.
  if (_myBookings[String(eventId)]?.waitlisted) {
    return confirmModal({
      title: 'Leave the waitlist?',
      confirmText: 'Leave waitlist',
      cancelText: 'Stay on it',
      danger: true,
    });
  }
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
        if (booking.slots.length === 0) delete _myBookings[String(eventId)];
      }
      // Update the slot visually: mine → available
      const g = document.querySelector(`#bikeSvg .bike-slot[data-slot="${slotId}"]`);
      if (g) {
        g.classList.replace('mine', 'available');
        g.setAttribute('onclick', `selectBike(${slotId})`);
      }
      // Update card button
      const card = document.querySelector(`.class-card[data-id="${eventId}"]`);
      if (card) {
        const btn = card.querySelector('.book-btn');
        if (btn) {
          const studioId = card.dataset.studioId || 0;
          btn.textContent = 'Book';
          btn.className = 'book-btn';
          btn.disabled = false;
          btn.onclick = () => bookClass(eventId, btn, studioId);
        }
        card.classList.remove('is-booked');
      }
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
  if (!(await confirmCancelWithPolicy(eventId, 'Cancel this booking?'))) return;
  btn.disabled = true;
  btn.textContent = '…';
  const booking = _myBookings[String(eventId)];

  const bookingIds = booking?.slotBookings
    ? Object.values(booking.slotBookings)
    : (bookingId ? [bookingId] : (booking?.bookingId ? [booking.bookingId] : []));

  // Offline: queue the cancel and optimistically clear local state.
  if (!navigator.onLine && typeof queueOfflineCancel === 'function') {
    queueOfflineCancel(eventId, bookingIds);
    delete _myBookings[String(eventId)];
    btn.textContent = 'Book';
    btn.className = 'book-btn';
    btn.disabled = false;
    btn.removeAttribute('data-booking-id');
    const studioId = btn.dataset.studioId || btn.closest('.class-card')?.dataset?.studioId || 0;
    btn.onclick = () => bookClass(eventId, btn, studioId);
    btn.closest('.class-card')?.classList.remove('is-booked');
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
    const isOk = r => r.ok || r.status === 204 || r.status === 200;
    const allOk = results.every(isOk);
    if (allOk) {
      delete _myBookings[String(eventId)];
      btn.textContent = 'Book';
      btn.className = 'book-btn';
      btn.disabled = false;
      btn.removeAttribute('data-booking-id');
      // Restore book onclick
      const studioId = btn.dataset.studioId || btn.closest('.class-card')?.dataset?.studioId || 0;
      btn.onclick = () => bookClass(eventId, btn, studioId);
      btn.closest('.class-card')?.classList.remove('is-booked');
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
      delete _myBookings[String(eventId)];
      btn.textContent = 'Book';
      btn.className = 'book-btn';
      btn.disabled = false;
      const studioId = btn.dataset.studioId || btn.closest('.class-card')?.dataset?.studioId || 0;
      btn.onclick = () => bookClass(eventId, btn, studioId);
      btn.closest('.class-card')?.classList.remove('is-booked');
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
  const slotLabel = booking.waitlisted
    ? 'Waitlisted ✓'
    : (booking.slots.length ? `${formatSlots(slotLabelForEvent(eventId), booking.slots)} ✓` : 'Booked ✓');
  btn.textContent = slotLabel;
  btn.className = 'book-btn booked';
  btn.disabled = false;
  btn.dataset.bookingId = booking.bookingId;
  btn.dataset.eventId = eventId;
  btn.onclick = () => confirmUnbook(booking.bookingId, eventId, btn);
  // Apply green card highlight
  const card = btn.closest('.class-card');
  if (card) card.classList.add('is-booked');
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
  if (myBooking) {
    bookLabel = myBooking.waitlisted
      ? 'Waitlisted ✓'
      : (myBooking.slots.length ? `${formatSlots(slotLabel(type?.name), myBooking.slots)} ✓` : 'Booked ✓');
    bookCls = 'book-btn booked';
    bookDisabled = '';
    // Open picker to show/cancel seats; fall back to direct cancel if no layout
    const hasLayout = !!(_studioMap[evt.studio_id]?.has_layout);
    bookOnclick = hasLayout
      ? `bookClass(${evt.id}, this, ${evt.studio_id})`
      : `confirmUnbook(${myBooking.bookingId}, ${evt.id}, this)`;
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

  return `<div class="class-card${myBooking ? ' is-booked' : ''}" data-id="${evt.id}" data-studio-id="${evt.studio_id}"
    onclick="openClassDetail(${evt.id})" style="cursor:pointer">
    <div class="cc-time">
      <span class="cc-time-h">${h12}:${mins}<span class="cc-ampm">${ampm}</span></span>
      <span class="cc-dur">${evt.duration} min</span>
    </div>
    <div class="cc-rule"></div>
    <div class="cc-info">
      <span class="cc-name">${escapeHTML(type?.name || 'Class')}</span>
      <span class="cc-sub">${instrLink(instr?.full_name, instr?.id)}${locName ? ' · ' + escapeHTML(locName) : ''}</span>
      ${spotsHtml}
      ${onlineMeta}
    </div>
    <div class="cc-action">
      <button class="${bookCls}" ${bookDisabled} data-event-id="${evt.id}" data-studio-id="${evt.studio_id}"
        ${myBooking ? `data-booking-id="${myBooking.bookingId}"` : ''}
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

  // Cache event metadata for the upcoming panel
  events.forEach(e => {
    if (!_eventCache[String(e.id)]) {
      const type = typeMap[e.event_type_id];
      const instr = instrMap[e.instructor_id];
      const studio = studioMap[e.studio_id];
      const loc = studio ? locationMap[studio.location_id] : null;
      _eventCache[String(e.id)] = {
        ...e,
        _typeName: type?.name || 'Class',
        _instrName: instr?.full_name || '',
        _locName: loc ? loc.name.replace('Psycle ', '') : '',
        _locFullName: loc ? loc.name : '',
        _locAddress: loc ? (loc.address || '') : '',
        _studioName: studio ? studio.name : '',
      };
    }
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
  const past = all.filter(({ evt }) => new Date(evt.start_at) <= now);

  countEl.textContent = upcoming.length;

  // Empty tab: a real destination, not a blank page. Signed out → the
  // one action that matters (sign in); signed in → go find a class.
  const emptyEl = document.getElementById('bookingsEmpty');
  const histBtn = document.getElementById('historyInBookingsBtn');
  let histCount = 0;
  try { histCount = JSON.parse(localStorage.getItem('psycle_class_history') || '[]').length; } catch {}

  if (all.length === 0) {
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

  // Membership / credits info bar + billing period
  var periodStart = null, periodEnd = null, nextPeriodStart = null;
  const fmtDate = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  // period_end from API is the START of the next period — display as last day of current period
  const fmtEndDate = d => { var prev = new Date(d); prev.setDate(prev.getDate() - 1); return fmtDate(prev); };
  const userStats = currentUser?.stats || {};
  const creditsRemaining = Number(userStats.credits_remaining) || 0;
  const availableCredits = currentUser?.available_credits || [];

  if (_activeSubscription) {
    periodStart = _activeSubscription.period_start ? new Date(_activeSubscription.period_start) : null;
    periodEnd = _activeSubscription.period_end ? new Date(_activeSubscription.period_end) : null;
    const periods = _activeSubscription.upcoming_billing_periods || [];
    nextPeriodStart = periods.length > 0 ? new Date(periods[0].start) : null;

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
      const nextLabel = nextPeriod ? `${fmtDate(new Date(nextPeriod.start))} — ${fmtDate(new Date(nextPeriod.end))}` : '';
      const nextMax = _activeSubscription?.max_bookings || 0;

      html += `<div class="mb-period-section">`;
      html += `<div class="mb-period-bar mb-period-bar-next" onclick="this.parentElement.classList.toggle('collapsed')">`;
      html += `<div class="mb-period-bar-text">`;
      html += `<span class="sub-bar-name">${escapeHTML(planName)}</span>`;
      html += `<span class="sub-bar-count">${nextPeriodItems.length}/${nextMax > 0 ? nextMax : '∞'} classes · ${nextLabel}</span>`;
      html += `</div>`;
      if (nextMax > 0) {
        const nextPct = Math.round((nextPeriodItems.length / nextMax) * 100);
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

      let badges = `<span class="badge">${evt.duration}min</span>`;
      if (booking.waitlisted) badges += `<span class="badge waitlist">Waitlisted</span>`;
      if (evt.is_live_stream) badges += `<span class="badge highlight">Online</span>`;
      if (eventPast) badges += `<span class="badge" style="background:#1a1a1a;color:#555">Attended</span>`;

      // Countdown badge for the next 2 upcoming classes
      if (!eventPast && _countdownShown < 2) {
        const cdText = getCountdownText(dt, now);
        if (cdText) {
          badges += `<span class="mb-countdown">${cdText}</span>`;
          _countdownShown++;
        }
      }

      // Seat chips + cancel
      let seatHtml = '';
      if (booking.slots.length > 0) {
        const _slUp = slotLabelForEvent(evtId);
        const chips = booking.slots.map(slot => {
          if (eventPast) return `<span class="up-seat-chip" style="opacity:0.5">${_slUp} ${slot}</span>`;
          return `<span class="up-seat-chip">${_slUp} ${slot}<button onclick="event.stopPropagation();upcomingSeatCancel(${evtId}, ${slot}, this)" title="Cancel ${_slUp} ${slot}">&times;</button></span>`;
        }).join('');
        seatHtml = `<div class="up-seats" style="margin-top:8px">${chips}`;
        if (!eventPast && booking.slots.length > 1) {
          seatHtml += `<button class="up-cancel-all" onclick="event.stopPropagation();upcomingCancel(${evtId}, this)">Cancel All</button>`;
        }
        seatHtml += `</div>`;
      }

      // Cancel button for no-slot bookings
      let cancelBtn = '';
      if (!eventPast && booking.slots.length === 0) {
        cancelBtn = `<button class="book-btn booked" onclick="event.stopPropagation();upcomingCancel(${evtId}, this)" style="margin-top:10px;width:100%">${booking.waitlisted ? 'Leave waitlist' : 'Cancel booking'}</button>`;
      }

      // Action buttons (upcoming only)
      let rebookBtn = '';
      if (!eventPast) {
        const hoursUntil = (dt - now) / 3600000;
        const canChange = hoursUntil > 12;

        rebookBtn = `<div class="booking-actions">`;

        // Add a spot — opens bike picker to book an additional slot
        if (booking.slots.length < 2) {
          rebookBtn += `<button class="booking-action-btn" onclick="event.stopPropagation();bookClass(${evtId}, this, ${evt.studio_id})" title="Add another spot">+ Add spot</button>`;
        }

        // Change spot — only if >12h away and class not full
        if (canChange && booking.slots.length > 0) {
          rebookBtn += `<button class="booking-action-btn" onclick="event.stopPropagation();changeSpot(${evtId})" title="Change to a different spot">Change spot</button>`;
        }

        rebookBtn += `<button class="booking-action-btn" onclick="event.stopPropagation();findSimilar(${evtId})" title="Find similar classes">↻ Similar</button>`;
        if (evt._locAddress || evt._locFullName || evt._locName) {
          rebookBtn += `<button class="booking-action-btn" onclick="event.stopPropagation();openMapForBooking(${evtId})" title="Open the studio in Maps">📍 Map</button>`;
        }
        rebookBtn += `</div>`;
      }

      html += `<div class="class-card is-booked my-booking-card" data-id="${evtId}" data-studio-id="${evt.studio_id}"
        onclick="scrollToClass(${evtId}, event)" style="cursor:pointer" title="Jump to class in search results">
        <div class="class-time">${h12}:${mins}<span class="class-time-ampm">${ampm}</span></div>
        <div class="class-info">
          <div class="class-type">${escapeHTML(typeName)}</div>
          <div class="class-instructor">${instrLink(instrName, evt.instructor_id)}</div>
          <div class="class-location">${escapeHTML(locName)}${studioName ? ' · ' + escapeHTML(studioName) : ''}</div>
          <div class="class-meta">${badges}</div>
          ${seatHtml}
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

  // Calendar sync actions (only when bookings exist)
  if (upcoming.length > 0 && typeof renderCalendarActions === 'function') {
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
  if (ctx.booking.slots.length > 1) {
    const chips = ctx.booking.slots.map(function (s) {
      const cls = 'change-chip' + (s === ctx.slotToChange ? ' is-active' : '');
      return '<button type="button" class="' + cls + '" onclick="setChangeSpotTarget(' + s + ')">' +
        label + ' ' + s + '</button>';
    }).join('');
    hint.innerHTML = 'Changing: <span class="change-chip-row">' + chips + '</span>' +
      ' — now pick a new ' + low + ' on the layout.';
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

async function executeSpotSwap() {
  const ctx = window._changeSpotContext;
  if (!ctx || _selectedSlots.length === 0) return;

  const newSlot = _selectedSlots[0];
  const label = slotLabelForEvent(ctx.eventId);
  const confirmBtn = document.getElementById('confirmBookBtn');
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Swapping...'; }

  try {
    // Step 1: Cancel the old slot
    const cancelPath = ctx.bookingId ? '/bookings/' + ctx.bookingId : '/bookings?event_id=' + ctx.eventId;
    const cancelRes = await apiFetch(cancelPath, { method: 'DELETE' });
    if (!cancelRes.ok && cancelRes.status !== 204) {
      throw new Error('Failed to cancel old spot');
    }

    // Step 2: Book the new slot
    const bookRes = await apiFetch('/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ event_id: Number(ctx.eventId), slots: [newSlot] }),
    });

    if (bookRes.ok || bookRes.status === 201) {
      toast(label + ' changed: ' + ctx.slotToChange + ' → ' + newSlot, 'success');
      closeBikePicker();
      fetchMyBookings();
      PsycleEvents.emit('booking:complete', ctx.eventId, [newSlot]);
    } else {
      const err = await bookRes.json().catch(() => ({}));
      toast('Swap failed: ' + (err.message || 'could not book new spot'), 'error');
      // Try to re-book the original slot as recovery
      await apiFetch('/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ event_id: Number(ctx.eventId), slots: [ctx.slotToChange] }),
      });
      fetchMyBookings();
    }
  } catch (e) {
    toast('Swap failed: ' + e.message, 'error');
    fetchMyBookings(); // refresh to show actual state
  }

  window._changeSpotContext = null;
  if (confirmBtn) { confirmBtn.disabled = false; }
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
  if (!(await confirmCancelWithPolicy(eventId, 'Cancel this booking?'))) return;
  btn.disabled = true;
  btn.textContent = '…';

  const bookingIds = booking.slotBookings
    ? Object.values(booking.slotBookings)
    : (booking.bookingId ? [booking.bookingId] : []);

  // Offline: queue + optimistic.
  if (!navigator.onLine && typeof queueOfflineCancel === 'function') {
    queueOfflineCancel(eventId, bookingIds);
    delete _myBookings[String(eventId)];
    const card = document.querySelector(`.class-card[data-id="${eventId}"]`);
    if (card) {
      card.classList.remove('is-booked');
      const cardBtn = card.querySelector('.book-btn');
      if (cardBtn) {
        cardBtn.textContent = 'Book';
        cardBtn.className = 'book-btn';
        cardBtn.disabled = false;
        const studioId = card.dataset.studioId || 0;
        cardBtn.onclick = () => bookClass(eventId, cardBtn, studioId);
      }
    }
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
    const isOk = r => r.ok || r.status === 204 || r.status === 200;
    const allOk = results.every(isOk);
    if (allOk) {
      delete _myBookings[String(eventId)];
      // Also update any rendered card
      const card = document.querySelector(`.class-card[data-id="${eventId}"]`);
      if (card) {
        card.classList.remove('is-booked');
        const cardBtn = card.querySelector('.book-btn');
        if (cardBtn) {
          cardBtn.textContent = 'Book';
          cardBtn.className = 'book-btn';
          cardBtn.disabled = false;
          const studioId = card.dataset.studioId || 0;
          cardBtn.onclick = () => bookClass(eventId, cardBtn, studioId);
        }
      }
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
      delete _myBookings[String(eventId)];
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
      if (booking.slots.length === 0) {
        delete _myBookings[String(eventId)];
      }
      // Update the corresponding class card in results if rendered
      const card = document.querySelector(`.class-card[data-id="${eventId}"]`);
      if (card) {
        const cardBtn = card.querySelector('.book-btn');
        if (_myBookings[String(eventId)] && _myBookings[String(eventId)].slots.length > 0) {
          // Still has remaining seats — update the label
          if (cardBtn) applyBookedState(cardBtn, Number(eventId), _myBookings[String(eventId)]);
        } else {
          // No seats left — revert card to unbooked state
          card.classList.remove('is-booked');
          if (cardBtn) {
            cardBtn.textContent = 'Book';
            cardBtn.className = 'book-btn';
            cardBtn.disabled = false;
            const studioId = card.dataset.studioId || 0;
            cardBtn.onclick = () => bookClass(eventId, cardBtn, studioId);
          }
        }
      }
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
  let bookBtnHtml;
  if (myBooking) {
    const bookedLabel = myBooking.slots.length ? formatSlots(slotLabelForEvent(eventId), myBooking.slots) + ' ✓' : 'Booked ✓';
    bookBtnHtml = '<button class="cds-book-btn booked" onclick="event.stopPropagation();document.getElementById(\'classDetailOverlay\').remove();var b=document.querySelector(\'.book-btn[data-event-id=\\x22' + eventId + '\\x22]\');if(b)b.click();">' + escapeHTML(bookedLabel) + '</button>';
  } else if (evt.is_fully_booked && !evt.is_waitlistable) {
    bookBtnHtml = '<button class="cds-book-btn" disabled>Full</button>';
  } else if (evt.is_fully_booked && evt.is_waitlistable) {
    bookBtnHtml = '<button class="cds-book-btn waitlist" onclick="event.stopPropagation();document.getElementById(\'classDetailOverlay\').remove();var b=document.querySelector(\'.book-btn[data-event-id=\\x22' + eventId + '\\x22]\');if(b)b.click();">Join Waitlist</button>';
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
  const safeInstrName = escapeHTML(instrName).replace(/'/g, "\\'");
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
function _upcomingWeekdayDate(dayOfWeek, fromDate = new Date()) {
  const today0 = new Date(fromDate);
  today0.setHours(0, 0, 0, 0);
  let diff = (Number(dayOfWeek) - today0.getDay() + 7) % 7;
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
      if (!isWaitlistable) return 'failed';
      await submitBooking(eventId, null, btn, { waitlist: true });
      return btn.classList.contains('booked') ? 'waitlisted' : 'failed';
    }

    if (hasLayout) {
      // Auto-pick: the user's usual slot if it's free, else the first available.
      const usual = _usualSlotForEvent(eventId);
      let pick = (usual != null && availableSlotIds.has(Number(usual))) ? Number(usual) : null;
      if (pick == null) pick = [...availableSlotIds][0];
      if (pick == null) return 'failed';
      await submitBooking(eventId, [pick], btn);
    } else {
      await submitBooking(eventId, null, btn);
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
async function bookWeeklyTemplate() {
  const counts = { booked: 0, waitlisted: 0, failed: 0, skipped: 0 };
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
        if (!_eventCache[String(e.id)]) {
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
        }
      });
      return data.data || [];
    })().catch(() => []);
    dayCache[key] = p;
    return p;
  };

  const tasks = template.map(async entry => {
    try {
      const dayStr = _upcomingWeekdayDate(entry.dayOfWeek);
      const targetMin = (Number(entry.hour) || 0) * 60 + (Number(entry.minute) || 0);
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
