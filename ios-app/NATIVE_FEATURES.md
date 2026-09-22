# iOS Native Features — Integration Guide

> **STATUS (2026-07-07): WIRED.** Everything below the status block is the
> original design guide, kept for reference. The actual wiring was done by
> `ios/App/wire_native_targets.rb` (xcodeproj-gem surgery, idempotent) and
> compiles clean. What exists now:
>
> - **`PsycleWidgetExtension` target** (WidgetKit app-extension, iOS 16.1+,
>   bundle `com.psyclefinder.app.widgets`): PsycleWidget.swift,
>   PsycleLiveActivityView.swift, PsycleLiveActivityAttributes.swift,
>   PsycleSnapshot.swift. Embedded in the app via an "Embed Foundation
>   Extensions" phase. Entitlements: `group.com.psyclefinder.app`.
> - **App target additions**: PsycleSnapshot.swift,
>   PsycleLiveActivityAttributes/Controller, NextClassIntent, AppShortcuts,
>   plus `App/AppGroupPreferences.swift` (custom Capacitor plugin, see below)
>   and `App/MainViewController.swift` (registers it —
>   Main.storyboard's VC class). `App/App.entitlements` carries the same App
>   Group. `NSSupportsLiveActivities` is set in Info.plist, and
>   `applicationDidBecomeActive` calls
>   `PsycleLiveActivityController.shared.refreshFromSnapshot()`.
> - `NotificationCategories.swift` is deliberately in NO target (the
>   Capacitor notification path is the live one — see section 6).
>
> **IMPORTANT CORRECTION to the original guide's "Option A":** the
> @capacitor/preferences v6 plugin stores everything in
> **`UserDefaults.standard`** — its `group` config is only a key PREFIX, not
> a `UserDefaults(suiteName:)`. Pointing it at the App Group id would never
> reach the shared container AND would orphan all previously mirrored data.
> The live wiring is therefore **Option B done properly**: the custom
> `AppGroupPreferences` plugin writes the widget snapshot into the real App
> Group suite (`UserDefaults(suiteName: "group.com.psyclefinder.app")`), and
> native-bridge.js already prefers that plugin when present. The Preferences
> `group` stays `"PsycleFinderSettings"`.
>
> **One manual step remains (signing):** the App Group
> `group.com.psyclefinder.app` and the new widget bundle id must exist in the
> developer portal. With automatic signing, building once on a device from
> Xcode registers both. Until then, Xcode Cloud archives may fail
> provisioning for the extension.
>
> **Live Activity behavior (2026-07-09 redesign, empirically grounded):**
> iOS only allows STARTING a Live Activity while the app is foregrounded
> (no push server here), so the card appears when the app is opened within
> **90 minutes** of class start. Reliability depends on TWO triggers: the
> didBecomeActive hook (fires immediately, often against a stale snapshot)
> AND the `PsycleLiveActivity.refresh()` nudge native-bridge.js sends right
> after each fresh snapshot write — without the nudge the card only
> appeared on the second app open. Class selection reads the multi-class
> `widget_upcoming` list (stale-tolerant), not the single next_class key.
> Verified in the simulator: an ACTIVE request
> presents on the Dynamic Island; the request-then-end(.after:) trick from
> the previous design presents NOTHING and was removed. Cleanup at class
> start: staleDate flips the card to "In class" at T0 with no process
> running, and the card then goes about FIVE MINUTES after the scheduled
> start (the owner's rule; `PsycleLiveActivityRetirement` in
> PsycleLiveActivityAttributes.swift, the one Live Activity source both
> targets compile). iOS cannot be told that up front — only running code, or
> a push from a server this app does not have, can end an activity — so
> whoever runs first once the class has started applies it: the
> BGAppRefreshTask (com.psyclefinder.app.la-end, registered in AppDelegate),
> the widget extension's timeline reload (it asks to be reloaded just after
> start + 5 min), or the app coming to the foreground. A run inside the five
> minutes ENDS the activity with `dismissalPolicy: .after(start + 5 min)`,
> which hands the removal to the system; a later run removes it at once.
> None of the three is guaranteed to the minute: with background refresh off
> and no widget placed, the card stays "In class" until the app is opened
> (iOS itself retires it after some hours). The widget self-advances via
> a multi-entry timeline built from `widget_upcoming` (next 5 classes).
>
> **Verification honesty:** what has been OBSERVED working (simulator,
> unsigned build): the full workspace compiles; the app boots with
> MainViewController + the AppGroupPreferences plugin registered; the JS
> snapshot lands as bare keys in `UserDefaults(suiteName:
> "group.com.psyclefinder.app")`. What has NOT been observed yet: the
> **cross-process** read — unsigned builds carry no entitlements, so that
> suite lives in the app's private container, and the widget process reading
> it can only be exercised by a SIGNED device build. First signed build:
> add the widget, log in, confirm it shows your next class (and that the
> snapshot `startAt` parses — the space→T normalization in
> `_snapshotEventFor` is load-bearing for the countdown/Live Activity).

> **Crisp Colour widgets (2026-09-19) — COMPILED, NOT YET SEEN ON A DEVICE.**
> The Home Screen widgets (small, medium), the two Lock Screen accessories, the
> Live Activity (Lock Screen card + all three Dynamic Island presentations) and
> the Siri answer wear the app's look: the TIME leads in a heavy condensed
> system face, in **24-hour digits**; the class type's **pictogram** sits in a
> rounded tile; then the class name, "Instructor · Studio", the seat as a chip
> in the class colour, the countdown. The card ground is the class tint at the
> member's intensity (neutral at "off"), light and dark.
>
> - **Snapshot.** Every class entry (`widget_next_class`, each `widget_upcoming`
>   item) and every `widget_week` bucket (for the class that opens the day) may
>   now carry `ct` (ride · strength · yoga · hiit · pilates · lagree · barre ·
>   other — the app's own `classTypeKey`) and the member's CURRENT colours for
>   that type as `#RRGGBB`: `ctBase` `ctTint` `ctDeep` `ctWash` + the same four
>   with a `Dark` suffix, and `ctIntensity` (off · soft · bold). `ctTint` is the
>   card ground at that intensity — at "off" the app's neutral surface. Written
>   by `pure:native-snapshot` in native-bridge.js from `PsycleClassColours`;
>   rewritten (250ms debounce) on `classcolours:changed` when the choices really
>   changed. **All optional in Swift**: a snapshot without them decodes as
>   before; the type is then read off the class name
>   (`PsycleClassType.from(typeName:)`) and drawn in the app's DEFAULT colours.
>   Colour fields are all-or-nothing per appearance and can never fail a decode.
>   The time handling is untouched — still device-local; only the format moved.
> - **Files.** `PsycleShared/PsycleClassType.swift` (Foundation only; BOTH
>   targets: class type, fallback palette, hex → colour that fails safe,
>   `PsycleClassStyle`, `PsycleClock` — the ONE place a time is formatted — and
>   `PsycleFixedFormat`, the one formatter factory behind BOTH directions: fixed
>   pattern, fixed POSIX locale, Gregorian calendar, the device's zone.
>   `PsycleClock` prints with it and `PsycleDateParser` / `PsycleWeekDay`
>   (`PsycleSnapshot.swift`) READ the snapshot's zone-less wall times with it. A
>   formatter left on the user's locale is rewritten by the phone's 12/24-hour
>   switch — it printed "6:30 pm" and, worse, PARSED `…T18:30:00` to nil on a UK
>   phone with 24-Hour Time off (every widget empty) — and reads "2026" as year
>   2026 of a Buddhist / Islamic device calendar (the class lands in 1483 /
>   2587)). Widget extension only: `PsycleWidget/PsyclePictogram.swift`
>   (the eight marks as a `Shape`, the web's 24-grid numbers),
>   `PsycleWidgetStyle.swift` (surface + inks per rendering mode, tile, chip,
>   faces) and `PsycleWidgetLayouts.swift` (the layouts, as plain-value views).
>   `wire_native_targets.rb` knows all four.
> - **Rendering modes.** `.fullColor` → the class tint and the app's inks.
>   `.fullColor` with the background taken away (StandBy;
>   `showsWidgetContainerBackground`) → the system's inks; tile and chip keep
>   their own fill + ink. `.accented` / `.vibrant` (tinted Home Screen, Lock
>   Screen) → the system keeps only opacity, so fills go faint and marks / labels
>   stay full strength — never a filled tile under a stroked mark (a blob).
> - **A class name is never cut mid-word** (`PsycleClassHead`): one line; else two
>   BALANCED one-line halves (`PsycleClassName.balancedHalves`, "REFORMER
>   PILATES:" / "SCULPT 50" — only taken when both really fit, because neither
>   `ViewThatFits` can see a wrapping Text being truncated); else free wrapping
>   on up to three lines. A card without the height for that (the small family
>   on a 4.7-inch phone, larger text) prints the name's head — "REFORMER
>   PILATES", the inline accessory's rule — after giving up the countdown and
>   stepping the time down; VoiceOver always gets the whole name. The seat chip
>   is never what a row squeezes: "12 this week" gives way on the medium card.
> - **The countdown** reads "in 2 hr, 5 min" and "Now" from the class's start:
>   `PsycleTimelinePlan` (PsycleSnapshot.swift) dates one timeline entry exactly
>   at each start, because `Text(.relative)` counts in both directions and the
>   line compares the start with its ENTRY's date — without that entry it read
>   "in 40 sec", climbing, for the minute after the class began.
> - **The Live Activity card paints its own ground** (`psycleActivityGround`) in
>   the same render pass that picks the inks; `activityBackgroundTint` stays only
>   as the hint underneath. The platter's tint is known to lag a light ↔ dark
>   switch while a card is up, and the inks follow `colorScheme` at once — left
>   to the tint alone that is pale ink on a pale ground until the next flip.
> - **Live Activity compatibility.** `ContentState` gained ONE optional field,
>   `style`; the static attributes and the initializer are unchanged. A card
>   started by the previous build decodes (`style == nil`) and draws from
>   `attributes.typeName` + the default colours. Seats still read
>   `state.slotSummary ?? attributes.slotSummary`.
> - **The inline accessory cannot draw a Shape** (that family takes Text and an
>   Image, nothing else). Its pictogram is the same Shape handed over as a small
>   template image (`PsycleGlyph`, `ImageRenderer`) — not an SF Symbol stand-in;
>   if it cannot be rendered the line goes out as text alone.
> - **Checks that run on a Mac** (`ios-app/native-checks/`, no simulator):
>   `sh ios-app/native-checks/run.sh` runs the SHIPPED model files — the previous
>   build's snapshot and Live Activity payloads decode, nonsense colour fields
>   never fail a class, `18:30` prints AND the snapshot's `…T18:30:00` is read
>   back as that instant in four runs (as the Mac is set · a UK phone with
>   24-Hour Time off · ar_SA · th_TH — each run prints what a careless formatter
>   does there, so you can see the hazard really was reproduced; the 12-hour
>   override only takes as a plist boolean, `-AppleICUForce12HourTime '<true/>'`),
>   the timeline dates an entry at each class's start, every pictogram sits in
>   its grid, the inks hold WCAG on every default tint.
>   `sh ios-app/native-checks/render.sh <dir>` draws the real layouts to PNGs
>   (every class type, intensity, phone size, light / dark, recoloured) — a
>   drawing of the SwiftUI views, not WidgetKit. Both go through the Swift
>   interpreter: a Mac with binary authorization kills a locally built binary.
>   tests/suites/11-native-snapshot.js holds the Swift copies (fallback palette,
>   class-type words, pictogram numbers, chrome colours) to the web originals.
> - **On a phone (nothing below has been seen yet):** see "Device checklist —
>   Crisp Colour widgets" at the end of this file.

This guide wires up four native iOS features whose **data layer is already
done in JavaScript** (`ios-app/www/native-bridge.js`) and whose **Swift UI is
already written** (drop-in files under `ios-app/ios/App/`). What remains can
only be done in Xcode: creating the extension targets, enabling the App Group,
and adding files to target membership.

The features:

1. **Home Screen Widget** (WidgetKit) — next class + countdown (small + medium).
2. **Live Activity** (ActivityKit) — Lock Screen / Dynamic Island countdown.
3. **Siri / Shortcuts intent** (App Intents) — "What's my next class?".
4. **Actionable notifications** — Book / Cancel / Snooze buttons (already wired
   via Capacitor in JS; native reference provided).

> **Honesty note:** Everything in JS is implemented and `node --check`-clean.
> Every Swift file is idiomatic and ready, but **none of it compiles until you
> create the targets in Xcode and add the files to them** — that step cannot be
> scripted from the CLI. Follow the ordered steps below exactly.

---

## 0. The data contract (already implemented in JS)

`native-bridge.js` recomputes a compact snapshot from the app's live state
(`_myBookings` + `_eventCache`) on every `bookings:loaded` / `booking:complete`
/ `booking:cancelled` / `seat:cancelled` event, on `visibilitychange`
(foreground), ~4s after launch, and (debounced) when the member changes their
class colours. It writes three keys:

| Key | Shape | Notes |
|-----|-------|-------|
| `widget_next_class` | `{eventId, startAt, instrName, typeName, studioName, locName, slots}` + the optional colour fields **or** the literal `null` | `startAt` is an ISO-8601 string; `slots` is `[Int]` |
| `widget_upcoming` | `[` the same shape `]`, soonest first, up to 5 | what the widget timeline and the Live Activity really read (stale-tolerant) |
| `widget_week` | `[{day, count, firstStart}]` + the optional colour fields of the day's first class | `day` = local `"YYYY-MM-DD"`; `firstStart` ISO string; one entry per booked day in the next 7 days |

Optional colour fields (since 2026-09-19; absent in older snapshots, and whenever
the web layer's `classTypeKey` / `PsycleClassColours` are not there): `ct`,
`ctIntensity`, `ctBase`, `ctTint`, `ctDeep`, `ctWash`, `ctBaseDark`, `ctTintDark`,
`ctDeepDark`, `ctWashDark` — see the "Crisp Colour widgets" status block above.

The Android app's home-screen widget reads these SAME three keys (through a Java twin of `AppGroupPreferences`,
into its own private preferences file — `ANDROID.md` → "The widget"): a change to a shape here has two native
readers, and a new field must be optional, with a fallback, in both.

These are written to **Capacitor Preferences** (which on iOS is
`UserDefaults(suiteName:)`) and **mirrored** into the App Group suite under the
bare keys. The Swift side reads them via `PsycleSnapshotStore`
(`PsycleShared/PsycleSnapshot.swift`).

### How Capacitor Preferences maps to UserDefaults (read carefully)

- `capacitor.config.json` sets `Preferences.group = "PsycleFinderSettings"`.
- The Capacitor iOS Preferences plugin stores each value in
  `UserDefaults(suiteName: "PsycleFinderSettings")`, **namespacing** the key as
  `"PsycleFinderSettings.<key>"` (e.g. `PsycleFinderSettings.widget_next_class`).
- **A Capacitor Preferences "group" is NOT an App Group container.** A plain
  `UserDefaults(suiteName: "PsycleFinderSettings")` is a private suite that an
  extension cannot read.

You therefore have two ways to let the widget/Live Activity/intent read the
snapshot. **Pick ONE:**

**Option A (recommended, simplest): point Capacitor Preferences at the App Group.**
Change the Preferences group in `capacitor.config.json` **and** in
`ios-app/ios/App/App/capacitor.config.json` to your App Group id:

```json
"Preferences": { "group": "group.com.psyclefinder.app" }
```

Then `UserDefaults(suiteName: "group.com.psyclefinder.app")` is the same suite
Capacitor writes to, and the extension can read it. `PsycleSnapshotStore`
already falls back to reading the `PsycleFinderSettings.<key>` namespaced form,
so it works whether or not you take this option. **Re-run `npm run sync` after
editing `www/`.**

**Option B: keep `PsycleFinderSettings` and rely on the JS App Group mirror.**
`native-bridge.js` calls an `AppGroupPreferences`/`SharedPreferences`
Capacitor plugin (if present) to also write the bare keys into the App Group
suite. If you don't have such a plugin installed, this is a no-op and the
widget will see nothing — so **Option A is strongly preferred** unless you add
an App Group plugin.

> The App Group id used throughout is **`group.com.psyclefinder.app`**. It is a
> placeholder defined in `WIDGET_APP_GROUP` (native-bridge.js) and
> `PsycleAppGroup.id` (PsycleSnapshot.swift). If you change it, change it in
> BOTH and in every target's App Group capability.

---

## 1. Create the App Group (do this first)

1. Open `ios-app/ios/App/App.xcworkspace` in Xcode.
2. Select the **App** target ▸ **Signing & Capabilities**.
3. Click **+ Capability** ▸ **App Groups**.
4. Click **+** under App Groups and add **`group.com.psyclefinder.app`**
   (or your own id — then update the two Swift/JS constants above).
5. Make sure the checkbox next to the group is **ticked**.

You'll repeat the "add App Groups capability + tick the same group" step for
**every extension target** you create below.

If you took **Option A**, also edit both `capacitor.config.json` files to set
`Preferences.group` to the App Group id, then run `cd ios-app && npm run sync`.

---

## 2. Where each Swift file goes

The files already exist on disk under `ios-app/ios/App/`:

```
PsycleShared/
  PsycleSnapshot.swift          → App Group reader + shared models
PsycleWidget/
  PsycleWidget.swift            → @main WidgetBundle, widget, view, provider
PsycleLiveActivity/
  PsycleLiveActivityAttributes.swift   → ActivityAttributes (app + extension)
  PsycleLiveActivityView.swift         → Lock Screen / Dynamic Island UI (extension)
  PsycleLiveActivityController.swift   → start/update/end helper (app)
PsycleIntents/
  NextClassIntent.swift         → "What's my next class?" AppIntent
  AppShortcuts.swift            → Siri phrases (AppShortcutsProvider)
  NotificationCategories.swift  → native UNNotificationCategory reference (optional)
```

Target membership (set via File Inspector ▸ Target Membership for each file):

| File | App target | Widget Extension | App Intents host* |
|------|:---------:|:----------------:|:-----------------:|
| `PsycleSnapshot.swift` | ✅ | ✅ | ✅ |
| `PsycleWidget.swift` | — | ✅ | — |
| `PsycleLiveActivityAttributes.swift` | ✅ | ✅ | — |
| `PsycleLiveActivityView.swift` | — | ✅ | — |
| `PsycleLiveActivityController.swift` | ✅ | — | — |
| `NextClassIntent.swift` | ✅ | — | (✅ if separate) |
| `AppShortcuts.swift` | ✅ | — | (✅ if separate) |
| `NotificationCategories.swift` | ✅ (optional) | — | — |

\* App Intents can live in the **App target** (simplest — that's the default
column above) or a dedicated App Intents Extension. If you keep them in the App
target, ignore the "App Intents host" column.

---

## 3. Add the Widget Extension target

1. **File ▸ New ▸ Target… ▸ Widget Extension**.
2. Name it **`PsycleWidgetExtension`**. **Uncheck** "Include Live Activity" in
   the wizard (the Live Activity UI is added manually so both widget kinds
   share one bundle). **Uncheck** "Include Configuration App Intent" (we use a
   `StaticConfiguration`). Click **Finish**, then **Activate** the scheme.
3. Xcode generates a starter `PsycleWidgetExtension.swift` (or similar) with its
   own `@main`. **Delete that generated file** — `PsycleWidget.swift` already
   declares the `@main WidgetBundle`. (There must be exactly one `@main` in the
   extension.)
4. Add to the extension target's membership:
   - `PsycleWidget/PsycleWidget.swift`
   - `PsycleShared/PsycleSnapshot.swift`
   - `PsycleLiveActivity/PsycleLiveActivityAttributes.swift`
   - `PsycleLiveActivity/PsycleLiveActivityView.swift`
5. Select the extension target ▸ **Signing & Capabilities** ▸ **+ Capability ▸
   App Groups**, and tick **`group.com.psyclefinder.app`** (the same group as
   the app).
6. Set the extension's **Deployment Target** to iOS 16.1 or later (Live Activity
   needs 16.1; the widget itself works on 14+, but the shared bundle pulls in
   the Live Activity types).

---

## 4. Enable the Live Activity

1. In **`PsycleWidget.swift`**, extend the `@main` bundle to include the Live
   Activity widget (kept as a manual step so the files stay independent):

   ```swift
   @main
   struct PsycleWidgetBundle: WidgetBundle {
       var body: some Widget {
           PsycleWidget()
           if #available(iOS 16.1, *) { PsycleLiveActivityWidget() }
       }
   }
   ```

2. Add **`NSSupportsLiveActivities`** = `YES` to the **MAIN APP**
   `Info.plist` (`ios-app/ios/App/App/Info.plist`):

   ```xml
   <key>NSSupportsLiveActivities</key>
   <true/>
   ```

3. The app starts/ends activities via `PsycleLiveActivityController`
   (`PsycleLiveActivityController.swift`, already in the App target). Because
   bookings flow through the web/JS layer, the app needs a trigger to call
   `PsycleLiveActivityController.shared.refreshFromSnapshot()`. Two easy hooks:
   - Call it from `AppDelegate.applicationDidBecomeActive(_:)`.
   - Add a tiny Capacitor plugin method (e.g. `PsycleLiveActivity.refresh()`)
     and call it from JS after the widget snapshot is written.

   **Follow-up:** the JS bridge already computes the snapshot; wiring a plugin
   call so JS can nudge `refreshFromSnapshot()` after each booking change is a
   small, optional enhancement.

---

## 5. Add the Siri / Shortcuts intent

Simplest: keep the App Intents in the **App target** (they already are, per the
table). Just confirm:

1. `NextClassIntent.swift` and `AppShortcuts.swift` are members of the **App**
   target (and `PsycleSnapshot.swift` too — it is).
2. The App target has the **App Group** capability (added in step 1) so the
   intent can read the snapshot.
3. Build & run once on a device/simulator. After first launch, ask Siri
   *"What's my next class in Psync"* or open the **Shortcuts** app and
   search "Next class". (Spoken app name = the display name "Psync".)

If you prefer isolation, create an **App Intents Extension** target instead, add
`NextClassIntent.swift`, `AppShortcuts.swift`, and `PsycleSnapshot.swift` to it,
and give it the App Group capability. Only one `AppShortcutsProvider` per target.

> **Booking via Siri is a follow-up, not in scope.** Creating a booking needs
> the auth token + slot picker + POST that live in the web/JS layer. A write
> intent would have to bridge into the webview or re-implement the booking API
> natively. The deliverable here is the **read-only** "next class" intent.

---

## 6. Actionable notifications (Book / Cancel / Snooze)

**Already wired in JS** — no Xcode work required for the Capacitor path:

- `native-bridge.js → registerNotificationActions()` registers a
  `PSYCLE_CLASS` action type. The Capacitor LocalNotifications plugin turns
  this into a `UNNotificationCategory` with Book / Cancel / Snooze buttons.
- Taps are routed by the `localNotificationActionPerformed` listener:
  - **Snooze** re-schedules the reminder ~1h later (native, no app launch).
  - **Book / Cancel / tap** go through `_routeNotificationTap(eventId)`. Nothing
    is ever booked or cancelled from a notification: the web layer owns that
    (auth, the seat picker, the confirm sheets).
    - A **class reminder** carries `extra.eventId` → My Bookings, then that
      class's sheet (only while the seat is still held; on a cold start it waits
      for ONE `bookings:loaded`, at most 10s by the clock).
    - The **weekly reminder** carries none → see 6a.

To actually surface the buttons, schedule notifications with
`actionTypeId: 'PSYCLE_CLASS'` and `extra: { eventId }`. (The weekly reminder
doesn't use a category; the per-class reminders do.) (An earlier version of this
guide described a `window.handleNotificationIntent` hand-off and a
`sessionStorage` stash: no module ever defined or read either, so a tap went
nowhere — `_routeNotificationTap` replaced them.)

### 6a. The weekly reminder — Mondays 12:00, "New Psycle dates are open"

Psycle opens new dates on Mondays at 12:00 Europe/London, and that is when the
reminder fires (it fired at 11:59 and said "opens at 12:00" until September
2026). All of it is JS in `native-bridge.js`; there is no Swift.

- **Schedule** — `pure:weekly-reminder` → `_nextMondaysNoonLondon(count, now,
  wallToUtcMs)`: the next **8** Mondays as ABSOLUTE instants resolved through
  the bridge's Europe/London helper (`_gymWallToUtcMs`), so DST and the phone's
  own zone cannot move them (11:00 UTC in summer, 12:00 UTC in winter). Eight
  rolling one-shots rather than a repeating trigger: an hour-of-day repeat
  broke whenever the device's DATE differed from London's. `REMINDER_IDS`
  9992–9999 are unchanged, and every pass cancels those eight before it
  schedules — so reminders an older build armed for 11:59 are REPLACED at the
  first launch of the new one, never doubled. Re-armed 3s after every launch
  (`checkPermissions` only — a launch never prompts).
- **Copy** — `_weeklyReminderCopy(hasUsualWeek)`: title "New Psycle dates are
  open"; body "Book your usual week for the dates that just opened." when a
  usual week is saved (`psycle_weekly_template` is a non-empty array), else
  "Find your classes for the dates that just opened." It fires AT the release,
  so it says the dates ARE open and still reads true when the banner is seen
  later. The body follows the usual week: the bridge wraps
  `window.saveWeeklyTemplate` / `window.clearWeeklyTemplate` and listens for
  `data:owner-changed`, re-arming only while the reminder is on and only when
  the sentence would change; passes are serialized.
- **The tap** — lands at once on My Bookings when a usual week is saved, else
  Discover, then hands over to `window._onBookingWeekOpened()` in `js/app.js`
  (and only to it): the usual-week **review sheet** on the dates that just
  opened — `bookTemplateWeek({ range: 'newest' })`; **nothing is booked by the
  tap**, the sheet books only what the member ticks and confirms — or Discover
  on the first of those dates, never saved as the launch default. It waits for
  launch to finish, for a verified session and for every dialog / sheet / busy
  Book button to clear, and gives up 15s after the tap by the clock. If the
  review is already on screen it opens no second sheet and arms no retry — the
  tap itself (never a later poll) asks the open sheet to list the newly opened
  dates first
  (`window._usualWeekSheetNewest()`; refused during a run, over the seat map
  and over a run's results) (agents/architecture/monday-release.md → Monday reminder (iOS)).
- **On / off** — `psycle_weekly_reminder` `'on'` | `'off'` (unset = off;
  mirrored to Preferences). `window._nativeReminder.enable()` is the ONLY place
  the iOS permission prompt can come from, and only ever after a deliberate
  tap: the Settings switch ("Monday booking reminder — Mondays at 12:00 — when
  Psycle opens new dates"), or a yes to the in-app offer.
- **The in-app offer** — `window._offerWeeklyReminder(reason)`, called by
  `js/tabs.js` right after "Save my usual week" succeeds AND when the review
  sheet closes — a usual week saved by an earlier build never meets "Save"
  again (behind a `typeof` guard: the function exists only here, so the web
  shows nothing). Offered again while an ask still waits its turn, the give-up
  clock starts over — still one ask. Asked ONCE
  (`psycle_weekly_reminder_asked`, mirrored), only with a usual week saved, the
  switch never touched and iOS not already refusing: "Remind you on Mondays at
  12:00, when new dates open?" — Remind me / Not now. Same manners as the
  first-booking ask: never at launch, only once the UI has been clear for two
  1s polls (the usual-week sheet counts, for both asks), gives up 40s after it
  was last called for, a displaced dialog is not an answer.

**Not verified on a device.** The schedule, copy, tap routing and the offer are
covered by `tests/suites/14c-weekly-reminder.js` and were driven in a desktop
browser against a fake Capacitor and the fake Psycle server. Still to check on
an iPhone: the banner arrives at 12:00:00 London (not a minute early, not late
under Low Power Mode / Focus); a tap from a COLD start opens the review sheet
once and only once; after updating from a build that armed 11:59 reminders
there is ONE banner on the next Monday, at 12:00.

`PsycleIntents/NotificationCategories.swift` is a **native reference only** for
if you ever drop the Capacitor plugin and schedule notifications in Swift. Do
**not** register the same `PSYCLE_CLASS` category from both Capacitor and native
code — pick one path.

---

## 7. Build, run, verify

1. `cd ios-app && npm run sync` (copies `www/` into the app, incl. the updated
   `native-bridge.js`).
2. Build & run the **App** scheme on a device or simulator. Log in, load
   bookings — `native-bridge.js` writes the snapshot (look for no errors; you
   can confirm via `getDiagnosticReport()` localStorage summary, though the
   widget keys live in Preferences, not localStorage).
3. Long-press the Home Screen ▸ **+** ▸ search **"Psync"**, then choose **Next class** ▸ add the
   small or medium widget. It should show your next class + a live countdown,
   or "No upcoming class".
4. Within ~2h of a class, the Live Activity appears on the Lock Screen /
   Dynamic Island once `refreshFromSnapshot()` is called (step 4.3).
5. Siri: *"What's my next class in Psync."*

### Troubleshooting

- **Widget shows nothing / placeholder forever** → App Group mismatch. Verify
  the same group id is ticked on **both** app and widget targets, and that you
  took **Option A** (or have an App Group Preferences plugin for Option B).
- **`UserDefaults(suiteName:)` returns nil in `PsycleSnapshotStore.defaults`**
  → the App Group capability isn't enabled on the reading target, or the id is
  wrong.
- **Two `@main` errors in the extension** → delete Xcode's generated widget
  file; keep only `PsycleWidget.swift`'s bundle.
- **Live Activity never appears** → missing `NSSupportsLiveActivities` in the
  app Info.plist, or `refreshFromSnapshot()` is never called, or the class is
  outside the 90-minute lead window.
- **Stale widget** → the app nudges `WidgetCenter.reloadAllTimelines()` only if
  a reload plugin is present; otherwise the timeline refreshes on its own
  policy (~30 min, or just after the current class starts).

---

## Device checklist — Crisp Colour widgets (2026-09-19)

An unsigned simulator build cannot run a widget or a Live Activity, so none of
this has been SEEN on a phone. `native-checks/render.sh` shows the layouts; it
is not WidgetKit. On a signed build, with at least one class booked:

1. **Home Screen, small + medium** — the tinted card, the time in 24-hour digits
   ("18:30"), the day beside / above it, tile + class name, "Instructor ·
   Studio", the seat chip in the class colour, the countdown. Nothing clipped or
   ending in "…" on YOUR phone size (a small phone drops the countdown first,
   never the place or the seat). A long class name ("REFORMER PILATES: SCULPT
   50") is WHOLE: two or three lines, with a smaller time on the small widget —
   or, only where even that cannot fit (small widget, 4.7-inch phone or larger
   text), its head "REFORMER PILATES". With two seats on a 4.7-inch phone the
   medium card drops "12 this week" rather than squeeze "Beds 12 & 14".
2. **Settings → General → Date & Time → 24-Hour Time OFF**, then look again:
   the widgets must still SHOW your class (this setting used to make the
   snapshot's times unreadable — every widget "No upcoming class", no Live
   Activity, Siri "no classes") and every time must still read "18:30"
   (widgets, Lock Screen, Live Activity, and ask Siri "what's my next class").
   The Mac checks now reproduce this setting and pass; the phone is the proof.
   If you ever use a non-Gregorian calendar (Settings → General → Language &
   Region → Calendar → Buddhist), the same must hold.
3. **Dark appearance** — the card goes to the dark tint, copy stays readable.
4. **Membership → Appearance → Class colours**: change Ride's colour, then
   switch Off / Soft / Bold. Within a second or two of returning to the Home
   Screen the widget follows (Off = neutral card, colour only in the tile and
   the chip). Do it while a Live Activity is up: the card changes too.
5. **Tinted Home Screen** (iOS 18: long-press → Edit → Customise → Tinted) and
   **StandBy** (charging, on its side; also its red night mode): the pictogram
   is still a mark inside a faint tile and the seat chip still has a readable
   label — nothing has turned into a solid blob; text is light on the dark
   ground.
6. **Lock Screen rectangle** — pictogram + class, "Thu 18:30 · Bike 12", the
   place; no line cut off (long names lose the pictogram before they lose
   letters). **Lock Screen inline** (above the clock): "18:30 · RIDE: 45" with
   the small pictogram before it — if the pictogram is missing or is a filled
   square, say so: that family only takes an image, and this is the one place
   the mark is handed over as one.
7. **Live Activity** (open the app within 90 minutes of a class): Lock Screen
   card — start time, the live countdown under it, tile, class, "Instructor ·
   Studio", seat chip, on the class tint. Dynamic Island: compact (tile left,
   countdown right), minimal (tile), expanded (tile, class, 18:30 + countdown,
   instructor · studio, seat chip). Add or cancel a seat while it is up: the
   chip follows. At class start it reads "In class"; about five minutes later it
   goes by itself, phone untouched (if it is still there after ten, note whether a
   Psync widget is on the Home or Lock Screen and whether Background App Refresh is on).
7a. **Support Psync (the optional tips)** — needs the three products in App Store Connect and a sandbox tester
   (`APP_STORE_LISTING.md` → "In-app purchases"). Before the products exist, Membership shows NO such section.
   With them: three rows, cheapest first, with the App Store's own prices; a tap opens Apple's payment sheet
   ("[Environment: Sandbox]") and the rows grey out; paying says "Thank you. Your tip went through."; closing the
   sheet says nothing; the same tip can be given again. With Ask to Buy on the sandbox account: "Thank you. Your
   tip is waiting for approval."
8. **Live Activity, light ↔ dark while it is up** — with the card on the Lock
   Screen, toggle Dark / Light from Control Centre twice. The text must stay
   readable after EACH flip (ground and ink change together). Pale text on a
   pale card — or dark on dark — until the next flip is the failure this step
   is for: the card now paints its own ground instead of trusting the
   platter's tint, which lags an appearance change.
9. **At class start** (Home Screen small / medium): the line under the time
   counts down — "in 2 min", "in 40 sec" — and at 18:30 turns to "Now". It must
   never read "in 5 sec", "in 40 sec" … counting UP. A minute later the widget
   moves on to your next class.
10. **Upgrade path** — with a Live Activity from the PREVIOUS build on screen,
    install this build over it and open the app: the old card must still be
    there and drawn (default colours), not vanish.
11. **Tap** any widget: My Bookings, then that class's sheet (unchanged).
12. **Widget gallery** — the placeholder ("Ride", Shoreditch, Bike 12) draws.

---

## Summary of what's done vs. what you must do

| Done (verifiable) | You do in Xcode |
|---|---|
| JS snapshot writer + event hooks (`native-bridge.js`, `node --check` clean) | Create App Group, tick on all targets |
| JS notification actions + tap routing | Create Widget Extension target |
| All Swift sources (widget, Live Activity, intent, helpers) | Add files to target membership |
| App Group reader with namespaced fallback | Add Live Activity to bundle + `NSSupportsLiveActivities` |
| Siri phrases + read-only intent | (Optional) Option A: point Preferences group at App Group |
```
