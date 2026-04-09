/* ═══════════════════════════════════════════════════════════════════
   Settings Module — Floating Pill, Instructor Tiers, Bike Prefs
   ═══════════════════════════════════════════════════════════════════ */
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

    var slots = (booking && booking.slots && booking.slots.length)
      ? 'Bike' + (booking.slots.length > 1 ? 's ' : ' ') + booking.slots.join(' & ')
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
          '<div class="settings-section-title">Instructor Rankings</div>' +
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
        '<div class="settings-section">' +
          '<div class="settings-section-title">Backup & Restore</div>' +
          '<p style="font-size:12px;color:#666;margin-bottom:12px">Export all your settings (tiers, bike prefs, favourites, filters, theme, class history) as a file. Import on any device to restore.</p>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
            '<button class="cal-btn" onclick="exportSettings()">Export settings</button>' +
            '<button class="cal-btn" onclick="document.getElementById(\'importFile\').click()">Import settings</button>' +
            '<input type="file" id="importFile" accept=".json" style="display:none" onchange="importSettings(this)">' +
          '</div>' +
          '<div id="importStatus" style="font-size:12px;margin-top:8px;display:none"></div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    renderTierList();
    populateStudioSelect();
  };

  window.closeSettings = function () {
    var el = document.getElementById('settingsOverlay');
    if (el) el.remove();
  };

  // Hook the gear icon in the header
  setTimeout(function () {
    var themeToggle = document.querySelector('.theme-toggle');
    if (themeToggle) {
      var settingsBtn = document.createElement('button');
      settingsBtn.className = 'theme-toggle';
      settingsBtn.title = 'Settings';
      settingsBtn.innerHTML = '⚙';
      settingsBtn.style.fontSize = '18px';
      settingsBtn.onclick = function () { openSettings(); };
      // Check if a settings button already exists
      if (!document.querySelector('[title="Settings"]')) {
        themeToggle.parentNode.insertBefore(settingsBtn, themeToggle);
      }
    }
  }, 500);


  // ═══════════════════════════════════════════════════════════════════
  // Instructor Tier UI
  // ═══════════════════════════════════════════════════════════════════

  window.filterTierList = function () { renderTierList(); };

  function renderTierList() {
    var container = document.getElementById('tierList');
    if (!container) return;

    var query = (document.getElementById('tierSearch')?.value || '').toLowerCase();
    var tiers = loadTiers();
    var list = (typeof instructors !== 'undefined' ? instructors : [])
      .filter(function (i) { return !query || i.full_name.toLowerCase().includes(query); })
      .sort(function (a, b) {
        var ta = tiers[String(a.id)] || 'Z';
        var tb = tiers[String(b.id)] || 'Z';
        if (ta !== tb) return ta < tb ? -1 : 1;
        return a.full_name.localeCompare(b.full_name);
      });

    container.innerHTML = list.map(function (instr) {
      var currentTier = tiers[String(instr.id)] || '';
      var btns = TIERS.map(function (t) {
        var cls = currentTier === t ? ' active-' + t : '';
        return '<button class="tier-btn' + cls + '" onclick="setInstructorTier(' + instr.id + ',\'' + t + '\')">' + t + '</button>';
      }).join('');
      return '<div class="tier-row">' +
        '<span class="tier-name">' + escapeHTML(instr.full_name) + '</span>' +
        '<div class="tier-btns">' + btns + '</div>' +
      '</div>';
    }).join('');
  }

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
  // Bike Preference UI
  // ═══════════════════════════════════════════════════════════════════

  function populateStudioSelect() {
    var select = document.getElementById('bikePrefStudio');
    if (!select) return;
    var studios = _studioMap || {};
    var seen = {};

    // Build studio list with branch (location) names
    var studioList = [];
    Object.values(studios).forEach(function (s) {
      if (!s.has_layout || seen[s.id]) return;
      seen[s.id] = true;
      // Resolve branch name from locations
      var branchName = '';
      if (typeof locations !== 'undefined') {
        var loc = locations.find(function (l) { return l.id === s.location_id; });
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

    var slots = studio.layout.slots.sort(function (a, b) { return a.id - b.id; });
    grid.innerHTML = slots.map(function (slot) {
      var label = slot.label || slot.id;
      var cls = avoidSet.has(slot.id) ? ' pref-avoid' : preferSet.has(slot.id) ? ' pref-prefer' : '';
      return '<div class="bike-pref-slot' + cls + '" data-slot="' + slot.id + '" ' +
        'onclick="toggleBikePref(' + studioId + ',' + slot.id + ')" ' +
        'title="Slot ' + label + (cls ? (avoidSet.has(slot.id) ? ' (avoid)' : ' (prefer)') : '') + '">' +
        label + '</div>';
    }).join('');
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
  if (_origShowBikePicker) {
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
          if (avoidSet.has(slot)) g.classList.add('pref-avoid');
          if (preferSet.has(slot)) g.classList.add('pref-prefer');
        });

        // Update legend if prefs exist
        if (prefs.avoid.length || prefs.prefer.length) {
          var legend = document.querySelector('.bike-legend');
          if (legend && !legend.querySelector('.pref-legend')) {
            legend.innerHTML += '<span class="pref-legend"><i style="background:#0a2a1a;border:1px solid #5dba5d"></i> Your fav</span>' +
              '<span class="pref-legend"><i style="background:#2a0a0a;border:1px solid #e94560"></i> Avoid</span>';
          }
        }
      }, 50);
    };
  }


  // ═══════════════════════════════════════════════════════════════════
  // Integration: Tier Badges on Class Cards
  // ═══════════════════════════════════════════════════════════════════

  var _origEventCard = window.eventCard;
  if (_origEventCard) {
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


  console.log('[settings] settings.js loaded');
})();
