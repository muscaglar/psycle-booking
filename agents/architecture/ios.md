# iOS — the native targets (widget, Live Activity, Siri) and the Capacitor app (scene life cycle, calendar contract, reminders)
Read this when you touch ios-app/www/native-bridge.js, any Swift, the Xcode project, the calendar sync or notifications. Skip it for web-only work. The Android app loads the SAME bridge: everything here that is not Swift, the Live Activity or Siri applies to it too — its home-screen widget reads the SAME snapshot, through Java twins of `AppGroupPreferences`, `WidgetCenter` and `PsycleDeepLink` registered under those names; the Live Activity has no Android twin (`PsycleLiveActivity` must not gain one there): in its place the Android app posts ONE silent countdown notification, planned NATIVELY from that same snapshot by the Live Activity's own rules (`leadWindow`, the first class to come, gone at the start) — and what it does differently is [android.md](android.md) (→ "The class countdown"). Related: [monday-release.md](monday-release.md) (the Monday reminder), [time.md](time.md) (what is London-resolved and what is still device-local).

## Native iOS (WIRED — widget / Live Activity / Siri live in real targets)
Home Screen widget + Lock Screen Live Activity build in the `PsycleWidgetExtension`
target (iOS 16.1+, embedded in the app); the "next class" App Intent + Siri phrases
compile in the app target. Data path: native-bridge.js writes widget_next_class /
widget_week / widget_upcoming through the in-app `AppGroupPreferences` Capacitor plugin
(App/AppGroupPreferences.swift, registered by App/MainViewController.swift) into
`UserDefaults(suiteName: "group.com.psyclefinder.app")` — the standard Preferences
plugin CANNOT reach extensions (its "group" is a key prefix in UserDefaults.standard).
Project surgery is scripted+idempotent: ios-app/ios/App/wire_native_targets.rb.
See ios-app/NATIVE_FEATURES.md status block (incl. the one manual signing step:
the App Group + widget bundle id must be registered via a first signed build).

Added in September 2026 — **compiled in an unsigned simulator build only; none of it has been verified on a
device yet** (checklist in IMPROVEMENTS-2026-09.md):
- **Widget families**: `.systemSmall`, `.systemMedium` plus the Lock Screen `.accessoryRectangular` and
  `.accessoryInline` ("next class"). The small widget shows time, place and seat. iOS 17 `containerBackground`
  is adopted for both Home Screen and accessory families.
- **Widget deep link**: every family carries `widgetURL(psync://bookings?event=<id>)`. The scheme is deliberately
  NOT declared in Info.plist (WidgetKit hands a widgetURL straight to the containing app; unregistered, no other app
  can open it). `PsycleDeepLinkPlugin` (in App/AppGroupPreferences.swift, registered by MainViewController) forwards
  the URL to the web layer as an `openURL` event, retained until native-bridge.js attaches its listener (a widget
  tap usually cold-launches the app) and replayed once to a reloaded page within 10 seconds. The bridge parses it
  by hand (`_parseWidgetLink`, `pure:widget-link`) and routes it like a class-reminder tap: My Bookings, then that
  class's sheet; with no id, My Bookings alone. (Android opens no URL: its widget's tap is an explicit intent, and the
  Java twin of this plugin emits the same `openURL` with the same string — [android.md](android.md) → "The home-screen widget".)
- **Live Activity seat updates**: seats live in `ContentState.slotSummary` (dynamic), with `attributes.slotSummary`
  as the fallback so a card started by an older build still renders.
- **Live Activity retirement (2026-09-22)**: the card goes about five minutes after the class's scheduled start.
  `PsycleLiveActivityRetirement` (PsycleLiveActivityAttributes.swift — the one Live Activity source BOTH targets
  compile; its pure `verdict(start:now:)` / `nextCheck(starts:now:)` run on a Mac in ios-app/native-checks) is applied
  by three callers, none guaranteed to the minute: the `la-end` BGAppRefreshTask (`retireStartedAndWait`), the widget
  extension's `getTimeline` (it asks to be reloaded just after start + 5 min, and retires BEFORE it completes), and
  `refreshFromSnapshot` on a foreground. Inside the five minutes a caller ENDS the activity with
  `dismissalPolicy: .after(start + 5 min)`, so the system removes it on time with nothing of ours running; later, at
  once. Only `refreshFromSnapshot` passes `endUnstarted: true` (nothing should be showing): the other two must never
  take down a countdown that is still due. Seen compiled, never seen on a phone.
- **Crisp Colour widgets (2026-09-19)**: every family, the Live Activity (Lock Screen card + compact / minimal /
  expanded Dynamic Island) and the Siri answer wear the app's look — the TIME leads in a heavy condensed system face in
  **24-hour digits**, the class type's pictogram sits in a rounded tile, then class name, "Instructor · Studio", the
  seat chip in the class colour, the countdown; the card ground is the class tint at the member's intensity. The
  snapshot's class entries (and each week bucket, for the class that opens the day) carry OPTIONAL `ct` +
  `ctBase / ctTint / ctDeep / ctWash` (+ `…Dark`) + `ctIntensity`, written by `pure:native-snapshot` in native-bridge.js
  from the app's own `classTypeKey` and `PsycleClassColours` (at "off" `ctTint` is the neutral surface) and rewritten,
  debounced, on `classcolours:changed` when the choices really changed. Swift side: `PsycleShared/PsycleClassType.swift`
  (Foundation only, both targets — class type, the DEFAULTS fallback palette, a hex parser that fails safe,
  `PsycleClassStyle`, and **`PsycleClock`, the ONE place a time is formatted**: fixed `HH:mm` under the fixed POSIX
  locale, so the phone's 12/24-hour switch cannot rewrite it; still the DEVICE's zone. Its formatter comes from
  **`PsycleFixedFormat`, which the snapshot parser READS with too** (`PsycleDateParser` / `PsycleWeekDay` in
  PsycleSnapshot.swift): on the user's own locale `…T18:30:00` parsed to nil on a UK phone with 24-Hour Time off —
  every widget empty — and to the year 1483 / 2587 under a Buddhist / Islamic device calendar. No other
  `DateFormatter` is built anywhere in the widget / Live Activity / intent code) and, widget extension only,
  `PsycleWidget/PsyclePictogram.swift` (the eight marks as a `Shape`, the web's 24-grid numbers),
  `PsycleWidgetStyle.swift` (`PsycleSurface`: inks per rendering mode — full colour; full colour with the background
  taken away, i.e. StandBy; accented / vibrant, where fills go faint so a tile under a mark is never a blob) and
  `PsycleWidgetLayouts.swift` (plain-value views; a class name is never cut mid-word — one line, else two balanced
  one-line halves, else up to three wrapped lines, else the name's head on a card too short for that; the seat chip is
  never what a row squeezes). The countdown says "Now" from the class's start because `PsycleTimelinePlan` dates a
  timeline entry exactly there (`Text(.relative)` counts both ways); the Live Activity card paints its OWN ground
  (`psycleActivityGround`) so ink and ground cannot come from two appearances. A snapshot or a Live Activity payload from the previous build still
  decodes (every new field optional and read under `try?`; `ContentState` gained only `style`) and draws from the class
  name + the default colours. The Swift COPIES of web values — fallback palette, class-type words, pictogram numbers,
  chrome colours — are held to the originals by tests/suites/11-native-snapshot.js; change both together.
  `sh ios-app/native-checks/run.sh` runs the shipped model Swift on a Mac (old payloads decode; `18:30` is printed AND
  read back under the 12-hour override, ar_SA and th_TH; the timeline plan; pictograms in their grid; WCAG on every
  default tint) and `render.sh <dir>` draws the real layouts to PNGs —
  both through the Swift interpreter, because a Mac with binary authorization kills a locally built binary.
Any Swift edit must be re-proved with the App-scheme simulator build before it ships (main → TestFlight).

## Support Psync: the tip jar (2026-09-22)
Optional tips through each store's own in-app purchase; the reasoning and Apple's wording are in
[../decisions.md](../decisions.md) section 3 ("Money"). A tip unlocks NOTHING, so there is no entitlement, no
restore, no receipt validation and no server, and nothing about a tip is stored.
- **One plugin name, two platforms**: `Capacitor.Plugins.PsycleTipJar` — App/TipJarPlugin.swift (StoreKit 2; a new
  file, so it has FOUR entries in the Xcode project: build file, file reference, the App group, the app target's
  Sources) and android/…/PsycleTipJarPlugin.java (Play Billing 8) — with the same two methods: `products()` →
  `{ products: [{ id, displayPrice }] }`, any failure an empty list; `purchase({ productId })` →
  `{ status: 'purchased' | 'cancelled' | 'pending' | 'failed' | 'unavailable' }`.
- **ONE allow-list of three ids**, identical in js/tabs.js (`TIP_PRODUCTS`, inside `pure:tips`), the Swift
  (`PsycleTipProducts.ids`) and the Java (`tips/PsyncTips.IDS`, PURE, JVM-tested), each between
  `// ── tip-products:start` / `:end` markers that 24-tip-jar.js cuts by. Each native side checks the id it is
  handed against its OWN list first. Changing an id means all three, and new products in both stores.
- **iPhone**: only a VERIFIED transaction is thanked, and it is finished before `purchased` is answered; a
  `Transaction.updates` task started in `load()` finishes a tip that completes later (Ask to Buy). One purchase at
  a time, kept on the main actor.
- **The web layer** (js/tabs.js, above `renderMembershipInfo`): `renderSupportPsync()` runs on every Membership
  render, asks the store ONCE per launch, and shows `#supportPsync` only in a native app whose store returned a
  product — so the code is dormant until the products exist in App Store Connect / Play Console, and absent from
  the web app. The store's price is printed as text; rows are disabled while the store's sheet is up; the outcome
  is one of three fixed sentences (`_tipOutcome`), and "cancelled" says nothing.
- **No other way of paying is named anywhere in the shipped files** (24-tip-jar.js scans for the services' names):
  outside the US storefront an app and its metadata may not point to one, and `support.html` is the listings'
  Support URL.
- Proved: the simulator BUILD, and the web layer on fakes. Never seen: a real purchase sheet. The owner's steps
  (agreements, products, a sandbox purchase) are in ../../ios-app/APP_STORE_LISTING.md → "In-app purchases".

## iOS App
- Capacitor 6 wrapper in `ios-app/` (CLI pinned to 6 — must match core's major). The Xcode project under `ios-app/ios` is committed; see SETUP.md.
- Sync web assets: `cd ios-app && npm run sync`
- Deployment target: app + project iOS 15.0, widget extension 16.1. Xcode Cloud's Xcode fails the archive on anything below its floor, and the Capacitor pods declare 13.0, so the Podfile's `post_install` lifts every pod to `MIN_IOS_DEPLOYMENT_TARGET` — keep that constant and the project's `IPHONEOS_DEPLOYMENT_TARGET` in step. GitHub's unsigned build check does NOT catch this; read the Xcode Cloud check on the commit (ios-app/CICD.md → Notes / gotchas).
- **Scene life cycle (required by the iOS 27 SDK — an app without it is killed at launch).** `Info.plist` carries `UIApplicationSceneManifest` (one scene, storyboard `Main`, delegate `SceneDelegate`). `SceneDelegate` lives at the bottom of `App/AppDelegate.swift` (no project surgery): it forwards URL contexts and user activities — cold launch (`willConnectTo`) and warm — to Capacitor's `ApplicationDelegateProxy`, which is what `PsycleDeepLinkPlugin` reads (`lastURL`, `.capacitorOpenURL`), and calls `AppDelegate.appDidBecomeActive()` / `appDidEnterBackground()` (Live Activity reconcile, class-start background task). UIKit no longer calls `applicationDidBecomeActive` / `applicationDidEnterBackground` / `application(_:open:)` — put new life-cycle work in those shared handlers, never only in the `application…` callbacks. `patch-plugins.js` also patches `@capacitor/ios` 6.2.1 so `presentVC`'s temporary window joins the web view's scene (the in-app browser). Capacitor adopts scenes natively from 8.5 — **ios-app/UPGRADE-CAPACITOR-8.md** is the step-by-step 6 → 8 upgrade for this project (versions, the order of commands, what replaces the hand-written forwarding, what happens to each patch in `patch-plugins.js`, the three calendar-plugin call shapes that change in native-bridge.js, a device checklist and the rollback). It has not been run: it needs `npm install` and a regenerated lockfile on the Mac that builds the app.
- Native features: calendar integration, haptics, status-bar glyph style from the theme base, share sheet (settings export, ICS export), local notifications (Monday 12:00 UK — the release itself — scheduled as absolute Europe/London instants — 8 rolling one-shots, REMINDER_IDS 9992–9999, re-armed each launch and when the usual week is saved or cleared; a tap with no eventId lands on My Bookings and opens the usual-week REVIEW sheet on the dates that just opened when a usual week is saved, else Discover on the first of those dates — `window._onBookingWeekOpened()`, see Key Patterns → Monday reminder (iOS); a tap on a class reminder opens My Bookings and that class), persistent storage (the `SYNC_KEYS` mirror; the launch restore reads the missing keys in parallel)
- **Calendar contract**: a calendar the member has HANDED OVER is fully Psync-owned. Sync is an authoritative reconcile (`syncAllBookingsToCalendar` in native-bridge.js): every future event in that calendar that doesn't match a current booking is deleted; missing bookings are created. Plugin calls must match @ebarooni/capacitor-calendar **v6** (`notes`, `alertOffsetInMinutes`, `deleteEventsById`, `createEvent` → `{result: "<id>"}`) plus our patched-in `timeZone` (IANA id → `EKEvent.timeZone`). A reconcile never deletes without a live session and a loaded bookings list; "Re-sync now" and "Remove duplicates" report skipped vs synced truthfully (`_calSyncProblem`).
- **Calendar hand-over confirm + ownership ack**: picking a calendar is never consent. `_confirmCalendarOwnership` (js/settings.js) counts the upcoming events that are not Psycle bookings (`psycleCountForeignEvents`) and asks "Let Psync manage "<calendar>"?" — danger-styled and `irreversible: true` (one of the two FILLED-red confirms — see `_confirmTone`), "This can't be undone", confirm = "Use this calendar". Full ownership (deleting UNMARKED events) applies only after that dialog — `psycle_calendar_owned_ack='2:<calendarId>'` (`_calIsOwned(calId)`; a legacy `'1'` reads un-owned until "Re-sync now" shows the counted dialog), granted solely via `ownedAck:true` on `psycleSetCalendarConfig` / `psycleResyncCalendar`, cleared when the target changes without it; swept old targets are judged by their own ack, so switching calendars never wipes the old one. Without the ack every reconcile is marker-only (`psycle-event-id:` in the event notes), and "Remove duplicates" explains that and offers the same hand-over confirm. js/settings.js's calendar UI sits between `pure:calendar-sync:start/end` (tests/suites/calendar-safety.js evaluates it).
- **Class reminders / Live Activity**: T-90 reminders cover every held class (cap 40; the widget timeline keeps 5). Notification permission is asked once, in-app, after a first booking — never at launch. A held seat whose `GET /events/{id}` failed is unknown, not gone: the widget falls back to `psycle_bookings_snapshot` for when/what, and its armed reminder is never cancelled (`_staleReminderIds`, `pure:ios-polish`). Live Activity seats live in `ContentState.slotSummary` (dynamic) with `attributes.slotSummary` as the fallback for a card started by an older build. Any Swift edit must be re-proved with the App-scheme simulator build before it ships (main → TestFlight).
- **First-run welcome at launch**: the Preferences → localStorage restore may still be in flight when app.js first asks whether to show the welcome, so it goes up as a wordmark-only cover (`is-holding`) until `securityReady` settles, then is revealed or removed (5s fail-safe) — see Key Patterns → First-run welcome. Not yet timed on a device.
- **Gym time**: see Key Patterns → Gym time. Calendar events and the Monday reminder are London-resolved; the widget / Live Activity snapshot, T-90 reminders and the web ICS export are still device-local by the owner's decision.
- security.js waits for `window._psycleNativeRestoreDone` (set by native-bridge after the Preferences→localStorage restore) before reading the stored token; the AES key is backed up via `psycle_sec_key_backup` (stored beside the ciphertext in Preferences — a known, accepted trade-off).
- The web icons in `icons/` are not copied into the iOS bundle; the WebView never fetches them.
- Bug report: `window.getDiagnosticReport()` returns full device + app + log diagnostics, including a build id and the user agent

## Live Activity: where the pieces are
- The Lock Screen / banner card is `PsycleActivityCard`; its value type is `PsycleClassFacts`. Both are in PsycleWidget/PsycleWidgetLayouts.swift, shared with the widgets and drawn by ios-app/native-checks/render.sh. PsycleLiveActivity/PsycleLiveActivityView.swift only adapts the ActivityKit context into `PsycleClassFacts` and lays out the Dynamic Island; PsycleLiveActivityController.swift `refreshFromSnapshot()` builds the state from the snapshot.
- A Live Activity is at most 160pt tall and cannot scroll. Today's card is a time column plus a class head of up to 3 lines, "Instructor · Studio" and the seat chip — an extra line must be the FIRST thing to give way (through `ViewThatFits`), never the name's lines: `PsycleClassHead(lines: 2)` is only ever used together with `short: true` (a free two-line wrap is what cut "PILATES: SCUL…"), and 11-native-snapshot.js greps inside `PsycleClassHead` only, so a `lines: 2` at a call site would not be caught.
- Payloads (stored properties, with lines: agents/index/swift.md):

| Payload | Fields |
|---|---|
| Snapshot entry — `PsycleNextClass` (on Android `PsyncSnapshot.Entry`), built per class by the bridge's `_snapshotEventFor`, stored by `updateWidgetSnapshot` | `eventId, startAt, instrName, typeName, studioName, locName, slots` + the optional flat `ct…` colour fields |
| Live Activity attributes — `PsycleClassActivityAttributes`, FIXED at start | `eventId, typeName, instrName, locName, slotSummary?` |
| `ContentState` — dynamic | `startAt, status, slotSummary?, style?` |

  The room name (`studioName`) is in the snapshot but NOT in the Live Activity payload, so showing it needs Swift only: no bridge edit, no `npm run build`. How to add a field: agents/playbooks.md P7 step 6. The snapshot has TWO native readers since the Android widget: a new field is optional, with a fallback, in Swift AND in ios-app/android/…/widget/PsyncSnapshot.java (ios-app/android/AGENTS.md rule 16), and a changed method shape of `AppGroupPreferences` or `WidgetCenter` changes the Java twin with it.
- Native "Instructor · Studio" prints the BUILDING (`locName`) and falls back to the room (`studioName`) only when `locName` is empty. The same expression is written five times — `PsycleClassFacts.init(_:)` (PsycleWidgetLayouts.swift), PsycleWidget.swift, PsycleLiveActivityController.swift, PsycleIntents/NextClassIntent.swift and the class-reminder body in native-bridge.js: change them together.

## Snapshot time contract
`startAt` / `firstStart` in `widget_next_class` / `widget_upcoming` / `widget_week` are ZONE-LESS London wall strings (space → `T`, nothing else). `PsycleDateParser.parse` tries zoned ISO-8601 first (only a value that carries a zone matches), then the wall-time formatter. Swift READS and PRINTS through the one zone of `PsycleFixedFormat.formatter` (the device's), so the digits always print as written ("18:30") but the INSTANT is the device's 18:30 — and every countdown is instant-based (`Text(_, style: .relative)`, `Text(timerInterval:)`, `PsycleTimelinePlan.steps`, the Live Activity's 90-minute lead window via `PsycleSnapshotStore.firstClass(startingAfter:)`, Siri's "in about N hours"), so abroad they are off by the zone offset. The string becomes a `Date` in exactly two places: `PsycleNextClass.startDate` and `PsycleWeekDay.date`. Inside `updateWidgetSnapshot` three reads are device-local: the started / upcoming filter and sort (`new Date(start_at)`), the week bucket's day key (device getters), and `_scheduleClassRemindersInner`'s `new Date(c.startAt)` minus 90 minutes; the filter and sort feed the reminder list too, so the two cannot be changed apart without splitting the walk. The bridge's London resolver `_classStartMs` is in the same file and is deliberately NOT called there — the owner's decision, CLOSED (agents/decisions.md section 4). The Android widget's reader keeps the same contract: `PsyncSnapshot` prints the digits as written and takes the instant in the zone its caller hands in, and the provider hands in the DEVICE's.

`psycle_class_reminder_map` stores `{id, startAt}`, and `_staleReminderIds` re-arms only when the `startAt` STRING changes; a class already in the map is never rescheduled. Any change to HOW a fire time is computed must also change the map entry (store the fire time, or a version), or armed reminders keep the old time — and a reminder is never re-armed once T-90 has passed.

## Calendar sync: when it runs, what guards it
- ONE writer: `syncAllBookingsToCalendar` holds the only sync-time `Calendar.createEvent` / `_deleteNativeEvents` (the only other deleter is `psycleSetCalendarConfig`'s old-target sweep). It is reached only through `_scheduleCalReconcile()` (1200 ms debounce; a no-op unless `calendarSyncEnabled() && hasChosenCalendar()`) → `_runCalSync()` (single-flight; a change that lands mid-pass queues one re-run). Armed by the bridge's wrappers on `submitBooking`, `confirmUnbook`, `upcomingCancel`, `cancelBikeSlot`, `upcomingSeatCancel`, by `bookings:loaded`, once by the `renderMyBookings` wrapper; run directly by `psycleResyncCalendar`. There is no per-class add / remove function and none may be added: a feature that wants "this class in the calendar" changes `_myBookings` and lets the reconcile do it.
- Guards that live in source only: an empty `_myBookings` is trusted only when `bookings:loaded` confirmed it (`_calServerConfirmedEmpty`); a 120-day look-ahead; an event is kept only when its title AND start (± 60 s) match, else deleted and recreated; a live booking's event is never deleted over missing `_eventCache` metadata; events with no `calendarId` and no marker are left alone; other calendars and past events are never touched; waitlisted entries build no event (`_buildCalEventData`).
- In today's UI every pick runs `_confirmCalendarOwnership` BEFORE `psycleSetCalendarConfig` (`onCalendarTargetChange`), and a refusal leaves nothing picked, so marker-only is reachable only for a target picked by a build older than the dialog. `_ensureCalendarPermission()` REQUESTS iOS calendar access, so `psycleListCalendars`, `psycleCountForeignEvents`, the reconcile and merely opening Settings → Calendar Sync can raise the system prompt; a check-only read is `Calendar.checkAllPermissions()`. `openSettings('calendar')` opens the panel at that section. No booking flow offers calendar sync today — Settings is the only entry point.

## Self-opening asks (iOS)
Two exist: `_maybeAskClassReminders` (on `booking:complete`) and `window._offerWeeklyReminder(reason)` (usual week saved / review closed). The recipe for another: a `pure:` decision function (`_weeklyOfferDecision` is the model); an "asked" key in `SYNC_KEYS`; two clear `_askBlocked()` polls one second apart; give up by the clock (`ASK_GIVE_UP_MS`); never into a hidden app; `onReplaced` = not answered; the iOS system prompt only after an in-app yes. Asks cannot collide — `psycleConfirmOverlay` is in `ASK_BLOCKING_IDS` and the check-then-open is synchronous — but they DO queue back to back, so a new ask states which existing ask it yields to: one ask per moment.
