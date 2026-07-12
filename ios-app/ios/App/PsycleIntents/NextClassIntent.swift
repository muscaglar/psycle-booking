//
//  NextClassIntent.swift
//  App Intent: "What's my next class?" — reads the shared App Group snapshot
//  and answers via Siri / Spotlight / Shortcuts. Read-only.
//
//  ── HOW TO ADD IN XCODE ──────────────────────────────────────────────────
//  App Intents can live in the MAIN APP target (simplest) or in a dedicated
//  "App Intents Extension" target. For Siri/Shortcuts on the snapshot data,
//  the main app target is fine — add THIS file and AppShortcuts.swift to the
//  main app target, plus PsycleShared/PsycleSnapshot.swift. The App Group
//  capability must be on whichever target hosts these intents.
//
//  Requires iOS 16+ (App Intents framework).
//
//  Booking a class via Siri is intentionally NOT implemented here: creating a
//  booking runs through the web/JS layer (auth token, slot picker, POST). A
//  write-intent would need a Capacitor bridge call into the webview, or a
//  native re-implementation of the booking API. That's a FOLLOW-UP; this
//  read-only intent is the deliverable. See NATIVE_FEATURES.md.
//

import Foundation
import AppIntents

@available(iOS 16.0, *)
struct NextClassIntent: AppIntent {
    static var title: LocalizedStringResource = "What's my next class?"
    static var description = IntentDescription("Tells you your next booked Psycle class and when it starts.")

    // Surface the spoken/return value; no app launch needed.
    static var openAppWhenRun: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<String> {
        // Stale-tolerant: the snapshot is from the last app run, and its
        // single next_class key may point at a class that already started —
        // firstClass picks the real next one from the multi-class list, so
        // Siri never answers with this morning's passed class.
        guard let (next, _) = PsycleSnapshotStore.firstClass(startingAfter: Date()) else {
            let none = "You have no upcoming Psycle classes booked."
            return .result(value: none, dialog: IntentDialog(stringLiteral: none))
        }

        let phrase = NextClassIntent.spokenSummary(for: next)
        return .result(value: phrase, dialog: IntentDialog(stringLiteral: phrase))
    }

    /// Build a natural-language summary, e.g.
    /// "Your next class is Ride with Sam on Monday at 6:30 PM at Shoreditch, Bike 12."
    static func spokenSummary(for next: PsycleNextClass) -> String {
        var s = "Your next class is \(next.typeName)"
        if !next.instrName.isEmpty { s += " with \(next.instrName)" }

        if let date = next.startDate {
            let df = DateFormatter()
            df.locale = .current
            // "Monday at 6:30 PM"
            df.dateFormat = "EEEE 'at' h:mm a"
            s += " on \(df.string(from: date))"

            // Add a friendly "in N hours/minutes" when it's today/soon.
            let secs = date.timeIntervalSinceNow
            if secs > 0, secs < 24 * 3600 {
                let mins = Int(secs / 60)
                if mins < 60 {
                    s += ", in \(mins) minute\(mins == 1 ? "" : "s")"
                } else {
                    let hrs = mins / 60
                    s += ", in about \(hrs) hour\(hrs == 1 ? "" : "s")"
                }
            }
        }

        let place = next.locName.isEmpty ? next.studioName : next.locName
        if !place.isEmpty { s += " at \(place)" }
        if let slot = next.slotSummary { s += ", \(slot)" }
        s += "."
        return s
    }
}
