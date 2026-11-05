# every office for iPad

A native SwiftUI workspace for iPadOS 17 and later, based on the existing
IeumOffice design and document engines. The app uses the desktop shell's blue
accent, neutral surfaces, sidebar navigation, and document cards, with adaptive
columns, system dark mode, and support for all 21 existing interface languages.

This is a new iPad target. Desktop Electron APIs and desktop AI subprocesses are
not included. It does not connect an account, AI service, or analytics service.

## What works

- Native document library, Files import-copy, recent/favorite/search, tabs, rename, duplicate, share and guarded saving.
- Rich DOCX editing with original document preservation, review tools, tables, pictures, headers/footers, page preview, PDF/print, ODT write-back and legacy DOC import-copy.
- Actual desktop Univer spreadsheet grid with matched IronCalc WASM formula recalculation and persisted result caches. CSV/TSV/XLS/ODS imports create separate XLSX copies.
- Graphical PPTX shape/text/table/image editing, touch transforms, slide arrangement, undo/redo, slideshow and PDF/print.
- Full local HWP/HWPX studio, Korean text editing, formatting, tables/pictures, memo editing, verified saves, document checks, HWP/HWPX conversion copies and PDF/print.
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
`project.yml`, chooses an available iPad simulator, and runs the unit and UI
tests with signing disabled. Its result bundle is
`apps/ipad/build/EveryOffice.xcresult`.

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
note creation. Nine actual-bundle WebKit tests exercise format opening and saving.
XCUITest checks text notes, rich DOCX and HWP canvas input across app relaunch,
plus file rename, duplication and tabs. Simulator screenshots and bridge diagnostics
are attached to the result bundle.

The initial implementation environment is Linux, so native compilation and iPad
Simulator execution cannot be verified there. A successful web test run does
not establish native build or simulator success. Use the macOS validation
script or the repository's iPad workflow to obtain that evidence.

The original repository [LICENSE](../../LICENSE) and [NOTICE](../../NOTICE) are
bundled and visible under **About → Open source notices**. Browser dependency
notices are retained with the offline editor resources.
