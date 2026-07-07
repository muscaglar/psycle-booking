# CI/CD — GitHub Actions + Xcode Cloud → TestFlight

Two systems, clean split:

| Leg | System | Trigger | What it does |
|-----|--------|---------|--------------|
| Web + native compile checks | GitHub Actions (`.github/workflows/ci.yml`) | every push/PR (web); main pushes + manual (iOS compile) | `npm run check` / `test` / `drift`, then an **unsigned** simulator build of `App.xcworkspace` on macOS |
| Archive → TestFlight | Xcode Cloud | pushing a tag matching `ios-v*` | Builds on Apple's runners with **cloud-managed signing**, archives, uploads to TestFlight Internal Testing automatically |

No certificates, provisioning profiles, or App Store Connect API keys live in
GitHub — that's the point of letting Xcode Cloud own the signing/upload leg.

## Release flow

```bash
# 1. land changes on main, wait for CI to go green
# 2. bump the build number (App target → General → Build, i.e. CURRENT_PROJECT_VERSION)
# 3. tag the CI-green remote main (NOT local HEAD, which may differ) and push:
git fetch origin
git tag ios-v1.0-b2 origin/main
git push origin ios-v1.0-b2
```

Xcode Cloud picks up the tag, runs `ci_scripts/ci_post_clone.sh` (installs
Node, `npm ci`, `npm run build`, `npx cap sync ios` — so Pods and www/ are
ready), archives, and the build lands in TestFlight ~20–30 min later.
Internal testers get it with no review.

## One-time Xcode Cloud setup (in Xcode, ~10 minutes)

Prereqs: Apple Developer Program membership; the app record exists in App
Store Connect (bundle id `com.psyclefinder.app`).

1. Open `ios-app/ios/App/App.xcworkspace` → **Integrate menu → Create Workflow…**
   (or Report navigator → Cloud tab → Create Workflow).
2. Select the **App** product → Grant Xcode Cloud access to the GitHub repo
   when prompted (installs Apple's GitHub App on `muscaglar/psycle-booking`).
3. Edit the default workflow:
   - **Environment**: latest released Xcode, latest macOS.
   - **Start Conditions**: remove the branch condition; add **Tag** →
     matching `ios-v*`.
   - **Actions**: one **Archive** action, platform iOS, scheme **App**,
     deployment preparation **TestFlight (Internal Testing Only)**.
   - **Post-Actions**: "TestFlight Internal Testing" → pick/create your
     internal tester group.
4. Save. Xcode Cloud runs `ci_scripts/ci_post_clone.sh` automatically because
   it sits next to the workspace — nothing else to configure.
5. First run: trigger manually from the Cloud tab (Start Build) or push a tag.

Signing is handled by Xcode Cloud's managed distribution certs — if it asks,
let it create the cloud signing assets for the team.

## Notes / gotchas

- **Build numbers must be unique per version.** Bump
  `CURRENT_PROJECT_VERSION` before tagging, or enable Xcode Cloud's
  "automatically increment build number" option in the Archive action (then
  you can stop managing it by hand).
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
