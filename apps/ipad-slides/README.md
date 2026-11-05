# iPad presentation editor

Offline WKWebView frontend for the native Every Office iPad app. The visual canvas uses the desktop PPTX parser, theme/placeholder inheritance, and `pptx-render` RenderTree through a touch-enabled SVG adapter. Select objects on the slide or in the selection control, then move, resize, rotate, flip, arrange, or edit their geometry. The inspector supports font family, size, bold, italic, underline, color, alignment, shape fill, outline, and individual text runs. Vector text/rectangle/ellipse, local image, and 3×3 table insertion are available. Table text and actual row/column dimensions remain editable. Slides can be added, duplicated, deleted, and reordered, with undo/redo for package edits.

The desktop engine root entry point is Node-only; its pure parser, theme, placeholder, scanner, and XML patch modules are imported directly without changing desktop code. The app reuses the browser-safe ZIP gate and JSZip. Edits replace only affected XML fragments or explicit package relationships; untouched ZIP parts and shape fragments remain intact. An unchanged save returns the original file bytes. Text, images, tables, and vector objects stay editable OOXML when saved; the deck is never flattened into slide images.

The Review panel supports speaker notes, classic comments (add/edit/delete), assignment of existing layouts/masters, transitions, and animation append/duration/trigger/removal using the actual desktop helper modules. A scoped build adapter replaces the XML helpers' package-path import and UTF-8 `Buffer.from` write; it changes no engine files and installs no Node globals. Notes drafts flush before native save/export. Bar/line/pie chart insertion uses the desktop chart writer and embedded workbook generator. Data edits are allowed only for proven unextended desktop-generated chart/workbook parts; edits clone the parts to keep shared originals untouched.

The visual preview uses heuristic font metrics and available system fonts. Some effects, image adjustments, and complex content differ visually. Foreign/custom chart data and workbooks, modern threaded comments, SmartArt content, equations, OLE/media content, master/layout object editing, and arbitrary paragraph/run restructuring remain unsupported. Animation edits that would overwrite unmodeled timing are blocked; slide-show animation playback is not implemented. Unsupported object content, fields, alternate content, and protected/signed decks remain read only and preserved. Namespace aliases unsupported by the desktop semantic parser are read only for visual changes. Deletion that would leave animation/connector/slide-jump references dangling is blocked. Sectioned decks, custom slide shows, and slides with owned notes/comments have conservative restrictions on structural changes or duplication. Original unused parts are retained rather than performing resource cleanup.

Slide-show navigation renders the current deck without playback of stored animations. PDF export and print produce standalone vector SVG pages for the native app, with embedded image data and original slide dimensions in PDF points.

Build from the repository root using the installed dependencies:

```sh
npm run test --prefix apps/ipad-slides
npm run typecheck --prefix apps/ipad-slides
npm run build --prefix apps/ipad-slides
npm run test:browser --prefix apps/ipad-slides
```

The build writes a self-contained `apps/ipad/EveryOffice/Resources/PresentationEditor/index.html` and `Resources/Templates/Blank.pptx`. The template reuses the existing engine's master/layout/theme and adds editable Title and Subtitle text boxes. No network access is used. The frontend has all 21 repository locales, token-based colors, and controls at least 44 CSS pixels high.

The bridge exposes `window.everyOffice.openDocument({name, base64, kind: 'pptx', language?})`, `saveDocument()`, `exportPDF()`, and `printPages()`. It posts `ready`, `opened` after rendered load, `changed` with monotonically increasing `revision`, `save` with `base64`, `name`, `kind`, and the serialized snapshot's `revision`, or a localized `error` with `message` to `window.webkit.messageHandlers.everyOffice`. Export/print post `{type: 'exportPDF' | 'printPages', name, pages: [{svg, width, height}]}`. The native document owns file persistence and should clear its changed flag only when the saved revision still matches the current revision. A frontend `save` event means the bytes are prepared, not that the native write succeeded.

The browser smoke uses local Chromium with touch input at tablet and narrow widths. It verifies actual drag/resize/rotate, text/font/vector changes, slide insertion, save/reopen, notes, comments, chart data, animation writing, slide-show navigation, and SVG export/print messages, while checking for browser errors and external requests. Linux browser proof does not substitute for iPad hardware or WebKit validation. Repository XSDs have also validated the browser-produced PPTX, including charts, notes, comments, and timing.

Mobile limits are 32 MiB compressed input/output, 5,000 archive entries, 16 MiB per inflated part, 128 MiB inflated total, 8 MiB slide XML, 1,000 slides, 2,000 text runs per slide, 20,000 runs per document, and 100,000 characters per run. XML depth, node, attribute, and namespace budgets also apply. Encrypted archives, duplicate ZIP entries, malformed XML, unsafe normalized paths, and forged ZIP size declarations are rejected before editing.
