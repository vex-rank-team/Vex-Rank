import SwiftUI
import VEXRankKit

@available(iOS 17.0, *)
@main
struct VEXRankApp: App {
    @AppStorage("vexrank-theme") private var themeID: String = VEXTheme.midnight.id
    @AppStorage("vexrank-number-font") private var numberFontID: String = StrokeFont.marker.id
    @State private var path = NavigationPath()
    @State private var eventPath = NavigationPath()
    @State private var statPath = NavigationPath()
    @State private var teamsPath = NavigationPath()
    /// `-tab teams` opens on that tab. Seeded as the State's initial value,
    /// not assigned on appear, for the same reason the profile's season is:
    /// an assignment made as the view settles can be lost.
    @State private var tab = VEXRankApp.launchTab
    @State private var favourites = FavouriteTeams()
    /// VEX IQ's own starred teams, kept apart so neither list shows a team the
    /// program on screen cannot open.
    @State private var iqFavourites = FavouriteTeams(key: "vexrank-favourite-teams-viqrc")
    /// V5 or VEX IQ. `-vexrank-program VIQRC` on launch sets it, like any
    /// stored setting, which is how the IQ screens are opened without a tap.
    @AppStorage("vexrank-program") private var programID: String = Program.v5rc.rawValue
    private var program: Program { Program.named(programID) }

    init() {
        // Before the first screen asks for anything, so a reader who left the
        // app on VEX IQ does not first download the V5 tables.
        VEXRankAPI.shared.use(Program.named(UserDefaults.standard.string(forKey: "vexrank-program")))
    }
    /// `-about` opens the About sheet on launch, for checking it without a tap.
    @State private var showAbout = CommandLine.arguments.contains("-about")
    @State private var config = AppConfigStore()
    @Environment(\.scenePhase) private var scenePhase

    /// `-team 31260X` opens straight to a profile. Used for verifying the
    /// profile without tapping, and the hook a URL scheme will reuse.
    static func launchArgument(_ flag: String) -> String? {
        guard let index = CommandLine.arguments.firstIndex(of: flag),
              CommandLine.arguments.indices.contains(index + 1) else { return nil }
        return CommandLine.arguments[index + 1]
    }

    private static var launchTeam: String? { launchArgument("-team") }

    private static var launchTab: Int {
        switch launchArgument("-tab") {
        case "events": return 1
        case "stats": return 2
        case "teams": return 3
        default: return launchEvent == nil ? 0 : 1
        }
    }
    private static var launchEvent: String? { launchArgument("-event") }

    var body: some Scene {
        WindowGroup {
            TabView(selection: $tab) {
                NavigationStack(path: $path) {
                    RankingsListView()
                        .navigationTitle("World ranking")
                        .navigationDestination(for: TeamRef.self) { TeamProfileView(ref: $0) }
                        .navigationDestination(for: EventRef.self) { EventDetailView(event: $0) }
                        .navigationDestination(for: TeamEventRef.self) { TeamEventMatchesView(ref: $0) }
                        .navigationDestination(for: MatchRef.self) { MatchDetailView(ref: $0) }
                        .toolbar { teamBadge; themeMenu }
                }
                .serviceBanner(config)
                .tabItem { Label("Rankings", systemImage: "trophy") }
                .tag(0)

                NavigationStack(path: $eventPath) {
                    EventsListView(openEventID: Self.launchEvent,
                                   focusTeam: Self.launchArgument("-focus"),
                                   openMatches: CommandLine.arguments.contains("-matches"),
                                   path: $eventPath)
                        .navigationTitle("Events")
                        .navigationDestination(for: EventRef.self) { EventDetailView(event: $0) }
                        .navigationDestination(for: TeamEventRef.self) { TeamEventMatchesView(ref: $0) }
                        .navigationDestination(for: MatchRef.self) { MatchDetailView(ref: $0) }
                        // Reached by tapping a team in a standings or match row.
                        .navigationDestination(for: TeamRef.self) { TeamProfileView(ref: $0) }
                        .toolbar { teamBadge; themeMenu }
                }
                .serviceBanner(config)
                .tabItem { Label("Events", systemImage: "calendar") }
                .tag(1)

                NavigationStack(path: $statPath) {
                    StatLeadersView()
                        .navigationTitle("Stat leaders")
                        .navigationDestination(for: TeamRef.self) { TeamProfileView(ref: $0) }
                        .navigationDestination(for: EventRef.self) { EventDetailView(event: $0) }
                        .navigationDestination(for: TeamEventRef.self) { TeamEventMatchesView(ref: $0) }
                        .navigationDestination(for: MatchRef.self) { MatchDetailView(ref: $0) }
                        .toolbar { teamBadge; themeMenu }
                }
                .serviceBanner(config)
                .tabItem { Label("Stats", systemImage: "chart.bar") }
                .tag(2)

                NavigationStack(path: $teamsPath) {
                    TeamsDirectoryView()
                        .navigationTitle("Teams")
                        .navigationDestination(for: TeamRef.self) { TeamProfileView(ref: $0) }
                        .navigationDestination(for: EventRef.self) { EventDetailView(event: $0) }
                        .navigationDestination(for: TeamEventRef.self) { TeamEventMatchesView(ref: $0) }
                        .navigationDestination(for: MatchRef.self) { MatchDetailView(ref: $0) }
                        .toolbar { teamBadge; themeMenu }
                }
                .serviceBanner(config)
                .tabItem { Label("Teams", systemImage: "person.3") }
                .tag(3)
            }
            .task {
                // The stored config is already in hand from `init`, so this is
                // a refresh behind a working app, not a gate in front of one.
                await config.refresh(using: .shared)
            }
            .onChange(of: scenePhase) { _, phase in
                // A reader who leaves the app open for a weekend of matches
                // would otherwise never pick up a change.
                guard phase == .active else { return }
                Task { await config.refresh(using: .shared) }
            }
            .task(id: Self.launchArgument("-openmatch")) {
                // `-openmatch <eventID>` pushes the first bracket match of that
                // event, since a bracket card cannot be tapped without a touch.
                // The same reason the query and the sort have launch hooks.
                guard let id = Self.launchArgument("-openmatch"),
                      let detail = try? await VEXRankAPI.shared.eventDetail(id: id),
                      let division = detail.divisions.first(where: { !$0.bracket.isEmpty }),
                      let round = division.bracket.first,
                      let slot = round.slots.compactMap({ $0 }).first else { return }
                eventPath.append(slot.reference(round: round.label,
                                                division: detail.divisions.count > 1 ? division.name : nil))
            }
            .onAppear {
                guard let team = Self.launchTeam else { return }
                // `-team X -from <event>` arrives at the profile the way a
                // reader does from an event's team list. Only the id is real
                // here; the screen looks the event up by it anyway.
                let from = Self.launchArgument("-from").map {
                    EventRef(id: $0, name: "Event \($0)", day: nil, place: "", isUpcoming: false)
                }
                path.append(TeamRef(team, fromEvent: from))
            }
            // A program is a different set of events and teams, so each tab
            // starts again at its root, with fresh state, in the new one.
            .id(programID)
            .sheet(isPresented: $showAbout) { AboutView() }
            .environment(\.program, program)
            .environment(\.favouriteTeams, program.isIQ ? iqFavourites : favourites)
            .environment(\.appConfig, config)
            .environment(\.vexTheme, VEXTheme.named(themeID))
            .environment(\.numberFont, StrokeFont.named(numberFontID))
            .preferredColorScheme(.dark)
            .tint(VEXTheme.named(themeID).accent)
        }
    }

    /// The team behind the app. A link like any team row, so it pushes the
    /// profile onto whichever tab it was tapped from.
    private var teamBadge: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            NavigationLink(value: TeamRef("55288A")) {
                Image("TeamLogo")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 34, height: 34)
            }
            .accessibilityLabel("Built by team 55288A, Makapaka")
        }
    }

    /// Switching program clears every tab's stack and points the API at the
    /// new program in the same step that rebuilds the screens. Done after the
    /// fact - in an onChange - the rebuilt tabs would first be handed the old
    /// stacks and could start fetching the old program.
    private var programSelection: Binding<String> {
        Binding(get: { programID }, set: { code in
            guard code != programID else { return }
            VEXRankAPI.shared.use(Program.named(code))
            path = NavigationPath(); eventPath = NavigationPath()
            statPath = NavigationPath(); teamsPath = NavigationPath()
            programID = code
        })
    }

    private var themeMenu: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                // First, because it changes what every tab shows; the theme
                // only changes how it looks.
                Section("Program") {
                    Picker("Program", selection: programSelection) {
                        ForEach(Program.allCases) { Text($0.name).tag($0.rawValue) }
                    }
                }
                Picker("Colour theme", selection: $themeID) {
                    ForEach(VEXTheme.all) { Text($0.name).tag($0.id) }
                }
                // Sectioned rather than nested: both are one-tap choices, and
                // burying the second one behind a submenu hides that it exists.
                Section("Team number") {
                    Picker("Number font", selection: $numberFontID) {
                        ForEach(StrokeFont.all) { font in
                            Text("\(font.name) - \(font.detail)").tag(font.id)
                        }
                    }
                }
                Section {
                    Button { showAbout = true } label: {
                        Label("About Scouting Cat", systemImage: "info.circle")
                    }
                }
            } label: {
                Image(systemName: "circle.lefthalf.filled")
            }
            .accessibilityLabel("Theme and settings")
        }
    }
}
