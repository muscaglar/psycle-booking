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
//  native-bridge.js writes three JSON strings into the shared App Group
//  defaults: `widget_next_class`, `widget_upcoming` and `widget_week`. See
//  NATIVE_FEATURES.md for how Capacitor Preferences maps onto
//  UserDefaults(suiteName:). Since the Crisp Colour look every entry may also
//  carry the class type and the member's colours (`ct`, `ctBase`, …): ALL
//  optional, read by PsycleClassStyle (PsycleClassType.swift) — a snapshot
//  written by a build without them decodes exactly as it always did.
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
    /// The class type and the member's colours for it — the snapshot's OPTIONAL
    /// `ct` / `ctBase` / `ctTint` / `ctDeep` (+ `…Dark`, `ctWash`, `ctIntensity`)
    /// fields. All empty for a snapshot written by a build that predates them;
    /// `classType` / `palette` then answer from the class name and the app's
    /// default colours, so such a snapshot still decodes and still draws.
    public let style: PsycleClassStyle

    public init(eventId: String,
                startAt: String,
                instrName: String,
                typeName: String,
                studioName: String,
                locName: String,
                slots: [Int],
                style: PsycleClassStyle = PsycleClassStyle()) {
        self.eventId = eventId
        self.startAt = startAt
        self.instrName = instrName
        self.typeName = typeName
        self.studioName = studioName
        self.locName = locName
        self.slots = slots
        self.style = style
    }

    private enum CodingKeys: String, CodingKey {
        case eventId, startAt, instrName, typeName, studioName, locName, slots
    }

    /// The seven original fields decode exactly as the synthesized decoder
    /// did. The colour fields sit FLAT beside them in the JSON and are read by
    /// PsycleClassStyle, which never throws over a missing or odd value — new
    /// fields must not be able to blank the widget.
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        eventId = try values.decode(String.self, forKey: .eventId)
        startAt = try values.decode(String.self, forKey: .startAt)
        instrName = try values.decode(String.self, forKey: .instrName)
        typeName = try values.decode(String.self, forKey: .typeName)
        studioName = try values.decode(String.self, forKey: .studioName)
        locName = try values.decode(String.self, forKey: .locName)
        slots = try values.decode([Int].self, forKey: .slots)
        style = (try? PsycleClassStyle(from: decoder)) ?? PsycleClassStyle()
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(eventId, forKey: .eventId)
        try values.encode(startAt, forKey: .startAt)
        try values.encode(instrName, forKey: .instrName)
        try values.encode(typeName, forKey: .typeName)
        try values.encode(studioName, forKey: .studioName)
        try values.encode(locName, forKey: .locName)
        try values.encode(slots, forKey: .slots)
        try style.encode(to: encoder)
    }

    /// Ride / Strength / … — for the pictogram.
    public var classType: PsycleClassType { style.classType(typeName: typeName) }

    /// The colours to draw this class in, light and dark.
    public var palette: PsycleClassPalette { style.palette(typeName: typeName) }

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
    /// Type + colours of the day's FIRST class (the one `firstStart` is) — the
    /// same optional `ct…` fields a class entry carries; empty for a snapshot
    /// written before they existed.
    public let style: PsycleClassStyle

    public init(day: String, count: Int, firstStart: String, style: PsycleClassStyle = PsycleClassStyle()) {
        self.day = day
        self.count = count
        self.firstStart = firstStart
        self.style = style
    }

    private enum CodingKeys: String, CodingKey {
        case day, count, firstStart
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        day = try values.decode(String.self, forKey: .day)
        count = try values.decode(Int.self, forKey: .count)
        firstStart = try values.decode(String.self, forKey: .firstStart)
        style = (try? PsycleClassStyle(from: decoder)) ?? PsycleClassStyle()
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(day, forKey: .day)
        try values.encode(count, forKey: .count)
        try values.encode(firstStart, forKey: .firstStart)
        try style.encode(to: encoder)
    }

    // Fixed locale + Gregorian calendar, like every other snapshot date: on
    // the user's own locale "2026" is year 2026 of THEIR calendar.
    private static let dayFormat = PsycleFixedFormat.formatter("yyyy-MM-dd")

    public var date: Date? { PsycleWeekDay.dayFormat.date(from: day) }
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
    // The bridge writes a ZONE-LESS wall time ("2026-09-24T18:30:00"), so in
    // practice every class is read by `wallTime` — the two ISO-8601 attempts
    // only catch a value that carries a zone. It must therefore be a
    // PsycleFixedFormat formatter: on the user's own locale this exact parse
    // returned nil on a 12-hour phone in a 24-hour region and a year in the
    // wrong era under a Buddhist / Islamic device calendar — every widget
    // empty. Still the DEVICE's zone, as before.
    private static let wallTime = PsycleFixedFormat.formatter("yyyy-MM-dd'T'HH:mm:ss")
    // Last resort: the API's raw space-separated form, in case an
    // un-normalized value ever reaches the snapshot.
    private static let rawWallTime = PsycleFixedFormat.formatter("yyyy-MM-dd HH:mm:ss")

    public static func parse(_ iso: String) -> Date? {
        let f1 = ISO8601DateFormatter()
        f1.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f1.date(from: iso) { return d }
        let f2 = ISO8601DateFormatter()
        f2.formatOptions = [.withInternetDateTime]
        if let d = f2.date(from: iso) { return d }
        if let d = wallTime.date(from: iso) { return d }
        return rawWallTime.date(from: iso)
    }
}

/// WHEN each class is the widget's current one: the dates of the widget's
/// self-advancing timeline, worked out apart from WidgetKit so that
/// ios-app/native-checks/run.sh can run the real arithmetic on a Mac.
public enum PsycleTimelinePlan {
    public struct Step: Equatable {
        /// When this entry becomes the current one.
        public let date: Date
        /// Index into the `starts` handed in; nil = the empty state.
        public let index: Int?
    }

    /// `starts`: the upcoming classes' start times, ascending, all after `now`.
    ///
    /// Each class gets an entry from the moment it is next, and — new — the
    /// SAME class again dated exactly at its start. The countdown line compares
    /// the class's start with its ENTRY's date (fixed when the timeline is
    /// built) and Text(.relative) shows a distance in either direction, so
    /// without that second entry the card read "in 5 sec", "in 40 sec" …
    /// counting UP for the minute after the class began. With it the line says
    /// "Now" for that minute. The next class still takes over at start + 60s,
    /// and the dates stay strictly increasing: two same-time classes (possible —
    /// simultaneous slots at two studios) would otherwise emit duplicate entry
    /// dates and one would shadow the other.
    public static func steps(starts: [Date], now: Date) -> [Step] {
        var steps: [Step] = []
        var entryDate = now
        for (index, start) in starts.enumerated() {
            steps.append(Step(date: entryDate, index: index))
            if start > entryDate {
                steps.append(Step(date: start, index: index))
            }
            entryDate = max(start.addingTimeInterval(60), entryDate.addingTimeInterval(1))
        }
        // After the last known class starts: the empty state instead of a
        // stale "Now" forever.
        steps.append(Step(date: entryDate, index: nil))
        return steps
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
