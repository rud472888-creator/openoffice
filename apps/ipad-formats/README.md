# iPad additional-format editors

Offline HTML, XMind, EPUB and draw.io editing hosted by the iPad app's local HTTP server. No original document engine or vendor source is changed.

- HTML uses the desktop text envelope and source-range parser, a script-free sandbox preview, surgical leaf-text edits, insertion and undo/redo. External/relative sibling assets are unavailable when importing a single file. The full desktop HTML inspector, equations, image tools, slide rail and AI are not implemented.
- XMind uses the actual desktop MapController and DocumentSession, with topic editing, rich emphasis, notes, pictures, relationships, summaries, boundaries, folds, layouts, themes and sheet add/rename. Unsupported original content stays with the preserving engine. Sheet deletion, comprehensive font/branch styling, link previews and AI are not exposed.
- EPUB uses the actual desktop EpubEditController and browser-safe engine core: chapter navigation, whole-book rendered-text search, in-place block editing, bold/italic, split/join/history and original-range-only save. Replace all uses the desktop controller’s cross-chapter history, with read-only skip/error counts and one undo/redo entry. Reader font scale, line spacing and dark view stay outside book bytes; the native host persists global preferences and per-library-document chapter/top-block position. Local CSS/images/fonts load from bounded archive data. Fixed-layout chapters stay read-only. Device preview controls and AI/translation are not implemented.
- draw.io uses the full pinned offline vendor application and existing desktop bridge. Both source window and exact loopback origin are checked. `.drawio`, `.dio`, `.drawio.svg` and `.drawio.png` open/save through the original desktop extraction rules. Unchanged files retain their original bytes; edited files use draw.io’s matching XML, embedded SVG or embedded PNG serialization. Compressed embedded/page XML is bounded before loading the vendor editor. VSDX import and native AI integration are not implemented. Remote resources and external navigation are blocked; local iframe storage is not a durable app preferences contract.

PDF/print controls send inert, data-asset-only pages to the native renderer in PDF points. HTML and EPUB reuse the desktop EPUB column pagination; fixed-layout EPUB is fitted to a page. XMind reuses desktop map snapshot functions for SVG/PNG/PDF/print and Markdown outline export. draw.io reuses desktop page SVG/PNG rendering; PDF/print includes all pages, SVG/PNG exports the current page. Native request IDs resolve only after the native share/save/print flow completes. Cancellation is not announced as success. Actual iPad PDF rendering and share destinations require Simulator/device acceptance.

Input archives are bounded to 32 MiB compressed, 5,000 entries, 16 MiB per entry and 128 MiB inflated. Text edits are bounded and reject invalid XML characters. Native print pages are capped at 250, 20 MiB per page and 64 MiB total. Oversized exports fail without modifying the document.

From the repository root:

```sh
npm run typecheck --prefix apps/ipad-formats
npm run test --prefix apps/ipad-formats
npm run build --prefix apps/ipad-formats
npm run test:browser --prefix apps/ipad-formats
```

The `prebuild` step prepares `apps/diagram/out/drawio` through the existing pinned `vendor/drawio/prepare.mjs` recipe. A fresh checkout downloads the public release once, verifies its SHA-256 and the approved cut hashes, and caches it; subsequent builds reuse the verified cache. It copies vendor bytes without edits, then injects CSP and the existing bridge into the serving index. It writes `Resources/FormatsEditor` and four native blank templates. Browser smoke needs Chromium (`CHROMIUM_PATH` overrides `/usr/bin/chromium`); it exercises actual tablet UI edits/saves, multi-page geometry, all export payload types, EPUB cross-chapter search/replace/undo/redo and preference-state messages, embedded diagram unchanged/edit/save/reopen, and zero external requests. Native sharing is acknowledged by a test stub, not an iOS runtime.
