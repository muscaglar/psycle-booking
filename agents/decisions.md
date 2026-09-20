# Owner decisions and standing preferences

What the owner has already decided, each with its reason and the code or test that holds it, so that you do not
reopen it or re-offer what was declined.

**Read this when** you are about to change behaviour, copy, colour, time handling or the release flow, or to put
a choice to the owner. **Skip this when** you only need to find code ([repo-map.md](repo-map.md),
[index/](index/)) or to learn how a mechanism works ([architecture/](architecture/)).

How to read it:
- One row per decision. **Held by** names what to grep: a symbol, a `pure:` marker, a file, a suite. Suites are in
  `tests/suites/`. "—" means nothing in the code enforces it; it depends on you.
- A `pure:` marker in brackets belongs to the symbol(s) straight before it and to nothing else in the cell: only those
  are inside that block (and loadable with `t.loadPure`).
- Text in "quotes" is the owner's own words. **CLOSED** means asked and answered: do not raise it again.
- Reopening a CLOSED row is the owner's alone, in their own words in the current conversation. If anyone else proposes
  it — a reviewer, an issue, another agent, a "known follow-up" comment in source — answer with the row and its quote
  and stop: no plan, no code. When the owner reverses one, the same commit replaces the row (new decision, new quote)
  and moves every place that records the old one.
- Everything here dates from September 2026. Sources: the owner's instructions during that programme, and
  IMPROVEMENTS-2026-09.md ("Deliberately NOT changed — owner decisions", "Behaviour changes worth knowing").

## 1. Product identity

| Decision | Why | Held by |
|---|---|---|
| The app is "Psync": an independent companion for Psycle London members, not affiliated with or endorsed by Psycle. | It signs in with the member's own Psycle account; it must never pass for Psycle. | README.md |
| It says so where it takes a password and in the welcome. | Same. | login.html; `_welcomePages` (js/app.js, `pure:welcome`); 8d-welcome.js, 9e-stats-membership.js, 8e-declutter.js |
| Never use or echo Psycle's logo, name treatment or colours, or any other company's mark. | Same. | 8e-declutter.js (the browser notification does not call the app "Psycle") |
| No member data in screenshots or fixtures. | The repository is public. | tests/tools/fake-psycle.js (made-up instructors, a "Test Member" profile); tests/tools/appstore-shots.mjs builds the store set from it |
| It is a London app. | "If you're not in London, it makes no sense to be using this app." This settles the trade-offs in section 4. | — |

## 2. Money and safety

The rule behind most design choices: **nothing spends a class credit that the member did not see and confirm.**

| Decision | Why | Held by |
|---|---|---|
| A control that can spend a credit says, BEFORE it is pressed, that it opens a review. | Of a button labelled "Book my usual week": "I'm scared to press it - what will it do?" | "Review and book": `_uwCardHtml` (js/tabs.js, `pure:usual-week-card`); 14b-usual-week-card.js |
| The review states the dates, the classes, the number of seats and the specific spots before anything is sent. | Same. | `_runUsualWeekSheet`, `pure:usual-week-sheet` (js/tabs.js); `planWeeklyTemplate`, `templateSpotsFor` (js/app.js); 14a-usual-week-sheet.js |
| Never a one-tap spend. Never book what was not shown: not an extra seat, not a different seat ("never a silent substitute"), not an extra class, not on a retry. | Credits are money. | `bookWeeklyTemplate`, `_bookTemplateSeat` (js/app.js); 14a-usual-week-sheet.js, weekly-template.js |
| A `POST /bookings` is never re-sent. An unanswered one is settled by re-reading `/bookings`. The one guarded exception is the offline queue's replay of a SLOT body. | A timed-out POST may already have booked. | `submitBooking`, `BOOKING_VERIFY_DEADLINE_MS`, `_bookingOutcome` (`pure:booking`) — js/app.js; the `apiFetch` wrapper and `pure:offline-queue` in js/reliability.js; reliability.js, booking.js, offline-queue.js |
| Nothing is claimed or joined automatically: not a waitlist offer, not a queued offline booking found after a relaunch, not by the Monday reminder's tap. | Same. | `claimWaitlistSpot`, `window._onBookingWeekOpened` (js/app.js); `_offlineQueueDecision` (js/reliability.js); waitlist-polish.js, offline-queue.js, 14c-weekly-reminder.js |
| When in doubt, stop and say so. | An unconfirmed answer may still become a charge. | The "Unconfirmed — retry" label contract of `submitBooking`; the usual-week run stops on `'unconfirmed'` and `'partial'` |
| One seat and two seats per class are both supported everywhere; up to 4, Psycle's own limit per booking. | The owner books one or two. | `_templateSeats` (js/app.js) and `_uwCardSeats` (js/tabs.js) are ONE rule in two places — change both; `_uwSeatOptions`; never above the class's `max_bookable_slots` |
| The app should "have an opinion on the spots … but it should guide you through that": suggest (usual spot, avoid disliked spots, keep further seats close to the first), show the suggestion and its reason, let the member change it. | The owner's words. | `_spotSuggestion`, `_spotWhyText` (js/app.js, `pure:template-spots`); "Change spot" is the picker's choose-only mode (`showBikePicker`, `opts.choose`, `confirmSpotChoice`), which books nothing |
| `https://psycle.codexfit.com` is a REAL booking system: tests, scripts and browser checks never send it a write. | A write books a bike, spends a credit or cancels someone's class. | tests/README.md ("Never click through a write against un-stubbed state"); tests/smoke.html and tests/tools/fake-psycle.js answer every request themselves; CI's browser resolves no host but loopback (.github/workflows/ci.yml) |
| A read-only, token-free read of the public timetable is acceptable when a fact about Psycle's behaviour is needed. Anything that needs a member's session is run by the owner in their own signed-in browser, so the token never leaves it. | Same. | — |

## 3. Design direction

Chosen by the owner from several rounds of concepts, with a product designer advising.

| Decision | Why | Held by |
|---|---|---|
| The look is "Crisp Colour": the clear, time-led skeleton of one concept with the colour and soft styling of another. Sofia Sans Condensed (times, numerals, headings, wordmark) over Sofia Sans. Cool graphite chrome with no hue of its own. Soft round shapes, one soft shadow. | The owner's choice; see Liked / Disliked below. | css/crisp.css (linked last); tokens in css/theme.css; fonts/; 9a-foundation.js |
| A sparing glow ONLY for what is selected or yours. | The glow was liked; it keeps that one meaning. | `--glow-*` tokens (css/theme.css); each `crisp:9*` section's suite pins its own list (9b-discover.js and its siblings) |
| A waitlist place is drawn dashed / hollow, never with the glow, and is never spoken as "You have …". | It is not a seat until `/bookings` shows one. | `.ct-card.is-dashed`, `.ct-badge.is-dashed`, `.class-card[data-ct].is-waitlisted` (css/crisp.css) |
| The day-strip dot marks a held SEAT only; a place marks nothing. | NOT the owner's words: the implementer's reading of "selected, or yours". Ask before changing it — and whether a day with a seat AND a place shows one mark or two is theirs to say. | `_pagerHeldDays` (the `b.waitlisted` skip; js/app.js); 9b-discover.js ("a waitlist PLACE marks nothing") |
| Colour means CLASS TYPE and nothing else. | The owner corrected an earlier by-studio idea: "the colouring should be by class type … as opposed to by club/venue". | `window.PsycleClassColours`, `CLASS_COLOUR_PALETTE` (`pure:class-colours`) — js/theme.js; `classTypeKey` (js/app.js); the one `[data-ct]` mapping block in css/crisp.css; rank tiles, heatmap and tier bar stay neutral (css/crisp.css 9e.5) |
| Colour is customisable and calm by default: intensity Off / Soft (default) / Bold, and a curated swatch per class type with precomputed contrast-safe values. | "the colours should be customisable (as the current ones are too much)" | `renderClassColours`, `_ccControlModel` (`pure:class-colour-control`) — js/tabs.js; `psycle_class_colours`; the contrast matrix in 9a-foundation.js |
| ONE class card component everywhere: Discover, My Bookings, the usual week. | A My Bookings layout inconsistent with Discover was disliked. | `.class-card[data-ct]` (css/crisp.css 9b.7); `_ccTimeHTML` (js/app.js); 9f-one-card.js |
| Discover shows one day at a time, with a swipe and a day strip. No previous / next chevrons. | The owner dislikes chevron buttons for changing day. | `pure:day-pager`, `_wireDayPager` (js/app.js); 8b-day-pager.js fails if `day-nav` or "Previous day" comes back |
| The date row is always visible; every other filter sits behind one collapsed "Filters" button. | From the product designer's review of the iPhone app (IMPROVEMENTS-2026-09.md). | `toggleFilters` (js/app.js); `#controlsToggle` (psycle-finder.html); 8a-filters.js |
| Stats is three sub-pages behind a switcher. | Same. | `STATS_PAGES` (js/tabs.js, `pure:stats-pages`); 8c-stats-pages.js |
| New users get a full-screen welcome. | Same. | `pure:welcome` (js/app.js); 8d-welcome.js |
| Copy: plain human sentences. No explanatory subtitles, no instructions for obvious controls, no exclamation marks, no emoji as UI. Money and safety copy is kept and exact. | The app must not "look and read as an AI generated app". The example of bloat: "Matched on your taste, your usual times & what's bookable". | 8e-declutter.js, copy.js; `_uiIcon` (js/app.js) draws line marks in place of emoji |
| Times are 24-hour everywhere — "18:30", never "6:30 pm" — including widgets, notifications and spoken labels. | "24 hour time please (ie 18:30)" | `_clock24`, `_clockOf` (js/app.js, `pure:clock`); Swift `PsycleClock` (ios-app/ios/App/PsycleShared/PsycleClassType.swift); 10a-time24.js fails on a 12-hour marker in shipped source |
| Five themes: Cloud (default, light), Graphite (dark), Terminal, Handheld (id `gameboy`), Blueprint. Linen and Synthwave were removed; their stored ids read as Cloud / Graphite. | "Remove those two themes" | `APP_THEMES`, `RETIRED_THEMES` (`pure:theme-retired`) — js/theme.js; both `themeBoot` scripts; 10b-themes.js |
| The mark is "Engraved Halves": two slipped half-discs with growing arcs engraved in them, hue-less. | Chosen by the owner from two rounds of options; they wanted "modern geometric options" to choose from, not one design handed to them. | assets/psync-mark.svg, assets/psync-logo.svg (+ `-dark`, `-tinted`), assets/render-icons.sh; 12-brand-mark.js (one geometry everywhere it is drawn) |
| Space on My Bookings matters: a secondary card (the usual-week card) folds to one line with its main action still on it. | "I want to be able to collapse the 'Book my week' section so it doesn't take up too much space" | `toggleUsualWeek`, `psycle_usual_week_collapsed` (js/tabs.js); 14b-usual-week-card.js |
| When you propose colour or visual emphasis, err on the quiet side and keep it adjustable. When a visual choice is genuinely the owner's, show options; do not pick silently. | The first colours were "too much". | — |

- **Liked:** bold clean typography with the TIME as the hero, pictograms, a sports feel, the glow, a consistent
  simple interface.
- **Disliked:** beige; flat lifeless colour; square edges; an accent that clashes with its ground; distracting
  styling; concept metaphors leaking into the product (pegs, trains).

## 4. Time zones

| Decision | Why | Held by |
|---|---|---|
| The API's class times are the gym's own London wall clock. Wherever the INSTANT matters it is resolved through Europe/London: late-cancel deadline, countdowns, waitlist windows, calendar events, the Monday reminder. | A deadline must be right whatever zone the device is in. | `_gymClassStartMs`, `_gymWallToUtcMs` (js/app.js, `pure:gym-time`) and the bridge's copy `_classStartMs` (ios-app/www/native-bridge.js) — change both; tests/unit.js runs as `TZ=America/New_York`; bookings-card.js |
| **CLOSED — do not re-offer.** The widget / Live Activity snapshot, the 90-minute class reminders and the web ICS / Google Calendar export stay DEVICE-LOCAL. | The owner heard the consequences (abroad, countdowns and reminders are off by the zone offset) and left them: "If you're not in London, I'd argue it makes no sense to be using this app". IMPROVEMENTS-2026-09.md → "Deliberately NOT changed" records the same. | Swift: `PsycleFixedFormat.formatter` sets `.autoupdatingCurrent` (ios-app/ios/App/PsycleShared/PsycleClassType.swift; PsycleSnapshot.swift only calls it), and 11-native-snapshot.js ("Swift contract: 24-hour times through one formatter") fails if that line changes — the ONLY executable guard. Nothing pins the bridge half (`updateWidgetSnapshot`, `_scheduleClassRemindersInner` in ios-app/www/native-bridge.js) or js/calendar.js: swapping their `new Date(start_at)` for `_classStartMs` passes all of `npm test`, so that half depends on you |
| Left as a device-zone parse under the same heading — do not "fix" in passing: Discover's started-class filter and facet counts, the instructor profile's upcoming list, one offline-queue replay re-check. | Listed in IMPROVEMENTS-2026-09.md → "Deliberately NOT changed". | `render`, `_buildFacetClasses`, `_anyStartedBetween` (js/app.js); js/features.js; js/reliability.js |

The CLOSED row closes the TIME-ZONE question for those three paths only; it says nothing about where an export or a
sync may be offered. It is also written in: architecture/time.md ("STILL device-local"), architecture/ios.md (the Gym
time bullet), ontology.md invariant 8, learnings.md C1, architecture/storage-keys.md (`psycle_class_reminder_map`),
IMPROVEMENTS-2026-09.md ("Deliberately NOT changed"), the ios-app/NATIVE_FEATURES.md status block, and comments in
PsycleSnapshot.swift (`PsycleDateParser`), PsycleClassType.swift (`PsycleFixedFormat`), the header of
ios-app/www/native-bridge.js, ios-app/native-checks/render/main.swift, and the headers of 11-native-snapshot.js and
ios-polish.js. A reversal changes all of them — and the reminder map (architecture/ios.md → "Snapshot time contract").

## 5. Booking horizon and the Monday reminder

| Decision | Why | Held by |
|---|---|---|
| Psycle books about three weeks ahead. This is OBSERVED, not an API contract: use it for defaults, notes and the reminder's target only. Never block a booking on it. | The owner believed "we can book up to 3 weeks ahead", and a read-only look at the public timetable on 2026-09-19 agreed: each Monday 12:00 London release opens a Friday-to-Thursday batch ending 24 days after that Monday; the timetable lists one batch further; some credit types have an extended booking period. | `_bookingHorizon`, `RELEASE_OPENS_FROM_DAYS` / `RELEASE_OPENS_TO_DAYS` / `RELEASE_LISTED_EXTRA_DAYS` (`pure:horizon`), written a second time as `OPENED_BATCH_FIRST_DAY` / `OPENED_BATCH_LAST_DAY` (`pure:week-opened`) — js/app.js, change both; 14a-usual-week-sheet.js, 14c-weekly-reminder.js |
| The Monday reminder fires at 12:00 London sharp. | The owner asked for 12:00, not a minute before. | `_nextMondaysNoonLondon` (ios-app/www/native-bridge.js, `pure:weekly-reminder`); 14c-weekly-reminder.js |
| It is offered in context — once, after a usual week is saved or its review closes — never at launch. | The owner's instruction; the same manners as the first-booking reminder ask. | `window._offerWeeklyReminder`, `psycle_weekly_reminder_asked` (ios-app/www/native-bridge.js); 14c-weekly-reminder.js |
| Its tap opens the usual-week review on the newly opened dates. It never books. | Section 2. | `window._onBookingWeekOpened`, `_openedBatch` (`pure:week-opened`) — js/app.js; 14c-weekly-reminder.js |

## 6. Other things deliberately left alone

From IMPROVEMENTS-2026-09.md → "Deliberately NOT changed — owner decisions". Do not "fix" them in passing.

- The `file://` CORS-proxy development path (`IS_FILE` / `PROXY` in js/app.js, with its red warning banner) stays.
- Signing out in one tab does not sign out another tab that is already open.
- `psycle_sec_key_backup` sits beside the ciphertext in iOS Preferences, so an IndexedDB purge cannot orphan the
  encrypted token. An accepted trade-off.
- Favourites are pre-selected on a first-ever launch; after that the saved filters rule, a saved empty list included.
- `icons/` is web-only: ios-app/build.js does not copy it into the iOS bundle.
- Terminal defines no `--accent-ink`, so labels on its accent fill are white at about 3.3:1. Part of that
  theme's look.

## 7. Release and process

| Decision | Why | Held by |
|---|---|---|
| Every push to `main` is archived by Xcode Cloud and uploaded to TestFlight, and the web app is published from `main` too (that deploy is not defined in this repository: .github/workflows/ci.yml only checks) — independently, so with GitHub green and no Xcode Cloud build the web change is already live and only TestFlight is on the previous build. Work on a branch, keep `main` fast-forwardable, never force-push. | Whatever lands on `main` reaches testers, and each archive spends Xcode Cloud compute hours. | ios-app/CICD.md |
| After a push to `main`, read the Xcode Cloud check on the commit: `success`; `action_required` = failed; `cancelled` = superseded by a newer push (harmless); NO check at all = the month's Xcode Cloud compute hours are spent, OR the push was never picked up: the owner looks in App Store Connect → Xcode Cloud, and only in the second case does "Start Build" on `main` (or the next real push) build the latest commit. Nothing in the repository changes; never push an empty commit to provoke a build. | A green GitHub run does not prove the TestFlight build worked. | ios-app/CICD.md → "Notes / gotchas"; agents/playbooks.md P10 |
| An unsigned build is all an agent can make. Anything that needs a real phone — widgets, Live Activity, notifications, safe areas, the launch screen — is the owner's to check, and so is anything in App Store Connect / Xcode Cloud (compute usage, "Start Build"): no keys for it exist in the repository or in GitHub, by design. | An unsigned build cannot exercise them. | The on-device checklists in IMPROVEMENTS-2026-09.md and ios-app/NATIVE_FEATURES.md |
| Any Swift or asset-catalogue change is proved with the App-scheme simulator build before it ships. | `main` goes straight to TestFlight. | The unsigned iOS job in .github/workflows/ci.yml; `sh ios-app/native-checks/run.sh` |
| Commit messages: written as a human developer would, itemised, what changed and why, the test count before → after, no tool or AI attribution lines. | The owner's standing instruction. | — |
| Verify a product change in a real browser against the fake server before committing. Never push a red check. | Unit tests cannot see layout, focus or a whole flow. | tests/tools/fake-psycle.js; tests/README.md; `npm run ci` |
| The repository is dependency-free by design (tests, tools, the web app). Do not add npm packages for convenience. | There is nothing to install for the web app or its tests, and it stays that way. | package.json (one devDependency, `typescript`, for the advisory typecheck) |
| The Capacitor 6 → 8 upgrade is documented and has NOT been run. The lockfile must keep resolving from registry.npmjs.org (check `npm config get registry` before you regenerate it); then verify on a device. | Xcode Cloud runs `npm ci` against the lockfile. | ios-app/UPGRADE-CAPACITOR-8.md |
| Tell the owner plainly what was verified and what was not. Put decisions that are theirs to them as short questions with a recommendation. | The owner's stated preference. | — |

## 8. Platforms: the Android app

Decided on 2026-09-20: of the levels put to them, the owner chose level 2.

| Decision | Why | Held by |
|---|---|---|
| There is an Android app at "level 2": everything the iPhone app does EXCEPT the widgets, the Live Activity and Siri — calendar sync, the Monday 12:00 and class reminders, the share sheet, storage that survives a purge, haptics, the in-app browser — packaged with Capacitor around the same ios-app/www/. | "Go ahead with level 2 please." | ios-app/android/; `IS_ANDROID` (ios-app/www/native-bridge.js); 18-android.js, 19-android-project.js; architecture/android.md |
| **The iPhone app must not change for Android's sake**: no new npm package, no new Capacitor plugin (a plugin is an iOS pod), no Swift edit, and `npm run sync` stays iOS-only. | Xcode Cloud runs `npm ci`, then `npm run sync`, on every push to `main`, and that build goes to testers (section 7). | 19-android-project.js (the scripts, the lockfile, ci_post_clone.sh); 18-android.js (`IPHONE_LAUNCH_DIGEST`: the iPhone path's plugin calls, unchanged to the byte) |
| Level 3 — an Android home-screen widget — was NOT requested. Do not start it; it is a row of backlog.md. | The owner asked for level 2, no more. | — |
| Android is released by hand, by the owner: nothing about it is wired to a store, no signing key lives in the repository or in GitHub, and CI builds a debug APK only. | The repository is public; a Play submission is blocked on the target API level anyway (backlog.md). | ios-app/android/app/build.gradle (the four `PSYNC_…` values); both .gitignore files; 19-android-project.js |
| Hardware / gesture Back asks the page first and otherwise sends the app to the background, alive; it never finishes the activity, never confirms, never spends. | Settled in the brief for the work, on the owner's behalf ("nothing needed from me I hope"): without the @capacitor/app plugin — which would be a new iOS pod — Capacitor closes the app on Back, under whatever sheet is open. Section 2 decides the rest: Back is always the safe answer. | `MainActivity`; `window._psycleAndroidBack`, `pure:android-back` (js/app.js); 18-android.js, 19-android-project.js |
| Back presses a confirm's cancel button WHATEVER it says, as Escape and a tap outside the dialog do. On three dialogs that is more than "leave it": "Book anyway" carries on to the picker or to the confirm that does spend, "Carry on" opens the usual-week review, "Discard" drops a queued offline booking. None books. On the welcome Back is the welcome's own Back, and its Skip only from the first page. | Made in review, on the owner's behalf: the three dialogs belong to spend paths the Android work must not edit, and a Back that did nothing on them would be a dead button. An edge swipe IS Android's Back and the welcome is turned by swiping, so Skip — which is for good — must not be one stray thumb away. | architecture/android.md → Back; ios-app/ANDROID.md → "How Back works"; 18-android.js (it fails when a fourth such label appears) |
| The Android app is portrait only. | Made in review, on the owner's behalf, as parity: the iPhone app (Info.plist) and manifest.json already are, the page has no landscape layout, and its sheets and spend dialogs have never been seen 360px high. | AndroidManifest.xml (`android:screenOrientation`); 19-android-project.js |

## Open questions the owner has not answered

Listed by IMPROVEMENTS-2026-09.md ("Follow-up: your usual week" → "Decisions the owner may want to overrule"):
choices made on the owner's behalf and not yet confirmed. Ask before changing one; treat none as settled.

- The usual-week card's primary sits in the head in both states, and "Clear" sits beside "Update from my bookings".
- "1 of 2 seats held" starts unticked.
- The reminder tap's Discover route shows ONE day, the batch's first: the date row cannot name a custom range yet.
- The Settings row reads "Monday booking reminder — Mondays at 12:00 — when Psycle opens new dates": "Monday"
  twice, and no "UK" although it always fires at London noon.
- A second seat is the free one closest to the first, which can be the seat in front rather than the one beside.
- The review's button counts a no-map studio's spaces as "seats".
- "Not now" to the reminder offer leaves the reminder unset rather than writing `'off'`.

Chosen on the owner's behalf in the Android work (section 8), and theirs to overrule:
- Reminders on Android use inexact alarms: the app does not ask for the "Alarms & reminders" special access, so a
  reminder may arrive a few minutes late.
- The app's data is excluded from Google backup and from a phone-to-phone transfer: on a new phone the member signs
  in again, and what lives only on the phone (rankings, favourites, spot preferences) travels by Settings → export
  and import, not by backup.
- A stats or year card is shared as text on Android (an image needs a plugin the app does not carry).
- The Android launch screen shows the mark without the wordmark.
- The Android app is portrait only, as the iPhone app is.
- Back presses a confirm's cancel button whatever it says ("Book anyway", "Carry on" and "Discard" included — none
  of them books), and on the first-run welcome it is the welcome's own Back: Skip only from the first page.

Never asked, so not decided — ask before building:
- Card density / a compact-cards preference (standing preference: restraint; space on My Bookings matters).
- Offering iOS calendar sync from a booking flow (today Settings → Calendar Sync is the only entry point), and whether an
  "asked" flag for such an offer would be per device or per account.
