#if canImport(SwiftUI)
import SwiftUI

/// The four palettes from the web build, carried over as values.
///
/// On the web these are CSS custom properties, which is what made a theme a
/// token swap rather than a component change. The same discipline applies here:
/// views reference roles (`surface`, `accent`), never literal colours.
///
/// All four are dark by design. The interface leans on translucent white
/// throughout, so a light palette needs those rewritten first and would ship
/// broken otherwise.
@available(iOS 17.0, macOS 14.0, *)
public struct VEXTheme: Identifiable, Sendable, Hashable {
    public let id: String
    public let name: String
    public let page: Color
    public let chrome: Color
    public let surface: Color
    public let surfaceRaised: Color
    public let accent: Color
    /// Text and symbols set on an accent fill: a selected chip, a prominent
    /// button. White on the three lighter accents measured 1.5 to 2.1:1, so
    /// those themes ink it; the red keeps white, its brand pairing (4.07:1),
    /// and only ever carries semibold labels.
    public let onAccent: Color
    public let band: Color

    public init(id: String, name: String, page: Color, chrome: Color, surface: Color,
                surfaceRaised: Color, accent: Color, onAccent: Color = .white, band: Color) {
        self.id = id
        self.name = name
        self.page = page
        self.chrome = chrome
        self.surface = surface
        self.surfaceRaised = surfaceRaised
        self.accent = accent
        self.onAccent = onAccent
        self.band = band
    }

    /// The ink used on the lighter accents.
    private static let ink = Color(hex: 0x0b0d10)

    // Surfaces step up in even increments - page, card, raised - so a card
    // reads as a card without a border. The old cards sat 3% above the page
    // and disappeared on most displays. `band` is the raised step in every
    // theme: it used to carry its own hue (an olive under the red), the one
    // colour on screen that belonged to no palette.

    public static let midnight = VEXTheme(
        id: "midnight", name: "Midnight",
        page: Color(hex: 0x0a0b0e), chrome: Color(hex: 0x0e1014),
        surface: Color(hex: 0x15171c), surfaceRaised: Color(hex: 0x1d2027),
        // 4.41:1 on surface, so it is spent on fills, glyphs and large type, not on
        // small text. White on it 4.07:1 - the brand pairing - for chip labels.
        accent: Color(hex: 0xee3240), band: Color(hex: 0x1d2027)
    )

    public static let ember = VEXTheme(
        id: "ember", name: "Ember",
        page: Color(hex: 0x0d0b09), chrome: Color(hex: 0x12100d),
        surface: Color(hex: 0x1a1612), surfaceRaised: Color(hex: 0x231e18),
        accent: Color(hex: 0xf5a524), onAccent: ink,                // 9.05:1; ink on it 9.53:1
        band: Color(hex: 0x231e18)
    )

    public static let abyss = VEXTheme(
        id: "abyss", name: "Abyss",
        page: Color(hex: 0x080b12), chrome: Color(hex: 0x0b101a),
        surface: Color(hex: 0x111724), surfaceRaised: Color(hex: 0x182030),
        accent: Color(hex: 0x38bdf8), onAccent: ink,                // 8.60:1; ink on it 9.08:1
        band: Color(hex: 0x182030)
    )

    public static let moss = VEXTheme(
        id: "moss", name: "Moss",
        page: Color(hex: 0x0a0c09), chrome: Color(hex: 0x0e110c),
        surface: Color(hex: 0x151a13), surfaceRaised: Color(hex: 0x1d231a),
        accent: Color(hex: 0xa3e635), onAccent: ink,                // 12.04:1; ink on it 12.90:1
        band: Color(hex: 0x1d231a)
    )

    public static let all: [VEXTheme] = [.midnight, .ember, .abyss, .moss]

    public static func named(_ id: String?) -> VEXTheme {
        all.first { $0.id == id } ?? .midnight
    }
}

@available(iOS 17.0, macOS 14.0, *)
extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xff) / 255,
            green: Double((hex >> 8) & 0xff) / 255,
            blue: Double(hex & 0xff) / 255,
            opacity: 1
        )
    }
}

/// The quietest text that still reads: half-white is 5.3:1 on every surface.
///
/// The system's tertiary label measured about 2.6:1 on these surfaces, which is
/// fine for a chevron but not for the record, region and field lines it was
/// carrying, so those use this instead.
@available(iOS 17.0, macOS 14.0, *)
extension ShapeStyle where Self == Color {
    public static var subtle: Color { Color.white.opacity(0.5) }

    /// Rules between rows and around metrics. One value, where there were six
    /// (0.08 to 0.22), so every list on every screen ruled the same weight.
    public static var hairline: Color { Color.white.opacity(0.1) }

    // Meaning, not decoration, and the same in every theme: a win is never
    // the accent, so a red theme cannot make a win look like a loss.
    // Tuned together for the dark surfaces rather than taken from the system
    // set, whose pure red and blue vibrated against them and whose green read
    // as a different app.

    /// A won match, a rating that rose.
    public static var win: Color { Color(hex: 0x34d399) }
    /// A lost match, a rating that fell.
    public static var loss: Color { Color(hex: 0xfb7185) }
    /// The red alliance. White labels on it 4.7:1; as large text on a card 3.8:1.
    public static var allianceRed: Color { Color(hex: 0xd6363c) }
    /// The blue alliance. White labels on it 4.6:1; as large text on a card 3.9:1.
    public static var allianceBlue: Color { Color(hex: 0x3f6fe0) }
}

@available(iOS 17.0, macOS 14.0, *)
private struct VEXThemeKey: EnvironmentKey {
    static let defaultValue: VEXTheme = .midnight
}

@available(iOS 17.0, macOS 14.0, *)
public extension EnvironmentValues {
    var vexTheme: VEXTheme {
        get { self[VEXThemeKey.self] }
        set { self[VEXThemeKey.self] = newValue }
    }
}
#endif
