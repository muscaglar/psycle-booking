package com.psyclefinder.app.countdown;

import com.psyclefinder.app.widget.PsyncSnapshot;

import java.util.List;
import java.util.TimeZone;

/**
 * What the class countdown should be doing at one instant: which class it counts down to (or
 * none), until when, and when to look again. The countdown is Android's stand-in for the
 * iPhone's Live Activity - ONE silent, ongoing notification with the system's own countdown,
 * from 90 minutes before the next held class until it starts.
 *
 * PURE ON PURPOSE: java.* and the pure PsyncSnapshot only, no android.* import, so the JVM
 * unit tests (app/src/test, PsyncCountdownPlanTest) run the real code. PsyncCountdownNotifier
 * turns a plan into a notification; PsyncCountdownReceiver arms the one alarm.
 *
 * The rules are the iPhone's (refreshFromSnapshot in PsycleLiveActivityController.swift):
 *
 *   - the class is the FIRST one in the snapshot that has not started - never a later one
 *     while an earlier one is still to come;
 *   - it shows when its start is at most LEAD_MILLIS away, and "at most" includes the exact
 *     millisecond (the iPhone declines only when secondsUntil > leadWindow);
 *   - a class that has started is never shown: at its start the class after it takes over, if
 *     that one is inside the window too;
 *   - startAt is a zone-less wall clock read in the zone handed in. The receiver hands in the
 *     DEVICE zone: the owner's closed decision (agents/decisions.md section 4) - do not
 *     "fix" it here. The window itself is 90 REAL minutes, whatever the clocks do in them;
 *   - a waitlist place is never counted down to: the bridge leaves it out of the snapshot,
 *     and PsyncSnapshot drops an entry that ever said `waitlisted`;
 *   - switched off (the member's class-reminders preference, PsyncSnapshot.KEY_COUNTDOWN_ENABLED)
 *     there is nothing to show and nothing to wake for;
 *   - a countdown the member SWIPED AWAY (Android 14 lets them) stays away: a swipe is an
 *     answer for that class at that start (keyFor), and no plan run re-posts it. A moved start,
 *     or the class after it, is another countdown and shows. The iPhone can only ask for a
 *     dismissed Live Activity again when the app is opened; here a plan runs with nobody asking.
 *
 * Whether a plan that shows may be POSTED at all is decided here too (mayPost), so that the
 * JVM tests run the rule the notifier follows.
 *
 * Nothing here throws, whatever the snapshot holds.
 */
public final class PsyncCountdownPlan {

    /** How long before a class the countdown starts: the iPhone's leadWindow, 90 * 60 seconds. */
    public static final long LEAD_MILLIS = 90L * 60L * 1000L;
    /** "No instant": for until and nextWake with nothing to show, or nothing to wake for. */
    public static final long NONE = -1L;

    /** The longest dismissal key read back: an id (PsyncSnapshot.MAX_TEXT), '@', a long's digits. */
    static final int MAX_KEY = PsyncSnapshot.MAX_TEXT + 1 + 20;

    private static final PsyncCountdownPlan NOTHING = new PsyncCountdownPlan(null, NONE, NONE, null);

    /** The class to count down to, or null: take the notification down. */
    public final PsyncSnapshot.Entry show;
    /** The shown class's start, as an instant: where the countdown reaches zero. NONE with no class. */
    public final long until;
    /**
     * When to plan again, as an instant strictly after the "now" this plan was made for, or
     * NONE: no alarm. The earlier of the shown class's start (it comes down; the next class
     * may take over) and the moment the next class that is NOT shown comes inside the window.
     */
    public final long nextWake;
    /**
     * What names the countdown this plan is about - the class inside the window and its start
     * (keyFor) - whether it shows or the member swiped it away. null with no class inside the
     * window. The notifier hands it to the notification's delete intent; the receiver forgets
     * a stored dismissal that is not this.
     */
    public final String key;

    private PsyncCountdownPlan(PsyncSnapshot.Entry show, long until, long nextWake, String key) {
        this.show = show;
        this.until = until;
        this.nextWake = nextWake;
        this.key = key;
    }

    /** Nothing to show, nothing to wake for. */
    public static PsyncCountdownPlan none() {
        return NOTHING;
    }

    /** The plan for nowMillis, with no countdown swiped away. */
    public static PsyncCountdownPlan of(PsyncSnapshot snapshot, long nowMillis, TimeZone zone, boolean enabled) {
        return of(snapshot, nowMillis, zone, enabled, null);
    }

    /**
     * The plan for nowMillis. `snapshot` may be null, `zone` may be null (the default zone);
     * `enabled` false is the member's off switch; `dismissedKey` is the key of the countdown
     * the member swiped away, or null.
     */
    public static PsyncCountdownPlan of(PsyncSnapshot snapshot, long nowMillis, TimeZone zone, boolean enabled,
                                        String dismissedKey) {
        if (!enabled || snapshot == null) {
            return NOTHING;
        }
        try {
            TimeZone tz = zone == null ? TimeZone.getDefault() : zone;
            // What has started is gone already, and the rest is soonest first.
            List<PsyncSnapshot.Entry> upcoming = snapshot.upcoming(nowMillis, tz);
            if (upcoming.isEmpty()) {
                return NOTHING;
            }
            PsyncSnapshot.Entry first = upcoming.get(0);
            long start = first.startMillis(tz);
            // upcoming() said so already. Said again, because everything below leans on it: a
            // start that is not ahead of now would be a countdown below zero, and a wake in
            // the past - an alarm that fires at once, plans, and arms itself again.
            if (start <= nowMillis) {
                return NOTHING;
            }
            long away = start - nowMillis;
            // away <= 0 with the start ahead of now is an OVERFLOW: a clock set so far back that
            // the class is further off than a long can say. That is "too far out", not "inside".
            if (away <= 0 || away > LEAD_MILLIS) {
                // Too far out, as the iPhone has it: nothing yet. Look again when it comes
                // inside the window.
                return new PsyncCountdownPlan(null, NONE, after(nowMillis, start - LEAD_MILLIS), null);
            }
            // Inside the window. Two classes can be: the first is shown, and the second takes
            // over when the first starts - which is the wake below.
            long wake = start;
            if (upcoming.size() > 1) {
                long nextOpens = upcoming.get(1).startMillis(tz) - LEAD_MILLIS;
                if (nextOpens > nowMillis && nextOpens < wake) {
                    wake = nextOpens;
                }
            }
            String key = keyFor(first.eventId, start);
            if (key.equals(dismissedKey)) {
                // Swiped away: nothing shows for THIS class at THIS start. The wake is kept - at
                // the start the class after it may take over, and nobody dismissed that one.
                return new PsyncCountdownPlan(null, NONE, after(nowMillis, wake), key);
            }
            return new PsyncCountdownPlan(first, start, after(nowMillis, wake), key);
        } catch (RuntimeException e) {
            // Nothing above is known to throw. A countdown that is not there is the safe
            // answer to a snapshot that ever proves otherwise.
            return NOTHING;
        }
    }

    /** `at` when it is strictly after now, else NONE: an alarm is never armed for the past. */
    private static long after(long nowMillis, long at) {
        return at > nowMillis ? at : NONE;
    }

    // -- A countdown the member swiped away -----------------------------------------------------

    /**
     * What names ONE countdown: the class's id, an "@", and the instant it starts in
     * milliseconds - "9001@1790271000000". The start is part of it on purpose: a class that
     * MOVES is a new countdown, and shows again.
     */
    public static String keyFor(String eventId, long startMillis) {
        return (eventId == null ? "" : eventId) + "@" + startMillis;
    }

    /**
     * True for a string keyFor could have made: what the dismissal's receiver may store. The
     * key comes back from the system inside the app's own immutable PendingIntent; this only
     * keeps a stray value - null, empty, overlong - out of the store.
     */
    public static boolean isKey(String key) {
        if (key == null || key.length() > MAX_KEY) {
            return false;
        }
        int at = key.lastIndexOf('@');
        if (at < 1 || at == key.length() - 1) {
            return false;
        }
        for (int i = at + 1; i < key.length(); i++) {
            char c = key.charAt(i);
            if (c < '0' || c > '9') {
                return false;
            }
        }
        return true;
    }

    // -- Whether it may be posted ---------------------------------------------------------------

    /**
     * Whether the notification may be UP after this plan run; false = take it down. It shows a
     * class that has not started, the app can post at all (the permission, the app's
     * notifications - the notifier only LOOKS), and something is sure to END it: the system's
     * own timeout (systemEndsIt: Android 8+, setTimeoutAfter) or, below that, the receiver's
     * alarm for the start (alarmArmed). A notification that outstays its class is worse than none.
     */
    public boolean mayPost(boolean alarmArmed, boolean systemEndsIt, boolean canPost, long nowMillis) {
        if (!shows() || !canPost) {
            return false;
        }
        if (timeoutMillis(nowMillis) <= 0) {
            return false;
        }
        return systemEndsIt || alarmArmed;
    }

    // -- What the notification says ------------------------------------------------------------

    /** True when there is a class to count down to. */
    public boolean shows() {
        return show != null && until > 0;
    }

    /** The notification's title: the class name, as the widget prints it. "" with no class. */
    public String title() {
        return show == null ? "" : show.title();
    }

    /** "18:30": the start as the snapshot writes it, 24-hour. "" with no class. */
    public String startLabel() {
        return show == null ? "" : show.timeLabel();
    }

    /**
     * The notification's text: the place and the seat in the widget's own words, joined the
     * way the widget joins who and where - "Shoreditch (middle dot) Bike 9". Either part may
     * be missing, and then so is the dot; with neither it is "".
     *
     * withStartTime puts the start in front - "18:30 (middle dot) Shoreditch (middle dot)
     * Bike 9" - for an Android too old to count down by itself (below 7.0), where the time is
     * otherwise said nowhere.
     */
    public String text(boolean withStartTime) {
        if (show == null) {
            return "";
        }
        StringBuilder out = new StringBuilder();
        if (withStartTime) {
            out.append(show.timeLabel());
        }
        join(out, show.place());
        join(out, show.seatLabel());
        return out.toString();
    }

    private static void join(StringBuilder out, String part) {
        if (part == null || part.isEmpty()) {
            return;
        }
        if (out.length() > 0) {
            out.append(" \u00B7 ");
        }
        out.append(part);
    }

    /**
     * The notification's accent: the class's own base colour when the snapshot's colours are
     * colours, else the neutral "Other" colour - PsyncSnapshot settles which, exactly as it
     * does for the widget's seat badge. The LIGHT side, always: the system adjusts an accent
     * for the shade it draws on, and one notification can outlive a sunset. 0 with no class.
     */
    public int colour() {
        return show == null ? 0 : show.look(false).chipFill;
    }

    /**
     * How long from nowMillis until the class starts - what the system is asked to remove the
     * notification after, so that it goes at the start even if nothing in the app wakes. NONE
     * when that is not a positive time.
     */
    public long timeoutMillis(long nowMillis) {
        if (!shows() || until <= nowMillis) {
            return NONE;
        }
        long left = until - nowMillis;
        // Not positive with the start ahead of now: an overflow, from a clock that is not a clock.
        return left > 0 ? left : NONE;
    }
}
