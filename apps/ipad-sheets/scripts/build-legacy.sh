#!/usr/bin/env bash
set -euo pipefail
ipad_sheets_root="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f /workspace/.setup-openoffice/activate.sh ]]; then
  source /workspace/.setup-openoffice/activate.sh
fi
cd "$ipad_sheets_root/native/legacy-import"
cargo build --locked --release --target wasm32-unknown-unknown
cargo test --locked
cp target/wasm32-unknown-unknown/release/ipad_legacy_import.wasm "$ipad_sheets_root/vendor/legacy-import/legacy-import.wasm"
python3 "$ipad_sheets_root/scripts/generate-legacy-notices.py"
