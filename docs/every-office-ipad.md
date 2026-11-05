# every office for iPad

This is an iPad-specific client for the IeumOffice repository. It keeps the desktop applications intact and adds an offline native document library plus document editors bundled into WKWebView. It does not launch Electron, Node, Claude or Codex on iPad.

## Product behavior

The iPad app uses the existing white/gray surfaces, charcoal text, coral action color and blue accent. A native split view adapts to landscape, portrait and narrow multitasking windows. Files imports create private local copies; editing does not overwrite a file provider's original. Export sends an explicit copy back to Files. There are no advertisements, analytics, accounts or subscription prompts.

| Format                       | iPad capability                                                              | Deliberate limits                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Text / Markdown              | Create, edit, save and export local documents                                | Source editing, not desktop Markdown feature parity                                                                           |
| DOCX                         | Edit ordinary paragraph and table-cell text through the existing DOCX engine | Complex fields, tracked changes, embedded objects and protected content remain read-only; no desktop pagination/layout editor |
| XLSX                         | Edit simple cell values in an offline sheet grid, retain workbook parts      | Formula cells remain read-only and display cached values; no formula recalculation engine                                     |
| PPTX                         | Edit existing slide text while retaining presentation parts                  | Text/outline editing, not a slide layout designer                                                                             |
| PDF                          | Native PDFKit viewing and selection highlighting                             | No full desktop PDF object editor or OCR                                                                                      |
| Other supported office types | Native Quick Look preview where iPadOS supports the format                   | No editing or promised preview support for every format                                                                       |

Documents are saved in the app's local library and exported explicitly. Original desktop source, tests and engines are retained. Browser adapters preserve unedited archive parts and decline structures they cannot safely edit. Files containing complex layout should be checked in their original office application after editing; the app does not claim complete Microsoft Office or HWP fidelity.

## Structure

- `apps/ipad`: SwiftUI app, PDFKit and WKWebView host, XcodeGen specification, unit/UI tests.
- `apps/ipad-web`: browser DOCX adapter and text editor, reusing `@genoffice/docx-engine`.
- `apps/ipad-sheets`: offline XLSX worksheet adapter and touch grid.
- `apps/ipad-slides`: offline PPTX text adapter and slide outline.
- `apps/ipad/scripts/verify-web.sh`: browser adapter checks and resource builds.
- `apps/ipad/scripts/verify-simulator.sh`: Mac-only Xcode project generation and iPad simulator checks.
- `.github/workflows/ipad.yml`: macOS CI for the new client.

Generated browser bundles are built from the locked repository dependencies before compiling the native app. They contain no remote CDN imports. The native bridge accepts local editor messages and writes only the selected library document.

## Upstream review

See [the evidence and PR assessment](ipad-upstream-review.md). The relevant upstream PR commits were already present in the selected checkout; no duplicate cherry-picks were needed. Platform-independent document behavior is reused while desktop-only Electron, subprocess and filesystem APIs are replaced with iPad APIs.

## Validation boundary

The implementation environment is Linux. Browser and archive tests can run here, but SwiftUI/PDFKit compilation, native lifecycle behavior and Apple Pencil/device behavior require Xcode and an iPad simulator/device. A checked-in workflow or test is not evidence it passed. The delivery report must state separately which local checks passed and whether a remote simulator run completed.

The icon is an original generated asset exported to the iOS 1024px app icon slot; see `apps/ipad/ICON.md`. Existing Apache-2.0 license and attribution remain applicable. This client is not an App Store release, and no distribution signing identity is included.
