import Foundation

/// Links to the official site, for the things this app deliberately does not
/// carry: registration details, agendas, webcasts, contact information.
///
/// Both patterns were checked against the live site rather than assumed.
/// events.vex.com sits behind a bot check that answers every path with the
/// same 403 - including paths that do not exist - so a request from a script
/// cannot tell a real page from a wrong guess. These were opened in a real
/// browser: the team page returned "V5RC Team : 252H : VEX Events" and the
/// event page its own title. robotevents.com, the old host, now 404s
/// everything, so it is not where either of these should point.
public enum OfficialLinks {
    private static let site = "https://events.vex.com"

    /// This app is V5RC only, which is also what the rankings endpoint serves.
    /// Overridable per call because it is one of the settings the Worker can
    /// change: if the site ever renames the program, that should not be the
    /// thing that needs an App Store release.
    public static let program = "V5RC"

    /// A team's page. Numbers are uppercased because the site's paths are, and
    /// percent-encoded in case a number ever carries something unexpected.
    public static func team(_ number: String, program: String = OfficialLinks.program) -> URL? {
        // The site's team paths use the program code: /teams/V5RC/252H,
        // /teams/VIQRC/86995D (seen in the skills feed's own links).
        let trimmed = number.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard !trimmed.isEmpty,
              let encoded = trimmed.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)
        else { return nil }
        return URL(string: "\(site)/teams/\(program)/\(encoded)")
    }

    /// An event's page.
    ///
    /// Prefers the URL the API supplies, which is the authority, and falls
    /// back to building one from the SKU - the same shape the Worker uses.
    public static func event(officialUrl: String?, sku: String?) -> URL? {
        if let officialUrl, let url = URL(string: officialUrl), url.host != nil { return url }
        guard let sku, !sku.isEmpty,
              let encoded = sku.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)
        else { return nil }
        return URL(string: "\(site)/robot-competitions/vex-robotics-competition/\(encoded).html")
    }
}
