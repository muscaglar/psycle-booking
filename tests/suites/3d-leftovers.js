'use strict';
// Wave-3 leftovers, each seen in a browser first:
//   1. the 24h reference-data cache was bypassed on most warm launches (init
//      asked before performance.js / reliability.js had wrapped apiFetch),
//   2. the cost tracker's forecast asked for more classes than its own cards
//      say are left,
//   3. My Bookings' past/started tests read the London wall clock device-locally,
//   4. bookClass learned fresh availability and the list forgot it,
//   5. bookClass offered the count-body confirm for a seat-map studio whose
//      cached record had lost its layout,
//   6. the gap between Refresh and Clear filters belonged to Clear filters,
//   7. the travel notice was left outside the tab panels when it beat tabs.js.
// The runner's zone is New York; east-of-London cases are argued with explicit
// instants (a resolver that reads the wall clock as Dubai's).
module.exports = async function (t) {
  const { ok, eq } = t;
  const appSrc = t.readSource('js/app.js');
  const tabsSrc = t.readSource('js/tabs.js');
  const perfSrc = t.readSource('js/performance.js');
  const grab = (source, opener, closer) => {
    const lines = source.split('\n');
    const from = lines.findIndex((l) => l.startsWith(opener));
    const to = lines.findIndex((l, i) => i > from && l === (closer || '}'));
    if (from === -1 || to === -1) throw new Error('3d-leftovers suite: cannot slice "' + opener + '" (anchor moved?)');
    return lines.slice(from, to + 1).join('\n');
  };
  const pureRegion = (source, name) => {
    const s = source.indexOf('// ── pure:' + name + ':start'), e = source.indexOf('// ── pure:' + name + ':end');
    if (s === -1 || e === -1) throw new Error('3d-leftovers suite: pure:' + name + ' markers moved');
    return source.slice(s, e);
  };
  const settle = () => new Promise((r) => setImmediate(r)); // every pending microtask has run

  // ── 1. Reference data ────────────────────────────────────────────────────
  t.section('Reference data: what the cache patch decides (js/performance.js)');
  const H = 60 * 60 * 1000;
  {
    const NOW = Date.UTC(2026, 8, 18, 9, 0);
    const p = t.loadPure('js/performance.js', 'static-cache');
    const entry = (ageMs, list) => ({ data: { data: list === undefined ? [{ id: 1 }] : list }, timestamp: NOW - ageMs });
    const d = (c) => p._staticCacheDecision(c, 24 * H, NOW);
    eq([d(entry(0)), d(entry(H)), d(entry(24 * H - 1))], ['cache', 'cache', 'cache'], 'a non-empty list younger than 24h is the whole answer — no request');
    eq([d(entry(24 * H)), d(entry(25 * H)), d(entry(90 * 24 * H))], ['revalidate', 'revalidate', 'revalidate'], 'older: served at once, refreshed behind the caller');
    eq([d(entry(-1)), d(entry(-H)), d(entry(-400 * 24 * H))], ['revalidate', 'revalidate', 'revalidate'],
      'stamped "in the future" (the clock has moved back since): still served, but refreshed — a back-dated clock pins nothing');
    eq([d({ data: { data: [{ id: 1 }] } }), d({ data: { data: [{ id: 1 }] }, timestamp: 'yesterday' })], ['revalidate', 'revalidate'], 'an age that cannot be read is not trusted either');
    eq([d(null), d({}), d({ data: {} }), d(entry(H, [])), d(entry(H, { nope: 1 })), d(entry(H, null))],
      ['network', 'network', 'network', 'network', 'network', 'network'], 'nothing servable (missing, empty or poisoned): the network answers and repairs the entry');
  }

  t.section('Reference data: init asks only once the later modules have wrapped apiFetch (js/app.js)');
  {
    const gate = t.loadPure('js/app.js', 'init-gate');
    const fakeTarget = () => {
      const l = {};
      return { l, addEventListener: (e, fn) => { (l[e] = l[e] || []).push(fn); }, fire: (e) => (l[e] || []).forEach((fn) => fn()) };
    };
    const pending = async (promise) => { let done = false; promise.then(() => { done = true; }); await settle(); return !done; };
    let doc = Object.assign(fakeTarget(), { readyState: 'interactive' }), win = fakeTarget();
    let p = gate._laterModulesLoaded(doc, win);
    ok(await pending(p), 'deferred scripts still running (readyState "interactive"): init waits');
    doc.fire('DOMContentLoaded');
    ok(!(await pending(p)), '…until DOMContentLoaded — every deferred module has run by then');
    doc = Object.assign(fakeTarget(), { readyState: 'loading' }); win = fakeTarget();
    p = gate._laterModulesLoaded(doc, win);
    win.fire('load');
    ok(!(await pending(p)), "'load' backs it up (a copy injected after DOMContentLoaded has fired)");
    doc = Object.assign(fakeTarget(), { readyState: 'complete' }); win = fakeTarget();
    ok(!(await pending(gate._laterModulesLoaded(doc, win))) && !doc.l.DOMContentLoaded, 'a finished document never waits');

    // From the gate to the three requests: the SHIPPED lines.
    const initFrom = appSrc.indexOf('// ── pure:init-gate:start');
    const initTo = appSrc.indexOf('  instructors = iRes.data.filter', initFrom);
    ok(initFrom !== -1 && initTo > initFrom, 'the head of the init IIFE can be sliced');
    const initHead = appSrc.slice(initFrom, initTo);
    const armed = initHead.indexOf('const _modulesLoaded = _laterModulesLoaded(document, window);');
    ok(armed !== -1 && armed < initHead.indexOf('(async () => {'), 'the wait is armed while app.js runs (DOMContentLoaded cannot have fired yet), not after securityReady');
    ok(initHead.indexOf('await _modulesLoaded;') > initHead.indexOf('await (window.securityReady || Promise.resolve());') &&
      initHead.indexOf('await _modulesLoaded;') < initHead.indexOf('const fetchJson = path => apiFetch(path)'),
      '…and awaited between securityReady and the first apiFetch');

    // The SHIPPED init head and the SHIPPED cache patch, in script order:
    // app.js (bare apiFetch) → microtasks → "reliability.js" → performance.js → DOMContentLoaded.
    const patchFrom = perfSrc.indexOf("const CACHE_PREFIX = 'psycle_cache_';");
    const patchTo = perfSrc.lastIndexOf('/**', perfSrc.indexOf(' * Eager cache pre-population'));
    ok(patchFrom !== -1 && patchTo > patchFrom, 'the cache patch can be sliced');
    const launch = async (o) => {
      const log = [];
      const store = t.makeFakeLocalStorage();
      if (o.cacheAgeMs != null) {
        ['instructors', 'locations', 'event-types'].forEach((k) => store.setItem('psycle_cache_' + k, JSON.stringify({ data: { data: [{ id: 'cached' }] }, timestamp: Date.now() - o.cacheAgeMs })));
      }
      const document = Object.assign(fakeTarget(), { readyState: 'interactive' }); // deferred scripts are running
      let tokenReady = null;
      const ctx = t.vm.createContext({
        console: { warn() {}, log() {} }, localStorage: store, document,
        addEventListener: () => {}, // 'load' never fires in here: init must not need it
        // Web: IndexedDB answered while the scripts were arriving. iOS: it
        // waits for the native bridge, the last script — after DOMContentLoaded.
        securityReady: o.slowSecurity ? new Promise((r) => { tokenReady = r; }) : Promise.resolve(),
        showInitError: () => log.push('init-error'),
        __log: log,
        __res: (payload) => ({ ok: true, status: 200, json: async () => payload, clone() { return this; } }),
        __initDone: (lists) => log.push('init got ' + lists.map((l) => l.data[0].id).join(',')),
      });
      ctx.window = ctx; // window.apiFetch = … rebinds the bare `apiFetch` init calls, as in a browser
      t.vm.runInContext("function apiFetch(path) { __log.push('bare ' + path); return Promise.resolve(__res({ data: [{ id: 'net' }] })); }\n" +
        initHead + '\n  __initDone([iRes, lRes, tRes]);\n})();', ctx, { filename: 'js/app.js[init head]' });
      await settle(); // the microtask checkpoint after app.js — where init used to carry on
      const beforeModules = log.slice();
      t.vm.runInContext("window.apiFetch = function apiFetchWithRetry(path) { __log.push('retrying ' + path); return Promise.resolve(__res({ data: [{ id: 'net' }] })); };", ctx, { filename: 'reliability.js[stub]' });
      t.vm.runInContext(perfSrc.slice(patchFrom, patchTo), ctx, { filename: 'js/performance.js[cache patch]' });
      document.fire('DOMContentLoaded');
      await settle();
      const beforeToken = log.slice();
      if (tokenReady) { tokenReady(); await settle(); }
      return { beforeModules, beforeToken, log, store };
    };
    let w = await launch({ cacheAgeMs: H });
    eq(w.beforeModules, [], 'warm launch: nothing is asked before reliability.js / performance.js have run (all three used to leave bare right here)');
    eq(w.log, ['init got cached,cached,cached'], 'warm launch inside the TTL: NO network call — the cached lists are the answer');
    w = await launch({ cacheAgeMs: 25 * H });
    eq(w.log.slice().sort(), ['init got cached,cached,cached', 'retrying /event-types', 'retrying /instructors', 'retrying /locations'],
      'past the TTL: the old copy answers and the refresh goes THROUGH the retrying wrapper — never the bare apiFetch');
    ok(['instructors', 'locations', 'event-types'].every((k) => JSON.parse(w.store.getItem('psycle_cache_' + k)).data.data[0].id === 'net'), '…and lands in the cache for the next launch');
    w = await launch({ cacheAgeMs: null });
    eq([w.beforeModules, w.log.filter((l) => /^bare/.test(l)), w.log[w.log.length - 1]], [[], [], 'init got net,net,net'], 'cold launch: the three requests go through the wrappers too');
    w = await launch({ cacheAgeMs: null, slowSecurity: true });
    eq([w.beforeToken, w.log.filter((l) => /^bare/.test(l)), w.log[w.log.length - 1]], [[], [], 'init got net,net,net'],
      "iOS order (securityReady settles AFTER DOMContentLoaded): init still goes — the wait was armed before the event, so it never sits waiting for 'load'");
    w = await launch({ cacheAgeMs: -H });
    eq(w.log.filter((l) => /^retrying/.test(l)).length, 3, 'an entry stamped in the future is refreshed (its new stamp is "now")');
    ok(JSON.parse(w.store.getItem('psycle_cache_locations')).timestamp <= Date.now(), '…so a back-dated clock cannot pin it');

    // Pre-population reads the same entries: a poisoned one is skipped, not thrown on.
    const preFrom = perfSrc.indexOf('(function eagerCachePrePopulate() {');
    ok(preFrom !== -1, 'the eager pre-population can be sliced');
    const store = t.makeFakeLocalStorage();
    store.setItem('psycle_cache_instructors', JSON.stringify({ data: { data: { nope: 1 } }, timestamp: Date.now() }));
    store.setItem('psycle_cache_locations', JSON.stringify({ data: { data: [{ id: 3, is_visible: true, handle: 'bank' }] }, timestamp: Date.now() }));
    const pre = t.loadPure('js/performance.js', 'static-cache', { localStorage: store, instructors: [], locations: [], eventTypes: [], renderLocationChips() {} });
    let threw = null;
    try { t.vm.runInContext("const CACHE_PREFIX = 'psycle_cache_';\n" + perfSrc.slice(preFrom), pre, { filename: 'js/performance.js[pre-populate]' }); } catch (e) { threw = e; }
    eq([threw, pre.instructors.length, pre.locations.map((l) => l.id)], [null, 0, [3]], 'a poisoned cached list no longer throws in the pre-population (and the good one still fills)');
  }

  // ── 2. Cost tracker forecast ─────────────────────────────────────────────
  t.section('Cost tracker: the forecast never asks for more than the cards say is left (js/tabs.js)');
  {
    const gbp = (n) => '£' + n.toFixed(2);
    const f = t.loadPure('js/tabs.js', 'cost-forecast', { _formatGbp: gbp });
    eq([f._bookableMore(10, 12, 20), f._bookableMore(10, 12, 0), f._bookableMore(2, 12, 1), f._bookableMore(12, 12, 9), f._bookableMore(14, 12, 9)], [2, 2, 4, 0, 0],
      'bookable = what the plan still holds, and two a day for the days left (today included)');
    eq([f._bookableMore(5, 0, 2), f._bookableMore(5, 0, 0), f._bookableMore(5, 0, NaN), f._bookableMore(5, 0, -3)], [6, 2, 2, 2], 'unlimited plan: the days left alone — never Infinity');

    // £140, capped at 12, 10 made, 2 days left: projected 11 → £12.73.
    const capped = f._forecastVerdict(10, 12, 140, 140 / 12, 11, 140 / 11, 2);
    eq(capped, "On pace for £12.73/class — this plan's best is £11.67/class", 'a plan that tops out above £10: said plainly (it read "Book 2 more to beat £10.00/class")');
    eq(f._forecastVerdict(10, 20, 140, 7, 12, 140 / 12, 10), 'Book 4 more to beat £10.00/class', 'reachable inside the plan and the days: the advice stands');
    eq(f._forecastVerdict(10, 20, 140, 7, 10, 14, 0), 'On pace for £14.00/class — too few days left to beat £10.00/class', 'four more on the last day is not advice');
    eq(f._forecastVerdict(10, 20, 140, 7, 11, 140 / 11, 1), 'Book 4 more to beat £10.00/class', '…four in two days (today + 1) still is');
    eq(f._forecastVerdict(3, 0, 140, 0, 6, 140 / 6, 20), 'Book 11 more to beat £10.00/class', 'unlimited plan: no cap to clamp to');
    eq(f._forecastVerdict(3, 0, 140, 0, 4, 35, 2), 'On pace for £35.00/class — too few days left to beat £10.00/class', '…but the days still count');
    eq(f._forecastVerdict(11, 12, 140, 140 / 12, 12, 140 / 12, 3), 'On pace to use all 12 classes — top value at £11.67/class', 'on pace for the whole plan: unchanged');
    eq(f._forecastVerdict(15, 0, 140, 0, 16, 8.75, 3), 'On pace for £8.75/class — great value', 'already under the target: unchanged');

    let bad = [];
    [0, 8, 12, 30].forEach((max) => [1, 2, 5, 10, 11, 13].forEach((made) => [45, 99, 140, 239].forEach((price) => [0, 1, 2, 6, 27].forEach((daysLeft) => {
      const projected = Math.max(made, max > 0 ? Math.min(made + 1, max) : made + 1);
      const v = f._forecastVerdict(made, max, price, max > 0 ? price / max : 0, projected, price / projected, daysLeft);
      const m = /^Book (\d+) more/.exec(v);
      const n = m ? Number(m[1]) : 0;
      if (/Infinity|NaN|undefined/.test(v)) bad.push('garbage: ' + v);
      if (m && max > 0 && n > max - made) bad.push('more than the plan holds: ' + [max, made, price, daysLeft, v].join(' | '));
      if (m && n > (daysLeft + 1) * 2) bad.push('more than fits: ' + [max, made, price, daysLeft, v].join(' | '));
      if (m && price / (made + n) > 10) bad.push('would not beat the target: ' + [max, made, price, daysLeft, v].join(' | '));
    }))));
    eq(bad, [], 'swept over plans / usage / prices / days: every "Book N more" fits the plan and the days, and really beats £10 — no Infinity / NaN');

    // The REAL renderCostTracker + _forecastHtml around it.
    const stamp = (d) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-') +
      ' ' + [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
    const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return stamp(d); };
    const tracker = (sub) => {
      const el = { style: {}, innerHTML: '' };
      const ctx = t.loadPure('js/tabs.js', 'cost-forecast', {
        document: { getElementById: (id) => (id === 'costSection' ? el : null) },
        escapeHTML: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
        _activeSubscription: sub,
      });
      t.vm.runInContext([grab(tabsSrc, '  function renderCostTracker() {', '  }'), grab(tabsSrc, '  function _forecastHtml(', '  }'),
        grab(tabsSrc, '  function _formatGbp(', '  }'), grab(tabsSrc, '  function _daysLeftInBillingPeriod(', '  }')].join('\n'), ctx, { filename: 'js/tabs.js[cost tracker]' });
      ctx.renderCostTracker();
      return el;
    };
    const plan = (o) => Object.assign({ name: 'Plan', price: 14000, period_start: daysFromNow(-28), period_end: daysFromNow(2) }, o);
    const asks = (html) => (html.match(/Book (\d+) more/g) || []).map((s) => Number(s.replace(/\D/g, '')));
    let el = tracker(plan({ max_bookings: 12, bookings_made: 10 }));
    ok(/Left this period/.test(el.innerHTML) && /2 days to go/.test(el.innerHTML), 'capped 12, 10 made, 2 days left: the pace card says 2 left');
    eq(asks(el.innerHTML), [2], '…and the only "Book N more" on the tab is the 2 that are left (to hit £11.67)');
    ok(/this plan&#39;s best is £11\.67\/class|this plan's best is £11\.67\/class/.test(el.innerHTML) && !/to beat/.test(el.innerHTML), '…the forecast agrees: no "to beat £10.00/class" on a plan whose best is £11.67');
    el = tracker(plan({ max_bookings: 12, bookings_made: 2, period_start: daysFromNow(-29), period_end: daysFromNow(1) }));
    eq(asks(el.innerHTML), [], '10 left with a day to go: no "Book 10 more" anywhere — the pace card says what is left');
    ok(/1 day left</.test(el.innerHTML), '"1 day left", not "1 days left"');
    el = tracker(plan({ max_bookings: 0, bookings_made: 5 }));
    ok(el.style.display === '' && !/Infinity|NaN/.test(el.innerHTML) && /too few days left/.test(el.innerHTML), 'unlimited plan: no Infinity / NaN, and the days still bound the advice');
    eq([tracker(plan({ price: 0, max_bookings: 12, bookings_made: 3 })).style.display, tracker(plan({ price: 'abc', max_bookings: 12, bookings_made: 3 })).style.display,
      tracker(plan({ price: undefined, max_bookings: 12, bookings_made: 3 })).style.display], ['none', 'none', 'none'], 'no usable price: the tracker hides (a non-numeric one read "£NaN")');
  }

  // ── 3. Past / started ────────────────────────────────────────────────────
  t.section('My Bookings: "has it started?" is asked of the gym clock, not the device (js/app.js)');
  const gym = t.loadPure('js/app.js', 'gym-time');
  {
    const st = t.loadPure('js/app.js', 'bookings-started');
    const START = '2026-09-18 18:00:00'; // London, BST → 17:00Z
    const at = (iso, startMsOf) => st._classHasStarted(START, Date.parse(iso), startMsOf || gym._gymClassStartMs);
    eq([at('2026-09-18T15:00:00Z'), at('2026-09-18T16:59:59Z'), at('2026-09-18T17:00:00Z'), at('2026-09-18T19:00:00Z')], [false, false, true, true],
      'an 18:00 London class starts at 17:00Z — wherever the device is');
    // What the old test did on a phone in Dubai (UTC+4): "18:00" read as 18:00 there = 14:00Z.
    const asDubai = (s) => Date.parse(String(s).replace(' ', 'T') + '+04:00');
    eq([at('2026-09-18T15:00:00Z', asDubai), at('2026-09-18T15:00:00Z')], [true, false],
      'east of London, two hours before class: the device reading files it as past (it left My Bookings); the gym reading keeps it');
    // …and in the runner's own zone (New York) the same mistake ran the other way.
    const asDevice = (s) => new Date(String(s).replace(' ', 'T')).getTime();
    eq([at('2026-09-18T17:30:00Z', asDevice), at('2026-09-18T17:30:00Z')], [false, true], 'west of London a class already running stayed "upcoming" (Cancel offered) for hours');
    eq(st._classHasStarted('2026-01-15 07:00:00', Date.UTC(2026, 0, 15, 6, 59), gym._gymClassStartMs), false, 'winter: 07:00 London is 07:00Z');
    eq([st._classHasStarted('soon', Date.now(), gym._gymClassStartMs), st._classHasStarted(null, Date.now(), gym._gymClassStartMs)], [false, false],
      'a time nothing can place has not started — a held class never leaves the list on a parsing accident');

    const rmb = grab(appSrc, 'function renderMyBookings(');
    ok(/const started = evt => _classHasStarted\(evt\.start_at, now\.getTime\(\), _gymClassStartMs\);/.test(rmb), 'renderMyBookings builds its test on the gym resolver');
    ok(/upcoming = all\.filter\(\(\{ evt \}\) => !started\(evt\)\)/.test(rmb) && /past = all\.filter\(\(\{ evt, booking \}\) => started\(evt\) && !booking\.waitlisted\)/.test(rmb) &&
      /const eventPast = started\(evt\);/.test(rmb), 'upcoming, past and each card\'s "Attended" state all use it');
    ok(!/new Date\(evt\.start_at\) (>|<=) now/.test(rmb) && !/eventPast = dt <= now/.test(rmb), 'no device-local start test is left in renderMyBookings');

    // The REAL renderMyBookings, at a fixed instant.
    const world = (nowIso, showPast) => {
      const fixed = Date.parse(nowIso);
      const FakeDate = class extends Date { constructor(...a) { if (a.length) super(...a); else super(fixed); } static now() { return fixed; } };
      const els = {};
      const el = (id) => els[id] || (els[id] = { style: {}, textContent: '', innerHTML: '' });
      const ctx = t.vm.createContext({
        Date: FakeDate, console, Intl,
        document: { getElementById: el },
        localStorage: { getItem: () => null },
        currentUser: { id: 7 }, _activeSubscription: null,
        _myBookings: { 77: { bookingId: 'A', bookingIds: ['A'], slots: [7], slotBookings: { 7: 'A' }, waitlisted: false } },
        _eventCache: { 77: { id: 77, start_at: START, duration: 45, studio_id: 4, _typeName: 'Ride 45', _instrName: 'Alex', _locName: 'Bank', _studioName: 'Studio 1' } },
        escapeHTML: (s) => String(s), escapeForJsString: (s) => String(s), instrLink: (n) => String(n || ''),
        slotLabelForEvent: () => 'Bike', getCountdownText: () => null, _cancelDeadline: () => null,
        _waitlistOfferPending: () => false, _waitlistTimeMs: () => NaN,
        renderCalendarActions: () => '', authGateHTML: () => '', showBookingSkeleton() {},
      });
      ctx.window = ctx;
      t.vm.runInContext("var _bookingsLoadState = 'loaded', _waitlistsUnavailable = false, _showPastBookings = " + (showPast ? 'true' : 'false') + ';\n' +
        grab(appSrc, 'function localDateStr(') + '\n' + grab(appSrc, 'function parsePsycleDate(') + '\n' +
        // pure:bookings-crisp: the card's own decisions (day label, which actions sit behind "More").
        pureRegion(appSrc, 'gym-time') + '\n' + pureRegion(appSrc, 'bookings-started') + '\n' + pureRegion(appSrc, 'bookings-crisp') + '\n' + rmb, ctx, { filename: 'js/app.js[renderMyBookings]' });
      ctx.renderMyBookings();
      return { count: el('upcomingCount').textContent, html: el('upcomingList').innerHTML };
    };
    let v = world('2026-09-18T16:00:00Z');
    ok(v.count === '1' && /my-booking-card/.test(v.html) && !/Attended/.test(v.html) && !/past class/.test(v.html), 'an hour before the real start: on the list, counted, not "Attended"');
    v = world('2026-09-18T17:30:00Z');
    ok(v.count === '0' && !/my-booking-card/.test(v.html) && /Show 1 past class/.test(v.html), '30 minutes in: filed under past (device-locally in New York it stayed "upcoming" until 22:00Z)');
    v = world('2026-09-18T17:30:00Z', true);
    ok(/Attended/.test(v.html), '…and shown as Attended when past classes are asked for');

    // A device ahead of London is on the next calendar day while tonight's
    // class is still to come: the day group must not be dimmed as past.
    ok(/const isPast = date < now && day !== localDateStr\(now\) && dayItems\.every\(\(\{ evt \}\) => started\(evt\)\);/.test(rmb), 'a day group is only "past" when every class in it has started');
  }

  // The list moved to the gym clock; the three surfaces beside it had not.
  t.section('Tab badge, Stats "Upcoming" and the next-class pill agree with the My Bookings list');
  {
    const settingsSrc = t.readSource('js/settings.js');
    // Functions inside the modules' IIFEs open at two spaces and close with "  }".
    const inner = (source, opener) => {
      const lines = source.split('\n');
      const from = lines.findIndex((l) => l.startsWith(opener));
      const to = lines.findIndex((l, i) => i > from && l === '  }');
      if (from === -1 || to === -1) throw new Error('3d-leftovers suite: cannot slice "' + opener + '" (anchor moved?)');
      return lines.slice(from, to + 1).join('\n');
    };
    const START = '2026-09-18 18:00:00'; // London, BST → 17:00Z
    // `resolver`: what _gymClassStartMs is in this world — the real one, a
    // phone in Dubai reading the wall clock as its own (what `new Date()` did
    // there), or absent (tabs.js / settings.js without app.js).
    const surfaces = (nowIso, resolver, startAt) => {
      const fixed = Date.parse(nowIso);
      const FakeDate = class extends Date { constructor(...a) { if (a.length) super(...a); else super(fixed); } static now() { return fixed; } };
      const els = { tabBadge: { textContent: '?' }, statsBar: { style: {}, innerHTML: '' } };
      const pill = { innerHTML: '', hidden: false, classList: { add() { pill.hidden = true; }, remove() { pill.hidden = false; }, contains: (c) => c === 'hidden' && pill.hidden } };
      const ctx = t.vm.createContext({
        Date: FakeDate, console, Intl, Object, Math, isNaN,
        document: { getElementById: (id) => els[id] || null },
        _myBookings: { 77: { bookingId: 'A', slots: [7], waitlisted: false }, 78: { bookingId: null, slots: [], waitlisted: true } },
        _eventCache: { 77: { id: 77, start_at: startAt || START, _typeName: 'Ride 45', _locName: 'Bank' }, 78: { id: 78, start_at: '2026-09-19 07:00:00' } },
        getFullHistory: () => [], escapeHTML: (x) => String(x), formatSlots: (l, n) => l + ' ' + n.join(' & '),
        _pillEl: pill, _pillA11y: (label) => { pill.label = label; },
      });
      // renderQuickStats words its counts with app.js's _plural (pure:copy) — the real one.
      // …and counts classes TAKEN with tabs.js's own filter (pure:year-review + its clock).
      let src = pureRegion(appSrc, 'copy') + '\n' + pureRegion(tabsSrc, 'year-review') + '\n' + inner(tabsSrc, '  function _historyStartMs(') + '\n' +
        inner(tabsSrc, '  function _stillToCome(') + '\n' + inner(tabsSrc, '  function updateTabBadge(') + '\n' + inner(tabsSrc, '  function renderQuickStats(') + '\n' + inner(settingsSrc, '  function updatePill(');
      if (resolver !== null) {
        src = pureRegion(appSrc, 'gym-time') + '\n' + pureRegion(appSrc, 'bookings-started') + '\n' + src;
        if (resolver) src += '\n_gymClassStartMs = ' + resolver + ';';
      }
      t.vm.runInContext(src, ctx, { filename: 'js/tabs.js+settings.js[upcoming]' });
      ctx.updateTabBadge(); ctx.renderQuickStats(); ctx.updatePill();
      const stat = /<div class="stat-value">(\d+)<\/div><div class="stat-label">Upcoming/.exec(els.statsBar.innerHTML);
      return { badge: String(els.tabBadge.textContent), upcoming: stat ? stat[1] : null, pill: pill.hidden ? null : (/ncp-countdown">([^<]*)</.exec(pill.innerHTML) || [])[1], label: pill.label };
    };

    // 15:00Z = 16:00 in London, two hours before class: the list says "In 2h".
    let v = surfaces('2026-09-18T15:00:00Z', '');
    eq([v.badge, v.upcoming, v.pill], ['1', '1', '2h 0m'], 'two hours before an 18:00 London class: badge 1, Stats 1, pill "2h 0m" — on a device in ANY zone (the runner is in New York, where the device reading said 7h)');
    ok(/^Next class in 2h 0m: Ride 45/.test(v.label || ''), '…and the pill says the same to a screen reader');
    // 17:30Z: the class began half an hour ago; the list has filed it under past.
    v = surfaces('2026-09-18T17:30:00Z', '');
    eq([v.badge, v.upcoming, v.pill], ['', '0', null], 'half an hour in: no badge, Stats 0, no pill (device-locally in New York all three still counted it, and the pill read "4h 30m")');
    // The old behaviour, reproduced: a phone in Dubai reads "18:00" as 18:00 there = 14:00Z.
    const asDubai = "function (s) { return Date.parse(String(s).replace(' ', 'T') + '+04:00'); }";
    v = surfaces('2026-09-18T15:00:00Z', asDubai);
    eq([v.badge, v.pill], ['', null], '(what the device-local reading did in Dubai at that same moment: blank badge and no pill, under a list of one)');
    // A waitlist place is never counted, and a time nothing can place…
    v = surfaces('2026-09-18T15:00:00Z', '', 'soon');
    eq([v.badge, v.upcoming, v.pill], ['1', '1', null], 'a time nothing can place still counts as upcoming (as in the list) — but the pill has nothing to count down to, and never prints "NaNm"');
    // tabs.js / settings.js without app.js's helpers (the launch-order harness): the old parse.
    v = surfaces('2026-09-18T15:00:00Z', null);
    eq([v.badge, v.upcoming, v.pill], ['1', '1', '7h 0m'], 'without app.js the device-local parse is the fallback, not a ReferenceError');
    ok(!/new Date\(evt\.start_at\) > now/.test(inner(tabsSrc, '  function updateTabBadge(') + inner(tabsSrc, '  function renderQuickStats(')) &&
      !/dt <= now/.test(inner(settingsSrc, '  function updatePill(')), 'no device-local "has it started?" is left in the three');
  }

  t.section("Bookings fetch: the stale-place cutoff reads the gym clock through app.js's own resolver");
  {
    const s = appSrc.indexOf('// ── waitlist:pure:start'), e = appSrc.indexOf('// ── waitlist:pure:end');
    const wl = t.vm.createContext({ window: { _psycleClassStartMs: gym._gymClassStartMs }, console });
    t.vm.runInContext(appSrc.slice(s, e), wl, { filename: 'js/app.js[waitlist:pure]' });
    const entry = { id: 5, eventId: 77, status: 'waiting', event: { start_at: '2026-09-18 18:00:00' } }; // 17:00Z
    const kept = (iso) => Object.keys(wl._mergeWaitlistsIntoBookings({}, [entry], Date.parse(iso)));
    eq([kept('2026-09-18T14:30:00Z'), kept('2026-09-18T17:59:00Z'), kept('2026-09-18T18:01:00Z')], [['77'], ['77'], []],
      'a place is dropped an hour after the REAL start — in Dubai (18:00 there = 14:00Z) the device reading dropped it at 15:00Z, two hours before class');
    ok(/_mergeWaitlistsIntoBookings\(next, waitlistEntries, Date\.now\(\)\)/.test(grab(appSrc, 'async function fetchMyBookings(')) &&
      /if \(typeof window !== 'undefined'\) window\._psycleClassStartMs = _gymClassStartMs;/.test(appSrc),
      'fetchMyBookings merges with that cutoff, and app.js always puts the resolver on window (web build included)');
  }

  // ── 4 + 5. bookClass ─────────────────────────────────────────────────────
  // Event 77 in studio 4, as tests/suites/clash.js drives it.
  const LAYOUT = { slots: [{ id: 7 }, { id: 9 }] };
  function bookWorld(o) {
    o = o || {};
    const log = { confirms: [], pickers: [], posts: [], joinConfirms: [], toasts: [], syncs: [], booked: [] };
    const win = { _windowEvents: o.windowEvents === undefined ? [{ id: 76 }, { id: 77, is_fully_booked: false, is_waitlistable: true, start_at: '2026-09-21 07:15:00' }] : o.windowEvents };
    const globals = {
      window: win,
      _myBookings: o.bookings || {},
      _eventCache: { 77: Object.assign({ id: 77, start_at: '2026-09-21 07:15:00', duration: 45, _typeName: 'Ride', _locName: 'Bank', studio_id: 4, is_fully_booked: false, is_waitlistable: true }, o.cache || {}) },
      _studioMap: 'studio' in o ? (o.studio ? { 4: o.studio } : {}) : { 4: { has_layout: true, name: 'Studio 1', layout: LAYOUT } },
      currentUser: { id: 1 },
      console: { log() {}, warn() {}, info() {}, error: console.error },
      setTimeout: () => 0, clearTimeout: () => {},
      getBearerToken: () => 'tok', openLoginPopup: () => {},
      toast: (msg, type) => log.toasts.push([msg, type]),
      confirmModal: async (opts) => { log.confirms.push(opts.title); return o.confirm === true; },
      apiFetch: async (path) => {
        if (path !== '/events/77') throw new Error('unexpected call ' + path);
        return { ok: true, status: 200, json: async () => Object.assign({ slots: o.slots || [7, 9], data: o.detail || {} }, o.envelope || {}) };
      },
      showBikePicker: (...a) => log.pickers.push(a),
      submitBooking: async (id, slots, b, opts) => { log.posts.push([slots, opts]); },
      confirmJoinWaitlist: async (...a) => { log.joinConfirms.push(a[0]); },
      leaveWaitlist: async () => {},
      slotLabelForEvent: () => 'Bike', _waitlistClassLine: () => 'Ride · Alex', _parseSlots: (x) => x,
      _clearUnverifiedBooking: async () => true,
      applyBookedState: (b, id) => log.booked.push(id),
      _syncCardButtonsForEvent: (id) => log.syncs.push(id),
    };
    const ctx = t.loadPure('js/app.js', 'clash', globals);
    t.vm.runInContext("var _bookingsLoadState = 'loaded';\n" +
      [grab(appSrc, 'function _busyLabel('), grab(appSrc, 'function _clashFor('), pureRegion(appSrc, 'book-fresh'), grab(appSrc, 'async function bookClass(')].join('\n'), ctx, { filename: 'js/app.js[bookClass]' });
    return { ctx, log, win };
  }
  const btn = () => ({ textContent: 'Book', className: 'book-btn', disabled: false, dataset: {}, style: {} });

  t.section('bookClass: what GET /events/{id} says about availability reaches the list');
  {
    let w = bookWorld({ detail: { is_fully_booked: true, is_waitlistable: true } });
    await w.ctx.bookClass(77, btn(), 4);
    eq([w.ctx._eventCache[77].is_fully_booked, w.win._windowEvents[1].is_fully_booked], [true, true], 'a class just learned to be full: written to the cache entry AND the loaded window\'s event');
    eq(Object.assign({}, w.ctx._eventCache[77], w.win._windowEvents[1]).is_fully_booked, true, '…so the next background render (window event spread over the cache) keeps it — it used to read "Book" again');
    eq([w.log.syncs, w.log.joinConfirms], [[77], [77]], '…every card of the class is re-synced, and the tap carries on to the waitlist confirm');
    eq(w.win._windowEvents[0], { id: 76 }, 'no other event in the window is touched');

    w = bookWorld({ detail: { is_fully_booked: true, is_waitlistable: false } });
    const b = btn();
    await w.ctx.bookClass(77, b, 4);
    eq([w.ctx._eventCache[77].is_waitlistable, w.win._windowEvents[1].is_waitlistable, b.textContent, w.log.syncs], [false, false, 'Full', [77]], 'full with the waitlist closed: both flags kept, "Full"');

    w = bookWorld({ detail: { is_fully_booked: false, is_waitlistable: true } });
    await w.ctx.bookClass(77, btn(), 4);
    eq([w.log.syncs, w.log.pickers.length], [[], 1], 'nothing new learned: no re-sync, straight to the picker');

    w = bookWorld({ cache: { is_fully_booked: true }, windowEvents: [{ id: 77, is_fully_booked: true, is_waitlistable: true }], detail: { is_fully_booked: false } });
    await w.ctx.bookClass(77, btn(), 4);
    eq([w.ctx._eventCache[77].is_fully_booked, w.win._windowEvents[0].is_fully_booked, w.win._windowEvents[0].is_waitlistable, w.log.syncs], [false, false, true, [77]],
      'a seat came back: learned the other way too; a flag the payload does not carry is left alone');

    w = bookWorld({ detail: {} });
    await w.ctx.bookClass(77, btn(), 4);
    eq([w.ctx._eventCache[77].is_fully_booked, w.log.syncs], [false, []], 'a payload without the flags changes nothing');
    w = bookWorld({ windowEvents: null, detail: { is_fully_booked: true } });
    await w.ctx.bookClass(77, btn(), 4);
    eq([w.ctx._eventCache[77].is_fully_booked, w.log.syncs], [true, [77]], 'no window loaded (rebook from My Bookings): the cache entry alone');
    // "Full" has a third copy: the lite facet view the chip counts read.
    w = bookWorld({ detail: { is_fully_booked: true, is_waitlistable: true } });
    w.win._facetClasses = [{ id: '76', full: false }, { id: '77', full: false }];
    await w.ctx.bookClass(77, btn(), 4);
    eq(w.win._facetClasses, [{ id: '76', full: false }, { id: '77', full: true }], 'the facet copy learns it too — under "Available only" the chip counts and the list agree about this class');

    // A seat given back: _markSeatFreed wrote the cache alone, render() tests the
    // WINDOW's event, and the class — no longer the member's own — left the list.
    const freed = t.loadPure('js/app.js', 'book-fresh', {
      _eventCache: { 77: { id: 77, is_fully_booked: true, is_waitlistable: true } },
      window: { _windowEvents: [{ id: 77, is_fully_booked: true, is_waitlistable: true }], _facetClasses: [{ id: '77', full: true }] },
    });
    t.vm.runInContext(grab(appSrc, 'function _markSeatFreed('), freed, { filename: 'js/app.js[_markSeatFreed]' });
    freed._markSeatFreed(77);
    eq([freed._eventCache[77].is_fully_booked, freed.window._windowEvents[0].is_fully_booked, freed.window._facetClasses[0].full, freed.window._windowEvents[0].is_waitlistable], [false, false, false, true],
      'a cancelled seat frees every copy: the cache, the window\'s event ("Available only" filters by it) and the facet view');
    eq(Object.assign({}, freed._eventCache[77], freed.window._windowEvents[0]).is_fully_booked, false, "…so render()'s spread no longer puts \"full\" back");

    const pure = t.loadPure('js/app.js', 'book-fresh', { _eventCache: {}, window: { _windowEvents: [{ id: 77, is_fully_booked: false }] } });
    eq([pure._noteFreshAvailability(77, { is_fully_booked: true }), pure._noteFreshAvailability(77, { is_fully_booked: true }), pure._noteFreshAvailability(77, null), pure._noteFreshAvailability(77, { is_fully_booked: 'yes' })],
      [true, false, false, false], 'reports a change once; junk is ignored');
  }

  t.section('bookClass: a seat-map studio whose cached record lost its layout');
  {
    const bare = { has_layout: true, name: 'Studio 1' };
    let w = bookWorld({ studio: Object.assign({}, bare), envelope: { relations: { studios: [{ id: 9, layout: { slots: [{ id: 1 }] } }, { id: 4, has_layout: true, layout: LAYOUT }] } } });
    await w.ctx.bookClass(77, btn(), 4);
    eq([w.log.confirms, w.log.pickers.length, w.log.pickers[0] && w.log.pickers[0][2]], [[], 1, LAYOUT], "the layout comes from the detail's own studio record: the picker opens — no \"Book this class?\"");
    eq(w.ctx._studioMap[4].layout, LAYOUT, '…and is kept on _studioMap for the next tap');

    const p = t.loadPure('js/app.js', 'book-fresh', { _eventCache: {} });
    eq([p._layoutFromEventDetail({ data: { studio: { layout: LAYOUT } } }, 4), p._layoutFromEventDetail({ data: { layout: LAYOUT } }, 4), p._layoutFromEventDetail({ layout: LAYOUT }, 4)],
      [LAYOUT, LAYOUT, LAYOUT], 'the other places an envelope could carry it are read too');
    eq([p._layoutFromEventDetail({ relations: { studios: [{ id: 9, layout: LAYOUT }] } }, 4), p._layoutFromEventDetail({ relations: { studios: [{ id: 4, layout: { slots: [] } }] } }, 4),
      p._layoutFromEventDetail({ relations: { studios: 'x' }, data: 'y' }, 4), p._layoutFromEventDetail(null, 4)], [null, null, null, null],
      "another studio's map, a map with no seats, junk: not a layout");

    w = bookWorld({ studio: Object.assign({}, bare), confirm: true });
    const b = btn();
    await w.ctx.bookClass(77, b, 4);
    eq([w.log.confirms, w.log.posts, w.log.pickers.length], [[], [], 0], 'no layout to be had: NO count-body confirm, nothing posted (Psycle would answer "Booking slot required")');
    eq(w.log.toasts, [["Couldn't load the studio map — try again", 'error']], '…the member is told');
    eq([b.disabled, b.textContent, b.dataset.busy], [false, 'Book', undefined], '…and the button is usable again');

    w = bookWorld({ studio: Object.assign({}, bare), bookings: { 77: { bookingId: 'A', slots: [7], slotBookings: { 7: 'A' }, waitlisted: false } } });
    await w.ctx.bookClass(77, btn(), 4);
    eq([w.log.booked, w.log.confirms], [[77], []], 'already holding a seat there: the button goes back to its booked state');

    w = bookWorld({ studio: Object.assign({}, bare), detail: { is_fully_booked: true, is_waitlistable: true } });
    await w.ctx.bookClass(77, btn(), 4);
    eq([w.log.joinConfirms, w.log.toasts], [[77], []], 'a FULL class needs no map: the waitlist path is untouched');

    w = bookWorld({ studio: { has_layout: false, name: 'Studio 2' }, confirm: true });
    await w.ctx.bookClass(77, btn(), 4);
    eq([w.log.confirms, w.log.posts], [['Book this class?'], [[null, { spaces: 1 }]]], 'has_layout === false: still the confirm, still the count body');
    // Was: [[null, {}]] — "Book this class?" and then a POST with no slots and no
    // count, which Psycle refuses. An unknown studio no longer reaches a confirm
    // at all (tests/suites/add-spot-studio.js has the whole story).
    w = bookWorld({ studio: null, confirm: true });
    await w.ctx.bookClass(77, btn(), 4);
    eq([w.log.confirms, w.log.posts], [[], []], 'an unknown studio never gets a guessed count — nor a confirm that could only end in "Booking slot required"');
    ok(/studio && studio\.has_layout === false \? \{ spaces: 1 \} : \{\}/.test(grab(appSrc, 'async function bookClass(')), 'the count body stays exclusive to has_layout === false');
  }

  // The third path to a booking: "Book my week". fetchDay's render() has just
  // replaced the studio record with the LIST response's (has_layout, no map).
  t.section('Book my week: the headless path takes the seat map from the detail too');
  {
    const headWorld = (o) => {
      const log = { posts: [], joins: [] };
      const globals = {
        window: {}, _myBookings: {}, console: { log() {}, warn() {}, info() {}, error: console.error },
        _eventCache: { 77: { id: 77, start_at: '2026-09-21 07:15:00', duration: 45, studio_id: 4 } },
        _studioMap: { 4: o.studio },
        document: { createElement: () => ({ textContent: '', className: '', dataset: {} }) },
        apiFetch: async () => ({ ok: true, status: 200, json: async () => Object.assign({ slots: o.slots, data: o.detail || {} }, o.envelope || {}) }),
        _usualSlotForEvent: () => o.usual,
        joinWaitlist: async (id) => { log.joins.push(id); return true; },
        submitBooking: async (id, slots, b, opts) => {
          log.posts.push([slots, opts]);
          if (slots) { b.textContent = 'Bike ' + slots[0] + ' ✓'; globals._myBookings[String(id)] = { bookingId: 'A', slots, waitlisted: false }; }
        },
      };
      const ctx = t.loadPure('js/app.js', 'clash', globals);
      t.vm.runInContext([grab(appSrc, 'function _clashFor('), pureRegion(appSrc, 'book-fresh'), grab(appSrc, 'async function _bookEventHeadless(')].join('\n'), ctx, { filename: 'js/app.js[_bookEventHeadless]' });
      return { ctx, log };
    };
    const listShaped = () => ({ has_layout: true, name: 'Studio 1' }); // what a list response's relations carry
    const withMap = { relations: { studios: [{ id: 4, has_layout: true, layout: LAYOUT }] } };

    let w = headWorld({ studio: listShaped(), slots: [7, 9], usual: 9, envelope: withMap });
    eq([await w.ctx._bookEventHeadless(77, 4), w.log.posts], ['booked', [[[9], undefined]]],
      'a seat studio whose record lost its map: the seat is picked from the detail\'s own layout (it POSTed {event_id} alone — "Booking slot required" — and counted the entry as failed)');
    eq(w.ctx._studioMap[4].layout, LAYOUT, '…and the map is kept for the next entry');

    w = headWorld({ studio: listShaped(), slots: [7, 9] });
    eq([await w.ctx._bookEventHeadless(77, 4), w.log.posts], ['failed', []], 'no map to be had anywhere: failed WITHOUT sending a slot-less body Psycle would refuse');

    w = headWorld({ studio: listShaped(), slots: [], detail: { is_waitlistable: true }, envelope: withMap });
    eq([await w.ctx._bookEventHeadless(77, 4), w.log.joins, w.log.posts], ['waitlisted', [77], []],
      'no free seat in the recovered map (Psycle has not said "full" yet): the waitlist is joined — map-less, that branch was skipped');
    w = headWorld({ studio: listShaped(), slots: [7], detail: { is_fully_booked: true, is_waitlistable: true } });
    eq([await w.ctx._bookEventHeadless(77, 4), w.log.joins], ['waitlisted', [77]], 'a FULL class needs no map: it still joins the waitlist');

    w = headWorld({ studio: { has_layout: false, name: 'Studio 2' }, slots: [] });
    await w.ctx._bookEventHeadless(77, 4);
    eq(w.log.posts, [[null, { spaces: 1 }]], 'has_layout === false: still booked by count, as before');
    w = headWorld({ studio: undefined, slots: [] });
    await w.ctx._bookEventHeadless(77, 4);
    eq(w.log.posts, [[null, {}]], 'an unknown studio is never given a guessed count (as before)');
    ok(/typeof _layoutFromEventDetail === 'function'/.test(grab(appSrc, 'async function _bookEventHeadless(')), 'the helper is typeof-guarded (booking.js and clash.js slice this function on its own)');
  }

  // ── 6. Refresh / Clear filters ───────────────────────────────────────────
  t.section('Tap targets: the gap between Refresh and Clear filters is never Clear filters\'');
  {
    const css = t.readSource('css/redesign.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const theme = t.readSource('css/theme.css');
    const token = (name) => parseFloat((theme.match(new RegExp(name + ':\\s*([\\d.]+)px')) || [])[1]);
    const inset = (selector) => {
      const m = css.match(new RegExp(selector.replace(/[.:]/g, '\\$&') + '\\s*\\{\\s*inset:\\s*([^;]+);'));
      const parts = m ? (m[1].match(/calc\([^()]*\([^()]*\)[^()]*\)|\S+/g) || []) : [];
      return { raw: parts, reach: parts.map((v) => { const k = v.match(/^calc\(var\((--[\w-]+)\) \* -1\)$/); return k ? token(k[1]) : (v === '0' ? 0 : NaN); }) };
    };
    const gap = Number((css.match(/\.disc-actions \{[^}]*?gap:\s*(\d+)px/) || [])[1]);
    const refresh = inset('.disc-actions .refresh-link::after'), clear = inset('.disc-clear-btn::after');
    ok(gap > 0 && refresh.reach.length === 4 && clear.reach.length === 4 && refresh.reach.concat(clear.reach).every((n) => n >= 0),
      'both insets parse, and every side is a spacing token or 0 (no literal px)');
    eq(clear.reach[0], 0, 'Clear filters reaches UP by nothing: only its own box (and what is below it) clears the filters');
    ok(refresh.reach[2] > gap / 2, 'Refresh reaches down past the middle of the ' + gap + 'px gap (' + refresh.reach[2] + 'px) — a near miss below Refresh is still Refresh');
    ok(refresh.reach[2] + clear.reach[0] <= gap - 1, 'the two areas never meet: ' + refresh.reach[2] + ' + ' + clear.reach[0] + ' leaves ' + (gap - refresh.reach[2] - clear.reach[0]) + 'px that is nobody\'s, against Clear filters');
    ok(refresh.reach[0] > refresh.reach[2] && clear.reach[2] > clear.reach[0], 'each still grows away from the other');
    // All of the above is counted in whole pixels, and only holds on screen if
    // the two links are whole pixels tall. At 11px/1.3 they were 14.3px: every
    // edge under them sat on .3, the row that is nobody's measured a fifth of a
    // pixel in a browser, and a probe half a pixel into it hit Clear filters.
    const lineHeight = (selector) => (css.match(new RegExp(selector.replace(/\./g, '\\.') + ' \\{[^}]*?font:\\s*\\d+ \\d+px\\/(\\S+) ')) || [])[1];
    const lh = [lineHeight('.disc-actions .last-updated'), lineHeight('.disc-clear-btn')];
    ok(/^\d+px$/.test(lh[0] || '') && lh[0] === lh[1], 'both links share one whole-px line-height (' + lh.join(' / ') + '), never a unitless ratio of an 11px font');
    ok(/\.disc-actions \.refresh-link \{[^}]*font:\s*inherit/.test(css), 'Refresh inherits it from the label it sits in (font: inherit), so its box is that tall too');
  }

  // ── 7. Travel notice ─────────────────────────────────────────────────────
  t.section('Travel notice: inside the Discover panel whichever of app.js / tabs.js gets there first');
  {
    const node = (id) => ({
      id: id || '', className: '', innerHTML: '', children: [], parentNode: null,
      insertBefore(child, ref) {
        if (child.parentNode) child.parentNode.removeChild(child);
        const i = ref ? this.children.indexOf(ref) : -1;
        this.children.splice(i === -1 ? this.children.length : i, 0, child);
        child.parentNode = this;
        return child;
      },
      appendChild(child) { return this.insertBefore(child, null); },
      removeChild(child) { const i = this.children.indexOf(child); if (i !== -1) this.children.splice(i, 1); child.parentNode = null; },
      remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    });
    const find = (root, id) => (root.id === id ? root : root.children.reduce((hit, c) => hit || find(c, id), null));
    const body = node('body'), controls = node('controls'), results = node('results');
    body.appendChild(controls); body.appendChild(results);
    const document = { getElementById: (id) => find(body, id), createElement: () => node() };
    const ctx = t.vm.createContext({ document, sessionStorage: { getItem: () => null }, _isAwayFromLondon: () => true });
    t.vm.runInContext("var TRAVEL_NOTICE_DISMISS_KEY = 'psycle_travel_notice_dismissed';\n" + grab(appSrc, 'function renderTravelNotice('), ctx, { filename: 'js/app.js[renderTravelNotice]' });
    const ids = (n) => n.children.map((c) => c.id);

    ctx.renderTravelNotice(); // reference data answered from the cache: init's tail runs before tabs.js builds the shell
    eq(ids(body), ['controls', 'travelNotice', 'results'], 'before the tab shell exists the notice goes right above #results');
    // The SHIPPED lines of initTabs that move the finder into the Discover panel.
    const moveFrom = tabsSrc.indexOf('    discoverPanel.appendChild(controls);');
    const moveTo = tabsSrc.indexOf('    discoverPanel.appendChild(results);', moveFrom);
    ok(moveFrom !== -1 && moveTo > moveFrom, "initTabs' move of the finder can be sliced");
    const panel = node('tab-discover');
    body.insertBefore(panel, controls);
    const shell = t.vm.createContext({ document, discoverPanel: panel, controls, results });
    t.vm.runInContext(tabsSrc.slice(moveFrom, moveTo) + '    discoverPanel.appendChild(results);', shell, { filename: 'js/tabs.js[initTabs move]' });
    eq([ids(body), ids(panel)], [['tab-discover'], ['controls', 'travelNotice', 'results']], 'initTabs takes the notice along — it used to stay behind, outside the panels, under the docked tab bar');

    // Anything else that moves #results: the next render re-homes the notice.
    const other = node('elsewhere');
    body.appendChild(other);
    other.appendChild(results);
    ctx.renderTravelNotice();
    eq([ids(panel), ids(other)], [['controls'], ['travelNotice', 'results']], 'a notice left behind by some other move is put back above #results on the next render');
    ctx.renderTravelNotice();
    eq(ids(other), ['travelNotice', 'results'], '…once: a second render neither moves nor duplicates it');
    ctx._isAwayFromLondon = () => false;
    ctx.renderTravelNotice();
    eq(ids(other), ['results'], 'back on London time: removed, as before');
  }
};
