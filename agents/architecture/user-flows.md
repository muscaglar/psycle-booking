# User flows — booking (and the waitlist branch), history sync, find similar
Read this when you want a flow end to end in ten lines before reading its code. Skip it when you already know the flow; the rules behind each step are in [booking.md](booking.md), [waitlist.md](waitlist.md) and [history-and-notify.md](history-and-notify.md).

## User Flows

### Booking Flow
```
Discover tab → tap class card → class detail sheet (photo, bio, availability)
  → tap Book → bike picker (class summary header, late-cancel deadline, clash line, preference indicators;
               your usual seat pre-selected — the first tap on another seat replaces it)
  → select slot(s) → confirm → post-booking confirmation (slide-up, "Free cancel until …")
  → "View my bookings" (switches tab) or "Done" (stays put — no auto tab switch)

No answer from Psycle (timeout / 5xx / 409) → '…' while /bookings is re-read (≤10s)
  → announced only if the seat is really there; otherwise "Failed — retry" or "Unconfirmed — retry"

Full class → "Join Waitlist" → confirm dialog (policy copy; no bike picker) → PUT /waitlists/{eventId}
  → "On the waitlist!" confirmation → Waitlisted card in My Bookings (Leave waitlist · Check for a spot)
  → Psycle auto-allocates (place becomes a booking on next fetch) OR emails an offer close to class
  → card shows "Spot offered" → Claim spot → confirm (credits, 12h policy) → POST /waitlist/{entryId}
```

### History Sync Flow
```
First login → history-sync prompt "Sync your booking history?" (dismissal is remembered) → "Sync my history" → fetches /bookings?type=previous
  → paginates (30 concurrent detail fetches) → merges into localStorage (up to 2000 entries)
  → Stats updates automatically; afterwards each /bookings load is reconciled in and a weekly top-up fills gaps
```

### Find Similar Flow
```
My Bookings → tap "↻ Similar" on a booking → popup with 3 options:
  → "Same class next week" | "Same instructor, any time" | "Same time, any instructor"
  → clears the filters it does not mean, sets its own and searches (not saved as the launch filters)
```
