'use strict';
// The Android project (ios-app/android/ — the folder name ios-app/ is historical: both platforms wrap the
// same ios-app/www/). Nothing here can run Gradle, so this suite holds what can be read:
//   • the project is committed, and its ids equal capacitor.config.json's appId;
//   • the manifest keeps the app's data out of backups — BOTH rule files are read, domain by domain — allows
//     no cleartext traffic, exports the launcher activity and nothing else, answers no URL scheme, is locked
//     to portrait, and every resource it names exists;
//   • MainActivity hands the hardware / gesture BACK to the web layer (window._psycleAndroidBack) and then
//     sends the task to the background — it never finishes the activity; and it re-reads its night-aware
//     colours when the system flips light / dark under a live activity;
//   • no signing material is tracked (*.jks, *.keystore, *.p12, *.pfx, keystore.properties), none can be, and
//     no password is written into a Gradle file;
//   • `npm run sync` (what Xcode Cloud runs) is still iOS-only, the Android scripts exist, and package.json
//     still agrees with the lockfile (`npm ci` refuses otherwise);
//   • ci.yml compiles a debug APK, the emulator smoke is advisory and never taps, the bootstrap workflow is gone;
//   • every XML under app/src/main/res parses, and every file there has a name aapt accepts;
//   • every @type/name a resource, the manifest or MainActivity names resolves inside res/ (aapt stops at the
//     first one that does not), and what the BRIDGE names is there: the notification icon and its tint
//     (ios-app/www/native-bridge.js ↔ res/drawable ↔ capacitor.config.json), the calendar permissions.
// The XML reader below is small and strict on purpose; its first section proves it can fail.
module.exports = function (t) {
  const { ok, eq, fs, path, REPO_ROOT } = t;
  const ANDROID = 'ios-app/android';
  const MAIN = ANDROID + '/app/src/main';
  const RES = MAIN + '/res';
  const abs = (rel) => path.join(REPO_ROOT, rel);
  const has = (rel) => fs.existsSync(abs(rel));
  const read = (rel) => (has(rel) ? t.readSource(rel) : '');

  // ── A strict, dependency-free XML reader ─────────────────────────────────
  // Returns { root, elements: [{ name, attrs, parent }] } (parent = the enclosing element's name, '' for the
  // root) or throws with a line number. It knows what an Android
  // resource needs: a declaration, comments, CDATA, elements, quoted attributes, the five built-in entities
  // and namespace prefixes (aapt2 stops at an "unbound prefix").
  function parseXml(text) {
    const n = text.length;
    let i = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
    const fail = (msg) => { throw new Error(msg + ' (line ' + text.slice(0, i).split('\n').length + ')'); };
    const NAME = /[A-Za-z_][\w.\-]*(?::[A-Za-z_][\w.\-]*)?/y;
    const entities = (s) => { if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9A-Fa-f]+);)/.test(s)) fail('a bare "&" or an unknown entity'); };
    const ws = (j) => { while (j < n && /\s/.test(text[j])) j++; return j; };
    const stack = [];      // open elements: { name, prefixes }
    const elements = [];
    let root = null, rootClosed = false;
    const bound = (prefix) => prefix === 'xml' || stack.some((e) => e.prefixes.indexOf(prefix) !== -1);

    if (text.startsWith('<?xml', i)) {
      const e = text.indexOf('?>', i);
      if (e === -1) fail('unterminated XML declaration');
      i = e + 2;
    }
    while (i < n) {
      const lt = text.indexOf('<', i);
      const chunk = text.slice(i, lt === -1 ? n : lt);
      if (chunk) {
        if (!stack.length && /\S/.test(chunk)) fail('text outside the root element');
        entities(chunk);
      }
      if (lt === -1) break;
      i = lt;
      if (text.startsWith('<!--', i)) {
        const e = text.indexOf('-->', i + 4);
        if (e === -1) fail('unterminated comment');
        if (text.slice(i + 4, e).indexOf('--') !== -1) fail('"--" inside a comment');
        i = e + 3; continue;
      }
      if (text.startsWith('<![CDATA[', i)) {
        if (!stack.length) fail('CDATA outside the root element');
        const e = text.indexOf(']]>', i);
        if (e === -1) fail('unterminated CDATA');
        i = e + 3; continue;
      }
      if (text.startsWith('<?', i)) {
        if (/^<\?xml\s/i.test(text.slice(i, i + 6))) fail('an XML declaration that is not at the very start');
        const e = text.indexOf('?>', i);
        if (e === -1) fail('unterminated processing instruction');
        i = e + 2; continue;
      }
      if (text.startsWith('<!', i)) fail('a DOCTYPE or declaration, which no Android resource carries');
      if (text[i + 1] === '/') {
        NAME.lastIndex = i + 2;
        const m = NAME.exec(text);
        if (!m) fail('a malformed end tag');
        const j = ws(NAME.lastIndex);
        if (text[j] !== '>') fail('a malformed end tag </' + m[0]);
        const open = stack.pop();
        if (!open || open.name !== m[0]) fail('</' + m[0] + '> closes ' + (open ? '<' + open.name + '>' : 'nothing'));
        if (!stack.length) rootClosed = true;
        i = j + 1; continue;
      }
      NAME.lastIndex = i + 1;
      const m = NAME.exec(text);
      if (!m) fail('a "<" that opens no tag');
      if (rootClosed) fail('a second root element <' + m[0] + '>');
      const el = { name: m[0], attrs: {}, prefixes: [] };
      let j = NAME.lastIndex, selfClosing = false;
      for (;;) {
        const before = j;
        j = ws(j);
        if (j >= n) { i = j; fail('unterminated <' + el.name + '>'); }
        if (text[j] === '>') { j++; break; }
        if (text[j] === '/' && text[j + 1] === '>') { selfClosing = true; j += 2; break; }
        i = j;
        if (j === before) fail('no space before an attribute of <' + el.name + '>');
        NAME.lastIndex = j;
        const a = NAME.exec(text);
        if (!a) fail('a malformed attribute in <' + el.name + '>');
        j = ws(NAME.lastIndex);
        if (text[j] !== '=') fail('attribute ' + a[0] + ' has no value');
        j = ws(j + 1);
        const q = text[j];
        if (q !== '"' && q !== "'") fail('attribute ' + a[0] + ' is not quoted');
        const e = text.indexOf(q, j + 1);
        if (e === -1) fail('attribute ' + a[0] + ' is unterminated');
        const value = text.slice(j + 1, e);
        if (value.indexOf('<') !== -1) fail('"<" inside attribute ' + a[0]);
        entities(value);
        if (Object.prototype.hasOwnProperty.call(el.attrs, a[0])) fail('attribute ' + a[0] + ' appears twice on <' + el.name + '>');
        el.attrs[a[0]] = value;
        if (a[0].indexOf('xmlns:') === 0) el.prefixes.push(a[0].slice(6));
        j = e + 1;
      }
      i = j;
      stack.push(el);
      [el.name].concat(Object.keys(el.attrs)).forEach((name) => {
        const colon = name.indexOf(':');
        if (colon !== -1 && name.indexOf('xmlns:') !== 0 && !bound(name.slice(0, colon))) fail('unbound prefix "' + name.slice(0, colon) + ':" on <' + el.name + '>');
      });
      if (!root) root = el;
      elements.push({ name: el.name, attrs: el.attrs, parent: stack.length > 1 ? stack[stack.length - 2].name : '' });
      if (selfClosing) { stack.pop(); if (!stack.length) rootClosed = true; }
    }
    if (stack.length) fail('<' + stack[stack.length - 1].name + '> is never closed');
    if (!root) fail('no root element');
    return { root: { name: root.name, attrs: root.attrs }, elements };
  }
  const parses = (text) => { try { parseXml(text); return true; } catch (e) { return e.message; } };

  t.section('Android: the XML reader this suite uses can fail');
  {
    const A = ' xmlns:android="http://schemas.android.com/apk/res/android"';
    eq(parses('<?xml version="1.0" encoding="utf-8"?>\n<!-- c -->\n<a' + A + ' android:x="1 &amp; 2">\n  <b android:y=\'z\'/>t<![CDATA[ < & ]]>\n</a>\n'), true, 'a well-formed document parses');
    const bad = {
      'a tag closed by another': '<a><b></a></b>',
      'an element never closed': '<a><b></b>',
      'an unquoted attribute': '<a x=1/>',
      'an attribute twice': '<a x="1" x="2"/>',
      'an unbound prefix (aapt2 stops at it)': '<a android:x="1"/>',
      'a bare ampersand': '<a>Tom & Jerry</a>',
      'a second root': '<a/><b/>',
      'text after the root': '<a/>stray',
      'an unterminated comment': '<a><!-- </a>',
      'a declaration that is not first': '\n<?xml version="1.0"?><a/>',
      'an empty file': '  \n',
    };
    Object.keys(bad).forEach((what) => ok(parses(bad[what]) !== true, 'it refuses ' + what));
    const doc = parseXml('<m' + A + '><application android:allowBackup="false"><activity android:name=".Main"/></application></m>');
    eq(doc.elements.map((e) => e.name), ['m', 'application', 'activity'], 'it lists the elements in document order');
    eq(doc.elements[1].attrs['android:allowBackup'], 'false', '…with their attributes');
    eq(doc.elements.map((e) => e.parent), ['', 'm', 'application'], '…and each one\'s parent');
  }

  // Java with comments out and string / char literals blanked or kept. A "//" inside a string is not a comment.
  function javaCode(src, keepStrings) {
    let out = '', i = 0;
    while (i < src.length) {
      const c = src[i], d = src[i + 1];
      if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e === -1 ? src.length : e + 2; out += ' '; continue; }
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
        out += keepStrings ? src.slice(i, j + 1) : c + c;
        i = j + 1; continue;
      }
      out += c; i++;
    }
    return out;
  }
  {
    const sample = 'a(); // finish()\n/* finish() */ b("https://x // finish()"); c(\'"\');';
    ok(!/finish/.test(javaCode(sample, false)) && /a\(\);/.test(javaCode(sample, false)) && /c\(''\);/.test(javaCode(sample, false)), 'the Java reader drops comments and blanks strings');
    ok(/"https:\/\/x \/\/ finish\(\)"/.test(javaCode(sample, true)), '…and can keep a string whole, a "//" inside it included');
  }

  // ── 1. The project is committed, and it is this app ──────────────────────
  t.section('Android: the generated project is committed, and its ids are the app\'s');
  const config = JSON.parse(t.readSource('ios-app/capacitor.config.json'));
  const appId = config.appId;
  ok(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(appId), 'capacitor.config.json names an appId that is a valid Java package (' + appId + ')');
  eq(config.webDir, 'www', 'both platforms wrap the same ios-app/www/');
  const ACTIVITY = MAIN + '/java/' + appId.split('.').join('/') + '/MainActivity.java';
  const committed = ['settings.gradle', 'build.gradle', 'variables.gradle', 'gradle.properties', 'capacitor.settings.gradle', 'gradlew',
    'gradle/wrapper/gradle-wrapper.jar', 'gradle/wrapper/gradle-wrapper.properties', 'app/build.gradle', 'app/capacitor.build.gradle']
    .map((f) => ANDROID + '/' + f).concat([MAIN + '/AndroidManifest.xml', ACTIVITY]);
  eq(committed.filter((f) => !has(f)), [], 'settings.gradle, app/build.gradle, variables.gradle, the wrapper, the manifest and MainActivity are all there');

  const appGradle = read(ANDROID + '/app/build.gradle');
  const gradleValue = (key) => (new RegExp('^\\s*' + key + '\\s*=?\\s*["\']([^"\']+)["\']', 'm').exec(appGradle) || [])[1];
  eq(gradleValue('namespace'), appId, 'app/build.gradle: namespace is the appId');
  eq(gradleValue('applicationId'), appId, 'app/build.gradle: applicationId is the appId');
  const activitySrc = read(ACTIVITY);
  eq((/^\s*package\s+([\w.]+)\s*;/m.exec(activitySrc) || [])[1], appId, 'MainActivity.java: its package is the appId (and so is its folder)');
  ok(/class\s+MainActivity\s+extends\s+BridgeActivity\b/.test(javaCode(activitySrc, false)) && /^import\s+com\.getcapacitor\.BridgeActivity\s*;/m.test(activitySrc),
    'MainActivity is still Capacitor\'s BridgeActivity');

  const manifestSrc = read(MAIN + '/AndroidManifest.xml');
  let manifest = null;
  try { manifest = parseXml(manifestSrc); } catch (e) { ok(false, 'AndroidManifest.xml parses — ' + e.message); }
  const first = (name) => (manifest ? manifest.elements.filter((e) => e.name === name)[0] : null) || { attrs: {} };
  if (manifest) {
    ok(manifest.root.name === 'manifest' && (manifest.root.attrs.package === undefined || manifest.root.attrs.package === appId),
      'AndroidManifest.xml: no package attribute of its own, or the appId (the namespace comes from Gradle)');
    ok(manifest.elements.some((e) => e.name === 'activity' && e.attrs['android:name'] === '.MainActivity' && e.attrs['android:exported'] === 'true'),
      '…and .MainActivity is the exported launcher activity');
  }

  const strings = {};   // (whether strings.xml is well-formed is the last section's business)
  read(RES + '/values/strings.xml').replace(/<string\s+name="([^"]+)"[^>]*>([^<]*)<\/string>/g, (all, name, value) => { strings[name] = value; return all; });
  eq(strings.app_name, config.appName, 'strings.xml: app_name is capacitor.config.json\'s appName');
  eq([strings.package_name, strings.custom_url_scheme], [appId, appId], 'strings.xml: package_name and custom_url_scheme are the appId');

  // variables.gradle: what the code may call (compile) is never below what the app says it was tested on (target).
  const vars = {};
  read(ANDROID + '/variables.gradle').replace(/^\s*(\w+)\s*=\s*(\d+)\s*$/gm, (all, k, v) => { vars[k] = +v; return all; });
  ok(vars.minSdkVersion >= 22 && vars.targetSdkVersion >= 34 && vars.compileSdkVersion >= vars.targetSdkVersion,
    'variables.gradle: minSdk ≥ 22, targetSdk ≥ 34, compileSdk ≥ targetSdk (' + [vars.minSdkVersion, vars.targetSdkVersion, vars.compileSdkVersion].join(' / ') + ')');
  // Every native module Gradle is told to include comes from a package that ios-app/package.json installs.
  const pkg = JSON.parse(t.readSource('ios-app/package.json'));
  const deps = Object.keys(pkg.dependencies);
  const included = [];
  read(ANDROID + '/capacitor.settings.gradle').replace(/new File\('\.\.\/node_modules\/((?:@[^/']+\/)?[^/']+)\//g, (all, name) => { included.push(name); return all; });
  ok(included.indexOf('@capacitor/android') !== -1, 'capacitor.settings.gradle includes the Capacitor Android runtime');
  eq(included.filter((name) => deps.indexOf(name) === -1), [], '…and only modules of packages that are dependencies');

  // ── 2. The manifest ──────────────────────────────────────────────────────
  // The Capacitor template ships allowBackup="true" and names no backup rules, so a regenerated project fails
  // here until its manifest is put right again. The member's token and history live in the app's storage; a
  // cloud backup or a device-to-device copy must not carry them (allowBackup alone does not stop the second
  // from Android 12 on — hence the rules files).
  t.section('Android manifest: no backup of the app\'s data, no cleartext traffic, every named resource exists');
  const application = first('application').attrs;
  eq(application['android:allowBackup'], 'false', '<application android:allowBackup="false">');
  ok(application['android:usesCleartextTraffic'] !== 'true', 'usesCleartextTraffic is not "true"');
  ok(!/cleartextTrafficPermitted\s*=\s*["']true["']/.test(fs.existsSync(abs(RES + '/xml')) ? fs.readdirSync(abs(RES + '/xml')).map((f) => read(RES + '/xml/' + f)).join('\n') : ''),
    '…and no network-security file permits it either');
  // BOTH attributes, and what the files SAY. allowBackup alone stops nothing from Android 12 on: only
  // dataExtractionRules keeps the token's ciphertext and the backup of its key out of a phone-to-phone
  // transfer. A rule file that names four domains of five, or gains one <include>, reads as "backups off" to
  // anyone who only checks that it exists.
  const backupAttrs = ['android:fullBackupContent', 'android:dataExtractionRules'];
  const backupRefs = backupAttrs.map((a) => application[a]).filter((v) => /^@xml\//.test(v || ''));
  eq(backupAttrs.filter((a) => !/^@xml\//.test(application[a] || '')), [], 'it names BOTH rule files: android:fullBackupContent (Android 6 to 11) and android:dataExtractionRules (Android 12+, the only thing that stops a device-to-device transfer)');
  eq(backupRefs.filter((ref) => !has(RES + '/xml/' + ref.slice(5) + '.xml')), [], '…and each of those files exists under res/xml/');
  const DOMAINS = ['database', 'external', 'file', 'root', 'sharedpref'];
  // What one section of a rule file lets out: [] when it excludes all five domains whole and includes nothing.
  const leaks = (doc, section) => {
    const inside = doc.elements.filter((e) => e.parent === section);
    const whole = inside.filter((e) => e.name === 'exclude' && (e.attrs.path === '.' || e.attrs.path === '' || e.attrs.path === undefined)).map((e) => e.attrs.domain);
    return DOMAINS.filter((d) => whole.indexOf(d) === -1).map((d) => section + ': ' + d + ' is not excluded whole')
      .concat(inside.filter((e) => e.name !== 'exclude').map((e) => section + ': <' + e.name + '>'));
  };
  const ruleDoc = (attr) => { try { return parseXml(read(RES + '/xml/' + String(application[attr] || '').slice(5) + '.xml')); } catch (e) { return null; } };
  const fullBackup = ruleDoc('android:fullBackupContent');
  const extraction = ruleDoc('android:dataExtractionRules');
  ok(!!fullBackup && fullBackup.root.name === 'full-backup-content' && !!extraction && extraction.root.name === 'data-extraction-rules', 'both parse, as <full-backup-content> and <data-extraction-rules>');
  if (fullBackup && extraction) {
    eq(leaks(fullBackup, 'full-backup-content'), [], 'backup_rules.xml excludes root, file, database, sharedpref and external, each whole (path "."), and includes nothing');
    eq(leaks(extraction, 'cloud-backup').concat(leaks(extraction, 'device-transfer')), [], 'data_extraction_rules.xml does the same under <cloud-backup> AND under <device-transfer>');
    eq(extraction.elements.filter((e) => e.parent === 'data-extraction-rules').map((e) => e.name).sort(), ['cloud-backup', 'device-transfer'], '…and has exactly those two sections');
    eq(fullBackup.elements.concat(extraction.elements).filter((e) => e.name === 'include').length, 0, 'no <include> anywhere: one would turn "exclude these" into "back up only that"');
    const holed = parseXml('<data-extraction-rules><cloud-backup><exclude domain="root" path="."/><exclude domain="file" path="."/><exclude domain="database" path="."/><exclude domain="sharedpref" path="token.xml"/><exclude domain="external" path="."/></cloud-backup></data-extraction-rules>');
    eq([leaks(holed, 'cloud-backup'), leaks(holed, 'device-transfer').length], [['cloud-backup: sharedpref is not excluded whole'], 5], '(the check can fail: one domain excluded only in part, and a section that is missing)');
  }

  // The launcher activity is the ONLY door: one exported component, no service or receiver of the app's own
  // (the plugins merge theirs in at build time), and no URL scheme or host for another app to call.
  if (manifest) {
    eq(manifest.elements.filter((e) => e.attrs['android:exported'] === 'true').map((e) => e.name + ' ' + e.attrs['android:name']), ['activity .MainActivity'], 'exactly one component is exported: the launcher activity');
    eq(manifest.elements.filter((e) => ['activity', 'activity-alias', 'service', 'receiver', 'provider'].indexOf(e.name) !== -1 && e.attrs['android:exported'] === undefined).map((e) => e.name), [],
      '…and every component says so itself (from Android 12 a component with an intent filter and no android:exported stops the install)');
    eq(manifest.elements.filter((e) => e.name === 'service' || e.name === 'receiver' || e.name === 'activity-alias').map((e) => e.name), [], 'the app declares no service, receiver or alias of its own');
    eq(manifest.elements.filter((e) => e.name === 'data').map((e) => Object.keys(e.attrs).join(' ')), [], 'no intent filter carries a <data> element: no custom URL scheme, no host, nothing BROWSABLE');
    eq(manifest.elements.filter((e) => e.name === 'category').map((e) => e.attrs['android:name']), ['android.intent.category.LAUNCHER'], '…its one filter is MAIN / LAUNCHER');
    const launcher = manifest.elements.filter((e) => e.name === 'activity' && e.attrs['android:name'] === '.MainActivity')[0] || { attrs: {} };
    eq(launcher.attrs['android:screenOrientation'], 'portrait', 'the activity is locked to portrait, as the iPhone app (Info.plist) and manifest.json are: the page has no landscape layout');
    ok(/(^|\|)uiMode(\||$)/.test(launcher.attrs['android:configChanges'] || ''), '…and keeps uiMode in configChanges: a light / dark flip must not recreate it (the web view would reload under a request in flight)');
  }

  // Every resource the manifest names resolves: a file for @xml / @mipmap / @drawable / @layout, an entry of
  // values/strings.xml for @string. (@style and @color may come from a library, so they are not checked.)
  const resDirs = has(RES) ? fs.readdirSync(abs(RES)).filter((d) => fs.statSync(abs(RES + '/' + d)).isDirectory()) : [];
  const fileResource = (type, name) => resDirs.some((d) => (d === type || d.indexOf(type + '-') === 0) &&
    fs.readdirSync(abs(RES + '/' + d)).some((f) => f.split('.')[0] === name));
  const refs = [];
  if (manifest) manifest.elements.forEach((e) => Object.keys(e.attrs).forEach((a) => { const m = /^@(xml|mipmap|drawable|layout|string)\/(.+)$/.exec(e.attrs[a]); if (m) refs.push(m); }));
  ok(refs.length >= 5, 'the manifest names resources (' + refs.length + ')');
  eq(refs.filter((m) => (m[1] === 'string' ? strings[m[2]] === undefined : !fileResource(m[1], m[2]))).map((m) => m[0]), [], '…and every one of them exists (aapt stops at "resource not found")');

  // ── 3. BACK ──────────────────────────────────────────────────────────────
  // The template's MainActivity is an empty BridgeActivity, and Capacitor without the App plugin finishes the
  // activity on back — the app would close from any sheet. So a regenerated project fails here too.
  t.section('Android BACK: MainActivity asks window._psycleAndroidBack, then moves the task back — it never finishes');
  // Every Java source of the app's package is read, so a callback moved into a class of its own is still held.
  const javaDir = path.dirname(ACTIVITY);
  const javaSrc = (has(javaDir) ? fs.readdirSync(abs(javaDir)).filter((f) => /\.java$/.test(f)).sort() : []).map((f) => read(javaDir + '/' + f)).join('\n');
  const code = javaCode(javaSrc, false);
  const codeWithStrings = javaCode(javaSrc, true).replace(/"\s*\+\s*"/g, '');   // "a " + "b" reads as one literal
  ok(/^import\s+androidx\.activity\.OnBackPressedCallback\s*;/m.test(javaSrc) && /\bOnBackPressedCallback\s*\(\s*true\s*\)|\bsuper\s*\(\s*true\s*\)/.test(code),
    'it imports androidx.activity.OnBackPressedCallback and makes an enabled one');
  ok(/getOnBackPressedDispatcher\s*\(\s*\)\s*\.addCallback\s*\(/.test(code), '…registered on the activity\'s OnBackPressedDispatcher');
  ok(/handleOnBackPressed\s*\(\s*\)/.test(code), '…with a handleOnBackPressed()');
  ok(/"[^"\n]*window\._psycleAndroidBack\s*\(\s*\)[^"\n]*"/.test(codeWithStrings), 'the script it runs calls window._psycleAndroidBack()');
  ok(/"[^"\n]*_psycleAndroidBack[^"\n]*\?[^"\n]*:\s*false[^"\n]*"/.test(codeWithStrings), '…only when the web layer defines it, and reads false otherwise');
  ok(/\bevaluateJavascript\s*\(|\beval\s*\(/.test(code), '…in the WebView (evaluateJavascript, or the bridge\'s eval)');
  ok(/\bmoveTaskToBack\s*\(\s*true\s*\)/.test(code), 'with nothing to close it calls moveTaskToBack(true): the app goes home and stays alive');
  ok(!/\bfinish\w*\s*\(/.test(code), 'it never calls finish(), finishAffinity() or finishAndRemoveTask()');
  ok(!/\.\s*onBackPressed\s*\(\s*\)/.test(code), '…and never falls through to a default onBackPressed(), which finishes');
  // Because BACK never finishes it, one activity lives across many sunsets, and uiMode is in configChanges:
  // the two colours it read once at creation are read again when the system flips.
  const onConfig = (/public\s+void\s+onConfigurationChanged\s*\(\s*Configuration\s+(\w+)\s*\)\s*\{([\s\S]*?)\n {4}\}/.exec(code) || []);
  ok(!!onConfig[0] && new RegExp('super\\s*\\.\\s*onConfigurationChanged\\s*\\(\\s*' + onConfig[1] + '\\s*\\)').test(onConfig[2] || '') && /^import\s+android\.content\.res\.Configuration\s*;/m.test(javaSrc),
    'it overrides onConfigurationChanged (public, as BridgeActivity\'s is) and calls super first');
  ok(/setNavigationBarColor\s*\([^;]*R\.color\.psync_navigation_bar/.test(onConfig[2] || '') && /setBackgroundColor\s*\([^;]*R\.color\.psync_ground/.test(onConfig[2] || ''),
    '…there the navigation bar and the web view\'s ground are read again from the night-aware resources');
  ok(/SDK_INT\s*>=\s*Build\.VERSION_CODES\.O_MR1[\s\S]*setAppearanceLightNavigationBars\s*\([^;]*R\.bool\.psync_light_system_bars/.test(onConfig[2] || '') && /^import\s+androidx\.core\.view\.WindowInsetsControllerCompat\s*;/m.test(javaSrc),
    '…and dark navigation buttons only from API 27, as values-v27/ has it (at 26 the bar is still the ink: dark buttons would vanish on it)');
  ok(!/setStatusBarColor|setAppearanceLightStatusBars/.test(code), 'the status bar is left to the bridge (updateStatusBar colours it per app theme)');

  // ── 4. Signing material ──────────────────────────────────────────────────
  t.section('Android signing: nothing secret is tracked, nothing secret can be, no password in a Gradle file');
  let tracked = null;
  try {
    tracked = require('child_process').execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);
  } catch (e) { tracked = null; }
  // .p12 / .pfx too: a current keytool writes a PKCS12 store whatever the file is called, and ANDROID.md says so.
  const SECRET = /(?:\.jks|\.keystore|\.p12|\.pfx)$|(?:^|\/)(?:keystore|local)\.properties$/i;
  ok(SECRET.test('ios-app/android/release.jks') && SECRET.test('a/b/upload.KEYSTORE') && SECRET.test('ios-app/android/keystore.properties') &&
    SECRET.test('ios-app/upload.p12') && SECRET.test('psync-upload.PFX') &&
    SECRET.test('ios-app/android/local.properties') && !SECRET.test('ios-app/android/gradle.properties') && !SECRET.test('docs/keystore.md') && !SECRET.test('docs/p12.md'), 'the pattern for signing material matches what it should');
  if (tracked) {
    ok(tracked.length > 100, 'git lists the tracked files (' + tracked.length + ')');
    eq(tracked.filter((f) => SECRET.test(f)), [], 'no keystore (*.jks, *.keystore, *.p12, *.pfx), keystore.properties or local.properties is tracked');
    // What `cap sync android` and Gradle write is rebuilt on every machine; a tracked copy would only go stale.
    const GENERATED = [MAIN + '/assets/public/', MAIN + '/assets/capacitor.config.json', MAIN + '/assets/capacitor.plugins.json', MAIN + '/res/xml/config.xml',
      ANDROID + '/capacitor-cordova-android-plugins/', ANDROID + '/.gradle/', ANDROID + '/build/', ANDROID + '/app/build/'];
    eq(tracked.filter((f) => GENERATED.some((g) => f.indexOf(g) === 0)), [], 'nor anything `cap sync android` or Gradle generates (the copied web assets, the config copies, the Cordova shim, build output)');
  } else {
    console.log('  · not a git checkout (or no git): the tracked-files check is skipped here; CI runs it');
  }
  const ignore = t.readSource('.gitignore').split('\n').map((l) => l.trim());
  const IGNORED = ['*.jks', '*.keystore', '*.p12', '*.pfx', 'keystore.properties', 'local.properties'];
  eq(IGNORED.filter((p) => ignore.indexOf(p) === -1), [], 'the root .gitignore ignores *.jks, *.keystore, *.p12, *.pfx, keystore.properties and local.properties ANYWHERE (PSYNC_KEYSTORE_FILE takes a relative path: a keystore one folder up is a natural place for one)');
  const androidIgnore = read(ANDROID + '/.gitignore').split('\n').map((l) => l.trim());
  eq(IGNORED.filter((p) => p !== 'local.properties' && androidIgnore.indexOf(p) === -1), [], '…and so does ios-app/android/.gitignore');
  ok(ignore.indexOf('ios-app/android/.idea/') !== -1, '…and Android Studio\'s project folder');
  // A literal: storePassword "…" / keyPassword = '…' in a .gradle file, or any "…password…=value" line of the
  // tracked gradle.properties. Reading System.getenv(…) or keystoreProperties['storePassword'] is not one.
  const literalPassword = (f) => (/\.properties$/.test(f) ? /^[ \t]*[^#=\n]*password[^=\n]*=[ \t]*\S/mi : /\b(?:storePassword|keyPassword)\s*=?\s*["'][^"']/).test(read(f));
  const gradleFiles = ['build.gradle', 'app/build.gradle', 'variables.gradle', 'gradle.properties'].map((f) => ANDROID + '/' + f);
  eq(gradleFiles.filter(literalPassword), [], 'no Gradle file holds a password as a literal (release signing reads the environment or a git-ignored keystore.properties)');

  // ── 5. npm scripts and the lockfile ──────────────────────────────────────
  t.section('ios-app/package.json: `sync` is still iOS-only, the Android scripts exist, the lockfile still agrees');
  const s = pkg.scripts;
  eq(s.sync, 'node patch-plugins.js && node build.js && npx cap sync ios', '`npm run sync` — what Xcode Cloud\'s ci_post_clone.sh runs — is unchanged');
  eq([s.postinstall, s['build:open'], s.open], ['node patch-plugins.js', 'npm run sync && npx cap open ios', 'npx cap open ios'], '…and so are postinstall, build:open and open');
  ok(/(^|\n)npm run sync(\n|$)/.test(read('ios-app/ios/App/ci_scripts/ci_post_clone.sh')) && !/android/i.test(read('ios-app/ios/App/ci_scripts/ci_post_clone.sh')), 'ci_post_clone.sh runs `npm run sync` and knows nothing of Android');
  eq(Object.keys(s).filter((k) => !/android/.test(k) && /android/i.test(s[k])), [], 'no script without "android" in its name touches the Android project');
  eq(Object.keys(s).filter((k) => /\bcap (?:sync|copy|update)\s*(?:&&|$)/.test(s[k])), [], 'no script runs a bare `cap sync`, which would sync every platform');
  ok(/^node build\.js && npx cap sync android$/.test(s['sync:android'] || ''), '"sync:android" = build the web assets + `cap sync android` (no plugin patch: the patcher edits Swift only)');
  ok(/^npx cap open android$/.test(s['open:android'] || ''), '"open:android" opens Android Studio');
  ok(/^npm run sync:android && /.test(s['android:debug'] || '') && /gradlew assembleDebug\b/.test(s['android:debug'] || ''), '"android:debug" = sync:android, then gradlew assembleDebug');
  const patcher = t.readSource('ios-app/patch-plugins.js');
  const patchedFiles = (patcher.match(/^\s*'[^'\n]+\.\w+': \[$/gm) || []).map((l) => l.trim().slice(1).replace(/': \[$/, ''));
  ok(patchedFiles.length >= 4 && patchedFiles.every((f) => /\.swift$/.test(f)), 'patch-plugins.js (postinstall, so it runs on the Android runner too) patches Swift sources only (' + patchedFiles.length + ' files)');

  const major = (range) => (/(\d+)\./.exec(range || '') || [])[1];
  ok(pkg.dependencies['@capacitor/android'] && major(pkg.dependencies['@capacitor/android']) === major(pkg.dependencies['@capacitor/core']) &&
    major(pkg.dependencies['@capacitor/ios']) === major(pkg.dependencies['@capacitor/core']), '@capacitor/android is a dependency, on the same major as core and ios');
  const lock = JSON.parse(t.readSource('ios-app/package-lock.json'));
  const lockRoot = lock.packages[''];
  eq([lockRoot.dependencies, lockRoot.devDependencies], [pkg.dependencies, pkg.devDependencies], 'package-lock.json\'s root entry lists exactly package.json\'s dependencies and devDependencies (`npm ci` refuses otherwise)');
  eq(deps.concat(Object.keys(pkg.devDependencies)).filter((d) => !lock.packages['node_modules/' + d]), [], '…and pins every one of them');
  eq(Object.keys(lock.packages).filter((k) => k && lock.packages[k].resolved && lock.packages[k].resolved.indexOf('https://registry.npmjs.org/') !== 0), [],
    'every locked package resolves from registry.npmjs.org (Xcode Cloud and GitHub reach nothing else)');

  // ── 6. CI ────────────────────────────────────────────────────────────────
  t.section('CI: a debug APK is compiled, the emulator smoke is advisory and never taps, the bootstrap is gone');
  ok(!has('.github/workflows/android-bootstrap.yml'), 'the temporary bootstrap workflow is deleted (the project it generated is committed)');
  const ci = t.readSource('.github/workflows/ci.yml');
  const job = (id) => ((new RegExp('\\n {2}' + id + ':[ \\t]*\\n[\\s\\S]*?(?=\\n {2}[A-Za-z_][\\w-]*:[ \\t]*\\n|$)').exec(ci) || [''])[0]).replace(/^[ \t]*#.*$/gm, '');
  const step = (text, name) => { const at = text.indexOf('- name: ' + name); if (at === -1) return ''; const next = text.indexOf('\n      - name:', at + 1); return text.slice(at, next === -1 ? text.length : next); };
  const jobIf = (text) => (/\n {4}if: (.*)/.exec(text) || [])[1] || '';

  const ios = job('ios-build');
  eq(jobIf(ios), "github.event_name == 'workflow_dispatch' || (github.event_name == 'push' && github.ref == 'refs/heads/main')", 'the iOS job runs when it always did');
  ok(/run: npm run sync\n/.test(ios) && !/android/i.test(ios), '…runs the iOS-only `npm run sync`, and nothing Android');

  const build = job('android-build');
  ok(/\n {4}name: Android build check \(debug APK\)\n/.test(build), 'there is a job "Android build check (debug APK)"');
  ok(/\n {4}runs-on: ubuntu-latest\n/.test(build) && !/\n {4}continue-on-error:/.test(build), '…on ubuntu-latest, and it CAN fail the workflow');
  ok(/workflow_dispatch/.test(jobIf(build)) && /github\.ref == 'refs\/heads\/main'/.test(jobIf(build)) && /startsWith\(github\.ref, 'refs\/heads\/android\/'\)/.test(jobIf(build)) && /github\.event_name == 'push'/.test(jobIf(build)),
    '…on pushes to main and to android/** branches, and on manual dispatch');
  ok(/uses: actions\/setup-java@v4[\s\S]*?distribution: temurin[\s\S]*?java-version: 17\b/.test(build) && /uses: actions\/setup-node@v4[\s\S]*?node-version: 20\b/.test(build), 'JDK 17 (temurin) and Node 20');
  ok(/working-directory: ios-app\n\s+run: npm ci\n/.test(build) && /working-directory: ios-app\n\s+run: npm run sync:android\n/.test(build) && !/run: npm run sync\n/.test(build),
    '`npm ci` then `npm run sync:android` in ios-app — never the iOS `npm run sync`');
  ok(build.indexOf('run: npm ci') < build.indexOf('run: npm run sync:android') && build.indexOf('run: npm run sync:android') < build.indexOf('./gradlew assembleDebug'), '…in that order, before Gradle');
  const compile = step(build, 'Compile (debug APK)');
  ok(/working-directory: ios-app\/android\n/.test(compile) && /run: \.\/gradlew assembleDebug\b.*--no-daemon/.test(compile) && !/continue-on-error/.test(compile), '`./gradlew assembleDebug --no-daemon` in ios-app/android, and a compile error fails the job');
  const lint = step(build, 'Android lint');
  ok(/gradlew\b.*\blint\w*\b/i.test(lint) && /continue-on-error: true/.test(lint), 'Android lint runs as its own step and is advisory');
  const apk = step(build, 'Upload the debug APK');
  ok(/uses: actions\/upload-artifact@v4/.test(apk) && /\n\s+name: psync-debug-apk\n/.test(apk) && /retention-days: 30\b/.test(apk) && /if-no-files-found: error/.test(apk) &&
    /path: ios-app\/android\/app\/build\/outputs\/apk\/debug\/app-debug\.apk/.test(apk), 'the APK is uploaded as "psync-debug-apk", kept 30 days, and a missing file is an error');
  ok(build.indexOf('- name: Upload the debug APK') < build.indexOf('- name: Android lint'), '…before lint, so a lint crash cannot lose it');
  ok(/\n {4}permissions:\n {6}contents: read\n/.test(build) && /persist-credentials: false/.test(build), 'read-only token, no credentials left in the checkout');

  const smoke = job('android-smoke');
  ok(/\n {4}name: Android emulator smoke\b/.test(smoke) && /\n {4}needs: android-build\n/.test(smoke), 'there is a job "Android emulator smoke", after the build');
  ok(/\n {4}continue-on-error: true\n/.test(smoke), '…that can never fail the workflow');
  ok(/workflow_dispatch/.test(jobIf(smoke)) && /startsWith\(github\.ref, 'refs\/heads\/android\/'\)/.test(jobIf(smoke)) && !/refs\/heads\/main/.test(jobIf(smoke)), '…on android/** branches and manual dispatch only — not on main');
  ok(/udev\/rules\.d\/99-kvm4all\.rules/.test(smoke) && /udevadm trigger --name-match=kvm/.test(smoke), 'KVM is enabled first');
  ok(/uses: reactivecircus\/android-emulator-runner@[0-9a-f]{40} # v2\.\d+\.\d+[^\n]*\n/.test(smoke) && /api-level: 34\n/.test(smoke) && /arch: x86_64\n/.test(smoke) && /target: google_apis\n/.test(smoke) && /disable-animations: true\n/.test(smoke),
    'android-emulator-runner pinned to a COMMIT of a v2 release (a third-party action: never a moving tag): API 34, x86_64, google_apis, animations off');
  ok(/uses: actions\/download-artifact@v4[\s\S]*?name: psync-debug-apk\n/.test(smoke) && !/actions\/checkout/.test(smoke), 'it installs the build job\'s APK, and the repository is not checked out on that runner');
  const script = ((/\n {10}script: \|\n((?: {12}.*\n?)+)/.exec(smoke) || [])[1] || '').split('\n').map((l) => l.trim()).filter(Boolean);
  ok(script.length >= 8, 'the emulator script is there (' + script.length + ' lines)');
  const at = (re) => script.findIndex((l) => re.test(l));
  ok(at(/^adb install\b.*app-debug\.apk$/) !== -1 && at(new RegExp('^adb shell am start\\b.* -n ' + appId.replace(/\./g, '\\.') + '/\\.MainActivity$')) > at(/^adb install\b/), 'it installs the APK, then starts ' + appId + '/.MainActivity');
  eq(script.filter((l) => /\binput\b/.test(l)), ['adb shell input keyevent 4'], 'the ONLY input it ever sends is one BACK key (keyevent 4)');
  eq(script.filter((l) => /\b(?:tap|swipe|text|draganddrop|motionevent|monkey|uiautomator|instrument)\b/.test(l)), [], '…no tap, swipe, text, monkey or instrumentation: it can book nothing');
  ok(at(/screencap -p > \S*launch\.png$/) !== -1 && at(/screencap -p > \S*launch\.png$/) < at(/input keyevent 4/) && at(/input keyevent 4/) < at(/screencap -p > \S*after-back\.png$/), 'launch.png, then BACK, then after-back.png');
  ok(at(/^sleep 2[0-9]$/) > at(/am start/) && at(/^sleep 2[0-9]$/) < at(/launch\.png/), '…with about 25 s for the app to load before the first picture');
  ok(at(/^adb logcat -d -s 'Capacitor:\*' 'chromium:\*' 'AndroidRuntime:E' > \S+$/) > at(/after-back\.png/), 'the Capacitor, chromium and AndroidRuntime log lines are dumped to a file afterwards');
  eq(script.filter((l) => /\\$/.test(l) || /^(?:if|for|while|case|cd|export|[A-Za-z_]\w*=)\b/.test(l)), [], 'every script line stands alone (the action runs each as its own `sh -c`)');
  const evidenceEnd = at(/logcat -d/);
  ok(evidenceEnd !== -1 && script.slice(0, evidenceEnd + 1).every((l) => !/^!|\bgrep -q\b|\bpidof\b/.test(l)), 'the lines that judge the run (is the process alive, no FATAL EXCEPTION) come after the evidence is gathered');
  const shots = step(smoke, 'Upload the screenshots and the log');
  ok(/if: always\(\)/.test(shots) && /\n\s+name: android-smoke\n/.test(shots), 'the pictures and the log are uploaded as "android-smoke", whatever happened');
  ok(!/\$\{\{/.test(build + smoke) && !/secrets\./.test(build + smoke), 'neither Android job interpolates an expression into a shell, or reads a secret');

  // ── 7. Resources ─────────────────────────────────────────────────────────
  t.section('Android resources: every XML parses, every file has a name aapt accepts');
  const RES_TYPE = /^(?:anim|animator|color|drawable|font|layout|menu|mipmap|navigation|raw|transition|values|xml)(?:-[A-Za-z0-9+]+)*$/;
  eq(resDirs.filter((d) => !RES_TYPE.test(d)), [], 'every folder under res/ is a resource type, with or without qualifiers');
  const resFiles = [];
  resDirs.forEach((d) => fs.readdirSync(abs(RES + '/' + d)).filter((f) => f[0] !== '.').forEach((f) => resFiles.push(d + '/' + f)));
  ok(resFiles.length >= 20, 'res/ holds the launcher icons, the vector drawables, the layout, values and xml (' + resFiles.length + ' files)');
  eq(resFiles.filter((f) => f.indexOf('values') !== 0 && !/^[a-z][a-z0-9_]*(?:\.9)?\.[a-z0-9]+$/.test(f.split('/')[1])), [], 'file-based resources are lowercase_with_underscores (aapt refuses anything else)');
  const xmlFiles = resFiles.filter((f) => /\.xml$/.test(f)).map((f) => RES + '/' + f).concat([MAIN + '/AndroidManifest.xml']);
  ok(xmlFiles.length >= 8, 'there are XML files to read (' + xmlFiles.length + ')');
  eq(xmlFiles.map((f) => { const r = parses(read(f)); return r === true ? null : f.slice(MAIN.length + 1) + ': ' + r; }).filter(Boolean), [], 'every one of them, and the manifest, is well-formed');
  const valueNames = [];
  resFiles.filter((f) => f.indexOf('values') === 0 && /\.xml$/.test(f)).forEach((f) => {
    let doc; try { doc = parseXml(read(RES + '/' + f)); } catch (e) { return; }
    if (doc.root.name !== 'resources') valueNames.push(f + ': root is <' + doc.root.name + '>, not <resources>');
    doc.elements.filter((e) => e.name !== 'resources' && e.name !== 'item' && e.attrs.name !== undefined && !/^[A-Za-z_][\w.]*$/.test(e.attrs.name)).forEach((e) => valueNames.push(f + ': ' + e.attrs.name));
  });
  eq(valueNames, [], 'values files are <resources>, and each entry\'s name is a valid identifier');

  // ── 8. Every reference resolves ──────────────────────────────────────────
  // aapt2 stops at the first "resource … not found", and nobody here can run it. So: what res/ DEFINES (a file
  // for a file-based type, a named entry of a values file) against what the resources, the manifest and the
  // app's Java NAME. Strictly inside res/: a name that only a library ships (the Capacitor library has its own
  // colorPrimary and AppTheme.NoActionBar) fails here too — give the app its own copy, which wins the merge.
  t.section('Android resources: every @type/name that a resource, the manifest or MainActivity names is in res/');
  const defined = {};   // type → { name: true }
  const define = (type, name) => { if (type && name) (defined[type] = defined[type] || {})[name] = true; };
  resFiles.filter((f) => f.indexOf('values') !== 0).forEach((f) => define(f.split('/')[0].split('-')[0], f.split('/')[1].split('.')[0]));
  resFiles.filter((f) => f.indexOf('values') === 0 && /\.xml$/.test(f)).forEach((f) => {
    let doc; try { doc = parseXml(read(RES + '/' + f)); } catch (e) { return; }
    doc.elements.forEach((e) => {
      if (e.name === 'resources' || e.attrs.name === undefined) return;
      if (e.name === 'item') return define(e.attrs.type, e.attrs.name);   // <item type="…"> is an entry; a style's <item> has no type
      define(/-array$|^array$/.test(e.name) ? 'array' : e.name, e.attrs.name);
    });
  });
  eq(['color', 'style', 'string', 'drawable', 'mipmap', 'xml'].filter((type) => !defined[type]), [], 'res/ defines colours, styles, strings, drawables, mipmaps and xml files');
  const isDefined = (type, name) => !!(defined[type] && defined[type][name]);
  // A reference is a whole attribute value or a whole element text: "@color/x", >@drawable/y<. Comments are
  // dropped first (they name resources in prose). @android:…, ?attr/… and @null are the platform's, not ours.
  const references = (src) => {
    const found = [];
    src.replace(/<!--[\s\S]*?-->/g, '').replace(/(["'>])\s*@([a-z]+)\/([A-Za-z_][\w.]*)\s*(?=["'<])/g, (all, open, type, name) => { found.push([type, name]); return all; });
    return found;
  };
  eq(references('<a b="@color/x" c="@android:color/white" d="?attr/y" e="@null"><!-- @drawable/no --><i>@style/P.Q</i> <i> @bool/z </i></a>'),
    [['color', 'x'], ['style', 'P.Q'], ['bool', 'z']], 'the reference reader finds attribute values and element text, and skips comments, @android:, ?attr and @null');
  let refCount = 0;
  const unresolved = [];
  xmlFiles.forEach((f) => references(read(f)).forEach((r) => { refCount++; if (!isDefined(r[0], r[1])) unresolved.push(f.slice(MAIN.length + 1) + ': @' + r[0] + '/' + r[1]); }));
  ok(refCount >= 20, 'the resources and the manifest name each other (' + refCount + ' references)');
  eq(unresolved, [], 'every @drawable / @mipmap / @color / @bool / @style / @string / @xml / @layout reference resolves inside res/');
  // A style whose parent is one of the app's own (AppTheme…) names a style that exists; any other parent
  // (Theme.AppCompat…, Theme.SplashScreen) is a library's.
  const orphanParents = [];
  resFiles.filter((f) => f.indexOf('values') === 0 && /\.xml$/.test(f)).forEach((f) => {
    let doc; try { doc = parseXml(read(RES + '/' + f)); } catch (e) { return; }
    doc.elements.filter((e) => e.name === 'style' && /^AppTheme\b/.test(e.attrs.parent || '') && !isDefined('style', e.attrs.parent)).forEach((e) => orphanParents.push(f + ': ' + e.attrs.name + ' → ' + e.attrs.parent));
  });
  eq(orphanParents, [], '…and so does every parent="AppTheme…" of a style');
  ok(isDefined('style', 'AppTheme.NoActionBar'), 'res/ keeps a style named AppTheme.NoActionBar: BridgeActivity.onCreate switches the activity to it by that name');
  const javaRefs = [];
  code.replace(/(^|[^\w.])R\.([a-z]+)\.(\w+)/g, (all, lead, type, name) => { javaRefs.push([type, name]); return all; });
  const javaNames = (type) => Object.keys(defined[type] || {}).map((n) => n.replace(/\./g, '_'));
  eq(javaRefs.filter((r) => javaNames(r[0]).indexOf(r[1]) === -1).map((r) => 'R.' + r[0] + '.' + r[1]), [], 'every R.<type>.<name> in the app\'s Java is a resource of res/ (' + javaRefs.length + ' named)');

  // ── 9. The seams ─────────────────────────────────────────────────────────
  // Three things were written apart and must agree: the bridge (ios-app/www/native-bridge.js) NAMES a
  // notification icon and a tint and needs the calendar permissions; the project HOLDS the drawable and the
  // manifest; capacitor.config.json repeats the icon and the tint as the plugin-wide default. A wrong icon
  // name is silent (the plugin falls back to its own default); a missing permission is a calendar sync that
  // answers 'denied' without ever asking.
  t.section('Android seams: what the bridge names, the project holds');
  const bridgeSrc = t.readSource('ios-app/www/native-bridge.js');
  const bridgeLiteral = (name) => (new RegExp('\\bvar ' + name + "\\s*=\\s*'([^'\\n]*)'").exec(bridgeSrc) || [])[1];
  const icon = bridgeLiteral('ANDROID_NOTIF_ICON');
  const tint = bridgeLiteral('ANDROID_NOTIF_TINT');
  ok(/^[a-z][a-z0-9_]*$/.test(icon || ''), 'the bridge names its notification small icon as a plain resource name (' + icon + ')');
  ok(fileResource('drawable', icon || ''), '…and res/drawable holds it: a missing one is silent, the plugin shows its own default instead');
  const notifConfig = (config.plugins || {}).LocalNotifications || {};
  eq(notifConfig.smallIcon, icon, 'capacitor.config.json: plugins.LocalNotifications.smallIcon is the same drawable');
  ok(/^#[0-9a-f]{6}$/i.test(tint || '') && /^#[0-9a-f]{6}$/i.test(notifConfig.iconColor || ''), 'the tint is #rrggbb in both places (a colour the plugin cannot parse REJECTS the schedule)');
  eq(String(notifConfig.iconColor).toLowerCase(), String(tint).toLowerCase(), '…and the same colour in both');
  const iconSrc = read(RES + '/drawable/' + icon + '.xml');
  ok(/^<\?xml[^>]*\?>\s*(?:<!--[\s\S]*?-->\s*)*<vector\b/.test(iconSrc) && references(iconSrc).length === 0,
    'the small icon is a vector with literal colours: Android keeps only its alpha, and nothing night-qualified can change it');
  eq(['ANDROID_CHANNEL_CLASSES', 'ANDROID_CHANNEL_NEW_DATES'].map(bridgeLiteral), ['class-reminders', 'new-dates'], 'the two channel ids are the ones the member\'s system settings already file reminders under (renaming one strands what was set)');

  const permissions = manifest ? manifest.elements.filter((e) => e.name === 'uses-permission').map((e) => e.attrs['android:name']) : [];
  eq(['INTERNET', 'READ_CALENDAR', 'WRITE_CALENDAR'].filter((p) => permissions.indexOf('android.permission.' + p) === -1), [],
    'the manifest declares INTERNET, READ_CALENDAR and WRITE_CALENDAR (the calendar plugin\'s own manifest declares nothing)');
  eq(permissions.filter((p) => /EXACT_ALARM/.test(p)), [], '…and no exact-alarm permission: the reminders are inexact by decision, and the member is spared a special-access screen');
  eq(permissions.filter((p, i) => permissions.indexOf(p) !== i), [], '…and none twice');

  // The launch colours are the web app's grounds (js/theme.js APP_THEMES → the same values as css/theme.css):
  // Cloud by day, Graphite by night. capacitor.config.json can only name the day one.
  const themes = t.readSource('js/theme.js');
  const ground = (id) => ((new RegExp("\\{\\s*id:\\s*'" + id + "'[^}]*\\bbg:\\s*'(#[0-9a-fA-F]{6})'").exec(themes) || [])[1] || '').toLowerCase();
  const colourOf = (file, name) => ((new RegExp('<color\\s+name="' + name + '"\\s*>\\s*(#[0-9a-fA-F]{6})\\s*</color>').exec(read(RES + '/' + file)) || [])[1] || '').toLowerCase();
  ok(/^#[0-9a-f]{6}$/.test(ground('cloud')) && /^#[0-9a-f]{6}$/.test(ground('graphite')), 'js/theme.js names Cloud\'s and Graphite\'s grounds (' + ground('cloud') + ' / ' + ground('graphite') + ')');
  eq([colourOf('values/colors.xml', 'psync_ground'), colourOf('values-night/colors.xml', 'psync_ground')], [ground('cloud'), ground('graphite')],
    'the native ground is Cloud\'s by day and Graphite\'s by night, so launch and first paint are one colour');
  eq(String((config.android || {}).backgroundColor).toLowerCase(), ground('cloud'), 'capacitor.config.json: android.backgroundColor is Cloud\'s ground (MainActivity then sets the night-aware one)');
  ok(!('backgroundColor' in config) && !('backgroundColor' in (config.ios || {})), '…and it is under "android" only: the iPhone web view keeps systemBackground');

  // What must never be committed to the config both apps are built from.
  const server = config.server || {};
  ok(server.url === undefined && server.cleartext !== true, 'capacitor.config.json has no server.url and no server.cleartext (a live-reload leftover ships an app that loads a dev machine; cleartext also clashes with the manifest in the merger)');
  ok((config.android || {}).allowMixedContent !== true && (config.android || {}).webContentsDebuggingEnabled !== true && config.webContentsDebuggingEnabled !== true,
    '…no mixed content, and web-view debugging is not forced on (Capacitor\'s default: debug builds only)');
  ok(server.allowNavigation === undefined && server.hostname === undefined,
    '…no server.allowNavigation (a listed origin loads INSIDE the bridged web view, with every plugin in reach) and no server.hostname (the stored data is filed under https://localhost)');
  ok((config.android || {}).loggingBehavior !== 'production' && config.loggingBehavior !== 'production', '…and the bridge\'s own logging is not turned on for release builds (its lines carry plugin call arguments)');
  eq(((config.plugins || {}).Preferences || {}).group, 'PsycleFinderSettings', 'Preferences.group is what it was before there was an Android app: changing it orphans every stored key, on both platforms');
};
