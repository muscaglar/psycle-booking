//
//  PsycleWidgetLayouts.swift
//  The Crisp Colour layouts: Home Screen small + medium, the two Lock Screen
//  accessories and the Live Activity card. The class component of the app,
//  restated for a widget — the TIME leads, heavy and condensed, in 24-hour
//  digits; the class type's pictogram sits in its rounded tile; then the class
//  name, "Instructor · Studio", the seat in the class colour, the countdown.
//
//  Every view here takes plain values (no timeline entry, no ActivityKit
//  context, no environment lookups beyond what SwiftUI itself provides), so
//  ios-app/native-checks/render.sh can draw them to PNGs on a Mac — the only
//  way to LOOK at them without a signed device build.
//
//  Target membership: PsycleWidgetExtension.
//

import SwiftUI
import WidgetKit

// MARK: - What a layout prints

/// One class, already resolved to what is printed.
struct PsycleClassFacts {
    let type: PsycleClassType
    let title: String
    let instructor: String
    let place: String
    let seat: String?
    let start: Date?

    /// "Maya · Shoreditch" (either part may be missing).
    var whoWhere: String {
        [instructor, place].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    /// "18:30" — or the app's own "--:--" when the start time cannot be read.
    var clock: String { start.map(PsycleClock.time) ?? "--:--" }
}

extension PsycleClassFacts {
    init(_ next: PsycleNextClass) {
        self.init(type: next.classType,
                  title: next.typeName,
                  instructor: next.instrName,
                  place: next.locName.isEmpty ? next.studioName : next.locName,
                  seat: next.slotSummary,
                  start: next.startDate)
    }
}

// MARK: - Shared pieces

/// "in 2 hr, 5 min", ticking by itself; "Now" once the class has started.
///
/// `now` is the timeline ENTRY's date, fixed when the timeline was built, and
/// Text(.relative) prints a distance in EITHER direction — so "Now" is only
/// reached because the provider dates one entry exactly at the class's start
/// (PsycleTimelinePlan). Without it this line read "in 40 sec", counting up,
/// for the minute after the class began.
struct PsycleCountdownLine: View {
    let start: Date
    let now: Date

    var body: some View {
        if start > now {
            Text("in \(start, style: .relative)")
        } else {
            Text("Now")
        }
    }
}

extension View {
    /// For a whole Home Screen card: body copy follows the member's text size,
    /// but only so far — a widget cannot scroll, and past xLarge the rows would
    /// push the seat out of the card. VoiceOver reads the card as ONE element,
    /// in reading order ("18:30, Thu, in 2 hr, Ride 45, Maya · Shoreditch, Bike 12").
    func psycleWidgetReading() -> some View {
        self.dynamicTypeSize(...DynamicTypeSize.xLarge)
            .accessibilityElement(children: .combine)
    }
}

/// Tile + class name, the head of the class component — a class name should
/// wrap rather than end in "…". The name steps down, first fit wins:
///   1. one line in `font`, then one line in `wrapFont` ("STRENGTH 45");
///   2. two BALANCED lines in `wrapFont`, then in `smallFont` — the name cut at
///      the space nearest its middle ("REFORMER PILATES:" / "SCULPT 50"), each
///      half a one-line Text, so this step is only taken when both really fit:
///      whole by construction;
///   3. free wrapping in `wrapFont`, up to `lines` lines.
///
/// Why not simply `lineLimit(2)`: NEITHER ViewThatFits can see a wrapping Text
/// being cut — the horizontal one here ends on its last child whatever happens
/// inside it, and a caller's vertical one measures a truncated Text as "fits".
/// Two free lines were not enough for that name in a small widget's ~85pt
/// column ("PILATES: SCUL…" on every phone size), so step 3 allows three, and a
/// card that has not got the height for them asks for `short` — the name's
/// head, "REFORMER PILATES", the rule the inline Lock Screen line already uses
/// — instead of cutting mid-word. A Text only takes the lines it needs, so a
/// short name lays out the same whatever `lines` is.
private struct PsycleClassHead: View {
    let facts: PsycleClassFacts
    let surface: PsycleSurface
    let tile: CGFloat
    let font: Font
    let wrapFont: Font
    let smallFont: Font
    var lines: Int = 3
    var short: Bool = false

    private var title: String { short ? PsycleInlineAccessory.shortTitle(facts.title) : facts.title }

    var body: some View {
        HStack(alignment: .center, spacing: tile >= 28 ? 8 : 6) {
            PsycleTypeTile(type: facts.type, size: tile, surface: surface)
            name
                .foregroundColor(surface.ink)
                // VoiceOver gets the whole name, ONCE — however it is set (two
                // halves are two Texts; a label on a container that is not an
                // element itself would be handed to each) and shortened or not.
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(facts.title))
        }
    }

    // One explicit candidate list per case, rather than conditions INSIDE a
    // ViewThatFits.
    @ViewBuilder
    private var name: some View {
        if lines <= 1 {
            // The floor of a ladder: one line, the smaller face, and only then
            // shrinking / "…".
            ViewThatFits(in: .horizontal) {
                oneLine(font)
                Text(title).font(wrapFont).lineLimit(1).minimumScaleFactor(0.8)
            }
        } else if let halves = PsycleClassName.balancedHalves(title) {
            ViewThatFits(in: .horizontal) {
                oneLine(font)
                oneLine(wrapFont)
                twoLines(halves.first, halves.second, wrapFont)
                twoLines(halves.first, halves.second, smallFont)
                wrapped
            }
        } else {
            ViewThatFits(in: .horizontal) {
                oneLine(font)
                oneLine(wrapFont)
                wrapped
            }
        }
    }

    private func oneLine(_ font: Font) -> some View {
        Text(title).font(font).lineLimit(1)
    }

    private func twoLines(_ first: String, _ second: String, _ font: Font) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(first).lineLimit(1)
            Text(second).lineLimit(1)
        }
        .font(font)
    }

    private var wrapped: some View {
        Text(title).font(wrapFont).lineLimit(lines).minimumScaleFactor(0.85)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// Nothing booked: one line, top-leading, on the neutral card.
private struct PsycleEmptyState: View {
    let surface: PsycleSurface

    var body: some View {
        Text("No upcoming class")
            .font(PsycleFace.text(.subheadline, weight: .semibold))
            .foregroundColor(surface.ink2)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

// MARK: - Home Screen: small

struct PsycleSmallLayout: View {
    let facts: PsycleClassFacts?
    let now: Date
    let surface: PsycleSurface

    var body: some View {
        Group {
            if let facts = facts {
                // Tallest first. What the widget is FOR is when, what, where
                // and which seat — so on a short widget (small phones, a long
                // class name, larger text) the COUNTDOWN is the row to lose:
                // the time and the day are already there. Then the time steps
                // down a size — the WHOLE class name outranks big digits. Only
                // then is the name shortened to its head ("REFORMER PILATES"),
                // on two lines and finally on one. The place and the seat stay
                // throughout, and no step cuts a name mid-word while a later
                // one could still show it whole.
                ViewThatFits(in: .vertical) {
                    stack(facts, timeSize: 38, showCountdown: true, titleLines: 3)
                    stack(facts, timeSize: 38, showCountdown: false, titleLines: 3)
                    stack(facts, timeSize: 30, showCountdown: false, titleLines: 3)
                    stack(facts, timeSize: 30, showCountdown: false, titleLines: 2, shortTitle: true)
                    stack(facts, timeSize: 30, showCountdown: false, titleLines: 1, shortTitle: true)
                }
            } else {
                PsycleEmptyState(surface: surface)
            }
        }
        .psycleWidgetReading()
    }

    private func stack(_ facts: PsycleClassFacts, timeSize: CGFloat, showCountdown: Bool, titleLines: Int, shortTitle: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(facts.clock)
                    .font(PsycleFace.time(timeSize))
                    .foregroundColor(surface.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .layoutPriority(1)
                    .widgetAccentable(surface.flat)
                if let start = facts.start {
                    // Never the one to give way: a squeezed day became "…".
                    Text(PsycleClock.weekday(start))
                        .font(PsycleFace.label(15))
                        .foregroundColor(surface.ink2)
                        .lineLimit(1)
                        .fixedSize()
                        .layoutPriority(2)
                }
            }
            // Digits have no descenders and sit well below the top of their
            // line box: hand that empty space back (the widget is 126pt tall
            // inside its margins, and a row is ~15). The cap line then meets
            // the content margin, as the other rows' text does.
            .padding(.top, -(timeSize * 0.16))
            .padding(.bottom, -(timeSize * 0.12))
            if showCountdown, let start = facts.start {
                PsycleCountdownLine(start: start, now: now)
                    .font(PsycleFace.text(.caption, weight: .semibold))
                    .foregroundColor(surface.accent)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }
            Spacer(minLength: 6)
            PsycleClassHead(facts: facts, surface: surface, tile: 24,
                            font: PsycleFace.text(.subheadline, weight: .bold),
                            wrapFont: PsycleFace.text(.footnote, weight: .bold),
                            smallFont: PsycleFace.text(.caption, weight: .bold),
                            lines: titleLines, short: shortTitle)
            if !facts.whoWhere.isEmpty {
                // "Maya · Shoreditch", or just the place when both do not fit.
                ViewThatFits(in: .horizontal) {
                    Text(facts.whoWhere).lineLimit(1)
                    Text(facts.place.isEmpty ? facts.instructor : facts.place).lineLimit(1)
                }
                .font(PsycleFace.text(.caption2))
                .foregroundColor(surface.ink2)
                .padding(.top, 2)
            }
            if let seat = facts.seat {
                PsycleSeatChip(text: seat, surface: surface, compact: true)
                    .padding(.top, 5)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Home Screen: medium

struct PsycleMediumLayout: View {
    let facts: PsycleClassFacts?
    let now: Date
    let weekCount: Int
    let surface: PsycleSurface

    var body: some View {
        Group { content }.psycleWidgetReading()
    }

    @ViewBuilder
    private var content: some View {
        if let facts = facts {
            HStack(alignment: .top, spacing: 16) {
                // The time column, as on the class card.
                VStack(alignment: .leading, spacing: 0) {
                    if let start = facts.start {
                        Text(PsycleClock.weekday(start))
                            .font(PsycleFace.label(15))
                            .foregroundColor(surface.ink2)
                    }
                    Text(facts.clock)
                        .font(PsycleFace.time(46))
                        .foregroundColor(surface.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .widgetAccentable(surface.flat)
                    Spacer(minLength: 4)
                    if let start = facts.start {
                        PsycleCountdownLine(start: start, now: now)
                            .font(PsycleFace.text(.caption, weight: .semibold))
                            .foregroundColor(surface.accent)
                            .lineLimit(1)
                            .minimumScaleFactor(0.75)
                    }
                }
                .frame(width: 112, alignment: .leading)

                // The whole class name on up to three lines where the card has
                // the height (it has, at the default text size, on every
                // phone); with larger text on a 148pt-tall card it has not, and
                // the name is shortened to its head rather than pushing the
                // seat out of the card or ending mid-word.
                ViewThatFits(in: .vertical) {
                    detail(facts, titleLines: 3, shortTitle: false)
                    detail(facts, titleLines: 2, shortTitle: true)
                    detail(facts, titleLines: 1, shortTitle: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        } else {
            PsycleEmptyState(surface: surface)
        }
    }

    private func detail(_ facts: PsycleClassFacts, titleLines: Int, shortTitle: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            PsycleClassHead(facts: facts, surface: surface, tile: 28,
                            font: PsycleFace.text(.headline, weight: .bold),
                            wrapFont: PsycleFace.text(.subheadline, weight: .bold),
                            smallFont: PsycleFace.text(.footnote, weight: .bold),
                            lines: titleLines, short: shortTitle)
            if !facts.whoWhere.isEmpty {
                Text(facts.whoWhere)
                    .font(PsycleFace.text(.subheadline))
                    .foregroundColor(surface.ink2)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
            }
            Spacer(minLength: 4)
            // The seat is the member's own; "12 this week" is what gives way
            // when both do not fit (two seats on a 4.7-inch phone squeezed the
            // chip to "Beds 12 &…").
            ViewThatFits(in: .horizontal) {
                seatRow(facts, showWeek: true)
                seatRow(facts, showWeek: false)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func seatRow(_ facts: PsycleClassFacts, showWeek: Bool) -> some View {
        HStack(alignment: .center, spacing: 8) {
            if let seat = facts.seat {
                // Offered its width FIRST: an HStack shares the row out evenly
                // to begin with, and a label that can shrink took the smaller
                // share and shrank — with room to spare beside it.
                PsycleSeatChip(text: seat, surface: surface)
                    .layoutPriority(1)
            }
            Spacer(minLength: 0)
            if showWeek, weekCount > 0 {
                Text("\(weekCount) this week")
                    .font(PsycleFace.text(.caption2, weight: .semibold))
                    .foregroundColor(surface.ink2)
                    .lineLimit(1)
            }
        }
    }
}

// MARK: - Lock Screen layouts

// ── accessory-views:start ── (plain values only: no entry, no snapshot types)

/// One line of text at the largest of three sizes that shows ALL of it.
/// ViewThatFits takes the first option whose full, unwrapped width fits; the
/// last one is the floor and may tighten and shrink a little before it
/// finally truncates. A Lock Screen line should step down a size rather than
/// end in "…".
struct PsycleFittedLine: View {
    let text: Text
    let large: Font
    let medium: Font
    let small: Font

    var body: some View {
        ViewThatFits(in: .horizontal) {
            text.font(large).lineLimit(1)
            text.font(medium).lineLimit(1)
            text.font(small).lineLimit(1).minimumScaleFactor(0.75).allowsTightening(true)
        }
    }
}

/// Lock Screen rectangle, three lines: the class / when + seat / where.
/// The seat rides with the time so the location has a line to itself — the
/// old "Oxford Circus · Bike 12" line was the one that got cut off. The class
/// line leads with the type's pictogram. The system draws this family in one
/// colour (vibrant), so there is no tile and no fill: the mark is a stroke.
struct PsycleRectangularAccessory: View {
    let type: PsycleClassType
    let title: String
    let when: Date?
    let seat: String?
    let place: String

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            // The class line steps down as PsycleFittedLine does, with the
            // pictogram leading at every size. Its LAST step is the title alone,
            // exactly as it was before the mark existed: the mark costs ~19pt,
            // and must never be what pushes a long class name into "…".
            ViewThatFits(in: .horizontal) {
                marked(PsycleFace.text(.headline, weight: .semibold))
                marked(PsycleFace.text(.subheadline, weight: .semibold))
                marked(PsycleFace.text(.caption, weight: .semibold))
                Text(title)
                    .font(PsycleFace.text(.caption, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                    .allowsTightening(true)
            }
            .widgetAccentable()
            if let whenLine = whenLine {
                PsycleFittedLine(text: whenLine,
                                 large: PsycleFace.text(.subheadline),
                                 medium: PsycleFace.text(.footnote),
                                 small: PsycleFace.text(.caption2))
            }
            if !place.isEmpty {
                PsycleFittedLine(text: Text(place),
                                 large: PsycleFace.text(.caption),
                                 medium: PsycleFace.text(.caption2),
                                 small: PsycleFace.text(.caption2))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Pictogram + class name on one unwrapped line, in `font`.
    private func marked(_ font: Font) -> some View {
        HStack(alignment: .center, spacing: 4) {
            PsyclePictogramView(type: type, size: 15)
            Text(title).font(font).lineLimit(1)
        }
    }

    /// "Thu 18:30 · Bike 12"
    private var whenLine: Text? {
        let seatText = (seat ?? "").isEmpty ? nil : seat
        switch (when, seatText) {
        case let (when?, seat?):
            return Text("\(PsycleClock.dayTime(when)) · \(seat)")
        case let (when?, nil):
            return Text(PsycleClock.dayTime(when))
        case let (nil, seat?):
            return Text(seat)
        default:
            return nil
        }
    }
}

/// The single line above the clock. The system sets its font, so the only
/// lever is length: the time leads, the weekday is dropped for a class today,
/// and a long class name keeps just the part before its colon
/// ("REFORMER PILATES: SCULPT 50" → "REFORMER PILATES").
///
/// This family draws Text and an Image and nothing else — a SwiftUI Shape is
/// simply left out. So the pictogram is handed over as a small template image
/// (`glyph`, drawn from the same Shape); with no image it is the text alone.
struct PsycleInlineAccessory: View {
    let title: String
    let when: Date?
    let now: Date
    var glyph: Image?

    var body: some View {
        if let glyph = glyph {
            Label { Text(line) } icon: { glyph }
        } else {
            Text(line)
        }
    }

    var line: String {
        let name = Self.shortTitle(title)
        guard let when = when else { return name }
        let time = Calendar.current.isDate(when, inSameDayAs: now) ? PsycleClock.time(when) : PsycleClock.dayTime(when)
        return "\(time) · \(name)"
    }

    static func shortTitle(_ title: String, limit: Int = 18) -> String {
        let trimmed = title.trimmingCharacters(in: .whitespaces)
        guard trimmed.count > limit, let colon = trimmed.firstIndex(of: ":") else { return trimmed }
        let head = trimmed[..<colon].trimmingCharacters(in: .whitespaces)
        return head.isEmpty ? trimmed : head
    }
}

// ── accessory-views:end ──

// MARK: - Live Activity card (Lock Screen / banner)

/// The class component on the Lock Screen: the start time leads with the live
/// countdown under it, then tile + class, "Instructor · Studio" and the seat.
struct PsycleActivityCard: View {
    let facts: PsycleClassFacts
    /// The class has started (the card is about to be taken down).
    let started: Bool
    /// now…start, already clamped so it can never be an invalid range.
    let countdown: ClosedRange<Date>
    let surface: PsycleSurface

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 0) {
                Text(facts.clock)
                    .font(PsycleFace.time(40))
                    .foregroundColor(surface.ink)
                    .lineLimit(1)
                    .widgetAccentable(surface.flat)
                Group {
                    if started {
                        Text("In class")
                    } else {
                        Text(timerInterval: countdown, countsDown: true)
                            .monospacedDigit()
                    }
                }
                .font(PsycleFace.label(17))
                .foregroundColor(surface.accent)
                .lineLimit(1)
            }
            // A timer Text asks for all the width there is; the column is
            // pinned to the width of the time above it instead.
            .frame(width: 100, alignment: .leading)

            VStack(alignment: .leading, spacing: 4) {
                PsycleClassHead(facts: facts, surface: surface, tile: 28,
                                font: PsycleFace.text(.headline, weight: .bold),
                                wrapFont: PsycleFace.text(.subheadline, weight: .bold),
                                smallFont: PsycleFace.text(.footnote, weight: .bold))
                if !facts.whoWhere.isEmpty {
                    Text(facts.whoWhere)
                        .font(PsycleFace.text(.footnote))
                        .foregroundColor(surface.ink2)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                }
                if let seat = facts.seat {
                    PsycleSeatChip(text: seat, surface: surface, compact: true)
                        .padding(.top, 1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        // A Live Activity is at most 160pt tall and cannot scroll either.
        .psycleWidgetReading()
    }
}
