#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
mkdir -p apps/ipad/build
for editor in ipad-web ipad-sheets ipad-slides ipad-hwp ipad-formats ipad-markdown; do
  set +e
  (
    set -e
    cd "apps/$editor"
    npm run typecheck
    npm test
    npm run build
  ) 2>&1 | tee "apps/ipad/build/web-$editor.log"
  result=("${PIPESTATUS[@]}")
  set -e
  if [[ "${result[0]}" -ne 0 || "${result[1]}" -ne 0 ]]; then
    python3 - "$editor" <<'PY'
from pathlib import Path
import re
import sys
name = sys.argv[1]
lines = Path(f'apps/ipad/build/web-{name}.log').read_text(errors='replace').splitlines()
details = [line for line in lines if re.search(r'error|failed|FAIL|Cannot|Assertion|Expected|Received', line, re.I)]
for line in (details[-12:] or lines[-12:]):
    escaped = line[:2500].replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
    print(f'::error title={name} validation::{escaped}')
PY
    exit 1
  fi
done

node apps/ipad/scripts/notices.mjs
