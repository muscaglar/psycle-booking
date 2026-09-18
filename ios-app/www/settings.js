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

  // Reads are coerced (app.js, pure:stored-data — both keys can come out of an
  // imported file); writes go through _saveSetting, which frees the app's own
  // caches and retries when localStorage is full, and says so if it still
  // cannot save — a throw here used to kill the tap with nothing saved.
  function _store(key, value) {
    if (typeof _saveSetting === 'function') { _saveSetting(key, JSON.stringify(value)); return; }
    localStorage.setItem(key, JSON.stringify(value));
  }

  function loadTiers() {
    try {
      var t = JSON.parse(localStorage.getItem(TIER_KEY) || '{}');
      return typeof _cleanStoredTiers === 'function' ? _cleanStoredTiers(t) : t;
    } catch { return {}; }
  }
  function saveTiers(t) { _store(TIER_KEY, t); }

  function loadBikePrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(BIKE_PREF_KEY) || '{}');
      return typeof _cleanStoredBikePrefs === 'function' ? _cleanStoredBikePrefs(p) : p;
    } catch { return {}; }
  }
  function saveBikePrefs(p) { _store(BIKE_PREF_KEY, p); }

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
    // Only a known tier letter reaches the markup: the stored value can come
    // from an imported settings file, and it lands in a class attribute.
    if (!tier || TIERS.indexOf(tier) === -1) return '';
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
    _pillA11y(null); // born hidden
    _pillEl.onclick = function () {
      if (typeof switchTab === 'function') switchTab('bookings');
    };
    document.body.appendChild(_pillEl);
  }

  // The pill is a div that acts as a button (it holds div children, so it
  // stays a div). `.hidden` only fades it out — it is still in the page — so
  // it is a button ONLY while showing: hidden, it must be neither a tab stop
  // nor something VoiceOver can swipe onto. `label` = what it says, or null
  // when hidden. Set as attributes, never markup: the label carries API text.
  function _pillA11y(label) {
    if (!_pillEl) return;
    if (label == null) {
      // aria-hidden on the element that holds focus is invalid: let go first.
      if (document.activeElement === _pillEl) _pillEl.blur();
      _pillEl.removeAttribute('role');
      _pillEl.removeAttribute('tabindex');
      _pillEl.removeAttribute('aria-label');
      _pillEl.setAttribute('aria-hidden', 'true');
      return;
    }
    _pillEl.removeAttribute('aria-hidden');
    _pillEl.setAttribute('role', 'button'); // Enter / Space: app.js's one keydown
    _pillEl.setAttribute('tabindex', '0');
    _pillEl.setAttribute('aria-label', label);
  }

  function updatePill() {
    if (!_pillEl) createPill();
    var bookings = _myBookings || {};
    var cache = _eventCache || {};
    var now = new Date();

    // Find next upcoming class you hold a seat in (waitlist places don't count).
    // The REAL start (app.js: start_at is London wall clock) — read
    // device-locally, a member abroad saw no pill for a class My Bookings
    // listed as "In 2h", or a countdown to one it had filed under past. A
    // time nothing can place is skipped: there is nothing to count down to.
    var startMs = function (evt) {
      return typeof _gymClassStartMs === 'function' ? _gymClassStartMs(evt.start_at) : new Date(evt.start_at).getTime();
    };
    var next = null;
    var nextMs = 0;
    var nextEvtId = null;
    Object.entries(bookings).forEach(function (entry) {
      var evtId = entry[0];
      if (entry[1] && entry[1].waitlisted) return;
      var evt = cache[evtId];
      if (!evt) return;
      var ms = startMs(evt);
      if (isNaN(ms) || ms <= now.getTime()) return;
      if (!next || ms < nextMs) {
        next = evt;
        nextMs = ms;
        nextEvtId = evtId;
      }
    });

    if (!next) {
      _pillEl.classList.add('hidden');
      _pillA11y(null);
      return;
    }

    var booking = bookings[nextEvtId];
    var diff = nextMs - now.getTime();
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
      ? formatSlots(_slPill, booking.slots)
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
    _pillA11y('Next class in ' + countdown + ': ' + (next._typeName || 'Class') +
      (next._instrName ? ' with ' + next._instrName : '') + (slots ? ', ' + slots : '') + '. View my bookings');
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
    // Sign-out empties _myBookings without a bookings:loaded (an empty map
    // there would tell the calendar sync "the server confirmed none"), so the
    // pill needs its own cue or it keeps counting down to the previous
    // account's class. Nothing to clear if it was never created.
    PsycleEvents.on('auth:changed', function () { if (_pillEl) updatePill(); });
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

  // The Membership rows each open the panel AT their own section; all four used
  // to land at the top of the same sheet. Keys → section element ids.
  var SETTINGS_SECTION_IDS = {
    reminders: 'settingsSecReminders',
    bike: 'settingsSecBike',
    calendar: 'settingsSecCalendar',
    data: 'settingsSecData',
  };

  // Bring one section to the top of the panel's own scroller. scrollTop on
  // .settings-body, not scrollIntoView: that scrolls every ancestor too — on
  // iOS the page itself (the caveat switchTab in tabs.js documents). Returns
  // the offset it set, or -1 when there was nothing to scroll to.
  function scrollSettingsTo(section) {
    var id = Object.prototype.hasOwnProperty.call(SETTINGS_SECTION_IDS, section) ? SETTINGS_SECTION_IDS[section] : '';
    var sec = id ? document.getElementById(id) : null;
    var body = sec ? sec.closest('.settings-body') : null;
    if (!body) return -1;
    body.scrollTop += sec.getBoundingClientRect().top - body.getBoundingClientRect().top;
    return body.scrollTop;
  }

  // `section` is optional ('reminders' | 'bike' | 'calendar' | 'data'). Anything
  // that is not a string — no argument, or the Event a listener would pass —
  // opens the panel at the top, as before.
  window.openSettings = function (section) {
    if (typeof section !== 'string') section = '';
    // Already open (a second row tapped behind it, a deep link): just move.
    if (document.getElementById('settingsOverlay')) { scrollSettingsTo(section); return; }

    var overlay = document.createElement('div');
    overlay.id = 'settingsOverlay';
    overlay.className = 'settings-overlay';
    overlay.onclick = function (e) { if (e.target === overlay) closeSettings(); };

    // role / label / tabindex: app.js's overlay handling moves focus onto the
    // panel, keeps Tab inside it and closes it on Escape (via closeSettings).
    overlay.innerHTML =
      '<div class="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settingsTitle" tabindex="-1">' +
        '<div class="settings-header">' +
          '<span class="settings-title" id="settingsTitle">Settings</span>' +
          '<button class="settings-close" onclick="closeSettings()" aria-label="Close">×</button>' +
        '</div>' +
        '<div class="settings-body">' +
          // App-focused settings only — instructor rankings/favourites
          // live on the Membership tab with the rest of the personal data.
          // Reminders exist only in the iOS app: on the web renderReminderRow
          // paints nothing, which left a heading over an empty section.
          (window._nativeReminder ?
            '<div class="settings-section" id="settingsSecReminders">' +
              '<div class="settings-section-title">Reminders</div>' +
              '<div id="reminderRow"></div>' +
            '</div>' : '') +
          '<div class="settings-section" id="settingsSecBike">' +
            '<div class="settings-section-title">Bike / Spot Preferences</div>' +
            '<select class="bike-pref-studio-select" id="bikePrefStudio" onchange="renderBikePrefGrid()">' +
              '<option value="">Select a studio…</option>' +
            '</select>' +
            // Swatches mirror .bike-pref-svg-slot in css/settings.css (same
            // tokens, avoid dashed) so the legend matches the map in every theme.
            '<div class="bike-pref-legend">' +
              '<span><i style="background:var(--bg-input);border:1px solid var(--border-light)"></i> Neutral</span>' +
              '<span><i style="background:var(--badge-highlight-bg);border:1px solid var(--badge-highlight-text)"></i> Prefer</span>' +
              '<span><i style="background:var(--badge-full-bg);border:1px dashed var(--badge-full-text)"></i> Avoid</span>' +
            '</div>' +
            '<div id="bikePrefGrid" class="bike-pref-grid" style="display:none"></div>' +
          '</div>' +
          (typeof window.psycleListCalendars === 'function' ?
            '<div class="settings-section" id="settingsSecCalendar">' +
              '<div class="settings-section-title">Calendar Sync (iOS)</div>' +
              '<div id="calendarSyncPanel" class="cal-sync-panel">Loading calendars…</div>' +
            '</div>' : '') +
          '<div class="settings-section" id="settingsSecData">' +
            '<div class="settings-section-title">Data</div>' +
            '<div class="app-advanced">' +
              '<button class="app-advanced-btn" onclick="exportSettings()">Export settings</button>' +
              '<button class="app-advanced-btn" onclick="document.getElementById(\'settingsImportFile\')?.click()">Import settings</button>' +
              '<input type="file" id="settingsImportFile" accept=".json,.txt,application/json,text/plain" style="display:none" onchange="importSettings(this)">' +
              '<button class="app-advanced-btn" onclick="downloadBugReport()">Bug report</button>' +
            '</div>' +
          '</div>' +
          '<div class="settings-section">' +
            '<div class="settings-section-title">Diagnostics</div>' +
            '<div class="diag-section-hint">See what the app and the Psycle API are doing — useful when something looks broken.</div>' +
            '<div class="app-advanced">' +
              '<button class="app-advanced-btn" onclick="openDiagnostics()">Open diagnostics</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    if (typeof window.renderThemePicker === 'function') window.renderThemePicker();
    if (typeof window.renderReminderRow === 'function') window.renderReminderRow();
    populateStudioSelect();
    var calendarsReady = (typeof window.psycleListCalendars === 'function') ? renderCalendarSync() : null;
    if (!section) return;
    var aimedAt = scrollSettingsTo(section);
    // The calendar list lands a moment later and grows ITS section, pushing the
    // ones under it down. Re-aim once — unless the member has scrolled since.
    if (aimedAt !== -1 && calendarsReady && typeof calendarsReady.then === 'function') {
      calendarsReady.then(function () {
        var body = overlay.querySelector('.settings-body');
        if (overlay.isConnected && body && body.scrollTop === aimedAt) scrollSettingsTo(section);
      }, function () {});
    }
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

  function tierRowHTML(instr, tiers, favs) {
    var sid = String(instr.id);
    var currentTier = tiers[sid] || '';
    var isFav = favs.has(sid);
    // Which rank is set was a colour only. Same attributes as the instructor
    // modal's copy of these buttons (features.js); the list is rebuilt from the
    // store on every change, so they can't go stale. (The star needs nothing:
    // its name already flips between "Add to…" and "Remove from favourites".)
    var btns = TIERS.map(function (t) {
      var cls = currentTier === t ? ' active-' + t : '';
      return '<button class="tier-btn' + cls + '" aria-pressed="' + (currentTier === t) + '" aria-label="Rank ' + t + '" onclick="setInstructorTier(' + instr.id + ',\'' + t + '\')">' + t + '</button>';
    }).join('');
    return '<div class="tier-row">' +
      '<button class="tier-fav' + (isFav ? ' is-fav' : '') + '" onclick="toggleFavFromSettings(' + instr.id + ')" title="' + (isFav ? 'Remove from favourites' : 'Add to favourites') + '"></button>' +
      '<span class="tier-name">' + escapeHTML(instr.full_name) + '</span>' +
      '<div class="tier-btns">' + btns + '</div>' +
    '</div>';
  }

  function renderTierList() {
    var rankedContainer = document.getElementById('tierListRanked');
    var unrankedContainer = document.getElementById('tierListUnranked');
    var searchContainer = document.getElementById('tierListSearch');
    if (!rankedContainer) return;

    var query = (document.getElementById('tierSearch')?.value || '').trim().toLowerCase();
    var tiers = loadTiers();
    var favs = (typeof favouriteInstructors !== 'undefined') ? favouriteInstructors : new Set();
    var tierOrder = { 'S': 0, 'A': 1, 'B': 2, 'C': 3, 'D': 4, 'F': 5 };
    var allInstructors = (typeof instructors !== 'undefined') ? instructors : [];

    // Build set of instructor IDs from booking history
    var historyInstrIds = new Set();
    try {
      var history = JSON.parse(localStorage.getItem('psycle_class_history') || '[]');
      // Coerced where it is read (app.js, pure:stored-data), like every other history reader.
      if (typeof _cleanStoredHistory === 'function') history = _cleanStoredHistory(history);
      history.forEach(function (h) {
        if (h.cancelledAt) return;
        if (h.instrId) { historyInstrIds.add(String(h.instrId)); return; }
        // Fallback: match by name
        if (h.instrName) {
          var match = allInstructors.find(function (i) { return i.full_name === h.instrName; });
          if (match) historyInstrIds.add(String(match.id));
        }
      });
    } catch (e) {}

    // 1. Ranked instructors (have a tier or are favourited)
    var ranked = allInstructors
      .filter(function (i) { var sid = String(i.id); return !!tiers[sid] || favs.has(sid); })
      .sort(function (a, b) {
        var oa = tiers[String(a.id)] ? tierOrder[tiers[String(a.id)]] : 99;
        var ob = tiers[String(b.id)] ? tierOrder[tiers[String(b.id)]] : 99;
        if (oa !== ob) return oa - ob;
        return a.full_name.localeCompare(b.full_name);
      });

    if (ranked.length > 0) {
      rankedContainer.innerHTML = ranked.map(function (i) { return tierRowHTML(i, tiers, favs); }).join('');
      rankedContainer.style.display = '';
    } else {
      rankedContainer.innerHTML = '<div class="tier-empty">No ranked instructors yet.</div>';
      rankedContainer.style.display = '';
    }

    // 2. Booked but not ranked
    var rankedIds = new Set(ranked.map(function (i) { return String(i.id); }));
    var unranked = allInstructors
      .filter(function (i) {
        var sid = String(i.id);
        return historyInstrIds.has(sid) && !rankedIds.has(sid);
      })
      .sort(function (a, b) { return a.full_name.localeCompare(b.full_name); });

    if (unrankedContainer) {
      if (unranked.length > 0) {
        unrankedContainer.innerHTML = unranked.map(function (i) { return tierRowHTML(i, tiers, favs); }).join('');
        unrankedContainer.style.display = '';
      } else {
        unrankedContainer.innerHTML = '<div class="tier-empty">All booked instructors have been ranked.</div>';
        unrankedContainer.style.display = '';
      }
    }

    // 3. Search results (only shown when typing)
    if (searchContainer) {
      if (query) {
        var results = allInstructors
          .filter(function (i) { return i.full_name.toLowerCase().includes(query); })
          .sort(function (a, b) { return a.full_name.localeCompare(b.full_name); });
        if (results.length > 0) {
          searchContainer.innerHTML = results.map(function (i) { return tierRowHTML(i, tiers, favs); }).join('');
        } else {
          searchContainer.innerHTML = '<div class="tier-empty">No instructor matches "' + escapeHTML(query) + '".</div>';
        }
        searchContainer.style.display = '';
      } else {
        searchContainer.style.display = 'none';
      }
    }
  }

  window.toggleFavFromSettings = function (instrId) {
    var sid = String(instrId);
    if (typeof favouriteInstructors === 'undefined') return;
    // app.js applies the one change to the STORED list (setFavourite): saving
    // this page's Set wholesale could overwrite a list restored after it was read.
    if (typeof setFavourite === 'function') {
      setFavourite(sid, !favouriteInstructors.has(sid));
    } else {
      if (favouriteInstructors.has(sid)) favouriteInstructors.delete(sid);
      else favouriteInstructors.add(sid);
      if (typeof saveFavourites === 'function') saveFavourites(favouriteInstructors);
    }
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
    // Discover's S/A quick filter only exists while someone is ranked S or A,
    // and it learns that inside renderInstrChips (the instructor modal ranks
    // through here too).
    if (typeof window.renderInstrChips === 'function') window.renderInstrChips();
  };


  // ═══════════════════════════════════════════════════════════════════
  // Calendar Sync UI (iOS only)
  // ═══════════════════════════════════════════════════════════════════

  // ── pure:calendar-sync:start
  async function renderCalendarSync() {
    var panel = document.getElementById('calendarSyncPanel');
    if (!panel) return;
    if (typeof window.psycleListCalendars !== 'function') {
      panel.textContent = 'Calendar sync is only available in the iOS app.';
      return;
    }
    var cfg = window.psycleGetCalendarConfig();
    var calendars = await window.psycleListCalendars();

    var chosen = cfg.mode === 'custom' && cfg.targetId;
    // Placeholder first; NO auto-create option — the user must pick an existing
    // calendar before anything is written. Psync never creates a calendar.
    var options = ['<option value="" disabled' + (chosen ? '' : ' selected') + '>Choose a calendar…</option>'];
    calendars.forEach(function (c) {
      var sel = chosen && String(cfg.targetId) === String(c.id) ? ' selected' : '';
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
      (enabled && !chosen ?
        '<div class="cal-sync-hint" style="color:var(--accent,#1f6f5c)">Choose a calendar to start syncing — nothing is added until you pick one.</div>' : '') +
      '<div class="cal-sync-actions">' +
        '<button class="cal-sync-resync" onclick="onCalendarResync(this)">Re-sync now</button>' +
        (typeof window.psycleCleanupDuplicates === 'function' ?
          '<button class="cal-sync-resync" onclick="onCalendarCleanupDupes(this)">Remove duplicates</button>' : '') +
      '</div>' +
      '<div class="cal-sync-hint">' +
        'The calendar you pick becomes fully managed by Psync: upcoming events in it are ' +
        'kept in lockstep with your bookings, so cancelled classes, slot changes and any ' +
        'duplicates are cleaned up automatically — and anything else in that calendar will ' +
        'be removed. Use a dedicated calendar (e.g. create a "Psycle" calendar in the ' +
        'Calendar app), not your personal one. Past events are never touched. Switching ' +
        'calendars moves your bookings across.' +
      '</div>';
  }

  window.onCalendarSyncToggle = async function (checkbox) {
    await window.psycleSetCalendarConfig({ enabled: !!checkbox.checked });
    renderCalendarSync();
  };

  /**
   * The ownership dialog. Handing a calendar to Psync means the reconcile
   * deletes every upcoming event in it that is not a Psycle booking — on this
   * device and, through the calendar's own sync, every other one, with no
   * undo. The list offers the member's REAL calendars (Home, Work, Family…),
   * so a pick alone is never consent: count what would go, say so, and ask.
   * Resolves true only on an explicit "Use this calendar".
   */
  async function _confirmCalendarOwnership(calId, name, cancelText) {
    if (typeof window.confirmModal !== 'function') return false; // can't ask → never assume yes
    var n = null; // null = couldn't count → warn without a number
    if (typeof window.psycleCountForeignEvents === 'function') {
      try { n = await window.psycleCountForeignEvents(calId); } catch (e) { n = null; }
    }
    var q = '"' + name + '"'; // confirmModal escapes title/body itself
    var body;
    if (typeof n === 'number' && n > 0) {
      body = q + ' has ' + n + ' upcoming event' +
        (n === 1 ? ' that is not a Psycle booking' : 's that are not Psycle bookings') +
        '. Psync will delete ' + (n === 1 ? 'it' : 'them') +
        ' now, and anything else that appears in this calendar on every sync. Past events are untouched.';
    } else if (n === 0) {
      body = 'Psync will delete anything in ' + q + ' that is not one of your Psycle bookings, on every sync. ' +
        'It has no other upcoming events right now. Past events are untouched.';
    } else {
      body = 'Psync will delete every upcoming event in ' + q + ' that is not one of your Psycle bookings — ' +
        'now and on every sync. Past events are untouched.';
    }
    return !!(await window.confirmModal({
      title: 'Let Psync manage ' + q + '?',
      body: body,
      warn: 'This can\'t be undone. Pick a calendar made just for Psycle, not your personal one.',
      confirmText: 'Use this calendar',
      cancelText: cancelText || 'Choose another',
      danger: true,
    }));
  }

  // Why a sync did NOT happen, in the member's words — '' when it really ran.
  // A skipped reconcile (signed out, bookings not loaded yet, a pass already
  // running) added and removed nothing: that is not "Synced ✓" / "No duplicates".
  function _calSyncProblem(r) {
    if (!r) return 'Sync failed';
    if (r.error) return r.error;
    if (r.skipped === 'signed out') return 'Sign in to sync';
    if (r.skipped === 'busy') return 'Already syncing';
    return r.skipped ? 'Bookings not loaded' : '';
  }

  window.onCalendarTargetChange = async function (select) {
    var val = select.value;
    if (!val) return; // placeholder ("Choose a calendar…") — nothing picked yet
    // Prevent rapid re-entry while the confirm/delete/sync is in flight
    select.disabled = true;
    try {
      // Switching sweeps our events out of the old calendar, and a signed-out
      // session can't write them into the new one — they would just vanish.
      var prev = window.psycleGetCalendarConfig();
      if (prev.mode === 'custom' && prev.targetId &&
          typeof getBearerToken === 'function' && !getBearerToken()) {
        if (typeof toast === 'function') toast('Sign in to switch calendars', 'error');
        return;
      }
      var picked = select.options && select.options[select.selectedIndex];
      if (!(await _confirmCalendarOwnership(val, (picked && picked.text) || 'this calendar'))) return;
      var result = await window.psycleSetCalendarConfig({ mode: 'custom', targetId: val, ownedAck: true });
      var r = null;
      if (typeof window.psycleResyncCalendar === 'function') {
        r = await window.psycleResyncCalendar({ ownedAck: true });
      }
      // 'busy' = a pass was already running and has queued the re-run that
      // fills the new calendar — nothing the member needs to act on.
      var problem = r && r.skipped !== 'busy' ? _calSyncProblem(r) : '';
      if (problem) {
        if (typeof toast === 'function') toast('Calendar saved, not synced yet — ' + problem, 'info');
      } else if (result && result.movedFromOld > 0 && typeof toast === 'function') {
        toast('Moved ' + result.movedFromOld + ' event' +
          (result.movedFromOld !== 1 ? 's' : '') + ' to new calendar', 'info');
      }
    } finally {
      select.disabled = false;
      // Repaint from the STORED config: after "Choose another" the select must
      // snap back to the calendar still in use (the placeholder on a first
      // pick — there is no previous value to restore), not keep showing a
      // calendar that was never handed over.
      renderCalendarSync();
    }
  };

  window.onCalendarCleanupDupes = async function (btn) {
    if (!window.psycleCleanupDuplicates) return;
    var old = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Scanning…';
    try {
      var res = await window.psycleCleanupDuplicates();
      var problem = _calSyncProblem(res);
      if (problem) {
        btn.textContent = problem; // incl. a reconcile that never ran — not "No duplicates"
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
    // A target picked before the ownership dialog existed was never handed
    // over, and this button used to grant that silently — so its first sync
    // wiped the calendar. Ask first; only a yes lets the resync confirm the
    // contract. (Signed out: nothing will run, so there is nothing to ask.)
    var opts;
    var cfg = typeof window.psycleGetCalendarConfig === 'function' ? window.psycleGetCalendarConfig() : {};
    if (cfg.mode === 'custom' && cfg.targetId && cfg.ownedAck === false &&
        !(typeof getBearerToken === 'function' && !getBearerToken())) {
      var sel = document.getElementById('calSyncTarget');
      var cur = sel && sel.options && sel.options[sel.selectedIndex];
      var name = cur && String(cur.value) === String(cfg.targetId) ? cur.text : 'this calendar';
      var agreed = false;
      try { agreed = await _confirmCalendarOwnership(cfg.targetId, name, 'Not now'); } catch (e) {}
      if (!agreed) { btn.disabled = false; return; }
      opts = { ownedAck: true };
    }
    btn.textContent = 'Syncing…';
    try {
      var r = await window.psycleResyncCalendar(opts);
      var problem = _calSyncProblem(r);
      if (problem) {
        btn.textContent = problem; // incl. a reconcile that never ran — not "Synced ✓"
      } else if (r && (r.added || r.removed)) {
        var parts = [];
        if (r.added) parts.push('+' + r.added);
        if (r.removed) parts.push('−' + r.removed);
        btn.textContent = 'Synced (' + parts.join(' ') + ')';
      } else {
        btn.textContent = r && r.kept
          ? 'All ' + r.kept + ' up to date'
          : 'Synced ✓';
      }
    } catch (e) {
      btn.textContent = 'Sync failed';
    }
    setTimeout(function () { btn.textContent = old; btn.disabled = false; }, 2200);
  };
  // ── pure:calendar-sync:end


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
      grid.innerHTML = '<div style="color:var(--text-dim);font-size:13px">No layout available for this studio</div>';
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
      // Colours come from .bike-pref-svg-object (css/settings.css) so the
      // podium follows the theme instead of staying a near-black tile.
      return '<rect class="bike-pref-svg-object" x="' + sx(obj.x) + '" y="' + sy(obj.y) + '" width="' + SLOT + '" height="' + SLOT + '"' +
        ' rx="4" stroke-dasharray="3,3"/>';
    }).join('');

    // Slots
    inner += slots.map(function (slot) {
      var id = Number(slot.id);
      var label = slot.label ?? slot.id;
      var cls = avoidSet.has(id) ? 'pref-avoid' : preferSet.has(id) ? 'pref-prefer' : '';
      // As the bike picker: only NUMBERS go into the handler, and the label
      // (free text in Psycle's layout editor) is escaped — this is innerHTML.
      return '<g class="bike-pref-svg-slot ' + cls + '" data-slot="' + id + '" ' +
        'onclick="toggleBikePref(' + Number(studioId) + ',' + id + ')" style="cursor:pointer">' +
        '<rect x="' + sx(slot.x) + '" y="' + sy(slot.y) + '" width="' + SLOT + '" height="' + SLOT + '"' +
        ' rx="6" stroke-width="1.5"/>' +
        '<text x="' + (sx(slot.x) + SLOT / 2) + '" y="' + (sy(slot.y) + SLOT / 2 + 4) + '"' +
        ' text-anchor="middle" font-family="sans-serif" font-size="11">' + escapeHTML(label) + '</text>' +
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
        // The marks above are colour only: have app.js re-read the seats so
        // each one's spoken name says "one you prefer" / "one you avoid" too.
        if (typeof _syncBikeSlotsA11y === 'function') _syncBikeSlotsA11y();

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

  // app.js (eventCard / renderMyBookings) calls this hook directly next to
  // the instructor name. A direct hook instead of a regex patch over the
  // card HTML: the old regex targeted markup that no longer exists in the
  // redesigned eventCard, so badges silently stopped rendering.
  window.tierBadgeHTML = function (instructorId) {
    var tier = getInstructorTier(instructorId);
    // This definition is the one that wins (it replaces the one above), so it
    // carries the same guard: an imported tier that is not a known letter
    // must never be interpolated into markup.
    return tier && TIERS.indexOf(tier) !== -1 ? '<span class="tier-badge tier-' + tier + '">' + tier + '</span>' : '';
  };


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

    var json = JSON.stringify(data, null, 2);
    var fileName = 'psycle-settings-' + new Date().toISOString().split('T')[0] + '.json';
    // Logged here: reliability.js's export hook looks for this function
    // before this file has loaded, so it never installs.
    if (typeof window.pushAction === 'function') window.pushAction('settings:export');

    // iOS app: <a download> blob clicks are dead in WKWebView (same as the bug
    // report below), so the only backup of tiers/favourites/bike prefs saved
    // nothing while claiming success. Hand the file to the share sheet instead
    // (Save to Files / AirDrop / Mail).
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
      _shareSettingsExport(json, fileName);
      return;
    }

    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('Settings exported', 'success');
  };

  // ── pure:settings-export:start
  // Native export. navigator.share() has to run in the SAME task as the tap —
  // WebKit only opens the share sheet under a live user gesture — so nothing
  // is awaited before it. Every toast reports what actually happened.
  // (Self-contained so tests/suites/ios-bridge.js can drive it with a fake
  // navigator / toast / nativeShare.)
  function _shareSettingsExport(json, fileName) {
    // Fallback: share the JSON as text through the Capacitor Share plugin
    // (needs no gesture). "Save to Files" stores that as .txt, which is why
    // the import picker accepts .txt as well.
    var shareAsText = function () {
      if (typeof window.nativeShare !== 'function') {
        toast("Couldn't export on this device", 'error');
        return;
      }
      window.nativeShare('Psync settings backup', json, null).then(function (shared) {
        // false usually means the share sheet was dismissed — never claim success.
        toast(shared ? 'Settings exported' : 'Export cancelled', shared ? 'success' : 'info');
      }, function () {
        toast("Couldn't export on this device", 'error');
      });
    };

    var file = null;
    try {
      file = new File([json], fileName, { type: 'application/json' });
      if (!(navigator.share && navigator.canShare && navigator.canShare({ files: [file] }))) file = null;
    } catch (e) { file = null; }
    if (!file) { shareAsText(); return; }

    var pending;
    try { pending = navigator.share({ files: [file] }); } catch (e) { shareAsText(); return; }
    Promise.resolve(pending).then(function () {
      toast('Settings exported', 'success');
    }, function (err) {
      if (err && err.name === 'AbortError') { toast('Export cancelled', 'info'); return; }
      shareAsText(); // file sharing refused (type / gesture) — the text route still works
    });
  }
  // ── pure:settings-export:end

  // ── pure:import-validate:start ── (DOM-free; tests/suites/import-validate.js evaluates this block)
  // What an import file may do. It used to be written into localStorage as it
  // came — every key it named, unchecked, over whatever the device held, with
  // no question asked: an old backup silently replaced months of history,
  // rankings and favourites (and on iOS the Preferences mirror made that
  // permanent), and a file made by someone else could plant markup in keys that
  // are later printed.
  //
  // Now: only the keys an export writes, each a string of bounded size whose
  // JSON has that key's shape (cleaned by app.js's pure:stored-data helpers,
  // handed in as `clean`). And the file only ever ADDS: classes this device has
  // no record of, rankings / bike prefs for instructors / studios it has none
  // for, favourites and spot alerts it lacks; theme, filters and the sync stamp
  // only where the device has none. Nothing the member already has is replaced.
  var IMPORT_MAX_FILE = 5242880;  // bytes — a full 2,000-class export is under 1 MB
  var IMPORT_MAX_VALUE = 1048576; // chars per key

  // data: the parsed file. deviceGet(key) → this device's raw stored string.
  // opts: { clean: {history, tiers, idList, bikePrefs}, themes: [ids], historyMax }
  // → { writes: {key: string}, added: {…counts}, accepted (keys that passed), skipped: [{key, reason}],
  //     exportedAt, deviceHasData }
  function _planSettingsImport(data, deviceGet, opts) {
    opts = opts || {};
    var clean = opts.clean || {};
    var plan = { writes: {}, added: {}, accepted: 0, skipped: [], exportedAt: '', deviceHasData: false };
    var skip = function (key, reason) { plan.skipped.push({ key: key, reason: reason }); };
    if (!data || typeof data !== 'object' || Array.isArray(data)) { skip('*', 'not a settings file'); return plan; }
    var own = function (k) { return Object.prototype.hasOwnProperty.call(data, k); };
    if (own('_exported_at') && typeof data._exported_at === 'string' && data._exported_at.length < 40 &&
        !isNaN(Date.parse(data._exported_at))) plan.exportedAt = data._exported_at;

    // The file's raw string for a key (undefined = absent or refused).
    var rawOf = function (key) {
      if (!own(key)) return undefined;
      var raw = data[key];
      if (typeof raw !== 'string' || raw === '') { skip(key, 'not text'); return undefined; }
      if (raw.length > IMPORT_MAX_VALUE) { skip(key, 'too large'); return undefined; }
      return raw;
    };
    var jsonOf = function (key) {
      var raw = rawOf(key);
      if (raw === undefined) return undefined;
      try { return JSON.parse(raw); } catch (e) { skip(key, 'unreadable'); return undefined; }
    };
    var deviceRaw = function (key) { try { return deviceGet(key) || ''; } catch (e) { return ''; } };
    var deviceJson = function (key, fallback) {
      var raw = deviceRaw(key);
      if (!raw) return fallback;
      try { return JSON.parse(raw); } catch (e) { return fallback; }
    };
    var isMap = function (v) { return !!v && typeof v === 'object' && !Array.isArray(v); };

    // Class history — by class: where this device has ANY record of a class
    // (booked or cancelled) it knows better than a backup; otherwise every row
    // the file holds for it comes in (a cancel + rebook is two rows).
    var fileHist = jsonOf('psycle_class_history');
    var devHist = clean.history(deviceJson('psycle_class_history', []));
    if (devHist.length) plan.deviceHasData = true;
    if (fileHist !== undefined) {
      if (!Array.isArray(fileHist)) skip('psycle_class_history', 'wrong shape');
      else {
        plan.accepted++;
        var known = Object.create(null), taken = Object.create(null), add = [];
        devHist.forEach(function (h) { known[h.eventId] = true; });
        clean.history(fileHist).forEach(function (h) {
          if (!h.eventId || typeof h.date !== 'string' || !h.date || known[h.eventId]) return;
          var rowKey = h.eventId + '|' + (h.cancelledAt ? 'x' : '');
          if (taken[rowKey]) return;
          taken[rowKey] = true;
          add.push(h);
        });
        if (add.length) {
          var merged = devHist.concat(add);
          merged.sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
          if (opts.historyMax > 0 && merged.length > opts.historyMax) merged.length = opts.historyMax;
          plan.writes.psycle_class_history = JSON.stringify(merged);
          plan.added.classes = add.length;
        }
      }
    }

    // Rankings and bike prefs — per instructor / studio, the device's kept.
    var fillMap = function (key, cleaner, isEmpty, label) {
      var fileVal = jsonOf(key);
      var dev = cleaner(deviceJson(key, {}));
      if (Object.keys(dev).length) plan.deviceHasData = true;
      if (fileVal === undefined) return;
      if (!isMap(fileVal)) { skip(key, 'wrong shape'); return; }
      plan.accepted++;
      var incoming = cleaner(fileVal), n = 0;
      Object.keys(incoming).forEach(function (id) {
        if (isEmpty(incoming[id]) || (Object.prototype.hasOwnProperty.call(dev, id) && !isEmpty(dev[id]))) return;
        dev[id] = incoming[id];
        n++;
      });
      if (n) { plan.writes[key] = JSON.stringify(dev); plan.added[label] = n; }
    };
    fillMap('psycle_instructor_tiers', clean.tiers, function (v) { return !v; }, 'rankings');
    fillMap('psycle_bike_prefs', clean.bikePrefs, function (v) { return !v || !(v.avoid.length || v.prefer.length); }, 'bikeStudios');

    // Favourites and spot alerts — set union.
    var unionList = function (key, label, countsAsData) {
      var fileVal = jsonOf(key);
      var dev = clean.idList(deviceJson(key, []));
      if (countsAsData && dev.length) plan.deviceHasData = true;
      if (fileVal === undefined) return;
      if (!Array.isArray(fileVal)) { skip(key, 'wrong shape'); return; }
      plan.accepted++;
      var n = 0;
      clean.idList(fileVal).forEach(function (id) {
        if (dev.indexOf(id) === -1) { dev.push(id); n++; }
      });
      if (n) { plan.writes[key] = JSON.stringify(dev); plan.added[label] = n; }
    };
    unionList('psycle_fav_instructors', 'favourites', true);
    unionList('psycle_notify_watchlist', 'alerts', false);

    // Theme, last filters, sync stamp — only where this device has none.
    var theme = rawOf('psycle_theme');
    if (theme !== undefined) {
      if ((opts.themes || []).indexOf(theme) === -1) skip('psycle_theme', 'unknown theme');
      else {
        plan.accepted++;
        if ((opts.themes || []).indexOf(deviceRaw('psycle_theme')) === -1) { plan.writes.psycle_theme = theme; plan.added.theme = 1; }
      }
    }
    var filters = jsonOf('psycle_saved_filters');
    if (filters !== undefined) {
      if (!isMap(filters)) skip('psycle_saved_filters', 'wrong shape');
      else if (deviceRaw('psycle_saved_filters')) plan.accepted++;
      else {
        plan.accepted++;
        // Flat copy: text, numbers, booleans and lists of those — nothing nested.
        var flat = {};
        var prim = function (v) { return (typeof v === 'string' && v.length <= 100) || typeof v === 'boolean' || (typeof v === 'number' && isFinite(v)); };
        Object.keys(filters).forEach(function (k) {
          if (k === '__proto__' || k === 'constructor' || k === 'prototype') return;
          var v = filters[k];
          if (v === null || prim(v)) flat[k] = v;
          else if (Array.isArray(v) && v.length <= 200) flat[k] = v.filter(prim);
        });
        plan.writes.psycle_saved_filters = JSON.stringify(flat);
        plan.added.filters = 1;
      }
    }
    var synced = rawOf('psycle_history_synced');
    if (synced !== undefined) {
      if (synced.length > 40 || isNaN(Date.parse(synced))) skip('psycle_history_synced', 'not a date');
      // Only alongside the history it vouches for, and never over this device's own stamp.
      else if (!deviceRaw('psycle_history_synced') && plan.writes.psycle_class_history) plan.writes.psycle_history_synced = synced;
    }
    return plan;
  }

  // "120 classes, 4 rankings and 2 favourites" — what the plan adds, in words.
  function _importSummary(added) {
    added = added || {};
    var n = function (count, one, many) { return count + ' ' + (count === 1 ? one : many); };
    var parts = [];
    if (added.classes) parts.push(n(added.classes, 'class', 'classes'));
    if (added.rankings) parts.push(n(added.rankings, 'ranking', 'rankings'));
    if (added.favourites) parts.push(n(added.favourites, 'favourite', 'favourites'));
    if (added.bikeStudios) parts.push('bike preferences for ' + n(added.bikeStudios, 'studio', 'studios'));
    if (added.alerts) parts.push(n(added.alerts, 'spot alert', 'spot alerts'));
    if (added.theme) parts.push('your theme');
    if (added.filters) parts.push('your last search filters');
    if (parts.length < 2) return parts.join('');
    return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
  }
  // ── pure:import-validate:end ──

  // Writes an accepted plan, says what changed, reloads (the app reads most of
  // these keys once, at launch).
  function _applySettingsImport(plan) {
    var failed = 0;
    Object.keys(plan.writes).forEach(function (key) {
      var ok = false;
      try {
        if (typeof window._psycleSafeSetItem === 'function') ok = window._psycleSafeSetItem(key, plan.writes[key]);
        else { localStorage.setItem(key, plan.writes[key]); ok = true; }
      } catch (e) {}
      if (!ok) failed++;
    });
    if (failed) {
      toast("Some of that backup couldn't be saved — this device's storage is full", 'error');
      return;
    }
    toast('Imported ' + _importSummary(plan.added) + ' — reloading', 'success');
    setTimeout(function () { location.reload(); }, 1200);
  }

  window.importSettings = function (input) {
    var file = input.files && input.files[0];
    if (!file) return;
    // Logged here for the same reason as the export above.
    if (typeof window.pushAction === 'function') window.pushAction('settings:import');

    var reader = new FileReader();
    if (file.size > IMPORT_MAX_FILE) {
      toast("That file is too large to be a Psync backup", 'error');
      input.value = '';
      return;
    }
    reader.onerror = function () { toast("Couldn't read that file", 'error'); input.value = ''; };
    reader.onload = function (e) {
      try {
        var data = JSON.parse(e.target.result);
        var plan = _planSettingsImport(data, function (key) { return localStorage.getItem(key); }, {
          clean: { history: _cleanStoredHistory, tiers: _cleanStoredTiers, idList: _cleanStoredIdList, bikePrefs: _cleanStoredBikePrefs },
          themes: (window.APP_THEMES || []).map(function (t) { return t.id; }),
          historyMax: window.PSYCLE_HISTORY_MAX || 2000,
        });
        var summary = _importSummary(plan.added);
        if (!summary) {
          // Nothing usable in it at all — or nothing this device lacks.
          if (!plan.accepted) toast("That doesn't look like a Psync backup — nothing was imported", 'error');
          else toast('Nothing new in that backup — everything in it is already on this device', 'info');
        } else if (!plan.deviceHasData) {
          _applySettingsImport(plan); // an empty device: nothing to weigh the file against
        } else {
          var when = plan.exportedAt ? new Date(plan.exportedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
          confirmModal({
            title: 'Import this backup?',
            // (body, not warn: that slot is the red ⚠ box, and this is a reassurance.)
            body: (when ? 'This backup was saved on ' + when + '. ' : '') + 'Importing adds ' + summary +
              '. Nothing already on this device is replaced — where both have something, this device\'s is kept.',
            confirmText: 'Import',
            cancelText: 'Cancel',
          }).then(function (ok) {
            if (ok) _applySettingsImport(plan);
            else toast('Import cancelled — nothing was changed', 'info');
          });
        }
      } catch (err) {
        toast('Import failed — that file isn\'t a readable Psync backup', 'error');
      }
      input.value = '';
    };
    reader.readAsText(file);
  };


  // ═══════════════════════════════════════════════════════════════════
  // Bug Report
  // ═══════════════════════════════════════════════════════════════════

  // ── pure:build-id:start ── (tests/suites/owner-tools.js evaluates this block against stub globals)
  // ── Build id (window.APP_VERSION) ──────────────────────────────
  // Nothing stamps a version into the page, so every report said "App
  // version: unknown". ios-app/build.js does stamp a content hash into sw.js's
  // cache name ('psycle-<8 hex>'), and that is the build id. Worked out on
  // first need (diagnostics panel, bug report) — never at startup.
  //   Web: the Cache Storage name the worker precached this build into.
  //   iOS: the bridge switches the worker off, and Cache Storage can still
  //        hold a cache an OLDER build made — read the bundled sw.js instead.
  var BUILD_ID_RE = /^psycle-[0-9a-f]{8}$/;
  var _appVersionPending = null;

  // A worker that takes over mid-session deletes the old cache while the page
  // keeps running the previous build's scripts, so the only name left to read
  // may belong to the NEXT build — the report has to say so. (No controller
  // at load = a first install, nothing stale: the same rule as the update
  // script in psycle-finder.html's head.)
  var _swSwappedSinceLoad = false;
  try {
    var _swContainer = navigator.serviceWorker;
    if (_swContainer && typeof _swContainer.addEventListener === 'function' && _swContainer.controller) {
      _swContainer.addEventListener('controllerchange', function () { _swSwappedSinceLoad = true; });
    }
  } catch (e) {}

  function _buildIdsFromCaches() {
    try {
      if (typeof caches === 'undefined' || !caches || typeof caches.keys !== 'function') return Promise.resolve([]);
      return caches.keys().then(function (names) {
        return (names || []).filter(function (n) { return BUILD_ID_RE.test(n); });
      }, function () { return []; });
    } catch (e) { return Promise.resolve([]); }
  }

  // Same-origin file (the app bundle on iOS). Only the matched id is kept.
  function _buildIdFromSwFile() {
    try {
      if (typeof fetch !== 'function') return Promise.resolve([]);
      return fetch('sw.js').then(function (res) {
        return (res && res.ok) ? res.text() : '';
      }).then(function (text) {
        var m = /const\s+CACHE\s*=\s*['"](psycle-[0-9a-f]{8})['"]/.exec(text || '');
        return m ? [m[1]] : [];
      }, function () { return []; });
    } catch (e) { return Promise.resolve([]); }
  }

  /** Resolves to the build id (also left on window.APP_VERSION), or null. */
  function resolveAppVersion() {
    if (window.APP_VERSION) return Promise.resolve(String(window.APP_VERSION));
    if (!_appVersionPending) {
      var native = false;
      try { native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); } catch (e) {}
      _appVersionPending = (native ? Promise.resolve([]) : _buildIdsFromCaches()).then(function (ids) {
        return ids.length ? ids : _buildIdFromSwFile();
      }).then(function (ids) {
        _appVersionPending = null;
        // Not remembered when nothing was found (offline first visit): the
        // next report tries again. Two names = an update is mid-install.
        if (!ids.length) return null;
        window.APP_VERSION = ids.join(' + ') +
          (_swSwappedSinceLoad ? ' (worker updated since load — reload pending)' : '');
        return window.APP_VERSION;
      }, function () { _appVersionPending = null; return null; });
    }
    // A report must never hang on a stalled request for its "Build:" line.
    return Promise.race([_appVersionPending, new Promise(function (resolve) {
      setTimeout(function () { resolve(null); }, 2000);
    })]);
  }
  // native-bridge's getDiagnosticReport awaits this for its own "Build:" line.
  window.getAppVersion = resolveAppVersion;
  // ── pure:build-id:end ──

  function buildBugReport() {
    var sections = [];

    // Header
    sections.push('=== Psycle Bug Report ===');
    sections.push('Generated: ' + new Date().toISOString());
    sections.push('Build: ' + (window.APP_VERSION || 'unknown'));
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

  window.downloadBugReport = async function () {
    // The report's "Build:" line reads window.APP_VERSION (capped at 2s).
    try { await resolveAppVersion(); } catch (e) {}
    var report = buildBugReport();
    var date = new Date().toISOString().split('T')[0];

    // iOS app: <a download> blob clicks are dead in WKWebView — route
    // through the native share sheet instead (Mail / Messages / AirDrop /
    // Save to Files), which is also how TestFlight testers send us the
    // JS-layer diagnostics that native crash reporting can't see.
    if (typeof window.nativeShare === 'function' &&
        window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
      // Prefer the richer native report (device info + native logs) when
      // the bridge exposes it.
      var fullReport = report;
      if (typeof window.getDiagnosticReport === 'function') {
        try { fullReport = await window.getDiagnosticReport(); } catch (e) {}
      }
      var shared = await window.nativeShare('Psync bug report ' + date, fullReport, null);
      if (shared) { toast('Bug report ready to send', 'success'); return; }
      // false usually means the user CANCELLED the share sheet — don't
      // clobber their clipboard or claim success. (The old copy pointed at a
      // "Copy" button this panel never had; the share sheet has its own.)
      toast('Share cancelled — the report was not sent', 'info');
      return;
    }

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

  // Returns whether the text really reached the clipboard, so a caller with
  // its own status line (copyDiagnostics) never announces a copy that failed.
  function _fallbackCopy(text, status, what) {
    var ok = false;
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      // A refused copy (no user gesture left) returns false; it does not throw.
      if (document.execCommand('copy') === false) throw new Error('copy refused');
      ok = true;
      if (status) {
        status.style.display = '';
        status.style.color = '#5dba5d';
        status.textContent = 'Copied to clipboard!';
        setTimeout(function () { status.style.display = 'none'; }, 3000);
      }
      toast((what || 'Bug report') + ' copied to clipboard', 'success');
    } catch (e) {
      if (status) {
        status.style.display = '';
        status.style.color = '#e94560';
        status.textContent = 'Copy failed — try the download button instead';
      }
      toast('Copy failed', 'error');
    }
    document.body.removeChild(ta);
    return ok;
  }


  // ═══════════════════════════════════════════════════════════════════
  // Diagnostics Panel
  // ═══════════════════════════════════════════════════════════════════
  // Self-service troubleshooting view. The app talks to an UNOFFICIAL API,
  // so users need to see API health / drift, recent errors, recent actions
  // and a small environment summary without opening a console.
  //
  // HARD safety rules upheld here:
  //   - Every value rendered into HTML goes through escapeHTML().
  //   - The bearer token (or any localStorage value) is NEVER rendered —
  //     we surface a boolean "present" flag and counts/field-names only.
  //   - Cross-module access (PsycleDiag, getErrorLog, getActionLog,
  //     getFullLog, getDiagnosticReport) is guarded with typeof.

  var DIAG_MAX_LOG_ROWS = 15;

  function esc(v) {
    return (typeof window.escapeHTML === 'function')
      ? window.escapeHTML(String(v == null ? '' : v))
      : String(v == null ? '' : v);
  }

  /** Boolean-only check for whether an auth token is present. Never reads the value into the DOM. */
  function diagHasToken() {
    try {
      if (typeof getBearerToken === 'function') return !!getBearerToken();
    } catch (e) {}
    try { return !!localStorage.getItem('psycle_bearer_token_enc'); } catch (e) {}
    try { return !!localStorage.getItem('psycle_bearer_token'); } catch (e) {}
    return false;
  }

  /** Pull the diagnostics object from PsycleDiag, fully guarded. Returns null if unavailable. */
  function diagGetDiagnostics() {
    try {
      if (typeof window.PsycleDiag !== 'undefined' && window.PsycleDiag &&
          typeof window.PsycleDiag.getDiagnostics === 'function') {
        return window.PsycleDiag.getDiagnostics();
      }
    } catch (e) {}
    return null;
  }

  /** Last N entries (newest first) from a log getter that returns [{timestamp, <key>}]. */
  function diagRecentLog(getterName, key) {
    var rows = [];
    try {
      if (typeof window[getterName] === 'function') {
        var log = window[getterName]();
        if (Array.isArray(log)) {
          rows = log.slice(Math.max(0, log.length - DIAG_MAX_LOG_ROWS)).reverse();
        }
      }
    } catch (e) {}
    if (!rows.length) {
      return '<div class="diag-empty">No entries.</div>';
    }
    return rows.map(function (entry) {
      var ts = entry && entry.timestamp ? entry.timestamp : '';
      var detail = entry ? entry[key] : '';
      return '<div class="diag-log-row">' +
        '<span class="diag-log-ts">' + esc(ts) + '</span>' +
        '<span class="diag-log-msg">' + esc(detail) + '</span>' +
      '</div>';
    }).join('');
  }

  /** Build the API-health section HTML from a diagnostics object (may be null). */
  function diagApiHealthHTML(diag) {
    if (!diag) {
      return '<div class="diag-empty">Diagnostics module not available.</div>';
    }
    var rows = [];

    var safe = !!diag.safeMode;
    rows.push('<div class="diag-kv">' +
      '<span class="diag-k">Safe mode</span>' +
      '<span class="diag-v ' + (safe ? 'diag-bad' : 'diag-ok') + '">' +
        (safe ? 'Active' : 'Off') + '</span>' +
    '</div>');

    var contract = diag.contract;
    var capturedAt = (contract && contract.capturedAt) ? contract.capturedAt : null;
    rows.push('<div class="diag-kv">' +
      '<span class="diag-k">Contract captured</span>' +
      '<span class="diag-v">' + (capturedAt ? esc(capturedAt) : 'Not captured yet') + '</span>' +
    '</div>');

    rows.push('<div class="diag-kv">' +
      '<span class="diag-k">Last drift</span>' +
      '<span class="diag-v">' + (diag.lastDriftAt ? esc(diag.lastDriftAt) : 'None') + '</span>' +
    '</div>');

    var findings = Array.isArray(diag.drift) ? diag.drift : [];
    if (!findings.length) {
      rows.push('<div class="diag-kv">' +
        '<span class="diag-k">Drift findings</span>' +
        '<span class="diag-v diag-ok">None — shapes look healthy</span>' +
      '</div>');
    } else {
      var findHTML = findings.map(function (f) {
        var kind = f && f.kind ? f.kind : 'unknown';
        var missing = (f && Array.isArray(f.missingRequired)) ? f.missingRequired : [];
        var note = (f && f.note) ? f.note : '';
        return '<div class="diag-finding">' +
          '<span class="diag-finding-kind">' + esc(kind) + '</span>' +
          (missing.length
            ? '<span class="diag-finding-missing">missing required: ' + esc(missing.join(', ')) + '</span>'
            : '') +
          (note ? '<span class="diag-finding-note">' + esc(note) + '</span>' : '') +
        '</div>';
      }).join('');
      rows.push('<div class="diag-kv diag-kv-block">' +
        '<span class="diag-k diag-bad">Drift findings (' + findings.length + ')</span>' +
        '<div class="diag-findings">' + findHTML + '</div>' +
      '</div>');
    }

    return rows.join('');
  }

  /** Build the environment section HTML. Booleans/counts only — no token, no values. */
  function diagEnvironmentHTML(diag) {
    var appVersion = (diag && diag.appVersion) ? diag.appVersion : null;
    if (!appVersion) {
      try { if (window.APP_VERSION) appVersion = String(window.APP_VERSION); } catch (e) {}
    }
    var online = false;
    try { online = !!navigator.onLine; } catch (e) {}
    var inIosApp = false;
    try { inIosApp = !!window.Capacitor; } catch (e) {}
    var tokenPresent = diagHasToken();
    var errorCount = (diag && typeof diag.errorLogCount === 'number') ? diag.errorLogCount : 0;
    var actionCount = (diag && typeof diag.actionLogCount === 'number') ? diag.actionLogCount : 0;

    function kv(k, v, cls) {
      return '<div class="diag-kv">' +
        '<span class="diag-k">' + esc(k) + '</span>' +
        '<span class="diag-v' + (cls ? ' ' + cls : '') + '">' + esc(v) + '</span>' +
      '</div>';
    }

    return kv('App version', appVersion || 'unknown') +
      kv('Online', online ? 'Yes' : 'No', online ? 'diag-ok' : 'diag-bad') +
      kv('iOS app', inIosApp ? 'Yes' : 'No') +
      kv('Auth token present', tokenPresent ? 'Yes' : 'No', tokenPresent ? 'diag-ok' : 'diag-bad') +
      kv('Stored errors', String(errorCount)) +
      kv('Stored actions', String(actionCount));
  }

  // The iOS bridge's getDiagnosticReport() is async, but "Copy diagnostics" has
  // to stay synchronous: awaiting inside the tap spends WebKit's user gesture
  // before clipboard.writeText runs. So the panel fetches the report when it
  // opens (and again after "Clear logs") and the tap embeds what has landed.
  var _diagReportText = null;
  var _diagReportSeq = 0;

  function diagPrefetchReport() {
    // Only the newest fetch may land: one started before "Clear logs" still
    // carries the entries that were just cleared.
    var seq = ++_diagReportSeq;
    _diagReportText = null;
    if (typeof window.getDiagnosticReport !== 'function') return;
    try {
      Promise.resolve(window.getDiagnosticReport()).then(function (text) {
        if (seq === _diagReportSeq && typeof text === 'string') _diagReportText = text;
      }, function () {
        // It will never land: say that, not "still loading".
        if (seq === _diagReportSeq) _diagReportText = '(native report unavailable)';
      });
    } catch (e) { _diagReportText = '(native report unavailable)'; }
  }

  /**
   * Assemble the JSON blob copied by "Copy diagnostics". Prefers a native /
   * existing report (getDiagnosticReport / getFullLog) when present, else
   * assembles from the diagnostics object + counts. NEVER includes the token
   * value or full localStorage values.
   */
  function diagBuildCopyBlob(diag) {
    var blob = {
      generatedAt: new Date().toISOString(),
      environment: {
        appVersion: (diag && diag.appVersion) ? diag.appVersion : (window.APP_VERSION || null),
        online: (function () { try { return !!navigator.onLine; } catch (e) { return null; } })(),
        iosApp: (function () { try { return !!window.Capacitor; } catch (e) { return false; } })(),
        tokenPresent: diagHasToken(),
        userAgent: (function () { try { return navigator.userAgent; } catch (e) { return null; } })(),
      },
      apiHealth: diag ? {
        safeMode: !!diag.safeMode,
        contractCapturedAt: (diag.contract && diag.contract.capturedAt) || null,
        lastDriftAt: diag.lastDriftAt || null,
        drift: Array.isArray(diag.drift) ? diag.drift : [],
        errorLogCount: typeof diag.errorLogCount === 'number' ? diag.errorLogCount : 0,
        actionLogCount: typeof diag.actionLogCount === 'number' ? diag.actionLogCount : 0,
      } : null,
    };

    // A combined error+action log, if reliability.js exposed it.
    try {
      if (typeof window.getFullLog === 'function') {
        blob.fullLog = window.getFullLog();
      }
    } catch (e) {}

    // A richer native diagnostic report, if the iOS bridge exposed one. It is
    // async, and this runs inside the Copy tap, so it embeds the text the panel
    // fetched on open (the un-awaited promise used to serialise as {}).
    try {
      if (typeof window.getDiagnosticReport === 'function') {
        blob.diagnosticReport = _diagReportText || '(still loading — copy again in a moment)';
      }
    } catch (e) {}

    try {
      return JSON.stringify(blob, null, 2);
    } catch (e) {
      // Last-resort: a minimal, definitely-serialisable summary.
      return JSON.stringify({
        generatedAt: blob.generatedAt,
        tokenPresent: blob.environment.tokenPresent,
        note: 'Full diagnostics could not be serialised.',
      }, null, 2);
    }
  }

  window.openDiagnostics = function () {
    if (document.getElementById('diagOverlay')) return;

    var diag = diagGetDiagnostics();

    var overlay = document.createElement('div');
    overlay.id = 'diagOverlay';
    overlay.className = 'settings-overlay diag-overlay';
    overlay.onclick = function (e) { if (e.target === overlay) closeDiagnostics(); };

    overlay.innerHTML =
      '<div class="settings-panel diag-panel" role="dialog" aria-modal="true" aria-labelledby="diagTitle" tabindex="-1">' +
        '<div class="settings-header">' +
          '<span class="settings-title" id="diagTitle">Diagnostics</span>' +
          '<button class="settings-close diag-close" onclick="closeDiagnostics()" aria-label="Close">×</button>' +
        '</div>' +
        '<div class="settings-body">' +
          '<div class="settings-section">' +
            '<div class="settings-section-title">API health</div>' +
            '<div class="diag-block">' + diagApiHealthHTML(diag) + '</div>' +
          '</div>' +
          '<div class="settings-section">' +
            '<div class="settings-section-title">Recent errors</div>' +
            '<div class="diag-log">' + diagRecentLog('getErrorLog', 'message') + '</div>' +
          '</div>' +
          '<div class="settings-section">' +
            '<div class="settings-section-title">Recent actions</div>' +
            '<div class="diag-log">' + diagRecentLog('getActionLog', 'action') + '</div>' +
          '</div>' +
          '<div class="settings-section">' +
            '<div class="settings-section-title">Environment</div>' +
            '<div class="diag-block">' + diagEnvironmentHTML(diag) + '</div>' +
          '</div>' +
          '<div class="settings-section">' +
            '<div class="settings-section-title">Tools</div>' +
            '<div class="app-advanced">' +
              '<button class="app-advanced-btn" id="diagCopyBtn">Copy diagnostics</button>' +
              '<button class="app-advanced-btn" id="diagClearBtn">Clear logs</button>' +
            '</div>' +
            '<div class="diag-status" id="diagStatus" style="display:none"></div>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    // Wire buttons via addEventListener (no inline string-arg onclick).
    var copyBtn = document.getElementById('diagCopyBtn');
    if (copyBtn) copyBtn.addEventListener('click', copyDiagnostics);
    var clearBtn = document.getElementById('diagClearBtn');
    if (clearBtn) clearBtn.addEventListener('click', clearDiagnosticLogs);

    // Both land a moment after the panel paints: the native report waits for
    // the Copy tap, the build id replaces "App version: unknown" in place.
    diagPrefetchReport();
    resolveAppVersion().then(function (version) {
      var blocks = document.querySelectorAll('#diagOverlay .diag-block');
      if (version && blocks[1]) blocks[1].innerHTML = diagEnvironmentHTML(diagGetDiagnostics());
    }, function () {});
  };

  window.closeDiagnostics = function () {
    var el = document.getElementById('diagOverlay');
    if (el) el.remove();
  };

  function diagStatus(msg, ok) {
    var el = document.getElementById('diagStatus');
    if (!el) return;
    el.style.display = '';
    el.style.color = ok ? '#5dba5d' : '#e94560';
    el.textContent = msg;
    setTimeout(function () { if (el) el.style.display = 'none'; }, 3000);
  }

  function copyDiagnostics() {
    var blob = diagBuildCopyBlob(diagGetDiagnostics());
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(blob).then(function () {
        diagStatus('Diagnostics copied to clipboard', true);
        if (typeof toast === 'function') toast('Diagnostics copied', 'success');
      }).catch(function () {
        copyDiagnosticsFallback(blob);
      });
    } else {
      copyDiagnosticsFallback(blob);
    }
  }

  // The status line used to say "copied" whatever the fallback did.
  function copyDiagnosticsFallback(blob) {
    var ok = _fallbackCopy(blob, null, 'Diagnostics');
    diagStatus(ok ? 'Diagnostics copied to clipboard' : 'Copy failed — try again', ok);
  }

  function clearDiagnosticLogs() {
    try { localStorage.removeItem('psycle_error_log'); } catch (e) {}
    try { localStorage.removeItem('psycle_action_log'); } catch (e) {}
    // Refresh the open panel in place so the cleared state is visible.
    var diag = diagGetDiagnostics();
    var errEl = document.querySelector('#diagOverlay .diag-log');
    if (errEl) {
      var logs = document.querySelectorAll('#diagOverlay .diag-log');
      if (logs[0]) logs[0].innerHTML = diagRecentLog('getErrorLog', 'message');
      if (logs[1]) logs[1].innerHTML = diagRecentLog('getActionLog', 'action');
    }
    var envBlocks = document.querySelectorAll('#diagOverlay .diag-block');
    if (envBlocks && envBlocks[1]) envBlocks[1].innerHTML = diagEnvironmentHTML(diag);
    diagPrefetchReport(); // the fetched native report still lists what was just cleared
    diagStatus('Logs cleared', true);
    if (typeof toast === 'function') toast('Logs cleared', 'success');
  }


})();
