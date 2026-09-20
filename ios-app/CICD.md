# CI/CD — GitHub Actions + Xcode Cloud → TestFlight

Two systems, clean split:

| Leg | System | Trigger | What it does |
|-----|--------|---------|--------------|
| Web + native compile checks | GitHub Actions (`.github/workflows/ci.yml`) | every push/PR (web); main pushes + manual (iOS compile) | `npm run check` / `test` / `drift`, then an **unsigned** simulator build of `App.xcworkspace` on macOS |
| Archive → TestFlight | Xcode Cloud ("Beta Build" workflow) | **every push to main** (Branch Changes) | Builds on Apple's runners with **cloud-managed signing**, archives, uploads to TestFlight Internal Testing automatically |

No certificates, provisioning profiles, or App Store Connect API keys live in
GitHub — that's the point of letting Xcode Cloud own the signing/upload leg.

## Release flow

Push to main. That's it — Xcode Cloud's Branch Changes condition picks up
the push, runs `ci_scripts/ci_post_clone.sh` (installs Node, `npm ci`,
`npm run sync` — so Pods and www/ are ready), archives, and the build lands
in TestFlight ~20–30 min later. Internal testers get it with no review.

Build numbers are auto-assigned by Xcode Cloud (its run number becomes the
uploaded build number), so there is nothing to bump between uploads.

The GitHub Actions checks run in parallel on the same push — if Actions goes
red, treat that TestFlight build as suspect even if it archived; push the
fix and take the next build.

Budget note: the developer program includes 25 Xcode Cloud compute hours per
month and a build costs ~20–30 min, so roughly 50+ main pushes/month fit. If
pushes get more frequent than that, batch work on a branch and merge to main
when it's TestFlight-worthy (or switch the start condition to a tag).

## One-time Xcode Cloud setup (in Xcode, ~10 minutes)

Prereqs: Apple Developer Program membership; the app record exists in App
Store Connect (bundle id `com.psyclefinder.app`).

1. Open `ios-app/ios/App/App.xcworkspace` → **Integrate menu → Create Workflow…**
   (or Report navigator → Cloud tab → Create Workflow).
2. Select the **App** product → Grant Xcode Cloud access to the GitHub repo
   when prompted (installs Apple's GitHub App on `muscaglar/psycle-booking`).
3. Edit the default workflow:
   - **Environment**: latest released Xcode, latest macOS.
   - **Start Conditions**: keep **Branch Changes** on `main` (the live
     setup). Alternative for deliberate-only uploads: replace it with **Tag** →
     matching `ios-v*`.
   - **Actions**: one **Archive** action, platform iOS, scheme **App**,
     deployment preparation **TestFlight (Internal Testing Only)**.
   - **Post-Actions**: "TestFlight Internal Testing" → pick/create your
     internal tester group.
4. Save. Xcode Cloud runs `ci_scripts/ci_post_clone.sh` automatically because
   it sits next to the workspace — nothing else to configure.
5. First run: trigger manually from the Cloud tab (Start Build) or push to main.

Signing is handled by Xcode Cloud's managed distribution certs — if it asks,
let it create the cloud signing assets for the team.

## Tester feedback & logs (TestFlight)

Three channels, no third-party services:

1. **TestFlight screenshot feedback (built-in, zero setup).** Testers take a
   screenshot inside the app → iOS offers "Share Beta Feedback" → comment +
   image goes to App Store Connect → your app → TestFlight → **Feedback
   (Screenshots)**. Available for builds ≤ 90 days old; also reachable from
   the TestFlight app ("Send Beta Feedback").
2. **Crashes (built-in).** Any native crash in a TestFlight build prompts the
   tester for comments and uploads the log: ASC → TestFlight → **Feedback
   (Crashes)**, and symbolicated in Xcode → Organizer → Crashes (plus hangs/
   energy in the other Organizer tabs). No SDK needed.
3. **In-app bug report (ours — covers what TestFlight can't see).** JS errors
   in the webview are NOT native crashes, so channels 1–2 never see them. The
   app keeps its own logs (`psycle_error_log` / `psycle_action_log`, mirrored
   to Preferences) and Membership → Settings → **Bug report** now opens the
   native share sheet with the full `getDiagnosticReport()` output (device +
   app + error/action logs) — testers Mail/AirDrop it in one tap. On the web
   build the same button downloads a .txt.

Worth doing in ASC: set **Beta App Information → Feedback Email**, and put
"shake out of it? Use Settings → Bug report and share it to us" in the
build's **What to Test** notes so testers know channel 3 exists.

## Notes / gotchas

- **Build numbers are handled by Xcode Cloud** — it stamps its own run number
  as the uploaded build number (verified: uploads arrive as "Build 13" etc.
  while `CURRENT_PROJECT_VERSION` stays 1). No manual bumping needed.
- The drift check in GitHub Actions guarantees `www/` in the repo matches the
  source, and `ci_post_clone.sh` rebuilds it anyway — so Xcode Cloud never
  ships stale web assets.
- The drift check does NOT cover the native project: after changing Capacitor
  plugins in `package.json`, run `npx cap sync ios` locally and **commit the
  regenerated `ios/App/Podfile` + `Podfile.lock`**. CI regenerates them on the
  runner (so CI stays green either way), but someone building straight from
  the repo in Xcode would otherwise compile without the new plugin.
- **A green GitHub Actions run does not mean the TestFlight build worked.** The
  unsigned iOS check runs on GitHub's Xcode; Xcode Cloud archives with its own
  ("Latest Release") Xcode and can fail on things the older one only warns
  about. After pushing to `main`, read the Xcode Cloud check on the commit —
  it is on the commit's checks list on github.com, or without signing in:
  `curl -s https://api.github.com/repos/muscaglar/psycle-booking/commits/<sha>/check-runs | jq '.check_runs[] | select(.app.name=="Xcode Cloud") | {name,status,conclusion}'`
  (an empty result = no check; the unauthenticated GitHub API allows 60
  requests an hour per address — `gh api repos/muscaglar/psycle-booking/commits/<sha>/check-runs`
  when signed in). Look for the "Archive - iOS" run (`conclusion`: `success`,
  or `action_required` = failed; `output.text` lists the errors). A red
  archive is usually the deployment-target floor, `ci_post_clone.sh` (its
  executable bit, or a Node install step), `npm ci` unable to reach the public
  registry, or `npm run patch:check`. The scene life cycle (below) is NOT one
  of them: that build archives green and crashes on the phone.
- **No Xcode Cloud check at all is a third outcome, and it is not a failure of the
  code.** Normally the `Xcode Cloud` check appears on a pushed commit within a few
  minutes. On 19 September 2026 commit `98665f6` never got one — no status, no
  check run, nothing four hours later — while every GitHub check on it passed and
  the commit before it had archived normally. The check normally appears long
  before the ~20–30 min archive finishes, so no check 15 minutes after the push
  is already this outcome: do not wait for the build time to elapse. A
  `cancelled` conclusion is different and harmless: a newer push superseded
  that build — read the Xcode Cloud check on the NEWER commit, whose archive
  includes this one. (`cancelled` with NO newer push on `main` means it was
  cancelled by hand in App Store Connect: ask the owner; "Start Build" on
  `main` rebuilds it.) When a commit has NO Xcode Cloud
  check: open App Store Connect → Xcode Cloud → the workflow. Either the month's
  compute hours are used up (every push to `main` archives — a day of many small
  pushes spends them quickly; batch commits into one push when that matters), or
  the push was never picked up, in which case "Start Build" on `main` there, or
  the next push, builds the latest commit. Nothing in the repository needs changing.
  - **This step is the owner's.** No App Store Connect keys exist in the
    repository or in GitHub, by design, so an agent cannot see compute usage or
    press "Start Build": hand the owner the sha, the check-runs output showing no
    `Xcode Cloud` run, and the two possible causes.
  - **Do not push an empty or trivial commit to re-trigger a missed build.** A
    push to `main` also publishes the web app and, if it is picked up, spends
    another archive. If hours remain, the owner presses "Start Build"; if they
    are spent, nothing builds until the monthly reset or more hours are bought.
  - **The web app deploys from `main` independently**, so with GitHub green and
    no Xcode Cloud build the web change is already live; only TestFlight is on
    the previous build.
  - If "Start Build" is unavailable or the workflow is missing: Apple's GitHub
    App lost access to the repository, the workflow was disabled, or its start
    condition is no longer Branch Changes on `main` → re-walk "One-time Xcode
    Cloud setup" steps 2–3.
  - Not written down yet (the owner's to confirm): where App Store Connect shows
    the month's usage and its reset date; whether the check run is created when
    a build is QUEUED or when it STARTS; whether the workflow's auto-cancel
    option is on.
- **Scene life cycle is mandatory from the iOS 27 SDK.** A UIKit app built
  with Xcode 27 that has no `UIApplicationSceneManifest` is killed at launch
  ("UIScene life cycle is required for apps built with this SDK") — it
  archives and uploads fine, then crashes on every device. That is what the
  first Xcode 27 TestFlight build did (September 2026). The app adopts scenes
  by hand, because Capacitor only did so in 8.5: the scene manifest in
  `Info.plist`, `SceneDelegate` at the bottom of `App/AppDelegate.swift`
  (forwards URL opens / user activities to Capacitor's
  `ApplicationDelegateProxy` and calls the AppDelegate's
  `appDidBecomeActive()` / `appDidEnterBackground()` — UIKit no longer calls
  the `application…` versions), and a `patch-plugins.js` entry that makes
  Capacitor 6's temporary presentation window scene-aware so the in-app
  browser still appears. When upgrading to Capacitor ≥ 8.5, replace these
  with Capacitor's own `SceneDelegateProxy` and drop that patch.
- **Deployment target floor.** Xcode 27 accepts iOS 15.0 and up only and
  fails the archive — once per target — on anything lower (September 2026:
  eight archives in a row failed on "set to 13.0, but the range of supported
  deployment target versions is 15.0 to 27.0.x"). The project and app target
  are at 15.0, the widget extension at 16.1, and the Podfile's `post_install`
  lifts any pod below `MIN_IOS_DEPLOYMENT_TARGET`, because the Capacitor pods
  still declare 13.0 and Xcode Cloud regenerates the Pods project on every
  build. When a future Xcode raises the floor again, change that constant and
  the four `IPHONEOS_DEPLOYMENT_TARGET` settings in the project together.
- `ci_post_clone.sh` must stay executable (`chmod +x`); git preserves the bit.
- Free tier: 25 Xcode Cloud compute hours/month — the budget is worked out
  under "Release flow" above (a build is ~20–30 min, so roughly 50 pushes to
  `main` a month). A day of many small pushes can spend a large share of it:
  batch commits into one push.
- External testers (beyond your own devices) need a one-off Beta App Review:
  add a demo Psycle account's credentials in the TestFlight review notes,
  since the app requires a login.
