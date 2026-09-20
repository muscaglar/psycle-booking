# Build, CI and tests — build.js, the plugin patcher, the npm scripts, how the suites work
Read this when a check fails, you add a suite or a `pure:<name>` block, or you touch ios-app/build.js, patch-plugins.js or .github/workflows/ci.yml. Skip it when the commands in [AGENTS.md](../../AGENTS.md) are all you need. Browser verification against a stub is in tests/README.md.

## Build & CI
- `cd ios-app && npm run build` — deterministic www/ flatten (auto-discovers js/css modules and fonts), regenerates
  the SW `SHELL` list and stamps a content-hashed `CACHE` version into both sw.js copies (no manual bumps).
  Run it after editing anything in root `js/`, `css/`, `*.html`, `manifest.json` or `sw.js`, and commit the result.
  `npm run sync` = patch plugins + build + `cap sync ios`; `npm run build:open` = sync + open Xcode. `npm run sync` is
  iOS-ONLY and stays so (Xcode Cloud runs it). Android has its own: `npm run sync:android` = build + `cap sync android`
  (no plugin patch: the patcher edits Swift only), `npm run open:android`, `npm run android:debug` = sync:android +
  `./gradlew assembleDebug` — see [android.md](android.md).
- `ios-app/patch-plugins.js` — dependency-free anchored-edit patcher for native plugin source in
  node_modules (currently: `timeZone` support in @ebarooni/capacitor-calendar 6.7.2 — see Calendar contract — and a scene-aware presentation window in @capacitor/ios 6.2.1 — see iOS App → Scene life cycle).
  Runs on `postinstall` (so `npm ci` on Xcode Cloud / GH Actions patches before `cap sync`) and at the top of
  `npm run sync`; pinned to the exact plugin version and FAILS LOUD on upstream drift. `npm run patch:check` verifies.
- `npm run sync:check` (or root `npm run drift`) — fails if www/ or the SW cache stamp drifted from source (CI + pre-commit; see ios-app/PRECOMMIT.md).
- Root: `npm run check` (node --check on js/*.js, sw.js, ios-app/build.js, ios-app/patch-plugins.js and
  ios-app/www/native-bridge.js), `npm test` (tests/unit.js — see Tests below), `npm run typecheck`
  (advisory tsc --checkJs), `npm run ci` (check + test + drift).
- CI in .github/workflows/ci.yml: check → test → drift → iOS deps + `patch:check` → smoke page in headless Chrome
  (advisory; every host but loopback is unresolvable) → typecheck (advisory) → `agents:check` (advisory). A second job
  compiles the full native project unsigned for the simulator on main pushes / manual dispatch. TestFlight delivery is
  Xcode Cloud's (ios-app/CICD.md): every push to main archives and uploads. Two Android jobs ([android.md](android.md)):
  `android-build` — on `main` and `android/**` pushes and manual dispatch — runs `npm ci`, `npm run sync:android` and
  `./gradlew assembleDebug`, uploads the debug APK as the artifact `psync-debug-apk`, then an advisory `:app:lintDebug`;
  it is the ONLY compiler the Android project has. `android-smoke` — advisory, `android/**` pushes and manual dispatch —
  installs that APK on an emulator, launches it, sends one Back key and uploads two screenshots and a log. It never
  taps. tests/suites/19-android-project.js holds both jobs' shape, and that the bootstrap workflow is gone.
- tests/smoke.html — load in a browser/sim to assert every module loads in production order and the critical
  globals exist (title → "SMOKE: PASS"). It stubs `fetch`, so it cannot reach the live API.

### Tests
- tests/unit.js runs as a non-UK device (`TZ=America/New_York`) so a device-local parse of a gym time shows up as a failure.
- Every `tests/suites/*.js` exports `function (t) {}` (sync or async) and is auto-loaded in filename order after the
  built-in checks. `t` carries `ok, eq, section, vm, fs, path, REPO_ROOT, JS_DIR, makeFakeLocalStorage, readSource, loadPure`.
  00-harness.js installs a drain guard: a suite that awaits something that never settles fails the run (exit 1)
  instead of ending it silently.
- `t.loadPure(file, name, globals)` evaluates the DOM-free helpers a module marks with
  `// ── pure:<name>:start` … `// ── pure:<name>:end` (a pair may repeat in one file; regions are concatenated) in a
  fresh vm context. Keep those blocks free of DOM and app globals. The original waitlist block keeps its older
  `waitlist:pure:start/end` spelling and is evaluated by tests/unit.js itself.
- Several suites go further and slice SHIPPED source by anchor lines (a top-level `function name(` opener down to
  its closing bare `}`, or the text between two anchor strings) and run the real function against fakes. Moving or
  renaming such a function, or changing its indentation, breaks the slice — the suite says "anchor moved?" rather
  than passing quietly. Any suite that drives a booking / waitlist / swap failure path must also grab `_friendlyError`.

**After a push to `main`** the Xcode Cloud check on the commit is the only proof that a TestFlight build exists — missing, `cancelled` or `action_required`: agents/playbooks.md P10. `sh ios-app/native-checks/run.sh` varies the locale, the 12-hour override and the calendar, NOT the time zone (agents/playbooks.md P7 step 2). `npm run agents:check` is not part of `npm run ci`; .github/workflows/ci.yml runs it as an advisory step only, so a stale index never fails anything.
