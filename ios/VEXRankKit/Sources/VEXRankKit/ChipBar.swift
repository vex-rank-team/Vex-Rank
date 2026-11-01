#if canImport(SwiftUI)
import SwiftUI

/// A scrolling row of single-choice chips: the stat categories, an event's
/// sections.
///
/// Both screens drew their own, and both had the same faults - white text on
/// accents it could not be read against, a 30pt target, and nothing to tell
/// VoiceOver which chip was chosen - so it lives here once.
@available(iOS 17.0, macOS 14.0, *)
public struct ChipBar<Option: Identifiable & Hashable>: View {
    private let options: [Option]
    private let selected: Option?
    private let label: (Option) -> String
    private let select: (Option) -> Void

    @Environment(\.vexTheme) private var theme

    public init(_ options: [Option], selected: Option?,
                label: @escaping (Option) -> String,
                select: @escaping (Option) -> Void) {
        self.options = options
        self.selected = selected
        self.label = label
        self.select = select
    }

    public var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(options) { option in
                    let isSelected = option == selected
                    Button { select(option) } label: {
                        Text(label(option))
                            .font(.footnote.weight(.semibold))
                            .padding(.horizontal, 14)
                            .padding(.vertical, 7)
                            .foregroundStyle(isSelected ? theme.onAccent : Color.secondary)
                            .background(isSelected ? theme.accent : theme.surface, in: Capsule())
                            // The capsule stays 30pt; the target around it is
                            // the 44pt a thumb needs.
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(ChipPressStyle())
                    // Scoped to the chip's own state, so choosing one eases its
                    // fill without animating the list that changes beneath it.
                    .animation(.easeOut(duration: 0.18), value: isSelected)
                    .accessibilityAddTraits(isSelected ? .isSelected : [])
                }
            }
            .padding(.horizontal, 16)
        }
        .sensoryFeedback(.selection, trigger: selected)
    }
}

/// Sinks slightly under the finger and springs back, so a tap is acknowledged
/// before the content it changes has redrawn. Reduce Motion gets a dim instead.
@available(iOS 17.0, macOS 14.0, *)
struct ChipPressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.95 : 1)
            .opacity(configuration.isPressed && reduceMotion ? 0.6 : 1)
            .animation(.spring(duration: 0.22, bounce: 0.35), value: configuration.isPressed)
    }
}
#endif
