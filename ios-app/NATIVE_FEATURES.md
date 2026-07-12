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
> start is three-layered: staleDate flips the card to "In class" at T0
> with no process running; a BGAppRefreshTask (com.psyclefinder.app.la-end,
> registered in AppDelegate) ends it shortly after start; any app
> foreground past start ends it immediately. The widget self-advances via
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
(foreground), and ~4s after launch. It writes two keys:

| Key | Shape | Notes |
|-----|-------|-------|
| `widget_next_class` | `{eventId, startAt, instrName, typeName, studioName, locName, slots}` **or** the literal `null` | `startAt` is an ISO-8601 string; `slots` is `[Int]` |
| `widget_week` | `[{day, count, firstStart}]` | `day` = local `"YYYY-MM-DD"`; `firstStart` ISO string; one entry per booked day in the next 7 days |

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
   *"What's my next class in Psycle Finder"* or open the **Shortcuts** app and
   search "Next class". (Spoken app name = the display name "Psycle Finder".)

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
  - **Book / Cancel / tap** call `window.handleNotificationIntent(action,
    eventId, data)` if the web app defines it; otherwise the intent is stashed
    in `sessionStorage` under `psycle_pending_notification_action` for the web
    app to pick up.

To actually surface the buttons, schedule notifications with
`actionTypeId: 'PSYCLE_CLASS'` and `extra: { eventId }`. (The existing weekly
reminder doesn't use a category; add `actionTypeId` to any per-class reminders
you schedule.) **Follow-up (web side):** implement
`window.handleNotificationIntent(action, eventId)` in the web app to open the
class / start a cancel from a notification tap.

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
3. Long-press the Home Screen ▸ **+** ▸ search **"Next Psycle Class"** ▸ add the
   small or medium widget. It should show your next class + a live countdown,
   or "No upcoming class".
4. Within ~2h of a class, the Live Activity appears on the Lock Screen /
   Dynamic Island once `refreshFromSnapshot()` is called (step 4.3).
5. Siri: *"What's my next class in Psycle Finder."*

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

## Summary of what's done vs. what you must do

| Done (verifiable) | You do in Xcode |
|---|---|
| JS snapshot writer + event hooks (`native-bridge.js`, `node --check` clean) | Create App Group, tick on all targets |
| JS notification actions + tap routing | Create Widget Extension target |
| All Swift sources (widget, Live Activity, intent, helpers) | Add files to target membership |
| App Group reader with namespaced fallback | Add Live Activity to bundle + `NSSupportsLiveActivities` |
| Siri phrases + read-only intent | (Optional) Option A: point Preferences group at App Group |
```
