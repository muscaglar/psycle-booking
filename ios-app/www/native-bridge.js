/* ═══════════════════════════════════════════════════════════════════
   Native Bridge — Capacitor integration layer

   Loaded ONLY in the iOS app (not on the web). Enhances the web app
   with native capabilities:
   - Persistent storage via Capacitor Preferences (survives purges)
   - Native haptics
   - Native share sheet

   This file is added to www/ only in the Capacitor build.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // Wait for Capacitor to be ready
  if (!window.Capacitor) {
    console.log('[native] Not running in Capacitor — skipping native bridge');
    return;
  }

  console.log('[native] Capacitor detected — initializing native bridge');

  var Preferences = Capacitor.Plugins.Preferences;
  var Haptics = Capacitor.Plugins.Haptics;
  var Share = Capacitor.Plugins.Share;

  // ── Disable Service Worker ─────────────────────────────────────
  // Files are bundled in the app binary — SW caching is redundant
  // and can serve stale files after an app update.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      regs.forEach(function (r) { r.unregister(); });
    });
    // Prevent re-registration
    Object.defineProperty(navigator, 'serviceWorker', {
      get: function () { return { register: function () { return Promise.resolve(); } }; }
    });
  }

  // ── Fix Login Flow ─────────────────────────────────────────────
  // window.open() in WKWebView opens Safari, breaking postMessage.
  // Override openLoginPopup to navigate in-app instead.
  window.openLoginPopup = function () {
    window.location.href = './login.html';
  };

  // ── Fix window.open calls ─────────────────────────────────────
  // calendar.js uses window.open for Google Calendar and ICS blob.
  // In WKWebView these escape to Safari. Use Capacitor Browser plugin
  // for external URLs, and in-app navigation for local files.
  var Browser = Capacitor.Plugins.Browser;
  var _origWindowOpen = window.open;
  window.open = function (url, target) {
    if (!url) return _origWindowOpen.apply(this, arguments);
    // Blob URLs (ICS download) — let them pass through
    if (url.startsWith('blob:')) return _origWindowOpen.apply(this, arguments);
    // External URLs — open in Capacitor in-app browser
    if (url.startsWith('http://') || url.startsWith('https://')) {
      Browser.open({ url: url }).catch(function () {
        _origWindowOpen.call(window, url, target);
      });
      return null;
    }
    // Local URLs — navigate in-app
    return _origWindowOpen.apply(this, arguments);
  };

  // ── Persistent Storage ─────────────────────────────────────────
  // Mirror all psycle_ localStorage keys to Capacitor Preferences
  // so data survives iOS storage purges.

  var SYNC_KEYS = [
    'psycle_bearer_token', 'psycle_bearer_token_enc',
    'psycle_fav_instructors', 'psycle_saved_filters',
    'psycle_instructor_tiers', 'psycle_bike_prefs',
    'psycle_theme', 'psycle_class_history', 'psycle_history_synced',
    'psycle_notify_watchlist', 'psycle_calendar_data',
    'psycle_error_log', 'psycle_offline_queue', 'psycle_action_log',
    // Calendar integration state — must survive iOS storage purges
    // or duplicates are created on the next full sync.
    'psycle_native_cal_events', 'psycle_native_cal_id',
    'psycle_calendar_target_id', 'psycle_calendar_mode',
    'psycle_calendar_enabled',
  ];

  // On startup: restore from native storage to localStorage
  async function restoreFromNative() {
    for (var i = 0; i < SYNC_KEYS.length; i++) {
      var key = SYNC_KEYS[i];
      try {
        var result = await Preferences.get({ key: key });
        if (result.value !== null && result.value !== undefined) {
          var current = localStorage.getItem(key);
          if (!current) {
            localStorage.setItem(key, result.value);
            console.log('[native] restored:', key);
          }
        }
      } catch (e) {}
    }
  }

  // Sync localStorage changes to native storage
  function syncToNative(key, value) {
    if (!SYNC_KEYS.includes(key)) return;
    if (value === null || value === undefined) {
      Preferences.remove({ key: key }).catch(function () {});
    } else {
      Preferences.set({ key: key, value: String(value) }).catch(function () {});
    }
  }

  // Intercept localStorage.setItem and removeItem
  var _origSetItem = localStorage.setItem.bind(localStorage);
  var _origRemoveItem = localStorage.removeItem.bind(localStorage);

  localStorage.setItem = function (key, value) {
    _origSetItem(key, value);
    syncToNative(key, value);
  };

  localStorage.removeItem = function (key) {
    _origRemoveItem(key);
    syncToNative(key, null);
  };

  // Restore on startup
  restoreFromNative();


  // ── Native Haptics ─────────────────────────────────────────────
  // Override the web haptic function with native haptics

  if (Haptics) {
    window.haptic = function (type) {
      switch (type) {
        case 'success':
          Haptics.notification({ type: 'SUCCESS' }).catch(function () {});
          break;
        case 'error':
          Haptics.notification({ type: 'ERROR' }).catch(function () {});
          break;
        case 'tap':
          Haptics.impact({ style: 'LIGHT' }).catch(function () {});
          break;
      }
    };
  }


  // ── Native Share ───────────────────────────────────────────────
  // Expose a native share function for booking cards

  window.nativeShare = async function (title, text, url) {
    if (!Share) return false;
    try {
      await Share.share({ title: title, text: text, url: url });
      return true;
    } catch (e) {
      return false;
    }
  };


  // ── Native Calendar Integration ─────────────────────────────────
  // Auto-add events to iOS Calendar on booking, auto-remove on cancel.
  // Uses @ebarooni/capacitor-calendar v8 plugin for EventKit access.
  // Production-hardened: dedicated calendar, reminders, proper error handling.

  var Calendar = Capacitor.Plugins.CapacitorCalendar;
  var CAL_EVENT_MAP_KEY = 'psycle_native_cal_events'; // { eventId: nativeCalEventId }
  var CAL_ID_KEY = 'psycle_native_cal_id';            // dedicated calendar ID (auto-created)
  var CAL_TARGET_KEY = 'psycle_calendar_target_id';   // user-selected target calendar ID
  var CAL_MODE_KEY = 'psycle_calendar_mode';          // 'auto' | 'custom' | 'default'
  var CAL_ENABLED_KEY = 'psycle_calendar_enabled';    // '0' disables sync entirely
  var PSYCLE_CAL_TITLE = 'Psycle';
  var PSYCLE_CAL_COLOR = '#e94560';

  function _loadCalMap() {
    try { return JSON.parse(localStorage.getItem(CAL_EVENT_MAP_KEY) || '{}'); } catch (e) { return {}; }
  }
  function _saveCalMap(map) {
    localStorage.setItem(CAL_EVENT_MAP_KEY, JSON.stringify(map));
  }

  /**
   * Get the slot label for a class type (matches app.js slotLabel).
   * Ride → Bike, Reformer/Pilates → Bed, Strength → Bench, else → Spot
   */
  function _nativeSlotLabel(typeName) {
    var n = (typeName || '').toUpperCase();
    if (n.includes('REFORMER')) return 'Bed';
    if (n.includes('RIDE')) return 'Bike';
    if (n.includes('PILATES')) return 'Bed';
    if (n.includes('STRENGTH') || n.includes('LIFT') || n.includes('WEIGHTS') || n.includes('TREAD')) return 'Bench';
    return 'Spot';
  }

  // ── Permissions ──────────────────────────────────────────────────

  var _calPermissionGranted = false;

  async function _ensureCalendarPermission() {
    if (_calPermissionGranted) return true;
    if (!Calendar) return false;
    try {
      var check = await Calendar.checkAllPermissions();
      var perms = check.result || check;
      if (perms.readCalendar === 'granted' && perms.writeCalendar === 'granted') {
        _calPermissionGranted = true;
        return true;
      }
      var req = await Calendar.requestAllPermissions();
      var reqPerms = req.result || req;
      _calPermissionGranted = reqPerms.readCalendar === 'granted' && reqPerms.writeCalendar === 'granted';
      return _calPermissionGranted;
    } catch (e) {
      console.warn('[native-cal] permission error:', e);
      return false;
    }
  }

  // ── Dedicated Psycle Calendar ────────────────────────────────────

  async function _listNativeCalendars() {
    if (!Calendar) return [];
    try {
      var calendars = await Calendar.listCalendars();
      var list = calendars.result || calendars || [];
      // Normalize: some plugin versions nest results differently
      return Array.isArray(list) ? list : [];
    } catch (e) {
      console.warn('[native-cal] listCalendars failed:', e);
      return [];
    }
  }

  async function _resolveTargetCalendarId() {
    var mode = localStorage.getItem(CAL_MODE_KEY) || 'auto';

    // User picked a specific calendar — verify it still exists.
    if (mode === 'custom') {
      var target = localStorage.getItem(CAL_TARGET_KEY);
      if (target) {
        var list = await _listNativeCalendars();
        if (list.some(function (c) { return String(c.id) === String(target); })) {
          return target;
        }
        // Target disappeared (user deleted it) — fall through to auto.
      }
    }

    // 'default' = let iOS pick (no calendarId on createEvent).
    if (mode === 'default') return null;

    // 'auto' (default): dedicated "Psycle" calendar, create if absent.
    var cachedId = localStorage.getItem(CAL_ID_KEY);
    if (cachedId) {
      var cachedList = await _listNativeCalendars();
      if (cachedList.some(function (c) { return String(c.id) === String(cachedId); })) {
        return cachedId;
      }
      // Cached calendar was deleted — drop it and recreate below.
      localStorage.removeItem(CAL_ID_KEY);
    }

    try {
      var all = await _listNativeCalendars();
      var existing = all.find(function (c) { return c.title === PSYCLE_CAL_TITLE; });
      if (existing) {
        localStorage.setItem(CAL_ID_KEY, existing.id);
        return existing.id;
      }
      var created = await Calendar.createCalendar({
        title: PSYCLE_CAL_TITLE,
        color: PSYCLE_CAL_COLOR,
      });
      var calId = (created.result || created).id || created.id;
      if (calId) {
        localStorage.setItem(CAL_ID_KEY, calId);
        console.log('[native-cal] created Psycle calendar:', calId);
        return calId;
      }
    } catch (e) {
      console.warn('[native-cal] calendar creation failed (using default):', e);
    }
    return null;
  }

  // Back-compat alias
  var _ensurePsycleCalendar = _resolveTargetCalendarId;

  // ── Add / Update / Remove Events ─────────────────────────────────

  function _buildCalEventData(eventId) {
    var evt = (_eventCache || {})[String(eventId)];
    if (!evt) return null;
    var booking = (_myBookings || {})[String(eventId)];
    if (!booking) return null;

    var start = new Date(evt.start_at);
    var end = new Date(start.getTime() + (evt.duration || 45) * 60 * 1000);
    var slots = booking.slots || [];
    var label = _nativeSlotLabel(evt._typeName);
    var slotStr = slots.length === 1 ? label + ' ' + slots[0]
      : slots.length > 1 ? label + 's ' + slots.join(' & ') : '';

    var title = (evt._typeName || 'Class') +
      (evt._instrName ? ' — ' + evt._instrName : '') +
      (slotStr ? ' (' + slotStr + ')' : '');

    var location = evt._locAddress
      ? (evt._locFullName || 'Psycle') + ', ' + evt._locAddress
      : evt._locFullName || evt._locName || '';

    var desc = [];
    if (evt._instrName) desc.push('Instructor: ' + evt._instrName);
    if (slotStr) desc.push(slotStr);
    if (evt._studioName) desc.push('Studio: ' + evt._studioName);
    desc.push('Duration: ' + (evt.duration || 45) + 'min');

    return {
      title: title,
      location: location,
      startDate: start.getTime(),
      endDate: end.getTime(),
      description: desc.join('\n'),
      isAllDay: false,
      alerts: [-60, -15], // 1 hour and 15 minutes before class
    };
  }

  /**
   * Look for an existing native event with the same start time and title
   * within the target calendar. Used to dedupe when the local map was lost
   * (iOS storage purge, reinstall) or when creation succeeded but the
   * mapping write failed.
   */
  async function _findExistingNativeEvent(calId, data) {
    if (!Calendar || !data) return null;
    // Search a narrow window around the event start.
    var windowMs = 60 * 60 * 1000; // ±1h
    var rangeStart = new Date(data.startDate - windowMs);
    var rangeEnd = new Date(data.endDate + windowMs);
    try {
      var q = await Calendar.listEventsInRange({
        startDate: rangeStart.getTime(),
        endDate: rangeEnd.getTime(),
      });
      var events = q.result || q || [];
      if (!Array.isArray(events)) return null;
      // Match on exact start time + title (title encodes class+instructor+slot).
      var match = events.find(function (ev) {
        if (calId && ev.calendarId && String(ev.calendarId) !== String(calId)) return false;
        var evStart = typeof ev.startDate === 'number' ? ev.startDate : new Date(ev.startDate).getTime();
        return Math.abs(evStart - data.startDate) < 60 * 1000 && ev.title === data.title;
      });
      return match ? (match.id || match.eventId) : null;
    } catch (e) {
      // listEventsInRange may not be available on all plugin versions — ignore.
      return null;
    }
  }

  function calendarSyncEnabled() {
    return localStorage.getItem(CAL_ENABLED_KEY) !== '0';
  }

  async function addBookingToCalendar(eventId) {
    if (!Calendar) return;
    if (!calendarSyncEnabled()) return;
    var ok = await _ensureCalendarPermission();
    if (!ok) return;

    var data = _buildCalEventData(eventId);
    if (!data) return;

    var calId = await _resolveTargetCalendarId();
    if (calId) data.calendarId = calId;

    var map = _loadCalMap();

    // If we already have a mapping, don't create again.
    if (map[String(eventId)]) return;

    // Dedupe: an event matching this title+time may already exist if the
    // local mapping was lost (storage purge / reinstall).
    var existingNativeId = await _findExistingNativeEvent(calId, data);
    if (existingNativeId) {
      map[String(eventId)] = existingNativeId;
      _saveCalMap(map);
      console.log('[native-cal] adopted existing:', eventId, '→', existingNativeId);
      return;
    }

    try {
      var result = await Calendar.createEvent(data);
      var nativeId = (result.result || result).id || result.id;
      if (nativeId) {
        map[String(eventId)] = nativeId;
        _saveCalMap(map);
        console.log('[native-cal] added:', eventId, '→', nativeId);
      }
    } catch (e) {
      console.warn('[native-cal] create failed:', e);
    }
  }

  async function updateBookingInCalendar(eventId) {
    // Remove old entry and re-add with updated data (slot changes etc.)
    await removeBookingFromCalendar(eventId);
    // Only re-add if booking still exists
    if ((_myBookings || {})[String(eventId)]) {
      await addBookingToCalendar(eventId);
    }
  }

  async function removeBookingFromCalendar(eventId) {
    if (!Calendar) return;
    var map = _loadCalMap();
    var calEventId = map[String(eventId)];
    if (!calEventId) return;

    try {
      await Calendar.deleteEvent({ id: calEventId });
      console.log('[native-cal] removed:', eventId);
    } catch (e) {
      // Event may already be deleted by user — that's fine
      console.log('[native-cal] remove skipped (may not exist):', eventId);
    }
    delete map[String(eventId)];
    _saveCalMap(map);
  }

  // ── Hook into booking / cancel / seat-cancel flows ────────────────

  var _origSubmitBookingNative = window.submitBooking;
  if (_origSubmitBookingNative) {
    window.submitBooking = async function (eventId, slots, btn) {
      await _origSubmitBookingNative.call(this, eventId, slots, btn);
      if (btn.classList.contains('booked')) {
        addBookingToCalendar(eventId);
      }
    };
  }

  var _origConfirmUnbookNative = window.confirmUnbook;
  if (_origConfirmUnbookNative) {
    window.confirmUnbook = async function (bookingId, eventId, btn) {
      await _origConfirmUnbookNative.call(this, bookingId, eventId, btn);
      if (!_myBookings[String(eventId)]) {
        removeBookingFromCalendar(eventId);
      }
    };
  }

  var _origUpcomingCancelNative = window.upcomingCancel;
  if (_origUpcomingCancelNative) {
    window.upcomingCancel = async function (eventId, btn) {
      await _origUpcomingCancelNative.call(this, eventId, btn);
      if (!_myBookings[String(eventId)]) {
        removeBookingFromCalendar(eventId);
      }
    };
  }

  // Seat cancel: booking still exists but title needs updating
  var _origCancelBikeSlotNative = window.cancelBikeSlot;
  if (_origCancelBikeSlotNative) {
    window.cancelBikeSlot = async function (slotId, eventId) {
      await _origCancelBikeSlotNative.call(this, slotId, eventId);
      var booking = _myBookings[String(eventId)];
      if (booking) {
        updateBookingInCalendar(eventId); // still booked, update title
      } else {
        removeBookingFromCalendar(eventId); // all seats cancelled
      }
    };
  }

  var _origUpcomingSeatCancelNative = window.upcomingSeatCancel;
  if (_origUpcomingSeatCancelNative) {
    window.upcomingSeatCancel = async function (eventId, slotId, btn) {
      await _origUpcomingSeatCancelNative.call(this, eventId, slotId, btn);
      var booking = _myBookings[String(eventId)];
      if (booking) {
        updateBookingInCalendar(eventId);
      } else {
        removeBookingFromCalendar(eventId);
      }
    };
  }

  // ── Full Calendar Sync on Startup ─────────────────────────────────

  async function syncAllBookingsToCalendar() {
    var ok = await _ensureCalendarPermission();
    if (!ok) return { added: 0, removed: 0, verified: 0, error: 'Permission denied' };
    var map = _loadCalMap();
    var bookings = _myBookings || {};
    var now = Date.now();
    var summary = { added: 0, removed: 0, verified: 0 };

    // 1. Verify each mapped native event still exists in the calendar.
    //    If the user deleted an event from the Calendar app, the mapping
    //    lies — drop it so step 3 re-creates the event.
    try {
      var q = await Calendar.listEventsInRange({
        startDate: now - 7 * 86400000,
        endDate: now + 120 * 86400000,
      });
      var evs = q.result || q || [];
      if (Array.isArray(evs)) {
        var known = new Set();
        evs.forEach(function (ev) { if (ev && ev.id) known.add(String(ev.id)); });
        var dirty = false;
        for (var mId in map) {
          if (!known.has(String(map[mId]))) {
            delete map[mId];
            dirty = true;
          } else {
            summary.verified++;
          }
        }
        if (dirty) _saveCalMap(map);
      }
    } catch (e) {
      // listEventsInRange may not be supported on some plugin versions —
      // skip verification in that case (add/remove still work).
    }

    // 2. Remove calendar entries for cancelled bookings.
    map = _loadCalMap();
    for (var calEvtId of Object.keys(map)) {
      if (!bookings[calEvtId]) {
        await removeBookingFromCalendar(calEvtId);
        summary.removed++;
      }
    }

    // 3. Add upcoming bookings not yet in the calendar.
    map = _loadCalMap();
    for (var evtId of Object.keys(bookings)) {
      var evt = _eventCache[evtId];
      if (!evt) continue;
      if (new Date(evt.start_at).getTime() < now) continue;
      if (!map[evtId]) {
        var before = Object.keys(_loadCalMap()).length;
        await addBookingToCalendar(evtId);
        var after = Object.keys(_loadCalMap()).length;
        if (after > before) summary.added++;
      }
    }

    // 4. Forget stale mappings (events older than 7 days).
    var cleanedMap = _loadCalMap();
    var staleThreshold = now - 7 * 86400000;
    for (var sEvtId of Object.keys(cleanedMap)) {
      var sEvt = _eventCache[sEvtId];
      if (sEvt && new Date(sEvt.start_at).getTime() < staleThreshold) {
        delete cleanedMap[sEvtId];
      }
    }
    _saveCalMap(cleanedMap);

    console.log('[native-cal] sync result:', summary);
    return summary;
  }

  // Run sync after bookings load
  var _origRenderNative = window.renderMyBookings;
  var _calSynced = false;
  if (_origRenderNative) {
    window.renderMyBookings = function () {
      _origRenderNative.apply(this, arguments);
      if (!_calSynced && calendarSyncEnabled() && Object.keys(_myBookings || {}).length > 0) {
        _calSynced = true;
        syncAllBookingsToCalendar();
      }
    };
  }

  /**
   * Force a fresh sync. Refreshes bookings from the server first so the
   * calendar reflects current state — e.g., classes booked from the web
   * or swapped on another device. Returns the sync summary.
   */
  window.psycleResyncCalendar = async function () {
    _calSynced = false;
    if (typeof fetchMyBookings === 'function') {
      try { await fetchMyBookings(); } catch (e) {}
    }
    return syncAllBookingsToCalendar();
  };

  /**
   * Scan the target calendar for duplicate Psycle events and remove all but
   * one per (title, start-time) group. Returns { scanned, removed }.
   *
   * Used by Settings → "Remove duplicate events" to clean up duplicates
   * created before the dedupe logic was in place.
   */
  window.psycleCleanupDuplicates = async function () {
    if (!Calendar) return { scanned: 0, removed: 0, error: 'Calendar plugin unavailable' };
    var ok = await _ensureCalendarPermission();
    if (!ok) return { scanned: 0, removed: 0, error: 'Permission denied' };

    var calId = await _resolveTargetCalendarId();
    // Scan a wide window (past 7 days through next 90 days) so we catch
    // orphan events from previous sync runs.
    var now = Date.now();
    var rangeStart = now - 7 * 86400000;
    var rangeEnd = now + 90 * 86400000;

    var events = [];
    try {
      var q = await Calendar.listEventsInRange({ startDate: rangeStart, endDate: rangeEnd });
      events = q.result || q || [];
      if (!Array.isArray(events)) events = [];
    } catch (e) {
      return { scanned: 0, removed: 0, error: 'Calendar query failed' };
    }

    // Filter to events in the target calendar (when the plugin reports calendarId).
    // If the plugin omits calendarId, accept everything matching a Psycle title pattern.
    var candidates = events.filter(function (ev) {
      if (!ev || !ev.title) return false;
      if (calId && ev.calendarId && String(ev.calendarId) !== String(calId)) return false;
      return true;
    });

    // Group by "title|startMinute" (round to minute to tolerate plugin drift).
    var groups = {};
    candidates.forEach(function (ev) {
      var start = typeof ev.startDate === 'number' ? ev.startDate : new Date(ev.startDate).getTime();
      var key = ev.title + '|' + Math.floor(start / 60000);
      (groups[key] = groups[key] || []).push({ ev: ev, start: start });
    });

    // For each group with >1 event, keep the one already in our map (if any),
    // otherwise keep the first, and delete the rest.
    var map = _loadCalMap();
    var mappedIds = new Set(Object.values(map).map(String));
    var removed = 0;
    for (var key in groups) {
      var grp = groups[key];
      if (grp.length < 2) continue;
      var keepIdx = grp.findIndex(function (g) { return mappedIds.has(String(g.ev.id)); });
      if (keepIdx < 0) keepIdx = 0;
      for (var i = 0; i < grp.length; i++) {
        if (i === keepIdx) continue;
        var victimId = grp[i].ev.id;
        if (!victimId) continue;
        try {
          await Calendar.deleteEvent({ id: victimId });
          removed++;
          // Remove any stale map entries pointing at the deleted event.
          for (var evtId in map) {
            if (String(map[evtId]) === String(victimId)) delete map[evtId];
          }
        } catch (e) { /* ignore individual failures */ }
      }
    }
    _saveCalMap(map);
    console.log('[native-cal] cleanup:', { scanned: candidates.length, removed: removed });
    return { scanned: candidates.length, removed: removed };
  };

  window.syncAllBookingsToCalendar = syncAllBookingsToCalendar;

  // ── Public API for Settings UI ───────────────────────────────────

  /** List iOS calendars the user can choose from. Returns [{id,title,color,isImmutable}]. */
  window.psycleListCalendars = async function () {
    var ok = await _ensureCalendarPermission();
    if (!ok) return [];
    var list = await _listNativeCalendars();
    return list
      .map(function (c) {
        return {
          id: c.id,
          title: c.title,
          color: c.color || c.hexColor || null,
          isImmutable: !!c.isImmutable,
          isPsycle: c.title === PSYCLE_CAL_TITLE,
        };
      })
      .filter(function (c) { return !c.isImmutable; });
  };

  /** Get the current calendar sync config for the Settings UI. */
  window.psycleGetCalendarConfig = function () {
    return {
      enabled: calendarSyncEnabled(),
      mode: localStorage.getItem(CAL_MODE_KEY) || 'auto',
      targetId: localStorage.getItem(CAL_TARGET_KEY) || null,
      psycleCalendarId: localStorage.getItem(CAL_ID_KEY) || null,
    };
  };

  /**
   * Update the calendar target. When the target changes we delete every
   * event we previously created (regardless of which calendar they're on —
   * EventKit's deleteEvent works by id) and wipe the local mapping, so the
   * next re-sync cleanly re-adds bookings into the new target.
   *
   * Returns { movedFromOld: N } so callers (the Settings UI) can show a hint.
   */
  window.psycleSetCalendarConfig = async function (cfg) {
    cfg = cfg || {};
    var prevMode = localStorage.getItem(CAL_MODE_KEY) || 'auto';
    var prevTarget = localStorage.getItem(CAL_TARGET_KEY) || '';

    if (typeof cfg.enabled === 'boolean') {
      localStorage.setItem(CAL_ENABLED_KEY, cfg.enabled ? '1' : '0');
    }
    if (cfg.mode) localStorage.setItem(CAL_MODE_KEY, cfg.mode);
    if (cfg.mode === 'custom' && cfg.targetId) {
      localStorage.setItem(CAL_TARGET_KEY, String(cfg.targetId));
    }

    var targetChanged =
      (cfg.mode && cfg.mode !== prevMode) ||
      (cfg.mode === 'custom' && String(cfg.targetId || '') !== prevTarget);

    var movedFromOld = 0;
    if (targetChanged) {
      // Delete every previously-created event from the OLD calendar so
      // switching targets doesn't orphan duplicates. EventKit's deleteEvent
      // takes an event id and removes it from whichever calendar holds it,
      // so we don't need to know the old calendar id explicitly.
      var oldMap = _loadCalMap();
      var oldIds = Object.values(oldMap);
      if (oldIds.length && Calendar) {
        await _ensureCalendarPermission();
        await Promise.all(oldIds.map(function (id) {
          return Calendar.deleteEvent({ id: id })
            .then(function () { movedFromOld++; })
            .catch(function () { /* may have been deleted by user */ });
        }));
      }
      localStorage.removeItem(CAL_EVENT_MAP_KEY);
      _calSynced = false;
    }
    return { movedFromOld: movedFromOld };
  };


  // ── Weekly Booking Reminder ─────────────────────────────────────
  // Local notification at 11:59 AM UK time every Monday to signal
  // the new booking week opening at noon.

  var LocalNotifications = Capacitor.Plugins.LocalNotifications;
  var REMINDER_ID = 9999;

  /**
   * Compute the device-local hour that corresponds to 11:59 UK time.
   * UK is UTC+0 in winter (GMT) and UTC+1 in summer (BST).
   */
  function _ukHourInLocalTime(ukHour) {
    // Create a date for next Monday in UK and read the offset
    var now = new Date();
    // Use Intl to get the current UK offset
    try {
      var ukStr = now.toLocaleString('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hour12: false });
      var localStr = now.toLocaleString('en-GB', { hour: 'numeric', hour12: false });
      var ukNow = parseInt(ukStr);
      var localNow = parseInt(localStr);
      var diff = localNow - ukNow; // positive if ahead of UK
      return ukHour + diff;
    } catch (e) {
      // Fallback: assume device is in UK
      return ukHour;
    }
  }

  async function scheduleWeeklyReminder() {
    if (!LocalNotifications) return;

    try {
      var perm = await LocalNotifications.requestPermissions();
      if (perm.display !== 'granted') {
        console.log('[native] notification permission denied');
        return;
      }

      // Cancel existing to reschedule (handles timezone/DST changes)
      try {
        await LocalNotifications.cancel({ notifications: [{ id: REMINDER_ID }] });
      } catch (e) { /* may not exist */ }

      var localHour = _ukHourInLocalTime(11);

      await LocalNotifications.schedule({
        notifications: [{
          id: REMINDER_ID,
          title: 'New booking week opens now',
          body: 'Psycle classes for next week are available — grab your favourite spots!',
          schedule: {
            on: {
              weekday: 2,  // Monday (1=Sunday, 2=Monday)
              hour: localHour,
              minute: 59,
            },
            every: 'week',
            allowWhileIdle: true,
          },
          sound: 'default',
        }],
      });

      console.log('[native] weekly reminder scheduled: Mondays at ' + localHour + ':59 local (11:59 UK)');
    } catch (e) {
      console.warn('[native] failed to schedule weekly reminder:', e);
    }
  }

  // Schedule on every app launch (re-calculates timezone offset for DST)
  setTimeout(scheduleWeeklyReminder, 3000);


  // ── Status Bar ─────────────────────────────────────────────────
  // Set status bar style based on theme

  function updateStatusBar() {
    var theme = document.documentElement.getAttribute('data-theme');
    if (window.Capacitor && Capacitor.Plugins.StatusBar) {
      var StatusBar = Capacitor.Plugins.StatusBar;
      if (theme === 'light') {
        StatusBar.setStyle({ style: 'DARK' }).catch(function () {}); // dark text on light bg
      } else {
        StatusBar.setStyle({ style: 'LIGHT' }).catch(function () {}); // light text on dark bg
      }
    }
  }

  // Watch for theme changes
  var observer = new MutationObserver(function () { updateStatusBar(); });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  updateStatusBar();


  // ═══════════════════════════════════════════════════════════════════
  // Analytics / Diagnostics (developer-only, no third-party services)
  // ═══════════════════════════════════════════════════════════════════

  var ACTION_LOG_NATIVE_KEY = 'psycle_action_log';
  var MAX_NATIVE_ACTION_LOG = 200;

  // Persist action log to Capacitor Preferences (survives iOS storage purges).
  // Hooks into the pushAction function from reliability.js via a wrapper.
  var _origPushAction = window.pushAction;
  if (_origPushAction) {
    window.pushAction = function (action) {
      _origPushAction(action);
      // Also persist to Capacitor Preferences with a larger limit
      _persistActionLogToNative();
    };
  }

  function _persistActionLogToNative() {
    try {
      var log = JSON.parse(localStorage.getItem(ACTION_LOG_NATIVE_KEY) || '[]');
      // Trim to native limit (200)
      if (log.length > MAX_NATIVE_ACTION_LOG) {
        log = log.slice(log.length - MAX_NATIVE_ACTION_LOG);
      }
      Preferences.set({ key: ACTION_LOG_NATIVE_KEY, value: JSON.stringify(log) }).catch(function () {});
    } catch (e) {}
  }

  // Initial persist on startup
  _persistActionLogToNative();

  /**
   * getDiagnosticReport — comprehensive diagnostics string for developer use.
   * Includes: device model, iOS version, app version, action log, error log,
   * localStorage summary.
   */
  window.getDiagnosticReport = async function () {
    var sections = [];
    sections.push('=== Psycle iOS Diagnostic Report ===');
    sections.push('Generated: ' + new Date().toISOString());
    sections.push('');

    // Device info via Capacitor Device plugin (if available)
    var Device = Capacitor.Plugins.Device;
    if (Device) {
      try {
        var info = await Device.getInfo();
        sections.push('--- Device ---');
        sections.push('Model: ' + (info.model || 'unknown'));
        sections.push('Platform: ' + (info.platform || 'unknown'));
        sections.push('OS Version: ' + (info.osVersion || 'unknown'));
        sections.push('Manufacturer: ' + (info.manufacturer || 'unknown'));
        sections.push('Is Virtual: ' + (info.isVirtual || false));
        sections.push('');
      } catch (e) {
        sections.push('--- Device ---');
        sections.push('(Device plugin unavailable)');
        sections.push('');
      }
    }

    // App info
    var AppInfo = Capacitor.Plugins.App;
    if (AppInfo) {
      try {
        var appInfo = await AppInfo.getInfo();
        sections.push('--- App ---');
        sections.push('App Name: ' + (appInfo.name || 'unknown'));
        sections.push('App Version: ' + (appInfo.version || 'unknown'));
        sections.push('Build: ' + (appInfo.build || 'unknown'));
        sections.push('Bundle ID: ' + (appInfo.id || 'unknown'));
        sections.push('');
      } catch (e) {
        sections.push('--- App ---');
        sections.push('(App plugin unavailable)');
        sections.push('');
      }
    }

    // Screen / viewport
    sections.push('--- Display ---');
    sections.push('Screen: ' + screen.width + 'x' + screen.height);
    sections.push('Viewport: ' + window.innerWidth + 'x' + window.innerHeight);
    sections.push('Pixel Ratio: ' + (window.devicePixelRatio || 1));
    sections.push('Theme: ' + (document.documentElement.getAttribute('data-theme') || 'unknown'));
    sections.push('Online: ' + navigator.onLine);
    sections.push('');

    // Action log
    sections.push('--- Action Log ---');
    try {
      var actionLog = JSON.parse(localStorage.getItem(ACTION_LOG_NATIVE_KEY) || '[]');
      if (actionLog.length === 0) {
        sections.push('(empty)');
      } else {
        actionLog.forEach(function (entry) {
          sections.push('[' + entry.timestamp + '] ' + entry.action);
        });
      }
    } catch (e) {
      sections.push('(could not read action log)');
    }
    sections.push('');

    // Error log
    sections.push('--- Error Log ---');
    if (typeof window.getErrorLog === 'function') {
      var errors = window.getErrorLog();
      if (errors.length === 0) {
        sections.push('(empty)');
      } else {
        errors.forEach(function (entry) {
          sections.push('[' + entry.timestamp + '] ' + entry.message);
        });
      }
    } else {
      sections.push('(error log function not available)');
    }
    sections.push('');

    // localStorage summary (key names + byte counts only)
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

    return sections.join('\n');
  };


  console.log('[native] Native bridge initialized');
})();
