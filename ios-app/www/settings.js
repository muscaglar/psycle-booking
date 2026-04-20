/**
 * settings.js — Settings panel, instructor tiers, bike preferences, floating pill
 *
 * Self-contained IIFE that provides:
 *   - Instructor tier ranking system (S/A/B/C/D/F)
 *   - Per-studio bike/spot preferences (prefer/avoid)
 *   - Floating "next class" countdown pill
 *   - Settings export/import (JSON backup)
 *
 * Depends on: app.js (escapeHTML, _studioMap, _myBookings, _eventCache, etc.),
 *             state.js (PsycleEvents, favouriteInstructors)
 * Exposes on window:
 *   getInstructorTier, getBikePrefs, tierBadgeHTML, openSettings,
 *   closeSettings, filterTierList, setInstructorTier, toggleFavFromSettings,
 *   renderBikePrefGrid, toggleBikePref, exportSettings, importSettings
 */
(function () {
  'use strict';

  var TIER_KEY = 'psycle_instructor_tiers';
  var BIKE_PREF_KEY = 'psycle_bike_prefs';
  var TIERS = ['S', 'A', 'B', 'C', 'D', 'F'];

  // ── Data Persistence ───────────────────────────────────────────

  function loadTiers() {
    try { return JSON.parse(localStorage.getItem(TIER_KEY) || '{}'); } catch { return {}; }
  }
  function saveTiers(t) { localStorage.setItem(TIER_KEY, JSON.stringify(t)); }

  function loadBikePrefs() {
    try { return JSON.parse(localStorage.getItem(BIKE_PREF_KEY) || '{}'); } catch { return {}; }
  }
  function saveBikePrefs(p) { localStorage.setItem(BIKE_PREF_KEY, JSON.stringify(p)); }

  // ── Public API ─────────────────────────────────────────────────

  window.getInstructorTier = function (instrId) {
    return loadTiers()[String(instrId)] || null;
  };

  window.getBikePrefs = function (studioId) {
    var prefs = loadBikePrefs();
    return prefs[String(studioId)] || { avoid: [], prefer: [] };
  };

  window.tierBadgeHTML = function (instrId) {
    var tier = getInstructorTier(instrId);
    if (!tier) return '';
    return '<span class="tier-badge tier-' + tier + '">' + tier + '</span>';
  };


  // ═══════════════════════════════════════════════════════════════════
  // Floating Next Class Pill
  // ═══════════════════════════════════════════════════════════════════

  var _pillEl = null;
  var _pillTimer = null;

  function createPill() {
    if (_pillEl) return;
    _pillEl = document.createElement('div');
    _pillEl.className = 'next-class-pill hidden';
    _pillEl.onclick = function () {
      if (typeof switchTab === 'function') switchTab('bookings');
    };
    document.body.appendChild(_pillEl);
  }

  function updatePill() {
    if (!_pillEl) createPill();
    var bookings = _myBookings || {};
    var cache = _eventCache || {};
    var now = new Date();

    // Find next upcoming class
    var next = null;
    var nextEvtId = null;
    Object.entries(bookings).forEach(function (entry) {
      var evtId = entry[0];
      var evt = cache[evtId];
      if (!evt) return;
      var dt = new Date(evt.start_at);
      if (dt <= now) return;
      if (!next || dt < new Date(next.start_at)) {
        next = evt;
        nextEvtId = evtId;
      }
    });

    if (!next) {
      _pillEl.classList.add('hidden');
      return;
    }

    var booking = bookings[nextEvtId];
    var dt = new Date(next.start_at);
    var diff = dt.getTime() - now.getTime();
    var hours = Math.floor(diff / 3600000);
    var mins = Math.floor((diff % 3600000) / 60000);

    var countdown;
    if (hours >= 24) {
      var days = Math.floor(hours / 24);
      countdown = days + 'd ' + (hours % 24) + 'h';
    } else if (hours > 0) {
      countdown = hours + 'h ' + mins + 'm';
    } else {
      countdown = mins + 'm';
    }

    var _slPill = (typeof slotLabelForEvent === 'function') ? slotLabelForEvent(nextEvtId) : 'Bike';
    var slots = (booking && booking.slots && booking.slots.length)
      ? _slPill + (booking.slots.length > 1 ? 's ' : ' ') + booking.slots.join(' & ')
      : '';

    _pillEl.innerHTML =
      '<div class="ncp-countdown">' + countdown + '</div>' +
      '<div class="ncp-info">' +
        '<div class="ncp-class">' + escapeHTML(next._typeName || 'Class') +
          (next._instrName ? ' — ' + escapeHTML(next._instrName) : '') + '</div>' +
        '<div class="ncp-detail">' + escapeHTML(next._locName || '') +
          (next._studioName ? ' · ' + escapeHTML(next._studioName) : '') + '</div>' +
      '</div>' +
      (slots ? '<div class="ncp-seat">' + slots + '</div>' : '');

    _pillEl.classList.remove('hidden');
  }

  function startPillTimer() {
    createPill();
    updatePill();
    if (_pillTimer) clearInterval(_pillTimer);
    _pillTimer = setInterval(updatePill, 30000); // update every 30s
  }

  // Start pill after bookings load (via PsycleEvents)
  if (typeof PsycleEvents !== 'undefined') {
    PsycleEvents.on('bookings:loaded', function () { startPillTimer(); });
    PsycleEvents.on('booking:complete', function () { updatePill(); });
    PsycleEvents.on('booking:cancelled', function () { updatePill(); });
    PsycleEvents.on('seat:cancelled', function () { updatePill(); });
  } else {
    // Fallback: poll for bookings
    var _pollPill = setInterval(function () {
      if (typeof _myBookings !== 'undefined' && Object.keys(_myBookings).length > 0) {
        startPillTimer();
        clearInterval(_pollPill);
      }
    }, 1000);
  }


  // ═══════════════════════════════════════════════════════════════════
  // Settings Panel
  // ═══════════════════════════════════════════════════════════════════

  window.openSettings = function () {
    if (document.getElementById('settingsOverlay')) return;

    var overlay = document.createElement('div');
    overlay.id = 'settingsOverlay';
    overlay.className = 'settings-overlay';
    overlay.onclick = function (e) { if (e.target === overlay) closeSettings(); };

    overlay.innerHTML =
      '<div class="settings-panel">' +
        '<div class="settings-header">' +
          '<span class="settings-title">Settings</span>' +
          '<button class="settings-close" onclick="closeSettings()">×</button>' +
        '</div>' +
        '<div class="settings-section">' +
          '<div class="settings-section-title">Instructor Rankings & Favourites</div>' +
          '<input class="tier-search" id="tierSearch" placeholder="Search instructors…" oninput="filterTierList()">' +
          '<div class="tier-list" id="tierList"></div>' +
        '</div>' +
        '<div class="settings-section">' +
          '<div class="settings-section-title">Bike / Spot Preferences</div>' +
          '<select class="bike-pref-studio-select" id="bikePrefStudio" onchange="renderBikePrefGrid()">' +
            '<option value="">Select a studio…</option>' +
          '</select>' +
          '<div class="bike-pref-legend">' +
            '<span><i style="background:#1a1a1a;border:1px solid #333"></i> Neutral</span>' +
            '<span><i style="background:#0a2a1a;border:1px solid #5dba5d"></i> Prefer</span>' +
            '<span><i style="background:#2a0a0a;border:1px solid #e94560"></i> Avoid</span>' +
          '</div>' +
          '<div id="bikePrefGrid" class="bike-pref-grid" style="display:none"></div>' +
        '</div>' +
        (typeof window.psycleListCalendars === 'function' ?
          '<div class="settings-section">' +
            '<div class="settings-section-title">Calendar Sync (iOS)</div>' +
            '<div id="calendarSyncPanel" class="cal-sync-panel">Loading calendars…</div>' +
          '</div>' : '') +
        // Backup/Restore and Bug Report moved to Membership tab
      '</div>';

    document.body.appendChild(overlay);
    renderTierList();
    populateStudioSelect();
    if (typeof window.psycleListCalendars === 'function') renderCalendarSync();
  };

  window.closeSettings = function () {
    var el = document.getElementById('settingsOverlay');
    if (el) el.remove();
  };

  // Settings gear removed — settings now lives in the Membership tab.


  // ═══════════════════════════════════════════════════════════════════
  // Instructor Tier UI
  // ═══════════════════════════════════════════════════════════════════

  window.filterTierList = function () { renderTierList(); };

  function renderTierList() {
    var container = document.getElementById('tierList');
    if (!container) return;

    var query = (document.getElementById('tierSearch')?.value || '').toLowerCase();
    var tiers = loadTiers();
    // Sort order: S, A, B, C, D, F, then unranked — alphabetical within each tier
    var tierOrder = { 'S': 0, 'A': 1, 'B': 2, 'C': 3, 'D': 4, 'F': 5 };
    var list = (typeof instructors !== 'undefined' ? instructors : [])
      .filter(function (i) { return !query || i.full_name.toLowerCase().includes(query); })
      .sort(function (a, b) {
        var ta = tiers[String(a.id)];
        var tb = tiers[String(b.id)];
        var oa = ta ? tierOrder[ta] : 99;
        var ob = tb ? tierOrder[tb] : 99;
        if (oa !== ob) return oa - ob;
        return a.full_name.localeCompare(b.full_name);
      });

    var favs = (typeof favouriteInstructors !== 'undefined') ? favouriteInstructors : new Set();

    container.innerHTML = list.map(function (instr) {
      var sid = String(instr.id);
      var currentTier = tiers[sid] || '';
      var isFav = favs.has(sid);
      var btns = TIERS.map(function (t) {
        var cls = currentTier === t ? ' active-' + t : '';
        return '<button class="tier-btn' + cls + '" onclick="setInstructorTier(' + instr.id + ',\'' + t + '\')">' + t + '</button>';
      }).join('');
      return '<div class="tier-row">' +
        '<button class="tier-fav' + (isFav ? ' is-fav' : '') + '" onclick="toggleFavFromSettings(' + instr.id + ')" title="' + (isFav ? 'Remove from favourites' : 'Add to favourites') + '"></button>' +
        '<span class="tier-name">' + escapeHTML(instr.full_name) + '</span>' +
        '<div class="tier-btns">' + btns + '</div>' +
      '</div>';
    }).join('');
  }

  window.toggleFavFromSettings = function (instrId) {
    var sid = String(instrId);
    if (typeof favouriteInstructors === 'undefined') return;
    if (favouriteInstructors.has(sid)) {
      favouriteInstructors.delete(sid);
    } else {
      favouriteInstructors.add(sid);
    }
    if (typeof saveFavourites === 'function') saveFavourites(favouriteInstructors);
    renderTierList();
  };

  window.setInstructorTier = function (instrId, tier) {
    var tiers = loadTiers();
    if (tiers[String(instrId)] === tier) {
      delete tiers[String(instrId)]; // toggle off
    } else {
      tiers[String(instrId)] = tier;
    }
    saveTiers(tiers);
    renderTierList();
  };


  // ═══════════════════════════════════════════════════════════════════
  // Calendar Sync UI (iOS only)
  // ═══════════════════════════════════════════════════════════════════

  async function renderCalendarSync() {
    var panel = document.getElementById('calendarSyncPanel');
    if (!panel) return;
    if (typeof window.psycleListCalendars !== 'function') {
      panel.textContent = 'Calendar sync is only available in the iOS app.';
      return;
    }
    var cfg = window.psycleGetCalendarConfig();
    var calendars = await window.psycleListCalendars();

    var options = ['<option value="__auto">Psycle (dedicated calendar)</option>'];
    calendars.forEach(function (c) {
      if (c.isPsycle) return; // already represented by __auto
      var sel = cfg.mode === 'custom' && String(cfg.targetId) === String(c.id) ? ' selected' : '';
      options.push('<option value="' + escapeHTML(String(c.id)) + '"' + sel + '>' +
        escapeHTML(c.title) + '</option>');
    });

    var enabled = cfg.enabled;
    panel.innerHTML =
      '<label class="cal-sync-row">' +
        '<span>Auto-add bookings to Calendar</span>' +
        '<input type="checkbox" id="calSyncEnabled"' + (enabled ? ' checked' : '') + ' onchange="onCalendarSyncToggle(this)">' +
      '</label>' +
      '<label class="cal-sync-row cal-sync-target' + (enabled ? '' : ' is-disabled') + '">' +
        '<span>Write events to</span>' +
        '<select id="calSyncTarget" onchange="onCalendarTargetChange(this)">' +
          options.join('') +
        '</select>' +
      '</label>' +
      '<div class="cal-sync-actions">' +
        '<button class="cal-sync-resync" onclick="onCalendarResync(this)">Re-sync now</button>' +
        (typeof window.psycleCleanupDuplicates === 'function' ?
          '<button class="cal-sync-resync" onclick="onCalendarCleanupDupes(this)">Remove duplicates</button>' : '') +
      '</div>' +
      '<div class="cal-sync-hint">' +
        'Events are deduplicated by title and start time. Changing the target leaves ' +
        'already-created events in the old calendar — delete them there or use “Remove duplicates”.' +
      '</div>';

    // Preselect current mode
    var sel = document.getElementById('calSyncTarget');
    if (sel && cfg.mode !== 'custom') sel.value = '__auto';
  }

  window.onCalendarSyncToggle = function (checkbox) {
    window.psycleSetCalendarConfig({ enabled: !!checkbox.checked });
    renderCalendarSync();
  };

  window.onCalendarTargetChange = function (select) {
    var val = select.value;
    if (val === '__auto') {
      window.psycleSetCalendarConfig({ mode: 'auto' });
    } else {
      window.psycleSetCalendarConfig({ mode: 'custom', targetId: val });
    }
    if (typeof window.psycleResyncCalendar === 'function') {
      window.psycleResyncCalendar();
    }
  };

  window.onCalendarCleanupDupes = async function (btn) {
    if (!window.psycleCleanupDuplicates) return;
    var old = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Scanning…';
    try {
      var res = await window.psycleCleanupDuplicates();
      if (res.error) {
        btn.textContent = res.error;
      } else if (res.removed === 0) {
        btn.textContent = 'No duplicates';
      } else {
        btn.textContent = 'Removed ' + res.removed;
      }
    } catch (e) {
      btn.textContent = 'Failed';
    }
    setTimeout(function () { btn.textContent = old; btn.disabled = false; }, 2200);
  };

  window.onCalendarResync = async function (btn) {
    if (!window.psycleResyncCalendar) return;
    var old = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Syncing…';
    try {
      await window.psycleResyncCalendar();
      btn.textContent = 'Synced ✓';
    } catch (e) {
      btn.textContent = 'Sync failed';
    }
    setTimeout(function () { btn.textContent = old; btn.disabled = false; }, 1500);
  };


  // ═══════════════════════════════════════════════════════════════════
  // Bike Preference UI
  // ═══════════════════════════════════════════════════════════════════

  async function populateStudioSelect() {
    var select = document.getElementById('bikePrefStudio');
    if (!select) return;

    // Fetch studios from ALL locations (not just ones seen in search)
    var locs = (typeof locations !== 'undefined') ? locations : [];
    if (locs.length > 0) {
      select.innerHTML = '<option value="">Loading studios…</option>';
      var today = new Date().toISOString().split('T')[0];
      await Promise.all(locs.map(async function (loc) {
        try {
          var res = await apiFetch('/events?start=' + today + '+00:00:00&end=' + today + '+23:59:59&location=' + loc.id + '&limit=1');
          if (!res.ok) return;
          var data = await res.json();
          var rels = data.relations || {};
          var studios = rels.studios || [];
          studios.forEach(function (s) {
            if (!_studioMap[s.id]) {
              _studioMap[s.id] = s;
            }
          });
        } catch (e) {}
      }));
    }

    var studios = _studioMap || {};
    var seen = {};

    // Build studio list with branch (location) names
    var studioList = [];
    Object.values(studios).forEach(function (s) {
      if (!s.has_layout || seen[s.id]) return;
      seen[s.id] = true;
      var branchName = '';
      if (locs.length > 0) {
        var loc = locs.find(function (l) { return l.id === s.location_id; });
        if (loc) branchName = loc.name.replace('Psycle ', '');
      }
      studioList.push({ id: s.id, branch: branchName, name: s.name });
    });

    // Sort by branch then studio name
    studioList.sort(function (a, b) {
      return (a.branch + a.name).localeCompare(b.branch + b.name);
    });

    // Group by branch using optgroups
    var html = '<option value="">Select a studio…</option>';
    var currentBranch = '';
    studioList.forEach(function (s) {
      if (s.branch !== currentBranch) {
        if (currentBranch) html += '</optgroup>';
        currentBranch = s.branch;
        html += '<optgroup label="' + escapeHTML(s.branch || 'Unknown') + '">';
      }
      html += '<option value="' + s.id + '">' + escapeHTML(s.branch ? s.branch + ' — ' + s.name : s.name) + '</option>';
    });
    if (currentBranch) html += '</optgroup>';

    select.innerHTML = html;
  }

  window.renderBikePrefGrid = function () {
    var studioId = document.getElementById('bikePrefStudio')?.value;
    var grid = document.getElementById('bikePrefGrid');
    if (!grid) return;

    if (!studioId) { grid.style.display = 'none'; return; }
    grid.style.display = '';

    var studio = (_studioMap || {})[Number(studioId)];
    if (!studio || !studio.layout || !studio.layout.slots) {
      grid.innerHTML = '<div style="color:#555;font-size:13px">No layout available for this studio</div>';
      return;
    }

    var prefs = getBikePrefs(studioId);
    var avoidSet = new Set(prefs.avoid.map(Number));
    var preferSet = new Set(prefs.prefer.map(Number));

    // Use spatial layout from the API (same as the bike picker SVG)
    var slots = studio.layout.slots;
    var objects = studio.layout.objects || [];
    var allX = slots.map(function (s) { return s.x; }).concat(objects.map(function (o) { return o.x; }));
    var allY = slots.map(function (s) { return s.y; }).concat(objects.map(function (o) { return o.y; }));
    var minX = Math.min.apply(null, allX), maxX = Math.max.apply(null, allX);
    var minY = Math.min.apply(null, allY), maxY = Math.max.apply(null, allY);
    var SLOT = 36, PAD = 16;
    var rangeX = maxX - minX || 1, rangeY = maxY - minY || 1;
    var svgW = Math.min(520, Math.max(280, slots.length * 20));
    var svgH = Math.round(svgW * (rangeY / rangeX)) + PAD * 2;
    var sx = function (x) { return PAD + ((x - minX) / rangeX) * (svgW - PAD * 2 - SLOT); };
    var sy = function (y) { return PAD + ((y - minY) / rangeY) * (Math.max(100, svgH) - PAD * 2 - SLOT); };
    var h = Math.max(100, svgH);

    var inner = '';

    // Objects (instructor podium etc.)
    inner += objects.map(function (obj) {
      return '<rect x="' + sx(obj.x) + '" y="' + sy(obj.y) + '" width="' + SLOT + '" height="' + SLOT + '"' +
        ' rx="4" fill="#1a1a0a" stroke="#333" stroke-dasharray="3,3"/>';
    }).join('');

    // Slots
    inner += slots.map(function (slot) {
      var id = Number(slot.id);
      var label = slot.label ?? slot.id;
      var cls = avoidSet.has(id) ? 'pref-avoid' : preferSet.has(id) ? 'pref-prefer' : '';
      return '<g class="bike-pref-svg-slot ' + cls + '" data-slot="' + id + '" ' +
        'onclick="toggleBikePref(' + studioId + ',' + id + ')" style="cursor:pointer">' +
        '<rect x="' + sx(slot.x) + '" y="' + sy(slot.y) + '" width="' + SLOT + '" height="' + SLOT + '"' +
        ' rx="6" stroke-width="1.5"/>' +
        '<text x="' + (sx(slot.x) + SLOT / 2) + '" y="' + (sy(slot.y) + SLOT / 2 + 4) + '"' +
        ' text-anchor="middle" font-family="sans-serif" font-size="11">' + label + '</text>' +
      '</g>';
    }).join('');

    grid.innerHTML = '<svg width="' + svgW + '" height="' + h + '" viewBox="0 0 ' + svgW + ' ' + h + '"' +
      ' style="display:block;margin:0 auto">' + inner + '</svg>';
  };

  window.toggleBikePref = function (studioId, slotId) {
    var prefs = loadBikePrefs();
    var key = String(studioId);
    if (!prefs[key]) prefs[key] = { avoid: [], prefer: [] };

    var avoid = prefs[key].avoid.map(Number);
    var prefer = prefs[key].prefer.map(Number);
    var isAvoid = avoid.includes(slotId);
    var isPrefer = prefer.includes(slotId);

    if (!isAvoid && !isPrefer) {
      // Neutral → Prefer
      prefer.push(slotId);
    } else if (isPrefer) {
      // Prefer → Avoid
      prefer = prefer.filter(function (s) { return s !== slotId; });
      avoid.push(slotId);
    } else {
      // Avoid → Neutral
      avoid = avoid.filter(function (s) { return s !== slotId; });
    }

    prefs[key].avoid = avoid;
    prefs[key].prefer = prefer;
    saveBikePrefs(prefs);
    renderBikePrefGrid();
  };


  // ═══════════════════════════════════════════════════════════════════
  // Integration: Bike Picker Highlights
  // ═══════════════════════════════════════════════════════════════════

  var _origShowBikePicker = window.showBikePicker;
  if (_origShowBikePicker && !window._bikePickerPrefsPatched) {
    window._bikePickerPrefsPatched = true;
    window.showBikePicker = function (eventId, btn, layout, availableSlotIds, mySlotIds, studioName) {
      _origShowBikePicker.apply(this, arguments);

      // After the picker renders, apply pref highlights
      setTimeout(function () {
        // Find the studio ID from the event
        var evt = (_eventCache || {})[String(eventId)];
        var studioId = evt ? evt.studio_id : null;
        if (!studioId) return;

        var prefs = getBikePrefs(studioId);
        var avoidSet = new Set(prefs.avoid.map(Number));
        var preferSet = new Set(prefs.prefer.map(Number));

        document.querySelectorAll('#bikeSvg .bike-slot').forEach(function (g) {
          var slot = Number(g.dataset.slot);
          var rect = g.querySelector('rect');
          if (!rect) return;
          var rx = Number(rect.getAttribute('x'));
          var ry = Number(rect.getAttribute('y'));
          var rw = Number(rect.getAttribute('width'));

          if (preferSet.has(slot)) {
            g.classList.add('pref-prefer');
            // Green dot in top-right corner
            var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            dot.setAttribute('cx', rx + rw - 5);
            dot.setAttribute('cy', ry + 5);
            dot.setAttribute('r', '3');
            dot.setAttribute('fill', '#5dba5d');
            dot.classList.add('pref-dot');
            g.appendChild(dot);
          }
          if (avoidSet.has(slot)) {
            g.classList.add('pref-avoid');
            // Red dot in top-right corner
            var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            dot.setAttribute('cx', rx + rw - 5);
            dot.setAttribute('cy', ry + 5);
            dot.setAttribute('r', '3');
            dot.setAttribute('fill', '#e94560');
            dot.classList.add('pref-dot');
            g.appendChild(dot);
          }
        });

        // Update legend if prefs exist
        if (prefs.avoid.length || prefs.prefer.length) {
          var legend = document.querySelector('.bike-legend');
          if (legend && !legend.querySelector('.pref-legend')) {
            legend.innerHTML += '<span class="pref-legend"><i style="background:#5dba5d;border-radius:50%;width:8px;height:8px"></i> Your fav</span>' +
              '<span class="pref-legend"><i style="background:#e94560;border-radius:50%;width:8px;height:8px"></i> Avoid</span>';
          }
        }
      }, 50);
    };
  }


  // ═══════════════════════════════════════════════════════════════════
  // Integration: Tier Badges on Class Cards
  // ═══════════════════════════════════════════════════════════════════

  var _origEventCard = window.eventCard;
  if (_origEventCard && !window._eventCardTierPatched) {
    window._eventCardTierPatched = true;
    window.eventCard = function (evt, instrMap, studioMap, locationMap, typeMap) {
      var html = _origEventCard.apply(this, arguments);
      // Inject tier badge after instructor name
      var tier = getInstructorTier(evt.instructor_id);
      if (tier) {
        var badge = '<span class="tier-badge tier-' + tier + '">' + tier + '</span>';
        html = html.replace(/(class-instructor">)(.*?)(<\/div>)/, function (match, p1, p2, p3) {
          return p1 + p2 + badge + p3;
        });
      }
      return html;
    };
  }


  // ═══════════════════════════════════════════════════════════════════
  // Export / Import Settings
  // ═══════════════════════════════════════════════════════════════════

  var EXPORT_KEYS = [
    'psycle_instructor_tiers',
    'psycle_bike_prefs',
    'psycle_fav_instructors',
    'psycle_saved_filters',
    'psycle_theme',
    'psycle_class_history',
    'psycle_history_synced',
    'psycle_notify_watchlist',
  ];

  window.exportSettings = function () {
    var data = {};
    EXPORT_KEYS.forEach(function (key) {
      var val = localStorage.getItem(key);
      if (val) data[key] = val;
    });
    data._exported_at = new Date().toISOString();
    data._version = 1;

    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'psycle-settings-' + new Date().toISOString().split('T')[0] + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('Settings exported', 'success');
  };

  window.importSettings = function (input) {
    var status = document.getElementById('importStatus');
    var file = input.files && input.files[0];
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var data = JSON.parse(e.target.result);
        var count = 0;
        EXPORT_KEYS.forEach(function (key) {
          if (data[key]) {
            localStorage.setItem(key, data[key]);
            count++;
          }
        });
        if (status) {
          status.style.display = '';
          status.style.color = '#5dba5d';
          status.textContent = 'Restored ' + count + ' settings. Reloading…';
        }
        toast('Settings restored — reloading', 'success');
        setTimeout(function () { location.reload(); }, 1000);
      } catch (err) {
        if (status) {
          status.style.display = '';
          status.style.color = '#e94560';
          status.textContent = 'Invalid file: ' + err.message;
        }
        toast('Import failed — invalid file', 'error');
      }
      input.value = '';
    };
    reader.readAsText(file);
  };


  // ═══════════════════════════════════════════════════════════════════
  // Bug Report
  // ═══════════════════════════════════════════════════════════════════

  function buildBugReport() {
    var sections = [];

    // Header
    sections.push('=== Psycle Bug Report ===');
    sections.push('Generated: ' + new Date().toISOString());
    sections.push('');

    // Device info
    sections.push('--- Device Info ---');
    sections.push('User Agent: ' + navigator.userAgent);
    sections.push('Screen: ' + screen.width + 'x' + screen.height + ' (devicePixelRatio: ' + (window.devicePixelRatio || 1) + ')');
    sections.push('Viewport: ' + window.innerWidth + 'x' + window.innerHeight);
    sections.push('Theme: ' + (document.documentElement.getAttribute('data-theme') || 'unknown'));
    sections.push('Online: ' + navigator.onLine);
    sections.push('Language: ' + navigator.language);
    sections.push('');

    // localStorage summary (keys + byte sizes only, no values)
    sections.push('--- localStorage Summary ---');
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        keys.push(localStorage.key(i));
      }
      keys.sort();
      var totalBytes = 0;
      keys.forEach(function (key) {
        var val = localStorage.getItem(key) || '';
        var bytes = new Blob([val]).size;
        totalBytes += bytes;
        sections.push('  ' + key + ': ' + bytes + ' bytes');
      });
      sections.push('  TOTAL: ' + totalBytes + ' bytes across ' + keys.length + ' keys');
    } catch (e) {
      sections.push('  (could not read localStorage)');
    }
    sections.push('');

    // Full event/error log
    sections.push('--- Event & Error Log ---');
    if (typeof window.getFullLog === 'function') {
      var log = window.getFullLog();
      sections.push(log || '(empty)');
    } else {
      sections.push('(log function not available)');
    }

    return sections.join('\n');
  }

  window.downloadBugReport = function () {
    var report = buildBugReport();
    var date = new Date().toISOString().split('T')[0];
    var blob = new Blob([report], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'psycle-bug-report-' + date + '.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('Bug report downloaded', 'success');
  };

  window.copyBugReport = function () {
    var report = buildBugReport();
    var status = document.getElementById('bugReportStatus');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(report).then(function () {
        if (status) {
          status.style.display = '';
          status.style.color = '#5dba5d';
          status.textContent = 'Copied to clipboard!';
          setTimeout(function () { status.style.display = 'none'; }, 3000);
        }
        toast('Bug report copied to clipboard', 'success');
      }).catch(function () {
        _fallbackCopy(report, status);
      });
    } else {
      _fallbackCopy(report, status);
    }
  };

  function _fallbackCopy(text, status) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      if (status) {
        status.style.display = '';
        status.style.color = '#5dba5d';
        status.textContent = 'Copied to clipboard!';
        setTimeout(function () { status.style.display = 'none'; }, 3000);
      }
      toast('Bug report copied to clipboard', 'success');
    } catch (e) {
      if (status) {
        status.style.display = '';
        status.style.color = '#e94560';
        status.textContent = 'Copy failed — try the download button instead';
      }
      toast('Copy failed', 'error');
    }
    document.body.removeChild(ta);
  }


})();
