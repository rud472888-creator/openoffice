#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v xcodebuild >/dev/null || { echo "Xcode is required; run this script on macOS." >&2; exit 1; }
command -v xcodegen >/dev/null || { echo "Install XcodeGen: brew install xcodegen" >&2; exit 1; }
for editor in DocumentEditor SpreadsheetEditor PresentationEditor HwpEditor FormatsEditor MarkdownEditor; do
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
: > build/xcodebuild.log
build_status=0
active_result_bundle=build/EveryOffice-build.xcresult
run_xcodebuild() {
  local -a pipeline_status
  set +e
  xcodebuild "$@" 2>&1 | tee -a build/xcodebuild.log
  pipeline_status=("${PIPESTATUS[@]}")
  set -e
  build_status="${pipeline_status[0]}"
  if [[ "$build_status" -eq 0 && "${pipeline_status[1]}" -ne 0 ]]; then
    build_status="${pipeline_status[1]}"
  fi
  return 0
}

run_xcodebuild build-for-testing -project EveryOffice.xcodeproj -scheme EveryOffice \
  -destination "platform=iOS Simulator,id=$simulator_id" -destination-timeout 120 \
  -parallel-testing-enabled NO -derivedDataPath DerivedData \
  -resultBundlePath build/EveryOffice-build.xcresult CODE_SIGNING_ALLOWED=NO

if [[ "$build_status" -eq 0 ]]; then
  # Launch without XCTest injection before running any tests. A separate process
  # check distinguishes an app-startup crash from a test-bundle bootstrap crash.
  set +e
  python3 - "$simulator_id" <<'PY'
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

device = sys.argv[1]
directory = Path('build')
result = {'status': 'failed', 'phase': 'boot'}
log = directory / 'standalone-launch.log'

def run(arguments, timeout, allow_failure=False):
    completed = subprocess.run(arguments, text=True, capture_output=True, timeout=timeout)
    with log.open('a') as stream:
        stream.write('$ ' + ' '.join(arguments) + '\n' + completed.stdout + completed.stderr + '\n')
    if completed.returncode and not allow_failure:
        raise RuntimeError(f'{arguments[1]} exited with status {completed.returncode}: {completed.stderr.strip()[:1500]}')
    return completed

def escape(value):
    return str(value).replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')

try:
    result['phase'] = 'link-check'
    products = Path('DerivedData/Build/Products/Debug-iphonesimulator')
    app = products / 'EveryOffice.app'
    binaries = [app / 'EveryOffice', app / 'EveryOffice.debug.dylib']
    bundles = list(products.glob('*.xctest')) + list(products.glob('*.app/PlugIns/*.xctest'))
    binaries.extend(bundle / bundle.stem for bundle in bundles)
    linkage = []
    strong_dependencies = []
    for binary in sorted(set(path for path in binaries if path.is_file())):
        linked = run(['xcrun', 'otool', '-l', str(binary.resolve())], 30)
        commands = re.split(r'Load command \d+\n', linked.stdout)
        matches = [command for command in commands if re.search(r'\bname\s+\S*libswiftWebKit\.dylib\b', command)]
        linkage.append(str(binary) + ': ' + ('no libswiftWebKit dependency' if not matches else '\n' + '\n'.join(matches)))
        if any(re.search(r'\bcmd LC_LOAD_DYLIB\b', command) for command in matches):
            strong_dependencies.append(str(binary))
    (directory / 'webkit-linkage.log').write_text('\n'.join(linkage) + '\n')
    if strong_dependencies:
        raise RuntimeError('Unexpected strong libswiftWebKit dependency remains in: ' + ', '.join(strong_dependencies))
    result['phase'] = 'boot'
    run(['xcrun', 'simctl', 'boot', device], 30, allow_failure=True)
    run(['xcrun', 'simctl', 'bootstatus', device, '-b'], 120)
    result['phase'] = 'install'
    if not app.is_dir():
        raise RuntimeError(f'Built application missing: {app}')
    run(['xcrun', 'simctl', 'install', device, str(app.resolve())], 120)
    result['phase'] = 'launch'
    launch = run(['xcrun', 'simctl', 'launch', '--terminate-running-process',
                  '--stdout=' + str((directory / 'standalone.stdout.log').resolve()),
                  '--stderr=' + str((directory / 'standalone.stderr.log').resolve()),
                  device, 'app.everyoffice.ipad'], 30)
    match = re.search(r'app\.everyoffice\.ipad:\s*(\d+)', launch.stdout)
    if not match:
        raise RuntimeError('simctl launch did not return an application PID')
    pid = int(match.group(1))
    result['pid'] = pid
    result['phase'] = 'health-check'
    time.sleep(3)
    os.kill(pid, 0)
    process = run(['ps', '-p', str(pid), '-o', 'pid=,state=,comm='], 10)
    fields = process.stdout.strip().split(maxsplit=2)
    if len(fields) < 2 or fields[1].startswith('Z'):
        raise RuntimeError('The standalone application exited during its startup health check')
    result.update(status='passed', phase='standalone-app')
    print('::notice title=Standalone iPad app launch passed::The application stayed alive for 3 seconds without XCTest injection.')
except Exception as error:
    result['error'] = str(error)
    print(f'::error title=Standalone iPad app startup failed::{escape(error)}')
finally:
    (directory / 'standalone-launch.json').write_text(json.dumps(result, indent=2) + '\n')
    # XCTest must launch a fresh app process with its own test configuration.
    try:
        run(['xcrun', 'simctl', 'terminate', device, 'app.everyoffice.ipad'], 15, allow_failure=True)
    except Exception:
        pass
sys.exit(0 if result['status'] == 'passed' else 1)
PY
  build_status=$?
  set -e
fi

if [[ "$build_status" -eq 0 ]]; then
  active_result_bundle=build/EveryOffice-unit.xcresult
  run_xcodebuild test-without-building -project EveryOffice.xcodeproj -scheme EveryOffice \
    -destination "platform=iOS Simulator,id=$simulator_id" -destination-timeout 120 \
    -only-testing:EveryOfficeTests \
    -parallel-testing-enabled NO -test-timeouts-enabled YES \
    -default-test-execution-time-allowance 180 -maximum-test-execution-time-allowance 240 \
    -derivedDataPath DerivedData -resultBundlePath "$active_result_bundle" \
    CODE_SIGNING_ALLOWED=NO
fi

if [[ "$build_status" -eq 0 ]]; then
  active_result_bundle=build/EveryOffice.xcresult
  run_xcodebuild test-without-building -project EveryOffice.xcodeproj -scheme EveryOffice \
    -destination "platform=iOS Simulator,id=$simulator_id" -destination-timeout 120 \
    -only-testing:EveryOfficeUITests \
    -parallel-testing-enabled NO -test-timeouts-enabled YES \
    -default-test-execution-time-allowance 180 -maximum-test-execution-time-allowance 240 \
    -derivedDataPath DerivedData -resultBundlePath "$active_result_bundle" \
    CODE_SIGNING_ALLOWED=NO
fi

if [[ "$build_status" -ne 0 && -f scripts/simulator-diagnostics.py ]]; then
  python3 scripts/simulator-diagnostics.py --simulator "$simulator_id" --build-dir build || true
fi

# Newer Xcode versions expose concise test counts and failures directly. Keep
# legacy issue summaries as well: compile errors can occur before tests exist.
for suite in unit ui; do
  result_bundle=build/EveryOffice-unit.xcresult
  if [[ "$suite" == ui ]]; then result_bundle=build/EveryOffice.xcresult; fi
  if [[ -d "$result_bundle" ]] && ! xcrun xcresulttool get test-results summary --path "$result_bundle" \
    > "build/$suite-test-summary.json" 2> "build/$suite-test-summary.stderr"; then
    rm -f "build/$suite-test-summary.json"
  fi
done
if [[ "$build_status" -ne 0 && -d "$active_result_bundle" ]]; then
    if ! xcrun xcresulttool get object --legacy --format json --path "$active_result_bundle" \
      > build/result-issues.json 2> build/result-issues.stderr; then
      rm -f build/result-issues.json
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

suites = [value for name in ['unit-test-summary.json', 'ui-test-summary.json'] if isinstance(value := load_json(name), dict)]
summary = None
if suites:
    counts = ['totalTestCount', 'passedTests', 'failedTests', 'skippedTests', 'expectedFailures']
    summary = {key: sum(value.get(key, 0) for value in suites) for key in counts}
    summary['result'] = 'Passed' if status == 0 else 'Failed'
    summary['testFailures'] = [failure for value in suites for failure in value.get('testFailures', [])]
    (directory / 'test-summary.json').write_text(json.dumps(summary, indent=2) + '\n')
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
    print(f'::error title=iPad simulator validation failed::Validation exited with status {status}. '
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
standalone = load_json('standalone-launch.json')
if isinstance(standalone, dict):
    lines.extend([f'Standalone app startup: **{standalone.get("status", "unknown")}** '
                  f'({standalone.get("phase", "unknown")})', ''])
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
