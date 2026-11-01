import Foundation

/// The day an event happens on.
///
/// An event's date is a calendar day, not an instant: a tournament on the 20th
/// is on the 20th for everyone reading about it. The feeds express it two ways
/// - a plain "2026-09-20" in the events list, and a timestamp at midnight in
/// the *venue's* own offset ("2026-09-20T00:00:00-04:00") in the detail - and
/// both were being turned into instants and then printed in the reader's
/// timezone. Parsing the plain form as UTC and printing it anywhere west of
/// UTC moved it back a day, so the list showed "Sep 19" for events dated the
/// 20th, and opening one showed the same date shifted again.
///
/// Both forms are read for the calendar day they name, and rebuilt at local
/// midnight so that printing them gives that day back.
public enum EventDay {
    /// Parses either form into local midnight on the day it names.
    public static func parse(_ value: String?, calendar: Calendar = .current) -> Date? {
        guard let value, !value.isEmpty else { return nil }

        // "2026-09-20T00:00:00-04:00" - take the day as written, before the
        // offset can drag it into a different one.
        if value.count >= 10, value.dropFirst(10).first == "T" {
            return day(fromPrefix: String(value.prefix(10)), calendar: calendar)
        }
        // "2026-09-20"
        return day(fromPrefix: value, calendar: calendar)
    }

    private static func day(fromPrefix text: String, calendar: Calendar) -> Date? {
        let parts = text.split(separator: "-")
        guard parts.count == 3,
              let year = Int(parts[0]), let month = Int(parts[1]), let dayOfMonth = Int(parts[2])
        else { return nil }
        return calendar.date(from: DateComponents(year: year, month: month, day: dayOfMonth))
    }
}
