/**
 * reliability.js — Reliability enhancements for Psycle Booking PWA
 *
 * Adds: retry with exponential backoff, optimistic UI for bookings,
 *       silent token refresh, offline booking queue, global error tracking.
 *
 * Loaded AFTER app.js — monkey-patches global functions.
 */

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════
  // E. Global Error Tracking (register first so it catches everything)
  // ═══════════════════════════════════════════════════════════════════

  const ERROR_LOG_KEY = 'psycle_error_log';
  const ACTION_LOG_KEY = 'psycle_action_log';
  const MAX_LOG_ENTRIES = 100;

  function pushError(msg) {
    let log = [];
    try { log = JSON.parse(localStorage.getItem(ERROR_LOG_KEY) || '[]'); } catch {}
    log.push({ timestamp: new Date().toISOString(), message: String(msg) });
    if (log.length > MAX_LOG_ENTRIES) log = log.slice(log.length - MAX_LOG_ENTRIES);
    try { localStorage.setItem(ERROR_LOG_KEY, JSON.stringify(log)); } catch {}
    console.error('[psycle-error]', msg);
  }

  /** Log a user action (action name + timestamp only, no sensitive data). */
  function pushAction(action) {
    let log = [];
    try { log = JSON.parse(localStorage.getItem(ACTION_LOG_KEY) || '[]'); } catch {}
    log.push({ timestamp: new Date().toISOString(), action: String(action) });
    if (log.length > MAX_LOG_ENTRIES) log = log.slice(log.length - MAX_LOG_ENTRIES);
    try { localStorage.setItem(ACTION_LOG_KEY, JSON.stringify(log)); } catch {}
  }
  window.pushAction = pushAction;

  /** Log a network error (status + path only, no auth tokens). */
  function logNetworkError(path, status, method) {
    pushError('Network ' + (method || 'GET') + ' ' + path + ' → ' + status);
  }

  window.onerror = function (message, source, lineno, colno, error) {
    const detail = error && error.stack
      ? error.stack
      : `${message} at ${source}:${lineno}:${colno}`;
    pushError(detail);
  };

  window.onunhandledrejection = function (event) {
    const reason = event.reason;
    const msg = reason instanceof Error
      ? (reason.stack || reason.message)
      : String(reason);
    pushError('UnhandledRejection: ' + msg);
  };

  /** Retrieve the error log for debugging. */
  window.getErrorLog = function () {
    try { return JSON.parse(localStorage.getItem(ERROR_LOG_KEY) || '[]'); } catch { return []; }
  };

  /** Retrieve the action log for debugging. */
  window.getActionLog = function () {
    try { return JSON.parse(localStorage.getItem(ACTION_LOG_KEY) || '[]'); } catch { return []; }
  };

  /** Get combined error + action log as a formatted string for bug reports. */
  window.getFullLog = function () {
    var errors = window.getErrorLog();
    var actions = window.getActionLog();
    // Merge and sort by timestamp
    var combined = [];
    errors.forEach(function (e) {
      combined.push({ ts: e.timestamp, type: 'ERROR', detail: e.message });
    });
    actions.forEach(function (a) {
      combined.push({ ts: a.timestamp, type: 'ACTION', detail: a.action });
    });
    combined.sort(function (a, b) { return a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0; });
    var lines = combined.map(function (entry) {
      return '[' + entry.ts + '] [' + entry.type + '] ' + entry.detail;
    });
    return lines.join('\n');
  };


  // ═══════════════════════════════════════════════════════════════════
  // E2. Action Logging Hooks
  // ═══════════════════════════════════════════════════════════════════
  // Hook into PsycleEvents to capture key user actions automatically.

  if (typeof PsycleEvents !== 'undefined') {
    PsycleEvents.on('booking:complete', function (eventId) {
      pushAction('booking:complete eventId=' + eventId);
    });
    PsycleEvents.on('booking:cancelled', function (eventId) {
      pushAction('booking:cancelled eventId=' + eventId);
    });
    PsycleEvents.on('seat:cancelled', function (eventId, slotId) {
      pushAction('seat:cancelled eventId=' + eventId + (slotId ? ' slot=' + slotId : ''));
    });
    PsycleEvents.on('bookings:loaded', function () {
      pushAction('bookings:loaded');
    });
    PsycleEvents.on('history:synced', function () {
      pushAction('history:synced');
    });
  }

  // Hook into switchTab to log tab switches
  var _origSwitchTabForLog = window.switchTab;
  if (_origSwitchTabForLog) {
    window.switchTab = function () {
      pushAction('tab:switch to=' + arguments[0]);
      return _origSwitchTabForLog.apply(this, arguments);
    };
  }

  // Hook into settings export/import
  var _origExportSettings = window.exportSettings;
  if (_origExportSettings) {
    window.exportSettings = function () {
      pushAction('settings:export');
      return _origExportSettings.apply(this, arguments);
    };
  }
  var _origImportSettings = window.importSettings;
  if (_origImportSettings) {
    window.importSettings = function () {
      pushAction('settings:import');
      return _origImportSettings.apply(this, arguments);
    };
  }

  // Hook into theme toggle
  var _origToggleTheme = window.toggleTheme;
  if (_origToggleTheme) {
    window.toggleTheme = function () {
      pushAction('settings:theme_toggle');
      return _origToggleTheme.apply(this, arguments);
    };
  }


  // ═══════════════════════════════════════════════════════════════════
  // A. Retry with Exponential Backoff
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Wraps fetch() with automatic retries on network errors and 5xx
   * responses. Does NOT retry 4xx (client errors).
   *
   * @param {string}  url
   * @param {object}  opts       - standard fetch options
   * @param {number}  maxRetries - default 3
   * @returns {Promise<Response>}
   */
  // Per-attempt timeout — hung requests should fail fast so callers can
  // retry or show an error, not leave buttons stuck on "…" forever.
  const FETCH_TIMEOUT_MS = 15000;

  window.fetchWithRetry = async function fetchWithRetry(url, opts, maxRetries = 3) {
    opts = opts || {};
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Chain caller-provided signal (if any) with our timeout signal so either
      // one aborts the request.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      const callerSignal = opts.signal;
      if (callerSignal) {
        if (callerSignal.aborted) ctrl.abort();
        else callerSignal.addEventListener('abort', () => ctrl.abort(), { once: true });
      }

      try {
        const res = await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
        clearTimeout(timer);

        if (res.status >= 400 && res.status < 500) return res;

        if (res.status >= 500) {
          lastError = new Error(`Server error ${res.status}`);
          if (attempt < maxRetries) { await _backoff(attempt); continue; }
          return res;
        }

        return res;
      } catch (err) {
        clearTimeout(timer);
        // If the caller aborted (not us), propagate immediately — no retry.
        if (callerSignal && callerSignal.aborted) throw err;
        // Our timeout fires as AbortError — treat as network error and retry.
        const isTimeout = err && err.name === 'AbortError';
        lastError = isTimeout ? new Error('Request timed out') : err;
        if (attempt < maxRetries) { await _backoff(attempt); continue; }
      }
    }
    throw lastError;
  };

  /** Exponential delay with jitter: base * 2^attempt + random 0-500ms */
  function _backoff(attempt) {
    const base = 1000; // 1 second
    const delay = base * Math.pow(2, attempt) + Math.random() * 500;
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  // Wrap the global apiFetch to use fetchWithRetry instead of raw fetch
  if (typeof apiFetch === 'function') {
    const _originalApiFetch = apiFetch;

    // Rebuild apiFetch with retry logic.  We reproduce the same header /
    // auth logic from app.js but swap fetch() for fetchWithRetry().
    window.apiFetch = function apiFetchWithRetry(path, opts) {
      if (opts === undefined) opts = {};
      var token = getBearerToken();
      var headers = Object.assign({ 'Accept': 'application/json' }, opts.headers || {});
      if (token) headers['Authorization'] = 'Bearer ' + token;

      return fetchWithRetry(apiUrl(path), Object.assign({}, opts, { headers: headers }))
        .then(function (res) {
          if ((res.status === 401 || res.status === 403) && getBearerToken()) {
            showSessionExpired();
          }
          // Log failed API calls (4xx/5xx) — path and status only, no tokens
          if (res.status >= 400) {
            logNetworkError(path, res.status, opts.method || 'GET');
          }
          return res;
        })
        .catch(function (err) {
          logNetworkError(path, 'NETWORK_ERROR', opts.method || 'GET');
          throw err;
        });
    };
    // Keep a reference for internal use
    window._originalApiFetch = _originalApiFetch;
  }


  // ═══════════════════════════════════════════════════════════════════
  // B. Optimistic UI for Bookings
  // ═══════════════════════════════════════════════════════════════════

  if (typeof submitBooking === 'function') {
    const _originalSubmitBooking = submitBooking;

    window.submitBooking = async function optimisticSubmitBooking(eventId, slots, btn) {
      // 1. Capture original state so we can revert on failure
      const origText = btn.textContent;
      const origClass = btn.className;
      const origDisabled = btn.disabled;
      const origOnclick = btn.onclick;
      const hadBooking = !!_myBookings[String(eventId)];
      const prevBooking = _myBookings[String(eventId)]
        ? JSON.parse(JSON.stringify(_myBookings[String(eventId)]))
        : undefined;

      // 2. Optimistically update UI immediately
      const optimisticLabel = (slots && slots.length)
        ? 'Bikes ' + slots.join(' & ') + ' \u2713'
        : 'Booked \u2713';
      btn.textContent = optimisticLabel;
      btn.className = 'book-btn booked';
      btn.disabled = true;

      // Optimistically add to _myBookings
      _myBookings[String(eventId)] = {
        bookingId: null, // unknown until server responds
        slots: slots ? slots.map(Number) : [],
      };

      // 3. Call the real submitBooking
      try {
        await _originalSubmitBooking(eventId, slots, btn);
        // On success the original function already sets the correct state,
        // so nothing more to do.
      } catch (err) {
        // 4. Revert on failure
        btn.textContent = origText;
        btn.className = origClass;
        btn.disabled = origDisabled;
        if (origOnclick) btn.onclick = origOnclick;

        // Revert _myBookings
        if (hadBooking && prevBooking) {
          _myBookings[String(eventId)] = prevBooking;
        } else {
          delete _myBookings[String(eventId)];
        }

        toast('Booking failed \u2014 please try again', 'error');
      }
    };
  }


  // ═══════════════════════════════════════════════════════════════════
  // C. Session Expiry Handling
  // ═══════════════════════════════════════════════════════════════════
  // Plaintext credential storage has been removed for security.
  // Token refresh is now handled via JWT expiry monitoring in security.js.
  // The showSessionExpired wrapper simply clears stale state and shows
  // the re-login banner.


  // ═══════════════════════════════════════════════════════════════════
  // D. Offline Booking Queue
  // ═══════════════════════════════════════════════════════════════════

  var OFFLINE_QUEUE_KEY = 'psycle_offline_queue';

  function getOfflineQueue() {
    try { return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]'); } catch { return []; }
  }

  function saveOfflineQueue(queue) {
    try { localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue)); } catch {}
  }

  /**
   * Enqueue a booking cancel for offline replay. bookingIds is the array
   * of per-seat booking ids (may be empty → falls back to event_id query).
   */
  function queueOfflineCancel(eventId, bookingIds) {
    var queue = getOfflineQueue();
    queue.push({
      type: 'cancel',
      eventId: eventId,
      bookingIds: (bookingIds || []).filter(Boolean),
      timestamp: new Date().toISOString(),
    });
    saveOfflineQueue(queue);
  }
  window.queueOfflineCancel = queueOfflineCancel;

  /**
   * Process all queued offline operations (bookings + cancels) when
   * connectivity is restored.
   */
  async function processOfflineQueue() {
    var queue = getOfflineQueue();
    if (queue.length === 0) return;

    var bookedOk = 0;
    var cancelOk = 0;
    var failed = 0;
    var remaining = [];

    for (var i = 0; i < queue.length; i++) {
      var item = queue[i];
      try {
        if (item.type === 'cancel') {
          var ids = (item.bookingIds && item.bookingIds.length)
            ? item.bookingIds
            : [null];
          var results = await Promise.all(ids.map(function (bid) {
            var path = bid ? '/bookings/' + bid : '/bookings?event_id=' + item.eventId;
            return apiFetch(path, { method: 'DELETE' });
          }));
          var isOk = function (r) { return r.ok || r.status === 204 || r.status === 200 || r.status === 404; };
          if (results.every(isOk)) {
            cancelOk++;
          } else if (results.some(function (r) { return r.status >= 500; })) {
            // Transient server error — retry later
            remaining.push(item);
            failed++;
          } else {
            // Client error (already cancelled, etc.) — drop, reconcile on fetch
            failed++;
          }
          continue;
        }

        // Default: booking (backwards compatible with legacy items)
        var body = { event_id: item.eventId };
        if (item.slots && item.slots.length) body.slots = item.slots.map(Number);

        var res = await apiFetch('/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(body),
        });

        if (res.ok) {
          bookedOk++;
          var data = await res.json().catch(function () { return {}; });
          var bookingId = (data.data && data.data.id) || data.id;
          _myBookings[String(item.eventId)] = {
            bookingId: bookingId,
            slots: item.slots ? item.slots.map(Number) : [],
          };
        } else if (res.status >= 400 && res.status < 500) {
          failed++;
        } else {
          remaining.push(item);
          failed++;
        }
      } catch (err) {
        remaining.push(item);
        failed++;
      }
    }

    saveOfflineQueue(remaining);

    if (bookedOk > 0) {
      toast(bookedOk + ' queued booking' + (bookedOk !== 1 ? 's' : '') + ' confirmed!', 'success');
    }
    if (cancelOk > 0) {
      toast(cancelOk + ' queued cancel' + (cancelOk !== 1 ? 's' : '') + ' sent', 'success');
    }
    if (bookedOk > 0 || cancelOk > 0) {
      if (typeof refreshUpcomingPanel === 'function') refreshUpcomingPanel();
      if (typeof fetchMyBookings === 'function') fetchMyBookings();
    }
    if (failed > 0 && remaining.length > 0) {
      toast(remaining.length + ' queued action' + (remaining.length !== 1 ? 's' : '') + ' still pending', 'info');
    } else if (failed > 0) {
      toast(failed + ' queued action' + (failed !== 1 ? 's' : '') + ' could not be completed', 'error');
    }
  }
  window.processOfflineQueue = processOfflineQueue;

  // Intercept submitBooking (already wrapped for optimistic UI above)
  // to catch offline state and queue instead of hitting the network.
  if (typeof window.submitBooking === 'function') {
    var _submitAfterOptimistic = window.submitBooking;

    window.submitBooking = async function offlineAwareSubmitBooking(eventId, slots, btn) {
      if (!navigator.onLine) {
        // Queue booking for later
        var queue = getOfflineQueue();
        queue.push({
          eventId: eventId,
          slots: slots ? slots.map(Number) : [],
          timestamp: new Date().toISOString(),
        });
        saveOfflineQueue(queue);

        // Show queued state on button
        btn.textContent = 'Queued';
        btn.className = 'book-btn booked';
        btn.disabled = true;
        toast("You're offline \u2014 booking queued", 'info');
        return;
      }

      return _submitAfterOptimistic(eventId, slots, btn);
    };
  }

  // When connection comes back, process the queue
  window.addEventListener('online', processOfflineQueue);


})();
