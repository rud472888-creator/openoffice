# iPad spreadsheet desktop host

The default build embeds the existing `apps/sheets/src/renderer/App.tsx`, ExcelShell ribbons, Univer presets, desktop editing journal, dialogs and renderer corrections. The iPad layer supplies browser implementations of the desktop document API. The earlier paged value editor remains a development fallback (`SHEETS_DESKTOP=0`); it is not the shipped default.

```sh
npm run typecheck --prefix apps/ipad-sheets
npm run test --prefix apps/ipad-sheets
npm run build --prefix apps/ipad-sheets
npm run test:browser --prefix apps/ipad-sheets
```

The build emits self-contained IIFE JavaScript/CSS/fonts/WASM in `apps/ipad/EveryOffice/Resources/SpreadsheetEditor/index.html`, plus a valid `Resources/Templates/Blank.xlsx`. There are no runtime network requests or paid calculation services. A build-time parser checks the actual emitted inline JavaScript. The desktop dependency graph makes this bundle substantially larger than the earlier value editor.

## Reused desktop behavior

The real desktop grid and Home, Insert, Page Layout, Formulas, Data, Review and View ribbons run in the browser. Editing, selection, formulas, formatting, sheet operations, dialogs, clipboard handling, sorting/filtering, validation, conditional formatting, tables, chart/shape creation, notes, names, outlines and print layout use their existing renderer implementations.

`desktop-save.ts` follows the desktop sheet-name/operation mapping and calls the unchanged shared XLSX gateway planner and in-memory assembler. It supports the same journal payload for cells/styles/rich text, structural edits, sheet management, filters, hyperlinks, CF/DV, protection, names, visuals, tables, pivots, sparklines, themes and print settings. Unrelated archive parts stay present. Filesystem helper imports are replaced only in this browser build; those helpers throw if invoked. Desktop engines and their identifiers are unchanged.

`desktop-metadata.ts` reads original worksheet/styles/theme XML into the existing desktop contracts, including raw cached values, rich runs, merges, row/column layout, freeze state, hyperlinks, CF/DV, legacy notes, tables, pivots and print settings. `desktop-drawings.ts` reads ordinary image/chart/preset-shape anchors and chart caches. Queries and pivot definitions reuse shared gateway parsers.

## Formula calculation

The existing Univer engine remains the primary interactive engine. The browser fallback and final save-cache audit use upstream `@ironcalc/wasm-xlsx` **0.9.1**, the same IronCalc version as the desktop sidecar. Its importer, dependency graph, multisheet references, defined names and evaluator are reused; this adapter does not implement approximate spreadsheet arithmetic.

Formula XML is never converted into a literal value. The save audit patches typed numeric, text, Boolean and error caches while retaining original formula text, styles and extension data. Edited workbooks request full recalculation on the next calculating application open. Unknown functions are identified by cell/function name from the pinned 497-function registry. The four FORECAST.ETS variants are explicitly unavailable in this engine. Conditional engine gaps, external workbook references, the 1904 date system, and array/spill cache auditing are reported rather than represented as successfully recalculated. Existing formula/cached content remains available when an audit cannot safely run. Interactive dynamic-array behavior still follows the reused desktop Univer implementation.

## Native and lifecycle contract

After `ready`, call `window.everyOffice.openDocument({name,base64,kind:'xlsx',locale})`. `opened` is sent after the desktop initial range loads. Call `saveDocument()` for native persistence.

`changed` carries a monotonically increasing UI `revision`, `dirty:true`, and `draft`. Mark drafts dirty immediately and retain their WKWebView; defer automatic saving while `draft:true`. Explicit save commits the active cell through the desktop editor API. Invalid drafts emit `error` and remain retained. Runtime mutations also mark changes, including repeated formatting/cell changes whose journal cell count stays constant.

The optional desktop lifecycle hooks bracket the **entire** save operation. Sheet/structural changes followed by a second table/pivot phase produce only one final native `save` message, after all phases complete. The message includes `{name,kind,base64,revision}` with the transaction's starting revision, so newer edits remain dirty. A rejected save reports `error` and does not report success. Save snapshots and original bytes remain separate.

PDF/print uses the desktop's paginated HTML through `{type:'exportPDF'|'printPages',requestId,name,pages:[{html,width,height}]}`. CSV exports use `{type:'exportFile',requestId,name,base64,mimeType}`. The native host acknowledges actual share/print completion via `everyOffice.didExport(requestId,{completed,error?})`; cancellation does not claim success. Print resources must be embedded, pages fixed-size, and active content is rejected.

Claude/Codex process execution and the project terminal are unavailable on iPad. Their backend methods cannot execute programs. Unsupported desktop platform services reject with their method name; no successful placeholder response is returned.

## Current parity limits

Full desktop parity is not yet established. CSV/TSV use the shared desktop decoder/parser and open as spreadsheets. XLS/ODS use a bounded Calamine 0.37 WASM adapter for values, formulas, dates and XLS merges. Saving these imports creates an independent XLSX library copy through acknowledged `importCopy` with `conversionSave:true` and an exact revision; original files are never overwritten. ODF-specific formulas that cannot safely translate are rejected explicitly.

Current gaps include advanced legacy import formatting/drawings, library/file picker integration inside the renderer, grouped/freeform drawing geometry, some extension CF/DV metadata, modern threaded-comment metadata, specialized chart/pivot/theme details and native screenshot/spelling services. Unsupported extension CF/DV sections are protected from destructive rewrites. Existing parts remain preserved, and unsupported host services fail explicitly. Further browser/Simulator checks are required for individual dialogs and advanced features.

Input limits remain 32 MiB compressed, 4,000 ZIP entries, 16 MiB per expanded part and 64 MiB total expanded data. The shared ZIP gate performs metered inflation before JSZip. XML limits are 12 MiB per part, 300,000 elements and 128 levels. Encryption, ZIP64, unsupported compression, duplicate/normalized entry paths, external entities and signed packages are rejected. Values reject invalid XML controls, lone surrogates and oversized strings transactionally.

Tests cover exact unchanged saves, preserved formulas/styles/opaque ZIP parts, Unicode and OOXML escaping, malformed archives, failed-edit rollback, revision snapshots, undo, same-engine formula calculations, desktop metadata, gateway formatting/sheet/layout saves, and the optional host lifecycle (including multi-phase save completion). The browser smoke checks the actual desktop grid, Korean edits, formula XML/caches, save/reopen and tablet/narrow layout. Chromium evidence does not establish WKWebView, iPad Simulator, signing or physical-device behavior.

## Vendored engine provenance

`vendor/ironcalc-xlsx` is the unmodified public npm `@ironcalc/wasm-xlsx@0.9.1` distribution. Tarball integrity: `sha512-daihrrjAGGv55bgv+yqHmiyn1URmWaxZ6CFWmqbNUJpl5SYgbwO0HmX8vbG4+8OeAA7aTCNqXNmgFF9eFqsj5A==`; upstream Git revision `eb9ca75bd99160c17902359d2d87225c4571c468`. Its MIT/Apache licenses and complete third-party notices are retained. `function-registry.json` is derived from that revision's English language data and registered function lookup, for exact diagnostics.

Legacy importer rebuild instructions, exact binary/source hashes and complete locked Rust dependency license texts are in `vendor/legacy-import/{README.md,provenance.json,THIRD-PARTY-NOTICES.txt}`. `npm run build:legacy` performs its Rust tests, WASM build and license/provenance regeneration.
