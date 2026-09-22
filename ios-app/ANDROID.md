# Psync for Android — the owner's guide

The Android app is the same app as the iPhone one: the same web layer (`ios-app/www/`), the same bridge
(`ios-app/www/native-bridge.js`), the same Capacitor 6, in a second native shell at `ios-app/android/`. (The folder
is still called `ios-app/`; that name is historical.) It is "level 2" — everything the iPhone app does **except the
widgets, the Live Activity and Siri** — plus "level 3": **one home-screen widget**, "Next class"
([The widget](#the-widget)).

**Where it stands — read this first.** Compiled, and launched on an emulator; not yet seen on a phone. It was
written without an Android toolchain (no JDK, no SDK), by reading, and then compiled by CI's `android-build` job and run on an emulator by `android-smoke`:
it launches into the first-run welcome, one Back key skips the welcome and leaves the app alive on Discover, the log shows no crash or script error, and natively the bridge created its two channels, set the status-bar colour and read its mirrored keys through Preferences. That run never taps: signing in, booking,
a reminder firing, a calendar write and the share sheet have not happened anywhere.
**The widget has been compiled by CI's `android-build` job, which first ran its 45 JVM tests against the real org.json (all pass), and drawn on an emulator by `android-smoke`: the debug preview rendered the widget's own RemoteViews in nine states — compact and wide, day and night, intensity off, a narrow and the smallest box, large type, four seats, empty — with no crash and no preview error in the log, and every one was looked at: the time leads, the card wears the class tint, the pictogram tile and the seat badge are drawn in the class colour, night picks the dark literals, large type keeps every row whole (a long class name ends in an ellipsis), four seats read "4 bikes", and the empty card says "Nothing booked" and names nobody.** Nobody has put it on a
home screen: the picker, a real launcher's sizes, the corner clipping, the roll-over alarm on a sleeping phone and
the tap are in the checklist below.
**The class countdown — the silent notification that stands in for the iPhone's Live Activity — has been
compiled by CI's `android-build` job, which first ran all 81 JVM tests against the real org.json (36 of them the countdown's; all pass), and POSTED on an emulator by `android-smoke`: Android's own record (`dumpsys notification`) shows one notification, id 7090, tag `psync-countdown`, on the channel `class-countdown` at importance LOW with no sound, vibration or badge, flags ongoing + only-alert-once, the class colour, a count-down chronometer and a timeout equal to the time left; its private version reads "RIDE 45" / "Shoreditch · Bike 9" and its PUBLIC version only "Next class" and the time; the shade screenshot shows it under "Silent" counting down; and after the class was marked started the app had no notification left.** On a phone, nobody has seen it: its section of the checklist is its proof.
GitHub Actions is the compiler:
the `android-build` job builds a debug APK on every push to `main` or to an `android/…` branch. What only a phone
can prove is the [on-device checklist](#on-device-checklist) at the end, and none of it is ticked.

| Leg | System | Trigger | What it does |
|-----|--------|---------|--------------|
| Compile + debug APK | GitHub Actions, job `android-build` (`.github/workflows/ci.yml`) | push to `main` or `android/**`, or "Run workflow" | `npm ci`, `npm run sync:android`, the JVM unit tests — the widget's snapshot rules and the countdown's plan (`./gradlew :app:testDebugUnitTest` — a failure stops the job before any APK exists; report: **`android-unit-test-report`**), a check that the countdown's tests really ran, `./gradlew assembleDebug`; uploads the artifact **`psync-debug-apk`** (kept 30 days); then an advisory Android lint |
| Emulator smoke (advisory) | GitHub Actions, job `android-smoke` | push to `android/**`, or "Run workflow" | installs that APK on a phone-sized emulator, opens it, screenshot, ONE Back key, screenshot; then opens the debug-only widget preview nine times (compact, wide, wide at night, class colours off, empty, four seats, two seats on the narrowest card, the smallest card, a long class name with a larger system font) and keeps a picture of each; then POSTS THE COUNTDOWN for real — it grants the notification permission with `adb`, has a debug-only hook put a made-up class 40 minutes ahead, reads the posted notification back from the system (its channel, silent, ongoing, counting down, private with a public version, and the timeout that removes it at the start), photographs the open notification shade, then seeds a class that has started and checks the notification is gone; uploads **`android-smoke`** (twelve pictures, three logs, the notification dumps and a process id, for a person to read). It fails — as a warning, never the workflow — when the app did not survive Back, crashed, logged a widget the preview could not draw, or the countdown was not posted as it should be or did not go. It never taps, so it can book nothing |
| Release | you, by hand | — | a signed bundle from your own keystore, uploaded by you in Play Console. Nothing about Android is wired to a store. The bundle is built on your machine, or by the MANUAL workflow **Android release (signed AAB)**, which reads the keystore from four repository secrets that only you can create — until you do, no key lives in GitHub. The runbook: [PLAY_STORE_DEPLOY.md](PLAY_STORE_DEPLOY.md) |

The iPhone pipeline is untouched: `npm run sync` (what Xcode Cloud runs) is still iOS-only, no npm package and no
Capacitor plugin package was added for Android's sake (the widget's three plugins are Java classes inside
`ios-app/android/`), and no Swift changed.

## Try it with nothing installed

1. On github.com open the repository → **Actions** → the newest **CI** run on `main` with a green **Android build
   check (debug APK)** job. (The widget is on the `android/widget` branch until it is merged: an APK that has it
   comes from a green run on that branch.) You must be signed in to GitHub to download artifacts.
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
| Home-screen widget | small and medium | **one**, "Next class": a compact and a wide layout, chosen by its width — [The widget](#the-widget) |
| Lock Screen widgets, Live Activity, Siri "next class" | yes | **no** |
| A tap on the widget | opens `psync://bookings?event=<id>` | no link is opened: an explicit intent to the app, with the class id beside it — the same landing (My Bookings, then that class) |
| What keeps the widget current | a WidgetKit timeline | a repaint whenever bookings change and whenever the app starts, one inexact alarm — a minute after the shown class starts, or just after midnight if that comes first — and Android's own half-hourly update |
| The widget after a light / dark flip | at once | at once from Android 12; on older phones at its next repaint, half an hour at most |
| Back | — | the hardware / gesture Back closes what is on top; see below |
| Reminders | the same two: 90 minutes before a class, Mondays at 12:00 | the same, filed under two notification channels; they may arrive late (usually minutes — "Notifications" below) |
| The countdown before a class | a Live Activity on the Lock Screen, which a tap on the reminder starts | ONE silent notification that counts down by itself, from 90 minutes before the class until it starts — see "The class countdown" |
| Reminder wording | "open Psync for the live countdown" | who and where, and no more: there is nothing to tap for — the countdown arrives by itself |
| Calendar sync | events stamped Europe/London | the same events at the same instants, stamped with the phone's own zone |
| Share a stats or year card | an image | **text only** |
| Settings export, ICS export | a file through the share sheet, text as the fallback | text through the share sheet |
| Status bar | the page is drawn under it | a band of its own, coloured to the theme's ground |
| Launch screen | the mark and the wordmark | the mark alone |
| Rotating the phone | does nothing: portrait only | the same: the activity is locked to portrait |
| The line under "Connect Psycle account" | "Works on iPhone and desktop." | "Works on your phone and on desktop." |
| Storage that survives a purge | the Preferences mirror | the same mirror (SharedPreferences); what it survives is the web view's storage being cleared |
| Backups | — | **off**: nothing the app stores goes into a Google backup or a phone-to-phone transfer. On a new phone you sign in again |
| Service worker | none | none (the files are in the app) |
| Haptics, the in-app browser, the first-run welcome, themes | yes — the welcome's last page says "with widgets and reminders on iPhone" | yes — it says "with a widget and reminders" |

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
  silenced on its own there. They are created the first time the app runs. A third, **Class countdown**, appears the
  first time a countdown is shown: silent by design ("The class countdown", below).
- On **Android 13 and later** the system asks "Allow Psync to send you notifications?" — but only after you say yes
  to Psync's own question, which comes after a first booking or after saving a usual week, never at launch. If you
  refuse the system prompt, the app says to enable notifications in Android Settings.
- On **Android 12 and earlier** the system has no notification permission, so there is nothing to ask and Psync's
  own question never appears: class reminders AND the countdown are on from your first booking, until you switch
  **Class reminders** off (Membership → Settings) or silence a channel in Android's settings. Nobody was asked,
  and the privacy policy says so. Whether the app should ask there all the same is the owner's to decide
  (agents/backlog.md). The Monday reminder is different: it is off until you say yes to it, on every version.
- **Reminders use inexact alarms.** The app does not ask for Android's "Alarms & reminders" special access, so the
  system may deliver a reminder late: usually by minutes, more so on a phone that is dozing — and from Android 12
  the system is ALLOWED to hold such an alarm for up to an hour (the notifications plugin arms it; the window is
  Android's). That is acceptable for "new dates are open"; for "starts in 90 minutes" the checklist asks you to
  note how late it really is. If a phone proves badly late, exact alarms are a small, known follow-up
  (agents/backlog.md).
- The small icon in the status bar is the mark (`ic_stat_psync`), tinted `#1B2130` in the shade.
- The Monday reminder is still eight one-off notifications at 12:00 London, re-armed at every launch. After a
  reboot the notifications plugin re-arms what was pending; nobody has watched it do so.
- **Another app on the phone can fake a notification tap** (the notifications plugin believes whatever starts the
  app with the right extras). Psync therefore ignores a "Snooze" it is handed on Android — it would have re-posted
  the faker's own words under Psync's name — and opens no class for an id that is not a number. A faked tap can at
  most switch the tab, open the sheet of a class you hold, or open the usual-week review. It cannot book or cancel.

## The class countdown

The iPhone app shows a Live Activity before a class. Android has no such thing, so the Android app shows **one
silent notification** instead: from 90 minutes before your next held class until it starts.

- **What it shows:** the class as its title, the place and your seat under it ("Shoreditch · Bike 9"), and the
  system's own countdown to the start. It makes no sound, does not vibrate and does not pop up over what you are
  doing: it sits in the notification shade. A tap opens that class in My Bookings, exactly as the widget's tap does.
- **On a locked phone** that hides private content it says only "Next class" and the time — never the class, the
  place or your seat.
- **There is only ever one.** With two classes inside 90 minutes it shows the first, and the second takes over when
  the first starts. It is not the 90-minute class reminder: that one still arrives, with its sound, as before.
- **It goes by itself** when the class starts (from Android 8 the system removes it, even if Psync is not running),
  when you cancel the class, and at once when you sign out. A session that merely expired leaves it, as on the
  iPhone: the class is still yours.
- **If you swipe it away, it stays away** — for that class. Android 14 and later let you dismiss it (before that an
  ongoing notification cannot be swiped). A swipe is taken as your answer for that class at that time: opening the
  app, a booking change or the widget's own updates do not put it back. If the class MOVES, or when the next class
  comes inside its 90 minutes, that is another countdown, and it shows.
- **After a restart** of the phone it comes back without Psync being opened: a restart clears every notification,
  and Android tells Psync when the phone has started. (A phone whose maker adds an "auto-start" switch may hold that
  back until the app is next opened.) The same goes for an update of the app, which removes its notifications, and
  for a change of the phone's time zone or clock, which moves the moment the countdown runs to: Android tells Psync
  of each, and the countdown is put right without the app being opened.
- **After installing a build that first has the countdown**, nothing counts down until Psync has been opened once:
  the countdown follows Class reminders, and only the app itself can say whether those are on.
- **Switching it off.** It follows **Class reminders** (Membership → Settings): off there, no countdown. To keep
  the reminders and lose only the countdown, silence or switch off the channel **Class countdown** under Android
  Settings → Apps → Psync → Notifications. The other two channels are untouched.
- **It never asks for anything.** On Android 13 and later it uses the notification permission you gave for
  reminders; on Android 12 and earlier there is no such permission, and it is simply on with them ("Notifications",
  above). If notifications are refused it simply does not appear; once you allow them it appears by itself — at the
  latest at the next booking change or the next time Psync is opened. It needs no "Alarms & reminders" access and
  runs no background service.
- **It may appear up to about ten minutes late.** It wakes on an inexact alarm with a ten-minute window — the
  shortest Android allows an app that has no "Alarms & reminders" access — which does not wake a sleeping phone: a
  countdown is only ever seen on a phone that is awake, so a dozing phone is not woken to post one; it is posted
  when the phone next wakes. From Android 8 it ENDS on time all the same, because the system removes it at the
  start. On Android 7 and below there is no such timeout: on a phone that is awake it can stay for up to about ten
  minutes past the start, and on a sleeping one until it next wakes. Below Android 7 the system cannot count down
  either: the text opens with the start time instead.
- **Times are the phone's own**, as the widget's are. In the UK that is the class's time.
- **What proves it:** its rules are 36 unit tests that CI runs before it builds the APK, and CI's emulator posts the
  real notification and reads it back (the table at the top); both have run and passed ("Where it stands").
  On a phone, nobody has seen it: the checklist below is its proof.

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

## The widget

One home-screen widget, **Next class**, in the look of the iPhone one. To add it: long-press an empty part of the
home screen → **Widgets** → **Psync** → drag **Next class** out. It arrives two cells by two and can be resized both
ways.

- **What it shows.** The day word ("Today", "Tomorrow", else "Thu 24"), the TIME in 24-hour digits as the hero, the
  class type's pictogram in a tile, the class name and your seat ("Bike 9", "Bikes 5 & 6", "Bed 4"). More seats than
  the badge has room for are counted — "4 bikes" — rather than cut off; a screen reader names them all. The card wears
  that class's colour at the strength chosen in Membership → Class colours: Soft and Bold tint the whole card; Off
  leaves the card neutral, with colour only in the tile and the seat badge. A studio with no seat map gets no badge.
  A waitlist place is never shown, and neither is a class that has started.
- **Two layouts, chosen by its width.** Compact (about two cells): day, time, class name, seat. Wide (from about four
  cells — 250dp): the same, plus "Instructor · Place" and up to two following classes as one-line rows ("Tomorrow
  07:30" and the class name, a long name cut to its head: "REFORMER PILATES"). A short widget — or a large system
  font, which makes every line but the time taller — gives way from the class name down: one line instead of two
  (a long name then prints as its head, whole, never cut mid-word), smaller digits, fewer rows. The seat is the
  last thing to go. Anything that still does not fit ends in an ellipsis: nothing is cut out of sight.
- **"Nothing booked"** is all the empty state says — with nothing booked, signed out, or before the app was ever
  opened. The widget never says who is signed in, or whether anyone is. It says so only once it has READ what the
  app stored: until its first paint — straight after it is added, and after a restart, which on a phone that lets
  no app start by itself can last until Psync is opened — the card shows the word "Psync" and nothing else.
- **Where its data comes from.** The same snapshot the iPhone widget reads: whenever bookings change, the bridge
  writes three small JSON strings — the next class, the next five, and a count per day of the week ahead. On the
  iPhone a Swift plugin puts them in the App Group; on Android a plugin of the SAME name, written in Java inside the
  app, puts them in one private preferences file that the widget reads. Two more such twins repaint the widget and
  hand a tap to the page. No package, no Capacitor plugin and no Swift was added for it, and the file is kept out of
  backups like everything else the app stores.
- **How it stays current.** The app repaints it after every change to your bookings and to your class colours, and
  every time it starts (so a widget is never left showing a class over storage that was cleared). It arms ONE
  inexact alarm: for a minute after the shown class starts, so it moves on to the next class by itself — or for
  just after midnight if that comes first, when "Tomorrow" has become "Today". On a phone that is awake the alarm
  may be up to about ten minutes late (its window: the shortest Android allows without "Alarms & reminders"
  access); a sleeping phone is not woken for it, so it catches up when the phone next wakes. Android's own update, every 30 minutes, is the backstop — and the
  only thing that notices a changed clock or time zone. Every repaint reads the stored snapshot again and drops
  what has started.
- **Times are the phone's own.** "18:30" prints exactly as Psycle wrote it, but WHEN a class counts as started is
  judged on the phone's clock in the phone's zone — as on the iPhone widget, and by the owner's decision. In London
  there is no difference.
- **A tap** anywhere on it opens Psync on My Bookings and then that class's sheet, while the seat is still held;
  on "Nothing booked" it opens My Bookings. No link is opened and the app answers no URL scheme: the tap is an
  explicit intent to the app carrying the class id. Another app on the phone can send the same intent with an id of
  its own making, so the id is kept only if it is 1 to 12 digits, and the page judges it again. A forged tap can at
  most show My Bookings and the sheet of a class you hold. It cannot book or cancel.
- **Signing out empties it**, at once, exactly as on the iPhone: the same sign-out pass writes an empty snapshot and
  asks for one repaint. A session that merely EXPIRED does not: those classes are still booked, so the widget keeps
  showing them until you sign in again.
- **The typeface.** The time is set in Android's own condensed bold face (`sans-serif-condensed`). The app's Sofia
  Sans Condensed ships as a web font (woff2); a widget would need it as an Android font resource, and nothing in this
  repository converts one — so no font file ships.
- **Light and dark.** The snapshot carries each class's colours for both. From Android 12 the launcher is handed
  both and flips by itself; on older phones the widget catches up at its next repaint — half an hour at most.
- **Not there:** no Lock Screen widget, no Siri, no count of the week, no settings screen of its own. (What stands
  in for the Live Activity is not part of the widget: "The class countdown", below.)

For someone with `adb` and a DEBUG build, the widget can be drawn without a launcher — this is what CI photographs.
The activity exists in debug builds only and shows built-in sample classes with made-up names; it reads nothing the
app stores, and only `adb` can start it (it asks its caller for a permission that the adb shell holds and no
installed app can — the debug APK is also the one you sideload):

```bash
adb shell am start -S -W -n com.psyclefinder.app/.WidgetPreviewActivity --es size wide --es night 1 --es sample two
# sample: one | two | four | spaces | long | bold | off | neutral · size: compact | wide · night: 0 | 1 · empty: 1
# width, height: the card in dp (a width the screen has no room for is drawn narrower, and the caption says so)
# a larger font: adb shell settings put system font_scale 1.3   (and 1.0 to put it back)
```

## What is NOT there

Lock Screen widgets, the Live Activity itself (a silent notification stands in for it: "The class countdown"), Siri, a `psync://` URL scheme (the
widget's tap is an explicit intent; no link is ever opened), an image share card, a wordmark on the launch screen,
exact-time alarms, Google backup of the app's data, and any store delivery.

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
npm run android:test    # sync:android, then ./gradlew :app:testDebugUnitTest — the widget's snapshot rules, on the JVM (no phone, no emulator)
```

- `npm run sync:android` is not optional: the copied web assets and two generated config files are git-ignored, and
  Gradle cannot build without them. Run it again after any web or bridge edit.
- Android Studio will offer to upgrade the Android Gradle Plugin or Gradle. Decline: those versions belong to the
  Capacitor major (see the upgrade, below). `compileSdk 35` with AGP 8.2.1 is deliberate (`gradle.properties`
  silences the warning); `local.properties`, which Android Studio writes, is git-ignored.
- A Swift-only patch step (`patch-plugins.js`) runs on `npm ci`; it does nothing to Android.
- Do not commit a live-reload set-up (`server.url`, cleartext): tests/suites/19-android-project.js refuses it.

## Release

**The full runbook is [PLAY_STORE_DEPLOY.md](PLAY_STORE_DEPLOY.md)**: the two preconditions (the target API level
and the policy risk), the developer account, the upload key, the manual release workflow and its four secrets,
every Play Console form in order, the testing tracks, the first release and the later ones, and a one-page
checklist. What follows here is the short version of the key, the build and the data the app handles.

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

Or let GitHub build it: the manual workflow **Android release (signed AAB)**
(`.github/workflows/android-release.yml`) runs only when you press its button, only from `main`, reads the
keystore and its passwords from four secrets you create in a `main`-only `play-release` environment, fails — and
says which — if one is missing,
proves the bundle is signed by your key, and keeps the `.aab` as an artifact for 5 days. It uploads nothing to
Google. Setting it up, and what you are trusting when you do: `PLAY_STORE_DEPLOY.md`, step 4b.

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
3. **App content**: the privacy policy URL (the page is `privacy.html` at the repository root, published with the
   web app — `PLAY_STORE_DEPLOY.md`, step 5.3); ads — none; app access — booking and My Bookings need a Psycle
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
  its own error and action logs, the widget's copy of your next classes — stays **on the phone**, and is excluded
  from Google backup and device transfer.
- The developer runs no server and receives nothing from the app. **No analytics, no ads, no crash reporting — no
  SDK of that kind.** The app IS built with other people's code: the open-source Capacitor framework and its
  plugins, and Google's AndroidX libraries; they run on the phone and contact no one. (Play Console's vitals and
  pre-launch report come from Google, from people who share diagnostics with Google: the app adds nothing to
  them.) Requests go only to Psycle's API; instructor photos load from the addresses that API gives; a map, a
  Google Calendar link or an instructor's page opens in the in-app browser only when tapped.
- Calendar events and notifications are made on the phone. There is no push server. Calendar sync READS the coming
  events of every calendar on the phone to find its own (the plugin has no calendar filter); none of it leaves the
  phone. On Android 12 and earlier there is no notification permission, so reminders and the countdown need no
  yes ("Notifications", above).
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
- [ ] The first-run welcome's last page reads "with a widget and reminders", and nothing in the app mentions
      a Lock Screen widget, a Live Activity, a "live countdown" to tap for, Siri or an iPhone.
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
      and the studio and asks for no tap. Its icon is the mark.
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

**The class countdown** — written by reading; CI compiles it, tests its rules and posts one on its emulator; never yet seen on a phone
- [ ] Book (or already hold) a class that starts within 90 minutes: a silent **Psync** notification appears by
      itself — no sound, no vibration, no pop-up over what you are doing — with the class as its title, the place
      and your seat under it, and a countdown that ticks down in the header. Its small icon is the mark, tinted in
      the class's colour. Note how the countdown reads with more than an hour to go.
- [ ] With the app CLOSED and a class more than 90 minutes away — booked HOURS before, in the morning for the
      evening — it appears by itself about 90 minutes before the class. Note how late: on a phone that is awake it
      should be at most about ten minutes (an inexact alarm with a ten-minute window); it does not wake a sleeping
      phone. Anything like an hour late is a bug: report it.
- [ ] At the class's start it goes by itself — with the app closed too, with the phone asleep on the table, and
      with battery saver on. It never counts up past zero. (Android 8+: the system removes it. On Android 7 and
      below it goes within about ten minutes on a phone that is awake, else when the phone next wakes — note how
      long it outstays the start.)
- [ ] Open and close the app a few times inside the 90 minutes (each time re-posts it, silently): it still goes at
      the start, not later.
- [ ] On the lock screen, with "sensitive content" hidden, it reads "Next class" and the time — no class, no place,
      no seat. With sensitive content shown it reads as in the shade.
- [ ] It cannot be swiped away on Android 13 and below. On Android 14+ swipe it away: it STAYS away for that class
      — open and close Psync, change another booking, wait half an hour with a widget on the home screen: it does
      not come back. Then book a second class inside 90 minutes of the first's start: when the first starts, the
      second's countdown appears (nobody dismissed that one).
- [ ] Its tap opens My Bookings and that class — from a running app and from a cold start — and the notification
      is still there afterwards. The WIDGET's tap still opens its class too.
- [ ] Cancel the class: it goes at once. Book another inside 90 minutes: it comes back for that one. There is
      never more than ONE.
- [ ] Two classes inside 90 minutes: the FIRST is shown; when it starts, the second takes over.
- [ ] Sign out: it goes at once. Let a session merely expire: it stays, as the widget's classes do.
- [ ] Membership → Settings → Class reminders OFF: it goes at once. ON again: it comes back. The row reads
      "90 minutes before each class — with a countdown notification".
- [ ] Android Settings → Apps → Psync → Notifications shows a third channel, **Class countdown**, silent. Switch
      it off: no countdown, and class reminders still arrive.
- [ ] With notifications refused for Psync: no countdown, and Psync does NOT ask because of it. Allow them through
      the app's own "Remind me": the countdown appears — at the latest at the next booking change or app start.
- [ ] Restart the phone inside the 90 minutes: it comes back without the app being opened. On a phone with an
      "auto-start" or "background activity" switch for apps, note whether it needs that switch.
- [ ] Install a newer build over this one inside the 90 minutes (`adb install -r`), without opening it: the
      countdown, which the update removed, comes back by itself.
- [ ] A phone on **Android 12 or earlier**, if you have one: after a first booking the 90-minute reminder and the
      countdown arrive WITHOUT any question having been asked (there is no notification permission to give).
      Expected, and said in the privacy policy — note whether it feels right; the alternative is in
      agents/backlog.md. Class reminders OFF stops both.
- [ ] Installed over a build that had no countdown (or after Settings → Apps → Psync → Clear storage and signing in
      again): nothing counts down until Psync has been opened once; after that it appears by itself.
- [ ] Android 7 and below, if you have such a phone: the header shows the start as a time of day, and the text
      opens with it — "18:30 · Shoreditch · Bike 9".
- [ ] The 90-minute class reminder still arrives as before, with its sound — the countdown has not replaced it.
- [ ] Abroad (or with the phone's zone changed): it counts down to the phone's own reading of the time, as the
      widget does. Expected, by decision — note it, do not report it. Change the zone WHILE a countdown is up, with
      Psync closed and no widget placed: within a moment the countdown runs to the new reading (or goes, if the
      class is now more than 90 minutes away, or has "started").

**Support Psync (the optional tips)** — compiled by CI, never seen on a phone. It needs the three products in Play
Console and a licence-tester account (`PLAY_STORE_DEPLOY.md`, step 5.11).
- [ ] Before the products exist: Membership shows NO "Support Psync" section.
- [ ] With them: three rows, cheapest first, each with Play's own price. A tap opens Play's payment sheet; the rows
      are greyed while it is up.
- [ ] Pay as a licence tester: "Thank you. Your tip went through." The same tip can be given again straight away
      (it was consumed).
- [ ] Close the sheet instead: nothing is said, and nothing is charged.
- [ ] A slow test card ("pending"): "Thank you. Your tip is waiting for approval." Open the app again after Play
      approves it: nothing more is asked of you.

**Calendar**
- [ ] The permission prompt appears; the calendar list loads.
- [ ] The hand-over dialog counts the other events correctly; "Choose another" changes nothing; "Use this calendar"
      reconciles.
- [ ] A held class appears with two alerts, at the right time; cancelling removes it; cancelling and re-booking the
      same class within a minute leaves exactly ONE event — on a Google-synced calendar in particular.
- [ ] "Re-sync now" and "Remove duplicates" tell the truth. Picking a read-only calendar (Holidays) does no harm.

**The widget** — compiled, tested and drawn in nine states by CI; never yet put on a home screen
- [ ] Long-press the home screen → Widgets → Psync: **Next class** is listed, with a sample card as its preview on
      Android 12+ (the app icon on older pickers). Dragged out, it arrives two cells by two and PAINTS — not
      "Problem loading widget", not "Nothing booked" while you hold a class, and not a card that says only "Psync"
      for more than a moment. (The widget's receiver is deliberately NOT exported: Android's own widget service
      reaches it regardless. A card stuck on "Psync" on your launcher is the one thing that would say otherwise.)
- [ ] With a class held: the day word, the time in 24-hour digits, the pictogram tile, the class name and the seat
      badge, in that class's colour. "18:30" is not clipped; a long class name takes two lines and is not cut
      mid-word; the badge is exactly the size of its words.
- [ ] With THREE or FOUR seats booked in one class: the badge names them all where there is room (the wide
      layout) and says "4 bikes" where there is not (two cells) — never a list that stops short. Anything that
      does not fit anywhere ends in "…".
- [ ] Stretch it to four cells wide: the wide layout — "Instructor · Place" and up to two following classes. Note
      what three cells gets on your launcher (wide starts at 250dp). Make it shorter: rows drop away first, then the
      name goes to one line; nothing overlaps.
- [ ] Make the two-cell widget ONE row tall, if your launcher allows it: the seat badge is whole — its pill not
      shaved flat at the bottom — with smaller digits above it, and a long class name reads as its head
      ("REFORMER PILATES"), not "REFORMER PIL…". The heights the widget plans by are sums nobody has measured.
- [ ] Settings → Display → Font size at its largest, then look at the widget again at each size: the seat badge
      is still whole. (On a one-row widget at the very largest font it may not be: note what is cut.)
- [ ] Book or cancel in the app, then press Home: the widget already shows the new next class.
- [ ] Membership → Class colours → Off, Soft, Bold, then Home each time: Off is a neutral card with colour only in
      the tile and the badge; Soft and Bold tint the card; text stays readable on every class type you hold.
- [ ] System dark mode on, then off: on Android 12+ the widget follows at once, and its corners match the
      launcher's other widgets; below Android 12 note how long it takes (half an hour at most).
- [ ] Between one and about eleven minutes after a held class starts, the widget moves to the next class — or to
      "Nothing booked" — by itself. Note how late, and whether it had caught up when you woke a sleeping phone.
- [ ] With a class booked for tomorrow morning, look at the widget shortly after midnight: "Today", not
      "Tomorrow". Note how late the word changed, and whether it was right when you woke the phone in the morning.
- [ ] Tap it with Psync swiped away from the task switcher (a cold start), and again with Psync in the background:
      both land on My Bookings with that class's sheet open. Tap "Nothing booked": My Bookings, no sheet.
- [ ] After a widget tap, leave Psync, open it again from the task switcher an hour later: no sheet opens by itself.
- [ ] Sign out in the app, press Home: "Nothing booked", at once. Sign in again: the class is back.
- [ ] Restart the phone and do not open Psync: what does the card say before its first paint ("Psync" alone is
      right; "Nothing booked" while you hold a class is not), and for how long? Then it shows the class, and still
      rolls over after it starts.
- [ ] Settings → Apps → Psync → Storage → Clear storage, with a class on the widget: open Psync once (you are
      signed out) and press Home — the widget says "Nothing booked", not the class it showed before.
- [ ] On a launcher other than the phone's own (another phone, or an installed launcher): it can be added, paints,
      and resizes between the two layouts.
- [ ] With TalkBack: the widget reads as one item, "Next class: Today 18:30, RIDE 45, …, Bike 9".
- [ ] For someone with `adb` — a forged tap, as another app could send one. It must land on My Bookings and open
      NO sheet:

```bash
adb shell "am start -n com.psyclefinder.app/.MainActivity -a com.psyclefinder.app.widget.OPEN --es com.psyclefinder.app.widget.EVENT_ID '12;drop'"
```

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
- [ ] The manual workflow **Android release (signed AAB)**: with a secret missing it fails at once and names it;
      with all four it ends green, and its summary shows the SHA-256 fingerprint of YOUR upload certificate.
- [ ] After "Clear storage", or on a second phone restored from a Google backup: Psync opens signed OUT.
