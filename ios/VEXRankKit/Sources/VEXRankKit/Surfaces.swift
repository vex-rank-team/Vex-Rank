#if canImport(SwiftUI)
import SwiftUI

/// The one card: surface fill, 14pt corners, 16pt inset.
///
/// The profile alone drew cards at three radii and three paddings, some with
/// an accent outline and some on their own hue, so nothing said which mattered
/// more. Every grouped block now looks the same, and emphasis comes from what
/// is inside it.
@available(iOS 17.0, macOS 14.0, *)
struct VEXCard: ViewModifier {
    @Environment(\.vexTheme) private var theme
    let padding: CGFloat

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

@available(iOS 17.0, macOS 14.0, *)
public extension View {
    func vexCard(padding: CGFloat = 16) -> some View {
        modifier(VEXCard(padding: padding))
    }
}

/// A section's title, with an optional quieter line under it.
///
/// Replaces the eyebrow-plus-title pairs ("ROBOT SKILLS / Season best skills
/// scores"), which said the same thing twice at two sizes.
@available(iOS 17.0, macOS 14.0, *)
public struct SectionHeader: View {
    private let title: String
    private let detail: String?

    public init(_ title: String, detail: String? = nil) {
        self.title = title
        self.detail = detail
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.headline)
            if let detail {
                Text(detail).font(.footnote).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// A figure with its label above: the summary strips, the skills scores.
@available(iOS 17.0, macOS 14.0, *)
public struct Metric: View {
    private let label: String
    private let value: String
    private let detail: String?

    public init(_ label: String, _ value: String, detail: String? = nil) {
        self.label = label
        self.value = value
        self.detail = detail
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            Text(value)
                .font(.system(.title2, design: .rounded, weight: .semibold))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            if let detail {
                Text(detail).font(.caption2).foregroundStyle(.subtle).lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

/// The label of a filter menu: a pill that reads as a control.
///
/// The filters were bare accent text, which looked like links, sat under the
/// small-text contrast floor, and gave no sign of whether a filter was on. The
/// pill is neutral at its default and takes the accent only once it narrows
/// the list, so a glance says why fewer rows are showing.
@available(iOS 17.0, macOS 14.0, *)
public struct FilterPill: View {
    @Environment(\.vexTheme) private var theme
    private let title: String
    private let icon: String
    private let isActive: Bool

    public init(_ title: String, icon: String, isActive: Bool) {
        self.title = title
        self.icon = icon
        self.isActive = isActive
    }

    public var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon).font(.caption)
            Text(title).lineLimit(1)
            Image(systemName: "chevron.down").font(.caption2.weight(.bold))
                .foregroundStyle(isActive ? theme.onAccent.opacity(0.8) : Color.subtle)
        }
        .font(.footnote.weight(.semibold))
        .foregroundStyle(isActive ? theme.onAccent : Color.primary)
        .padding(.horizontal, 12)
        .frame(minHeight: 34)
        .background(isActive ? theme.accent : theme.surface, in: Capsule())
        // The pill is 34pt; the target around it is the 44pt a thumb needs.
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }
}

/// RED or BLUE, as a small filled tag.
@available(iOS 17.0, macOS 14.0, *)
public struct AllianceTag: View {
    private let isRed: Bool
    public init(isRed: Bool) { self.isRed = isRed }

    public var body: some View {
        Text(isRed ? "RED" : "BLUE")
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(.white)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(isRed ? Color.allianceRed : Color.allianceBlue,
                        in: RoundedRectangle(cornerRadius: 4, style: .continuous))
            .accessibilityLabel(isRed ? "Red alliance" : "Blue alliance")
    }
}
#endif
