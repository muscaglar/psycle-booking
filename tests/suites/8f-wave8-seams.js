'use strict';
// Wave 8 — the seams BETWEEN the five lanes (filters bar, day pager, Stats
// sub-pages, first-run welcome, declutter). Each lane has its own suite; this
// one holds what only exists once they are merged:
//   - the ids the lanes agreed on are real, and each is looked for where the
//     other lanes look;
//   - the welcome's own swipe and the shared helper turn on the same movement;
//   - the welcome and the one-time "Swipe to change day" hint never both
//     explain the swipe in one page session;
//   - the Stats pages are swiped through the SHARED helper + showStatsPage;
//   - the empty Discover list says its reason once.
// The SHIPPED lines are sliced out of source and run against fakes.
module.exports = function (t) {
  const { ok, eq } = t;
  const app = t.readSource('js/app.js');
  const tabs = t.readSource('js/tabs.js');
  const inter = t.readSource('js/interactions.js');
  const theme = t.readSource('js/theme.js');
  const rel = t.readSource('js/reliability.js');
  const bridge = t.readSource('ios-app/www/native-bridge.js');
  const page = t.readSource('psycle-finder.html');
  const smoke = t.readSource('tests/smoke.html');
  const tabsCss = t.readSource('css/tabs.css');
  // A function, from its opener to its closing brace at the same indent.
  const fnSrc = (src, opener, indent) => {
    const s = src.indexOf(opener);
    const e = src.indexOf('\n' + (indent || '') + '}\n', s);
    if (s === -1 || e === -1) throw new Error('8f-wave8-seams suite: cannot slice "' + opener + '" (anchor moved?)');
    return src.slice(s, e + (indent || '').length + 2);
  };

  // ── The ids every lane refers to ─────────────────────────────────────────
  t.section('Wave 8 seams: the shared ids are real, and looked for where the other lanes look');
  ok(/<button type="button" class="controls-toggle" id="controlsToggle" aria-expanded="false" aria-controls="controlsBody"/.test(page),
    '#controlsToggle is a real button that names #controlsBody');
  ok(/<div class="controls-body" id="controlsBody">/.test(page), '#controlsBody exists');
  ok(page.indexOf('id="controlsToggle"') < page.indexOf('id="controlsBody"') && page.indexOf('class="date-presets"') < page.indexOf('id="controlsToggle"'),
    'date row, then the Filters bar, then the collapsible body');
  ok(/strip\.id = 'dayStrip';/.test(app) && /pager\.id = 'dayPager';/.test(app), 'app.js builds #dayStrip and #dayPager');
  ok(/const SWIPE_NAV_IGNORE = '[^']*#dayStrip'/.test(inter) && /\.date-presets, \.location-chips, #categoryPills/.test(inter),
    'the swipe helper leaves the day strip and the filter rows (8a kept their classes) to their own scrolling');
  ok(/target\.closest\('#dayPager'\)/.test(app), 'a day swipe may only start inside #dayPager');
  {
    const P = t.loadPure('js/tabs.js', 'stats-pages');
    eq(P.STATS_PAGES.map((p) => p.panel), ['statsPageOverview', 'statsPageHabits', 'statsPageInstructors'], 'the three Stats sub-pages carry the agreed ids');
    ok(/<div id="statsSwitcher" class="stats-switcher" role="tablist"/.test(tabs), '#statsSwitcher is the tab list');
  }
  ok(/overlay\.id = 'onboardOverlay';\n\s*overlay\.className = 'onboard-overlay';/.test(app), 'the welcome keeps id onboardOverlay + class onboard-overlay');
  ok(/getElementById\('onboardOverlay'\)/.test(rel) && /onboardOverlay/.test(bridge), '…which reliability.js and the iOS bridge look for by id');
  ok(/\.onboard-overlay/.test(fnSrc(app, 'function _ownKeysOverlayUp() {')), '…and the shared key handler by class (it stands aside for the welcome)');
  {
    // Who loads before whom decides who can call whom at load time.
    const order = (page.match(/<script[^>]+src="js\/([a-z-]+)\.js"/g) || []).map((s) => /js\/([a-z-]+)\.js/.exec(s)[1]);
    ok(order.indexOf('app') < order.indexOf('interactions') && order.indexOf('interactions') < order.indexOf('tabs'),
      'app.js → interactions.js → tabs.js: _dayPagerSwipe exists when the helper wires the pager, _psycleSwipe exists when tabs.js wires Stats');
  }
  ['toggleFilters', 'removeFilterChip', 'showDiscoverDay', '_psycleSwipe', 'showStatsPage', 'replayOnboarding'].forEach((name) => {
    ok(smoke.indexOf("checkType('" + name + "', 'function');") !== -1, 'tests/smoke.html checks ' + name + ' (reached by name across modules / inline onclick)');
  });

  // ── One movement, two implementations ───────────────────────────────────
  // The welcome opens while app.js is still being evaluated — before
  // interactions.js (the helper) exists — so it keeps its own listeners. The
  // RULES must stay the same, or a swipe learnt on the welcome's "Find" page
  // would not be the swipe Discover answers to.
  t.section('Wave 8 seams: the welcome pages and the shared swipe helper turn on the same movement');
  {
    const W = t.loadPure('js/app.js', 'welcome');
    const S = t.loadPure('js/interactions.js', 'swipe-nav');
    const moves = [[13, 0], [40, 10], [-60, 20], [200, 100], [0, 13], [10, 40], [-20, 60], [5, 5], [12, 0], [0, 12]];
    eq(moves.map(([dx, dy]) => W._welcomeSwipeAxis(dx, dy) || null), moves.map(([dx, dy]) => S.swipeNavAxis(dx, dy)),
      'sideways only past 12px and 1.5× the vertical travel; a scroll is a scroll; too early is too early');
    // Released: idx 1 of 4 (a page either side), 390px wide. Boundaries themselves are left out (> vs >=).
    const releases = [[-120, 600], [120, 600], [-90, 600], [90, 600], [-60, 120], [60, 120], [-30, 120], [-60, 400], [0, 50]];
    eq(releases.map(([dx, ms]) => W._welcomeSwipeTarget(1, 4, dx, 390, ms) - 1), releases.map(([dx, ms]) => S.swipeNavDir(dx, 390, ms, true, true)),
      'a quarter of the width, or 40px inside 250ms, turns the page; less springs back');
    eq([W._welcomeSwipeTarget(0, 4, 200, 390, 600), W._welcomeSwipeTarget(3, 4, -200, 390, 600)], [0, 3], 'the welcome never turns past an end…');
    eq([S.swipeNavDir(200, 390, 600, false, true), S.swipeNavDir(-200, 390, 600, true, false)], [0, 0], '…nor does the helper');
    eq([W._welcomeDragOffset(0, 4, 90), W._welcomeDragOffset(3, 4, -90), W._welcomeDragOffset(1, 4, -90)],
      [S.swipeNavOffset(90, false, true), S.swipeNavOffset(-90, true, false), S.swipeNavOffset(-90, true, true)],
      'against an end the content moves a third as far, in both');
  }

  // ── The swipe is explained once ─────────────────────────────────────────
  t.section('Wave 8 seams: the welcome and the "Swipe to change day" hint never share a page session');
  {
    const reveal = fnSrc(app, 'function _onboardReveal() {');
    const start = fnSrc(app, 'function startOnboarding(opts) {');
    ok(/window\._psycleWelcomeSeen = true;/.test(reveal), 'the welcome marks the session when it is really shown (_onboardReveal)…');
    ok(!/_psycleWelcomeSeen/.test(start), '…not where the overlay is built: the iOS holding cover teaches nothing');
    // The shipped _onboardReveal against a fake overlay.
    const win = {};
    const ov = { classList: { remove() {} }, removeAttribute() {}, querySelector: () => ({ focus() {} }) };
    const c = t.vm.createContext({ window: win, document: { getElementById: (id) => (id === 'onboardOverlay' ? ov : null), addEventListener() {}, removeEventListener() {} } });
    t.vm.runInContext('var _onboardKey = function () {};\n' + reveal, c, { filename: 'js/app.js[_onboardReveal]' });
    c._onboardReveal();
    eq(win._psycleWelcomeSeen, true, 'run: the flag is up once the welcome has focus and keys');

    // The shipped _paintDayHint: a returning member on a touch screen who has never seen the hint.
    const hintSrc = fnSrc(app, 'function _paintDayHint(pager, m) {');
    const paint = (o) => {
      const store = new Map(o.noFlag ? [] : [['psycle_onboarded_v1', '1']]);
      const pager = { kids: [], firstChild: null, querySelector() { return this.kids[0] || null; }, insertBefore(n) { this.kids.unshift(n); } };
      const ctx = t.loadPure('js/app.js', 'day-pager', {
        localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
        window: Object.assign({ matchMedia: () => ({ matches: true }) }, o.window || {}),
        document: { getElementById: () => (o.overlayUp ? {} : null), createElement: () => ({ setAttribute() {}, remove() {} }) },
      });
      t.vm.runInContext("var _pagerHintLive = false, _pagerSawWelcome = false, PAGER_HINT_KEY = 'psycle_hint_dayswipe';\n" + hintSrc, ctx,
        { filename: 'js/app.js[_paintDayHint]' });
      ctx._paintDayHint(pager, { paged: true });
      return [pager.kids.length, store.get('psycle_hint_dayswipe') || null];
    };
    eq(paint({}), [1, '1'], 'no welcome in sight: the hint shows, and is spent');
    eq(paint({ overlayUp: true }), [0, null], 'the welcome is up: no hint, and it is NOT spent (8b)');
    eq(paint({ window: { _psycleWelcomeSeen: true } }), [0, null],
      'replayed from Settings and closed again with no repaint in between: still no hint in this session — it keeps for a later launch');
    eq(paint({ noFlag: true }), [1, '1'],
      'a launch that SKIPPED the welcome (a #bookings link: no overlay, the completion flag left unset) — nobody told this member about swiping, so the hint shows');
    eq(paint({ noFlag: true, overlayUp: true }), [0, null], '…while a welcome that really is up still holds it back');
  }

  // ── Stats: swiped through the shared helper ─────────────────────────────
  t.section('Wave 8 seams: Stats sub-pages are swiped through the shared helper + showStatsPage');
  {
    ok(/_wireStatsPages\(statsPanel\);\n\s*_wireStatsSwipe\(statsPanel\);/.test(tabs), 'initTabs wires the swipe once, on the panel (it outlives every repaint)');
    const from = tabs.indexOf('  function _statsSwipeMayStart(target) {'), to = tabs.indexOf('  // ── Render insights tab content');
    ok(from !== -1 && to > from, 'the Stats swipe can be sliced (anchor moved?)');
    const world = (o) => {
      o = o || {};
      const log = { bound: [], shown: [] };
      const win = { showStatsPage: (id) => { log.shown.push(id); return true; } };
      if (!o.noHelper) win._psycleSwipe = (el, opts) => { log.bound.push(el); log.opts = opts; return function () {}; };
      const globals = { window: win, _currentTab: o.tab || 'stats', _dialogOpen: () => !!o.dialog, _ownKeysOverlayUp: () => !!o.ownKeys };
      if (o.stack) globals._overlayStack = o.stack;
      const ctx = t.loadPure('js/tabs.js', 'stats-pages', globals);
      t.vm.runInContext('var _statsHeroOnly = ' + !!o.hero + ', _statsPageNow = ' + JSON.stringify(o.at || 'overview') + ';\n' + tabs.slice(from, to), ctx,
        { filename: 'js/tabs.js[stats swipe]' });
      return { ctx, log };
    };
    let w = world({ noHelper: true });
    w.ctx._wireStatsSwipe({});
    eq(w.log.bound.length, 0, 'without interactions.js nothing is bound and nothing throws (segments + keys remain)');
    const panel = { id: 'tab-stats' };
    w = world({ at: 'overview' });
    w.ctx._wireStatsSwipe(panel);
    eq([w.log.bound.length, w.log.bound[0] === panel], [1, true], 'bound once, to the Stats panel');
    eq(w.log.opts.edges(), { prev: false, next: true }, 'Overview: nothing before it — the helper resists a swipe right');
    eq(typeof w.log.opts.onMove, 'undefined', 'nothing follows the finger (one page is laid out at a time): the release opens the neighbour');
    w.log.opts.onEnd({ dir: 1, dx: -200, cancelled: false });
    w.log.opts.onEnd({ dir: -1, dx: 200, cancelled: false });
    w.log.opts.onEnd({ dir: 0, dx: -20, cancelled: false });
    w.log.opts.onEnd({ dir: 1, dx: -200, cancelled: true });
    eq(w.log.shown, ['habits'], 'swipe left → the next page through showStatsPage; past the first page, a spring-back and a cancelled touch open nothing');
    w = world({ at: 'instructors' });
    w.ctx._wireStatsSwipe(panel);
    eq(w.log.opts.edges(), { prev: true, next: false }, 'Instructors: nothing after it (a swipe does not wrap, unlike the arrow keys)');
    w.log.opts.onEnd({ dir: -1, dx: 200, cancelled: false });
    eq(w.log.shown, ['habits'], 'swipe right → the previous page');

    const onPage = { closest: (sel) => (sel === '.stats-page' ? {} : null) };
    const offPage = { closest: () => null };
    const may = (o, target) => { const x = world(o); x.ctx._wireStatsSwipe(panel); return !x.log.opts.shouldIgnore(target); };
    eq([may({}, onPage), may({}, offPage), may({}, null)], [true, false, false], 'only a touch that starts on a page (not the banner, the hero or the pinned switcher)');
    eq([may({ hero: true }, onPage), may({ tab: 'discover' }, onPage)], [false, false], 'not in the hero states, not behind another tab');
    eq([may({ dialog: true }, onPage), may({ ownKeys: true }, onPage), may({ stack: [{}] }, onPage), may({ stack: [] }, onPage)], [false, false, false, true],
      'never under a dialog, the welcome / usual-week sheet, or any open overlay');
    ok(/\n\.stats-page \{ touch-action: pan-y pinch-zoom; \}/.test(tabsCss),
      'the pages are touch-action: pan-y (the helper never preventDefaults) and keep pinch-zoom');
    ok(/\n\.day-pager \{ touch-action: pan-y pinch-zoom; \}/.test(t.readSource('css/redesign.css')),
      '…and so does the Discover day pager, swiped through the same helper: every class card sits inside it, and the viewport allows zoom');
  }

  // ── Coming back to Discover ─────────────────────────────────────────────
  t.section('Wave 8 seams: the Filters bar chips are re-read on the way back to Discover');
  {
    const at = tabs.indexOf("    if (tab === 'discover') {"), end = tabs.indexOf("    if (tab === 'stats') {", at);
    ok(at !== -1 && end > at, "switchTab's Discover branch can be sliced (anchor moved?)");
    ok(/if \(typeof updateFiltersSummary === 'function'\) updateFiltersSummary\(\);/.test(tabs.slice(at, end)),
      'an "S/A" chip follows a rank changed on Membership (a rank has no event)');
  }

  // ── The empty list says its reason once ─────────────────────────────────
  t.section('Wave 8 seams: an empty Discover list says why ONCE (the declutter rule, in the day pager\'s region)');
  {
    const ec = app.slice(app.indexOf('function _discoverEmptyContext() {'), app.indexOf('function mergeRelations('));
    ok(!/Nothing matches these filters|Nothing left on today|There are no classes on the dates shown/.test(ec), 'no sentence that repeats its title');
    // (Wave 13: "Next week opens Monday 12:00" was untrue — that week is long open. What can
    // be empty for lack of a release is a date not yet LISTED; it keeps the second line, a time.)
    ok(/title: "Couldn't check these dates", sub: /.test(ec) && /title: 'Not on the timetable yet', sub: /.test(ec) && !/Next week opens/.test(ec), 'a cause and a time keep their second line');
    ok(/return \{ title: 'No classes on these dates', actions: /.test(ec), 'with no filter set the title does not blame "these filters"');
    const block = theme.slice(theme.indexOf('const EMPTY_STATE_ACTIONS'), theme.indexOf('// ── D. Haptic Feedback'));
    ok(block.indexOf('Try adjusting your filters') === -1, 'the catch-all paragraph is gone');
    const draw = (ctxValue, message) => {
      const c = t.vm.createContext({ Object, escapeHTML: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'), _discoverEmptyContext: () => ctxValue });
      t.vm.runInContext(block + '\n;var __html = renderEmptyState(' + JSON.stringify(message) + ');', c, { filename: 'js/theme.js[renderEmptyState]' });
      return c.__html;
    };
    let html = draw({ title: 'No more classes today', actions: ['tomorrow', 'week'] }, 'No classes found for these filters.');
    ok(/<div class="empty-title">No more classes today<\/div>/.test(html) && html.indexOf('empty-subtitle') === -1 && (html.match(/<button type="button" class="empty-action[ "]/g) || []).length === 2,
      'run: a title and its two ways on — no second line');
    html = draw({ title: "Couldn't check these dates", sub: 'The latest timetable didn\'t load.', actions: ['retry'] }, 'x');
    ok(html.indexOf('<div class="empty-subtitle">The latest timetable didn\'t load.</div>') !== -1, 'run: a reason that adds something is still printed');
    html = draw(null, 'No classes found.');
    ok(/<div class="empty-title">No classes found\.<\/div>/.test(html) && html.indexOf('empty-subtitle') === -1, 'run: no context → the plain title alone');
  }
};
