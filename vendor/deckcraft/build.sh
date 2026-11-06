#!/usr/bin/env bash
# Requires git, Rust 1.95.0 with wasm32-unknown-unknown, wasm-bindgen 0.2.129 and Python 3.
set -euo pipefail
vendor="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git -C "$work" init -q source
cd "$work/source"
git fetch --depth 1 https://github.com/storytold/deckcraft.git 9a95c3a63942377b1a4c8d79844a94a54ffac370
git checkout --detach FETCH_HEAD
git apply "$vendor/ipad-host.patch"
git -C "$work" init -q fonts
git -C "$work/fonts" fetch --depth 1 https://github.com/storytold/craft-fonts.git 37827adc41fd165f9a9234ac40f94dbad353aa69
git -C "$work/fonts" checkout --detach FETCH_HEAD
export CRAFT_FONTS_DIR="$work/fonts" CRAFT_FONTS_REQUIRED=1
export CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS="--remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo --remap-path-prefix=$work/source=/deckcraft --remap-path-prefix=$work=/build"
cargo build --locked --release --target wasm32-unknown-unknown -p deckcraft-web
wasm-bindgen --target web --no-typescript --out-dir "$work/runtime" target/wasm32-unknown-unknown/release/deckcraft-web.wasm
python3 "$vendor/package.py" "$work/runtime"
