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

  // Tab switches and settings export/import log themselves (tabs.js switchTab,
  // settings.js): those files load AFTER this one, so wrappers installed here
  // found nothing to wrap and never attached.

  // Hook into theme toggle (theme.js loads before this file, so this one does attach)
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

  window.fetchWithRetry = async function fetchWithRetry(url, opts, maxRetries = 3, stillWanted) {
    opts = opts || {};
    // The browser KNOWS it is offline: three backed-off retries only turn an
    // instant failure into ~7s of spinner. The one attempt still goes out, so
    // a wrong "offline" reading (some VPN set-ups) costs nothing.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) maxRetries = 0;
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // A retry RE-SENDS the headers the first attempt was built with, seconds
      // later. If the caller says they are no longer its to send (apiFetch:
      // signed out, or another account, during the backoff) give up the way a
      // caller-cancelled request does — an AbortError, nothing more sent.
      if (attempt > 0 && typeof stillWanted === 'function' && !stillWanted()) throw _retryAbandoned();
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

  /** What a retry that is no longer wanted rejects with (see stillWanted). */
  function _retryAbandoned() {
    const err = new Error('Request abandoned');
    err.name = 'AbortError';
    err.abandoned = true;
    return err;
  }

  // ── pure:retry-auth:start ── (DOM-free; tests/suites/retry-signout.js evaluates this block)
  // May a request that was built with the bearer token `startedWith` be sent
  // AGAIN now that the stored token reads `current`? Only while it is still
  // that very token: after a sign-out or a session expiry there is none, and
  // after an account switch it is someone else's. (A request that carried no
  // token has no credential to re-send.)
  function _retryTokenStillValid(startedWith, current) {
    if (!startedWith) return true;
    return !!current && current === startedWith;
  }
  // ── pure:retry-auth:end ──

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

      // The Authorization header above is built ONCE; every retry re-sends it.
      // Re-read the store before each one, so a sign-out (or a session that
      // ended) during the backoff stops the old token going out again.
      var stillWanted = function () { return _retryTokenStillValid(token, getBearerToken()); };

      return fetchWithRetry(apiUrl(path), Object.assign({}, opts, { headers: headers }), maxRetries, stillWanted)
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
          logNetworkError(path, (err && err.abandoned) ? 'ABANDONED (signed out)' : 'NETWORK_ERROR', opts.method || 'GET');
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
    try {
      var stored = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
      return Array.isArray(stored) ? stored : [];
    } catch { return []; }
  }

  function saveOfflineQueue(queue) {
    try { localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue)); } catch {}
    // My Bookings' "waiting to sync" line follows the queue.
    if (typeof PsycleEvents !== 'undefined') PsycleEvents.emit('queue:changed', queue.length);
  }

  // Items queued during THIS page session. Anything else in storage was left
  // behind by an earlier launch: nobody is watching it any more, so it is never
  // replayed blind (see _offlineQueueDecision). A BOOKING leaves this set with
  // its first replay, or once the member is asked about it: a later reconnect
  // is not "watching" either, and must not re-send a seat they have since
  // booked by hand — or one whose "Book it / Discard" dialog is still open.
  var _queueSessionIds = {};

  function _queueOwnerId() {
    return (typeof currentUser !== 'undefined' && currentUser && currentUser.id != null) ? String(currentUser.id) : null;
  }

  // Every item says who queued it (it never runs under another account), has
  // an id of its own (session membership, approvals, removals) and carries the
  // class time + a label — after a relaunch the event cache that could name the
  // class, or say whether it has started, is gone.
  function _stampQueueItem(item) {
    item.qid = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    item.owner = _queueOwnerId();
    var evt = (typeof _eventCache !== 'undefined' && _eventCache) ? _eventCache[String(item.eventId)] : null;
    if (evt && evt.start_at) item.startAt = evt.start_at;
    var label = '';
    try { if (typeof _waitlistClassLine === 'function') label = _waitlistClassLine(item.eventId); } catch (e) {}
    if (label) item.label = label;
    _queueSessionIds[item.qid] = true;
    return item;
  }

  /**
   * Enqueue a booking cancel for offline replay. bookingIds is the array
   * of per-seat booking ids (may be empty → falls back to event_id query).
   */
  function queueOfflineCancel(eventId, bookingIds) {
    var queue = getOfflineQueue();
    queue.push(_stampQueueItem({
      type: 'cancel',
      eventId: eventId,
      bookingIds: (bookingIds || []).filter(Boolean),
      timestamp: new Date().toISOString(),
    }));
    saveOfflineQueue(queue);
  }
  window.queueOfflineCancel = queueOfflineCancel;

  // ── pure:offline-queue:start ── (DOM-free; tests/suites/offline-queue.js evaluates this block)

  // A _myBookings entry that is a real seat (a waitlist place alone is not).
  function _queueHoldsSeat(entry) {
    if (!entry || entry.waitlisted) return false;
    return !!(entry.bookingId || (entry.bookingIds || []).length || (entry.slots || []).length);
  }

  // Is the booking a queued cancel was for still held? Record ids are unique
  // server-side, so a class that was cancelled elsewhere and then RE-booked has
  // new ones — an old cancel can never take the new booking with it. (An
  // id-less item — legacy, or a space whose 2xx carried no id — was for the
  // whole class.)
  function _queueCancelStillHeld(item, myBookings) {
    var entry = myBookings[String(item.eventId)];
    if (!_queueHoldsSeat(entry)) return false;
    var wanted = (item.bookingIds || []).filter(Boolean).map(String);
    if (!wanted.length) return true;
    var held = [];
    if (entry.bookingId != null) held.push(String(entry.bookingId));
    (entry.bookingIds || []).forEach(function (id) { held.push(String(id)); });
    Object.keys(entry.slotBookings || {}).forEach(function (s) { held.push(String(entry.slotBookings[s])); });
    return wanted.some(function (id) { return held.indexOf(id) !== -1; });
  }

  // Absolute start of a queued class. start_at is London wall clock, so app.js's
  // resolver is used when it is loaded; NaN = unknown (never read as "started").
  function _queueStartMs(startAt) {
    if (!startAt) return NaN;
    if (typeof _psycleClassStartMs === 'function') return _psycleClassStartMs(startAt);
    return Date.parse(String(startAt).replace(' ', 'T'));
  }

  // Is this replay still the member's live intent? Only for something queued in
  // THIS page session — and, for a booking, only on the 'online' replay that
  // follows it (they are watching, as before). A cancel stays live all session:
  // its ids came from this session's own list.
  function _offlineQueueIsLive(item, queuedThisSession, trigger) {
    if (!item || !queuedThisSession) return false;
    return item.type === 'cancel' ? true : trigger === 'online';
  }

  // What may happen to ONE queued item right now. The rule behind every branch:
  // a queued item must never spend credits by surprise, and a cancel the member
  // asked for is never lost while the booking may still stand.
  //   'send'  replay it now
  //   'ask'   a booking nobody is watching any more — explicit "Book it" first
  //   'drop'  take it out of the queue, silently
  //   'keep'  leave it queued; nothing can be decided yet
  // `sameSession`: _offlineQueueIsLive's answer. `myBookings`: a /bookings map
  // loaded in THIS page session for THIS account, or null when there is none
  // (nothing may be concluded from a map that was never loaded). `ownerId`: the
  // signed-in customer, or null while the session is unverified.
  function _offlineQueueDecision(item, now, sameSession, myBookings, ownerId) {
    if (!item || item.eventId == null) return 'drop';
    // Another member's change never runs under this account.
    if (item.owner != null && ownerId != null && String(item.owner) !== String(ownerId)) return 'drop';
    if (ownerId == null) return 'keep';

    if (item.type === 'cancel') {
      // Queued from this session's own list: send. The map can't be asked —
      // our optimistic drop already took the booking out of it — and a DELETE
      // for a record that has gone is a harmless 404.
      if (sameSession) return 'send';
      if (!myBookings) return 'keep';
      // Never aged out: only the booking having gone makes a cancel moot.
      return _queueCancelStillHeld(item, myBookings) ? 'send' : 'drop';
    }

    // A booking. Auto-replay needs a known owner as well as live intent.
    if (sameSession && item.owner != null) {
      // Queued for a class that was NOT held, and a seat is held now: it was
      // booked some other way since. (Strictly false — "+ Add spot" on a class
      // already held is still sent, and so is an item without the stamp.)
      if (item.heldAtQueue === false && myBookings && _queueHoldsSeat(myBookings[String(item.eventId)])) return 'drop';
      return 'send';
    }
    var startMs = _queueStartMs(item.startAt);
    if (!isNaN(startMs) && startMs <= now) return 'drop'; // the class has started
    if (!myBookings) return 'keep';
    // Already booked — or on its waitlist, which says the class filled up since.
    if (myBookings[String(item.eventId)]) return 'drop';
    return 'ask';
  }

  // Names a class when neither the item nor the event cache can (legacy items).
  // From the digits: the class's own wall clock, whatever zone the device is in.
  function _queueFallbackLabel(startAt) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(startAt == null ? '' : startAt).trim());
    if (!m) return 'a class';
    var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var day = days[new Date(+m[1], +m[2] - 1, +m[3]).getDay()];
    var h = +m[4];
    return 'a class on ' + day + ' ' + (+m[3]) + ' at ' + (h % 12 || 12) + ':' + m[5] + (h >= 12 ? 'pm' : 'am');
  }
  // ── pure:offline-queue:end ──

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
  // What started the running drain: 'online' (the reconnect replay), 'loaded'
  // (a /bookings answer landed), 'approved' (the member just said "Book it") —
  // anything else is 'manual', which sends no booking on its own.
  var _queueTrigger = 'manual';
  // The map the last 'bookings:loaded' delivered. While _myBookings is still
  // that very object it is this account's list as loaded this session (local
  // edits included); sign-out and an account switch swap in another object.
  var _queueFreshMap = null;
  // _queueFreshMap as the last reconnect found it. "Not booked" is never read
  // from that list: a class booked elsewhere during the outage isn't in it yet.
  var _queueMapAtReconnect = null;
  var _queueApproved = {};  // qid → the member who answered "Book it" (good for one attempt, theirs only)
  var _queueAskWanted = {}; // qid → item the last drain wants asked about

  async function processOfflineQueue(trigger) {
    if (typeof trigger !== 'string') trigger = 'manual';
    if (_queueProcessing) {
      // One re-run serves them all; the reconnect replay's intent wins.
      if (_queueRerunWanted !== 'online') _queueRerunWanted = trigger;
      return 0;
    }
    _queueProcessing = true;
    _queueTrigger = trigger;
    var attempted = 0;
    try {
      _stampLegacyQueueItems();
      attempted = (await _processOfflineQueueInner()) || 0;
    } finally {
      _queueProcessing = false;
      _applyQueueRemovals();
      if (_queueRerunWanted) {
        var again = _queueRerunWanted;
        _queueRerunWanted = false;
        processOfflineQueue(again);
      }
    }
    _askAboutQueuedBookings();
    return attempted;
  }

  // Items from before queue ids existed: give them one so they can be asked
  // about and removed. They stay owner-less and outside _queueSessionIds, i.e.
  // a legacy booking is only ever sent after an explicit "Book it".
  function _stampLegacyQueueItems() {
    var queue = getOfflineQueue();
    var changed = false;
    queue.forEach(function (it, i) {
      if (it && !it.qid) { it.qid = 'l' + Date.now().toString(36) + i; changed = true; }
    });
    if (changed) saveOfflineQueue(queue);
  }

  // Taking items OUT (a discard, another account's, sign-out) must not race a
  // running drain: its closing save is built from the snapshot it started with
  // and would put them straight back. Noted here, applied once it has saved —
  // and until then the drain is told to drop them (_offlineQueueVerdict).
  var _queueRemoveWanted = {};
  var _queueClearWanted = false;
  function _applyQueueRemovals() {
    if (_queueProcessing) return;
    var queue = getOfflineQueue();
    var next = _queueClearWanted ? [] : queue.filter(function (it) {
      return !(it && it.qid && _queueRemoveWanted[it.qid]);
    });
    _queueClearWanted = false;
    _queueRemoveWanted = {};
    if (next.length !== queue.length) saveOfflineQueue(next);
  }
  function _removeQueuedItems(qids) {
    qids.forEach(function (qid) { if (qid) _queueRemoveWanted[qid] = true; });
    _applyQueueRemovals();
  }
  function _clearOfflineQueue() {
    _queueClearWanted = true;
    _queueSessionIds = {};
    _queueApproved = {};
    _queueAskWanted = {};
    _applyQueueRemovals();
  }

  // A "Queued" card button whose item left the queue unsent goes back to what
  // state says (Book / the seat already held).
  function _releaseQueuedButton(eventId) {
    try { if (typeof _syncCardButtonsForEvent === 'function') _syncCardButtonsForEvent(eventId); } catch (e) {}
  }

  // What the running drain may do with one item. The rules are
  // _offlineQueueDecision's; this only gathers the live facts for it.
  function _offlineQueueVerdict(item) {
    if (!item) return 'drop';
    if (_queueClearWanted || (item.qid && _queueRemoveWanted[item.qid])) return 'drop';
    if (!getBearerToken()) return 'keep';
    if (item.qid && _queueApproved[item.qid]) {
      var approvedBy = _queueApproved[item.qid];
      delete _queueApproved[item.qid]; // one attempt per "Book it": a failed send asks again
      if (approvedBy === _queueOwnerId()) return 'send';
    }
    var queuedNow = !!(item.qid && _queueSessionIds[item.qid]);
    var fresh = (_queueFreshMap && _queueFreshMap === _myBookings) ? _myBookings : null;
    var verdict = _offlineQueueDecision(item, Date.now(),
      _offlineQueueIsLive(item, queuedNow, _queueTrigger), fresh, _queueOwnerId());
    // One blind replay per booking: if this send fails and the item is kept, the
    // next reconnect has to check /bookings (and ask) like any stranded item —
    // the member may have booked the class by hand meanwhile. Cancels stay live.
    if (verdict === 'send' && queuedNow && item.type !== 'cancel') delete _queueSessionIds[item.qid];
    // Never ask from the list the reconnect found us with. It used to: the
    // dialog went up, the /bookings answer the 'online' handler had asked for
    // landed behind it and dropped the item (booked elsewhere meanwhile), and
    // "Book it" then sent nothing. Kept — and re-armed, so the next answer that
    // really is a newer list asks (or drops) instead.
    if (verdict === 'ask' && fresh === _queueMapAtReconnect) {
      verdict = 'keep';
      _queueDrainArmed = true;
    }
    if (verdict === 'ask' && item.qid) _queueAskWanted[item.qid] = item;
    if (verdict === 'drop' && item.type !== 'cancel') _releaseQueuedButton(item.eventId);
    return verdict;
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
    var waiting = 0;   // left queued without being tried (not to be sent yet)
    var attempted = 0; // actually replayed
    var remaining = [];

    for (var i = 0; i < queue.length; i++) {
      var item = queue[i];
      try {
        // Not everything queued may go out now: another account's item, a
        // booking stranded by an earlier launch, a cancel whose booking has
        // gone… (A verdict that can't be had throws → the item stays queued.)
        var verdict = _offlineQueueVerdict(item);
        if (verdict === 'drop') continue;
        if (verdict !== 'send') { remaining.push(item); waiting++; continue; }
        attempted++;

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
          } else if (results.some(function (r) { return r.status >= 500 || r.status === 401 || r.status === 403; })) {
            // Transient server error, a session that needs signing in again
            // (401) or a denial with a valid session (403) — retry later. The
            // member believes this class is cancelled: it is only given up on
            // when Psycle says the booking itself can't be cancelled.
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
        } else if (res.status === 401) {
          // The session expired under it (apiFetch has said so): nothing was
          // booked. Kept for the sign-in that follows.
          remaining.push(item);
          failed++;
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
    // Always reconcile with the server after a replay — failed or skipped ones
    // would otherwise leave the optimistic local state out of sync. (Nothing
    // sent = nothing to reconcile, and a drain started BY a /bookings answer
    // must not answer it with another fetch.)
    if (attempted > 0) {
      if (typeof refreshUpcomingPanel === 'function') refreshUpcomingPanel();
      if (typeof fetchMyBookings === 'function') fetchMyBookings();
    }
    var pending = remaining.length - waiting; // tried, and kept for another go
    // Signed out — or the session ended — while this ran: the retry layer gave
    // up on whatever was in flight, which lands here as "failed". Nobody is
    // signed in to be told: a sign-out empties the queue as soon as this run
    // has saved, and an expiry has its own banner (the queue waits for the
    // sign-in that follows).
    var signedIn = !!getBearerToken();
    if (signedIn && failed > 0 && pending > 0) {
      toast(pending + ' queued action' + (pending !== 1 ? 's' : '') + ' still pending', 'info');
    } else if (signedIn && failed > 0) {
      toast(failed + ' queued action' + (failed !== 1 ? 's' : '') + ' could not be completed', 'error');
    }
    // Last, so it is the toast left on screen: the one outcome the member has
    // to act on (they believed this class was taken care of).
    if (taken > 0) {
      toast(taken === 1
        ? "A queued booking couldn't be made — that spot was taken while you were offline"
        : taken + " queued bookings couldn't be made — those spots were taken while you were offline", 'error');
    }
    return attempted;
  }
  window.processOfflineQueue = processOfflineQueue;

  // Never stack on another dialog, the class sheet, the "Booked!" sheet, the
  // first-run tour or the history prompt — nor talk to a backgrounded page.
  function _queueScreenBusy() {
    if (document.hidden) return true;
    if (typeof _dialogOpen === 'function' && _dialogOpen()) return true;
    return !!(document.getElementById('classDetailOverlay') || document.getElementById('bookingConfirmation') ||
      document.getElementById('onboardOverlay') || document.getElementById('syncPromptOverlay'));
  }

  // A booking nobody is watching any more (left by an earlier launch, or not
  // sent by the reconnect replay) spends a credit if it goes out — so it only
  // does after an explicit "Book it". One dialog at a time; whatever can't be
  // asked now stays queued and comes up again with the next drain.
  var _queueAsking = false;
  async function _askAboutQueuedBookings() {
    if (_queueAsking || _queueProcessing) return; // a running drain calls back here when it ends
    var items = Object.keys(_queueAskWanted).map(function (qid) { return _queueAskWanted[qid]; });
    _queueAskWanted = {};
    if (!items.length) return;
    _queueAsking = true;
    try {
      for (var i = 0; i < items.length; i++) {
        if ((await _askAboutQueuedBooking(items[i])) === 'stop') break;
      }
    } catch (e) {
      // Nothing was sent; the items are still queued for the next drain.
    } finally {
      _queueAsking = false;
      _queueAskWanted = {}; // flagged meanwhile = already asked above, or re-flagged by the next drain
    }
  }

  // → 'next' (settled, or no longer ours to ask) | 'stop' (can't ask right now).
  async function _askAboutQueuedBooking(item) {
    var stillQueued = function () {
      return getOfflineQueue().some(function (it) { return it && it.qid === item.qid; });
    };
    for (var waits = 0; _queueScreenBusy(); waits++) {
      if (waits >= 40) return 'stop';
      await new Promise(function (r) { setTimeout(r, 1500); });
    }
    if (!stillQueued()) return 'next'; // sent or dropped since the drain flagged it
    // Fresh facts first (a GET): a class Psycle has removed, or one that has
    // started, is discarded without a word. If Psycle can't be reached nothing
    // is asked — "Book it" couldn't be honoured anyway.
    var startAt = item.startAt || null;
    var evt = null;
    try {
      var res = await apiFetch('/events/' + item.eventId);
      if (res.status === 404) { _removeQueuedItems([item.qid]); _releaseQueuedButton(item.eventId); return 'next'; }
      if (!res.ok) return 'stop';
      var body = await res.json().catch(function () { return {}; });
      evt = (body && (body.data || body)) || null;
      if (evt && evt.start_at) startAt = evt.start_at;
    } catch (e) { return 'stop'; }
    var startMs = _queueStartMs(startAt);
    if (!isNaN(startMs) && startMs <= Date.now()) { _removeQueuedItems([item.qid]); _releaseQueuedButton(item.eventId); return 'next'; }

    // All of that took time: is it still this member's, still queued, still unbooked?
    var owner = _queueOwnerId();
    if (!getBearerToken() || !owner || (item.owner != null && String(item.owner) !== owner)) return 'stop';
    if (_queueProcessing) return 'stop'; // a drain is replaying right now — it calls back when it ends
    if (!stillQueued()) return 'next';
    if (_myBookings[String(item.eventId)]) { _removeQueuedItems([item.qid]); _releaseQueuedButton(item.eventId); return 'next'; }
    if (_queueScreenBusy()) return 'stop';

    var label = item.label || '';
    try { if (!label && typeof _waitlistClassLine === 'function') label = _waitlistClassLine(item.eventId); } catch (e) {}
    if (!label) label = _queueFallbackLabel(startAt);
    var seat = '';
    try { if (item.slots && item.slots.length) seat = formatSlots(slotLabelForEvent(item.eventId), item.slots); } catch (e) {}
    // A seat already held at that time — advisory, as in bookClass.
    var clashLine = '';
    try { if (typeof _clashFor === 'function') clashLine = _clashLabel(_clashFor(item.eventId, evt)); } catch (e) {}

    // From here the member's answer decides: an 'online' firing while the
    // dialog is up must not send it behind a "Discard".
    delete _queueSessionIds[item.qid];
    var replaced = false;
    var ok = await confirmModal({
      title: 'Offline booking',
      body: 'You tried to book ' + label + (seat ? ' (' + seat + ')' : '') +
        ' while offline — it never reached Psycle. Book it now? This uses a class credit, as usual.',
      warn: (clashLine ? clashLine + '. ' : '') + "Psycle's normal 12-hour cancellation policy applies.",
      confirmText: 'Book it',
      cancelText: 'Discard',
      onReplaced: function () { replaced = true; },
    });
    if (replaced) return 'stop'; // displaced by another dialog, not answered — asked again next time
    if (!ok) {
      _removeQueuedItems([item.qid]);
      _releaseQueuedButton(item.eventId);
      return 'next';
    }
    // The dialog may have sat there a while: only this member's live session sends it.
    if (!getBearerToken() || _queueOwnerId() !== owner) return 'stop';
    // …and a /bookings answer behind it may have dropped the item (booked
    // elsewhere meanwhile, or the class has started): there is nothing left to
    // send, so say so rather than just closing.
    if (!stillQueued()) {
      toast('That offline booking is no longer waiting — nothing was sent. Check My Bookings.', 'info');
      return 'next';
    }
    _queueApproved[item.qid] = owner;
    await processOfflineQueue('approved');
    return 'next';
  }

  // Intercept submitBooking (already wrapped for optimistic UI above)
  // to catch offline state and queue instead of hitting the network.
  if (typeof window.submitBooking === 'function') {
    var _submitAfterOptimistic = window.submitBooking;

    window.submitBooking = async function offlineAwareSubmitBooking(eventId, slots, btn, opts) {
      // Waitlist joins are a different resource and are never queued \u2014 the
      // original redirects them to joinWaitlist, which refuses while offline.
      if (opts && opts.waitlist) return _submitAfterOptimistic(eventId, slots, btn, opts);
      if (!navigator.onLine) {
        // Queue booking for later. The same seats in the same class twice is
        // one booking: the "Queued" label doesn't survive a re-render, and a
        // second COUNT item would book (and charge) a second space.
        var queue = getOfflineQueue();
        var wantSlots = slots ? slots.map(Number) : [];
        var alreadyQueued = queue.some(function (it) {
          return it && it.type !== 'cancel' && String(it.eventId) === String(eventId) &&
            (it.owner == null || it.owner === _queueOwnerId()) &&
            (it.slots || []).map(Number).join(',') === wantSlots.join(',');
        });
        if (!alreadyQueued) {
          queue.push(_stampQueueItem({
            eventId: eventId,
            slots: wantSlots,
            spaces: (opts && Number(opts.spaces) > 0) ? Number(opts.spaces) : 0,
            // Was a seat in this class already held? (see _offlineQueueDecision)
            heldAtQueue: _queueHoldsSeat(_myBookings[String(eventId)]),
            timestamp: new Date().toISOString(),
          }));
          saveOfflineQueue(queue);
        }

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

  // "N change(s) waiting to sync" at the top of the My Bookings tab. Its own
  // element: renderMyBookings rewrites the list, and hides the whole panel when
  // nothing is booked — exactly what cancelling your only class offline leaves.
  function _renderQueueStatus() {
    var tab = document.getElementById('tab-bookings');
    if (!tab) return; // tabs.js hasn't built the shell yet — the next event repaints
    var el = document.getElementById('offlineQueueStatus');
    var owner = _queueOwnerId();
    // Another member's leftovers are never counted (they are purged, not sent).
    var count = getBearerToken() ? getOfflineQueue().filter(function (it) {
      return it && (it.owner == null || owner == null || String(it.owner) === owner);
    }).length : 0;
    if (!count) { if (el) el.style.display = 'none'; return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'offlineQueueStatus';
      el.className = 'mb-queue-status';
      el.setAttribute('role', 'status');
      tab.insertBefore(el, tab.firstChild);
    }
    el.textContent = count + (count === 1 ? ' change' : ' changes') + ' waiting to sync with Psycle';
    el.style.display = '';
  }

  // ── When the queue drains ──
  // It used to drain on 'online' alone, so a queue left by a closed app sat
  // there until some later reconnect fired it, unannounced. Now also: once per
  // launch, on every return to the foreground and after a sign-in — always from
  // a /bookings answer ('bookings:loaded'), which is what proves a live session
  // and gives the decisions a list to check against. Armed here, disarmed
  // BEFORE the drain so the drain's own fetchMyBookings can't start another.
  // (One drain re-arms itself: an ask put off for a newer list — _offlineQueueVerdict.)
  var _queueDrainArmed = true;

  // Signal is back: replay what was queued in this session straight away (as
  // before). Anything older waits for the /bookings answer — fetched here when
  // the replay itself sent nothing (app.js re-reads only the profile on 'online').
  window.addEventListener('online', function () {
    _queueDrainArmed = true;
    _queueMapAtReconnect = _queueFreshMap; // what it said before the outage can't vouch for "not booked" now
    processOfflineQueue('online').then(function (attempted) {
      if (!attempted && _queueDrainArmed && _queueOwnerId() && getBearerToken() &&
          getOfflineQueue().length && typeof fetchMyBookings === 'function') fetchMyBookings();
    });
  });

  // Back in the foreground: app.js re-reads /bookings itself, which drains.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') _queueDrainArmed = true;
  });

  if (typeof PsycleEvents !== 'undefined') {
    PsycleEvents.on('bookings:loaded', function (map) {
      _queueFreshMap = map || null;
      _renderQueueStatus();
      // No verified member yet (an unverified session can still load bookings):
      // stay armed for the load that follows the healed sign-in.
      if (!_queueDrainArmed || !_queueOwnerId()) return;
      _queueDrainArmed = false;
      if (getOfflineQueue().length) processOfflineQueue('loaded');
    });
    PsycleEvents.on('queue:changed', _renderQueueStatus);
    PsycleEvents.on('auth:changed', function (s) {
      if (s && s.signedIn) {
        _queueDrainArmed = true; // the bookings load that follows a sign-in drains
        // Someone else's queue (their session expired here, say) is not this
        // member's to send — or to be told about.
        var owner = _queueOwnerId();
        _removeQueuedItems(getOfflineQueue().filter(function (it) {
          return it && it.qid && it.owner != null && owner != null && String(it.owner) !== owner;
        }).map(function (it) { return it.qid; }));
      }
      _renderQueueStatus();
    });
  }

  // Deliberate sign-out: whoever signs in next must not inherit this queue.
  // Session EXPIRY is deliberately not wrapped (as in native-bridge.js): the
  // same member signs back in, and a cancel they believe went through must
  // still be there to send — an item kept after a 401 would otherwise be wiped
  // by the very expiry it was kept for. Another member's items are purged above.
  var _clearTokenBeforeQueue = window.clearToken;
  if (typeof _clearTokenBeforeQueue === 'function') {
    window.clearToken = function () {
      _clearOfflineQueue();
      return _clearTokenBeforeQueue.apply(this, arguments);
    };
  }


})();
