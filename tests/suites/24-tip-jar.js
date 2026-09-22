'use strict';
// "Support Psync": optional tips through the stores' own in-app purchase (js/tabs.js, the iPhone plugin
// ios-app/ios/App/App/TipJarPlugin.swift, the Android twin PsycleTipJarPlugin.java + tips/PsyncTips.java).
//   • ONE allow-list of three product ids, identical in JS, Swift and Java; nothing else is asked for or sent;
//   • the section shows only in a native app whose store returned a product — never on the web, never empty;
//   • the store's price is printed as TEXT; one purchase at a time; fixed words for every outcome;
//   • nothing in the app links to any other way of paying (App Review 3.1.1; Play's payments policy);
//   • the iPhone plugin thanks nobody for an UNVERIFIED transaction and always finishes a verified one;
//     the Android twin consumes what it sold and never hands a purchase token to the page or the log.
// The pure block is evaluated; the DOM half is sliced out and run on fakes; native sources are read as text.
module.exports = async function (t) {
  const { ok, eq } = t;
  const vm = require('vm');
  const fs = require('fs');
  const path = require('path');
  const root = path.join(__dirname, '..', '..');
  const read = (f) => t.readSource(f);
  const tabs = read('js/tabs.js');
  const swift = read('ios-app/ios/App/App/TipJarPlugin.swift');
  const javaPlugin = read('ios-app/android/app/src/main/java/com/psyclefinder/app/PsycleTipJarPlugin.java');
  const javaTips = read('ios-app/android/app/src/main/java/com/psyclefinder/app/tips/PsyncTips.java');
  const IDS = ['com.psyclefinder.app.tip.small', 'com.psyclefinder.app.tip.medium', 'com.psyclefinder.app.tip.large'];
  const idsIn = (src, what) => {
    const a = src.indexOf('// ── tip-products:start'); const b = src.indexOf('// ── tip-products:end');
    if (a === -1 || b === -1) throw new Error('24-tip-jar: no tip-products markers in ' + what + ' (anchor moved?)');
    return src.slice(a, b).match(/com\.psyclefinder\.app\.tip\.[a-z]+/g) || [];
  };

  t.section('Tip jar: one allow-list, three ids, the same on every side');
  {
    const P = t.loadPure('js/tabs.js', 'tips');
    eq(P.TIP_PRODUCTS.map((x) => x.id), IDS, 'js/tabs.js: the three tips, cheapest first');
    eq([idsIn(swift, 'TipJarPlugin.swift'), idsIn(javaTips, 'PsyncTips.java')], [IDS, IDS], 'the iPhone plugin and the Android twin hold the same three, in the same order');
    eq([P._isTipId(IDS[1]), P._isTipId('com.psyclefinder.app.pro'), P._isTipId(''), P._isTipId(undefined)], [true, false, false, false], 'nothing else is a tip');
    ok(/PsycleTipProducts\.ids\.contains\(id\)/.test(swift) && /PsyncTips\.isTip\(id\)/.test(javaPlugin), 'each native side checks the id it is handed against its own list before anything else');
  }

  t.section('Tip jar: what the store answered → the rows drawn');
  {
    const P = t.loadPure('js/tabs.js', 'tips');
    const rows = (answer) => JSON.parse(JSON.stringify(P._tipRows(answer)));
    eq(rows({ products: [{ id: IDS[2], displayPrice: '£9.99' }, { id: IDS[0], displayPrice: ' £1.99 ' }] }),
      [{ id: IDS[0], label: 'Small tip', price: '£1.99' }, { id: IDS[2], label: 'Large tip', price: '£9.99' }],
      'in OUR order whatever the store\'s, prices trimmed, a product the store did not return simply absent');
    eq(rows({ products: [{ id: 'com.psyclefinder.app.pro', displayPrice: '£49' }, { id: IDS[1] }, { id: IDS[0], displayPrice: 199 }, null] }), [],
      'a product we do not sell, one with no price and one whose price is not text are all dropped');
    eq([rows(null), rows({}), rows({ products: 'x' }), rows({ products: [] })], [[], [], [], []], 'no answer, or a malformed one: no rows (the section stays hidden)');
    eq(rows({ products: [{ id: IDS[0], displayPrice: 'x'.repeat(25) }] }), [], 'a "price" longer than any real one is not printed');
    eq([P._tipOutcome('purchased'), P._tipOutcome('pending'), P._tipOutcome('cancelled')].map((x) => x && x.text),
      ['Thank you. Your tip went through.', 'Thank you. Your tip is waiting for approval.', null], 'thanks when it went through, the truth when it is pending, nothing when the member closed the sheet');
    eq(['failed', 'unavailable', undefined, 'anything'].map((s) => P._tipOutcome(s).text), Array(4).fill('Couldn\'t complete that tip. Try again later.'), 'every other status: one plain sentence');
  }

  t.section('Tip jar: the section — native only, never empty, the price as text, one purchase at a time');
  {
    const from = tabs.indexOf('  // ── pure:tips:start'); const to = tabs.indexOf('\n  document.addEventListener(\'click\', function (e) {\n    var t = e.target;\n    var row = t && typeof t.closest');
    if (from === -1 || to === -1) throw new Error('24-tip-jar: cannot slice the tip section (anchor moved?)');
    const world = (opts) => {
      opts = opts || {};
      const box = { style: { display: 'none' } }; const list = { innerHTML: '' };
      const toasts = []; const asked = []; let release = null;
      const jar = opts.noPlugin ? null : {
        products: () => { asked.push('products'); return opts.productsThrow ? Promise.reject(new Error('x')) : Promise.resolve(opts.answer); },
        purchase: (a) => { asked.push(a); return new Promise((res) => { release = () => res(opts.result); }); },
      };
      const win = {};
      if (!opts.web) win.Capacitor = { isNativePlatform: () => true, Plugins: jar ? { PsycleTipJar: jar } : {} };
      const ctx = vm.createContext({ window: win, document: { getElementById: (id) => (id === 'supportPsync' ? box : id === 'supportPsyncTips' ? list : null) },
        escapeHTML: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
        toast: (m, k) => toasts.push([m, k]), Promise, Array, String, console });
      vm.runInContext(tabs.slice(from, to), ctx, { filename: 'js/tabs.js[tip section]' });
      return { ctx, box, list, toasts, asked, release: () => release && release() };
    };
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const answer = { products: IDS.map((id, i) => ({ id, displayPrice: ['£1.99', '£4.99', '£9.99'][i] })) };

    const web = world({ web: true, answer }); web.ctx.renderSupportPsync(); await tick();
    eq([web.box.style.display, web.asked], ['none', []], 'the web app: hidden, and the store is never asked');
    const bare = world({ noPlugin: true }); bare.ctx.renderSupportPsync(); await tick();
    eq(bare.box.style.display, 'none', 'a native app without the plugin (an older build): hidden');
    const none = world({ answer: { products: [] } }); none.ctx.renderSupportPsync(); await tick();
    eq([none.box.style.display, none.list.innerHTML], ['none', ''], 'the plugin is there but the store has no products yet: hidden, not an empty section');
    const broke = world({ productsThrow: true }); broke.ctx.renderSupportPsync(); await tick();
    eq(broke.box.style.display, 'none', 'the store could not be asked: hidden');

    const w = world({ answer, result: { status: 'purchased' } });
    w.ctx.renderSupportPsync(); w.ctx.renderSupportPsync(); await tick();
    eq([w.box.style.display, w.asked, (w.list.innerHTML.match(/data-tip-id="/g) || []).length], ['', ['products'], 3], 'three rows, and the store asked ONCE however often Membership renders');
    ok(/<span class="ms-row-label">Small tip<\/span><\/span><span class="ms-row-price">£1\.99<\/span>/.test(w.list.innerHTML), 'a row: our label, the store\'s price');
    const evil = world({ answer: { products: [{ id: IDS[0], displayPrice: '<img src=x>' }] } }); evil.ctx.renderSupportPsync(); await tick();
    ok(evil.list.innerHTML.indexOf('<img') === -1 && evil.list.innerHTML.indexOf('&lt;img src=x&gt;') !== -1, 'the price is printed as TEXT, whatever the store sends');

    const first = w.ctx._leaveTip(IDS[1]); await tick();
    ok(/ disabled>/.test(w.list.innerHTML), 'while the store\'s sheet is up the rows are disabled');
    await w.ctx._leaveTip(IDS[2]); await w.ctx._leaveTip('com.psyclefinder.app.pro');
    w.release(); await first;
    eq([w.asked.slice(1), w.toasts, / disabled>/.test(w.list.innerHTML)], [[{ productId: IDS[1] }], [['Thank you. Your tip went through.', 'success']], false],
      'ONE purchase went to the plugin — the second tap and the id we do not sell were ignored — then thanks, and the rows come back');
    const shut = world({ answer, result: { status: 'cancelled' } }); shut.ctx.renderSupportPsync(); await tick();
    const p2 = shut.ctx._leaveTip(IDS[0]); await tick(); shut.release(); await p2;
    eq(shut.toasts, [], 'the member closed the store\'s sheet: nothing is said');
  }

  t.section('Tip jar: no other way of paying, anywhere in the app');
  {
    const jsFiles = fs.readdirSync(path.join(root, 'js')).filter((f) => /\.js$/.test(f)).map((f) => 'js/' + f);
    const shipped = jsFiles.concat(['ios-app/www/native-bridge.js', 'psycle-finder.html', 'login.html', 'privacy.html', 'support.html']);
    const PAY = /buymeacoffee|ko-fi\.com|patreon\.com|paypal\.(com|me)|stripe\.com|donate\b|gofundme|github\.com\/sponsors/i;
    eq(shipped.filter((f) => PAY.test(read(f))), [], 'no shipped file names a donation or payment service: tips go through the store, and nothing links out');
    ok(/A tip is a thank-you, and unlocks nothing\./.test(tabs), 'the section says what a tip is: a thank-you that unlocks nothing');
    ok(/If you leave a tip/.test(read('privacy.html')) && /never sees your card or payment details/.test(read('privacy.html')), 'privacy.html says who takes a tip (the store) and what Psync sees of it (nothing)');
    const listing = read('ios-app/APP_STORE_LISTING.md');
    eq(IDS.filter((id) => listing.indexOf('`' + id + '`') === -1), [], 'the App Store listing names the three product ids exactly, for whoever creates them in App Store Connect');
    eq(IDS.filter((id) => read('ios-app/PLAY_STORE_DEPLOY.md').indexOf('`' + id + '`') === -1), [], '…and so does the Play runbook');
  }

  t.section('Tip jar: the native sides, as far as they can be read');
  {
    ok(/guard case \.verified\(let transaction\) = verification else \{\s*call\.resolve\(\["status": "failed"\]\)/.test(swift) && /await transaction\.finish\(\)\s*call\.resolve\(\["status": "purchased"\]\)/.test(swift),
      'iPhone: an UNVERIFIED transaction is never thanked; a verified one is finished before "purchased" is said');
    ok(/for await result in Transaction\.updates/.test(swift) && /if case \.verified\(let transaction\) = result, PsycleTipProducts\.ids\.contains\(transaction\.productID\)/.test(swift),
      'iPhone: a tip approved later (Ask to Buy) is finished too — verified, and only ours');
    ok(/registerPluginInstance\(PsycleTipJarPlugin\(\)\)/.test(read('ios-app/ios/App/App/MainViewController.swift')) && (read('ios-app/ios/App/PsycleBookingBuddy.xcodeproj/project.pbxproj').match(/TipJarPlugin\.swift in Sources/g) || []).length === 2,
      'iPhone: the plugin is registered, and its file is in the app target\'s sources');
    ok(/registerPlugin\(PsycleTipJarPlugin\.class\);/.test(read('ios-app/android/app/src/main/java/com/psyclefinder/app/MainActivity.java')) && /@CapacitorPlugin\(name = "PsycleTipJar"\)/.test(javaPlugin),
      'Android: registered before super.onCreate, under the same JavaScript name');
    ok(/consumeAsync\(/.test(javaPlugin) && /PsyncTips\.allTips\(purchase\.getProducts\(\)\)/.test(javaPlugin), 'Android: a purchased tip is consumed, and only a purchase made ENTIRELY of tips is touched');
    const tokenUses = (javaPlugin.match(/getPurchaseToken\(\)/g) || []).length;
    ok(tokenUses === 1 && /setPurchaseToken\(purchase\.getPurchaseToken\(\)\)/.test(javaPlugin) && !/Log\.|Logger\.|System\.out/.test(javaPlugin) && !/put\("(token|orderId|purchaseToken)"/.test(javaPlugin),
      'Android: the purchase token goes to consumeAsync and nowhere else — not to the page, not to a log');
    ok(!/\bimport android\.|\bimport androidx\.|com\.android\./.test(javaTips), 'Android: the allow-list class is pure java.*, so the JVM tests run the real code');
    const gradle = read('ios-app/android/app/build.gradle');
    eq((gradle.match(/^\s*(implementation|api)\s+"[^"]+"/gm) || []).map((l) => l.trim()).filter((l) => !/androidx\.|\$/.test(l)), ['implementation "com.android.billingclient:billing:8.0.0"'],
      'Android: the ONE runtime dependency the app adds to what Capacitor brings is Play\'s Billing Library');
  }
};
