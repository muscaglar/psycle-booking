//
//  PsycleWidget.swift
//  WidgetKit widget showing the next Psycle class + a live countdown.
//
//  ── HOW TO ADD IN XCODE ──────────────────────────────────────────────────
//  1. File ▸ New ▸ Target… ▸ "Widget Extension" (uncheck "Include Live
//     Activity" here — Live Activity lives in the main app target).
//     Name it e.g. "PsycleWidgetExtension".
//  2. DELETE the auto-generated <Name>.swift / bundle file Xcode creates, or
//     keep only ONE @main entry point — this file declares @main.
//  3. Add THIS file and PsycleShared/PsycleSnapshot.swift to the new widget
//     target's membership.
//  4. Add the App Group capability (group.com.psyclefinder.app) to the
//     widget target (Signing & Capabilities ▸ + App Groups).
//  See NATIVE_FEATURES.md for the full ordered checklist.
//
//  Requires iOS 14+ for WidgetKit; the countdown text style is iOS 15+. The
//  Lock Screen accessories and ViewThatFits are iOS 16 — inside the
//  extension target's 16.1 floor, so they need no availability checks.
//

import WidgetKit
import SwiftUI

// MARK: - Timeline Entry

struct PsycleEntry: TimelineEntry {
    let date: Date
    let nextClass: PsycleNextClass?
    let weekCount: Int
}

// MARK: - Timeline Provider

struct PsycleProvider: TimelineProvider {

    func placeholder(in context: Context) -> PsycleEntry {
        PsycleEntry(date: Date(), nextClass: .preview, weekCount: 3)
    }

    func getSnapshot(in context: Context, completion: @escaping (PsycleEntry) -> Void) {
        completion(currentEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<PsycleEntry>) -> Void) {
        // MULTI-ENTRY timeline: one entry per upcoming class, each becoming
        // current a minute after the previous class starts — so the widget
        // rolls to the next class BY ITSELF, with no process running. (The
        // snapshot data itself still only changes when the app runs; the app
        // nudges WidgetCenter.reloadAllTimelines() on booking changes.)
        let now = Date()
        let week = PsycleSnapshotStore.week().reduce(0) { $0 + $1.count }

        let upcoming = PsycleSnapshotStore.upcoming()
            .compactMap { c in c.startDate.map { (c, $0) } }
            .filter { $0.1 > now }
            .sorted { $0.1 < $1.1 }

        var entries: [PsycleEntry] = []
        var entryDate = now
        for (klass, start) in upcoming {
            entries.append(PsycleEntry(date: entryDate, nextClass: klass, weekCount: week))
            // Strictly increasing dates: two same-time classes (possible —
            // e.g. simultaneous slots at two studios) would otherwise emit
            // duplicate entry dates and one would shadow the other.
            entryDate = max(start.addingTimeInterval(60), entryDate.addingTimeInterval(1))
        }
        // After the last known class starts: show the empty state instead of
        // a stale "Now" forever.
        entries.append(PsycleEntry(date: entryDate, nextClass: nil, weekCount: week))

        // Periodic refresh keeps the data honest even without app nudges.
        completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(30 * 60))))
    }

    private func currentEntry() -> PsycleEntry {
        // Stale-tolerant (same reasoning as the timeline): don't show a
        // passed class in the gallery/transient snapshot.
        let next = PsycleSnapshotStore.firstClass(startingAfter: Date())?.klass
        let week = PsycleSnapshotStore.week().reduce(0) { $0 + $1.count }
        return PsycleEntry(date: Date(), nextClass: next, weekCount: week)
    }
}

// MARK: - View

struct PsycleWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family
    var entry: PsycleEntry

    var body: some View {
        Group {
            switch family {
            case .systemMedium:
                mediumView
            case .accessoryRectangular:
                rectangularView
            case .accessoryInline:
                inlineView
            default:
                smallView
            }
        }
        .widgetURL(deepLink)
    }

    /// psync://bookings?event=<id>. The app routes it like a class-reminder
    /// tap: My Bookings, then that class's sheet. With no class there is no
    /// id and it is just My Bookings. The scheme is deliberately NOT declared
    /// in Info.plist — WidgetKit hands a widgetURL straight to the containing
    /// app, and leaving it unregistered means no other app can open it.
    private var deepLink: URL? {
        var link = URLComponents()
        link.scheme = "psync"
        link.host = "bookings"
        if let id = entry.nextClass?.eventId, !id.isEmpty {
            link.queryItems = [URLQueryItem(name: "event", value: id)]
        }
        return link.url
    }

    // MARK: Small

    private var smallView: some View {
        // Tallest layout first. The instructor is the row to lose when the
        // widget is short (small phones): the day, time and place are what
        // the countdown alone could never tell you.
        ViewThatFits(in: .vertical) {
            smallStack(showInstructor: true)
            smallStack(showInstructor: false)
        }
        .widgetLegacyPadding()
        .widgetContainerBackground()
    }

    private func smallStack(showInstructor: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            smallHeader(slot: entry.nextClass?.slotSummary)
            Spacer(minLength: 0)
            if let next = entry.nextClass {
                Text(next.typeName)
                    .font(.headline)
                    .lineLimit(1)
                if showInstructor && !next.instrName.isEmpty {
                    Text(next.instrName)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
                whenWhere(next)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                countdown(for: next)
            } else {
                Text("No upcoming class")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
        }
    }

    // MARK: Lock Screen

    // No padding on either accessory: the system insets them itself and
    // there is no height to give away.
    private var rectangularView: some View {
        VStack(alignment: .leading, spacing: 1) {
            if let next = entry.nextClass {
                Text(next.typeName)
                    .font(.headline)
                    .lineLimit(1)
                    .widgetAccentable()
                if let start = next.startDate {
                    Text(start, format: .dateTime.weekday().hour().minute())
                        .font(.subheadline)
                        .lineLimit(1)
                }
                Text(placeLine(next))
                    .font(.caption)
                    .lineLimit(1)
            } else {
                Text("No upcoming class")
                    .font(.headline)
                    .widgetAccentable()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessoryContainerBackground()
    }

    // One line above the clock, cut off at the tail when long — so the time
    // leads and it is the class name that gets trimmed, never the hour.
    private var inlineView: some View {
        Group {
            if let next = entry.nextClass, let start = next.startDate {
                Text("\(start, format: .dateTime.weekday().hour().minute()) · \(next.typeName)")
            } else if let next = entry.nextClass {
                Text(next.typeName)
            } else {
                Text("No upcoming class")
            }
        }
        .accessoryContainerBackground()
    }

    // MARK: Medium

    private var mediumView: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                header
                Spacer(minLength: 0)
                if let next = entry.nextClass {
                    Text(next.typeName)
                        .font(.headline)
                        .lineLimit(1)
                    Text(secondaryLine(next))
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                } else {
                    Text("No upcoming class")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
            }
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: 6) {
                if let next = entry.nextClass {
                    countdown(for: next)
                    if let start = next.startDate {
                        Text(start, format: .dateTime.weekday().hour().minute())
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                }
                Spacer(minLength: 0)
                if entry.weekCount > 0 {
                    Text("\(entry.weekCount) this week")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding()
        .widgetContainerBackground()
    }

    // MARK: Pieces

    private var accentDot: some View {
        Circle()
            .fill(Color.psycleAccent)
            .frame(width: 7, height: 7)
    }

    private var header: some View {
        HStack(spacing: 4) {
            accentDot
            Text("NEXT CLASS")
                .font(.system(size: 10, weight: .bold))
                .foregroundColor(.secondary)
                .tracking(0.5)
        }
    }

    /// The small widget has no row to spare for the bike, so it rides in the
    /// header opposite the label. When the two don't fit side by side
    /// ("Bikes 12 & 14" on a narrow phone) the label goes, not the bike — a
    /// clipped bike number is worse than a missing "NEXT CLASS".
    @ViewBuilder
    private func smallHeader(slot: String?) -> some View {
        if let slot = slot {
            let bike = Text(slot)
                .font(.system(size: 10, weight: .bold))
                .foregroundColor(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 4) {
                    header
                    Spacer(minLength: 6)
                    bike
                }
                HStack(spacing: 4) {
                    accentDot
                    Spacer(minLength: 6)
                    bike
                }
            }
        } else {
            header
        }
    }

    /// "Thu 07:00 · Bank" on one line. Same device-local formatting as the
    /// medium widget's time, so the two families can never disagree.
    private func whenWhere(_ next: PsycleNextClass) -> Text {
        let place = next.locName.isEmpty ? next.studioName : next.locName
        guard let start = next.startDate else { return Text(place) }
        if place.isEmpty {
            return Text(start, format: .dateTime.weekday().hour().minute())
        }
        return Text("\(start, format: .dateTime.weekday().hour().minute()) · \(place)")
    }

    @ViewBuilder
    private func countdown(for next: PsycleNextClass) -> some View {
        if let start = next.startDate {
            if start > entry.date {
                // Live ticking relative time, e.g. "in 2 hr".
                Text(start, style: .relative)
                    .font(.system(.title3, design: .rounded).weight(.bold))
                    .foregroundColor(.psycleAccent)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            } else {
                Text("Now")
                    .font(.system(.title3, design: .rounded).weight(.bold))
                    .foregroundColor(.psycleAccent)
            }
        }
    }

    private func secondaryLine(_ next: PsycleNextClass) -> String {
        var parts: [String] = []
        if !next.instrName.isEmpty { parts.append(next.instrName) }
        let place = next.locName.isEmpty ? next.studioName : next.locName
        if !place.isEmpty { parts.append(place) }
        if let slot = next.slotSummary { parts.append(slot) }
        return parts.joined(separator: " · ")
    }

    /// "Bank · Bike 12" — where to be, without the instructor: the Lock
    /// Screen row has no room for all three.
    private func placeLine(_ next: PsycleNextClass) -> String {
        var parts: [String] = []
        let place = next.locName.isEmpty ? next.studioName : next.locName
        if !place.isEmpty { parts.append(place) }
        if let slot = next.slotSummary { parts.append(slot) }
        return parts.joined(separator: " · ")
    }
}

// MARK: - Widget

struct PsycleWidget: Widget {
    let kind = "PsycleWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: PsycleProvider()) { entry in
            PsycleWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Next Psycle Class")
        .description("Shows your next booked class and a countdown.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
    }
}

// MARK: - Widget bundle (@main entry point for the extension)

@main
struct PsycleWidgetBundle: WidgetBundle {
    var body: some Widget {
        PsycleWidget()
        if #available(iOS 16.1, *) {
            PsycleLiveActivityWidget()
        }
    }
}

// MARK: - Helpers

extension Color {
    /// The app accent (#e94560).
    static let psycleAccent = Color(red: 233 / 255, green: 69 / 255, blue: 96 / 255)
}

extension PsycleNextClass {
    /// Sample data for the widget gallery / placeholder.
    static let preview = PsycleNextClass(
        eventId: "0",
        startAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(3600)),
        instrName: "Sample Instructor",
        typeName: "Ride",
        studioName: "Studio 1",
        locName: "Shoreditch",
        slots: [12]
    )
}

extension View {
    /// containerBackground is required on iOS 17 for Home Screen widgets and
    /// unavailable earlier — branch so the same code builds for iOS 14–16.
    @ViewBuilder
    func widgetContainerBackground() -> some View {
        if #available(iOS 17.0, *) {
            self.containerBackground(.fill.tertiary, for: .widget)
        } else {
            self
        }
    }

    /// Lock Screen accessories draw straight onto the wallpaper. iOS 17 still
    /// demands the API (a widget without it renders the "please adopt
    /// containerBackground" placeholder), so adopt it with nothing inside — a
    /// filled panel would box the text in.
    @ViewBuilder
    func accessoryContainerBackground() -> some View {
        if #available(iOS 17.0, *) {
            self.containerBackground(for: .widget) { Color.clear }
        } else {
            self
        }
    }

    /// iOS 17 insets widget content itself (content margins). Our own padding
    /// on top of that doubles the inset and starves the small layout of the
    /// height its extra row needs — so pad only where the system doesn't.
    @ViewBuilder
    func widgetLegacyPadding() -> some View {
        if #available(iOS 17.0, *) {
            self
        } else {
            self.padding()
        }
    }
}
