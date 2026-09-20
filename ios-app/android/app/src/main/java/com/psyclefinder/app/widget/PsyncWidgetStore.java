package com.psyclefinder.app.widget;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Where the widget snapshot is kept: ONE private SharedPreferences file of the app, written
 * by AppGroupPreferencesPlugin and read by the widget provider (the same process, so a value
 * is readable the moment it is set).
 *
 * The iPhone app needs an App Group for this, because its widget is another process with
 * another container; on Android the provider is part of the app, and there are no app groups.
 * The file is covered by the backup rules like everything else the app stores (res/xml/).
 */
public final class PsyncWidgetStore {

    /** The file's name. Renaming it strands what is stored until the app next writes a snapshot. */
    public static final String FILE = "psync_widget";

    private PsyncWidgetStore() {}

    public static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    /** The stored string, or null: for a key that is not a widget key, a missing one, or a value of another type. */
    public static String get(Context context, String key) {
        if (!PsyncSnapshot.isWidgetKey(key)) {
            return null;
        }
        try {
            return prefs(context).getString(key, null);
        } catch (ClassCastException e) {
            // Something other than a string is filed under the key: as good as nothing.
            return null;
        }
    }

    /** False when the key is not a widget key, or the value is missing or over 64 KB: nothing is written. */
    public static boolean set(Context context, String key, String value) {
        if (!PsyncSnapshot.isWidgetKey(key) || !PsyncSnapshot.fitsStore(value)) {
            return false;
        }
        prefs(context).edit().putString(key, value).apply();
        return true;
    }

    public static boolean remove(Context context, String key) {
        if (!PsyncSnapshot.isWidgetKey(key)) {
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
}
