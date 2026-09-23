/* ═══════════════════════════════════════════════════════════════════
   Native Bridge — Capacitor integration layer

   Loaded ONLY in the native apps — the iPhone app and the Android app
   ship this same www/ folder — never on the web. Enhances the web app
   with native capabilities:
   - Persistent storage via Capacitor Preferences (survives purges)
   - Native haptics
   - Native share sheet

   This file is added to www/ only in the Capacitor build.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── Gym Time (Europe/London) ────────────────────────────────────
  // Psycle is a UK gym. The API sends class times as naive wall-clock
  // strings ("2026-08-05 07:00:00") in the GYM's local time, with no UTC
  // offset. `new Date("2026-08-05T07:00:00")` parses that as DEVICE-local
  // time — right only while the phone happens to be in the UK. A booking
  // made (or a calendar reconciled) from abroad landed the class at the
  // wrong instant, tagged with the wrong zone. The calendar path (and the
  // weekly Monday-12:00 reminder) resolve class times through the gym's zone
  // explicitly, and calendar events are stamped Europe/London.
  // (The widget/Live Activity snapshot, the T-90 class reminders and the web
  // ICS/Google export still parse start_at device-locally — by the owner's
  // decision, CLOSED: agents/decisions.md section 4. Not a follow-up to pick up.)
  //
  // Pure helpers, deliberately BEFORE the Capacitor guard: they need nothing
  // native, and tests/unit.js evaluates this file without Capacitor to
  // exercise the DST math via window._psycleClassStartMs.
  // js/app.js (pure:gym-time) carries the same pair for the web build, which
  // never loads this file; this copy stays because unit.js runs the bridge
  // alone, and it is the one in play in the app (it loads last). Change both —
  // tests/suites/bookings-card.js fails if their answers drift apart.

  var GYM_TZ = 'Europe/London';
  var _gymWallFmt = null; // lazy: Intl formatter reporting London wall clock for an instant

  /**
   * Absolute UTC ms for a wall-clock time in the gym's zone (DST-correct,
   * independent of the device timezone). Starts from the same clock reading
   * taken as UTC, then corrects by the offset London reports at that instant —
   * looped, because the correction can itself cross a DST boundary.
   * Throws if the JS engine has no Europe/London zone data (callers fall
   * back to a device-local parse).
   */
  function _gymWallToUtcMs(y, mo, d, h, mi, s) {
    if (!_gymWallFmt) {
      _gymWallFmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: GYM_TZ, hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    }
    var target = Date.UTC(y, mo - 1, d, h, mi, s || 0); // the clock reading, as if UTC
    var guess = target;
    for (var k = 0; k < 3; k++) {
      var wall = {};
      _gymWallFmt.formatToParts(new Date(guess)).forEach(function (p) {
        if (p.type !== 'literal') wall[p.type] = Number(p.value);
      });
      // London wall clock at `guess`, re-read as a UTC epoch, minus what we want.
      var deltaMs = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - target;
      if (deltaMs === 0) break;
      guess -= deltaMs;
    }
    return guess;
  }

  /**
   * Absolute UTC ms of an API class time. Naive "YYYY-MM-DD HH:MM[:SS[.fff]]"
   * (space or 'T') strings are the gym's UK wall clock. Anything else — an
   * epoch number, a string carrying its own Z / ±hh:mm offset, a date-only or
   * otherwise unexpected shape — goes to the engine's own parser exactly as
   * before this change, so explicit offsets and legacy inputs are respected
   * as-is. NaN only when nothing can parse it.
   */
  function _classStartMs(startAt) {
    if (typeof startAt === 'number') return isFinite(startAt) ? startAt : NaN;
    var s = String(startAt == null ? '' : startAt).trim();
    if (!s) return NaN;
    var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(s);
    if (m) {
      try {
        return _gymWallToUtcMs(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0));
      } catch (e) {
        // No Europe/London tz data in the engine — fall through to the old
        // device-local parse (correct whenever the phone is in the UK).
      }
    }
    var t = Date.parse(s.replace(' ', 'T'));
    return isNaN(t) ? Date.parse(s) : t; // e.g. "YYYY-MM-DD HH:MM:SS +01:00"
  }
  window._psycleClassStartMs = _classStartMs; // exported for tests/unit.js (and future native callers)

  // ── Calendar ownership decisions (pure) ─────────────────────────
  // WHICH native events Psync may destroy. Here, before the Capacitor guard,
  // so tests/suites/calendar-safety.js can drive them without EventKit.
  // `markerOf(ev)` → the Psycle event id in the event's notes, or null (the
  // bridge passes _markerEventId). An event WITHOUT our marker is the member's
  // own dentist appointment unless they explicitly handed the whole calendar
  // over (the ownership ack). An event that reports no calendarId can't be
  // attributed to any calendar, so it only ever counts when it is marked.

  /** Unmarked events in calendar `calId` — what a full-ownership reconcile would delete that isn't ours. */
  function _calForeignEvents(events, calId, markerOf) {
    return (events || []).filter(function (ev) {
      return !!ev && ev.calendarId != null && String(ev.calendarId) === String(calId) && !markerOf(ev);
    });
  }

  /** Native ids to clear out of `calId` when it stops being the sync target. */
  function _calSweepVictimIds(events, calId, ownedAck, markerOf) {
    var ids = [];
    (events || []).forEach(function (ev) {
      if (!ev) return;
      var marked = !!markerOf(ev);
      if (ev.calendarId != null) {
        if (String(ev.calendarId) !== String(calId)) return;
        if (!marked && !ownedAck) return; // never handed over → unmarked events are not ours to delete
      } else if (!marked) {
        return;
      }
      var nid = ev.id || ev.eventId;
      if (nid) ids.push(String(nid));
    });
    return ids;
  }
  /**
   * Does the stored ownership ack hand over calendar `calId`? Only the value
   * the confirmed dialog writes — '2:<calendarId>' — counts. The bare '1' of
   * the build before the dialog was written on EVERY pick / "Re-sync now" /
   * "Remove duplicates" with nothing shown, so it is not consent: it reads as
   * un-owned (marker-only reconcile) until the member confirms the dialog.
   */
  function _calAckCovers(stored, calId) {
    return !!calId && stored === '2:' + String(calId);
  }
  window._psycleCalForeignEvents = _calForeignEvents;   // exported for tests/suites/calendar-safety.js
  window._psycleCalSweepVictimIds = _calSweepVictimIds;
  window._psycleCalAckCovers = _calAckCovers;

  // Wait for Capacitor to be ready
  if (!window.Capacitor) {
    console.log('[native] Not running in Capacitor — skipping native bridge');
    return;
  }

  console.log('[native] Capacitor detected — initializing native bridge');

  // ── Platform ───────────────────────────────────────────────────
  // Both native apps run this file. Every plugin below is reached by EXISTENCE
  // (Capacitor.Plugins.X && …). The iPhone app registers four of its own in
  // Swift: AppGroupPreferences, WidgetCenter, PsycleDeepLink and
  // PsycleLiveActivity. The Android app registers TWINS of the first three —
  // local Java plugins under the SAME names and method shapes (ios-app/android/)
  // — so the snapshot write, the reload and the widget-tap listener below drive
  // its home-screen widget with no branch of their own. PsycleLiveActivity is
  // the iPhone's alone: on Android it is skipped, with nothing logged — as all
  // four are in an Android app built before the twins existed. IS_ANDROID guards
  // only what Android ALONE has: a status-bar colour, notification channels and
  // a small icon, a calendar store that keeps a deleted event's row for a
  // while, and the switch of its class countdown — the notification that stands
  // in for the Live Activity (_androidCountdownSwitch). Anything but 'android' —
  // 'ios', or a bridge that cannot say — takes the path the iPhone app always
  // took: not one call more, not one field more (tests/suites/18-android.js;
  // the Android widget: 20-android-widget.js; its countdown:
  // 21-android-countdown.js).
  var PLATFORM = 'unknown';
  try {
    if (typeof Capacitor.getPlatform === 'function') PLATFORM = String(Capacitor.getPlatform());
  } catch (e) {}
  var IS_ANDROID = PLATFORM === 'android';

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
  // so data survives iOS storage purges — and, on Android, the web view's
  // storage being cleared under it (Preferences is SharedPreferences there).

  var RETIRED_KEYS = ['psycle_instructor_tiers'];
  var SYNC_KEYS = [
    'psycle_bearer_token', 'psycle_bearer_token_enc',
    // AES key backup (written by security.js on native only). Without it an
    // IndexedDB purge makes the mirrored _enc ciphertext undecryptable and
    // the user is silently signed out forever.
    'psycle_sec_key_backup',
    'psycle_fav_instructors', 'psycle_saved_filters',
    'psycle_bike_prefs',
    'psycle_theme', 'psycle_class_history', 'psycle_history_synced',
    // The member's class-type colours and intensity (js/theme.js
    // PsycleClassColours): hand-picked, so a storage purge must not reset them.
    // theme.js re-applies them once this restore has settled.
    'psycle_class_colours',
    // Whose history that is (features.js): restored WITH it, or a storage
    // purge would hand the restored history to whoever is signed in next.
    'psycle_class_history_owner',
    // Whose device data this is, and the other member's stashed
    // favourites / bike prefs (app.js, pure:data-owner). Without the stamp a
    // purge reads as a pre-stamp install ("adopt") on the next sign-in, and
    // the stash — hand-entered, not rebuildable from Psycle — is simply gone.
    'psycle_data_owner', 'psycle_account_stash',
    'psycle_notify_watchlist', 'psycle_calendar_data',
    'psycle_error_log', 'psycle_offline_queue', 'psycle_action_log',
    // (psycle_waitlisted_events retired: waitlist places come from GET
    // /waitlists now; app.js deletes the old marker and it must not be
    // resurrected from Preferences.) psycle_waitlist_places IS mirrored: it
    // holds the previous launch's places, without which a place Psycle turned
    // into a chargeable booking while the app was closed can't be announced.
    'psycle_waitlist_places', 'psycle_weekly_template',
    'psycle_bike_history', 'psycle_recent_searches', 'psycle_onboarded_v1',
    'psycle_weekly_reminder', 'psycle_class_reminders',
    // The "Your usual week" card, folded or not (js/tabs.js, '1' | absent): a
    // storage purge must not unfold it. Unfolding REMOVES the key, and
    // removeItem is mirrored too, so a stale copy here can never re-fold it.
    'psycle_usual_week_collapsed',
    // One-time answers (the first-booking reminder ask and the usual-week
    // Monday-reminder ask below; the web layer's history-sync prompt) — without
    // the mirror a storage purge asks again.
    'psycle_class_reminder_asked', 'psycle_weekly_reminder_asked', 'psycle_history_prompt_dismissed',
    // Calendar integration state — must survive iOS storage purges
    // or duplicates are created on the next full sync.
    'psycle_native_cal_events', 'psycle_native_cal_id',
    'psycle_calendar_target_id', 'psycle_calendar_mode',
    'psycle_calendar_enabled', 'psycle_calendar_owned_ack',
  ];

  // On startup: restore from native storage to localStorage.
  // security.js holds sign-in state (and with it every first API call) until
  // this settles, so it must not cost a bridge round-trip per key in series:
  // restore only ever FILLS a missing key, so keys localStorage already has
  // are skipped without asking, and the rest are read together.
  async function restoreFromNative() {
    // A key this app once mirrored and no longer reads: its native copy goes, so nothing of a retired feature
    // stays on the phone (js/app.js RETIRED_STORAGE_KEYS removes the web copy). Not awaited: nothing depends on it.
    RETIRED_KEYS.forEach(function (key) { Preferences.remove({ key: key }).catch(function () {}); });
    await Promise.all(SYNC_KEYS.map(async function (key) {
      // Per-key guard: one rejected read must not settle the batch early (that
      // would release the handshake while other keys are still in flight).
      try {
        if (localStorage.getItem(key)) return;
        var result = await Preferences.get({ key: key });
        if (result.value === null || result.value === undefined) return;
        // Re-check after the await — anything written while the read was in
        // flight (a fresh sign-in) is newer than the mirrored copy.
        if (localStorage.getItem(key)) return;
        // Raw write: the patched setItem below would only echo the value
        // straight back into Preferences.
        _origSetItem(key, result.value);
        console.log('[native] restored:', key);
      } catch (e) {}
    }));
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
  // Uses the @ebarooni/capacitor-calendar v6 plugin (patched — see
  // ios-app/patch-plugins.js) for EventKit access. Events are stamped with
  // the gym's Europe/London zone, never the device's current zone.
  // Production-hardened: dedicated calendar, reminders, proper error handling.
  //
  // ANDROID — the same plugin (6.7.2), its Kotlin side read call by call
  // (android/src/main/java/dev/barooni/capacitor/calendar/). Every call this
  // file makes exists there under the same name, with the same parameter names:
  //   checkAllPermissions / requestFullCalendarAccess (requestAllPermissions
  //   only as the fallback for a plugin without it: on iPhone it ALSO asks for
  //   Reminders, which nothing here uses — see _ensureCalendarPermission)
  //       handed straight to Capacitor's own checkPermissions /
  //       requestPermissions, which answer the plugin's aliases — readCalendar,
  //       writeCalendar, readWriteCalendar, the same three names as iOS — most
  //       likely BARE, with no `result` wrapper (iOS wraps them).
  //       `check.result || check` reads either. The plugin's manifest declares
  //       NO permission: the app's manifest must carry READ_CALENDAR and
  //       WRITE_CALENDAR, or the request answers 'denied' without ever asking.
  //   listCalendars → { result: [{ id, title, color }] } — no isImmutable, so a
  //       read-only calendar (Holidays, Birthdays) is listed too; a create in
  //       one fails, is logged, and nothing else happens.
  //   listEventsInRange({ startDate, endDate }) → { result: [...] }; each event
  //       has id and calendarId as STRINGS, startDate / endDate as ms NUMBERS,
  //       and its notes under `description` — NOT `notes`. _markerEventId reads
  //       both keys, which is what keeps the reconcile's ownership marker
  //       (`psycle-event-id:`) readable there. It reads the Events table, so a
  //       row deleted a moment ago can still be listed: see _listNativeEvents.
  //   createEvent → { result: "<id>" }. title, location, notes, startDate,
  //       endDate, isAllDay, calendarId and alertOffsetInMinutes (an array of
  //       minutes BEFORE) are all honoured; `timeZone` is not read — the plugin
  //       stamps TimeZone.getDefault(). Left alone: startDate is an absolute
  //       instant, so the class sits at the right moment wherever the phone is;
  //       only the zone a calendar app prints beside it is the device's.
  //   deleteEventsById({ ids }) → { result: { deleted: [...], failed: [...] } }.
  //       There is no deleteEvent: the per-id fallback below is never reached
  //       unless deleteEventsById itself rejects, and then it removes nothing.

  var Calendar = Capacitor.Plugins.CapacitorCalendar;
  var CAL_EVENT_MAP_KEY = 'psycle_native_cal_events'; // { eventId: nativeCalEventId }
  var CAL_ID_KEY = 'psycle_native_cal_id';            // dedicated calendar ID (auto-created)
  var CAL_TARGET_KEY = 'psycle_calendar_target_id';   // user-selected target calendar ID
  var CAL_MODE_KEY = 'psycle_calendar_mode';          // 'auto' | 'custom' | 'default'
  var CAL_ENABLED_KEY = 'psycle_calendar_enabled';    // '0' disables sync entirely
  // '2:<calendarId>' once the user has confirmed that target under the
  // full-ownership contract — only then may the reconcile delete events
  // WITHOUT our marker. It is granted ONLY by a caller that has just shown the
  // ownership dialog (`ownedAck: true`) and names the one calendar it is for:
  // a target change that doesn't carry it clears it, so no code path hands a
  // calendar over silently. A legacy '1' (written silently by the build before
  // the dialog) is NOT consent — see _calAckCovers.
  var CAL_OWNED_ACK_KEY = 'psycle_calendar_owned_ack';
  function _calIsOwned(calId) {
    return _calAckCovers(localStorage.getItem(CAL_OWNED_ACK_KEY), calId);
  }
  var PSYCLE_CAL_TITLE = 'Psycle';
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
      // Ask for the CALENDAR alone. The plugin's requestAllPermissions() also
      // asks for full Reminders access on iPhone: the app has no use for it
      // and no purpose string, so that second request failed, the whole call
      // rejected, and the first attempt to switch sync on read as "denied"
      // although Calendar had just been granted. The answer is then READ BACK
      // rather than taken from the request, whose shape differs by platform.
      if (typeof Calendar.requestFullCalendarAccess === 'function') {
        await Calendar.requestFullCalendarAccess();
      } else {
        await Calendar.requestAllPermissions();
      }
      var after = await Calendar.checkAllPermissions();
      var afterPerms = after.result || after;
      _calPermissionGranted = afterPerms.readCalendar === 'granted' && afterPerms.writeCalendar === 'granted';
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

    // start_at is UK wall-clock time (the gym's zone) — resolve it through
    // Europe/London so the event lands at the right instant even when the
    // phone is abroad, and stamp the event with that zone below.
    var startMs = _classStartMs(evt.start_at);
    if (isNaN(startMs)) return null; // unparseable start — nothing sane to write
    var endMs = startMs + (evt.duration || 45) * 60 * 1000;
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
    // marker and no reminders. `timeZone` is honoured by our patched plugin
    // (ios-app/patch-plugins.js) — upstream v6 has no create-time zone
    // parameter and silently stamped every event with the device's zone.
    return {
      title: title,
      location: location,
      startDate: startMs,
      endDate: endMs,
      timeZone: GYM_TZ,
      notes: desc.join('\n'),
      isAllDay: false,
      // Positive = minutes BEFORE the event; the plugin negates it into the
      // EKAlarm and IGNORES negative values (the old [-60, -15] created no
      // alarms at all — events synced with 'Alert: None').
      alertOffsetInMinutes: [60, 15], // 1 hour and 15 minutes before class
    };
  }

  // ── v6-plugin-correct primitives ─────────────────────────────────

  /** Extract the Psycle event id from a native event's notes, or null.
   *  iOS hands the notes back as `notes`; Android as `description` (the
   *  CalendarContract column) — both are read, on either platform. */
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
      if (IS_ANDROID) _androidRememberDeleted(out.deleted);
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

  // ANDROID ONLY. An event deleted from a calendar that syncs (Google) need not
  // be removed at once: its row can stay in the Events table, flagged deleted
  // (CalendarContract's DELETED column: "a deleted row should be ignored"),
  // until the account's next sync — and the plugin's listEventsInRange reads
  // that table without looking at the flag. Read back as live, a row this app
  // has just deleted would match the class a member re-books a moment later
  // (same title, same start, our marker): the reconcile would "keep" it, create
  // nothing, and the calendar would show no class until a later launch. (Read
  // off the plugin's source and Android's contract, not seen on a phone.) So
  // the ids Android CONFIRMED deleted are remembered for this launch and left
  // out of every listing. Only ever ids the plugin reported under `deleted`
  // (rows that are gone, or flagged so); Android never hands an event id out
  // twice, so leaving one out can hide nothing live. iOS (EventKit) removes an
  // event outright, and none of this runs there.
  var _androidDeletedEventIds = {};
  function _androidRememberDeleted(ids) {
    (Array.isArray(ids) ? ids : []).forEach(function (id) {
      if (id !== null && id !== undefined && id !== '') _androidDeletedEventIds[String(id)] = true;
    });
  }

  /** Normalized listEventsInRange (ms timestamps in, array out). */
  async function _listNativeEvents(startMs, endMs) {
    if (!Calendar) return [];
    var q = await Calendar.listEventsInRange({ startDate: startMs, endDate: endMs });
    var events = (q && q.result) || q || [];
    if (!Array.isArray(events)) return [];
    if (!IS_ANDROID) return events;
    return events.filter(function (ev) {
      var nid = ev && (ev.id || ev.eventId);
      return !(nid && _androidDeletedEventIds[String(nid)]);
    });
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
    // Forward ALL args — the 4th (opts, e.g. { spaces } for no-layout
    // studios) must survive the wrapper chain. Waitlist joins no longer come
    // through submitBooking (joinWaitlist → PUT /waitlists/{eventId}).
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
    var ownedAck = _calIsOwned(calId);

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
  window.psycleResyncCalendar = async function (opts) {
    // Signed out / session expired: refuse BEFORE the refresh. fetchMyBookings'
    // no-token branch empties _myBookings — the list expiry keeps on purpose —
    // and the next foreground would then blank the widget and cancel the class
    // reminders, all for a reconcile that skips itself anyway.
    if (typeof getBearerToken === 'function' && !getBearerToken()) {
      return { added: 0, removed: 0, kept: 0, error: 'Sign in to sync' };
    }
    _calSynced = false;
    // The full-ownership contract is confirmed ONLY when the caller has just
    // shown the ownership dialog and the member said yes. A bare resync (or
    // "Remove duplicates") must never grant it: a target picked before the
    // contract shipped may be a personal calendar.
    if (opts && opts.ownedAck === true && hasChosenCalendar()) {
      try { localStorage.setItem(CAL_OWNED_ACK_KEY, '2:' + localStorage.getItem(CAL_TARGET_KEY)); } catch (e) {}
    }
    if (typeof fetchMyBookings === 'function') {
      try { await fetchMyBookings(); } catch (e) {}
    }
    clearTimeout(_calReconcileTimer); // fetchMyBookings armed a debounced run — run once here instead
    // _runCalSync answers undefined when a pass is already in flight (it queues
    // a re-run) — report that as not-done-yet, never as a finished sync.
    return (await _runCalSync()) || { added: 0, removed: 0, kept: 0, skipped: 'busy' };
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
    // `skipped` must survive: a reconcile that never ran removed 0 events, and
    // the Settings button would otherwise call that "No duplicates".
    return { scanned: (res.kept || 0) + (res.removed || 0), removed: res.removed || 0, error: res.error, skipped: res.skipped };
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
      // Has the member handed the current target over (ownership dialog)? The
      // Settings UI asks before "Re-sync now" while this is false.
      ownedAck: _calIsOwned(localStorage.getItem(CAL_TARGET_KEY)),
    };
  };

  /**
   * READ-ONLY: how many upcoming events in calendar `calId` are NOT Psycle
   * bookings — what handing that calendar over would destroy on the first
   * reconcile (same 120-day window, same attribution rule). The Settings
   * ownership dialog quotes it. null = can't tell (no plugin/permission, the
   * query failed, or the plugin attributes no event to a calendar) — the
   * dialog then warns without a number. Never writes, never deletes.
   */
  window.psycleCountForeignEvents = async function (calId) {
    if (!Calendar || !calId) return null;
    try {
      if (!(await _ensureCalendarPermission())) return null;
      var now = Date.now();
      var evs = await _listNativeEvents(now, now + 120 * 86400000);
      if (evs.length && !evs.some(function (ev) { return ev && ev.calendarId != null; })) return null;
      return _calForeignEvents(evs, calId, _markerEventId).length;
    } catch (e) {
      return null;
    }
  };

  /**
   * Update the calendar target. When the target changes we delete every
   * event we previously created (regardless of which calendar they're on —
   * EventKit's deleteEvent works by id) and wipe the local mapping, so the
   * next re-sync cleanly re-adds bookings into the new target.
   *
   * `cfg.ownedAck: true` = the caller has just shown the ownership dialog for
   * `cfg.targetId` and the member agreed. Without it the new target is NOT
   * handed over: the reconcile only ever touches events carrying our marker.
   *
   * Returns { movedFromOld: N } so callers (the Settings UI) can show a hint.
   */
  window.psycleSetCalendarConfig = async function (cfg) {
    cfg = cfg || {};
    var prevMode = localStorage.getItem(CAL_MODE_KEY) || 'unset';
    var prevTarget = localStorage.getItem(CAL_TARGET_KEY) || '';
    // The ack as it stood for the OLD target — read before this pick rewrites
    // it, because the sweep below must judge the old calendar by its own ack.
    var prevOwnedAck = _calIsOwned(prevTarget);

    if (typeof cfg.enabled === 'boolean') {
      localStorage.setItem(CAL_ENABLED_KEY, cfg.enabled ? '1' : '0');
    }
    if (cfg.mode) localStorage.setItem(CAL_MODE_KEY, cfg.mode);
    if (cfg.mode === 'custom' && cfg.targetId) {
      localStorage.setItem(CAL_TARGET_KEY, String(cfg.targetId));
      // Consent is the caller's confirmed ownership dialog — never the pick
      // itself (one tap on "Home" used to wipe four months of personal events).
      // A different calendar without it starts un-owned: the old ack was for
      // the old calendar and must not carry over.
      if (cfg.ownedAck === true) {
        localStorage.setItem(CAL_OWNED_ACK_KEY, '2:' + String(cfg.targetId));
      } else if (String(cfg.targetId) !== prevTarget) {
        localStorage.removeItem(CAL_OWNED_ACK_KEY);
      }
    }

    var targetChanged =
      (cfg.mode && cfg.mode !== prevMode) ||
      (cfg.mode === 'custom' && String(cfg.targetId || '') !== prevTarget);

    var movedFromOld = 0;
    if (targetChanged) {
      // The OLD calendar was fully Psync-owned while it was the target —
      // clear every future event out of it (mapped ids AND anything the map
      // lost track of), so switching never strands duplicates behind.
      // …but only if it really WAS handed over (prevOwnedAck). A target picked
      // before the ownership contract shipped may be the member's personal
      // calendar: there, only events carrying our marker (and the ids we
      // created) go — switching away must never wipe it.
      if (Calendar) {
        await _ensureCalendarPermission();
        var oldIds = Object.values(_loadCalMap()).map(String);
        var victims = {};
        oldIds.forEach(function (id) { victims[id] = true; });
        if (prevTarget) {
          try {
            var now = Date.now();
            var evs = await _listNativeEvents(now, now + 120 * 86400000);
            // Same attribution + ownership guards as the reconcile (see
            // _calSweepVictimIds): without a reported calendarId, or without
            // the old target's ack, only events carrying our marker go.
            _calSweepVictimIds(evs, prevTarget, prevOwnedAck, _markerEventId).forEach(function (nid) {
              victims[nid] = true;
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
  // Local notification at 12:00 UK time every Monday — the moment Psycle
  // opens new dates (it fired a minute early until September 2026, and said
  // "opens at 12:00"; the owner asked for the moment itself).

  var LocalNotifications = Capacitor.Plugins.LocalNotifications;

  // ── Android: notification channels, the small icon and its tint ──
  // Android 8+ files every notification under a CHANNEL, which is what the
  // member sees (and can silence) in the system's settings for Psync: one for
  // the class reminders, one for the Monday "new dates" reminder. Created once
  // per launch — creating a channel that exists changes nothing the member has
  // set — and every schedule() waits for that, so a reminder can never be filed
  // under a channel that is not there. Importance 4 (a banner, with the phone's
  // default sound: no `sound` is named). Before Android 8 there are no
  // channels: the plugin answers "unavailable", which is swallowed, and
  // `channelId` is ignored there.
  // EXACT ALARMS ARE NOT ASKED FOR. With no SCHEDULE_EXACT_ALARM permission
  // the plugin arms an inexact alarm (setAndAllowWhileIdle), so a reminder may
  // arrive late: usually minutes; Android 12+ MAY hold one for up to an hour.
  // The owner's call (decisions.md): it spares a special-access screen.
  // `allowWhileIdle` stays on every schedule: it is what lets the alarm fire
  // while the phone dozes.
  // None of this runs on iOS: no channel is created, and a scheduled
  // notification carries no channelId, smallIcon or iconColor.
  var ANDROID_CHANNEL_CLASSES = 'class-reminders';
  var ANDROID_CHANNEL_NEW_DATES = 'new-dates';
  var ANDROID_NOTIF_ICON = 'ic_stat_psync'; // res/drawable in the Android project: white on transparent. Missing → the plugin falls back to its own default.
  // The mark's ink. Keep it equal to the plugin-wide default, where capacitor.config.json
  // names one (plugins.LocalNotifications.iconColor): this one wins, per notification.
  // A literal on purpose: a colour the plugin cannot parse REJECTS the whole schedule().
  var ANDROID_NOTIF_TINT = '#1B2130';
  var _androidChannels = null; // the one creation pass of this launch

  function _ensureAndroidChannels() {
    if (!IS_ANDROID) return Promise.resolve();
    if (_androidChannels) return _androidChannels;
    if (!LocalNotifications || typeof LocalNotifications.createChannel !== 'function') {
      _androidChannels = Promise.resolve();
      return _androidChannels;
    }
    var make = function (id, name, description) {
      try {
        return Promise.resolve(LocalNotifications.createChannel({
          id: id, name: name, description: description, importance: 4, visibility: 1, vibration: true,
        })).catch(function () {});
      } catch (e) { return Promise.resolve(); }
    };
    _androidChannels = Promise.all([
      make(ANDROID_CHANNEL_CLASSES, 'Class reminders', '90 minutes before each class you hold'),
      make(ANDROID_CHANNEL_NEW_DATES, 'New dates', 'Mondays at 12:00, when Psycle opens new dates'),
    ]).then(function () {}, function () {});
    return _androidChannels;
  }
  if (IS_ANDROID) _ensureAndroidChannels();

  // The Android-only fields of one notification. On iOS the object comes back
  // exactly as it went in.
  function _forAndroid(notification, channelId) {
    if (!IS_ANDROID) return notification;
    notification.channelId = channelId;
    notification.smallIcon = ANDROID_NOTIF_ICON;
    notification.iconColor = ANDROID_NOTIF_TINT;
    return notification;
  }

  // Eight rolling one-shot notifications (the next 8 Mondays). Absolute `at:`
  // times are used instead of an hour-of-day repeat: the old hour-offset
  // math broke whenever the device's calendar DATE differed from London's
  // (e.g. a New York Monday evening computed `hour: 30` — a reminder that
  // never fires). Rescheduled on every launch, so the window keeps rolling;
  // eight weeks covers long stretches without opening the app.
  var REMINDER_IDS = [9999, 9998, 9997, 9996, 9995, 9994, 9993, 9992];

  // ── pure:weekly-reminder:start ── (DOM-free; tests/suites/14c-weekly-reminder.js evaluates this block)
  // WHEN it fires and WHAT it says. Nothing here touches Capacitor, the DOM or
  // the clock: `now` and the gym-zone resolver (_gymWallToUtcMs) are handed in.
  var WEEKLY_REMINDER_HOUR = 12, WEEKLY_REMINDER_MINUTE = 0; // Mondays 12:00 Europe/London: Psycle's release
  var WEEKLY_TEMPLATE_KEY = 'psycle_weekly_template'; // js/app.js — "Your usual week"

  /**
   * The next `count` occurrences of Monday 12:00 Europe/London as absolute
   * Date instants, DST-correct for any device timezone. Walked over UTC
   * calendar days: noon in London is 11:00 or 12:00 UTC, so the instant always
   * falls on the London date's own UTC day — no weekday formatter is needed,
   * only the resolver. One under a minute away is left to next week.
   */
  function _nextMondaysNoonLondon(count, now, wallToUtcMs) {
    var DAY = 86400000;
    var out = [];
    try {
      var n = new Date(now);
      for (var k = 0; k <= 7 * (count + 1) && out.length < count; k++) {
        var c = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + k));
        if (c.getUTCDay() !== 1) continue;
        var ts = wallToUtcMs(c.getUTCFullYear(), c.getUTCMonth() + 1, c.getUTCDate(), WEEKLY_REMINDER_HOUR, WEEKLY_REMINDER_MINUTE, 0);
        if (ts > now + 60000) out.push(new Date(ts));
      }
    } catch (e) { /* Intl/timezone unavailable — fall through */ }
    if (out.length === 0) out.push(new Date(now + 7 * DAY)); // defensive
    return out;
  }

  // Is a usual week saved? `raw` is the stored string, which is untrusted (an
  // import, the Preferences mirror): anything but a non-empty array is "no".
  function _hasUsualWeek(raw) {
    try {
      var list = JSON.parse(raw || '[]');
      return Array.isArray(list) && list.length > 0;
    } catch (e) { return false; }
  }

  // It fires AT the release, so it says the dates ARE open (and still reads
  // true when the banner is seen later). The body names what the tap opens:
  // the review of the usual week, or Discover on the dates that just opened.
  function _weeklyReminderCopy(hasUsualWeek) {
    return {
      title: 'New Psycle dates are open',
      body: hasUsualWeek ? 'Book your usual week for the dates that just opened.'
        : 'Find your classes for the dates that just opened.',
    };
  }

  // Where the tap lands at once (the web layer's _onBookingWeekOpened does the
  // rest when it can): the usual-week review lives on My Bookings.
  function _weeklyTapTab(hasUsualWeek) {
    return hasUsualWeek ? 'bookings' : 'discover';
  }

  // Put the in-app "remind you on Mondays?" question (_offerWeeklyReminder)?
  // Only to a member who has a usual week, has never answered it, has never
  // touched the Settings switch (a stored 'on' or 'off' IS an answer) and whom
  // iOS would still let say yes — after a 'denied' the question leads nowhere.
  // `permission` is undefined before it has been read: that alone rules nothing out.
  function _weeklyOfferDecision(f) {
    f = f || {};
    if (!f.hasUsualWeek || f.asked) return 'skip';
    if (f.pref === 'on' || f.pref === 'off') return 'skip';
    if (f.permission === 'denied') return 'skip';
    return 'ask';
  }
  // ── pure:weekly-reminder:end ──

  function _usualWeekSaved() {
    try { return _hasUsualWeek(localStorage.getItem(WEEKLY_TEMPLATE_KEY)); } catch (e) { return false; }
  }

  var REMINDER_PREF = 'psycle_weekly_reminder'; // 'on' | 'off' | unset (off)
  // Which body the armed reminders carry (true = "Book your usual week…"),
  // null while nothing is known to be armed — so a save / clear that does not
  // change the sentence re-arms nothing.
  var _weeklyArmedWithWeek = null;

  async function _cancelReminders() {
    _weeklyArmedWithWeek = null;
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

      var mondays = _nextMondaysNoonLondon(REMINDER_IDS.length, Date.now(), _gymWallToUtcMs);
      // Read HERE, after the awaits: of two passes that overlap (a save and a
      // clear a moment apart) the later one writes what is true now.
      var hasWeek = _usualWeekSaved();
      var copy = _weeklyReminderCopy(hasWeek);
      if (IS_ANDROID) await _ensureAndroidChannels();
      await LocalNotifications.schedule({
        notifications: mondays.map(function (at, i) {
          return _forAndroid({
            id: REMINDER_IDS[i],
            title: copy.title,
            body: copy.body,
            schedule: { at: at, allowWhileIdle: true },
            sound: 'default',
          }, ANDROID_CHANNEL_NEW_DATES);
        }),
      });
      _weeklyArmedWithWeek = hasWeek;

      console.log('[native] weekly reminders scheduled for: ' +
        mondays.map(function (d) { return d.toISOString(); }).join(', '));
      return true;
    } catch (e) {
      console.warn('[native] failed to schedule weekly reminder:', e);
      return false;
    }
  }

  // One pass at a time: each cancels the eight ids and schedules them again,
  // and two interleaved passes could leave the older one's sentence armed.
  var _weeklyChain = Promise.resolve();
  function _scheduleWeeklySerial(interactive) {
    var run = _weeklyChain.then(function () { return scheduleWeeklyReminder(interactive); });
    _weeklyChain = run.catch(function () {});
    return run;
  }

  // Exposed to the web layer (Membership tab toggle). The permission
  // prompt only ever appears from enable() — a deliberate user action —
  // never at app launch.
  window._nativeReminder = {
    isOn: function () { return localStorage.getItem(REMINDER_PREF) === 'on'; },
    enable: async function () {
      var ok = await _scheduleWeeklySerial(true);
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
    if (localStorage.getItem(REMINDER_PREF) === 'on') _scheduleWeeklySerial(false);
  }, 3000);

  // The body names what the tap opens, so it follows the usual week. js/tabs.js
  // saves and clears it through these two window functions (Save, Update from
  // my bookings, Clear, and removing the last class); an account switch swaps
  // the stored week. Only while the reminder is on, only when the sentence
  // would change, and never prompting. (A week that arrives some other way —
  // an import, the Preferences restore — is picked up by the next launch.)
  function _rearmWeeklyReminder() {
    try {
      if (localStorage.getItem(REMINDER_PREF) !== 'on') return;
      if (_usualWeekSaved() === _weeklyArmedWithWeek) return;
      _scheduleWeeklySerial(false);
    } catch (e) { /* best-effort: never in the way of a save */ }
  }
  ['saveWeeklyTemplate', 'clearWeeklyTemplate'].forEach(function (name) {
    var orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function () {
      var result = orig.apply(this, arguments);
      _rearmWeeklyReminder();
      return result;
    };
  });
  if (typeof PsycleEvents !== 'undefined' && PsycleEvents && typeof PsycleEvents.on === 'function') {
    try { PsycleEvents.on('data:owner-changed', _rearmWeeklyReminder); } catch (e) {}
  }


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

  // Land a tapped notification on what it was about. A class reminder carries
  // extra.eventId → My Bookings + that class's sheet; the weekly "new dates
  // are open" reminder carries none → My Bookings when a usual week is saved
  // (the web layer then opens its REVIEW sheet on the dates that just opened),
  // else Discover. Nothing here books or cancels: the web layer owns that
  // (auth + slot picker) behind the sheet's buttons, and the review sheet books
  // only what the member ticks and confirms in it.
  var TAP_ROUTE_WAIT_MS = 10000;
  var _cancelTapRoute = null; // only the latest tap may still open a sheet

  // The Monday reminder exists for one moment: the release of new dates. A
  // timetable loaded at 11:50 still counts as fresh (15 min) at noon, so the
  // tap landed on a list without them and nothing refreshed it. Hand over to
  // js/app.js's hook (_onBookingWeekOpened) when it is there, and ONLY it: it
  // opens the usual-week review or shows the opened dates on Discover, runs
  // its own search, and a second loader would race that. Else the plain silent
  // refresh (which no-ops without a token, offline, mid-search, or on a cold
  // start before studios load — the launch search covers that). GETs only;
  // never throws, sync or async.
  function _askDiscoverToRefresh() {
    try {
      var asked = null;
      if (typeof window._onBookingWeekOpened === 'function') asked = window._onBookingWeekOpened();
      else if (typeof window.revalidateWindow === 'function') asked = window.revalidateWindow({ silent: true });
      if (asked && typeof asked.catch === 'function') asked.catch(function () {});
    } catch (e) {}
  }

  function _routeNotificationTap(eventId) {
    if (typeof window.switchTab !== 'function') return;
    if (_cancelTapRoute) _cancelTapRoute();
    if (eventId === null || eventId === undefined || eventId === '') {
      // Decided HERE, at the tap, from the same stored week the hook reads: its
      // retries only act while the member is still on the tab this put them on.
      window.switchTab(_weeklyTapTab(_usualWeekSaved()));
      _askDiscoverToRefresh();
      return;
    }
    var key = String(eventId);
    window.switchTab('bookings');
    var openSheet = function () {
      if (typeof window.openClassDetail !== 'function' || !(_eventCache || {})[key]) return false;
      // A delivered banner outlives the booking (cancel() only removes PENDING
      // requests), and a cancelled class stays in _eventCache — its sheet would
      // offer a live "Book" for the class the user just dropped. No held seat
      // → My Bookings is the whole answer.
      var held = (_myBookings || {})[key];
      if (!held || held.waitlisted) return false;
      window.openClassDetail(key);
      return true;
    };
    if (openSheet()) return;
    if (typeof PsycleEvents === 'undefined' || !PsycleEvents || typeof PsycleEvents.on !== 'function') return;

    // Cold start: the tap arrives before bookings (and their event details)
    // have loaded. Wait for ONE bookings:loaded, and give up after a few
    // seconds — a sheet that pops up long after the tap is worse than none.
    var done = false, off = null, timer = null;
    var startedAt = Date.now();
    var finish = function () {
      if (done) return;
      done = true;
      clearTimeout(timer);
      _cancelTapRoute = null;
      // Unsubscribe on a later tick: emit() walks the live handler array, so
      // removing ourselves mid-emit would make it skip the next listener.
      setTimeout(function () { if (off) off(); }, 0);
    };
    off = PsycleEvents.on('bookings:loaded', function () {
      if (done) return;
      finish();
      // The give-up timer freezes while the app is suspended, so also judge by
      // the clock — bookings that land long after the tap must not pop a sheet.
      if (Date.now() - startedAt > TAP_ROUTE_WAIT_MS) return;
      // Only if the user is still where the tap put them.
      var panel = document.querySelector('.tab-panel.active');
      if (!panel || panel.id === 'tab-bookings') openSheet();
    });
    timer = setTimeout(finish, TAP_ROUTE_WAIT_MS);
    _cancelTapRoute = finish;
  }

  // Route a tapped notification / action button. SNOOZE re-schedules a one-off
  // reminder natively; everything else is routed inside the web app.
  //
  // ANDROID: THIS EVENT CAN BE FORGED. The plugin builds it from the extras of
  // whatever intent starts the launcher activity — which is exported, as a
  // launcher must be — and never asks where the intent came from, so any app on
  // the phone can hand this function a payload of its own making. (On iOS only
  // the system delivers a notification response.) So there, and only there:
  //   • SNOOZE is ignored. It would re-post the payload's OWN title and body an
  //     hour later as a Psync notification, and could fill the plugin's alarm
  //     table. No reminder the bridge arms carries the action type, so a real
  //     notification never sends it — and the action type is not registered.
  //   • an eventId that is not all digits opens nothing: My Bookings, as a
  //     widget link with a bad id does (_parseWidgetLink).
  // What a forged tap can still do is what a real one does: change the tab, open
  // the sheet of a class the member HOLDS, or open the usual-week review, which
  // books nothing by itself. The notification's id is not checked: the ids are
  // few and guessable, so it would stop nobody, and the class map is pruned as
  // classes pass, so it could drop a real tap.
  function handleNotificationAction(notification) {
    try {
      var actionId = notification.actionId;
      var data = (notification.notification && notification.notification.extra) || {};
      var eventId = data.eventId;
      if (IS_ANDROID) {
        if (actionId === 'SNOOZE') return;
        if (eventId !== null && eventId !== undefined && eventId !== '' && !/^\d+$/.test(String(eventId))) {
          if (typeof window.switchTab === 'function') window.switchTab('bookings');
          return;
        }
      }
      if (actionId === 'SNOOZE') {
        // Re-fire in 1 hour without involving the web layer.
        try {
          LocalNotifications.schedule({
            notifications: [_forAndroid({
              id: Math.floor(Math.random() * 100000) + 1,
              title: notification.notification.title || 'Class reminder',
              body: notification.notification.body || '',
              schedule: { at: new Date(Date.now() + 60 * 60 * 1000) },
              actionTypeId: 'PSYCLE_CLASS',
              extra: data,
            }, eventId ? ANDROID_CHANNEL_CLASSES : ANDROID_CHANNEL_NEW_DATES)],
          }).catch(function () {});
        } catch (e) {}
        return;
      }
      // BOOK / CANCEL / default tap → open the class (or the new week). The
      // old hand-off called a handler no module defines and stashed the
      // intent under a key nothing read, so a tap went nowhere.
      _routeNotificationTap(eventId);
    } catch (e) {
      try { console.warn('[native-notif] action handling failed:', e); } catch (_) {}
    }
  }

  if (LocalNotifications) {
    // Not on Android: see handleNotificationAction (nothing armed there uses it).
    if (!IS_ANDROID) registerNotificationActions();
    try {
      LocalNotifications.addListener('localNotificationActionPerformed', handleNotificationAction);
    } catch (e) {}
  }

  // ── pure:widget-link:start
  // A Home/Lock Screen widget tap opens psync://bookings?event=<id> (minted in
  // PsycleWidget.swift). Parsed by hand rather than with URL(): WebKit has
  // changed how it reads the host of a custom scheme between iOS versions, and
  // this one shape is all that is ever minted. Anything else → null.
  // ANDROID mints the same string and opens no URL: the widget's tap is an
  // explicit intent to MainActivity with the class id as an extra, and the
  // PsycleDeepLink twin turns it into this 'openURL' { url }. Any app can start
  // that activity with an extra of its choosing, so the twin passes on digits
  // only — and the id is judged again here, whatever the native side did.
  function _parseWidgetLink(url) {
    var m = /^psync:\/\/bookings\/?(?:\?([^#]*))?(?:#.*)?$/i.exec(String(url || ''));
    if (!m) return null;
    var found = /(?:^|&)event=([^&]*)/.exec(m[1] || '');
    var eventId = null;
    if (found && found[1]) {
      try { eventId = decodeURIComponent(found[1]); } catch (e) { eventId = null; }
    }
    // Event ids are numeric. The router only ever opens the sheet of a class
    // the user already holds, but there is still no reason to pass it a
    // string nothing in this app could have produced.
    if (eventId !== null && !/^\d+$/.test(eventId)) eventId = null;
    return { eventId: eventId };
  }

  // Same landing as a class-reminder tap: My Bookings, then that class's sheet
  // (only while the seat is still held). With no id it is My Bookings alone —
  // NOT the router's own "no id" case, which is the weekly reminder's (the
  // usual-week review, or Discover on the dates that just opened).
  function handleWidgetURL(info) {
    try {
      var link = _parseWidgetLink(info && info.url);
      if (!link) return;
      if (link.eventId) { _routeNotificationTap(link.eventId); return; }
      if (typeof window.switchTab === 'function') window.switchTab('bookings');
    } catch (e) {
      try { console.warn('[native-widget] link handling failed:', e); } catch (_) {}
    }
  }
  // ── pure:widget-link:end

  // The in-app PsycleDeepLink plugin RETAINS the URL until this listener
  // attaches — a widget tap usually cold-launches the app. This script is the
  // last deferred one, so switchTab/openClassDetail already exist when the
  // retained tap is replayed here. (Swift on the iPhone; on Android its Java
  // twin, which retains the event the same way — retainUntilConsumed.)
  var PsycleDeepLink = Capacitor.Plugins.PsycleDeepLink;
  if (PsycleDeepLink && typeof PsycleDeepLink.addListener === 'function') {
    try {
      PsycleDeepLink.addListener('openURL', handleWidgetURL);
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
  //
  // ANDROID: the same three keys, through the same call. Its AppGroupPreferences
  // twin keeps them in ONE private SharedPreferences file that the home-screen
  // widget's provider reads; `group` still goes out and is ignored there
  // (Android has no app groups). Only set() is ever called from here, with
  // these three keys, each value a JSON string of a few kilobytes at most —
  // and, from the Android app alone, a fourth: 'countdown_enabled', '1' | '0',
  // once per pass, after the three and BEFORE the reload
  // (_androidCountdownSwitch, beside the class reminders below).
  // An EMPTY widget is a WRITTEN one — 'null' for the next class, '[]' for the
  // other two (a deliberate sign-out, or the last class cancelled): nothing is
  // ever removed, so a reader must take 'null' and '[]' as "nothing booked".

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

  // ── pure:ios-polish:start ── (DOM-free; tests/suites/ios-polish.js evaluates this block)
  // Widget / class-reminder decisions that need nothing native — keep the block
  // free of Capacitor, DOM and app globals (the suite evaluates it on its own).

  // The widget timeline shows the next few classes; reminders cover every
  // class held. They shared ONE list capped at 5, so the 6th class of a booked
  // week got no reminder, and booking an earlier class pushed an armed one out
  // of the list — cancelling it for a class still held. 40 + the 8 weekly ids
  // + snoozes stays under iOS's 64 pending requests; the input is
  // soonest-first, so the cap only ever drops the furthest classes.
  var WIDGET_UPCOMING_MAX = 5;
  var CLASS_REMINDER_MAX = 40;

  // A real seat, as opposed to a waitlist place — true even when the class's
  // details failed to load this pass (that makes it unknown, not gone).
  function _isHeldSeat(booking) {
    return !!booking && !booking.waitlisted;
  }

  // Stand-in for an _eventCache entry, built from app.js's saved copy of My
  // Bookings (psycle_bookings_snapshot), which RETAINS a held class whose
  // GET /events/{id} failed. Only the class's own facts are taken — the seats
  // always come from the live booking. start_at is passed through untouched so
  // a reminder armed from the cache is not re-armed when the fallback is used.
  function _evtFromSavedItem(item) {
    if (!item || !item.start_at) return null;
    return {
      start_at: item.start_at,
      _typeName: item.type || 'Class',
      _instrName: item.instructor || '',
      _locName: item.location || '',
      _studioName: item.studio || '',
    };
  }

  // Event ids whose armed reminder should go: the class is no longer wanted, or
  // its time moved (it is re-armed for the new time). `keep` = held seats whose
  // details could not be resolved this pass — absent from `wanted` only because
  // nothing is known about them, so their reminder stays. The calendar
  // reconcile has the same rule ("NEVER delete a live booking's event over
  // missing metadata"). Once T-90 has passed a reminder is never re-armed, so a
  // wrong cancel here is permanent.
  function _staleReminderIds(map, wanted, keep) {
    return Object.keys(map || {}).filter(function (evtId) {
      var w = (wanted || {})[evtId];
      if (!w) return !(keep && keep[evtId]);
      return w.startAt !== map[evtId].startAt;
    });
  }
  // ── pure:ios-polish:end ──

  // ── pure:native-snapshot:start ── (DOM-free; tests/suites/11-native-snapshot.js evaluates this block)
  // The Crisp Colour fields of a snapshot class entry: the class TYPE (`ct`) and
  // the member's CURRENT colours for it, as hex, for the light and the dark
  // appearance — so the widgets and the Live Activity wear the palette and the
  // intensity chosen in Membership → Appearance → Class colours. Every field is
  // OPTIONAL on the Swift side (PsycleShared/PsycleClassType.swift): a snapshot
  // without them decodes as before and is drawn in the app's default colours.
  // Keep the block free of Capacitor, DOM and app globals — the two things it
  // needs from the app are handed in.

  // The card ground at intensity "off": the app's own neutral surface (Cloud /
  // Graphite, css/theme.css) — the widget's card goes neutral as a class card
  // does, and only the small marks keep the colour.
  var SNAPSHOT_NEUTRAL_TINT = { light: '#FCFDFE', dark: '#1B2130' };

  // '#2d5fd6' → '#2D5FD6'; anything that is not six hex digits → null. Swift
  // fails safe on a bad value too, but a bad value is never written.
  function _snapHex(value) {
    var m = /^#([0-9a-f]{6})$/i.exec(String(value == null ? '' : value).trim());
    return m ? '#' + m[1].toUpperCase() : null;
  }

  // "RIDE: 45" → 'ride', through the app's OWN classTypeKey (js/app.js) — the
  // same answer data-ct gets. No copy of the category rules lives here: without
  // the app's function there is no `ct`, and Swift works the type out from the
  // class name (PsycleClassType.from(typeName:), which a test holds to
  // CATEGORY_MAP).
  function _snapClassTypeKey(typeName, keyFn) {
    if (typeof keyFn !== 'function') return null;
    try {
      var key = String(keyFn(typeName) || '').toLowerCase();
      return /^[a-z]{1,24}$/.test(key) ? key : null;
    } catch (e) {
      return null;
    }
  }

  // The colour fields for one class type, read from the app's colour engine
  // (`engine` = window.PsycleClassColours: get() → { intensity, map }, PALETTE,
  // DEFAULTS). {} when the engine is missing, or anything it says is not a
  // colour — all or nothing, so the widget never mixes the member's colours
  // with the defaults.
  //   ctTint  the card ground at the member's intensity: the full tint at
  //           "bold", the pale one at "soft", the NEUTRAL surface at "off"
  //   ctWash  the full tint — the pictogram tile's fill at "soft"
  //   ctBase  the class colour (seat chip; the tile at "off" / "bold")
  //   ctDeep  the hue ink that reads on the tint
  function _snapClassColourFields(key, engine) {
    try {
      if (!key || !engine || typeof engine.get !== 'function' || !engine.PALETTE) return {};
      var own = function (obj, k) { return !!obj && Object.prototype.hasOwnProperty.call(obj, k); };
      var state = engine.get() || {};
      var intensity = ['off', 'soft', 'bold'].indexOf(state.intensity) !== -1 ? state.intensity : 'soft';
      var name = own(state.map, key) ? state.map[key] : (own(engine.DEFAULTS, key) ? engine.DEFAULTS[key] : null);
      if (typeof name !== 'string' || !own(engine.PALETTE, name)) return {};
      var swatch = engine.PALETTE[name] || {};
      var out = { ctIntensity: intensity };
      var sides = [['light', ''], ['dark', 'Dark']];
      for (var i = 0; i < sides.length; i++) {
        var side = swatch[sides[i][0]] || {};
        var suffix = sides[i][1];
        var tint = intensity === 'off' ? SNAPSHOT_NEUTRAL_TINT[sides[i][0]]
          : intensity === 'bold' ? side.tintBold : side.tintSoft;
        var fields = { ctBase: _snapHex(side.base), ctTint: _snapHex(tint), ctDeep: _snapHex(side.deep), ctWash: _snapHex(side.tintBold) };
        var names = Object.keys(fields);
        for (var n = 0; n < names.length; n++) {
          if (!fields[names[n]]) return {};
          out[names[n] + suffix] = fields[names[n]];
        }
      }
      return out;
    } catch (e) {
      return {};
    }
  }
  // ── pure:native-snapshot:end ──

  // app.js's saved copy of My Bookings, by event id ({} when there is none).
  // Read-only here, and only ever consulted for an id the live _myBookings
  // holds — it never decides WHAT is held, only when/what that class is.
  function _savedItemsById() {
    var out = {};
    try {
      if (typeof _readBookingsSnapshot !== 'function') return out;
      var saved = _readBookingsSnapshot();
      ((saved && saved.items) || []).forEach(function (it) {
        if (it && it.id != null) out[String(it.id)] = it;
      });
    } catch (e) {}
    return out;
  }

  // Resolve a display-ready event object from the cache, or null. `known` =
  // the event already resolved by the caller (a cache entry, or the saved-copy
  // stand-in for a held class whose details failed to load).
  function _snapshotEventFor(eventId, known) {
    try {
      var evt = known || (_eventCache || {})[String(eventId)];
      if (!evt || !evt.start_at) return null;
      var booking = (_myBookings || {})[String(eventId)];
      var slots = (booking && Array.isArray(booking.slots)) ? booking.slots.slice() : [];
      var snap = {
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
      // Crisp Colour (optional on the Swift side): the class type and the
      // member's colours for it. Looked up at write time, so the widget wears
      // what Membership → Class colours says NOW. A failure here costs the
      // colours, never the class.
      try {
        var ct = _snapClassTypeKey(snap.typeName, typeof classTypeKey === 'function' ? classTypeKey : null);
        if (ct) {
          snap.ct = ct;
          var colours = _snapClassColourFields(ct, window.PsycleClassColours);
          Object.keys(colours).forEach(function (k) { snap[k] = colours[k]; });
        }
      } catch (e2) {}
      return snap;
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
  // True only while the clearToken wrapper (a deliberate sign-out) runs its pass.
  var _signOutPass = false;
  // The class colours the last WRITTEN snapshot carries (see the
  // 'classcolours:changed' listener below), and that listener's debounce.
  var _snapColourSig = null;
  var _colourSnapTimer = null;
  function _classColourSig() {
    try {
      var engine = window.PsycleClassColours;
      return engine && typeof engine.get === 'function' ? JSON.stringify(engine.get()) : '';
    } catch (e) {
      return '';
    }
  }

  function updateWidgetSnapshot() {
    try {
      var bookings = (typeof _myBookings !== 'undefined' && _myBookings) ? _myBookings : {};
      var cache = (typeof _eventCache !== 'undefined' && _eventCache) ? _eventCache : {};
      if (Object.keys(bookings).length === 0 && !_snapServerConfirmed) return;
      // Empty AND no token, but not a sign-out: the session expired and some
      // refetch ran fetchMyBookings' no-token branch, which empties the map.
      // Those classes are still booked — expiry keeps the snapshot serving the
      // widget / Live Activity / T-90 reminders until re-login, and an empty
      // write here ended the activity and cancelled every armed reminder.
      if (Object.keys(bookings).length === 0 && !_signOutPass &&
          typeof getBearerToken === 'function' && !getBearerToken()) return;
      var now = Date.now();

      // Collect upcoming booked events (have a cache entry + future start).
      // Waitlist places are NOT confirmed seats — the widget must not show
      // one as "Next class". start_at may be 'YYYY-MM-DD HH:MM:SS', which
      // iOS WebKit won't parse without the space→T normalization.
      var upcoming = [];
      // A held seat whose GET /events/{id} failed (weak signal at launch) has
      // no cache entry — that read as "not booked": widget blanked, its T-90
      // reminder cancelled, a running Live Activity retracted, while My
      // Bookings still held the seat. Fall back to the saved copy for when/what
      // the class is; with nothing known, remember it so its reminder survives.
      var savedById = null; // read lazily — the usual pass has every class cached
      var unknownSeats = {};
      for (var id in bookings) {
        if (!Object.prototype.hasOwnProperty.call(bookings, id)) continue;
        if (bookings[id] && bookings[id].waitlisted) continue;
        var evt = cache[String(id)];
        if (!evt || !evt.start_at) {
          if (!savedById) savedById = _savedItemsById();
          evt = _evtFromSavedItem(savedById[String(id)]);
          if (!evt) {
            if (_isHeldSeat(bookings[id])) unknownSeats[String(id)] = true;
            continue;
          }
        }
        var ts = new Date(String(evt.start_at).replace(' ', 'T')).getTime();
        if (isNaN(ts) || ts < now) continue;
        upcoming.push({ id: id, ts: ts, evt: evt });
      }
      upcoming.sort(function (a, b) { return a.ts - b.ts; });

      // 1) Next class snapshot (or null when nothing upcoming).
      var next = upcoming.length ? _snapshotEventFor(upcoming[0].id, upcoming[0].evt) : null;
      _writeSnapshotKey(WIDGET_NEXT_KEY, JSON.stringify(next));

      // 1b) The next few classes for the widget's self-advancing timeline —
      // and, from the same walk, EVERY class held for the reminders (see
      // CLASS_REMINDER_MAX). The widget key keeps its 5, so the Swift timeline
      // is untouched.
      var upcomingList = [];
      var reminderList = [];
      for (var ui = 0; ui < upcoming.length && reminderList.length < CLASS_REMINDER_MAX; ui++) {
        var snap = _snapshotEventFor(upcoming[ui].id, upcoming[ui].evt);
        if (!snap) continue;
        reminderList.push(snap);
        if (upcomingList.length < WIDGET_UPCOMING_MAX) upcomingList.push(snap);
      }
      _writeSnapshotKey(WIDGET_UPCOMING_KEY, JSON.stringify(upcomingList));

      // Backstop for the Live Activity's foreground-only constraint: a
      // local notification 90 minutes before each class. Tapping it opens
      // the app, which starts the countdown card.
      _scheduleClassReminders(reminderList, unknownSeats);

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
          // Same space→T normalization as startAt above. u.evt, not the cache:
          // a saved-copy class has no cache entry to read.
          byDay[dayKey] = { day: dayKey, count: 0, firstStart: String(u.evt.start_at).replace(' ', 'T') };
          // …and the type + colours of that first class (optional on the Swift
          // side), so a day can wear the colour of the class that opens it.
          var first = _snapshotEventFor(u.id, u.evt) || {};
          Object.keys(first).forEach(function (k) {
            if (k === 'ct' || /^ct[A-Z]/.test(k)) byDay[dayKey][k] = first[k];
          });
        }
        byDay[dayKey].count++;
      }
      var week = Object.keys(byDay).sort().map(function (k) { return byDay[k]; });
      _writeSnapshotKey(WIDGET_WEEK_KEY, JSON.stringify(week));
      // All three keys are written: these are the class colours they carry.
      _snapColourSig = _classColourSig();

      // The Android app's countdown follows the Class reminders switch, which
      // only this page can read: handed over with the snapshot, before the
      // reload that has the native side plan. Nothing at all on the iPhone.
      _androidCountdownSwitch();

      // Hint the native side to reload widget timelines, if a reload plugin
      // is wired up. No-op otherwise. (See NATIVE_FEATURES.md.) ONE reload per
      // pass, after its three writes — which are not awaited: a plugin's set()
      // must have stored the value by the time it returns. (Android: the
      // WidgetCenter twin asks the widget's provider to paint again, and the
      // class countdown to be planned again from what was just written.)
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
  // Permission-gated (scheduling never prompts — the toggle's enable() and
  // the first-booking ask below do) and idempotent per snapshot pass: stale
  // reminders (cancelled or moved classes) are cancelled, missing ones
  // scheduled. IDs live in the 8000–8899 range (weekly reminder owns
  // 9992–9999).

  var CLASS_REMINDER_PREF = 'psycle_class_reminders'; // 'off' disables; default ON
  var CLASS_REMINDER_MAP = 'psycle_class_reminder_map'; // {eventId: {id, startAt}}

  // The reminder's body: the instructor, the place and — on the iPhone — what
  // a tap is for. "The live countdown" is the iPhone's Live Activity, which only
  // a foreground app may start: the tap is what starts it, so the body asks for
  // the tap. The Android app's countdown is a notification of its own that
  // arrives by itself, beside this one — there is nothing to ask for. Built as
  // ONE list, so a class with no instructor and no place never begins with a
  // separator.
  function _classReminderBody(c) {
    var parts = [c.instrName, c.locName || c.studioName];
    if (!IS_ANDROID) parts.push('Open Psync for the live countdown');
    return parts.filter(Boolean).join(' · ');
  }

  function _classRemindersEnabled() {
    return localStorage.getItem(CLASS_REMINDER_PREF) !== 'off';
  }

  // ── The Android countdown's switch ───────────────────────────────
  // The Android app has no Live Activity. What stands in for it is ONE silent,
  // ongoing notification that counts down to the next held class, from 90
  // minutes before it until it starts. It is planned and posted NATIVELY, from
  // the widget snapshot the twins already store (ios-app/android/): nothing
  // here schedules it, and it is not the T-90 reminder above, which stays as
  // it is. What the native side cannot read is the member's switch — the
  // countdown follows Class reminders (CLASS_REMINDER_PREF), and that lives in
  // localStorage. So each snapshot pass hands it over as one more key through
  // the AppGroupPreferences twin, '1' | '0', after the pass's three keys and
  // BEFORE its reload, which is when the native side plans. Whether Psync may
  // post at all is the native side's to judge, silently: nothing here asks for
  // permission. An app built before the key (its twin refuses a key it does not
  // know) or before the twins (no such plugin) is served without a word —
  // _appGroupSet swallows both. On the iPhone: not one call.
  var COUNTDOWN_ENABLED_KEY = 'countdown_enabled';
  var _countdownSwitchSends = 0; // how many times the switch went out (see _androidCountdownFlipped)
  function _androidCountdownSwitch() {
    if (!IS_ANDROID) return;
    _countdownSwitchSends++;
    _appGroupSet(COUNTDOWN_ENABLED_KEY, _classRemindersEnabled() ? '1' : '0');
  }

  // The member flipped Class reminders. A snapshot pass carries the switch
  // (enable() runs one) — but a pass that ends early writes nothing (nothing
  // held and the server not heard yet; an expired session, whose snapshot is
  // kept and may be counting down), and disable() runs none. Then the switch
  // goes out by itself, with a reload of its own, so the countdown appears or
  // goes at once and not at the next booking change. `sendsBefore` =
  // _countdownSwitchSends as it was before the flip: a pass that did carry the
  // switch is not repeated.
  function _androidCountdownFlipped(sendsBefore) {
    if (!IS_ANDROID || _countdownSwitchSends !== sendsBefore) return;
    _androidCountdownSwitch();
    try {
      var WC = Capacitor.Plugins.WidgetCenter || Capacitor.Plugins.WidgetReloader;
      if (WC && typeof WC.reloadAllTimelines === 'function') {
        WC.reloadAllTimelines().catch(function () {});
      }
    } catch (e) {}
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
  // `unknownSeats` = {eventId: true} for held seats this pass knew nothing
  // about (see _staleReminderIds) — captured with the list, so a queued pass
  // reconciles against the state it was computed from.
  function _scheduleClassReminders(upcomingList, unknownSeats) {
    _reminderChain = _reminderChain
      .then(function () { return _scheduleClassRemindersInner(upcomingList, unknownSeats); })
      .catch(function () {});
    return _reminderChain;
  }

  async function _scheduleClassRemindersInner(upcomingList, unknownSeats) {
    if (!LocalNotifications || !_classRemindersEnabled()) return;
    try {
      var perm = await LocalNotifications.checkPermissions();
      if (perm.display !== 'granted') return; // never prompt from the automatic path

      var map = _loadReminderMap();
      var wanted = {}; // eventId -> entry
      (upcomingList || []).forEach(function (c) { wanted[String(c.eventId)] = c; });

      // Cancel reminders for classes no longer upcoming or whose time moved —
      // never for a held seat that is merely unknown this pass.
      var toCancel = [];
      _staleReminderIds(map, wanted, unknownSeats).forEach(function (evtId) {
        toCancel.push({ id: map[evtId].id });
        delete map[evtId];
      });
      if (toCancel.length) {
        try { await LocalNotifications.cancel({ notifications: toCancel }); } catch (e) {}
        // cancel() only removes PENDING requests — a banner already delivered
        // for a class since cancelled would sit in Notification Center.
        if (typeof LocalNotifications.removeDeliveredNotifications === 'function') {
          try { await LocalNotifications.removeDeliveredNotifications({ notifications: toCancel }); } catch (e) {}
        }
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
        toSchedule.push(_forAndroid({
          id: id,
          title: (c.typeName || 'Class') + ' starts in 90 minutes',
          body: _classReminderBody(c),
          schedule: { at: new Date(fireAt), allowWhileIdle: true },
          sound: 'default',
          extra: { eventId: evtId },
        }, ANDROID_CHANNEL_CLASSES));
      });
      if (toSchedule.length) {
        if (IS_ANDROID) await _ensureAndroidChannels();
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
      var sends = _countdownSwitchSends;
      updateWidgetSnapshot(); // re-runs scheduling with current classes
      _androidCountdownFlipped(sends); // Android: the countdown comes back with them
      return true;
    },
    disable: async function () {
      localStorage.setItem(CLASS_REMINDER_PREF, 'off');
      _androidCountdownFlipped(_countdownSwitchSends); // Android: the countdown goes with them, at once
      var map = _loadReminderMap();
      var ids = Object.keys(map).map(function (k) { return { id: map[k].id }; });
      if (ids.length && LocalNotifications) {
        try { await LocalNotifications.cancel({ notifications: ids }); } catch (e) {}
      }
      _saveReminderMap({});
    },
  };

  // ── First-booking ask ────────────────────────────────────────────
  // The pref defaults ON, but only the Settings switch ever requested
  // notification permission — and it looked on already, so nobody tapped it
  // and the reminders never armed. Ask in-app ONCE, right after a booking
  // (when "remind me before class" means something), never at launch. iOS
  // shows its own prompt a single time, so it only follows an in-app yes.
  var CLASS_REMINDER_ASKED = 'psycle_class_reminder_asked'; // '1' once answered (mirrored via SYNC_KEYS)
  var ASK_POLL_MS = 1000;
  var ASK_GIVE_UP_MS = 40000;
  var _reminderAskBusy = false; // "book my week" emits booking:complete in bursts
  var _reminderAskVoid = 0; // bumped by a waitlist join — drops an ask still waiting its turn

  // Anything the ask would land on top of. The "Booked!" sheet or a confirm
  // dialog (confirmModal is single-instance, so opening ours would cancel the
  // one on screen) — and every other overlay: the ask sits above them all, so
  // it would interrupt a seat being picked, or a history sync mid-run. These
  // are built on open and removed on close, so presence = showing. The
  // usual-week sheet too: a run inside it emits booking:complete per seat, and
  // an ask opening over it would sit on top of a run that spends credits.
  var ASK_BLOCKING_IDS = [
    'bookingConfirmation', 'psycleConfirmOverlay', 'usualWeekSheet', 'classDetailOverlay',
    'syncPromptOverlay', 'onboardOverlay', 'instructorModalOverlay',
    'historyModalOverlay', 'settingsOverlay', 'diagOverlay', 'yearReviewOverlay',
  ];
  function _askBlocked() {
    for (var i = 0; i < ASK_BLOCKING_IDS.length; i++) {
      if (document.getElementById(ASK_BLOCKING_IDS[i])) return true;
    }
    // The bike picker is static markup toggled by display — judge by that.
    var bike = document.getElementById('bikeModal');
    return !!(bike && bike.style && bike.style.display && bike.style.display !== 'none');
  }

  function _askStillWanted() {
    return _classRemindersEnabled() && !localStorage.getItem(CLASS_REMINDER_ASKED);
  }

  async function _maybeAskClassReminders() {
    if (_reminderAskBusy || !LocalNotifications || typeof window.confirmModal !== 'function') return;
    if (!_askStillWanted()) return;
    _reminderAskBusy = true;
    try {
      var perm = await LocalNotifications.checkPermissions();
      // 'granted' needs no ask; 'denied' can't be prompted again (the switch
      // in Settings explains). Neither counts as an answer to THIS question.
      if (perm.display !== 'prompt') return;

      // Never look synchronously: some flows emit booking:complete BEFORE
      // they show the sheet. Wait until the UI has been clear for two polls
      // running, so we don't land in the gap between a sheet closing and the
      // next one (or a dialog) opening.
      var startedAt = Date.now();
      var voidAt = _reminderAskVoid;
      var clearPolls = 0;
      while (clearPolls < 2) {
        await new Promise(function (resolve) { setTimeout(resolve, ASK_POLL_MS); });
        // Timers freeze while the app is backgrounded, so also judge by the
        // clock: long after the booking the moment has passed — try again
        // after a later one rather than popping up out of nowhere.
        if (Date.now() - startedAt > ASK_GIVE_UP_MS) return;
        if (voidAt !== _reminderAskVoid) return;
        clearPolls = _askBlocked() ? 0 : clearPolls + 1;
      }
      if (document.visibilityState === 'hidden' || !_askStillWanted()) return;

      var displaced = false;
      var yes = await window.confirmModal({
        title: 'Remind you 90 minutes before class?',
        // (Android has no Live Activity to tap for: its countdown is a second,
        // silent notification, and one yes here allows both.)
        body: IS_ANDROID ? 'Psync can send a notification 90 minutes before each class you book, and a countdown until it starts.'
          : 'Psync can send a notification 90 minutes before each class you book. Tap it for the live countdown.',
        confirmText: 'Remind me',
        cancelText: 'Not now',
        onReplaced: function () { displaced = true; },
      });
      // Pushed aside by another dialog is not an answer — ask after a later booking.
      if (displaced) return;
      localStorage.setItem(CLASS_REMINDER_ASKED, '1');
      if (yes) {
        var armed = await window._nativeClassReminders.enable(); // the iOS prompt
        if (armed && typeof window.toast === 'function') {
          window.toast('Class reminders on', 'success');
        }
      }
      // Keep the Settings switch honest if the panel happens to be open.
      if (typeof window.renderReminderRow === 'function') window.renderReminderRow();
    } catch (e) {
      /* best-effort — never let the ask disturb a booking */
    } finally {
      _reminderAskBusy = false;
    }
  }

  if (typeof PsycleEvents !== 'undefined' && PsycleEvents && typeof PsycleEvents.on === 'function') {
    try { PsycleEvents.on('booking:complete', function () { _maybeAskClassReminders(); }); } catch (e) {}
    // A waitlist place is not a seat and gets no reminder. An ask still waiting
    // for the UI to clear would open right after "On the waitlist!" and read as
    // being about THAT class — drop it; the next real booking asks again.
    try { PsycleEvents.on('waitlist:joined', function () { _reminderAskVoid++; }); } catch (e) {}
  }

  // ── Usual-week ask: the Monday reminder, offered in context ──────
  // The weekly reminder defaults OFF and its switch sits in Settings, where
  // nobody looks for it. Offer it ONCE, in-app, at the moment it means
  // something: a usual week has just been saved, or its review sheet has just
  // closed — a week saved by an earlier build never meets "Save" again
  // (js/tabs.js calls this at both, behind a typeof guard — on the web this
  // function does not exist, so nothing about a reminder appears where it
  // cannot work). Same manners as the ask above:
  // never at launch, never over another dialog or the usual-week sheet, and
  // iOS's own prompt only ever follows an in-app yes. A yes turns the reminder
  // on and nothing else: the notification's tap opens a REVIEW, never a booking.
  var WEEKLY_REMINDER_ASKED = 'psycle_weekly_reminder_asked'; // '1' once answered (mirrored via SYNC_KEYS)
  var _weeklyAskBusy = false;
  var _weeklyAskSince = 0; // when the offer was last called for: the give-up clock runs from there

  function _weeklyOfferFacts(permission) {
    return {
      hasUsualWeek: _usualWeekSaved(),
      asked: !!localStorage.getItem(WEEKLY_REMINDER_ASKED),
      pref: localStorage.getItem(REMINDER_PREF),
      permission: permission,
    };
  }

  window._offerWeeklyReminder = async function (reason) {
    // Called for again while an ask still waits its turn (saved, then straight
    // into a review that outlasts ASK_GIVE_UP_MS — js/tabs.js offers it again
    // when that sheet closes): the moment is NOW, so the clock starts over.
    // Still one ask, never two.
    if (_weeklyAskBusy) { _weeklyAskSince = Date.now(); return; }
    if (!LocalNotifications || typeof window.confirmModal !== 'function') return;
    _weeklyAskBusy = true;
    try {
      if (_weeklyOfferDecision(_weeklyOfferFacts()) !== 'ask') return;
      var perm = await LocalNotifications.checkPermissions();
      if (_weeklyOfferDecision(_weeklyOfferFacts(perm.display)) !== 'ask') return;

      // As above: wait until the UI has been clear for two polls running (the
      // "Replace your usual week?" confirm has only just closed), and give up
      // by the clock — long after the save the moment has passed.
      _weeklyAskSince = Date.now();
      var clearPolls = 0;
      while (clearPolls < 2) {
        await new Promise(function (resolve) { setTimeout(resolve, ASK_POLL_MS); });
        if (Date.now() - _weeklyAskSince > ASK_GIVE_UP_MS) return;
        clearPolls = _askBlocked() ? 0 : clearPolls + 1;
      }
      if (document.visibilityState === 'hidden') return;
      if (_weeklyOfferDecision(_weeklyOfferFacts(perm.display)) !== 'ask') return;

      var displaced = false;
      var yes = await window.confirmModal({
        title: 'Remind you on Mondays at 12:00, when new dates open?',
        body: 'Tap the reminder to review your usual week for those dates. Nothing is booked until you confirm.',
        confirmText: 'Remind me',
        cancelText: 'Not now',
        onReplaced: function () { displaced = true; },
      });
      // Pushed aside by another dialog is not an answer — ask after a later save.
      if (displaced) return;
      localStorage.setItem(WEEKLY_REMINDER_ASKED, '1');
      if (yes) {
        var armed = await window._nativeReminder.enable(); // the iOS prompt, when it is still owed
        if (typeof window.toast === 'function') {
          window.toast(armed ? 'Monday reminder on' : 'Enable notifications for Psync in ' + (IS_ANDROID ? 'Android' : 'iOS') + ' Settings first', armed ? 'success' : 'error');
        }
      }
      if (typeof window.pushAction === 'function') {
        // The action log goes into bug reports: a bounded slug, never free text.
        var why = String(reason || '').replace(/[^a-z0-9-]/gi, '').slice(0, 32);
        try { window.pushAction('weekly-reminder:offer ' + (yes ? 'yes' : 'no') + ' after=' + why); } catch (e) {}
      }
      // Keep the Settings switch honest if the panel happens to be open.
      if (typeof window.renderReminderRow === 'function') window.renderReminderRow();
    } catch (e) {
      /* best-effort — never let the ask disturb a save */
    } finally {
      _weeklyAskBusy = false;
    }
  };

  // Deliberate sign-out must blank the snapshot and cancel pending class
  // reminders — otherwise the previous account's classes stay on the widget
  // forever (the unconfirmed-empty guard would keep skipping) and their
  // "starts in 90 minutes" notifications keep firing. Session EXPIRY is
  // deliberately not wrapped: the bookings still exist server-side, so the
  // stale-but-true snapshot should keep serving the widget until re-login.
  // One rule for both apps: the Android widget is emptied by this same pass
  // ('null', '[]', '[]' through its twins, then one reload) and by nothing
  // else — an expired session leaves it serving the classes still held.
  var _origClearTokenNative = window.clearToken;
  if (typeof _origClearTokenNative === 'function') {
    window.clearToken = function () {
      var result = _origClearTokenNative.apply(this, arguments);
      _snapServerConfirmed = true; // empty is now the truth
      _signOutPass = true; // …and the one tokenless-and-empty pass that MUST blank
      try { updateWidgetSnapshot(); } catch (e) {} finally { _signOutPass = false; }
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
      // The snapshot carries the member's class colours, so a change in
      // Membership → Class colours rewrites it (and with it the widgets and a
      // Live Activity that is up). The event also fires on a light ↔ dark
      // switch, which changes nothing the snapshot holds — both appearances
      // are always written — so that is skipped. Arrow keys in a swatch row
      // choose as they move, one event per swatch: one rewrite once they stop.
      PsycleEvents.on('classcolours:changed', function () {
        clearTimeout(_colourSnapTimer);
        _colourSnapTimer = setTimeout(function () {
          _colourSnapTimer = null;
          if (_classColourSig() === _snapColourSig) return;
          updateWidgetSnapshot();
        }, 250);
      });
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

  // ── pure:android-bridge:start ── (DOM-free; tests/suites/18-android.js evaluates this block)
  // The ground of the theme in force, for the Android status bar: the `bg` of
  // its APP_THEMES entry (js/theme.js) — the registry the glyph style is read
  // from, and the colour the web build gives <meta name="theme-color">. No such
  // theme, or none set yet (following the system): the first theme on that
  // base, which is what js/theme.js falls back to (Cloud / Graphite). Anything
  // that is not #rrggbb → null, and the bar is left as it is: the plugin
  // rejects a colour it cannot parse.
  function _themeGround(registry, themeId, base) {
    var list = Array.isArray(registry) ? registry : [];
    var hit = null, i;
    for (i = 0; i < list.length && !hit; i++) {
      if (list[i] && themeId && list[i].id === themeId) hit = list[i];
    }
    for (i = 0; i < list.length && !hit; i++) {
      if (list[i] && list[i].base === base) hit = list[i];
    }
    var bg = hit && hit.bg;
    return (typeof bg === 'string' && /^#[0-9a-f]{6}$/i.test(bg)) ? bg : null;
  }
  // ── pure:android-bridge:end ──

  function updateStatusBar() {
    var StatusBar = window.Capacitor && Capacitor.Plugins.StatusBar;
    if (!StatusBar) return; // @capacitor/status-bar not installed/synced yet
    var themeId = document.documentElement.getAttribute('data-theme');
    // Resolve the theme's light/dark BASE from the registry — theme ids are
    // flavour names (cloud/graphite/terminal/...), never 'light'.
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
    // Android only: there the status bar is a band of its own colour ABOVE the
    // web view (on iOS the page is drawn under it), so it wears the theme's
    // ground — at launch and on every theme change, like the glyphs below.
    // setBackgroundColor does nothing on iOS and is never called there.
    if (IS_ANDROID && typeof StatusBar.setBackgroundColor === 'function') {
      var ground = _themeGround(window.APP_THEMES, themeId, base);
      if (ground) {
        try { StatusBar.setBackgroundColor({ color: ground }).catch(function () {}); } catch (e) {}
      }
    }
    // The plugin's Style enum names the BACKGROUND it is meant for, not the
    // glyph colour (definitions.d.ts): 'LIGHT' = "Dark text for light
    // backgrounds", 'DARK' = "Light text for dark backgrounds". Reading them
    // the other way round left the clock/battery invisible in every theme.
    if (base === 'light') {
      StatusBar.setStyle({ style: 'LIGHT' }).catch(function () {}); // dark glyphs on a light theme
    } else {
      StatusBar.setStyle({ style: 'DARK' }).catch(function () {}); // light glyphs on a dark theme
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
   * Includes: the platform, device model, OS version, app version, action log,
   * error log, localStorage summary.
   */
  window.getDiagnosticReport = async function () {
    var sections = [];
    // Which app this is, asked here rather than read off the bridge's own
    // PLATFORM: tests/suites/owner-tools.js runs this function on its own.
    var platform = 'unknown';
    try {
      if (typeof Capacitor.getPlatform === 'function') platform = String(Capacitor.getPlatform());
    } catch (e) {}
    sections.push('=== Psycle ' + (platform === 'android' ? 'Android' : 'iOS') + ' Diagnostic Report ===');
    sections.push('Platform: ' + platform);
    sections.push('Generated: ' + new Date().toISOString());
    // Which build, on what: neither the Device nor the App plugin below is
    // installed, so without these two lines a tester's report named no build,
    // device or iOS version. settings.js works the build id out of the
    // bundled sw.js (getAppVersion, capped at 2s).
    var build = null;
    try { if (typeof window.getAppVersion === 'function') build = await window.getAppVersion(); } catch (e) {}
    sections.push('Build: ' + (build || window.APP_VERSION || 'unknown'));
    sections.push('User Agent: ' + navigator.userAgent);
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
