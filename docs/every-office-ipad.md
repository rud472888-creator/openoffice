# every office for iPad

This iPad client keeps the desktop applications and document engines intact, with a native SwiftUI document library and offline WKWebView editors. It does not launch Electron or Node. The user explicitly excludes Claude/Codex execution and the project terminal from iPad.

Files imports create independent local copies. The app provides recent/favorite/search, document tabs, rename/duplicate, guarded atomic saves, sharing and printing. Native PDFKit supports page operations, text search, highlights and notes; PencilKit supplies ink annotations.

| Format                | Implemented editor path                                                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DOCX / ODT / DOC      | Desktop rich editor/schema, original-preserving save, review commands, headers/footers, pagination preview, PDF/print; ODT write-back and legacy DOC import-copy |
| XLSX                  | Actual desktop Univer grid and matched IronCalc WASM recalculation, preserving OOXML save and result caches; CSV/TSV/XLS/ODS import copies                       |
| PPTX                  | Desktop parse/render modules with visual touch transforms, text/format/table/image edits, slide operations, slideshow and PDF/print                              |
| HWP / HWPX            | Full pinned offline studio, memo editing, desktop save repairs, local document checks, verified conversion copies and PDF/print                                  |
| Markdown / TXT / JSON | Desktop rich Markdown and CodeMirror source editors, source preservation, search/replace, math/diagrams and DOCX/PDF export                                      |
| XMind                 | Desktop graphical map controller, layouts/themes/topics/notes/images/relationships and preservation                                                              |
| EPUB / HTML           | Desktop EPUB range editor, chapter/local assets; HTML source and sandboxed live preview                                                                          |
| draw.io               | Verified pinned offline vendor application with the desktop transactional bridge                                                                                 |

The [parity checklist](ipad-feature-parity.md) records missing desktop features and native/device acceptance. These implementations do not establish full desktop parity. AI/cloud services, advanced format-specific tools, recovery after process termination and physical-iPad behavior retain separate work and acceptance gates.

## Build and architecture

- `apps/ipad`: SwiftUI, PDFKit/PencilKit, tokenized loopback asset server, native save/export bridge, XcodeGen and native tests.
- `apps/ipad-web`, `apps/ipad-sheets`, `apps/ipad-slides`, `apps/ipad-hwp`, `apps/ipad-formats`, `apps/ipad-markdown`: format hosts that reuse existing desktop modules.
- `apps/ipad/scripts/verify-web.sh`: typecheck, tests and production bundles for all six workspaces, followed by complete bundled license notices.
- `apps/ipad/scripts/verify-simulator.sh`: macOS Xcode project generation and iPad unit/UI tests.
- `.github/workflows/ipad.yml`: locked dependency build and macOS Simulator CI.

Generated editor resources are ignored by Git and rebuilt before XcodeGen. Runtime assets, WASM, fonts and editor code are local. The asset server serves immutable bundle files only; document bytes travel through the WK bridge. Changed documents are written atomically, and acknowledgements refer to the saved revision. Failed writes leave the draft dirty and retryable.

## Validation

See [current validation evidence](../apps/ipad/VALIDATION.md) for individual test counts and reproducible commands. Linux browser checks exercise real edit/save/reopen and export payloads; they do not prove WKWebView layout, iPad IME, Apple Pencil or physical-device memory behavior.

The initial client passed [iPad Simulator run 41977295120](https://github.com/rud472888-creator/openoffice/actions/runs/41977295120) at `4709947d4`. This predates the expanded desktop editors and is not acceptance evidence for the new implementation. Current CI results must be checked at their exact source revision.

The [upstream assessment](ipad-upstream-review.md) records that the relevant upstream changes were already in the checkout. Apache-2.0 attribution and the bundled dependencies' notices remain included. The app icon is documented in `apps/ipad/ICON.md`. No App Store distribution signing identity or release is included.
