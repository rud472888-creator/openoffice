# every office for iPad

A native SwiftUI workspace for iPadOS 17 and later, based on the existing
IeumOffice design and document engines. The app uses the desktop shell's blue
accent, neutral surfaces, sidebar navigation, and document cards, with adaptive
columns, system dark mode, and support for all 21 existing interface languages.

This is a new iPad target. Desktop Electron APIs and desktop AI subprocesses are
not included. It does not connect an account, AI service, or analytics service.

## What works

- Create notes, Markdown documents, and blank DOCX, XLSX, and PPTX documents.
- Import one or more documents using Files, including document-provider files.
  Import copies the selected file into the app library; it does not edit the
  original in place. Open-in URLs use the same copy workflow.
- Browse recent documents, search filenames, add favorites, and delete local
  copies. The library and favorites survive app restarts.
- Edit UTF-8 text and Markdown, with automatic saves and an inline Markdown
  preview. The preview supports inline syntax and preserves line breaks; it
  does not render every block-level Markdown feature.
- Edit supported DOCX paragraphs with the existing document engine, edit XLSX
  cell values, and edit PPTX text in bundled offline WKWebView editors. Each
  editor documents its supported subset in its package README. Unsupported
  structures are guarded rather than rebuilt as a simplified document.
- View PDFs with PDFKit. Select text and use **Highlight** to save a highlight
  into the local PDF copy, provided the PDF permits annotations.
- Preview other documents with Quick Look when the system supports their format.
  Unsupported formats remain available for original-byte export.
- Export a copy through the system file exporter or Share menu. Import/export
  and document sharing work without an app-specific cloud service.

The document editors are not full replacements for the desktop layout editors.
There is no spreadsheet formula calculation, slide layout editing, PDF text
editing, AI integration, desktop project integration, HWP editing, mind-map
editing, or draw.io editing. Office-format details and preservation constraints
are described in [DOCX](../ipad-web/README.md),
[XLSX](../ipad-sheets/README.md), and [PPTX](../ipad-slides/README.md).

Files larger than 100 MiB cannot be imported. Text editing is limited to UTF-8
files up to 10 MiB. Invalid UTF-8 files are not overwritten. Unsaved text and web
editor drafts are retained in memory across navigation if a save fails, with
**Retry save** available. Export, sharing, and deletion are blocked while a
document has a pending save. A force quit or terminated web process can still
lose an unsaved draft; the last successful local save remains available.

## Build on macOS

Use Xcode 16 or later with an installed iOS Simulator runtime, Node.js matching
the repository's `.nvmrc`, and XcodeGen (`brew install xcodegen`). From the
repository root:

```sh
npm ci
apps/ipad/scripts/verify-web.sh
apps/ipad/scripts/verify-simulator.sh
```

The first script type-checks, tests, and builds the three offline editors and
their blank-document templates. The second generates the Xcode project from
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
three HTML editor directories and the Templates directory must be copied as
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
note creation. XCUITest creates and edits both a native text note and a DOCX in
the bundled editor, relaunches the app, and verifies the saved content. The DOCX
test also attaches a simulator screenshot to its result bundle.

The initial implementation environment is Linux, so native compilation and iPad
Simulator execution cannot be verified there. A successful web test run does
not establish native build or simulator success. Use the macOS validation
script or the repository's iPad workflow to obtain that evidence.

The original repository [LICENSE](../../LICENSE) and [NOTICE](../../NOTICE) are
bundled and visible under **About → Open source notices**. Browser dependency
notices are retained with the offline editor resources.
