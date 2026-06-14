//
//  NotificationCategories.swift
//  Native reference for the actionable "class reminder" notification category
//  (Book / Cancel / Snooze) — the UNUserNotificationCenter equivalent of the
//  JS `registerNotificationActions()` in native-bridge.js.
//
//  ── DO YOU NEED THIS FILE? ───────────────────────────────────────────────
//  Probably NOT. The Capacitor LocalNotifications plugin already registers
//  these actions from JS (see native-bridge.js → registerNotificationActions)
//  and delivers taps via the `localNotificationActionPerformed` listener.
//  That path is the one the app actually uses and is fully wired.
//
//  Use THIS file only if you stop using the Capacitor plugin and schedule
//  notifications natively. If so:
//    1. Add this file to the MAIN APP target.
//    2. Call `PsycleNotificationCategories.register()` from
//       AppDelegate.didFinishLaunchingWithOptions.
//    3. Set the UNUserNotificationCenter delegate and implement
//       `didReceive response:` to route action ids (sample below).
//    4. Set `content.categoryIdentifier = PsycleNotificationCategories.classCategoryID`
//       on notifications you schedule natively.
//
//  IMPORTANT: do NOT register the same category id from both Capacitor and
//  here — the last registration wins and you'll get duplicate/conflicting
//  buttons. Pick one path.
//

import Foundation
import UserNotifications

public enum PsycleNotificationCategories {

    public static let classCategoryID = "PSYCLE_CLASS"

    public enum Action: String {
        case book = "BOOK"
        case cancel = "CANCEL"
        case snooze = "SNOOZE"
    }

    /// Register the actionable category. Call once at launch.
    public static func register() {
        let book = UNNotificationAction(
            identifier: Action.book.rawValue,
            title: "Book",
            options: [.foreground]
        )
        let cancel = UNNotificationAction(
            identifier: Action.cancel.rawValue,
            title: "Cancel",
            options: [.destructive, .foreground]
        )
        let snooze = UNNotificationAction(
            identifier: Action.snooze.rawValue,
            title: "Snooze",
            options: []   // background action; no app launch
        )
        let category = UNNotificationCategory(
            identifier: classCategoryID,
            actions: [book, cancel, snooze],
            intentIdentifiers: [],
            options: []
        )
        UNUserNotificationCenter.current().setNotificationCategories([category])
    }

    // ── Sample delegate routing (copy into your UNUserNotificationCenterDelegate)
    //
    // func userNotificationCenter(_ center: UNUserNotificationCenter,
    //         didReceive response: UNNotificationResponse,
    //         withCompletionHandler completionHandler: @escaping () -> Void) {
    //     let eventId = response.notification.request.content.userInfo["eventId"] as? String
    //     switch response.actionIdentifier {
    //     case Action.book.rawValue:
    //         // Booking needs the web/JS layer (auth + slot picker). Bring the
    //         // app forward and post the intent into the webview, e.g. via a
    //         // Capacitor plugin call that runs:
    //         //   window.handleNotificationIntent?.('BOOK', eventId)
    //         break
    //     case Action.cancel.rawValue:
    //         // Same: route to window.handleNotificationIntent?.('CANCEL', eventId)
    //         break
    //     case Action.snooze.rawValue:
    //         // Re-schedule a one-off reminder ~1h later (no app launch).
    //         break
    //     default:
    //         break
    //     }
    //     completionHandler()
    // }
}
