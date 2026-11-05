# iPad presentation text editor

Offline WKWebView frontend for the native Every Office iPad app. This is an explicitly labeled text editing view with a slide outline and individual text-run controls. It does not render slide layouts or edit shapes, images, paragraph structure, charts, notes, or masters.

The desktop PPTX engine entry point is Node-only. This app reuses its browser-safe ZIP gate and JSZip dependencies, follows its relationship-resolution policy, and patches only the contents of existing editable DrawingML text elements. Rich-run properties, slide shapes, relationships, unknown XML, and every other ZIP part remain intact. An unchanged save returns the original file bytes. Existing fields, alternate content, self-closing text elements, and protected or signed presentations remain read only.

Build from the repository root using the installed dependencies:

```sh
npm run test --prefix apps/ipad-slides
npm run typecheck --prefix apps/ipad-slides
npm run build --prefix apps/ipad-slides
```

The build writes a self-contained `apps/ipad/EveryOffice/Resources/PresentationEditor/index.html` and `Resources/Templates/Blank.pptx`. The template reuses the existing engine's master/layout/theme and adds editable Title and Subtitle text boxes. No network access is used. The frontend has all 21 repository locales, token-based colors, and controls at least 44 CSS pixels high.

The bridge exposes `window.everyOffice.openDocument({name, base64, kind: 'pptx', language?})` and `window.everyOffice.saveDocument()`. It posts `ready`, `changed` with monotonically increasing `revision`, `save` with `base64`, `name`, `kind`, and the serialized snapshot's `revision`, or a localized `error` with `message` to `window.webkit.messageHandlers.everyOffice`. The native document owns file persistence and should clear its changed flag only when the saved revision still matches the current revision. A frontend `save` event means the bytes are prepared, not that the native write succeeded.

Mobile limits are 32 MiB compressed input/output, 5,000 archive entries, 16 MiB per inflated part, 128 MiB inflated total, 8 MiB slide XML, 1,000 slides, 2,000 text runs per slide, 20,000 runs per document, and 100,000 characters per run. XML depth, node, attribute, and namespace budgets also apply. Encrypted archives, duplicate ZIP entries, malformed XML, unsafe normalized paths, and forged ZIP size declarations are rejected before editing.
