# iPad spreadsheet editor

Offline, touch-accessible XLSX value editing for the native iPad host. This separate adapter does not change the desktop spreadsheet engine or its Rust calculation service. All dependencies are already installed in the repository; no server or network access is used by the bundled editor.

From the repository root:

```sh
npm run typecheck --prefix apps/ipad-sheets
npm run test --prefix apps/ipad-sheets
npm run build --prefix apps/ipad-sheets
```

Build produces a self-contained IIFE HTML bundle at `apps/ipad/EveryOffice/Resources/SpreadsheetEditor/index.html`, with CSS and JavaScript inlined for WKWebView file loading, and a valid empty workbook at `apps/ipad/EveryOffice/Resources/Templates/Blank.xlsx`.

## Native bridge

Listen for `window.webkit.messageHandlers.everyOffice` messages. After `{type:'ready',kind:'xlsx'}`, call:

```js
await window.everyOffice.openDocument({
  name: 'Budget.xlsx',
  base64: '...',
  kind: 'xlsx',
  locale: 'en',
})
await window.everyOffice.saveDocument()
```

`opened` confirms the workbook loaded. `changed` contains `dirty:true`, a monotonic UI `revision`, and `draft`. `draft:true` immediately tells the host about uncommitted input, including focused text that has not blurred. Mark the document dirty immediately; defer autosaving until a committed `draft:false` change, or explicit save/navigation/background. An explicit save commits the current draft. Invalid drafts emit `error` and must remain retained for correction. `save` contains `name`, `kind`, `base64`, and the saved UI `revision`. Never clear newer dirty changes when an older save arrives. Saves are posted in request order and each archive is a snapshot. Reopening a document resets revisions. The host must retain unsaved editors until the save succeeds.

## Editing and preservation

- Select a sheet and cell; choose Text, Number, or Boolean, edit, and Apply. Text preserves leading zeros and literal `=`. Boolean values use TRUE/FALSE. Clearing a value keeps the original cell style and unrelated extension data.
- Navigate with touch, keyboard arrows, row/column paging, or any valid address through XFD1048576. Buttons and cells have at least 44 CSS pixel touch targets. UI strings cover the existing 21 locales.
- This grid displays raw values. It does not render Excel number formats, styling, charts, images, merged visual layout, filters, conditional formatting, or validation UI. Original parts remain in the file. Date values appear as their stored serial numbers or strings.
- Formula cells show cached results and are read-only. No formulas are calculated on iPad; editing precedent values leaves caches stale. A permanent notice explains this. Edited saves request full calculation on next open in a calculating spreadsheet application. Original formula XML, caches and calculation chains remain preserved.
- Rich text cells, cells carrying metadata, protected sheets, merged follower cells, and array/shared formula ranges are read-only. Rich text run formatting is never flattened by an edit.
- Saving without changes returns the exact original bytes. Edited saves retain every ZIP entry and only change edited worksheet XML plus the workbook calculation flags. ZIP compression bytes and metadata may differ. The existing XML is patched by source spans rather than rebuilt through an object serializer. Styles, relationships, drawings, custom XML and unknown parts retain their uncompressed bytes.
- Undo retains up to 20 edits within a 20 MiB XML history budget. Sheet creation/deletion/renaming, formatting, formulas, structural row/column edits, charts and macros are not editing features in this adapter.

## Bounds and verification

Input is capped at 32 MiB; the shared bounded-inflation ZIP gate caps entries at 4,000, each expanded part at 16 MiB, total expanded data at 64 MiB. XML parsing is capped at 12 MiB per part, 300,000 elements and 128 nesting levels. Encryption, ZIP64, unsupported compression, duplicate/normalized entry names, external DTD/entities and digitally signed packages are rejected. Invalid numeric values, lone surrogates, forbidden XML characters and values over 32,767 UTF-16 units are rejected transactionally.

Tests exercise byte-identical unchanged saves; blank creation; styles, extensions, formulas and opaque ZIP entries after edits; row and cell insertion; XML/OOXML escaping and multilingual text; read-only cases; undo; revision snapshots; failed-edit rollback; and malformed/encrypted/forged-size archives. The browser bundle still needs Xcode/iPad Simulator and physical-device validation; a Linux browser test cannot establish WKWebView or Apple signing behavior.
