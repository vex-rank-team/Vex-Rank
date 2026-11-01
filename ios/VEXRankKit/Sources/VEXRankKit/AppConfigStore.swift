import Foundation
import Observation

/// Holds the live `AppConfig` and remembers the last good one.
///
/// The stored copy is read synchronously in `init` so that the first frame is
/// already drawn with the right season. Waiting on the network for that would
/// mean either a blank launch or a launch against stale constants that changes
/// under the reader a second later.
@Observable
public final class AppConfigStore {
    public private(set) var config: AppConfig
    /// When the running config was fetched. `nil` means it is the bundled one
    /// or a stored copy from a previous launch.
    public private(set) var fetched: Date?

    private let defaults: UserDefaults
    private let key: String
    private let dismissedKey: String
    private let build: Int
    /// Stored rather than read back from `UserDefaults` on each access so that
    /// dismissing a banner is an observed change and the banner actually goes.
    private var dismissed: [String]

    /// `build` is `CFBundleVersion`, the number the update check compares.
    public init(defaults: UserDefaults = .standard,
                key: String = "vexrank-app-config",
                build: Int = AppConfigStore.currentBuild) {
        self.defaults = defaults
        self.key = key
        self.dismissedKey = key + "-dismissed"
        self.build = build
        self.dismissed = defaults.stringArray(forKey: key + "-dismissed") ?? []
        if let data = defaults.data(forKey: key),
           let stored = try? JSONDecoder().decode(AppConfig.self, from: data) {
            config = stored
        } else {
            config = .bundled
        }
    }

    public static var currentBuild: Int {
        Int(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "") ?? 0
    }

    public static var currentVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
    }

    /// Fetches the current config and hands it to the API client.
    ///
    /// A failure is not surfaced: the app already has a config that works, and
    /// an error banner because a settings file was briefly unreachable would be
    /// noise about something the reader cannot act on.
    @discardableResult
    public func refresh(using api: VEXRankAPI) async -> Bool {
        await api.apply(config)
        guard let latest = try? await api.appConfig() else { return false }
        adopt(latest)
        await api.apply(latest)
        return true
    }

    /// Takes on a config without going to the network. The refresh path runs
    /// through here, and so do the tests.
    func adopt(_ config: AppConfig) {
        self.config = config
        fetched = Date()
        defaults.set(try? JSONEncoder().encode(config), forKey: key)
    }

    // MARK: - Update

    public var updateStatus: UpdateStatus { config.update.status(forBuild: build) }

    /// The nudge to show, or `nil`. A `.available` build the reader has already
    /// waved away stays away until a newer one appears; `.required` does not
    /// take dismissal for an answer.
    public var pendingUpdate: UpdateInfo? {
        switch updateStatus {
        case .current: return nil
        case .required: return config.update
        case .available:
            return dismissed.contains(updateKey) ? nil : config.update
        }
    }

    public func dismissUpdate() {
        guard updateStatus == .available else { return }
        remember(updateKey)
    }

    private var updateKey: String { "build-\(config.update.latestBuild)" }

    // MARK: - Announcement

    public var pendingAnnouncement: Announcement? {
        guard let announcement = config.announcement,
              !dismissed.contains("note-" + announcement.id) else { return nil }
        return announcement
    }

    public func dismissAnnouncement(_ id: String) { remember("note-" + id) }

    // MARK: - Dismissals

    private func remember(_ token: String) {
        guard !dismissed.contains(token) else { return }
        // Oldest first, bounded, so a long-lived install cannot grow this
        // without limit and the newest dismissal is never the one dropped.
        dismissed = Array((dismissed + [token]).suffix(40))
        defaults.set(dismissed, forKey: dismissedKey)
    }
}

#if canImport(SwiftUI)
import SwiftUI

@available(iOS 17.0, macOS 14.0, *)
private struct AppConfigKey: EnvironmentKey {
    /// The bundled config, so a preview or a view used outside the app still
    /// renders rather than trapping on a missing dependency.
    static let defaultValue = AppConfigStore()
}

@available(iOS 17.0, macOS 14.0, *)
extension EnvironmentValues {
    public var appConfig: AppConfigStore {
        get { self[AppConfigKey.self] }
        set { self[AppConfigKey.self] = newValue }
    }
}
#endif
