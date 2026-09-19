'use strict';
// Accessibility outside the Discover list: the toast / live-region helpers,
// what a picker seat tells a screen reader, and the ONE key handler + focus
// stack that look after the nine sheets and panels — run as the REAL code
// (sliced out of js/app.js) against a small fake DOM. Plus source contracts
// for the static attributes the handling depends on.
module.exports = async function (t) {
  const { ok, eq } = t;
  const appSrc = t.readSource('js/app.js');
  const between = (src, from, to) => {
    const a = src.indexOf(from);
    const b = a === -1 ? -1 : src.indexOf(to, a);
    return a !== -1 && b > a ? src.slice(a, b) : '';
  };

  // ── Pure helpers ─────────────────────────────────────────────────────────
  t.section('A11y: how long a toast stays up');
  const p = t.loadPure('js/app.js', 'a11y');
  eq(p._toastDuration('Booked'), 3500, 'a short toast keeps the old 3.5s');
  eq(p._toastDuration('x'.repeat(33)), 3500, '33 characters: still the floor');
  eq(p._toastDuration('x'.repeat(34)), 3540, '34 characters: reading time takes over');
  eq(p._toastDuration('x'.repeat(100)), 7500, 'a two-line error gets 7.5s');
  eq(p._toastDuration('x'.repeat(500)), 10000, 'capped at 10s');
  eq([p._toastDuration(undefined), p._toastDuration(null), p._toastDuration('')], [3500, 3500, 3500],
    'toast(e.message) with no message: the floor, never NaN (a NaN delay hides the toast at once)');
  eq(p._toastDuration(12345), 3500, 'a number is measured as its text');

  t.section('A11y: announcements that arrive together');
  eq(p._joinAnnouncements([]), '', 'nothing queued → nothing said');
  eq(p._joinAnnouncements(undefined), '', 'no queue at all');
  eq(p._joinAnnouncements(["Spot claimed — you're booked in!", 'Booked!. Ride']), "Spot claimed — you're booked in! Booked!. Ride",
    'the toast and the sheet that follows it are both said, in order');
  eq(p._joinAnnouncements(['Booking cancelled', 'Booking cancelled']), 'Booking cancelled', 'an exact repeat in one tick is said once');
  eq(p._joinAnnouncements(['a', 'b', 'a']), 'a b a', 'only consecutive repeats collapse');
  eq(p._joinAnnouncements([' a ', null, '', undefined, 'b']), 'a b', 'blanks and non-strings are dropped, text is trimmed');

  t.section('A11y: what a picker seat tells a screen reader');
  eq(p._bikeSlotA11y(['bike-slot', 'available'], 'Bike', '12'),
    { label: 'Bike 12, available', pressed: false, disabled: false, tabindex: 0 }, 'a free seat: a toggle, off, in the tab order');
  eq(p._bikeSlotA11y(['bike-slot', 'selected'], 'Bike', '12'),
    { label: 'Bike 12, selected', pressed: true, disabled: false, tabindex: 0 }, 'picked: pressed');
  eq(p._bikeSlotA11y(['bike-slot', 'selected', 'usual'], 'Bed', '3'),
    { label: 'Bed 3, selected, your usual', pressed: true, disabled: false, tabindex: 0 }, 'the pre-selected usual spot says so, in the class\'s own word');
  eq(p._bikeSlotA11y(['bike-slot', 'available', 'usual'], 'Bike', '3').label, 'Bike 3, available, your usual',
    'the gold ring stays on an evicted usual bike — so does the word');
  eq(p._bikeSlotA11y(['bike-slot', 'taken'], 'Bike', '7'),
    { label: 'Bike 7, taken', pressed: null, disabled: true, tabindex: -1 }, 'taken: disabled, out of the tab order, no pressed state');
  eq(p._bikeSlotA11y(['bike-slot', 'mine'], 'Bike', '5'),
    { label: 'Bike 5, your booking', pressed: null, disabled: false, tabindex: 0 }, 'a seat you hold is an action (cancel / swap target), not a toggle');
  eq(p._bikeSlotA11y(['bike-slot', 'available', 'pref-prefer'], 'Bike', '9').label, 'Bike 9, available, one you prefer', 'settings.js\'s green dot is spoken');
  eq(p._bikeSlotA11y(['bike-slot', 'taken', 'pref-avoid'], 'Bike', '9').label, 'Bike 9, taken, one you avoid', '…and the red one');
  eq(p._bikeSlotA11y(undefined, 'Spot', '1').label, 'Spot 1, available', 'no class list does not throw');

  // ── toast() + announce(), the real ones ──────────────────────────────────
  t.section('A11y: toast() and announce() (sliced from js/app.js)');
  const speakSrc = between(appSrc, '// Say something to screen-reader users.', '// ── Discover empty state');
  ok(!!speakSrc && /function announce\(/.test(speakSrc) && /function toast\(/.test(speakSrc), 'announce + toast found between their anchors');
  function speakWorld(withRegions) {
    const timers = [];
    const mk = (id) => ({ id, textContent: '', className: '', attrs: {}, classList: { remove(c) { this.removed = c; } }, setAttribute(k, v) { this.attrs[k] = v; } });
    const els = { toast: mk('toast') };
    if (withRegions) { els.srStatus = mk('srStatus'); els.srAlert = mk('srAlert'); }
    const appended = [];
    const ctx = t.loadPure('js/app.js', 'a11y', {
      toastTimer: undefined,
      setTimeout: (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length; },
      clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].live = false; },
      document: {
        getElementById: (id) => els[id] || null,
        createElement: () => mk(''),
        body: { appendChild: (el) => { appended.push(el); els[el.id] = el; } },
      },
    });
    t.vm.runInContext(speakSrc, ctx, { filename: 'js/app.js[toast+announce]' });
    // Fire the live timers of one delay, oldest first.
    const run = (ms) => timers.filter(x => x.live && x.ms === ms).forEach(x => { x.live = false; x.fn(); });
    return { ctx, els, timers, appended, run };
  }

  let w = speakWorld(true);
  w.ctx.toast('Booking cancelled');
  eq([w.els.toast.textContent, w.els.toast.className], ['Booking cancelled', 'toast show info'],
    'the visible toast is written synchronously (callers and the verify recipe read #toast straight after)');
  eq(w.els.srStatus.textContent, '', 'the live region is cleared first…');
  w.run(50);
  eq([w.els.srStatus.textContent, w.els.srAlert.textContent], ['Booking cancelled', ''], '…and written a beat later, politely');
  ok(w.timers.some(x => x.live && x.ms === 3500), 'a short toast hides after 3.5s');

  w.ctx.toast('Booking cancelled');
  eq(w.els.srStatus.textContent, '', 'the same text again: cleared…');
  w.run(50);
  eq(w.els.srStatus.textContent, 'Booking cancelled', '…then set, so a repeat is announced again');

  w = speakWorld(true);
  const longErr = "Couldn't match Bike 12 to a booking — nothing was cancelled. Pull to refresh and try again.";
  w.ctx.toast(longErr, 'error');
  w.run(50);
  eq([w.els.srAlert.textContent, w.els.srStatus.textContent], [longErr, ''], 'an error goes to the assertive region — no role is swapped at runtime');
  ok(w.timers.some(x => x.live && x.ms === p._toastDuration(longErr)) && p._toastDuration(longErr) > 3500, 'a long error stays up longer than 3.5s');

  w = speakWorld(true);
  w.ctx.toast(undefined, 'error');
  eq(w.els.toast.textContent, '', 'toast(undefined) shows nothing rather than "undefined"');
  ok(w.timers.every(x => Number.isFinite(x.ms)), '…and every delay is a finite number');

  w = speakWorld(true);
  w.ctx.toast("Spot claimed — you're booked in!", 'success');
  w.ctx.announce('Booked!. Ride · Ada. Mon 3 Feb, 7:00am');
  w.run(50);
  eq(w.els.srStatus.textContent, "Spot claimed — you're booked in! Booked!. Ride · Ada. Mon 3 Feb, 7:00am",
    'a toast and the Booked! line in the same tick: neither is lost');
  eq(w.timers.filter(x => x.ms === 50 && x.fn).length, 2, 'one write timer per call…');
  w.run(p._toastDuration(w.els.srStatus.textContent));
  eq(w.els.srStatus.textContent, '', 'the region is emptied afterwards (nothing stale to swipe onto later)');

  w = speakWorld(false);
  w.ctx.announce('Hello', true);
  eq(w.appended.length, 1, 'a page shell without the regions: one is made rather than throwing');
  eq([w.appended[0].id, w.appended[0].className, w.appended[0].attrs.role, w.appended[0].attrs['aria-live']], ['srAlert', 'sr-only', 'alert', 'assertive'],
    'the fallback region is the assertive one, hidden the same way');
  w.ctx.announce('Again', true);
  eq(w.appended.length, 1, 'and it is reused');

  // ── showSessionExpired: spoken once per appearance ───────────────────────
  t.section('A11y: the session-expired banner is announced once');
  const expiredSrc = between(appSrc, 'function showSessionExpired()', '// Token from login is now received');
  ok(!!expiredSrc, 'showSessionExpired found between its anchors');
  {
    const said = [];
    const els = { sessionBanner: { style: { display: 'none' } }, authPill: { innerHTML: '' }, settingsGear: { hidden: false } };
    const ctx = t.vm.createContext({
      currentUser: { id: 7 }, _activeSubscription: {}, _authUnverified: false, _lastWaitlistEntries: null,
      _myBookings: { 1: {} }, _bookingsLoadState: 'loaded',
      window: { _secureTokenStore: { clear() {} } },
      document: { getElementById: (id) => els[id] || null },
      updateDiscoverEmptyState() {}, renderMyBookings() {}, _emitAuthChanged() {},
      announce: (text, assertive) => said.push([text, assertive]),
    });
    t.vm.runInContext(expiredSrc, ctx, { filename: 'js/app.js[showSessionExpired]' });
    ctx.showSessionExpired();
    eq([said.length, said[0] && said[0][1], els.sessionBanner.style.display], [1, true, 'flex'], 'the banner appears: said once, assertively');
    ctx.showSessionExpired();
    ctx.showSessionExpired();
    eq(said.length, 1, 'every other 401 still in flight lands here too — not said again while the banner is up');
    els.sessionBanner.style.display = 'none'; // dismissed (×) or signed back in
    ctx.showSessionExpired();
    eq(said.length, 2, 'a later expiry is a new appearance');
  }

  // ── confirmModal: a held Enter never confirms ────────────────────────────
  // Enter on a held seat (or any role=button) opens a late-cancel / claim
  // confirm whose danger button takes the focus 50ms later; the key, still
  // down, auto-repeats. The delegated handler further down returns early while
  // a confirm is up, so THIS guard is the only thing between a held key and a
  // charged cancel — the real confirmModal, over a fake dialog.
  t.section('A11y: confirmModal ignores an auto-repeated Enter (sliced from js/app.js)');
  {
    const cmSrc = between(appSrc, 'function confirmModal(opts) {', 'window.confirmModal = confirmModal;');
    ok(!!cmSrc, 'confirmModal found between its anchors');
    const settle = () => new Promise((r) => setImmediate(r));
    const confirmWorld = () => {
      const cw = { timers: [], keydown: [], active: null, state: 'pending' };
      const button = (name) => ({ name, tagName: 'BUTTON', onclick: null, focus() { cw.active = this; } });
      const cancel = button('cancel'), danger = button('danger');
      const overlay = {
        classList: { add() {}, remove() {} },
        contains: (n) => n === cancel || n === danger,
        querySelector: (sel) => {
          if (sel === '.confirm-btn-cancel') return cancel;
          if (sel === '.confirm-btn-primary, .confirm-btn-danger') return danger;
          throw new Error('fake DOM: unexpected selector ' + sel);
        },
        querySelectorAll: () => [cancel, danger],
        remove() {},
      };
      cw.opener = { name: 'held-seat', focus() { cw.active = this; } };
      cw.active = cw.opener;
      cw.danger = danger;
      const ctx = t.vm.createContext({
        console, escapeHTML: (x) => String(x), requestAnimationFrame: () => 0,
        setTimeout: (fn, ms) => { cw.timers.push({ fn, ms }); return cw.timers.length; },
        document: {
          get activeElement() { return cw.active; },
          getElementById: () => null, createElement: () => overlay, body: { appendChild() {} },
          addEventListener: (type, fn) => { if (type === 'keydown') cw.keydown.push(fn); },
          removeEventListener: (type, fn) => { cw.keydown = cw.keydown.filter((f) => f !== fn); },
        },
      });
      t.vm.runInContext(cmSrc, ctx, { filename: 'js/app.js[confirmModal]' });
      ctx.confirmModal({ title: 'Cancel this seat?', warn: 'Inside 12 hours: the credit is not returned.', confirmText: 'Cancel seat', danger: true })
        .then((v) => { cw.state = v; });
      cw.key = (k, o) => {
        const e = Object.assign({ key: k, repeat: false, shiftKey: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }, o);
        cw.keydown.slice().forEach((fn) => fn(e));
        return e;
      };
      return cw;
    };

    let cw = confirmWorld();
    eq([cw.keydown.length, cw.timers.filter((x) => x.ms === 50).length], [1, 1], 'the dialog listens for keys and arms its 50ms focus');
    cw.timers.filter((x) => x.ms === 50).forEach((x) => x.fn());
    ok(cw.active === cw.danger, 'focus lands on the danger button — where a key still held from the opener now points');
    let e = cw.key('Enter', { repeat: true });
    await settle();
    eq([cw.state, cw.keydown.length, e.defaultPrevented], ['pending', 1, true],
      'an auto-repeated Enter confirms NOTHING: the promise is still pending, the dialog still listening — and the button\'s own click is stopped too');
    cw.key('Enter', { repeat: true });
    cw.key('Enter', { repeat: true });
    await settle();
    eq(cw.state, 'pending', '…however long the key is held');
    e = cw.key('Enter');
    await settle();
    eq([cw.state, cw.keydown.length, e.defaultPrevented, cw.active === cw.opener], [true, 0, true, true], 'a fresh press confirms, the listener goes, and focus returns to what opened the dialog');

    // …or to its visible stand-in: "Add spot" lives in a More menu that closed when the dialog took focus.
    cw = confirmWorld();
    const moreBtn = { name: 'more', offsetParent: {}, focus() { cw.active = this; } };
    cw.opener.closest = (sel) => (sel === '.mb-more-menu' ? { offsetParent: null, parentElement: { querySelector: (q) => (q === '.mb-more-btn' ? moreBtn : null) } } : null);
    cw.opener.focus = () => {}; // display: none — ignored
    cw.key('Escape');
    await settle();
    ok(cw.state === false && cw.active === moreBtn, 'opened from a More menu that has closed meanwhile: focus goes to its More button, not nowhere');

    cw = confirmWorld();
    cw.key('Enter'); // focus has not moved into the dialog yet (the first 50ms)
    await settle();
    eq(cw.state, 'pending', 'Enter while focus is still outside the dialog is not a confirmation either');
    cw.key('Escape');
    await settle();
    eq([cw.state, cw.keydown.length], [false, 0], 'Escape cancels');
  }

  // ── The one key handler + the overlay focus stack ────────────────────────
  t.section('A11y: overlays — Escape, Tab, focus in and back (sliced from js/app.js)');
  const ovFrom = appSrc.indexOf('// ── Sheets and panels: one focus stack');
  const ovTo = appSrc.indexOf('function describeCancelError(');
  ok(ovFrom !== -1 && ovTo > ovFrom, 'overlay block found between its anchors');
  if (ovFrom === -1 || ovTo <= ovFrom) return;
  let ovSrc = appSrc.slice(ovFrom, ovTo);
  ovSrc = ovSrc.slice(0, ovSrc.lastIndexOf('});') + 3); // up to the end of the keydown listener

  function world() {
    const log = { closers: [], clicks: [], dispatched: [] };
    const doc = { activeElement: null, confirmUp: false, tourUp: false, keydown: null, keyup: null, listeners: [], observed: [] };
    const els = {};
    const body = { id: 'body', isConnected: true, contains: () => true };
    doc.activeElement = body;
    // kind: 'panel' ([role=dialog]) | 'ctl' (a focusable control) | 'seat'
    function node(o) {
      const n = Object.assign({
        isConnected: true, disabled: false, offsetParent: {}, style: { display: '' }, kids: [], classes: [], attrs: {},
        contains(x) { return x === n || n.kids.some(k => k.contains(x)); },
        focus() { if (n.isConnected && !n.disabled) doc.activeElement = n; },
        getAttribute(k) { return k in n.attrs ? n.attrs[k] : null; },
        querySelector(sel) {
          if (sel === '[role="dialog"]') return n.kids.find(k => k.kind === 'panel') || null;
          const m = /^\.bike-slot\.(\w+)$/.exec(sel);
          if (m) return n.kids.find(k => k.kind === 'seat' && k.classes.indexOf(m[1]) !== -1) || null;
          throw new Error('fake DOM: unexpected selector ' + sel);
        },
        querySelectorAll() { return n.kids.filter(k => k.kind === 'ctl' || (k.kind === 'seat' && k.classes.indexOf('taken') === -1)); },
        remove() { n.isConnected = false; n.kids.forEach(k => { k.isConnected = false; }); if (n.contains(doc.activeElement)) doc.activeElement = body; },
      }, o);
      return n;
    }
    // An overlay with a panel and some controls; `mount` puts it in the page.
    function overlay(id, ctlNames, extraKids) {
      const o = node({ id });
      o.panel = node({ kind: 'panel' });
      o.ctl = {};
      (ctlNames || []).forEach(name => { o.ctl[name] = node({ kind: 'ctl', name }); });
      o.kids = [o.panel].concat(Object.keys(o.ctl).map(k => o.ctl[k]), extraKids || []);
      return o;
    }
    const mount = (o) => { els[o.id] = o; o.isConnected = true; o.kids.forEach(k => { k.isConnected = true; }); return o; };
    let observerCb = null;
    const ctx = t.vm.createContext({
      console,
      _bookingContext: null,
      // The REAL helper: it sits beside confirmModal (pure:sheets), outside this slice.
      _visibleOpener: t.loadPure('js/app.js', 'sheets')._visibleOpener,
      MutationObserver: function (cb) { observerCb = cb; this.observe = (target, opts) => doc.observed.push([target && target.id, opts]); },
      MouseEvent: function (type, init) { this.type = type; this.bubbles = !!(init && init.bubbles); },
      document: {
        body,
        get activeElement() { return doc.activeElement; },
        getElementById: (id) => {
          if (id === 'psycleConfirmOverlay') return doc.confirmUp ? {} : null;
          return els[id] && els[id].isConnected ? els[id] : null;
        },
        querySelector: (sel) => { if (sel !== '.onboard-overlay') throw new Error('fake DOM: ' + sel); return doc.tourUp ? {} : null; },
        addEventListener: (type, fn) => { doc.listeners.push(type); if (type === 'keydown') doc.keydown = fn; if (type === 'keyup') doc.keyup = fn; },
      },
      closeTokenDialog: () => { log.closers.push('token'); els.tokenDialog.style.display = 'none'; },
      closeBikePicker: () => { log.closers.push('bike'); els.bikeModal.style.display = 'none'; },
      _dismissSyncPrompt: () => { log.closers.push('sync'); els.syncPromptOverlay.remove(); },
    });
    ctx.window = ctx;
    ctx.closeSettings = () => { log.closers.push('settings'); els.settingsOverlay.remove(); };
    ctx.closeDiagnostics = () => { log.closers.push('diag'); els.diagOverlay.remove(); };
    // The two static dialogs exist (hidden) before the block runs, as in the page.
    const seat = (cls) => node({ kind: 'seat', classes: ['bike-slot', cls] });
    mount(overlay('tokenDialog', ['close', 'input', 'connect'])).style.display = 'none';
    mount(overlay('bikeModal', ['close', 'cancel', 'confirm'])).style.display = 'none';
    t.vm.runInContext(ovSrc, ctx, { filename: 'js/app.js[overlays]' });
    const key = (k, o) => {
      const e = Object.assign({ key: k, shiftKey: false, repeat: false, defaultPrevented: false, target: doc.activeElement,
        preventDefault() { this.defaultPrevented = true; } }, o);
      doc.keydown(e);
      observerCb(); // whatever the key closed is a DOM change: the observer's microtask follows
      return e;
    };
    const keyUp = (k, o) => {
      const e = Object.assign({ key: k, defaultPrevented: false, target: doc.activeElement, preventDefault() { this.defaultPrevented = true; } }, o);
      doc.keyup(e);
      return e;
    };
    // A clickable non-button, as the delegated Enter / Space sees it.
    const roleButton = (o) => Object.assign(node({ kind: 'ctl' }), {
      matches: (sel) => { log.selector = sel; return true; },
      click() { log.clicks.push(this.name || 'el'); },
    }, o);
    return { ctx, doc, els, log, body, node, overlay, mount, seat, key, keyUp, roleButton, tick: () => observerCb() };
  }

  // Wiring
  {
    const w = world();
    eq(w.doc.listeners, ['keydown', 'keyup'], 'ONE keydown listener on document (plus the keyup half of Space) — not one per dialog');
    eq(w.doc.observed, [['body', { childList: true }], ['tokenDialog', { attributes: true, attributeFilter: ['style'] }], ['bikeModal', { attributes: true, attributeFilter: ['style'] }]],
      'the observer watches <body> children plus the style of the two static dialogs — nothing deeper');
  }

  // Escape closes only the top-most overlay, through its own closer.
  {
    const w = world();
    const row = w.roleButton({ name: 'membership-row' });
    w.doc.activeElement = row;
    const settings = w.mount(w.overlay('settingsOverlay', ['close', 'openDiag']));
    w.tick();
    ok(w.doc.activeElement === settings.panel, 'Settings opens: focus moves onto its panel (so the dialog\'s name is read)');
    settings.ctl.openDiag.focus();
    const diag = w.mount(w.overlay('diagOverlay', ['close', 'copy']));
    w.tick();
    ok(w.doc.activeElement === diag.panel, 'Diagnostics opens over it: focus moves up');
    const e = w.key('Escape');
    eq([w.log.closers, e.defaultPrevented], [['diag'], true], 'one Escape closes Diagnostics ONLY — via closeDiagnostics — and leaves Settings up');
    ok(w.doc.activeElement === settings.ctl.openDiag, 'focus goes back to the button that opened it, inside Settings');
    w.key('Escape');
    eq(w.log.closers, ['diag', 'settings'], 'a second Escape closes Settings via closeSettings');
    ok(w.doc.activeElement === row, 'and focus returns to the row behind it');
    const idle = w.key('Escape');
    eq([w.log.closers.length, idle.defaultPrevented], [2, false], 'nothing open: Escape is left alone');
  }

  // confirmModal and the tour handle their own keys.
  {
    const w = world();
    w.mount(w.overlay('historyModalOverlay', ['close']));
    w.tick();
    w.doc.confirmUp = true;
    const e = w.key('Escape');
    ok(w.els.historyModalOverlay.isConnected && !e.defaultPrevented, 'a confirm dialog is up: Escape is its business, the sheet under it stays');
    w.doc.confirmUp = false; w.doc.tourUp = true;
    w.key('Escape');
    ok(w.els.historyModalOverlay.isConnected, 'same while the first-run tour is up');
    w.doc.tourUp = false;
    w.key('Escape');
    ok(!w.els.historyModalOverlay.isConnected, 'otherwise an overlay without a closer is removed — what its own × does');
  }

  // So does the usual-week sheet (js/tabs.js): own id, own Escape / Tab handler,
  // z-index above every .modal-overlay. Unknown here, this handler's Escape
  // closed whatever had mounted UNDER it and — by preventDefault — kept the key
  // from the sheet's own handler; and focus was moved into the hidden overlay.
  {
    const w = world();
    const opener = w.roleButton({ name: 'week-template-book' });
    w.doc.activeElement = opener;
    w.els.usualWeekSheet = { id: 'usualWeekSheet', isConnected: true };
    const under = w.mount(w.overlay('classDetailOverlay', ['close']));
    w.tick();
    ok(w.doc.activeElement === opener, 'the usual-week sheet is up: an overlay that mounts under it does not pull focus out of the sheet');
    const esc = w.key('Escape');
    ok(under.isConnected && !esc.defaultPrevented, '…and Escape is the sheet\'s business (not prevented, so its own handler still sees the key)');
    ok(!w.key('Tab').defaultPrevented, '…as is Tab');
    w.els.usualWeekSheet.isConnected = false;
    w.key('Escape');
    ok(!under.isConnected, 'once the sheet has closed the keys are this handler\'s again');
  }

  // …and _dialogOpen() — what every BACKGROUND dialog asks before it opens
  // ("Spot opened", the waitlist "You're in", the offline-booking ask, the sync
  // prompt, a quiet Discover re-render): a usual-week run re-reads /bookings
  // after every seat, and each of those was a chance to open over the run.
  {
    const dialogSrc = between(appSrc, 'function _dialogOpen() {', '\nlet _allocAnnounceTimer');
    ok(!!dialogSrc, '_dialogOpen found between its anchors');
    const dialogOpen = (up) => {
      const ctx = t.vm.createContext({ document: { getElementById: (id) => (id in up ? up[id] : null) } });
      t.vm.runInContext(dialogSrc, ctx, { filename: 'js/app.js[_dialogOpen]' });
      return ctx._dialogOpen();
    };
    eq([dialogOpen({}), dialogOpen({ bikeModal: { style: { display: 'none' } } })], [false, false], 'nothing up (the bike picker sits hidden in the page) → no dialog');
    eq([dialogOpen({ psycleConfirmOverlay: {} }), dialogOpen({ bikeModal: { style: { display: 'flex' } } })], [true, true], 'a confirm dialog or the bike picker → a dialog, as before');
    eq(dialogOpen({ usualWeekSheet: {} }), true, 'the usual-week sheet alone counts too: background dialogs wait for it to close');
    ok(/_dialogOpen === 'function' && _dialogOpen\(\)/.test(t.readSource('js/reliability.js')) && /window\._dialogOpen\(\)/.test(t.readSource('js/features.js')),
      'the offline-booking ask (reliability.js) and "Spot opened" (features.js) both go through it');
  }

  // The sync prompt keeps its "not mid-sync" rule.
  {
    const w = world();
    const sync = w.mount(w.overlay('syncPromptOverlay', ['close', 'skip']));
    w.els.syncPromptBtn = w.node({ id: 'syncPromptBtn', disabled: true });
    w.tick();
    w.key('Escape');
    ok(sync.isConnected && w.log.closers.length === 0, 'mid-sync: Escape does not throw the progress away (same rule as its backdrop)');
    w.els.syncPromptBtn.disabled = false;
    w.key('Escape');
    eq(w.log.closers, ['sync'], 'idle: Escape dismisses it through _dismissSyncPrompt');
  }

  // The bike picker: focus lands on a seat; Escape uses closeBikePicker; focus returns to Book.
  {
    const w = world();
    const book = w.node({ kind: 'ctl', name: 'book' });
    w.ctx._bookingContext = { eventId: 1, btn: book }; // Book was disabled while loading, so focus had already dropped to <body>
    const bike = w.els.bikeModal;
    const taken = w.seat('taken'), free = w.seat('available'), mine = w.seat('mine'), picked = w.seat('selected');
    bike.kids = bike.kids.concat([taken, free, mine, picked]);
    bike.style.display = 'flex';
    w.tick();
    ok(w.doc.activeElement === picked, 'opens ON the pre-selected seat (before a held one, before the first free one)');
    w.key('Escape');
    eq([w.log.closers, bike.style.display], [['bike'], 'none'], 'Escape goes through closeBikePicker (which also drops a swap context)');
    ok(w.doc.activeElement === book, 'focus returns to the Book button the picker was opened from');

    picked.classes = ['bike-slot', 'available'];
    w.doc.activeElement = w.body;
    bike.style.display = 'flex';
    w.tick();
    ok(w.doc.activeElement === mine, 'no selection: a seat already held comes first');
    w.key('Escape');
    mine.classes = ['bike-slot', 'available'];
    bike.style.display = 'flex';
    w.tick();
    ok(w.doc.activeElement === free, 'else the first free seat — never a taken one');
  }

  // My Bookings on a phone: More → "Add spot" → the picker. By the time it closes,
  // the menu holding "Add spot" has closed too (display: none): focus() on the
  // opener is a no-op there, and focus used to be left on <body>.
  {
    const w = world();
    const more = w.node({ kind: 'ctl', name: 'more' });
    const wrap = { querySelector: (sel) => (sel === '.mb-more-btn' ? more : null) };
    const menu = { offsetParent: null, parentElement: wrap }; // closed by the time the picker goes
    const addSpot = w.node({ kind: 'ctl', name: 'add-spot', closest: (sel) => (sel === '.mb-more-menu' ? menu : null) });
    addSpot.focus = () => {}; // inside display:none — the browser ignores it
    w.ctx._bookingContext = { eventId: 1, btn: addSpot };
    const bike = w.els.bikeModal;
    bike.kids = bike.kids.concat([w.seat('available')]);
    bike.style.display = 'flex';
    w.tick();
    w.key('Escape');
    ok(w.doc.activeElement === more, 'the opener sits in a More menu that has closed: focus goes to that menu\'s More button — not to <body>');
    menu.offsetParent = {}; // desktop: the same buttons are laid out inline
    addSpot.focus = function () { w.doc.activeElement = addSpot; };
    w.doc.activeElement = w.body;
    bike.style.display = 'flex';
    w.tick();
    w.key('Escape');
    ok(w.doc.activeElement === addSpot, '…and where the menu is on screen, to "Add spot" itself, as before');
  }

  // "Remove the class sheet, open the instructor's profile" in one tick.
  {
    const w = world();
    const card = w.roleButton({ name: 'card-title' });
    w.doc.activeElement = card;
    const sheet = w.mount(w.overlay('classDetailOverlay', ['close', 'book', 'viewInstr']));
    w.tick();
    sheet.ctl.viewInstr.focus();
    sheet.remove();
    const modal = w.mount(w.overlay('instructorModalOverlay', ['close', 'schedule']));
    w.tick();
    ok(w.doc.activeElement === modal.panel, 'focus goes INTO the new overlay — not back to the card behind it');
    w.key('Escape');
    ok(!modal.isConnected && w.doc.activeElement === card, 'closing that one returns to the card the first sheet was opened from');
  }

  // Restore only when focus fell.
  {
    const w = world();
    const opener = w.node({ kind: 'ctl', name: 'opener' });
    const elsewhere = w.node({ kind: 'ctl', name: 'elsewhere' });
    w.doc.activeElement = opener;
    const yr = w.mount(w.overlay('yearReviewOverlay', ['close', 'share']));
    w.tick();
    yr.remove();
    elsewhere.focus(); // whatever closed it put focus somewhere on purpose
    w.tick();
    ok(w.doc.activeElement === elsewhere, 'a closer that moved focus itself is not overridden');

    w.doc.activeElement = opener;
    const again = w.mount(w.overlay('yearReviewOverlay', ['close', 'share']));
    w.tick();
    opener.isConnected = false; // the list re-rendered under the sheet
    again.remove();
    w.tick();
    ok(w.doc.activeElement === w.body, 'an opener that no longer exists is not focused (nothing to restore to)');
  }

  // Tab stays inside the top overlay.
  {
    const w = world();
    const tok = w.els.tokenDialog;
    tok.style.display = 'flex';
    w.tick();
    ok(w.doc.activeElement === tok.panel, 'the token dialog opens on its panel, not its input (no iOS keyboard pops)');
    let e = w.key('Tab', { shiftKey: true });
    ok(e.defaultPrevented && w.doc.activeElement === tok.ctl.connect, 'Shift+Tab from the panel wraps to the last control instead of walking out backwards');
    e = w.key('Tab');
    ok(e.defaultPrevented && w.doc.activeElement === tok.ctl.close, 'Tab from the last control wraps to the first');
    e = w.key('Tab', { shiftKey: true });
    ok(e.defaultPrevented && w.doc.activeElement === tok.ctl.connect, 'Shift+Tab from the first wraps to the last');
    tok.ctl.input.focus();
    e = w.key('Tab');
    ok(!e.defaultPrevented && w.doc.activeElement === tok.ctl.input, 'in the middle the browser\'s own Tab order is left alone');
    w.doc.activeElement = w.body;
    e = w.key('Tab');
    ok(e.defaultPrevented && w.doc.activeElement === tok.ctl.close, 'focus that got outside is pulled back in');
    w.key('Escape');
    eq(w.log.closers, ['token'], 'Escape closes it via closeTokenDialog');
    e = w.key('Tab');
    ok(!e.defaultPrevented, 'no overlay: Tab is untouched');
  }

  // The history-sync prompt arrives on a timer, not from a tap: it must never
  // mount UNDER a panel (they sit above .modal-overlay). The stack takes the
  // last overlay to open for the top one — focus went into a prompt nobody
  // could see, and the Escape meant for the panel dismissed the offer for good.
  t.section('A11y: the history-sync prompt waits for every other overlay');
  {
    const promptSrc = between(appSrc, 'function showHistorySyncPrompt() {', 'async function startSyncFromPrompt() {');
    const registry = between(appSrc, 'const _OVERLAYS = [', 'const _overlayStack = [];') + between(appSrc, 'function _overlayIsOpen(el) {', '// confirmModal and the tour keep their own focus');
    ok(!!promptSrc && /const _OVERLAYS = \[/.test(registry) && /function _overlayIsOpen\(/.test(registry), 'showHistorySyncPrompt and the overlay registry found between their anchors');
    const promptWorld = (open, o) => {
      const pw = { appended: [], timers: [], els: {} };
      Object.keys(open || {}).forEach((id) => { pw.els[id] = { id, isConnected: true, style: { display: open[id] } }; });
      const ctx = t.loadPure('js/app.js', 'session', {
        localStorage: { getItem: (k) => (k === 'psycle_onboarded_v1' && !(o && o.noWelcomeFlag) ? '1' : null) },
        getBearerToken: () => 'tok', currentUser: { first_name: 'Ada' }, escapeHTML: (x) => String(x),
        _dialogOpen: () => false,
        setTimeout: (fn, ms) => { pw.timers.push([fn, ms]); return pw.timers.length; }, clearTimeout: () => {},
        document: {
          getElementById: (id) => pw.els[id] || null,
          createElement: () => ({ style: {} }),
          body: { appendChild: (el) => { pw.appended.push(el.id); pw.els[el.id] = Object.assign(el, { isConnected: true }); } },
        },
      });
      t.vm.runInContext("var HISTORY_PROMPT_DISMISSED_KEY = 'psycle_history_prompt_dismissed', ONBOARDING_KEY = 'psycle_onboarded_v1', _syncPromptTimer = null, _syncPromptDefers = 0;\n" +
        registry + '\n' + promptSrc, ctx, { filename: 'js/app.js[showHistorySyncPrompt]' });
      pw.ctx = ctx;
      return pw;
    };
    ['settingsOverlay', 'diagOverlay', 'instructorModalOverlay', 'historyModalOverlay', 'yearReviewOverlay'].forEach((id) => {
      const pw = promptWorld({ [id]: '' });
      pw.ctx.showHistorySyncPrompt();
      eq([pw.appended, pw.timers.length, pw.timers[0] && pw.timers[0][1]], [[], 1, 3000], '#' + id + ' is open: nothing is mounted under it — it comes back in 3s');
    });
    let pw = promptWorld({ tokenDialog: 'flex', bikeModal: 'none' });
    pw.ctx.showHistorySyncPrompt();
    eq(pw.appended, [], 'the token dialog (static markup, shown by display) counts as open too');
    pw = promptWorld({ tokenDialog: 'none', bikeModal: 'none' });
    pw.ctx.showHistorySyncPrompt();
    eq([pw.appended, pw.timers.length], [['syncPromptOverlay'], 0], 'the two static dialogs sitting hidden in the page hold nothing up: the prompt mounts');
    pw.ctx.showHistorySyncPrompt();
    eq(pw.appended.length, 1, '…once (the prompt itself is in the registry, and is never its own reason to wait)');
    // The panel closes, the deferred call runs: now it shows.
    pw = promptWorld({ settingsOverlay: '' });
    pw.ctx.showHistorySyncPrompt();
    pw.els.settingsOverlay.isConnected = false;
    pw.timers[0][0]();
    eq(pw.appended, ['syncPromptOverlay'], 'Settings closed: the re-armed call mounts it');
    // The first-run welcome: judged by its overlay, never by a missing completion
    // flag. A launch on a #bookings link skips the welcome and leaves the flag
    // unset — the newcomer who then signed in polled "busy" 40 times and was
    // never offered the sync in that page session.
    pw = promptWorld({}, { noWelcomeFlag: true });
    pw.ctx.showHistorySyncPrompt();
    eq([pw.appended, pw.timers.length], [['syncPromptOverlay'], 0], 'no completion flag, no welcome on screen, signed in: the prompt opens');
    pw = promptWorld({ onboardOverlay: '' }, { noWelcomeFlag: true });
    pw.ctx.showHistorySyncPrompt();
    eq([pw.appended, pw.timers.length, pw.timers[0] && pw.timers[0][1]], [[], 1, 3000], 'the welcome IS up (or its iOS holding cover): it waits, and comes back in 3s');
    delete pw.els.onboardOverlay;
    pw.timers[0][0]();
    eq(pw.appended, ['syncPromptOverlay'], '…and mounts once the welcome has gone');
    ok(!/ONBOARDING_KEY|psycle_onboarded_v1/.test(promptSrc.replace(/\/\/[^\n]*/g, '')), 'the completion flag is not read here at all');
  }

  // Enter / Space on clickable non-buttons.
  t.section('A11y: Enter / Space on role="button" elements (sliced from js/app.js)');
  {
    const w = world();
    const name = w.roleButton({ name: 'instructor-link' });
    let e = w.key('Enter', { target: name });
    eq([w.log.clicks, e.defaultPrevented, w.log.selector], [['instructor-link'], true, '[role="button"]:not(button)'],
      'Enter on a role=button span clicks it — real <button>s are excluded by the selector');
    e = w.key(' ', { target: name });
    eq([w.log.clicks.length, e.defaultPrevented], [1, true], 'Space: the press only stops the page scrolling…');
    w.keyUp(' ', { target: name });
    eq(w.log.clicks.length, 2, '…the RELEASE clicks, as on a real button');
    w.keyUp(' ', { target: name });
    eq(w.log.clicks.length, 2, 'a release with no press behind it does nothing');
    // The case this exists for: Space on a seat you hold opens the chargeable
    // cancel confirm, whose danger button has focus by the time the key is up.
    const dangerBtn = w.roleButton({ name: 'confirm-danger' });
    w.key(' ', { target: name });
    w.keyUp(' ', { target: dangerBtn });
    eq(w.log.clicks.length, 2, 'a release that lands on a DIFFERENT element (focus moved into a dialog) clicks nothing');
    w.key(' ', { target: name });
    w.keyUp('Shift', { target: name });
    w.keyUp(' ', { target: name });
    eq(w.log.clicks.length, 3, 'another key\'s release in between does not lose the press');
    w.log.clicks.pop();
    w.key(' ', { target: name });
    w.doc.confirmUp = true;
    w.keyUp(' ', { target: name });
    w.doc.confirmUp = false;
    eq(w.log.clicks.length, 2, 'a confirm dialog that opened during the press: the release is not ours');
    e = w.key('Enter', { target: name, repeat: true });
    eq([w.log.clicks.length, e.defaultPrevented], [2, true], 'a held key never re-fires');
    e = w.key('Enter', { target: name, defaultPrevented: true });
    eq(w.log.clicks.length, 2, 'a nearer handler already dealt with it (features.js class rows): not clicked twice');
    e = w.key('Enter', { target: w.roleButton({ matches: () => false }) });
    eq([w.log.clicks.length, e.defaultPrevented], [2, false], 'anything else (a real button, an input) is left to the browser');
    const takenSeat = w.roleButton({ name: 'taken-seat', attrs: { 'aria-disabled': 'true' } });
    w.key('Enter', { target: takenSeat });
    eq(w.log.clicks.length, 2, 'aria-disabled (a taken seat) does nothing');
    const svgSeat = w.roleButton({ click: undefined, dispatchEvent: (ev) => w.log.dispatched.push([ev.type, ev.bubbles]) });
    w.key('Enter', { target: svgSeat });
    eq(w.log.dispatched, [['click', true]], 'an SVG seat has no click(): it gets a bubbling click event, so its inline onclick runs');
    w.doc.confirmUp = true;
    w.key('Enter', { target: name });
    eq(w.log.clicks.length, 2, 'while a confirm dialog is up nothing behind it is activated');
  }

  // ── Source contracts ─────────────────────────────────────────────────────
  t.section('A11y: static attributes the handling relies on');
  const html = t.readSource('psycle-finder.html');
  ok(/<div id="srStatus" class="sr-only" role="status" aria-live="polite"/.test(html), 'page has the polite live region');
  ok(/<div id="srAlert" class="sr-only" role="alert" aria-live="assertive"/.test(html), 'page has the assertive live region');
  const toastTag = (/<div id="toast"[^>]*>/.exec(html) || [''])[0];
  ok(!!toastTag && !/role=|aria-live/.test(toastTag), '#toast itself carries no live role (a message must not be spoken twice)');
  ok(/id="modalHint" aria-live="polite"/.test(html), 'the picker\'s hint (selection feedback) is a live region');
  ok(/<svg id="bikeSvg"[^>]*role="group"[^>]*aria-label=/.test(html), 'the seat map is a labelled group');
  const css = t.readSource('css/styles.css');
  const srRule = (/\.sr-only\s*\{([^}]*)\}/.exec(css) || [])[1] || '';
  ok(/position:\s*absolute/.test(srRule) && /clip/.test(srRule) && !/display:\s*none|visibility:\s*hidden/.test(srRule),
    '.sr-only clips instead of hiding (a region that is not rendered is never read)');
  ok(/#bikeSvg \.bike-slot:focus-visible rect\s*\{[^}]*stroke:\s*var\(--text-heading\)/.test(css),
    'seat focus ring: id-weighted (beats the light themes\' seat rules) and not the accent the selected seat is filled with');

  const files = {
    'psycle-finder.html': html, 'js/app.js': appSrc, 'js/features.js': t.readSource('js/features.js'),
    'js/settings.js': t.readSource('js/settings.js'), 'js/tabs.js': t.readSource('js/tabs.js'),
  };
  let dialogs = 0;
  Object.keys(files).forEach((file) => {
    const src = files[file];
    (src.match(/aria-labelledby="([A-Za-z]+)"/g) || []).forEach((m) => {
      const id = /"([A-Za-z]+)"/.exec(m)[1];
      ok(src.indexOf('id="' + id + '"') !== -1, file + ': aria-labelledby="' + id + '" names an element that exists');
    });
    (src.match(/<button class="modal-close[^>]*>/g) || []).forEach((tag) => {
      ok(/aria-label="Close"/.test(tag), file + ': a × close button is labelled — ' + tag.slice(0, 60));
    });
    dialogs += (src.match(/role="dialog" aria-modal="true"/g) || []).length;
  });
  // The nine sheets / panels + confirmModal + the first-run tour + the "Your
  // usual week" sheet (tabs.js; it keeps its own Escape handler and focus trap,
  // so it is not in the key handler's list below).
  eq(dialogs, 12, 'every sheet and panel says it is a modal dialog');
  ['tokenDialog', 'bikeModal', 'syncPromptOverlay', 'classDetailOverlay', 'historyModalOverlay', 'instructorModalOverlay',
    'yearReviewOverlay', 'settingsOverlay', 'diagOverlay'].forEach((id) => {
    ok(ovSrc.indexOf("['" + id + "'") !== -1, 'the key handler knows #' + id);
  });

  // ── Toasts while an aria-modal dialog is open ────────────────────────────
  // A screen reader treats everything outside an open aria-modal dialog as
  // inert — #srStatus / #srAlert included — so "Bike 12 cancelled" in the
  // picker, or an error under a confirm, was never spoken.
  t.section('A11y: which open dialog is on top (pure)');
  eq([p._topDialogIndex([]), p._topDialogIndex(undefined), p._topDialogIndex(null)], [-1, -1, -1], 'no dialog open → none');
  eq(p._topDialogIndex([{ z: 1000 }]), 0, 'one open → that one');
  eq(p._topDialogIndex([{ z: 1000 }, { z: 1100 }]), 1, 'a confirm (1100) over the picker (1000) → the confirm');
  eq(p._topDialogIndex([{ z: 1000 }, { z: 300 }]), 0, 'the static picker comes FIRST in the document but sits above Settings (300): z-index wins over order');
  eq(p._topDialogIndex([{ z: 250 }, { z: 250 }]), 1, 'equal layers (a profile opened from the history sheet): the later one — overlays are appended as they open');
  eq(p._topDialogIndex([{ z: NaN }, { z: 'auto' }, {}]), 2, "'auto' / unreadable z-index counts as 0, so document order decides");
  eq(p._topDialogIndex([{ z: 10000 }, { z: NaN }]), 0, '…and never beats a real layer');

  t.section('A11y: a toast raised while a dialog is open is ALSO written inside it');
  {
    const dialogWorld = () => {
      const timers = [];
      const mkRegion = () => ({
        textContent: '', className: '', attrs: {}, isRegion: true,
        setAttribute(k, v) { this.attrs[k] = v; },
      });
      const mkDialog = (name, z, open) => {
        const d = {
          name, z, open, kids: [],
          getClientRects() { return this.open ? [{}] : []; },
          closest() { return { z: this.z, _psycleClosing: this.closing === true }; }, // the body-level overlay: its layer, and confirmModal's "fading out" mark
          querySelector(sel) { const m = /\[data-sr-region="(\w+)"\]/.exec(sel); return this.kids.find((k) => m && k.attrs['data-sr-region'] === m[1]) || null; },
          appendChild(k) { this.kids.push(k); return k; },
        };
        return d;
      };
      const els = { toast: { textContent: '', className: '', classList: { remove() {} } }, srStatus: mkRegion(), srAlert: mkRegion() };
      const dialogs = [];
      const ctx = t.loadPure('js/app.js', 'a11y', {
        toastTimer: undefined,
        setTimeout: (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length; },
        clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].live = false; },
        getComputedStyle: (layer) => ({ zIndex: String(layer.z) }),
        document: {
          getElementById: (id) => els[id] || null,
          createElement: () => mkRegion(),
          body: { appendChild() {} },
          querySelectorAll: (sel) => (sel === '[role="dialog"][aria-modal="true"]' ? dialogs : []),
        },
      });
      t.vm.runInContext(speakSrc, ctx, { filename: 'js/app.js[toast+announce]' });
      const run = (ms) => timers.filter((x) => x.live && x.ms === ms).forEach((x) => { x.live = false; x.fn(); });
      return { ctx, els, dialogs, mkDialog, run, timers };
    };

    let w = dialogWorld();
    const picker = w.mkDialog('picker', 1000, false); // static markup: in the page, inside a display:none overlay
    w.dialogs.push(picker);
    w.ctx.toast('Booking cancelled');
    w.run(50);
    eq([w.els.srStatus.textContent, picker.kids.length], ['Booking cancelled', 0], 'no dialog OPEN (the closed picker is still in the page): the page region only, nothing is added to the picker');

    picker.open = true;
    w.ctx.toast('Bike 12 cancelled');
    eq(picker.kids.length, 1, 'the picker is open: a region is made inside it at the call — before the text, so it is in the tree when the text arrives');
    eq([picker.kids[0].className, picker.kids[0].attrs.role, picker.kids[0].attrs['aria-live'], picker.kids[0].attrs['aria-atomic'], picker.kids[0].textContent],
      ['sr-only', 'status', 'polite', 'true', ''], '…visually hidden, polite, atomic — and still empty');
    w.run(50);
    eq([picker.kids[0].textContent, w.els.srStatus.textContent, w.els.toast.textContent], ['Bike 12 cancelled', 'Bike 12 cancelled', 'Bike 12 cancelled'],
      'a beat later the line is in BOTH regions; the visible toast is untouched');
    w.ctx.toast('Bike 14 cancelled');
    w.run(50);
    eq([picker.kids.length, picker.kids[0].textContent], [1, 'Bike 14 cancelled'], 'the next message reuses that region (one per dialog and politeness)');
    w.run(p._toastDuration('Bike 14 cancelled'));
    eq([picker.kids[0].textContent, w.els.srStatus.textContent], ['', ''], 'both are emptied afterwards — nothing stale to swipe onto inside the dialog either');

    // An error, under a confirm that is on top of the picker.
    const confirm = w.mkDialog('confirm', 1100, true);
    w.dialogs.push(confirm);
    w.ctx.toast("Couldn't cancel — try again", 'error');
    w.run(50);
    eq([confirm.kids.map((k) => [k.attrs.role, k.attrs['aria-live'], k.textContent]), picker.kids.length, w.els.srAlert.textContent],
      [[['alert', 'assertive', "Couldn't cancel — try again"]], 1, "Couldn't cancel — try again"],
      'an error goes to an ASSERTIVE region in the top-most dialog (the confirm), not the picker under it — no role is swapped on an existing region');

    // The confirm closes (removed with its region); the picker's own region takes over, and its stale sibling is not left behind.
    w.ctx.toast('Working…');
    w.run(50);
    eq(confirm.kids.find((k) => k.attrs.role === 'status').textContent, 'Working…', '(a polite line while the confirm is up lands in the confirm)');
    confirm.open = false;
    w.ctx.toast('Booking cancelled');
    eq(confirm.kids.find((k) => k.attrs.role === 'status').textContent, '', 'the copy left in the dialog that was on top is emptied as the next message moves elsewhere (its own clean-up timer was cancelled)');
    w.run(50);
    eq([picker.kids.find((k) => k.attrs.role === 'status').textContent, confirm.kids.find((k) => k.attrs.role === 'status').textContent], ['Booking cancelled', ''],
      '…and the message is spoken in the dialog that is on top now');

    // A confirm that has been ANSWERED is still rendered — top layer, aria-modal
    // — for the 180ms of its fade (close() only drops .show). The toast its
    // answer raises ("You're offline — nothing was cancelled", 'Import
    // cancelled') used to go into that dying dialog and vanish with it.
    w = dialogWorld();
    const under = w.mkDialog('picker', 1000, true);
    const fading = w.mkDialog('confirm', 1100, true);
    fading.closing = true; // overlay._psycleClosing, set beside classList.remove('show')
    w.dialogs.push(under, fading);
    w.ctx.toast("You're offline — nothing was cancelled", 'error');
    w.run(50);
    eq([fading.kids.length, under.kids.map((k) => [k.attrs.role, k.textContent])], [0, [['alert', "You're offline — nothing was cancelled"]]],
      'a confirm on its way out gets nothing: the line goes to the dialog the member is still in (the picker)');
    w = dialogWorld();
    const lone = w.mkDialog('confirm', 1100, true);
    lone.closing = true;
    w.dialogs.push(lone);
    w.ctx.toast('Import cancelled');
    w.run(50);
    eq([lone.kids.length, w.els.srStatus.textContent], [0, 'Import cancelled'], '…and with nothing else open, the page region alone (no longer inert once the confirm is gone)');
    ok(/overlay\._psycleClosing = true;[^\n]*\n\s*overlay\.classList\.remove\('show'\);/.test(appSrc) && /ov\._psycleClosing = true; ov\.classList\.remove\('show'\);/.test(appSrc) &&
      /overlay\._psycleClosing = true;[^\n]*\n\s*overlay\.classList\.remove\('show'\);/.test(t.readSource('js/tabs.js')),
      'confirmModal, the tour and the usual-week sheet mark their overlay as closing where they start the fade');

    // Nothing about a dialog may break the toast that carries the message.
    w = dialogWorld();
    w.dialogs.push({ getClientRects() { throw new Error('detached'); } });
    w.ctx.toast('Still shown', 'error');
    w.run(50);
    eq([w.els.toast.textContent, w.els.srAlert.textContent], ['Still shown', 'Still shown'], 'a dialog that cannot be measured: the toast and the page region carry on as if none were open');
  }
  ok(/function _dialogLiveRegion\(id, assertive\) \{\n  try \{\n    if \(typeof document\.querySelectorAll !== 'function'\) return null;/.test(appSrc),
    'a page (or test shell) without querySelectorAll is simply "no dialog open"');
};
