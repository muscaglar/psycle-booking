package com.psyclefinder.app.widget;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Comparator;
import java.util.GregorianCalendar;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

/**
 * What the home-screen widget knows: the snapshot the web layer's bridge writes
 * (ios-app/www/native-bridge.js, updateWidgetSnapshot) as three JSON strings, read back
 * defensively and turned into the words and colours the widget prints.
 *
 * PURE ON PURPOSE: java.* and org.json only, no android.* import, so the JVM unit tests
 * (app/src/test) run the real code. It is the Android twin of the iPhone widget's
 * PsycleShared/PsycleSnapshot.swift and PsycleClassType.swift - the same rules, held here by
 * PsyncSnapshotTest:
 *
 *   - the time is printed in 24-hour digits, exactly as written ("18:30");
 *   - startAt is a ZONE-LESS wall clock, read in the zone the caller hands in. The provider
 *     hands in the DEVICE zone: the owner's closed decision (agents/decisions.md section 4) -
 *     do not "fix" it here;
 *   - a class that has started is never shown, and a waitlist place never reaches the
 *     snapshot at all (the bridge leaves it out);
 *   - nothing here throws, whatever the stored strings hold, and nothing unparsed is printed.
 */
public final class PsyncSnapshot {

    /** The three keys the bridge writes through the AppGroupPreferences plugin - and the only ones it may. */
    public static final String KEY_NEXT = "widget_next_class";
    public static final String KEY_UPCOMING = "widget_upcoming";
    public static final String KEY_WEEK = "widget_week";

    /** A stored value is at most 64 KB of UTF-8. The bridge writes five classes: a few KB. */
    public static final int MAX_VALUE_BYTES = 64 * 1024;
    /** Every printed string is trimmed and cut to this many characters. */
    public static final int MAX_TEXT = 120;
    /** Seats kept per class (the app books at most four at a time). */
    public static final int MAX_SLOTS = 8;
    /** Classes kept: what the bridge writes (WIDGET_UPCOMING_MAX in native-bridge.js). */
    public static final int MAX_UPCOMING = 5;
    /** How far into a stored array the reader looks; the rest is ignored unread. */
    static final int MAX_SCAN = 50;
    /** Deeper JSON than this is not handed to the parser at all (an entry is three levels deep). */
    static final int MAX_DEPTH = 6;
    /** Event ids are numeric; a tap carries one only when it is 1 to 12 digits. */
    static final int MAX_ID_DIGITS = 12;
    /** How long after a class starts the widget moves on to the next: the iPhone timeline's minute. */
    public static final long ROLL_OVER_AFTER_MS = 60L * 1000L;
    /** How long after local midnight the day words are printed again. */
    static final long AFTER_MIDNIGHT_MS = 1000L;

    private static final String[] WEEKDAYS = {"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"};

    // [0-9], not \d: Android's \d also matches digits of other scripts.
    private static final Pattern WALL_CLOCK = Pattern.compile(
        "^([0-9]{4})-([0-9]{2})-([0-9]{2})[T ]([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\\.[0-9]{1,9})?)?$");
    private static final Pattern HEX_COLOUR = Pattern.compile("^#([0-9a-fA-F]{6})$");
    private static final Pattern DAY_KEY = Pattern.compile("^[0-9]{4}-[0-9]{2}-[0-9]{2}$");

    // The app's chrome (css/theme.css: Cloud by day, Graphite by night) - the same six values as
    // PsycleChrome in PsycleClassType.swift and as res/values*/colors.xml (psync_widget_*).
    static final int SURFACE_LIGHT = 0xFFFCFDFE;
    static final int SURFACE_DARK = 0xFF1B2130;
    static final int INK_ON_LIGHT = 0xFF1B2130;
    static final int INK_2_ON_LIGHT = 0xFF3A4252;
    static final int INK_ON_DARK = 0xFFEEF1F5;
    static final int INK_2_ON_DARK = 0xFFB7BFCC;
    static final int WHITE = 0xFFFFFFFF;

    // The neutral fallback, for an entry whose colours are missing or are not colours: the
    // neutral surface, with the app's "Other" class colour (js/theme.js) in the tile and the
    // seat badge only.
    private static final Side NEUTRAL_LIGHT = new Side(SURFACE_LIGHT, null, 0xFF57647B, 0xFF313B4D);
    private static final Side NEUTRAL_DARK = new Side(SURFACE_DARK, null, 0xFF68758D, 0xFFDBE2EE);

    private final List<Entry> stored;
    private final List<WeekDay> week;

    private PsyncSnapshot(List<Entry> stored, List<WeekDay> week) {
        this.stored = stored;
        this.week = week;
    }

    /** Nothing stored: what a phone that never opened the app, or a signed-out one, has. */
    public static PsyncSnapshot empty() {
        return new PsyncSnapshot(new ArrayList<Entry>(), new ArrayList<WeekDay>());
    }

    /**
     * Reads the three stored strings. Any of them may be null, empty, "null", not JSON, the
     * wrong shape or absurdly long: what cannot be read is simply not there.
     */
    public static PsyncSnapshot parse(String nextJson, String upcomingJson, String weekJson) {
        List<Entry> entries = new ArrayList<Entry>();
        Set<String> seen = new HashSet<String>();

        Object list = parseJson(upcomingJson);
        if (list instanceof JSONArray) {
            JSONArray array = (JSONArray) list;
            int scan = Math.min(array.length(), MAX_SCAN);
            for (int i = 0; i < scan; i++) {
                addEntry(entries, seen, Entry.from(array.opt(i)));
            }
        }
        // widget_next_class is read ONLY when the list yields no class (a snapshot written by
        // a bridge that knew only the one key, or a list that could not be read) - the
        // iPhone's rule, PsycleSnapshotStore.upcoming(). It is never merged INTO a list: the
        // single key is a copy from the last write, and beside a newer list it could name a
        // class the member no longer holds.
        if (entries.isEmpty()) {
            addEntry(entries, seen, Entry.from(parseJson(nextJson)));
        }

        List<WeekDay> days = new ArrayList<WeekDay>();
        Object weekValue = parseJson(weekJson);
        if (weekValue instanceof JSONArray) {
            JSONArray array = (JSONArray) weekValue;
            int scan = Math.min(array.length(), MAX_SCAN);
            for (int i = 0; i < scan && days.size() < 14; i++) {
                WeekDay day = WeekDay.from(array.opt(i));
                if (day != null) {
                    days.add(day);
                }
            }
        }
        return new PsyncSnapshot(entries, days);
    }

    private static void addEntry(List<Entry> entries, Set<String> seen, Entry entry) {
        // De-duplicated by event id: the first one read wins.
        if (entry != null && seen.add(entry.eventId)) {
            entries.add(entry);
        }
    }

    /**
     * The classes that have NOT started at nowMillis, soonest first, at most MAX_UPCOMING.
     * startAt is read as a wall clock in the given zone.
     */
    public List<Entry> upcoming(long nowMillis, TimeZone zone) {
        final TimeZone tz = zone == null ? TimeZone.getDefault() : zone;
        List<Entry> out = new ArrayList<Entry>();
        for (Entry entry : stored) {
            if (entry.startMillis(tz) > nowMillis) {
                out.add(entry);
            }
        }
        // Collections.sort is stable: two classes at the same minute keep their stored order.
        Collections.sort(out, new Comparator<Entry>() {
            @Override
            public int compare(Entry a, Entry b) {
                long left = a.startMillis(tz);
                long right = b.startMillis(tz);
                return left < right ? -1 : (left > right ? 1 : 0);
            }
        });
        if (out.size() > MAX_UPCOMING) {
            return new ArrayList<Entry>(out.subList(0, MAX_UPCOMING));
        }
        return out;
    }

    /**
     * When the widget must next be painted WITHOUT the app asking, as an instant - or -1 with
     * nothing upcoming (the empty state holds no word that time can change). The sooner of:
     *
     *   - a minute after the next class starts, when the card moves on to the class after it;
     *   - a second after the next local midnight, when "Tomorrow" has become "Today" - on the
     *     card and in the wide layout's following rows. The iPhone widget prints a weekday
     *     there, which no midnight changes; these words are relative, so they need the tick.
     *
     * Always later than nowMillis. The provider arms its ONE alarm for it.
     */
    public long nextRepaintMillis(long nowMillis, TimeZone zone) {
        TimeZone tz = zone == null ? TimeZone.getDefault() : zone;
        List<Entry> next = upcoming(nowMillis, tz);
        if (next.isEmpty()) {
            return -1L;
        }
        Calendar midnight = new GregorianCalendar(tz, Locale.ROOT);
        midnight.setTimeInMillis(nowMillis);
        midnight.add(Calendar.DAY_OF_MONTH, 1);
        midnight.set(Calendar.HOUR_OF_DAY, 0);
        midnight.set(Calendar.MINUTE, 0);
        midnight.set(Calendar.SECOND, 0);
        midnight.set(Calendar.MILLISECOND, 0);
        long at = Math.min(next.get(0).startMillis(tz) + ROLL_OVER_AFTER_MS,
            midnight.getTimeInMillis() + AFTER_MIDNIGHT_MS);
        // Both are after now by construction; a calendar that ever said otherwise must not
        // arm an alarm in the past, which fires at once and would repaint in a loop.
        return Math.max(at, nowMillis + AFTER_MIDNIGHT_MS);
    }

    /**
     * Bookings in the stored week, counting only days from today on (today in the given zone).
     * Not printed by any layout yet; read so that all three keys are held to one standard.
     */
    public int weekCount(long nowMillis, TimeZone zone) {
        Calendar now = new GregorianCalendar(zone == null ? TimeZone.getDefault() : zone, Locale.ROOT);
        now.setTimeInMillis(nowMillis);
        String today = String.format(Locale.ROOT, "%04d-%02d-%02d",
            now.get(Calendar.YEAR), now.get(Calendar.MONTH) + 1, now.get(Calendar.DAY_OF_MONTH));
        int total = 0;
        for (WeekDay day : week) {
            if (day.day.compareTo(today) >= 0) {
                total += day.count;
            }
        }
        return total;
    }

    // -- What the plugin may store ------------------------------------------------------------

    /** True for the three keys the bridge writes through AppGroupPreferences, and nothing else. */
    public static boolean isWidgetKey(String key) {
        return KEY_NEXT.equals(key) || KEY_UPCOMING.equals(key) || KEY_WEEK.equals(key);
    }

    /** True when the value may be stored: a string of at most MAX_VALUE_BYTES of UTF-8. */
    public static boolean fitsStore(String value) {
        if (value == null) {
            return false;
        }
        // Every character is at least one byte, so this also bounds the allocation below.
        if (value.length() > MAX_VALUE_BYTES) {
            return false;
        }
        return value.getBytes(StandardCharsets.UTF_8).length <= MAX_VALUE_BYTES;
    }

    // -- The tap ------------------------------------------------------------------------------

    /**
     * The class id a widget tap may carry, or null. The activity that receives it is exported,
     * so ANY app can start it with an extra of its choosing: 1 to 12 ASCII digits, nothing else.
     */
    public static String tapId(String raw) {
        if (raw == null) {
            return null;
        }
        int length = raw.length();
        if (length < 1 || length > MAX_ID_DIGITS) {
            return null;
        }
        for (int i = 0; i < length; i++) {
            char c = raw.charAt(i);
            if (c < '0' || c > '9') {
                return null;
            }
        }
        return raw;
    }

    /**
     * The link the page is handed for a tap - the iPhone widget's own (PsycleWidget.swift):
     * psync://bookings?event=ID, or psync://bookings alone when there is no usable id, which
     * the bridge reads as "open My Bookings" (_parseWidgetLink).
     */
    public static String deepLink(String rawId) {
        String id = tapId(rawId);
        return id == null ? "psync://bookings" : "psync://bookings?event=" + id;
    }

    // -- One class ----------------------------------------------------------------------------

    /** One booked class, as the bridge's _snapshotEventFor writes it. */
    public static final class Entry {
        public final String eventId;
        public final String typeName;
        public final String instrName;
        public final String studioName;
        public final String locName;
        /** Seat numbers held; empty for a studio with no seat map. */
        public final List<Integer> slots;
        /**
         * Spaces held at a studio with no seat map, when the snapshot says (an optional
         * "spaces" count); 0 otherwise. The bridge writes none today - see seatLabel().
         */
        public final int spaces;
        /** ride strength yoga hiit pilates lagree barre other */
        public final String classType;
        /** off, soft or bold. */
        public final String intensity;

        private final int year;
        private final int month;
        private final int day;
        private final int hour;
        private final int minute;
        private final int second;
        private final Side light;
        private final Side dark;

        private Entry(String eventId, int[] when, String typeName, String instrName, String studioName,
                      String locName, List<Integer> slots, int spaces, String classType, String intensity,
                      Side light, Side dark) {
            this.eventId = eventId;
            this.year = when[0];
            this.month = when[1];
            this.day = when[2];
            this.hour = when[3];
            this.minute = when[4];
            this.second = when[5];
            this.typeName = typeName;
            this.instrName = instrName;
            this.studioName = studioName;
            this.locName = locName;
            this.slots = Collections.unmodifiableList(slots);
            this.spaces = spaces;
            this.classType = classType;
            this.intensity = intensity;
            this.light = light;
            this.dark = dark;
        }

        /** An entry from one parsed JSON value, or null when it is not a usable class. */
        static Entry from(Object value) {
            if (!(value instanceof JSONObject)) {
                return null;
            }
            JSONObject json = (JSONObject) value;
            String eventId = idText(json.opt("eventId"));
            int[] when = wallClock(json.opt("startAt"));
            if (eventId == null || when == null) {
                return null;
            }
            String typeName = text(json.opt("typeName"));
            if (typeName.isEmpty()) {
                typeName = "Class";
            }
            return new Entry(eventId, when, typeName,
                text(json.opt("instrName")), text(json.opt("studioName")), text(json.opt("locName")),
                slots(json.opt("slots")), wholeNumber(json.opt("spaces"), 1, 20),
                classType(json.opt("ct"), typeName), intensity(json.opt("ctIntensity")),
                Side.from(json, ""), Side.from(json, "Dark"));
        }

        /** The start as an instant: the stored wall clock, read in the given zone. */
        public long startMillis(TimeZone zone) {
            Calendar calendar = new GregorianCalendar(zone == null ? TimeZone.getDefault() : zone, Locale.ROOT);
            calendar.clear();
            calendar.set(year, month - 1, day, hour, minute, second);
            return calendar.getTimeInMillis();
        }

        /** "18:30" - the digits as written, 24-hour, whatever the phone's own clock setting. */
        public String timeLabel() {
            return String.format(Locale.ROOT, "%02d:%02d", hour, minute);
        }

        /** "Today", "Tomorrow", else "Thu 24" - against today in the given zone. */
        public String dayWord(long nowMillis, TimeZone zone) {
            Calendar now = new GregorianCalendar(zone == null ? TimeZone.getDefault() : zone, Locale.ROOT);
            now.setTimeInMillis(nowMillis);
            if (isDate(now)) {
                return "Today";
            }
            now.add(Calendar.DAY_OF_MONTH, 1);
            if (isDate(now)) {
                return "Tomorrow";
            }
            // The weekday of a calendar DATE has nothing to do with a zone: noon UTC of that date.
            Calendar date = new GregorianCalendar(TimeZone.getTimeZone("UTC"), Locale.ROOT);
            date.clear();
            date.set(year, month - 1, day, 12, 0, 0);
            return WEEKDAYS[date.get(Calendar.DAY_OF_WEEK) - 1] + " " + day;
        }

        /** "Tomorrow 07:30" - one of the wide widget's following rows. */
        public String whenLabel(long nowMillis, TimeZone zone) {
            return dayWord(nowMillis, zone) + " " + timeLabel();
        }

        private boolean isDate(Calendar calendar) {
            return calendar.get(Calendar.YEAR) == year
                && calendar.get(Calendar.MONTH) + 1 == month
                && calendar.get(Calendar.DAY_OF_MONTH) == day;
        }

        /** The class name. */
        public String title() {
            return typeName;
        }

        /**
         * A long name's head, for a one-line row: "REFORMER PILATES: SCULPT 50" -> "REFORMER
         * PILATES" (PsycleInlineAccessory.shortTitle in PsycleWidgetLayouts.swift).
         */
        public String shortTitle() {
            if (typeName.length() <= 18) {
                return typeName;
            }
            int colon = typeName.indexOf(':');
            if (colon <= 0) {
                return typeName;
            }
            String head = typeName.substring(0, colon).trim();
            return head.isEmpty() ? typeName : head;
        }

        /** The building, else the room - as every native "Instructor (middle dot) Studio" line has it. */
        public String place() {
            return locName.isEmpty() ? studioName : locName;
        }

        /** "Alex Hart (middle dot) Shoreditch"; either part may be missing, and then so is the dot. */
        public String whoWhere() {
            String where = place();
            if (instrName.isEmpty()) {
                return where;
            }
            return where.isEmpty() ? instrName : instrName + " \u00B7 " + where;
        }

        /**
         * "Bike 9", "Bikes 5 & 6", "Bench 3" - the noun by class name, as PsycleSlotLabel
         * (PsycleSnapshot.swift) picks it and as the app pluralises it (pluralizeSlotLabel in
         * js/app.js: Bench -> Benches). With no seat numbers: "2 spaces" when the snapshot
         * counts more than one space - the rule of the My Bookings card - else null, and the
         * badge is left out.
         */
        public String seatLabel() {
            if (slots.isEmpty()) {
                return spaces > 1 ? spaces + " spaces" : null;
            }
            String noun = slotNoun(typeName);
            if (slots.size() == 1) {
                return noun + " " + slots.get(0);
            }
            StringBuilder out = new StringBuilder(plural(noun));
            for (int i = 0; i < slots.size(); i++) {
                out.append(i == 0 ? " " : " & ").append(slots.get(i));
            }
            return out.toString();
        }

        /**
         * The seat badge's words for a badge with room for maxChars characters
         * (PsyncWidgetPlan.seatChars): seatLabel() when it fits, else the seats COUNTED -
         * "4 bikes", "2 machines" - so that a seat number is never silently cut off the end.
         * The iPhone chip scales its words down instead; RemoteViews has no such call.
         */
        public String seatBadge(int maxChars) {
            String full = seatLabel();
            if (full == null || slots.size() < 2 || full.length() <= maxChars) {
                return full;
            }
            return slots.size() + " " + plural(slotNoun(typeName)).toLowerCase(Locale.ROOT);
        }

        /** The inks and fills for one appearance: the entry's own colours, else the neutral fallback. */
        public Look look(boolean night) {
            Side side = night ? dark : light;
            if (side == null) {
                side = night ? NEUTRAL_DARK : NEUTRAL_LIGHT;
            }
            return Look.of(side, intensity);
        }
    }

    // -- Colours ------------------------------------------------------------------------------

    /** One appearance of a class's colours, as the snapshot carries them (ARGB ints). */
    static final class Side {
        final int tint;
        final Integer wash;
        final int base;
        final int deep;

        Side(int tint, Integer wash, int base, int deep) {
            this.tint = tint;
            this.wash = wash;
            this.base = base;
            this.deep = deep;
        }

        /**
         * All or nothing, as PsycleClassStyle.palette has it: base, tint AND deep must each be
         * #rrggbb, or the side is null and the neutral fallback is drawn. The wash is optional.
         */
        static Side from(JSONObject json, String suffix) {
            Integer base = colour(json.opt("ctBase" + suffix));
            Integer tint = colour(json.opt("ctTint" + suffix));
            Integer deep = colour(json.opt("ctDeep" + suffix));
            if (base == null || tint == null || deep == null) {
                return null;
            }
            return new Side(tint, colour(json.opt("ctWash" + suffix)), base, deep);
        }
    }

    /**
     * What a layout paints with, settled once - PsycleSurface.resolve in PsycleWidgetStyle.swift,
     * which follows css/crisp.css: copy on a tint is ink, ink 2 or the one hue line (deep), and
     * nothing else.
     */
    public static final class Look {
        /** The card's ground: the tint at the member's intensity (the neutral surface at "off"). */
        public final int card;
        public final int ink;
        public final int ink2;
        /** The one hue line: deep where it reads on the card (3:1), else the ink. */
        public final int accent;
        public final int tileFill;
        public final int tileInk;
        public final int chipFill;
        public final int chipInk;

        private Look(int card, int ink, int ink2, int accent, int tileFill, int tileInk, int chipFill, int chipInk) {
            this.card = card;
            this.ink = ink;
            this.ink2 = ink2;
            this.accent = accent;
            this.tileFill = tileFill;
            this.tileInk = tileInk;
            this.chipFill = chipFill;
            this.chipInk = chipInk;
        }

        static Look of(Side side, String intensity) {
            // Ink by the ground's own lightness, not by the appearance: copy contrasts with
            // whatever it is really on.
            boolean pale = luminance(side.tint) > 0.35;
            int ink = pale ? INK_ON_LIGHT : INK_ON_DARK;
            int ink2 = pale ? INK_2_ON_LIGHT : INK_2_ON_DARK;
            int accent = contrast(side.deep, side.tint) >= 3.0 ? side.deep : ink;
            // The tile, as css/crisp.css has it: "soft" = the full tint under the deep mark;
            // "off" and "bold" = the class colour under a white mark.
            boolean softTile = "soft".equals(intensity) && side.wash != null;
            int tileFill = softTile ? side.wash.intValue() : side.base;
            int tileInk = softTile ? side.deep : WHITE;
            return new Look(side.tint, ink, ink2, accent, tileFill, tileInk, side.base, WHITE);
        }
    }

    /** WCAG relative luminance of an ARGB int (the alpha is ignored). */
    static double luminance(int argb) {
        return 0.2126 * channel((argb >> 16) & 0xFF)
            + 0.7152 * channel((argb >> 8) & 0xFF)
            + 0.0722 * channel(argb & 0xFF);
    }

    private static double channel(int value) {
        double c = value / 255.0;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }

    /** WCAG contrast ratio, 1 to 21. */
    static double contrast(int a, int b) {
        double la = luminance(a);
        double lb = luminance(b);
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    }

    // -- One day of the week key --------------------------------------------------------------

    static final class WeekDay {
        final String day;
        final int count;

        private WeekDay(String day, int count) {
            this.day = day;
            this.count = count;
        }

        static WeekDay from(Object value) {
            if (!(value instanceof JSONObject)) {
                return null;
            }
            JSONObject json = (JSONObject) value;
            Object day = json.opt("day");
            int count = wholeNumber(json.opt("count"), 1, 99);
            if (!(day instanceof String) || count == 0) {
                return null;
            }
            String key = ((String) day).trim();
            return DAY_KEY.matcher(key).matches() ? new WeekDay(key, count) : null;
        }
    }

    // -- Reading values -----------------------------------------------------------------------

    /** The parsed JSON value, or null for anything that is not there or cannot be read. */
    private static Object parseJson(String raw) {
        if (raw == null || !fitsStore(raw)) {
            return null;
        }
        String trimmed = raw.trim();
        if (trimmed.isEmpty() || tooDeep(trimmed)) {
            return null;
        }
        try {
            Object value = new JSONTokener(trimmed).nextValue();
            return value == JSONObject.NULL ? null : value;
        } catch (JSONException e) {
            return null;
        } catch (RuntimeException e) {
            return null;
        } catch (StackOverflowError e) {
            return null;
        }
    }

    /** True when brackets nest deeper than MAX_DEPTH (the parser recurses once per level). */
    private static boolean tooDeep(String json) {
        int depth = 0;
        boolean inString = false;
        for (int i = 0; i < json.length(); i++) {
            char c = json.charAt(i);
            if (inString) {
                if (c == '\\') {
                    i++;
                } else if (c == '"') {
                    inString = false;
                }
            } else if (c == '"') {
                inString = true;
            } else if (c == '[' || c == '{') {
                depth++;
                if (depth > MAX_DEPTH) {
                    return true;
                }
            } else if (c == ']' || c == '}') {
                depth--;
            }
        }
        return false;
    }

    /** A printable string: whitespace runs collapsed, trimmed, cut to MAX_TEXT. "" for anything else. */
    static String text(Object value) {
        if (!(value instanceof String)) {
            return "";
        }
        String raw = (String) value;
        // Bound the work before anything walks the string.
        if (raw.length() > MAX_TEXT * 8) {
            raw = raw.substring(0, MAX_TEXT * 8);
        }
        StringBuilder out = new StringBuilder();
        boolean gap = false;
        for (int i = 0; i < raw.length(); i++) {
            char c = raw.charAt(i);
            if (c <= ' ' || c == '\u007F' || c == '\u00A0') {
                gap = out.length() > 0;
                continue;
            }
            if (gap) {
                out.append(' ');
                gap = false;
            }
            out.append(c);
        }
        if (out.length() > MAX_TEXT) {
            // Never half of a surrogate pair.
            int cut = Character.isHighSurrogate(out.charAt(MAX_TEXT - 1)) ? MAX_TEXT - 1 : MAX_TEXT;
            out.setLength(cut);
        }
        return out.toString().trim();
    }

    /** The event id as text: a non-empty string, or a whole number. null for anything else. */
    private static String idText(Object value) {
        if (value instanceof Number) {
            double number = ((Number) value).doubleValue();
            if (number >= 0 && number <= 9.0e15 && number == Math.rint(number)) {
                return String.valueOf((long) number);
            }
            return null;
        }
        String id = text(value);
        return id.isEmpty() ? null : id;
    }

    /**
     * 'YYYY-MM-DDTHH:MM[:SS]' read as a wall clock in the given zone, as a class's startAt is;
     * -1 when it cannot be read. For the debug preview's "now", and for tests.
     */
    public static long wallMillis(String wall, TimeZone zone) {
        int[] when = wallClock(wall);
        if (when == null) {
            return -1L;
        }
        Calendar calendar = new GregorianCalendar(zone == null ? TimeZone.getDefault() : zone, Locale.ROOT);
        calendar.clear();
        calendar.set(when[0], when[1] - 1, when[2], when[3], when[4], when[5]);
        return calendar.getTimeInMillis();
    }

    /** { year, month, day, hour, minute, second } of 'YYYY-MM-DDTHH:MM[:SS]', or null. */
    static int[] wallClock(Object value) {
        if (!(value instanceof String)) {
            return null;
        }
        String raw = ((String) value).trim();
        if (raw.length() > 40) {
            return null;
        }
        Matcher m = WALL_CLOCK.matcher(raw);
        if (!m.matches()) {
            return null;
        }
        int year = Integer.parseInt(m.group(1));
        int month = Integer.parseInt(m.group(2));
        int day = Integer.parseInt(m.group(3));
        int hour = Integer.parseInt(m.group(4));
        int minute = Integer.parseInt(m.group(5));
        int second = m.group(6) == null ? 0 : Integer.parseInt(m.group(6));
        if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > daysIn(year, month)
            || hour > 23 || minute > 59 || second > 59) {
            return null;
        }
        return new int[] {year, month, day, hour, minute, second};
    }

    private static int daysIn(int year, int month) {
        if (month == 2) {
            boolean leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
            return leap ? 29 : 28;
        }
        return (month == 4 || month == 6 || month == 9 || month == 11) ? 30 : 31;
    }

    /** Seat numbers: whole numbers from 1 to 9999, no repeats, at most MAX_SLOTS. */
    private static List<Integer> slots(Object value) {
        List<Integer> out = new ArrayList<Integer>();
        if (!(value instanceof JSONArray)) {
            return out;
        }
        JSONArray array = (JSONArray) value;
        int scan = Math.min(array.length(), MAX_SCAN);
        for (int i = 0; i < scan && out.size() < MAX_SLOTS; i++) {
            int slot = wholeNumber(array.opt(i), 1, 9999);
            if (slot != 0 && !out.contains(Integer.valueOf(slot))) {
                out.add(Integer.valueOf(slot));
            }
        }
        return out;
    }

    /** A JSON whole number within [min, max], else 0. A numeric STRING is not a number. */
    static int wholeNumber(Object value, int min, int max) {
        if (!(value instanceof Number)) {
            return 0;
        }
        double number = ((Number) value).doubleValue();
        if (number != Math.rint(number) || number < min || number > max) {
            return 0;
        }
        return (int) number;
    }

    /** '#rrggbb' -> an opaque ARGB int; anything else -> null, never a wrong colour. */
    static Integer colour(Object value) {
        if (!(value instanceof String)) {
            return null;
        }
        Matcher m = HEX_COLOUR.matcher(((String) value).trim());
        if (!m.matches()) {
            return null;
        }
        return Integer.valueOf(0xFF000000 | Integer.parseInt(m.group(1), 16));
    }

    private static String intensity(Object value) {
        if (value instanceof String) {
            String level = ((String) value).trim().toLowerCase(Locale.ROOT);
            if ("off".equals(level) || "soft".equals(level) || "bold".equals(level)) {
                return level;
            }
        }
        return "soft";
    }

    /**
     * The snapshot's own key when it has one (a key this build does not know -> "other"), else
     * worked out from the class name the way the app does (getCategory in js/app.js).
     */
    static String classType(Object ct, String typeName) {
        if (ct instanceof String) {
            String key = ((String) ct).trim().toLowerCase(Locale.ROOT);
            if (!key.isEmpty()) {
                return isClassType(key) ? key : "other";
            }
        }
        // Locale.ROOT: under a Turkish locale "ride".toUpperCase() is not "RIDE".
        String name = typeName.toUpperCase(Locale.ROOT);
        if (name.contains("LAGREE") || name.contains("MEGAFORMER")) {
            return "lagree";
        }
        if (name.contains("REFORMER")) {
            return "pilates";
        }
        if (name.contains("RIDE")) {
            return "ride";
        }
        if (name.contains("STRENGTH") || name.contains("LIFT") || name.contains("WEIGHTS") || name.contains("TREAD")) {
            return "strength";
        }
        if (name.contains("YOGA") || name.contains("FLOW") || name.contains("RESTORE") || name.contains("MEDITATION")) {
            return "yoga";
        }
        if (name.contains("HIIT") || name.contains("CIRCUIT") || name.contains("INTERVAL")) {
            return "hiit";
        }
        if (name.contains("PILATES")) {
            return "pilates";
        }
        if (name.contains("BARRE")) {
            return "barre";
        }
        return "other";
    }

    private static boolean isClassType(String key) {
        return "ride".equals(key) || "strength".equals(key) || "yoga".equals(key) || "hiit".equals(key)
            || "pilates".equals(key) || "lagree".equals(key) || "barre".equals(key) || "other".equals(key);
    }

    /** Bench -> Benches, else an s: pluralizeSlotLabel in js/app.js. */
    static String plural(String noun) {
        return "Bench".equals(noun) ? "Benches" : noun + "s";
    }

    /** Machine, Bed, Bike, Bench or Spot - PsycleSlotLabel in PsycleSnapshot.swift, line for line. */
    static String slotNoun(String typeName) {
        String name = typeName.toUpperCase(Locale.ROOT);
        if (name.contains("LAGREE") || name.contains("MEGAFORMER")) {
            return "Machine";
        }
        if (name.contains("REFORMER")) {
            return "Bed";
        }
        if (name.contains("RIDE")) {
            return "Bike";
        }
        if (name.contains("PILATES")) {
            return "Bed";
        }
        if (name.contains("STRENGTH") || name.contains("LIFT") || name.contains("WEIGHTS") || name.contains("TREAD")) {
            return "Bench";
        }
        return "Spot";
    }
}
