# iPad feature parity checklist

Source audit: 2026-11-05, desktop baseline `8a2dafdd9a7cb28d5f2635f007676841dadeaf08`. This is an implementation checklist, not a claim of completed parity. The verified implementation checklist below records implemented code and its stated test environment. The full-feature rows remain open whenever any listed part or acceptance evidence is missing. Browser tests establish browser behavior, not iPadOS acceptance; native CI/device gates remain separate.

The implementation now includes rich DOCX editing, a desktop-grid XLSX adapter, visual PPTX, full local HWP studio, graphical XMind, EPUB chapter editing, HTML source/preview, full offline draw.io and a Markdown browser editor. These replace the initial text-only format adapters. Full desktop parity remains incomplete: the detailed matrix below records missing editor controls, AI/cloud services and native/device acceptance.

## Verified implementation checkpoint

These checked items have concrete implementations and the stated automated evidence. They are narrower than the complete desktop feature groups below.

- [x] HTML source editing, sandboxed preview, leaf-text source patches, paragraph insertion, undo/redo and exact unchanged/BOM/newline preservation: [adapter](../apps/ipad-formats/src/html.ts), model tests and tablet Chromium edit/save smoke.
- [x] Graphical XMind editing using the actual desktop `MapController`/`DocumentSession`: topics, rich emphasis, notes, pictures, relationships, summaries, boundaries, folds, six layouts, themes, sheet add/rename. Unknown ZIP entries survive model save/reopen tests; tablet Chromium adds and saves a real branch. [Adapter](../apps/ipad-formats/src/mindmap.ts).
- [x] EPUB chapter navigation and in-place editing through the actual desktop `EpubEditController`, original core range edits and local image/CSS/font resolution; original inline formatting and unrelated entries survive save/reopen. Fixed-layout books are read-only. [Adapter](../apps/ipad-formats/src/epub.ts).
- [x] Pinned offline draw.io application plus existing desktop bridge under the native loopback origin, `.drawio`/`.dio` editing and XML serialization. Tablet Chromium adds a real graphical object, saves it and observes zero external network requests. Vendor bytes remain unchanged; the serving copy of `index.html` receives the CSP and bridge script. [Adapter](../apps/ipad-formats/src/diagram.ts), [bundle](../apps/ipad-formats/scripts/bundle.mjs).
- [x] Native export bridge payloads from all four additional formats: PDF and print pages; XMind SVG/PNG/Markdown, diagram current-page SVG/PNG and HTML file export. Existing desktop map snapshots and diagram page rendering are reused. HTML/EPUB export uses desktop EPUB CSS-column pagination, embedded data assets and PDF-point dimensions. Chromium verifies multiple pages and the final paragraph's visible position, inert output fragments, file bytes and native completion callback dispatch. Actual iPad PDF/share rendering remains an acceptance gate. [Export adapter](../apps/ipad-formats/src/export.ts), [reproducible smoke](../apps/ipad-formats/scripts/browser-smoke.mjs).
- [x] Additional-format mobile archive/output limits and forbidden-character refusal have regression coverage. Run `npm run test --prefix apps/ipad-formats` (9 tests), `npm run typecheck --prefix apps/ipad-formats`, `npm run build --prefix apps/ipad-formats` and `npm run test:browser --prefix apps/ipad-formats`.

Other format owners report these concrete checkpoints; their source/tests are the evidence, while the unchecked full-feature groups remain the remaining acceptance inventory:

| Format   | Current implementation evidence                                                                                                                                                                                                                                                                                                                        | Remaining scope examples                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DOCX     | [Rich editor](../apps/ipad-web/src/rich-editor.ts), [preserving model](../apps/ipad-web/src/rich-document.ts), [review](../apps/ipad-web/src/review-tools.ts), [print](../apps/ipad-web/src/print-preview.tsx) reuse the desktop schema/conversion.                                                                                                    | Remaining advanced dialogs/objects, complete section variants, and layout/font fidelity acceptance.                                                                            |
| XLSX     | [Desktop host](../apps/ipad-sheets/src/desktop-host.ts), [desktop save](../apps/ipad-sheets/src/desktop-save.ts), [calculation](../apps/ipad-sheets/src/calculation.ts) integrate desktop Univer and matched IronCalc 0.9.1 WASM.                                                                                                                      | Independent calculation/cache comparisons, unsupported feature reporting and grid/native acceptance.                                                                           |
| PPTX     | [Visual workspace](../apps/ipad-slides/src/workspace.ts), [preserving model](../apps/ipad-slides/src/visual.ts), [SVG](../apps/ipad-slides/src/svg.ts) support graphical transforms, formatting, insertion, slide operations, tables, slideshow and print payloads. Owner reports 35 unit tests and browser gestures/save/reopen smoke.                | Foreign/custom chart-data and SmartArt/equation/OLE/media editing, master/layout object editing, animation playback, modern comments and unrestricted paragraph restructuring. |
| HWP/HWPX | [Full local studio host](../apps/ipad-hwp/src/main.ts), [session verification](../apps/ipad-hwp/src/session.ts), [memo editor](../apps/ipad-hwp/src/browser-memos.ts), [preservation tests](../apps/ipad-hwp/tests/preservation.test.ts). Owner reports browser-tested studio, memo create/edit/delete, HWPX memo preservation and print/PDF payloads. | Studio feature-by-feature touch/IME/layout acceptance and native rendering; no paid AI service exercised.                                                                      |
| Markdown | [Browser editor](../apps/ipad-markdown/src/main.tsx), [preserving model](../apps/ipad-markdown/src/document.ts), [tests](../apps/ipad-markdown/tests/document.test.ts) are included in the native resource build.                                                                                                                                      | Workspace-backed assets/wiki links, AI workflows and native acceptance.                                                                                                        |

## Reuse and platform boundaries

These browser bundle probes used esbuild `platform: 'browser'`, no Node polyfills and in-memory output. They establish dependency boundaries only.

| Existing entry                   | Probe/evidence                                                              | iPad integration                                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `@genoffice/docx-engine`         | Browser bundle succeeds.                                                    | Reuse original parse/save engine, desktop schema and conversion, not a textarea projection.                                               |
| `@genoffice/odt-engine`          | Browser bundle succeeds.                                                    | Reuse DOCX bridge and original-ODT patch map; retain desktop ODT restrictions and conversion reports.                                     |
| `@genoffice/xmind-engine`        | Browser bundle succeeds.                                                    | Reuse `.xmind` preservation/reconciliation with desktop mind-elixir renderer.                                                             |
| `@genoffice/epub-engine/core`    | Browser bundle succeeds. Root entry fails Node imports through translation. | `/core` supplies opening, chapter block map, range edits and save; keep translation transport/store separate.                             |
| `@genoffice/drawio-model`        | Browser bundle succeeds.                                                    | Model/operations only; the draw.io editor still needs its offline vendor assets and frame bridge.                                         |
| `@genoffice/pptx-render`         | Browser bundle succeeds.                                                    | Reuse render model and browser shape/text/table/chart rendering.                                                                          |
| `@genoffice/pptx-engine` root    | Node crypto/zlib/fs/stream imports fail browser bundle.                     | Reuse pure parse/theme/placeholder/generate modules with a deliberate archive adapter; retain all untouched package entries.              |
| XLSX gateway root                | Node crypto/fs/path imports fail browser bundle.                            | Browser grid/formula services and OOXML package IO are separate work.                                                                     |
| `@rhwp/core`, `@rhwp/editor`     | Both browser bundles succeed; vendored engine WASM exists.                  | Full HWP studio is already a web editor. SDK requires HTTP(S) host and studio origins, so the existing `file://` WK host is insufficient. |
| `@genoffice/ai-provider/browser` | Browser bundle succeeds.                                                    | Provider definitions and selection rules; does not make subprocess-based providers runnable.                                              |
| `@genoffice/pdf-structure` root  | Node fs/os/path/zlib imports fail browser bundle.                           | Port browser-safe work modules plus native storage/worker services; do not import root and provide fake success.                          |

### Full DOCX path

Evidence: [desktop App](../apps/docs/src/renderer/App.tsx), [file actions](../apps/docs/src/renderer/file-actions.ts), [editor conversion](../apps/docs/src/renderer/editor/convert.ts), [desktop API](../apps/docs/src/shared/ipc.ts), [preload](../apps/docs/src/preload/index.ts), [parse worker host](../apps/docs/src/renderer/parse-off-thread.ts), [template fonts](../apps/docs/src/renderer/template-fonts.ts).

The actual editor uses Tiptap `EditorContent`/`useEditor`, the desktop `editorExtensions`, `blocksToPmDoc` on open and `pmDocToSavePlan` on save. `loadFile` also adopts embedded fonts, loads bundled substitutes, applies document layout, registers numbering and opens section/header/footer state. `buildDocBytes` passes these states back to `saveDocx`. Importing only the schema and adding a small toolbar does not complete every desktop dialog or document feature.

Two viable hosts are the full desktop React application with a real `window.desktop` adapter installed before bootstrap, or a new host reusing the same complete editor modules and explicitly implementing each required operation. Native file IO, recovery, images, font URLs, capture/print and settings need real implementations. Desktop `genoffice-media`/font protocols and worker URLs must resolve locally. AI and OS-only services must report unavailable until their actual replacement exists.

### HWP studio path

Evidence: [studio builder](../apps/hwp/scripts/build-studio.mjs), [studio options](../apps/hwp/src/renderer/studio-settings.ts), [desktop host](../apps/hwp/src/renderer/App.tsx), [save flow](../apps/hwp/src/renderer/save-flow.ts), [vendor engine](../vendor/rhwp-core/package.json), [save fixes](../apps/hwp/src/main/save-fixes.ts).

`build-studio.mjs` builds pinned rhwp-studio into `apps/hwp/public/studio`, aliases the patched local WASM, disables external webfonts and studio AI, includes application editing plugins and local Hanja data. The host uses `createEditor`, `loadFile`, `exportHwp`, `exportHwpx`, `exportHwpVerify` and `notifySaved`. `chrome=embed` keeps file ownership in the app.

The installed SDK's `transport.js` explicitly rejects non-HTTP(S) studio URLs and verifies its peer origin/session. A native local HTTP host is a concrete integration path. Loading the SDK's default public website would introduce network dependence and would not include this fork's pinned plugins. A custom-scheme transport change needs equivalent source/origin/session checks and independent testing.

Exporting directly is insufficient: preserve password/tracked-change refusal, export/reload verification, memo checks/locking, tab measurements and the existing master-page/memo/field/tab save fixes. Keep the app's approved engine patches intact.

### Sheets calculation path

Evidence: [desktop Univer setup](../apps/sheets/src/renderer/create-univer.ts), [desktop app](../apps/sheets/src/renderer/App.tsx), [Rust dependencies](../apps/sheets/native/xlsx-engine/Cargo.toml), [XLSX gateway](../packages/xlsx-gateway/src/gateway/xlsx-gateway.ts).

The desktop renderer already uses `UniverSheetsCorePreset` and the formula engine's `calculationEnd`, with conditional formatting, validation, filters, notes, sorting, tables and drawing presets. The native Rust sidecar owns workbook IO/streaming and additional calculation paths; it depends on IronCalc 0.9.1, calamine and ZIP tooling. A browser formula engine or matched IronCalc WASM can replace calculation execution, while original package patches preserve workbook fidelity. Formula calculation alone does not supply the full grid/ribbon/layout/data features below.

## Format checklist

Every unchecked row is required work or required verification; it is not implicitly excluded. The desktop evidence includes both user-facing help and the named implementation modules.

### DOCX and ODT

Evidence: [desktop feature guide](../apps/shell/src/renderer/src/i18n/help/topics/docs.en.md), [Docs architecture](../apps/docs/AGENTS.md).

- [ ] Full rich-text selection, formatting, CJK/Latin font slots, sizes, colors, emphasis, clear formatting and format painter.
- [ ] Paragraph alignment/indents/spacing; lists and custom bullet/number/multilevel definitions; styles pane and editable styles.
- [ ] True page layout: paper sizes, margins, orientation, sections, columns, pagination, rulers, page/section breaks and page previews.
- [ ] Navigation: outline restructuring/folding/levels, document find/replace with case/whole-word/regex, page thumbnails and Go To.
- [ ] Tables: insert, nested tables, row/column operations, merge/split, borders/fills, sorting/formulas, autofit/distribute, across-page behavior.
- [ ] Pictures: insert, replace, wrapping/anchoring, crop/compression, stacking; shapes, text boxes, WordArt and drop caps.
- [ ] Real editable charts and their workbook data; symbols, equations and structured document fields.
- [ ] Headers/footers, first/even variants, page numbers, bookmarks, hyperlinks and cross-references.
- [ ] References: TOC update, captions, footnotes/endnotes and index/reference fields.
- [ ] Review: comments, tracked changes/markup/accept/reject, comparison, word counts, proofing/spelling and protection.
- [ ] Ink pen/highlighter/eraser with save/reopen and whole-stroke erasure.
- [ ] Theme/color/font sets, watermark, page borders; print/web/outline/read modes; dark document surface independent of UI theme.
- [ ] Save and Save As DOCX/ODT with existing format-change reports and protected/unsupported feature handling.
- [ ] PDF, HTML, Markdown and paginated-image export; system print from the same page layout.
- [ ] AI reading/editing/rewrite/translation, document snapshots and undoable rollback; respect protected/hidden-from-AI ranges.
- [ ] Zotero integration has an iPad-compatible service path or a clearly identified PC-bridge dependency; no fake local service.

Current implementation: the rich Tiptap host and original desktop conversion replace the initial paragraph-only adapter. The complete desktop feature groups above remain open until their individual controls, preservation and layout acceptance are verified; protected complex original structures are not implicitly editable.

### XLSX, CSV and TSV

Evidence: [desktop feature guide](../apps/shell/src/renderer/src/i18n/help/topics/sheets.en.md), [Sheets architecture](../apps/sheets/AGENTS.md).

- [ ] Full visual grid, styled merged cells, row heights/column widths, hidden/grouped rows and sheets, frozen panes, selection/clipboard/fill and keyboard habits.
- [ ] Editable formula bar, function insertion/categories/AutoSum, cross-sheet dependencies, recalculation modes, errors, names, watch window and precedent/dependent tracing.
- [ ] Formula results and changed caches agree with an independent calculating application; unsupported formulas identified by cell/function.
- [ ] Number/date/time/currency/percent/fraction/scientific formats, alignment/wrap, fonts/fills/borders/styles and format painter.
- [ ] Conditional formatting, validation, checkboxes, sorting/filtering/advanced filters, data tables and visible validation controls.
- [ ] Structural edits: insert/delete/move sheets/rows/columns, merge/unmerge, references and dependent formulas shift correctly.
- [ ] Data workflows: text/CSV import, delimiter/fixed-width split, merge workbooks, quick fill, remove duplicates, consolidate, grouping/subtotals and Goal Seek.
- [ ] Pivots, refresh, PivotCharts, slicers/timelines with the same desktop distinction between persisted filtering and session-only controls.
- [ ] Editable charts/recommendations/sparklines, images/shapes/text boxes, comments/notes, headers/footers, symbols/equations and links.
- [ ] Protection/allow-edit ranges, workbook protection and refusal of unsupported password removal.
- [ ] Page layout, themes, print headings/gridlines, page-break view, PDF export and printing.
- [ ] CSV/TSV save in their original format rather than silently converting to XLSX.
- [ ] AI range edits/formulas, cell citations, attachments, privacy-column policy and rollback.

Current implementation: the desktop Univer host and preserving XLSX save adapter replace the initial bounded value grid. Matched IronCalc WASM provides formula work; this does not complete independent cache validation or every desktop data/drawing/print feature above.

### PPTX

Evidence: [desktop feature guide](../apps/shell/src/renderer/src/i18n/help/topics/slides.en.md), [Slides architecture](../apps/slides/AGENTS.md), [render engine](../packages/pptx-render/src/index.ts).

- [ ] WYSIWYG slide canvas with original masters/layouts/theme inheritance, real font metrics and correctly layered objects.
- [ ] Text editing/formatting; shapes/fills/strokes/shadows; images/crop/replace; tables/cell formatting; editable chart data.
- [ ] Touch/keyboard selection, drag/resize/rotate, alignment/distribution/guides, z-order, grouping/ungrouping and editable shape points.
- [ ] Slide insert/duplicate/delete/reorder/hide, sections, layout reset, source-formatting paste and cross-slide clipboard.
- [ ] Master/layout editing, themes/color schemes/fonts/backgrounds, default shapes and page size.
- [ ] Transitions, animations/motion paths, preview and persisted timing/transition metadata.
- [ ] Notes, per-slide/all-slide comments, links/jump buttons, ink and highlighter.
- [ ] Normal/outline/sorter/reading modes; slide show, presenter view, custom shows and show settings.
- [ ] PDF/image export, print, presenter output and the same fidelity on untouched objects.
- [ ] AI deck creation/editing, templates, image insertion/search, hidden-from-AI selection and rollback.

Current implementation: the visual workspace now reuses existing pure engine modules and render model, with touch transforms, object insertion/formatting, guarded slide operations, table cell edits and slideshow. Unsupported original objects remain preserved/read-only; the full desktop groups above remain open where they include unsupported editing or device acceptance.

### PDF and PDF tools

Evidence: [PDF feature guide](../apps/shell/src/renderer/src/i18n/help/topics/pdf.en.md), [tool guide](../apps/shell/src/renderer/src/i18n/help/topics/pdf-tools.en.md), [PDF architecture](../apps/pdf/AGENTS.md).

- [ ] Reading: thumbnails/outline/search, text selection/copy, page navigation/zoom, remembered views and annotation overview.
- [ ] Markup: highlights, underline/squiggle/strikeout, color changes/removal, ink/drawing tools, sticky notes, replies and comment threads.
- [ ] PDF text/image editing/insertion, forms/widgets/static fills, attachments, metadata and visual signatures.
- [ ] True permanent redaction, password handling and protection-preserving save; visual cover rectangles are insufficient.
- [ ] Page operations: reorder/add/delete/rotate/crop, watermark/header/footer and page-size/layout changes.
- [ ] Separate PDF tools: merge/split/extract/reverse, blank-page review, two-sided padding, merged pages, backgrounds, annotation stripping/flattening, images-to-PDF/text export, compression, add/remove password and repair.
- [ ] PDF/Word/PowerPoint/Excel/Markdown/EPUB conversion and image export, appropriate loss reports and system print.
- [ ] AI reading, document translation/plain-language modes, passage cards, citations/overview, accepted highlights, bilingual alignment and per-PDF notes.
- [ ] Durable cancellable/resumable job/result store and saved-result management.

Observed iPad code: native PDFKit viewing and selection highlights only. Desktop uses PDF.js, pdf-lib, PDFium WASM, qpdf WASM and font tooling. Native PDFKit can implement some operations, but neither its availability nor adding a highlight establishes editing/redaction/conversion parity. Desktop main-process handlers need explicit native/browser replacements.

### Markdown and plain text

Evidence: [Markdown guide](../apps/shell/src/renderer/src/i18n/help/topics/markdown.en.md), [source splice](../apps/markdown/src/renderer/markdown/sourceSplice.ts), [Markdown architecture](../apps/markdown/AGENTS.md).

- [ ] Tiptap block editing, headings/marks/lists/tasks/tables/code/equations/images and the full toolbar.
- [ ] Source/rendered toggles with the same document/history; source find/replace, raw HTML/footnote/reference preservation.
- [ ] BOM/CRLF/trailing-newline retention for text/JSON/source and minimal changed-block serialization for Markdown.
- [ ] Owned local image assets, copy/paste/drop, relative references and asset manifest lifecycle.
- [ ] Outline/backlinks, presentation view, themes and saved view preferences.
- [ ] DOCX/ODT/PDF/images export, convert-and-open-in-Docs, and integration with PDF notes.
- [ ] AI block edits, attachments, hidden-from-AI ranges, source projection and rollback.

Current iPad code includes a browser Tiptap/source Markdown editor and original text-envelope handling. The desktop asset/export/AI workflows above are not complete merely because the same block editor is present.

### HTML

Evidence: [HTML guide](../apps/shell/src/renderer/src/i18n/help/topics/html.en.md), [HTML architecture](../apps/html/AGENTS.md), [inspector](../apps/html/src/renderer/preview/inspector.js).

- [ ] Editable source and rendered preview with relative CSS/images, find/replace and byte-faithful source saves.
- [ ] Inspector selection/in-place text edits, floating formatting/style controls, insert/delete/duplicate/reorder elements and undo/redo via source-range patches.
- [ ] HTML slide rail, navigation/restored slide after reload, keyboard ownership while typing and presentation mode.
- [ ] Images: insert/replace/crop/background removal and local owned assets.
- [ ] Local MathLive visual/LaTeX equations, templates/virtual keyboard and original-source re-edit.
- [ ] Single-file HTML, DOCX/ODT/PDF export and actual hidden-window/browser rendering equivalents.
- [ ] AI whole-source/selection edits with stable element/range IDs and protected source projections.

Security boundary: author HTML is executable untrusted content. Its preview needs its own sandbox with no native message handlers. Preserve the desktop separation between privileged host and preview/export content.

### XMind mind maps

Evidence: [mind map architecture](../apps/mindmap/AGENTS.md), [MapController](../apps/mindmap/src/renderer/map/controller.ts), [document session](../apps/mindmap/src/renderer/document/session.ts), [conversion](../apps/mindmap/src/renderer/document/convert.ts).

- [ ] Real graphical mind-elixir map: topic add/edit/delete/reparent/reorder, folds, selection/navigation, layout and all sheets.
- [ ] Themes, rich topic text, fonts/colors/format painter, branch styles, relationships, summaries and boundaries.
- [ ] Notes, labels, markers, pictures, links and opt-in link preview; prevent document text/styles from becoming HTML/CSS injection.
- [ ] Sheet add/rename/delete and required confirmation when deleting preserved hidden content.
- [ ] Preserve unmodeled/floating/callout structures and unknown metadata with engine reconciliation; exact unchanged save.
- [ ] PNG/SVG/PDF/Markdown-outline export, thumbnails and print.
- [ ] AI reads/edits the live map through the same transactional controller and supports rollback.

### HWP/HWPX

Evidence: [HWP architecture](../apps/hwp/AGENTS.md), studio/save paths above.

- [ ] Local full studio renders paginated HWP/HWPX, with original tables/images/objects/fonts and touch/IME selection/editing.
- [ ] Character/paragraph/style formatting, page settings, lists/numbering, table/cell/row/column operations and resizing.
- [ ] Format copy, Hancom key behavior, Hanja conversion/local dictionary, quick correction and document statistics.
- [ ] Memo comments, form/click-here fields and checkboxes, footnotes/endnotes and TOC/page numbers.
- [ ] Same save protection/verification, known master-page/memo/field/tab repairs, format conversion and loss warnings.
- [ ] Print/page preview/PDF export and compatible font embedding/subsetting.
- [ ] Administrative-document checks and full AI plugin read/edit operations, attachments and transactional undo.

### EPUB

Evidence: [EPUB guide](../apps/shell/src/renderer/src/i18n/help/topics/epub.en.md), [core engine](../packages/epub-engine/src/core.ts), [desktop edit controller](../apps/epub/src/renderer/edit/controller.ts).

- [ ] Contents/chapter navigation, whole-book search, remembered reading position, view text/line spacing/dark preferences and safe local assets/fonts.
- [ ] Paginated reader preview with device sizes/orientation/two-page spread and text-position restoration.
- [ ] In-place paragraph/heading/list/table-cell/caption text editing; split/join/newline, bold/italic, whole-book replace, cross-chapter undo/redo.
- [ ] Source-range-only saves preserve original style/font/image/metadata bytes and correctly update EPUB modified time.
- [ ] DRM refusal, fixed-layout read-only behavior and malformed-chapter preservation remain the same.
- [ ] AI read/search/edit plus translation/plain-language/bilingual outputs, chapter selection, consent estimates and resumable result store.

Desktop limitations remain limitations: no chapter insert/reorder, empty-book creation, fixed-layout editing or DRM bypass is needed to match the existing desktop suite.

### draw.io diagrams

Evidence: [diagram guide](../apps/shell/src/renderer/src/i18n/help/topics/diagram.en.md), [offline vendor recipe](../vendor/drawio/README.md), [frame client](../apps/diagram/src/renderer/drawio/frame-client.ts), [draw.io start configuration](../apps/diagram/src/shared/drawio-start.ts).

- [ ] Bundle the pinned offline draw.io application and existing bridge; full diagram shapes/connectors/text/style/page editing and undo/redo.
- [ ] Open/save `.drawio`, `.dio`, `.drawio.svg`, `.drawio.png`; preserve embedded/compressed page forms and exact unchanged files.
- [ ] Import `.vsdx` as a new draw.io document with unsupported-image notices; never overwrite Visio source.
- [ ] PNG/SVG/PDF export all/current pages and printing in light document colors.
- [ ] Local palettes/scratchpad/preferences, locale/theme integration, guarded external links and blocked remote images/fonts.
- [ ] AI read/live ops/Mermaid via the same transactional bridge, whole-turn rollback and failure atomicity.

Desktop intentionally excludes PlantUML, ELK/libavoid routing, old Visio formats, VSDX output, collaboration/plugins/cloud publishing. Full parity does not require enabling those disabled vendor capabilities.

## Shell, AI and cloud checklist

Evidence: [shell architecture](../apps/shell/AGENTS.md), [home guide](../apps/shell/src/renderer/src/i18n/help/topics/home-screen.en.md), [tabs guide](../apps/shell/src/renderer/src/i18n/help/topics/tabs-and-windows.en.md), [AI guide](../apps/shell/src/renderer/src/i18n/help/topics/ai-models.en.md), [Drive](../packages/google-drive/src/index.ts), [provider selection](../packages/ai-provider/src/provider-selection.ts).

- [ ] Workspace: tabs/window/split workflow, recent/favorite groups, folder tree/search/index, templates/new-document kinds, document generation/conversion and provenance links.
- [ ] Per-format recovery, atomic writes, external-change conflicts, unsaved close/quit, crash restoration and reliable background saving.
- [ ] Global locale/theme/author/font settings, keyboard help, document proofing, accessibility and touch/keyboard behavior.
- [ ] Files/document-provider workflows: import, open-in-place where supported, export/share/print and chosen-folder scope rather than unrestricted PC paths.
- [ ] AI chat/edit panel in each editor, consistent tool selection, consent/cancel/streaming, attachments, model choice, privacy redaction and undoable turn snapshots.
- [ ] Free web/image search and guarded page/image reading with the same opt-in outbound rules, result handling and private-file limits.
- [ ] Key/local/custom endpoint providers only after deliberate user choice; native Keychain replaces Electron secret storage. No credential or paid request is authorized merely to test parity.
- [ ] App-owned ChatGPT direct OAuth requires an iOS redirect/browser-login and token-vault implementation. Existing Node loopback/credential files are not an iOS implementation.
- [ ] Google Drive OAuth/list/download/export/upload/conflicts and native cloud file providers; existing Drive OAuth uses Node crypto + loopback HTTP and Electron safeStorage.
- [ ] Projects/instructions/memory/chats/skills/templates under user-granted storage scope; preserve existing trust and hidden-file rules.
- [ ] Remote MCP tools/OAuth/capability confirmation and results sanitization; native HTTP/SSE service replaces Node transport.
- [x] Scope decision: the user explicitly excludes Claude/Codex execution and the project terminal from the iPad version. Do not add a PC execution bridge for those features, show login or execution controls for them, or silently substitute a paid provider.
- [ ] Local-process MCP and script-based skills require a separately supported iOS execution path; remote HTTP/SSE MCP remains in scope. Do not make the excluded project terminal an implicit prerequisite for document editing.
- [ ] Quick Look/shell file associations/system explorer hooks/update mechanisms mapped to actual iOS equivalents. Windows registry/Explorer hooks, desktop installer and arbitrary PATH registration cannot be copied onto iOS.

## Acceptance gates

- [ ] Each format has representative fixture open/edit/save/reopen tests, unchanged-byte checks and untouched-entry comparisons, including complex objects and non-Latin fonts.
- [ ] Formula fixtures cover cross-sheet dependencies, persisted caches, errors and unsupported functions; independent engine comparison checks actual numeric results.
- [ ] Layout fixtures compare original desktop and iPad pages/slides/grids using the same fonts, and validate PDF/image/print output.
- [ ] Test Korean IME composition, selection handles, on-screen keyboard resize, Pencil/touch gestures and external keyboard shortcuts on iPadOS.
- [ ] Test offline startup, local WASM/worker/font/image loading and zero unexpected remote requests.
- [ ] Test navigation during pending save, background suspension, write failures, recovery, reload and process termination.
- [ ] Test encrypted/signed/unsupported archives, XML depth/size/inflation limits and untrusted HTML/EPUB/diagram payloads across the native bridge.
- [ ] macOS CI builds and runs Simulator tests; physical iPad acceptance records remain separate from Linux browser tests.

Passing preservation, browser and native unit tests remain distinct from complete desktop feature coverage and physical iPad acceptance. No unchecked feature is declared complete by engine reuse alone.
