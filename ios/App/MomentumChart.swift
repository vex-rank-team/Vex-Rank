import SwiftUI
import Charts
import VEXRankKit

/// A team's run through one tournament, drawn the way the season rating curve
/// is drawn: the line grows in when it first appears, on a fixed axis so
/// nothing reflows under it.
@available(iOS 17.0, *)
struct MomentumChart: View {
    let points: [MomentumPoint]
    let accent: Color
    /// VEX IQ: each point is a shared score, not a running margin, so there is
    /// no "level" line and no won/lost colouring.
    var isScoreSeries = false

    private static let duration: Double = 1.1

    @State private var start: Date?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if let start {
                TimelineView(.animation) { timeline in
                    chart(progress: RatingCurve.eased(timeline.date.timeIntervalSince(start) / Self.duration))
                }
            } else {
                chart(progress: 0)
            }
        }
        // Once. Without the guard, coming back from a match replayed the whole
        // draw over a chart the reader had already read.
        .onAppear {
            guard start == nil else { return }
            start = reduceMotion ? .distantPast : .now
        }
    }

    private func chart(progress: Double) -> some View {
        let drawn = TeamMomentum.growing(points, progress: progress)
        return Chart {
            // Level is the reading that matters, so the line for it is drawn
            // whatever the data does.
            if !isScoreSeries {
                RuleMark(y: .value("Level", 0))
                    .foregroundStyle(.white.opacity(0.18))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
            }

            ForEach(Array(drawn.enumerated()), id: \.offset) { _, step in
                LineMark(x: .value("Match", step.x), y: .value("Momentum", step.y))
                    .foregroundStyle(accent)
                    .lineStyle(StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
                    .interpolationMethod(.monotone)
            }
            // Only settled matches get a dot; the moving tip is not one.
            ForEach(drawn.compactMap(\.point)) { point in
                PointMark(x: .value("Match", Double(point.match)), y: .value("Momentum", Double(point.cumulative)))
                    .foregroundStyle(isScoreSeries ? accent : colour(point.outcome))
                    .symbolSize(50)
            }
        }
        .chartXScale(domain: 0.5...(Double(points.count) + 0.5))
        .chartYScale(domain: TeamMomentum.range(points))
        .chartXAxis {
            AxisMarks(values: Array(1...max(1, points.count))) { mark in
                AxisValueLabel {
                    Text("\(mark.as(Int.self) ?? 0)").font(.caption2).fixedSize()
                }
            }
        }
        .chartYAxis {
            AxisMarks { _ in
                AxisGridLine().foregroundStyle(.white.opacity(0.08))
                AxisValueLabel().font(.caption2)
            }
        }
    }

    private func colour(_ outcome: TeamMatch.Outcome) -> Color {
        switch outcome {
        case .won: return Color(.sRGB, red: 0.20, green: 0.83, blue: 0.60)
        case .lost: return Color(.sRGB, red: 0.98, green: 0.44, blue: 0.52)
        default: return .gray
        }
    }
}
