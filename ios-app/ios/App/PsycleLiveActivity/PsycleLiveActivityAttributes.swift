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
