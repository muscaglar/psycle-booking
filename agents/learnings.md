# Learnings — what has bitten people here
Purpose: the mistakes this repository has already paid for, most expensive first, each with why it happens, how to avoid it and what guards it.

- **Read this when** you are about to change behaviour, CSS, Swift, tests or the release path. Read section A before touching anything that books, cancels, joins or claims.
- **Skip this when** you only need to find something (`agents/repo-map.md`, `agents/index/README.md`) or want a recipe (`agents/playbooks.md`).
- **Not restated here**: domain words, state machines and invariants (`agents/ontology.md`), the owner's standing decisions (`agents/decisions.md`), how each subsystem works (`agents/architecture/`).
- **Format**: trap → *Why* → *Avoid* → *Guard* (what fails or refuses when you get it wrong); short items fold the four into one paragraph. Paths are repo-relative; a bare `name.js` under Guard is a file in `tests/suites/`. Sources: the commit bodies (`git log`), `IMPROVEMENTS-2026-09.md`, `REVIEW.md`.

**Cheapest useful read** — these eleven lines, then only the section for your area (A money · B tests · C time · D CSS · E DOM · F build · G iOS and shipping · H browser checks · I Psycle · J review):
1. Never re-send a booking POST; settle a doubtful one against `/bookings` (A1).
2. "✓" + `.booked` only when `/bookings` shows the seat — other code reads that button (A3, A4).
3. Delete a booking record only when it is provably that seat's (A2).
4. Nothing is spent that the member did not see and confirm (A5).
5. Suites slice shipped source by anchor: do not move, rename or re-indent a sliced function (B1).
6. `start_at` is London wall clock: never `new Date()` it for an instant (C1).
7. css/crisp.css wins ties, not specificity, and holds tokens only (D1, D4).
8. Only the visible day's cards exist in the page; a new overlay joins the registry (E1, E3).
9. Rebuild after editing web sources or the bridge; `npm run drift` must pass (F1, F2).
10. A green GitHub run is not a TestFlight build, and every push to `main` ships (G5, G6).
11. The live API is real: browser checks run on the fake server (H1).

## A. Paths that spend credits or give up a seat

**A1. A timed-out or 5xx `POST /bookings` may have booked.**
- Why: the client gives up after 15 s (`FETCH_TIMEOUT_MS`, js/reliability.js) but Psycle may finish the request. A re-send comes back 409 and reads as "failed": double booking, double credit (REVIEW.md §1).
- Avoid: never re-send. `apiFetchWithRetry` gives a POST 0 retries unless `opts.retries` says otherwise; every booking goes through `submitBooking` (js/app.js). After a timeout, 5xx, 409 or "already…" answer announce nothing until `_settleUnverifiedBooking` has re-read `/bookings` (bound: `BOOKING_VERIFY_DEADLINE_MS`) and `_bookingOutcome` has answered. `unknown` reads "Unconfirmed — retry" and the class stays in `_unverifiedBookings` — no further POST — until `_clearUnverifiedBooking`. The one guarded exception is the offline queue's SLOT-body replay; a COUNT body is never re-sent.
- Guard: booking.js, booking-races.js, reliability.js, offline-queue.js.

**A2. One POST returns ONE id however many seats it booked.**
- Why: Psycle keeps one booking record per seat. Mapping every seat to the returned id made "cancel seat B" delete seat A's record.
- Avoid: `/bookings` is the only source of per-seat record ids (`_scheduleBookingsRefetch` follows every POST). A per-seat cancel asks `_seatCancelId(booking, slotId)`: `null` → one bounded re-read → still `null` → "nothing was cancelled"; it never falls back to an event-wide DELETE. A whole-booking cancel passes `_readyForWholeCancel` first, and `_bookingIdsFor` sends each id once. Which control is per-seat and which is whole-booking: `agents/architecture/booking.md` → "Which control cancels what".
- Guard (grep the section title): booking.js "which record id may a per-seat cancel DELETE?" (the `_seatCancelId` table), "the My Bookings seat × only ever DELETEs that seat's own record" (drives the real `upcomingSeatCancel`), '"Cancel all" removes one record per seat — or nothing'; booking-races.js "Cancel: a DELETE that throws …" and "Cancel: a DELETE answered 5xx …" (BOTH per-seat senders DELETE the seat's own record, never the entry's `bookingId`). NOT pinned: `cancelBikeSlot`'s shared-id → re-read → resolve path, its nothing-sent path and its success-path local edit — add those beside the seat-× section before you touch it.

**A3. The label contract: other code reads the Book button.**
- Why: wrappers cannot see inside `submitBooking`, so they read its button. js/reliability.js looks for "✓" in `textContent` and compares `className === 'book-btn booked'`; js/theme.js picks its haptic from `.booked` / "Failed" / "retry"; `_bookTemplateSeat` reads "✓", "Failed — retry", "Unconfirmed — retry"; js/features.js's bell regex needs `<button class="book-btn"…>Full</button>`; "busy" everywhere is `data-busy="1"` or the label "…".
- Avoid: "✓" + `.booked` ONLY when `/bookings` shows a seat in that class. Booking code assigns `className` wholesale, so never hang a styling class on that button: css/crisp.css styles it from its state classes and from where it sits. Reword a label only together with every reader (grep the literal).
- Guard: booking.js, reliability.js, weekly-template.js, 9b-discover.js, notify.js.

**A4. A "✓" is not "this POST landed".**
- Why: it means "Psycle shows a seat in this class". On a class already held (a seat top-up) the seat held before earns it, so a lost, 5xx or 409 top-up was reported "Booked" and the usual-week run carried on. Found only by review of `98665f6`.
- Avoid: read what is held BEFORE the POST and require the booking to have GROWN by exactly what was shown; anything still in `_unverifiedBookings` is `'unconfirmed'` and stops the run (`_bookTemplateSeat`, js/app.js).
- Guard: 14a-usual-week-sheet.js, weekly-template.js.

**A5. Nothing is spent that the member did not see and confirm.**
- Why: three real cases — a run that booked an auto-picked seat; "Choose again" re-ticking rows BY POSITION, so a seat that went while its class filled came back as a pre-ticked waitlist join; a reminder tap re-opening the spend sheet the moment the member pressed "Not now".
- Avoid: a run sends exactly the slot ids on screen (`_templatePickSlots`; `_templateSeats` bounds the count again before sending); a shown spot that has gone books NOTHING for that row; state carried across a re-plan is matched by identity (`_uwTickOf` → `_uwKeepTick`, js/tabs.js), never by index; waitlist and cover rows start unticked; nothing is ever joined or claimed automatically; a sheet that spends never comes back by itself.
- Guard: 14a-usual-week-sheet.js, 14c-weekly-reminder.js, weekly-template.js.

**A6. A booking by COUNT is only for a studio known to have no layout.**
- Why: no-layout studios are booked with `slots: <number>`. A seat studio whose cached record merely lacked its map once fell into "Book another space?", which the server refuses; a re-sent count books another space.
- Avoid: pass `{spaces: n}` only when `_studioMap[id].has_layout === false` is positively known. Otherwise take studio and layout from the class detail (`_studioFromEventDetail`, `_layoutFromEventDetail`) or stop with "Couldn't load the studio map". Count bookings have never been exercised against the live system — say so, do not claim them proven.
- Guard: add-spot-studio.js, booking.js, offline-queue.js, 14a-usual-week-sheet.js.

**A7. A waitlist place is not a booking.**
- Why: it is a separate server resource; treated as a seat-less booking, joining failed with "Booking slot required". A place Psycle turns into a seat is chargeable.
- Avoid: join = `PUT /waitlists/{eventId}` (`retries: 0`; 422 "already" = joined); leave = `DELETE /waitlists/{entryId}`, never `DELETE /bookings`; claim only after an explicit confirm, announced only once `/bookings` shows the seat. Entries with `waitlisted: true` are skipped by calendar, widget, reminders, history, pill and badge. More: `agents/architecture/waitlist.md`.
- Guard: tests/unit.js (the `waitlist:pure` block), waitlist-polish.js, booking-races.js.

**A8. The seat picker is ONE static modal with three modes.**
- Why: `#bikeModal` serves Book, Change spot and the usual-week choose-only mode. A swap context and a reassigned `#confirmBookBtn.onclick` once survived a close, and the next ordinary booking cancelled a different class (REVIEW.md §1, critical).
- Avoid: every open sets the confirm button's label and `onclick` (`showBikePicker`); every close resets `_changeSpotContext`, `_chooseSpotContext` and the button (`closeBikePicker`); `confirmBikeBooking` refuses in choose-only mode. A new mode obeys the same two rules.
- Guard: booking-races.js, 9c-sheets.js, 14a-usual-week-sheet.js.

**A9. Losing Psycle is not being signed out, and a 200 is not always a profile.**
- Why: a failed `/profile` once signed the member out. Later `/profile` answering `[]` was accepted as "signed in as nobody", because `typeof [] === 'object'`.
- Avoid: only a 401 ends a session (`_sessionStateFor`); any other failure with a stored token is `unverified` — token kept, "Can't reach Psycle — Retry". Read a profile body through `_profileFrom`. Wherever you test `typeof x === 'object'`, test `Array.isArray(x)` too.
- Guard: session.js, retry-signout.js.

**A10. One member's data must not become another's.**
- Why: device data outlives a sign-out; a queued booking could replay under another token; a background history write could land under the wrong member.
- Avoid: data moves only when a verified `/profile` names a DIFFERENT customer (`_claimDataOwner`), and the stash is written before anything is removed. A new per-account key joins `ACCOUNT_STASH_KEYS` or `ACCOUNT_CLEAR_KEYS`; anything replayable is owner-stamped (`_stampQueueItem`). Never emit an empty `bookings:loaded` on sign-out: to the calendar sync it means "the server confirmed no bookings" and every synced event would be deleted.
- Guard: data-owner.js, offline-queue.js, session.js, bookings-load.js.

**A11. The calendar reconcile deletes.**
- Why: picking a calendar once deleted every other upcoming event in it, unasked.
- Avoid: full ownership only after the counted hand-over confirm (`_confirmCalendarOwnership`; ack `'2:<calendarId>'`); without it every reconcile is marker-only; never reconcile-delete without a live session and a loaded bookings list. The calendar plugin's call shapes are its v6 ones — `alertOffsetInMinutes` takes POSITIVE minutes; negative ones were silently ignored and no alarm was ever set. The header comments of the bridge's calendar section predate the contract ("dedicated calendar", `CAL_ID_KEY` "auto-created", `psycle_calendar_mode` 'auto' | 'custom' | 'default'): trust `agents/architecture/storage-keys.md` — `'custom'` is the only value written and nothing is ever auto-created.
- Guard: calendar-safety.js.

**A12. Stored data is untrusted, and a saved copy is never server truth.**
- Why: a settings import — or the iOS mirror of one — can put anything in localStorage.
- Avoid: coerce where it is READ (`pure:stored-data`: `_cleanStoredId` and friends) and escape where it is printed. When two readers read one field they use ONE rule (`_templateSeats` / `_uwCardSeats` once disagreed on a stored `"3"`). `psycle_bookings_snapshot` and `psycle_booked_event_details` never decide what is held.
- Guard: import-validate.js, 14b-usual-week-card.js, offline.js, event-details.js.

## B. Tests and code structure

**B1. Suites slice SHIPPED source by anchor.**
- Why: functions that touch the DOM are cut out of the real file as text — from `async function bookClass(` at column 0 to the next line that is exactly `}`, or between two anchor strings — and run against fakes.
- Avoid: renaming, moving or re-indenting such a function, or a bare `}` at column 0 inside it, breaks the slice. The failure says "(anchor moved?)": update the anchor, do not loosen the assertion. Keep the `typeof x === 'function'` guards around optional collaborators — a sliced function runs without its module. A suite that drives a booking / waitlist / swap failure path must also grab `_friendlyError`. In login.html the FIRST attribute-less `<script>` must stay the login logic (offline.js runs it).
- Guard: the suites themselves. Who slices what: `agents/index/tests.md`, or `grep -l "<name>" tests/suites/*.js`.

**B2. Pure blocks are DOM-free, and their position matters.**
- Why: `t.loadPure(file, name, globals)` concatenates every `// ── pure:<name>:start` … `:end` region and evaluates it in a bare vm.
- Avoid: no `document`, no `window` state, no app globals inside — hand them in. Only top-level `function` and `var` are reachable on the context. Blocks nest and share markers: `pure:clock` sits at the head of `pure:clash` because suites cut by the FIRST marker; `pure:horizon` is nested in `pure:window`, so loading `window` declares the real `_bookingHorizon` OVER a fake injected earlier — a suite silently stopped proving anything that way (put the fake in AFTER `loadPure`). Read the marker comment before moving code: js/interactions.js section D stays after section C; nothing may sit between `renderMyBookings` and `pure:render-perf`.
- Guard: 00-harness.js and the suite each marker names.

**B3. Tests run as America/New_York on purpose** (`process.env.TZ` in tests/unit.js), so a device-local parse of a gym time fails visibly. Never fix a time test by changing the zone.

**B4. A suite that awaits something that never settles** would end the run silently with exit 0. The drain guard in 00-harness.js turns that into exit 1 and names the section. If you shim a clock, make sure the timer a promise waits on still fires.

**B5. Some values are written twice on purpose; a suite holds each pair together — change both.**

| Pair | Held by |
|---|---|
| London resolver: js/app.js `pure:gym-time` · ios-app/www/native-bridge.js (`_gymWallToUtcMs`, `_classStartMs`) | bookings-card.js, tests/unit.js |
| Swipe rules: js/interactions.js `pure:swipe-nav` · the welcome's copy in js/app.js `pure:welcome` | 8f-wave8-seams.js |
| Release model: `RELEASE_OPENS_FROM_DAYS` / `_TO_DAYS` (js/app.js `pure:horizon`) · `OPENED_BATCH_FIRST_DAY` / `_LAST_DAY` (js/app.js `pure:week-opened`) — plain `const`s, so not reachable on a `loadPure` context (B2) | 14c-weekly-reminder.js |
| Seat-count rule: `_templateSeats` (js/app.js) · `_uwCardSeats` (js/tabs.js) | 14b-usual-week-card.js |
| Theme ids, grounds, retired map: `APP_THEMES` + `RETIRED_THEMES` (js/theme.js) · both `themeBoot` scripts | 10b-themes.js, 4f-cleanup-pwa.js |
| login.html's inlined tokens · css/theme.css | 4f-cleanup-pwa.js |
| Default class colours: `pure:class-colours` (js/theme.js) · the block that ends css/theme.css | 9a-foundation.js |
| Swift copies (fallback palette, class-type words, pictogram numbers, chrome colours) · the web originals | 11-native-snapshot.js |
| Script list: psycle-finder.html · tests/smoke.html | shell.js |

**B6. Load order and monkey-patches.**
- Why: every script is `defer` in a fixed order, and later modules wrap earlier globals: `apiFetch` (js/reliability.js retries, then js/performance.js's 24 h cache), `submitBooking` (js/theme.js, js/features.js, js/reliability.js twice), `eventCard` (js/features.js), `showBikePicker` (js/settings.js), the filter toggles (js/interactions.js `wrapGlobal` → `saveFilters`), the four cancel functions (js/features.js `patchCancelFunctions`), and in the iOS app the bridge wraps `submitBooking` (a FIFTH wrapper), `confirmUnbook`, `upcomingCancel`, `cancelBikeSlot`, `upcomingSeatCancel`, `renderMyBookings`, `pushAction`, `clearToken`, `saveWeeklyTemplate` and `clearWeeklyTemplate`. The full list, per name: `agents/index/globals.md` ("wrapped by"). Load order is not install order: js/features.js wraps from a `setTimeout`, js/theme.js from a poll that waits for app.js.
- Avoid: a wrapper forwards EVERY argument — `submitBooking` has four (`eventId, slots, btn, opts`); dropping `opts` loses `spaces`, and with it the no-layout body. Return values are NOT forwarded: js/reliability.js's optimistic wrapper and the bridge's wrappers `await` the original and return nothing, so read an outcome through the label contract (A3) or state, never a return value. Adding a parameter means reading every wrapper. Call a wrapped function by its global name so the wrapped copy runs (that is how a removed filter chip gets saved). Do not reorder script tags.
- Guard: shell.js, reliability.js, ios-bridge.js.

**B7. js/theme.js section A is evaluated WHOLE, against a bare fake page.** The text between the banners `// ── A. Themes` and `// ── B. Skeleton Loading Cards` runs in a vm in 10b-themes.js (twice) and 9a-foundation.js. The fake `document.documentElement` has ONLY `style`, `getAttribute` and `setAttribute` (no `removeAttribute`, no `classList`), `getElementById` answers null, and 9a has no `Promise`. Code added there that runs at evaluation — or inside a `_psycleNativeRestoreReady.then` — must survive that: try / catch, skip the DOM when nothing changed, and emit NO event (9a-foundation.js asserts the log is exactly `classcolours:changed`). A throw inside that `.then` is an unhandled rejection that ends the Node run. Which other text is cut this way: "text anchors" in `agents/index/tests.md`.

**B8. Widen a pinned pure helper with an opt-in option.** Add an option and a result field that appears only when it is set — `_findClash(…, {includePlaces: true})` → `place: true` is the precedent. Every exact-object assertion and every other caller keeps its answer, and the old default stays tested.

## C. Time

**C1. `start_at` is a naive London wall-clock string.**
- Why: `new Date('2026-09-24 18:30:00')` is the DEVICE's 18:30 — wrong abroad — and WebKit answers Invalid Date for the space form (event-cache rows are T-form; waitlist entries arrive in the space form and are normalised).
- Avoid: an instant → `_gymClassStartMs` / `_gymWallToUtcMs` (`pure:gym-time`). A wall-clock comparison or anything printed → the DIGITS (`_clockOf`, `_clock24`), never a Date. "Today" → `localDateStr()`, never `toISOString().slice(0, 10)` on a local date. The few device-local paths that remain are the owner's decision (`agents/decisions.md`, `agents/architecture/time.md`) — do not fix them in passing.
- Guard: tests/unit.js (both clock changes), bookings-card.js, clash.js, 10a-time24.js (fails if a 12-hour marker returns to shipped source).

**C2. A DOM timer stops counting while the app is suspended.** Re-arm from the clock on every return to the foreground (`_armReleaseTimer`), and bound patience by the clock, not by counting retries (the reminder tap gives up 15 s after the tap).

## D. CSS

**D1. The last stylesheet wins a tie, not a higher specificity.**
- Why: css/crisp.css is linked last and overrides the older sheets. Their light-base fixes are written `:is([data-theme="light"], [data-theme="cloud"]) …` — one class more — and Cloud is the DEFAULT theme. Four such rules beat the new look on the light base only (booked cards lost their tint; a chosen rank's letter fell to 1.6:1).
- Avoid: when a crisp.css rule "does not take" on Cloud, look in css/theme.css for that prefix first. Delete the old rule if it is dead, else match its specificity. Look at every change in Cloud AND Graphite.
- Guard: 9f-one-card.js (the class card's root).

**D2. An id-scoped rule outranks the older sheets' STATE rules.** A desktop grid on `#tab-bookings .mb-period-body` beat `.collapsed … { display: none }`. Give any rule that sets `display` on a collapsible part its collapsed twin. Guard: 9d-bookings.js (the billing-period fold), 14b-usual-week-card.js (the usual-week card's fold).

**D3. A shorthand in the last stylesheet can drop a safe-area inset.** crisp.css set the Settings header's `padding`, replacing the older `padding-top: calc(… + env(safe-area-inset-top))`; on a phone the title sat under the status bar. Guard: 13-safe-area.js (every selector + property an older sheet gives an inset; a deliberate move is listed in the test).

**D4. css/crisp.css is tokens only, and text on a class tint has three legal inks.** No hex, no `rgb()`, no px; every `var()` defined (a new step goes in css/theme.css `:root`, zeroed for Handheld if it is a radius); a `:has()` selector sits in a rule of its own; text on a tint is `--ct-ink`, `--ct-ink-2` or `--ct-deep` only — the three the contrast matrix holds for every swatch × intensity × theme. Guard: 9a-foundation.js, 9b-discover.js, 1f-contrast-tokens.js.

**D5. The focus ring is the body ink — invisible on an accent fill in Cloud and Handheld,** where `--accent` IS `--text`. A control that draws its ring inside itself switches to `--accent-ink` when accent-filled. Guard: 9a-foundation.js.

**D6. One prefix, two meanings.** `.cc-` is the class CARD's parts and also the class-COLOURS control; `.usual-week-seats` is the card's label and the sheet's control. The sets are kept disjoint (9f-one-card.js) or rooted at their own id. Never reuse a name across them.

**D7. Two themes change the metrics.** Terminal and Handheld use a wider monospace body face; Handheld zeroes every radius token and has no shadows. Check a layout change at 375 × 667 in both. Sticky action bars (`.cds-actions`, `#bikeModal .modal-actions`) are what keep the primary on screen there. Guard: 10b-themes.js (the mono date row), 9c-sheets.js (the sticky bars).

## E. DOM and UI plumbing

**E1. Only the visible day's cards are in the DOM** over a multi-day range (`#dayPager` holds one `.day-group`). Nothing may assume a card of another day exists: the class sheet books through a button of its own, and a browser check picks a day first. Guard: 8b-day-pager.js.

**E2. `_commitBookingsHtml` skips the write when the HTML is unchanged.** It must stay the LAST statement of `renderMyBookings`. State kept outside the HTML string must not change a button's class or label, or the list rebuilds under the member: the More menu is driven by `aria-expanded` alone for that reason. Guard: render-perf.js, 9d-bookings.js.

**E3. A new overlay must join the registry.** The plain overlays share one `keydown` handler and one focus stack through `_OVERLAYS` (js/app.js); `confirmModal`, the welcome and the usual-week sheet keep their own keys and are named in `_ownKeysOverlayUp()`; whatever must hold background dialogs back is named in `_dialogOpen()`; the bridge's asks wait on `ASK_BLOCKING_IDS`. An overlay in none of them gets a second Escape handler, no focus return, and dialogs opening over it. Guard: a11y.js, 8d-welcome.js.

**E4. Background dialogs wait for the welcome and for the usual-week sheet.** The welcome is full-screen, above `confirmModal`, and `_dialogOpen()` does NOT count it, so each background dialog checks `#onboardOverlay` itself (`_announceAllocations`, `_showOpenedSpots`, the offline-booking ask, `showHistorySyncPrompt`, both iOS asks). A dialog that opens under it takes focus there, and one Escape answers both. Guard: 8d-welcome.js, notify.js, waitlist-polish.js, ios-bridge.js.

**E5. `confirmModal` is single-instance.** A second call displaces the first (`onReplaced`); a displaced dialog is not an answer, so acknowledgement-based flows re-arm. A script that awaits a flow with nobody to click the dialog waits for ever — stub `window.confirmModal` in browser checks.

**E6. Focus can be handed back to an opener that is now hidden** (the More menu closes while the picker is up). Restore through `_visibleOpener(el)`. Guard: 9d-bookings.js.

**E7. Live regions.** Text written into a `[hidden]` region and then revealed is silent: say it through `announce()`. `#toast` stays un-roled (the fixed regions `#srStatus` / `#srAlert` speak); the minute tick's targets must never become live regions. A toast raised while a dialog is open is also written inside that dialog (`_dialogLiveRegion`). Guard: a11y.js.

**E8. Measuring inside an opening dialog.** The dialog scales in, so `getBoundingClientRect()` is measured through a transform while `scrollTop` is not; and `scrollIntoView()` moves the PAGE on iOS. Move the list's own `scrollTop`, measured in layout px (`_uwScrollTopToReveal`). Guard: 14a-usual-week-sheet.js.

## F. Build, generated files, service worker

**F1. `ios-app/www/` is generated, and so are the `SHELL` list and `CACHE` version in both sw.js copies.** `CACHE` is a content hash, so there is no version to bump. Never hand-edit them. After editing root `js/`, `css/`, `*.html`, `manifest.json` or `sw.js` run `cd ios-app && npm run build` and commit the result. Guard: `npm run drift` (CI, and the optional pre-commit hook in ios-app/PRECOMMIT.md).

**F2. `ios-app/www/native-bridge.js` is the one hand-maintained file there.** It lives ONLY in `www/`, is never overwritten, loads last and only in the iOS build — and it feeds the content hash, so an edit to it also needs the build. The web never loads it: web code reaches bridge functions behind `typeof` guards (`window._offerWeeklyReminder`), and the bridge carries its own copies of helpers because tests evaluate it alone (B5). Guard: drift; ios-bridge.js, ios-polish.js, widget-link.js.

**F3. The iOS storage mirror only FILLS missing keys, and only sees writes made after the bridge has loaded.** A key whose ABSENCE means something must be removed with `localStorage.removeItem` (the patched copy removes the mirror's too); a write made while earlier scripts run is not mirrored and must be said again after the restore (js/theme.js does this for a retired theme id). js/security.js waits for the restore before it reads the token (`_awaitNativeRestore`). The restore (`if (localStorage.getItem(key)) return`), `exportSettings` (`if (val)`) and the importer's `rawOf` are TRUTHINESS tests, so a stored flag is `'1'` or absent, or two non-empty words (`'on'` / `'off'`) — never `''`. Guard: 10b-themes.js, signin-storage.js.

**F4. After a rebuild a registered service worker keeps serving the OLD modules** — new functions are silently missing. Before driving a fresh build: unregister every worker, delete every cache, reload, then check the served file contains your new symbol (tests/README.md → "Driving the app against a stubbed API" → step 2, "After a rebuild, get rid of the old service worker"). The fake server disables worker registration for its run.

**F5. Opening psycle-finder.html talks to the live host** — a `preconnect`, then read-only GETs for the reference lists. Harmless, but not "no traffic". tests/smoke.html and `__H.boot()` (tests/tools/fake-psycle.js) answer everything themselves; use those when a task forbids all traffic.

## G. iOS and shipping

**G1. Swift date parsing followed the phone's locale.** On a UK phone with 24-Hour Time off, `…T18:30:00` parsed to nil: every widget empty, no Live Activity, Siri "no classes"; under a Buddhist or Islamic device calendar the class landed in 1483 / 2587. One factory now serves both directions — `PsycleFixedFormat` (fixed pattern, POSIX locale, Gregorian; PsycleShared/PsycleClassType.swift), used by `PsycleClock` and `PsycleDateParser`. Build no other `DateFormatter()`. Guard: `sh ios-app/native-checks/run.sh` (reproduces the 12-hour override, ar_SA, th_TH).

**G2. New `Codable` fields must be optional.** Older snapshots sit in the App Group and a Live Activity started by the previous build is still running after an update; a required field fails the decode and the card vanishes. Guard: ios-app/native-checks (decodes the previous build's payloads), 11-native-snapshot.js AND ios-polish.js ("R2-31": the `ContentState` init signature, the controller's call, the view's two `slotSummary` reads). The "previous build" structs in ios-app/native-checks/decode/main.swift (`ContentStateBeforeSeats`, `ContentStatePreviousBuild`, `AttributesPreviousBuild`) are HAND-WRITTEN: when a payload gains a field, add a struct with the shape that ships today as the new "previous", keep the older ones, and add the round-trip check and the "previous decoder ignores the new key" check.

**G3. The iOS 27 SDK kills an app without the scene life cycle at launch** — it archived and uploaded fine, then crashed on every phone. `SceneDelegate` lives at the bottom of App/AppDelegate.swift and forwards to shared handlers. UIKit no longer calls `applicationDidBecomeActive`, `applicationDidEnterBackground` or `application(_:open:)`: put new life-cycle work in `appDidBecomeActive()` / `appDidEnterBackground()`. ios-app/patch-plugins.js pins the plugin versions it edits and fails loud on drift.

**G4. The deployment-target floor lives in two places.** Xcode Cloud's Xcode rejects targets below its floor and the Capacitor pods declare 13.0, so the Podfile's `post_install` lifts every pod to `MIN_IOS_DEPLOYMENT_TARGET`. Change that constant and the project's `IPHONEOS_DEPLOYMENT_TARGET` settings together. GitHub's unsigned build has an older Xcode and does NOT catch this: eight archives failed in a row behind green checks.

**G5. A green GitHub run is not a TestFlight build, and a green archive is not a launch.** Read the `Xcode Cloud` check on the pushed commit (ios-app/CICD.md → Notes / gotchas): `success`; `action_required` = failed; `cancelled` = superseded by a newer push (harmless); NO check at all = never picked up, or the month's compute hours are spent — nothing in the repository needs changing, and the next step is the owner's (`agents/playbooks.md` P10). A red archive is G4, G8, `npm ci` failing to reach the registry, or plugin-patch drift — NOT G3: that build archives green and crashes on the phone. Then open the build on a phone.

**G6. Every push to `main` archives and uploads.** Compute hours are finite: work on a branch and batch commits into one push.

**G7. An unsigned simulator build proves the code compiles, no more.** It carries no entitlements, so a widget cannot read the App Group and no Live Activity starts. Anything native stays "compiled, not seen on a device" until the checklist is run (IMPROVEMENTS-2026-09.md, ios-app/NATIVE_FEATURES.md). Write it that way.

**G8. After changing Capacitor plugins, commit the regenerated `ios/App/Podfile` and `Podfile.lock`** (the drift check does not cover the native project). `ci_scripts/ci_post_clone.sh` must stay executable, and must not `brew install node` unconditionally — that killed every archive on images that ship Node.

## H. Verifying in a browser

**H1. An un-stubbed page makes REAL writes.** Book, Cancel, Leave waitlist and Claim spot spend a credit or give up a seat for whoever is signed in. `checkAuth` uses raw `fetch`, not `apiFetch`, so a hand-made stub must cover both; after any reload install it again, and confirm it is in place before the first click. Prefer tests/tools/fake-psycle.js, which takes `fetch` before the app's first line.

**H2–H3. Seeding a fresh profile**: `agents/playbooks.md` P8 step 3 — the welcome flag, the sync-prompt flag, the token through `_secureTokenStore`; never `_myBookings` by hand (`bookClass` waits for an applied `/bookings` answer, and with no token `fetchMyBookings` empties the map).

**H4. Use an origin you never sign in on.** A stub `/profile` with another customer id is an ACCOUNT SWITCH to the app: the real member's rankings are stashed and their history cleared.

**H5. Headless capture.** A `--screenshot` flag cannot wait for an app to settle: drive the browser over the DevTools protocol and wait for a signal the page gives (tests/tools/appstore-shots.mjs waits for a `READY` title). Headless Chrome does not always exit after `--screenshot` (assets/render-icons.sh waits for the file, then stops it). A page with no viewport meta is laid out wide and shrunk under mobile emulation — both harness pages carry one.

**H6. `env(safe-area-inset-*)` is 0 in a desktop browser.** To check an inset rule, re-inject the stylesheets IN ORDER as `<style>` elements with the inset replaced by a fixed length, disable the `<link>`s, and measure.

**H7. The HTTP cache can serve a stale stylesheet OR MODULE after an edit.** Unregistering the service worker and clearing Cache Storage does not touch the browser's own HTTP cache, and a plain static server invites heuristic caching: a page has run a js/app.js from before a fix while `fetch('/js/app.js')` showed the new source. Re-fetch every file the shell names with `{cache: 'reload'}` before booting (playbooks P8 step 3 does), then assert a symbol of your change on the RUNNING function (`String(window.fn).includes('…')`), not on the fetched text.

## I. Assumptions about Psycle

**I1. The release model is OBSERVED, not a contract** (read off Psycle's public timetable on one day — `agents/architecture/monday-release.md`). It may suggest and explain — a default range, an advisory note, where a reminder tap lands — and never block: a listed class can always be tried, and Psycle's answer stands. An earlier rule, stated to members as fact ("Next week opens Monday 12:00"), was simply wrong. Guard: 14a-usual-week-sheet.js, 14c-weekly-reminder.js.

**I2. The API is unofficial; a missing field never means yes.** List rows lack what detail rows carry (a studio's layout). Availability is `capacity` and `occupancy`, not the field the cards first read, so it never rendered. Only Psycle SAYING `is_fully_booked === false` counts as open (`pure:notify`). Shape drift is watched by `PsycleAPI.SCHEMAS` and js/diagnostic.js. Guard: notify.js, diag-wiring.js.

**I3. That `DELETE /bookings/{id}` removes exactly ONE seat's record — never its siblings from the same POST — is OBSERVED, not a contract;** tests/tools/fake-psycle.js models it that way. If a report shows a `seat:cancelled` action-log line and Psycle really dropped both seats, suspect Psycle's semantics or a changed `/bookings` shape before the client. Check by READING `/bookings` and `psycle_api_schema_log`, never by a live write.

**I4. A source comment that says "follow-up" or "TODO" is not a licence.** A time-zone "follow-up" for the widget snapshot, the T-90 reminders and the ICS export was offered and DECLINED (`agents/decisions.md` section 4, CLOSED). Check decisions.md before acting on any such comment.

## J. Review spend paths adversarially

- Why: even carefully specified work shipped two money bugs that only review caught (A4, and A5's "Choose again"). The July 2026 review found four critical and fifteen high-severity bugs in an app that "worked" (REVIEW.md).
- Avoid: for any path that sends a POST, PUT or DELETE, write the table before you ship: every answer (2xx, a 2xx with an odd body, a clean refusal, 409, 5xx, timeout, offline, sign-out mid-flight) × every prior state (nothing held, a seat held, a place held, an unverified POST pending) → what the member is told, and what is sent next. Run it on the fake server and count `__H.writes`. Then have a second pass try to break it — double taps, a dialog displaced, a re-plan, a reload between two requests.
