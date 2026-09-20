package com.psyclefinder.app.widget;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

import org.junit.Test;

/**
 * PsyncSnapshot on the JVM (./gradlew testDebugUnitTest): the widget's reading of the snapshot
 * the bridge writes, with no phone and no emulator. org.json comes from the testImplementation
 * line in app/build.gradle - android.jar's copy is a stub outside a device.
 *
 * Every date here is fixed; 2026-09-24 is a Thursday. Names are the fake Psycle server's
 * (tests/tools/fake-psycle.js). PALETTE is js/theme.js's, value for value:
 * tests/suites/20-android-widget.js holds the table to the original.
 */
public class PsyncSnapshotTest {

    private static final TimeZone LONDON = TimeZone.getTimeZone("Europe/London");
    private static final TimeZone NEW_YORK = TimeZone.getTimeZone("America/New_York");

    /**
     * js/theme.js CLASS_COLOUR_PALETTE - every swatch a member can give a class type:
     * name, then light tintSoft, tintBold, base, deep, then the same four for dark.
     * Copied by hand; tests/suites/20-android-widget.js fails when the original moves.
     */
    // palette:start
    private static final String[][] PALETTE = {
        {"cobalt", "#E9F0FF", "#D6E2FF", "#2D5FD6", "#1A3785", "#1F2C4A", "#233560", "#3A6EE7", "#D6E2FF"},
        {"sky", "#E2F2FD", "#C7E6FC", "#0574B7", "#004271", "#1A2D44", "#193855", "#147ABE", "#C7E6FC"},
        {"teal", "#DEF3F9", "#BFE8F3", "#057890", "#004858", "#1A2E3E", "#1A394B", "#177F97", "#BFE8F3"},
        {"jade", "#E0F4EF", "#C4EBDF", "#0A7A64", "#064A3C", "#1B2F39", "#1C3A40", "#1D836D", "#C4EBDF"},
        {"moss", "#E6F3DC", "#D0E9B9", "#487C25", "#254A17", "#222F2F", "#283A2F", "#4E822C", "#D0E9B9"},
        {"sun", "#F7F0CB", "#F2E398", "#A26403", "#623800", "#2E2B2B", "#3F3326", "#A5670B", "#F2E398"},
        {"ember", "#FEEBE7", "#FFD8D0", "#CC3A1F", "#7A1E0C", "#35252F", "#4B292D", "#D34126", "#FFD8D0"},
        {"rose", "#FEEBEE", "#FFD9DE", "#C62C58", "#76162E", "#352537", "#4B283D", "#D33A62", "#FFD9DE"},
        {"orchid", "#FBEAF8", "#FAD6F2", "#B82A8E", "#6E1454", "#33253F", "#48284C", "#C83B9C", "#FAD6F2"},
        {"violet", "#F1EDFF", "#E6DCFF", "#7045D0", "#42238C", "#292949", "#36305F", "#825AE6", "#E6DCFF"},
        {"slate", "#ECF0F6", "#DBE2EE", "#57647B", "#313B4D", "#262D3D", "#2F3748", "#68758D", "#DBE2EE"},
    };
    // palette:end

    private static final String RIDE_SOFT =
        ",\"ct\":\"ride\",\"ctIntensity\":\"soft\""
        + ",\"ctBase\":\"#2D5FD6\",\"ctTint\":\"#E9F0FF\",\"ctDeep\":\"#1A3785\",\"ctWash\":\"#D6E2FF\""
        + ",\"ctBaseDark\":\"#3A6EE7\",\"ctTintDark\":\"#1F2C4A\",\"ctDeepDark\":\"#D6E2FF\",\"ctWashDark\":\"#233560\"";

    // -- Helpers ------------------------------------------------------------------------------

    /** A London wall clock as an instant. */
    private static long at(String wall) {
        long millis = PsyncSnapshot.wallMillis(wall, LONDON);
        assertTrue("a readable wall clock: " + wall, millis > 0);
        return millis;
    }

    /** One class as the bridge writes it; `more` is spliced in as further fields (",\"x\":1"). */
    private static String entry(String id, String startAt, String type, String slots, String more) {
        return "{\"eventId\":\"" + id + "\",\"startAt\":\"" + startAt + "\",\"instrName\":\"Alex Hart\""
            + ",\"typeName\":\"" + type + "\",\"studioName\":\"Studio One\",\"locName\":\"Shoreditch\""
            + ",\"slots\":" + slots + more + "}";
    }

    private static String list(String... entries) {
        StringBuilder out = new StringBuilder("[");
        for (int i = 0; i < entries.length; i++) {
            out.append(i == 0 ? "" : ",").append(entries[i]);
        }
        return out.append("]").toString();
    }

    /** The one class of a snapshot that holds a single upcoming class. */
    private static PsyncSnapshot.Entry only(String json, long now) {
        List<PsyncSnapshot.Entry> upcoming = PsyncSnapshot.parse(null, list(json), null).upcoming(now, LONDON);
        assertEquals("one class is read from " + json, 1, upcoming.size());
        return upcoming.get(0);
    }

    private static List<String> ids(List<PsyncSnapshot.Entry> entries) {
        List<String> out = new ArrayList<String>();
        for (PsyncSnapshot.Entry entry : entries) {
            out.add(entry.eventId);
        }
        return out;
    }

    private static List<String> listOf(String... values) {
        List<String> out = new ArrayList<String>();
        for (String value : values) {
            out.add(value);
        }
        return out;
    }

    private static void assertColour(String what, int expected, int actual) {
        assertEquals(what, Integer.toHexString(expected), Integer.toHexString(actual));
    }

    private static String repeat(char c, int times) {
        StringBuilder out = new StringBuilder(times);
        for (int i = 0; i < times; i++) {
            out.append(c);
        }
        return out.toString();
    }

    // -- Garbage in, nothing out --------------------------------------------------------------

    @Test
    public void whatCannotBeReadIsSimplyNotThere() {
        long now = at("2026-09-24T09:00:00");
        String[] garbage = {
            null, "", "   ", "null", "not json", "123", "true", "\"text\"", "[1,2,3]", "{\"a\":1}",
            "{", "[", "]", "[{\"eventId\":7}]", "[[[[[[[[[[[[[[1]]]]]]]]]]]]]]",
            "{\"eventId\":\"1\",\"startAt\":\"yesterday\",\"slots\":[]}",
            "[null,false,\"x\",{\"eventId\":null,\"startAt\":null}]",
        };
        for (String raw : garbage) {
            PsyncSnapshot snapshot = PsyncSnapshot.parse(raw, raw, raw);
            assertTrue("no class from: " + raw, snapshot.upcoming(now, LONDON).isEmpty());
            assertEquals("no week from: " + raw, 0, snapshot.weekCount(now, LONDON));
        }
        assertTrue(PsyncSnapshot.empty().upcoming(now, LONDON).isEmpty());
    }

    @Test
    public void aTenThousandElementArrayIsReadOnlyAtItsHead() {
        long now = at("2026-09-24T09:00:00");
        String real = entry("1", "2026-09-24T18:30:00", "RIDE 45", "[9]", "");
        StringBuilder padding = new StringBuilder();
        for (int i = 0; i < 10000; i++) {
            padding.append("0,");
        }
        String classLast = "[" + padding + real + "]";
        String classFirst = "[" + real + "," + padding + "0]";
        assertTrue("under the size cap, so it IS parsed", PsyncSnapshot.fitsStore(classLast));
        assertTrue("a class 10,000 elements in is past where the reader looks",
            PsyncSnapshot.parse(null, classLast, null).upcoming(now, LONDON).isEmpty());
        assertEquals("a class at the head is read, whatever follows",
            listOf("1"), ids(PsyncSnapshot.parse(null, classFirst, null).upcoming(now, LONDON)));
    }

    @Test
    public void aValueOverSixtyFourKilobytesIsNotRead() {
        long now = at("2026-09-24T09:00:00");
        String real = list(entry("1", "2026-09-24T18:30:00", "RIDE 45", "[9]", ""));
        assertEquals(1, PsyncSnapshot.parse(null, real, null).upcoming(now, LONDON).size());
        String padded = real + repeat(' ', PsyncSnapshot.MAX_VALUE_BYTES);
        assertTrue(PsyncSnapshot.parse(null, padded, null).upcoming(now, LONDON).isEmpty());
    }

    // -- What may be stored -------------------------------------------------------------------

    @Test
    public void onlyTheThreeWidgetKeysAndOnlySixtyFourKilobytes() {
        assertTrue(PsyncSnapshot.isWidgetKey("widget_next_class"));
        assertTrue(PsyncSnapshot.isWidgetKey("widget_upcoming"));
        assertTrue(PsyncSnapshot.isWidgetKey("widget_week"));
        assertFalse(PsyncSnapshot.isWidgetKey("psycle_bearer_token"));
        assertFalse(PsyncSnapshot.isWidgetKey("widget_next_class "));
        assertFalse(PsyncSnapshot.isWidgetKey(""));
        assertFalse(PsyncSnapshot.isWidgetKey(null));

        assertFalse(PsyncSnapshot.fitsStore(null));
        assertTrue(PsyncSnapshot.fitsStore(""));
        assertTrue(PsyncSnapshot.fitsStore(repeat('a', 64 * 1024)));
        assertFalse(PsyncSnapshot.fitsStore(repeat('a', 64 * 1024 + 1)));
        // Bytes, not characters: e-acute is two bytes of UTF-8.
        assertTrue(PsyncSnapshot.fitsStore(repeat('\u00E9', 30000)));
        assertFalse(PsyncSnapshot.fitsStore(repeat('\u00E9', 40000)));
    }

    // -- Which classes ------------------------------------------------------------------------

    @Test
    public void aClassThatHasStartedIsDropped() {
        String json = list(entry("1", "2026-09-24T18:30:00", "RIDE 45", "[9]", ""));
        long start = at("2026-09-24T18:30:00");
        assertEquals(1, PsyncSnapshot.parse(null, json, null).upcoming(start - 1, LONDON).size());
        assertTrue("at its start it has started", PsyncSnapshot.parse(null, json, null).upcoming(start, LONDON).isEmpty());
        assertTrue(PsyncSnapshot.parse(null, json, null).upcoming(start + 60000, LONDON).isEmpty());
    }

    @Test
    public void startAtIsAWallClockInTheZoneHandedIn() {
        String json = list(entry("1", "2026-09-24T18:30:00", "RIDE 45", "[9]", ""));
        // 20:00 in London is 15:00 in New York: 18:30 has passed in the one and not in the other.
        long now = at("2026-09-24T20:00:00");
        assertTrue(PsyncSnapshot.parse(null, json, null).upcoming(now, LONDON).isEmpty());
        assertEquals(1, PsyncSnapshot.parse(null, json, null).upcoming(now, NEW_YORK).size());
    }

    @Test
    public void classesAreDeDuplicatedByIdAndSortedByStart() {
        long now = at("2026-09-24T09:00:00");
        String json = list(
            entry("3", "2026-09-26T10:00:00", "YOGA Flow", "[7]", ""),
            entry("1", "2026-09-24T18:30:00", "RIDE 45", "[9]", ""),
            entry("2", "2026-09-25T07:30:00", "STRENGTH: Full Body", "[3]", ""),
            entry("1", "2026-09-27T09:00:00", "RIDE 45", "[12]", ""));
        List<PsyncSnapshot.Entry> upcoming = PsyncSnapshot.parse(null, json, null).upcoming(now, LONDON);
        assertEquals(listOf("1", "2", "3"), ids(upcoming));
        assertEquals("the first one read wins", "18:30", upcoming.get(0).timeLabel());
    }

    /**
     * The iPhone's rule (PsycleSnapshotStore.upcoming in PsycleSnapshot.swift): the single key
     * is read ONLY when the list yields no class. It is a copy from the last write; beside a
     * list that no longer names it, the class is one the member no longer holds.
     */
    @Test
    public void theNextClassAloneIsReadOnlyWhenTheListYieldsNothing() {
        long now = at("2026-09-24T09:00:00");
        String a = entry("1", "2026-09-24T18:30:00", "RIDE 45", "[9]", "");
        String b = entry("2", "2026-09-25T07:30:00", "STRENGTH: Full Body", "[3]", "");
        assertEquals("a list that lacks it wins: the iPhone shows B, and so does this", listOf("2"),
            ids(PsyncSnapshot.parse(a, list(b), null).upcoming(now, LONDON)));
        assertEquals("not twice", listOf("1", "2"), ids(PsyncSnapshot.parse(a, list(a, b), null).upcoming(now, LONDON)));
        assertEquals("a list that cannot be read", listOf("1"), ids(PsyncSnapshot.parse(a, "oops", null).upcoming(now, LONDON)));
        assertEquals("no list at all: a bridge that knew only the one key", listOf("1"), ids(PsyncSnapshot.parse(a, null, null).upcoming(now, LONDON)));
        assertEquals("an empty list", listOf("1"), ids(PsyncSnapshot.parse(a, "[]", null).upcoming(now, LONDON)));
        assertEquals("a list with nothing usable in it", listOf("1"), ids(PsyncSnapshot.parse(a, "[{\"eventId\":7}]", null).upcoming(now, LONDON)));
        String started = entry("3", "2026-09-24T07:00:00", "YOGA Flow", "[7]", "");
        assertTrue("a list whose one class has STARTED is still the list: the single key is not read",
            PsyncSnapshot.parse(a, list(started), null).upcoming(now, LONDON).isEmpty());
        assertEquals("the bridge's \"null\"", listOf("2"), ids(PsyncSnapshot.parse("null", list(b), null).upcoming(now, LONDON)));
        assertTrue("signed out: null, [] and []", PsyncSnapshot.parse("null", "[]", "[]").upcoming(now, LONDON).isEmpty());
    }

    @Test
    public void anIdWrittenAsANumberAndAsTextIsOneClass() {
        long now = at("2026-09-24T09:00:00");
        String asNumber = "{\"eventId\":7,\"startAt\":\"2026-09-24T18:30:00\",\"typeName\":\"RIDE 45\",\"slots\":[9]}";
        String asText = entry("7", "2026-09-25T07:30:00", "RIDE 45", "[12]", "");
        List<PsyncSnapshot.Entry> upcoming = PsyncSnapshot.parse(null, list(asNumber, asText), null).upcoming(now, LONDON);
        assertEquals(listOf("7"), ids(upcoming));
        assertEquals("the first one read wins", "18:30", upcoming.get(0).timeLabel());
    }

    @Test
    public void twoClassesAtTheSameMinuteKeepTheirStoredOrderAndLeaveTogether() {
        String json = list(
            entry("9", "2026-09-24T18:30:00", "RIDE 45", "[9]", ""),
            entry("4", "2026-09-24T18:30:00", "STRENGTH: Full Body", "[3]", ""),
            entry("2", "2026-09-24T07:00:00", "YOGA Flow", "[7]", ""));
        PsyncSnapshot snapshot = PsyncSnapshot.parse(null, json, null);
        assertEquals("as stored - 9 before 4 - after the earlier class", listOf("2", "9", "4"), ids(snapshot.upcoming(at("2026-09-24T06:00:00"), LONDON)));
        assertEquals(listOf("9", "4"), ids(snapshot.upcoming(at("2026-09-24T18:29:59"), LONDON)));
        assertTrue("both have started at 18:30", snapshot.upcoming(at("2026-09-24T18:30:00"), LONDON).isEmpty());
    }

    // -- When the widget paints itself again ----------------------------------------------------

    @Test
    public void theNextRepaintIsAMinuteAfterTheClassStartsOrJustAfterMidnight() {
        PsyncSnapshot friday = PsyncSnapshot.parse(null, list(entry("1", "2026-09-25T07:30:00", "RIDE 45", "[9]", "")), null);
        long lateThursday = at("2026-09-24T23:50:00");
        assertEquals("painted at 23:50 the card says Tomorrow", "Tomorrow", friday.upcoming(lateThursday, LONDON).get(0).dayWord(lateThursday, LONDON));
        assertEquals("so the next paint is midnight, NOT 07:31: by then the word is Today",
            at("2026-09-25T00:00:01"), friday.nextRepaintMillis(lateThursday, LONDON));
        long earlyFriday = at("2026-09-25T00:01:00");
        assertEquals("Today", friday.upcoming(earlyFriday, LONDON).get(0).dayWord(earlyFriday, LONDON));
        assertEquals("after midnight, the roll-over: a minute after the start",
            at("2026-09-25T07:31:00"), friday.nextRepaintMillis(earlyFriday, LONDON));

        PsyncSnapshot tonight = PsyncSnapshot.parse(null, list(entry("1", "2026-09-24T18:30:00", "RIDE 45", "[9]", "")), null);
        assertEquals("a class today comes before midnight", at("2026-09-24T18:31:00"), tonight.nextRepaintMillis(at("2026-09-24T09:00:00"), LONDON));
        assertEquals("a second before it starts", at("2026-09-24T18:31:00"), tonight.nextRepaintMillis(at("2026-09-24T18:29:59"), LONDON));

        PsyncSnapshot nextWeek = PsyncSnapshot.parse(null, list(entry("1", "2026-09-30T18:30:00", "RIDE 45", "[9]", "")), null);
        assertEquals("days away: still every midnight - \"Wed 30\" becomes Tomorrow at one of them",
            at("2026-09-25T00:00:01"), nextWeek.nextRepaintMillis(at("2026-09-24T09:00:00"), LONDON));
    }

    @Test
    public void thereIsNoNextRepaintWithNothingUpcoming() {
        long now = at("2026-09-24T09:00:00");
        assertEquals(-1L, PsyncSnapshot.empty().nextRepaintMillis(now, LONDON));
        assertEquals(-1L, PsyncSnapshot.parse("null", "[]", "[]").nextRepaintMillis(now, LONDON));
        String started = list(entry("1", "2026-09-24T07:00:00", "RIDE 45", "[9]", ""));
        assertEquals("every class has started", -1L, PsyncSnapshot.parse(null, started, null).nextRepaintMillis(now, LONDON));
    }

    @Test
    public void aSameMinutePairRollsOverOnce() {
        String json = list(
            entry("9", "2026-09-24T18:30:00", "RIDE 45", "[9]", ""),
            entry("4", "2026-09-24T18:30:00", "STRENGTH: Full Body", "[3]", ""),
            entry("5", "2026-09-24T20:00:00", "YOGA Flow", "[7]", ""));
        PsyncSnapshot snapshot = PsyncSnapshot.parse(null, json, null);
        assertEquals(at("2026-09-24T18:31:00"), snapshot.nextRepaintMillis(at("2026-09-24T18:00:00"), LONDON));
        // At 18:31 the alarm fires: both are gone together, and the alarm moves to the third.
        long fired = at("2026-09-24T18:31:00");
        assertEquals(listOf("5"), ids(snapshot.upcoming(fired, LONDON)));
        assertEquals(at("2026-09-24T20:01:00"), snapshot.nextRepaintMillis(fired, LONDON));
    }

    @Test
    public void theNextRepaintIsAlwaysLaterThanNow() {
        PsyncSnapshot snapshot = PsyncSnapshot.parse(null, list(
            entry("1", "2026-09-25T00:00:00", "RIDE 45", "[9]", ""),
            entry("2", "2026-09-25T07:30:00", "RIDE 45", "[9]", "")), null);
        String[] nows = {
            "2026-09-24T09:00:00", "2026-09-24T23:59:00", "2026-09-24T23:59:59", "2026-09-25T00:00:00",
            "2026-09-25T00:00:01", "2026-09-25T00:00:59", "2026-09-25T00:01:00", "2026-09-25T07:29:59",
        };
        TimeZone[] zones = {LONDON, NEW_YORK, TimeZone.getTimeZone("Pacific/Kiritimati"), TimeZone.getTimeZone("Pacific/Honolulu")};
        for (TimeZone zone : zones) {
            for (String wall : nows) {
                long now = PsyncSnapshot.wallMillis(wall, zone);
                long next = snapshot.nextRepaintMillis(now, zone);
                assertTrue(wall + " in " + zone.getID() + ": " + (next - now) + " ms ahead", next > now);
                assertTrue("and never more than a day and a second away", next - now <= 25L * 60L * 60L * 1000L + 1000L);
            }
        }
    }

    @Test
    public void atMostFiveClassesTheSoonest() {
        long now = at("2026-09-24T09:00:00");
        String json = list(
            entry("7", "2026-09-30T10:00:00", "RIDE 45", "[1]", ""),
            entry("6", "2026-09-29T10:00:00", "RIDE 45", "[1]", ""),
            entry("5", "2026-09-28T10:00:00", "RIDE 45", "[1]", ""),
            entry("4", "2026-09-27T10:00:00", "RIDE 45", "[1]", ""),
            entry("3", "2026-09-26T10:00:00", "RIDE 45", "[1]", ""),
            entry("2", "2026-09-25T10:00:00", "RIDE 45", "[1]", ""),
            entry("1", "2026-09-24T10:00:00", "RIDE 45", "[1]", ""));
        assertEquals(listOf("1", "2", "3", "4", "5"), ids(PsyncSnapshot.parse(null, json, null).upcoming(now, LONDON)));
    }

    @Test
    public void aStartThatIsNotAWallClockDropsTheClass() {
        long now = at("2026-01-01T09:00:00");
        String[] bad = {
            "2026-02-30T10:00:00", "2026-13-01T10:00:00", "2026-09-24T24:00:00", "2026-09-24T18:60:00",
            "2026-09-24T18:30:00Z", "2026-09-24T18:30:00+01:00", "24/09/2026 18:30", "1999-09-24T18:30:00", "",
        };
        for (String startAt : bad) {
            String json = list(entry("1", startAt, "RIDE 45", "[9]", ""));
            assertTrue("dropped: " + startAt, PsyncSnapshot.parse(null, json, null).upcoming(now, LONDON).isEmpty());
        }
        assertEquals("seconds are optional", "06:05", only(entry("1", "2026-09-25T06:05", "RIDE 45", "[9]", ""), now).timeLabel());
        assertEquals("the API's own space", "06:05", only(entry("1", "2026-09-25 06:05:00", "RIDE 45", "[9]", ""), now).timeLabel());
        assertEquals("a fraction is ignored", "18:30", only(entry("1", "2026-09-24T18:30:00.123", "RIDE 45", "[9]", ""), now).timeLabel());
        assertEquals("a leap day", "10:00", only(entry("1", "2028-02-29T10:00:00", "RIDE 45", "[9]", ""), now).timeLabel());
        assertEquals("an id written as a number", "77",
            only("{\"eventId\":77,\"startAt\":\"2026-09-25T06:05:00\",\"typeName\":\"RIDE 45\",\"slots\":[9]}", now).eventId);
    }

    // -- The words ----------------------------------------------------------------------------

    @Test
    public void theTimeIsTwentyFourHourAndZeroPadded() {
        long now = at("2026-09-24T05:00:00");
        assertEquals("06:05", only(entry("1", "2026-09-24T06:05:00", "RIDE 45", "[9]", ""), now).timeLabel());
        assertEquals("18:30", only(entry("1", "2026-09-24T18:30:00", "RIDE 45", "[9]", ""), now).timeLabel());
        assertEquals("00:10", only(entry("1", "2026-09-25T00:10:00", "RIDE 45", "[9]", ""), now).timeLabel());
    }

    @Test
    public void theDayWordIsTodayTomorrowOrTheWeekdayAndDate() {
        long thursdayMorning = at("2026-09-24T09:00:00");
        assertEquals("Today", only(entry("1", "2026-09-24T18:30:00", "RIDE 45", "[9]", ""), thursdayMorning).dayWord(thursdayMorning, LONDON));
        assertEquals("Tomorrow", only(entry("1", "2026-09-25T07:30:00", "RIDE 45", "[9]", ""), thursdayMorning).dayWord(thursdayMorning, LONDON));
        assertEquals("Sat 26", only(entry("1", "2026-09-26T10:00:00", "RIDE 45", "[9]", ""), thursdayMorning).dayWord(thursdayMorning, LONDON));
        assertEquals("Tomorrow 07:30", only(entry("1", "2026-09-25T07:30:00", "RIDE 45", "[9]", ""), thursdayMorning).whenLabel(thursdayMorning, LONDON));

        // Across midnight: twenty minutes away, and still tomorrow.
        long lateThursday = at("2026-09-24T23:50:00");
        assertEquals("Tomorrow", only(entry("1", "2026-09-25T00:10:00", "RIDE 45", "[9]", ""), lateThursday).dayWord(lateThursday, LONDON));

        // Across a month end, and a year end.
        long lastOfSeptember = at("2026-09-30T12:00:00");
        assertEquals("Tomorrow", only(entry("1", "2026-10-01T07:30:00", "RIDE 45", "[9]", ""), lastOfSeptember).dayWord(lastOfSeptember, LONDON));
        assertEquals("Fri 2", only(entry("1", "2026-10-02T07:30:00", "RIDE 45", "[9]", ""), lastOfSeptember).dayWord(lastOfSeptember, LONDON));
        long newYearsEve = at("2026-12-31T12:00:00");
        assertEquals("Tomorrow", only(entry("1", "2027-01-01T10:00:00", "RIDE 45", "[9]", ""), newYearsEve).dayWord(newYearsEve, LONDON));
    }

    /** The day words are the device's, whatever the device's zone - and the clocks changing moves nothing. */
    @Test
    public void theDayWordsHoldInEveryZoneAndOnTheDaysTheClocksChange() {
        String[] zones = {"Europe/London", "America/New_York", "Asia/Tokyo", "Pacific/Auckland", "Pacific/Kiritimati", "Pacific/Honolulu", "UTC"};
        // A day, the day after it, and the weekday-and-date of the day after that.
        String[][] days = {
            {"2026-03-28", "2026-03-29", "2026-03-30", "Mon 30"},   // the UK's clocks go forward on the 29th
            {"2026-03-29", "2026-03-30", "2026-03-31", "Tue 31"},
            {"2026-10-24", "2026-10-25", "2026-10-26", "Mon 26"},   // and back on the 25th
            {"2026-10-25", "2026-10-26", "2026-10-27", "Tue 27"},
            {"2026-12-31", "2027-01-01", "2027-01-02", "Sat 2"},
        };
        for (String id : zones) {
            TimeZone zone = TimeZone.getTimeZone(id);
            assertEquals("a zone this JVM knows", id, zone.getID());
            for (String[] day : days) {
                String json = list(
                    entry("1", day[1] + "T00:10:00", "RIDE 45", "[9]", ""),
                    entry("2", day[2] + "T07:30:00", "RIDE 45", "[9]", ""));
                PsyncSnapshot snapshot = PsyncSnapshot.parse(null, json, null);
                String where = " (" + id + ", " + day[0] + ")";

                long before = PsyncSnapshot.wallMillis(day[0] + "T23:59:30", zone);
                List<PsyncSnapshot.Entry> upcoming = snapshot.upcoming(before, zone);
                assertEquals(listOf("1", "2"), ids(upcoming));
                assertEquals("forty seconds away, and tomorrow" + where, "Tomorrow 00:10", upcoming.get(0).whenLabel(before, zone));
                assertEquals("the day after" + where, day[3], upcoming.get(1).dayWord(before, zone));
                assertEquals("repainted at midnight, before the 00:11 roll-over" + where,
                    PsyncSnapshot.wallMillis(day[1] + "T00:00:01", zone), snapshot.nextRepaintMillis(before, zone));

                long after = PsyncSnapshot.wallMillis(day[1] + "T00:00:30", zone);
                upcoming = snapshot.upcoming(after, zone);
                assertEquals("Today 00:10" + where, "Today 00:10", upcoming.get(0).whenLabel(after, zone));
                assertEquals("Tomorrow" + where, "Tomorrow", upcoming.get(1).dayWord(after, zone));
                assertEquals("then the roll-over" + where,
                    PsyncSnapshot.wallMillis(day[1] + "T00:11:00", zone), snapshot.nextRepaintMillis(after, zone));
            }
        }
    }

    /**
     * Nothing printed or parsed may follow the phone's language, digits, calendar or DEFAULT
     * zone: the iPhone widget was once empty on every phone set to a 12-hour clock
     * (agents/learnings.md G1). Turkish has a dotted capital I, the Arabic and Thai tags below
     * print other digits, and the Thai one counts its years from 543 BC.
     */
    @Test
    public void nothingFollowsThePhonesLocaleOrItsDefaultZone() {
        Locale locale = Locale.getDefault();
        TimeZone zone = TimeZone.getDefault();
        String[] tags = {"tr-TR", "ar-SA-u-nu-arab", "th-TH-u-ca-buddhist-nu-thai", "en-US"};
        try {
            for (String tag : tags) {
                Locale.setDefault(Locale.forLanguageTag(tag));
                TimeZone.setDefault(TimeZone.getTimeZone("Pacific/Kiritimati"));
                long now = at("2026-09-24T09:00:00");
                String week = "[{\"day\":\"2026-09-24\",\"count\":2},{\"day\":\"2026-09-26\",\"count\":1}]";
                PsyncSnapshot snapshot = PsyncSnapshot.parse(null, list(
                    entry("77", "2026-09-26T06:05:00", "ride 45", "[9,12]", ""),
                    entry("78", "2026-09-27T18:30:00", "lift & tread", "[3]", "")), week);
                List<PsyncSnapshot.Entry> upcoming = snapshot.upcoming(now, LONDON);
                String under = " under " + tag;
                assertEquals(listOf("77", "78"), ids(upcoming));
                PsyncSnapshot.Entry first = upcoming.get(0);
                assertEquals("the digits" + under, "06:05", first.timeLabel());
                assertEquals("the day word" + under, "Sat 26", first.dayWord(now, LONDON));
                assertEquals("a lower-case ride is still a ride" + under, "ride", first.classType);
                assertEquals("and its seats are bikes" + under, "Bikes 9 & 12", first.seatLabel());
                assertEquals("counted" + under, "2 bikes", first.seatBadge(7));
                assertEquals("Bench 3", upcoming.get(1).seatLabel());
                assertEquals("the instant is London's, not the default zone's" + under, at("2026-09-26T06:05:00"), first.startMillis(LONDON));
                assertEquals("the week" + under, 3, snapshot.weekCount(now, LONDON));
                assertEquals(at("2026-09-25T00:00:01"), snapshot.nextRepaintMillis(now, LONDON));
                assertEquals("psync://bookings?event=77", PsyncSnapshot.deepLink(first.eventId));
            }
        } finally {
            Locale.setDefault(locale);
            TimeZone.setDefault(zone);
        }
    }

    @Test
    public void theSeatIsNamedForTheClass() {
        long now = at("2026-09-24T09:00:00");
        String when = "2026-09-24T18:30:00";
        assertEquals("Bike 9", only(entry("1", when, "RIDE 45", "[9]", ""), now).seatLabel());
        assertEquals("Bikes 5 & 6", only(entry("1", when, "RIDE 45", "[5,6]", ""), now).seatLabel());
        assertEquals("Bench 3", only(entry("1", when, "STRENGTH: Full Body", "[3]", ""), now).seatLabel());
        assertEquals("Benches 3 & 4", only(entry("1", when, "STRENGTH: Full Body", "[3,4]", ""), now).seatLabel());
        assertEquals("Bed 4", only(entry("1", when, "REFORMER Pilates", "[4]", ""), now).seatLabel());
        assertEquals("Machine 2", only(entry("1", when, "LAGREE: Upper Body", "[2]", ""), now).seatLabel());
        assertEquals("Spot 7", only(entry("1", when, "YOGA Flow", "[7]", ""), now).seatLabel());
        assertEquals("Spots 7 & 8 & 9", only(entry("1", when, "BARRE", "[7,8,9]", ""), now).seatLabel());
        assertEquals("Beds 4 & 5", only(entry("1", when, "REFORMER Pilates", "[4,5]", ""), now).seatLabel());
        assertEquals("Beds 4 & 5", only(entry("1", when, "PILATES: Mat", "[4,5]", ""), now).seatLabel());
        assertEquals("Machines 2 & 3", only(entry("1", when, "MEGAFORMER 50", "[2,3]", ""), now).seatLabel());
        assertEquals("four, the most the app books at once", "Bikes 12 & 14 & 16 & 18", only(entry("1", when, "RIDE 45", "[12,14,16,18]", ""), now).seatLabel());
        assertEquals("a name in lower case", "Bike 9", only(entry("1", when, "ride 45", "[9]", ""), now).seatLabel());
        assertEquals("a treadmill class has benches", "Benches 1 & 2", only(entry("1", when, "TREAD & SHRED", "[1,2]", ""), now).seatLabel());
    }

    /** A badge with no room for every number COUNTS the seats: a number is never silently cut off the end. */
    @Test
    public void seatsTheBadgeHasNoRoomForAreCounted() {
        long now = at("2026-09-24T09:00:00");
        String when = "2026-09-24T18:30:00";
        PsyncSnapshot.Entry four = only(entry("1", when, "RIDE 45", "[12,14,16,18]", ""), now);
        assertEquals("room for all of it", "Bikes 12 & 14 & 16 & 18", four.seatBadge(23));
        assertEquals("one character short", "4 bikes", four.seatBadge(22));
        assertEquals("4 bikes", four.seatBadge(0));
        assertEquals("2 machines", only(entry("1", when, "LAGREE: Upper Body", "[12,14]", ""), now).seatBadge(11));
        assertEquals("Machines 12 & 14", only(entry("1", when, "LAGREE: Upper Body", "[12,14]", ""), now).seatBadge(16));
        assertEquals("3 benches", only(entry("1", when, "STRENGTH: Full Body", "[3,4,5]", ""), now).seatBadge(11));
        assertEquals("2 beds", only(entry("1", when, "REFORMER Pilates", "[10,11]", ""), now).seatBadge(7));
        assertEquals("2 spots", only(entry("1", when, "BARRE", "[10,11]", ""), now).seatBadge(7));
        assertEquals("ONE seat is never counted: its number is the point", "Machine 12", only(entry("1", when, "LAGREE: Upper Body", "[12]", ""), now).seatBadge(0));
        assertEquals("spaces are a count already", "2 spaces", only(entry("1", when, "YOGA Flow", "[]", ",\"spaces\":2"), now).seatBadge(0));
        assertNull("no badge stays no badge", only(entry("1", when, "YOGA Flow", "[]", ""), now).seatBadge(0));
    }

    @Test
    public void spacesAreCountedOnlyWhenThereIsMoreThanOne() {
        long now = at("2026-09-24T09:00:00");
        String when = "2026-09-24T18:30:00";
        assertNull("no seat numbers and no count: no badge", only(entry("1", when, "YOGA Flow", "[]", ""), now).seatLabel());
        assertEquals("2 spaces", only(entry("1", when, "YOGA Flow", "[]", ",\"spaces\":2"), now).seatLabel());
        assertNull("one space says nothing, as on the My Bookings card", only(entry("1", when, "YOGA Flow", "[]", ",\"spaces\":1"), now).seatLabel());
        assertNull("a count that is not a whole number", only(entry("1", when, "YOGA Flow", "[]", ",\"spaces\":\"2\""), now).seatLabel());
        assertEquals("seat numbers win", "Spot 7", only(entry("1", when, "YOGA Flow", "[7]", ",\"spaces\":2"), now).seatLabel());
    }

    @Test
    public void seatNumbersAreWholePositiveUniqueAndAtMostEight() {
        long now = at("2026-09-24T09:00:00");
        String when = "2026-09-24T18:30:00";
        assertEquals("Bike 12", only(entry("1", when, "RIDE 45", "[\"9\",0,-1,2.5,12,12,1000000000,null]", ""), now).seatLabel());
        assertEquals(PsyncSnapshot.MAX_SLOTS, only(entry("1", when, "RIDE 45", "[1,2,3,4,5,6,7,8,9,10,11,12]", ""), now).slots.size());
        assertTrue("slots that are not an array", only(entry("1", when, "RIDE 45", "\"9\"", ""), now).slots.isEmpty());
    }

    @Test
    public void stringsAreTrimmedCollapsedAndCapped() {
        long now = at("2026-09-24T09:00:00");
        String when = "2026-09-24T18:30:00";
        assertEquals(PsyncSnapshot.MAX_TEXT, only(entry("1", when, repeat('A', 500), "[9]", ""), now).title().length());
        assertEquals("RIDE 45", only(entry("1", when, "  RIDE \\n\\t 45  ", "[9]", ""), now).title());
        assertEquals("a class with no name", "Class",
            only("{\"eventId\":\"1\",\"startAt\":\"" + when + "\",\"slots\":[]}", now).title());
        assertEquals("a name that is not a string", "Class",
            only("{\"eventId\":\"1\",\"startAt\":\"" + when + "\",\"typeName\":45,\"slots\":[]}", now).title());
    }

    @Test
    public void whoAndWhere() {
        long now = at("2026-09-24T09:00:00");
        String head = "{\"eventId\":\"1\",\"startAt\":\"2026-09-24T18:30:00\",\"typeName\":\"RIDE 45\",\"slots\":[9]";
        assertEquals("Alex Hart \u00B7 Shoreditch",
            only(head + ",\"instrName\":\"Alex Hart\",\"studioName\":\"Studio One\",\"locName\":\"Shoreditch\"}", now).whoWhere());
        assertEquals("the room, when there is no building", "Alex Hart \u00B7 Studio One",
            only(head + ",\"instrName\":\"Alex Hart\",\"studioName\":\"Studio One\",\"locName\":\"\"}", now).whoWhere());
        assertEquals("Shoreditch", only(head + ",\"locName\":\"Shoreditch\"}", now).whoWhere());
        assertEquals("Alex Hart", only(head + ",\"instrName\":\"Alex Hart\"}", now).whoWhere());
        assertEquals("", only(head + "}", now).whoWhere());
    }

    @Test
    public void aLongNameIsShortenedToItsHeadForARow() {
        long now = at("2026-09-24T09:00:00");
        String when = "2026-09-24T18:30:00";
        assertEquals("REFORMER PILATES", only(entry("1", when, "REFORMER PILATES: SCULPT 50", "[4]", ""), now).shortTitle());
        assertEquals("RIDE 45", only(entry("1", when, "RIDE 45", "[9]", ""), now).shortTitle());
        assertEquals("eighteen characters stay whole", "STRENGTH: Full Bod", only(entry("1", when, "STRENGTH: Full Bod", "[3]", ""), now).shortTitle());
        assertEquals("no colon to cut at", "A VERY LONG CLASS NAME INDEED", only(entry("1", when, "A VERY LONG CLASS NAME INDEED", "[3]", ""), now).shortTitle());
    }

    @Test
    public void theClassTypeIsTheSnapshotsKeyElseWorkedOutFromTheName() {
        long now = at("2026-09-24T09:00:00");
        String when = "2026-09-24T18:30:00";
        assertEquals("ride", only(entry("1", when, "Anything", "[9]", ",\"ct\":\"ride\""), now).classType);
        assertEquals("ride", only(entry("1", when, "Anything", "[9]", ",\"ct\":\" RIDE \""), now).classType);
        assertEquals("a key this build does not know", "other", only(entry("1", when, "RIDE 45", "[9]", ",\"ct\":\"aqua\""), now).classType);
        assertEquals("ride", only(entry("1", when, "RIDE 45", "[9]", ""), now).classType);
        assertEquals("strength", only(entry("1", when, "STRENGTH: Full Body", "[9]", ",\"ct\":7"), now).classType);
        assertEquals("yoga", only(entry("1", when, "Yoga Flow", "[9]", ",\"ct\":\"\""), now).classType);
        assertEquals("hiit", only(entry("1", when, "HIIT 30", "[9]", ""), now).classType);
        assertEquals("barre", only(entry("1", when, "BARRE", "[9]", ""), now).classType);
        assertEquals("equipment wins over discipline", "lagree", only(entry("1", when, "LAGREE: Strength", "[9]", ""), now).classType);
        assertEquals("pilates", only(entry("1", when, "REFORMER: Strength", "[9]", ""), now).classType);
        assertEquals("other", only(entry("1", when, "Sound Bath", "[9]", ""), now).classType);
    }

    // -- The colours --------------------------------------------------------------------------

    @Test
    public void aClassWearsItsOwnColoursLightAndDark() {
        long now = at("2026-09-24T09:00:00");
        PsyncSnapshot.Entry ride = only(entry("1", "2026-09-24T18:30:00", "RIDE 45", "[9]", RIDE_SOFT), now);
        assertEquals("soft", ride.intensity);

        PsyncSnapshot.Look light = ride.look(false);
        assertColour("card", 0xFFE9F0FF, light.card);
        assertColour("ink on a pale ground", PsyncSnapshot.INK_ON_LIGHT, light.ink);
        assertColour("ink 2", PsyncSnapshot.INK_2_ON_LIGHT, light.ink2);
        assertColour("the hue line is deep (9.5:1 on the tint)", 0xFF1A3785, light.accent);
        assertColour("soft: the tile is the full tint", 0xFFD6E2FF, light.tileFill);
        assertColour("soft: under the deep mark", 0xFF1A3785, light.tileInk);
        assertColour("the seat badge is the class colour", 0xFF2D5FD6, light.chipFill);
        assertColour("white on it", PsyncSnapshot.WHITE, light.chipInk);

        PsyncSnapshot.Look dark = ride.look(true);
        assertColour("card", 0xFF1F2C4A, dark.card);
        assertColour("ink on a dark ground", PsyncSnapshot.INK_ON_DARK, dark.ink);
        assertColour("ink 2", PsyncSnapshot.INK_2_ON_DARK, dark.ink2);
        assertColour("accent", 0xFFD6E2FF, dark.accent);
        assertColour("tile", 0xFF233560, dark.tileFill);
        assertColour("mark", 0xFFD6E2FF, dark.tileInk);
        assertColour("badge", 0xFF3A6EE7, dark.chipFill);
    }

    @Test
    public void boldAndOffPutTheClassColourInTheTile() {
        long now = at("2026-09-24T09:00:00");
        String bold = RIDE_SOFT.replace("\"ctIntensity\":\"soft\"", "\"ctIntensity\":\"bold\"").replace("\"ctTint\":\"#E9F0FF\"", "\"ctTint\":\"#D6E2FF\"");
        PsyncSnapshot.Look look = only(entry("1", "2026-09-24T18:30:00", "RIDE 45", "[9]", bold), now).look(false);
        assertColour("card", 0xFFD6E2FF, look.card);
        assertColour("tile", 0xFF2D5FD6, look.tileFill);
        assertColour("white mark", PsyncSnapshot.WHITE, look.tileInk);

        String off = RIDE_SOFT.replace("\"ctIntensity\":\"soft\"", "\"ctIntensity\":\"off\"").replace("\"ctTint\":\"#E9F0FF\"", "\"ctTint\":\"#FCFDFE\"");
        look = only(entry("1", "2026-09-24T18:30:00", "RIDE 45", "[9]", off), now).look(false);
        assertColour("off: the neutral surface", PsyncSnapshot.SURFACE_LIGHT, look.card);
        assertColour("colour only in the tile", 0xFF2D5FD6, look.tileFill);
        assertColour("and the badge", 0xFF2D5FD6, look.chipFill);

        String noWash = RIDE_SOFT.replace(",\"ctWash\":\"#D6E2FF\"", "");
        look = only(entry("1", "2026-09-24T18:30:00", "RIDE 45", "[9]", noWash), now).look(false);
        assertColour("soft with no wash: the class colour", 0xFF2D5FD6, look.tileFill);
        assertColour("under white", PsyncSnapshot.WHITE, look.tileInk);

        String unknown = RIDE_SOFT.replace("\"ctIntensity\":\"soft\"", "\"ctIntensity\":\"loud\"");
        assertEquals("an intensity nobody wrote reads as soft", "soft", only(entry("1", "2026-09-24T18:30:00", "RIDE 45", "[9]", unknown), now).intensity);
    }

    @Test
    public void boldAndOffByNight() {
        long now = at("2026-09-24T09:00:00");
        String bold = RIDE_SOFT.replace("\"ctIntensity\":\"soft\"", "\"ctIntensity\":\"bold\"").replace("\"ctTintDark\":\"#1F2C4A\"", "\"ctTintDark\":\"#233560\"");
        PsyncSnapshot.Look look = only(entry("1", "2026-09-24T18:30:00", "RIDE 45", "[9]", bold), now).look(true);
        assertColour("bold by night: the full dark tint", 0xFF233560, look.card);
        assertColour("pale ink on it", PsyncSnapshot.INK_ON_DARK, look.ink);
        assertColour("the hue line", 0xFFD6E2FF, look.accent);
        assertColour("the class colour in the tile", 0xFF3A6EE7, look.tileFill);
        assertColour("under a white mark", PsyncSnapshot.WHITE, look.tileInk);

        String off = RIDE_SOFT.replace("\"ctIntensity\":\"soft\"", "\"ctIntensity\":\"off\"").replace("\"ctTintDark\":\"#1F2C4A\"", "\"ctTintDark\":\"#1B2130\"");
        look = only(entry("1", "2026-09-24T18:30:00", "RIDE 45", "[9]", off), now).look(true);
        assertColour("off by night: the neutral dark surface", PsyncSnapshot.SURFACE_DARK, look.card);
        assertColour("ink", PsyncSnapshot.INK_ON_DARK, look.ink);
        assertColour("ink 2", PsyncSnapshot.INK_2_ON_DARK, look.ink2);
        assertColour("colour only in the tile", 0xFF3A6EE7, look.tileFill);
        assertColour("and the badge", 0xFF3A6EE7, look.chipFill);
        assertColour("white on it", PsyncSnapshot.WHITE, look.chipInk);
    }

    /**
     * Every swatch a member can choose, at every intensity, by day and by night, written as the
     * bridge writes it (_snapClassColourFields): what is printed on the card must be READABLE.
     * A swatch changed in js/theme.js reaches this table through 20-android-widget.js, and a
     * pale deep or a light base then fails here rather than on somebody's home screen.
     */
    @Test
    public void everySwatchAtEveryIntensityIsReadableByDayAndByNight() {
        long now = at("2026-09-24T09:00:00");
        String[] intensities = {"off", "soft", "bold"};
        for (String[] swatch : PALETTE) {
            for (String intensity : intensities) {
                String fields = ",\"ct\":\"ride\",\"ctIntensity\":\"" + intensity + "\"";
                for (int night = 0; night < 2; night++) {
                    String suffix = night == 0 ? "" : "Dark";
                    fields += ",\"ctBase" + suffix + "\":\"" + swatch[3 + night * 4] + "\",\"ctTint" + suffix + "\":\"" + ground(swatch, intensity, night) + "\""
                        + ",\"ctDeep" + suffix + "\":\"" + swatch[4 + night * 4] + "\",\"ctWash" + suffix + "\":\"" + swatch[2 + night * 4] + "\"";
                }
                PsyncSnapshot.Entry entry = only(entry("1", "2026-09-24T18:30:00", "RIDE 45", "[9]", fields), now);
                for (int night = 0; night < 2; night++) {
                    PsyncSnapshot.Look look = entry.look(night == 1);
                    String what = swatch[0] + ", " + intensity + (night == 1 ? ", night" : ", day");
                    assertColour("the card is the snapshot's own ground: " + what,
                        PsyncSnapshot.colour(ground(swatch, intensity, night)).intValue(), look.card);
                    assertReadable("the time and the class name: " + what, 7.0, look.ink, look.card);
                    assertReadable("who, where and the rows: " + what, 4.5, look.ink2, look.card);
                    assertReadable("the day word: " + what, 4.5, look.accent, look.card);
                    assertReadable("the seat badge: " + what, 4.5, look.chipInk, look.chipFill);
                    assertReadable("the pictogram: " + what, 4.5, look.tileInk, look.tileFill);
                }
            }
        }
    }

    /** ctTint as the bridge writes it: the neutral surface at "off", else the pale or the full tint. */
    private static String ground(String[] swatch, String intensity, int night) {
        if ("off".equals(intensity)) {
            return night == 0 ? "#FCFDFE" : "#1B2130";
        }
        return swatch[("bold".equals(intensity) ? 2 : 1) + night * 4];
    }

    private static void assertReadable(String what, double floor, int ink, int ground) {
        double ratio = PsyncSnapshot.contrast(ink, ground);
        assertTrue(what + ": " + ratio + " to 1, under " + floor, ratio >= floor);
    }

    @Test
    public void aColourThatIsNotHashRrggbbMeansTheNeutralFallback() {
        long now = at("2026-09-24T09:00:00");
        String[] notColours = {"\"2D5FD6\"", "\"#FFF\"", "\"#GGGGGG\"", "\"#2D5FD6FF\"", "\"blue\"", "\"\"", "2973654", "null", "[]"};
        for (String bad : notColours) {
            String fields = RIDE_SOFT.replace("\"ctBase\":\"#2D5FD6\"", "\"ctBase\":" + bad);
            PsyncSnapshot.Entry entry = only(entry("1", "2026-09-24T18:30:00", "RIDE 45", "[9]", fields), now);
            PsyncSnapshot.Look light = entry.look(false);
            assertColour("neutral card for ctBase " + bad, PsyncSnapshot.SURFACE_LIGHT, light.card);
            assertColour("the Other colour in the tile", 0xFF57647B, light.tileFill);
            assertColour("under white", PsyncSnapshot.WHITE, light.tileInk);
            assertColour("and in the badge", 0xFF57647B, light.chipFill);
            assertColour("ink", PsyncSnapshot.INK_ON_LIGHT, light.ink);
            assertColour("accent", 0xFF313B4D, light.accent);
            // Each appearance is settled by itself: the dark fields are still good.
            assertColour("the dark side keeps its own colours", 0xFF1F2C4A, entry.look(true).card);
        }
        PsyncSnapshot.Look dark = only(entry("1", "2026-09-24T18:30:00", "RIDE 45", "[9]", ""), now).look(true);
        assertColour("no colour fields at all, by night", PsyncSnapshot.SURFACE_DARK, dark.card);
        assertColour("tile", 0xFF68758D, dark.tileFill);
        assertColour("ink", PsyncSnapshot.INK_ON_DARK, dark.ink);
        assertColour("accent", 0xFFDBE2EE, dark.accent);
    }

    @Test
    public void inkFollowsTheGroundAndTheHueLineNeedsThreeToOne() {
        long now = at("2026-09-24T09:00:00");
        // A mid grey ground (luminance 0.22: dark) under a deep that is nearly the same grey (1.25:1).
        String fields = ",\"ctBase\":\"#2D5FD6\",\"ctTint\":\"#808080\",\"ctDeep\":\"#707070\"";
        PsyncSnapshot.Look look = only(entry("1", "2026-09-24T18:30:00", "RIDE 45", "[9]", fields), now).look(false);
        assertColour("pale ink on a dark ground, even in the light appearance", PsyncSnapshot.INK_ON_DARK, look.ink);
        assertColour("a deep that does not read gives way to the ink", PsyncSnapshot.INK_ON_DARK, look.accent);
        assertTrue(PsyncSnapshot.contrast(0xFF000000, 0xFFFFFFFF) > 20.9);
        assertEquals(1.0, PsyncSnapshot.contrast(0xFF123456, 0xFF123456), 0.0001);
    }

    // -- The week -----------------------------------------------------------------------------

    @Test
    public void theWeekCountsFromTodayOn() {
        long now = at("2026-09-24T09:00:00");
        String week = "[{\"day\":\"2026-09-23\",\"count\":2,\"firstStart\":\"2026-09-23T07:00:00\"},"
            + "{\"day\":\"2026-09-24\",\"count\":1,\"firstStart\":\"2026-09-24T18:30:00\"},"
            + "{\"day\":\"2026-09-26\",\"count\":3,\"firstStart\":\"2026-09-26T10:00:00\"},"
            + "{\"day\":\"soon\",\"count\":4},{\"day\":\"2026-09-27\",\"count\":\"5\"},{\"day\":\"2026-09-28\",\"count\":-1},7]";
        assertEquals(4, PsyncSnapshot.parse(null, null, week).weekCount(now, LONDON));
        assertEquals(0, PsyncSnapshot.parse(null, null, "{\"day\":\"2026-09-24\",\"count\":1}").weekCount(now, LONDON));
    }

    // -- The tap ------------------------------------------------------------------------------

    @Test
    public void aTapCarriesOneToTwelveDigitsOrNothing() {
        assertEquals("12345", PsyncSnapshot.tapId("12345"));
        assertEquals("0", PsyncSnapshot.tapId("0"));
        assertEquals("123456789012", PsyncSnapshot.tapId("123456789012"));
        assertNull(PsyncSnapshot.tapId("1234567890123"));
        assertNull(PsyncSnapshot.tapId("12a"));
        assertNull(PsyncSnapshot.tapId(" 12"));
        assertNull(PsyncSnapshot.tapId("-1"));
        assertNull(PsyncSnapshot.tapId(""));
        assertNull(PsyncSnapshot.tapId(null));
        assertNull("digits of another script are not digits here", PsyncSnapshot.tapId("\uFF11\uFF12"));

        assertEquals("psync://bookings?event=42", PsyncSnapshot.deepLink("42"));
        assertEquals("psync://bookings", PsyncSnapshot.deepLink(null));
        assertEquals("psync://bookings", PsyncSnapshot.deepLink("42&x=1"));
        assertEquals("psync://bookings", PsyncSnapshot.deepLink("javascript:alert(1)"));
    }
}
