/**
 * diagnostic.js — API drift self-diagnosis + safe mode for Psycle Booking PWA
 *
 * The Psycle backend is an UNOFFICIAL / undocumented API that can change its
 * response shapes without notice. This module:
 *   - records the OBSERVED field shape of each API response (field NAMES only,
 *     never values / never PII),
 *   - snapshots a "contract" of those shapes after a healthy authenticated load,
 *   - compares live shapes against that contract AND against the required-field
 *     declarations in PsycleAPI.SCHEMAS,
 *   - and, when expected required fields start disappearing, drops the app into
 *     a visible "safe mode" so the user knows features may misbehave.
 *
 * Loaded AFTER js/api-client.js, so window.PsycleAPI and PsycleAPI.SCHEMAS are
 * expected to exist at call time — but EVERY cross-module access is guarded with
 * typeof because api-client (and reliability.js / state.js) may load in any order
 * during tests or partial builds. Nothing in here is allowed to throw.
 */

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════
  // Storage keys (we introduce two; both store field NAMES only, no PII)
  // ═══════════════════════════════════════════════════════════════════

  // psycle_api_schema_log: live, rolling record of observed shapes.
  //   { [kind]: { fields: [String], lastSeen: ISO, count: Number,
  //               missing: { [path]: Number } } }
  var SCHEMA_LOG_KEY = 'psycle_api_schema_log';

  // psycle_api_contract: a frozen snapshot of the schema log taken once after a
  //   healthy authenticated load, used as the baseline to diff against.
  //   { capturedAt: ISO, shapes: { [kind]: { fields: [String] } } }
  var CONTRACT_KEY = 'psycle_api_contract';

  // Where the last drift was observed (ISO) — surfaced in getDiagnostics().
  var LAST_DRIFT_KEY = 'psycle_api_last_drift';

  var MAX_FIELDS_PER_KIND = 80;   // cap stored field names so the log stays small
  var MAX_KINDS = 40;             // cap number of distinct kinds tracked
  var MISSING_THRESHOLD = 3;      // repeated misses in a session => drift handling
  var CONTRACT_DELAY_MS = 10000;  // self-capture contract ~10s after first records
  var INIT_CHECK_DELAY_MS = 12000;// run the first checkContract shortly after load

  // ── Session-scoped counters (reset on reload; not persisted) ──────────
  // Tracks how many times a given field path has been reported missing THIS
  // session, so transient single misses don't flip us into safe mode.
  var _sessionMisses = {};
  var _recordedAny = false;
  var _contractTimer = null;
  var _safeModeActive = false;

  // ═══════════════════════════════════════════════════════════════════
  // Small storage helpers — never throw
  // ═══════════════════════════════════════════════════════════════════

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var val = JSON.parse(raw);
      return (val === null || val === undefined) ? fallback : val;
    } catch (e) { return fallback; }
  }

  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  function nowISO() {
    try { return new Date().toISOString(); } catch (e) { return ''; }
  }

  /** Safely report an internal problem without ever throwing. */
  function softError(msg) {
    try {
      if (typeof window.pushError === 'function') window.pushError('[diag] ' + msg);
      else if (typeof console !== 'undefined') console.warn('[diag]', msg);
    } catch (e) {}
  }

  // ═══════════════════════════════════════════════════════════════════
  // Shape extraction — field NAMES only, never values
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Derive the set of top-level field names that describe `sample`.
   * - For an array: use the keys of the first plain-object element.
   * - For an object: use its own top-level keys.
   * - Anything else (primitive / null): no fields.
   * Returns a sorted array of strings, capped. NEVER returns values.
   */
  function shapeOf(sample) {
    try {
      var target = sample;
      if (Array.isArray(sample)) {
        target = null;
        for (var i = 0; i < sample.length; i++) {
          if (sample[i] && typeof sample[i] === 'object' && !Array.isArray(sample[i])) {
            target = sample[i];
            break;
          }
        }
      }
      if (!target || typeof target !== 'object' || Array.isArray(target)) return [];
      var keys = Object.keys(target);
      if (keys.length > MAX_FIELDS_PER_KIND) keys = keys.slice(0, MAX_FIELDS_PER_KIND);
      keys.sort();
      return keys;
    } catch (e) {
      softError('shapeOf failed: ' + (e && e.message));
      return [];
    }
  }

  function getSchemaLog() {
    var log = readJSON(SCHEMA_LOG_KEY, {});
    return (log && typeof log === 'object' && !Array.isArray(log)) ? log : {};
  }

  // ═══════════════════════════════════════════════════════════════════
  // Access to PsycleAPI.SCHEMAS — fully guarded
  // ═══════════════════════════════════════════════════════════════════

  /** Return PsycleAPI.SCHEMAS or null if unavailable. */
  function getSchemas() {
    try {
      if (typeof window.PsycleAPI === 'undefined' || !window.PsycleAPI) return null;
      var s = window.PsycleAPI.SCHEMAS;
      return (s && typeof s === 'object') ? s : null;
    } catch (e) { return null; }
  }

  /**
   * Return the array of required field names declared for a kind, or [].
   * Tolerates a few plausible shapes:
   *   SCHEMAS[kind].required = [..]   (preferred)
   *   SCHEMAS[kind] = [..]            (bare array of required fields)
   */
  function requiredFieldsFor(kind) {
    var schemas = getSchemas();
    if (!schemas) return [];
    try {
      var entry = schemas[kind];
      if (!entry) return [];
      if (Array.isArray(entry)) return entry.slice();
      if (Array.isArray(entry.required)) return entry.required.slice();
      return [];
    } catch (e) { return []; }
  }

  // ═══════════════════════════════════════════════════════════════════
  // 1. record(kind, sampleData)
  // ═══════════════════════════════════════════════════════════════════
  // Called by api-client on each SUCCESSFUL response. Stores the observed
  // top-level field shape for `kind`. Cheap, idempotent-ish, never throws,
  // never stores values/PII.

  function record(kind, sampleData) {
    try {
      if (!kind || typeof kind !== 'string') return;
      var fields = shapeOf(sampleData);
      if (!fields.length) return; // nothing useful to record (primitive/empty)

      var log = getSchemaLog();

      // Cap the number of distinct kinds we track to keep storage bounded.
      if (!log[kind] && Object.keys(log).length >= MAX_KINDS) return;

      var prev = log[kind] || {};
      log[kind] = {
        fields: fields,
        lastSeen: nowISO(),
        count: (typeof prev.count === 'number' ? prev.count : 0) + 1,
        // preserve any accumulated missing-field counters across records
        missing: (prev.missing && typeof prev.missing === 'object') ? prev.missing : {},
      };
      writeJSON(SCHEMA_LOG_KEY, log);

      // Arm the opportunistic contract self-capture on the first ever record.
      if (!_recordedAny) {
        _recordedAny = true;
        scheduleContractCapture();
      }
    } catch (e) {
      softError('record failed: ' + (e && e.message));
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // 2. noteMissingField(path)
  // ═══════════════════════════════════════════════════════════════════
  // Called by PsycleAPI.field(...) when an expected field is missing. We
  // increment a persistent counter (for diagnostics) AND a session counter
  // (for the >=3-in-a-session drift trigger). `path` is expected to look like
  // "<kind>.<field>" or "<kind>.<a>.<b>"; we derive kind from the first segment.

  function noteMissingField(path) {
    try {
      if (!path || typeof path !== 'string') return;

      // Persist a per-kind missing counter in the schema log.
      var dot = path.indexOf('.');
      var kind = dot === -1 ? path : path.slice(0, dot);

      var log = getSchemaLog();
      var entry = log[kind] || { fields: [], lastSeen: nowISO(), count: 0, missing: {} };
      if (!entry.missing || typeof entry.missing !== 'object') entry.missing = {};
      entry.missing[path] = (entry.missing[path] || 0) + 1;
      log[kind] = entry;
      writeJSON(SCHEMA_LOG_KEY, log);

      // Session counter (drives the drift trigger; resets on reload).
      _sessionMisses[path] = (_sessionMisses[path] || 0) + 1;

      // If this missing path corresponds to a REQUIRED field and we've now
      // seen it vanish repeatedly this session, treat it as real drift.
      if (_sessionMisses[path] >= MISSING_THRESHOLD) {
        var field = dot === -1 ? '' : path.slice(dot + 1);
        var required = requiredFieldsFor(kind);
        var isRequired = field && required.indexOf(field) !== -1;
        // If we have no schema info at all, fall back to treating a thrice-
        // missing field as suspicious too — but only flag, don't hard-fail.
        if (isRequired) {
          handleDrift('Required field "' + path + '" missing ' +
            _sessionMisses[path] + 'x this session');
        }
      }
    } catch (e) {
      softError('noteMissingField failed: ' + (e && e.message));
    }
  }

  /** Central drift reaction: record timestamp, re-check, enter safe mode. */
  function handleDrift(reason) {
    try {
      writeJSON(LAST_DRIFT_KEY, nowISO());
      var findings = checkContract();
      var hasRequiredLoss = findings.some(function (f) {
        return f.missingRequired && f.missingRequired.length;
      });
      if (hasRequiredLoss || reason) {
        enterSafeMode(reason || 'API response shape changed');
      }
    } catch (e) {
      softError('handleDrift failed: ' + (e && e.message));
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // 3. captureContract()
  // ═══════════════════════════════════════════════════════════════════
  // Snapshot the CURRENT observed shapes (from the schema log) into the
  // contract key with a timestamp. Idempotent-safe to call repeatedly; each
  // call refreshes the baseline. Exposed so security.js / app.js can call it
  // right after a confirmed-healthy authenticated load.

  function captureContract() {
    try {
      var log = getSchemaLog();
      var shapes = {};
      Object.keys(log).forEach(function (kind) {
        var entry = log[kind];
        if (entry && Array.isArray(entry.fields) && entry.fields.length) {
          shapes[kind] = { fields: entry.fields.slice() };
        }
      });
      if (!Object.keys(shapes).length) return null; // nothing observed yet

      var contract = { capturedAt: nowISO(), shapes: shapes };
      writeJSON(CONTRACT_KEY, contract);
      return contract;
    } catch (e) {
      softError('captureContract failed: ' + (e && e.message));
      return null;
    }
  }

  function getContract() {
    var c = readJSON(CONTRACT_KEY, null);
    return (c && typeof c === 'object' && c.shapes) ? c : null;
  }

  /** Arm a one-shot delayed self-capture if no contract exists yet. */
  function scheduleContractCapture() {
    try {
      if (_contractTimer) return;
      _contractTimer = setTimeout(function () {
        _contractTimer = null;
        if (!getContract()) captureContract();
      }, CONTRACT_DELAY_MS);
    } catch (e) {}
  }

  // ═══════════════════════════════════════════════════════════════════
  // 4. checkContract()
  // ═══════════════════════════════════════════════════════════════════
  // Compare live observed shapes against (a) the stored contract and (b)
  // PsycleAPI.SCHEMAS.required. Returns an array of drift findings:
  //   [{ kind, missingRequired: [field...], note }]
  // A finding is emitted when required fields are gone, or when fields the
  // contract guaranteed have disappeared from the live shape.

  function checkContract() {
    var findings = [];
    try {
      var log = getSchemaLog();
      var contract = getContract();
      var contractShapes = (contract && contract.shapes) ? contract.shapes : {};

      // Union of kinds we know about from either source.
      var kinds = {};
      Object.keys(log).forEach(function (k) { kinds[k] = true; });
      Object.keys(contractShapes).forEach(function (k) { kinds[k] = true; });

      Object.keys(kinds).forEach(function (kind) {
        var liveEntry = log[kind];
        // No live observation yet → can't judge drift for this kind.
        if (!liveEntry || !Array.isArray(liveEntry.fields)) return;
        var liveFields = liveEntry.fields;

        // (a) Required-field check against SCHEMAS.
        var required = requiredFieldsFor(kind);
        var missingRequired = required.filter(function (f) {
          return liveFields.indexOf(f) === -1;
        });

        // (b) Contract drift: fields the baseline had that the live shape lost.
        var droppedFromContract = [];
        var baseline = contractShapes[kind];
        if (baseline && Array.isArray(baseline.fields)) {
          droppedFromContract = baseline.fields.filter(function (f) {
            return liveFields.indexOf(f) === -1;
          });
        }

        if (missingRequired.length || droppedFromContract.length) {
          var notes = [];
          if (droppedFromContract.length) {
            notes.push('lost since contract: ' + droppedFromContract.join(', '));
          }
          if (!required.length && !baseline) {
            notes.push('no schema/contract baseline available');
          }
          findings.push({
            kind: kind,
            missingRequired: missingRequired,
            note: notes.join('; '),
          });
        }
      });
    } catch (e) {
      softError('checkContract failed: ' + (e && e.message));
    }
    return findings;
  }

  // ═══════════════════════════════════════════════════════════════════
  // 5. enterSafeMode(reason) / exitSafeMode()
  // ═══════════════════════════════════════════════════════════════════
  // Shows a dismissible amber top banner mirroring the visual approach of the
  // existing #sessionBanner in psycle-finder.html. Idempotent. Emits the
  // PsycleEvents 'api:drift-detected' event (guarded).

  var SAFE_BANNER_ID = 'safeModeBanner';

  function enterSafeMode(reason) {
    try {
      writeJSON(LAST_DRIFT_KEY, nowISO());

      // Emit once per activation so listeners (analytics, etc.) can react.
      if (!_safeModeActive) {
        try {
          if (typeof window.PsycleEvents !== 'undefined' &&
              window.PsycleEvents && typeof window.PsycleEvents.emit === 'function') {
            window.PsycleEvents.emit('api:drift-detected', { reason: String(reason || '') });
          }
        } catch (e) {}
        if (typeof window.pushError === 'function') {
          window.pushError('[diag] safe mode: ' + String(reason || 'API drift detected'));
        }
      }
      _safeModeActive = true;

      // DOM may not exist yet (very early call) — bail quietly; init retry covers it.
      if (typeof document === 'undefined' || !document.body) return;

      // Idempotent: if the banner already exists, leave it as-is.
      if (document.getElementById(SAFE_BANNER_ID)) return;

      var banner = document.createElement('div');
      banner.id = SAFE_BANNER_ID;
      banner.className = 'safe-mode-banner';
      banner.setAttribute('role', 'alert');
      // Inline styles mirror #sessionBanner's amber/warning treatment so it
      // looks native even if css/*.css hasn't shipped a .safe-mode-banner rule.
      banner.style.cssText =
        'display:flex;background:#1a0f0a;border-bottom:1px solid #4a2010;' +
        'padding:10px 24px;font-size:13px;color:#e0a040;align-items:center;gap:12px';

      var msg = document.createElement('span');
      msg.textContent = '⚠️ Heads up: Psycle’s data looks different than ' +
        'expected — some features may misbehave. The app is running in safe mode.';
      banner.appendChild(msg);

      var details = document.createElement('button');
      details.type = 'button';
      details.textContent = 'Details';
      details.style.cssText =
        'background:none;border:none;color:#e0a040;font-weight:700;cursor:pointer;' +
        'font-size:13px;text-decoration:underline;padding:0';
      details.onclick = function () { openDiagnostics(); };
      banner.appendChild(details);

      var dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.setAttribute('aria-label', 'Dismiss');
      dismiss.textContent = '×';
      dismiss.style.cssText =
        'margin-left:auto;background:none;border:none;color:#666;cursor:pointer;' +
        'font-size:16px;line-height:1';
      dismiss.onclick = function () { removeBanner(); };
      banner.appendChild(dismiss);

      // Insert directly after the session banner if present, else at top of body.
      var sessionBanner = document.getElementById('sessionBanner');
      if (sessionBanner && sessionBanner.parentNode) {
        sessionBanner.parentNode.insertBefore(banner, sessionBanner.nextSibling);
      } else {
        document.body.insertBefore(banner, document.body.firstChild);
      }
    } catch (e) {
      softError('enterSafeMode failed: ' + (e && e.message));
    }
  }

  function removeBanner() {
    try {
      var el = document.getElementById(SAFE_BANNER_ID);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    } catch (e) {}
  }

  function exitSafeMode() {
    try {
      _safeModeActive = false;
      removeBanner();
    } catch (e) {
      softError('exitSafeMode failed: ' + (e && e.message));
    }
  }

  /**
   * Open the diagnostics view. We don't own a diagnostics panel yet, so we do
   * the best available: open the settings panel (a future diagnostics section
   * lives there), surface a toast, and dump the report to the console so it's
   * always inspectable. All guarded.
   */
  function openDiagnostics() {
    try {
      var diag = getDiagnostics();
      if (typeof console !== 'undefined' && console.log) {
        console.log('[psycle-diagnostics]', diag);
      }
      if (typeof window.openSettings === 'function') {
        window.openSettings();
      } else if (typeof window.toast === 'function') {
        window.toast('Diagnostics logged to console', 'info');
      }
    } catch (e) {
      softError('openDiagnostics failed: ' + (e && e.message));
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // 6. getDiagnostics()
  // ═══════════════════════════════════════════════════════════════════
  // Plain object for a future settings/diagnostics panel. No PII.

  function getDiagnostics() {
    var errorLogCount = 0;
    var actionLogCount = 0;
    try {
      if (typeof window.getErrorLog === 'function') {
        var el = window.getErrorLog();
        errorLogCount = Array.isArray(el) ? el.length : 0;
      }
    } catch (e) {}
    try {
      if (typeof window.getActionLog === 'function') {
        var al = window.getActionLog();
        actionLogCount = Array.isArray(al) ? al.length : 0;
      }
    } catch (e) {}

    var liveShapes = {};
    try {
      var log = getSchemaLog();
      Object.keys(log).forEach(function (kind) {
        var entry = log[kind] || {};
        liveShapes[kind] = {
          fields: Array.isArray(entry.fields) ? entry.fields.slice() : [],
          lastSeen: entry.lastSeen || null,
          count: typeof entry.count === 'number' ? entry.count : 0,
          missing: (entry.missing && typeof entry.missing === 'object') ? entry.missing : {},
        };
      });
    } catch (e) {}

    var appVersion = null;
    try {
      if (typeof window.PsycleAPI !== 'undefined' && window.PsycleAPI && window.PsycleAPI.VERSION) {
        appVersion = String(window.PsycleAPI.VERSION);
      } else if (window.APP_VERSION) {
        appVersion = String(window.APP_VERSION);
      }
    } catch (e) {}

    return {
      contract: getContract(),
      liveShapes: liveShapes,
      drift: checkContract(),
      safeMode: _safeModeActive,
      errorLogCount: errorLogCount,
      actionLogCount: actionLogCount,
      lastDriftAt: readJSON(LAST_DRIFT_KEY, null),
      appVersion: appVersion,
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // 7. Self-init — run one contract check after the app's initial calls
  // ═══════════════════════════════════════════════════════════════════
  // Defensive on every front: PsycleEvents may not exist; the initial loads
  // may or may not have happened; the contract may or may not be captured.

  var _initialCheckDone = false;

  function runInitialCheck() {
    if (_initialCheckDone) return;
    _initialCheckDone = true;
    try {
      // Make sure we have a baseline to compare against; if records have
      // landed but no contract exists, capture one now so the check is meaningful.
      if (!getContract() && Object.keys(getSchemaLog()).length) {
        captureContract();
      }
      var findings = checkContract();
      var requiredLoss = findings.some(function (f) {
        return f.missingRequired && f.missingRequired.length;
      });
      if (requiredLoss) {
        enterSafeMode('Expected required fields are missing from the API response');
      }
    } catch (e) {
      softError('runInitialCheck failed: ' + (e && e.message));
    }
  }

  // Trigger A: once bookings have loaded (signals a healthy authenticated pass).
  try {
    if (typeof window.PsycleEvents !== 'undefined' &&
        window.PsycleEvents && typeof window.PsycleEvents.on === 'function') {
      window.PsycleEvents.on('bookings:loaded', function () {
        // Treat the first bookings:loaded as confirmation of a healthy load:
        // capture a contract if we don't have one, then check for drift.
        try { if (!getContract()) captureContract(); } catch (e) {}
        runInitialCheck();
      });
    }
  } catch (e) {}

  // Trigger B: a plain delayed fallback, in case the event never fires.
  try { setTimeout(runInitialCheck, INIT_CHECK_DELAY_MS); } catch (e) {}

  // ═══════════════════════════════════════════════════════════════════
  // Public surface
  // ═══════════════════════════════════════════════════════════════════

  window.PsycleDiag = {
    record: record,
    noteMissingField: noteMissingField,
    captureContract: captureContract,
    checkContract: checkContract,
    enterSafeMode: enterSafeMode,
    exitSafeMode: exitSafeMode,
    getDiagnostics: getDiagnostics,
  };

})();
