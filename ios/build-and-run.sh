#!/bin/bash
# Builds the simulator app without an Xcode project: compile VEXRankKit as a
# module, compile the app against it, assemble a .app bundle, install, launch.
set -euo pipefail
cd "$(dirname "$0")"

SDK=$(xcrun --sdk iphonesimulator --show-sdk-path)
TARGET=arm64-apple-ios17.0-simulator
BUILD=.build/sim
APP="$BUILD/MakapakaScout.app"
BUNDLE_ID=com.vexrank.app

rm -rf "$BUILD"; mkdir -p "$APP"

echo "==> VEXRankKit"
swiftc -O -sdk "$SDK" -target "$TARGET" \
  -module-name VEXRankKit -emit-module -emit-module-path "$BUILD/VEXRankKit.swiftmodule" \
  -emit-library -static -o "$BUILD/libVEXRankKit.a" \
  VEXRankKit/Sources/VEXRankKit/*.swift

echo "==> app"
swiftc -O -sdk "$SDK" -target "$TARGET" -parse-as-library \
  -I "$BUILD" -L "$BUILD" -lVEXRankKit \
  -o "$APP/MakapakaScout" App/*.swift

# The asset catalog, which swiftc knows nothing about. Without this the
# simulator build shows a blank tile while the Xcode build shows the icon,
# and the difference is easy to mistake for the icon being wrong.
if [ -d App/Assets.xcassets ]; then
  echo "==> icon"
  xcrun actool App/Assets.xcassets \
    --compile "$APP" \
    --platform iphonesimulator --minimum-deployment-target 17.0 \
    --app-icon AppIcon --output-partial-info-plist "$BUILD/icon.plist" \
    --output-format human-readable-text >/dev/null
fi

cat > "$APP/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Makapaka Scout</string>
  <key>CFBundleDisplayName</key><string>Makapaka Scout</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleExecutable</key><string>MakapakaScout</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>0.1</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSRequiresIPhoneOS</key><true/>
  <key>MinimumOSVersion</key><string>17.0</string>
  <!-- Every theme is dark. Left to default, the launch screen is white, so the
       app opens with a white flash and then crossfades into a near-black
       interface - which reads as the app being slow to start. -->
  <key>UILaunchScreen</key><dict><key>UIColorName</key><string>LaunchBackground</string></dict>
  <key>CFBundleIconName</key><string>AppIcon</string>
  <key>UISupportedInterfaceOrientations</key>
  <array><string>UIInterfaceOrientationPortrait</string></array>
</dict></plist>
PLIST

echo "==> install + launch"
xcrun simctl install booted "$APP"
xcrun simctl launch --console-pty booted "$BUNDLE_ID" 2>/dev/null &
sleep 2
echo "launched $BUNDLE_ID"
