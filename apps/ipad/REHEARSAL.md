# Workspace redesign

## Direction

A document workspace with paper previews, quiet chrome and a cobalt accent. The library owns the whole detail column; opening a document gives the editor the full workspace. Creation controls are a compact shelf, while real files are the main content. Grid and list layouts share the same search, favorite, rename, duplicate, export and delete actions.

Stageshow was installed from `benjitaylor/skills/stageshow` and its `craft.md`, `looks.md` and `static-card` reference informed spacing, type and hierarchy. This is a functional SwiftUI/WKWebView app, not a faux React demo: the stage kit, simulated cursor and demo-loop gate are not used. System navigation and actual editor interactions remain in control.

## Implemented surfaces

- Two-column native shell, wordmark, navigation, always-visible search and compact creation shelf.
- Actual text excerpts and system-generated file thumbnails; unsupported thumbnail formats retain their file glyph. There is no invented document content.
- Grid/list switch, file metadata, favorites and empty/search states.
- Document tabs with explicit selection, accessible close targets and compact save status.
- Matching neutral/cobalt chrome across DOCX, spreadsheet, presentation, HWP, additional-format and Markdown hosts. Embedded document engines and document formatting are retained.
- Light/dark colors, dynamic system typography, 44-point native action targets, and reduced-motion-aware button feedback.
- Nine new interface strings translated into all 21 existing locales.

## Real-device rehearsal

The original app Library is preserved. Debug UI automation now explicitly uses `UITestLibrary`, including on relaunch, and its reset flag cannot erase the normal Library. Four native regressions cover that separation. A pre-redesign copy is retained locally under the ignored build directory.

New UI acceptance exercises landscape and portrait layouts, light and dark appearance, grid/list switching, empty search and recovery, favorite persistence/removal, and HTML creation through More formats. Existing DOCX/HWP/TXT edit-save-relaunch and tab/rename/duplicate checks remain intact. Screenshots and XCTest results are retained locally, not published with unrelated device content.

The first visual review found that creation cards dominated the recent files and dark text previews merged into their surrounding cards. The final pass reduces the creation shelf and separates excerpts onto a light paper surface. Empty navigation-title spacing and ambiguous icon-only Import controls were also corrected. The device accessibility snapshot exposed a container identifier overriding sidebar button identifiers and undersized transparent hit regions; the container identifier was removed and explicit content shapes now cover the intended button bounds.

The connected iPad reports that `devicectl` screen recording is unsupported. Verification uses native XCTest interactions and their captured screenshots; XCTest may also retain automatic failure recordings. No frame-by-frame movie review or Stageshow browser animation gate is claimed.

## Remaining checks

Final device results and source revision are recorded in `VALIDATION.md`. Manual Pencil input, Korean keyboard composition, sustained memory profiling, every imported format's visual fidelity, and exhaustive accessibility text sizes remain separate acceptance work.
