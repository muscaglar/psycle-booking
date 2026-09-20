package com.psyclefinder.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.psyclefinder.app.widget.PsyncSnapshot;
import com.psyclefinder.app.widget.PsyncWidgetStore;

/**
 * The Android twin of the iPhone app's AppGroupPreferences plugin
 * (ios-app/ios/App/App/AppGroupPreferences.swift): the SAME JavaScript name and the same three
 * methods - set({group, key, value}), get({group, key}) -> {value}, remove({group, key}) - so
 * that the bridge's existing code (native-bridge.js, _appGroupSet), which finds the plugin by
 * name, writes the widget snapshot here with no Android branch of its own.
 *
 * What differs is where it lands. `group` names an iOS App Group; Android has none, and the
 * widget provider is part of the app, so the argument is required (as on the iPhone: a call
 * that works there works here) and then ignored - everything goes to ONE private preferences
 * file (PsyncWidgetStore). And this twin is stricter: only the three widget keys are taken,
 * only strings, none over 64 KB, so that a page cannot use it as general storage.
 *
 * Signing out needs nothing here: the bridge's sign-out pass writes an EMPTY snapshot
 * ("null", "[]", "[]") through set(), exactly as it does on the iPhone, and a session that
 * merely expired writes nothing, so the widget keeps the classes that are still booked.
 *
 * A local plugin is not discovered by Capacitor: MainActivity registers it, before super.onCreate.
 */
@CapacitorPlugin(name = "AppGroupPreferences")
public class AppGroupPreferencesPlugin extends Plugin {

    @PluginMethod
    public void set(PluginCall call) {
        String key = keyOf(call);
        if (key == null) {
            return;
        }
        // Reject rather than coerce a missing value to "", as the iPhone plugin does: a typo in
        // the page should surface, not silently blank the widget.
        String value = call.getString("value");
        if (value == null) {
            call.reject("Must provide value");
            return;
        }
        if (!PsyncSnapshot.fitsStore(value)) {
            call.reject("Value is too large");
            return;
        }
        PsyncWidgetStore.set(getContext(), key, value);
        call.resolve();
    }

    @PluginMethod
    public void get(PluginCall call) {
        String key = keyOf(call);
        if (key == null) {
            return;
        }
        String value = PsyncWidgetStore.get(getContext(), key);
        JSObject result = new JSObject();
        result.put("value", value == null ? JSObject.NULL : value);
        call.resolve(result);
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String key = keyOf(call);
        if (key == null) {
            return;
        }
        PsyncWidgetStore.remove(getContext(), key);
        call.resolve();
    }

    /** The call's key when the call is well-formed; otherwise the call is rejected and this is null. */
    private static String keyOf(PluginCall call) {
        String key = call.getString("key");
        if (call.getString("group") == null || key == null) {
            call.reject("Must provide group and key");
            return null;
        }
        if (!PsyncSnapshot.isWidgetKey(key)) {
            call.reject("Not a widget key");
            return null;
        }
        return key;
    }
}
