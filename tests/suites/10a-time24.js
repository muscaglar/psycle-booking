'use strict';
// Wave 10a — 24-hour times everywhere ("18:30", never "6:30pm").
// The owner's words: "24 hour time please (ie 18:30)".
//   1. ONE formatter: js/app.js pure:clock — _clock24(hours, mins) and
//      _clockOf(startAt). DOM-free, zone-free, parses nothing.
//   2. It is in reach wherever a time is printed: the block also answers to
//      pure:class-type / pure:bookings-card / pure:day-pager / pure:offline and
//      sits at the head of pure:clash, so each of those still evaluates alone.
//   3. The derived copy keeps working: "Free cancel until Sun 19:30", "Tomorrow
//      07:00", the clash line, the day strip's spoken dot, the usual week, the
//      offline queue's fallback label, the Time row's labels.
//   4. THE GUARD: no 12-hour marker may come back in shipped source — an 'am' /
//      'pm' literal, `% 12 || 12`, hour12: true, toLocaleTimeString, "7:00pm" in
//      a string. Comments are not code and are not read.
// The suite runs as a New York device (tests/unit.js): every expectation below
// is the class's own wall-clock digits, so the zone must not matter.
module.exports = function (t) {
  const { ok, eq } = t;
  const appSrc = t.readSource('js/app.js');
  const tabsSrc = t.readSource('js/tabs.js');

  // ════════════════════════════════════════════════════════════════════
  // 1. The formatter
  // ════════════════════════════════════════════════════════════════════
  t.section('10a: _clock24 — zero-padded 24-hour "HH:MM", from digits the caller already has');
  const c = t.loadPure('js/app.js', 'clock');
  ok(typeof c._clock24 === 'function' && typeof c._clockOf === 'function', 'pure:clock defines _clock24 and _clockOf (evaluated with no DOM / app globals)');
  eq([c._clock24(18, 30), c._clock24(6, 30), c._clock24(0, 0), c._clock24(12, 0), c._clock24(12, 5), c._clock24(23, 59), c._clock24(0, 5)],
    ['18:30', '06:30', '00:00', '12:00', '12:05', '23:59', '00:05'],
    'evening, morning, midnight, noon, five past noon, the last minute, five past midnight — the owner\'s "18:30", and two digits each side');
  eq([c._clock24('18', '30'), c._clock24('7', '5'), c._clock24('07', '05'), c._clock24(' 9 ', 0), c._clock24(18.9, 30.9)],
    ['18:30', '07:05', '07:05', '09:00', '18:30'], 'digits may arrive as text (the start_at slices) or as fractions (floored, never rounded up an hour)');
  eq([c._clock24(NaN, NaN), c._clock24(null, null), c._clock24(undefined, 0), c._clock24('', ''), c._clock24(true, false), c._clock24([], {}),
    c._clock24(24, 0), c._clock24(25, 61), c._clock24(-1, 0), c._clock24(7, 60), c._clock24(7, -1), c._clock24(Infinity, 0), c._clock24('123', '0'),
    c._clock24('18"><img src=x>', '<b>'), c._clock24('1e1', '0'), c._clock24(7)],
  new Array(16).fill(''), 'anything that is not an hour 0–23 and a minute 0–59 is \'\' — the caller decides what to print (never "NaN:NaN", never null read as midnight, never markup)');
  ok(!/[ap]m/i.test([0, 6, 11, 12, 13, 18, 23].map((h) => c._clock24(h, 0)).join(' ')), 'no am / pm on any hour of the day');

  t.section('10a: _clockOf — the time of a class, cut from its wall-clock DIGITS');
  eq([c._clockOf('2026-09-21 18:30:00'), c._clockOf('2026-09-21T18:30:00'), c._clockOf('2026-09-21T06:05'), c._clockOf('18:30'), c._clockOf('2026-09-21T18:30:00+01:00'), c._clockOf('2026-09-21T18:30:00.000Z')],
    ['18:30', '18:30', '06:05', '18:30', '18:30', '18:30'], 'the space form, the T form, no seconds, a bare time, an offset or Z after it: the digits as written');
  eq([c._clockOf(''), c._clockOf(null), c._clockOf(undefined), c._clockOf('soon'), c._clockOf('2026-09-21'), c._clockOf('2026-09-21 25:00:00'), c._clockOf(1789736400000)],
    ['', '', '', '', '', '', ''], 'nothing readable → \'\' (a date alone, an impossible hour, an epoch number: never a guess)');
  // The UK clocks go forward on 29 March 2026 (01:00 → 02:00) and this process is on New York time:
  // a Date would move either reading. The digits do not.
  eq([c._clockOf('2026-03-29 01:30:00'), c._clockOf('2026-03-08 02:30:00'), c._clockOf('2026-10-25 01:30:00')], ['01:30', '02:30', '01:30'],
    'a time inside a clock change — London\'s or the device\'s — prints as written: no zone maths anywhere');
  {
    const block = appSrc.slice(appSrc.indexOf('// ── pure:clock:start'), appSrc.indexOf('// ── pure:clock:end'));
    const code = block.replace(/^\s*\/\/.*$/gm, '');
    ok(block.length > 0 && !/new Date|Date\.|Intl|window|document|getHours|toLocale/.test(code), 'the block parses no date, asks no zone and touches no DOM: digits in, text out');
    ok(!/^\s*(const|let|class)\s/m.test(code) && (code.match(/^function /gm) || []).length === 2,
      'two function declarations and nothing else at the top level — a suite may evaluate two of the blocks that carry it in ONE context');
  }

  // ════════════════════════════════════════════════════════════════════
  // 2. In reach wherever a time is printed
  // ════════════════════════════════════════════════════════════════════
  t.section('10a: the formatter rides with every pure block that prints a time');
  {
    const carriers = {
      'class-type': { getCategory: () => null }, 'bookings-card': {}, 'day-pager': {}, clash: {},
      offline: { escapeHTML: String, slotLabel: () => 'Bike' },
    };
    Object.keys(carriers).forEach((name) => {
      const ctx = t.loadPure('js/app.js', name, carriers[name]);
      eq([typeof ctx._clock24, typeof ctx._clockOf, ctx._clock24(18, 30)], ['function', 'function', '18:30'], 'pure:' + name + ' evaluated on its own has it');
    });
    // Three suites cut pure:clash out by its FIRST start marker and its first end marker.
    const firstClash = appSrc.slice(appSrc.indexOf('// ── pure:clash:start'), appSrc.indexOf('// ── pure:clash:end'));
    ok(/\nfunction _clock24\(/.test(firstClash) && /\nfunction _clockOf\(/.test(firstClash) && /\nfunction _findClash\(/.test(firstClash) && /\nfunction _clashLabel\(/.test(firstClash),
      'that slice is still the real clash block — with the formatter at its head');
    // …and the FIRST pure:class-type region is still the pictograms + _ccTimeHTML (9a-foundation reads it for emoji).
    const firstCt = appSrc.slice(appSrc.indexOf('// ── pure:class-type:start'), appSrc.indexOf('// ── pure:class-type:end'));
    ok(/function _ccTimeHTML\(/.test(firstCt) && /var CLASS_PICTOGRAMS/.test(firstCt), 'the first pure:class-type region is unchanged');
    // Two carriers in one context (tests/suites/9d-bookings.js does this): a second declaration must not throw.
    const both = t.loadPure('js/app.js', 'bookings-card', { window: {} });
    let threw = '';
    try { t.vm.runInContext(appSrc.slice(appSrc.indexOf('// ── pure:clock:start'), appSrc.indexOf('// ── pure:clock:end')), both); } catch (e) { threw = String(e && e.message); }
    eq([threw, both._clock24(7, 0)], ['', '07:00'], 'declared twice in one context: no "already declared", same answer');
    // Callers in the page reach it by NAME (tabs / features / reliability are later scripts): it must be a plain global.
    ok(/\nfunction _clock24\(hours, mins\) \{/.test(appSrc) && /\nfunction _clockOf\(startAt\) \{/.test(appSrc), 'both are top-level function declarations of js/app.js — globals in the page');
    ok(/checkType\('_clock24', 'function'\);/.test(t.readSource('tests/smoke.html')) && /checkType\('_clockOf', 'function'\);/.test(t.readSource('tests/smoke.html')),
      'tests/smoke.html checks both exist once every module has loaded');
  }

  // ════════════════════════════════════════════════════════════════════
  // 3. The copy that is built from a time
  // ════════════════════════════════════════════════════════════════════
  t.section('10a: the class card — "18:30" over "45 min" (the approved boards), no am / pm under the digits');
  {
    const ct = t.loadPure('js/app.js', 'class-type', { getCategory: () => null });
    eq(ct._ccTimeHTML({ hours: 18, mins: 30, duration: 45 }), '<div class="cc-time"><span class="cc-time-h">18:30</span><span class="cc-dur">45 min</span></div>', 'the time, then the duration ALONE');
    eq(ct._ccTimeHTML({ hours: 6, mins: 30, duration: 45 }).replace(/<[^>]+>/g, '|').replace(/\|+/g, '|'), '|06:30|45 min|', 'a morning class is zero-padded: every time is five digits, one narrow column');
    eq(ct._ccTimeHTML({ hours: 6, mins: 30 }), '<div class="cc-time"><span class="cc-time-h">06:30</span></div>', 'no duration known → the time alone, with no empty second line');
    eq(ct._ccTimeHTML({ hours: NaN, mins: 0, duration: 45 }).replace(/<[^>]+>/g, '|').replace(/\|+/g, '|'), '|--:--|45 min|', 'an unreadable time is still dashes');
    ok(!/cc-ampm|[^a-z][ap]m[^a-z]/.test(ct._ccTimeHTML({ hours: 18, mins: 30, duration: 45 })), 'nothing of the am / pm span is left');
  }

  t.section('10a: "Free cancel until Sun 19:30" — _cancelDeadline\'s label');
  {
    const gym = t.loadPure('js/app.js', 'gym-time', { window: {} });
    const card = t.loadPure('js/app.js', 'bookings-card', { window: gym.window });
    eq(card._cancelDeadline('2026-09-21T07:30:00', 0).label, 'Sun 19:30', 'a Monday 07:30 class: free until Sunday 19:30 (London wall clock, read in New York)');
    eq([card._cancelDeadline('2026-09-21 18:30:00', 0).label, card._cancelDeadline('2026-09-21T12:00:00', 0).label, card._cancelDeadline('2026-09-21T00:15:00', 0).label],
      ['Mon 06:30', 'Mon 00:00', 'Sun 12:15'], 'an evening class → 06:30 that morning; a noon class → 00:00; a class just after midnight → 12:15 the day before');
    // The 12-hour RULE is untouched: only how the deadline is printed changed.
    const d = card._cancelDeadline('2026-09-21T07:30:00', Date.UTC(2026, 8, 20, 18, 29));
    eq([d.insideWindow, card._cancelDeadline('2026-09-21T07:30:00', Date.UTC(2026, 8, 20, 18, 30)).insideWindow], [false, true], 'the cutoff itself is where it was: 19:30 BST = 18:30Z');
    const noResolver = t.loadPure('js/app.js', 'bookings-card');
    ok(/^[A-Z][a-z]{2} \d\d:\d\d$/.test(noResolver._cancelDeadline('2026-09-21T07:30:00', 0).label), 'with no London resolver (device-local fallback) the label has the same shape');
  }

  t.section('10a: countdown chip — "Tomorrow 07:00"; a countdown is not a clock time and is untouched');
  {
    const lines = appSrc.split('\n');
    const from = lines.findIndex((l) => l.startsWith('function getCountdownText('));
    const to = lines.findIndex((l, i) => i > from && l === '}');
    ok(from !== -1 && to !== -1, 'getCountdownText found (anchor moved?)');
    const ymd = (d) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
    const ctx = t.loadPure('js/app.js', 'bookings-card', { localDateStr: ymd });
    t.vm.runInContext(lines.slice(from, to + 1).join('\n'), ctx, { filename: 'js/app.js[getCountdownText]' });
    const chip = (start, now) => ctx.getCountdownText(new Date(start), new Date(now));
    eq([chip('2026-09-22T07:00:00', '2026-09-21T20:00:00'), chip('2026-09-22T18:30:00', '2026-09-21T09:00:00')], ['Tomorrow 07:00', 'Tomorrow 18:30'], 'tomorrow: the class\'s own time, 24-hour');
    eq([chip('2026-09-21T20:05:00', '2026-09-21T18:00:00'), chip('2026-09-21T18:40:00', '2026-09-21T18:00:00')], ['In 2h 5m', 'In 40min'], 'today: the countdown reads as before');
  }

  t.section('10a: the clash line, the day strip\'s spoken dot, the Time row');
  {
    const p = t.loadPure('js/app.js', 'clash');
    eq(p._clashLabel({ kind: 'overlap', start_at: '2026-09-21 07:00:00', typeName: 'Ride', locName: 'Oxford Circus' }), 'Clashes with your 07:00 Ride at Oxford Circus', 'copy unchanged — only the time\'s form');
    eq(p._clashLabel({ kind: 'overlap', start_at: '2026-09-21T18:30:00', typeName: 'Class', locName: '' }), 'Clashes with your 18:30 class', 'an evening class');
    eq(p._clashLabel({ kind: 'overlap', start_at: 'soon', typeName: 'Ride', locName: '' }), 'Clashes with your Ride', 'an unreadable time is left out, not printed as junk');
    ok(typeof p._clashTimeLabel === 'undefined', 'the clash block keeps no time formatter of its own');

    const P = t.loadPure('js/app.js', 'day-pager');
    const held = P._pagerHeldDays({ 1: { slots: [4] } }, { 1: { start_at: '2026-09-21 18:30:00', _typeName: 'Strength 45' } }, ['2026-09-21'], {});
    eq([held['2026-09-21'].time, P._pagerHeldSpoken(held['2026-09-21'])], ['18:30', '. You have Strength 45 at 18:30'], 'the dot, said: "You have Strength 45 at 18:30"');
    eq(P._pagerHeldDays({ 1: { slots: [4] } }, { 1: { start_at: '2026-09-21Txx:yy', _typeName: 'Ride' } }, ['2026-09-21'], {})['2026-09-21'].time, '', 'digits that are not digits: the dot stays, the time is left out');
    // (Wave 13: it words the release INSTANT that opens the day — Monday 12:00 London is 11:00 UTC in September.)
    eq(P._pagerOpensText(Date.UTC(2026, 8, 21, 11, 0, 0), '2026-09-19'), 'Booking usually opens Monday 21 September, 12:00', 'the release was already 24-hour');

    const D = t.loadPure('js/app.js', 'discover');
    eq(t.vm.runInContext('TIME_BANDS.map(function (b) { return [b.key, b.label, b.from, b.to]; })', D),
      [['early', 'Before 9:00', 0, 9], ['day', '9:00–17:00', 9, 17], ['evening', 'After 17:00', 17, 24]],
      'the Time row reads "Before 9:00 · 9:00–17:00 · After 17:00"; the band keys and hours — what is saved and what filters — are unchanged');
    eq([D._timeBandOf('2026-09-21T08:59:00'), D._timeBandOf('2026-09-21 09:00:00'), D._timeBandOf('2026-09-21T17:00:00')], ['early', 'day', 'evening'], '…and the bands cut where they did');
    const chips = t.loadPure('js/app.js', 'filter-summary');
    eq(chips._filterSummaryChips({ timeBands: ['evening'] }, { timeBands: t.vm.runInContext('TIME_BANDS', D) }).map((x) => x.label), ['After 17:00'], 'the collapsed Filters bar\'s chip follows the label');

    // The longer labels are about 416px in one line: on a 375 / 390 phone the row's
    // last control ("Available only") sat half off the edge. The Time row wraps.
    const fix = t.readSource('css/discover-layout-fix.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const open = fix.indexOf('#tab-discover #timePills {');
    const rule = open < 0 ? '' : fix.slice(open, fix.indexOf('}', open) + 1);
    ok(/flex-wrap:\s*wrap !important;/.test(rule) && /overflow-x:\s*visible;/.test(rule), 'the Time row wraps instead of scrolling sideways (two ids + !important: it has to beat redesign.css\'s `nowrap !important`)');
    ok(open >= 0 && fix.lastIndexOf('@media', open) < fix.lastIndexOf('\n}\n', open), '…at every width — the rule sits in no media block, so a phone gets it too');
    ok(/<div id="timePills" class="location-chips"><\/div>/.test(t.readSource('psycle-finder.html')), '…and #timePills is still the row it names');
  }

  t.section('10a: the other modules print through the same formatter');
  {
    const u = t.loadPure('js/tabs.js', 'usual-week-crisp', { _clock24: c._clock24 });
    eq([u._uwTime(18 * 60 + 30), u._uwTime(7 * 60), u._uwTime(0), u._uwTime('junk')], ['18:30', '07:00', '00:00', '00:00'], 'usual week: minutes after midnight → "18:30" (js/tabs.js _uwTime)');
    const gym = t.loadPure('js/app.js', 'gym-time', { window: {} });
    const q = t.loadPure('js/reliability.js', 'offline-queue', { _psycleClassStartMs: gym._gymClassStartMs, _clock24: c._clock24 });
    eq([q._queueFallbackLabel('2026-06-06T18:30:00'), q._queueFallbackLabel('2026-06-01 07:05:00')], ['a class on Sat 6 at 18:30', 'a class on Mon 1 at 07:05'], 'offline queue: the fallback name of a class (js/reliability.js)');

    // Every site that prints a time hands its digits to the formatter. Counted, not listed: a new
    // call site is welcome, a vanished one means somebody is formatting by hand again.
    const calls = (src) => (src.replace(/^\s*\/\/.*$/gm, '').match(/\b_clock(24|Of)\(/g) || []).length;
    const counts = { 'js/app.js': calls(appSrc), 'js/tabs.js': calls(tabsSrc), 'js/features.js': calls(t.readSource('js/features.js')), 'js/reliability.js': calls(t.readSource('js/reliability.js')) };
    ok(counts['js/app.js'] >= 16 && counts['js/tabs.js'] >= 6 && counts['js/features.js'] >= 2 && counts['js/reliability.js'] >= 1, 'call sites: ' + JSON.stringify(counts));
    const fn = (src, opener, closer) => { const ls = src.split('\n'); const a = ls.findIndex((l) => l.startsWith(opener)); const b = ls.findIndex((l, i) => i > a && l === closer); return a === -1 || b === -1 ? '' : ls.slice(a, b + 1).join('\n'); };
    const sites = {
      'the seat picker\'s header': [fn(appSrc, 'function showBikePicker(', '}'), /_timeStr = _clock24\(_d\.getHours\(\), _d\.getMinutes\(\)\)/],
      'the waitlist / claim / "Spot opened" class line': [fn(appSrc, 'function _waitlistClassLine(', '}'), /\$\{_clock24\(d\.getHours\(\), d\.getMinutes\(\)\)\}/],
      'the Booked sheet': [fn(appSrc, 'function showBookingConfirmation(', '}'), /\$\{_clock24\(d\.getHours\(\), d\.getMinutes\(\)\)\}/],
      // …as LONDON wall clock (_londonClock → _clock24): tests/suites/waitlist-polish.js reads the card abroad.
      'waitlist "accept by 17:45"': [fn(appSrc, 'function renderMyBookings(', '}') + fn(appSrc, 'function _londonClock(', '}'), /accept by \$\{_londonClock\(exMs\)\}[\s\S]*return _clock24\(p\.hour, p\.minute\);/],
      'Find similar': [fn(appSrc, 'window.findSimilar = function(eventId) {', '};'), /timeLabel = _clock24\(origDate\.getHours\(\), origDate\.getMinutes\(\)\)/],
      'Share a class': [fn(appSrc, 'window.shareClass = function(eventId) {', '};'), /timeLabel = _clock24\(dt\.getHours\(\), dt\.getMinutes\(\)\)/],
      'the class sheet\'s hero': [fn(appSrc, 'window.openClassDetail = function (eventId) {', '};'), /'<span class="cds-time t-time is-sheet">' \+ clock \+ '<\/span>'/],
      '"Book again?" hint': [fn(appSrc, 'function renderRebookHint() {', '}'), /timeStr = _clock24\(pred\.hour, pred\.minute\)/],
      'Saved copy · HH:MM': [fn(appSrc, 'function _snapshotLabel(', '}'), /hhmm = _clock24\(d\.getHours\(\), d\.getMinutes\(\)\)/],
      'Stats "Your usual slots" (Mondays ~07:00)': [fn(tabsSrc, '  function renderHabitSlots() {', '  }'), /timeLabel = _clock24\(s\.hour, topMinute\)/],
      'Stats "Your routine" (Fridays at 07:30)': [fn(tabsSrc, '  function renderRecommendations(', '  }'), /time: _clock24\(dt\.getHours\(\), dt\.getMinutes\(\)\)/],
      // The busiest hour at ITS most-voted minute ("18:30"), never a bare hour dressed as a time ("18:00"): tests/suites/year-review.js.
      'Year in review "Favourite time"': [fn(tabsSrc, '  function _computeYearReview(', '  }'), /favTime = _clock24\(Number\(topHour\[0\]\), topMinute\)/],
    };
    Object.keys(sites).forEach((name) => ok(sites[name][0] !== '' && sites[name][1].test(sites[name][0]), name + ' prints through _clock24'));
    ok(/<div class="instructor-class-time">\$\{_clock24\(dt\.getHours\(\), dt\.getMinutes\(\)\)\}<\/div>/.test(t.readSource('js/features.js')) && /timeStr = d \? _clock24\(d\.getHours\(\), d\.getMinutes\(\)\) : ''/.test(t.readSource('js/features.js')),
      'the instructor profile\'s rows and the history list (js/features.js) do too');
    // The digits each site reads are the ones it read before (CLAUDE.md → Gym time says which are the
    // class's own wall clock): this wave changed how a time is WRITTEN, not where it comes from.
    ok(/_ccTimeHTML\(\{ hours: dt\.getHours\(\), mins: dt\.getMinutes\(\), duration: evt\.duration \}\)/.test(fn(appSrc, 'function eventCard(', '}')), 'the card still hands _ccTimeHTML the reading it always did');
  }

  t.section('10a: the welcome\'s illustrations are 24-hour too');
  {
    const art = appSrc.slice(appSrc.indexOf('function _onboardMiniCard('), appSrc.indexOf('function _onboardPageHTML('));
    ok(art.length > 0 && /'07:00', 'Ride 45'/.test(art) && /'18:30', 'Strength 50'/.test(art) && /<span class="onboard-tile-time t-time">18:30<\/span>/.test(art), 'the mini cards and the time tile');
    ok(/Clashes with your 07:00 Ride 45/.test(art) && /Free cancel until Mon 19:00/.test(art), 'the clash line and the free-cancel line, as the app now prints them');
    ok(!/<span>\$\{ampm\}<\/span>|, ampm,/.test(art), 'no am / pm part is handed to a mini card');
  }

  // ════════════════════════════════════════════════════════════════════
  // 4. The guard
  // ════════════════════════════════════════════════════════════════════
  // Comments are not shipped copy ("10pm the evening before" explains a rule in
  // the waitlist block): code only. A small scanner rather than a regex, because
  // '//' also lives in URLs, strings and regex literals.
  function stripJsComments(src) {
    let out = '', i = 0;
    const n = src.length;
    let prev = ''; // last significant character of code, to tell a regex literal from a division
    while (i < n) {
      const ch = src[i], next = src[i + 1];
      if (ch === '/' && next === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (ch === '/' && next === '*') { const end = src.indexOf('*/', i + 2); i = end === -1 ? n : end + 2; out += ' '; continue; }
      if (ch === '\'' || ch === '"' || ch === '`') {
        let j = i + 1;
        while (j < n && src[j] !== ch) { if (src[j] === '\\') j++; if (ch !== '`' && src[j] === '\n') break; j++; }
        out += src.slice(i, j + 1); i = j + 1; prev = ch; continue;
      }
      if (ch === '/' && (prev === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev) || /\breturn$|\btypeof$/.test(out.slice(-7).trimEnd()))) {
        // a regex literal: to its closing slash on this line ([...] may hold a bare '/')
        let j = i + 1, inClass = false, closed = false;
        while (j < n && src[j] !== '\n') {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '[') inClass = true; else if (src[j] === ']') inClass = false;
          else if (src[j] === '/' && !inClass) { closed = true; break; }
          j++;
        }
        if (closed) { out += src.slice(i, j + 1); i = j + 1; prev = '/'; continue; }
      }
      out += ch;
      if (!/\s/.test(ch)) prev = ch;
      i++;
    }
    return out;
  }
  const MARKERS = [
    ['an \'am\' / \'pm\' string literal', /(['"`])\s*[ap]\.?m\.?\s*\1/i],
    ['hour % 12 || 12', /%\s*12\s*\|\|\s*12/],
    ['hour >= 12 ? … (picking am / pm)', />=?\s*1[12]\s*\?\s*['"`]\s*[ap]m/i],
    ['hour12: true', /hour12\s*:\s*true/],
    ['a 12-hour hourCycle', /hourCycle\s*:\s*['"`]h1[12]['"`]/],
    ['toLocaleTimeString (the device\'s own 12 / 24-hour setting)', /toLocaleTimeString\s*\(/],
    ['a time written with am / pm ("7:00pm", "6 pm")', /\b\d{1,2}(?::\d{2})?\s?[ap]\.?m\b/i],
  ];
  const find12h = (code) => {
    const hits = [];
    code.split('\n').forEach((line, i) => MARKERS.forEach((m) => { if (m[1].test(line)) hits.push((i + 1) + ': ' + m[0] + ' — ' + line.trim().slice(0, 120)); }));
    return hits;
  };

  t.section('10a: the guard can see what it is looking for');
  {
    const bait = [
      'var t = (h % 12 || 12) + ":" + mm + (h >= 12 ? "pm" : "am");',
      'const ampm = hours >= 12 ? \'pm\' : \'am\';',
      'el.textContent = `Free cancel until Mon 7:00pm`;',
      'label: "After 5pm",',
      'd.toLocaleTimeString("en-GB")',
      'new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: true })',
      'new Intl.DateTimeFormat("en-GB", { hourCycle: "h12" })',
    ];
    bait.forEach((line) => ok(find12h(stripJsComments(line)).length > 0, 'caught: ' + line));
    const fine = [
      '// "After 10pm the evening before", for a 6–9am class with `leftMs` to go.',
      '/* it read "6:30pm" on one tab */ var x = 1;',
      'var s = "Free cancel until Sun 19:30"; // was 7:30pm',
      'new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hourCycle: "h23", hour: "2-digit" })',
      'var url = "https://example.com/a"; var program = team % 12; var m = /[T ](\\d{2}):(\\d{2})/.exec(s);',
      'var ok = /^https?:\\/\\//.test(u) ? "spam" : "10 items"; // 9am',
      '<div class="skeleton-bar sk-time-ampm"></div>',
    ];
    fine.forEach((line) => eq(find12h(stripJsComments(line)), [], 'not a marker: ' + line));
    eq(stripJsComments('a = 1; // gone\nb = "// kept"; /* gone */ c = `// kept ${x}`;\n').replace(/\s+/g, ' ').trim(), 'a = 1; b = "// kept"; c = `// kept ${x}`;', 'comments go; a "//" inside a string or a template stays');
  }

  t.section('10a: no 12-hour marker in shipped source');
  {
    const jsFiles = t.fs.readdirSync(t.JS_DIR).filter((f) => f.endsWith('.js')).sort().map((f) => 'js/' + f).concat(['ios-app/www/native-bridge.js', 'sw.js']);
    ok(jsFiles.length >= 16, 'every module is read (' + jsFiles.length + ' files)');
    jsFiles.forEach((file) => eq(find12h(stripJsComments(t.readSource(file))), [], file + ': every time it prints is 24-hour'));
    ['psycle-finder.html', 'login.html', 'index.html'].forEach((file) => {
      const html = t.readSource(file).replace(/<!--[\s\S]*?-->/g, '');
      // Inline scripts lose their comments like any module; the markup around them is read as it stands.
      const code = html.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (m, a, body, z) => a + stripJsComments(body) + z);
      eq(find12h(code), [], file + ': no 12-hour time in the page or its inline scripts');
    });
    // The am / pm parts the markup used to carry are gone with their look (css/crisp.css).
    const crisp = t.readSource('css/crisp.css').replace(/\/\*[\s\S]*?\*\//g, '');
    ok(!/\.cc-ampm|\.cds-ampm|\.instructor-class-ampm|\.class-time-ampm/.test(crisp), 'css/crisp.css styles no am / pm part any more');
    ok(!/cc-ampm|cds-ampm|instructor-class-ampm|class-time-ampm/.test(stripJsComments(appSrc) + stripJsComments(tabsSrc) + stripJsComments(t.readSource('js/features.js'))), '…and no module prints one');
  }
};
