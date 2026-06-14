/**
 * api-client.js — Thin API-client abstraction for the Psycle Booking PWA
 *
 * Loaded AFTER app.js + reliability.js + performance.js. By the time these
 * getters run, the global `apiFetch` has already been re-decorated by
 * reliability.js (retry/backoff/timeout/logging) and performance.js
 * (stale-while-revalidate). This module WRAPS that decorated `window.apiFetch`
 * — it does NOT redefine it — so every existing direct `apiFetch` caller keeps
 * working untouched. This file is purely ADDITIVE.
 *
 * Purpose: a single, defensive place to adapt to Psycle's UNOFFICIAL,
 * undocumented API changing shape. It centralises:
 *   - SCHEMAS: the expected response shapes (derived from fields the app reads)
 *   - typed getters that parse + validate + surface drift to diagnostic.js
 *   - field(): safe nested access that notes missing fields for drift detection
 *   - categorizeError(): map any response/error to {type, userMessage} for UI
 *   - validate(): compare data against a schema's required fields
 *   - a content-type-aware JSON parse helper (the corsproxy can return HTML)
 *
 * Optional dependency (forward-declared, may not exist yet):
 *   window.PsycleDiag — diagnostic.js. Every reference is typeof-guarded.
 *
 * Exposes: window.PsycleAPI
 *
 * Defensive-coding contract: nothing here throws synchronously to the caller
 * except the typed getters' rejected Promises (whose Error carries a
 * `.psycleError` categorized object). Helpers never throw uncaught.
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
    // GET /profile → data.data (app.js:319,322 subscriptions; app.js:2098 stats)
    profile: {
      required: ['id', 'subscriptions', 'stats'],
      optional: ['first_name', 'email'],
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
      optional: ['is_waitlistable', 'capacity_remaining', 'slots', 'is_live_stream'],
    },
    // GET /bookings → data[] (fetchMyBookings app.js:206-207 event_id + slot)
    booking: {
      required: ['id', 'event_id'],
      optional: ['slot', 'slots', 'slot_ids', 'slot_id'],
    },
  };

  // Map of schema-kind → which response shape it validates (object vs first
  // array element). Profile is a single object; the rest are collections.
  var KIND_IS_ARRAY = {
    profile: false,
    instructor: true,
    location: true,
    eventType: true,
    event: true,
    booking: true,
  };

  // ═══════════════════════════════════════════════════════════════════
  // Diagnostic bridge — every call typeof-guarded (PsycleDiag is optional)
  // ═══════════════════════════════════════════════════════════════════

  function diagNoteMissingField(path) {
    try {
      if (typeof window.PsycleDiag !== 'undefined' &&
          window.PsycleDiag &&
          typeof window.PsycleDiag.noteMissingField === 'function') {
        window.PsycleDiag.noteMissingField(path);
      }
    } catch (e) { /* diagnostics must never break the app */ }
  }

  function diagNoteSample(kind, sample, validation) {
    try {
      if (typeof window.PsycleDiag !== 'undefined' &&
          window.PsycleDiag &&
          typeof window.PsycleDiag.noteSample === 'function') {
        window.PsycleDiag.noteSample(kind, sample, validation);
      }
    } catch (e) { /* never break on diagnostics */ }
  }

  // ═══════════════════════════════════════════════════════════════════
  // 3. field(obj, path, fallback) — safe nested access + drift detection
  // ═══════════════════════════════════════════════════════════════════
  /**
   * Read a nested value from `obj` by `path`. Path may be a dotted string
   * ('a.b.c') or an array of keys (['a','b','c']). If any non-final segment
   * resolves to null/undefined, or the final key is missing on a non-null
   * object, the path is reported to PsycleDiag (so drift surfaces) and
   * `fallback` is returned. Never throws.
   *
   * @param {*} obj
   * @param {string|Array} path
   * @param {*} [fallback]
   * @returns {*}
   */
  function field(obj, path, fallback) {
    if (fallback === undefined) fallback = undefined;
    var keys;
    if (Array.isArray(path)) {
      keys = path.slice();
    } else if (typeof path === 'string') {
      keys = path.split('.').filter(function (k) { return k.length > 0; });
    } else {
      return fallback;
    }
    if (keys.length === 0) return obj == null ? fallback : obj;

    var cur = obj;
    var pathStr = Array.isArray(path) ? path.join('.') : path;
    for (var i = 0; i < keys.length; i++) {
      // Only a non-null object/array can carry the next key. If we hit a
      // primitive/null/undefined before the end, the path is "missing".
      if (cur === null || cur === undefined ||
          (typeof cur !== 'object' && typeof cur !== 'function')) {
        // Don't note drift when the root itself was null/undefined — that's a
        // caller passing nothing, not the API dropping a field.
        if (i > 0) diagNoteMissingField(pathStr);
        return fallback;
      }
      var key = keys[i];
      if (!(key in cur)) {
        diagNoteMissingField(pathStr);
        return fallback;
      }
      cur = cur[key];
    }
    return cur === undefined ? fallback : cur;
  }

  // ═══════════════════════════════════════════════════════════════════
  // 5. validate(kind, data) — required-field check against SCHEMAS
  // ═══════════════════════════════════════════════════════════════════
  /**
   * Compare `data` against SCHEMAS[kind].required. For array kinds the first
   * element is sampled (collections are homogeneous). Returns the list of
   * required field paths that are absent. An unknown kind or empty data is
   * treated as ok (we can't assert a shape we don't know — fail open).
   *
   * @param {string} kind
   * @param {*} data
   * @returns {{ok: boolean, missing: Array}}
   */
  function validate(kind, data) {
    var schema = SCHEMAS[kind];
    if (!schema || !Array.isArray(schema.required)) {
      return { ok: true, missing: [] };
    }
    var sample = data;
    if (KIND_IS_ARRAY[kind]) {
      if (!Array.isArray(data)) {
        // Expected a collection but didn't get one — can't sample a field,
        // but the envelope itself is wrong. Report all required as missing
        // only if it's truly absent; an empty array is a legitimate "ok".
        if (data == null) return { ok: true, missing: [] };
        sample = data; // fall through; object will simply lack array fields
      } else {
        if (data.length === 0) return { ok: true, missing: [] };
        sample = data[0];
      }
    }
    if (sample === null || sample === undefined || typeof sample !== 'object') {
      return { ok: true, missing: [] };
    }
    var missing = [];
    for (var i = 0; i < schema.required.length; i++) {
      var key = schema.required[i];
      if (!(key in sample)) missing.push(key);
    }
    return { ok: missing.length === 0, missing: missing };
  }

  // ═══════════════════════════════════════════════════════════════════
  // 4. categorizeError(responseOrError) → {type, userMessage}
  // ═══════════════════════════════════════════════════════════════════
  var USER_MESSAGES = {
    'auth': 'Your Psycle session expired — please sign in again.',
    'rate-limit': 'Psycle is rate-limiting us — wait a moment and retry.',
    'server': "Psycle's servers are having trouble — try again shortly.",
    'schema': 'Psycle changed something on their end — this may need an update.',
    'network': "You appear to be offline — check your connection and retry.",
    'timeout': 'The request took too long — try again.',
    'unknown': 'Something went wrong — please try again.',
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

      // If we were handed an Error that already carries a categorization,
      // (e.g. thrown by our own getters), reuse it.
      if (x && x.psycleError && x.psycleError.type &&
          USER_MESSAGES[x.psycleError.type]) {
        return {
          type: x.psycleError.type,
          userMessage: x.psycleError.userMessage || USER_MESSAGES[x.psycleError.type],
        };
      }

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

  /** Build an Error carrying a categorized `.psycleError` for the UI. */
  function makeError(categorized, contextMsg) {
    var cat = categorized || categorizeError(null);
    var err = new Error(contextMsg
      ? (contextMsg + ' — ' + cat.userMessage)
      : cat.userMessage);
    err.psycleError = cat;
    return err;
  }

  // ═══════════════════════════════════════════════════════════════════
  // 6. parseJson(res) — content-type-aware, defensive JSON parse
  // ═══════════════════════════════════════════════════════════════════
  /**
   * Parse a Response body as JSON, but FIRST guard against the corsproxy (or a
   * gateway) returning an HTML error page with a 200. If the content-type is
   * not JSON, or the body fails to parse, throw a categorized 'schema' error.
   *
   * @param {Response} res
   * @returns {Promise<*>} the parsed JSON
   */
  function parseJson(res) {
    // Defensive: tolerate a missing/odd Response object.
    if (!res || typeof res.text !== 'function') {
      return Promise.reject(makeError(
        { type: 'schema', userMessage: USER_MESSAGES.schema },
        'No response body'
      ));
    }

    var ct = '';
    try {
      if (res.headers && typeof res.headers.get === 'function') {
        ct = res.headers.get('content-type') || '';
      }
    } catch (e) { ct = ''; }
    ct = String(ct).toLowerCase();

    // If a content-type is present and clearly not JSON (e.g. text/html from
    // the corsproxy error page), reject before we even read JSON.
    var looksJson = ct.indexOf('json') !== -1;
    var hasCt = ct.length > 0;

    return res.text().then(function (text) {
      var body = text == null ? '' : String(text);
      var trimmed = body.replace(/^﻿/, '').trim();

      // Empty body → empty object (matches existing `.catch(()=>({}))` callers).
      if (trimmed.length === 0) return {};

      if (hasCt && !looksJson) {
        // Server declared a non-JSON type — most likely an HTML proxy error.
        throw makeError(
          { type: 'schema', userMessage: USER_MESSAGES.schema },
          'Expected JSON but got "' + ct.split(';')[0] + '"'
        );
      }

      // Even without a content-type (or with one), an HTML doc is never JSON.
      var first = trimmed.charAt(0);
      if (first === '<') {
        throw makeError(
          { type: 'schema', userMessage: USER_MESSAGES.schema },
          'Expected JSON but got an HTML page'
        );
      }

      try {
        return JSON.parse(trimmed);
      } catch (e) {
        throw makeError(
          { type: 'schema', userMessage: USER_MESSAGES.schema },
          'Response was not valid JSON'
        );
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // 2. Typed getters
  // ═══════════════════════════════════════════════════════════════════
  // Shared pipeline: call the (already-decorated) global apiFetch, reject with
  // a categorized error on a non-ok response, parse defensively, validate +
  // hand a sample to diagnostics, then unwrap the envelope the existing code
  // unwraps. Validation failures DO NOT block the data (the API is unofficial
  // and we'd rather degrade than hard-fail) — they only surface drift — EXCEPT
  // when the unwrapped payload is unusable, which the callers handle.

  function getApiFetch() {
    // Resolve at call time so we always use the latest decorated version.
    if (typeof window.apiFetch === 'function') return window.apiFetch;
    if (typeof apiFetch === 'function') return apiFetch; // eslint-disable-line
    return null;
  }

  /**
   * Core request → categorized-on-failure → parsed JSON.
   * @returns {Promise<*>} parsed JSON envelope
   */
  function request(path, opts) {
    var fn = getApiFetch();
    if (!fn) {
      return Promise.reject(makeError(
        categorizeError(new Error('apiFetch unavailable')),
        'API client not ready'
      ));
    }
    var promise;
    try {
      promise = fn(path, opts || {});
    } catch (e) {
      // apiFetch is not expected to throw synchronously, but guard anyway.
      return Promise.reject(makeError(categorizeError(e), 'Request failed'));
    }
    return Promise.resolve(promise).then(function (res) {
      // apiFetch RESOLVES (does not throw) on 4xx/5xx. Categorize and reject
      // so getters present a uniform rejected-Promise contract to callers.
      if (!res || res.ok === false || (typeof res.status === 'number' && res.status >= 400)) {
        var cat = categorizeError(res || new Error('No response'));
        return Promise.reject(makeError(cat, 'Request to ' + path + ' failed'));
      }
      return parseJson(res);
    }, function (err) {
      // Network/timeout/abort rejections from apiFetch land here.
      return Promise.reject(makeError(categorizeError(err), 'Request to ' + path + ' failed'));
    });
  }

  /**
   * Validate + report drift for a parsed payload, then return the data the
   * callers actually consume. `extract(envelope)` pulls the consumable shape
   * (e.g. the `.data` array, or the unwrapped object) out of the envelope.
   */
  function process(kind, envelope, extract) {
    var data;
    try {
      data = extract ? extract(envelope) : envelope;
    } catch (e) {
      data = envelope;
    }
    var validation;
    try {
      validation = validate(kind, data);
    } catch (e) {
      validation = { ok: true, missing: [] };
    }
    // Hand a single sample (first element for collections) to diagnostics for
    // shape logging + drift detection. Never let this throw.
    var sample = Array.isArray(data) ? (data.length ? data[0] : null) : data;
    diagNoteSample(kind, sample, validation);
    // Surface each missing required field via the same drift channel field()
    // uses, so a structural change shows up even if no one reads it yet.
    if (validation && validation.missing && validation.missing.length) {
      for (var i = 0; i < validation.missing.length; i++) {
        diagNoteMissingField(kind + '.' + validation.missing[i]);
      }
    }
    return data;
  }

  /** GET /instructors → unwrapped data[] */
  function getInstructors() {
    return request('/instructors').then(function (env) {
      return process('instructor', env, function (e) {
        return (e && e.data) || [];
      });
    });
  }

  /** GET /locations → unwrapped data[] */
  function getLocations() {
    return request('/locations').then(function (env) {
      return process('location', env, function (e) {
        return (e && e.data) || [];
      });
    });
  }

  /** GET /event-types → unwrapped data[] */
  function getEventTypes() {
    return request('/event-types').then(function (env) {
      return process('eventType', env, function (e) {
        return (e && e.data) || [];
      });
    });
  }

  /** GET /profile → unwrapped object (data.data || data) */
  function getProfile() {
    return request('/profile').then(function (env) {
      return process('profile', env, function (e) {
        return (e && e.data) || e || {};
      });
    });
  }

  /**
   * GET /bookings[?query] → unwrapped list (array or data[]).
   * @param {string} [query] e.g. 'limit=200' or 'type=previous&limit=100'
   */
  function getBookings(query) {
    var q = query ? String(query) : '';
    if (q && q.charAt(0) === '?') q = q.slice(1);
    var path = '/bookings' + (q ? '?' + q : '');
    return request(path).then(function (env) {
      return process('booking', env, function (e) {
        // fetchMyBookings (app.js:199): Array.isArray(data) ? data : data.data
        if (Array.isArray(e)) return e;
        return (e && e.data) || [];
      });
    });
  }

  /**
   * GET /events?<params> → { events, relations } (search code reads both).
   * @param {object|string|URLSearchParams} paramsObj
   * @returns {Promise<{events: Array, relations: (object|null)}>}
   */
  function getEvents(paramsObj) {
    var qs = '';
    if (paramsObj instanceof URLSearchParams) {
      qs = paramsObj.toString();
    } else if (typeof paramsObj === 'string') {
      qs = paramsObj.charAt(0) === '?' ? paramsObj.slice(1) : paramsObj;
    } else if (paramsObj && typeof paramsObj === 'object') {
      try {
        var clean = {};
        Object.keys(paramsObj).forEach(function (k) {
          var v = paramsObj[k];
          if (v !== undefined && v !== null) clean[k] = v;
        });
        qs = new URLSearchParams(clean).toString();
      } catch (e) { qs = ''; }
    }
    var path = '/events' + (qs ? '?' + qs : '');
    return request(path).then(function (env) {
      var events = process('event', env, function (e) {
        return (e && e.data) || [];
      });
      var relations = (env && env.relations) || null;
      return { events: events, relations: relations };
    });
  }

  /**
   * GET /events/{id} → full detail envelope.
   * The detail shape is { data: {event}, relations: {...}, slots: [ids] }, so
   * we return the WHOLE envelope (callers read .data, .relations, and .slots).
   * @param {number|string} id
   */
  function getEventDetail(id) {
    var safeId = encodeURIComponent(String(id == null ? '' : id));
    return request('/events/' + safeId).then(function (env) {
      // Validate the nested event object but return the full envelope intact.
      process('event', env, function (e) {
        return (e && e.data) || {};
      });
      return env;
    });
  }

  /**
   * POST /bookings → created booking envelope (callers read data.data.id || data.id).
   * @param {object} bodyObj e.g. { event_id, slots? }
   */
  function createBooking(bodyObj) {
    var body = bodyObj || {};
    return request('/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (env) {
      process('booking', env, function (e) {
        return (e && e.data) || e || {};
      });
      return env;
    });
  }

  /**
   * DELETE a booking. Accepts a full path ('/bookings/123',
   * '/bookings?event_id=123') or a bare id (number/string → '/bookings/{id}').
   * Resolves to the Response-derived envelope where present; DELETE often has
   * an empty body, so resolves to {} on 200/204 with no content.
   * @param {string|number} pathOrId
   */
  function deleteBooking(pathOrId) {
    var path;
    var raw = pathOrId == null ? '' : String(pathOrId);
    if (raw.charAt(0) === '/') {
      path = raw;
    } else if (raw.indexOf('event_id=') !== -1 || raw.indexOf('?') !== -1) {
      path = '/bookings?' + raw.replace(/^\?/, '');
    } else {
      path = '/bookings/' + encodeURIComponent(raw);
    }
    return request(path, { method: 'DELETE' }).then(function (env) {
      return env || {};
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // Public surface
  // ═══════════════════════════════════════════════════════════════════
  window.PsycleAPI = {
    SCHEMAS: SCHEMAS,

    // typed getters
    getInstructors: getInstructors,
    getLocations: getLocations,
    getEventTypes: getEventTypes,
    getProfile: getProfile,
    getBookings: getBookings,
    getEvents: getEvents,
    getEventDetail: getEventDetail,
    createBooking: createBooking,
    deleteBooking: deleteBooking,

    // utilities
    field: field,
    categorizeError: categorizeError,
    validate: validate,
    parseJson: parseJson,
  };

})();
