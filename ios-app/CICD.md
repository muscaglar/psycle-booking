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
- `ci_post_clone.sh` must stay executable (`chmod +x`); git preserves the bit.
- Free tier: 25 Xcode Cloud compute hours/month — a build is ~15–25 min, so
  dozens of TestFlight pushes/month fit comfortably.
- External testers (beyond your own devices) need a one-off Beta App Review:
  add a demo Psycle account's credentials in the TestFlight review notes,
  since the app requires a login.
