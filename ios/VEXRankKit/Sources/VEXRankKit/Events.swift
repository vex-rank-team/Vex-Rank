import Foundation

public struct EventsResponse: Codable, Sendable {
    public let events: [VEXEvent]
    public let source: String?
    public let fetchedAt: String?
}

public struct VEXEvent: Codable, Sendable, Identifiable, Hashable {
    public let id: String
    public let sku: String?
    public let date: String
    public let name: String
    public let city: String?
    public let region: String?
    public let eventRegion: String?
    public let tier: String?
    public let format: String?
    public let grade: String?
    public let teams: Int?
    public let status: String?
    public let eventType: String?
    public let worldQualifier: Bool?
    public let season: String?
    public let startsAt: String?

    /// `class` and `levelClass` are Swift keywords / arrive as null, so they are
    /// mapped explicitly rather than left to collide.
    public let eventClass: String?
    public let levelClass: String?

    enum CodingKeys: String, CodingKey {
        case id, sku, date, name, city, region, eventRegion, tier, format, grade
        case teams, status, eventType, worldQualifier, season, startsAt
        case eventClass = "class"
        case levelClass
    }

    /// The calendar day this event runs on, at local midnight.
    public var day: Date? { EventDay.parse(date) }

    public var isUpcoming: Bool {
        guard let day else { return false }
        return day >= Calendar.current.startOfDay(for: Date())
    }

    /// Human-readable location, deduplicated.
    ///
    /// `city` already carries "City, Region" ("Hamburg, Hamburg",
    /// "Templestowe Lower, Victoria") and `eventRegion` repeats the region, so
    /// naively joining the fields produced "Hamburg, Hamburg, Hamburg". This
    /// splits everything into components and keeps the first occurrence of
    /// each, preserving order from most to least specific.
    public var place: String {
        var seen = Set<String>()
        var parts: [String] = []
        for field in [city, eventRegion, region] {
            guard let field, !field.isEmpty else { continue }
            for component in field.split(separator: ",") {
                let text = component.trimmingCharacters(in: .whitespaces)
                guard !text.isEmpty, seen.insert(text.lowercased()).inserted else { continue }
                parts.append(text)
            }
        }
        return parts.joined(separator: ", ")
    }
}
