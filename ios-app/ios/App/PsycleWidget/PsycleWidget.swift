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
//  Requires iOS 14+ for WidgetKit; the countdown text style is iOS 15+.
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
        switch family {
        case .systemMedium:
            mediumView
        default:
            smallView
        }
    }

    // MARK: Small

    private var smallView: some View {
        VStack(alignment: .leading, spacing: 6) {
            header
            Spacer(minLength: 0)
            if let next = entry.nextClass {
                Text(next.typeName)
                    .font(.headline)
                    .lineLimit(1)
                if !next.instrName.isEmpty {
                    Text(next.instrName)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
                countdown(for: next)
            } else {
                Text("No upcoming class")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
        }
        .padding()
        .widgetContainerBackground()
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

    private var header: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(Color.psycleAccent)
                .frame(width: 7, height: 7)
            Text("NEXT CLASS")
                .font(.system(size: 10, weight: .bold))
                .foregroundColor(.secondary)
                .tracking(0.5)
        }
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
        .supportedFamilies([.systemSmall, .systemMedium])
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
}
