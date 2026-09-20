// Rebuild the six App Store screenshots (1290 x 2796) from the REAL app on the fake Psycle server.
//   1. serve the repo:  python3 -m http.server 8080 --bind 127.0.0.1      2. node tests/tools/appstore-shots.mjs
// With --play: the same six scenes as Google Play phone screenshots (1080 x 1920) in ios-app/playstore-assets/.
//   node tests/tools/appstore-shots.mjs --play        (the App Store files are not touched; see CANVAS below)
// Needs Google Chrome (set CHROME to its binary if it is not in /Applications) and Node 22+ (built-in WebSocket).
// Nothing here can reach the live API: the harness page answers every request itself (tests/tools/fake-psycle.js).
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = process.env.BASE || 'http://127.0.0.1:8080';
const WORK = join(ROOT, 'tests', 'tools', '.appstore-work');   // git-ignored; served by the same local server
// Two canvases, one set of scenes. Default: the App Store's, an iPhone's 1290 x 2796 (a 430 x 932 page at 3x
// around a 390 x 844 capture). --play: Google Play's phone screenshot. Play refuses a picture whose long side is
// more than TWICE its short side, and 2796 / 1290 is 2.17 - so the iPhone files cannot be uploaded there, and
// must not be cropped or squashed by hand. 1080 x 1920 is 9:16: a 360 x 640 page at 3x around a 412 x 732
// capture (an Android phone's width; the whole screen is shown, tab bar included). It writes to a folder of its
// own and NEVER over ios-app/appstore-assets/. tests/suites/22-play-release.js reads these numbers.
const PLAY = process.argv.includes('--play');
const CANVAS = PLAY
  ? { out: 'playstore-assets', raw: [412, 732], page: [360, 640], dpr: 3, px: [1080, 1920] }
  : { out: 'appstore-assets', raw: [390, 844], page: [430, 932], dpr: 3, px: [1290, 2796] };
const OUT = join(ROOT, 'ios-app', CANVAS.out);
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = [
  ['01-discover', 'discover', 'cloud', 'Find your class', 'One day at a time. Swipe to change day.'],
  ['02-book', 'picker', 'cloud', 'Book in two taps', 'Your usual spot is ready to confirm.'],
  ['03-bookings', 'bookings', 'cloud', 'Everything you hold', 'Seats, waitlists and free-cancel times in one place.'],
  ['04-stats', 'stats', 'cloud', 'Your training at a glance', 'Streaks, habits and the instructors you book most.'],
  ['05-class-colours', 'colours', 'cloud', 'Colour by class type', 'Choose the colours, and how strong they are.'],
  ['06-light-and-dark', 'discover', 'graphite', 'Light and dark', 'Follows your phone, or pick your own.'],
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withChrome(fn) {
  const port = 9300 + Math.floor(Math.random() * 500); const profile = mkdtempSync(join(tmpdir(), 'psync-cdp-'));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
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

// Navigate, wait for the page to title itself READY…, capture the viewport.
async function shoot(send, url, file, w, h, dpr) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: true });
  await send('Page.navigate', { url });
  let title = ''; const t0 = Date.now();
  while (Date.now() - t0 < 90000 && !/^READY/.test(title)) { await sleep(400); try { title = (await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true })).result.value || ''; } catch (e) { title = ''; } }
  if (!/^READY/.test(title)) throw new Error('not ready: ' + url);
  if (/leaks=[1-9]|live=[1-9]/.test(title)) throw new Error('the harness reported traffic towards the live API: ' + title);
  await sleep(600);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(file, Buffer.from(shot.data, 'base64')); console.log('ok  ', file.replace(ROOT + '/', ''), ' ', title);
}

const frame = (name, title, sub) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>compose</title><style>
@font-face{font-family:'SSC';src:url('${BASE}/fonts/sofia-sans-condensed.woff2') format('woff2');font-weight:600 900}
@font-face{font-family:'SS';src:url('${BASE}/fonts/sofia-sans.woff2') format('woff2');font-weight:400 800}
html,body{margin:0;width:430px;height:932px;background:#12161F;overflow:hidden}
.wrap{width:430px;height:932px;display:flex;flex-direction:column;align-items:center;box-sizing:border-box;padding-top:58px}
h1{margin:0;font-family:'SSC',sans-serif;font-weight:900;font-size:46px;line-height:1;letter-spacing:.2px;color:#FCFDFE;text-align:center}
p{margin:12px 28px 0;font-family:'SS',sans-serif;font-weight:500;font-size:17px;line-height:1.35;color:#AAB3C1;text-align:center}
.dev{margin-top:30px;width:344px;height:744.5px;border-radius:44px;overflow:hidden;box-shadow:0 0 0 1.5px #2B3345,0 24px 60px rgba(0,0,0,.45);background:#E6E9EE}
.dev img{display:block;width:344px;height:744.5px}
</style></head><body><div class="wrap"><h1>${title}</h1><p>${sub}</p><div class="dev"><img src="${BASE}/tests/tools/.appstore-work/raw-${name}.png" onload="document.fonts.ready.then(()=>setTimeout(()=>{document.title='READY ${name}'},300))"></div></div></body></html>`;

// The Play picture: the same caption in the app's own faces, over the capture as a PLAIN picture - a small
// corner radius and a hairline, no phone drawn round it, no maker's name, no store's name. The caption has a
// fixed height (two lines), so the picture sits at the same place in all six; the longest title ("Your training at
// a glance") is about 308px of the 360 at this size, clear of both edges.
const framePlay = (name, title, sub) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>compose</title><style>
@font-face{font-family:'SSC';src:url('${BASE}/fonts/sofia-sans-condensed.woff2') format('woff2');font-weight:600 900}
@font-face{font-family:'SS';src:url('${BASE}/fonts/sofia-sans.woff2') format('woff2');font-weight:400 800}
html,body{margin:0;width:360px;height:640px;background:#12161F;overflow:hidden}
.wrap{width:360px;height:640px;display:flex;flex-direction:column;align-items:center;box-sizing:border-box;padding-top:36px}
h1{margin:0;font-family:'SSC',sans-serif;font-weight:900;font-size:34px;line-height:1;letter-spacing:.2px;color:#FCFDFE;text-align:center;white-space:nowrap}
p{margin:10px 24px 0;height:40px;font-family:'SS',sans-serif;font-weight:500;font-size:14.5px;line-height:1.35;color:#AAB3C1;text-align:center;text-wrap:balance}
.shot{margin-top:20px;width:266px;height:472.6px;border-radius:10px;overflow:hidden;box-shadow:0 0 0 1.5px #2B3345,0 18px 44px rgba(0,0,0,.45);background:#E6E9EE}
.shot img{display:block;width:266px;height:472.6px}
</style></head><body><div class="wrap"><h1>${title}</h1><p>${sub}</p><div class="shot"><img src="${BASE}/tests/tools/.appstore-work/raw-${name}.png" onload="document.fonts.ready.then(()=>setTimeout(()=>{document.title='READY ${name}'},300))"></div></div></body></html>`;

// A PNG says its own size in its first 24 bytes (IHDR). Play mode only: a wrong canvas must fail here, not in the Console.
const pngSize = (file) => { const b = readFileSync(file); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

mkdirSync(WORK, { recursive: true }); mkdirSync(OUT, { recursive: true });
await withChrome(async (send) => {
  for (const [name, view, theme] of SHOTS) await shoot(send, `${BASE}/tests/tools/appstore-capture.html?view=${view}&theme=${theme}`, join(WORK, `raw-${name}.png`), CANVAS.raw[0], CANVAS.raw[1], CANVAS.dpr);
  for (const [name, , , title, sub] of SHOTS) { writeFileSync(join(WORK, `frame-${name}.html`), (PLAY ? framePlay : frame)(name, title, sub)); await shoot(send, `${BASE}/tests/tools/.appstore-work/frame-${name}.html`, join(OUT, `${name}.png`), CANVAS.page[0], CANVAS.page[1], CANVAS.dpr); }
});
rmSync(WORK, { recursive: true, force: true });
if (PLAY) {
  for (const [name] of SHOTS) { const [w, h] = pngSize(join(OUT, `${name}.png`)); if (w !== CANVAS.px[0] || h !== CANVAS.px[1] || Math.max(w, h) > 2 * Math.min(w, h)) throw new Error(`${name}.png is ${w} x ${h}: Play wants ${CANVAS.px[0]} x ${CANVAS.px[1]}, and never more than 2 to 1`); }
  console.log('six Play phone screenshots (1080 x 1920) written to ios-app/playstore-assets/');
} else console.log('six screenshots written to ios-app/appstore-assets/');
