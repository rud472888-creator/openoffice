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
mkdir -p build
set +e
xcodebuild test -project EveryOffice.xcodeproj -scheme EveryOffice \
  -destination "platform=iOS Simulator,id=$simulator_id" \
  -derivedDataPath DerivedData -resultBundlePath build/EveryOffice.xcresult \
  CODE_SIGNING_ALLOWED=NO 2>&1 | tee build/xcodebuild.log
pipeline_status=("${PIPESTATUS[@]}")
set -e
build_status="${pipeline_status[0]}"
if [[ "$build_status" -eq 0 && "${pipeline_status[1]}" -ne 0 ]]; then
  build_status="${pipeline_status[1]}"
fi

# Newer Xcode versions expose concise test counts and failures directly. Keep
# legacy issue summaries as well: compile errors can occur before tests exist.
if [[ -d build/EveryOffice.xcresult ]]; then
  if ! xcrun xcresulttool get test-results summary --path build/EveryOffice.xcresult \
    > build/test-summary.json 2> build/test-summary.stderr; then
    rm -f build/test-summary.json
  fi
  if [[ "$build_status" -ne 0 ]]; then
    if ! xcrun xcresulttool get object --legacy --format json --path build/EveryOffice.xcresult \
      > build/result-issues.json 2> build/result-issues.stderr; then
      rm -f build/result-issues.json
    fi
  fi
fi

python3 - "$build_status" <<'PY'
import json
import os
from pathlib import Path
import re
import sys

status = int(sys.argv[1])
directory = Path('build')
log = (directory / 'xcodebuild.log').read_text(errors='replace')

def load_json(name):
    try:
        return json.loads((directory / name).read_text())
    except (OSError, ValueError):
        return None

summary = load_json('test-summary.json')
issues = load_json('result-issues.json')

def escape(value):
    return str(value).replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')

def scalar(value):
    if isinstance(value, dict):
        return scalar(value.get('_value', ''))
    return str(value) if value is not None else ''

def failure_messages(value):
    if isinstance(value, dict):
        message = value.get('failureText') or value.get('message')
        if message:
            name = value.get('testName') or value.get('testIdentifier') or value.get('testCaseName')
            yield f'{scalar(name)}: {scalar(message)}' if name else scalar(message)
        for child in value.values():
            yield from failure_messages(child)
    elif isinstance(value, list):
        for child in value:
            yield from failure_messages(child)

failure_pattern = re.compile(
    r'\berror:|\bfatal error:|\bfailed\b|\*\* (?:TEST|BUILD) FAILED \*\*|'
    r'failed to|testing cancelled|testing canceled|crashed|timed out', re.IGNORECASE)
log_failures = [line.strip() for line in log.splitlines() if failure_pattern.search(line)]
structured_failures = []
if isinstance(summary, dict):
    structured_failures.extend(failure_messages(summary.get('testFailures', [])))
if isinstance(issues, dict):
    structured_failures.extend(failure_messages(issues.get('issues', issues)))

if status:
    print(f'::error title=iPad simulator validation failed::xcodebuild exited with status {status}. '
          'See build/xcodebuild.log and the simulator result bundle.')
    # Prefer concrete assertions/compiler errors over trailing generic failure
    # banners, and keep the annotation count small enough to inspect in the UI.
    concrete_pattern = re.compile(r'\berror:|assert|crash|timed out|test case .+failed', re.IGNORECASE)
    concrete = [line for line in log_failures if concrete_pattern.search(line)]
    messages = structured_failures + concrete[-14:] + log_failures[-5:]
    unique = list(dict.fromkeys(message for message in messages if message.strip()))
    if not unique:
        unique = ['No structured error was available. Last build output:\n' + '\n'.join(log.splitlines()[-30:])]
    for message in unique[:14]:
        print(f'::error title=iPad build or test diagnostic::{escape(message[:6000])}')

lines = ['## iPad simulator validation', '', f'Exit status: **{status}**', '']
if isinstance(summary, dict):
    fields = [('Result', 'result'), ('Total tests', 'totalTestCount'),
              ('Passed', 'passedTests'), ('Failed', 'failedTests'),
              ('Skipped', 'skippedTests'), ('Expected failures', 'expectedFailures')]
    lines.extend(f'- {label}: {summary[key]}' for label, key in fields if key in summary)
    print('Simulator test summary: ' + ', '.join(
        f'{label}={summary[key]}' for label, key in fields if key in summary))
else:
    # Build failures and older xcresulttool versions may have no summary JSON.
    counts = re.findall(r'Executed \d+ tests?, with \d+ failures?[^\n]*', log)
    lines.append(counts[-1] if counts else 'Test counts unavailable; tests may not have started.')
    if counts:
        print(counts[-1])
if status:
    if structured_failures:
        lines.extend(['', 'Reported issues:', ''])
        lines.extend('- ' + message.replace('\n', ' ').replace('\r', ' ')[:2000]
                     for message in list(dict.fromkeys(structured_failures))[:15])
    lines.extend(['', 'Last relevant build output:', '', '```text', *log_failures[-25:], '```'])
lines.extend(['', 'Evidence: `build/xcodebuild.log`, `build/EveryOffice.xcresult`.'])
summary_path = os.environ.get('GITHUB_STEP_SUMMARY')
if summary_path:
    try:
        with open(summary_path, 'a') as stream:
            stream.write('\n'.join(lines) + '\n')
    except OSError as error:
        print(f'::warning title=Unable to write CI summary::{escape(error)}')
PY
exit "$build_status"
