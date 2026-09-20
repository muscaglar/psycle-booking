package com.psyclefinder.app.countdown;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import com.psyclefinder.app.widget.PsyncSnapshot;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

import org.junit.Test;

/**
 * PsyncCountdownPlan on the JVM (./gradlew testDebugUnitTest): what the class countdown shows,
 * until when, and when it looks again - with no phone and no emulator. org.json comes from the
 * testImplementation line in app/build.gradle.
 *
 * Every date here is fixed; 2026-09-24 is a Thursday, and the UK's clocks change on
 * 2026-03-29 (forward) and 2026-10-25 (back). Names are the fake Psycle server's
 * (tests/tools/fake-psycle.js). Every instant is compared as a whole number of milliseconds:
 * the window's edges are exact.
 */
public class PsyncCountdownPlanTest {

    private static final TimeZone LONDON = TimeZone.getTimeZone("Europe/London");
    private static final TimeZone NEW_YORK = TimeZone.getTimeZone("America/New_York");
    private static final TimeZone TOKYO = TimeZone.getTimeZone("Asia/Tokyo");
    private static final TimeZone UTC = TimeZone.getTimeZone("UTC");

    private static final long MINUTE = 60L * 1000L;
    private static final long LEAD = PsyncCountdownPlan.LEAD_MILLIS;
    private static final long NONE = PsyncCountdownPlan.NONE;

    private static final String RIDE_SOFT =
        ",\"ct\":\"ride\",\"ctIntensity\":\"soft\""
        + ",\"ctBase\":\"#2D5FD6\",\"ctTint\":\"#E9F0FF\",\"ctDeep\":\"#1A3785\",\"ctWash\":\"#D6E2FF\""
        + ",\"ctBaseDark\":\"#3A6EE7\",\"ctTintDark\":\"#1F2C4A\",\"ctDeepDark\":\"#D6E2FF\",\"ctWashDark\":\"#233560\"";

    // -- Helpers ------------------------------------------------------------------------------

    /** A wall clock in a zone, as an instant. */
    private static long at(String wall, TimeZone zone) {
        long millis = PsyncSnapshot.wallMillis(wall, zone);
        assertTrue("a readable wall clock: " + wall, millis > 0);
        return millis;
    }

    /** A London wall clock as an instant. */
    private static long at(String wall) {
        return at(wall, LONDON);
    }

    /** One class as the bridge writes it; `more` is spliced in as further fields (",\"x\":1"). */
    private static String entry(String id, String startAt, String type, String slots, String more) {
        return "{\"eventId\":\"" + id + "\",\"startAt\":\"" + startAt + "\",\"instrName\":\"Alex Hart\""
            + ",\"typeName\":\"" + type + "\",\"studioName\":\"Studio One\",\"locName\":\"Shoreditch\""
            + ",\"slots\":" + slots + more + "}";
    }

    private static String ride(String id, String startAt) {
        return entry(id, startAt, "RIDE 45", "[9]", RIDE_SOFT);
    }

    private static PsyncSnapshot snapshot(String... entries) {
        StringBuilder out = new StringBuilder("[");
        for (int i = 0; i < entries.length; i++) {
            out.append(i == 0 ? "" : ",").append(entries[i]);
        }
        return PsyncSnapshot.parse(null, out.append("]").toString(), null);
    }

    private static PsyncCountdownPlan plan(PsyncSnapshot snapshot, long now) {
        return PsyncCountdownPlan.of(snapshot, now, LONDON, true);
    }

    private static String shownId(PsyncCountdownPlan plan) {
        return plan.show == null ? null : plan.show.eventId;
    }

    private static void assertNothing(String what, PsyncCountdownPlan plan) {
        assertFalse(what + ": nothing shows", plan.shows());
        assertNull(what + ": no class", plan.show);
        assertEquals(what + ": no until", NONE, plan.until);
    }

    private static void assertShows(String what, String id, long until, PsyncCountdownPlan plan) {
        assertTrue(what + ": it shows", plan.shows());
        assertEquals(what + ": which class", id, shownId(plan));
        assertEquals(what + ": until its start", until, plan.until);
    }

    // -- The window ---------------------------------------------------------------------------

    @Test
    public void theLeadIsTheIPhonesNinetyMinutes() {
        assertEquals(90L * 60L * 1000L, PsyncCountdownPlan.LEAD_MILLIS);
        assertEquals(5400000L, LEAD);
    }

    @Test
    public void theWindowOpensAtExactlyNinetyMinutesToTheMillisecond() {
        PsyncSnapshot snapshot = snapshot(ride("77", "2026-09-24T18:30:00"));
        long start = at("2026-09-24T18:30:00");
        long opens = start - LEAD;
        assertEquals("17:00 on the wall", at("2026-09-24T17:00:00"), opens);

        PsyncCountdownPlan early = plan(snapshot, opens - 1);
        assertNothing("a millisecond before the window", early);
        assertEquals("...it looks again when the window opens", opens, early.nextWake);

        PsyncCountdownPlan edge = plan(snapshot, opens);
        assertShows("exactly ninety minutes before (the iPhone declines only BEYOND its leadWindow)", "77", start, edge);
        assertEquals("...and looks again at the start", start, edge.nextWake);
        assertEquals("...with the whole lead on the clock", LEAD, edge.timeoutMillis(opens));

        PsyncCountdownPlan inside = plan(snapshot, opens + 1);
        assertShows("a millisecond inside", "77", start, inside);
        assertEquals(LEAD - 1, inside.timeoutMillis(opens + 1));

        PsyncCountdownPlan hours = plan(snapshot, start - 6 * 60 * MINUTE);
        assertNothing("six hours before", hours);
        assertEquals(opens, hours.nextWake);
    }

    @Test
    public void theWindowShutsAtTheStartToTheMillisecond() {
        PsyncSnapshot snapshot = snapshot(ride("77", "2026-09-24T18:30:00"));
        long start = at("2026-09-24T18:30:00");

        PsyncCountdownPlan last = plan(snapshot, start - 1);
        assertShows("the last millisecond before the class", "77", start, last);
        assertEquals(start, last.nextWake);
        assertEquals(1L, last.timeoutMillis(start - 1));

        PsyncCountdownPlan started = plan(snapshot, start);
        assertNothing("at the start the class HAS started", started);
        assertEquals("...and with no class after it there is nothing to wake for", NONE, started.nextWake);
        assertEquals(NONE, started.timeoutMillis(start));

        assertNothing("a millisecond in", plan(snapshot, start + 1));
        assertNothing("an hour in", plan(snapshot, start + 60 * MINUTE));
    }

    // -- Two classes --------------------------------------------------------------------------

    @Test
    public void withTwoClassesInsideTheWindowTheFirstShowsAndTheSecondTakesOverAtItsStart() {
        PsyncSnapshot snapshot = snapshot(ride("1", "2026-09-24T18:30:00"),
            entry("2", "2026-09-24T19:15:00", "STRENGTH: Full Body", "[3]", ""));
        long first = at("2026-09-24T18:30:00");
        long second = at("2026-09-24T19:15:00");

        PsyncCountdownPlan both = plan(snapshot, at("2026-09-24T18:00:00"));
        assertShows("18:00, both inside the window", "1", first, both);
        assertEquals("the second's window opened at 17:45, which is past: the only wake is the first's start", first, both.nextWake);

        PsyncCountdownPlan handOver = plan(snapshot, first);
        assertShows("the moment the first starts", "2", second, handOver);
        assertEquals(second, handOver.nextWake);
        assertEquals("STRENGTH: Full Body", handOver.title());
        assertEquals("Shoreditch \u00B7 Bench 3", handOver.text(false));

        assertShows("a millisecond before that, still the first", "1", first, plan(snapshot, first - 1));

        PsyncCountdownPlan over = plan(snapshot, second);
        assertNothing("when the second starts", over);
        assertEquals(NONE, over.nextWake);
    }

    @Test
    public void aSecondClassFurtherOutWaitsForItsOwnWindow() {
        PsyncSnapshot snapshot = snapshot(ride("1", "2026-09-24T18:30:00"), ride("2", "2026-09-24T20:15:00"));
        long first = at("2026-09-24T18:30:00");
        long second = at("2026-09-24T20:15:00");

        PsyncCountdownPlan showing = plan(snapshot, at("2026-09-24T18:00:00"));
        assertShows("18:00", "1", first, showing);
        assertEquals("the second's window (18:45) opens after the first has started: the first's start comes first", first, showing.nextWake);

        PsyncCountdownPlan between = plan(snapshot, first);
        assertNothing("18:30: the first has started, the second is 105 minutes away", between);
        assertEquals("...so it looks again at 18:45", second - LEAD, between.nextWake);
        assertEquals(at("2026-09-24T18:45:00"), between.nextWake);

        assertShows("18:45", "2", second, plan(snapshot, second - LEAD));
    }

    @Test
    public void theWakeIsTheEarlierOfTheShownStartAndTheNextWindowOpening() {
        // 18:30 and 19:45. At 17:30 the first shows; the second's window opens at 18:15, before
        // the first starts - so that is the earlier wake. It changes nothing on screen.
        PsyncSnapshot snapshot = snapshot(ride("1", "2026-09-24T18:30:00"), ride("2", "2026-09-24T19:45:00"));
        long first = at("2026-09-24T18:30:00");
        long nextOpens = at("2026-09-24T18:15:00");

        PsyncCountdownPlan early = plan(snapshot, at("2026-09-24T17:30:00"));
        assertShows("17:30", "1", first, early);
        assertEquals(nextOpens, early.nextWake);

        PsyncCountdownPlan then = plan(snapshot, nextOpens);
        assertShows("18:15: still the first - never a later class while an earlier one is to come", "1", first, then);
        assertEquals("...and now the only wake left is its start", first, then.nextWake);
    }

    @Test
    public void theSoonestClassIsTheOneWhateverOrderTheSnapshotIsIn() {
        PsyncSnapshot snapshot = snapshot(ride("late", "2026-09-24T19:00:00"), ride("soon", "2026-09-24T18:00:00"));
        assertShows("stored latest first", "soon", at("2026-09-24T18:00:00"), plan(snapshot, at("2026-09-24T17:45:00")));
    }

    @Test
    public void twoClassesAtTheSameMinuteShowTheFirstStoredAndLeaveTogether() {
        PsyncSnapshot snapshot = snapshot(ride("a", "2026-09-24T18:30:00"), ride("b", "2026-09-24T18:30:00"));
        long start = at("2026-09-24T18:30:00");
        PsyncCountdownPlan pair = plan(snapshot, start - 10 * MINUTE);
        assertShows("a same-minute pair", "a", start, pair);
        assertEquals(start, pair.nextWake);
        assertNothing("at their start both have started", plan(snapshot, start));
    }

    @Test
    public void followingTheAlarmsWalksThroughEveryClassAndThenStops() {
        PsyncSnapshot snapshot = snapshot(ride("1", "2026-09-24T07:30:00"), ride("2", "2026-09-24T08:15:00"),
            ride("3", "2026-09-24T18:30:00"), ride("4", "2026-09-25T07:30:00"));
        long now = at("2026-09-23T22:00:00");
        List<String> seen = new ArrayList<String>();
        int wakes = 0;
        while (true) {
            PsyncCountdownPlan plan = plan(snapshot, now);
            seen.add(String.valueOf(shownId(plan)));
            if (plan.nextWake == NONE) {
                break;
            }
            assertTrue("a wake is strictly after the now it was planned for", plan.nextWake > now);
            now = plan.nextWake;
            wakes++;
            assertTrue("the chain of alarms ends", wakes < 20);
        }
        // 1 is seen TWICE: at 06:00 its window opens, and at 06:45 class 2's window opens while 1
        // is still to come - the earlier of the two wakes, which changes nothing on screen.
        List<String> expected = new ArrayList<String>();
        for (String id : new String[] {"null", "1", "1", "2", "null", "3", "null", "4", "null"}) {
            expected.add(id);
        }
        assertEquals("nothing overnight, 1, then 2 straight after it, nothing till 17:00, 3, nothing, 4, nothing - and no alarm left",
            expected, seen);
        assertEquals("06:00, 06:45, 07:30, 08:15, 17:00, 18:30, then Friday's 06:00 and 07:30", 8, wakes);
    }

    @Test
    public void everyPlanIsSaneMinuteByMinuteAcrossADay() {
        PsyncSnapshot snapshot = snapshot(ride("1", "2026-09-24T07:30:00"), ride("2", "2026-09-24T08:15:00"),
            ride("3", "2026-09-24T18:30:00"));
        TimeZone[] zones = {LONDON, NEW_YORK, TOKYO, TimeZone.getTimeZone("Pacific/Kiritimati"), TimeZone.getTimeZone("Pacific/Honolulu")};
        for (TimeZone zone : zones) {
            long from = at("2026-09-23T00:00:00", zone);
            for (int step = 0; step < 3 * 24 * 60; step++) {
                long now = from + step * MINUTE + (step % 7);
                PsyncCountdownPlan plan = PsyncCountdownPlan.of(snapshot, now, zone, true);
                String where = " at step " + step + " in " + zone.getID();
                assertTrue("a wake is after now, or there is none" + where, plan.nextWake == NONE || plan.nextWake > now);
                if (plan.shows()) {
                    assertTrue("a shown class has not started" + where, plan.until > now);
                    assertTrue("...and starts within ninety minutes" + where, plan.until - now <= LEAD);
                    assertEquals("...which is its own start" + where, plan.show.startMillis(zone), plan.until);
                    assertTrue("...and the plan wakes no later than that" + where, plan.nextWake != NONE && plan.nextWake <= plan.until);
                    assertEquals(plan.until - now, plan.timeoutMillis(now));
                } else {
                    assertEquals(NONE, plan.until);
                    assertEquals(NONE, plan.timeoutMillis(now));
                }
            }
        }
    }

    // -- Nothing to show ----------------------------------------------------------------------

    @Test
    public void nothingUpcomingIsNothingAndNoAlarm() {
        long now = at("2026-09-24T17:30:00");
        PsyncCountdownPlan[] plans = {
            plan(PsyncSnapshot.empty(), now),
            plan(PsyncSnapshot.parse("null", "[]", "[]"), now),
            plan(PsyncSnapshot.parse(null, null, null), now),
            plan(snapshot(ride("1", "2026-09-24T07:30:00"), ride("2", "2026-09-23T18:30:00")), now),
        };
        for (PsyncCountdownPlan plan : plans) {
            assertNothing("nothing upcoming", plan);
            assertEquals("no alarm", NONE, plan.nextWake);
        }
        assertSame("none() is what they all are", PsyncCountdownPlan.none(), plans[0]);
    }

    @Test
    public void theSnapshotASignOutWritesTakesTheCountdownDown() {
        long now = at("2026-09-24T17:30:00");
        assertShows("signed in, a class in an hour", "77", at("2026-09-24T18:30:00"),
            plan(snapshot(ride("77", "2026-09-24T18:30:00")), now));
        PsyncCountdownPlan signedOut = plan(PsyncSnapshot.parse("null", "[]", "[]"), now);
        assertNothing("the empty snapshot of a sign-out", signedOut);
        assertEquals(NONE, signedOut.nextWake);
    }

    @Test
    public void switchedOffThereIsNothingToShowAndNothingToWakeFor() {
        PsyncSnapshot snapshot = snapshot(ride("77", "2026-09-24T18:30:00"));
        long inside = at("2026-09-24T17:30:00");
        long before = at("2026-09-24T09:00:00");
        assertShows("on", "77", at("2026-09-24T18:30:00"), PsyncCountdownPlan.of(snapshot, inside, LONDON, true));
        PsyncCountdownPlan off = PsyncCountdownPlan.of(snapshot, inside, LONDON, false);
        assertNothing("off, inside the window", off);
        assertEquals(NONE, off.nextWake);
        PsyncCountdownPlan offEarly = PsyncCountdownPlan.of(snapshot, before, LONDON, false);
        assertNothing("off, before the window", offEarly);
        assertEquals("no alarm is kept for a countdown that is switched off", NONE, offEarly.nextWake);
    }

    @Test
    public void aGarbageSnapshotIsNothingAndNothingThrows() {
        long now = at("2026-09-24T17:30:00");
        String[] garbage = {
            null, "", "   ", "null", "not json", "123", "true", "\"text\"", "[1,2,3]", "{\"a\":1}",
            "{", "[", "]", "[{\"eventId\":7}]", "[[[[[[[[[[[[[[1]]]]]]]]]]]]]]",
            "{\"eventId\":\"1\",\"startAt\":\"yesterday\",\"slots\":[]}",
            "[null,false,\"x\",{\"eventId\":null,\"startAt\":null}]",
            "[{\"eventId\":\"1\",\"startAt\":\"2026-09-24T18:61:00\"}]",
        };
        for (String raw : garbage) {
            PsyncCountdownPlan plan = plan(PsyncSnapshot.parse(raw, raw, raw), now);
            assertNothing("from: " + raw, plan);
            assertEquals("no alarm from: " + raw, NONE, plan.nextWake);
        }
        PsyncCountdownPlan noSnapshot = PsyncCountdownPlan.of(null, now, LONDON, true);
        assertNothing("no snapshot at all", noSnapshot);
        assertEquals(NONE, noSnapshot.nextWake);
        assertNotNull("no zone is the default zone, not a crash",
            PsyncCountdownPlan.of(snapshot(ride("77", "2026-09-24T18:30:00")), now, null, true));
        assertNotNull(PsyncCountdownPlan.of(snapshot(ride("77", "2026-09-24T18:30:00")), Long.MAX_VALUE, LONDON, true));
        assertNotNull(PsyncCountdownPlan.of(snapshot(ride("77", "2026-09-24T18:30:00")), Long.MIN_VALUE, LONDON, true));
    }

    @Test
    public void aClockFarInThePastNeverArmsAnAlarmBehindItself() {
        // now = the smallest instant there is: start - now overflows. Whatever the plan, its
        // wake is after now or there is none, and nothing shows that is not within the lead.
        PsyncSnapshot snapshot = snapshot(ride("77", "2026-09-24T18:30:00"));
        long[] odd = {Long.MIN_VALUE, Long.MIN_VALUE + 1, -1L, 0L, 1L, Long.MAX_VALUE - 1, Long.MAX_VALUE};
        for (long now : odd) {
            PsyncCountdownPlan plan = plan(snapshot, now);
            assertTrue("at " + now, plan.nextWake == NONE || plan.nextWake > now);
            if (plan.shows()) {
                assertTrue("at " + now, plan.until > now && plan.until - now <= LEAD && plan.until - now > 0);
            }
        }
        // The same for the time left: asked of a clock that far back, until - now overflows.
        // It is the system's removal timeout, so it is a positive time or it is NONE.
        PsyncCountdownPlan showing = plan(snapshot, at("2026-09-24T17:30:00"));
        assertTrue(showing.shows());
        assertEquals(60 * MINUTE, showing.timeoutMillis(at("2026-09-24T17:30:00")));
        assertEquals("an overflow is not a timeout", NONE, showing.timeoutMillis(Long.MIN_VALUE));
        assertEquals("nor is a clock past the start", NONE, showing.timeoutMillis(Long.MAX_VALUE));
        assertEquals(NONE, showing.timeoutMillis(showing.until));
    }

    @Test
    public void aWaitlistPlaceIsNeverCountedDownTo() {
        long now = at("2026-09-24T17:30:00");
        // The bridge never writes a waitlist place into the snapshot. Should one ever arrive
        // marked as such, it is not a held class: not shown, not counted down to.
        PsyncSnapshot waiting = snapshot(entry("5", "2026-09-24T18:00:00", "RIDE 45", "[]", ",\"waitlisted\":true"));
        assertNothing("a place on a waitlist", plan(waiting, now));
        assertEquals(NONE, plan(waiting, now).nextWake);
        assertTrue("...and the widget does not show it either", waiting.upcoming(now, LONDON).isEmpty());

        PsyncSnapshot mixed = snapshot(entry("5", "2026-09-24T18:00:00", "RIDE 45", "[]", ",\"waitlisted\":true"),
            ride("6", "2026-09-24T18:30:00"));
        assertShows("the held class behind it is the one", "6", at("2026-09-24T18:30:00"), plan(mixed, now));

        PsyncSnapshot held = snapshot(entry("7", "2026-09-24T18:00:00", "RIDE 45", "[9]", ",\"waitlisted\":false"));
        assertShows("waitlisted:false is a held class", "7", at("2026-09-24T18:00:00"), plan(held, now));
        PsyncSnapshot text = snapshot(entry("8", "2026-09-24T18:00:00", "RIDE 45", "[9]", ",\"waitlisted\":\"true\""));
        assertShows("only a JSON true says so - as every other field is read", "8", at("2026-09-24T18:00:00"), plan(text, now));
    }

    // -- Zones --------------------------------------------------------------------------------

    @Test
    public void theStartIsAWallClockInTheZoneHandedInEastAndWestOfLondon() {
        PsyncSnapshot snapshot = snapshot(ride("77", "2026-09-24T18:30:00"));
        TimeZone[] zones = {LONDON, NEW_YORK, TOKYO};
        for (TimeZone zone : zones) {
            String in = " in " + zone.getID();
            long start = at("2026-09-24T18:30:00", zone);
            PsyncCountdownPlan edge = PsyncCountdownPlan.of(snapshot, at("2026-09-24T17:00:00", zone), zone, true);
            assertShows("17:00 on that zone's wall" + in, "77", start, edge);
            assertEquals(start, edge.nextWake);
            PsyncCountdownPlan early = PsyncCountdownPlan.of(snapshot, at("2026-09-24T16:59:59", zone), zone, true);
            assertNothing("16:59:59" + in, early);
            assertEquals(start - LEAD, early.nextWake);
            assertEquals("the digits are the snapshot's, whatever the zone" + in, "18:30", edge.startLabel());
        }
        assertTrue("the three starts are three instants", at("2026-09-24T18:30:00", TOKYO) < at("2026-09-24T18:30:00", LONDON)
            && at("2026-09-24T18:30:00", LONDON) < at("2026-09-24T18:30:00", NEW_YORK));
    }

    @Test
    public void oneInstantIsThreePlansInThreeZones() {
        // 17:30 in London, the same instant everywhere. Device-local by the owner's closed
        // decision: a phone on New York time reads 18:30 as ITS 18:30, five hours later; a phone
        // on Tokyo time reads it as 18:30 JST, which was 10:30 in London and has gone.
        PsyncSnapshot snapshot = snapshot(ride("77", "2026-09-24T18:30:00"));
        long now = at("2026-09-24T17:30:00");

        assertShows("London", "77", at("2026-09-24T18:30:00"), PsyncCountdownPlan.of(snapshot, now, LONDON, true));

        PsyncCountdownPlan west = PsyncCountdownPlan.of(snapshot, now, NEW_YORK, true);
        assertNothing("New York: six hours away", west);
        assertEquals(at("2026-09-24T17:00:00", NEW_YORK), west.nextWake);

        PsyncCountdownPlan east = PsyncCountdownPlan.of(snapshot, now, TOKYO, true);
        assertNothing("Tokyo: already started", east);
        assertEquals(NONE, east.nextWake);
    }

    @Test
    public void theWindowIsNinetyRealMinutesOnTheDayTheClocksGoBack() {
        // 2026-10-25: 02:00 BST becomes 01:00 GMT. A class at 02:30 (GMT, 02:30Z) is THREE real
        // hours after 00:30 (BST, 23:30Z the day before), though the wall says two.
        PsyncSnapshot snapshot = snapshot(ride("77", "2026-10-25T02:30:00"));
        long start = at("2026-10-25T02:30:00", UTC);
        assertEquals("02:30 on the wall is 02:30 GMT", start, at("2026-10-25T02:30:00"));
        long before = at("2026-10-25T00:30:00");
        assertEquals("00:30 on the wall is still BST", at("2026-10-24T23:30:00", UTC), before);

        PsyncCountdownPlan early = plan(snapshot, before);
        assertNothing("three real hours before", early);
        assertEquals("the window opens 90 REAL minutes before: 01:00 GMT, the second 01:00 of the night",
            at("2026-10-25T01:00:00", UTC), early.nextWake);

        assertNothing("a millisecond before that", plan(snapshot, at("2026-10-25T01:00:00", UTC) - 1));
        PsyncCountdownPlan edge = plan(snapshot, at("2026-10-25T01:00:00", UTC));
        assertShows("at 01:00 GMT", "77", start, edge);
        assertEquals(LEAD, edge.timeoutMillis(at("2026-10-25T01:00:00", UTC)));
        assertNothing("the FIRST 01:00 of the night (BST, 00:00Z) is 150 real minutes before",
            plan(snapshot, at("2026-10-25T00:00:00", UTC)));
    }

    @Test
    public void theWindowIsNinetyRealMinutesOnTheDayTheClocksGoForward() {
        // 2026-03-29: 01:00 GMT becomes 02:00 BST. A class at 03:00 (BST, 02:00Z) is 75 real
        // minutes after 00:45 (GMT), though the wall says two and a quarter hours.
        PsyncSnapshot snapshot = snapshot(ride("77", "2026-03-29T03:00:00"));
        long start = at("2026-03-29T02:00:00", UTC);
        assertEquals("03:00 on the wall is 02:00Z", start, at("2026-03-29T03:00:00"));

        PsyncCountdownPlan inside = plan(snapshot, at("2026-03-29T00:45:00"));
        assertShows("00:45 GMT, 75 real minutes before", "77", start, inside);
        assertEquals(75 * MINUTE, inside.timeoutMillis(at("2026-03-29T00:45:00")));

        PsyncCountdownPlan early = plan(snapshot, at("2026-03-29T00:29:59"));
        assertNothing("00:29:59 GMT, a second outside", early);
        assertEquals(at("2026-03-29T00:30:00", UTC), early.nextWake);
        assertShows("00:30:00 GMT, the edge", "77", start, plan(snapshot, at("2026-03-29T00:30:00")));
    }

    @Test
    public void nothingFollowsThePhonesLocaleOrItsDefaultZone() {
        Locale locale = Locale.getDefault();
        TimeZone zone = TimeZone.getDefault();
        String[] tags = {"tr-TR", "ar-SA-u-nu-arab", "th-TH-u-ca-buddhist-nu-thai", "en-US"};
        try {
            for (String tag : tags) {
                Locale.setDefault(Locale.forLanguageTag(tag));
                TimeZone.setDefault(TimeZone.getTimeZone("Pacific/Kiritimati"));
                String under = " under " + tag;
                PsyncSnapshot snapshot = snapshot(entry("77", "2026-09-24T06:05:00", "ride 45", "[9,12]", RIDE_SOFT));
                PsyncCountdownPlan plan = plan(snapshot, at("2026-09-24T05:00:00"));
                assertShows("the plan" + under, "77", at("2026-09-24T06:05:00"), plan);
                assertEquals("the digits" + under, "06:05", plan.startLabel());
                assertEquals("the words" + under, "Shoreditch \u00B7 Bikes 9 & 12", plan.text(false));
                assertEquals("the words with the time" + under, "06:05 \u00B7 Shoreditch \u00B7 Bikes 9 & 12", plan.text(true));
            }
        } finally {
            Locale.setDefault(locale);
            TimeZone.setDefault(zone);
        }
    }

    // -- What the notification says -----------------------------------------------------------

    @Test
    public void theTextIsThePlaceAndTheSeatInTheWidgetsWords() {
        long now = at("2026-09-24T17:30:00");
        PsyncCountdownPlan ride = plan(snapshot(ride("77", "2026-09-24T18:30:00")), now);
        assertEquals("RIDE 45", ride.title());
        assertEquals("18:30", ride.startLabel());
        assertEquals("Shoreditch \u00B7 Bike 9", ride.text(false));
        assertEquals("below Android 7 nothing counts down, so the text opens with the start", "18:30 \u00B7 Shoreditch \u00B7 Bike 9", ride.text(true));
        assertEquals("the place is the widget's place()", ride.show.place() + " \u00B7 " + ride.show.seatLabel(), ride.text(false));

        assertEquals("two seats", "Shoreditch \u00B7 Bikes 5 & 6",
            plan(snapshot(entry("1", "2026-09-24T18:30:00", "RIDE 45", "[5,6]", "")), now).text(false));
        assertEquals("no seat map: the place alone, and no dot", "Shoreditch",
            plan(snapshot(entry("1", "2026-09-24T18:30:00", "YOGA Flow", "[]", "")), now).text(false));
        assertEquals("...and the start in front of it", "18:30 \u00B7 Shoreditch",
            plan(snapshot(entry("1", "2026-09-24T18:30:00", "YOGA Flow", "[]", "")), now).text(true));
        assertEquals("two spaces, counted as My Bookings counts them", "Shoreditch \u00B7 2 spaces",
            plan(snapshot(entry("1", "2026-09-24T18:30:00", "YOGA Flow", "[]", ",\"spaces\":2")), now).text(false));

        String roomOnly = "{\"eventId\":\"1\",\"startAt\":\"2026-09-24T18:30:00\",\"typeName\":\"RIDE 45\",\"studioName\":\"Studio One\",\"slots\":[9]}";
        assertEquals("no building: the room, as the widget has it", "Studio One \u00B7 Bike 9", plan(snapshot(roomOnly), now).text(false));
        String seatOnly = "{\"eventId\":\"1\",\"startAt\":\"2026-09-24T18:30:00\",\"typeName\":\"RIDE 45\",\"slots\":[9]}";
        assertEquals("no place at all: the seat, and no dot", "Bike 9", plan(snapshot(seatOnly), now).text(false));
        String bare = "{\"eventId\":\"1\",\"startAt\":\"2026-09-24T18:30:00\"}";
        PsyncCountdownPlan nameless = plan(snapshot(bare), now);
        assertEquals("neither", "", nameless.text(false));
        assertEquals("...then the start alone", "18:30", nameless.text(true));
        assertEquals("a class with no name is a Class", "Class", nameless.title());
    }

    @Test
    public void withNothingToShowThereAreNoWords() {
        PsyncCountdownPlan none = PsyncCountdownPlan.none();
        assertFalse(none.shows());
        assertEquals("", none.title());
        assertEquals("", none.startLabel());
        assertEquals("", none.text(false));
        assertEquals("", none.text(true));
        assertEquals(0, none.colour());
        assertEquals(NONE, none.timeoutMillis(0L));
        assertEquals(NONE, none.nextWake);
    }

    @Test
    public void theAccentIsTheClassColourOrTheNeutralOne() {
        long now = at("2026-09-24T17:30:00");
        assertEquals("the ride's own base, light side", Integer.toHexString(0xFF2D5FD6),
            Integer.toHexString(plan(snapshot(ride("77", "2026-09-24T18:30:00")), now).colour()));
        assertEquals("no colours in the snapshot: the neutral Other", Integer.toHexString(0xFF57647B),
            Integer.toHexString(plan(snapshot(entry("77", "2026-09-24T18:30:00", "RIDE 45", "[9]", "")), now).colour()));
        String notColours = ",\"ctBase\":\"red\",\"ctTint\":\"#E9F0FF\",\"ctDeep\":\"#1A3785\"";
        assertEquals("a colour that is not #rrggbb: the neutral one, never a wrong one", Integer.toHexString(0xFF57647B),
            Integer.toHexString(plan(snapshot(entry("77", "2026-09-24T18:30:00", "RIDE 45", "[9]", notColours)), now).colour()));
    }

    // -- More than two, seconds, a moved class, a long list, the single key --------------------

    @Test
    public void threeClassesInsideOneWindowAreWalkedThroughOneByOne() {
        // The planner looks one class ahead. With three inside the window that is enough: the
        // list is soonest first, so the THIRD's window never opens before the second's.
        PsyncSnapshot snapshot = snapshot(ride("1", "2026-09-24T18:00:00"), ride("2", "2026-09-24T18:30:00"),
            ride("3", "2026-09-24T19:00:00"));
        long now = at("2026-09-24T17:45:00");
        List<String> seen = new ArrayList<String>();
        List<Long> wakes = new ArrayList<Long>();
        for (int guard = 0; guard < 10; guard++) {
            PsyncCountdownPlan plan = plan(snapshot, now);
            seen.add(String.valueOf(shownId(plan)));
            if (plan.nextWake == NONE) {
                break;
            }
            wakes.add(plan.nextWake);
            now = plan.nextWake;
        }
        List<String> expected = new ArrayList<String>();
        for (String id : new String[] {"1", "2", "3", "null"}) {
            expected.add(id);
        }
        assertEquals("each takes over at the start of the one before it", expected, seen);
        List<Long> starts = new ArrayList<Long>();
        starts.add(at("2026-09-24T18:00:00"));
        starts.add(at("2026-09-24T18:30:00"));
        starts.add(at("2026-09-24T19:00:00"));
        assertEquals("and the only wakes are the three starts: every window had opened already", starts, wakes);
    }

    @Test
    public void aStartWithSecondsIsCountedDownToTheSecondAndPrintedToTheMinute() {
        PsyncSnapshot snapshot = snapshot(ride("77", "2026-09-24T18:30:45"));
        long start = at("2026-09-24T18:30:45");
        assertEquals("45 seconds past the half hour", at("2026-09-24T18:30:00") + 45000L, start);

        assertNothing("17:00:44, a second outside", plan(snapshot, at("2026-09-24T17:00:44")));
        PsyncCountdownPlan edge = plan(snapshot, at("2026-09-24T17:00:45"));
        assertShows("17:00:45, the edge", "77", start, edge);
        assertEquals(LEAD, edge.timeoutMillis(at("2026-09-24T17:00:45")));
        assertEquals("the label is the widget's: hours and minutes", "18:30", edge.startLabel());
        assertShows("18:30:00 on the wall: 45 seconds to go", "77", start, plan(snapshot, at("2026-09-24T18:30:00")));
        assertEquals(45000L, plan(snapshot, at("2026-09-24T18:30:00")).timeoutMillis(at("2026-09-24T18:30:00")));
        assertNothing("18:30:45: started", plan(snapshot, start));
    }

    @Test
    public void aChangedBookingIsANewPlanAndNothingIsRememberedBetweenRuns() {
        long now = at("2026-09-24T17:30:00");
        PsyncSnapshot before = snapshot(ride("77", "2026-09-24T18:30:00"));
        PsyncSnapshot moved = snapshot(entry("77", "2026-09-24T18:45:00", "RIDE 45", "[12,14]", RIDE_SOFT));
        PsyncSnapshot further = snapshot(ride("77", "2026-09-24T20:00:00"));

        PsyncCountdownPlan first = plan(before, now);
        assertShows("as booked", "77", at("2026-09-24T18:30:00"), first);
        assertEquals("Shoreditch · Bike 9", first.text(false));

        PsyncCountdownPlan second = plan(moved, now);
        assertShows("the same class, moved by a quarter of an hour, with other seats", "77", at("2026-09-24T18:45:00"), second);
        assertEquals(at("2026-09-24T18:45:00"), second.nextWake);
        assertEquals(75 * MINUTE, second.timeoutMillis(now));
        assertEquals("Shoreditch · Bikes 12 & 14", second.text(false));
        assertFalse("a moved start is another countdown", first.key.equals(second.key));

        PsyncCountdownPlan third = plan(further, now);
        assertNothing("moved out of the window", third);
        assertEquals(at("2026-09-24T18:30:00"), third.nextWake);

        PsyncCountdownPlan again = plan(before, now);
        assertShows("and back: a plan is a function of what it is handed, nothing else", "77", at("2026-09-24T18:30:00"), again);
        assertEquals(first.key, again.key);
        assertEquals(first.nextWake, again.nextWake);
    }

    @Test
    public void aLongListWhoseFirstFiveHaveStartedStillReachesTheSixth() {
        // The bridge writes five. A longer list is still read (the reader scans fifty), what has
        // started is dropped FIRST, and only then are five kept.
        PsyncSnapshot snapshot = snapshot(ride("1", "2026-09-24T06:30:00"), ride("2", "2026-09-24T07:30:00"),
            ride("3", "2026-09-24T09:00:00"), ride("4", "2026-09-24T12:15:00"), ride("5", "2026-09-24T13:00:00"),
            ride("6", "2026-09-24T18:30:00"), ride("7", "2026-09-24T19:30:00"));
        long now = at("2026-09-24T17:30:00");
        PsyncCountdownPlan plan = plan(snapshot, now);
        assertShows("the sixth stored class is the next to come", "6", at("2026-09-24T18:30:00"), plan);
        assertEquals("the seventh's window opens at 18:00, before the sixth starts", at("2026-09-24T18:00:00"), plan.nextWake);
    }

    @Test
    public void theSingleKeyIsCountedDownToOnlyWhenTheListYieldsNoClass() {
        long now = at("2026-09-24T17:30:00");
        String next = ride("77", "2026-09-24T18:30:00");
        assertShows("widget_next_class alone (an older bridge, or a list that cannot be read)", "77",
            at("2026-09-24T18:30:00"), plan(PsyncSnapshot.parse(next, null, null), now));
        assertShows("beside an unreadable list", "77", at("2026-09-24T18:30:00"),
            plan(PsyncSnapshot.parse(next, "not json", "[]"), now));
        assertShows("beside an EMPTY list too: the list yields no class (the iPhone's rule)", "77",
            at("2026-09-24T18:30:00"), plan(PsyncSnapshot.parse(next, "[]", "[]"), now));
        PsyncCountdownPlan listed = plan(PsyncSnapshot.parse(next, "[" + ride("88", "2026-09-24T18:45:00") + "]", "[]"), now);
        assertShows("beside a list that names a class, the single key is not read at all", "88", at("2026-09-24T18:45:00"), listed);
        assertEquals("...so the class it names is not waited for either", at("2026-09-24T18:45:00"), listed.nextWake);
    }

    // -- Swiped away --------------------------------------------------------------------------

    @Test
    public void aKeyNamesTheClassAndItsStart() {
        long start = at("2026-09-24T18:30:00");
        assertEquals("77@" + start, PsyncCountdownPlan.keyFor("77", start));
        assertEquals("no id is still a key's shape, and matches nothing stored", "@" + start, PsyncCountdownPlan.keyFor(null, start));

        long now = at("2026-09-24T17:30:00");
        PsyncCountdownPlan showing = plan(snapshot(ride("77", "2026-09-24T18:30:00")), now);
        assertEquals("a plan that shows carries its key", "77@" + start, showing.key);
        assertTrue(PsyncCountdownPlan.isKey(showing.key));
        assertNull("too far out: no countdown, no key", plan(snapshot(ride("77", "2026-09-24T18:30:00")), at("2026-09-24T09:00:00")).key);
        assertNull(PsyncCountdownPlan.none().key);
        assertNull("switched off", PsyncCountdownPlan.of(snapshot(ride("77", "2026-09-24T18:30:00")), now, LONDON, false).key);

        String[] refused = {null, "", "@", "77", "77@", "@1790000000000", "77@soon", "77@-5", "77@1 ", "77@1.5", "77@1@", "77@ 1"};
        for (String key : refused) {
            assertFalse("not a key: " + key, PsyncCountdownPlan.isKey(key));
        }
        assertTrue(PsyncCountdownPlan.isKey("77@1790000000000"));
        assertTrue("an id may hold an @: the LAST one divides", PsyncCountdownPlan.isKey("a@b@1790000000000"));
        StringBuilder huge = new StringBuilder();
        for (int i = 0; i < PsyncCountdownPlan.MAX_KEY; i++) {
            huge.append('7');
        }
        assertFalse("overlong", PsyncCountdownPlan.isKey(huge + "@1"));
    }

    @Test
    public void aSwipedAwayCountdownStaysDownForThatClassAtThatStart() {
        PsyncSnapshot snapshot = snapshot(ride("77", "2026-09-24T18:30:00"));
        long start = at("2026-09-24T18:30:00");
        String swiped = PsyncCountdownPlan.keyFor("77", start);
        long[] later = {at("2026-09-24T17:30:00"), at("2026-09-24T17:31:00"), at("2026-09-24T18:00:00"), start - 1};
        for (long now : later) {
            PsyncCountdownPlan plan = PsyncCountdownPlan.of(snapshot, now, LONDON, true, swiped);
            assertNothing("swiped away: every later plan run leaves it down", plan);
            assertEquals("...it is still the countdown the plan is about, so the swipe is kept", swiped, plan.key);
            assertEquals("...and the start is still woken for", start, plan.nextWake);
            assertFalse("...nothing may be posted", plan.mayPost(true, true, true, now));
        }
        PsyncCountdownPlan started = PsyncCountdownPlan.of(snapshot, start, LONDON, true, swiped);
        assertNothing("at the start", started);
        assertNull("...the plan is about nothing now: the receiver forgets the swipe", started.key);
        assertEquals(NONE, started.nextWake);

        assertShows("no swipe recorded", "77", start, PsyncCountdownPlan.of(snapshot, later[0], LONDON, true, null));
        assertShows("a stray value is no swipe", "77", start, PsyncCountdownPlan.of(snapshot, later[0], LONDON, true, ""));
        assertShows("a swipe of ANOTHER class", "77", start,
            PsyncCountdownPlan.of(snapshot, later[0], LONDON, true, PsyncCountdownPlan.keyFor("78", start)));
    }

    @Test
    public void aMovedStartOrTheNextClassShowsAgainAfterASwipe() {
        long now = at("2026-09-24T17:30:00");
        long start = at("2026-09-24T18:30:00");
        String swiped = PsyncCountdownPlan.keyFor("77", start);

        PsyncSnapshot moved = snapshot(ride("77", "2026-09-24T18:45:00"));
        PsyncCountdownPlan again = PsyncCountdownPlan.of(moved, now, LONDON, true, swiped);
        assertShows("the class moved: a new countdown, which nobody dismissed", "77", at("2026-09-24T18:45:00"), again);
        assertFalse("...under a key of its own, so the receiver forgets the old swipe", swiped.equals(again.key));

        // Device-local by decision: the same wall clock in another zone is another instant.
        PsyncSnapshot same = snapshot(ride("77", "2026-09-24T18:30:00"));
        PsyncCountdownPlan abroad = PsyncCountdownPlan.of(same, at("2026-09-24T17:30:00", NEW_YORK), NEW_YORK, true, swiped);
        assertShows("the phone's zone changed: another start, so it shows", "77", at("2026-09-24T18:30:00", NEW_YORK), abroad);
    }

    @Test
    public void aSwipeStillHandsOverToTheClassAfterIt() {
        PsyncSnapshot snapshot = snapshot(ride("1", "2026-09-24T18:30:00"), ride("2", "2026-09-24T19:45:00"));
        long first = at("2026-09-24T18:30:00");
        long second = at("2026-09-24T19:45:00");
        String swiped = PsyncCountdownPlan.keyFor("1", first);

        PsyncCountdownPlan early = PsyncCountdownPlan.of(snapshot, at("2026-09-24T17:30:00"), LONDON, true, swiped);
        assertNothing("the first was swiped away", early);
        assertEquals("the wake is what it would have been: the second's window, 18:15", at("2026-09-24T18:15:00"), early.nextWake);

        PsyncCountdownPlan then = PsyncCountdownPlan.of(snapshot, at("2026-09-24T18:15:00"), LONDON, true, swiped);
        assertNothing("18:15: still the first's turn, still down - never a later class while an earlier one is to come", then);
        assertEquals(first, then.nextWake);

        PsyncCountdownPlan handOver = PsyncCountdownPlan.of(snapshot, first, LONDON, true, swiped);
        assertShows("at the first's start the second takes over: nobody dismissed THAT one", "2", second, handOver);
        assertEquals(PsyncCountdownPlan.keyFor("2", second), handOver.key);
        assertEquals(second, handOver.nextWake);
    }

    // -- Whether it may be posted -------------------------------------------------------------

    @Test
    public void itIsPostedOnlyWhenItShowsCanBePostedAndSomethingWillEndIt() {
        long now = at("2026-09-24T17:30:00");
        PsyncCountdownPlan showing = plan(snapshot(ride("77", "2026-09-24T18:30:00")), now);
        assertTrue(showing.shows());

        assertTrue("Android 8+: the system's timeout ends it, alarm or no alarm", showing.mayPost(false, true, true, now));
        assertTrue(showing.mayPost(true, true, true, now));
        assertTrue("below Android 8: only once the alarm for the start is armed", showing.mayPost(true, false, true, now));
        assertFalse("below Android 8 with no alarm: nothing would ever take it down", showing.mayPost(false, false, true, now));

        assertFalse("notifications refused: nothing, silently", showing.mayPost(true, true, false, now));
        assertFalse(showing.mayPost(true, false, false, now));

        assertFalse("asked at the start itself: no time left", showing.mayPost(true, true, true, showing.until));
        assertFalse("...or after it", showing.mayPost(true, true, true, showing.until + 1));
        assertFalse("a clock so far back that the time left overflows", showing.mayPost(true, true, true, Long.MIN_VALUE));
        assertTrue("the last millisecond", showing.mayPost(true, true, true, showing.until - 1));

        PsyncCountdownPlan[] nothing = {
            PsyncCountdownPlan.none(),
            plan(snapshot(ride("77", "2026-09-24T18:30:00")), at("2026-09-24T09:00:00")),
            PsyncCountdownPlan.of(snapshot(ride("77", "2026-09-24T18:30:00")), now, LONDON, false),
            plan(PsyncSnapshot.parse("null", "[]", "[]"), now),
        };
        for (PsyncCountdownPlan plan : nothing) {
            assertFalse("a plan that shows nothing is never posted, whatever the phone says", plan.mayPost(true, true, true, now));
        }
    }

    // -- The off switch, as it is stored ------------------------------------------------------

    @Test
    public void theStoreTakesOneMoreKeyAndOnlyOneOrNoughtUnderIt() {
        String key = PsyncSnapshot.KEY_COUNTDOWN_ENABLED;
        assertEquals("the name the bridge writes", "countdown_enabled", key);
        assertFalse("it is no part of the snapshot", PsyncSnapshot.isWidgetKey(key));
        assertTrue(PsyncSnapshot.isStoreKey(key));
        assertTrue(PsyncSnapshot.isStoreKey("widget_next_class"));
        assertTrue(PsyncSnapshot.isStoreKey("widget_upcoming"));
        assertTrue(PsyncSnapshot.isStoreKey("widget_week"));
        assertFalse(PsyncSnapshot.isStoreKey("psycle_bearer_token"));
        assertFalse(PsyncSnapshot.isStoreKey("psycle_class_reminders"));
        assertFalse(PsyncSnapshot.isStoreKey("countdown_enabled "));
        assertFalse(PsyncSnapshot.isStoreKey("Countdown_Enabled"));
        assertFalse(PsyncSnapshot.isStoreKey(""));
        assertFalse(PsyncSnapshot.isStoreKey(null));

        assertTrue(PsyncSnapshot.fitsKey(key, "1"));
        assertTrue(PsyncSnapshot.fitsKey(key, "0"));
        String[] refused = {null, "", " ", "true", "false", "on", "off", "2", "01", "10", " 1", "1 ", "1\n", "null", "\"1\"", "[]"};
        for (String value : refused) {
            assertFalse("not a value for the switch: " + value, PsyncSnapshot.fitsKey(key, value));
        }
        assertTrue("a snapshot key still takes any string that fits", PsyncSnapshot.fitsKey("widget_upcoming", "[]"));
        assertTrue(PsyncSnapshot.fitsKey("widget_next_class", "null"));
        assertFalse(PsyncSnapshot.fitsKey("widget_week", null));
        assertFalse("no other key takes anything", PsyncSnapshot.fitsKey("psycle_bearer_token", "1"));
        assertFalse(PsyncSnapshot.fitsKey(null, "1"));
    }

    @Test
    public void onlyOneSwitchesTheCountdownOnAndNeverWrittenIsOff() {
        // The countdown FOLLOWS the member's class-reminders preference, which only the page can
        // read. An app updated over a build that had no such key plans before the page has loaded
        // (the activity's start, a restart, the widget's update): it waits until it has been told.
        assertFalse("never written: not yet told, so not yet on", PsyncSnapshot.countdownEnabled(null));
        assertTrue(PsyncSnapshot.countdownEnabled("1"));
        assertFalse(PsyncSnapshot.countdownEnabled("0"));
        assertFalse("nothing but 1 is on", PsyncSnapshot.countdownEnabled(""));
        assertFalse(PsyncSnapshot.countdownEnabled("on"));
        assertFalse(PsyncSnapshot.countdownEnabled("true"));
        assertFalse(PsyncSnapshot.countdownEnabled(" 1"));
        assertFalse(PsyncSnapshot.countdownEnabled("01"));
    }
}
