package com.psyclefinder.app.widget;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.os.Bundle;
import android.widget.RemoteViews;

import com.psyclefinder.app.countdown.PsyncCountdownReceiver;

import java.util.List;
import java.util.TimeZone;

/**
 * The home-screen widget "Next class": a classic App Widget (AppWidgetProvider + RemoteViews +
 * XML layouts; no Compose, no Glance, no new dependency). It shows the member's next booked
 * class from the snapshot the web layer writes (PsyncSnapshot, PsyncWidgetStore), in the look
 * of the iPhone widget (PsyncWidgetViews).
 *
 * EVERY callback does the same thing: re-read the stored snapshot, drop the classes that have
 * started (the device clock against startAt read as device-local - the owner's closed
 * decision, agents/decisions.md section 4), repaint ALL of this provider's widgets, and arm
 * the repaint alarm again. Nothing is taken from the intent that arrived, nothing is written,
 * and no request is sent. The receiver is NOT exported (AndroidManifest.xml says who reaches
 * it all the same: the system, and the app itself); taking nothing from an intent is kept
 * anyway, so that nothing depends on that attribute.
 *
 * What keeps it fresh:
 *   - WidgetCenterPlugin.reloadAllTimelines() - the bridge calls it after every snapshot write -
 *     sends ACTION_REFRESH here, as an explicit broadcast; MainActivity sends one at every
 *     cold start too (a store wiped under a force-stopped app writes nothing);
 *   - ONE inexact alarm (AlarmManager.setWindow, ten minutes: no exact-alarm permission) for
 *     the instant PsyncSnapshot.nextRepaintMillis names: a minute after the shown class
 *     starts, so the widget rolls on to the next class by itself - or just after midnight if
 *     that comes first, when "Tomorrow" has become "Today";
 *   - updatePeriodMillis, 30 minutes (res/xml/next_class_widget_info.xml), as the backstop -
 *     the only thing that notices a changed clock or time zone.
 *
 * That backstop serves the class countdown too (countdown/PsyncCountdownReceiver): onUpdate -
 * the system's own update, half-hourly, after a restart and after an app update - asks it to
 * plan again. The app's own ACTION_REFRESH does not: whoever sends that plans the countdown
 * itself (WidgetCenterPlugin, MainActivity).
 */
public class NextClassWidgetProvider extends AppWidgetProvider {

    /** Repaint now: sent by the app itself, and by the repaint alarm. Always explicit. */
    public static final String ACTION_REFRESH = "com.psyclefinder.app.widget.REFRESH";

    /** For scheduleRepaint: the alarm that is armed stays as it is. */
    private static final long KEEP_ALARM = Long.MIN_VALUE;
    /** For scheduleRepaint: no alarm - what PsyncSnapshot.nextRepaintMillis says with nothing upcoming. */
    private static final long NO_ALARM = -1L;
    /**
     * How late the repaint alarm may be delivered on a phone that is awake: ten minutes, the
     * shortest window Android 12+ honours for an alarm that is not exact (setWindow).
     */
    private static final long REPAINT_WINDOW_MILLIS = 10L * 60L * 1000L;

    /** Asks the provider to repaint every widget. Cheap and safe to call with none on screen. */
    public static void requestRefresh(Context context) {
        if (context == null) {
            return;
        }
        try {
            Context app = context.getApplicationContext();
            app.sendBroadcast(new Intent(app, NextClassWidgetProvider.class).setAction(ACTION_REFRESH));
        } catch (RuntimeException e) {
            // MainActivity calls this while it starts: a widget that stays as it is until the
            // next update is nothing beside an app that does not open.
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) {
            return;
        }
        if (ACTION_REFRESH.equals(intent.getAction())) {
            refreshAll(context);
            return;
        }
        try {
            // AppWidgetProvider sorts the system's broadcasts into the callbacks below. It reads
            // the intent's extras to do so, and an extra that cannot be unparcelled throws.
            super.onReceive(context, intent);
        } catch (RuntimeException e) {
            refreshAll(context);
        }
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        refreshAll(context);
        // The system's own update is the class countdown's backstop as well: the one caller
        // that comes round with nobody asking - and so notices a changed clock, a lost alarm.
        // It never throws, and it paints nothing here.
        PsyncCountdownReceiver.plan(context);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int appWidgetId, Bundle newOptions) {
        // Resized: the width decides the layout, the height what fits in it.
        refreshAll(context);
    }

    @Override
    public void onEnabled(Context context) {
        refreshAll(context);
    }

    @Override
    public void onDisabled(Context context) {
        // refreshAll cancels the alarm itself when no widget is left - and only then.
        refreshAll(context);
    }

    // -- Painting -----------------------------------------------------------------------------

    private static void refreshAll(Context context) {
        long repaintAt = KEEP_ALARM;
        try {
            AppWidgetManager manager = AppWidgetManager.getInstance(context);
            if (manager == null) {
                return;
            }
            int[] ids = manager.getAppWidgetIds(new ComponentName(context, NextClassWidgetProvider.class));
            if (ids == null || ids.length == 0) {
                repaintAt = NO_ALARM;
                return;
            }
            PsyncSnapshot snapshot = PsyncWidgetStore.read(context);
            long now = System.currentTimeMillis();
            TimeZone zone = TimeZone.getDefault();
            // Settled BEFORE anything is painted and armed in the finally below: a launcher
            // that refuses one paint must not cost the widget its next one.
            repaintAt = snapshot.nextRepaintMillis(now, zone);
            List<PsyncSnapshot.Entry> upcoming = snapshot.upcoming(now, zone);
            String shownId = upcoming.isEmpty() ? null : upcoming.get(0).eventId;
            boolean night = isNight(context);
            float fontScale = context.getResources().getConfiguration().fontScale;
            for (int id : ids) {
                manager.updateAppWidget(id, viewsFor(context, manager, id, snapshot, shownId, night, fontScale, now));
            }
        } catch (RuntimeException e) {
            // A widget that cannot be painted keeps what it shows; the next update tries again.
        } finally {
            scheduleRepaint(context, repaintAt);
        }
    }

    /**
     * One widget's views. The launcher reports a widget's size as two boxes - narrow and tall
     * (portrait) and wide and short (landscape) - and a RemoteViews can carry a layout for
     * each, so the widget is right in both without being asked again when the screen turns.
     */
    private static RemoteViews viewsFor(Context context, AppWidgetManager manager, int id, PsyncSnapshot snapshot,
                                        String shownId, boolean night, float fontScale, long now) {
        Bundle options = manager.getAppWidgetOptions(id);
        int minWidth = size(options, AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH);
        int maxWidth = size(options, AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH);
        int minHeight = size(options, AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT);
        int maxHeight = size(options, AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT);

        RemoteViews portrait = build(context, snapshot, PsyncWidgetPlan.forSize(minWidth, maxHeight, fontScale), shownId, night, now);
        if (maxWidth <= 0 || minHeight <= 0) {
            // A launcher that reports no landscape box: one layout for both.
            return portrait;
        }
        RemoteViews landscape = build(context, snapshot, PsyncWidgetPlan.forSize(maxWidth, minHeight, fontScale), shownId, night, now);
        return new RemoteViews(landscape, portrait);
    }

    private static RemoteViews build(Context context, PsyncSnapshot snapshot, PsyncWidgetPlan plan, String shownId,
                                     boolean night, long now) {
        RemoteViews views;
        try {
            views = PsyncWidgetViews.build(context, snapshot, plan, night, now);
        } catch (RuntimeException e) {
            views = PsyncWidgetViews.empty(context);
        }
        // The whole card is the tap target. (A landscape + portrait pair cannot take a click
        // once it is put together: each half gets its own.) The tap itself is PsyncTapIntent's:
        // an explicit, immutable intent for MainActivity with an untrusted id - the one the
        // class countdown's notification opens the app with too.
        views.setOnClickPendingIntent(PsyncWidgetViews.ROOT_ID,
            PsyncTapIntent.open(context, shownId, PsyncTapIntent.FROM_WIDGET));
        return views;
    }

    private static int size(Bundle options, String key) {
        return options == null ? 0 : options.getInt(key, 0);
    }

    private static boolean isNight(Context context) {
        int mode = context.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        return mode == Configuration.UI_MODE_NIGHT_YES;
    }

    // -- The repaint alarm --------------------------------------------------------------------

    private static PendingIntent repaint(Context context) {
        Intent refresh = new Intent(context, NextClassWidgetProvider.class).setAction(ACTION_REFRESH);
        return PendingIntent.getBroadcast(context, 0, refresh, PsyncTapIntent.immutableFlags());
    }

    /**
     * ONE alarm, replaced each time (the same PendingIntent), for the instant
     * PsyncSnapshot.nextRepaintMillis worked out - the roll-over to the next class, or the
     * midnight that turns "Tomorrow" into "Today"; NO_ALARM cancels it, KEEP_ALARM leaves it.
     * RTC, not RTC_WAKEUP: a widget nobody is looking at need not wake the phone - the alarm is
     * delivered when it next wakes. setWindow() with a ten-minute window is inexact and needs
     * no permission; the manifest asks for no exact-alarm access and must not start to. NOT
     * set(): the system chooses that window - three quarters of the wait, up to an hour from
     * Android 12 and more before - and a class that has started would sit on the card for it.
     *
     * Called from a finally, so it throws nothing itself: an alarm that cannot be armed
     * leaves updatePeriodMillis as the only clock.
     */
    private static void scheduleRepaint(Context context, long atMillis) {
        if (atMillis == KEEP_ALARM) {
            return;
        }
        try {
            AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (alarms == null) {
                return;
            }
            if (atMillis > 0) {
                alarms.setWindow(AlarmManager.RTC, atMillis, REPAINT_WINDOW_MILLIS, repaint(context));
            } else {
                alarms.cancel(repaint(context));
            }
        } catch (RuntimeException e) {
            // Nothing to do about it here.
        }
    }
}
