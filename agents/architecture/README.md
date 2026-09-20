# Psycle Class Finder — Architecture
The depth of the former CLAUDE.md, split by topic and moved verbatim. Read this when a comment or a doc names a section ("CLAUDE.md → Gym time") and you need its file; skip it when the reading guide in [AGENTS.md](../../AGENTS.md) has already routed you.

- Under each file's two-line header the text is unchanged. A cross-reference inside it ("see Theming", "see Monday-noon release below", "see Key Patterns → The class card") names a section TITLE: find the title in this table, or `grep -rn "<title>" agents/`.
- Proof that nothing was lost in the move: `node agents/tools/check-split.mjs`.

| Section title, as it was in CLAUDE.md | Now in |
|---|---|
| the opening lines · **Hard rule** · Quick Start | [AGENTS.md](../../AGENTS.md) |
| Repo Structure · Script Load Order (critical!) · Where to Edit | [../repo-map.md](../repo-map.md) |
| Build & CI · Tests | [testing-and-ci.md](testing-and-ci.md) |
| Native iOS (WIRED …) · iOS App | [ios.md](ios.md) |
| Tab Structure (4 tabs) | [tab-structure.md](tab-structure.md) |
| Design System (css/theme.css) · Token Groups · The Crisp Colour layer (css/crisp.css) · Colour Hierarchy | [design-system.md](design-system.md) |
| Theming | [theming.md](theming.md) |
| Key Patterns (the heading) · State · Events · Monkey-patching · Slot labels · Instructor links | [core-patterns.md](core-patterns.md) |
| Class-type colours (Crisp Colour) | [class-type-colours.md](class-type-colours.md) |
| The class card (Crisp Colour) | [class-card.md](class-card.md) |
| Session states · Session persistence · Data owner (per-account data) · Stored data is untrusted / settings import | [session-and-accounts.md](session-and-accounts.md) |
| Live filters · Filters bar + chips · Discover window cache · Focused searches | [discover.md](discover.md) |
| Day pager · Shared swipe helper | [day-pager.md](day-pager.md) |
| Monday-noon release · Monday reminder (iOS) · Booking horizon (OBSERVED, advisory) | [monday-release.md](monday-release.md) |
| Stats sub-pages | [stats.md](stats.md) |
| First-run welcome | [welcome.md](welcome.md) |
| Booking — `bookClass` guards · Bookings are verified, and a booking POST is never re-sent · Seat-scoped cancel ids · Clash warnings · No-layout studios | [booking.md](booking.md) |
| Sheets, picker and dialogs (Crisp Colour) | [sheets-and-dialogs.md](sheets-and-dialogs.md) |
| Gym time (Europe/London) · Clock times (24-hour) | [time.md](time.md) |
| Waitlist · Waitlist phases | [waitlist.md](waitlist.md) |
| Failed cancels · Offline queue · Saved copy vs saved class details | [offline.md](offline.md) |
| My Bookings commit + minute tick · My Bookings card + More menu (Crisp Colour) | [bookings-tab.md](bookings-tab.md) |
| Usual week (weekly template) · Usual week — the review sheet and the run | [usual-week.md](usual-week.md) |
| Notify me · History | [history-and-notify.md](history-and-notify.md) |
| Accessibility plumbing | [accessibility.md](accessibility.md) |
| PWA shell | [pwa-shell.md](pwa-shell.md) |
| User Flows (Booking · History Sync · Find Similar) | [user-flows.md](user-flows.md) |
| API | [api.md](api.md) |
| localStorage Keys · sessionStorage Keys | [storage-keys.md](storage-keys.md) |
