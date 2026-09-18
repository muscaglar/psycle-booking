'use strict';
// Discover filters: date presets, saved-filter restore, the date row's state,
// /events paging and the Strength/Reformer sub-filter gate (js/app.js).
// Runs with TZ=America/New_York on purpose — none of this may assume the
// device is on UK time.
module.exports = async function (t) {
  const F = t.loadPure('js/app.js', 'filters');
  const TODAY = '2026-09-17';

  // ── _addDaysStr ──────────────────────────────────────────────────────────
  t.section('Filters: date arithmetic (js/app.js pure:filters)');
  t.ok(['_addDaysStr', '_dateModeWindow', '_windowEndDate', '_datePillState', '_restoredDateState', '_nextEventsPageStart']
    .every((n) => typeof F[n] === 'function'), 'the pure:filters regions define every helper');
  t.eq(F._addDaysStr('2026-09-17', 0), '2026-09-17', 'addDays: +0 is the same day');
  t.eq(F._addDaysStr('2026-09-30', 1), '2026-10-01', 'addDays: rolls over a month end');
  t.eq(F._addDaysStr('2026-12-25', 14), '2027-01-08', 'addDays: rolls over a year end');
  t.eq(F._addDaysStr('2028-02-28', 1), '2028-02-29', 'addDays: leap day');
  t.eq(F._addDaysStr('2026-03-07', 1), '2026-03-08', 'addDays: into the device spring-forward day (New York)');
  t.eq(F._addDaysStr('2026-03-08', 1), '2026-03-09', 'addDays: out of the 23-hour spring-forward day');
  t.eq(F._addDaysStr('2026-11-01', 1), '2026-11-02', 'addDays: out of the 25-hour autumn-back day');

  // ── _dateModeWindow ──────────────────────────────────────────────────────
  t.section('Filters: date presets → {startDate, daysAhead, label}');
  t.eq(F._dateModeWindow('today', TODAY), { startDate: TODAY, daysAhead: 1, label: 'Today' }, 'today');
  t.eq(F._dateModeWindow('tomorrow', TODAY), { startDate: '2026-09-18', daysAhead: 1, label: 'Tomorrow' }, 'tomorrow');
  t.eq(F._dateModeWindow('week', TODAY), { startDate: TODAY, daysAhead: 7, label: '7 days' }, 'week');
  t.eq(F._dateModeWindow('2week', TODAY), { startDate: TODAY, daysAhead: 14, label: '14 days' }, '2week is a preset too (it restored as 7 days with no pill lit)');
  t.eq(F._dateModeWindow('tomorrow', '2026-09-30').startDate, '2026-10-01', 'tomorrow crosses a month end');
  t.eq(F._dateModeWindow(null, TODAY), null, 'null mode is not a preset');
  t.eq(F._dateModeWindow('month', TODAY), null, 'an unknown mode is not a preset');
  t.eq(F._dateModeWindow('constructor', TODAY), null, 'an inherited key from stored data is not a preset');
  t.eq(F._dateModeWindow('__proto__', TODAY), null, '__proto__ is not a preset');

  // ── _windowEndDate ───────────────────────────────────────────────────────
  t.section('Filters: fetch-window end date');
  t.eq(F._windowEndDate(TODAY, 1, 'today'), TODAY, 'Today ends on its own day');
  t.eq(F._windowEndDate('2026-09-18', 1, 'tomorrow'), '2026-09-18', 'Tomorrow ends on its own day');
  t.eq(F._windowEndDate('2026-09-19', 1, null), '2026-09-19', 'a calendar-picked date is ONE day (it used to span two)');
  t.eq(F._windowEndDate('2026-09-19', 1, 'week'), '2026-09-19', 'the planner sets one day without clearing the mode — still one day');
  t.eq(F._windowEndDate(TODAY, 7, 'week'), '2026-09-24', '7 days is unchanged (start + 7), so cached window keys still match');
  t.eq(F._windowEndDate(TODAY, 14, '2week'), '2026-10-01', '14 days is unchanged (start + 14)');
  t.eq(F._windowEndDate(TODAY, 8, null), '2026-09-25', 'a multi-day range with no mode runs start + days');
  // Find similar writes 7 / 8 days without a pill tap: the mode left from an
  // earlier Today/Tomorrow tap shrank both searches to a single day.
  t.eq(F._windowEndDate(TODAY, 7, 'today'), '2026-09-24', 'a stale "today" mode never shrinks a 7-day range ("Same instructor, any time")');
  t.eq(F._windowEndDate('2026-09-19', 8, 'tomorrow'), '2026-09-27', 'a stale "tomorrow" mode never shrinks an 8-day range ("Same time, any instructor")');
  // The planner and the habit "Find this week" button pick ONE day from
  // js/tabs.js. Neither is a preset: the habit button used to claim 'today'
  // for another date, and both left the mode to be saved as-is.
  const tabsSrc = t.readSource('js/tabs.js');
  t.ok(!/_dateQuickMode = '(today|tomorrow|week|2week)'/.test(tabsSrc), 'tabs.js never claims a preset for a date it picked');
  t.eq((tabsSrc.match(/daysAheadEl\.value = 1;[\s\S]{0,400}?window\._dateQuickMode = null;/g) || []).length, 2,
    'planDay and the habit "Find this week" handler both clear the preset mode with the date they write');

  // ── _datePillState ───────────────────────────────────────────────────────
  t.section('Filters: date row state');
  t.eq(F._datePillState('week', TODAY, '7', TODAY), { label: '7 days', picked: null }, 'week lights "7 days" (input values arrive as strings)');
  t.eq(F._datePillState('2week', TODAY, 14, TODAY), { label: '14 days', picked: null }, '2week lights "14 days"');
  t.eq(F._datePillState('today', TODAY, '1', TODAY), { label: 'Today', picked: null }, 'today lights "Today", not the calendar button');
  t.eq(F._datePillState('tomorrow', '2026-09-18', '1', TODAY), { label: 'Tomorrow', picked: null }, 'tomorrow lights "Tomorrow"');
  t.eq(F._datePillState(null, '2026-09-19', '1', TODAY), { label: null, picked: '2026-09-19' }, 'a picked date lights no preset and is printed on the calendar button');
  t.eq(F._datePillState('week', '2026-09-19', '1', TODAY), { label: null, picked: '2026-09-19' }, 'stale mode (planner/rebook moved the date): "7 days" is NOT lit over a single day');
  t.eq(F._datePillState('today', '2026-09-22', '8', TODAY), { label: null, picked: null }, 'stale mode over a multi-day range: nothing lit, nothing printed');
  t.eq(F._datePillState('today', '2026-09-16', '1', TODAY), { label: null, picked: '2026-09-16' }, 'app left open past midnight: "Today" is not lit over yesterday');
  t.eq(F._datePillState(null, 'garbage', '1', TODAY), { label: null, picked: null }, 'a malformed start date is never printed');
  t.eq(F._datePillState(null, '', '', TODAY), { label: null, picked: null }, 'empty inputs → nothing lit');

  // ── _restoredDateState ───────────────────────────────────────────────────
  t.section('Filters: saved date filter → restored state');
  t.eq(F._restoredDateState({ dateQuickMode: '2week', startDate: '2026-09-01', daysAhead: '7' }, TODAY),
    { mode: '2week', startDate: TODAY, daysAhead: 14 }, '14 days comes back as 14 days from today (it came back as 7)');
  t.eq(F._restoredDateState({ dateQuickMode: 'today', startDate: '2026-09-10', daysAhead: '1' }, TODAY),
    { mode: 'today', startDate: TODAY, daysAhead: 1 }, 'Today is re-derived from the current date, not the saved one');
  t.eq(F._restoredDateState({ dateQuickMode: 'tomorrow', startDate: '2026-09-10', daysAhead: '1' }, TODAY),
    { mode: 'tomorrow', startDate: '2026-09-18', daysAhead: 1 }, 'Tomorrow is re-derived too');
  t.eq(F._restoredDateState({ dateQuickMode: 'week', startDate: '2026-09-10', daysAhead: '7' }, TODAY),
    { mode: 'week', startDate: TODAY, daysAhead: 7 }, 'week');
  t.eq(F._restoredDateState({ dateQuickMode: null, startDate: '2026-09-19', daysAhead: '1' }, TODAY),
    { mode: null, startDate: '2026-09-19', daysAhead: 1 }, 'a picked date still ahead is kept, with NO mode');
  t.eq(F._restoredDateState({ dateQuickMode: null, startDate: TODAY, daysAhead: '1' }, TODAY),
    { mode: null, startDate: TODAY, daysAhead: 1 }, 'a picked date that is today is kept');
  t.eq(F._restoredDateState({ dateQuickMode: null, startDate: '2026-09-12', daysAhead: '1' }, TODAY),
    { mode: 'week', startDate: TODAY, daysAhead: 7 }, 'a picked date in the PAST falls back to the week (it opened on "No classes found")');
  t.eq(F._restoredDateState({ dateQuickMode: null, startDate: '2026-09-16', daysAhead: '7' }, TODAY),
    { mode: 'week', startDate: TODAY, daysAhead: 7 }, 'a range that merely STARTED in the past falls back as well');
  t.eq(F._restoredDateState({ dateQuickMode: null, startDate: '2026-09-19', daysAhead: 'x' }, TODAY).daysAhead, 7, 'unreadable daysAhead → 7');
  t.eq(F._restoredDateState({ dateQuickMode: 'constructor', startDate: '2026-09-12' }, TODAY).mode, 'week', 'garbage mode + past date → week');
  t.eq(F._restoredDateState({ dateQuickMode: 'constructor', startDate: '2026-09-19', daysAhead: '1' }, TODAY),
    { mode: null, startDate: '2026-09-19', daysAhead: 1 }, 'garbage mode + future date → the date, mode cleared');
  t.eq(F._restoredDateState({}, TODAY), { mode: 'week', startDate: TODAY, daysAhead: 7 }, 'nothing saved about dates → week');
  t.eq(F._restoredDateState(null, TODAY), { mode: 'week', startDate: TODAY, daysAhead: 7 }, 'null → week (no throw)');
  ['today', 'tomorrow', 'week', 'nextweek', '2week'].forEach((mode) => {
    const r = F._restoredDateState({ dateQuickMode: mode }, TODAY);
    t.eq(F._datePillState(r.mode, r.startDate, r.daysAhead, TODAY).label, F._dateModeWindow(mode, TODAY).label,
      'round trip: a restored "' + mode + '" lights its own pill');
  });
  const past = F._restoredDateState({ dateQuickMode: null, startDate: '2026-09-12', daysAhead: '1' }, TODAY);
  t.eq(F._datePillState(past.mode, past.startDate, past.daysAhead, TODAY).label, '7 days', 'round trip: the past-date fallback lights "7 days"');

  // ── _nextEventsPageStart ─────────────────────────────────────────────────
  t.section('Filters: /events paging');
  const ev = (start_at, id) => ({ id: id || 1, start_at });
  t.eq(F._nextEventsPageStart([ev('2026-09-21 09:00:00'), ev('2026-09-21 10:00:00')]), '2026-09-21 09:59:59', 'next page starts 1s BEFORE the last class (was 1s after)');
  t.eq(F._nextEventsPageStart([ev('2026-09-21 10:00:00'), ev('2026-09-20 18:15:00')]), '2026-09-21 09:59:59', 'the last class is found in an unsorted page');
  t.eq(F._nextEventsPageStart([ev('2026-09-21T10:00:00')]), '2026-09-21 09:59:59', 'the T-separated form is accepted; output keeps the API\'s space form');
  t.eq(F._nextEventsPageStart([ev('2026-09-21 00:00:00')]), '2026-09-20 23:59:59', 'steps back across midnight');
  t.eq(F._nextEventsPageStart([ev('2026-03-08 07:00:00')]), '2026-03-08 06:59:59',
    'device DST gap (New York spring-forward): still exactly 1s back — setSeconds() lands on 07:59:59 and would skip an hour of classes');
  t.eq(F._nextEventsPageStart([ev('2026-11-01 06:00:00')]), '2026-11-01 05:59:59', 'device autumn-back hour: still exactly 1s back');

  // The reviewer's reproduction, run against the REAL fetchEventsForLocation
  // sliced from app.js: 205 classes, #200 and #201 share a start time.
  const appSrc = t.readSource('js/app.js');
  const fnStart = appSrc.indexOf('async function fetchEventsForLocation(');
  const fnEnd = appSrc.indexOf('\nlet _searchSeq', fnStart);
  t.ok(fnStart !== -1 && fnEnd !== -1, 'fetchEventsForLocation can be sliced from app.js (anchors moved? update tests/suites/filters.js)');
  if (fnStart !== -1 && fnEnd !== -1) {
    const all = [];
    for (let i = 0; i < 205; i++) {
      const d = new Date(Date.UTC(2026, 8, 17, 6, 0, 0) + i * 45 * 60000); // every 45 min
      all.push({ id: 1000 + i, start_at: d.toISOString().replace('T', ' ').slice(0, 19) });
    }
    all[200].start_at = all[199].start_at; // #201 shares #200's start: the page limit cuts between them
    const run = async (inclusive, override) => {
      const requests = [];
      const ctx = t.loadPure('js/app.js', 'filters', {
        URLSearchParams,
        window: {},
        mergeRelations: () => {},
        apiFetch: async (path) => {
          const q = new URLSearchParams(path.split('?')[1]);
          const start = q.get('start'), end = q.get('end'), limit = Number(q.get('limit'));
          requests.push(start);
          const data = all.filter((e) => (inclusive ? e.start_at >= start : e.start_at > start) && e.start_at <= end).slice(0, limit);
          return { ok: true, json: async () => ({ data, relations: {} }) };
        },
      });
      t.vm.runInContext(appSrc.slice(fnStart, fnEnd), ctx, { filename: 'app.js[fetchEventsForLocation]' });
      if (override) t.vm.runInContext(override, ctx);
      const r = await ctx.fetchEventsForLocation(7, '2026-09-17', '2026-09-30', new Set(), () => false);
      return { ids: r.events.map((e) => e.id), requests };
    };
    const inc = await run(true);
    t.eq(inc.ids.length, 205, 'paging (server start is inclusive): all 205 classes fetched — the one sharing the page-boundary start time too');
    t.eq(new Set(inc.ids).size, 205, 'paging: the 1s overlap adds no duplicates (seenIds)');
    t.ok(inc.ids.includes(1200), 'paging: class #201 (id 1200) is present');
    t.ok(inc.requests.length <= 3, 'paging: the loop still terminates promptly (' + inc.requests.length + ' requests)');
    const exc = await run(false);
    t.eq(exc.ids.length, 205, 'paging (server start is EXCLUSIVE): still all 205 — why it steps back rather than re-using the same second');
    // Control: the old +1s rule against the same stub must lose the class,
    // otherwise this test could never have caught the bug.
    const old = await run(true,
      '_nextEventsPageStart = function (batch) { var l = batch.map(function (e) { return e.start_at; }).sort().pop();' +
      ' return new Date(Date.parse(l.replace(" ", "T") + "Z") + 1000).toISOString().replace("T", " ").replace("Z", "").slice(0, 19); };');
    t.eq(old.ids.length, 204, 'control: the old +1s rule loses exactly one class against this stub (the test has teeth)');
    t.ok(!old.ids.includes(1200), 'control: and the class it loses is #201');
  }

  // ── Strength / Reformer sub-filter gate (render) ─────────────────────────
  // The predicate lives inline in render(); run the shipped lines, not a copy.
  t.section('Filters: sub-filters only apply while their parent category is selected');
  const pStart = appSrc.indexOf('// Strength sub-filter');
  const pEnd = appSrc.indexOf('const locIds', pStart);
  const subsSrc = (appSrc.match(/const STRENGTH_SUBS = \[[\s\S]*?\];/) || [])[0];
  const refSrc = (appSrc.match(/const REFORMER_SUBS = \[[\s\S]*?\];/) || [])[0];
  t.ok(pStart !== -1 && pEnd !== -1 && !!subsSrc && !!refSrc, 'the sub-filter predicate can be sliced from render() (anchors moved? update tests/suites/filters.js)');
  if (pStart !== -1 && pEnd !== -1 && subsSrc && refSrc) {
    const ctx = t.vm.createContext({
      getCategory: (name) => ({ key: /^STRENGTH/.test(name) ? 'STRENGTH' : /^(REFORMER|PILATES)/.test(name) ? 'PILATES' : 'OTHER' }),
    });
    t.vm.runInContext(subsSrc + '\n' + refSrc + '\nfunction passes(filters, typeName) {\n' + appSrc.slice(pStart, pEnd) + '\nreturn true;\n}', ctx,
      { filename: 'app.js[render sub-filter]' });
    const f = (cats, strength, reformer) => ({
      categoryKeys: new Set(cats),
      strengthSubs: new Set(strength || ['UPPER', 'LOWER', 'FULL']),
      reformerSubs: new Set(reformer || ['SIGNATURE', 'STRENGTH']),
    });
    t.ok(ctx.passes(f([], ['UPPER']), 'STRENGTH: Lower Body'), 'no category selected + a leftover "Upper only": Lower Body still shows (it was silently dropped)');
    t.ok(ctx.passes(f(['RIDE'], ['UPPER']), 'STRENGTH: Full Body'), 'another category selected: the hidden Strength choice does nothing here');
    t.ok(!ctx.passes(f(['STRENGTH'], ['UPPER']), 'STRENGTH: Lower Body'), 'Strength selected + Upper only: Lower Body is filtered out');
    t.ok(ctx.passes(f(['STRENGTH'], ['UPPER']), 'STRENGTH: Upper Body'), 'Strength selected + Upper only: Upper Body shows');
    t.ok(ctx.passes(f(['STRENGTH']), 'STRENGTH: Lower Body'), 'Strength selected + all subs: nothing filtered');
    t.ok(ctx.passes(f([], null, ['SIGNATURE']), 'REFORMER: Strength 50'), 'no category selected + a leftover "Signature only": Reformer Strength still shows');
    t.ok(!ctx.passes(f(['PILATES'], null, ['SIGNATURE']), 'REFORMER: Strength 50'), 'Pilates selected + Signature only: Reformer Strength is filtered out');
    t.ok(ctx.passes(f(['PILATES'], null, ['SIGNATURE']), 'REFORMER: Signature 55'), 'Pilates selected + Signature only: Signature shows');
    t.ok(ctx.passes({ strengthSubs: new Set(['UPPER']), reformerSubs: new Set(['SIGNATURE']) }, 'STRENGTH: Lower Body'), 'filters without categoryKeys (legacy restored session) do not throw and do not filter');
  }
  // ── Launch: init's tail vs restoreFilters, in either order ───────────────
  // interactions.js restores psycle_saved_filters on a timer that only waits
  // for instructors/locations — which performance.js pre-fills on a cache-warm
  // launch while app.js's init is still awaiting securityReady (slow on iOS).
  // So restoreFilters can run BEFORE the init tail, and both orders have to
  // end in the same state. Runs the SHIPPED lines, not a copy.
  t.section('Filters: launch ends in the saved state whichever of init / restoreFilters runs first');
  const iStart = appSrc.indexOf('  let _sf = null;');
  const iEnd = appSrc.indexOf('  updateDiscoverEmptyState();\n  updateFiltersSummary();', iStart);
  const intSrc = t.readSource('js/interactions.js');
  const rStart = intSrc.indexOf('  function restoreFilters() {');
  const rEnd = intSrc.indexOf('  // Expose to global scope', rStart);
  t.ok(iStart !== -1 && iEnd > iStart && rStart !== -1 && rEnd > rStart,
    'the init tail and restoreFilters can be sliced (anchors moved? update tests/suites/filters.js)');
  if (iStart !== -1 && iEnd > iStart && rStart !== -1 && rEnd > rStart) {
    const initTail = appSrc.slice(iStart, iEnd);
    t.ok(!/getElementById\('daysAhead'\)\.value = 7/.test(initTail) && !/classList\.add\('active'\)/.test(initTail),
      'init no longer writes a blanket today/7 or lights "7 days" by hand');

    // saved = the psycle_saved_filters string (null = never saved).
    const launch = (saved, favs) => {
      const els = { startDate: { value: '' }, daysAhead: { value: '' } };
      const w = { els, lit: 'never painted' };
      const ctx = t.loadPure('js/app.js', 'filters', {
        localStorage: { getItem: (k) => (k === 'psycle_saved_filters' ? saved : null) },
        FILTERS_KEY: 'psycle_saved_filters',
        document: { getElementById: (id) => els[id] || null },
        localDateStr: () => TODAY,
        _dateQuickMode: 'week', // state.js default
        instructors: [{ id: 1 }, { id: 2 }, { id: 3 }],
        locations: [{ id: 10 }],
        favouriteInstructors: new Set(favs || []),
        selectedInstructors: new Set(), selectedLocations: new Set(), selectedCategories: new Set(),
        selectedStrengthSubs: new Set(), selectedReformerSubs: new Set(),
        renderInstrChips() {}, renderInstrDropdown() {}, renderLocationChips() {}, renderCategoryPills() {},
        renderStrengthSubPills() {}, renderReformerSubPills() {},
      });
      ctx.window = ctx; // restoreFilters writes window._dateQuickMode
      // The real painter reads the same three values; record what it would light.
      ctx._syncDatePills = () => { w.lit = ctx._datePillState(ctx._dateQuickMode, els.startDate.value, els.daysAhead.value, TODAY); };
      t.vm.runInContext('function __initTail() {\n' + initTail + '\n}\n' + intSrc.slice(rStart, rEnd), ctx, { filename: 'launch[init tail + restoreFilters]' });
      w.ctx = ctx;
      w.state = () => ({ mode: ctx._dateQuickMode, startDate: els.startDate.value, daysAhead: Number(els.daysAhead.value), lit: w.lit });
      w.instructors = () => Array.from(ctx.selectedInstructors).sort();
      return w;
    };
    const orders = {
      'init → restoreFilters': (w) => { w.ctx.__initTail(); w.ctx.restoreFilters(); },
      'restoreFilters → init (cache-warm, slow securityReady)': (w) => { w.ctx.restoreFilters(); w.ctx.__initTail(); },
    };
    const SAT = '2026-09-19';
    const cases = [
      ['14 days', { dateQuickMode: '2week', startDate: '2026-09-10', daysAhead: '14' }, { mode: '2week', startDate: TODAY, daysAhead: 14, lit: { label: '14 days', picked: null } }],
      ['Next week', { dateQuickMode: 'nextweek', startDate: '2026-09-14', daysAhead: '6' }, { mode: 'nextweek', startDate: '2026-09-21', daysAhead: 6, lit: { label: 'Next week', picked: null } }],
      ['Tomorrow', { dateQuickMode: 'tomorrow', startDate: '2026-09-11', daysAhead: '1' }, { mode: 'tomorrow', startDate: '2026-09-18', daysAhead: 1, lit: { label: 'Tomorrow', picked: null } }],
      ['Today', { dateQuickMode: 'today', startDate: '2026-09-10', daysAhead: '1' }, { mode: 'today', startDate: TODAY, daysAhead: 1, lit: { label: 'Today', picked: null } }],
      ['a picked Saturday', { dateQuickMode: null, startDate: SAT, daysAhead: '1' }, { mode: null, startDate: SAT, daysAhead: 1, lit: { label: null, picked: SAT } }],
    ];
    Object.keys(orders).forEach((order) => {
      cases.forEach(([name, saved, want]) => {
        const w = launch(JSON.stringify(saved));
        orders[order](w);
        t.eq(w.state(), want, order + ': saved ' + name + ' survives the launch with its pill lit');
      });
    });
    let w = launch(null);
    w.ctx.__initTail();
    t.eq(w.state(), { mode: 'week', startDate: TODAY, daysAhead: 7, lit: { label: '7 days', picked: null } }, 'nothing saved: week / today / 7 with "7 days" lit, as before');
    w = launch('{not json');
    w.ctx.__initTail();
    t.eq(w.state().mode, 'week', 'an unreadable save falls back to the week (no throw)');

    // Favourites are a FIRST-RUN default only: once any filter state has been
    // saved it is the authority — including a saved empty instructor list, or
    // "Clear filters" came undone on the next launch.
    t.section('Filters: favourites are pre-selected on a first run only');
    w = launch(null, ['1', '2', '99']);
    w.ctx.__initTail();
    t.eq(w.instructors(), ['1', '2'], 'never saved: favourites (that still exist) are pre-selected');
    w = launch('{not json', ['1']);
    w.ctx.__initTail();
    t.eq(w.instructors(), ['1'], 'an unreadable save counts as never saved');
    Object.keys(orders).forEach((order) => {
      w = launch(JSON.stringify({ instructorIds: [], locationIds: [], categories: [] }), ['1', '2']);
      orders[order](w);
      t.eq(w.instructors(), [], order + ': a saved EMPTY instructor list (Clear filters / last chip removed) stays cleared');
      w = launch(JSON.stringify({ instructorIds: ['3'] }), ['1', '2']);
      orders[order](w);
      t.eq(w.instructors(), ['3'], order + ': a saved selection is restored as-is — favourites are not added on top');
    });
  }

  // ── Launch search guard ──────────────────────────────────────────────────
  // The launch search is skipped when another search already covers it — but
  // only one that could LOAD: a tap while /locations was still loading (or
  // before the stored token was decrypted) found nothing, and skipping the
  // launch search for it left Discover on "No classes found" for good.
  t.section('Filters: the launch search only yields to a search that could load');
  const gStart = appSrc.indexOf('  if (getBearerToken()) {\n    const shown = restoreLastResults();');
  const gEnd = appSrc.indexOf('\n})();', gStart);
  const sStart = appSrc.indexOf('async function search(opts) {');
  const sEnd = appSrc.indexOf('  // Same rule as currentWindowDates()', sStart);
  t.ok(gStart !== -1 && gEnd > gStart && sStart !== -1 && sEnd > sStart, 'the launch guard and the head of search() can be sliced (anchors moved? update tests/suites/filters.js)');
  if (gStart !== -1 && gEnd > gStart && sStart !== -1 && sEnd > sStart) {
    const world = (token, studios) => {
      const w = { timers: [], searches: 0 };
      const ctx = t.vm.createContext({
        getBearerToken: () => token, locations: studios,
        restoreLastResults: () => false,
        setTimeout: (fn, ms) => { w.timers.push({ fn, ms }); return 1; }, clearTimeout() {},
        _syncDatePills() {}, _autoSearchTimer: null,
        selectedInstructors: new Set(), selectedLocations: new Set(), selectedCategories: new Set(),
        document: { getElementById: () => ({ value: '7' }) },
        window: {},
      });
      // The head of the real search() — everything up to the flag — then stop.
      t.vm.runInContext('var _searchSeq = 0; var _loadableSearchStarted = false;\n' +
        appSrc.slice(sStart, sEnd) + '\n}\nvar __realSearch = search;\n' +
        'function __launch() {\n' + appSrc.slice(gStart, gEnd) + '\n}', ctx, { filename: 'launch[search guard]' });
      ctx.search = () => { w.searches++; };
      w.ctx = ctx;
      return w;
    };
    let g = world('tok', []); // cold launch: studios not loaded yet
    await g.ctx.__realSearch();
    t.eq(g.ctx._loadableSearchStarted, false, 'a search with no studios to fetch does not count');
    g.ctx.locations.push({ id: 10 }); // init has landed
    g.ctx.__launch();
    t.eq(g.timers.length, 1, 'launch arms its search timer');
    g.timers[0].fn();
    t.eq(g.searches, 1, 'cold launch + an early tap: the launch search still runs (it was skipped for good)');

    g = world('', [{ id: 10 }]); // before the stored token is decrypted
    await g.ctx.__realSearch();
    t.eq(g.ctx._loadableSearchStarted, false, 'a tokenless search does not count');

    g = world('tok', [{ id: 10 }]);
    g.ctx.__launch();
    await g.ctx.__realSearch(); // restoreFilters' debounced search beats the timer
    t.eq(g.ctx._loadableSearchStarted, true, 'a search with a token and studios counts');
    g.timers[0].fn();
    t.eq(g.searches, 0, 'a loadable search already started: the launch search yields (no second teardown)');

    g = world('tok', [{ id: 10 }]);
    await g.ctx.__realSearch(); // cache-warm: restoreFilters searched BEFORE init finished
    g.ctx.__launch();
    g.timers[0].fn();
    t.eq(g.searches, 0, 'a loadable search from before init finished counts too (cache-warm launch)');
  }
};
