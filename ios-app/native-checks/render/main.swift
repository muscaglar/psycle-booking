//
//  native-checks/render — draws the SHIPPED widget layouts to PNGs on a Mac
//  (see ../render.sh). Widgets and Live Activities cannot be run from an
//  unsigned simulator build, so this is the only way to LOOK at them short of
//  a signed device build: text that is cut off, a row that does not fit a
//  small phone, an ink that vanishes on a tint.
//
//  Run together with, unmodified: PsycleShared/*.swift and
//  PsycleWidget/{PsyclePictogram,PsycleWidgetStyle,PsycleWidgetLayouts}.swift.
//
//  What it is NOT: WidgetKit. There is no container background, no content
//  margin, no vibrancy — the harness paints the card and pads by 16pt itself,
//  as iOS 17 does. The Dynamic Island is not drawn (its regions are
//  ActivityKit's). Fonts are San Francisco at iOS's default text sizes
//  (PsycleFace.text maps them on a Mac). Not part of any Xcode target.
//

import SwiftUI
import AppKit

let outDir = URL(fileURLWithPath: CommandLine.arguments.last ?? ".", isDirectory: true)
try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

// A class tomorrow at 18:30 on THIS machine's clock (the snapshot path is
// device-local), so the digits read "18:30" whatever the zone.
var parts = Calendar.current.dateComponents([.year, .month, .day], from: Date().addingTimeInterval(86_400))
parts.hour = 18
parts.minute = 30
let start = Calendar.current.date(from: parts)!
let now = Date()

func facts(_ type: PsycleClassType, _ title: String, _ who: String, _ place: String, _ seat: String?) -> PsycleClassFacts {
    PsycleClassFacts(type: type, title: title, instructor: who, place: place, seat: seat, start: start)
}
func surface(_ type: PsycleClassType, _ level: PsycleColourIntensity, dark: Bool, flat: Bool = false, shows: Bool = true) -> PsycleSurface {
    PsycleSurface.resolve(palette: type.fallbackPalette(intensity: level), dark: dark, flat: flat, showsBackground: shows)
}

/// A Home Screen widget as iOS 17 frames it: the card, 16pt content margins.
struct Card<Content: View>: View {
    let size: CGSize
    let ground: Color
    let content: Content
    var body: some View {
        content
            .padding(16)
            .frame(width: size.width, height: size.height)
            .background(ground)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }
}

func small(_ f: PsycleClassFacts?, _ s: PsycleSurface, side: CGFloat = 158, fallback: Color) -> some View {
    Card(size: CGSize(width: side, height: side), ground: s.card ?? fallback, content: PsycleSmallLayout(facts: f, now: now, surface: s))
}
func medium(_ f: PsycleClassFacts?, _ s: PsycleSurface, week: Int, size: CGSize = CGSize(width: 338, height: 158), fallback: Color) -> some View {
    Card(size: size, ground: s.card ?? fallback, content: PsycleMediumLayout(facts: f, now: now, weekCount: week, surface: s))
}

@MainActor
func write<V: View>(_ name: String, dark: Bool, wallpaper: Color, @ViewBuilder _ view: () -> V) {
    let sheet = view()
        .padding(24)
        .background(wallpaper)
        .environment(\.colorScheme, dark ? .dark : .light)
    let renderer = ImageRenderer(content: sheet)
    renderer.scale = 2
    guard let image = renderer.cgImage,
          let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
        print("  FAILED to render \(name)")
        return
    }
    let url = outDir.appendingPathComponent(name + ".png")
    do { try png.write(to: url); print("  wrote \(url.path)  (\(image.width / 2) × \(image.height / 2) pt)") } catch { print("  FAILED to write \(name): \(error)") }
}

let ride = facts(.ride, "RIDE: 45", "Maya", "Shoreditch", "Bike 12")
let strength = facts(.strength, "STRENGTH 45", "Jonas", "Shoreditch", "Bench 7")
let yoga = facts(.yoga, "YOGA FLOW", "Elena", "Notting Hill", "Spot 4")
let long = facts(.pilates, "REFORMER PILATES: SCULPT 50", "Alexandra", "Oxford Circus", "Beds 12 & 14")
let noSeat = facts(.hiit, "HIIT", "Tom", "Bank", nil)
let lagree = facts(.lagree, "LAGREE: Upper Body & Core", "Isla", "Mayfair", "Machine 3")
let barre = facts(.barre, "BARRE 55", "Isla", "Bank", "Spot 9")
let other = facts(.other, "Sound Bath", "", "Clapham", nil)

/// Everything below draws with ImageRenderer, which is main-actor API. Top-level
/// code in a script runs on the main thread but is not main-actor ISOLATED, so
/// the drawing lives in one @MainActor function (called at the end of the file).
@MainActor
func renderAll() {
    for dark in [false, true] {
        let wall = dark ? Color(red: 0.05, green: 0.06, blue: 0.09) : Color(red: 0.80, green: 0.83, blue: 0.88)
        let sys = dark ? Color(red: 0.11, green: 0.11, blue: 0.12) : Color.white
        let tag = dark ? "dark" : "light"

        write("home-\(tag)", dark: dark, wallpaper: wall) {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 16) {
                    small(ride, surface(.ride, .soft, dark: dark), fallback: sys)
                    small(strength, surface(.strength, .bold, dark: dark), fallback: sys)
                    small(yoga, surface(.yoga, .off, dark: dark), fallback: sys)
                    small(long, surface(.pilates, .soft, dark: dark), fallback: sys)
                }
                HStack(spacing: 16) {
                    small(noSeat, surface(.hiit, .soft, dark: dark), fallback: sys)
                    small(lagree, surface(.lagree, .soft, dark: dark), fallback: sys)
                    small(barre, surface(.barre, .bold, dark: dark), fallback: sys)
                    small(other, surface(.other, .soft, dark: dark), fallback: sys)
                }
                HStack(spacing: 16) {
                    medium(ride, surface(.ride, .soft, dark: dark), week: 3, fallback: sys)
                    medium(long, surface(.pilates, .bold, dark: dark), week: 12, fallback: sys)
                }
                HStack(spacing: 16) {
                    medium(yoga, surface(.yoga, .off, dark: dark), week: 1, fallback: sys)
                    medium(nil, PsycleSurface.neutral(dark: dark, flat: false, showsBackground: true), week: 0, fallback: sys)
                    small(nil, PsycleSurface.neutral(dark: dark, flat: false, showsBackground: true), fallback: sys)
                }
            }
        }

        // The small family on every phone size (141 = SE / mini … 170 = Pro Max),
        // with the longest strings: which rows survive, and nothing is clipped.
        write("small-sizes-\(tag)", dark: dark, wallpaper: wall) {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top, spacing: 16) {
                    ForEach([141, 148, 155, 158, 170], id: \.self) { side in
                        small(long, surface(.pilates, .soft, dark: dark), side: CGFloat(side), fallback: sys)
                    }
                }
                HStack(alignment: .top, spacing: 16) {
                    ForEach([141, 148, 155, 158, 170], id: \.self) { side in
                        small(ride, surface(.ride, .bold, dark: dark), side: CGFloat(side), fallback: sys)
                    }
                }
            }
        }

        // The longest class name where the title column is narrowest: the medium
        // family on a 4.7-inch phone (321 × 148) and on a mini (329 × 155) beside
        // the standard 338 × 158. The whole name, on up to three lines — no "…".
        write("medium-sizes-\(tag)", dark: dark, wallpaper: wall) {
            VStack(alignment: .leading, spacing: 16) {
                ForEach([CGSize(width: 321, height: 148), CGSize(width: 329, height: 155), CGSize(width: 338, height: 158)], id: \.width) { size in
                    HStack(alignment: .top, spacing: 16) {
                        medium(long, surface(.pilates, .soft, dark: dark), week: 12, size: size, fallback: sys)
                        medium(lagree, surface(.lagree, .bold, dark: dark), week: 3, size: size, fallback: sys)
                    }
                }
            }
        }

        // The Live Activity card on the Lock Screen, at the platter's width on a
        // 4.7-inch phone (359) and on a 6.1-inch one (377). Its ground is the
        // view's OWN (psycleActivityGround — the modifier the shipped view uses),
        // so what is drawn here is what the platter is filled with.
        write("activity-\(tag)", dark: dark, wallpaper: wall) {
            HStack(alignment: .top, spacing: 16) {
                ForEach([359, 377], id: \.self) { width in
                    VStack(spacing: 16) {
                        ForEach(0..<3, id: \.self) { index in
                            let f = [ride, long, noSeat][index]
                            let s = surface(f.type, [.soft, .bold, .off][index], dark: dark)
                            PsycleActivityCard(facts: f, started: index == 2, countdown: now...start, surface: s)
                                .psycleActivityGround(s.card)
                                .frame(width: CGFloat(width))
                                .background(sys)
                                .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                        }
                    }
                }
            }
        }
    }

    // What the system recolours: a tinted Home Screen (accented), StandBy (the
    // background taken away, on black) and the Lock Screen accessories (vibrant).
    // Here everything is simply drawn white on a dark ground — what must hold is
    // that a mark is still a mark, not a blob.
    write("recoloured", dark: true, wallpaper: Color(red: 0.16, green: 0.20, blue: 0.30)) {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 16) {
                small(ride, surface(.ride, .soft, dark: true, flat: true), fallback: Color.white.opacity(0.10))
                small(strength, surface(.strength, .bold, dark: true, flat: true), fallback: Color.white.opacity(0.10))
                medium(long, surface(.pilates, .soft, dark: true, flat: true), week: 3, fallback: Color.white.opacity(0.10))
            }
            HStack(spacing: 16) {
                small(ride, surface(.ride, .soft, dark: true, shows: false), fallback: .black)
                small(yoga, surface(.yoga, .off, dark: true, shows: false), fallback: .black)
                medium(strength, surface(.strength, .bold, dark: true, shows: false), week: 3, fallback: .black)
            }
            HStack(alignment: .top, spacing: 24) {
                ForEach(0..<3, id: \.self) { index in
                    let f = [ride, long, lagree][index]
                    PsycleRectangularAccessory(type: f.type, title: f.title, when: f.start, seat: f.seat, place: f.place)
                        .frame(width: 160, height: 66, alignment: .topLeading)
                        .foregroundColor(.white)
                }
            }
            HStack(spacing: 24) {
                ForEach(0..<2, id: \.self) { index in
                    let f = [ride, long][index]
                    PsycleInlineAccessory(title: f.title, when: f.start, now: now, glyph: PsycleGlyph.template(f.type, size: 15, scale: 2))
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(.white)
                }
            }
            // The Dynamic Island's pieces (its layout is ActivityKit's): the solid tile, the chip.
            HStack(spacing: 12) {
                ForEach(PsycleClassType.allCases, id: \.self) { type in
                    PsycleTypeTile(type: type, size: 40,
                                   surface: PsycleSurface.resolve(palette: type.fallbackPalette(), dark: true, flat: false, showsBackground: false, solidTile: true))
                }
                PsycleSeatChip(text: "Bikes 12 & 14",
                               surface: PsycleSurface.resolve(palette: PsycleClassType.ride.fallbackPalette(), dark: true, flat: false, showsBackground: false, solidTile: true),
                               compact: true)
            }
            .padding(12)
            .background(Color.black)
            .clipShape(Capsule(style: .continuous))
        }
    }

    // The eight marks, large, beside the sizes the widgets use.
    write("pictograms", dark: false, wallpaper: .white) {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 18) {
                ForEach(PsycleClassType.allCases, id: \.self) { type in
                    VStack(spacing: 6) {
                        PsyclePictogramView(type: type, size: 72).foregroundColor(.black)
                        Text(type.rawValue).font(.system(size: 11))
                    }
                }
            }
            HStack(spacing: 18) {
                ForEach(PsycleClassType.allCases, id: \.self) { type in
                    HStack(spacing: 6) {
                        PsyclePictogramView(type: type, size: 24).foregroundColor(.black)
                        PsyclePictogramView(type: type, size: 18).foregroundColor(.black)
                        PsyclePictogramView(type: type, size: 13).foregroundColor(.black)
                    }
                    .frame(width: 72)
                }
            }
        }
    }

}

MainActor.assumeIsolated { renderAll() }
print("native-checks/render: done")
