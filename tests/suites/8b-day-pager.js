'use strict';
// Wave 8b — Discover shows a range ONE DAY AT A TIME: a strip of days over a
// pager, changed by tap, arrow key or a sideways swipe.
//   - the decisions are js/app.js's pure:day-pager block;
//   - the gesture rules are js/interactions.js's pure:swipe-nav block;
//   - the state machine (_pagerModelFor) and the gesture helper (_psycleSwipe)
//     are the SHIPPED lines, sliced out of source and run against fakes.
// Runs with TZ=America/New_York on purpose: a day here is the 'YYYY-MM-DD' at
// the front of start_at — the gym's calendar — and nothing may move it through
// the device's zone, on either country's clock-change days.
module.exports = async function (t) {
  const { ok, eq } = t;
  const app = t.readSource('js/app.js');
  const inter = t.readSource('js/interactions.js');
  const css = t.readSource('css/redesign.css');
  const P = t.loadPure('js/app.js', 'day-pager');
  const S = t.loadPure('js/interactions.js', 'swipe-nav');
  // A top-level function, from its opener to its closing bare brace.
  const fnSrc = (src, opener, indent) => {
    const s = src.indexOf(opener);
    const e = src.indexOf('\n' + (indent || '') + '}\n', s);
    if (s === -1 || e === -1) throw new Error('8b-day-pager suite: cannot slice "' + opener + '" (anchor moved?)');
    return src.slice(s, e + (indent || '').length + 2);
  };

  // ── Days of a range ──────────────────────────────────────────────────────
  t.section('Day pager: the days of a range');
  ok(['_pagerIsDay', '_pagerAddDays', '_pagerDays', '_pagerDayList', '_pagerDayLabel', '_pagerCountText', '_pagerSpoken',
    '_pagerEmptyState', '_pagerOpensText', '_pagerFirstWithClasses', '_pagerStep', '_pagerJump', '_pagerPickDay', '_pagerHintWanted'].every((n) => typeof P[n] === 'function'),
  'pure:day-pager defines every helper');
  eq(P._pagerDays('2026-09-18', '2026-09-25'), ['2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25'],
    'both bounds are days of the range: the 18th to the 25th is eight pills');
  {
    // The strip draws whatever range the date row asks for (pure:filters). "7
    // days" asked for today + 7 — EIGHT pills under that label, fifteen under
    // "14 days": the presets count the days after the first now (6 / 13).
    const F = t.loadPure('js/app.js', 'filters');
    const pills = (mode, today) => {
      const w = F._dateModeWindow(mode, today);
      return P._pagerDayList(w.startDate, F._windowEndDate(w.startDate, w.daysAhead, mode), []);
    };
    eq(pills('week', '2026-09-18'), ['2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'], '"7 days" on Friday 18th: seven pills, Today … Thu 24 (it drew an eighth, Fri 25)');
    eq([pills('2week', '2026-09-18').length, pills('2week', '2026-09-18').slice(-1)[0]], [14, '2026-10-01'], '"14 days": fourteen pills, the last one Thu 1 October (it drew fifteen)');
    eq([pills('nextweek', '2026-09-18').length, pills('today', '2026-09-18').length, pills('tomorrow', '2026-09-18').length], [7, 1, 1], '"Next week" is its Monday–Sunday, as before; Today and Tomorrow are one day (→ not paged)');
  }
  eq(P._pagerDays('2026-09-18', '2026-09-18'), ['2026-09-18'], 'a single day is a list of one (→ not paged)');
  eq(P._pagerDays('2026-09-29', '2026-10-02'), ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'], 'across a month end');
  eq(P._pagerDays('2026-12-30', '2027-01-02'), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'], 'across a year end');
  eq(P._pagerDays('2028-02-27', '2028-03-01').length, 4, 'a leap day is a day');
  {
    // The UK clocks go back on 2026-10-25, New York's (this process) on
    // 2026-11-01, and forward on 2026-03-08 / 2026-03-29: no day may repeat or go missing.
    const autumn = P._pagerDays('2026-10-23', '2026-11-03'), spring = P._pagerDays('2026-03-06', '2026-03-31');
    const stepsByOne = (days) => days.every((d, i) => i === 0 || (Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8)) - Date.UTC(+days[i - 1].slice(0, 4), +days[i - 1].slice(5, 7) - 1, +days[i - 1].slice(8))) === 86400000);
    ok(autumn.length === 12 && stepsByOne(autumn) && spring.length === 26 && stepsByOne(spring), 'both clock changes, both countries: every day once, in order');
  }
  eq(P._pagerDays('2026-09-25', '2026-09-18'), [], 'a range the wrong way round is no range');
  eq([P._pagerDays('', '2026-09-18'), P._pagerDays('2026-09-18', ''), P._pagerDays(null, undefined), P._pagerDays('18/09/2026', '25/09/2026')], [[], [], [], []], 'a missing or malformed bound is no range');
  {
    const MAX = t.vm.runInContext('PAGER_MAX_DAYS', P);
    eq(P._pagerDays('2026-01-01', '2029-01-01').length, MAX, 'a runaway range is capped (' + MAX + ' days) rather than building a year of pills');
  }
  eq([P._pagerAddDays('2026-09-30', 1), P._pagerAddDays('2026-03-01', -1), P._pagerAddDays('nonsense', 1), P._pagerAddDays(undefined, 1)], ['2026-10-01', '2026-02-28', '', ''], 'day arithmetic, and "" for anything that is not a day');
  eq(P._pagerDayList('2026-09-18', '2026-09-20', ['2026-09-20']), ['2026-09-18', '2026-09-19', '2026-09-20'], 'a day with nothing on keeps its place in the strip');
  eq(P._pagerDayList('', '', ['2026-09-21', '2026-09-19', '2026-09-21', 'undefined', null]), ['2026-09-19', '2026-09-21'],
    'a restored legacy search has no bounds: the days its classes fall on — sorted, once each, garbage dropped');
  eq(P._pagerDayList('', '', []), [], 'no bounds and no classes: nothing to page');
  {
    const capped = P._pagerDayList('2026-01-01', '2026-12-31', ['2026-02-01', '2026-06-15', '2026-06-15', '2026-11-30']);
    const MAX = t.vm.runInContext('PAGER_MAX_DAYS', P);
    eq([capped.length, capped.slice(-2)], [MAX + 2, ['2026-06-15', '2026-11-30']], 'past the cap a day still gets a pill when it has classes — none can be left unreachable');
  }

  // ── Labels ───────────────────────────────────────────────────────────────
  t.section('Day pager: what a day is called');
  const TODAY = '2026-09-18';
  eq(P._pagerDayLabel('2026-09-18', TODAY), { rel: 'Today', short: 'Today', long: 'Friday 18 September', head: 'Today · 18 September' }, 'today');
  eq(P._pagerDayLabel('2026-09-19', TODAY), { rel: 'Tomorrow', short: 'Tomorrow', long: 'Saturday 19 September', head: 'Tomorrow · 19 September' }, 'tomorrow');
  eq(P._pagerDayLabel('2026-09-20', TODAY), { rel: '', short: 'Sun 20', long: 'Sunday 20 September', head: 'Sunday 20 September' }, 'any other day: "Sun 20" in the strip, the full date in the heading');
  eq(P._pagerDayLabel('2026-10-01', '2026-09-30').rel, 'Tomorrow', 'tomorrow across a month end');
  eq(P._pagerDayLabel('2027-01-01', '2026-12-31').short, 'Tomorrow', '…and a year end');
  eq(P._pagerDayLabel('2026-09-18', '2026-09-19').rel, '', 'yesterday is just a date');
  eq(P._pagerDayLabel('2026-09-18', '').short, 'Fri 18', 'no "today" handed in: no Today, still a label');
  eq(P._pagerDayLabel('<img>', TODAY), { rel: '', short: '<img>', long: '<img>', head: '<img>' }, 'a day that is not a day comes back as it is (render() escapes what it prints)');
  {
    // The single-day heading must read exactly as it did before the pager
    // (render() used toLocaleDateString on local noon): hold a year to it.
    let same = true, first = '';
    for (let d = '2026-01-01'; d <= '2026-12-31' && same; d = P._pagerAddDays(d, 1)) {
      const was = new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).replace(',', '');
      if (P._pagerDayLabel(d, TODAY).long !== was) { same = false; first = d + ': ' + P._pagerDayLabel(d, TODAY).long + ' vs ' + was; }
    }
    ok(same, 'every day of 2026 reads as the old header did ("Saturday 20 September")' + (first ? ' — ' + first : ''));
  }
  eq([P._pagerCountText(0), P._pagerCountText(1), P._pagerCountText(14)], ['No classes', '1 class', '14 classes'], 'counts');
  eq(P._pagerSpoken('2026-09-20', TODAY, 14), 'Sunday 20 September, 14 classes', "what is announced on every change of day (the brief's own example)");
  eq([P._pagerSpoken('2026-09-18', TODAY, 0), P._pagerSpoken('2026-09-19', TODAY, 1)], ['Friday 18 September, no classes', 'Saturday 19 September, 1 class'], 'an empty day, a single class');
  eq([P._pagerSpoken('2026-09-28', TODAY, 0, 'unopened'), P._pagerSpoken('2026-09-25', TODAY, 0, 'unknown'), P._pagerSpoken('2026-09-20', TODAY, 3, null)],
    ['Monday 28 September, not open yet', 'Friday 25 September, not loaded', 'Sunday 20 September, 3 classes'],
    'a day that may not say "no classes" is never announced as one');

  // ── A day with nothing to show is not always a day with no classes ───────
  t.section('Day pager: an empty day that may not say "No classes"');
  {
    // Friday 18 September 2026, 15:00 London. By the OBSERVED release model (js/app.js pure:horizon, 2026-09-19) the
    // release of Mon 14 opened Fri 2 → Thu 8 Oct and LISTED a batch more, through Thu 15 Oct; Fri 16 Oct is not on
    // the timetable until Mon 21, 12:00. "Unopened" is about LISTING: a listed day with nothing on really is empty.
    const W = t.loadPure('js/app.js', 'window', { _gymWallToUtcMs: t.loadPure('js/app.js', 'gym-time')._gymWallToUtcMs });
    const now = Date.UTC(2026, 8, 18, 14, 0, 0);
    const st = (day, n, o) => P._pagerEmptyState(day, n, Object.assign({ now, opensMs: W._dayListedMs }, o || {}));
    const fortnight = P._pagerDays('2026-09-18', '2026-10-02');
    eq(fortnight.filter((d) => st(d, 0) !== null), [],
      '"14 days" on a Friday: every day of it has long been listed — an empty one really is empty (the old rule called the five days of "next week" unopened: that week had been open since the 7th)');
    const far = P._pagerDays('2026-10-13', '2026-10-19'); // a range picked in the calendar
    eq(far.filter((d) => st(d, 0) === 'unopened'), ['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19'],
      'past what the timetable lists (Thu 15 Oct) an empty day is "unopened" — never "No classes"');
    eq(st('2026-10-16', 2), null, 'a day that HAS classes is just a day (whatever the clock says)');
    const mondayMorning = Date.UTC(2026, 8, 21, 9, 0, 0), mondayNoon = Date.UTC(2026, 8, 21, 11, 0, 0); // 10:00 and 12:00 BST
    eq([st('2026-10-16', 0, { now: mondayMorning }), st('2026-10-16', 0, { now: mondayNoon }), st('2026-10-15', 0, { now: mondayMorning })], ['unopened', null, null],
      'Fri 16 Oct on Monday 21 Sept: unopened until 12:00 London — and listed from noon on');
    eq([st('2026-09-25', 0, { heldEnd: '2026-09-24' }), st('2026-09-24', 0, { heldEnd: '2026-09-24' }), st('2026-09-25', 0, { heldEnd: null }), st('2026-09-25', 0, { heldEnd: 'junk' })],
      ['unknown', null, null, null], "past the last day a provisional window held: unknown (never loaded) — the days it did hold keep their \"no classes\"");
    eq(st('2026-10-16', 0, { heldEnd: '2026-10-15' }), 'unopened', 'unopened outranks unknown: it is true whatever was loaded, and no retry changes it');
    eq([P._pagerEmptyState('2026-09-25', 0, null), P._pagerEmptyState('2026-09-25', 0, { now, opensMs: () => { throw new RangeError('no tz data'); } }), P._pagerEmptyState('nonsense', 0, { heldEnd: '2026-01-01' })],
      [null, null, null], 'no clock, no London data, or not a day: nothing is claimed');
  }
  {
    // _pagerOpensText words the RELEASE that opens the day (its instant comes from _dayOpensMs, pure:horizon).
    const W = t.loadPure('js/app.js', 'window', { _gymWallToUtcMs: t.loadPure('js/app.js', 'gym-time')._gymWallToUtcMs });
    eq([P._pagerOpensText(W._dayOpensMs('2026-10-16'), '2026-09-18'), P._pagerOpensText(W._dayOpensMs('2026-10-22'), '2026-09-18'), P._pagerOpensText(W._dayOpensMs('2026-10-16'), '2026-09-28'),
      P._pagerOpensText(W._dayOpensMs('2026-11-19'), '2026-09-18'), P._pagerOpensText(null, TODAY), P._pagerOpensText(NaN, TODAY)],
    ['Booking usually opens Monday 28 September, 12:00', 'Booking usually opens Monday 28 September, 12:00', 'Booking usually opens today at 12:00', 'Booking usually opens Monday 26 October, 12:00', '', ''],
    'when it USUALLY opens (the observed model explains — it never promises: the API does not say, and some credit types book a batch early): the release Monday, by date (a bare "Monday" would read as the next one) — one batch is a Friday to the Thursday after; "today" on the day itself; a GMT release names its own Monday too');
  }

  // ── Next / previous / the way off an empty day ───────────────────────────
  t.section('Day pager: stepping, edges and the way off an empty day');
  const DAYS = P._pagerDays('2026-09-18', '2026-09-22');
  eq([P._pagerStep(DAYS, '2026-09-19', 1), P._pagerStep(DAYS, '2026-09-19', -1)], ['2026-09-20', '2026-09-18'], 'next and previous');
  eq([P._pagerStep(DAYS, '2026-09-22', 1), P._pagerStep(DAYS, '2026-09-18', -1)], [null, null], 'nothing past either end (the pager resists)');
  eq([P._pagerStep(DAYS, '2026-10-01', 1), P._pagerStep([], '2026-09-18', 1), P._pagerStep(null, '2026-09-18', -1)], [null, null, null], 'a day outside the range, or no range, steps nowhere');
  const counts = { '2026-09-18': 0, '2026-09-19': 3, '2026-09-20': 0, '2026-09-21': 0, '2026-09-22': 5 };
  eq(P._pagerFirstWithClasses(DAYS, counts), '2026-09-19', 'first day with classes');
  eq(P._pagerFirstWithClasses(DAYS, {}), null, 'none anywhere');
  eq(P._pagerJump(DAYS, counts, '2026-09-20'), { day: '2026-09-22', dir: 1 }, 'an empty day sends you to the NEXT day with classes (skipping empties)…');
  eq(P._pagerJump(DAYS, { '2026-09-18': 2, '2026-09-19': 3 }, '2026-09-21'), { day: '2026-09-19', dir: -1 }, '…or the nearest one before it when none is ahead');
  eq(P._pagerJump(DAYS, {}, '2026-09-20'), null, 'nowhere to go (render() shows the whole-range empty state instead)');
  eq(P._pagerJump(DAYS, counts, '2026-10-01'), null, 'a day outside the range jumps nowhere');

  // ── Which day is showing ─────────────────────────────────────────────────
  t.section('Day pager: which day is on screen');
  const pick = (o) => P._pagerPickDay(Object.assign({ days: DAYS, counts, sameRange: true, chosen: false, done: true }, o));
  eq(pick({ current: null, sameRange: false, done: false }), { day: '2026-09-18', chosen: false }, 'a new range, results still arriving: the FIRST day (empty so far is not empty)');
  eq(pick({ current: null, sameRange: false }), { day: '2026-09-19', chosen: false }, 'loading finished and the first day has nothing: the first day that has classes');
  eq(pick({ current: '2026-09-18', done: false }), { day: '2026-09-18', chosen: false }, 'mid-load nothing moves');
  eq(pick({ current: '2026-09-22', chosen: true }), { day: '2026-09-22', chosen: true }, 'a day the member chose is kept across filter taps and background re-renders…');
  eq(pick({ current: '2026-09-20', chosen: true }), { day: '2026-09-20', chosen: true }, '…even when the filters empty it (the empty day offers the way on)');
  eq(pick({ current: '2026-09-22', chosen: true, done: false }), { day: '2026-09-22', chosen: true }, '…and through a forced reload still streaming in');
  eq(pick({ current: '2026-09-22', chosen: true, sameRange: false }), { day: '2026-09-19', chosen: false }, 'another range or preset starts again — and is nobody\'s choice');
  eq(pick({ current: '2026-09-17', chosen: true }), { day: '2026-09-19', chosen: false }, 'a chosen day that has left the range (the midnight roll-forward) falls to the first day');
  eq(pick({ current: '2026-09-19', counts: { '2026-09-22': 4 } }), { day: '2026-09-22', chosen: false }, 'not chosen: the view follows the first day with classes as the filters change');
  eq(pick({ current: '2026-09-19', counts: {} }), { day: '2026-09-19', chosen: false }, 'nothing anywhere: stay put');
  eq([P._pagerPickDay({ days: [] }), P._pagerPickDay(null)], [{ day: null, chosen: false }, { day: null, chosen: false }], 'no days: no day');

  // ── The shipped state machine ────────────────────────────────────────────
  t.section('Day pager: render() → _pagerModelFor keeps / resets the day (shipped lines)');
  {
    const win = { _pagerDay: null, _pagerRangeKey: null, _pagerChosen: false };
    // Noon on Friday 18 September 2026, London. `listed` stands in for _dayListedMs (pure:horizon): here, days from
    // Mon 28 Sept on are not on the timetable yet (they appear on Mon 21, 12:00) — the model's own numbers are
    // tested above; this is about what _pagerModelFor does with the answer, per DAY.
    const NOON = Date.UTC(2026, 8, 18, 11, 0, 0);
    const listed = (day) => (day >= '2026-09-28' ? Date.UTC(2026, 8, 21, 11, 0, 0) : Date.UTC(2026, 8, 14, 11, 0, 0));
    const ctx = t.loadPure('js/app.js', 'day-pager', { window: win, localDateStr: () => TODAY, _gymDayKey: () => '2026-09-19', _dayListedMs: listed, Date: class extends Date { static now() { return NOON; } } });
    t.vm.runInContext('var _pagerStripLeft = 77;\n' + fnSrc(app, 'function _pagerModelFor(byDay, filters, done, dataAt, maps, heldEnd) {'), ctx, { filename: 'js/app.js[_pagerModelFor]' });
    const ev = (day, n) => Array.from({ length: n }, (x, i) => ({ id: day + i, start_at: day + 'T07:00:00' }));
    const week = { startDate: '2026-09-18', endDateStr: '2026-09-22' };
    const byDay = { '2026-09-19': ev('2026-09-19', 3), '2026-09-22': ev('2026-09-22', 5) };
    let m = ctx._pagerModelFor({ '2026-09-19': ev('2026-09-19', 1) }, week, false, 0, {});
    eq([m.paged, m.days.length, m.todayStr, win._pagerDay, win._pagerChosen, t.vm.runInContext('_pagerStripLeft', ctx)], [true, 5, TODAY, '2026-09-18', false, 0],
      'first pass of a streaming search: paged, on the first day, the strip back at its start — and "today" is the date the date row\'s presets were built from (the device\'s), so a heading can never say Today under a lit "Tomorrow"');
    m = ctx._pagerModelFor(byDay, week, true, 0, {});
    eq([win._pagerDay, m.counts], ['2026-09-19', { '2026-09-18': 0, '2026-09-19': 3, '2026-09-20': 0, '2026-09-21': 0, '2026-09-22': 5 }], 'load over: the first day with classes; every day of the range has a count');
    win._pagerDay = '2026-09-22'; win._pagerChosen = true; // the member swiped
    ctx._pagerModelFor({ '2026-09-19': ev('2026-09-19', 2) }, week, true, 0, {});
    eq([win._pagerDay, win._pagerChosen], ['2026-09-22', true], 'a filter tap that empties the chosen day keeps it');
    m = ctx._pagerModelFor({}, week, false, 0, {});
    eq([m.paged, win._pagerDay, win._pagerChosen, win._pagerRangeKey], [false, '2026-09-22', true, '2026-09-18|2026-09-22'], 'nothing to show YET (a forced reload\'s first studio): no strip, and the chosen day is left alone');
    m = ctx._pagerModelFor({ '2026-09-19': ev('2026-09-19', 4) }, { startDate: '2026-09-19', endDateStr: '2026-09-19' }, true, 0, {});
    eq([m.paged, m.shown, win._pagerDay, win._pagerRangeKey, win._pagerChosen], [false, ['2026-09-19'], null, null, false], 'a single day is not paged — and forgets the day');
    ctx._pagerModelFor(byDay, week, true, 0, {});
    eq([win._pagerDay, win._pagerChosen], ['2026-09-19', false], 'back on the week it starts again (Today → 7 days is a change of range)');
    win._pagerDay = '2026-09-22'; win._pagerChosen = true;
    ctx._pagerModelFor(byDay, { startDate: '2026-09-19', endDateStr: '2026-09-23' }, true, 0, {});
    eq([win._pagerDay, win._pagerChosen, win._pagerRangeKey], ['2026-09-19', false, '2026-09-19|2026-09-23'], 'the midnight roll-forward moves the range: first day with classes, nobody\'s choice');
    m = ctx._pagerModelFor({ '2026-09-24': ev('2026-09-24', 1), '2026-09-21': ev('2026-09-21', 1) }, { startDate: '', endDateStr: '' }, true, 0, {});
    eq([m.paged, m.days, win._pagerDay], [true, ['2026-09-21', '2026-09-24'], '2026-09-21'], 'a restored search with no bounds pages over the days it has');
    ok(!/_gymDayKey/.test(fnSrc(app, 'function _pagerModelFor(byDay, filters, done, dataAt, maps, heldEnd) {')) && /const todayStr = localDateStr\(\);/.test(fnSrc(app, 'function _pagerModelFor(byDay, filters, done, dataAt, maps, heldEnd) {')),
      'one "today" on the screen: _applyDateQuick builds Today / Tomorrow from localDateStr(), and so do the labels');
    // A provisional window (yesterday's cache under today's key) and a range that reaches past the release.
    const fortnight = { startDate: '2026-09-18', endDateStr: '2026-10-02' };
    m = ctx._pagerModelFor(byDay, fortnight, true, 0, {}, '2026-09-26');
    eq(m.states, { '2026-09-27': 'unknown', '2026-09-28': 'unopened', '2026-09-29': 'unopened', '2026-09-30': 'unopened', '2026-10-01': 'unopened', '2026-10-02': 'unopened' },
      'the model carries which empty days may not say "no classes": past what the adopted cache held → unknown; not on the timetable yet → unopened (asked per DAY)');
    ok(/opensMs: _dayListedMs \}/.test(fnSrc(app, 'function _pagerModelFor(byDay, filters, done, dataAt, maps, heldEnd) {')), '…and it asks the observed model when a day is LISTED (a listed day with nothing on really is empty)');
    eq([m.counts['2026-09-27'], win._pagerDay], [0, '2026-09-19'], '…their count stays 0, so neither is ever picked as the first day with classes nor as an empty day\'s way on');
    eq(ctx._pagerModelFor(byDay, week, true, 0, {}).states, {}, 'a complete window over released days: nothing to qualify');
    const renderSrc = app.slice(app.indexOf('function render(events, relations, filters, done) {'), app.indexOf('// ── Discover: one day at a time'));
    ok(/const heldEnd = \(events === window\._windowEvents && window\._windowPartial && window\._windowHeldEnd\) \|\| null;/.test(renderSrc) &&
      /_pagerModelFor\(byDay, filters, done, dataAt, \{ instrMap, studioMap, locationMap, typeMap \}, heldEnd\);/.test(renderSrc),
    "render() hands over the last day a PROVISIONAL window holds — only when it is drawing that window (_discoverEmptyContext's rule, per day)");
  }

  // ── The hint ─────────────────────────────────────────────────────────────
  t.section('Day pager: the one-time "Swipe to change day" hint');
  const hint = (o) => P._pagerHintWanted(Object.assign({ paged: true, touch: true, seen: false, welcomeUp: false, welcomedThisSession: false }, o));
  eq([hint({}), hint({ seen: true }), hint({ paged: false }), hint({ touch: false }), hint({ welcomeUp: true }), hint({ welcomedThisSession: true }), P._pagerHintWanted(null)],
    [true, false, false, false, false, false, false], 'only the first paged range, on a touch screen, never over or straight after the welcome');
  {
    const src = fnSrc(app, 'function _paintDayHint(pager, m) {');
    ok(/const welcomeUp = !!document\.getElementById\('onboardOverlay'\);/.test(src) && !/psycle_onboarded_v1|ONBOARDING_KEY/.test(src),
      'the welcome counts as up while its overlay is — never by a missing completion flag: a launch on a #bookings link skips the welcome and leaves the flag unset (tests/suites/8f-wave8-seams.js runs it)');
    ok(/welcomedThisSession: _pagerSawWelcome \|\| window\._psycleWelcomeSeen === true \}/.test(src), '…and one really shown in this page session keeps the hint for the next launch');
    ok(/PAGER_HINT_KEY = 'psycle_hint_dayswipe'/.test(app) && /_psycleSafeSetItem\(PAGER_HINT_KEY, '1'\)/.test(src), "marked seen in localStorage psycle_hint_dayswipe = '1', through the quota-aware setter");
    ok(/if \(how === 'swipe'\) _dismissDayHint\(\);/.test(app), 'the first successful swipe dismisses it');
    ok(/aria-label', 'Swipe to change day\. Dismiss'/.test(src) && /hint = document\.createElement\('button'\)/.test(src), 'the hint is one real button: the whole line dismisses it');
  }

  // ── Swipe rules ──────────────────────────────────────────────────────────
  t.section('Swipe: sideways intent, release and edges (pure:swipe-nav)');
  eq([S.swipeNavAxis(5, 3), S.swipeNavAxis(12, 0), S.swipeNavAxis(9, 9)], [null, null, null], 'under 12px of travel nothing is decided');
  eq([S.swipeNavAxis(13, 0), S.swipeNavAxis(-30, 12), S.swipeNavAxis(-13, 8)], ['x', 'x', 'x'], '|dx| > 12 and |dx| > 1.5×|dy| is a sideways swipe');
  eq([S.swipeNavAxis(3, 13), S.swipeNavAxis(0, -40), S.swipeNavAxis(20, 15), S.swipeNavAxis(-14, 10)], ['y', 'y', 'y', 'y'], 'vertical — or a diagonal that is not CLEARLY sideways — is a scroll, and is never reconsidered');
  eq([S.swipeNavOffset(-80, true, true), S.swipeNavOffset(80, true, true)], [-80, 80], 'the content follows the finger…');
  eq([S.swipeNavOffset(-90, true, false), S.swipeNavOffset(90, false, true), S.swipeNavOffset(90, true, false)], [-30, 30, 90], '…and a third as far against the last / first page');
  eq([S.swipeNavDir(-98, 390, 600, true, true), S.swipeNavDir(-97, 390, 600, true, true)], [1, 0], 'released past 25% of the width: swipe LEFT = next');
  eq(S.swipeNavDir(120, 390, 600, true, true), -1, 'swipe RIGHT = previous');
  eq([S.swipeNavDir(-45, 390, 120, true, true), S.swipeNavDir(-45, 390, 400, true, true), S.swipeNavDir(-30, 390, 80, true, true)], [1, 0, 0], 'a flick (≥40px in under 250ms) turns the page too; a slow short drag springs back');
  eq([S.swipeNavDir(-200, 390, 300, true, false), S.swipeNavDir(200, 390, 300, false, true)], [0, 0], 'at the last / first page it stays');
  eq([S.swipeNavDir(-200, 0, 100, true, true), S.swipeNavDir(0, 390, 100, true, true)], [0, 0], 'an unmeasured pager, or no movement, turns nothing');

  // ── The gesture helper, shipped lines over a fake element ────────────────
  t.section('Swipe: window._psycleSwipe over a fake element (shipped lines)');
  {
    const sectionD = inter.slice(inter.indexOf('// D. Sideways swipe between pages'), inter.lastIndexOf('})();'));
    ok(sectionD.length > 500 && inter.indexOf('// D. Sideways swipe between pages') > inter.indexOf('// C. Filter Persistence'),
      'section D sits after Filter Persistence (tests/suites/bookings-card.js evaluates everything between the B and C banners on its own)');
    const world = (o) => {
      o = o || {};
      const L = {}, calls = [];
      let now = 1000;
      const el = { clientWidth: 390, addEventListener: (type, fn, opt) => { (L[type] = L[type] || []).push({ fn, opt }); }, removeEventListener: () => {} };
      const FakeDate = { now: () => now };
      const ctx = t.vm.createContext({ Math, Date: FakeDate, window: {}, document: { getElementById: () => null }, getComputedStyle: () => ({ overflowX: o.scrollsX ? 'auto' : 'visible' }) });
      t.vm.runInContext(sectionD, ctx, { filename: 'js/interactions.js[D]' });
      const target = o.target || { nodeType: 1, scrollWidth: o.scrollsX ? 900 : 300, clientWidth: 300, parentNode: el, closest: (sel) => (o.inside && sel.indexOf(o.inside) !== -1 ? {} : null) };
      const detach = ctx.window._psycleSwipe(el, Object.assign({
        onStart: () => calls.push('start'), onMove: (off, dx) => calls.push('move ' + off + ' ' + dx), onEnd: (r) => calls.push('end ' + r.dir + (r.cancelled ? ' cancelled' : '')),
      }, o.opts || {}));
      const fire = (type, x, y, fingers) => {
        const e = { target, stopped: false, prevented: false, stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; },
          touches: (type === 'touchend' || type === 'touchcancel') ? [] : Array(fingers || 1).fill({ clientX: x, clientY: y }) };
        (L[type] || []).forEach((l) => l.fn(e));
        return e;
      };
      return { L, calls, fire, detach, tick: (ms) => { now += ms; }, ctx };
    };
    let w = world();
    ok(typeof w.ctx.window._psycleSwipe === 'function', 'window._psycleSwipe is exported (the welcome pages and the Stats sub-pages can take it up)');
    ok(['touchstart', 'touchmove', 'touchend', 'touchcancel'].every((type) => w.L[type].length === 1 && w.L[type][0].opt && w.L[type][0].opt.passive === true),
      'every touch listener is passive: a vertical gesture can never be blocked from here');
    ok(w.L.click.length === 1 && w.L.click[0].opt === true, '…plus one capturing click listener');
    w.fire('touchstart', 300, 400);
    let mv = w.fire('touchmove', 294, 401);
    eq([w.calls, mv.stopped], [[], false], 'a few pixels: nothing yet, and the event is left to the page');
    mv = w.fire('touchmove', 280, 404); w.tick(300);
    eq([w.calls, mv.stopped, mv.prevented], [['start', 'move -20 -20'], true, false], 'clearly sideways: the swipe starts; pull-to-refresh (a document listener) no longer sees the moves; nothing is preventDefault-ed');
    w.fire('touchmove', 180, 410); w.fire('touchend');
    eq(w.calls.slice(2), ['move -120 -120', 'end 1'], 'released past 25%: next');
    const click = w.fire('click');
    ok(click.stopped && click.prevented, 'the click that can follow a swipe is swallowed (it would open the class sheet under the finger)');
    w.tick(400);
    ok(!w.fire('click').stopped, '…but a later tap is an ordinary tap');

    w = world();
    w.fire('touchstart', 300, 400); w.fire('touchmove', 303, 430); w.fire('touchmove', 200, 440); w.fire('touchend');
    eq(w.calls, [], 'a scroll is never turned into a swipe later in the same touch');
    ok(!w.fire('click').stopped, '…and a tap after a scroll still clicks');

    w = world();
    w.fire('touchstart', 10, 400); w.fire('touchmove', 200, 400); w.fire('touchend');
    eq(w.calls, [], "a touch that starts within 16px of the screen's left edge belongs to the system's back gesture");

    for (const inside of ['#dayStrip', '.date-presets', '.location-chips', 'input']) {
      w = world({ inside });
      w.fire('touchstart', 300, 400); w.fire('touchmove', 150, 400); w.fire('touchend');
      eq(w.calls, [], 'a touch that starts in ' + inside + ' is left alone');
    }
    w = world({ scrollsX: true });
    w.fire('touchstart', 300, 400); w.fire('touchmove', 150, 400); w.fire('touchend');
    eq(w.calls, [], '…as is one inside ANY row that scrolls sideways');

    w = world({ opts: { shouldIgnore: () => true } });
    w.fire('touchstart', 300, 400); w.fire('touchmove', 150, 400); w.fire('touchend');
    eq(w.calls, [], "the caller's shouldIgnore (a dialog is up, a Book button is busy, outside the pager) wins");

    w = world({ opts: { edges: () => ({ prev: true, next: false }) } });
    w.fire('touchstart', 300, 400); w.fire('touchmove', 150, 400); w.tick(300); w.fire('touchend');
    eq(w.calls, ['start', 'move -50 -150', 'end 0'], 'against the last page: a third of the travel, and it stays');

    w = world();
    w.fire('touchstart', 300, 400); w.fire('touchmove', 150, 400); w.fire('touchcancel');
    eq(w.calls[w.calls.length - 1], 'end 0 cancelled', 'the system took the touch: spring back, never a change of day');
    w = world();
    w.fire('touchstart', 300, 400); w.fire('touchmove', 150, 400); w.fire('touchstart', 300, 400, 2);
    eq(w.calls[w.calls.length - 1], 'end 0 cancelled', 'a second finger mid-swipe puts the page back');
    w = world();
    w.fire('touchstart', 300, 400, 2); w.fire('touchmove', 150, 400, 2); w.fire('touchend');
    eq(w.calls, [], 'two fingers from the start (a pinch) is not a swipe');

    ok(!/preventDefault\(\)/.test(sectionD.replace(/const onClick = function \(e\) \{[\s\S]*?\n {4}\};/, '')), 'the only preventDefault in the section is the swallowed click');
    ok(/psycleSwipe\(results, \{/.test(sectionD) && /shouldIgnore: function \(target\) \{ return !pager\.canStart\(target\); \}/.test(sectionD),
      'the day pager is bound to #results (it outlives every re-render) and asks app.js whether a touch may start');
  }

  // ── app.js wiring ────────────────────────────────────────────────────────
  t.section('Day pager: a change of day never searches, never saves, never rebuilds under a busy button');
  {
    const show = fnSrc(app, 'function showDiscoverDay(day, how) {');
    ok(!/\bsearch\(|triggerAutoSearch|saveFilters|renderFromWindow|_searchSeq|localStorage|apiFetch/.test(show + fnSrc(app, 'function _swapPagerDay(container, dir) {')),
      'showDiscoverDay / _swapPagerDay: no search, no saved filters, no _searchSeq bump (a live search keeps streaming), no network');
    ok(/if \(_discoverBusy\(\)\) return false;/.test(show), 'refused while a dialog is up or a Book button is mid-request — that flow holds a button in the list (as _renderWindowInPlace)');
    ok(/if \(m\.days\.indexOf\(day\) === -1 \|\| day === window\._pagerDay\) return false;/.test(show), 'only a day of the range on screen, and only a different one');
    ok(/if \(!m \|\| !m\.paged \|\| !container \|\| !document\.getElementById\('dayPager'\)\) return false;/.test(show), 'a stale model (the whole-range empty state is up) changes nothing');
    ok(/announce\(_pagerSpoken\(day, m\.todayStr, m\.counts\[day\] \|\| 0, \(m\.states && m\.states\[day\]\) \|\| null\)\);/.test(show), 'every change is announced: "Saturday 20 September, 14 classes" — or what the day is instead of empty');
    ok(/window\._pagerChosen = true;/.test(show), '…and makes the day the member\'s own');
    const paint = fnSrc(app, 'function _paintDays(container, m) {');
    ok(/const shown = m\.paged \? \[window\._pagerDay\] : m\.shown;/.test(paint) && /if \(shown\.indexOf\(g\.dataset\.day\) === -1\) g\.remove\(\);/.test(paint),
      "only the visible day's cards are in the DOM: every other day's group is removed, none is pre-rendered");
    ok(/_cardCountsFresh = _countsFresh\(m\.dataAt, Date\.now\(\)\);/.test(paint), 'a day painted long after render() re-asks whether "spots left" is still recent enough to print');
    const group = fnSrc(app, 'function _paintDayGroup(host, day, m) {');
    ok(!/querySelector\(`\[data-day=/.test(group) && /el\.dataset\.day === day/.test(group), "the day's group is found by dataset, never by a selector built from API text");
    ok(/class="empty-action primary" data-pager-day="\$\{jump\.day\}"/.test(group) && !/no-results/.test(group.replace(/\/\/[^\n]*/g, '')),
      'an empty day: one line and one button, outside .no-results (theme.js flattens that to text)');
    ok(/if \(!m\.done\) \{ if \(empty\) empty\.remove\(\); return; \}/.test(group), '…and never while results are still arriving');
    ok(/countEl\.textContent = dayEvents\.length \? _pagerCountText\(dayEvents\.length\) : '';/.test(group) && (group.replace(/\/\/[^\n]*/g, '').match(/No classes on this day\./g) || []).length === 1,
      'an empty day says so ONCE: the line — the heading carries no "No classes" over it');
    ok(/const state = \(m\.states && m\.states\[day\]\) \|\| null;/.test(group) &&
      /const line = \(state === 'unopened' && _pagerOpensText\(_dayOpensMs\(day\), m\.todayStr\)\) \|\| 'No classes on this day\.';/.test(group),
    'a day Psycle has not listed yet says when booking for it opens instead (and keeps the way on)');
    ok(/if \(state === 'unknown'\) \{\n\s*empty\.innerHTML = _revalInFlight\n\s*\? '<div class="day-empty-line empty-loading">Checking the latest timetable…<\/div>'\n\s*: '<div class="day-empty-line">Couldn\\'t check this day<\/div><button type="button" class="empty-action primary" data-pager-retry>Try again<\/button>';/.test(group),
      'a day a provisional window never held: "Checking…" while the real range loads, else "Couldn\'t check this day" + Try again — never "No classes"');
    ok(/document\.querySelector\('#results \.empty-loading'\)\) _renderWindowInPlace\(\);/.test(app), '…and a refresh that fails swaps the "Checking…" line for it (_runRevalidate repaints whatever carries .empty-loading)');
    ok(/if \(t\.closest\('\[data-pager-retry\]'\)\) \{ search\(\{ force: true \}\); return; \}/.test(fnSrc(app, 'function _wireDayPager(container) {')),
      "Try again is the whole-range state's own retry: a forced search shows the studios that answer");
    const swipe = app.slice(app.indexOf('window._dayPagerSwipe = {'), app.indexOf('// ── Studio multi-select chips'));
    ok(/target\.closest\('#dayPager'\)/.test(swipe) && /_dialogOpen\(\) \|\| _ownKeysOverlayUp\(\) \|\| _overlayStack\.length > 0/.test(swipe) && /!_discoverBusy\(\)/.test(swipe),
      'a swipe may only start inside the pager, with no dialog or sheet up and no Book button busy');
    ok(/if \(!m \|\| _pagerReducedMotion\(\)\) return;/.test(swipe), 'reduced motion: nothing follows the finger');
    ok(/_flushPagerSwap\(\);/.test(swipe), 'a drag that starts while the last day is still sliding out paints the selected day first');
    const swap = fnSrc(app, 'function _swapPagerDay(container, dir) {');
    ok(/if \(!track \|\| _pagerReducedMotion\(\)\) \{ _resetDayTrack\(track\); paint\(\); return; \}/.test(swap), 'reduced motion: the day simply swaps');
    ok(/at\.closest\('#dayPager'\) \? at\.closest\('\[data-pager-day\]'\) : null;/.test(swap) &&
      /document\.querySelector\('#dayStrip \.day-pill\[aria-selected="true"\]'\)/.test(swap),
    "an empty day's button is rebuilt away with the day: focus it held goes to the strip's selected day, not to <body>");
    ok(!/day-nav/.test(app) && !/_addDayNav/.test(app) && !/'Previous day'|'Next day'/.test(app),
      'the day heading carries no previous / next buttons (the owner does not want chevrons on Discover): the strip pills, the arrow keys and the swipe move days');
    const strip = fnSrc(app, 'function _paintDayStrip(container, m) {');
    ok(/setAttribute\('role', 'tablist'\)/.test(strip) && /role="tab"/.test(strip) && /aria-selected/.test(strip) && /pill\.tabIndex = on \? 0 : -1;/.test(strip),
      'the strip is a tablist: tabs with aria-selected and one tab stop');
    ok(/pill\.classList\.toggle\('is-empty', n === 0 && state !== 'unknown'\);/.test(strip) && /const count = state \? '' : String\(n\);/.test(strip) &&
      /_pagerSpoken\(d, m\.todayStr, n, state\)/.test(strip),
    'a pill for a day never loaded, or not open yet, prints no "0" and is not named "no classes"; only the first stays un-quiet (nobody knows it is empty)');
    ok(/\.day-pill-count:empty \{ display: none; \}/.test(css), '…and a count with nothing in it draws no bubble');
    ok(!/scrollIntoView/.test(app.slice(app.indexOf('// ── Discover: one day at a time'), app.indexOf('// ── Studio multi-select chips')).replace(/\/\/[^\n]*/g, '')),
      "the strip is moved by its own scrollLeft — scrollIntoView would scroll the page");
    const keys = fnSrc(app, 'function _dayStripKeydown(e) {');
    ok(['ArrowLeft', 'ArrowRight', 'Home', 'End'].every((k) => keys.indexOf("'" + k + "'") !== -1), 'Left / Right / Home / End move days with focus in the strip');
    ok(/\nlet _discoverDay = localDateStr\(\);/.test(app) && !/window\._discoverDay/.test(app.replace(/\/\/[^\n]*/g, '')),
      "the pager's day is window._pagerDay: _discoverDay is already the date row's roll-forward day (a top-level let)");
  }

  // ── A strip rebuilt behind another tab ───────────────────────────────────
  t.section('Day pager: a strip rebuilt while Discover is hidden gets its scroll offset back');
  {
    // The shipped tail of _paintDayStrip + _revealDayPill + _restoreDayStrip over a fake strip.
    const stripSrc = fnSrc(app, 'function _paintDayStrip(container, m) {');
    ok(/window\._dayStripRevealOwed = !\(strip\.clientWidth > 0\);\n\s*strip\.scrollLeft = _pagerStripLeft;\n\s*_revealDayPill\(strip\);/.test(stripSrc),
      'a rebuilt strip with no layout box (a resume re-rendered Discover behind Bookings) notes that its offset is owed — one that IS laid out clears the note');
    const world = (o) => {
      const writes = [];
      const pill = { getBoundingClientRect: () => ({ left: o.pillLeft - strip.scrollLeft, width: 80 }) };
      const strip = {
        clientWidth: o.clientWidth, scrollWidth: 760, _left: 0,
        get scrollLeft() { return this._left; }, set scrollLeft(v) { writes.push(v); if (this.clientWidth > 0) this._left = v; }, // no layout box: the write does nothing
        querySelector: (sel) => (sel === '.day-pill.active' ? pill : null), getBoundingClientRect: () => ({ left: 0 }),
      };
      const ctx = t.loadPure('js/app.js', 'filters', { document: { getElementById: (id) => (id === 'dayStrip' && !o.noStrip ? strip : null) }, getComputedStyle: () => ({ columnGap: '8px' }) });
      t.vm.runInContext('var _pagerStripLeft = ' + o.left + ';\n' + fnSrc(app, 'function _revealDayPill(strip) {') + '\n' + fnSrc(app, 'function _restoreDayStrip() {'), ctx, { filename: 'js/app.js[_restoreDayStrip]' });
      ctx._restoreDayStrip();
      return { strip, writes, left: t.vm.runInContext('_pagerStripLeft', ctx) };
    };
    // 390px phone: Thu is the 7th pill (left edge 528px); the member had scrolled the row to 270.
    let w = world({ clientWidth: 358, pillLeft: 528, left: 270 });
    eq([w.strip.scrollLeft, w.left], [270, 270], 'Discover shown again: the row goes back to where the member left it, the selected day in view');
    w = world({ clientWidth: 358, pillLeft: 528, left: 0 });
    eq([w.strip.scrollLeft, w.left], [258, 258], '…and a selected day that is still out of sight is brought in (its own scrollLeft, one gap to spare)');
    w = world({ clientWidth: 0, pillLeft: 528, left: 270 });
    eq([w.strip.scrollLeft, w.left], [0, 270], 'still hidden: nothing can move, and the remembered offset is NOT overwritten with 0');
    eq(world({ noStrip: true, clientWidth: 358, pillLeft: 0, left: 5 }).writes, [], 'no strip on screen (a single day, the empty state): nothing to do');
    // switchTab('discover') pays it — once (the date row's own pattern).
    const tabsJs = t.readSource('js/tabs.js');
    const sw = tabsJs.slice(tabsJs.indexOf('  window.switchTab = function (tab, noHash) {'), tabsJs.indexOf('  // Deep links and back/forward'));
    const calls = [];
    const w2 = { scrollTo() {}, _dayStripRevealOwed: true };
    const tctx = t.vm.createContext({
      window: w2, history: { replaceState() {} }, document: { querySelectorAll: () => [], querySelector: () => null },
      renderWeekView() {}, renderInsights() {}, renderMembershipInfo() {}, renderCostTracker() {},
      _restoreDayStrip: () => calls.push('strip:' + w2._dayStripRevealOwed),
    });
    t.vm.runInContext('var _currentTab = "bookings";\n' + sw, tctx, { filename: 'js/tabs.js[switchTab]' });
    w2.switchTab('stats');
    eq([calls, w2._dayStripRevealOwed], [[], true], 'another tab: still owed');
    w2.switchTab('discover');
    eq([calls, w2._dayStripRevealOwed], [['strip:false'], false], 'Discover shown (the strip is laid out now): paid, and the note is spent first');
    w2.switchTab('bookings'); w2.switchTab('discover');
    eq(calls.length, 1, '…once: later visits do not drag a row the member has scrolled since');

    // A theme change re-measures the pills WITHOUT a rebuild: Handheld / Terminal
    // swap in a mono body face, every pill widens and scrollLeft stays put. The
    // shipped listener + the shipped _revealDayPill over a fake strip.
    const themed = (o) => {
      const writes = [], date = [];
      const pill = { getBoundingClientRect: () => ({ left: o.pillLeft - strip.scrollLeft, width: o.pillW }) };
      const strip = {
        clientWidth: o.clientWidth, scrollWidth: 900, _left: o.left,
        get scrollLeft() { return this._left; }, set scrollLeft(v) { writes.push(v); if (this.clientWidth > 0) this._left = v; },
        querySelector: (sel) => (sel === '.day-pill.active' ? pill : null), getBoundingClientRect: () => ({ left: 0 }),
      };
      const ctx = t.loadPure('js/app.js', 'filters', { document: { getElementById: (id) => (id === 'dayStrip' && !o.noStrip ? strip : null) }, getComputedStyle: () => ({ columnGap: '8px' }) });
      ctx.window = ctx;
      ctx._revealActiveDatePill = () => date.push('date');
      t.vm.runInContext('var _pagerStripLeft = ' + o.left + ';\n' + fnSrc(app, 'function _revealDayPill(strip) {') + '\n' + fnSrc(app, 'function _revealPillsAfterThemeChange() {'), ctx, { filename: 'js/app.js[_revealPillsAfterThemeChange]' });
      ctx._revealPillsAfterThemeChange();
      return { left: strip.scrollLeft, writes, owed: ctx._dayStripRevealOwed, date, kept: t.vm.runInContext('_pagerStripLeft', ctx) };
    };
    // 390px phone, Tue 22 lit and fully in view; Handheld widens it to 105px at content-left 360 — 19px past the strip's 346px.
    eq(themed({ clientWidth: 0, pillLeft: 360, pillW: 105, left: 100 }), { left: 100, writes: [], owed: true, date: ['date'], kept: 100 },
      'Handheld picked in Membership → Appearance: the strip has no layout box, so the reveal is OWED (switchTab pays it, above) — it stayed false, and the lit pill came back 19px cut off');
    eq(themed({ clientWidth: 346, pillLeft: 360, pillW: 105, left: 100 }), { left: 127, writes: [127], owed: undefined, date: ['date'], kept: 127 },
      'changed with Discover up: the widened pill is brought fully in at once — its own scrollLeft, one gap to spare, the offset remembered');
    eq(themed({ clientWidth: 346, pillLeft: 40, pillW: 80, left: 100 }), { left: 32, writes: [32], owed: undefined, date: ['date'], kept: 32 },
      '…and out of a mono theme the pills NARROW: a lit pill left behind the left edge is brought back as well');
    eq(themed({ clientWidth: 346, pillLeft: 200, pillW: 105, left: 100 }).writes, [], 'a lit pill still fully in view moves nothing');
    eq(themed({ noStrip: true, clientWidth: 346, pillLeft: 0, pillW: 80, left: 0 }), { left: 0, writes: [], owed: undefined, date: ['date'], kept: 0 },
      'no strip (a single day): nothing owed — the date row\'s lit pill is still looked at (it owes itself when its row cannot be measured)');
    ok(/\nPsycleEvents\.on\('theme:changed', _revealPillsAfterThemeChange\);\n/.test(app), 'app.js listens for theme:changed');
    const themeJs = t.readSource('js/theme.js');
    ok(/window\.setAppTheme = function \(id\) \{[\s\S]*?\n  if \(typeof PsycleEvents !== 'undefined'\) PsycleEvents\.emit\('theme:changed', id\);\n\};/.test(themeJs) &&
      /function toggleTheme\(\) \{[\s\S]*?window\.setAppTheme\(next\);\n\}/.test(themeJs),
    '…which every explicit choice emits: the Appearance chips call setAppTheme, and so does the header toggle');
  }

  // ── A search made FOR the member ─────────────────────────────────────────
  t.section('Day pager: a "find it" shortcut is a fresh view, not the day last swiped to');
  {
    // Same range + a chosen Sunday + "Same instructor": the pager kept Sunday and
    // showed "No classes on this day" under the toast "Showing classes with Alex".
    ['function _focusSearch(o) {', 'function applySavedSearch(obj) {', 'function applySearchPreset(key) {'].forEach((opener) => {
      const src = fnSrc(app, opener).replace(/\/\/[^\n]*/g, '');
      ok(/window\._pagerChosen = false;\s*\n\s*search\(\);\n\}\s*$/.test(src), opener.replace(/^function |\(.*$/g, '') + ' forgets the chosen day just before it searches');
    });
    eq(P._pagerPickDay({ days: DAYS, counts: { '2026-09-19': 3, '2026-09-22': 5 }, current: '2026-09-20', sameRange: true, chosen: false, done: true }), { day: '2026-09-19', chosen: false },
      '…so over the SAME range the finished render lands on the first day with a match');
    const chips = ['function toggleLocation(', 'function toggleCategory('].map((opener) => fnSrc(app, opener));
    ok(chips.every((src) => !/_pagerChosen/.test(src)), 'filter chips leave it alone: a day the member chose survives a filter tap (the brief)');
  }

  // ── CSS contract ─────────────────────────────────────────────────────────
  t.section('Day pager: CSS — vertical scrolling is the browser\'s, tokens only');
  {
    const live = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const block = live.slice(live.indexOf('#results[data-day-mode="paged"]'));
    ok(block.length > 500 && live.indexOf('#results[data-day-mode="paged"]') > live.indexOf('.mb-waitlist-status'), 'the day strip + pager block is the last thing in css/redesign.css');
    ok(/\.day-pager \{ touch-action: pan-y pinch-zoom; \}/.test(block) && !/touch-action: pan-y;/.test(block),
      '#dayPager is touch-action: pan-y — which is why the swipe never needs preventDefault — and keeps pinch-zoom: most of Discover is inside it, and the viewport allows zoom (the helper drops a second finger)');
    ok(/\.day-strip \{[^}]*overflow-x: auto;[^}]*\}/.test(block) && /\.day-strip \{[^}]*background: var\(--bg\);/.test(block), 'the strip scrolls sideways inside itself, on the page background');
    ok(/@media \(min-width: 1024px\) \{\s*\.day-strip \{ flex-wrap: wrap; overflow-x: visible; \}/.test(block), 'desktop: the strip wraps, like the filter rows (a mouse wheel cannot scroll it sideways)');
    ok(/@media \(prefers-reduced-motion: reduce\)/.test(block), 'reduced motion is respected in the stylesheet too');
    ok(!/\.day-nav\b/.test(block) && /\.day-hint \{[^}]*min-height: var\(--tap-min\);/.test(block) &&
      /\.day-pill::after \{[^}]*inset: calc\(var\(--space-2\) \/ -2\) 0;/.test(block) && /\.day-pill \{[^}]*height: calc\(var\(--tap-min\) - var\(--space-2\)\);/.test(block),
    'tap targets: the hint is --tap-min; a pill is drawn 6px shorter and its hit area makes the 6px up; no chevron rules are left');
    ok(!/#[0-9a-f]{3,8}\b/i.test(block.replace(/#(results|dayPager)\b/g, '')) && !/rgba?\(/.test(block), 'no colour literal anywhere in the block');
    const sizes = (block.match(/[^\w-](\d*\.?\d+)px/g) || []).map((s) => s.slice(1));
    ok(sizes.every((s) => s === '1px' || s === '2px' || s === '640px' || s === '1024px'), 'no size literal either — hairlines, the focus ring and the two breakpoints apart (found: ' + sizes.join(' ') + ')');
    const root = (t.readSource('css/theme.css').match(/:root \{[\s\S]*?\n\}/) || [''])[0];
    const used = Array.from(new Set(block.match(/var\(--[\w-]+/g) || [])).map((v) => v.slice(4));
    const colourAliases = ['--bg', '--accent', '--accent-ink', '--line', '--surface', '--surface-2', '--ink', '--ink-2', '--ink-3'];
    ok(used.every((v) => root.indexOf(v + ':') !== -1 || colourAliases.indexOf(v) !== -1), 'every token it reads exists (' + used.filter((v) => root.indexOf(v + ':') === -1 && colourAliases.indexOf(v) === -1).join(' ') + ')');
    ok(/#results\[data-day-mode="paged"\] > \.summary\.is-settled \{ display: none; \}/.test(block) && /summary\.classList\.toggle\('is-settled', !!done\);/.test(app),
      'over a paged range the "N classes" line goes once loading is over (the strip has every count); it stays while results stream in');
  }
};
