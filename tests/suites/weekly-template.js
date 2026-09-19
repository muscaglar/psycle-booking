'use strict';
// "Your usual week" (weekly template, #35/#91): the pure matching block
// (pure:template in js/app.js) and the three functions that speak it —
// planWeeklyTemplate (reads only), _bookWeeklyTemplateInner (executes the
// picks the member confirmed, one after another) and _bookTemplateSeat (a seat,
// never a waitlist place) — sliced out of SHIPPED source and run against a
// scripted API. The suite runs with TZ=America/New_York on purpose: every
// class time is London wall clock, and none of this may read the device zone.
module.exports = async function (t) {
  const { ok, eq } = t;
  const src = t.readSource('js/app.js');
  const grab = (opener, closer) => {
    const lines = src.split('\n');
    const from = lines.findIndex((l) => l.startsWith(opener));
    const to = lines.findIndex((l, i) => i > from && l === (closer || '}'));
    if (from === -1 || to === -1) throw new Error('weekly-template suite: cannot slice "' + opener + '" (anchor moved?)');
    return lines.slice(from, to + 1).join('\n');
  };
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const quiet = { log() {}, info() {}, warn() {}, error: console.error };

  const p = t.loadPure('js/app.js', 'template');
  const utc = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h, mi || 0);

  // ── Dates ────────────────────────────────────────────────────────────────
  t.section('Usual week: times are read as London wall clock, from the digits');
  eq(p._templateWall('2026-09-21 07:00:00'), { date: '2026-09-21', min: 420 }, 'a naive API time → its date and minutes past midnight');
  eq(p._templateWall('2026-09-21T18:30'), { date: '2026-09-21', min: 1110 }, '…with a T separator and no seconds too');
  eq([p._templateWall('soon'), p._templateWall(null), p._templateWall('')], [null, null, null], 'an unreadable time is null, never a guess');
  eq([p._templateDow('2026-09-21'), p._templateDow('2026-09-27'), p._templateDow('2026-03-29')], [1, 0, 0], 'weekday of a calendar date (Mon, Sun, the clock-change Sun)');
  eq([p._templateAddDays('2026-03-28', 1), p._templateAddDays('2026-03-29', 1), p._templateAddDays('2026-10-24', 2), p._templateAddDays('2026-12-29', 6)],
    ['2026-03-29', '2026-03-30', '2026-10-26', '2027-01-04'], 'calendar days add up across both clock changes and the year end');

  t.section('Usual week: "now" is London\'s, whatever zone the device is in');
  eq(p._templateLondonNow(utc(2026, 9, 21, 10, 59)), { date: '2026-09-21', min: 719 }, '10:59Z in September is 11:59 BST (the device says 06:59)');
  eq(p._templateLondonNow(utc(2026, 1, 5, 11, 59)), { date: '2026-01-05', min: 719 }, '11:59Z in January is 11:59 GMT');
  eq(p._templateLondonNow(utc(2026, 9, 20, 23, 30)), { date: '2026-09-21', min: 30 }, '23:30Z on a BST Sunday is already Monday 00:30 in London');

  t.section('Usual week: which week a tap means (Monday 12:00 London release)');
  eq(p._templateDefaultStart(utc(2026, 9, 21, 10, 59)), { mode: 'next7', start: '2026-09-21' }, 'Monday 11:59 BST: next week is not open yet → the 7 days from today');
  eq(p._templateDefaultStart(utc(2026, 9, 21, 11, 0)), { mode: 'nextweek', start: '2026-09-28' }, 'Monday 12:00 BST: the week to book is NEXT Monday–Sunday');
  eq(p._templateDefaultStart(utc(2026, 1, 5, 11, 59)), { mode: 'next7', start: '2026-01-05' }, 'the same boundary in winter (GMT): 11:59 …');
  eq(p._templateDefaultStart(utc(2026, 1, 5, 12, 0)), { mode: 'nextweek', start: '2026-01-12' }, '… and 12:00');
  eq(p._templateDefaultStart(utc(2026, 9, 24, 8, 0)), { mode: 'nextweek', start: '2026-09-28' }, 'a Thursday → next Monday');
  eq(p._templateDefaultStart(utc(2026, 9, 27, 20, 0)), { mode: 'nextweek', start: '2026-09-28' }, 'a Sunday evening → tomorrow');
  eq(p._templateDefaultStart(utc(2026, 9, 20, 23, 30)), { mode: 'next7', start: '2026-09-21' }, 'Sunday 23:30Z is Monday 00:30 in London → Monday morning rules');

  t.section('Usual week: the date an entry falls on');
  {
    const at = (dow, h, m) => ({ dayOfWeek: dow, hour: h, minute: m || 0 });
    const noon = { date: '2026-09-21', min: 12 * 60 };
    eq([1, 3, 6, 0].map((d) => p._templateDateFor(at(d, 18), '2026-09-28', noon)), ['2026-09-28', '2026-09-30', '2026-10-03', '2026-10-04'],
      'from a Monday start: Mon, Wed, Sat, Sun of that week');
    eq([4, 1].map((d) => p._templateDateFor(at(d, 18), '2026-09-24', { date: '2026-09-24', min: 600 })), ['2026-09-24', '2026-09-28'],
      'from a Thursday start (next 7 days): Thursday is today, Monday is the one coming');
    eq(p._templateDateFor(at(1, 7), '2026-09-21', { date: '2026-09-21', min: 7 * 60 }), '2026-09-28', 'today\'s slot that has already started means its NEXT occurrence');
    eq(p._templateDateFor(at(1, 18), '2026-09-21', { date: '2026-09-21', min: 7 * 60 }), '2026-09-21', '…one still to come today stays today');
    eq(p._templateDateFor(at(0, 9), '2026-03-23', { date: '2026-03-20', min: 0 }), '2026-03-29', 'DST week: Sunday of the week the clocks go forward');
  }

  // ── Matching ─────────────────────────────────────────────────────────────
  const entry = (o) => Object.assign({ dayOfWeek: 1, hour: 7, minute: 0, locationId: 2, eventTypeId: 7, instructorId: 31, label: 'Ride · Jane' }, o || {});
  const ev = (id, start, o) => Object.assign({ id, start_at: start, event_type_id: 7, instructor_id: 31, studio_id: 4, duration: 45, is_fully_booked: false, is_waitlistable: true }, o || {});
  const studios = { 4: { id: 4, has_layout: true, layout: { slots: [{ id: 1 }, { id: 2 }] } }, 9: { id: 9, has_layout: false } };
  const seat = () => ({ bookingId: 'A', slots: [5], slotBookings: { 5: 'A' }, waitlisted: false });
  const place = () => ({ bookingId: null, slots: [], slotBookings: {}, waitlisted: true, waitlist: { id: 900 } });
  const ctx = (o) => Object.assign({ date: '2026-09-28', now: { date: '2026-09-21', min: 720 }, bookings: {}, studios }, o || {});
  const pick = (r) => [r.state, r.event ? r.event.id : null];

  t.section('Usual week matching: weekday + time, within a tolerance');
  eq(pick(p._templatePlanRow(entry(), [ev(10, '2026-09-28 07:00:00')], ctx())), ['book', 10], 'the same class at the same time → book');
  eq(pick(p._templatePlanRow(entry(), [ev(10, '2026-09-28 07:15:00')], ctx())), ['book', 10], 'moved by 15 minutes → still the entry\'s class');
  eq(pick(p._templatePlanRow(entry(), [ev(10, '2026-09-28 06:40:00')], ctx())), ['book', 10], '…20 minutes earlier is the edge of the tolerance');
  eq(pick(p._templatePlanRow(entry(), [ev(10, '2026-09-28 07:25:00')], ctx())), ['nomatch', null], '25 minutes away is a different class → no match');
  eq(pick(p._templatePlanRow(entry(), [ev(10, '2026-09-28 06:45:00'), ev(11, '2026-09-28 07:10:00')], ctx())), ['book', 11], 'two in range → the nearer one');
  eq(pick(p._templatePlanRow(entry(), [ev(10, '2026-09-28 07:00:00', { event_type_id: 8 })], ctx())), ['nomatch', null], 'another class type at that time is not it');
  eq(pick(p._templatePlanRow(entry(), [ev(10, '2026-09-29 07:00:00')], ctx())), ['nomatch', null], 'the same time on another day is not it');
  eq(pick(p._templatePlanRow(entry(), [ev(10, 'soon')], ctx())), ['nomatch', null], 'a class whose time cannot be read is skipped');
  eq(pick(p._templatePlanRow(entry({ eventTypeId: '7', instructorId: '31' }), [ev(10, '2026-09-28 07:00:00')], ctx())), ['book', 10], 'ids match whether stored as numbers or strings');
  eq(pick(p._templatePlanRow(entry({ eventTypeId: null, instructorId: null }), [ev(10, '2026-09-28 07:00:00')], ctx())), ['nomatch', null],
    'an entry naming neither a type nor an instructor identifies nothing');
  eq(pick(p._templatePlanRow(entry(), [ev(10, '2026-09-21 07:00:00')], ctx({ date: '2026-09-21', now: { date: '2026-09-21', min: 7 * 60 + 5 } }))), ['nomatch', null],
    'a class that has already started today is never offered');

  t.section('Usual week matching: a clock-change week is a non-event');
  {
    // Saved in GMT (a 9:00 Sunday Ride); the week the clocks go forward its
    // start_at still reads 09:00 — and the device (New York) changed on 8 March.
    const sunday = entry({ dayOfWeek: 0, hour: 9 });
    const date = p._templateDateFor(sunday, '2026-03-23', { date: '2026-03-20', min: 0 });
    eq(pick(p._templatePlanRow(sunday, [ev(10, '2026-03-29 09:00:00')], ctx({ date, now: { date: '2026-03-20', min: 0 } }))), ['book', 10],
      'the 9:00 class on the clock-change Sunday matches a 9:00 entry');
    const back = p._templateDateFor(sunday, '2026-10-19', { date: '2026-10-16', min: 0 });
    eq([back, pick(p._templatePlanRow(sunday, [ev(11, '2026-10-25 09:00:00')], ctx({ date: back, now: { date: '2026-10-16', min: 0 } })))], ['2026-10-25', ['book', 11]],
      '…and the Sunday the clocks go back');
  }

  t.section('Usual week matching: the instructor changed');
  {
    const cover = p._templatePlanRow(entry(), [ev(10, '2026-09-28 07:00:00', { instructor_id: 44 })], ctx());
    eq([pick(cover), cover.instructorChanged], [['book', 10], true], 'a cover instructor in the usual slot is offered, flagged so the sheet asks first');
    const both = p._templatePlanRow(entry(), [ev(10, '2026-09-28 07:00:00', { instructor_id: 44 }), ev(11, '2026-09-28 07:15:00')], ctx());
    eq([pick(both), both.instructorChanged], [['book', 11], false], 'the usual instructor 15 minutes later beats a cover at the exact time');
    eq(pick(p._templatePlanRow(entry({ locationId: null }), [ev(10, '2026-09-28 07:00:00', { instructor_id: 44 })], ctx())), ['nomatch', null],
      'with no location either (a whole-day read), a different instructor is somebody else\'s class');
    const anyone = p._templatePlanRow(entry({ instructorId: null }), [ev(10, '2026-09-28 07:00:00', { instructor_id: 44 })], ctx());
    eq([pick(anyone), anyone.instructorChanged], [['book', 10], false], 'an entry that names no instructor takes whoever teaches it');
  }

  t.section('Usual week matching: class full');
  eq(pick(p._templatePlanRow(entry(), [ev(10, '2026-09-28 07:00:00', { is_fully_booked: true })], ctx())), ['waitlist', 10], 'full + waitlistable → a waitlist row (opt-in in the sheet)');
  eq(pick(p._templatePlanRow(entry(), [ev(10, '2026-09-28 07:00:00', { is_fully_booked: true, is_waitlistable: false })], ctx())), ['full', 10], 'full with no waitlist → nothing to do');

  t.section('Usual week matching: already booked');
  eq(pick(p._templatePlanRow(entry(), [ev(10, '2026-09-28 07:00:00')], ctx({ bookings: { 10: seat() } }))), ['booked', 10], 'a seat held in the matched class → already booked');
  eq(pick(p._templatePlanRow(entry(), [ev(10, '2026-09-28 07:00:00', { is_fully_booked: true })], ctx({ bookings: { 10: place() } }))), ['waitlisted', 10], 'a waitlist place held → already on the waitlist');
  eq(pick(p._templatePlanRow(entry(), [ev(10, '2026-09-28 07:00:00'), ev(11, '2026-09-28 07:15:00', { instructor_id: 44 })], ctx({ bookings: { 11: seat() } }))), ['booked', 11],
    'holding the 7:15 instead of the usual 7:00 IS the entry — the 7:00 is not offered on top of it');
  eq(pick(p._templatePlanRow(entry(), [ev(10, '2026-09-28 07:00:00'), ev(11, '2026-09-28 07:15:00')], ctx({ bookings: { 11: place() } }))), ['book', 10],
    'a mere waitlist place in the 7:15 does not stand in for a seat');

  t.section('Usual week matching: clashes and studios without a spot map');
  {
    const overlap = p._templatePlanRow(entry(), [ev(10, '2026-09-28 07:00:00')], ctx({ findClash: () => ({ kind: 'overlap', eventId: '55' }) }));
    eq([overlap.state, overlap.clash.eventId], ['clash', '55'], 'a hard overlap with a seat already held → not bookable, the clash carried for the sheet');
    const travel = p._templatePlanRow(entry(), [ev(10, '2026-09-28 07:00:00')], ctx({ findClash: () => ({ kind: 'travel', eventId: '55' }) }));
    eq([travel.state, travel.clash.kind], ['book', 'travel'], 'a tight change between two locations stays bookable, with the warning');
    eq(p._templatePlanRow(entry(), [ev(10, '2026-09-28 07:00:00')], ctx({ findClash: () => { throw new Error('cache'); } })).state, 'book', 'a clash lookup that throws is advisory — it never blocks the row');
    eq(pick(p._templatePlanRow(entry(), [ev(10, '2026-09-28 07:00:00', { studio_id: 9 })], ctx())), ['nolayout', 10], 'a no-layout studio is listed but never booked from here ({spaces:1} is unproven)');
    eq(pick(p._templatePlanRow(entry(), [ev(10, '2026-09-28 07:00:00', { studio_id: 77 })], ctx())), ['nolayout', 10], 'an unknown studio is not guessed to have a layout');
    // A LIST response's studio record: has_layout, not always the seat map (and
    // _fetchTemplateDay replaces a richer cached record with it). The plan only
    // ever reads lists — the flag decides; the map is the booking step's.
    const listShaped = { 4: { id: 4, has_layout: true } };
    eq(pick(p._templatePlanRow(entry(), [ev(10, '2026-09-28 07:00:00')], ctx({ studios: listShaped }))), ['book', 10], 'a seat studio whose list record carries no map is still a seat studio → book (it used to read "no spot map": no checkbox, nothing bookable)');
    eq(pick(p._templatePlanRow(entry(), [ev(10, '2026-09-28 07:00:00')], ctx({ studios: { 4: { id: 4, has_layout: true, layout: { slots: [] } } } }))), ['book', 10], '…and so is one with an empty map');
    eq(pick(p._templatePlanRow(entry(), [ev(10, '2026-09-28 07:00:00', { is_fully_booked: true })], ctx({ studios: listShaped }))), ['waitlist', 10], '…a full + waitlistable class there stays a waitlist row (it was lost behind the map test)');
    eq(pick(p._templatePlanRow(entry(), [ev(10, '2026-09-28 07:00:00')], ctx({ studios: { 4: { id: 4, has_layout: 1 } } }))), ['nolayout', 10], 'has_layout must be positively true');
  }

  t.section('Usual week: saving it from the seats held over the next 7 days');
  {
    const cache = {
      10: ev(10, '2026-09-21 18:30:00', { _typeName: 'Ride', _instrName: 'Jane', _locName: 'Bank' }),
      11: ev(11, '2026-09-27 09:00:00', { event_type_id: 8, instructor_id: null, _typeName: 'Strength', _locName: 'Oxford Circus' }),
      12: ev(12, '2026-09-28 07:00:00', { _typeName: 'Ride', _instrName: 'Jane', _locName: 'Bank' }),
      13: ev(13, '2026-09-23 07:00:00', { _typeName: 'Ride', _instrName: 'Tom', _locName: 'Bank' }),
      14: ev(14, '2026-09-20 07:00:00', { _typeName: 'Ride', _locName: 'Bank' }),
    };
    const bookings = { 10: seat(), 11: seat(), 12: seat(), 13: place(), 14: seat(), 15: seat() };
    const got = p._templateFromSeats(bookings, cache, { date: '2026-09-21', min: 720 }, (e) => (e._locName === 'Bank' ? 2 : null));
    eq(got.map((e) => [e.dayOfWeek, e.hour, e.minute, e.locationId, e.eventTypeId, e.instructorId, e.label, e.locName]),
      [[1, 18, 30, 2, 7, 31, 'Ride · Jane', 'Bank'], [0, 9, 0, null, 8, null, 'Strength', 'Oxford Circus']],
      'real seats from today to today+6, Monday first — not the waitlist place, next Monday, yesterday, or a class with no cache entry');
    eq(got[0].dayOfWeek, 1, 'an 18:30 Monday class is a MONDAY entry on a New York device too (the digits, not the device zone)');
    eq(p._templateFromSeats({ 10: seat(), 16: seat() }, { 10: cache[10], 16: Object.assign({}, cache[10], { id: 16 }) }, { date: '2026-09-21', min: 0 }, () => 2).length, 1,
      'two seats in the same slot (a guest) save one entry');
    eq(p._templateFromSeats(bookings, cache, { date: '2026-09-21', min: 0 }).map((e) => e.locationId), [null, null], 'with no resolver the location stays null — never the studio id');
  }

  // ── The run: only what was ticked, one after another ─────────────────────
  // `script[eventId]` = what the seat attempt answers for that class;
  // `o.joins[eventId] === false` = PUT /waitlists fails for it.
  const runWorld = (script, o) => {
    o = o || {};
    const log = { calls: [], progress: [], refetch: 0, dismissed: 0 };
    const state = { token: 'tok', online: true };
    const g = {
      _myBookings: clone(o.bookings || {}), currentUser: { id: 1 }, console: quiet,
      navigator: { get onLine() { return state.online; } },
      getBearerToken: () => state.token,
      dismissBookingConfirmation: () => { log.dismissed++; },
      fetchMyBookings: async () => { log.refetch++; return true; },
      _rereadBookingsForVerify: async () => true,
      loadWeeklyTemplate: () => [entry()],
      _bookEventHeadless: async () => { throw new Error('the run never takes the book-OR-join path: a join happens only where its box was ticked'); },
    };
    g._bookTemplateSeat = async (id) => {
      log.calls.push('seat:' + id + ':start');
      await new Promise((r) => setTimeout(r, 1));
      const answer = script[id];
      log.calls.push('seat:' + id + ':end');
      if (answer === '401') { state.token = null; return 'taken'; }
      if (answer === 'offline-after') { state.online = false; return 'booked'; }
      return answer;
    };
    g.joinWaitlist = async (id, btn, opts) => {
      log.calls.push('join:' + id + ':' + JSON.stringify([btn, opts]));
      // joinWaitlist's "couldn't tell" branch: a bare false, flagged on the opts.
      if ((o.joins || {})[id] === 'unsure') { opts.unsure = true; return false; }
      return (o.joins || {})[id] !== false;
    };
    const world = t.loadPure('js/app.js', 'template', g);
    t.vm.runInContext('var _bookingsLoadState = "loaded";\n' + grab('async function _bookWeeklyTemplateInner('), world);
    const run = (picks, hooks) => world._bookWeeklyTemplateInner({ booked: 0, waitlisted: 0, failed: 0, skipped: 0 }, picks,
      Object.assign({ onProgress: (i, r) => log.progress.push(i + ':' + r) }, hooks || {}));
    return { log, state, run };
  };
  const results = (c) => c.results.map((r) => r.result);

  t.section('Usual week run: never a one-tap spend');
  {
    const w = runWorld({});
    const none = await w.run(undefined);
    eq([w.log.calls, none.booked, none.results, w.log.refetch], [[], 0, [], 0], 'called with no picks — a template IS saved — it books nothing and fetches nothing');
    eq((await w.run([])).results, [], '…nor with an empty list');
    eq(w.log.calls, [], 'no booking step ran');
  }

  t.section('Usual week run: sequential, and the waitlist only where it was ticked');
  {
    const w = runWorld({ 10: 'booked', 11: 'full', 12: 'full', 13: 'booked' });
    const c = await w.run([{ eventId: 10, studioId: 4 }, { eventId: 11, studioId: 4, joinIfFull: true }, { eventId: 12, studioId: 4 }, { eventId: 13, studioId: 4, joinIfFull: true }]);
    eq(w.log.calls, ['seat:10:start', 'seat:10:end', 'seat:11:start', 'seat:11:end', 'join:11:[null,{"quiet":true}]', 'seat:12:start', 'seat:12:end', 'seat:13:start', 'seat:13:end'],
      'one class at a time, each settled before the next starts; ONE waitlist join — the full class whose box was ticked (quietly)');
    eq([c.booked, c.waitlisted, c.failed, c.skipped, c.stopped, results(c)], [2, 1, 0, 1, '', ['booked', 'waitlisted', 'full', 'booked']],
      'a full class that was NOT ticked stays "full"; a ticked one where a seat had opened up is simply booked');
    eq(w.log.progress, ['0:running', '0:booked', '1:running', '1:waitlisted', '2:running', '2:full', '3:running', '3:booked'], 'the sheet hears each class start and finish');
    eq([w.log.dismissed, w.log.refetch], [4, 1], 'the per-booking slide-up is dismissed each time (the sheet reports instead); bookings are re-read once at the end');
  }

  t.section('Usual week run: what stops it, and what does not');
  {
    let w = runWorld({ 10: 'booked', 11: 'failed', 12: 'booked' });
    let c = await w.run([{ eventId: 10, studioId: 4 }, { eventId: 11, studioId: 4 }, { eventId: 12, studioId: 4 }]);
    eq([results(c), c.stopped, w.log.calls.filter((x) => /^seat:12/.test(x))], [['booked', 'failed', 'notrun'], 'failed', []],
      'Psycle refused a seat (no credits, plan) → the run stops; the class after it is never attempted');
    w = runWorld({ 10: 'unconfirmed', 11: 'booked' });
    c = await w.run([{ eventId: 10, studioId: 4 }, { eventId: 11, studioId: 4 }]);
    eq([results(c), c.stopped], [['unconfirmed', 'notrun'], 'failed'], 'an answer that could not be confirmed stops it too (the next POST could land twice)');
    w = runWorld({ 10: 'taken', 11: 'full', 12: 'clash', 13: 'booked' });
    c = await w.run([10, 11, 12, 13].map((id) => ({ eventId: id, studioId: 4 })));
    eq([results(c), c.stopped, c.booked, c.failed, c.skipped], [['taken', 'full', 'clash', 'booked'], '', 1, 1, 2],
      'a seat someone else just took, a class that filled up and a clash are that class\'s problem only — the run carries on');
    w = runWorld({ 10: 'full', 11: 'booked' }, { joins: { 10: false } });
    c = await w.run([{ eventId: 10, studioId: 4, joinIfFull: true }, { eventId: 11, studioId: 4 }]);
    eq([results(c), c.stopped, c.failed], [['joinfailed', 'booked'], '', 1], 'a waitlist join that failed spends nothing and stops nothing');
    w = runWorld({ 10: 'full', 11: 'booked' }, { joins: { 10: 'unsure' } });
    c = await w.run([{ eventId: 10, studioId: 4, joinIfFull: true }, { eventId: 11, studioId: 4 }]);
    eq([results(c), c.stopped, w.log.calls.filter((x) => /^seat:11/.test(x))], [['unconfirmed', 'notrun'], 'failed', []],
      'a join Psycle may have TAKEN (PUT timed out, lookup failed) is "unconfirmed", never "couldn\'t be joined" — a place can become a charge — and the run stops on it');
    w = runWorld({ 10: 'failed', 11: 'booked' });
    c = await w.run([{ eventId: 10, studioId: 4, joinIfFull: true }, { eventId: 11, studioId: 4 }]);
    eq([results(c), c.stopped, w.log.calls.filter((x) => /^join/.test(x))], [['failed', 'notrun'], 'failed', []],
      'a ticked-waitlist class whose seat had opened up but Psycle refused it stops the run like any other refusal — and joins nothing');
    w = runWorld({ 10: '401', 11: 'booked' });
    c = await w.run([{ eventId: 10, studioId: 4 }, { eventId: 11, studioId: 4 }]);
    eq([results(c), c.stopped], [['taken', 'notrun'], 'auth'], 'the session expired part-way → stop; nothing after it can book');
    w = runWorld({ 10: 'offline-after', 11: 'booked' });
    c = await w.run([{ eventId: 10, studioId: 4 }, { eventId: 11, studioId: 4 }]);
    eq([results(c), c.stopped, w.log.calls.length], [['booked', 'notrun'], 'offline', 2], 'offline → stop BEFORE the next class (the offline wrapper would queue a booking for later)');
    w = runWorld({ 10: 'booked', 11: 'booked' });
    let asked = 0;
    c = await w.run([{ eventId: 10, studioId: 4 }, { eventId: 11, studioId: 4 }], { shouldStop: () => ++asked > 1 });
    eq([results(c), c.stopped], [['booked', 'notrun'], 'user'], '"Stop after this class" is honoured between classes');
    w = runWorld({ 10: 'booked' }, { bookings: { 10: seat() } });
    c = await w.run([{ eventId: 10, studioId: 4 }]);
    eq([results(c), c.skipped, w.log.calls], [['already'], 1, []], 'a class held by the time the run reaches it (a stale sheet) is never booked again');
  }

  // ── A seat, never a waitlist place ───────────────────────────────────────
  // `detail` = what GET /events/{id} answers; `label` = what submitBooking
  // leaves on the button (its label contract); `lands` = the seat shows up.
  const seatWorld = (detail, o) => {
    o = o || {};
    const log = { posts: [], joins: 0, gets: [] };
    const g = {
      _myBookings: {}, _eventCache: { 10: { id: 10, studio_id: o.studio || 4 } }, _studioMap: clone(o.studios || studios), console: quiet,
      document: { createElement: () => ({ className: '', textContent: '' }) },
      apiFetch: async (path, opts) => {
        log.gets.push((opts && opts.method) || 'GET');
        return { ok: o.getOk !== false, status: o.getOk === false ? 500 : 200, json: async () => clone(detail) };
      },
      _clashFor: () => (o.clash || null),
      _usualSlotForEvent: () => (o.usual == null ? null : o.usual),
      joinWaitlist: async () => { log.joins++; return true; },
      submitBooking: async (id, slots, btn, opts) => {
        log.posts.push({ id, slots, opts: opts || null });
        btn.textContent = o.label || 'Bike 2 ✓';
        if (o.lands !== false) g._myBookings[String(id)] = { bookingId: 1, slots, waitlisted: false };
      },
    };
    const world = t.vm.createContext(Object.assign({ Set, Number, String, Array, Object }, g));
    // `helper`: with app.js's _layoutFromEventDetail beside it, as in the app.
    t.vm.runInContext((o.helper ? grab('function _layoutFromEventDetail(') + '\n' : '') + grab('async function _bookTemplateSeat('), world);
    // The function reads the bare global; keep the world's and the stub's map the same object.
    g._myBookings = world._myBookings;
    return { log, world, run: () => world._bookTemplateSeat(10, o.studio || 4) };
  };

  t.section('Usual week seat: a class that filled up is NOT turned into a waitlist place');
  {
    let w = seatWorld({ data: { is_fully_booked: true, is_waitlistable: true }, slots: [] });
    eq([await w.run(), w.log.joins, w.log.posts], ['full', 0, []], 'full by the time the run gets there → "full": no PUT /waitlists, no POST');
    w = seatWorld({ data: { is_fully_booked: false }, slots: [] });
    eq([await w.run(), w.log.joins, w.log.posts], ['full', 0, []], 'no free slot in a layout studio counts as full as well');
    w = seatWorld({ data: {}, slots: [2, 5] }, { usual: 5 });
    eq([await w.run(), w.log.posts], ['booked', [{ id: 10, slots: [5], opts: null }]], 'the member\'s usual spot is booked when it is free');
    w = seatWorld({ data: {}, slots: [2, 5] }, { usual: 9 });
    eq([await w.run(), w.log.posts[0].slots], ['booked', [2]], '…otherwise the first free one');
    w = seatWorld({ data: {}, slots: [2] }, { studio: 9 });
    eq([await w.run(), w.log.posts], ['nolayout', []], 'a no-layout studio is never booked from here — no {spaces:1} body goes out');
    w = seatWorld({ data: {}, slots: [2] }, { clash: { kind: 'overlap' } });
    eq([await w.run(), w.log.posts], ['clash', []], 'a class overlapping one booked earlier in the same run is skipped');
    w = seatWorld({ data: {}, slots: [2] }, { clash: { kind: 'travel' } });
    eq(await w.run(), 'booked', 'a tight change of location is the member\'s own template — still booked');
    w = seatWorld({ data: {}, slots: [2] }, { getOk: false });
    eq([await w.run(), w.log.posts], ['failed', []], 'the class could not be read → failed, nothing posted');
  }

  t.section('Usual week seat: the studio record has no seat map (a list response replaced it)');
  {
    // What _fetchTemplateDay leaves in _studioMap when the list's relations
    // carry has_layout only; the GET /events/{id} this step reads has the map.
    const listShaped = { 4: { id: 4, has_layout: true } };
    const withMap = (o) => Object.assign({ data: {}, slots: [9, 12], relations: { studios: [{ id: 4, has_layout: true, layout: { slots: [{ id: 9 }, { id: 12 }] } }] } }, o || {});
    let w = seatWorld(withMap(), { studios: listShaped, helper: true });
    eq([await w.run(), w.log.posts], ['booked', [{ id: 10, slots: [9], opts: null }]], 'the map is taken from the class detail → a seat is booked (it used to answer "nolayout" with no POST)');
    eq(w.world._studioMap[4].layout.slots.length, 2, '…and kept on the studio record for the next class');
    w = seatWorld(withMap({ slots: [9, 12] }), { studios: listShaped, helper: true, usual: 12 });
    eq([await w.run(), w.log.posts[0].slots], ['booked', [12]], 'the usual spot still wins');
    w = seatWorld({ data: {}, slots: [9] }, { studios: listShaped, helper: true });
    eq([await w.run(), w.log.posts], ['nolayout', []], 'no map anywhere → this class only ("nolayout"), never "failed": that would stop the run and blame Psycle for a POST that was never sent');
    w = seatWorld(withMap(), { studios: listShaped });
    eq([await w.run(), w.log.posts], ['nolayout', []], '(sliced without the helper, the typeof guard holds)');
    w = seatWorld({ data: { is_fully_booked: true }, slots: [] }, { studios: listShaped, helper: true });
    eq([await w.run(), w.log.posts, w.log.joins], ['full', [], 0], 'a FULL class needs no map to be reported full');
    w = seatWorld(withMap({ slots: [] }), { studios: listShaped, helper: true });
    eq([await w.run(), w.log.posts], ['full', []], 'a map but no free slot → full');
    w = seatWorld(withMap(), { studios: { 4: { id: 4, has_layout: false } }, helper: true });
    eq([await w.run(), w.log.posts], ['nolayout', []], 'a studio not positively a seat studio is never booked from here, whatever the detail carries');
  }

  t.section('Usual week seat: submitBooking\'s label contract tells "taken" from "refused"');
  {
    const outcome = async (label, lands) => (await seatWorld({ data: {}, slots: [2] }, { label, lands }).run());
    eq(await outcome('Bike 2 ✓', true), 'booked', '✓ and a seat in state → booked');
    eq(await outcome('Bike 2 ✓', false), 'failed', '✓ without a seat in state is not a booking (the optimistic label alone proves nothing)');
    eq(await outcome('Book', false), 'taken', '"Book" = the seat went to someone else → this class only');
    eq(await outcome('Failed — retry', false), 'failed', '"Failed — retry" = Psycle refused (credits, plan) → the run stops on it');
    eq(await outcome('Unconfirmed — retry', false), 'unconfirmed', '"Unconfirmed — retry" → the run stops on it');
    eq(await outcome('Queued', false), 'queued', '"Queued" (offline wrapper) is reported as such, never as booked');
  }

  // ── joinWaitlist says when it could not tell ─────────────────────────────
  t.section('Usual week: joinWaitlist flags "couldn\'t tell" on the opts it was given');
  {
    // put / lookup: what PUT /waitlists/{id} and the follow-up place lookup answer.
    const joinWorld = (put, lookup) => {
      const log = { toasts: [] };
      const g = {
        console: quiet, navigator: { onLine: true }, setTimeout: () => 0,
        window: {}, // _friendlyError reads window.PsycleAPI (absent here → the caller's own fallback wording)
        document: { createElement: () => ({ textContent: '', disabled: false }) },
        _busyLabel: () => {}, toast: (msg, type) => log.toasts.push({ msg, type }), fetchMyBookings: () => {},
        _waitlistEntryFromResponse: () => null, _recordShape: () => {},
        _isAlreadyOnWaitlistResponse: () => false,
        _fetchWaitlistEntryForEvent: async () => lookup,
        apiFetch: async () => { if (put instanceof Error) throw put; return { ok: false, status: put, json: async () => ({ message: 'no' }) }; },
      };
      const world = t.vm.createContext(g);
      // joinWaitlist's failure path words its toast through the REAL _friendlyError.
      t.vm.runInContext(grab('function _friendlyError(') + '\n' + grab('async function joinWaitlist('), world);
      return { log, join: (opts) => world.joinWaitlist(10, null, opts) };
    };
    const flag = async (put, lookup) => { const opts = { quiet: true }; const joined = await joinWorld(put, lookup).join(opts); return [joined, opts.unsure === true]; };
    eq(await flag(new Error('Request timed out'), { known: false }), [false, true], 'PUT timed out and the lookup failed too → false, flagged unsure (the place may exist)');
    eq(await flag(500, { known: false }), [false, true], 'a 5xx whose lookup failed → the same');
    eq(await flag(new Error('Request timed out'), { known: true, entry: null }), [false, false], 'PUT timed out but Psycle positively lists no place → a plain failure');
    eq(await flag(403, { known: false }), [false, false], 'a definite refusal is not "unsure"');
    ok(/const joinOpts = \{ quiet: true \};[\s\S]{0,200}joinOpts\.unsure \? 'unconfirmed' : 'joinfailed'/.test(grab('async function _bookWeeklyTemplateInner(')),
      'the run reads that flag off the opts object it passed');
  }

  // ── The plan reads, and only reads ───────────────────────────────────────
  t.section('Usual week plan: GETs only, every entry listed with its state');
  {
    const clashStart = src.indexOf('// ── pure:clash:start');
    const clashEnd = src.indexOf('// ── pure:clash:end');
    ok(clashStart !== -1 && clashEnd > clashStart, 'app.js carries the pure:clash block the plan borrows _findClash from');
    const planWorld = (o) => {
      o = o || {};
      const log = { requests: [] };
      const template = o.template || [entry(), entry({ dayOfWeek: 3, hour: 18, minute: 30, eventTypeId: 8, instructorId: null, label: 'Strength' }), entry({ dayOfWeek: 5, label: 'Ride · Jane (Fri)' })];
      const g = {
        _myBookings: clone(o.bookings || {}), _eventCache: clone(o.cache || {}), _studioMap: {}, console: quiet, URLSearchParams,
        currentUser: o.user === null ? null : { id: 1 }, getBearerToken: () => 'tok', navigator: { onLine: o.online !== false },
        loadWeeklyTemplate: () => clone(template),
        _resolveTemplateLocationId: (id) => (id == null ? '' : String(id)),
        _rereadBookingsForVerify: async () => false,
        apiFetch: async (path, opts) => {
          log.requests.push({ path, method: (opts && opts.method) || 'GET' });
          const q = new URLSearchParams(path.split('?')[1]);
          const day = q.get('start').slice(0, 10);
          if (day === '2099-01-09') return { ok: false, status: 503, json: async () => ({}) };
          const data = [];
          if (day === '2099-01-05') data.push(ev(10, '2099-01-05 07:00:00'), ev(12, '2099-01-05 07:10:00', { instructor_id: 44 }));
          if (day === '2099-01-07') data.push(ev(11, '2099-01-07 18:30:00', { event_type_id: 8, instructor_id: 44, is_fully_booked: true }));
          return { ok: true, status: 200, json: async () => ({ data, relations: {
            // As the live list response can be: has_layout, no seat map.
            studios: [{ id: 4, location_id: 2, name: 'Studio 1', has_layout: true }],
            locations: [{ id: 2, name: 'Psycle Bank' }], instructors: [{ id: 31, full_name: 'Jane <b>Doe</b>' }, { id: 44, full_name: 'Tom' }],
            event_types: [{ id: 7, name: 'Ride' }, { id: 8, name: 'Strength' }],
          } }) };
        },
      };
      const world = t.loadPure('js/app.js', 'template', g);
      t.vm.runInContext('var _bookingsLoadState = ' + JSON.stringify(o.state || 'loaded') + ';\n' + src.slice(clashStart, clashEnd) + '\n' +
        grab('function _fetchTemplateDay(') + '\n' + grab('async function planWeeklyTemplate('), world);
      return { log, world, plan: (start) => world.planWeeklyTemplate(start) };
    };

    eq(p._templateDow('2099-01-05'), 1, '(2099-01-05 is a Monday)');
    const w = planWorld();
    const plan = await w.plan('2099-01-05');
    eq([plan.ok, plan.weekStart, plan.weekEnd, plan.mode], [true, '2099-01-05', '2099-01-11', 'nextweek'], 'the week asked for, Monday to Sunday');
    eq(plan.rows.map((r) => [r.index, r.date, r.state, r.eventId]),
      [[0, '2099-01-05', 'book', 10], [1, '2099-01-07', 'waitlist', 11], [2, '2099-01-09', 'error', null]],
      'every entry comes back, in template order, with its state — a day that could not be read says so instead of "no class"');
    eq([plan.rows[0].typeName, plan.rows[0].instrName, plan.rows[0].locName, plan.rows[0].studioId], ['Ride', 'Jane <b>Doe</b>', 'Bank', 4],
      'rows carry the names the sheet shows (raw API text — the sheet escapes it)');
    ok(w.log.requests.length === 3 && w.log.requests.every((r) => r.method === 'GET' && /^\/events\?/.test(r.path)),
      'planning sent nothing but GET /events (one per day+location): ' + JSON.stringify(w.log.requests.map((r) => r.method)));
    eq(Object.keys(w.world._myBookings), [], 'and it left the member\'s bookings alone');
    {
      // A richer record cached earlier is replaced by the list's (Object.assign) — the plan must not depend on it.
      const rich = planWorld({ template: [entry()] });
      rich.world._studioMap[4] = { id: 4, has_layout: true, layout: { slots: [{ id: 1 }] } };
      eq([(await rich.plan('2099-01-05')).rows[0].state, !!rich.world._studioMap[4].layout], ['book', false], 'a cached seat map wiped by the list record still plans as "book"');
    }

    const held = planWorld({ bookings: { 55: seat() }, cache: { 55: { id: 55, start_at: '2099-01-05 07:30:00', duration: 45, _typeName: 'Ride', _locName: 'Bank' } }, template: [entry()] });
    const clashPlan = await held.plan('2099-01-05');
    eq([clashPlan.rows[0].state, clashPlan.rows[0].clashLine], ['clash', 'Clashes with your 07:30 Ride at Bank'], 'a held 7:30 turns the 7:00 row into a named clash');

    eq((await planWorld({ state: 'failed' }).plan('2099-01-05')).reason, 'bookings', 'bookings never loaded and unreadable → no plan (every held class would read as bookable)');
    eq((await planWorld({ online: false }).plan('2099-01-05')).reason, 'offline', 'offline → no plan');
    eq((await planWorld({ user: null }).plan('2099-01-05')).reason, 'signedout', 'signed out → no plan');
    eq((await planWorld({ template: [] }).plan('2099-01-05')).reason, 'empty', 'nothing saved → no plan');
    const wide = planWorld({ template: [entry({ locationId: null })] });
    await wide.plan('2099-01-05');
    ok(!/location=/.test(wide.log.requests[0].path), 'an entry with no location reads the whole day rather than sending location=');
  }

  // ── The slide-up the run dismisses ───────────────────────────────────────
  // Seen in a real browser: two classes settling ~260ms apart left "Booked!" on
  // screen for good. A dismissed sheet stays in the document for its slide-out
  // (≤400ms) and both sheets carried id="bookingConfirmation": getElementById
  // returned the dying one, so the second dismiss cleared the new sheet's timer
  // and never touched the sheet. The REAL show / dismiss pair on a fake
  // document that answers getElementById as a browser does (first match), with
  // a hand-wound clock.
  t.section('Usual week run: the "Booked!" sheet it dismisses is really gone');
  {
    const sheetWorld = () => {
      const kids = [];
      const mkEl = () => {
        const attrs = {}, cls = new Set(), on = {};
        const el = {
          get id() { return attrs.id || ''; }, set id(v) { attrs.id = String(v); },
          className: '', innerHTML: '',
          classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) },
          removeAttribute: (n) => { delete attrs[n]; },
          addEventListener: (type, fn) => { (on[type] = on[type] || []).push(fn); },
          fire: (type) => (on[type] || []).splice(0).forEach((fn) => fn()), // every listener here is { once: true }
          get parentNode() { return kids.includes(el) ? body : null; },
          get isConnected() { return kids.includes(el); },
          contains: (other) => other === el.focused,
          remove: () => { const i = kids.indexOf(el); if (i !== -1) kids.splice(i, 1); },
        };
        return el;
      };
      const body = { appendChild: (el) => { kids.push(el); } };
      const timers = [], frames = [];
      let now = 0, seq = 0;
      const g = {
        _eventCache: {}, announce() {}, escapeHTML: (s) => String(s),
        slotLabelForEvent: () => 'Bike', formatSlots: (label, slots) => label + ' ' + slots.join(' & '), _cancelDeadline: () => null,
        document: {
          body, activeElement: null, createElement: mkEl,
          getElementById: (id) => kids.find((k) => k.id === id) || null,
          querySelectorAll: (sel) => {
            if (sel === '#bookingConfirmation') return kids.filter((k) => k.id === 'bookingConfirmation');
            if (sel === '.booking-confirmation') return kids.filter((k) => k.className === 'booking-confirmation');
            throw new Error('fake DOM: ' + sel);
          },
        },
        requestAnimationFrame: (fn) => { frames.push(fn); },
        setTimeout: (fn, ms) => { timers.push({ id: ++seq, at: now + ms, fn }); return seq; },
        clearTimeout: (id) => { const i = timers.findIndex((x) => x.id === id); if (i !== -1) timers.splice(i, 1); },
      };
      const ctx = t.vm.createContext(g);
      t.vm.runInContext('let _confirmationTimer = null;\n' + grab('function showBookingConfirmation(') + '\n' + grab('function dismissBookingConfirmation('), ctx, { filename: 'js/app.js[booking confirmation]' });
      return {
        ctx, kids,
        frame: () => frames.splice(0).forEach((fn) => fn()),
        // Due timers in time order, including any they arm on the way.
        advance: (ms) => {
          const until = now + ms;
          for (;;) {
            const due = timers.filter((x) => x.at <= until).sort((a, b) => a.at - b.at || a.id - b.id)[0];
            if (!due) break;
            timers.splice(timers.indexOf(due), 1);
            now = due.at;
            due.fn();
          }
          now = until;
        },
        timer: () => t.vm.runInContext('_confirmationTimer', ctx),
        shown: () => kids.filter((k) => k.classList.contains('show')).length,
      };
    };

    // The run as the browser saw it: each sheet dismissed the moment its class
    // settles (before its first frame), the second class 259ms after the first.
    let w = sheetWorld();
    w.ctx.showBookingConfirmation(10, [12]);
    w.ctx.dismissBookingConfirmation();
    w.frame();
    eq([w.kids.length, w.shown()], [1, 0], 'dismissed before its first frame: the sheet is still in the document for its slide-out, and that frame does NOT slide it in');
    w.advance(259);
    w.ctx.showBookingConfirmation(11, [7]);
    eq([w.kids.length, w.ctx.document.getElementById('bookingConfirmation') === w.kids[1]], [2, true], 'the second class raises its sheet while the first is still leaving — and only the NEW one answers to the id');
    w.ctx.dismissBookingConfirmation();
    w.frame();
    eq([w.shown(), w.ctx.document.getElementById('bookingConfirmation'), w.timer()], [0, null, null],
      'the run\'s dismiss reaches the new sheet: nothing shown, nothing findable (what the history prompt, the queued-booking dialog and the iOS reminder ask poll for), no timer left');
    w.advance(6500);
    eq([w.kids.length, w.shown()], [0, 0], '6.5s later no sheet is left in the document (it stayed up until "Done" was tapped)');

    // Both sheets got their frame before the dismiss (a slower device): same end.
    w = sheetWorld();
    w.ctx.showBookingConfirmation(10, [12]);
    w.frame();
    w.ctx.dismissBookingConfirmation();
    w.advance(259);
    w.ctx.showBookingConfirmation(11, [7]);
    w.frame();
    eq(w.shown(), 1, '(the second sheet slid in)');
    w.ctx.dismissBookingConfirmation();
    eq(w.shown(), 0, '…and the dismiss slides THAT one out, not the first again');
    w.kids.slice().forEach((k) => k.fire('transitionend'));
    eq(w.kids.length, 0, 'each leaves the document when its slide-out ends');
    w.advance(400); // the fallback timers find nothing to do

    // Outside the run nothing changes: a sheet slides in, keeps its id while it
    // is up, waits for a member who has moved into it, and goes after 5s.
    w = sheetWorld();
    w.ctx.showBookingConfirmation(10, [12]);
    w.frame();
    const live = w.kids[0];
    eq([w.shown(), w.ctx.document.getElementById('bookingConfirmation') === live, /Booked!/.test(live.innerHTML) && /Bike 12/.test(live.innerHTML)], [1, true, true], 'a booking from the picker: the sheet is up and findable by its id');
    live.focused = w.ctx.document.activeElement = { name: 'Done' };
    w.advance(5000);
    eq([w.shown(), w.kids.length], [1, 1], 'focus is on its buttons at 5s → it stays');
    w.ctx.document.activeElement = null;
    w.advance(5000);
    eq([w.shown(), live.id, w.timer()], [0, '', null], 'focus left → the next check dismisses it');
    w.advance(400);
    eq(w.kids.length, 0, '…and the fallback removes it when no transition ends (reduced motion)');
  }

  // ── Wiring ───────────────────────────────────────────────────────────────
  t.section('Usual week wiring');
  {
    const tabs = t.readSource('js/tabs.js');
    ok(/window\.planWeeklyTemplate = planWeeklyTemplate;/.test(src) && /window\.bookWeeklyTemplate = bookWeeklyTemplate;/.test(src), 'app.js exports planWeeklyTemplate and keeps bookWeeklyTemplate (tests/smoke.html)');
    ok(!/bookWeeklyTemplate\(\s*\)/.test(tabs), 'tabs.js never calls bookWeeklyTemplate() bare — the only caller passes the ticked picks');
    ok(/usualWeekCard\.id = 'usualWeekCard'/.test(tabs), 'initTabs creates the #usualWeekCard container once');
    ok(/role="dialog" aria-modal="true" aria-labelledby="usualWeekSheetTitle"/.test(tabs), 'the sheet is a labelled modal dialog');

    // Where focus goes when the sheet closes. A finger tap in iOS WebKit does
    // not focus the button, so what was recorded on open is <body> — which the
    // document "contains": focus was handed back to <body> (i.e. dropped) and
    // the card-button fallback could never be reached.
    const fbFrom = tabs.indexOf('  function _uwFocusBack(prev, doc) {');
    const fbTo = tabs.indexOf('\n  }\n', fbFrom);
    ok(fbFrom !== -1 && fbTo > fbFrom, '_uwFocusBack can be sliced');
    const fb = t.vm.createContext({});
    t.vm.runInContext(tabs.slice(fbFrom, fbTo + 4), fb);
    const cardBtn = { name: 'week-template-book' }, opener = { name: 'opener' }, gone = { name: 'gone' };
    const doc = { body: { name: 'body' }, documentElement: { name: 'html' }, asked: [],
      contains: (el) => el !== gone, querySelector(sel) { this.asked.push(sel); return cardBtn; } };
    eq([fb._uwFocusBack(doc.body, doc), fb._uwFocusBack(doc.documentElement, doc), fb._uwFocusBack(null, doc)], [cardBtn, cardBtn, cardBtn],
      'opened by a tap that focused nothing (<body> / <html> / nothing) → back to the card\'s "Book my usual week" button, not dropped on <body>');
    eq(doc.asked[0], '#usualWeekCard .week-template-book', '…found by the selector the card renders');
    eq(fb._uwFocusBack(gone, doc), cardBtn, 'the opener was re-rendered away during the run → the same fallback');
    eq(fb._uwFocusBack(opener, doc), opener, 'a focused opener still in the page gets focus back, as before');
    ok(/var back = _uwFocusBack\(previouslyFocused, document\);/.test(tabs), 'the sheet\'s close() uses it');

    // …and it has to STAY there. Seen in a real browser: focus was on the card's
    // button at close, and on <body> 400ms later — the /bookings re-read behind
    // a run emits bookings:loaded, the card repaints (innerHTML), and the button
    // holding focus is gone. The card carries focus across its own repaint.
    const rfFrom = tabs.indexOf('  function _uwFocusedButton(card, doc) {');
    const rfTo = tabs.indexOf('\n  function renderUsualWeekCard() {', rfFrom);
    ok(rfFrom !== -1 && rfTo > rfFrom, '_uwFocusedButton / _uwRefocusButton can be sliced');
    const rf = t.vm.createContext({ Array, Math });
    t.vm.runInContext(tabs.slice(rfFrom, rfTo), rf);
    const mkCard = (names) => {
      const focused = [];
      const btns = names.map((name) => ({ name, focus(o) { focused.push([name, o]); } }));
      return { btns, focused, querySelectorAll: (sel) => { if (sel !== 'button') throw new Error('fake DOM: ' + sel); return btns; } };
    };
    const old = mkCard(['remove0', 'book', 'update', 'clear']);
    eq([rf._uwFocusedButton(old, { activeElement: old.btns[1] }), rf._uwFocusedButton(old, { activeElement: { name: 'elsewhere' } }), rf._uwFocusedButton(old, { activeElement: null })],
      [1, -1, -1], 'which of the card\'s buttons holds focus (-1: focus is somewhere else, or nowhere)');
    let fresh = mkCard(['remove0', 'book', 'update', 'clear']);
    rf._uwRefocusButton(fresh, 1);
    eq(fresh.focused, [['book', { preventScroll: true }]], 'after the repaint the NEW button in that place gets focus — without scrolling the page (it is a background repaint)');
    fresh = mkCard(['remove0', 'book', 'update', 'clear']);
    rf._uwRefocusButton(fresh, -1);
    eq(fresh.focused, [], 'focus was not in the card → a repaint never steals it');
    fresh = mkCard(['save']);
    rf._uwRefocusButton(fresh, 3);
    eq(fresh.focused.map((x) => x[0]), ['save'], 'fewer buttons than before (an entry removed / the card became the invitation) → the last one, not nothing');
    fresh = mkCard([]);
    rf._uwRefocusButton(fresh, 0);
    eq(fresh.focused, [], 'the card emptied (cleared, signed out) → nothing to focus, no throw');
    const renderFn = tabs.slice(tabs.indexOf('  function renderUsualWeekCard() {'), tabs.indexOf('  window.renderUsualWeekCard = renderUsualWeekCard;'));
    ok(renderFn.indexOf('var focusedIdx = _uwFocusedButton(card, document);') !== -1 && renderFn.indexOf('var focusedIdx') < renderFn.indexOf('card.innerHTML'),
      'renderUsualWeekCard notes the focused button BEFORE it replaces the markup');
    ok(renderFn.indexOf('_uwRefocusButton(card, focusedIdx);') > renderFn.lastIndexOf('_placeUsualWeekCard(card);'),
      '…and restores it after the card has been re-seated (insertBefore moves the node, which drops focus as well)');
    ok(/class="[^"]*week-template-book/.test(tabs), 'the card still renders a .week-template-book button for it to find');
    const detect = grab('function detectRecurringSlots(');
    ok(/locByName/.test(detect) && !/locationId: null,/.test(detect), 'detectRecurringSlots resolves the history\'s location name to a location id');
  }
};
