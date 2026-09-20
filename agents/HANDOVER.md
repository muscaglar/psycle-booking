# Handover — where things stand
Purpose: where the tree stood when this was last written, what has and has not been proved, what is the owner's to do, and how to prove your setup. **Read this when** you are picking the project up after a gap. **Skip it when** you only need to find code ([repo-map.md](repo-map.md), [index/](index/)).

## Session log

Newest on top. **Add an entry when you finish a stretch of work; keep the ten most recent, fold older ones into "How we got here".** Keep an entry to about 6 lines: detail belongs in ../IMPROVEMENTS-2026-09.md or the commit body — link to it. In the same commit delete the [backlog.md](backlog.md) row you did and the "Not verified" cell it settles. 16-agents-docs.js caps this file at 160 lines and holds its ≈ tokens in ../AGENTS.md and [README.md](README.md) to within a quarter: when an entry moves the size, correct both cells. Template:

```
### YYYY-MM-DD — the stretch, in a few words
- **State:** `main` at "<subject>"; pushed yes / no; branch ahead of `origin/main` by N.
- **Changed:** what moved, by area; commits by subject line. **Verified:** what was proved, and how. **Not verified:** what only a phone or Psycle can prove.
- **Left:** what is unfinished or now the owner's; anything the owner decided → decisions.md, in their words.
```

### 2026-09-20 — the small leftovers closed out; documentation for whoever comes next
- **State:** `main` at "Add folder guides, a handover and a backlog: a warm start for whoever comes next"; pushed yes — it and the close-out before it went to `main` together, at the owner's request (hard rule 6); branch ahead of `origin/main` by 0. Check it: the command under "State of play".
- **Changed:** "Close out the small leftovers: what was already gone, what is fixed, what remains" — product code; what and why: [../IMPROVEMENTS-2026-09.md → "Follow-up: the small leftovers"](../IMPROVEMENTS-2026-09.md#follow-up-the-small-leftovers). Then documentation and its guards only: a folder guide in js/, css/, tests/, ios-app/ and ios-app/ios/App/, this file, [backlog.md](backlog.md), 16-agents-docs.js; tools/check-split.mjs tells a line edited since the split from a lost one.
- **Verified:** the close-out by 17-leftovers.js (each check seen to fail without its fix) and in a real browser on tests/tools/fake-psycle.js with every write counted, with real key presses for both date-picker focus fixes (`calStep`, `pickCalDate`). The documentation: `npm run ci`, `npm run agents:check`, `node agents/tools/check-split.mjs` (0 missing, 0 duplicated).
- **Not verified:** the seat map's scroll shades in the iOS web view; everything on the two device checklists. The `Xcode Cloud` check on this push had not been read when this was written: read it ([../ios-app/CICD.md](../ios-app/CICD.md) → "Notes / gotchas").
- **Left:** nothing half-made. Living list: [../IMPROVEMENTS-2026-09.md → "Known small leftovers"](../IMPROVEMENTS-2026-09.md#known-small-leftovers). Candidate work, none of it requested: [backlog.md](backlog.md).

## State of play

- **What `main` holds — check, do not trust this line:** `git fetch && git status -sb && git log --oneline origin/main..HEAD` (and `git stash list`, `git worktree list`). No output and nothing staged = everything is on `main`. Anything else is unshipped work: report it, and do not commit or push it (hard rule 6). This file is written just before its own commit, so a commit or push it describes may not have happened: the newest entry's **State** line says what was so then.
- The September 2026 improvement programme is finished; its audit trail is [../IMPROVEMENTS-2026-09.md](../IMPROVEMENTS-2026-09.md).
- **How it ships:** every push to `main` is archived by Xcode Cloud and uploaded to TestFlight, and the web app is published from `main` by a GitHub Actions deploy that is not defined in this repository — two independent legs ([decisions.md](decisions.md#7-release-and-process) section 7; [../ios-app/CICD.md](../ios-app/CICD.md)).
- **Nothing is half-made:** no pending migration, no open question blocking work. The iOS wrapper is still Capacitor 6 and needs iOS 15 or later; the 6 → 8 upgrade is written up and has not been run.
- **Checks:** 126 DOM-free checks before the programme, about 8,000 now. CI is the syntax check, the unit suites, the www/ drift check and the plugin patch check, plus advisory smoke, typecheck and index-freshness steps and an unsigned iOS compile ([architecture/testing-and-ci.md](architecture/testing-and-ci.md)).

## Verified / not verified

| Verified — and how | NOT verified — needs a phone or the real service |
|---|---|
| Every web-layer change of the programme, the close-out of the small leftovers included: the unit suites (run as `TZ=America/New_York`), then a real browser against a stubbed API with every write counted — stubs made by hand at first, later tests/tools/fake-psycle.js (`H.writes` as expected; `H.leaked` and `H.liveHits()` empty). | [The on-device checklist](../IMPROVEMENTS-2026-09.md#on-device-checklist--still-owed): widgets, the Live Activity, notifications (the Monday 12:00 reminder and its tap included), the launch screen, safe areas, status bar, share sheet, the calendar hand-over. None of it has run on a phone. |
| Native changes: a full App-scheme simulator build and launch, unsigned; `sh ios-app/native-checks/run.sh` (the previous build's payloads decode; `18:30` prints and parses under a 12-hour phone setting). | Anything behind entitlements — a widget reading the App Group, a Live Activity on a Lock Screen: the [device checklist](../ios-app/NATIVE_FEATURES.md#device-checklist--crisp-colour-widgets-2026-09-19) in ios-app/NATIVE_FEATURES.md. An unsigned build proves the code compiles, no more ([learnings.md](learnings.md) G7). |
| No write has ever been sent to `psycle.codexfit.com` by a test, a script or a browser check. | A first real "Review and book" run: that exactly the spots shown are the spots booked, that a two-seat row books two, that "Stop after this class" stops. |
| The Swift copies of the fallback palette, class-type words, pictogram numbers and chrome colours match the web originals (11-native-snapshot.js). | A first real booking at a studio with no seat map: the count body of `POST /bookings` has never met the live API — from the usual-week sheet or from Discover. |
| The `Xcode Cloud` archive of the agents/ commit succeeded (read on 2026-09-20). It holds everything before the close-out, including the push of 19 September 2026 that got no check of its own ([../ios-app/CICD.md](../ios-app/CICD.md) → "Notes / gotchas"). | The `Xcode Cloud` check of the close-out and of this documentation. A commit that is not yet on `origin/main` HAS no check: run `git branch -r --contains <sha>` first — [playbooks.md](playbooks.md) P10 step 4's "no check" diagnosis applies only to a pushed commit. And that any archived build launches: a green archive proves nothing about launch ([learnings.md](learnings.md) G5). |
| | The seat map's scroll shades in the iOS web view and at a real wide studio: seen only in desktop Chrome at 375px, in all five themes, with a made-up 40-seat layout. They are on the on-device checklist. |
| | The booking-horizon model: observed once, on 19 September 2026, from public timetable occupancy. Advisory only — it may suggest and explain, never block ([architecture/monday-release.md](architecture/monday-release.md)). |
| | The first-run welcome's hold at launch while iOS restores storage ([architecture/ios.md](architecture/ios.md) → "First-run welcome at launch"). It is on no written checklist yet. |
| | **Not run at all:** the Capacitor 6 → 8 upgrade ([../ios-app/UPGRADE-CAPACITOR-8.md](../ios-app/UPGRADE-CAPACITOR-8.md)). It needs the public npm registry and a phone; the calendar plugin's call shapes change between the majors and fail silently. |

## In the owner's hands

Not yours to do; offer help, do not start: the rows of [backlog.md](backlog.md) section 1; committing or pushing anything you find staged or ahead of `origin/main` (a push is a TestFlight archive and a web publish); and anything in App Store Connect or Xcode Cloud — no keys for it exist in the repository, by design.

## Your first hour

1. Where the tree really is: the commands of "State of play".
2. Read in the order of [README.md](README.md) → "The first five minutes". Then prove your setup:
3. `npm run ci` — nothing to install, no network. Expect `[check] OK`, `… passed, 0 failed`, `www/ is in sync`.
4. Serve the repository and run the smoke page: `python3 -m http.server 8080 --bind 127.0.0.1`, open `http://127.0.0.1:8080/tests/smoke.html`; the title must read `SMOKE: PASS`.
5. Boot the fake server once: [playbooks.md](playbooks.md#p8-verify-a-change-in-a-real-browser-on-the-fake-server) P8, steps 1–5. Book one class and read `H.writes`: exactly one `POST /bookings`, with the slots you picked.

Working agreement: [playbooks.md](playbooks.md#p0-every-change-the-loop) P0, [decisions.md](decisions.md#7-release-and-process) section 7. What the owner decided goes into decisions.md in their words.

## How we got here

The September 2026 programme in order — each line points at the file that describes the RESULT. The commit subjects in `git log` tell the same story; [../IMPROVEMENTS-2026-09.md](../IMPROVEMENTS-2026-09.md) has the reasons. Before it: a full-app review in July 2026 ([../REVIEW.md](../REVIEW.md)) and the August move of waitlists onto Psycle's own `/waitlists` API.

1. Booking, cancel and waitlist integrity: verified bookings, a `POST /bookings` never re-sent, seat-scoped cancel ids → [architecture/booking.md](architecture/booking.md), [architecture/waitlist.md](architecture/waitlist.md).
2. Reliability: retry rules, the offline queue, saved copies → [architecture/offline.md](architecture/offline.md).
3. Sessions and per-account data → [architecture/session-and-accounts.md](architecture/session-and-accounts.md), [architecture/storage-keys.md](architecture/storage-keys.md).
4. Accessibility plumbing: overlays, focus, announcements → [architecture/accessibility.md](architecture/accessibility.md).
5. Discover: live filters, the window cache, the Filters bar; then one day at a time, with a day strip and a swipe → [architecture/discover.md](architecture/discover.md), [architecture/day-pager.md](architecture/day-pager.md).
6. Stats as three sub-pages; a full-screen first-run welcome; leaner copy → [architecture/stats.md](architecture/stats.md), [architecture/welcome.md](architecture/welcome.md).
7. Three shipping failures and their fixes: the deployment-target floor, the UIScene life cycle, Lock Screen widget text cut off → [architecture/ios.md](architecture/ios.md) ([learnings.md](learnings.md) G3–G5; [../ios-app/CICD.md](../ios-app/CICD.md) → "Notes / gotchas").
8. The "Crisp Colour" redesign: one class card, class-type colours the member can tune, two typefaces → [architecture/design-system.md](architecture/design-system.md), [architecture/class-card.md](architecture/class-card.md), [architecture/class-type-colours.md](architecture/class-type-colours.md).
9. 24-hour times, a quieter clash line, Linen and Synthwave removed (five themes remain), a desktop layout → [architecture/time.md](architecture/time.md), [architecture/theming.md](architecture/theming.md).
10. The "Engraved Halves" mark, app icon, launch screen, App Store screenshots, and the tooling that rebuilds them → [decisions.md](decisions.md) section 3, [playbooks.md](playbooks.md) P7 step 5 and P9.
11. Widgets and the Live Activity in the new look, with one fixed-format date parser → [architecture/ios.md](architecture/ios.md) ([learnings.md](learnings.md) G1, G2).
12. Two small guards: a safe-area inset lost to a padding shorthand (13-safe-area.js; [learnings.md](learnings.md) D3) and an array-shaped profile body (`_profileFrom`; [learnings.md](learnings.md) A9).
13. "Your usual week" redone: review first, seats per class, suggested spots with a choose-only seat map, up to three weeks ahead, a card that folds, the Monday 12:00 reminder → [architecture/usual-week.md](architecture/usual-week.md), [architecture/monday-release.md](architecture/monday-release.md).
14. The small leftovers closed out: focus in the date picker, scroll shades on a wide seat map, the seat word in the offline-booking dialog (17-leftovers.js, offline-queue.js) → [architecture/sheets-and-dialogs.md](architecture/sheets-and-dialogs.md), [architecture/offline.md](architecture/offline.md).
15. These documents: the entry, this folder, the generated index, the folder guides → [README.md](README.md).
