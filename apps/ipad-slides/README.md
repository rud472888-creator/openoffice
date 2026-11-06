# iPad presentation editor

EveryOffice opens PPTX files in the bundled [DeckCraft editor](../../vendor/deckcraft/README.md). Its canvas, ribbon, slide navigation and slideshow are the upstream Rust interface. The current DeckCraft ribbon is in English.

The app serves the editor from its local HTTP server. The parent page checks the archive budget, sends the document bytes to the same-origin editor and waits for DeckCraft to confirm the actual file. An ordinary save updates the original local copy. Save As creates a separate presentation or sends an export to the system share sheet. Signed and modification-protected originals are guarded against writes. Closing an unedited file preserves its original bytes.

Use `npm run build -w @genoffice/ipad-slides` to generate the WKWebView resources. The Rust toolchain is needed only to regenerate the bundled runtime. The browser smoke test opens a Korean PPTX, uses the real New Slide command, saves, checks the slide count and text in the exported package, and reopens the result. Run `npm run test:browser -w @genoffice/ipad-slides` with `CHROMIUM_PATH` set to a Chromium executable.
