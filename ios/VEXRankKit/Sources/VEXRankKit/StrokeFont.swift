import Foundation

/// A single-stroke alphabet together with the hand that writes it.
///
/// The two belong in one type because they are not independent choices: a
/// technical alphabet drawn with the marker's easing looks like a mistake, and
/// the marker drawn with a drafting pen's even pace loses the thing that made
/// it feel written. Picking a font here picks both.
public struct StrokeFont: Identifiable, Sendable, Hashable {
    public let id: String
    public let name: String
    /// How the alphabet is described in the picker, one short line.
    public let detail: String
    public let glyphs: [Character: [String]]
    /// Horizontal advance per character, in glyph units.
    public let advance: Double
    /// Nominal glyph height, in glyph units.
    public let height: Double
    /// Rightward lean as a tangent: 0 is upright, 0.25 leans a quarter of a
    /// unit right for every unit of height above the baseline.
    public let slant: Double
    public let hand: Hand

    /// The pen, and how it moves.
    public struct Hand: Sendable, Hashable {
        /// Stroke width in glyph units.
        public let penWidth: Double
        /// Seconds per glyph unit travelled - the pen's speed.
        public let secondsPerUnit: Double
        /// Pause between strokes, as the pen lifts and moves.
        public let lift: Double
        /// How much the hand slows through the final character. 0 writes the
        /// last character at the same pace as the first.
        public let finalDrag: Double
        /// Round for a pen or marker, square for a chisel or technical nib.
        public let roundCap: Bool
    }

    public func strokes(for character: Character) -> [String]? {
        glyphs[Character(character.uppercased())]
    }

    /// True when every character can be drawn. Callers fall back to text rather
    /// than rendering a gap.
    public func canDraw(_ text: String) -> Bool {
        !text.isEmpty && text.allSatisfy { strokes(for: $0) != nil }
    }

    /// The hand the app has always written in: humanist, round-capped, easing
    /// off through the last character the way a real one does.
    public static let marker = StrokeFont(
        id: "marker", name: "Marker", detail: "Round, handwritten",
        glyphs: StrokeGlyphs.glyphs,
        advance: StrokeGlyphs.advance, height: StrokeGlyphs.height, slant: 0,
        hand: Hand(penWidth: 7, secondsPerUnit: 0.00092, lift: 0.056, finalDrag: 1.35, roundCap: true)
    )

    /// Drafting lettering: straight segments only, an even pace, and a longer
    /// pause between strokes - a hand placing lines rather than flowing.
    public static let block = StrokeFont(
        id: "block", name: "Block", detail: "Straight, technical",
        glyphs: StrokeGlyphs.blockGlyphs,
        advance: 66, height: StrokeGlyphs.height, slant: 0,
        hand: Hand(penWidth: 5.5, secondsPerUnit: 0.00115, lift: 0.1, finalDrag: 0.2, roundCap: false)
    )

    /// The marker's alphabet on a slope, written faster and with barely a lift
    /// between strokes. Sheared rather than separately drawn - the letterforms
    /// are the marker's, the lean and the pace are not.
    public static let slant = StrokeFont(
        id: "slant", name: "Slant", detail: "Leaning, quick",
        glyphs: StrokeGlyphs.glyphs,
        advance: StrokeGlyphs.advance, height: StrokeGlyphs.height, slant: 0.26,
        hand: Hand(penWidth: 6.5, secondsPerUnit: 0.00068, lift: 0.026, finalDrag: 0.9, roundCap: true)
    )

    public static let all: [StrokeFont] = [.marker, .block, .slant]

    public static func named(_ id: String) -> StrokeFont {
        all.first { $0.id == id } ?? .marker
    }

    /// The baseline the slant pivots around, so a leaning glyph still stands on
    /// the same line as an upright one.
    public static let baseline: Double = 95
}

#if canImport(CoreGraphics)
import CoreGraphics

extension StrokeFont {
    /// The shear that produces the lean, pivoting about the baseline so a
    /// leaning glyph still stands on the same line as an upright one instead of
    /// sliding off it.
    public var lean: CGAffineTransform {
        CGAffineTransform(a: 1, b: 0, c: -CGFloat(slant), d: 1,
                          tx: CGFloat(slant * StrokeFont.baseline), ty: 0)
    }
}
#endif

#if canImport(SwiftUI)
import SwiftUI

@available(iOS 17.0, macOS 14.0, *)
private struct NumberFontKey: EnvironmentKey {
    static let defaultValue = StrokeFont.marker
}

@available(iOS 17.0, macOS 14.0, *)
extension EnvironmentValues {
    public var numberFont: StrokeFont {
        get { self[NumberFontKey.self] }
        set { self[NumberFontKey.self] = newValue }
    }
}
#endif
