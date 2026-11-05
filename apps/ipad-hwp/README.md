# Offline iPad HWP editor

This host embeds the **same pinned, patched rhwp-studio** as the desktop app. It retains the studio's page canvas, text and paragraph formatting, tables, pictures, shapes, page setup and keyboard editing. A touch memo panel uses the same memo commands and protection rules. The desktop document-check panel runs locally with the same rules and font replacement commands. HWP/HWPX conversion creates a separate library copy only after the engine reports no content loss and text/memo read-back succeeds. PDF export and printing send the engine's page SVGs to the native PDF/share/print bridge. The studio ships Korean and English; host controls and errors reuse the desktop's 21 language dictionaries.

The native host serves immutable bundle assets on a per-editor, tokenized loopback HTTP URL. The SDK requires a real HTTP origin. Document bytes only travel over the existing WKScriptMessageHandler bridge and are never served over HTTP. The bundled pages' CSP forbids remote requests. No hosted studio or CDN is used.

## Build and verify

From the repository root:

```sh
npm run typecheck -w @genoffice/ipad-hwp
npm test -w @genoffice/ipad-hwp
npm run build -w @genoffice/ipad-hwp
node apps/ipad/scripts/hwp-smoke.mjs
```

The first build downloads the desktop studio's pinned commit and an OFL old-Hangul font from that same commit. All runtime assets are then local. `Resources/HwpEditor` is generated and ignored by Git; CI rebuilds it before XcodeGen. The browser test uses Chromium and does not replace native iPad Simulator tests.

## File preservation

- Unchanged saves return the exact original bytes.
- Changed HWP saves run the existing export/reload page-count verification and desktop tab-width, field-kind and section-tail repairs.
- HWPX saves use the existing memo preservation check and ZIP expansion gate.
- A password-protected or tracked-change document cannot be automatically rewritten in a way that removes protection/history. Known loss of master pages or memos fails the mobile save.
- `notifySaved` runs only after native storage acknowledges the corresponding revision. Failed writes leave the draft dirty.
- Node compression and SHA-1 record-identity operations are narrow browser adapters; their outputs are checked against Node. Existing desktop engine modules are imported unchanged.

The shared studio's existing feature/compatibility limits remain. The mobile PDF bridge accepts at most 250 pages per export. Desktop recovery dialogs and OS font discovery remain separate features; see `docs/ipad-feature-parity.md`. Embedding the studio is not a claim of full desktop parity.
