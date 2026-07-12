//
//  AppGroupPreferences.swift
//  Minimal Capacitor plugin that reads/writes a REAL App Group
//  UserDefaults suite (UserDefaults(suiteName:)).
//
//  Why it exists: the standard @capacitor/preferences plugin's "group"
//  option is only a KEY PREFIX inside UserDefaults.standard — it never
//  touches an App Group container, so app extensions can't read anything
//  it writes. native-bridge.js already calls
//  Capacitor.Plugins.AppGroupPreferences (when present) to mirror the
//  widget snapshot into the shared container that the widget, Live
//  Activity and Siri intent read via PsycleSnapshotStore.
//
//  Registered in MainViewController.capacitorDidLoad() — Capacitor 6 has
//  no auto-discovery for plugins living inside the app target.
//

import Foundation
import Capacitor
import WidgetKit

/// Lets the web layer nudge WidgetKit after the snapshot changes —
/// native-bridge.js probes Capacitor.Plugins.WidgetCenter and calls
/// reloadAllTimelines() after every booking change. Without this the
/// Home Screen widget sits on a stale timeline for up to ~30 minutes.
@objc(WidgetCenterPlugin)
public class WidgetCenterPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetCenterPlugin"
    public let jsName = "WidgetCenter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "reloadAllTimelines", returnType: CAPPluginReturnPromise)
    ]

    @objc func reloadAllTimelines(_ call: CAPPluginCall) {
        if #available(iOS 14.0, *) {
            WidgetCenter.shared.reloadAllTimelines()
        }
        call.resolve()
    }
}

/// Lets the web layer nudge the Live Activity reconcile right after it
/// writes a fresh snapshot. Critical for reliability: didBecomeActive
/// fires BEFORE the JS booking fetch rewrites the snapshot, so without
/// this nudge the controller reconciles against stale data and the
/// countdown card only appears on the NEXT app open.
@objc(PsycleLiveActivityPlugin)
public class PsycleLiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PsycleLiveActivityPlugin"
    public let jsName = "PsycleLiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "refresh", returnType: CAPPluginReturnPromise)
    ]

    @objc func refresh(_ call: CAPPluginCall) {
        if #available(iOS 16.1, *) {
            // Plugin calls arrive on a background queue; reconcile on main
            // like the didBecomeActive path (the app is foregrounded here,
            // so Activity.request is permitted).
            DispatchQueue.main.async {
                NSLog("[PsycleLiveActivity] js refresh nudge")
                PsycleLiveActivityController.shared.refreshFromSnapshot()
            }
        }
        call.resolve()
    }
}

@objc(AppGroupPreferencesPlugin)
public class AppGroupPreferencesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppGroupPreferencesPlugin"
    public let jsName = "AppGroupPreferences"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)
    ]

    private func suite(_ call: CAPPluginCall) -> UserDefaults? {
        guard let group = call.getString("group") else { return nil }
        return UserDefaults(suiteName: group)
    }

    @objc func set(_ call: CAPPluginCall) {
        guard let defaults = suite(call), let key = call.getString("key") else {
            call.reject("Must provide group and key")
            return
        }
        // Reject rather than coerce a missing value to "" — a JS typo
        // (e.g. `val:` instead of `value:`) should surface, not silently
        // blank the widget snapshot.
        guard let value = call.getString("value") else {
            call.reject("Must provide value")
            return
        }
        defaults.set(value, forKey: key)
        call.resolve()
    }

    // get/remove have no JS callers yet (native-bridge only calls set) —
    // kept for API symmetry so future JS can read/clean the suite without
    // another native change.

    @objc func get(_ call: CAPPluginCall) {
        guard let defaults = suite(call), let key = call.getString("key") else {
            call.reject("Must provide group and key")
            return
        }
        call.resolve(["value": defaults.string(forKey: key) as Any])
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let defaults = suite(call), let key = call.getString("key") else {
            call.reject("Must provide group and key")
            return
        }
        defaults.removeObject(forKey: key)
        call.resolve()
    }
}
