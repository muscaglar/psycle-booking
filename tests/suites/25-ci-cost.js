'use strict';
// What CI runs, and what it skips (.github/workflows/ci.yml, .github/scripts/changed-areas.js).
//   • a push to a branch that has a pull request used to run everything twice; a newer push left the older run going;
//   • every push to `main` compiled the iPhone project on macOS and built an Android APK, whatever it changed.
// Now: `main`, `android/**`, pull requests and manual runs only; a newer push cancels the older run; and the
// native jobs read what the push changed. The rules are a pure function, so they are RUN here, on the file lists
// of real kinds of push; the workflow's wiring is read as text. It fails open: unsure means build.
module.exports = function (t) {
  const { ok, eq } = t;
  const path = require('path');
  const ci = t.readSource('.github/workflows/ci.yml');
  const script = t.readSource('.github/scripts/changed-areas.js');
  const { areasFor, usableSha } = require(path.join(t.REPO_ROOT, '.github', 'scripts', 'changed-areas.js'));
  const plain = ci.replace(/^[ \t]*#.*$/gm, ''); // comments say what the rules are NOT
  const job = (id) => (new RegExp('\\n {2}' + id + ':[ \\t]*\\n[\\s\\S]*?(?=\\n {2}[A-Za-z_][\\w-]*:[ \\t]*\\n|$)').exec(plain) || [''])[0];
  const jobIf = (text) => (/\n {4}if: (.*)/.exec(text) || [])[1] || '';
  const step = (text, name) => { const at = text.indexOf('- name: ' + name); if (at === -1) return ''; const next = text.indexOf('\n      - name:', at + 1); return text.slice(at, next === -1 ? text.length : next); };
  const tri = (a) => [a.ios, a.android, a.android_src];

  t.section('CI cost: which native builds a push needs (the rules, run)');
  {
    eq(tri(areasFor(['js/app.js', 'css/crisp.css', 'sw.js', 'ios-app/www/app.js', 'ios-app/www/crisp.css', 'ios-app/www/sw.js', 'tests/suites/9d-bookings.js', 'agents/HANDOVER.md'])), [false, true, false],
      'a web change: no macOS compile (the web app is resources, not code the compiler reads); a new APK, because the APK carries it; no lint');
    eq(tri(areasFor(['agents/HANDOVER.md', 'README.md', 'tests/suites/copy.js', 'AGENTS.md', 'privacy.html', 'ios-app/ANDROID.md', 'ios-app/APP_STORE_LISTING.md'])), [false, false, false],
      'docs, tests and the two public pages alone: neither native build (privacy.html and support.html are not in the app shell)');
    eq(tri(areasFor(['ios-app/ios/App/App/AppDelegate.swift'])), [true, false, false], 'Swift: the macOS compile, and no Android build');
    eq(tri(areasFor(['ios-app/ios/App/App.xcodeproj/project.pbxproj'])), [true, false, false], 'the Xcode project: the macOS compile');
    eq(tri(areasFor(['ios-app/ios/App/Podfile.lock'])), [true, false, false], 'the pods: the macOS compile');
    eq(tri(areasFor(['ios-app/android/app/src/main/java/com/psyclefinder/app/MainActivity.java'])), [false, true, true], 'Java: the Android build and its lint, and no macOS compile');
    eq(tri(areasFor(['ios-app/android/app/src/main/res/layout/widget_next_class.xml'])), [false, true, true], 'an Android resource: the same');
    eq(tri(areasFor(['ios-app/www/native-bridge.js'])), [false, true, false], 'the bridge is JavaScript both apps LOAD: a new APK, no compile');
    eq(tri(areasFor(['ios-app/package-lock.json'])), [true, true, true], 'a plugin bump: both, and lint (a plugin is native code on both sides)');
    eq(tri(areasFor(['ios-app/package.json'])), [true, true, true], '…and so is package.json');
    eq(tri(areasFor(['ios-app/capacitor.config.json'])), [true, true, true], 'the one Capacitor config: both');
    eq(tri(areasFor(['ios-app/patch-plugins.js'])), [true, false, false], 'the plugin patcher edits Swift: the macOS compile');
    eq(tri(areasFor(['ios-app/build.js'])), [true, true, false], 'build.js is the first step of both syncs: both builds');
    eq(tri(areasFor(['.github/workflows/ci.yml'])), [true, true, true], 'a change to the workflow re-proves everything');
    eq(tri(areasFor(['.github/scripts/changed-areas.js'])), [true, true, true], '…and so does a change to these rules');
    eq(tri(areasFor(['.github/workflows/android-release.yml'])), [false, false, false], 'the manual release workflow is not this one');
    eq(tri(areasFor(['js/app.js', 'ios-app/ios/App/PsycleWidget/PsycleWidget.swift'])), [true, false, false], 'one native file among web files is enough');
  }

  t.section('CI cost: a name that only LOOKS like a native path builds nothing');
  {
    eq(tri(areasFor(['ios-app/ANDROID.md', 'agents/architecture/android.md', 'agents/architecture/ios.md', 'ios-app/ios-notes.md', 'docs/ios-app/ios/x.swift', 'xios-app/android/a.java'])), [false, false, false],
      'the rules are anchored at the start of the path and end their folder names with a slash');
    eq(tri(areasFor(['ios-app/package.json.bak', 'ios-app/capacitor.config.json5', 'ios-app/build.js.map'])), [false, false, false], '…and a file name is matched whole');
    eq(tri(areasFor([])), [false, false, false], 'a push that changed no file builds nothing');
    eq(tri(areasFor(['', '  ', null, undefined])), [false, false, false], 'blank lines of a diff are not paths');
    eq(tri(areasFor(['  ios-app/ios/App/App/AppDelegate.swift  '])), [true, false, false], 'a path is trimmed before it is judged');
  }

  t.section('CI cost: unsure means BUILD');
  {
    eq([undefined, null, 'ios-app/ios/x.swift', 7, {}].map((v) => tri(areasFor(v))), [[true, true, true], [true, true, true], [true, true, true], [true, true, true], [true, true, true]],
      'anything but a list of files answers yes to all three');
    const sha = 'a'.repeat(40);
    eq([usableSha(sha), usableSha(' ' + sha + '\n'), usableSha('0'.repeat(40)), usableSha(''), usableSha(undefined), usableSha(sha.slice(1)), usableSha(sha.toUpperCase()), usableSha('$(touch /tmp/x)'), usableSha(sha + ';ls'), usableSha('--upload-pack=x')],
      [sha, sha, '', '', '', '', '', '', '', ''],
      'a commit id is 40 lower-case hex digits and not the all-zero "no commit before": anything else is no id at all (it is handed to git as an argument)');
    ok(/if \(event === 'push' && before && after\) \{/.test(script) && /let areas = Object\.assign\(\{\}, ALL\);/.test(script),
      'the answer STARTS as yes to everything, and only a push with both ids can narrow it');
    ok(/\} catch \(e\) \{\s*why = 'could not read the change/.test(script) && !/process\.exit\(/.test(script), 'a git error keeps that answer and the step still succeeds');
    ok(/execFileSync\('git', args,/.test(script) && !/\bexec\(|execSync\(|shell: true/.test(script), 'git is run with an argument array: no shell reads the ids');
    ok(/git\(\['fetch', '--no-tags', '--depth=1', 'origin', before\]\)/.test(script), 'the old head is fetched alone, one commit deep (two trees are all a diff needs)');
  }

  t.section('CI cost: the workflow — when it starts, and what a newer push does');
  {
    const on = (/\non:\n([\s\S]*?)\n(?=[a-z])/.exec(plain) || [])[1] || '';
    eq((/ {2}push:\n {4}branches:\n((?: {6}- .*\n?)+)/.exec(on + '\n') || ['', ''])[1].trim().split('\n').map((l) => l.trim()), ['- main', "- 'android/**'"],
      'a push starts it on `main` and `android/**` only: any other branch is covered by its pull request, once');
    ok(/\n {2}pull_request:/.test('\n' + on) && /\n {2}workflow_dispatch:/.test('\n' + on), 'pull requests and manual runs still start it');
    ok(!/\n {2}schedule:/.test('\n' + on), 'nothing runs on a timer');
    ok(/\nconcurrency:\n {2}group: ci-\$\{\{ github\.event_name \}\}-\$\{\{ github\.ref \}\}\n {2}cancel-in-progress: true\n/.test(plain),
      'one run per event and branch: a newer push cancels the run still going for the older one, and never a run started by hand');
    ok(/\npermissions:\n {2}contents: read\n/.test(plain), 'every job starts from a read-only token');
    const ids = (plain.match(/\n {2}([A-Za-z_][\w-]*):[ \t]*\n {4}name:/g) || []).map((m) => /([A-Za-z_][\w-]*):/.exec(m)[1]);
    eq(ids, ['ci', 'changes', 'ios-build', 'android-build', 'android-smoke'], 'five jobs');
    eq(ids.filter((id) => !/\n {4}timeout-minutes: \d+\n/.test(job(id))), [], 'every job has a timeout (the default is six hours)');
    eq((plain.match(/uses: [^\n]+/g) || []).map((u) => u.replace(/\s+#.*$/, '').slice(6)).filter((u) => !/^actions\/[a-z-]+@v\d+$/.test(u) && !/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/.test(u)), [],
      'every action is GitHub\'s own at a major version, or pinned to a commit');
  }

  t.section('CI cost: the workflow — the native jobs read what changed');
  {
    const changes = job('changes');
    eq((changes.match(/\n {6}(\w+): \$\{\{ steps\.areas\.outputs\.(\w+) \}\}/g) || []).map((l) => l.trim()), ['ios: ${{ steps.areas.outputs.ios }}', 'android: ${{ steps.areas.outputs.android }}', 'android_src: ${{ steps.areas.outputs.android_src }}'],
      'the job hands on the three answers the script writes');
    eq(Object.keys(areasFor([])), ['ios', 'android', 'android_src'], '…under the names the script uses');
    const read = step(changes, 'Read what the push changed');
    ok(/\n {8}id: areas\n/.test(read) && /\n {8}run: node \.github\/scripts\/changed-areas\.js\n?/.test(read), 'one step runs the script');
    ok(/EVENT: \$\{\{ github\.event_name \}\}/.test(read) && /BEFORE: \$\{\{ github\.event\.before \}\}/.test(read) && /AFTER: \$\{\{ github\.sha \}\}/.test(read), '…given the event, the old head and the new one as environment variables');
    eq((changes.match(/\n\s+run: [^\n]*\$\{\{/g) || []).length, 0, '…and no ${{ }} expression is written into a command');
    ok(/persist-credentials: false/.test(changes) && !/fetch-depth: 0/.test(changes), 'its checkout leaves no token behind and does not fetch the history');

    const ios = job('ios-build');
    ok(/\n {4}needs: changes\n/.test(ios), 'the iPhone compile waits for the answer');
    eq(jobIf(ios), "github.event_name == 'workflow_dispatch' || (github.event_name == 'push' && github.ref == 'refs/heads/main' && needs.changes.outputs.ios == 'true')",
      '…and runs on a manual run, or on a push to main that changed an input of the compile');
    ok(/\n {4}runs-on: macos-15\n/.test(ios), '(it is the one macOS job)');
    eq((plain.match(/runs-on: macos/g) || []).length, 1, '(…and the only one)');

    const android = job('android-build');
    ok(/\n {4}needs: changes\n/.test(android), 'the Android build waits for the answer');
    eq(jobIf(android), "github.event_name == 'workflow_dispatch' || (github.event_name == 'push' && (startsWith(github.ref, 'refs/heads/android/') || (github.ref == 'refs/heads/main' && needs.changes.outputs.android == 'true')))",
      '…and runs on a manual run, on EVERY push to an android/** branch (CI is the compiler there), and on a push to main that changes the APK');
    const lint = step(android, 'Android lint');
    ok(/\n {8}if: github\.event_name == 'workflow_dispatch' \|\| needs\.changes\.outputs\.android_src == 'true'\n/.test(lint), 'lint runs when the Android sources changed (over the same sources it says the same thing)');
    eq(['JVM unit tests', 'The countdown\'s JVM tests ran', 'Compile (debug APK)', 'Upload the debug APK'].filter((n) => /\n {8}if:/.test(step(android, n))), [],
      '…while the tests, the proof that they ran, the compile and the upload carry no condition: a job that runs, runs them all');
    const java = step(android, 'Setup JDK 17');
    ok(/\n {10}cache: gradle\n/.test(java) && /cache-dependency-path: \|\n(?: {12}.+\n)+/.test(java) && /gradle-wrapper\.properties/.test(java) && /ios-app\/package-lock\.json/.test(java),
      'Gradle\'s downloads are kept between runs, keyed on the Gradle files, the wrapper and the npm lockfile (a plugin\'s Android module comes from node_modules)');
    ok(/\n {4}needs: android-build\n/.test(job('android-smoke')), 'the emulator smoke still follows the build: skipped with it');
  }

  t.section('CI cost: the script is checked like the rest');
  {
    const pkg = JSON.parse(t.readSource('package.json'));
    ok(pkg.scripts.check.indexOf("'.github/scripts/changed-areas.js'") !== -1, '`npm run check` parses it');
    ok(/^#!\/usr\/bin\/env node\n/.test(script) && /\nmodule\.exports = \{ areasFor, usableSha \};\nif \(require\.main === module\) main\(\);\n$/.test(script), 'it runs as a command and loads as a module (which is how this suite reads it)');
  }
};
