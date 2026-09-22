# App Store listing — Psync

Everything App Store Connect asks for, in the order it asks. Text inside a code block is pasted as it is; every
character limit below was counted by script. **Fields only the owner can fill are collected at the end** — the
listing cannot be submitted until each is done.

Psync is an independent app for members of the Psycle London studios. That shapes this whole file: "Psycle" is
someone else's trademark, so it never appears in the app's name, subtitle or keywords, and the description says
plainly that the app is not affiliated with Psycle (App Review Guidelines 4.1 and 5.2.1).

## App information

### Name (30 characters: 30)
```
Psync: Class Booking Companion
```
The App Store Connect record was created by Xcode as "PsycleBookingBuddy" (the Xcode target's name). Rename it
under App Information before submitting.

### Subtitle (30 characters: 28)
```
Find, book and track classes
```

### Category
Primary: **Health & Fitness**. Secondary: **Lifestyle**.

### Price
Free. No in-app purchases.

### Age rating
4+. Every answer in the questionnaire is "None" / "No": no user-generated content, no web access outside the
sign-in host, no gambling, contests, medical information or mature themes.

## Version information

### Promotional text (170 characters: 157; can change without review)
```
Your next class on the Lock Screen, a countdown before it starts, and your usual week rebooked in a couple of taps. For members of the Psycle London studios.
```

### Description (4,000 characters: 1961)
```
Psync is an independent companion app for members of the Psycle London studios. Sign in with your Psycle account to find classes, book the spot you want and keep track of what you hold.

FIND A CLASS
• One day at a time, with a day strip that shows how many classes match and which days you already hold
• Filter by instructor, studio, class type and time of day; results update as you choose
• Each class type has its own colour, and you choose the colours

BOOK THE SPOT YOU WANT
• The studio's own layout: pick your bike, bench, bed or machine
• Your usual spot is suggested first, and spots you prefer or avoid are marked
• Up to two spots in a class
• Nothing is booked until you confirm it
• Full class? Join the waitlist, and claim the spot when one comes up

KEEP TRACK
• Everything you hold in one list: spots, waitlist places and how long each can still be cancelled for free
• A warning when two of your classes overlap
• Your bookings stay readable without signal

YOUR USUAL WEEK
• Save the classes you take every week
• When new dates open, review the whole week, change any spot, and book it together

ON YOUR IPHONE
• Home Screen and Lock Screen widgets for your next class
• A countdown on the Lock Screen and in the Dynamic Island from 90 minutes before class
• Ask Siri "What's my next class in Psync"
• Bookings added to a calendar you choose, and kept up to date
• A reminder 90 minutes before each class, and on Mondays at 12:00 when new dates open

YOUR TRAINING
• Streaks, your busiest days and times, and the instructors and class types you book most
• Rank instructors your own way
• A stats card you can share

PRIVATE BY DESIGN
• No analytics, no ads, no tracking
• Your history and preferences stay on your device; sign-in and bookings go to Psycle and nowhere else

Psync needs a Psycle account. Booking uses the credits or membership on that account. Psync is an independent app and is not affiliated with, or endorsed by, Psycle.
```

### Keywords (100 characters: 97)
```
spin,cycling,indoor cycling,studio,london,ride,strength,yoga,reformer,barre,pilates,hiit,waitlist
```
No spaces after the commas, and no word that is already in the name ("class", "booking"): Apple indexes those
anyway. "psycle" is left out on purpose. It is the word members would search for, and it is also the most common
reason an unofficial app is rejected or taken down (2.3.7, 5.2.1). Add it only with Psycle's written permission.

### What's New (version 1.0: 354 characters)
```
The first release of Psync, an independent companion app for members of the Psycle London studios.

• Find and book classes, with the studio's own layout for choosing a spot
• Waitlists, overlapping-class warnings and free-cancel times in one list
• Your usual week, reviewed and booked together
• Widgets, a Lock Screen countdown, Siri and calendar sync
```

### Support URL
```
https://github.com/muscaglar/psycle-booking/issues
```

### Marketing URL (optional)
Leave empty, or use the hosted web app's address.

### Privacy Policy URL
```
https://muscaglar.github.io/psycle-booking/privacy.html
```
The page is `privacy.html` at the root of this repository, published with the web app. **It still carries one
placeholder — the publisher's name and a contact e-mail address. Fill it in, push, and open the address above
before submitting**: Apple's reviewer opens it.

### Copyright
```
© 2026 <the owner's name>
```

## Screenshots

Six files in `ios-app/appstore-assets/`, 1290 × 2796 (the 6.9" / 6.7" iPhone size, which App Store Connect scales
for the smaller ones). Each is the real app running against the repository's fake Psycle server, under a caption in
the app's own typeface: the names and studios in them are made up, and no member's data appears. Rebuild all six
with `node tests/tools/appstore-shots.mjs` (the repository served on port 8080; captions live in that file).

| Order | File | Caption |
|-------|------|---------|
| 1 | `01-discover.png` | Find your class — One day at a time. Swipe to change day. |
| 2 | `02-book.png` | Book in two taps — Your usual spot is ready to confirm. |
| 3 | `03-bookings.png` | Everything you hold — Seats, waitlists and free-cancel times in one place. |
| 4 | `04-stats.png` | Your training at a glance — Streaks, habits and the instructors you book most. |
| 5 | `05-class-colours.png` | Colour by class type — Choose the colours, and how strong they are. |
| 6 | `06-light-and-dark.png` | Light and dark — Follows your phone, or pick your own. |

The app is iPhone-only, so no iPad screenshots are needed.

## App icon

`ios-app/appstore-assets/AppIcon-1024.png`: 1024 × 1024, no alpha channel. The asset catalogue also carries a dark
and a tinted appearance of the same drawing. Sources: `assets/psync-logo*.svg`; `sh assets/render-icons.sh`
rebuilds every size.

## App Privacy ("nutrition label")

Recommended answer: **Data Not Collected.** Apple counts data as collected when it is sent off the device to the
developer or the developer's partners. Psync has no server: the e-mail address, the password and the bookings go
from the phone to Psycle's own booking system, which the member already has an account with, and to nobody else.
There are no analytics, no advertising and no crash-reporting kits. The privacy manifests in the app and the widget
extension declare no collected data types and no tracking, which matches. This is the owner's legal declaration:
read Apple's definition once before ticking it.

## Export compliance

The app's Info.plist sets `ITSAppUsesNonExemptEncryption` to false, so App Store Connect does not ask at upload.
That is accurate: the app uses HTTPS and the operating system's own encryption, and nothing else.

## App Review information

### Sign-in required
Yes. **A demo account is mandatory.** Signed out, the app shows a sign-in prompt and nothing else, so a reviewer
without one cannot test anything and the submission is rejected under Guideline 2.1.

### Notes
```
Psync is an independent, unofficial companion app for members of Psycle London, a chain of fitness studios. It is
not affiliated with or endorsed by Psycle. Members sign in with their existing Psycle account, and the app talks
only to Psycle's own customer booking system, over HTTPS.

DEMO ACCOUNT
E-mail: <demo account e-mail>
Password: <demo account password>
This is a real Psycle member account on a real booking system. Booking a class uses a real class credit. Please
cancel any test booking afterwards (Bookings, then Cancel on the class): cancelling is free until the time shown
on the card.

ACCOUNTS (Guideline 5.1.1(v))
Psync cannot create an account. It has no sign-up and no password reset; the only account request it makes is
signing in to an existing Psycle account. Accounts are created and deleted with Psycle. Signing out of Psync
removes the session and the member's data from the device.

WHAT THE APP ADDS TO THE PHONE (Guideline 4.2)
Home Screen and Lock Screen widgets for the next class; a Live Activity with a countdown on the Lock Screen and in
the Dynamic Island from 90 minutes before a class; an App Shortcut for Siri ("What's my next class in Psync");
bookings written to a calendar the member chooses, and kept in step with their bookings (EventKit); local
notifications 90 minutes before a class and on Mondays at 12:00, when new dates open; haptics; the share sheet; a
saved copy of bookings that can be read without signal.

PERMISSIONS
Calendar access is asked for only when the member switches on calendar sync in Settings. Notification permission
is asked for only when the member switches on reminders. The app has no push server, no analytics, no tracking
and no in-app purchases.
```

### Contact
The reviewer's contact fields (first name, last name, phone, e-mail) are the owner's.

## Privacy policy

The policy is `privacy.html` at the root of this repository, and it is the only copy: it describes what the code
does (what is kept on the device, what is sent to Psycle, the calendar and notification permissions, how to remove
everything). Do not paste a second version anywhere.

## Only the owner can do these

- [ ] Put a name and a contact e-mail address into the one placeholder in `privacy.html`, push, and open the
      published page.
- [ ] Provide a demo Psycle account for App Review, with at least one class credit, and paste it into the notes.
- [ ] Fill the App Review contact fields and the copyright line.
- [ ] Rename the App Store Connect record from "PsycleBookingBuddy" to the name above.
- [ ] Answer the App Privacy questions and the age-rating questionnaire (recommended answers above).
- [ ] Decide whether to ask Psycle for written permission. It is the one real answer to a trademark or
      third-party-service question from App Review (5.2.1, 5.2.2), and to a later complaint.
- [ ] Walk the on-device checklist in `NATIVE_FEATURES.md` on a real iPhone before submitting.
