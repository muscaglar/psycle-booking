'use strict';
// Stats in three sub-pages behind a content switcher (wave 8c).
//
// Stats was one scroll of thirteen sections; a product designer asked for
// three logical sub-pages behind a switcher. This suite holds:
//   · the grouping + "which page is empty" decisions (pure:stats-pages, js/tabs.js);
//   · the REAL switcher / lazy-paint code, sliced out of tabs.js and driven
//     against a fake DOM: tab-list semantics, one page displayed, a page built
//     when it is first opened and not again, the hero states, the quiet line;
//   · explore.js's gate (its three sections are not built while their page is closed);
//   · the CSS block: tokens only, pinned, fingertip-tall, readable in every theme.
module.exports = function (t) {
  const { ok, eq } = t;
  const tabsSrc = t.readSource('js/tabs.js');
  const exSrc = t.readSource('js/explore.js');
  const tabsCss = t.readSource('css/tabs.css');
  const themeCss = t.readSource('css/theme.css');
  const plain = (v) => JSON.parse(JSON.stringify(v)); // out of the vm realm, for eq

  const p = t.loadPure('js/tabs.js', 'stats-pages');
  const PAGES = plain(p.STATS_PAGES);

  // ── 1. The grouping ──────────────────────────────────────────────────────
  t.section('Stats pages: three groups a member would name the same way');
  eq(PAGES.map((pg) => pg.id), ['overview', 'habits', 'instructors'], 'how much · when and what · who');
  eq(PAGES.map((pg) => pg.label), ['Overview', 'Habits', 'Instructors'], 'the three segment labels');
  eq(PAGES.map((pg) => pg.panel), ['statsPageOverview', 'statsPageHabits', 'statsPageInstructors'], 'the shared page ids other agents refer to');
  {
    const all = [].concat.apply([], PAGES.map((pg) => pg.sections));
    eq(all.length, new Set(all).size, 'nothing appears on two pages');
    // Every section container initTabs can create is placed — and nothing is
    // placed that initTabs cannot create (it would be a hole in a page).
    const from = tabsSrc.indexOf("statsPanel.id = 'tab-stats';"), to = tabsSrc.indexOf('// ── Membership tab');
    ok(from !== -1 && to > from, 'the Stats panel assembly can be sliced (anchor moved?)');
    const made = [];
    tabsSrc.slice(from, to).replace(/^\s+(\w+): '<div id="(\w+)"/gm, (m, key, id) => { made.push(key); if (key !== id) made.push('MISMATCH:' + key + '/' + id); return m; });
    eq(made.slice().sort(), all.slice().sort(), 'every section initTabs can build sits on exactly one page, keyed by its own id (' + made.length + ')');
    eq(all.length, 13, 'all thirteen sections survived the move');
  }
  // Wave 9 (Crisp Colour): the approved Stats board IS Overview — all time with
  // this month and upcoming, the week streak, "When you train", class types,
  // the year wrap — so the heatmap and the class types moved there from Habits.
  eq(PAGES[0].sections, ['statsBar', 'streakSection', 'heatmapSection', 'classTypeSection', 'yearReviewSection', 'shareSection'],
    'Overview, in the board\'s order: the tiles, the streak, When you train, class types, the year wrap, share');
  // The page a section sits on, read from the shipped table; null when it is on none.
  const pageOf = (sid) => { const pg = PAGES.find((x) => x.sections.indexOf(sid) !== -1); return pg ? pg.id : null; };
  eq([pageOf('habitSection'), pageOf('recoSection')],
    ['habits', 'habits'], 'Habits: what repeats, each with its action — usual slots, routine');
  eq([pageOf('heatmapSection'), pageOf('classTypeSection')], ['overview', 'overview'], 'the two charts of the board sit on Overview');
  ok(/var model = _heatmapModel\(allEvents\.map\(function \(evt\) \{ return evt\.start_at; \}\)\);/.test(tabsSrc), 'renderHeatmap still plots WHEN you train (weekday × time of day, pure:stats-charts) — not a calendar of volume');
  eq(pageOf('varietySection'), 'instructors', '"Instructor variety" counts unique INSTRUCTORS per month — who, not what');
  eq(['exploreMapSection', 'lapsedSection', 'exploreLikeSection', 'exploreNewSection'].map(pageOf),
    ['instructors', 'instructors', 'instructors', 'instructors'], 'Instructors: the map, lapsed favourites and both suggestion rows');
  eq(pageOf('costSection'), null, 'a section that is not on Stats has no page');

  t.section('Stats pages: which page opens');
  eq([p._statsPageId(null), p._statsPageId(undefined), p._statsPageId(''), p._statsPageId('insights'), p._statsPageId('__proto__'), p._statsPageId(7)],
    ['overview', 'overview', 'overview', 'overview', 'overview', 'overview'], 'nothing stored (a fresh launch), or anything that is not a page id → Overview');
  eq([p._statsPageId('habits'), p._statsPageId('instructors'), p._statsPageId('overview')], ['habits', 'instructors', 'overview'], 'a remembered page is reopened');
  eq(p.STATS_PAGE_KEY, 'psycle_stats_page', 'remembered under the agreed sessionStorage key');

  t.section('Stats pages: the tab list keys');
  eq(['ArrowRight', 'ArrowLeft', 'Home', 'End'].map((k) => p._statsPageForKey('overview', k)), ['habits', 'instructors', 'overview', 'instructors'],
    'from Overview: Right → Habits, Left wraps to Instructors, Home / End → the ends');
  eq(['ArrowRight', 'ArrowLeft'].map((k) => p._statsPageForKey('instructors', k)), ['overview', 'habits'], 'from Instructors: Right wraps to Overview');
  eq(['Enter', ' ', 'Tab', 'ArrowDown', 'a', 'Escape'].map((k) => p._statsPageForKey('habits', k)), [null, null, null, null, null, null],
    'any other key is not the tab list\'s (null → not swallowed)');
  eq(p._statsPageForKey('nonsense', 'ArrowRight'), 'habits', 'an unknown current page counts as Overview');
  eq([p._statsPageStep('overview', 1), p._statsPageStep('habits', 1), p._statsPageStep('instructors', 1), p._statsPageStep('overview', -1), p._statsPageStep('habits', -1)],
    ['habits', 'instructors', null, null, 'overview'], 'a swipe steps to the neighbour and does NOT wrap past either end');

  t.section('Stats pages: a page with nothing on it');
  {
    const none = {}, some = { recoSection: true };
    eq([p._statsPageIsEmpty('habits', none), p._statsPageIsEmpty('habits', some), p._statsPageIsEmpty('overview', some), p._statsPageIsEmpty('habits', null)],
      [true, false, true, true], 'empty = none of ITS sections is shown (another page\'s do not count)');
    eq(p._statsPageIsEmpty('nonsense', none), false, 'an unknown page is not "empty" — there is nowhere to say so');
    eq(p._statsEmptyState('habits', some, { hasToken: true }), null, 'a page with content says nothing');
    const line = (o) => plain(p._statsEmptyState('overview', none, o));
    eq(line({ hasToken: true, synced: true, bannerUp: true }), { line: 'Nothing here yet.', sync: false }, 'ONE quiet line — never a blank page');
    ok(line({}).line.length <= 24 && !/[!]/.test(line({}).line), '…short, and no exclamation mark');
    eq(line({ hasToken: true, synced: false, bannerUp: false }).sync, true, 'a member who has never synced, with no banner offering it: the page offers "Sync my history"');
    eq([line({ hasToken: true, synced: false, bannerUp: true }).sync, line({ hasToken: true, synced: true, bannerUp: false }).sync, line({ hasToken: false, synced: false, bannerUp: false }).sync, line(undefined).sync],
      [false, false, false, false], 'not twice on one screen (the banner above already offers it), not after a sync, not without a session');
  }

  // ── 2. The shipped switcher code against a fake DOM ──────────────────────
  // Everything between the pure block and renderInsights' banner, as shipped.
  const blockFrom = tabsSrc.indexOf('  // ── pure:stats-pages:start');
  const blockTo = tabsSrc.indexOf('  // ── Render insights tab content');
  ok(blockFrom !== -1 && blockTo > blockFrom, 'the Stats sub-pages block can be sliced (anchor moved?)');
  const sectionHtml = {};
  PAGES.forEach((pg) => pg.sections.forEach((sid) => { sectionHtml[sid] = '<div id="' + sid + '" class="x" style="display:none"></div>'; }));

  function world(o) {
    o = o || {};
    const log = { paints: [], explore: 0, announced: [], actions: [], scrolls: [], focused: [], listeners: {}, observed: [] };
    // Layout, for the scroll rule: header 60 · banner 92 · switcher bar 60 · page.
    // On a phone .tab-content (top 60) scrolls; wider, the document does.
    const geo = { scroll: o.scrollAt || 0 };
    const rect = (naturalTop) => () => ({ top: naturalTop - geo.scroll });
    const session = new Map(o.session ? [['psycle_stats_page', o.session]] : []);
    const els = {};
    const el = (id, extra) => (els[id] = Object.assign({
      id, hidden: false, style: { display: '', setProperty(k, v) { this[k] = v; }, getPropertyValue(k) { return this[k] || ''; } }, attrs: {}, tabIndex: null, innerHTML: '', offsetHeight: 41,
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
      addEventListener(type, fn) { log.listeners[id + ':' + type] = fn; }, focus() { log.focused.push(id); },
      querySelector() { return null; },
    }, extra || {}));
    const paint = (name) => () => log.paints.push(name);
    const ctx = t.vm.createContext({
      console, Object, Array, String, JSON,
      _currentTab: o.tab || 'stats',
      sessionStorage: o.deadStorage ? { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } }
        : { getItem: (k) => (session.has(k) ? session.get(k) : null), setItem: (k, v) => session.set(k, String(v)) },
      localStorage: { getItem: (k) => (k === 'psycle_history_synced' && o.synced ? '2026-09-01' : null) },
      getBearerToken: () => (o.token === undefined ? 'tok' : o.token),
      escapeHTML: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
      announce: (text) => log.announced.push(text),
      renderExplore: () => { log.explore++; },
      parseFloat, Math, Number,
      getComputedStyle: (node) => (node && node.id === '__scroller' ? { overflowY: o.phone ? 'auto' : 'clip' } : { position: o.phone ? 'fixed' : 'sticky' }),
      MutationObserver: function (cb) { log.mutate = cb; this.observe = (node) => log.observed.push(node.id); },
      renderQuickStats: paint('statsBar'), renderStreaks: paint('streakSection'), renderYearReview: paint('yearReviewSection'),
      renderHabitSlots: paint('habitSection'), renderRecommendations: paint('recoSection'), renderHeatmap: paint('heatmapSection'),
      renderClassTypeDistribution: paint('classTypeSection'), renderVarietyTrend: paint('varietySection'), renderLapsedFavourites: paint('lapsedSection'),
    });
    ctx.window = {
      addEventListener: (type, fn) => { log.listeners['window:' + type] = fn; }, pushAction: (a) => log.actions.push(a), _explore_syncHistory: o.noSync ? undefined : () => {},
      get scrollY() { return o.phone ? 0 : geo.scroll; }, scrollTo: (x, y) => { log.scrolls.push('window:' + y); geo.scroll = y; },
    };
    ctx.document = {
      getElementById: (id) => els[id] || null,
      querySelector: (sel) => (sel === '#tab-stats .stats-switcher-bar' ? els.__bar : sel === '.tab-content' ? els.__scroller : sel === '.tab-bar' ? els.__tabBar : null),
    };
    t.vm.runInContext(tabsSrc.slice(blockFrom, blockTo), ctx, { filename: 'js/tabs.js[stats-pages]' });

    // Build the fake DOM from the markup the shipped code writes.
    const html = ctx._statsPagesHtml(sectionHtml, ctx._statsPageNow);
    el('__bar', { offsetHeight: 60 }); el('__tabBar');
    el('__scroller', { getBoundingClientRect: () => ({ top: 60 }) });
    Object.defineProperty(els.__scroller, 'scrollTop', { get: () => (o.phone ? geo.scroll : 0), set: (v) => { log.scrolls.push('content:' + v); geo.scroll = v; } });
    el('exploreSyncSection', { style: { display: 'none' }, firstChild: null });
    html.replace(/<(div|button)\b([^>]*)>/g, (m, tag, attrs) => {
      const id = (/\bid="([^"]+)"/.exec(attrs) || [])[1];
      if (!id) return m;
      const node = el(id, { tag, hidden: /\shidden(\s|$)/.test(attrs), style: { display: /display:none/.test(attrs) ? 'none' : '' } });
      attrs.replace(/([\w-]+)="([^"]*)"/g, (mm, k, v) => { node.attrs[k] = v; return mm; });
      if (tag === 'button') node.tabIndex = Number(node.attrs.tabindex);
      return m;
    });
    PAGES.forEach((pg) => {
      const slot = el(pg.panel + ':empty', { hidden: true });
      els[pg.panel].querySelector = (sel) => (sel === '.stats-page-empty' ? slot : null);
      els[pg.panel].getBoundingClientRect = rect(o.phone ? 60 + 92 + 60 : 60 + 41 + 92 + 60);
    });
    const panel = { querySelector: (sel) => els[sel.replace(/^#/, '')] || null };
    ctx._wireStatsPages(panel);
    return {
      ctx, log, els, html, session, geo,
      selected: () => PAGES.filter((pg) => els[pg.tab].attrs['aria-selected'] === 'true').map((pg) => pg.id),
      open: () => PAGES.filter((pg) => !els[pg.panel].hidden).map((pg) => pg.id),
      slot: (id) => els[PAGES.find((pg) => pg.id === id).panel + ':empty'],
      show: (ids) => ids.forEach((sid) => { els[sid].style.display = ''; }),
      key: (key, mods) => { const e = Object.assign({ key, prevented: false, preventDefault() { this.prevented = true; } }, mods || {}); log.listeners['statsSwitcher:keydown'](e); return e.prevented; },
    };
  }

  t.section('Stats switcher: a real tab list');
  {
    const w = world();
    const tabs = w.html.match(/<button\b[^>]*>[^<]*<\/button>/g) || [];
    eq(tabs.length, 3, 'three segments, each a real <button>');
    ok(tabs.every((b) => /type="button"/.test(b) && /role="tab"/.test(b) && /class="stats-switcher-tab"/.test(b)), '…type=button, role=tab');
    ok(/<div id="statsSwitcher" class="stats-switcher" role="tablist" aria-label="[^"]+">/.test(w.html), '#statsSwitcher is the role=tablist, and it is named');
    PAGES.forEach((pg) => {
      const tab = w.els[pg.tab], panel = w.els[pg.panel];
      ok(tab && panel && tab.attrs['aria-controls'] === pg.panel && panel.attrs.role === 'tabpanel' && panel.attrs['aria-labelledby'] === pg.tab,
        pg.label + ': the tab names its panel (aria-controls) and the role=tabpanel is labelled by its tab');
      ok(new RegExp("onclick=\"showStatsPage\\('" + pg.id + "'\\)\"").test(w.html), pg.label + ': a tap opens it through window.showStatsPage');
    });
    eq([w.selected(), w.open()], [['overview'], ['overview']], 'a fresh launch: Overview selected, and ONLY its page is displayed');
    eq(PAGES.map((pg) => w.els[pg.tab].tabIndex), [0, -1, -1], 'a roving tabindex: one stop in the Tab order, arrows move within');
    // Every section is inside the wrapper of the page the table names, once.
    PAGES.forEach((pg) => {
      const from = w.html.indexOf('<div id="' + pg.panel + '"'), next = w.html.indexOf('<div id="statsPage', from + 1);
      const body = w.html.slice(from, next === -1 ? undefined : next);
      eq(pg.sections.map((sid) => body.split('id="' + sid + '"').length - 1), pg.sections.map(() => 1), pg.label + ' wraps its own sections, each once');
    });
    eq(w.log.observed.slice().sort(), [].concat.apply(['exploreSyncSection'], PAGES.map((pg) => pg.sections)).sort(),
      'every section\'s style attribute is watched (explore.js shows and hides its three after renderInsights has run) — and the banner\'s');
  }

  t.section('Stats switcher: opening a page');
  {
    const w = world();
    w.ctx._syncStatsPages(false); // what renderInsights does on switchTab('stats')
    eq(w.log.paints, ['statsBar', 'streakSection', 'heatmapSection', 'classTypeSection', 'yearReviewSection'], 'a Stats visit builds the page on screen and nothing else (it built all thirteen sections)');
    eq(w.log.explore, 0, '…explore.js is not asked for sections that sit on a closed page');
    w.log.paints.length = 0;

    eq(w.ctx.window.showStatsPage('habits'), true, 'showStatsPage answers true for a page it knows');
    eq([w.selected(), w.open()], [['habits'], ['habits']], 'Habits is selected, and only Habits is displayed');
    eq(PAGES.map((pg) => w.els[pg.tab].tabIndex), [-1, 0, -1], 'the Tab stop moved with it');
    eq(w.log.paints, ['habitSection', 'recoSection'], 'its sections are built when it is first opened, in page order');
    eq([w.log.announced, w.session.get('psycle_stats_page'), w.log.actions], [['Habits'], 'habits', ['stats:page to=habits']],
      'announced by name, remembered for the session, and left on the bug-report trail');
    eq(w.log.scrolls, [], 'opened from the top of the tab: nothing scrolls');

    w.ctx.window.showStatsPage('overview');
    w.ctx.window.showStatsPage('habits');
    eq(w.log.paints.length, 2, 'there and back again: nothing is built twice in one visit');
    w.ctx.window.showStatsPage('habits');
    eq(w.log.announced, ['Habits', 'Overview', 'Habits'], 'a tap on the page already open is not announced again');

    w.ctx.window.showStatsPage('instructors');
    eq([w.log.paints.slice(2), w.log.explore], [['varietySection', 'lapsedSection'], 1], 'Instructors: its own two sections, and explore.js is asked once for its three');

    eq([w.ctx.window.showStatsPage('nonsense'), w.ctx.window.showStatsPage(undefined), w.selected()], [false, false, ['instructors']], 'an id it does not know changes nothing');

    // explore.js went dirty while Instructors was CLOSED (/instructors landed, a
    // booking made from a sheet): it skips a closed page, so it has to be asked
    // again when the page reopens — although tabs.js built that page already.
    // "Loading instructors…" stayed up until the member left Stats otherwise.
    w.ctx.window.showStatsPage('overview');
    const before = { paints: w.log.paints.length, explore: w.log.explore };
    w.ctx.window.showStatsPage('instructors');
    eq([w.log.paints.length - before.paints, w.log.explore - before.explore], [0, 1],
      'Instructors reopened in the same visit: none of its own sections is built twice, and explore.js is asked again — once (it returns at once unless it is dirty)');
    w.ctx.window.showStatsPage('habits');
    eq(w.log.explore - before.explore, 1, '…a page with no explore section never asks');
    w.ctx.window.showStatsPage('instructors'); // back where the checks below expect to be

    // bookings:loaded / a sync / auth:changed → renderInsights again: a fresh look.
    w.log.paints.length = 0;
    w.ctx._syncStatsPages(false);
    eq(w.log.paints, ['varietySection', 'lapsedSection'], 'renderInsights again = new data: the page on screen is rebuilt — and only that one');
    w.ctx.window.showStatsPage('overview');
    eq(w.log.paints.slice(2), ['statsBar', 'streakSection', 'heatmapSection', 'classTypeSection', 'yearReviewSection'], '…the others when they are next opened');
    eq([w.ctx.window._statsPageStep(1), w.ctx.window._statsPageStep(-1)], ['habits', null], 'window._statsPageStep tells a swipe helper where a swipe would lead from here');
  }
  {
    const w = world({ session: 'instructors' });
    eq([w.selected(), w.open()], [['instructors'], ['instructors']], 'same session (a reload, coming back to the tab): the page last opened is the one built into the markup');
    const w2 = world({ session: 'javascript:alert(1)' });
    eq(w2.selected(), ['overview'], 'a stored value that is not a page id → Overview (and never reaches the markup)');
    ok(w2.html.indexOf('javascript') === -1, '…nothing of it is printed');
    const w3 = world({ deadStorage: true });
    eq([w3.selected(), w3.ctx.window.showStatsPage('habits'), w3.selected()], [['overview'], true, ['habits']], 'sessionStorage that throws: Overview, and the switcher still works');
    const w4 = world({ tab: 'discover', session: 'instructors' });
    w4.ctx._syncStatsPages(false);
    eq([w4.log.paints, w4.log.explore], [['varietySection', 'lapsedSection'], 0], 'renderInsights behind another tab (after a history sync) still never asks explore.js to build for a hidden tab');
  }

  t.section('Stats switcher: a new page starts at its top, and the switcher stays under the thumb');
  {
    // current scroll · page offset in the content · bar height · what it pins beneath
    eq([p._statsScrollTarget(500, 152, 60, 0), p._statsScrollTarget(92, 152, 60, 0), p._statsScrollTarget(40, 152, 60, 0), p._statsScrollTarget(0, 152, 60, 0)],
      [92, 92, 40, 0], 'scrolled past the pin point → back to exactly that point; at or above it → nothing moves');
    eq(p._statsScrollTarget(600, 253, 60, 41), 152, 'wider than a phone the sticky tab bar\'s height comes off too');
    eq([p._statsScrollTarget(300, 40, 60, 0), p._statsScrollTarget(-5, 152, 60, 0), p._statsScrollTarget(NaN, 'x', null, undefined)], [0, 0, 0],
      'never negative, never NaN (no banner above the switcher: the pin point is the very top)');

    let w = world({ phone: true, scrollAt: 500 });
    w.ctx._syncStatsPages(false);
    w.ctx.window.showStatsPage('habits');
    eq([w.log.scrolls, w.geo.scroll], [['content:92'], 92], 'phone, deep in Overview → Habits: .tab-content goes to the pin point — Habits\' first section sits right under the pinned switcher');
    w.ctx.window.showStatsPage('habits');
    eq(w.log.scrolls, ['content:92'], 'already there: no second write');
    w = world({ phone: true, scrollAt: 40 });
    w.ctx._syncStatsPages(false);
    w.ctx.window.showStatsPage('instructors');
    eq(w.log.scrolls, [], 'phone, switcher not pinned yet: nothing moves (the control must not slide away from the tap)');
    w = world({ scrollAt: 600 });
    w.ctx._syncStatsPages(false);
    w.ctx.window.showStatsPage('habits');
    eq(w.log.scrolls, ['window:152'], 'wider: the DOCUMENT scrolls, to the point where the switcher pins under the tab bar');
    w = world({ phone: true, scrollAt: 500, tab: 'bookings' });
    w.ctx._syncStatsPages(false);
    w.ctx.window.showStatsPage('habits');
    eq([w.log.scrolls, w.selected()], [[], ['habits']], 'called while another tab is up: the page is chosen, that tab\'s scroll offset is left alone');
  }

  t.section('Stats switcher: keyboard');
  {
    const w = world();
    w.ctx._syncStatsPages(false);
    eq([w.key('ArrowRight'), w.selected(), w.log.focused], [true, ['habits'], ['statsTabHabits']], 'Right: the next page opens and focus moves to its tab (selection follows focus)');
    eq([w.key('ArrowLeft'), w.key('ArrowLeft'), w.selected()], [true, true, ['instructors']], 'Left, Left: back to Overview, then round to Instructors');
    eq([w.key('Home'), w.selected(), w.key('End'), w.selected()], [true, ['overview'], true, ['instructors']], 'Home / End');
    eq([w.key('Enter'), w.key('Tab'), w.key('ArrowDown'), w.selected()], [false, false, false, ['instructors']], 'other keys are left alone (Enter / Space reach the button\'s own click)');
    eq([w.key('ArrowLeft', { altKey: true }), w.key('ArrowLeft', { metaKey: true }), w.selected()], [false, false, ['instructors']], 'Alt / Cmd + arrow is the browser\'s (back / forward), not the tab list\'s');
  }

  t.section('Stats pages: the hero states and the quiet line');
  {
    // Signed out, or a kept token with nothing on record: the hero has the tab.
    const w = world();
    w.ctx._syncStatsPages(true);
    eq([w.els.__bar.hidden, w.open(), w.log.paints, w.log.explore], [true, [], [], 0], 'hero only: no switcher, no page, and nothing is built behind it');
    w.ctx.window.showStatsPage('habits');
    eq([w.open(), w.log.paints], [[], []], '…a page asked for meanwhile is remembered, not shown');
    w.ctx._syncStatsPages(false);
    eq([w.els.__bar.hidden, w.open(), w.log.paints], [false, ['habits'], ['habitSection', 'recoSection']], 'signed in again: the switcher is back, on that page');
  }
  {
    const w = world({ synced: true });
    w.ctx._syncStatsPages(false);
    eq([w.slot('overview').hidden, w.slot('overview').innerHTML], [false, '<p class="stats-page-empty-line">Nothing here yet.</p>'],
      'a member with no classes yet: Overview is not blank — one quiet line');
    w.show(['statsBar']);
    w.log.mutate(); // what the observer delivers when a section's display flips
    eq([w.slot('overview').hidden, w.slot('overview').innerHTML], [true, ''], 'a section appears (whoever showed it) → the line goes');
    w.ctx.window.showStatsPage('habits');
    eq([w.slot('habits').hidden, w.slot('overview').hidden], [false, true], 'each page answers for itself');
  }
  {
    const banner = (up) => (node) => { node.style.display = up ? '' : 'none'; node.firstChild = up ? {} : null; };
    let w = world({ synced: false });
    w.ctx._syncStatsPages(false);
    ok(/onclick="window\._explore_syncHistory\(\)">Sync my history<\/button>$/.test(w.slot('overview').innerHTML), 'never synced and no banner on screen: the line comes with the existing "Sync my history" action');
    banner(true)(w.els.exploreSyncSection);
    w.log.mutate(); // explore.js draws the banner right after renderInsights
    eq(w.slot('overview').innerHTML, '<p class="stats-page-empty-line">Nothing here yet.</p>', 'once the global banner offers the sync, the page does not offer it a second time');
    w = world({ synced: false, token: '' });
    w.ctx._syncStatsPages(false);
    ok(!/button/.test(w.slot('overview').innerHTML), 'no session: no sync to offer');
    w = world({ synced: false, noSync: true });
    w.ctx._syncStatsPages(false);
    ok(!/button/.test(w.slot('overview').innerHTML), 'explore.js absent: no button that could only do nothing');
  }
  {
    const w = world();
    w.ctx._syncStatsPages(false);
    eq(w.els.__bar.style['--stats-pin-top'], '41px', 'wider than a phone the switcher pins under the sticky tab bar, by its measured height');
    const ph = world({ phone: true });
    ph.ctx._syncStatsPages(false);
    eq(ph.els.__bar.style['--stats-pin-top'], '0px', 'on a phone the tab bar is docked to the bottom: pinned at the top of the scroller');
    ok(typeof w.log.listeners['window:resize'] === 'function', '…and re-measured on resize');
  }

  // ── 3. renderInsights + initTabs + explore.js wiring ─────────────────────
  t.section('Stats pages: wiring');
  {
    const rFrom = tabsSrc.indexOf('  window.renderInsights = function () {');
    const body = tabsSrc.slice(rFrom, tabsSrc.indexOf('  // ── Quick Stats', rFrom));
    ok(/_syncStatsPages\(signedOut \|\| \(!signedIn && !hasHistory\)\);/.test(body), 'renderInsights hands the sections to _syncStatsPages, with the very condition its hero is shown by');
    ok(/if \(signedOut \|\| \(!signedIn && !hasHistory\)\) \{\s*statsEmpty\.style\.display = '';/.test(body), '…(that condition, unchanged)');
    ok(!/render(QuickStats|HabitSlots|Streaks|ClassTypeDistribution|Heatmap|Recommendations|LapsedFavourites|VarietyTrend|YearReview)\(\)/.test(body),
      'it no longer builds every section itself on every call');
    const init = tabsSrc.slice(tabsSrc.indexOf("statsPanel.id = 'tab-stats';"), tabsSrc.indexOf('// ── Membership tab'));
    ok(init.indexOf('id="statsEmpty"') < init.indexOf('id="exploreSyncSection"') && init.indexOf('id="exploreSyncSection"') < init.indexOf('_statsPagesHtml('),
      'panel order: the hero, the global sync banner, then the switcher and its pages');
    ok(/_wireStatsPages\(statsPanel\);/.test(init), 'initTabs wires the keys and the section watcher once');
    // Signed out, the rule in css/tabs.css that leaves only the hero reaches the direct children of #tab-stats
    // (data-owner.js holds the rule itself): the switcher and the pages must be direct children.
    ok(/<div class="stats-switcher-bar">/.test(tabsSrc) && /'<div id="' \+ p\.panel \+ '" class="stats-page"/.test(tabsSrc), '…which they are: neither is nested in another wrapper');
  }
  {
    // explore.js: the real gate, sliced out of renderExplore.
    const from = exSrc.indexOf('    var closed = function (el) {'), to = exSrc.indexOf('    // Loading state if data not ready');
    ok(from !== -1 && to > from, 'explore.js: the closed-page gate can be sliced (anchor moved?)');
    ok(exSrc.indexOf('renderSyncBanner(syncSection);') < from && exSrc.indexOf('renderSyncBanner(syncSection);') > exSrc.indexOf('window.renderExplore = function () {'),
      'the banner is drawn BEFORE the gate: it is global, whichever page is open');
    const run = (hiddenFlags) => {
      const page = (hidden) => ({ closest: (sel) => (sel === '.stats-page' && hidden !== null ? { hidden } : null) });
      const ctx = t.vm.createContext({ _exploreDirty: false, newSection: page(hiddenFlags[0]), likeSection: page(hiddenFlags[1]), mapSection: page(hiddenFlags[2]), built: false });
      t.vm.runInContext('(function () {' + exSrc.slice(from, to) + '\n built = true; })();', ctx, { filename: 'js/explore.js[gate]' });
      return [ctx.built, ctx._exploreDirty];
    };
    eq(run([true, true, true]), [false, true], 'all three on a closed page: not built — and left dirty, so opening the page builds them');
    eq(run([false, false, false]), [true, false], 'their page is open: built as ever');
    eq(run([true, true, false]), [true, false], 'any one of them on the open page (should a section ever move): the single pass still runs');
    eq(run([null, null, null]), [true, false], 'no .stats-page round them (an older shell, a test page): built as ever');
  }

  // ── 4. CSS ───────────────────────────────────────────────────────────────
  t.section('Stats switcher CSS: tokens only, pinned, fingertip-tall');
  const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
  const mark = tabsCss.indexOf('Stats sub-pages (wave 8c)');
  ok(mark !== -1 && mark > tabsCss.indexOf('iOS app-shell (mobile)'), 'one marked block at the END of css/tabs.css');
  const block = noComments(tabsCss.slice(tabsCss.lastIndexOf('/*', mark)));
  const rule = (selector) => {
    const at = block.indexOf('\n' + selector + ' {');
    return at === -1 ? '' : block.slice(block.indexOf('{', at) + 1, block.indexOf('}', at));
  };
  ok(/position:\s*sticky;/.test(rule('.stats-switcher-bar')) && /top:\s*0;/.test(rule('.stats-switcher-bar')) && /background:\s*var\(--bg\);/.test(rule('.stats-switcher-bar')),
    'the bar is sticky at the top of the scroller, on the solid page background (sections must not show through)');
  {
    const z = Number((/z-index:\s*(\d+)/.exec(rule('.stats-switcher-bar')) || [])[1]);
    ok(z >= 1 && z < 50, 'above the sections, below the tab bar (50 / 90) and every overlay (z-index ' + z + ')');
  }
  ok(/min-height:\s*var\(--tap-min\);/.test(rule('.stats-switcher')), 'the switcher is at least --tap-min tall');
  ok(/inset:\s*calc\(-2px - var\(--space-1\)\) calc\(-1px - var\(--space-1\) \/ 2\);/.test(rule('.stats-switcher-tab::before')) && /position:\s*relative;/.test(rule('.stats-switcher-tab')) &&
    /padding:\s*var\(--space-1\);/.test(rule('.stats-switcher')) && /gap:\s*var\(--space-1\);/.test(rule('.stats-switcher')),
    '…and each segment\'s hit area is stretched over the full height of the track (the thumb itself is inset)');
  ok(/flex:\s*1 1 0;/.test(rule('.stats-switcher-tab')) && /min-width:\s*0;/.test(rule('.stats-switcher-tab')), 'three EQUAL segments that can shrink: no horizontal scroll at 375px');
  ok(/\.stats-switcher-bar\[hidden\],\s*\.stats-page\[hidden\],\s*\.stats-page-empty\[hidden\] \{ display: none; \}/.test(block), '[hidden] is spelled out (any display rule would beat the attribute)');
  ok(/outline:\s*2px solid var\(--accent\);/.test(rule('.stats-switcher-tab:focus-visible')), 'the house focus ring, keyboard only');
  {
    const sel = rule('.stats-switcher-tab[aria-selected="true"]');
    ok(/background:\s*var\(--bg-panel\);/.test(sel) && /font-weight:\s*var\(--weight-bold\);/.test(sel) && /border-color:\s*var\(--border-light\);/.test(sel),
      'selected is styled off aria-selected itself — fill, weight and an outline, not colour alone (Handheld has no shadow)');
  }
  eq(block.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) || [], [], 'no colour literal in the block');
  eq((block.match(/(?:font-size|border-radius|box-shadow|font-family|font-weight|transition):\s*[^;]+;/g) || []).filter((d) => !/var\(--/.test(d)), [],
    'type, radii, shadows and transitions all come from tokens');
  {
    const rootAt = themeCss.indexOf(':root {');
    const root = themeCss.slice(rootAt, themeCss.indexOf('\n}', rootAt));
    const used = Array.from(new Set(block.match(/var\(--[a-z0-9-]+/g) || [])).map((v) => v.slice(4)).filter((v) => v !== '--stats-pin-top');
    eq(used.filter((v) => root.indexOf('\n  ' + v + ':') === -1), [], 'every token it names is defined in :root (' + used.length + ' tokens)');
  }
  ok(!/prefers-reduced-motion:\s*reduce/.test(block) && /@media \(prefers-reduced-motion: no-preference\) \{\s*\.stats-switcher-tab \{\s*transition:/.test(block),
    'its one transition is opt-IN (no-preference): nothing to switch off — and tests/suites/2e-css-layout.js reads the LAST "reduce" block of this file');
  ok(/@media \(min-width: 641px\) \{\s*\.tab-content:has\(> #tab-stats\.active\) \{ overflow: clip; \}\s*\.stats-switcher-bar \{ top: var\(--stats-pin-top, 0px\); \}/.test(block),
    'wider than a phone: .tab-content stops being the (never-scrolling) scroll container while Stats is up, and the bar pins under the tab bar');
  ok(/@media \(max-width: 640px\) \{\s*\.stats-switcher-bar \{ padding: var\(--space-3\) var\(--space-7\); \}/.test(block), 'on a phone the bar sits at the sections\' 16px inset');
  ok(/\.stats-page > \.stats-bar \{ padding-left: var\(--space-7\); padding-right: var\(--space-7\); \}/.test(block) && !/id="shareSection"[^>]*style=/.test(tabsSrc),
    '…and so do the two sections that kept a 24px one right under it: the tiles, and "Share my stats" (its inline padding is gone)');

  t.section('Stats switcher: readable in every theme');
  {
    const lum = (hex) => {
      let h = String(hex).trim().replace('#', '');
      if (h.length === 3) h = h.split('').map((c) => c + c).join('');
      const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((s) => (s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    const tokensOf = (selector) => {
      const start = themeCss.indexOf(selector + ' {');
      const out = {};
      noComments(themeCss.slice(themeCss.indexOf('{', start) + 1, themeCss.indexOf('}', start))).replace(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g, (m, k, v) => { out[k] = v.trim(); return m; });
      return out;
    };
    const ids = [];
    t.readSource('js/theme.js').replace(/\{\s*id:\s*'([a-z]+)'/g, (m, id) => { ids.push(id); return m; });
    ok(ids.length >= 5, 'theme ids parsed from APP_THEMES (' + ids.join(', ') + ')');
    ids.forEach((id) => {
      const tk = Object.assign({}, tokensOf(':root'), tokensOf('[data-theme="' + id + '"]'));
      const rest = contrast(tk['--text-muted'], tk['--bg-deep']), on = contrast(tk['--text-heading'], tk['--bg-panel']);
      ok(rest >= 4.5, id + ': an unselected label (--text-muted on the --bg-deep track) is ' + rest.toFixed(2) + ':1 (≥4.5)');
      ok(on >= 4.5, id + ': the selected label (--text-heading on the --bg-panel thumb) is ' + on.toFixed(2) + ':1 (≥4.5)');
      ok(lum(tk['--bg-panel']) > lum(tk['--bg-deep']), id + ': the thumb is lighter than the track it sits in');
      ok(contrast(tk['--text-muted'], tk['--bg']) >= 4.5, id + ': the quiet line (--text-muted on --bg) is readable');
    });
  }
};
