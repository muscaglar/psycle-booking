'use strict';
// "+ Add spot" on a My Bookings card painted from the saved class details
// (psycle_booked_event_details) calls bookClass(id, btn, evt.studio_id) before
// anything has put that studio on _studioMap. bookClass used to fall through
// to the count-less "Book another space?" confirm and then POST a body with no
// slots and no count — Psycle answers "Booking slot required": no charge, but
// a dead end. The REAL bookClass, sliced out of js/app.js the way
// tests/suites/booking.js does it, against a scripted GET /events/{id}.
module.exports = async function (t) {
  const { ok, eq } = t;
  const appSrc = t.readSource('js/app.js');
  // Top-level functions in app.js open at column 0 and close with a bare "}".
  const grab = (src, opener, closer) => {
    const lines = src.split('\n');
    const from = lines.findIndex(l => l.startsWith(opener));
    if (from === -1) throw new Error('add-spot suite: cannot find "' + opener + '"');
    const to = lines.findIndex((l, i) => i > from && l === closer);
    if (to === -1) throw new Error('add-spot suite: unterminated "' + opener + '"');
    return lines.slice(from, to + 1).join('\n');
  };
  const bookSrc = grab(appSrc, 'async function bookClass(', '}');

  const LAYOUT = { slots: [{ id: 7 }, { id: 9 }, { id: 11 }] };
  const OTHER = { slots: [{ id: 1 }, { id: 2 }] };
  const holds7 = () => ({ 77: { bookingId: 'A', bookingIds: ['A'], slots: [7], slotBookings: { 7: 'A' }, waitlisted: false } });
  // `o.studios`: what _studioMap knows at the tap ({} = a snapshot-painted card).
  // `o.envelope`: the rest of the GET /events/77 answer (relations, …).
  function world(o) {
    o = o || {};
    const log = { confirms: [], pickers: [], posts: [], joins: [], toasts: [], booked: [] };
    const globals = {
      window: {},
      _myBookings: o.bookings === undefined ? holds7() : o.bookings,
      // As _eventCacheEntryFromSnapshot leaves it: no availability, flagged.
      _eventCache: { 77: { id: 77, start_at: '2099-01-05 07:15:00', duration: 45, studio_id: o.savedStudio === undefined ? 4 : o.savedStudio, _typeName: 'Ride', _fromSnapshot: true } },
      _studioMap: o.studios || {},
      currentUser: { id: 1 },
      console: { log() {}, warn() {}, info() {}, error: console.error },
      setTimeout: () => 0, clearTimeout: () => {},
      getBearerToken: () => 'tok', openLoginPopup: () => {},
      toast: (msg, type) => log.toasts.push([msg, type]),
      confirmModal: async (opts) => { log.confirms.push(opts.title); return o.confirm === true; },
      apiFetch: async (path) => {
        if (path !== '/events/77') throw new Error('unexpected call ' + path);
        return { ok: true, status: 200, json: async () => Object.assign({ slots: o.slots || [9, 11], data: o.detail || {} }, o.envelope || {}) };
      },
      showBikePicker: (id, b, layout, avail, mine, studioName) => log.pickers.push({ layout, mine: [...mine], studioName }),
      submitBooking: async (id, slots, b, opts) => { log.posts.push([slots, opts]); },
      confirmJoinWaitlist: async (id) => { log.joins.push(id); },
      leaveWaitlist: async () => {},
      slotLabelForEvent: () => 'Bike', _waitlistClassLine: () => 'Ride · Alex', _parseSlots: (x) => x,
      _clearUnverifiedBooking: async () => true,
      applyBookedState: (b, id) => { log.booked.push(id); b.className = 'book-btn booked'; },
    };
    const ctx = t.loadPure('js/app.js', 'book-fresh', globals);
    t.vm.runInContext("var _bookingsLoadState = 'loaded';\n" + grab(appSrc, 'function _busyLabel(', '}') + '\n' + bookSrc, ctx, { filename: 'js/app.js[bookClass]' });
    return { ctx, log };
  }
  // The My Bookings button: `<button class="booking-action-btn" onclick="…bookClass(id, this, studio_id)">+ Add spot`.
  const addSpot = () => {
    const b = { textContent: '+ Add spot', className: 'booking-action-btn', disabled: false, dataset: {}, style: {} };
    b.classList = { contains: (c) => b.className.split(/\s+/).indexOf(c) !== -1 };
    return b;
  };
  const rel = (studios) => ({ relations: { studios } });

  t.section('"+ Add spot" on a card painted from saved details: the studio comes from the class just read');
  {
    let w = world({ envelope: rel([{ id: 4, name: 'Studio 1', has_layout: true, layout: LAYOUT }]) });
    const b = addSpot();
    await w.ctx.bookClass(77, b, 4);
    eq([w.log.confirms, w.log.posts], [[], []], 'no "Book another space?", nothing posted (it used to POST a body with no slots and no count)');
    eq(w.log.pickers, [{ layout: LAYOUT, mine: [7], studioName: 'Studio 1' }], "the PICKER opens on the studio's own map, the seat already held drawn as the member's");
    eq(w.ctx._studioMap[4].layout, LAYOUT, '…and the record is kept on _studioMap, so the next tap (and the card routing) knows the studio');
    eq([b.textContent, b.className, b.disabled, b.dataset.busy], ['+ Add spot', 'booking-action-btn', false, undefined], 'the button is "+ Add spot" again behind the picker');

    // The saved studio id is from the day the details were saved.
    w = world({ savedStudio: 9, detail: { studio_id: 4 }, envelope: rel([{ id: 4, name: 'Studio 1', has_layout: true, layout: LAYOUT }]) });
    await w.ctx.bookClass(77, addSpot(), 9);
    eq([w.log.pickers.length, w.log.pickers[0] && w.log.pickers[0].layout, Object.keys(w.ctx._studioMap)], [1, LAYOUT, ['4']],
      'the class moved rooms since: the studio Psycle names NOW is used (and cached under ITS id) — never a guess at the saved one');
    // _slimEventDetails stores null for an id it could not read: bookClass(77, this, null).
    w = world({ savedStudio: null, detail: { studio_id: 4 }, envelope: rel([{ id: 4, has_layout: true, layout: LAYOUT }]) });
    await w.ctx.bookClass(77, addSpot(), null);
    eq([w.log.pickers.length, w.log.confirms], [1, []], 'no saved studio id at all: still resolved from the class');

    // A count studio, learned the same way.
    w = world({ confirm: true, envelope: rel([{ id: 4, name: 'Studio 2', has_layout: false }]) });
    await w.ctx.bookClass(77, addSpot(), 4);
    eq([w.log.confirms, w.log.posts, w.log.pickers], [['Book another space?'], [[null, { spaces: 1 }]], []],
      'has_layout === false read off the class: the confirm, and the COUNT body — the only body Psycle accepts there');
    w = world({ confirm: true, bookings: {}, envelope: rel([{ id: 4, has_layout: false }]) });
    await w.ctx.bookClass(77, addSpot(), 4);
    eq([w.log.confirms, w.log.posts], [['Book this class?'], [[null, { spaces: 1 }]]], '…and for a class not held yet');
  }

  t.section('"Not now" on "Book another space?" hands "+ Add spot" back as it was');
  {
    // Seen in a browser: My Bookings card at a count studio → "+ Add spot" →
    // "Book another space?" → "Not now" left the button reading "Booked ✓" in
    // the card's booked styling — a second full-width button under "Cancel booking".
    let w = world({ confirm: false, studios: { 4: { id: 4, has_layout: false } } });
    const b = addSpot();
    await w.ctx.bookClass(77, b, 4);
    eq([w.log.confirms, w.log.posts], [['Book another space?'], []], 'declined: nothing is posted');
    eq([b.textContent, b.className, b.disabled, b.dataset.busy, w.log.booked], ['+ Add spot', 'booking-action-btn', false, undefined, []],
      '"+ Add spot" is "+ Add spot" again — never restyled as the card\'s booked button (applyBookedState is for .book-btn only)');
    // The Discover card's own button in the same spot keeps its restore.
    const cardBtn = (text, cls) => {
      const c = { textContent: text, className: cls, disabled: false, dataset: {}, style: {} };
      c.classList = { contains: (x) => c.className.split(/\s+/).indexOf(x) !== -1 };
      return c;
    };
    w = world({ confirm: false, studios: { 4: { id: 4, has_layout: false } } });
    let card = cardBtn('Booked ✓', 'book-btn booked');
    await w.ctx.bookClass(77, card, 4);
    eq([w.log.booked, card.disabled], [[77], false], 'a HELD card button goes back to its booked state, as before');
    w = world({ confirm: false, bookings: {}, studios: { 4: { id: 4, has_layout: false } } });
    card = cardBtn('Book', 'book-btn');
    await w.ctx.bookClass(77, card, 4);
    eq([w.log.confirms, card.textContent, card.disabled, w.log.booked], [['Book this class?'], 'Book', false, []], '…and one not held reads "Book" again');
  }

  t.section('A studio that cannot be resolved never reaches a booking confirm');
  {
    const unresolved = [
      ['no relations in the answer', {}],
      ['relations without this studio', rel([{ id: 12, has_layout: false }])],
      ['a record that does not say whether it has a seat map', rel([{ id: 4, name: 'Studio 1' }])],
      ['junk relations', { relations: { studios: 'x' } }],
    ];
    for (const [what, envelope] of unresolved) {
      const w = world({ confirm: true, envelope });
      const b = addSpot();
      await w.ctx.bookClass(77, b, 4);
      eq([w.log.confirms, w.log.posts, w.log.pickers], [[], [], []], what + ': no confirm, no POST, no picker');
      eq(w.log.toasts, [["Couldn't load the studio map — try again", 'error']], what + ': the member is told, once');
      eq([b.textContent, b.className, b.disabled, b.dataset.busy, w.log.booked], ['+ Add spot', 'booking-action-btn', false, undefined, []],
        what + ': "+ Add spot" is usable again — and never restyled as the card\'s "Bike 7 ✓" button');
    }
    // Another studio's has_layout:false must not lend this class a count body.
    let w = world({ confirm: true, detail: { studio_id: 4 }, envelope: rel([{ id: 12, has_layout: false }]) });
    await w.ctx.bookClass(77, addSpot(), 4);
    eq(w.log.posts, [], "another studio's record is not this class's");

    // A card button (Discover) in the same spot keeps its own restore.
    w = world({ bookings: {} });
    const card = { textContent: 'Book', className: 'book-btn', disabled: false, dataset: {}, style: {} };
    card.classList = { contains: (c) => card.className.split(/\s+/).indexOf(c) !== -1 };
    await w.ctx.bookClass(77, card, 4);
    eq([card.textContent, card.disabled, w.log.confirms], ['Book', false, []], 'a card\'s "Book" reads "Book" again');
    w = world({});
    card.className = 'book-btn booked';
    await w.ctx.bookClass(77, card, 4);
    eq(w.log.booked, [77], '…and a held card goes back to its booked state');

    // A full class needs no studio.
    w = world({ bookings: {}, detail: { is_fully_booked: true, is_waitlistable: true } });
    await w.ctx.bookClass(77, addSpot(), 4);
    eq([w.log.joins, w.log.toasts], [[77], []], 'FULL and not held: the waitlist path is untouched (no map needed)');
  }

  t.section('A studio _studioMap already knows is left alone');
  {
    let w = world({ studios: { 4: { id: 4, name: 'Studio 1', has_layout: true, layout: LAYOUT } }, envelope: rel([{ id: 4, name: 'Renamed', has_layout: true, layout: OTHER }]) });
    await w.ctx.bookClass(77, addSpot(), 4);
    eq(w.log.pickers, [{ layout: LAYOUT, mine: [7], studioName: 'Studio 1' }], 'known, with its map: exactly as before');
    w = world({ confirm: true, studios: { 4: { id: 4, has_layout: false } }, envelope: rel([{ id: 4, has_layout: true, layout: OTHER }]) });
    await w.ctx.bookClass(77, addSpot(), 4);
    eq([w.log.posts, w.log.pickers], [[[null, { spaces: 1 }]], []], 'known to be a count studio: as before');
    // A record with no flag (a partial one) is as good as unknown.
    w = world({ studios: { 4: { location_id: 2 } }, envelope: rel([{ id: 4, name: 'Studio 1', has_layout: true, layout: LAYOUT }]) });
    await w.ctx.bookClass(77, addSpot(), 4);
    eq([w.log.pickers.length, w.ctx._studioMap[4].has_layout], [1, true], 'a record that never said has_layout is replaced by the class\'s own');
  }

  t.section('_studioFromEventDetail (pure:book-fresh)');
  {
    const p = t.loadPure('js/app.js', 'book-fresh', { _eventCache: {} });
    const four = { id: 4, has_layout: true, layout: LAYOUT }, nine = { id: 9, has_layout: false };
    eq([p._studioFromEventDetail(rel([nine, four]), 4), p._studioFromEventDetail(rel([nine, four]), '9')], [four, nine], 'the record for the id asked for (ids compare as text)');
    eq(p._studioFromEventDetail(Object.assign({ data: { studio_id: 4 } }, rel([nine, four])), 9), four, "the class's own studio_id outranks the caller's");
    eq(p._studioFromEventDetail(Object.assign({ data: { studio_id: 5 } }, rel([nine])), 9), nine, '…unless the answer carries no record for it');
    eq([p._studioFromEventDetail(rel([{ id: 4 }]), 4), p._studioFromEventDetail(rel([{ id: 4, has_layout: 'yes' }]), 4), p._studioFromEventDetail(rel([null, { has_layout: false }]), null),
      p._studioFromEventDetail({ relations: { studios: 'x' }, data: 'y' }, 4), p._studioFromEventDetail(null, 4), p._studioFromEventDetail({}, undefined)],
      [null, null, null, null, null, null], 'no has_layout flag, a non-boolean one, a record with no id, junk: not a studio');

    ok(/studio && studio\.has_layout === false \? \{ spaces: 1 \} : \{\}/.test(bookSrc), 'the count body stays exclusive to has_layout === false');
    ok(/if \(!hasLayout && !\(studio && studio\.has_layout === false\)\) \{/.test(bookSrc), 'everything that is neither a picker nor a positively count studio stops before the confirm');
  }
};
