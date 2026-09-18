'use strict';
// Wave-6 leftovers, each seen in a real browser by that wave's verifier:
//   a. the Stats tiles ("This month", "All time") and the "Share my stats"
//      image counted bookings still to come as classes taken (js/tabs.js),
//   b. a history row with an unreadable date got a month column of its own
//      ("ge") on "Instructor variety" (js/tabs.js),
//   d. a saved "Next week" came back lit but clipped at a phone's right edge
//      (js/app.js + js/interactions.js),
//   e. Handheld: the seat tiles kept the rounded corners of their rx attributes
//      (css/styles.css, css/settings.css),
//   f. Stats: "Your routine" and "Activity heatmap" sat a step to the right of
//      the sections around them on a phone (css/tabs.css),
//   g. claim / leave / ended-place copy named a class weeks away "Fri 18" (js/app.js),
//   i. the Monday-reminder tap saved "Next week" as the launch default — and so
//      did the member's next chip tap on that week (js/app.js + js/interactions.js).
// (c — the cancel toast's bare status code — is in booking-races.js; h — "Remove
// duplicates" on an un-owned calendar — in calendar-safety.js; the share image in
// copy.js.) The REAL functions, sliced out of source, against small fakes.
module.exports = async function (t) {
  const { ok, eq } = t;
  const appSrc = t.readSource('js/app.js');
  const tabsSrc = t.readSource('js/tabs.js');
  const grab = (src, opener, closer) => {
    const lines = src.split('\n');
    const from = lines.findIndex((l) => l.startsWith(opener));
    if (from === -1) throw new Error('wave7-leftovers suite: cannot find "' + opener + '" (anchor moved?)');
    const to = lines.findIndex((l, i) => i > from && l === closer);
    if (to === -1) throw new Error('wave7-leftovers suite: unterminated "' + opener + '"');
    return lines.slice(from, to + 1).join('\n');
  };
  const pureRegion = (src, name) => {
    const s = src.indexOf('// ── pure:' + name + ':start'), e = src.indexOf('// ── pure:' + name + ':end');
    if (s === -1 || e === -1) throw new Error('wave7-leftovers suite: pure:' + name + ' markers moved');
    return src.slice(s, e);
  };
  const fixedDate = (fixed) => class extends Date { constructor(...a) { if (a.length) super(...a); else super(fixed); } static now() { return fixed; } };

  // ── a. Classes taken ─────────────────────────────────────────────────────
  t.section('Stats: "This month" / "All time" count classes TAKEN, not bookings still to come');
  {
    const NOW = Date.parse('2026-09-18T15:00:00Z'); // 16:00 in London
    const p = t.loadPure('js/tabs.js', 'year-review');
    const london = t.loadPure('js/app.js', 'gym-time')._gymClassStartMs;
    const rows = [
      { eventId: '1', date: '2026-09-10 07:00:00' },
      { eventId: '3', date: '2026-09-25 07:00:00' },                                   // booked, next week
      { eventId: '4', date: '2026-09-02 07:00:00', cancelledAt: '2026-09-01T10:00:00Z' },
      { eventId: '7', date: '2026-09-18 15:30:00' },                                   // began half an hour ago (London)
      { eventId: '8', date: '2026-09-18 18:00:00' },                                   // tonight
      { eventId: '9', date: 'garbage' },
      null,
    ];
    eq(p._takenRows(rows, NOW, london).map((h) => h.eventId), ['1', '7', '9'],
      'started and not cancelled; a date nothing can place is not provably ahead and stays (the year wrap\'s own rule) — junk rows are dropped');
    eq(p._takenRows([], NOW, london), [], 'no history → no rows');

    // The real tiles.
    const tiles = (history, bookings, cache) => {
      const bar = { style: {}, innerHTML: '' };
      const ctx = t.vm.createContext({
        Date: fixedDate(NOW), console, Object, Math, isNaN, Number, String,
        document: { getElementById: (id) => (id === 'statsBar' ? bar : null) },
        _myBookings: bookings, _eventCache: cache, getFullHistory: () => history, escapeHTML: (x) => String(x),
      });
      t.vm.runInContext([pureRegion(appSrc, 'gym-time'), pureRegion(appSrc, 'bookings-started'), pureRegion(appSrc, 'copy'), pureRegion(tabsSrc, 'year-review'),
        grab(tabsSrc, '  function _historyStartMs(', '  }'), grab(tabsSrc, '  function _stillToCome(', '  }'), grab(tabsSrc, '  function renderQuickStats(', '  }')].join('\n'), ctx, { filename: 'js/tabs.js[quick stats]' });
      ctx.renderQuickStats();
      const tile = (label) => (new RegExp('<div class="stat-value">(\\d+)</div><div class="stat-label">' + label).exec(bar.innerHTML) || [])[1];
      return [tile('Upcoming'), tile('This month'), tile('All time')];
    };
    const history = [
      { eventId: '1', date: '2026-09-10 07:00:00', instrName: 'Alex', locName: 'Bank', slots: [5] },
      { eventId: '2', date: '2026-08-20 07:00:00', instrName: 'Alex', locName: 'Bank', slots: [5] },
      { eventId: '3', date: '2026-09-25 07:00:00', instrName: 'Blake', locName: 'Bank', slots: [5] }, // recorded on booking:complete
      { eventId: '4', date: '2026-09-02 07:00:00', instrName: 'Blake', locName: 'Bank', slots: [5], cancelledAt: '2026-09-01T10:00:00Z' },
    ];
    const seat = { bookingId: 'A', slots: [5], waitlisted: false };
    const bookings = { 3: seat, 5: seat, 6: seat, 10: { bookingId: null, slots: [], waitlisted: true } };
    const cache = {
      3: { id: 3, start_at: '2026-09-25 07:00:00' },
      5: { id: 5, start_at: '2026-09-26 08:00:00' },  // held, not in history yet
      6: { id: 6, start_at: '2026-09-18 14:00:00' },  // held, began two hours ago, not in history yet
      10: { id: 10, start_at: '2026-09-27 08:00:00' },
    };
    eq(tiles(history, bookings, cache), ['2', '2', '3'],
      'Upcoming 2 · This month 2 · All time 3 — the two classes still to come are "Upcoming" only (they read This month 4 · All time 5)');
    eq(tiles([], { 5: seat }, cache), ['1', '0', '0'], 'a first booking: Upcoming 1, and nothing taken yet');
    ok(/var history = _takenRows\(getFullHistory\(\), Date\.now\(\), _historyStartMs\(\)\);/.test(grab(tabsSrc, '  window.shareInsights = async function () {', '  };')),
      'the "Share my stats" image draws from the same rows (tests/suites/copy.js drives it)');

    // …and so must the gate that OFFERS it. History holds a booking from the
    // moment it is made: after a first booking "Share my stats" was shown, and
    // could only toast "No history to share yet". The real renderInsights, as
    // tests/suites/data-owner.js runs it (its section renderers are no-ops).
    const shareShown = (rowsNow) => {
      const els = { shareSection: { style: { display: 'unset' } }, statsEmpty: { style: {}, innerHTML: '' } };
      const known = {
        window: {}, Date: fixedDate(NOW), String, isNaN, document: { getElementById: (id) => els[id] || null },
        currentUser: { id: 7 }, getBearerToken: () => 'tok', getFullHistory: () => rowsNow, _tokenReadable: true, _gymClassStartMs: london,
      };
      const noop = () => {};
      const scope = new Proxy(known, { has: () => true, get: (target, k) => (k === Symbol.unscopables ? undefined : (k in target ? target[k] : noop)) });
      const from = tabsSrc.indexOf('  window.renderInsights = function () {');
      t.vm.runInContext('with (scope) {' + [pureRegion(tabsSrc, 'year-review'), grab(tabsSrc, '  function _historyStartMs(', '  }'), grab(tabsSrc, '  function _hasTakenHistory(', '  }'),
        tabsSrc.slice(from, tabsSrc.indexOf('  // ── Quick Stats', from))].join('\n') + '\n}', t.vm.createContext({ scope }), { filename: 'js/tabs.js[renderInsights]' });
      known.window.renderInsights();
      return els.shareSection.style.display === '';
    };
    eq([shareShown([history[2]]), shareShown([history[2], history[3]]), shareShown([])], [false, false, false],
      'only a class still to come (a first booking), that plus a cancelled one, or nothing: "Share my stats" is not offered — it could only fail');
    eq([shareShown(history), shareShown([history[0]]), shareShown([{ eventId: '9', date: 'garbage' }])], [true, true, true],
      'a class taken: offered — by the very rows the image draws from');
  }

  // ── b. Instructor variety ────────────────────────────────────────────────
  t.section('Stats: "Instructor variety" has a column per MONTH — not per unreadable date');
  {
    const box = { style: {}, innerHTML: '' };
    const history = [
      { date: '2026-08-03 07:00:00', instrName: 'Alex' }, { date: '2026-08-10 07:00:00', instrName: 'Blake' },
      { date: '2026-09-01 07:00:00', instrName: 'Alex' }, { date: '2026-09-08 07:00:00', instrName: 'Alex' },
      { date: 'garbage', instrName: 'Casey' }, { date: '2026-13-01 07:00:00', instrName: 'Casey' }, { date: '20260901', instrName: 'Casey' },
      { date: '2026-09-09 07:00:00', instrName: 'Drew', cancelledAt: '2026-09-08T10:00:00Z' },
    ];
    const ctx = t.vm.createContext({ console, Object, Math, Set, String, parseInt, document: { getElementById: (id) => (id === 'varietySection' ? box : null) }, getFullHistory: () => history });
    t.vm.runInContext(pureRegion(appSrc, 'copy') + '\n' + grab(tabsSrc, '  function renderVarietyTrend(', '  }'), ctx, { filename: 'js/tabs.js[variety]' });
    ctx.renderVarietyTrend();
    const labels = [];
    box.innerHTML.replace(/<div class="variety-label">([^<]*)<\/div>/g, (m, l) => { labels.push(l); return m; });
    eq(labels, ['Aug', 'Sep'], 'two months, two columns — "garbage" used to add one labelled "ge", a month 13 one labelled "13"');
    ok(/title="Aug: 2 instructors, 2 classes"/.test(box.innerHTML) && /title="Sep: 1 instructor, 2 classes"/.test(box.innerHTML), '…and the rows it cannot place are in no month\'s count');
  }

  // ── d. The lit date pill ─────────────────────────────────────────────────
  t.section('Discover: a restored date pill is brought into view inside its row');
  {
    const p = t.loadPure('js/app.js', 'filters');
    const reveal = p._scrollLeftToReveal;
    eq([reveal(0, 358, 330, 96, 8), reveal(0, 358, 100, 96, 8), reveal(200, 358, 100, 96, 8), reveal(200, 358, 4, 40, 8)], [76, 0, 92, 0],
      'cut off on the right → just far enough (plus the gap); in view → untouched; cut off on the left → back to it; never negative');
    eq([reveal(76, 358, 330, 96, 8), reveal(0, 0, 330, 96, 8), reveal(0, 358, 330, 0, 8), reveal(0, 358, NaN, 96, 8), reveal('x', 358, 10, 20, -5)], [76, 0, 0, 0, 0],
      'already revealed → stable; a row or pill that is not laid out, or junk → untouched');

    const world = (o) => {
      const row = { scrollLeft: o.scrollLeft || 0, clientWidth: o.clientWidth, scrollWidth: o.scrollWidth, writes: 0 };
      let left = row.scrollLeft;
      Object.defineProperty(row, 'scrollLeft', { get: () => left, set: (v) => { row.writes++; left = v; } });
      row.getBoundingClientRect = () => ({ left: 16, width: row.clientWidth });
      const pill = o.pill === null ? null : { getBoundingClientRect: () => ({ left: 16 + o.pill - left, width: 96 }), scrollIntoView() { throw new Error('scrollIntoView scrolls the page too'); } };
      row.querySelector = (sel) => (sel === '.date-quick-btn.active' ? pill : null);
      const ctx = t.loadPure('js/app.js', 'filters', {
        document: { querySelector: (sel) => (sel === '.date-presets' ? (o.noRow ? null : row) : null) },
        getComputedStyle: () => ({ columnGap: '8px' }), parseFloat,
      });
      if (o.window) ctx.window = o.window;
      t.vm.runInContext(grab(appSrc, 'function _revealActiveDatePill(', '}'), ctx, { filename: 'js/app.js[_revealActiveDatePill]' });
      ctx._revealActiveDatePill();
      return row;
    };
    let row = world({ clientWidth: 358, scrollWidth: 470, pill: 330 }); // 390px phone, "Next week" lit
    eq([row.scrollLeft, row.writes], [76, 1], 'a saved "Next week" on a 390px phone: the ROW scrolls 76px — its own scrollLeft, written once');
    row = world({ clientWidth: 358, scrollWidth: 470, pill: 60 });
    eq(row.writes, 0, 'a pill already in view ("Today"): the row is not touched');
    row = world({ clientWidth: 900, scrollWidth: 900, pill: 330 });
    eq(row.writes, 0, 'a row that fits (desktop): nothing to do');
    row = world({ clientWidth: 0, scrollWidth: 0, pill: 330 });
    eq(row.writes, 0, 'another tab is up (the row measures 0): left alone');
    // …but not forgotten: a reload on #bookings (or a launch from a widget tap)
    // restores "Next week" with Discover hidden, and nothing came back to it —
    // the member then found the lit pill cut off at the right edge after all.
    let win = {};
    row = world({ clientWidth: 0, scrollWidth: 0, pill: 330, window: win });
    eq([row.writes, win._datePillRevealOwed], [0, true], '…it is OWED: noted for the next time Discover is shown');
    win = {};
    world({ clientWidth: 0, scrollWidth: 0, pill: null, window: win });
    world({ clientWidth: 900, scrollWidth: 900, pill: 330, window: win });
    world({ clientWidth: 358, scrollWidth: 470, pill: 330, window: win });
    eq(win._datePillRevealOwed, undefined, 'nothing lit, or a row that IS laid out (whether or not it had to move): nothing owed');
    {
      // switchTab('discover') pays it — once.
      const tabsJs = t.readSource('js/tabs.js');
      const sw = tabsJs.slice(tabsJs.indexOf('  window.switchTab = function (tab, noHash) {'), tabsJs.indexOf('  // Deep links and back/forward'));
      const calls = [];
      const w2 = { scrollTo() {}, _datePillRevealOwed: true };
      const tctx = t.vm.createContext({
        window: w2, history: { replaceState() {} },
        document: { querySelectorAll: () => [], querySelector: () => null },
        renderWeekView: () => calls.push('week'), _revealActiveDatePill: () => calls.push('reveal:' + w2._datePillRevealOwed),
        renderInsights() {}, renderMembershipInfo() {}, renderCostTracker() {},
      });
      t.vm.runInContext('var _currentTab = "bookings";\n' + sw, tctx, { filename: 'js/tabs.js[switchTab]' });
      w2.switchTab('stats');
      eq([calls, w2._datePillRevealOwed], [[], true], 'another tab: still owed');
      w2.switchTab('discover');
      eq([calls, w2._datePillRevealOwed], [['week', 'reveal:false'], false], 'Discover shown (its row is laid out now): the pill is revealed, and the note is spent first');
      w2.switchTab('bookings'); w2.switchTab('discover');
      eq(calls, ['week', 'reveal:false', 'week'], '…once: later visits do not drag a row the member has scrolled since');
    }
    eq([world({ clientWidth: 358, scrollWidth: 470, pill: null }).writes, world({ noRow: true, clientWidth: 1, scrollWidth: 2, pill: 1 }).writes], [0, 0], 'no lit pill (a picked date lights the calendar button — first in the row), or no row: nothing');
    ok(!/scrollIntoView\(/.test(grab(appSrc, 'function _revealActiveDatePill(', '}').replace(/\/\/.*$/gm, '')), 'never scrollIntoView() — that scrolls every scrollable ancestor, i.e. the page');
    const syncPills = grab(appSrc, 'function _syncDatePills(', '}');
    ok(!/_revealActiveDatePill/.test(syncPills), 'not from _syncDatePills: that runs on every background search, and must not drag a row the member scrolled');
    ok(/if \(typeof _revealActiveDatePill === 'function'\) _revealActiveDatePill\(\);/.test(t.readSource('js/interactions.js')), 'restoreFilters reveals it too (tests/suites/filters.js runs both launch orders)');
  }

  // ── e + f. CSS ───────────────────────────────────────────────────────────
  t.section('Handheld seat tiles are square; Stats sections share one inset on a phone');
  {
    const styles = t.readSource('css/styles.css'), settingsCss = t.readSource('css/settings.css'), theme = t.readSource('css/theme.css'), tabsCss = t.readSource('css/tabs.css');
    ok(/\.bike-slot rect \{ rx: var\(--radius-md\); ry: var\(--radius-md\); \}/.test(styles) && /\.bike-object \{ rx: var\(--radius-sm\); ry: var\(--radius-sm\); \}/.test(styles),
      'the picker\'s tiles and podium take their corner radius from the radius tokens (a CSS rx outranks the rect\'s rx attribute)');
    ok(/\.bike-pref-svg-slot rect \{ rx: var\(--radius-md\); ry: var\(--radius-md\); \}/.test(settingsCss) && /\.bike-pref-svg-object \{ rx: var\(--radius-sm\); ry: var\(--radius-sm\); \}/.test(settingsCss),
      '…as does the bike-preferences map');
    const gb = theme.slice(theme.indexOf('[data-theme="gameboy"] {'));
    ok(/--radius-sm: 0;/.test(gb.slice(0, gb.indexOf('}'))) && /--radius-md: 0;/.test(gb.slice(0, gb.indexOf('}'))), 'Handheld zeroes both tokens → square tiles');
    const root = theme.slice(theme.indexOf(':root'), theme.indexOf('}', theme.indexOf(':root')));
    ok(/--radius-md: 6px;/.test(root) && /--radius-sm: 4px;/.test(root), 'every other theme keeps the 6 / 4 units the attributes (still the fallback) carry');

    const phone = tabsCss.slice(tabsCss.indexOf('@media (max-width: 640px) {\n  .insights-section'));
    const block = phone.slice(0, phone.indexOf('\n}'));
    const sideInset = (sel) => (new RegExp('\\n  ' + sel.replace('.', '\\.') + '[^{]*\\{ padding: 0 (var\\(--space-\\d+\\)) ').exec(block) || [])[1];
    eq([sideInset('.insights-section'), sideInset('.reco-section'), sideInset('.heatmap-section')], ['var(--space-7)', 'var(--space-7)', 'var(--space-7)'],
      '"Your routine" and "Activity heatmap" sit at the same 16px token as the sections around them (they kept the desktop 24px)');
  }

  // ── g. "Fri 18" ──────────────────────────────────────────────────────────
  t.section('Waitlist / claim / leave copy: a class more than 6 days off says its month');
  {
    const NOW = new Date(2026, 8, 18, 12, 0).getTime(); // wall clock, like the class times
    const line = (startAt, extra) => {
      const ctx = t.vm.createContext({ Date: fixedDate(NOW), Math, String, isNaN, _eventCache: { 77: Object.assign({ start_at: startAt, _typeName: 'Ride', _instrName: 'Alex' }, extra || {}) } });
      t.vm.runInContext(grab(appSrc, 'function _waitlistClassLine(', '}'), ctx, { filename: 'js/app.js[_waitlistClassLine]' });
      return ctx._waitlistClassLine(77);
    };
    eq([line('2026-09-18 11:33:00'), line('2026-09-24 11:33:00')], ['Ride · Alex · Fri 18, 11:33am', 'Ride · Alex · Thu 24, 11:33am'], 'today, and up to 6 days off: as before — the day names it');
    eq([line('2026-09-25 11:33:00'), line('2026-10-16 18:00:00')], ['Ride · Alex · Fri 25 Sep, 11:33am', 'Ride · Alex · Fri 16 Oct, 6:00pm'], 'further ahead: the month is said (it read "Fri 16" for a class four weeks away)');
    eq(line('2026-09-04 07:15:00'), 'Ride · Alex · Fri 4 Sep, 7:15am', 'an ENDED place read about later: the month too');
    eq([line('soon'), line('2026-09-25T11:33:00', { _instrName: '' })], ['Ride · Alex', 'Ride · Fri 25 Sep, 11:33am'], 'an unreadable time is left out, as before; a missing name too');
  }

  // ── i. The Monday-reminder tap ───────────────────────────────────────────
  t.section('The Monday-reminder tap shows "Next week" without saving it');
  {
    const log = [];
    const els = { startDate: { value: '' }, daysAhead: { value: '' } };
    const ctx = t.loadPure('js/app.js', 'filters', {
      document: { getElementById: (id) => els[id] || null }, localDateStr: () => '2026-09-18', _dateQuickMode: 'week',
      _syncDatePills: () => log.push('pills'), triggerAutoSearch: () => log.push('search'),
    });
    t.vm.runInContext(grab(appSrc, 'function setDateQuick(', '}') + '\n' + grab(appSrc, 'function _applyDateQuick(', '}'), ctx, { filename: 'js/app.js[date presets]' });
    ctx.setDateQuick('tomorrow');
    eq([t.vm.runInContext('_dateQuickMode', ctx), els.startDate.value, String(els.daysAhead.value), log], ['tomorrow', '2026-09-19', '1', ['pills', 'search']], 'a pill tap: setDateQuick still does everything it did (it is only a name now)');
    log.length = 0;
    ctx._applyDateQuick('nextweek');
    eq([t.vm.runInContext('_dateQuickMode', ctx), els.startDate.value, log], ['nextweek', '2026-09-21', ['pills', 'search']], '_applyDateQuick is the same preset, painted and searched');
    ctx._applyDateQuick('nonsense');
    eq(t.vm.runInContext('_dateQuickMode', ctx), 'week', 'an unknown mode is the week, as before');

    const hook = appSrc.slice(appSrc.indexOf('window._onBookingWeekOpened = function'), appSrc.indexOf('async function search(opts) {'));
    ok(/_applyDateQuick\('nextweek'\);/.test(hook) && !/\bsetDateQuick\(/.test(hook), 'the reminder tap goes through _applyDateQuick — never the name interactions.js wraps with saveFilters');
    const inter = t.readSource('js/interactions.js');
    ok(/wrapGlobal\('setDateQuick', saveFilters\);/.test(inter) && !/_applyDateQuick/.test(inter), '…which is still setDateQuick alone: a pill tap is saved, a notification is not');

    // …and the member's NEXT tap must not save it either: every wrapped toggle
    // (a studio chip, a class type, the Time row) runs saveFilters, which
    // snapshotted the LIVE date row — one chip on the reminder's week, and every
    // later launch opened on "Next week" after all.
    ok(/window\._dateRowHeld = true;[^\n]*\n\s*_applyDateQuick\('nextweek'\);/.test(hook), 'the hook marks the date row as not the member\'s own before it applies the preset');
    const saveSrc = inter.slice(inter.indexOf('  function saveFilters() {'), inter.indexOf('  function restoreFilters() {'));
    const HOME = { locationIds: ['5'], startDate: '2026-09-18', daysAhead: '7', dateQuickMode: 'week' };
    const heldWorld = (stored) => {
      const store = t.makeFakeLocalStorage();
      if (stored) store.setItem('psycle_saved_filters', JSON.stringify(stored));
      const inputs = { startDate: { value: '2026-09-21' }, daysAhead: { value: '7' } };
      const c = t.loadPure('js/app.js', 'filters', {
        JSON, Array, String, Set, FILTERS_KEY: 'psycle_saved_filters', localStorage: store,
        document: { getElementById: (id) => inputs[id] || null, querySelectorAll: () => [] },
        localDateStr: () => '2026-09-21', _dateQuickMode: 'week', // the Monday the reminder fires
        _syncDatePills() {}, triggerAutoSearch() {},
      });
      c.window = c; // as in the page: app.js's globals ARE window's
      t.vm.runInContext([grab(appSrc, 'function setDateQuick(', '}'), grab(appSrc, 'function _applyDateQuick(', '}'), grab(appSrc, 'function _releaseDateRow(', '}'),
        grab(appSrc, 'function onDateInputChange(', '}'), saveSrc].join('\n'), c, { filename: 'js/app.js + interactions.js[held date row]' });
      // The reminder tap, as the hook does it; then `tap` = any wrapped toggle (the toggle, then the save).
      c.reminder = () => { c._dateRowHeld = true; c._applyDateQuick('nextweek'); };
      return { c, inputs, saved: () => JSON.parse(store.getItem('psycle_saved_filters') || 'null'), tap: () => c.saveFilters() };
    };
    const dateOf = (s) => [s.dateQuickMode, s.startDate, String(s.daysAhead)];
    let h = heldWorld(HOME);
    h.c.reminder();
    eq([h.inputs.startDate.value, dateOf(h.saved())], ['2026-09-28', ['week', '2026-09-18', '7']], '(the reminder itself: next week on screen, "7 days" still what is stored)');
    h.tap();
    eq(dateOf(h.saved()), ['week', '2026-09-18', '7'], 'one studio chip on that week: the save keeps the date ALREADY STORED (it wrote dateQuickMode "nextweek")');
    eq(h.c._restoredDateState(h.saved(), '2026-09-22').mode, 'week', '…so the next launch opens on the member\'s own "7 days"');
    h.tap(); h.tap();
    eq(dateOf(h.saved()), ['week', '2026-09-18', '7'], '…however many chips they tap');
    h.c.setDateQuick('nextweek');
    h.tap(); // setDateQuick's own wrapper
    eq([h.c._dateRowHeld, dateOf(h.saved())], [false, ['nextweek', '2026-09-28', '6']], 'a date PILL tapped by hand is the member\'s choice again: released, and saved live');
    h = heldWorld(HOME);
    h.c.reminder();
    h.inputs.startDate.value = '2026-09-30'; h.inputs.daysAhead.value = '1'; // pickCalDate → onDateInputChange
    h.c.onDateInputChange();
    h.tap();
    eq([h.c._dateRowHeld, dateOf(h.saved())], [false, [null, '2026-09-30', '1']], '…as is a day picked on the calendar');
    h = heldWorld(null);
    h.c.reminder();
    h.tap();
    eq([dateOf(h.saved()), h.c._restoredDateState(h.saved(), '2026-09-22').mode], [['week', '', '7'], 'week'], 'nothing stored yet (a first launch from the notification): the default week is what gets saved');
    h = heldWorld({ locationIds: ['5'] }); // a save from before the date row was stored
    h.c.reminder();
    h.tap();
    eq(h.c._restoredDateState(h.saved(), '2026-09-22').mode, 'week', 'a legacy save without a date row: still the week');
    h = heldWorld(HOME);
    h.c._applyDateQuick('tomorrow'); // not held: exactly as before
    h.tap();
    eq(dateOf(h.saved()), ['tomorrow', '2026-09-22', '1'], 'without the reminder saveFilters snapshots the live date row, as ever');
    const body = (opener) => grab(appSrc, opener, '}').replace(/\/\/.*$/gm, '');
    ok(['function clearFilters(', 'function applySavedSearch(', 'function clearToken('].every((f) => /if \(typeof _releaseDateRow === 'function'\) _releaseDateRow\(\);/.test(body(f))),
      'Clear filters, a recent-search pill and sign-out release it too (typeof-guarded: the suites run them on their own)');
    ok(/typeof window !== 'undefined' && window\._dateRowHeld/.test(saveSrc), 'saveFilters reads the flag behind a typeof window guard (tests/suites/discover.js runs it strict, without one)');
  }
};
