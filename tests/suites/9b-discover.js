'use strict';
// Wave 9b — Crisp Colour on Discover: the app header and tab bar, the date row,
// the Filters bar and its chips, the day strip, and THE CLASS CARD.
//   - the new decisions are js/app.js's pure:day-pager additions
//     (_pagerPillParts, _pagerHeldDays, _pagerHeldSpoken);
//   - the card is the SHIPPED eventCard template, run against fakes;
//   - the day-dot painter is the shipped function over a fake pill;
//   - the look is css/crisp.css's crisp:9b-discover section, held to its rules.
// Nothing here may change what the booking code relies on: the pill's className
// stays exactly 'book-btn[ booked| waitlist]' (reliability.js compares it as a
// string), its label stays plain text (the ✓ contract is read off it), and the
// in-place sync still finds .cc-sub / .cc-spots.
// Runs with TZ=America/New_York on purpose: a day and a time here are cut from
// the start_at DIGITS — the gym's wall clock — never read through Date.
module.exports = function (t) {
  const { ok, eq } = t;
  const app = t.readSource('js/app.js');
  const tabsJs = t.readSource('js/tabs.js');
  const themeJs = t.readSource('js/theme.js');
  const page = t.readSource('psycle-finder.html');
  const themeCss = t.readSource('css/theme.css');
  const noComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
  const crispAll = t.readSource('css/crisp.css');
  const from = crispAll.indexOf('/* == crisp:9b-discover == */'), to = crispAll.indexOf('/* == crisp:9c-sheets == */');
  const mine = noComments(crispAll.slice(from, to));
  const P = t.loadPure('js/app.js', 'day-pager');
  const classType = t.loadPure('js/app.js', 'class-type', { getCategory: t.loadPure('js/app.js', 'core').getCategory });
  // A top-level function, from its opener to its closing bare brace.
  const fnSrc = (src, opener) => {
    const s = src.indexOf(opener), e = src.indexOf('\n}\n', s);
    if (s === -1 || e === -1) throw new Error('9b-discover suite: cannot slice "' + opener + '" (anchor moved?)');
    return src.slice(s, e + 3);
  };
  // The declarations of the first rule whose WHOLE selector list is `selector`
  // (it must open the rule: the tail of "a, b {" is not the rule "b {").
  const rule = (css, selector) => {
    const re = new RegExp('(?:^|[{}])\\s*' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
    return (re.exec(css) || [])[1] || '';
  };

  // ── The strip pill ───────────────────────────────────────────────────────
  t.section('Day strip: a pill is a small word over the day of the month');
  {
    const TODAY = '2026-09-18';
    eq(P._pagerPillParts('2026-09-18', TODAY), { word: 'Today', num: '18' }, 'today reads "Today" over 18');
    eq(P._pagerPillParts('2026-09-19', TODAY), { word: 'Sat', num: '19' }, 'tomorrow is its WEEKDAY: "Tomorrow" does not fit a seventh of a phone, and the numeral already says which day');
    eq(P._pagerPillParts('2026-10-01', TODAY), { word: 'Thu', num: '1' }, 'no leading zero on the numeral');
    eq(P._pagerPillParts('2026-09-18', '').word, 'Fri', 'no "today" handed in: still a weekday');
    eq(P._pagerPillParts('<img>', TODAY), { word: '<img>', num: '' }, 'a day that is not a day comes back as it is (the painter escapes what it prints)');
    eq([P._pagerPillParts(null, TODAY), P._pagerPillParts(undefined, TODAY)], [{ word: '', num: '' }, { word: '', num: '' }], 'nothing in, nothing out');
    // Both countries' clock changes: the weekday is worked out in UTC, where a day is always 24 hours.
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const days = P._pagerDays('2026-10-23', '2026-11-03').concat(P._pagerDays('2026-03-06', '2026-03-31'));
    ok(days.every((d) => P._pagerPillParts(d, '').word === names[new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8))).getUTCDay()] && P._pagerPillParts(d, '').num === String(+d.slice(8))),
      'across both clock changes (UK and this process\'s New York) every pill names its own weekday and date');
    // The spoken name is unchanged: the full date, as before.
    eq(P._pagerSpoken('2026-09-19', TODAY, 14, null), 'Saturday 19 September, 14 classes', '…and the pill is still NAMED by its full date');
  }

  // ── Held days ────────────────────────────────────────────────────────────
  t.section('Day strip: the class-colour dot marks a day on which you hold a SEAT');
  {
    const DAYS = P._pagerDays('2026-09-18', '2026-09-24');
    const cache = {
      101: { start_at: '2026-09-19 18:30:00', _typeName: 'STRENGTH: Full Body 45' },
      102: { start_at: '2026-09-19T07:00:00', _typeName: 'RIDE: 45' },
      103: { start_at: '2026-09-21 00:30:00', _typeName: 'YOGA: Flow' },
      104: { start_at: '2026-09-22 12:05:00', _typeName: 'REFORMER: Foundations 50' },
      105: { start_at: '2026-09-30 09:00:00', _typeName: 'RIDE: 45' },
      106: { start_at: '2026-09-23 23:15:00', _typeName: 'BARRE: Sculpt' },
    };
    const o = { typeKey: classType.classTypeKey };
    const held = (bookings, opts) => JSON.parse(JSON.stringify(P._pagerHeldDays(bookings, cache, DAYS, opts || o)));
    eq(held({ 101: { slots: [7] }, 102: { slots: [12] } }), { '2026-09-19': { ct: 'ride', name: 'RIDE: 45', time: '07:00' } },
      'two classes on one day: ONE dot, the earliest class\'s (the T- and the space-form of start_at alike)');
    eq(held({ 103: { slots: [] , bookingIds: ['A'] } }), { '2026-09-21': { ct: 'yoga', name: 'YOGA: Flow', time: '00:30' } },
      'a class at 00:30 stays on ITS day and reads 00:30 — cut from the digits, in a process running on New York time');
    eq(held({ 104: { slots: [3] } })['2026-09-22'].time, '12:05', 'five past noon is 12:05');
    eq(held({ 106: { slots: [3] } })['2026-09-23'].time, '23:15', '23:15 stays 23:15 — 24-hour, never "11:15pm"');
    eq(held({ 104: { slots: [], waitlisted: true, waitlist: { id: 5 } } }), {}, 'a waitlist PLACE marks nothing: it is not yours yet');
    eq(held({ 105: { slots: [1] } }), {}, 'a class outside the strip\'s days marks nothing');
    eq(held({ 999: { slots: [1] } }), {}, 'a held class the cache cannot describe marks nothing (and nothing is fetched to find out)');
    eq(held({ 101: { slots: [7] } }, { typeKey: classType.classTypeKey, started: (s) => s === '2026-09-19 18:30:00' }), {}, 'a class that has started is over: no dot');
    eq(held({ 101: { slots: [7] }, 102: { slots: [12] } }, { typeKey: classType.classTypeKey, started: (s) => s === '2026-09-19T07:00:00' })['2026-09-19'].ct, 'strength',
      '…and the day\'s dot moves on to the next class still ahead');
    eq(held({ 101: { slots: [7] } }, { typeKey: () => { throw new Error('boom'); }, started: () => { throw new Error('boom'); } })['2026-09-19'].ct, 'other',
      'a helper that throws never takes the strip down: the neutral colour, and the class still counts');
    eq(held({ 101: { slots: [7] } }, {})['2026-09-19'].ct, 'other', 'no typeKey handed in → "other"');
    // Untrusted shapes: _myBookings and _eventCache are app state, but ids come from the API.
    eq([held(null), held(undefined), held({ 101: null }), held({ 101: 'x' })], [{}, {}, {}, {}], 'no bookings / junk entries: nothing');
    eq(JSON.parse(JSON.stringify(P._pagerHeldDays({ constructor: { slots: [1] }, __proto__: { slots: [1] } }, {}, DAYS, o))), {}, 'an id that names something on Object.prototype finds no cache entry (own properties only)');
    eq(P._pagerHeldDays({ 101: { slots: [7] } }, cache, [], o), {}, 'no days, no dots');
    eq(held({ 107: { slots: [1] } }), {}, 'unknown id again, after the cache was read: still nothing');
    const noTime = P._pagerHeldDays({ 1: { slots: [1] } }, { 1: { start_at: '2026-09-20', _typeName: '' } }, DAYS, o)['2026-09-20'];
    eq([noTime.time, noTime.name, noTime.ct], ['', 'a class', 'other'], 'a date with no time, a class with no name: a dot, "a class", no time');

    eq([P._pagerHeldSpoken({ name: 'RIDE: 45', time: '07:00' }), P._pagerHeldSpoken({ name: 'a class', time: '' }), P._pagerHeldSpoken(null), P._pagerHeldSpoken(undefined)],
      ['. You have RIDE: 45 at 07:00', '. You have a class', '', ''], 'the dot is SAID: it rides on the end of the pill\'s spoken name');
    const block = app.slice(app.indexOf('function _pagerHeldDays('), app.indexOf('function _pagerHeldSpoken('));
    ok(!/new Date|Date\.parse|getHours|toLocale/.test(block), '_pagerHeldDays never reads start_at through Date (the device is not always on UK time)');
  }

  // ── The dot painter (shipped) ────────────────────────────────────────────
  t.section('Day strip: dots are painted in place, from memory only, once /bookings has really loaded');
  {
    const mkEl = () => ({ attrs: {}, className: '', removed: false, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }, remove() { this.removed = true; } });
    const world = () => {
      const num = { kids: [], appendChild(n) { this.kids.push(n); } };
      const pill = { kids: [], appendChild(n) { this.kids.push(n); }, querySelector: (sel) => (sel === '.day-pill-dot' ? (num.kids.concat(pill.kids).filter((k) => !k.removed)[0] || null) : sel === '.day-pill-num' ? num : null) };
      const ctx = t.vm.createContext({ document: { createElement: mkEl } });
      t.vm.runInContext(fnSrc(app, 'function _paintDayDot(pill, held) {'), ctx, { filename: 'js/app.js[_paintDayDot]' });
      return { num, pill, paint: ctx._paintDayDot };
    };
    let w = world();
    w.paint(w.pill, { ct: 'ride' });
    eq([w.num.kids.length, w.pill.kids.length, w.num.kids[0].className, w.num.kids[0].attrs], [1, 0, 'day-pill-dot ct-dot', { 'aria-hidden': 'true', 'data-ct': 'ride' }],
      'a held day gains ONE dot, on the date numeral (clear of the word above it), decorative, in its class\'s colour');
    w.paint(w.pill, { ct: 'ride' });
    eq(w.num.kids.length, 1, 'painted again: still one dot');
    w.paint(w.pill, { ct: 'yoga' });
    eq([w.num.kids.length, w.num.kids[0].attrs['data-ct']], [1, 'yoga'], 'the class changed: the same dot is re-coloured');
    w.paint(w.pill, null);
    ok(w.num.kids[0].removed, 'no longer held: the dot comes off');
    w = world();
    w.paint(w.pill, undefined);
    eq(w.num.kids.length, 0, 'never held: nothing is added');

    const heldFor = fnSrc(app, 'function _heldDaysFor(m) {');
    ok(/if \(!m \|\| !m\.paged \|\| _bookingsLoadState !== 'loaded'\) return \{\};/.test(heldFor), 'no dots until /bookings has really been read: a list still loading says nothing about what is held');
    ok(/_pagerHeldDays\(_myBookings, _eventCache, m\.days, \{/.test(heldFor) && /started: startAt => _classHasStarted\(startAt, now, _gymClassStartMs\)/.test(heldFor),
      'read from _myBookings + _eventCache; "started" is the London-resolved test My Bookings uses');
    const dots = heldFor + fnSrc(app, 'function _paintDayDot(pill, held) {') + fnSrc(app, 'function _repaintDayDots() {');
    ok(!/apiFetch|fetch\(|search\(|revalidate/.test(dots.replace(/\/\/[^\n]*/g, '')), 'nothing is ever fetched for a dot');
    ok(/\['bookings:loaded', 'booking:complete', 'booking:cancelled', 'seat:cancelled', 'waitlist:claimed', 'waitlist:allocated', 'auth:changed'\]\s*\.forEach\(name => PsycleEvents\.on\(name, _repaintDayDots\)\);/.test(app),
      'a booking made, cancelled or loaded repaints the dots in place (no render() runs for those)');
    const strip = fnSrc(app, 'function _paintDayStrip(container, m) {');
    ok(/const parts = _pagerPillParts\(d, m\.todayStr\);/.test(strip) && /<span class="day-pill-label">\$\{escapeHTML\(parts\.word\)\}<\/span><span class="day-pill-num">\$\{escapeHTML\(parts\.num\)\}<\/span><span class="day-pill-count"><\/span>/.test(strip),
      'the pill is word · numeral · count, both escaped');
    ok(/_pagerSpoken\(d, m\.todayStr, n, state\) \+ _pagerHeldSpoken\(held\[d\]\)/.test(strip) && /_paintDayDot\(pill, held\[d\]\);/.test(strip), 'every pass: the name says the dot, and the dot is brought up to date');
    ok(!/day-nav|chevron/i.test(strip + fnSrc(app, 'function _paintDayGroup(host, day, m) {')), 'still no previous / next buttons on Discover');
  }

  // ── THE CLASS CARD ───────────────────────────────────────────────────────
  t.section('Class card: one anatomy, coloured by class type — and the booking contracts untouched');
  {
    const cardSrc = app.slice(app.indexOf('function eventCard(evt, instrMap, studioMap, locationMap, typeMap) {'), app.indexOf("// Feature 13's write, behind a trailing debounce"));
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const mk = (bookings, win) => {
      const ctx = t.loadPure('js/app.js', 'discover', {
        _myBookings: bookings || {}, _studioMap: { 7: { has_layout: true }, 8: { has_layout: false } },
        escapeHTML: esc, instrLink: (n) => (n ? '<span class="instructor-link">' + esc(n) + '</span>' : ''), window: win || {},
        formatSlots: (l, s) => l + ' ' + s.join(' & '), slotLabel: () => 'Bike',
        classTypeKey: classType.classTypeKey, classPictogram: classType.classPictogram, _ccTimeHTML: classType._ccTimeHTML,
      });
      t.vm.runInContext('var _cardCountsFresh = true;\n' + cardSrc, ctx, { filename: 'js/app.js[eventCard]' });
      return ctx;
    };
    const maps = [{ 1: { id: 1, full_name: 'Alex Stone' } }, { 7: { id: 7, location_id: 3, name: 'Studio 1' }, 8: { id: 8, location_id: 3, name: 'Studio 2' } }, { 3: { id: 3, name: 'Psycle Bank' } },
      { 2: { id: 2, name: 'RIDE: 45' }, 3: { id: 3, name: 'REFORMER: Strength <50>' }, 4: { id: 4, name: 'Sound Bath' } }];
    const evt = (o) => Object.assign({ id: 501, instructor_id: 1, studio_id: 7, event_type_id: 2, start_at: '2026-09-17T18:30:00', duration: 45, capacity: 21, occupancy: 5 }, o || {});
    const card = (ctx, o) => ctx.eventCard(evt(o), maps[0], maps[1], maps[2], maps[3]);
    let ctx = mk();
    let html = card(ctx);
    ok(/^<div class="class-card ct-card" data-ct="ride" data-id="501" data-studio-id="7"/.test(html), 'the root: .class-card.ct-card wearing its class type as data-ct (ids kept as data, as before)');
    ok(/<div class="cc-time">\s*<span class="cc-time-h">18:30<\/span>\s*<span class="cc-dur">45 min<\/span>\s*<\/div>/.test(html),
      'the TIME leads: 24-hour ("18:30", never "6:30pm") in the display face, over ONE small line — the duration alone, as on the boards (every time is five tabular digits: one narrow column)');
    ok(/<span class="cc-time-h">12:05<\/span>\s*<span class="cc-dur">45 min<\/span>/.test(card(ctx, { start_at: '2026-09-17T12:05:00' })) &&
      /<span class="cc-time-h">00:30<\/span>\s*<span class="cc-dur">45 min<\/span>/.test(card(ctx, { start_at: '2026-09-17T00:30:00' })) && !/cc-ampm|\b(am|pm)\b/.test(html),
      'five past noon is 12:05, half past midnight 00:30 — and no am / pm is printed anywhere on the card');
    ok(/<span class="cc-head"><span class="ct-tile" aria-hidden="true"><svg class="ct-pic" width="18" height="18"[^>]*aria-hidden="true"[^>]*>/.test(html), 'the title is led by the type\'s pictogram tile — decorative, the name says the class');
    ok(/<span class="cc-name" role="button" tabindex="0">RIDE: 45<\/span><\/span>/.test(html), '…and the name keeps its keyboard role');
    ok(/<span class="cc-sub"><span class="cc-who"><span class="instructor-link">Alex Stone<\/span><\/span><span class="cc-loc">Bank<\/span><\/span>/.test(html),
      'meta line: instructor (+ rank) and the studio as ONE no-wrap unit — plain text, "Psycle " dropped');
    const metaLine = (/<span class="cc-sub">[^]*?<\/span><\/span>/.exec(html) || [''])[0];
    ok(metaLine !== '' && metaLine.indexOf('·') === -1 && metaLine.indexOf('&middot;') === -1, 'no "·" in the meta line\'s markup: CSS draws it inside the studio\'s own unit, so a wrapped line never ends or starts on a bare dot');
    ok(/white-space:\s*nowrap/.test(rule(mine, '.class-card[data-ct] .cc-dur')), '…and the one "·" the card does print ("pm · 45 min") sits in a line that cannot wrap');
    ok(!/cc-rule/.test(html), 'the old divider is gone');
    ok(/<\/span>\s*<span class="cc-spots" data-count>16 spots left<\/span>/.test(html) && html.indexOf('class="cc-sub"') < html.indexOf('class="cc-spots"'),
      'the availability line still FOLLOWS .cc-sub (the in-place sync inserts it "afterend" of that line)');
    ok(/<button class="book-btn"  data-event-id="501" data-studio-id="7"\s+onclick="event\.stopPropagation\(\);bookClass\(501, this, 7\)">Book<\/button>/.test(html), 'ONE action, exactly where it was: a plain "Book" button');
    ok(!/pill-btn|pill-secondary|pill-primary|glow-mine/.test(html), 'no primitive class rides on the button or the card: the booking code assigns className wholesale and compares it as a string');
    eq([card(ctx, { event_type_id: 3 }).match(/data-ct="([^"]*)"/)[1], card(ctx, { event_type_id: 4 }).match(/data-ct="([^"]*)"/)[1], card(ctx, { event_type_id: 99 }).match(/data-ct="([^"]*)"/)[1]],
      ['pilates', 'other', 'other'], 'a reformer class is pilates; an unknown or missing type wears "other"');
    ok(/REFORMER: Strength &lt;50&gt;/.test(card(ctx, { event_type_id: 3 })) && !/<50>/.test(card(ctx, { event_type_id: 3 })), 'the class name is still escaped');
    ok(/<span class="cc-time-h">18:30<\/span>\s*<\/div>/.test(card(ctx, { duration: undefined })) && !/undefined|cc-dur/.test(card(ctx, { duration: undefined })) &&
      /<span class="cc-time-h">18:30<\/span>\s*<\/div>/.test(card(ctx, { duration: 0 })) && !/cc-dur/.test(card(ctx, { duration: 0 })), 'a class with no duration prints the time alone — no empty second line (it read "undefined min")');
    ok(!/cc-who/.test(card(ctx, { instructor_id: 404 })) && /<span class="cc-sub"><span class="cc-loc">Bank<\/span><\/span>/.test(card(ctx, { instructor_id: 404 })), 'no instructor: the studio alone, no empty unit before it');
    ok(/<span class="cc-sub"><span class="cc-who">[^]*?<\/span><\/span>/.test(card(ctx, { studio_id: 404 })) && !/cc-loc/.test(card(ctx, { studio_id: 404 })), 'no studio: the instructor alone');
    ctx = mk({}, { tierBadgeHTML: (id) => (id === 1 ? '<span class="tier-badge tier-S">S</span>' : '') });
    ok(/<span class="cc-who"><span class="instructor-link">Alex Stone<\/span><span class="tier-badge tier-S">S<\/span><\/span>/.test(card(ctx)), 'the rank tile rides inside the instructor\'s unit (settings.js tierBadgeHTML, called as before)');

    // States — the label contract and the wrapper contract.
    ctx = mk({ 501: { bookingId: 9, slots: [12] } });
    html = card(ctx);
    ok(/^<div class="class-card ct-card is-booked" data-ct="ride"/.test(html) && /<button class="book-btn booked" [^>]*data-booking-id="9"[^>]*>Bike 12 ✓<\/button>/.test(html) && !/cc-spots/.test(html),
      'booked-yours: .is-booked on the card (css/crisp.css gives it the glow), className exactly "book-btn booked", the seat + ✓ as plain text');
    ctx = mk({ 501: { bookingId: null, slots: [], waitlisted: true, waitlist: { id: 5 } } });
    html = card(ctx);
    ok(/class="class-card ct-card is-waitlisted"/.test(html) && /<button class="book-btn booked" [^>]*onclick="event\.stopPropagation\(\);leaveWaitlist\(501, this\)">Waitlisted ✓<\/button>/.test(html),
      'a waitlist place: .is-waitlisted (dashed), and the tap still manages the place — never the picker');
    ctx = mk();
    ok(/<button class="book-btn waitlist" [^>]*>Join waitlist<\/button>/.test(card(ctx, { is_fully_booked: true, is_waitlistable: true })), 'full + waitlistable: className exactly "book-btn waitlist"');
    html = card(ctx, { is_fully_booked: true, is_waitlistable: false });
    ok(/(<button class="book-btn"[^>]*>Full<\/button>)/.test(html) && /<button class="book-btn" disabled /.test(html), "Full still matches features.js's notify-bell regex (the wrapper contract), and is disabled");
    ok(/html\.replace\(\s*\/\(<button class="book-btn"\[\^>\]\*>Full<\\\/button>\)\/,/.test(t.readSource('js/features.js')), '…which is still the regex features.js ships');
    ctx = mk({ 501: { bookingId: 9, slots: [] } });
    ok(/confirmUnbook\(9, 501, this\)/.test(ctx.eventCard(evt({ studio_id: 8 }), maps[0], maps[1], maps[2], maps[3])), 'a held space at a no-layout studio still cancels directly');
    // The in-place sync, the contract readers and the wrappers still find what they look for.
    ok(/card\?\.querySelector\('\.cc-sub'\)\?\.insertAdjacentHTML\('afterend', line\)/.test(app) && /btn\.className = 'book-btn booked';/.test(app) && /btn\.className === 'book-btn booked'/.test(t.readSource('js/reliability.js')),
      'the hooks the booking code relies on are the ones the card still carries');
    ok(/function eventCard\(evt, instrMap, studioMap, locationMap, typeMap\) \{/.test(app), 'five parameters, as features.js\'s wrapper forwards them');
  }

  // ── Filters bar + chips ──────────────────────────────────────────────────
  t.section('Filters: colour means class type — only a class-type chip or pill wears one');
  {
    const chrome = app.slice(app.indexOf('function updateFiltersSummary() {'), app.indexOf('// A star can change where no filter toggle runs'));
    ok(/\$\{c\.kind === 'category' \? ` data-ct="\$\{escapeHTML\(String\(c\.id\)\.toLowerCase\(\)\)\}"` : ''\}/.test(chrome), 'a category chip carries data-ct = its key, lower-cased and escaped; no other kind does');
    ok(/class="filter-chip" data-kind=/.test(chrome), 'the chip keeps its one class (tests and the focus hand-over find it by that)');
    const pills = fnSrc(app, 'function renderCategoryPills() {');
    ok(/class="cat-pill\$\{active \? ' active' : ''\}\$\{dim\}" aria-pressed="\$\{active\}" data-ct="\$\{cat\.key\.toLowerCase\(\)\}"/.test(pills) &&
      /<span class="ct-tile is-sm is-solid" aria-hidden="true">\$\{classPictogram\(cat\.key, 15\)\}<\/span>\$\{cat\.label\}\$\{badge\}/.test(pills),
    'each class-type pill carries its data-ct and leads with its pictogram tile (decorative: the label names it)');
    ok(!/data-ct/.test(fnSrc(app, 'function renderLocationChips() {')) && !/data-ct/.test(fnSrc(app, 'function renderTimePills() {')), 'studios and time bands stay neutral');
    ok(/<div id="strengthSubPills" data-ct="strength" style="display:none"><\/div>/.test(page) && /<div id="reformerSubPills" data-ct="pilates" style="display:none"><\/div>/.test(page), 'a narrowed sub-type row wears its parent class type\'s colour');
    ok(/<span class="date-track">\s*<button class="date-quick-btn"/.test(page) && (page.match(/<span class="date-track">/g) || []).length === 1, 'the five ranges share ONE segmented track (a plain wrapper: the pills are still found by .date-quick-btn)');
    ok(/\.filter-chip\[data-ct\] \{ background: var\(--ct-wash\); color: var\(--ct-deep\); \}/.test(mine) && /background:\s*var\(--sunken\)/.test(rule(mine, '.filter-chip')), 'summary chips: neutral = the sunken well; a class type = its wash with the deep ink');
    ok(/\.cat-pill\[data-ct\]\.active,\s*\.sub-pill\.active \{[^}]*background:\s*var\(--ct-tint\);[^}]*color:\s*var\(--ct-deep\);[^}]*var\(--ct-base\)/.test(mine), 'a lit class-type pill: its tint, deep ink and a base ring');
    ok(/\.loc-chip\.active,\s*\.cat-pill\.active \{[^}]*background:\s*var\(--sunken\);[^}]*color:\s*var\(--ink\);/.test(mine), 'a lit neutral pill sinks into the well with an ink ring — no accent fill, no class colour');
  }

  // ── Header + tab bar ─────────────────────────────────────────────────────
  t.section('Header and tab bar: the wordmark, soft round controls, the boards\' four marks');
  {
    const header = page.slice(page.indexOf('<header>'), page.indexOf('</header>'));
    ok(/<div class="brand-mark" aria-hidden="true"><svg viewBox="136 136 752 752" aria-hidden="true" focusable="false">[\s\S]*?<\/svg><\/div>\s*<h1>Psync<\/h1>/.test(header), 'the mark (the app icon\'s two engraved halves, decorative) beside the <h1>');
    ok(!/header-subtitle|Psycle Companion/.test(header), 'no subtitle under the wordmark');
    ok(!/<span/.test(header.slice(header.indexOf('brand-mark'), header.indexOf('<h1>'))), 'the mark uses no <span> (older sheets style every `header span`)');
    ok(/font-family:\s*var\(--font-display\)/.test(rule(mine, 'header h1')) && /font-weight:\s*var\(--weight-black\)/.test(rule(mine, 'header h1')) && /text-transform:\s*none/.test(rule(mine, 'header h1')), 'the wordmark: display face, black weight, as written');
    const ctl = rule(mine, '.header-avatar,\nheader .theme-toggle');
    ok(/width:\s*var\(--tap-min\)/.test(ctl) && /height:\s*var\(--tap-min\)/.test(ctl) && /border-radius:\s*var\(--radius-full\)/.test(ctl) && /box-shadow:\s*var\(--shadow-soft\)/.test(ctl),
      'theme toggle and avatar: soft round surface controls, a fingertip across');
    // Only padding-block on the bars themselves: discover-layout-fix.css insets them to the content column on desktop.
    const bare = mine.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
    ok(!/(^|\})\s*header \{[^}]*padding(-inline)?:/.test(bare) && !/(^|\})\s*\.tab-bar \{[^}]*padding(-inline)?:/.test(bare), 'outside a media query, header and tab bar set padding-BLOCK only (the desktop inset keeps winning)');
    const icons = tabsJs.slice(tabsJs.indexOf('var TAB_ICONS = {'), tabsJs.indexOf('var tabBar = document.createElement'));
    ok(/stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"/.test(tabsJs.slice(tabsJs.indexOf('var icon = function'), tabsJs.indexOf('var TAB_ICONS'))), 'tab marks: stroke 2, round ends, decorative');
    ok(/discover: icon\('<circle cx="11" cy="11" r="6\.5"\/><path d="M16 16l4 4"\/>'\)/.test(icons) && /M8\.5 13l2\.5 2\.5 4\.5-5/.test(icons) && /M12 19V5/.test(icons) && /rx="3\.5"/.test(icons), 'search · calendar-check · bars · card, as drawn on the boards');
    ok(/data-tab="bookings"[^]*?<span class="tab-badge" id="tabBadge"><\/span>/.test(tabsJs) && /aria-current="page" data-tab="discover"/.test(tabsJs), 'the bar\'s hooks are untouched: data-tab, #tabBadge, aria-current');
    ok(/\.tab-btn\.active \.tab-icon \{[^}]*background:\s*var\(--accent\);[^}]*color:\s*var\(--accent-ink\);[^}]*animation:\s*none;/.test(mine), 'phone: the current tab is the filled pill behind its mark — and the mark no longer pops (size and stroke never change with state)');
    ok(!/discTitle|disc-title/.test(tabsJs) && /Find your<br>next class/.test(page), 'no headline over a loaded timetable; the EMPTY state keeps its title');
    ok(/id="lastUpdated" class="last-updated"/.test(tabsJs) && /class="disc-clear-btn" onclick="clearFilters\(\)"/.test(tabsJs), '…and the freshness line + "Clear filters" are still built');
  }

  // ── CSS contract ─────────────────────────────────────────────────────────
  t.section('crisp:9b-discover — the card\'s rules, the glow\'s three places, tap targets, motion');
  {
    ok(from !== -1 && to > from && mine.length > 8000, 'the section is in place, between its two markers');
    const cardRule = rule(mine, '.class-card[data-ct]');
    ok(/background:\s*var\(--ct-card\)/.test(cardRule) && /color:\s*var\(--ct-ink\)/.test(cardRule) && /border-radius:\s*var\(--radius-card\)/.test(cardRule) && /border:\s*0/.test(cardRule),
      'the card: tinted edge to edge by its class type at the chosen intensity, the card radius, no border');
    ok(/min-height:\s*calc\(var\(--tap-lg\) \+ var\(--tap-min\)\)/.test(cardRule) && !/[^-]height:/.test(cardRule), 'the boards\' 100 as a MIN-height: the card grows with wrapped or larger text, it never clips');
    // Every rule about the card hangs off [data-ct], so a card not yet on this anatomy is untouched.
    const cardSelectors = (mine.match(/(^|[},])\s*[^{}@]*\.class-card[^{},]*/g) || []).map((s) => s.replace(/^[},\s]+/, '').trim());
    eq(cardSelectors.filter((s) => s.indexOf('.class-card[data-ct]') === -1), [], 'every card rule is scoped to .class-card[data-ct] (My Bookings opts in by adding data-ct)');
    // Inks on the tinted ground: only the three the contrast matrix guarantees.
    const cardBlocks = (mine.match(/[^{}]*\.class-card\[data-ct\][^{}]*\{[^}]*\}/g) || []).filter((b) => !/\.tier-|\.badge\b/.test(b.split('{')[0]));
    const inks = [];
    cardBlocks.forEach((b) => (b.split('{')[1].match(/(?:^|;|\s)color:\s*([^;]+);/g) || []).forEach((d) => inks.push(d.replace(/^[;\s]*color:\s*/, '').replace(/;$/, ''))));
    eq(Array.from(new Set(inks)).filter((v) => ['var(--ct-ink)', 'var(--ct-ink-2)', 'var(--ct-deep)', 'var(--ct-on-base)'].indexOf(v) === -1), [],
      'text on a class card is --ct-ink, --ct-ink-2 or --ct-deep (and --ct-on-base on a base fill) — never --text-dim / -faint / -ghost');
    // The glow: only what is selected or yours.
    // (Every selector of a grouped rule counts on its own.)
    const glowing = [];
    (mine.match(/[^{}]+\{[^}]*var\(--glow-[^}]*\}/g) || []).forEach((b) => b.split('{')[0].split(',').forEach((s) => { s = s.trim(); if (s) glowing.push(s); }));
    eq(glowing.sort(), ['.cal-cell.sel', '.class-card[data-ct].glow-mine-card', '.class-card[data-ct].is-booked:not(.my-booking-card)', '.day-pill.active'].sort(),
      'the glow marks the chosen day (strip and calendar) and YOUR class — nothing else. ONE card recipe, two triggers: .is-booked on Discover, and on My Bookings (where every card is held) only the NEXT seat, .glow-mine-card');
    ok(/\.class-card\[data-ct\]\.is-booked:not\(\.my-booking-card\),\s*\.class-card\[data-ct\]\.glow-mine-card \{[^}]*box-shadow:\s*var\(--glow-edge\) var\(--ct-base\), var\(--glow-drop-card\) var\(--ct-drop\);/.test(mine), 'yours: the class edge + the soft class drop — said once, for both wearers of the card');
    ok(/\.class-card\[data-ct\]:not\(\.is-booked\):not\(\.my-booking-card\):hover \{/.test(mine), 'the desktop hover lift stays off My Bookings (one card of a held list lifting alone reads as a state)');
    ok(/\.day-pill\.active \{[^}]*var\(--glow-ring\) var\(--glow-sel-ring\)/.test(mine) && /\.day-pill\.active \{[^}]*background:\s*var\(--accent\);[^}]*color:\s*var\(--accent-ink\);/.test(mine), 'the chosen day: the theme\'s neutral pick colour (graphite on Cloud) with its ring');
    ok(/\.class-card\[data-ct\]\.is-waitlisted \{ border: var\(--hairline\) dashed var\(--ct-base\); \}/.test(mine), 'a waitlist place: the dashed class edge');
    // A label such as "Online": the sentence-case full pill it is on a held class's card — it kept the older
    // sheets' 4px-corner UPPERCASE 10px tag on Discover, recoloured only.
    const label = rule(mine, '.class-card[data-ct] .cc-meta .badge');
    ok(/border-radius:\s*var\(--radius-full\)/.test(label) && /text-transform:\s*none/.test(label) && /letter-spacing:\s*0/.test(label) && /font-size:\s*var\(--type-label\)/.test(label) && /color:\s*var\(--ct-ink-2\)/.test(label),
      'a card label ("Online") is a full pill in sentence case, in a guaranteed card ink');
    const held = (/#tab-bookings \.my-booking-card \.badge,\s*#tab-bookings \.my-booking-card \.mb-countdown \{([^}]*)\}/.exec(noComments(crispAll)) || [])[1] || '';
    ['border-radius', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-transform', 'background', 'color'].forEach((prop) => {
      const v = (re) => (new RegExp('(?:^|;|\\s)' + prop + ':\\s*([^;]+);').exec(re) || [])[1];
      eq(v(label), v(held), '…the same ' + prop + ' as the badge on a My Bookings card (' + v(held) + ')');
    });
    // The pill is styled from its state classes.
    ok(/\.class-card\[data-ct\] \.book-btn \{[^}]*background:\s*var\(--cc-pill\);[^}]*color:\s*var\(--ct-deep\);/.test(mine) && /--cc-pill:\s*var\(--surface\);/.test(cardRule), 'Book: the quiet surface pill in the class deep ink');
    ok(/html\[data-ct-intensity="off"\] \.class-card\[data-ct\],\s*html\[data-theme="gameboy"\] \.class-card\[data-ct\] \{ --cc-pill: var\(--surface-2\); \}/.test(mine),
      'where the card IS the surface ("off"; Handheld, which has no shadows) the pill steps one shade down — a property, so the state rules below still win');
    ok(/\.class-card\[data-ct\] \.book-btn\.booked \{[^}]*background:\s*var\(--ct-base\);[^}]*color:\s*var\(--ct-on-base\);/.test(mine) &&
      /\.class-card\[data-ct\] \.book-btn\.waitlist \{[^}]*background:\s*transparent;[^}]*inset 0 0 0 var\(--hairline\) var\(--ct-base\)/.test(mine) &&
      /\.class-card\[data-ct\]\.is-waitlisted \.book-btn\.booked \{[^}]*dashed var\(--ct-base\)/.test(mine),
    'Booked = the class base fill · Join waitlist = the class outline · Waitlisted = the dashed class edge');
    ok(!/html\[[^\]]*\] \.class-card\[data-ct\] \.book-btn/.test(mine), 'no theme- or intensity-prefixed pill rule is left to outrank a state');
    // The dangling dot.
    ok(/\.class-card\[data-ct\] \.cc-loc \{[^}]*white-space:\s*nowrap;/.test(mine) && /\.class-card\[data-ct\] \.cc-loc::before \{[^}]*content:\s*'\\00B7';[^}]*right:\s*100%;/.test(mine) &&
      /\.class-card\[data-ct\] \.cc-sub \{[^}]*flex-wrap:\s*wrap;[^}]*clip-path:\s*inset\(/.test(mine),
    'the "·" lives in the gap to the LEFT of the studio\'s no-wrap unit; wrapped to a new line it falls outside the line\'s clipped left edge');
    // No emoji bell on the card.
    ok(/\.class-card\[data-ct\] \.notify-btn::before \{[^}]*content:\s*'';[^}]*mask:/.test(mine) && !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(mine + cardSelectors.join('')), 'the notify bell on a card is a stroke mark drawn as a mask — never an emoji');
    // Tap targets.
    [['.class-card[data-ct] .book-btn', /min-height:\s*var\(--tap-min\)/], ['.controls-toggle', /height:\s*var\(--tap-min\)/], ['.date-track .date-quick-btn', /height:\s*var\(--tap-min\)/],
      ['.day-pill', /min-height:\s*calc\(var\(--tap-min\) \+ var\(--type-day\)\)/], ['.class-card[data-ct] .notify-btn', /height:\s*var\(--tap-min\)/]].forEach((pair) => {
      ok(pair[1].test(rule(mine, pair[0])), pair[0] + ' is a fingertip tall');
    });
    ok(/min-height:\s*var\(--tap-min\)/.test(rule(mine, '.loc-chip,\n.cat-pill,\n.sub-pill')) && /\.filter-chip::after/.test(t.readSource('css/redesign.css')), 'panel pills are --tap-min; a summary chip is drawn shorter and keeps redesign.css\'s full-height hit area');
    // The strip.
    const pill = rule(mine, '.day-pill');
    ok(/width:\s*calc\(\(100% - 6 \* var\(--space-2\)\) \/ 7\)/.test(pill) && /gap:\s*var\(--space-2\)/.test(rule(mine, '.day-strip')), 'seven days fit a phone\'s width exactly (six gaps of --space-2); a longer range scrolls');
    ok(/\.day-pill\.is-empty \{[^}]*dashed/.test(mine), 'a day with nothing on is a quiet dashed outline');
    ok(mine.indexOf('.day-pill.is-empty {') < mine.indexOf('.day-pill.active {'), '…and the chosen-day rule comes after it: a chosen EMPTY day is still the graphite pill');
    // Focus + motion + engine support.
    const focusRules = mine.match(/:focus-visible[^{]*\{[^}]*\}/g) || [];
    const rings = focusRules.filter((r) => /outline:/.test(r));
    ok(rings.length >= 12 && rings.every((r) => /outline:\s*var\(--focus-ring\);/.test(r)), 'keyboard focus is the --focus-ring token wherever a ring is drawn (' + rings.length + ' rules) — the body ink: it shows on every class tint');
    ok(/\.class-card\[data-ct\] \.cc-name:focus-visible,/.test(mine), '…including the class name on a tinted card');
    ok(/@media \(prefers-reduced-motion: reduce\) \{[^}]*transition:\s*none;/.test(mine), 'reduced motion is respected');
    ok(!/:has\(/.test(mine) && !/color-mix\(|oklch\(/.test(mine), 'no :has() (iOS 15.4+) and no colour maths in this section');
    ok(!/!important/.test(mine), 'no !important: older rules are out-ranked by being later at their own specificity');
  }

  // ── The title row keeps its tile ─────────────────────────────────────────
  t.section('Class card: the action drops to a row of its own before the tile is left alone on the title row');
  {
    // Beside a wide action ("Full" + the notify bell is 114px; any pill in Terminal / Handheld) the
    // info column was ~116px at 390px — still over the pre-tile 100px wrap basis. "STRENGTH:" no
    // longer fitted after the 28px tile, so the tile sat alone on line one, the whole name under it.
    const info = rule(mine, '.class-card[data-ct] .cc-info');
    eq((/flex:\s*1 1 (calc\([^;]+\));/.exec(info) || [])[1], 'calc(var(--tile-md) + var(--space-2) + 5.4 * var(--type-title))',
      'the wrap basis is what the title row\'s FIRST line needs: the tile, its gap, nine characters of the title');
    ok(/min-width:\s*0/.test(info), '…and the column may still shrink below it rather than overflow (320px)');
    // Each term is the title row's own: the card's tile is the default --tile-md, --space-2 from the name, in --type-title.
    ok(/--tile:\s*var\(--tile-md\);/.test(rule(noComments(crispAll), '.ct-tile')) && /\.class-card\[data-ct\] \.cc-head > \.ct-tile \{[^}]*margin-right:\s*var\(--space-2\);/.test(mine) &&
      /font-size:\s*var\(--type-title\);/.test(rule(mine, '.class-card[data-ct] .cc-name')) && /<span class="ct-tile" aria-hidden="true">\$\{classPictogram\(ct, 18\)\}<\/span>/.test(fnSrc(app, 'function eventCard(')),
      'tile (the default .ct-tile, --tile-md) + its --space-2 margin + the name\'s --type-title');
    const rootTok = {};
    (/\n:root \{([^}]*)\}/.exec(noComments(themeCss)) || ['', ''])[1].replace(/(--[\w-]+)\s*:\s*([\d.]+)px;/g, (m, k, v) => { rootTok[k] = Number(v); return m; });
    const tile = rootTok['--tile-md'], gap = rootTok['--space-2'], title = rootTok['--type-title'];
    const basis = tile + gap + 5.4 * title;
    // A mono face advances 0.6em a character (Terminal and Handheld set the body in one); Sofia Sans bold
    // sets "REFORMER:" — the longest class family — in 87px at 17px (measured), under the same allowance.
    ok(basis >= tile + gap + 9 * 0.6 * title - 1e-9 && basis >= tile + gap + 87, 'nine characters fit after the tile in the mono themes\' face too (' + basis.toFixed(1) + 'px)');
    // The flex line of a 390px phone: page gutters (--space-7), the card's padding, the time column (2.4em of
    // --type-time), two column gaps (--space-4). An item wraps when the hypothetical sizes no longer fit.
    const card = rule(mine, '.class-card[data-ct]');
    ok(/padding:\s*var\(--space-5\) var\(--space-5\) var\(--space-5\) var\(--space-6\);/.test(card) && /gap:\s*var\(--space-3\) var\(--space-4\);/.test(card) && /flex-wrap:\s*wrap;/.test(card) &&
      /min-width:\s*2\.4em;/.test(rule(mine, '.class-card[data-ct] .cc-time')) && /#tab-discover \{ padding: var\(--space-1\) var\(--space-7\) /.test(mine), 'the card is still the wrapping flex row this arithmetic is about');
    const line = (vw) => vw - 2 * rootTok['--space-7'] - rootTok['--space-5'] - rootTok['--space-6'];
    const inline = (vw, action) => 2.4 * rootTok['--type-time'] + basis + action + 2 * rootTok['--space-4'] <= line(vw);
    eq([inline(390, 114), inline(390, 126)], [false, false], 'at 390px "Full" + the bell (114px) and a mono "Join waitlist" (126px) take a row of their own — the text gets the card\'s width');
    eq([inline(390, 64), inline(390, 78), inline(390, 91), inline(375, 64)], [true, true, true, true], '"Book" (64px), "Bike 7 ✓" (78px) and "Join waitlist" (91px) stay beside the text at 390px; "Book" at 375px too');
    ok(100 + 114 + 2.4 * rootTok['--type-time'] + 2 * rootTok['--space-4'] <= line(390), '…where the old 100px basis kept "Full" + the bell inline, in a 116px column');
  }

  // ── Skeleton + empty states ──────────────────────────────────────────────
  t.section('Skeleton and empty states follow the card');
  {
    const sk = fnSrc(themeJs, 'function skeletonCardHTML() {');
    ok(/<div class="skeleton-card" aria-hidden="true">/.test(sk) && /sk-time-hour/.test(sk) && /sk-type/.test(sk) && !/skeleton-meta|sk-badge/.test(sk), 'a loading card: time block, three lines — the old badge row is gone');
    ok(/<\/div>\s*<div class="skeleton-bar sk-button"><\/div>\s*<\/div>`;/.test(sk), '…and ONE pill at the right, outside the info column, like the real card');
    const skRule = rule(mine, '.skeleton-card');
    ok(/border-radius:\s*var\(--radius-card\)/.test(skRule) && /min-height:\s*calc\(var\(--tap-lg\) \+ var\(--tap-min\)\)/.test(skRule) && /background:\s*var\(--surface\)/.test(skRule), 'same radius and height as the card, on the neutral surface (a class colour is only known once the class is)');
    const empty = fnSrc(themeJs, 'function renderEmptyState(message) {');
    ok(!/<svg/.test(empty) && /<div class="empty-title">\$\{msg\}<\/div>/.test(empty) && /empty-actions/.test(empty), 'an empty list is a plain line and the ways on — no illustration');
  }

  // ── Contrast of the pairs this section introduces ────────────────────────
  t.section('Contrast: the ink / ground pairs of the chrome, in every theme');
  {
    const HEX = /^#[0-9a-f]{6}$/i;
    const expand = (hex) => (/^#[0-9a-f]{3}$/i.test(hex) ? '#' + hex.slice(1).split('').map((c) => c + c).join('') : hex);
    const lum = (hex) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((s) => (s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const contrast = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
    const tokensOf = (selector) => {
      const start = themeCss.indexOf(selector + ' {');
      if (start === -1) return null;
      const out = {};
      noComments(themeCss.slice(themeCss.indexOf('{', start) + 1, themeCss.indexOf('}', start))).replace(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g, (m, k, v) => { out[k] = v.trim(); return m; });
      return out;
    };
    const root = tokensOf(':root');
    const themeTokens = (id) => {
      const tk = Object.assign({}, root, tokensOf('[data-theme="' + id + '"]'));
      const resolve = (v, depth) => { const m = /^var\((--[a-z0-9-]+)\)$/.exec(v || ''); return m && depth < 6 ? resolve(tk[m[1]], depth + 1) : v; };
      Object.keys(tk).forEach((k) => { tk[k] = expand(resolve(tk[k], 0)); });
      return tk;
    };
    const ids = [];
    themeJs.replace(/\{\s*id:\s*'([a-z]+)'[^}]*?base:\s*'(light|dark)'/g, (m, id) => { ids.push(id); return m; });
    eq(ids.length, 5, 'five themes read from the registry (' + ids.join(', ') + ')');
    // [ink token, ground token, what it is, minimum]
    const PAIRS = [
      ['--text', '--bg-deep', 'count chip / lit neutral pill / summary chip: ink on the sunken well', 4.5],
      ['--text', '--bg-panel', 'date track, day pill numeral, Filters bar: ink on the surface', 4.5],
      ['--text-muted', '--bg-panel', 'an unlit pill / segment: ink-2 on the surface', 4.5],
      ['--text-muted', '--bg', '"Clear", hovered tab label: ink-2 on the ground', 4.5],
      ['--text-faint', '--bg-panel', 'day-pill word, tab label, group label: ink-3 on the surface', 4.5],
      ['--text-faint', '--bg', 'freshness line, day count, group label: ink-3 on the ground', 4.5],
    ];
    let checked = 0;
    const worst = { v: 99, what: '' };
    ids.forEach((id) => {
      const tk = themeTokens(id);
      PAIRS.forEach((p) => {
        if (!HEX.test(tk[p[0]] || '') || !HEX.test(tk[p[1]] || '')) { ok(false, id + ': ' + p[0] + ' / ' + p[1] + ' did not resolve to a colour (' + tk[p[0]] + ' on ' + tk[p[1]] + ')'); return; }
        const r = contrast(tk[p[0]], tk[p[1]]);
        checked++;
        if (r < worst.v) { worst.v = r; worst.what = id + ' ' + p[0] + ' on ' + p[1]; }
        if (!(r >= p[3])) ok(false, id + ': ' + p[2] + ' is ' + r.toFixed(2) + ':1 (needs ≥' + p[3] + ')');
      });
      // The chosen day, the lit segment, the lit Filters bar, the current tab: the accent pair, either way round.
      const a = contrast(tk['--accent-ink'], tk['--accent']);
      checked++;
      // The repo's own standard for this pair (tests/suites/1f-contrast-tokens.js): AA everywhere, except
      // Terminal, which keeps its white-on-neon look at large-text AA.
      if (!(a >= (id === 'terminal' ? 3 : 4.5))) ok(false, id + ': --accent-ink on --accent is ' + a.toFixed(2) + ':1');
    });
    ok(checked === ids.length * (PAIRS.length + 1), checked + ' chrome pairs checked; the tightest is ' + worst.what + ' at ' + worst.v.toFixed(2) + ':1');

    // The class deep ink on the one-shade-down pill ("off", Handheld): every swatch, every non-mono theme.
    const cc = t.loadPure('js/theme.js', 'class-colours');
    const PALETTE = cc.CLASS_COLOUR_PALETTE;
    const bases = {};
    themeJs.replace(/\{\s*id:\s*'([a-z]+)'[^}]*?base:\s*'(light|dark)'([^}]*)\}/g, (m, id, base, rest) => { bases[id] = { base, mono: /mono:\s*true/.test(rest) }; return m; });
    let deepPairs = 0;
    Object.keys(PALETTE).forEach((n) => ids.filter((id) => !bases[id].mono).forEach((id) => {
      const sw = PALETTE[n][bases[id].base], tk = themeTokens(id);
      const r = contrast(sw.deep, tk['--bg-input']);
      deepPairs++;
      if (!(r >= 4.5)) ok(false, n + ' · ' + id + ': deep ' + sw.deep + ' on --bg-input (the Book pill at "off") is ' + r.toFixed(2) + ':1');
    }));
    ok(deepPairs === Object.keys(PALETTE).length * 3, deepPairs + ' swatch × theme pairs (every swatch × Cloud, Graphite, Blueprint): the Book pill\'s deep ink holds on the one-shade-down fill');
    // Handheld as it ships (mono): its deep ink is the heading lime.
    const gb = themeTokens('gameboy');
    ok(contrast(gb['--text-heading'], gb['--bg-input']) >= 4.5, 'Handheld: the pill\'s ink on its --bg-input fill is ' + contrast(gb['--text-heading'], gb['--bg-input']).toFixed(2) + ':1');
  }
};
