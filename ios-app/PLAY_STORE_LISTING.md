# Play Store Listing — Psync

The Google Play counterpart of `APP_STORE_LISTING.md`. **Nothing here can be submitted yet**: Play asks new apps to
target a newer Android API level than Capacitor 6 builds for, so a submission waits for the Capacitor upgrade
(`ANDROID.md` → "Release", step 3). The copy is ready for that day; the release steps, the keystore and the on-device
checklist are in `ANDROID.md`.

The Android app has ONE home-screen widget ("Next class") — no Lock Screen widget, no Live Activity, no Siri — and
its share card goes out as text. The copy below promises nothing more. Keep it that way when it is edited.

## Play Console fields

### App name (30 chars max)
```
Psync: Class Booking Companion
```
(exactly 30 chars — the same name as on the App Store)
> Deliberately NOT "Psycle …": the studio's trademark in the app's NAME or icon invites an impersonation or
> intellectual-property rejection. "Psycle" appears in the descriptions as a statement of compatibility, next to
> the disclaimer, which is normal practice. The reasoning is the App Store listing's.

### Short description (80 chars max)
```
Find, book and keep track of your Psycle London classes. Independent companion.
```
(79 chars)

### Category
- Category: **Health & Fitness**
- Tags: fitness classes, booking (pick from Play Console's own list)

### Price
- Free. No in-app purchases, no subscriptions, no ads. (A class credit is spent with Psycle, on the member's own
  Psycle account; nothing is bought through the app.)

### Contact details
- Email: [YOUR EMAIL] (Play shows it publicly). Website: optional.

---

## Full description (4000 chars max)

```
Psync is a fast, independent companion for Psycle London members. Find a class across every studio, book your usual spot in two taps, and keep everything you hold in one place.

Psync is not affiliated with, or endorsed by, Psycle. It signs in with your own Psycle account and talks to the same booking system that Psycle's own pages use. You need a Psycle account, with class credits or a membership, to book.

FIND YOUR CLASS
• One timetable across all London studios, one day at a time. Swipe to change day
• Filter by studio, class type, instructor, time of day and "available only"
• Favourites, and your own instructor rankings from S to F
• Colour by class type, in colours you choose and as strong as you like

BOOK IN TWO TAPS
• A seat map that remembers your usual spot and the spots you avoid
• A warning when a class overlaps one you already hold
• The late-cancel deadline stated before you commit
• A booking is only announced once Psycle really shows it

EVERYTHING YOU HOLD
• Seats, waitlist places and free-cancel times in one list
• Join, leave and claim waitlist places. Nothing is ever claimed for you
• Your usual week: review the classes, the seats and the spots first, then book them. Never a one-tap spend
• A saved copy of your bookings when you have no signal

KEEP UP
• A home screen widget for your next class: the time, the class and your seat
• A reminder 90 minutes before each class
• A reminder on Mondays at 12:00, when Psycle opens new dates
• Calendar sync: your bookings in a calendar you choose, kept in step as you book and cancel
• 24-hour times throughout

YOUR TRAINING AT A GLANCE
• History, streaks, when you train, class types and the instructors you book most
• A year in review
• Plan usage and a cost tracker

PRIVATE BY DESIGN
• No analytics, no ads, no tracking
• Your sign-in goes to Psycle and nowhere else. Everything else stays on your phone
• Five themes, light and dark
```

---

## Graphics

| Asset | Play wants | Where it comes from |
|---|---|---|
| App icon | 512 × 512 PNG, full square (Play rounds the corners itself) | `rsvg-convert -w 512 -h 512 assets/psync-logo.svg -o <file>.png` — the same drawing as `appstore-assets/AppIcon-1024.png` |
| Feature graphic | 1024 × 500 PNG or JPEG, required | **To make.** The mark and the wordmark on the Graphite ground (`#12161F`), as the screenshot frames are drawn; no device, no Psycle mark, no text near the edges |
| Phone screenshots | 2 to 8, PNG or JPEG, each side 320 to 3,840 px, and the long side at most TWICE the short side | **To rebuild** — see below |

### Screenshots: reuse the six, rebuild the files

The six App Store screenshots are the right pictures and the right captions: none shows an iPhone widget, a Live
Activity or anything else the Android app lacks, the frame around each is a plain rounded rectangle and not an iPhone, and
every name in them is the fake server's.

| Order | Source | Caption |
|-------|--------|---------|
| 1 | `01-discover.png` | Find your class — One day at a time. Swipe to change day. |
| 2 | `02-book.png` | Book in two taps — Your usual spot is ready to confirm. |
| 3 | `03-bookings.png` | Everything you hold — Seats, waitlists and free-cancel times in one place. |
| 4 | `04-stats.png` | Your training at a glance — Streaks, habits and the instructors you book most. |
| 5 | `05-class-colours.png` | Colour by class type — Choose the colours, and how strong they are. |
| 6 | `06-light-and-dark.png` | Light and dark — Follows your phone, or pick your own. |

**The files themselves cannot be uploaded as they are**: they are 1290 × 2796, which is 2.17 to 1, and Play refuses
anything longer than 2 to 1. They need rebuilding on a 9:16 canvas (1080 × 1920 is the usual choice).
`tests/tools/appstore-shots.mjs` has the iPhone canvas written into it (a 430 × 932 frame at 3×, around a 390 × 844
capture); giving it a second canvas and a second output folder is a small change that has not been made
(agents/backlog.md). Do not crop or squash the iPhone files by hand.

No member data in any of it: the screenshots come from the fake server only.

---

## Content rating (the IARC questionnaire)

Category: **Utility, productivity, communication or other**. Every answer is "No": no violence, no sexual content,
no bad language, no controlled substances, no gambling; members cannot talk to each other or share content with
each other through the app; it does not share the member's location; it sells nothing. Expected result: PEGI 3 /
Everyone.

Beside it in Play Console → App content:
- **Target audience**: 18 and over. A Psycle account is an adult's; ticking a children's age band brings the
  Families policy with it.
- **Ads**: no.
- **App access**: some functionality is restricted — the timetable opens without an account; booking, My Bookings,
  Stats and Membership need a Psycle sign-in. Give the reviewers instructions and a test Psycle account (as the App
  Store review notes do), and say that booking needs credits on that account.
- **Health apps declaration**, if Play Console asks for one: Psync books fitness classes. It reads no health data,
  no sensors, no Health Connect.
- **News, government, financial features**: none.

---

## Data safety — the answers, as a table

What the app really does, so the form can be answered truthfully. The developer operates no server: "sent" below
means sent by the app, from the phone, straight to Psycle.

| Data | Does it leave the phone? | To whom | Stored on the phone? | Why |
|---|---|---|---|---|
| Psycle email and password | Yes, when you sign in | Psycle's API (`psycle.codexfit.com`) only | The password never; the email is not stored either (the profile Psycle returns is held in memory while the app is open) | To sign in to the member's own Psycle account |
| Session token (issued by Psycle) | Yes, on every request | Psycle's API only | Yes — encrypted (AES-GCM), mirrored in the app's private preferences so a cleared web view does not sign the member out | To stay signed in |
| Bookings, waitlist places, profile, plan and credits | Fetched from and sent to Psycle | Psycle's API only | A saved copy of the bookings, for opening the app with no signal | The app's purpose |
| Booking history, favourites, instructor rankings, spot preferences, the usual week, settings, theme | No | — | Yes | The app's features |
| Error log and action log | No — unless the member shares a bug report themselves, through the share sheet | whoever the member sends it to | Yes | Diagnostics |
| Calendar events | No | — | Written to the calendar the member hands over, on the phone | Calendar sync |
| Notifications | No — scheduled on the phone; there is no push server | — | — | Reminders |
| Location, contacts, photos, microphone, camera, advertising ID, device identifiers | Not read at all | — | — | — |
| Analytics, crash reporting, advertising | None: no SDK of any kind | — | — | — |

Also true: all traffic is HTTPS (cleartext is refused in the manifest); the app's data is excluded from Google
backup and from device-to-device transfer; instructor photos are loaded from the image addresses Psycle's API
returns; a map, a Google Calendar link or an instructor's page opens in the in-app browser only when the member
taps it.

How that maps onto the form — Google counts data as "collected" when an app transmits it off the device, whoever
receives it, and the developer here receives nothing, so there are two honest readings. The careful one:

| Form question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | Yes |
| Is all of the user data collected by your app encrypted in transit? | Yes |
| Do you provide a way for users to request that their data is deleted? | The app holds no account of its own. Signing out or uninstalling removes what is on the phone; the Psycle account is Psycle's to delete — say so in the privacy policy |
| Personal info → Email address | Collected; not shared; required; purpose: App functionality, Account management |
| App activity → other actions (bookings made through the app) | Collected; not shared; required; purpose: App functionality |
| Everything else (location, financial info, health and fitness, messages, photos, contacts, device IDs, diagnostics) | Not collected |
| Is data sold, or used for advertising or analytics? | No |

The declaration is the owner's to make, and Google's definitions move: read them on the day.

### Privacy policy

Required. The template in `APP_STORE_LISTING.md` is the right one; before it is published for Play, change
"iOS Keychain/Preferences" to "the app's private storage on your phone", and add that the app's data is excluded
from Google backup.

---

## The affiliation disclaimer

Use it word for word in the full description (it is there, as the second paragraph), in the notes to reviewers, and
on the privacy-policy page:

> Psync is an independent companion for Psycle London members. It is not affiliated with, or endorsed by, Psycle.

The app says the same where it takes a password (the sign-in page) and on the first page of its welcome. Never use
Psycle's logo, name treatment or colours in the icon, the feature graphic or a screenshot frame.

## Notes to reviewers (App access)

```
Psync is an independent companion app for members of Psycle London (psyclelondon.com). It is not affiliated with,
or endorsed by, Psycle. It requires an existing Psycle account and connects to Psycle's booking API
(psycle.codexfit.com) with the member's own credentials.

Test account: [EMAIL] / [PASSWORD]. The timetable opens without signing in. Booking a class needs credits on the
account; the seat map, My Bookings, Stats and Settings do not.

The app contains no in-app purchases, no subscriptions, no ads and no analytics.
```

## Copyright
```
© 2026 [Your Name]
```
