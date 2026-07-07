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
 *     js/api-client.js (PsycleAPI: categorizeError, validate, field, parseJson, SCHEMAS)
 *     js/diagnostic.js (PsycleDiag: record, checkContract, captureContract)
 *
 * We deliberately do NOT load app.js / tabs.js / etc — those need a full DOM.
 * Only these three modules export pure-ish, testable logic that we can drive
 * with a thin shim.
 *
 * Exit code is 1 if any assertion fails, 0 otherwise.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO_ROOT = path.resolve(__dirname, '..');
const JS_DIR = path.join(REPO_ROOT, 'js');

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

  // ── validate ────────────────────────────────────────────────────────────
  section('PsycleAPI.validate (js/api-client.js)');
  const completeEvent = {
    id: 1,
    start_at: '2026-06-14T10:00:00Z',
    studio_id: 2,
    instructor_id: 3,
    event_type_id: 4,
    duration: 45,
    is_fully_booked: false,
  };
  const vOk = API.validate('event', completeEvent);
  ok(vOk.ok === true, "validate('event', complete) → ok:true");
  eq(vOk.missing, [], 'complete event has no missing fields');

  const missingStart = Object.assign({}, completeEvent);
  delete missingStart.start_at;
  const vBad = API.validate('event', missingStart);
  ok(vBad.ok === false, "validate('event', missing start_at) → ok:false");
  ok(vBad.missing.indexOf('start_at') !== -1, "missing list includes 'start_at'");

  // ── field ───────────────────────────────────────────────────────────────
  section('PsycleAPI.field (js/api-client.js)');
  const nested = { a: { b: { c: 42 } } };
  eq(API.field(nested, 'a.b.c', 'FB'), 42, 'field returns nested value when present');
  eq(API.field(nested, 'a.b.x', 'FB'), 'FB', 'field returns fallback when leaf absent (no throw)');
  eq(API.field(nested, 'a.z.c', 'FB'), 'FB', 'field returns fallback when middle absent (no throw)');
  eq(API.field(null, 'a.b', 'FB'), 'FB', 'field on null root returns fallback (no throw)');
  eq(API.field(nested, ['a', 'b', 'c'], 'FB'), 42, 'field accepts array path');

  // ── parseJson ────────────────────────────────────────────────────────────
  section('PsycleAPI.parseJson (js/api-client.js)');

  // Fake Response: HTML content-type (the corsproxy error-page case).
  function fakeResponse(body, contentType) {
    return {
      headers: {
        get(name) {
          return String(name).toLowerCase() === 'content-type' ? contentType : null;
        },
      },
      text() {
        return Promise.resolve(body);
      },
    };
  }

  let htmlSchemaErr = null;
  try {
    await API.parseJson(fakeResponse('<html><body>Proxy error</body></html>', 'text/html; charset=utf-8'));
  } catch (e) {
    htmlSchemaErr = e;
  }
  ok(htmlSchemaErr !== null, 'parseJson rejects an HTML-content-type response');
  ok(htmlSchemaErr && htmlSchemaErr.psycleError && htmlSchemaErr.psycleError.type === 'schema',
    "HTML response → categorized 'schema' error");

  // Sanity: valid JSON still parses.
  const parsed = await API.parseJson(fakeResponse('{"hello":"world"}', 'application/json'));
  eq(parsed, { hello: 'world' }, 'parseJson parses valid JSON');

  // HTML body even WITHOUT a content-type is still rejected as schema.
  let htmlNoCt = null;
  try {
    await API.parseJson(fakeResponse('<!DOCTYPE html><html></html>', ''));
  } catch (e) {
    htmlNoCt = e;
  }
  ok(htmlNoCt && htmlNoCt.psycleError && htmlNoCt.psycleError.type === 'schema',
    'HTML body without content-type → schema error');

  // ── PsycleDiag.record + checkContract ────────────────────────────────────
  section('PsycleDiag.record + checkContract (js/diagnostic.js)');
  ok(typeof Diag === 'object' && Diag, 'window.PsycleDiag exists');

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
