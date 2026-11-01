import Foundation

/// The competition the app is showing: VEX V5 or VEX IQ.
///
/// The same table as the website's `lib/programs.mjs`. VEX IQ values were
/// checked against live responses (see website/tests/fixtures/viqrc/README.md).
public enum Program: String, CaseIterable, Sendable, Identifiable, Codable {
    case v5rc = "V5RC"
    case viqrc = "VIQRC"

    public var id: String { rawValue }

    /// The program for a stored or passed-in code. Anything unrecognised is V5,
    /// the program every install started on.
    public static func named(_ code: String?) -> Program {
        Program(rawValue: code ?? "") ?? .v5rc
    }

    public var isIQ: Bool { self == .viqrc }

    /// What the switch shows.
    public var short: String { isIQ ? "IQ" : "V5" }

    public var name: String { isIQ ? "VEX IQ Robotics Competition" : "VEX V5 Robotics Competition" }

    /// The season the app opens on when the remote config says nothing.
    public var defaultSeason: Int { isIQ ? 203 : 204 }

    /// School levels the program has.
    public var grades: [String] { isIQ ? ["Middle School", "Elementary School"] : ["High School", "Middle School"] }

    /// Whether the published rating exists yet. VEX IQ's is being written.
    public var isRated: Bool { !isIQ }

    /// VEX IQ seasons since 2024, newest first.
    public static let iqSeasons: [(id: Int, label: String)] = [
        (203, "2026–27 Level Up"),
        (196, "2025–26 Mix & Match"),
        (189, "2024–25 Rapid Relay"),
    ]
}

#if canImport(SwiftUI)
import SwiftUI

@available(iOS 17.0, macOS 14.0, *)
private struct ProgramKey: EnvironmentKey {
    static let defaultValue: Program = .v5rc
}

@available(iOS 17.0, macOS 14.0, *)
public extension EnvironmentValues {
    /// The program every screen reads, set once at the root.
    var program: Program {
        get { self[ProgramKey.self] }
        set { self[ProgramKey.self] = newValue }
    }
}
#endif
