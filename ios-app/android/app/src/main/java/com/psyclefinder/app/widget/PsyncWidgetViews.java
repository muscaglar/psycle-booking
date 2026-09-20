package com.psyclefinder.app.widget;

import android.content.Context;
import android.os.Build;
import android.util.TypedValue;
import android.view.View;
import android.widget.RemoteViews;

import com.psyclefinder.app.R;

import java.util.List;
import java.util.TimeZone;

/**
 * Builds the widget's RemoteViews - and nothing else, so that the provider
 * (NextClassWidgetProvider) and the debug-only preview (WidgetPreviewActivity, app/src/debug)
 * draw exactly the same thing. It reads no storage, sets no click and arms no alarm.
 *
 * The look is the iPhone widget's (PsycleWidgetLayouts.swift): the TIME leads in the system's
 * condensed bold face, 24-hour; the card wears the class tint at the member's intensity; the
 * class type's pictogram sits in a tile; then the class name, "Instructor (middle dot) Place"
 * and the seat badge. Waitlist places never reach the snapshot, a class that has started is
 * dropped by PsyncSnapshot.upcoming, and with nothing left the card says "Nothing booked".
 *
 * COLOUR. A snapshot entry carries its own literal colours, light and dark, so nothing is
 * worked out here but which to use. A launcher re-applies a widget's last RemoteViews when the
 * system flips between light and dark WITHOUT asking the provider again, so from Android 12
 * both appearances are handed over and the launcher picks (RemoteViews.setColorInt); before
 * that only the appearance in force at paint time can be sent (`night`), and the card catches
 * up at the next repaint - half an hour at most.
 *
 * A launcher also RE-APPLIES a RemoteViews onto the views it already inflated when the layout
 * is unchanged, so every text, colour and visibility is set on every build - nothing may rely
 * on what the XML says.
 */
public final class PsyncWidgetViews {

    /** The root of every widget layout, and the tap target. */
    public static final int ROOT_ID = android.R.id.background;

    private PsyncWidgetViews() {}

    /**
     * The widget for a snapshot at a moment, laid out to a plan. `night` matters below
     * Android 12 only (see the class note). The zone startAt is read in is the DEVICE's: the
     * owner's closed decision (agents/decisions.md section 4).
     */
    public static RemoteViews build(Context context, PsyncSnapshot snapshot, PsyncWidgetPlan plan,
                                    boolean night, long nowMillis) {
        TimeZone zone = TimeZone.getDefault();
        List<PsyncSnapshot.Entry> upcoming = (snapshot == null ? PsyncSnapshot.empty() : snapshot).upcoming(nowMillis, zone);
        if (upcoming.isEmpty() || plan == null) {
            return empty(context);
        }
        PsyncSnapshot.Entry next = upcoming.get(0);
        boolean wide = plan.bucket == PsyncWidgetPlan.Bucket.WIDE;
        RemoteViews views = new RemoteViews(context.getPackageName(),
            wide ? R.layout.widget_next_class_wide : R.layout.widget_next_class_compact);

        PsyncSnapshot.Look light = next.look(false);
        PsyncSnapshot.Look dark = next.look(true);

        // The card, and room inside it.
        filter(views, R.id.widget_card, light.card, dark.card, night);
        int padding = px(context, plan.paddingDp);
        views.setViewPadding(R.id.widget_content, padding, padding, padding, padding);

        // When: the day word is the one hue line, the time is the hero.
        String day = next.dayWord(nowMillis, zone);
        views.setTextViewText(R.id.widget_day, day);
        ink(views, R.id.widget_day, light.accent, dark.accent, night);
        views.setTextViewText(R.id.widget_time, next.timeLabel());
        views.setTextViewTextSize(R.id.widget_time, TypedValue.COMPLEX_UNIT_DIP, plan.timeSizeDp);
        ink(views, R.id.widget_time, light.ink, dark.ink, night);

        // What: the pictogram tile and the class name.
        filter(views, R.id.widget_tile_fill, light.tileFill, dark.tileFill, night);
        views.setImageViewResource(R.id.widget_tile_mark, pictogram(next.classType));
        filter(views, R.id.widget_tile_mark, light.tileInk, dark.tileInk, night);
        // On ONE line a long name is printed as its head - "REFORMER PILATES", whole - where
        // the full name would end mid-word in an ellipsis: the last steps of the iPhone
        // layouts' ladders (shortTitle in PsycleWidgetLayouts.swift). A screen reader still
        // hears the full name, below.
        views.setTextViewText(R.id.widget_title, plan.titleLines <= 1 ? next.shortTitle() : next.title());
        views.setInt(R.id.widget_title, "setMaxLines", plan.titleLines);
        ink(views, R.id.widget_title, light.ink, dark.ink, night);

        // The seat: the member's own, in the class colour. No seat numbers and no count of
        // spaces -> no badge, rather than an empty pill. More seats than the badge has room
        // for are counted ("4 bikes") rather than cut; spoken, below, they are all named.
        String seat = next.seatLabel();
        String badge = next.seatBadge(plan.seatChars);
        views.setViewVisibility(R.id.widget_seat_group, badge == null ? View.GONE : View.VISIBLE);
        views.setTextViewText(R.id.widget_seat, badge == null ? "" : badge);
        filter(views, R.id.widget_seat_fill, light.chipFill, dark.chipFill, night);
        ink(views, R.id.widget_seat, light.chipInk, dark.chipInk, night);

        StringBuilder spoken = new StringBuilder(day).append(' ').append(next.timeLabel()).append(", ").append(next.title());

        if (wide) {
            String who = next.whoWhere();
            views.setViewVisibility(R.id.widget_who, who.isEmpty() ? View.GONE : View.VISIBLE);
            views.setTextViewText(R.id.widget_who, who);
            ink(views, R.id.widget_who, light.ink2, dark.ink2, night);
            if (!who.isEmpty()) {
                spoken.append(", ").append(who);
            }

            // The following classes, as many as the plan allows and the snapshot holds.
            int rows = Math.max(0, Math.min(plan.rows, Math.min(2, upcoming.size() - 1)));
            views.setViewVisibility(R.id.widget_rule, rows > 0 ? View.VISIBLE : View.GONE);
            filter(views, R.id.widget_rule, light.ink2, dark.ink2, night);
            row(views, R.id.widget_row_1, R.id.widget_row_1_when, R.id.widget_row_1_what,
                rows >= 1 ? upcoming.get(1) : null, light, dark, night, nowMillis, zone);
            row(views, R.id.widget_row_2, R.id.widget_row_2_when, R.id.widget_row_2_what,
                rows >= 2 ? upcoming.get(2) : null, light, dark, night, nowMillis, zone);
        }

        if (seat != null) {
            spoken.append(", ").append(seat);
        }
        views.setContentDescription(ROOT_ID, context.getString(R.string.widget_spoken_next, spoken.toString()));
        return views;
    }

    /** "Nothing booked": every colour is a night-aware resource named in the layout, nothing is set here. */
    public static RemoteViews empty(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_next_class_empty);
        views.setContentDescription(ROOT_ID, context.getString(R.string.widget_nothing_booked));
        return views;
    }

    private static void row(RemoteViews views, int rowId, int whenId, int whatId, PsyncSnapshot.Entry entry,
                            PsyncSnapshot.Look light, PsyncSnapshot.Look dark, boolean night,
                            long nowMillis, TimeZone zone) {
        views.setViewVisibility(rowId, entry == null ? View.GONE : View.VISIBLE);
        views.setTextViewText(whenId, entry == null ? "" : entry.whenLabel(nowMillis, zone));
        views.setTextViewText(whatId, entry == null ? "" : entry.shortTitle());
        // On the FIRST class's card, so in its inks.
        ink(views, whenId, light.ink, dark.ink, night);
        ink(views, whatId, light.ink2, dark.ink2, night);
    }

    /** The colour of a WHITE shape or mark in an ImageView (drawable/widget_card.xml says why). */
    private static void filter(RemoteViews views, int id, int light, int dark, boolean night) {
        colour(views, id, "setColorFilter", light, dark, night);
    }

    private static void ink(RemoteViews views, int id, int light, int dark, boolean night) {
        colour(views, id, "setTextColor", light, dark, night);
    }

    private static void colour(RemoteViews views, int id, String method, int light, int dark, boolean night) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            views.setColorInt(id, method, light, dark);
        } else {
            views.setInt(id, method, night ? dark : light);
        }
    }

    private static int px(Context context, int dp) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, dp,
            context.getResources().getDisplayMetrics()));
    }

    /** res/drawable/ic_ct_KEY.xml: the app's own marks (js/app.js CLASS_PICTOGRAMS). */
    private static int pictogram(String classType) {
        if ("ride".equals(classType)) {
            return R.drawable.ic_ct_ride;
        }
        if ("strength".equals(classType)) {
            return R.drawable.ic_ct_strength;
        }
        if ("yoga".equals(classType)) {
            return R.drawable.ic_ct_yoga;
        }
        if ("hiit".equals(classType)) {
            return R.drawable.ic_ct_hiit;
        }
        if ("pilates".equals(classType)) {
            return R.drawable.ic_ct_pilates;
        }
        if ("lagree".equals(classType)) {
            return R.drawable.ic_ct_lagree;
        }
        if ("barre".equals(classType)) {
            return R.drawable.ic_ct_barre;
        }
        return R.drawable.ic_ct_other;
    }
}
