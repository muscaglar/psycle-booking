//
//  PsycleLiveActivityController.swift
//  Tiny Swift API the MAIN APP calls to schedule / clear the next-class
//  Live Activity (self-cleaning at class start — see refreshFromSnapshot).
//  Reads the same App Group snapshot the widget reads.
//
//  ── HOW TO ADD IN XCODE ──────────────────────────────────────────────────
//  Add this file to the MAIN APP target membership (NOT the extension —
//  starting/ending activities is the app's job). It also needs
//  PsycleLiveActivityAttributes.swift and PsycleShared/PsycleSnapshot.swift
//  in the app target.
//
//  ── HOW THE APP CALLS IT ────────────────────────────────────────────────
//  Two triggers, both required for reliability:
//   - AppDelegate.applicationDidBecomeActive (native, fires immediately on
//     foreground — but often against a STALE snapshot);
//   - the PsycleLiveActivityPlugin.refresh() nudge from native-bridge.js,
//     fired right after every fresh snapshot write (the one that actually
//     has current data on a cold open).
//
//  Requires iOS 16.1+.
//

import Foundation

#if canImport(ActivityKit)
import ActivityKit

@available(iOS 16.1, *)
public final class PsycleLiveActivityController {

    public static let shared = PsycleLiveActivityController()
    private init() {}

    /// Start a Live Activity within this many seconds before class start.
    /// Outside this window we don't show one (avoids a stale all-day banner).
    private let leadWindow: TimeInterval = 90 * 60   // 90 minutes

    private var current: Activity<PsycleClassActivityAttributes>? {
        Activity<PsycleClassActivityAttributes>.activities.first
    }

    /// Read the shared snapshot and reconcile the Live Activity.
    /// Call on app launch, foreground, booking changes, and from the
    /// background end-task.
    ///
    /// DESIGN (empirically constrained): iOS only lets an app REQUEST a
    /// Live Activity while foregrounded, and ending one removes its UI
    /// immediately — verified in the simulator: the request+end(.after:)
    /// trick presents nothing at all. So the card is requested ACTIVE when
    /// the app is opened inside the 90-min lead window, and cleanup at class
    /// start happens in three layers:
    ///  1. staleDate = classStart — at T0 the SYSTEM re-renders the card in
    ///     its stale state ("In class", see PsycleLiveActivityView) with no
    ///     process running;
    ///  2. a BGAppRefreshTask scheduled for classStart calls this method to
    ///     actually end/remove it (best-effort timing, usually minutes);
    ///  3. any app foreground past start ends it immediately.
    @discardableResult
    public func refreshFromSnapshot() -> Bool {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            NSLog("[PsycleLiveActivity] declined: Live Activities disabled in Settings")
            return false
        }

        let now = Date()

        // Pick the first FUTURE class from the multi-class list, not the
        // single next_class key — that key is whatever the app wrote last
        // session and may point at a class that has since passed, which
        // would wrongly clear the card instead of showing the real next one.
        guard let (next, start) = PsycleSnapshotStore.firstClass(startingAfter: now) else {
            NSLog("[PsycleLiveActivity] declined: no future class in snapshot")
            endAll() // cancelled / none upcoming — retract anything showing
            return false
        }

        let secondsUntil = start.timeIntervalSince(now)

        // Too far out — nothing should be showing yet.
        if secondsUntil > leadWindow {
            NSLog("[PsycleLiveActivity] declined: next class in %.0f min (window 90)", secondsUntil / 60)
            endAll()
            return false
        }

        let state = PsycleClassActivityAttributes.ContentState(
            startAt: start,
            status: "Starting soon"
        )

        if let activity = current, activity.attributes.eventId == next.eventId {
            // Same class — push the (possibly moved) start time into it.
            update(activity, state: state)
        } else {
            // Different class than what's showing. Synchronous in-flight
            // guard first: start() runs inside a detached Task, so two
            // rapid refresh calls (didBecomeActive + a future JS nudge)
            // could otherwise both see no current activity and stack
            // duplicate cards.
            guard requestingEventId != next.eventId else { return true }
            requestingEventId = next.eventId
            // End old, then start, serialized so the dying activity can't
            // race the new one.
            let stale = Activity<PsycleClassActivityAttributes>.activities
            Task {
                for activity in stale {
                    if #available(iOS 16.2, *) {
                        await activity.end(nil, dismissalPolicy: .immediate)
                    } else {
                        await activity.end(dismissalPolicy: .immediate)
                    }
                }
                self.start(next: next, state: state)
                self.requestingEventId = nil
            }
        }
        return true
    }

    /// Event id with a request currently in flight (see guard above).
    private var requestingEventId: String?

    /// Request an ACTIVE activity (presents on Lock Screen + Dynamic
    /// Island). staleDate = classStart flips it to the stale rendering at
    /// T0 without any process running.
    public func start(next: PsycleNextClass,
                      state: PsycleClassActivityAttributes.ContentState) {
        let attributes = PsycleClassActivityAttributes(
            eventId: next.eventId,
            typeName: next.typeName,
            instrName: next.instrName,
            locName: next.locName.isEmpty ? next.studioName : next.locName,
            slotSummary: next.slotSummary
        )
        do {
            if #available(iOS 16.2, *) {
                let content = ActivityContent(state: state, staleDate: state.startAt)
                let activity = try Activity.request(attributes: attributes, content: content, pushType: nil)
                NSLog("[PsycleLiveActivity] requested event=%@ active=%d", next.eventId, activity.activityState == .active ? 1 : 0)
            } else {
                _ = try Activity.request(attributes: attributes, contentState: state, pushType: nil)
            }
        } catch {
            NSLog("[PsycleLiveActivity] start failed: \(error.localizedDescription)")
        }
    }

    private func update(_ activity: Activity<PsycleClassActivityAttributes>,
                        state: PsycleClassActivityAttributes.ContentState) {
        Task {
            if #available(iOS 16.2, *) {
                let content = ActivityContent(state: state, staleDate: state.startAt)
                await activity.update(content)
            } else {
                await activity.update(using: state)
            }
        }
    }

    /// Awaitable variant for the background end-task: the BGTask must not
    /// be marked complete until the end IPC has actually landed, or iOS
    /// suspends the process first and the card stays up.
    public func endAllAndWait() async {
        for activity in Activity<PsycleClassActivityAttributes>.activities {
            if #available(iOS 16.2, *) {
                await activity.end(nil, dismissalPolicy: .immediate)
            } else {
                await activity.end(dismissalPolicy: .immediate)
            }
        }
    }

    /// End every running Psycle activity immediately.
    public func endAll() {
        for activity in Activity<PsycleClassActivityAttributes>.activities {
            Task {
                if #available(iOS 16.2, *) {
                    await activity.end(nil, dismissalPolicy: .immediate)
                } else {
                    await activity.end(dismissalPolicy: .immediate)
                }
            }
        }
    }
}

#else

// ActivityKit unavailable (e.g. older deployment target / non-iOS). Provide a
// no-op stand-in so call sites still compile.
public final class PsycleLiveActivityController {
    public static let shared = PsycleLiveActivityController()
    private init() {}
    @discardableResult public func refreshFromSnapshot() -> Bool { false }
    public func endAll() {}
}

#endif
