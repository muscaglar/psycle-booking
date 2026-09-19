'use strict';
// First-run welcome (wave 8): the full-screen, swipeable overlay that replaced
// the four-card tour.
//  · pure:welcome in js/app.js — who sees it (_welcomeDecision), what it says
//    (_welcomePages) and the swipe arithmetic;
//  · the SHIPPED launch path (_onboardLaunchFacts + _maybeStartOnboarding,
//    sliced out of app.js) against fakes: a member is marked complete without
//    seeing anything, the iOS app holds a plain cover until its storage restore
//    has landed, and nothing it does can throw into app.js's own loading;
//  · the contracts other code leans on: the overlay's id / class / dialog
//    attributes, the completion flag, the Settings row, tokens-only CSS.
// Whether a finger really turns a page can only be proven in a browser.
module.exports = function (t) {
  const { ok, eq } = t;
  const appSrc = t.readSource('js/app.js');
  const p = t.loadPure('js/app.js', 'welcome');

  // A top-level `function name(` down to its closing bare `}`.
  function grab(src, opener) {
    const from = src.indexOf('\n' + opener);
    const to = from === -1 ? -1 : src.indexOf('\n}\n', from);
    if (from === -1 || to === -1) throw new Error('js/app.js: "' + opener + '" not found — anchor moved?');
    return src.slice(from + 1, to + 2);
  }

  // ── Who sees it ────────────────────────────────────────────────────────
  t.section('Welcome: who sees it (pure)');
  const d = (s) => p._welcomeDecision(s);
  eq(d({}), 'show', 'nothing known about this install, nothing in the way → show');
  eq(d(undefined), 'show', 'no facts at all is a newcomer too (never a throw)');
  eq(d({ completed: true }), 'skip', 'finished (or skipped) once → never again');
  eq(d({ completed: true, hasToken: true, historyCount: 50 }), 'skip', '…whatever else is true');
  eq(d({ smoke: true }), 'skip', 'tests/smoke.html → never, and the flag is left alone');
  eq(d({ hasToken: true }), 'done', 'a stored token with no flag → marked complete silently');
  eq(d({ hasToken: true, restorePending: true, deepLink: true, dialogUp: true }), 'done', '…a token decides it on its own, before anything else is asked');
  eq([d({ historyCount: 4 }), d({ historyCount: '12' })], ['done', 'done'], 'a booking history (the old tour\'s > 3 rule) → marked complete silently');
  eq([d({ historyCount: 3 }), d({ historyCount: 0 }), d({ historyCount: 'x' })], ['show', 'show', 'show'], 'three classes or fewer, or junk, is still a newcomer');
  eq(d({ restorePending: true }), 'wait', 'iOS before its storage restore: the flag or a token may be about to come back');
  eq(d({ restorePending: true, deepLink: true }), 'wait', '…and that outranks "not now": a restored member must end up marked complete');
  eq(d({ deepLink: true }), 'skip', 'a #tab link / a notification or widget tap on its way to a class → not this launch');
  eq(d({ dialogUp: true }), 'skip', 'a sheet or dialog already open → not this launch');
  eq(d({ deepLink: true, smoke: false, completed: false }), 'skip', '"skip" leaves the flag alone, so the next plain launch asks again');

  // ── What it says ───────────────────────────────────────────────────────
  t.section('Welcome: four pages, a title and one sentence each (the first: the board\'s two-sentence headline)');
  const web = p._welcomePages(false);        // a desktop browser: a mouse, nothing to swipe with
  const phoneWeb = p._welcomePages(false, true); // the web build on a phone
  const ios = p._welcomePages(true, true);
  eq(web.map((x) => x.id), ['welcome', 'find', 'book', 'keep'], 'Welcome · Find · Book · Keep up, in that order');
  eq(ios.map((x) => x.id), web.map((x) => x.id), 'the iOS app has the same four');
  eq([web[0].body, ios[0].body], ['Find a class. Book a spot.', 'Find a class. Book a spot.'], 'the first page\'s line is the headline of the approved welcome board');
  eq(web[0].title, 'Psync', 'the first page is the wordmark');
  ok(/independent companion/.test(web[0].note) && /not affiliated with/.test(web[0].note) && /Psycle/.test(web[0].note),
    'the first page says it is an independent companion, not affiliated with Psycle');
  eq(ios[0].note, web[0].note, '…on both builds');
  [web, ios, phoneWeb].forEach((pages, n) => {
    const build = ['web', 'iOS', 'web on a phone'][n];
    pages.forEach((pg) => {
      const copy = [pg.title, pg.body, pg.note || ''];
      ok(copy.every((s) => s.indexOf('!') === -1), build + ' · ' + pg.id + ': no exclamation marks');
      ok(pg.title.length > 0 && pg.title.length <= 20, build + ' · ' + pg.id + ': a short title');
      // Wave 9: page one's line is the Crisp Colour welcome board's headline, set large.
      eq((pg.body.match(/[.?]/g) || []).length, pg.id === 'welcome' ? 2 : 1, build + ' · ' + pg.id + (pg.id === 'welcome' ? ': two short sentences (the headline)' : ': one sentence'));
      ok(/\.$/.test(pg.body), build + ' · ' + pg.id + ': …that ends');
      ok(!/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(copy.join(' ')), build + ' · ' + pg.id + ': no emoji');
    });
  });
  ok(/swipe between days/.test(ios[1].body) && /swipe between days/.test(phoneWeb[1].body) && /dates/.test(ios[1].body), 'Find, on a touch screen: choose your dates, swipe between days');
  ok(!/swipe/i.test(web.map((x) => x.body).join(' ')) && /step through the days/.test(web[1].body) && /dates/.test(web[1].body),
    'Find, with a mouse: nothing says "swipe" — the day pager only listens to touches (chevrons, the strip and the arrow keys step through the days)');
  eq(phoneWeb.map((x, i) => (i === 1 ? '' : x.body)), web.map((x, i) => (i === 1 ? '' : x.body)), '…and that sentence is the only difference a touch screen makes');
  ok(/usual spot/.test(web[2].body) && /clash/.test(web[2].body) && /late-cancel window/.test(web[2].body), 'Book: the usual spot, clashes, the late-cancel window');
  ok(!/\bbike\b/i.test(web[2].body), 'Book: "spot" — the app\'s one word for what a member holds (not every class is a ride)');
  ok(/on iPhone/.test(ios[3].body) && /widgets and reminders/.test(ios[3].body), 'Keep up (iOS app): widgets and reminders, "on iPhone"');
  ok(!/iPhone|widget|reminder/i.test(web.map((x) => x.body + (x.note || '')).join(' ')), 'Keep up (web): nothing about widgets, reminders or iPhone');
  ok(/in one place/.test(web[3].body), 'Keep up: everything you hold in one place');

  // ── Swipe arithmetic ───────────────────────────────────────────────────
  t.section('Welcome: swipe arithmetic (pure)');
  eq([p._welcomeSwipeAxis(5, 2), p._welcomeSwipeAxis(12, 0), p._welcomeSwipeAxis(0, 12)], ['', '', ''], 'under the 12px threshold nothing is decided');
  eq([p._welcomeSwipeAxis(13, 0), p._welcomeSwipeAxis(-40, 10)], ['x', 'x'], 'clearly sideways (either direction) → the pager\'s');
  eq([p._welcomeSwipeAxis(20, 14), p._welcomeSwipeAxis(-30, 25)], ['y', 'y'], 'a slanted drag (|dx| ≤ 1.5×|dy|) is a scroll, not a page turn');
  eq(p._welcomeSwipeAxis(3, -60), 'y', 'vertical → the page\'s own scroll');
  eq(p._welcomeSwipeAxis(14, 10), '', 'sideways-ish but not yet clearly so, and not yet a scroll → keep watching');

  eq(p._welcomeSwipeTarget(0, 4, -120, 390, 600), 1, 'dragged left past a quarter of the width → next page');
  eq(p._welcomeSwipeTarget(2, 4, 120, 390, 600), 1, 'dragged right past a quarter → previous page');
  eq(p._welcomeSwipeTarget(1, 4, -90, 390, 600), 1, 'a slow drag short of a quarter springs back');
  eq(p._welcomeSwipeTarget(1, 4, -60, 390, 120), 2, 'a quick flick (over 40px in under 250ms) turns the page all the same');
  eq(p._welcomeSwipeTarget(1, 4, -30, 390, 80), 1, '…but a twitch under 40px does not');
  eq([p._welcomeSwipeTarget(0, 4, 300, 390, 100), p._welcomeSwipeTarget(3, 4, -300, 390, 100)], [0, 3], 'never past either end');
  eq(p._welcomeSwipeTarget(1, 4, -200, 0, 0), 2, 'an unmeasured width cannot swallow a real drag');

  eq([p._welcomeDragOffset(1, 4, -80), p._welcomeDragOffset(1, 4, 80)], [-80, 80], 'between pages the track follows the finger one for one');
  eq([p._welcomeDragOffset(0, 4, 90), p._welcomeDragOffset(3, 4, -90)], [30, -30], 'at the first / last page it resists: a third of the way');
  eq([p._welcomeDragOffset(0, 4, -90), p._welcomeDragOffset(3, 4, 90)], [-90, 90], '…but only in the direction with no page');

  eq([p._welcomeClamp(-1, 4), p._welcomeClamp(0, 4), p._welcomeClamp(3, 4), p._welcomeClamp(9, 4)], [0, 0, 3, 3], 'page index is clamped to the pages there are');
  eq([p._welcomeClamp(2, 0), p._welcomeClamp(NaN, 4), p._welcomeClamp(undefined, 4)], [0, 0, 0], 'no pages / junk → 0, never NaN');

  eq(p._welcomeDayLabels(2026, 9, 18, 5), ['Today', 'Tomorrow', 'Sun 20', 'Mon 21', 'Tue 22'], 'day strip labels from a calendar date');
  eq(p._welcomeDayLabels(2026, 12, 30, 4), ['Today', 'Tomorrow', 'Fri 1', 'Sat 2'], '…across a year end');
  eq(p._welcomeDayLabels(2027, 3, 27, 4), ['Today', 'Tomorrow', 'Mon 29', 'Tue 30'], '…and across the UK clock change, in any device zone (this suite runs in New York)');

  // ── The shipped launch path ────────────────────────────────────────────
  t.section('Welcome: the launch path (shipped code, fake page)');
  const launchSrc = grab(appSrc, 'function _onboardLaunchFacts(') + '\n' + grab(appSrc, 'function _maybeStartOnboarding(');
  const pureSrc = appSrc.slice(appSrc.indexOf('// ── pure:welcome:start'), appSrc.indexOf('// ── pure:welcome:end'));

  function world(over) {
    over = over || {};
    const store = Object.assign({}, over.store || {});
    const w = {
      log: [], timers: [], overlay: null, store,
      ctx: null,
    };
    const overlayEl = (holding) => ({
      holding,
      classList: { contains: (c) => c === 'is-holding' && w.overlay && w.overlay.holding },
    });
    const ctx = t.vm.createContext({
      console, JSON, Array, String, Number, Math, Date,
      ONBOARDING_KEY: 'psycle_onboarded_v1',
      window: Object.assign({}, over.window || {}),
      location: { hash: over.hash || '' },
      localStorage: {
        getItem: (k) => {
          if (over.storageThrows) throw new Error('SecurityError');
          return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
        },
        setItem: (k, v) => { store[k] = String(v); w.log.push('set ' + k + '=' + v); },
      },
      document: {
        body: over.noBody ? null : {},
        getElementById: (id) => {
          if (id === 'onboardOverlay') return w.overlay;
          if (id === 'bookingConfirmation') return over.bookedSheet ? {} : null;
          return null;
        },
        querySelector: (sel) => {
          if (sel !== '.tab-panel.active') throw new Error('fake DOM: ' + sel);
          return over.activeTab ? { id: over.activeTab } : null;
        },
        addEventListener: (type, fn) => { w.log.push('listen ' + type); w.onReady = fn; },
      },
      getBearerToken: () => over.memoryToken || '',
      _dialogOpen: () => !!over.dialogOpen,
      _OVERLAYS: [['settingsOverlay', null]],
      _overlayIsOpen: (el) => !!el,
      _onboardNative: () => !!over.native,
      startOnboarding: (opts) => {
        if (over.startThrows) { w.overlay = overlayEl(false); throw new Error('boom'); }
        w.overlay = overlayEl(!!(opts && opts.holding));
        w.log.push('start ' + JSON.stringify(opts || {}));
      },
      _onboardReveal: () => { if (w.overlay) w.overlay.holding = false; w.log.push('reveal'); },
      _onboardCleanup: () => { w.overlay = null; w.log.push('cleanup'); },
      setTimeout: (fn, ms) => { w.timers.push({ fn, ms }); return w.timers.length; },
    });
    t.vm.runInContext('var _onboardLaunchSettled = false;\n' + pureSrc + '\n' + launchSrc, ctx, { filename: 'js/app.js[welcome launch]' });
    w.ctx = ctx;
    w.look = (early) => ctx._maybeStartOnboarding(early);
    return w;
  }

  let w = world();
  w.look(true);
  eq(w.log, ['start {"atLaunch":true}'], 'a newcomer on the web: up at the FIRST look — while app.js is still loading — not two seconds in');
  eq(w.store, {}, '…and nothing is written until they finish or skip it');
  w.look(); w.look();
  eq(w.log.length, 1, 'the later looks (securityReady, the first-paint block) change nothing once it is answered');

  w = world({ store: { psycle_bearer_token_enc: 'aes:…' } });
  w.look(true);
  eq([w.log, w.store.psycle_onboarded_v1], [['set psycle_onboarded_v1=1'], '1'], 'a stored session and no flag → marked complete silently, nothing shown');
  w = world({ store: { psycle_bearer_token: 'plain-from-login-page' } });
  w.look(true);
  eq(w.log, ['set psycle_onboarded_v1=1'], '…the plain key login.html writes counts too');
  w = world({ memoryToken: 'tok' });
  w.look();
  eq(w.log, ['set psycle_onboarded_v1=1'], '…and so does a token only security.js holds');
  ok(!/console\.|toast\(|announce\(/.test(launchSrc) && !/=\s*getBearerToken\(\)/.test(launchSrc), 'the token is only ever tested for presence — never kept, printed or sent anywhere');

  w = world({ store: { psycle_onboarded_v1: '1' } });
  w.look(true);
  eq(w.log, [], 'finished before → nothing at all (no write either)');

  w = world({ store: { psycle_class_history: JSON.stringify([1, 2, 3, 4]) } });
  w.look(true);
  eq(w.log, ['set psycle_onboarded_v1=1'], 'a history of more than three classes → marked complete silently');
  w = world({ store: { psycle_class_history: '{not json' } });
  w.look(true);
  eq(w.log, ['start {"atLaunch":true}'], 'an unreadable history is not proof of anything: still a newcomer (as the old tour had it)');

  w = world({ storageThrows: true });
  w.look(true);
  eq(w.log, [], 'storage that cannot be read (it could not remember the answer either) → never shown');

  w = world({ window: { __smokeFetchStub() {} } });
  w.look(true); w.look();
  eq([w.log, w.store], [[], {}], 'tests/smoke.html → never shown, flag untouched');

  eq(['bookings', 'stats', 'membership', 'insights'].map((hash) => { const x = world({ hash: '#' + hash }); x.look(true); return x.log.length; }), [0, 0, 0, 0],
    'a #tab deep link → not this launch');
  w = world({ hash: '#discover' });
  w.look(true);
  eq(w.log.length, 1, '…#discover is where the welcome lands anyway');
  w = world({ activeTab: 'tab-bookings' });
  w.look();
  eq([w.log, w.store], [[], {}], 'a notification / widget tap has already moved to My Bookings → not this launch, and the flag is left for the next');
  w = world({ dialogOpen: true });
  w.look();
  eq(w.log, [], 'a dialog is up → not this launch');
  w = world({ bookedSheet: true });
  w.look();
  eq(w.log, [], 'the Booked! sheet is up → not this launch');

  // iOS: localStorage may have been purged; native-bridge.js (the last script)
  // restores it from Preferences and securityReady waits for that.
  w = world({ native: true });
  w.look(true);
  eq(w.log, ['start {"atLaunch":true,"holding":true}'], 'iOS, first look: a plain cover (no tutorial yet) — the restore may be about to bring a member back');
  eq(w.timers.map((x) => x.ms), [5000], '…with a 5s fail-safe so a stuck start-up cannot leave the cover up');
  w.look(true);
  eq(w.log.length, 1, 'a second early look does not stack another cover or another timer');
  w.look();
  eq(w.log.slice(1), ['reveal'], 'restore landed, still nobody → the cover becomes the welcome');
  w.timers[0].fn();
  eq(w.log.length, 2, '…and the fail-safe finds it answered');

  w = world({ native: true });
  w.look(true);
  w.store.psycle_onboarded_v1 = '1'; // what the restore brings back
  w.look();
  eq(w.log.slice(1), ['cleanup'], 'restore brought the flag back → the cover goes, no welcome');

  w = world({ native: true });
  w.look(true);
  w.store.psycle_bearer_token_enc = 'aes:…';
  w.look();
  eq(w.log.slice(1), ['set psycle_onboarded_v1=1', 'cleanup'], 'restore brought a session back → marked complete, the cover goes');

  w = world({ native: true });
  w.look(true);
  w.timers[0].fn();
  eq(w.log.slice(1), ['reveal'], 'securityReady never settled: the fail-safe decides with what it has');

  w = world({ native: true, store: { psycle_onboarded_v1: '1' } });
  w.look(true);
  eq(w.log, [], 'iOS member with their flag in place: no cover, nothing');

  w = world({ startThrows: true });
  let threw = false;
  try { w.look(true); } catch (e) { threw = true; }
  eq([threw, w.log, w.overlay], [false, ['cleanup'], null], 'a throw while building it never escapes into app.js\'s loading — and half a welcome is taken down');
  w.look();
  eq(w.log, ['cleanup'], '…and it is not tried again this launch');

  w = world({ noBody: true });
  w.look(true);
  eq(w.log, ['listen DOMContentLoaded'], 'no <body> yet (scripts in <head>) → waits for it instead of throwing');

  // ── The overlay itself ─────────────────────────────────────────────────
  // The shipped DOM code (everything between the page state and the launch
  // facts) against a DOM just big enough for it: the markup it builds is
  // parsed for real, so a selector that matches nothing fails here.
  t.section('Welcome: the overlay (shipped code, small fake DOM)');
  {
    const domFrom = appSrc.indexOf('\nlet _onboardIdx = 0;');
    const domTo = appSrc.indexOf('\n// What a launch can know about the person in front of it.');
    ok(domFrom !== -1 && domTo > domFrom, 'the overlay code can be sliced (anchors moved? update tests/suites/8d-welcome.js)');
    const domSrc = appSrc.slice(domFrom, domTo);

    const page = (over) => {
      over = over || {};
      const clock = { now: 1000000 };
      const log = { announced: [], login: 0, timers: [], frames: [], store: {} };
      const doc = { activeElement: null, keydown: [] };
      class El {
        constructor(tag) { this.tag = tag; this.attrs = {}; this.kids = []; this.parent = null; this.text = ''; this.style = {}; this.on = {}; this.clientWidth = 390; }
        get id() { return this.attrs.id || ''; } set id(v) { this.attrs.id = v; }
        get className() { return this.attrs.class || ''; } set className(v) { this.attrs.class = v; }
        get hidden() { return 'hidden' in this.attrs; } set hidden(v) { if (v) this.attrs.hidden = ''; else delete this.attrs.hidden; }
        get disabled() { return 'disabled' in this.attrs; } set disabled(v) { if (v) this.attrs.disabled = ''; else delete this.attrs.disabled; }
        get classList() {
          const el = this, list = () => el.className.split(/\s+/).filter(Boolean);
          return {
            contains: (c) => list().indexOf(c) !== -1,
            add: (...cs) => { cs.forEach((c) => { if (list().indexOf(c) === -1) el.className = list().concat(c).join(' '); }); },
            remove: (c) => { el.className = list().filter((x) => x !== c).join(' '); },
            toggle: (c, on) => { if (on) el.classList.add(c); else el.classList.remove(c); },
          };
        }
        get dataset() {
          const el = this;
          return new Proxy({}, { get: (o, k) => el.attrs['data-' + String(k)], set: (o, k, v) => { el.attrs['data-' + String(k)] = String(v); return true; } });
        }
        get textContent() { return this.text + this.kids.map((k) => k.textContent).join(''); }
        set textContent(v) { this.kids = []; this.text = String(v); }
        set innerHTML(html) {
          this.kids = []; this.text = '';
          let at = this;
          String(html).replace(/<(\/?)([a-z0-9]+)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*>|([^<]+)/gi, (m, close, tag, attrs, text) => {
            if (text !== undefined) { const tx = new El('#text'); tx.text = text.replace(/&amp;/g, '&'); tx.parent = at; at.kids.push(tx); return m; }
            if (close) { if (at.tag !== tag) throw new Error('fake DOM: </' + tag + '> closes <' + at.tag + '>'); at = at.parent; return m; }
            const el = new El(tag);
            (attrs || '').replace(/([a-z-]+)(?:="([^"]*)")?/gi, (mm, k, v) => { el.attrs[k] = v === undefined ? '' : v; return mm; });
            el.parent = at; at.kids.push(el); at = el;
            return m;
          });
          if (at !== this) throw new Error('fake DOM: unclosed <' + at.tag + '>');
        }
        get isConnected() { let n = this; while (n.parent) n = n.parent; return n === doc.body; }
        matches(sel) {
          if (sel[0] === '.') return this.classList.contains(sel.slice(1));
          if (sel[0] === '[') return sel.slice(1, -1) in this.attrs;
          if (/^[a-z0-9]+$/.test(sel)) return this.tag === sel;
          throw new Error('fake DOM: selector ' + sel);
        }
        querySelectorAll(sel) { const out = []; const walk = (n) => n.kids.forEach((k) => { if (k.tag !== '#text' && k.matches(sel)) out.push(k); walk(k); }); walk(this); return out; }
        querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
        closest(sel) { let n = this; while (n && n.tag !== '#text' ? !n.matches(sel) : true) { n = n.parent; if (!n) return null; } return n; }
        setAttribute(k, v) { this.attrs[k] = String(v); }
        getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
        removeAttribute(k) { delete this.attrs[k]; }
        appendChild(k) { k.parent = this; this.kids.push(k); return k; }
        remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; if (doc.activeElement && !doc.activeElement.isConnected) doc.activeElement = doc.body; }
        focus() { if (!this.hidden && !this.disabled) doc.activeElement = this; }
        addEventListener(type, fn, opts) { (this.on[type] = this.on[type] || []).push({ fn, opts }); }
        // Bubbles from this node up; returns whether it reached `document`.
        fire(type, ev) {
          ev = Object.assign({ target: this, stopped: false, stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; } }, ev || {});
          for (let n = this; n && !ev.stopped; n = n.parent) (n.on[type] || []).forEach((l) => l.fn(ev));
          return !ev.stopped;
        }
      }
      doc.body = new El('body');
      doc.activeElement = doc.body;
      doc.createElement = (tag) => new El(tag);
      doc.getElementById = (id) => { const hit = (n) => (n.id === id ? n : n.kids.reduce((f, k) => f || hit(k), null)); return hit(doc.body); };
      doc.addEventListener = (type, fn) => { if (type === 'keydown') doc.keydown.push(fn); };
      doc.removeEventListener = (type, fn) => { doc.keydown = doc.keydown.filter((f) => f !== fn); };
      class FakeDate extends Date { static now() { return clock.now; } }
      const ctx = t.vm.createContext({
        console, JSON, Array, String, Number, Math, Date: FakeDate, Proxy,
        ONBOARDING_KEY: 'psycle_onboarded_v1',
        document: doc,
        window: { Capacitor: over.native ? { isNativePlatform: () => true } : undefined, matchMedia: (q) => ({ matches: /pointer: coarse/.test(q) ? !!over.coarse : !!over.reducedMotion }) },
        localStorage: { setItem: (k, v) => { log.store[k] = String(v); }, removeItem: (k) => { delete log.store[k]; } },
        currentUser: over.signedIn ? { id: 1 } : null,
        getBearerToken: () => (over.signedIn ? 'tok' : ''),
        openLoginPopup: () => { log.login++; },
        announce: (s) => log.announced.push(s),
        escapeHTML: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
        requestAnimationFrame: (fn) => { log.frames.push(fn); },
        setTimeout: (fn, ms) => { log.timers.push({ fn, ms }); return log.timers.length; },
      });
      t.vm.runInContext(pureSrc + '\n' + domSrc + '\nfunction __idx() { return _onboardIdx; }', ctx, { filename: 'js/app.js[welcome overlay]' });
      const ov = () => doc.getElementById('onboardOverlay');
      const q = (sel) => ov().querySelector(sel);
      return {
        ctx, doc, log, clock, ov, q,
        key: (key, extra) => { const e = Object.assign({ key, preventDefault() { this.prevented = true; } }, extra || {}); doc.keydown.slice().forEach((fn) => fn(e)); return e; },
        tap: (sel) => q(sel).fire('click'),
        runTimers: () => { const due = log.timers.splice(0); due.forEach((x) => x.fn()); },
        labels: () => ov().querySelectorAll('button').filter((b) => !b.hidden && !b.disabled).map((b) => b.textContent),
        shown: () => ov().querySelectorAll('.onboard-page').map((el) => el.getAttribute('aria-hidden')).indexOf('false'),
        swipe: (dx, dy, ms) => {
          const vp = q('.onboard-viewport');
          const touch = (x, y) => ({ touches: [{ clientX: x, clientY: y }] });
          const reached = [];
          reached.push(vp.fire('touchstart', touch(200, 300)));
          for (let i = 1; i <= 4; i++) reached.push(vp.fire('touchmove', touch(200 + (dx * i) / 4, 300 + (dy * i) / 4)));
          clock.now += ms;
          reached.push(vp.fire('touchend', { touches: [] }));
          return reached;
        },
      };
    };

    let w = page();
    const opener = new (w.doc.body.constructor)('button');
    w.doc.body.appendChild(opener);
    opener.focus();
    w.ctx.startOnboarding({ atLaunch: true });
    eq([w.ov().id, w.ov().className], ['onboardOverlay', 'onboard-overlay show'], 'at launch it is up and opaque in the same tick (no fade-in over the app)');
    eq(w.log.frames.length, 0, '…with no animation frame to wait for');
    const shell = w.q('.onboard-shell');
    eq([shell.getAttribute('role'), shell.getAttribute('aria-modal'), shell.getAttribute('aria-label'), shell.getAttribute('tabindex')], ['dialog', 'true', 'Welcome to Psync', '-1'], 'a named modal dialog with a focusable panel');
    ok(w.doc.activeElement === shell, 'focus moves onto the panel (the dialog\'s name is read first)');
    eq(w.ov().querySelectorAll('.onboard-page').length, 4, 'four pages');
    eq([w.shown(), w.labels()], [0, ['Skip', 'Next']], 'page one: Skip and Next — no Back, no finish buttons');
    eq(w.q('.onboard-wordmark').textContent, 'Psync', 'page one carries the wordmark');
    ok(/not affiliated with or endorsed by Psycle/.test(w.q('.onboard-note').textContent), '…and the affiliation sentence');
    eq(w.ov().querySelectorAll('.onboard-art').map((a) => a.getAttribute('aria-hidden')), ['true', 'true', 'true', 'true'], 'four illustrations (wave 9: page one has the class-type tiles), all hidden from assistive tech');
    eq([w.ov().querySelectorAll('.onboard-tile').length, w.q('.onboard-headline').textContent, w.q('.onboard-mark').getAttribute('aria-hidden')], [6, 'Find a class. Book a spot.', 'true'],
      'page one: five class-type tiles and the time tile, the headline, and the mark as decoration');
    ok(w.ov().querySelectorAll('.onboard-mini-card').every((c) => c.classList.contains('ct-card') && /^(ride|strength|yoga|pilates)$/.test(c.getAttribute('data-ct'))),
      'every miniature class card IS the Crisp class component: .ct-card + data-ct (css/crisp.css colours it)');
    eq([w.ov().querySelectorAll('.onboard-mini-day').length, w.ov().querySelectorAll('.onboard-mini-seat').length, w.ov().querySelectorAll('.onboard-mini-card').length],
      [5, 18, 6], 'built from miniatures of real components: a day strip, picker seats, class cards');
    const domSrcNoBrand = domSrc.replace(/const _BRAND_MARK_SVG = '[^']*';/, '');
    ok(domSrcNoBrand !== domSrc && !/<svg|<img/.test(domSrcNoBrand) && !/[\u{1F300}-\u{1FAFF}]/u.test(domSrc), 'no images or emoji, and no icon drawn here: the only marks are the class pictograms and the ONE brand mark (tests/suites/12-brand-mark.js holds its geometry)');
    ok(/typeof classPictogram === 'function' \? classPictogram\(ct, size\) : ''/.test(domSrc), '…which come from app.js classPictogram, behind a typeof guard (this block also runs on its own)');
    eq(w.ov().querySelectorAll('.onboard-dot').map((x) => x.classList.contains('active')), [true, false, false, false], 'dots show the position');
    eq(w.log.announced, [], 'opening announces nothing extra (the dialog label is what is read)');

    w.tap('.onboard-next');
    eq([w.shown(), w.labels(), w.q('.onboard-track').style.transform], [1, ['Skip', 'Back', 'Next'], 'translateX(-100%)'], 'Next → page two, Back appears, the track slides');
    eq(w.log.announced, ['Find your class, 2 of 4'], '…and the change is announced');
    w.key('ArrowRight'); w.key('ArrowRight');
    eq([w.shown(), w.labels()], [3, ['Skip', 'Back', 'Sign in with Psycle', 'Look around first']], 'arrow keys turn pages; the last one offers both ways out');
    const edge = w.key('ArrowRight');
    eq([w.shown(), w.log.announced.length, !!edge.prevented], [3, 3, true], 'Right on the last page goes nowhere (and never finishes it)');
    w.key('ArrowLeft');
    eq(w.shown(), 2, 'Left goes back');
    eq(w.log.store, {}, 'turning pages writes nothing');

    // Tab stays inside.
    w.q('.onboard-skip').focus();
    w.key('Tab');
    ok(w.doc.activeElement === w.q('.onboard-back'), 'Tab: Skip → Back');
    w.key('Tab'); w.key('Tab');
    ok(w.doc.activeElement === w.q('.onboard-skip'), 'Tab from the last button wraps to the first (the disabled "Look around first" is skipped)');
    w.key('Tab', { shiftKey: true });
    ok(w.doc.activeElement === w.q('.onboard-next'), 'Shift+Tab wraps backwards');
    shell.focus();
    w.key('Tab', { shiftKey: true });
    ok(w.doc.activeElement === w.q('.onboard-next'), 'Shift+Tab from the panel lands on the last button, not outside');

    // Focus never strands on a button that has just gone.
    w.key('ArrowLeft'); // → page 2
    w.q('.onboard-back').focus();
    w.tap('.onboard-back'); // → page 1: Back hides under the focus
    eq([w.shown(), w.doc.activeElement === w.q('.onboard-next')], [0, true], 'Back on page two hides itself: focus moves to Next');

    // Swipes.
    eq(w.swipe(-160, 6, 500).every((r) => r === false), true, 'no touch on the welcome reaches document (pull-to-refresh, swipe-to-cancel, the day pager)');
    eq(w.shown(), 1, 'a swipe left past a quarter of the width → next page');
    w.swipe(-50, 4, 500);
    eq([w.shown(), w.q('.onboard-track').style.transform, w.q('.onboard-track').classList.contains('is-dragging')], [1, 'translateX(-100%)', false], 'a short slow drag springs back');
    w.swipe(-70, 3, 120);
    eq(w.shown(), 2, 'a quick flick turns the page');
    w.swipe(20, 200, 300);
    eq(w.shown(), 2, 'a vertical drag is a scroll: nothing turns');
    w.swipe(200, 0, 300); w.swipe(200, 0, 300); w.swipe(200, 0, 300);
    eq(w.shown(), 0, 'swiping right walks back to page one…');
    w.swipe(200, 0, 300);
    eq(w.shown(), 0, '…and stops there');
    const vp = w.q('.onboard-viewport');
    vp.fire('touchstart', { touches: [{ clientX: 200, clientY: 300 }] });
    vp.fire('touchmove', { touches: [{ clientX: 290, clientY: 300 }] });
    eq(w.q('.onboard-track').style.transform, 'translateX(calc(0% + 30px))', 'mid-drag the track follows the finger — a third of the way where there is no page');
    vp.fire('touchcancel', { touches: [] });
    eq([w.shown(), w.q('.onboard-track').style.transform], [0, 'translateX(0%)'], 'a cancelled touch springs back');

    // Reduced motion: nothing follows the finger, the release swaps the page.
    let r = page({ reducedMotion: true });
    r.ctx.startOnboarding({ atLaunch: true });
    const rvp = r.q('.onboard-viewport');
    rvp.fire('touchstart', { touches: [{ clientX: 300, clientY: 300 }] });
    rvp.fire('touchmove', { touches: [{ clientX: 150, clientY: 300 }] });
    eq(r.q('.onboard-track').style.transform, 'translateX(0%)', 'reduced motion: the track does not follow the finger');
    rvp.fire('touchend', { touches: [] });
    eq(r.shown(), 1, '…the release simply swaps the page');

    // The double tap that lands on a label that has just changed.
    w.key('ArrowRight'); w.key('ArrowRight');
    w.tap('.onboard-next'); // page 3 → 4: the button now reads "Sign in with Psycle"
    w.clock.now += 150;
    w.tap('.onboard-next');
    eq([w.shown(), w.log.login, w.log.store], [3, 0, {}], 'the second half of a double tap on Next does not sign in or finish anything');
    w.clock.now += 1000;
    w.tap('.onboard-next');
    eq([w.log.login, w.log.store.psycle_onboarded_v1, w.ov().classList.contains('show'), w.ov()._psycleClosing], [1, '1', false, true],
      '"Sign in with Psycle": flag written, fade started, sign-in opened');
    w.tap('.onboard-skip'); w.key('Escape');
    eq(w.log.login, 1, 'nothing acts twice while it fades');
    eq(w.log.timers.map((x) => x.ms), [220], 'removed when the fade ends');
    w.runTimers();
    eq([w.ov(), w.doc.keydown.length, w.doc.activeElement === opener], [null, 0, true], 'gone, its key handler with it, and focus is back where it came from');

    // The other ways out all write the same flag.
    ['look', 'skip', 'escape'].forEach((how) => {
      const x = page();
      x.ctx.startOnboarding({ atLaunch: true });
      if (how === 'look') { x.key('ArrowRight'); x.key('ArrowRight'); x.key('ArrowRight'); x.tap('.onboard-look'); }
      else if (how === 'skip') x.tap('.onboard-skip');
      else x.key('Escape');
      x.runTimers();
      eq([x.log.store.psycle_onboarded_v1, x.log.login, x.ov()], ['1', 0, null], how + ': closed for good, no sign-in page');
    });

    // From Settings, signed in: no sign-in offer, and the flag is never cleared.
    let s = page({ signedIn: true });
    s.log.store.psycle_onboarded_v1 = '1';
    s.ctx.replayOnboarding();
    eq([s.ov().classList.contains('show'), s.log.frames.length], [false, 1], 'reopened from Settings it fades in (one frame later)');
    s.log.frames[0]();
    ok(s.ov().classList.contains('show'), '…and does');
    eq(s.log.store.psycle_onboarded_v1, '1', 'reopening clears nothing');
    s.key('ArrowRight'); s.key('ArrowRight'); s.key('ArrowRight');
    eq(s.labels(), ['Skip', 'Back', 'Done'], 'a signed-in member gets "Done" — never "Sign in with Psycle"');
    s.clock.now += 1000;
    s.tap('.onboard-next');
    eq(s.log.login, 0, '…and Done opens no sign-in page');
    // Reopened while the last one is still fading: the old timer must not take the new one.
    s.ctx.replayOnboarding();
    const fresh = s.ov();
    s.runTimers();
    ok(s.ov() === fresh, 'reopened during the fade: the stale clean-up timer leaves the new overlay alone');

    // iOS copy, and the holding cover.
    let n = page({ native: true });
    n.ctx.startOnboarding({ atLaunch: true, holding: true });
    eq([n.ov().classList.contains('is-holding'), n.ov().getAttribute('aria-hidden'), n.doc.keydown.length, n.doc.activeElement === n.doc.body],
      [true, 'true', 0, true], 'holding (iOS, before the storage restore): a cover — no keys, no focus, hidden from assistive tech');
    n.swipe(-200, 0, 300);
    eq(n.shown(), 0, '…and it cannot be swiped');
    n.ctx._onboardReveal();
    eq([n.ov().classList.contains('is-holding'), n.ov().getAttribute('aria-hidden'), n.doc.keydown.length, n.doc.activeElement === n.q('.onboard-shell')],
      [false, null, 1, true], 'revealed: the welcome proper');
    ok(/on iPhone/.test(n.ov().querySelectorAll('.onboard-body')[3].textContent), 'the iOS app mentions widgets and reminders "on iPhone"');
    ok(!/iPhone/.test(w.ctx._welcomePages(false)[3].body), '…the web build does not');
    // "swipe between days" only where there is something to swipe with.
    const findBody = (x) => x.ov().querySelectorAll('.onboard-body')[1].textContent;
    ok(/swipe between days/.test(findBody(n)), 'the iOS app is a touch screen: "swipe between days"');
    const mouse = page(); mouse.ctx.startOnboarding();
    const phone = page({ coarse: true }); phone.ctx.startOnboarding();
    eq([/swipe/i.test(findBody(mouse)), /step through the days/.test(findBody(mouse)), /swipe between days/.test(findBody(phone))], [false, true, true],
      'the web build asks (pointer: coarse): a mouse is told to step through the days, a phone to swipe');
    const noMq = page(); noMq.ctx.window.matchMedia = () => { throw new Error('no matchMedia'); }; noMq.ctx.startOnboarding();
    ok(/step through the days/.test(findBody(noMq)), 'matchMedia missing or throwing: the welcome still opens, with the wording that is true everywhere');
  }

  // ── Contracts other code leans on ──────────────────────────────────────
  t.section('Welcome: contracts with the rest of the app');
  const from = appSrc.indexOf('// Feature: First-run welcome');
  const to = appSrc.indexOf('// Feature: Timezone-aware travel notice');
  ok(from !== -1 && to > from, 'the welcome block found in js/app.js');
  const block = appSrc.slice(from, to);
  ok(/overlay\.id = 'onboardOverlay';/.test(block) && /overlay\.className = 'onboard-overlay';/.test(block),
    'the overlay keeps id onboardOverlay and class onboard-overlay (the sync prompt, the offline-queue ask, _ownKeysOverlayUp and the iOS bridge look for them)');
  eq((block.match(/role="dialog" aria-modal="true"/g) || []).length, 1, 'one modal dialog, named');
  ok(/role="dialog" aria-modal="true" aria-label="Welcome to Psync" tabindex="-1"/.test(block), '…with a label and a focusable panel');
  ok(/const ONBOARDING_KEY = 'psycle_onboarded_v1';/.test(block), 'the same completion flag as the old tour — nobody who finished that one sees this');
  const finish = grab(appSrc, 'function _onboardFinish(');
  ok(/localStorage\.setItem\(ONBOARDING_KEY, '1'\)/.test(finish), 'finishing writes the flag');
  ok(/act === 'signin'\) \{ if \(!justTurned\) _onboardFinish\(true\); \}/.test(block) && /act === 'done'\) \{ if \(!justTurned\) _onboardFinish\(\); \}/.test(block) &&
    /act === 'skip' \|\| act === 'look'\) _onboardFinish\(\)/.test(block),
    'Skip, "Look around first", Done and "Sign in with Psycle" all go through it');
  ok(/const justTurned = Date\.now\(\) - _onboardTurnedAt < 400;/.test(block) && /if \(moved\) _onboardTurnedAt = Date\.now\(\);/.test(block),
    '…but not as the second half of a double tap on "Next" (the label changes under the same fingertip)');
  ok(/if \(thenSignIn && typeof openLoginPopup === 'function'\) openLoginPopup\(\);/.test(finish), 'sign-in goes where the old tour\'s went (openLoginPopup)');
  ok(/if \(e\.key === 'Escape'\) \{ e\.preventDefault\(\); _onboardFinish\(\); \}/.test(block), 'Escape = Skip');
  const replay = grab(appSrc, 'function replayOnboarding(');
  ok(!/removeItem|clear\(/.test(replay) && /startOnboarding\(\)/.test(replay), '"Show the welcome again" reopens it and clears nothing');
  ok(/window\.replayOnboarding = replayOnboarding;/.test(block), '…and is reachable from Settings');
  ok(/onclick="if\(typeof replayOnboarding===\\'function\\'\)replayOnboarding\(\)">Show the welcome again<\/button>/.test(t.readSource('js/settings.js')),
    'Settings has the row');

  const swipe = grab(appSrc, 'function _onboardBindSwipe(');
  eq((swipe.match(/addEventListener\(/g) || []).length, (swipe.match(/\{ passive: true \}/g) || []).length, 'every touch listener is passive');
  ok(!/preventDefault/.test(swipe), '…and none of them can block a vertical scroll');
  ok(/prefers-reduced-motion: reduce/.test(swipe), 'reduced motion: the pages do not follow the finger');
  ok(/\['touchstart', 'touchmove', 'touchend', 'touchcancel'\]\.forEach\(type =>\s*overlay\.addEventListener\(type, e => e\.stopPropagation\(\), \{ passive: true \}\)\);/.test(block),
    'touches on the welcome never reach the page under it (pull-to-refresh, swipe-to-cancel, the day pager listen on document)');
  ok(/_maybeStartOnboarding\(true\);\n\(window\.securityReady \|\| Promise\.resolve\(\)\)\.then\(function \(\) \{\}, function \(\) \{\}\)\.then\(function \(\) \{ _maybeStartOnboarding\(\); \}\);/.test(block),
    'looked at while app.js loads, and again when security.js has settled — a rejected securityReady included');

  // ── CSS: tokens only, the right layer ──────────────────────────────────
  t.section('Welcome: CSS');
  const css = t.readSource('css/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  css.replace(/([^{}]+)\{([^{}]*)\}/g, (m, sel, body) => { if (/\.onboard-/.test(sel)) rules.push({ sel: sel.trim(), body }); return m; });
  ok(rules.length > 30, 'the welcome\'s rules found in css/styles.css (' + rules.length + ')');
  const literal = rules.filter((r) => /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(r.body)).map((r) => r.sel);
  eq(literal, [], 'no colour literal in any .onboard-* rule: every colour is a theme token, so every theme is covered');
  const fixed = rules.filter((r) => /font-size:\s*\d|border-radius:\s*\d|font-family:(?!\s*var\()/.test(r.body)).map((r) => r.sel);
  eq(fixed, [], 'type sizes, radii and faces come from the scales (Handheld zeroes radii; Terminal / Handheld swap the body face)');
  const overlayRule = rules.find((r) => r.sel === '.onboard-overlay') || { body: '' };
  const z = Number((/z-index:\s*(\d+)/.exec(overlayRule.body) || [])[1]);
  ok(z > 1100 && z < 9999, 'above every sheet and dialog (≤1100), under the flavour themes\' page texture (9999) — got ' + z);
  ok(/background:\s*var\(--bg\)/.test(overlayRule.body) && !/backdrop-filter/.test(overlayRule.body), 'opaque in the theme\'s own --bg: the app is not visible behind it');
  ok(/position:\s*absolute/.test((rules.find((r) => r.sel === '.onboard-skip') || { body: '' }).body), 'Skip stays position:absolute (its ::after tap area resolves against it)');
  ['.onboard-viewport', '.onboard-page'].forEach((sel) => {
    ok(/touch-action:\s*pan-y/.test((rules.find((r) => r.sel === sel) || { body: '' }).body), sel + ' is touch-action: pan-y — vertical scrolling stays the browser\'s');
  });
  ok(/min-height:\s*var\(--space-12\)/.test((rules.find((r) => r.sel === '.onboard-btn') || { body: '' }).body) &&
    /min-height:\s*var\(--tap-min\)/.test((rules.find((r) => r.sel === '.onboard-look') || { body: '' }).body), 'buttons are at least a fingertip tall');
  ok(/@media \(prefers-reduced-motion: reduce\) \{\s*\.onboard-overlay,\s*\.onboard-track,/.test(css), 'reduced motion: no fade, no slide');
  ok(/\.onboard-art \{[^}]*pointer-events:\s*none/.test(css), 'the miniatures cannot be pressed');
  ok(!/onboard-card|onboard-icon|onboard-cta|onboardStepIn/.test(css + appSrc), 'nothing of the old four-card modal is left behind');
};
