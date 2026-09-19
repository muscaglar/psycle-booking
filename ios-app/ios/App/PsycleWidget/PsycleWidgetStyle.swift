//
//  PsycleWidgetStyle.swift
//  The Crisp Colour pieces the Home Screen / Lock Screen widgets and the Live
//  Activity share: how a class's colours become a surface and its inks in each
//  rendering mode, the pictogram tile, the seat chip and the time face.
//
//  Target membership: PsycleWidgetExtension.
//

import SwiftUI
import WidgetKit

extension Color {
    init(_ rgb: PsycleRGB) {
        self.init(.sRGB, red: rgb.red, green: rgb.green, blue: rgb.blue, opacity: 1)
    }
}

// MARK: - Type

enum PsycleFace {
    /// The time and the big numerals: the system face, condensed and heavy,
    /// with tabular digits so 11:11 and 08:08 are the same width. (The app's
    /// Sofia Sans Condensed is a web font; no font file ships in the extension.)
    static func time(_ size: CGFloat, weight: Font.Weight = .black) -> Font {
        Font.system(size: size, weight: weight).width(.condensed).monospacedDigit()
    }

    /// Small heavy labels beside the time ("Thu").
    static func label(_ size: CGFloat) -> Font {
        Font.system(size: size, weight: .bold).width(.condensed)
    }

    /// Body copy in a system text style, so it follows the member's text size
    /// as the old widget did.
    static func text(_ style: Font.TextStyle, weight: Font.Weight = .regular) -> Font {
        #if os(macOS)
        // Only native-checks/render.sh builds this for a Mac, whose text styles
        // are a few points smaller: draw at iOS's default sizes there, so the
        // PNGs show what a phone shows.
        return Font.system(size: iosPointSize(style), weight: weight)
        #else
        return Font.system(style).weight(weight)
        #endif
    }

    #if os(macOS)
    private static func iosPointSize(_ style: Font.TextStyle) -> CGFloat {
        switch style {
        case .largeTitle: return 34
        case .title: return 28
        case .title2: return 22
        case .title3: return 20
        case .headline, .body: return 17
        case .callout: return 16
        case .subheadline: return 15
        case .footnote: return 13
        case .caption: return 12
        case .caption2: return 11
        @unknown default: return 17
        }
    }
    #endif
}

// MARK: - Surface + inks

/// Everything a layout needs to colour itself, settled ONCE per render from
/// the class palette, the appearance and how the system is drawing the widget.
///
/// `.fullColor` with its background → the class tint and the app's inks.
/// `.fullColor` WITHOUT its background (StandBy, which takes the container
///   background away and sits the widget on black) → the system's own inks;
///   the tile and the chip are self-contained fill + ink pairs and stay.
/// `.accented` / `.vibrant` → the system throws every colour away and keeps
///   only opacity, so a filled tile under a stroked mark, or a filled chip
///   under its label, would come out as one solid blob. There the fills are
///   faint and the marks and labels full strength.
struct PsycleSurface {
    /// The card ground; nil = leave it to the system.
    let card: Color?
    let ink: Color
    let ink2: Color
    /// The one hue line (the countdown).
    let accent: Color
    let tileFill: Color
    let tileInk: Color
    let chipFill: Color
    let chipInk: Color
    /// True when the system recolours everything (accented / vibrant).
    let flat: Bool

    /// `solidTile`: always the base fill under the white mark, whatever the
    /// intensity (the web's `.ct-tile.is-solid`) — the Dynamic Island, where
    /// the tile is the only colour there is.
    static func resolve(palette: PsycleClassPalette,
                        dark: Bool,
                        flat: Bool,
                        showsBackground: Bool,
                        solidTile: Bool = false) -> PsycleSurface {
        if flat {
            return PsycleSurface(card: nil,
                                 ink: .primary,
                                 ink2: .secondary,
                                 accent: .primary,
                                 tileFill: Color.primary.opacity(0.16),
                                 tileInk: .primary,
                                 chipFill: Color.primary.opacity(0.16),
                                 chipInk: .primary,
                                 flat: true)
        }
        let side = palette.side(dark: dark)
        // The tile, as css/crisp.css §2 has it: "soft" = the full tint under
        // the deep mark; "off" and "bold" = the base fill under a white mark.
        let softTile = !solidTile && palette.intensity == .soft && side.wash != nil
        let tileFill = softTile ? Color(side.wash ?? side.base) : Color(side.base)
        let tileInk = softTile ? Color(side.deep) : Color(PsycleRGB.white)
        if !showsBackground {
            return PsycleSurface(card: nil,
                                 ink: .primary,
                                 ink2: .secondary,
                                 accent: .primary,
                                 tileFill: tileFill,
                                 tileInk: tileInk,
                                 chipFill: Color(side.base),
                                 chipInk: Color(PsycleRGB.white),
                                 flat: false)
        }
        return PsycleSurface(card: Color(side.tint),
                             ink: Color(side.ink),
                             ink2: Color(side.ink2),
                             accent: Color(side.accent),
                             tileFill: tileFill,
                             tileInk: tileInk,
                             chipFill: Color(side.base),
                             chipInk: Color(PsycleRGB.white),
                             flat: false)
    }

    /// No class to show: the app's neutral surface and inks.
    static func neutral(dark: Bool, flat: Bool, showsBackground: Bool) -> PsycleSurface {
        let quiet = Color.primary.opacity(0.16)
        if flat || !showsBackground {
            return PsycleSurface(card: nil, ink: .primary, ink2: .secondary, accent: .primary,
                                 tileFill: quiet, tileInk: .primary, chipFill: quiet, chipInk: .primary, flat: flat)
        }
        let ink = Color(dark ? PsycleChrome.inkOnDark : PsycleChrome.inkOnLight)
        let ink2 = Color(dark ? PsycleChrome.ink2OnDark : PsycleChrome.ink2OnLight)
        return PsycleSurface(card: Color(dark ? PsycleChrome.surfaceDark : PsycleChrome.surfaceLight),
                             ink: ink, ink2: ink2, accent: ink,
                             tileFill: ink2.opacity(0.16), tileInk: ink2, chipFill: ink2.opacity(0.16), chipInk: ink,
                             flat: false)
    }
}

/// Reads whether the system is drawing the widget's container background
/// (iOS 17+; always true before that) and hands it to `content`.
struct PsycleBackgroundProbe<Content: View>: View {
    @ViewBuilder let content: (Bool) -> Content

    var body: some View {
        if #available(iOS 17.0, *) {
            PsycleBackgroundProbe17(content: content)
        } else {
            content(true)
        }
    }
}

@available(iOS 17.0, *)
private struct PsycleBackgroundProbe17<Content: View>: View {
    @Environment(\.showsWidgetContainerBackground) private var showsBackground
    let content: (Bool) -> Content

    var body: some View { content(showsBackground) }
}

// MARK: - Pieces

/// The pictogram in its rounded tile (the web `.ct-tile`: 28 → an 18 mark, a
/// 10 radius; every size keeps those proportions).
struct PsycleTypeTile: View {
    let type: PsycleClassType
    let size: CGFloat
    let surface: PsycleSurface

    var body: some View {
        RoundedRectangle(cornerRadius: size * 10 / 28, style: .continuous)
            .fill(surface.tileFill)
            .frame(width: size, height: size)
            .overlay(
                PsyclePictogramView(type: type, size: (size * 18 / 28).rounded())
                    .foregroundColor(surface.tileInk)
                    .widgetAccentable(surface.flat)
            )
            .accessibilityHidden(true)
    }
}

/// "Bike 12" — the seat, in the class base colour. It is the member's own
/// seat, so in full colour it carries the soft drop of the app's glow.
struct PsycleSeatChip: View {
    let text: String
    let surface: PsycleSurface
    var compact: Bool = false

    var body: some View {
        Text(text)
            .font(PsycleFace.label(compact ? 12 : 13))
            .foregroundColor(surface.chipInk)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .padding(.horizontal, compact ? 8 : 10)
            .padding(.vertical, compact ? 3 : 4)
            .background(
                Capsule(style: .continuous)
                    .fill(surface.chipFill)
                    .shadow(color: surface.flat ? .clear : surface.chipFill.opacity(0.35), radius: 4, x: 0, y: 2)
            )
    }
}

/// The pictogram as a small TEMPLATE image, for the one place that cannot
/// draw a Shape: the inline Lock Screen accessory takes Text and an Image and
/// silently drops anything else. Drawn from the same Shape, so it is the same
/// mark — not an SF Symbol stand-in. nil when it cannot be rendered; the line
/// then goes out as text alone.
enum PsycleGlyph {
    @MainActor
    static func template(_ type: PsycleClassType, size: CGFloat, scale: CGFloat) -> Image? {
        let renderer = ImageRenderer(content: PsyclePictogramView(type: type, size: size).foregroundColor(.black))
        renderer.scale = max(1, scale)
        #if canImport(UIKit)
        guard let image = renderer.uiImage else { return nil }
        return Image(uiImage: image.withRenderingMode(.alwaysTemplate)).renderingMode(.template)
        #else
        guard let image = renderer.nsImage else { return nil }
        return Image(nsImage: image).renderingMode(.template)
        #endif
    }
}

extension View {
    /// The Live Activity card's ground, painted BY THE VIEW — in the same render
    /// pass that picks the inks, so ground and ink can never come from two
    /// different appearances. Handing the colour to the system alone
    /// (`activityBackgroundTint`) is not enough: the platter's tint is known to
    /// lag a light ↔ dark switch while a card is up, and the inks here follow
    /// `colorScheme` at once — pale Graphite ink on the still-light tint, about
    /// 1.1:1, until the next flip. The system clips the view to the platter, so
    /// filling the width is all it takes; with no colour (recoloured, or StandBy
    /// with the background taken away) nothing is painted, as before.
    func psycleActivityGround(_ color: Color?) -> some View {
        self.padding()
            .frame(maxWidth: .infinity)
            .background(color ?? Color.clear)
    }

    /// The widget's ground. iOS 17 wants it declared as the container
    /// background (the system can then take it away — StandBy, tinted Home
    /// Screen); before that the view paints and pads itself.
    @ViewBuilder
    func psycleCard(_ color: Color?) -> some View {
        if #available(iOS 17.0, *) {
            self.containerBackground(for: .widget) {
                if let color = color { color } else { Color.clear }
            }
        } else {
            self.padding()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(color ?? Color.clear)
        }
    }
}
