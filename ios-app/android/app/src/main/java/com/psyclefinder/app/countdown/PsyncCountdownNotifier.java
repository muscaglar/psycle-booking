package com.psyclefinder.app.countdown;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;

import com.psyclefinder.app.R;
import com.psyclefinder.app.widget.PsyncTapIntent;

/**
 * The class countdown as the member sees it: ONE silent, ongoing notification that counts
 * down to the next held class - the system's own chronometer, so nothing in the app runs
 * while it ticks. It is posted, updated or taken down to match a PsyncCountdownPlan, and that
 * is all this class does: no storage, no alarm, no planning (PsyncCountdownReceiver.plan is
 * the one caller).
 *
 * It is NOT the class reminder. That one is an alerting notification the bridge schedules
 * through the local-notifications plugin on the channel "class-reminders", 90 minutes before
 * a class, and it stays exactly as it is. This one has a channel of its own, so a member can
 * switch the countdown off in Android's settings and keep the reminders, or the reverse.
 *
 * What keeps it from outstaying the class - a notification that will not go away is worse
 * than none:
 *   - from Android 8 the SYSTEM removes it at the start (setTimeoutAfter), with the app dead;
 *   - the receiver's alarm for the start takes it down too, and below Android 8, where there
 *     is no timeout, it is posted only once that alarm is armed;
 *   - every plan run cancels it when there is nothing to show: sign-out, a cancelled class,
 *     the off switch, notifications refused.
 * WHETHER to post is not decided here: the pure PsyncCountdownPlan.mayPost holds that rule,
 * where the JVM tests run it; this class only tells it what the phone says.
 *
 * A member who SWIPES it away (Android 14 lets them; before that an ongoing notification
 * cannot be swiped) has answered for that class: the delete intent tells
 * PsyncCountdownDismissReceiver, which records the plan's key, and no later plan run posts
 * that class's countdown again.
 *
 * It never asks for the notification permission. The app's own in-context ask (the bridge,
 * when the member turns reminders on or books a first class) stays the only one; without the
 * permission this does nothing, silently.
 */
public final class PsyncCountdownNotifier {

    /**
     * The channel's id. NEVER rename it: what a member has set for it in Android's settings
     * is filed under this id. It is created here, natively - the bridge's two channels
     * ("class-reminders", "new-dates") are created by the plugin, from JavaScript.
     */
    public static final String CHANNEL_ID = "class-countdown";

    /**
     * ONE notification: this tag and this id, always. The TAG is what keeps it apart from the
     * local-notifications plugin, which posts and cancels by a bare id (the bridge's are
     * 8000-8899 and 9992-9999): a cancel with no tag can never reach a notification that has
     * one, whatever its number.
     */
    public static final String TAG = "psync-countdown";
    public static final int NOTIFICATION_ID = 7090;

    private PsyncCountdownNotifier() {}

    /**
     * True when a notification posted now would be shown: notifications are on for the app
     * and, from Android 13, the member has granted the permission. It only LOOKS - nothing
     * here ever asks. Below Android 7 the platform cannot say; a post the member has blocked
     * is dropped by the system there, which comes to the same.
     */
    public static boolean canPost(Context context) {
        if (context == null) {
            return false;
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                    && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
                return false;
            }
            NotificationManager manager = manager(context);
            if (manager == null) {
                return false;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                return manager.areNotificationsEnabled();
            }
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }

    /**
     * Makes what is on screen match the plan: the one notification posted or updated in place
     * for the class it shows, or taken down. `alarmArmed` is whether the receiver's alarm for
     * the plan's next wake is armed - below Android 8 the only thing that takes the
     * notification down at the start. Returns true when a notification is up after the call.
     * Never throws.
     */
    public static boolean apply(Context context, PsyncCountdownPlan plan, long nowMillis, boolean alarmArmed) {
        if (context == null) {
            return false;
        }
        try {
            // From Android 8 the system's own timeout ends it (clock(), below), alarm or no alarm.
            boolean systemEndsIt = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O;
            if (plan == null || !plan.mayPost(alarmArmed, systemEndsIt, canPost(context), nowMillis)) {
                cancel(context);
                return false;
            }
            long timeout = plan.timeoutMillis(nowMillis);
            NotificationManager manager = manager(context);
            if (manager == null) {
                return false;
            }
            ensureChannel(context, manager);
            // The same tag and id every time: a second post REPLACES the first, it never stacks.
            manager.notify(TAG, NOTIFICATION_ID, build(context, plan, timeout));
            return true;
        } catch (RuntimeException e) {
            // A notification that could not be built or posted must not be left half-standing.
            cancel(context);
            return false;
        }
    }

    /** Takes the notification down. Safe with none up. Never throws. */
    public static void cancel(Context context) {
        if (context == null) {
            return;
        }
        try {
            NotificationManager manager = manager(context);
            if (manager != null) {
                manager.cancel(TAG, NOTIFICATION_ID);
            }
        } catch (RuntimeException e) {
            // Nothing to do about it here: the system's own timeout still removes it at the start.
        }
    }

    // -- The channel ----------------------------------------------------------------------------

    /**
     * The countdown's own channel, from Android 8 (before that there are no channels, and the
     * builder's priority below says the same). IMPORTANCE_LOW: it sits in the shade and on the
     * lock screen, with no sound, no vibration and no peek. Creating a channel that exists
     * changes only its name and description - never what the member has set for it - so this
     * runs before every post.
     */
    private static void ensureChannel(Context context, NotificationManager manager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID,
            context.getString(R.string.countdown_channel_name), NotificationManager.IMPORTANCE_LOW);
        channel.setDescription(context.getString(R.string.countdown_channel_description));
        channel.setShowBadge(false);
        channel.enableVibration(false);
        channel.enableLights(false);
        channel.setSound(null, null);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        manager.createNotificationChannel(channel);
    }

    // -- The notification -----------------------------------------------------------------------

    private static Notification build(Context context, PsyncCountdownPlan plan, long timeoutMillis) {
        // Below Android 7 the system cannot count DOWN (it would count up from the start, in
        // minus figures): there the header shows the start as a time of day, and the text
        // opens with it in 24-hour digits.
        boolean countsDown = Build.VERSION.SDK_INT >= Build.VERSION_CODES.N;

        Notification.Builder builder = builder(context);
        builder.setSmallIcon(R.drawable.ic_stat_psync);
        builder.setContentTitle(plan.title());
        builder.setContentText(plan.text(!countsDown));
        clock(builder, plan.until, timeoutMillis);
        builder.setOngoing(true);
        builder.setOnlyAlertOnce(true);
        builder.setAutoCancel(false);
        builder.setCategory(Notification.CATEGORY_EVENT);
        builder.setColor(plan.colour());
        // The tap is the widget's: an explicit, immutable intent for MainActivity carrying an
        // id that is treated as untrusted where it arrives. No action buttons.
        builder.setContentIntent(PsyncTapIntent.open(context, plan.show.eventId, PsyncTapIntent.FROM_COUNTDOWN));
        // A swipe (Android 14+) is the member's answer for THIS class: the receiver it reaches
        // records the plan's key, and no later plan run posts this class's countdown again.
        builder.setDeleteIntent(PsyncCountdownDismissReceiver.intent(context, plan.key));
        // A lock screen that hides private content must not name the place to a stranger: it
        // shows the public version below instead - "Next class", and the time.
        builder.setVisibility(Notification.VISIBILITY_PRIVATE);
        builder.setPublicVersion(publicVersion(context, plan, timeoutMillis));
        return builder.build();
    }

    /** What a locked phone may show to anyone: no class name, no place, no seat. */
    private static Notification publicVersion(Context context, PsyncCountdownPlan plan, long timeoutMillis) {
        Notification.Builder builder = builder(context);
        builder.setSmallIcon(R.drawable.ic_stat_psync);
        builder.setContentTitle(context.getString(R.string.countdown_public_title));
        builder.setContentText(plan.startLabel());
        clock(builder, plan.until, timeoutMillis);
        builder.setOngoing(true);
        builder.setOnlyAlertOnce(true);
        builder.setCategory(Notification.CATEGORY_EVENT);
        builder.setVisibility(Notification.VISIBILITY_PUBLIC);
        return builder.build();
    }

    /**
     * A builder on the countdown's channel. Before Android 8 there are no channels: the
     * older constructor, and a low PRIORITY for what the channel's importance says from 8 on.
     */
    @SuppressWarnings("deprecation")
    private static Notification.Builder builder(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return new Notification.Builder(context, CHANNEL_ID);
        }
        Notification.Builder builder = new Notification.Builder(context);
        builder.setPriority(Notification.PRIORITY_LOW);
        return builder;
    }

    /**
     * The time: `when` is the class's start. From Android 7 the header counts down to it, by
     * the system's own chronometer; from Android 8 the system also removes the notification
     * when it gets there, whether or not anything of the app is alive to do it.
     */
    private static void clock(Notification.Builder builder, long untilMillis, long timeoutMillis) {
        builder.setWhen(untilMillis);
        builder.setShowWhen(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            builder.setUsesChronometer(true);
            builder.setChronometerCountDown(true);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder.setTimeoutAfter(timeoutMillis);
        }
    }

    private static NotificationManager manager(Context context) {
        return (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
    }
}
