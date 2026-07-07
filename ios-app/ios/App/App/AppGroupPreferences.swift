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
