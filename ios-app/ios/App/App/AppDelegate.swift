import UIKit
import Capacitor
import BackgroundTasks

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    /// Background task that ends the Live Activity shortly after class
    /// start when the app isn't opened (layer 2 of the cleanup design —
    /// see PsycleLiveActivityController.refreshFromSnapshot).
    static let liveActivityEndTaskId = "com.psyclefinder.app.la-end"

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.liveActivityEndTaskId, using: nil) { task in
            // End-only in the background (requesting is foreground-only),
            // and AWAIT the end IPC before completing the task — completing
            // first lets iOS suspend the process mid-flight, leaving the
            // card up: the exact failure this task exists to prevent.
            if #available(iOS 16.1, *) {
                let work = Task {
                    await PsycleLiveActivityController.shared.endAllAndWait()
                    task.setTaskCompleted(success: true)
                }
                task.expirationHandler = {
                    work.cancel()
                    task.setTaskCompleted(success: false)
                }
            } else {
                task.setTaskCompleted(success: true)
            }
        }
        return true
    }

    /// Ask iOS to wake us briefly at class start so the countdown card can
    /// be removed even if the phone stays untouched. Timing is at the
    /// system's discretion (usually within minutes of earliestBeginDate).
    private func scheduleLiveActivityEndTask() {
        // Same stale-tolerant selection as the controller: the single
        // next_class key can point at a passed class.
        guard let (_, start) = PsycleSnapshotStore.firstClass(startingAfter: Date()) else { return }
        let request = BGAppRefreshTaskRequest(identifier: Self.liveActivityEndTaskId)
        request.earliestBeginDate = start.addingTimeInterval(30)
        // Throws in the simulator (BGTaskScheduler unsupported) — fine.
        try? BGTaskScheduler.shared.submit(request)
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Not called under the scene life cycle — SceneDelegate calls
        // appDidEnterBackground() instead. Kept for completeness.
        appDidEnterBackground()
    }

    /// (Re)arm the class-start cleanup task with the freshest snapshot —
    /// backgrounding is the last moment we're guaranteed to run.
    func appDidEnterBackground() {
        scheduleLiveActivityEndTask()
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Not called under the scene life cycle — SceneDelegate calls
        // appDidBecomeActive() instead. Kept for completeness.
        appDidBecomeActive()
    }

    func appDidBecomeActive() {
        #if DEBUG
        // Test hook: `simctl launch <dev> com.psyclefinder.app -PSYCLE_LA_TEST 1`
        // seeds a class 30 minutes out so the Live Activity path can be
        // exercised in the simulator without a signed-in session.
        if UserDefaults.standard.bool(forKey: "PSYCLE_LA_TEST") {
            let d = UserDefaults(suiteName: PsycleAppGroup.id)
            let start = Date().addingTimeInterval(30 * 60)
            let iso = ISO8601DateFormatter().string(from: start)
            d?.set("{\"eventId\":\"999\",\"startAt\":\"\(iso)\",\"instrName\":\"Test Instructor\",\"typeName\":\"RIDE 45\",\"studioName\":\"Studio 1\",\"locName\":\"Bank\",\"slots\":[7]}",
                   forKey: PsycleSnapshotKey.nextClass)
            // firstClass() prefers the multi-class list — clear it so a
            // previous session's list can't shadow the seeded class.
            d?.removeObject(forKey: PsycleSnapshotKey.upcoming)
        }
        #endif
        // Reconcile the next-class Live Activity against the shared snapshot
        // (starts one inside the lead window, ends stale ones).
        if #available(iOS 16.1, *) {
            PsycleLiveActivityController.shared.refreshFromSnapshot()
        }
        scheduleLiveActivityEndTask()
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    // MARK: UISceneSession life cycle

    /// Names the scene configuration in Info.plist (UIApplicationSceneManifest):
    /// SceneDelegate below, window and root view controller from Main.storyboard.
    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        return UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
    }

}

/// Scene life cycle. REQUIRED from the iOS 27 SDK: a UIKit app built with it
/// that has no scene manifest is killed at launch ("UIScene life cycle is
/// required for apps built with this SDK"). Capacitor only adopted scenes in
/// 8.5; this is the same adoption for Capacitor 6.
///
/// Under scenes UIKit stops calling the app delegate's
/// applicationDidBecomeActive / applicationDidEnterBackground and stops
/// delivering URLs and user activities to it, so this class hands each of
/// them to where it went before: AppDelegate's handlers, and Capacitor's
/// ApplicationDelegateProxy (which keeps `lastURL` and posts the
/// notifications PsycleDeepLinkPlugin and Capacitor listen for).
///
/// Lives in this file on purpose: AppDelegate.swift is already in the app
/// target's Sources phase, so no project surgery is needed.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    /// Set by UIKit from Main.storyboard (UISceneStoryboardFile).
    var window: UIWindow?

    private var appDelegate: AppDelegate? {
        return UIApplication.shared.delegate as? AppDelegate
    }

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        // A cold launch from a widget tap or a link arrives here, before the
        // web view exists. The proxy remembers the URL (lastURL), which is
        // what PsycleDeepLinkPlugin.load() reads once it is registered.
        forward(connectionOptions.urlContexts)
        if let activity = connectionOptions.userActivities.first {
            forward(activity)
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        forward(URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        forward(userActivity)
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        appDelegate?.appDidBecomeActive()
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        appDelegate?.appDidEnterBackground()
    }

    private func forward(_ contexts: Set<UIOpenURLContext>) {
        for context in contexts {
            var options: [UIApplication.OpenURLOptionsKey: Any] = [
                .openInPlace: context.options.openInPlace
            ]
            if let source = context.options.sourceApplication {
                options[.sourceApplication] = source
            }
            if let annotation = context.options.annotation {
                options[.annotation] = annotation
            }
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: context.url, options: options)
        }
    }

    private func forward(_ activity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: activity, restorationHandler: { _ in })
    }
}
