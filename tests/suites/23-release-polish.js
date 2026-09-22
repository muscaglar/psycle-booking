'use strict';
// The release polish of September 2026, held so it cannot quietly come back:
//   • a member never reads an HTTP status code or a raw exception in a message;
//   • a toast is sentences, not "problem — instruction" (the two label contracts
//     'Failed — retry' / 'Unconfirmed — retry' are button labels, not toasts, and stay);
//   • the class reminder's body is ONE list, so a class with no instructor and no place
//     never begins with a separator (ios-app/www/native-bridge.js _classReminderBody);
//   • the plan's usage line never says "-1 remaining" (js/tabs.js);
//   • the privacy policy is reachable inside the app, and Diagnostics — the owner's tool,
//     in engineering words — is not advertised in Settings (js/settings.js);
//   • the calendar is asked for alone, never Reminders (that half is in calendar-safety.js).
// Sources are read as text; the three small functions are sliced out and run on fakes.
module.exports = async function (t) {
  const { ok, eq } = t;
  const vm = require('vm');
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..', '..');
  const read = (f) => t.readSource(f);
  const jsFiles = fs.readdirSync(path.join(root, 'js')).filter((f) => /\.js$/.test(f)).map((f) => 'js/' + f);
  const shipped = jsFiles.concat(['ios-app/www/native-bridge.js', 'login.html']);
  const between = (src, from, to, what) => {
    const a = src.indexOf(from); const b = src.indexOf(to, a + 1);
    if (a === -1 || b === -1) throw new Error('23-release-polish: cannot find ' + what + ' (anchor moved?)');
    return src.slice(a, b);
  };

  t.section('Release polish: what a member never reads');
  {
    const offenders = [];
    shipped.forEach((f) => read(f).split('\n').forEach((line, i) => {
      if (/^\s*\/\//.test(line)) return;
      // a status code or an exception's own words inside a message a member sees
      if (/toast\([^\n]*(\$\{(res\.)?status\}|' \+ (res\.)?status \+ '|e\.message|err\.message)/.test(line)) offenders.push(f + ':' + (i + 1));
      if (/(showError|setStatus)\([^\n]*(e\.message|\(' \+ status \+ '\))/.test(line)) offenders.push(f + ':' + (i + 1));
    }));
    eq(offenders, [], 'no toast or error line prints an HTTP status or a raw exception message');
    ok(!/Sign in failed \(/.test(read('login.html')) && !/Check the console/.test(read('login.html')), 'the sign-in page says nothing about status codes, tokens or a console');
    const dashed = [];
    shipped.forEach((f) => read(f).split('\n').forEach((line, i) => { if (/toast\([^\n]*( — |\\u2014)/.test(line)) dashed.push(f + ':' + (i + 1)); }));
    eq(dashed, [], 'no toast is written "problem — instruction": two sentences instead');
    ok(!/safe mode|Heads up/.test(between(read('js/diagnostic.js'), "var msg = document.createElement('span');", 'banner.appendChild(msg);', 'the banner text')),
      'the banner shown when Psycle changes a field uses no jargon ("safe mode") and no filler');
    const messages = between(read('js/api-client.js'), 'var USER_MESSAGES = {', '};', 'USER_MESSAGES');
    ok(!/rate-limiting|The request|Something went wrong|servers/.test(messages) && !/ — /.test(messages), 'the error sentences behind Discover are plain: no "rate-limiting", "request", or "Something went wrong"');
  }

  t.section('Release polish: the class reminder body is one list');
  {
    const src = read('ios-app/www/native-bridge.js');
    const fn = between(src, '  function _classReminderBody(c) {', '\n  }\n', '_classReminderBody') + '\n  }';
    const body = (android, c) => vm.runInNewContext('(function () { var IS_ANDROID = ' + android + ';\n' + fn + '\n return _classReminderBody; })()')(c);
    eq([body(false, { instrName: 'Ann', locName: 'Bank' }), body(false, { instrName: 'Ann', studioName: 'Studio 1' }), body(false, {})],
      ['Ann · Bank · Open Psync for the live countdown', 'Ann · Studio 1 · Open Psync for the live countdown', 'Open Psync for the live countdown'],
      'iPhone: instructor · place · what a tap is for — and with neither known it does not begin with a separator');
    eq([body(true, { instrName: 'Ann', locName: 'Bank' }), body(true, {})], ['Ann · Bank', ''], 'Android: the countdown arrives by itself, so nothing is asked for');
    ok(!/_classReminderTail/.test(src), 'the old tail, glued on with a dash, is gone');
  }

  t.section('Release polish: the plan line never goes negative');
  {
    const tabs = read('js/tabs.js');
    ok(/var remaining = Math\.max\(0, max - made\);/.test(tabs), 'remaining is clamped at 0 (Psycle can report more classes made than the plan allows)');
  }

  t.section('Release polish: the privacy policy is in the app; Diagnostics is not advertised');
  {
    const settings = read('js/settings.js');
    const data = between(settings, '\'<div class="settings-section" id="settingsSecData">\' +', 'Show the welcome again', 'the Data section');
    ok(/onclick="openPrivacyPolicy\(\)">Privacy policy<\/button>/.test(data), 'Settings → Data has a "Privacy policy" button');
    ok(!/Open diagnostics/.test(settings) && !/settings-section-title">Diagnostics</.test(settings), 'no Settings section advertises Diagnostics');
    ok(/onclick="downloadBugReport\(\)">Bug report<\/button>/.test(data), 'the member\'s own route to the same facts, Bug report, is still there');

    const block = between(settings, "  var PRIVACY_POLICY_URL = ", '  var _diagReportText = null;', 'the privacy + five-tap block');
    const run = (native) => {
      const opened = []; let listener = null; let diag = 0; let now = 1000;
      const win = { open: (u, target, feat) => opened.push([u, target, feat]), openDiagnostics: () => { diag++; } };
      if (native) win.Capacitor = { isNativePlatform: () => true };
      const ctx = { window: win, document: { addEventListener: (type, fn) => { if (type === 'click') listener = fn; } }, Date: { now: () => now } };
      vm.runInNewContext(block, ctx);
      const tap = (onMark, dt) => { now += dt; listener({ target: { closest: (sel) => (onMark && sel === '.about-mark' ? {} : null) } }); };
      return { win, opened, tap, diag: () => diag };
    };
    const web = run(false); web.win.openPrivacyPolicy();
    const app = run(true); app.win.openPrivacyPolicy();
    eq([web.opened[0], app.opened[0][0], app.opened[0][1]], [['privacy.html', '_blank', 'noopener'], 'https://muscaglar.github.io/psycle-booking/privacy.html', '_blank'],
      'the web app opens its own page; the native apps, which do not bundle it, open the hosted copy');
    ok(/muscaglar\.github\.io\/psycle-booking\/privacy\.html/.test(read('ios-app/APP_STORE_LISTING.md')), '…the same address the App Store listing gives as the privacy policy URL');

    const five = run(false); for (let i = 0; i < 5; i++) five.tap(true, 200);
    const four = run(false); for (let i = 0; i < 4; i++) four.tap(true, 200);
    const slow = run(false); for (let i = 0; i < 6; i++) slow.tap(true, 2000);
    const elsewhere = run(false); for (let i = 0; i < 8; i++) elsewhere.tap(false, 100);
    eq([five.diag(), four.diag(), slow.diag(), elsewhere.diag()], [1, 0, 0, 0], 'five quick taps on the PSYNC mark open Diagnostics; four, slow taps, or taps anywhere else do not');
  }
};
