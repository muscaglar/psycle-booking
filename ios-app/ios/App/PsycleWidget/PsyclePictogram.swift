//
//  PsyclePictogram.swift
//  The app's eight class-type pictograms as a SwiftUI Shape — the same marks
//  the web layer draws (js/app.js CLASS_PICTOGRAMS / classPictogram): a 24
//  grid, stroked, round caps and joins, the stroke thickening as the mark
//  shrinks. Never an emoji, never an SF Symbol look-alike.
//
//  SwiftUI ONLY (no WidgetKit), so ios-app/native-checks/run.sh can build the
//  paths on a Mac and check them.
//
//  Target membership: PsycleWidgetExtension.
//

import SwiftUI

/// One primitive of a pictogram, in 24-grid units — the three element kinds
/// the web marks are made of.
enum PsycleMark {
    /// <circle cx cy r>
    case circle(CGFloat, CGFloat, CGFloat)
    /// <rect x y width height rx>
    case rect(CGFloat, CGFloat, CGFloat, CGFloat, CGFloat)
    /// <path> of straight segments, left open
    case line([CGPoint])
    /// <path> of straight segments, closed (…z)
    case closed([CGPoint])
}

private func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x, y: y) }

enum PsyclePictogramData {

    // ── pictograms:start ── (tests/suites/11-native-snapshot.js parses this
    // table and compares it, number for number, with CLASS_PICTOGRAMS in
    // js/app.js. One primitive per line, in the web mark's element order.)
    static let ride: [PsycleMark] = [
        .circle(5.5, 16.5, 3.5),
        .circle(18.5, 16.5, 3.5),
        .line([p(5.5, 16.5), p(12.5, 16.5), p(9.5, 9), p(15.5, 9), p(18.5, 16.5)]),
        .line([p(12.5, 16.5), p(15.5, 9)]),
        .line([p(8, 6.5), p(11.5, 6.5)]),
        .line([p(15.5, 9), p(14.7, 6), p(17.3, 6)]),
    ]
    static let strength: [PsycleMark] = [
        .rect(3, 11, 18, 3.5, 1.75),
        .line([p(6.5, 14.5), p(6.5, 19)]),
        .line([p(17.5, 14.5), p(17.5, 19)]),
        .line([p(8, 6.5), p(16, 6.5)]),
        .line([p(8, 4.5), p(8, 8.5)]),
        .line([p(16, 4.5), p(16, 8.5)]),
    ]
    static let yoga: [PsycleMark] = [
        .line([p(3, 19), p(17, 19)]),
        .circle(17, 15.5, 3.5),
        .circle(17, 15.5, 0.6),
    ]
    static let hiit: [PsycleMark] = [
        .closed([p(13.5, 3), p(6, 13.5), p(11.5, 13.5), p(10.5, 21), p(18, 10.5), p(12.5, 10.5)]),
    ]
    static let pilates: [PsycleMark] = [
        .line([p(2.5, 17.5), p(21.5, 17.5)]),
        .line([p(5, 17.5), p(5, 20)]),
        .line([p(19, 17.5), p(19, 20)]),
        .rect(8, 13, 8, 4.5, 1.5),
        .line([p(4.5, 17.5), p(4.5, 11.5)]),
        .line([p(3, 11.5), p(6, 11.5)]),
        .line([p(19.5, 17.5), p(19.5, 7.5)]),
        .line([p(19.5, 8.5), p(15.5, 13)]),
    ]
    static let lagree: [PsycleMark] = [
        .line([p(2.5, 17.5), p(21.5, 17.5)]),
        .line([p(5, 17.5), p(5, 20)]),
        .line([p(19, 17.5), p(19, 20)]),
        .rect(9, 13, 6, 4.5, 1.5),
        .line([p(4.5, 17.5), p(4.5, 9.5)]),
        .line([p(3, 9.5), p(6, 9.5)]),
        .line([p(19.5, 17.5), p(19.5, 9.5)]),
        .line([p(18, 9.5), p(21, 9.5)]),
        .line([p(6.5, 15.25), p(9, 15.25)]),
    ]
    static let barre: [PsycleMark] = [
        .line([p(2.5, 8), p(21.5, 8)]),
        .line([p(6, 5), p(6, 19.5)]),
        .line([p(18, 5), p(18, 19.5)]),
        .line([p(6, 13), p(18, 13)]),
        .line([p(3.5, 19.5), p(8.5, 19.5)]),
        .line([p(15.5, 19.5), p(20.5, 19.5)]),
    ]
    static let other: [PsycleMark] = [
        .line([p(2.5, 12.5), p(7, 12.5), p(9.5, 6), p(14, 18), p(16.5, 12.5), p(21.5, 12.5)]),
    ]
    // ── pictograms:end ──

    static func marks(for type: PsycleClassType) -> [PsycleMark] {
        switch type {
        case .ride: return ride
        case .strength: return strength
        case .yoga: return yoga
        case .hiit: return hiit
        case .pilates: return pilates
        case .lagree: return lagree
        case .barre: return barre
        case .other: return other
        }
    }

    /// The web mark's stroke-width, in GRID units, for a box of `size` points
    /// (classPictogram in js/app.js: 2 at 24, 2.2 at 18, 2.5 at 13).
    static func strokeUnits(forSize size: CGFloat) -> CGFloat {
        let px = size.rounded()
        if px <= 14 { return 2.5 }
        if px <= 16 { return 2.3 }
        if px <= 19 { return 2.2 }
        if px <= 22 { return 2.1 }
        return 2
    }
}

/// The OUTLINE of a class type's pictogram, scaled from the 24 grid into the
/// rect it is given (uniformly, centred). Stroke it — `PsyclePictogramView`
/// does, with the web mark's weight; filled, it would be a blob.
struct PsyclePictogram: Shape {
    let type: PsycleClassType

    static let grid: CGFloat = 24

    func path(in rect: CGRect) -> Path {
        var path = Path()
        for mark in PsyclePictogramData.marks(for: type) {
            switch mark {
            case let .circle(cx, cy, r):
                path.addEllipse(in: CGRect(x: cx - r, y: cy - r, width: r * 2, height: r * 2))
            case let .rect(x, y, width, height, radius):
                // .circular: an SVG rx is a plain arc, not a continuous corner.
                path.addRoundedRect(in: CGRect(x: x, y: y, width: width, height: height),
                                    cornerSize: CGSize(width: radius, height: radius),
                                    style: .circular)
            case let .line(points):
                path.addLines(points)
            case let .closed(points):
                path.addLines(points)
                path.closeSubpath()
            }
        }
        let scale = min(rect.width, rect.height) / PsyclePictogram.grid
        let drawn = PsyclePictogram.grid * scale
        return path.applying(CGAffineTransform(translationX: rect.minX + (rect.width - drawn) / 2,
                                               y: rect.minY + (rect.height - drawn) / 2)
            .scaledBy(x: scale, y: scale))
    }
}

/// A pictogram drawn the way the web app draws it: `size` points square, in
/// the view's foreground colour, round caps and joins.
struct PsyclePictogramView: View {
    let type: PsycleClassType
    let size: CGFloat

    var body: some View {
        PsyclePictogram(type: type)
            .stroke(style: StrokeStyle(lineWidth: PsyclePictogramData.strokeUnits(forSize: size) * size / PsyclePictogram.grid,
                                       lineCap: .round,
                                       lineJoin: .round))
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}
