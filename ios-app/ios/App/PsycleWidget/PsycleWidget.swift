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
//  3. Add THIS file, PsyclePictogram.swift, PsycleWidgetStyle.swift,
//     PsycleWidgetLayouts.swift and PsycleShared/*.swift to the new widget
//     target's membership (wire_native_targets.rb does all of it).
//  4. Add the App Group capability (group.com.psyclefinder.app) to the
//     widget target (Signing & Capabilities ▸ + App Groups).
//  See NATIVE_FEATURES.md for the full ordered checklist.
//
//  This file is the plumbing: the timeline, which layout a family gets, the
//  deep link. What the widget LOOKS like is PsycleWidgetLayouts.swift (the
//  layouts), PsycleWidgetStyle.swift (colours per rendering mode, tile, chip,
//  the time face) and PsyclePictogram.swift (the class-type marks).
//
//  Requires iOS 14+ for WidgetKit; the countdown text style is iOS 15+. The
//  Lock Screen accessories, ViewThatFits, the condensed font width and
//  widgetRenderingMode are iOS 16 — inside the extension target's 16.1 floor,
//  so they need no availability checks.
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
        // MULTI-ENTRY timeline: every upcoming class in turn, each becoming
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

        // The dates are PsycleTimelinePlan's (PsycleSnapshot.swift): strictly
        // increasing, each class once more AT its start — the entry that turns
        // the countdown into "Now" instead of letting it count up — and the
        // empty state once the last known class has started.
        let entries = PsycleTimelinePlan.steps(starts: upcoming.map { $0.1 }, now: now).map { step in
            PsycleEntry(date: step.date, nextClass: step.index.map { upcoming[$0].0 }, weekCount: week)
        }

        // Periodic refresh keeps the data honest even without app nudges —
        // and a reload is also this extension's chance to retire the Live
        // Activity card of a class that has started (the owner's rule: it goes
        // about five minutes after the start). So ask to be reloaded just
        // after the next "start + 5 min" when that comes sooner. The started
        // classes are read from the unfiltered list: the one that began a
        // minute ago is exactly the one whose card is still up.
        let allStarts = PsycleSnapshotStore.upcoming().compactMap { $0.startDate }
        var reload = now.addingTimeInterval(30 * 60)
        if let check = PsycleLiveActivityRetirement.nextCheck(starts: allStarts, now: now), check < reload {
            reload = check
        }
        let timeline = Timeline(entries: entries, policy: .after(reload))

        // Retire BEFORE completing: the extension may be suspended as soon as
        // the timeline is handed over, and an end that has not landed leaves
        // the card up. Never touches a card that is still counting down.
        if #available(iOS 16.1, *) {
            Task {
                await PsycleLiveActivityRetirement.retire(now: now, endUnstarted: false)
                completion(timeline)
            }
        } else {
            completion(timeline)
        }
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
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.widgetRenderingMode) private var renderingMode
    @Environment(\.displayScale) private var displayScale
    var entry: PsycleEntry

    var body: some View {
        Group {
            switch family {
            case .systemMedium:
                homeScreen { surface in
                    PsycleMediumLayout(facts: facts, now: entry.date, weekCount: entry.weekCount, surface: surface)
                }
            case .accessoryRectangular:
                rectangularView
            case .accessoryInline:
                inlineView
            default:
                homeScreen { surface in
                    PsycleSmallLayout(facts: facts, now: entry.date, surface: surface)
                }
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

    private var facts: PsycleClassFacts? { entry.nextClass.map(PsycleClassFacts.init) }

    // MARK: Home Screen

    /// A Home Screen family on its class-tinted ground. The surface — ground,
    /// inks, tile, chip — is settled here, once, from the class's colours, the
    /// appearance and how the system is drawing the widget: full colour, full
    /// colour with the background taken away (StandBy), or recoloured
    /// (accented / vibrant), where a fill under a mark would be one blob.
    private func homeScreen<Content: View>(@ViewBuilder _ layout: @escaping (PsycleSurface) -> Content) -> some View {
        PsycleBackgroundProbe { showsBackground in
            let surface = self.surface(showsBackground: showsBackground)
            layout(surface).psycleCard(surface.card)
        }
    }

    private func surface(showsBackground: Bool) -> PsycleSurface {
        let dark = colorScheme == .dark
        let flat = renderingMode != .fullColor
        guard let next = entry.nextClass else {
            return PsycleSurface.neutral(dark: dark, flat: flat, showsBackground: showsBackground)
        }
        return PsycleSurface.resolve(palette: next.palette, dark: dark, flat: flat, showsBackground: showsBackground)
    }

    // MARK: Lock Screen

    // No padding on either accessory: the system insets them itself and
    // there is no height to give away. The layouts live in
    // PsycleWidgetLayouts.swift (PsycleRectangularAccessory / PsycleInlineAccessory).
    private var rectangularView: some View {
        Group {
            if let next = entry.nextClass {
                PsycleRectangularAccessory(type: next.classType,
                                           title: next.typeName,
                                           when: next.startDate,
                                           seat: next.slotSummary,
                                           place: next.locName.isEmpty ? next.studioName : next.locName)
            } else {
                Text("No upcoming class")
                    .font(.headline)
                    .widgetAccentable()
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .accessoryContainerBackground()
    }

    // @MainActor spelled out: PsycleGlyph draws with ImageRenderer. (`body` is
    // main-actor everywhere; a helper property only is from the iOS 18 SDK on.)
    @MainActor
    private var inlineView: some View {
        Group {
            if let next = entry.nextClass {
                PsycleInlineAccessory(title: next.typeName,
                                      when: next.startDate,
                                      now: entry.date,
                                      glyph: PsycleGlyph.template(next.classType, size: 15, scale: displayScale))
            } else {
                Text("No upcoming class")
            }
        }
        .accessoryContainerBackground()
    }
}

// MARK: - Widget

struct PsycleWidget: Widget {
    let kind = "PsycleWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: PsycleProvider()) { entry in
            PsycleWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Next class")
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

extension PsycleNextClass {
    /// Sample data for the widget gallery / placeholder.
    static let preview = PsycleNextClass(
        eventId: "0",
        startAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(3600)),
        instrName: "Maya",
        typeName: "Ride",
        studioName: "Studio 1",
        locName: "Shoreditch",
        slots: [12]
    )
}

extension View {
    /// Lock Screen accessories draw straight onto the wallpaper. iOS 17 still
    /// demands the API (a widget without it renders the "please adopt
    /// containerBackground" placeholder), so adopt it with nothing inside — a
    /// filled panel would box the text in. (The Home Screen families' ground is
    /// `psycleCard` in PsycleWidgetStyle.swift.)
    @ViewBuilder
    func accessoryContainerBackground() -> some View {
        if #available(iOS 17.0, *) {
            self.containerBackground(for: .widget) { Color.clear }
        } else {
            self
        }
    }
}
