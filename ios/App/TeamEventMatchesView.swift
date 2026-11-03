import SwiftUI
import VEXRankKit

/// One team's matches at one event: what they have played and what they have
/// left, from their side of the field.
@available(iOS 17.0, *)
struct TeamEventMatchesView: View {
    let ref: TeamEventRef
    @Environment(\.vexTheme) private var theme
    @State private var model = TeamEventMatchesModel()
    /// The livestream and its jumps to matches (StreamJumperView.swift).
    @State private var jumper = JumperModel()
    /// Matches, or the stats drawn from them (strengths, momentum).
    @State private var tab: Tab = .matches

    private enum Tab: String, CaseIterable, Identifiable {
        case matches = "Matches"
        case stats = "Stats"
        var id: String { rawValue }
    }

    var body: some View {
        List {
            if model.record != nil {
                Picker("Show", selection: $tab) {
                    ForEach(Tab.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
            }

            if tab == .matches, let record = model.record {
                Section {
                    VStack(alignment: .leading, spacing: 14) {
                        // Where they stand, before what they played.
                        if model.isIQ {
                            iqHeader(record)
                        } else if let standing = model.standing {
                            HStack(alignment: .firstTextBaseline, spacing: 10) {
                                Text("#\(standing.rank)")
                                    .font(.system(size: 34, weight: .bold, design: .rounded))
                                    .foregroundStyle(theme.accent)
                                    .monospacedDigit()
                                VStack(alignment: .leading, spacing: 1) {
                                    Text("QUALIFICATION RANK")
                                        .font(.caption2.weight(.semibold)).tracking(1.2)
                                        .foregroundStyle(.secondary)
                                    Text(standing.division).font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer(minLength: 8)
                                VStack(alignment: .trailing, spacing: 1) {
                                    Text(standing.record)
                                        .font(.system(.title3, design: .rounded, weight: .semibold))
                                        .monospacedDigit()
                                    Text(record.remaining == 0
                                         ? "Schedule complete"
                                         : "\(record.remaining) still to play")
                                        .font(.caption2).foregroundStyle(.secondary)
                                }
                            }

                            Divider().overlay(Color.hairline)

                            HStack(spacing: 14) {
                                stat("WP", standing.wp.map(String.init))
                                stat("AP", standing.ap.map(String.init))
                                stat("SP", standing.sp.map(String.init))
                                stat("High", standing.highScore.map(String.init))
                            }
                            if let s = standing.stats {
                                HStack(spacing: 14) {
                                    stat("OPR", String(format: "%.1f", s.opr))
                                    stat("DPR", String(format: "%.1f", s.dpr))
                                    stat("CCWM", String(format: "%.1f", s.ccwm))
                                }
                                if standing.statsAreProvisional {
                                    // These move a lot early on; say so rather
                                    // than presenting them as settled.
                                    Text("Provisional - few matches played so far")
                                        .font(.caption2).foregroundStyle(.subtle)
                                }
                            }
                        } else {
                            // Registered but not seeded yet.
                            HStack(alignment: .top, spacing: 14) {
                                metric("Record", record.summary, "\(record.played) played")
                                metric("Remaining", "\(record.remaining)",
                                       record.remaining == 0 ? "Schedule complete" : "Still to play")
                            }
                        }
                    }
                    .padding(.vertical, 4)
                }
                .listRowBackground(theme.surface)
            }

            if tab == .stats, let profile = model.strength {
                Section {
                    VStack(alignment: .leading, spacing: 12) {
                        StrengthHexagon(axes: profile.axes, accent: theme.accent)
                            .frame(height: 270)
                        ForEach(profile.axes) { axis in
                            HStack(alignment: .firstTextBaseline) {
                                Text(axis.label).font(.subheadline).foregroundStyle(.secondary)
                                if axis.lowerIsBetter {
                                    Text("lower is better").font(.caption2).foregroundStyle(.subtle)
                                }
                                Spacer(minLength: 8)
                                Text(axis.display)
                                    .font(.system(.subheadline, design: .monospaced, weight: .semibold))
                                    .monospacedDigit()
                                Text(axis.place.map { "\(ordinal($0)) of \(axis.of)" } ?? "no data yet")
                                    .font(.caption).foregroundStyle(.subtle)
                                    .frame(minWidth: 62, alignment: .trailing)
                            }
                        }
                    }
                    .padding(.vertical, 4)
                } header: {
                    Text("Strengths")
                } footer: {
                    // What the shape means, since a radar chart on its own
                    // invites reading raw values off it.
                    Text(model.isIQ
                         ? "Each axis places \(ref.team) among the \(profile.teams) teams in \(profile.division.isEmpty ? "its division" : profile.division) on measured results: the edge is the best there, the dashed ring the middle. Skills is the best driver + autonomous coding total here. These are results, not a rating."
                         : "Each axis ranks \(ref.team) against the \(profile.teams) teams in \(profile.division.isEmpty ? "its division" : profile.division): the edge is the best there, the dashed ring the middle. AWP is autonomous win points per qualification match, worked out from win points.\(profile.isProvisional ? " Ratings are provisional until each team has played about four matches." : "")")
                        .font(.caption2)
                }
                .listRowBackground(theme.surface)
            }

            if tab == .stats, model.isIQ, !model.momentum.isEmpty {
                Section("Teamwork scores") {
                    VStack(alignment: .leading, spacing: 8) {
                        MomentumChart(points: model.momentum, accent: theme.accent, isScoreSeries: true)
                            .frame(height: 190)
                        let scores = model.momentum.map(\.cumulative)
                        Text("Average \(String(format: "%.1f", Double(scores.reduce(0, +)) / Double(max(1, scores.count)))) across \(scores.count) matches · high \(scores.max() ?? 0).")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }
                .listRowBackground(theme.surface)
            } else if tab == .stats, !model.momentum.isEmpty {
                Section("Tournament momentum") {
                    VStack(alignment: .leading, spacing: 8) {
                        MomentumChart(points: model.momentum, accent: theme.accent)
                            .frame(height: 190)
                        let final = model.momentum.last?.cumulative ?? 0
                        Text(final == 0
                             ? "Level on points across \(model.momentum.count) matches."
                             : "\(final > 0 ? "+" : "")\(final) points across \(model.momentum.count) matches.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }
                .listRowBackground(theme.surface)
            }

            if tab == .stats, model.strength == nil, model.momentum.isEmpty, model.record != nil {
                Section {
                    Text("Strengths and momentum appear once \(ref.team) has played qualification matches here.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                .listRowBackground(theme.surface)
            }

            if tab == .matches, model.isIQ {
                if !model.iqPlayed.isEmpty {
                    Section("Played") { ForEach(model.iqPlayed) { iqRow($0) } }
                        .listRowBackground(theme.surface)
                }
                if !model.iqUpcoming.isEmpty {
                    Section("Scheduled") { ForEach(model.iqUpcoming) { iqRow($0) } }
                        .listRowBackground(theme.surface)
                }
            }

            if tab == .matches, !model.played.isEmpty {
                Section {
                    ForEach(model.played) { match in
                        if match.id == model.selectionBefore, let selection = model.selection { selectionRow(selection) }
                        row(match)
                    }
                } header: {
                    HStack {
                        Text("Played")
                        Spacer()
                        WatchButton(jumper: jumper).textCase(nil)
                    }
                } footer: {
                    if let check = model.check, !check.agrees {
                        // Says why the two disagree instead of letting the
                        // reader find a "LOST" above a winning record.
                        Text(check.unexplainedWins > 0
                             ? "The event credits \(check.officialSummary). \(check.unexplainedWins == 1 ? "One result does" : "\(check.unexplainedWins) results do") not follow the scores, which is what a disqualification looks like - the marks below are from the scores alone."
                             : "The event credits \(check.officialSummary), which does not follow the scores below.")
                            .font(.caption2)
                    }
                }
                .listRowBackground(theme.surface)
            }

            if tab == .matches, !model.upcoming.isEmpty {
                Section("Scheduled") {
                    ForEach(model.upcoming) { match in
                        if match.id == model.selectionBefore, let selection = model.selection { selectionRow(selection) }
                        row(match)
                    }
                }
                .listRowBackground(theme.surface)
            }

            if model.record == nil, let message = model.error {
                Section {
                    Text(message).font(.footnote).foregroundStyle(.secondary)
                    Button("Retry") { Task { await model.load(ref, force: true) } }
                        .tint(theme.accent)
                }
                .listRowBackground(theme.surface)
            } else if model.record == nil {
                Section { ProgressView() }.listRowBackground(theme.surface)
            } else if model.played.isEmpty && model.upcoming.isEmpty && model.iqPlayed.isEmpty && model.iqUpcoming.isEmpty {
                Section {
                    Text("No matches are listed for \(ref.team) at this event.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                .listRowBackground(theme.surface)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .refreshable { await model.load(ref, force: true) }
        .safeAreaInset(edge: .top, spacing: 0) {
            if jumper.isOpen { JumperPanel(jumper: jumper) }
        }
        .task(id: model.detail?.divisions.flatMap { $0.matches ?? [] }.compactMap(\.started).count) {
            if let detail = model.detail { await jumper.configure(detail) }
        }
        .background(theme.page)
        .navigationTitle("\(ref.team) · matches")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await model.load(ref)
            while !Task.isCancelled && (model.record?.remaining ?? 0) > 0 {
                try? await Task.sleep(for: .seconds(45))
                guard !Task.isCancelled else { break }
                await model.load(ref, force: true)
            }
        }
    }

    /// Rank, average and high score: what VEX IQ ranks on. No record, no
    /// WP/AP/SP and no fitted ratings - a teamwork match has no opponent.
    @ViewBuilder
    private func iqHeader(_ record: TeamEventRecord) -> some View {
        if let standing = model.iqStanding {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text("#\(standing.rank)")
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .foregroundStyle(theme.accent)
                    .monospacedDigit()
                VStack(alignment: .leading, spacing: 1) {
                    Text("QUALIFICATION RANK")
                        .font(.caption2.weight(.semibold)).tracking(1.2)
                        .foregroundStyle(.secondary)
                    Text(standing.division).font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 1) {
                    Text(standing.average.map { String(format: "%.1f", $0) } ?? "\u{2014}")
                        .font(.system(.title3, design: .rounded, weight: .semibold))
                        .monospacedDigit()
                    // What is left to play is the "Left" figure just below.
                    Text("Average score")
                        .font(.caption2).foregroundStyle(.secondary)
                }
            }
            Divider().overlay(Color.hairline)
            HStack(spacing: 14) {
                stat("High", standing.highScore.map(String.init))
                stat("Played", String(standing.played))
                stat("Left", String(record.remaining))
            }
            if !standing.averageFromEvent {
                Text("The average is the mean of the team's played qualification scores.")
                    .font(.caption2).foregroundStyle(.subtle)
            }
        } else {
            HStack(alignment: .top, spacing: 14) {
                metric("Played", "\(model.iqPlayed.count)", "Teamwork matches")
                metric("Remaining", "\(record.remaining)", record.remaining == 0 ? "Schedule complete" : "Still to play")
            }
        }
    }

    /// A teamwork match from the team's side: the partner and the score they
    /// shared. No result, colour or opponent.
    private func iqRow(_ match: TeamworkMatch) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(match.name).font(.subheadline.weight(.medium))
                if match.isPlayed { JumpButton(jumper: jumper, matchId: match.id, name: match.name) }
                Spacer(minLength: 8)
                if let score = match.score {
                    if model.rulings.ruling(match: match.id, team: ref.team) == .dq {
                        Text("DQ").font(.caption2.weight(.bold)).foregroundStyle(Color.loss)
                            .accessibilityHint(MatchRuling.dq.explanation)
                    }
                    Text("\(score)")
                        .font(.system(.title3, design: .monospaced, weight: .semibold))
                        .monospacedDigit()
                } else if let time = match.scheduled {
                    Text(time.formatted(date: .omitted, time: .shortened))
                        .font(.caption).foregroundStyle(.secondary).monospacedDigit()
                }
            }
            let disqualifiedPartners = match.partners.filter { model.rulings.ruling(match: match.id, team: $0) == .dq }
            if match.isPlayed, !disqualifiedPartners.isEmpty {
                Text("PARTNER \(disqualifiedPartners.joined(separator: ", ")) · DQ")
                    .font(.caption2.weight(.bold)).foregroundStyle(Color.loss)
            }
            if !match.partners.isEmpty {
                Text("\(match.isPlayed ? "Scored with" : "With") \(match.partners.joined(separator: ", "))")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if let field = match.field, !field.isEmpty {
                Text(field).font(.caption).foregroundStyle(.subtle)
            }
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder
    private func stat(_ label: String, _ value: String?) -> some View {
        if let value {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.system(size: 10, weight: .semibold)).foregroundStyle(.subtle)
                Text(value)
                    .font(.system(size: 15, weight: .medium, design: .monospaced))
                    .monospacedDigit()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func metric(_ label: String, _ value: String, _ detail: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            Text(value).font(.system(.title3, design: .rounded, weight: .semibold)).monospacedDigit()
            Text(detail).font(.caption2).foregroundStyle(.subtle).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// After OpenScout: this team's W or L, the match, then red alliance, the
    /// two scores and blue alliance side by side. The winner's score is filled,
    /// the loser's plain, outlined when it is this team's loss; a disqualified
    /// team carries an amber DQ badge (and a DQ is a loss).
    private func row(_ match: TeamMatch) -> some View {
        let isRed = match.colour == "red"
        let mine = [ref.team] + match.partners
        let red = isRed ? mine : match.opponents
        let blue = isRed ? match.opponents : mine
        let redScore = isRed ? match.scoreFor : match.scoreAgainst
        let blueScore = isRed ? match.scoreAgainst : match.scoreFor
        let winner: String? = match.isPlayed ? (match.outcome == .won ? match.colour : match.outcome == .lost ? (isRed ? "blue" : "red") : nil) : nil
        let disqualified = model.rulings.ruling(match: match.id, team: ref.team) == .dq
        let result: TeamMatch.Outcome = disqualified ? .lost : match.outcome
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                if match.isPlayed {
                    Text(result == .won ? "W" : result == .lost ? "L" : "T")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(outcomeColour(result))
                        .frame(width: 12, alignment: .leading)
                        .accessibilityLabel(outcomeLabel(result))
                }
                Text(match.name).font(.subheadline.weight(.medium))
                Spacer(minLength: 8)
                Text([match.scheduled.map { $0.formatted(date: .omitted, time: .shortened) }, match.field]
                        .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " \u{00B7} "))
                    .font(.caption2).foregroundStyle(.secondary).monospacedDigit()
            }
            HStack(spacing: 6) {
                allianceCell(red, match: match.id, colour: .allianceRed, bold: winner == "red")
                HStack(spacing: 4) {
                    if match.isPlayed {
                        scoreChip(redScore, colour: .allianceRed, won: winner == "red", ownLoss: isRed && winner == "blue")
                        scoreChip(blueScore, colour: .allianceBlue, won: winner == "blue", ownLoss: !isRed && winner == "red")
                    } else {
                        Text("\u{2014}").font(.caption).foregroundStyle(.subtle).frame(minWidth: 60)
                    }
                }
                allianceCell(blue, match: match.id, colour: .allianceBlue, bold: winner == "blue")
            }
        }
        .padding(.vertical, 2)
    }

    /// Alliance selection, as on OpenScout: between the last qualification
    /// match and the first elimination match, who picked whom as which seed.
    private func selectionRow(_ selection: AllianceSelection) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("#\(selection.seed)")
                .font(.system(.caption2, design: .monospaced, weight: .bold))
                .padding(.horizontal, 5).padding(.vertical, 1)
                .background(theme.accent.opacity(0.15), in: RoundedRectangle(cornerRadius: 3))
                .foregroundStyle(theme.accent)
            (Text("Team ") + selectionTeam(selection.captain) + Text(" selects ").foregroundColor(.secondary)
             + Text("Team ") + selectionTeam(selection.pick) + Text(" as the ").foregroundColor(.secondary)
             + Text("\(AllianceSelection.ordinal(selection.seed)) seed alliance"))
                .font(.footnote)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private func selectionTeam(_ team: String) -> Text {
        let focused = team.caseInsensitiveCompare(ref.team) == .orderedSame
        return Text(team)
            .font(.system(.footnote, design: .monospaced, weight: .bold))
            .foregroundColor(focused ? theme.accent : .primary)
            .underline(focused)
    }

    private func allianceCell(_ teams: [String], match: Int, colour: Color, bold: Bool) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            ForEach(teams, id: \.self) { team in
                let focused = team.caseInsensitiveCompare(ref.team) == .orderedSame
                HStack(spacing: 4) {
                    Text(team)
                        .font(.system(.footnote, design: .monospaced, weight: bold || focused ? .bold : .regular))
                        .foregroundStyle(focused ? theme.accent : colour)
                        .underline(focused)
                    if model.rulings.ruling(match: match, team: team) == .dq {
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

    private func scoreChip(_ score: Int?, colour: Color, won: Bool, ownLoss: Bool) -> some View {
        Text(score.map(String.init) ?? "\u{2014}")
            .font(.system(.footnote, design: .monospaced, weight: .semibold)).monospacedDigit()
            .foregroundStyle(won ? .white : colour)
            .frame(minWidth: 30)
            .padding(.horizontal, 3).padding(.vertical, 2)
            .background(won ? colour : .clear, in: RoundedRectangle(cornerRadius: 3))
            .overlay(RoundedRectangle(cornerRadius: 3).stroke(ownLoss ? colour : .clear, lineWidth: 1))
    }

    private func outcomeLabel(_ outcome: TeamMatch.Outcome) -> String {
        switch outcome {
        case .won: return "WON"
        case .lost: return "LOST"
        case .tied: return "TIED"
        case .scheduled: return ""
        }
    }

    private func outcomeColour(_ outcome: TeamMatch.Outcome) -> Color {
        switch outcome {
        case .won: return .win
        case .lost: return .loss
        default: return .secondary
        }
    }
}

@available(iOS 17.0, *)
@Observable
final class TeamEventMatchesModel {
    private(set) var played: [TeamMatch] = []
    private(set) var upcoming: [TeamMatch] = []
    private(set) var record: TeamEventRecord?
    private(set) var standing: EventStanding?
    private(set) var momentum: [MomentumPoint] = []
    private(set) var check: RecordCheck?
    /// Official rulings at the event (DQs, results the standings changed).
    private(set) var rulings = OfficialRulings()
    /// The event as loaded, for the livestream jumper.
    private(set) var detail: EventDetailResponse?
    /// The team's alliance selection, and the match it is shown before: its
    /// first elimination match.
    private(set) var selection: AllianceSelection?
    private(set) var selectionBefore: Int?
    private(set) var strength: StrengthProfile?
    private(set) var error: String?
    /// VEX IQ: read from the event, not the selected program, so a link into
    /// an IQ event is read correctly either way.
    private(set) var isIQ = false
    private(set) var iqStanding: IQStanding?
    private(set) var iqPlayed: [TeamworkMatch] = []
    private(set) var iqUpcoming: [TeamworkMatch] = []
    private let api = VEXRankAPI.shared

    @MainActor
    func load(_ ref: TeamEventRef, force: Bool = false) async {
        if record != nil && !force { return }
        error = nil
        do {
            let detail = try await api.eventDetail(id: ref.event.id, fresh: force)
            rulings = detail.officialRulings
            self.detail = detail
            if detail.isIQ {
                let teamwork = detail.iqMatches(for: ref.team)
                isIQ = true
                iqPlayed = teamwork.filter(\.isPlayed)
                iqUpcoming = teamwork.filter { !$0.isPlayed }
                iqStanding = detail.iqStanding(for: ref.team)
                momentum = IQScoreSeries.points(from: teamwork)
                strength = detail.iqStrengthProfile(for: ref.team)
                // Only `remaining` is read for IQ: it decides whether to keep polling.
                record = TeamEventRecord(wins: 0, losses: 0, ties: 0, remaining: iqUpcoming.count)
                return
            }
            let all = detail.matches(for: ref.team)
            played = all.filter(\.isPlayed)
            upcoming = all.filter { !$0.isPlayed }
            selection = detail.allianceSelections.first { $0.includes(ref.team) }
            // After the last qualifier, so practice matches before it do not count.
            let afterQualifying = all.lastIndex(where: \.isQualification).map { $0 + 1 } ?? 0
            selectionBefore = all[afterQualifying...].first { !$0.isQualification }?.id
            record = TeamEventRecord(matches: all)
            standing = detail.standing(for: ref.team)
            momentum = TeamMomentum.points(from: all)
            check = standing.map { RecordCheck(standing: $0, matches: all) }
            strength = detail.strengthProfile(for: ref.team)
            // The standings are the authority for the record itself.
            if let standing {
                record = TeamEventRecord(wins: standing.wins, losses: standing.losses,
                                         ties: standing.ties,
                                         remaining: all.filter { !$0.isPlayed }.count)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }
}
