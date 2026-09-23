'use strict';
// API-drift diagnostics are actually wired (js/api-client.js, js/diagnostic.js,
// js/app.js): response shapes reach the schema log from js/app.js _recordShape,
// which once recorded only the waitlist resources — so the safe-mode banner
// could not fire for bookings, events or the profile, and bug reports carried
// no shape data for them. The modules run here in a vm like tests/unit.js.
module.exports = async function (t) {
  const appSrc = t.readSource('js/app.js');
  const apiSrc = t.readSource('js/api-client.js');
  const diagSrc = t.readSource('js/diagnostic.js');
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  // api-client.js + diagnostic.js in a fresh window-like sandbox. Timers are
  // captured, not run: diagnostic.js arms a 10s contract capture and a 12s
  // fallback check, and the suite fires the check itself through bookings:loaded.
  function makeSandbox() {
    const handlers = {};
    const sandbox = {};
    sandbox.window = sandbox;
    sandbox.console = { log() {}, warn() {}, error: console.error };
    sandbox.localStorage = t.makeFakeLocalStorage();
    sandbox.document = { body: null, getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) };
    sandbox.navigator = { onLine: true };
    sandbox.setTimeout = () => 0;
    sandbox.clearTimeout = () => {};
    sandbox.URLSearchParams = URLSearchParams;
    sandbox.driftEvents = [];
    sandbox.PsycleEvents = {
      on: (e, fn) => { (handlers[e] = handlers[e] || []).push(fn); },
      emit: (e, arg) => { if (e === 'api:drift-detected') sandbox.driftEvents.push(arg); (handlers[e] || []).forEach((fn) => fn(arg)); },
    };
    t.vm.createContext(sandbox);
    t.vm.runInContext(apiSrc, sandbox, { filename: 'js/api-client.js' });
    t.vm.runInContext(diagSrc, sandbox, { filename: 'js/diagnostic.js' });
    return sandbox;
  }

  // ── Every PsycleDiag member the callers name exists ──────────────────────
  t.section('Diagnostics wiring: every PsycleDiag.<name> a caller uses is exported by js/diagnostic.js');
  let sb = makeSandbox();
  for (const [file, source] of [['js/app.js', appSrc], ['js/settings.js', t.readSource('js/settings.js')]]) {
    const names = Array.from(new Set((stripComments(source).match(/PsycleDiag\.([A-Za-z_]\w*)/g) || []).map((m) => m.split('.')[1])));
    t.ok(names.length > 0, file + ' references PsycleDiag (' + names.join(', ') + ')');
    names.forEach((name) => t.ok(typeof sb.PsycleDiag[name] === 'function', file + ': PsycleDiag.' + name + ' is a function on the real module'));
  }
  t.ok(!/noteSample\s*\(/.test(stripComments(apiSrc)), 'api-client.js no longer calls the noteSample that never existed');

  // ── A recorded sample keeps names, never values ──────────────────────────
  t.section('Diagnostics wiring: a recorded sample stores field names only');
  sb.PsycleDiag.record('booking', { id: 9001, event_id: 212203, slot: 7, customer_email: 'ada@example.com' });
  let shapes = sb.PsycleDiag.getDiagnostics().liveShapes;
  t.eq(shapes.booking && shapes.booking.fields, ['customer_email', 'event_id', 'id', 'slot'], 'the booking shape is in the schema log');
  t.ok(sb.localStorage.getItem('psycle_api_schema_log').indexOf('ada@example.com') === -1 && sb.localStorage.getItem('psycle_api_schema_log').indexOf('212203') === -1,
    'names only — no values reach storage');

  // ── app.js _recordShape ──────────────────────────────────────────────────
  t.section('Diagnostics wiring: app.js _recordShape (sliced from js/app.js)');
  const hFrom = appSrc.indexOf('const _shapeRecordedAt = {};');
  const hTo = appSrc.indexOf('let _lastWaitlistEntries = null;');
  t.ok(hFrom !== -1 && hTo > hFrom, '_recordShape can be sliced (anchors moved? update tests/suites/diag-wiring.js)');
  if (hFrom === -1 || hTo <= hFrom) return;
  sb = makeSandbox();
  sb.__now = 1000000;
  t.vm.runInContext('Date.now = function () { return __now; };', sb);
  t.vm.runInContext(appSrc.slice(hFrom, hTo), sb, { filename: 'js/app.js[_recordShape]' });
  const count = (kind) => { const s = sb.PsycleDiag.getDiagnostics().liveShapes[kind]; return s ? s.count : 0; };
  sb._recordShape('event', { id: 1, start_at: 'x' });
  t.eq([count('event'), sb.PsycleDiag.getDiagnostics().liveShapes.event.fields], [1, ['id', 'start_at']], 'a sample is recorded under its kind');
  for (let i = 0; i < 19; i++) sb._recordShape('event', { id: 2, start_at: 'y' });
  t.eq(count('event'), 1, 'a search reads /events once per studio: the 19 samples that follow within the minute cost no localStorage write');
  sb._recordShape('booking', { id: 1, event_id: 2 });
  t.eq(count('booking'), 1, 'the throttle is per kind');
  sb.__now += 61000;
  sb._recordShape('event', { id: 3, start_at: 'z', duration: 45 });
  t.eq([count('event'), sb.PsycleDiag.getDiagnostics().liveShapes.event.fields], [2, ['duration', 'id', 'start_at']], 'a minute later the next sample is taken (the log follows a shape that changes mid-session)');
  sb._recordShape('profile', null);
  t.eq(count('profile'), 0, 'no sample → nothing recorded');
  const diag = sb.PsycleDiag;
  sb.PsycleDiag = undefined;
  let threw = false;
  try { sb._recordShape('profile', { id: 7 }); } catch (e) { threw = true; }
  sb.PsycleDiag = diag;
  sb._recordShape('profile', { id: 7 });
  t.eq([threw, count('profile')], [false, 1], 'diagnostic.js not loaded yet: no throw, and the kind is not stamped — the next call records');
  sb.PsycleDiag = { record() { throw new Error('boom'); } };
  threw = false;
  try { sb._recordShape('waitlist', { id: 1 }); } catch (e) { threw = true; }
  t.eq(threw, false, 'a throwing recorder never breaks the caller');

  // ── A healthy load does not raise the banner ─────────────────────────────
  t.section('Diagnostics wiring: complete, live-shaped responses do not trip safe mode');
  const liveEvent = { id: 212203, start_at: '2026-08-12 07:30:00', duration: 45, studio_id: 160, instructor_id: 141, event_type_id: 2240, is_fully_booked: false, is_waitlistable: true, capacity_remaining: 4, is_live_stream: false };
  const liveBooking = { id: 9001, event_id: 212203, slot: 7 };
  const creditPackProfile = { id: 7, first_name: 'Ada', email: 'x', available_credits: [] }; // no subscriptions, no stats
  sb = makeSandbox();
  sb.PsycleDiag.record('profile', creditPackProfile);
  sb.PsycleDiag.record('booking', liveBooking);
  sb.PsycleDiag.record('event', liveEvent);
  sb.PsycleEvents.emit('bookings:loaded', {});
  let d = sb.PsycleDiag.getDiagnostics();
  t.eq([d.safeMode, sb.driftEvents.length, d.drift.filter((f) => f.missingRequired.length).map((f) => f.kind)], [false, 0, []],
    'profile (a member with no subscriptions / stats), booking and event rows: no banner, no drift event, nothing missing');
  t.ok(d.contract && ['profile', 'booking', 'event'].every((k) => d.contract.shapes[k]), 'the first healthy bookings:loaded captures all three kinds as the contract');
  t.eq(sb.PsycleAPI.SCHEMAS.profile.required, ['id'], 'SCHEMAS.profile: only id is required');
  t.ok(['subscriptions', 'stats'].every((f) => sb.PsycleAPI.SCHEMAS.profile.optional.indexOf(f) !== -1), 'SCHEMAS.profile: subscriptions and stats are tracked as optional (app.js reads both with fallbacks)');
  // Control — the same path DOES raise it when a field the app cannot do without goes.
  sb = makeSandbox();
  const broken = Object.assign({}, liveBooking); delete broken.event_id;
  sb.PsycleDiag.record('booking', broken);
  sb.PsycleEvents.emit('bookings:loaded', {});
  d = sb.PsycleDiag.getDiagnostics();
  t.eq([d.safeMode, sb.driftEvents.length, d.drift.map((f) => [f.kind, f.missingRequired])], [true, 1, [['booking', ['event_id']]]],
    'control: a booking row without event_id enters safe mode (the wiring has teeth)');

  // ── Call sites ───────────────────────────────────────────────────────────
  t.section('Diagnostics wiring: bookings, events and the profile are sampled where they are read');
  const between = (a, b) => { const s = appSrc.indexOf(a); return s === -1 ? '' : appSrc.slice(s, appSrc.indexOf(b, s)); };
  t.ok(/_recordShape\('booking', list\[0\]\)/.test(between('async function fetchMyBookings()', 'let _waitlistsUnavailable = false;')), "fetchMyBookings samples the first /bookings row as 'booking'");
  t.ok(/_recordShape\('event', batch\[0\]\)/.test(between('async function fetchEventsForLocation(', '\nlet _searchSeq')), "fetchEventsForLocation samples the first /events row as 'event'");
  const auth = between('async function _checkAuthOnce(', 'const PROFILE_REFRESH_MIN_GAP_MS');
  t.ok(/_recordShape\('profile', currentUser\)/.test(auth) && auth.indexOf("_recordShape('profile'") < auth.indexOf('fetchMyBookings();'),
    "checkAuth samples the applied profile as 'profile' — before the bookings fetch whose bookings:loaded runs the first drift check");
  t.ok(appSrc.indexOf('_recordWaitlistShape') === -1, 'the waitlist-only helper name is gone (renamed _recordShape, call sites included)');
  ['waitlist', 'waitlist-join', 'waitlist-offer'].forEach((kind) => t.ok(appSrc.indexOf("_recordShape('" + kind + "'") !== -1, "the '" + kind + "' sample is still taken"));
  const pureFrom = appSrc.indexOf('// ── waitlist:pure:start'), pureTo = appSrc.indexOf('// ── waitlist:pure:end');
  t.ok(appSrc.slice(pureFrom, pureTo).indexOf('_recordShape') === -1 && (hFrom < pureFrom || hFrom > pureTo), '_recordShape lives outside the DOM-free waitlist:pure block (it reads window)');
};
