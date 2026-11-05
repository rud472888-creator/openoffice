#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v xcodebuild >/dev/null || { echo "Xcode is required; run this script on macOS." >&2; exit 1; }
command -v xcodegen >/dev/null || { echo "Install XcodeGen: brew install xcodegen" >&2; exit 1; }
for editor in DocumentEditor SpreadsheetEditor PresentationEditor; do
  test -f "EveryOffice/Resources/$editor/index.html" || { echo "Missing $editor bundle. Run scripts/verify-web.sh first." >&2; exit 1; }
done
xcodegen generate
simulator_id="$(xcrun simctl list devices available --json | python3 -c '
import json, sys
data = json.load(sys.stdin)
devices = [d for runtime, group in data["devices"].items() if "iOS" in runtime for d in group if "iPad" in d["name"] and d.get("isAvailable")]
if not devices:
    raise SystemExit("No available iPad simulator. Install an iOS simulator runtime in Xcode.")
devices.sort(key=lambda d: (d["state"] != "Booted", "Pro" not in d["name"], d["name"]))
print(devices[0]["udid"])
')"
xcodebuild test -project EveryOffice.xcodeproj -scheme EveryOffice \
  -destination "platform=iOS Simulator,id=$simulator_id" \
  -derivedDataPath DerivedData -resultBundlePath build/EveryOffice.xcresult \
  CODE_SIGNING_ALLOWED=NO
