//
//  PsycleClassType.swift
//  Class type, class colours and the 24-hour clock — shared by the widget
//  extension (widgets + Live Activity UI) and the app target (Live Activity
//  controller, the "next class" intent).
//
//  Foundation ONLY, on purpose: no SwiftUI, no WidgetKit, no ActivityKit. The
//  colour type here is three numbers; PsycleWidget/PsycleWidgetStyle.swift
//  turns it into a SwiftUI Color. That keeps this file compilable on a Mac, so
//  ios-app/native-checks/run.sh can run the real decoding and formatting code
//  (see NATIVE_FEATURES.md → "Crisp Colour widgets").
//
//  Target membership: PsycleBookingBuddy (app) AND PsycleWidgetExtension —
//  wire_native_targets.rb adds it to both.
//

import Foundation

// MARK: - Class type

/// The app's eight class categories (js/app.js CATEGORY_MAP, keys lower-cased —
/// the value of `data-ct` in the web layer and of `ct` in the snapshot).
public enum PsycleClassType: String, CaseIterable, Codable, Sendable {
    case ride, strength, yoga, hiit, pilates, lagree, barre, other

    /// A snapshot key → a type. Anything this build does not know (a category
    /// added by a later web build) reads as `.other`: its COLOURS still arrive
    /// as hex in the snapshot, so only the pictogram is generic.
    public init(key: String) {
        self = PsycleClassType(rawValue: key.lowercased()) ?? .other
    }

    // ── class-type-words:start ── (tests/suites/11-native-snapshot.js compares
    // this table with CATEGORY_MAP in js/app.js — change both together)
    private static let words: [(PsycleClassType, [String])] = [
        (.ride, ["RIDE"]),
        (.strength, ["STRENGTH", "LIFT", "WEIGHTS", "TREAD"]),
        (.yoga, ["YOGA", "FLOW", "RESTORE", "MEDITATION"]),
        (.hiit, ["HIIT", "CIRCUIT", "INTERVAL"]),
        (.pilates, ["PILATES", "REFORMER"]),
        (.lagree, ["LAGREE", "MEGAFORMER"]),
        (.barre, ["BARRE"]),
    ]
    // ── class-type-words:end ──

    /// Mirrors getCategory() in js/app.js, for a snapshot written before `ct`
    /// existed. Equipment wins over discipline words ("LAGREE: Upper Body" is
    /// Lagree, "REFORMER: Strength" is a reformer class), then first match in
    /// table order.
    public static func from(typeName: String) -> PsycleClassType {
        let name = typeName.uppercased()
        if name.contains("LAGREE") || name.contains("MEGAFORMER") { return .lagree }
        if name.contains("REFORMER") { return .pilates }
        for (type, list) in words where list.contains(where: { name.contains($0) }) {
            return type
        }
        return .other
    }
}

// MARK: - Colour values

/// An sRGB colour as three 0…1 numbers. Built from a "#RRGGBB" / "#RGB" string
/// and from nothing else — anything unexpected is nil, never a wrong colour.
public struct PsycleRGB: Equatable, Hashable, Sendable {
    public let red: Double
    public let green: Double
    public let blue: Double

    public init(red: Double, green: Double, blue: Double) {
        self.red = red
        self.green = green
        self.blue = blue
    }

    public init?(hex: String?) {
        guard var text = hex?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        if text.hasPrefix("#") { text.removeFirst() }
        if text.count == 3 { text = text.map { "\($0)\($0)" }.joined() }
        // Six hex digits exactly. UInt32(_:radix:) alone would also accept a
        // leading "+", so the characters are checked first.
        guard text.count == 6, text.allSatisfy({ $0.isHexDigit }), let value = UInt32(text, radix: 16) else { return nil }
        self.red = Double((value >> 16) & 0xFF) / 255
        self.green = Double((value >> 8) & 0xFF) / 255
        self.blue = Double(value & 0xFF) / 255
    }

    /// WCAG relative luminance.
    public var luminance: Double {
        func channel(_ value: Double) -> Double {
            value <= 0.03928 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
    }

    /// WCAG contrast ratio against another colour (1…21).
    public func contrast(with other: PsycleRGB) -> Double {
        let lighter = max(luminance, other.luminance)
        let darker = min(luminance, other.luminance)
        return (lighter + 0.05) / (darker + 0.05)
    }

    public static let white = PsycleRGB(red: 1, green: 1, blue: 1)
}

/// How strongly the member wants class colour shown (Membership → Appearance →
/// Class colours): `off` keeps cards neutral and colours only the small marks,
/// `soft` is the default pale tint, `bold` the full tint.
public enum PsycleColourIntensity: String, Codable, Sendable {
    case off, soft, bold
}

/// The app's chrome, for the neutral card of intensity "off" and for ink on a
/// tint: Cloud (light) and Graphite (dark) in css/theme.css.
public enum PsycleChrome {
    public static let surfaceLight = PsycleRGB(hex: "#FCFDFE")!
    public static let surfaceDark = PsycleRGB(hex: "#1B2130")!
    public static let inkOnLight = PsycleRGB(hex: "#1B2130")!
    public static let ink2OnLight = PsycleRGB(hex: "#3A4252")!
    public static let inkOnDark = PsycleRGB(hex: "#EEF1F5")!
    public static let ink2OnDark = PsycleRGB(hex: "#B7BFCC")!
}

/// One class type's colours for one appearance.
public struct PsycleClassSide: Equatable, Sendable {
    /// Ground of the card at the member's intensity (the neutral surface at "off").
    public let tint: PsycleRGB
    /// The full tint — the pictogram tile's fill at "soft". nil when the
    /// snapshot did not carry one; the tile then uses the base fill.
    public let wash: PsycleRGB?
    /// The class colour itself: the seat chip, the tile at "off" / "bold".
    public let base: PsycleRGB
    /// The hue ink that reads on `tint`.
    public let deep: PsycleRGB

    /// Body ink for copy on `tint`, picked from the tint's own lightness — not
    /// from the appearance — so text contrasts with whatever ground it is
    /// really on, even if a snapshot ever carried an unexpected colour.
    public var ink: PsycleRGB { tint.luminance > 0.35 ? PsycleChrome.inkOnLight : PsycleChrome.inkOnDark }
    public var ink2: PsycleRGB { tint.luminance > 0.35 ? PsycleChrome.ink2OnLight : PsycleChrome.ink2OnDark }
    /// `deep` where it really reads on the tint (3:1, large / bold copy),
    /// otherwise the body ink.
    public var accent: PsycleRGB { deep.contrast(with: tint) >= 3 ? deep : ink }
}

/// A class type's colours, light and dark, at the member's intensity.
public struct PsycleClassPalette: Equatable, Sendable {
    public let light: PsycleClassSide
    public let dark: PsycleClassSide
    public let intensity: PsycleColourIntensity

    public func side(dark isDark: Bool) -> PsycleClassSide { isDark ? dark : light }
}

// MARK: - Fallback palette (the app's DEFAULTS)

extension PsycleClassType {

    /// One swatch of js/theme.js CLASS_COLOUR_PALETTE, as written there.
    struct Swatch {
        let tintSoft: String
        let tintBold: String
        let base: String
        let deep: String
    }

    // ── fallback-palette:start ── (tests/suites/11-native-snapshot.js holds
    // every value to js/theme.js: CLASS_COLOUR_DEFAULTS → CLASS_COLOUR_PALETTE)
    private static let fallbackSwatches: [PsycleClassType: (light: Swatch, dark: Swatch)] = [
        .ride: (Swatch(tintSoft: "#E9F0FF", tintBold: "#D6E2FF", base: "#2D5FD6", deep: "#1A3785"),
                Swatch(tintSoft: "#1F2C4A", tintBold: "#233560", base: "#3A6EE7", deep: "#D6E2FF")),
        .strength: (Swatch(tintSoft: "#FEEBE7", tintBold: "#FFD8D0", base: "#CC3A1F", deep: "#7A1E0C"),
                    Swatch(tintSoft: "#35252F", tintBold: "#4B292D", base: "#D34126", deep: "#FFD8D0")),
        .yoga: (Swatch(tintSoft: "#E0F4EF", tintBold: "#C4EBDF", base: "#0A7A64", deep: "#064A3C"),
                Swatch(tintSoft: "#1B2F39", tintBold: "#1C3A40", base: "#1D836D", deep: "#C4EBDF")),
        .hiit: (Swatch(tintSoft: "#F7F0CB", tintBold: "#F2E398", base: "#A26403", deep: "#623800"),
                Swatch(tintSoft: "#2E2B2B", tintBold: "#3F3326", base: "#A5670B", deep: "#F2E398")),
        .pilates: (Swatch(tintSoft: "#F1EDFF", tintBold: "#E6DCFF", base: "#7045D0", deep: "#42238C"),
                   Swatch(tintSoft: "#292949", tintBold: "#36305F", base: "#825AE6", deep: "#E6DCFF")),
        .lagree: (Swatch(tintSoft: "#DEF3F9", tintBold: "#BFE8F3", base: "#057890", deep: "#004858"),
                  Swatch(tintSoft: "#1A2E3E", tintBold: "#1A394B", base: "#177F97", deep: "#BFE8F3")),
        .barre: (Swatch(tintSoft: "#FBEAF8", tintBold: "#FAD6F2", base: "#B82A8E", deep: "#6E1454"),
                 Swatch(tintSoft: "#33253F", tintBold: "#48284C", base: "#C83B9C", deep: "#FAD6F2")),
        .other: (Swatch(tintSoft: "#ECF0F6", tintBold: "#DBE2EE", base: "#57647B", deep: "#313B4D"),
                 Swatch(tintSoft: "#262D3D", tintBold: "#2F3748", base: "#68758D", deep: "#DBE2EE")),
    ]
    // ── fallback-palette:end ──

    private static func side(_ swatch: Swatch, surface: PsycleRGB, intensity: PsycleColourIntensity) -> PsycleClassSide {
        // The literals above are checked by the JS suite and by native-checks;
        // the `??` arms keep a typo from ever crashing a widget.
        let soft = PsycleRGB(hex: swatch.tintSoft) ?? surface
        let bold = PsycleRGB(hex: swatch.tintBold) ?? soft
        let tint: PsycleRGB
        switch intensity {
        case .off: tint = surface
        case .soft: tint = soft
        case .bold: tint = bold
        }
        return PsycleClassSide(tint: tint,
                               wash: bold,
                               base: PsycleRGB(hex: swatch.base) ?? PsycleChrome.ink2OnLight,
                               deep: PsycleRGB(hex: swatch.deep) ?? PsycleChrome.inkOnLight)
    }

    /// This type in the app's default colours — what a snapshot with no colour
    /// fields (an older build's, or one written while the colour engine was
    /// not there) is drawn in.
    public func fallbackPalette(intensity: PsycleColourIntensity = .soft) -> PsycleClassPalette {
        let pair = PsycleClassType.fallbackSwatches[self] ?? PsycleClassType.fallbackSwatches[.other]!
        return PsycleClassPalette(light: PsycleClassType.side(pair.light, surface: PsycleChrome.surfaceLight, intensity: intensity),
                                  dark: PsycleClassType.side(pair.dark, surface: PsycleChrome.surfaceDark, intensity: intensity),
                                  intensity: intensity)
    }
}

// MARK: - What the snapshot says about a class's look

/// The OPTIONAL colour fields native-bridge.js adds to every class entry, as
/// raw strings. Every field may be missing (an older snapshot) or nonsense;
/// `resolve` is where that is settled. Also travels inside the Live Activity's
/// ContentState, so it is Codable + Hashable and must stay all-optional.
public struct PsycleClassStyle: Codable, Hashable, Sendable {
    public var ct: String?
    public var base: String?
    public var tint: String?
    public var deep: String?
    public var wash: String?
    public var baseDark: String?
    public var tintDark: String?
    public var deepDark: String?
    public var washDark: String?
    public var intensity: String?

    public init(ct: String? = nil,
                base: String? = nil, tint: String? = nil, deep: String? = nil, wash: String? = nil,
                baseDark: String? = nil, tintDark: String? = nil, deepDark: String? = nil, washDark: String? = nil,
                intensity: String? = nil) {
        self.ct = ct
        self.base = base
        self.tint = tint
        self.deep = deep
        self.wash = wash
        self.baseDark = baseDark
        self.tintDark = tintDark
        self.deepDark = deepDark
        self.washDark = washDark
        self.intensity = intensity
    }

    /// The snapshot's own key names (native-bridge.js `_snapClassColourFields`),
    /// so a class entry's flat fields and the Live Activity's nested copy decode
    /// through the same code.
    enum CodingKeys: String, CodingKey {
        case ct
        case base = "ctBase"
        case tint = "ctTint"
        case deep = "ctDeep"
        case wash = "ctWash"
        case baseDark = "ctBaseDark"
        case tintDark = "ctTintDark"
        case deepDark = "ctDeepDark"
        case washDark = "ctWashDark"
        case intensity = "ctIntensity"
    }

    /// Tolerant on purpose: a field of the wrong JSON type reads as missing
    /// instead of failing the whole decode (and with it the Live Activity card).
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        func text(_ key: CodingKeys) -> String? { (try? values.decodeIfPresent(String.self, forKey: key)) ?? nil }
        ct = text(.ct)
        base = text(.base)
        tint = text(.tint)
        deep = text(.deep)
        wash = text(.wash)
        baseDark = text(.baseDark)
        tintDark = text(.tintDark)
        deepDark = text(.deepDark)
        washDark = text(.washDark)
        intensity = text(.intensity)
    }

    /// The class type: the snapshot's key when there is one, else worked out
    /// from the class name the way the web app does.
    public func classType(typeName: String) -> PsycleClassType {
        if let key = ct?.trimmingCharacters(in: .whitespaces), !key.isEmpty {
            return PsycleClassType(key: key)
        }
        return PsycleClassType.from(typeName: typeName)
    }

    /// The colours to draw with. A side uses the snapshot's colours only when
    /// base, tint AND deep all parse — never a mix of the member's colours and
    /// the defaults; otherwise that side is the type's default swatch.
    public func palette(typeName: String) -> PsycleClassPalette {
        let level = intensity.flatMap { PsycleColourIntensity(rawValue: $0.lowercased()) } ?? .soft
        let fallback = classType(typeName: typeName).fallbackPalette(intensity: level)

        func side(_ base: String?, _ tint: String?, _ deep: String?, _ wash: String?, else other: PsycleClassSide) -> PsycleClassSide {
            guard let base = PsycleRGB(hex: base), let tint = PsycleRGB(hex: tint), let deep = PsycleRGB(hex: deep) else { return other }
            return PsycleClassSide(tint: tint, wash: PsycleRGB(hex: wash), base: base, deep: deep)
        }
        return PsycleClassPalette(light: side(base, tint, deep, wash, else: fallback.light),
                                  dark: side(baseDark, tintDark, deepDark, washDark, else: fallback.dark),
                                  intensity: level)
    }
}

// MARK: - Class names

public enum PsycleClassName {
    /// A long class name cut in two at the space nearest its middle:
    /// "REFORMER PILATES: SCULPT 50" → "REFORMER PILATES:" / "SCULPT 50",
    /// "LAGREE: Upper Body & Core" → "LAGREE: Upper" / "Body & Core". nil when
    /// there is no space to cut at.
    ///
    /// Why the widgets want it: a Text that wraps by itself cannot tell its
    /// container that it was cut ("PILATES: SCUL…" measures as "fits"). Two
    /// one-line Texts CAN — ViewThatFits only takes them when each line really
    /// fits — so a name set this way is whole by construction.
    public static func balancedHalves(_ name: String) -> (first: String, second: String)? {
        let characters = Array(name.trimmingCharacters(in: .whitespaces))
        let spaces = characters.indices.filter { characters[$0] == " " }
        let middle = Double(characters.count - 1) / 2
        guard let cut = spaces.min(by: { abs(Double($0) - middle) < abs(Double($1) - middle) }) else { return nil }
        let first = String(characters[..<cut]).trimmingCharacters(in: .whitespaces)
        let second = String(characters[(cut + 1)...]).trimmingCharacters(in: .whitespaces)
        guard !first.isEmpty, !second.isEmpty else { return nil }
        return (first, second)
    }
}

// MARK: - Fixed-format dates

/// A DateFormatter that means exactly its pattern on EVERY phone — the one
/// factory both directions go through: PsycleClock PRINTS with it, and
/// PsycleDateParser / PsycleWeekDay (PsycleSnapshot.swift) READ the snapshot's
/// wall times with it.
///
/// A formatter left on the user's own locale is rewritten behind your back
/// (Apple QA1480): with the 12-hour clock switched on in a 24-hour region (a UK
/// phone, 24-Hour Time off) "HH" becomes "h a" — printing "6:30 pm", and
/// PARSING "2026-09-24T18:30:00" to nil, which blanked every widget; and with a
/// non-Gregorian device calendar "yyyy" is that calendar's year (Buddhist: the
/// class lands in 1483, Islamic: in 2587). The fixed POSIX locale carries no
/// such override and the calendar is pinned, so neither setting can change
/// what is printed or read. The TIME ZONE is still the device's — the widget /
/// Live Activity snapshot is device-local by the owner's decision (see
/// CLAUDE.md → Gym time); only the format is fixed.
public enum PsycleFixedFormat {
    public static func formatter(_ pattern: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = .autoupdatingCurrent
        formatter.dateFormat = pattern
        return formatter
    }
}

// MARK: - 24-hour clock

/// Every class time the widgets, the Live Activity and Siri print goes through
/// here: "18:30", never "6:30 pm" — see PsycleFixedFormat for why the phone's
/// 12/24-hour switch cannot rewrite it.
public enum PsycleClock {

    private static func formatter(_ pattern: String) -> DateFormatter { PsycleFixedFormat.formatter(pattern) }

    // DateFormatter is safe to use from several threads (iOS 7+); static lets
    // are initialised once.
    private static let clock = formatter("HH:mm")
    private static let shortDay = formatter("EEE")
    private static let longDay = formatter("EEEE")

    /// "18:30"
    public static func time(_ date: Date) -> String { clock.string(from: date) }

    /// "Thu"
    public static func weekday(_ date: Date) -> String { shortDay.string(from: date) }

    /// "Thu 18:30"
    public static func dayTime(_ date: Date) -> String { "\(weekday(date)) \(time(date))" }

    /// "Thursday at 18:30" — the Siri answer.
    public static func spoken(_ date: Date) -> String { "\(longDay.string(from: date)) at \(time(date))" }
}
