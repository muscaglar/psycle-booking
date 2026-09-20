package com.psyclefinder.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

import com.psyclefinder.app.countdown.PsyncCountdownNotifier;
import com.psyclefinder.app.countdown.PsyncCountdownPlan;
import com.psyclefinder.app.countdown.PsyncCountdownReceiver;
import com.psyclefinder.app.widget.NextClassWidgetProvider;
import com.psyclefinder.app.widget.PsyncSnapshot;
import com.psyclefinder.app.widget.PsyncWidgetStore;

import java.util.Calendar;
import java.util.GregorianCalendar;
import java.util.Locale;
import java.util.TimeZone;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * DEBUG BUILDS ONLY (app/src/debug: a release build has neither this class nor its manifest
 * entry). It is how the class countdown is proved with no phone and nobody signed in: it puts
 * ONE sample class into the widget store, a chosen number of minutes ahead, and runs the real
 * planner - PsyncCountdownReceiver.plan - so that CI's emulator job can read the notification
 * the app really posted (`dumpsys notification --noredact`), photograph the shade, and then
 * prove that a class which has started takes it down again.
 *
 * A RECEIVER, not an activity like WidgetPreviewActivity: `am start -S` force-stops the app
 * first, and a force-stop removes the app's notifications by itself - "it went away" would
 * prove nothing. A broadcast leaves the process as it is.
 *
 *   adb shell pm grant com.psyclefinder.app android.permission.POST_NOTIFICATIONS
 *   adb shell am broadcast -n com.psyclefinder.app/.CountdownProofReceiver --es minutes 30
 *   adb shell am broadcast -n com.psyclefinder.app/.CountdownProofReceiver --es started 1
 *   adb shell am broadcast -n com.psyclefinder.app/.CountdownProofReceiver --es clear 1
 *
 * Only adb can send to it: its manifest entry asks the sender for android.permission.DUMP,
 * which the shell holds and no app a member installs can. Every extra is a STRING (adb: --es
 * name value), and every one is optional:
 *
 *   minutes   1 to 600 (default 30): the sample class starts that many minutes from now, to
 *             the second. Up to 90 it is inside the countdown's window; beyond, it is not,
 *             and the plan only arms its alarm.
 *   started   1 = instead, a class that started a minute ago: nothing to show.
 *   clear     1 = instead, the EMPTY snapshot a sign-out writes ("null", "[]", "[]").
 *   enabled   1 (default) | 0: the countdown's off switch, as the bridge writes it.
 *
 * What it writes is FIXED: the sender chooses a number, never a word. The sample's names are
 * the fake Psycle server's (tests/tools/fake-psycle.js), its colours the app's defaults for a
 * ride (js/theme.js) - the first class of WidgetPreviewActivity's sample. It sends no request.
 * On a signed-in phone it does overwrite the stored snapshot, until the app's next snapshot
 * pass writes the real one again: that is what a proof hook is, and why only adb reaches it.
 *
 * What it did is logged under the tag PsyncCountdownProof - one line at INFO, or the failure
 * at ERROR - and handed back as the broadcast's result, which `am broadcast` prints.
 */
public class CountdownProofReceiver extends BroadcastReceiver {

    /** The log tag of every line this receiver writes; CI's emulator job reads the log for it. */
    private static final String TAG = "PsyncCountdownProof";

    @Override
    public void onReceive(Context context, Intent intent) {
        String said;
        boolean failed = false;
        try {
            said = prove(context.getApplicationContext(), intent);
            Log.i(TAG, said);
        } catch (RuntimeException e) {
            failed = true;
            said = "failed: " + e;
            Log.e(TAG, "Could not seed the countdown", e);
        }
        // `am broadcast` sends an ordered broadcast and prints this; anything else has no result.
        if (isOrderedBroadcast()) {
            setResultCode(failed ? 1 : 0);
            setResultData(said);
        }
    }

    private static String prove(Context context, Intent intent) {
        TimeZone zone = TimeZone.getDefault();
        long now = System.currentTimeMillis();

        String what;
        String upcoming;
        if ("1".equals(extra(intent, "clear"))) {
            what = "cleared";
            upcoming = "[]";
        } else if ("1".equals(extra(intent, "started"))) {
            what = "seeded a class that started a minute ago";
            upcoming = sample(wall(now - 60000L, zone));
        } else {
            int minutes = number(extra(intent, "minutes"), 30);
            what = "seeded a class " + minutes + " min ahead";
            upcoming = sample(wall(now + minutes * 60000L, zone));
        }
        boolean enabled = !"0".equals(extra(intent, "enabled"));

        // Through the store's own set(), so the hook is held to the same keys and values as the
        // plugin. widget_next_class is what the bridge writes beside the list: its first class.
        boolean stored = PsyncWidgetStore.set(context, PsyncSnapshot.KEY_UPCOMING, upcoming)
            & PsyncWidgetStore.set(context, PsyncSnapshot.KEY_NEXT, first(upcoming))
            & PsyncWidgetStore.set(context, PsyncSnapshot.KEY_WEEK, "[]")
            & PsyncWidgetStore.set(context, PsyncSnapshot.KEY_COUNTDOWN_ENABLED, enabled ? "1" : "0");

        // The real thing, exactly as WidgetCenterPlugin.reloadAllTimelines runs it.
        NextClassWidgetProvider.requestRefresh(context);
        PsyncCountdownReceiver.plan(context);

        // What the planner made of it - worked out again here, for the log only, from what
        // plan() read: the snapshot, the switch, and any countdown the member swiped away.
        PsyncCountdownPlan plan = PsyncCountdownPlan.of(PsyncWidgetStore.read(context), now, zone,
            PsyncWidgetStore.countdownEnabled(context), PsyncWidgetStore.countdownDismissed(context));
        return what + "; stored=" + stored + "; enabled=" + enabled
            + "; canPost=" + PsyncCountdownNotifier.canPost(context)
            + "; shows=" + (plan.shows() ? plan.show.eventId + " \"" + plan.title() + "\" \"" + plan.text(false) + "\"" : "nothing")
            + "; untilInSeconds=" + (plan.shows() ? String.valueOf((plan.until - now) / 1000L) : "-")
            + "; nextWakeInSeconds=" + (plan.nextWake > 0 ? String.valueOf((plan.nextWake - now) / 1000L) : "-");
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
            return value >= 1 && value <= 600 ? value : fallback;
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    // -- The sample ---------------------------------------------------------------------------

    /** widget_upcoming holding ONE class, in the shape the bridge writes (_snapshotEventFor). */
    private static String sample(String startAt) {
        try {
            JSONObject ride = new JSONObject()
                .put("eventId", "9001")
                .put("startAt", startAt)
                .put("instrName", "Alex Hart")
                .put("typeName", "RIDE 45")
                .put("studioName", "Studio One")
                .put("locName", "Shoreditch")
                .put("slots", new JSONArray().put(9))
                .put("ct", "ride")
                .put("ctIntensity", "soft")
                .put("ctBase", "#2D5FD6")
                .put("ctTint", "#E9F0FF")
                .put("ctDeep", "#1A3785")
                .put("ctWash", "#D6E2FF")
                .put("ctBaseDark", "#3A6EE7")
                .put("ctTintDark", "#1F2C4A")
                .put("ctDeepDark", "#D6E2FF")
                .put("ctWashDark", "#233560");
            return new JSONArray().put(ride).toString();
        } catch (JSONException e) {
            return "[]";
        }
    }

    /** widget_next_class for a list: its first class, or "null". */
    private static String first(String upcoming) {
        try {
            JSONArray list = new JSONArray(upcoming);
            return list.length() == 0 ? "null" : list.getJSONObject(0).toString();
        } catch (JSONException e) {
            return "null";
        }
    }

    /** An instant as the snapshot writes a start: a zone-less wall clock, here to the second. */
    private static String wall(long millis, TimeZone zone) {
        Calendar calendar = new GregorianCalendar(zone, Locale.ROOT);
        calendar.setTimeInMillis(millis);
        return String.format(Locale.ROOT, "%04d-%02d-%02dT%02d:%02d:%02d",
            calendar.get(Calendar.YEAR), calendar.get(Calendar.MONTH) + 1, calendar.get(Calendar.DAY_OF_MONTH),
            calendar.get(Calendar.HOUR_OF_DAY), calendar.get(Calendar.MINUTE), calendar.get(Calendar.SECOND));
    }
}
