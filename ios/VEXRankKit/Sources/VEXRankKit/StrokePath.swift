#if canImport(SwiftUI)
import SwiftUI
import CoreGraphics

/// Parses the small SVG path subset the glyph set uses - absolute `M`, `L` and
/// `C` only - into a SwiftUI `Path`, and measures it.
///
/// Length matters as much as shape here: stroke duration is proportional to the
/// stroke's own length, which is what keeps a long diagonal slower than a short
/// crossbar. A fixed duration per stroke reads as mechanical.
public enum StrokePathParser {
    public struct Parsed {
        public let path: Path
        /// Arc length in glyph units, cubics flattened by subdivision.
        public let approximateLength: Double
    }

    public static func parse(_ d: String) -> Parsed {
        var path = Path()
        var length = 0.0
        var cursor = CGPoint.zero
        // Where the current subpath began, so `Z` knows what it is closing.
        var subpathStart = CGPoint.zero

        // Commands are single letters followed by comma/space separated numbers.
        var command: Character = "M"
        var numbers: [Double] = []

        func flush() {
            switch command {
            case "M":
                guard numbers.count >= 2 else { break }
                cursor = CGPoint(x: numbers[0], y: numbers[1])
                subpathStart = cursor
                path.move(to: cursor)
            case "L":
                var index = 0
                while index + 1 < numbers.count {
                    let point = CGPoint(x: numbers[index], y: numbers[index + 1])
                    length += hypot(point.x - cursor.x, point.y - cursor.y)
                    path.addLine(to: point)
                    cursor = point
                    index += 2
                }
            case "C":
                var index = 0
                while index + 5 < numbers.count {
                    let c1 = CGPoint(x: numbers[index], y: numbers[index + 1])
                    let c2 = CGPoint(x: numbers[index + 2], y: numbers[index + 3])
                    let end = CGPoint(x: numbers[index + 4], y: numbers[index + 5])
                    length += cubicLength(from: cursor, c1: c1, c2: c2, to: end)
                    path.addCurve(to: end, control1: c1, control2: c2)
                    cursor = end
                    index += 6
                }
            case "Z":
                // A closed outline joins its own start rather than ending
                // there. Without this the first and last points are two
                // separate stroke ends, and a square cap leaves a visible
                // notch at the corner where they meet - which is what a
                // squared-off zero is made of.
                length += hypot(subpathStart.x - cursor.x, subpathStart.y - cursor.y)
                path.closeSubpath()
                cursor = subpathStart
            default:
                break
            }
            numbers.removeAll(keepingCapacity: true)
        }

        var token = ""
        func takeNumber() {
            if let value = Double(token) { numbers.append(value) }
            token.removeAll(keepingCapacity: true)
        }

        for character in d {
            if character.isLetter {
                takeNumber()
                flush()
                command = character
            } else if character == "," || character == " " {
                takeNumber()
            } else {
                token.append(character)
            }
        }
        takeNumber()
        flush()

        return Parsed(path: path, approximateLength: length)
    }

    /// Flattening by fixed subdivision: 24 segments is well inside a pixel at
    /// the sizes these are drawn, and the value only feeds a duration.
    private static func cubicLength(from start: CGPoint, c1: CGPoint, c2: CGPoint, to end: CGPoint) -> Double {
        let steps = 24
        var previous = start
        var total = 0.0
        for step in 1...steps {
            let t = Double(step) / Double(steps)
            let point = cubicPoint(start, c1, c2, end, t)
            total += hypot(point.x - previous.x, point.y - previous.y)
            previous = point
        }
        return total
    }

    private static func cubicPoint(_ p0: CGPoint, _ p1: CGPoint, _ p2: CGPoint, _ p3: CGPoint, _ t: Double) -> CGPoint {
        let u = 1 - t
        let a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t
        return CGPoint(
            x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
            y: a * p0.y + b * p1.y + c * p2.y + d * p3.y
        )
    }
}
#endif
