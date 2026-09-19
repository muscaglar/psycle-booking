'use strict';
// Wave 9d — My Bookings, "Your usual week" and the next-class pill in the Crisp
// Colour design. What is held here:
//   • the card's own decisions (js/app.js pure:bookings-crisp): the day label,
//     which actions stay on the card and which sit behind "More", the More
//     button's name, the menu's arrow keys, the plan-usage line and its bar;
//   • the SHIPPED renderMyBookings / saved-copy painter / updatePill /
//     toggleBookingMore / findSimilar, sliced out of the source and run against
//     fakes — the markup the booking flows, the swipe and the other suites read
//     is still there, and the new markup is deterministic;
//   • css/crisp.css's 9d section: scoped so it cannot leak into Discover's
//     cards, the menu driven by aria-expanded alone, the pill never over the
//     last card's actions, tap targets, focus rings, the inks a tint guarantees.
// Nothing here can reach Psycle: every function runs in a bare vm context.
module.exports = function (t) {
  const { ok, eq } = t;
  const appSrc = t.readSource('js/app.js');
  const tabsSrc = t.readSource('js/tabs.js');
  const settingsSrc = t.readSource('js/settings.js');
  const crispCss = t.readSource('css/crisp.css');
  const themeCss = t.readSource('css/theme.css');
  const lines = appSrc.split('\n');
  // Top-level functions in app.js open at column 0 and close with a bare "}".
  const grab = (opener, closer) => {
    const from = lines.findIndex((l) => l.startsWith(opener));
    const to = lines.findIndex((l, i) => i > from && l === (closer || '}'));
    if (from === -1 || to === -1) throw new Error('9d-bookings suite: cannot slice "' + opener + '" (anchor moved?)');
    return lines.slice(from, to + 1).join('\n');
  };
  // Every region of one name, joined — what t.loadPure evaluates.
  const region = (source, name) => {
    const startTag = '// ── pure:' + name + ':start', endTag = '// ── pure:' + name + ':end';
    const out = [];
    let from = 0;
    for (;;) {
      const s = source.indexOf(startTag, from);
      if (s === -1) break;
      const e = source.indexOf(endTag, s);
      if (e === -1) throw new Error('9d-bookings suite: pure:' + name + ' has no end marker');
      out.push(source.slice(s, e));
      from = e + endTag.length;
    }
    if (!out.length) throw new Error('9d-bookings suite: no pure:' + name + ' markers');
    return out.join('\n');
  };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const pinnedDate = (nowMs) => class PinnedDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(nowMs); }
    static now() { return nowMs; }
  };

  // ════════════════════════════════════════════════════════════════════
  // 1. The card's decisions (pure:bookings-crisp)
  // ════════════════════════════════════════════════════════════════════
  const core = t.loadPure('js/app.js', 'core', { window: {} });
  const p = t.loadPure('js/app.js', 'bookings-crisp', { _plural: core._plural });

  t.section('9d: the day on the card is read off the digits ("Thu 24"), never the device zone');
  {
    eq([p._mbShortDay('2026-09-24'), p._mbShortDay('2026-09-24T18:30:00'), p._mbShortDay('2026-09-24 18:30:00')], ['Thu 24', 'Thu 24', 'Thu 24'],
      'a London date in either start_at form → "Thu 24" (the runner is in New York: a device-local read of midnight would say Wed 23)');
    eq([p._mbShortDay('2026-10-01'), p._mbShortDay('2026-01-05'), p._mbShortDay('2028-02-29')], ['Thu 1', 'Mon 5', 'Tue 29'], 'no leading zero; a leap day is a day');
    eq([p._mbShortDay('2026-02-31'), p._mbShortDay('soon'), p._mbShortDay(null), p._mbShortDay(undefined), p._mbShortDay('')], ['', '', '', '', ''],
      'a date that is no date prints nothing — never "Invalid Date" or a rolled-over day');
    ok(/const dayLabel = _mbShortDay\(day\);/.test(appSrc) && !/class="mb-day-header"/.test(appSrc),
      'renderMyBookings puts it on the card; the day headings are gone (each card carries its own day)');
  }

  t.section('9d: the primary and ONE companion stay on the card; the rest sit behind More');
  {
    const plan = (f) => { const r = p._mbActionPlan(f); return [r.primary, r.secondary, r.inline, r.more]; };
    eq(plan({ seats: 1, canChange: true, hasMap: true }), ['cancel', 'change', [], ['add', 'similar', 'map', 'share']],
      'one seat, outside 12h: Cancel + Change spot on the card; Add spot · Find similar · Map · Share behind More, in that order');
    eq(plan({ seats: 2, canChange: true, hasMap: true }), ['cancel', 'change', [], ['similar', 'map', 'share']], 'two seats held: no "Add spot" (as before: only while fewer than 2)');
    eq(plan({ seats: 1, canChange: false, hasMap: true }), ['cancel', null, [], ['add', 'similar', 'map', 'share']], 'inside the late-cancel window: no Change spot (the ONE 12h cutoff)');
    eq(plan({ seats: 0, canChange: true, hasMap: true }), ['cancel', null, [], ['add', 'similar', 'map', 'share']], 'a no-layout space has no seat to change, but another space can be added');
    eq(plan({ seats: 1, canChange: true, hasMap: false }), ['cancel', 'change', [], ['add', 'similar', 'share']], 'no address on file: no Map');
    eq(plan({ place: true, hasMap: true }), ['leave', 'check', [], ['similar', 'map']], 'a waitlist place: Leave leads, Check for a spot beside it; no Add spot / Share (there is no seat, and "I\'m going" is untrue)');
    eq(plan({ place: true, checkFirst: true, hasMap: true }), ['check', 'leave', [], ['similar', 'map']], 'offers phase: Check for a spot leads, Leave drops beside it');
    eq(plan({ place: true, offerOpen: true, hasMap: true }), ['claim', 'leave', [], ['similar', 'map']], 'an offer showing: Claim spot leads');
    eq(plan({ place: true, offerOpen: true, checkFirst: true }).slice(0, 2), ['claim', 'leave'], 'an offer outranks the phase');
    eq(plan({ place: true, hasMap: false }), ['leave', 'check', ['similar'], []], 'a menu of one is no menu: the lone overflow action goes on the card');
    eq(plan(undefined), ['cancel', null, [], ['add', 'similar', 'share']], 'no facts at all: a plain seat card, no throw');
    const all = [{ seats: 1, canChange: true, hasMap: true }, { seats: 3 }, { place: true }, { place: true, offerOpen: true, hasMap: true }].map((f) => p._mbActionPlan(f));
    ok(all.every((r) => r.more.length !== 1 && r.inline.length <= 1 && r.inline.every((k) => r.more.indexOf(k) === -1)), 'More never holds exactly one action, and nothing is listed twice');
    ok(all.every((r) => r.more.indexOf('change') === -1 && r.more.indexOf('cancel') === -1 && r.more.indexOf('leave') === -1 && r.more.indexOf('claim') === -1),
      'nothing that spends or gives up a seat is ever hidden in the menu');
  }

  t.section('9d: the More button says what is behind it; the menu steps with the arrow keys');
  {
    eq(p._mbMoreName('RIDE: 45', ['add', 'similar', 'map', 'share']), 'More for RIDE: 45: add spot, find similar, map, share', 'the board\'s name, built from the real items');
    eq(p._mbMoreName('YOGA: Flow', ['similar', 'map']), 'More for YOGA: Flow: find similar, map', 'a place lists only what it has');
    eq([p._mbMoreName('', []), p._mbMoreName(null, ['bogus'])], ['More for this class', 'More for this class'], 'no name / unknown keys: still a usable name');
    const step = p._mbMoreKeyStep;
    eq([step('ArrowDown', 0, 4), step('ArrowRight', 1, 4), step('ArrowDown', 3, 4)], [1, 2, 0], 'Down / Right: next, wrapping at the end');
    eq([step('ArrowUp', 0, 4), step('ArrowLeft', 2, 4)], [3, 1], 'Up / Left: previous, wrapping at the start');
    eq([step('Home', 2, 4), step('End', 0, 4)], [0, 3], 'Home / End');
    eq([step('ArrowDown', -1, 4), step('ArrowUp', -1, 4)], [0, 3], 'focus still on the More button: Down enters at the first item, Up at the last');
    eq([step('Tab', 0, 4), step('a', 0, 4), step('Escape', 0, 4), step('ArrowDown', 0, 0)], [null, null, null, null], 'any other key — and an empty menu — is not ours');
  }

  t.section('9d: plan usage — "8 of 12 this month · Resets 12 Oct"');
  {
    const DAY = 86400000, from = Date.UTC(2026, 8, 12);
    eq([p._mbPeriodWord(from, from + 30 * DAY), p._mbPeriodWord(from, from + 28 * DAY), p._mbPeriodWord(from, from + 31 * DAY)], ['month', 'month', 'month'], 'a 28–31 day period is a month');
    eq([p._mbPeriodWord(from, from + 7 * DAY), p._mbPeriodWord(from, from + 14 * DAY), p._mbPeriodWord(from, from + 365 * DAY)], ['week', 'period', 'period'], 'a week is a week; anything else is a "period", not a guess');
    eq([p._mbPeriodWord(NaN, from), p._mbPeriodWord(from, from), p._mbPeriodWord(from, from - DAY), p._mbPeriodWord()], ['period', 'period', 'period', 'period'], 'unknown or backwards dates: "period"');
    const m = (o) => p._mbUsageModel(Object.assign({ startMs: from, endMs: from + 30 * DAY, resetLabel: '12 Oct' }, o));
    eq(m({ made: 8, max: 12 }), { num: '8 of 12', rest: 'this month', when: 'Resets 12 Oct', bar: { segments: 12, filled: 8 } }, 'the board\'s line, one segment per class');
    eq(m({ made: '8', max: '12' }).num, '8 of 12', 'counts arrive from the API as strings too');
    eq(m({ made: 13, max: 12 }).bar, { segments: 12, filled: 12 }, 'over the cap (a credit on top): the bar is simply full');
    eq(m({ made: 9, max: 30 }).bar, { pct: 30 }, 'more than 16 classes: a plain fill, not 30 slivers');
    eq(m({ made: 2, max: 12, next: true, resetLabel: '12 Oct' }), { num: '2 of 12', rest: 'next month', when: 'From 12 Oct', bar: { segments: 12, filled: 2 } }, 'the period after this one: "next month · From …"');
    eq(m({ made: 3, max: 0 }), { num: '3', rest: 'classes booked this month', when: 'Renews 12 Oct', bar: null }, 'no cap: a count, no bar, and "Renews" (nothing resets)');
    eq(m({ made: 1, max: 0 }).rest, 'class booked this month', '…worded through _plural ("1 class")');
    eq(m({ made: 0, max: 0 }), { num: 'Unlimited', rest: 'this month', when: 'Renews 12 Oct', bar: null }, 'nothing booked on an uncapped plan');
    eq(m({ made: 8, max: 12, resetLabel: '' }).when, '', 'no date known: no "Resets" with nothing after it');
    eq([p._mbUsageModel({ credits: 5 }), p._mbUsageModel({ credits: 1 }).rest, p._mbUsageModel({ credits: -2 }).num],
      [{ num: '5', rest: 'credits left', when: '', bar: null }, 'credit left', '0'], 'a credit pack: "5 credits left" / "1 credit left", never negative');
    eq(p._mbUsageModel().num, 'Unlimited', 'no input: no throw');

    const html = p._mbUsageHtml(m({ made: 8, max: 12 }), esc);
    eq([(html.match(/<i class="is-on"><\/i>/g) || []).length, (html.match(/<i><\/i>/g) || []).length], [8, 4], 'markup: 8 lit segments of 12');
    ok(/<span class="mb-usage-num">8 of 12<\/span> this month<\/span><span class="mb-usage-when">Resets 12 Oct<\/span>/.test(html), '…the numerals in a span of their own (the display face)');
    ok(/class="sub-progress mb-usage-bar is-segmented" aria-hidden="true"/.test(html), '…and the bar is aria-hidden: it repeats the words beside it');
    const fill = p._mbUsageHtml({ num: 'x', rest: '', when: '', bar: { pct: 250 } }, esc);
    ok(/style="width:100%"/.test(fill) && /aria-hidden="true"/.test(fill), 'a plain fill is clamped to 100%');
    ok(p._mbUsageHtml({ num: '<b>', rest: '"x"', when: '<i>', bar: null }, esc).indexOf('<b>') === -1, 'every label goes through the escaper it is handed');
    ok(!/mb-usage-bar/.test(p._mbUsageHtml(m({ made: 3, max: 0 }), esc)), 'no cap → no bar at all');
    ok(/_plural\(made, 'class', 'classes'\) \+ ' booked'/.test(appSrc), 'the uncapped count still goes through _plural (tests/suites/copy.js holds the same line)');
    ok(!/Membership: \$\{escapeHTML\(planName\)\}/.test(appSrc) && !/<span class="mb-period-chevron">▼<\/span>/.test(appSrc), 'the old "Membership: <plan> · 8/12 classes" bar and its ▼ glyph are gone');
  }

  // ════════════════════════════════════════════════════════════════════
  // 2. The SHIPPED renderMyBookings
  // ════════════════════════════════════════════════════════════════════
  const wlBlock = appSrc.slice(appSrc.indexOf('// ── waitlist:pure:start'), appSrc.indexOf('// ── waitlist:pure:end'));
  const renderSrc = grab('function renderMyBookings(');
  const NOW = '2026-09-21T13:00:00'; // device-local throughout, like the card's own new Date(evt.start_at)
  const evt = (o) => Object.assign({ duration: 45, studio_id: 4, instructor_id: 31, _instrName: 'Alex', _locName: 'Bank', _studioName: 'Studio 1' }, o);
  const seat = (slots, ids) => ({ bookingId: ids[0], bookingIds: ids, slots, slotBookings: Object.fromEntries(slots.map((s, i) => [s, ids[i] || ids[0]])), waitlisted: false });
  const place = (id) => ({ bookingId: null, slots: [], slotBookings: {}, waitlisted: true, waitlist: { id, status: 'waiting', expiresAt: null } });
  function world(o) {
    o = o || {};
    const els = {};
    const el = (id) => els[id] || (els[id] = { style: {}, textContent: '', innerHTML: '' });
    const ctx = t.loadPure('js/app.js', 'bookings-card', {
      Date: pinnedDate(new Date(o.now || NOW).getTime()),
      window: {},
      document: { getElementById: el },
      localStorage: { getItem: () => null },
      currentUser: { id: 7, stats: {} },
      escapeHTML: esc,
      instrLink: (name) => (name ? '<span class="instructor-link" role="button" tabindex="0">' + esc(name) + '</span>' : ''),
      localDateStr: (d) => [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'),
      getCountdownText: () => 'In 5h',
      _myBookings: o.bookings,
      _eventCache: o.events,
    });
    t.vm.runInContext('var _activeSubscription = ' + JSON.stringify(o.sub || null) + ', _showPastBookings = ' + (o.showPast ? 'true' : 'false') +
      ", _bookingsLoadState = 'loaded', _waitlistsUnavailable = false;\n" +
      // The REAL category map + pictograms (pure:core, pure:class-type): data-ct and the tile are what ship.
      region(appSrc, 'core') + '\n' + region(appSrc, 'class-type') + '\n' +
      'function slotLabelForEvent(id) { var e = _eventCache[String(id)]; return e ? slotLabel(e._typeName) : "Spot"; }\n' +
      wlBlock + '\n' + region(appSrc, 'bookings-started') + "\nfunction _gymClassStartMs(s) { return new Date(String(s).replace(' ', 'T')).getTime(); }\n" +
      renderSrc, ctx, { filename: 'js/app.js[9d renderMyBookings]' });
    ctx.renderMyBookings();
    const html = el('upcomingList').innerHTML;
    const cards = {};
    html.split('<div class="class-card ').slice(1).forEach((chunk) => {
      const id = (/ data-id="(\d+)"/.exec(chunk) || [])[1];
      if (id) cards[id] = '<div class="class-card ' + chunk;
    });
    return { ctx, html, cards, count: el('upcomingCount').textContent };
  }
  const BOOKINGS = { 70: place(900), 77: seat([7], ['A']), 78: seat([21, 22], ['B', 'C']), 79: { bookingId: 'E', bookingIds: ['E', 'F'], slots: [], slotBookings: {}, waitlisted: false }, 80: place(901) };
  const EVENTS = {
    70: evt({ id: 70, start_at: '2026-09-21T17:00:00', _typeName: 'HIIT: Circuit' }),
    77: evt({ id: 77, start_at: '2026-09-21T18:00:00', _typeName: 'RIDE: 45' }),
    78: evt({ id: 78, start_at: '2026-09-23T09:30:00', _typeName: 'STRENGTH: Lower Body <b>' }),
    79: evt({ id: 79, start_at: '2026-09-24 07:15:00', _typeName: 'YOGA: Flow', duration: 60 }),
    80: evt({ id: 80, start_at: '2026-09-25T10:00:00', _typeName: 'REFORMER: Signature 55', _locName: '', _studioName: '', _instrName: '' }),
  };

  t.section('9d: the REAL card — tinted by class type, time first, the hooks other code reads still there');
  {
    const w = world({ bookings: BOOKINGS, events: EVENTS });
    eq(Object.keys(w.cards), ['70', '77', '78', '79', '80'], 'five cards, in start order');
    eq(w.count, '3 + 2 waitlist', 'the header count is untouched');
    const c77 = w.cards[77];
    ok(/^<div class="class-card ct-card is-booked glow-mine-card is-late my-booking-card" data-id="77" data-ct="ride" data-studio-id="4"\s+onclick="openClassDetail\(77\)"/.test(c77),
      'root: .class-card.ct-card … .my-booking-card LAST, data-id first, data-ct from the class type, the tap still opens the class sheet');
    eq(['70', '77', '78', '79', '80'].map((id) => (/data-ct="([a-z]+)"/.exec(w.cards[id]) || [])[1]), ['hiit', 'ride', 'strength', 'yoga', 'pilates'],
      'colour means class type: HIIT, Ride, Strength, Yoga, Reformer (= pilates)');
    ok(/<div class="cc-time mb-when"><span class="mb-day">Mon 21<\/span><span class="cc-time-h">18:00<\/span><span class="cc-dur">45 min<\/span><\/div>/.test(c77),
      'when: its day, then the SHARED time block (_ccTimeHTML) — the 24-hour time over "45 min", exactly what Discover prints for this class');
    ok(/<div class="cc-head mb-title"><span class="ct-tile" aria-hidden="true"><svg class="ct-pic" width="18" height="18"[^>]*aria-hidden="true"[^>]*>.*?<\/svg><\/span><span class="cc-name mb-name" role="button" tabindex="0">RIDE: 45<\/span><\/div>/.test(c77),
      'title: the shared title row (.cc-head > .ct-tile + .cc-name) — a button a keyboard can reach, like Discover\'s; mb-title / mb-name are only hooks');
    ok(!/class-time-ampm|mb-time|mb-dur|t-title/.test(w.html), 'nothing is left of the second time block (its own digits, the duration on a line of its own)');
    // ONE component: the meta line is the shared class card's (.cc-sub · .cc-who ·
    // .cc-loc, crisp 9b.7 — the structure Discover's eventCard prints). The "·" is
    // not text at all: css draws it in the gap and clips it when the place wraps,
    // so a line neither ENDS nor starts on a bare dot (riding with the instructor,
    // it ended every card's first line: the place here always wraps).
    ok(/<div class="class-instructor cc-sub mb-meta"><span class="cc-who"><span class="instructor-link"[^>]*>Alex<\/span><\/span><span class="cc-loc class-location">Bank · Studio 1<\/span><\/div>/.test(c77),
      'meta: the shared line — who, then the place as one unit (it keeps the .class-location hook); no separator in the text');
    ok(c77.indexOf('mb-sep') === -1 && c77.indexOf('mb-instr') === -1, '…and nothing of the old in-text separator is left');
    ok(w.cards[80].indexOf('cc-who') === -1 && w.cards[80].indexOf('cc-loc') === -1 && /<div class="class-instructor cc-sub mb-meta"><\/div>/.test(w.cards[80]),
      'nothing known about who / where: neither unit is printed — an EMPTY .cc-loc would still draw its separator');
    ok(w.cards[78].indexOf('STRENGTH: Lower Body &lt;b&gt;') !== -1 && w.cards[78].indexOf('<b>') === -1, 'API text is escaped — in the title and in the More button\'s name');
    ok(!/[↻📍📅]|\+ Add spot/.test(w.html), 'no glyphs or emoji as UI: "Add spot", "Find similar", "Map"');
    ok(!/style="margin-top:8px"|style="opacity:0\.5"|btn-ghost/.test(w.html), 'the inline styles are gone (the look lives in css/crisp.css)');
    eq(world({ bookings: BOOKINGS, events: EVENTS }).html, w.html, 'deterministic: the same state builds byte-identical HTML (what _commitBookingsHtml\'s skip relies on)');
  }

  t.section('9d: the glow is sparing — the NEXT class you hold a seat in, and nothing else');
  {
    const w = world({ bookings: BOOKINGS, events: EVENTS });
    eq(Object.keys(w.cards).filter((id) => /glow-mine-card/.test(w.cards[id].split('>')[0])), ['77'], 'exactly one card glows: the first SEAT — not the waitlist place that starts before it');
    ok(/class="class-card ct-card is-dashed is-waitlisted my-booking-card"/.test(w.cards[70]), 'a place is the dashed card, and still .is-waitlisted (the swipe reads it to say "Leave")');
    const onlyPlaces = world({ bookings: { 70: place(900) }, events: EVENTS });
    ok(!/glow-mine-card/.test(onlyPlaces.html), 'only places held: nothing glows');
    const past = world({ bookings: { 60: seat([3], ['Z']), 78: seat([21, 22], ['B', 'C']) }, events: Object.assign({ 60: evt({ id: 60, start_at: '2026-09-21T09:00:00', _typeName: 'RIDE: 45' }) }, EVENTS), showPast: true });
    ok(/glow-mine-card/.test(past.cards[78].split('>')[0]) && !/glow-mine-card/.test(past.cards[60].split('>')[0]), 'a class that has started is not "next"');
    ok(/class="ct-badge is-seat is-past up-seat-chip">Bike 3</.test(past.cards[60]) && !/mb-actions|mb-more|<button/.test(past.cards[60]) && /Attended/.test(past.cards[60]),
      '…and a past card is read-only: an outlined seat, "Attended", no buttons at all');
    ok(/<div class="mb-past-toggle"><button type="button" class="mb-past-btn" onclick="togglePastBookings\(\)">Hide 1 past class<\/button><\/div>/.test(past.html), 'the past toggle, without its inline styles');
  }

  t.section('9d: actions — Cancel + one companion on the card, a real disclosure for the rest');
  {
    const w = world({ bookings: BOOKINGS, events: EVENTS });
    const actions = (c) => (/<div class="booking-actions mb-actions">(.*?)<\/div>\s*(<div class="booking-actions mb-more">|<\/div>)/s.exec(c) || [])[1] || '';
    const menu = (c) => (/<div class="mb-more-menu"[^>]*>(.*?)<\/div>/s.exec(c) || [])[1] || '';
    const labels = (s) => (s.match(/<button[^>]*>([^<]*)<\/button>/g) || []).map((b) => />([^<]*)</.exec(b)[1]);
    eq([labels(actions(w.cards[77])), labels(menu(w.cards[77]))], [['Cancel booking'], ['Add spot', 'Find similar', 'Map', 'Share']],
      'late-cancel window: Cancel alone on the card (no Change spot), four actions behind More');
    ok(/<span class="badge late-cancel-note">Late-cancel window<\/span>/.test(w.cards[77]) && !/mb-cancel-deadline/.test(w.cards[77]), '…with the ONE red badge instead of a "Free cancel until" line');
    eq([labels(actions(w.cards[78])), labels(menu(w.cards[78]))], [['Cancel all 2', 'Change spot'], ['Find similar', 'Map', 'Share']], 'two seats, days away: Cancel all 2 · Change spot; no Add spot in the menu');
    ok(/<div class="mb-cancel-deadline">Free cancel until <strong>Tue 21:30<\/strong><\/div>/.test(w.cards[78]), '"Free cancel until" with the deadline set apart (the 12h rule is _cancelDeadline\'s, untouched)');
    eq([labels(actions(w.cards[79])), labels(menu(w.cards[79]))], [['Cancel all 2'], ['Add spot', 'Find similar', 'Map', 'Share']], 'a no-layout class: no seat to change; another space can be added');
    eq([labels(actions(w.cards[70])), labels(menu(w.cards[70]))], [['Leave waitlist', 'Check for a spot'], ['Find similar', 'Map']], 'a place: Leave · Check on the card; Find similar · Map behind More');
    eq([labels(actions(w.cards[80])), /mb-more/.test(w.cards[80])], [['Leave waitlist', 'Check for a spot', 'Find similar'], false], 'a place with no address: the lone "Find similar" goes on the card — no one-item menu');

    const c = w.cards[78];
    const btn = /<button type="button" class="mb-more-btn" aria-expanded="false" aria-controls="(mbMore-78)" aria-label="([^"]*)" onclick="event\.stopPropagation\(\);toggleBookingMore\(this\)">/.exec(c) || [];
    eq([btn[1], btn[2]], ['mbMore-78', 'More for STRENGTH: Lower Body &lt;b&gt;: find similar, map, share'], 'the More button: aria-expanded + aria-controls, named for its class and contents, never bubbling to the card');
    ok(new RegExp('<div class="mb-more-menu" id="mbMore-78" role="group" aria-label="' + btn[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '">').test(c), '…controls a labelled group with that id (a disclosure: the same buttons are inline at desktop widths)');
    ok(!/role="menu"|role="menuitem"|aria-haspopup/.test(w.html), 'no ARIA menu roles it could not honour at desktop widths');
    ok(/<svg [^>]*aria-hidden="true"[^>]*><circle/.test(c.slice(c.indexOf('mb-more-btn'))), 'its three dots are decoration');
    ok(c.indexOf('class="booking-actions mb-actions"') < c.indexOf('class="booking-actions mb-more"'), 'More comes LAST in the markup: at desktop widths what is seen and what Tab reaches are in the same order');
    ok(/class="booking-actions mb-more"/.test(c), '.mb-more is a .booking-actions block: a touch that starts on it never begins a swipe-to-cancel (SWIPE_IGNORE_SELECTOR)');
    ok(/<button class="booking-action-btn" data-more-keep onclick="event\.stopPropagation\(\);bookClass\(77, this, 4\)" title="Add another spot">Add spot<\/button>/.test(w.cards[77]),
      'Add spot keeps the menu open (data-more-keep): bookClass shows its "…" on that very button');
    ok(/<button class="booking-action-btn find-similar-btn" onclick="event\.stopPropagation\(\);findSimilar\(77\)"/.test(w.cards[77]), 'Find similar keeps .find-similar-btn (findSimilar finds its card by it)');
    eq((menu(w.cards[77]).match(/data-more-keep/g) || []).length, 1, '…and is the only item that does');

    // The buttons the booking flows, the swipe and the older suites read — unchanged class for class.
    const primaries = (w.html.match(/<button class="book-btn( booked)? mb-primary-btn" onclick="event\.stopPropagation\(\);(\w+)\(\d+, this\)">[^<]*<\/button>/g) || []);
    eq(primaries.length, 5, 'every upcoming card has exactly one primary button, with the class string the flows and suites pin');
    ok(/class="ct-badge is-seat up-seat-chip">Bench 21<button onclick="event\.stopPropagation\(\);upcomingSeatCancel\(78, 21, this\)" title="Cancel Bench 21" aria-label="Cancel Bench 21">&times;<\/button><\/span>/.test(c),
      'seat chips: the class-colour badge, .up-seat-chip last, the class\'s own noun (a Strength class holds a Bench) and a × that is NAMED (it read "×" to a screen reader)');
    ok(/<span class="up-seats is-multi">/.test(c) && /<span class="up-seats">/.test(w.cards[77]) && !/upcomingSeatCancel/.test(w.cards[77]), 'a × only where another seat stays; that row is flagged for its tap targets');
    ok(/<span class="ct-badge is-seat up-seat-chip">2 spaces<\/span>/.test(w.cards[79]), '"2 spaces" for a count studio');
    ok(/<span class="mb-countdown" data-start="2026-09-21T18:00:00">In 5h<\/span>/.test(c77()), 'the countdown chip keeps class="mb-countdown" + data-start exactly (the minute tick and the HTML key read them)');
    function c77() { return w.cards[77]; }
  }

  t.section('9d: the plan-usage bar in the REAL render — one period, and two that fold');
  {
    // (Period bounds carry a time here so the labels do not depend on the runner's zone.)
    const one = world({ bookings: BOOKINGS, events: EVENTS, sub: { name: 'Monthly 12', max_bookings: 12, bookings_made: 8, period_start: '2026-09-01 00:00:00', period_end: '2026-10-01 00:00:00', upcoming_billing_periods: [] } });
    ok(/<div class="sub-bar mb-usage"><div class="mb-usage-text"><span class="mb-usage-count"><span class="mb-usage-num">8 of 12<\/span> this month<\/span><span class="mb-usage-when">Resets 1 Oct<\/span><\/div>/.test(one.html),
      'every class inside the period: "8 of 12 this month · Resets 1 Oct" (period_end IS the reset day)');
    ok(!/Monthly 12/.test(one.html) && !/mb-period-section/.test(one.html), '…the plan name is not repeated here (Membership has it), and nothing folds');
    const two = world({ bookings: BOOKINGS, events: EVENTS, sub: { name: 'Monthly 12', max_bookings: 12, bookings_made: 8, period_start: '2026-08-23 00:00:00', period_end: '2026-09-23 00:00:00', upcoming_billing_periods: [{ start: '2026-09-23 00:00:00', end: '2026-10-23 00:00:00' }] } });
    const bars = two.html.match(/<div class="mb-period-bar[^"]*" role="button" tabindex="0" aria-expanded="true" onclick="[^"]*">/g) || [];
    eq([(two.html.match(/<div class="mb-period-section">/g) || []).length, bars.length], [2, 2], 'a class after period_end: two sections, each bar still a reachable button that says it is expanded (_commitBookingsHtml re-folds them)');
    ok(/8 of 12<\/span> this month/.test(two.html) && /<span class="mb-usage-num">2 of 12<\/span> next month<\/span><span class="mb-usage-when">From 23 Sept?<\/span>/.test(two.html),
      'the next period counts its SEATS — classes 78 and 79, not the waitlist place beside them: "2 of 12 next month · From 23 Sep"');
    eq((two.html.match(/<span class="mb-period-chevron" aria-hidden="true"><svg /g) || []).length, 2, 'the fold mark is an aria-hidden stroke, not a "▼" character');
    const credits = world({ bookings: BOOKINGS, events: EVENTS });
    ok(!/mb-usage/.test(credits.html), 'no plan and no credits: no bar');
  }

  // ════════════════════════════════════════════════════════════════════
  // 3. The saved copy (pure:offline) wears the same card, read-only
  // ════════════════════════════════════════════════════════════════════
  t.section('9d: the saved copy is the same card with nothing on it that acts');
  {
    const off = t.loadPure('js/app.js', 'offline', { escapeHTML: esc, slotLabel: core.slotLabel });
    const items = [
      { id: '101', start_at: '2026-09-24 19:05:00', duration: 45, type: 'RIDE: 45', instructor: 'Alex <i>', location: 'Bank', studio: 'Studio 1', slots: [7, 8], spaces: 0, waitlisted: false },
      { id: '102', start_at: '2026-09-25T00:15:00', duration: 0, type: 'BARRE: 55', instructor: '', location: '', studio: '', slots: [], spaces: 0, waitlisted: true },
    ];
    const bare = off._savedBookingsHTML(items, 'Saved copy · 14:05', false);
    ok(/class="class-card ct-card is-booked my-booking-card is-saved-copy" data-ct="other"/.test(bare) && bare.indexOf('ct-tile') === -1,
      'evaluated on its own (no class-type helpers): the neutral colour and no tile — never a ReferenceError');
    t.vm.runInContext(region(appSrc, 'core').replace(/\bconst CATEGORY_MAP\b/, 'var CATEGORY_MAP') + '\n' + region(appSrc, 'class-type'), off, { filename: 'js/app.js[9d class-type]' });
    const html = off._savedBookingsHTML(items, 'Saved copy · 14:05', false);
    ok(/class="class-card ct-card is-booked my-booking-card is-saved-copy" data-ct="ride"/.test(html) && /class="class-card ct-card is-dashed is-waitlisted my-booking-card is-saved-copy" data-ct="barre"/.test(html),
      'in the app: tinted by class type, a place dashed');
    ok(/<div class="cc-time mb-when"><span class="mb-day">Thu 24<\/span><span class="cc-time-h">19:05<\/span><span class="cc-dur">45 min<\/span><\/div>/.test(html) &&
      /<div class="cc-time mb-when"><span class="mb-day">Fri 25<\/span><span class="cc-time-h">00:15<\/span><\/div>/.test(html),
      'day + the string\'s own wall-clock digits, 24-hour, in the shared time block; no duration known → the time alone');
    ok(bare.indexOf('cc-time') === -1, '…and evaluated on its own the block is simply absent (typeof-guarded, like the tile)');
    ok(/<div class="cc-head mb-title"><span class="ct-tile" aria-hidden="true"><svg/.test(html) && /<span class="cc-name mb-name">RIDE: 45<\/span>/.test(html), 'tile + title, in the shared title row');
    ok(/<div class="class-instructor cc-sub mb-meta"><span class="cc-who">Alex &lt;i&gt;<\/span><span class="cc-loc class-location">Bank · Studio 1<\/span><\/div>/.test(html) &&
      /<div class="class-instructor cc-sub mb-meta"><\/div>/.test(html) && html.indexOf('mb-sep') === -1,
      'the same shared meta line as the live card (.cc-sub · .cc-who · .cc-loc); who / where unknown → neither unit, so no separator is drawn');
    ok(!/role="button"|tabindex|<button(?![^>]*retrySavedBookings)|onclick="(?!retrySavedBookings)|data-id|mb-more|mb-actions/.test(html),
      'nothing acts: no role=button / tabindex on the title, no More, no actions, no data-id — only the note\'s Retry');
    ok(html.indexOf('Alex &lt;i&gt;') !== -1 && html.indexOf('<i>') === -1, 'stored text is escaped');
    ok(/<span class="up-seats"><span class="ct-badge is-seat up-seat-chip">Bike 7<\/span><span class="ct-badge is-seat up-seat-chip">Bike 8<\/span><\/span>/.test(html), 'seat chips in the class colour, without a ×');
    ok(!/mb-day-header/.test(html), 'no day headings here either');
  }

  // ════════════════════════════════════════════════════════════════════
  // 4. Your usual week (js/tabs.js)
  // ════════════════════════════════════════════════════════════════════
  t.section('9d: usual week — a compact class component per entry, coloured by the TYPE alone');
  {
    // _uwTime prints through app.js's ONE formatter (_clock24, pure:clock) — a global in the page, handed in here.
    const u = t.loadPure('js/tabs.js', 'usual-week-crisp', { _clock24: t.loadPure('js/app.js', 'clock')._clock24 });
    const ct = t.loadPure('js/app.js', 'core', { window: {} });
    t.vm.runInContext(region(appSrc, 'class-type'), ct, { filename: 'js/app.js[9d class-type]' });
    eq([u._uwTypeOf('RIDE: 45 · Maya Okafor'), u._uwTypeOf('YOGA: Flow'), u._uwTypeOf(''), u._uwTypeOf(null)], ['RIDE: 45', 'YOGA: Flow', '', ''], 'the label is "Type · Instructor": only the type is asked for a colour');
    eq([ct.classTypeKey('Sound Bath · Sam Barrett'), ct.classTypeKey(u._uwTypeOf('Sound Bath · Sam Barrett'))], ['barre', 'other'],
      'why: an instructor called Barrett made a Sound Bath a Barre class');
    eq(ct.classTypeKey(u._uwTypeOf('REFORMER: Signature 55 · Tom Alexandrou-Whitfield')), 'pilates', 'a reformer class is violet, whoever teaches it');
    eq([u._uwTime(18 * 60 + 30), u._uwTime(12 * 60 + 15), u._uwTime(0), u._uwTime(9 * 60 + 5)], ['18:30', '12:15', '00:00', '09:05'], 'minutes after midnight → the 24-hour time, zero-padded');
    eq([u._uwTime('junk'), u._uwTime(-5), u._uwTime(25 * 60)], ['00:00', '00:00', '01:00'], 'stored junk never prints NaN');
    ok(/return '<span class="t-time is-compact">' \+ _uwTime\(totalMin\) \+ '<\/span>';/.test(tabsSrc) && !/class-time-ampm|_uwTimeParts/.test(tabsSrc), 'the compact time is that string alone — no am / pm part is left to set small');
    const mark = u._uwClassMark('RIDE: 45', ct.classTypeKey, ct.classPictogram);
    ok(mark.key === 'ride' && /^<span class="ct-tile is-sm" aria-hidden="true"><svg class="ct-pic" width="15" height="15"/.test(mark.tile), 'the small tile with the 15px pictogram');
    eq(u._uwClassMark('RIDE: 45', null, null), { key: 'other', tile: '' }, 'tabs.js on its own (no app.js helpers): neutral, no tile, no throw');
    eq(u._uwClassMark('x', () => 'Ri"de onload=1', () => '').key, 'rideonload', 'whatever hands the key over, only a lower-case word reaches the attribute');

    const card = tabsSrc.slice(tabsSrc.indexOf('  function renderUsualWeekCard() {'), tabsSrc.indexOf('  window.renderUsualWeekCard = renderUsualWeekCard;'));
    ok(/'<li class="usual-week-entry ct-card" data-ct="' \+ mark\.key \+ '">'/.test(card) && /var mark = _uwMark\(_uwTypeOf\(label\)\);/.test(card), 'each entry is a tinted .ct-card with its data-ct');
    ok(/'<span class="usual-week-when"><span class="usual-week-day">' \+ escapeHTML\(day\) \+ '<\/span>' \+ _uwTimeHtml\(min\) \+ '<\/span>'/.test(card), 'day over the compact time');
    ok(/escapeHTML\('Remove ' \+ when \+ ' ' \+ label \+ ' from your usual week'\)/.test(card), 'the remove button keeps its full spoken name');
    ok(/class="week-template-btn week-template-book pill-btn pill-primary" onclick="bookTemplateWeek\(\)">Book my usual week</.test(card), 'the ONE primary: the graphite pill (and still .week-template-book — the sheet hands focus back to it)');
    ok(/class="week-template-btn pill-btn pill-quiet usual-week-clear" onclick="clearUsualWeek\(\)" aria-label="Clear your usual week">Clear</.test(card) &&
      card.indexOf('usual-week-clear') < card.indexOf('usual-week-list'), 'Clear sits in the head, named for what it clears (its visible word is part of that name)');
    ok(/<h2 class="usual-week-eyebrow t-heading">Your usual week<\/h2>/.test(card), 'a real heading');
    const row = tabsSrc.slice(tabsSrc.indexOf('  function _uwRowHtml('), tabsSrc.indexOf('  // Where focus goes when the sheet closes'));
    ok(/var mark = _uwMark\(row\.typeName \|\| _uwTypeOf\(en\.label\)\);/.test(row) && /'<li class="usual-week-row" data-ct="' \+ mark\.key \+ '">'/.test(row) && /_uwTimeHtml\(min\)/.test(row),
      'the confirm sheet\'s rows are the same compact component (the class the plan FOUND decides the colour)');
    ok(/escapeHTML\(name\)/.test(row) && /escapeHTML\(sub\)/.test(row) && /escapeHTML\(note\.text \|\| ''\)/.test(row) && /escapeHTML\(_uwDateLabel\(row\.date\)\)/.test(row), '…with every name still escaped');
    ok(/class="seg usual-week-switch" role="group" aria-label="Which week"/.test(tabsSrc) && /class="seg-btn usual-week-switch-btn'/.test(tabsSrc) && /aria-pressed="' \+ active \+ '"/.test(tabsSrc),
      'the week switch is the segmented primitive, lit off aria-pressed');
  }

  // ════════════════════════════════════════════════════════════════════
  // 5. The next-class pill (js/settings.js)
  // ════════════════════════════════════════════════════════════════════
  t.section('9d: the next-class pill — class tile + seat in the class colour, API text escaped');
  {
    const sl = settingsSrc.split('\n');
    const from = sl.findIndex((l) => l.startsWith('  function updatePill('));
    const to = sl.findIndex((l, i) => i > from && l === '  }');
    ok(from !== -1 && to > from, 'updatePill can be sliced');
    const run = (withHelpers) => {
      const NOWMS = new Date('2026-09-21T13:00:00').getTime();
      const pill = { innerHTML: '', hidden: true, classList: { add() { pill.hidden = true; }, remove() { pill.hidden = false; } } };
      const ctx = t.vm.createContext({
        Date: pinnedDate(NOWMS), Object, Math, isNaN, console,
        _myBookings: { 77: { bookingId: 'A', slots: [12, 15], waitlisted: false } },
        _eventCache: { 77: { id: 77, start_at: '2026-09-21T18:00:00', _typeName: 'RIDE: 45 <x>', _instrName: 'Al & Bo', _locName: 'Bank', _studioName: 'Studio 1' } },
        escapeHTML: esc, formatSlots: (l, n) => l + 's ' + n.join(' & '), slotLabelForEvent: () => 'Bike',
        _pillEl: pill, _pillA11y: (label) => { pill.label = label; },
      });
      if (withHelpers) t.vm.runInContext('var window = {};\n' + region(appSrc, 'core') + '\n' + region(appSrc, 'class-type'), ctx);
      t.vm.runInContext(sl.slice(from, to + 1).join('\n'), ctx, { filename: 'js/settings.js[updatePill]' });
      ctx.updatePill();
      return pill;
    };
    const pill = run(true);
    ok(!pill.hidden && /^<div class="ncp-body" data-ct="ride"><span class="ct-tile is-sm" aria-hidden="true"><svg class="ct-pic" width="15"/.test(pill.innerHTML),
      'data-ct rides on an inner wrapper (the pill itself is only ever handed markup), with the small class tile');
    ok(/<div class="ncp-countdown">5h 0m<\/div>/.test(pill.innerHTML), 'the countdown keeps class="ncp-countdown" exactly (tests/suites/3d-leftovers.js reads it)');
    ok(/<div class="ct-badge is-seat ncp-seat">Bikes 12 &amp; 15<\/div>/.test(pill.innerHTML), 'the seat is the class-colour badge — and is escaped now (it went in raw)');
    ok(pill.innerHTML.indexOf('RIDE: 45 &lt;x&gt; — Al &amp; Bo') !== -1, 'class and instructor escaped, as before');
    eq(pill.label, 'Next class in 5h 0m: RIDE: 45 <x> with Al & Bo, Bikes 12 & 15. View my bookings', 'its spoken name is unchanged (an attribute: plain text)');
    const bare = run(false);
    ok(/^<div class="ncp-body" data-ct="other"><div class="ncp-countdown">/.test(bare.innerHTML), 'settings.js without app.js: neutral, no tile, no ReferenceError');
  }

  // ════════════════════════════════════════════════════════════════════
  // 6. The More menu's behaviour, and the popup that hangs off the card
  // ════════════════════════════════════════════════════════════════════
  t.section('9d: More — aria-expanded is the ONLY thing that changes; focus in, focus back, one at a time');
  {
    const from = appSrc.indexOf('let _mbMoreOpen = null;'), to = appSrc.indexOf('window.toggleBookingMore = toggleBookingMore;');
    ok(from !== -1 && to > from, 'the menu functions can be sliced');
    const log = [];
    const mkBtn = (label, o) => Object.assign({ textContent: label, className: 'booking-action-btn', disabled: false, isConnected: true, focus(opts) { log.push(['focus', label, opts]); } }, o || {});
    const mkCard = (id, items) => {
      const attrs = {};
      const card = { attrs, setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } };
      const menu = { id: 'mbMore-' + id, querySelectorAll: (sel) => (sel === 'button' ? items : []) };
      const battrs = { 'aria-expanded': 'false', 'aria-controls': menu.id };
      const btn = { className: 'mb-more-btn', textContent: '', isConnected: true, attrs: battrs,
        getAttribute: (k) => battrs[k], setAttribute: (k, v) => { battrs[k] = String(v); }, closest: (sel) => (sel === '.my-booking-card' ? card : null), focus(opts) { log.push(['focus', 'More ' + id, opts]); } };
      return { card, menu, btn, items };
    };
    const a = mkCard(1, [mkBtn('Add spot', { disabled: true }), mkBtn('Find similar'), mkBtn('Map')]);
    const b = mkCard(2, [mkBtn('Find similar'), mkBtn('Share')]);
    const ctx = t.vm.createContext({ Array, document: { getElementById: (id) => ({ 'mbMore-1': a.menu, 'mbMore-2': b.menu }[id] || null) } });
    t.vm.runInContext(appSrc.slice(from, to) + '\nfunction __open() { return _mbMoreOpen; }', ctx, { filename: 'js/app.js[more menu]' });

    ctx.toggleBookingMore(a.btn);
    eq([a.btn.attrs['aria-expanded'], 'data-more-open' in a.card.attrs, log], ['true', true, [['focus', 'Find similar', { preventScroll: true }]]],
      'open: aria-expanded="true", the card raised over its neighbours, focus on the first item that is ENABLED — without scrolling the list');
    eq([a.btn.className, a.btn.textContent, a.items.map((i) => i.className + '|' + i.textContent)], ['mb-more-btn', '', ['booking-action-btn|Add spot', 'booking-action-btn|Find similar', 'booking-action-btn|Map']],
      'no class and no label was touched: _commitBookingsHtml\'s "every button as we left it" check still holds with a menu open');
    log.length = 0;
    ctx.toggleBookingMore(b.btn);
    eq([a.btn.attrs['aria-expanded'], 'data-more-open' in a.card.attrs, b.btn.attrs['aria-expanded'], log[0][1]], ['false', false, 'true', 'Find similar'], 'another card\'s More: the first closes, one menu at a time');
    log.length = 0;
    ctx.toggleBookingMore(b.btn);
    eq([b.btn.attrs['aria-expanded'], ctx.__open(), log], ['false', null, []], 'the same button again: closed (a plain toggle leaves focus where it is)');
    ctx.toggleBookingMore(a.btn);
    log.length = 0;
    ctx.closeBookingMore(true);
    eq([a.btn.attrs['aria-expanded'], log], ['false', [['focus', 'More 1', { preventScroll: true }]]], 'Escape / choosing an item: closed, focus handed BACK to the More button');
    ctx.closeBookingMore(true);
    eq(log.length, 1, 'closing a closed menu does nothing');
    ctx.toggleBookingMore(a.btn);
    a.btn.isConnected = false; // the list was rebuilt under the open menu
    log.length = 0;
    ctx.closeBookingMore(true);
    eq(log, [], 'a More button a rebuild took away is never focused');
    eq(ctx.toggleBookingMore({ getAttribute: () => 'nope' }), undefined, 'a button whose menu is not in the page: no throw');

    const listeners = appSrc.slice(to, appSrc.indexOf("// ── Open a booking's studio in the maps app"));
    ok(/document\.addEventListener\('click', e => \{[\s\S]*?\}, true\);/.test(listeners) && /if \(item && !item\.hasAttribute\('data-more-keep'\)\) closeBookingMore\(true\);/.test(listeners),
      'ONE capture-phase click listener: choosing an item closes the menu BEFORE its handler runs — except "Add spot"');
    ok(/if \(t\.closest\('\.my-booking-card'\) && !t\.closest\('\.mb-more-btn'\)\) \{\s*e\.stopPropagation\(\);\s*e\.preventDefault\(\);/.test(listeners),
      'a tap elsewhere on a card closes the menu and does nothing else (no class sheet, no cancel dialog); another More button goes through');
    ok(/if \(e\.key === 'Escape'\) \{\s*e\.preventDefault\(\);\s*e\.stopPropagation\(\);\s*closeBookingMore\(true\);/.test(listeners) && /_mbMoreKeyStep\(e\.key, items\.indexOf\(active\), items\.length\)/.test(listeners),
      'Escape closes only the menu (app.js\'s one keydown never sees it); the arrow keys go through _mbMoreKeyStep');
    ok(/document\.addEventListener\('focusin', e => \{/.test(listeners), 'focus leaving the menu (Tab, or a dialog taking it) closes it');
    ok(/if \(list\.querySelector\('\.mb-more-btn\[aria-expanded="true"\]'\)\) return true;/.test(grab('function _bookingsListBusy(')) &&
      /#upcomingList \.mb-more-btn\[aria-expanded="true"\]/.test(grab('function _bookingsRepaintSafe(')),
      'neither timed repaint (the minute tick, the waitlist re-check) lands under an open menu');
  }

  t.section('9d: More → "Add spot" → the picker or confirm closes: focus goes to the More button, not to <body>');
  {
    // "Add spot" keeps the menu open (data-more-keep), the dialog takes focus, the menu's focusin
    // listener closes it (display: none) — and the opener the dialog remembered can no longer be focused.
    const sheets = t.loadPure('js/app.js', 'sheets');
    const mkMenu = (open, moreShown) => {
      const more = { name: 'More', offsetParent: moreShown === false ? null : {} };
      const wrap = { querySelector: (sel) => (sel === '.mb-more-btn' ? more : null) };
      const menu = { offsetParent: open ? {} : null, parentElement: wrap };
      const item = { name: 'Add spot', closest: (sel) => (sel === '.mb-more-menu' ? menu : null) };
      return { more, item };
    };
    let m = mkMenu(false);
    ok(sheets._visibleOpener(m.item) === m.more, 'an opener inside a More menu that has closed → that menu\'s own More button');
    m = mkMenu(true);
    ok(sheets._visibleOpener(m.item) === m.item, 'the menu is on screen (desktop: laid out inline) → the item itself, as before');
    m = mkMenu(false, false);
    ok(sheets._visibleOpener(m.item) === m.item, 'no More button on screen either → the opener, unchanged (nothing better to offer)');
    const plain = { name: 'Cancel booking', closest: () => null };
    eq([sheets._visibleOpener(plain) === plain, sheets._visibleOpener(null), sheets._visibleOpener({ name: 'svg seat' }).name], [true, null, 'svg seat'],
      'any other opener — a button outside a menu, nothing at all, a node without closest() — passes straight through');
    const stack = grab('function _syncOverlayStack(');
    ok(/opener = _visibleOpener\(opener\);[^\n]*\n\s*if \(opener && opener\.isConnected && typeof opener\.focus === 'function'/.test(stack), '_syncOverlayStack (the picker, every plain overlay) restores through it');
    const cm = appSrc.slice(appSrc.indexOf('function confirmModal(opts) {'), appSrc.indexOf('window.confirmModal = confirmModal;'));
    ok(/const back = _visibleOpener\(previouslyFocused\);\s*if \(back && typeof back\.focus === 'function'\) \{\s*try \{ back\.focus\(\); \}/.test(cm) && /\nfunction _visibleOpener\(el\) \{/.test(cm),
      'confirmModal (the last-seat and no-layout confirms) does too — and the helper sits inside the slice tests/suites/a11y.js runs');
  }

  t.section('9d: Find similar — a named group that takes the keyboard, and gives it back');
  {
    const log = [];
    const listeners = {};
    const option = { focus(o) { log.push(['focus', 'first option', o]); } };
    const popup = { style: {}, attrs: {}, removed: 0, classList: { add() {} }, isConnected: false,
      setAttribute(k, v) { popup.attrs[k] = v; }, addEventListener(type, fn) { listeners[type] = fn; },
      querySelector: (sel) => (sel === '.find-similar-option' ? option : null), remove() { popup.removed++; popup.isConnected = false; } };
    const actions = { style: {}, appendChild(k) { k.isConnected = true; k.parentElement = actions; } };
    const more = { offsetParent: {}, isConnected: true, focus(o) { log.push(['focus', 'More', o]); } };
    const card = { querySelector: (sel) => (sel === '.mb-actions' ? actions : sel === '.mb-more-btn' ? more : null) };
    const trigger = { style: {}, isConnected: true, parentElement: {}, closest: (sel) => (sel === '.my-booking-card' ? card : null), focus(o) { log.push(['focus', 'Find similar', o]); } };
    const calls = [];
    const ctx = t.vm.createContext({
      window: {}, Date, escapeHTML: esc, toast() {}, requestAnimationFrame: () => 0, setTimeout: () => 0, rebookNextWeek: (id) => calls.push(['rebookNextWeek', id]),
      _clock24: t.loadPure('js/app.js', 'clock')._clock24, // "Tuesdays at 07:00"
      _eventCache: { 77: { start_at: '2026-09-22 07:00:00', _instrName: 'Alex', _typeName: 'RIDE: 45' } },
      document: { querySelector: (sel) => (sel === '.find-similar-popup' ? null : trigger), createElement: () => popup, addEventListener() {}, removeEventListener() {} },
    });
    t.vm.runInContext(grab('window.findSimilar = function(eventId) {', '};'), ctx, { filename: 'js/app.js[findSimilar a11y]' });
    ctx.window.findSimilar(77);
    eq([popup.attrs.role, popup.attrs['aria-label']], ['group', 'Find similar'], 'the popup is a labelled group');
    eq(log, [['focus', 'first option', undefined]], 'focus moves INTO it, onto the first option (it sits before the More button in the markup: Tab used to skip it)');
    const key = (k) => { const e = { key: k, prevented: false, stopped: false, preventDefault() { e.prevented = true; }, stopPropagation() { e.stopped = true; } }; listeners.keydown(e); return e; };
    let e = key('ArrowDown');
    eq([e.prevented, popup.removed], [false, 0], 'any other key is left alone');
    log.length = 0;
    e = key('Escape');
    eq([e.prevented, e.stopped, popup.removed, log], [true, true, 1, [['focus', 'More', { preventScroll: true }]]], 'Escape closes the popup and hands focus to the card\'s visible trigger — on a phone, the More button');
    more.offsetParent = null; // desktop: the More button is not displayed, Similar is inline
    log.length = 0;
    key('Escape');
    eq(log, [['focus', 'Find similar', { preventScroll: true }]], '…and where the actions are laid out inline, to Find similar itself');
    // "Same class next week" stays on My Bookings: the option that held focus is gone.
    more.offsetParent = {};
    log.length = 0;
    listeners.click({ target: { closest: () => ({ dataset: { action: 'next-week' } }) }, stopPropagation() {} });
    eq([log, calls], [[['focus', 'More', { preventScroll: true }]], [['rebookNextWeek', 77]]], 'choosing "Same class next week" hands focus back BEFORE the search starts (the picker it opens returns focus there too)');
  }

  t.section('9d: Find similar — chosen from a closed menu, the popup still has somewhere to hang');
  {
    const made = [];
    const mkEl = () => { const e = { style: {}, kids: [], classList: { add() {} }, addEventListener() {}, appendChild(k) { e.kids.push(k); k.parentElement = e; k.isConnected = true; } }; return e; };
    const actions = mkEl(), menu = mkEl();
    const card = { querySelector: (sel) => (sel === '.mb-actions' ? actions : null) };
    const trigger = { style: {}, parentElement: menu, closest: (sel) => (sel === '.my-booking-card' ? card : null) };
    const ctx = t.vm.createContext({
      window: {}, Date, escapeHTML: esc, toast() {}, requestAnimationFrame: () => 0, setTimeout: () => 0, _clock24: t.loadPure('js/app.js', 'clock')._clock24,
      _eventCache: { 77: { start_at: '2026-09-22 07:00:00', _instrName: 'Alex', _typeName: 'RIDE: 45' } },
      document: { querySelector: (sel) => (sel === '.find-similar-popup' ? null : trigger), createElement: () => { const e = mkEl(); made.push(e); return e; }, addEventListener() {}, removeEventListener() {} },
    });
    t.vm.runInContext(grab('window.findSimilar = function(eventId) {', '};'), ctx, { filename: 'js/app.js[findSimilar]' });
    ctx.window.findSimilar(77);
    eq([actions.kids.length, menu.kids.length, actions.style.position], [1, 0, 'relative'],
      'the popup hangs off the card\'s visible action row (.mb-actions), not off the hidden menu that holds its button');
    card.querySelector = () => null;
    ctx.window.findSimilar(77);
    eq(menu.kids.length, 1, 'no such row (an older card): the button\'s own parent, as before — tests/suites/bookings-card.js drives that path');
  }

  // ════════════════════════════════════════════════════════════════════
  // 7. css/crisp.css — the 9d section
  // ════════════════════════════════════════════════════════════════════
  t.section('9d: css/crisp.css — scoped, aria-driven, the pill never over the last card');
  {
    const a = crispCss.indexOf('/* == crisp:9d-bookings == */'), b = crispCss.indexOf('/* == crisp:9e-stats-membership == */');
    ok(a !== -1 && b > a, 'the 9d section is where the foundation reserved it');
    const css = crispCss.slice(a, b).replace(/\/\*[\s\S]*?\*\//g, '');
    ok(css.length > 4000, 'and is not empty');
    // Every selector of every rule, media blocks flattened.
    const flat = css.replace(/@media[^{]*\{/g, '').replace(/\}\s*\}/g, '}');
    const selectors = [];
    flat.replace(/([^{}]+)\{[^{}]*\}/g, (m, sel) => { sel.split(',').forEach((s) => { s = s.trim(); if (s) selectors.push(s); }); return m; });
    ok(selectors.length > 120, 'rules were found (' + selectors.length + ' selectors)');
    // (A theme or intensity prefix narrows a rule; it cannot widen what the rule reaches.)
    const scoped = /^(html\[data-ct-intensity="off"\] |html\[data-theme="gameboy"\] )?(#tab-bookings|#usualWeekCard|#usualWeekSheet|\.next-class-pill)\b|^body\.has-next-pill #tab-bookings\b/;
    eq(selectors.filter((s) => !scoped.test(s)), [], 'every selector starts at #tab-bookings / #usualWeekCard / #usualWeekSheet / .next-class-pill — nothing here can restyle a Discover card or a sheet');
    // Handheld: no soft shadow, and its cards ARE the surface — at rest over a card the pill had the card's
    // fill and no edge, and read as that card's last row. A ring (its box does not grow), over the float shadow.
    ok(/html\[data-theme="gameboy"\] \.next-class-pill \{ box-shadow: 0 0 0 var\(--hairline\) var\(--border-light\), var\(--shadow-float\); \}/.test(css), 'Handheld: the pill wears a hairline ring, so it no longer merges with the card under it');
    ok(!/\.class-card(?![\w-])/.test(css) && !/\.book-btn(?![\w-])/.test(css), '…and none names the shared .class-card / .book-btn at all (9b\'s to style)');

    const rule = (sel) => { const i = css.indexOf(sel + ' {'); return i === -1 ? '' : css.slice(i, css.indexOf('}', i)); };
    ok(/display: none;/.test(rule('#tab-bookings .my-booking-card .mb-more-menu')) && /\.mb-more-btn\[aria-expanded="true"\] \+ \.mb-more-menu \{ display: grid; \}/.test(css),
      'the menu is shown by aria-expanded alone: one source of truth for the eye and for a screen reader');
    ok(/position: absolute;/.test(rule('#tab-bookings .my-booking-card .mb-more')) && /z-index: 5;/.test(rule('#tab-bookings .my-booking-card[data-more-open]')),
      'phones: the button is pinned to the card\'s corner; the open card rides over the next one');
    ok(/grid-template-columns: repeat\(2, minmax\(0, auto\)\);/.test(rule('#tab-bookings .my-booking-card .mb-more-menu')), 'two columns: four actions stay inside their own card (never under the pill or the next card)');
    const desk = (/@media \(min-width: 1024px\) \{([\s\S]*?)\n\}/.exec(css) || [])[1] || '';
    ok(/\.mb-more-btn \{ display: none; \}/.test(desk) && /\.mb-more-menu,[\s\S]*?position: static;\s*display: flex;/.test(desk) && /\.mb-more \{ position: static; grid-column: 1 \/ -1; \}/.test(desk),
      'desktop: no More button — the same buttons inline, in the flow, under the action row');
    ok(/grid-template-columns: repeat\(auto-fill, minmax\(var\(--mb-col\), 1fr\)\);/.test(desk) && /\.mb-day-group > \.class-grid \{ display: contents; \}/.test(desk), '…and the cards in columns, each a cell of its own');
    // A folded billing period must stay folded: every rule here that gives .mb-period-body a `display`
    // is id-scoped (1,1,0) and outranks css/styles.css's `.collapsed .mb-period-body { display: none }` (0,3,0).
    const showsBody = [];
    flat.replace(/([^{}]+)\{([^{}]*)\}/g, (m, sel, body) => { if (/(?:^|;|\s)display:\s*(?!none)/.test(body)) sel.split(',').forEach((x) => { x = x.trim(); if (/\.mb-period-body$/.test(x)) showsBody.push(x); }); return m; });
    ok(showsBody.length > 0, 'the desktop grid does set display on .mb-period-body (' + showsBody.join(' · ') + ')');
    ok(/#tab-bookings \.mb-period-section\.collapsed \.mb-period-body \{ display: none; \}/.test(desk) &&
      css.indexOf('#tab-bookings .mb-period-section.collapsed .mb-period-body { display: none; }') > css.indexOf('#tab-bookings .mb-period-body {\n    display: grid;'),
      '…so the fold is re-stated beside it at (1,3,0), AFTER the grid rule and inside the same media block: aria-expanded="false" never sits over cards that are still up');

    // The pill: while it shows, the list ends far enough above it (phones: .tab-content is the scroller).
    const root = {};
    (/:root \{([\s\S]*?)\n\}/.exec(themeCss) || [])[1].replace(/(--[\w-]+):\s*([^;]+);/g, (m, k, v) => { root[k] = v.trim(); return m; });
    const px = (k) => parseFloat(root[k]);
    const tabsCss = t.readSource('css/tabs.css');
    const barPad = Number((/\.tab-content \{ padding-bottom: calc\((\d+)px \+ env/.exec(tabsCss) || [])[1]);
    const pillBottom = Number((/body \.next-class-pill \{ bottom: calc\((\d+)px \+ env/.exec(tabsCss) || [])[1]);
    const pad = /@media \(max-width: 640px\) \{\s*body\.has-next-pill #tab-bookings \{ padding-bottom: calc\(var\((--[\w-]+)\) \+ var\((--[\w-]+)\) \+ env\(safe-area-inset-bottom\)\); \}/.exec(css) || [];
    ok(barPad > 0 && pillBottom > 0 && !!pad[1], 'the three numbers can be read (tabs.css: the docked bar\'s clearance and the pill\'s offset; crisp.css: the padding)');
    const listEnds = barPad + px(pad[1]) + px(pad[2]);
    const pillTop = pillBottom + px('--tap-lg'); // the pill is a one-row chip, under --tap-lg tall
    ok(listEnds >= pillTop + 16, 'at the end of the scroll the last card ends ' + (listEnds - pillTop) + 'px above the pill (list ends ' + listEnds + 'px up, pill top ' + pillTop + 'px up) — its actions are never covered');
    ok(/body\.has-next-pill/.test(css) && (css.match(/has-next-pill/g) || []).length === 1, 'only WHILE the pill shows: hidden, the tab is exactly as tall as it was');

    // Touch, focus, motion, ink.
    ok(/min-height: var\(--tap-min\);\s*min-width: var\(--tap-min\);/.test(css) && /width: var\(--tap-min\);\s*height: var\(--tap-min\);/.test(rule('#tab-bookings .my-booking-card .mb-more-btn')),
      'every card button — and the More button — is --tap-min');
    // (The class name's ring is the shared card's: `.class-card[data-ct] .cc-name:focus-visible`, 9b.7.)
    ok(/\.class-card\[data-ct\] \.cc-name:focus-visible,[^{]*\{[^}]*outline: var\(--focus-ring\)/.test(crispCss) && !/\.mb-name:focus-visible/.test(css), 'the class name shows the shared card\'s focus ring — not a second copy here');
    ['.mb-more-btn', '.mb-primary-btn', '.booking-action-btn', '.mb-period-bar', '.up-seat-chip button', '.usual-week-remove', '.cal-btn'].forEach((sel) => {
      ok(new RegExp(sel.replace(/[.\s]/g, (c) => (c === '.' ? '\\.' : '\\s')) + ':focus-visible[^{]*\\{[^}]*outline: var\\(--focus-ring\\)').test(css), sel + ' shows the focus ring (the body ink: visible on every tint)');
    });
    ok(/\.next-class-pill:focus-visible \{ outline: var\(--focus-ring\)/.test(css), 'so does the pill');
    ok(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?transition: none;/.test(css), 'reduced motion is respected');
    eq(css.match(/var\(--text-(dim|faint|ghost|off)\)/g) || [], [], 'no --text-dim / -faint / -ghost / -off: on a tint only --ct-ink, --ct-ink-2 and --ct-deep are guaranteed (and Handheld fails AA on dim)');
    const cardInks = [];
    flat.replace(/(#tab-bookings \.my-booking-card[^{}]*)\{([^{}]*)\}/g, (m, sel, body) => { body.replace(/(?:^|;|\s)color:\s*([^;]+);/g, (mm, v) => { cardInks.push(v.trim()); return mm; }); return m; });
    eq([...new Set(cardInks)].filter((v) => !/^(var\(--ct-ink\)|var\(--ct-ink-2\)|var\(--ct-deep\)|var\(--ct-on-base\)|var\(--pill-ink\)|var\(--text\)|var\(--surface\)|var\(--danger-ink\)|inherit)$/.test(v)), [],
      'on the card: the three guaranteed inks, white-on-base, a pill\'s own ink, and the ink/surface pair of a surface pill or rank tile — nothing else');
    ok(/\.is-late \.mb-primary-btn\.booked \{ --pill-ink: var\(--danger\); --pill-line: var\(--danger\); \}/.test(css) && /\.badge\.late-cancel-note \{ background: var\(--danger\); color: var\(--danger-ink\); \}/.test(css),
      'red appears ONLY in the late-cancel window: the Cancel outline and the one badge');
    // "Leave waitlist" has no line of its own, so on a card that IS the surface it
    // vanished. It takes the SHARED card's --cc-pill (crisp 9b.7), which steps down
    // at "off" AND on Handheld (no shadow to lift it either — there it was invisible:
    // the pill and the card were the same rgb). No prefixed rule of its own is left.
    ok(/--pill-fill: var\(--cc-pill\);/.test(rule('#tab-bookings .my-booking-card.is-waitlisted .mb-primary-btn.booked')) &&
      /html\[data-ct-intensity="off"\] \.class-card\[data-ct\],\s*html\[data-theme="gameboy"\] \.class-card\[data-ct\] \{ --cc-pill: var\(--surface-2\); \}/.test(crispCss) &&
      !/html\[[^\]]*\] #tab-bookings [^{]*\.mb-primary-btn/.test(css),
      '"Off" and Handheld: the line-less surface pill takes the shared card\'s --cc-pill (one shade down) instead of vanishing');
    ok(/html\[data-ct-intensity="off"\] #usualWeekCard \.usual-week-entry \{ background: var\(--sunken\); \}/.test(css),
      '"Off": a usual-week row on the surface card steps down to the sunken well (NOT --surface-2: Handheld\'s --text-muted is 3.8:1 there — tests/suites/9a-foundation.js holds the inks on it)');
    // ONE component: what the shared card says is not said again here.
    const mbRoot = rule('#tab-bookings .my-booking-card');
    ok(/display: grid;/.test(mbRoot) && !/background:|border-radius:|box-shadow:|(?:^|[\s;])color:|(?:^|[\s;])border:/.test(mbRoot),
      'the card root adds only its grid: surface, radius, ink, border and shadow come from the shared .class-card[data-ct]');
    ok(!/\.my-booking-card\.is-waitlisted \{/.test(css) && !/\.my-booking-card\.glow-mine-card \{/.test(css) && !/\.tier-badge/.test(css),
      'no second copy of the dashed place, the glow or the rank tile (shared: crisp 9b.7; the rank look: 9e.5)');
  }

  t.section('9d: the calendar row carries no emoji');
  {
    const cal = t.readSource('js/calendar.js');
    const rowSrc = cal.slice(cal.indexOf('function renderCalendarActions()'), cal.indexOf('// Inject styles'));
    ok(/>Add to Calendar<\/button>/.test(rowSrc) && />Calendar sync settings<\/button>/.test(rowSrc) && !/[\u{1F300}-\u{1FAFF}]/u.test(rowSrc), '"Add to Calendar" / "Calendar sync settings", in words');
  }
};
