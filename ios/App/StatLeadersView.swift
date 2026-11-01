import SwiftUI
import VEXRankKit

/// The "Stat leaders" tab: one leaderboard per category, computed on-device
/// from the rankings and skills feeds (same as the web app - the Worker has no
/// endpoint for these).
@available(iOS 17.0, *)
struct StatLeadersView: View {
    @Environment(\.vexTheme) private var theme
    @Environment(\.program) private var program
    @State private var model = StatLeadersModel()
    /// Nil until the reader picks one: the first category differs by program.
    @State private var chosen: StatCategory?
    @State private var country: String?

    private var category: StatCategory { chosen ?? StatCategory.all(for: program)[0] }

    var body: some View {
        VStack(spacing: 0) {
            picker
            Divider()
            content
        }
        .animation(.easeOut(duration: 0.35), value: model.state.isLoaded)
        .background(theme.page)
        .task { await model.load(program: program) }
    }

    private var picker: some View {
        VStack(alignment: .leading, spacing: 10) {
            ChipBar(StatCategory.all(for: program), selected: category, label: \.id) { option in
                chosen = option
                // A country that qualifies in one feed may not exist in the
                // other, which would silently empty the list.
                country = nil
            }

            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(category.detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
                regionMenu
            }
            .padding(.horizontal, 16)
        }
        .padding(.top, 4)
        .padding(.bottom, 12)
    }

    @ViewBuilder
    private var regionMenu: some View {
        let options = model.countries(for: category)
        if !options.isEmpty {
            Menu {
                Button("All regions") { country = nil }
                ForEach(options, id: \.self) { name in
                    Button(name) { country = name }
                }
            } label: {
                Label(country ?? "All regions", systemImage: "globe")
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
            }
            .tint(theme.accent)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            ProgressView("Loading leaderboards…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            ContentUnavailableView {
                Label("Could not load leaderboards", systemImage: "wifi.exclamationmark")
            } description: {
                Text(message)
            } actions: {
                Button("Retry") { Task { await model.load(program: program) } }
                    .buttonStyle(.borderedProminent)
                    .tint(theme.accent)
                    .foregroundStyle(theme.onAccent)
            }
        case .loaded:
            let rows = model.rank(category: category, country: country)
            if rows.isEmpty {
                ContentUnavailableView("No qualifying teams",
                                       systemImage: "chart.bar",
                                       description: Text("No team meets this category's threshold\(country.map { " in \($0)" } ?? "")."))
            } else {
                list(rows)
            }
        }
    }

    private func list(_ rows: [StatLeader]) -> some View {
        List {
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                if row.opensProfile {
                    NavigationLink(value: TeamRef(row.number)) { cell(index: index, row: row) }
                        .listRowBackground(theme.surface)
                } else {
                    cell(index: index, row: row).listRowBackground(theme.surface)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .refreshable { await model.load(program: program) }
    }

    private func cell(index: Int, row: StatLeader) -> some View {
        HStack(spacing: 14) {
            Text("#\(index + 1)")
                .font(.system(.subheadline, design: .rounded, weight: .semibold))
                .foregroundStyle(theme.accent)
                .frame(width: 46, alignment: .leading)
                .monospacedDigit()

            VStack(alignment: .leading, spacing: 2) {
                Text(row.number).font(.headline)
                Text(row.name).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                Text("\(row.context) · \(row.region)")
                    .font(.caption2).foregroundStyle(.subtle).lineLimit(1)
            }

            Spacer(minLength: 8)

            Text(row.formattedValue(digits: category.fractionDigits))
                .font(.system(.title3, design: .rounded, weight: .semibold))
                .monospacedDigit()
        }
        .padding(.vertical, 4)
    }
}

@available(iOS 17.0, *)
@Observable
final class StatLeadersModel {
    enum State {
        /// Drives the fade from spinner to content; the cases themselves carry
        /// payloads that are not worth making Equatable just for this.
        var isLoaded: Bool { if case .loaded = self { return true }; return false }

        case loading
        case loaded
        case failed(String)
    }

    private(set) var state: State = .loading
    private var teams: [TeamRanking] = []
    private var skills: [SkillsEntry] = []
    private let api = VEXRankAPI.shared

    @MainActor
    func load(program: Program = .v5rc) async {
        // A pull to refresh keeps the board on screen; only a first load, or a
        // retry after a failure, shows the spinner. Swapping the list for a
        // spinner mid-pull yanked the rows out from under the finger.
        if !state.isLoaded { state = .loading }
        do {
            // Both feeds are needed before anything can rank, so they are
            // fetched concurrently rather than one after the other.
            // VEX IQ leaderboards are skills only: the rest need the rating.
            async let rankings: RankingsResponse? = program.isIQ ? nil : api.rankings()
            async let skillsFeed = api.skills()
            teams = try await rankings?.rankings ?? []
            skills = try await skillsFeed.rankings
            state = .loaded
        } catch {
            if state.isLoaded { return }
            state = .failed(error.localizedDescription)
        }
    }

    func rank(category: StatCategory, country: String?) -> [StatLeader] {
        StatLeaders.rank(category: category, teams: teams, skills: skills, country: country)
    }

    func countries(for category: StatCategory) -> [String] {
        StatLeaders.countries(category: category, teams: teams, skills: skills)
    }
}
