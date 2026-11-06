# every office for iPad

A native SwiftUI workspace for iPadOS 17 and later, using the existing IeumOffice
document engines. The redesigned two-column library uses paper previews, quiet
chrome and a cobalt accent. A compact creation shelf, searchable grid/list layouts
and full-width editors adapt to the iPad window, with system dark mode and all 21
existing interface languages. Design and rehearsal notes are in [REHEARSAL.md](REHEARSAL.md).

This is a new iPad target. Desktop Electron APIs and desktop AI subprocesses are
not included. It does not connect an account, AI service, or analytics service.

## Implemented paths

- Native document library, Files import-copy, persistent recent documents in the sidebar, favorites, search, rename, duplicate, share and guarded saving.
- Rich DOCX editing with original document preservation, review tools, tables, pictures, headers/footers, page preview, PDF/print, ODT write-back and legacy DOC import-copy.
- Actual desktop Univer spreadsheet grid with matched IronCalc WASM formula recalculation and persisted result caches. CSV/TSV/XLS/ODS imports create separate XLSX copies.
- Offline DeckCraft PPTX editor with its own canvas, ribbon and slide navigation. [Build and file handling](../ipad-slides/README.md).
- Local HWP/HWPX editing with the editing toolbar visible, a native Save button and system sharing for PDF export, print, Save As and HWP/HWPX conversion.
- Graphical XMind, EPUB chapter editing, HTML source/live preview and the pinned offline draw.io application.
- Desktop Markdown rich editor and TXT/JSON CodeMirror, formatting/tables/math/diagrams, source mode, search/replace, PDF/print and DOCX export.
- Native PDF page operations, search, highlights, free-text notes, PencilKit ink and sharing/printing.

The detailed [feature checklist](../../docs/ipad-feature-parity.md) distinguishes implemented paths from remaining desktop functionality and native/device acceptance. Full desktop parity is not yet complete. Claude/Codex execution and the project terminal are explicitly excluded from iPad by the user. AI/cloud services have not been connected or exercised.

Files larger than 100 MiB cannot be imported. Individual editors enforce lower format-specific parsing limits. Invalid UTF-8, unsupported protection and known lossy rewrites are refused. Dirty documents stay open when saving fails; the native host writes atomically and acknowledges the saved revision. A terminated web process or force quit can still lose an unsaved draft; the last successful file remains available.

## Build on macOS

Use Xcode 16 or later with an installed iOS Simulator runtime, Node.js matching
the repository's `.nvmrc`, and XcodeGen (`brew install xcodegen`). From the
repository root:

```sh
npm ci
apps/ipad/scripts/verify-web.sh
apps/ipad/scripts/verify-simulator.sh
```

The first script type-checks, tests, and builds the six offline editor workspaces and
their blank-document templates. Generated editor bundles are ignored by Git; run
this script before opening the Xcode project. The second generates the Xcode project from
`project.yml`, creates a disposable iPad simulator from an installed runtime, builds all test targets,
checks standalone app startup, then runs unit and UI tests with signing disabled.
Evidence is saved under `apps/ipad/build`: `EveryOffice-build.xcresult`,
`EveryOffice-unit.xcresult`, `EveryOffice.xcresult` (UI), `test-summary.json`,
and `standalone-launch.json`. A failed earlier phase prevents later phases;
unrun tests are not passing tests. Startup failures also retain app-only crash
reports and bounded diagnostics. The disposable simulator is removed when the
script exits; existing developer devices are retained.

For interactive development:

```sh
cd apps/ipad
xcodegen generate
open EveryOffice.xcodeproj
```

Select the **EveryOffice** scheme and an iPad simulator. For a physical iPad,
choose your own signing team and bundle identifier in Xcode. The generated
project and Info.plist are ignored; `project.yml` is the source of truth. All
six generated editor directories and the Templates directory must be copied as
folder resources; the spec includes those references explicitly.

Physical-device build/test commands and local evidence are in [VALIDATION.md](VALIDATION.md). Debug UI tests use a separate `UITestLibrary` directory and reset only that directory. Relaunches retain the isolation flag; the normal document Library is preserved.

## Validation and architecture

`DocumentLibrary` owns local file operations and metadata. Imports coordinate
reads from security-scoped document-provider URLs. Each imported document has a
UUID folder so two files with the same name do not overwrite one another. Writes
use atomic replacement. Favorites use a separate JSON file; malformed favorite
metadata does not hide the document library. The app's Library directory is
visible through Finder file sharing and Files.

The native host accepts web-editor messages only from the bundled editor index
URL and cancels navigation to other pages. Editors use a nonpersistent web data
store, do not request network services, and send revisioned document snapshots
through the `everyOffice` message handler. Native saves are serialized and stale
revisions do not overwrite newer saved content. A retained editor survives
navigation until its pending save completes or the user retries a failure.

XCTest covers byte-preserving imports, duplicate filenames, restart persistence,
favorite recovery, invalid text, import limits, save/delete guards, and unique
note creation. Eleven actual-bundle WebKit tests exercise format opening and saving, including Korean DOCX input/save/reopen and the desktop TXT newline policy. A separate native lifecycle test covers saves requested before document loading completes.
XCUITest checks text notes, rich DOCX and HWP canvas input across app relaunch,
plus file rename, duplication, reopening from Recent, favorites, search, grid/list layouts, additional
format creation, and landscape/portrait/light/dark home layouts. Screenshots and bridge diagnostics
are attached to the result bundle.

On 2026-11-06, the local M4 iPad run on iPadOS 27.2 (24B119), built with Xcode 27.1 (27A9275), passed **58 distinct native tests: 50 unit tests and 8 UI tests**, across the main run and focused reruns. An interrupted animation-wait run is recorded explicitly in the validation log. All six web workspaces also passed typecheck, 136 tests and production builds. The latest historical Simulator CI at `49a5daa7c` completed with 46/49 passing and three UI failures; the local test fixes and device results are documented separately in [VALIDATION.md](VALIDATION.md).

Manual Korean keyboard composition, Pencil input, selection/keyboard behavior, memory testing and complete desktop parity remain separate acceptance work. Passing the automated device suite does not complete the full feature checklist.

Original project-owned iPad application code in this release is offered under the
[PolyForm Noncommercial License 1.0.0](EVERY-OFFICE-LICENSE). The upstream
[Apache license](../../LICENSE) and [notices](../../NOTICE) are included under
**About → License**. Offline editors also include their dependency notices.
