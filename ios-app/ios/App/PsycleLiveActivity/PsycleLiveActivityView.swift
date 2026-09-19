//
//  PsycleLiveActivityView.swift
//  Lock-screen + Dynamic Island UI for the next-class Live Activity.
//
//  ── HOW TO ADD IN XCODE ──────────────────────────────────────────────────
//  This file declares a `Widget` (ActivityConfiguration) and so belongs in
//  the **Widget Extension** target (alongside PsycleWidget.swift). Add it to
//  the Widget Extension target membership, and add it to the extension's
//  WidgetBundle:
//
//      @main
//      struct PsycleWidgetBundle: WidgetBundle {
//          var body: some Widget {
//              PsycleWidget()
//              if #available(iOS 16.1, *) { PsycleLiveActivityWidget() }
//          }
//      }
//
//  (Update the @main bundle in PsycleWidget.swift accordingly — left as a
//  manual step so the two files stay independent.)
//
//  The Crisp Colour look: the class type's pictogram in its tile, the start
//  time in 24-hour digits, the class colour as the accent. The card itself is
//  PsycleActivityCard (PsycleWidget/PsycleWidgetLayouts.swift); this file
//  adapts the ActivityKit context to it and lays out the Dynamic Island.
//
//  Requires iOS 16.1+.
//

import SwiftUI
import WidgetKit
import ActivityKit

@available(iOS 16.1, *)
struct PsycleLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: PsycleClassActivityAttributes.self) { context in
            // Lock screen / banner presentation.
            LockScreenLiveActivityView(context: context)
        } dynamicIsland: { context in
            // The island is always black: the dark side of the class colours,
            // a solid tile (base fill, white mark), the system's light inks.
            let look = classLook(context)
            let surface = PsycleSurface.resolve(palette: look.palette, dark: true, flat: false,
                                                showsBackground: false, solidTile: true)
            let hue = Color(look.palette.dark.deep)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    PsycleTypeTile(type: look.type, size: 40, surface: surface)
                        .padding(.leading, 2)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.attributes.typeName)
                        .font(PsycleFace.text(.headline, weight: .bold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 0) {
                        Text(PsycleClock.time(context.state.startAt))
                            .font(PsycleFace.time(26))
                            .lineLimit(1)
                        if classStarted(context) {
                            Text("In class")
                                .font(PsycleFace.label(14))
                                .foregroundColor(hue)
                        } else {
                            Text(timerInterval: countdownRange(to: context.state.startAt), countsDown: true)
                                .font(PsycleFace.label(14))
                                .monospacedDigit()
                                .foregroundColor(hue)
                                .frame(maxWidth: 64)
                                .multilineTextAlignment(.trailing)
                        }
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(alignment: .center, spacing: 8) {
                        Text(subtitle(context))
                            .font(PsycleFace.text(.footnote))
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                        // State first: seats can change while the card is up.
                        if let seat = context.state.slotSummary ?? context.attributes.slotSummary {
                            // A long "Instructor · Studio" gives way, never the seat.
                            PsycleSeatChip(text: seat, surface: surface, compact: true)
                                .layoutPriority(1)
                        }
                    }
                }
            } compactLeading: {
                PsycleTypeTile(type: look.type, size: 22, surface: surface)
            } compactTrailing: {
                if classStarted(context) {
                    Text("Now")
                        .font(PsycleFace.label(15))
                        .foregroundColor(hue)
                } else {
                    Text(timerInterval: countdownRange(to: context.state.startAt), countsDown: true)
                        .font(PsycleFace.label(15))
                        .monospacedDigit()
                        .foregroundColor(hue)
                        .frame(maxWidth: 44)
                }
            } minimal: {
                PsycleTypeTile(type: look.type, size: 22, surface: surface)
            }
            .keylineTint(Color(look.palette.dark.base))
        }
    }

    /// "Instructor · Studio". (The seat is drawn beside it, as a chip.)
    private func subtitle(_ context: ActivityContext<PsycleClassActivityAttributes>) -> String {
        let a = context.attributes
        return [a.instrName, a.locName].filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

@available(iOS 16.1, *)
private struct LockScreenLiveActivityView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.widgetRenderingMode) private var renderingMode
    let context: ActivityContext<PsycleClassActivityAttributes>

    var body: some View {
        let look = classLook(context)
        // StandBy takes the card's background away; a recoloured rendering
        // (accented / vibrant) throws the colours away. PsycleSurface settles
        // the inks for each, as it does for the widgets.
        PsycleBackgroundProbe { showsBackground in
            let surface = PsycleSurface.resolve(palette: look.palette,
                                                dark: colorScheme == .dark,
                                                flat: renderingMode != .fullColor,
                                                showsBackground: showsBackground)
            PsycleActivityCard(facts: PsycleClassFacts(type: look.type,
                                                       title: context.attributes.typeName,
                                                       instructor: context.attributes.instrName,
                                                       place: context.attributes.locName,
                                                       // State first: seats can change while the card is up (see ContentState).
                                                       seat: context.state.slotSummary ?? context.attributes.slotSummary,
                                                       start: context.state.startAt),
                               started: classStarted(context),
                               countdown: countdownRange(to: context.state.startAt),
                               surface: surface)
                // The ground is painted here, with the inks (psycleActivityGround
                // says why); the tint stays only as the hint underneath it.
                .psycleActivityGround(surface.card)
                .activityBackgroundTint(surface.card)
                .activitySystemActionForegroundColor(surface.ink)
        }
    }
}

// Type alias so the view signatures stay readable across iOS versions.
@available(iOS 16.1, *)
private typealias ActivityContext<T: ActivityAttributes> = ActivityViewContext<T>

/// The class type and its colours. From the state when it carries them (the
/// member's own, as of the last snapshot); a card started by a build from
/// before they existed has none — the type is then read off the class name
/// and drawn in the app's default colours.
@available(iOS 16.1, *)
private func classLook(_ context: ActivityContext<PsycleClassActivityAttributes>) -> (type: PsycleClassType, palette: PsycleClassPalette) {
    let style = context.state.style ?? PsycleClassStyle()
    let typeName = context.attributes.typeName
    return (style.classType(typeName: typeName), style.palette(typeName: typeName))
}

/// Has the class started? staleDate = classStart makes the system re-render
/// the card at T0 with isStale = true — no process needed. The Date()
/// comparison is the 16.1 fallback (no staleness there, so it only updates
/// on whatever re-render happens naturally).
@available(iOS 16.1, *)
private func classStarted(_ context: ActivityContext<PsycleClassActivityAttributes>) -> Bool {
    if #available(iOS 16.2, *), context.isStale { return true }
    return context.state.startAt <= Date()
}

/// ClosedRange for Text(timerInterval:) that can never trap: the card can
/// be rendered after class start (16.1 has no staleness, and even on 16.2
/// classStarted()'s Date() and this Date() race by an instant), and
/// Date()...startAt with Date() > startAt violates the range precondition —
/// an extension crash. Clamped, it renders 0:00 instead.
@available(iOS 16.1, *)
private func countdownRange(to startAt: Date) -> ClosedRange<Date> {
    min(Date(), startAt)...startAt
}
