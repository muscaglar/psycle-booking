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
                .padding()
                .activityBackgroundTint(Color.black.opacity(0.55))
                .activitySystemActionForegroundColor(Color.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(context.attributes.typeName, systemImage: "figure.indoor.cycle")
                        .font(.caption).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(timerInterval: countdownRange(to: context.state.startAt), countsDown: true)
                        .font(.system(.body, design: .rounded).weight(.semibold))
                        .monospacedDigit()
                        .frame(maxWidth: 64)
                        .multilineTextAlignment(.trailing)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(subtitle(context.attributes))
                        .font(.caption2)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
            } compactLeading: {
                Image(systemName: "figure.indoor.cycle")
            } compactTrailing: {
                Text(timerInterval: countdownRange(to: context.state.startAt), countsDown: true)
                    .monospacedDigit()
                    .frame(maxWidth: 44)
            } minimal: {
                Image(systemName: "figure.indoor.cycle")
            }
            .keylineTint(Color.psycleAccent)
        }
    }

    private func subtitle(_ a: PsycleClassActivityAttributes) -> String {
        var parts: [String] = []
        if !a.instrName.isEmpty { parts.append(a.instrName) }
        if !a.locName.isEmpty { parts.append(a.locName) }
        if let slot = a.slotSummary { parts.append(slot) }
        return parts.joined(separator: " · ")
    }
}

@available(iOS 16.1, *)
private struct LockScreenLiveActivityView: View {
    let context: ActivityContext<PsycleClassActivityAttributes>

    var body: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Text(context.attributes.typeName)
                    .font(.headline)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                Text(context.state.status)
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: 2) {
                Text(timerInterval: countdownRange(to: context.state.startAt), countsDown: true)
                    .font(.system(.title2, design: .rounded).weight(.bold))
                    .monospacedDigit()
                    .foregroundColor(.psycleAccent)
                    .frame(maxWidth: 90)
                Text("until class")
                    .font(.system(size: 9))
                    .foregroundColor(.secondary)
            }
        }
    }

    private var subtitle: String {
        var parts: [String] = []
        if !context.attributes.instrName.isEmpty { parts.append(context.attributes.instrName) }
        if !context.attributes.locName.isEmpty { parts.append(context.attributes.locName) }
        if let slot = context.attributes.slotSummary { parts.append(slot) }
        return parts.joined(separator: " · ")
    }
}

// Type alias so the view signatures stay readable across iOS versions.
@available(iOS 16.1, *)
private typealias ActivityContext<T: ActivityAttributes> = ActivityViewContext<T>

/// ClosedRange for Text(timerInterval:) that can never trap: the card stays
/// visible for up to ~60s AFTER class start (the controller's dismissal
/// cushion), and Date()...startAt with Date() > startAt violates the range
/// precondition and would crash the extension on any re-render in that
/// window. Clamped, it renders 0:00 instead.
@available(iOS 16.1, *)
private func countdownRange(to startAt: Date) -> ClosedRange<Date> {
    min(Date(), startAt)...startAt
}
