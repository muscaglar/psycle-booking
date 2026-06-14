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
import ActivityKit

@available(iOS 16.1, *)
public struct PsycleClassActivityAttributes: ActivityAttributes {

    /// Dynamic state pushed during the activity's lifetime.
    public struct ContentState: Codable, Hashable {
        /// When the class starts. Drives the live countdown (Text(timerInterval:)).
        public var startAt: Date
        /// Free-form status line, e.g. "Starting soon" or "In progress".
        public var status: String

        public init(startAt: Date, status: String) {
            self.startAt = startAt
            self.status = status
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
