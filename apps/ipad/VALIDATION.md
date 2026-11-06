# Validation evidence

The current checkpoint covers sidebar navigation, native sharing and the DeckCraft PPTX editor on the M4 iPad. The earlier redesign and simulator results below describe their respective builds.

## Sidebar, sharing and DeckCraft

The sidebar now keeps the 50 most recently opened document IDs in opening order. Device UI tests exercised relaunch, favorites, reopening a renamed document from Recent and the home layout without a duplicate import button. HWP editing commands are visible, the formatting row is hidden, and the native share sheet offers other apps, PDF export, print, Save As and format conversion. Save As was exercised through the real system sheet into the Files destination picker. XMind uses one scrollable toolbar and displays a sheet chooser for multi-sheet maps.

The iPad presentation route now uses DeckCraft. Chromium exercised an actual New Slide command and a Korean PPTX round trip. On the M4 iPad, the editor opened the template, added a slide, saved and reopened. A copy of the persisted PPTX from the isolated UI test Library contained two slide XML parts. The original-byte WebKit test also passed. The final graphical editor uses its upstream English ribbon.

Local evidence includes `Navigation-first.xcresult`, `Navigation-share-final.xcresult` and `Navigation-deck-final.xcresult`. The first run exposed a share dismissal race and one presentation-opening timeout in the test harness. Both cases passed focused reruns. All 50 native unit tests and the HWP editing and sharing UI tests passed in the subsequent broader run. That run was stopped when XCTest repeatedly failed to tap Save in the rename sheet. The final focused run also passed DeckCraft opening, the renamed-document/Recent flow and the two-orientation home layout. The intermediate interrupted bundle is retained separately.

## Editor toolbar and card refinement: 2026-11-06

The follow-up to `ab942d59e` shortens the HWP creation label, gives every creation card the same Dynamic Type-scaled height, and hides the tab strip when only one document is open. DOCX commands occupy a single scrollable row with a category selector. HWP opens with the studio menus and formatting tools folded; the Editing tools switch restores them without changing the document.

Both affected web workspaces passed typecheck, production builds and 57 tests (48 DOCX, 9 HWP). Browser checks verified category changes at 390/1024 pixels, HWP toolbar expansion/collapse, Korean editing, saving and reopening. On the M4 iPad, the home test measured equal card heights in both orientations, and DOCX edit/save/relaunch and multi-document tab switching passed (`Refine-editor-ui.xcresult`). Its HWP check initially queried a button; the device exposes `aria-pressed` as a switch. The corrected HWP test verified both switch states and saved/reopened canvas text, alongside three bundled WebKit document regressions (`Refine-verify.xcresult`). The signed app was relaunched without test arguments.

## Workspace redesign: 2026-11-06

The working tree is based on `31038de23`, with the native workspace and six web-editor host styles redesigned. The signed Debug app uses the same M4 iPad, iPadOS 27.2 (24B119) and Xcode 27.1 (27A9275). Document engine behavior was retained. [REHEARSAL.md](REHEARSAL.md) records the Stageshow design references and visual corrections.

| Evidence under `apps/ipad/build` | Result |
| --- | --- |
| `redesign-web.log` | Six workspaces passed typecheck, 136 tests and production builds; 283 dependency notices retained. |
| `Redesign-final.xcresult` | 50 unit tests and five UI tests passed: DOCX/HWP/TXT edit-save-relaunch, favorites persistence/removal, and HTML creation through More formats. The run was interrupted during the rename test's repeated XCTest animation wait, so the bundle itself reports failure; it is not a green full-suite run. |
| `Redesign-rehearsal.xcresult` | All three remaining UI tests passed: rename/duplicate/tab switching, search empty/recovery with grid/list switching, and full-width landscape/portrait home in light/dark appearance. |
| `Redesign-layout.xcresult` | Final equal-height creation cards passed the landscape/portrait/light/dark layout test again. |
| Standalone launch | Final signed app launched without test flags into the preserved normal Library; the UI test runner was removed. |
| `redesign-library-comparison.json` | Both files in the normal Library retained their relative paths and identical SHA-256 hashes before/after automation. |
| Source checks | Theme-color policy, English-comment policy, `git diff --check`, and all nine new strings in all 21 locales passed. Existing translations are semantically unchanged. |

The initial favorites failure was caused by SwiftUI propagating the sidebar container's accessibility identifier over its buttons. Removing that identifier restored distinct destinations. Explicit content shapes also expand transparent button regions to their intended bounds. The rename test now sends deletion and replacement as one continuous input, retaining its complete filename and document-content assertions. A separate TXT animation wait eventually completed and passed; the platform warning remains in the recorded log.

Debug UI tests use `UITestLibrary` on every launch and relaunch. Reset requires the isolation flag, cannot reset an explicit directory, and is disabled in Release. Four unit regressions verify this separation. Screenshots remain local because the device has unrelated picture-in-picture content. XCTest screen captures are used after settling rotation; no Stageshow browser/demo movie gate is claimed. A final card-height adjustment reserves equal two-line title space; its layout check is recorded separately.

## Existing Linux/browser evidence: 2026-11-05

The table below records earlier Linux/browser checks. The 2026-11-06 macOS run repeated the six-workspace typecheck, 136 tests and production builds; it did not repeat lint, browser smoke or Rust tests.

| Component               | Local automated evidence                                                                                                                                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rich DOCX/ODT/DOC       | 48 tests; typecheck, lint and production bundle; Chromium rich edit/save/reopen, ODT write-back, legacy DOC import-copy and actual desktop pagination/PDF payload                                                                                              |
| XLSX                    | 24 adapter tests, 2 Rust adapter tests and 4 desktop lifecycle-hook tests; desktop Univer grid with matched IronCalc WASM; Korean edit, new SUM formula, persisted numeric cache and reopen smoke; CSV/TSV/XLS/ODS copy conversion and 1904-date normalization |
| Visual PPTX             | 35 tests; typecheck/build/lint; tablet/narrow browser gestures, geometry/table/text edit/save/reopen; notes/comments, chart data, timing/layout edits; independent repository XSD validation                                                                   |
| HWP/HWPX                | 9 tests; typecheck/build; full offline studio Korean edit/save/reopen, memo create/edit, HWPX memo preservation, PDF page payload, shared document checks, format-copy conversion, overlapping saves/input revisions and zero missing asset responses          |
| HTML/XMind/EPUB/draw.io | 13 tests; typecheck/build/lint; actual editors, save/reopen, native export payloads, multipage final-paragraph visibility                                                                                                                                      |
| Markdown/TXT/JSON       | 7 tests; typecheck/build/lint; desktop TipTap/CodeMirror edit/save/reopen and rapid per-change TXT autosave, BOM/CRLF/frontmatter preservation, PDF pagination payload and actual DOCX diagram/block-math output and footnote input                            |

Browser checks use Chromium on Linux, including Korean text input, original package preservation and zero unexpected external HTTP requests. They do not establish WKWebView rendering, Korean iPad IME, Apple Pencil or physical-device memory behavior.

The native app now serves immutable bundled editor assets through a tokenized loopback HTTP server; document bytes travel only through the WK bridge. Native tests cover routing, asset confinement, navigation, PDF rendering/pagination, annotations and library operations. UI tests exercise plain text and DOCX save/relaunch, tabs/rename/duplicate, and HWP canvas input/relaunch with OCR. The current target has 50 unit tests and 8 UI tests, including eleven actual-bundle WebKit route tests and a native save-before-open lifecycle regression. The local device evidence and historical macOS CI results are recorded separately below.

## Physical iPad before the redesign: 2026-11-06

The signed Debug app was built and installed on an M4 iPad running iPadOS 27.2 (24B119), using Xcode 27.1 (27A9275). The tested working tree is based on `42080689d`, with test-only changes described below; application and document-engine production sources were unchanged.

| Evidence | Result |
| --- | --- |
| `bash apps/ipad/scripts/verify-web.sh` | All six workspaces passed typecheck, 136 tests in total, and production builds. Bundled notices were regenerated. |
| `apps/ipad/build/Device-unit-final.xcresult` | 46 unit tests passed, 0 failed, 0 skipped. Includes actual-bundle routes, Korean DOCX input/save/reopen, byte-exact TXT saving, asset confinement, PDF and save-before-open checks. |
| `apps/ipad/build/Device-ui.xcresult` | All 4 UI tests passed, 0 failed, 0 skipped: DOCX edit/save/relaunch (24.413 s), HWP canvas edit/save/relaunch (19.386 s), TXT edit/save/relaunch (20.015 s), and rename/duplicate/tab switching. |
| Final standalone launch | `app.everyoffice.ipad` version 0.1.0 (1) remained installed and launched successfully after the test runners were removed. A local screenshot confirmed the Korean home screen; the Library contained two test notes. |

The new DOCX regression inserts English and Korean text through WebKit, saves through the native bridge, opens the saved bytes in a fresh WebKit host, and checks complete DOM text and unchanged-byte saving. This tests document handling; it does not simulate Korean keyboard composition. The TXT UI assertion now removes only trailing CR/LF accessibility block separators before comparing the complete text; the independent WebKit test still requires exact saved bytes under the desktop newline policy.

The first local unit run passed 45 of 46 tests. Its only failure compared an asset-server URL under `/var` against the equivalent resolved `/private/var` path. The test expectation now resolves the existing root's symlinks before appending the missing file. Rebuilding and rerunning the full unit suite produced the 46/46 result above; no production asset-server behavior was changed.

These results verify the named automated workflows on this device. Manual Korean IME composition, selection handles, on-screen keyboard resizing, Pencil input, external keyboard shortcuts, sustained memory behavior, broader document fidelity and complete desktop feature parity remain unverified. Local result bundles, summaries and screenshots remain in ignored build directories.

To reproduce the physical-device checks, set `IPAD_DEVICE_ID` and `APPLE_DEVELOPMENT_TEAM` locally, rebuild the six web bundles, and use the following from `apps/ipad`. The earlier recorded run started with an empty installation. Current Debug UI tests explicitly use and reset a separate `UITestLibrary`; the normal Library is preserved, including across relaunches.

```sh
xcodegen generate
env DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  xcodebuild build-for-testing -project EveryOffice.xcodeproj -scheme EveryOffice \
  -destination "platform=iOS,id=$IPAD_DEVICE_ID" -derivedDataPath DerivedDataDevice \
  -resultBundlePath build/Device-build.xcresult \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  DEVELOPMENT_TEAM="$APPLE_DEVELOPMENT_TEAM"
env DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  xcodebuild test-without-building -project EveryOffice.xcodeproj -scheme EveryOffice \
  -destination "platform=iOS,id=$IPAD_DEVICE_ID" -derivedDataPath DerivedDataDevice \
  -resultBundlePath build/Device-unit-final.xcresult -parallel-testing-enabled NO \
  -only-testing:EveryOfficeTests
env DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  xcodebuild test-without-building -project EveryOffice.xcodeproj -scheme EveryOffice \
  -destination "platform=iOS,id=$IPAD_DEVICE_ID" -derivedDataPath DerivedDataDevice \
  -resultBundlePath build/Device-ui.xcresult -parallel-testing-enabled NO \
  -only-testing:EveryOfficeUITests
```

Use unused result-bundle paths for a repeat run. The final unit run followed a rebuild after the test-path correction; existing signing configuration and device trust are required.

## Historical Simulator CI

The expanded implementation compiled and launched on the iOS 18.5 Simulator at `d05d33ce4`. Native evidence is revision-specific:

| Source      | CI run                                                                                  | Observed result                                                                                                                                                                                                                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `d05d33ce4` | [41998076399](https://github.com/rud472888-creator/openoffice/actions/runs/41998076399) | 43 unit tests executed: 42 passed, 1 failed, 0 skipped. Only `about:blank#preview` failed; UI tests did not run. All nine actual-bundle open/save tests, both WebKit PDF tests and asset-server checks passed.                                                                                                                                   |
| `c46842643` | [41999967509](https://github.com/rud472888-creator/openoffice/actions/runs/41999967509) | Encoded-fragment fix compiled; standalone launch timed out at 30 seconds before tests. No app crash report found.                                                                                                                                                                                                                                |
| `3b5d619ba` | [42001839240](https://github.com/rud472888-creator/openoffice/actions/runs/42001839240) | Rebuilt; launch still timed out at the increased 120-second limit before tests. GitHub reported ARM capacity constraints.                                                                                                                                                                                                                        |
| `bb6e7bb02` | [42003721269](https://github.com/rud472888-creator/openoffice/actions/runs/42003721269) | Standard Intel runner rebuilt; Simulator boot timed out before app installation or tests.                                                                                                                                                                                                                                                        |
| `0911e52b4` | [42007403326](https://github.com/rud472888-creator/openoffice/actions/runs/42007403326) | All six web editor checks/bundles passed. Disposable iOS 18.6 Simulator launched; 47 native tests executed: 45 passed, 2 UI tests failed, 0 skipped. All 43 unit tests and DOCX/HWP edit-save-relaunch UI tests passed. TXT UI assertions observed an incomplete immediate AX value and two trailing newlines in the AX value after duplication. |
| `ed774e25a` | [42013572482](https://github.com/rud472888-creator/openoffice/actions/runs/42013572482) | All six web editor checks/bundles passed. 49 native tests executed: 48 passed, 1 failed, 0 skipped. All 45 unit tests, both TXT UI tests and HWP UI passed. DOCX UI failed at an assertion without a phase message; its reopen/readiness waits and diagnostics are now being tightened.                                                          |
| `49a5daa7c` | [42017763397](https://github.com/rud472888-creator/openoffice/actions/runs/42017763397) | Completed with 49 tests: 46 passed, 3 UI tests failed, 0 skipped. All 45 unit tests and HWP UI passed. DOCX UI observed a partial AX input value; both TXT UI checks failed their AX newline expectations. Application and bundled-editor sources were unchanged from `ed774e25a`. |

The encoded `about:` fragment correction is verified by the passing native unit suite at `0911e52b4`. The spreadsheet ribbon-width adjustment has tablet/narrow Chromium evidence. TXT UI checks and the exact-byte WebKit test passed at `ed774e25a`, but the later `49a5daa7c` run exposed further AX value/newline failures. The local test corrections and passing physical-device results above supersede the previous pending-run status; they do not change that historical CI result. The DOCX UI retains complete-input, durable-save and reopened-editor readiness assertions. Its earlier Simulator prefix failure has not been independently reproduced or proven to be document-data loss.

A new empty source file receives one final newline from the shared desktop source writer; this is existing desktop behavior, not an iPad serialization change. The new model regression and rapid-input Chromium check verify all typed characters, matching save/change revisions, exactly one final newline and byte-identical reopen.

The save-before-open regression added after source `0911e52b4` requests a native save before WebKit finishes opening, then checks that the queued save writes the expected Korean text to the library file and clears the saving state. It passed in the 45-test unit suite at `ed774e25a`; earlier run counts did not include it. The HWP bundler now resolves paths from its own script location; invoking it from the repository root produced the same 34 asset files byte for byte without creating a sibling output directory.

Startup diagnosis found that the iOS 18.5 Simulator lacks `libswiftWebKit.dylib`. The app now calls the public Objective-C WebKit PDF/JavaScript APIs through a narrow bridge, preserving PDF export and actual-editor tests. The validation script checks application and test-bundle load commands, launches the app without XCTest injection, then runs unit and UI suites separately. App-only crash diagnostics and individual result bundles are retained on failure.

The earlier native implementation passed [iPad Simulator CI](https://github.com/rud472888-creator/openoffice/actions/runs/41977295120) at source `4709947d4`. That result does **not** validate the expanded editor implementation in this checkpoint. `.github/workflows/ipad.yml` rebuilds all six web workspaces, then builds and tests the native app on macOS/iPad Simulator. Check its result at the new source revision before treating current Simulator behavior as verified.

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
