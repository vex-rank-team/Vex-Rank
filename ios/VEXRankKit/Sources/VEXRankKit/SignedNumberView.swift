#if canImport(SwiftUI)
import SwiftUI

/// Writes a team number one stroke at a time, in stroke order, at a constant
/// pen speed that eases off toward the final character.
///
/// Uses `Path.trim(from:to:)` rather than the web's stroke-dasharray. `trim` is
/// the direct equivalent and is better behaved: at 0 it draws genuinely
/// nothing, whereas a zero-length dash with a round cap paints a dot - the
/// defect that left a mark on the Y before it was written.
///
/// Each stroke is its own `Shape` with the trim as its `animatableData`. The
/// first version drew all the strokes in one `Canvas`, which looked right but
/// never animated: a Canvas re-renders when state changes, but SwiftUI only
/// interpolates values it can see as animatable attributes, and state read
/// inside the drawing closure is not one - so every stroke jumped from 0 to 1
/// on the first frame and the number simply appeared.
@available(iOS 17.0, macOS 14.0, *)
public struct SignedNumberView: View {
    private let text: String
    private let accentFrom: Int?
    private let accent: Color
    private let ink: Color
    private let font: StrokeFont

    private var penWidth: CGFloat { CGFloat(font.hand.penWidth) }

    /// Ordered strokes across the whole string, already positioned at their
    /// character's offset, each tagged with the index of that character.
    ///
    /// Parsed once here rather than inside the shapes: the strokes are redrawn
    /// on every frame of the animation, and re-parsing a path string per stroke
    /// per frame is work that only ever produces the same answer.
    private let strokes: [(character: Int, path: Path, length: Double)]

    /// The inked bounds in glyph units, including the half stroke width that a
    /// round cap adds beyond each end of the path. Measured rather than assumed
    /// to be `count * advance`: a glyph can reach past its own advance (X does),
    /// and the caps add to that, which is what pushed the last character off the
    /// right edge of the screen.
    private let bounds: CGRect

    public init(text: String, font: StrokeFont = .marker, accentFrom: Int? = nil,
                ink: Color = .primary, accent: Color = .red) {
        self.text = text
        self.font = font
        self.accentFrom = accentFrom
        self.ink = ink
        self.accent = accent

        let lean = font.lean

        var collected: [(character: Int, path: Path, length: Double)] = []
        for (index, character) in Array(text).enumerated() {
            let offset = CGAffineTransform(translationX: CGFloat(Double(index) * font.advance), y: 0)
            for stroke in font.strokes(for: character) ?? [] {
                let parsed = StrokePathParser.parse(stroke)
                // Length is measured before the shear: it drives the pen's
                // timing, and a slant should change the look, not the pace.
                collected.append((index, parsed.path.applying(lean.concatenating(offset)),
                                  parsed.approximateLength))
            }
        }
        self.strokes = collected

        let inked = collected.reduce(CGRect.null) { $0.union($1.path.boundingRect) }
        self.bounds = inked.isNull
            ? CGRect(x: 0, y: 0, width: 1, height: font.height)
            : inked.insetBy(dx: -CGFloat(font.hand.penWidth) / 2, dy: -CGFloat(font.hand.penWidth) / 2)
    }

    @State private var progress: [Double] = []
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var characterCount: Int { Array(text).count }

    public var body: some View {
        if !font.canDraw(text) {
            // Falls back to text rather than rendering a gap.
            Text(text).font(.system(size: 44, weight: .semibold, design: .rounded))
        } else {
            GeometryReader { geometry in
                // Fits the inked bounds inside whatever box the caller gives us.
                // `aspectRatio` used to do this, but it sizes from the child's
                // ideal size and a GeometryReader has none, so it stopped
                // constraining anything once the Canvas was replaced.
                let unit = min(geometry.size.height / bounds.height,
                               geometry.size.width / bounds.width)
                ZStack(alignment: .topLeading) {
                    ForEach(strokes.indices, id: \.self) { index in
                        StrokeShape(
                            stroke: strokes[index].path,
                            origin: bounds.origin,
                            unit: unit,
                            progress: progress.indices.contains(index) ? progress[index] : 1
                        )
                        .stroke(
                            (accentFrom.map { strokes[index].character >= $0 } ?? false) ? accent : ink,
                            style: StrokeStyle(lineWidth: penWidth * unit,
                                               lineCap: font.hand.roundCap ? .round : .square,
                                               lineJoin: font.hand.roundCap ? .round : .miter)
                        )
                    }
                }
            }
            .accessibilityHidden(true)
            .onAppear(perform: write)
        }
    }

    private func write() {
        guard progress.isEmpty else { return }
        guard !reduceMotion else {
            progress = Array(repeating: 1, count: strokes.count)
            return
        }
        progress = Array(repeating: 0, count: strokes.count)

        // The pen's character comes from the font: the marker eases off through
        // the final character the way a real hand does, while the drafting pen
        // holds an even pace and pauses longer between strokes. The drag curve
        // is keyed to the character, not the stroke, because a hand slows
        // through the whole of the last character rather than only its last
        // stroke.
        let penSpeed = font.hand.secondsPerUnit
        let penLift = font.hand.lift
        let finalDrag = font.hand.finalDrag
        let lastCharacter = Double(max(1, characterCount - 1))

        var delay = 0.18
        for (index, stroke) in strokes.enumerated() {
            let through = Double(stroke.character) / lastCharacter
            let drag = 1 + finalDrag * pow(through, 1.7)
            let length = stroke.length
            let duration = max(0.12, length * penSpeed * drag)
            withAnimation(.timingCurve(0.32, 0, 0.35, 1, duration: duration).delay(delay)) {
                progress[index] = 1
            }
            delay += duration + penLift * drag
        }
    }
}

/// One pen stroke, trimmed to `progress`. Being a `Shape` is what makes it
/// animate: `animatableData` is interpolated frame by frame and `path(in:)` is
/// re-evaluated for each value.
@available(iOS 17.0, macOS 14.0, *)
private struct StrokeShape: Shape {
    let stroke: Path
    let origin: CGPoint
    let unit: CGFloat
    var progress: Double

    var animatableData: Double {
        get { progress }
        set { progress = newValue }
    }

    func path(in rect: CGRect) -> Path {
        let drawn = min(1, max(0, progress))
        guard drawn > 0 else { return Path() }
        let transform = CGAffineTransform(translationX: -origin.x, y: -origin.y)
            .concatenating(CGAffineTransform(scaleX: unit, y: unit))
        return stroke.applying(transform).trimmedPath(from: 0, to: drawn)
    }
}
#endif
