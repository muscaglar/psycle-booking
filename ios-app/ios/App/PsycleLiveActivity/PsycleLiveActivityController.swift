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

    /// App Group marker remembering which class already has a self-cleaning
    /// activity scheduled. Needed because the schedule trick below puts the
    /// activity into the 'ended' state immediately, and ended activities no
    /// longer appear in Activity.activities — without the marker every app
    /// foreground would stack a duplicate card.
    ///
    /// Keyed on eventId AND startAt: if the studio moves the class, the
    /// marker no longer matches and a corrected card gets scheduled. It is
    /// deliberately NOT cleared when the snapshot goes empty (a cancel):
    /// the frozen card can't be retracted anyway, and keeping the marker
    /// means a cancel→rebook of the same class doesn't stack a duplicate.
    private let scheduledKey = "live_activity_scheduled_event"
    private var scheduledMarker: String? {
        get { PsycleSnapshotStore.defaults?.string(forKey: scheduledKey) }
        set {
            guard let d = PsycleSnapshotStore.defaults else { return }
            if let v = newValue { d.set(v, forKey: scheduledKey) } else { d.removeObject(forKey: scheduledKey) }
        }
    }

    private func marker(for next: PsycleNextClass) -> String {
        "\(next.eventId)|\(next.startAt)"
    }

    /// Read the shared snapshot and reconcile the Live Activity:
    /// schedule one for an imminent class, or clear what's showing.
    /// Call this on app launch, on foreground, and after booking changes.
    ///
    /// AUTO-CLEAR DESIGN: the app can't run code at class start, so the
    /// countdown must clean itself up. ActivityKit's way to do that without
    /// server pushes is to end the activity IMMEDIATELY after requesting it,
    /// with `dismissalPolicy: .after(classStart)`: the Lock Screen card stays
    /// visible with its live countdown (Text(timerInterval:) is rendered by
    /// the system, no updates needed) and iOS removes it AT CLASS START even
    /// if the app never runs again. Known trade-offs, accepted:
    ///  - a class cancelled inside the 2h window can't retract its card
    ///    (ended activities are unreachable) — it self-clears at start time;
    ///  - the 'ended' state may drop the Dynamic Island presentation early
    ///    on some iOS versions; the Lock Screen card is the primary surface.
    @discardableResult
    public func refreshFromSnapshot() -> Bool {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return false }

        guard let next = PsycleSnapshotStore.nextClass(),
              let start = next.startDate else {
            // Cancelled/none upcoming: end active cards; the marker stays
            // (see its doc comment) so a rebook doesn't duplicate.
            endAll()
            return false
        }

        let now = Date()
        let secondsUntil = start.timeIntervalSince(now)

        // Too far out, or already started — nothing should be showing.
        // (<= 0 : "clear when the class has started", not 15 minutes after.)
        if secondsUntil > leadWindow || secondsUntil <= 0 {
            endAll()
            if secondsUntil <= 0 { scheduledMarker = nil } // class began — marker done
            return false
        }

        // Already scheduled a self-cleaning card for this class at this
        // time — done. (A moved class changes the marker and falls through.)
        if scheduledMarker == marker(for: next) { return true }

        // Claim the marker SYNCHRONOUSLY before the async work: two rapid
        // refresh calls (cold launch fires didBecomeActive + a JS nudge)
        // must not both pass the guard and stack duplicate cards. Cleared
        // again if the request below fails.
        scheduledMarker = marker(for: next)

        let state = PsycleClassActivityAttributes.ContentState(
            startAt: start,
            status: "Starting soon"
        )

        // End any still-active cards (older builds / other classes) first,
        // serialized so the dying activity can't race the new one.
        let stale = Activity<PsycleClassActivityAttributes>.activities
        Task {
            for activity in stale {
                if #available(iOS 16.2, *) {
                    await activity.end(nil, dismissalPolicy: .immediate)
                } else {
                    await activity.end(dismissalPolicy: .immediate)
                }
            }
            self.scheduleSelfClearing(next: next, state: state, classStart: start)
        }
        return true
    }

    /// Request the activity, then immediately end it with a dismissal date
    /// at class start — the system keeps the countdown on the Lock Screen
    /// until then and removes it on its own. (The .after date is clamped by
    /// iOS to at most 4h out; our lead window is 2h, so it never clips.)
    private func scheduleSelfClearing(next: PsycleNextClass,
                                      state: PsycleClassActivityAttributes.ContentState,
                                      classStart: Date) {
        let attributes = PsycleClassActivityAttributes(
            eventId: next.eventId,
            typeName: next.typeName,
            instrName: next.instrName,
            locName: next.locName.isEmpty ? next.studioName : next.locName,
            slotSummary: next.slotSummary
        )
        // Small cushion so the card doesn't vanish a breath before "0:00"
        // on devices with skewed clocks.
        let clearAt = classStart.addingTimeInterval(60)
        do {
            if #available(iOS 16.2, *) {
                let content = ActivityContent(state: state, staleDate: classStart)
                let activity = try Activity.request(attributes: attributes, content: content, pushType: nil)
                Task { await activity.end(content, dismissalPolicy: .after(clearAt)) }
            } else {
                let activity = try Activity.request(attributes: attributes, contentState: state, pushType: nil)
                Task { await activity.end(using: state, dismissalPolicy: .after(clearAt)) }
            }
        } catch {
            // Release the claimed marker so a later refresh can retry.
            scheduledMarker = nil
            NSLog("[PsycleLiveActivity] start failed: \(error.localizedDescription)")
        }
    }

    /// Kept for API compatibility with older call sites.
    public func start(next: PsycleNextClass,
                      state: PsycleClassActivityAttributes.ContentState) {
        scheduleSelfClearing(next: next, state: state, classStart: state.startAt)
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
