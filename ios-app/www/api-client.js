/**
 * api-client.js — Schemas and error handling for Psycle's API (Psycle Booking PWA)
 *
 * Loaded AFTER app.js + reliability.js + performance.js. It makes no request
 * of its own and does NOT touch the global `apiFetch`: every request goes
 * through the app's own `apiFetch` callers. This file is purely ADDITIVE.
 *
 * Purpose: a single, defensive place to adapt to Psycle's UNOFFICIAL,
 * undocumented API changing shape. It centralises:
 *   - SCHEMAS: the expected response shapes (derived from fields the app reads).
 *     js/diagnostic.js compares the shapes it observes against them.
 *   - categorizeError(): map any response/error to {type, userMessage} for UI
 *
 * Exposes: window.PsycleAPI
 *
 * Defensive-coding contract: nothing here throws to the caller.
 */

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════
  // 1. SCHEMAS — expected response shapes (drift baseline)
  // ═══════════════════════════════════════════════════════════════════
  // Each entry: { required: [...], optional: [...] }. `required` fields are
  // the ones existing code reads unconditionally (a change there would break
  // the app); `optional` fields are read defensively (with ?? / || fallbacks)
  // and are tracked only for drift visibility. Fields were derived by reading
  // the real accesses in app.js / explore.js / features.js / tabs.js.
  var SCHEMAS = {
    // GET /profile → data.data. Only `id` is required: app.js reads
    // subscriptions (_pickActiveSubscription) and stats (`|| {}`) with
    // fallbacks, and a member with neither must not get a safe-mode banner.
    profile: {
      required: ['id'],
      optional: ['subscriptions', 'stats', 'first_name', 'email'],
    },
    // GET /instructors → data[] (app.js:500 is_visible+full_name; explore.js:64 id)
    instructor: {
      required: ['id', 'full_name', 'is_visible'],
      optional: ['photo', 'image_1', 'metafields', 'bio'],
    },
    // GET /locations → data[] (app.js:501 is_visible+handle; app.js:568 name)
    location: {
      required: ['id', 'name', 'is_visible', 'handle'],
      optional: ['address'],
    },
    // GET /event-types → data[] (typeMap[...].name in app.js:1544)
    eventType: {
      required: ['id', 'name'],
      optional: [],
    },
    // GET /events → data[] (eventCard app.js:1496-1513; search app.js:692)
    event: {
      required: [
        'id',
        'start_at',
        'studio_id',
        'instructor_id',
        'event_type_id',
        'duration',
        'is_fully_booked',
      ],
      optional: ['is_waitlistable', 'capacity', 'occupancy', 'capacity_remaining', 'slots', 'is_live_stream'],
    },
    // GET /bookings → data[] (fetchMyBookings app.js:206-207 event_id + slot)
    booking: {
      required: ['id', 'event_id'],
      optional: ['slot', 'slots', 'slot_ids', 'slot_id'],
    },
    // GET /waitlists?page=N → data[] (fetchMyWaitlists in app.js reads id,
    // event.id, status, expires_at/allocated_at/cancelled_at). Waitlist places
    // are a separate resource from bookings; `event` is a nested object (no
    // flat event_id). Only `id` is required so a shape wobble in this
    // unofficial resource can't trip safe mode.
    waitlist: {
      required: ['id'],
      optional: ['event', 'event_id', 'status', 'added_at', 'expires_at', 'cancelled_at', 'allocated_at'],
    },
  };

  // ═══════════════════════════════════════════════════════════════════
  // 2. categorizeError(responseOrError) → {type, userMessage}
  // ═══════════════════════════════════════════════════════════════════
  var USER_MESSAGES = {
    'auth': 'Your session has expired. Sign in again.',
    'rate-limit': 'Too many requests to Psycle. Wait a moment, then try again.',
    'server': 'Psycle is having trouble right now. Try again shortly.',
    'schema': 'Psycle has changed something, so Psync may need an update.',
    'network': "You're offline. Check your connection and try again.",
    'timeout': 'Psycle took too long to answer. Try again.',
    'unknown': 'Couldn\'t load that. Try again.',
  };

  /**
   * Map a Response, an Error, or a number (status code) to a category and a
   * short, friendly, actionable message. Never throws.
   *
   * @param {Response|Error|number|*} responseOrError
   * @returns {{type: string, userMessage: string}}
   */
  function categorizeError(responseOrError) {
    var type = 'unknown';
    try {
      var x = responseOrError;

      // Raw status code.
      var status = null;
      if (typeof x === 'number') {
        status = x;
      } else if (x && typeof x.status === 'number' &&
                 // Response-like (has .ok or .headers) — avoid treating an
                 // Error that happens to carry a numeric .status oddly.
                 (typeof x.ok === 'boolean' || x.headers || x.statusText !== undefined)) {
        status = x.status;
      } else if (x && typeof x.status === 'number') {
        status = x.status;
      }

      if (status !== null) {
        if (status === 401 || status === 403) type = 'auth';
        else if (status === 429) type = 'rate-limit';
        else if (status >= 500) type = 'server';
        else if (status >= 400) type = 'unknown'; // generic client error
        else type = 'unknown';
        return { type: type, userMessage: USER_MESSAGES[type] };
      }

      // Error / thrown value classification by name + message.
      var name = (x && x.name) ? String(x.name) : '';
      var msg = '';
      if (x instanceof Error) msg = String(x.message || '');
      else if (typeof x === 'string') msg = x;
      else if (x && x.message) msg = String(x.message);

      // app.js turns a bad response into `new Error('HTTP 503')` before anyone
      // sees the Response, so the status only survives inside the message.
      // Without this every failed search classified as 'unknown' and the
      // last-results fallback (network / server / timeout only) never ran.
      var httpMatch = /\bHTTP (\d{3})\b/.exec(msg);
      if (httpMatch) return categorizeError(Number(httpMatch[1]));

      var lower = (name + ' ' + msg).toLowerCase();

      if (name === 'AbortError' || lower.indexOf('timed out') !== -1 ||
          lower.indexOf('timeout') !== -1) {
        type = 'timeout';
      } else if (lower.indexOf('schema') !== -1 ||
                 lower.indexOf('not json') !== -1 ||
                 lower.indexOf('json') !== -1 ||
                 lower.indexOf('parse') !== -1 ||
                 lower.indexOf('validation') !== -1 ||
                 lower.indexOf('unexpected token') !== -1) {
        type = 'schema';
      } else if (name === 'TypeError' ||
                 lower.indexOf('failed to fetch') !== -1 ||
                 lower.indexOf('networkerror') !== -1 ||
                 lower.indexOf('network request failed') !== -1 ||
                 lower.indexOf('offline') !== -1 ||
                 (typeof navigator !== 'undefined' && navigator && navigator.onLine === false)) {
        type = 'network';
      } else {
        type = 'unknown';
      }
    } catch (e) {
      type = 'unknown';
    }
    return { type: type, userMessage: USER_MESSAGES[type] || USER_MESSAGES.unknown };
  }

  // ═══════════════════════════════════════════════════════════════════
  // Public surface
  // ═══════════════════════════════════════════════════════════════════
  window.PsycleAPI = {
    SCHEMAS: SCHEMAS,
    categorizeError: categorizeError,
  };

})();
