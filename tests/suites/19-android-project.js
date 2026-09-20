'use strict';
// The Android project (ios-app/android/ — the folder name ios-app/ is historical: both platforms wrap the
// same ios-app/www/). Nothing here can run Gradle, so this suite holds what can be read:
//   • the project is committed, and its ids equal capacitor.config.json's appId;
//   • the manifest keeps the app's data out of backups — BOTH rule files are read, domain by domain — allows
//     no cleartext traffic, exports ONE component — the launcher activity; the widget's provider is not —
//     answers no URL scheme, asks for no permission it did not have, is locked to portrait, and every resource
//     it names exists;
//   • MainActivity hands the hardware / gesture BACK to the web layer (window._psycleAndroidBack) and then
//     sends the task to the background — it never finishes the activity; and it re-reads its night-aware
//     colours when the system flips light / dark under a live activity;
//   • no signing material is tracked (*.jks, *.keystore, *.p12, *.pfx, keystore.properties), none can be, and
//     no password is written into a Gradle file;
//   • `npm run sync` (what Xcode Cloud runs) is still iOS-only, the Android scripts exist, and package.json
//     still agrees with the lockfile (`npm ci` refuses otherwise);
//   • ci.yml runs the JVM unit tests (blocking) and then compiles a debug APK; the emulator smoke is advisory,
//     never taps, runs on a phone-sized emulator and photographs the debug-only widget preview in nine states,
//     failing when the preview logs a widget it could not draw; the bootstrap workflow is gone;
//   • every XML under app/src/main/res parses, and every file there has a name aapt accepts;
//   • every @type/name a resource, the manifest or MainActivity names resolves inside res/ (aapt stops at the
//     first one that does not), and what the BRIDGE names is there: the notification icon and its tint
//     (ios-app/www/native-bridge.js ↔ res/drawable ↔ capacitor.config.json), the calendar permissions;
//   • the home-screen widget (level 3), as far as it can be READ: one receiver with APPWIDGET_UPDATE and its
//     provider-info file (updatePeriodMillis ≥ 30 min, home screen only, no configure activity, an
//     initialLayout that claims nothing); every res/layout*/widget_*.xml built from views a launcher may
//     inflate; every one-line style ending in an ellipsis; PsyncWidgetPlan's numbers equal to the layouts';
//     the repaint instant worked out in the pure class and armed in a finally; one pictogram per class-type key of
//     js/app.js; every PendingIntent immutable; an inexact alarm only; the tap an EXPLICIT intent for
//     MainActivity; the three plugins the bridge finds by name (AppGroupPreferences, WidgetCenter,
//     PsycleDeepLink) registered BEFORE super.onCreate, and a repaint asked for at every cold start; a pure
//     snapshot class with JVM tests CI runs; the preview activity in app/src/debug/ ONLY, behind a permission
//     only adb holds; no new runtime dependency, no Kotlin.
// None of that is javac, aapt2 or a launcher: a green run here means "read, not built".
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
  // Returns { root, elements: [{ name, attrs, parent, up }] } (parent = the enclosing element's name, '' for
  // the root; up = its index in elements, -1 for the root) or throws with a line number. It knows what an Android
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
      el.at = elements.length;
      elements.push({ name: el.name, attrs: el.attrs, parent: stack.length > 1 ? stack[stack.length - 2].name : '', up: stack.length > 1 ? stack[stack.length - 2].at : -1 });
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
    eq(doc.elements.map((e) => e.up), [-1, 0, 1], '…by name and by index, so two <intent-filter>s can be told apart');
  }
  // Every element inside `el`, at any depth.
  const within = (doc, el) => {
    const top = doc.elements.indexOf(el);
    return top === -1 ? [] : doc.elements.filter((e) => { for (let u = e.up; u !== -1; u = doc.elements[u].up) if (u === top) return true; return false; });
  };

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

  // The launcher activity is the ONLY door for another app: no service of the app's own (the plugins merge
  // theirs in at build time), no URL scheme or host to call. Level 3 adds ONE receiver, the widget's provider,
  // and it is NOT exported: the widget broadcasts come from the system's widget service, which may send to any
  // receiver, and the app's own refresh and alarm are sent as the app (Android's widget guide declares a
  // provider exported="false"). The widget section below holds what its filter may say. A tap on the widget is
  // an explicit intent for MainActivity: no new filter.
  if (manifest) {
    eq(manifest.elements.filter((e) => e.attrs['android:exported'] === 'true').map((e) => e.name + ' ' + e.attrs['android:name']), ['activity .MainActivity'],
      'ONE component is exported, the launcher activity — no receiver, service, provider or alias is');
    eq(manifest.elements.filter((e) => ['activity', 'activity-alias', 'service', 'receiver', 'provider'].indexOf(e.name) !== -1 && e.attrs['android:exported'] === undefined).map((e) => e.name), [],
      '…and every component says so itself (from Android 12 a component with an intent filter and no android:exported stops the install)');
    eq(manifest.elements.filter((e) => e.name === 'service' || e.name === 'activity-alias').map((e) => e.name), [], 'the app declares no service or alias of its own');
    eq(manifest.elements.filter((e) => e.name === 'receiver').length, 1, '…and ONE receiver: the home-screen widget\'s provider');
    eq(manifest.elements.filter((e) => e.name === 'activity').map((e) => e.attrs['android:name']), ['.MainActivity'], '…and one activity (the widget preview belongs to DEBUG builds, and is not named here)');
    eq(manifest.elements.filter((e) => e.name === 'data').map((e) => Object.keys(e.attrs).join(' ')), [], 'no intent filter carries a <data> element: no custom URL scheme, no host, nothing BROWSABLE');
    eq(manifest.elements.filter((e) => e.name === 'category').map((e) => e.attrs['android:name']), ['android.intent.category.LAUNCHER'], '…the activity\'s one filter is MAIN / LAUNCHER');
    const launcher = manifest.elements.filter((e) => e.name === 'activity' && e.attrs['android:name'] === '.MainActivity')[0] || { attrs: {} };
    eq([within(manifest, launcher).filter((e) => e.name === 'intent-filter').length, within(manifest, launcher).filter((e) => e.name === 'action').map((e) => e.attrs['android:name'])], [1, ['android.intent.action.MAIN']],
      '…and it has no other: the widget opens it with an EXPLICIT intent, which needs no filter');
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
  // (Its sub-packages are read in the widget sections: a receiver's PendingResult.finish() is not the activity's.)
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
  ok(/^npm run sync:android && /.test(s['android:test'] || '') && /gradlew :app:testDebugUnitTest\b/.test(s['android:test'] || ''), '"android:test" = sync:android, then the app module\'s JVM unit tests — the task CI runs');
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
  t.section('CI: the JVM tests block, a debug APK is compiled, the emulator smoke is advisory, never taps and photographs the widget preview, the bootstrap is gone');
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
  // The widget's rules (what is "next", a class that has started, the seat words, a snapshot that is not JSON)
  // live in a pure Java class, so they run on the runner's JVM with no emulator. BLOCKING, and BEFORE the APK:
  // an APK whose widget would name the wrong class is never uploaded for someone to install.
  const unit = step(build, 'JVM unit tests');
  ok(/working-directory: ios-app\/android\n/.test(unit) && /run: \.\/gradlew (?::app:)?testDebugUnitTest\b.*--no-daemon/.test(unit) && !/continue-on-error/.test(unit) && !/\|\|/.test(unit),
    '`./gradlew :app:testDebugUnitTest --no-daemon` in ios-app/android, and a failing test fails the job');
  ok(build.indexOf('run: npm run sync:android') < build.indexOf('- name: JVM unit tests') && build.indexOf('- name: JVM unit tests') < build.indexOf('- name: Compile (debug APK)'),
    '…after the sync Gradle cannot run without, and BEFORE the APK is compiled');
  const unitReport = step(build, 'Upload the unit-test report');
  ok(/if: always\(\)/.test(unitReport) && /uses: actions\/upload-artifact@v4/.test(unitReport) && /path: ios-app\/android\/app\/build\/reports\/tests\/?\n/.test(unitReport) && /if-no-files-found: ignore/.test(unitReport) && /retention-days: 30\b/.test(unitReport),
    'the report (app/build/reports/tests) is uploaded whatever happened, and kept 30 days');
  ok(build.indexOf('- name: JVM unit tests') < build.indexOf('- name: Upload the unit-test report') && build.indexOf('- name: Upload the unit-test report') < build.indexOf('- name: Compile (debug APK)'),
    '…before the compile step, which a failed test never reaches');
  const why = step(build, 'Show why a JVM test failed');
  ok(/if: failure\(\)/.test(why) && /continue-on-error: true/.test(why) && /test-results\/testDebugUnitTest\/\*\.xml/.test(why), 'a failed test\'s "expected … but was …" is printed into the log: nobody can re-run it on a development machine');
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
  // With no profile the AVD has no device definition: a screen narrower than the 328dp wide card plus the
  // preview page's padding, at 1 px per dp. The wide pictures would be of a card with both ends missing.
  ok(/\n {10}profile: [A-Za-z][\w ]*\n/.test(smoke), '…with a device PROFILE: a phone-sized, phone-dense screen, so the wide card fits and type can be judged');
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
  // The first line that fails ends the script, so nothing that JUDGES may come before the last piece of evidence.
  const judges = (l) => /^!/.test(l) || /^grep -q\b/.test(l);
  const firstJudge = script.findIndex(judges);
  ok(firstJudge > at(/after-back\.png/) && script.slice(firstJudge).every(judges) && script.slice(0, firstJudge).every((l) => !judges(l)), 'the lines that judge the run come LAST, after every piece of evidence is gathered');
  eq(script.slice(firstJudge === -1 ? script.length : firstJudge), ["grep -q '[0-9]' android-smoke/pid-after-back.txt", "! grep -q 'FATAL EXCEPTION' android-smoke/logcat.txt", "! grep -q 'Process: " + appId + "' android-smoke/logcat-widget.txt",
    "! grep -q 'PsyncWidgetPreview' android-smoke/logcat-widget.txt"],
    '…the process BACK left was alive, the launch log holds no FATAL EXCEPTION, the app did not crash under the widget preview ("Process: <appId>" is the header of AndroidRuntime\'s crash report), and the preview logged no widget it could NOT DRAW (its tag, at error level: the section on the preview holds the Java to it)');

  // The widget preview. WidgetPreviewActivity is in DEBUG builds only (app/src/debug/ — held further down) and
  // shows the RemoteViews the provider builds. `-S` force-stops the app before each start: a fresh activity
  // that reads ITS extras, where a second start of the one in front may only be brought forward with the old
  // ones. It also ends the process BACK left alive — so that process's id is written down FIRST.
  const esc = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const previews = script.map((l, i) => ({ l: l, i: i })).filter((x) => /WidgetPreviewActivity/.test(x.l));
  const pidAt = at(new RegExp('^adb shell pidof ' + esc(appId) + ' > android-smoke/pid-after-back\\.txt \\|\\| true$'));
  eq(previews.length, 9, 'the emulator script opens the widget preview nine times');
  ok(previews.every((x) => new RegExp('^adb shell am start -S -W -n ' + esc(appId) + '/\\.WidgetPreviewActivity(?: --es [a-z]+ [a-z0-9]+)+ \\|\\| true$').test(x.l)),
    '…each time by NAME, with -S (a fresh activity) and -W, STRING extras only (--es: the activity reads them with getStringExtra), and `|| true`');
  const extrasOf = (l) => { const o = {}; l.replace(/ --es ([a-z]+) ([a-z0-9]+)/g, (all, k, v) => { o[k] = v; return all; }); return o; };
  eq(previews.map((x) => extrasOf(x.l)), [{ size: 'compact', night: '0' }, { size: 'wide', night: '0' }, { size: 'wide', night: '1' }, { size: 'compact', night: '0', sample: 'off' }, { size: 'compact', night: '0', empty: '1' },
    { size: 'compact', night: '0', sample: 'four' }, { size: 'compact', night: '0', sample: 'two', width: '110', height: '140' }, { size: 'compact', night: '0', width: '110', height: '110' },
    { size: 'compact', night: '0', sample: 'long', height: '150' }],
    '…compact, wide, wide at night, compact with class colours off, the empty state — then what a roomy sample never shows: FOUR seats in a two-cell badge, two seats on the narrowest card, the smallest card there is (110 x 110), and a long name on a card with room for one line of it. No snapshot extra: the built-in sample (fictional names) is what is photographed');
  eq(previews.map((x) => [/^sleep [3-6]$/.test(script[x.i + 1] || ''), (/^adb exec-out screencap -p > android-smoke\/(widget-[a-z-]+\.png) \|\| true$/.exec(script[x.i + 2] || '') || [])[1]]),
    ['widget-compact-light.png', 'widget-wide-light.png', 'widget-wide-dark.png', 'widget-compact-off.png', 'widget-empty.png', 'widget-compact-four-seats.png', 'widget-compact-narrow.png', 'widget-compact-smallest.png',
      'widget-compact-large-type.png'].map((f) => [true, f]),
    '…each followed by about 4 s and a picture: widget-compact-light, widget-wide-light, widget-wide-dark, widget-compact-off, widget-empty, widget-compact-four-seats, widget-compact-narrow, widget-compact-smallest, widget-compact-large-type');
  // Every row of the card but the time is sp, so ONE state is drawn with a larger system font — set just
  // before it, and put back after (the emulator is thrown away, but a later line may be added one day).
  const fontLines = script.map((l, i) => ({ l: l, i: i })).filter((x) => /font_scale/.test(x.l));
  eq(fontLines.map((x) => x.l), ['adb shell settings put system font_scale 1.3 || true', 'adb shell settings put system font_scale 1.0 || true'], 'the system font scale is set to 1.3, and put back to 1.0');
  ok(fontLines.length === 2 && previews.length === 9 && fontLines[0].i > previews[7].i + 2 && fontLines[0].i < previews[8].i && fontLines[1].i > previews[8].i + 2 && fontLines[1].i < firstJudge,
    '…around the LAST preview only: the other eight are drawn at the default font');
  ok(pidAt > at(/after-back\.png/) && previews.length > 0 && pidAt < previews[0].i && at(/^adb logcat -d -s /) < previews[0].i,
    'the process id BACK left, and the launch log, are written down BEFORE the first preview start force-stops the app');
  const widgetLog = at(/^adb logcat -d '\*:W' > android-smoke\/logcat-widget\.txt \|\| true$/);
  ok(previews.length > 0 && widgetLog > previews[previews.length - 1].i + 2 && widgetLog < firstJudge, 'after the last picture, what the log holds at warning level and above goes to logcat-widget.txt');
  ok(previews.length > 0 && script.slice(at(/^adb logcat -d -s /) + 1, firstJudge).every((l) => /^sleep \d+$/.test(l) || / \|\| true$/.test(l)),
    'no widget line can end the script: from the launch log to the verdict each is a sleep or ends in `|| true` (a preview that will not open must not cost the verdict on the launch)');
  const shots = step(smoke, 'Upload the screenshots and the log');
  ok(/if: always\(\)/.test(shots) && /\n\s+name: android-smoke\n/.test(shots) && /\n\s+path: android-smoke\/\n/.test(shots), 'the pictures and the logs — the whole android-smoke/ folder — are uploaded as "android-smoke", whatever happened');
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
  // An id is defined where it is first named: android:id="@+id/x". (The widget's Java names many: R.id.…)
  xmlFiles.forEach((f) => read(f).replace(/<!--[\s\S]*?-->/g, '').replace(/["']@\+id\/([A-Za-z_]\w*)["']/g, (all, name) => { define('id', name); return all; }));
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
  // Every Java file under src/main/java, sub-packages too (the widget's code names an id for every view it
  // fills). android.R.… is the platform's and is not read: it follows a dot.
  const walk = (rel) => (has(rel) ? fs.readdirSync(abs(rel)).sort() : []).reduce((out, f) => out.concat(fs.statSync(abs(rel + '/' + f)).isDirectory() ? walk(rel + '/' + f) : [rel + '/' + f]), []);
  const JAVA_ROOT = MAIN + '/java';
  const javaFiles = walk(JAVA_ROOT).filter((f) => /\.java$/.test(f));
  const rRefs = (src) => { const found = []; src.replace(/(^|[^\w.])R\.([a-z]+)\.(\w+)/g, (all, lead, type, name) => { found.push([type, name]); return all; }); return found; };
  const javaRefs = rRefs(javaFiles.map((f) => javaCode(read(f), false)).join('\n'));
  const javaNames = (type) => Object.keys(defined[type] || {}).map((n) => n.replace(/\./g, '_'));
  ok(javaFiles.indexOf(ACTIVITY) !== -1 && javaRefs.length >= 3, 'the app\'s Java is read, every package of it (' + javaFiles.length + ' files, ' + javaRefs.length + ' resources named)');
  eq(javaRefs.filter((r) => javaNames(r[0]).indexOf(r[1]) === -1).map((r) => 'R.' + r[0] + '.' + r[1]), [], 'every R.<type>.<name> in the app\'s Java is a resource of res/ — an id included (android:id="@+id/…")');

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
  eq(permissions.slice().sort(), ['INTERNET', 'READ_CALENDAR', 'WRITE_CALENDAR'].map((p) => 'android.permission.' + p), '…and nothing else: the widget needs none (an inexact alarm, a broadcast to itself, a private file)');

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

  // ── 10. The home-screen widget: what the launcher is told ────────────────
  // Level 3: a CLASSIC App Widget — one AppWidgetProvider, RemoteViews, XML layouts, plain Java, nothing new
  // at runtime. Nothing here can compile it or drop it on a launcher, so these sections hold what aapt2, javac
  // and a launcher would refuse FIRST, and what a reviewer would look for. The snapshot's rules themselves are
  // JVM unit tests (app/src/test/, run by CI); what the bridge writes is 20-android-widget.js's business.
  t.section('Android widget: one provider, declared the way a launcher needs it');
  const short = (f) => f.slice((ANDROID + '/app/src/').length);
  const fqcn = (name) => (!name ? '' : name[0] === '.' ? appId + name : name.indexOf('.') === -1 ? appId + '.' + name : name);
  const receiver = (manifest ? manifest.elements.filter((e) => e.name === 'receiver')[0] : null) || { attrs: {} };
  const providerClass = fqcn(receiver.attrs['android:name']);
  const providerName = providerClass.split('.').pop();
  const providerFile = JAVA_ROOT + '/' + providerClass.split('.').join('/') + '.java';
  ok(providerClass.indexOf(appId + '.widget.') === 0, 'the receiver is a class of the app\'s `widget` package (' + (providerClass || 'none declared') + ')');
  ok(!!providerClass && has(providerFile) && new RegExp('\\bclass\\s+' + providerName + '\\s+extends\\s+AppWidgetProvider\\b').test(javaCode(read(providerFile), false)) &&
    /^import\s+android\.appwidget\.AppWidgetProvider\s*;/m.test(read(providerFile)), '…its source exists, and it extends android.appwidget.AppWidgetProvider');
  eq(receiver.attrs['android:exported'], 'false', '…and it is NOT exported: the system\'s widget service reaches a provider whatever it says, and the app\'s own refresh and alarm are sent as the app — exported, any app could start the process and have it rebuild the widget at will');
  const inReceiver = manifest ? within(manifest, receiver) : [];
  eq([inReceiver.filter((e) => e.name === 'intent-filter').length, inReceiver.filter((e) => e.name === 'action').map((e) => e.attrs['android:name'])], [1, ['android.appwidget.action.APPWIDGET_UPDATE']],
    'its one filter holds APPWIDGET_UPDATE and nothing else: the app\'s own "repaint now" is an EXPLICIT broadcast, and an action written here is an action any app may send');
  const metas = inReceiver.filter((e) => e.name === 'meta-data');
  eq(metas.map((e) => e.attrs['android:name']), ['android.appwidget.provider'], 'its one <meta-data> is android.appwidget.provider');
  const infoRef = /^@xml\/([a-z][a-z0-9_]*)$/.exec((metas[0] || { attrs: {} }).attrs['android:resource'] || '');
  const infoFile = RES + '/xml/' + (infoRef ? infoRef[1] : '_none_') + '.xml';
  ok(!!infoRef && has(infoFile), '…naming a file that exists under res/xml/ (' + (infoRef ? infoRef[0] : 'none') + ')');
  let info = null;
  try { info = parseXml(read(infoFile)); } catch (e) { info = null; }
  const infoAttrs = info ? info.root.attrs : {};
  ok(!!info && info.root.name === 'appwidget-provider', 'it parses, as <appwidget-provider>');
  ok(/^\d+$/.test(infoAttrs['android:updatePeriodMillis'] || '') && +infoAttrs['android:updatePeriodMillis'] >= 1800000,
    'updatePeriodMillis is at least 1800000 (30 min — Android rounds anything shorter UP to that, and 0 means "never": the widget would then depend on the app being opened)');
  ok(/^@layout\/widget_[a-z0-9_]+$/.test(infoAttrs['android:initialLayout'] || ''), 'initialLayout is one of the widget_* layouts (that it exists is the reference check\'s business, above)');
  // A launcher draws the initialLayout until the provider's FIRST paint — after a restart too, and on a phone
  // whose battery manager lets no app start after one, until the app is opened. "Nothing booked" there is a
  // statement about the member's bookings that nothing has checked.
  {
    const initialFile = RES + '/layout/' + (infoAttrs['android:initialLayout'] || '').replace(/^@layout\//, '') + '.xml';
    let initial = null;
    try { initial = parseXml(read(initialFile)); } catch (e) { initial = null; }
    const texts = initial ? initial.elements.map((e) => e.attrs['android:text']).filter((v) => v !== undefined) : ['(unreadable)'];
    eq(texts, ['@string/app_name'], 'the initialLayout claims NOTHING: its only words are the app\'s name — never the empty state\'s, and never a sample');
    ok(!/empty/.test(infoAttrs['android:initialLayout'] || ''), '…and it is not the empty-state layout, which is for a snapshot that was READ and holds no class');
    ok(initial && initial.root.attrs['android:id'] === '@android:id/background', '…its root is android:id/background, like every widget layout (Android 12 rounds the card by it)');
  }
  ok(/^(?:\d+dp|@dimen\/\w+)$/.test(infoAttrs['android:minWidth'] || '') && /^(?:\d+dp|@dimen\/\w+)$/.test(infoAttrs['android:minHeight'] || ''), 'minWidth and minHeight are given, in dp');
  ok(/(^|\|)horizontal(\||$)/.test(infoAttrs['android:resizeMode'] || ''), 'it can be resized sideways: its WIDTH is what picks the compact or the wide layout');
  ok(infoAttrs['android:configure'] === undefined, 'no configure activity (it would have to be a second exported activity)');
  ok(infoAttrs['android:widgetCategory'] === undefined || infoAttrs['android:widgetCategory'] === 'home_screen', 'home screen only — never "keyguard": a member\'s next class is not for a locked phone');

  // ── 11. What a launcher may inflate ──────────────────────────────────────
  // A widget's layout is inflated in the LAUNCHER's process, by an inflater that allows a short list of
  // framework views and nothing else: one <View>, one ConstraintLayout or one class of the app's own and the
  // launcher shows "Problem loading widget" — on a phone, never at build time. The launcher's theme is in
  // force there too, so an attribute of the APP's theme (?attr/…) resolves to nothing, and AppCompat's app:…
  // attributes are read by nobody.
  t.section('Android widget: layouts a launcher may inflate, one pictogram per class type, the empty state\'s words');
  const REMOTE_VIEWS = ['FrameLayout', 'LinearLayout', 'RelativeLayout', 'GridLayout', 'TextView', 'ImageView', 'ImageButton', 'Button', 'ProgressBar', 'Chronometer', 'AnalogClock', 'TextClock',
    'ViewFlipper', 'ListView', 'GridView', 'StackView', 'AdapterViewFlipper', 'ViewStub'];
  const unsafe = (text) => {
    let doc;
    try { doc = parseXml(text); } catch (e) { return ['does not parse']; }
    const out = [];
    doc.elements.forEach((e) => {
      // <include layout="@layout/…"> is the inflater's own business, not a view class: a launcher takes it.
      if (REMOTE_VIEWS.indexOf(e.name) === -1 && e.name !== 'include') out.push('<' + e.name + '>');
      Object.keys(e.attrs).forEach((a) => {
        if (a !== 'style' && !(e.name === 'include' && a === 'layout') && !/^(?:android|xmlns|tools):/.test(a)) out.push(a);
        if (a === 'android:onClick') out.push(a);
        if (/^\?(?!android:)/.test(e.attrs[a])) out.push(a + '="' + e.attrs[a] + '"');
      });
    });
    return out;
  };
  {
    const NS = ' xmlns:android="http://schemas.android.com/apk/res/android"';
    eq(unsafe('<LinearLayout' + NS + ' android:id="@android:id/background"><ImageView android:src="@drawable/x"/><TextView style="@style/S" android:textColor="?android:attr/textColorPrimary"/><include layout="@layout/widget_row" android:id="@+id/r"/></LinearLayout>'), [],
      'the layout reader passes framework views, android: attributes, a style, an <include> and a PLATFORM theme attribute');
    eq(unsafe('<androidx.constraintlayout.widget.ConstraintLayout' + NS + ' xmlns:app="http://schemas.android.com/apk/res-auto"><View android:background="?attr/colorPrimary"/><ImageView app:srcCompat="@drawable/x" android:onClick="go"/></androidx.constraintlayout.widget.ConstraintLayout>'),
      ['<androidx.constraintlayout.widget.ConstraintLayout>', '<View>', 'android:background="?attr/colorPrimary"', 'app:srcCompat', 'android:onClick'],
      '…and refuses a ConstraintLayout, a bare <View>, the app theme\'s ?attr/…, an app: attribute and android:onClick');
  }
  const widgetLayouts = resFiles.filter((f) => /^layout(?:-|\/)/.test(f) && /\/widget_[a-z0-9_]*\.xml$/.test(f));
  ok(['compact', 'wide', 'empty'].every((word) => widgetLayouts.some((f) => f.split('/')[1].indexOf(word) !== -1)), 'res/layout holds a compact, a wide and an empty widget_* layout (' + (widgetLayouts.join(', ') || 'none') + ')');
  eq(widgetLayouts.reduce((out, f) => out.concat(unsafe(read(RES + '/' + f)).map((what) => f + ': ' + what)), []), [], 'every widget_* layout uses RemoteViews-safe views only, android: attributes only, and no attribute of the app\'s theme');
  const widgetDrawables = resFiles.filter((f) => /^(?:drawable|color)(?:-|\/)/.test(f) && /\/(?:widget_|ic_ct_)[a-z0-9_]*\.xml$/.test(f));
  eq(widgetDrawables.filter((f) => /=\s*["']\?(?!android:)/.test(read(RES + '/' + f).replace(/<!--[\s\S]*?-->/g, ''))), [], '…and no widget_* / ic_ct_* drawable reads one either');

  // One pictogram per class-type key — the keys are the web app's (the snapshot's `ct` is one of them).
  const pictogramBlock = (/\nvar CLASS_PICTOGRAMS = \{\n([\s\S]*?)\n\};/.exec(t.readSource('js/app.js')) || [])[1] || '';
  const ctKeys = (pictogramBlock.match(/^ {2}[a-z]+(?=: ')/gm) || []).map((k) => k.trim());
  eq(ctKeys, ['ride', 'strength', 'yoga', 'hiit', 'pilates', 'lagree', 'barre', 'other'], 'js/app.js CLASS_PICTOGRAMS names the eight class-type keys a snapshot entry\'s `ct` can carry');
  eq(ctKeys.filter((k) => !has(RES + '/drawable/ic_ct_' + k + '.xml')), [], 'res/drawable holds ic_ct_<key>.xml for each of them');
  eq(resFiles.filter((f) => /\/ic_ct_/.test(f)).map((f) => f.split('/')[1]).filter((f) => ctKeys.map((k) => 'ic_ct_' + k + '.xml').indexOf(f) === -1), [], '…and no ic_ct_* for a key the app does not have');
  eq(ctKeys.filter((k) => {
    const src = read(RES + '/drawable/ic_ct_' + k + '.xml');
    let doc;
    try { doc = parseXml(src); } catch (e) { return true; }
    return !(doc.root.name === 'vector' && /^24(?:\.0+)?$/.test(doc.root.attrs['android:viewportWidth'] || '') && /^24(?:\.0+)?$/.test(doc.root.attrs['android:viewportHeight'] || '') &&
      doc.elements.some((e) => e.name === 'path' && (e.attrs['android:pathData'] || '').length > 4) && references(src).length === 0);
  }), [], 'each is a <vector> on the app\'s 24 grid with path data and LITERAL colours: the provider tints it with a colour filter, and nothing night-qualified can change it underneath');
  ok(Object.keys(strings).some((k) => strings[k] === 'Nothing booked'), 'strings.xml holds the empty state\'s words, "Nothing booked" — the same signed out or never opened: the widget never says who is signed in');

  // A one-line TextView with maxLines="1" and NO ellipsize wraps at its last space and hides line two:
  // "Bikes 12 & 14 & 16 & 18" printed as "Bikes 12 & 14 & 16 &" — a seat gone, and nothing to say so. With
  // no space to wrap at (the time, the day word) it breaks mid-word instead: "18:3". A cut must be SEEN.
  const stylesSrc = read(RES + '/values/widget_styles.xml').replace(/<!--[\s\S]*?-->/g, '');
  const styleItems = {};
  stylesSrc.replace(/<style\s+name="(\w+)"[^>]*>([\s\S]*?)<\/style>/g, (all, name, body) => {
    styleItems[name] = {};
    body.replace(/<item\s+name="android:(\w+)">([^<]*)<\/item>/g, (item, k, v) => { styleItems[name][k] = v.trim(); return item; });
    return all;
  });
  const widgetStyles = Object.keys(styleItems).filter((n) => /^PsyncWidget/.test(n));
  ok(widgetStyles.length >= 6, 'values/widget_styles.xml holds the widget\'s text styles (' + widgetStyles.join(', ') + ')');
  eq(widgetStyles.filter((n) => styleItems[n].maxLines !== undefined && styleItems[n].ellipsize !== 'end'), [], 'EVERY widget style that limits its lines ends in an ellipsis (android:ellipsize="end"): text that does not fit is never cut out of sight');
  eq(['PsyncWidgetDay', 'PsyncWidgetTime'].filter((n) => !styleItems[n] || styleItems[n].singleLine !== 'true'), [], '…and the day word and the time, which hold no space to wrap at, are singleLine too: never "18:3"');
  {
    const lines = (body) => ({ maxLines: '1', ellipsize: body });
    eq([{ a: lines('end') }, { a: lines(undefined) }].map((set) => Object.keys(set).filter((n) => set[n].maxLines !== undefined && set[n].ellipsize !== 'end').length), [0, 1], '(the check can fail: a one-line style with no ellipsize)');
  }

  // PsyncWidgetPlan ADDS a card's rows up to decide what fits (a RemoteViews cannot measure itself), from
  // numbers copied out of the layouts and the styles. Its JVM tests hold the sums; nothing but this holds
  // the numbers to where they came from — and a text size changed in the XML alone would let a plan
  // "fit" a height it no longer fits, which is the seat badge cut off the bottom of the card.
  const planSrc = read(JAVA_ROOT + '/' + appId.split('.').join('/') + '/widget/PsyncWidgetPlan.java');
  const planConst = (name) => { const m = new RegExp('\\bstatic\\s+final\\s+int\\s+' + name + '\\s*=\\s*(\\d+)\\s*;').exec(planSrc); return m ? +m[1] : null; };
  const layoutDoc = (name) => { try { return parseXml(read(RES + '/layout/' + name + '.xml')); } catch (e) { return { elements: [] }; } };
  const compactDoc = layoutDoc('widget_next_class_compact'), wideDoc = layoutDoc('widget_next_class_wide');
  const byId = (doc, id) => doc.elements.filter((e) => e.attrs['android:id'] === '@+id/' + id)[0] || { attrs: {}, up: -1 };
  const parentOf = (doc, el) => (el.up >= 0 ? doc.elements[el.up] : { attrs: {} });
  const num = (v) => { const m = /^(\d+)(?:dp|sp)$/.exec(v || ''); return m ? +m[1] : null; };
  const sp = (style) => num((styleItems[style] || {}).textSize);
  const ruleEl = byId(wideDoc, 'widget_rule');
  const seatStyle = styleItems.PsyncWidgetSeat || {};
  eq([['DAY_SP', sp('PsyncWidgetDay')], ['TITLE_SP', sp('PsyncWidgetTitle')], ['TITLE_WIDE_SP', num(byId(wideDoc, 'widget_title').attrs['android:textSize'])],
    ['BODY_SP', sp('PsyncWidgetBody')], ['SEAT_SP', sp('PsyncWidgetSeat')],
    ['TILE_DP', num(parentOf(compactDoc, byId(compactDoc, 'widget_tile_fill')).attrs['android:layout_height'])],
    ['TILE_WIDE_DP', num(parentOf(wideDoc, byId(wideDoc, 'widget_tile_fill')).attrs['android:layout_height'])],
    ['SEAT_PAD_TALL_DP', num(seatStyle.paddingTop) + num(seatStyle.paddingBottom)], ['SEAT_PAD_WIDE_DP', num(seatStyle.paddingStart) + num(seatStyle.paddingEnd)],
    ['SEAT_GAP_DP', num(byId(compactDoc, 'widget_seat_group').attrs['android:layout_marginTop'])], ['SEAT_GAP_WIDE_DP', num(byId(wideDoc, 'widget_seat_group').attrs['android:layout_marginTop'])],
    ['WHO_GAP_DP', num(byId(wideDoc, 'widget_who').attrs['android:layout_marginTop'])],
    ['RULE_DP', num(ruleEl.attrs['android:layout_height']) + num(ruleEl.attrs['android:layout_marginTop']) + num(ruleEl.attrs['android:layout_marginBottom'])],
    ['ROW_GAP_DP', num(byId(wideDoc, 'widget_row_2').attrs['android:layout_marginTop'])],
    ['COLUMN_GAP_DP', num(parentOf(wideDoc, parentOf(wideDoc, parentOf(wideDoc, byId(wideDoc, 'widget_tile_fill')))).attrs['android:layout_marginStart'])],
  ].filter((pair) => pair[1] === null || Number.isNaN(pair[1]) || planConst(pair[0]) !== pair[1]).map((pair) => pair[0] + ': the plan says ' + planConst(pair[0]) + ', the XML ' + pair[1]), [],
    'every size PsyncWidgetPlan adds up — text sizes, the tiles, the badge\'s padding, the margins, the rule — is the layouts\' and the styles\' own number');
  eq([sp('PsyncWidgetRowWhen'), num((styleItems.PsyncWidgetTime || {}).textSize)], [planConst('BODY_SP'), 40], '…a following row\'s two halves are one size (the plan counts a row as one BODY_SP line), and the time\'s size in the style is the roomy plan\'s 40dp');
  eq([num(compactDoc.elements.filter((e) => e.attrs['android:id'] === '@+id/widget_content').map((e) => e.attrs['android:padding'])[0]), num(wideDoc.elements.filter((e) => e.attrs['android:id'] === '@+id/widget_content').map((e) => e.attrs['android:padding'])[0])], [12, 12],
    '…and both cards\' padding in the XML is the roomy plan\'s 12dp (PsyncWidgetViews sets the plan\'s own on every build)');
  ok(num(infoAttrs['android:minHeight']) === 110 && num(infoAttrs['android:minResizeHeight']) === 110 && /110dp, the smallest a launcher may make it/.test(planSrc),
    'the smallest height a launcher may give the widget is 110dp — what the plan\'s smallest step is built to fit (its JVM test pins the sum)');

  // ── 12. The Java that can be read ────────────────────────────────────────
  t.section('Android widget: every PendingIntent immutable, an inexact alarm only, an explicit tap, nothing newer than API 22 unguarded');
  const PKG_DIR = JAVA_ROOT + '/' + appId.split('.').join('/');
  const widgetFiles = javaFiles.filter((f) => f.indexOf(PKG_DIR + '/widget/') === 0);
  const DEBUG = ANDROID + '/app/src/debug';
  const TEST_ROOT = ANDROID + '/app/src/test/java';
  const debugJava = walk(DEBUG + '/java').filter((f) => /\.java$/.test(f));
  const testFiles = walk(TEST_ROOT).filter((f) => /\.java$/.test(f));
  const codeOf = (f) => javaCode(read(f), false);
  const textOf = (f) => javaCode(read(f), true).replace(/"\s*\+\s*"/g, '');
  const allCode = javaFiles.map(codeOf).join('\n');
  const allText = javaFiles.map(textOf).join('\n');
  const widgetCode = widgetFiles.map(codeOf).join('\n');
  ok(widgetFiles.length >= 3, 'the widget package holds the provider, the views builder and the snapshot class (' + widgetFiles.length + ' files)');

  // The top-level arguments of the call whose "(" is at `open`; the body of the method called `name`.
  const callArgs = (src, open) => {
    const args = [];
    let depth = 0, start = open + 1;
    for (let j = open; j < src.length; j++) {
      const c = src[j];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) { args.push(src.slice(start, j).trim()); return args; } }
      else if (c === ',' && depth === 1) { args.push(src.slice(start, j).trim()); start = j + 1; }
    }
    return args;
  };
  const methodBody = (src, name) => {
    const m = new RegExp('\\b' + name + '\\s*\\([^()]*\\)\\s*(?:throws\\s+[\\w.,\\s]+?)?\\{').exec(src);
    if (!m) return '';
    let depth = 1, j = m.index + m[0].length;
    while (j < src.length && depth > 0) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
    return src.slice(m.index + m[0].length, j - 1);
  };
  const pendingIntents = (src) => {
    const found = [], re = /\bPendingIntent\s*\.\s*(getActivity|getActivities|getBroadcast|getService|getForegroundService)\s*\(/g;
    let m;
    while ((m = re.exec(src))) found.push({ how: m[1], flags: callArgs(src, re.lastIndex - 1)[3] || '' });
    return found;
  };
  // Is `flag` in the call's flags argument — written there, or reached through what the argument names: a
  // variable or constant some statement of the file gives the flag to, or a helper whose body holds it
  // (FLAG_IMMUTABLE is API 23, so a guarded helper is the natural shape). By reading: it follows no data flow.
  const NOT_A_NAME = /^(?:PendingIntent|Build|VERSION|VERSION_CODES|SDK_INT|M|S|int)$/;
  const holdsFlag = (flag, arg, fileCode, everyCode) => {
    if (flag.test(arg)) return true;
    const names = (arg.match(/[A-Za-z_]\w*/g) || []).filter((n) => !/^FLAG_/.test(n) && !NOT_A_NAME.test(n));
    // A CONSTANT may be declared in another class of the app; a lower-case name is looked for in this file only.
    return names.some((n) => flag.test(methodBody(everyCode, n)) || (/^[A-Z][A-Z0-9_]*$/.test(n) ? everyCode : fileCode).split(/[;{}]/).some((st) => new RegExp('\\b' + n + '\\b').test(st) && flag.test(st)));
  };
  const IMMUTABLE = /\bFLAG_IMMUTABLE\b/, REPLACES = /\bFLAG_(?:UPDATE|CANCEL)_CURRENT\b/;
  {
    const guarded = 'class A { static int immutable(int f) { return Build.VERSION.SDK_INT >= 23 ? f | PendingIntent.FLAG_IMMUTABLE : f; }\n void a(Context c, Intent i) { PendingIntent.getActivity(c, 0, i, immutable(PendingIntent.FLAG_UPDATE_CURRENT)); } }';
    const byVariable = 'class B { void b(Context c, Intent i) { int flags = PendingIntent.FLAG_UPDATE_CURRENT; if (Build.VERSION.SDK_INT >= 23) { flags |= PendingIntent.FLAG_IMMUTABLE; } PendingIntent.getBroadcast(c, 7, new Intent(c, B.class).putExtra("a", f(1, 2)), flags); } }';
    const bare = 'class C { void c(Context c, Intent i) { int flags = PendingIntent.FLAG_UPDATE_CURRENT; PendingIntent.getBroadcast(c, 0, i, flags); PendingIntent.getActivity(c, 0, i, 0); PendingIntent.getService(c, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT); } }';
    const verdicts = (src, flag) => pendingIntents(src).map((p) => p.how + ':' + holdsFlag(flag, p.flags, src, src));
    eq([verdicts(guarded, IMMUTABLE), verdicts(byVariable, IMMUTABLE), verdicts(bare, IMMUTABLE)], [['getActivity:true'], ['getBroadcast:true'], ['getBroadcast:false', 'getActivity:false', 'getService:true']],
      'the PendingIntent reader finds the flags argument (nested calls and all) and follows it into a helper or a variable — and it can fail: flags that never meet FLAG_IMMUTABLE, and a bare 0');
    eq([verdicts(guarded, REPLACES), verdicts(bare, REPLACES)], [['getActivity:true'], ['getBroadcast:true', 'getActivity:false', 'getService:true']], '…the same for FLAG_UPDATE_CURRENT');
  }
  const built = [];
  javaFiles.concat(debugJava).forEach((f) => pendingIntents(codeOf(f)).forEach((p) => built.push({ f: f, how: p.how, flags: p.flags })));
  const everyCode = allCode + '\n' + debugJava.map(codeOf).join('\n');
  const inWidget = built.filter((p) => widgetFiles.indexOf(p.f) !== -1);
  ok(inWidget.some((p) => p.how === 'getActivity') && inWidget.some((p) => p.how === 'getBroadcast'), 'the widget package builds a PendingIntent for the tap (getActivity) and one for its roll-over alarm (getBroadcast) — ' + built.length + ' in the app');
  eq(built.filter((p) => !holdsFlag(IMMUTABLE, p.flags, codeOf(p.f), everyCode)).map((p) => short(p.f) + ': ' + p.how + '(…, ' + p.flags + ')'), [],
    'EVERY PendingIntent the app builds carries FLAG_IMMUTABLE (from Android 12 one without it throws; before that, whoever holds it could fill in the intent)');
  ok(!/\bFLAG_MUTABLE\b/.test(everyCode), '…and none is FLAG_MUTABLE');
  eq(inWidget.filter((p) => p.how === 'getActivity' && !holdsFlag(REPLACES, p.flags, codeOf(p.f), everyCode)).map((p) => short(p.f) + ': ' + p.flags), [],
    'the tap\'s PendingIntent is FLAG_UPDATE_CURRENT: two that differ only in their EXTRAS are one to Android, so without it a tap opens the class the widget showed before');
  ok(/\bsetOnClickPendingIntent\s*\(/.test(widgetCode), 'a tap is wired with setOnClickPendingIntent');
  ok(/\bMainActivity\s*\.\s*class\b/.test(widgetCode) && !/\bACTION_VIEW\b/.test(allCode), '…for an intent that names MainActivity by CLASS — explicit: no URL scheme, no ACTION_VIEW, no intent filter');
  ok(/\bAlarmManager\b/.test(widgetCode) && /\.\s*(?:set|setWindow)\s*\(/.test(widgetCode), 'the provider arms its roll-over with AlarmManager.set(…): inexact, so no permission and no special-access screen');
  ok(!/\.\s*(?:setExact\w*|setAlarmClock|setRepeating|setInexactRepeating)\s*\(/.test(allCode) && !/\b(?:canScheduleExactAlarms|SCHEDULE_EXACT_ALARM|USE_EXACT_ALARM)\b/.test(allText), '…never an exact alarm, never a repeating one');
  ok(/\bonDisabled\s*\(/.test(widgetCode) && /\.\s*cancel\s*\(/.test(widgetCode), '…and it is cancelled when the last widget is removed (onDisabled)');
  // WHEN the alarm fires is a rule with a trap in it — the day words are relative, so "Tomorrow 07:30" painted
  // at 23:50 is wrong from midnight, long before the class's own roll-over — and a rule the provider works out
  // itself is one no JVM test can see. So: the pure class names the instant, the provider only arms it; and it
  // arms it in a FINALLY, so that a launcher refusing one paint cannot cost the widget its next one.
  const providerCode = has(providerFile) ? codeOf(providerFile) : '';
  const pureFiles = widgetFiles.filter((f) => !/^import\s+(?:static\s+)?androidx?\./m.test(read(f)));
  ok(pureFiles.some((f) => /\blong\s+nextRepaintMillis\s*\(\s*long\s+\w+\s*,\s*TimeZone\s+\w+\s*\)/.test(codeOf(f))) && /\.\s*nextRepaintMillis\s*\(/.test(providerCode),
    'the instant of the next repaint is worked out by the PURE class (nextRepaintMillis(now, zone): the roll-over, or midnight if sooner — its JVM tests hold both) and the provider asks it');
  ok(!/\bstartMillis\s*\(/.test(providerCode), '…the provider does no arithmetic of its own on a class\'s start');
  {
    const refresh = methodBody(providerCode, 'refreshAll');
    const fin = /\bfinally\s*\{([\s\S]*)\}\s*$/.exec(refresh);
    const armer = fin ? (/\b([A-Za-z_]\w*)\s*\(/.exec(fin[1]) || [])[1] : '';
    ok(!!fin && !!armer && /\.\s*set\s*\(/.test(methodBody(providerCode, armer)) && /\.\s*cancel\s*\(/.test(methodBody(providerCode, armer)) && !/\.\s*set\s*\(/.test(refresh.slice(0, fin.index)),
      '…and arms (or cancels) its ONE alarm in a `finally` of the repaint, nowhere else in it: a throwing updateAppWidget cannot leave the roll-over unarmed');
    ok(/\bcatch\s*\(\s*RuntimeException\b/.test(methodBody(providerCode, armer)), '…through a method that throws nothing itself (it runs in a finally)');
  }
  // Every row of the card but the time is sp: the plan must be told the member's font scale, or its sums are
  // for a font nobody has and the LAST row — the seat — is what falls off the card.
  ok(/\bfontScale\b/.test(providerCode) && /\.\s*forSize\s*\(\s*[^()]*,\s*[^()]*,\s*fontScale\s*\)/.test(providerCode) && !/\.\s*forSize\s*\(\s*\w+\s*,\s*\w+\s*\)/.test(providerCode),
    'the provider hands Configuration.fontScale to PsyncWidgetPlan.forSize, for both of a widget\'s boxes');
  const viewsCode = widgetFiles.filter((f) => /PsyncWidgetViews\.java$/.test(f)).map(codeOf).join('\n');
  ok(/setTextViewText\s*\(\s*R\.id\.widget_title\s*,[^;]*\btitleLines\b[^;]*\bshortTitle\s*\(\s*\)[^;]*\btitle\s*\(\s*\)/.test(viewsCode),
    'on ONE line the class name is printed as its head (shortTitle), as the iPhone layouts\' last steps do: "REFORMER PILATES", whole — never the full name ending mid-word');
  ok(/setTextViewText\s*\(\s*R\.id\.widget_seat\s*,[^;]*\bbadge\b/.test(viewsCode) && /\.\s*seatBadge\s*\(\s*plan\s*\.\s*seatChars\s*\)/.test(viewsCode),
    '…and the seat badge prints seatBadge(plan.seatChars): seats it has no room for are COUNTED ("4 bikes"), never cut off its end');

  // minSdk is 22 and core-library desugaring is off. javac accepts all of this against android.jar 35 and the
  // JVM unit tests pass with it; an Android 5.1–7 phone then throws NoClassDefFoundError / NoSuchMethodError
  // inside the launcher's update broadcast. Lint would say so (NewApi), and nobody can run lint here.
  const tooNew = (src) => {
    const found = [], text = javaCode(src, true);
    (src.match(/^import\s+(?:static\s+)?(?:java\.time|java\.util\.stream|java\.util\.function|java\.nio\.file|java\.util\.Optional|java\.util\.concurrent\.CompletableFuture)\b[^;]*;/gm) || []).forEach((l) => found.push(l.trim()));
    [/\.\s*stream\s*\(\s*\)/, /\.\s*(?:getOrDefault|computeIfAbsent|computeIfPresent|removeIf|forEach)\s*\(/, /(?<!\bCollections|\bArrays)\s*\.\s*sort\s*\(/, /\bComparator\s*\.\s*\w+\s*\(/, /\bgetSystemService\s*\(\s*\w+\s*\.\s*class\s*\)/]
      .forEach((re) => { const m = re.exec(text); if (m) found.push(m[0].replace(/\s+/g, '')); });
    // Newer framework calls are fine BEHIND a version test: one must come before them in the SAME method (or
    // the method says @RequiresApi / @TargetApi). By reading: a test earlier in the method is taken to cover it.
    [/\.\s*isNightModeActive\s*\(/g, /\.\s*setAndAllowWhileIdle\s*\(/g, /\.\s*setImageViewIcon\s*\(/g, /\bOPTION_APPWIDGET_SIZES\b/g, /"setClipToOutline"/g,
      /\.\s*(?:setColorStateList|setColorInt|setColorAttr|setViewLayoutWidth|setViewLayoutHeight|setViewLayoutMargin|setViewOutlinePreferredRadius\w*)\s*\(/g]
      .forEach((re) => {
        let m;
        while ((m = re.exec(text))) {
          const open = [];   // the "{" of every block that encloses the call, outermost first: [class, method, …]
          for (let j = 0; j < m.index; j++) {
            const c = text[j];
            if (c === '"' || c === "'") { j++; while (j < m.index && text[j] !== c) j += text[j] === '\\' ? 2 : 1; } else if (c === '{') open.push(j); else if (c === '}') open.pop();
          }
          const method = open.length > 1 ? open[1] : 0;
          if (!/\bSDK_INT\b/.test(text.slice(method, m.index)) && !/@(?:RequiresApi|TargetApi)\b/.test(text.slice(Math.max(0, method - 300), method))) found.push(m[0].replace(/\s+/g, '') + ' with no SDK_INT test before it in its method');
        }
      });
    return found;
  };
  {
    const sample = (body) => 'class V { static int f(int x) { return Build.VERSION.SDK_INT >= 23 ? x : 0; }\n void paint(RemoteViews views) { String s = "{"; ' + body + ' } }';
    const verdict = (body) => tooNew(sample(body)).length;
    eq([verdict('views.setColorStateList(1, "m", null);'), verdict('if (Build.VERSION.SDK_INT >= 31) { views.setColorStateList(1, "m", null); }'), verdict('views.setBoolean(1, "setClipToOutline", true);'), verdict('map.getOrDefault("a", 1);'), verdict('views.setInt(1, "setColorFilter", 2);')],
      [1, 0, 1, 1, 0], '(the API reader can fail: a version test in ANOTHER method does not cover a call, one in the same method does — and a "{" inside a string does not confuse it)');
  }
  eq(javaFiles.reduce((out, f) => out.concat(tooNew(read(f)).map((what) => short(f) + ': ' + what)), []), [],
    'nothing under src/main/java needs more than API 22 unguarded: no java.time / streams / Optional / java.util.function, no Map.getOrDefault, List.sort or Iterable.forEach, no getSystemService(Class), and API 23+ framework calls only after a Build.VERSION.SDK_INT test');

  // javac's first complaint in a project that grew a sub-package: R, and the classes of the package above, are
  // no longer in scope by themselves. Main classes only are looked for; tests and the debug activity are read too.
  const pkgOf = (src) => (/^\s*package\s+([\w.]+)\s*;/m.exec(src) || [])[1] || '';
  const allJava = javaFiles.concat(debugJava, testFiles);
  eq(allJava.filter((f) => { const root = f.indexOf('/java/'); return pkgOf(read(f)) !== path.dirname(f.slice(root + 6)).split('/').join('.'); }).map(short), [], 'every Java file\'s package line is its folder');
  const classPackage = { R: appId };
  javaFiles.forEach((f) => { classPackage[path.basename(f, '.java')] = pkgOf(read(f)); });
  const notImported = [];
  allJava.forEach((f) => {
    const src = read(f), body = codeOf(f).replace(/^\s*(?:package|import)\s[^;]*;/gm, '');
    Object.keys(classPackage).forEach((name) => {
      if (classPackage[name] === pkgOf(src) || !new RegExp('(^|[^\\w.])' + name + '\\b').test(body)) return;
      if (!new RegExp('^\\s*import\\s+' + esc(classPackage[name]) + '\\.(?:' + name + '|\\*)\\s*;', 'm').test(src)) notImported.push(short(f) + ': ' + classPackage[name] + '.' + name);
    });
  });
  eq(notImported, [], 'a class of ANOTHER package of the app — R included, seen from a sub-package — is imported wherever it is named (javac: "cannot find symbol")');

  // ── 13. The three plugins, the tap's way in, the stored snapshot ─────────
  // The bridge finds its native plugins BY NAME (Capacitor.Plugins.X). The iPhone app registers four in Swift;
  // Android registers twins of three under the SAME names and method shapes, so the bridge's existing path
  // drives the widget with no branch of its own. PsycleLiveActivity stays iPhone-only.
  t.section('Android widget: the three plugins the bridge finds by name, registered before super.onCreate; the tap\'s id is untrusted');
  const swiftPlugins = t.readSource('ios-app/ios/App/App/AppGroupPreferences.swift');
  const TWINS = { AppGroupPreferences: ['set', 'get', 'remove'], WidgetCenter: ['reloadAllTimelines'], PsycleDeepLink: [] };
  const pluginFiles = (jsName) => javaFiles.filter((f) => new RegExp('@CapacitorPlugin\\s*\\(\\s*name\\s*=\\s*"' + jsName + '"').test(textOf(f)));
  const activityCode = javaCode(activitySrc, false);
  const onCreate = methodBody(activityCode, 'onCreate');
  const superAt = onCreate.search(/\bsuper\s*\.\s*onCreate\s*\(/);
  Object.keys(TWINS).forEach((jsName) => {
    const files = pluginFiles(jsName), f = files[0] || '', cls = path.basename(f, '.java');
    ok(bridgeSrc.indexOf('Capacitor.Plugins.' + jsName) !== -1 && swiftPlugins.indexOf('jsName = "' + jsName + '"') !== -1, jsName + ': the bridge asks for Capacitor.Plugins.' + jsName + ', and the iPhone app registers it under that name');
    eq(files.length, 1, '…and ONE Java class carries @CapacitorPlugin(name = "' + jsName + '")' + (f ? ' (' + cls + ')' : ''));
    ok(!!f && new RegExp('\\bclass\\s+' + cls + '\\s+extends\\s+Plugin\\b').test(codeOf(f)) && /^import\s+com\.getcapacitor\.Plugin\s*;/m.test(read(f)) && /^import\s+com\.getcapacitor\.annotation\.CapacitorPlugin\s*;/m.test(read(f)),
      '…it extends com.getcapacitor.Plugin and imports the annotation');
    eq(TWINS[jsName].filter((m) => swiftPlugins.indexOf('CAPPluginMethod(name: "' + m + '"') === -1 || !new RegExp('@PluginMethod(?:\\s*\\([^)]*\\))?\\s+public\\s+void\\s+' + m + '\\s*\\(\\s*PluginCall\\s+\\w+\\s*\\)').test(f ? codeOf(f) : '')), [],
      '…with the iPhone plugin\'s methods, each a public @PluginMethod taking a PluginCall' + (TWINS[jsName].length ? ': ' + TWINS[jsName].join(', ') : ' (it has none: it only emits)'));
    const at = f ? onCreate.search(new RegExp('\\b' + cls + '\\s*\\.\\s*class\\b')) : -1;
    ok(superAt !== -1 && at !== -1 && at < superAt && /\bregisterPlugins?\s*\(/.test(onCreate.slice(0, superAt)), '…and MainActivity registers it BEFORE super.onCreate — that call builds the bridge from the list, and a plugin added after it is never found');
  });
  eq(pluginFiles('PsycleLiveActivity'), [], 'no PsycleLiveActivity on Android: a Live Activity has no twin, and the bridge skips what it cannot find');
  // The bridge asks for a repaint only after a snapshot pass that WRITES. After Settings → Apps → Clear storage
  // (a force-stop: the alarm is gone, no update broadcast arrives) it writes nothing — no bookings, no token —
  // and the launcher would keep the last class over an empty store. So every cold start asks, natively.
  {
    const refreshAt = onCreate.search(/\bNextClassWidgetProvider\s*\.\s*requestRefresh\s*\(\s*this\s*\)/);
    ok(superAt !== -1 && refreshAt > superAt, 'MainActivity.onCreate asks the widget to repaint at EVERY cold start, after super.onCreate: a wiped store shows as "Nothing booked" at once, and the repaint alarm is armed again');
    ok(/\bstatic\s+void\s+requestRefresh\s*\(/.test(widgetCode) && /\bcatch\s*\(\s*RuntimeException\b/.test(methodBody(widgetCode, 'requestRefresh')), '…through a method that cannot throw into the activity\'s start');
  }

  const prefsFile = pluginFiles('AppGroupPreferences')[0] || '';
  ok(/"psync_widget"/.test(allText) && /\bMODE_PRIVATE\b/.test(allCode) && !/\bMODE_(?:WORLD_\w+|MULTI_PROCESS)\b/.test(allCode), 'the snapshot lives in ONE private SharedPreferences file, "psync_widget"');
  ok(!!fullBackup && !!extraction && leaks(fullBackup, 'full-backup-content').concat(leaks(extraction, 'cloud-backup'), leaks(extraction, 'device-transfer')).filter((l) => /sharedpref/.test(l)).length === 0,
    '…which the backup rules above keep on the phone: the sharedpref domain is excluded whole, three times');
  const snapshotKeys = ['WIDGET_NEXT_KEY', 'WIDGET_UPCOMING_KEY', 'WIDGET_WEEK_KEY'].map(bridgeLiteral);
  eq(snapshotKeys, ['widget_next_class', 'widget_upcoming', 'widget_week'], 'the bridge writes three keys through AppGroupPreferences');
  eq(snapshotKeys.filter((k) => allText.indexOf('"' + k + '"') === -1), [], '…and the Java names each of them (the plugin stores those keys and no other)');
  ok(!!prefsFile && /\b(?:65536|65_536|0x10000)\b|\b64\s*\*\s*1024\b|\b1\s*<<\s*16\b/.test(allCode) && /\.\s*reject\s*\(/.test(codeOf(prefsFile)), '…and the plugin can refuse a call: a 64 KB bound is written down in the app\'s Java (whether `set` applies it is the JVM tests\' and a reviewer\'s business)');

  ok(/"openURL"/.test(allText) && /\bnotifyListeners\s*\([^;]*,\s*true\s*\)/.test(allCode), 'PsycleDeepLink emits "openURL" and RETAINS it until the bridge\'s listener attaches (a tap on the widget usually cold-starts the app)');
  ok(/"psync:\/\/bookings[^"]*"/.test(allText) && /event=/.test(allText), '…carrying psync://bookings?event=<id>, the iPhone widget\'s link, which the bridge already parses by hand');
  ok(/\\\\d\{1,12\}|\[0-9\]\{1,12\}/.test(allText) || (/\b12\b/.test(allCode) && /\bisDigit\b|'0'|\[0-9\]|\\\\d/.test(allText)),
    'the id comes from an intent extra, and ANY app can start the launcher activity with extras of its choosing: digits only, at most 12 of them, else the link carries no id');
  ok(/\bvoid\s+onNewIntent\s*\([^()]*\bIntent\s+\w+\s*\)/.test(activityCode) && /\bsuper\s*\.\s*onNewIntent\s*\(/.test(activityCode) && /\bsetIntent\s*\(/.test(activityCode),
    'MainActivity reads it in onCreate AND in onNewIntent (it is singleTask: a tap finds the live activity there), calling super — Capacitor\'s plugins read the intent too — and setIntent');
  const centreFile = pluginFiles('WidgetCenter')[0] || '';
  ok(!!centreFile && !!providerName && (new RegExp('\\b' + providerName + '\\b').test(codeOf(centreFile)) || new RegExp('^import\\s+' + esc(appId) + '\\.widget\\.[\\w*]+\\s*;', 'm').test(read(centreFile))),
    'WidgetCenter.reloadAllTimelines reaches the widget package by CLASS (the provider, or a helper beside it)');
  ok(!!providerName && new RegExp('\\b' + providerName + '\\s*\\.\\s*class\\b').test(allCode) && !/\bsendBroadcast\s*\(\s*new\s+Intent\s*\(\s*(?:"|[A-Z][A-Z0-9_.]*\s*\))/.test(allText),
    '…and the "repaint now" broadcast names the provider\'s class: explicit — never an Intent made of an action alone, which any app could send and any app could receive');

  // ── 14. Proof without a phone ────────────────────────────────────────────
  t.section('Android widget: a pure snapshot class with JVM tests CI runs, no new runtime dependency, the preview in DEBUG builds only');
  const importsAndroid = (f) => /^import\s+(?:static\s+)?androidx?\./m.test(read(f));
  ok(widgetFiles.some((f) => /^import\s+org\.json\./m.test(read(f)) && !importsAndroid(f)), 'the widget package holds a class that imports org.json and NOTHING from android.*: the snapshot\'s rules, which therefore run on a plain JVM');
  ok(testFiles.some((f) => /@Test\b/.test(codeOf(f)) && /^import\s+org\.junit\.Test\s*;/m.test(read(f))), 'app/src/test/java holds JUnit 4 tests: CI\'s testDebugUnitTest has something to run (with no sources that task PASSES, having proved nothing)');
  eq(testFiles.filter((f) => /^import\s+(?:static\s+)?(?:androidx?|org\.robolectric)\./m.test(read(f))).map(short), [], '…importing nothing from android.*, androidx.* or Robolectric (on the JVM android.jar is stubs that throw)');
  eq(testFiles.reduce((out, f) => out.concat(javaFiles.filter((c) => importsAndroid(c) && new RegExp('\\b' + path.basename(c, '.java') + '\\b').test(codeOf(f))).map((c) => short(f) + ' → ' + path.basename(c, '.java'))), []), [],
    '…and naming no class of the app that does');

  // app/build.gradle's dependencies block, line for line: the ONE new line is org.json for the JVM tests
  // (android.jar's org.json is a stub there). Anything else is a runtime dependency nobody could build.
  const dependencyLines = ((/\ndependencies \{\n([\s\S]*?)\n\}/.exec(appGradle) || [])[1] || '').split('\n').map((l) => l.replace(/\/\/.*$/, '').trim().replace(/'/g, '"')).filter(Boolean).sort();
  eq(dependencyLines, ['implementation fileTree(include: ["*.jar"], dir: "libs")', 'implementation "androidx.appcompat:appcompat:$androidxAppCompatVersion"',
    'implementation "androidx.coordinatorlayout:coordinatorlayout:$androidxCoordinatorLayoutVersion"', 'implementation "androidx.core:core-splashscreen:$coreSplashScreenVersion"',
    'implementation project(":capacitor-android")', 'implementation project(":capacitor-cordova-android-plugins")', 'testImplementation "junit:junit:$junitVersion"', 'testImplementation "org.json:json:20240303"',
    'androidTestImplementation "androidx.test.ext:junit:$androidxJunitVersion"', 'androidTestImplementation "androidx.test.espresso:espresso-core:$androidxEspressoCoreVersion"'].sort(),
    'app/build.gradle gained ONE dependency line — testImplementation "org.json:json:20240303" — and no implementation / api line at all');
  const gradleText = ['build.gradle', 'app/build.gradle', 'variables.gradle', 'settings.gradle', 'gradle.properties'].map((f) => read(ANDROID + '/' + f)).join('\n').replace(/\/\/.*$/gm, '');
  ok(!/kotlin|compose|glance/i.test(gradleText) && walk(ANDROID + '/app/src').filter((f) => /\.kts?$/.test(f)).length === 0, 'no Kotlin, no Compose, no Glance: plain Java and RemoteViews');

  // The preview activity: the provider's own RemoteViews, shown with apply() — in DEBUG builds only.
  const PREVIEW = DEBUG + '/java/' + appId.split('.').join('/') + '/WidgetPreviewActivity.java';
  const sourceSets = walk(ANDROID + '/app/src').filter((f) => f.indexOf(MAIN + '/assets/') !== 0 && /\.(?:java|xml)$/.test(f));
  eq(sourceSets.filter((f) => /(^|\/)WidgetPreviewActivity\.java$/.test(f)), [PREVIEW], 'WidgetPreviewActivity.java exists under app/src/debug/, and nowhere else');
  const uncommented = (f) => (/\.java$/.test(f) ? javaCode(read(f), true) : read(f).replace(/<!--[\s\S]*?-->/g, ''));
  eq(sourceSets.filter((f) => f.indexOf(DEBUG + '/') !== 0 && /WidgetPreview/.test(uncommented(f))).map(short), [], 'nothing outside app/src/debug/ names it (a comment may) — not the main manifest, not a class a release build compiles');
  ok(!/WidgetPreview/.test(appGradle), '…and app/build.gradle does nothing to carry it elsewhere');
  let debugManifest = null;
  try { debugManifest = parseXml(read(DEBUG + '/AndroidManifest.xml')); } catch (e) { debugManifest = null; }
  const debugElements = debugManifest ? debugManifest.elements : [];
  ok(!!debugManifest && debugManifest.root.name === 'manifest', 'app/src/debug/AndroidManifest.xml parses (the merger adds it to DEBUG builds only)');
  eq(debugElements.filter((e) => ['activity', 'activity-alias', 'service', 'receiver', 'provider'].indexOf(e.name) !== -1).map((e) => e.name + ' ' + fqcn(e.attrs['android:name']) + ' exported=' + e.attrs['android:exported']),
    ['activity ' + appId + '.WidgetPreviewActivity exported=true'], 'it declares ' + appId + '/.WidgetPreviewActivity — exported, so CI\'s `adb shell am start -n` may open it — and no other component');
  eq(debugElements.filter((e) => e.name === 'uses-permission' || e.name === 'data' || (e.name === 'category' && /LAUNCHER/.test(e.attrs['android:name'] || ''))).map((e) => e.name), [], '…no permission, no URL scheme, no second launcher icon');
  // The DEBUG build is also the one a person sideloads onto a signed-in phone. Exported with no permission, any
  // app there could start the preview with words of its choosing, under the app's name. DUMP is held by the adb
  // shell and by no app a member can install (signature|privileged|development): naming it asks for nothing.
  eq(debugElements.filter((e) => e.name === 'activity').map((e) => e.attrs['android:permission']), ['android.permission.DUMP'], '…and only adb may start it: android:permission="android.permission.DUMP" on the activity (named, not requested)');
  eq(walk(DEBUG).filter((f) => /\.xml$/.test(f)).map((f) => { const r = parses(read(f)); return r === true ? null : short(f) + ': ' + r; }).filter(Boolean), [], 'every XML under app/src/debug/ is well-formed');
  const previewCode = has(PREVIEW) ? codeOf(PREVIEW) : '', previewText = has(PREVIEW) ? textOf(PREVIEW) : '';
  ok(/\.\s*apply\s*\(/.test(previewCode) && new RegExp('^import\\s+' + esc(appId) + '\\.widget\\.[\\w*]+\\s*;', 'm').test(read(PREVIEW)), 'it shows RemoteViews with apply(), built by a class of the widget package: the provider\'s own builder, not a copy of it');
  ok(/\bgetStringExtra\s*\(/.test(previewCode) && previewText.indexOf('"snapshot"') !== -1, 'it reads STRING extras (what `am start --es` sends), a whole snapshot among them ("snapshot")');
  // apply() refusing a view or a call is the nearest thing here to a launcher's "Problem loading widget". A
  // caption in a screenshot holds one wrapped line of it; the log holds the cause — and CI's verdict reads the log.
  {
    const tag = (/\bString\s+TAG\s*=\s*"([A-Za-z]+)"/.exec(previewText) || [])[1] || '';
    ok(!!tag && /\bcatch\s*\(\s*RuntimeException\s+(\w+)\s*\)\s*\{[^}]*\bLog\s*\.\s*e\s*\(\s*TAG\s*,\s*"[^"]*"\s*,\s*\1\s*\)/.test(previewText) && /^import\s+android\.util\.Log\s*;/m.test(read(PREVIEW)),
      'a widget it cannot draw is LOGGED as an error, exception and all (Log.e(TAG, …, e)), not only captioned');
    ok(!!tag && script.indexOf("! grep -q '" + tag + "' android-smoke/logcat-widget.txt") !== -1, '…under the tag CI\'s emulator script greps logcat-widget.txt for ("' + tag + '")');
  }
  ok(/\.\s*forBucket\s*\([^;]*\bfontScale\s*\)/.test(previewCode) && /\.\s*fontScale\b/.test(previewCode), '…it hands the system\'s font scale to the plan, as the provider does');
  ok(/\bMath\s*\.\s*min\s*\(\s*asked\s*,\s*room\s*\)/.test(previewCode) && /\bwidthPixels\b/.test(previewCode), '…and draws a frame no wider than the screen has room for (the caption says when it asked for more): never a card with both ends under the page\'s padding');
  const passedExtras = [];
  previews.forEach((x) => Object.keys(extrasOf(x.l)).forEach((k) => { if (passedExtras.indexOf(k) === -1) passedExtras.push(k); }));
  eq(passedExtras.filter((k) => previewText.indexOf('"' + k + '"') === -1), [], 'every extra CI\'s emulator script passes (' + passedExtras.join(', ') + ') is one the activity reads: a name it does not know is a picture of the wrong state, labelled as the right one');
  eq(previews.map((x) => extrasOf(x.l).sample).filter((v) => v !== undefined && previewText.indexOf('"' + v + '"') === -1), [], '…and the built-in sample it asks for by name ("off": class colours off) is one the activity has');
  const debugRes = walk(DEBUG + '/res');
  const inDebugRes = (type, name) => debugRes.some((f) => { const parts = f.slice((DEBUG + '/res/').length).split('/'); return (parts[0].split('-')[0] === type && parts[1].split('.')[0] === name) || (/\.xml$/.test(f) && new RegExp('@\\+id/' + name + '["\']|\\bname="' + name + '"').test(read(f))); });
  eq(rRefs(previewCode).filter((r) => javaNames(r[0]).indexOf(r[1]) === -1 && !inDebugRes(r[0], r[1])).map((r) => 'R.' + r[0] + '.' + r[1]), [], 'every R.<type>.<name> it names is a resource of src/main/res or src/debug/res');
};
