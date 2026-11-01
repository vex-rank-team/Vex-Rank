import SwiftUI
import VEXRankKit

/// A team's strengths at one event, one axis per measure, each placed against
/// the rest of its division: the outer edge is the best team there, the centre
/// the worst, and the dashed ring the middle of the field.
///
/// Grows out from the centre when it first appears, as the rating curves draw
/// themselves in; with Reduce Motion it is simply there.
@available(iOS 17.0, *)
struct StrengthHexagon: View {
    let axes: [StrengthAxis]
    let accent: Color

    @State private var grown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let rings: [Double] = [0.25, 0.5, 0.75, 1]

    var body: some View {
        GeometryReader { geo in
            let size = geo.size
            // Room around the shape for the labels.
            let radius = min(size.width * 0.30, size.height * 0.36)
            let centre = CGPoint(x: size.width / 2, y: size.height / 2)
            let count = axes.count

            ZStack {
                ForEach(Self.rings, id: \.self) { ring in
                    polygon(count: count, centre: centre, radius: radius) { _ in ring }
                        .stroke(Color.white.opacity(ring == 0.5 ? 0.32 : 0.1),
                                style: StrokeStyle(lineWidth: 1, dash: ring == 0.5 ? [4, 4] : []))
                }
                Path { path in
                    for i in 0..<count {
                        path.move(to: centre)
                        path.addLine(to: point(i, count, centre, radius, 1))
                    }
                }
                .stroke(Color.white.opacity(0.1), lineWidth: 1)

                Group {
                    let shape = polygon(count: count, centre: centre, radius: radius) { axes[$0].score ?? 0 }
                    shape.fill(accent.opacity(0.22))
                    shape.stroke(accent, style: StrokeStyle(lineWidth: 2.5, lineJoin: .round))
                    ForEach(Array(axes.enumerated()), id: \.element.id) { i, axis in
                        if let score = axis.score {
                            Circle()
                                .fill(accent)
                                .frame(width: 7, height: 7)
                                .position(point(i, count, centre, radius, score))
                        }
                    }
                }
                .scaleEffect(grown ? 1 : 0.02, anchor: UnitPoint(x: centre.x / max(size.width, 1),
                                                                 y: centre.y / max(size.height, 1)))

                ForEach(Array(axes.enumerated()), id: \.element.id) { i, axis in
                    VStack(spacing: 1) {
                        Text(axis.label.uppercased())
                            .font(.system(size: 10, weight: .semibold)).tracking(0.8)
                            .foregroundStyle(.secondary)
                        Text(axis.display)
                            .font(.system(size: 12, weight: .medium, design: .monospaced))
                            .foregroundStyle(axis.score == nil ? .tertiary : .primary)
                    }
                    .fixedSize()
                    .position(point(i, count, centre, radius, 1.36))
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Strengths")
        .accessibilityValue(axes.map { axis in
            axis.place.map { "\(axis.label) \(axis.display), \(ordinal($0)) of \(axis.of)" }
                ?? "\(axis.label), no data yet"
        }.joined(separator: "; "))
        .onAppear {
            guard !grown else { return }
            if reduceMotion { grown = true } else {
                withAnimation(.spring(duration: 0.9, bounce: 0.15)) { grown = true }
            }
        }
    }

    /// Axis `index` of `count`, clockwise from the top.
    private func point(_ index: Int, _ count: Int, _ centre: CGPoint, _ radius: CGFloat, _ fraction: Double) -> CGPoint {
        let angle = -Double.pi / 2 + Double(index) * 2 * .pi / Double(max(count, 1))
        return CGPoint(x: centre.x + CGFloat(cos(angle) * fraction) * radius,
                       y: centre.y + CGFloat(sin(angle) * fraction) * radius)
    }

    private func polygon(count: Int, centre: CGPoint, radius: CGFloat, fraction: @escaping (Int) -> Double) -> Path {
        Path { path in
            guard count > 0 else { return }
            path.move(to: point(0, count, centre, radius, fraction(0)))
            for i in 1..<count { path.addLine(to: point(i, count, centre, radius, fraction(i))) }
            path.closeSubpath()
        }
    }
}

func ordinal(_ n: Int) -> String {
    let tail = n % 100
    let suffix = (11...13).contains(tail) ? "th" : ["th", "st", "nd", "rd"][safe: n % 10] ?? "th"
    return "\(n)\(suffix)"
}

private extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
