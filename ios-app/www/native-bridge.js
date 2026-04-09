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
    'psycle_theme', 'psycle_class_history',
    'psycle_notify_watchlist', 'psycle_calendar_data',
    'psycle_error_log', 'psycle_offline_queue',
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
  // Uses @ebarooni/capacitor-calendar plugin for EventKit access.

  var Calendar = Capacitor.Plugins.CapacitorCalendar;
  var CAL_EVENT_MAP_KEY = 'psycle_native_cal_events'; // { eventId: nativeCalEventId }

  function _loadCalMap() {
    try { return JSON.parse(localStorage.getItem(CAL_EVENT_MAP_KEY) || '{}'); } catch (e) { return {}; }
  }
  function _saveCalMap(map) {
    localStorage.setItem(CAL_EVENT_MAP_KEY, JSON.stringify(map));
  }

  // Geo data for studios (same as calendar.js)
  var STUDIO_GEO_NATIVE = {
    'oxford circus':  { lat: 51.5188, lon: -0.1402 },
    'bank':           { lat: 51.5155, lon: -0.0870 },
    'victoria':       { lat: 51.4955, lon: -0.1480 },
    'notting hill':   { lat: 51.5154, lon: -0.1910 },
    'london bridge':  { lat: 51.5055, lon: -0.0860 },
    'shoreditch':     { lat: 51.5215, lon: -0.0735 },
    'clapham':        { lat: 51.4622, lon: -0.1680 },
  };

  async function _ensureCalendarPermission() {
    try {
      var status = await Calendar.checkAllPermissions();
      if (status.readCalendar !== 'granted' || status.writeCalendar !== 'granted') {
        await Calendar.requestAllPermissions();
      }
      return true;
    } catch (e) {
      console.warn('[native-cal] permission denied:', e);
      return false;
    }
  }

  async function addBookingToCalendar(eventId) {
    if (!Calendar) return;
    var evt = (_eventCache || {})[String(eventId)];
    if (!evt) return;
    var booking = (_myBookings || {})[String(eventId)];
    if (!booking) return;

    var ok = await _ensureCalendarPermission();
    if (!ok) return;

    var start = new Date(evt.start_at);
    var end = new Date(start.getTime() + (evt.duration || 45) * 60 * 1000);
    var slots = booking.slots || [];
    var slotStr = slots.length === 1 ? 'Bike ' + slots[0]
      : slots.length > 1 ? 'Bikes ' + slots.join(' & ') : '';

    var title = (evt._typeName || 'Class') +
      (evt._instrName ? ' - ' + evt._instrName : '') +
      (slotStr ? ' (' + slotStr + ')' : '');

    var location = evt._locAddress
      ? (evt._locFullName || 'Psycle') + ', ' + evt._locAddress
      : evt._locFullName || evt._locName || '';

    var notes = [];
    if (evt._instrName) notes.push('Instructor: ' + evt._instrName);
    if (slotStr) notes.push(slotStr);
    if (evt._studioName) notes.push('Studio: ' + evt._studioName);
    notes.push('Duration: ' + (evt.duration || 45) + 'min');

    try {
      var result = await Calendar.createEvent({
        title: title,
        location: location,
        startDate: start.getTime(),
        endDate: end.getTime(),
        notes: notes.join('\n'),
        isAllDay: false,
      });

      if (result && result.id) {
        var map = _loadCalMap();
        map[String(eventId)] = result.id;
        _saveCalMap(map);
        console.log('[native-cal] added event:', eventId, '→', result.id);
      }
    } catch (e) {
      console.warn('[native-cal] failed to add event:', e);
    }
  }

  async function removeBookingFromCalendar(eventId) {
    if (!Calendar) return;
    var map = _loadCalMap();
    var calEventId = map[String(eventId)];
    if (!calEventId) return;

    try {
      await Calendar.deleteEvent({ id: calEventId });
      delete map[String(eventId)];
      _saveCalMap(map);
      console.log('[native-cal] removed event:', eventId);
    } catch (e) {
      console.warn('[native-cal] failed to remove event:', e);
    }
  }

  // Hook into booking/cancel functions
  var _origSubmitBookingNative = window.submitBooking;
  if (_origSubmitBookingNative) {
    window.submitBooking = async function (eventId, slots, btn) {
      await _origSubmitBookingNative.call(this, eventId, slots, btn);
      // If booking succeeded, add to native calendar
      if (btn.classList.contains('booked')) {
        addBookingToCalendar(eventId);
      }
    };
  }

  var _origConfirmUnbookNative = window.confirmUnbook;
  if (_origConfirmUnbookNative) {
    window.confirmUnbook = async function (bookingId, eventId, btn) {
      await _origConfirmUnbookNative.call(this, bookingId, eventId, btn);
      // If cancel succeeded (booking removed from _myBookings)
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

  // Sync all existing bookings to calendar on first load
  async function syncAllBookingsToCalendar() {
    var ok = await _ensureCalendarPermission();
    if (!ok) return;
    var map = _loadCalMap();
    var bookings = _myBookings || {};

    // Add any bookings not yet in calendar
    for (var evtId of Object.keys(bookings)) {
      if (!map[evtId] && _eventCache[evtId]) {
        await addBookingToCalendar(evtId);
      }
    }

    // Remove calendar events for cancelled bookings
    for (var calEvtId of Object.keys(map)) {
      if (!bookings[calEvtId]) {
        await removeBookingFromCalendar(calEvtId);
      }
    }
  }

  // Run sync after bookings load
  var _origRenderNative = window.renderMyBookings;
  var _calSynced = false;
  if (_origRenderNative) {
    window.renderMyBookings = function () {
      _origRenderNative.apply(this, arguments);
      if (!_calSynced && Object.keys(_myBookings || {}).length > 0) {
        _calSynced = true;
        syncAllBookingsToCalendar();
      }
    };
  }

  // Expose for manual trigger
  window.syncAllBookingsToCalendar = syncAllBookingsToCalendar;


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


  console.log('[native] Native bridge initialized');
})();
