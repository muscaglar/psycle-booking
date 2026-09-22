'use strict';
// Discover list: "spots left" (#19), the batched / linear-merge render (#39,
// #49) and the Time row — time-of-day bands + "Available only" (#4, #18).
// The DOM-free helpers come from js/app.js's pure:discover block; everything
// else runs the SHIPPED lines sliced out of source, never a copy.
// Runs with TZ=America/New_York on purpose: a class's hour is the gym's wall
// clock, and nothing here may read it through the device's zone.
module.exports = async function (t) {
  const { ok, eq } = t;
  const app = t.readSource('js/app.js');
  const D = t.loadPure('js/app.js', 'discover');
  const slice = (from, to) => {
    const s = app.indexOf(from);
    const e = app.indexOf(to, s);
    if (s === -1 || e <= s) throw new Error('discover suite: cannot slice "' + from + '" … "' + to + '" (anchor moved?)');
    return app.slice(s, e);
  };

  // ── _spotsLeft ───────────────────────────────────────────────────────────
  t.section('Discover: spots left comes from capacity − occupancy');
  ok(['_spotsLeft', '_countsFresh', '_spotsHtml', '_timeBandOf', '_inTimeBands', '_mergeInsertPoints'].every((n) => typeof D[n] === 'function'),
    'pure:discover defines every helper');
  eq(D._spotsLeft({ capacity: 21, occupancy: 18 }), 3, '18/21 → 3 (what /events really sends)');
  eq(D._spotsLeft({ capacity: 48, occupancy: 0 }), 48, 'an empty class');
  eq(D._spotsLeft({ capacity: 21, occupancy: 21 }), 0, 'exactly full → 0');
  eq(D._spotsLeft({ capacity: 21, occupancy: 23 }), 0, 'over-booked (a moved bike) never goes negative');
  eq(D._spotsLeft({ capacity: 21, occupancy: 18, capacity_remaining: 9 }), 3, 'capacity + occupancy win over a capacity_remaining that disagrees');
  eq(D._spotsLeft({ capacity_remaining: 4 }), 4, 'capacity_remaining alone (a cache entry seeded from a waitlist place)');
  eq(D._spotsLeft({ capacity_remaining: -1 }), 0, '…clamped too');
  eq(D._spotsLeft({ capacity: 21 }), null, 'capacity without occupancy says nothing');
  eq(D._spotsLeft({ capacity: '21', occupancy: '18' }), null, 'strings are not counts (they would be interpolated into markup)');
  eq(D._spotsLeft({ capacity: NaN, occupancy: 3 }), null, 'NaN is not a count');
  eq(D._spotsLeft({}), null, 'no fields → null');
  eq(D._spotsLeft(null), null, 'no event → null');

  t.section('Discover: a count is only printed while it is recent (30 minutes)');
  const NOW = Date.UTC(2026, 8, 17, 12, 0, 0);
  eq(D._countsFresh(NOW - 60 * 1000, NOW), true, 'a minute old');
  eq(D._countsFresh(NOW - 29 * 60 * 1000, NOW), true, '29 minutes old');
  eq(D._countsFresh(NOW - 30 * 60 * 1000, NOW), false, '30 minutes old is not');
  eq(D._countsFresh(NOW - 9 * 60 * 60 * 1000, NOW), false, "this morning's window");
  eq(D._countsFresh(NOW + 60 * 1000, NOW), false, 'a stamp from the future (clock moved back) is not fresh');
  eq(D._countsFresh(0, NOW), false, 'no stamp (a session saved before stamps existed) is not fresh');
  eq(D._countsFresh(undefined, NOW), false, 'an entry render() never touched has no known age');
  const FRESH_MS = t.vm.runInContext('WINDOW_FRESH_MS', t.loadPure('js/app.js', 'window')); // a const: not a property of the context
  ok(D._countsFresh(NOW - 2 * FRESH_MS + 1, NOW) && !D._countsFresh(NOW - 2 * FRESH_MS, NOW),
    'the limit is twice WINDOW_FRESH_MS: the silent refresh that starts at 15 minutes has had its chance');

  // ── Time bands ───────────────────────────────────────────────────────────
  t.section('Discover: time-of-day bands are cut from the start_at string');
  eq(D._timeBandOf('2026-09-17T06:30:00'), 'early', '06:30 (T form) → early');
  eq(D._timeBandOf('2026-09-17 06:30:00'), 'early', '06:30 (space form) → early');
  eq(D._timeBandOf('2026-09-17T08:59:00'), 'early', '08:59 is still before 9');
  eq(D._timeBandOf('2026-09-17T09:00:00'), 'day', '09:00 starts the day band');
  eq(D._timeBandOf('2026-09-17 12:15:00'), 'day', '12:15 (space form) → day');
  eq(D._timeBandOf('2026-09-17T16:59:00'), 'day', '16:59 is still 9–5');
  eq(D._timeBandOf('2026-09-17T17:00:00'), 'evening', '17:00 starts the evening');
  eq(D._timeBandOf('2026-09-17 20:45:00'), 'evening', '20:45 (space form) → evening');
  eq(D._timeBandOf('2026-09-17T00:05:00'), 'early', 'just past midnight is early, not evening');
  eq(D._timeBandOf('2026-09-17T23:30:00'), 'evening', '23:30 → evening');
  // The device is on New York time here. Through Date, 22:30 UK-wall-clock is
  // still 22:30 locally (naive strings parse as local) — but a 'Z' string, or a
  // DST gap on the DEVICE, would move it. The string cut cannot.
  eq(D._timeBandOf('2026-03-08T02:30:00'), 'early', "02:30 on the device's spring-forward day (the hour does not exist in New York) is still 02:30 at the gym");
  eq(D._timeBandOf('2026-09-17'), null, 'a date with no time has no band');
  eq(D._timeBandOf('nonsense'), null, 'garbage has no band');
  eq(D._timeBandOf(undefined), null, 'a missing start_at has no band');
  eq(D._timeBandOf('2026-09-17T99:00:00'), null, 'an impossible hour has no band');

  const bands = (...k) => new Set(k);
  eq(D._inTimeBands('2026-09-17T18:30:00', bands()), true, 'no band chosen = any time');
  eq(D._inTimeBands('2026-09-17T18:30:00', null), true, 'no set at all (a legacy filters object) = any time');
  eq(D._inTimeBands('2026-09-17T18:30:00', undefined), true, 'undefined = any time');
  eq(D._inTimeBands('2026-09-17T18:30:00', bands('evening')), true, 'evening keeps 18:30');
  eq(D._inTimeBands('2026-09-17 07:00:00', bands('evening')), false, 'evening hides 07:00');
  eq(D._inTimeBands('2026-09-17 07:00:00', bands('early', 'evening')), true, 'bands are multi-select: early + evening keeps 07:00');
  eq(D._inTimeBands('2026-09-17T12:00:00', bands('early', 'evening')), false, '…and hides noon');
  eq(D._inTimeBands('nonsense', bands('evening')), true, 'a class whose hour cannot be read is never hidden by a time filter');
  {
    const TB = t.vm.runInContext('TIME_BANDS', D);
    eq(TB.map((b) => b.key), ['early', 'day', 'evening'], 'three bands, in day order');
    ok(TB[0].from === 0 && TB[2].to === 24 && TB.every((b, i) => i === 0 || b.from === TB[i - 1].to), 'the bands tile the whole day: no gap, no overlap');
  }

  // ── Linear merge ─────────────────────────────────────────────────────────
  t.section('Discover: new cards merge into a day in one forward walk');
  // Apply the points the way render() does: insertBefore(card, kids[point] || null),
  // where kids is the snapshot taken BEFORE any insertion.
  const applyMerge = (existing, fresh) => {
    const kids = existing.slice(), dom = existing.slice();
    const points = D._mergeInsertPoints(kids.map((k) => k.start), fresh.map((f) => f.start));
    fresh.forEach((f, i) => {
      const ref = kids[points[i]];
      if (ref) dom.splice(dom.indexOf(ref), 0, f); else dom.push(f);
    });
    return dom.map((c) => c.id);
  };
  // The loop it replaces: per card, re-read the grid and find the first later card.
  const oldMerge = (existing, fresh) => {
    const dom = existing.slice();
    fresh.forEach((f) => {
      const ref = dom.find((el) => el.start !== undefined && el.start > f.start);
      if (ref) dom.splice(dom.indexOf(ref), 0, f); else dom.push(f);
    });
    return dom.map((c) => c.id);
  };
  const c = (id, hhmm) => ({ id, start: hhmm === undefined ? undefined : '2026-09-17T' + hhmm + ':00' });
  eq(D._mergeInsertPoints([], ['a', 'b']), [0, 0], 'an empty grid: everything appends (index = length)');
  eq(D._mergeInsertPoints(['2026-09-17T07:00:00'], []), [], 'nothing new: no points');
  eq(applyMerge([c('A1', '07:00'), c('A2', '09:00'), c('A3', '18:00')], [c('B1', '06:30'), c('B2', '08:00'), c('B3', '19:00')]),
    ['B1', 'A1', 'B2', 'A2', 'A3', 'B3'], 'before, between and after');
  eq(applyMerge([c('A1', '07:00'), c('A2', '07:00')], [c('B1', '07:00'), c('B2', '07:00')]),
    ['A1', 'A2', 'B1', 'B2'], 'ties: a new card goes AFTER the cards already showing that time, new ones keep their own order');
  eq(applyMerge([c('A1', '07:00'), c('A2', '08:00')], [c('B1', '07:00'), c('B2', '07:00'), c('B3', '07:30')]),
    ['A1', 'B1', 'B2', 'B3', 'A2'], 'several new cards landing before the same existing card stay in order');
  eq(applyMerge([c('X', undefined), c('A1', '09:00')], [c('B1', '08:00')]), ['X', 'B1', 'A1'],
    'a node that is none of this day\'s classes is never an insertion point');
  eq(applyMerge([c('A1', '07:00')], [c('B1', '06:00'), c('B2', '06:00')]), ['B1', 'B2', 'A1'], 'two new cards ahead of everything');
  {
    // Progressive all-studios load: batches arrive studio by studio, each
    // time-sorted, merged into what is already up. Same order as the old loop.
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const hh = () => String(6 + Math.floor(rnd() * 15)).padStart(2, '0') + ':' + (rnd() < 0.5 ? '00' : '30');
    let same = true;
    for (let round = 0; round < 40 && same; round++) {
      let domNew = [], domOld = [];
      for (let studio = 0; studio < 5; studio++) {
        const batch = Array.from({ length: 1 + Math.floor(rnd() * 12) }, (x, i) => c('s' + studio + '-' + i, hh()))
          .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
        const asCards = (ids, all) => ids.map((id) => all.find((k) => k.id === id));
        const all = domNew.concat(batch);
        domNew = asCards(applyMerge(domNew, batch), all);
        domOld = asCards(oldMerge(domOld, batch), domOld.concat(batch));
      }
      same = JSON.stringify(domNew.map((k) => k.id)) === JSON.stringify(domOld.map((k) => k.id)) &&
        domNew.every((k, i) => i === 0 || domNew[i - 1].start <= k.start);
    }
    ok(same, '200 random studio batches: identical to the old per-card loop, and always time-sorted');
  }

  // ── render(): the shipped lines ──────────────────────────────────────────
  t.section('Discover: render() batches an empty grid through the GLOBAL eventCard');
  const renderSrc = slice('function render(events, relations, filters, done) {', '// ── Studio multi-select chips');
  ok(/grid\.innerHTML = dayEvents\.map\(e => eventCard\(e, instrMap, studioMap, locationMap, typeMap\)\)\.join\(''\);/.test(renderSrc),
    'an empty day grid is one innerHTML — and calls the bare global eventCard, so the features.js / performance.js wrappers still apply');
  ok(/holder\.innerHTML = eventCard\(evt, instrMap, studioMap, locationMap, typeMap\);/.test(renderSrc), '…as does the merge path');
  ok(!/querySelectorAll\('\[data-id\]'\)/.test(renderSrc) && !/dayEvents\.find\(/.test(renderSrc),
    'the per-card grid re-query and the nested dayEvents.find are gone');
  ok(/_mergeInsertPoints\(kids\.map\(el => startById\.get\(el\.dataset\.id\)\), fresh\.map\(e => e\.start_at\)\)/.test(renderSrc),
    'cards already up are merged with the pure helper tested above');
  ok(/if \(!_dayInRange\(e\.start_at, filters\.startDate, filters\.endDateStr\)\) return false;/.test(renderSrc), "the wave-2 date bound is still in render()'s predicate");
  ok(/if \(done\) _saveLastResultsSoon\(events, relations, filters, dataAt\);/.test(renderSrc) && !/sessionStorage\.setItem/.test(renderSrc),
    'render() no longer serialises the window itself');
  ok(/_cardCountsFresh = _countsFresh\(dataAt, Date\.now\(\)\);/.test(renderSrc), 'render() decides per pass whether counts are recent enough to print');
  ok(/events === window\._windowEvents \? window\._windowFetchedAt : Date\.now\(\)/.test(renderSrc),
    "the age is the window's own stamp — one clock — and a list search() is still streaming in is new");
  // (Wave 8: the per-day body of render() is _paintDayGroup — still inside this slice — so a change of day can
  // repaint one day without a second pass over the window.)
  {
    const newGroupEnds = renderSrc.indexOf('    host.appendChild(group);\n  }\n');
    const countLine = renderSrc.search(/\n  const countEl = group\.querySelector\('\.day-count'\);\n  if \(countEl\) countEl\.textContent = dayEvents\.length \? _pagerCountText\(dayEvents\.length\) : '';/);
    ok(newGroupEnds !== -1 && countLine > newGroupEnds,
      'the day header count is refreshed on every pass, outside the new-group branch (a day fills up studio by studio) — and an empty day has none: the line under the heading already says it');
  }

  t.section('Discover: the last-results write is debounced');
  {
    const timers = [];
    const writes = [];
    const ctx = t.vm.createContext({
      Set, JSON, console,
      setTimeout: (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length; },
      clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].live = false; },
      sessionStorage: { setItem: (k, v) => writes.push([k, JSON.parse(v)]) },
      selectedTimeBands: new Set(['evening']), _availableOnly: true,
    });
    t.vm.runInContext(slice('let _lastResultsTimer = null;', 'function render(events, relations, filters, done) {'), ctx, { filename: 'js/app.js[last results]' });
    const f = (extra) => Object.assign({ instructorId: [], locationIds: ['3'], categoryKeys: new Set(['RIDE']), startDate: '2026-09-17', endDateStr: '2026-09-24' }, extra || {});
    ctx._saveLastResultsSoon([{ id: 1 }], { studios: [] }, f(), 111);
    ctx._saveLastResultsSoon([{ id: 2 }], { studios: [] }, f({ timeBands: new Set(['early']), availableOnly: false }), 222);
    eq([timers.length, timers.filter((x) => x.live).length, writes.length], [2, 1, 0], 'two renders in a burst: one write pending, none made yet');
    ok(timers[1].ms >= 500, 'the debounce is long enough to cover a burst of filter taps');
    timers.filter((x) => x.live).forEach((x) => x.fn());
    eq(writes.length, 1, 'one write for the burst');
    eq([writes[0][0], writes[0][1].events[0].id, writes[0][1].at], ['psycle_last_results', 2, 222], 'the LAST view is what is saved, with the age of its data');
    eq([writes[0][1].filters.timeBands, writes[0][1].filters.availableOnly, writes[0][1].filters.categoryKeys], [['early'], false, ['RIDE']], 'the Time row is saved with the other filters');
    ctx._saveLastResultsSoon([{ id: 3 }], { studios: [] }, f(), 0);
    timers.filter((x) => x.live).forEach((x) => x.fn());
    eq([writes[1][1].filters.timeBands, writes[1][1].filters.availableOnly, writes[1][1].at], [['evening'], true, 0],
      "search()'s own filters carry no Time row: the live pills are saved, and an unknown age is saved as 0");
  }

  // ── The Time row in render()'s predicate ──────────────────────────────────
  t.section('Discover: the Time row filters last, and never hides your own class');
  {
    const pred = slice('    // The Time row, LAST', "  const container = document.getElementById('results');");
    const ctx = t.loadPure('js/app.js', 'discover', {});
    t.vm.runInContext('var hiddenByTimeRow = 0;\nfunction passes(e, timeBands, availableOnly, _myBookings) {\n' +
      pred.slice(0, pred.lastIndexOf('});')) + '\n}', ctx, { filename: 'js/app.js[render time row]' });
    const ev = (id, start, full) => ({ id, start_at: start, is_fully_booked: !!full });
    ok(ctx.passes(ev(1, '2026-09-17T18:30:00'), bands('evening'), false, {}), 'evening keeps an 18:30');
    ok(!ctx.passes(ev(2, '2026-09-17T07:00:00'), bands('evening'), false, {}), 'evening hides a 07:00');
    ok(!ctx.passes(ev(3, '2026-09-17 18:30:00', true), bands(), true, {}), 'Available only hides a full class (space form, waitlist or not)');
    ok(ctx.passes(ev(4, '2026-09-17T18:30:00', false), bands(), true, {}), '…and keeps one with room');
    ok(ctx.passes(ev(5, '2026-09-17T18:30:00', true), bands(), true, { 5: { bookingId: 9, slots: [3] } }), 'a full class the member is BOOKED on stays listed');
    ok(ctx.passes(ev(6, '2026-09-17T18:30:00', true), bands(), true, { 6: { waitlisted: true } }), 'a full class the member is WAITLISTED on stays listed');
    ok(!ctx.passes(ev(7, '2026-09-17T07:00:00', true), bands('evening'), true, { 7: { bookingId: 1 } }), 'the time band still applies to a held class (only "Available only" makes the exception)');
    eq(ctx.hiddenByTimeRow, 3, 'every class the row hid was counted — the empty list says how many, and offers to show them');
    // Order: the row is the LAST test, so that count is exactly "what every other filter kept".
    const predicate = renderSrc.slice(renderSrc.indexOf('const filtered = events.filter(e => {'), renderSrc.indexOf("const container = document.getElementById('results');"));
    ok(predicate.indexOf('// The Time row, LAST') > predicate.indexOf('window._discoverQuery') &&
      predicate.indexOf('// The Time row, LAST') > predicate.indexOf('const locIds'), 'it comes after the studio and text tests');
    ok(/const timeBands = filters\.timeBands instanceof Set \? filters\.timeBands : selectedTimeBands;/.test(renderSrc),
      "filters without a Time row (search()'s own, a legacy session) fall back to the live pills — never a TypeError on .size");
    ok(/if \(hiddenByTimeRow > 0\) \{[\s\S]*?onclick="clearTimeFilters\(\)"/.test(renderSrc),
      'an empty list the Time row caused offers the one tap that lifts just that row (Find similar / Rebook keep what they set)');
    ok(!/class="no-results"[^`']*clearTimeFilters/.test(renderSrc), '…outside .no-results, which theme.js flattens to text');
  }

  // ── …nor at launch, when the list is drawn before /bookings has answered ──
  t.section('Discover: "Available only" brings back your own full class once the bookings land');
  {
    const world = (o) => {
      const w = { renders: 0, handlers: {}, onPage: new Set(o.onPage || []) };
      const ctx = t.vm.createContext({
        _availableOnly: o.availableOnly !== false, _myBookings: o.bookings || {},
        window: { _windowEvents: o.events },
        document: { querySelector: (sel) => { const m = /data-id="(\d+)"/.exec(sel); return m && /^#results \.class-card\[/.test(sel) && w.onPage.has(m[1]) ? {} : null; } },
        _renderWindowInPlace: () => { w.renders++; },
        PsycleEvents: { on: (evt, fn) => { w.handlers[evt] = fn; } },
      });
      t.vm.runInContext(slice("let _ownFullSeen = '';", '// ── Pick-a-date calendar'), ctx, { filename: 'js/app.js[_showOwnFullClasses]' });
      w.ctx = ctx;
      w.landed = () => w.handlers['bookings:loaded']();
      return w;
    };
    const events = [{ id: 501, is_fully_booked: true }, { id: 502, is_fully_booked: true }, { id: 503, is_fully_booked: false }];
    const held = { 501: { bookingId: null, slots: [], waitlisted: true }, 503: { bookingId: 9, slots: [4] } };
    let w = world({ events, bookings: held, onPage: ['503'] });
    ok(typeof w.handlers['bookings:loaded'] === 'function', 'it listens for bookings:loaded (fetchMyBookings itself stays free of Discover state)');
    w.landed();
    eq(w.renders, 1, 'the launch render filtered your waitlisted (= full) class out as somebody else\'s: the list is rebuilt in place, once');
    w.landed();
    eq(w.renders, 1, 'the next fetch with the same classes costs nothing — also when another filter is what hides the card');
    w.ctx._myBookings = Object.assign({ 502: { bookingId: 3, slots: [1] } }, held);
    w.landed();
    eq(w.renders, 2, 'a further full class of yours (booked elsewhere) is brought back too');
    w = world({ events, bookings: held, onPage: ['501', '503'] });
    w.landed();
    eq(w.renders, 0, 'already on the page (the list was drawn after the bookings): nothing to do');
    w = world({ events, bookings: held, availableOnly: false });
    w.landed();
    eq(w.renders, 0, '"Available only" off: nothing was hidden');
    w = world({ events: undefined, bookings: held });
    w.landed();
    eq(w.renders, 0, 'no window loaded yet: its first render already knows the bookings');
    w = world({ events, bookings: { 503: { bookingId: 9, slots: [4] } } });
    w.landed();
    eq(w.renders, 0, 'a held class that is not full was never hidden');
    ok(/_resyncDiscoverButtons\(true\);\n        \/\/[^\n]*\n        if \(typeof _showOwnFullClasses === 'function'\) _showOwnFullClasses\(\);/.test(app),
      'a /waitlists answer that lands after the deadline (no bookings:loaded of its own) runs the same check, typeof-guarded');
  }

  // ── Time row controls ─────────────────────────────────────────────────────
  t.section('Discover: Time row pills, persistence and the Tonight preset');
  {
    const box = { innerHTML: '' };
    const calls = { search: 0, facets: 0 };
    const ctx = t.loadPure('js/app.js', 'discover', {
      document: { getElementById: (id) => (id === 'timePills' ? box : null) },
      triggerAutoSearch: () => { calls.search++; },
      refreshFacetCounts: () => { calls.facets++; },
    });
    const api = t.vm.runInContext(slice('function _repaintKeepingFocus(box, html, selector) {', 'function renderReformerSubPills() {') +
      slice('const selectedTimeBands = new Set();', '// Allow pressing Enter to search') +
      '\n;({ state: () => ({ bands: Array.from(selectedTimeBands), available: _availableOnly }), renderTimePills, toggleTimeBand, toggleAvailableOnly, clearTimeFilters, setTimeFilters })',
      ctx, { filename: 'js/app.js[time row]' });
    eq((box.innerHTML.match(/<button /g) || []).length, 4, 'painted at load: three bands + Available only');
    eq((box.innerHTML.match(/class="cat-pill"/g) || []).length, 4, 'the existing pill class (no new CSS), none lit');
    eq((box.innerHTML.match(/aria-pressed="false"/g) || []).length, 4, 'every pill says it is off');
    ok(!/style=/.test(box.innerHTML), 'no inline style (it would beat the theme tokens)');
    api.toggleTimeBand('evening');
    eq([api.state(), calls.search, calls.facets], [{ bands: ['evening'], available: false }, 1, 1], 'a tap selects the band, re-filters and refreshes the chip counts');
    eq((box.innerHTML.match(/class="cat-pill active" aria-pressed="true"/g) || []).length, 1, 'the lit pill is pressed for assistive tech too');
    api.toggleTimeBand('early');
    eq(api.state().bands, ['evening', 'early'], 'bands are multi-select');
    api.toggleTimeBand('evening');
    eq(api.state().bands, ['early'], 'a second tap deselects');
    api.toggleAvailableOnly();
    eq([api.state().available, (box.innerHTML.match(/aria-pressed="true"/g) || []).length], [true, 2], 'Available only toggles on, and lights');
    api.clearTimeFilters();
    eq([api.state(), (box.innerHTML.match(/aria-pressed="true"/g) || []).length], [{ bands: [], available: false }, 0], 'clearTimeFilters lifts the whole row');
    ok(calls.search === 5 && calls.facets === 5, 'every change re-filters and re-counts');
    api.setTimeFilters(['evening', 'bogus', '__proto__', 'constructor'], true);
    eq(api.state(), { bands: ['evening'], available: true }, 'restore: only known band keys come back from localStorage');
    api.setTimeFilters('evening', 'true');
    eq(api.state(), { bands: [], available: false }, 'restore: a malformed save is "any time", and only a real true turns Available only on');
    api.setTimeFilters(undefined, undefined);
    eq(api.state(), { bands: [], available: false }, 'restore: a save from before the row existed is "any time"');
    ok(calls.search === 5, 'setTimeFilters does not search by itself (restoreFilters does, once, at its end)');
  }
  // A press rebuilds the row: the pressed pill's successor must get the focus,
  // or aria-pressed is never spoken and the next Tab leaves the row.
  {
    const focused = [];
    const doc = { activeElement: null, getElementById: (id) => (id === 'timePills' ? box : null) };
    const node = (i) => ({ i, focus(o) { doc.activeElement = this; focused.push([i, o]); } });
    const box = {
      html: '', children: [],
      get innerHTML() { return box.html; },
      set innerHTML(v) { box.html = v; box.children = (v.match(/<button /g) || []).map((m, i) => node(i)); },
    };
    const ctx = t.loadPure('js/app.js', 'discover', { document: doc, triggerAutoSearch() {}, refreshFacetCounts() {} });
    const api = t.vm.runInContext(slice('function _repaintKeepingFocus(box, html, selector) {', 'function renderReformerSubPills() {') +
      slice('const selectedTimeBands = new Set();', '// Allow pressing Enter to search') + '\n;({ toggleTimeBand, toggleAvailableOnly, _repaintKeepingFocus })', ctx, { filename: 'js/app.js[time row focus]' });
    eq(focused, [], 'the paint at load moves no focus');
    const pressed = box.children[2];
    doc.activeElement = pressed; // keyboard / VoiceOver focus on "After 5", then Space
    api.toggleTimeBand('evening');
    ok(doc.activeElement === box.children[2] && doc.activeElement !== pressed, 'Space on "After 5": the rebuilt pill at the same place has the focus (it fell to <body>; the pressed state was never announced)');
    eq(focused, [[2, { preventScroll: true }]], '…without scrolling the page to it');
    ok(/aria-pressed="true"[^>]*toggleTimeBand\('evening'\)/.test(box.innerHTML), '…and it is the node that now says aria-pressed="true"');
    doc.activeElement = box.children[3];
    api.toggleAvailableOnly();
    eq(focused[1], [3, { preventScroll: true }], '"Available only" keeps it the same way');
    doc.activeElement = { somewhere: 'else' };
    api.toggleTimeBand('early');
    eq(focused.length, 2, 'focus that was NOT in the row is never pulled into it (a repaint from Tonight, restore, Clear filters)');

    // The picker's change-chips sit inside a span: the row is found by selector.
    const chips = [node(0), node(1)];
    const hint = { innerHTML: '', querySelectorAll: (sel) => (sel === '.change-chip' ? chips : []) };
    doc.activeElement = chips[1];
    api._repaintKeepingFocus(hint, '<span>…</span>', '.change-chip');
    eq([hint.innerHTML, focused[2]], ['<span>…</span>', [1, { preventScroll: true }]], 'change-chips (inside the picker\'s focus trap) are matched by selector, not as direct children');
    api._repaintKeepingFocus({ innerHTML: '' }, 'x');
    api._repaintKeepingFocus({ innerHTML: '' }, 'x', '.change-chip');
    eq(focused.length, 3, 'a box with no children / no querySelectorAll (the suites\' stubs) is simply painted');
    const uses = (app.match(/_repaintKeepingFocus\(/g) || []).length;
    eq(uses, 8, 'the helper + seven rows: time, studios, class types, both sub-type rows, the change-chips, and the Filters bar\'s removable chips');
  }
  {
    const intSrc = t.readSource('js/interactions.js');
    const rStart = intSrc.indexOf('  function restoreFilters() {');
    const rEnd = intSrc.indexOf('  // Expose to global scope', rStart);
    const sStart = intSrc.indexOf('  function saveFilters() {');
    ok(rStart !== -1 && rEnd > rStart && sStart !== -1 && sStart < rStart, 'saveFilters / restoreFilters can be sliced');
    const world = (saved, withApp) => {
      const w = { restored: null, saved: null };
      const globals = {
        JSON, Array, String, Set,
        FILTERS_KEY: 'psycle_saved_filters',
        localStorage: { getItem: () => saved, setItem: (k, v) => { w.saved = JSON.parse(v); } },
        document: { getElementById: () => null },
      };
      if (withApp) {
        globals.setTimeFilters = (b, a) => { w.restored = [b, a]; };
        globals.selectedTimeBands = new Set(['evening']);
        globals._availableOnly = true;
      }
      const ctx = t.vm.createContext(globals);
      t.vm.runInContext("'use strict';\n" + intSrc.slice(sStart, rEnd), ctx, { filename: 'js/interactions.js[filters]' });
      w.ctx = ctx;
      return w;
    };
    let w = world(JSON.stringify({ timeBands: ['evening'], availableOnly: true }), true);
    w.ctx.restoreFilters();
    eq(w.restored, [['evening'], true], 'restoreFilters hands the saved Time row to app.js');
    w = world(JSON.stringify({ instructorIds: [] }), true);
    w.ctx.restoreFilters();
    eq(w.restored, [undefined, undefined], 'a legacy save clears it (setTimeFilters reads that as any time)');
    w = world(JSON.stringify({ timeBands: ['evening'] }), false);
    w.ctx.restoreFilters(); // strict code, app.js absent: must not throw past its own try
    eq(w.restored, null, 'without app.js (the launch-order test harness) the row is skipped, not thrown on');
    w = world(null, true);
    w.ctx.saveFilters();
    eq([w.saved.timeBands, w.saved.availableOnly], [['evening'], true], 'saveFilters writes the row');
    w = world(null, false);
    w.ctx.saveFilters();
    eq([w.saved.timeBands, w.saved.availableOnly], [[], false], '…and writes "any time" when app.js is absent');
    ['toggleTimeBand', 'toggleAvailableOnly', 'clearTimeFilters'].forEach((fn) => {
      ok(intSrc.indexOf("wrapGlobal('" + fn + "', saveFilters);") !== -1, fn + ' is persisted like the other filter toggles');
    });
  }
  {
    const tonight = slice("key: 'tonight', label: 'Tonight', apply() {", "key: 'strength', label: 'Strength'");
    ok(/selectedTimeBands\.clear\(\);\s*selectedTimeBands\.add\('evening'\);/.test(tonight), 'the Tonight preset selects the evening band (it used to list the 6am classes too)');
    const clear = slice('function clearFilters() {', 'function setStatus(html) {');
    ok(/selectedTimeBands\.clear\(\);\s*_availableOnly = false;/.test(clear) && /renderTimePills\(\);/.test(clear), 'Clear filters clears the Time row and repaints it');
    const cur = slice('function currentFilters() {', '// Lite per-event view');
    ok(/timeBands: new Set\(selectedTimeBands\),\s*availableOnly: _availableOnly,/.test(cur), 'currentFilters() carries a COPY of the row (a later tap cannot mutate a render in flight)');
    const facets = slice('function discoverFacets() {', 'function refreshFacetCounts() {');
    ok(/_inTimeBands\(c\.start_at, selectedTimeBands\)/.test(facets) && /_availableOnly && c\.full && !_myBookings\[c\.id\]/.test(facets),
      'the chip counts follow the Time row by the same two tests as render()');
    ok(/id: String\(e\.id\), full: !!e\.is_fully_booked/.test(slice('function _buildFacetClasses(', 'function _setWindow(')), '…and the lite facet view carries what those tests read');
    const restore = slice('function restoreLastResults() {', '// ── Instructor multi-select widget');
    ok(/timeBands: new Set\(saved\.filters\.timeBands \|\| \[\]\)/.test(restore) && /dataAt: Number\(saved\.at\) \|\| 0/.test(restore),
      'a restored session brings its own Time row and the age of its data (none = no counts)');
  }

  // ── eventCard: the shipped template ───────────────────────────────────────
  t.section('Discover: the card prints "Only N left" — and only from recent data');
  {
    const cardSrc = slice('function eventCard(evt, instrMap, studioMap, locationMap, typeMap) {', "// Feature 13's write, behind a trailing debounce");
    ok(cardSrc.indexOf('capacity_remaining') === -1, 'eventCard no longer waits for a field the API never sends');
    ok(!/badges/.test(cardSrc), 'the dead badges block is gone');
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    // Wave 9b: the card wears its class type (data-ct) and leads its title with
    // the pictogram — the SHIPPED helpers, not stand-ins.
    const classType = t.loadPure('js/app.js', 'class-type', { getCategory: t.loadPure('js/app.js', 'core').getCategory });
    const mk = (bookings) => {
      const ctx = t.loadPure('js/app.js', 'discover', {
        _myBookings: bookings || {}, _studioMap: { 7: { has_layout: true } },
        escapeHTML: esc, instrLink: (n) => esc(n), window: {},
        formatSlots: (l, s) => l + ' ' + s.join(' & '), slotLabel: () => 'Bike',
        classTypeKey: classType.classTypeKey, classPictogram: classType.classPictogram, _ccTimeHTML: classType._ccTimeHTML,
      });
      t.vm.runInContext('var _cardCountsFresh = true;\n' + cardSrc, ctx, { filename: 'js/app.js[eventCard]' });
      return ctx;
    };
    const maps = [{ 1: { id: 1, full_name: 'Alex <b>' } }, { 7: { id: 7, location_id: 3, name: 'Studio 1' } }, { 3: { id: 3, name: 'Psycle Bank' } }, { 2: { id: 2, name: 'Ride <45>' } }];
    const evt = (o) => Object.assign({ id: 501, instructor_id: 1, studio_id: 7, event_type_id: 2, start_at: '2026-09-17T18:30:00', duration: 45, capacity: 21, occupancy: 18 }, o || {});
    const card = (ctx, o) => ctx.eventCard(evt(o), maps[0], maps[1], maps[2], maps[3]);
    let ctx = mk();
    let html = card(ctx);
    ok(/<span class="cc-spots low" data-count>Only 3 left<\/span>/.test(html), '18/21 → "Only 3 left", in the low ink');
    ok(/<span class="cc-spots" data-count>16 spots left<\/span>/.test(card(ctx, { occupancy: 5 })), '5/21 → "16 spots left"');
    ok(/Only 1 left/.test(card(ctx, { occupancy: 20 })), '20/21 → "Only 1 left"');
    ok(!/cc-spots/.test(card(ctx, { occupancy: 21 })), '0 left on a class Psycle still calls bookable says nothing (the stale "Waitlist only" line is gone)');
    ok(!/cc-spots/.test(card(ctx, { capacity: undefined, occupancy: undefined })), 'no numbers → no line');
    html = card(ctx, { occupancy: 21, is_fully_booked: true, is_waitlistable: false });
    ok(/<span class="cc-spots">Fully booked<\/span>/.test(html) && !/Waitlist only/.test(html), 'full with no waitlist reads "Fully booked", not "Waitlist only" beside a Full button');
    ok(/(<button class="book-btn"[^>]*>Full<\/button>)/.test(html), "…and the Full button still matches features.js's notify-bell regex (wrapper contract)");
    ok(/<span class="cc-spots">Waitlist open<\/span>/.test(card(ctx, { occupancy: 21, is_fully_booked: true, is_waitlistable: true })), 'full + waitlistable → "Waitlist open"');
    ok(/<span class="cc-name" role="button" tabindex="0">Ride &lt;45&gt;<\/span>/.test(html), 'the class name is a keyboard-reachable button, and still escaped');
    // role="button" put the name on the press rule's "something inside is
    // pressed" list: a tap on the title — the card's full-width first line —
    // stopped the card pressing. It has no onclick of its own (the tap is the
    // card's), and the rule leaves it out by name.
    ok(!/<span class="cc-name"[^>]*onclick/.test(html), '…with no action of its own: a press on it is a press on the card');
    ok(/\.class-card:active:not\(:has\(:is\(button, a, \[role="button"\]:not\(\.cc-name\), \[onclick\]\):active\)\)/.test(t.readSource('css/tabs.css')),
      '…so the card\'s press feedback excludes it from the pressed-control list (every other role=button still holds the card still)');
    t.vm.runInContext('_cardCountsFresh = false;', ctx);
    html = card(ctx);
    ok(!/data-count/.test(html) && !/left</.test(html), 'data older than the limit: no number at all');
    ok(/Fully booked/.test(card(ctx, { is_fully_booked: true })), '…but "Fully booked" is not a count and still shows');
    ctx = mk({ 501: { bookingId: 9, slots: [12] } });
    ok(!/cc-spots/.test(card(ctx)) && /Bike 12 ✓/.test(card(ctx)), 'a class you are on shows your seat, not the spots left (the ✓ tick convention holds)');
    const hook = slice('let _cardCountsFresh = true;', 'function eventCard(evt');
    ok(/addEventListener\('visibilitychange'/.test(hook) && /_countsFresh\(window\._windowFetchedAt, Date\.now\(\)\)/.test(hook) && /\.cc-spots\[data-count\]/.test(hook),
      'back in the foreground, an aged number comes off cards that outlived their data');

    // …and RUN the shipped hook: the three strings above read the same with its
    // condition inverted (fresh counts stripped on every return, aged ones kept).
    // A context of its own — mk()'s `var _cardCountsFresh` clashes with the `let`.
    const MIN = 60 * 1000;
    const hw = { removed: 0, selectors: [], timers: [], cleared: [], labels: 0 };
    const doc = {
      hidden: false, handlers: {},
      addEventListener(type, fn) { doc.handlers[type] = fn; },
      querySelectorAll(sel) { hw.selectors.push(sel); return [0, 1, 2].map(() => ({ remove() { hw.removed++; } })); },
    };
    const win = {};
    const hctx = t.loadPure('js/app.js', 'discover', {
      document: doc, window: win,
      setTimeout: (fn, ms) => { hw.timers.push({ fn, ms }); return hw.timers.length; },
      clearTimeout: (id) => { hw.cleared.push(id); },
      renderLastUpdated: () => { hw.labels++; },
    });
    t.vm.runInContext(hook, hctx, { filename: 'js/app.js[counts hooks]' });
    const resume = (hidden, stamp) => { hw.removed = 0; hw.selectors = []; doc.hidden = hidden; win._windowFetchedAt = stamp; doc.handlers.visibilitychange(); return hw.removed; };
    ok(typeof doc.handlers.visibilitychange === 'function', 'the hook is registered on the document');
    eq(resume(true, Date.now() - 31 * MIN), 0, 'going INTO the background touches nothing');
    eq([resume(false, Date.now() - 31 * MIN), hw.selectors], [3, ['#results .cc-spots[data-count]']], 'back with data 31 minutes old: every count comes off — counts only, in the results list only');
    eq(resume(false, undefined), 3, 'back with no stamp at all (age unknown = old): off too');
    eq([resume(false, Date.now() - 5 * MIN), hw.selectors], [0, []], 'back with data 5 minutes old: the numbers stay (the inverted guard stripped exactly these)');

    // A page that stays visible fires no resume at all: render() arms a timer.
    hw.removed = 0; hw.selectors = [];
    hctx._armCountsExpiry(Date.now() - 10 * MIN);
    eq([hw.timers.length, Math.abs(hw.timers[0].ms - (20 * MIN + 1000)) < 2000], [1, true], 'counts printed from 10-minute-old data are due off in 20 minutes (30 − their age), just past the limit');
    hw.timers[0].fn();
    eq([hw.removed, hw.selectors, hw.labels], [3, ['#results .cc-spots[data-count]'], 1], 'when it fires the counts come off and the "Updated …" label is repainted (it does not tick by itself)');
    ok(!/revalidate|_discoverResumed|apiFetch|search\(/.test(hook.slice(hook.indexOf('function _armCountsExpiry('))), '…with no refetch: a visible tab must not poll Psycle every half hour');
    hctx._armCountsExpiry(Date.now());
    hctx._armCountsExpiry(Date.now());
    eq([hw.timers.length, hw.cleared.slice(-1)[0]], [3, 2], 'every render re-arms it: the pending one is cleared, never stacked');
    t.vm.runInContext('_cardCountsFresh = false;', hctx);
    hctx._armCountsExpiry(Date.now() - 45 * MIN);
    eq([hw.timers.length, hw.cleared.slice(-1)[0]], [3, 3], 'a pass that printed no counts (old data) clears the timer and arms none');
    ok(/_cardCountsFresh = _countsFresh\(dataAt, Date\.now\(\)\);\n  _armCountsExpiry\(dataAt\);/.test(renderSrc), 'render() arms it right after deciding the pass is fresh, with the same stamp');
  }

  // ── The in-place button sync keeps the line beside it in step ─────────────
  t.section('Discover: a card re-synced in place never reads "Only N left" beside "Join waitlist"');
  {
    eq([D._spotsHtml({ capacity: 21, occupancy: 19 }, null, true), D._spotsHtml({ capacity: 21, occupancy: 19 }, null, false), D._spotsHtml({ capacity: 21, occupancy: 19 }, { slots: [4] }, true)],
      ['<span class="cc-spots low" data-count>Only 2 left</span>', '', ''], '_spotsHtml: a count only from recent data, and never on a class the member holds');
    eq([D._spotsHtml({ is_fully_booked: true, is_waitlistable: true }, null, false), D._spotsHtml({ is_fully_booked: true }, null, false), D._spotsHtml(null, null, true)],
      ['<span class="cc-spots">Waitlist open</span>', '<span class="cc-spots">Fully booked</span>', ''], '…"full" is not a count: it shows whatever the age');

    // The SHIPPED _syncCardButtonsForEvent over one fake card. `line` is the
    // card's .cc-spots markup (null = no line).
    const syncSrc = slice('function _syncCardButtonsForEvent(eventId) {', '// bookClass found no free seat');
    const sync = (line, evt, o) => {
      o = o || {};
      const card = {
        line, dataset: { studioId: '7' }, classList: { remove() {} },
        querySelector(sel) {
          if (sel === '.cc-spots') {
            return card.line == null ? null : {
              hasAttribute: (a) => a === 'data-count' && / data-count>/.test(card.line),
              remove() { card.line = null; },
              set outerHTML(v) { card.line = v; },
            };
          }
          if (sel === '.cc-sub') return o.noSub ? null : { insertAdjacentHTML(pos, html) { card.at = pos; card.line = html; } };
          return null;
        },
      };
      const btn = { textContent: 'Book', className: 'book-btn', disabled: false, closest: () => card, removeAttribute() {} };
      const booked = [];
      const ctx = t.loadPure('js/app.js', 'discover', {
        _myBookings: o.bookings || {}, _eventCache: { 501: evt },
        document: { querySelectorAll: () => [btn] },
        applyBookedState: (b, id) => booked.push(id), bookClass: () => {},
      });
      t.vm.runInContext(syncSrc, ctx, { filename: 'js/app.js[_syncCardButtonsForEvent]' });
      ctx._syncCardButtonsForEvent(501);
      return { card, btn, booked };
    };
    const count = '<span class="cc-spots low" data-count>Only 2 left</span>';
    let r = sync(count, { is_fully_booked: true, is_waitlistable: true });
    eq([r.btn.textContent, r.card.line], ['Join waitlist', '<span class="cc-spots">Waitlist open</span>'], 'bookClass learned the class filled: the button AND the line say so ("Only 2 left" stayed beside Join waitlist)');
    r = sync(count, { is_fully_booked: true, is_waitlistable: false });
    eq([r.btn.textContent, r.btn.disabled, r.card.line], ['Full', true, '<span class="cc-spots">Fully booked</span>'], 'full with the waitlist closed: the line is rewritten BEFORE the Full branch returns');
    r = sync(null, { is_fully_booked: true, is_waitlistable: true });
    eq([r.card.line, r.card.at], ['<span class="cc-spots">Waitlist open</span>', 'afterend'], 'a card that had no line gains one, right after the instructor line');
    r = sync('<span class="cc-spots">Waitlist open</span>', { is_fully_booked: false, is_waitlistable: true });
    eq([r.btn.textContent, r.card.line], ['Book', null], 'a seat came back: "Waitlist open" does not stay beside Book');
    r = sync(count, { is_fully_booked: false });
    eq([r.btn.textContent, r.card.line], ['Book', count], 'a count on a class still bookable is left alone (no number is written from here, none is taken off)');
    r = sync(null, { is_fully_booked: true }, { noSub: true });
    eq([r.btn.textContent, r.card.line], ['Full', null], 'a card without the Discover markup gets a button, never a stray line');
    r = sync(count, { is_fully_booked: true }, { bookings: { 501: { bookingId: 9, slots: [12] } } });
    eq([r.booked, r.card.line], [[501], count], 'a class the member holds goes through applyBookedState as before (CSS hides the line on .is-booked)');

    const drop = slice('function _dropCardCounts(eventId) {', 'function _waitlistClassLine(');
    ok(/\.class-card\[data-id="\$\{Number\(eventId\)\}"\]:not\(\.my-booking-card\) \.cc-spots\[data-count\]/.test(drop), "_dropCardCounts takes only COUNTS off this class's Discover cards");
    const book = slice('async function bookClass(', '// Feature: skip the bike picker');
    ok(/if \(noSeatsLeft && !myBooking\) \{\n      btn\.disabled = false;\n      if \(typeof _dropCardCounts === 'function'\) _dropCardCounts\(eventId\);/.test(book),
      'bookClass calls it when no seat is free in a class Psycle has not called full (no flag changed, so nothing re-synced the card)');
  }

  t.section('Class detail sheet: the third row is availability, from recent data');
  {
    const sheet = slice('window.openClassDetail = function (eventId) {', '// Feature: Weekly Template Booking Engine');
    const avail = sheet.slice(sheet.indexOf('// Availability info'), sheet.indexOf('// My Bookings can open the sheet'));
    ok(avail.indexOf('capacity_remaining != null') === -1 && !/duration/.test(avail.replace(/\/\/[^\n]*/g, '')), 'no capacity_remaining gate and no duplicate "45 min" fallback');
    ok(/_countsFresh\(evt\._countsAt, Date\.now\(\)\) \? _spotsLeft\(evt\) : null/.test(avail), 'the count comes from _spotsLeft, only while the cache entry is recent');
    ok(/Full · waitlist open/.test(avail) && />Full</.test(avail), 'full classes say which kind of full');
    ok(sheet.indexOf('&#9898;') === -1, 'the blank pale circle icon is gone');
    ok(/_countsAt: dataAt,/.test(renderSrc), 'render() stamps each cache entry with the age of the numbers it just wrote');
  }

  // ── Markup / CSS / ARIA ──────────────────────────────────────────────────
  t.section('Discover: Time row markup, sticky day headers, pressed state');
  {
    const html = t.readSource('psycle-finder.html');
    const body = html.slice(html.indexOf('id="controlsBody"'), html.indexOf('id="upcomingPanel"'));
    ok(/<div id="timePills" class="location-chips"><\/div>/.test(body), '#timePills sits in #controlsBody with the pill-row class redesign.css / discover-layout-fix.css already style');
    // The date row left #controlsBody (it is always on screen, above the Filters
    // bar — tests/suites/8a-filters.js), so Time now leads the collapsible panel.
    const panel = html.slice(html.indexOf('id="controlsPanel"'), html.indexOf('id="upcomingPanel"'));
    ok(panel.indexOf('id="timePills"') > panel.indexOf('id="daysAhead"') && body.indexOf('id="timePills"') < body.indexOf('id="locationChips"'), '…after Date, ahead of the studios');
    eq((panel.match(/class="date-quick-btn" aria-pressed="false"/g) || []).length, 5, 'the five date presets (Today · Tomorrow · 7 days · Next week · 14 days) start un-pressed (JS mirrors .active from there)');
    ok(/id="pickDateBtn"[^>]*aria-expanded="false"[^>]*aria-controls="datePicker"/.test(panel), 'the calendar button says expanded/collapsed instead');
    const mirror = slice('function _mirrorDatePillAria() {', '// Paint the date row from state');
    ok(/b\.id === 'pickDateBtn'\) b\.setAttribute\('aria-expanded'/.test(mirror) && /b\.setAttribute\('aria-pressed', String\(b\.classList\.contains\('active'\)\)\)/.test(mirror),
      '_mirrorDatePillAria copies .active to aria-pressed, and the open calendar to aria-expanded');
    ok(/function updateFiltersSummary\(\) \{\n  _mirrorDatePillAria\(\);/.test(app), 'it runs first thing in updateFiltersSummary — before the early return for a missing summary element');
    ok(/_mirrorDatePillAria\(\);[^\n]*\n\}\n\nfunction setDateQuick/.test(app), '…and at the end of _syncDatePills (search() repaints the row without the summary)');
    ok(/class="loc-chip\$\{allActive \? ' active' : ''\}" aria-pressed="\$\{allActive\}"/.test(app) && /class="loc-chip\$\{active \? ' active' : ''\}\$\{dim\}" aria-pressed="\$\{active\}"/.test(app), 'studio chips carry aria-pressed');
    ok(/class="cat-pill\$\{active \? ' active' : ''\}\$\{dim\}" aria-pressed="\$\{active\}"/.test(app), 'class-type pills carry aria-pressed');
    eq((app.match(/class="sub-pill\$\{active \? ' active' : ''\}" aria-pressed="\$\{active\}"/g) || []).length, 2, 'both sub-pill rows carry aria-pressed');
    const cal = slice('function renderCalendar() {', '// Fetch the full window (every studio) for a date range.');
    ok(/aria-label="\$\{escapeHTML\(name\)\}" aria-pressed="\$\{ds === sel\}"/.test(cal) && /past \? ' disabled'/.test(cal), 'calendar days: a full-date name, pressed state, and gone days disabled');
    ok(/class="instructor-link" role="button" tabindex="0"/.test(app), 'instructor links are keyboard-reachable buttons');

    const css = t.readSource('css/redesign.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const base = css.slice(css.indexOf('.day-header {'), css.indexOf('}', css.indexOf('.day-header {')));
    ok(!/position:\s*sticky/.test(base), 'the base .day-header is not sticky (desktop: the tab bar is what sticks to the top)');
    // Wave 8: a range is paged one day at a time, and what stays on screen on a phone is the DAY STRIP — same
    // rule the sticky header had (only where .tab-content scrolls; above the cards; solid page background).
    ok(!/\.day-header \{[^}]*position:\s*sticky/.test(css), 'no .day-header rule sticks any more (two stuck bars would stack)');
    const strip = css.slice(css.indexOf('.day-strip {'), css.indexOf('}', css.indexOf('.day-strip {')));
    const m = css.match(/@media \(max-width: 640px\) \{\s*\.day-strip \{([^}]*)\}/);
    ok(!/position:\s*sticky/.test(strip) && !!m && /position:\s*sticky/.test(m[1]) && /top:\s*0/.test(m[1]) && /z-index:\s*\d/.test(m[1]) && /background:\s*var\(--bg\)/.test(strip),
      'at <=640px (where .tab-content scrolls) the day strip sticks, above the cards, on the page background token');
    const count = css.slice(css.indexOf('.day-count {'), css.indexOf('}', css.indexOf('.day-count {')));
    ok(/var\(--text-sm\)/.test(count) && /var\(--ink-3\)/.test(count) && !/#[0-9a-f]{3,6}\b/i.test(count) && !/\d+px/.test(count), '.day-count is tokens only');
    ok(/\.class-card\.is-booked \.cc-spots, \.class-card\.is-waitlisted \.cc-spots \{ display: none; \}/.test(css), 'a card booked in place drops its "spots left" line');
    ok(/<div class="day-header"><span>\$\{dayLabel\}<\/span><span class="day-count"><\/span><\/div>/.test(renderSrc), 'render() builds the header the CSS expects');
    // The wording moved to pure:day-pager (_pagerDayLabel — tests/suites/8b-day-pager.js holds it to the old
    // strings); render() must still ask it for the single-day form, "Today · 18 September".
    ok(/const label = _pagerDayLabel\(day, m\.todayStr\);\n    const dayLabel = escapeHTML\(m\.paged \? label\.long : label\.head\);/.test(renderSrc) &&
      /const rel = day === todayStr \? 'Today' : day === tomorrowStr \? 'Tomorrow' : '';/.test(app), 'Today / Tomorrow are named in the header');
  }
};
