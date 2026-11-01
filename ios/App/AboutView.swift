import SwiftUI
import VEXRankKit

/// Who makes the app, and that it is unofficial. App Review asks for the
/// disclaimer: the data names VEX events and teams, so the app has to say
/// plainly that it isn't VEX's.
@available(iOS 17.0, *)
struct AboutView: View {
    @Environment(\.vexTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 14) {
                        Image("TeamLogo")
                            .resizable()
                            .scaledToFit()
                            .frame(width: 64, height: 64)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Scouting Cat").font(.title3.weight(.semibold))
                            Text("Made by team 55288A Makapaka").foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                }

                Section("Disclaimer") {
                    Text("Scouting Cat is not affiliated with VEX Robotics and is not a VEX product.")
                        .fontWeight(.semibold)
                    Text("Team, event and match data comes from the events.vex.com API. Ratings and statistics are calculated by Scouting Cat and are not official.")
                        .foregroundStyle(.secondary)
                }

                Section {
                    Link("Privacy policy", destination: URL(string: "https://easonli29.github.io/Vex-Rank/privacy.html")!)
                }
            }
            .scrollContentBackground(.hidden)
            .background(theme.page)
            .navigationTitle("About")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }
}
