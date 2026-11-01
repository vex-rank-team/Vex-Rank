// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "VEXRankKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "VEXRankKit", targets: ["VEXRankKit"]),
    ],
    targets: [
        .target(name: "VEXRankKit", swiftSettings: [.swiftLanguageMode(.v5)]),
        .testTarget(
            name: "VEXRankKitTests",
            dependencies: ["VEXRankKit"],
            resources: [.copy("Fixtures")],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
