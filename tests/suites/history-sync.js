'use strict';
// The silent weekly history top-up (#76, js/explore.js): the REAL
// _explore_syncHistory and maybeTopUpHistory, sliced out of source and run
// against a scripted Psycle. A sync nobody asked for has to be quiet, small,
// rare — and must not undo a history write that lands while it is running.
module.exports = async function (t) {
  const { ok, eq } = t;
  const src = t.readSource('js/explore.js');
  const lines = src.split('\n');
  const region = (fromLine, untilLine) => {
    const from = lines.findIndex((l) => l.startsWith(fromLine));
    const to = lines.findIndex((l, i) => i > from && l.startsWith(untilLine));
    if (from === -1 || to === -1) throw new Error('history-sync suite: cannot slice "' + fromLine + '" … "' + untilLine + '" (anchor moved?)');
    return lines.slice(from, to).join('\n');
  };

  const appSrc = t.readSource('js/app.js');
  const copyFrom = appSrc.indexOf('// ── pure:copy:start'), copyTo = appSrc.indexOf('// ── pure:copy:end');
  if (copyFrom === -1 || copyTo < copyFrom) throw new Error('history-sync suite: cannot slice pure:copy out of js/app.js (markers moved?)');
  const copyRegion = appSrc.slice(copyFrom, copyTo);

  const DAY = 86400000;
  const NOW = Date.UTC(2026, 8, 21, 9, 30);
  const iso = (ms) => new Date(ms).toISOString();
  const past = (n) => Array.from({ length: n }, (_, i) => ({ id: 5000 + i, event_id: 100 + i, slot: 7, created_at: '2026-09-01 08:00:00' }));
  const entry = (id) => ({ eventId: String(id), typeName: 'Ride', instrName: 'Alex', locName: 'Bank', date: '2026-09-10 07:00:00', slots: [7], bookedAt: '2026-09-01T08:00:00.000Z' });

  function world(o) {
    o = o || {};
    const clock = { now: NOW };
    class FixedDate extends Date {
      constructor(...a) { if (a.length) super(...a); else super(clock.now); }
      static now() { return clock.now; }
    }
    const log = { gets: [], toasts: [], insights: 0, dirty: 0, events: [], timers: [], calls: [], paints: [] };
    const store = t.makeFakeLocalStorage();
    if (o.history) store.setItem('psycle_class_history', JSON.stringify(o.history));
    if (o.synced !== undefined) store.setItem('psycle_history_synced', o.synced);
    if (o.tried !== undefined) store.setItem('psycle_history_topup_at', o.tried);
    let token = o.token === undefined ? 'tok' : o.token;
    const w0 = { mine: o.mine };
    const btn = { disabled: false, textContent: 'Re-sync' };
    const ctx = t.vm.createContext({
      console: { log() {}, warn() {}, error() {} }, JSON, Math, Set, Map, Object, Array, String, Number, Promise, isNaN,
      Date: FixedDate,
      localStorage: store,
      navigator: { onLine: o.onLine === undefined ? true : o.onLine },
      document: { getElementById: (id) => (id === 'syncHistoryBtn' ? btn : null) },
      setTimeout: (fn, ms) => { log.timers.push({ fn, ms }); return log.timers.length; },
      toast: (msg, kind) => log.toasts.push([msg, kind]),
      renderInsights: () => { log.insights++; },
      markDirtyAndMaybeRender: () => { log.dirty++; },
      getBearerToken: () => token,
      PsycleEvents: { emit: (e) => log.events.push(e), on: () => {} },
      _eventCache: {},
      _paints: log.paints,
    });
    ctx.window = ctx;
    // features.js's owner check (tests/suites/history.js): is the stored history this member's?
    ctx.currentUser = { id: 1 };
    ctx._historyIsMine = () => { log.ownerAsked = (log.ownerAsked || 0) + 1; return w0.mine !== false; };
    ctx.apiFetch = async (path) => {
      log.gets.push(path);
      if (o.onGet) await o.onGet(path, store);
      if (path.indexOf('/bookings?type=previous') === 0) return { ok: true, status: 200, json: async () => ({ data: o.previous || [], meta: { last_page: 1, current_page: 1 } }) };
      const m = /^\/events\/(\d+)$/.exec(path);
      if (m) {
        return { ok: true, status: 200, json: async () => ({
          data: { id: Number(m[1]), start_at: '2026-09-15 07:00:00', event_type_id: 2, instructor_id: 44, studio_id: 4 },
          relations: { event_types: [{ id: 2, name: 'Ride' }], instructors: [{ id: 44, full_name: 'Alex' }], studios: [{ id: 4, name: 'S1', location_id: 9 }], locations: [{ id: 9, name: 'Psycle Bank' }] },
        }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };
    t.vm.runInContext([
      "var HISTORY_KEY = 'psycle_class_history'; var SYNC_KEY = 'psycle_history_synced'; var _syncing = false; var _syncLabel = '';",
      // The banner is DRAWN from _syncing/_syncLabel (renderSyncBanner) — the sync
      // no longer captures #syncHistoryBtn. Each paint is recorded as it would look.
      'function renderSyncBanner() { _paints.push(_syncing ? _syncLabel : "idle"); }',
      // The result toasts word their counts with app.js's _plural (pure:copy) — the real one.
      copyRegion,
      "function getHistory() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) { return []; } }",
      region('  var TOPUP_MAX_NEW', '  // ═══'),
    ].join('\n'), ctx);
    if (o.spySync) {
      const real = ctx._explore_syncHistory;
      ctx._explore_syncHistory = (opts) => { log.calls.push(opts); return o.spySync === 'real' ? real(opts) : Promise.resolve(); };
    }
    const history = () => JSON.parse(store.getItem('psycle_class_history') || '[]');
    return { ctx, log, clock, store, btn, history, setToken: (v) => { token = v; }, setMine: (v) => { w0.mine = v; } };
  }

  t.section('History top-up: when it may start');
  {
    let w = world({ spySync: true });
    w.ctx.maybeTopUpHistory();
    eq(w.log.timers.length, 0, 'never synced → never started for the member (their first sync can mean hundreds of requests: it stays their tap)');
    w = world({ spySync: true, synced: 'not a date' });
    w.ctx.maybeTopUpHistory();
    eq(w.log.timers.length, 0, 'an unreadable stamp is treated the same');
    w = world({ spySync: true, synced: iso(NOW - 3 * DAY) });
    w.ctx.maybeTopUpHistory();
    eq(w.log.timers.length, 0, 'synced three days ago → not yet');
    w = world({ spySync: true, synced: iso(NOW - 8 * DAY), tried: iso(NOW - 5 * 3600000) });
    w.ctx.maybeTopUpHistory();
    eq(w.log.timers.length, 0, 'a week stale but already tried five hours ago (a sync that keeps coming back partial) → not again today');

    w = world({ spySync: true, synced: iso(NOW - 8 * DAY), tried: iso(NOW - 2 * DAY) });
    w.ctx.maybeTopUpHistory();
    eq(w.log.timers.map((x) => x.ms), [8000], 'a week stale → scheduled clear of launch traffic, not fired into it');
    w.ctx.maybeTopUpHistory();
    eq(w.log.timers.length, 1, 'a second bookings:loaded inside those eight seconds (nothing stamped yet) does not queue a second sync');
    eq([w.log.calls.length, w.store.getItem('psycle_history_topup_at')], [0, iso(NOW - 2 * DAY)], '…nothing has run or been stamped yet');
    w.clock.now = NOW + 8000;
    w.log.timers[0].fn();
    eq([w.log.calls, w.store.getItem('psycle_history_topup_at')], [[{ silent: true }], iso(NOW + 8000)], 'then the member\'s own sync runs, silently, and the attempt is stamped BEFORE it runs');
    w.ctx.maybeTopUpHistory();
    w.ctx.maybeTopUpHistory();
    eq(w.log.timers.length, 1, 'bookings:loaded fires many times a session: once is once');
  }
  {
    let w = world({ spySync: true, synced: iso(NOW - 8 * DAY), token: '' });
    w.ctx.maybeTopUpHistory();
    eq(w.log.timers.length, 0, 'signed out → nothing');
    w.setToken('tok');
    w.ctx.maybeTopUpHistory();
    eq(w.log.timers.length, 1, '…and that look did not use up the session\'s one attempt');
    w = world({ spySync: true, synced: iso(NOW - 8 * DAY), onLine: false });
    w.ctx.maybeTopUpHistory();
    eq(w.log.timers.length, 0, 'offline → nothing');

    w = world({ spySync: true, synced: iso(NOW - 8 * DAY) });
    w.ctx.maybeTopUpHistory();
    w.setToken('');
    w.log.timers[0].fn();
    eq([w.log.calls, w.store.getItem('psycle_history_topup_at')], [[], null], 'signed out during the eight seconds → no sync, no stamp');
  }

  t.section('History top-up: never into another member\'s history');
  {
    // psycle_class_history is per-install: B signed in on A's phone, A's last sync over a week old.
    let w = world({ spySync: true, synced: iso(NOW - 8 * DAY), mine: false });
    w.ctx.maybeTopUpHistory();
    eq([w.log.timers.length, w.log.calls], [0, []], 'the stored history is another member\'s → no top-up (up to 60 of this account\'s classes would be merged into it, with no tap)');
    w.setMine(true);
    w.ctx.maybeTopUpHistory();
    eq(w.log.timers.length, 1, '…and that look did not use up the session\'s one attempt (an unverified session heals; A signs back in)');

    w = world({ spySync: true, synced: iso(NOW - 8 * DAY) });
    w.ctx.maybeTopUpHistory();
    w.setMine(false);
    w.log.timers[0].fn();
    eq([w.log.calls, w.store.getItem('psycle_history_topup_at')], [[], null], 'the account changed during the eight seconds → no sync, no stamp');

    w = world({ spySync: true, synced: iso(NOW - 8 * DAY) });
    delete w.ctx._historyIsMine;
    w.ctx.maybeTopUpHistory();
    eq(w.log.timers.length, 1, '(without features.js\'s check on window the top-up behaves as before)');
    ok(/window\._historyIsMine = _historyIsMine;/.test(t.readSource('js/features.js')), 'features.js exports the check at load (explore.js loads after it)');
  }

  t.section('History top-up: quiet, and only what is new');
  {
    const w = world({ synced: iso(NOW - 8 * DAY), history: [entry(100), entry(101)], previous: past(2) });
    await w.ctx._explore_syncHistory({ silent: true });
    eq(w.log.gets, ['/bookings?type=previous&limit=100'], 'both past classes already in history → one page read, NO detail requests');
    eq([w.log.toasts, w.log.insights, w.log.dirty, w.log.events], [[], 0, 0, []], 'nothing said, nothing repainted under the member\'s thumb');
    eq([w.store.getItem('psycle_history_synced'), w.history().length], [iso(NOW), 2], 'the sync stamp moves on (next top-up in a week); history intact');
    eq([w.btn.disabled, w.btn.textContent], [false, 'Re-sync'], 'the banner button is never driven by a top-up (it used to come back reading "Sync now")');
    eq(w.log.paints.filter((x) => x !== 'idle'), [], '…and the banner is never DRAWN busy by one either (only the idle repaint on the way out — same HTML, so setHtml skips it)');
  }
  {
    const w = world({ synced: iso(NOW - 8 * DAY), history: [entry(100)], previous: past(2) });
    await w.ctx._explore_syncHistory({ silent: true });
    eq([w.log.gets.slice(1), w.history().map((h) => h.eventId).sort()], [['/events/101'], ['100', '101']], 'the one class booked elsewhere and attended is fetched and merged');
    eq([w.log.toasts, w.log.insights, w.log.events], [[], 1, ['history:synced']], 'still no toast — but Stats is repainted, because something changed');
  }
  {
    const w = world({ synced: iso(NOW - 8 * DAY), history: [], previous: past(61) });
    await w.ctx._explore_syncHistory({ silent: true });
    eq([w.log.gets.length, w.history().length, w.store.getItem('psycle_history_synced')], [1, 0, iso(NOW - 8 * DAY)],
      '61 unknown classes is not a top-up (another account on this device, a wiped history): no detail requests, nothing written, not marked synced');
    await w.ctx._explore_syncHistory();
    eq(w.log.toasts.some((x) => /Already syncing/.test(x[0])), false, '…and it let go of the sync lock on its way out');
    eq(w.log.paints[0], 'idle', '…repainting the banner idle (a section rebuilt mid-top-up had drawn it busy)');
    eq(w.history().length, 61, 'the member\'s own Re-sync tap still imports them all');
  }
  {
    const w = world({ synced: iso(NOW - 8 * DAY), history: [], previous: past(60) });
    await w.ctx._explore_syncHistory({ silent: true });
    eq(w.history().length, 60, '60 is still a top-up (two months away from the app)');
  }

  t.section('History sync: a write that lands while it runs is kept');
  {
    // The member books a class (features.js unshifts its entry) while detail requests are in flight.
    const w = world({
      synced: iso(NOW - 8 * DAY), history: [entry(100)], previous: past(2),
      onGet: async (path, store) => { if (path === '/events/101') store.setItem('psycle_class_history', JSON.stringify([entry(900), entry(100)])); },
    });
    await w.ctx._explore_syncHistory({ silent: true });
    eq(w.history().map((h) => h.eventId).sort(), ['100', '101', '900'], 'history is re-read at merge time — the old code wrote back the copy from before the requests and lost the booking');
  }

  t.section('History sync: the buttons behave as before');
  {
    const w = world({ history: [entry(100)], previous: past(2) });
    await w.ctx._explore_syncHistory();
    eq([w.log.toasts.map((x) => x[1]), w.log.insights, w.log.dirty], [['success'], 1, 1], 'no arguments (every existing caller) → the result toast and the repaint, as always');
    eq([w.log.paints[0], w.log.paints[w.log.paints.length - 1], w.btn.textContent], ['Syncing...', 'idle', 'Re-sync'],
      '…and the banner is drawn busy, then idle again — from state, never by writing to a captured button');
    const quiet = world({ history: [entry(100), entry(101)], previous: past(2) });
    await quiet.ctx._explore_syncHistory();
    eq([quiet.log.toasts.length, quiet.log.insights], [1, 1], 'a manual sync that finds nothing new still says so and repaints');
  }
  {
    let release;
    const w = world({ synced: iso(NOW - 8 * DAY), history: [], previous: past(1), onGet: () => new Promise((r) => { release = r; }) });
    const running = w.ctx._explore_syncHistory({ silent: true });
    await w.ctx._explore_syncHistory();
    eq(w.log.toasts, [['Already syncing your history…', 'info']], 'a Re-sync tap during a top-up is told why nothing new started (it used to do nothing, silently)');
    await w.ctx._explore_syncHistory({ silent: true });
    eq(w.log.toasts.length, 1, 'a second silent call says nothing');
    release();
    await new Promise((r) => setImmediate(r));
    release();
    await running;
  }
  ok(/PsycleEvents\.on\('bookings:loaded', maybeTopUpHistory\)/.test(src), 'the hook rides bookings:loaded — which only fires for a signed-in fetch Psycle answered');
};
