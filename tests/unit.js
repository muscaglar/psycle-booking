#!/usr/bin/env node
/**
 * tests/unit.js — Dependency-free Node test runner for the Psycle Booking PWA.
 *
 * Runs with plain `node tests/unit.js` from the repo root. No framework, no npm
 * deps. It builds a MINIMAL browser shim (fake localStorage, a tiny document
 * with the textContent→innerHTML escaping that security.js relies on, a window
 * object, navigator) and uses node's `vm` module to evaluate the three
 * "resilience layer" modules in that shimmed global:
 *
 *     js/security.js   (escapeHTML)
 *     js/api-client.js (PsycleAPI: categorizeError, SCHEMAS)
 *     js/diagnostic.js (PsycleDiag: record, checkContract, captureContract)
 *
 * plus ios-app/www/native-bridge.js, which (with no window.Capacitor) bails
 * immediately but first exports its pure Europe/London class-time resolver
 * (window._psycleClassStartMs) — the DST math is asserted here with the
 * process pinned to a NON-UK zone.
 *
 * We deliberately do NOT load app.js / tabs.js / etc wholesale — those need a
 * full DOM. The one exception: js/app.js's DOM-free waitlist helpers, which
 * live between the `// ── waitlist:pure:start` / `// ── waitlist:pure:end`
 * markers; that block alone is sliced out and vm-evaluated below (once bare,
 * once with a `window` carrying the bridge's London resolver). Keep it free
 * of document/window state and app globals or this runner crashes.
 *
 * Exit code is 1 if any assertion fails, 0 otherwise.
 */

'use strict';

// Run the whole suite as a NON-UK device. The gym is Europe/London and the
// API's class times are naive UK wall-clock strings; native-bridge.js must
// resolve them through Europe/London, never the device zone. Pinning the
// process to New York makes a device-local parse visibly disagree with the
// correct London instant (Node re-reads TZ on assignment, v13+).
process.env.TZ = 'America/New_York';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO_ROOT = path.resolve(__dirname, '..');
const JS_DIR = path.join(REPO_ROOT, 'js');
const NATIVE_BRIDGE = path.join(REPO_ROOT, 'ios-app', 'www', 'native-bridge.js');

// ════════════════════════════════════════════════════════════════════════
// Tiny test harness: assert + PASS/FAIL counters
// ════════════════════════════════════════════════════════════════════════

let passed = 0;
let failed = 0;
const failures = [];

function ok(cond, msg) {
  if (cond) {
    passed++;
    console.log('  ✓ ' + msg);
  } else {
    failed++;
    failures.push(msg);
    console.log('  ✗ ' + msg);
  }
}

function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(a === e, msg + '  (expected ' + e + ', got ' + a + ')');
}

function section(name) {
  console.log('\n' + name);
}

// Source text of a repo file, e.g. readSource('js/app.js').
function readSource(relFile) {
  return fs.readFileSync(path.join(REPO_ROOT, relFile), 'utf8');
}

// Evaluate a module's DOM-free helpers without loading the module. The source
// marks them with `// ── pure:<name>:start` … `// ── pure:<name>:end` (the pair
// may repeat; regions are concatenated in file order) and they run in a fresh
// vm context seeded with `globals`. Returns the context: top-level `function`
// and `var` declarations are reachable on it, `const`/`let` are not.
function loadPure(relFile, name, globals) {
  const src = readSource(relFile);
  const startTag = '// ── pure:' + name + ':start';
  const endTag = '// ── pure:' + name + ':end';
  const regions = [];
  let from = 0;
  for (;;) {
    const s = src.indexOf(startTag, from);
    if (s === -1) break;
    const e = src.indexOf(endTag, s);
    if (e === -1) throw new Error(relFile + ': ' + startTag + ' has no matching end marker');
    regions.push(src.slice(s, e));
    from = e + endTag.length;
  }
  if (!regions.length) throw new Error(relFile + ': no pure:' + name + ' markers found');
  const ctx = vm.createContext(Object.assign({ console, Date, Math, JSON, Intl, Set, Map, Number, String, Array, Object, isNaN, parseInt, parseFloat }, globals || {}));
  vm.runInContext(regions.join('\n'), ctx, { filename: relFile + '[pure:' + name + ']' });
  return ctx;
}

// ════════════════════════════════════════════════════════════════════════
// Minimal browser shim
// ════════════════════════════════════════════════════════════════════════
//
// The three modules touch, at load time and during the methods we test:
//   - document.createElement('div')  → security.js escapeHTML (textContent→innerHTML)
//   - document.getElementById / body / createElement(...) → diagnostic.js safe-mode banner
//   - localStorage (get/set/remove/clear) → diagnostic.js schema log + security error log
//   - window.* → all three modules export onto window
//   - navigator.onLine → categorizeError network heuristic
//   - crypto / indexedDB → INTENTIONALLY ABSENT so security.js's _cryptoAvailable
//     is false and it takes the synchronous XOR / no-crypto path (escapeHTML,
//     the only thing we test from security.js, never needs crypto).
//
// btoa/atob/TextEncoder/TextDecoder/URLSearchParams/setTimeout/console are
// provided natively by Node, so we just pass them through into the sandbox.

function makeFakeLocalStorage() {
  const store = new Map();
  return {
    getItem(k) {
      k = String(k);
      return store.has(k) ? store.get(k) : null;
    },
    setItem(k, v) {
      store.set(String(k), String(v));
    },
    removeItem(k) {
      store.delete(String(k));
    },
    clear() {
      store.clear();
    },
    key(i) {
      return Array.from(store.keys())[i] || null;
    },
    get length() {
      return store.size;
    },
    // test helper, not part of the DOM API
    _dump() {
      return Object.fromEntries(store);
    },
  };
}

// The only DOM behaviour escapeHTML depends on: set .textContent on a <div>,
// then read .innerHTML back HTML-escaped (& < > " '). We replicate the browser's
// escaping precisely. Browsers escape &, <, > in text content; attribute-only
// chars (" ') are NOT escaped by innerHTML of an element's text node, but
// BROWSER-ACCURATE text-node serialization: real browsers escape ONLY & < >
// when reading innerHTML back from textContent — quotes pass through raw.
// The shim must match, or assertions about quote-escaping would test the
// shim instead of the shipped code. (escapeHTML in security.js no longer
// uses the DOM at all — it string-replaces & < > " ' itself, and the
// assertions below exercise that real implementation.)
const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
};

function htmlEscape(str) {
  return String(str).replace(/[&<>]/g, (c) => HTML_ESCAPE_MAP[c]);
}

function makeFakeElement(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    _textContent: '',
    _innerHTML: '',
    id: '',
    className: '',
    style: { cssText: '' },
    type: '',
    parentNode: null,
    childNodes: [],
    onclick: null,
    setAttribute() {},
    appendChild(child) {
      this.childNodes.push(child);
      child.parentNode = this;
      return child;
    },
    insertBefore(node, ref) {
      this.childNodes.push(node);
      node.parentNode = this;
      return node;
    },
    removeChild(child) {
      const i = this.childNodes.indexOf(child);
      if (i !== -1) this.childNodes.splice(i, 1);
      return child;
    },
  };
  Object.defineProperty(el, 'textContent', {
    get() {
      return this._textContent;
    },
    set(v) {
      this._textContent = v == null ? '' : String(v);
      // Browser-accurate-enough: setting textContent updates innerHTML to the
      // HTML-escaped form of the text. (We escape a superset; see note above.)
      this._innerHTML = htmlEscape(this._textContent);
    },
  });
  Object.defineProperty(el, 'innerHTML', {
    get() {
      return this._innerHTML;
    },
    set(v) {
      this._innerHTML = v == null ? '' : String(v);
    },
  });
  Object.defineProperty(el, 'firstChild', {
    get() {
      return this.childNodes[0] || null;
    },
  });
  Object.defineProperty(el, 'nextSibling', {
    get() {
      return null;
    },
  });
  return el;
}

function makeFakeDocument() {
  const byId = {};
  const body = makeFakeElement('body');
  return {
    body,
    createElement(tag) {
      return makeFakeElement(tag);
    },
    getElementById(id) {
      return byId[id] || null;
    },
    // test helper
    _register(el) {
      if (el.id) byId[el.id] = el;
    },
  };
}

// Build one fresh sandbox with the shim, evaluate the three modules into it.
function buildSandbox() {
  const fakeLocalStorage = makeFakeLocalStorage();
  const fakeDocument = makeFakeDocument();

  // The window object IS the global in a browser; we make the sandbox global
  // object double as `window` so `window.foo = ...` and bare `foo` agree.
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.document = fakeDocument;
  sandbox.localStorage = fakeLocalStorage;
  sandbox.navigator = { onLine: true, userAgent: 'node-test' };
  sandbox.location = { href: 'http://localhost/', origin: 'http://localhost' };
  sandbox.console = console;

  // Native primitives Node already provides — pass them through.
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.setInterval = setInterval;
  sandbox.clearInterval = clearInterval;
  sandbox.btoa = (typeof btoa === 'function')
    ? btoa
    : (s) => Buffer.from(s, 'binary').toString('base64');
  sandbox.atob = (typeof atob === 'function')
    ? atob
    : (s) => Buffer.from(s, 'base64').toString('binary');
  sandbox.TextEncoder = TextEncoder;
  sandbox.TextDecoder = TextDecoder;
  sandbox.URLSearchParams = URLSearchParams;
  sandbox.URL = URL;
  sandbox.Promise = Promise;

  // crypto / indexedDB intentionally absent → security.js _cryptoAvailable=false.
  // addEventListener is referenced by security.js at load (message listener).
  sandbox.addEventListener = function () {};
  sandbox.removeEventListener = function () {};
  sandbox.dispatchEvent = function () {};

  vm.createContext(sandbox);

  function loadModule(file) {
    const code = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
  }

  loadModule('security.js');
  loadModule('api-client.js');
  loadModule('diagnostic.js');

  // ios-app/www/native-bridge.js — the Capacitor bridge. With no
  // window.Capacitor in the sandbox its IIFE bails at once, but not before
  // exporting its pure Europe/London date helper (window._psycleClassStartMs),
  // which we test below. Its "[native] Not running in Capacitor" line is
  // muted to keep the report clean.
  const realLog = sandbox.console.log;
  sandbox.console = Object.assign({}, sandbox.console, {
    log(...args) {
      if (typeof args[0] === 'string' && args[0].startsWith('[native]')) return;
      realLog.apply(console, args);
    },
  });
  vm.runInContext(fs.readFileSync(NATIVE_BRIDGE, 'utf8'), sandbox, { filename: 'native-bridge.js' });
  sandbox.console = console;

  return { sandbox, fakeLocalStorage, fakeDocument };
}

// ════════════════════════════════════════════════════════════════════════
// Run the suite
// ════════════════════════════════════════════════════════════════════════

async function run() {
  const { sandbox, fakeLocalStorage } = buildSandbox();
  const escapeHTML = sandbox.escapeHTML;
  const API = sandbox.PsycleAPI;
  const Diag = sandbox.PsycleDiag;

  // ── escapeHTML ─────────────────────────────────────────────────────────
  section('escapeHTML (js/security.js)');
  ok(typeof escapeHTML === 'function', 'window.escapeHTML is a function');
  eq(escapeHTML('<'), '&lt;', 'escapes <');
  eq(escapeHTML('>'), '&gt;', 'escapes >');
  eq(escapeHTML('&'), '&amp;', 'escapes &');
  eq(escapeHTML('"'), '&quot;', 'escapes "');
  eq(escapeHTML("'"), '&#39;', "escapes '");
  eq(escapeHTML('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;', 'escapes a mixed string');
  eq(escapeHTML(null), '', 'null → empty string (|| "" guard)');
  eq(escapeHTML(undefined), '', 'undefined → empty string');

  // Known XSS payload: x');alert(1)//
  // Expectation: the raw single-quote that would close a JS string and the
  // angle brackets that would open a tag are gone. After escaping, the output
  // contains no raw `'`, `<`, `>` — so it cannot break out of a quoted JS
  // string literal or inject a tag. These assertions run against the REAL
  // escapeHTML from js/security.js (pure string-replace, no DOM involved).
  const xss = "x');alert(1)//";
  const escaped = escapeHTML(xss);
  ok(escaped.indexOf("'") === -1, "XSS payload: no raw ' survives (cannot close a JS string)");
  ok(escaped.indexOf('<') === -1, 'XSS payload: no raw < survives (cannot open a tag)');
  ok(escaped.indexOf('>') === -1, 'XSS payload: no raw > survives');
  ok(escaped.indexOf('&#39;') !== -1, "XSS payload: the ' is encoded as &#39;");

  // ── escapeForJsString ───────────────────────────────────────────────────
  // The only sanctioned way to put a value inside a single-quoted JS string
  // within an HTML attribute (onclick="f('<here>')"). Contract: JS-escape
  // backslash+quote FIRST, then HTML-escape — the attribute parser decodes
  // entities before the JS parser runs, so the decoded text must be a valid
  // single-quoted JS string.
  section('escapeForJsString (js/security.js)');
  const escJs = sandbox.escapeForJsString;
  ok(typeof escJs === 'function', 'window.escapeForJsString is a function');
  eq(escJs("O'Brien"), 'O\\&#39;Brien', "quote is JS-escaped then HTML-encoded (\\&#39;)");
  eq(escJs('back\\slash'), 'back\\\\slash', 'backslash is doubled');
  eq(escJs('plain'), 'plain', 'plain text passes through');
  eq(escJs(null), '', 'null → empty string');
  // After the HTML attribute parser decodes entities, the JS source must
  // contain \' (escaped quote), never a bare quote that closes the string.
  const decodedJs = escJs("x');alert(1)//").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  eq(decodedJs, "x\\');alert(1)//", 'decoded attribute text keeps the quote JS-escaped');

  // ── categorizeError ─────────────────────────────────────────────────────
  section('PsycleAPI.categorizeError (js/api-client.js)');
  ok(typeof API === 'object' && API, 'window.PsycleAPI exists');

  function checkCat(input, expectedType, label) {
    const r = API.categorizeError(input);
    eq(r.type, expectedType, label + ' → type ' + expectedType);
    ok(typeof r.userMessage === 'string' && r.userMessage.length > 0,
      label + ' → non-empty userMessage');
  }

  // Response-like objects need an .ok / .headers / .statusText so the status
  // branch fires (matches the real Response shape).
  checkCat({ status: 401, ok: false }, 'auth', '{status:401}');
  checkCat({ status: 429, ok: false }, 'rate-limit', '{status:429}');
  checkCat({ status: 503, ok: false }, 'server', '{status:503}');

  const tErr = new TypeError('Failed to fetch');
  checkCat(tErr, 'network', "TypeError('Failed to fetch')");

  const abortErr = new Error('The operation was aborted');
  abortErr.name = 'AbortError';
  checkCat(abortErr, 'timeout', 'AbortError');

  // bonus: bare numeric status codes also work
  eq(API.categorizeError(403).type, 'auth', 'bare 403 → auth');
  eq(API.categorizeError(500).type, 'server', 'bare 500 → server');

  // ── PsycleDiag.record + checkContract ────────────────────────────────────
  section('PsycleDiag.record + checkContract (js/diagnostic.js)');
  ok(typeof Diag === 'object' && Diag, 'window.PsycleDiag exists');

  const completeEvent = {
    id: 1,
    start_at: '2026-06-14T10:00:00Z',
    studio_id: 2,
    instructor_id: 3,
    event_type_id: 4,
    duration: 45,
    is_fully_booked: false,
  };
  const missingStart = Object.assign({}, completeEvent);
  delete missingStart.start_at;

  // Start from a clean slate so prior records don't leak between assertions.
  fakeLocalStorage.clear();

  // 1) Record a shape that SATISFIES the 'event' schema (all required present).
  Diag.record('event', completeEvent);
  Diag.captureContract(); // freeze this healthy shape as the baseline contract
  let findings = Diag.checkContract();
  const eventFinding = findings.find((f) => f.kind === 'event');
  ok(!eventFinding || eventFinding.missingRequired.length === 0,
    'after recording a complete event, checkContract reports no required-field drift');

  // 2) Now record a shape MISSING a required field ('start_at') for the same
  //    kind. The live shape loses start_at → drift must surface.
  fakeLocalStorage.clear();
  Diag.record('event', missingStart);
  findings = Diag.checkContract();
  const driftFinding = findings.find((f) => f.kind === 'event');
  ok(driftFinding && driftFinding.missingRequired.indexOf('start_at') !== -1,
    "after recording an event missing 'start_at', checkContract surfaces it as missing-required drift");

  // ── Europe/London class-time resolution ─────────────────────────────────
  // The gym is UK-based and the API sends naive UK wall-clock times with no
  // offset. native-bridge.js must turn them into absolute instants through
  // Europe/London — NOT the device zone. This whole suite runs with
  // TZ=America/New_York (see top of file), so a device-local parse would
  // land 5h (EDT) / 5h (EST) away from the correct London instant.
  section('Europe/London class-time resolution (ios-app/www/native-bridge.js)');
  const classStartMs = sandbox._psycleClassStartMs;
  ok(typeof classStartMs === 'function', 'window._psycleClassStartMs is exported by the bridge');
  const utc = (y, mo, d, h, mi, s) => Date.UTC(y, mo - 1, d, h, mi || 0, s || 0);
  eq(classStartMs('2026-01-15 07:00:00'), utc(2026, 1, 15, 7, 0), 'winter class (GMT): 07:00 London = 07:00Z');
  eq(classStartMs('2026-08-05 07:00:00'), utc(2026, 8, 5, 6, 0), 'summer class (BST): 07:00 London = 06:00Z');
  eq(classStartMs('2026-03-28 18:30:00'), utc(2026, 3, 28, 18, 30), 'eve of spring-forward is still GMT (+0)');
  eq(classStartMs('2026-03-29 07:00:00'), utc(2026, 3, 29, 6, 0), 'morning after spring-forward is BST (+1)');
  eq(classStartMs('2026-10-24 18:00:00'), utc(2026, 10, 24, 17, 0), 'day before autumn-back is BST (+1)');
  eq(classStartMs('2026-10-25 12:00:00'), utc(2026, 10, 25, 12, 0), 'after autumn-back is GMT (+0)');
  eq(classStartMs('2026-08-05T07:00:00'), utc(2026, 8, 5, 6, 0), "the 'T' separator form is equivalent");
  eq(classStartMs('2026-08-05 07:00'), utc(2026, 8, 5, 6, 0), 'the no-seconds form is equivalent');
  eq(classStartMs('2026-08-05 07:00:00.000'), utc(2026, 8, 5, 6, 0), 'fractional-seconds serialization is UK wall clock too');
  eq(classStartMs('2026-08-05T06:00:00Z'), utc(2026, 8, 5, 6, 0), 'an explicit Z is respected as-is');
  eq(classStartMs('2026-08-05T07:00:00+01:00'), utc(2026, 8, 5, 6, 0), 'an explicit offset is respected as-is');
  eq(classStartMs('2026-08-05 07:00:00 +01:00'), utc(2026, 8, 5, 6, 0), 'a space-separated offset still parses (legacy rescue path)');
  eq(classStartMs(utc(2026, 8, 5, 6, 0)), utc(2026, 8, 5, 6, 0), 'a numeric epoch passes straight through');
  eq(classStartMs('2026-08-05'), Date.UTC(2026, 7, 5), 'a date-only string keeps its old spec meaning (UTC midnight)');
  ok(classStartMs('2026-08-05 07:00:00') !== Date.parse('2026-08-05T07:00:00'),
    'on a non-UK device (TZ=America/New_York) the result differs from a device-local parse — the bug this guards');
  ok(Number.isNaN(classStartMs('not a date')), 'unparseable input → NaN');
  ok(Number.isNaN(classStartMs('')) && Number.isNaN(classStartMs(null)), 'empty/null → NaN');

  // ── Waitlist pure helpers (js/app.js) ────────────────────────────────────
  // app.js needs a full DOM, so only its DOM-free waitlist block (delimited by
  // the waitlist:pure:start/end markers) is evaluated here. These helpers
  // encode the live-verified /waitlists contract: entry normalisation, the
  // "one place per class / real booking wins" merge, and the response
  // predicates for join (422 already-on) and leave (500 already-cancelled).
  section('Waitlist pure helpers (js/app.js waitlist:pure block)');
  const appSrc = fs.readFileSync(path.join(JS_DIR, 'app.js'), 'utf8');
  const startMark = appSrc.indexOf('// ── waitlist:pure:start');
  const endMark = appSrc.indexOf('// ── waitlist:pure:end');
  ok(startMark !== -1 && endMark > startMark, 'app.js carries the waitlist:pure:start/end markers');
  const wl = {};
  vm.createContext(wl);
  vm.runInContext(appSrc.slice(startMark, endMark), wl, { filename: 'app.js[waitlist:pure]' });
  ok(typeof wl._normaliseWaitlistEntry === 'function' && typeof wl._mergeWaitlistsIntoBookings === 'function',
    'the pure block defines _normaliseWaitlistEntry and _mergeWaitlistsIntoBookings');

  // Shapes captured live from GET /waitlists (2026-08): nested event, no flat event_id.
  const liveEntry = {
    id: 295302, customer: { id: 1 }, status: 'waiting',
    added_at: '2026-08-08T21:51:55.000000Z', expires_at: null, cancelled_at: null, allocated_at: null,
    event: {
      id: 212203, start_at: '2026-08-12 07:30:00', duration: 45, duration_in_minutes: 1, required_credits: 1,
      is_class_full: true, is_waitlistable: true, available_slot_count: 0, available_slots: [],
      event_type: { id: 2240, name: 'RIDE: 45' }, instructor: { id: 141, full_name: 'Aaron' },
      studio: { id: 160, name: 'Ride Studio', has_layout: true, location: { id: 1, name: 'Psycle Oxford Circus', address: '76 Mortimer St' } },
    },
  };
  const n = wl._normaliseWaitlistEntry(liveEntry);
  eq([n.id, n.eventId, n.status, n.expiresAt, n.allocatedAt, n.cancelledAt], [295302, 212203, 'waiting', null, null, null],
    'normalise: id / event.id / status / null timestamps from the live GET shape');
  eq(wl._normaliseWaitlistEntry({ id: '77', event_id: '9001', status: 'WAITING' }).eventId, 9001, 'normalise: flat event_id (string) is accepted and numbered');
  eq(wl._normaliseWaitlistEntry({ id: 295434, added_at: 'x' }, 212225).eventId, 212225,
    'normalise: the minimal PUT response object takes the fallback event id');
  eq(wl._normaliseWaitlistEntry({ event: { id: 5 } }), null, 'normalise: no entry id → null');
  eq(wl._normaliseWaitlistEntry(null), null, 'normalise: null → null');

  ok(wl._isActiveWaitlistEntry(n), 'active: a plain waiting entry holds a place');
  ok(!wl._isActiveWaitlistEntry(Object.assign({}, n, { cancelledAt: '2026-08-10 12:44:36' })), 'active: cancelled_at set → not a place');
  ok(!wl._isActiveWaitlistEntry(Object.assign({}, n, { allocatedAt: '2026-08-11 09:00:00' })), 'active: allocated_at set → it is a booking now, not a place');
  ok(!wl._isActiveWaitlistEntry(Object.assign({}, n, { status: 'expired' })), 'active: status expired → not a place');

  const nowMs = Date.UTC(2026, 7, 12, 5, 0);
  ok(!wl._waitlistOfferPending(n, nowMs), 'offer: plain waiting entry has no offer pending');
  ok(wl._waitlistOfferPending(Object.assign({}, n, { expiresAt: '2026-08-12 07:05:00' }), nowMs), 'offer: a future expires_at means a spot is being offered');
  ok(!wl._waitlistOfferPending(Object.assign({}, n, { expiresAt: '2026-08-11 07:05:00' }), nowMs), 'offer: a past expires_at is no longer an offer');
  ok(wl._waitlistOfferPending(Object.assign({}, n, { status: 'notified' }), nowMs), 'offer: an offered/notified status counts as an offer');

  eq(wl._waitlistEntryFromResponse({ success: true, waitlist: { id: 295434, added_at: 'x' } }, 212225).id, 295434,
    'response: PUT {success, waitlist:{…}} → the created entry');
  eq(wl._waitlistEntryFromResponse({ data: [liveEntry] }).eventId, 212203, 'response: {data:[…]} (GET / vendor PUT variant) → first entry');
  eq(wl._waitlistEntryFromResponse({ data: liveEntry }).id, 295302, 'response: {data:{…}} (GET /waitlist/{id}) → the entry');
  eq(wl._waitlistEntryFromResponse({ message: 'nope' }, 1), null, 'response: an error body → null');

  ok(wl._isAlreadyOnWaitlistResponse(422, 'You are already on this waitlist'), 'join: 422 "already on this waitlist" is recognised (live message)');
  ok(!wl._isAlreadyOnWaitlistResponse(422, 'Booking slot required'), 'join: other 422s are real failures');
  ok(!wl._isAlreadyOnWaitlistResponse(500, 'You are already on this waitlist'), 'join: only 409/422 qualify');

  ok(wl._waitlistLeaveSucceeded(true, 200, ''), 'leave: 2xx → left');
  ok(wl._waitlistLeaveSucceeded(false, 404, ''), 'leave: 404 → already gone counts as left');
  ok(wl._waitlistLeaveSucceeded(false, 500, 'Cannot cancel waitlist as has already been cancelled.  Waitlist #295434 previously cancelled 2026-08-10 12:44:36'),
    'leave: the server\'s 500 "already been cancelled" (live message) counts as left');
  ok(!wl._waitlistLeaveSucceeded(false, 500, 'Server exploded'), 'leave: any other 500 is a failure');
  ok(!wl._waitlistLeaveSucceeded(false, 403, 'Waitlist closed'), 'leave: 403 is a failure the user must see');

  const seeded = wl._eventCacheEntryFromWaitlist(liveEntry.event);
  eq([seeded.id, seeded.start_at, seeded.duration, seeded.studio_id, seeded.instructor_id, seeded.event_type_id],
    [212203, '2026-08-12T07:30:00', 45, 160, 141, 2240],
    'seed: event ids/duration lifted from the nested objects; start_at normalised to the T form');
  eq([seeded._typeName, seeded._instrName, seeded._locName, seeded._locFullName, seeded._studioName, seeded.is_fully_booked],
    ['RIDE: 45', 'Aaron', 'Oxford Circus', 'Psycle Oxford Circus', 'Ride Studio', true],
    'seed: display names + full flag derived like fetchMyBookings does');
  eq(wl._eventCacheEntryFromWaitlist({ id: 1 }), null, 'seed: no start_at → null (never render an undated card)');

  // Merge: real booking wins; place-only event becomes a waitlisted entry; inactive entries ignored.
  const bookings = { '500': { bookingId: 9, slots: [12], slotBookings: { 12: 9 } } };
  const e1 = wl._normaliseWaitlistEntry(liveEntry);                                   // event 212203, place only
  const e2 = wl._normaliseWaitlistEntry({ id: 2, status: 'waiting', event: { id: 500 } }); // event 500, already booked
  const e3 = wl._normaliseWaitlistEntry({ id: 3, status: 'waiting', cancelled_at: '2026-08-10 12:00:00', event: { id: 600 } });
  const e4 = wl._normaliseWaitlistEntry({ id: 4, status: 'waiting', event: { id: 212203 } }); // duplicate for 212203
  wl._mergeWaitlistsIntoBookings(bookings, [e1, e2, e3, e4, null]);
  eq(Object.keys(bookings).sort(), ['212203', '500'], 'merge: place-only event added; cancelled entry (600) ignored');
  eq([bookings['212203'].waitlisted, bookings['212203'].bookingId, bookings['212203'].slots.length, bookings['212203'].waitlist.id],
    [true, null, 0, 295302], 'merge: place-only entry is {waitlisted:true, bookingId:null, slots:[], waitlist:{id}} and keeps the FIRST place');
  eq([bookings['500'].waitlisted, bookings['500'].slots, bookings['500'].waitlist.id], [false, [12], 2],
    'merge: a real booking keeps its seat and waitlisted:false, with the place attached as .waitlist');
  ok(JSON.stringify(bookings).indexOf('customer') === -1, 'merge: no customer PII is copied into app state');

  // Stale places (class started > 1h ago) are skipped when a clock is supplied.
  const stale = {};
  const longAgo = wl._normaliseWaitlistEntry({ id: 9, status: 'waiting', event: { id: 700, start_at: '2020-01-01 07:00:00' } });
  wl._mergeWaitlistsIntoBookings(stale, [longAgo], Date.UTC(2026, 7, 10));
  eq(Object.keys(stale), [], 'merge: an entry whose class is long past is not merged when nowMs is given');
  wl._mergeWaitlistsIntoBookings(stale, [longAgo]);
  eq(Object.keys(stale), ['700'], 'merge: without a clock (legacy callers) every active entry is merged');

  // Offer detail (GET /waitlist/{id}) → claimable or not; conservative on missing fields.
  const full = wl._waitlistOfferFromDetail({ data: { id: 1, event: { is_class_full: true, available_slot_count: 0, available_slots: [], required_credits: 1 } } }, 5);
  eq([full.available, full.free, full.isClassFull, full.requiredCredits, full.checkedAt], [false, 0, true, 1, 5], 'offer: a full class is not claimable (live GET shape)');
  const open = wl._waitlistOfferFromDetail({ data: { id: 1, event: { is_class_full: false, available_slots: [13], required_credits: 1 } } }, 5);
  eq([open.available, open.free], [true, 1], 'offer: is_class_full:false with a free slot is claimable');
  eq(wl._waitlistOfferFromDetail({ data: { id: 1, event: {} } }, 5).available, false, 'offer: missing is_class_full → not claimable (never guess a billable action is possible)');
  eq(wl._waitlistOfferFromDetail(null, 5).available, false, 'offer: null body → not claimable');

  // Allocation diff: a place we held that is now a real seat was allocated by Psycle.
  const prevMem = { places: { '212203': 295302, '212210': 295347, '9': 1 }, allocated: { '500': '2026-08-01T00:00:00.000Z', '404': 'x' } };
  const nowBookings = {
    '212203': { bookingId: 8001, slots: [7], slotBookings: { 7: 8001 }, waitlisted: false },                       // was a place → now a seat  ⇒ allocated
    '212210': { bookingId: null, slots: [], slotBookings: {}, waitlisted: true, waitlist: { id: 295347 } },         // still a place
    '500':    { bookingId: 9, slots: [12], slotBookings: { 12: 9 }, waitlisted: false },                            // allocated earlier, still booked ⇒ kept
    // '9' vanished with no seat ⇒ simply left/expired, NOT allocated; '404' no longer booked ⇒ dropped
  };
  const diff = wl._diffWaitlistPlaces(prevMem, nowBookings, Date.UTC(2026, 7, 10, 12));
  eq(diff.newlyAllocated, ['212203'], 'diff: only place→seat transitions are announced');
  eq(diff.places, { '212210': 295347 }, 'diff: the new memory holds exactly the places still held');
  eq(Object.keys(diff.allocated).sort(), ['212203', '500'], 'diff: allocated set keeps still-booked earlier allocations and adds the new one');
  eq(wl._diffWaitlistPlaces(null, nowBookings, 0).newlyAllocated, [], 'diff: no memory (first run / after sign-out) → nothing announced');
  eq(wl._diffWaitlistPlaces({ places: 'garbage' }, {}, 0).places, {}, 'diff: malformed memory is tolerated');
  // A place merely ATTACHED to a seat the user booked themselves is never remembered,
  // so detaching it later (Leave / server drops it) cannot read as "Psycle allocated it".
  const seatWithPlace = { '77': { bookingId: 5, slots: [3], slotBookings: { 3: 5 }, waitlisted: false, waitlist: { id: 900 } } };
  const d1 = wl._diffWaitlistPlaces({ places: {}, allocated: {} }, seatWithPlace, 0);
  eq(d1.places, {}, 'diff: a place attached to a self-booked seat is not remembered as a held place');
  const d2 = wl._diffWaitlistPlaces({ places: d1.places, allocated: d1.allocated }, { '77': { bookingId: 5, slots: [3], slotBookings: { 3: 5 }, waitlisted: false } }, 0);
  eq(d2.newlyAllocated, [], 'diff: detaching that place later announces nothing (no false "You\'re in")');
  eq(wl._heldPlacesOf({ a: { waitlisted: true, waitlist: { id: 1 } }, b: { waitlisted: false, bookingId: 2, waitlist: { id: 3 } }, c: { waitlisted: true } }), { a: 1 }, 'heldPlacesOf: seatless places with an id only');
  // Already-announced allocations are not announced twice; a very recent mark
  // (e.g. the user's own claim seconds ago) survives a snapshot without the seat.
  const tNow = Date.UTC(2026, 7, 10, 12);
  const again = wl._diffWaitlistPlaces({ places: { '212203': 295302 }, allocated: { '212203': new Date(tNow - 5000).toISOString() } }, nowBookings, tNow);
  eq(again.newlyAllocated, [], 'diff: an allocation already recorded is not re-announced');
  const pre = wl._diffWaitlistPlaces({ places: {}, allocated: { '31': new Date(tNow - 30000).toISOString(), '32': new Date(tNow - 3600000).toISOString() } }, {}, tNow);
  eq(Object.keys(pre.allocated), ['31'], 'diff: a mark under 2 minutes old survives without a seat; an hour-old one without a seat is dropped');

  // Time resolution. In the bare vm context (no window) naive strings parse
  // device-locally; ON DEVICE the native bridge exports the Europe/London
  // resolver on window and _waitlistTimeMs must prefer it for naive gym
  // wall-clock strings while leaving Z/offset stamps alone. This suite runs
  // pinned to America/New_York, so London vs device-local visibly disagree.
  eq(wl._waitlistTimeMs('2026-08-08T21:51:55.000000Z'), Date.UTC(2026, 7, 8, 21, 51, 55), 'time: an ISO Z stamp (added_at) is absolute in any context');
  ok(Number.isNaN(wl._waitlistTimeMs(null)) && Number.isNaN(wl._waitlistTimeMs('')), 'time: null/empty → NaN');
  const wlDev = { window: { _psycleClassStartMs: classStartMs } };
  vm.createContext(wlDev);
  vm.runInContext(appSrc.slice(startMark, endMark), wlDev, { filename: 'app.js[waitlist:pure+bridge]' });
  eq(wlDev._waitlistTimeMs('2026-08-12 07:05:00'), utc(2026, 8, 12, 6, 5), 'time (device): a naive expires_at is LONDON wall-clock (BST → 06:05Z), not the device zone');
  eq(wlDev._waitlistTimeMs('2026-01-15 07:05:00'), utc(2026, 1, 15, 7, 5), 'time (device): winter naive stamp is GMT (07:05Z)');
  ok(wlDev._waitlistTimeMs('2026-08-12 07:05:00') !== wl._waitlistTimeMs('2026-08-12 07:05:00'),
    'time: with the bridge present the result differs from the device-local parse on a non-UK device — the branch is really exercised');
  eq(wlDev._waitlistTimeMs('2026-08-08T21:51:55.000000Z'), Date.UTC(2026, 7, 8, 21, 51, 55), 'time (device): Z stamps still bypass the London resolver');
  // Offer deadline right at the boundary: 06:00Z now, offer expires 07:05 London (= 06:05Z) → still pending; at 06:10Z → lapsed.
  const offerEntry = Object.assign({}, wlDev._normaliseWaitlistEntry(liveEntry), { expiresAt: '2026-08-12 07:05:00' });
  ok(wlDev._waitlistOfferPending(offerEntry, utc(2026, 8, 12, 6, 0)), 'offer (device): 5 min before the London deadline → pending');
  ok(!wlDev._waitlistOfferPending(offerEntry, utc(2026, 8, 12, 6, 10)), 'offer (device): 5 min after the London deadline → lapsed (a device-local parse in New York would wrongly say pending)');
  // Stale-place cutoff also honours London time on device: class at 07:30 London (06:30Z); 90 min later it is stale, 30 min later it is not.
  const m1 = {}; wlDev._mergeWaitlistsIntoBookings(m1, [wlDev._normaliseWaitlistEntry(liveEntry)], utc(2026, 8, 12, 8, 5));
  eq(Object.keys(m1), [], 'merge (device): 95 min after a London start the place is stale');
  const m2 = {}; wlDev._mergeWaitlistsIntoBookings(m2, [wlDev._normaliseWaitlistEntry(liveEntry)], utc(2026, 8, 12, 7, 0));
  eq(Object.keys(m2), ['212203'], 'merge (device): 30 min after a London start the place still shows');

  // ── Suites ───────────────────────────────────────────────────────────────
  // Every tests/suites/*.js exports `function (t) {}` (sync or async) and runs
  // here in filename order with the shared counters. One file per feature
  // area keeps this file from becoming the merge point for every change.
  const SUITES_DIR = path.join(__dirname, 'suites');
  if (fs.existsSync(SUITES_DIR)) {
    const t = { ok, eq, section, vm, fs, path, REPO_ROOT, JS_DIR, makeFakeLocalStorage, readSource, loadPure };
    for (const file of fs.readdirSync(SUITES_DIR).filter((f) => f.endsWith('.js')).sort()) {
      try {
        await require(path.join(SUITES_DIR, file))(t);
      } catch (e) {
        ok(false, 'suite ' + file + ' crashed: ' + (e && e.stack ? e.stack : e));
      }
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(50));
  if (failed === 0) {
    console.log('✅ ' + passed + ' passed, ' + failed + ' failed');
  } else {
    console.log('❌ ' + passed + ' passed, ' + failed + ' failed');
    console.log('\nFailures:');
    failures.forEach((f) => console.log('  - ' + f));
  }
  console.log('─'.repeat(50));

  process.exit(failed === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error('\nTest runner crashed:', e && e.stack ? e.stack : e);
  process.exit(1);
});
