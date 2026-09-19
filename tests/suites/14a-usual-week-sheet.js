'use strict';
// Wave 13a — "Book my usual week": safe to press. The sheet shows the dates (up
// to three weeks ahead), a seat count per class and the spot(s) it SUGGESTS,
// and the run books exactly what was shown or nothing. Everything here is the
// SHIPPED code: the pure blocks (js/app.js pure:horizon / pure:template /
// pure:template-spots / pure:sheets, js/tabs.js pure:usual-week-sheet) and the
// real run / plan / spot-read / picker functions, sliced out and driven
// against fakes. Nothing can reach Psycle. The runner's zone is
// America/New_York on purpose: every date here is London's.
module.exports = async function (t) {
  const { ok, eq } = t;
  const app = t.readSource('js/app.js');
  const tabs = t.readSource('js/tabs.js');
  const grab = (src, opener, closer) => {
    const lines = src.split('\n');
    const from = lines.findIndex((l) => l.startsWith(opener));
    const to = lines.findIndex((l, i) => i > from && l === (closer || '}'));
    if (from === -1 || to === -1) throw new Error('14a suite: cannot slice "' + opener + '" (anchor moved?)');
    return lines.slice(from, to + 1).join('\n');
  };
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const quiet = { log() {}, info() {}, warn() {}, error: console.error };
  const utc = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h || 0, mi || 0);
  const G = t.loadPure('js/app.js', 'gym-time');
  const W = t.loadPure('js/app.js', 'window', { _gymWallToUtcMs: G._gymWallToUtcMs });
  const P = t.loadPure('js/app.js', 'template');
  const S = t.loadPure('js/app.js', 'template-spots');

  // ── 1. How far ahead Psycle books ────────────────────────────────────────
  t.section('14a horizon: what is open, what is listed, what the next release brings (OBSERVED 2026-09-19 — advisory)');
  {
    const SAT = utc(2026, 9, 19, 13); // Saturday 19 September 2026, 14:00 London — the day the timetable was read
    eq(W._bookingHorizon(SAT), {
      openThrough: '2026-10-08', listedThrough: '2026-10-15',
      lastRelease: utc(2026, 9, 14, 11), nextRelease: utc(2026, 9, 21, 11),
      lastBatch: { from: '2026-10-02', to: '2026-10-08' }, nextBatch: { from: '2026-10-09', to: '2026-10-15' },
    }, 'as seen that day: real bookings through Thu 8 Oct (today + 19), classes listed through Thu 15 Oct (today + 26); 14 Sept opened Fri 2 → Thu 8 Oct, 21 Sept will open Fri 9 → Thu 15 Oct');
    eq([W._bookingHorizon(utc(2026, 9, 21, 10, 59)).openThrough, W._bookingHorizon(utc(2026, 9, 21, 11, 0)).openThrough], ['2026-10-08', '2026-10-15'],
      'Monday 11:59 London: still last week\'s horizon; 12:00: the new batch is open');
    eq(W._bookingHorizon(utc(2026, 9, 20, 23, 30)).openThrough, '2026-10-08', 'Sunday 23:30Z is Monday 00:30 in London — before noon, nothing has moved (the device zone plays no part)');
    const gmt = W._bookingHorizon(utc(2026, 11, 4, 9)); // a Wednesday on GMT
    eq([new Date(gmt.lastRelease).toISOString(), gmt.openThrough, gmt.nextBatch], ['2026-11-02T12:00:00.000Z', '2026-11-26', { from: '2026-11-27', to: '2026-12-03' }], 'on GMT the release is 12:00 UTC; the batch arithmetic is calendar days');
    const across = W._bookingHorizon(utc(2026, 10, 20, 8)); // the week the clocks go back
    eq([new Date(across.lastRelease).toISOString(), new Date(across.nextRelease).toISOString(), across.openThrough], ['2026-10-19T11:00:00.000Z', '2026-10-26T12:00:00.000Z', '2026-11-12'],
      'across the clock change each release is still London\'s noon');
    eq([W._bookingHorizon(NaN), W._bookingHorizon('soon')], [null, null], 'an unreadable clock → null (callers then say nothing about it)');
    eq(t.loadPure('js/app.js', 'window', {})._bookingHorizon(SAT), null, 'no London resolver → null, no throw');
    // The block stands on its own too (it is nested in pure:window).
    const H = t.loadPure('js/app.js', 'horizon', { _lastReleaseMs: () => utc(2026, 9, 14, 11), _nextReleaseMs: () => utc(2026, 9, 21, 11), _gymWallToUtcMs: G._gymWallToUtcMs });
    eq(H._bookingHorizon(SAT).nextBatch, { from: '2026-10-09', to: '2026-10-15' }, 'pure:horizon can be evaluated alone (given the two release helpers)');
    ok(/^const RELEASE_OPENS_FROM_DAYS = 18;/m.test(app) && /^const RELEASE_OPENS_TO_DAYS = 24;/m.test(app) && /^const RELEASE_LISTED_EXTRA_DAYS = 7;/m.test(app) && /OBSERVED, NOT AN API CONTRACT/.test(app) && /2026-09-19/.test(app.slice(app.indexOf('// ── pure:horizon:start'), app.indexOf('// ── pure:horizon:end'))),
      'the constants are named, and the block says they were OBSERVED on 2026-09-19 — not an API contract');
    ok(/^window\._bookingHorizon = _bookingHorizon;/m.test(app), 'window._bookingHorizon is the shared contract (the Monday reminder reads it too)');
    ok(!/function _weekOpensMs\(/.test(app), 'the rule it replaces — "a week opens at noon on the Monday before it" — is gone from the source');
  }

  // ── 2. Seats per class ───────────────────────────────────────────────────
  t.section('14a seats: 1–4, default 1, coerced where it is read, never above the class\'s own max_bookable_slots');
  {
    eq([1, 2, 3, 4].map((v) => P._templateSeats(v)), [1, 2, 3, 4], 'an integer 1–4');
    // Wave 13 integration: a numeric string read as its number HERE and as 1 on
    // the card (js/tabs.js _uwCardSeats) — the card said one seat, the sheet
    // started at three. The app only ever writes a number, so a string is junk;
    // both read it as 1 now (the side that can only make the sheet start LOWER).
    eq(['2', ' 3 ', '4'].map((v) => P._templateSeats(v)), [1, 1, 1], 'a numeric STRING is junk like any other — the app never wrote it — and reads as 1, exactly as the card reads it');
    eq([0, 5, 9, -1, 2.5, NaN, Infinity, null, undefined, '', 'two', true, [2], { n: 2 }].map((v) => P._templateSeats(v)), [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      'anything else is 1 — this number ends up in a POST, and storage is not ours to trust');
    eq([P._templateSeats(3, 2), P._templateSeats(3, 4), P._templateSeats(2, 1), P._templateSeats(3, 0), P._templateSeats(3, null), P._templateSeats(3, 'x'), P._templateSeats(3, 2.5)], [2, 3, 1, 3, 3, 3, 3],
      'capped by the event\'s max_bookable_slots when it says one (a junk cap is no cap)');
    const seat = (slots, ids) => ({ bookingId: 'A', slots, bookingIds: ids, waitlisted: false });
    eq([P._templateSeatsHeld(seat([5])), P._templateSeatsHeld(seat([5, 6], ['A'])), P._templateSeatsHeld(seat([], ['A', 'B', 'C'])), P._templateSeatsHeld(seat([])), P._templateSeatsHeld({ waitlisted: true, slots: [] }), P._templateSeatsHeld(null)],
      [1, 2, 3, 1, 0, 0], 'seats held = its seats; a studio with no spot map keeps one record per space; a waitlist place is no seat');
    eq([P._templatePickSlots([12, '13', 12]), P._templatePickSlots([1, 2, 3, 4, 5]), P._templatePickSlots(['x', -1, 0, 2.5, null, {}, 7]), P._templatePickSlots('12'), P._templatePickSlots(undefined)],
      [[12, 13], [1, 2, 3, 4], [7], [], []], 'the slot ids a pick may send: whole positive numbers, each once, at most four');

    const ev = (id, start, o) => Object.assign({ id, start_at: start, event_type_id: 7, instructor_id: 31, studio_id: 4, duration: 45, _typeName: 'Ride', _instrName: 'Jane', _locName: 'Bank' }, o || {});
    const now = { date: '2026-09-21', min: 0 };
    const saved = P._templateFromSeats(
      { 10: seat([5, 6]), 11: seat([], ['A', 'B', 'C']), 12: seat([1, 2, 3, 4, 5]), 13: seat([9]) },
      { 10: ev(10, '2026-09-21 07:00:00'), 11: ev(11, '2026-09-22 09:00:00', { event_type_id: 8 }), 12: ev(12, '2026-09-23 18:30:00'), 13: ev(13, '2026-09-24 07:00:00') }, now, () => 2);
    eq(saved.map((e) => [e.dayOfWeek, e.seats]), [[1, 2], [2, 3], [3, 4], [4, 1]], 'saving the week stores the seats held per class: 2 seats · 3 spaces (no spot map) · five held is still 4 · one');
    const twice = P._templateFromSeats({ 10: seat([5]), 16: seat([7, 8]) }, { 10: ev(10, '2026-09-21 07:00:00'), 16: ev(16, '2026-09-21 07:00:00') }, now, () => 2);
    eq([twice.length, twice[0].seats], [1, 2], 'the same slot twice is one entry — wearing the larger seat count');

    const studios = { 4: { id: 4, has_layout: true }, 9: { id: 9, has_layout: false } };
    const entry = (o) => Object.assign({ dayOfWeek: 1, hour: 7, minute: 0, locationId: 2, eventTypeId: 7, instructorId: 31, label: 'Ride · Jane' }, o || {});
    const ctx = (o) => Object.assign({ date: '2026-09-28', now: { date: '2026-09-21', min: 720 }, bookings: {}, studios }, o || {});
    const row = (e, evts, c) => P._templatePlanRow(e, evts, c || ctx());
    eq([row(entry(), [ev(10, '2026-09-28 07:00:00')]).seats, row(entry({ seats: 3 }), [ev(10, '2026-09-28 07:00:00')]).seats, row(entry({ seats: 3 }), [ev(10, '2026-09-28 07:00:00', { max_bookable_slots: 2 })]).seats, row(entry({ seats: 'lots' }), [ev(10, '2026-09-28 07:00:00')]).seats],
      [1, 3, 2, 1], 'a plan row asks for the saved seats — default 1, never above the class\'s own max_bookable_slots, junk = 1');
    let r = row(entry({ seats: 2 }), [ev(10, '2026-09-28 07:00:00')], ctx({ bookings: { 10: seat([5]) } }));
    eq([r.state, r.heldSeats, r.canAdd], ['booked', 1, true], 'held with FEWER seats than asked, and room left → the missing seat can be added (canAdd)');
    r = row(entry({ seats: 2 }), [ev(10, '2026-09-28 07:00:00')], ctx({ bookings: { 10: seat([5, 6]) } }));
    eq([r.state, r.heldSeats, r.canAdd], ['booked', 2, false], 'held with all the seats asked for → nothing to add');
    r = row(entry({ seats: 2 }), [ev(10, '2026-09-28 07:00:00', { is_fully_booked: true })], ctx({ bookings: { 10: seat([5]) } }));
    eq(r.canAdd, false, 'a class that is full has no seat to add');
    r = row(entry({ seats: 2 }), [ev(10, '2026-09-28 07:00:00', { studio_id: 77 })], ctx({ bookings: { 10: seat([5]) } }));
    eq([r.state, r.canAdd], ['booked', false], 'nor has a studio nobody knows the kind of');
    r = row(entry({ seats: 2 }), [ev(10, '2026-09-28 07:00:00')], ctx({ bookings: { 10: { waitlisted: true, slots: [] } } }));
    eq([r.state, r.heldSeats, r.canAdd], ['waitlisted', 0, false], 'a waitlist place is no seat: nothing is added on top of it');
  }

  // ── 3. Which dates the sheet offers, and which it opens on ───────────────
  t.section('14a ranges: the next 7 days, the next THREE weeks — and the newly opened batch first, when there is one');
  {
    const SAT = utc(2026, 9, 19, 13);
    const horizon = W._bookingHorizon(SAT);
    const ids = (list) => list.map((r) => r.id);
    eq(P._templateRanges(SAT, horizon, false).map((r) => [r.id, r.start, r.end]),
      [['next7', '2026-09-19', '2026-09-25'], ['week1', '2026-09-21', '2026-09-27'], ['week2', '2026-09-28', '2026-10-04'], ['week3', '2026-10-05', '2026-10-11']],
      'Saturday: next 7 days · 21 Sept · 28 Sept · 5 Oct — three weeks ahead, as Psycle books');
    eq(P._templateRanges(SAT, horizon, true)[0], { id: 'newest', start: '2026-10-02', end: '2026-10-08' }, 'asked for (the Monday reminder\'s tap): the batch the latest release opened leads — Fri 2 → Thu 8 Oct');
    const monNoon = utc(2026, 9, 21, 11, 5);
    eq([ids(P._templateRanges(monNoon, W._bookingHorizon(monNoon), false))[0], P._templateRanges(monNoon, W._bookingHorizon(monNoon), false)[0].start], ['newest', '2026-10-09'],
      'five minutes after a release it leads by itself: Fri 9 → Thu 15 Oct');
    const tueNoon = utc(2026, 9, 22, 11, 5);
    eq(ids(P._templateRanges(tueNoon, W._bookingHorizon(tueNoon), false)), ['next7', 'week1', 'week2', 'week3'], '…and 24 hours later it no longer does');
    eq(ids(P._templateRanges(SAT, null, true)), ['next7', 'week1', 'week2', 'week3'], 'no horizon (no London data) → no "newly opened" to offer, asked for or not');
    eq(P._templateRanges(utc(2026, 9, 21, 8), null, false)[1].start, '2026-09-28', 'on a Monday, "week 1" is NEXT Monday (today\'s week is the next 7 days)');

    const entry = (dow, h, o) => Object.assign({ dayOfWeek: dow, hour: h, minute: 0, eventTypeId: 7, instructorId: 31, locationId: 2 }, o || {});
    const template = [entry(1, 7), entry(3, 18)]; // Monday 07:00, Wednesday 18:00
    const held = (start) => ({ start_at: start, event_type_id: 7, instructor_id: 31 });
    const seat = { bookingId: 'A', slots: [5], waitlisted: false };
    const ranges = P._templateRanges(SAT, horizon, false);
    const pickFor = (bookings, cache, rs) => P._templateDefaultStart(SAT, { ranges: rs || ranges, template, bookings, cache });
    eq(pickFor({}, {}), { mode: 'next7', start: '2026-09-19', id: 'next7' }, 'nothing held → the next 7 days');
    eq(pickFor({ 1: seat, 2: seat }, { 1: held('2026-09-21 07:00:00'), 2: held('2026-09-23 18:00:00') }).id, 'week2',
      'this week\'s two classes are held (they fall in the next 7 days AND in week 1) → the first range with something still to book: 28 Sept');
    eq(pickFor({ 1: seat }, { 1: held('2026-09-21 07:00:00') }).id, 'next7', 'one of the two still to book → that range');
    eq(pickFor({ 1: seat, 2: seat }, { 1: held('2026-09-21 07:15:00'), 2: held('2026-09-23 18:00:00') }).id, 'week2', 'a held 07:15 IS the 07:00 (the plan\'s own tolerance)');
    eq(pickFor({ 1: { waitlisted: true, slots: [] }, 2: seat }, { 1: held('2026-09-21 07:00:00'), 2: held('2026-09-23 18:00:00') }).id, 'next7', 'a waitlist place is not a seat: that class is still to book');
    const all = {}, cache = {};
    ['2026-09-21', '2026-09-28', '2026-10-05'].forEach((d, i) => { all['m' + i] = seat; cache['m' + i] = held(d + ' 07:00:00'); });
    ['2026-09-23', '2026-09-30', '2026-10-07'].forEach((d, i) => { all['w' + i] = seat; cache['w' + i] = held(d + ' 18:00:00'); });
    eq(pickFor(all, cache).id, 'next7', 'everything held in every range → back to the next 7 days');
    eq(pickFor(all, cache, P._templateRanges(SAT, horizon, true)).id, 'newest', 'the newly opened batch, when it leads the list, is where the sheet opens — whatever is held');
    eq(P._templateEntryHeld(entry(1, 7, { eventTypeId: null }), '2026-09-21', { 1: seat }, { 1: held('2026-09-21 07:00:00') }), true, 'an entry that names no type is matched on its instructor');
    eq(P._templateEntryHeld(entry(1, 7, { eventTypeId: null, instructorId: null }), '2026-09-21', { 1: seat }, { 1: held('2026-09-21 07:00:00') }), false, '…and one that names neither identifies nothing');
  }

  // ── 4. An opinion on the spots ───────────────────────────────────────────
  t.section('14a spots: usual → preferred → closest to the usual → first free; never an avoided spot while another is free');
  {
    // Two rows of six: 1–6 across the front (y = 0), 7–12 behind (y = 10).
    const slots = Array.from({ length: 12 }, (x, i) => ({ id: i + 1, x: (i % 6) * 10, y: Math.floor(i / 6) * 10, label: String(i + 1) }));
    const sug = (o) => S._spotSuggestion(Object.assign({ slots, free: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], count: 1 }, o));
    const say = (o) => { const s = sug(o); return [s.slots, S._spotWhyText(s)]; };
    eq(say({ usual: 9 }), [[9], 'your usual'], 'the usual spot, free → it');
    eq(say({ usual: 9, free: [1, 2, 3, 8, 10, 12], prefer: [12] }), [[12], 'one you prefer'], 'the usual is taken → a PREFERRED spot that is free');
    eq(say({ usual: 9, free: [1, 2, 8, 10, 12], prefer: [2, 12] }), [[2], 'one you prefer'], '…of two preferred, the one nearer the usual BY THE MAP (2 is diagonally in front of 9; 12 is three seats along)');
    eq(say({ usual: 9, free: [1, 2, 8, 12] }), [[8], 'closest to your usual — 9 is taken'], 'no preferred spot free → the free spot closest to the usual, by the layout\'s own coordinates — and it says why');
    eq(say({ usual: 9, free: [3, 4, 12] }), [[3], 'closest to your usual — 9 is taken'], '3 sits right in front of 9 (one row forward) — nearer than 12, three across');
    eq(say({ usual: 9, free: [8, 10] }), [[8], 'closest to your usual — 9 is taken'], 'a tie → the lower id');
    eq(say({ free: [4, 2, 7] }), [[2], 'first free'], 'no habit to go by → the first free one (lowest id)');
    eq(say({ usual: 99, free: [4, 2, 7] }), [[2], 'first free'], 'a usual spot this map does not have is no anchor');
    eq(say({ usual: 9, avoid: [8], free: [1, 8, 10] }), [[10], 'closest to your usual — 9 is taken'], 'an AVOIDED spot is never suggested while another is free (8 would win the tie on its id — it is avoided, so 10)');
    eq(say({ usual: 9, avoid: [9], free: [8, 9, 10] }), [[8], 'closest to your usual — 9 is one you avoid'], 'even the usual one, if the member has since marked it to avoid — and the reason says so');
    eq(say({ avoid: [4, 5], free: [4, 5] }), [[4], 'first free (nothing else is free)'], 'only avoided spots left → one of them, and it says so');
    eq(say({ usual: 9, count: 2 }), [[9, 3], 'your usual, plus the closest free'], 'a second seat = the free spot closest to the first (3, 8 and 10 are all one seat away: ties → lower id)');
    eq(say({ usual: 9, count: 3, free: [9, 3, 10, 12], avoid: [10] })[0], [9, 3, 12], '…further seats skip an avoided spot while another is free');
    eq(say({ usual: 9, count: 3, free: [9, 10], avoid: [10] })[0], [9, 10], '…and take it only when nothing else is left');
    eq([sug({ count: 3, free: [4, 5] }).slots, sug({ count: 3, free: [4, 5] }).short], [[4, 5], 1], 'fewer free than asked → what there is, and how many are missing (`short`)');
    eq([sug({ free: [] }).slots, sug({ free: [] }).why, S._spotWhyText(sug({ free: [] }))], [[], '', ''], 'nothing free → nothing suggested, nothing said');
    eq(say({ held: [9], usual: 2, free: [2, 8, 10] }), [[8], 'closest to 9, which you hold'], 'adding a seat to a class already held: next to the seat held, not the usual across the room');
    // The member's own choice (Change spot) outranks every rule — while it is free.
    eq(say({ usual: 9, keep: [4] }), [[4], 'your pick'], 'the member\'s pick stands');
    eq(say({ usual: 9, keep: [4], free: [1, 9] }), [[9], '4 was just taken — your usual'], 'a pick that has gone is NAMED, then the rules start again');
    eq(say({ usual: 9, keep: [4, 5], count: 2, free: [4, 6, 9] }), [[4, 9], '5 was just taken — your pick, plus the closest free'], 'half a pick gone: the half that stands, the free spot nearest IT (9, not the usual rule), and the reason');
    eq(sug({ keep: [4, 5, 6], count: 2 }).slots, [4, 5], 'never more seats than the row asks for');
    eq(say({ free: ['2', 2, 'x', null, 3] })[0], [2], 'ids are read as numbers, junk dropped, each once');
    const noMap = S._spotSuggestion({ slots: [{ id: 1 }, { id: 5 }, { id: 9 }], free: [1, 5], usual: 9, count: 1 });
    eq([noMap.slots, noMap.why], [[5], 'near-usual'], 'a map without coordinates falls back on the numbers (5 is nearer 9 than 1 is)');
    eq(S._spotWhyText({ why: 'near-usual', usual: 9, usualTaken: true, lost: [], filled: 0 }, (id) => 'B' + id), 'closest to your usual — B9 is taken', 'the reason prints the number ON the seat (a layout label can differ from its id)');
    eq([S._spotSuggestion(null).slots, S._spotSuggestion({}).slots, S._spotWhyText(null)], [[], [], ''], 'nothing in, nothing out — no throw');
  }

  // ── 5. Totals against the plan ───────────────────────────────────────────
  t.section('14a plan: ONE advisory line when the ticked seats are more than Psycle says are left — never a block');
  {
    const start = utc(2026, 9, 12), end = utc(2026, 10, 12);
    const inP = (seats) => ({ classMs: utc(2026, 9, 28, 6), seats });
    const afterP = (seats) => ({ classMs: utc(2026, 10, 14, 6), seats });
    const capped = (made, o) => Object.assign({ subscription: { max_bookings: 12, bookings_made: made }, periodStartMs: start, periodEndMs: end, periodWord: 'month' }, o);
    eq(P._templatePlanCaution(capped(10, { items: [inP(2), inP(2)] })), '4 seats this month — your plan shows 2 left', 'a capped plan: more seats in the period than are left');
    eq(P._templatePlanCaution(capped(12, { items: [inP(1)] })), '1 seat this month — your plan shows none left', '…none left');
    eq(P._templatePlanCaution(capped(10, { items: [inP(2)] })), '', 'within what is left → nothing to say');
    eq(P._templatePlanCaution(capped(10, { items: [inP(1), afterP(3)] })), '', 'seats in classes AFTER the period /profile is counting are not weighed (it cannot say what is left then)');
    eq(P._templatePlanCaution({ subscription: { max_bookings: 0, bookings_made: 40 }, periodStartMs: start, periodEndMs: end, items: [inP(4), inP(4)] }), '', 'an unlimited plan has nothing to run out of');
    eq(P._templatePlanCaution({ subscription: null, creditsRemaining: 3, items: [inP(2), afterP(2)] }), '4 seats — you have 3 credits left', 'no plan: the credit balance (credits do not reset with a period)');
    eq([P._templatePlanCaution({ creditsRemaining: 0, items: [inP(2)] }), P._templatePlanCaution({ creditsRemaining: NaN, items: [inP(2)] }), P._templatePlanCaution({}), P._templatePlanCaution(null)], ['', '', '', ''],
      'a balance nobody can vouch for says nothing (as the class sheet\'s own note)');
    ok(/function templatePlanCaution\(items\) \{[\s\S]*?_templatePlanCaution\(\{[\s\S]*?\} catch \(e\) \{ return ''; \}/.test(app), 'app.js feeds it from /profile, and an error there can never get in the way of the sheet');
  }

  // ── 6. The run books exactly what was shown ──────────────────────────────
  // `script[eventId]` = what the seat step answers; a function gets the `want`.
  const runWorld = (script, o) => {
    o = o || {};
    const log = { wants: [], progress: [], joins: 0 };
    const state = { token: 'tok', online: true };
    const g = {
      _myBookings: clone(o.bookings || {}), currentUser: { id: 1 }, console: quiet,
      navigator: { get onLine() { return state.online; } }, getBearerToken: () => state.token,
      dismissBookingConfirmation() {}, fetchMyBookings: async () => true, _rereadBookingsForVerify: async () => true,
      joinWaitlist: async () => { log.joins++; return true; },
    };
    g._bookTemplateSeat = async (id, studioId, want) => {
      log.wants.push([id, clone(want)]);
      const a = script[id];
      return typeof a === 'function' ? a(want) : a;
    };
    const world = t.loadPure('js/app.js', 'template', g);
    t.vm.runInContext('var _bookingsLoadState = "loaded";\n' + grab(app, 'async function _bookWeeklyTemplateInner('), world);
    return { log, run: (picks) => world._bookWeeklyTemplateInner({ booked: 0, waitlisted: 0, failed: 0, skipped: 0 }, picks, { onProgress: (i, r, res) => log.progress.push([i, r, res ? clone(res) : null]) }) };
  };
  const results = (c) => c.results.map((r) => r.result);

  t.section('14a run: exactly the spots that were shown — and what a refusal, a gone spot and a changed booking do');
  {
    let w = runWorld({ 10: 'booked', 11: 'booked' });
    let c = await w.run([{ eventId: 10, studioId: 4, slots: [12] }, { eventId: 11, studioId: 9, spaces: 2 }]);
    eq(w.log.wants, [[10, { slots: [12] }], [11, { spaces: 2 }]], 'each class goes to the seat step with what the sheet showed: these spots, or this count — nothing else');
    eq([c.booked, c.stopped], [2, ''], 'both booked');

    w = runWorld({ 10: (want) => { want.gone = [9]; return 'taken'; }, 11: 'booked' });
    c = await w.run([{ eventId: 10, studioId: 4, slots: [9] }, { eventId: 11, studioId: 4, slots: [3] }]);
    eq([results(c), c.results[0].gone, c.stopped, c.failed, c.booked], [['taken', 'booked'], [9], '', 1, 1], 'a shown spot that has gone: nothing for that class, the spot handed back for "Choose again" — and the run carries on with the others');
    eq(w.log.progress.filter((p) => p[1] === 'taken')[0][2], { eventId: 10, result: 'taken', gone: [9] }, 'the sheet hears which spot went as it happens');

    // A refusal is a clean answer. Past what Psycle has opened it is the expected one: shown, and the run carries on.
    w = runWorld({ 10: (want) => { want.said = 'Booking is not open yet'; return 'refused'; }, 11: 'booked' });
    c = await w.run([{ eventId: 10, studioId: 4, slots: [9], mayBeClosed: true }, { eventId: 11, studioId: 4, slots: [3] }]);
    eq([results(c), c.results[0].said, c.stopped, c.booked], [['refused', 'booked'], 'Booking is not open yet', '', 1], 'a class that may not be open yet, refused: Psycle\'s words are kept for the row, and the next class is still attempted');
    w = runWorld({ 10: (want) => { want.said = 'Not enough credits'; return 'refused'; }, 11: 'booked' });
    c = await w.run([{ eventId: 10, studioId: 4, slots: [9] }, { eventId: 11, studioId: 4, slots: [3] }]);
    eq([results(c), c.stopped, w.log.wants.length], [['refused', 'notrun'], 'failed', 1], 'a class INSIDE what is open, refused (credits, plan): the run stops as it always has — the next POST would meet the same wall');
    for (const bad of ['failed', 'unconfirmed', 'partial']) {
      w = runWorld({ 10: bad, 11: 'booked' });
      c = await w.run([{ eventId: 10, studioId: 4, slots: [9], mayBeClosed: true }, { eventId: 11, studioId: 4, slots: [3] }]);
      eq([results(c), c.stopped], [[bad, 'notrun'], 'failed'], '"' + bad + '" stops the run even for a class that may not be open: an answer that cannot be trusted is not a refusal');
    }
    w = runWorld({ 10: 'stale', 11: 'opened', 12: 'booked' });
    c = await w.run([{ eventId: 10, studioId: 4, slots: [1] }, { eventId: 11, studioId: 4, joinIfFull: true }, { eventId: 12, studioId: 4, slots: [2] }]);
    eq([results(c), c.skipped, c.booked, c.stopped, w.log.joins], [['stale', 'opened', 'booked'], 2, 1, '', 0], '"stale" and "opened" spend nothing and stop nothing — and "opened" joins nothing');

    // "1 of 2 seats held": the top-up goes out only while the booking still reads as the sheet showed it.
    const one = { bookingId: 'A', slots: [5], waitlisted: false }, two = { bookingId: 'A', slots: [5, 6], waitlisted: false };
    w = runWorld({ 10: 'booked' }, { bookings: { 10: one } });
    c = await w.run([{ eventId: 10, studioId: 4, slots: [6], held: 1 }]);
    eq([results(c), w.log.wants], [['booked'], [[10, { slots: [6] }]]], 'one seat held, as shown → the ONE missing seat is sent');
    w = runWorld({ 10: 'booked' }, { bookings: { 10: two } });
    c = await w.run([{ eventId: 10, studioId: 4, slots: [7], held: 1 }]);
    eq([results(c), w.log.wants], [['already'], []], 'two held by now (added elsewhere meanwhile) → nothing more is sent: never more seats than the member approved');
    w = runWorld({ 10: 'booked' }, { bookings: {} });
    c = await w.run([{ eventId: 10, studioId: 4, slots: [6], held: 1 }]);
    eq([results(c), w.log.wants], [['stale'], []], 'the booking it was to join has gone (cancelled meanwhile) → not the booking that was shown: nothing is sent');
    w = runWorld({ 10: 'booked' }, { bookings: { 10: one } });
    c = await w.run([{ eventId: 10, studioId: 4, slots: [6] }]);
    eq([results(c), w.log.wants], [['already'], []], 'a plain pick for a class held by now is still never booked again');
    w = runWorld({ 10: 'booked' }, { bookings: { 10: { waitlisted: true, slots: [] } } });
    c = await w.run([{ eventId: 10, studioId: 4, slots: [6], held: 1 }]);
    eq(results(c), ['already'], 'a waitlist place is not the seat that was shown');
  }

  // ── 7. The plan ──────────────────────────────────────────────────────────
  t.section('14a plan: the range is chosen once the bookings are in; rows say their seats and what may not be open yet');
  {
    const NOW = utc(2026, 9, 19, 13);
    const clashStart = app.indexOf('// ── pure:clash:start'), clashEnd = app.indexOf('// ── pure:clash:end');
    const planWorld = (o) => {
      o = o || {};
      const log = { requests: [] };
      const template = o.template || [{ dayOfWeek: 1, hour: 7, minute: 0, locationId: 2, eventTypeId: 7, instructorId: 31, label: 'Ride · Jane', seats: 2 }, { dayOfWeek: 5, hour: 7, minute: 0, locationId: 2, eventTypeId: 7, instructorId: 31, label: 'Ride · Jane' }];
      const g = {
        _myBookings: clone(o.bookings || {}), _eventCache: clone(o.cache || {}), _studioMap: {}, console: quiet, URLSearchParams,
        currentUser: { id: 1 }, getBearerToken: () => 'tok', navigator: { onLine: true },
        Date: class extends Date { static now() { return NOW; } },
        loadWeeklyTemplate: () => clone(template), _resolveTemplateLocationId: (id) => (id == null ? '' : String(id)),
        _rereadBookingsForVerify: async () => false,
        _bookingHorizon: (ms) => W._bookingHorizon(ms),
        apiFetch: async (path, opts) => {
          log.requests.push({ path, method: (opts && opts.method) || 'GET' });
          const day = new URLSearchParams(path.split('?')[1]).get('start').slice(0, 10);
          const data = [{ id: Number(day.replace(/-/g, '')), start_at: day + ' 07:00:00', event_type_id: 7, instructor_id: 31, studio_id: day === '2026-10-05' ? 9 : 4, duration: 45, max_bookable_slots: 4, is_fully_booked: false }];
          return { ok: true, status: 200, json: async () => ({ data, relations: { studios: [{ id: 4, location_id: 2, name: 'Studio 1', has_layout: true }, { id: 9, location_id: 2, name: 'Mat Room', has_layout: false }], locations: [{ id: 2, name: 'Psycle Bank' }], instructors: [{ id: 31, full_name: 'Jane' }], event_types: [{ id: 7, name: 'Ride' }] } }) };
        },
      };
      const world = t.loadPure('js/app.js', 'template', g);
      t.vm.runInContext('var _bookingsLoadState = "loaded";\n' + app.slice(clashStart, clashEnd) + '\n' + grab(app, 'function _fetchTemplateDay(') + '\n' + grab(app, 'async function planWeeklyTemplate('), world);
      return { log, plan: (start, opts) => world.planWeeklyTemplate(start, opts) };
    };
    let w = planWorld();
    let plan = await w.plan();
    eq([plan.ok, plan.rangeId, plan.weekStart, plan.weekEnd, plan.mode, plan.ranges.map((r) => r.id)], [true, 'next7', '2026-09-19', '2026-09-25', 'next7', ['next7', 'week1', 'week2', 'week3']],
      'nothing held → it opens on the next 7 days, and offers the three weeks after');
    eq(plan.rows.map((r) => [r.date, r.state, r.seats, r.heldSeats, r.count, r.beyondOpen, r.maxSeats]), [['2026-09-21', 'book', 2, 0, false, false, 4], ['2026-09-25', 'book', 1, 0, false, false, 4]],
      'rows carry the seats asked for (the saved 2, the default 1), what is held, the studio kind and the class\'s own limit');
    ok(w.log.requests.every((r) => r.method === 'GET'), 'planning reads, and only reads');

    const seat = { bookingId: 'A', slots: [5], waitlisted: false };
    w = planWorld({ bookings: { 1: seat, 2: seat }, cache: { 1: { id: 1, start_at: '2026-09-21 07:00:00', event_type_id: 7, instructor_id: 31, duration: 45 }, 2: { id: 2, start_at: '2026-09-25 07:00:00', event_type_id: 7, instructor_id: 31, duration: 45 } } });
    plan = await w.plan();
    eq([plan.rangeId, plan.weekStart], ['week2', '2026-09-28'], 'this week is already held → it opens on the first week with something still to book');

    plan = await planWorld().plan('2026-10-05');
    eq([plan.rangeId, plan.horizon.openThrough, plan.rows.map((r) => [r.date, r.beyondOpen, r.count])], ['week3', '2026-10-08', [['2026-10-05', false, true], ['2026-10-09', true, false]]],
      'three weeks ahead: Monday 5 Oct is open, Friday 9 Oct lies past what Psycle has opened (advisory) — and the Monday class is in a studio with no spot map (booked by count)');
    plan = await planWorld().plan(undefined, { newest: true });
    eq([plan.rangeId, plan.weekStart, plan.weekEnd, plan.ranges[0].id, plan.rows.map((r) => r.date)], ['newest', '2026-10-02', '2026-10-08', 'newest', ['2026-10-05', '2026-10-02']],
      '{ newest: true } (the Monday reminder\'s tap): the plan is for the batch the latest release opened, Fri 2 → Thu 8 Oct — each class on its own weekday inside it');
    plan = await planWorld().plan('2026-09-30');
    eq([plan.rangeId, plan.weekStart, plan.mode], ['', '2026-09-30', 'nextweek'], 'any start date still works (it is none of the offered ranges)');
    ok(/typeof _bookingHorizon === 'function' \? _bookingHorizon\(nowMs\) : null/.test(grab(app, 'async function planWeeklyTemplate(')), 'the horizon is advisory: without it the plan is simply silent about it');
  }

  // ── 8. Reading the spots — read-only ─────────────────────────────────────
  t.section('14a spots read: one GET /events/{id}, the member\'s own habits, nothing written');
  {
    const world = (o) => {
      o = o || {};
      const log = { requests: [] };
      const g = {
        console: quiet, _myBookings: clone(o.bookings || {}), _eventCache: { 10: { id: 10, studio_id: 4, instructor_id: 31 } },
        _studioMap: clone(o.studios || { 4: { id: 4, name: 'Studio 1', has_layout: true }, 9: { id: 9, name: 'Mat Room', has_layout: false } }),
        localStorage: { getItem: (k) => (k === 'psycle_bike_prefs' ? JSON.stringify(o.prefs || { 4: { prefer: [12, '<img>'], avoid: [3] }, 5: { prefer: [1] } }) : null) },
        _usualSlotForEvent: () => 9, _clashFor: () => null, _clashLabel: () => '',
        apiFetch: async (path, opts) => {
          log.requests.push([(opts && opts.method) || 'GET', path]);
          return { ok: o.ok !== false, status: o.ok === false ? 503 : 200, json: async () => clone(o.detail || { data: { max_bookable_slots: 4 }, slots: [8, '10', 'x'], relations: { studios: [{ id: 4, has_layout: true, layout: { slots: [{ id: 8 }, { id: 9 }, { id: 10 }] } }] } }) };
        },
      };
      g._cleanStoredBikePrefs = t.loadPure('js/app.js', 'stored-data')._cleanStoredBikePrefs; // the REAL cleaner
      const ctx = t.loadPure('js/app.js', 'template', g);
      t.vm.runInContext(grab(app, 'function _layoutFromEventDetail(') + '\n' + grab(app, 'async function templateSpotsFor('), ctx);
      return { log, ctx };
    };
    let w = world();
    let info = await w.ctx.templateSpotsFor(10, 4);
    eq([info.ok, info.kind, info.free, info.usual, info.prefer, info.avoid, info.max, info.full, info.studioName, info.layout.slots.length], [true, 'seats', [8, 10], 9, [12], [3], 4, false, 'Studio 1', 3],
      'a seat studio: the free spots, the usual one, the member\'s preferred / avoided spots (cleaned where they are read), the class\'s own limit — and the map, taken from the detail');
    eq(w.log.requests, [['GET', '/events/10']], 'ONE request, a GET');
    eq((await world({ bookings: { 10: { bookingId: 'A', slots: [9], waitlisted: false } } }).ctx.templateSpotsFor(10, 4)).held, [9], 'a seat already held there rides along (the top-up is suggested beside it)');
    info = await world().ctx.templateSpotsFor(10, 9);
    eq([info.ok, info.kind, info.layout], [true, 'count', undefined], 'a studio with no spot map: a count, nothing to choose');
    eq(await world().ctx.templateSpotsFor(10, 77), { ok: false, reason: 'studio' }, 'an unknown studio: neither a seat nor a count is guessed');
    eq(await world({ ok: false }).ctx.templateSpotsFor(10, 4), { ok: false, reason: 'read' }, 'the class could not be read → the row says so, and is left out');
    eq(await world({ detail: { data: {}, slots: [8] } }).ctx.templateSpotsFor(10, 4), { ok: false, reason: 'nomap' }, 'a seat studio with no map to be had: no spots to show, so none to book');
    eq((await world({ detail: { data: { is_fully_booked: true }, slots: [], relations: { studios: [{ id: 4, has_layout: true, layout: { slots: [{ id: 8 }] } }] } } }).ctx.templateSpotsFor(10, 4)).full, true, 'full by now → the row is left out');
    const fn = grab(app, 'async function templateSpotsFor(');
    ok(!/method:\s*'(POST|PUT|DELETE)'/.test(fn) && !/submitBooking|joinWaitlist/.test(fn), 'it cannot write: no verb but GET, no booking or waitlist call');
  }

  // ── 9. The sheet's words and counts (js/tabs.js) ─────────────────────────
  t.section('14a sheet: what starts ticked, what the button counts, what each result says');
  {
    const U = t.loadPure('js/tabs.js', 'usual-week-sheet');
    const note = (o) => U._uwPlanNote(Object.assign({ state: 'book', seats: 1, heldSeats: 0 }, o));
    eq([note({}).pickable, note({}).on], [true, true], 'a plain class, inside what is open, starts ticked');
    const closed = note({ beyondOpen: true });
    eq([closed.pickable, closed.on, closed.warn, closed.text], [true, false, true, 'May not be open yet — Psycle opens new dates on Mondays at 12:00'],
      'a class past what Psycle has opened starts UNTICKED with the advisory note — and stays tickable (advisory, never a block)');
    eq([note({ instructorChanged: true }).on, note({ state: 'waitlist' }).on], [false, false], 'a cover instructor and a waitlist row still start unticked');
    eq(note({ instructorChanged: true, beyondOpen: true }).text, 'Different instructor this week — tick to book it anyway. May not be open yet — Psycle opens new dates on Mondays at 12:00', 'both reasons are said');
    const topUp = note({ state: 'booked', seats: 2, heldSeats: 1, canAdd: true });
    eq([topUp.pickable, topUp.on, topUp.topUp, topUp.text], [true, false, true, '1 of 2 seats held — tick to add 1 more'], '"1 of 2 seats held": offered, unticked — one more seat in a class already held is the member\'s call');
    eq(note({ state: 'booked', seats: 3, heldSeats: 1, canAdd: true, count: true }).text, '1 of 3 spaces held — tick to add 2 more', 'a studio with no spot map counts spaces');
    eq([note({ state: 'booked', seats: 2, heldSeats: 2 }), note({ state: 'booked', seats: 2, heldSeats: 1, canAdd: false }), note({ state: 'booked', heldSeats: 1 })],
      [{ text: 'Already booked · 2 seats' }, { text: 'Already booked' }, { text: 'Already booked' }], 'held in full, or no room to add: not pickable');
    eq(note({ state: 'nolayout' }).pickable, undefined, 'a studio nobody knows the kind of is listed, never bookable from here');

    eq([U._uwSeatOptions(1), U._uwSeatOptions(2), U._uwSeatOptions(3), U._uwSeatOptions(4), U._uwSeatOptions(9), U._uwSeatOptions('x')], [[1, 2], [1, 2], [1, 2, 3], [1, 2, 3, 4], [1, 2, 3, 4], [1, 2]],
      'the seat control: 1 · 2 — and 3 · 4 only when the saved entry asked for them');
    eq([U._uwSeatOptions(3, 2), U._uwSeatOptions(1, 1), U._uwSeatOptions(4, 0), U._uwSeatOptions(4, null)], [[1, 2], [1], [1, 2, 3, 4], [1, 2, 3, 4]], '…never above the class\'s own max_bookable_slots');

    eq([U._uwConfirmLabel({ classes: 3, seats: 4 }), U._uwConfirmLabel({ classes: 1, seats: 1 }), U._uwConfirmLabel({ places: 2 }), U._uwConfirmLabel({ classes: 2, seats: 3, places: 1 }), U._uwConfirmLabel({}), U._uwConfirmLabel(null)],
      ['Book 3 classes · 4 seats', 'Book 1 class · 1 seat', 'Join 2 waitlists', 'Book 2 classes · 3 seats · join 1 waitlist', '', ''], 'the confirm button counts what it will SPEND (the brief\'s own example first)');

    const fmt = (d, how) => how + ':' + d;
    eq([U._uwRangeLabel({ id: 'next7', start: '2026-09-19', end: '2026-09-25' }, fmt), U._uwRangeLabel({ id: 'week2', start: '2026-09-28', end: '2026-10-04' }, fmt),
      U._uwRangeLabel({ id: 'newest', start: '2026-10-09', end: '2026-10-15' }, fmt), U._uwRangeLabel({ id: 'newest', start: '2026-10-30', end: '2026-11-05' }, fmt), U._uwRangeLabel(null, fmt)],
    ['Next 7 days', 'day:2026-09-28', 'Newly opened · weekday:2026-10-09 – full:2026-10-15', 'Newly opened · full:2026-10-30 – full:2026-11-05', ''],
    'the dates control: "Next 7 days", a short date per week, and "Newly opened · Fri 9 – Thu 15 Oct" (both halves carry their month across a month end)');

    const res = U._uwResultNote;
    eq([res('taken', { gone: 'Bike 9' }).text, res('taken', { gone: 'Bikes 9 & 10', goneMany: true }).text, res('taken').text, res('taken').again],
      ['Bike 9 was just taken — not booked. Choose again', 'Bikes 9 & 10 were just taken — not booked. Choose again', 'That spot was just taken — not booked. Choose again', true], 'a gone spot is named, nothing was booked for it, and "Choose again" is offered');
    eq([res('refused', { said: 'Booking is not open yet' }).text, res('refused').text, res('refused', { said: 'x' }).again], ['Psycle said: Booking is not open yet', 'Psycle didn\'t take this booking', undefined], 'a refusal is shown in Psycle\'s own words');
    eq([res('opened').again, res('stale').again, res('partial').warn, res('booked').ok, res('notrun').text], [true, true, true, true, 'Not attempted'], 'opened / stale offer "Choose again"; a partial booking is a warning');
    ok(['running', 'booked', 'waitlisted', 'already', 'clash', 'full', 'opened', 'nolayout', 'stale', 'taken', 'refused', 'partial', 'queued', 'unconfirmed', 'joinfailed', 'failed'].every((r) => res(r).text && res(r).text !== 'Not attempted'),
      'every result the run can answer has words of its own');

    // The wiring that makes "what is shown is what is booked" true.
    const run = tabs.slice(tabs.indexOf('      function run() {'), tabs.indexOf('      try { dialog.focus(); } catch (e) {}\n      load();'));
    ok(/p\.slots = st\.spots\[r\.index\]\.sugg\.slots\.slice\(\);/.test(run) && /p\.spaces = rowNeed\(r\);/.test(run), 'a pick carries the very spots (or count) on screen');
    ok(/var rows = picked\(\)\.filter\(rowReady\);/.test(run) && /picked\(\)\.some\(rowLoading\)\) return;/.test(run), 'a class whose spots are not on screen yet is never in the run');
    ok(/mayBeClosed: !!r\.beyondOpen/.test(run) && /held: _uwPlanNote\(r\)\.topUp \? \(Number\(r\.heldSeats\) \|\| 0\) : 0/.test(run), 'the pick says whether the class may not be open yet, and what was shown as held');
    ok(/data-uw-again>Choose again</.test(run) && /againBtn\.onclick = function \(\) \{ load\(st\.plan\.weekStart, ticked\); \};/.test(run), '"Choose again" books nothing: it lists the same dates afresh, the same classes ticked');
    ok(!/_usualSlotForEvent|\[\.\.\.availableSlotIds\]\[0\]/.test(grab(app, 'async function _bookTemplateSeat(')), 'the seat step has no auto-pick left in it');
    ok(/window\.bookTemplateWeek = async function \(opts\) \{/.test(tabs) && /opts\.range === 'newest'\) \? 'newest' : ''/.test(tabs) && /await _runUsualWeekSheet\(\{ range: range \}\);/.test(tabs) && /wantNewest: opts\.range === 'newest'/.test(tabs),
      'bookTemplateWeek() still works with no argument (or a click event) and accepts { range: \'newest\' }');
    ok(/window\.planWeeklyTemplate\(start, \{ newest: st\.wantNewest \}\)/.test(tabs), '…which reaches the plan');
    ok(/<strong class="usual-week-range">' \+ escapeHTML\(_uwDateLabel\(plan\.weekStart\) \+ ' – ' \+ _uwDateLabel\(plan\.weekEnd\)\) \+ '<\/strong>' \+\n\s*'<span>Nothing is booked until you press the button below\./.test(tabs),
      'the chosen dates are the first, bold line — then "Nothing is booked until you press the button below."');
    ok(/on the spots shown, and every seat uses a class credit or counts towards your plan/.test(tabs) && !/on your usual spot or the first free one/.test(tabs), 'the money line says what is true now: the spots shown — not "your usual or the first free one"');
    ok(/if \(st\.closed \|\| st\.running \|\| st\.choosing\) return;/.test(tabs) && /if \(st\.choosing \|\| e\.defaultPrevented/.test(tabs), 'while the seat map is up the sheet neither closes nor takes keys');
    // Every row has the same two controls: to a screen reader each says WHICH class it is for (escaped API text).
    ok(/var forClass = escapeHTML\(' for ' \+ \(r\.typeName \|\| 'this class'\) \+ ', ' \+ _uwDateLabel\(r\.date\)\);/.test(tabs) && /aria-label="Change spot' \+ forClass \+ '">Change spot</.test(tabs) && /role="group" aria-label="' \+ unit \+ forClass \+ '">/.test(tabs),
      '"Change spot for RIDE 45, Mon 21 Sept" / "Seats for …": three identical names in a row told a screen reader nothing');
    ok(/label\.replace\(\/ ·\/g, '\\u00a0·'\)/.test(tabs), 'on a phone the button label runs to two lines: the "·" is bound to the words before it, so no line starts on a bare dot');
    ok(!/<label class="usual-week-pick">[^']*data-uw-change/.test(tabs) && /\(spots \|\| ''\) \+\n\s*'<\/li>';/.test(tabs), 'the seat count and "Change spot" sit UNDER the row\'s <label>, not in it: they are not part of the checkbox\'s name, and a tap on them never ticks the row');

    // The sheet's own rules (css/crisp.css 9d): a rule that sets `display` restates [hidden], and the dates wrap rather than hide a week.
    const crisp = t.readSource('css/crisp.css');
    ok(/#usualWeekSheet \.usual-week-spots\[hidden\] \{ display: none; \}/.test(crisp) && /#usualWeekSheet \.usual-week-total\[hidden\] \{ display: none; \}/.test(crisp),
      'the spots block and the plan line set `display`, so each restates its [hidden] twin (an unticked row shows no spots; no caution → no line)');
    ok(/#usualWeekSheet \.usual-week-switch \{ display: flex; flex-wrap: wrap; gap: 0; \}/.test(crisp) && /#usualWeekSheet \.usual-week-switch-btn\.is-newest \{ flex-basis: 100%; \}/.test(crisp),
      'the dates control wraps where its labels run wide (the mono themes on a phone) — never a week hidden off its edge; "Newly opened" takes a line of its own');
    ok(/#usualWeekSheet \.usual-week-seats \.seg-btn \{ min-width: var\(--tap-min\); \}/.test(crisp) && /#usualWeekSheet \.usual-week-change \{[^}]*min-height: var\(--tap-min\);/.test(crisp), 'the seat count and "Change spot" are full tap targets');
  }

  // ── 10. "Change spot": the real seat map, in a mode that books nothing ───
  t.section('14a picker: choose-only mode — "Use bike 12", never a booking');
  {
    const sheets = t.loadPure('js/app.js', 'sheets');
    eq([sheets._pickerConfirmLabel('Bike', [12], 'Use'), sheets._pickerConfirmLabel('Bench', [3, 4], 'Use'), sheets._pickerConfirmLabel('Bike', [], 'Use'), sheets._pickerConfirmLabel('Bike', [12]), sheets._pickerConfirmLabel('Bike', [12], 'Delete')],
      ['Use bike 12', 'Use benches 3 & 4', 'Use', 'Book bike 12', 'Book bike 12'], 'the confirm reads "Use bike 12" — and any other verb is "Book"');
    eq([sheets._chooseSpotHint('Bike', 1, []), sheets._chooseSpotHint('Bike', 2, []), sheets._chooseSpotHint('Bike', 2, [12]), sheets._chooseSpotHint('Bike', 2, [12, 13]), sheets._chooseSpotHint('Bench', 3, [1]), sheets._chooseSpotHint('Bike', 1, [12])],
      ['Tap the bike you want', 'Pick 2 bikes', 'Bike 12 selected — pick 1 more', 'Bikes 12 & 13 selected — tap another to switch', 'Bench 1 selected — pick 2 more', 'Bike 12 selected — tap another to switch'],
      'its hint counts up to exactly the seats the sheet\'s row asks for');

    const classType = t.loadPure('js/app.js', 'class-type', { getCategory: (n) => ({ key: /ride/i.test(n) ? 'RIDE' : 'OTHER' }) });
    const escapeHTML = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const pickerWorld = (o) => {
      o = o || {};
      const els = {}, log = { posts: 0, done: [] };
      let seats = [];
      const el = () => { const e = { textContent: '', innerHTML: '', className: '', disabled: false, onclick: null, style: {}, attrs: {}, parentElement: null };
        e.setAttribute = (k, v) => { e.attrs[k] = String(v); }; e.appendChild = (c) => c; e.insertAdjacentElement = (pos, c) => c; return e; };
      // The svg's seats, parsed back out of the markup showBikePicker wrote (the choose block works on live nodes).
      const svg = el();
      svg.querySelectorAll = () => {
        seats = [];
        svg.innerHTML.replace(/<g class="bike-slot ([^"]*)" data-slot="([^"]*)" ?([^>]*)>/g, (m, cls, slot, rest) => {
          const classes = cls.split(/\s+/).filter(Boolean), attrs = { 'data-slot': slot };
          const oc = /onclick="([^"]*)"/.exec(rest);
          if (oc) attrs.onclick = oc[1];
          seats.push({ classes, attrs, getAttribute: (k) => (k in attrs ? attrs[k] : null), removeAttribute: (k) => { delete attrs[k]; },
            classList: { contains: (c) => classes.indexOf(c) !== -1, replace: (a, b) => { const i = classes.indexOf(a); if (i !== -1) classes[i] = b; } } });
        });
        return seats;
      };
      els.bikeSvg = svg;
      const dismiss = Object.assign(el(), { textContent: 'Cancel' });
      const win = { _changeSpotContext: null, _chooseSpotContext: o.stale || null };
      const ctx = t.vm.createContext({
        window: win, console: quiet,
        _eventCache: { 77: { start_at: '2026-09-24T19:00:00', _typeName: 'Ride 45', _instrName: 'Priya', _locName: 'Shoreditch', _studioName: 'Studio 1' } },
        document: { getElementById: (id) => els[id] || (els[id] = el()), createElement: el, querySelector: (sel) => (sel === '#bikeModal .modal-actions .btn-ghost' ? dismiss : null) },
        slotLabelForEvent: () => 'Bike', escapeHTML, _usualSlotForEvent: () => (o.usual == null ? null : o.usual), _cancelDeadline: () => null, _syncBikeSlotsA11y() {},
        classTypeKey: classType.classTypeKey, classPictogram: classType.classPictogram, _clock24: classType._clock24,
        _pickerConfirmLabel: sheets._pickerConfirmLabel, _chooseSpotHint: sheets._chooseSpotHint,
        submitBooking: async () => { log.posts++; },
      });
      t.vm.runInContext('var _bookingContext = null, _selectedSlots = [], _usualPreselected = null, MAX_SEATS = 2;\n' +
        [grab(app, 'function pluralizeSlotLabel('), grab(app, 'function showBikePicker('), grab(app, 'function _syncPickerConfirmLabel('), grab(app, 'function closeBikePicker('),
          grab(app, 'function confirmSpotChoice('), grab(app, 'async function confirmBikeBooking(')].join('\n'), ctx);
      const layout = { slots: [1, 2, 3, 4, 5, 6].map((n) => ({ id: n, x: n, y: 0 })), objects: [] };
      const open = (choose) => ctx.showBikePicker(77, null, layout, new Set(o.available || [1, 3, 4, 6]), new Set(o.mine || []), 'Studio 1',
        choose === null ? undefined : { clashLine: o.clashLine, choose: Object.assign({ count: 1, preselect: [3], done: (ids) => log.done.push(ids) }, choose || {}) });
      return { els, ctx, win, log, dismiss, open, seats: () => seats, sel: () => t.vm.runInContext('_selectedSlots.slice()', ctx) };
    };

    let w = pickerWorld({ usual: 4 });
    w.open();
    const bySlot = (n) => w.seats().filter((s) => s.attrs['data-slot'] === String(n))[0];
    eq([w.els.modalTitle.textContent, w.els.confirmBookBtn.textContent, w.els.confirmBookBtn.disabled, w.dismiss.textContent, w.els.modalHint.textContent],
      ['Choose your bike', 'Use bike 3', false, 'Back', 'Bike 3 selected — tap another to switch'], 'it opens on the sheet\'s suggestion: "Choose your bike", "Use bike 3", Back — not "Book"');
    eq([w.sel(), bySlot(3).classes, bySlot(4).classes, w.els.bikeModal.style.display], [[3], ['selected'], ['available', 'usual'], 'flex'],
      'the SUGGESTION is what starts selected — the usual bike keeps its ring but is not auto-selected over it');
    ok(w.els.confirmBookBtn.onclick === w.ctx.confirmSpotChoice && w.els.confirmBookBtn.onclick !== w.ctx.confirmBikeBooking, 'its confirm is confirmSpotChoice — not the booking handler');
    w.els.confirmBookBtn.onclick();
    eq([w.log.done, w.log.posts, w.win._chooseSpotContext, w.els.bikeModal.style.display, w.els.confirmBookBtn.textContent], [[[3]], 0, null, 'none', 'Book'],
      '"Use bike 3": the ids go back to the sheet ONCE, nothing is posted, the picker closes and is a normal picker again');

    w = pickerWorld();
    w.open();
    w.ctx.closeBikePicker();
    eq([w.log.done, w.log.posts, w.win._chooseSpotContext], [[null], 0, null], 'closed by ×, Back, Escape or the backdrop (all closeBikePicker): "no change" — answered once');
    w.ctx.closeBikePicker();
    eq(w.log.done, [null], '…and never twice');

    w = pickerWorld();
    w.open();
    await w.ctx.confirmBikeBooking(); // what the page's own onclick attribute names
    eq([w.log.posts, w.log.done], [0, [[3]]], 'even confirmBikeBooking() itself refuses to book in this mode: it hands the choice back instead');

    w = pickerWorld({ mine: [2] });
    w.open({ count: 1, preselect: [2, 9, 3] });
    eq([w.sel(), w.seats().filter((s) => s.attrs['data-slot'] === '2')[0].attrs.onclick, w.seats().filter((s) => s.attrs['data-slot'] === '2')[0].classes], [[3], undefined, ['mine']],
      'a seat already held is shown but is NO cancel button here (its handler is gone) — and only free seats can start selected');
    w = pickerWorld();
    w.open({ count: 2, preselect: [3] });
    eq([w.els.modalTitle.textContent, w.els.confirmBookBtn.disabled, w.els.modalHint.textContent], ['Choose your bikes', true, 'Bike 3 selected — pick 1 more'], 'two seats asked for, one picked: "Use" waits for exactly two');
    w.els.confirmBookBtn.onclick();
    eq([w.log.done, w.win._chooseSpotContext === null], [[], false], '…and a tap on it then does nothing');
    w = pickerWorld();
    w.open({ count: 9 });
    eq(w.win._chooseSpotContext.count, 4, 'never more than four');

    // A chooser still waiting when another picker opens is answered first.
    const waiting = [];
    w = pickerWorld({ stale: { count: 1, preselect: [], done: (ids) => waiting.push(ids) } });
    w.open(null); // an ordinary booking picker
    eq([waiting, w.win._chooseSpotContext, w.els.confirmBookBtn.onclick === w.ctx.confirmBikeBooking, w.els.modalTitle.textContent], [[null], null, true, 'Select your bikes'],
      'an ordinary picker opening over a waiting chooser: the chooser hears "no change", and this one books as it always has');

    const select = grab(app, 'function selectBike(');
    ok(/const maxSel = swapMode \? 1 : \(window\._chooseSpotContext \? window\._chooseSpotContext\.count : MAX_SEATS\);/.test(select), 'selectBike limits the picks to the row\'s seat count');
    ok(/disabled = _selectedSlots\.length !== choose\.count;/.test(select) && /_chooseSpotHint\(word, choose\.count, _selectedSlots\)/.test(select), '…and keeps "Use" live only at exactly that many');
    ok(/if \(window\._chooseSpotContext && g\.classList\.contains\('mine'\)\) \{ a\.disabled = true; a\.tabindex = -1; \}/.test(grab(app, 'function _syncBikeSlotsA11y(')), 'to a screen reader a held seat is not an action there either');
    // The sheet steps out of the page while the map is up (the map sits under it, and app.js's one key handler
    // stands aside while #usualWeekSheet exists) — _dialogOpen() stays true through the picker itself.
    const change = tabs.slice(tabs.indexOf('      function changeSpot(r, btn) {'), tabs.indexOf('      function paintPlan() {'));
    ok(/window\.showBikePicker\(r\.eventId, null, info\.layout, new Set\(info\.free\), new Set\(info\.held\), info\.studioName,\n\s*\{ clashLine: info\.clashLine, choose: \{ count: sp\.sugg\.slots\.length, preselect: sp\.sugg\.slots\.slice\(\), done: done \} \}\);\n\s*overlay\.remove\(\);/.test(change),
      'the sheet opens the REAL picker (through settings.js\'s wrapper: the fav / avoid marks) with its clash line, the suggestion preselected, limited to the row\'s seats — then steps out of the page');
    ok(/if \(!overlay\.isConnected\) document\.body\.appendChild\(overlay\);/.test(change) && /if \(answered\) return;/.test(change) && /window\.templateSpotsFor\(r\.eventId, r\.studioId\)/.test(change),
      '…comes back with the answer (once), and reads availability afresh before the map opens');
    ok(/if \(ids && ids\.length\) \{ st\.picks\[r\.index\] = ids\.slice\(\); resuggest\(r\); \}/.test(change), 'a choice becomes the row\'s pick ("Bike 12 · your pick"); Back changes nothing');
  }

  // ── 11. "Choose again" keeps WHAT was ticked, not just where ─────────────
  t.section('14a choose again: a tick survives only on a row that is still what the member ticked — and at THEIR seat count');
  {
    const U = t.loadPure('js/tabs.js', 'usual-week-sheet');
    const row = (o) => Object.assign({ index: 0, eventId: 10, state: 'book', seats: 2, heldSeats: 0, maxSeats: 4, instructorChanged: false }, o || {});
    const ranAs = (o, need) => U._uwTickOf(row(o), need);
    eq(ranAs({}, 1), { eventId: 10, state: 'book', topUp: false, cover: false, seats: 1 }, 'what the run remembers of a ticked row: the class, its state, top-up or cover, and the seats asked for');
    const keep = (kept, o) => U._uwKeepTick(kept, row(o));
    eq(keep(ranAs({}, 1), {}), { on: true, same: true, seats: 1 }, 'the same class, still bookable: ticked again — at the ONE seat the member chose, not the saved two');
    // (a) the shown seat went while the class filled: the same index is now a waitlist join.
    eq(keep(ranAs({}, 1), { state: 'waitlist' }), { on: false, same: false, seats: null },
      'ticked to BOOK a seat, re-planned as "Full — tick to join the waitlist": UNTICKED — a join is a place Psycle turns into a charge, and nobody ticked that');
    // (b) booked at one seat of a saved two: the same index is now "1 of 2 seats held — tick to add 1 more".
    eq(keep(ranAs({}, 1), { state: 'booked', heldSeats: 1, canAdd: true }), { on: false, same: false, seats: null },
      'just booked at 1 seat, re-planned as the top-up to the saved 2: UNTICKED — the extra seat is one the member declined a minute ago');
    // (d) the re-plan matched another class for that index, or a cover instructor.
    eq([keep(ranAs({}, 1), { eventId: 11 }).on, keep(ranAs({}, 1), { eventId: 11 }).seats], [true, null], 'a DIFFERENT class at that index starts by the rule every fresh row starts by (a plain class: ticked) — at its own saved count, the old one forgotten');
    eq(keep(ranAs({}, 1), { eventId: 11, instructorChanged: true }), { on: false, same: false, seats: null }, '…and a cover class there starts unticked, as always');
    eq(keep(ranAs({}, 1), { instructorChanged: true }).on, false, 'the same class that has turned into a cover class is no longer what was ticked');
    eq(keep(ranAs({ instructorChanged: true }, 2), { instructorChanged: true }), { on: true, same: true, seats: 2 }, 'a cover class the member DID tick stays ticked while it is the same one');
    eq(keep(ranAs({ state: 'waitlist' }, 1), { state: 'waitlist' }).on, true, '…as does a waitlist row they ticked themselves, while it is still that');
    eq(keep(ranAs({ state: 'waitlist' }, 1), { state: 'book' }).on, true, 'a waitlist row that has a spot again is a plain class now: its own rule (ticked), never a carried join');
    eq(keep(undefined, {}), { on: false, same: false, seats: null }, 'a row that was not in the run (unticked, or left out) stays unticked');
    eq(keep(ranAs({ beyondOpen: true }, 1), { beyondOpen: true }).on, true, 'a class past what is open that the member ticked is still their tick');
    eq(keep(ranAs({}, 1), { state: 'full' }).on, false, 'a row that can no longer be ticked at all is never on');
    // The top-up: only the SAME ask stays ticked, and it never takes a count of its own.
    const topUp = { state: 'booked', seats: 3, heldSeats: 1, canAdd: true };
    eq(keep(ranAs(topUp, 2), topUp), { on: true, same: true, seats: null }, 'a top-up the member ticked, still missing the same two seats: ticked (its count is always "what is missing")');
    eq(keep(ranAs(topUp, 2), Object.assign({}, topUp, { heldSeats: 2 })).on, false, '…but one seat of it landed meanwhile: "add 1 more" is a new ask — unticked');
    // The member's count, bounded again where it is read back.
    eq([keep(ranAs({}, 3), { maxSeats: 2 }).seats, keep(ranAs({}, 0), {}).seats, keep(ranAs({}, 9), { maxSeats: null }).seats, keep({ eventId: 10, state: 'book', topUp: false, cover: false, seats: 'lots' }, {}).seats],
      [2, 1, 4, 1], 'never above the class\'s own limit, never below one, never above four, junk = 1');
    eq(U._uwTopUpNeed({ seats: 3, heldSeats: 1 }), 2, '(the top-up\'s ask is the saved seats less the seats held)');

    ok(/rows\.forEach\(function \(r\) \{ ticked\[r\.index\] = _uwTickOf\(r, rowNeed\(r\)\); \}\);/.test(tabs), 'the run remembers each ticked row as _uwTickOf(row, the seats it asked for) — not `true`');
    ok(/var kept = _uwKeepTick\(keep\[r\.index\], r\);\n\s*on = kept\.on;\n\s*if \(kept\.seats != null\) st\.seats\[r\.index\] = kept\.seats;/.test(tabs), 'paintPlan asks _uwKeepTick per row, and puts the member\'s own count back');
    ok(/if \(!\(kept\.same && pick && pick\.length === rowNeed\(r\)\)\) st\.picks\[r\.index\] = null;/.test(tabs), 'a "Change spot" pick stands only for the same class at the same count');
    ok(!/keep\[r\.index\] === true/.test(tabs), 'the index-only rule is gone');
  }

  // ── 12. A ✓ is not "this POST landed" ────────────────────────────────────
  // The REAL seat step over the REAL submitBooking, its optimistic wrapper
  // (js/reliability.js) and _settleUnverifiedBooking — scripted answers, no network.
  t.section('14a seat step: for a class ALREADY held, the seat held before can wear the ✓ — that is never "booked"');
  {
    const rel = t.readSource('js/reliability.js');
    const region = (src, name) => {
      const out = [];
      let from = 0;
      for (;;) {
        const a = src.indexOf('// ── pure:' + name + ':start', from);
        if (a === -1) break;
        const b = src.indexOf('// ── pure:' + name + ':end', a);
        out.push(src.slice(a, b));
        from = b + 1;
      }
      if (!out.length) throw new Error('14a suite: no pure:' + name + ' block');
      return out.join('\n');
    };
    const appFns = ['function _busyLabel(', 'function pluralizeSlotLabel(', 'function formatSlots(', 'function _scheduleBookingsRefetch(',
      'async function _rereadBookingsForVerify(', 'function _announceVerifiedSeats(', 'async function _settleUnverifiedBooking(',
      'async function _clearUnverifiedBooking(', 'async function submitBooking(', 'function applyBookedState('].map((o) => grab(app, o)).join('\n');
    const wrapperSrc = grab(rel, '    window.submitBooking = async function optimisticSubmitBooking(', '    };');
    // o.studio 4 = seats, 9 = a COUNT studio · o.held = the entry held going in · o.post = an Error (no answer) or
    // { status, body } · o.reads = what each /bookings re-read finds (an entry → applied; false → not applied).
    const topUpWorld = (o) => {
      const log = { posts: [], toasts: [], reads: 0 };
      const toastEl = { className: 'toast', textContent: '' };
      const mkBtn = () => ({ textContent: 'Book', className: 'book-btn', disabled: false, dataset: {}, onclick: null, closest: () => null, removeAttribute() {} });
      const reads = (o.reads || []).slice();
      const globals = {
        _myBookings: clone(o.held ? { 10: o.held } : {}), window: {}, console: quiet,
        setTimeout: () => 0, clearTimeout() {}, getBearerToken: () => 'tok',
        document: { createElement: mkBtn, getElementById: (id) => (id === 'toast' ? toastEl : null) },
        _studioMap: { 4: { id: 4, has_layout: true, layout: { slots: [{ id: 5 }, { id: 6 }, { id: 7 }] } }, 9: { id: 9, has_layout: false } },
        _eventCache: { 10: { id: 10, studio_id: o.studio } }, _clashFor: () => null,
        apiFetch: async (path, opts) => {
          if (path === '/events/10' && !opts) return { ok: true, status: 200, json: async () => ({ data: {}, slots: o.studio === 4 ? [6, 7] : [] }) };
          if (path !== '/bookings' || !opts || opts.method !== 'POST') throw new Error('unexpected call ' + path);
          log.posts.push(JSON.parse(opts.body));
          if (log.posts.length > 1) throw new Error('a second POST /bookings went out');
          if (o.post instanceof Error) throw o.post;
          return { ok: o.post.status >= 200 && o.post.status < 300, status: o.post.status, json: async () => o.post.body || {} };
        },
        toast: (msg, type) => { log.toasts.push([msg, type]); toastEl.textContent = msg; toastEl.className = 'toast show ' + type; },
        slotLabelForEvent: () => 'Bike', showBookingConfirmation() {}, PsycleEvents: { emit() {} },
        _recordBikeHistory() {}, _rememberPlace() {}, _noteLocalBookingWrite() {}, refreshUpcomingPanel() {}, confirmUnbook() {},
        joinWaitlist: () => { throw new Error('not a waitlist test'); },
      };
      const ctx = t.loadPure('js/app.js', 'booking', globals);
      ctx.fetchMyBookings = () => {
        log.reads++;
        const r = reads.shift();
        if (!r) return Promise.resolve(false);
        ctx._myBookings = { 10: clone(r) };
        return Promise.resolve(true);
      };
      t.vm.runInContext('var _bookingsRefetchTimer = null; var _unverifiedBookings = {}; var BOOKING_VERIFY_DEADLINE_MS = 10000;\n' + appFns, ctx);
      t.vm.runInContext('var _originalSubmitBooking = submitBooking;\n' + wrapperSrc, ctx);
      ctx.submitBooking = ctx.window.submitBooking; // in the browser `window.submitBooking = …` rebinds the bare global too
      t.vm.runInContext(region(app, 'template') + '\n' + grab(app, 'function _templateRefusalText(') + '\n' + grab(app, 'async function _bookTemplateSeat('), ctx);
      const want = o.studio === 4 ? { slots: o.slots || [6] } : { spaces: 1 };
      return { log, want, run: () => ctx._bookTemplateSeat(10, o.studio, want), pending: () => !!t.vm.runInContext('_unverifiedBookings[10]', ctx), held: () => clone(ctx._myBookings[10] || null) };
    };
    const space = (ids) => ({ bookingId: ids[0], bookingIds: ids, slots: [], slotBookings: {}, waitlisted: false });
    const seats = (slots) => ({ bookingId: 'A', bookingIds: slots.map((x, i) => 'ABCD'[i]), slots, slotBookings: Object.fromEntries(slots.map((x, i) => [x, 'ABCD'[i]])), waitlisted: false });
    const timeout = () => new Error('timeout');

    // "1 of 2 spaces held — tick to add 1 more", a studio with no spot map: POST { slots: 1 }.
    let w = topUpWorld({ studio: 9, held: space(['A']), post: timeout(), reads: [space(['A'])] });
    eq([await w.run(), w.log.posts, w.pending()], ['unconfirmed', [{ event_id: 10, slots: 1 }], true],
      'the top-up\'s POST got NO answer and /bookings still shows the one space: "unconfirmed" — the run stops (it read "booked" off the ✓ of the space held before, and carried on)');
    w = topUpWorld({ studio: 9, held: space(['A']), post: { status: 500, body: { message: 'Server Error' } }, reads: [space(['A'])] });
    eq([await w.run(), w.pending()], ['unconfirmed', true], '…a 500: the same — the extra space MAY still land');
    w = topUpWorld({ studio: 9, held: space(['A']), post: { status: 409, body: { message: 'You have already booked this class' } }, reads: [space(['A']), space(['A'])] });
    eq([await w.run(), w.pending(), w.log.posts.length], ['refused', false, 1], '…a 409: Psycle added nothing, and /bookings agrees — "refused" for this class, never "booked" (nothing pending, nothing re-sent)');
    w = topUpWorld({ studio: 9, held: space(['A']), post: { status: 409, body: {} }, reads: [space(['A'])] });
    eq(await w.run(), 'unconfirmed', '…and when /bookings cannot be read a second time nobody can say: "unconfirmed" (when in doubt, stop)');
    w = topUpWorld({ studio: 9, held: space(['A']), post: { status: 201, body: { data: { id: 'B' } } } });
    eq([await w.run(), w.log.reads, w.held().bookingIds], ['booked', 0, ['A', 'B']], 'a clean 2xx that names its record: the spaces GREW — booked, with no re-read');
    w = topUpWorld({ studio: 9, held: space(['A']), post: { status: 200, body: {} }, reads: [space(['A', 'B'])] });
    eq([await w.run(), w.log.reads], ['booked', 1], 'a clean 2xx whose body names NO record looks like "nothing added" from here: /bookings is asked once, and says it landed');
    w = topUpWorld({ studio: 9, held: space(['A']), post: timeout(), reads: [space(['A', 'B'])] });
    eq([await w.run(), w.pending()], ['booked', false], 'no answer, but /bookings shows the second space: booked');
    w = topUpWorld({ studio: 9, held: null, post: { status: 201, body: { data: { id: 'A' } } } });
    eq(await w.run(), 'booked', 'a first space (nothing held before) is as it was');

    // "1 of 2 seats held": bike 5 held, bike 6 shown.
    w = topUpWorld({ studio: 4, held: seats([5]), post: { status: 409, body: { message: 'Slot already booked' } }, reads: [seats([5])] });
    eq([await w.run(), w.want.gone, w.pending()], ['taken', [6], false],
      'bike 6 went between the GET and the POST (409), the ✓ is bike 5\'s: "taken" with the spot named — this class only, "Choose again" — not "Only part of this was booked"');
    w = topUpWorld({ studio: 4, held: seats([5]), post: timeout(), reads: [seats([5])] });
    eq([await w.run(), w.pending()], ['unconfirmed', true], 'no answer and only bike 5 showing: "unconfirmed" — the run stops');
    w = topUpWorld({ studio: 4, held: seats([5]), post: { status: 201, body: { data: { id: 'B' } } } });
    eq([await w.run(), w.held().slots], ['booked', [5, 6]], 'a clean 2xx: bike 6 is NEWLY held beside bike 5 — booked');
    w = topUpWorld({ studio: 4, held: seats([5]), post: timeout(), reads: [seats([5, 6])] });
    eq(await w.run(), 'booked', 'no answer, but /bookings shows bike 6: booked');
    w = topUpWorld({ studio: 4, held: seats([5]), slots: [6, 7], post: { status: 409, body: {} }, reads: [seats([5, 6])] });
    eq(await w.run(), 'partial', 'two shown, one of them newly held: "partial" keeps its meaning — a seat DID land');
    w = topUpWorld({ studio: 4, held: seats([5]), post: { status: 409, body: {} }, reads: [seats([5, 7])] });
    eq([await w.run(), w.want.gone], ['partial', undefined], '…and so does a seat nobody showed turning up beside bike 5: the booking changed, not as agreed — the run stops');
    const seat = grab(app, 'async function _bookTemplateSeat(');
    ok(/const seatsBefore = _templateSeatsHeld\(heldBefore\);[\s\S]*await submitBooking\(/.test(seat), 'what is held is read BEFORE submitBooking (the optimistic wrapper rewrites the entry before the POST is answered)');
    ok(/typeof _unverifiedBookings !== 'undefined' && _unverifiedBookings\[String\(eventId\)\]\) return 'unconfirmed';/.test(seat), 'a ✓ over a POST that is still unverified stops the run (typeof: the function is sliced on its own elsewhere)');
  }

  // ── 13. Past what the timetable lists — per row ──────────────────────────
  t.section('14a plan: a usual class on a day Psycle has not LISTED yet says so — not "No matching class that day"');
  {
    const U = t.loadPure('js/tabs.js', 'usual-week-sheet');
    eq(U._uwPlanNote({ state: 'nomatch', beyondListed: true }), { text: 'Not on the timetable yet — Psycle adds new dates on Mondays at 12:00' },
      'Monday before 12:00, the Fri–Sun of the third week: the day is simply not on the timetable yet (advisory — the row was never tickable)');
    eq([U._uwPlanNote({ state: 'nomatch' }).text, U._uwPlanNote({ state: 'nomatch', beyondListed: false }).text], ['No matching class that day', 'No matching class that day'], 'a LISTED day with no match keeps the old reason');
    eq([U._uwPlanNote({ state: 'error', beyondListed: true }).text, U._uwPlanNote({ state: 'book', beyondListed: true, beyondOpen: true }).on, U._uwPlanNote({ state: 'full', beyondListed: true }).text],
      ['Couldn\'t load that day\'s timetable', false, 'Full, and no waitlist'], 'it changes nothing else: a read that failed, a class that WAS found (still tickable, still unticked past what is open), a full one');
    const plan = grab(app, 'async function planWeeklyTemplate(');
    ok(/beyondListed: !!\(horizon && horizon\.listedThrough && row\.date > horizon\.listedThrough\),/.test(plan), 'planWeeklyTemplate carries the listing edge per row, as it carries beyondOpen');
  }

  // ── 14. The sheet on a short phone, and what it says aloud ───────────────
  t.section('14a sheet: only what must stay pinned is pinned; the money lines are spoken; nothing is clipped');
  {
    const U = t.loadPure('js/tabs.js', 'usual-week-sheet');
    const crisp = t.readSource('css/crisp.css');
    // The long waitlist sentence (seven lines in the mono themes) is on screen only while a waitlist row is ticked.
    ok(/\(anyWaitlist \? '<span data-uw-waitlist-note hidden>' \+ escapeHTML\(UW_WAITLIST_NOTE\) \+ '<\/span>' : ''\)/.test(tabs), 'the waitlist sentence is in the sheet, hidden, only when the plan HAS a waitlist row');
    ok(/var joining = rows\.some\(function \(r\) \{ return rowKind\(r\) === 'join'; \}\);\n\s*var waitNote = body\.querySelector\('\[data-uw-waitlist-note\]'\);\n\s*if \(waitNote\) waitNote\.hidden = !joining;/.test(tabs),
      '…and shown by syncGo only while one is TICKED');
    ok(/Psycle then books you in by itself when a spot frees up, chargeable, same policy/.test(t.vm.runInContext('UW_WAITLIST_NOTE', U)), 'its words are unchanged');
    // The plan line is written while [hidden] and then revealed — silent to a screen reader. It is announced instead.
    ok(/'<div class="usual-week-total" data-uw-total hidden><\/div>'/.test(tabs) && !/class="usual-week-total" role="status"/.test(tabs), 'the plan line carries no role="status" (it would be spoken twice)');
    ok(/if \(caution && caution !== st\.saidCaution\) say\.push\(caution\);/.test(tabs) && /if \(joining && waitNote && !st\.saidWaitlist\) say\.push\(UW_WAITLIST_NOTE\.trim\(\)\);/.test(tabs) &&
      /if \(say\.length && typeof announce === 'function'\) \{ try \{ announce\(say\.join\(' '\)\); \} catch \(e\) \{\} \}/.test(tabs),
    'both money lines go through announce() — into the dialog\'s own live region — when they appear or change, once each');
    ok(/st\.saidCaution = '';\n\s*st\.saidWaitlist = false;\n\s*st\.checked = \{\};/.test(tabs), 'a fresh plan starts with nothing said');

    ok(/#usualWeekSheet \.usual-week-dialog \{ overflow-y: auto; padding-bottom: 0; \}/.test(crisp), 'the DIALOG is the fallback scroller when the pinned parts and the list\'s floor do not fit');
    ok(/#usualWeekSheet \.confirm-actions \{\n\s*position: sticky;\n\s*bottom: 0;[^}]*background: var\(--surface\);\n\}/.test(crisp), 'the buttons ride its bottom edge on their own surface (the .cds-actions recipe) — never pushed past the dialog');
    ok(/#usualWeekSheet \.usual-week-plan \{\n\s*min-height: var\(--tap-lg\);/.test(crisp) && /#usualWeekSheet \.usual-week-plan:has\(> \.usual-week-row:nth-child\(3\)\) \{ min-height: calc\(var\(--tap-lg\) \* 3\); \}/.test(crisp),
      'the list keeps a floor — a tap row per class, up to three — so a ticked class and its spots are never squeezed out of sight');
    const hasRules = crisp.split('\n').filter((l) => /#usualWeekSheet[^{]*:has\(/.test(l));
    ok(hasRules.length === 2 && hasRules.every((l) => !/,/.test(l.slice(0, l.indexOf('{')))), 'each :has() step is a rule of its own (iOS < 15.4 drops only it, and keeps the one-row floor)');
    ok(/#usualWeekSheet \.usual-week-plan \{[^}]*margin-inline: calc\(var\(--space-2\) \* -1\);\n\s*padding-inline: var\(--space-2\);/.test(crisp),
      'the scrolling list has room INSIDE for a focus ring (2px ring + 2px offset < --space-2), taken back outside: "Change spot" — where focus lands after every spot change — and the checkboxes keep their whole ring');
    ok(/#usualWeekSheet \.usual-week-plan::before \{ top: 0;/.test(crisp) && /#usualWeekSheet \.usual-week-plan::after \{ bottom: 0;/.test(crisp), 'a rule at each end of the list stays put while rows pass under it: a cut row reads as "more below"');

    // "Newly opened · Fri 25 Sept – Thu 1 Oct" in the mono themes: wider than its track.
    eq([U._uwLabelHalves('Newly opened · Fri 25 Sept – Thu 1 Oct'), U._uwLabelHalves('Next 7 days'), U._uwLabelHalves('28 Sept'), U._uwLabelHalves(null)],
      [['Newly opened\u00a0·', 'Fri 25 Sept – Thu 1 Oct'], ['Next 7 days'], ['28 Sept'], ['']], 'the label in two halves — the "·" kept with the words before it, so no line starts on a bare dot');
    ok(/_uwLabelHalves\(_uwRangeLabel\(range, rangeDate\)\)\.map\(function \(half\) \{ return '<span>' \+ escapeHTML\(half\) \+ '<\/span>'; \}\)\.join\(' '\)/.test(tabs), 'each half is its own escaped span');
    ok(/#usualWeekSheet \.usual-week-switch-btn\.is-newest,\n#usualWeekSheet \.usual-week-switch-btn\.is-newest\.active \{ min-width: 0;[^}]*white-space: normal; \}/.test(crisp) && /#usualWeekSheet \.usual-week-switch-btn > span \{ white-space: nowrap; \}/.test(crisp),
      '…that one segment may shrink and wrap — between its halves only, never inside a date');

    // Copy: what a run and a suggestion say.
    eq([U._uwResultNote('failed', { told: 'Not enough credits' }).text, U._uwResultNote('failed').text, U._uwResultNote('failed', { told: 'x' }).warn],
      ['Not enough credits', 'Couldn\'t book this class — check My Bookings before trying again', true], 'a "failed" row prints what was toasted (the toast has faded by the time the summary is read) — never "see its message"');
    ok(!/see its message/.test(tabs) && /see the note on that class/.test(tabs), '…and the summary points at the row\'s own note');
    const slots = [1, 2, 3, 4, 5, 6].map((n) => ({ id: n, x: n * 10, y: 0 }));
    const first = S._spotSuggestion({ slots, free: [4, 5, 6], avoid: [4], count: 2 });
    eq([first.slots, first.firstSkipped, S._spotWhyText(first)], [[5, 6], true, 'first free you don\'t avoid, plus the closest free'], 'a lower free spot the member avoids was passed over: "first free" would be untrue');
    eq(S._spotSuggestion({ slots, free: [4, 5], count: 1 }).firstSkipped, false, '(nothing passed over: plain "first free")');
    eq(S._spotWhyText({ why: 'usual', lost: [4, 5, 6], filled: 0 }), '4, 5 & 6 were just taken — your usual', 'three lost picks read as a list');
    ok(/if \(labels\.length > 2 && labels\.every\(function \(l\) \{ return isFinite\(Number\(l\)\); \}\)\) labels\.sort\(/.test(tabs), 'three or four suggested seats are listed in seat order ("Benches 5, 6, 10 & 11"); a pair keeps the order its reason is about');
    const sheets = t.loadPure('js/app.js', 'sheets');
    eq([sheets._pickerConfirmLabel('Bench', [5, 6, 10, 11], 'Use'), sheets._chooseSpotHint('Bike', 4, [1, 2, 3])], ['Use benches 5, 6, 10 & 11', 'Bikes 1, 2 & 3 selected — pick 1 more'], 'the seat map words the same seats the same way');
  }

  // ── 15. The Monday reminder's tap, with the sheet already up ─────────────
  t.section('14a sheet: an open, idle sheet takes the reminder tap — it lists afresh with the newly opened dates first');
  {
    const sheet = tabs.slice(tabs.indexOf('  function _runUsualWeekSheet(opts) {'), tabs.indexOf('  var _templateWeekRunning = false;'));
    ok(/function showNewest\(\) \{\n\s*if \(st\.closed \|\| st\.running \|\| st\.choosing \|\| st\.reported\) return false;\n\s*if \(st\.plan && st\.plan\.ok && st\.plan\.rangeId === 'newest'\) return true;\n\s*st\.wantNewest = true;\n\s*load\(\);\n\s*return true;\n\s*\}\n\s*window\._usualWeekSheetNewest = showNewest;/.test(sheet),
      'window._usualWeekSheetNewest: refused during a run, over the seat map and over a run\'s results; nothing to do when already there; else a fresh plan with the batch first');
    ok(/if \(window\._usualWeekSheetNewest === showNewest\) delete window\._usualWeekSheetNewest;/.test(sheet), 'the handle goes when the sheet closes');
    ok(!/showNewest[\s\S]{0,400}(bookWeeklyTemplate|submitBooking|run\(\))/.test(sheet.slice(sheet.indexOf('function showNewest'), sheet.indexOf('window._usualWeekSheetNewest = showNewest;'))), 'it books nothing and starts no run');
    ok(/st\.reported = true;/.test(sheet) && /st\.reported = false;/.test(sheet), 'results are "reported" from the end of a run until the next list');
  }

  // ── 16. The row the member is on stays on screen ─────────────────────────
  t.section('14a sheet: a tick that takes room from the list never leaves the row just ticked under its fold');
  {
    const U = t.loadPure('js/tabs.js', 'usual-week-sheet');
    const to = (cur, viewH, row, used) => U._uwScrollTopToReveal(cur, viewH, row, used);
    // 375 × 667, Cloud, as measured: the waitlist sentence took the list from 237px to 143px (254 → 168 with three rows).
    eq([to(0, 143, { top: 140, height: 98 }), to(0, 168, { top: 139, height: 98 })], [95, 69], 'the ticked row (3px / 29px of its 98 left in view) comes back WHOLE, by the least movement — its end on the list\'s fold');
    eq([to(95, 143, { top: 140, height: 98 }), to(120, 143, { top: 140, height: 98 }), to(0, 237, { top: 140, height: 97 })], [95, 120, 0], 'a row already in view moves nothing (an untick, which gives the list its room back, included)');
    eq(to(200, 143, { top: 140, height: 98 }), 140, 'a row cut by the TOP edge comes down to it');
    eq([to(30, 100, { top: 0, height: 50 }), to('junk', 100, { top: 0, height: 50 })], [0, 0], 'never below zero; a junk offset reads as the top');
    // A ticked seat row (label + spots block) is taller than a list squeezed to its floor (two rows: 112px).
    const tall = { top: 140, height: 170 }, label = { top: 140, height: 98 }, spots = { top: 238, height: 72 };
    eq([to(0, 112, tall, label), to(250, 112, tall, label)], [140, 140], 'a row TALLER than the list, just ticked: its top — the box and the class — at the list\'s top, its spots following as far as they fit');
    eq([to(0, 112, tall, spots), to(250, 112, tall, spots), to(198, 112, tall, spots)], [198, 198, 198], '…and after a seat count / "Change spot": the spots block whole, the rest of the list filled with its own row');
    eq(to(0, 100, { top: 0, height: 50 }, { top: 300, height: 40 }), 240, '(if both cannot be had, the part just used wins)');
    eq([to(40, 0, tall, label), to(40, 112, null), to(40, 112, { top: NaN, height: 98 }), to(40, 112, { top: 10, height: 0 }), to(0, 143, { top: 140, height: 98 }, { top: 140 })],
      [40, 40, 40, 40, 95], 'nothing laid out (the sheet steps out of the page while the seat map is up) → nothing moves; a part that cannot be measured is left out');

    // The REAL revealRow, against the measured boxes — LAYOUT px (offsetTop / offsetHeight), as the page has
    // them: the list 196px down its dialog and 143px tall, row 2 at 336. No fake here has getBoundingClientRect():
    // the dialog scales in as it opens, a rect is measured through that transform, and scrollTop is not.
    // `nest`: 'row' = the row is positioned (its parts measure from ITS padding edge, under a 1px top rule);
    // 'list' = the list is (rows measure from the list's). The answers must not move.
    const drive = (o) => {
      const dialog = {};
      const list = { offsetTop: 196, offsetParent: dialog, clientTop: 0, clientHeight: 143, scrollHeight: o.scrollHeight == null ? 238 : o.scrollHeight, scrollTop: o.scrollTop || 0 };
      const inList = o.nest === 'list';
      const row = { offsetTop: inList ? o.rowTop - 196 : o.rowTop, offsetHeight: o.rowH, offsetParent: inList ? list : dialog, clientTop: 1 };
      const part = (top, height) => (o.nest === 'row' ? { offsetTop: top - o.rowTop - 1, offsetHeight: height, offsetParent: row } : { offsetTop: inList ? top - 196 : top, offsetHeight: height, offsetParent: row.offsetParent });
      const pick = part(o.rowTop + 1, (o.pickH || o.rowH) - 1), spots = o.spotsH ? part(o.rowTop + o.pickH, o.spotsH) : null;
      row.querySelector = (sel) => sel === '.usual-week-pick' ? pick : sel === '[data-uw-spots]:not([hidden])' ? spots : null;
      const asked = [];
      const body = { querySelector: (sel) => { asked.push(sel); return sel === '.usual-week-plan' ? (o.noList ? null : list) : sel === '[data-uw-row="' + o.index + '"]' ? { closest: (s) => s === '.usual-week-row' ? row : null } : null; } };
      const ctx = t.vm.createContext({ st: { on: null }, body, _uwScrollTopToReveal: U._uwScrollTopToReveal, isNaN, Number, Math });
      t.vm.runInContext(grab(tabs, '      function revealRow(index, part) {', '      }') + '\nrevealRow(' + o.index + ', ' + JSON.stringify(o.part) + ');', ctx);
      return { scrollTop: list.scrollTop, on: clone(ctx.st.on), asked };
    };
    eq(drive({ index: 1, part: 'pick', rowTop: 336, rowH: 98 }), { scrollTop: 95, on: { index: 1, part: 'pick' }, asked: ['.usual-week-plan', '[data-uw-row="1"]'] },
      'the measured case: the list itself scrolls 95px and row 2 is whole again, its end on the list\'s fold; the row is remembered');
    eq(drive({ index: 1, part: 'pick', rowTop: 336, rowH: 98, scrollTop: 40 }).scrollTop, 95, 'the same from a list already scrolled (offsetTop does not move with the scroll offset)');
    const tallRow = { index: 0, part: 'spots', rowTop: 196, rowH: 170, pickH: 98, spotsH: 72, scrollHeight: 268 };
    eq(drive(tallRow).scrollTop, 27, 'a seat count in a row taller than the list: the spots block comes up whole (its end on the fold), no further');
    eq(drive({ index: 0, part: 'spots', rowTop: 336, rowH: 98 }).scrollTop, 95, 'a row with no spots block on screen (a waitlist join) goes by its label');
    eq(['row', 'list'].map((nest) => [drive({ index: 1, part: 'pick', rowTop: 336, rowH: 98, nest }).scrollTop, drive(Object.assign({ nest }, tallRow)).scrollTop]), [[95, 27], [95, 27]],
      'a row — or the list — that becomes positioned (a new offsetParent in the chain) changes no answer');
    eq([drive({ index: 1, part: 'pick', rowTop: 336, rowH: 98, scrollHeight: 143 }).scrollTop, drive({ index: 1, part: 'pick', rowTop: 336, rowH: 98, noList: true }).on], [0, { index: 1, part: 'pick' }],
      'a list with nothing to scroll is left alone; a sheet with no list on screen still remembers the row — and nothing throws');

    const sheet = tabs.slice(tabs.indexOf('  function _runUsualWeekSheet(opts) {'), tabs.indexOf('  var _templateWeekRunning = false;'));
    ok(!/\.scrollIntoView\(/.test(sheet) && /if \(to !== list\.scrollTop\) list\.scrollTop = to;/.test(sheet), 'moved by the list\'s OWN scrollTop — scrollIntoView() scrolls the dialog too and, on iOS, the page');
    ok(/if \(r\) \{ if \(box\.checked\) readSpots\(r\); paintSpots\(r\); \}\n\s*syncGo\(\);\n\s*revealRow\(Number\(box\.dataset\.uwRow\), 'pick'\);/.test(sheet), 'a tick / untick: AFTER syncGo has shown or hidden the waitlist sentence and the plan line');
    ok(/resuggest\(r\);\n\s*paintSpots\(r\);\n\s*syncGo\(\);\n\s*revealRow\(r\.index, 'spots'\);/.test(sheet) && /readSpots\(r\); paintSpots\(r\); syncGo\(\); revealRow\(r\.index, 'spots'\); \};/.test(sheet) &&
      /if \(again\) again\.scrollTop = scrollTop;\n\s*revealRow\(r\.index, 'spots'\);/.test(sheet), 'a seat count, "Try again" and the way back from the seat map: the same, by the spots block');
    ok(/paintSpots\(r\);\n\s*syncGo\(\);\n[^\n]*\n\s*if \(st\.on && st\.on\.index === r\.index\) revealRow\(r\.index, st\.on\.part\);/.test(sheet), 'a spots read that lands (the plan line can appear with it) re-checks ONLY the row the member is on…');
    ok(/st\.on = null;\n\s*st\.saidCaution = '';/.test(sheet) && (sheet.match(/revealRow\(/g) || []).length === 6, '…so the reads of a fresh plan move nothing: it starts on no row, and nothing else calls revealRow');
  }
};
