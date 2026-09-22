'use strict';
// Offline / PWA plumbing:
//   • the read-only saved copy of My Bookings (js/app.js pure:offline block, the
//     painter, and the listeners that write / delete it),
//   • fetchWithRetry's "known offline → no retries" clamp (js/reliability.js),
//   • the 24h TTL on the cached static lists (js/performance.js),
//   • the token-expiry timer clamp (js/security.js),
//   • login.html's lockout / timeout / error-message rules,
//   • the service-worker update flow (psycle-finder.html head script + app.js).
module.exports = async function (t) {
  const appSrc = t.readSource('js/app.js');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slotLabel = (type) => (/ride/i.test(type) ? 'Bike' : 'Spot');

  // ── Saved copy: pure helpers ─────────────────────────────────────────────
  t.section('Saved copy of My Bookings: pure helpers (js/app.js pure:offline block)');
  const pure = t.loadPure('js/app.js', 'offline', { escapeHTML: esc, slotLabel });
  const NOW = new Date(2026, 8, 18, 9, 30).getTime();
  const DAY = 24 * 60 * 60 * 1000;

  const item = (o) => Object.assign({ id: '101', start_at: '2026-09-18 07:30:00', duration: 45, type: 'Ride 45', instructor: 'Alex', location: 'Oxford Circus', studio: 'Studio 1', slots: [7], spaces: 0, waitlisted: false }, o);
  t.eq(pure._coerceSnapshotItem(item({})), item({}), 'a well-formed item survives unchanged');
  t.eq(pure._coerceSnapshotItem(item({ id: 101, slots: ['7', 'x', -1, 12] })).slots, [7, 12], 'seat numbers are coerced to positive numbers, junk dropped');
  t.eq(pure._coerceSnapshotItem(item({ id: 101 })).id, '101', 'a numeric id is kept as a string');
  t.eq(pure._coerceSnapshotItem(item({ id: '101);alert(1' })), null, 'an id that is not all digits is rejected');
  t.eq(pure._coerceSnapshotItem(item({ start_at: 'tomorrow' })), null, 'a start that is not a date-time is rejected');
  t.eq(pure._coerceSnapshotItem(null), null, 'null is rejected');
  t.eq(pure._coerceSnapshotItem('x'), null, 'a string is rejected');
  t.eq(pure._coerceSnapshotItem(item({ type: 'x'.repeat(500) })).type.length, 80, 'text fields are length-capped');
  t.eq(pure._coerceSnapshotItem(item({ type: '' })).type, 'Class', 'a missing class name falls back to "Class"');
  t.eq(pure._coerceSnapshotItem(item({ waitlisted: 'yes' })).waitlisted, false, 'waitlisted is a strict boolean');
  t.eq(pure._coerceSnapshotItem(item({ duration: 'abc' })).duration, 0, 'a junk duration becomes 0');
  t.eq([pure._coerceSnapshotItem(item({ spaces: 3 })).spaces, pure._coerceSnapshotItem(item({ spaces: 1 })).spaces], [3, 0], 'spaces only counts when more than one is held');

  const stored = (o) => JSON.stringify(Object.assign({ v: 1, owner: 7, savedAt: NOW - 60000, items: [item({})] }, o));
  t.eq(pure._coerceBookingsSnapshot('{not json', NOW), null, 'unparseable storage is no snapshot');
  t.eq(pure._coerceBookingsSnapshot(null, NOW), null, 'nothing stored is no snapshot');
  t.eq(pure._coerceBookingsSnapshot(stored({ v: 2 }), NOW), null, 'another version is no snapshot');
  t.eq(pure._coerceBookingsSnapshot(stored({ owner: '' }), NOW), null, 'a copy with no owner is never used');
  t.eq(pure._coerceBookingsSnapshot(stored({ items: 'nope' }), NOW), null, 'items must be a list');
  t.eq(pure._coerceBookingsSnapshot(stored({ savedAt: NOW - 15 * DAY }), NOW), null, 'older than 14 days is dropped');
  t.eq(pure._coerceBookingsSnapshot(stored({ savedAt: 'x' }), NOW), null, 'a junk timestamp is dropped');
  const good = pure._coerceBookingsSnapshot(stored({ items: [item({}), { junk: true }, item({ id: 102 })] }), NOW);
  t.eq([good.owner, good.savedAt, good.items.map((i) => i.id)], ['7', NOW - 60000, ['101', '102']], 'a valid copy: owner as a string, malformed items dropped');
  t.ok(pure._coerceBookingsSnapshot(stored({ savedAt: NOW + DAY }), NOW) !== null, 'a clock that moved backwards does not throw the copy away');
  const many = []; for (let i = 0; i < 60; i++) many.push(item({ id: String(200 + i) }));
  t.eq(pure._coerceBookingsSnapshot(stored({ items: many }), NOW).items.length, 40, 'at most 40 items are read back');

  const bookings = {
    101: { bookingId: 'A', bookingIds: ['A'], slots: [7], slotBookings: { 7: 'A' }, waitlisted: false },
    102: { bookingId: null, slots: [], slotBookings: {}, waitlisted: true, waitlist: { id: 9 } },
    103: { bookingId: 'C', bookingIds: ['C', 'D'], slots: [], slotBookings: {}, waitlisted: false },
  };
  const cache = {
    101: { start_at: '2026-09-19 07:30:00', duration: 45, _typeName: 'Ride 45', _instrName: 'Alex', _locName: 'Oxford Circus', _studioName: 'Studio 1', instructor_id: 31, description: 'x'.repeat(2000) },
    102: { start_at: '2026-09-18 18:00:00', duration: 60, _typeName: 'Yoga', _instrName: 'Sam', _locName: 'Clapham', _studioName: '' },
    103: { start_at: '2026-09-20 10:00:00', duration: 50, _typeName: 'Strength', _instrName: 'Jo', _locName: 'Shoreditch', _studioName: 'Studio 2' },
  };
  t.eq(pure._buildBookingsSnapshot(bookings, cache, null, null, NOW), null, 'no known owner → nothing is written');
  const built = pure._buildBookingsSnapshot(bookings, cache, null, 7, NOW);
  t.eq([built.v, built.owner, built.savedAt], [1, '7', NOW], 'built: version, owner (string) and time are stamped');
  t.eq(built.items.map((i) => i.id), ['102', '101', '103'], 'built: sorted by start time');
  t.eq(Object.keys(built.items[0]).sort(), ['duration', 'id', 'instructor', 'location', 'slots', 'spaces', 'start_at', 'studio', 'type', 'waitlisted'],
    'built: display fields only — no booking ids, no waitlist entry ids, no event blob');
  t.eq([built.items[0].waitlisted, built.items[1].slots, built.items[2].spaces], [true, [7], 2], 'built: a place, a seat and a two-space no-layout booking');
  // A class whose details could not be loaded this time keeps its previous entry.
  const partial = pure._buildBookingsSnapshot({ 101: { bookingIds: ['A'], slots: [9] }, 104: { slots: [1] } }, {}, pure._coerceBookingsSnapshot(JSON.stringify(built), NOW), 7, NOW + 1000);
  t.eq(partial.items.map((i) => [i.id, i.type, i.slots]), [['101', 'Ride 45', [9]]], 'unhydrated class: previous details kept with TODAY\'s seats; one never seen before is left out');
  t.eq(pure._buildBookingsSnapshot({ 101: { slots: [9] } }, {}, pure._coerceBookingsSnapshot(JSON.stringify(built), NOW), 8, NOW).items, [], 'another account\'s previous copy is never carried over');
  t.eq(pure._buildBookingsSnapshot({}, {}, null, 7, NOW).items, [], 'a confirmed-empty list is an empty copy');

  const startMs = (s) => Date.parse(String(s).replace(' ', 'T'));
  const at = (h, m) => new Date(2026, 8, 18, h, m).getTime();
  const showIds = (now) => pure._snapshotItemsToShow([item({ id: '1', start_at: '2026-09-18 07:30:00' }), item({ id: '2', start_at: '2026-09-18 12:00:00' }), item({ id: '3', start_at: 'x' })], now, startMs).map((i) => i.id);
  t.eq(showIds(at(7, 0)), ['1', '2'], 'before class: shown');
  t.eq(showIds(at(8, 0)), ['1', '2'], 'class in progress (running late at the door): still shown');
  t.eq(showIds(at(8, 16)), ['2'], 'class over: gone');
  t.eq(pure._snapshotItemsToShow(null, NOW, startMs), [], 'no items is an empty list');

  t.eq(pure._snapshotLabel(new Date(2026, 8, 18, 14, 5).getTime(), new Date(2026, 8, 18, 20, 0).getTime()), 'Saved copy · 14:05', 'label: today → time only');
  const older = pure._snapshotLabel(new Date(2026, 8, 16, 9, 7).getTime(), new Date(2026, 8, 18, 20, 0).getTime());
  t.ok(/^Saved copy · .*16.*, 09:07$/.test(older), 'label: another day → the day too (got "' + older + '")');

  const evil = '<img src=x onerror=alert(1)>"\'';
  const html = pure._savedBookingsHTML([item({ type: evil, instructor: evil, location: evil, studio: evil, start_at: '2026-09-18 19:05:00' }), item({ id: '9', waitlisted: true, slots: [], start_at: '2026-09-19 00:15:00', type: 'Yoga' })], 'Saved copy · 14:05 ' + evil, false);
  t.ok(html.indexOf('<img') === -1 && html.indexOf(esc(evil)) !== -1, 'painter: every stored string is HTML-escaped (class, instructor, studio, label)');
  t.eq((html.match(/onclick=/g) || []).length, 1, 'painter: the only handler is Retry — the cards themselves do nothing');
  t.ok(/onclick="retrySavedBookings\(this\)"/.test(html), 'painter: Retry goes to retrySavedBookings');
  t.ok(html.indexOf('data-id') === -1 && html.indexOf('book-btn') === -1 && html.indexOf('mb-primary-btn') === -1, 'painter: no data-id / booking buttons — swipe, Similar and button re-sync cannot mistake a saved card for a live one');
  t.ok(/my-booking-card is-saved-copy/.test(html) && /is-waitlisted/.test(html) && /badge waitlist">Waitlisted/.test(html), 'painter: saved cards are marked, a place reads Waitlisted');
  // The time block is the shared card's (_ccTimeHTML, pure:class-type) — typeof-guarded in
  // the painter, like the pictogram; with the real helper in reach:
  const timed = t.loadPure('js/app.js', 'offline', { escapeHTML: esc, slotLabel, _ccTimeHTML: t.loadPure('js/app.js', 'class-type', { getCategory: () => null })._ccTimeHTML });
  const timedHtml = timed._savedBookingsHTML([item({ start_at: '2026-09-18 19:05:00' }), item({ id: '9', waitlisted: true, slots: [], start_at: '2026-09-19 00:15:00', type: 'Yoga' })], 'Saved copy · 14:05', false);
  t.ok(/<span class="cc-time-h">19:05<\/span><span class="cc-dur">/.test(timedHtml) && /<span class="cc-time-h">00:15<\/span>/.test(timedHtml) && !/cc-ampm/.test(timedHtml),
    'painter: the class time is the string\'s own wall-clock digits, 24-hour (19:05, 00:15), in the shared time block');
  t.ok(html.indexOf('cc-time') === -1 && html.indexOf('NaN') === -1, 'painter: evaluated on its own there is no time block — never a ReferenceError');
  t.ok(/up-seat-chip">Spot 7</.test(html), 'painter: the seat chip carries the class type\'s noun');
  const waitingHtml = pure._savedBookingsHTML([item({})], 'Saved copy · 14:05', true);
  t.ok(waitingHtml.indexOf('onclick=') === -1 && /Checking with Psycle/.test(waitingHtml), 'painter: while Psycle is still being asked there is nothing to retry');

  // ── Saved copy: painter + listeners around the REAL renderMyBookings ─────
  t.section('Saved copy of My Bookings: painted only while Psycle has not answered; never fed back into state');
  function pureRegion(name) {
    const s = appSrc.indexOf('// ── pure:' + name + ':start'), e = appSrc.indexOf('// ── pure:' + name + ':end');
    if (s === -1 || e === -1) throw new Error('offline suite: pure:' + name + ' markers moved');
    return appSrc.slice(s, e);
  }
  const glueFrom = appSrc.indexOf("const BOOKINGS_SNAPSHOT_KEY = 'psycle_bookings_snapshot';");
  const lines = appSrc.split('\n');
  const rStart = lines.findIndex((l) => l.startsWith('function renderMyBookings('));
  const rEnd = lines.findIndex((l, i) => i > rStart && l === '}');
  const glueTo = appSrc.indexOf('\nfunction renderMyBookings(');
  t.ok(glueFrom !== -1 && glueTo > glueFrom && rStart !== -1 && rEnd > rStart, 'the painter/listener block and renderMyBookings can be sliced');

  function makeWorld(o) {
    o = o || {};
    const els = {};
    const el = (id) => els[id] || (els[id] = { style: {}, textContent: '', innerHTML: '', querySelector(sel) { return sel === '.is-saved-copy' && /is-saved-copy/.test(this.innerHTML) ? {} : null; } });
    const handlers = {};
    const w = { token: 'token' in o ? o.token : 'tok-A', store: t.makeFakeLocalStorage(), skeletons: [], retried: [] };
    const ctx = t.loadPure('js/app.js', 'offline', {
      escapeHTML: esc, slotLabel,
      console: { log() {}, warn() {}, error: console.error },
      localStorage: w.store,
      getBearerToken: () => w.token,
      document: {
        getElementById: el,
        querySelector: (sel) => (sel === '#upcomingList .is-saved-copy' && /is-saved-copy/.test(el('upcomingList').innerHTML) ? {} : null),
      },
      PsycleEvents: { on: (e, fn) => { (handlers[e] = handlers[e] || []).push(fn); } },
      authGateHTML: () => (w.token ? '<gate>' : ''),
      showBookingSkeleton: (n) => { w.skeletons.push(n); },
      retryBookingsLoad: (b) => { w.retried.push(['bookings', b]); },
      retryAuth: (b) => { w.retried.push(['auth', b]); },
      currentUser: o.user === undefined ? null : o.user,
      _myBookings: {}, _eventCache: {}, _activeSubscription: null,
    });
    t.vm.runInContext("var _bookingsLoadState = 'pending', _lastProfileId = null, _authUnverified = false, _showPastBookings = false, _waitlistsUnavailable = false;\n" +
      pureRegion('gym-time') + '\n' + pureRegion('session') + '\n' + appSrc.slice(glueFrom, glueTo) + '\n' + lines.slice(rStart, rEnd + 1).join('\n'), ctx, { filename: 'js/app.js[saved copy + renderMyBookings]' });
    w.ctx = ctx; w.els = els; w.el = el;
    w.set = (code) => t.vm.runInContext(code, ctx);
    w.emit = (e, arg) => (handlers[e] || []).forEach((fn) => fn(arg));
    w.key = () => w.store.getItem('psycle_bookings_snapshot');
    return w;
  }
  const farItem = (o) => item(Object.assign({ start_at: '2099-01-01 07:30:00' }, o));
  const seed = (w, o) => w.store.setItem('psycle_bookings_snapshot', JSON.stringify(Object.assign({ v: 1, owner: '7', savedAt: Date.now() - 60000, items: [farItem({}), farItem({ id: '102', waitlisted: true, slots: [] })] }, o)));

  // Launched with no signal: token kept, /profile unreachable.
  let w = makeWorld();
  seed(w);
  w.set('_authUnverified = true');
  w.ctx.renderMyBookings();
  t.ok(/Saved copy · \d\d:\d\d/.test(w.el('upcomingList').innerHTML) && /Ride 45/.test(w.el('upcomingList').innerHTML), 'offline launch: the saved classes are painted, labelled "Saved copy · HH:MM"');
  t.eq([w.el('upcomingPanel').style.display, w.el('bookingsEmpty').style.display, w.el('upcomingCount').textContent], ['', 'none', '1 + 1 waitlist'], '…in the bookings panel, instead of the "Can\'t reach Psycle" hero, with their own count');
  t.ok(/retrySavedBookings/.test(w.el('upcomingList').innerHTML), '…with a Retry');
  t.eq([Object.keys(w.ctx._myBookings), Object.keys(w.ctx._eventCache)], [[], []], '…and NOTHING is fed into _myBookings / _eventCache (calendar, widget and reminders only follow the server)');
  w.ctx.retrySavedBookings('BTN');
  t.eq(w.retried, [['auth', 'BTN']], 'Retry with no verified profile re-checks the session');

  // Still asking Psycle (first /profile in flight): shown, nothing to retry yet.
  w = makeWorld();
  seed(w);
  w.ctx.renderMyBookings();
  t.ok(/is-saved-copy/.test(w.el('upcomingList').innerHTML) && !/retrySavedBookings/.test(w.el('upcomingList').innerHTML), 'checking: the saved copy shows without a Retry');

  // Signed in, first /bookings on its way: saved copy instead of the skeleton.
  w = makeWorld({ user: { id: 7 } });
  seed(w);
  w.ctx.renderMyBookings();
  t.ok(/is-saved-copy/.test(w.el('upcomingList').innerHTML) && w.skeletons.length === 0, 'pending: the saved copy stands in for the loading skeleton');
  w.set("_bookingsLoadState = 'failed'");
  w.ctx.renderMyBookings();
  t.ok(/retrySavedBookings/.test(w.el('upcomingList').innerHTML), 'failed load: the saved copy with a Retry, not the "Couldn\'t load" hero');
  w.ctx.retrySavedBookings('BTN');
  t.eq(w.retried, [['bookings', 'BTN']], 'Retry with a verified profile reloads the bookings');

  // Psycle HAS answered: its word is final, even when that word is "nothing".
  w.set("_bookingsLoadState = 'loaded'");
  w.ctx.renderMyBookings();
  t.ok(/Nothing booked/.test(w.el('bookingsEmpty').innerHTML) && w.el('upcomingList').innerHTML === '' && w.el('upcomingPanel').style.display === 'none',
    'loaded + empty: "Nothing booked — yet", never a saved copy over the server\'s answer');

  // …unless the list loaded but none of its classes could be drawn.
  w.ctx._myBookings = { 101: { bookingId: 'A', slots: [7] } };
  w.ctx.renderMyBookings();
  t.ok(/Ride 45/.test(w.el('upcomingList').innerHTML) && !/Waitlisted/.test(w.el('upcomingList').innerHTML), 'loaded but undrawable: only the saved entries of classes the server still lists');
  w.ctx._myBookings = {};

  // Guards.
  w = makeWorld({ user: { id: 8 } });
  seed(w);
  w.ctx.renderMyBookings();
  t.ok(!/is-saved-copy/.test(w.el('upcomingList').innerHTML) && w.skeletons.length === 1, 'another account\'s copy is never painted');
  w = makeWorld({ token: '' });
  seed(w);
  w.ctx.renderMyBookings();
  t.ok(!/is-saved-copy/.test(w.el('upcomingList').innerHTML), 'no token: nothing is painted');
  t.ok(w.key() !== null, '…and render never deletes the copy (on iOS the first paint runs before the token has been restored)');
  // …which is why app.js paints once more as soon as the token IS readable:
  // that first paint is the Sign-in hero, and nothing else took it down until
  // /profile answered (15s+ on a weak signal, longer while /bookings retries).
  t.ok(/Sign in/.test(w.el('bookingsEmpty').innerHTML), 'first paint, token not restored yet: the Sign-in hero');
  w.token = 'tok-A'; // securityReady resolved
  w.ctx.renderMyBookings();
  t.ok(/is-saved-copy/.test(w.el('upcomingList').innerHTML) && !/retrySavedBookings/.test(w.el('upcomingList').innerHTML) && w.el('bookingsEmpty').style.display === 'none',
    'the repaint once the token is readable: the saved copy, "Checking…" (no Retry yet), hero gone');
  const initSrc = appSrc.slice(appSrc.indexOf('// Init — wait for security module to decrypt stored token'), appSrc.indexOf("const fetchJson = path => apiFetch(path)"));
  t.ok(/if \(getBearerToken\(\) && !currentUser && !Object\.keys\(_myBookings\)\.length\) renderMyBookings\(\);[\s\S]*?\n  checkAuth\(\);/.test(initSrc),
    'app.js init: My Bookings is repainted when securityReady resolves, BEFORE checkAuth() starts waiting on /profile (only an empty, unverified tab)');
  t.ok(/try \{\s*if \(getBearerToken\(\)[^\n]*renderMyBookings\(\);\s*\} catch \(e\) \{\}\s*checkAuth\(\);/.test(initSrc), '…guarded, so a failing paint can never keep checkAuth() from running');
  w = makeWorld();
  seed(w, { items: [item({ start_at: '2020-01-01 07:30:00' })] });
  w.set('_authUnverified = true');
  w.ctx.renderMyBookings();
  t.ok(!/is-saved-copy/.test(w.el('upcomingList').innerHTML) && /<gate>/.test(w.el('bookingsEmpty').innerHTML), 'only classes that are over: the normal hero, not an empty "saved copy"');

  // Stale cards never stay in the hidden panel (sign-out / account switch).
  w = makeWorld({ token: '' });
  w.el('upcomingList').innerHTML = '<div class="class-card my-booking-card" data-id="1">previous member</div>';
  w.ctx.renderMyBookings();
  t.eq([w.el('upcomingList').innerHTML, w.el('upcomingPanel').style.display], ['', 'none'], 'empty branch: the hidden list is emptied, not just hidden');

  // Writing.
  t.section('Saved copy of My Bookings: written from confirmed lists, deleted with the session');
  w = makeWorld({ user: { id: 7 } });
  w.ctx._myBookings = bookings; w.ctx._eventCache = cache;
  w.emit('bookings:loaded');
  t.eq(w.key(), null, 'a list that has not loaded this session is never written (it may be one optimistic booking)');
  w.set("_bookingsLoadState = 'loaded'");
  w.emit('bookings:loaded');
  const written = JSON.parse(w.key());
  t.eq([written.owner, written.items.length], ['7', 3], 'bookings:loaded writes the trimmed list under the customer id');
  t.ok(w.key().indexOf('bookingId') === -1 && w.key().indexOf('tok-A') === -1 && w.key().length < 1500, 'what is stored: no booking ids, no token, no event blobs');
  w.ctx._myBookings = { 101: bookings[101] };
  w.emit('booking:cancelled');
  t.eq(JSON.parse(w.key()).items.map((i) => i.id), ['101'], 'a local cancel refreshes the copy straight away (the refetch may never land)');
  w.ctx.currentUser = null;
  w.ctx._myBookings = bookings;
  w.emit('bookings:loaded');
  t.eq(JSON.parse(w.key()).items.length, 1, 'no known customer id → the stored copy is left alone');
  w.set('_lastProfileId = 7');
  w.emit('bookings:loaded');
  t.eq(JSON.parse(w.key()).items.length, 3, '…the last verified profile id is enough (a refresh while Psycle is briefly unreachable)');
  w.token = '';
  w.ctx._myBookings = {};
  w.emit('bookings:loaded');
  t.eq(JSON.parse(w.key()).items.length, 3, 'no token → never written');

  // Deleting.
  w.token = 'tok-A';
  w.emit('auth:changed', { signedIn: false, unverified: true });
  t.ok(w.key() !== null, 'auth:changed unverified (offline launch, token kept): the copy stays — that is what it is for');
  w.ctx.currentUser = { id: 7 };
  w.emit('auth:changed', { signedIn: true });
  t.ok(w.key() !== null, 'auth:changed signed in as the same customer: kept');
  w.ctx.currentUser = { id: 8 };
  w.set("_bookingsLoadState = 'pending'");
  w.ctx._myBookings = {}; w.ctx._eventCache = {};
  w.el('upcomingList').innerHTML = '<div class="my-booking-card is-saved-copy">customer 7</div>';
  w.emit('auth:changed', { signedIn: true });
  t.eq(w.key(), null, 'auth:changed signed in as ANOTHER customer: deleted');
  t.ok(!/customer 7/.test(w.el('upcomingList').innerHTML) && w.skeletons.length === 1, '…and taken off the screen in the same tick');
  seed(w);
  w.token = '';
  w.emit('auth:changed', { signedIn: false, unverified: false });
  t.eq(w.key(), null, 'auth:changed with no token left (sign-out, session expiry): deleted');
  // No token in MEMORY, but security.js kept the stored one: crypto set-up
  // timed out on a slow launch ("leave it for the next launch"). The session
  // has not ended — clearToken / showSessionExpired remove the stored keys
  // before they emit — so the copy must survive for that next launch.
  seed(w);
  w.store.setItem('psycle_bearer_token_enc', 'aes:blob');
  w.emit('auth:changed', { signedIn: false, unverified: false });
  t.ok(w.key() !== null, 'auth:changed with no readable token but the encrypted one still stored: the copy is kept');
  w.store.removeItem('psycle_bearer_token_enc');
  w.store.setItem('psycle_bearer_token', 'legacy');
  w.emit('auth:changed', { signedIn: false, unverified: false });
  t.ok(w.key() !== null, '…same for a stored legacy token');
  w.store.removeItem('psycle_bearer_token');
  const realGet = w.store.getItem;
  w.store.getItem = function (k) { if (/^psycle_bearer_token/.test(k)) throw new Error('SecurityError'); return realGet.apply(this, arguments); };
  w.emit('auth:changed', { signedIn: false, unverified: false });
  w.store.getItem = realGet;
  t.eq(w.key(), null, 'a localStorage that throws on the token keys fails closed: deleted');

  const skeletonSrc = appSrc.slice(appSrc.indexOf('function showBookingSkeleton('), appSrc.indexOf('// ── Countdown helper'));
  t.ok(/querySelector\('\.is-saved-copy'\)\) return;/.test(skeletonSrc), 'showBookingSkeleton leaves a saved copy on screen (no saved → grey bars → live flicker)');
  t.ok(/typeof _paintSavedBookings === 'function' && _paintSavedBookings\(/.test(lines.slice(rStart, rEnd + 1).join('\n')), 'renderMyBookings reaches the painter through a typeof guard (other suites run it alone)');

  // ── fetchWithRetry ───────────────────────────────────────────────────────
  t.section('fetchWithRetry: a browser that knows it is offline does not retry');
  {
    const rel = t.readSource('js/reliability.js');
    const from = rel.indexOf('  const FETCH_TIMEOUT_MS = 15000;');
    const to = rel.indexOf('  // Wrap the global apiFetch to use fetchWithRetry instead of raw fetch');
    t.ok(from !== -1 && to > from, 'fetchWithRetry can be sliced');
    const attempt = async (onLine) => {
      const log = { fetches: 0 };
      const win = {};
      const ctx = t.vm.createContext({
        window: win, AbortController, navigator: { onLine },
        setTimeout: (fn, ms) => { if (ms < 15000) fn(); return 1; }, // backoff elapses at once; the 15s abort timer never fires
        clearTimeout: () => {},
        fetch: () => { log.fetches++; return Promise.reject(new TypeError('Failed to fetch')); },
      });
      t.vm.runInContext(rel.slice(from, to), ctx, { filename: 'js/reliability.js[fetchWithRetry]' });
      let err = null;
      try { await win.fetchWithRetry('https://api.test/x', {}); } catch (e) { err = e; }
      return [log.fetches, !!err];
    };
    t.eq(await attempt(true), [4, true], 'online: a failing request is tried 1 + 3 times');
    t.eq(await attempt(false), [1, true], 'navigator.onLine === false: the one attempt still goes out, then it fails at once');
    t.eq(await attempt(undefined), [4, true], 'an unknown onLine is not "offline"');
  }

  // ── Static-list cache TTL ────────────────────────────────────────────────
  t.section('Static lists: the 24h TTL is honoured (js/performance.js)');
  {
    const H = 60 * 60 * 1000;
    const p = t.loadPure('js/performance.js', 'static-cache');
    const entry = (ageMs, list) => ({ data: { data: list === undefined ? [{ id: 1 }] : list }, timestamp: NOW - ageMs });
    t.eq(p._staticCacheIsFresh(entry(H), 24 * H, NOW), true, '1h old, non-empty: fresh');
    t.eq(p._staticCacheIsFresh(entry(25 * H), 24 * H, NOW), false, '25h old: stale');
    t.eq(p._staticCacheIsFresh(entry(24 * H), 24 * H, NOW), false, 'exactly the TTL: stale');
    t.eq(p._staticCacheIsFresh(entry(H, []), 24 * H, NOW), false, 'an empty list keeps self-healing');
    t.eq(p._staticCacheIsFresh(entry(H, { nope: 1 }), 24 * H, NOW), false, 'a payload that is not a list keeps self-healing');
    t.eq(p._staticCacheIsFresh(entry(-H), 24 * H, NOW), false, 'written "in the future" (clock moved back): never pinned');
    t.eq(p._staticCacheIsFresh({ data: { data: [{ id: 1 }] } }, 24 * H, NOW), false, 'no timestamp: stale');
    t.eq(p._staticCacheIsFresh(null, 24 * H, NOW), false, 'nothing cached: not fresh');
    t.eq([p._staticCacheHasList(entry(25 * H)), p._staticCacheHasList(entry(H, [])), p._staticCacheHasList(entry(H, { nope: 1 })),
      p._staticCacheHasList({ data: {} }), p._staticCacheHasList({}), p._staticCacheHasList(null)],
    [true, false, false, false, false, false], 'servable = a non-empty list, whatever its age; empty / not a list / missing is not');

    const perf = t.readSource('js/performance.js');
    const from = perf.indexOf("const CACHE_PREFIX = 'psycle_cache_';");
    const to = perf.indexOf(' * Eager cache pre-population');
    t.ok(from !== -1 && to > from, 'the cache patch can be sliced');
    const world = (netDown) => {
      const log = { net: [] };
      const store = t.makeFakeLocalStorage();
      const win = {};
      const body = { data: [{ id: 1, full_name: 'Alex' }] };
      const ctx = t.vm.createContext({
        window: win, localStorage: store, console: { warn() {} },
        apiFetch: (path, opts) => {
          log.net.push(path);
          if (netDown) return Promise.reject(new TypeError('Failed to fetch'));
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: [{ id: 2 }] }), clone() { return this; } });
        },
      });
      t.vm.runInContext(perf.slice(from, perf.lastIndexOf('/**', to)), ctx, { filename: 'js/performance.js[cache patch]' });
      return { log, store, fetch: win.apiFetch, body };
    };
    const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
    let c = world();
    c.store.setItem('psycle_cache_instructors', JSON.stringify({ data: c.body, timestamp: Date.now() - H }));
    let res = await c.fetch('/instructors');
    await flush();
    t.eq([c.log.net, (await res.json()).data[0].id], [[], 1], 'inside the TTL: the cached list is the whole answer — no request at all');
    c = world();
    c.store.setItem('psycle_cache_instructors', JSON.stringify({ data: c.body, timestamp: Date.now() - 25 * H }));
    res = await c.fetch('/instructors');
    await flush();
    t.eq([c.log.net, (await res.json()).data[0].id, JSON.parse(c.store.getItem('psycle_cache_instructors')).data.data[0].id], [['/instructors'], 1, 2],
      'past the TTL: stale answer now, refreshed in the background');
    c = world();
    c.store.setItem('psycle_cache_locations', JSON.stringify({ data: { data: [] }, timestamp: Date.now() - H }));
    res = await c.fetch('/locations');
    await flush();
    t.eq(c.log.net, ['/locations'], 'an empty cached list is refreshed even inside the TTL');
    t.eq([(await res.json()).data.map((l) => l.id), JSON.parse(c.store.getItem('psycle_cache_locations')).data.data.length], [[2], 1],
      '…and is never served: the caller gets the network\'s list (it used to get [] — "Loading studios…" all launch), the entry is repaired');
    c = world();
    c.store.setItem('psycle_cache_locations', JSON.stringify({ data: { nope: 1 }, timestamp: Date.now() - H }));
    res = await c.fetch('/locations');
    await flush();
    t.eq([c.log.net, (await res.json()).data[0].id], [['/locations'], 2], 'a cached payload that is not a list: the network answers too');
    c = world(true);
    c.store.setItem('psycle_cache_locations', JSON.stringify({ data: { data: [] }, timestamp: Date.now() - H }));
    let failed = null;
    try { await c.fetch('/locations'); } catch (e) { failed = e; }
    t.ok(failed instanceof TypeError || (failed && failed.name === 'TypeError'), 'empty cache + no network: the failure reaches the caller (init shows Reload), not a fake empty 200');
    c = world(true);
    c.store.setItem('psycle_cache_locations', JSON.stringify({ data: c.body, timestamp: Date.now() - 25 * H }));
    res = await c.fetch('/locations');
    await flush();
    t.eq((await res.json()).data[0].id, 1, 'a usable stale list still answers when the background refresh fails');
    c = world();
    await c.fetch('/event-types');
    await flush();
    t.ok(c.log.net.length === 1 && c.store.getItem('psycle_cache_event-types') !== null, 'nothing cached: network, then cached');
    c = world();
    c.store.setItem('psycle_cache_instructors', JSON.stringify({ data: c.body, timestamp: Date.now() }));
    await c.fetch('/instructors', { method: 'POST' });
    await c.fetch('/bookings');
    t.eq(c.log.net, ['/instructors', '/bookings'], 'non-GET and uncacheable paths go straight through');
    t.ok(!/cachedFetch|_fetchAndCache|_revalidateInBackground|_origApiFetchForCache/.test(perf) && !/_origApiFetchForCache/.test(t.readSource('types/globals.d.ts')),
      'the caller-less cachedFetch trio and its window global are gone');
  }

  // ── Token-expiry timer ───────────────────────────────────────────────────
  t.section('Token expiry: the warn timer cannot overflow setTimeout (js/security.js)');
  {
    const timers = [];
    const sandbox = {};
    sandbox.window = sandbox; sandbox.self = sandbox; sandbox.top = sandbox;
    sandbox.document = { createElement: () => ({}), documentElement: { style: {} } };
    sandbox.localStorage = t.makeFakeLocalStorage();
    sandbox.location = { href: 'http://localhost/', origin: 'http://localhost', protocol: 'http:' };
    sandbox.console = { log() {}, warn() {}, error() {} };
    sandbox.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
    sandbox.clearTimeout = () => {};
    sandbox.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
    sandbox.atob = (s) => Buffer.from(s, 'base64').toString('binary');
    sandbox.addEventListener = () => {};
    t.vm.createContext(sandbox);
    t.vm.runInContext(t.readSource('js/security.js'), sandbox, { filename: 'js/security.js' });
    const jwt = (secsFromNow) => 'eyJhbGciOiJIUzI1NiJ9.' +
      Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + secsFromNow })).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_') + '.sig';
    const MAX = 0x7FFFFFFF;

    await sandbox._secureTokenStore.set(jwt(30 * 24 * 3600));
    timers.length = 0;
    sandbox.scheduleTokenExpiryCheck();
    t.eq(timers.map((x) => x.ms), [MAX], 'a JWT expiring in 30 days arms ONE timer, clamped to 2^31-1 ms (it used to wrap and fire at once)');
    const first = timers[0];
    timers.length = 0;
    first.fn(); // 24.8 days later the token is still far from expiry
    t.eq(timers.map((x) => x.ms), [MAX], '…and when it fires it re-arms once, clamped again — no immediate-fire loop');

    await sandbox._secureTokenStore.set(jwt(3600));
    timers.length = 0;
    sandbox.scheduleTokenExpiryCheck();
    t.ok(timers.length === 1 && Math.abs(timers[0].ms - 55 * 60 * 1000) < 5000, 'a 1-hour JWT still warns 5 minutes before expiry (' + (timers[0] && timers[0].ms) + 'ms)');
  }

  // ── login.html ───────────────────────────────────────────────────────────
  t.section('login.html: a real form, a timeout, and a lockout that only counts real refusals');
  {
    const loginHtml = t.readSource('login.html');
    const form = /<form id="loginForm"[^>]*>/.exec(loginHtml);
    t.ok(!!form && /novalidate/.test(form[0]) && /onsubmit="event\.preventDefault\(\);doLogin\(\)"/.test(form[0]), 'the fields sit in a <form> whose handler calls preventDefault() FIRST');
    const inputs = loginHtml.match(/<input [^>]*>/g) || [];
    t.ok(inputs.length === 2 && inputs.every((tag) => !/\sname=/.test(tag)), 'neither field has a name= (a native submit could never put the password in the URL)');
    t.ok(/<label for="email">/.test(loginHtml) && /<label for="password">/.test(loginHtml), 'both labels are tied to their inputs');
    t.ok(/id="email"[^>]*autocomplete="username"/.test(loginHtml) && /id="password"[^>]*autocomplete="current-password"/.test(loginHtml), 'username / current-password autocomplete for password managers');
    t.ok(/<button id="loginBtn"[^>]*type="submit"/.test(loginHtml) && !/<button id="loginBtn"[^>]*onclick/.test(loginHtml), 'the button submits the form (no onclick)');
    t.ok(/id="errMsg"[^>]*role="alert"/.test(loginHtml), 'the error box is announced (role=alert)');
    t.ok(!/addEventListener\('keydown'/.test(loginHtml), 'the document-level Enter hack is gone');
    t.ok(!/console\.log\([^)]*JSON\.stringify\(data\)/.test(loginHtml), 'a successful response body (it holds the token) is never logged');
    t.ok(/localStorage\.setItem\('psycle_bearer_token', token\)/.test(loginHtml), 'the legacy token key is still written on success (the app migrates it)');

    const script = /<script>([\s\S]*?)<\/script>/.exec(loginHtml)[1];
    function loginWorld() {
      const els = {
        email: { value: 'me@example.com' }, password: { value: 'hunter2' },
        loginBtn: { disabled: false, textContent: 'Sign in', innerHTML: '' },
        errMsg: { textContent: '', style: {} }, sLogin: { style: {} }, sDone: { style: {} },
      };
      const w = { els, responses: [], posts: 0, aborts: [], now: 1000000, store: t.makeFakeLocalStorage(), logs: [] };
      const ctx = t.vm.createContext({
        location: { href: 'https://app.test/login.html', origin: 'https://app.test', protocol: 'https:' },
        document: { getElementById: (id) => els[id] },
        window: { opener: null },
        localStorage: w.store,
        console: { log: (...a) => w.logs.push(a) },
        setInterval: () => 1, clearInterval: () => {},
        setTimeout: (fn, ms) => { if (ms === 15000) w.aborts.push(fn); return 1; }, clearTimeout: () => {},
        AbortController,
        fetch: (url, opts) => { w.posts++; w.lastOpts = opts; const next = w.responses.shift(); return typeof next === 'function' ? next(opts) : Promise.resolve(next); },
        __w: w,
      });
      t.vm.runInContext('Date.now = function () { return __w.now; };', ctx);
      t.vm.runInContext(script, ctx, { filename: 'login.html[script]' });
      w.ctx = ctx;
      w.res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
      w.err = () => els.errMsg.textContent;
      return w;
    }

    let lw = loginWorld();
    t.eq([401, 403, 422, 400, 404].map((s) => lw.ctx.countsTowardLockout(s)), [true, true, true, true, true], 'a 4xx refusal counts towards the lockout');
    t.eq([408, 429, 500, 503, 0, 200].map((s) => lw.ctx.countsTowardLockout(s)), [false, false, false, false, false, false], '408 / 429 / 5xx / no answer never do');
    t.eq(lw.ctx.firstErrorMessage({ errors: { email: ['The email field is required.', 'x'], password: ['y'] } }, 422), 'The email field is required.', 'Laravel-style errors → the first message, not raw JSON');
    t.eq(lw.ctx.firstErrorMessage({ message: 'These credentials do not match our records.' }, 401), 'These credentials do not match our records.', 'message wins');
    t.eq(lw.ctx.firstErrorMessage({ errors: [{ message: 'Nope' }] }, 400), 'Nope', 'an array of error objects → its first message');
    t.eq(lw.ctx.firstErrorMessage({}, 418), "Couldn't sign in. Check your email and password, then try again.", 'nothing usable → a plain sentence, never a bare status code');
    t.eq(lw.ctx.firstErrorMessage({ message: { deep: { deeper: ['x'.repeat(500)] } } }, 400).length, 200, 'always a plain, capped string');
    t.ok(/wait|minute/i.test(lw.ctx.firstErrorMessage({ message: 'Too Many Attempts.' }, 429)) && /trouble/i.test(lw.ctx.firstErrorMessage({ message: 'Server Error' }, 503)), '429 and 5xx get friendly copy');

    // Three dropped connections must not lock anyone out.
    for (let i = 0; i < 4; i++) { lw.responses.push(() => Promise.reject(new TypeError('Failed to fetch'))); await lw.ctx.doLogin(); }
    t.eq([lw.posts, lw.els.loginBtn.disabled, lw.els.loginBtn.textContent, /Couldn't reach Psycle/.test(lw.err())], [4, false, 'Sign in', true], 'four network failures in a row: still no lockout');
    for (let i = 0; i < 3; i++) { lw.responses.push(lw.res(503, { message: 'Server Error' })); await lw.ctx.doLogin(); }
    t.eq([lw.posts, lw.els.loginBtn.disabled], [7, false], 'three 5xx answers: no lockout either');
    // Three real refusals do.
    for (let i = 0; i < 3; i++) { lw.responses.push(lw.res(401, { message: 'Wrong password' })); await lw.ctx.doLogin(); }
    t.eq([lw.posts, lw.els.loginBtn.disabled, lw.els.loginBtn.textContent, lw.err()], [10, true, 'Wait 30s', 'Wrong password'], 'three 401s: locked for 30s, with the server\'s reason on screen');
    await lw.ctx.doLogin();
    t.eq(lw.posts, 10, 'while locked nothing is sent');

    lw = loginWorld();
    lw.responses.push(lw.res(429, { message: 'Too Many Attempts.' }));
    await lw.ctx.doLogin();
    t.eq([lw.els.loginBtn.disabled, lw.els.loginBtn.textContent], [true, 'Wait 60s'], '429: a 60s local stand-off');
    lw.now += 61000;
    lw.responses.push(lw.res(401, { message: 'Wrong password' }));
    await lw.ctx.doLogin();
    t.eq([lw.posts, lw.els.loginBtn.disabled], [2, false], '…that did not count as a failed attempt');

    // Timeout.
    lw = loginWorld();
    lw.responses.push((opts) => new Promise((resolve, reject) => { opts.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); }); }));
    const pending = lw.ctx.doLogin();
    t.ok(lw.lastOpts.signal && lw.aborts.length === 1, 'the login POST carries an abort signal on a 15s timer');
    lw.aborts[0]();
    await pending;
    t.ok(/too long/i.test(lw.err()) && lw.els.loginBtn.disabled === false && lw.els.loginBtn.textContent === 'Sign in', 'a hung request ends with "took too long" and a usable button');
    lw.responses.push(lw.res(200, { data: { token: 'tok-NEW-1234567890' } }));
    await lw.ctx.doLogin();
    t.eq([lw.store.getItem('psycle_bearer_token'), lw.els.password.value, lw.els.sDone.style.display], ['tok-NEW-1234567890', '', ''], '…and the next attempt can still sign in (in-flight flag released)');

    // A 200 with the token under a name we don't know: names only in the console.
    lw = loginWorld();
    lw.responses.push(lw.res(200, { jwt: 'SECRET-TOKEN-VALUE', data: { session: 'SECRET-2' } }));
    await lw.ctx.doLogin();
    const logged = JSON.stringify(lw.logs);
    t.ok(/jwt/.test(logged) && /session/.test(logged) && !/SECRET/.test(logged), 'unknown token field: its NAME is logged, never its value');
    t.eq(lw.els.loginBtn.disabled, false, '…and the button is usable again');
  }

  // ── Service-worker update flow ───────────────────────────────────────────
  t.section('Service worker: a new version reloads only when nobody is looking, otherwise offers it');
  {
    const finder = t.readSource('psycle-finder.html');
    const head = finder.slice(0, finder.indexOf('</head>'));
    const inline = (head.match(/<script>([\s\S]*?)<\/script>/g) || []).map((s) => s.replace(/^<script>|<\/script>$/g, '')).filter((s) => /controllerchange/.test(s))[0];
    t.ok(!!inline, 'the controllerchange handler is an inline script in <head> (HTML is network-first; a stale cached app.js cannot break it)');
    // ios-app/build.js strips these substrings from the whole HTML file when it flattens www/.
    t.ok(!/js\/|css\/|fonts\//.test(inline || ''), 'the inline script contains nothing build.js\'s path flattening would rewrite');

    function swWorld(o) {
      o = o || {};
      const w = { reloads: 0, listeners: {}, bars: [], now: 1000000, session: t.makeFakeLocalStorage(), busyBtn: null, dialog: false, active: null };
      const mkEl = () => { const e = { style: {}, children: [], setAttribute() {}, appendChild(c) { e.children.push(c); } }; return e; };
      const anchor = { parentNode: { insertBefore: (bar) => { w.bars.push(bar); } }, nextSibling: null };
      const sw = o.sw === undefined ? { controller: o.controller === false ? null : {}, addEventListener: (type, fn) => { w.listeners[type] = fn; } } : o.sw;
      const doc = {
        hidden: !!o.hidden, body: {}, get activeElement() { return w.active; },
        createElement: mkEl,
        getElementById: (id) => (id === 'sessionBanner' ? anchor : (id === 'updateBanner' ? (w.bars[0] || null) : null)),
        querySelector: () => null,
        querySelectorAll: () => (w.busyBtn ? [w.busyBtn] : []),
        addEventListener() {},
      };
      const ctx = t.vm.createContext({
        navigator: { serviceWorker: sw }, document: doc, sessionStorage: o.noSession ? { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } } : w.session,
        location: { reload: () => { w.reloads++; } },
        _dialogOpen: () => w.dialog,
        __w: w,
      });
      t.vm.runInContext('Date.now = function () { return __w.now; };', ctx);
      t.vm.runInContext(inline, ctx, { filename: 'psycle-finder.html[sw update]' });
      w.doc = doc;
      w.fire = () => w.listeners.controllerchange && w.listeners.controllerchange();
      return w;
    }
    if (inline) {
      let s = swWorld({ controller: false });
      t.eq(Object.keys(s.listeners), [], 'no controller at load (first install / hard reload): nothing is listened for — nothing on the page is stale');
      let threw = false;
      try { s = swWorld({ sw: { register: () => Promise.resolve() } }); s = swWorld({ sw: null }); } catch (e) { threw = true; }
      t.ok(!threw && Object.keys(s.listeners).length === 0, 'the iOS app\'s register-only stub (or no serviceWorker at all): a silent no-op');

      s = swWorld({ hidden: true });
      s.now += 60000;
      s.fire();
      t.eq([s.reloads, s.bars.length], [1, 0], 'hidden tab: reloads by itself');
      t.ok(Number(s.session.getItem('psycle_sw_reload_at')) === s.now, '…and stamps the reload in sessionStorage');
      s.now += 5 * 60000;
      s.fire();
      t.eq([s.reloads, s.bars.length], [1, 1], 'a second take-over within 10 minutes never auto-reloads again (loop guard) — it offers the bar');
      s.now += 6 * 60000;
      s.fire();
      t.eq(s.reloads, 2, '…after 10 minutes it may');

      s = swWorld();
      s.now += 2000;
      s.fire();
      t.eq(s.reloads, 1, 'page under 5s old: reloads (nobody has started anything)');

      s = swWorld();
      s.now += 60000;
      s.fire();
      t.eq([s.reloads, s.bars.length], [0, 1], 'visible and in use: never reloads — shows the bar');
      const bar = s.bars[0];
      t.ok(bar.id === 'updateBanner' && /app-banner/.test(bar.className) && /app-banner-info/.test(bar.className) && bar.style.display === 'flex', 'the bar is a token-styled .app-banner under #sessionBanner');
      const reloadBtn = bar.children.filter((c) => c.textContent === 'Reload')[0];
      const closeBtn = bar.children.filter((c) => c.textContent === '×')[0];
      reloadBtn.onclick();
      t.eq(s.reloads, 1, 'its Reload button reloads');
      closeBtn.onclick();
      t.eq(bar.style.display, 'none', 'its × dismisses it');
      s.fire();
      t.eq([s.bars.length, bar.style.display], [1, 'flex'], 'a later take-over brings the same bar back (no duplicates)');

      s = swWorld({ hidden: true }); s.now += 60000; s.dialog = true; s.fire();
      t.eq([s.reloads, s.bars.length], [0, 1], 'hidden but a dialog is open: the bar, not a reload');
      s = swWorld({ hidden: true }); s.now += 60000; s.busyBtn = { getAttribute: () => '1', textContent: 'Book' }; s.fire();
      t.eq(s.reloads, 0, 'hidden but a booking button is busy: no reload');
      s = swWorld({ hidden: true }); s.now += 60000; s.busyBtn = { getAttribute: () => null, textContent: '…' }; s.fire();
      t.eq(s.reloads, 0, 'hidden but a button shows "…": no reload');
      s = swWorld({ hidden: true }); s.now += 60000; s.active = { tagName: 'INPUT' }; s.fire();
      t.eq(s.reloads, 0, 'hidden but a field has focus: no reload');
      s = swWorld({ hidden: true, noSession: true }); s.now += 60000; s.fire();
      t.eq([s.reloads, s.bars.length], [0, 1], 'no sessionStorage (so no loop guard): never automatic');
    }

    const reg = appSrc.slice(appSrc.indexOf('// ── PWA Service Worker'));
    t.ok(/register\('sw\.js'\)\.then\(reg => \{\s*if \(!reg \|\| typeof reg\.update !== 'function'\) return;/.test(reg), 'app.js: the registration tolerates the iOS stub (register() resolving with nothing)');
    t.ok(/visibilitychange/.test(reg) && /60 \* 60 \* 1000/.test(reg) && /reg\.update\(\)/.test(reg), 'app.js: sw.js is re-checked on return to the foreground, at most hourly');

    // Banner styling: tokens only, and present for both bars.
    const css = t.readSource('css/styles.css');
    const rule = (sel) => { const at = css.indexOf('\n' + sel + ' {'); return at === -1 ? '' : css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at)); };
    t.ok(/background:\s*var\(--bg-panel/.test(rule('.app-banner-info')) && /color:\s*var\(--text[,)]/.test(rule('.app-banner-info')), '.app-banner-info reads --bg-panel / --text');
    t.ok(/#offlineBanner, #updateBanner \{ flex: 0 0 auto; \}/.test(css), 'both bars are rigid flex children of the mobile app shell');
    ['.app-banner-info', '.mb-saved-note', '.mb-saved-label'].forEach((sel) => {
      t.eq((rule(sel).replace(/var\(--[a-z0-9-]+\s*,\s*#[0-9a-f]{3,8}\)/gi, 'var()').match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) || []), [], sel + ' has no fixed colours (tokens only)');
    });
    t.ok(/el\.id = 'offlineBanner';\s*el\.className = 'app-banner';/.test(appSrc), 'the offline bar is a plain (amber, AA-checked) .app-banner');

    // The new surfaces hold 12–13px copy: AA in EVERY theme (Handheld is the tight one).
    const themeCss = t.readSource('css/theme.css');
    const tokensOf = (selector) => {
      const start = themeCss.indexOf(selector + ' {');
      const out = {};
      if (start === -1) return out;
      themeCss.slice(themeCss.indexOf('{', start) + 1, themeCss.indexOf('}', start)).replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g, (m, k, v) => { out[k] = v.trim(); return m; });
      return out;
    };
    const lum = (hex) => {
      let h = hex.replace('#', '');
      if (h.length === 3) h = h.split('').map((ch) => ch + ch).join('');
      const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((s) => (s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    t.ok(/color:\s*var\(--text-muted/.test(rule('.mb-saved-note')) && !/background/.test(rule('.mb-saved-note')), '.mb-saved-note: --text-muted copy straight on the bookings panel (no fill of its own)');
    const ids = [];
    t.readSource('js/theme.js').replace(/\{\s*id:\s*'([a-z]+)'/g, (m, id) => { ids.push(id); return m; });
    t.ok(ids.length >= 5, 'theme ids parsed (' + ids.join(', ') + ')');
    ids.forEach((id) => {
      const tk = Object.assign({}, tokensOf(':root'), tokensOf('[data-theme="' + id + '"]'));
      const note = contrast(tk['--text-muted'], tk['--upcoming-bg']);
      const info = contrast(tk['--text'], tk['--bg-panel']);
      t.ok(note >= 4.5 && info >= 4.5, id + ': saved-copy note ' + note.toFixed(2) + ':1, "new version" bar ' + info.toFixed(2) + ':1 (both ≥4.5)');
    });
  }
};
