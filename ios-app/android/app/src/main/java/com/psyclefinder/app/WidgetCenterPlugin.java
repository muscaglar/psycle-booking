package com.psyclefinder.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.psyclefinder.app.widget.NextClassWidgetProvider;

/**
 * The Android twin of the iPhone app's WidgetCenter plugin (AppGroupPreferences.swift): the
 * same JavaScript name and the same one method. The bridge calls reloadAllTimelines() after
 * every snapshot write (updateWidgetSnapshot in native-bridge.js); here that is an explicit
 * broadcast to the widget provider, which re-reads the snapshot and repaints.
 *
 * Plugin calls run one after another on Capacitor's plugin thread, so the three set() calls
 * the bridge makes just before this one have landed by the time the broadcast is sent.
 *
 * A local plugin is not discovered by Capacitor: MainActivity registers it, before super.onCreate.
 */
@CapacitorPlugin(name = "WidgetCenter")
public class WidgetCenterPlugin extends Plugin {

    @PluginMethod
    public void reloadAllTimelines(PluginCall call) {
        NextClassWidgetProvider.requestRefresh(getContext());
        call.resolve();
    }
}
