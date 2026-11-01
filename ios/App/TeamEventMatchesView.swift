import SwiftUI
import VEXRankKit

/// One team's matches at one event: what they have played and what they have
/// left, from their side of the field.
@available(iOS 17.0, *)
struct TeamEventMatchesView: View {
    let ref: TeamEventRef
    @Environment(\.vexTheme) private var theme
    @State private var model = TeamEventMatchesModel()

    var body: some View {
        List {
            if let record = model.record {
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

                            Divider().overlay(Color.white.opacity(0.14))

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

            if let profile = model.strength {
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

            if model.isIQ, !model.momentum.isEmpty {
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
            } else if !model.momentum.isEmpty {
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

            if model.isIQ {
                if !model.iqPlayed.isEmpty {
                    Section("Played") { ForEach(model.iqPlayed) { iqRow($0) } }
                        .listRowBackground(theme.surface)
                }
                if !model.iqUpcoming.isEmpty {
                    Section("Scheduled") { ForEach(model.iqUpcoming) { iqRow($0) } }
                        .listRowBackground(theme.surface)
                }
            }

            if !model.played.isEmpty {
                Section {
                    ForEach(model.played) { row($0) }
                } header: {
                    Text("Played")
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

            if !model.upcoming.isEmpty {
                Section("Scheduled") {
                    ForEach(model.upcoming) { row($0) }
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
            Divider().overlay(Color.white.opacity(0.14))
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
                Spacer(minLength: 8)
                if let score = match.score {
                    Text("\(score)")
                        .font(.system(.title3, design: .monospaced, weight: .semibold))
                        .monospacedDigit()
                } else if let time = match.scheduled {
                    Text(time.formatted(date: .omitted, time: .shortened))
                        .font(.caption).foregroundStyle(.secondary).monospacedDigit()
                }
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

    private func row(_ match: TeamMatch) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(match.name).font(.subheadline.weight(.medium))
                Spacer(minLength: 8)
                if match.isPlayed {
                    // Marked as "on score" when the standings disagree with
                    // what the scores add up to, because then one of these
                    // labels is wrong and nothing in the data says which.
                    Text(model.check?.agrees == false
                         ? "\(outcomeLabel(match.outcome)) ON SCORE"
                         : outcomeLabel(match.outcome))
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(model.check?.agrees == false
                                         ? .secondary : outcomeColour(match.outcome))
                } else if let time = match.scheduled {
                    Text(time.formatted(date: .omitted, time: .shortened))
                        .font(.caption).foregroundStyle(.secondary).monospacedDigit()
                }
            }

            HStack(spacing: 8) {
                Text(match.colour == "red" ? "RED" : "BLUE")
                    .font(.system(size: 9, weight: .bold)).foregroundStyle(.white)
                    .padding(.horizontal, 5).padding(.vertical, 2)
                    .background(match.colour == "red" ? Color.red : Color.blue)
                    .clipShape(RoundedRectangle(cornerRadius: 3))

                if match.isPlayed, let mine = match.scoreFor, let theirs = match.scoreAgainst {
                    // Their score first: the whole screen is from their side.
                    Text("\(mine) – \(theirs)")
                        .font(.system(.subheadline, design: .monospaced, weight: .semibold))
                        .monospacedDigit()
                }

                if let field = match.field, !field.isEmpty {
                    Text(field).font(.caption).foregroundStyle(.subtle)
                }
            }

            if !match.partners.isEmpty {
                Text("with \(match.partners.joined(separator: ", "))")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if !match.opponents.isEmpty {
                Text("vs \(match.opponents.joined(separator: ", "))")
                    .font(.caption).foregroundStyle(.primary.opacity(0.8))
            }
        }
        .padding(.vertical, 2)
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
        case .won: return .green
        case .lost: return .red
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
