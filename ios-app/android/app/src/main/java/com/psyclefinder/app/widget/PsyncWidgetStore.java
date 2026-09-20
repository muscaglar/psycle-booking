package com.psyclefinder.app.widget;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Where the widget snapshot is kept: ONE private SharedPreferences file of the app, written
 * by AppGroupPreferencesPlugin and read by the widget provider and by the class countdown
 * (the same process, so a value is readable the moment it is set).
 *
 * The iPhone app needs an App Group for this, because its widget is another process with
 * another container; on Android the provider is part of the app, and there are no app groups.
 * The file is covered by the backup rules like everything else the app stores (res/xml/).
 *
 * The PAGE may write four keys and no other (PsyncSnapshot.isStoreKey): the three of the
 * snapshot, and the countdown's switch, "1" or "0" (PsyncSnapshot.fitsKey). ONE more is
 * written natively only, under a name get(), set() and remove() refuse, so the plugin cannot
 * reach it: the key of a countdown the member swiped away (countdownDismissed).
 */
public final class PsyncWidgetStore {

    /** The file's name. Renaming it strands what is stored until the app next writes a snapshot. */
    public static final String FILE = "psync_widget";

    /**
     * Native only, and NOT one of PsyncSnapshot's keys: which countdown the member swiped away
     * (PsyncCountdownPlan.keyFor). The plugin's allow-list does not hold it, so the page can
     * neither read nor write it.
     */
    private static final String KEY_COUNTDOWN_DISMISSED = "countdown_dismissed";

    private PsyncWidgetStore() {}

    public static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    /** The stored string, or null: for a key the store does not take, a missing one, or a value of another type. */
    public static String get(Context context, String key) {
        if (!PsyncSnapshot.isStoreKey(key)) {
            return null;
        }
        try {
            return prefs(context).getString(key, null);
        } catch (ClassCastException e) {
            // Something other than a string is filed under the key: as good as nothing.
            return null;
        }
    }

    /**
     * False when the store does not take the key, or the value is missing, over 64 KB or - for
     * the countdown's switch - anything but "1" or "0": nothing is written.
     */
    public static boolean set(Context context, String key, String value) {
        if (!PsyncSnapshot.fitsKey(key, value)) {
            return false;
        }
        prefs(context).edit().putString(key, value).apply();
        return true;
    }

    public static boolean remove(Context context, String key) {
        if (!PsyncSnapshot.isStoreKey(key)) {
            return false;
        }
        prefs(context).edit().remove(key).apply();
        return true;
    }

    /** What is stored now, read defensively: never null, never throws. */
    public static PsyncSnapshot read(Context context) {
        try {
            return PsyncSnapshot.parse(
                get(context, PsyncSnapshot.KEY_NEXT),
                get(context, PsyncSnapshot.KEY_UPCOMING),
                get(context, PsyncSnapshot.KEY_WEEK));
        } catch (RuntimeException e) {
            return PsyncSnapshot.empty();
        }
    }

    /**
     * Whether the class countdown may show: the member's class-reminders preference, as the
     * bridge last wrote it. Never written = OFF (PsyncSnapshot.countdownEnabled): the countdown
     * follows that preference, so it waits until it has been told. Never throws.
     */
    public static boolean countdownEnabled(Context context) {
        try {
            return PsyncSnapshot.countdownEnabled(get(context, PsyncSnapshot.KEY_COUNTDOWN_ENABLED));
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** The key of the countdown the member swiped away, or null. Never throws. */
    public static String countdownDismissed(Context context) {
        try {
            return prefs(context).getString(KEY_COUNTDOWN_DISMISSED, null);
        } catch (RuntimeException e) {
            // Something other than a string is filed there, or the file cannot be read.
            return null;
        }
    }

    /** Records the swiped-away countdown's key; null forgets it. Never throws. */
    public static void setCountdownDismissed(Context context, String key) {
        try {
            SharedPreferences.Editor editor = prefs(context).edit();
            if (key == null) {
                editor.remove(KEY_COUNTDOWN_DISMISSED);
            } else {
                editor.putString(KEY_COUNTDOWN_DISMISSED, key);
            }
            editor.apply();
        } catch (RuntimeException e) {
            // A swipe that cannot be remembered: the countdown comes back at the next plan run.
        }
    }
}
