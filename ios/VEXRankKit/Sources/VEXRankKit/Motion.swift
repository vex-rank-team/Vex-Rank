import Foundation

/// The growing rating curve, as data rather than as a mask.
///
/// The obvious way to animate a line chart is to mask it and slide the mask
/// across, but a mask hides the axes and the labels along with the line, so the
/// box visibly reflows as it is revealed. The web app instead drew the axes
/// immediately and animated only the curve, and this does the same by feeding
/// the chart a shortened series: the axes come from a fixed domain, so they are
/// there from the first frame while the line grows into them.
public struct CurveSample: Identifiable, Sendable, Hashable {
    public let id: Int
    /// Position along the axis, in events rather than in time.
    ///
    /// The web plots the season on a categorical axis, so every event gets the
    /// same width whatever the gap before it. Plotting against the date instead
    /// bunches a cluster of events into a few pixels and draws the rating jump
    /// between them as a near-vertical spike, which is what made the iOS line
    /// look jagged beside the web's.
    public let x: Double
    public let date: Date
    public let rating: Double
    /// Points the rating moved at this event; the dot is coloured by its sign.
    public let change: Int
    /// False for the moving tip, which sits between two events and is not one.
    public let isEvent: Bool
}

public enum RatingCurve {
    /// The series truncated at `progress` (0...1), with the segment in progress
    /// cut part-way so the line advances smoothly instead of jumping a whole
    /// event at a time.
    public static func growing(_ history: [RatingPoint], progress: Double) -> [CurveSample] {
        let dated = ordered(history)
        guard dated.count > 1 else {
            return dated.enumerated().map {
                CurveSample(id: $0.offset, x: Double($0.offset), date: $0.element.date,
                            rating: $0.element.rating, change: $0.element.change, isEvent: true)
            }
        }

        let clamped = min(1, max(0, progress))
        guard clamped > 0 else { return [] }

        let position = clamped * Double(dated.count - 1)
        let whole = min(dated.count - 1, Int(position))
        var samples = dated.prefix(whole + 1).enumerated().map {
            CurveSample(id: $0.offset, x: Double($0.offset), date: $0.element.date,
                        rating: $0.element.rating, change: $0.element.change, isEvent: true)
        }

        let fraction = position - Double(whole)
        if fraction > 0, whole + 1 < dated.count {
            let from = dated[whole]
            let to = dated[whole + 1]
            samples.append(CurveSample(
                id: whole + 1,
                x: Double(whole) + fraction,
                date: from.date.addingTimeInterval(to.date.timeIntervalSince(from.date) * fraction),
                rating: from.rating + (to.rating - from.rating) * fraction,
                change: to.change,
                isEvent: false
            ))
        }
        return samples
    }

    /// The fixed axis domains, taken from the whole series so they do not move
    /// while the curve grows. The padding matches the web's 15% of the spread,
    /// with a floor so a flat season is not drawn on a hairline.
    public static func ratingDomain(_ history: [RatingPoint]) -> ClosedRange<Double> {
        let ratings = history.map { Double($0.rating) }
        guard let low = ratings.min(), let high = ratings.max() else { return 0...1 }
        let padding = max(15, (high - low) * 0.15)
        return (low - padding)...(high + padding)
    }

    /// Events in date order, which is the order the axis positions follow.
    public static func ordered(_ history: [RatingPoint]) -> [(date: Date, rating: Double, change: Int)] {
        history
            .compactMap { point in point.date.map { (date: $0, rating: Double(point.rating), change: point.change) } }
            .sorted { $0.date < $1.date }
    }

    /// The x domain, in event positions. Padded by a fifth of a step so the
    /// first and last dots are not cut in half by the edge of the plot.
    public static func eventDomain(_ history: [RatingPoint]) -> ClosedRange<Double> {
        let count = ordered(history).count
        guard count > 1 else { return -0.5...0.5 }
        return -0.2...(Double(count - 1) + 0.2)
    }

    /// Labels for a handful of evenly spaced events, so the axis stays legible
    /// on a phone rather than printing every date.
    public static func axisLabels(_ history: [RatingPoint], count target: Int = 3) -> [(x: Double, label: String)] {
        let events = ordered(history)
        guard !events.isEmpty else { return [] }
        // The profile carries every season, not one, so a month-and-day label
        // reads as out of order the moment the series crosses a new year
        // ("Jul 1, Nov 15, Sep 12"). The year goes in when it has to.
        let calendar = Calendar.current
        let spansYears = calendar.component(.year, from: events.first!.date)
            != calendar.component(.year, from: events.last!.date)
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate(spansYears ? "MMMyyyy" : "MMMd")
        let step = max(1, Int((Double(events.count) / Double(max(1, target))).rounded(.up)))
        return stride(from: 0, to: events.count, by: step).map {
            (x: Double($0), label: formatter.string(from: events[$0].date))
        }
    }

    /// Ease-out: the curve arrives quickly and settles, which reads as drawn
    /// rather than as mechanically swept.
    public static func eased(_ t: Double) -> Double {
        let clamped = min(1, max(0, t))
        return 1 - pow(1 - clamped, 3)
    }
}
