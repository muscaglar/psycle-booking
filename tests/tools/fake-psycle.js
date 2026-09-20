/* A fake Psycle server for browser checks and App Store captures (tests/README.md → "Driving the app in a browser").
 * Evaluate it on a blank same-origin page BEFORE the app's HTML is written into the document, so window.fetch is the
 * fake server from the app's first line:  (0, eval)(await fetch('/tests/tools/fake-psycle.js').then(r => r.text()));
 * then  await __H.boot({})  writes the REAL psycle-finder.html into the page. Every request to psycle.codexfit.com is
 * answered here (a 7-day timetable, 3 studios, 5 class types, one empty day; bookings kept in memory — waitlists are
 * NOT: PUT /waitlists answers success and stores nothing, GET /waitlists is always empty; wrap __H.serve to hold one):
 * nothing can reach the live API. __H.writes records every write, __H.leaked anything that tried to leave,
 * __H.liveHits() what the browser's own resource log says. __H.swipe(x0,y0,x1,y1) sends a real touch sequence,
 * __H.discover() reports the day pager, __H.until(fn, ms) / __H.sleep(ms) wait. */
(function () {
  if (window.__H) return;
  var H = window.__H = { calls: [], writes: [], leaked: [], unknown: [], announces: [], confirms: [], toasts: [], opts: {}, bookings: [], nextBookingId: 9001, delayMs: 0 };
  try { performance.setResourceTimingBufferSize(5000); } catch (e) {}
  var realFetch = window.fetch.bind(window);
  H.realFetch = realFetch;

  var now = new Date();
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var dayStr = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  H.day = function (n) { return dayStr(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n, 12)); };
  H.today = H.day(0);

  var locations = [
    { id: 1, name: 'Psycle Oxford Circus', handle: 'oxford-circus', is_visible: true, address: '76 Mortimer St, London' },
    { id: 2, name: 'Psycle Shoreditch', handle: 'shoreditch', is_visible: true, address: '20 Rivington St, London' },
    { id: 3, name: 'Psycle Clapham', handle: 'clapham', is_visible: true, address: '30 Venn St, London' },
  ];
  function layout() {
    var slots = [];
    for (var i = 1; i <= 12; i++) slots.push({ id: i, label: String(i), x: 60 + ((i - 1) % 6) * 90, y: 80 + Math.floor((i - 1) / 6) * 110 });
    return { slots: slots, objects: [] };
  }
  var studios = [
    { id: 11, name: 'Ride Studio', location_id: 1, has_layout: true, layout: layout() },
    { id: 21, name: 'Studio One', location_id: 2, has_layout: true, layout: layout() },
    { id: 31, name: 'Main Room', location_id: 3, has_layout: true, layout: layout() },
  ];
  var instructors = [
    { id: 101, full_name: 'Alex Hart', is_visible: true, bio: 'Rides hard.' },
    { id: 102, full_name: 'Bea Collins', is_visible: true, bio: '' },
    { id: 103, full_name: 'Cam Reyes', is_visible: true, bio: '' },
    { id: 104, full_name: 'Dee Okoro', is_visible: true, bio: '' },
    { id: 105, full_name: 'Eli Novak', is_visible: true, bio: '' },
  ];
  var eventTypes = [
    { id: 201, name: 'RIDE 45' },
    { id: 202, name: 'STRENGTH: Full Body' },
    { id: 203, name: 'YOGA Flow' },
    { id: 204, name: 'REFORMER Pilates' },
    { id: 205, name: 'BARRE' },
  ];
  H.ref = { locations: locations, studios: studios, instructors: instructors, eventTypes: eventTypes };

  // Day counts: today is whatever is still ahead; then 5,6,4,0(EMPTY),7,3 and a thin second week.
  var counts = [null, 5, 6, 4, 0, 7, 3, 2, 1, 0, 0, 0, 0, 0];
  var times = ['06:30', '07:30', '12:15', '17:30', '18:30', '19:30', '09:30'];
  var events = [];
  function mk(d, k, time, extra) {
    var e = {
      id: 1000 + d * 100 + k, start_at: H.day(d) + 'T' + time + ':00', duration: 45,
      studio_id: studios[k % 3].id, instructor_id: instructors[(d + k) % 5].id, event_type_id: eventTypes[(d * 2 + k) % 5].id,
      capacity: 12, occupancy: 3 + ((d + k) % 5), is_fully_booked: false, is_waitlistable: true, is_live_stream: false,
    };
    if (extra) Object.keys(extra).forEach(function (x) { e[x] = extra[x]; });
    events.push(e);
    return e;
  }
  // today: only times still ahead of the clock
  var nowMin = now.getHours() * 60 + now.getMinutes();
  ['22:15', '23:00', '23:40'].forEach(function (t, k) {
    var m = parseInt(t.slice(0, 2), 10) * 60 + parseInt(t.slice(3), 10);
    if (m > nowMin + 12) mk(0, k, t);
  });
  for (var d = 1; d < counts.length; d++) for (var k = 0; k < counts[d]; k++) mk(d, k, times[k % times.length]);
  // Texture: one full + waitlistable class, one nearly full.
  var full = events.filter(function (e) { return e.start_at.slice(0, 10) === H.day(1); })[1];
  if (full) { full.is_fully_booked = true; full.occupancy = 12; }
  var nearly = events.filter(function (e) { return e.start_at.slice(0, 10) === H.day(2); })[0];
  if (nearly) { nearly.occupancy = 10; }
  H.events = events;
  H.countsByDay = function () { var o = {}; events.forEach(function (e) { var d = e.start_at.slice(0, 10); o[d] = (o[d] || 0) + 1; }); return o; };
  H.taken = { }; // eventId → [slot ids taken by others]

  function relations(evts) {
    var st = {}, ins = {}, ty = {};
    evts.forEach(function (e) { st[e.studio_id] = 1; ins[e.instructor_id] = 1; ty[e.event_type_id] = 1; });
    return {
      studios: studios.filter(function (s) { return st[s.id]; }),
      instructors: instructors.filter(function (i) { return ins[i.id]; }),
      event_types: eventTypes.filter(function (t) { return ty[t.id]; }),
      locations: locations,
    };
  }
  function json(status, body) {
    return new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json' } });
  }
  var norm = function (s) { return String(s || '').replace('T', ' '); };

  H.serve = async function (url, init) {
    var method = String((init && init.method) || 'GET').toUpperCase();
    var u = new URL(url);
    var path = u.pathname.replace(/^\/api\/v1\/customer/, '');
    var rec = { m: method, p: path + u.search, at: Date.now() };
    if (init && init.body) { try { rec.body = JSON.parse(init.body); } catch (e) { rec.body = String(init.body); } }
    H.calls.push(rec);
    if (method !== 'GET') H.writes.push(rec);
    if (H.delayMs) await new Promise(function (r) { setTimeout(r, H.delayMs); });
    if (H.fail && H.fail(method, path)) return json(503, { message: 'stub failure' });
    var m;
    if (method === 'GET') {
      if (path === '/profile') return json(200, { data: { id: 1, first_name: 'Test', last_name: 'Member', email: 'test@example.com', subscriptions: [], stats: {} } });
      if (path === '/instructors') return json(200, { data: instructors });
      if (path === '/locations') return json(200, { data: locations });
      if (path === '/event-types') return json(200, { data: eventTypes });
      if (path === '/events') {
        var start = norm(u.searchParams.get('start')), end = norm(u.searchParams.get('end')), loc = Number(u.searchParams.get('location'));
        var list = events.filter(function (e) {
          var s = norm(e.start_at);
          var st = studios.filter(function (x) { return x.id === e.studio_id; })[0];
          return s >= start && s <= end && (!loc || (st && st.location_id === loc));
        });
        return json(200, { data: list, relations: relations(list) });
      }
      if ((m = path.match(/^\/events\/(\d+)$/))) {
        var ev = events.filter(function (e) { return String(e.id) === m[1]; })[0];
        if (!ev) return json(404, { message: 'Not found' });
        var takenByOthers = H.taken[ev.id] || [1, 2, 3];
        var mine = H.bookings.filter(function (b) { return String(b.event_id) === String(ev.id); }).map(function (b) { return b.slot; });
        var avail = [];
        for (var i = 1; i <= 12; i++) if (takenByOthers.indexOf(i) === -1 && mine.indexOf(i) === -1) avail.push(i);
        if (ev.is_fully_booked) avail = [];
        return json(200, { data: ev, slots: avail, relations: relations([ev]) });
      }
      if (path === '/bookings') {
        if (u.searchParams.get('type') === 'previous' || u.searchParams.get('start')) return json(200, { data: [], meta: { current_page: 1, last_page: 1 } });
        return json(200, { data: H.bookings.slice() });
      }
      if ((m = path.match(/^\/bookings\/(\d+)$/))) {
        var b = H.bookings.filter(function (x) { return String(x.id) === m[1]; })[0];
        return b ? json(200, { data: b }) : json(404, { message: 'Not found' });
      }
      if (path === '/waitlists') return json(200, { data: [], meta: { current_page: 1, last_page: 1 } });
      if (/^\/waitlists\/\d+$/.test(path)) return json(200, []);
      H.unknown.push(rec);
      return json(404, { message: 'Not found (stub)' });
    }
    if (method === 'POST' && path === '/bookings') {
      var body = rec.body || {};
      var slots = Array.isArray(body.slots) ? body.slots : [];
      var firstId = null;
      slots.forEach(function (s) { var id = H.nextBookingId++; if (firstId == null) firstId = id; H.bookings.push({ id: id, event_id: Number(body.event_id), slot: Number(s) }); });
      return json(200, { data: { id: firstId, event_id: Number(body.event_id) } });
    }
    if (method === 'DELETE' && (m = path.match(/^\/bookings\/(\d+)$/))) {
      H.bookings = H.bookings.filter(function (x) { return String(x.id) !== m[1]; });
      return json(200, { success: true });
    }
    if (method === 'PUT' && /^\/waitlists\/\d+$/.test(path)) return json(200, { success: true, waitlist: { id: 555 } });
    H.unknown.push(rec);
    return json(404, { message: 'Not found (stub)' });
  };

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : ((input && input.url) || String(input));
    if (url.indexOf('codexfit.com') !== -1) {
      if (!init && input && typeof input === 'object' && input.method) init = { method: input.method };
      return H.serve(url, init || {});
    }
    try {
      var u = new URL(url, location.href);
      if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost' && u.protocol !== 'data:' && u.protocol !== 'blob:') {
        H.leaked.push(url);
        return Promise.resolve(new Response('', { status: 599 }));
      }
    } catch (e) {}
    return realFetch(input, init);
  };
  // Anything that is not fetch must not get out either.
  var xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (String(url).indexOf('codexfit.com') !== -1) { H.leaked.push('XHR ' + method + ' ' + url); throw new Error('verifier: XHR to live host refused'); }
    return xhrOpen.apply(this, arguments);
  };
  if (navigator.sendBeacon) {
    var beacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url) { if (String(url).indexOf('codexfit.com') !== -1) { H.leaked.push('BEACON ' + url); return false; } return beacon.apply(null, arguments); };
  }
  // No service worker during the run: every file must come from the build on disk.
  try { Object.defineProperty(ServiceWorkerContainer.prototype, 'register', { configurable: true, value: function () { return Promise.resolve(); } }); } catch (e) {}

  // What reached the network that names the live host (resource timing sees cross-origin requests too).
  H.liveHits = function () { return performance.getEntriesByType('resource').filter(function (e) { return /codexfit/.test(e.name); }).map(function (e) { return e.name; }); };

  H.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  H.until = async function (fn, ms) { var t0 = Date.now(); while (Date.now() - t0 < (ms || 8000)) { try { var v = fn(); if (v) return v; } catch (e) {} await H.sleep(40); } return null; };

  // Write the REAL page into this (blank) document. opts: { search, hash }
  H.boot = async function (opts) {
    opts = opts || {};
    var html = await realFetch('/psycle-finder.html', { cache: 'reload' }).then(function (r) { return r.text(); });
    // Not an HTTP request, but it is a socket to the live host: leave it out.
    html = html.replace(/<link rel="preconnect"[^>]*>\s*/g, '').replace(/<link rel="dns-prefetch"[^>]*>\s*/g, '');
    history.replaceState(null, '', '/psycle-finder.html' + (opts.search || '') + (opts.hash || ''));
    document.open(); document.write(html); document.close();
    var ok = await H.until(function () { return typeof window.search === 'function' && typeof window.switchTab === 'function' && window.securityReady; }, 10000);
    if (!ok) return 'app did not load';
    await window.securityReady;
    // Hooks that only record.
    var a0 = window.announce;
    if (typeof a0 === 'function' && !a0.__v) { window.announce = function (t, x) { H.announces.push(String(t)); return a0.apply(this, arguments); }; window.announce.__v = true; }
    var t0 = window.toast;
    if (typeof t0 === 'function' && !t0.__v) { window.toast = function (t) { H.toasts.push(String(t)); return t0.apply(this, arguments); }; window.toast.__v = true; }
    return 'ok';
  };

  // A real touch sequence on whatever is under the start point.
  H.swipe = async function (x0, y0, x1, y1, o) {
    o = o || {};
    var steps = o.steps || 8, stepMs = o.stepMs == null ? 16 : o.stepMs;
    var target = document.elementFromPoint(x0, y0);
    if (!target) return { error: 'nothing at start point' };
    var id = Date.now() % 100000;
    var touch = function (x, y) { return new Touch({ identifier: id, target: target, clientX: x, clientY: y, pageX: x + window.scrollX, pageY: y + window.scrollY, screenX: x, screenY: y, radiusX: 11, radiusY: 11, force: 0.5 }); };
    var fire = function (type, x, y) {
      var t = touch(x, y), live = type === 'touchend' || type === 'touchcancel' ? [] : [t];
      target.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, composed: true, touches: live, targetTouches: live, changedTouches: [t] }));
    };
    fire('touchstart', x0, y0);
    for (var i = 1; i <= steps; i++) { await H.sleep(stepMs); fire('touchmove', x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); }
    await H.sleep(stepMs);
    fire('touchend', x1, y1);
    return { target: (target.id ? '#' + target.id : target.tagName.toLowerCase() + '.' + String(target.className).split(' ').join('.')), inPager: !!target.closest('#dayPager'), inStrip: !!target.closest('#dayStrip'), inDates: !!target.closest('.date-presets') };
  };

  // What Discover shows right now.
  H.discover = function () {
    var pills = Array.prototype.map.call(document.querySelectorAll('#dayStrip .day-pill'), function (p) {
      return { day: p.dataset.day, label: (p.querySelector('.day-pill-label') || p).textContent.trim(), count: (p.querySelector('.day-pill-count') || {}).textContent || '', on: p.getAttribute('aria-selected') === 'true' };
    });
    var cards = document.querySelectorAll('#results .event-card, #results .class-card, #results [data-event-id]');
    var ids = {}; Array.prototype.forEach.call(document.querySelectorAll('#results [data-event-id]'), function (c) { ids[c.dataset.eventId] = 1; });
    var head = document.querySelector('#dayPager .day-heading, #dayPager h2, #dayPager .day-header, #results .day-header');
    return { pagerDay: window._pagerDay, pills: pills, heading: head ? head.textContent.replace(/\s+/g, ' ').trim() : null, cardIds: Object.keys(ids), nCards: cards.length, windowKey: window._windowKey, scrollY: Math.round(window.scrollY) };
  };
})();
