package com.psyclefinder.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.psyclefinder.app.countdown.PsyncCountdownReceiver;
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
 * The same call plans the class countdown (countdown/PsyncCountdownReceiver) - Android's
 * stand-in for the Live Activity, which the iPhone app refreshes at this very point of a pass
 * through a plugin of its own, PsycleLiveActivity. That plugin has NO twin here and must not
 * gain one: the countdown needs nothing from the page but the snapshot it has just written.
 *
 * A local plugin is not discovered by Capacitor: MainActivity registers it, before super.onCreate.
 */
@CapacitorPlugin(name = "WidgetCenter")
public class WidgetCenterPlugin extends Plugin {

    @PluginMethod
    public void reloadAllTimelines(PluginCall call) {
        NextClassWidgetProvider.requestRefresh(getContext());
        // Reads what was just stored; posts, updates or takes down the one notification. It
        // never throws, and it never asks for a permission.
        PsyncCountdownReceiver.plan(getContext());
        call.resolve();
    }
}
