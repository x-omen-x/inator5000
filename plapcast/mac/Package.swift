// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "PlapCast",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "PlapCast", targets: ["PlapCast"]),
    ],
    targets: [
        .executableTarget(
            name: "PlapCast",
            path: "Sources/PlapCast"
        ),
    ]
)
