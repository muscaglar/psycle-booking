'use strict';
// Discover's timetable window (js/app.js): which ranges the loaded window can
// serve, when its numbers count as fresh, what a revalidate fetches and —
// above all — that a revalidate can never commit a truncated window.
// Runs with TZ=America/New_York on purpose: none of this may assume UK time.
module.exports = async function (t) {
  const F = t.loadPure('js/app.js', 'filters');
  const appSrc = t.readSource('js/app.js');
  const pure = () => t.loadPure('js/app.js', 'window', { _dateModeWindow: F._dateModeWindow });
  const W = pure();
  const TODAY = '2026-09-17';
  const WEEK = TODAY + '|2026-09-24';

  // ── Window keys ──────────────────────────────────────────────────────────
  t.section('Window: keys and coverage (js/app.js pure:window)');
  t.ok(['_parseWindowKey', '_keyCovers', '_dayInRange', '_windowIsFresh', '_cachePlan', '_revalRange', '_rollForwardMode', '_anyStartedBetween']
    .every((n) => typeof W[n] === 'function'), 'the pure:window region defines every helper');
  t.eq(W._parseWindowKey(WEEK), { start: TODAY, end: '2026-09-24' }, 'a key parses to its two days');
  t.eq(W._parseWindowKey(TODAY + '|' + TODAY), { start: TODAY, end: TODAY }, 'a one-day key parses');
  t.eq(W._parseWindowKey('2026-09-24|2026-09-17'), null, 'a reversed key is not a window');
  t.eq(W._parseWindowKey('2026-9-17|2026-09-24'), null, 'a malformed day is not a window');
  t.eq(W._parseWindowKey(null), null, 'no key (nothing loaded yet) is not a window');
  t.eq(W._parseWindowKey('{"key":1}'), null, 'junk from localStorage is not a window');

  t.eq(W._keyCovers(WEEK, TODAY, TODAY), true, 'the loaded week holds Today');
  t.eq(W._keyCovers(WEEK, '2026-09-18', '2026-09-18'), true, 'the loaded week holds Tomorrow');
  t.eq(W._keyCovers(WEEK, '2026-09-24', '2026-09-24'), true, 'the last day of the week is inside');
  t.eq(W._keyCovers(WEEK, TODAY, '2026-09-24'), true, 'a window covers its own range');
  t.eq(W._keyCovers(WEEK, TODAY, '2026-10-01'), false, '14 days is NOT inside the loaded week');
  t.eq(W._keyCovers(WEEK, '2026-09-16', '2026-09-16'), false, 'yesterday is not inside');
  t.eq(W._keyCovers(WEEK, '2026-09-25', '2026-09-25'), false, 'the day after the week is not inside');
  t.eq(W._keyCovers(TODAY + '|' + TODAY, TODAY, '2026-09-24'), false, 'a one-day window never serves the week');
  t.eq(W._keyCovers(null, TODAY, TODAY), false, 'nothing loaded covers nothing');
  t.eq(W._keyCovers(WEEK, '', ''), false, 'an empty selection is not covered');
  t.eq(W._keyCovers(WEEK, '2026-09-20', '2026-09-18'), false, 'a reversed selection is not covered');

  t.section('Window: day bound used by render() and the facet counts');
  t.eq(W._dayInRange('2026-09-17T07:00:00', TODAY, TODAY), true, 'T-form start_at on the day');
  t.eq(W._dayInRange('2026-09-17 23:30:00', TODAY, TODAY), true, 'space-form start_at, late evening — no UTC shift into tomorrow');
  t.eq(W._dayInRange('2026-09-18T00:15:00', TODAY, TODAY), false, 'just past midnight is the next day');
  t.eq(W._dayInRange('2026-09-16T21:00:00', TODAY, '2026-09-24'), false, 'before the range');
  t.eq(W._dayInRange('2026-09-25T06:30:00', TODAY, '2026-09-24'), false, 'after the range');
  t.eq(W._dayInRange('2026-09-30T06:30:00', '', ''), true, 'no bounds (a restored legacy search) bound nothing');
  t.eq(W._dayInRange('2026-09-30T06:30:00', TODAY, ''), true, 'an open end bounds only the start');

  // The predicate has to be IN render() and the facets, or Today inside the
  // loaded week would list the whole week.
  const renderSrc = appSrc.slice(appSrc.indexOf('function render(events, relations, filters, done) {'), appSrc.indexOf('// ── Studio multi-select chips'));
  t.ok(/if \(!_dayInRange\(e\.start_at, filters\.startDate, filters\.endDateStr\)\) return false;/.test(renderSrc), "render()'s filter bounds the days to the selected range");
  const facetSrc = appSrc.slice(appSrc.indexOf('function discoverFacets() {'), appSrc.indexOf('function refreshFacetCounts() {'));
  t.ok(/dateFilter: c => _dayInRange\(c\.start_at, startDate, endDateStr\)/.test(facetSrc), 'discoverFacets() counts only the selected days');

  // ── Freshness ────────────────────────────────────────────────────────────
  t.section('Window: freshness (15 minutes)');
  const NOW = Date.UTC(2026, 8, 17, 12, 0, 0);
  t.eq(W._windowIsFresh(NOW - 60 * 1000, NOW), true, 'a minute old is fresh');
  t.eq(W._windowIsFresh(NOW - 14 * 60 * 1000, NOW), true, '14 minutes old is fresh');
  t.eq(W._windowIsFresh(NOW - 15 * 60 * 1000, NOW), false, '15 minutes old is not');
  t.eq(W._windowIsFresh(NOW - 9 * 60 * 60 * 1000, NOW), false, "the morning's window is not fresh in the evening");
  t.eq(W._windowIsFresh(NOW + 60 * 60 * 1000, NOW), false, 'a stamp from the future (clock moved back) is not fresh');
  t.eq(W._windowIsFresh(0, NOW), false, 'no stamp is not fresh');
  t.eq(W._windowIsFresh(undefined, NOW), false, 'an undefined stamp is not fresh');

  // ── Persisted cache plan (#72) ───────────────────────────────────────────
  t.section('Window: what the persisted cache can give a launch');
  t.eq(W._cachePlan(WEEK, TODAY, '2026-09-24'), 'covers', 'same range → covers');
  t.eq(W._cachePlan(WEEK, TODAY, TODAY), 'covers', 'cached week, launch on Today → covers (it refetched every studio)');
  t.eq(W._cachePlan('2026-09-16|2026-09-23', TODAY, '2026-09-24'), 'overlap', "yesterday's week on this morning's first open → overlap");
  t.eq(W._cachePlan('2026-09-16|2026-09-23', TODAY, TODAY), 'covers', "yesterday's week still holds Today whole");
  t.eq(W._cachePlan('2026-09-08|2026-09-15', TODAY, '2026-09-24'), null, 'a cache that ended before today is useless');
  t.eq(W._cachePlan('2026-09-20|2026-09-27', TODAY, '2026-09-24'), null, 'a cache that starts later cannot show the first days');
  t.eq(W._cachePlan('garbage', TODAY, '2026-09-24'), null, 'a malformed cached key is useless');
  t.eq(W._cachePlan(WEEK, '', ''), null, 'no selection → nothing');

  // ── Revalidate range ─────────────────────────────────────────────────────
  t.section('Window: the range a revalidate fetches');
  t.eq(W._revalRange(WEEK, TODAY, TODAY, TODAY), { startDate: TODAY, endDateStr: '2026-09-24' }, 'refreshing "Today" refetches the whole loaded week — it must not shrink it to a day');
  t.eq(W._revalRange(WEEK, '2026-09-19', '2026-09-19', TODAY), { startDate: TODAY, endDateStr: '2026-09-24' }, 'a picked day inside the week: same');
  t.eq(W._revalRange(WEEK, TODAY, '2026-10-01', TODAY), { startDate: TODAY, endDateStr: '2026-10-01' }, 'a selection the window does not hold is fetched as selected');
  t.eq(W._revalRange(null, TODAY, '2026-09-24', TODAY), { startDate: TODAY, endDateStr: '2026-09-24' }, 'no window yet: the selection');
  t.eq(W._revalRange('2026-09-16|2026-09-23', TODAY, TODAY, TODAY), { startDate: TODAY, endDateStr: '2026-09-23' }, "yesterday's window: days already gone are not refetched");
  t.eq(W._revalRange('2026-09-10|2026-09-23', '2026-09-15', '2026-09-16', TODAY), { startDate: '2026-09-15', endDateStr: '2026-09-23' }, 'trimming gone days never cuts into the selection');
  const rr = W._revalRange('2026-09-16|2026-09-23', '2026-09-18', '2026-09-18', TODAY);
  t.ok(W._keyCovers(rr.startDate + '|' + rr.endDateStr, '2026-09-18', '2026-09-18'), 'the trimmed range still covers the selection');

  // ── Roll-forward decision table (#55 / #23) ──────────────────────────────
  t.section('Window: roll-forward on a new day');
  const YDAY = '2026-09-16';
  const roll = (mode, startDate, daysAhead, lastDay, today) => W._rollForwardMode({ mode, startDate, daysAhead, lastDay: lastDay || YDAY, today: today || TODAY });
  t.eq(roll('today', TODAY, '1', TODAY), null, 'same day: nothing to do');
  t.eq(roll('today', YDAY, '1'), 'today', '"Today" left warm overnight follows the calendar');
  t.eq(roll('tomorrow', TODAY, '1'), 'tomorrow', '"Tomorrow" (it now IS today) becomes the new tomorrow');
  t.eq(roll('week', YDAY, '6'), 'week', '7 days re-derives from today');
  t.eq(roll('2week', YDAY, 13), '2week', '14 days re-derives from today');
  t.eq(roll('today', '2026-09-14', '1', '2026-09-14'), 'today', 'suspended for three days: still "Today"');
  t.eq(roll(null, YDAY, '1'), 'week', 'a picked day that has gone falls back to the week');
  t.eq(roll(null, '2026-09-20', '1'), null, 'a picked day still ahead is left alone');
  t.eq(roll(null, TODAY, '1'), null, 'a picked day that is now today is left alone');
  t.eq(roll('today', '2026-09-20', '1'), null, 'a stale "today" mode over a future date (planner / rebook) never drags it to today');
  t.eq(roll('week', '2026-09-20', '8'), null, 'a stale mode over a custom future range is left alone');
  t.eq(roll('week', YDAY, '1'), 'week', 'a stale mode over a single past day: the week');
  t.eq(roll('today', TODAY, '1', YDAY), null, 'dates already derived for today (launch straddled midnight): nothing to do');
  t.eq(roll('today', TODAY, '1', TODAY, YDAY), 'today', 'the clock went BACK a day (flew west): the preset follows it');
  t.eq(roll('constructor', YDAY, '1'), 'week', 'an inherited key is not a preset (past date → week)');
  t.eq(roll(null, '', ''), null, 'empty inputs: nothing to do');
  t.eq(W._rollForwardMode(null), null, 'no state: nothing to do');

  t.section('Window: has a class started since the list was built?');
  const at = (h, m) => new Date(2026, 8, 17, h, m, 0).getTime(); // device-local, like render()'s own test
  const evs = [{ start_at: '2026-09-17T07:00:00' }, { start_at: '2026-09-17T12:30:00' }, { start_at: '2026-09-18T07:00:00' }];
  t.eq(W._anyStartedBetween(evs, at(12, 0), at(12, 29)), false, 'nothing started in the gap');
  t.eq(W._anyStartedBetween(evs, at(12, 0), at(12, 31)), true, 'the 12:30 started while we were away');
  t.eq(W._anyStartedBetween(evs, at(12, 0), at(12, 30)), false, 'exactly at the start it is still listed (render drops start < now)');
  t.eq(W._anyStartedBetween(evs, at(12, 30), at(12, 45)), true, 'a class that started at the render instant was kept then, and goes now');
  t.eq(W._anyStartedBetween(evs, at(8, 0), at(9, 0)), false, 'classes that had already started before the render do not count');
  t.eq(W._anyStartedBetween([{ start_at: 'nonsense' }, {}], 0, at(23, 0)), false, 'an unparseable start never counts');
  t.eq(W._anyStartedBetween(null, 0, at(23, 0)), false, 'no window: no');

  // ── revalidateWindow: the REAL functions (#53) ───────────────────────────
  // Sliced out of app.js and run against four fake studios that answer one
  // after another. The old code used _searchSeq as its abort signal, so a chip
  // tap mid-refresh made fetchFullWindow drop the studios still loading — and
  // the truncated window was committed AND persisted.
  t.section('Window: a revalidate never commits a truncated window');
  const rvStart = appSrc.indexOf('// Fetch the full window (every studio) for a date range.');
  const rvEnd = appSrc.indexOf('// ── Discover rolls forward');
  t.ok(rvStart !== -1 && rvEnd > rvStart, 'fetchFullWindow … _revalidateIfStale can be sliced (anchors moved? update tests/suites/window.js)');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const makeWorld = (opts) => {
    opts = opts || {};
    const w = { fetches: [], sets: [], persists: [], renders: 0, toasts: [], labels: 0, timers: [], searches: [], checking: false, sel: { startDate: TODAY, endDateStr: TODAY }, busy: false, scroller: { scrollTop: 0 } };
    const globals = {
      _dateModeWindow: F._dateModeWindow,
      setTimeout: (fn, ms) => { if (ms >= 1000) { w.timers.push(fn); return w.timers.length; } return setTimeout(fn, ms); },
      clearTimeout: () => {}, Promise,
      navigator: { onLine: opts.offline ? false : true },
      locations: [1, 2, 3, 4].map((id) => ({ id, handle: 'studio-' + id })).concat([{ id: 9, handle: 'psycle-at-home' }]),
      getBearerToken: () => 'tok',
      localDateStr: () => TODAY,
      currentWindowDates: () => ({ startDate: w.sel.startDate, endDateStr: w.sel.endDateStr, windowKey: w.sel.startDate + '|' + w.sel.endDateStr }),
      currentFilters: () => ({}),
      mergeRelations: (base, inc) => { (inc.studios || []).forEach((s) => base.studios.push(s)); },
      fetchEventsForLocation: async (locId, s, e, seen, isStale) => {
        w.fetches.push({ locId, s, e });
        await sleep(locId * 12);
        if (opts.failStudio === locId) throw new Error('HTTP 503');
        if (opts.empty) return { events: [], relations: null }; // a 200 with no classes: the real loop ends before it keeps any relations
        if (isStale && isStale()) return { events: [], relations: null }; // the real loop breaks before its request
        return { events: [{ id: locId, studio_id: locId, start_at: s + 'T10:00:00' }], relations: { studios: [{ id: locId }] } };
      },
      _setWindow: (key, events, relations, fetchedAt, partial) => {
        w.sets.push({ key, ids: events.map((x) => x.id).sort(), partial: !!partial });
        globals.window._windowKey = key; globals.window._windowEvents = events; globals.window._windowRelations = relations;
        globals.window._windowFetchedAt = Date.now(); globals.window._windowPartial = !!partial;
      },
      _persistWindow: (key, events) => { w.persists.push({ key, ids: events.map((x) => x.id).sort() }); },
      _buildFacetClasses: () => {},
      renderFromWindow: () => { w.renders++; globals._searchSeq++; if (opts.renderScrollsTo != null) w.scroller.scrollTop = opts.renderScrollsTo; },
      renderLastUpdated: () => { w.labels++; },
      toast: (msg, type) => { w.toasts.push({ msg, type }); },
      _dialogOpen: () => w.busy,
      // w.checking: renderEmptyState's "Checking the latest timetable…" is up in #results.
      document: { querySelector: (sel) => (sel === '.tab-content' ? w.scroller : (sel === '#results .empty-loading' && w.checking ? {} : null)), querySelectorAll: () => [] },
      search: (o) => { w.searches.push(o); },
      window: { _windowKey: opts.windowKey === undefined ? WEEK : opts.windowKey, _windowEvents: [], _windowRelations: {}, _windowFetchedAt: 1, _windowPartial: false, scrollY: 0, scrollTo() {} },
      _searchSeq: 0,
    };
    const ctx = t.loadPure('js/app.js', 'window', globals);
    t.vm.runInContext('function _windowCovers(a, b) { return Array.isArray(window._windowEvents) && !!window._windowRelations && _keyCovers(window._windowKey, a, b); }\n' +
      appSrc.slice(rvStart, rvEnd), ctx, { filename: 'js/app.js[revalidate]' });
    w.ctx = ctx; w.globals = globals;
    return w;
  };

  if (rvStart !== -1 && rvEnd > rvStart) {
    // A — the #53 reproduction: a chip tap (renderFromWindow bumps _searchSeq) mid-refresh.
    let w = makeWorld();
    let p = w.ctx.revalidateWindow();
    await sleep(30); // studios 1–2 have answered, 3–4 are still loading
    w.globals.renderFromWindow(); // the chip tap
    let ok = await p;
    t.eq(ok, true, 'a chip tap mid-refresh does not abandon the refresh');
    t.eq(w.sets.length === 1 && w.sets[0].ids, [1, 2, 3, 4], 'the committed window holds ALL four studios (it held [1,2])');
    t.eq(w.persists.length === 1 && w.persists[0].ids, [1, 2, 3, 4], 'and so does the persisted one (the truncated window survived relaunches)');
    t.eq(w.fetches.length, 4, 'psycle-at-home is never fetched');
    t.eq(w.fetches.map((f) => f.s + '|' + f.e).filter((k, i, a) => a.indexOf(k) === i), [WEEK], 'viewing Today, the whole loaded week is refetched');
    t.eq(w.sets[0].key, WEEK, 'and committed under the week key — the window is not shrunk to a day');
    t.ok(w.renders >= 2, 'the list is re-rendered when the refresh lands (live filters are read then)');

    // B — the latch: leave the range mid-flight, come straight back.
    w = makeWorld();
    p = w.ctx.revalidateWindow();
    await sleep(18); // studio 1 merged
    w.sel = { startDate: '2026-10-20', endDateStr: '2026-10-20' }; // a far date: outside the range being fetched
    await sleep(12); // studio 2 sees the move and is dropped
    w.sel = { startDate: TODAY, endDateStr: TODAY }; // …and back
    ok = await p;
    t.eq(ok, false, 'a refresh that was abandoned stays abandoned');
    t.eq(w.sets.length + w.persists.length, 0, 'nothing is committed or persisted from it (studio 2 was skipped while away)');
    t.eq(w.toasts.length, 0, 'and nobody is told off for changing the date');

    // B2 — moving WITHIN the fetched range is not leaving it.
    w = makeWorld();
    p = w.ctx.revalidateWindow();
    await sleep(18);
    w.sel = { startDate: '2026-09-18', endDateStr: '2026-09-18' }; // Tomorrow: still inside the week being refetched
    ok = await p;
    t.eq(ok, true, 'Today → Tomorrow mid-refresh keeps the refresh (the week holds both)');
    t.eq(w.sets[0] && w.sets[0].ids, [1, 2, 3, 4], 'complete');

    // B3 — …and a refresh asked for after coming back does not JOIN the dead
    // run: that made Refresh do nothing (no commit, no toast, no retry).
    w = makeWorld();
    p = w.ctx.revalidateWindow();
    await sleep(18);
    w.sel = { startDate: '2026-10-20', endDateStr: '2026-10-20' };
    await sleep(12); // studio 2 trips the latch
    w.sel = { startDate: TODAY, endDateStr: TODAY };
    const fresh = w.ctx.revalidateWindow({ silent: true }); // the way back: search() path 1 → _revalidateIfStale()
    t.ok(fresh !== p, 'a run whose latch has tripped is not joined — a new one starts beside it');
    t.eq([await p, await fresh], [false, true], 'the dead run commits nothing; the new one commits');
    t.eq([w.sets.length, w.sets[0] && w.sets[0].ids, w.fetches.length], [1, [1, 2, 3, 4], 8], 'one complete window, from the second set of requests');
    const joined = w.ctx.revalidateWindow();
    t.ok(joined !== fresh, "the dead run's clean-up left the slot to the run that replaced it (nothing in flight now: a third starts)");
    await joined;

    // B4 — the latch tripped over a provisional window showing "Checking…", and
    // nothing asked again: the placeholder must still come down when the run ends.
    w = makeWorld();
    w.globals.window._windowPartial = true;
    w.checking = true;
    p = w.ctx.revalidateWindow({ silent: true });
    await sleep(18);
    w.sel = { startDate: '2026-10-20', endDateStr: '2026-10-20' };
    await sleep(12);
    w.sel = { startDate: TODAY, endDateStr: TODAY };
    t.eq([await p, w.sets.length, w.renders], [false, 0, 1], 'the run is over and the view is back on its range: "Checking…" is swapped for what we know (it span forever)');
    w = makeWorld();
    w.globals.window._windowPartial = true;
    w.checking = true;
    p = w.ctx.revalidateWindow({ silent: true });
    await sleep(18);
    w.sel = { startDate: '2026-10-20', endDateStr: '2026-10-20' };
    t.eq([await p, w.renders], [false, 0], 'still away when it ends: nothing is painted over the other view');

    // C — in-flight guard.
    w = makeWorld();
    const p1 = w.ctx.revalidateWindow();
    const p2 = w.ctx.revalidateWindow({ silent: true });
    t.ok(p1 === p2, 'a second refresh of the same range joins the one in flight');
    await p1;
    t.eq(w.fetches.length, 4, 'one request per studio — not two');
    const label = appSrc.slice(appSrc.indexOf('function renderLastUpdated() {'), appSrc.indexOf('async function refreshWindow() {'));
    t.ok(/_revalInFlight\s*\?\s*'<button type="button" class="refresh-link" disabled>Refreshing…<\/button>'/.test(label), 'the label is painted from state: mid-refresh it stays a disabled "Refreshing…" on every repaint');

    // D — one studio fails: nothing is committed.
    w = makeWorld({ failStudio: 3 });
    ok = await w.ctx.revalidateWindow();
    t.eq(ok, false, 'one failing studio fails the refresh');
    t.eq(w.sets.length + w.persists.length, 0, 'the old window stays — never a partial one');
    t.eq(w.toasts.map((x) => x.type), ['error'], 'a manual refresh says so (it used to fail silently)');
    const before = w.fetches.length;
    ok = await w.ctx.revalidateWindow({ silent: true });
    t.eq(w.fetches.length, before, 'a background refresh right after a failure is skipped (no request per studio on every chip tap)');
    await w.ctx.revalidateWindow();
    t.ok(w.fetches.length > before, 'a manual refresh is never skipped');
    w = makeWorld({ failStudio: 2 });
    await w.ctx.revalidateWindow({ silent: true });
    t.eq(w.toasts.length, 0, 'a background refresh fails quietly');
    w = makeWorld({ failStudio: 2 });
    const bg = w.ctx.revalidateWindow({ silent: true });
    const manual = w.ctx.revalidateWindow(); // Refresh tapped while the background run is in flight
    t.ok(bg === manual, 'a manual Refresh joins a background run…');
    await manual;
    t.eq(w.toasts.map((x) => x.type), ['error'], '…and is still told when it fails (the run stops being silent)');

    // D1 — every studio answers 200 with an empty list (wave 2). Nothing is
    // committed, so the "Updated" stamp must stay as old as the list on screen;
    // a manual Refresh is told, because the tap otherwise looked dead.
    w = makeWorld({ empty: true });
    w.globals.window._windowFetchedAt = 12345;
    ok = await w.ctx.revalidateWindow();
    t.eq([ok, w.fetches.length, w.sets.length + w.persists.length], [false, 4, 0], 'an all-empty refresh commits and persists nothing (an empty 200 never wipes a real timetable)');
    t.eq(w.globals.window._windowFetchedAt, 12345, '…and never restamps it: the label keeps the age of the list that is still up');
    t.eq(w.toasts.map((x) => x.type), ['info'], 'a manual Refresh says so');
    w = makeWorld({ empty: true });
    await w.ctx.revalidateWindow({ silent: true });
    t.eq(w.toasts.length, 0, 'a background one stays quiet');
    w = makeWorld({ empty: true });
    p = w.ctx.revalidateWindow();
    w.sel = { startDate: '2026-10-20', endDateStr: '2026-10-20' }; // the view left the range mid-flight
    await p;
    t.eq(w.toasts.length, 0, 'an abandoned run is empty for a different reason: no toast');

    // D2 — a PROVISIONAL window (an older cache under today's key) whose refresh
    // fails on the server's side is handed to search(): that path shows the
    // studios that do answer, where this one commits nothing while one is down.
    const realApi = { navigator: { onLine: true }, console };
    realApi.window = realApi;
    t.vm.createContext(realApi);
    t.vm.runInContext(t.readSource('js/api-client.js'), realApi, { filename: 'js/api-client.js' });
    const provisional = (o) => {
      const pw = makeWorld(o);
      pw.globals.window.PsycleAPI = realApi.PsycleAPI;
      pw.globals.window._windowPartial = true;
      pw.globals.window._windowHeldEnd = '2026-09-23';
      return pw;
    };
    w = provisional({ failStudio: 3 }); // throws Error('HTTP 503')
    ok = await w.ctx.revalidateWindow({ silent: true });
    t.eq([ok, w.searches, w.toasts.length], [false, [{ force: true }], 0], 'one studio 503s behind a provisional window: a forced search() takes over, quietly');
    t.eq(w.sets.length + w.persists.length, 0, '…and the refresh itself still commits nothing');
    t.eq(w.globals.window._windowLoadError, "Psycle is having trouble right now. Try again shortly.", 'the classified reason is kept for the empty state behind it');
    await w.ctx.revalidateWindow(); // a manual Refresh; the studio is still down
    t.eq([w.searches.length, w.toasts.map((x) => x.type)], [1, ['error']], 'once per window: the next failure is reported, not handed over again (no spinner/error loop during an outage)');
    w = provisional({ failStudio: 3 });
    w.busy = true; // the bike picker is open
    await w.ctx.revalidateWindow({ silent: true });
    t.eq(w.searches, [], 'never under a booking in progress (search() clears #results)');
    w = provisional({ failStudio: 3 });
    w.globals.window._windowHeldEnd = null; // a search() that lost a studio: partial, but nothing was adopted
    await w.ctx.revalidateWindow({ silent: true });
    t.eq(w.searches, [], 'a window search() itself committed is not handed back to search() (that would loop)');
    w = provisional({ failStudio: 3 });
    t.vm.runInContext("fetchEventsForLocation = async () => { throw new TypeError('Load failed'); };", w.ctx);
    await w.ctx.revalidateWindow({ silent: true });
    t.eq(w.searches, [], 'a connection failure is not handed over — search() would swap the cached list for an error');

    // E — offline.
    w = makeWorld({ offline: true });
    ok = await w.ctx.revalidateWindow({ silent: true });
    t.eq([ok, w.fetches.length, w.toasts.length], [false, 0, 0], 'offline: a background refresh does nothing (no retry storm, no error-log spam)');
    ok = await w.ctx.revalidateWindow();
    t.eq([ok, w.fetches.length, w.toasts.map((x) => x.type)], [false, 0, ['info']], 'offline: a manual refresh says why instead of spinning');

    // F — a live search is already loading this view.
    w = makeWorld();
    t.vm.runInContext('_searchSeq = 5; _fetchingSeq = 5;', w.ctx);
    ok = await w.ctx.revalidateWindow();
    t.eq([ok, w.fetches.length], [false, 0], 'a live search owns the load: revalidate defers to it');
    t.vm.runInContext('_searchSeq = 6;', w.ctx); // that search was superseded by a cached render
    ok = await w.ctx.revalidateWindow();
    t.eq(ok, true, 'a superseded search no longer blocks it');

    // G — no window covering the selection: fetch exactly what is selected.
    w = makeWorld({ windowKey: null });
    w.sel = { startDate: TODAY, endDateStr: '2026-09-24' };
    await w.ctx.revalidateWindow();
    t.eq(w.sets[0] && w.sets[0].key, WEEK, 'nothing loaded: the selection itself is fetched and committed');

    // H — the in-place re-render waits for a busy list and keeps the scroll.
    w = makeWorld({ renderScrollsTo: 0 });
    w.scroller.scrollTop = 640;
    w.busy = true; // the bike picker is open
    await w.ctx.revalidateWindow();
    t.eq([w.sets.length, w.renders, w.timers.length], [1, 0, 1], 'dialog open: the window is updated, the list is NOT rebuilt under it, a retry is armed');
    w.busy = false;
    w.timers[0]();
    t.eq(w.renders, 1, 'once the dialog is gone the list is rebuilt');
    t.eq(w.scroller.scrollTop, 640, 'and the scroll offset survives the rebuild');
    w = makeWorld();
    w.busy = true;
    await w.ctx.revalidateWindow();
    w.sel = { startDate: '2026-10-20', endDateStr: '2026-10-20' }; // the view moved on before the retry
    w.busy = false;
    w.timers[0]();
    t.eq(w.renders, 0, 'a deferred re-render never paints over a view that has moved to another range');
  }

  if (rvStart !== -1 && rvEnd > rvStart) {
    // I — a partial window is never "fresh": the next render from it refetches.
    let w = makeWorld();
    w.globals.window._windowFetchedAt = Date.now();
    w.ctx._revalidateIfStale();
    await sleep(5);
    t.eq(w.fetches.length, 0, 'a complete window loaded a moment ago: no request');
    w.globals.window._windowPartial = true; // search() lost a studio, or an older cache was adopted
    w.ctx._revalidateIfStale();
    await sleep(80);
    t.eq([w.fetches.length, w.sets.map((x) => x.partial)], [4, [false]], 'the same window flagged partial: refetched quietly, and the complete window clears the flag');
  }

  // ── search(): the cache paths (#24 / #27 / #72) ──────────────────────────
  t.section('Window: search() serves in-window ranges without a fetch');
  const sStart = appSrc.indexOf('async function search(opts) {');
  const sEnd = appSrc.indexOf("  const btn = document.getElementById('searchBtn');", sStart);
  t.ok(sStart !== -1 && sEnd > sStart, 'the head of search() can be sliced (anchors moved? update tests/suites/window.js)');
  if (sStart !== -1 && sEnd > sStart) {
    const searchWorld = (o) => {
      const w = { calls: [], sets: [], status: null };
      const inputs = { startDate: { value: o.startDate }, daysAhead: { value: String(o.days) } };
      const globals = {
        _dateModeWindow: F._dateModeWindow, _windowEndDate: F._windowEndDate,
        clearTimeout() {}, _syncDatePills() {},
        selectedInstructors: new Set(), selectedLocations: new Set(), selectedCategories: new Set(),
        selectedStrengthSubs: new Set(), selectedReformerSubs: new Set(),
        document: { getElementById: (id) => inputs[id] || null },
        getBearerToken: () => 'tok', locations: o.locations || [{ id: 1 }],
        window: { _windowKey: o.memKey || null, _windowEvents: o.memKey ? [] : null, _windowRelations: o.memKey ? {} : null },
        _readWindowCache: () => o.cache || null,
        _setWindow: (key, events, relations, fetchedAt, partial) => { w.sets.push({ key, n: events.length, fetchedAt, partial: !!partial }); w.calls.push('set'); },
        _buildFacetClasses: () => w.calls.push('facets'),
        renderFromWindow: () => w.calls.push('render'),
        _revalidateIfStale: () => w.calls.push('revalidateIfStale'),
        revalidateWindow: (opts) => { w.calls.push('revalidate' + (opts && opts.silent ? ':silent' : '')); return Promise.resolve(true); },
        showInitError: () => w.calls.push('initError'),
        setStatus: (html) => { w.status = html; },
      };
      const ctx = t.loadPure('js/app.js', 'window', globals);
      t.vm.runInContext('var _searchSeq = 0, _loadableSearchStarted = false, _autoSearchTimer = null, _dateQuickMode = null, _refDataFailed = ' + JSON.stringify(o.refFailed || null) + ', __fetched = false;\n' +
        'function _windowCovers(a, b) { return Array.isArray(window._windowEvents) && !!window._windowRelations && _keyCovers(window._windowKey, a, b); }\n' +
        appSrc.slice(sStart, sEnd) + '\n  __fetched = true;\n}', ctx, { filename: 'js/app.js[search head]' });
      w.ctx = ctx;
      return w;
    };
    const day = (d, n) => Array.from({ length: n }, (x, i) => ({ id: d + ':' + i, start_at: d + 'T0' + (6 + i) + ':00:00' }));

    let s = searchWorld({ startDate: TODAY, days: 1, memKey: WEEK });
    await s.ctx.search();
    t.eq([s.calls, s.ctx.__fetched], [['render', 'revalidateIfStale'], false], 'Today inside the loaded week: rendered from memory, no fetch (old numbers get a silent refresh)');
    s = searchWorld({ startDate: '2026-09-18', days: 1, memKey: WEEK });
    await s.ctx.search();
    t.eq(s.ctx.__fetched, false, 'Tomorrow inside the loaded week: no fetch');
    s = searchWorld({ startDate: TODAY, days: 14, memKey: WEEK });
    await s.ctx.search();
    t.eq([s.calls, s.ctx.__fetched], [[], true], '14 days is not in the loaded week: it fetches');
    s = searchWorld({ startDate: TODAY, days: 1, memKey: WEEK });
    await s.ctx.search({ force: true });
    t.eq(s.ctx.__fetched, true, 'force always fetches');

    const cacheWeek = { key: WEEK, fetchedAt: 111, events: day(TODAY, 3).concat(day('2026-09-20', 2)), relations: {} };
    s = searchWorld({ startDate: TODAY, days: 1, cache: cacheWeek });
    await s.ctx.search();
    t.eq(s.sets, [{ key: WEEK, n: 5, fetchedAt: 111, partial: false }], 'cold launch on Today with a cached week: hydrated whole, under the CACHE key, with its own stamp');
    t.eq([s.calls, s.ctx.__fetched], [['set', 'facets', 'render', 'revalidateIfStale'], false], 'no spinner, no fetch — and a stale cache is revalidated behind the list');

    const cacheYday = { key: '2026-09-16|2026-09-23', fetchedAt: 222, events: day('2026-09-16', 4).concat(day(TODAY, 3), day('2026-09-23', 2)), relations: {} };
    s = searchWorld({ startDate: TODAY, days: 7, cache: cacheYday });
    await s.ctx.search();
    t.eq(s.sets, [{ key: WEEK, n: 5, fetchedAt: 222, partial: true }], "first open of the day: yesterday's cache shows today's range at once — gone days dropped, flagged partial");
    t.eq([s.calls, s.ctx.__fetched], [['set', 'facets', 'revalidate:silent', 'render'], false], 'the real range is fetched behind it (started BEFORE the render, so an empty filtered list reads "Checking…")');
    t.eq(s.ctx.window._windowHeldEnd, '2026-09-23', "…and the last day the cache really held is recorded: the key now claims a day nobody loaded");
    const setSrc = appSrc.slice(appSrc.indexOf('function _setWindow('), appSrc.indexOf('function _persistWindow('));
    t.ok(/window\._windowHeldEnd = null;/.test(setSrc), 'every other commit (_setWindow) clears it — a fetched window holds what its key says');
    t.ok(/window\._windowLoadError = null;/.test(setSrc), '…and the last failure\'s reason with it');
    const overlapSrc = appSrc.slice(appSrc.indexOf("if (plan === 'overlap') {", sStart), sEnd);
    t.ok(!/_persistWindow\(/.test(overlapSrc), 'a provisional window is never persisted');

    s = searchWorld({ startDate: TODAY, days: 7, cache: { key: '2026-09-16|2026-09-23', fetchedAt: 1, events: day('2026-09-16', 4), relations: {} } });
    await s.ctx.search();
    t.eq([s.sets.length, s.ctx.__fetched], [0, true], 'a cache with nothing left in range is not adopted: normal fetch');
    s = searchWorld({ startDate: TODAY, days: 7, cache: { key: '2026-09-01|2026-09-08', fetchedAt: 1, events: day('2026-09-02', 4), relations: {} } });
    await s.ctx.search();
    t.eq([s.sets.length, s.ctx.__fetched], [0, true], 'an old cache that does not reach today: normal fetch');

    // Wave-1 leftover: a tap while /locations is still loading.
    s = searchWorld({ startDate: TODAY, days: 7, locations: [] });
    await s.ctx.search();
    t.ok(s.ctx.__fetched === false && /spinner/.test(s.status || '') && !/no classes/i.test(s.status || ''), 'no studios yet: a loading line, never "No classes found"');
    t.eq(s.ctx._loadableSearchStarted, false, 'and the launch search still runs afterwards');
    s = searchWorld({ startDate: TODAY, days: 7, locations: [], refFailed: 'x' });
    await s.ctx.search();
    t.eq([s.calls, s.status], [['initError'], null], 'reference data FAILED: the reload prompt again, not a spinner that never ends');

    // A window with studios missing must not become tomorrow's cache.
    const tail = appSrc.slice(sEnd, appSrc.indexOf('// Friendly search-failure handling.'));
    t.ok(/if \(!studiosFailed\) _persistWindow\(windowKey, allEvents, relations\);/.test(tail), 'search(): a window with failed studios is shown but not persisted');
    t.ok(/_setWindow\(windowKey, allEvents, relations, 0, studiosFailed > 0\);/.test(tail), 'search(): …and is committed PARTIAL — never fresh, so the in-week date taps it now covers refetch the missing studio (it stayed missing for 15 minutes)');
    t.ok(/if \(studiosFailed\) _revalFailedAt = Date\.now\(\);/.test(tail), 'search(): that quiet refetch waits out the failed-refresh back-off first');
    const commit = tail.slice(tail.indexOf('_setWindow(windowKey'), tail.indexOf('_buildFacetClasses(allEvents'));
    t.ok(/_windowRenderedAt = Date\.now\(\);\s*render\(allEvents, relations, filters, true\);/.test(commit), "search(): its own render stamps _windowRenderedAt first, like renderFromWindow (unstamped, the first resume rebuilt the list with nothing started)");
    t.ok(tail.indexOf("removeAttribute('data-quiet')") !== -1 && tail.indexOf("removeAttribute('data-quiet')") < tail.indexOf("setStatus('<span class=\"spinner\"></span>Connecting…')"), 'search(): a fetched list animates in — the quiet flag of an earlier background re-render is taken off first');
    t.ok(/throw firstErr \|\| new Error\('All studios failed to load'\)/.test(tail), 'search(): "all studios failed" rethrows the real cause (so it can be classified)');
    t.ok(!/tap Search to retry/.test(appSrc) && !/Check the console for details/.test(appSrc), 'no copy points at a Search button or the console any more');
  }

  // ── Roll-forward wiring ──────────────────────────────────────────────────
  t.section('Window: the date row rolls forward once per new day');
  const rfStart = appSrc.indexOf('let _discoverDay = localDateStr();');
  const rfEnd = appSrc.indexOf('// Back in the foreground', rfStart);
  t.ok(rfStart !== -1 && rfEnd > rfStart, '_rollDiscoverForward can be sliced (anchors moved? update tests/suites/window.js)');
  if (rfStart !== -1 && rfEnd > rfStart) {
    const r = { today: YDAY, applied: [] };
    const inputs = { startDate: { value: YDAY }, daysAhead: { value: '1' } };
    const ctx = t.loadPure('js/app.js', 'window', {
      _dateModeWindow: F._dateModeWindow,
      localDateStr: () => r.today,
      document: { getElementById: (id) => inputs[id] || null },
      setDateQuick: (mode) => { r.applied.push(mode); r.reentered = ctx._rollDiscoverForward(); },
    });
    t.vm.runInContext("var _dateQuickMode = 'today';\n" + appSrc.slice(rfStart, rfEnd), ctx, { filename: 'js/app.js[roll-forward]' });
    t.eq([ctx._rollDiscoverForward(), r.applied], [false, []], 'same day: nothing happens');
    r.today = TODAY; // overnight
    t.eq([ctx._rollDiscoverForward(), r.applied], [true, ['today']], 'next morning: "Today" is re-applied through setDateQuick (which saves and searches)');
    t.eq(r.reentered, false, 'setDateQuick → triggerAutoSearch comes straight back in: no second roll, no loop');
    t.eq([ctx._rollDiscoverForward(), r.applied.length], [false, 1], 'and only once for that day');
    // The Monday reminder's "Next week" is on screen (window._dateRowHeld): it
    // rolls like any preset, but NOT through the name saveFilters wraps — an app
    // left warm overnight saved it as the launch default with no tap at all.
    const h = { today: YDAY, applied: [] };
    const nw = F._dateModeWindow('nextweek', YDAY);
    const held = { startDate: { value: nw.startDate }, daysAhead: { value: String(nw.daysAhead) } };
    const hctx = t.loadPure('js/app.js', 'window', {
      _dateModeWindow: F._dateModeWindow,
      localDateStr: () => h.today,
      document: { getElementById: (id) => held[id] || null },
      setDateQuick: (mode) => h.applied.push('saved:' + mode),
      _applyDateQuick: (mode) => h.applied.push('unsaved:' + mode),
    });
    hctx.window = hctx;
    hctx._dateRowHeld = true;
    t.vm.runInContext("var _dateQuickMode = 'nextweek';\n" + appSrc.slice(rfStart, rfEnd), hctx, { filename: 'js/app.js[roll-forward, held]' });
    h.today = TODAY;
    t.eq([hctx._rollDiscoverForward(), h.applied], [true, ['unsaved:nextweek']], 'the reminder\'s "Next week" rolls through _applyDateQuick: re-derived and searched, never saved');
    hctx._dateRowHeld = false;
    h.today = '2026-09-18';
    t.eq([hctx._rollDiscoverForward(), h.applied], [true, ['unsaved:nextweek', 'saved:nextweek']], '…and once the row is the member\'s own again, it is setDateQuick as before');
    const trigEnd = appSrc.indexOf('// ── pure:filter-summary:start');
    t.ok(trigEnd > appSrc.indexOf('function triggerAutoSearch() {'), 'triggerAutoSearch can be sliced (it ends where the filter summary begins — anchor moved? update tests/suites/window.js)');
    const trig = appSrc.slice(appSrc.indexOf('function triggerAutoSearch() {'), trigEnd);
    t.ok(trig.indexOf('if (_rollDiscoverForward()) return;') !== -1 && trig.indexOf('_rollDiscoverForward()') < trig.indexOf('_windowCovers('), 'triggerAutoSearch rolls the day before it trusts the loaded window');
    const vis = appSrc.slice(rfEnd, appSrc.indexOf('// ── "Last updated"'));
    t.ok(/addEventListener\('visibilitychange'/.test(vis) && vis.indexOf('_rollDiscoverForward()') < vis.indexOf('_revalidateIfStale()'), 'Discover has its own resume hook: roll first, then refresh old numbers');

    // The resume hook itself, with everything it calls recorded.
    const resumeWorld = (o) => {
      const rw = { calls: [], timers: [], busy: !!o.busy, hidden: false };
      const c = t.loadPure('js/app.js', 'window', {
        _dateModeWindow: F._dateModeWindow,
        setTimeout: (fn) => { rw.timers.push(fn); return rw.timers.length; }, clearTimeout() {},
        document: { get hidden() { return rw.hidden; }, addEventListener() {} },
        getBearerToken: () => (o.signedOut ? '' : 'tok'),
        _discoverBusy: () => rw.busy,
        _rollDiscoverForward: () => { rw.calls.push('roll'); return !!o.rolls; },
        currentWindowDates: () => ({ startDate: TODAY, endDateStr: TODAY }),
        _windowCovers: () => o.covered !== false,
        renderLastUpdated: () => rw.calls.push('label'),
        _renderWindowInPlace: () => rw.calls.push('render'),
        _revalidateIfStale: () => rw.calls.push('revalidateIfStale'),
        window: { _windowEvents: o.events || [] },
        _windowRenderedAt: o.renderedAt || 0,
      });
      t.vm.runInContext(vis, c, { filename: 'js/app.js[resume]' });
      rw.ctx = c;
      return rw;
    };
    let rw = resumeWorld({ rolls: true });
    rw.ctx._discoverResumed();
    t.eq(rw.calls, ['roll'], 'a new day: the roll searches by itself, nothing else runs');
    rw = resumeWorld({ events: [{ start_at: '2026-09-17T07:00:00' }], renderedAt: new Date(2026, 8, 17, 6, 0).getTime() });
    rw.ctx._discoverResumed();
    t.eq(rw.calls, ['roll', 'label', 'render', 'revalidateIfStale'], 'same day, a class started meanwhile: label ticks, the list drops it, old numbers are refreshed');
    rw = resumeWorld({ events: [{ start_at: '2099-01-01T07:00:00' }], renderedAt: Date.now() });
    rw.ctx._discoverResumed();
    t.eq(rw.calls, ['roll', 'label', 'revalidateIfStale'], 'nothing started: no rebuild (the list does not flicker on every app switch)');
    rw = resumeWorld({ covered: false });
    rw.ctx._discoverResumed();
    t.eq(rw.calls, ['roll'], 'no window for this view: nothing to refresh');
    rw = resumeWorld({ signedOut: true });
    rw.ctx._discoverResumed();
    t.eq(rw.calls, [], 'signed out: inert');
    rw = resumeWorld({ busy: true, rolls: true });
    rw.ctx._discoverResumed();
    t.eq([rw.calls, rw.timers.length], [[], 1], 'a booking is in progress (picker open overnight): the dates are NOT moved under it — a retry is armed');
    rw.busy = false;
    rw.timers[0]();
    t.eq(rw.calls, ['roll'], 'once the flow ends the roll happens');
  }

  // ── Empty-state context (#90) ────────────────────────────────────────────
  t.section('Discover: why the list is empty, and the ways out');
  const ecStart = appSrc.indexOf('function _discoverEmptyContext() {');
  const ecEnd = appSrc.indexOf('function mergeRelations(', ecStart);
  t.ok(ecStart !== -1 && ecEnd > ecStart, '_discoverEmptyContext can be sliced (anchors moved? update tests/suites/window.js)');
  if (ecStart !== -1 && ecEnd > ecStart) {
    const emptyCtx = (o) => {
      const c = t.vm.createContext({
        window: { _windowPartial: !!o.partial, _windowHeldEnd: o.heldEnd || null, _windowLoadError: o.loadError || null, _discoverQuery: o.query || '' },
        currentWindowDates: () => ({ startDate: o.start || TODAY, endDateStr: o.end || o.start || TODAY }),
        localDateStr: () => TODAY,
        selectedInstructors: new Set(o.instructors || []), selectedLocations: new Set(o.locations || []), selectedCategories: new Set(o.categories || []),
      });
      t.vm.runInContext('var _revalInFlight = ' + (o.revalidating ? '{}' : 'null') + ', _loadableSearchStarted = ' + (o.searched === false ? 'false' : 'true') +
        ', _dateQuickMode = ' + JSON.stringify(o.mode === undefined ? null : o.mode) + ';\n' + appSrc.slice(ecStart, ecEnd), c, { filename: 'js/app.js[empty context]' });
      return c._discoverEmptyContext();
    };
    t.eq(emptyCtx({ mode: 'today' }).actions, ['tomorrow', 'week'], 'Today has run dry, no filters: Tomorrow / Next 7 days');
    t.eq(emptyCtx({ mode: 'today' }).title, 'No more classes today', '…and it says so, instead of blaming filters that are not set');
    t.eq(emptyCtx({ mode: 'today', locations: ['3'] }).actions, ['clear'], 'filters set: one Clear filters');
    t.eq(emptyCtx({ mode: 'week', end: '2026-09-24', query: 'spin' }).actions, ['clear'], 'a text search counts as a filter');
    t.eq(emptyCtx({ mode: null, start: '2026-10-20' }).actions, ['week'], 'an empty picked day: back to the week');
    t.eq(emptyCtx({ mode: 'week', end: '2026-09-24' }).actions, [], 'already on the unfiltered week: no button that would do nothing');
    t.eq(emptyCtx({ mode: 'today', partial: true, revalidating: true }), { loading: true }, 'a provisional window still loading its missing days: "Checking…", never "No classes"');
    t.eq(emptyCtx({ mode: 'today', partial: true, revalidating: false }).title, 'No more classes today', 'the refresh is over (or never started): the honest empty state');
    t.eq(emptyCtx({ mode: 'today', searched: false }), null, "before the first real search (last session's list repainted at launch): the plain copy, no claim about today");
    // A provisional window whose fetch is over (failed, or never ran — offline):
    // the days past what the adopted cache held were never loaded.
    const unchecked = emptyCtx({ mode: null, start: '2026-09-24', partial: true, heldEnd: '2026-09-23' });
    t.eq([unchecked.title, unchecked.actions], ["Couldn't check these dates", ['retry']], 'a day the cache never held: "Couldn\'t check", with a retry — never "There are no classes"');
    t.eq(emptyCtx({ mode: 'week', end: '2026-09-24', partial: true, heldEnd: '2026-09-23', locations: ['3'] }).actions, ['retry'], '…filters or not: "nothing matches" would be a guess as well');
    t.ok(/[Cc]heck your connection/.test(unchecked.sub), 'a fetch that never ran (offline) keeps the connection copy');
    t.eq(emptyCtx({ mode: null, start: '2026-09-24', partial: true, heldEnd: '2026-09-23', loadError: "Psycle is having trouble right now. Try again shortly." }).sub,
      "Psycle is having trouble right now. Try again shortly.", "a load that failed says the server's reason — a 503 is not the member's connection");
    t.eq(emptyCtx({ mode: 'today', partial: true, heldEnd: '2026-09-23' }).title, 'No more classes today', 'a day the cache DID hold keeps its copy (Today run dry)');
    t.eq(emptyCtx({ mode: null, start: '2026-09-24', partial: true, heldEnd: '2026-09-23', revalidating: true }), { loading: true }, 'while the fetch is still running it is "Checking…"');
    t.eq(emptyCtx({ mode: null, start: '2026-09-24', partial: true }).actions, ['week'], 'a search that lost a studio (partial, nothing adopted) makes no such claim');
    t.eq(emptyCtx({ mode: null, start: '2026-09-24', heldEnd: '2026-09-23' }).actions, ['week'], 'and a complete window never does');
  }

  // ── categorizeError (#84) ────────────────────────────────────────────────
  t.section('PsycleAPI.categorizeError: errors search() actually throws (js/api-client.js)');
  const apiBox = { navigator: { onLine: true }, console };
  apiBox.window = apiBox;
  t.vm.createContext(apiBox);
  t.vm.runInContext(t.readSource('js/api-client.js'), apiBox, { filename: 'js/api-client.js' });
  const cat = (x) => apiBox.PsycleAPI.categorizeError(x).type;
  t.eq(cat(new Error('HTTP 503')), 'server', "Error('HTTP 503') → server (was unknown: the last-results fallback never ran)");
  t.eq(cat(new Error('HTTP 500')), 'server', "Error('HTTP 500') → server");
  t.eq(cat(new Error('HTTP 401')), 'auth', "Error('HTTP 401') → auth");
  t.eq(cat(new Error('HTTP 429')), 'rate-limit', "Error('HTTP 429') → rate-limit");
  t.eq(cat(new Error('HTTP 404')), 'unknown', "Error('HTTP 404') → unknown (a client error is not an outage)");
  t.eq(cat('HTTP 502'), 'server', 'a bare string works too');
  t.eq(cat(new Error('All studios failed to load')), 'unknown', 'the generic message is NOT treated as offline (it also wraps 401 / 429 / 5xx) — search() rethrows the real cause instead');
  t.eq(cat(new Error('HTTP 5030')), 'unknown', 'only a three-digit status counts');
  t.eq(cat(new Error('Request timed out')), 'timeout', 'the fetch timeout still classifies');
  t.eq(cat(new TypeError('Load failed')), 'network', "WebKit's TypeError('Load failed') → network");

  // ── Pull-to-refresh + empty state wiring ─────────────────────────────────
  t.section('Discover: pull-to-refresh and the empty state have something to do');
  const intSrc = t.readSource('js/interactions.js');
  const pull = intSrc.slice(intSrc.indexOf('function pullRefreshAction() {'), intSrc.indexOf('// At <=640px the body is overflow:hidden'));
  t.ok(/tabId === 'tab-discover'[\s\S]*return refreshWindow\(\);/.test(pull), 'a pull on Discover returns refreshWindow() — its promise resolves the indicator');
  // Wave 2: signed out, Discover's public window stays in memory. The pull sent
  // nothing (revalidateWindow needs a token) but refreshWindow()'s promise is
  // truthy, so the pill said "Refreshing..." for ~400ms over a no-op.
  const pullWorld = (o) => {
    const pw = { refreshed: 0, fetched: 0 };
    const c = t.vm.createContext({
      document: { querySelector: () => ({ id: o.tab || 'tab-discover' }) },
      window: { _windowEvents: o.noWindow ? null : [] },
      refreshWindow: () => { pw.refreshed++; return Promise.resolve(); },
      fetchMyBookings: () => { pw.fetched++; return Promise.resolve(); },
      getBearerToken: () => (o.signedOut ? '' : 'tok'),
    });
    t.vm.runInContext(pull, c, { filename: 'js/interactions.js[pullRefreshAction]' });
    pw.result = c.pullRefreshAction();
    return pw;
  };
  let pulled = pullWorld({});
  t.ok(pulled.result && typeof pulled.result.then === 'function' && pulled.refreshed === 1, 'signed in over a loaded window: the pull refreshes, and hands back the promise');
  pulled = pullWorld({ signedOut: true });
  t.eq([pulled.result, pulled.refreshed], [null, 0], 'signed out over the public window: nothing to do, so the pill resets at once (it showed "Refreshing..." over no request)');
  pulled = pullWorld({ noWindow: true });
  t.eq([pulled.result, pulled.refreshed], [null, 0], 'before a first load: nothing to refresh');
  // My Bookings with the session expired: the list is kept on purpose, and
  // fetchMyBookings' no-token branch would empty it (the next foreground then
  // blanked the widget and cancelled every armed class reminder).
  pulled = pullWorld({ tab: 'tab-bookings', signedOut: true });
  t.eq([pulled.result, pulled.fetched], [null, 0], 'a pull on My Bookings without a token fetches nothing — the pill just resets');
  pulled = pullWorld({ tab: 'tab-bookings' });
  t.ok(!!pulled.result && pulled.fetched === 1, '…signed in it refreshes the bookings as before');
  const themeSrc = t.readSource('js/theme.js');
  const empty = themeSrc.slice(themeSrc.indexOf('const EMPTY_STATE_ACTIONS'), themeSrc.indexOf('// ── D. Haptic Feedback'));
  t.ok(/const msg = escapeHTML\(/.test(empty) && /const sub = escapeHTML\(/.test(empty), 'renderEmptyState escapes its title and subtitle');
  t.ok(!/onclick="\$\{(?!a\.onclick\})/.test(empty), 'its onclick handlers come only from the fixed EMPTY_STATE_ACTIONS map');
  const emptySrc = appSrc.slice(appSrc.indexOf('function _discoverEmptyContext() {'), appSrc.indexOf('function mergeRelations('));
  const ids = (emptySrc.match(/actions: [^\n]*/g) || []).join(' ').match(/'[a-z]+'/g) || [];
  t.ok(ids.length >= 4 && ids.every((id) => new RegExp('\\b' + id.replace(/'/g, '') + ': \\{ label:').test(empty)), 'every action id app.js names exists in the map (' + ids.join(', ') + ')');
  t.ok(/retry: \{ label: 'Try again', onclick: 'search\(\{ force: true \}\)' \}/.test(empty), "'retry' is a forced search() (it shows the studios that answer) — not refreshWindow(), which is all-or-nothing");

  // ── Background re-renders do not replay the card entrance ────────────────
  t.section('Discover: a background re-render is quiet');
  const rfwStart = appSrc.indexOf('function renderFromWindow(filters, quiet) {');
  // Ends at the block AFTER renderFromWindow, not at the date picker: what sits
  // between them registers a PsycleEvents listener this bare context lacks.
  const rfwEnd = appSrc.indexOf('// "Available only" never hides the member\'s own class', rfwStart);
  t.ok(rfwStart !== -1 && rfwEnd > rfwStart, 'renderFromWindow can be sliced (anchors moved? update tests/suites/window.js)');
  if (rfwStart !== -1 && rfwEnd > rfwStart) {
    const paint = (o) => {
      const cont = { attrs: {}, innerHTML: o.cards ? '<cards>' : '<status>', toggleAttribute(n, on) { if (on) this.attrs[n] = ''; else delete this.attrs[n]; }, querySelector: (sel) => (sel === '.class-card' && o.cards ? {} : null) };
      if (o.wasQuiet) cont.attrs['data-quiet'] = '';
      const c = t.vm.createContext({ document: { getElementById: (id) => (id === 'results' ? cont : null) }, window: {}, render() {}, renderLastUpdated() {}, Date });
      t.vm.runInContext('var _searchSeq = 0, _windowRenderedAt = 0;\n' + appSrc.slice(rfwStart, rfwEnd), c, { filename: 'js/app.js[renderFromWindow]' });
      c.renderFromWindow({}, o.quiet);
      return ['data-quiet' in cont.attrs, cont.innerHTML];
    };
    t.eq(paint({ cards: true, quiet: true }), [true, ''], 'quiet, over cards that are already up: flagged, so the rebuilt cards do not animate in again');
    t.eq(paint({ cards: false, quiet: true }), [false, ''], 'quiet, but "Checking…" / an empty state was up: the list still gets its entrance');
    t.eq(paint({ cards: true, wasQuiet: true }), [false, ''], 'a chip tap (not quiet) takes the flag off again');
    const inPlace = appSrc.slice(appSrc.indexOf('function _renderWindowInPlace(isRetry) {'), appSrc.indexOf('// The sequence number of the search()'));
    t.ok(/renderFromWindow\(currentFilters\(\), true\);/.test(inPlace), '_renderWindowInPlace (refresh landed / resume / rank changed) renders quietly');
    const tabsCss = t.readSource('css/tabs.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const quietAt = tabsCss.indexOf('#results[data-quiet] .class-card { animation: none; }');
    t.ok(quietAt !== -1 && quietAt > tabsCss.indexOf('.class-grid .class-card { animation: cardEnter'), 'css/tabs.css switches the entrance off under #results[data-quiet]');
  }

  // ── Back online ──────────────────────────────────────────────────────────
  t.section('Discover: coming back online refreshes it');
  const online = appSrc.slice(appSrc.indexOf('// Signal is back: heal an unverified session'), appSrc.indexOf('// ── Offline indicator'));
  t.ok(/else _healAuth\(\);[\s\S]*try \{ _revalFailedAt = 0; _discoverResumed\(\); \} catch \(e\) \{\}/.test(online),
    "the 'online' handler runs Discover's resume path — after the auth healing, isolated from it, and with the failed-refresh back-off cleared");

  // ── A search that died with the session ──────────────────────────────────
  t.section('Discover: the session-expired search error offers Sign in');
  const seStart = appSrc.indexOf('function showSearchError(e) {');
  const seEnd = appSrc.indexOf('// Reference data (/instructors', seStart);
  t.ok(seStart !== -1 && seEnd > seStart, 'showSearchError can be sliced (anchors moved? update tests/suites/window.js)');
  if (seStart !== -1 && seEnd > seStart) {
    const fail = (err, token, out) => {
      out = out || {};
      out.status = null;
      out.window = { PsycleAPI: apiBox.PsycleAPI };
      const c = t.vm.createContext({
        window: out.window, getBearerToken: () => token,
        sessionStorage: { getItem: () => null }, restoreLastResults: () => false,
        escapeHTML: (x) => String(x), setStatus: (html) => { out.status = html; }, document: { getElementById: () => null },
      });
      t.vm.runInContext(appSrc.slice(seStart, seEnd), c, { filename: 'js/app.js[showSearchError]' });
      c.showSearchError(err);
      return out.status;
    };
    let html = fail(new Error('HTTP 401'), ''); // apiFetch → showSessionExpired has cleared the token
    t.ok(/onclick="openLoginPopup\(\)"/.test(html) && />Sign in</.test(html) && !/search\(/.test(html), '401 with the token gone: "Sign in" — "Try again" re-sent the request unauthenticated and came straight back');
    html = fail(new Error('HTTP 403'), 'tok');
    t.ok(/onclick="search\(\{ force: true \}\)"/.test(html) && !/openLoginPopup/.test(html), '403 also classifies as auth, but the session is alive: still "Try again"');
    const seen = {};
    html = fail(new Error('HTTP 503'), 'tok', seen);
    // Wave 2: over a provisional window (today's key, yesterday's days) a plain
    // search() is "covered" — the tap re-rendered the held days, sent nothing,
    // and the 503 copy became "check your connection".
    t.ok(/onclick="search\(\{ force: true \}\)"/.test(html) && !/onclick="search\(\)"/.test(html), 'anything else: "Try again" is a FORCED search — it always sends the request again');
    t.ok(/retry\.onclick = \(\) => search\(\{ force: true \}\);/.test(appSrc.slice(seStart, seEnd)), "…and so is the one on the last-results banner");
    t.eq(seen.window._windowLoadError, "Psycle is having trouble right now. Try again shortly.", 'the classified reason is kept for the "Couldn\'t check these dates" state');
    fail(new Error('HTTP 404'), 'tok', seen);
    t.eq(seen.window._windowLoadError, undefined, 'a failure nobody can name records nothing (the connection copy stands)');
    fail(new Error('HTTP 401'), '', seen);
    t.eq(seen.window._windowLoadError, undefined, "nor does a dead session: its banner says so, and the copy would outlive the re-login");
    const authChanged = appSrc.slice(appSrc.indexOf("PsycleEvents.on('auth:changed', s => {\n    // (Discover's presets"), appSrc.indexOf('// Hero for a tab that looks signed out'));
    t.ok(/!window\._windowEvents \|\| document\.querySelector\('#results \.status-error'\)/.test(authChanged), 'after the re-login the failed search runs again, although an earlier window is still loaded (the error would stay up with no retry)');
  }
};
