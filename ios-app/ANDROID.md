# Psync for Android — the owner's guide

The Android app is the same app as the iPhone one: the same web layer (`ios-app/www/`), the same bridge
(`ios-app/www/native-bridge.js`), the same Capacitor 6, in a second native shell at `ios-app/android/`. (The folder
is still called `ios-app/`; that name is historical.) It is "level 2": everything the iPhone app does **except the
widgets, the Live Activity and Siri**.

**Where it stands — read this first.** Compiled, and launched on an emulator; not yet seen on a phone. It was
written without an Android toolchain (no JDK, no SDK), by reading, and then compiled by CI's `android-build` job and run on an emulator by `android-smoke`:
it launches into the first-run welcome, one Back key skips the welcome and leaves the app alive on Discover, the log shows no crash or script error, and natively the bridge created its two channels, set the status-bar colour and read its mirrored keys through Preferences. That run never taps: signing in, booking,
a reminder firing, a calendar write and the share sheet have not happened anywhere.
GitHub Actions is the compiler:
the `android-build` job builds a debug APK on every push to `main` or to an `android/…` branch. What only a phone
can prove is the [on-device checklist](#on-device-checklist) at the end, and none of it is ticked.

| Leg | System | Trigger | What it does |
|-----|--------|---------|--------------|
| Compile + debug APK | GitHub Actions, job `android-build` (`.github/workflows/ci.yml`) | push to `main` or `android/**`, or "Run workflow" | `npm ci`, `npm run sync:android`, `./gradlew assembleDebug`; uploads the artifact **`psync-debug-apk`** (kept 30 days); then an advisory Android lint |
| Emulator smoke (advisory) | GitHub Actions, job `android-smoke` | push to `android/**`, or "Run workflow" | installs that APK on an emulator, opens it, screenshot, ONE Back key, screenshot; uploads **`android-smoke`** (two pictures and a log, for a person to read). It never taps, so it can book nothing |
| Release | you, by hand | — | a signed bundle from your own keystore, uploaded in Play Console. Nothing about Android is wired to a store, and no key lives in GitHub |

The iPhone pipeline is untouched: `npm run sync` (what Xcode Cloud runs) is still iOS-only, no package and no
plugin was added for Android's sake, and no Swift changed.

## Try it with nothing installed

1. On github.com open the repository → **Actions** → the newest **CI** run on `main` with a green **Android build
   check (debug APK)** job. (Until this work is merged, the newest run on the `android/level-2` branch.) You must be
   signed in to GitHub to download artifacts.
2. At the bottom of the run, under **Artifacts**, download **psync-debug-apk**. It arrives as a zip; inside is
   `app-debug.apk`.
3. Get the APK onto the phone (download it there, or send it to yourself) and open it. Android asks once to allow
   the app you opened it with (Files, Chrome) to **install unknown apps**: allow, go back, install. Play Protect may
   warn that it does not know the developer — that is what a sideloaded debug build looks like.
4. Open **Psync**.

Know this about a debug build:
- It is **not for the Play Store** and cannot be uploaded there: it is signed with a throwaway debug key and is
  debuggable (desktop Chrome can inspect its web view at `chrome://inspect`).
- Each CI run makes a new debug key, so a newer APK will not install over an older one ("App not installed"):
  uninstall Psync first. That wipes its data, so you sign in again.
- **It is the real app and it talks to Psycle's real API.** Signing in is real, and Book, Cancel, Join and Claim
  spend real credits and give up real seats.

## What is different from the iPhone app

| | iPhone | Android |
|---|---|---|
| Widgets, Live Activity, Siri "next class" | yes | **no** — not part of level 2 |
| Back | — | the hardware / gesture Back closes what is on top; see below |
| Reminders | the same two: 90 minutes before a class, Mondays at 12:00 | the same, filed under two notification channels; they may arrive a few minutes late |
| Reminder wording | "open Psync for the live countdown" | no mention of a countdown (there is no Live Activity) |
| Calendar sync | events stamped Europe/London | the same events at the same instants, stamped with the phone's own zone |
| Share a stats or year card | an image | **text only** |
| Settings export, ICS export | a file through the share sheet, text as the fallback | text through the share sheet |
| Status bar | the page is drawn under it | a band of its own, coloured to the theme's ground |
| Launch screen | the mark and the wordmark | the mark alone |
| Rotating the phone | does nothing: portrait only | the same: the activity is locked to portrait |
| A waitlist place that became a seat | "in My Bookings (and your calendar/widget if you sync)" | "(and your calendar if you sync)" — there is no widget |
| The line under "Connect Psycle account" | "Works on iPhone and desktop." | "Works on your phone and on desktop." |
| Storage that survives a purge | the Preferences mirror | the same mirror (SharedPreferences); what it survives is the web view's storage being cleared |
| Backups | — | **off**: nothing the app stores goes into a Google backup or a phone-to-phone transfer. On a new phone you sign in again |
| Service worker | none | none (the files are in the app) |
| Haptics, the in-app browser, the first-run welcome, themes | yes | yes — the welcome's last page says "with reminders and calendar sync" |

## How Back works

Android's Back (the button, or the edge swipe) asks the page first. One press closes ONE thing, the top one, through
that thing's own Cancel, Back, Skip, Done or ×: a confirm dialog gets its **cancel button** (never its "yes"), a
sheet closes, a booking card's More menu folds, "Find similar" goes, the date calendar and the Filters panel close.
On any other tab with nothing open, Back goes to **Discover**. On Discover with nothing open, the app goes to the
background — alive, exactly like pressing Home. Back never closes the app for good, never books, never cancels a
booking, never joins or claims.

On the **first-run welcome** Back is the welcome's own **Back**: one page back. Only on its first page is it
**Skip**. The welcome is turned by swiping, and a swipe from the screen's edge is Android's Back gesture — so a
stray thumb turns a page back instead of ending the welcome for good.

A confirm dialog is answered **at once, whatever else is going on**: "Book this class?", "Book this spot?", "Join
the waitlist?" and "Claim this spot?" all get their "Not now". On three dialogs the cancel button is more than a
plain "no", and Back presses it all the same, exactly as a tap outside the dialog does:
- "Session expiring" → **"Book anyway"**: the booking carries on to the seat picker, or to the "Book this class?"
  confirm — which the next Back answers "Not now". Nothing is booked by Back.
- the same dialog before a usual-week review → **"Carry on"**: the review sheet opens; it books nothing by itself.
- "Offline booking" → **"Discard"**: the booking you queued while offline is dropped. It is never sent.

With no dialog up, while a booking, a cancel, a waitlist request or a spot swap is waiting on Psycle (a button
reading "…", "Swapping..." or "Cancelling…" in the seat picker), Back does nothing, so you are still there when the
answer lands — for a minute at most. On the sign-in page Back returns to the app. If the keyboard is up, Android
gives the first Back to the keyboard.

## Notifications

- Two channels appear under Android Settings → Apps → Psync → Notifications: **Class reminders** ("90 minutes
  before each class you hold") and **New dates** ("Mondays at 12:00, when Psycle opens new dates"). Each can be
  silenced on its own there. They are created the first time the app runs.
- On **Android 13 and later** the system asks "Allow Psync to send you notifications?" — but only after you say yes
  to Psync's own question, which comes after a first booking or after saving a usual week, never at launch. If you
  refuse the system prompt, the app says to enable notifications in Android Settings.
- **Reminders use inexact alarms.** The app does not ask for Android's "Alarms & reminders" special access, so the
  system may deliver a reminder a few minutes late, more so on a phone that is dozing. That is acceptable for
  "starts in 90 minutes" and "new dates are open". If a phone proves badly late, exact alarms are a small, known
  follow-up (agents/backlog.md).
- The small icon in the status bar is the mark (`ic_stat_psync`), tinted `#1B2130` in the shade.
- The Monday reminder is still eight one-off notifications at 12:00 London, re-armed at every launch. After a
  reboot the notifications plugin re-arms what was pending; nobody has watched it do so.
- **Another app on the phone can fake a notification tap** (the notifications plugin believes whatever starts the
  app with the right extras). Psync therefore ignores a "Snooze" it is handed on Android — it would have re-posted
  the faker's own words under Psync's name — and opens no class for an id that is not a number. A faked tap can at
  most switch the tab, open the sheet of a class you hold, or open the usual-week review. It cannot book or cancel.

## Calendar

- Android asks for calendar access the first time Settings → Calendar Sync is opened. The hand-over dialog ("Let
  Psync manage …?") and the reconcile are the iPhone app's, unchanged.
- **The zone stamp.** The iPhone app stamps each event Europe/London through a patch to the calendar plugin's Swift.
  The Android side of that plugin stamps the phone's own zone and cannot be told otherwise. The event still starts
  at the right instant wherever the phone is; only the zone a calendar app prints beside it differs. In London there
  is no difference.
- Android lists read-only calendars (Holidays, Birthdays) in the picker. Choosing one does no harm: creating an
  event there fails and nothing else happens.
- A Google calendar can keep a deleted event's row until its next sync. The bridge remembers what it deleted during
  a launch and ignores those rows, so a class cancelled and re-booked a moment later still gets its event. This was
  written from the plugin's source, not seen on a phone.

## What is NOT there

Widgets, the Live Activity, Siri, the `psync://` link the widgets use, an image share card, a wordmark on the launch
screen, exact-time alarms, Google backup of the app's data, and any store delivery. An Android widget ("level 3")
was not asked for and is not started.

## Building it yourself

You need: **Android Studio** (it installs the SDK; accept the prompt to install Android SDK Platform 35), a
**JDK 17**, and Node. The JDK matters: the project pins Gradle 8.2.1, which runs on Java 17 but not on the Java 21
that recent Android Studio releases bundle — install a JDK 17 and choose it as the Gradle JDK in Android Studio's
settings (for the command line, point `JAVA_HOME` at it). CI uses Temurin 17. Then, from the repository root:

```bash
cd ios-app
npm ci                  # needs the public npm registry: the lockfile resolves from registry.npmjs.org
npm run sync:android    # builds www/, then `cap sync android`: copies the web app and the plugin list into android/
npm run open:android    # opens ios-app/android in Android Studio — press Run with a phone (USB debugging) or an emulator
# or, without the IDE:
npm run android:debug   # sync:android, then ./gradlew assembleDebug → android/app/build/outputs/apk/debug/app-debug.apk
```

- `npm run sync:android` is not optional: the copied web assets and two generated config files are git-ignored, and
  Gradle cannot build without them. Run it again after any web or bridge edit.
- Android Studio will offer to upgrade the Android Gradle Plugin or Gradle. Decline: those versions belong to the
  Capacitor major (see the upgrade, below). `compileSdk 35` with AGP 8.2.1 is deliberate (`gradle.properties`
  silences the warning); `local.properties`, which Android Studio writes, is git-ignored.
- A Swift-only patch step (`patch-plugins.js`) runs on `npm ci`; it does nothing to Android.
- Do not commit a live-reload set-up (`server.url`, cleartext): tests/suites/19-android-project.js refuses it.

## Release

### 1. The keystore — create once, keep safe, NEVER commit

```bash
keytool -genkeypair -v -keystore psync-upload.jks -alias psync -keyalg RSA -keysize 2048 -validity 10000
```

Keep the file **outside the repository**, with its passwords in a password manager, and keep a second copy
somewhere else. (A current `keytool` makes a PKCS12 store, where the key's password IS the store's password: use
the same value for both below.) This repository is public: `*.jks`, `*.keystore`, `*.p12`, `*.pfx` and
`keystore.properties` are git-ignored at the root and in `ios-app/android/`, and a test fails if one is ever
tracked — but the safest keystore is one that was never inside the folder. In Play Console choose **Play App Signing**: Google then holds the app's
real signing key and yours is the *upload* key, which Google can reset if it is lost.

The build reads four values, from the environment or from `ios-app/android/keystore.properties` (the environment
wins):

| Environment variable | `keystore.properties` key | What |
|---|---|---|
| `PSYNC_KEYSTORE_FILE` | `storeFile` | path to the keystore (a relative path is read from `ios-app/android/`) |
| `PSYNC_KEYSTORE_PASSWORD` | `storePassword` | the store's password |
| `PSYNC_KEY_ALIAS` | `keyAlias` | `psync` above |
| `PSYNC_KEY_PASSWORD` | `keyPassword` | the key's password |

With any of the four missing the release build is left **unsigned** — it is never signed with the debug key — so a
half-configured machine cannot produce something that looks uploadable.

### 2. The bundle

Set `versionCode` (a whole number that must go up with every upload; never shown) and `versionName` (what a member
sees) by hand in `ios-app/android/app/build.gradle`. Then:

```bash
cd ios-app && npm run sync:android
cd android && ./gradlew bundleRelease     # → app/build/outputs/bundle/release/app-release.aab
```

### 3. The target-API requirement — this blocks a Play submission today

Capacitor 6 builds for the SDK level in `ios-app/android/variables.gradle`: `targetSdkVersion = 34` (Android 14).
Google Play only accepts new apps that target a recent API level, and raises the bar every year — since 31 August
2025 that has meant API 35 or higher; check the current figure on Google's "Target API level requirements" page.
So **a Play submission needs the Capacitor upgrade first**: `ios-app/UPGRADE-CAPACITOR-8.md`. That runbook was
written for the iPhone app before the Android project existed, has never been run, and has no Android steps yet;
it also changes the calendar plugin's call shapes. Do not simply raise `targetSdkVersion` by hand: from 35 Android
draws the app edge to edge and ignores the bar colours this project sets, and the plugins were not built for it.
**Sideloading the debug APK needs neither the upgrade nor a keystore.**

### 4. Play Console, in order

1. A Google Play developer account (a one-off fee). A new personal account must run a closed test before it may
   publish to production — Google has asked for at least a dozen testers over two weeks; check the current rule.
2. Create the app: name, default language, "App", "Free". Store copy, category and screenshots:
   `ios-app/PLAY_STORE_LISTING.md`.
3. **App content**: the privacy policy URL; ads — none; app access — booking and My Bookings need a Psycle
   sign-in, so give the reviewers instructions and test credentials; the content rating questionnaire; target
   audience — adults; the **Data safety** form (answers below and, as a table, in the listing file).
4. **Testing → Internal testing**: create a release, upload `app-release.aab`, accept Play App Signing, add
   testers by email. Internal testers usually get the build within minutes, with no review.
5. Production only after the on-device checklist below and a closed test.

### 5. Data safety — what the app stores and sends

The facts, from the code:
- The Psycle email and password typed on the sign-in page go **to Psycle's API and nowhere else**
  (`psycle.codexfit.com`; the sign-in page's content security policy allows no other host). The password is never
  stored. Psycle answers with a session token, which is kept on the phone: the app encrypts it (AES-GCM) as soon
  as it loads, and falls back to weaker storage only where the web view offers no cryptography.
- Everything else the app keeps — booking history, favourites, rankings, spot preferences, the usual week, settings,
  its own error and action logs — stays **on the phone**, and is excluded from Google backup and device transfer.
- The developer runs no server and receives nothing. **No analytics, no ads, no crash reporting, no third-party
  SDKs.** Requests go only to Psycle's API; instructor photos load from the addresses that API gives; a map, a
  Google Calendar link or an instructor's page opens in the in-app browser only when tapped.
- Calendar events and notifications are made on the phone. There is no push server.
- A bug report leaves the phone only when the member shares it themselves, through the share sheet.

Google's form counts data as "collected" when an app sends it off the device, whoever receives it, so the careful
declaration is: **collected — email address and the account sign-in, for app functionality / account management,
encrypted in transit, not optional; shared — none; no data sold; no advertising or analytics use.** Deletion: the
app holds no account of its own — signing out or uninstalling removes what is on the phone, and the Psycle account
is Psycle's to delete. The declaration is yours to make: read it against Google's definitions on the day.

### 6. The affiliation wording

Use it in the description, in the reviewers' notes and wherever Psycle is named:

> Psync is an independent companion for Psycle London members. It is not affiliated with, or endorsed by, Psycle.

Keep "Psycle" out of the app's NAME and icon (the reason is in `APP_STORE_LISTING.md`); naming Psycle in the
description as a statement of compatibility is normal practice.

## On-device checklist

Nobody could prove any of this without a phone. Tick it on a real Android phone and note the model and the Android
version; an emulator will do for much of it, but not for a synced Google calendar, real Doze or haptics. Where a
line fails, the app's own bug report (Membership → Settings → Bug report) says "Platform: android" and carries the
logs.

**Install and launch**
- [ ] The CI job `Android build check (debug APK)` is green, and `app-debug.apk` installs.
- [ ] The launch screen is the ground with the mark centred, in light AND in dark system mode (Android 12+: the
      system splash; older: the same picture). On Android 5.1 the ground alone is expected.
- [ ] No pale flash between the launch screen and the first paint in dark mode.
- [ ] The launcher icon looks right under the phone's icon shape; with themed icons on (Android 13+) the mark keeps
      its two tones and its grooves.
- [ ] The first-run welcome's last page reads "with reminders and calendar sync", and nothing in the app mentions
      widgets, Siri or an iPhone.
- [ ] With no signal the app still opens, and My Bookings shows the saved copy.

**Sign-in**
- [ ] "Connect Psycle account" opens the sign-in page inside the app; signing in works (the page is served from
      `https://localhost`, an origin Psycle's API has not been seen to answer before); Back from the sign-in page
      returns to the app.
- [ ] Close the app from the task switcher and open it again: still signed in.

**Back** — one press each time
- [ ] Closes, top layer only: the class sheet; the seat picker; a confirm dialog (it must answer **Cancel**); the
      Booked sheet; Settings; the diagnostics panel; the instructor profile; class history; the year review; the
      usual-week review sheet.
- [ ] The first-run welcome (Settings → "Show the welcome again" brings it back): on page two or later Back turns
      ONE page back; on the first page it skips. Swipe from the very edge of the screen on page two: a page back,
      and the welcome is still there.
- [ ] With "Book this class?" / "Book this spot?" / "Join the waitlist?" on screen — do NOT confirm — Back answers
      "Not now" at the first press, and the Book button reads "Book" again. (Reach one on a full class or a studio
      with no seat map; nothing is spent by opening the dialog.)
- [ ] Folds a booking card's More menu; closes "Find similar"; closes the date calendar; collapses the Filters
      panel.
- [ ] From My Bookings, Stats and Membership with nothing open → Discover. From Discover with nothing open → the
      home screen, and Psync is still in the task switcher where you left it.
- [ ] With the keyboard up, the first Back hides the keyboard only.
- [ ] The edge-swipe gesture behaves the same as the button.
- [ ] While a button reads "…" and no dialog is up, Back does nothing. After the answer has landed, wait two
      minutes, start another request and press Back during it: still nothing.
- [ ] Only if you are changing a spot anyway: during "Swapping..." Back leaves the seat picker open.
- [ ] With TalkBack or a keyboard: Back on the date calendar leaves focus on the calendar button; on the Filters
      panel, on the Filters bar; from another tab, on the Discover tab.

**Notifications**
- [ ] Android Settings → Apps → Psync → Notifications shows **Class reminders** and **New dates**, each with sound.
- [ ] Android 13+: the system prompt appears after the in-app "Remind me", not at launch; after "Don't allow" the
      app says to enable notifications in Android Settings.
- [ ] A class reminder arrives about 90 minutes before a held class; note how late. Its body names the instructor
      and the studio and says nothing of a countdown. Its icon is the mark.
- [ ] Its tap opens My Bookings and that class — from a running app and from a cold start.
- [ ] The Monday 12:00 reminder arrives (note how late), and its tap opens the usual-week review on the new dates —
      it must book nothing.
- [ ] Reminders still arrive after the phone has been restarted, and after a night untouched (Doze).
- [ ] For someone with `adb` — a faked tap, as another app could send one (the misspelt `LocalNotficationObject`
      is the plugin's own name for it). The command below opens Psync and schedules NOTHING: an hour later no
      notification titled "x" appears. With `SNOOZE` changed to `tap` and `\"extra\":{\"eventId\":\"__proto__\"}`
      added to the object, it lands on My Bookings and opens no sheet.

```bash
adb shell "am start -a android.intent.action.MAIN -n com.psyclefinder.app/.MainActivity --ei LocalNotificationId 1 --es LocalNotificationUserAction SNOOZE --es LocalNotficationObject '{\"id\":1,\"title\":\"x\",\"body\":\"y\"}'"
```

**Calendar**
- [ ] The permission prompt appears; the calendar list loads.
- [ ] The hand-over dialog counts the other events correctly; "Choose another" changes nothing; "Use this calendar"
      reconciles.
- [ ] A held class appears with two alerts, at the right time; cancelling removes it; cancelling and re-booking the
      same class within a minute leaves exactly ONE event — on a Google-synced calendar in particular.
- [ ] "Re-sync now" and "Remove duplicates" tell the truth. Picking a read-only calendar (Holidays) does no harm.

**Appearance**
- [ ] In each of the five themes the status bar is the theme's ground with readable glyphs, straight after a theme
      change too; the navigation bar is readable in light and dark system mode.
- [ ] Nothing of the page sits under the status bar or the navigation bar.
- [ ] Switch the system to dark while Psync is open (and back): the navigation bar follows, its buttons stay
      readable, and the page does not reload.
- [ ] Rotating the phone with auto-rotate on does nothing: Psync stays in portrait.
- [ ] Haptics fire on the taps that have them.

**Storage**
- [ ] Clear only the web view's storage — debug build, desktop Chrome → `chrome://inspect` → inspect → Application →
      Clear site data — then close and reopen the app: still signed in, settings and history back. (Android's own
      "Clear storage" wipes the mirror as well: signing in again after THAT is expected.)

**Share and links**
- [ ] Share on a booking opens Android's share sheet; dismissing it claims nothing.
- [ ] A stats card and a year card go out as text, with a truthful toast ("Shared" / "Share cancelled").
- [ ] Settings export, the ICS export and the bug report go out as text through the share sheet.
- [ ] Map, "Add to Google Calendar" and an instructor's Psycle page open in the in-app browser, and closing it
      returns to Psync.

**A real booking — at your own risk, or not at all**
- [ ] Only if you choose to, on your own account, for a class you mean to take: one booking, then read My Bookings.
      It spends a real credit. Nothing in the Android work touched the booking code, so this adds little that the
      iPhone app has not already shown; it is listed so that nobody does it by accident.

**Release, when the day comes**
- [ ] `./gradlew bundleRelease` signs with your keystore from the environment and from `keystore.properties`, and
      with neither it produces an unsigned bundle rather than failing or debug-signing.
- [ ] After "Clear storage", or on a second phone restored from a Google backup: Psync opens signed OUT.
