// Before / after: prove that a change moved nothing on screen (a CSS clean-up, a dead-code removal).
// The REAL app on the fake Psycle server, the clock frozen, motion off; per scene one PNG and one list of
// what every VISIBLE element computes to. Capture before the change, capture after it, compare.
//   1. serve the repo:            python3 -m http.server 8080 --bind 127.0.0.1
//   2. before the change:         node tests/tools/before-after.mjs capture /tmp/shots/before
//      (twice, into two folders, if you want to know which scenes are steady by themselves)
//   3. after the change:          node tests/tools/before-after.mjs capture /tmp/shots/after
//   4. compare:                   node tests/tools/before-after.mjs compare /tmp/shots/before /tmp/shots/after
// A scene PASSES when its PNG is byte-identical. For one that is not, the visible elements that differ are
// printed: a size or a colour that moved is a rule that was not dead. (The Diagnostics scene prints the build
// id, which changes with every build: expect it to differ by a pixel or two, and nothing else.)
// Needs Google Chrome (set CHROME to its binary if it is not in /Applications) and Node 22+ (built-in
// WebSocket). Each run uses a fresh browser profile, so no cached script or stylesheet can be served.
// Nothing here can reach the live API: the page answers every request itself (tests/tools/fake-psycle.js),
// and the browser can resolve no host but this machine.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const [mode, dirA, dirB] = process.argv.slice(2);
const BASE = process.env.BASE || 'http://127.0.0.1:8080';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const NOW = Date.parse('2026-09-23T10:00:00'); // the frozen clock: every capture is the same morning
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);

// Runs in the page, before the app: a frozen Date, the fake server, a member with a plan, held classes, a
// waitlist place and a history, then the app itself. (The clock is frozen, so nothing here may wait on
// Date.now(): waits count real timers.)
const BOOT = String.raw`(async () => {
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
  localStorage.clear(); sessionStorage.clear();
  const opts = window.__opts || {};
  if (!opts.welcome) localStorage.setItem('psycle_onboarded_v1', '1');
  localStorage.setItem('psycle_history_prompt_dismissed', '1');
  localStorage.setItem('psycle_hint_dayswipe', '1');
  if (opts.theme) localStorage.setItem('psycle_theme', opts.theme);
  const RealDate = Date; const FIXED = ${NOW};
  class FrozenDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(FIXED); } static now() { return FIXED; } }
  window.Date = FrozenDate;
  window.alert = () => {}; window.confirm = () => true; window.prompt = () => null; window.open = () => null; window.print = () => {};
  (0, eval)(await fetch('/tests/tools/fake-psycle.js', { cache: 'reload' }).then(r => r.text()));
  const H = window.__H; const serve = H.serve;
  const plan = { id: 5, name: 'Monthly 30', status: 'active', max_bookings: 30, bookings_made: 12, plan: { price: 14000 },
    period_start: H.day(-20) + ' 00:00:00', period_end: H.day(3) + ' 00:00:00',
    upcoming_billing_periods: [{ start: H.day(3) + ' 00:00:00', end: H.day(33) + ' 00:00:00', pausable: true }] };
  H.waitlists = [];
  H.serve = async function (url, init) {
    const u = new URL(url); const method = String((init && init.method) || 'GET').toUpperCase();
    const p = u.pathname.replace(/^\/api\/v1\/customer/, '');
    const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (method === 'GET' && p === '/profile') return json({ data: { id: 1, first_name: 'Test', last_name: 'Member', email: 'test@example.com', subscriptions: [plan], stats: { credits_remaining: 0 } } });
    if (method === 'GET' && p === '/waitlists') return json({ data: H.waitlists, meta: { current_page: 1, last_page: 1 } });
    return serve(url, init);
  };
  const on = (d, i) => H.events.filter(e => e.start_at.slice(0, 10) === H.day(d))[i];
  [[1, 0, [7]], [2, 1, [5, 6]], [5, 0, [3]], [6, 1, [4, 5]]].forEach(([d, i, slots]) => { const e = on(d, i); if (e) slots.forEach(s => H.bookings.push({ id: H.nextBookingId++, event_id: e.id, slot: s })); });
  const w = on(2, 3);
  if (w) H.waitlists.push({ id: 555, status: 'waiting', added_at: H.day(0) + ' 09:00:00', expires_at: null, cancelled_at: null, allocated_at: null,
    event: { id: w.id, start_at: w.start_at.replace('T', ' '), duration: 45, event_type: { id: 201, name: 'RIDE 45' }, instructor: { id: 101, full_name: 'Alex Hart' }, studio: { id: 11, name: 'Ride Studio', has_layout: true, location: { name: 'Psycle Oxford Circus', address: '76 Mortimer St' } }, is_class_full: true, available_slot_count: 0, required_credits: 1 } });
  if (!opts.welcome) {
    const hist = []; for (let k = 1; k <= 40; k++) { const d = new RealDate(FIXED - k * 2 * 86400000); hist.push({ eventId: 5000 + k, date: d.toISOString().slice(0, 10), startAt: d.toISOString().slice(0, 10) + 'T0' + (6 + k % 3) + ':30:00', typeName: ['RIDE 45', 'STRENGTH: Full Body', 'YOGA Flow'][k % 3], instrName: ['Alex Hart', 'Bea Collins', 'Cam Reyes'][k % 3], instructorId: 101 + (k % 3), locName: 'Oxford Circus', studioName: 'Ride Studio', duration: 45, status: 'attended', slots: [k % 12 + 1] }); }
    localStorage.setItem('psycle_class_history', JSON.stringify(hist));
    localStorage.setItem('psycle_fav_instructors', JSON.stringify([101]));
  }
  await H.boot({});
  window.alert = () => {}; window.confirm = () => true; window.prompt = () => null; window.open = () => null;
  const still = document.createElement('style'); still.id = '__still';
  still.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}';
  document.head.appendChild(still);
  await window.securityReady;
  if (!opts.signedOut) {
    await window._secureTokenStore.set('faketoken-123456789'); await window.checkAuth();
    for (let i = 0; i < 100 && document.querySelectorAll('#upcomingList .my-booking-card').length < 4; i++) await new Promise(r => setTimeout(r, 100));
  }
  await new Promise(r => setTimeout(r, 3000)); // the first timetable search settles
  try { await document.fonts.ready; } catch (e) {}
  window.__click = (el) => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  window.__computed = () => {
    const props = ['display','position','color','background-color','font-family','font-size','font-weight','line-height','letter-spacing','text-transform','margin-top','margin-right','margin-bottom','margin-left','padding-top','padding-right','padding-bottom','padding-left','border-top-width','border-top-color','border-radius','box-shadow','opacity','z-index','gap','flex-direction','justify-content','align-items','overflow-x','overflow-y','white-space','text-align','min-height','max-width','visibility','top','left','right','bottom','grid-template-columns'];
    const rows = [];
    document.querySelectorAll('body *').forEach((el) => {
      if (el.id === '__still') return;
      const r = el.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return;
      const cs = getComputedStyle(el);
      rows.push(el.tagName + '#' + el.id + '.' + String(el.getAttribute('class') || '') + '|' + Math.round(r.width) + 'x' + Math.round(r.height) + '|' + props.map(p => cs.getPropertyValue(p)).join(';'));
    });
    return rows;
  };
  return 'booted';
})()`;

const click = (sel) => `window.__click(document.querySelector(${JSON.stringify(sel)}))`;
const byText = (scope, re) => `window.__click(Array.from(document.querySelectorAll(${JSON.stringify(scope)})).find(b => ${re}.test((b.textContent||'').trim())))`;
const waitFor = (test) => `(async()=>{for(let i=0;i<60;i++){if(${test}) break; await new Promise(r=>setTimeout(r,100));}})()`;
const ESC = `(async()=>{for(let i=0;i<4;i++){document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await new Promise(r=>setTimeout(r,60));} const o=document.getElementById('historyModalOverlay'); if(o) o.remove();})()`;
// [name, steps…]: each step is an expression evaluated in the page, in order; the scene is captured after the last.
const SCENES = [
  ['bookings', `window.switchTab('bookings')`],
  ['bookings-more', `window.switchTab('bookings')`, click('#upcomingList .mb-more-btn')],
  ['discover-today', `window.switchTab('discover')`],
  ['discover-7days', `window.switchTab('discover')`, byText('button', '/^7 days$/i'), waitFor(`document.querySelectorAll('#dayStrip .day-pill').length>1`), `window.__click(document.querySelectorAll('#dayStrip .day-pill')[1])`],
  ['discover-filters', byText('button', '/^Filters/i')],
  ['class-sheet', byText('button', '/^Filters/i'), click('#results .class-card .cc-name')],
  ['seat-picker', ESC, `window.__click(Array.from(document.querySelectorAll('#results .class-card .book-btn')).find(x => /^Book$/.test(x.textContent.trim())))`, waitFor(`(()=>{const m=document.getElementById('bikeModal');return m&&getComputedStyle(m).display!=='none'&&m.querySelector('.bike-slot')})()`)],
  ['instructor-profile', ESC, click('#results .instructor-link')],
  ['stats-1', ESC, `window.switchTab('stats')`],
  ['stats-2', `window.__click(document.querySelectorAll('#tab-stats [role="tab"]')[1])`],
  ['stats-3', `window.__click(document.querySelectorAll('#tab-stats [role="tab"]')[2])`],
  ['membership', `window.switchTab('membership')`],
  ['settings', `window.openSettings()`],
  ['diagnostics', `(async()=>{const m=document.querySelector('.about-mark'); for(let i=0;i<5;i++){window.__click(m); await new Promise(r=>setTimeout(r,40));} })()`],
  ['history', ESC, `window.closeSettings && window.closeSettings()`, `window.switchTab('bookings')`, `window.openHistoryModal()`],
  ['usual-week-sheet', ESC, byText('#usualWeekCard button', '/save my usual week/i'), `new Promise(r=>setTimeout(r,500))`, byText('#usualWeekCard button', '/review and book/i'), `new Promise(r=>setTimeout(r,1200))`],
];
const NEXT = byText('[class*="onboard"] button', '/next|continue/i');
const RUNS = [
  { tag: 'phone-cloud', w: 390, h: 844, dpr: 2, opts: { theme: 'cloud' }, scenes: SCENES },
  { tag: 'phone-graphite', w: 390, h: 844, dpr: 2, opts: { theme: 'graphite' }, scenes: SCENES },
  { tag: 'desktop-cloud', w: 1280, h: 800, dpr: 1, opts: { theme: 'cloud' }, scenes: SCENES.filter((s) => /^(bookings|discover-7days|class-sheet|seat-picker|stats-1|membership|settings)$/.test(s[0])) },
  { tag: 'signedout-cloud', w: 390, h: 844, dpr: 2, opts: { theme: 'cloud', signedOut: true }, scenes: ['discover', 'bookings', 'stats', 'membership'].map((t) => [t, `window.switchTab('${t}')`]) },
  { tag: 'welcome-cloud', w: 390, h: 844, dpr: 2, opts: { theme: 'cloud', welcome: true, signedOut: true }, scenes: [['page-1', `0`], ['page-2', NEXT], ['page-3', NEXT], ['page-4', NEXT]] },
];

async function withChrome(fn) {
  const port = 9300 + Math.floor(Math.random() * 500); const profile = mkdtempSync(join(tmpdir(), 'psync-before-after-'));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--force-prefers-reduced-motion',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  try {
    let wsUrl = null;
    for (let i = 0; i < 80 && !wsUrl; i++) { try { const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); wsUrl = (list.find((t) => t.type === 'page') || {}).webSocketDebuggerUrl; } catch (e) {} if (!wsUrl) await sleep(250); }
    if (!wsUrl) throw new Error('Chrome did not start (set CHROME=/path/to/chrome)');
    const ws = new WebSocket(wsUrl); let id = 0; const pending = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); const p = d.id && pending.get(d.id); if (p) { pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); } };
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const send = (method, params = {}) => new Promise((res, rej) => { const n = ++id; pending.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method, params })); });
    await send('Page.enable'); await send('Runtime.enable');
    await fn(send); ws.close();
  } finally { chrome.kill('SIGKILL'); await sleep(300); try { rmSync(profile, { recursive: true, force: true }); } catch (e) {} }
}
const run = async (send, expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
  return r.result.value;
};

async function capture(out) {
  mkdirSync(out, { recursive: true });
  const manifest = {};
  for (const r of RUNS) {
    await withChrome(async (send) => {
      await send('Emulation.setDeviceMetricsOverride', { width: r.w, height: r.h, deviceScaleFactor: r.dpr, mobile: r.w < 700 });
      await send('Page.navigate', { url: BASE + '/__blank__' }); await sleep(600);
      await run(send, `window.__opts = ${JSON.stringify(r.opts)}; 0`);
      await run(send, BOOT);
      for (const [name, ...steps] of r.scenes) {
        let err = '';
        for (const s of steps) { try { await run(send, s); } catch (e) { err += ' | ' + String(e.message).split('\n')[0].slice(0, 120); } await sleep(250); }
        await sleep(500);
        const png = Buffer.from((await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true })).data, 'base64');
        const rows = await run(send, 'window.__computed()');
        const net = JSON.parse(await run(send, 'JSON.stringify({ leaked: window.__H.leaked.length, live: window.__H.liveHits().length, writes: window.__H.writes.length })'));
        const key = r.tag + '__' + name;
        writeFileSync(join(out, key + '.png'), png);
        writeFileSync(join(out, key + '.json'), JSON.stringify(rows));
        manifest[key] = { png: sha(png), elements: rows.length, err: err || undefined, net };
        console.log(key.padEnd(34), manifest[key].png, String(rows.length).padStart(5), err);
      }
    });
  }
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
  const bad = Object.entries(manifest).filter(([, v]) => v.err || v.net.leaked || v.net.live);
  console.log(Object.keys(manifest).length + ' scenes captured into ' + out + (bad.length ? ' — ' + bad.length + ' with a step that failed or a request that left the page' : ''));
  if (bad.length) process.exitCode = 1;
}

function compare(before, after) {
  const A = JSON.parse(readFileSync(join(before, 'manifest.json'), 'utf8'));
  const B = JSON.parse(readFileSync(join(after, 'manifest.json'), 'utf8'));
  const names = Object.keys(A); const moved = names.filter((k) => !B[k] || B[k].png !== A[k].png);
  console.log(names.length + ' scenes; ' + (names.length - moved.length) + ' identical to the pixel; ' + moved.length + ' different');
  const count = (rows) => rows.reduce((m, r) => m.set(r, (m.get(r) || 0) + 1), new Map());
  for (const k of moved) {
    if (!B[k]) { console.log('\n== ' + k + ': missing from ' + after); continue; }
    const a = count(JSON.parse(readFileSync(join(before, k + '.json'), 'utf8'))); const b = count(JSON.parse(readFileSync(join(after, k + '.json'), 'utf8')));
    const gone = [...a.keys()].filter((r) => !b.has(r)); const came = [...b.keys()].filter((r) => !a.has(r));
    console.log('\n== ' + k + ': ' + gone.length + ' visible element(s) only before, ' + came.length + ' only after' + (gone.length + came.length ? '' : ' (the same elements compute the same: a pixel of text or an image moved)'));
    gone.slice(0, 6).forEach((r) => console.log('   - ' + r.slice(0, 200)));
    came.slice(0, 6).forEach((r) => console.log('   + ' + r.slice(0, 200)));
  }
  if (moved.length) process.exitCode = 1;
}

if (mode === 'capture' && dirA) await capture(dirA);
else if (mode === 'compare' && dirA && dirB) compare(dirA, dirB);
else { console.error('usage: node tests/tools/before-after.mjs capture <dir>\n       node tests/tools/before-after.mjs compare <before-dir> <after-dir>'); process.exit(2); }
