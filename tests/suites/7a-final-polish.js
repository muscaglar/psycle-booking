'use strict';
// Wave 7 leftovers, each seen in a real browser by an earlier wave's verifier:
//   • the silent history top-up that gave up without a trace (js/explore.js),
//   • a booking painted from saved details whose studio is not known yet —
//     "Change spot" and the class sheet's booked button (js/app.js),
//   • Escape on the inline date picker (js/app.js),
//   • the next-class pill: the previous member's text after a sign-out, and the
//     room the panels keep for it (js/settings.js + css/settings.css),
//   • the usual-week card's two-line label (css/styles.css + js/tabs.js).
// The REAL functions, sliced out of source and run against small fakes.
// (The retry / sign-out work has its own suite: retry-signout.js; the in-dialog
// live region is in a11y.js.)
module.exports = async function (t) {
  const { ok, eq } = t;
  const appSrc = t.readSource('js/app.js');
  const exploreSrc = t.readSource('js/explore.js');
  const settingsSrc = t.readSource('js/settings.js');
  const grab = (src, opener, closer) => {
    const lines = src.split('\n');
    const from = lines.findIndex((l) => l.startsWith(opener));
    if (from === -1) throw new Error('7a suite: cannot find "' + opener + '" (anchor moved?)');
    const to = lines.findIndex((l, i) => i > from && l === closer);
    if (to === -1) throw new Error('7a suite: unterminated "' + opener + '"');
    return lines.slice(from, to + 1).join('\n');
  };
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

  // ── History top-up ───────────────────────────────────────────────────────
  const DAY = 86400000;
  const WEEK = 7 * DAY;
  const NOW = Date.UTC(2026, 8, 21, 9, 30);
  const iso = (ms) => new Date(ms).toISOString();

  t.section('History top-up: may it start? (pure:history-topup)');
  {
    const p = t.loadPure('js/explore.js', 'history-topup');
    const may = (sync, tried, tooBig) => p._topUpMayStart(NOW, sync, tried, tooBig, WEEK, DAY);
    eq([may(NaN, NaN, NaN), may(NOW - 3 * DAY, NaN, NaN)], [false, false], 'never synced, or synced this week → no (unchanged)');
    eq(may(NOW - 8 * DAY, NaN, NaN), true, 'a week stale, never tried → yes (unchanged)');
    eq([may(NOW - 8 * DAY, NOW - 5 * 3600000, NaN), may(NOW - 8 * DAY, NOW - 2 * DAY, NaN)], [false, true], 'tried five hours ago → not again today; two days ago → yes (unchanged)');
    eq(may(NOW - 30 * DAY, NOW - 2 * DAY, NOW - 2 * DAY), false,
      'gave up as "too many" two days ago → NOT again: the sync stamp never moves on that path, so it used to page the whole history every day, to give up every day');
    eq(may(NOW - 30 * DAY, NOW - 6 * DAY, NOW - 6 * DAY - 23 * 3600000), false, '…still inside the week on day six');
    eq(may(NOW - 30 * DAY, NOW - 8 * DAY, NOW - 8 * DAY), true, '…and once a week has passed it may look again (the weekly cadence everything else has)');
    eq(may(NOW - 30 * DAY, NaN, NaN), true, 'an unreadable / absent note changes nothing');
  }

  // The real sync + scheduler, as tests/suites/history-sync.js runs them.
  function topUpWorld(o) {
    o = o || {};
    const lines = exploreSrc.split('\n');
    const from = lines.findIndex((l) => l.startsWith('  var TOPUP_MAX_NEW'));
    const to = lines.findIndex((l, i) => i > from && l.startsWith('  // ═══'));
    if (from === -1 || to === -1) throw new Error('7a suite: cannot slice the history sync (anchor moved?)');
    const clock = { now: NOW };
    class FixedDate extends Date {
      constructor(...a) { if (a.length) super(...a); else super(clock.now); }
      static now() { return clock.now; }
    }
    const log = { gets: [], toasts: [], dirty: 0, timers: [], events: [] };
    const store = t.makeFakeLocalStorage();
    if (o.synced !== undefined) store.setItem('psycle_history_synced', o.synced);
    if (o.tried !== undefined) store.setItem('psycle_history_topup_at', o.tried);
    if (o.skipped !== undefined) store.setItem('psycle_history_topup_skipped', o.skipped);
    const ctx = t.vm.createContext({
      console: { log() {}, warn() {}, error() {} }, JSON, Math, Set, Map, Object, Array, String, Number, Promise, isNaN,
      Date: FixedDate, localStorage: store, navigator: { onLine: true },
      document: { getElementById: () => null },
      setTimeout: (fn, ms) => { log.timers.push({ fn, ms }); return log.timers.length; },
      toast: (msg, kind) => log.toasts.push([msg, kind]),
      renderInsights: () => {}, markDirtyAndMaybeRender: () => { log.dirty++; },
      getBearerToken: () => 'tok',
      PsycleEvents: { emit: (e) => log.events.push(e), on: () => {} },
      _eventCache: {},
    });
    ctx.window = ctx;
    ctx._historyIsMine = () => true;
    ctx.apiFetch = async (path) => {
      log.gets.push(path);
      if (path.indexOf('/bookings?type=previous') === 0) {
        return { ok: true, status: 200, json: async () => ({ data: Array.from({ length: o.previous || 0 }, (_, i) => ({ id: 5000 + i, event_id: 100 + i, slot: 7 })), meta: { last_page: 1, current_page: 1 } }) };
      }
      const m = /^\/events\/(\d+)$/.exec(path);
      if (m && (o.failEvents || []).indexOf(Number(m[1])) !== -1) return { ok: false, status: 404, json: async () => ({}) };
      if (m) return { ok: true, status: 200, json: async () => ({ data: { id: Number(m[1]), start_at: '2026-09-15 07:00:00' }, relations: {} }) };
      return { ok: false, status: 404, json: async () => ({}) };
    };
    t.vm.runInContext([
      "var HISTORY_KEY = 'psycle_class_history'; var SYNC_KEY = 'psycle_history_synced'; var _syncing = false; var _syncLabel = '';",
      "function getHistory() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) { return []; } }",
      // The sync paints the banner itself (paintBanner); what it draws is render-perf.js's subject.
      'function renderSyncBanner() {}',
      // Its progress labels and result toasts count with app.js's _plural (pure:copy) — the real one.
      appSrc.slice(appSrc.indexOf('// ── pure:copy:start'), appSrc.indexOf('// ── pure:copy:end')),
      lines.slice(from, to).join('\n'),
    ].join('\n'), ctx);
    const note = () => JSON.parse(store.getItem('psycle_history_topup_skipped') || 'null');
    return { ctx, log, store, clock, note };
  }

  t.section('History top-up: "too many to fetch quietly" is recorded, and handed to the member');
  {
    let w = topUpWorld({ synced: iso(NOW - 8 * DAY), previous: 61 });
    await w.ctx._explore_syncHistory({ silent: true });
    eq([w.log.gets.length, w.note()], [1, { at: iso(NOW), count: 61 }], '61 unknown classes: still no detail requests — but the give-up is written down, with how many');
    eq([w.log.dirty, w.log.toasts, w.store.getItem('psycle_history_synced')], [1, [], iso(NOW - 8 * DAY)],
      'the sync banner is repainted (it now offers Re-sync); nothing is toasted and the history is NOT marked synced');
    eq(w.ctx._topUpTooBig(), { at: NOW, count: 61 }, '_topUpTooBig reads it back');

    // The next launches: the day after (TOPUP_AT_KEY alone would allow it), and a week on.
    w = topUpWorld({ synced: iso(NOW - 30 * DAY), tried: iso(NOW - 2 * DAY), skipped: JSON.stringify({ at: iso(NOW - 2 * DAY), count: 61 }) });
    w.ctx.maybeTopUpHistory();
    eq(w.log.timers.length, 0, 'two days later: no top-up is scheduled (it used to re-page /bookings?type=previous — every page of it — and give up again)');
    w = topUpWorld({ synced: iso(NOW - 30 * DAY), tried: iso(NOW - 8 * DAY), skipped: JSON.stringify({ at: iso(NOW - 8 * DAY), count: 61 }) });
    w.ctx.maybeTopUpHistory();
    eq(w.log.timers.map((x) => x.ms), [8000], 'a week later it may look again');

    // The member's own Re-sync imports them all, and the offer goes away.
    w = topUpWorld({ synced: iso(NOW - 8 * DAY), previous: 61, skipped: JSON.stringify({ at: iso(NOW - DAY), count: 61 }) });
    await w.ctx._explore_syncHistory();
    eq([w.note(), w.store.getItem('psycle_history_synced'), JSON.parse(w.store.getItem('psycle_class_history')).length], [null, iso(NOW), 61],
      'a completed manual sync clears the note (and stamps the sync, so the weekly throttle is back in charge)');
    w = topUpWorld({ synced: iso(NOW - 8 * DAY), previous: 0, skipped: JSON.stringify({ at: iso(NOW - DAY), count: 61 }) });
    await w.ctx._explore_syncHistory();
    eq(w.note(), null, '…as does Psycle answering "no past bookings at all"');
    // A Re-sync that ends PARTIAL (one class Psycle would not give up): 60 of the
    // 61 are in, and the banner kept saying "61 past classes are not in it yet".
    w = topUpWorld({ synced: iso(NOW - 8 * DAY), previous: 61, failEvents: [130], skipped: JSON.stringify({ at: iso(NOW - DAY), count: 61 }) });
    await w.ctx._explore_syncHistory();
    eq([w.note(), w.ctx._topUpTooBig().count, JSON.parse(w.store.getItem('psycle_class_history')).length], [null, 0, 60],
      'a manual sync that could not fetch one class still clears the note: every class it counted was tried, so "61" is stale however it ended');
    eq([w.store.getItem('psycle_history_synced'), /^Synced 60 bookings\. 1 couldn't be fetched/.test((w.log.toasts[0] || [])[0] || '')], [iso(NOW - 8 * DAY), true],
      '…while the sync stamp does NOT move (the rest stays retryable) and the toast says what happened');
    // The quiet top-up's own bail is untouched by that: it never gets as far.
    w = topUpWorld({ synced: iso(NOW - 8 * DAY), previous: 61, skipped: JSON.stringify({ at: iso(NOW - 8 * DAY), count: 70 }) });
    await w.ctx._explore_syncHistory({ silent: true });
    eq(w.note(), { at: iso(NOW), count: 61 }, 'a silent top-up that bails again re-notes the TRUE count (it is not cleared on the way out)');

    // Storage is not trusted: the count goes into markup.
    const bad = (raw) => { const x = topUpWorld({ skipped: raw }); return x.ctx._topUpTooBig().count; };
    eq([bad('{not json'), bad('"61"'), bad(JSON.stringify({ at: iso(NOW), count: '<img src=x>' })), bad(JSON.stringify({ at: 'soon', count: 61 })), bad(JSON.stringify({ at: iso(NOW), count: -4 })), bad(JSON.stringify({ at: iso(NOW), count: 61.9 }))],
      [0, 0, 0, 0, 0, 61], 'a note that is not {at: a date, count: a positive number} offers nothing; the count is always a whole number');
    const banner = exploreSrc.slice(exploreSrc.indexOf('  function renderSyncBanner('), exploreSrc.indexOf('  window._explore_openSettingsForInstructor = function'));
    ok(/var missing = _topUpTooBig\(\)\.count;/.test(banner) && /\(missing \? '<br><span>' \+ missing \+ ' past classes are not in it yet\. Tap Re-sync to import them\.<\/span>' : ''\)/.test(banner),
      'the synced banner says how many are missing, next to its existing Re-sync button (no new control, no API text in the line)');
  }

  // ── A held class whose studio is not known yet ───────────────────────────
  const studioFns = grab(appSrc, 'function _studioNeedsReread(', '}') + '\n' + grab(appSrc, 'function _ensureStudioKnown(', '}');
  const FRESH = { id: 77, start_at: '2099-01-01 10:00:00', studio_id: 4, _typeName: 'Ride' };
  // `hydrate(ctx)`: what GET /events/77 does to app state — or nothing (Psycle didn't answer).
  function studioWorld(o) {
    const log = { hydrates: [], timers: [], toasts: [], bookClass: [], unbook: 0, pickers: [], gets: [] };
    const globals = Object.assign({
      _myBookings: { 77: { bookingId: 'A', bookingIds: ['A'], slots: [5], slotBookings: { 5: 'A' }, waitlisted: false } },
      _eventCache: { 77: { id: 77, start_at: '2099-01-01 10:00:00', studio_id: 4, _fromSnapshot: true, _snapshotSeenAt: 1 } },
      _studioMap: {},
      window: {}, console: { log() {}, warn() {}, error() {} }, Promise,
      setTimeout: (fn, ms) => { log.timers.push({ fn, ms }); return log.timers.length; }, clearTimeout: () => {},
      getBearerToken: () => 'tok',
      toast: (msg, type) => log.toasts.push({ msg, type }),
      document: { querySelector: () => null, createElement: () => ({}), getElementById: () => ({ textContent: '' }) },
    }, o.globals || {});
    const ctx = t.loadPure('js/app.js', 'booking', globals);
    ctx._hydrateEventDetails = (ids) => {
      log.hydrates.push(ids);
      if (o.hang) return new Promise(() => {});
      return Promise.resolve().then(() => { if (o.hydrate) o.hydrate(ctx); });
    };
    t.vm.runInContext('var BOOKING_VERIFY_DEADLINE_MS = 10000; var _studioRereads = {}; var _sheetActionBusy = {};\n' + studioFns, ctx);
    return { ctx, log };
  }
  const lands = (studioId, studio) => (ctx) => {
    ctx._eventCache[77] = Object.assign({}, FRESH, { studio_id: studioId });
    ctx._studioMap[studioId] = studio;
  };

  t.section('Saved details: does this class need re-reading before its studio is used?');
  {
    const w = studioWorld({});
    eq(w.ctx._studioNeedsReread(77), true, 'painted from last launch\'s saved details → yes (its studio id may be out of date, and _studioMap has not heard of it)');
    w.ctx._eventCache[77] = Object.assign({}, FRESH);
    eq(w.ctx._studioNeedsReread(77), true, 'a real record whose studio nobody has told _studioMap about (a waitlist place that became a seat) → yes');
    w.ctx._studioMap[4] = { has_layout: true };
    eq(w.ctx._studioNeedsReread(77), false, 'a real record with a known studio → no: nothing is fetched, nothing waits');
    w.ctx._studioMap[4] = { has_layout: false };
    eq(w.ctx._studioNeedsReread(77), false, '…a no-layout studio is "known" too');
    eq(w.ctx._studioNeedsReread(99), false, 'a class the cache has never seen: the callers\' own guards deal with that');
    eq(await w.ctx._ensureStudioKnown(77), true, 'nothing to wait for → true at once');
    eq([w.log.hydrates, w.log.timers], [[], []], '…with no request and no timer');
  }

  t.section('Saved details: one bounded re-read of THAT class');
  {
    let w = studioWorld({ hydrate: lands(4, { has_layout: true }) });
    const both = await Promise.all([w.ctx._ensureStudioKnown(77), w.ctx._ensureStudioKnown('77')]);
    eq([both, w.log.hydrates], [[true, true], [['77']]], 'two taps while it loads share ONE GET /events/77, and both carry on once it lands');
    eq(w.log.timers.map((x) => x.ms), [10000], 'under the same 10s deadline a booking tap waits for /bookings');
    eq(await w.ctx._ensureStudioKnown(77), true, 'afterwards the class needs nothing more (and the in-flight note is gone: a later need starts a new read)');

    w = studioWorld({});
    eq(await w.ctx._ensureStudioKnown(77), false, 'Psycle did not answer (the record is still the saved one) → false: the caller stops rather than act on unconfirmed details');

    w = studioWorld({ hang: true });
    let answer = 'pending';
    w.ctx._ensureStudioKnown(77).then((v) => { answer = v; });
    await settle();
    eq(answer, 'pending', 'a request that hangs: still waiting…');
    w.log.timers[0].fn();
    await settle();
    eq(answer, false, '…until the deadline, then false — never for ever');

    w = studioWorld({ hang: true });
    answer = 'pending';
    w.ctx._ensureStudioKnown(77).then((v) => { answer = v; });
    lands(4, { has_layout: true })(w.ctx); // fetchMyBookings' own background re-read got there first
    w.log.timers[0].fn();
    await settle();
    eq(answer, true, 'the background re-read landing meanwhile counts: whoever replaced the record, it is a real one now');

    w = studioWorld({ hydrate: (ctx) => { ctx._eventCache[77] = Object.assign({}, FRESH); } }); // answered, but without the studio in `relations`
    eq(await w.ctx._ensureStudioKnown(77), true, 'a real answer that still names no studio record → carry on as before (the old routing), not a dead button');
  }

  t.section('Class sheet: the booked button of a saved-details seat');
  {
    const sheetSrc = grab(appSrc, 'async function _classDetailBookAction(', '}');
    const sheetWorld = (o) => {
      const w = studioWorld(o);
      w.ctx.bookClass = async (id, btn, studioId) => { w.log.bookClass.push(studioId); };
      w.ctx.confirmUnbook = () => { w.log.unbook++; };
      t.vm.runInContext(sheetSrc, w.ctx);
      return w;
    };
    let w = sheetWorld({ hydrate: lands(4, { has_layout: true }) });
    await w.ctx._classDetailBookAction(77);
    eq([w.log.bookClass, w.log.unbook], [[4], 0], 'a seat at a layout studio opens the PICKER once the class is re-read (studio unknown, it used to open the cancel dialog)');
    eq(w.log.toasts[0], { msg: 'Loading class…', type: 'info' }, '…after a plain "Loading class…" — not an error');
    ok(w.log.toasts.every((x) => x.type !== 'error'), '…and no error toast anywhere on the way');

    w = sheetWorld({ globals: { _studioMap: { 9: { has_layout: true, name: 'The old room' } }, _eventCache: { 77: { id: 77, start_at: '2099-01-01 10:00:00', studio_id: 9, _fromSnapshot: true } } }, hydrate: lands(4, { has_layout: true }) });
    await w.ctx._classDetailBookAction(77);
    eq(w.log.bookClass, [4], 'the class moved rooms since the details were saved: the picker is asked for the studio Psycle names NOW, never the saved one');

    w = sheetWorld({ hydrate: lands(4, { has_layout: false }) });
    await w.ctx._classDetailBookAction(77);
    eq([w.log.bookClass, w.log.unbook], [[], 1], 'a no-layout studio, once known, still goes to the cancel dialog (unchanged)');

    w = sheetWorld({});
    await w.ctx._classDetailBookAction(77);
    eq([w.log.bookClass, w.log.unbook, w.log.toasts.map((x) => x.msg)], [[], 0, ['Loading class…', "Couldn't load this class. Try again in a moment."]],
      'Psycle cannot be reached: said plainly, and NEITHER dialog opens off details nobody confirmed');

    w = sheetWorld({ globals: { getBearerToken: () => '' } });
    await w.ctx._classDetailBookAction(77);
    eq(w.log.hydrates, [], 'signed out / session ended: no waiting, the existing routing answers');
    w = sheetWorld({ globals: { _myBookings: { 77: { bookingId: null, slots: [], slotBookings: {}, waitlisted: true, waitlist: { id: 1 } } } } });
    await w.ctx._classDetailBookAction(77);
    eq([w.log.hydrates, w.log.bookClass.length], [[], 1], 'a waitlist place needs no studio: straight on, as before');
    w = sheetWorld({ globals: { _myBookings: {} } });
    await w.ctx._classDetailBookAction(77);
    eq(w.log.hydrates, [], 'a class that is not held: bookClass reads the class itself, as before');
  }

  t.section('Change spot: a saved-details seat');
  {
    const swapSrc = grab(appSrc, 'function _clock24(', '}') + '\n' + grab(appSrc, 'function _cancelDeadline(', '}') + '\n' + grab(appSrc, 'window.changeSpot = async function(eventId) {', '};'); // _clock24: the deadline's label
    const swapWorld = (o) => {
      const w = studioWorld(o);
      w.ctx.apiFetch = async (path) => { w.log.gets.push(path); return { ok: true, status: 200, json: async () => ({ slots: [9, 11], data: {} }) }; };
      w.ctx.showBikePicker = (id, btn, layout, avail, mine, name) => { w.log.pickers.push({ seats: layout.slots.length, name }); };
      w.ctx.slotLabelForEvent = () => 'Bike';
      w.ctx.renderChangeSpotHint = () => {};
      w.ctx.fetchMyBookings = () => Promise.resolve(false);
      t.vm.runInContext(grab(appSrc, 'async function _rereadBookingsForVerify(', '}') + '\n' + swapSrc, w.ctx);
      return w;
    };
    const room = (n, name) => ({ has_layout: true, name, layout: { slots: Array.from({ length: n }, (_, i) => ({ id: i + 1 })) } });

    let w = swapWorld({ hydrate: (ctx) => { lands(4, room(30, 'Studio 1'))(ctx); ctx._eventCache[77]._studioName = 'Studio 1'; } });
    await w.ctx.window.changeSpot(77);
    eq([w.log.pickers, w.log.toasts.filter((x) => x.type === 'error')], [[{ seats: 30, name: ' · Studio 1' }], []],
      'the studio arrives with the re-read and the picker opens on ITS map — it used to answer "No layout available for this studio"');
    eq(w.log.toasts[0].msg, 'Loading class…', '…"Loading class…" first');

    w = swapWorld({ globals: { _studioMap: { 9: room(12, 'The old room') }, _eventCache: { 77: { id: 77, start_at: '2099-01-01 10:00:00', studio_id: 9, _fromSnapshot: true } } }, hydrate: lands(4, room(30, 'Studio 1')) });
    await w.ctx.window.changeSpot(77);
    eq(w.log.pickers.map((x) => x.seats), [30], 'never the saved studio\'s map: a class that moved rooms gets the room it is in now');

    w = swapWorld({});
    await w.ctx.window.changeSpot(77);
    eq([w.log.pickers, w.log.gets, w.log.toasts.map((x) => x.msg)], [[], [], ['Loading class…', "Couldn't load this class. Nothing was changed. Try again in a moment."]],
      'the re-read fails: nothing is opened, nothing else is requested, and the member is told nothing changed');

    w = swapWorld({ globals: { _studioMap: { 4: room(30, 'Studio 1') }, _eventCache: { 77: Object.assign({}, FRESH) } } });
    await w.ctx.window.changeSpot(77);
    eq([w.log.hydrates, w.log.pickers.length, w.log.toasts[0].msg], [[], 1, 'Loading available spots…'], 'an ordinary booking (real details, known studio) is not slowed down at all');
  }

  // ── …and the tap that came AFTER it ──────────────────────────────────────
  t.section('Latest tap wins: a class tapped while a saved-details seat re-reads is not overtaken by it');
  {
    // The sheet's wait runs BEFORE bookClass takes its sequence number. Book on
    // class B meanwhile (seq 1, GET out) — then A's re-read lands, bookClass(A)
    // takes seq 2, and B, the LATEST tap, was put back silently for A's picker.
    const takenSrc = grab(appSrc, 'function _pickerTakenSince(', '}');
    const sheetSrc = grab(appSrc, 'async function _classDetailBookAction(', '}');
    const modal = { style: { display: 'none' } };
    const doc = { querySelector: () => null, createElement: () => ({}), getElementById: (id) => (id === 'bikeModal' ? modal : { textContent: '' }) };
    const sheetWorld = () => {
      const w = studioWorld({ hang: true, globals: { document: doc } });
      w.ctx.bookClass = async (id, btn, studioId) => { w.log.bookClass.push(id); };
      w.ctx.confirmUnbook = () => { w.log.unbook++; };
      t.vm.runInContext(takenSrc + '\n' + sheetSrc, w.ctx);
      // A's re-read lands (fetchMyBookings' background read replaced the record; the deadline asks).
      w.land = async (p) => { lands(4, { has_layout: true })(w.ctx); w.log.timers[0].fn(); await p; };
      return w;
    };
    modal.style.display = 'none';
    let w = sheetWorld();
    let pa = w.ctx._classDetailBookAction(77);
    await settle();
    w.ctx.bookClass._seq = 1; // Book tapped on class B: bookClass took a number
    await w.land(pa);
    eq([w.log.bookClass, w.log.unbook, w.log.toasts.map((x) => x.msg)], [[], 0, ['Loading class…']],
      'B was tapped while A loaded: A stands down quietly — no picker, no dialog, no error (it used to take the higher number and put B back)');
    w = sheetWorld();
    pa = w.ctx._classDetailBookAction(77);
    await settle();
    modal.style.display = 'flex'; // a picker somebody else opened meanwhile (B's GET was quick; or Change spot)
    await w.land(pa);
    eq(w.log.bookClass, [], 'a picker already up when the re-read lands is not replaced either');
    modal.style.display = 'none';
    w = sheetWorld();
    pa = w.ctx._classDetailBookAction(77);
    await settle();
    await w.land(pa);
    eq(w.log.bookClass, [77], 'nothing tapped meanwhile: the picker opens as before');
    w = sheetWorld();
    w.ctx.bookClass._seq = 5; // earlier taps, long settled
    pa = w.ctx._classDetailBookAction(77);
    await settle();
    await w.land(pa);
    eq(w.log.bookClass, [77], '…whatever the counter stood at when the sheet was tapped: only a tap SINCE counts');

    // Change spot never goes through bookClass; its picker replaces _bookingContext
    // and re-wires Confirm to a swap, and its wait is now up to 10s longer.
    const swapSrc = grab(appSrc, 'function _clock24(', '}') + '\n' + grab(appSrc, 'function _cancelDeadline(', '}') + '\n' + grab(appSrc, 'window.changeSpot = async function(eventId) {', '};'); // _clock24: the deadline's label
    const room = { has_layout: true, name: 'Studio 1', layout: { slots: [{ id: 5 }, { id: 9 }, { id: 11 }] } };
    const swapWorld = () => {
      const x = studioWorld({ hang: true, globals: { document: doc } });
      x.ctx.bookClass = function () {};
      x.ctx.apiFetch = async (path) => { x.log.gets.push(path); return { ok: true, status: 200, json: async () => ({ slots: [9, 11], data: {} }) }; };
      x.ctx.showBikePicker = () => { x.log.pickers.push(1); };
      x.ctx.slotLabelForEvent = () => 'Bike';
      x.ctx.renderChangeSpotHint = () => {};
      x.ctx.fetchMyBookings = () => Promise.resolve(false);
      t.vm.runInContext(takenSrc + '\n' + grab(appSrc, 'async function _rereadBookingsForVerify(', '}') + '\n' + swapSrc, x.ctx);
      x.land = async (p) => { lands(4, room)(x.ctx); x.log.timers[0].fn(); await p; };
      return x;
    };
    modal.style.display = 'none';
    let x = swapWorld();
    let ps = x.ctx.window.changeSpot(77);
    await settle();
    x.ctx.bookClass._seq = 1;
    await x.land(ps);
    eq([x.log.pickers, x.ctx.window._changeSpotContext == null, x.log.toasts.filter((y) => y.type === 'error')], [[], true, []],
      'Change spot, with another class tapped while it loaded: no picker, no swap context, nothing said');
    x = swapWorld();
    ps = x.ctx.window.changeSpot(77);
    await settle();
    await x.land(ps);
    eq([x.log.pickers.length, x.ctx.window._changeSpotContext && x.ctx.window._changeSpotContext.slotToChange], [1, 5], 'on its own it opens its picker as before');
    ok(/if \(typeof _pickerTakenSince === 'function' && _pickerTakenSince\(seqAtTap\)\) return;/.test(sheetSrc) && /if \(typeof _pickerTakenSince === 'function' && _pickerTakenSince\(seqAtTap\)\) return;/.test(swapSrc),
      'both ask it typeof-guarded (the other suites run these two functions on their own)');
  }

  // ── Inline date picker: Escape ───────────────────────────────────────────
  t.section('Date picker: Escape closes it and hands focus back to its button');
  {
    const pickerSrc = grab(appSrc, 'function _wireDatePickerKeys(', '}') + '\n' + grab(appSrc, 'function toggleDatePicker(', '}');
    const world = () => {
      const log = { listeners: [], focus: 0, renders: 0 };
      const day = { name: 'a day cell' };
      const el = { style: { display: 'none' }, contains: (n) => n === day };
      const btn = { attrs: { 'aria-expanded': 'false' }, classList: { add() {} }, focus: () => { log.focus++; doc.activeElement = btn; } };
      const doc = {
        body: { name: 'body' }, activeElement: null,
        getElementById: (id) => (id === 'datePicker' ? el : id === 'pickDateBtn' ? btn : null),
        addEventListener: (type, fn) => { log.listeners.push({ type, fn }); },
      };
      const expanded = () => { btn.attrs['aria-expanded'] = String(el.style.display !== 'none'); };
      const ctx = t.vm.createContext({
        document: doc, Date, _ownKeysOverlayUp: () => w.overlay,
        renderCalendar: () => { log.renders++; }, _mirrorDatePillAria: expanded, _syncDatePills: expanded,
      });
      t.vm.runInContext('var _calMonth = null; var _datePickerKeysWired = false;\n' + pickerSrc, ctx);
      const w = { ctx, log, el, btn, doc, day, overlay: false };
      w.key = (key, prevented) => {
        const e = { key, defaultPrevented: !!prevented, preventDefault() { this.defaultPrevented = true; this.byUs = true; } };
        log.listeners.forEach((l) => l.fn(e));
        return !!e.byUs;
      };
      return w;
    };

    let w = world();
    w.ctx.toggleDatePicker();
    w.ctx.toggleDatePicker();
    w.ctx.toggleDatePicker();
    eq([w.log.listeners.map((l) => l.type), w.el.style.display, w.btn.attrs['aria-expanded']], [['keydown'], '', 'true'], 'opened (again): ONE keydown listener however often it is toggled');
    w.doc.activeElement = w.day;
    eq([w.key('Escape'), w.el.style.display, w.btn.attrs['aria-expanded'], w.log.focus, w.doc.activeElement === w.btn], [true, 'none', 'false', 1, true],
      'Escape on a day: closed, aria-expanded back to false, focus on #pickDateBtn — and the key is consumed');
    eq([w.key('Escape'), w.log.focus], [false, 1], 'Escape while it is closed is not ours: left for whoever wants it');

    w = world();
    w.ctx.toggleDatePicker();
    w.doc.activeElement = w.btn;
    eq([w.key('Escape'), w.el.style.display], [true, 'none'], 'focus still on the button (a keyboard open) → closes');
    w.ctx.toggleDatePicker();
    w.doc.activeElement = w.doc.body; // a month arrow was rebuilt under the press / Safari never focused the clicked button
    eq([w.key('Escape'), w.el.style.display], [true, 'none'], 'focus nowhere (<body>) → closes');
    w.ctx.toggleDatePicker();
    w.doc.activeElement = { name: 'the instructor search box' };
    eq([w.key('Escape'), w.el.style.display], [false, ''], 'focus in another control: its Escape is not taken');
    w.doc.activeElement = w.day;
    eq([w.key('Escape', true), w.el.style.display], [false, ''], 'a sheet on top already claimed the key (defaultPrevented) → the calendar stays');
    w.overlay = true;
    eq([w.key('Escape'), w.el.style.display], [false, ''], 'a confirm / the tour / the usual-week sheet is up → theirs');
    w.overlay = false;
    eq([w.key('Enter'), w.key('Tab'), w.el.style.display], [false, false, ''], 'other keys are left alone');
    const overlayKeys = appSrc.slice(appSrc.indexOf('// THE document keydown for overlays'), appSrc.indexOf('// The other half of Space'));
    ok(overlayKeys.indexOf('datePicker') === -1 && appSrc.indexOf("['datePicker'") === -1, 'the calendar is NOT a layer in the overlay stack / its Escape handler (it is a disclosure, not a modal)');
  }

  // ── The floating next-class pill ─────────────────────────────────────────
  t.section('Next-class pill: hidden means gone — no text, no room kept for it');
  {
    const inner = (opener) => {
      const lines = settingsSrc.split('\n');
      const from = lines.findIndex((l) => l.startsWith(opener));
      const to = lines.findIndex((l, i) => i > from && l === '  }');
      if (from === -1 || to === -1) throw new Error('7a suite: cannot slice "' + opener + '"');
      return lines.slice(from, to + 1).join('\n');
    };
    const bodyClasses = new Set();
    const pill = {
      attrs: {}, textContent: 'Ride 45 — Alex', hiddenClass: true, blurred: 0,
      setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, blur() { this.blurred++; },
      classList: { contains: (c) => c === 'hidden' && pill.hiddenClass },
    };
    const ctx = t.vm.createContext({
      _pillEl: pill,
      document: { activeElement: null, body: { classList: { toggle: (c, on) => { if (on) bodyClasses.add(c); else bodyClasses.delete(c); } } } },
    });
    t.vm.runInContext(inner('  function _pillA11y('), ctx);
    ctx._pillA11y('Next class in 2h 0m: Ride 45');
    eq([[...bodyClasses], pill.attrs['aria-hidden'], pill.attrs.role], [['has-next-pill'], undefined, 'button'], 'showing: <body> carries has-next-pill, the pill is a button');
    ctx._pillA11y(null);
    eq([[...bodyClasses], pill.attrs['aria-hidden'], pill.attrs.role, pill.attrs['aria-label']], [[], 'true', undefined, undefined],
      'hidden: the class is gone (no room reserved), aria-hidden, no role and no label');

    // The auth:changed listener, as registered.
    const from = settingsSrc.indexOf("    PsycleEvents.on('auth:changed', function () {");
    const to = settingsSrc.indexOf('\n    });', from);
    ok(from !== -1 && to > from, 'the pill\'s auth:changed listener can be sliced');
    let handler = null;
    let updates = 0;
    const lctx = t.vm.createContext({ _pillEl: pill, updatePill: () => { updates++; }, PsycleEvents: { on: (evt, fn) => { handler = fn; } } });
    t.vm.runInContext(settingsSrc.slice(from, to + '\n    });'.length), lctx);
    pill.textContent = 'Ride 45 — Alex'; pill.hiddenClass = true;
    handler({ signedIn: false, initial: false, unverified: false });
    eq([updates, pill.textContent], [1, ''], 'signed out, pill hidden: the previous member\'s class is no longer in the page');
    pill.textContent = 'Ride 45 — Alex'; pill.hiddenClass = false;
    handler({ signedIn: false });
    eq(pill.textContent, 'Ride 45 — Alex', 'a session that merely EXPIRED keeps its bookings, and its pill: untouched while it shows');
    // …and a DIFFERENT member signs in from the expiry banner: _applyProfile
    // empties _myBookings, the event says signedIn:true, updatePill hides the
    // pill — with the first member's class / instructor / bike still in it.
    pill.hiddenClass = true;
    handler({ signedIn: true });
    eq(pill.textContent, '', 'a sign-in that leaves the pill hidden empties it too (it kept the previous member\'s class for the whole session)');
    pill.textContent = 'Ride 45 — Alex'; pill.hiddenClass = false;
    handler({ signedIn: true });
    eq(pill.textContent, 'Ride 45 — Alex', 'signed in with a class coming up (the pill shows): untouched — updatePill has just written it');
    lctx._pillEl = null;
    handler({ signedIn: false });
    eq(updates, 4, 'no pill yet: nothing to do, no throw');

    const css = t.readSource('css/settings.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const m = /@media \(min-width: 641px\) \{\s*body\.has-next-pill \.tab-panel,\s*body\.has-next-pill #tab-discover,\s*body\.has-next-pill #tab-membership \{([^}]*)\}/.exec(css);
    ok(!!m, 'css/settings.css: while the pill shows, every panel — the two that set their own padding by id included — gets the clearance, above the phone breakpoint only (there .tab-content already clears the bar the pill rides on)');
    ok(!!m && /padding-bottom:\s*calc\(/.test(m[1]) && /env\(safe-area-inset-bottom\)/.test(m[1]) && !/\d+px|#[0-9a-f]{3,6}\b/i.test(m[1]), '…in spacing tokens + the safe area, no raw px');
    const everyCss = ['styles', 'theme', 'features', 'tabs', 'settings', 'explore', 'redesign', 'discover-layout-fix']
      .map((f) => t.readSource('css/' + f + '.css').replace(/\/\*[\s\S]*?\*\//g, '')).join('\n');
    eq((everyCss.match(/has-next-pill/g) || []).length, 3, '…and nothing else hangs off has-next-pill: with the pill hidden the layout is exactly what it was');
    ok(/document\.body\.classList\.toggle\('has-next-pill', label != null\);/.test(settingsSrc), 'settings.js toggles it where the pill is shown / hidden (_pillA11y — the one place both go through)');
  }

  // ── Usual-week card ──────────────────────────────────────────────────────
  t.section('Usual week: the studio gets a line of its own');
  {
    const css = t.readSource('css/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const listRule = css.indexOf('.usual-week-list,\n.usual-week-plan {');
    const where = css.indexOf('.usual-week-list .usual-week-where::before {');
    const entry = css.indexOf('.usual-week-entry {');
    ok(listRule !== -1 && where > listRule && where < entry, 'the rule sits directly after the .usual-week-list rules');
    const body = css.slice(where, css.indexOf('}', where));
    ok(/content:\s*"\\A"/.test(body) && /white-space:\s*pre/.test(body), 'a forced line break before the studio: it gets a line of its own (the label no longer eats it first)');
    ok(!/display:\s*block/.test(body) && !/\d+px|#[0-9a-f]{3,6}\b/i.test(body), '…still inline — both lines are line boxes of .usual-week-what — and no raw px or colours');
    ok(/\.usual-week-list \.usual-week-sep \{ display: none; \}/.test(css), 'the " · " that joined the two lines is dropped in the card');
    ok(/\.usual-week-what \{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap/.test(css), '.usual-week-what keeps nowrap + ellipsis, which now ends EACH of the two lines');
    const tabsSrc = t.readSource('js/tabs.js');
    ok(/'<span class="usual-week-where"><span class="usual-week-sep"> · <\/span>' \+ escapeHTML\(en\.locName\) \+ '<\/span>'/.test(tabsSrc), 'tabs.js gives the separator its own span — and still escapes the studio name');
  }
};
