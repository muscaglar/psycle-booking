# Upgrading the iOS wrapper: Capacitor 6 → 8

A runbook for one sitting on the Mac that builds the app. Nothing here has been run yet: it was written
by reading the official guides, the published source of every package at the exact version named, and this
repo. Each claim says where it comes from; anything that could not be confirmed from a primary source is
marked **UNVERIFIED** and collected again in [section 9](#9-unverified--confirm-as-you-go).

Researched 19 September 2026 against base commit `2b17154`. Budget: about 30 minutes to the simulator
build, then the device pass.

**Run it on the Mac whose npm talks to `registry.npmjs.org`.** `package-lock.json` must keep resolving from
the public registry, because Xcode Cloud runs `npm ci` against it (`ci_scripts/ci_post_clone.sh`). A lockfile
written through any other registry breaks every archive.

---

## 1. What changes, in one screen

| | Now | After |
|---|---|---|
| `@capacitor/core` · `cli` · `ios` | 6.2.1 | **8.5.2** (published 11 Sep 2026) |
| `@capacitor/browser` | 6.0.6 | 8.0.4 |
| `@capacitor/haptics` | 6.0.3 | 8.0.2 |
| `@capacitor/local-notifications` | 6.1.3 | 8.3.1 |
| `@capacitor/preferences` | 6.0.4 | 8.0.1 |
| `@capacitor/share` | 6.0.4 | 8.0.2 |
| `@capacitor/status-bar` | 6.0.3 | 8.0.3 |
| `@ebarooni/capacitor-calendar` | 6.7.2 (patched) | **8.6.0** (patched, new anchors) |

"Now" is `ios-app/package-lock.json`; "After" is each package's `latest` dist-tag on the public registry on
the research date. 8.5 is the floor, not a preference: UIScene support landed in **8.5.0**, and **8.5.2** fixes
scene events reaching a page that has not loaded yet (Capacitor `CHANGELOG.md`).

Work the upgrade needs in this repo:

1. **`patch-plugins.js`** — the calendar plugin was restructured, so the `timeZone` patch needs new files and
   anchors (given in full below, and proved to apply). The `@capacitor/ios` `presentVC` patch is **deleted**.
2. **`AppDelegate.swift`** — `SceneDelegate` hands URLs and activities to Capacitor's `SceneDelegateProxy`
   instead of forwarding them by hand. Its two life-cycle calls stay.
3. **`native-bridge.js`** — three calendar call shapes changed between plugin 6 and 8. **This is the part that
   bites silently**: left alone, calendar sync simply stops (the event listing is rejected and the reconcile
   backs off); fix only that one and new events lose their ownership marker and their alerts. One suite pins
   the old shape and changes with it.
4. **Toolchain** — Node 22+ everywhere the Capacitor CLI runs; the GitHub iOS job needs an Xcode 26 runner.

Nothing else moves: not the Xcode project, `Info.plist`, the Podfile, the deployment targets, the four in-app
plugins, `MainViewController`, `capacitor.config.json`, the widget, the Live Activity or the intents.
[Section 6](#6-what-does-not-change-and-why) says why for each.

---

## 2. Prerequisites

| Need | Required | Source | Check |
|---|---|---|---|
| Node | **22 or newer** | v8 guide; `@capacitor/cli` 8.5.2 `engines.node >=22.0.0`, enforced — `bin/capacitor` exits with "The Capacitor CLI requires NodeJS >=22.0.0" | `node --version` **inside `ios-app/`** |
| Xcode | **26.0 or newer** to build Capacitor 8; **Xcode 27** to reproduce what Xcode Cloud archives with | v8 guide ("Capacitor 8 requires Xcode 26.0+"); `ios-app/CICD.md` | `xcodebuild -version` |
| CocoaPods | any recent (the lockfile was written by 1.16.2) | `Podfile.lock` | `pod --version` |
| npm registry | `https://registry.npmjs.org/` | `ci_post_clone.sh` | `npm config get registry` |
| Working tree | clean, on a branch | `main` ships to TestFlight | `git status --short` |

**The Node trap in this repo:** `ios-app/.tool-versions` is committed and pins `nodejs 20.19.5`. With asdf
that is the Node you get inside `ios-app/`, and the Capacitor 8 CLI refuses to start on it. Step 1 moves it.

### What CI provides

| Runner | Node | Xcode | Verdict |
|---|---|---|---|
| GitHub `ci` job (`ubuntu-latest`) | 20 (`node-version: 20`) | — | Still passes: it runs `npm ci` and `patch:check` in `ios-app/`, never the Capacitor CLI. npm only warns about the engine. Move it to 22 anyway (step 7). |
| GitHub `ios-build` job (`macos-15`) | 22 | **default 16.4** — 26.0.1, 26.1.1, 26.2 and 26.3 are installed but not selected (runner image `20260907`) | **Below Capacitor 8's floor.** Change the runner or select an Xcode 26 (step 7). |
| GitHub `macos-26` image | 24.20.0 | default 26.6 | Fine for Capacitor 8. Still not Xcode 27 — a green run here never proved the TestFlight build (`CICD.md`). |
| Xcode Cloud ("Latest Release") | **UNVERIFIED** — the script uses whatever Node the image ships, else `brew install node` | 27 (`CICD.md`) | Read the `node --version` line near the top of the latest Xcode Cloud log **before you start**. Below 22 → add the guard in step 7. |

---

## 3. Do not use `npx cap migrate` here

The official route is two hops (`@capacitor/cli@latest-7` + `npx cap migrate`, then `@latest` + `npx cap
migrate`). In this repo the manual route below is shorter and safer — all from `cli/src/tasks/migrate.ts` and
`migrate-uiscene.ts` at tag `8.5.2`:

- The v8 migrator stops at once on Capacitor 6: "Migrate can only be used on Capacitor 7, please use the CLI
  in Capacitor 7 to upgrade to 7 first."
- Each hop rewrites `package.json` and runs `npm install`, which fires this repo's `postinstall` —
  `patch-plugins.js`, still pinned to 6.x — so the install fails loud and the migration reports itself
  incomplete. It does not know
  `@ebarooni/capacitor-calendar` at all and leaves it on 6.7.2, whose peer range is `@capacitor/core ^6.0.0`.
- Its UIScene step looks for three things: the scene manifest, a file named `App/App/SceneDelegate.swift`, and
  `UISceneConfiguration(name:` in the AppDelegate. This repo has two of the three (our `SceneDelegate` lives
  inside `AppDelegate.swift`), so it classifies the project as **partial** and skips with a warning. It would not
  damage anything; it would not help either.
- The iOS steps it would apply are already done: deployment target 15.0, Podfile platform at least 15.0. (It
  reads the *first* `IPHONEOS_DEPLOYMENT_TARGET` in the project — the widget's 16.1 — and skips that step too.)

The guides only describe stepping 6 → 7 → 8. Going straight to 8 by hand is this document's judgement, and it
rests on what 7 actually broke, none of which this app uses: the `bundledWebRuntime` and
`cordova.staticPlugins` config keys, a handful of deprecated TypeScript type names (the bridge imports no
types — it reads `Capacitor.Plugins.*`), and `Device.getInfo()` disk fields.

---

## 4. The steps, in order

### Step 1 — branch, and Node 22

```bash
git switch -c chore/capacitor-8
cd ios-app
asdf install nodejs 22.23.2 && asdf local nodejs 22.23.2   # any 22.x / 24.x LTS; rewrites ios-app/.tool-versions
                                                           # (asdf 0.16+: `asdf set nodejs 22.23.2`)
node --version                                             # must print v22 or newer, from inside ios-app/
npm config get registry                                    # must print https://registry.npmjs.org/
```

(22.23.2 is simply a version known to exist — it is what GitHub's `macos-15` image ships.)

### Step 2 — `ios-app/patch-plugins.js`, before installing anything

The patcher runs on `postinstall` and fails loud on a version it was not written for, so it changes first. Two
edits to the `PATCHES` array.

**2a. Delete the whole `@capacitor/ios` entry** — the second object, from its `// Scene life cycle …` comment
to its closing `},`. Step 4 proves it is no longer needed.

**2b. Replace the whole `@ebarooni/capacitor-calendar` entry with this.** Upstream 8.6.0 still has no way to
set an event's time zone at creation — it only *reads* `event.timeZone` back into listed events, as
`timezone` — so the patch stays. The files it touched no longer exist: `EventCreationParameters.swift` is gone,
the inputs live under `Models/Inputs/` and the implementation under `Implementation/`.

```js
  {
    // Add an optional `timeZone` (IANA identifier) to createEvent /
    // createEventWithPrompt so EKEvents carry an explicit zone instead of
    // the device's current one. Only iOS is patched (this wrapper is iOS-only).
    // Upstream 8.x reads event.timeZone back (as `timezone`) but still has no
    // create-time input for it.
    pkg: '@ebarooni/capacitor-calendar',
    version: '8.6.0',
    files: {
      // 1) Carry the new parameter through the shared input struct.
      'ios/Plugin/Models/Inputs/CreateEventWithPromptInput.swift': [
        {
          find:
            '    private let title: String\n' +
            '    private var url: String?\n' +
            '\n' +
            '    init(call: CAPPluginCall) {',
          replace:
            '    private let title: String\n' +
            '    private var url: String?\n' +
            '    private var timeZone: String? // IANA id, e.g. "Europe/London" (nil = device zone)\n' +
            '\n' +
            '    init(call: CAPPluginCall) {',
        },
        {
          find:
            '        if let url = call.getString("url") {\n' +
            '            self.url = url\n' +
            '        }\n' +
            '    }\n',
          replace:
            '        if let url = call.getString("url") {\n' +
            '            self.url = url\n' +
            '        }\n' +
            '        if let timeZone = call.getString("timeZone") {\n' +
            '            self.timeZone = timeZone\n' +
            '        }\n' +
            '    }\n',
        },
        {
          find:
            '    func getUrl() -> URL? {\n' +
            '        guard let url = url else { return nil }\n' +
            '        return URL(string: url)\n' +
            '    }\n',
          replace:
            '    func getUrl() -> URL? {\n' +
            '        guard let url = url else { return nil }\n' +
            '        return URL(string: url)\n' +
            '    }\n' +
            '\n' +
            '    func getTimeZone() -> TimeZone? {\n' +
            '        guard let timeZone = timeZone else { return nil }\n' +
            '        return TimeZone(identifier: timeZone)\n' +
            '    }\n',
        },
      ],
      // 2) createEvent wraps that struct — pass the getter through.
      'ios/Plugin/Models/Inputs/CreateEventInput.swift': [
        {
          find:
            '    func getUrl() -> URL? {\n' +
            '        return input.getUrl()\n' +
            '    }\n',
          replace:
            '    func getUrl() -> URL? {\n' +
            '        return input.getUrl()\n' +
            '    }\n' +
            '\n' +
            '    func getTimeZone() -> TimeZone? {\n' +
            '        return input.getTimeZone()\n' +
            '    }\n',
        },
      ],
      // 3) Stamp the EKEvent with the zone before it is saved / edited.
      'ios/Plugin/Implementation/CapacitorCalendar.swift': [
        {
          // createEventWithPrompt
          find:
            '        if let availability = input.getAvailability() {\n' +
            '            event.availability = availability\n' +
            '        }\n' +
            '        guard let viewController = plugin.bridge?.viewController else {\n' +
            '            throw PluginError.viewControllerMissing\n' +
            '        }\n' +
            '\n' +
            '        return try await withCheckedThrowingContinuation { continuation in\n' +
            '            Task { @MainActor in\n' +
            '                let eventEditViewController = EKEventEditViewController()\n' +
            '                eventEditViewController.event = event\n' +
            '                eventEditViewController.eventStore = eventStore\n' +
            '                eventEditViewController.editViewDelegate = self\n' +
            '                viewController.present(eventEditViewController, animated: true) {\n' +
            '                    self.createEventWithPromptContinuation = continuation',
          replace:
            '        if let availability = input.getAvailability() {\n' +
            '            event.availability = availability\n' +
            '        }\n' +
            '        if let timeZone = input.getTimeZone() {\n' +
            '            event.timeZone = timeZone\n' +
            '        }\n' +
            '        guard let viewController = plugin.bridge?.viewController else {\n' +
            '            throw PluginError.viewControllerMissing\n' +
            '        }\n' +
            '\n' +
            '        return try await withCheckedThrowingContinuation { continuation in\n' +
            '            Task { @MainActor in\n' +
            '                let eventEditViewController = EKEventEditViewController()\n' +
            '                eventEditViewController.event = event\n' +
            '                eventEditViewController.eventStore = eventStore\n' +
            '                eventEditViewController.editViewDelegate = self\n' +
            '                viewController.present(eventEditViewController, animated: true) {\n' +
            '                    self.createEventWithPromptContinuation = continuation',
        },
        {
          // createEvent
          find:
            '        if let availability = input.getAvailability() {\n' +
            '            event.availability = availability\n' +
            '        }\n' +
            '        try eventStore.save(event, span: .thisEvent, commit: input.getCommit())\n' +
            '        return try CreateEventResult(id: event.eventIdentifier)',
          replace:
            '        if let availability = input.getAvailability() {\n' +
            '            event.availability = availability\n' +
            '        }\n' +
            '        if let timeZone = input.getTimeZone() {\n' +
            '            event.timeZone = timeZone\n' +
            '        }\n' +
            '        try eventStore.save(event, span: .thisEvent, commit: input.getCommit())\n' +
            '        return try CreateEventResult(id: event.eventIdentifier)',
        },
      ],
    },
  },
```

How far this is proved: `planFile` was copied out of `patch-plugins.js` and run over the three files from the
plugin's GitHub tag `v8.6.0`. All six edits found their anchor exactly once, a second pass reported all six
"already applied", and the output was identical (the same holds on upstream `main`, 8.7.0, not yet published).
**Not proved:** that the npm tarball matches the tag byte for byte, and that the patched Swift compiles. Step 3's
`postinstall` settles the first and step 8's build the second.

If an edit fails with "anchor not found", open the named file under
`node_modules/@ebarooni/capacitor-calendar/` and look for these landmarks — each edit needs one:

| File | Landmark |
|---|---|
| `Models/Inputs/CreateEventWithPromptInput.swift` | the stored properties ending `private var url: String?`; the end of `init(call:)`, which reads `call.getString("url")`; `func getUrl() -> URL?` |
| `Models/Inputs/CreateEventInput.swift` | `func getUrl() -> URL?` returning `input.getUrl()` |
| `Implementation/CapacitorCalendar.swift` | in `createEvent(input:)`, the `availability` block just above `try eventStore.save(`; in `createEventWithPrompt(with:)`, the same block just above `guard let viewController` |

**When to drop the patch instead:** if a later version adds a create-time input, this prints a hit *before*
patching —

```bash
grep -n -i "timezone" node_modules/@ebarooni/capacitor-calendar/ios/Plugin/Models/Inputs/CreateEventWithPromptInput.swift
```

— at 8.6.0 it prints nothing. If it ever does, check how upstream spells the key (listed events already use
lower-case `timezone`), send that key from `_buildCalEventData`, and delete the entry.

Then tidy the header comment: "(@ebarooni/capacitor-calendar v6, and even upstream v8)" still holds; the
paragraph that starts "A second patch (see PATCHES) makes Capacitor 6's temporary presentation window
scene-aware" goes.

### Step 3 — `ios-app/package.json`, then install

Before:

```json
  "dependencies": {
    "@capacitor/browser": "^6.0.0",
    "@capacitor/core": "^6.0.0",
    "@capacitor/haptics": "^6.0.0",
    "@capacitor/ios": "^6.0.0",
    "@capacitor/local-notifications": "^6.0.0",
    "@capacitor/preferences": "^6.0.0",
    "@capacitor/share": "^6.0.0",
    "@capacitor/status-bar": "^6.0.0",
    "@ebarooni/capacitor-calendar": "6.7.2"
  },
  "devDependencies": {
    "@capacitor/cli": "^6.0.0"
  }
```

After:

```json
  "dependencies": {
    "@capacitor/browser": "^8.0.4",
    "@capacitor/core": "^8.5.2",
    "@capacitor/haptics": "^8.0.2",
    "@capacitor/ios": "^8.5.2",
    "@capacitor/local-notifications": "^8.3.1",
    "@capacitor/preferences": "^8.0.1",
    "@capacitor/share": "^8.0.2",
    "@capacitor/status-bar": "^8.0.3",
    "@ebarooni/capacitor-calendar": "8.6.0"
  },
  "devDependencies": {
    "@capacitor/cli": "^8.5.2"
  }
```

`core`, `ios` and `cli` take `^8.5.2` on purpose: a plain `^8.0.0` would also admit 8.0–8.4, which have no scene
support. The calendar plugin stays an exact pin because the patch is written against one version. Change them
all in the one edit — 6.7.2 of the calendar plugin peers on `@capacitor/core ^6.0.0`, so moving core alone ends
in `ERESOLVE`.

```bash
cd ios-app
npm install
```

Expect the patcher's lines at the end:

```
  patched @ebarooni/capacitor-calendar/ios/Plugin/Models/Inputs/CreateEventWithPromptInput.swift (3 edits)
  patched @ebarooni/capacitor-calendar/ios/Plugin/Models/Inputs/CreateEventInput.swift (1 edit)
  patched @ebarooni/capacitor-calendar/ios/Plugin/Implementation/CapacitorCalendar.swift (2 edits)
✓ @ebarooni/capacitor-calendar@8.6.0
[patch-plugins] OK — applied 6, already present 0.
```

Then check the lockfile before going on:

```bash
grep '"resolved"' package-lock.json | grep -v 'https://registry.npmjs.org/'   # must print NOTHING
npm run patch:check                                                            # OK — all edits applied (6)
rm -rf node_modules && npm ci                                                  # what Xcode Cloud will do
```

### Step 4 — confirm the `presentVC` patch really is unnecessary

The 6.x patch existed because Capacitor presented full-screen view controllers in a temporary `UIWindow` that
belonged to no scene. That window is gone — "**ios:** remove tmpWindow usages on presentVC/dismissVC" in
**8.2.0**, and 8.5 removed `TmpViewController` and the `tmpWindow` property altogether (8.5 guide). Browser
**8.0.2** also stopped calling `presentVC` ("stop using deprecated dismissVC/presentVC"). See it in what was
installed:

```bash
grep -n "tmpWindow\|TmpViewController" node_modules/@capacitor/ios/Capacitor/Capacitor/CapacitorBridge.swift
#   → no output
grep -n -A 2 "open func presentVC" node_modules/@capacitor/ios/Capacitor/Capacitor/CapacitorBridge.swift
#   → self.viewController?.present(viewControllerToPresent, animated: flag, completion: completion)
grep -n "viewController?.present" node_modules/@capacitor/browser/ios/Sources/BrowserPlugin/BrowserPlugin.swift
#   → one hit: the browser presents from the bridge's own view controller
```

The proof that counts is on the device: an external link opens the in-app browser (section 7).

### Step 5 — `ios-app/ios/App/App/AppDelegate.swift`: use `SceneDelegateProxy`

Only the `SceneDelegate` class at the bottom changes. `AppDelegate` itself stays exactly as it is, including
`application(_:open:)` and `application(_:continue:)` — UIKit no longer calls them under scenes, and the 8.5
guide says to "remove the old methods or leave them". Leaving them keeps the diff small.

Before — forwarding by hand into `ApplicationDelegateProxy`:

```swift
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        forward(connectionOptions.urlContexts)
        if let activity = connectionOptions.userActivities.first {
            forward(activity)
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        forward(URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        forward(userActivity)
    }

    // …sceneDidBecomeActive / sceneDidEnterBackground…

    private func forward(_ contexts: Set<UIOpenURLContext>) { /* builds options, calls ApplicationDelegateProxy */ }
    private func forward(_ activity: NSUserActivity) { /* calls ApplicationDelegateProxy */ }
```

After — the whole class:

```swift
/// Scene life cycle. REQUIRED from the iOS 27 SDK: a UIKit app built with it
/// that has no scene manifest is killed at launch. Capacitor adopted scenes
/// in 8.5; URL opens and user activities go to its SceneDelegateProxy, which
/// keeps `lastURL` and posts the notifications PsycleDeepLinkPlugin and
/// Capacitor listen for.
///
/// Two deliberate differences from Capacitor's template SceneDelegate:
///  - the window and its root view controller still come from Main.storyboard
///    (UISceneStoryboardFile). Its custom class is MainViewController, which
///    registers the four in-app plugins; the template builds a plain
///    CAPBridgeViewController in code instead.
///  - UIKit no longer calls the app delegate's applicationDidBecomeActive /
///    applicationDidEnterBackground, and Capacitor's proxy does not cover
///    them, so they are handed to AppDelegate's shared handlers here.
///
/// Lives in this file on purpose: AppDelegate.swift is already in the app
/// target's Sources phase, so no project surgery is needed.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    /// Set by UIKit from Main.storyboard (UISceneStoryboardFile).
    var window: UIWindow?

    private var appDelegate: AppDelegate? {
        return UIApplication.shared.delegate as? AppDelegate
    }

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        // A cold launch from a widget tap arrives here, before the web view
        // exists. The proxy holds the URL until the bridge's view has
        // appeared, then posts .capacitorOpenURL — which is what
        // PsycleDeepLinkPlugin observes.
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        appDelegate?.appDidBecomeActive()
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        appDelegate?.appDidEnterBackground()
    }
}
```

**Replace the forwarding; do not add the proxy beside it.** Both paths post `.capacitorOpenURL`; with both in
place a widget tap would reach the web layer twice.

What the proxy does differently from our forwarding, and why `PsycleDeepLinkPlugin` needs no edit (all from
`CAPSceneDelegateProxy.swift`, `CAPApplicationDelegateProxy.swift` and `CAPBridgeViewController.swift` at `8.5.2`):

- *Warm open* — identical. `scene(_:openURLContexts:)` sets `lastURL` on both proxies and posts
  `.capacitorOpenURL` with the same `["url": URL, "options": …]` object the plugin's `handleOpenURL` unpacks.
  The 8.5 guide: "Observers of `.capacitorOpenURL` … no change needed. The payload shape is the same."
- *Cold launch* — the timing moves. Today `willConnectTo` forwards at once, so `lastURL` is already set when the
  plugin's `load()` runs, and `load()` forwards it. The proxy instead waits for the first
  `.capacitorViewDidAppear` and only then sets `lastURL` and posts. `load()` runs inside
  `CAPBridgeViewController.loadView()` (that is where `capacitorDidLoad()` is called) — before the view appears —
  so it now finds `lastURL == nil`, and the plugin's **observer** catches the post a moment later. One delivery
  either way, never two: `load()` runs once per process and the proxy removes its own observer after the first
  appearance. The plugin still retains the event until `native-bridge.js` attaches its listener.
- `ApplicationDelegateProxy.shared.lastURL` still exists and is still public to read (`public internal(set)`).
- The proxy continues only `NSUserActivityTypeBrowsingWeb` activities — the same filter
  `ApplicationDelegateProxy` applied. The app declares no universal links.

Cold and warm widget taps are on the device checklist because this reasoning has not been run.

If the storyboard route ever misbehaves, the documented form is to build the window in code at the top of
`willConnectTo` — with **`MainViewController()`**, never the template's `CAPBridgeViewController()`, or the
widget snapshot, Live Activity nudge and deep link silently stop:

```swift
        guard let windowScene = scene as? UIWindowScene else { return }
        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = MainViewController()
        window?.makeKeyAndVisible()
```

Optional, comment only: `PsycleDeepLinkPlugin.load()` in `AppGroupPreferences.swift` says "AppDelegate already
forwards application(_:open:) to Capacitor's proxy" — it is now SceneDelegate, through `SceneDelegateProxy`.
`MainViewController.swift`'s header says "Capacitor 6 removed automatic plugin discovery"; still true of 8.

### Step 6 — `ios-app/www/native-bridge.js`: the calendar plugin's call shapes

From the plugin's `CHANGELOG.md` (7.1.0), its README at `v8.6.0`, and `CreateEventWithPromptInput.swift`,
`ListEventsInRangeInput.swift` and `CreateEventResult.swift` at that tag:

| Call | 6.7.2 (today) | 8.6.0 | If left alone |
|---|---|---|---|
| `createEvent` notes | `notes: "…"` | **`description: "…"`** — `notes` is never read | New events carry no `psycle-event-id:` marker. With the listing fixed but this left, a marker-only reconcile never recognises them and creates them again on every sync; a handed-over calendar deletes and re-creates every class each pass. This is the duplication bug the bridge's own comments describe. |
| `createEvent` alerts | `alertOffsetInMinutes: [60, 15]` — positive = minutes before | **`alerts: [-60, -15]`** — "Use negative numbers for alerts before the start" | New events sync with "Alert: None". |
| `listEventsInRange` | `{ startDate, endDate }` | **`{ from, to }`** — same units, ms since the epoch | The plugin rejects the call (`from` missing). All three callers catch that: the reconcile returns "calendar query failed" and adds or removes nothing, the hand-over dialog loses its count of other events, and a calendar switch sweeps mapped ids only. Safe, but sync has silently stopped. |
| `createEvent` result | `{ result: "<id>" }` | `{ id: "<id>", ics: null }` | Nothing — `_createdEventId` already reads both. |
| `checkAllPermissions` / `requestAllPermissions` | flat map | `{ result: { readCalendar, writeCalendar, … } }` | Nothing — `_ensureCalendarPermission` reads `check.result \|\| check`. |
| `listCalendars` | `{ result: [{ id, title, color, isImmutable, … }] }` | the same four fields | Nothing. |
| `deleteEventsById({ ids })` | `{ result: { deleted, failed } }` | same (plus optional `commit`, `span`) | Nothing. |
| `deleteEvent({ id })` (the fallback) | absent | exists since 7.1.0 | Nothing. |
| listed event fields | `id`, `title`, `calendarId`, `startDate` (ms), `description` | the same, plus `timezone`, `alerts`, … | Nothing — `_markerEventId` reads `ev.notes \|\| ev.description`. |
| `timeZone` on create | our patch | our patch (step 2) | — |

Events already in members' calendars are safe: their marker sits in `EKEvent.notes`, which both versions list
as `description`, so the reconcile finds and keeps them. Only events created *after* the upgrade depend on
these edits.

**6a. `_buildCalEventData`** — the returned object and the comment above it.

Before:

```js
      timeZone: GYM_TZ,
      notes: desc.join('\n'),
      isAllDay: false,
      // Positive = minutes BEFORE the event; the plugin negates it into the
      // EKAlarm and IGNORES negative values (the old [-60, -15] created no
      // alarms at all — events synced with 'Alert: None').
      alertOffsetInMinutes: [60, 15], // 1 hour and 15 minutes before class
```

After:

```js
      timeZone: GYM_TZ,
      description: desc.join('\n'),
      isAllDay: false,
      // Minutes RELATIVE to the start: negative = before. (Plugin v6 took
      // positive `alertOffsetInMinutes` and negated them itself; v8 passes
      // `alerts` straight into EKAlarm(relativeOffset:), so [60, 15] would
      // fire AFTER the class had started.)
      alerts: [-60, -15], // 1 hour and 15 minutes before class
```

The comment above the `return` should now read, in substance: field names match
`@ebarooni/capacitor-calendar` **v8** — `description` (not `notes`) and `alerts` (not `alertOffsetInMinutes`);
unknown names are silently ignored; `timeZone` is honoured by our patched plugin.

**6b. `_listNativeEvents`**

```js
// before
    var q = await Calendar.listEventsInRange({ startDate: startMs, endDate: endMs });
// after
    var q = await Calendar.listEventsInRange({ from: startMs, to: endMs });
```

**6c.** Retitle the `// ── v6-plugin-correct primitives` banner, and the `_createdEventId` /
`_deleteNativeEvents` doc comments that say "v6 returns…" / "v6 has deleteEventsById({ids}) ONLY".

**6d. `tests/suites/calendar-safety.js`** pins the old shape in three places (root `npm test`):

- the fake plugin's `listEventsInRange(q)` filters on `q.startDate` / `q.endDate` → `q.from` / `q.to`;
- the assertion "created events keep the v6 call shape" reads `made.notes` and `made.alertOffsetInMinutes` →
  `made.description` and `made.alerts`, expecting `[-60, -15]`; reword it to v8;
- "the booking is re-created in the new calendar" tests `e.notes` on a *created* event → `e.description`.

The fixtures that stand for events already in a calendar may keep `notes:` — the bridge reads either — but
`description:` is what the plugin returns.

The other plugins need no bridge edit — section 5 lists every call.

### Step 7 — CI

**`.github/workflows/ci.yml`**

```diff
   ci:
       - name: Setup Node
         uses: actions/setup-node@v4
         with:
-          node-version: 20
+          node-version: 22

   ios-build:
-    runs-on: macos-15
+    runs-on: macos-26
```

`macos-15` selects Xcode 16.4 by default, under Capacitor 8's stated floor. `macos-26` defaults to Xcode 26.6
(runner-images README, image `20260907`). Whether 8.5.2 truly fails to compile on 16.4 is **UNVERIFIED** — the
guide's requirement is the only evidence. If `macos-26` is not available to this repo (**UNVERIFIED**), stay on
`macos-15` and add a step ahead of the compile: `sudo xcode-select -s /Applications/Xcode_26.3.app`.

**`ios-app/ios/App/ci_scripts/ci_post_clone.sh`** — only if the Xcode Cloud log showed Node below 22. Put this
after the existing node block, before `node --version` (**UNVERIFIED** on Xcode Cloud — it has not been run
there):

```sh
# The Capacitor 8 CLI refuses to start on Node < 22.
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -lt 22 ]; then
  export HOMEBREW_NO_AUTO_UPDATE=1
  export HOMEBREW_NO_INSTALL_CLEANUP=1
  brew install node@22 || true
  PATH="$(brew --prefix node@22)/bin:$PATH"
  export PATH
fi
```

Without it, a too-old Node fails the archive at `npm run sync` with "The Capacitor CLI requires NodeJS
>=22.0.0" — loud, not silent.

### Step 8 — sync, and the first build

```bash
cd ios-app
npm run sync          # patch-plugins → build.js (www/ + SW stamp) → npx cap sync ios
```

`npx cap sync ios` copies `www/` into the project, rewrites the Podfile's `def capacitor_pods … end` block from
`package.json` (the same nine pods, so expect no Podfile change) and runs **`pod install`** itself. All nine are
`:path` pods out of `node_modules`, so CocoaPods picks the new versions up with no `pod update`. Should it
object to the locked versions anyway (**UNVERIFIED** — not expected):

```bash
cd ios/App && pod install --repo-update
# last resort: rm -rf Pods Podfile.lock && pod install
```

Then the unsigned simulator compile from `CICD.md` — the same command the GitHub job runs:

```bash
cd ios-app/ios/App
xcodebuild -quiet -workspace App.xcworkspace -scheme App \
  -destination 'generic/platform=iOS Simulator' \
  build CODE_SIGNING_ALLOWED=NO
```

`-quiet` prints warnings and errors only; silence plus exit 0 is a pass. Two failures worth recognising:

- `cannot find 'SceneDelegateProxy' in scope` → the Pods project is still Capacitor 6: `pod install` did not run,
  or `@capacitor/ios` resolved below 8.5 (`npm ls @capacitor/ios`).
- an error inside `EbarooniCapacitorCalendar` → the patched Swift. Read it against the diff in step 2; nothing
  here has compiled it.

Then, from the repo root:

```bash
npm run ci            # check + unit tests + www/ drift
```

### Step 9 — what the commit holds

One commit, so rollback is one revert.

| Expect to change | Must not change |
|---|---|
| `ios-app/package.json`, `package-lock.json`, `.tool-versions`, `patch-plugins.js` | `ios-app/ios/App/PsycleBookingBuddy.xcodeproj/project.pbxproj` |
| `ios-app/ios/App/Podfile.lock` (versions + checksums; `Podfile` only if the block was rewritten) | `ios-app/ios/App/App/Info.plist` |
| `ios-app/ios/App/App/AppDelegate.swift` | `MainViewController.swift`; `AppGroupPreferences.swift` beyond a comment |
| `ios-app/www/native-bridge.js`, plus whatever `npm run build` restamps (`sw.js`, `ios-app/www/sw.js`) | `ios-app/capacitor.config.json` |
| `tests/suites/calendar-safety.js` | `PsycleWidget*`, `PsycleLiveActivity`, `PsycleShared`, `PsycleIntents` |
| `.github/workflows/ci.yml` (and `ci_post_clone.sh` only if needed) | any web source under `js/`, `css/`, `*.html` |

Docs that name the old versions, for the same commit:

- The architecture guide (once `CLAUDE.md`, now split by topic) — `AGENTS.md`: the opening line ("Capacitor 6 iOS
  wrapper"). `agents/architecture/testing-and-ci.md`: *Build & CI* (patcher "currently: … 6.7.2 … and …
  `@capacitor/ios` 6.2.1" → the calendar patch on 8.6.0 only). `agents/architecture/ios.md`: *iOS App* ("Capacitor 6
  wrapper", "CLI pinned to 6"); *Scene life cycle*
  (`SceneDelegate` now calls `SceneDelegateProxy`; drop the `presentVC` sentence); *Calendar contract* ("must
  match … **v6** (`notes`, `alertOffsetInMinutes`, … `createEvent` → `{result: "<id>"}`)" → v8: `description`,
  `alerts` negative = before, `listEventsInRange({from, to})`, `createEvent` → `{id}`).
- `README.md` line 5; `SETUP.md` ("Node.js (v20+)", the asdf `20.19.5` lines, the "pinned to 6.7.2" row);
  `ios-app/CICD.md` (the scene note ends "When upgrading to Capacitor ≥ 8.5, replace these…" — now done);
  `ios-app/NATIVE_FEATURES.md` ("@capacitor/preferences v6 plugin stores everything in…" — still true of 8).
- This file: delete it, or keep it as the record.

---

## 5. Every plugin call `native-bridge.js` makes

| Plugin (`Capacitor.Plugins.…`) | Calls | 6 → 8 |
|---|---|---|
| `Preferences` | `get({key})`, `set({key, value})`, `remove({key})`; config `plugins.Preferences.group` | None. `Preferences.swift` in the installed 6.0.4 and upstream 8.0.1 is **byte-identical**: `UserDefaults.standard`, key = `group + "." + key`. The mirrored token and every `SYNC_KEYS` value survive the upgrade — and a rollback. |
| `Haptics` | `notification({type: 'SUCCESS' \| 'ERROR'})`, `impact({style: 'LIGHT'})` | None. 7.0 removed only the deprecated `Haptics*` TypeScript type names; the string values are unchanged. The plugin now lives in `ionic-team/capacitor-haptics`. |
| `Share` | `share({title, text, url})` | None (only Android fixes in its changelog). |
| `Browser` | `open({url})` | None in the API. 8.0.2 presents from `bridge.viewController` directly. |
| `StatusBar` | `setStyle({style: 'LIGHT' \| 'DARK'})` | None — the `Style` values are unchanged. 8.0.0 dropped the plugin's own `CAPBridgeViewController` extension that emitted the view-appeared events (core emits them now); this app has no such extension. Capacitor 8 core also ships a built-in `SystemBars` plugin that applies style `DEFAULT` when it loads; the bridge sets its style afterwards, from the theme, so ours should win — **UNVERIFIED**, look at the glyphs on a device. |
| `LocalNotifications` | `schedule({notifications: [{id, title, body, schedule: {at, allowWhileIdle}, sound, extra, actionTypeId}]})`, `cancel`, `checkPermissions`, `requestPermissions`, `registerActionTypes`, `removeDeliveredNotifications`, `addListener('localNotificationActionPerformed', …)` | None found. 8.1.0 deprecates `summaryArgument` (unused here); 8.2.0 adds an optional `presentationOptions` config. From 8.3.0 the plugin is published from its own repo (`ionic-team/capacitor-local-notifications`), entered in its changelog as "new Local Notifications Capacitor plugin", with no API change listed. Pod name unchanged. Behaviour parity of 8.3.x is **UNVERIFIED** beyond that — hence two notification checks on the device list. |
| `CapacitorCalendar` | `checkAllPermissions`, `requestFullCalendarAccess` (`requestAllPermissions` only as the fallback for a plugin without it), `listCalendars`, `listEventsInRange`, `deleteEventsById`, `deleteEvent`, `createEvent` | **Three call shapes change — step 6.** `requestAllPermissions` has been marked deprecated since 7.1.0 and still ships in 8.6.0. It asks for full Reminders access as well, exactly as 6.7.2 did (same code path) — which is why the bridge stopped calling it (September 2026): the app has no Reminders feature and no purpose string, so on iPhone that second request failed and the first attempt to switch sync on read as denied. `_ensureCalendarPermission` now calls `requestFullCalendarAccess()` and READS THE GRANT BACK with `checkAllPermissions`; check that both still exist under those names in the version you install. A behaviour change; not part of this upgrade. |
| `AppGroupPreferences`, `WidgetCenter`, `PsycleLiveActivity`, `PsycleDeepLink` (in-app) | `set`, `reloadAllTimelines`, `refresh`, `addListener('openURL', …)` | None — section 6. |
| `Device`, `App` | probed for the bug report; not installed | None. |

`window.Capacitor.Plugins.<jsName>` itself is still created natively for every registered plugin
(`JSExport.swift` at `8.5.2`), so a page that never bundles `@capacitor/core` keeps working.

---

## 6. What does not change, and why

- **`PsycleDeepLinkPlugin`** — still works unmodified; step 5 has the reasoning. Both of its inputs,
  `.capacitorOpenURL` and `ApplicationDelegateProxy.shared.lastURL`, are kept by 8.5 on purpose.
- **The in-app plugins' shape** — `CAPBridgedPlugin` still asks for exactly `identifier`, `jsName` and
  `pluginMethods`; `CAPPluginMethod(name:returnType:)` and `CAPPluginReturnPromise` are unchanged;
  `bridge?.registerPluginInstance(_:)` is still on `CAPBridgeProtocol`; `notifyListeners(_:data:retainUntilConsumed:)`,
  `hasListeners(_:)` and an overridable `addListener(_:)` are still on `CAPPlugin` (headers at `8.5.2`).
- **`Info.plist`** — the scene manifest already there is, key for key, the one the 8.5 guide prints.
- **`AppDelegate`'s `configurationForConnecting`** — the template also sets `config.delegateClass`; ours names
  the delegate in `Info.plist` (`UISceneDelegateClassName`) instead. Equivalent.
- **Deployment target** — Capacitor 8 requires iOS 15.0. The project and app target are at 15.0 and the widget
  extension at 16.1 already.
- **Podfile** — `platform :ios, '16.0'` already satisfies the guide's `'15.0'`. Every 8.x podspec in the table
  declares `s.ios.deployment_target = '15.0'` (Capacitor, all six official plugins, the calendar plugin), and
  Capacitor 8's own `assertDeploymentTarget` lifts anything lower to 15.0. The `MIN_IOS_DEPLOYMENT_TARGET`
  hook therefore has nothing left to lift today. **Keep it**: it is harmless, and it is the one line to change
  the next time Xcode raises the floor.
- **CocoaPods, not SPM** — stay. The guide: new projects default to SPM, but "it doesn't affect existing apps";
  the CLI picks SPM only when a `CapApp-SPM` folder exists. Moving would touch the committed Xcode project, the
  `App.xcodeproj` symlink (CLI 8 still hard-codes `App/App.xcodeproj`), `wire_native_targets.rb` and both CI
  recipes at once, in a build that has not been on a device. Nothing forces it: all nine pods are `:path` pods
  out of `node_modules`, so CocoaPods trunk going read-only on 2 December 2026 does not reach this project —
  its maintainers say the switch "shouldn't affect people who … have all of their dependencies vendored". A
  separate change, later, if ever.
- **`capacitor.config.json`** — uses none of the removed or changed keys (`bundledWebRuntime`,
  `cordova.staticPlugins`, `ios.appendUserAgent`, `android.adjustMarginsForEdgeToEdge`).
- **`cap sync`** — same mechanism as today: replaces `def capacitor_pods … end`, runs `pod install`, then
  `xcodebuild clean`. The `target 'PsycleBookingBuddy'` block and `post_install` are left alone.
- **Legacy API scan** — no Swift in this repo mentions `UIApplication.shared.applicationState`, `tmpWindow`,
  `TmpViewController`, or emits `.capacitorViewDidAppear` / `.capacitorViewWillTransition` itself: the patterns
  the 8.0 and 8.5 guides tell you to audit for.

---

## 7. Verification checklist

Nothing below sends Psycle a write unless it says so. Tick in order; stop at the first failure.

**On the Mac**

- [ ] `cd ios-app && npm ci` ends in `[patch-plugins] OK`; `npm run patch:check` is green.
- [ ] `grep '"resolved"' ios-app/package-lock.json | grep -v registry.npmjs.org` prints nothing.
- [ ] `npm run ci` at the repo root is green, `calendar-safety` included.
- [ ] The unsigned simulator build in step 8 exits 0 — with **Xcode 27** selected, since that is what archives.
- [ ] Run the App scheme on an **iOS 27 simulator** from Xcode. It launches to Discover — no crash at launch,
      which is what a missing scene life cycle produces under the iOS 27 SDK.
- [ ] Background and foreground it: no "JS Eval error" in the Xcode console (the 8.5.2 fix).
- [ ] Live Activity path without signing in (DEBUG builds only — the hook is in `AppDelegate.appDidBecomeActive`):
      `xcrun simctl launch booted com.psyclefinder.app -PSYCLE_LA_TEST 1`.

**Push the branch, then**

- [ ] GitHub Actions green on the PR. Run the iOS job by hand too (`workflow_dispatch`) — it does not run on
      branch pushes.
- [ ] After the merge, read the **Xcode Cloud** check on the merge commit (`CICD.md` → Notes):
      `curl -s https://api.github.com/repos/muscaglar/psycle-booking/commits/<sha>/check-runs` → the `Xcode Cloud`
      app's "Archive - iOS" run must say `conclusion: success`. `action_required` means it failed;
      `output.text` lists the errors.

**On a device (TestFlight build)**

- [ ] **Launch** — cold launch reaches Discover and the session is still signed in (the token is restored from
      Preferences; its storage code did not change).
- [ ] **Calendar** — Membership → Calendar sync → **Re-sync now** on a calendar that already holds synced
      classes: the button answers "All N up to date" — not "Synced (+N −N)" — and nothing is duplicated. Tap it
      a second time: still "up to date" (a marker that was not written shows up here as a fresh "+N" on every
      pass). *(The next three checks need a new class in
      the calendar — book one as you normally would; that is a real booking.)* Open the new event in Calendar:
      alerts read **1 hour before** and **15 minutes before**, and the notes end in `psycle-event-id:<id>`. For
      the zone, attach Safari's Web Inspector to the app and run this (it only reads the calendar):
      ```js
      var now = Date.now();
      (await Capacitor.Plugins.CapacitorCalendar.listEventsInRange({ from: now, to: now + 14 * 864e5 })).result
        .filter(function (e) { return /psycle-event-id:/.test(e.description || ''); })
        .map(function (e) { return [e.title, e.timezone, e.alerts]; });
      ```
      Every event created after the upgrade must report `timezone: "Europe/London"`. Without the inspector: set
      the phone to another time zone — the event still sits at the class's UK time and Calendar names
      London's zone beside it.
- [ ] **Notifications** — Settings → Reminders: turn the Monday reminder off and on; no error toast. A class
      reminder is armed for a held class more than 90 minutes away; tapping a delivered one opens My Bookings
      and that class.
- [ ] **Share sheet** — Settings → Bug report opens the share sheet; My Bookings' calendar export shares the
      `.ics`.
- [ ] **In-app browser** — My Bookings → the calendar export row → Google Calendar (or a booking's More → Map).
      The bridge routes every `window.open('https://…')` through `Browser.open`. The browser slides up *inside*
      the app and Done returns to it. This is the check that replaces the deleted `presentVC` patch.
- [ ] **Status bar** — dark glyphs on Cloud, light glyphs on Graphite, straight after a theme switch and again
      after a cold launch.
- [ ] **Widget tap, warm** — app in the background, tap the widget: My Bookings, then that class's sheet.
- [ ] **Widget tap, cold** — swipe the app away, tap the widget: the same, **once**. Twice means the old
      forwarding was left beside the proxy (step 5).
- [ ] **Live Activity** — inside the lead window before a held class the countdown card appears on the Lock
      Screen with the seat, and it goes at class start.
- [ ] **Haptics** — a light tick on a day swipe in Discover.

---

## 8. Rollback

The upgrade is one commit, so:

```bash
git revert <upgrade-sha>
cd ios-app
rm -rf node_modules && npm ci     # postinstall re-applies the 6.x patches
npm run sync                      # pods back to 6.x
```

Merged to `main` already? Push the revert — Xcode Cloud archives it like any other push. It is safe for data in
both directions: Preferences storage is byte-identical across the versions; events written by plugin 8 keep
their marker in `EKEvent.notes`, which plugin 6 also lists as `description`; and the revert takes the bridge's
call shapes back with it. One thing to check: the revert restores `nodejs 20.19.5` in `ios-app/.tool-versions`,
which is right for CLI 6.

---

## 9. UNVERIFIED — confirm as you go

1. **Which Node Xcode Cloud provides.** Read `node --version` in the latest build log before starting (step 7
   has the guard).
2. **That the npm tarballs match the GitHub tags that were read.** This document was written where package
   *metadata* could be queried but tarballs could not be downloaded, so source was read at the release tags
   (`ionic-team/capacitor@8.5.2`, `ebarooni/capacitor-calendar@v8.6.0`; official plugins on `main`). The
   patcher's fail-loud anchors and the greps in step 4 close this gap at step 3.
3. **That the patched calendar Swift compiles**, and that `SceneDelegateProxy` behaves as read. Nothing was
   built — no `xcodebuild`, `pod` or simulator run lies behind this document.
4. **Cold-launch widget tap through `SceneDelegateProxy`** — reasoned from source (step 5), not run.
5. **`SystemBars` against `@capacitor/status-bar` on iOS** — read from source only.
6. **`@capacitor/local-notifications` 8.3.x** — re-homed plugin; only its changelog was checked.
7. **Whether Capacitor 8.5.2 fails to compile under Xcode 16.4**, and whether the `macos-26` runner label is
   enabled for this repo.
8. **`pod install` accepting the version jump with the old `Podfile.lock` present** — the documented flow
   (`npx cap sync`) implies it does.
9. **Going 6 → 8 in one hop** — the guides only describe 6 → 7 → 8 (section 3 gives the grounds).
10. Capacitor's `main` docs already name a Capacitor 9 (Node 24, Xcode 27 minimum). `latest` on npm was still
    8.5.2 on the research date; 9 is out of scope here.

---

## 10. Sources

Official guides (read as raw markdown from `ionic-team/capacitor-docs`, the source of capacitorjs.com):
[Updating to 7.0](https://capacitorjs.com/docs/updating/7-0) ·
[Updating to 8.0](https://capacitorjs.com/docs/updating/8-0) ·
[Updating to 8.5 — UIScene](https://capacitorjs.com/docs/updating/8-5) ·
[Environment setup](https://capacitorjs.com/docs/getting-started/environment-setup) ·
[Swift Package Manager](https://capacitorjs.com/docs/ios/spm)

Capacitor at tag `8.5.2` (`ionic-team/capacitor`): `CHANGELOG.md`; `ios/Capacitor/Capacitor/`
`CAPSceneDelegateProxy.swift`, `CAPApplicationDelegateProxy.swift`, `CapacitorBridge.swift`,
`CAPBridgeViewController.swift`, `CAPNotifications.swift`, `CAPBridgedPlugin.h`, `CAPPlugin.h`,
`CAPBridgeProtocol.swift`, `JSExport.swift`, `Plugins/SystemBars.swift`; `ios/Capacitor.podspec`;
`ios/scripts/pods_helpers.rb`; `ios-pods-template/App/` (`AppDelegate.swift`, `SceneDelegate.swift`,
`Info.plist`, `Podfile`); `cli/bin/capacitor`, `cli/package.json`, `cli/src/config.ts`, `cli/src/ios/common.ts`,
`cli/src/ios/update.ts`, `cli/src/tasks/migrate.ts`, `cli/src/tasks/migrate-uiscene.ts`.

Plugins: `ionic-team/capacitor-plugins` (`browser`, `preferences`, `share`, `status-bar`: `CHANGELOG.md`,
`src/definitions.ts`, podspecs, `BrowserPlugin.swift`, `Preferences.swift`);
`ionic-team/capacitor-haptics` and `ionic-team/capacitor-local-notifications` (`CHANGELOG.md`, `README.md`,
podspecs); `ebarooni/capacitor-calendar` at `v8.6.0` (`CHANGELOG.md`, `README.md`, the podspec, everything
under `ios/Plugin/` named above).

Registry and CI: `registry.npmjs.org` package metadata (dist-tags, peer ranges, engines, publish dates);
`actions/runner-images` `macos-15-arm64` and `macos-26-arm64` READMEs (image `20260907`);
[CocoaPods Specs Repo read-only plan](https://blog.cocoapods.org/CocoaPods-Specs-Repo/).

This repo at `2b17154`: `ios-app/package.json`, `package-lock.json`, `.tool-versions`, `patch-plugins.js`,
`capacitor.config.json`, `CICD.md`; `ios-app/ios/App/` `Podfile`, `Podfile.lock`, `project.pbxproj`,
`ci_scripts/ci_post_clone.sh`, `App/AppDelegate.swift`, `App/MainViewController.swift`,
`App/AppGroupPreferences.swift`, `App/Info.plist`, `App/Base.lproj/Main.storyboard`;
`ios-app/www/native-bridge.js`; `.github/workflows/ci.yml`; `tests/suites/calendar-safety.js`; and the installed
6.x packages, for the "before" side of each comparison.
