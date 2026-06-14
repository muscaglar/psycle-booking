//
//  AppShortcuts.swift
//  Exposes the read-only "next class" intent to Siri & the Shortcuts app with
//  ready-made trigger phrases.
//
//  ── HOW TO ADD IN XCODE ──────────────────────────────────────────────────
//  Add to the SAME target as NextClassIntent.swift (the main app target, or a
//  dedicated App Intents extension). Only ONE AppShortcutsProvider should be
//  declared per target. Siri picks up the phrases automatically after the
//  first launch/build — no Info.plist entry required.
//
//  IMPORTANT: the "\(.applicationName)" token MUST appear in every phrase, and
//  the spoken app name users say is the app's display name ("Psycle Finder").
//
//  Requires iOS 16+.
//

import AppIntents

@available(iOS 16.0, *)
struct PsycleAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: NextClassIntent(),
            phrases: [
                "What's my next class in \(.applicationName)",
                "When's my next \(.applicationName) class",
                "Next class with \(.applicationName)"
            ],
            shortTitle: "Next class",
            systemImageName: "figure.indoor.cycle"
        )
    }
}
