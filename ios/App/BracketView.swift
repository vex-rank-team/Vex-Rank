import SwiftUI
import VEXRankKit

/// The elimination bracket, as a bracket: one column per round, scrolled
/// horizontally because eight slots will not fit a phone otherwise.
///
/// Alignment is done with frame heights rather than drawn connectors. Each
/// round's card occupies twice the height of the one before it, so a
/// quarterfinal sits level with the midpoint of the two round-of-16 matches
/// that feed it. That reads as a bracket without a canvas full of lines that
/// have to be kept in sync with the layout.
@available(iOS 17.0, *)
struct BracketView: View {
    let division: Division
    /// Shown on the match screen when the event has more than one division.
    var divisionLabel: String? = nil
    @Environment(\.vexTheme) private var theme

    private static let slotHeight: CGFloat = 78
    private static let columnWidth: CGFloat = 186

    var body: some View {
        let rounds = division.bracket
        let final = division.final
        if rounds.isEmpty && final == nil {
            EmptyView()
        } else {
            ScrollView(.horizontal, showsIndicators: true) {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(Array(rounds.enumerated()), id: \.element.id) { depth, round in
                        column(round, depth: depth)
                    }
                    if let final {
                        finalColumn(final, depth: rounds.count)
                    }
                }
                .padding(.vertical, 4)
            }
        }
    }

    private func column(_ round: BracketRound, depth: Int) -> some View {
        let height = Self.slotHeight * pow(2, CGFloat(depth))
        return VStack(alignment: .leading, spacing: 0) {
            Text(round.label.uppercased())
                .font(.caption2.weight(.semibold)).tracking(1.2)
                .foregroundStyle(.secondary)
                .padding(.bottom, 6)
            VStack(spacing: 0) {
                ForEach(Array(round.slots.enumerated()), id: \.offset) { _, slot in
                    Group {
                        if let slot {
                            NavigationLink(value: slot.reference(round: round.label,
                                                                 division: divisionLabel)) {
                                card(slot)
                            }
                            .buttonStyle(.plain)
                        } else {
                            // The empty slot is kept so later rounds stay level
                            // with the matches that feed them.
                            RoundedRectangle(cornerRadius: 8)
                                .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
                                .foregroundStyle(.subtle)
                                .frame(height: 56)
                                .overlay(Text("Not posted").font(.caption2).foregroundStyle(.subtle))
                        }
                    }
                    .frame(height: height)
                }
            }
        }
        .frame(width: Self.columnWidth)
    }

    private func card(_ slot: BracketSlot) -> some View {
        VStack(spacing: 0) {
            side(slot.match.red, colour: .red, letter: "R",
                 won: slot.match.winner == "red", decided: slot.match.winner != nil)
            Divider()
            side(slot.match.blue, colour: .blue, letter: "B",
                 won: slot.match.winner == "blue", decided: slot.match.winner != nil)
            if slot.wasReplayed {
                Text("REPLAYED · \(slot.games.count) GAMES")
                    .font(.system(size: 8, weight: .semibold)).tracking(0.6)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 8).padding(.vertical, 3)
            }
        }
        .background(theme.surfaceRaised)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func side(_ alliance: MatchAlliance?, colour: Color, letter: String,
                      won: Bool, decided: Bool) -> some View {
        HStack(spacing: 6) {
            Text(letter)
                .font(.system(size: 8, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 13, height: 13)
                .background(colour)
            Text((alliance?.numbers ?? []).joined(separator: " + "))
                .font(.system(size: 11, weight: won ? .bold : .regular))
                .lineLimit(1).minimumScaleFactor(0.8)
            Spacer(minLength: 4)
            Text(alliance?.score.map(String.init) ?? "—")
                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                .monospacedDigit()
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 7)
        // The loser is dimmed rather than the winner merely bolded, so the path
        // through the bracket is readable at a glance.
        .opacity(decided && !won ? 0.42 : 1)
        .background(won ? Color.green.opacity(0.14) : .clear)
    }

    private func finalColumn(_ final: BracketFinal, depth: Int) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("FINAL").font(.caption2.weight(.semibold)).tracking(1.2)
                .foregroundStyle(.secondary)
                .padding(.bottom, 6)
            NavigationLink(value: final.reference(division: divisionLabel)) {
                VStack(spacing: 0) {
                    Text("\(final.redWins) : \(final.blueWins)")
                        .font(.system(.title3, design: .monospaced, weight: .semibold))
                        .foregroundStyle(theme.accent)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                    Divider()
                    finalSide(final.red, wins: final.redWins, colour: .red, letter: "R",
                              won: final.winner == "red", decided: final.winner != nil)
                    Divider()
                    finalSide(final.blue, wins: final.blueWins, colour: .blue, letter: "B",
                              won: final.winner == "blue", decided: final.winner != nil)
                }
                .background(theme.surfaceRaised)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .buttonStyle(.plain)
            .frame(height: Self.slotHeight * pow(2, CGFloat(depth)), alignment: .center)
        }
        .frame(width: Self.columnWidth)
    }

    private func finalSide(_ numbers: [String], wins: Int, colour: Color, letter: String,
                           won: Bool, decided: Bool) -> some View {
        HStack(spacing: 6) {
            Text(letter)
                .font(.system(size: 8, weight: .bold)).foregroundStyle(.white)
                .frame(width: 13, height: 13).background(colour)
            Text(numbers.joined(separator: " + "))
                .font(.system(size: 11, weight: won ? .bold : .regular))
                .lineLimit(1).minimumScaleFactor(0.8)
            Spacer(minLength: 4)
            Text("\(wins)").font(.system(size: 12, weight: .semibold, design: .monospaced))
        }
        .padding(.horizontal, 8).padding(.vertical, 8)
        .opacity(decided && !won ? 0.42 : 1)
        .background(won ? Color.green.opacity(0.14) : .clear)
    }
}
