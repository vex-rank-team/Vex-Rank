import SwiftUI
import VEXRankKit

/// One event. The content is organised into tabs rather than stacked, because
/// a two-division event otherwise repeats standings, a bracket and two match
/// lists per division - eight sections before the awards are even reached.
///
/// Only tabs with something in them are offered, and the division selector
/// appears only when a tab actually spans more than one division. A final-only
/// division, which some events carry to hold the cross-division match, has no
/// standings, so it is not offered under Rankings at all.
@available(iOS 17.0, *)
struct EventDetailView: View {
    let event: EventRef
    @Environment(\.vexTheme) private var theme
    @State private var model = EventDetailModel()
    /// The livestream and its jumps to matches (StreamJumperView.swift).
    @State private var jumper = JumperModel()
    /// `-section Bracket` opens straight to a section, since the chips cannot
    /// be tapped without a touch. A State initial value, not a later
    /// assignment, for the same reason the query and sort are.
    @State private var tab: EventSection? = EventDetailView.launchSection
    @State private var divisionID: Int?
    /// Lists the reader has asked to see in full. Without a cap, a 41-team
    /// division pushes everything below it three screens down.
    @State private var expanded: Set<String> = []
    /// Finding one team at an event. Without it a team outside the top ten is
    /// behind "Show all 97 teams" and then a scroll - 252H, seeded 33rd, was
    /// simply not findable.
    /// `-find 252H` seeds it, since the field cannot be typed into without a
    /// touch. Seeded as the State's initial value rather than assigned later:
    /// an assignment made as the view settles gets lost.
    @State private var query = EventDetailView.launchQuery
    /// `-sort DPR` picks the order, since the menu cannot be opened without a
    /// touch. A State initial value, not a later assignment.
    @State private var sort: StandingSort = EventDetailView.launchSort

    init(event: EventRef) {
        self.event = event
        // The launch hooks (-section, -find, -sort) belong to the event the
        // app was launched into with -event. Applied to every event screen,
        // `-find 252H` filtered each event opened afterwards down to 252H.
        let launched = Self.launchArgument("-event") == event.id
        _tab = State(initialValue: launched ? Self.launchSection : nil)
        _query = State(initialValue: launched ? Self.launchQuery : "")
        _sort = State(initialValue: launched ? Self.launchSort : .rank)
    }

    private static func launchArgument(_ flag: String) -> String? {
        guard let index = CommandLine.arguments.firstIndex(of: flag),
              CommandLine.arguments.indices.contains(index + 1) else { return nil }
        return CommandLine.arguments[index + 1]
    }

    private static var launchSection: EventSection? {
        guard let index = CommandLine.arguments.firstIndex(of: "-section"),
              CommandLine.arguments.indices.contains(index + 1)
        else { return nil }
        return EventSection(rawValue: CommandLine.arguments[index + 1])
    }

    private static var launchSort: StandingSort {
        guard let index = CommandLine.arguments.firstIndex(of: "-sort"),
              CommandLine.arguments.indices.contains(index + 1),
              let found = StandingSort(rawValue: CommandLine.arguments[index + 1])
        else { return .rank }
        return found
    }

    private static var launchQuery: String {
        guard let index = CommandLine.arguments.firstIndex(of: "-find"),
              CommandLine.arguments.indices.contains(index + 1) else { return "" }
        return CommandLine.arguments[index + 1]
    }

    private static let previewRows = 10

    var body: some View {
        VStack(spacing: 0) {
            if let detail = model.detail {
                let tabs = detail.availableSections
                let selected = tab ?? tabs.first
                let divisions = selected.map { detail.divisions(for: $0) } ?? []
                let division = divisions.first { $0.id == divisionID } ?? divisions.first

                controls(tabs: tabs, selected: selected, divisions: divisions, division: division, isIQ: detail.isIQ)
                Divider().overlay(Color.hairline)
                if jumper.isOpen { JumperPanel(jumper: jumper) }
                list(detail, tab: selected, division: division)
            } else {
                list(nil, tab: nil, division: nil)
            }
        }
        .background(theme.page)
        .searchable(text: $query, prompt: "Find a team at this event")
        // The event name, not its date: "Aug 2" in the bar told the reader
        // nothing they could not see in the card below it.
        .navigationTitle(event.name)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: model.detail?.divisions.flatMap { $0.matches ?? [] }.compactMap(\.started).count) {
            if let detail = model.detail { await jumper.configure(detail) }
        }
        .task {
            await model.load(id: event.id)
            // While matches are still to be played, keep it current without
            // asking the reader to pull. Stops on its own once the schedule is
            // finished, and the task is cancelled when the screen goes away.
            while !Task.isCancelled && model.isLive {
                try? await Task.sleep(for: .seconds(45))
                guard !Task.isCancelled else { break }
                await model.load(id: event.id, force: true)
            }
        }
    }

    // MARK: - What there is to show

    // MARK: - Controls

    private func controls(tabs: [EventSection], selected: EventSection?,
                          divisions: [Division], division: Division?, isIQ: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ChipBar(tabs, selected: selected, label: \.rawValue) { option in
                tab = option
                // The chosen division may not exist under the new tab; let it
                // fall back rather than showing blank.
                divisionID = nil
            }

            HStack(spacing: 8) {
                // Only when the tab spans more than one.
                if divisions.count > 1, selected?.isPerDivision == true {
                    Menu {
                        ForEach(divisions) { option in
                            Button(option.name) { divisionID = option.id }
                        }
                    } label: {
                        FilterPill(division?.name ?? "Division", icon: "square.split.2x1", isActive: false)
                    }
                    .buttonStyle(.plain)
                }

                // V5 only: the other orders are fitted ratings, which need an opponent.
                if selected == .rankings, !isIQ, let division {
                    let sorts = model.sorts(for: division)
                    Menu {
                        ForEach(sorts) { option in
                            Button {
                                sort = option
                            } label: {
                                // Says which way the column runs, because for
                                // DPR the best value is the smallest.
                                Text(option == .rank
                                     ? "Seeding rank"
                                     : "\(option.rawValue) · \(option.ascending ? "lowest first" : "highest first")")
                            }
                        }
                    } label: {
                        FilterPill(sort == .rank ? "Seeding rank" : "By \(sort.rawValue)",
                                   icon: "arrow.up.arrow.down", isActive: sort != .rank)
                    }
                    .buttonStyle(.plain)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
        }
        .padding(.top, 4)
        .padding(.bottom, 6)
    }

    // MARK: - Content

    @ViewBuilder
    private func list(_ detail: EventDetailResponse?, tab: EventSection?, division: Division?) -> some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text(event.name).font(.headline)
                    if let day = event.day {
                        Label(day.formatted(date: .long, time: .omitted), systemImage: "calendar")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    let venue = detail?.event.venueLine ?? event.place
                    if !venue.isEmpty {
                        Label(venue, systemImage: "mappin.and.ellipse")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    if let url = detail?.event.official ?? OfficialLinks.event(officialUrl: nil, sku: nil) {
                        Link(destination: url) {
                            HStack(spacing: 6) {
                                Image(systemName: "safari")
                                Text("View on events.vex.com").font(.subheadline)
                                Image(systemName: "arrow.up.right").font(.caption2)
                            }
                            .foregroundStyle(theme.accent)
                        }
                        .buttonStyle(.plain)
                        .padding(.top, 2)
                    }
                    if let updated = model.updated {
                        // Scores arrive while a reader is watching, so say how
                        // old what they are looking at is.
                        Label(model.isLive ? "Updating · \(updated.formatted(date: .omitted, time: .standard))"
                                           : "Updated \(updated.formatted(date: .omitted, time: .shortened))",
                              systemImage: model.isLive ? "dot.radiowaves.left.and.right" : "clock")
                            .font(.caption2)
                            .foregroundStyle(model.isLive ? theme.accent : .secondary)
                    }
                }
                .padding(.vertical, 4)
            }
            .listRowBackground(theme.surface)

            // Only when the reader arrived from a team's profile, and only when
            // that team is actually in this event's schedule.
            if let team = event.focusTeam, model.hasMatches(for: team) {
                Section {
                    NavigationLink(value: TeamEventRef(event: event, team: team)) {
                        Label("\(team)'s matches at this event", systemImage: "list.bullet.rectangle")
                            .font(.subheadline.weight(.medium))
                    }
                }
                .listRowBackground(theme.surface)
            }

            if let detail {
                content(detail, tab: tab, division: division)
            } else if let message = model.error {
                Section {
                    Text(message).font(.footnote).foregroundStyle(.secondary)
                    Button("Retry") { Task { await model.load(id: event.id, force: true) } }
                        .tint(theme.accent)
                }
                .listRowBackground(theme.surface)
            } else {
                Section { ProgressView() }.listRowBackground(theme.surface)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .refreshable { await model.load(id: event.id, force: true) }
    }

    @ViewBuilder
    private func content(_ detail: EventDetailResponse, tab: EventSection?, division: Division?) -> some View {
        let rulings = detail.officialRulings
        switch tab {
        case .rankings:
            if let division, detail.isIQ { iqStandings(division) } else if let division { standings(division) }
        case .bracket:
            if let division {
                Section("Elimination bracket") {
                    // The division is named on the match screen only when the
                    // event has more than one to tell apart.
                    BracketView(division: division,
                                divisionLabel: detail.divisions.count > 1 ? division.name : nil)
                        .listRowInsets(EdgeInsets(top: 10, leading: 10, bottom: 10, trailing: 10))
                }
                .listRowBackground(theme.surface)
            }
        case .finals:
            if let division { iqFinalsSection(division) }
        case .matches:
            if let division, detail.isIQ {
                iqMatchSection(division, rulings: rulings)
            } else if let division {
                matchSection("Qualification", division.qualification, key: "qual-\(division.id)", rulings: rulings)
                selectionSection(division)
                matchSection("Elimination", division.elimination, key: "elim-\(division.id)", rulings: rulings)
            }
        case .awards:
            awards(detail)
        case .skills:
            skills(detail, codingLabel: detail.isIQ ? "coding" : "auto")
        case .teams:
            teams(detail)
        case .none:
            Section {
                Text(event.isUpcoming
                     ? "This event has not been played yet."
                     : "No official results were published for this event.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            .listRowBackground(theme.surface)
        }
    }

    private func standings(_ division: Division) -> some View {
        // Fitted once per division, not per row: it solves a system across
        // every qualification match, which is not work to repeat 41 times.
        let ratings = model.powerRatings(for: division)
        let order = model.sorts(for: division).contains(sort) ? sort : .rank
        let all = division.standings(by: order, ratings: ratings)
            .filter { matches($0.team.name) }
        let key = "division-\(division.id)"
        return Section(order == .rank ? "Qualification standings" : "Standings by \(order.rawValue)") {
            ForEach(visible(all, key: key)) { row in
                // The whole row is the link, so the disclosure sits at the
                // trailing edge instead of landing between the number and the
                // record.
                NavigationLink(value: TeamRef(row.team.name, fromEvent: event)) {
                    VStack(alignment: .leading, spacing: 5) {
                        HStack {
                            // The badge counts down the list the reader is
                            // actually looking at; the seed moves into the
                            // stat line when that is no longer the same thing.
                            Text("#\(order == .rank ? row.rank : (all.firstIndex(where: { $0.team.id == row.team.id }).map { $0 + 1 } ?? row.rank))")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.secondary)
                                .frame(width: 44, alignment: .leading)
                                .monospacedDigit()
                            // The API carries the number in `name`.
                            Text(row.team.name).font(.subheadline.weight(.semibold))
                            Spacer()
                            Text(row.record).font(.caption).foregroundStyle(.secondary)
                                .monospacedDigit()
                        }
                        statLine(row, ratings[row.team.name], showSeed: order != .rank)
                    }
                }
            }
            revealButton(total: all.count, key: key, noun: "teams")
            if ratings.isProvisional && !ratings.isEmpty {
                Text("OPR, DPR and CCWM are provisional - only \(String(format: "%.1f", ratings.appearances)) matches per team so far.")
                    .font(.caption2).foregroundStyle(.subtle)
            }
        }
        .listRowBackground(theme.surface)
    }

    /// VEX IQ standings: the event's rank, then average and high teamwork
    /// score. No record or WP/AP/SP - all zero for IQ - and no fitted ratings.
    private func iqStandings(_ division: Division) -> some View {
        let all = division.iqStandings.filter { matches($0.number) }
        let key = "division-\(division.id)"
        return Section {
            ForEach(visible(all, key: key)) { row in
                NavigationLink(value: TeamRef(row.number, fromEvent: event)) {
                    HStack {
                        Text("#\(row.rank)")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .frame(width: 44, alignment: .leading)
                            .monospacedDigit()
                        Text(row.number).font(.subheadline.weight(.semibold))
                        Spacer()
                        VStack(alignment: .trailing, spacing: 1) {
                            Text(row.average.map { String(format: "%.1f", $0) } ?? "\u{2014}")
                                .font(.subheadline.weight(.semibold)).monospacedDigit()
                            Text("avg · high \(row.highScore.map(String.init) ?? "\u{2014}")")
                                .font(.caption2).foregroundStyle(.secondary).monospacedDigit()
                        }
                    }
                }
            }
            revealButton(total: all.count, key: key, noun: "teams")
        } header: {
            Text("Qualification standings")
        } footer: {
            if all.contains(where: { !$0.averageFromEvent }) {
                Text("Average is the mean of each team's played qualification scores. Rank is the event's own.")
            }
        }
        .listRowBackground(theme.surface)
    }

    /// VEX IQ teamwork finals: the placings the posted scores give, then the
    /// schedule and results, so a reader can follow finals as they are played.
    @ViewBuilder
    private func iqFinalsSection(_ division: Division) -> some View {
        let places = division.iqFinalPlaces
        let finals = division.iqFinals
        let pending = finals.filter { !$0.isPlayed }.count
        Section {
            if places.isEmpty {
                Text("No finals scores have been posted yet.").font(.footnote).foregroundStyle(.secondary)
            }
            ForEach(places) { row in
                HStack(spacing: 12) {
                    Text("\(row.place)").font(.system(.headline, design: .rounded)).monospacedDigit()
                        .foregroundStyle(row.place <= 3 ? theme.accent : .secondary)
                        .frame(width: 30, alignment: .leading)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.teams.joined(separator: " + ")).font(.subheadline.weight(.semibold))
                        if row.tied { Text("Tied").font(.caption2).foregroundStyle(.subtle) }
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("\(row.score)").font(.system(.title3, design: .monospaced, weight: .semibold)).monospacedDigit()
                        if let tiebreak = row.tiebreak { Text("tiebreak \(tiebreak)").font(.caption2).foregroundStyle(.secondary) }
                    }
                }
                .padding(.vertical, 2)
            }
        } header: {
            Text(division.name.isEmpty ? "Finals" : "\(division.name) finals")
        } footer: {
            Text(pending > 0 ? "\(pending) of \(finals.count) finals still to play. Placed by posted scores; the event's official placings are final."
                             : "Placed by posted scores; the event's official placings are final.")
        }
        .listRowBackground(theme.surface)

        Section("Schedule and results") {
            ForEach(finals) { match in
                let pair = match.teamwork
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(match.name ?? "Final").font(.subheadline.weight(.medium))
                        Spacer()
                        Text(pair.score.map(String.init) ?? "\u{2014}")
                            .font(.system(.title3, design: .monospaced, weight: .semibold)).monospacedDigit()
                    }
                    Text(pair.teams.isEmpty ? "Teams not assigned" : pair.teams.joined(separator: " + "))
                        .font(.caption).foregroundStyle(.secondary)
                    if !match.isPlayed {
                        Text(Self.finalTime(match)).font(.caption2).foregroundStyle(.subtle)
                    }
                }
                .padding(.vertical, 2)
            }
        }
        .listRowBackground(theme.surface)
    }

    private static func finalTime(_ match: DivisionMatch) -> String {
        let when = match.scheduled.flatMap { ISO8601DateFormatter().date(from: $0) }
            .map { $0.formatted(date: .omitted, time: .shortened) }
        return [when, match.field].compactMap { $0 }.joined(separator: " \u{00B7} ").nilIfBlank ?? "Not scheduled"
    }

    /// Teamwork matches: the pair and the score they shared.
    @ViewBuilder
    private func iqMatchSection(_ division: Division, rulings: OfficialRulings) -> some View {
        let key = "qual-\(division.id)"
        let rows = division.qualification.filter { match in
            search.isEmpty || match.teamwork.teams.contains { $0.lowercased().contains(search) } || self.matches(match.name)
        }
        if !rows.isEmpty {
            Section("Teamwork matches") {
                ForEach(visible(rows, key: key)) { match in
                    let pair = match.teamwork
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(match.name ?? "Match").font(.subheadline.weight(.medium))
                            Spacer()
                            Text(pair.score.map(String.init) ?? "\u{2014}")
                                .font(.system(.title3, design: .monospaced, weight: .semibold))
                                .monospacedDigit()
                        }
                        Text(pair.teams.isEmpty ? "Teams not assigned" : pair.teams.joined(separator: " + "))
                            .font(.caption).foregroundStyle(.secondary)
                        if !match.isPlayed {
                            Text("Not played").font(.caption2).foregroundStyle(.subtle)
                        }
                        rulingTags(match, teams: pair.teams, rulings: rulings)
                    }
                    .padding(.vertical, 2)
                }
                revealButton(total: rows.count, key: key, noun: "matches")
            }
            .listRowBackground(theme.surface)
        }
    }

    /// The counted figures the API publishes, then the fitted ones.
    @ViewBuilder
    private func statLine(_ row: DivisionRanking, _ stats: TeamEventStats?, showSeed: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 10) {
                if showSeed { stat("Seed", "#\(row.rank)") }
                stat("WP", row.wp.map(String.init))
                stat("AP", row.ap.map(String.init))
                stat("SP", row.sp.map(String.init))
                stat("High", row.highScore.map(String.init))
            }
            if let stats {
                HStack(spacing: 10) {
                    stat("OPR", String(format: "%.1f", stats.opr))
                    stat("DPR", String(format: "%.1f", stats.dpr))
                    stat("CCWM", String(format: "%.1f", stats.ccwm))
                }
            }
        }
        .padding(.leading, 44)
    }

    @ViewBuilder
    private func stat(_ label: String, _ value: String?) -> some View {
        if let value {
            HStack(spacing: 3) {
                Text(label).font(.system(size: 10, weight: .semibold)).foregroundStyle(.subtle)
                Text(value).font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(.secondary).monospacedDigit()
            }
        }
    }

    @ViewBuilder
    private func awards(_ detail: EventDetailResponse) -> some View {
        let awards = detail.awards.filter { award in
            matches(award.title)
                || (award.teamWinners ?? []).contains { matches($0.team?.name) }
        }
        Section("Awards") {
            ForEach(Array(awards.enumerated()), id: \.offset) { _, award in
                VStack(alignment: .leading, spacing: 2) {
                    Text(award.title ?? "Award").font(.subheadline)
                    let winners = (award.teamWinners ?? [])
                        .compactMap { $0.team?.name }
                        .joined(separator: ", ")
                    if !winners.isEmpty {
                        Text(winners).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .listRowBackground(theme.surface)
    }

    @ViewBuilder
    private func skills(_ detail: EventDetailResponse, codingLabel: String) -> some View {
        let leaders = detail.skillsLeaderboard.filter { matches($0.number) }
        Section("Skills") {
            ForEach(Array(visible(leaders, key: "skills").enumerated()), id: \.element.id) { index, leader in
                HStack {
                    Text("#\(index + 1)")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 44, alignment: .leading)
                        .monospacedDigit()
                    Text(leader.number).font(.subheadline.weight(.semibold))
                    Spacer()
                    VStack(alignment: .trailing, spacing: 1) {
                        Text("\(leader.total)")
                            .font(.subheadline.weight(.semibold)).monospacedDigit()
                        Text("\(leader.programming) \(codingLabel) · \(leader.driver) driver")
                            .font(.caption2).foregroundStyle(.secondary).monospacedDigit()
                    }
                }
            }
            revealButton(total: leaders.count, key: "skills", noun: "teams")
        }
        .listRowBackground(theme.surface)
    }

    @ViewBuilder
    private func teams(_ detail: EventDetailResponse) -> some View {
        let all = detail.teams
            .sorted { TeamNumber.precedes($0.number, $1.number) }
            .filter { matches($0.number) || matches($0.name) }
        Section("Registered teams") {
            ForEach(visible(all, key: "teams")) { team in
                NavigationLink(value: TeamRef(team.number, fromEvent: event)) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(team.number).font(.subheadline.weight(.medium))
                        if let name = team.name, !name.isEmpty {
                            Text(name).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                }
            }
            revealButton(total: all.count, key: "teams", noun: "teams")
        }
        .listRowBackground(theme.surface)
    }

    @ViewBuilder
    private func matchSection(_ title: String, _ all: [DivisionMatch], key: String, rulings: OfficialRulings) -> some View {
        // A search over matches means "the matches this team is in".
        let matches = all.filter { match in
            search.isEmpty
                || ((match.red?.numbers ?? []) + (match.blue?.numbers ?? []))
                    .contains { $0.lowercased().contains(search) }
                || self.matches(match.name)
        }
        if !matches.isEmpty {
            Section {
                ForEach(visible(matches, key: key)) { match in
                    matchRow(match, rulings: rulings)
                }
                revealButton(total: matches.count, key: key, noun: "matches")
            } header: {
                HStack {
                    Text(title)
                    Spacer()
                    if title == "Qualification" { WatchButton(jumper: jumper).textCase(nil) }
                }
            }
            .listRowBackground(theme.surface)
        }
    }

    /// Alliance selection, as on OpenScout, between qualification and
    /// elimination: each captain, the team it selected, and the seed.
    @ViewBuilder
    private func selectionSection(_ division: Division) -> some View {
        let selections = division.allianceSelections.filter { selection in
            search.isEmpty || [selection.captain, selection.pick].contains { $0.lowercased().contains(search) }
        }
        if !selections.isEmpty {
            Section("Alliance selection") {
                ForEach(selections) { selection in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("#\(selection.seed)")
                            .font(.system(.caption2, design: .monospaced, weight: .bold))
                            .padding(.horizontal, 5).padding(.vertical, 1)
                            .background(theme.accent.opacity(0.15), in: RoundedRectangle(cornerRadius: 3))
                            .foregroundStyle(theme.accent)
                        (Text("Team ") + Text(selection.captain).font(.system(.footnote, design: .monospaced, weight: .bold))
                         + Text(" selects ").foregroundColor(.secondary)
                         + Text("Team ") + Text(selection.pick).font(.system(.footnote, design: .monospaced, weight: .bold))
                         + Text(" as the ").foregroundColor(.secondary)
                         + Text("\(AllianceSelection.ordinal(selection.seed)) seed alliance"))
                            .font(.footnote)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            .listRowBackground(theme.surface)
        }
    }

    private func matchRow(_ match: DivisionMatch, rulings: OfficialRulings) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(match.name ?? "Match").font(.subheadline.weight(.medium))
                if match.isPlayed { JumpButton(jumper: jumper, matchId: match.id, name: match.name ?? "Match") }
                Spacer()
                Text([match.scheduledDate.map { $0.formatted(date: .omitted, time: .shortened) }, match.field]
                        .compactMap { $0 }.joined(separator: " \u{00B7} "))
                    .font(.caption2).foregroundStyle(.secondary)
            }
            // After OpenScout: red alliance, the two scores side by side, blue
            // alliance; the winner's score filled, a DQ badge on the team.
            HStack(spacing: 6) {
                allianceCell(match.red, match: match.id, rulings: rulings, colour: .allianceRed, won: match.winner == "red")
                HStack(spacing: 4) {
                    if match.isPlayed {
                        scoreChip(match.red?.score, colour: .allianceRed, won: match.winner == "red")
                        scoreChip(match.blue?.score, colour: .allianceBlue, won: match.winner == "blue")
                    } else {
                        Text("\u{2014}").font(.caption).foregroundStyle(.subtle).frame(minWidth: 60)
                    }
                }
                allianceCell(match.blue, match: match.id, rulings: rulings, colour: .allianceBlue, won: match.winner == "blue")
            }
        }
        .padding(.vertical, 2)
    }

    /// Teams whose official result in `match` differs from the score: DQ and
    /// ruled losses in red, ruled wins in green.
    @ViewBuilder
    private func rulingTags(_ match: DivisionMatch, teams: [String], rulings: OfficialRulings) -> some View {
        let marked = teams.compactMap { team in rulings.ruling(match: match.id, team: team).map { (team, $0) } }
        if !marked.isEmpty {
            HStack(spacing: 10) {
                ForEach(marked, id: \.0) { team, ruling in
                    Text("\(team) · \(ruling.label)")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(Color.orange)
                        .accessibilityHint(ruling.explanation)
                }
            }
        }
    }

    /// An alliance's teams in a tinted cell, bold when it won. Plain text, not
    /// links: four disclosures per row read as clutter; standings lead to teams.
    private func allianceCell(_ alliance: MatchAlliance?, match: Int, rulings: OfficialRulings, colour: Color, won: Bool) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            ForEach(alliance?.numbers ?? [], id: \.self) { number in
                HStack(spacing: 4) {
                    Text(number)
                        .font(.system(.footnote, design: .monospaced, weight: won ? .bold : .regular))
                        .foregroundStyle(colour)
                    if rulings.ruling(match: match, team: number) == .dq {
                        Text("DQ").font(.system(size: 9, weight: .bold))
                            .padding(.horizontal, 4).padding(.vertical, 1)
                            .background(Color.orange.opacity(0.28), in: RoundedRectangle(cornerRadius: 3))
                            .foregroundStyle(Color.orange)
                            .accessibilityLabel("Disqualified")
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 8).padding(.vertical, 6)
        .background(colour.opacity(0.1), in: RoundedRectangle(cornerRadius: 6))
    }

    private func scoreChip(_ score: Int?, colour: Color, won: Bool) -> some View {
        Text(score.map(String.init) ?? "\u{2014}")
            .font(.system(.footnote, design: .monospaced, weight: .semibold)).monospacedDigit()
            .foregroundStyle(won ? .white : colour)
            .frame(minWidth: 30)
            .padding(.horizontal, 3).padding(.vertical, 2)
            .background(won ? colour : .clear, in: RoundedRectangle(cornerRadius: 3))
    }

    private var search: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// A search shows everything it matched; the cap only applies to browsing.
    private func visible<T>(_ rows: [T], key: String) -> [T] {
        if !search.isEmpty { return rows }
        return expanded.contains(key) ? rows : Array(rows.prefix(Self.previewRows))
    }

    private func matches(_ text: String?) -> Bool {
        guard !search.isEmpty else { return true }
        return (text ?? "").lowercased().contains(search)
    }

    @ViewBuilder
    private func revealButton(total: Int, key: String, noun: String) -> some View {
        if total > Self.previewRows && !expanded.contains(key) {
            Button("Show all \(total) \(noun)") { expanded.insert(key) }
                .font(.footnote.weight(.semibold))
                .tint(theme.accent)
        }
    }
}

@available(iOS 17.0, *)
@Observable
final class EventDetailModel {
    private(set) var detail: EventDetailResponse?
    private(set) var error: String?
    private(set) var updated: Date?
    private let api = VEXRankAPI.shared

    /// Whether this event still has matches to play, which is what decides if
    /// it is worth polling.
    var isLive: Bool {
        guard let detail else { return false }
        return detail.divisions.contains { division in
            (division.matches ?? []).contains { !$0.isPlayed }
        }
    }

    /// Fitted ratings per division, computed once and kept: solving the
    /// system on every redraw of the list would be wasteful, and the input
    /// does not change once the event is loaded.
    /// Not observed: it is filled in while the list is being drawn, and a
    /// write to an observed property from inside a body invalidates the view
    /// that is mid-render, costing a second pass for nothing.
    @ObservationIgnored private var ratingsCache: [Int: PowerRatings] = [:]

    func sorts(for division: Division) -> [StandingSort] {
        let rated = !powerRatings(for: division).isEmpty
        return StandingSort.allCases.filter { rated || !$0.needsRatings }
    }

    func powerRatings(for division: Division) -> PowerRatings {
        if let cached = ratingsCache[division.id] { return cached }
        let fitted = division.powerRatings()
        ratingsCache[division.id] = fitted
        return fitted
    }

    /// Whether this event lists any match for `team`, which decides if the
    /// button into their matches is offered at all.
    func hasMatches(for team: String) -> Bool {
        guard let detail else { return false }
        return !detail.matches(for: team).isEmpty
    }

    @MainActor
    func load(id: String, force: Bool = false) async {
        if detail != nil && !force { return }
        error = nil
        do {
            detail = try await api.eventDetail(id: id, fresh: force)
            updated = .now
            // The fit depends on the matches, which have just changed.
            ratingsCache.removeAll()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private extension String {
    var nilIfBlank: String? { isEmpty ? nil : self }
}
