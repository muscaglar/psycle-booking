# Psync — start here
The entry for any agent or developer arriving cold: the rules that must not be broken, the commands, and a table that routes you to the one other file your task needs. Read this when you start work here — all of it, it is short. Skip everything under agents/ until the reading guide below sends you there.

The app ships under the name **Psync**: a vanilla-JS PWA (no framework, no bundler) plus a Capacitor 6 wrapper for
iOS and Android — two native shells around ONE ios-app/www/ and one bridge (the folder name ios-app/ is historical).
It is an independent companion for Psycle London members and talks to Psycle's own customer API.
See README.md for the overview, SETUP.md for the iOS toolchain, ios-app/ANDROID.md for the Android app,
tests/README.md for testing, and IMPROVEMENTS-2026-09.md for the audit trail of the September 2026 improvement programme.

## Hard rules
**Hard rule:** `https://psycle.codexfit.com` is a real booking system. Tests, scripts and browser checks must never
send it a write (POST / PUT / DELETE). Everything is verified against a stubbed API — see tests/README.md.

1. **Stub before you click.** Drive a browser only against tests/tools/fake-psycle.js (a fake Psycle server for a page) or tests/smoke.html (it answers every fetch itself). If you are not certain a flow is stubbed, do not click through it.
2. **A spend is never silent, and a `POST /bookings` is never re-sent.** Nothing is booked, claimed or joined unless the member saw it and confirmed it. A timeout, 5xx or 409 proves nothing: the attempt is settled by re-reading `/bookings` (`_settleUnverifiedBooking` → `_bookingOutcome`), and a button reads ✓ + `.booked` only when `/bookings` shows the seat. Read agents/architecture/booking.md before touching a path that books, cancels, joins or claims.
3. **Script load order matters.** psycle-finder.html loads the 15 js/ modules as `defer` scripts in a fixed order, and later modules monkey-patch earlier ones (`apiFetch`, `submitBooking`, `eventCard`, `showBikePicker`); every `submitBooking` wrapper forwards all four arguments. The four cancel functions (`confirmUnbook`, `upcomingCancel`, `cancelBikeSlot`, `upcomingSeatCancel`) are each wrapped twice — js/features.js `patchCancelFunctions` (marks history cancelled only when NO seat is left) and, in the iOS and Android apps, ios-app/www/native-bridge.js (arms the calendar reconcile); neither sends a request. A wrapper forwards every argument and returns the original's result, but never rely on what `submitBooking` or a cancel returns: two wrappers return nothing (agents/learnings.md B6; who wraps what: agents/index/globals.md). tests/suites/shell.js guards the order (agents/repo-map.md).
4. **Generated files are never hand-edited:** everything in ios-app/www/ EXCEPT native-bridge.js (hand-maintained, and it lives only there), and the `SHELL` list and `CACHE` stamp in both sw.js copies. After editing root js/, css/, fonts/, `*.html`, manifest.json, sw.js OR ios-app/www/native-bridge.js (its bytes are in the `CACHE` hash), run `cd ios-app && npm run build` and commit the result — `npm run drift` fails otherwise. In ios-app/android/ the two `capacitor.*.gradle` files and the launcher PNGs are generated too (its AGENTS.md, rule 3).
5. **A native edit is proved by a compile before it ships.** Swift or the asset catalogue: the App-scheme simulator build (`xcodebuild … -scheme App -destination 'generic/platform=iOS Simulator' build CODE_SIGNING_ALLOWED=NO`, as .github/workflows/ci.yml runs it; the runnable form, in a scratch copy: agents/playbooks.md P7 step 3) — every push to main is archived and uploaded to TestFlight (ios-app/CICD.md). Android (ios-app/android/: Java, the manifest, res/, Gradle): no JDK or Android SDK is assumed on a development machine, so CI is the compiler — push to an `android/**` branch, read the `android-build` job, and call the change "read, not built" until it is green (agents/playbooks.md P14; tests/suites/19-android-project.js holds only what can be READ). Neither compile says anything about a phone.
6. **Never push to `main` unasked.** Every push there — a web-only one included — is archived to TestFlight, spends Xcode Cloud compute hours and publishes the web app. Work on a branch, keep `main` fast-forwardable, never force-push (agents/decisions.md section 7, ios-app/CICD.md). A store release is the owner's too: never trigger the manual .github/workflows/android-release.yml (agents/playbooks.md P15).
7. **Suites slice shipped source.** Many tests cut a function out of js/*.js by its opener line and run it against fakes, so moving, renaming or re-indenting it fails the suite ("anchor moved?"). A `// ── pure:<name>:start` … `:end` block stays free of DOM and app globals (agents/architecture/testing-and-ci.md).

## Quick Start
```bash
python3 -m http.server 8080    # serve locally
# open http://localhost:8080/psycle-finder.html
npm run ci                     # syntax check + unit tests + www/ drift check
npm run check                  # the syntax check alone: node --check on js/*.js, sw.js, the build scripts, native-bridge.js
npm test                       # tests/unit.js, then every tests/suites/*.js (dependency-free; runs as TZ=America/New_York)
npm run drift                  # fails if ios-app/www/ or the sw.js cache stamp drifted from source
cd ios-app && npm run build    # regenerate ios-app/www/ and SHELL / CACHE after a web edit, then commit it
npm run agents:index           # regenerate agents/index/ (1 s) after an edit that adds or removes lines of code, and commit it with the change
npm run agents:check           # exits 1 while the index is stale — advisory: npm test only prints a note, CI runs this as a non-blocking step
git grep -n "<name>"           # not grep -r: untracked folders at the root (a tool's worktrees, node_modules) can hold whole copies of the repo
```

## Where things are
| Path | What it is |
|---|---|
| psycle-finder.html · login.html · index.html | The app shell (CSP, first-paint `themeBoot`, SW-update script) · the sign-in page · a redirect |
| privacy.html · support.html | The privacy policy of both apps and the web app, and the support page the store listings point to, served with the web app. NOT part of the app shell: ios-app/build.js does not copy it and sw.js does not precache it, so an edit needs no rebuild (tests/suites/22-play-release.js) |
| js/ | 15 modules, no bundler; the load order is fixed |
| css/ | 9 stylesheets; tokens and themes in theme.css; crisp.css is linked LAST and is tokens only |
| tests/ | unit.js + suites/ (Node, no dependencies), smoke.html, tools/ (fake-psycle.js, App Store capture) |
| ios-app/ | Capacitor wrapper for BOTH platforms: build.js, patch-plugins.js, www/ (GENERATED), ios/ (the Xcode project, committed), android/ (the Gradle project, committed), native-checks/; ANDROID.md is the owner's guide to the Android app |
| assets/ · icons/ · fonts/ · types/ | Logo sources + render-icons.sh · web / PWA icons · self-hosted woff2 · globals.d.ts for the advisory typecheck |
| sw.js · manifest.json | Service worker (`SHELL` / `CACHE` generated) · PWA manifest |
| agents/ | These docs: read on demand, never all at once |

js/, css/, tests/, ios-app/, ios-app/ios/App/ and ios-app/android/ each carry their own AGENTS.md: the rules local to that folder. Read it when you first open a file there (some assistants load it for you, through the folder's CLAUDE.md pointer).

The six biggest files — never read one whole; find the symbol in agents/index/ and open a small window:
| File | Holds |
|---|---|
| js/app.js (~14,000 lines) | API, session, search + window cache, Filters bar, day pager, booking, waitlist, My Bookings, class sheet, welcome |
| js/tabs.js (~4,600) | Tabs, Stats sub-pages, share card, Membership (with Support Psync, the tip jar), the Class colours control, the usual-week card + review sheet |
| css/crisp.css (~4,200) | The Crisp Colour layer, in marked sections `crisp:9a-foundation` … `crisp:9e-stats-membership` |
| css/styles.css (~2,900) | Core layout, the older class-card / booking UI rules, desktop layout, the first-run welcome (`.onboard-*`) |
| ios-app/www/native-bridge.js (~2,650) | The native bridge, loaded by the iPhone AND the Android app: storage mirror, haptics, calendar, notifications, widget snapshot |
| js/settings.js (~2,200) | Settings panel, the favourite-instructors list, bike prefs, next-class pill, calendar-sync UI, export / import |

## Reading guide
One row per file; the generated index is one row, and agents/index/README.md lists its files. A name with no folder is in agents/architecture/ (the former CLAUDE.md, moved verbatim — section titles unchanged). ≈ tokens = bytes ÷ 4: what the file costs to read whole — and you rarely need to: each architecture file is cut into "###" sections, one per mechanism, so `grep -n "^###" <file>` and read the one you need.

| If your task or question is… | Read | ≈ tokens |
|---|---|---|
| a first visit: what is in agents/, and in what order | agents/README.md | 2,050 |
| "has the owner already decided this?" — before you change behaviour, copy, colour, time handling or the release flow | agents/decisions.md (grep it for the feature; read a section, not the file) | 10,650 |
| picking the project up after a gap: the newest session-log entry, how to check what `main` holds, what is and is not proved, what is the owner's, your first hour | agents/HANDOVER.md | 7,750 |
| "what next?" — candidate work, each with a size and a risk: propose from it, never start from it | agents/backlog.md | 5,750 |
| anything risky: what has gone wrong here before (its first 20 lines, then the one section for your area) | agents/learnings.md | 12,650 |
| a common change, as a checklist: P0 and the ONE playbook (its table of contents gives each one's size) — removing dead code or CSS is P16 | agents/playbooks.md | 14,750 |
| what a word means (seat / space / place, record / entry, held / unverified): grep it there, or read §4 (≈ 1,250); a field shape → §1; a state machine → §3; the invariants → §5 — never the whole file | agents/ontology.md | 8,700 |
| where a file is, the load order, "I want to… → edit this file" | agents/repo-map.md | 6,950 |
| after a push to `main`: the Xcode Cloud check is missing, cancelled or failed; a TestFlight build did not arrive (checklist: playbooks P10; lesson: learnings G5) | ios-app/CICD.md → "Notes / gotchas" | 3,300 |
| a line number: function, pure block, event, storage key, global, API call, CSS section, DOM id, suite, test section (which test guards a rule), Swift type, Java type | agents/index/README.md, then grep agents/index/ | 2,050 (the folder: 98,500 — grep it, never read it whole) |
| rebuilding the index (`npm run agents:index`), or re-proving that the split lost nothing | agents/tools/build-index.mjs · agents/tools/check-split.mjs | run them, do not read them (29,200 · 2,200) |
| an old "CLAUDE.md → section" reference | agents/architecture/README.md | 800 |
| any js/ module for the first time (state, events, wrappers) | core-patterns.md | 800 |
| what a whole tab shows, before changing part of it | tab-structure.md | 1,450 |
| a flow end to end (booking, history sync, find similar) | user-flows.md | 550 |
| booking, cancelling (which control cancels one seat, which the whole booking), clash warnings, no-layout studios | booking.md | 2,450 |
| the class sheet, seat picker, `confirmModal`, the Booked sheet | sheets-and-dialogs.md | 1,900 |
| waitlist places, offers, claims, phases | waitlist.md | 1,250 |
| "Your usual week": card, review sheet, spot suggestion, the run | usual-week.md | 4,650 |
| the offline queue, failed cancels, the saved copy | offline.md | 1,300 |
| My Bookings: render commit, the plan-usage bars, card actions, the footer row, More menu, next-class pill | bookings-tab.md | 2,100 |
| search, filters, the Filters bar, the timetable window cache | discover.md | 2,500 |
| the day strip / pager, the held-day dot, or the swipe rules | day-pager.md | 2,650 |
| the Monday 12:00 release, the iOS Monday reminder, how far ahead Psycle books | monday-release.md | 2,500 |
| Stats sub-pages | stats.md | 750 |
| the first-run welcome, or a dialog that may open at launch | welcome.md | 1,000 |
| sign-in, session states, account switch, stored data, settings import | session-and-accounts.md | 1,400 |
| parsing, comparing or printing a class time | time.md | 1,500 |
| class history, its sync, the notify bell | history-and-notify.md | 350 |
| any CSS: tokens, the Crisp Colour layer's rules, the z-index ladder and overlay frames | design-system.md | 2,850 |
| a theme, `themeBoot`, a rule that "does not take" on Cloud | theming.md | 1,100 |
| class-type colours, `data-ct`, pictograms, the Class colours control | class-type-colours.md | 900 |
| the class card (Discover and My Bookings wear the same one) | class-card.md | 1,100 |
| an overlay (checklist: playbooks P5), a toast, focus, a control that is not a `<button>` | accessibility.md | 850 |
| sw.js or the update banner | pwa-shell.md | 450 |
| native-bridge.js, Swift, widgets, the Live Activity, calendar sync, notifications and their words (`_classReminderBody`), Support Psync — the tip jar, three product ids held in JS, Swift and Java (then playbooks P7 for the commands) | ios.md | 6,100 |
| the Android app: how it differs (Back, channels, the status bar, backups off, what is absent), its home-screen widget (the plugin twins, the snapshot reader, RemoteViews), its class countdown (the one silent notification in the Live Activity's place: the planner, the notifier, the alarm, the off switch), how it is built and proved (then playbooks P14) | android.md — grep its "###" headings and read ONE section | 17,700 (the widget section alone: 4,250; the countdown's: 3,400) |
| installing the Android debug APK, adding the widget, the class countdown as the owner sees it, a release build, the keystore, Play Console, the Android on-device checklist | ios-app/ANDROID.md (store copy: ios-app/PLAY_STORE_LISTING.md) | 13,600 (the checklist alone: 4,450) |
| getting the Android app onto Google Play: the target-API and policy preconditions, the developer account, the upload key, the manual release workflow (.github/workflows/android-release.yml) and its four secrets, every Play Console form, the testing tracks, the privacy page, a one-page checklist (an agent's part of a release: playbooks P15) | ios-app/PLAY_STORE_DEPLOY.md | 10,600 |
| a request to Psycle, or a stub for one | api.md | 650 |
| a localStorage / sessionStorage key (adding one: the checklist is playbooks P3) | storage-keys.md | 2,850 |
| a failing check, a new suite, build.js, the plugin patcher, CI (when it runs, what it skips), which suite guards a rule (`git grep -n "<its words>" tests/suites/`: the section titles say what each proves) | testing-and-ci.md | 2,000 |

## Keeping these docs true
- Text moves with the code: change behaviour a paragraph describes, and change that paragraph in the same commit. Use the code's exact names; a reader will grep for them.
- Line numbers live only in agents/index/, which is generated: `npm run agents:index`. Everywhere else name the symbol and the file.
- An older comment that says `CLAUDE.md → <section>` or `CLAUDE.md "<section>"` means agents/architecture/: the titles are unchanged, so `grep -rn "<section>" agents/`. Swift and bridge comments say it too — "see CLAUDE.md → Gym time" is agents/architecture/time.md.
- A new, renamed or deleted file under agents/ changes the reading guide above (a top-level file is also in the table of agents/README.md). Correct a file's ≈ tokens when it grows or shrinks by a quarter; tests/suites/16-agents-docs.js holds both lists to the disk.
- A folder guide changes with its folder: at most 80 lines, and its CLAUDE.md pointer at most 3 lines with one line exactly `@AGENTS.md` (16-agents-docs.js holds both); local rules only — nothing guards that, it depends on you.
- CLAUDE.md stays a pointer to this file (an assistant loads it whole at every session start). Keep this file within 160 lines; depth belongs under agents/.
- `node agents/tools/check-split.mjs` proves the split lost nothing at the commit that made it; later it lists what has been edited since, which is expected.
- This repository is public: nothing machine-specific, personal or employer-specific in docs, code or commit messages.
