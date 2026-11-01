import SwiftUI
import VEXRankKit

@available(iOS 17.0, *)
struct RankingsListView: View {
    @Environment(\.vexTheme) private var theme
    @Environment(\.program) private var program
    @State private var model = RankingsModel()
    @State private var filter = RankingFilter()

    var body: some View {
        if program.isIQ { IQRankingsView() } else { v5Body }
    }

    private var v5Body: some View {
        Group {
            switch model.state {
            case .loading:
                ProgressView("Loading world ranking…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .failed(let message):
                // Says what went wrong and offers the way out, rather than an
                // empty list that reads as "no teams exist".
                ContentUnavailableView {
                    Label("Could not load rankings", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(message)
                } actions: {
                    Button("Retry") { Task { await model.load() } }
                        .buttonStyle(.borderedProminent)
                        .tint(theme.accent)
                        .foregroundStyle(theme.onAccent)
                }
            case .loaded(let teams):
                let shown = filter.apply(to: teams)
                VStack(spacing: 0) {
                    controls(teams)
                    Divider()
                    summary(shown)
                        .padding(.horizontal, 16)
                        .padding(.bottom, 12)
                    Divider()
                    if shown.isEmpty {
                        ContentUnavailableView("No teams match",
                                               systemImage: "line.3.horizontal.decrease.circle",
                                               description: Text("No team meets these filters."))
                    } else {
                        list(shown)
                    }
                }
            }
        }
        .animation(.easeOut(duration: 0.35), value: model.state.isLoaded)
        .background(theme.page)
        .searchable(text: $filter.search, prompt: "Search team number or name")
        .task { await model.load() }
    }

    private func controls(_ teams: [TeamRanking]) -> some View {
        VStack(spacing: 10) {
            Picker("Grade", selection: $filter.grade) {
                ForEach(RankingFilter.Grade.allCases, id: \.self) {
                    Text($0 == .all ? "All" : $0.rawValue).tag($0)
                }
            }
            .pickerStyle(.segmented)

            HStack(spacing: 10) {
                menu(title: filter.country ?? "All countries",
                     icon: "globe",
                     options: RankingFilter.countries(teams),
                     reset: "All countries") { country in
                    filter.country = country
                    // A region from the old country would match nothing.
                    filter.region = nil
                }

                menu(title: filter.region ?? "All regions",
                     icon: "map",
                     options: RankingFilter.regions(teams, country: filter.country),
                     reset: "All regions") { filter.region = $0 }
            }
            .font(.caption.weight(.semibold))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    @ViewBuilder
    private func menu(title: String, icon: String, options: [String], reset: String,
                      select: @escaping (String?) -> Void) -> some View {
        Menu {
            Button(reset) { select(nil) }
            ForEach(options, id: \.self) { option in
                Button(option) { select(option) }
            }
        } label: {
            Label(title, systemImage: icon).lineLimit(1)
        }
        .tint(theme.accent)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func list(_ teams: [TeamRanking]) -> some View {
        // No pagination cap: List recycles rows, so all 585 cost the same as 20.
        List(teams) { team in
            NavigationLink(value: TeamRef(team.number)) { row(team) }
                .listRowBackground(theme.surface)
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .refreshable { await model.load() }
    }

    /// The web's metric strip: how many teams the current filter leaves, how
    /// much official data is behind the table, and who leads it.
    private func summary(_ teams: [TeamRanking]) -> some View {
        HStack(alignment: .top, spacing: 14) {
            summaryItem("\(filter.grade == .all ? "Teams" : filter.grade.rawValue) rated",
                        "\(teams.count)",
                        filter.country ?? "4+ official matches")
            summaryItem("Events processed",
                        model.meta.map { "\($0.eventsProcessed)" } ?? "…",
                        model.meta.map { "\($0.matchesProcessed) matches" } ?? "")
            summaryItem("Rating leader",
                        teams.first.map { "\($0.rating)" } ?? "—",
                        teams.first?.number ?? "No qualifying teams")
        }
    }

    private func summaryItem(_ label: String, _ value: String, _ detail: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            Text(value).font(.system(.title3, design: .rounded, weight: .semibold))
                .monospacedDigit()
            Text(detail).font(.caption2).foregroundStyle(.subtle).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func row(_ team: TeamRanking) -> some View {
        HStack(spacing: 14) {
            Text("#\(team.rank)")
                .font(.system(.subheadline, design: .rounded, weight: .semibold))
                .foregroundStyle(theme.accent)
                .frame(width: 46, alignment: .leading)
                .monospacedDigit()

            VStack(alignment: .leading, spacing: 2) {
                Text(team.number).font(.headline)
                Text(team.name).font(.subheadline).foregroundStyle(.secondary)
                    .lineLimit(1)
                if let record = team.record {
                    Text("\(record) · \(RankingFilter.regionOf(team) ?? "Unassigned")")
                        .font(.caption2).foregroundStyle(.subtle).lineLimit(1)
                }
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 2) {
                Text("\(team.rating)")
                    .font(.system(.title3, design: .rounded, weight: .semibold))
                    .monospacedDigit()
                Text("±\(team.confidence)").font(.caption2).foregroundStyle(.secondary)
                    .monospacedDigit()
            }
        }
        .padding(.vertical, 4)
    }
}

@available(iOS 17.0, *)
@Observable
final class RankingsModel {
    enum State {
        /// Drives the fade from spinner to content; the cases themselves carry
        /// payloads that are not worth making Equatable just for this.
        var isLoaded: Bool { if case .loaded = self { return true }; return false }

        case loading
        case loaded([TeamRanking])
        case failed(String)
    }

    private(set) var state: State = .loading
    /// How much official data is behind the table, for the summary strip.
    private(set) var meta: (eventsProcessed: Int, matchesProcessed: Int)?
    private let api = VEXRankAPI.shared

    @MainActor
    func load() async {
        // Draw the table the app had last time while the current one is
        // fetched. A cold launch otherwise spends its first second on a spinner
        // in front of a ranking that has barely moved since the reader last
        // looked, which is the slowest the app ever feels.
        if case .failed = state { state = .loading }
        if case .loading = state, let known = await api.lastKnownRankings() {
            meta = (known.eventsProcessed, known.matchesProcessed)
            state = .loaded(known.sortedForDisplay)
        }
        do {
            let response = try await api.rankings()
            meta = (response.eventsProcessed, response.matchesProcessed)
            // Client-side ordering: the deployed Worker sorts by
            // rating - confidence while returning rating.
            state = .loaded(response.sortedForDisplay)
        } catch {
            // Keep whatever is on screen: a snapshot that is a few hours old
            // beats replacing a working table with an error.
            if case .loaded = state { return }
            state = .failed(error.localizedDescription)
        }
    }
}

/// Rankings for VEX IQ. The rating rows appear once the server returns IQ
/// ratings; until then a card says the rating is coming, and the list is the
/// one official IQ leaderboard there is, world skills, labelled as such.
@available(iOS 17.0, *)
struct IQRankingsView: View {
    @Environment(\.vexTheme) private var theme
    @State private var model = IQRankingsModel()
    @State private var season = Program.iqSeasons[0].id
    @State private var grade = "All"
    @State private var country: String?
    @State private var query = ""
    @State private var showProvisional = false

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 10) {
                Picker("Grade", selection: $grade) {
                    Text("All").tag("All")
                    ForEach(Program.viqrc.grades, id: \.self) { Text($0).tag($0) }
                }
                .pickerStyle(.segmented)
                HStack(spacing: 10) {
                    Menu {
                        Picker("Season", selection: $season) {
                            ForEach(Program.iqSeasons, id: \.id) { Text($0.label).tag($0.id) }
                        }
                    } label: {
                        Label(Program.iqSeasons.first { $0.id == season }?.label ?? "Season", systemImage: "calendar").lineLimit(1)
                    }
                    .tint(theme.accent)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Menu {
                        Button("All countries") { country = nil }
                        ForEach(model.countries, id: \.self) { name in Button(name) { country = name } }
                    } label: {
                        Label(country ?? "All countries", systemImage: "globe").lineLimit(1)
                    }
                    .tint(theme.accent)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .font(.caption.weight(.semibold))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            Divider()
            content
        }
        .animation(.easeOut(duration: 0.35), value: model.isLoaded)
        .background(theme.page)
        .searchable(text: $query, prompt: "Search team number or name")
        .task(id: season) {
            country = nil
            await model.load(season: season)
        }
    }

    @ViewBuilder
    private var content: some View {
        if let message = model.error {
            ContentUnavailableView {
                Label("Could not load world skills", systemImage: "wifi.exclamationmark")
            } description: {
                Text(message)
            } actions: {
                Button("Retry") { Task { await model.load(season: season) } }
                    .buttonStyle(.borderedProminent)
                    .tint(theme.accent)
                    .foregroundStyle(theme.onAccent)
            }
        } else if !model.isLoaded {
            ProgressView("Loading world skills…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            let rows = shown
            List {
                Section {
                    if model.ratings.isEmpty {
                        comingSoon
                    } else {
                        Toggle("Include provisional teams", isOn: $showProvisional)
                            .tint(theme.accent)
                            .font(.subheadline)
                        let rated = model.ratings.filter { showProvisional || $0.provisional != true }
                        if rated.isEmpty {
                            Text("No team has enough evidence for a confirmed rating yet.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        ForEach(Array(rated.prefix(250).enumerated()), id: \.element.id) { index, team in
                            // The team's place in the world, not in this filtered list.
                            let worldRank = showProvisional ? team.rank : (team.confirmedRank ?? index + 1)
                            NavigationLink(value: TeamRef(team.number)) { ratingRow(worldRank, team) }
                        }
                    }
                } header: {
                    Text("VIQCR")
                } footer: {
                    if !model.ratings.isEmpty {
                        Text("\(model.modelVersion ?? "VIQCR") · a Vex-Rank model, not an official ranking. Teamwork 55%, driving and coding 17.5% each, consistency across partners 10%. Provisional teams lack two teamwork events, three partners, both skills modes or recent consistency evidence.")
                    }
                }
                .listRowBackground(theme.surface)

                Section {
                    if rows.isEmpty {
                        Text("No teams match these filters.").font(.footnote).foregroundStyle(.secondary)
                    }
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, team in
                        NavigationLink(value: TeamRef(team.number)) { skillsRow(index + 1, team) }
                    }
                } header: {
                    Text("World skills standings")
                } footer: {
                    Text("Official Event.VEX standings: each team's best combined driver and autonomous coding run this season.")
                }
                .listRowBackground(theme.surface)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .refreshable { await model.load(season: season) }
        }
    }

    private var shown: [SkillsEntry] {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        return model.skills.filter { team in
            (grade == "All" || team.grade == grade)
                && (country == nil || team.country == country)
                && (needle.isEmpty || team.number.lowercased().contains(needle) || team.name.lowercased().contains(needle))
        }
    }

    private var comingSoon: some View {
        HStack(alignment: .top, spacing: 12) {
            Rectangle().fill(theme.accent).frame(width: 3)
            VStack(alignment: .leading, spacing: 4) {
                Text("The VEX IQ rating is coming soon.").font(.subheadline.weight(.semibold))
                Text("It is being built for teamwork matches, where two teams share one score. Nothing here shows an estimated rating meanwhile.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    private func ratingRow(_ position: Int, _ team: TeamRanking) -> some View {
        HStack(spacing: 14) {
            Text("#\(position)")
                .font(.system(.subheadline, design: .rounded, weight: .semibold))
                .foregroundStyle(theme.accent)
                .frame(width: 46, alignment: .leading)
                .monospacedDigit()
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(team.number).font(.headline)
                    if team.provisional == true {
                        Text("PROVISIONAL").font(.caption2.weight(.semibold)).tracking(0.6).foregroundStyle(.secondary)
                    }
                }
                Text(team.name).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                if let parts = team.components,
                   let teamwork = parts["teamwork"], let driving = parts["driving"], let coding = parts["coding"], let consistency = parts["consistency"] {
                    Text("Teamwork \(teamwork.points) · Driving \(driving.points) · Coding \(coding.points) · Consistency \(consistency.points)")
                        .font(.caption2).foregroundStyle(.subtle).lineLimit(1).minimumScaleFactor(0.8)
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(team.rating)").font(.system(.title3, design: .rounded, weight: .semibold)).monospacedDigit()
                Text("±\(team.confidence)").font(.caption2).foregroundStyle(.secondary).monospacedDigit()
            }
        }
        .padding(.vertical, 4)
    }

    private func skillsRow(_ position: Int, _ team: SkillsEntry) -> some View {
        HStack(spacing: 14) {
            Text("#\(position)")
                .font(.system(.subheadline, design: .rounded, weight: .semibold))
                .foregroundStyle(theme.accent)
                .frame(width: 46, alignment: .leading)
                .monospacedDigit()
            VStack(alignment: .leading, spacing: 2) {
                Text(team.number).font(.headline)
                Text(team.name).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                Text([team.grade, team.region].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption2).foregroundStyle(.subtle).lineLimit(1)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(team.combinedSkills)").font(.system(.title3, design: .rounded, weight: .semibold)).monospacedDigit()
                Text("\(team.driverSkills) + \(team.autoSkills)").font(.caption2).foregroundStyle(.secondary).monospacedDigit()
            }
        }
        .padding(.vertical, 4)
    }
}

@available(iOS 17.0, *)
@Observable
final class IQRankingsModel {
    private(set) var skills: [SkillsEntry] = []
    /// IQ ratings, once the server has them. Empty while the rating is pending,
    /// and empty against a server that predates VEX IQ, which would otherwise
    /// answer with V5 rows.
    private(set) var ratings: [TeamRanking] = []
    private(set) var modelVersion: String?
    private(set) var countries: [String] = []
    private(set) var isLoaded = false
    private(set) var error: String?
    private let api = VEXRankAPI.shared

    @MainActor
    func load(season: Int) async {
        error = nil
        do {
            let feed = try await api.skills(season: season)
            skills = feed.rankings
            countries = Set(feed.rankings.compactMap(\.country)).filter { !$0.isEmpty }.sorted()
            isLoaded = true
        } catch {
            if !isLoaded { self.error = error.localizedDescription }
        }
        if let response = try? await api.rankings(),
           response.program == Program.viqrc.rawValue, response.ratingStatus != "pending" {
            ratings = response.sortedForDisplay
            modelVersion = response.modelVersion
        }
    }
}
