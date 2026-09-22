//
//  PsycleLiveActivityAttributes.swift
//  ActivityKit attributes shared between the app (which starts/updates the
//  activity) and the widget extension (which renders it).
//
//  ── HOW TO ADD IN XCODE ──────────────────────────────────────────────────
//  ActivityAttributes must be visible to BOTH the main app target (to call
//  start/update/end) and the Widget Extension target (to render the UI).
//  Add THIS file to BOTH targets' membership.
//
//  Requires iOS 16.1+ (ActivityKit). Also add `NSSupportsLiveActivities = YES`
//  to the MAIN APP Info.plist (see NATIVE_FEATURES.md).
//

import Foundation
#if os(iOS)
import ActivityKit
#else
// ActivityKit's types are unavailable on a Mac (the module imports; the
// protocol is marked unavailable — so this is os(iOS), not canImport).
// ios-app/native-checks/run.sh compiles THIS file there to prove that a payload
// written by the previous build still decodes, so it needs the protocol's shape
// and nothing else. Never part of an iOS build (same idea as the stand-in in
// PsycleLiveActivityController.swift).
public protocol ActivityAttributes: Codable {
    associatedtype ContentState: Codable, Hashable
}
#endif

@available(iOS 16.1, *)
public struct PsycleClassActivityAttributes: ActivityAttributes {

    /// Dynamic state pushed during the activity's lifetime.
    public struct ContentState: Codable, Hashable {
        /// When the class starts. Drives the live countdown (Text(timerInterval:)).
        public var startAt: Date
        /// Free-form status line, e.g. "Starting soon" or "In progress".
        public var status: String
        /// Seats as held NOW ("Bike 12", "Bikes 12 & 14"). Lives in the state,
        /// not only the attributes below, because seats change while the card
        /// is up ("+ Add spot", a single-seat cancel) and attributes are fixed
        /// at start. Optional so a card started by a build without it still
        /// decodes (synthesized Codable uses decodeIfPresent) — the view then
        /// falls back to attributes.slotSummary.
        public var slotSummary: String?
        /// The class type and the member's colours for it, as the snapshot has
        /// them NOW (they can change while the card is up: Membership → Class
        /// colours). Optional for the same reason as the seats: a card started
        /// by the previous build has no such key and must still decode — the
        /// view then works the type out from attributes.typeName and draws it
        /// in the app's default colours. Set after init, so the initializer
        /// (and every call site) stays as it was.
        public var style: PsycleClassStyle?

        public init(startAt: Date, status: String, slotSummary: String? = nil) {
            self.startAt = startAt
            self.status = status
            self.slotSummary = slotSummary
        }
    }

    // Static attributes set once when the activity starts.
    public let eventId: String
    public let typeName: String
    public let instrName: String
    public let locName: String
    public let slotSummary: String?

    public init(eventId: String,
                typeName: String,
                instrName: String,
                locName: String,
                slotSummary: String?) {
        self.eventId = eventId
        self.typeName = typeName
        self.instrName = instrName
        self.locName = locName
        self.slotSummary = slotSummary
    }
}

// MARK: - Retiring a card once its class has started

/// When a countdown card leaves the Lock Screen. The owner's rule: it goes by
/// itself about five minutes after the class's scheduled start.
///
/// iOS gives an app no way to say that up front: a Live Activity can only be
/// ended by code that is running, or by a push from a server (there is none).
/// So the rule is applied by WHOEVER next gets to run once the class has
/// started — the app (foreground, or its background refresh task) or the
/// widget extension (its timeline reload) — and what it does depends on when:
///  - before the start: nothing (`keep`);
///  - from the start until the grace is over: END the activity with
///    `dismissalPolicy: .after(start + grace)`, which hands the removal to the
///    SYSTEM — it takes the card down at that time with no process of ours
///    running (`dismissAt`);
///  - after that: remove it now (`removeNow`).
/// Lives in this file because it is the one Live Activity source that BOTH
/// targets compile. The verdict is pure so ios-app/native-checks can run it.
public enum PsycleLiveActivityRetirement {

    /// How long the card outlives the class's scheduled start.
    public static let graceAfterStart: TimeInterval = 5 * 60

    public enum Verdict: Equatable {
        case keep
        case dismissAt(Date)
        case removeNow
    }

    public static func verdict(start: Date, now: Date) -> Verdict {
        let goes = start.addingTimeInterval(graceAfterStart)
        if now >= goes { return .removeNow }
        if now >= start { return .dismissAt(goes) }
        return .keep
    }

    /// When a process that can retire cards should next ask to run: the
    /// earliest "start + grace" still ahead among `starts`, a few seconds late
    /// so the verdict is `removeNow` by then. nil when there is none.
    public static func nextCheck(starts: [Date], now: Date) -> Date? {
        starts
            .map { $0.addingTimeInterval(graceAfterStart + 5) }
            .filter { $0 > now }
            .min()
    }
}

#if os(iOS)
@available(iOS 16.1, *)
extension PsycleLiveActivityRetirement {

    /// Apply the verdict to every card that is up, and wait for the system to
    /// take each end (a background task or a timeline reload that returns
    /// first is suspended mid-flight and the card stays). Returns how many
    /// cards it acted on.
    ///
    /// `endUnstarted`: true only where the caller has just established that
    /// NOTHING should be showing (the app's own reconcile: the booking went,
    /// or the class moved out of the lead window) — then a card whose class
    /// has not started goes at once too. The background task and the widget
    /// pass false: they must never take down a countdown that is still due.
    @discardableResult
    public static func retire(now: Date = Date(), endUnstarted: Bool) async -> Int {
        var acted = 0
        for activity in Activity<PsycleClassActivityAttributes>.activities {
            let start: Date
            if #available(iOS 16.2, *) {
                start = activity.content.state.startAt
            } else {
                start = activity.contentState.startAt
            }
            let event = activity.attributes.eventId
            switch verdict(start: start, now: now) {
            case .keep:
                guard endUnstarted else { continue }
                NSLog("[PsycleLiveActivity] retire event=%@: nothing should be showing, removed", event)
                await end(activity, policy: .immediate)
            case .removeNow:
                NSLog("[PsycleLiveActivity] retire event=%@: started over five minutes ago, removed", event)
                await end(activity, policy: .immediate)
            case .dismissAt(let date):
                // Already handed to the system by an earlier run: ending it
                // again could only move the date.
                if activity.activityState == .ended || activity.activityState == .dismissed { continue }
                NSLog("[PsycleLiveActivity] retire event=%@: started, the system removes it in %.0f s", event, date.timeIntervalSince(now))
                await end(activity, policy: .after(date))
            }
            acted += 1
        }
        return acted
    }

    private static func end(_ activity: Activity<PsycleClassActivityAttributes>,
                            policy: ActivityUIDismissalPolicy) async {
        if #available(iOS 16.2, *) {
            // The card keeps its last content while the system holds it (the
            // "In class" look: staleDate is the start, which has passed).
            await activity.end(activity.content, dismissalPolicy: policy)
        } else {
            await activity.end(using: activity.contentState, dismissalPolicy: policy)
        }
    }
}
#endif
