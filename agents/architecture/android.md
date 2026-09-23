# Android — how the Android app differs from the iPhone app: Back, notification channels, the status bar, backups off, the home-screen widget, the class countdown, what is absent, how it is built and proved
Read this when you touch ios-app/android/, an `IS_ANDROID` branch of ios-app/www/native-bridge.js, the widget snapshot or a plugin the bridge finds by name, `window._psycleAndroidBack` (js/app.js, login.html) or the Android jobs of .github/workflows/ci.yml. Skip it for web-only or iPhone-only work. Related: [ios.md](ios.md) (the bridge both apps run), [testing-and-ci.md](testing-and-ci.md) (CI). The owner's guide — install, release, the on-device checklist — is [../../ios-app/ANDROID.md](../../ios-app/ANDROID.md).

## What it is
- "Level 2", in the owner's words: everything the iPhone app does EXCEPT the widgets, the Live Activity and Siri. Then "level 3": ONE home-screen widget, "Next class" — "The home-screen widget" below. Then, asked for by name ("Go ahead with the countdown notification too"), ONE silent notification in the Live Activity's place — "The class countdown" below. No Lock Screen widget, no Live Activity itself, no Siri ([../decisions.md](../decisions.md) section 8).
- One Capacitor 6 project, two platforms: ios-app/android/ wraps the SAME ios-app/www/ as the iPhone app (`webDir: "www"`, `appId` com.psyclefinder.app) and loads the SAME ios-app/www/native-bridge.js. The folder name ios-app/ is historical and stays. The page is served from `https://localhost` inside the web view (`server.androidScheme`).

### The iPhone app must not change
- **The iPhone app must not change.** No new npm package, no new Capacitor plugin (a plugin is an iOS pod), no Swift edit; `npm run sync` — what Xcode Cloud runs — is still iOS-only. Guard: 18-android.js (`IPHONE_LAUNCH_DIGEST`: the iPhone path's plugin calls for one launch, hashed at the commit before the Android work) and 19-android-project.js (the scripts, the lockfile).

### Status of the Android app
- **Status: compiled, not seen on a device.** Written without an Android toolchain (no JDK, no SDK), then compiled by CI's `android-build` job and run on an emulator by `android-smoke`: it launches into the first-run welcome, one Back key skips the welcome and leaves the app alive on Discover, the log shows no crash or script error, and natively the bridge created its two channels, set the status-bar colour and read its mirrored keys through Preferences.

  Everything else — a tap, a sign-in, a notification firing, a calendar write, a real status bar in each theme — needs a phone: "Not verified" below.

  The widget has since been compiled, tested (its 45 JVM tests, against the real org.json) and drawn in nine states by the same two jobs.

  **The class countdown is newer than any run: read, not built** — no job has compiled its Java, run its 26 JVM tests or posted one on the emulator yet; the first push of its branch does all three.

## One bridge, two platforms
- The bridge reads `Capacitor.getPlatform()` once into `PLATFORM`; `IS_ANDROID` is `PLATFORM === 'android'`. `'ios'`, or a bridge that cannot say, takes the path the iPhone app always took — not one call more, not one field more.

### The tip jar on Android
- **The tip jar** (`PsycleTipJarPlugin.java` + the PURE `tips/PsyncTips.java` with its JVM tests; Play Billing Library 8, the ONE runtime dependency the app module adds — 19-android-project.js and 24-tip-jar.js both name it): the Android twin of the iPhone's `PsycleTipJar`, same name, same two methods → [ios.md](ios.md) → "Support Psync: the tip jar".

  A purchased tip is CONSUMED at once (consuming acknowledges; an unacknowledged purchase is refunded by Play after three days), only when EVERY product in the purchase is one of the three; one that could not be consumed is consumed on the next connection; the purchase token goes to `consumeAsync` and nowhere else.

  The Billing Library's own manifest adds `com.android.vending.BILLING`. Compiled by CI; a Play purchase sheet has never been seen (needs the products in Play Console and a licence tester: ../../ios-app/PLAY_STORE_DEPLOY.md step 5.11).

### Plugins reached by existence
- Every plugin is reached by EXISTENCE (`Capacitor.Plugins.X && …`). The iPhone app registers four of its own in Swift — `AppGroupPreferences`, `WidgetCenter`, `PsycleDeepLink`, `PsycleLiveActivity`. The Android app registers Java TWINS of the first three under the SAME names and method shapes, so the snapshot write, the ONE reload per pass and the widget-tap listener drive its widget with no Android branch ("The home-screen widget" below).

  `PsycleLiveActivity` has no twin and gets none: its refresh is skipped with nothing logged — as all four are in an Android app built before the twins (18-android.js still boots that one) — and what stands in its place is planned NATIVELY, from the `WidgetCenter` twin's reload ("The class countdown" below).

  `updateWidgetSnapshot` also arms the class reminders from the same walk, and still writes `widget_*` through Preferences, where nothing reads them.

### What IS_ANDROID guards
- `IS_ANDROID` guards only what Android ALONE has: `_ensureAndroidChannels` / `_forAndroid` (channels, small icon, tint), `StatusBar.setBackgroundColor` in `updateStatusBar`, the deleted-row filter in `_listNativeEvents`, what `handleNotificationAction` refuses of a tap that may be forged ("Notifications" below), the class countdown's switch (`_androidCountdownSwitch`, `_androidCountdownFlipped`: one more key through the `AppGroupPreferences` twin, "The class countdown" below), and three strings (`_classReminderBody`, the class-reminder ask's body, "Android Settings" in the Monday offer's toast).

### Platform checks in the web layer
- The web layer asks the platform itself, each time with its own small `getPlatform() === 'android'` test (the modules are IIFEs or sliced by suites, so there is no shared helper): `_swSkippedHere` and `_onboardPlatform` (js/app.js), `_reminderAndroid`, `_osSettingsWords` and `_shareAsTextOnAndroid` (js/tabs.js), `diagPlatform` (js/settings.js), and `getDiagnosticReport` (the bridge; it asks again because owner-tools.js runs it alone).

## Back
Without the @capacitor/app plugin Capacitor leaves Back to Android, which FINISHES the activity: one stray swipe would close the app under an open sheet. The plugin is not installed, by decision (a new plugin is a new iOS pod). The contract instead:

1. `MainActivity` (ios-app/android/app/src/main/java/com/psyclefinder/app/MainActivity.java) registers an enabled `OnBackPressedCallback` on the activity's dispatcher. On Back it evaluates `(window._psycleAndroidBack ? window._psycleAndroidBack() : false)` in the web view.
2. The page answers a strict boolean, at once. `true` = it dealt with the press. Anything but the JSON text `"true"` — `false`, `null`, a page still loading, no web view — and the activity calls `moveTaskToBack(true)`: the app goes to the background, alive, like Home. It never calls `finish()`. There is deliberately no timeout: a page whose JavaScript is hung never answers, and Back then does nothing.
3. `window._psycleAndroidBack` (js/app.js, just above the "PWA Service Worker" block — offline.js slices from there to the end of the file) reads the page (`_androidBackFacts`), asks `_androidBackDecision` (`pure:android-back`) and closes ONE layer, the top one, through the closer that layer already has:

### What each Back answer closes

| Answer | What closes, and how |
|---|---|
| `close-dialog` | a dialog with its own keys, topmost by z-index (`_androidBackDialog`): the first-run welcome → a click on its own `[data-onboard="back"]`, and on its `[data-onboard="skip"]` only from the FIRST page (`_androidBackWelcomeControl`); `confirmModal` → a click on `.confirm-btn-cancel`; the usual-week sheet → a real Escape `keydown` on `document` (its own close, which refuses during a run or a "Change spot") |
| `close-overlay` | the top of `_overlayStack` among the `_OVERLAYS` that are open → Escape on `document`, so THE keydown handler runs that overlay's real closer; the Booked sheet → `dismissBookingConfirmation()` |
| `close-popup` · `close-menu` | My Bookings' "Find similar" popup → Escape on the popup · a card's More menu → `closeBookingMore(true)` |
| `go-discover` | any other tab → `window.switchTab('discover')` (checked BEFORE the two below: they live on Discover) |
| `close-datepicker` · `collapse-filters` | `toggleDatePicker()` · `toggleFilters()` (below 1024px only); focus as under "Focus" below |
| `none` | `false`: the app goes to the background |

### Back is the safe answer
- **Back is the safe answer, always**: it presses a confirm's cancel button, turns the welcome back a page, closes a sheet. It never confirms, books, cancels a booking, joins or claims, and it sends no request.

### Back on the welcome
- **The welcome: its own Back first, Skip only from the first page.** Skip writes "welcome seen" for good; the welcome is turned by horizontal swipes, and a swipe that starts at the screen's edge IS Android's Back gesture — one stray thumb on page three must not cost a newcomer the rest. `_androidBackFacts` reads the page from `_onboardIdx`.

### What a confirm's cancel means
- **What "no" means is the dialog's own business**, as it is for Escape and a tap outside it. On three confirms the cancel button is not "leave it all as it was": "Session expiring" → "Book anyway" (`bookClass`) carries on — to the seat picker, or to the confirm that does spend, which the next Back answers "Not now"; its usual-week twin → "Carry on" (js/tabs.js) opens the review sheet, which books nothing by itself; "Offline booking" → "Discard" (js/reliability.js) drops the queued booking, which is never sent.

  None of them books, and those functions are spend paths the Back work did not touch. 18-android.js runs the shipped `bookClass` to hold the first, and fails when a fourth such label appears in the app without being written down here.

### Waiting dialogs and busy requests
- **A dialog that waits on the member is answered before anything is judged busy** (`_androidBackAsksMember`: the welcome, a confirm). `bookClass` keeps `data-busy="1"` — and often "…" — on its button for as long as its OWN confirm is up ("Book this class?", "Book this spot?", "Join the waitlist?"), and `claimWaitlistSpot` leaves "…" on Claim under "Claim this spot?": a double-tap guard, not a request. Read as one, it made Back dead on exactly the dialogs that spend.
- **Otherwise a request in flight swallows the press** (`_androidBackBusy`: `data-busy="1"`, a button reading "…", the usual-week run's "Stop after this class", a spot swap between its DELETE and its POST — `_swapInFlight`, the picker open under "Swapping..." — and one seat's cancel from the picker, "Cancelling…" in `#modalHint` while `#bikeModal` is open) so the member is there when the result lands — for at most `ANDROID_BACK_WAIT_MAX_MS` (60 s) of one stretch of waiting (`_androidBackWaits`), so a button left busy by a fault cannot turn Back off for good.

  The stretch ends when the WAITING ends, not at the next idle press: a swallowed press starts a once-a-second look (`_androidBackWatchWaiting`) that resets the clock as soon as nothing is busy and stops by itself at the bound.

  A new flow that writes with neither mark must be named in `_androidBackBusy`.

### Focus after Back
- **Focus**: three closers hide the element that holds keyboard / TalkBack focus and hand it nowhere, so the actor does — read BEFORE the closer runs, `preventScroll` each time: the calendar → `#pickDateBtn` (focus was in `#datePicker` or on `<body>`, as its own Escape judges it); the Filters panel → `#controlsToggle` (focus was in `#controlsBody`); a tab's panel → `.tab-btn[data-tab="discover"]` (focus was in that panel). Every other layer's closer restores focus itself.

### Welcome cover, exceptions and login.html
- The welcome as a COVER (`is-holding`, the launch restore still in flight) is not a layer Back closes: Skip there would write "welcome seen" for a newcomer who never saw it.
- Any exception → `false`. Each handled press leaves `android:back <answer>` in the action log (`pushAction`).
- login.html defines its own `window._psycleAndroidBack`: it goes back to psycle-finder.html and answers `true`.

### A new overlay and Back
- **A new overlay**: one listed in `_OVERLAYS` is covered with no further work. One with its own keys is NOT — name it in `_androidBackFacts` and `_androidBackDialog`, or Back sends the app away with it open ([../playbooks.md](../playbooks.md) P5 step 4).

### Back guards
- Guards: 18-android.js (the decision against an oracle, every combination; the actor over a fake page — an unknown selector throws; never "yes"; a dialog before any busy mark; the wait and how it ends; focus; the shipped `bookClass`) and 19-android-project.js (MainActivity: the callback, the script, `moveTaskToBack(true)`, no `finish`).

  The round trip itself — `evaluateJavascript` answering `"true"`, the keyboard taking the first Back, the gesture — is unproved.

## Notifications

### Notification channels, icon and tint
- Two channels, created once per launch by `_ensureAndroidChannels` (importance 4, default sound, vibration): `class-reminders` ("Class reminders") and `new-dates` ("New dates").

  Every `schedule()` on Android awaits that pass first and files each notification through `_forAndroid(notification, channelId)`, which adds `channelId`, `smallIcon` (`ANDROID_NOTIF_ICON` = `ic_stat_psync`) and `iconColor` (`ANDROID_NOTIF_TINT` = `#1B2130`).

  Never rename a channel id: what a member has set in system settings is filed under it. A colour the plugin cannot parse REJECTS the whole `schedule()`, hence the literal. Before Android 8 there are no channels: `createChannel` rejects, which is swallowed.
- ios-app/capacitor.config.json names the same icon and tint plugin-wide (`plugins.LocalNotifications`); res/drawable/ic_stat_psync.xml is the drawable. 19-android-project.js holds the three to each other.

### Exact alarms are not asked for
- **Exact alarms are not asked for** (no `SCHEDULE_EXACT_ALARM` in the manifest; 19-android-project.js fails if one appears). The plugin then arms an inexact alarm — from Android 12 `setAndAllowWhileIdle(RTC_WAKEUP, …)` (read in its LocalNotificationManager.java, 6.1.3), whose delivery window is the SYSTEM's: three quarters of the wait, at most an hour — so a reminder can arrive late: usually minutes, an hour at the platform's worst; `allowWhileIdle` stays on every schedule so it can fire while the phone dozes.

  (The app's OWN two alarms are bounded to ten minutes: "Freshness" and "The class countdown" below, learnings G16.) If reminders prove late on a phone: [../backlog.md](../backlog.md).

### POST_NOTIFICATIONS and the in-app ask
- `POST_NOTIFICATIONS` (Android 13+), `RECEIVE_BOOT_COMPLETED` and `WAKE_LOCK` come from the plugin's own manifest and are merged in; they are not repeated in the app's. The system prompt follows the same in-app ask as on the iPhone — never at launch.

  **Below Android 13 there is no notification permission**: the plugin's `checkPermissions()` answers `'granted'` whenever the app's notifications are enabled, which they are from install, so `_maybeAskClassReminders` returns at `perm.display !== 'prompt'` and the in-app ask NEVER runs there (minSdk 22: API 22–32).

  `psycle_class_reminders` unset means on, so the T-90 reminder AND the countdown are on from the first booking with nobody asked; privacy.html and ios-app/ANDROID.md say so, and whether to ask there all the same is the owner's ([../backlog.md](../backlog.md), [../decisions.md](../decisions.md) "Chosen on the owner's behalf").

### A forged notification tap
- **A notification tap can be FORGED on Android.** The launcher activity is exported (it must be), and @capacitor/local-notifications 6.1.3 builds `localNotificationActionPerformed` purely from the extras of whatever `ACTION_MAIN` intent starts it (`LocalNotificationsPlugin.handleOnNewIntent` → `LocalNotificationManager.handleNotificationActionPerformed`): any app on the phone can hand `handleNotificationAction` a payload of its own making.

  So, behind `IS_ANDROID`: `SNOOZE` is ignored — it would re-post the payload's OWN title and body an hour later under Psync's name, and could fill the plugin's alarm table; no reminder the bridge arms carries the action type, so `registerNotificationActions()` is not called there either — and an `eventId` that is not all digits opens nothing: My Bookings, as a widget link with a bad id (`_parseWidgetLink`).

  What a forged tap can still do is what a real one does: change the tab, open the sheet of a class the member HOLDS, open the usual-week review (which books nothing by itself) — and, inside the plugin, dismiss the notification whose id it names. No spend is in reach.

  The notification's id is deliberately not checked: the ids are few and guessable (8000–8899, 9992–9999), and the class map is pruned as classes pass.

  Read off the plugin's source, never tried on a phone. Guard: 18-android.js.

### The class-countdown channel
- A THIRD channel, `class-countdown`, is not the bridge's: the class countdown creates it natively, IMPORTANCE_LOW ("The class countdown", below). The two above stay exactly as they are, and so does the T-90 class reminder.

### Notification copy
- Copy: no "live countdown" to tap for on Android — its countdown is a notification of its own that arrives by itself.

  The class reminder's body is who and where (`_classReminderBody`); the first-booking ask names both, since one yes allows both ("… — and a countdown until it starts."); the Settings row's detail says what the switch governs: "90 minutes before each class — with a countdown notification" (`_classReminderSwitch(prefOn, granted, android)`, js/tabs.js).

  The welcome does not list it (a welcome is one sentence a page). The iPhone's three sentences are what they were, to the letter (18-android.js). A refused permission points at "Android Settings" (`_osSettingsWords`).

  Elsewhere: the waitlist "You're in" notice (`_announceAllocations`) is ONE sentence on every platform again — "your calendar/widget" — now that Android has a widget; 18-android.js fails if a platform branch returns.

## Status bar, system bars, launch

### Status bar colour
- On Android the status bar is a band of its own colour ABOVE the web view (on the iPhone the page is drawn under it). `updateStatusBar` therefore also calls `StatusBar.setBackgroundColor` with the ground of the theme in force — `_themeGround(registry, themeId, base)` (`pure:android-bridge`): the `bg` of the theme's `APP_THEMES` entry, else the first theme on that base, else nothing. At launch and on every theme change, beside the glyph style.

### Native themes before first paint
- Before the page paints, the native side draws: res/values/styles.xml (`AppTheme.Ground` → `AppTheme.SystemBars` → `AppTheme.NoActionBar`, and the launch theme `AppTheme.NoActionBarLaunch` on `Theme.SplashScreen`), colours in values/colors.xml (Cloud, `#E6E9EE`) and values-night/ (Graphite, `#12161F`), dark-glyph flags in values-v23/ (status bar) and values-v27/ (navigation bar).

  Below those API levels the bar is the ink `#1B2130`, because its glyphs are always white.

  `MainActivity` sets the web view's background to `R.color.psync_ground` after `super.onCreate`, so dark mode gets no pale flash (`android.backgroundColor` in capacitor.config.json can name only the light ground).

  `AppTheme.NoActionBar` KEEPS ITS NAME: `BridgeActivity` switches to it.

### Light / dark flip and uiMode
- **A light / dark flip under a live activity**: `uiMode` is in the activity's `configChanges`, so it is NOT recreated (a recreation reloads the web view, and could interrupt a request in flight) — and Back never finishes it, so one instance lives across many sunsets.

  `MainActivity.onConfigurationChanged` therefore reads the navigation-bar colour and the web view's ground again from the resources of the mode now in force, and the dark navigation buttons from API 27 only, as values-v27/ has it (at 26 the bar is still the ink).

  The status bar is left to `updateStatusBar`. Do not take `uiMode` out of `configChanges`.

### Portrait only
- **Portrait only** (`android:screenOrientation="portrait"` on the activity, with `tools:ignore` for the two lint notes), as the iPhone app (Info.plist) and manifest.json are: the page has no landscape layout, and its sheets and spend dialogs have never been seen 360px high. At targetSdk 34 Android honours the lock on large screens too.

### Launch screen and the mark
- The launch screen is the ground with the mark centred (res/drawable/splash_mark.xml) and no wordmark. It follows the SYSTEM scheme, as the iPhone launch screen does.
- The mark is drawn four times as vectors — ic_launcher_foreground.xml (its note explains the geometry), ic_launcher_monochrome.xml (Android 13 themed icons), splash_mark.xml, ic_stat_psync.xml — and as PNGs for Android 7 and below (`sh assets/render-icons.sh android`, from assets/psync-android-legacy.svg and assets/psync-android-round.svg). No suite holds the four vectors to one geometry: change one, change all four.

### Edge-to-edge at targetSdk 35
- At targetSdk 35 Android ENFORCES edge-to-edge and ignores `statusBarColor` / `navigationBarColor`: the bar colours above stop applying, the web view is drawn under both bars, and the page's `env(safe-area-inset-*)` handling becomes load-bearing on Android. That arrives with the Capacitor upgrade, not before.

## Calendar
The same plugin (@ebarooni/capacitor-calendar 6.7.2); every call the bridge makes exists on its Android side under the same name. The bridge's header comment "ANDROID" (above `var Calendar`) lists the shapes call by call. What differs:
- The plugin's manifest declares NO permission, so the app's manifest carries `READ_CALENDAR` and `WRITE_CALENDAR`; without them a request answers "denied" and never asks.
- An event's notes come back as `description`, not `notes`: `_markerEventId` reads both, which keeps the ownership marker (`psycle-event-id:`) readable.
- `timeZone` is not read on Android (patch-plugins.js patches Swift only): the plugin stamps the DEVICE's zone. `startDate` is an absolute instant, so the class sits at the right moment wherever the phone is; only the zone a calendar app prints beside it differs.
- A synced calendar can keep a deleted event's row for a while, and `listEventsInRange` does not look at the flag. `_androidRememberDeleted` keeps the ids the plugin CONFIRMED deleted, for this launch, and `_listNativeEvents` leaves them out — otherwise a re-booked class could match its own deleted event and nothing would be created. Read off the plugin's source and Android's contract, never seen on a phone.
- `listCalendars` has no `isImmutable` on Android, so read-only calendars (Holidays, Birthdays) are offered in the picker; a create in one fails and is logged.

## The home-screen widget
ONE classic App Widget, "Next class": `AppWidgetProvider` + `RemoteViews` + XML layouts, plain Java — no Compose, Glance or Kotlin, no new runtime dependency. It reads the SAME snapshot the iPhone widget reads ([ios.md](ios.md): the payload table, "Snapshot time contract") and wears its look; the Swift in PsycleShared/ and PsycleWidget/ is the reference for behaviour. What a member sees: [../../ios-app/ANDROID.md → "The widget"](../../ios-app/ANDROID.md#the-widget). All Java below is under ios-app/android/app/src/main/java/com/psyclefinder/app/.

### Native twins of the iPhone plugins
- **Native twins under the iPhone plugins' JS names.** The bridge finds its widget plugins BY NAME, so `MainActivity.onCreate` registers three local plugins with `registerPlugin(…)` BEFORE `super.onCreate` (Capacitor does not discover a plugin in the app module, and that call builds the bridge from the list): `AppGroupPreferencesPlugin` (`@CapacitorPlugin(name = "AppGroupPreferences")`: `set({group, key, value})`, `get({group, key})` → `{value}`, `remove({group, key})`), `WidgetCenterPlugin` ("WidgetCenter": `reloadAllTimelines()`), `PsycleDeepLinkPlugin` ("PsycleDeepLink": no methods, one event, `'openURL'` `{ url }`) — the shapes of App/AppGroupPreferences.swift.

  WHY twins and not an `IS_ANDROID` branch: the snapshot write, the reload, the tap listener and the sign-out pass stay ONE code path for both apps — nothing to drift, no npm plugin (a plugin is an iOS pod), and `IPHONE_LAUNCH_DIGEST` cannot move. The bridge's diff for the widget is comments only.

### PsyncWidgetStore storage
- **Storage**: widget/PsyncWidgetStore.java — ONE private SharedPreferences file, `psync_widget` (not the Preferences mirror, `PsycleFinderSettings`). `group` is required, as on the iPhone, then ignored: Android has no app groups, and the provider runs in the app's own process, so `apply()` is readable at once.

  Stricter than the Swift: only `widget_next_class`, `widget_upcoming`, `widget_week` (`PsyncSnapshot.isWidgetKey`), strings only, at most 64 KB of UTF-8 (`fitsStore`), a missing `value` rejected — and ONE key that is no part of the snapshot, the countdown's switch `countdown_enabled`, `'1'` or `'0'` and nothing else (`isStoreKey`, `fitsKey`; "The class countdown" below).

  The bridge only ever calls `set`. The backup rules cover the file like any other.

### PsyncSnapshot and PsyncWidgetPlan
- **The pure snapshot class**: widget/PsyncSnapshot.java imports `java.*` and `org.json` ONLY — no `android.*` — so the JVM runs the real code.

  `parse(next, upcoming, week)` never throws: `'null'`, `'[]'`, a missing key, text that is not JSON, a value over 64 KB or nested deeper than 6 is simply not there; entries are de-duplicated by id, and `widget_next_class` is read ONLY when the list yields no class — the iPhone's rule (`PsycleSnapshotStore.upcoming()`): the single key is a copy from the last write, never merged INTO a list that no longer names it.

  `upcoming(now, zone)` drops what has started, sorts (two classes at one minute keep their stored order and leave together), keeps 5; `nextRepaintMillis(now, zone)` names the instant of the provider's ONE alarm ("Freshness" below); the provider hands in the DEVICE zone — [../decisions.md](../decisions.md) section 4, CLOSED: do not route it through London.

  Words: `timeLabel` (24-hour, the digits as written), `dayWord`, `whoWhere`, `shortTitle`, `seatLabel` ("Bike 9", "Bikes 5 & 6", "Benches 2 & 3"; the noun as `PsycleSlotLabel` picks it; with no seat numbers there is no badge — "2 spaces" needs an optional `spaces` count that the bridge does not write today) and `seatBadge(maxChars)`, what the badge PRINTS: `seatLabel` when it fits the room the plan gives it (`seatChars`), else the seats counted — "4 bikes", "2 machines" — so that a number is never cut off the end unseen (the iPhone chip scales its words down; RemoteViews has no such call). A screen reader always hears every seat.

  Colour: the entry's own `#rrggbb` literals, light and `…Dark`; base, tint AND deep must all parse, else the neutral fallback (= `psync_widget_*` in res/values*/colors.xml: change both together); `Look.of` follows `PsycleSurface.resolve` — ink by the ground's luminance, the hue line only at 3:1, "soft" = the deep mark on the wash, "off" and "bold" = a white mark on the class colour.

  widget/PsyncWidgetPlan.java, pure too, stands in for `ViewThatFits`: which layout a reported size gets (`WIDE_FROM_DP`, 250) and what fits in it, at the member's FONT SCALE (`forSize(width, height, fontScale)` — every row but the time is sp).

  Nothing is measured: a plan's height is the SUM of its rows (`neededHeightDp()`: padding, day word, time, the name row — never less than its pictogram tile — the badge; WIDE adds who-and-where and the following rows), and a size gets the first step of a LADDER whose sum fits it — COMPACT: two name lines → one (and `PsyncWidgetViews` then prints `shortTitle()`, as the iPhone ladders' last steps do) → 30dp digits and 8dp padding → 24dp and 6dp, which needs exactly the 110dp `minHeight`; WIDE: following rows 2 → 1 → 0, then one name line.

  The seat badge is the LAST row, so it is what a too-tall card cuts: the ladder exists to keep it whole. Below the smallest step (a launcher's landscape box, a very large font on one row of cells) the smallest is drawn and the badge may still be cut — a checklist line.

  The sizes it adds up are copied by hand from widget_styles.xml and the two layouts as named constants; 19-android-project.js reads both sides and fails when one moves alone.

### Widget JVM tests
- **JVM tests**: app/src/test/…/widget/PsyncSnapshotTest.java (36) and PsyncWidgetPlanTest.java (9), JUnit 4 — among them the repaint instant (23:50 gives midnight, not 07:31; always later than now; a same-minute pair; -1 with nothing upcoming), the day words in seven zones and on both days the UK's clocks change, everything again under tr-TR, Arabic-digit and Thai-Buddhist default locales and a far default zone (the class of the iPhone's G1), every plan fitting the height that chose it at font scales 0.85 to 2, and a contrast floor over EVERY swatch × intensity × appearance — on a copy of js/theme.js's palette that 20-android-widget.js holds to the original.

  On the JVM android.jar's `org.json` is a stub that throws, hence the ONE new Gradle line, `testImplementation "org.json:json:20240303"`.

  CI runs `./gradlew :app:testDebugUnitTest` BEFORE the APK is compiled, and it blocks; with a toolchain, `npm run android:test`.

  These 45 have since passed on CI, against the real org.json (the countdown's 36, "The class countdown" below, have not run there yet).

  Before that they had run once on a development machine that happened to hold a JDK — javac 21 at `--release 17`, Gradle's bundled JUnit, and a small stand-in for org.json written for the occasion and kept out of the repository (the real jar was not on the machine): 45 passed, and seven failed as they should when the midnight rule, the iPhone's single-key rule and the tile's height were taken out again. That proves the arithmetic, not the real org.json, and nothing that imports `android.*`.

### PsyncWidgetViews and the layouts
- **One builder, two callers**: widget/PsyncWidgetViews.java builds the `RemoteViews` and nothing else — no storage, no click, no alarm — so `NextClassWidgetProvider` and the debug preview draw the same thing.

  Layouts: res/layout/widget_next_class_compact.xml, _wide.xml, _empty.xml ("Nothing booked" — shown only once a snapshot was READ and holds no class to come), _loading.xml (the `initialLayout`: the card and the app's name, NO claim — a launcher draws it until the provider's first paint, which after a restart can be as late as the next time Psync is opened on a phone that lets no app start by itself) and _preview.xml (the Android 12+ picker: sample words, never a booking).

  Every one-line text style ENDS IN AN ELLIPSIS (widget_styles.xml): `maxLines="1"` alone wraps at the last space and hides line two — a seat number gone with nothing to show for it — and the day word and the time are `singleLine` too, so they never break mid-word.

  RemoteViews decides their shape: FrameLayout, LinearLayout, RelativeLayout, TextView and ImageView only; a coloured surface is an ImageView holding a WHITE shape (drawable/widget_card.xml, widget_tile.xml, widget_seat_badge.xml, widget_row_divider.xml) coloured with `setColorFilter`, text with `setTextColor` — from API 31 through `RemoteViews.setColorInt(id, method, light, dark)` behind `SDK_INT >= S`, so the launcher flips light / dark by itself; below that only the appearance at paint time, and the card catches up at its next repaint; the root is `@android:id/background` with `clipToOutline` over a transparent outline (widget_card_clip.xml), its radius `psync_widget_radius` (values-v31/ hands over the system's); every text, colour and visibility is set on EVERY build, because a launcher re-applies a `RemoteViews` onto views it already inflated; the class layouts carry no text (sample words could pass for a booking); the time is `sans-serif-condensed` bold, sized in dp — no font file ships, the app's face is a woff2; eight pictograms, res/drawable/ic_ct_<key>.xml, one per `CLASS_PICTOGRAMS` key (js/app.js).

  The provider hands over a landscape + portrait pair built from the launcher's min / max size options.

### Freshness and the repaint alarm
- **Freshness**: `WidgetCenterPlugin.reloadAllTimelines()` → `NextClassWidgetProvider.requestRefresh`, an EXPLICIT broadcast (`ACTION_REFRESH`); `MainActivity.onCreate` sends the same broadcast at EVERY cold start (the bridge asks only after a pass that WRITES: after Settings → Apps → Clear storage — a force-stop, so the alarm is gone and no update broadcast arrives — it writes nothing, and the launcher would keep the last class over an empty store); ONE inexact `AlarmManager.setWindow(RTC, at, ten minutes, …)` for `PsyncSnapshot.nextRepaintMillis` — a minute after the shown class starts, OR a second after the next local midnight if that comes first: the day words are relative, so "Tomorrow 07:30" painted at 23:50 is wrong from 00:00 (the iPhone prints a weekday there and needs no such tick) — no exact-alarm permission, no wake-up, and NEVER the bare `set(…)`, whose window the system picks (three quarters of the wait; at most an hour from Android 12, uncapped before): a started class would sit on the card that long (learnings G16); replaced at every paint, cancelled with nothing to show or no widget placed, and armed in a `finally`, so a launcher that refuses one paint does not cost the widget its next; `updatePeriodMillis` 30 min (res/xml/next_class_widget_info.xml), the only thing that notices a changed clock or time zone.

  EVERY callback does the same thing: re-read the store, drop what has started, repaint ALL widgets, re-arm.

  The bridge does not await its `set()` calls before the reload — three, and on Android a fourth, the countdown's switch: the twins rely on Capacitor running plugin calls in order on its one plugin thread.

### The widget tap
- **The tap**: the whole card → `PsyncTapIntent.open(context, id, FROM_WIDGET)` (widget/PsyncTapIntent.java — the ONE tap builder, which the countdown's notification uses too; `ACTION_OPEN`, `EXTRA_EVENT_ID` and `immutableFlags()` live there): `PendingIntent.getActivity` of an EXPLICIT intent for `MainActivity` — action `ACTION_OPEN` (not `MAIN`: the notifications plugin reads every MAIN intent as a possible notification tap), the shown class's id as the extra `EXTRA_EVENT_ID`, `FLAG_UPDATE_CURRENT` (extras are no part of a PendingIntent's identity, so this is what keeps the id current) `| FLAG_IMMUTABLE` (from API 23: whoever holds it — the launcher — can fill nothing in). No URL scheme, no new intent filter.

  `MainActivity.handWidgetTap` — from `onCreate` after `super.onCreate`, and from `onNewIntent` (the activity is `singleTask`) — answers an intent ONCE, by identity, and not at all for an activity restored from a saved state or relaunched from recents; it looks `PsycleDeepLink` up on the bridge and calls `openFromWidget`, which emits `'openURL'` with `retainUntilConsumed` true (a tap usually cold-starts the app).

  **The extra is UNTRUSTED**: the launcher activity is exported, so any app can send `ACTION_OPEN` with an extra of its making. `PsyncSnapshot.tapId` keeps 1 to 12 ASCII digits; otherwise the url is `psync://bookings` — My Bookings, no class — and `_parseWidgetLink` judges the id again whatever arrives. No spend is in reach.

  Not carried over from the Swift plugin: its replay to a page that reloaded within 10 s.

### The widget receiver is not exported
- **The receiver is NOT exported**: `NextClassWidgetProvider` is `exported="false"` with ONE filter action, `APPWIDGET_UPDATE`, as Android's own widget guide declares a provider. The widget broadcasts come from the SYSTEM's widget service (a launcher never broadcasts to a provider; it asks that service), and the system may send to any receiver; the app's own refresh and the alarm's `PendingIntent` are sent as the app itself.

  Exported — as it first was, on the mistaken premise that a launcher could not otherwise reach it — any app could start the process and have it rebuild the widget at will. The provider takes NOTHING from an intent all the same: it only re-reads the app's own snapshot and repaints (or re-arms its alarm), writes nothing, sends no request.

  Read off Android's contract and its guide, not seen on a phone: "it PAINTS" in the owner's checklist is the proof.

### Widget sign-out
- **Sign-out**: nothing native implements it. The bridge's `clearToken` wrapper runs one `updateWidgetSnapshot` pass that writes `'null'`, `'[]'`, `'[]'` through `set()` and asks for ONE reload — the iPhone's rule; session EXPIRY writes nothing, so the widget keeps the classes still held. Nothing is ever `remove`d, so a reader takes `'null'` and `'[]'` as "Nothing booked" — the same words signed out or never opened: the widget never says who is signed in.

### Widget proof without a phone
- **Proof without a phone**: (1) the JVM tests.

  (2) app/src/debug/ — `WidgetPreviewActivity` and a manifest of its own, merged into DEBUG builds only (a release has neither). It is exported so `adb` can start it and asks its caller for `android.permission.DUMP`, which the adb shell holds and no app a member installs can: the debug APK is also what a person sideloads onto a signed-in phone, where an open exported activity would let any app put words of its choosing under Psync's name.

  It shows the SAME `RemoteViews`, from `PsyncWidgetViews`, with `RemoteViews.apply()`, fed by STRING extras (`sample`, `snapshot` / `snapshot_base64`, `empty`, `size`, `night`, `now`, `width`, `height`) and the system's font scale; it reads nothing stored and sets no click, its sample names are the fake server's, its frame is never wider than the screen has room for (the caption says when it asked for more), and a widget it CANNOT draw is captioned AND logged as an error under the tag `PsyncWidgetPreview`.

  `android-smoke` opens it nine times on a phone-sized emulator (`profile: pixel_6`) — compact, wide, wide at night, `sample off`, `empty 1`, then four seats, two seats at 110dp wide, the smallest card (110 × 110) and a long name on a one-line card at font scale 1.3 — keeps widget-*.png and logcat-widget.txt, and fails when that tag is in the log.

  (3) What can be READ: 19-android-project.js (one receiver, unexported, and its provider-info; an `initialLayout` whose only words are the app's name; RemoteViews-safe layouts; every one-line style ending in an ellipsis; the plan's constants equal to the XML's numbers; one `ic_ct_` per class-type key; every PendingIntent immutable; an inexact alarm only, its instant from the pure class and armed in a `finally`; the font scale handed to the plan; `shortTitle()` on one line and `seatBadge(plan.seatChars)` in the badge; `SDK_INT` before `setColorInt`; an explicit tap; the twins registered before `super.onCreate` and a repaint asked for after it; no `android.*` in the pure class; the preview under app/src/debug/ only, behind DUMP, logging what it cannot draw; the exact dependencies block) and 20-android-widget.js (what the bridge WRITES through the twins, one reload per pass, a retained tap and a hostile one, an app without twins stays silent, sign-out against expiry on both platforms, the iPhone digest, the bridge's names against the project's `@CapacitorPlugin` / `@PluginMethod` names, and the JVM tests' palette against js/theme.js).

### Widget copy
- **Copy**: the welcome's last page on Android reads "…with a widget and reminders." (`_welcomePages(native, touch, platform)`).

## The class countdown
Android has no Live Activities. What stands in for the iPhone's is ONE silent, ongoing NOTIFICATION with the system's own countdown chronometer, from 90 minutes before the next held class until it starts (decisions.md section 8).

**Decided: it ends AT the start, not five minutes after like the iPhone's Live Activity — decisions.md section 6, CLOSED** (the system's own timeout removes it to the second, and its chronometer would read negative if it were kept).

It is native, local and adds nothing: plain Java under ios-app/android/…/app/countdown/, NO foreground service, NO exact alarm, NO new permission, no new package. It REUSES the widget's snapshot, store and tap — read "The home-screen widget" first.

### PsyncCountdownPlan rules
- **The rules are the iPhone's** (`refreshFromSnapshot`, PsycleLiveActivityController.swift; `leadWindow` = 90 × 60), in the PURE `PsyncCountdownPlan.of(snapshot, now, zone, enabled[, dismissedKey])` → `show` (an entry or null), `until` (its start), `nextWake`, `key` (what names this countdown: `keyFor(eventId, start)`, null with no class inside the window).

  Show = the FIRST class to come (`PsyncSnapshot.upcoming`: "started" and device-local are the widget's own rules — section 4, CLOSED) when its start is at most `LEAD_MILLIS` away, the exact millisecond included; never a later class while an earlier one is still to come; never a class that has started; never a waitlist place.

  `nextWake` = the earlier of that class's start and the moment the NEXT class comes inside its own window; nothing to wait for → `NONE`, and the alarm is cancelled.

  WHETHER a plan that shows may be posted is decided there too — `mayPost(alarmArmed, systemEndsIt, canPost, now)`: it shows, the app can post, time is left, and something is sure to END it (the system's timeout from API 26, else the armed alarm) — so the rule the notifier follows runs under a JVM test and not only inside `android.*` code.

  Nothing in it throws; `java.*` and `PsyncSnapshot` only, so `PsyncCountdownPlanTest` (36 JVM tests: the edges of the window, two and three classes inside it, a start with seconds, a moved booking, a long list, the single key, both clock changes, overflow, a swipe, `mayPost`'s table, the store's keys) runs the real code on CI.

### The countdown notification
- **The notification** (`PsyncCountdownNotifier.apply` — post, update in place or cancel to match the plan; ONE tag + id, `psync-countdown` / 7090, so it never stacks, and the TAG keeps it out of reach of the local-notifications plugin, which cancels by bare id).

  Its OWN channel `class-countdown`, created natively, IMPORTANCE_LOW: silent, no peek, and a member can switch it off in system settings without touching reminders — NEVER rename the id.

  Title = the class name; text = the place and the seat in the widget's own words ("Shoreditch · Bike 9"); `when` = the start with `setUsesChronometer` + `setChronometerCountDown` (API 24+; below, the text opens with the 24-hour start instead); ongoing, only-alert-once, `CATEGORY_EVENT`, the class's base colour as `PsyncSnapshot` settles it, `ic_stat_psync`; `VISIBILITY_PRIVATE` with a PUBLIC version that says only "Next class" and the time — a lock screen must not name the place to a stranger.

  No action buttons. The tap is the widget's: `PsyncTapIntent.open` (widget/), the ONE `getActivity` PendingIntent of the app — explicit, immutable, the id untrusted; request code `FROM_COUNTDOWN` so neither tap rewrites the other's id.

### Countdown must not outstay its class
- **It must not outstay its class.** From API 26 the SYSTEM removes it at the start (`setTimeoutAfter`), with the app dead; the receiver's alarm takes it down too; below 26 it is posted only once that alarm is armed (`mayPost`); and every plan run cancels it when there is nothing to show.

### A swipe dismisses one class
- **A swipe is an answer — for that class.** From Android 14 a member can swipe an ongoing notification away, and every plan run is "post to match the plan": without more, each foreground, each `bookings:loaded` and the widget's half-hourly `onUpdate` with the app closed would put it back for up to 90 minutes.

  So the notification carries a DELETE intent (`setDeleteIntent`): an explicit, immutable broadcast to `PsyncCountdownDismissReceiver` — a class of its own, unexported, NO intent filter, so that the planning receiver keeps taking nothing from an intent — carrying the plan's `key`.

  It stores the key (held to `PsyncCountdownPlan.isKey` first) NATIVELY in the widget's file under `countdown_dismissed`, a name `isStoreKey` does not hold, so the page can neither read nor write it (`PsyncWidgetStore.countdownDismissed` / `setCountdownDismissed`), then plans.

  `plan()` hands the key to the planner: for THAT class at THAT start `show` is null and `nextWake` is kept (the class after it still takes over); a moved start, another zone or the next class is another key, and shows. The marker is forgotten as soon as the plan's `key` is anything else.

  The system's own timeout sends the same intent: harmless (the key names a class that has started) and useful — the plan run it triggers hands over to the next class at once, not at the alarm's window. A `cancel()` by the app sends nothing.

### When the countdown plans
- **When it plans** — `PsyncCountdownReceiver.plan(Context)`: static, synchronized, idempotent, never throws.

  Called by `WidgetCenterPlugin.reloadAllTimelines` (the bridge has just written a snapshot: a booking, a cancel, and the EMPTY one a sign-out writes, which takes it down at once — a session that merely expired writes nothing, so it stays: the iPhone's rule), by `AppGroupPreferencesPlugin` when the off switch FLIPS, by `MainActivity.onCreate`, by `NextClassWidgetProvider.onUpdate`, by its own alarm, by the dismiss receiver, and on FOUR broadcasts only the system may send (the receiver's one filter): `BOOT_COMPLETED` (a restart clears every alarm and notification), `MY_PACKAGE_REPLACED` (an update of the app removes its notifications, and the surviving alarm is for the class's start), `TIMEZONE_CHANGED` and `TIME_SET` (`startAt` is read device-local, so the posted `when`, the system's timeout and the armed alarm all move — and with no widget placed there is no half-hourly `onUpdate` to notice).

  All four reach a manifest receiver (three are exempt from the implicit-broadcast limits; the update's is sent to the package alone); only the first needs a permission, and that one is the plugin's.

  The receiver is NOT exported — the system reaches it all the same, as it reaches the notifications plugin's own restore receiver — and takes NOTHING from an intent.

  `PsycleLiveActivity` gets NO twin: the iPhone path must not change, and the countdown needs nothing from the page but the snapshot.

### The countdown alarm
- **The alarm is `AlarmManager.setWindow(RTC, at, ten minutes, …)`: inexact, and NOT `RTC_WAKEUP`.** A judgement: a countdown is only ever seen on a phone that is awake, a waiting RTC alarm is delivered when the phone next wakes, and waking a sleeping phone to post a silent notification nobody is looking at spends battery on nothing.

  NOT the bare `set(…)`, as it first was: a one-shot `set()` gets the platform's own window — 0.75 × the wait, capped at an hour from Android 12 and not at all before, and from 12 delivered as LATE as the window allows — so a countdown armed at 08:00 for 17:00 could first appear with 30 minutes left, on Android 11 and below not at all, and on API 22–25 (no timeout: the alarm alone takes it down) outstay its class by an hour.

  `setWindow` needs no `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM`; ten minutes is the shortest window Android 12+ honours for an alarm that is not exact, so on a phone that is awake it is at most about ten minutes late on every API level; its END does not depend on the alarm from API 26 (learnings G16).

### The off switch countdown_enabled
- **The off switch is the member's Class reminders preference** (`psycle_class_reminders !== 'off'`), which only the page can read.

  On ANDROID ONLY the bridge hands it over each snapshot pass as one more key through the `AppGroupPreferences` twin — `countdown_enabled`, `'1'` | `'0'`, after the pass's three keys and BEFORE its reload (`_androidCountdownSwitch` — through `_appGroupSet` alone, with no Preferences copy: nothing would read one); a flip with no pass to carry it goes out by itself with a reload of its own (`_androidCountdownFlipped`: an expired session, nothing held yet, turning reminders off).

  The twin's allow-list gains exactly that key (`PsyncSnapshot.isStoreKey`, `fitsKey`: "1" or "0" and nothing else); ONLY "1" is on, so a key never written is OFF (`PsyncSnapshot.countdownEnabled`): the countdown FOLLOWS that preference, and the plan runs that come before the page has loaded — `MainActivity.onCreate`, `BOOT_COMPLETED`, the widget's `onUpdate` after an update over a build without the key — must not count down for a member who has reminders off.

  The first pass, seconds into the first launch, writes the real value, and the twin plans at once when that turns the switch on (`planIfTheSwitchFlipped`). On the iPhone: not one call (`IPHONE_LAUNCH_DIGEST`).

### Countdown never asks for permission
- **It NEVER asks for the notification permission.** `canPost` only looks (`POST_NOTIFICATIONS` from API 33, `areNotificationsEnabled` from 24); refused, the notifier does nothing, silently (`canPost` is an input of `mayPost`). The page's in-context ask stays the only one — and below Android 13 there is none to make ("Notifications" above).

  `POST_NOTIFICATIONS` and `RECEIVE_BOOT_COMPLETED` are @capacitor/local-notifications' own (6.1.3: read in its AndroidManifest.xml), merged in — re-check that file after a plugin bump; the foot of the app's manifest says what to declare if they ever go.

### Countdown proof
- **Proof.** 21-android-countdown.js: the bridge half — the key on every Android pass and never on the iPhone, '0' with reminders off, the flip, an older app served without a word, and the Java's allow-list held to the bridge's literal and its two values.

  19-android-project.js: a pure planner that names no `android.*`; ONE channel, `class-countdown`, at IMPORTANCE_LOW and nothing louder; ongoing, a countdown chronometer, a timeout, a private / public pair, no action, no sound; every API above 22 behind its `SDK_INT` test; TWO unexported receivers — the one that plans hears exactly the four system broadcasts and reads nothing from an intent, the other has no filter and reads ONE string, stored only when `isKey` says so; a delete intent on the notification; the marker's key named once, in the store, out of the page's reach; `AlarmManager.setWindow` on `RTC` with a ten-minute window and NO bare `AlarmManager.set(` anywhere in the app; no exact-alarm, foreground-service or notification permission in either manifest; every PendingIntent immutable and ONE tap builder.

  And `android-smoke` POSTS A REAL ONE: app/src/debug/…/`CountdownProofReceiver` — DEBUG builds only, exported so `adb` can reach it and behind `android.permission.DUMP` like the widget preview, a receiver and not an activity because `am start -S` force-stops the app and a force-stop removes its notifications by itself — writes ONE fixed sample class (the fake server's names; the sender picks a NUMBER through a STRING extra — `minutes`, `started`, `clear`, `enabled` — never a word) through the store's own `set()`, runs the real `plan()`, and answers the broadcast with what it did.

  The job grants `POST_NOTIFICATIONS` with `pm grant`, seeds a class 40 minutes ahead, keeps `dumpsys notification --noredact` (the record's channel, importance, ongoing flag, category, visibility and public version, the two chronometer extras, and its `timeout=` line — the platform prints the DURATION as a date, `1970-01-01 00:39:5x` for forty minutes and `unknown` for none) and `dumpsys alarm` (the system's TIMEOUT alarm and the app's own — that file is read, never judged), opens the shade with `cmd statusbar expand-notifications` and keeps countdown-shade.png, then seeds a class that has STARTED and proves the record is gone ("Build, CI and what proves it" has the script and its verdict).

  Off CI the pure classes and all 81 JVM tests (these 36 and the widget's 45) have run — javac 21 at `--release 17`, first against a small stand-in for org.json, then against Android's own org.json classes, neither kept in the repository — and deliberate mutations of the pure classes were caught: 17 of 17 at first (the first pass caught 16: the survivor was an untested overflow guard, now tested), then 8 of 8 for the swipe, `mayPost` and the never-written switch.

  What imports `android.*` has been compiled off CI against an API 34 framework jar, with stand-ins for Capacitor and `R`, and the real planner, notifier and both receivers have been run under Robolectric (API 34): ONE notification on `class-countdown`, IMPORTANCE_LOW, ongoing, a countdown chronometer, a timeout equal to the time left, an immutable tap and delete intent, an `RTC` alarm with a 600,000 ms window; gone for a started class, the off switch and the sign-out snapshot; a swiped-away countdown left down by later plan runs and shown again for a moved start; never written = nothing.

  That is not Gradle, not the manifest merger and not a phone: CI is still the compiler. Not seen on a phone: the on-device checklist.

## Share, storage, the service worker
- **Share**: the Android web view has no Web Share API and no download manager. The stats and year cards go out as TEXT through `nativeShare` (`_shareAsTextOnAndroid`, js/tabs.js) — an image needs a file on disk, which needs a plugin the app does not carry; settings export and the ICS export already fall back to text through the same function.
- **Storage**: the `SYNC_KEYS` mirror is SharedPreferences (file `PsycleFinderSettings`, the Preferences `group`). js/security.js treats both native apps alike (`isNativePlatform()`): the token ciphertext and the AES key backup are restored before the token is read.
- **No service worker is registered** (`_swSkippedHere`): the files are in the app bundle, and a worker would be a second cache serving OLD files after a store update.

## Backups off, and the manifest
What the app stores is a sign-in, so nothing may leave the phone: `android:allowBackup="false"`, `fullBackupContent` → res/xml/backup_rules.xml, and `dataExtractionRules` → res/xml/data_extraction_rules.xml (from Android 12 `allowBackup` alone no longer stops a device-to-device transfer). Both files exclude every domain. On a new phone the member signs in again.

Also: `usesCleartextTraffic="false"` (a live-reload run would need it lifted locally — never commit that), ONE exported component, the launcher activity — the widget's provider is not ("The home-screen widget" says who reaches it all the same, and what it takes from an intent: nothing) — no service of the app's own, THREE receivers — the widget's provider FIRST, then the countdown's two (the one that plans, the one a swipe reaches), none exported — no custom URL scheme or host.

Guard: 19-android-project.js READS both rule files — all five domains excluded whole under `<full-backup-content>`, `<cloud-backup>` and `<device-transfer>`, no `<include>` — holds the exported components to the launcher activity ALONE, refuses a `<data>` element, and holds capacitor.config.json to no `server.url`, `server.allowNavigation` (a listed origin would load inside the bridged web view, plugins in reach) or `server.hostname`.

## What is absent
Lock Screen widgets, the Live Activity itself (ONE silent notification stands in for it: "The class countdown"), Siri, a `psync://` URL scheme (the string exists only INSIDE the app, as the shape the page already parses), a wordmark on the launch screen, an image share card, and the calendar event's London time-zone stamp.

## Build, CI and what proves it

### Build commands and SDK levels
- `cd ios-app && npm run sync:android` = `node build.js && npx cap sync android`: it regenerates what ios-app/android/.gitignore keeps out of the repository (the copied web assets, the two config copies, res/xml/config.xml, capacitor-cordova-android-plugins/). Gradle cannot run without it.

  `npm run open:android` opens Android Studio; `npm run android:debug` = sync, then `./gradlew assembleDebug`; `npm run android:test` = sync, then `./gradlew :app:testDebugUnitTest`.

  `cap sync android` also REWRITES capacitor.settings.gradle and app/capacitor.build.gradle: commit them after a plugin change.
- SDK levels (ios-app/android/variables.gradle): minSdk 22, targetSdk 34, compileSdk 35 — the calendar plugin pins androidx.core 1.15.0, which must be compiled against 35; AGP 8.2.1 only knows 34, hence `android.suppressUnsupportedCompileSdk=35` in gradle.properties. Java 17.

### CI jobs android-build and android-smoke
- **CI is the compiler.** `android-build` (.github/workflows/ci.yml): on EVERY push to an `android/**` branch and on manual dispatch; on a push to `main` only when the APK would differ — the Android project or the web app it carries changed ([testing-and-ci.md](testing-and-ci.md) "When CI runs") — `npm ci`, `npm run sync:android`, the JVM unit tests (`./gradlew :app:testDebugUnitTest`, BLOCKING and before the APK; a failed test's XML is printed to the log, the report is the artifact `android-unit-test-report`), a step that PROVES the countdown's tests ran ("The countdown's JVM tests ran": a task with nothing to run still passes, so it reads the result XML for a class named …Countdown…Test holding at least one test, and stops the job without one), `./gradlew assembleDebug`, the APK uploaded as the artifact `psync-debug-apk` (30 days), then an advisory `:app:lintDebug`.

  `android-smoke` (advisory, `android/**` pushes and manual dispatch): installs that APK on an API 34 emulator with a phone's screen (`profile: pixel_6` — with none, the AVD's default screen is understood to be narrower than the wide card), launches it, screenshots, sends ONE Back key, screenshots again and writes the process id to pid-after-back.txt; then starts the debug-only `WidgetPreviewActivity` nine times with `am start -S` (a force-stop first, so each start reads ITS extras) and screenshots each, the last with the system font at 1.3 (`settings put system font_scale`, put back after).

  Every widget line ends in `|| true`; the step fails only if the process was gone after Back, logcat.txt holds a `FATAL EXCEPTION`, or logcat-widget.txt holds a crash of the app's process or the preview's `PsyncWidgetPreview` error (a widget `RemoteViews.apply()` refused).

  It never taps, swipes or types, so it can book nothing; signed out, the launched app sends only the read-only GETs any visitor's page sends (learnings F5).

  Then the COUNTDOWN, posted for real by the app's own planner and notifier: `pm grant … POST_NOTIFICATIONS` (the app never asks from native code), then three broadcasts BY NAME to the debug-only `CountdownProofReceiver` — `--es minutes 40`, `--es started 1`, `--es clear 1`; every extra a STRING (the hook reads `getStringExtra`: a typed `--ei` would come back null and the DEFAULT sample be judged as the one asked for), no action, `--include-stopped-packages` because each preview start force-stopped the app. A receiver and not a second preview activity: `am start -S` force-stops, and a force-stop removes the app's notifications by itself — "it went away" would prove nothing.

  Kept: countdown-broadcasts.txt (the hook answers `am broadcast` with what it did: `stored=`, `canPost=`, `shows=`, `nextWakeInSeconds=`), countdown-posted.txt and countdown-after-start.txt (`dumpsys notification --noredact --package`), countdown-alarms.txt (the system's TIMEOUT alarm and the app's own — read, never judged), countdown-shade.png (`cmd statusbar expand-notifications`: a command, not a touch), logcat-countdown.txt.

  The countdown's verdict comes AFTER the launch's and the widget's, so it can never hide one: no crash; no `PsyncCountdownProof` error (a hook that could not seed — rename the tag in both or neither); a `NotificationRecord` of the app on `class-countdown`; the second dump taken and holding NO such record; then importance 2, the ongoing bit in the MAIN notification's flags, `category=event`, `vis=PRIVATE` with a `publicVersion`, `android.showChronometer` and `android.chronometerCountDown` true, and LAST a timeout: `timeout=19[67][0-9]-` (`NotificationRecord`'s dump prints `getTimeoutAfter()` through `TimeUtils.formatForLogging` — the duration as a DATE, 1969 on an image west of UTC, and the word `unknown` for none: the one property that ends the notification with the app dead, so a later edit that drops `setTimeoutAfter` turns the job red).

  The patterns were written from the platform's source, by reading: 19-android-project.js runs them, as JavaScript, against a record written the way the platform prints one, and shows each can fail alone — if one does not match what the image prints, the evidence is what to read and the pattern is what to fix.

  A person reads launch.png, after-back.png, the nine widget-*.png, countdown-shade.png, the dumps and the three logs.

  The widget steps and the profile have run ("Not verified" says what they showed); the COUNTDOWN steps have not run yet — their first run is the first push of the branch that adds them, and until it is read the countdown is "read, not built".

### What 19-android-project.js holds
- **What can be read is held by 19-android-project.js**: the project is committed and its ids are the appId; the manifest (backups, cleartext, every named resource); MainActivity's Back contract; no signing material tracked, none ignorable-by-accident, no password in a Gradle file; `npm run sync` still iOS-only and the lockfile still agreeing; the CI jobs' shape; every res/ XML parses (its reader is proved able to fail), every file name is one aapt accepts, every `@type/name` resolves; what the bridge names, the project holds; the widget, as far as Java and XML can be read ("The home-screen widget" → proof); the countdown likewise, and the debug hook held to CI's script — its component, its string extras, its tag ("The class countdown" → proof).

  18-android.js holds the web layer and the bridge as `'android'`, through ios-bridge.js's exported `harness` (`boot({ platform })`); 20-android-widget.js boots the same launch WITH the twins (`launch(h, 'android', { twins: box })`), and 21-android-countdown.js the countdown's switch on it.

## Release signing, the target API

### Release signing config
- app/build.gradle reads four values from the environment — `PSYNC_KEYSTORE_FILE`, `PSYNC_KEYSTORE_PASSWORD`, `PSYNC_KEY_ALIAS`, `PSYNC_KEY_PASSWORD` — or from ios-app/android/keystore.properties (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`; git-ignored); the environment wins.

  With any missing there is NO release signing config: a release build is unsigned, never debug-signed.

  No keystore exists in the repository and none may: the root .gitignore and ios-app/android/.gitignore refuse `*.jks`, `*.keystore`, `*.p12`, `*.pfx` (a current keytool writes a PKCS12 store) and keystore.properties — at the root too, because `PSYNC_KEYSTORE_FILE` takes a relative path and one folder up is a natural place for one; 19-android-project.js refuses a tracked file of any of those names.

  `versionCode` / `versionName` are set by hand there.

### The manual android-release.yml workflow
- **The signed bundle can be built by GitHub — by hand, never on a push**: .github/workflows/android-release.yml is `workflow_dispatch` only and refuses any ref but `main`; `contents: read`, no credentials left in the checkout, GitHub's own actions only, no dependency cache.

  It reads four secrets that only the OWNER can create — `PSYNC_KEYSTORE_BASE64` (the keystore file) and the three values above — which the runbook files in a `play-release` ENVIRONMENT (deployment branches: `main` alone; a required reviewer), not at repository level: the workflow's own "main only" step is a convention a copy on another branch could drop, the environment is the control. It FAILS, naming what is missing, before anything is installed: app/build.gradle would otherwise build an unsigned bundle that looks like a release.

  The keystore is decoded AFTER `npm ci` and the sync, into the runner's temp folder, opened once with keytool (the password by NAME, `-storepass:env`), handed to `./gradlew bundleRelease` as exactly the four variables, and shredded as soon as the bundle is verified — BEFORE the upload action, the first code after the decode that is not this repository's, runs — and again in an `always()` step; the bundle must read "jar verified" AND carry the keystore's own certificate before the `.aab` — alone, by its full path — is kept as an artifact for 5 days.

  A secret reaches a step through `env:` only; no `set -x`, no `--info` / `--debug`. It uploads NOTHING to Google Play. The version-name input is a confirmation held against app/build.gradle, not an override.

  Guard: 22-play-release.js, which reads the file and cannot run it — keytool, jarsigner and the signing itself are unproved until the owner's first run. The owner's runbook, from the developer account to the checklist: [../../ios-app/PLAY_STORE_DEPLOY.md](../../ios-app/PLAY_STORE_DEPLOY.md).

  The privacy policy a listing needs is privacy.html at the repository root: served with the web app, NOT in `SHELL`, NOT in ios-app/www/ (build.js copies five named root files), one owner placeholder.

### Target API for Google Play
- **Google Play needs a newer target API than Capacitor 6 gives** (targetSdk 34), so a Play submission waits for the Capacitor upgrade ([../../ios-app/UPGRADE-CAPACITOR-8.md](../../ios-app/UPGRADE-CAPACITOR-8.md) — written for iOS before this project existed; it has no Android steps yet). Do not raise `targetSdkVersion` by hand: see edge-to-edge above. Sideloading the debug APK needs neither.

## Not verified
Everything that needs a compiler, an emulator or a phone: the owner's tick-box list is [../../ios-app/ANDROID.md → "On-device checklist"](../../ios-app/ANDROID.md#on-device-checklist).

### Widget proved by CI
**The widget** is PROVED as far as CI reaches: javac, aapt2 and the manifest merger accept it (the Capacitor plugin API written from memory held), its 45 JVM tests pass against the real org.json, and `android-smoke` drew the debug preview in nine states on an emulator — `RemoteViews.apply()` inflates the layouts, the white-shape colour filter paints card, tile and badge, night picks the dark literals, large type keeps every row whole, four seats read "4 bikes", the empty card names nobody. The plan's sums are still arithmetic about type: the pictures agree with them at the sizes drawn, nothing more.

### Countdown proved by CI
**The countdown** is PROVED as far as CI reaches: compiled by CI's `android-build` job, which first ran all 81 JVM tests against the real org.json (36 of them the countdown's; all pass), and POSTED on an emulator by `android-smoke`: Android's own record (`dumpsys notification`) shows one notification, id 7090, tag `psync-countdown`, on the channel `class-countdown` at importance LOW with no sound, vibration or badge, flags ongoing + only-alert-once, the class colour, a count-down chronometer and a timeout equal to the time left; its private version reads "RIDE 45" / "Shoreditch · Bike 9" and its PUBLIC version only "Next class" and the time; the shade screenshot shows it under "Silent" counting down; and after the class was marked started the app had no notification left.

### Countdown not proved on a phone
NOT proved, on a phone only — that it appears by itself 90 minutes out with the app closed, how late on a phone that is awake (the alarm is RTC with a ten-minute window) and under Doze; that a swipe on Android 14+ keeps it away for that class and the next class still shows; that it comes back after an update of the app and follows a changed zone or clock with the app closed and no widget placed; what a phone on Android 12 or earlier shows with nobody asked; that the system removes it at the start with the app dead (`setTimeoutAfter`); what a locked phone shows; the tap, cold and warm; that a booking, a cancel and a sign-out move it at once and an expired session leaves it; the Class reminders switch taking it down and bringing it back; the channel switched off in system settings leaving reminders alone; a reboot inside the window; notifications refused; two classes inside the window; below Android 7 (API 22–23: no countdown chronometer, so the start time in the text), and below Android 8 (no timeout: the alarm alone).

### Widget not proved on a phone
The widget: NOT proved, on a launcher or a phone only — a local plugin appearing as `Capacitor.Plugins.<name>`, the picker and the first paint, which layout a launcher's sizes pick, corner clipping on Android 12+, the light / dark flip, the unexported provider being reached at all, the repaint after a booking, the roll-over and the midnight repaint under Doze, a reboot and what the card says before its first paint, the card after Clear storage, a one-row card and a large font, the tap cold and warm, the retained event, sign-out.

### Everything else not verified
For the rest, in short — that Gradle, aapt2, javac and the manifest merger accept the countdown's Java, strings and manifest entries (they have accepted everything before it); release signing end to end, on a machine or in the manual workflow; the Back round trip, Back over a spend confirm and during a spot swap, the edge swipe on the welcome; the portrait lock; the navigation bar following a light / dark flip; a forged notification intent being refused; channels, the small icon, alarm lateness in Doze and re-arming after a reboot; the calendar prompt, `description`, the two alerts, the deleted-row premise; the status and navigation bar colours per theme and API level; the themed icon and the launch screen in light and dark; the storage mirror bringing a session back; share as text; sign-in from `https://localhost`.

And the iPhone app was not rebuilt: its path is proved by recorded plugin calls only.
