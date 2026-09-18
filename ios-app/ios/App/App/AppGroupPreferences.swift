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

/// Hands a widget tap (psync://bookings?event=<id>, minted by
/// PsycleWidget.swift) to the web layer, which routes it like a reminder tap.
/// The event is RETAINED until native-bridge.js attaches its listener: a
/// widget tap usually cold-launches the app, so the URL arrives long before
/// any script has run — a plain window event fired now would simply be lost.
/// (@capacitor/app would do this too, but it is not a dependency here.)
/// A tap that lands while only a DEAD page's listener is registered is
/// replayed to the next page that attaches — see forward().
@objc(PsycleDeepLinkPlugin)
public class PsycleDeepLinkPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PsycleDeepLinkPlugin"
    public let jsName = "PsycleDeepLink"
    public let pluginMethods: [CAPPluginMethod] = []

    override public func load() {
        // AppDelegate already forwards application(_:open:) to Capacitor's
        // proxy, which posts this notification.
        NotificationCenter.default.addObserver(self,
                                               selector: #selector(handleOpenURL(_:)),
                                               name: .capacitorOpenURL,
                                               object: nil)
        // The launch URL can be delivered before this plugin is registered
        // (capacitorDidLoad) — its notification is then long gone, but the
        // proxy keeps the last URL. load() runs once per process, so this can
        // only ever be the launch URL and never double-fires with the observer.
        if let url = ApplicationDelegateProxy.shared.lastURL {
            forward(url)
        }
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc private func handleOpenURL(_ notification: Notification) {
        guard let object = notification.object as? [String: Any],
              let url = object["url"] as? URL else { return }
        forward(url)
    }

    /// A tap that went out to listeners which may all be DEAD — see forward().
    /// Main queue only.
    private var pendingTap: (data: [String: Any], at: Date)?
    /// As the web layer's own give-up: a sheet that pops up long after the tap
    /// is worse than none.
    private static let pendingTapWindow: TimeInterval = 10

    private func forward(_ url: URL) {
        // Only our own links; the web layer validates the rest.
        guard url.scheme?.lowercased() == "psync" else { return }
        let data: [String: Any] = ["url": url.absoluteString]
        // Capacitor retains an event only while NO listener is registered, and
        // it never drops a plugin's listeners when their page goes away. Once
        // iOS has killed the WebView's content process (the app resumed after
        // hours in the background; Capacitor reloads the page) the only
        // "listener" is the dead page's: the tap is delivered to a callback
        // nobody holds, is NOT retained, and the reloaded page never hears of
        // it. So a tap handed to existing listeners is also kept, briefly, for
        // the next page that attaches (addListener below). Retained and pending
        // exclude each other (no listeners / some), so a page gets a tap once.
        if hasListeners("openURL") {
            pendingTap = (data, Date())
        }
        notifyListeners("openURL", data: data, retainUntilConsumed: true)
    }

    /// Called on the bridge's queue; forward() and pendingTap live on main.
    @objc override public func addListener(_ call: CAPPluginCall) {
        super.addListener(call)
        guard call.getString("eventName") == "openURL" else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let tap = self.pendingTap else { return }
            self.pendingTap = nil
            guard Date().timeIntervalSince(tap.at) < PsycleDeepLinkPlugin.pendingTapWindow else { return }
            // Un-retained: the listener that has just attached is there to hear it.
            self.notifyListeners("openURL", data: tap.data)
        }
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
