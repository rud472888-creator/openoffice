# iPad DOCX editor

This browser UI runs inside the iPad app's WKWebView. It uses the existing `@genoffice/docx-engine` without changing that engine. It edits actual `.docx` archives locally; no server, external script, font, or network request is needed.

From the repository root, after `npm ci`:

```sh
npm run build --prefix apps/ipad-web
npm run test --prefix apps/ipad-web
npm run typecheck --prefix apps/ipad-web
```

The build writes the standalone, inline-script HTML file to `apps/ipad/EveryOffice/Resources/DocumentEditor/index.html`. Rebuild it after source changes; the generated resource ships in the native app. The same build also generates `apps/ipad/EveryOffice/Resources/Templates/Blank.docx` using the existing engine’s `buildBlankDocx` API. The native New document action copies this template into the document library. The intermediate `dist` directory is ignored.

## Native bridge

Register `WKScriptMessageHandler` as `everyOffice`, load the bundled `index.html`, and wait for `{type: 'ready'}`. Then call:

```js
await window.everyOffice.openDocument({
  name: 'Notes.docx',
  base64: 'UEs…',
  kind: 'docx',
  language: 'ko', // Optional; otherwise navigator.language. All 21 app languages supported.
})
await window.everyOffice.saveDocument()
```

Both calls resolve to a boolean and report errors using the native message handler. Successful opening posts `{type: 'opened', name, revision: 0, readOnly}`. Each user edit posts `{type: 'changed', dirty: true, revision}`. Saving posts `{type: 'save', name, base64, revision}` using the revision captured at the start of serialization. The native host owns writing the bytes to the original security-scoped document URL and must serialize saves and compare revisions before clearing its unsaved indicator. Native write failure must leave the document open and retryable. Do not navigate away until the final save has reached the file.

Errors post `{type: 'error', message, revision}` with a localized message. Documents above 32 MiB are rejected before base64 decoding or parsing. Before the engine parses, the mobile archive gate also enforces 5,000 entries, 16 MiB per expanded entry and 128 MiB expanded total. Changed output must pass the same compressed-size and expanded-archive budgets before it is sent to the native host; a rejected save retains the draft for correction. Duplicate or aliased archive paths are rejected rather than normalized during saving. The engine applies its existing archive safety checks as well.

## Editing scope and fidelity

The screen is a text editing view, not a paginated layout renderer. Original document formatting and layout stay in the `.docx`; the view uses a readable tablet layout. Ordinary existing paragraphs and table-cell paragraphs are editable, and the Add paragraph button appends a new plain paragraph. Existing paragraph text cannot contain newly inserted tabs or line breaks; use Add paragraph instead.

Existing text edits use the engine's surgical `patchParagraphTexts` utility, then pass the resulting complete XML fragment to `saveDocx` with its original `docxIndex`. Unedited blocks use the engine's `original` save mode. Rich run properties outside the changed text and the complete surrounding XML remain intact. New text inherits the run at the change location; this UI does not offer rich formatting changes. Originally empty paragraphs receive a text run without rebuilding paragraph properties. New appended paragraphs use the engine's generated-block API. The engine retains the hidden trailing section itself; it must not be passed again as a visible save block.

Fields (including results spanning paragraphs), hyperlinks, drawings, revisions, controls, math, inline breaks, tabs, and opaque XML content remain read-only. A placeholder marks preserved blocks that have no text preview. Digitally signed documents are read-only so edits cannot invalidate their signatures. Documents with enforced editing protection, a password-to-modify hash, or Track Changes enabled are entirely read-only. Headers, footers, notes, charts, images, metadata and unsupported parts remain in the archive but cannot be edited in this UI. An unchanged save returns the original bytes exactly. Changed saves follow the engine's existing fidelity rules, including its documented resource cleanup and personal-information removal behavior.

Document names and text are assigned only through DOM `textContent` or textarea `value`; document HTML is never executed. The final HTML has a restrictive content-security policy with network connections disabled.

Tests cover fixture byte identity, edited-file reopen, unrelated ZIP-entry and paragraph preservation, rich run properties, repeated table-cell text, blank documents, new paragraphs, hidden sections, cross-paragraph fields, protection, invalid input, base64, size rejection and all 21 language dictionaries.
