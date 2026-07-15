//
//  PsycleSnapshot.swift
//  Shared model + App Group reader for widgets, Live Activity, and intents.
//
//  ── HOW TO ADD THIS FILE IN XCODE ────────────────────────────────────────
//  Add this file to the **target membership** of EVERY target that needs the
//  snapshot: the Widget Extension, the (optional) Live Activity code in the
//  main app, AND the App Intents extension (or the app target if intents live
//  there). Select the file in the Project navigator → File Inspector →
//  "Target Membership" → tick all of them.
//
//  ── WHERE THE DATA COMES FROM ────────────────────────────────────────────
//  native-bridge.js writes two JSON strings into the shared App Group
//  defaults: `widget_next_class` and `widget_week`. See NATIVE_FEATURES.md
//  for how Capacitor Preferences maps onto UserDefaults(suiteName:).
//
//  NOTE: This is drop-in source. It compiles only once it is a member of a
//  real Swift target created in Xcode (you cannot create that target from
//  the CLI — see NATIVE_FEATURES.md).
//

import Foundation

/// The App Group container id. MUST match:
///   - the App Group capability on the main app + every extension (Xcode), and
///   - `WIDGET_APP_GROUP` in native-bridge.js.
public enum PsycleAppGroup {
    public static let id = "group.com.psyclefinder.app"
}

/// The bare keys native-bridge.js writes into the App Group suite.
public enum PsycleSnapshotKey {
    public static let nextClass = "widget_next_class"
    public static let week = "widget_week"
    public static let upcoming = "widget_upcoming"
}

/// One upcoming class. Mirrors the JS `widget_next_class` shape.
public struct PsycleNextClass: Codable, Equatable {
    public let eventId: String
    public let startAt: String   // ISO-8601 string, e.g. "2026-06-15T18:30:00Z"
    public let instrName: String
    public let typeName: String
    public let studioName: String
    public let locName: String
    public let slots: [Int]

    /// Parsed start date, or nil if the ISO string can't be parsed.
    public var startDate: Date? {
        PsycleDateParser.parse(startAt)
    }

    /// "Bike 12 & 14" / "Bed 3" — label depends on class type, matching the
    /// web app's slotLabel() logic.
    public var slotSummary: String? {
        guard !slots.isEmpty else { return nil }
        let label = PsycleSlotLabel.label(for: typeName)
        let nums = slots.map(String.init).joined(separator: " & ")
        return slots.count == 1 ? "\(label) \(nums)" : "\(label)s \(nums)"
    }
}

/// One day in the "this week" bucket list. Mirrors JS `widget_week` entries.
public struct PsycleWeekDay: Codable, Equatable {
    public let day: String        // local "YYYY-MM-DD"
    public let count: Int
    public let firstStart: String // ISO-8601 string

    public var date: Date? {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = .current
        return f.date(from: day)
    }
}

/// Class-type → slot label, mirroring native-bridge.js `_nativeSlotLabel`.
public enum PsycleSlotLabel {
    public static func label(for typeName: String) -> String {
        let n = typeName.uppercased()
        if n.contains("LAGREE") || n.contains("MEGAFORMER") { return "Machine" }
        if n.contains("REFORMER") { return "Bed" }
        if n.contains("RIDE") { return "Bike" }
        if n.contains("PILATES") { return "Bed" }
        if n.contains("STRENGTH") || n.contains("LIFT") || n.contains("WEIGHTS") || n.contains("TREAD") { return "Bench" }
        return "Spot"
    }
}

/// Tolerant ISO-8601 parsing (handles fractional seconds + plain forms).
public enum PsycleDateParser {
    public static func parse(_ iso: String) -> Date? {
        let f1 = ISO8601DateFormatter()
        f1.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f1.date(from: iso) { return d }
        let f2 = ISO8601DateFormatter()
        f2.formatOptions = [.withInternetDateTime]
        if let d = f2.date(from: iso) { return d }
        // Fallback: "yyyy-MM-dd'T'HH:mm:ss" without zone -> assume current TZ.
        let f3 = DateFormatter()
        f3.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        f3.timeZone = .current
        if let d = f3.date(from: iso) { return d }
        // Last resort: the API's raw space-separated form, in case an
        // un-normalized value ever reaches the snapshot.
        let f4 = DateFormatter()
        f4.dateFormat = "yyyy-MM-dd HH:mm:ss"
        f4.timeZone = .current
        return f4.date(from: iso)
    }
}

/// Reads the snapshot the web app persisted into the shared App Group.
public enum PsycleSnapshotStore {

    /// Shared defaults for the App Group. nil only if the App Group
    /// capability/id is misconfigured (see NATIVE_FEATURES.md).
    public static var defaults: UserDefaults? {
        UserDefaults(suiteName: PsycleAppGroup.id)
    }

    /// The next upcoming class, or nil if none / not yet written.
    public static func nextClass() -> PsycleNextClass? {
        guard let raw = string(forKey: PsycleSnapshotKey.nextClass),
              let data = raw.data(using: .utf8) else { return nil }
        // JS writes the literal string "null" when there's no next class.
        if raw == "null" { return nil }
        return try? JSONDecoder().decode(PsycleNextClass.self, from: data)
    }

    /// This week's day buckets (possibly empty).
    public static func week() -> [PsycleWeekDay] {
        guard let raw = string(forKey: PsycleSnapshotKey.week),
              let data = raw.data(using: .utf8) else { return [] }
        return (try? JSONDecoder().decode([PsycleWeekDay].self, from: data)) ?? []
    }

    /// First class starting after `date`, from the multi-class list. Use
    /// this instead of nextClass() for anything time-sensitive: the single
    /// next_class key is a snapshot from the LAST time the app wrote it and
    /// can point at a class that has since passed, while the list usually
    /// still contains the real next one.
    public static func firstClass(startingAfter date: Date) -> (klass: PsycleNextClass, start: Date)? {
        upcoming()
            .compactMap { c in c.startDate.map { (c, $0) } }
            .filter { $0.1 > date }
            .sorted { $0.1 < $1.1 }
            .first
    }

    /// The next few classes (up to 5) for the widget's self-advancing
    /// timeline. Falls back to the single next class for snapshots written
    /// by older app builds.
    public static func upcoming() -> [PsycleNextClass] {
        if let raw = string(forKey: PsycleSnapshotKey.upcoming),
           let data = raw.data(using: .utf8),
           let list = try? JSONDecoder().decode([PsycleNextClass].self, from: data),
           !list.isEmpty {
            return list
        }
        return nextClass().map { [$0] } ?? []
    }

    /// Reads a key from the App Group suite. The LIVE path is the bare key:
    /// native-bridge.js writes it via the in-app AppGroupPreferences plugin
    /// straight into UserDefaults(suiteName: PsycleAppGroup.id). The two
    /// namespaced lookups are purely defensive — the standard Capacitor
    /// Preferences plugin writes to UserDefaults.standard (its "group" is a
    /// key prefix, NOT a suite), so its values never appear here; these
    /// fallbacks only matter if a future migration copies prefixed keys in.
    private static func string(forKey key: String) -> String? {
        guard let d = defaults else { return nil }
        if let v = d.string(forKey: key) { return v }
        if let v = d.string(forKey: "\(PsycleAppGroup.id).\(key)") { return v }
        return d.string(forKey: "PsycleFinderSettings.\(key)")
    }
}
