#!/bin/sh
# Wraps the extension in a small Mac app so Safari can run it.
# Run on a Mac with Xcode installed:   sh safari/build-safari.sh
# Then in Xcode: pick your Apple ID under Signing & Capabilities and press Run.
set -e

SRC="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$HOME/Mazevo Setup Planner (Safari)"

if ! xcrun --find safari-web-extension-converter >/dev/null 2>&1; then
  echo "Xcode is needed. Install it from the App Store, open it once, then run this again."
  exit 1
fi

xcrun safari-web-extension-converter "$SRC" \
  --project-location "$OUT" \
  --app-name "Mazevo Setup Planner" \
  --bundle-identifier "io.github.muhammadsabihulhussnain.MazevoSetupPlanner" \
  --swift \
  --macos-only \
  --copy-resources \
  --no-prompt \
  --force

echo
echo "Xcode project created in: $OUT"
echo "Xcode should open it now. If not, open the .xcodeproj file in that folder."
