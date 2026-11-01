#if canImport(SwiftUI)
import SwiftUI

/// Height of the scrolling viewport, published by the screen that owns the
/// scroll view so `reveal` knows what "on screen" means without reaching for
/// `UIScreen.main` (which is wrong on iPad split view and deprecated besides).
@available(iOS 17.0, macOS 14.0, *)
private struct RevealViewportHeightEnvironmentKey: EnvironmentKey {
    static let defaultValue: CGFloat = 0
}

@available(iOS 17.0, macOS 14.0, *)
extension EnvironmentValues {
    public var revealViewportHeight: CGFloat {
        get { self[RevealViewportHeightEnvironmentKey.self] }
        set { self[RevealViewportHeightEnvironmentKey.self] = newValue }
    }
}

/// Fades and lifts a section into place the first time it is scrolled to, and
/// never again - the web app's `.rise`, which used a scroll-driven animation
/// that only runs once.
/// Carries a measured viewport height up to the screen that owns the scroll
/// view, so it can publish it without wrapping anything.
@available(iOS 17.0, macOS 14.0, *)
public struct RevealViewportHeightKey: PreferenceKey {
    public static let defaultValue: CGFloat = 0
    public static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

@available(iOS 17.0, macOS 14.0, *)
extension View {
    /// Measures this scroll view's visible height and publishes it to the
    /// `reveal` modifiers inside it.
    ///
    /// A background is sized to the view it is attached to - for a ScrollView
    /// that is the viewport, not the content - so this measures the right thing
    /// without a GeometryReader wrapped around the scroll view. Wrapping it was
    /// the previous approach and is worth avoiding: a GeometryReader has no
    /// intrinsic size and hands its child a proposal of its own, which is a
    /// well-known way to leave a ScrollView sized wrongly and unable to scroll.
    public func publishesRevealViewport() -> some View {
        modifier(PublishRevealViewport())
    }
}

@available(iOS 17.0, macOS 14.0, *)
private struct PublishRevealViewport: ViewModifier {
    @State private var height: CGFloat = 0

    func body(content: Content) -> some View {
        content
            .background(
                GeometryReader { geometry in
                    Color.clear.preference(key: RevealViewportHeightKey.self, value: geometry.size.height)
                }
            )
            .onPreferenceChange(RevealViewportHeightKey.self) { height = $0 }
            .environment(\.revealViewportHeight, height)
    }
}

@available(iOS 17.0, macOS 14.0, *)
public struct Reveal: ViewModifier {
    private let delay: Double
    private let distance: CGFloat

    public init(delay: Double = 0, distance: CGFloat = 20) {
        self.delay = delay
        self.distance = distance
    }

    @State private var shown = false
    @Environment(\.revealViewportHeight) private var viewportHeight
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .offset(y: shown ? 0 : distance)
            .background(probe)
    }

    private var probe: some View {
        GeometryReader { geometry in
            // Nothing is drawn; the geometry is the whole point.
            Color.clear
                .onChange(of: geometry.frame(in: .global).minY, initial: true) { _, top in
                    guard !shown else { return }
                    guard !reduceMotion else { shown = true; return }
                    // A viewport height of 0 means the owner did not publish
                    // one; show the content rather than leaving it invisible.
                    let trigger = viewportHeight > 0 ? viewportHeight * 0.92 : .greatestFiniteMagnitude
                    guard top < trigger else { return }
                    withAnimation(.easeOut(duration: 0.55).delay(delay)) { shown = true }
                }
        }
    }
}

@available(iOS 17.0, macOS 14.0, *)
extension View {
    /// Reveals this section when it is scrolled into view.
    public func reveal(delay: Double = 0, distance: CGFloat = 20) -> some View {
        modifier(Reveal(delay: delay, distance: distance))
    }
}
#endif
