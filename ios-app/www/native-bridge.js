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
    // AES key backup (written by security.js on native only). Without it an
    // IndexedDB purge makes the mirrored _enc ciphertext undecryptable and
    // the user is silently signed out forever.
    'psycle_sec_key_backup',
    'psycle_fav_instructors', 'psycle_saved_filters',
    'psycle_instructor_tiers', 'psycle_bike_prefs',
    'psycle_theme', 'psycle_class_history', 'psycle_history_synced',
    'psycle_notify_watchlist', 'psycle_calendar_data',
    'psycle_error_log', 'psycle_offline_queue', 'psycle_action_log',
    'psycle_waitlisted_events', 'psycle_weekly_template',
    'psycle_bike_history', 'psycle_recent_searches', 'psycle_onboarded_v1',
    'psycle_weekly_reminder', 'psycle_class_reminders',
    // Calendar integration state — must survive iOS storage purges
    // or duplicates are created on the next full sync.
    'psycle_native_cal_events', 'psycle_native_cal_id',
    'psycle_calendar_target_id', 'psycle_calendar_mode',
    'psycle_calendar_enabled', 'psycle_calendar_owned_ack',
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

  // Restore on startup. security.js's securityReady WAITS on this flag
  // before reading localStorage (token ciphertext + AES key backup) — an
  // unordered race meant a post-purge launch read an empty store and showed
  // "Sign in" even though the token was restored milliseconds later. Set
  // the flag even on failure so startup can never hang on it.
  window._psycleNativeRestoreDone = false;
  restoreFromNative()
    .catch(function () {})
    .then(function () {
      window._psycleNativeRestoreDone = true;
      // Resolve the handshake promise security.js created (it loads first).
      if (typeof window._psycleNativeRestoreResolve === 'function') {
        window._psycleNativeRestoreResolve();
      }
    });


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
  // '1' once the user has picked/confirmed the target under the full-ownership
  // contract — only then may the reconcile delete events WITHOUT our marker.
  var CAL_OWNED_ACK_KEY = 'psycle_calendar_owned_ack';
  var PSYCLE_CAL_TITLE = 'Psycle';
  var PSYCLE_CAL_COLOR = '#e94560';
  var PSYCLE_EVENT_MARKER = 'psycle-event-id:'; // stable owner tag in event notes for safe orphan removal

  function _loadCalMap() {
    try { return JSON.parse(localStorage.getItem(CAL_EVENT_MAP_KEY) || '{}'); } catch (e) { return {}; }
  }
  function _saveCalMap(map) {
    localStorage.setItem(CAL_EVENT_MAP_KEY, JSON.stringify(map));
  }

  /**
   * Slot label for a class type. Delegates to app.js's slotLabel (same page,
   * loaded earlier) so the calendar/widget noun can never drift from the UI;
   * the inline fallback only covers a missing global.
   */
  function _nativeSlotLabel(typeName) {
    if (typeof window.slotLabel === 'function') return window.slotLabel(typeName);
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

  // Has the user explicitly chosen a calendar to write into? We NEVER
  // auto-create or presume a calendar — nothing is written until a pick.
  function hasChosenCalendar() {
    return localStorage.getItem(CAL_MODE_KEY) === 'custom' && !!localStorage.getItem(CAL_TARGET_KEY);
  }

  async function _resolveTargetCalendarId() {
    // Only an explicitly user-picked calendar is ever used — no auto-create,
    // no implicit system-default write. Returns null when nothing is chosen or
    // the chosen calendar no longer exists (callers must then write nothing).
    if (localStorage.getItem(CAL_MODE_KEY) !== 'custom') return null;
    var target = localStorage.getItem(CAL_TARGET_KEY);
    if (!target) return null;
    var list = await _listNativeCalendars();
    return list.some(function (c) { return String(c.id) === String(target); }) ? target : null;
  }

  // ── Add / Update / Remove Events ─────────────────────────────────

  function _buildCalEventData(eventId) {
    var evt = (_eventCache || {})[String(eventId)];
    if (!evt) return null;
    var booking = (_myBookings || {})[String(eventId)];
    if (!booking) return null;
    // A waitlist place is not a confirmed class — never put it in the
    // calendar as if the user had a seat.
    if (booking.waitlisted) return null;

    var start = new Date(String(evt.start_at).replace(' ', 'T'));
    if (isNaN(start.getTime())) start = new Date(evt.start_at);
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
    desc.push(PSYCLE_EVENT_MARKER + eventId);

    // Field names match the installed @ebarooni/capacitor-calendar v6 API:
    // `notes` (NOT `description`) and `alertOffsetInMinutes` (NOT `alerts`).
    // The old names were silently ignored — events carried no ownership
    // marker and no reminders.
    return {
      title: title,
      location: location,
      startDate: start.getTime(),
      endDate: end.getTime(),
      notes: desc.join('\n'),
      isAllDay: false,
      alertOffsetInMinutes: [-60, -15], // 1 hour and 15 minutes before class
    };
  }

  // ── v6-plugin-correct primitives ─────────────────────────────────

  /** Extract the Psycle event id from a native event's notes, or null. */
  function _markerEventId(ev) {
    var notes = (ev && (ev.notes || ev.description)) || '';
    var m = /psycle-event-id:(\d+)/.exec(notes);
    return m ? m[1] : null;
  }

  /** Millisecond start time of a native event, across plugin shapes. */
  function _nativeStartMs(ev) {
    return typeof ev.startDate === 'number' ? ev.startDate : new Date(ev.startDate).getTime();
  }

  /** The created-event id from a createEvent() result, across versions.
   *  v6 returns { result: "<id string>" } — the old `(result.result||result).id`
   *  parse yielded undefined, so no event was ever recorded in the map and
   *  every sync re-created every event (the "massive duplication" bug). */
  function _createdEventId(result) {
    if (!result) return null;
    if (typeof result === 'string') return result;
    if (typeof result.result === 'string') return result.result;
    var r = result.result || result;
    return (r && (r.id || r.eventId)) || null;
  }

  /** Delete native events by id. v6 has deleteEventsById({ids}) ONLY —
   *  the old code called a nonexistent deleteEvent({id}), which threw and
   *  was swallowed, so nothing was EVER deleted (cancel cleanup, target
   *  switches, orphan sweeps and duplicate cleanup were all no-ops). */
  async function _deleteNativeEvents(ids) {
    ids = (ids || []).filter(Boolean).map(String);
    if (!Calendar || ids.length === 0) return 0;
    try {
      var res = await Calendar.deleteEventsById({ ids: ids });
      var out = (res && res.result) || {};
      return (out.deleted && out.deleted.length) || ids.length;
    } catch (e) {
      // Older/newer plugin versions: fall back to per-id deleteEvent.
      var n = 0;
      for (var i = 0; i < ids.length; i++) {
        try { await Calendar.deleteEvent({ id: ids[i] }); n++; } catch (e2) {}
      }
      return n;
    }
  }

  /** Normalized listEventsInRange (ms timestamps in, array out). */
  async function _listNativeEvents(startMs, endMs) {
    if (!Calendar) return [];
    var q = await Calendar.listEventsInRange({ startDate: startMs, endDate: endMs });
    var events = (q && q.result) || q || [];
    return Array.isArray(events) ? events : [];
  }

  function calendarSyncEnabled() {
    return localStorage.getItem(CAL_ENABLED_KEY) !== '0';
  }

  // (No incremental add/remove functions: every mutation flows through the
  // authoritative reconcile below, so there is exactly one code path that
  // writes to the calendar.)

  // ── Hook into booking / cancel / seat-cancel flows ────────────────
  // Every mutation routes through ONE debounced, single-flight reconcile
  // (_scheduleCalReconcile → syncAllBookingsToCalendar). The reconcile is
  // authoritative over the whole target calendar, so adds, removes, slot
  // swaps and title changes are all the same operation — no per-hook
  // add/remove races, no duplicate writes.

  var _origSubmitBookingNative = window.submitBooking;
  if (_origSubmitBookingNative) {
    // Forward ALL args — the 4th (opts, { waitlist: true }) drives the
    // waitlist flow and must survive the wrapper chain.
    window.submitBooking = async function () {
      await _origSubmitBookingNative.apply(this, arguments);
      _scheduleCalReconcile();
    };
  }

  var _origConfirmUnbookNative = window.confirmUnbook;
  if (_origConfirmUnbookNative) {
    window.confirmUnbook = async function () {
      await _origConfirmUnbookNative.apply(this, arguments);
      _scheduleCalReconcile();
    };
  }

  var _origUpcomingCancelNative = window.upcomingCancel;
  if (_origUpcomingCancelNative) {
    window.upcomingCancel = async function () {
      await _origUpcomingCancelNative.apply(this, arguments);
      _scheduleCalReconcile();
    };
  }

  var _origCancelBikeSlotNative = window.cancelBikeSlot;
  if (_origCancelBikeSlotNative) {
    window.cancelBikeSlot = async function () {
      await _origCancelBikeSlotNative.apply(this, arguments);
      _scheduleCalReconcile();
    };
  }

  var _origUpcomingSeatCancelNative = window.upcomingSeatCancel;
  if (_origUpcomingSeatCancelNative) {
    window.upcomingSeatCancel = async function () {
      await _origUpcomingSeatCancelNative.apply(this, arguments);
      _scheduleCalReconcile();
    };
  }

  // ── Full Calendar Reconcile ───────────────────────────────────────
  //
  // CONTRACT: the calendar the user picks is FULLY Psync-owned — the app may
  // freely delete and rewrite anything in it. That makes sync a simple
  // authoritative reconcile instead of incremental add/remove bookkeeping:
  //
  //   desired = upcoming, non-waitlisted bookings
  //   actual  = every FUTURE event in the target calendar
  //   → delete every future event that doesn't match a desired booking
  //     (this self-cleans all historical duplicates on the first run)
  //   → create whatever's missing
  //   → events whose slot/title changed are deleted + recreated
  //
  // Past events are left untouched (they're the user's workout history).
  // The eventId↔nativeId map is rebuilt from scratch each pass — it's a
  // cache, never a correctness requirement, so map loss can't duplicate.

  async function syncAllBookingsToCalendar() {
    if (!calendarSyncEnabled() || !hasChosenCalendar()) {
      return { added: 0, removed: 0, kept: 0, error: 'No calendar selected' };
    }
    // Signed out ≠ no bookings: never treat a logged-out session as "delete
    // every event". The calendar reconciles again after the next sign-in.
    if (typeof getBearerToken === 'function' && !getBearerToken()) {
      return { added: 0, removed: 0, kept: 0, skipped: 'signed out' };
    }
    var ok = await _ensureCalendarPermission();
    if (!ok) return { added: 0, removed: 0, kept: 0, error: 'Permission denied' };
    var calId = await _resolveTargetCalendarId();
    if (!calId) return { added: 0, removed: 0, kept: 0, error: 'Chosen calendar missing' };

    var bookings = _myBookings || {};
    var now = Date.now();
    var summary = { added: 0, removed: 0, kept: 0 };

    // An empty snapshot is only trusted when the server confirmed it (the
    // bookings:loaded listener flags that). Otherwise skip: a signed-out
    // wipe or not-yet-fetched state must not read as "delete everything".
    // The confirmed-empty case MUST reconcile — cancelling your last
    // remaining booking is exactly when its calendar event needs removing.
    if (Object.keys(bookings).length === 0 && !_calServerConfirmedEmpty) {
      return { added: 0, removed: 0, kept: 0, skipped: 'unconfirmed empty bookings snapshot' };
    }

    // Desired end-state: future, non-waitlisted bookings we have data for.
    var desired = {}; // eventId -> built event data
    Object.keys(bookings).forEach(function (evtId) {
      var data = _buildCalEventData(evtId); // null for waitlisted/unknown
      if (data && data.startDate > now) desired[String(evtId)] = data;
    });

    // Actual state: every FUTURE event currently in the target calendar.
    var events;
    try {
      events = await _listNativeEvents(now, now + 120 * 86400000);
    } catch (e) {
      return { added: 0, removed: 0, kept: 0, error: 'calendar query failed' };
    }

    // Full-ownership deletes (removing events WITHOUT our marker) only after
    // the user has picked/confirmed the calendar under the new contract —
    // a target chosen before this contract shipped may hold personal events,
    // and those must never be destroyed without an explicit user action.
    var ownedAck = localStorage.getItem(CAL_OWNED_ACK_KEY) === '1';

    var newMap = {};
    var victims = [];
    var satisfied = {}; // eventId -> true (a matching native event exists)

    events.forEach(function (ev) {
      if (!ev) return;
      var markerId = _markerEventId(ev);
      // Attribution guard: other calendars are NEVER touched. If the plugin
      // didn't report a calendarId, only events carrying our ownership
      // marker are considered — unattributable events are left alone.
      if (ev.calendarId != null) {
        if (String(ev.calendarId) !== String(calId)) return;
      } else if (!markerId) {
        return;
      }
      var nid = ev.id || ev.eventId;
      if (!nid) return;
      if (!markerId && !ownedAck) return; // pre-contract target: leave unmarked events alone
      var booking = markerId ? bookings[markerId] : null;
      if (markerId && !satisfied[markerId]) {
        var want = desired[markerId];
        if (want) {
          // Same class still booked — keep it only if title and start still
          // match (a slot swap or time change means delete + recreate).
          var sameStart = Math.abs(_nativeStartMs(ev) - want.startDate) < 60 * 1000;
          if (sameStart && ev.title === want.title) {
            satisfied[markerId] = true;
            newMap[markerId] = nid;
            summary.kept++;
            return;
          }
        } else if (booking && !booking.waitlisted) {
          // Still booked but we couldn't build its event data this pass
          // (e.g. a transient /events/{id} failure left _eventCache empty).
          // NEVER delete a live booking's event over missing metadata.
          satisfied[markerId] = true;
          newMap[markerId] = nid;
          summary.kept++;
          return;
        }
      }
      // Everything else in a Psync-owned calendar — cancelled classes,
      // duplicates, stale slot titles, unmarked strays from the buggy era —
      // gets removed.
      victims.push(nid);
    });

    if (victims.length) {
      summary.removed = await _deleteNativeEvents(victims);
    }

    // Create what's missing (concurrently — each create is an independent
    // EventKit bridge call), then persist the rebuilt map once.
    var missingIds = Object.keys(desired).filter(function (id) { return !satisfied[id]; });
    await Promise.all(missingIds.map(function (evtId) {
      var data = desired[evtId];
      data.calendarId = calId;
      return Calendar.createEvent(data)
        .then(function (result) {
          var nativeId = _createdEventId(result);
          if (nativeId) newMap[evtId] = nativeId;
          summary.added++;
        })
        .catch(function (e) { console.warn('[native-cal] create failed:', evtId, e); });
    }));
    _saveCalMap(newMap);

    console.log('[native-cal] reconcile:', summary);
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
        _scheduleCalReconcile(); // shared debounce+guard with the bookings:loaded listener (no double-sync)
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
    // An explicit user-triggered resync (Settings button) confirms the
    // full-ownership contract for the current target.
    if (hasChosenCalendar()) {
      try { localStorage.setItem(CAL_OWNED_ACK_KEY, '1'); } catch (e) {}
    }
    if (typeof fetchMyBookings === 'function') {
      try { await fetchMyBookings(); } catch (e) {}
    }
    clearTimeout(_calReconcileTimer); // fetchMyBookings armed a debounced run — run once here instead
    return _runCalSync();
  };

  /**
   * Settings → "Remove duplicates". The authoritative reconcile already
   * deletes every future event that doesn't correspond to exactly one
   * current booking — duplicates, orphans and stale titles included — so
   * this simply forces a fresh reconcile (with a bookings refresh first).
   */
  window.psycleCleanupDuplicates = async function () {
    if (!Calendar) return { scanned: 0, removed: 0, error: 'Calendar plugin unavailable' };
    var res = await window.psycleResyncCalendar();
    res = res || {};
    return { scanned: (res.kept || 0) + (res.removed || 0), removed: res.removed || 0, error: res.error };
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
      mode: localStorage.getItem(CAL_MODE_KEY) || 'unset',
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
    var prevMode = localStorage.getItem(CAL_MODE_KEY) || 'unset';
    var prevTarget = localStorage.getItem(CAL_TARGET_KEY) || '';

    if (typeof cfg.enabled === 'boolean') {
      localStorage.setItem(CAL_ENABLED_KEY, cfg.enabled ? '1' : '0');
    }
    if (cfg.mode) localStorage.setItem(CAL_MODE_KEY, cfg.mode);
    if (cfg.mode === 'custom' && cfg.targetId) {
      localStorage.setItem(CAL_TARGET_KEY, String(cfg.targetId));
      // Picking a calendar in the Settings UI (which states the ownership
      // contract) is the explicit consent for full-ownership reconciles.
      localStorage.setItem(CAL_OWNED_ACK_KEY, '1');
    }

    var targetChanged =
      (cfg.mode && cfg.mode !== prevMode) ||
      (cfg.mode === 'custom' && String(cfg.targetId || '') !== prevTarget);

    var movedFromOld = 0;
    if (targetChanged) {
      // The OLD calendar was fully Psync-owned while it was the target —
      // clear every future event out of it (mapped ids AND anything the map
      // lost track of), so switching never strands duplicates behind.
      if (Calendar) {
        await _ensureCalendarPermission();
        var oldIds = Object.values(_loadCalMap()).map(String);
        var victims = {};
        oldIds.forEach(function (id) { victims[id] = true; });
        if (prevTarget) {
          try {
            var now = Date.now();
            var evs = await _listNativeEvents(now, now + 120 * 86400000);
            evs.forEach(function (ev) {
              if (!ev) return;
              // Same attribution guard as the reconcile: without a reported
              // calendarId, only delete events carrying our marker.
              if (ev.calendarId != null) {
                if (String(ev.calendarId) !== String(prevTarget)) return;
              } else if (!_markerEventId(ev)) {
                return;
              }
              var nid = ev.id || ev.eventId;
              if (nid) victims[String(nid)] = true;
            });
          } catch (e) { /* fall back to mapped ids only */ }
        }
        movedFromOld = await _deleteNativeEvents(Object.keys(victims));
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
  // Eight rolling one-shot notifications (the next 8 Mondays). Absolute `at:`
  // times are used instead of an hour-of-day repeat: the old hour-offset
  // math broke whenever the device's calendar DATE differed from London's
  // (e.g. a New York Monday evening computed `hour: 30` — a reminder that
  // never fires). Rescheduled on every launch, so the window keeps rolling;
  // eight weeks covers long stretches without opening the app.
  var REMINDER_IDS = [9999, 9998, 9997, 9996, 9995, 9994, 9993, 9992];

  /**
   * The next `count` occurrences of Monday 11:59 Europe/London as absolute
   * Date instants, DST-correct for any device timezone.
   */
  function _nextMondays1159London(count) {
    var DAY = 86400000;
    var out = [];
    try {
      var dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
      var wdFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short' });
      var hmFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false });

      // Exact UTC instant of 11:59 London on a given London calendar date:
      // start from 11:59 UTC and correct by whatever offset London reports.
      var instantFor = function (dateStr) {
        var p = dateStr.split('-').map(Number);
        var guess = Date.UTC(p[0], p[1] - 1, p[2], 11, 59, 0);
        for (var k = 0; k < 3; k++) {
          var hm = hmFmt.format(new Date(guess)).split(':').map(Number);
          var deltaMin = (hm[0] * 60 + hm[1]) - (11 * 60 + 59);
          if (deltaMin === 0) break;
          guess -= deltaMin * 60000;
        }
        return guess;
      };

      var now = Date.now();
      for (var d = 0; d < 7 * (count + 1) + 2 && out.length < count; d++) {
        var probe = new Date(now + d * DAY);
        if (wdFmt.format(probe) !== 'Mon') continue;
        var ts = instantFor(dateFmt.format(probe));
        if (ts > now + 60000) out.push(new Date(ts));
      }
    } catch (e) { /* Intl/timezone unavailable — fall through */ }
    if (out.length === 0) out.push(new Date(Date.now() + 7 * DAY)); // defensive
    return out;
  }

  var REMINDER_PREF = 'psycle_weekly_reminder'; // 'on' | 'off' | unset (off)

  async function _cancelReminders() {
    try {
      await LocalNotifications.cancel({
        notifications: REMINDER_IDS.map(function (id) { return { id: id }; }),
      });
    } catch (e) { /* may not exist */ }
  }

  /**
   * @param interactive true = user just asked for this, OK to show the
   *   iOS permission prompt. false = silent launch-time reschedule that
   *   must NEVER prompt (checkPermissions only).
   */
  async function scheduleWeeklyReminder(interactive) {
    if (!LocalNotifications) return false;

    try {
      var perm = interactive
        ? await LocalNotifications.requestPermissions()
        : await LocalNotifications.checkPermissions();
      if (perm.display !== 'granted') {
        console.log('[native] notification permission not granted');
        return false;
      }

      // Cancel existing to reschedule (handles timezone/DST changes)
      await _cancelReminders();

      var mondays = _nextMondays1159London(REMINDER_IDS.length);
      await LocalNotifications.schedule({
        notifications: mondays.map(function (at, i) {
          return {
            id: REMINDER_IDS[i],
            title: 'New booking week opens now',
            body: 'Psycle classes for next week are available — grab your favourite spots!',
            schedule: { at: at, allowWhileIdle: true },
            sound: 'default',
          };
        }),
      });

      console.log('[native] weekly reminders scheduled for: ' +
        mondays.map(function (d) { return d.toISOString(); }).join(', '));
      return true;
    } catch (e) {
      console.warn('[native] failed to schedule weekly reminder:', e);
      return false;
    }
  }

  // Exposed to the web layer (Membership tab toggle). The permission
  // prompt only ever appears from enable() — a deliberate user action —
  // never at app launch.
  window._nativeReminder = {
    isOn: function () { return localStorage.getItem(REMINDER_PREF) === 'on'; },
    enable: async function () {
      var ok = await scheduleWeeklyReminder(true);
      if (ok) localStorage.setItem(REMINDER_PREF, 'on');
      return ok;
    },
    disable: async function () {
      localStorage.setItem(REMINDER_PREF, 'off');
      await _cancelReminders();
    },
  };

  // Launch-time reschedule (recalculates timezone offset for DST) — only
  // for users who already opted in, and never prompting.
  setTimeout(function () {
    if (localStorage.getItem(REMINDER_PREF) === 'on') scheduleWeeklyReminder(false);
  }, 3000);


  // ── Notification Action Buttons (Book / Cancel / Snooze) ────────
  // Register an actionable notification CATEGORY with the Capacitor
  // LocalNotifications plugin. On iOS the plugin turns each action type
  // into a UNNotificationCategory whose UNNotificationActions render as
  // the swipe-down / long-press buttons on the banner.
  //
  // To use it, schedule a notification with `actionTypeId: 'PSYCLE_CLASS'`
  // and an `extra: { eventId }` payload; the listener below routes taps.
  // (The native-only equivalent — registering the category in Swift via
  // UNUserNotificationCenter — is documented in
  // PsycleIntents/NotificationCategories.swift for non-Capacitor paths.)

  function registerNotificationActions() {
    if (!LocalNotifications || typeof LocalNotifications.registerActionTypes !== 'function') return;
    LocalNotifications.registerActionTypes({
      types: [{
        id: 'PSYCLE_CLASS',
        actions: [
          { id: 'BOOK',   title: 'Book' },
          { id: 'CANCEL', title: 'Cancel',  destructive: true },
          // foreground:false keeps the app backgrounded for a quick snooze.
          { id: 'SNOOZE', title: 'Snooze',  foreground: false },
        ],
      }],
    }).catch(function () {});
  }

  // Route a tapped action button to the right web-app flow. The web layer
  // owns booking/cancel (auth + slot picker), so we surface the eventId and
  // let app.js handle it; SNOOZE re-schedules a one-off reminder natively.
  function handleNotificationAction(notification) {
    try {
      var actionId = notification.actionId;
      var data = (notification.notification && notification.notification.extra) || {};
      var eventId = data.eventId;
      if (actionId === 'SNOOZE') {
        // Re-fire in 1 hour without involving the web layer.
        try {
          LocalNotifications.schedule({
            notifications: [{
              id: Math.floor(Math.random() * 100000) + 1,
              title: notification.notification.title || 'Psycle reminder',
              body: notification.notification.body || '',
              schedule: { at: new Date(Date.now() + 60 * 60 * 1000) },
              actionTypeId: 'PSYCLE_CLASS',
              extra: data,
            }],
          }).catch(function () {});
        } catch (e) {}
        return;
      }
      // BOOK / CANCEL / default tap → hand off to the web app if it exposes
      // a handler; otherwise just deep-link by stashing the intent.
      if (typeof window.handleNotificationIntent === 'function') {
        window.handleNotificationIntent(actionId || 'TAP', eventId, data);
      } else {
        try {
          sessionStorage.setItem('psycle_pending_notification_action',
            JSON.stringify({ actionId: actionId || 'TAP', eventId: eventId, data: data }));
        } catch (e) {}
      }
    } catch (e) {
      try { console.warn('[native-notif] action handling failed:', e); } catch (_) {}
    }
  }

  if (LocalNotifications) {
    registerNotificationActions();
    try {
      LocalNotifications.addListener('localNotificationActionPerformed', handleNotificationAction);
    } catch (e) {}
  }


  // ── Widget / Live Activity / Siri Snapshot ─────────────────────
  // Compute a compact "next class" + "this week" snapshot from the app
  // state (_myBookings + _eventCache, already populated/synced) and write
  // it to Capacitor Preferences. The WidgetKit timeline provider, the
  // ActivityKit Live Activity, and the "What's my next class?" App Intent
  // all read these keys from the SHARED UserDefaults(suiteName: appGroup).
  //
  // IMPORTANT (Capacitor ↔ native mapping — verified against the installed
  // @capacitor/preferences v6 source):
  //   The standard Preferences plugin writes to UserDefaults.STANDARD with
  //   the configured "group" as a KEY PREFIX ("<group>.<key>"). It never
  //   touches UserDefaults(suiteName:) — so nothing it writes is readable
  //   by an app extension, regardless of what the group is named.
  //   The LIVE path to the widget/Live Activity/intent is therefore the
  //   in-app AppGroupPreferences plugin (App/AppGroupPreferences.swift),
  //   which _appGroupSet() below calls to write the BARE keys into the real
  //   shared suite UserDefaults(suiteName: WIDGET_APP_GROUP).
  //   See NATIVE_FEATURES.md (status block) for the full story.

  // App Group container id. MUST match the App Group capability you add in
  // Xcode to BOTH the main app target and every extension target. This is a
  // placeholder — change it (here and in every Swift file) if you use a
  // different id, then re-run `npm run sync`.
  var WIDGET_APP_GROUP = 'group.com.psyclefinder.app';

  var WIDGET_NEXT_KEY = 'widget_next_class';
  var WIDGET_WEEK_KEY = 'widget_week';
  // Next few classes (same shape as widget_next_class, array of up to 5) so
  // the widget can build a MULTI-ENTRY timeline and roll to the next class
  // by itself when one starts — without this it sat on a passed class until
  // the app next ran.
  var WIDGET_UPCOMING_KEY = 'widget_upcoming';

  // Standard Preferences plugin: lands in UserDefaults.standard under
  // "<group>.<key>" (NOT extension-readable — kept for in-app consumers
  // and diagnostics). Always available (web build excluded earlier).
  function _prefSet(key, value) {
    try { Preferences.set({ key: key, value: value }).catch(function () {}); } catch (e) {}
  }

  // App Group mirror: writes the SAME logical value under the BARE key into
  // the shared App Group suite, so a native extension can read it directly
  // with UserDefaults(suiteName: WIDGET_APP_GROUP).string(forKey: key).
  //
  // We can only reach the App Group suite natively. If a Capacitor plugin
  // that exposes the App Group is present (custom or community), use it;
  // otherwise this is a no-op and the snapshot still lands in the standard
  // Preferences suite. NATIVE_FEATURES.md documents pointing Capacitor
  // Preferences directly at the App Group suite as the simplest wiring.
  function _appGroupSet(key, value) {
    try {
      var AppGroup = Capacitor.Plugins.AppGroupPreferences || Capacitor.Plugins.SharedPreferences;
      if (AppGroup && typeof AppGroup.set === 'function') {
        AppGroup.set({ group: WIDGET_APP_GROUP, key: key, value: value }).catch(function () {});
      }
    } catch (e) {}
  }

  function _writeSnapshotKey(key, value) {
    _prefSet(key, value);
    _appGroupSet(key, value);
  }

  // Resolve a display-ready event object from the cache, or null.
  function _snapshotEventFor(eventId) {
    try {
      var evt = (_eventCache || {})[String(eventId)];
      if (!evt || !evt.start_at) return null;
      var booking = (_myBookings || {})[String(eventId)];
      var slots = (booking && Array.isArray(booking.slots)) ? booking.slots.slice() : [];
      return {
        eventId: String(eventId),
        // The API emits 'YYYY-MM-DD HH:MM:SS'; PsycleDateParser on the Swift
        // side needs the ISO 'T' form — normalize BEFORE persisting or the
        // widget countdown and Live Activity silently never work.
        startAt: String(evt.start_at).replace(' ', 'T'),
        instrName: evt._instrName || '',
        typeName: evt._typeName || 'Class',
        studioName: evt._studioName || '',
        locName: evt._locName || evt._locFullName || '',
        slots: slots,
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * Recompute the widget snapshot from current app state and persist it.
   * Defensive: never throws. Safe to call before state exists (writes null).
   */
  // Only trust an EMPTY bookings map after the server confirmed it
  // (bookings:loaded fired this session). The 4s post-launch pass runs
  // before the bookings fetch completes on a cold start — writing an empty
  // snapshot then would blank the widget, destroy the stale-but-valid data
  // the Live Activity relies on, and the refresh nudge would retract a
  // card that was just correctly started. That was exactly the "opened the
  // app in the window, no card" failure.
  var _snapServerConfirmed = false;

  function updateWidgetSnapshot() {
    try {
      var bookings = (typeof _myBookings !== 'undefined' && _myBookings) ? _myBookings : {};
      var cache = (typeof _eventCache !== 'undefined' && _eventCache) ? _eventCache : {};
      if (Object.keys(bookings).length === 0 && !_snapServerConfirmed) return;
      var now = Date.now();

      // Collect upcoming booked events (have a cache entry + future start).
      // Waitlist places are NOT confirmed seats — the widget must not show
      // one as "Next class". start_at may be 'YYYY-MM-DD HH:MM:SS', which
      // iOS WebKit won't parse without the space→T normalization.
      var upcoming = [];
      for (var id in bookings) {
        if (!Object.prototype.hasOwnProperty.call(bookings, id)) continue;
        if (bookings[id] && bookings[id].waitlisted) continue;
        var evt = cache[String(id)];
        if (!evt || !evt.start_at) continue;
        var ts = new Date(String(evt.start_at).replace(' ', 'T')).getTime();
        if (isNaN(ts) || ts < now) continue;
        upcoming.push({ id: id, ts: ts });
      }
      upcoming.sort(function (a, b) { return a.ts - b.ts; });

      // 1) Next class snapshot (or null when nothing upcoming).
      var next = upcoming.length ? _snapshotEventFor(upcoming[0].id) : null;
      _writeSnapshotKey(WIDGET_NEXT_KEY, JSON.stringify(next));

      // 1b) The next few classes for the widget's self-advancing timeline.
      var upcomingList = [];
      for (var ui = 0; ui < upcoming.length && upcomingList.length < 5; ui++) {
        var snap = _snapshotEventFor(upcoming[ui].id);
        if (snap) upcomingList.push(snap);
      }
      _writeSnapshotKey(WIDGET_UPCOMING_KEY, JSON.stringify(upcomingList));

      // Backstop for the Live Activity's foreground-only constraint: a
      // local notification 90 minutes before each class. Tapping it opens
      // the app, which starts the countdown card.
      _scheduleClassReminders(upcomingList);

      // 2) This-week buckets: next 7 days from now, one entry per day that
      //    has >=1 booking, with the day's first start time.
      var byDay = {};
      for (var i = 0; i < upcoming.length; i++) {
        var u = upcoming[i];
        if (u.ts > now + 7 * 86400000) break; // sorted — rest are further out
        var d = new Date(u.ts);
        // Local YYYY-MM-DD key (avoid UTC shifting the day).
        var dayKey = d.getFullYear() + '-' +
          String(d.getMonth() + 1).padStart(2, '0') + '-' +
          String(d.getDate()).padStart(2, '0');
        if (!byDay[dayKey]) {
          // Same space→T normalization as startAt above.
          byDay[dayKey] = { day: dayKey, count: 0, firstStart: String(cache[String(u.id)].start_at).replace(' ', 'T') };
        }
        byDay[dayKey].count++;
      }
      var week = Object.keys(byDay).sort().map(function (k) { return byDay[k]; });
      _writeSnapshotKey(WIDGET_WEEK_KEY, JSON.stringify(week));

      // Hint the native side to reload widget timelines, if a reload plugin
      // is wired up. No-op otherwise. (See NATIVE_FEATURES.md.)
      try {
        var WC = Capacitor.Plugins.WidgetCenter || Capacitor.Plugins.WidgetReloader;
        if (WC && typeof WC.reloadAllTimelines === 'function') {
          WC.reloadAllTimelines().catch(function () {});
        }
      } catch (e) {}

      // Nudge the Live Activity reconcile too — the native foreground hook
      // (didBecomeActive) runs BEFORE this fresh snapshot exists, so without
      // this call the countdown card would only appear on the NEXT app open.
      try {
        var LA = Capacitor.Plugins.PsycleLiveActivity;
        if (LA && typeof LA.refresh === 'function') {
          LA.refresh().catch(function () {});
        }
      } catch (e) {}
    } catch (e) {
      // Last-resort guard: never let snapshot computation break the app.
      try { console.warn('[native-widget] snapshot failed:', e); } catch (_) {}
    }
  }
  window.updateWidgetSnapshot = updateWidgetSnapshot;

  // ── Class-start reminders (T-90 minutes) ─────────────────────────
  // iOS only lets the app START a Live Activity while foregrounded, so a
  // phone that never opens the app in the 90-minute window gets no card.
  // These notifications close that gap: fire at start-90min, tap → app
  // opens → didBecomeActive + snapshot nudge start the card.
  //
  // Permission-gated (never prompts on its own — the toggle's enable()
  // prompts) and idempotent per snapshot pass: stale reminders (cancelled
  // or moved classes) are cancelled, missing ones scheduled. IDs live in
  // the 8000–8899 range (weekly reminder owns 9992–9999).

  var CLASS_REMINDER_PREF = 'psycle_class_reminders'; // 'off' disables; default ON
  var CLASS_REMINDER_MAP = 'psycle_class_reminder_map'; // {eventId: {id, startAt}}

  function _classRemindersEnabled() {
    return localStorage.getItem(CLASS_REMINDER_PREF) !== 'off';
  }

  function _loadReminderMap() {
    try { return JSON.parse(localStorage.getItem(CLASS_REMINDER_MAP) || '{}'); } catch (e) { return {}; }
  }
  function _saveReminderMap(map) {
    try { localStorage.setItem(CLASS_REMINDER_MAP, JSON.stringify(map)); } catch (e) {}
  }

  function _reminderIdFor(eventId, map) {
    // Stable, collision-avoiding id in 8000–8899.
    var candidate = 8000 + (Math.abs(Number(eventId) || 0) % 900);
    var taken = {};
    Object.keys(map).forEach(function (k) { taken[map[k].id] = k; });
    while (taken[candidate] && taken[candidate] !== String(eventId)) {
      candidate = 8000 + ((candidate - 8000 + 1) % 900);
    }
    return candidate;
  }

  // Serialized: overlapping snapshot passes (booking events fire in quick
  // succession) must not interleave the load-reconcile-save cycle, or a
  // cancelled class's reminder can be resurrected by an in-flight pass.
  var _reminderChain = Promise.resolve();
  function _scheduleClassReminders(upcomingList) {
    _reminderChain = _reminderChain
      .then(function () { return _scheduleClassRemindersInner(upcomingList); })
      .catch(function () {});
    return _reminderChain;
  }

  async function _scheduleClassRemindersInner(upcomingList) {
    if (!LocalNotifications || !_classRemindersEnabled()) return;
    try {
      var perm = await LocalNotifications.checkPermissions();
      if (perm.display !== 'granted') return; // never prompt from the automatic path

      var map = _loadReminderMap();
      var wanted = {}; // eventId -> entry
      (upcomingList || []).forEach(function (c) { wanted[String(c.eventId)] = c; });

      // Cancel reminders for classes no longer upcoming or whose time moved.
      var toCancel = [];
      Object.keys(map).forEach(function (evtId) {
        var w = wanted[evtId];
        if (!w || w.startAt !== map[evtId].startAt) {
          toCancel.push({ id: map[evtId].id });
          delete map[evtId];
        }
      });
      if (toCancel.length) {
        try { await LocalNotifications.cancel({ notifications: toCancel }); } catch (e) {}
      }

      // Schedule new ones where T-90 is still in the future.
      var toSchedule = [];
      Object.keys(wanted).forEach(function (evtId) {
        if (map[evtId]) return; // already scheduled for this exact time
        var c = wanted[evtId];
        var fireAt = new Date(c.startAt).getTime() - 90 * 60 * 1000;
        if (!isFinite(fireAt) || fireAt <= Date.now()) return;
        var id = _reminderIdFor(evtId, map);
        map[evtId] = { id: id, startAt: c.startAt };
        toSchedule.push({
          id: id,
          title: (c.typeName || 'Class') + ' starts in 90 minutes',
          body: [c.instrName, c.locName || c.studioName].filter(Boolean).join(' · ') +
            ' — open Psync for the live countdown.',
          schedule: { at: new Date(fireAt), allowWhileIdle: true },
          sound: 'default',
          extra: { eventId: evtId },
        });
      });
      if (toSchedule.length) {
        try { await LocalNotifications.schedule({ notifications: toSchedule }); } catch (e) {}
      }
      _saveReminderMap(map);
    } catch (e) { /* reminders are best-effort */ }
  }

  // Settings toggle API (rendered by tabs.js next to the weekly reminder).
  window._nativeClassReminders = {
    isOn: function () { return _classRemindersEnabled(); },
    // The pref defaults ON but scheduling is permission-gated — the toggle
    // uses this to prompt instead of "turning off" a switch that never
    // actually armed.
    hasPermission: async function () {
      if (!LocalNotifications) return false;
      try { return (await LocalNotifications.checkPermissions()).display === 'granted'; }
      catch (e) { return false; }
    },
    enable: async function () {
      if (!LocalNotifications) return false;
      try {
        var perm = await LocalNotifications.requestPermissions();
        if (perm.display !== 'granted') return false;
      } catch (e) { return false; }
      localStorage.setItem(CLASS_REMINDER_PREF, 'on');
      updateWidgetSnapshot(); // re-runs scheduling with current classes
      return true;
    },
    disable: async function () {
      localStorage.setItem(CLASS_REMINDER_PREF, 'off');
      var map = _loadReminderMap();
      var ids = Object.keys(map).map(function (k) { return { id: map[k].id }; });
      if (ids.length && LocalNotifications) {
        try { await LocalNotifications.cancel({ notifications: ids }); } catch (e) {}
      }
      _saveReminderMap({});
    },
  };

  // Deliberate sign-out must blank the snapshot and cancel pending class
  // reminders — otherwise the previous account's classes stay on the widget
  // forever (the unconfirmed-empty guard would keep skipping) and their
  // "starts in 90 minutes" notifications keep firing. Session EXPIRY is
  // deliberately not wrapped: the bookings still exist server-side, so the
  // stale-but-true snapshot should keep serving the widget until re-login.
  var _origClearTokenNative = window.clearToken;
  if (typeof _origClearTokenNative === 'function') {
    window.clearToken = function () {
      var result = _origClearTokenNative.apply(this, arguments);
      _snapServerConfirmed = true; // empty is now the truth
      try { updateWidgetSnapshot(); } catch (e) {}
      return result;
    };
  }

  // Recompute on the booking lifecycle events the app emits.
  if (typeof PsycleEvents !== 'undefined' && PsycleEvents && typeof PsycleEvents.on === 'function') {
    try {
      PsycleEvents.on('bookings:loaded', function () {
        _snapServerConfirmed = true; // server has spoken — empty now means empty
        updateWidgetSnapshot();
      });
      PsycleEvents.on('booking:complete', updateWidgetSnapshot);
      PsycleEvents.on('booking:cancelled', updateWidgetSnapshot);
      // Seat-level changes alter slot lists shown on the widget too.
      PsycleEvents.on('seat:cancelled', updateWidgetSnapshot);
    } catch (e) {}
  }

  // Auto-reconcile the calendar whenever bookings change — covers classes
  // cancelled on the web / another device and map-loss orphans. Debounced +
  // in-flight guarded so the cold-start burst doesn't run several sweeps.
  var _calReconcileTimer = null, _calReconcileInFlight = false, _calReconcilePending = false;
  // Single-flight calendar sync. If a change arrives mid-run, remember it and
  // re-run once the in-flight pass finishes (so a cancel is never missed).
  async function _runCalSync() {
    if (_calReconcileInFlight) { _calReconcilePending = true; return; }
    _calReconcileInFlight = true;
    var res;
    try { res = await syncAllBookingsToCalendar(); } catch (e) { res = { error: 'sync failed' }; }
    _calReconcileInFlight = false;
    if (_calReconcilePending) { _calReconcilePending = false; _scheduleCalReconcile(); }
    return res;
  }
  function _scheduleCalReconcile() {
    if (!calendarSyncEnabled() || !hasChosenCalendar()) return;
    clearTimeout(_calReconcileTimer);
    _calReconcileTimer = setTimeout(_runCalSync, 1200);
  }
  // Tracks whether the latest bookings state came from a successful server
  // fetch. Only a server-confirmed EMPTY state may drive a delete-everything
  // reconcile (cancelling the last booking); a signed-out wipe may not.
  var _calServerConfirmedEmpty = false;
  if (typeof PsycleEvents !== 'undefined' && PsycleEvents && typeof PsycleEvents.on === 'function') {
    try {
      PsycleEvents.on('bookings:loaded', function (map) {
        _calServerConfirmedEmpty = Object.keys(map || _myBookings || {}).length === 0;
        _scheduleCalReconcile();
      });
    } catch (e) {}
  }

  // Refresh whenever the app returns to the foreground (a class may have
  // started/passed since the last write, flipping "next class").
  try {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') updateWidgetSnapshot();
    });
  } catch (e) {}

  // Initial compute shortly after launch, once state has had a chance to
  // hydrate from the bookings fetch / restore.
  setTimeout(function () { updateWidgetSnapshot(); }, 4000);


  // ── Status Bar ─────────────────────────────────────────────────
  // Set status bar style based on theme

  function updateStatusBar() {
    var StatusBar = window.Capacitor && Capacitor.Plugins.StatusBar;
    if (!StatusBar) return; // @capacitor/status-bar not installed/synced yet
    var themeId = document.documentElement.getAttribute('data-theme');
    // Resolve the theme's light/dark BASE from the registry — theme ids are
    // flavour names (cloud/linen/graphite/terminal/...), never 'light'.
    // No data-theme yet (following the system) → use the system scheme.
    var base = 'dark';
    if (!themeId) {
      base = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
    } else {
      var reg = window.APP_THEMES || [];
      for (var i = 0; i < reg.length; i++) {
        if (reg[i].id === themeId) { base = reg[i].base || 'dark'; break; }
      }
    }
    if (base === 'light') {
      StatusBar.setStyle({ style: 'DARK' }).catch(function () {}); // dark text on light bg
    } else {
      StatusBar.setStyle({ style: 'LIGHT' }).catch(function () {}); // light text on dark bg
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
