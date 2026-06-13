// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "FluxAPI",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "FluxAPI", targets: ["FluxAPI"]),
    ],
    targets: [
        .target(name: "FluxAPI"),
    ]
)
