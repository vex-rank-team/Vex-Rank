import Foundation
import Observation

/// A team the reader has starred.
///
/// The name is kept alongside the number so the favourites list can be drawn
/// the moment the app opens. Looking it up instead would mean waiting on the
/// 56,000-team directory, which is the one thing a shortcut must not do.
public struct FavouriteTeam: Codable, Sendable, Hashable, Identifiable {
    public let number: String
    public let name: String?

    public var id: String { number.uppercased() }

    public init(number: String, name: String? = nil) {
        self.number = number
        self.name = name
    }
}

/// The starred teams, kept on the device.
@Observable
public final class FavouriteTeams {
    private let defaults: UserDefaults
    private let key: String

    public private(set) var teams: [FavouriteTeam] = []

    public init(defaults: UserDefaults = .standard, key: String = "vexrank-favourite-teams") {
        self.defaults = defaults
        self.key = key
        teams = Self.decode(defaults.data(forKey: key))
    }

    public func contains(_ number: String) -> Bool {
        teams.contains { $0.id == number.uppercased() }
    }

    /// Adds, or updates the stored name if it is already there - a team
    /// starred from a match list, where only the number is known, should pick
    /// up its name the first time it is seen somewhere that has one.
    public func add(_ team: FavouriteTeam) {
        if let index = teams.firstIndex(where: { $0.id == team.id }) {
            guard let name = team.name, !name.isEmpty else { return }
            teams[index] = FavouriteTeam(number: teams[index].number, name: name)
        } else {
            teams.append(team)
        }
        sortAndSave()
    }

    public func remove(_ number: String) {
        teams.removeAll { $0.id == number.uppercased() }
        sortAndSave()
    }

    public func toggle(_ team: FavouriteTeam) {
        contains(team.number) ? remove(team.number) : add(team)
    }

    private func sortAndSave() {
        teams.sort { TeamNumber.precedes($0.number, $1.number) }
        defaults.set(try? JSONEncoder().encode(teams), forKey: key)
    }

    private static func decode(_ data: Data?) -> [FavouriteTeam] {
        guard let data, let stored = try? JSONDecoder().decode([FavouriteTeam].self, from: data) else {
            return []
        }
        // Stored data is the reader's, not the server's, but it still gets
        // deduplicated on the way in: an older build could have written the
        // same team twice under different capitalisation.
        var seen = Set<String>()
        return stored
            .filter { seen.insert($0.id).inserted }
            .sorted { TeamNumber.precedes($0.number, $1.number) }
    }
}

#if canImport(SwiftUI)
import SwiftUI

@available(iOS 17.0, macOS 14.0, *)
private struct FavouriteTeamsKey: EnvironmentKey {
    static let defaultValue = FavouriteTeams()
}

@available(iOS 17.0, macOS 14.0, *)
extension EnvironmentValues {
    public var favouriteTeams: FavouriteTeams {
        get { self[FavouriteTeamsKey.self] }
        set { self[FavouriteTeamsKey.self] = newValue }
    }
}
#endif
