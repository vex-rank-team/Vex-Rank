import Foundation

/// Single-stroke (centreline) glyph paths, ported verbatim from
/// website/lib/stroke-glyphs.mjs so the app and the site draw a team number
/// with the same hand.
///
/// A normal font stores the *outline* of a glyph, so tracing one draws the
/// boundary of every stem - both sides at once. Handwriting follows the pen's
/// centreline in stroke order, which is what plotter and engraving fonts
/// encode, and what these are.
///
/// Coordinate space: each glyph occupies x 0..60, y 0..100, cap height at y=6
/// and baseline at y=95. Every entry is an ordered list of strokes, each drawn
/// in the direction a right-handed writer would move.
public enum StrokeGlyphs {
    /// Horizontal advance per character, in glyph units.
    public static let advance: Double = 68
    /// Nominal glyph height, in glyph units.
    public static let height: Double = 100

    public static let glyphs: [Character: [String]] = [
        "0": ["M30,6 C13,6 5,27 5,50 C5,73 13,95 30,95 C47,95 55,73 55,50 C55,27 47,6 30,6"],
        "1": ["M12,24 L30,6 L30,95"],
        "2": ["M7,26 C7,10 22,3 35,8 C51,15 43,33.7 34,49 L7,95 L54,95"],
        "3": ["M8,18 C15,6 35,2 45,13 C55,24 46,41 30,46 C48,46 59,61 52,77 C45,93 21,98 7,86"],
        "4": ["M41,6 L5,67 L55,67", "M41,6 L41,95"],
        "5": ["M49,6 L16,6 L12,43 C25,34 45,39 51,55 C57,73 44,93 24,94 C16,95 10,92 6,86"],
        "6": ["M47,11 C31,2 12,19 8,45 C4,73 13,95 30,95 C47,95 55,80 50,66 C45,52 27,46 15,57"],
        "7": ["M6,7 L54,7 L23,95"],
        "8": ["M30,48 C13,44 8,30 12,18 C17,5 44,5 49,18 C53,30 47,44 30,48 C11,53 3,69 10,83 C17,97 44,97 51,83 C58,69 49,53 30,48"],
        "9": ["M51,53 C43,63 22,65 14,52 C6,39 11,20 27,10 C43,0 55,15 55,41 C55,71 46,89 25,95"],
        "A": ["M5,95 L30,6 L55,95", "M15,63 L45,63"],
        "B": ["M11,6 L11,95", "M11,6 L36,6 C53,6 53,45 36,48 L11,48", "M11,48 L40,48 C59,48 59,95 38,95 L11,95"],
        "C": ["M52,20 C44,8 26,2 16,14 C4,28 4,72 16,86 C26,98 44,92 52,80"],
        "D": ["M11,6 L11,95", "M11,6 L30,6 C55,6 59,95 28,95 L11,95"],
        "E": ["M12,6 L12,95", "M12,6 L51,6", "M12,50 L42,50", "M12,95 L51,95"],
        "F": ["M12,95 L12,6 L51,6", "M12,50 L42,50"],
        "G": ["M52,20 C44,8 26,2 16,14 C4,28 4,72 16,86 C28,98 49,92 52,74 L52,56 L34,56"],
        "H": ["M10,6 L10,95", "M10,50 L50,50", "M50,6 L50,95"],
        "I": ["M14,6 L46,6", "M30,6 L30,95", "M14,95 L46,95"],
        "J": ["M46,6 L46,72 C46,92 25,99 13,86"],
        "K": ["M12,6 L12,95", "M51,6 L12,53", "M25,42 L53,95"],
        "L": ["M12,6 L12,95 L51,95"],
        "M": ["M7,95 L7,6 L30,58 L53,6 L53,95"],
        "N": ["M10,95 L10,6 L50,95 L50,6"],
        "O": ["M30,6 C12,6 4,28 4,50 C4,72 12,95 30,95 C48,95 56,72 56,50 C56,28 48,6 30,6"],
        "P": ["M12,95 L12,6", "M12,6 L36,6 C56,6 56,52 34,52 L12,52"],
        "Q": ["M30,6 C12,6 4,28 4,50 C4,72 12,95 30,95 C48,95 56,72 56,50 C56,28 48,6 30,6", "M36,73 L57,99"],
        "R": ["M12,95 L12,6", "M12,6 L36,6 C54,6 54,48 34,48 L12,48", "M31,48 L53,95"],
        "S": ["M51,18 C44,6 22,2 14,14 C6,27 15,41 30,48 C46,56 55,69 48,82 C41,96 17,96 7,84"],
        "T": ["M7,6 L53,6", "M30,6 L30,95"],
        "U": ["M10,6 L10,66 C10,88 24,96 30,96 C36,96 50,88 50,66 L50,6"],
        "V": ["M7,6 L30,95 L53,6"],
        "W": ["M3,6 L16,95 L30,36 L44,95 L57,6"],
        "X": ["M10,6 L50,95", "M50,6 L10,95"],
        "Y": ["M10,6 L30,50 L50,6", "M30,50 L30,95"],
        "Z": ["M10,6 L50,6 L10,95 L50,95"],
    ]


    /// A drafting alphabet: the same box and baseline as `glyphs`, but built
    /// from straight segments only, so the two can be swapped for one another
    /// without anything else changing.
    ///
    /// The zero is slashed. Squared off, an unslashed zero and a capital O are
    /// the same rectangle, and team numbers are exactly the place that matters.
    public static let blockGlyphs: [Character: [String]] = [
        "0": ["M12,6 L48,6 L48,95 L12,95 Z", "M17,88 L43,13"],
        "1": ["M14,20 L30,6 L30,95", "M14,95 L46,95"],
        "2": ["M10,16 L10,6 L50,6 L50,50 L10,95 L50,95"],
        "3": ["M10,6 L50,6 L50,95 L10,95", "M18,50 L50,50"],
        "4": ["M42,95 L42,6 L8,62 L54,62"],
        "5": ["M50,6 L12,6 L12,48 L50,48 L50,95 L10,95"],
        "6": ["M50,6 L12,6 L12,95 L50,95 L50,50 L12,50"],
        "7": ["M8,6 L52,6 L24,95"],
        "8": ["M12,6 L48,6 L48,95 L12,95 Z", "M12,50 L48,50"],
        "9": ["M48,95 L48,6 L12,6 L12,50 L48,50"],
        "A": ["M8,95 L30,6 L52,95", "M17,60 L43,60"],
        "B": ["M12,6 L12,95", "M12,6 L44,6 L44,48 L12,48", "M12,48 L48,48 L48,95 L12,95"],
        "C": ["M50,6 L10,6 L10,95 L50,95"],
        "D": ["M12,6 L40,6 L50,18 L50,83 L40,95 L12,95 Z"],
        "E": ["M50,6 L12,6 L12,95 L50,95", "M12,50 L42,50"],
        "F": ["M12,95 L12,6 L50,6", "M12,50 L42,50"],
        "G": ["M50,6 L10,6 L10,95 L50,95 L50,54 L30,54"],
        "H": ["M10,6 L10,95", "M10,50 L50,50", "M50,6 L50,95"],
        "I": ["M14,6 L46,6", "M30,6 L30,95", "M14,95 L46,95"],
        "J": ["M46,6 L46,95 L12,95 L12,72"],
        "K": ["M12,6 L12,95", "M50,6 L12,52", "M24,42 L52,95"],
        "L": ["M12,6 L12,95 L50,95"],
        "M": ["M8,95 L8,6 L30,58 L52,6 L52,95"],
        "N": ["M10,95 L10,6 L50,95 L50,6"],
        "O": ["M10,6 L50,6 L50,95 L10,95 Z"],
        "P": ["M12,95 L12,6 L46,6 L46,52 L12,52"],
        "Q": ["M10,6 L50,6 L50,95 L10,95 Z", "M34,72 L54,99"],
        "R": ["M12,95 L12,6 L46,6 L46,48 L12,48", "M30,48 L52,95"],
        "S": ["M50,6 L12,6 L12,48 L48,48 L48,95 L10,95"],
        "T": ["M7,6 L53,6", "M30,6 L30,95"],
        "U": ["M10,6 L10,95 L50,95 L50,6"],
        "V": ["M8,6 L30,95 L52,6"],
        "W": ["M4,6 L16,95 L30,40 L44,95 L56,6"],
        "X": ["M10,6 L50,95", "M50,6 L10,95"],
        "Y": ["M10,6 L30,50 L50,6", "M30,50 L30,95"],
        "Z": ["M10,6 L50,6 L10,95 L50,95"],
    ]

    /// Ordered strokes for one character, or nil when it has no glyph.
    public static func strokes(for character: Character) -> [String]? {
        glyphs[Character(character.uppercased())]
    }

    /// True when every character can be drawn; callers fall back to text
    /// otherwise rather than rendering a gap.
    public static func canDraw(_ text: String) -> Bool {
        !text.isEmpty && text.allSatisfy { strokes(for: $0) != nil }
    }
}
