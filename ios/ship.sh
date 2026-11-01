#!/bin/bash
# Build Makapaka Scout and install it on the connected iPhone.
#
#   ./ship.sh path/to/logo.png      generate the icon, then build and install
#   ./ship.sh                       build and install with the icon as it is
#
# The simulator build (build-and-run.sh) uses swiftc directly, which is enough
# to run but cannot be signed. A phone needs a signed bundle, which needs a
# real project, so this goes through MakapakaScout.xcworkspace instead.
set -euo pipefail
cd "$(dirname "$0")"

if [ $# -ge 1 ]; then
  echo "==> icon"
  # Extra arguments pass through, so a background can be forced:
  #   ./ship.sh logo.png --background 2B2B2B
  LOGO="$1"; shift
  swift Tools/make-icon.swift "$LOGO" App/Assets.xcassets/AppIcon.appiconset/icon-1024.png 1024 "$@"
fi

if [ ! -f App/Assets.xcassets/AppIcon.appiconset/icon-1024.png ]; then
  echo "No app icon yet. Pass a logo: ./ship.sh path/to/logo.png" >&2
  exit 1
fi

echo "==> project"
python3 make-xcodeproj.py

DEVICE=$(xcrun devicectl list devices 2>/dev/null | awk -F'  +' '/available \(paired\)/ && /iPhone/ {print $3; exit}')
if [ -z "$DEVICE" ]; then
  echo "No paired iPhone is available. Plug it in and unlock it." >&2
  exit 1
fi
echo "==> device $DEVICE"

echo "==> build"
xcodebuild -workspace MakapakaScout.xcworkspace -scheme MakapakaScout -configuration Release \
  -destination "generic/platform=iOS" -allowProvisioningUpdates \
  -derivedDataPath .build/device build

APP=.build/device/Build/Products/Release-iphoneos/MakapakaScout.app
echo "==> install"
xcrun devicectl device install app --device "$DEVICE" "$APP"
echo "==> installed. Open Makapaka Scout on the phone."
