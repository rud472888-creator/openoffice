#!/usr/bin/env python3
"""Collect actual license files from every locked Cargo package, never summaries."""
import hashlib
import json
import pathlib
import subprocess

app = pathlib.Path(__file__).resolve().parents[1]
crate = app / "native/legacy-import"
destination = app / "vendor/legacy-import"
metadata = json.loads(subprocess.check_output(["cargo", "metadata", "--locked", "--offline", "--format-version", "1"], cwd=crate))
sections = ["Calamine legacy spreadsheet importer: complete locked Rust dependency licenses\n"]
for package in sorted(metadata["packages"], key=lambda value: (value["name"], value["version"])):
    if package["name"] == "ipad-legacy-import":
        continue
    root = pathlib.Path(package["manifest_path"]).parent
    files = sorted(path for path in root.rglob("*") if path.is_file() and path.name.lower().startswith(("license", "copying", "copyright", "notice", "unlicense", "authors")))
    if package.get("license_file"):
        files.append(root / package["license_file"])
    files = sorted(set(files))
    if not files:
        raise RuntimeError(f"No authoritative license text for {package['name']} {package['version']}")
    sections.append(f"\n{'=' * 72}\n{package['name']} {package['version']}\nLicense: {package.get('license')}\nRegistry source: {package.get('source')}\n")
    for path in files:
        sections.append(f"\n--- {path.relative_to(root)} ---\n{path.read_text(encoding='utf-8')}\n")
destination.mkdir(parents=True, exist_ok=True)
(destination / "THIRD-PARTY-NOTICES.txt").write_text("".join(sections), encoding="utf-8")
hashes = {str(path.relative_to(app)): hashlib.sha256(path.read_bytes()).hexdigest() for path in [destination / "legacy-import.wasm", crate / "Cargo.lock", crate / "src/lib.rs", crate / ".cargo/config.toml"]}
provenance = {"engine": "calamine", "version": "0.37.0", "compiler": subprocess.check_output(["rustc", "--version"], text=True).strip(), "target": "wasm32-unknown-unknown", "maximum_memory_bytes": 268435456, "sha256": hashes}
(destination / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")
print(f"Wrote complete licenses for {len(metadata['packages']) - 1} locked Cargo packages.")
