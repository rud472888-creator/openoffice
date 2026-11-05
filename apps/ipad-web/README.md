# iPad document renderer

This WKWebView frontend reuses the desktop document editor's actual TipTap schema, extensions, DOCX-to-editor conversion, save planner, document CSS, fallback fonts, rich header/footer subeditor, review commands and pagination preview. The host is adapted for touch and the native iPad file bridge. It does not mount the desktop `App.tsx` or fabricate its Electron API.

```sh
npm run build --prefix apps/ipad-web
npm run test --prefix apps/ipad-web
npm run typecheck --prefix apps/ipad-web
```

The build creates `apps/ipad/EveryOffice/Resources/DocumentEditor/index.html` and the reproducible `Resources/Templates/Blank.docx`. Scripts, CSS, and 36 distinct existing fallback font assets are bundled into the HTML; repeated font aliases share Blob URLs. Document-embedded fonts are adopted using the existing desktop font helper. No network connection is used. Rebuild after source changes. Intermediate `dist` files are ignored.

## Native bridge

Register `WKScriptMessageHandler` as `everyOffice`, load the bundled page, wait for `{type:'ready'}`, then call:

```js
await window.everyOffice.openDocument({
  name: 'Notes.docx',
  base64: 'UEs…',
  kind: 'docx', // Also 'odt' and 'doc'.
  language: 'ko', // Optional; otherwise navigator.language. All 21 app languages.
})
await window.everyOffice.saveDocument()
```

The methods resolve to booleans. Opening sends `{type:'opened',name,revision:0,readOnly}`. User edits send `{type:'changed',dirty:true,revision}`. Saving sends `{type:'save',name,base64,revision}` using the revision captured before serialization. Stale replies after another open starts are discarded. The native host writes these bytes to the security-scoped document URL, serializes saves, and clears its dirty indicator only for the current revision. A native write failure must leave the editor open and retryable. Errors send `{type:'error',message,revision}`.

The document DOM uses `.ipad-rich-page`, `contenteditable`, `role="textbox"`, `aria-multiline="true"`, `data-testid="document-editor"`, and the filename as its accessible label.

For `.doc`, the existing `doc2docx` converter produces a read-only preview. A Save As .docx button sends `{type:'importCopy',name,base64,kind:'docx'}`. Native creates and opens an independent library document. Normal save refuses legacy DOC, so DOCX bytes cannot overwrite a `.doc` file. Converter warnings are visible with the preview. The converter remains unchanged; a browser-only alias provides its single Node dependency, bounded zlib inflation for compressed metafiles, through the already used pako library.

For `.odt`, the existing ODT engine converts to an internal DOCX bridge. Saving calls `saveOdt` against the original ODT bytes and bridge map, returning real ODT. The existing ODT session, protected-cell guard and feature restrictions are used. New comments, tracked changes and their review buttons are disabled for ODT, matching the desktop format gate. Encrypted ODT is refused. Signed ODT and DOCX are read-only.

Preview/print use the actual desktop `PaginationPreview`. Export sends `{type:'exportPDF'|'printPages',requestId,name,pages:[{html,width,height}]}`. Width and height are PDF points. Snapshots contain resolved styles and local data images/fonts; the native renderer disables JavaScript and network access. Native completes the request with `window.everyOffice.didExport(requestId,{completed,error?})`. Requests are bounded to 250 pages, 20 MiB per page and 64 MiB total. The generic page capture utility is `src/print-snapshot.ts`.

## Implemented document controls

- Rich text, paragraph splitting, undo/redo, bold/italic/underline/strike, font family/size/color, clear marks, headings, original paragraph styles, alignment and existing numbering definitions.
- Editable tables, configurable insertion dimensions, row/column insertion and deletion, merge/split cells, and ordinary table-cell rich text.
- Body image insertion using the desktop image model, with packaged DOCX media; original complex images/shapes remain protected.
- Margins, paper dimensions and orientation, applied to all or selected existing sections using the desktop section rewrite helper.
- Safe new hyperlink insertion; existing links use the desktop mark/save representation. Link activation in the editor cannot navigate the WKWebView.
- DOCX tracked changes, accepting/rejecting one or all revisions, anchored comments, editing/deleting/resolving/reopening comments, and rich default header/footer editing per section. Header/footer changes apply as typed so native save/navigation sees the current draft.
- Desktop page preview, native PDF/print handoff, existing headers/footer variants and original notes in preview.

## Preservation and current gaps

Untouched DOCX saves return original bytes. Changed saves use the desktop `pmDocToSavePlan` and existing `saveDocx` engine: untouched blocks use `original`; edited blocks use the same generated/XML/image paths as desktop. Existing engine resource cleanup, personal-information removal and metadata revision behavior remain intact. Unchanged ODT returns original bytes; changed ODT uses narrow original-package write-back. No document engine source or identifier is changed.

Original fields, complex drawing blocks, content controls, math and opaque XML are visibly protected. A transaction guard also prevents deleting or modifying those protected originals. Existing ordinary tracked revisions can be reviewed through the shared desktop commands. Enforced editing restrictions, password-to-modify hashes and digital signatures keep the entire document read-only. Protected ODT cells also use the desktop ODT guard.

This frontend is a growing port, not full desktop feature parity. The desktop App's complete dialogs and controller state have not all been connected. Pending work includes formula/chart/shape/textbox insertion and dedicated editing, new footnote/endnote management, TOC/citation/bibliography and mail merge, full style/theme design controls, watermark/ink tools, document comparison, passwords, spelling dictionaries, clipboard images/foreign rich HTML paste, and every section/header variant control. The current header/footer dialog edits default variants; existing first/even variants remain in the file and preview. Image insertion inside tables and nested table insertion are not exposed. Lists without the supported built-in numbering IDs remain editable but their insertion controls may be disabled.

The desktop pagination preview is reused, but the complete App's continuous canvas column/vertical-layout controller and note-height DOM measurement have not all been moved. Complex mixed-column/vertical layouts and note-heavy page boundaries still need iPad parity verification. PDF/print is generated from the preview that the user can inspect; 96-dpi document pages are scaled to 72-point native paper explicitly. Swift/iOS rendering must be checked on Simulator/device; Chromium checks do not prove WebKit pagination identity.

RTF has no existing editable browser adapter in this implementation. Legacy DOC conversion retains the existing converter's documented compatibility limits and warnings. Claude, Codex and terminal features are not part of this renderer.

Input is limited to 32 MiB compressed, 5,000 ZIP entries, 16 MiB per expanded entry and 128 MiB expanded total before parsing. Duplicate/aliased paths are rejected. Changed output passes the same reopen budgets before native writing, and a rejected save retains the draft. XML-invalid input is rejected. Names/text enter DOM as text or via the existing schema renderer; foreign pasted HTML is replaced by plain paragraphs, remote links cannot navigate, and CSP forbids network connections.

Tests cover original fixture identity, rich formatting and table/image roundtrips, unrelated original-part preservation, section rewriting, headers/footer, comment/link/revision save behavior, ODT identity and narrow write-back/protected cells, legacy DOC conversion equality, bounded browser inflation, archive limits, invalid Unicode and all 21 language dictionaries.
