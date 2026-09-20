package com.psyclefinder.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.os.Bundle;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.RemoteViews;
import android.widget.TextView;

import com.psyclefinder.app.widget.PsyncSnapshot;
import com.psyclefinder.app.widget.PsyncWidgetPlan;
import com.psyclefinder.app.widget.PsyncWidgetViews;

import java.nio.charset.StandardCharsets;
import java.util.Calendar;
import java.util.GregorianCalendar;
import java.util.Locale;
import java.util.TimeZone;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * DEBUG BUILDS ONLY (app/src/debug: a release build has neither this class nor its manifest
 * entry). It draws the home-screen widget without a launcher: the SAME RemoteViews the
 * provider builds (PsyncWidgetViews.build), shown with RemoteViews.apply() in a frame the size
 * of a block of launcher cells, on a launcher-grey ground. CI's emulator job opens it in a few
 * states and keeps the screenshots; nobody can long-press a home screen there.
 *
 * It reads nothing the app stores, writes nothing, sends nothing and sets no click. Only adb
 * can start it: its manifest entry asks the caller for android.permission.DUMP, which the
 * shell holds and no app a member installs can. Every extra is a STRING (adb: -e name value),
 * and every one is optional:
 *
 *   sample           one (default) | two | four | spaces | long | bold | off | neutral - a
 *                    built-in snapshot of three classes that start after "now", whenever that
 *                    is ("two" and "four": that many seats in the first)
 *   snapshot         instead: the JSON of widget_upcoming (an array) or widget_next_class
 *   snapshot_base64  the same, base64 of its UTF-8 - JSON does not survive two shells
 *   empty            1 = nothing stored: the empty state
 *   size             compact (default) | wide
 *   night            1 | 0 (default: as the system is)
 *   now              'YYYY-MM-DDTHH:MM' read as the device's wall clock (default: the clock)
 *   width, height    the frame, in dp (default 156 x 172, or 328 x 172 when wide); a width
 *                    the screen has no room for is drawn at the room there is, and the
 *                    caption says so
 *
 * The font scale is the system's (adb shell settings put system font_scale 1.3), handed to the
 * plan as the provider hands it. A widget that cannot be drawn is said in the caption AND
 * logged as an error under the tag PsyncWidgetPreview, which CI's smoke looks for: a picture
 * holds one wrapped line of the cause, the log holds all of it.
 *
 * The sample names and places are the fake Psycle server's (tests/tools/fake-psycle.js), and
 * its colours are the app's defaults for those class types (js/theme.js) - sample data only.
 */
public class WidgetPreviewActivity extends Activity {

    /** The log tag of a widget that could not be drawn; .github/workflows/ci.yml greps for it. */
    private static final String TAG = "PsyncWidgetPreview";
    /** The page's padding before and after the frame, in dp. */
    private static final int PAGE_GAP_DP = 24;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(render(getIntent()));
    }

    private View render(Intent intent) {
        boolean wide = "wide".equals(extra(intent, "size"));
        PsyncWidgetPlan.Bucket bucket = wide ? PsyncWidgetPlan.Bucket.WIDE : PsyncWidgetPlan.Bucket.COMPACT;
        int uiMode = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        String nightExtra = extra(intent, "night");
        boolean night = nightExtra == null ? uiMode == Configuration.UI_MODE_NIGHT_YES : "1".equals(nightExtra);
        // The frame is never wider than the screen has room for: a frame that ran under the
        // page's padding would be a picture of a widget with both ends missing.
        int asked = number(extra(intent, "width"), wide ? 328 : 156);
        DisplayMetrics metrics = getResources().getDisplayMetrics();
        int room = Math.max(40, (int) Math.floor(metrics.widthPixels / metrics.density) - 2 * PAGE_GAP_DP);
        int width = Math.min(asked, room);
        int height = number(extra(intent, "height"), 172);
        float fontScale = getResources().getConfiguration().fontScale;

        TimeZone zone = TimeZone.getDefault();
        long now = PsyncSnapshot.wallMillis(extra(intent, "now"), zone);
        if (now < 0) {
            now = System.currentTimeMillis();
        }

        PsyncSnapshot snapshot;
        String what;
        if ("1".equals(extra(intent, "empty"))) {
            snapshot = PsyncSnapshot.empty();
            what = "empty";
        } else {
            String json = givenSnapshot(intent);
            what = json == null ? "sample" : "given snapshot";
            if (json == null) {
                json = sample(extra(intent, "sample"), now, zone);
            }
            // An array is read as widget_upcoming, a single object as widget_next_class.
            snapshot = PsyncSnapshot.parse(json, json, null);
        }

        // The night mode asked for, as a CONTEXT: from Android 12 the RemoteViews carries both
        // appearances and picks by the configuration of the context it is applied in; the
        // neutral colours are night-aware resources on every version.
        Configuration config = new Configuration(getResources().getConfiguration());
        config.uiMode = (config.uiMode & ~Configuration.UI_MODE_NIGHT_MASK)
            | (night ? Configuration.UI_MODE_NIGHT_YES : Configuration.UI_MODE_NIGHT_NO);
        Context themed = createConfigurationContext(config);

        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setGravity(Gravity.CENTER_HORIZONTAL);
        page.setBackgroundColor(night ? 0xFF2A2E36 : 0xFFB8BEC8);
        int gap = px(PAGE_GAP_DP);
        page.setPadding(gap, gap * 2, gap, gap);

        TextView caption = new TextView(this);
        caption.setTextColor(night ? 0xFFEEF1F5 : 0xFF1B2130);
        caption.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        caption.setPadding(0, 0, 0, gap);
        String label = "Widget preview (debug build only): " + what + ", " + (wide ? "wide" : "compact")
            + ", " + (night ? "night" : "day") + ", " + width + " x " + height + " dp"
            + (asked > room ? " (asked for " + asked + " dp wide: this screen has room for " + room + ")" : "")
            + (fontScale == 1f ? "" : ", font scale " + fontScale);

        FrameLayout frame = new FrameLayout(this);
        try {
            RemoteViews views = PsyncWidgetViews.build(themed, snapshot,
                PsyncWidgetPlan.forBucket(bucket, width, height, fontScale), night, now);
            View widget = views.apply(themed, frame);
            frame.addView(widget, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        } catch (RuntimeException e) {
            // Said on the page, so that the screenshot shows it - and logged, stack trace and
            // causes, because this is the nearest thing here to a launcher's "Problem loading
            // widget" and CI's log is the only place the cause can be read.
            Log.e(TAG, "Could not draw the widget", e);
            label = label + "\nCould not draw the widget: " + e;
        }
        caption.setText(label);

        page.addView(caption, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        page.addView(frame, new LinearLayout.LayoutParams(px(width), px(height)));
        return page;
    }

    // -- Extras -------------------------------------------------------------------------------

    private static String extra(Intent intent, String name) {
        try {
            return intent == null ? null : intent.getStringExtra(name);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static int number(String text, int fallback) {
        if (text == null) {
            return fallback;
        }
        try {
            int value = Integer.parseInt(text.trim());
            return value >= 40 && value <= 1000 ? value : fallback;
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static String givenSnapshot(Intent intent) {
        String encoded = extra(intent, "snapshot_base64");
        if (encoded != null) {
            try {
                return new String(Base64.decode(encoded, Base64.DEFAULT), StandardCharsets.UTF_8);
            } catch (IllegalArgumentException e) {
                return "";
            }
        }
        return extra(intent, "snapshot");
    }

    private int px(int dp) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, dp,
            getResources().getDisplayMetrics()));
    }

    // -- The built-in sample ------------------------------------------------------------------

    /** widget_upcoming for three classes after `now`: in 90 minutes, tomorrow 07:30, the day after 18:00. */
    private static String sample(String name, long now, TimeZone zone) {
        String which = name == null ? "one" : name;
        boolean colours = !"neutral".equals(which);
        String intensity = "bold".equals(which) ? "bold" : ("off".equals(which) ? "off" : "soft");
        try {
            JSONObject first;
            if ("spaces".equals(which)) {
                first = entry("9001", soon(now, zone, 90), "YOGA Flow", "Cam Reyes", "Main Room", "Clapham", new int[0]);
                first.put("spaces", 2);
                if (colours) {
                    paint(first, "yoga", intensity, "#E0F4EF", "#C4EBDF", "#0A7A64", "#064A3C", "#1B2F39", "#1C3A40", "#1D836D", "#C4EBDF");
                }
            } else if ("long".equals(which)) {
                first = entry("9001", soon(now, zone, 90), "REFORMER PILATES: SCULPT 50", "Cam Reyes", "Main Room", "Clapham", new int[] {4});
                if (colours) {
                    paint(first, "pilates", intensity, "#F1EDFF", "#E6DCFF", "#7045D0", "#42238C", "#292949", "#36305F", "#825AE6", "#E6DCFF");
                }
            } else {
                int[] seats = "four".equals(which) ? new int[] {12, 14, 16, 18}
                    : ("two".equals(which) ? new int[] {5, 6} : new int[] {9});
                first = entry("9001", soon(now, zone, 90), "RIDE 45", "Alex Hart", "Studio One", "Shoreditch", seats);
                if (colours) {
                    paint(first, "ride", intensity, "#E9F0FF", "#D6E2FF", "#2D5FD6", "#1A3785", "#1F2C4A", "#233560", "#3A6EE7", "#D6E2FF");
                }
            }
            JSONObject second = entry("9002", at(now, zone, 1, 7, 30), "STRENGTH: Full Body", "Bea Collins", "Ride Studio", "Oxford Circus", new int[] {3});
            JSONObject third = entry("9003", at(now, zone, 2, 18, 0), "REFORMER Pilates", "Cam Reyes", "Main Room", "Clapham", new int[] {4});
            if (colours) {
                paint(second, "strength", intensity, "#FEEBE7", "#FFD8D0", "#CC3A1F", "#7A1E0C", "#35252F", "#4B292D", "#D34126", "#FFD8D0");
                paint(third, "pilates", intensity, "#F1EDFF", "#E6DCFF", "#7045D0", "#42238C", "#292949", "#36305F", "#825AE6", "#E6DCFF");
            }
            return new JSONArray().put(first).put(second).put(third).toString();
        } catch (JSONException e) {
            return "[]";
        }
    }

    /** One class, in the shape the bridge writes (_snapshotEventFor in native-bridge.js). */
    private static JSONObject entry(String id, String startAt, String type, String instructor, String studio,
                                    String location, int[] seats) throws JSONException {
        JSONArray slots = new JSONArray();
        for (int seat : seats) {
            slots.put(seat);
        }
        return new JSONObject()
            .put("eventId", id)
            .put("startAt", startAt)
            .put("instrName", instructor)
            .put("typeName", type)
            .put("studioName", studio)
            .put("locName", location)
            .put("slots", slots);
    }

    /**
     * The colour fields, as _snapClassColourFields writes them: ctTint is the card's ground at
     * the intensity (the neutral surface at "off"), ctWash is always the full tint.
     */
    private static void paint(JSONObject entry, String ct, String intensity,
                              String soft, String bold, String base, String deep,
                              String softDark, String boldDark, String baseDark, String deepDark) throws JSONException {
        boolean off = "off".equals(intensity);
        boolean full = "bold".equals(intensity);
        entry.put("ct", ct)
            .put("ctIntensity", intensity)
            .put("ctBase", base)
            .put("ctTint", off ? "#FCFDFE" : (full ? bold : soft))
            .put("ctDeep", deep)
            .put("ctWash", bold)
            .put("ctBaseDark", baseDark)
            .put("ctTintDark", off ? "#1B2130" : (full ? boldDark : softDark))
            .put("ctDeepDark", deepDark)
            .put("ctWashDark", boldDark);
    }

    /** `minutes` after now, on the five minutes, as a wall clock in the zone. */
    private static String soon(long now, TimeZone zone, int minutes) {
        Calendar calendar = new GregorianCalendar(zone, Locale.ROOT);
        calendar.setTimeInMillis(now + minutes * 60000L);
        calendar.set(Calendar.MINUTE, (calendar.get(Calendar.MINUTE) / 5) * 5);
        return wall(calendar);
    }

    /** `days` after today, at hour:minute, as a wall clock in the zone. */
    private static String at(long now, TimeZone zone, int days, int hour, int minute) {
        Calendar calendar = new GregorianCalendar(zone, Locale.ROOT);
        calendar.setTimeInMillis(now);
        calendar.add(Calendar.DAY_OF_MONTH, days);
        calendar.set(Calendar.HOUR_OF_DAY, hour);
        calendar.set(Calendar.MINUTE, minute);
        return wall(calendar);
    }

    private static String wall(Calendar calendar) {
        return String.format(Locale.ROOT, "%04d-%02d-%02dT%02d:%02d:00",
            calendar.get(Calendar.YEAR), calendar.get(Calendar.MONTH) + 1, calendar.get(Calendar.DAY_OF_MONTH),
            calendar.get(Calendar.HOUR_OF_DAY), calendar.get(Calendar.MINUTE));
    }
}
