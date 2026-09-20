package com.psyclefinder.app.widget;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import com.psyclefinder.app.MainActivity;

/**
 * The ONE way a tap outside the app opens it on a class: the home-screen widget's card and the
 * class countdown's notification (countdown/PsyncCountdownNotifier) both build their
 * PendingIntent here, so the two can never come to differ in what they let a holder do.
 *
 * It opens MainActivity with an EXPLICIT intent: no URL scheme, no new intent filter. The
 * class's id rides as an extra, so FLAG_UPDATE_CURRENT is what keeps it current (extras are no
 * part of a PendingIntent's identity); FLAG_IMMUTABLE so that whoever holds it - the launcher,
 * the notification shade - can fill nothing in.
 *
 * MainActivity is the exported launcher, so ANY app can send it this action with an extra of
 * its own making: the id is UNTRUSTED where it arrives (MainActivity.handWidgetTap,
 * PsyncSnapshot.tapId: 1 to 12 digits, or no id at all), and it is cut down the same way here
 * before it leaves.
 */
public final class PsyncTapIntent {

    /**
     * The action of the intent a tap sends to MainActivity. Not MAIN, on purpose: the
     * local-notifications plugin reads every MAIN intent that reaches the activity as a
     * possible notification tap. The VALUE keeps its "widget" - a launcher can hold a
     * PendingIntent made by an older build of the app.
     */
    public static final String ACTION_OPEN = "com.psyclefinder.app.widget.OPEN";
    /** The shown class's id, as a string of digits. MainActivity treats it as untrusted. */
    public static final String EXTRA_EVENT_ID = "com.psyclefinder.app.widget.EVENT_ID";

    /**
     * Who the tap is for. It is the PendingIntent's request code, which IS part of its
     * identity: the widget's and the countdown's are then two PendingIntents, and one being
     * rebuilt for another class (FLAG_UPDATE_CURRENT) never changes the id the other carries.
     * The widget keeps 0, what it has always used.
     */
    public static final int FROM_WIDGET = 0;
    public static final int FROM_COUNTDOWN = 1;

    private PsyncTapIntent() {}

    /** The tap: MainActivity, by class, with the class's id when it is a usable one. */
    public static PendingIntent open(Context context, String eventId, int from) {
        Intent open = new Intent(context, MainActivity.class);
        open.setAction(ACTION_OPEN);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        String id = PsyncSnapshot.tapId(eventId);
        if (id != null) {
            open.putExtra(EXTRA_EVENT_ID, id);
        }
        return PendingIntent.getActivity(context, from, open, immutableFlags());
    }

    /**
     * The flags of EVERY PendingIntent the app builds - the tap above, the widget's repaint
     * alarm, the countdown's wake: the newest extras win, and nothing can be filled in by
     * whoever holds it. FLAG_IMMUTABLE exists from API 23; from Android 12 a PendingIntent
     * without it throws.
     */
    public static int immutableFlags() {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return flags;
    }
}
