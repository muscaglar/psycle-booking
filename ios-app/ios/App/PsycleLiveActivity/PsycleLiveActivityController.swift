//
//  PsycleLiveActivityController.swift
//  Tiny Swift API the MAIN APP calls to start / update / end the next-class
//  Live Activity. Reads the same App Group snapshot the widget reads.
//
//  ── HOW TO ADD IN XCODE ──────────────────────────────────────────────────
//  Add this file to the MAIN APP target membership (NOT the extension —
//  starting/ending activities is the app's job). It also needs
//  PsycleLiveActivityAttributes.swift and PsycleShared/PsycleSnapshot.swift
//  in the app target.
//
//  ── HOW THE APP WOULD CALL IT ────────────────────────────────────────────
//  The web app drives bookings, so to actually trigger this you'd add a small
//  Capacitor plugin method (e.g. `PsycleLiveActivity.refresh()`) that calls
//  `PsycleLiveActivityController.shared.refreshFromSnapshot()`. Wiring that
//  plugin is a follow-up; this controller is the deliverable. See
//  NATIVE_FEATURES.md "Live Activity" section.
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
    private let leadWindow: TimeInterval = 2 * 60 * 60   // 2 hours

    private var current: Activity<PsycleClassActivityAttributes>? {
        Activity<PsycleClassActivityAttributes>.activities.first
    }

    /// Read the shared snapshot and reconcile the Live Activity:
    /// start one for an imminent class, update an existing one, or end it.
    /// Call this on app launch, on foreground, and after booking changes.
    @discardableResult
    public func refreshFromSnapshot() -> Bool {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return false }

        guard let next = PsycleSnapshotStore.nextClass(),
              let start = next.startDate else {
            endAll()
            return false
        }

        let now = Date()
        let secondsUntil = start.timeIntervalSince(now)

        // Too far out, or already well past — make sure nothing is showing.
        if secondsUntil > leadWindow || secondsUntil < -(15 * 60) {
            endAll()
            return false
        }

        let state = PsycleClassActivityAttributes.ContentState(
            startAt: start,
            status: secondsUntil > 0 ? "Starting soon" : "In progress"
        )

        if let activity = current, activity.attributes.eventId == next.eventId {
            update(activity, state: state)
        } else {
            // A different class than what's showing — end the old, start fresh.
            endAll()
            start(next: next, state: state)
        }
        return true
    }

    /// Explicitly start a Live Activity for a snapshot class.
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
                let content = ActivityContent(state: state, staleDate: state.startAt.addingTimeInterval(20 * 60))
                _ = try Activity.request(attributes: attributes, content: content, pushType: nil)
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
                let content = ActivityContent(state: state, staleDate: state.startAt.addingTimeInterval(20 * 60))
                await activity.update(content)
            } else {
                await activity.update(using: state)
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
