# ios-app/android/ — read before editing here
The Android shell of the same Capacitor 6 app: a Gradle project, one activity, the manifest, resources. It wraps the SAME [../www/](../www/) and the same bridge as the iPhone app. The repo-wide rules are in the root [AGENTS.md](../../AGENTS.md) — this file adds only what is local; the folder above has its own [AGENTS.md](../AGENTS.md).

## Rules that bite here
The rule → why → its guard. Suites are in tests/suites/; G… are entries in agents/learnings.md.
1. **Nobody compiles this locally: CI is the compiler** (root rule 5). No JDK or Android SDK is assumed on a development machine → push to an `android/**` branch and read the `android-build` job (playbooks P14). Until it is green the change is "read, not built"; when it is green it is "compiled, not seen on a device" (G7, G9) → add a line to the checklist in [../ANDROID.md](../ANDROID.md).
2. **Small, conventional, read twice.** Well-formed XML; resource FILE names `[a-z0-9_]` only; every `@type/name` and style parent exists; only androidx classes the pinned versions carry (variables.gradle); only APIs that exist from minSdk 22 — anything newer goes in a qualified folder, as values-v23/ and values-v27/ do (a style in a qualified folder REPLACES the one in values/; `values-night/` outranks an API level). Guard: 19-android-project.js parses every XML under res/ and resolves every reference; its first section proves it can fail. It is not aapt2.
3. **GENERATED — never hand-edit**: capacitor.settings.gradle and app/capacitor.build.gradle (`cap sync android` rewrites them: commit them after a plugin change, as the Podfile is on iOS); the git-ignored app/src/main/assets/public/, assets/capacitor.config.json, assets/capacitor.plugins.json, res/xml/config.xml and capacitor-cordova-android-plugins/ (Gradle cannot run without them → `npm run sync:android` first); the res/mipmap-*dpi/ PNGs (`sh assets/render-icons.sh android`). Guard: 19-android-project.js fails if a generated path is tracked.
4. **Back**: `MainActivity` evaluates `(window._psycleAndroidBack ? window._psycleAndroidBack() : false)` and, on anything but `"true"`, calls `moveTaskToBack(true)`. Never `finish()`, never a default `onBackPressed()`, no timeout, no @capacitor/app plugin. WHAT closes is the web layer's business (js/app.js, `pure:android-back`). Because Back never finishes it, one activity lives for days: `uiMode` STAYS in the manifest's `configChanges` (a recreation reloads the web view under a request in flight), and `onConfigurationChanged` re-reads the navigation-bar colour and the web view's ground — dark navigation buttons from API 27 only, as values-v27/ has it. Guard: 19-android-project.js reads every .java file of the package.
5. **No new Capacitor plugin and no new npm package**: a plugin is an iOS pod, and ../package.json and ../package-lock.json must not change again (Xcode Cloud runs `npm ci`, then `npm run sync`, which stays iOS-only). Guard: 19-android-project.js (the scripts, the lockfile, ci_post_clone.sh knows nothing of Android).
6. **Backups off, cleartext off** (`allowBackup="false"` + res/xml/backup_rules.xml + res/xml/data_extraction_rules.xml, every domain excluded): what the app stores is a sign-in. One exported component — the launcher, which ANY app can start with extras of its choosing: the bridge refuses what a forged notification tap could abuse (android.md → Notifications) — no service or receiver of the app's own, no custom URL scheme or host, portrait only. A live-reload run needs cleartext lifted locally — never commit that, nor `server.url`, `server.allowNavigation` or `server.hostname` in ../capacitor.config.json. Guard: 19-android-project.js reads both rule files domain by domain and counts the exported components.
7. **No secret, ever — the repository is public**: no keystore (`*.jks`, `*.keystore`, `*.p12`, `*.pfx` — a current keytool writes PKCS12), no password, no keystore.properties. app/build.gradle reads `PSYNC_KEYSTORE_FILE`, `PSYNC_KEYSTORE_PASSWORD`, `PSYNC_KEY_ALIAS`, `PSYNC_KEY_PASSWORD` from the environment or from keystore.properties (git-ignored); with any missing a release is UNSIGNED, never debug-signed. Guard: 19-android-project.js (tracked files, both .gitignore files, no literal password in a Gradle file).
8. **Names that other files hold** → change both sides: `AppTheme.NoActionBar` (`BridgeActivity` switches to it by name); `ic_stat_psync` and `#1B2130` (`ANDROID_NOTIF_ICON` / `ANDROID_NOTIF_TINT` in ../www/native-bridge.js, and `plugins.LocalNotifications` in ../capacitor.config.json); `psync_ground` by day and by night = the `bg` of Cloud and Graphite in js/theme.js `APP_THEMES`, and `android.backgroundColor` = Cloud's; `READ_CALENDAR` / `WRITE_CALENDAR` (the calendar plugin's manifest declares nothing). Guard: 19-android-project.js, "Android seams".
9. **The SDK levels belong to the Capacitor major** (variables.gradle: minSdk 22, targetSdk 34, compileSdk 35; AGP 8.2.1; Java 17). compileSdk 35 is deliberate (the calendar plugin pins androidx.core 1.15.0; gradle.properties silences AGP's warning). Do not raise targetSdk by hand — at 35 Android enforces edge-to-edge and ignores the bar colours in values/ — and do not accept Android Studio's offer to upgrade AGP or Gradle.
10. **The mark is drawn four times as vectors** — ic_launcher_foreground.xml (its note explains the geometry and why the grooves are real holes), ic_launcher_monochrome.xml, splash_mark.xml, ic_stat_psync.xml → change one, change all four. The launcher vectors use LITERAL colours on purpose; splash_mark.xml follows night. No guard: 12-brand-mark.js does not read them.
11. **Platform behaviour is not written here.** Channels, the status-bar colour, the calendar shapes and the copy are `IS_ANDROID` branches of the bridge; the iPhone path must stay byte-identical → 18-android.js (`IPHONE_LAUNCH_DIGEST`). Bridge code still needs no phone: `harness(t).boot({ platform: 'android' })`.

## What is in here
| Path | Holds |
|---|---|
| app/src/main/java/com/psyclefinder/app/MainActivity.java | the ONE Java file: the night-aware web-view ground, the Back callback, the light / dark flip under a live activity (`onConfigurationChanged`) |
| app/src/main/AndroidManifest.xml | backups off, cleartext off, the launcher activity (portrait only), `READ_CALENDAR` / `WRITE_CALENDAR`; the plugins' own permissions are merged in at build time and NOT repeated |
| app/src/main/res/values*/ | styles.xml (`AppTheme.Ground` → `.SystemBars` → `.NoActionBar`; the launch theme `AppTheme.NoActionBarLaunch`), colors.xml (Cloud; values-night/ = Graphite), bools.xml, the v23 / v27 dark-glyph flags, strings.xml |
| app/src/main/res/drawable/ · mipmap-anydpi-v26/ · mipmap-*dpi/ | the four vectors · the adaptive icon (background, foreground, monochrome) · GENERATED PNGs for Android 7 and below |
| app/src/main/res/xml/ | backup_rules.xml, data_extraction_rules.xml, file_paths.xml (config.xml is generated and git-ignored) |
| app/build.gradle | the appId, `versionCode` / `versionName` (set by hand), release signing from the environment |
| variables.gradle · build.gradle · gradle.properties · gradle/ · gradlew | SDK and library versions · AGP · the wrapper, as the Capacitor template made them |
| .gitignore | the template's, plus signing material |

## After you edit
From the repository root:
```bash
npm run ci              # 19-android-project.js reads this folder; nothing here needs `cd ios-app && npm run build`
npm run agents:index    # only if a suite or the bridge changed with it (Java and XML are not indexed)
```
Then push the branch and read `android-build` (and the advisory `android-smoke` artifact: launch.png, after-back.png, logcat.txt). With a toolchain: `cd ios-app && npm ci && npm run android:debug`.

## Read next
- [agents/architecture/android.md](../../agents/architecture/android.md) — how the Android app differs, and what proves it.
- [../ANDROID.md](../ANDROID.md) — the owner's guide: install, release, the on-device checklist. [../PLAY_STORE_LISTING.md](../PLAY_STORE_LISTING.md) — store copy.
- [agents/playbooks.md](../../agents/playbooks.md) — P14 (change this project and prove it), P5 step 4 (a new overlay and Back).
- [agents/learnings.md](../../agents/learnings.md) — G9 (CI is the compiler), G10 (the Back contract).
- [agents/decisions.md](../../agents/decisions.md) — section 8 (level 2; the iPhone app must not change).
