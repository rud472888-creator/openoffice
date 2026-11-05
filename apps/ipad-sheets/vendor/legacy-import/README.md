# Calamine browser conversion

`legacy-import.wasm` is built from `../../native/legacy-import`, using exactly `calamine = 0.37.0`, matching the desktop sidecar. The desktop engine is unchanged. This separate byte-input adapter imports values, formulas, dates and XLS merges into a new XLSX copy; original legacy files are never rewritten. Advanced legacy formatting, BIFF drawings and other desktop-specific conversion extras are not claimed as preserved in the copy. ODF-specific formula syntax that cannot safely translate to XLSX is refused explicitly.

Rebuild from the application directory:

```sh
rustup target add wasm32-unknown-unknown
npm run build:legacy
```

The script uses the checked-in Cargo.lock, runs native tests, builds the WASM target with the checked-in 256 MiB maximum memory and 1 MiB stack configuration, copies the resulting artifact, and regenerates licenses/provenance. Normal JavaScript/native app builds use the checked-in WASM and do not download Rust tooling. `provenance.json` records compiler version, binary SHA-256, and hashes of the source, Cargo.lock and target configuration.

The four retained wasm-bindgen descriptor imports are not application services. The JS host supplies functions that throw if called; no network, file access, random service or other external capability is exposed. Each conversion receives a fresh WASM instance. Inputs are limited to 32 MiB; XLS/ODS ZIP containers pass metered inflation limits before WASM; ODS repeated data is preflighted; output is limited to 100,000 cells and 12 MiB XML. A parser memory/stack trap becomes an explicit conversion error. 1904 XLS date cells are normalized to the new XLSX's 1900 epoch through Calamine's own calendar conversion, with a regression test.

`THIRD-PARTY-NOTICES.txt` contains complete actual LICENSE/COPYING/COPYRIGHT/NOTICE/AUTHORS files from all 50 packages in Cargo's locked graph, including platform-only dependencies conservatively. These are generated from fetched registry packages, not license summaries. `scripts/generate-legacy-notices.py` fails if an authoritative text cannot be found. The application adapter itself follows the repository's Apache-2.0 license.
