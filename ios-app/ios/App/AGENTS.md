# ios-app/ios/App/ — read before editing here
The committed Xcode project and all the Swift: the Capacitor app, the widget extension, the Live Activity, the Siri intent. The repo-wide rules are in the root [AGENTS.md](../../../AGENTS.md) — this file adds only what is local; the folder above has its own [AGENTS.md](../../AGENTS.md).

## Rules that bite here
The rule → why → what guards it. Suites are in tests/suites/; G… are entries in agents/learnings.md; P7 is in agents/playbooks.md.
1. **Root rule 5 applies to every edit here** (the App-scheme simulator build; recipe: P7 step 3) — rebuild after the LAST edit.
2. **That build proves "it compiles", no more** (no entitlements, G7): the App Group read, a Live Activity starting or updating, notification timing and taps, the phone's 24-Hour Time switch, StandBy / tinted rendering need a device → write "compiled, not yet seen on a device" and add a line to the checklists (P7 step 7).
3. **Target membership is scripted: wire_native_targets.rb** (idempotent for references and targets; needs the `xcodeproj` gem) — never hand-edit project.pbxproj for it: name a new Swift file in the script, then run it. A file no target compiles passes every Node check and fails only in an Xcode build → rule 1's build catches it before Xcode Cloud does. Guard: 11-native-snapshot.js, for PsycleShared/ and PsycleWidget/ only, and only that the project REFERENCES the file; App/, PsycleLiveActivity/ and PsycleIntents/ have none.
4. **New `Codable` fields are OPTIONAL, with a fallback**: older snapshots sit in the App Group and the previous build's Live Activity is still running, so a required field fails the decode and the card vanishes (G2). Guard: native-checks/run.sh, 11-native-snapshot.js, ios-polish.js ("R2-31"). A Live Activity value goes in `ContentState`, never the attributes: P7 step 6. A value already in the snapshot needs Swift only (no bridge edit, no `cd ios-app && npm run build`); a NEW per-class field is written in `_snapshotEventFor` (native-bridge.js), and 11-native-snapshot.js pins the entry's EXACT key set ("…and nothing else is added") → extend that list in the same commit, then build. In native-checks/decode/main.swift a SNAPSHOT field is proved with a JSON literal of today's shape (the `old` / `new` fixtures); the `…PreviousBuild` structs are for Live Activity payloads only.
5. **Dates: a FIXED pattern under `en_US_POSIX`, through `PsycleFixedFormat` only** (`PsycleClock` prints, `PsycleDateParser` reads); build no other `DateFormatter`. On a UK phone with 24-Hour Time off `…T18:30:00` parsed to nil and every widget was empty (G1). Guard: run.sh, 11-native-snapshot.js.
6. **That formatter's zone is the DEVICE's (`.autoupdatingCurrent`), on purpose**: the widget / Live Activity snapshot and the T-90 reminders are device-local by the owner's CLOSED decision (agents/decisions.md section 4) — do not "fix". Guard: 11-native-snapshot.js, the only one.
7. **Extensions read `UserDefaults(suiteName: "group.com.psyclefinder.app")`** (`PsycleAppGroup.id` = `WIDGET_APP_GROUP` in native-bridge.js), written by the in-app `AppGroupPreferencesPlugin`. The standard Preferences plugin cannot reach it: its `group` is a key prefix in `UserDefaults.standard`. An in-app plugin is not auto-discovered: register it in `MainViewController`.
8. **UIScene life cycle**: `SceneDelegate` is at the bottom of App/AppDelegate.swift. UIKit no longer calls `applicationDidBecomeActive`, `applicationDidEnterBackground` or `application(_:open:)` → new life-cycle work goes in the shared `appDidBecomeActive()` / `appDidEnterBackground()`. No suite: a miss archives green and crashes on the phone (G3).
9. **The deployment floor is in two places**: `MIN_IOS_DEPLOYMENT_TARGET` (the Podfile's `post_install` lifts every pod to it) and the project's `IPHONEOS_DEPLOYMENT_TARGET` (app 15.0, widget 16.1) → change them together. GitHub's unsigned build does not catch it; the Xcode Cloud check does (G4). wire_native_targets.rb re-stamps the extension's build settings on every run (`IPHONEOS_DEPLOYMENT_TARGET` 16.1, `MARKETING_VERSION`, `CURRENT_PROJECT_VERSION`): change the widget floor or a version THERE too, or the next run reverts it.
10. **`psync://` (every widget's `widgetURL`) is deliberately NOT registered in Info.plist**: WidgetKit hands it straight to the app, and unregistered no other app can open it → add no `CFBundleURLTypes`. `PsycleDeepLinkPlugin` forwards it; the bridge parses it (`pure:widget-link`, widget-link.js).
11. **Widget layouts** (PsycleWidget/PsycleWidgetLayouts.swift): `PsycleClassFacts.whoWhere` ("Instructor · Place", from the required `instrName`) is already on small, medium and `PsycleActivityCard`; the two Lock Screen accessories (`PsycleRectangularAccessory`, `PsycleInlineAccessory`) take plain values of their own and print no instructor → check the payload table in agents/architecture/ios.md before adding a field. Every layout struct is ALSO constructed memberwise in ios-app/native-checks/render/main.swift: default a new stored property, or change every call site, or render.sh stops compiling. A `ViewThatFits` cannot see inside a nested one (`PsycleFittedLine`): use one flat ladder. `// ── accessory-views:start` … `:end` marks the views that take plain values only; no suite or script slices it (root rule 7 does not apply).

## What is in here
Two targets: `PsycleBookingBuddy` (the app; scheme `App`) and `PsycleWidgetExtension`. Types and lines: agents/index/swift.md.
| Path | Compiled into | Holds |
|---|---|---|
| App/ | app | AppDelegate.swift (+ `SceneDelegate`), MainViewController.swift, AppGroupPreferences.swift (the four in-app plugins), Info.plist, App.entitlements, Assets.xcassets (GENERATED by assets/render-icons.sh) |
| PsycleShared/ | both | PsycleSnapshot.swift (`PsycleAppGroup`, `PsycleNextClass`, `PsycleDateParser`, `PsycleTimelinePlan`, `PsycleSnapshotStore`) · PsycleClassType.swift (`PsycleFixedFormat`, `PsycleClock`, `PsycleClassStyle`, Swift COPIES of web values — change with the original: 11-native-snapshot.js) |
| PsycleWidget/ | extension | the widget, PsycleWidgetLayouts.swift (`PsycleClassFacts`, `PsycleActivityCard`), PsycleWidgetStyle.swift, PsyclePictogram.swift |
| PsycleLiveActivity/ | Attributes: both · Controller: app · View: extension | the payload, `refreshFromSnapshot()`, the Dynamic Island |
| PsycleIntents/ | app | NextClassIntent.swift, AppShortcuts.swift; NotificationCategories.swift is in NO target, by design |
| PsycleWidgetExtension/ | — | the extension's Info.plist, entitlements, PrivacyInfo.xcprivacy; no Swift |
| PsycleBookingBuddy.xcodeproj | — | the real project; App.xcodeproj is a symlink to it (the Capacitor CLI hardcodes that name). Open App.xcworkspace |
| Podfile · Podfile.lock | — | the plugin block is regenerated by `cap sync`: commit both after a plugin change (G8) |
| ci_scripts/ci_post_clone.sh | — | Xcode Cloud's hook: stays executable, never installs Node unconditionally (G8) |
| App/public/ · App/capacitor.config.json · App/config.xml · Pods/ | — | git-ignored; written by `npm run sync` in ios-app/ |

## After you edit
From the repository root, on a Mac, in this order:
```bash
sh ios-app/native-checks/run.sh            # the shipped model files: old payloads decode; 18:30 printed AND read back under the 12-hour override, ar_SA, th_TH
sh ios-app/native-checks/render.sh <dir>   # after a layout edit: look at the PNGs, light and dark
npm test                                   # Swift is read as text by 11-native-snapshot.js, ios-polish.js and widget-link.js; the asset catalogue by 12-brand-mark.js; the launch storyboard by 4f-cleanup-pwa.js
npm run agents:index                       # Swift lines moved → agents/index/swift.md
```
render.sh draws the Lock Screen accessories ONCE, in `recoloured.png` at 160 × 66 (real widths: 148–172 pt): add a narrow case before trusting a fit. widget-link.js pins App/AppGroupPreferences.swift, App/MainViewController.swift and PsycleWidget/PsycleWidget.swift (the families, a `case` per accessory, `widgetURL`).
Then rule 1's build, and the docs that state a payload's shape or a card's line order: the payload table in agents/architecture/ios.md, ios-app/NATIVE_FEATURES.md ("0. The data contract", the device checklist), the struct's doc comment; what a device must still prove: P7 step 7. How a stretch of work ends: P0 step 6.

## Read next
- [agents/playbooks.md](../../../agents/playbooks.md) — P7, all of it; P10 after a push to `main`.
- [agents/architecture/ios.md](../../../agents/architecture/ios.md) — "Live Activity: where the pieces are", "Snapshot time contract".
- [agents/learnings.md](../../../agents/learnings.md) — section G; B5 for the Swift copies of web values.
- [agents/decisions.md](../../../agents/decisions.md) — section 4.
- [../../NATIVE_FEATURES.md](../../NATIVE_FEATURES.md) (status block, "Device checklist") · [../../CICD.md](../../CICD.md) ("Notes / gotchas").
