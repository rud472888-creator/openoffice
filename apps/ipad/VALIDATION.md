# Validation evidence

Current implementation checkpoint: Linux, 2026-11-05. This records the tested scope, not complete desktop parity.

| Component               | Local automated evidence                                                                                                                                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rich DOCX/ODT/DOC       | 48 tests; typecheck, lint and production bundle; Chromium rich edit/save/reopen, ODT write-back, legacy DOC import-copy and actual desktop pagination/PDF payload                                                                                              |
| XLSX                    | 24 adapter tests, 2 Rust adapter tests and 4 desktop lifecycle-hook tests; desktop Univer grid with matched IronCalc WASM; Korean edit, new SUM formula, persisted numeric cache and reopen smoke; CSV/TSV/XLS/ODS copy conversion and 1904-date normalization |
| Visual PPTX             | 35 tests; typecheck/build/lint; tablet/narrow browser gestures, geometry/table/text edit/save/reopen; notes/comments, chart data, timing/layout edits; independent repository XSD validation                                                                   |
| HWP/HWPX                | 9 tests; typecheck/build; full offline studio Korean edit/save/reopen, memo create/edit, HWPX memo preservation, PDF page payload, shared document checks and format-copy conversion                                                                           |
| HTML/XMind/EPUB/draw.io | 13 tests; typecheck/build/lint; actual editors, save/reopen, native export payloads, multipage final-paragraph visibility                                                                                                                                      |
| Markdown/TXT/JSON       | 6 tests; typecheck/build/lint; desktop TipTap/CodeMirror edit/save/reopen, BOM/CRLF/frontmatter preservation, PDF pagination payload and actual DOCX diagram/block-math output and footnote input                                                              |

Browser checks use Chromium on Linux, including Korean text input, original package preservation and zero unexpected external HTTP requests. They do not establish WKWebView rendering, Korean iPad IME, Apple Pencil or physical-device memory behavior.

The native app now serves immutable bundled editor assets through a tokenized loopback HTTP server; document bytes travel only through the WK bridge. New native tests cover routing, asset confinement, navigation, PDF rendering/pagination, annotations and library operations. UI tests exercise plain text and DOCX save/relaunch, tabs/rename/duplicate, and HWP canvas input/relaunch with OCR. The current target has 43 unit tests and 4 UI tests, including nine actual-bundle WebKit route tests. Linux has no Xcode; native evidence comes from the macOS CI runs below.

The expanded implementation now compiles and launches on the iOS 18.5 Simulator. [Run 41998076399](https://github.com/rud472888-creator/openoffice/actions/runs/41998076399), source `d05d33ce4`, executed 43 unit tests: 42 passed, 1 failed, none skipped. Its only failing test was the `about:blank#preview` navigation case; UI tests did not run because the unit suite failed. Thus all nine bundled-editor open/save tests, both WebKit PDF rendering tests, and the asset-server/symlink checks passed in that run. The encoded-fragment correction and spreadsheet ribbon-width adjustment are in `c46842643`; [run 41999967509](https://github.com/rud472888-creator/openoffice/actions/runs/41999967509) rebuilt successfully but its standalone Simulator launch timed out after 30 seconds, before any tests ran. No app crash report was found. The launch budget was then raised to 120 seconds and timeout output preservation added; native revalidation remains pending.

Startup diagnosis found that the iOS 18.5 Simulator lacks `libswiftWebKit.dylib`. The app now calls the public Objective-C WebKit PDF/JavaScript APIs through a narrow bridge, preserving PDF export and actual-editor tests. The validation script checks application and test-bundle load commands, launches the app without XCTest injection, then runs unit and UI suites separately. App-only crash diagnostics and individual result bundles are retained on failure.

The earlier native implementation passed [iPad Simulator CI](https://github.com/rud472888-creator/openoffice/actions/runs/41977295120) at source `4709947d4`. That result does **not** validate the expanded editor implementation in this checkpoint. `.github/workflows/ipad.yml` rebuilds all six web workspaces, then builds and tests the native app on macOS/iPad Simulator. Check its result at the new source revision before treating current native behavior as verified.

Bundled notices cover 283 detected JavaScript dependencies, the HWP engine/studio, IronCalc, all 50 locked legacy-import Cargo packages, local fonts and the complete verified draw.io inventory. Sources and licensing caveats are recorded in `licenses/README.md` and `licenses/sources.json`.

Reproduce web checks with `bash apps/ipad/scripts/verify-web.sh`. Browser smoke commands:

```sh
node apps/ipad/scripts/browser-smoke.mjs
npm run test:browser --prefix apps/ipad-sheets
npm run test:browser --prefix apps/ipad-slides
node apps/ipad/scripts/hwp-smoke.mjs
npm run test:browser --prefix apps/ipad-formats
node apps/ipad/scripts/markdown-smoke.mjs
```

Set `CHROMIUM_PATH` when needed. Local screenshots and results are generated under ignored build/output directories. Detailed remaining feature and device gates are in [the parity checklist](../../docs/ipad-feature-parity.md). Claude/Codex execution and the project terminal are explicitly excluded by the user.
