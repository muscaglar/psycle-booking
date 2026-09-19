# Improvement Programme — September 2026

> **STATUS (2026-09-18): implemented and committed (`3da5392..a9d4a9b`).** Every web-layer change below is
> unit-tested and was checked in a browser against a stubbed API; the native (Swift / Capacitor-only) changes are
> covered by unit tests of their JS decision logic where one exists and by an unsigned simulator compile only.
> `npm run ci` is green at `a9d4a9b`. **Nothing here has been run on a physical iPhone yet** — the
> [on-device checklist](#on-device-checklist--still-owed) at the end is still owed. The items under
> [Deliberately NOT changed](#deliberately-not-changed--owner-decisions) are decisions, not omissions.
> What shipped after that range is recorded as follow-ups at the end of the [Summary](#summary).

This file is the audit trail for the programme. CLAUDE.md describes the resulting architecture; this file records
what moved, why a few things did not, and what still has to be looked at on a real device.

## Summary

In September 2026 the whole app was reviewed again, on top of the July 2026 full-app review's fixes and the August
move of waitlists onto Psycle's real `/waitlists` API. Most of what it found was about integrity: a booking must
never be doubled, announced before it exists, or cancelled by the wrong id; a session must not be thrown away
because Psycle could not be reached for a minute; one member's data must not become another's; a calendar must
not be emptied without being asked. The rest was speed and freshness on Discover, an offline story that cannot
spend credits by surprise, accessibility, new Lock Screen widgets, and a long tail of copy and layout. It landed
as seven commits on `improvements/best-app-pass`:

| Commit | Subject |
|--------|---------|
| `67a92f8` | Tests: load per-feature suites from tests/suites and slice pure blocks by name |
| `8b63b62` | Fix booking integrity, session state, filters and Cloud-theme readability |
| `ba70f94` | Faster, fresher Discover; clash warnings; offline saved bookings; update prompt |
| `6530770` | Spots left, time-of-day filters, faster list, accessibility, more tests |
| `4c5e6e3` | Safe offline queue, usual-week booking, history sync, Lock Screen widgets |
| `470693b` | Calendar safety, per-account data, booking races, waitlist and Monday release |
| `a9d4a9b` | Final polish: token hygiene on retries, booking dead end, stats and a11y fixes |

Range: `3da5392..a9d4a9b` (base `3da5392` = "Waitlists: use Psycle's real /waitlists API (join, list, leave, claim)
(#9)"). 117 files changed; the unit-test assertion count went from 126 (at `3da5392`; 128 after the first commit)
to 4,859.

### Follow-up: none of it reached TestFlight until `8f8c62c`

Every Xcode Cloud archive for the seven commits above **failed**, all with the same ten errors: "The iOS deployment
target 'IPHONEOS_DEPLOYMENT_TARGET' is set to 13.0, but the range of supported deployment target versions is 15.0
to 27.0.x". It had nothing to do with the changes: Xcode Cloud had moved to Xcode 27, which rejects targets below
15.0, and the project plus the nine Capacitor pods still declared 13.0 (the last green archive was `3da5392`, built
with the previous Xcode). GitHub's unsigned iOS build check stayed green throughout because its runner has an older
Xcode, so the failure was only visible as the Xcode Cloud check on each commit.

`8f8c62c` raises the project and app target to 15.0 (the widget extension stays at 16.1) and has the Podfile's
`post_install` lift any pod below 15.0 — Xcode Cloud runs a fresh `pod install`, so the floor has to live in the
Podfile. The archive for `8f8c62c` succeeded. **The app now requires iOS 15 or later.** How to read the archive
result for a commit is in `ios-app/CICD.md` under "Notes / gotchas".

### Follow-up: that first Xcode 27 build crashed at launch

The archive was green and the upload succeeded, but the build crashed on launch on the owner's phone. Cause: from
the iOS 27 SDK, UIKit kills any app that has not adopted the scene life cycle ("UIScene life cycle is required for
apps built with this SDK"), and the Capacitor 6 template is app-delegate only. Every earlier build was made with an
older SDK, so none was affected. The fix adopts scenes by hand (Capacitor itself only did so in 8.5): a scene
manifest in `Info.plist`, a `SceneDelegate` that hands URL opens and user activities to Capacitor's proxy and the
active / background moments to the AppDelegate's handlers, and a version-pinned patch so Capacitor's temporary
presentation window (the in-app browser) joins the scene. Details in `ios-app/CICD.md` → Notes / gotchas.
**A green archive proves nothing about launch — open the TestFlight build on a phone.**

### Follow-up: the Lock Screen widget cut its text off (`177fca3`)

On a phone the rectangular Lock Screen widget ended long lines in "…" — "STRENGTH: FULL B…", "Westbourne Grove ·
Bed…" — because every line had one fixed font and a one-line limit. Each line now picks the largest of three sizes
that shows all of its text; only the smallest may tighten, shrink and finally truncate. The seat moved up beside the
time ("Wed 18:30 · Bike 12"), so the location has a line to itself — "location · seat" was the line most often cut.
The inline widget above the clock uses a system font, so length is its only lever: it drops the weekday for a class
today, and a long class name keeps the part before its colon. Rendered in the simulator at the three accessory sizes
(172×76, 160×72, 148×66) with long class names, several seats and long locations, only a 29-character class name
still truncates, and only at the smallest size.

### Follow-up: a product designer's review of the iPhone app (`da07956`)

- **Discover shows one day at a time.** A day strip under the date row carries each day of the range with its class
  count. Swipe the list left or right, tap a day, or use the arrow / Home / End keys in the strip; every change is
  announced, and the heading carries no previous / next buttons. The list follows the finger, snaps or springs back,
  and resists at the ends; a swipe never fights vertical scrolling, pull-to-refresh, the scrolling pill rows, an open
  dialog or a busy Book button, and pinch-zoom still works. The chosen day survives filter changes, background
  refreshes and streamed results. An empty day says so once and offers the next day with classes; a day Psycle has
  not released yet, or that a partial timetable has not loaded, says that instead of "no classes". Only the visible
  day's cards are in the page, so a 14-day range is much lighter. A single day looks as before.
- **"7 days" means seven days and "14 days" fourteen** (they drew 8 and 15). Saved filters are re-derived from the
  preset, so old saves still restore.
- **The date row is always on screen.** Time, Location, Class type and Instructor sit behind one Filters button,
  collapsed at launch, with a count of active filters and removable chips that clear through the panel's own
  controls.
- **Stats is three sub-pages** — Overview, Habits, Instructors — behind a segmented switcher: a real tab list with
  arrow keys, swipeable, remembered for the session. An empty page says so in one line; signed out shows only the
  sign-in hero.
- **A full-screen welcome** with a short swipeable tour replaces the four-card modal. It is illustrated with the
  app's own components, says that Psync is independent and not affiliated with Psycle, and always offers Skip.
  Members who finished the old tour, or who are signed in, never see it; Settings can show it again. The one-time
  "Swipe to change day" hint is not shown to someone who has just been through the welcome.
- **Leaner copy.** Subtitles that restate a heading or explain how something is worked out, instructions for obvious
  controls, exclamation marks and cheerleading were removed. Everything about credits, the late-cancel window,
  waitlist charges, the calendar hand-over, offline actions, sign-out, import / export and error recovery is
  unchanged.

Assertions: 4,859 → 5,691.

### Follow-up: the new look (`2b17154`)

The direction the owner and their designer chose after three rounds of concepts: clear, time-led rows and
pictograms, soft round shapes, colour that means something, and a sparing glow on what is yours.

- **Type and chrome.** Sofia Sans Condensed for times, numerals, headings and the wordmark, Sofia Sans for
  everything else; both self-hosted (two 40 KB files). Cloud, the default, became a cool graphite chrome and Graphite
  its dark counterpart; the flavour themes kept their palettes and took the same shapes, type and components.
  Generous radii (Handheld stays square), one soft shadow, no offset shadows or gradient washes. Buttons, chips,
  segmented controls, badges and toasts are one set of shared parts in css/crisp.css, which loads last.
- **Colour means class type, and is adjustable.** Ride, Strength, Yoga, HIIT, Pilates, Lagree, Barre and Other each
  have a colour set and a pictogram; cards, tiles, the class sheet, the seat map, seat chips, the glow and the Stats
  breakdown read the same tokens, and the old hard-coded category colours are gone. Membership → Appearance → Class
  colours sets the intensity — Off, Soft (the default, much paler than the concept) or Bold — and a colour per class
  type from a curated palette. Every swatch ships precomputed light and dark values, so text contrast holds whatever
  is chosen, with no colour maths at runtime. The choice applies everywhere at once, persists
  (`psycle_class_colours`), is mirrored on iOS and travels with settings export / import. Terminal and Handheld stay
  near-monochrome unless Bold is chosen.
- **One class card** on Discover, My Bookings and the usual-week card: time first, pictogram tile, class,
  "instructor · studio", availability, one action. Booked classes and your seats glow; the chosen day is a graphite
  pill with a glow. My Bookings keeps Cancel and Change spot on the card and moves Add spot, Find similar, Map and
  Share into a More menu; Cancel is a calm outline, red only inside the late-cancel window. The floating next-class
  pill no longer covers the last card's actions.
- **Sheets, picker, Stats, welcome, sign-in.** Round seats with clear available / taken / yours / usual states, the
  class type's colour, one full-width primary pill, and a confirm bar that stays on screen on small phones. Stats
  has a hero all-time numeral, streak bars, a neutral heatmap and class-type bars in the class colours; the share
  image is redrawn in the new faces. The welcome, instructor profile, history, dialogs and the sign-in page follow.

Behaviour was unchanged — booking, cancelling, waitlist, offline queue, calendar sync, search, the day pager and
filters work as before — apart from a light haptic on a day change by swipe and a focus ring that is visible again
on accent-filled controls. Assertions: 5,691 → 6,919.

### Follow-up: the owner's notes on the new look

Three decisions after living with the new look — 24-hour times, a quieter clash warning, two themes fewer — and the
small visual leftovers it shipped with.

- **24-hour times everywhere.** Every time the app prints or speaks is "HH:MM" — "06:30", "18:30" — through one
  formatter (`_clock24` / `_clockOf`, js/app.js `pure:clock`), read from the class's wall-clock digits exactly as
  before: cards, the class sheet, the picker, dialogs, toasts and spoken labels, "Free cancel until Sun 19:30",
  waitlist "accept by 17:45", Stats ("Mondays ~07:00"), the usual week, history, the share text and the welcome's
  illustrations. The class card shows the time over the duration alone ("18:30" / "45 min"). The Time row reads
  "Before 9:00 · 9:00–17:00 · After 17:00" and wraps: in those words its four controls are wider than a phone, and
  "Available only" sat half off the edge. A test fails if a 12-hour marker comes back into shipped source.
  **Not covered:** the widget and the Live Activity format their times in Swift and still follow the phone's own
  12 / 24-hour setting.
- **The clash warning is one quiet line** — the sentence in the body ink, led by a small ringed "!" in the theme's
  caution colour; no amber band, no chip — in the class sheet, the seat picker, confirm dialogs and the usual-week
  sheet, and readable in every theme. The wording is unchanged and it is still advisory. The late-cancel warning
  keeps its caution ground on purpose: that one costs a credit.
- **Linen and Synthwave were retired.** A saved, deep-linked or imported id of theirs reads as Cloud / Graphite and
  is rewritten once, so nobody is dropped onto the system scheme. Five themes remain: Cloud, Graphite, Terminal,
  Handheld, Blueprint.
- **Terminal and Handheld lay the date row's five ranges out in two rows on a phone** — the leftover the new look
  shipped with ("14 days" sat clipped at rest). The favourite star is a per-theme token (`--fav`, ≥ 3:1 as a graphic)
  instead of one hard-coded gold, which was 1.2–1.6:1 on Cloud.
- **The floating next-class pill steps aside** while a list is scrolled down and comes back on scroll up, at the top
  and at the end of the list — on every tab, never while a dialog is open. Tucked away it lets a tap through to the
  card under it, and it is reachable by keyboard and screen reader exactly as before (focus brings it back). At rest
  it never sits on a Book button either: on a phone, the top of a Discover day used to leave the fourth card's Book
  button under the pill's seat badge before any scroll, and a tap there opened My Bookings. It now stands aside
  while the middle of a Book button is under it and returns when nothing is (a button with only its edge under the
  pill is left alone); a scroll up still calls it back wherever it lands.
- **Desktop (≥ 1024px).** Discover is two columns — the filters pinned on the left, the day strip and the cards in a
  readable column on the right — so the first class is on screen without scrolling (it sat about 710px down, under
  always-open filters, and a card ran 1,032px wide). The class sheet is a centred dialog 520px wide (it used to
  shrink to its content, about 293px — narrower than on a phone) and the seat picker 560px. "Clear filters" shows
  only while a filter is on. Phones and tablets are unchanged.
- **Found in review of the above, fixed before it shipped.** Year in review's "Favourite time" is the busiest hour at
  its most common minute ("18:30" — as a bare hour in HH:MM it read "18:00", a time an 18:30 regular never trains
  at). A waitlist offer's "accept by 17:45" is London wall clock like the class time above it (through the phone's
  own clock it could read later than the class starts). Desktop: a short list no longer opens blank bands above the
  travel notice and the first card; the filter column hands its scroll on to the page, so its last control is never
  stuck under the window's edge at the top of the page; "Clear filters" is shown on a warm launch with favourites
  pre-selected, and pressing it from the keyboard moves the focus to the date row instead of dropping it. Handheld:
  the next-class pill wears a hairline, so at rest it no longer merges with the card under it.
- **`ios-app/UPGRADE-CAPACITOR-8.md`** is a step-by-step Capacitor 6 → 8 upgrade for this project: versions, the
  order of commands, what replaces the hand-written scene forwarding, what happens to each plugin patch, a device
  checklist and the rollback. It has not been run — it needs `npm install`, a regenerated lockfile and a phone.
  Its most important finding: the calendar plugin's call shapes change between 6 and 8 in ways that fail silently
  (`notes` → `description`, `alertOffsetInMinutes` → `alerts` with the sign flipped, `listEventsInRange`
  `{startDate, endDate}` → `{from, to}`), so the bridge and its tests have to change with the packages.

Assertions: 6,919 → 7,178.

### Follow-up: a new mark, the widgets in the new look, and the App Store set

**The mark** (`11a0ee8`). The owner chose it from two rounds of options: two slipped half-discs with growing arcs
engraved in them, with no hue of its own. It is the app icon (with the dark and tinted appearances iOS 18 offers),
the launch screen (mark over the wordmark on the app's ground, light and dark — there was no dark launch screen
before), the web icons, and the mark in the header, the welcome and the sign-in page, where it is drawn in the
theme's two inks and replaces the five class-coloured bars. Sources and a rebuild script live in `assets/`; a test
holds every drawn copy to one geometry.

**Widgets and Live Activity** (`3e7ad33`). The Home Screen and Lock Screen widgets and the Live Activity now share
the app's language: the time leads, always 24-hour; the class type's pictogram in a tile; the class tint as the card
ground; the seat chip in the class colour; a countdown that turns to "Now". Colour follows the member's own
choices — the app writes the class type, its colours for light and dark and the chosen intensity into the widget
snapshot and rewrites it when they change. Every new field is optional, and a Live Activity started by the previous
build still decodes (checked by decode tests that run, `ios-app/native-checks`).
- **A bug older than this work was fixed with it.** The Swift date parser followed the phone's locale and its
  12 / 24-hour setting. On a UK phone set to a 12-hour clock it returned nothing for the snapshot's times: every
  widget read "No upcoming class", no Live Activity started and Siri said there were no classes. One fixed-format
  parser and formatter is now used everywhere (the device's time zone is kept, by the owner's decision).

**The Settings header sat under the status bar** (`19508b3`). Reported by the owner from a phone: on the bike
preferences screen the title and close button overlapped iOS's "back to app" link. On a phone the Settings panel is
a full-screen sheet and its older stylesheet pads the header past the status bar; the new-look stylesheet, which
loads last, set that header's `padding` as a shorthand and silently dropped the inset. It is re-stated, and
`tests/suites/13-safe-area.js` now fails if the last stylesheet ever again sets a property an older sheet gave a
safe-area inset without carrying the inset too. An audit of all 20 inset rules found no other casualty.

**The App Store set.** Six new 1290 × 2796 screenshots in the new look and the store icon sizes, rebuilt by one
command from the real app running on a fake Psycle server (`node tests/tools/appstore-shots.mjs`). The old set
showed an app that no longer exists.

Assertions: 7,255 → 7,429.

### Follow-up: your usual week

The owner, of the card's one button: *"'Book my usual week' is great. But I'm scared to press it — what will it do?
Will it confirm for which time frame I'm about to book? Will it allow me to select 2 or 1 slots accordingly?"* And
then: let the section collapse so it takes less room; have an opinion on the spots, but guide the member through
it; remind them on Mondays at 12:00 to book the weeks ahead; and — "I think we can book up to 3 weeks ahead. If
yes, I want that reflected in the pop up."

**First, how far ahead Psycle really books — observed, not documented.** The API never says when booking opens (a
class carries `bookable_until` only), so it was read off Psycle's public timetable — read-only — on Saturday 19
September 2026 (Oxford Circus, seats taken per day). Classes were *listed* through Thursday 15 October, 26 days
out, but really *booked* only through Thursday 8 October, 19 days out: the Thursdays 24 Sept / 1 Oct / 8 Oct /
15 Oct carried 295 / 83 / 61 / 1 seats, the Mondays 21 Sept / 28 Sept / 5 Oct / 12 Oct 509 / 153 / 61 / 3, and
Friday 9 → Thursday 15 October a trickle of one to three a day. So each Monday-12:00 release opens ONE seven-day
batch — the Friday 18 days on to the Thursday 24 days on (14 September opened Fri 2 → Thu 8 October) — and the
timetable lists one batch further than is open. The trickle is members whose credit type carries an
`extended_booking_period` ("+1 week" on Extended Booking / Classpass / All Access, "+3 weeks" on Promotion) and
may book that batch early. So: yes, about three weeks ahead.
- **The app's old rule was wrong, and is gone.** "A Monday–Sunday week opens at noon on the Monday before it"
  (`_weekOpensMs`) is deleted with what was built on it: Discover's "Next week opens Monday 12:00" empty state —
  next week has been open for a fortnight by then — and the day pager's per-week "Booking opens …". Both now ask,
  per DAY, whether Psycle has *listed* it yet ("Not on the timetable yet"); only a date picked in the calendar
  reaches that far. The date they name is worded "Booking usually opens Monday 5 October, 12:00": it is this
  model's arithmetic, not Psycle's word, and members who book a batch early would find it a week out.
- **The model may suggest and explain — never block** (`window._bookingHorizon`, js/app.js `pure:horizon`: three
  named constants, commented as observed on that date). A class that is listed can always be tried, and Psycle's
  own answer is shown as it is. If Psycle changes its release pattern, the cost is a wrong default or a wrong
  advisory note — never a refused booking.

**The card folds, and its button says what it does.** "Your usual week" is a disclosure: folded it is one row —
"Your usual week" over "4 classes · Show" — with the primary still on it, so collapsing saves the space without
hiding the one thing people come for. It remembers the choice on the device (and through an iOS storage purge),
opens expanded until the member folds it, flips in place — the pressed button keeps the focus and its own state is
the announcement, no toast — and is no longer rewritten when nothing changed (it used to be repainted on every
bookings and sign-in event). The button reads **"Review and book"**: it opens a review and books nothing, and now
says so. An entry that books more than one seat says "2 seats".

**The sheet answers the owner's three questions before anything is spent.**
- *For which time frame?* A dates control: **Next 7 days** and the next **three** Monday–Sunday weeks ("21 Sept ·
  28 Sept · 5 Oct"), plus "Newly opened · Fri 9 – Thu 15 Oct" first and selected when the Monday reminder opened
  the sheet or the release is under a day old. The chosen range is the first, bold line, over the unchanged
  "Nothing is booked until you press the button below." It opens on the first range with a usual class not yet
  held. A class past what Psycle has opened starts UNTICKED with "May not be open yet — Psycle opens new dates on
  Mondays at 12:00" — and stays tickable.
- *One seat or two?* Each bookable row has a seat count, starting at what the saved week held (1 · 2, and 3 · 4
  only when the entry asked for them), never above the class's own `max_bookable_slots`. A waitlist row has none:
  Psycle allows one place per person. A saved entry remembers its `seats`; storage is not trusted, so the number
  is coerced where it is read and bounded again before anything is sent.
- *Which spots?* **An opinion, shown — never silent.** Every ticked row shows the spot(s) it suggests and why,
  from one read-only look at that class: "Bike 12 · your usual", else one you prefer, else "closest to your usual —
  9 is taken", else "first free"; never a spot on the avoid list while another is free; further seats as close to
  the first as the layout allows. **Change spot** opens the REAL seat map in a choose-only mode that books nothing
  ("Use bike 12", Back, Escape = no change) and the row then reads "your pick".
- The button counts the spend — "Book 3 classes · 4 seats" — and only rows whose spots are on screen are counted
  or run ("Checking the spots…" meanwhile). One quiet caution line when the ticked seats exceed what the plan
  shows left; never a block.

**The run books exactly what was shown.** Each row is ONE `POST /bookings` with the very spots on screen — the old
run booked one auto-picked seat ("your usual spot or the first free one"), and that auto-pick is gone. A shown
spot taken in the meantime books NOTHING for that row ("Bike 9 was just taken — not booked. Choose again") and the
run carries on; "Choose again" re-plans the same dates with the ticks kept. A class already held with fewer seats
than asked reads "1 of 2 seats held — tick to add 1 more", starts unticked, and adds only the missing seat.
Studios with no spot map — skipped until now — are booked as a count ("2 spaces · no spot to choose at this
studio"), for a studio positively known to have none and never retried. A clean refusal is shown in Psycle's words
("Psycle said: …"): inside what is open it still stops the run (credits, plan — the next class would meet the same
wall); past it, it is the expected answer and the run carries on. A lost, 5xx or 409 answer stops the run exactly
as before, and a booking POST is still never re-sent.
- **One behaviour change to know.** A ticked WAITLIST row whose class has a spot again by the time the run reaches
  it is no longer booked on an auto-picked seat — no spot was ever shown for it. It reads "A spot has opened up —
  nothing was joined. Choose again to book it".

**The Monday reminder fires at 12:00 and points at the usual week** (iOS). It fired at 11:59 and said the week
"opens at 12:00"; it now fires AT the release — "New Psycle dates are open" — with "Book your usual week for the
dates that just opened." when a usual week is saved, else "Find your classes for the dates that just opened."; the
sentence follows a save or a clear at once. Same eight rolling one-shots at absolute London instants under the
same ids, so an older build's 11:59 reminders are replaced, never doubled. **The tap** used to select "Next week"
— by the model above the wrong week, open a fortnight already. With a usual week it now opens My Bookings and the
review sheet on the newly opened batch (the tap books nothing); without one, Discover on that batch's first day,
not saved as the launch default. It keeps its patience — not before launch is done, never over a dialog or a
booking in progress, 15 seconds by the clock — and the review also waits for a verified session. **Offered once, in
context:** after a usual week is first saved the app asks "Remind you on Mondays at 12:00, when new dates open?"
(iOS's own prompt only follows an in-app yes; never at launch; a stored on or off is already an answer). On the
web nothing appears where it cannot work.

**Found while the three parts were put together, fixed before it shipped.**
- A reminder tap that arrived while the review sheet was already up was held back by that very sheet, kept
  polling, and re-opened it the moment the member pressed "Not now". With the review on screen the tap now stands
  down. A sheet that spends credits never comes back by itself.
- The card and the sheet read a saved entry's `seats` by different rules: a stored `"3"` (text, which only a
  tampered or imported store can hold — the app writes a number) was one seat on the card and three in the sheet.
  Both now read it as one — the side that can only make the sheet start lower — and a test runs the two shipped
  functions over one table.
- The first-booking reminder ask could open over a usual-week run (a run announces each seat as it lands). Both
  iOS asks now wait for the sheet.
- The release model is written down twice (the horizon's constants; the reminder tap's stand-in numbers). A test
  now fails if the tap's batch and the sheet's "Newly opened" batch ever stop being the same seven days. The suite
  that was meant to prove "the horizon wins, and one that throws costs nothing" had stopped proving either once
  the two met — its fake was silently replaced by the real function.

**Found by the reviews of the finished wave, fixed before it shipped.**
- **"Choose again" re-ticked rows by their position alone.** A seat that went while its class filled came back as a
  PRE-TICKED "join the waitlist" (one press from a place Psycle turns into a charge); a class just booked at one
  seat of a saved two came back as a pre-ticked "add 1 more"; and every kept row went back to the SAVED seat count.
  The sheet now remembers what was ticked — the class, its state, top-up or cover, the seats asked for — and a tick
  survives only on a row that is still that; anything else starts as any fresh row does. The member's own count
  and spot come back with it.
- **A ✓ was read as "this booking landed".** It only ever means "Psycle shows a seat in this class" — and for a
  class already held, the seat held before earns it. A top-up whose answer was lost, or a 5xx, was reported
  "Booked ✓" and the run carried on; a 409 too, with nothing added; a seat top-up whose spot went read "Only part of
  this was booked". The seat step now also needs the booking to have GROWN by what was shown; an unverified answer
  stops the run ("Couldn't confirm with Psycle"), a spot that went is "just taken — Choose again", and a count that
  did not grow is settled by one more look at the bookings.
- The third week's Friday–Sunday, opened on a Monday morning, read "No matching class that day" — the days are
  simply not on the timetable until 12:00, and now say so.
- A reminder tap with the review sheet ALREADY open (opened at 11:58 to be ready) did nothing, so "Newly opened"
  was never offered. An idle sheet now takes the tap and lists afresh with that batch first — never during a run,
  over the seat map, or over a run's results.
- **On a short phone the pinned text left the class list almost no room** — in Terminal / Handheld none, with the
  buttons pushed past the dialog while "Book 2 classes" stayed live. The list keeps a floor of up to three rows,
  the dialog scrolls when that does not fit, the buttons ride its bottom edge, and the long waitlist sentence is
  shown only while a waitlist row is ticked. "Newly opened · Fri 25 Sept – Thu 1 Oct" wraps inside its track
  instead of sticking out of it; the focus ring of "Change spot" is no longer cut by the list's edge; a rule at
  each end of the list shows a cut row as "more below".
- **…and that fix had a catch of its own:** because only the list gives, ticking a waitlist class — which brings
  the waitlist sentence up — shrank the list under the very row just ticked (375 × 667, Cloud: 3px of it left in
  view, keyboard focus still on its box). The row the member is on now stays on screen: after a tick, a seat
  count, "Try again", the way back from the seat map, and when that row's spots read lands, the list scrolls
  itself by the least that shows it (never the dialog or the page; measured in layout px, because the dialog is
  still scaling in during its first moments).
- The plan-caution line was written into a hidden live region and then revealed — silent to VoiceOver. It (and the
  waitlist sentence) is announced when it appears.
- **The Monday-reminder offer could only follow a save**, so a member whose usual week came from the previous
  build was never asked — and one who opened the review straight after saving lost the ask to its 40-second
  patience. It is offered when the review sheet closes too (once, by the same rules).
- Smaller: a failed row prints what was said at the time instead of "see its message" (the toast had faded);
  three or four seats read "Benches 5, 6, 10 & 11"; a suggestion that passed over a lower free spot the member
  avoids says "first free you don't avoid"; with nothing booked the usual-week card sits ABOVE the "Nothing
  booked — yet" hero, not under it.

**Decisions the owner may want to overrule.** The primary sits in the card's head in both states (so nothing moves
when it folds) and "Clear" moved down beside "Update from my bookings". "1 of 2 seats held" starts unticked. The
Discover route of the reminder tap shows ONE day, the batch's first — the date row cannot name a custom range
yet. The Settings row reads "Monday booking reminder — Mondays at 12:00 — when Psycle opens new dates" ("Monday"
twice; and no "UK", though the reminder always fires at London noon). The second seat is the free one closest to
the first, which can be the seat in front rather than beside. The button counts a no-map studio's spaces as
"seats". "Not now" to the offer leaves the reminder unset rather than writing "off".

**Not covered.** Nothing here has run on a phone (checklist below). Count bookings for studios with no spot map
are as unproven against the live system as they are from Discover. Terminal's chosen segment — every `.seg` in
the app, the sheet's two included — is white on its green at 3.3:1. On the smallest phone in a mono theme the
sheet's list shows about one row at a time (its floor), and the rest of the sheet scrolls under the buttons. The usual week
(`psycle_weekly_template`) is still not part of a settings export. The App Store listing still says "when new
booking week opens".

Assertions: 7,436 → 7,953.

## How it was done

A multi-pass review: discovery, independent verification of each finding, implementation in small patches,
adversarial code review, and browser verification against a stubbed API. A second discovery round was run on the
changed app to look for regressions and for what was still missing, and its findings went through the same passes.

- Every web-layer change was unit-tested — most through a `pure:<name>` block or a slice of the shipped function
  run against fakes (tests/README.md) — and then checked in a real browser with the API stubbed inside the page.
  Native behaviour is the exception: the Capacitor-only paths (status bar, share sheet, calendar hand-over,
  notification taps) have unit tests for their JS decision logic where one exists, but none of them could be
  exercised in a browser — they are on the [on-device checklist](#on-device-checklist--still-owed).
- **Nothing was ever written to the live API.** Psycle's API is a real booking system; every browser check
  replaced both `window.apiFetch` and `window.fetch` for the API host before anything was clicked, and each round
  confirmed that no write had left the page.
- The Swift changes (widget families, the widget deep link, Live Activity seat updates) were compiled with an
  unsigned simulator build of the full App scheme, and rebuilt after the last Swift edit. An unsigned build carries
  no entitlements, so it proves the code compiles — not that a widget can read the App Group on a phone.
- The final browser round swept the whole app for regressions in all seven themes. Its visual notes are the source
  of [Known small leftovers](#known-small-leftovers).

## What changed

### Booking & cancelling

- **No accidental second seat.** The pre-selected "usual" bike plus a tap on another bike used to book both; the
  first tap now replaces the pre-selection. Adding a second seat no longer wipes the first from local state.
- **A booking is only announced when it is real.** A booking that times out or gets a 5xx / 409 is announced only
  after `/bookings` has been re-read (bounded, so a tap always settles), and that POST is never re-sent
  automatically. Until the re-read clears it, no further booking for that class goes out. Bookings are re-read after
  every POST, because that list is the only source of per-seat record ids.
- **Book waits for your bookings.** After a flaky launch every card reads "Book", held classes included — Book now
  waits for the member's bookings to load, so a class already held cannot be booked twice.
- **Latest tap wins.** Two quick Book taps on different classes: only the latest opens a picker and the earlier
  button is restored.
- **Cancels only delete what they can prove.** Per-seat and whole-booking cancels only delete records proven to
  belong to the seat or booking; when local state cannot say, `/bookings` is re-read, and if it still cannot,
  nothing is sent.
- A refused booking (403 / 422) no longer leaves the button styled as booked.
- **Seat maps come from the class when the cache has none.** A seat studio whose cached record lacks its map takes
  it from the class detail instead of falling into the no-layout "Book this class?" path — for single bookings, for
  "+ Add spot" on a card whose studio has not loaded yet, and for the usual-week run. If the studio cannot be
  resolved at all, no confirm appears and nothing is sent. Booking by count stays exclusive to studios known to have
  no layout.
- **Clash warnings.** Booking a class that overlaps one you hold — or leaves too little time to get between two
  locations — says so in the confirm dialog or the bike picker. It warns and never blocks. A waitlist place at the
  same time is mentioned as a possible seat.
- The bike picker states the late-cancel deadline, fits the phone sheet and scrolls to the relevant seat; its
  dismiss button reads "Close" while it is showing your booking. Declining "Book another space?" leaves
  "+ Add spot" as it was.
- Booking learns fresh availability and writes it back to the list, so a class that has just filled does not read
  "Book" again after a background refresh.
- Failure messages use member wording instead of "HTTP 500", "Load failed", a raw "Server Error" or a bare status
  code — for booking, cancelling, waitlist and swap. Psycle's own business messages are still shown. Cancel toasts
  promise a retry only on the paths that really queue one.
- The "Booked!" sheet can no longer get stuck when two bookings settle within a fraction of a second.

### My Bookings

- "Similar" works again, every booking has a Cancel button, tapping a card opens the class sheet, and Share is back.
- Cards and the booking confirmation show **"Free cancel until …"**, computed in Europe/London so it is right
  abroad. Countdown chips, the cancel dialog and that line all read the same London class time and agree on wording.
- Travelling east of London no longer files a class starting in the next few hours as past. The tab badge, Stats
  "Upcoming" and the next-class pill agree with the list.
- **First paint without waiting.** My Bookings paints immediately from saved class details instead of waiting for
  one request per booking; the details refresh in the background and are never treated as server-confirmed by the
  calendar or the widget. "Change spot" and the class sheet's seat button wait for such a card's details instead of
  erroring.
- **Your usual week** is back, with a preview. "Save my usual week" from the classes you hold, then "Review and
  book": the sheet lists every class and what will happen (book, waitlist, already booked, clash, no match), and
  nothing is sent before the explicit "Book N classes". Waitlist joins are opt-in, classes are booked one at a
  time, the run stops on an auth or credits error, and a per-class result is shown. (As first shipped the button
  read "Book my usual week", each class was booked on one auto-picked seat and studios without a seat map were
  skipped — see *Follow-up: your usual week* for the weeks ahead, seat counts, shown spots and the folding card.)
- The list skips re-rendering identical content, and one 60-second ticker updates countdowns in place.
- Usual-week entries wrap so the location stays visible; the last card can scroll clear of the floating next-class
  pill.

### Session & accounts

- A `/profile` failure with a token present shows **"Can't reach Psycle — Retry"** instead of signing the member
  out. Expiry stays 401-only. A locally expired token keeps the offline saved bookings.
- Sign-out clears the previous account's bookings, plan, pill and widget data; the hidden next-class pill is
  emptied after sign-out and on an account change.
- A request that is between retries when the member signs out, or the session expires, stops instead of going out
  again with the old token. A signed-out member gets no "queued action" toast.
- Plan usage refreshes after booking, cancelling and on resume. Book while signed out asks to sign in instead of
  opening the token dialog. The welcome history prompt stays dismissed.
- **Device data now has an owner.** When a different customer signs in, the previous member's rankings,
  favourites, bike preferences and history, usual week, recent searches and watchlist are stashed (written before
  anything is removed) and restored when they return. Class history is cleared for the newcomer, who is offered a
  sync of their own. Unstamped data from before is adopted. A storage error can never block sign-in.
- **Settings import** validates every key, shape and size, rejects prototype pollution and unknown keys, and asks
  before touching a device that already holds data. Ids and seat lists read from storage are sanitised where they
  are read and escaped where they are rendered (instructor links and chips, history, both seat maps).
- **Sign-in page:** real form semantics and autocomplete, a 15-second timeout, only real credential failures count
  towards the lockout, friendly 429 handling, a content security policy, frame busting and a referrer policy. A
  full localStorage frees re-creatable caches and retries instead of reporting a network error.
- The token-expiry timer no longer spins when the expiry is more than 24.8 days away.

### Discover

- **Instant dates.** Picking Today, Tomorrow or any day inside the week already loaded re-renders at once with no
  network calls; it used to refetch every studio and blank the list.
- **Never a truncated timetable.** A refresh interrupted by a filter tap can no longer save a partial timetable: it
  only lands if every studio answered and the date range is still the one on screen.
- **Honest freshness.** Cached timetables older than 15 minutes are refreshed quietly in the background. The first
  open of the day shows the still-valid part of yesterday's cache at once, then refreshes. Coming back the next day
  rolls "Today" forward and drops started classes. Pull-to-refresh works on Discover, and coming back online
  refreshes it too.
- **Availability on cards** — "Only 2 left", "25 spots left", "Waitlist open", "Fully booked". The API sends
  capacity and occupancy, not the field the cards used to read, so this had never rendered. Counts are only shown
  while the timetable is under 30 minutes old and re-sync after you book or cancel in place. The class sheet shows
  availability instead of a duplicate duration row.
- **Time row** — Before 9, 9–5, After 5 and "Available only". It filters the loaded timetable instantly, is saved
  with the other filters (and with recent searches), and never hides a class you are booked or waitlisted on.
- **"Next week"** date preset (next Monday to Sunday), and the **Monday release**: a timetable fetched before
  Monday 12:00 London time is never treated as fresh afterwards; while Discover is open it refreshes at the
  release; tapping the Monday reminder opens the dates that release opened — the usual-week review, or Discover on
  their first day — without making it the saved launch default. (It opened "Next week" at first: the wrong week —
  see *Follow-up: your usual week*.)
- "Find similar", "Book again", "View schedule / classes" and the habit shortcuts clear the filters they do not
  mean, so the promised classes are not hidden; "Same time" means that day. "Book again?" ignores classes you
  already hold.
- Day headers stick while you scroll on phones and read Today / Tomorrow. A restored date pill is scrolled into
  view inside its row.
- Error and empty states have actions (Try again, Tomorrow, Next 7 days, Clear filters, Sign in); server errors are
  classified properly, so the "Showing your last results — couldn't reach Psycle" fallback is reachable. A search
  made while studio data is still loading shows loading, not "No classes found".
- Saved filters restore correctly ("14 days", past dates, Clear filters); hidden Strength / Reformer sub-filters no
  longer filter; pagination no longer skips a class that shares a start time with the last event of a full page;
  tab switches and pull-to-refresh use the real mobile scroller.
- An "S/A" quick filter appears beside Favs once an instructor is ranked S or A.
- "New to you" and "You might like" moved from under the timetable to Stats.

### Waitlist

- The card says what is true — waiting, offer window open, or waitlist closed — and an open place is re-checked
  quietly while the app is visible. **Nothing is ever claimed automatically.**
- The class sheet offers "Claim spot", behind the usual confirm.
- The overnight offer check no longer stops at midnight, remembered places survive a cold launch without
  `/waitlists`, and "already booked" is not said over a mere waitlist place.
- Waitlist copy includes the month for classes more than six days away.

### Offline & PWA

- **The offline queue never spends credits by surprise.** Queued cancels replay on reconnect, on resume and after
  the first bookings load, but only while the booking is still held; they never age out. A booking queued while
  offline is sent automatically only if the app is still open when the connection returns. One found in storage
  after a relaunch is never sent on its own: an "Offline booking" dialog asks first, Discard removes it, and it is
  dropped quietly if the class has started or is already booked. Each item is stamped with its owner, never runs
  under another account, and the queue is cleared on sign-out. My Bookings shows "N changes waiting to sync".
- **Saved copy.** My Bookings keeps a read-only "Saved copy · HH:MM" of your held classes for launches with no
  signal. It is never fed back into live state and is cleared on sign-out, session expiry or account change. An
  offline bar shows when the browser reports offline.
- **Update prompt.** After a deploy the web app picks up the new service worker: it reloads when that is safe
  (hidden or just opened, no dialog or booking in flight), otherwise it shows a banner (`#updateBanner`) reading
  "A new version of Psync is ready." with a Reload button and a dismiss ×. It is guarded against reload loops.
- Service-worker navigations fall back to the cache after 3 seconds on a weak connection.
- App icons, manifest icons and a first-paint theme script, so there is no flash of the wrong theme; the sign-in
  page follows the app theme.
- Instructors, locations and class types honour their 24-hour cache instead of re-downloading on every launch;
  refreshes go through the retry wrapper.

### iOS

- **Calendar safety.** Choosing a calendar for sync used to delete every other upcoming event in it straight away.
  It now counts the events that would go and asks first ("Let Psync manage <calendar>?"). Consent is explicit, an
  old silent consent flag is no longer honoured, and switching calendars never wipes the old one. Re-sync and
  "Remove duplicates" report skipped versus synced truthfully and never reconcile-delete without a live session;
  "Remove duplicates" on a calendar that has not been handed over explains that and offers the hand-over confirm.
- Status bar glyphs were inverted in every theme — fixed (needs a device look, see the checklist).
- Class reminders showed as on without notification permission; the app now asks after a first booking, never at
  launch. Reminders cover every upcoming booking, and booking an earlier class no longer cancels a later reminder.
  A booking whose details failed to load still counts as booked for the widget and reminders.
- Notification taps open My Bookings and the class.
- **Widgets** *(compiles; needs a device check)*: Lock Screen rectangular and inline "next class"; the small Home
  Screen widget shows time, place and seat; tapping a widget opens My Bookings and the class — the tap survives a
  reloaded web view and is dropped after 10 seconds rather than popping late.
- **Live Activity** *(compiles; needs a device check)* shows the new seats after adding or cancelling a seat.
- Settings export and calendar export use the share sheet instead of a dead download link.
- The Preferences restore runs in parallel; the pull-to-refresh pill clears the status bar and Dynamic Island;
  permission copy names the right app.

### Accessibility

- Toasts, the session banner and the Booked! sheet are announced through polite / assertive live regions; longer
  messages stay on screen longer. Toasts raised while a dialog is open are also announced inside that dialog.
- All sheets and modals are real dialogs: labelled, focus moves in, Tab is contained, one Escape closes only the top
  layer, focus returns to the opener. Escape also closes the inline date picker and returns focus to its button.
- Bike-picker seats are keyboard-operable buttons with names and pressed or disabled state.
- Selected state is exposed, not just styled: `aria-pressed` on filter chips, date buttons, calendar days, theme
  chips and tier buttons, `role="switch"` on the reminder rows, `aria-current` on the tab bar. Clickable names and
  rows are reachable and activate with Enter or Space. The notify bell has a real accessible name and pressed state.
- Close buttons, chip removers and booking actions have finger-sized hit areas that do not overlap their
  neighbours.

### Design & copy

- Hard-coded dark-era colours were replaced with tokens, so the class sheet, booking confirmation, banners and
  popups are readable in Cloud and Linen. Accent buttons use `--accent-ink`, tertiary text tokens meet AA, and the
  "Cancel booking" label reaches AA on Cloud and Linen.
- A themed danger colour; a text contrast ladder for Terminal, Synthwave, Handheld and Blueprint; bike-picker seat
  and legend colours from tokens; one late-cancel treatment everywhere; no display face on small labels.
- Radius tokens are used throughout, so the Handheld theme is square (seat tiles included).
- Error and success toasts look different and carry a glyph as well as colour.
- Card buttons wrap instead of crushing text, the theme picker fits at 390px, the calendar button leads the date
  row, Stats sections share one inset, and on desktop the header and tab bar line up with the content column.
- Plurals ("1 class"), class-type-aware nouns, British spelling.
- The share image uses the current brand and theme at 2x, with no dead area.

### Performance

- The Discover list is built in one pass per day instead of card by card: about 1,000 cards render in a fraction
  of the previous script time. The last-results snapshot is written after a short pause instead of on every render.
- Only the first cards animate in; background refreshes do not replay the animation.
- Stats parses history once per render, the history list renders in chunks, carousels keep their scroll position,
  and instructor photos load lazily with an initials fallback.
- Reference data is not re-downloaded on warm launches; the iOS storage restore reads its keys in parallel.
- No haptic tick on automatic searches; a tick on seat pick.

### Stats, Membership, instructors & diagnostics

- **History** now includes classes booked on another device or on Psycle's own site: bookings are reconciled into
  history after each load and a quiet weekly top-up fills gaps. It only runs for the signed-in owner, never marks a
  class cancelled unless there is no seat and it is over 2 hours away, and records that it ran so it stops re-paging
  the whole history on every launch. History keeps up to 2,000 entries for every writer and survives a full
  localStorage.
- "This month", "All time", year-in-review and the share image count only classes that have started. Sharing is not
  offered when it can only fail. A history row with an unreadable date no longer adds a bogus month column.
- **"Notify me when a spot opens"** really checks the class (throttled, at most five at a time). A missing field
  never counts as "open". It opens a "Spot opened — View class" dialog and updates the list.
- Instructor profile: class rows open the class sheet, you can favourite and rank from the profile, and "View
  schedule" lands on Discover. "Unranked" chips open the rankings on Membership; Settings rows open at the right
  section.
- Cost tracker handles unlimited plans, plans without a price and zero-class plans without Infinity or "£0.00";
  its forecast never advises booking more classes than the plan has left. Membership dates parse safely on iOS.
- API drift detection is wired to real responses, with optional fields that cannot raise a false safe-mode banner.
  Bug reports carry a build id and user agent; "Copy diagnostics" works on iOS and no longer claims success when the
  copy failed.
- Dead code removed: unused virtual scroll, a duplicate ICS generator in the service worker, unreachable
  light-theme rules, never-attaching log wrappers (replaced with real action logging), dead cache helpers.

### Tests & tooling

- The unit runner loads every `tests/suites/*.js` after its built-in checks, so each feature area keeps its tests in
  its own file. Suites get `loadPure(file, name)`, which evaluates the DOM-free helpers a module marks with
  `pure:<name>:start/end` comments. A hanging suite now fails the run.
- New suites cover, among others: the double-booking guards in the retry layer, the filter engine and core
  date / slot helpers, script order between the page and the smoke page, the Discover window, clash detection, the
  offline queue, per-account data, import validation, calendar safety, the weekly template and the widget link.
- The smoke page loads the production script order, stubs `fetch` so it cannot reach the live API, and detects a
  module that throws while loading.
- Assertions: 128 → 1,122 → 1,680 → 2,318 → 3,188 → 4,597 → 4,859 across the seven commits.

## Behaviour changes worth knowing

Things a member, or whoever maintains this next, might notice and wonder about:

- **Cached timetables older than 15 minutes refresh in the background.** The list stays up and is swapped in
  place; "spots left" numbers disappear once the data is 30 minutes old. A timetable fetched before Monday 12:00
  London is stale the moment the week opens.
- **A queued offline booking asks before sending after a relaunch.** Only a booking queued in the page session
  that is still open goes out by itself when the signal returns. Queued cancels do go out by themselves — but only
  while the booking is still held.
- **Data is stashed per account.** Signing in as a different customer on the same device sets the previous
  member's rankings, favourites, bike preferences, usual week, recent searches and alerts aside (the last two other
  members are kept) and clears class history, calendar data and the offline queue. Sign-out alone moves nothing.
- **Picking a calendar asks first.** A calendar only becomes fully Psync-managed after the counted "Let Psync
  manage …?" confirm. A calendar picked under the old build is reconciled by marker only until it is handed over.
- **Cancel paths refuse to delete an id they cannot prove.** Right after a multi-seat booking, a per-seat cancel
  may say "Couldn't match … — nothing was cancelled"; a refresh (or a few seconds) resolves it. That is deliberate:
  the alternative was deleting the other seat's record.
- **A booking that Psycle did not confirm reads "Unconfirmed — retry"**, and the next tap checks `/bookings` before
  it offers the picker again. Nothing is re-sent on its own.
- **Book waits.** On a slow launch a Book tap stays on "…" until the session and the member's bookings are
  known, and can end in "Couldn't load your bookings — try again".
- **Losing Psycle is not being signed out.** Offline, a timeout, a 5xx or a 403 keeps the token and shows Retry;
  only a 401 ends the session.
- **Settings import only adds.** It never replaces history, rankings or preferences the device already has.
- **Shortcuts do not change your saved filters.** Find similar, Book again, View schedule and the Monday-reminder
  tap show their own search without replacing what the next launch restores.
- **The web app may reload itself after a deploy** — only when hidden or just opened with nothing in flight;
  otherwise it shows the "A new version of Psync is ready. · Reload" banner.
- **Notification permission is asked after a first booking**, never at launch.
- **"Notify me" only checks while the app is open** and signed in, and says so.

## Deliberately NOT changed — owner decisions

These were looked at and left alone on purpose. Please do not "fix" them in passing.

- **Device-local time remains in a few places.** The widget / Live Activity snapshot (`updateWidgetSnapshot` and
  the Swift `PsycleSnapshot` parser), the T-90 class reminders (`_scheduleClassReminders`) and the web ICS / Google
  Calendar export (js/calendar.js) still read `start_at` in the device's zone — an owner decision: moving them is an
  open follow-up that has not been green-lit, because it touches Swift and changes what a member abroad sees. The
  same device-zone parse also remains in Discover's started-class filter and facet counts (js/app.js `render`,
  `_buildFacetClasses`, `_anyStartedBetween`), the instructor profile's upcoming list (js/features.js) and one
  offline-queue replay re-check (the fresh `/events/{id}` read in js/reliability.js; the queue's own "has it
  started" test is London-resolved). My Bookings (past / upcoming), the late-cancel deadline, countdowns, waitlist
  times, the Monday release, calendar events and the Monday reminder go through the Europe/London resolver.
- **Linen's accent as text, and Terminal / Synthwave accent-ink contrast.** Linen's terracotta accent used as text
  on the page background is about 3.7:1. Terminal and Synthwave define no `--accent-ink`, so labels on their accent
  fill are white at about 3.3:1 and 3.5:1. Readable, below AA for small text, and part of those themes' look.
  (Linen and Synthwave were retired afterwards — see the last follow-up under Summary; the Terminal part stands.)
- **The `file://` CORS-proxy development path** in js/app.js (`IS_FILE` / `PROXY`, with its red warning banner) was
  kept as it is. (Note that the page's content security policy lists only the app's own origin and
  `psycle.codexfit.com` under `connect-src`.)
- **Multi-tab sign-out sync.** Signing out in one tab does not sign out another tab that is already open.
- **The AES key backup sits beside the ciphertext in iOS Preferences.** `psycle_sec_key_backup` is mirrored so an
  IndexedDB purge cannot orphan the encrypted token; the cost is that key and ciphertext share one store. Accepted.
- **Favourites are pre-selected on a first-ever launch.** With favourites saved and no filter state ever saved,
  Discover opens filtered to them. After that the saved filters are the authority — including a saved empty list.
- **App icons are web-only.** `icons/` serves the PWA manifest and the browser; `ios-app/build.js` does not copy it
  into the iOS bundle, where the WebView never fetches them.

## On-device checklist — still owed

None of this could be run on a phone. Each line needs a signed build on a real iPhone (the widget and Live
Activity lines cannot be exercised in an unsigned build at all: without entitlements the widget process cannot
read the App Group).

**Appearance**
- [ ] Status bar glyph colour is right in the light theme (dark glyphs on Cloud) and in a dark theme (light glyphs
      on Graphite and the flavour themes), including straight after switching theme.
- [ ] The pull-to-refresh pill sits below the Dynamic Island / status bar on Discover and My Bookings.
- [ ] Cold-launch time feels right, and the first paint is in the member's theme with no flash.
- [ ] A phone that was on Linen or Synthwave opens on Cloud / Graphite with no flash, and keeps it after an iOS
      storage purge (the Preferences mirror is re-saved after the restore — unit-tested only).
- [ ] The floating next-class pill tucks away on a scroll down and returns on a scroll up, at the top and at the
      end of a list, without flickering on the rubber-band at either end. At the top of a Discover day it is not
      drawn over a Book button, and it does not blink while days are paged or a filter is tapped.
- [ ] Terminal and Handheld: the date row's two rows fit with nothing clipped; the Time row's wrapped second line
      looks intended.

**The new mark**
- [ ] The Home Screen icon is the two engraved halves; with the Home Screen set to Dark or Tinted icons
      (long-press → Edit → Customise) it switches to the dark / tinted version.
- [ ] The launch screen shows the mark over "Psync" on the app's ground, and its dark version in Dark appearance
      (iOS caches launch screens hard: delete and reinstall to see a change).
- [ ] Settings (Membership → Bike / spot preferences): the "Settings" title and the close button sit BELOW the
      status bar, clear of the "◀ TestFlight" return link.

**Widgets**
- [ ] The widgets are in the new look: time first as "18:30", pictogram tile, class tint, seat chip in the class
      colour — and they follow a colour or intensity change made in Membership → Appearance within a second or two.
      The full list (12-hour phone setting, tinted Home Screen, StandBy, the upgrade path for a running Live
      Activity) is in `ios-app/NATIVE_FEATURES.md`.
- [ ] Lock Screen **rectangular** and **inline** widgets render with no placeholder on iOS 17+.
- [ ] The small Home Screen widget fits on an SE-class phone with a long class name (the instructor row is the
      one that should drop out).
- [ ] A widget tap opens My Bookings and that class's sheet — from a running app, from the background, and
      **after a force-quit** (cold launch).

**Live Activity**
- [ ] Seat text updates after adding a seat and after cancelling one.
- [ ] A card started by the previous build still renders after updating the app.

**Notifications**
- [ ] The first-booking notification ask appears once, after a first booking, and the iOS prompt follows an in-app
      yes.
- [ ] A T-90 reminder tap opens My Bookings and the class.
- [ ] The Monday reminder's banner arrives at 12:00:00 London time — also on a phone set to another time zone, and
      on the Mondays either side of a clock change — and reads "New Psycle dates are open" with the usual-week
      sentence when a usual week is saved, the "Find your classes…" one when not (save, then clear, a usual week
      and check the pending notification's body follows).
- [ ] First Monday after updating from a build that armed 11:59 reminders: ONE banner, at 12:00 — not two.
- [ ] A Monday reminder tap WITH a usual week opens My Bookings and the review sheet on "Newly opened · Fri … –
      Thu …" — from a running app, from the background and **after a force-quit** (cold launch) — once and only
      once, with nothing booked; pressing "Not now" does not bring the sheet back.
- [ ] A Monday reminder tap WITHOUT a usual week opens Discover on the first newly opened day (the calendar button
      reads e.g. "Fri 9 Oct"), and the next launch still opens on the member's own saved dates.
- [ ] After the first "Save my usual week" the app asks "Remind you on Mondays at 12:00, when new dates open?" by
      itself — never at launch, never over the review sheet; iOS's own prompt follows "Remind me"; "Not now" is
      not asked again; Settings → Reminders shows the switch on afterwards.

**Your usual week**
- [ ] The card folds to one row and stays folded after a relaunch (and after an iOS storage purge); "Review and
      book" is on the folded row; VoiceOver reads the head as a button with its expanded / collapsed state, and
      folding keeps the VoiceOver cursor on it.
- [ ] The review sheet at the phone's real size: the dates control wraps cleanly with "Newly opened" on a line of
      its own, the list scrolls under the pinned money line and buttons, and nothing sits under the home
      indicator — check an SE-class phone and Terminal / Handheld, where the list is shortest.
- [ ] "Change spot" opens the real seat map in the sheet's place; "Use bike N", Back, × and a tap outside each
      return to the sheet exactly as it was (scroll position, ticks, the other rows' spots), with VoiceOver focus
      back on that row's "Change spot".
- [ ] A real run against the live system, watched: exactly the spots shown are the spots booked; a two-seat row
      books two; "Stop after this class" stops. **First live booking of a studio with no spot map from the sheet
      ("N spaces") — watch the error log for `POST /bookings`.**
- [ ] A class past what Psycle has opened, ticked anyway: Psycle's own refusal appears on the row in its words and
      the run carries on. Note what Psycle actually says — it tells us whether the observed release model holds.

**Share sheet**
- [ ] Settings export goes through the share sheet (file, with the text fallback) and the toast tells the truth
      when it is dismissed.
- [ ] ICS / calendar export goes through the share sheet.

**Calendar**
- [ ] The hand-over confirm against a real calendar: the count of events that would go is right, "Choose another"
      changes nothing, "Use this calendar" reconciles, and switching calendars leaves the old one's other events
      alone.

## Known small leftovers

Small, known, and still true at `a9d4a9b`. None affects a booking. The visual ones come from the last browser round.

- **Bike picker on a narrow phone.** A seat map wider than the sheet scrolls sideways, but nothing hints that it
  does (no partial seat, fade or scrollbar), so a whole column can sit out of view. Seen with a synthetic wide
  layout at 390px; worth checking against a real wide studio.
- **A few hard-coded values still bypass the tokens.** The base booked-button style (`.book-btn.booked`:
  `#1a1020` / `#e94560`) is what "Cancel booking" and "Leave waitlist" wear in Terminal, Synthwave, Handheld and
  Blueprint — readable, but off-palette in Handheld. The base `.book-btn` radius (5px) and the class sheet's top
  corners (16px) are fixed too, so they stay rounded in Handheld, where every radius token is zero.
- **Graphite's "Cancel booking" / "Leave waitlist"** use the sage accent outline (a deliberate rule in
  css/theme.css), so the destructive action does not look destructive there; the other themes tint it red or pink.
- **My Bookings export row:** the calendar emoji in "Add to Calendar" sits tight against the label.
- **Handheld, usual-week card at 375px:** a wider time ("Fri 12:30pm") pushes that row's label slightly out of line
  with the rows above.
- **Discover cards:** when the instructor line wraps, the "·" separator is left at the end of the first line.
- **Class sheet with no instructor photo** shows an empty disc rather than initials (cards and lists do have the
  initials fallback).
- **Terminal is the lowest-contrast theme.** Numbers on available seats and the disabled "Full" button are legible
  but dim; Synthwave's booked-seat label is similar. (Separate from the accent-ink decision above.)
- **Inline date picker and the keyboard.** Stepping to the next or previous month re-renders the grid (`calStep`),
  so keyboard focus drops out of the calendar and has to be tabbed back in. Escape still closes it and returns
  focus to the calendar button.
- **Hidden elements keep stale text.** When the last booking is cancelled while still signed in, the hidden
  next-class pill keeps its old text (it is `aria-hidden`, out of the tab order and invisible); only a sign-out or
  account change empties it. Likewise the "N changes waiting to sync" line is hidden, not emptied, once the queue
  is empty. Neither is visible or announced.
- **Offline-booking dialog after a relaunch** says "(Spot 3)" where the rest of the app would say "Bench 3" or
  "Bike 3": the event cache that knows the class type is gone by then, and the label falls back to "Spot".
- **No-layout bookings have still not been exercised against the live API** (by design — nothing was). Watch the
  error log for `POST /bookings` on a first booking at a studio without a seat map.
