# iPad additional-format editors

Offline HTML, XMind, EPUB and draw.io editing hosted by the iPad app's local HTTP server. No original document engine or vendor source is changed.

- HTML uses the desktop text envelope and source-range parser, a script-free sandbox preview, surgical leaf-text edits, insertion and undo/redo. External/relative sibling assets are unavailable when importing a single file. The full desktop HTML inspector, equations, image tools, slide rail and AI are not implemented.
- XMind uses the actual desktop MapController and DocumentSession, with topic editing, rich emphasis, notes, pictures, relationships, summaries, boundaries, folds, layouts, themes and sheet add/rename. Unsupported original content stays with the preserving engine. Sheet deletion, comprehensive font/branch styling, link previews and AI are not exposed.
- EPUB uses the actual desktop EpubEditController and browser-safe engine core: chapter navigation, in-place block editing, bold/italic, split/join/history and original-range-only save. Local CSS/images/fonts load from bounded archive data. Fixed-layout chapters stay read-only. Whole-book search/replace, persistent reader settings, device preview controls and AI/translation are not implemented.
- draw.io uses the full pinned offline vendor application and existing desktop bridge. Both source window and exact loopback origin are checked. `.drawio` and `.dio` open/save, unchanged files retain their original bytes and edited files use draw.io XML serialization. Embedded SVG/PNG document opening, VSDX import and native AI integration are not implemented. Remote resources and external navigation are blocked; local iframe storage is not a durable app preferences contract.

PDF/print controls send inert, data-asset-only pages to the native renderer in PDF points. HTML and EPUB reuse the desktop EPUB column pagination; fixed-layout EPUB is fitted to a page. XMind reuses desktop map snapshot functions for SVG/PNG/PDF/print and Markdown outline export. draw.io reuses desktop page SVG/PNG rendering; PDF/print includes all pages, SVG/PNG exports the current page. Native request IDs resolve only after the native share/save/print flow completes. Cancellation is not announced as success. Actual iPad PDF rendering and share destinations require Simulator/device acceptance.

Input archives are bounded to 32 MiB compressed, 5,000 entries, 16 MiB per entry and 128 MiB inflated. Text edits are bounded and reject invalid XML characters. Native print pages are capped at 250, 20 MiB per page and 64 MiB total. Oversized exports fail without modifying the document.

From the repository root:

```sh
npm run typecheck --prefix apps/ipad-formats
npm run test --prefix apps/ipad-formats
npm run build --prefix apps/ipad-formats
npm run test:browser --prefix apps/ipad-formats
```

The build expects the verified `apps/diagram/out/drawio` vendor bundle prepared through `vendor/drawio/prepare.mjs`. It copies vendor bytes without edits, then injects CSP and the existing bridge into the serving index. It writes `Resources/FormatsEditor` and four native blank templates. Browser smoke needs Chromium (`CHROMIUM_PATH` overrides `/usr/bin/chromium`); it exercises actual tablet UI edits/saves, multi-page geometry, all export payload types and zero external requests. Native sharing is acknowledged by a test stub, not an iOS runtime.
