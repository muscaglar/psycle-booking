//
//  native-checks/decode — runs the SHIPPED Swift on a Mac (see ../run.sh).
//
//  Compiled together with, unmodified:
//    ios/App/PsycleShared/PsycleClassType.swift
//    ios/App/PsycleShared/PsycleSnapshot.swift
//    ios/App/PsycleLiveActivity/PsycleLiveActivityAttributes.swift
//    ios/App/PsycleWidget/PsyclePictogram.swift
//
//  What it proves, which an unsigned simulator build cannot:
//   1. a snapshot and a Live Activity payload written by the PREVIOUS build
//      still decode, and fall back to the class name + the default colours;
//   2. the new colour fields can never fail a decode, whatever they hold;
//   3. times print as 24-hour "18:30" AND the snapshot's wall times are read
//      back as the same instant, even when the process is forced onto the
//      12-hour clock in a 24-hour region or given a Buddhist / Islamic device
//      calendar (run.sh launches it each way) — a time that cannot be read
//      blanks every widget, however well it would have been printed;
//   4. the widget timeline dates an entry exactly at each class's start, so the
//      countdown says "Now" instead of counting up;
//   5. every pictogram builds a path inside its 24 grid;
//   6. the inks the widgets use hold their contrast on every default tint.
//
//  Not part of any Xcode target. Exit code = number of failed checks.
//

import Foundation
import SwiftUI

var failures = 0
func check(_ ok: Bool, _ what: String) {
    print((ok ? "  ok    " : "  FAIL  ") + what)
    if !ok { failures += 1 }
}
func section(_ name: String) { print("\n" + name) }
func data(_ json: String) -> Data { json.data(using: .utf8)! }
func hex(_ rgb: PsycleRGB) -> String {
    String(format: "#%02X%02X%02X", Int((rgb.red * 255).rounded()), Int((rgb.green * 255).rounded()), Int((rgb.blue * 255).rounded()))
}

// MARK: 1. Snapshots

section("Snapshot: written by the previous build (no colour fields)")
do {
    let old = #"{"eventId":"123","startAt":"2026-09-24T18:30:00","instrName":"Maya","typeName":"RIDE: 45","studioName":"Studio 1","locName":"Shoreditch","slots":[12]}"#
    let next = try JSONDecoder().decode(PsycleNextClass.self, from: data(old))
    check(next.eventId == "123" && next.typeName == "RIDE: 45" && next.slots == [12], "the seven original fields decode as before")
    check(next.style == PsycleClassStyle(), "…with an empty style")
    check(next.classType == .ride, "the class type is worked out from the class name (RIDE: 45 → ride)")
    check(next.palette == PsycleClassType.ride.fallbackPalette(intensity: .soft), "…and drawn in the app's default colours at \"soft\"")
    check(hex(next.palette.light.tint) == "#E9F0FF" && hex(next.palette.light.base) == "#2D5FD6" && hex(next.palette.dark.tint) == "#1F2C4A", "ride = cobalt: light tint #E9F0FF, base #2D5FD6, dark tint #1F2C4A")
    check(next.slotSummary == "Bike 12", "the seat label is unchanged")

    let list = try JSONDecoder().decode([PsycleNextClass].self, from: data("[\(old),\(old)]"))
    check(list.count == 2, "the upcoming list of old entries decodes")
    let week = try JSONDecoder().decode([PsycleWeekDay].self, from: data(#"[{"day":"2026-09-24","count":2,"firstStart":"2026-09-24T18:30:00"}]"#))
    check(week.count == 1 && week[0].count == 2 && week[0].style == PsycleClassStyle(), "an old week bucket decodes")
} catch {
    check(false, "an old snapshot must decode — threw \(error)")
}

section("Snapshot: written by this build")
do {
    let new = ##"{"eventId":"9","startAt":"2026-09-24T18:30:00","instrName":"Jonas","typeName":"STRENGTH 45","studioName":"","locName":"Shoreditch","slots":[7],"ct":"strength","ctIntensity":"bold","ctBase":"#C62C58","ctTint":"#FFD9DE","ctDeep":"#76162E","ctWash":"#FFD9DE","ctBaseDark":"#D33A62","ctTintDark":"#4B283D","ctDeepDark":"#FFD9DE","ctWashDark":"#4B283D"}"##
    let next = try JSONDecoder().decode(PsycleNextClass.self, from: data(new))
    check(next.classType == .strength, "ct is used as sent")
    check(next.palette.intensity == .bold && hex(next.palette.light.base) == "#C62C58" && hex(next.palette.light.tint) == "#FFD9DE" && hex(next.palette.dark.base) == "#D33A62",
          "the member's colours (rose, not Strength's default ember) are what is drawn")
    let again = try JSONDecoder().decode(PsycleNextClass.self, from: JSONEncoder().encode(next))
    check(again == next, "encode → decode round-trips, colour fields flat beside the rest")

    let off = ##"{"eventId":"9","startAt":"2026-09-24T18:30:00","instrName":"","typeName":"RIDE","studioName":"","locName":"","slots":[],"ct":"ride","ctIntensity":"off","ctBase":"#2D5FD6","ctTint":"#FCFDFE","ctDeep":"#1A3785","ctWash":"#D6E2FF","ctBaseDark":"#3A6EE7","ctTintDark":"#1B2130","ctDeepDark":"#D6E2FF","ctWashDark":"#233560"}"##
    let neutral = try JSONDecoder().decode(PsycleNextClass.self, from: data(off))
    check(neutral.palette.intensity == .off && neutral.palette.light.tint == PsycleChrome.surfaceLight && neutral.palette.dark.tint == PsycleChrome.surfaceDark,
          "intensity \"off\": the neutral tint is the card ground, light and dark")
    check(hex(neutral.palette.light.base) == "#2D5FD6", "…and the class colour still arrives for the tile and the chip")

    let future = ##"{"eventId":"9","startAt":"2026-09-24T18:30:00","instrName":"","typeName":"BOXING","studioName":"","locName":"","slots":[],"ct":"boxing","ctBase":"#112233","ctTint":"#EEF0F2","ctDeep":"#0A0B0C","ctBaseDark":"#8899AA","ctTintDark":"#202428","ctDeepDark":"#E0E4E8"}"##
    let unknown = try JSONDecoder().decode(PsycleNextClass.self, from: data(future))
    check(unknown.classType == .other && hex(unknown.palette.light.base) == "#112233", "a category this build has never heard of: the generic pictogram, but ITS colours (they travel as hex)")
    check(unknown.palette.light.wash == nil && unknown.palette.intensity == .soft, "no wash / intensity sent → none assumed, \"soft\"")
} catch {
    check(false, "a new snapshot must decode — threw \(error)")
}

section("Snapshot: colour fields that are nonsense can never fail the class")
do {
    let cases: [(String, String)] = [
        ("numbers where strings belong", #""ct":7,"ctBase":12,"ctTint":false,"ctDeep":null,"ctIntensity":3"#),
        ("objects and arrays", ##""ct":{"a":1},"ctBase":["#fff"],"ctTint":{},"ctDeep":[]"##),
        ("not colours", ##""ct":"ride","ctBase":"red","ctTint":"#GGGGGG","ctDeep":"+12345","ctBaseDark":"#12345","ctTintDark":"rgba(0,0,0,.5)","ctDeepDark":"""##),
        ("one side only", ##""ct":"ride","ctBase":"#C62C58","ctTint":"#FFD9DE","ctDeep":"#76162E""##),
        ("half a side", ##""ct":"ride","ctBase":"#C62C58","ctTint":"#FFD9DE""##),
    ]
    for (name, fields) in cases {
        let json = #"{"eventId":"1","startAt":"2026-09-24T18:30:00","instrName":"","typeName":"RIDE","studioName":"","locName":"","slots":[],"# + fields + "}"
        let next = try JSONDecoder().decode(PsycleNextClass.self, from: data(json))
        let fallback = PsycleClassType.ride.fallbackPalette(intensity: .soft)
        switch name {
        case "one side only":
            check(hex(next.palette.light.base) == "#C62C58" && next.palette.dark == fallback.dark, "\(name): the complete side is used, the missing side is the default")
        default:
            check(next.eventId == "1" && next.palette == fallback, "\(name): the class decodes and is drawn in the defaults — never a mix")
        }
    }
} catch {
    check(false, "a bad colour field must never throw — threw \(error)")
}

// MARK: 2. Live Activity payloads

/// ContentState as the builds BEFORE this one declared it.
struct ContentStateBeforeSeats: Codable { var startAt: Date; var status: String }
struct ContentStatePreviousBuild: Codable { var startAt: Date; var status: String; var slotSummary: String? }
struct AttributesPreviousBuild: Codable { let eventId, typeName, instrName, locName: String; let slotSummary: String? }

section("Live Activity: a card started by the previous build still decodes")
do {
    let start = Date(timeIntervalSince1970: 1_790_274_600)
    let previous = try JSONEncoder().encode(ContentStatePreviousBuild(startAt: start, status: "Starting soon", slotSummary: "Bikes 12 & 14"))
    let state = try JSONDecoder().decode(PsycleClassActivityAttributes.ContentState.self, from: previous)
    check(state.startAt == start && state.status == "Starting soon" && state.slotSummary == "Bikes 12 & 14", "the previous build's state decodes, seats and all")
    check(state.style == nil, "…with no style — the view then uses attributes.typeName and the default colours")
    let look = (state.style ?? PsycleClassStyle())
    check(look.classType(typeName: "REFORMER: Sculpt") == .pilates && look.palette(typeName: "REFORMER: Sculpt") == PsycleClassType.pilates.fallbackPalette(), "that fallback: a reformer class is Pilates, in violet")

    let older = try JSONEncoder().encode(ContentStateBeforeSeats(startAt: start, status: "Starting soon"))
    let oldest = try JSONDecoder().decode(PsycleClassActivityAttributes.ContentState.self, from: older)
    check(oldest.slotSummary == nil && oldest.style == nil, "the build before THAT (no slotSummary either) decodes too")

    let attrs = try JSONEncoder().encode(AttributesPreviousBuild(eventId: "5", typeName: "Ride", instrName: "Maya", locName: "Shoreditch", slotSummary: "Bike 12"))
    let decoded = try JSONDecoder().decode(PsycleClassActivityAttributes.self, from: attrs)
    check(decoded.eventId == "5" && decoded.slotSummary == "Bike 12", "the static attributes are unchanged")

    var fresh = PsycleClassActivityAttributes.ContentState(startAt: start, status: "Starting soon", slotSummary: "Bike 12")
    fresh.style = PsycleClassStyle(ct: "ride", base: "#2D5FD6", tint: "#E9F0FF", deep: "#1A3785", intensity: "soft")
    let roundTrip = try JSONDecoder().decode(PsycleClassActivityAttributes.ContentState.self, from: JSONEncoder().encode(fresh))
    check(roundTrip == fresh, "this build's state (with a style) round-trips")
    let seenByPrevious = try JSONDecoder().decode(ContentStatePreviousBuild.self, from: JSONEncoder().encode(fresh))
    check(seenByPrevious.slotSummary == "Bike 12", "…and the previous build's decoder simply ignores the new key (a downgrade does not strand a card)")
} catch {
    check(false, "an old Live Activity payload must decode — threw \(error)")
}

// MARK: 3. The clock

section("Clock: 24-hour, whatever the device prefers")
do {
    var parts = DateComponents()
    parts.year = 2026; parts.month = 9; parts.day = 24; parts.hour = 18; parts.minute = 30
    let evening = Calendar(identifier: .gregorian).date(from: parts)!
    parts.hour = 6; parts.minute = 5
    let morning = Calendar(identifier: .gregorian).date(from: parts)!
    parts.hour = 0; parts.minute = 0
    let midnight = Calendar(identifier: .gregorian).date(from: parts)!

    let naive = DateFormatter()
    naive.dateFormat = "HH:mm"
    print("  (this process: locale \(Locale.current.identifier); a DateFormatter left on the user's locale prints 18:30 as \"\(naive.string(from: evening))\")")

    check(PsycleClock.time(evening) == "18:30", "18:30 → \"\(PsycleClock.time(evening))\"")
    check(PsycleClock.time(morning) == "06:05", "06:05 keeps its leading zero → \"\(PsycleClock.time(morning))\"")
    check(PsycleClock.time(midnight) == "00:00", "midnight is 00:00, not 12:00 or 24:00 → \"\(PsycleClock.time(midnight))\"")
    check(PsycleClock.dayTime(evening) == "Thu 18:30", "day + time → \"\(PsycleClock.dayTime(evening))\"")
    check(PsycleClock.spoken(evening) == "Thursday at 18:30", "the Siri phrase → \"\(PsycleClock.spoken(evening))\"")
    check(PsycleClock.time(evening).unicodeScalars.allSatisfy { $0.isASCII }, "Latin digits even under a locale with its own numerals")
}

section("Snapshot times are READ the same on every phone (the input side of the clock)")
do {
    // What a DateFormatter left on the user's locale makes of the bridge's
    // zone-less wall time in THIS process — nil under the 12-hour override in a
    // 24-hour region, the wrong era under a Buddhist / Islamic calendar. It is
    // what PsycleDateParser used to be, and shows whether this run reproduces
    // the hazard.
    let naive = DateFormatter()
    naive.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
    naive.timeZone = .current
    let gregorian = Calendar(identifier: .gregorian)
    func stamp(_ date: Date?) -> String {
        guard let date = date else { return "nil" }
        let c = gregorian.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        return String(format: "%04d-%02d-%02d %02d:%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0, c.hour ?? 0, c.minute ?? 0)
    }
    print("  (this process: a DateFormatter left on the user's locale reads \"2026-09-24T18:30:00\" as \(stamp(naive.date(from: "2026-09-24T18:30:00"))) — Gregorian, device zone)")

    let old = #"{"eventId":"123","startAt":"2026-09-24T18:30:00","instrName":"Maya","typeName":"RIDE: 45","studioName":"Studio 1","locName":"Shoreditch","slots":[12]}"#
    let next = try JSONDecoder().decode(PsycleNextClass.self, from: data(old))
    check(next.startDate != nil, "the snapshot's zone-less wall time parses (nil here = every widget empty, the Live Activity ended, Siri \"no classes\")")
    check(stamp(next.startDate) == "2026-09-24 18:30", "…to 24 September 2026, 18:30 on the device's clock → \(stamp(next.startDate))")
    check(next.startDate.map(PsycleClock.dayTime) == "Thu 18:30", "…and prints back as \"Thu 18:30\" → \"\(next.startDate.map(PsycleClock.dayTime) ?? "nil")\"")
    check(stamp(PsycleDateParser.parse("2026-09-24 18:30:00")) == "2026-09-24 18:30", "the API's raw space-separated form reads the same")
    let zoned = PsycleDateParser.parse("2026-09-24T18:30:00Z")
    check(zoned == Date(timeIntervalSince1970: 1_790_274_600), "a value that carries its zone is still taken at its word (18:30Z)")
    check(PsycleDateParser.parse("not a date") == nil && PsycleDateParser.parse("") == nil, "nonsense is nil, not a wrong date")

    let week = try JSONDecoder().decode([PsycleWeekDay].self, from: data(#"[{"day":"2026-09-24","count":2,"firstStart":"2026-09-24T18:30:00"}]"#))
    check(stamp(week[0].date) == "2026-09-24 00:00", "a week bucket's day is 24 September 2026 on the device's clock → \(stamp(week[0].date))")
} catch {
    check(false, "the snapshot must decode — threw \(error)")
}

section("Widget timeline: the countdown turns to \"Now\" at the start, never counts up")
do {
    let now = Date(timeIntervalSince1970: 1_790_270_000)
    let first = now.addingTimeInterval(3_600), second = now.addingTimeInterval(7_200)
    // The countdown line's own test (PsycleCountdownLine): start > the ENTRY's date.
    func counting(_ step: PsycleTimelinePlan.Step, _ starts: [Date]) -> Bool? { step.index.map { starts[$0] > step.date } }

    let starts = [first, second]
    let steps = PsycleTimelinePlan.steps(starts: starts, now: now)
    check(steps.map { $0.index } == [0, 0, 1, 1, nil], "each class twice — while it is ahead, then AT its start — then the empty state")
    check(steps.map { $0.date } == [now, first, first.addingTimeInterval(60), second, second.addingTimeInterval(60)],
          "dates: now · start · start + 60s (the next class takes over) · its start · its start + 60s")
    check(steps.map { counting($0, starts) } == [true, false, true, false, nil],
          "the entry current from 18:30:00 to 18:31:00 reads \"Now\" (before: \"in 5 sec\", \"in 40 sec\" … counting up)")
    check(zip(steps, steps.dropFirst()).allSatisfy { $0.date < $1.date }, "entry dates strictly increase")

    let same = [first, first, second]
    let tied = PsycleTimelinePlan.steps(starts: same, now: now)
    check(zip(tied, tied.dropFirst()).allSatisfy { $0.date < $1.date } && tied.map { $0.index } == [0, 0, 1, 2, 2, nil],
          "two classes at the same minute: still strictly increasing, the second shown from start + 60s")
    check(tied.filter { $0.index == 1 }.allSatisfy { counting($0, same) == false }, "…and it reads \"Now\", not a count-up (it has started)")

    let none = PsycleTimelinePlan.steps(starts: [], now: now)
    check(none.count == 1 && none[0].index == nil && none[0].date == now, "nothing booked: the empty state, from now")
}

// MARK: 4. Class types, colours, pictograms

section("Class type from a class name (mirrors getCategory)")
do {
    let cases: [(String, PsycleClassType)] = [
        ("RIDE: 45", .ride), ("Ride", .ride), ("STRENGTH 45", .strength), ("LIFT", .strength), ("TREAD & SHRED", .strength),
        ("YOGA FLOW", .yoga), ("RESTORE", .yoga), ("HIIT", .hiit), ("CIRCUIT", .hiit),
        ("PILATES MAT", .pilates), ("REFORMER: Strength", .pilates), ("REFORMER PILATES: SCULPT 50", .pilates),
        ("LAGREE: Upper Body & Core", .lagree), ("MEGAFORMER", .lagree), ("BARRE 55", .barre), ("Sound Bath", .other), ("", .other),
    ]
    for (name, want) in cases { check(PsycleClassType.from(typeName: name) == want, "\"\(name)\" → \(want.rawValue)") }
    check(PsycleClassType(key: "RIDE") == .ride && PsycleClassType(key: "boxing") == .other, "a key is case-blind; an unknown key is \"other\"")
}

section("A long class name is cut in two at the space nearest its middle")
do {
    func halves(_ name: String) -> String { PsycleClassName.balancedHalves(name).map { "\($0.first) | \($0.second)" } ?? "nil" }
    check(halves("REFORMER PILATES: SCULPT 50") == "REFORMER PILATES: | SCULPT 50", "REFORMER PILATES: SCULPT 50 → \(halves("REFORMER PILATES: SCULPT 50"))")
    check(halves("LAGREE: Upper Body & Core") == "LAGREE: Upper | Body & Core", "LAGREE: Upper Body & Core → \(halves("LAGREE: Upper Body & Core"))")
    check(halves("  RIDE: 45 ") == "RIDE: | 45", "outer spaces are dropped → \(halves("  RIDE: 45 "))")
    check(halves("HIIT") == "nil" && halves("") == "nil" && halves("   ") == "nil", "no space to cut at → nil (the name is set whole)")
    for name in ["REFORMER PILATES: SCULPT 50", "LAGREE: Upper Body & Core", "A  B", "STRENGTH: UPPER BODY & CORE"] {
        let parts = PsycleClassName.balancedHalves(name)
        let letters = name.filter { $0 != " " }
        check(parts.map { ($0.first + $0.second).filter { $0 != " " } == letters && !$0.first.isEmpty && !$0.second.isEmpty } ?? false, "\"\(name)\": both halves non-empty, nothing lost")
    }
}

section("Hex parsing fails safe")
do {
    check(PsycleRGB(hex: "#2D5FD6") == PsycleRGB(hex: "2d5fd6") && PsycleRGB(hex: " #2D5FD6 ") != nil, "#RRGGBB, with or without the #, any case, trimmed")
    check(PsycleRGB(hex: "#FFF") == PsycleRGB.white, "#RGB expands")
    for bad in ["", "#", "#12345", "#1234567", "#GGGGGG", "+12345", "-12345", "red", "rgba(0,0,0,.5)", "#12 345", "0x1234", "##2D5FD6"] {
        check(PsycleRGB(hex: bad) == nil, "\"\(bad)\" is not a colour")
    }
    check(PsycleRGB(hex: nil) == nil, "nil is not a colour")
}

section("Inks hold on every default tint (WCAG)")
do {
    for type in PsycleClassType.allCases {
        for level in [PsycleColourIntensity.off, .soft, .bold] {
            let palette = type.fallbackPalette(intensity: level)
            for (name, side) in [("light", palette.light), ("dark", palette.dark)] {
                let body = side.ink.contrast(with: side.tint), second = side.ink2.contrast(with: side.tint), hue = side.accent.contrast(with: side.tint)
                let chip = PsycleRGB.white.contrast(with: side.base)
                let tile = level == .soft ? side.deep.contrast(with: side.wash ?? side.base) : chip
                let ok = body >= 4.5 && second >= 4.5 && hue >= 3 && chip >= 4.5 && tile >= 3
                if !ok || (type == .ride && level == .soft) {
                    check(ok, String(format: "\(type.rawValue) / \(level.rawValue) / \(name): ink %.1f, ink2 %.1f, accent %.1f, chip label %.1f, tile mark %.1f", body, second, hue, chip, tile))
                }
            }
        }
    }
    check(true, "all 8 types × 3 intensities × light/dark checked (only ride/soft and any failure are listed)")
}

section("Pictograms: each builds a path inside its 24 grid")
do {
    for type in PsycleClassType.allCases {
        let box = PsyclePictogram(type: type).path(in: CGRect(x: 0, y: 0, width: 24, height: 24)).boundingRect
        let inside = box.minX >= 0 && box.minY >= 0 && box.maxX <= 24 && box.maxY <= 24 && box.width > 8 && box.height > 2
        check(inside, String(format: "\(type.rawValue): x %.1f…%.1f, y %.1f…%.1f", box.minX, box.maxX, box.minY, box.maxY))
    }
    let big = PsyclePictogram(type: .ride).path(in: CGRect(x: 10, y: 10, width: 48, height: 60)).boundingRect
    let unit = PsyclePictogram(type: .ride).path(in: CGRect(x: 0, y: 0, width: 24, height: 24)).boundingRect
    check(abs(big.width - unit.width * 2) < 0.01 && abs(big.minX - (10 + unit.minX * 2)) < 0.01 && abs(big.minY - (10 + 6 + unit.minY * 2)) < 0.01,
          "scaled uniformly and centred in a non-square rect (48 × 60 at 10,10)")
    check(PsyclePictogramData.strokeUnits(forSize: 24) == 2 && PsyclePictogramData.strokeUnits(forSize: 18) == 2.2 && PsyclePictogramData.strokeUnits(forSize: 13) == 2.5,
          "stroke: 2 at 24, 2.2 at 18, 2.5 at 13 (the web mark's steps)")
}

section("Live Activity: the card goes five minutes after the class's scheduled start")
do {
    typealias R = PsycleLiveActivityRetirement
    let start = Date(timeIntervalSince1970: 1_790_000_000)
    let goes = start.addingTimeInterval(5 * 60)
    check(R.graceAfterStart == 300, "the grace is 300 seconds")
    check(R.verdict(start: start, now: start.addingTimeInterval(-1)) == .keep, "one second before the start: keep (a countdown still due is never touched)")
    check(R.verdict(start: start, now: start) == .dismissAt(goes), "at the start: hand the removal to the system for start + 5 min")
    check(R.verdict(start: start, now: start.addingTimeInterval(299)) == .dismissAt(goes), "4 min 59 s in: still the same dismissal date, never a later one")
    check(R.verdict(start: start, now: goes) == .removeNow, "exactly five minutes in: remove now")
    check(R.verdict(start: start, now: start.addingTimeInterval(3 * 3600)) == .removeNow, "hours later: remove now")
    let later = start.addingTimeInterval(3600)
    check(R.nextCheck(starts: [later, start], now: start.addingTimeInterval(-600)) == goes.addingTimeInterval(5), "next check: the EARLIEST start + 5 min, five seconds late, whatever the order")
    check(R.nextCheck(starts: [start, later], now: start.addingTimeInterval(60)) == goes.addingTimeInterval(5), "a class that began a minute ago still has its check ahead")
    check(R.nextCheck(starts: [start, later], now: goes.addingTimeInterval(6)) == later.addingTimeInterval(305), "once that has passed, the next class's")
    check(R.nextCheck(starts: [start], now: goes.addingTimeInterval(6)) == nil && R.nextCheck(starts: [], now: start) == nil, "nothing ahead: nil")
}

print(failures == 0 ? "\nnative-checks/decode: all checks passed" : "\nnative-checks/decode: \(failures) FAILED")
exit(Int32(min(failures, 100)))
