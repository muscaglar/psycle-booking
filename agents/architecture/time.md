# Time — gym time (Europe/London) and 24-hour clock times
Read this before you parse, compare or print any class time: `start_at` is a naive London wall-clock string and the tests run as a non-UK device. Skip it when your change never touches a time.

### Gym time resolver

**Gym time (Europe/London)**: the API's `start_at` is a naive UK wall-clock string. `_gymClassStartMs` /
`_gymWallToUtcMs` (`pure:gym-time` in js/app.js, exported as `window._psycleClassStartMs`) resolve it to an
absolute instant through Europe/London, DST-correct, whatever zone the device is in; where the engine has no
London data they fall back to the device-local parse (right on a UK device). native-bridge.js carries the same
pair (`_classStartMs`) because tests run the bridge alone and the web build never loads it; in the app the bridge
loads last and re-exports its copy. **Change both together** — tests/suites/bookings-card.js holds them to the
same answers.

### What reads gym time

- *Reads it (web layer)*: the 12h late-cancel deadline (`_cancelDeadline` → "Free cancel until …", cancel dialog,
  Late-cancel badge), countdown chips (`getCountdownText`), whether a held class has started (`_classHasStarted` →
  My Bookings' upcoming/past split, the tab badge, Stats "Upcoming", the next-class pill), waitlist accept-by times
  and phases (`_waitlistTimeMs` — and the card PRINTS "accept by 17:45" as London wall clock too, through
  `_londonClock` / `_londonParts` in `pure:bookings-card`, the pair `_cancelDeadline`'s label reads: never the device's
  getters, which put a deadline after the class's own start on a phone east of London), the Monday release (`_releaseFrom`, `_dayOpensMs` / `_dayListedMs`, `_bookingHorizon`), the saved copy's "still
  worth showing" test, the offline queue's "class has started" test, the notify-me check, and Stats' "classes
  taken" counts. Clash detection, the Time row and usual-week matching deliberately read the DIGITS instead.
- *Reads it (bridge)*: calendar events (each also stamped `timeZone: 'Europe/London'`) and the Monday 12:00 reminder.

### Still device-local paths

- *STILL device-local, by the owner's decision (not an oversight — do not "fix" in passing)*: the widget / Live
  Activity snapshot (`updateWidgetSnapshot` + the Swift `PsycleSnapshot` parser using `.current`), the T-90 class
  reminders (`_scheduleClassReminders`), and the web ICS / Google Calendar export in js/calendar.js. Card times and
  day grouping also render `start_at` as written, which is the gym's own wall clock.
- *Also still a device-zone parse (`new Date(start_at)` against now)*: Discover's started-class filter and facet
  counts (`render`, `_buildFacetClasses`, `_anyStartedBetween` in js/app.js), the instructor profile's upcoming list
  (js/features.js), and the offline-queue replay's re-check of the freshly read `/events/{id}` (js/reliability.js —
  the queue's own `_queueStartMs` test IS London-resolved).

### Clock times are 24-hour

**Clock times (24-hour)**: every time the app prints or speaks is zero-padded 24-hour "HH:MM" — "06:30", "18:30", never "6:30pm" — on cards, the class sheet, the picker header, confirm dialogs, toasts, `announce()` lines and aria-labels, the Booked sheet, "Free cancel until Sun 19:30", waitlist "accept by 17:45", "Tomorrow 07:00", the clash line ("Clashes with your 07:00 Ride"), Stats ("Mondays ~07:00", "Fridays at 07:30", Favourite time "18:30" — the busiest hour at ITS most-voted minute, the vote Habits takes; never a bare hour dressed as a time), the usual week, the instructor profile, the history list, the share text and the welcome's illustrations.

### The `_clock24` formatter

ONE formatter decides it: `_clock24(hours, mins)` and `_clockOf(startAt)` (the time cut from a class time's DIGITS) in js/app.js's `pure:clock` block; js/tabs.js, js/features.js and js/reliability.js call them as bare globals, the way they call `_plural` — so a suite that runs one of their functions in a bare vm hands `_clock24` in (`t.loadPure('js/app.js', 'clock')._clock24`).

The formatter parses nothing and never asks the device zone: each caller passes the digits it already read, exactly as before (a class's wall-clock digits; the getters of a Date it already holds — see Gym time for which is which).

The block sits at the head of `pure:clash` (several suites cut that block by its FIRST marker) and also answers to `pure:class-type`, `pure:bookings-card`, `pure:day-pager` and `pure:offline` through the markers around it, so each of those can still be evaluated alone; function declarations only, because a suite may evaluate two of them in one context.

### Time row and countdowns

The Time row's labels are static and 24-hour too ("Before 9:00 · 9:00–17:00 · After 17:00"; the band keys `early` / `day` / `evening` and their hours are unchanged). Countdowns ("In 2h 5m", "2d 4h"), durations and dates are not clock times and are untouched.

### 12-hour marker guard

tests/suites/10a-time24.js holds the formatter, the derived copy, and FAILS if a 12-hour marker comes back in shipped source (an `'am'` / `'pm'` literal, `% 12 || 12`, `hour12: true`, `toLocaleTimeString`, or "7:00pm" in a string). NOT covered (native, a separate wave): the widget / Live Activity print through SwiftUI's `.dateTime.hour().minute()`, which follows the device's own 12 / 24-hour setting.

### Native clock and zone

**Native clock and zone — this supersedes the last sentence of the paragraph above ("NOT covered …") and the "parser using `.current`" wording of the device-local bullet.** The widgets, the Live Activity and Siri print every time through Swift `PsycleClock` (ios-app/ios/App/PsycleShared/PsycleClassType.swift): fixed "HH:mm", POSIX locale, Gregorian calendar, so the phone's 12 / 24-hour switch cannot rewrite it. `sh ios-app/native-checks/run.sh` and tests/suites/11-native-snapshot.js hold it; no `.dateTime.hour()` is left in the Swift sources.

The device ZONE comes from ONE line — `PsycleFixedFormat.formatter` sets `.autoupdatingCurrent` — and `PsycleDateParser`, `PsycleWeekDay.date` and `PsycleClock` all share that formatter. What that does to countdowns abroad: [ios.md](ios.md) → "Snapshot time contract". Whether it may change: agents/decisions.md section 4 (CLOSED).
