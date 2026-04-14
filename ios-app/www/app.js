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
const today = new Date().toISOString().split('T')[0];

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
  return fetch(apiUrl(path), { ...opts, headers }).then(res => {
    if ((res.status === 401 || res.status === 403) && getBearerToken()) {
      showSessionExpired();
    }
    return res;
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
  if (!getBearerToken()) { _myBookings = {}; return; }
  try {
    const res = await apiFetch('/bookings');
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

// Toast (toastTimer managed by state.js)
function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

// Auth check
async function checkAuth() {
  const pill = document.getElementById('authPill');
  if (!getBearerToken()) {
    currentUser = null;
    pill.innerHTML = `<a href="#" onclick="event.preventDefault();openLoginPopup()" class="auth-link"><span class="auth-full">Sign in</span><span class="auth-icon">👤</span></a>`;
    return;
  }
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
      pill.innerHTML = `<span class="user-name"><span class="auth-full">Logged in as </span><strong>${escapeHTML(name)}</strong></span>
        <a href="#" onclick="event.preventDefault();clearToken()" class="disconnect-link"><span class="auth-full">Log out</span><span class="auth-icon">✕</span></a>`;
      fetchMyBookings();
      // Feature 13: restore last search results if available
      restoreLastResults();
      // After first login, offer to sync booking history
      setTimeout(function () { showHistorySyncPrompt(); }, 1500);
    } else {
      showSessionExpired();
    }
  } catch {
    currentUser = null;
    pill.innerHTML = `<a href="#" onclick="event.preventDefault();openLoginPopup()" class="auth-link"><span class="auth-full">Sign in</span><span class="auth-icon">👤</span></a>`;
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
  pill.innerHTML = `<a href="#" onclick="event.preventDefault();openLoginPopup()" class="auth-link" style="color:#e94560;font-weight:700"><span class="auth-full">Sign in →</span><span class="auth-icon">👤</span></a>`;
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
  locations = lRes.data.filter(l => l.is_visible && l.handle !== 'psycle-at-home');
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

  const lSel = document.getElementById('locationSelect');
  lSel.innerHTML = '<option value="">All Studios</option>' +
    locations.map(l => `<option value="${l.id}">${escapeHTML(l.name.replace('Psycle ', ''))}</option>`).join('');

  renderCategoryPills();
  renderStrengthSubPills();
  document.getElementById('startDate').value = today;
  document.getElementById('daysAhead').value = 7;
  // Mark "7 days" as the default active quick button
  document.querySelectorAll('.date-quick-btn').forEach(b => {
    if (b.textContent.trim() === '7 days') b.classList.add('active');
  });
})();

// _dateQuickMode managed by state.js (default: 'week')

// ── Auto-search on filter change (debounced) ───────────────────
let _autoSearchTimer = null;
function triggerAutoSearch() {
  clearTimeout(_autoSearchTimer);
  _autoSearchTimer = setTimeout(() => {
    if (!window._searchAborted) search();
  }, 500);
}
// Auto-search when location dropdown changes
document.getElementById('locationSelect')?.addEventListener('change', triggerAutoSearch);

function setDateQuick(mode) {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

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
let _filtersCollapsed = false;

function toggleFilters() {
  _filtersCollapsed = !_filtersCollapsed;
  const body = document.getElementById('controlsBody');
  const chevron = document.getElementById('controlsChevron');
  if (body) body.style.display = _filtersCollapsed ? 'none' : '';
  if (chevron) chevron.classList.toggle('collapsed', _filtersCollapsed);
}

function clearFilters() {
  selectedInstructors.clear();
  // Re-apply favourites if any saved
  if (favouriteInstructors.size > 0) {
    favouriteInstructors.forEach(id => {
      if (instructors.some(i => String(i.id) === id)) selectedInstructors.add(id);
    });
  }
  document.getElementById('instrSearch').value = '';
  renderInstrChips();
  renderInstrDropdown();
  document.getElementById('locationSelect').value = '';
  selectedCategories.clear();
  selectedStrengthSubs.clear();
  selectedStrengthSubs.add('UPPER'); selectedStrengthSubs.add('LOWER'); selectedStrengthSubs.add('FULL');
  renderCategoryPills();
  renderStrengthSubPills();
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('startDate').value = today;
  document.getElementById('daysAhead').value = 7;
  document.getElementById('results').innerHTML = '<div class="status">Select an instructor or filter, then click Search.</div>';
}

function setStatus(html) {
  document.getElementById('results').innerHTML = `<div class="status">${html}</div>`;
}

async function fetchEventsForLocation(locId, startDate, endDateStr, seenIds) {
  const limit = 200;
  let windowStart = startDate + ' 00:00:00';
  const windowEnd  = endDateStr + ' 23:59:59';
  let locEvents = [], locRelations = null;

  while (true) {
    if (window._searchAborted) break;
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

async function search() {
  const instructorId = [...selectedInstructors];
  const locationId   = document.getElementById('locationSelect').value;
  const categoryKeys = new Set(selectedCategories);
  const startDate    = document.getElementById('startDate').value;
  const days         = parseInt(document.getElementById('daysAhead').value) || 14;

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

  const btn = document.getElementById('searchBtn');
  btn.disabled = false;
  btn.textContent = 'Stop';
  btn.onclick = () => { window._searchAborted = true; };
  window._searchAborted = false;

  setStatus('<span class="spinner"></span>Connecting…');

  const filters = { instructorId, locationId, categoryKeys, startDate, endDateStr, strengthSubs: new Set(selectedStrengthSubs) };
  let allEvents = [], relations = null;
  const seenIds = new Set();

  // Which locations to query
  const locationsToFetch = locationId
    ? [{ id: locationId }]
    : locations.filter(l => l.handle !== 'psycle-at-home');

  try {
    if (locationId) {
      // Single location: stream page by page so results appear progressively
      await (async () => {
        const limit = 200;
        let windowStart = startDate + ' 00:00:00';
        const windowEnd  = endDateStr + ' 23:59:59';
        while (true) {
          if (window._searchAborted) break;
          const params = new URLSearchParams({ start: windowStart, end: windowEnd, location: locationId, limit });
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
        const { events, relations: rel } = await fetchEventsForLocation(loc.id, startDate, endDateStr, seenIds);
        if (window._searchAborted) return;
        allEvents = allEvents.concat(events);
        if (!relations) relations = rel;
        else if (rel) mergeRelations(relations, rel);
        done++;
        if (relations) render(allEvents, relations, filters, done === total);
      });

      await Promise.all(promises);
    }

    if (!relations) setStatus('No classes found.');
    else render(allEvents, relations, filters, true);

  } catch (e) {
    setStatus(`<span style="color:#e94560">Error: ${escapeHTML(e.message)}</span>`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Search';
    btn.onclick = search;
  }
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

  btn.disabled = true;
  btn.textContent = '…';

  try {
    const res = await apiFetch(`/events/${eventId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const detail = await res.json();
    // detail.slots = AVAILABLE (bookable) slot IDs
    const availableSlotIds = new Set((detail.slots || []).map(Number));

    const studio = _studioMap[studioId];
    const layout = studio?.layout;
    const hasLayout = studio?.has_layout && layout?.slots?.length > 0;

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
  }
}

function showBikePicker(eventId, btn, layout, availableSlotIds, mySlotIds, studioName) {
  _bookingContext = { eventId, btn };
  _selectedSlots = [];

  const hasMySlots = mySlotIds.size > 0;
  const _sl = slotLabelForEvent(eventId).toLowerCase();
  const _SL = slotLabelForEvent(eventId);
  document.getElementById('modalTitle').textContent = hasMySlots ? 'Your booking' : `Select your ${_sl}(s)`;

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
    ? `Your ${_sl}(s) shown in green — click to cancel. Select another to book.`
    : `Select up to ${MAX_SEATS} ${_sl}s`;
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

  inner += slots.map(slot => {
    const id = Number(slot.id);
    const isMine = mySlotIds.has(id);
    const isAvailable = availableSlotIds.has(id);
    const label = slot.label ?? slot.id;
    const cls = isMine ? 'mine' : isAvailable ? 'available' : 'taken';
    const click = isMine ? `onclick="cancelBikeSlot(${slot.id}, ${eventId})"` : isAvailable ? `onclick="selectBike(${slot.id})"` : '';
    return `<g class="bike-slot ${cls}" data-slot="${slot.id}" ${click}>
      <rect x="${sx(slot.x)}" y="${sy(slot.y)}" width="${SLOT}" height="${SLOT}" rx="6" stroke-width="1.5"/>
      <text x="${sx(slot.x)+SLOT/2}" y="${sy(slot.y)+SLOT/2+4}"
        text-anchor="middle" font-family="sans-serif" font-size="11">${label}</text>
    </g>`;
  }).join('');

  svg.innerHTML = inner;
  document.getElementById('bikeModal').style.display = 'flex';
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
    count === 0 ? `Select up to ${MAX_SEATS} ${_sl2.toLowerCase()}s`
    : count === 1 ? `${_sl2} ${_selectedSlots[0]} selected — pick a second or confirm`
    : `${_sl2}s ${_selectedSlots.join(' & ')} selected`;
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

async function submitBooking(eventId, slots, btn) {
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
    if (res.ok) {
      const label = slots?.length ? `Bikes ${slots.join(' & ')} ✓` : 'Booked ✓';
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
      _myBookings[String(eventId)] = { bookingId, slots: slotsArr, slotBookings };
      btn.onclick = () => confirmUnbook(bookingId || null, eventId, btn);
      showBookingConfirmation(eventId, slotsArr);
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
function showBookingConfirmation(eventId, slotsArr) {
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
  const slotStr = slotsArr.length
    ? `${_SL}${slotsArr.length > 1 ? 's' : ''} ${slotsArr.join(' & ')}`
    : '';

  // Class info line
  const classLine = [typeName, instrName].filter(Boolean).join(' \u00b7 ');

  const el = document.createElement('div');
  el.id = 'bookingConfirmation';
  el.className = 'booking-confirmation';
  el.innerHTML = `
    <div class="bc-content">
      <div class="bc-check">&#10003;</div>
      <div class="bc-text">
        <div class="bc-title">Booked!</div>
        <div class="bc-detail">${classLine}</div>
        ${dateTimeStr ? `<div class="bc-detail bc-dim">${dateTimeStr}</div>` : ''}
        ${slotStr ? `<div class="bc-slot">${slotStr}</div>` : ''}
      </div>
    </div>
    <div class="bc-actions">
      <button class="bc-btn bc-btn-secondary" onclick="dismissBookingConfirmation();scrollToUpcoming()">View my bookings</button>
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

async function cancelBikeSlot(slotId, eventId) {
  const booking = _myBookings[String(eventId)];
  const _sl3 = slotLabelForEvent(eventId);
  if (!confirm(`Cancel your ${_sl3} ${slotId} booking?`)) return;
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
      toast(data.message || `Cancel failed (${res.status})`, 'error');
    }
  } catch (e) {
    document.getElementById('modalHint').textContent = 'Cancel failed — try again';
    toast(e.message, 'error');
  }
}

async function confirmUnbook(bookingId, eventId, btn) {
  if (!confirm('Cancel this booking?')) return;
  btn.disabled = true;
  btn.textContent = '…';
  const booking = _myBookings[String(eventId)];
  try {
    // Cancel ALL booking records for this event (one per seat)
    const bookingIds = booking?.slotBookings
      ? Object.values(booking.slotBookings)
      : (bookingId ? [bookingId] : (booking?.bookingId ? [booking.bookingId] : []));
    if (bookingIds.length === 0) bookingIds.push(null);
    const results = await Promise.all(bookingIds.map(bid => {
      const path = bid ? `/bookings/${bid}` : `/bookings?event_id=${eventId}`;
      return apiFetch(path, { method: 'DELETE' });
    }));
    const allOk = results.every(r => r.ok || r.status === 204 || r.status === 200);
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
      const data = await res.json().catch(() => ({}));
      btn.disabled = false;
      btn.textContent = 'Booked ✓';
      PsycleEvents.emit('booking:cancel_failed', eventId, data);
      toast(data.message || `Cancel failed (${res.status})`, 'error');
    }
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Booked ✓';
    toast(e.message, 'error');
  }
}
// ─────────────────────────────────────────────────────────────────

function applyBookedState(btn, eventId, booking) {
  const slotLabel = booking.slots.length ? `Bikes ${booking.slots.join(' & ')} ✓` : 'Booked ✓';
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
  let bookLabel, bookCls, bookDisabled, bookOnclick;
  if (myBooking) {
    const slotLabel = myBooking.slots.length ? `Bikes ${myBooking.slots.join(' & ')} ✓` : 'Booked ✓';
    bookLabel = slotLabel;
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

  return `<div class="class-card${myBooking ? ' is-booked' : ''}" data-id="${evt.id}" data-studio-id="${evt.studio_id}"
    onclick="openClassDetail(${evt.id})" style="cursor:pointer">
    <div class="class-time">${h12}:${mins}<span class="class-time-ampm">${ampm}</span></div>
    <div class="class-info">
      <div class="class-type">${escapeHTML(type?.name || 'Class')}</div>
      <div class="class-instructor">${instrLink(instr?.full_name, instr?.id)}</div>
      <div class="class-location">${escapeHTML(locName)}${studioName ? ' · ' + escapeHTML(studioName) : ''}</div>
      <div class="class-meta">${badges}</div>
      <div class="card-actions">
        <button class="${bookCls}" ${bookDisabled} data-event-id="${evt.id}" data-studio-id="${evt.studio_id}"
          ${myBooking ? `data-booking-id="${myBooking.bookingId}"` : ''}
          onclick="event.stopPropagation();${bookOnclick}">${bookLabel}</button>
        <button class="share-class-btn" onclick="event.stopPropagation();shareClass(${evt.id})" title="Share this class">&#8599;</button>
      </div>
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
    if (filters.locationId) {
      const studio = studioMap[e.studio_id];
      if (!studio || String(studio.location_id) !== filters.locationId) return false;
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
    ${done ? `— <strong>${filters.startDate}</strong> to <strong>${filters.endDateStr}</strong>` : 'found so far…'}`;
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

    // Group events by category, sorted by time within each category
    const byCat = {};
    for (const evt of dayEvents) {
      const typeName = typeMap[evt.event_type_id]?.name || '';
      const cat = getCategory(typeName);
      if (!byCat[cat.key]) byCat[cat.key] = { cat, events: [] };
      byCat[cat.key].events.push(evt);
    }

    // Render/update each category section
    for (const { cat, events: catEvents } of Object.values(byCat)) {
      let section = body.querySelector(`[data-cat="${cat.key}"]`);
      if (!section) {
        section = document.createElement('div');
        section.dataset.cat = cat.key;
        section.innerHTML = `
          <div class="type-section-header">
            <span class="type-dot" style="background:${cat.color}"></span>
            <span style="color:${cat.color}">${cat.label}</span>
          </div>
          <div class="class-grid"></div>`;
        // Insert category sections in CATEGORY_MAP order
        const catOrder = CATEGORY_MAP.map(c => c.key);
        const insertIdx = catOrder.indexOf(cat.key);
        const siblings = [...body.querySelectorAll('[data-cat]')];
        const after = siblings.find(s => catOrder.indexOf(s.dataset.cat) > insertIdx);
        after ? body.insertBefore(section, after) : body.appendChild(section);
      }

      const grid = section.querySelector('.class-grid');
      const existingIds = new Set([...grid.querySelectorAll('[data-id]')].map(el => el.dataset.id));

      // Insert new cards in time-sorted order
      for (const evt of catEvents.sort((a, b) => a.start_at.localeCompare(b.start_at))) {
        if (existingIds.has(String(evt.id))) continue;
        const newCard = document.createElement('div');
        newCard.innerHTML = eventCard(evt, instrMap, studioMap, locationMap, typeMap);
        const card = newCard.firstElementChild;
        // Insert in time order
        const existing = [...grid.querySelectorAll('[data-id]')];
        const insertBefore = existing.find(el => {
          const elEvt = dayEvents.find(e => String(e.id) === el.dataset.id);
          return elEvt && elEvt.start_at > evt.start_at;
        });
        insertBefore ? grid.insertBefore(card, insertBefore) : grid.appendChild(card);
      }
    }
  }

  // Feature 13: Persist search results to sessionStorage for tab-switch restore
  if (done) {
    try {
      sessionStorage.setItem('psycle_last_results', JSON.stringify({ events, relations, filters: {
        instructorId: filters.instructorId,
        locationId: filters.locationId,
        categoryKeys: [...(filters.categoryKeys || [])],
        startDate: filters.startDate,
        endDateStr: filters.endDateStr,
        strengthSubs: [...(filters.strengthSubs || [])],
        _isTodaySchedule: filters._isTodaySchedule || false,
      }}));
    } catch (e) { console.warn('[psycle] sessionStorage save failed:', e); }
  }
}

function updateLocationHint() {
  const hint = document.getElementById('locationHint');
  hint.textContent = document.getElementById('locationSelect').value ? '' : '— pick one for best results';
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
      locationId: saved.filters.locationId || '',
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
  instrFocusIdx = -1;
  // Sort: favourites first, then alphabetical
  const sorted = [...list].sort((a, b) => {
    const aFav = favouriteInstructors.has(String(a.id));
    const bFav = favouriteInstructors.has(String(b.id));
    if (aFav !== bFav) return aFav ? -1 : 1;
    return 0;
  });
  dd.innerHTML = sorted.length
    ? sorted.map((i, idx) => {
        const sel = selectedInstructors.has(String(i.id));
        const fav = favouriteInstructors.has(String(i.id));
        return `<div class="instr-option${sel ? ' selected' : ''}" data-id="${i.id}" data-idx="${idx}"
          onmousedown="event.preventDefault();toggleInstructor('${i.id}')">
          <span class="check">${sel ? '✓' : ''}</span>
          <span style="flex:1">${escapeHTML(i.full_name)}</span>
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
  renderInstrDropdown();
  triggerAutoSearch();
}

function removeInstructor(id) {
  selectedInstructors.delete(String(id));
  renderInstrChips();
  renderInstrDropdown();
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
  container.innerHTML = catsToShow.map(cat => {
    const active = selectedCategories.has(cat.key);
    return `<button class="cat-pill${active ? ' active' : ''}"
      style="color:${cat.color};border-color:${cat.color};${active ? `background:${cat.color}` : ''}"
      onclick="toggleCategory('${cat.key}')">${cat.label}</button>`;
  }).join('');
}

function toggleCategory(key) {
  if (selectedCategories.has(key)) selectedCategories.delete(key);
  else selectedCategories.add(key);
  renderCategoryPills();
  renderStrengthSubPills();
  triggerAutoSearch();
}
// ────────────────────────────────────────────────────────────────

// Allow pressing Enter to search
document.addEventListener('keydown', e => {
  if (e.key === 'Enter') search();
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
  const todayStr = now.toISOString().split('T')[0];
  const eventDayStr = eventDate.toISOString().split('T')[0];

  // Check if tomorrow
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

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

  if (all.length === 0) {
    panel.style.display = 'none';
    return;
  }

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
  const userStats = currentUser?.stats || {};
  const creditsRemaining = Number(userStats.credits_remaining) || 0;
  const availableCredits = currentUser?.available_credits || [];

  if (_activeSubscription) {
    const made = Number(_activeSubscription.bookings_made) || 0;
    const max = _activeSubscription.max_bookings || 0;
    const planName = _activeSubscription.name || 'Subscription';
    periodStart = _activeSubscription.period_start ? new Date(_activeSubscription.period_start) : null;
    periodEnd = _activeSubscription.period_end ? new Date(_activeSubscription.period_end) : null;
    const periods = _activeSubscription.upcoming_billing_periods || [];
    nextPeriodStart = periods.length > 0 ? new Date(periods[0].start) : null;

    const periodLabel = periodStart && periodEnd ? `${fmtDate(periodStart)} — ${fmtDate(periodEnd)}` : '';

    if (max > 0) {
      // Capped plan (e.g. Longevity 30 classes/month)
      const pct = Math.round((made / max) * 100);
      html += `<div class="sub-bar">
        <div class="sub-bar-text">
          <span class="sub-bar-name">Membership: ${escapeHTML(planName)}</span>
          <span class="sub-bar-count">${made}/${max} classes${periodLabel ? ' · ' + periodLabel : ''}</span>
        </div>
        <div class="sub-progress"><div class="sub-progress-fill" style="width:${Math.min(pct, 100)}%"></div></div>
      </div>`;
    } else {
      // Unlimited plan (no max_bookings) — show plan name + period only
      html += `<div class="sub-bar">
        <div class="sub-bar-text">
          <span class="sub-bar-name">Membership: ${escapeHTML(planName)}</span>
          <span class="sub-bar-count">${made > 0 ? made + ' classes booked' : 'Unlimited'}${periodLabel ? ' · ' + periodLabel : ''}</span>
        </div>
      </div>`;
    }
  } else if (creditsRemaining > 0 || availableCredits.length > 0) {
    // Credit pack user — no subscription, but has credits
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

  // Render period header if we have billing periods and items span both
  const hasPeriodSplit = periodEnd && nextPeriodItems.length > 0;
  if (hasPeriodSplit) {
    const max = _activeSubscription?.max_bookings || 0;
    const made = Number(_activeSubscription?.bookings_made || 0);
    const remaining = max > 0 ? max - made : 0;
    html += `<div class="mb-period-header">Current period`;
    if (remaining > 0) {
      html += ` <span class="mb-period-hint">${remaining} of ${max} credits remaining</span>`;
    }
    html += `</div>`;
  }

  // Render by day (with period separator injected between)
  var periodSeparatorShown = false;
  for (const day of sortedDays) {
    const dayItems = byDay[day];
    const date = new Date(day + 'T12:00:00');
    const isPast = date < now && day !== now.toISOString().split('T')[0];
    const dayLabel = date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

    // Insert next period separator before first day that falls in next period
    if (hasPeriodSplit && !periodSeparatorShown && periodEnd && date >= periodEnd) {
      periodSeparatorShown = true;
      const nextMax = _activeSubscription?.max_bookings || 0;
      html += `<div class="mb-period-header mb-period-next">Next period`;
      if (nextMax > 0) {
        html += ` <span class="mb-period-hint">${nextMax} credits</span>`;
      }
      html += `</div>`;
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
        cancelBtn = `<button class="book-btn booked" onclick="event.stopPropagation();upcomingCancel(${evtId}, this)" style="margin-top:10px;width:100%">Cancel booking</button>`;
      }

      // Rebook next week button (upcoming only)
      let rebookBtn = '';
      if (!eventPast) {
        rebookBtn = `<button class="rebook-btn find-similar-btn" onclick="event.stopPropagation();findSimilar(${evtId})" title="Find similar classes">↻ Similar</button>`;
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

async function rebookNextWeek(eventId) {
  const evt = _eventCache[String(eventId)];
  if (!evt) { toast('Event data not available', 'error'); return; }

  // Calculate same time one week later
  const origDate = new Date(evt.start_at);
  const nextWeek = new Date(origDate);
  nextWeek.setDate(nextWeek.getDate() + 7);
  const dayStr = nextWeek.toISOString().split('T')[0];

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
    if (bookedDate.toISOString().split('T')[0] !== dayStr) return false;
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
  if (!confirm('Cancel this booking?')) return;
  btn.disabled = true;
  btn.textContent = '…';
  try {
    // Cancel ALL booking records for this event (one per seat)
    const bookingIds = booking.slotBookings
      ? Object.values(booking.slotBookings)
      : (booking.bookingId ? [booking.bookingId] : []);
    if (bookingIds.length === 0) bookingIds.push(null); // fallback
    const results = await Promise.all(bookingIds.map(bid => {
      const path = bid ? `/bookings/${bid}` : `/bookings?event_id=${eventId}`;
      return apiFetch(path, { method: 'DELETE' });
    }));
    const allOk = results.every(r => r.ok || r.status === 204 || r.status === 200);
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
      const data = await res.json().catch(() => ({}));
      toast(data.message || `Cancel failed (${res.status})`, 'error');
    }
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Cancel';
    toast(e.message, 'error');
  }
}

async function upcomingSeatCancel(eventId, slotId, btn) {
  const booking = _myBookings[String(eventId)];
  if (!booking) return;
  const _sl4 = slotLabelForEvent(eventId);
  if (!confirm(`Cancel ${_sl4} ${slotId}?`)) return;
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
      toast(data.message || `Cancel failed (${res.status})`, 'error');
    }
  } catch (e) {
    btn.disabled = false;
    if (chip) chip.style.opacity = '';
    toast(e.message, 'error');
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
    const slotLabel = myBooking.slots.length ? 'Bikes ' + myBooking.slots.join(' & ') + ' ✓' : 'Booked ✓';
    bookBtnHtml = '<button class="cds-book-btn booked" onclick="event.stopPropagation();document.getElementById(\'classDetailOverlay\').remove();var b=document.querySelector(\'.book-btn[data-event-id=\\x22' + eventId + '\\x22]\');if(b)b.click();">' + escapeHTML(slotLabel) + '</button>';
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

// ── PWA Service Worker ───────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
