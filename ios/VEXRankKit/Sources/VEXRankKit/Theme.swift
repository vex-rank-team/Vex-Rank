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

    public static let midnight = VEXTheme(
        id: "midnight", name: "Midnight",
        page: Color(hex: 0x090b0f), chrome: Color(hex: 0x0d1015),
        surface: Color(hex: 0x101319), surfaceRaised: Color(hex: 0x151a22),
        // 4.57:1 on surface. The brand red #ed2b3a measured 4.43:1, just under
        // the small-text floor, so the shipped value is nudged up.
        accent: Color(hex: 0xee3240), band: Color(hex: 0x282c20)
    )

    public static let ember = VEXTheme(
        id: "ember", name: "Ember",
        page: Color(hex: 0x0d0b09), chrome: Color(hex: 0x12100d),
        surface: Color(hex: 0x17130f), surfaceRaised: Color(hex: 0x1e1914),
        accent: Color(hex: 0xf5a524), onAccent: ink,                // 9.05:1; ink on it 9.53:1
        band: Color(hex: 0x2c2416)
    )

    public static let abyss = VEXTheme(
        id: "abyss", name: "Abyss",
        page: Color(hex: 0x070a12), chrome: Color(hex: 0x0a0f1a),
        surface: Color(hex: 0x0e1420), surfaceRaised: Color(hex: 0x141c2c),
        accent: Color(hex: 0x38bdf8), onAccent: ink,                // 8.60:1; ink on it 9.08:1
        band: Color(hex: 0x16283a)
    )

    public static let moss = VEXTheme(
        id: "moss", name: "Moss",
        page: Color(hex: 0x0a0c09), chrome: Color(hex: 0x0e110c),
        surface: Color(hex: 0x121711), surfaceRaised: Color(hex: 0x1a2018),
        accent: Color(hex: 0xa3e635), onAccent: ink,                // 12.04:1; ink on it 12.90:1
        band: Color(hex: 0x232d1c)
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
