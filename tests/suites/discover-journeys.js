'use strict';
// Discover journeys (wave 6): the Monday-noon release (freshness, the release
// timer, the 'Next week' preset, the reminder-tap hook), the focused "find it"
// searches, and the instructor suggestions' move to Stats. The runner's zone is
// America/New_York on purpose: every release instant below is asserted in UTC,
// so an answer that leaned on the device zone would be hours out.
module.exports = async function (t) {
  const appSrc = t.readSource('js/app.js');
  const G = t.loadPure('js/app.js', 'gym-time');
  const F = t.loadPure('js/app.js', 'filters');
  const W = t.loadPure('js/app.js', 'window', { _dateModeWindow: F._dateModeWindow, _gymWallToUtcMs: G._gymWallToUtcMs });
  const utc = (y, mo, d, h, mi, s) => Date.UTC(y, mo - 1, d, h, mi || 0, s || 0);
  const iso = (ms) => (ms == null ? ms : new Date(ms).toISOString());
  const grab = (source, opener, closer) => {
    const lines = source.split('\n');
    const from = lines.findIndex((l) => l.startsWith(opener));
    const to = lines.findIndex((l, i) => i > from && l === (closer || '}'));
    if (from === -1 || to === -1) throw new Error('discover-journeys suite: cannot slice "' + opener + '" (anchor moved?)');
    return lines.slice(from, to + 1).join('\n');
  };

  // ── Release instants ─────────────────────────────────────────────────────
  t.section('Release: the latest / next Monday 12:00 Europe/London (js/app.js pure:window)');
  t.ok(['_lastReleaseMs', '_nextReleaseMs', '_weekOpensMs'].every((n) => typeof W[n] === 'function'), 'the pure:window region defines the release helpers');
  // BST: Monday noon in London is 11:00 UTC.
  t.eq(iso(W._lastReleaseMs(utc(2026, 9, 17, 15))), '2026-09-14T11:00:00.000Z', 'a Thursday in September → Monday 14th, 12:00 BST (11:00 UTC)');
  t.eq(iso(W._nextReleaseMs(utc(2026, 9, 17, 15))), '2026-09-21T11:00:00.000Z', '…and the next one is Monday 21st');
  t.eq(iso(W._lastReleaseMs(utc(2026, 9, 14, 10, 59, 59))), '2026-09-07T11:00:00.000Z', 'Monday 11:59:59 London: still LAST week\'s release');
  t.eq(iso(W._nextReleaseMs(utc(2026, 9, 14, 10, 59, 59))), '2026-09-14T11:00:00.000Z', '…this week\'s is one second away');
  t.eq(iso(W._lastReleaseMs(utc(2026, 9, 14, 11, 0, 0))), '2026-09-14T11:00:00.000Z', 'Monday 12:00:00 London: released');
  t.eq(iso(W._nextReleaseMs(utc(2026, 9, 14, 11, 0, 0))), '2026-09-21T11:00:00.000Z', '…and the next is a week on (strictly after now)');
  t.eq(iso(W._lastReleaseMs(utc(2026, 9, 13, 23, 30))), '2026-09-07T11:00:00.000Z', "Sunday 23:30 UTC is already Monday 00:30 in London — before noon, so still last week's");
  // GMT: Monday noon in London is 12:00 UTC.
  t.eq(iso(W._lastReleaseMs(utc(2026, 11, 4, 9))), '2026-11-02T12:00:00.000Z', 'a Wednesday in November → Monday 2nd, 12:00 GMT (12:00 UTC)');
  t.eq(iso(W._lastReleaseMs(utc(2026, 11, 2, 11, 30))), '2026-10-26T12:00:00.000Z', 'Monday 11:30 GMT: 11:00 UTC was noon LAST month, it is not now');
  // Across the clock changes (back on Sun 25 Oct 2026, forward on Sun 29 Mar 2026).
  t.eq(iso(W._lastReleaseMs(utc(2026, 10, 26, 11, 30))), '2026-10-19T11:00:00.000Z', 'first Monday on GMT, 11:30: the last release was the BST one a week before');
  t.eq(iso(W._nextReleaseMs(utc(2026, 10, 20, 8))), '2026-10-26T12:00:00.000Z', 'the week the clocks go back is 7 days + 1 hour long');
  t.eq(iso(W._lastReleaseMs(utc(2026, 3, 30, 10, 59, 59))), '2026-03-23T12:00:00.000Z', 'first Monday on BST, 11:59:59: last week\'s GMT release');
  t.eq(iso(W._lastReleaseMs(utc(2026, 3, 30, 11))), '2026-03-30T11:00:00.000Z', '…12:00:00 BST: released');
  t.eq([W._lastReleaseMs(NaN), W._nextReleaseMs('x')], [null, null], 'an unreadable clock → null, no throw');
  t.eq(iso(W._weekOpensMs('2026-09-28')), '2026-09-21T11:00:00.000Z', 'the week of Monday 28th opens at noon (London) on Monday 21st');
  t.eq(iso(W._weekOpensMs('2026-11-02')), '2026-10-26T12:00:00.000Z', '…across a month end and the clock change');
  t.eq([W._weekOpensMs(''), W._weekOpensMs('28/09/2026')], [null, null], 'not a date → null');
  const bare = t.loadPure('js/app.js', 'window', { _dateModeWindow: F._dateModeWindow }); // no London resolver in scope
  t.eq([bare._lastReleaseMs(utc(2026, 9, 17, 15)), bare._nextReleaseMs(utc(2026, 9, 17, 15)), bare._weekOpensMs('2026-09-28')], [null, null, null],
    'without the London resolver (or Europe/London data) every helper answers null');

  t.section('Release: a timetable fetched before it is never fresh');
  {
    const REL = utc(2026, 9, 14, 11); // Monday 12:00 BST
    const min = 60 * 1000;
    t.eq(W._windowIsFresh(REL - 2 * min, REL + 30 * 1000), false, 'loaded at 11:58, looked at 12:00:30: NOT fresh (it passed for fresh until 12:13)');
    t.eq(W._windowIsFresh(REL - 2 * min, REL), false, '…from the release instant itself (fetchedAt < release <= now)');
    t.eq(W._windowIsFresh(REL - 2 * min, REL - 1000), true, 'one second before noon the 11:58 copy is still fresh');
    t.eq(W._windowIsFresh(REL, REL + 5 * min), true, 'fetched AT the release: fresh');
    t.eq(W._windowIsFresh(REL + 10 * 1000, REL + 14 * min), true, 'fetched after it: the plain 15 minutes');
    t.eq(W._windowIsFresh(REL + 10 * 1000, REL + 16 * min), false, '…and no longer');
    t.eq(W._windowIsFresh(utc(2026, 9, 17, 14, 50), utc(2026, 9, 17, 15)), true, 'midweek nothing changes');
    t.eq(W._windowIsFresh(REL + 5 * min, REL), false, 'a stamp from the future is still not fresh');
    t.eq(bare._windowIsFresh(REL - 2 * min, REL + 30 * 1000), true, 'no London resolver: the plain 15-minute rule stands (never a throw)');
    const stale = appSrc.slice(appSrc.indexOf('function _revalidateIfStale() {'), appSrc.indexOf('// ── Discover rolls forward'));
    t.ok(/_windowIsFresh\(window\._windowFetchedAt, Date\.now\(\)\)/.test(stale), '_revalidateIfStale asks _windowIsFresh — so resume, chip taps and search() all refetch after a release by themselves');
  }

  // ── 'Next week' preset ───────────────────────────────────────────────────
  t.section("Filters: 'Next week' = the Monday–Sunday after today, from any weekday");
  {
    const days = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20']; // Mon … Sun
    t.eq(days.map((d) => F._dateModeWindow('nextweek', d).startDate), days.map(() => '2026-09-21'),
      'Monday to Sunday of one week all point at the NEXT Monday (on a Monday that is 7 days on: its own week opened a week ago)');
    const w = F._dateModeWindow('nextweek', '2026-09-17');
    t.eq(w, { startDate: '2026-09-21', daysAhead: 6, label: 'Next week' }, 'daysAhead 6 + the pill label');
    t.eq(F._windowEndDate(w.startDate, w.daysAhead, 'nextweek'), '2026-09-27', '…so the fetch window ends on that Sunday (start + daysAhead)');
    t.eq(new Date(2026, 8, 27).getDay(), 0, '(the 27th is a Sunday)');
    t.eq(F._dateModeWindow('nextweek', '2026-12-30').startDate, '2027-01-04', 'rolls over a year end');
    t.eq(F._dateModeWindow('nextweek', '2026-03-28').startDate, '2026-03-30', "across the device's and London's spring clock changes");
    t.eq(F._restoredDateState({ dateQuickMode: 'nextweek', startDate: '2026-09-07', daysAhead: '6' }, '2026-09-17'), { mode: 'nextweek', startDate: '2026-09-21', daysAhead: 6 },
      'saved filters: re-derived from today on restore (init tail, restoreFilters and saved searches all go through _restoredDateState)');
    t.eq(F._datePillState('nextweek', '2026-09-21', '6', '2026-09-17'), { label: 'Next week', picked: null }, 'lights its own pill');
    t.eq(F._datePillState('nextweek', '2026-09-21', '1', '2026-09-17'), { label: null, picked: '2026-09-21' }, 'a stale mode over one picked day lights nothing');
    t.eq(W._rollForwardMode({ mode: 'nextweek', startDate: '2026-09-21', daysAhead: '6', lastDay: '2026-09-20', today: '2026-09-21' }), 'nextweek',
      'left open from Sunday into Monday it follows the calendar (setDateQuick re-derives: the week about to open)');
    t.ok(/nextweek: 'Next week'/.test(grab(appSrc, 'function _searchLabel(')), '_searchLabel names the preset (it printed the raw start date)');
    // The Filters bar's summary used to name it too. It no longer prints a date
    // at all: the date row is always on screen, with its own pill lit.
    t.ok(!/_dateQuickMode|startDate/.test(grab(appSrc, 'function updateFiltersSummary(')), 'updateFiltersSummary prints no date — raw or named (the lit pill says it)');
    t.ok(/<button class="date-quick-btn"[^>]*onclick="setDateQuick\('nextweek'\)"[^>]*>Next week<\/button>\s*<button class="date-quick-btn"[^>]*setDateQuick\('2week'\)/.test(t.readSource('psycle-finder.html')),
      "psycle-finder.html: the 'Next week' pill sits right before '14 days'");
  }

  // ── Empty state before the release ───────────────────────────────────────
  t.section('Discover: "Next week" before Monday noon says when it opens');
  {
    const ecSrc = appSrc.slice(appSrc.indexOf('function _discoverEmptyContext() {'), appSrc.indexOf('function mergeRelations('));
    const emptyCtx = (o) => {
      class FakeDate extends Date { static now() { return o.now; } }
      const c = t.loadPure('js/app.js', 'window', {
        Date: FakeDate, _dateModeWindow: F._dateModeWindow, _gymWallToUtcMs: G._gymWallToUtcMs,
        window: { _windowPartial: false, _windowHeldEnd: null, _windowLoadError: null, _discoverQuery: '' },
        currentWindowDates: () => ({ startDate: o.start, endDateStr: o.end || o.start }),
        localDateStr: () => o.today,
        selectedInstructors: new Set(), selectedLocations: new Set(o.locations || []), selectedCategories: new Set(),
      });
      t.vm.runInContext('var _revalInFlight = null, _loadableSearchStarted = true, _dateQuickMode = ' + JSON.stringify(o.mode) + ';\n' + ecSrc, c, { filename: 'js/app.js[empty context]' });
      return c._discoverEmptyContext();
    };
    const MON = { today: '2026-09-21', start: '2026-09-28', end: '2026-10-04', mode: 'nextweek' };
    let e = emptyCtx(Object.assign({ now: utc(2026, 9, 21, 10, 59) }, MON)); // 11:59 London
    t.eq([e.title, e.actions], ['Next week opens Monday 12:00', ['week']], 'Monday 11:59: not "There are no classes" — it says when the week opens, with a way back to the 7 days');
    t.ok(/12:00 UK time/.test(e.sub), '…in UK time (the member may be abroad)');
    e = emptyCtx(Object.assign({ now: utc(2026, 9, 21, 10, 59), locations: ['3'] }, MON));
    t.eq(e.title, 'Next week opens Monday 12:00', 'filters or not: "nothing matches these filters" would be the wrong reason');
    e = emptyCtx(Object.assign({ now: utc(2026, 9, 21, 11, 0, 1) }, MON));
    t.eq([e.title, e.actions], ['No classes on these dates', ['week']], 'after noon an empty week is just empty');
    e = emptyCtx({ now: utc(2026, 9, 22, 9), today: '2026-09-22', start: '2026-09-28', end: '2026-10-04', mode: 'nextweek' });
    t.eq(e.title, 'No classes on these dates', 'Tuesday to Sunday that week has long been open');
    e = emptyCtx({ now: utc(2026, 9, 21, 9), today: '2026-09-21', start: '2026-10-07', mode: 'nextweek' });
    t.eq(e.title, 'No classes on these dates', 'a stale "nextweek" mode over a date another flow picked makes no such claim');
    // A member in Sydney: device Monday 09:00 is Sunday 23:00 UTC — noon in London is 21:00 their time.
    e = emptyCtx({ now: utc(2026, 9, 20, 23), today: '2026-09-21', start: '2026-09-28', end: '2026-10-04', mode: 'nextweek' });
    t.eq(e.title, 'Next week opens Monday 12:00', 'the release is London\'s noon wherever the device is');
  }

  // ── The release timer + the reminder-tap hook ────────────────────────────
  t.section('Release: one timer looks at noon; the Monday-reminder tap opens "Next week"');
  {
    const rStart = appSrc.indexOf('// ── Monday noon: the new booking week opens');
    const rEnd = appSrc.indexOf('async function search(opts) {');
    t.ok(rStart !== -1 && rEnd > rStart, 'the release block can be sliced (anchors moved? update tests/suites/discover-journeys.js)');
    const world = (o) => {
      o = o || {};
      const w = { timers: [], cleared: [], calls: [], handlers: {}, hidden: false, busy: false, tab: 'tab-discover', now: null, token: o.signedOut ? '' : 'tok' };
      class Clock extends Date { static now() { return w.now == null ? Date.now() : w.now; } } // movable once w.now is set
      const ctx = t.loadPure('js/app.js', 'window', {
        Date: Clock,
        _dateModeWindow: F._dateModeWindow, _gymWallToUtcMs: o.noZone ? undefined : G._gymWallToUtcMs,
        setTimeout: (fn, ms) => { w.timers.push({ fn, ms }); return w.timers.length; }, clearTimeout: (id) => { w.cleared.push(id); },
        document: {
          get hidden() { return w.hidden; },
          querySelector: (sel) => (sel === '.tab-panel.active' && w.tab ? { id: w.tab } : null),
          addEventListener: (type, fn) => { w.handlers[type] = fn; },
        },
        getBearerToken: () => w.token,
        revalidateWindow: (opts) => { w.calls.push('revalidate' + (opts && opts.silent ? ':silent' : '')); return Promise.resolve(true); },
        _revalidateIfStale: () => w.calls.push('revalidateIfStale'),
        _discoverBusy: () => w.busy,
        switchTab: (tab) => w.calls.push('tab:' + tab),
        // The hook applies the preset WITHOUT saving it: _applyDateQuick, never the
        // saveFilters-wrapped setDateQuick (a call to that one shows up as "saved:").
        _applyDateQuick: (mode) => w.calls.push('date:' + mode),
        setDateQuick: (mode) => w.calls.push('saved:' + mode),
        _revealActiveDatePill: () => {},
      });
      ctx.window = ctx;
      t.vm.runInContext('var _revalFailedAt = 0, _loadableSearchStarted = ' + (o.launched === false ? 'false' : 'true') + ';\n' + appSrc.slice(rStart, rEnd), ctx, { filename: 'js/app.js[release]' });
      w.ctx = ctx;
      return w;
    };
    let w = world();
    t.eq(w.timers.length, 1, 'loading app.js arms ONE timer');
    t.ok(w.timers[0].ms > 3000 - 1 && w.timers[0].ms <= 7 * 86400000 + 3600000 + 3000, 'for the next release (within a week and a bit — never past setTimeout\'s 24.8-day ceiling)');
    w.timers[0].fn();
    t.eq(w.calls, ['revalidateIfStale'], 'at the release the window is checked for staleness (fetched before noon → a silent refetch, in place)');
    t.eq(w.timers.map((x) => x.ms > 60 * 1000 ? 'release' : x.ms), ['release', 'release', 60000], 'the NEXT release is armed, plus one more look a minute on');
    // The first look FAILED (Monday noon is Psycle's weekly peak): its 60s
    // back-off always covers a second look scheduled 60s after the first STARTED.
    t.vm.runInContext('_revalFailedAt = Date.now();', w.ctx);
    w.timers[2].fn();
    t.eq(w.calls, ['revalidateIfStale', 'revalidate:silent'], 'that second look asks outright, silently (a fast phone clock stamped the first answer as post-release)');
    t.eq(t.vm.runInContext('_revalFailedAt', w.ctx), 0, '…with the failed first look\'s back-off cleared first — a silent revalidate honours it, so the retry never ran in the one case it exists for');

    // A DOM timer stops counting while the app is suspended and resumes with what
    // was LEFT: armed Sunday evening it fired hours after noon. Re-armed from the
    // clock on every return to the foreground.
    w = world();
    t.eq(typeof w.handlers.visibilitychange, 'function', 'the release block listens for visibilitychange');
    w.hidden = true;
    w.handlers.visibilitychange();
    t.eq([w.timers.length, w.cleared.length], [1, 1], 'going to the background arms nothing (the one clear is the load-time arm\'s own)');
    w.hidden = false;
    w.handlers.visibilitychange();
    t.eq([w.timers.length, w.cleared[w.cleared.length - 1]], [2, 1], 'back in the foreground: the stale timer is cleared and a fresh one armed from the clock');
    t.ok(w.timers[1].ms > 3000 - 1 && w.timers[1].ms <= 7 * 86400000 + 3600000 + 3000, '…for the next release');
    w = world();
    w.hidden = true;
    w.timers[0].fn();
    t.eq(w.calls, [], 'in the background nothing is fetched — the resume hook finds the window stale by itself');
    w = world({ signedOut: true });
    w.timers[0].fn();
    t.eq(w.calls, [], 'signed out: inert');
    t.eq(world({ noZone: true }).timers.length, 0, 'no London resolver: no timer at all');

    // The hook native-bridge's Monday-reminder tap calls.
    w = world();
    t.eq(typeof w.ctx._onBookingWeekOpened, 'function', 'window._onBookingWeekOpened is exported');
    w.ctx._onBookingWeekOpened();
    t.eq(w.calls, ['tab:discover', 'date:nextweek'], "app already up: Discover, then the 'Next week' preset — it searches like a pill tap, but is NOT saved: a tapped notification used to become what every later launch opened on");
    t.eq(w.ctx._dateRowHeld, true, '…nor by their next chip tap: the date row is marked as the notification\'s, which saveFilters and the overnight roll respect (tests/suites/wave7-leftovers.js, window.js)');
    t.ok(!/refreshWindow\(\)/.test(appSrc.slice(appSrc.indexOf('window._onBookingWeekOpened = function'), rEnd)), 'no explicit refresh to race that search — the freshness rule refetches a pre-release window');
    w = world({ launched: false });
    w.ctx._onBookingWeekOpened();
    t.eq([w.calls, w.timers.length, w.ctx._dateRowHeld], [[], 2, undefined], 'cold start, launch not done: NOTHING is written yet (init\'s tail and restoreFilters would each put the old preset back) — a retry is armed');
    t.vm.runInContext('_loadableSearchStarted = true;', w.ctx);
    w.timers[1].fn();
    t.eq(w.calls, ['date:nextweek'], 'once a search that could load has started (launch restored the saved date row before it), the preset is applied — with no second switchTab: the bridge put the member on Discover at the tap');
    w = world();
    w.busy = true;
    w.ctx._onBookingWeekOpened();
    t.eq(w.calls, [], 'a booking in progress: the list is not rebuilt under the open picker');
    w.busy = false;
    w.timers[w.timers.length - 1].fn();
    t.eq(w.calls, ['date:nextweek'], '…it happens when the flow ends');
    // The member moved on while it waited ("View my bookings" on the dialog that
    // held it up): a retry must not yank them back and rewrite the date row.
    w = world();
    w.busy = true;
    w.ctx._onBookingWeekOpened();
    w.busy = false;
    w.tab = 'tab-bookings';
    w.timers[w.timers.length - 1].fn();
    t.eq([w.calls, w.timers.length], [[], 2], 'the member is on My Bookings by the retry: nothing happens, and no further retry is armed');
    // Timers freeze in a suspended app: the poll counted tries, not the clock.
    w = world();
    w.now = Date.UTC(2026, 8, 21, 11, 0, 0);
    w.busy = true;
    w.ctx._onBookingWeekOpened();
    w.now += 10000;
    w.timers[w.timers.length - 1].fn();
    t.eq(w.timers.length, 3, '10s after the tap, still busy: it keeps waiting');
    w.busy = false;
    w.now += 3 * 3600000; // phone locked, reopened hours later
    w.timers[w.timers.length - 1].fn();
    t.eq([w.calls, w.timers.length], [[], 3], 'a poll that wakes hours after the tap gives up by the clock (it used to switch tab and preset at +180 min)');
    w.ctx._onBookingWeekOpened();
    t.eq(w.calls, ['tab:discover', 'date:nextweek'], '…while a NEW tap starts afresh');
    w = world({ launched: false });
    w.ctx._onBookingWeekOpened();
    for (let i = 0; i < 200 && w.timers.length > 1 + i; i++) w.timers[1 + i].fn();
    t.eq([w.calls, w.timers.length], [[], 121], 'signed out / reference data that never loads: it gives up after a bounded number of retries');
  }

  // ── _focusSearch: what each caller ends up with ──────────────────────────
  t.section('Focused searches: every "find it" shortcut starts from a clean slate');
  {
    const TODAY = (() => { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); })();
    const focusWorld = (o) => {
      o = o || {};
      const w = { calls: [], toasts: [] };
      w.inputs = { startDate: { value: o.startDate || TODAY }, daysAhead: { value: o.daysAhead || '7' }, instrSearch: { value: 'ali' } };
      const ctx = t.vm.createContext({
        window: { _discoverQuery: 'spin' },
        document: { getElementById: (id) => w.inputs[id] || null },
        selectedInstructors: new Set(['99']), selectedLocations: new Set(['5']), selectedCategories: new Set(['RIDE']),
        selectedStrengthSubs: new Set(['UPPER']), selectedReformerSubs: new Set(['SIGNATURE']),
        selectedTimeBands: new Set(o.timeBands || []),
        localDateStr: (d) => { d = d || new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); },
        _dateModeWindow: F._dateModeWindow,
        _syncFilterUI: () => w.calls.push('syncUI'), switchTab: (tab) => w.calls.push('tab:' + tab), search: () => w.calls.push('search'),
        toast: (msg) => w.toasts.push(msg),
      });
      t.vm.runInContext("var _availableOnly = " + (o.availableOnly ? 'true' : 'false') + ", _dateQuickMode = " + JSON.stringify(o.mode === undefined ? 'today' : o.mode) + ";\n" + grab(appSrc, 'const CATEGORY_MAP = [', '];') + '\n' +
        grab(appSrc, 'function getCategory(') + '\n' + grab(appSrc, 'const REFORMER_SUBS = [', '];') + '\n' + grab(appSrc, 'function _focusSearch(') + '\n' +
        grab(appSrc, 'function bookPrediction('), ctx, { filename: 'js/app.js[_focusSearch]' });
      w.ctx = ctx;
      // (t.eq compares JSON: keep this key order in step with the expectations below.)
      w.state = () => ({
        instr: [...ctx.selectedInstructors], locs: [...ctx.selectedLocations], cats: [...ctx.selectedCategories],
        date: [w.inputs.startDate.value, Number(w.inputs.daysAhead.value), ctx._dateQuickMode],
        typed: w.inputs.instrSearch.value, query: ctx.window._discoverQuery,
        subs: [...ctx.selectedStrengthSubs].length + [...ctx.selectedReformerSubs].length,
      });
      return w;
    };
    const clean = { typed: '', query: '', subs: 5 };

    // View schedule / View classes: features.js → _focusSearch({ instructorId }).
    let w = focusWorld({ startDate: TODAY, daysAhead: '1', mode: 'today' });
    w.ctx._focusSearch({ instructorId: '31' });
    t.eq(w.state(), Object.assign({ instr: ['31'], locs: [], cats: [], date: [TODAY, 6, 'week'] }, clean),
      'View schedule from a "Today" date row: that instructor alone, and the week (one instructor on one arbitrary day is mostly an empty list)');
    t.eq(w.calls, ['syncUI', 'tab:discover', 'search'], 'UI re-synced, Discover shown, THEN the search');
    w = focusWorld({ startDate: TODAY, daysAhead: '13', mode: '2week' });
    w.ctx._focusSearch({ instructorId: 31 });
    t.eq(w.state().date, [TODAY, 13, '2week'], 'a multi-day range the member chose is kept (the modal listed classes from it)');
    w = focusWorld({ startDate: '2026-01-05', daysAhead: '6', mode: 'week' });
    w.ctx._focusSearch({ instructorId: 31 });
    t.eq(w.state().date, [TODAY, 6, 'week'], 'a range that has already gone (app left open) falls back to the week');

    // Stats "Find this week": tabs.js → { categoryKey, startDate, daysAhead: 1 }.
    w = focusWorld();
    w.ctx._focusSearch({ categoryKey: 'STRENGTH', startDate: '2099-03-03', daysAhead: 1 });
    t.eq(w.state(), Object.assign({ instr: [], locs: [], cats: ['STRENGTH'], date: ['2099-03-03', 1, null] }, clean),
      'habit "Find this week": that day and that class type — no instructor, no studio, no preset mode for a picked day');
    w = focusWorld();
    w.ctx._focusSearch({ categoryKey: '', startDate: '2099-03-03' });
    t.eq([w.state().cats, w.state().date], [[], ['2099-03-03', 1, null]], 'no category known → none; daysAhead defaults to the one day');
    w = focusWorld();
    w.ctx._focusSearch({ typeName: 'Sound Bath', startDate: '2099-03-03' });
    t.eq(w.state().cats, [], "a type only the catch-all 'OTHER' matches filters nothing");
    w = focusWorld();
    w.ctx._focusSearch({ mode: 'nextweek' });
    t.eq(w.state().date.slice(1), [6, 'nextweek'], 'a preset mode is applied as the preset');
    w = focusWorld();
    w.ctx._focusSearch({ mode: 'constructor', startDate: 'garbage' });
    t.eq(w.state().date, [TODAY, 7, 'today'], 'junk dates change nothing about a range that is fine (no throw)');

    // Book again: bookPrediction → the instructor on that day, anywhere.
    w = focusWorld();
    w.ctx.bookPrediction({ instructorId: 31, typeName: 'RIDE 45', label: 'RIDE 45 · Alice', daysUntil: 5 });
    let s = w.state();
    t.eq([s.instr, s.locs, s.cats, s.date[1], s.date[2]], [['31'], [], [], 1, null], 'Book again: that instructor, ANY studio (a studio filter hid the class the hint names), one day');
    t.ok(s.date[0] > TODAY && w.toasts.length === 1 && /^Showing RIDE 45 · Alice for /.test(w.toasts[0]), '…five days on, and the toast says so');
    w = focusWorld();
    w.ctx.bookPrediction({ instructorId: null, typeName: 'RIDE 45', label: 'RIDE 45', daysUntil: 2 });
    s = w.state();
    t.eq([s.instr, s.cats], [[], ['RIDE']], 'nobody to narrow by (a name /instructors no longer lists): the class type instead of a whole day of everything');
    w.ctx.bookPrediction(null);
    t.eq(w.calls.filter((c) => c === 'search').length, 1, 'no prediction: nothing happens');

    // The Time row is a filter like the rest. "After 5" saved + "Book again —
    // Tuesdays at 07:00": her 18:30 stayed listed, the 7:00 did not, and a list
    // that is not EMPTY never draws the "Show all times" rescue.
    const timeRow = (x) => [[...x.ctx.selectedTimeBands], t.vm.runInContext('_availableOnly', x.ctx)];
    w = focusWorld({ timeBands: ['evening'], availableOnly: true });
    w.ctx.bookPrediction({ instructorId: 31, typeName: 'RIDE 45', label: 'RIDE 45 · Alice', daysUntil: 5 });
    t.eq(timeRow(w), [[], false], 'Book again: the Time row and "Available only" are lifted (they hid the very class the hint names — full-but-waitlistable included)');
    t.ok(w.calls.indexOf('syncUI') !== -1 && w.calls.indexOf('syncUI') < w.calls.indexOf('search'), '…before the pills are re-synced and the search runs');
    w = focusWorld({ timeBands: ['evening'], availableOnly: true });
    w.ctx._focusSearch({ instructorId: '31' });
    t.eq(timeRow(w), [[], false], 'View schedule / "Same instructor, any time": any time means any time');
    w = focusWorld({ timeBands: ['evening'], availableOnly: true });
    w.ctx._focusSearch({ categoryKey: 'RIDE', startDate: '2099-03-03', daysAhead: 1 });
    t.eq(timeRow(w), [[], false], 'habit "Find this week" (a ~07:00 slot): the same');
    w = focusWorld({ timeBands: ['early', 'evening'], availableOnly: true });
    w.ctx._focusSearch({ locationId: '2', typeName: 'Ride 45', startDate: '2099-03-03', daysAhead: 1, keepTimeRow: true });
    t.eq(timeRow(w), [['early', 'evening'], false], 'keepTimeRow ("Same time, any instructor" has just admitted the class\'s band): the bands stay; "Available only" still goes');

    const findSimilar = grab(appSrc, 'window.findSimilar = function(eventId) {', '};');
    t.eq((findSimilar.match(/_focusSearch\(\{/g) || []).length, 2, 'findSimilar\'s same-instructor and same-time branches both go through it (tests/suites/bookings-card.js runs them)');
    t.ok(!/saveFilters/.test(grab(appSrc, 'function _focusSearch(').replace(/\/\/.*$/gm, '')), 'it never saves the filters');
  }

  // ── "Not saved" has to survive the member's next tap ─────────────────────
  t.section('Focused searches: the next tap does not save the shortcut\'s filters over the member\'s own');
  {
    const intSrc = t.readSource('js/interactions.js');
    const saveSrc = intSrc.slice(intSrc.indexOf('  function saveFilters() {'), intSrc.indexOf('  function restoreFilters() {'));
    const stashWorld = () => {
      const w = { calls: [], saved: null };
      const inputs = { startDate: { value: '2099-03-03' }, daysAhead: { value: '7' }, instrSearch: { value: '' } };
      const ctx = t.vm.createContext({
        JSON, Array, String, Set,
        window: {},
        FILTERS_KEY: 'psycle_saved_filters',
        localStorage: { getItem: () => null, setItem: (k, v) => { w.saved = JSON.parse(v); } },
        document: { getElementById: (id) => inputs[id] || null },
        // Home studio 5 + Ride, "After 5", Available only — what psycle_saved_filters holds.
        selectedInstructors: new Set(), selectedLocations: new Set(['5']), selectedCategories: new Set(['RIDE']),
        selectedStrengthSubs: new Set(['UPPER']), selectedReformerSubs: new Set(['SIGNATURE']), selectedTimeBands: new Set(['evening']),
        localDateStr: () => '2099-03-01', _dateModeWindow: F._dateModeWindow,
        _syncFilterUI: () => w.calls.push('syncUI'), switchTab() {}, search() {},
        renderInstrChips() {}, renderTimePills() {}, renderStrengthSubPills() {}, renderReformerSubPills() {},
        refreshFacetCounts: () => w.calls.push('facets'), triggerAutoSearch: () => w.calls.push('auto'),
      });
      ctx.window = ctx; // as in the page: app.js's globals ARE window's
      t.vm.runInContext("var _availableOnly = true, _dateQuickMode = 'week';\n" + grab(appSrc, 'const CATEGORY_MAP = [', '];') + '\n' + grab(appSrc, 'function getCategory(') + '\n' +
        grab(appSrc, 'const REFORMER_SUBS = [', '];') + '\n' + grab(appSrc, 'const FOCUS_STASH_DIMS = {', '};') + '\n' + grab(appSrc, 'function _dropFocusStash(') + '\n' +
        grab(appSrc, 'function _restoreFocusStash(') + '\n' + grab(appSrc, 'function _focusSearch(') + '\n' + grab(appSrc, 'function removeInstructor(') + '\n' +
        grab(appSrc, 'function toggleLocation(') + '\n' + grab(appSrc, 'function toggleCategory(') + '\n' + grab(appSrc, 'function toggleTimeBand(') + '\n' + saveSrc,
        ctx, { filename: 'js/app.js + interactions.js[focus stash]' });
      w.ctx = ctx;
      // interactions.js wraps these with saveFilters: the tap, then the save.
      w.tap = (fn, ...args) => { ctx[fn](...args); ctx.saveFilters(); return w.saved; };
      w.live = () => ({ locs: [...ctx.selectedLocations], cats: [...ctx.selectedCategories], bands: [...ctx.selectedTimeBands], avail: t.vm.runInContext('_availableOnly', ctx) });
      return w;
    };
    const HOME = { locationIds: ['5'], categories: ['RIDE'], strengthSubs: ['UPPER'], reformerSubs: ['SIGNATURE'], timeBands: ['evening'], availableOnly: true };
    const dims = (saved) => ({ locationIds: saved.locationIds, categories: saved.categories, strengthSubs: saved.strengthSubs, reformerSubs: saved.reformerSubs, timeBands: saved.timeBands, availableOnly: saved.availableOnly });

    // View schedule → × on the instructor chip (back to browsing).
    let w = stashWorld();
    w.ctx._focusSearch({ instructorId: '31' });
    t.eq(w.live(), { locs: [], cats: [], bands: [], avail: false }, '(the shortcut itself: that instructor, everything else lifted)');
    let saved = w.tap('removeInstructor', '31');
    t.eq(dims(saved), HOME, '× on the chip saves the member\'s OWN studio / class type / Time row (it persisted locationIds: [] and categories: [] — all 19 studios on every later launch)');
    t.eq([w.live(), saved.instructorIds], [{ locs: ['5'], cats: ['RIDE'], bands: ['evening'], avail: true }, []], '…and puts them back on screen: browsing again means THEIR Discover');
    t.ok(w.calls.indexOf('syncUI') !== -1 && w.calls.indexOf('syncUI') < w.calls.indexOf('facets') && w.calls.indexOf('facets') < w.calls.indexOf('auto'), '…restored BEFORE the counts and the search read the sets');
    t.eq(w.ctx._focusStash, null, 'the stash is spent');

    // Any other wrapped tap while the shortcut is up (a date pill): same save.
    w = stashWorld();
    w.ctx._focusSearch({ instructorId: '31' });
    w.ctx.saveFilters(); // setDateQuick's wrapper
    t.eq([dims(w.saved), w.saved.instructorIds], [HOME, ['31']], 'a date pill tapped while focused still saves the home filters (the instructor is the member\'s to keep or remove)');
    // A second shortcut on top must not stash the first one's filters.
    w.ctx._focusSearch({ locationId: '2', typeName: 'Strength 45', startDate: '2099-03-03', daysAhead: 1, keepTimeRow: true });
    w.ctx.saveFilters();
    t.eq(dims(w.saved), HOME, 'a second shortcut on top of the first: still the ORIGINAL filters');

    // A dimension the member changes by hand is theirs again — only that one.
    saved = w.tap('toggleLocation', '9');
    t.eq([saved.locationIds, saved.categories, saved.timeBands], [['2', '9'], ['RIDE'], ['evening']], 'a studio chip tapped by hand: the studios save live; class type and Time row are still the held ones');
    saved = w.tap('toggleCategory', 'YOGA');
    t.eq([saved.categories.slice().sort(), saved.timeBands], [['STRENGTH', 'YOGA'], ['evening']], '…then a class-type pill: class types save live too');
    saved = w.tap('toggleTimeBand', 'early');
    t.eq([saved.timeBands, saved.availableOnly], [['early'], false], '…then a Time pill: the row saves live');

    // No shortcut in play: exactly as before.
    w = stashWorld();
    saved = w.tap('toggleLocation', '9');
    t.eq([saved.locationIds, saved.categories, saved.availableOnly], [['5', '9'], ['RIDE'], true], 'without a shortcut saveFilters snapshots the live sets, as ever');
    w.ctx.selectedInstructors.add('40');
    w.tap('removeInstructor', '40');
    t.eq(w.live().locs, ['5', '9'], '…and × on an ordinary instructor chip restores nothing');

    // The flows that replace the whole filter state forget it.
    const body = (opener) => grab(appSrc, opener).replace(/\/\/.*$/gm, '');
    t.ok(/_dropFocusStash\(\);/.test(body('function clearFilters(')) && /_dropFocusStash\(\);/.test(body('function applySavedSearch(')) && /_dropFocusStash\(\);/.test(body('function clearToken(')),
      'Clear filters, a recent-search pill and sign-out drop the stash whole (cleared means cleared)');
    t.ok(/_dropFocusStash\('time'\)/.test(body('function toggleAvailableOnly(')) && /_dropFocusStash\('time'\)/.test(body('function clearTimeFilters(')), 'the other two Time-row controls release that dimension as well');
    t.ok(/typeof window !== 'undefined' && window\._focusStash/.test(saveSrc), 'saveFilters reads it behind a typeof window guard (tests/suites/discover.js runs it strict, without one)');
  }

  t.section('Focused searches: the callers in features.js / tabs.js / explore.js');
  {
    const featSrc = t.readSource('js/features.js');
    const filt = featSrc.slice(featSrc.indexOf('window._features_filterByInstructor = function (instrId) {'), featSrc.indexOf('// Expose for onclick in patched HTML'));
    t.ok(/if \(typeof window\._focusSearch === 'function'\) \{ window\._focusSearch\(\{ instructorId: sid \}\); return; \}/.test(filt),
      '_features_filterByInstructor hands over to _focusSearch behind a typeof guard (tests/suites/booking-extras.js runs both paths)');
    t.ok(/window\._features_filterByInstructor\(/.test(t.readSource('js/explore.js')), 'Explore\'s "View classes" still goes through it');

    // The REAL habit handler, sliced from tabs.js.
    const tabsSrc = t.readSource('js/tabs.js');
    const hStart = tabsSrc.indexOf('  // Delegated handler: habit "Find this week" buttons carry a safe');
    const hEnd = tabsSrc.indexOf('  // ── Streaks & milestones', hStart);
    t.ok(hStart !== -1 && hEnd > hStart, 'the habit handler can be sliced (anchors moved? update tests/suites/discover-journeys.js)');
    const habit = (o) => {
      const h = { asked: [], calls: [], handler: null };
      const inputs = { startDate: { value: '' }, daysAhead: { value: '7' } };
      const win = o.noFocus ? { _dateQuickMode: 'week' } : { _dateQuickMode: 'week', _focusSearch: (x) => h.asked.push(x) };
      const ctx = t.vm.createContext({
        window: win,
        document: { addEventListener: (type, fn) => { h.handler = fn; }, getElementById: (id) => inputs[id] || null },
        updateFiltersSummary: () => h.calls.push('summary'), switchTab: (tab) => h.calls.push('tab:' + tab), search: () => h.calls.push('search'),
      });
      t.vm.runInContext(tabsSrc.slice(hStart, hEnd), ctx, { filename: 'js/tabs.js[habit-find]' });
      const attrs = { 'data-date': o.date, 'data-cat': o.cat };
      h.handler({ target: { closest: (sel) => (sel === '.habit-find-btn' ? { getAttribute: (n) => (n in attrs ? attrs[n] : null) } : null) } });
      h.inputs = inputs;
      return h;
    };
    let h = habit({ date: '2026-09-22', cat: 'RIDE' });
    t.eq([h.asked, h.calls], [[{ categoryKey: 'RIDE', startDate: '2026-09-22', daysAhead: 1 }], []], '"Find this week": the day + the habit\'s category key, nothing else — _focusSearch does the rest');
    h = habit({ date: '2026-09-22', cat: null });
    t.eq(h.asked, [{ categoryKey: '', startDate: '2026-09-22', daysAhead: 1 }], 'no category on the button → none asked for');
    h = habit({ date: "2026-09-22');alert(1)//", cat: 'RIDE' });
    t.eq([h.asked, h.calls], [[], []], 'a date that is not a date goes nowhere');
    h = habit({ date: '2026-09-22', cat: 'RIDE', noFocus: true });
    t.eq([h.calls, h.inputs.startDate.value, h.inputs.daysAhead.value], [['summary', 'tab:discover', 'search'], '2026-09-22', 1], 'without app.js\'s helper the old one-day search still runs');
    const habitHtml = tabsSrc.slice(tabsSrc.indexOf('function renderHabitSlots() {'), hStart);
    t.ok(/data-cat="' \+ escapeHTML\(catKey\) \+ '"/.test(habitHtml) && /getCategory\(s\.type\)/.test(habitHtml) && !/data-cat="' \+ (s\.type|escapeHTML\(s\.type\))/.test(habitHtml),
      "the button carries the category KEY from app.js's fixed map (escaped) — never the API's class name");
  }

  // ── Instructor suggestions live on Stats ─────────────────────────────────
  t.section('Stats: "You might like" / "New to you" (moved from under the Discover timetable)');
  {
    const tabsSrc = t.readSource('js/tabs.js');
    const discover = tabsSrc.slice(tabsSrc.indexOf("discoverPanel.id = 'tab-discover';"), tabsSrc.indexOf('// ── My Bookings tab'));
    t.ok(!/explore(New|Like)Section/.test(discover) && !/discoverExplore/.test(discover), 'the Discover panel no longer builds them (they sat below ~a week of every studio)');
    const sw = tabsSrc.slice(tabsSrc.indexOf('window.switchTab = function (tab, noHash) {'), tabsSrc.indexOf('// Deep links and back/forward'));
    t.ok(/if \(tab === 'stats'\) \{\s*renderInsights\(\);\s*if \(typeof renderExplore === 'function'\) renderExplore\(\);/.test(sw), "switchTab('stats') renders them");
    t.ok(!/if \(tab === 'discover'\) \{[^}]*renderExplore/.test(sw), "…and switchTab('discover') no longer does that work for a hidden panel");

    const exSrc = t.readSource('js/explore.js');
    const dirty = exSrc.slice(exSrc.indexOf('function markDirtyAndMaybeRender() {'), exSrc.indexOf("if (typeof PsycleState !== 'undefined'"));
    t.ok(/activePanel\.id === 'tab-stats'/.test(dirty) && !/tab-discover/.test(dirty), 'explore.js re-renders live only while Stats is showing');
    t.ok(/PsycleEvents\.on\('auth:changed', markDirtyAndMaybeRender\);/.test(exSrc), 'a sign-in / sign-out repaints them (a sign-out has no bookings:loaded)');
    ['renderNewToYou', 'renderYouMightLike'].forEach((fn) => {
      t.ok(new RegExp('function ' + fn + "\\(container, profiles\\) \\{\\s*if \\(signedOutBlank\\(\\)\\) \\{ container\\.style\\.display = 'none'; return; \\}").test(exSrc),
        fn + ' hides itself under the signed-out Stats hero');
    });
    const blank = (user, history) => {
      const ctx = t.vm.createContext({ currentUser: user, getHistory: () => history });
      t.vm.runInContext(grab(exSrc, '  function signedOutBlank() {', '  }'), ctx, { filename: 'js/explore.js[signedOutBlank]' });
      return ctx.signedOutBlank();
    };
    t.eq([blank(null, []), blank(null, [{ cancelledAt: 'x' }]), blank(null, [{ eventId: '1' }]), blank({ id: 1 }, [])], [true, true, false, false],
      'hidden only in the state renderInsights shows its hero for: signed out AND nothing (uncancelled) on record');
  }
};
