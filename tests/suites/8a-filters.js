'use strict';
// Wave 8a — "Date range filter should be exposed, all other filters should be
// minimised as default" (a product designer's review of the iPhone app).
//
//   • the date row is always on screen, above ONE Filters bar;
//   • Time / Location / Class Type / Instructor sit behind that bar, collapsed
//     at every launch below 1024px and never stored;
//   • while collapsed, every active filter is a removable chip beside the bar,
//     and removing one goes through the SAME function the panel's own control
//     calls (so the focus stash, saveFilters and the live re-filter all behave).
//
// The decision logic is js/app.js's pure:filter-summary block; the painter and
// the chip dispatcher are the SHIPPED functions, sliced out of source and run
// against small fakes.
module.exports = function (t) {
  const { ok, eq } = t;
  const appSrc = t.readSource('js/app.js');
  const html = t.readSource('psycle-finder.html');
  const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
  const redesign = noComments(t.readSource('css/redesign.css'));
  const styles = noComments(t.readSource('css/styles.css'));
  const between = (src, from, to, what) => {
    const a = src.indexOf(from), b = src.indexOf(to, a + 1);
    if (a === -1 || b === -1) throw new Error('8a-filters suite: cannot slice ' + what + ' (anchor moved?)');
    return src.slice(a, b);
  };
  const grab = (src, opener) => {
    const lines = src.split('\n');
    const from = lines.findIndex((l) => l.startsWith(opener));
    const to = lines.findIndex((l, i) => i > from && l === '}');
    if (from === -1 || to === -1) throw new Error('8a-filters suite: cannot slice "' + opener + '" (anchor moved?)');
    return lines.slice(from, to + 1).join('\n');
  };
  // A top-level `const NAME = [ … ];` out of app.js, as a value.
  const constList = (name) => {
    const src = between(appSrc, 'const ' + name + ' = [', '\n];', name) + '\n];';
    return t.vm.runInNewContext(src + '\n' + name + ';');
  };

  const P = t.loadPure('js/app.js', 'filter-summary');
  const CATEGORY_MAP = constList('CATEGORY_MAP');
  const STRENGTH_SUBS = constList('STRENGTH_SUBS');
  const REFORMER_SUBS = constList('REFORMER_SUBS');
  const TIME_BANDS = constList('TIME_BANDS');
  const MAPS = {
    // Deliberately NOT in id order: the panel lists studios as Psycle sends them.
    locations: [{ id: 30, name: 'Psycle Shoreditch' }, { id: 4, name: 'Psycle Bank' }, { id: 12, name: 'Psycle Oxford Circus' }],
    instructors: [{ id: 1, name: 'Alex Morgan' }, { id: 2, name: 'Blake Chen' }, { id: 3, name: 'Casey Díaz' }, { id: 4, name: 'Dev Patel' }],
    categories: CATEGORY_MAP, strengthSubs: STRENGTH_SUBS, reformerSubs: REFORMER_SUBS, timeBands: TIME_BANDS,
  };
  const ALL_STRENGTH = STRENGTH_SUBS.map((s) => s.key), ALL_REFORMER = REFORMER_SUBS.map((s) => s.key);
  const chips = (state) => P._filterSummaryChips(Object.assign({ strengthSubs: ALL_STRENGTH, reformerSubs: ALL_REFORMER }, state), MAPS);
  const labels = (state) => chips(state).map((c) => c.label);

  // ── pure: which chips ────────────────────────────────────────────────────
  t.section('Filters bar: the active filters, one removable chip each (js/app.js pure:filter-summary)');
  ok(typeof P._filterSummaryChips === 'function' && typeof P._filtersBarName === 'function', 'the pure block defines _filterSummaryChips + _filtersBarName');
  eq(chips({}), [], 'nothing on → no chips (the default sub-type rows — everything selected — are not a filter)');
  eq(P._filterSummaryChips(null, null), [], 'no state / no lookups → no chips, no throw');
  eq(P._filterSummaryChips({ locationIds: 'x', categories: 7, timeBands: {}, instructorIds: null }, { locations: 'junk', categories: [null, 5] }), [], 'junk shapes are read as "nothing selected"');

  eq(chips({ locationIds: ['4', '30'] }), [{ kind: 'location', id: '30', label: 'Shoreditch' }, { kind: 'location', id: '4', label: 'Bank' }],
    'studios: the panel\'s order (not the order tapped, not id order), "Psycle " dropped as on the panel\'s own chips');
  eq(chips({ locationIds: [4] }), [{ kind: 'location', id: '4', label: 'Bank' }], 'a numeric id matches its string twin (the sets hold strings, a caller may not)');
  eq(chips({ locationIds: ['999'] }), [{ kind: 'location', id: '999', label: 'Studio' }], 'a studio the list does not know still gets a chip — it IS filtering, and this is how it is lifted');

  eq(labels({ categories: ['YOGA', 'RIDE'] }), ['Ride', 'Yoga'], 'class types in the panel\'s order');
  eq(chips({ categories: ['STRENGTH'], strengthSubs: ['UPPER'] }), [{ kind: 'category', id: 'STRENGTH', label: 'Strength · Upper' }],
    'a narrowed sub-type row reads on its parent\'s chip (removing it removes the class type, like its pill)');
  eq(labels({ categories: ['STRENGTH'], strengthSubs: ['FULL', 'UPPER'] }), ['Strength · Upper · Full Body'], 'two of three sub-types, in the row\'s order');
  eq(labels({ categories: ['STRENGTH'], strengthSubs: ALL_STRENGTH }), ['Strength'], 'every sub-type on = not narrowed');
  eq(labels({ categories: ['STRENGTH'], strengthSubs: [] }), ['Strength'], 'none on cannot happen in the panel — and prints nothing odd if storage says so');
  eq(labels({ categories: ['PILATES'], reformerSubs: ['SIGNATURE'] }), ['Pilates · Signature'], 'the reformer row belongs to Pilates');
  eq(labels({ categories: ['RIDE'], strengthSubs: ['UPPER'], reformerSubs: ['SIGNATURE'] }), ['Ride'], 'a sub-type row whose parent is off is not a filter (its pills are not even shown)');
  eq(chips({ categories: ['constructor', 'ZUMBA'] }).map((c) => [c.id, c.label]), [['constructor', 'constructor'], ['ZUMBA', 'ZUMBA']],
    'a class-type key the map does not know (stored filters) is still removable — and "constructor" finds nothing on a prototype');

  eq(chips({ timeBands: ['evening', 'early'], availableOnly: true }),
    [{ kind: 'time', id: 'early', label: 'Before 9' }, { kind: 'time', id: 'evening', label: 'After 5' }, { kind: 'available', id: '', label: 'Available only' }],
    'the Time row: one chip per band in the row\'s order, then "Available only"');
  eq(labels({ availableOnly: 'yes' }), [], '"Available only" is on only when it is exactly true');

  eq(chips({ instructorIds: ['3', '1'] }), [{ kind: 'instructor', id: '3', label: 'Casey Díaz' }, { kind: 'instructor', id: '1', label: 'Alex Morgan' }],
    'instructors: full names, in the order picked (the panel\'s own chips)');
  eq(chips({ instructorIds: ['77'] }), [{ kind: 'instructor', id: '77', label: 'Instructor' }], 'an instructor no longer on the list: a removable chip, not a bare id');

  // ★ Favs / S-A
  eq(chips({ instructorIds: ['2', '1'], favouriteIds: ['1', '2'] }), [{ kind: 'favs', id: '', label: 'Favourites' }], '★ Favs on: the whole starred set is ONE chip');
  eq(chips({ instructorIds: ['1', '2'], favouriteIds: ['1', '2', '88'] }).map((c) => c.kind), ['favs'],
    '…also when a starred instructor has left Psycle (launch pre-selects only the ones still listed)');
  eq(chips({ instructorIds: ['1', '2', '88'], favouriteIds: ['1', '2', '88'] }).map((c) => c.kind), ['favs'], '…and when ★ Favs itself selected that departed id');
  eq(labels({ instructorIds: ['1', '2'], favouriteIds: ['1', '2', '3'] }), ['Alex Morgan', 'Blake Chen'], 'a subset of the stars is not "Favourites" (one was removed by hand): names');
  eq(labels({ instructorIds: ['1', '2', '4'], favouriteIds: ['1', '2'] }), ['Alex Morgan', 'Blake Chen', 'Dev Patel'], 'stars plus someone else: names');
  eq(labels({ instructorIds: ['1'], favouriteIds: ['1'] }), ['Alex Morgan'], 'one instructor is always a name, starred or not');
  eq(chips({ instructorIds: ['3', '4'], favouriteIds: ['1'], topTierIds: ['4', '3'] }), [{ kind: 'tier', id: '', label: 'S/A', name: 'instructors ranked S or A' }],
    'S/A on: one chip, with a spoken name that says what "S/A" is');
  eq(chips({ instructorIds: ['1', '2'], favouriteIds: ['1', '2'], topTierIds: ['1', '2'] }).map((c) => c.kind), ['favs'], 'both sets identical: the stars name it');
  eq(labels({ instructorIds: ['1', '2'] }), ['Alex Morgan', 'Blake Chen'], 'no favourites / ranks passed (a single-instructor filter never asks): names');

  eq(chips({ instructorIds: ['2'], availableOnly: true, timeBands: ['day'], categories: ['RIDE'], locationIds: ['12'] }).map((c) => c.kind + ':' + c.label),
    ['location:Oxford Circus', 'category:Ride', 'time:9–5', 'available:Available only', 'instructor:Blake Chen'],
    'order: studios · class types · time bands · Available only · instructors');
  ok(chips({ locationIds: ['4', '30', '12'], categories: ['RIDE', 'STRENGTH'], timeBands: ['early'], instructorIds: ['1', '2'] })
    .every((c) => Object.keys(c).filter((k) => k !== 'name').join() === 'kind,id,label' && typeof c.label === 'string' && c.label),
  'every chip is {kind, id, label} with a printable label');

  eq([P._filtersBarName(0), P._filtersBarName(1), P._filtersBarName(3), P._filtersBarName(undefined)], ['Filters', 'Filters, 1 active', 'Filters, 3 active', 'Filters'],
    'the bar\'s spoken name carries the count ("Filters, 3 active")');

  // ── shipped: the painter + the chip dispatcher ───────────────────────────
  const chrome = between(appSrc, '// ── pure:filter-summary:start', '// ── pure:filters:start ── (DOM-free date-range helpers', 'the filter-summary chrome');
  const repaint = grab(appSrc, 'function _repaintKeepingFocus(');
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // A page with the bar in it. #controlsSummary's buttons are rebuilt from the
  // HTML written into it (enough for focus to be followed by index).
  const world = (o) => {
    o = o || {};
    const w = { calls: [], announced: [], writes: 0, focused: [], subs: [] };
    const doc = { activeElement: null };
    const button = (i) => ({ i, focus(opts) { w.focused.push(['chip', i, opts]); doc.activeElement = this; } });
    const summary = {
      _html: '', buttons: [],
      get innerHTML() { return this._html; },
      set innerHTML(v) { w.writes++; this._html = v; this.buttons = (v.match(/<button /g) || []).map((m, i) => button(i)); },
      contains(n) { return this.buttons.indexOf(n) !== -1; },
      querySelectorAll() { return this.buttons; },
    };
    const bar = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, focus(opts) { w.focused.push(['bar', opts]); doc.activeElement = this; } };
    const count = { textContent: 'stale', hidden: false };
    const els = { controlsSummary: summary, controlsToggle: bar, controlsCount: count };
    doc.getElementById = (id) => (o.noSummary && id === 'controlsSummary' ? null : els[id] || null);
    const ctx = t.vm.createContext({
      console, Set, Array, Object, String, document: doc,
      selectedLocations: new Set(), selectedCategories: new Set(), selectedTimeBands: new Set(), selectedInstructors: new Set(),
      selectedStrengthSubs: new Set(ALL_STRENGTH), selectedReformerSubs: new Set(ALL_REFORMER),
      favouriteInstructors: new Set(), _availableOnly: false,
      locations: MAPS.locations, instructors: MAPS.instructors.map((i) => ({ id: i.id, full_name: i.name })),
      CATEGORY_MAP, STRENGTH_SUBS, REFORMER_SUBS, TIME_BANDS,
      _topTierInstructorIds: () => { w.calls.push('tiers?'); return o.topTier || []; },
      _mirrorDatePillAria: () => w.calls.push('aria'),
      escapeHTML: esc,
      announce: (text) => w.announced.push(text),
      PsycleState: { subscribe: (key, cb) => w.subs.push([key, cb]) },
      toggleLocation: (id) => { w.calls.push('toggleLocation:' + id); },
      toggleCategory: (key) => { w.calls.push('toggleCategory:' + key); },
      toggleTimeBand: (key) => { w.calls.push('toggleTimeBand:' + key); },
      toggleAvailableOnly: () => { w.calls.push('toggleAvailableOnly'); },
      removeInstructor: (id) => { w.calls.push('removeInstructor:' + id + ' (left: ' + [...ctx.selectedInstructors].filter((x) => x !== String(id)).join() + ')'); ctx.selectedInstructors.delete(String(id)); },
    });
    t.vm.runInContext(repaint + '\n' + chrome, ctx, { filename: 'js/app.js[filter summary]' });
    Object.assign(w, { ctx, doc, summary, bar, count });
    return w;
  };
  const chipTags = (w) => w.summary.innerHTML.match(/<button [^>]*class="filter-chip"[^>]*>/g) || [];

  t.section('Filters bar: updateFiltersSummary paints the count, the name and the chips');
  {
    let w = world();
    w.ctx.updateFiltersSummary();
    eq([w.summary.innerHTML, w.count.textContent, w.count.hidden, w.bar.attrs['aria-label']], ['', '', true, 'Filters'], 'fresh launch, nothing on: no chips, no count, the bar is just "Filters"');
    eq(w.calls, ['aria'], 'the date pills\' aria mirror still runs first (every date-row change ends up here) — and ranks are not read for an empty filter');

    w = world();
    w.ctx.selectedLocations.add('4'); w.ctx.selectedCategories.add('RIDE'); w.ctx.selectedTimeBands.add('evening');
    w.ctx.updateFiltersSummary();
    eq([w.count.textContent, w.count.hidden, w.bar.attrs['aria-label']], ['3', false, 'Filters, 3 active'], 'restored filters: the count is right and part of the bar\'s name');
    eq(chipTags(w).map((tag) => [/data-kind="([^"]*)"/.exec(tag)[1], /data-id="([^"]*)"/.exec(tag)[1], /aria-label="([^"]*)"/.exec(tag)[1]]),
      [['location', '4', 'Remove filter: Bank'], ['category', 'RIDE', 'Remove filter: Ride'], ['time', 'evening', 'Remove filter: After 5']],
      'one real <button> per filter: kind + id as data, a spoken name that says what a tap does');
    ok(chipTags(w).every((tag) => /^<button type="button"/.test(tag) && /onclick="removeFilterChip\(this\)"/.test(tag)), 'each chip is a button that hands ITSELF to removeFilterChip (no id is quoted into a handler)');
    ok(/<span class="filter-chip-label">Bank<\/span><span class="filter-chip-x" aria-hidden="true">×<\/span>/.test(w.summary.innerHTML), 'label and × are separate spans: the label can truncate, the × cannot be pushed out');
    ok(/<button type="button" class="controls-clear" onclick="clearFilters\(\)"[^>]*>Clear<\/button>$/.test(w.summary.innerHTML), '"Clear" follows the chips and reuses clearFilters');

    const before = w.writes;
    w.ctx.updateFiltersSummary();
    eq(w.writes, before, 'the same chips again (every search, every date tap): nothing is rebuilt under a finger or a focus ring');
    w.ctx._availableOnly = true;
    w.ctx.updateFiltersSummary();
    eq([w.writes, w.count.textContent], [before + 1, '4'], 'a change repaints');

    w = world();
    w.ctx.instructors.push({ id: '9"><img src=x onerror=alert(1)>', full_name: '<b>Eve</b> "O\'Hara"' });
    w.ctx.selectedInstructors.add('9"><img src=x onerror=alert(1)>');
    w.ctx.updateFiltersSummary();
    eq((w.summary.innerHTML.match(/</g) || []).length, 8, 'a hostile id / name (stored filters, an imported file) adds no element: two buttons, two spans each way');
    ok(w.summary.innerHTML.indexOf('&lt;b&gt;Eve&lt;/b&gt;') !== -1 && w.summary.innerHTML.indexOf('<img') === -1, '…label, spoken name and data-id are all escaped');

    w = world({ topTier: ['3', '4'] });
    ['3', '4'].forEach((id) => w.ctx.selectedInstructors.add(id));
    w.ctx.updateFiltersSummary();
    ok(w.calls.indexOf('tiers?') !== -1 && /aria-label="Remove filter: instructors ranked S or A"[^>]*><span class="filter-chip-label">S\/A</.test(w.summary.innerHTML),
      'two or more instructors: the ranks are read, and the S/A set is one chip');
    eq(w.bar.attrs['aria-label'], 'Filters, 1 active', '…counted once');

    w = world({ noSummary: true });
    w.ctx.updateFiltersSummary();
    eq(w.calls, ['aria'], 'a page without the summary (older cached HTML): the aria mirror still ran, nothing threw');

    w = world();
    w.ctx.updateFiltersSummary(); w.ctx.updateFiltersSummary();
    eq(w.subs.map((s) => s[0]), ['favouriteInstructors'], 'it follows the stars (the instructor sheet and Membership change them with no filter toggle) — subscribed once');
    w.ctx.selectedInstructors.add('1'); w.ctx.selectedInstructors.add('2');
    w.ctx.favouriteInstructors = new Set(['1', '2']);
    w.subs[0][1]();
    ok(/>Favourites</.test(w.summary.innerHTML), '…so a new star repaints the chips');
    ok(/let _summaryFollowsStars = false;/.test(chrome) && !/^PsycleState\.subscribe/m.test(chrome),
      'wired on the first paint, not at load: app.js assigns favouriteInstructors while its Time-row state is still in the TDZ');
  }

  t.section('Filters bar: a removed chip hands its focus on');
  {
    const w = world();
    ['4', '30', '12'].forEach((id) => w.ctx.selectedLocations.add(id));
    w.ctx.updateFiltersSummary();
    eq(w.focused, [], 'a paint with the focus elsewhere pulls nothing into the row (launch, restore, a shortcut)');
    w.doc.activeElement = w.summary.buttons[1];
    w.ctx.selectedLocations.delete('4');
    w.ctx.updateFiltersSummary();
    eq(w.focused, [['chip', 1, { preventScroll: true }]], 'the chip now in its place takes the focus — never scrolling the page to do it');
    w.ctx.selectedLocations.delete('12');
    w.ctx.updateFiltersSummary();
    eq(w.focused.length, 2, '…then "Clear" (the last button of the row)');
    w.doc.activeElement = w.summary.buttons[0];
    w.ctx.selectedLocations.clear();
    w.ctx.updateFiltersSummary();
    eq([w.summary.innerHTML, w.focused[2]], ['', ['bar', { preventScroll: true }]], 'nothing left to remove: the focus goes to the Filters bar, not to <body>');
  }

  t.section('Filters bar: × goes through the panel\'s own control');
  {
    const each = [
      ['location', '4', (c) => c.selectedLocations.add('4'), 'toggleLocation:4'],
      ['category', 'RIDE', (c) => c.selectedCategories.add('RIDE'), 'toggleCategory:RIDE'],
      ['time', 'evening', (c) => c.selectedTimeBands.add('evening'), 'toggleTimeBand:evening'],
      ['available', '', (c) => { c._availableOnly = true; }, 'toggleAvailableOnly'],
      ['instructor', '2', (c) => c.selectedInstructors.add('2'), 'removeInstructor:2 (left: )'],
    ];
    each.forEach(([kind, id, turnOn, call]) => {
      let w = world();
      eq([w.ctx._removeFilter(kind, id), w.calls], [false, []], kind + ': not on → NOTHING is called (a toggle for a stale chip would switch the filter ON)');
      w = world();
      turnOn(w.ctx);
      eq([w.ctx._removeFilter(kind, id), w.calls], [true, [call]], kind + ' → ' + call.split(' ')[0] + ' — the function its pill / chip calls, so the stash release, the save and the re-filter are that function\'s own');
    });
    let w = world();
    w.ctx.selectedLocations.add('4');
    eq([w.ctx._removeFilter('location', 4), w.calls], [true, ['toggleLocation:4']], 'a numeric id is matched as its string');
    eq([w.ctx._removeFilter('date', 'today'), w.ctx._removeFilter(undefined, undefined), w.calls.length], [false, false, 1], 'an unknown kind does nothing');

    ['favs', 'tier'].forEach((kind) => {
      w = world();
      ['1', '2', '3'].forEach((id) => w.ctx.selectedInstructors.add(id));
      eq([w.ctx._removeFilter(kind, ''), w.calls, [...w.ctx.selectedInstructors]], [true, ['removeInstructor:3 (left: )'], []],
        kind + ': the set leaves in ONE removeInstructor call — it sees the last chip go, so its "put the shortcut\'s set-aside filters back" rule runs, with one repaint, one search, one save');
      w = world();
      eq([w.ctx._removeFilter(kind, ''), w.calls], [false, []], kind + ': no instructors on → nothing');
    });
    const body = grab(appSrc, 'function _removeFilter(');
    ok(!/window\.|_orig|\.call\(|saveFilters|triggerAutoSearch|_dropFocusStash/.test(body),
      'bare calls only: the globals interactions.js wraps with saveFilters — nothing is saved, searched or un-stashed by hand here');
    ['toggleLocation', 'toggleCategory', 'toggleTimeBand', 'toggleAvailableOnly', 'removeInstructor'].forEach((fn) => {
      ok(t.readSource('js/interactions.js').indexOf("wrapGlobal('" + fn + "', saveFilters);") !== -1, fn + ' is one of the wrapped (saved) filter functions');
    });

    // The chip itself.
    const chip = (kind, id, label) => ({
      getAttribute: (k) => (k === 'data-kind' ? kind : k === 'data-id' ? id : null),
      querySelector: (sel) => (sel === '.filter-chip-label' ? { textContent: label } : null),
    });
    w = world();
    w.ctx.selectedLocations.add('4');
    w.ctx.removeFilterChip(chip('location', '4', 'Bank'));
    eq([w.calls, w.announced], [['toggleLocation:4'], ['Bank filter removed']], 'a tap removes that one filter and says so (a sighted member sees the chip go)');
    w = world();
    w.ctx.selectedLocations.add('30');
    w.ctx.updateFiltersSummary();
    w.ctx.selectedLocations.clear(); // …cleared some other way since the chip was painted
    w.ctx.removeFilterChip(chip('location', '30', 'Shoreditch'));
    eq([w.calls.filter((c) => c !== 'aria'), w.announced, w.summary.innerHTML], [[], [], ''], 'a stale chip: nothing toggled, nothing announced, the row repainted');
    w.ctx.removeFilterChip(null); w.ctx.removeFilterChip({});
    ok(true, 'no button / not an element: no throw');
  }

  // ── shipped: collapse state ──────────────────────────────────────────────
  t.section('Filters bar: collapsed at launch, a class on the panel, nothing stored');
  {
    const block = between(appSrc, '// ── The Filters bar (below 1024px)', 'function clearFilters() {', 'the Filters-bar state block');
    const code = block.replace(/\/\/.*$/gm, ''); // the block's prose talks about scrolling and searching; its code must not
    const cls = new Set(['filters-collapsed']);
    const panel = { classList: { toggle: (name, on) => { if (on) cls.add(name); else cls.delete(name); } } };
    const bar = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
    const seen = [];
    const ctx = t.vm.createContext({
      String,
      document: { getElementById: (id) => (id === 'controlsPanel' ? panel : id === 'controlsToggle' ? bar : null) },
      updateFiltersSummary: () => seen.push('summary'),
    });
    t.vm.runInContext(block, ctx, { filename: 'js/app.js[filters bar]' });
    eq([[...cls], bar.attrs['aria-expanded'], seen], [['filters-collapsed'], 'false', []], 'launch: collapsed, aria-expanded="false" — whatever the last session left');
    ctx.toggleFilters();
    eq([[...cls], bar.attrs['aria-expanded'], seen], [[], 'true', []], 'toggleFilters() (the name the old markup called) opens it');
    ctx.toggleFilters();
    eq([[...cls], bar.attrs['aria-expanded'], seen], [['filters-collapsed'], 'false', ['summary']], '…and closes it, repainting the chips that were out of sight meanwhile');
    ok(typeof ctx.applyFiltersCollapsedState === 'function', 'applyFiltersCollapsedState keeps its name (types/globals.d.ts declares it)');
    ok(/let _filtersCollapsed = true;/.test(code), 'the default is collapsed');
    ok(!/localStorage|sessionStorage|_psycleSafeSetItem|saveFilters/.test(code), 'the state is never stored');
    ok(!/search\(|triggerAutoSearch|renderFromWindow|scroll|style\.display|\.focus\(/.test(code),
      'opening / closing searches nothing, scrolls nothing, moves no focus and writes no inline display (the desktop stylesheet must be able to keep the panel open)');
    const focusSearch = grab(appSrc, 'function _focusSearch(');
    ok(!/_filtersCollapsed|toggleFilters|applyFiltersCollapsedState/.test(focusSearch) && /_syncFilterUI\(\);/.test(focusSearch) &&
      /updateFiltersSummary\(\)/.test(grab(appSrc, 'function _syncFilterUI(')),
    'a "find it" shortcut leaves the panel as it is — and repaints the chips, which say what it set');
    const enter = between(appSrc, '// Allow pressing Enter to search', '// ── Upcoming bookings panel', 'the Enter-to-search handler');
    ok(enter.indexOf("closest('#controlsBar')) return;") !== -1 && enter.indexOf("closest('#controlsBar')) return;") < enter.indexOf('search();'),
      'Enter on the bar / a chip / "Clear" does that button\'s job only — it does not ALSO run a search');
  }

  // ── markup ───────────────────────────────────────────────────────────────
  t.section('Filters bar: markup — date row exposed, one real button, every panel id kept');
  {
    const panel = between(html, 'id="controlsPanel"', 'id="upcomingPanel"', '#controlsPanel');
    const at = (needle) => panel.indexOf(needle);
    ok(/<div class="controls filters-collapsed" id="controlsPanel">/.test(html), 'collapsed in the markup itself, so the first paint is already collapsed');
    ok(at('class="date-presets"') !== -1 && at('class="date-presets"') < at('id="controlsBar"') && at('id="controlsBar"') < at('id="controlsBody"'),
      'order: the date row · the Filters bar · the collapsible panel');
    const bodyHtml = panel.slice(at('id="controlsBody"'));
    ['pickDateBtn', 'datePicker', 'startDate', 'daysAhead'].forEach((id) => {
      ok(at('id="' + id + '"') !== -1 && at('id="' + id + '"') < at('id="controlsBar"') && bodyHtml.indexOf('id="' + id + '"') === -1, '#' + id + ' is outside the collapsible body (always on screen)');
    });
    ok(!/<label>Date<\/label>/.test(panel) && /<div class="control-group controls-dates" role="group" aria-label="Date">/.test(panel), 'no visible "Date" label — the group carries the name');
    ['timePills', 'locationChips', 'locationHint', 'categoryPills', 'strengthSubPills', 'reformerSubPills', 'favBtn', 'tierBtn', 'instrBox', 'instrChips', 'instrSearch', 'instrDropdown'].forEach((id) => {
      eq((bodyHtml.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1, '#' + id + ' is still in the panel');
    });
    eq((bodyHtml.match(/<label>[^<]+/g) || []).map((m) => m.slice('<label>'.length).trim()),
      ['Time', 'Location', 'Class Type', 'Instructor'], 'Time · Location · Class Type · Instructor, as before');
    const tag = (/<button[^>]*id="controlsToggle"[^>]*>/.exec(panel) || [''])[0];
    ok(/^<button type="button"/.test(tag) && /aria-expanded="false"/.test(tag) && /aria-controls="controlsBody"/.test(tag) && /onclick="toggleFilters\(\)"/.test(tag),
      '#controlsToggle is a real button: aria-expanded, aria-controls="controlsBody", toggleFilters()');
    const inner = between(panel, tag, '</button>', 'the bar\'s content');
    ok(/>Filters</.test(inner) && /id="controlsCount"[^>]*aria-hidden="true"[^>]*hidden/.test(inner) && /<svg class="controls-chevron"[^>]*aria-hidden="true"/.test(inner),
      'the word "Filters", a count (hidden at 0; the spoken count is in the name) and a chevron drawn as SVG — no glyph, no emoji');
    ok(/<div class="controls-summary" id="controlsSummary"><\/div>/.test(panel) && at('id="controlsSummary"') > at('</button>') && at('id="controlsSummary"') < at('id="controlsBody"'),
      '#controlsSummary sits beside the bar, outside the button (chips are buttons of their own) and outside the panel');
    eq((html.match(/id="controls(Panel|Toggle|Body|Summary)"/g) || []).length, 4, 'the shared ids exist exactly once each');
  }

  // ── CSS ──────────────────────────────────────────────────────────────────
  t.section('Filters bar: CSS — collapsed below 1024px only, chips truncate, the dropdown is not clipped');
  {
    const rule = (css, selector) => {
      const re = new RegExp('(?:^|[}\\s])' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
      return (re.exec(css) || [])[1] || '';
    };
    const media = (css, query) => {
      const out = [];
      let from = 0;
      for (;;) {
        const a = css.indexOf('@media ' + query, from);
        if (a === -1) break;
        let depth = 0, i = css.indexOf('{', a);
        const start = i + 1;
        for (; i < css.length; i++) { if (css[i] === '{') depth++; else if (css[i] === '}' && --depth === 0) break; }
        out.push(css.slice(start, i));
        from = i;
      }
      return out.join('\n');
    };
    const small = media(redesign, '(max-width: 1023px)');
    ok(/\.controls\.filters-collapsed > \.controls-body \{\s*display:\s*none;?\s*\}/.test(small), 'the collapse is a rule inside @media (max-width: 1023px)…');
    const closers = (css) => css.split('.filters-collapsed > .controls-body').length - 1;
    eq([closers(redesign), closers(small), closers(styles)], [1, 1, 0], '…and nowhere else: at >=1024px the panel cannot be closed');
    ok(/#tab-discover \.controls-bar \{\s*display:\s*none;?\s*\}/.test(media(styles, '(min-width: 1024px)')), 'desktop hides the bar (chips and "Clear" with it — the header keeps "Clear filters" there)');
    ok(/\.disc-clear-btn \{\s*display:\s*none;?\s*\}/.test(small), 'below 1024px the header\'s "Clear filters" gives way to the bar\'s "Clear" (one Clear per screen)');
    const body = rule(redesign, '.controls-body');
    ok(/display:\s*flex\s*;/.test(body) && !/display:[^;]*!important/.test(body), '.controls-body no longer forces display with !important (that is what kept the old toggle from ever closing it)');
    ok(!/overflow(-y)?:\s*(hidden|auto|scroll)|max-height/.test(body + rule(redesign, '.controls') + rule(redesign, '.controls-bar')) && !/\.controls-body[^{]*\{[^}]*(max-height|overflow:\s*hidden)/.test(redesign + styles),
      'no height animation, no overflow box: the instructor dropdown opens past the panel\'s edge');
    ok(/overflow-x:\s*clip/.test(rule(redesign, '.controls, .controls-body, #tab-discover')), '…the sideways guard stays overflow-x: clip (hidden would make the panel a scroll box that clips it)');
    ok(/display:\s*contents/.test(rule(redesign, '.controls-summary')) && /flex-wrap:\s*wrap/.test(rule(redesign, '.controls-bar')),
      'the chips wrap in the bar\'s own row: the results move down by the rows the chips need, no more');
    const chip = rule(redesign, '.filter-chip'), label = rule(redesign, '.filter-chip-label');
    ok(/max-width:\s*100%/.test(chip) && /min-width:\s*0/.test(chip) && /text-overflow:\s*ellipsis/.test(label) && /overflow:\s*hidden/.test(label) && /white-space:\s*nowrap/.test(label),
      'a long studio name truncates inside its chip; the chip never outgrows the row');
    ok(/flex:\s*none/.test(rule(redesign, '.filter-chip-x')), '…and the × is never squeezed out');
    ok(/\.controls:not\(\.filters-collapsed\) \.filter-chip \{\s*display:\s*none;?\s*\}/.test(redesign), 'panel open: its own pills say what is on — the chips step aside, the count and "Clear" stay');
    const hit = rule(redesign, '.controls-toggle::after, .filter-chip::after, .controls-clear::after');
    ok(/height:\s*var\(--tap-min\)/.test(hit) && /left:\s*0/.test(hit) && /right:\s*0/.test(hit), 'bar, chips and "Clear" each get a --tap-min tall hit area, grown up and down only (never over a neighbour)');
    ok(/outline:\s*2px solid var\(--accent/.test(rule(redesign, '.controls-toggle:focus-visible, .filter-chip:focus-visible, .controls-clear:focus-visible')), 'a keyboard focus ring on all three');
    ok(/\.controls-chevron \{\s*transition:\s*none;?\s*\}/.test(media(redesign, '(prefers-reduced-motion: reduce)')), 'the chevron\'s turn respects prefers-reduced-motion');
    ok(/\.controls\.filters-collapsed \.controls-chevron/.test(redesign), 'the chevron shows the state');
    const mine = ['.controls-bar', '.controls-toggle', '.controls-count', '.controls-chevron', '.filter-chip', '.filter-chip-label', '.filter-chip-x', '.controls-clear'].map((s) => rule(redesign, s)).join('\n');
    const literals = mine.replace(/var\(--[a-z0-9-]+,\s*#[0-9a-fA-F]{3,8}\)/g, 'var()').match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) || [];
    eq(literals, [], 'every colour is a token (a hex only ever as a var() fallback, like the rest of redesign.css)');
    ok(/background:\s*var\(--accent[,)]/.test(rule(redesign, '.controls-count')) && /(?:^|[;\s])color:\s*var\(--accent-ink[,)]/.test(rule(redesign, '.controls-count')), 'the count is an accent fill labelled with --accent-ink (1f-contrast-tokens\' rule)');
    ok(!/\.controls-toggle\s*\{[^}]*display:\s*none/.test(redesign + styles) && !/\.controls-summary\s*\{[^}]*text-overflow/.test(styles),
      'the old hidden toggle and its one-line text digest are gone');

    // The chip's label on its own fill, per theme. Seen in a browser: Handheld's
    // --text IS its accent, and --text on --accent-soft measured 4.47:1.
    const themeCss = noComments(t.readSource('css/theme.css'));
    const tokensOf = (selector) => {
      const at = themeCss.indexOf(selector + ' {');
      if (at === -1) throw new Error('8a-filters suite: theme.css has no block for ' + selector);
      const out = {};
      themeCss.slice(themeCss.indexOf('{', at) + 1, themeCss.indexOf('}', at)).replace(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g, (m, k, v) => { out[k] = v.trim(); return m; });
      return out;
    };
    const hex = (h) => { let s = h.replace('#', ''); if (s.length === 3) s = s.split('').map((c) => c + c).join(''); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)); };
    const lum = (rgb) => { const c = rgb.map((v) => v / 255).map((s) => (s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const contrast = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
    const root = tokensOf(':root');
    const ids = [];
    t.readSource('js/theme.js').replace(/\{\s*id:\s*'([a-z]+)'/g, (m, id) => { ids.push(id); return m; });
    ok(ids.length >= 7, 'theme ids parsed from APP_THEMES (' + ids.join(', ') + ')');
    const labelToken = (/(?:^|[;\s])color:\s*var\((--[a-z-]+)/.exec(chip) || [])[1];
    const fillToken = (/background:\s*var\((--[a-z-]+)/.exec(chip) || [])[1];
    eq([labelToken, fillToken], ['--text-heading', '--accent-soft'], 'the chip: the top of the ink ladder on the soft accent tint');
    ids.forEach((id) => {
      const tk = Object.assign({}, root, tokensOf('[data-theme="' + id + '"]'));
      let fill = tk[fillToken];
      const mix = /^color-mix\(in srgb,\s*var\((--[a-z-]+)\)\s*(\d+)%,\s*var\((--[a-z-]+)\)\)$/.exec(fill || '');
      if (mix) { const a = hex(tk[mix[1]]), b = hex(tk[mix[3]]), p = Number(mix[2]) / 100; fill = a.map((v, i) => Math.round(v * p + b[i] * (1 - p))); } else fill = hex(fill);
      const r = contrast(hex(tk[labelToken]), fill);
      ok(r >= 4.5, id + ': chip label on its fill is ' + r.toFixed(2) + ':1 (>= 4.5)');
    });
  }
};
