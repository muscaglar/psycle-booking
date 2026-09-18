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
  // Exposed so earlier-loading modules (e.g. security.js) can record errors
  // once this module is up — they must guard with a typeof check.
  window.pushError = pushError;

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
    PsycleEvents.on('waitlist:joined', function (eventId) {
      pushAction('waitlist:joined eventId=' + eventId);
    });
    PsycleEvents.on('waitlist:left', function (eventId) {
      pushAction('waitlist:left eventId=' + eventId);
    });
    PsycleEvents.on('waitlist:claimed', function (eventId) {
      pushAction('waitlist:claimed eventId=' + eventId);
    });
    PsycleEvents.on('waitlist:allocated', function (eventIds) {
      pushAction('waitlist:allocated eventIds=' + (eventIds || []).join(','));
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
    // Callers may pass opts.retries to override the retry count.
    window.apiFetch = function apiFetchWithRetry(path, opts) {
      if (opts === undefined) opts = {};
      var token = getBearerToken();
      var headers = Object.assign({ 'Accept': 'application/json' }, opts.headers || {});
      if (token) headers['Authorization'] = 'Bearer ' + token;

      // POST is not idempotent here: a timed-out POST /bookings may have
      // booked server-side, and an automatic retry can double-book (the
      // retry's 409 then reads as "failed" to the caller). GETs/DELETEs
      // retry as before (a re-DELETE of a gone booking is a harmless 404).
      var method = String(opts.method || 'GET').toUpperCase();
      var maxRetries = (typeof opts.retries === 'number') ? opts.retries : (method === 'POST' ? 0 : 3);

      return fetchWithRetry(apiUrl(path), Object.assign({}, opts, { headers: headers }), maxRetries)
        .then(function (res) {
          // 401-only: 403 is a business-rule denial with a valid session
          // (matches the base apiFetch in app.js).
          if (res.status === 401 && getBearerToken()) {
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

  // (The optimistic wrapper below detects ALL in-band failures — including
  // session expiry — by checking for the ✓ success marker after the original
  // returns, so no separate session-expiry tracking is needed.)

  if (typeof submitBooking === 'function') {
    const _originalSubmitBooking = submitBooking;

    // NOTE: every submitBooking wrapper must forward ALL four arguments (opts
    // included) so options survive the whole chain. Waitlist joins no longer
    // come through here at all (joinWaitlist \u2192 PUT /waitlists); a legacy
    // {waitlist:true} caller is passed straight to the original, which
    // redirects it, so no optimistic *booking* entry is ever written for it.
    window.submitBooking = async function optimisticSubmitBooking(eventId, slots, btn, opts) {
      if (opts && opts.waitlist) return _originalSubmitBooking(eventId, slots, btn, opts);
      // 1. Capture original state so we can revert on failure
      const origText = btn.textContent;
      const origClass = btn.className;
      const origDisabled = btn.disabled;
      const origOnclick = btn.onclick;
      const hadBooking = !!_myBookings[String(eventId)];
      const prevBooking = _myBookings[String(eventId)]
        ? JSON.parse(JSON.stringify(_myBookings[String(eventId)]))
        : undefined;

      function revertBookingEntry() {
        if (hadBooking && prevBooking) {
          _myBookings[String(eventId)] = prevBooking;
        } else {
          delete _myBookings[String(eventId)];
        }
      }

      function revertOptimistic() {
        btn.textContent = origText;
        btn.className = origClass;
        btn.disabled = origDisabled;
        if (origOnclick) btn.onclick = origOnclick;
        revertBookingEntry();
      }

      // 2. Optimistically update UI immediately
      const optimisticLabel = (slots && slots.length)
        ? formatSlots(slotLabelForEvent(eventId), slots) + ' \u2713'
        : 'Booked \u2713';
      btn.textContent = optimisticLabel;
      btn.className = 'book-btn booked';
      btn.disabled = true;

      // Optimistically add to _myBookings (a waitlist place already held for
      // this class rides along so a revert can restore it).
      _myBookings[String(eventId)] = {
        bookingId: null, // unknown until server responds
        slots: slots ? slots.map(Number) : [],
        slotBookings: {},
        waitlisted: false,
      };
      // "+ Add spot" on a class we already hold a seat in: the new seat JOINS
      // that booking. Seed the entry with the seats + record ids already held —
      // the original builds its confirmed entry from THIS one, so anything
      // dropped here stays dropped (the card shows only the new bike and a
      // cancel misses the first seat, which stays booked at Psycle). Failure
      // paths still restore prevBooking as before.
      if (prevBooking && !prevBooking.waitlisted && slots && slots.length && typeof _mergeBookedSeats === 'function') {
        _myBookings[String(eventId)] = _mergeBookedSeats(prevBooking, slots.map(Number), null);
      }
      if (prevBooking && prevBooking.waitlist) _myBookings[String(eventId)].waitlist = prevBooking.waitlist;
      // A no-layout "one more space": keep the record ids already held so the
      // original can merge the new id in (a whole cancel must remove them all).
      if (prevBooking && !prevBooking.waitlisted && !(slots && slots.length) && !(prevBooking.slots || []).length) {
        _myBookings[String(eventId)].bookingId = prevBooking.bookingId || null;
        _myBookings[String(eventId)].bookingIds = Array.isArray(prevBooking.bookingIds) ? prevBooking.bookingIds.slice() : (prevBooking.bookingId ? [prevBooking.bookingId] : []);
      }

      // 3. Call the real submitBooking
      try {
        await _originalSubmitBooking(eventId, slots, btn, opts);
        // The original never throws \u2014 it handles failures in-band (4xx/5xx,
        // timeouts, session expiry) by setting a non-\u2713 button label. It only
        // sets \u2713 once the seat is certain (its own 2xx, or a /bookings re-read
        // showing it), so any outcome without \u2713 means the booking did NOT
        // happen or could not be confirmed \u2014 either way
        // the optimistic _myBookings entry must go, or a phantom "Booked"
        // class haunts My Bookings, history and re-rendered cards.
        if (btn.textContent.indexOf('\u2713') === -1) {
          // Keep whatever failure label/handler the original set \u2014 only the
          // state entry is reverted\u2026
          revertBookingEntry();
          // \u2026and OUR optimistic class. A definitive refusal (4xx / 401) rewrites
          // just the label, and a leftover .booked reads as success to theme.js's
          // haptic, the booked pill style and "Book my week". Back to the class
          // the button came in with ('book-btn', "+ Add spot"'s own, or .booked
          // while a seat is still held); an unverified outcome set its own.
          if (btn.className === 'book-btn booked') {
            const kept = _myBookings[String(eventId)];
            btn.className = (origClass === 'book-btn booked' && !(kept && !kept.waitlisted)) ? 'book-btn' : origClass;
          }
        }
      } catch (err) {
        // 4. Revert on failure
        revertOptimistic();
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
   *
   * Single-flight: 'online' fires on every reconnect, and two concurrent
   * runs would replay the same snapshot twice (duplicate POSTs/DELETEs) and
   * then clobber each other's saved queue, resurrecting completed items.
   */
  var _queueProcessing = false;
  var _queueRerunWanted = false;
  async function processOfflineQueue() {
    if (_queueProcessing) { _queueRerunWanted = true; return; }
    _queueProcessing = true;
    try {
      await _processOfflineQueueInner();
    } finally {
      _queueProcessing = false;
      if (_queueRerunWanted) {
        _queueRerunWanted = false;
        processOfflineQueue();
      }
    }
  }

  async function _processOfflineQueueInner() {
    var queue = getOfflineQueue();
    if (queue.length === 0) return;

    var bookedOk = 0;
    var cancelOk = 0;
    var skipped = 0;
    var failed = 0;
    var unsure = 0;
    var taken = 0;
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
        // Validate before replaying: drop queued bookings whose class no
        // longer exists or has already started. A thrown fetch here falls
        // into the outer catch, which keeps the item queued for later.
        var evRes = await apiFetch('/events/' + item.eventId);
        if (evRes.status === 404) {
          skipped++;
          continue;
        }
        if (evRes.ok) {
          var evData = await evRes.json().catch(function () { return {}; });
          var evt = evData.data || evData;
          if (evt && evt.start_at && new Date(evt.start_at).getTime() <= Date.now()) {
            skipped++;
            continue;
          }
        }

        var body = { event_id: item.eventId };
        if (item.slots && item.slots.length) body.slots = item.slots.map(Number);
        else if (Number(item.spaces) > 0) body.slots = Number(item.spaces); // known no-layout studio: a count
        var bySlot = Array.isArray(body.slots);

        // Slot bodies: retries:3 — replay fires on the 'online' event, exactly
        // when the radio is flakiest, and a duplicate lands as 409/"already
        // booked" (same seat), which the handler below checks against
        // /bookings before calling it booked.
        // COUNT bodies are never auto-retried: a re-send after a lost response
        // would book (and charge) another space.
        var res;
        try {
          res = await apiFetch('/bookings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(body),
            retries: bySlot ? 3 : 0,
          });
        } catch (postErr) {
          if (bySlot) throw postErr; // outer catch keeps it queued
          res = null;
        }
        if (!bySlot && (!res || res.status >= 500)) {
          // Did it land? Ask before deciding — never blindly re-send a count.
          var landed = null;
          try {
            var chk = await apiFetch('/bookings?limit=200');
            if (chk.ok) {
              var cd = await chk.json().catch(function () { return null; });
              var cl = cd ? (Array.isArray(cd) ? cd : (cd.data || [])) : null;
              if (cl) landed = cl.some(function (b) { return String(b.event_id) === String(item.eventId); });
            }
          } catch (chkErr) { /* unknown */ }
          if (landed === true) { bookedOk++; continue; }
          if (landed === false) { remaining.push(item); failed++; continue; }
          unsure++; // can't tell — drop it rather than risk a double booking, and say so
          continue;
        }

        var data = await res.json().catch(function () { return {}; });
        if (res.ok) {
          bookedOk++;
          var bookingId = (data.data && data.data.id) || data.id;
          _myBookings[String(item.eventId)] = {
            bookingId: bookingId,
            slots: item.slots ? item.slots.map(Number) : [],
            slotBookings: {},
            waitlisted: false,
          };
        } else if (res.status === 409 || (data.message || '').toLowerCase().indexOf('already') !== -1) {
          // "You already hold it" (a retried POST whose first go landed) OR
          // "someone else took that spot while you were offline" — only
          // /bookings can say which, and calling the second one "confirmed"
          // sends a member to a class they have no seat in. Either way the
          // server has answered, so the item leaves the queue.
          var outcome = null;
          if (typeof _rereadBookingsForVerify === 'function' && typeof _bookingOutcome === 'function') {
            var applied = await _rereadBookingsForVerify();
            outcome = _bookingOutcome(applied, _myBookings[String(item.eventId)], item.slots || [], 0);
          }
          // (A count body can't be told from a space already held before it
          // was queued — that one stays "check My Bookings".)
          if (outcome && outcome.kind === 'booked' && bySlot) bookedOk++;
          else if (outcome && (outcome.kind === 'none' || (outcome.kind === 'partial' && !outcome.landed.length))) taken++;
          else unsure++;
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

    // Keep anything enqueued while we were replaying (single-flight means
    // only appends can happen concurrently), plus the items that need retry.
    var current = getOfflineQueue();
    var appendedWhileRunning = current.slice(queue.length);
    saveOfflineQueue(remaining.concat(appendedWhileRunning));

    if (bookedOk > 0) {
      toast(bookedOk + ' queued booking' + (bookedOk !== 1 ? 's' : '') + ' confirmed!', 'success');
    }
    if (cancelOk > 0) {
      toast(cancelOk + ' queued cancel' + (cancelOk !== 1 ? 's' : '') + ' sent', 'success');
    }
    if (unsure > 0) {
      toast("Couldn't confirm whether a queued booking went through — check My Bookings before booking it again", 'info');
    }
    if (skipped > 0) {
      toast(skipped === 1
        ? 'Skipped a queued booking — the class already started or was cancelled.'
        : 'Skipped ' + skipped + ' queued bookings — they already started or were cancelled.', 'info');
    }
    // Always reconcile with the server — failed or skipped replays would
    // otherwise leave the optimistic local state out of sync.
    if (typeof refreshUpcomingPanel === 'function') refreshUpcomingPanel();
    if (typeof fetchMyBookings === 'function') fetchMyBookings();
    if (failed > 0 && remaining.length > 0) {
      toast(remaining.length + ' queued action' + (remaining.length !== 1 ? 's' : '') + ' still pending', 'info');
    } else if (failed > 0) {
      toast(failed + ' queued action' + (failed !== 1 ? 's' : '') + ' could not be completed', 'error');
    }
    // Last, so it is the toast left on screen: the one outcome the member has
    // to act on (they believed this class was taken care of).
    if (taken > 0) {
      toast(taken === 1
        ? "A queued booking couldn't be made — that spot was taken while you were offline"
        : taken + " queued bookings couldn't be made — those spots were taken while you were offline", 'error');
    }
  }
  window.processOfflineQueue = processOfflineQueue;

  // Intercept submitBooking (already wrapped for optimistic UI above)
  // to catch offline state and queue instead of hitting the network.
  if (typeof window.submitBooking === 'function') {
    var _submitAfterOptimistic = window.submitBooking;

    window.submitBooking = async function offlineAwareSubmitBooking(eventId, slots, btn, opts) {
      // Waitlist joins are a different resource and are never queued \u2014 the
      // original redirects them to joinWaitlist, which refuses while offline.
      if (opts && opts.waitlist) return _submitAfterOptimistic(eventId, slots, btn, opts);
      if (!navigator.onLine) {
        // Queue booking for later
        var queue = getOfflineQueue();
        queue.push({
          eventId: eventId,
          slots: slots ? slots.map(Number) : [],
          spaces: (opts && Number(opts.spaces) > 0) ? Number(opts.spaces) : 0,
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

      return _submitAfterOptimistic(eventId, slots, btn, opts);
    };
  }

  // When connection comes back, process the queue
  window.addEventListener('online', processOfflineQueue);


})();
