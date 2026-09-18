'use strict';
// What decides which classes a member sees, and what they are told they booked:
//   • PsycleFacets.run (js/facets.js, loaded as-is) — the filter match and the
//     live counts on every instructor / studio / category control,
//   • js/app.js's pure:core blocks — class type → category and seat noun, the
//     /bookings seat parser, the local-day helpers behind "book my week", and
//     the recent-search signature.
// The two meet in _buildFacetClasses (cat = getCategory(type).key), so a wrong
// category is a wrong pill count AND a class hidden behind a filter.
// The runner is pinned to America/New_York: dates are built with the local
// constructor, never parsed from ISO strings.
module.exports = function (t) {
  const { ok, eq } = t;
  const facetsSrc = t.readSource('js/facets.js');
  const appSrc = t.readSource('js/app.js');

  // ── PsycleFacets.run ─────────────────────────────────────────────────────
  t.section('PsycleFacets.run (js/facets.js): matching');
  const bare = t.vm.createContext({});
  t.vm.runInContext(facetsSrc, bare, { filename: 'js/facets.js' });
  ok(bare.PsycleFacets && typeof bare.PsycleFacets.run === 'function', 'with no window (a worker, this runner) it attaches to globalThis');
  const withWindow = t.vm.createContext({ window: {} });
  t.vm.runInContext(facetsSrc, withWindow, { filename: 'js/facets.js' });
  ok(typeof withWindow.window.PsycleFacets.run === 'function' && withWindow.PsycleFacets === undefined, 'in a page it attaches to window only');
  const run = bare.PsycleFacets.run;

  // Deliberately out of time order, and day 19 first.
  const classes = [
    { id: 1, _instrName: 'Alex', _typeName: 'RIDE: 45', _locName: 'Oxford Circus', start_at: '2026-09-19 07:30:00' },
    { id: 2, _instrName: 'Alex', _typeName: 'STRENGTH: Lower Body', _locName: 'Shoreditch', start_at: '2026-09-18 18:00:00' },
    { id: 3, _instrName: 'Sam', _typeName: 'RIDE: 45', _locName: 'Oxford Circus', start_at: '2026-09-18 07:30:00' },
    { id: 4, _instrName: 'Sam', _typeName: 'YOGA: Flow', _locName: 'Clapham', start_at: '2026-09-18 12:00:00' },
    { id: 5, _instrName: 'Jo', _typeName: 'RIDE: 45', _locName: 'Shoreditch', start_at: '2026-09-20 09:00:00' },
  ];
  const ids = (r) => r.results.map((c) => c.id);
  const counts = (r, dim) => r.facets[dim].map((o) => o.value + ':' + o.count);

  let r = run(classes, {});
  eq([ids(r), r.total], [[1, 2, 3, 4, 5], 5], 'no selection = no constraint: every class, in the order given');
  eq(ids(run(classes, { instructor: [], category: [], location: [] })), [1, 2, 3, 4, 5], 'empty arrays are no constraint either');
  eq(ids(run(classes, { instructor: ['Alex'] })), [1, 2], 'one instructor');
  eq(ids(run(classes, { instructor: ['Alex', 'Jo'] })), [1, 2, 5], 'two values in ONE dimension are OR (multi-select)');
  eq(ids(run(classes, { instructor: ['Alex', 'Jo'], location: ['Shoreditch'] })), [2, 5], 'different dimensions are AND');
  eq(ids(run(classes, { instructor: ['Alex'], location: ['Shoreditch'], category: ['RIDE: 45'] })), [], 'all three dimensions must hold');
  eq(ids(run(classes, { instructor: 'Alex' })), [1, 2], 'a bare string is a one-value selection');
  eq([ids(run(classes, { instructor: '' })).length, ids(run(classes, { instructor: null })).length, ids(run(classes, { instructor: [null, ''] })).length], [5, 5, 5],
    "'' / null / [null, ''] are no selection (a cleared control must not hide everything)");
  const snapshot = JSON.stringify(classes);
  const chosen = { instructor: ['Sam', 'Alex'] };
  run(classes, chosen, {});
  eq([JSON.stringify(classes), chosen.instructor], [snapshot, ['Sam', 'Alex']], 'the class window and the selection are left exactly as they were');
  r = run(null, null);
  eq([r.results, r.total, r.groups, r.facets], [[], 0, [], { instructor: [], category: [], location: [] }], 'nothing fetched yet: an empty result, not a throw');

  t.section('PsycleFacets.run: counts narrow by the OTHER filters, never by their own');
  r = run(classes, {});
  eq([counts(r, 'instructor'), counts(r, 'location')], [['Alex:2', 'Jo:1', 'Sam:2'], ['Clapham:1', 'Oxford Circus:2', 'Shoreditch:2']], 'unfiltered: every option, A–Z, with its class count');
  ok(r.facets.instructor.every((o) => o.available === true && o.selected === false), '…all available, none selected');

  r = run(classes, { instructor: ['Alex'] });
  eq(counts(r, 'instructor'), ['Alex:2', 'Jo:1', 'Sam:2'], 'picking Alex does not zero the other instructors — a second pick (OR) would add their classes');
  eq(r.facets.instructor.filter((o) => o.selected).map((o) => o.value), ['Alex'], '…and Alex is flagged selected');
  eq(counts(r, 'location'), ['Clapham:0', 'Oxford Circus:1', 'Shoreditch:1'], '…while studios show only where Alex teaches');
  eq(r.facets.location.filter((o) => !o.available).map((o) => o.value), ['Clapham'], '…and a studio with nothing left is kept in the list, flagged unavailable (dimmed, not removed)');
  eq(counts(r, 'category'), ['RIDE: 45:1', 'STRENGTH: Lower Body:1', 'YOGA: Flow:0'], '…same for class types');

  r = run(classes, { instructor: ['Alex', 'Jo'], location: ['Shoreditch'] });
  eq(counts(r, 'instructor'), ['Alex:1', 'Jo:1', 'Sam:0'], 'two filters: instructor counts follow the studio filter only');
  eq(counts(r, 'location'), ['Clapham:0', 'Oxford Circus:1', 'Shoreditch:2'], '…studio counts follow the instructor filter only');
  eq(r.total, r.facets.location.filter((o) => o.selected).reduce((n, o) => n + o.count, 0), 'the selected options\' counts add up to the result total');
  r = run(classes, { instructor: ['Nobody'] });
  eq([r.total, counts(r, 'instructor')], [0, ['Alex:2', 'Jo:1', 'Sam:2']], 'a selection that matches nothing still lists the ways out');

  t.section('PsycleFacets.run: search text, date window, fixed option lists, day groups');
  eq(ids(run(classes, { query: 'yoga' })), [4], 'the query matches the class type, any case');
  eq([ids(run(classes, { query: '  RIDE ' })), ids(run(classes, { query: 'clapham' })), ids(run(classes, { query: 'jo' }))], [[1, 3, 5], [4], [5]], '…is trimmed, and also matches studio and instructor');
  eq(counts(run(classes, { query: 'yoga' }), 'instructor'), ['Sam:1'], 'the query narrows the option lists too (it is a prefilter, not a dimension)');
  const on18 = { dateFilter: (c) => c.start_at.slice(0, 10) === '2026-09-18' };
  r = run(classes, {}, on18);
  eq([ids(r), counts(r, 'instructor')], [[2, 3, 4], ['Alex:1', 'Sam:2']], 'dateFilter: a chip never promises classes from days that are not showing');
  r = run(classes, { instructor: ['Alex'] }, { universes: { location: ['Shoreditch', 'Kings Cross', 'Clapham'] } });
  eq(counts(r, 'location'), ['Shoreditch:1', 'Kings Cross:0', 'Clapham:0'], 'universes: a fixed option list keeps its own order, including options with no class at all');
  eq(counts(r, 'instructor'), ['Alex:2', 'Jo:1', 'Sam:2'], '…other dimensions still derive theirs');

  r = run(classes, {});
  eq(r.groups.map((g) => g.date), ['2026-09-18', '2026-09-19', '2026-09-20'], 'groups: one per calendar day, earliest first (the 19th came first in the input)');
  eq(r.groups[0].items.map((c) => c.id), [3, 4, 2], 'groups: within a day, by start time (07:30, 12:00, 18:00)');
  eq(run(classes, { location: ['Shoreditch'] }).groups.map((g) => [g.date, g.items.length]), [['2026-09-18', 1], ['2026-09-20', 1]], 'groups hold only the matching classes — no empty days');

  r = run([{ instructor_name: 'Ana', class_type: 'BARRE', location_name: 'Mortimer St', start: '2026-09-21 10:00:00' },
    { _instrName: 'Bea', _category: 'RIDE', _typeName: 'RIDE: 45', _locName: 'Clapham', start_at: '2026-09-21 08:00:00' }], {});
  eq([counts(r, 'instructor'), counts(r, 'category'), counts(r, 'location'), r.groups[0].items.length],
    [['Ana:1', 'Bea:1'], ['BARRE:1', 'RIDE:1'], ['Clapham:1', 'Mortimer St:1'], 2],
    'default accessors: the plain API field names work, and _category wins over _typeName');

  // ── pure:core ────────────────────────────────────────────────────────────
  const core = t.loadPure('js/app.js', 'core');

  t.section('getCategory / slotLabel (js/app.js pure:core): real Psycle class names');
  const table = [
    ['RIDE: 45', 'RIDE', 'Bike'],
    ['RIDE: STRENGTH 45', 'RIDE', 'Bike'], // a ride with a strength block is still on a bike
    ['REFORMER: Strength 50', 'PILATES', 'Bed'], // equipment beats the discipline word
    ['REFORMER: Signature 55', 'PILATES', 'Bed'],
    ['LAGREE: Upper Body & Core', 'LAGREE', 'Machine'],
    ['LAGREE: Strength', 'LAGREE', 'Machine'], // never leaks into Strength
    ['MEGAFORMER 50', 'LAGREE', 'Machine'],
    ['STRENGTH: Lower Body', 'STRENGTH', 'Bench'],
    ['STRENGTH: Upper Body', 'STRENGTH', 'Bench'],
    ['STRENGTH: Full Body', 'STRENGTH', 'Bench'],
    ['YOGA: Flow', 'YOGA', 'Spot'],
    ['HIIT 45', 'HIIT', 'Spot'],
    ['BARRE: Sculpt', 'BARRE', 'Spot'],
    ['PILATES: Mat', 'PILATES', 'Bed'],
    ['ride: 45', 'RIDE', 'Bike'], // case-insensitive
    ['Sound Bath', 'OTHER', 'Spot'],
  ];
  table.forEach(([name, key, noun]) => eq([core.getCategory(name).key, core.slotLabel(name)], [key, noun], name + ' → ' + key + ' / ' + noun));
  eq(['', null, undefined].map((n) => [core.getCategory(n).key, core.slotLabel(n)]), [['OTHER', 'Spot'], ['OTHER', 'Spot'], ['OTHER', 'Spot']], 'a missing class name is Other / Spot, never a throw');
  const mapKeys = t.vm.runInContext('CATEGORY_MAP.map(c => c.key)', core);
  ok(new Set(mapKeys).size === mapKeys.length && mapKeys.indexOf('OTHER') !== -1, 'CATEGORY_MAP: distinct keys, and the OTHER catch-all getCategory falls back to exists (without it every unknown class throws)');
  ok(table.every(([, key]) => mapKeys.indexOf(key) !== -1) && t.vm.runInContext('CATEGORY_MAP.every(c => !!c.label && !!c.color)', core),
    '…every category a class can land in has a pill (label + colour)');

  t.section('Category → facet counts, in the shape the app feeds PsycleFacets');
  ok(/instr: String\(e\.instructor_id\)/.test(appSrc) && /loc: String\(/.test(appSrc) && /cat: getCategory\(/.test(appSrc),
    '_buildFacetClasses hands run() STRING ids and a category key — the selections are Sets of strings and run() compares strictly');
  const lite = [
    { instructor_id: 31, location_id: 1, type: 'RIDE: 45', start_at: '2026-09-18 07:30:00' },
    { instructor_id: 31, location_id: 2, type: 'RIDE: STRENGTH 45', start_at: '2026-09-18 18:00:00' },
    { instructor_id: 44, location_id: 1, type: 'REFORMER: Strength 50', start_at: '2026-09-18 12:00:00' },
    { instructor_id: 44, location_id: 2, type: 'STRENGTH: Lower Body', start_at: '2026-09-19 09:00:00' },
  ].map((e) => ({ instr: String(e.instructor_id), loc: String(e.location_id), cat: core.getCategory(e.type).key, start_at: e.start_at }));
  const appShape = { accessors: { instructor: (c) => c.instr, location: (c) => c.loc, category: (c) => c.cat } };
  r = run(lite, { instructor: [], location: [], category: [] }, appShape);
  eq(counts(r, 'category'), ['PILATES:1', 'RIDE:2', 'STRENGTH:1'], 'pill counts: the strength ride counts as Ride, the strength reformer as Pilates — Strength is 1, not 3');
  r = run(lite, { instructor: ['31'], location: [], category: ['STRENGTH'] }, appShape);
  eq([r.total, counts(r, 'category'), counts(r, 'instructor')], [0, ['PILATES:0', 'RIDE:2', 'STRENGTH:0'], ['31:0', '44:1']],
    'instructor 31 + Strength: nothing — and the counts say why (31 only rides; 44 has the strength class)');

  t.section('pluralizeSlotLabel / formatSlots / _parseSlots (js/app.js pure:core)');
  eq([core.formatSlots('Bike', [7]), core.formatSlots('Bike', [7, 12]), core.formatSlots('Bench', [12, 15]), core.formatSlots('Bed', [1, 2, 3]), core.formatSlots('Machine', [4, 5])],
    ['Bike 7', 'Bikes 7 & 12', 'Benches 12 & 15', 'Beds 1 & 2 & 3', 'Machines 4 & 5'], 'one seat is singular; several are plural — "Benches", not "Benchs"');
  eq([core.pluralizeSlotLabel('bench'), core.pluralizeSlotLabel('bike'), core.pluralizeSlotLabel('Spot')], ['benches', 'bikes', 'Spots'], 'the picker\'s lower-case nouns pluralise the same way');
  eq([core.formatSlots('Bike', []), core.formatSlots('Bike', null), core.pluralizeSlotLabel('')], ['', '', ''], 'no seats / no noun → empty, never "Bikes undefined"');

  eq(core._parseSlots([7, 15]), [7, 15], 'seat numbers');
  eq(core._parseSlots([{ id: 7, label: '12' }, { id: 8, label: '14' }]), [12, 14], 'objects: the printed label is what the member sees on the bike, so it wins over the internal id');
  eq([core._parseSlots([{ slot_id: 7, number: 12 }]), core._parseSlots([{ slot_number: 4, id: 99 }]), core._parseSlots([{ id: 3 }]), core._parseSlots([{ slot_id: 8 }])], [[12], [4], [3], [8]],
    'objects: number / slot_number, then id / slot_id');
  eq(core._parseSlots([{ label: null, number: 6 }]), [6], 'a null label falls through to the next field');
  eq([core._parseSlots('7'), core._parseSlots(7), core._parseSlots({ id: 9 })], [[7], [7], [9]], 'a lone value (string, number or object) is a one-seat list');
  eq([core._parseSlots(null), core._parseSlots(undefined), core._parseSlots(0), core._parseSlots(''), core._parseSlots([])], [[], [], [], [], []], 'nothing → no seats');
  eq(core._parseSlots([null, 0, 'x', 5, '6']), [5, 6], 'junk entries are dropped, numeric strings kept — never a NaN or 0 seat on a card');

  t.section('Local-day helpers (js/app.js pure:core) — runner pinned to New York');
  const late = new Date(2026, 8, 18, 21, 30); // Fri 18 Sep, 21:30 in New York = 01:30 on the 19th in UTC
  eq([late.getDay(), late.toISOString().slice(0, 10)], [5, '2026-09-19'], '(fixture: a Friday evening that is already tomorrow in UTC)');
  eq(core.localDateStr(late), '2026-09-18', 'localDateStr is the DEVICE\'s calendar day — toISOString() would say the 19th');
  eq([core.localDateStr(new Date(2026, 0, 5, 0, 0)), core.localDateStr(new Date(2026, 11, 31, 23, 59))], ['2026-01-05', '2026-12-31'], 'zero-padded, right at both ends of a day');
  ok(/^\d{4}-\d{2}-\d{2}$/.test(core.localDateStr()), 'no argument → today');
  const parsed = core.parsePsycleDate('2026-09-18 07:30:00');
  eq([parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), parsed.getHours(), parsed.getMinutes()], [2026, 8, 18, 7, 30], "parsePsycleDate: the API's space-separated form is wall-clock time");
  eq(core.parsePsycleDate('2026-09-18T07:30:00').getTime(), parsed.getTime(), '…identical to the T form');
  eq([core.parsePsycleDate(''), core.parsePsycleDate(null), core.parsePsycleDate(undefined)], [null, null, null], 'nothing to parse → null');
  // V8 parses the space form anyway; iOS WebKit answers Invalid Date, so the swap itself is what matters.
  ok(/function parsePsycleDate\(v\) \{\s*return v \? new Date\(String\(v\)\.replace\(' ', 'T'\)\) : null;/.test(appSrc), '…and the space is swapped for a T before parsing (iOS WebKit rejects the space form)');

  const fri = (h, m) => new Date(2026, 8, 18, h, m);
  eq([5, 6, 0, 1, 4].map((d) => core._upcomingWeekdayDate(d, fri(9, 0))), ['2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21', '2026-09-24'],
    '_upcomingWeekdayDate: today counts as day 0, then the next six days');
  eq(core._upcomingWeekdayDate('0', fri(9, 0)), '2026-09-20', 'a weekday stored as a string works');
  eq(core._upcomingWeekdayDate(5, fri(6, 0), 7 * 60 + 30), '2026-09-18', "today's 07:30 class, asked at 06:00 → today");
  eq(core._upcomingWeekdayDate(5, fri(9, 0), 7 * 60 + 30), '2026-09-25', "today's 07:30 class, asked at 09:00 → it has gone: NEXT Friday, not this morning's class");
  eq(core._upcomingWeekdayDate(5, fri(7, 30), 7 * 60 + 30), '2026-09-25', 'asked on the minute it starts → next week');
  eq(core._upcomingWeekdayDate(4, fri(9, 0), 7 * 60 + 30), '2026-09-24', 'the class time only matters for today\'s weekday');
  eq(core._upcomingWeekdayDate(5, late), '2026-09-18', 'late evening: still the device\'s Friday, not UTC\'s Saturday');
  eq([core._upcomingWeekdayDate(5, new Date(2026, 8, 28, 12, 0)), core._upcomingWeekdayDate(1, new Date(2026, 9, 31, 12, 0))], ['2026-10-02', '2026-11-02'],
    'across a month end, and across the night the clocks go back (a 25-hour day)');
  const asked = fri(9, 0);
  core._upcomingWeekdayDate(1, asked);
  eq(asked.getTime(), fri(9, 0).getTime(), 'the date passed in is not moved');

  t.section('_searchSignature (js/app.js pure:core): recent searches dedupe whatever order they were built in');
  const sig = core._searchSignature;
  const base = { instructors: ['31', '44'], locations: ['1', '2'], categories: ['RIDE', 'BARRE'], dateMode: 'week', startDate: '2026-09-18', daysAhead: '7' };
  const with_ = (o) => Object.assign({}, base, o);
  eq(sig(with_({ instructors: ['44', '31'], locations: ['2', '1'], categories: ['BARRE', 'RIDE'] })), sig(base), 'the same picks in another order are the same search');
  eq(sig(with_({ instructors: [44, 31] })), sig(base), 'ids as numbers or strings are the same search');
  ok(sig(with_({ instructors: ['31'] })) !== sig(base) && sig(with_({ locations: [] })) !== sig(base) && sig(with_({ categories: ['RIDE'] })) !== sig(base), 'a different instructor / studio / category set is a different search');
  ok(sig(with_({ instructors: ['1'], locations: [] })) !== sig(with_({ instructors: [], locations: ['1'] })), 'instructor 1 is not studio 1');
  eq(sig(with_({ startDate: '2026-10-01', daysAhead: '14' })), sig(base), 'with a quick range (Today / 7 days…) the stored dates are ignored — "7 days" means the same search tomorrow');
  ok(sig(with_({ dateMode: 'today' })) !== sig(base), 'another quick range is another search');
  ok(sig(with_({ dateMode: null })) !== sig(with_({ dateMode: null, startDate: '2026-10-01' })) && sig(with_({ dateMode: null })) !== sig(with_({ dateMode: null, daysAhead: '14' })),
    'with explicit dates, the start date and the length both count');
  const picks = ['44', '31'];
  sig({ instructors: picks });
  eq(picks, ['44', '31'], "the saved search's own arrays are not re-ordered");
  eq(sig({}), sig({ instructors: [], locations: [], categories: [], dateMode: null, startDate: '', daysAhead: '' }), 'an older saved search with fields missing still gets a signature');
};
