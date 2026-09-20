# tests/ — read before editing here
How a change is proved without touching Psycle: the Node runner, its suites, the smoke page, the fake Psycle server. The repo-wide rules are in the root [AGENTS.md](../AGENTS.md) — this file adds only what is local.

## Rules that bite here
Rule → why → guard. A bare `name.js` is in suites/.
1. **`npm test` = unit.js, then every suites/*.js in filename order, as `TZ=America/New_York` ON PURPOSE** → a device-local parse of a gym time shows up as a failure; never change the zone → `process.env.TZ` in unit.js. No arguments: no single-suite filter.
2. **A suite exports `function (t) {}`, sync or async; nothing to register.** `t` = `ok, eq, section, vm, fs, path, REPO_ROOT, JS_DIR, makeFakeLocalStorage, readSource, loadPure`. `t.eq` compares `JSON.stringify` output: key order counts, and NaN / `undefined` / `null` are indistinguishable inside an array or object → assert those with `t.ok(Number.isNaN(x))` / `t.ok(x === undefined)`. Awaiting what never settles fails the run (it used to exit 0, later suites unrun) → the drain guard in `00-harness.js`, which must sort first.
3. **`t.loadPure(file, name, globals)` evaluates the file's `pure:<name>` regions, concatenated, in a fresh vm, and returns the context** (it throws "no pure:<name> markers found"). The vm holds ONLY `console, Date, Math, JSON, Intl, Set, Map, Number, String, Array, Object, isNaN, parseInt, parseFloat` plus your `globals` → hand in `setTimeout`, `URL` or another block's helper. Only `function` / `var` at the top level of the CUT REGION are reachable (a block indented inside a module's IIFE, as js/reliability.js `pure:retry-auth`, is fine); blocks nest, so add a fake AFTER the load (learnings B2) → `00-harness.js`.
4. **A new `pure:<name>` block** names its suite in its start marker and joins two hand-kept lists no suite guards: README.md §1's "Blocks exist today in …" and the agents/repo-map.md "Where to Edit" row of its area (pure-blocks.md is generated). A copyable suite, the marker pair and the rules for a block: README.md §1 → "Suites" and "`t.loadPure(file, name, globals)` and `pure:<name>` markers" (skip "How it works"); the shortest real model is the first section of `retry-signout.js`.
5. **On "(anchor moved?)" (root rule 7) fix the anchor, never loosen the assertion** → before moving code, who slices or anchors it: `grep -n "js/<file>" agents/index/tests.md`.
6. **A suite driving a booking / waitlist / swap failure path also grabs `_friendlyError`** → it words every error thrown there, and a sliced function runs without its module → as `booking-races.js` does.
7. **Never edit unit.js's built-in checks or js/app.js's `waitlist:pure` block to make a test pass** → they pin `escapeHTML`, `PsycleAPI`, `PsycleDiag`, the London resolver and the waitlist rules → unit.js runs that block itself.
8. **smoke.html answers every fetch itself (200, never 401) before the first app script; its script list must match psycle-finder.html's, in order** → `shell.js`. It proves only that every module loads (no recorders, no timetable): a write count or any flow needs rule 9.
9. **tools/fake-psycle.js (`window.__H`) is the fake Psycle server for whole-app browser runs**; suites themselves use no network. Playbooks P8: boot = step 3 (ONE `__H.boot()` per page load), drive = step 4, count writes = step 5, stage failures = step 6; the "exactly ONE write, no second write after a failure, a double tap sends nothing" checklist = P2 step 6. End on `__H.writes` (only what you meant) and `__H.leaked`, `__H.liveHits()`, `__H.unknown` (all empty: an unscripted request gets a 404, which the whole-cancel paths read as "gone"). Stage failures with `__H.taken`, `__H.fail` (a 503) and `__H.delayMs`, and clear them between cases. NOT modelled: waitlist places (the PUT succeeds, nothing is kept), a refused `POST /bookings`, past bookings.

## What is in here
| Path | Holds | Index |
|---|---|---|
| unit.js | Zone pin, browser shim, `t`, `loadPure`, the built-in checks, then the suites | [README.md](README.md) §1 |
| suites/ | One file per feature area | [agents/index/tests.md](../agents/index/tests.md): what each loads and slices · [pure-blocks.md](../agents/index/pure-blocks.md) |
| smoke.html | Every module in production order, in a browser: title `SMOKE: PASS` | README.md §2 |
| tools/fake-psycle.js | Rule 9 | Its header · README.md → "Driving the app against a stubbed API" |
| tools/appstore-shots.mjs · tools/appstore-capture.html | Rebuild the six App Store screenshots on the fake server | playbooks P9 |

README.md is the long form (≈ 6,200 tokens): read one section. No symbols file covers tests/.
Digit-led suites are `<wave>[<lane>]-<topic>.js` (`1f-…`, `10a-…`, `17-…`); a bare `<area>.js` is a feature area. String order: `00-harness.js`, `10a-` before `1f-`, names last.

| Area | Start with |
|---|---|
| Loader · script order, smoke, CI steps | `00-harness.js` · `shell.js` |
| Booking, cancel, error wording | `booking.js` · `booking-races.js` |
| Retry, optimistic UI, offline queue (js/reliability.js) | `retry-signout.js` (`pure:retry-auth`) · `offline-queue.js` (`pure:offline-queue`) · `reliability.js` (evaluates the whole module; loads only app.js's `pure:booking`) |
| Waitlist · usual week | `waitlist-polish.js` · `weekly-template.js`, `14a-usual-week-sheet.js` |
| Discover · London time | `window.js`, `8b-day-pager.js` · `bookings-card.js`, `10a-time24.js` |
| Session · iOS bridge | `session.js` · `ios-bridge.js` (it also EXPORTS its fake shell: `require('./ios-bridge.js').harness(t)` → `boot`, `flush`, …) |
| The Android app | `18-android.js` (Back's decision and actor — and the shipped `bookClass` it sits over — Android copy, the bridge booted as `'android'`, a forged notification tap, and the iPhone path held to a digest of its plugin calls) · `19-android-project.js` (reads ios-app/android/: the manifest and both backup rule files, MainActivity, signing material, every res/ XML and reference, the CI jobs, and the widget's Java and layouts — its one-line styles, its plan's constants against the XML's numbers, the alarm's `finally`; it cannot compile anything) · `20-android-widget.js` (the bridge booted as `'android'` WITH the three plugin twins, on 18's `launch`: what the widget's store receives, a retained and a hostile tap, sign-out against expiry, the twins' names against the Java, the JVM tests' copy of the class-colour palette against js/theme.js). The widget's own rules are JVM tests under ios-app/android/app/src/test/, which only CI runs |
| These docs | `15-agents-index.js` is only ADVISORY about index drift · `16-agents-docs.js` holds the reading guide and agents/README.md's lists to the files on disk, each folder guide's shape, and the handover's session log (first section, newest first, 1–10 entries, 160 lines) |
| Any other module | `grep -n "js/<file>" agents/index/tests.md`: the suites that load, slice or anchor it |

## After you edit
```bash
node tests/unit.js > /tmp/unit.log 2>&1; grep -E "✗|passed,|stopped before|crashed" /tmp/unit.log   # any writable path
npm run agents:index   # after the last edit to a suite or a tools/ file: both are indexed; then `npm run agents:check` exits 0
npm run ci             # check + test + drift, as CI runs them
```
Nothing in tests/ ships: an edit here alone needs no `cd ios-app && npm run build`. A suite written for a js/ edit follows js/AGENTS.md's loop as well (build + drift). How a stretch of work ends: playbooks P0 step 6.

## Read next
- [agents/architecture/testing-and-ci.md](../agents/architecture/testing-and-ci.md) — suites, build, CI.
- [agents/learnings.md](../agents/learnings.md) — section B (tests), section H (browser checks).
- [agents/playbooks.md](../agents/playbooks.md) — P0 the loop, P2 booking flows, P8 the fake server, P9 screenshots.
- [agents/architecture/api.md](../agents/architecture/api.md) for a stub · [time.md](../agents/architecture/time.md) before a time assertion.
