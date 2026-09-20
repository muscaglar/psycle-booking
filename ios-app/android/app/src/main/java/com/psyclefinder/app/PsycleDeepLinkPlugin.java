package com.psyclefinder.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.psyclefinder.app.widget.PsyncSnapshot;

/**
 * The Android twin of the iPhone app's PsycleDeepLink plugin (AppGroupPreferences.swift): the
 * same JavaScript name and the same one event, 'openURL' { url }, so the bridge's listener
 * (native-bridge.js, handleWidgetURL) routes an Android widget tap exactly as it routes an
 * iPhone one: My Bookings, then that class's sheet while the seat is still held.
 *
 * No URL is ever OPENED on Android - the app declares no scheme and no intent filter for one.
 * The widget's tap is an explicit intent to MainActivity with the class id as an extra;
 * MainActivity hands that extra here, and the psync:// link is only the shape the page already
 * parses (_parseWidgetLink). The extra is untrusted (any app can start the launcher activity
 * with extras of its choosing): PsyncSnapshot.deepLink keeps 1 to 12 digits and nothing else,
 * and without a usable id the link is psync://bookings, which opens My Bookings and no class.
 *
 * The event is RETAINED until the page attaches its listener: a tap usually cold-starts the
 * app, long before any script runs. Not carried over from the iPhone plugin: its replay of a
 * tap to a page that reloaded under dead listeners. It has no methods for the page to call.
 *
 * A local plugin is not discovered by Capacitor: MainActivity registers it, before super.onCreate.
 */
@CapacitorPlugin(name = "PsycleDeepLink")
public class PsycleDeepLinkPlugin extends Plugin {

    /** The name MainActivity looks this plugin up by: the @CapacitorPlugin name above. */
    static final String NAME = "PsycleDeepLink";

    /** A widget tap: `rawEventId` is what the intent carried, or null. Main thread. */
    void openFromWidget(String rawEventId) {
        JSObject data = new JSObject();
        data.put("url", PsyncSnapshot.deepLink(rawEventId));
        notifyListeners("openURL", data, true);
    }
}
