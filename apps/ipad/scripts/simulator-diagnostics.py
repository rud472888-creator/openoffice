#!/usr/bin/env python3
"""Collect bounded app-only Simulator startup diagnostics without masking test status."""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import time


def annotate(title, message):
    value = str(message)[:5500].replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
    print(f'::error title={title}::{value}', flush=True)


def crash_summary(path):
    source = path.read_text(errors='replace')
    decoder = json.JSONDecoder()
    values = []
    remaining = source.lstrip()
    while remaining:
        try:
            value, end = decoder.raw_decode(remaining)
            values.append(value)
            remaining = remaining[end:].lstrip()
        except ValueError:
            break
    if not values:
        lines = source.splitlines()
        indexes = [i for i, line in enumerate(lines) if re.search(
            r'exception|termination|application specific|crashed|triggered|abort|could not cast', line, re.I)]
        return '\n'.join(dict.fromkeys(line for i in indexes for line in lines[i:i + 7]))[:5500]
    result = []
    for value in values:
        if not isinstance(value, dict):
            continue
        for key in ['app_name', 'procName', 'exception', 'termination', 'asi', 'reportNotes', 'faultingThread']:
            if key in value:
                result.append(f'{key}: {json.dumps(value[key], ensure_ascii=False)}')
        threads = value.get('threads', [])
        index = value.get('faultingThread')
        for number, thread in enumerate(threads):
            if thread.get('triggered') or number == index:
                frames = thread.get('frames', [])[:14]
                result.append('triggered frames: ' + json.dumps(frames, ensure_ascii=False))
        if value.get('lastExceptionBacktrace'):
            result.append('last exception: ' + json.dumps(value['lastExceptionBacktrace'][:14]))
    return '\n'.join(result)[:5500]


def collect(simulator, build):
    output = build / 'diagnostics'
    output.mkdir(parents=True, exist_ok=True)
    home = Path.home()
    roots = [home / 'Library/Logs/DiagnosticReports',
             home / f'Library/Developer/CoreSimulator/Devices/{simulator}/data/Library/Logs/CrashReporter',
             home / f'Library/Developer/CoreSimulator/Devices/{simulator}/data/Library/Logs/DiagnosticReports']
    reports = []
    for root in roots:
        if root.exists():
            reports.extend(path for path in root.rglob('*') if path.is_file()
                           and 'everyoffice' in path.name.lower()
                           and path.suffix in ['.ips', '.crash']
                           and time.time() - path.stat().st_mtime < 7200)
    for number, path in enumerate(sorted(set(reports), key=lambda p: p.stat().st_mtime, reverse=True)[:8]):
        if path.stat().st_size > 16 * 1024 * 1024:
            continue
        shutil.copyfile(path, output / f'{number}-{path.name}')
        annotate('iPad process crash', path.name + '\n' + crash_summary(path))
    command = ['xcrun', 'simctl', 'spawn', simulator, 'log', 'show', '--last', '20m', '--style', 'compact',
               '--predicate', 'process == "EveryOffice" OR process == "EveryOfficeUITests-Runner"']
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=20)
        unified = result.stdout[-4 * 1024 * 1024:] + '\n' + result.stderr[-4000:]
    except subprocess.TimeoutExpired as error:
        raw = error.stdout or b''
        unified = raw.decode(errors='replace') if isinstance(raw, bytes) else raw
        unified = unified[-4 * 1024 * 1024:] + '\nDiagnostic log query timed out.'
    (output / 'app-unified.log').write_text(unified)
    pattern = re.compile(r'could not cast|fatal error|terminating app|uncaught exception|'
                         r'NS\w+Exception|SIGABRT|assertion failure|library not loaded|'
                         r'symbol not found|privacy-sensitive|dyld\[|abort\(\)', re.I)
    sources = [(output / 'app-unified.log', unified)]
    sources.extend((path, path.read_text(errors='replace')) for path in sorted(build.glob('*.log'))
                   if path.stat().st_size < 32 * 1024 * 1024)
    found = []
    for path, source in sources:
        lines = source.splitlines()
        for index, line in enumerate(lines):
            if pattern.search(line):
                found.append(f'{path.name}: ' + '\n'.join(lines[index:index + 4]))
    for message in list(dict.fromkeys(found))[-20:]:
        annotate('iPad runtime diagnostic', message)
    if not reports and not found:
        print('::warning title=iPad crash diagnostics::No app crash report or concrete startup error was available.', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--simulator', required=True)
    parser.add_argument('--build-dir', type=Path, default=Path('build'))
    options = parser.parse_args()
    try:
        collect(options.simulator, options.build_dir)
    except Exception as error:
        print(f'::warning title=iPad diagnostics collection::{type(error).__name__}: {error}', flush=True)
