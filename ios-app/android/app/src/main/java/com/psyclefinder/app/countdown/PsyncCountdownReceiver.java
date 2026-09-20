package com.psyclefinder.app.countdown;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import com.psyclefinder.app.widget.PsyncSnapshot;
import com.psyclefinder.app.widget.PsyncTapIntent;
import com.psyclefinder.app.widget.PsyncWidgetStore;

import java.util.TimeZone;

/**
 * Keeps the class countdown true with the app not running. plan() is the whole of it: read
 * the stored snapshot and the off switch (PsyncWidgetStore), ask the pure PsyncCountdownPlan
 * what should be showing now, make the notification match (PsyncCountdownNotifier), and arm
 * ONE alarm for the instant the answer next changes. Every run is idempotent - post, update
 * or cancel to match the plan; never a second notification, never a second alarm.
 *
 * Who calls plan():
 *   - WidgetCenterPlugin.reloadAllTimelines(): the bridge has just written a snapshot - a
 *     booking, a cancel, a moved class, and the empty one a sign-out writes, which takes the
 *     countdown down at once. (A session that merely expired writes nothing: the classes are
 *     still held, and the countdown stays - the iPhone's rule.)
 *   - AppGroupPreferencesPlugin.set(), when the off switch CHANGES;
 *   - MainActivity.onCreate, at every cold start;
 *   - NextClassWidgetProvider.onUpdate: the system's half-hourly update, where a widget is placed;
 *   - this receiver: its own alarm (ACTION_PLAN, an explicit intent), and four broadcasts
 *     only the SYSTEM may send - BOOT_COMPLETED (a restart clears every alarm and every
 *     notification), MY_PACKAGE_REPLACED (an update of the app removes its notifications),
 *     and TIMEZONE_CHANGED and TIME_SET (startAt is read on the phone's own clock: the
 *     instant the countdown runs to, the system's timeout and the armed alarm all move);
 *   - PsyncCountdownDismissReceiver, once it has recorded a swipe or the system's timeout.
 *
 * The receiver is NOT exported. The alarm's PendingIntent is sent as the app itself, and the
 * system reaches an unexported receiver with its own broadcasts (the local-notifications
 * plugin's restore receiver is declared the same way). RECEIVE_BOOT_COMPLETED is that
 * plugin's, merged into the manifest: nothing was added for this, and the other three need
 * no permission. onReceive takes NOTHING from the intent that arrives - not its action, not
 * an extra: whatever it is, it plans.
 *
 * The alarm is AlarmManager.setWindow with a ten-minute window - inexact, no permission, no
 * special-access screen - and RTC, not RTC_WAKEUP, as the widget's is. A countdown is only
 * ever SEEN on a phone that is awake, and a waiting RTC alarm is delivered when the phone
 * next wakes: waking a sleeping phone to post a silent notification nobody is looking at
 * would spend battery on nothing. NOT AlarmManager.set: its window is the system's to choose
 * - three quarters of the wait, capped at an hour from Android 12 and not at all before - so
 * a countdown armed in the morning could first appear with half an hour left, or never. Ten
 * minutes is the shortest window Android 12+ honours for an alarm that is not exact. The
 * cost is a countdown that can appear up to about ten minutes late on a phone that is awake.
 * Its END does not depend on the alarm from Android 8: the system removes the notification
 * at the class's start by itself.
 */
public class PsyncCountdownReceiver extends BroadcastReceiver {

    /** Plan again: the action of this receiver's own alarm. Always sent explicitly, by class. */
    public static final String ACTION_PLAN = "com.psyclefinder.app.countdown.PLAN";

    /**
     * How late the alarm may be delivered on a phone that is awake: ten minutes, the shortest
     * window Android 12+ honours for an alarm that is not exact (setWindow).
     */
    private static final long WAKE_WINDOW_MILLIS = 10L * 60L * 1000L;

    @Override
    public void onReceive(Context context, Intent intent) {
        plan(context);
    }

    /**
     * Makes the countdown match what is stored, now. Safe from any thread, as often as anyone
     * likes; it never throws - it is called while the activity starts, inside a plugin call
     * and from the system's broadcasts, and a countdown is never worth any of those.
     */
    public static synchronized void plan(Context context) {
        if (context == null) {
            return;
        }
        try {
            Context app = context.getApplicationContext() == null ? context : context.getApplicationContext();
            long now = System.currentTimeMillis();
            PsyncSnapshot snapshot = PsyncWidgetStore.read(app);
            // The DEVICE zone: startAt is read device-local, as the widget reads it
            // (agents/decisions.md section 4, CLOSED).
            String dismissed = PsyncWidgetStore.countdownDismissed(app);
            PsyncCountdownPlan plan = PsyncCountdownPlan.of(snapshot, now, TimeZone.getDefault(),
                PsyncWidgetStore.countdownEnabled(app), dismissed);
            // A swipe answers for ONE class at ONE start. Once the plan is about anything else -
            // another class, a moved start, nothing at all - it has no more to say, and goes.
            if (dismissed != null && !dismissed.equals(plan.key)) {
                PsyncWidgetStore.setCountdownDismissed(app, null);
            }

            // The alarm FIRST. Below Android 8 nothing but this alarm (and the next plan run)
            // takes the notification down at the class's start, so there it is posted only
            // once the alarm is armed; from Android 8 the system's own timeout does it. The
            // rule itself is the pure plan's (mayPost): the notifier asks it.
            boolean armed = schedule(app, plan.nextWake);
            PsyncCountdownNotifier.apply(app, plan, now, armed);
        } catch (RuntimeException e) {
            // Whatever went wrong, a notification that may no longer be true does not stay up.
            PsyncCountdownNotifier.cancel(context);
        }
    }

    // -- The alarm ------------------------------------------------------------------------------

    private static PendingIntent wake(Context context) {
        Intent plan = new Intent(context, PsyncCountdownReceiver.class).setAction(ACTION_PLAN);
        return PendingIntent.getBroadcast(context, 0, plan, PsyncTapIntent.immutableFlags());
    }

    /**
     * ONE alarm, replaced each time (the same PendingIntent), for the instant the plan names;
     * PsyncCountdownPlan.NONE cancels it. Returns true when an alarm is armed after the call.
     * It throws nothing: an alarm that cannot be armed leaves the other callers of plan() as
     * the only clock.
     */
    private static boolean schedule(Context context, long atMillis) {
        try {
            AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (alarms == null) {
                return false;
            }
            if (atMillis > 0) {
                alarms.setWindow(AlarmManager.RTC, atMillis, WAKE_WINDOW_MILLIS, wake(context));
                return true;
            }
            alarms.cancel(wake(context));
            return false;
        } catch (RuntimeException e) {
            return false;
        }
    }
}
