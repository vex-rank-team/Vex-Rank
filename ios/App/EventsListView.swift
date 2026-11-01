import SwiftUI
import VEXRankKit

@available(iOS 17.0, *)
struct EventsListView: View {
    /// Set by the -event launch argument; resolved against the feed once it
    /// loads, since the detail view needs the whole event, not just an id.
    var openEventID: String? = nil
    /// `-focus <team>` opens the event as if arrived at from that team's
    /// profile, and `-matches` goes straight on to their match list. The same
    /// kind of hook as `-team`: these screens are two taps deep and tapping is
    /// how they would otherwise have to be reached.
    var focusTeam: String? = nil
    var openMatches = false
    var path: Binding<NavigationPath>? = nil

    @Environment(\.vexTheme) private var theme
    @State private var model = EventsModel()
    @State private var upcomingOnly = true
    @State private var query = ""

    var body: some View {
        VStack(spacing: 0) {
            // Above the list rather than in the navigation bar, where a
            // segmented control gets squeezed down to "U A".
            Picker("Window", selection: $upcomingOnly) {
                Text("Upcoming").tag(true)
                Text("All").tag(false)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.bottom, 8)

            content
        }
        .animation(.easeOut(duration: 0.35), value: model.state.isLoaded)
        .background(theme.page)
        .searchable(text: $query, prompt: "Search events by name or place")
        .task {
            await model.load()
            if case .loaded(let events) = model.state,
               let id = openEventID,
               let match = events.first(where: { $0.id == id }) {
                let ref = focusTeam.map { match.ref.focused(on: $0) } ?? match.ref
                // One push, not two: appending both at once leaves the stack
                // reconciling a value whose parent has not rendered yet.
                if openMatches, let team = focusTeam {
                    path?.wrappedValue.append(TeamEventRef(event: ref, team: team))
                } else {
                    path?.wrappedValue.append(ref)
                }
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            ProgressView("Loading events…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            ContentUnavailableView {
                Label("Could not load events", systemImage: "calendar.badge.exclamationmark")
            } description: {
                Text(message)
            } actions: {
                Button("Retry") { Task { await model.load() } }
                    .buttonStyle(.borderedProminent).tint(theme.accent)
                    .foregroundStyle(theme.onAccent)
            }
        case .loaded(let events):
            let shown = filter(events)
            if shown.isEmpty, query.trimmingCharacters(in: .whitespaces).isEmpty {
                ContentUnavailableView {
                    Label("No upcoming events", systemImage: "calendar")
                } description: {
                    Text("Nothing is on the calendar yet. Past events are under All.")
                } actions: {
                    Button("Show all events") { upcomingOnly = false }
                        .buttonStyle(.borderedProminent).tint(theme.accent)
                        .foregroundStyle(theme.onAccent)
                }
            } else if shown.isEmpty {
                ContentUnavailableView.search(text: query)
            } else {
                list(shown)
            }
        }
    }

    private func filter(_ events: [VEXEvent]) -> [VEXEvent] {
        var shown = upcomingOnly ? events.filter(\.isUpcoming) : events
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty {
            shown = shown.filter {
                $0.name.localizedCaseInsensitiveContains(trimmed)
                || $0.place.localizedCaseInsensitiveContains(trimmed)
            }
        }
        // Upcoming reads best soonest-first; history reads best newest-first.
        return shown.sorted { upcomingOnly ? $0.date < $1.date : $0.date > $1.date }
    }

    private func list(_ events: [VEXEvent]) -> some View {
        List(events) { event in
            NavigationLink(value: event.ref) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Text(event.day.map { $0.formatted(.dateTime.month(.abbreviated).day()) } ?? event.date)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(theme.accent)
                    if let tier = event.tier, tier != "Official" {
                        Text(tier.uppercased())
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(Capsule().fill(.white.opacity(0.1)))
                    }
                    if let status = event.status {
                        Text(status).font(.caption2).foregroundStyle(.secondary)
                    }
                }
                Text(event.name).font(.subheadline.weight(.medium)).lineLimit(2)
                HStack(spacing: 6) {
                    if !event.place.isEmpty {
                        Label(event.place, systemImage: "mappin.and.ellipse")
                    }
                    if let teams = event.teams, teams > 0 {
                        Text("· \(teams) teams")
                    }
                }
                .font(.caption).foregroundStyle(.secondary)
            }
            .padding(.vertical, 4)
            }
            .listRowBackground(theme.surface)
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .refreshable { await model.load() }
    }
}

@available(iOS 17.0, *)
@Observable
final class EventsModel {
    enum State {
        case loading, loaded([VEXEvent]), failed(String)
        /// Drives the fade from spinner to content.
        var isLoaded: Bool { if case .loaded = self { return true }; return false }
    }
    private(set) var state: State = .loading
    private let api = VEXRankAPI.shared

    @MainActor
    func load() async {
        // The last list first: uncached, the events feed took about two
        // seconds, and the calendar has barely changed since the last look.
        if case .loaded = state {} else if let known = await api.lastKnownEvents() {
            state = .loaded(known.events)
        } else if case .failed = state {
            // A retry: say it is trying rather than leaving the error standing.
            state = .loading
        }
        do { state = .loaded(try await api.events().events) }
        catch {
            // A list that is a day old beats swapping a working one for an error.
            if case .loaded = state { return }
            state = .failed(error.localizedDescription)
        }
    }
}
