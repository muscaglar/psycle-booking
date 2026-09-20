# Playbooks — step-by-step checklists
Purpose: the exact files, functions, commands and suites for the changes this repository sees most, so you do not have to rediscover them.

- **Read this when** your task matches a heading below: read P0 and that one playbook — never the whole file (≈ 10,300 tokens).
- **Skip this when** you are only reading code, or the change is documentation only.
- **Not restated here**: the traps behind these steps are in `agents/learnings.md` (cited as A1, D3 …); how a subsystem works is in `agents/architecture/<topic>.md`; line numbers are in `agents/index/` (start at `agents/index/README.md`).
- Paths are repo-relative. A bare `name.js` under "Suites" is a file in `tests/suites/`. Commands run from the repo root unless they start with `cd`.

| Playbook | | ≈ tokens |
|---|---|---|
| P0 | Every change: the loop | 600 |
| P1 | Add or change a Discover filter | 700 |
| P2 | Change a booking, cancel or waitlist flow safely | 750 |
| P3 | Add a localStorage key | 800 |
| P4 | Add a theme · add or change a class-colour swatch | 550 |
| P5 | Add an overlay or dialog | 1,150 |
| P6 | Change the class card | 600 |
| P7 | Change Swift, the widget, the Live Activity or the asset catalogue | 1,550 |
| P8 | Verify a change in a real browser on the fake server | 1,550 |
| P9 | Rebuild the App Store screenshots and the icons | 250 |
| P10 | Ship — and what to do when no TestFlight build arrives | 450 |
| P11 | Find out how Psycle behaves — safely | 350 |
| P12 | Triage a member report about a cancel | 300 |
| P13 | Add a Membership → Appearance (or Settings) control | 350 |

**The rule over all of them:** `https://psycle.codexfit.com` is a real booking system. No test, script or browser check sends it a POST, PUT or DELETE — ever.

## P0. Every change: the loop

```bash
npm run check                         # node --check on every shipped script
npm run agents:index                  # if you added or removed lines of code: keeps agents/index/ exact (a drifted index is only an advisory note)
node tests/unit.js > /tmp/unit.log 2>&1; echo exit=$?       # a few seconds (≈8,000 checks); no install, no network
grep -E "✗|passed,|stopped before|crashed" /tmp/unit.log    # the log is ~9,000 lines — read only this
(cd ios-app && npm run build)         # after ANY edit to root js/ css/ *.html manifest.json sw.js — or ios-app/www/native-bridge.js (F1, F2)
npm run drift                         # must end "www/ is in sync"
npm run ci                            # = check + test + drift, as CI runs them
```

1. Before editing a function, find who tests it: `grep -l "<name>" tests/suites/*.js`. If a suite slices it by anchor, keep its opener at column 0 and its indentation (B1). tests/unit.js reads no arguments: there is no single-suite filter — it always runs everything; grep the log for your suite's section title.
   "the index is stale" for one of `bookClass`, `submitBooking`, `_bookingHorizon`, `renderMyBookings`, `_profileFrom`, `planWeeklyTemplate`, `_spotSuggestion` (js/app.js), `PsycleClassColours` (js/theme.js), `_pillCoversBook` (js/settings.js) or `syncAllBookingsToCalendar` (the bridge — BELOW `SYNC_KEYS`, so every new mirrored key moves it) means only that a line moved: run `npm run agents:index`. Nothing is wrong.
2. New DOM-free logic goes in a `// ── pure:<name>:start … :end` block, named in a suite through `t.loadPure` (B2). One file per feature area in `tests/suites/`; nothing to register.
3. Behaviour or layout changed → P8. Swift or assets → P7.
4. Stage the generated files with the source: `ios-app/www/**` and both `sw.js` copies.
5. Move the documentation with the code: the matching `agents/architecture/` file, and the AGENTS.md of the folder (js/, css/, tests/, ios-app/, ios-app/ios/App/) when a rule local to it changed; then `npm run agents:index` (it rewrites `agents/index/`; `npm run agents:check` must exit 0 — nothing else runs it). A file added to or removed from `agents/` also changes the list that names it — `AGENTS.md`'s reading guide, and `agents/README.md` for a top-level file — and each list carries a size per file (bytes ÷ 4) that 16-agents-docs.js holds to within 25%: after a large edit to an agents/ doc, update its size. `AGENTS.md` ≤ 160 lines; `CLAUDE.md` stays a ≤ 8-line pointer.
6. Commit on a branch. `main` ships (P10). A stretch of work ends with a dated entry at the top of the session log in `agents/HANDOVER.md`.

## P1. Add or change a Discover filter

Worked example to copy: the Time row (`selectedTimeBands`, `_availableOnly`) in js/app.js.

1. **State and control** — a `selected…` Set or flag in js/app.js; a global toggle that, in this order, calls `_dropFocusStash('<dim>')`, changes the state, repaints its pills (through `_repaintKeepingFocus`), `refreshFacetCounts()`, `triggerAutoSearch()` — as `toggleTimeBand` does. Markup inside `#controlsBody` (psycle-finder.html); selected state is exposed with `aria-pressed`.
2. **Read path** — add the field to `currentFilters()`; apply it in `render()`; apply the SAME test in `discoverFacets()` (a chip must not count classes the list will not show). A new per-class field goes into `_buildFacetClasses`. Never hide a class the member holds or is waitlisted on.
3. **No network** — a filter re-filters the loaded window in memory (`triggerAutoSearch` → `renderFromWindow`). Do not add a server parameter: it would change `search()` and the window key.
4. **Chips** — `_filterSummaryChips` (`pure:filter-summary`) returns `{kind, id, label}`; `_removeFilter(kind, id)` calls the same global toggle, and only while the filter is really on. The count on the bar follows by itself.
5. **Clearing** — `clearFilters()`; `_focusSearch()` (it clears ALL filters and stashes what stood before per dimension in `window._focusStash`: add the dimension there, to `_dropFocusStash` / `_restoreFocusStash`, and to `saveFilters`' `own(…)` reads).
6. **Persistence** — `saveFilters` / `restoreFilters` and one `wrapGlobal('<toggle>', saveFilters)` line (js/interactions.js section C). Values in `psycle_saved_filters` stay flat — the settings import keeps only primitives and lists of primitives (`_planSettingsImport`). Validate on restore, as `setTimeFilters` does.
7. **Session restore** — add the field to the `filters` object `_saveLastResultsSoon` writes to sessionStorage `psycle_last_results`, and to the reconstruction in `restoreLastResults` (both field by field; an entry saved without it must read as "off", as the Time row's does). Otherwise the list painted at the next visit ignores the filter until the launch search re-renders.
8. **Recent searches** — `_currentSearchState`, `_searchSignature`, `_searchLabel`, `applySavedSearch`; an entry saved without the new field must reset it.
9. **Suites** — filters.js, 8a-filters.js, facets-core.js, discover.js, discover-journeys.js, window.js. tests/smoke.html asserts that the toggle globals exist: add yours.
10. **Docs** — the `psycle_saved_filters` row of the storage-keys table; `agents/architecture/discover.md`.
11. **Browser (P8)** — tap it; chips and count; Clear; reload restores it; Find similar then a chip tap (the stash); a recent-search pill; a 7-day range keeps the chosen day.

## P2. Change a booking, cancel or waitlist flow safely

A member REPORT about a cancel → P12 first. Read first: `agents/learnings.md` section A and J; `agents/architecture/booking.md` (the `bookClass` guards, in order) or `waitlist.md` / `offline.md` / `usual-week.md`.

1. **Find the choke point.** Book → `submitBooking` (picker, last-seat confirm, no-layout confirm and the usual-week run all share it). Swap → `executeSpotSwap` (its own POST, `retries: 0`). Per-seat cancel → `cancelBikeSlot`, `upcomingSeatCancel`. Whole-booking cancel → `confirmUnbook`, `upcomingCancel`. Waitlist → `joinWaitlist`, `leaveWaitlist`, `claimWaitlistSpot`. Offline → `_offlineQueueDecision` (js/reliability.js). Change it there, not at a caller.
2. **Write the table before the code** (J): every answer × every prior state → what the member is told, and what is sent next. "Nothing" is the right next request more often than not.
3. **Hold the rules**: a booking POST is never re-sent (A1); "✓" + `.booked` only when `/bookings` shows the seat (A3); a record id is deleted only when it is provably that seat's (A2); a count body only for `has_layout === false` (A6); a place is not a booking (A7); nothing is spent that was not shown (A5); thrown errors are worded by `_friendlyError`, never a raw status code.
4. **Signature changes**: `submitBooking(eventId, slots, btn, opts)` is wrapped four times on the web (js/theme.js, js/features.js, js/reliability.js twice) and a fifth time in ios-app/www/native-bridge.js; the four cancel functions are wrapped by js/features.js and again by the bridge; `showBikePicker(…, opts)` once — read every wrapper (B6; `agents/index/globals.md` lists them). No wrapper hands a return value on. `bookClass`, `submitBooking`, `fetchMyBookings` and the cancel paths are sliced by anchor (B1).
5. **Suites**: booking.js, booking-races.js, booking-extras.js, add-spot-studio.js, reliability.js, retry-signout.js, offline-queue.js, waitlist-polish.js, clash.js, weekly-template.js, 14a-usual-week-sheet.js. Add the failing case first.
6. **Browser (P8)**, counting writes: the happy path sends exactly ONE write with exactly the expected body; then stage each failure (`__H.fail`, `__H.taken`, `__H.delayMs`) and check the label, the toast, and that NO second write went out. A double tap and a tap during "…" send nothing extra. The fake models the multi-seat hazard: a POST with N slots creates N records and answers the FIRST id only; `DELETE /bookings/{id}` removes exactly one record; `DELETE /bookings?event_id=` is NOT implemented — it lands in `__H.unknown` with a 404, which the whole-cancel paths count as "gone" — so always assert `__H.unknown` is empty, and for a per-seat cancel that `__H.writes` holds exactly one `DELETE /bookings/<that seat's id>`.
7. Say in the commit what is still unproven against the live system. Nothing here is ever tried live (P11).

## P3. Add a localStorage key

Decide five things, then touch the matching places. Keys are `psycle_<name>`.

| Question | If yes |
|---|---|
| Must it survive an iOS storage purge? | Add it to `SYNC_KEYS` (ios-app/www/native-bridge.js), then rebuild (F2). Keep the list's closing `  ];` on its own two-space-indented line: 9a-foundation.js extracts the list by it. If its ABSENCE means something, remove it with `localStorage.removeItem`; a flag is `'1'` or absent, never `''` (F3). A key a module READS AT LAUNCH must be applied again once the restore settles, because the bridge is the LAST script: a `window._psycleNativeRestoreReady.then(…)` inside the guarded block of `initTheme` (js/theme.js) is the pattern — and B7 is what that code must survive. |
| Is it per account? Hand-entered and not rebuildable from Psycle → | `ACCOUNT_STASH_KEYS` (js/app.js, `pure:data-owner`). Rebuildable, or dangerous under another token → `ACCOUNT_CLEAR_KEYS`. Per device → neither. |
| Must it go on sign-out or session expiry? | Deliberate sign-out: `clearToken` (js/app.js). Expiry keeps more than sign-out does — read `showSessionExpired` before choosing. |
| Should a settings export carry it? | `EXPORT_KEYS` AND a branch in `_planSettingsImport` (js/settings.js, `pure:import-validate`): a bounded string whose JSON has the key's shape, prototype-pollution ids rejected; import only ADDS, or fills where the device has none. AND a line in `_importSummary` that turns your `plan.added.<label>` into words: `importSettings` applies NOTHING when the summary is empty ("Nothing new in that backup"), so a key with no summary line is never imported when it is the only addition. Append to `EXPORT_KEYS` AFTER `'psycle_class_colours'` (9a-foundation.js pins `'psycle_theme',` straight before it). Test the key in a section of its own — copy 9a-foundation.js "psycle_class_colours: exported, imported like the theme, mirrored on iOS" — and do NOT add it to `FILE` in import-validate.js, whose totals are hard-coded. |
| Can it grow? | Write through `window._psycleSafeSetItem(key, value)` (js/security.js): it frees the re-creatable caches and returns false, never throws. Cap the size. |

Then, always:
1. Read it defensively — it is untrusted (A12). Coerce through a `_cleanStored…` helper (`pure:stored-data`) or one of your own, in ONE place; escape what you print.
2. Owner-stamp anything replayable or per member (see `psycle_offline_queue`, `psycle_waitlist_places`, `psycle_bookings_snapshot`).
3. Suites that pin the registries: data-owner.js (stash / clear), import-validate.js (export / import); 9a-foundation.js and history.js show how `SYNC_KEYS` membership is asserted, event-details.js a deliberate absence.
4. Docs: a row in the storage-keys table (`agents/architecture/storage-keys.md`: contents, mirrored or not, when it is cleared); `npm run agents:index`.
5. Browser checks: tests/tools/appstore-capture.html and the P8 recipe seed keys — add yours if a fresh profile would otherwise open a prompt.

sessionStorage keys need only the read-defensively rule and a row in the same document.

## P4. Add a theme · add or change a class-colour swatch

**A theme**
1. css/theme.css: one `[data-theme="<id>"]` token block. Copy the block of a theme on the same base and re-value EVERY token in it (text ladder, accent + `--accent-ink`, danger pair, badge / skeleton / toast sets, `--fav`, `--glow-sel-*`, shadows).
2. js/theme.js: one `APP_THEMES` entry `{id, name, base, bg, accent, mono?}` (`mono: true` = class types wear the theme's accent ladder below Bold).
3. The `themeBoot` script in psycle-finder.html AND login.html: the id → ground pair in `BG` (the two scripts must stay identical).
4. login.html: a `[data-theme="<id>"]` block in its inlined tokens, value for value from css/theme.css (it links no stylesheet).
5. Suites: 10b-themes.js, 4f-cleanup-pwa.js, 1f-contrast-tokens.js, 9a-foundation.js (every swatch × intensity against this theme's inks), 10c-polish.js (the caution ink).
6. Look at it (P8 with `?theme=<id>`): Discover, the class sheet, the picker, My Bookings, Stats, Membership, the welcome, login.html — at 375 × 667 if the theme changes the body face (D7). In the iOS app the status-bar glyphs follow `base`.
7. Retiring a theme is the reverse plus one entry in `RETIRED_THEMES` and in both `RETIRED` maps (`agents/architecture/theming.md`).

**A swatch or a default**
1. js/theme.js `pure:class-colours`: the swatch ships PRECOMPUTED `tintSoft / tintBold / base / deep / ring / drop` for light AND dark. There is no colour maths at runtime.
2. A changed default: the plain-CSS copy that ends css/theme.css, and the Swift fallback palette in ios-app/ios/App/PsycleShared/PsycleClassType.swift (B5).
3. Suites: 9a-foundation.js (the contrast matrix — a swatch that fails it is not shippable), 11-native-snapshot.js (Swift parity). Swift touched → P7, and `sh ios-app/native-checks/run.sh` re-checks WCAG on the default tints.
4. Components never read `--ct-<key>-*`: they get `data-ct` and read `--ct-tint … --ct-drop`, `--ct-card`, `--ct-tile`, `--ct-ink`, `--ct-ink-2` from the ONE mapping block in css/crisp.css. A new class TYPE also needs `CATEGORY_MAP`, a pictogram in `CLASS_PICTOGRAMS` (js/app.js) and its Swift twin.

## P5. Add an overlay or dialog

1. Need a yes / no? Use `confirmModal(opts)` and stop here. `danger: true` is a calm outline; the filled red is `_confirmTone`'s call (a late cancel, `irreversible: true`).
2. Markup: `role="dialog" aria-modal="true"`, a label, and a focusable panel (`tabindex="-1"`). PREFER built on open and removed on close, appended DIRECTLY to `<body>`: the MutationObserver in js/app.js watches body's direct children, plus the `style` attribute of a hard-coded `['tokenDialog', 'bikeModal']` list. Only `_overlayIsOpen` understands a STATIC overlay toggled by `display`; `_dialogOpen()`, `_ownKeysOverlayUp()` and the bridge's `_askBlocked()` test for the id being IN THE PAGE, so a static overlay listed there by id reads as permanently open. A static one instead joins that style-observer list (a11y.js pins it: `eq(w.doc.observed, …)`) and gets a `style.display` test beside the bike picker's in `_dialogOpen()` and `_askBlocked()` — never an entry in `ASK_BLOCKING_IDS`.
3. **A plain overlay** → one `[id, closer]` row in `_OVERLAYS` (js/app.js). You get focus in, Tab containment, one Escape for the top layer through its REAL closer, and focus back to the opener (`_visibleOpener` if the opener may be hidden).
4. **An overlay with its own keys** (it swipes, it spends, it must sit above the stack) → name its id in `_ownKeysOverlayUp()`, write its own Escape / Tab handling, and — if background dialogs must wait for it — in `_dialogOpen()`.
   **An overlay that holds unsaved input** goes in `_dialogOpen()` as well as `_OVERLAYS` (`#bikeModal` is the precedent): otherwise "Spot opened", the waitlist "You're in" and the offline-booking ask open over it, and the service-worker auto-reload can fire. Inside `_dialogOpen()` use `document.getElementById` only and never mention `onboardOverlay` (a11y.js and waitlist-polish.js run the sliced function against a fake document). Give its `_OVERLAYS` row a REAL closer that guards the draft — as the `syncPromptOverlay` row guards a running sync — and route × and the backdrop through it.
5. iOS: add a BUILT overlay's id to `ASK_BLOCKING_IDS` (ios-app/www/native-bridge.js) so the two reminder asks never open over it (a static one: step 2); rebuild.
6. A dialog that opens BY ITSELF (an announcement, an offer) waits while `_dialogOpen()` is true or `#onboardOverlay` is in the page, retries on a timer bounded by the clock, never opens into a hidden app, and treats being displaced (`onReplaced`) as "not answered" (E4, E5).
7. Covered once step 3 or 4 is done: the day-pager and Stats swipes and the reminder tap ask `_dialogOpen()`, `_ownKeysOverlayUp()` and `_overlayStack`; the next-class pill looks for `[aria-modal="true"]`. The service-worker auto-reload asks `_dialogOpen()` only (`agents/architecture/pwa-shell.md`). NOT covered: pull-to-refresh. Its touchstart guard (js/interactions.js) exempts overlays by a hard-coded CLASS list — `.modal-overlay, .modal, .settings-overlay, .confirm-overlay, .bike-modal-overlay, .class-detail-overlay, .instr-modal-overlay, .history-modal-overlay` — and an overlay on `<body>` is outside `.tab-content`, so a downward drag on its header arms a refresh underneath. Reuse one of those classes on the root, add yours to the list, or stop touch propagation as the welcome does.
8. Announce changes through `announce()`; never reveal a pre-filled live region (E7). Look: css/crisp.css `crisp:9c-sheets`; a sticky action bar keeps the primary on screen at 375 × 667. Frames to reuse, the z-index ladder and where the CSS goes: `agents/architecture/design-system.md` → "Overlays".
9. Suites: a11y.js, 9c-sheets.js, 8d-welcome.js, ios-bridge.js. In a11y.js: bump `eq(dialogs, 12)` — it counts the literal `role="dialog" aria-modal="true"` in psycle-finder.html, js/app.js, js/features.js, js/settings.js and js/tabs.js ONLY, so put the markup in one of them — and add the id to the `_OVERLAYS` id list under it; every letters-only `aria-labelledby` needs its `id="…"` in the same file; every `<button class="modal-close` needs `aria-label="Close"`. The text it cuts `_dialogOpen`, `_OVERLAYS` and `_overlayIsOpen` out by: "text anchors" under a11y.js in `agents/index/tests.md`. ios-bridge.js keeps its own `blockers` array mirroring `ASK_BLOCKING_IDS`: add the id there too. Browser: Tab cycle, Escape closes only the top layer, focus returns, a toast raised while it is open is spoken inside it (seed both flags of P8 step 3, or the sync prompt — itself an `_OVERLAYS` member — takes the focus stack first).

## P6. Change the class card

One component, several wearers — change it once, look everywhere.

1. **Builders** (js/app.js): `eventCard` (Discover), `renderMyBookings`, `_savedBookingsHTML` (the read-only saved copy), and the Class colours preview in js/tabs.js. The time block comes from ONE function, `_ccTimeHTML` (`pure:class-type`). Compact wearers — usual-week rows, instructor-profile rows, the welcome's minis — are one line each.
2. **Look**: everything shared hangs off `.class-card[data-ct]` in css/crisp.css 9b.7; `crisp:9d-bookings` adds only what a held class needs and may not name `.class-card`. No older sheet may outrank that root (D1).
3. **Do not**: put a styling class on `.book-btn` (A3); rename the hooks the flows, the swipe and the suites read (`.book-btn.booked.mb-primary-btn`, `.booking-action-btn`, `.find-similar-btn`, `.up-seat-chip`, `.mb-countdown` + `data-start`, `.my-booking-card` last in the class list with `data-id` first); move anything between `renderMyBookings` and `pure:render-perf`, or make `_commitBookingsHtml` anything but its last statement (E2); reuse a `.cc-` name from the Class colours control (D6).
4. **Text on the tint**: `--ct-ink`, `--ct-ink-2`, `--ct-deep` only (D4). The glow means "selected, or yours" and nothing else.
5. **The card's twin**: a change to its height, padding or time size has one — the loading skeleton mirrors its geometry (`skeletonCardHTML` in js/theme.js + css/crisp.css 9b.8 `.skeleton-*`, sized off `--type-time`); change both or the list jumps on load. The pill and My Bookings' action buttons never go below `--tap-min`. A page-wide variant hangs off an attribute on `<html>` written by js/theme.js (as `html[data-ct-intensity]` is) and is styled in 9b.7 as `html[data-…] .class-card[data-ct] …` — never a markup branch in `eventCard` / `renderMyBookings` (it would change `_commitBookingsHtml`'s key).
   **Not in the page**: the widget and the Live Activity draw the same card natively — a matching change is P7.
6. **Suites**: 9f-one-card.js, 9b-discover.js, 9d-bookings.js, bookings-card.js, render-perf.js, 10a-time24.js, discover.js.
7. **Look at** (P8): Discover and My Bookings; intensity Off / Soft / Bold; Cloud, Graphite and Handheld; a booked card, a waitlisted card, the next held class (the one that glows), a long class name, a name with no instructor; 375 px and ≥ 1024 px.

## P7. Change Swift, the widget, the Live Activity or the asset catalogue

Sources: ios-app/ios/App/ — `App/` (AppDelegate + `SceneDelegate`, `AppGroupPreferences.swift`), `PsycleShared/`, `PsycleWidget/`, `PsycleLiveActivity/`, `PsycleIntents/`. The real project is `PsycleBookingBuddy.xcodeproj`; open `App.xcworkspace`, scheme `App`.

1. **Rules**: new `Codable` fields are optional (G2); times go through `PsycleFixedFormat` / `PsycleClock` only (G1); life-cycle work goes in `appDidBecomeActive()` / `appDidEnterBackground()` (G3); a Swift copy of a web value changes with its original (B5); a NEW Swift file needs target membership — `wire_native_targets.rb` (idempotent; needs the `xcodeproj` gem) — and 11-native-snapshot.js checks the files are in their targets.
2. **Checks that run on a Mac without a simulator**:
   ```bash
   sh ios-app/native-checks/run.sh            # the shipped model files: old payloads decode; 18:30 printed AND read back under the 12-hour override, ar_SA, th_TH
   sh ios-app/native-checks/render.sh <dir>   # draws the real SwiftUI layouts to PNGs (a drawing of the views, not WidgetKit)
   ```
   Both use the Swift interpreter, so they also work where a locally built binary is not allowed to run. run.sh varies the locale, the 12-hour override and the calendar — NOT the time zone: its fixtures are built on the machine's own zone (the snapshot path is device-local), so they would pass BY ACCIDENT on a UK Mac if the formatter's zone ever changed. Foundation honours `TZ`: `TZ=America/New_York sh ios-app/native-checks/run.sh` varies it (it passes today). render/main.swift builds `PsycleClassFacts` through its memberwise init (`facts(…)`): a new stored property there is defaulted (`var x: T? = nil`) or render.sh stops compiling — give the longest-strings case the new value and look at the activity PNGs in light and dark.
3. **Prove it compiles — in a scratch copy**, so nothing the build writes lands in your working tree:
   ```bash
   rsync -a --exclude .git ./ <scratch>/                 # keeps ios-app/node_modules and ios-app/ios/App/Pods when you have them
   cd <scratch>/ios-app && npm ci                        # only if node_modules is missing; postinstall runs patch-plugins.js (needs the npm registry)
   npm run sync                                          # patch + build + cap sync: fills ios/App/App/public, writes the generated config, runs pod install
   cd ios/App && xcodebuild -quiet -workspace App.xcworkspace -scheme App \
     -destination 'generic/platform=iOS Simulator' -derivedDataPath <scratch>/dd build CODE_SIGNING_ALLOWED=NO
   ```
   Without the Capacitor CLI: copy `ios-app/www/` into `ios-app/ios/App/App/public/` and run `pod install` in `ios-app/ios/App` — this works only if `ios/App/App/capacitor.config.json` and `config.xml` already exist (git-ignored, written by `cap sync`; the rsync carries them over from a tree that has synced once). On a fresh clone there is no CLI-free route: `npm ci && npm run sync`. It is the build CI's second job runs; rebuild after the LAST Swift edit.
4. **Launch it**:
   ```bash
   xcrun simctl boot "<a device name from: xcrun simctl list devices>"
   xcrun simctl install booted <scratch>/dd/Build/Products/Debug-iphonesimulator/<the built .app>
   xcrun simctl launch booted com.psyclefinder.app
   xcrun simctl io booted screenshot <file>.png
   ```
   The first launch after a boot lands behind the home screen: launch, terminate, launch again. The app that opens talks to the live API for its reference lists — sign in to nothing, tap nothing that writes.
5. **The asset catalogue**: edit the SVGs in `assets/`, run `sh assets/render-icons.sh` (needs `rsvg-convert` and Chrome) — it rewrites `AppIcon.appiconset`, `Splash.imageset`, `icons/` and the store icon sizes. 12-brand-mark.js holds every drawn copy of the mark to one geometry. Then step 3: the catalogue must compile with every rendition.
6. **Add a value to the Live Activity**: it goes in `ContentState` as `public var x: T?`, set AFTER init in `refreshFromSnapshot()` (`state.style = next.style` is the precedent), and reaches a card that is already up through the same-event `update()`. Never in the static attributes (frozen at start; 11-native-snapshot.js pins their `public let` list) and never as an init parameter: ios-polish.js ("R2-31") pins `init(startAt:status:slotSummary:)`, the controller's `ContentState(…)` call and exactly two `context.state.slotSummary ??` reads in the view. With nil the view draws today's card. Where the pieces are, and the payload shapes: `agents/architecture/ios.md` → "Live Activity: where the pieces are".
7. **What cannot be proved off a device** (G7): a widget reading the App Group, a Live Activity starting or updating, notification timing and taps, the share sheet, the calendar hand-over against a real calendar, status-bar glyphs, the phone's own 24-Hour Time switch, tinted / StandBy rendering, the cached launch screen. Add a line to the checklists (IMPROVEMENTS-2026-09.md "On-device checklist", ios-app/NATIVE_FEATURES.md "Device checklist") and describe the change as "compiled, not yet seen on a device". Docs that state a payload's shape or a card's line order change in the same commit: `agents/architecture/ios.md`, the ios-app/NATIVE_FEATURES.md status block ("Live Activity compatibility") and the steps of its Device checklist that spell out the line order and the upgrade path.
8. Bridge code (ios-app/www/native-bridge.js) is JavaScript: unit-test it through the fake shell in ios-bridge.js (`boot(opts)`: recording plugins, a wound clock), drive it in a browser with P8 step 7, and run the build afterwards (F2). calendar-safety.js goes further: it evaluates the WHOLE bridge in a vm twice — with no Capacitor, and against a fake one whose Calendar is an in-memory list that logs creates and deletes. That context has `document.getElementById: () => null`, a `confirmModal` that never resolves, a no-op `PsycleEvents` and NO `submitBooking` (so that wrapper is not installed): any new top-level bridge code runs there, and a test of a TRIGGER needs that suite's `boot(opts)` extended first.

## P8. Verify a change in a real browser on the fake server

tests/tools/fake-psycle.js answers every request to the API host inside the page: a 7-day timetable (3 seat studios, 5 class types, one empty day, one full class), bookings kept in memory, one id returned per POST however many seats. Any scriptable browser will do. `.claude/skills/verify/SKILL.md` is the same recipe as a skill; its "Waitlist flows" section gives stub shapes for a place and for join / leave / claim / offer probe / allocation.

1. Serve the repo on loopback: `python3 -m http.server 8080 --bind 127.0.0.1`. Use an origin nobody signs in on (H4) — `127.0.0.1:8080`, not a `localhost:8080` the owner may use: step 3 clears that origin's storage, and the fake `/profile` (customer id 1) reads as ANOTHER MEMBER — an account switch that stashes rankings and clears history.
2. Open a blank same-origin page — `http://127.0.0.1:8080/__blank__` (the 404 page is fine). Never the app page first (F5).
3. **One evaluate boots everything**:
   ```js
   for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
   for (const k of await caches.keys()) await caches.delete(k);
   localStorage.clear(); sessionStorage.clear();
   localStorage.setItem('psycle_onboarded_v1', '1');              // else the full-screen welcome is up
   localStorage.setItem('psycle_history_prompt_dismissed', '1');  // else the sync prompt blocks taps and swipes
   localStorage.setItem('psycle_hint_dayswipe', '1');
   // the browser's own HTTP cache survives all of the above: re-fetch the shell's files, or you may drive YESTERDAY's module
   const shell = await fetch('/psycle-finder.html', { cache: 'reload' }).then(r => r.text());
   await Promise.all([...shell.matchAll(/(?:src|href)="((?:js|css|fonts)\/[^"]+)"/g)].map(m => fetch('/' + m[1], { cache: 'reload' })));
   (0, eval)(await fetch('/tests/tools/fake-psycle.js', { cache: 'reload' }).then(r => r.text()));
   const H = window.__H; await H.boot({});                        // writes the REAL psycle-finder.html into this page; opts: { search: '?theme=graphite', hash: '#bookings' }
   await window.securityReady; await window._secureTokenStore.set('faketoken-123456789'); await window.checkAuth();
   ```
   `H.boot()` can answer `'app did not load'` although the app is up — look for `#results` yourself. It returns BEFORE it installs the toast / announce recorders, so in that case `H.toasts` and `H.announces` stay empty for the whole run: read `#toast` and `#srStatus` / `#srAlert` from the DOM (or wrap `window.toast` / `window.announce` yourself). ONE `H.boot()` per page load: `document.open()` keeps the global scope, so a second boot re-declares every top-level `const` — for another theme or hash, navigate to `__blank__` again and repeat this evaluate.
4. **Drive the real DOM.** A range of several days shows ONE day: click "7 days", wait for `#dayStrip .day-pill`, pick a day (E1). A booking = the card's Book → wait for `#bikeModal` → a `.bike-slot[data-slot="N"]` if none is `.selected` → `#confirmBookBtn`. Read `#toast`, `#modalHint`, `#srStatus` / `#srAlert`, or `H.toasts` / `H.announces`. Awaited flows need someone to answer `confirmModal`: click its buttons, or stub `window.confirmModal = async (o) => true` and assert on what was asked.
5. **Count the writes**: `H.writes` holds every non-GET with its body — a booking is exactly ONE `POST /bookings` with exactly the slots you picked. `H.leaked` and `H.liveHits()` must both stay empty; `H.unknown` lists requests the fake does not script.
6. **Stage failures**: `H.taken[eventId] = [ids]` — seats held by others (default `[1, 2, 3]`), set it between opening a sheet and confirming to take a shown spot away; `H.fail = (method, path) => boolean` — a 503 for whatever matches (the request is still recorded); `H.delayMs` — slow answers, for double taps and "latest tap wins"; `H.bookings` / `H.events` — edit the server's state directly. NOT scripted: `DELETE /waitlists/…` and `GET` / `POST /waitlist/…` (404, listed in `H.unknown`), `DELETE /bookings?event_id=` (the same), count bodies and no-layout studios, and any REFUSAL — the fake's `POST /bookings` always succeeds, even for a seat in `H.taken`. Waitlist places are NOT remembered: `PUT /waitlists/{id}` answers success (`waitlist.id` 555) and stores nothing, and `GET /waitlists` is always empty — so a joined place vanishes at the next `fetchMyBookings()` (`joinWaitlist` re-reads after 3 s). That is the fake, not an app bug. To hold a place, reassign `H.serve` BEFORE `H.boot` (`window.fetch` looks it up on every request) and answer `GET /waitlists` from your own list, in the entry shape of tests/README.md step 5. There is ONE full class; make another with `H.events[i].is_fully_booked = true` — a tap on a card whose place you seeded goes to `leaveWaitlist`, not to a join. For a 409, a 422 or one odd body wrap `H.serve`, or use the by-hand stub in tests/README.md.
7. **Bridge code in a browser**: BEFORE step 3's boot define a fake native shell — `window.Capacitor = { isNativePlatform: () => true, Plugins: … }` whose plugins record each call and return a Promise (ios-bridge.js shows the shapes the bridge expects) — then, after the boot, append `/ios-app/www/native-bridge.js` as the LAST script, as the iOS build does.
8. **Helpers**: `H.swipe(x0, y0, x1, y1)` sends a real touch sequence; `H.discover()` reports each pill's day, label, count and selected state — NOT the held-day dot or the pill's `aria-label`: read `#dayStrip .day-pill .day-pill-dot` (`data-ct`) and `getAttribute('aria-label')` yourself, after awaiting `fetchMyBookings()` (dots exist only once `/bookings` has loaded; `checkAuth()` merely starts that read). `H.until(fn, ms)`, `H.sleep(ms)`. Return small values from an evaluate. Never hide `document.body` to shrink a page snapshot: with no layout box, timers measure zeros, `_overlayFocusables` finds nothing to focus and the class sheet's `_classDetailBookAction` takes its hidden-card branch — a check then fails, or passes, for reasons no member sees.
9. **Layout checks**: safe-area insets are 0 on a desktop — re-inject the stylesheets with a fixed inset (H6). A stale stylesheet → H7. After a rebuild → F4.
10. Finish by reading `H.writes`: the writes you expected, and no others.

Whole-app load check without any of this: open `http://127.0.0.1:8080/tests/smoke.html` — the title must read `SMOKE: PASS` (it answers every fetch itself; console errors on that page are harness noise).

## P9. Rebuild the App Store screenshots and the icons

1. Serve the repo (P8 step 1), then `node tests/tools/appstore-shots.mjs` — needs Chrome (`CHROME=/path/to/chrome` if it is not in the default place) and Node 22+. It captures the REAL app on the fake server over the DevTools protocol at true device metrics, frames each shot with its caption, writes six 1290 × 2796 PNGs to `ios-app/appstore-assets/`, and stops if the harness reports any traffic towards the live host.
2. Which screen, theme and caption: the `SHOTS` table in that script. What each screen is seeded with: tests/tools/appstore-capture.html (`?view=discover|picker|bookings|stats|colours&theme=…`).
3. Icons and launch images: `sh assets/render-icons.sh` (P7 step 5).
4. Update `ios-app/APP_STORE_LISTING.md` when a file name or caption changes. The screenshots show the fake server's names only — keep it that way: no member data in the repository.

## P10. Ship — and what to do when no TestFlight build arrives

1. P0 is green, generated files are staged, the working tree holds nothing else.
2. Work on a branch; open a pull request; GitHub Actions runs check → test → drift → plugin patch check → the smoke page (advisory) → typecheck (advisory).
3. **Merging to `main` IS the release**: Xcode Cloud archives every push to `main` and uploads to TestFlight. Batch commits into one push (G6).
4. After the push, read the `Xcode Cloud` check on that commit (how: ios-app/CICD.md → Notes / gotchas). Green GitHub checks do not answer this. `success` → step 5. `action_required` = failed: read `output.text`; the usual suspects are G4 (deployment floor), G8 (`ci_post_clone.sh`: the executable bit, `brew install node`), `npm ci` unable to reach the public registry, `npm run patch:check`. `cancelled` = superseded: read the check on the NEWER commit, whose archive contains this one. NO check 15 minutes after the push is not a code failure (the check normally appears within minutes, long before the archive ends): the month's compute hours are spent, or the push was never picked up. That step is the OWNER's — no App Store Connect keys exist in the repository or in GitHub, so you cannot see usage or press "Start Build": hand over the sha, the check-runs output showing no `Xcode Cloud` run, and the two causes. Do not revert, do not force-push, never push an empty commit to provoke a build. The web app deploys from `main` independently: it is already live.
5. Open the TestFlight build on a phone: a green archive proves nothing about launch (G3).
6. Native change → tick what you could of the device checklists, and leave the rest written down (P7 step 6).
7. Plugin versions changed → commit the regenerated `Podfile` and `Podfile.lock`; `npm run patch:check` (in `ios-app/`) must pass (G8).

## P11. Find out how Psycle behaves — safely

1. **Look first**: `agents/architecture/api.md`, `waitlist.md`, `monday-release.md`; `PsycleAPI.SCHEMAS` (js/api-client.js); realistic shapes in tests/tools/fake-psycle.js and tests/README.md; the "observed" notes in IMPROVEMENTS-2026-09.md. Most answers are already written down, with the date they were observed.
2. **If your brief forbids all traffic to the live host, stop here** and say what is unknown.
3. Otherwise only token-free, read-only reads: Psycle's own public timetable, and the three reference lists the app itself reads before sign-in (`GET /instructors`, `/locations`, `/event-types`). A handful of requests, spaced out. Never an `Authorization` header from a tool; never a POST, PUT or DELETE — that includes every waitlist verb and `POST /waitlist/{id}`, which BOOKS a seat.
4. **Anything that needs a session is the owner's to run** — bookings, waitlists, the profile, what a refusal really says. Hand them a read-only snippet for their own signed-in browser and say exactly what to copy back; strip tokens, names and emails before anything is written down.
5. **Record it as OBSERVED, with the date**, next to named constants (see `pure:horizon` in js/app.js). The app may suggest and explain from an observation; it never blocks on one (I1). Put the open question on the device checklist so a real run settles it ("note what Psycle actually says").

## P12. Triage a member report about a cancel

"I cancelled one bike and both went" — before suspecting `_seatCancelId`:

1. **Display or server?** Does a pull-to-refresh of My Bookings (a fresh `/bookings`) still list the other seat? A display-only "both gone" can come from `cancelBikeSlot` alone (`agents/architecture/booking.md` → "The two per-seat senders differ").
2. **Read the action log** in the bug report (`psycle_action_log`; written by js/reliability.js): `booking:cancelled eventId=…` is a WHOLE cancel — `confirmUnbook`, `upcomingCancel`, a swipe, or a queue replay; `seat:cancelled eventId=… slot=…` is per-seat — `cancelBikeSlot` or `upcomingSeatCancel`.
3. **Check `psycle_offline_queue`** for a queued whole cancel: cancels never age out and replay while held.
4. **Check the control map** in booking.md → "Which control cancels what". A two-seat My Bookings card's primary is "Cancel all N" and the swipe presses it; a just-booked Discover card is wired to `confirmUnbook` until the trailing refetch re-wires it; both whole-cancel dialogs are titled only "Cancel this booking?".
5. Only then suspect `_seatCancelId` or API drift (`_recordShape('booking', …)` → `psycle_api_schema_log`; I3). Never test with a live write: reproduce on the fake (P2 step 6).

## P13. Add a Membership → Appearance (or Settings) control

1. **Markup**: js/tabs.js `membershipPanel.innerHTML`, AFTER `#classColours` — 9e-stats-membership.js pins that element's exact attribute string and that `#themePicker` precedes it. Render from `renderThemePicker()` (it already calls `renderClassColours()`).
2. **Primitives that exist**: `.seg` + `.seg-btn[role=radio]` (one of N; arrows move AND choose) and `<button class="app-row" role="switch" aria-checked>` (on / off, as the reminder rows in js/tabs.js).
3. **State** lives in an engine object in js/theme.js shaped like `PsycleClassColours` (`get / set / apply / clean`): `set` saves through `_psycleSafeSetItem` and still applies when the save fails; `apply` emits `<name>:changed` only when the outcome changed — emit from `apply`, not only from `set`, or a value the iOS restore or an import brings back never repaints an open control. The control keeps no copy and repaints on that event. B7 is what engine code in js/theme.js must survive.
4. The js/tabs.js text between `// ── Class colours (Membership` and `// ── Weekly reminder row` may not contain the word `localStorage` (9e-stats-membership.js).
5. A new `window.*` global → types/globals.d.ts (and tests/smoke.html's list if it is critical). The stored key → P3. Look: css/crisp.css `crisp:9e-stats-membership`; never a `.cc-` name (D6). A control that changes the class card → P6 step 5.
