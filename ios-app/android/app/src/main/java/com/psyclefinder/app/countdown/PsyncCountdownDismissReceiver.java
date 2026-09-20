package com.psyclefinder.app.countdown;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import com.psyclefinder.app.widget.PsyncTapIntent;
import com.psyclefinder.app.widget.PsyncWidgetStore;

/**
 * Hears that the class countdown was DISMISSED, and remembers it for that class. From Android
 * 14 a member can swipe an ongoing notification away. Without this every plan run - each time
 * the app comes to the front, the widget's half-hourly update with the app closed - would put
 * the same countdown back, for up to ninety minutes. A swipe is an answer for that class.
 *
 * It is the notification's DELETE intent (PsyncCountdownNotifier): an explicit, immutable
 * broadcast to this class, carrying the plan's key - the class's id and its start
 * (PsyncCountdownPlan.keyFor). The key is filed in the widget's store under a name the page
 * cannot write (PsyncWidgetStore.setCountdownDismissed); PsyncCountdownReceiver.plan hands it
 * to the planner, which then shows nothing for that class at that start, and forgets it as
 * soon as the plan is about anything else.
 *
 * The system sends the same intent when its own TIMEOUT removes the notification at the
 * class's start. That is harmless - the key names a class that has started, which is never
 * shown again - and useful: the plan run below hands over to the next class at once, without
 * waiting for the receiver's own alarm. A cancel by the app itself sends nothing.
 *
 * A class of its OWN, so that PsyncCountdownReceiver keeps its rule of taking nothing from an
 * intent. NOT exported, and with no intent filter: only the app's own PendingIntent, sent by
 * the system, reaches it. What it reads from the intent is one string, held to the shape of a
 * key before it is stored. It sends no request.
 */
public class PsyncCountdownDismissReceiver extends BroadcastReceiver {

    /** The delete intent's action. Always sent explicitly, by class. */
    public static final String ACTION_DISMISSED = "com.psyclefinder.app.countdown.DISMISSED";
    /** The key of the countdown that was up (PsyncCountdownPlan.keyFor). */
    static final String EXTRA_KEY = "com.psyclefinder.app.countdown.KEY";

    /**
     * The delete intent for the countdown `key` names. ONE PendingIntent, replaced each time
     * (extras are no part of its identity; FLAG_UPDATE_CURRENT keeps the key current), and
     * immutable: whoever holds it - the notification shade - can fill nothing in.
     */
    static PendingIntent intent(Context context, String key) {
        Intent dismissed = new Intent(context, PsyncCountdownDismissReceiver.class).setAction(ACTION_DISMISSED);
        dismissed.putExtra(EXTRA_KEY, key);
        return PendingIntent.getBroadcast(context, 0, dismissed, PsyncTapIntent.immutableFlags());
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) {
            return;
        }
        try {
            String key = intent.getStringExtra(EXTRA_KEY);
            if (PsyncCountdownPlan.isKey(key)) {
                PsyncWidgetStore.setCountdownDismissed(context, key);
            }
        } catch (RuntimeException e) {
            // An extra that cannot be read: the swipe is forgotten, and the next plan run posts
            // the countdown again. No worse than before there was a receiver here.
        }
        // Plan again, reading nothing more from the intent: swiped, the plan now shows nothing
        // for that class; timed out, the class after it takes over at once. It never throws.
        PsyncCountdownReceiver.plan(context);
    }
}
