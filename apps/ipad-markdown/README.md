# iPad Markdown and source editor

The iPad host mounts the desktop Markdown TipTap extensions and CodeMirror source editor. Markdown retains its original frontmatter, BOM, line endings and unchanged source blocks through the existing desktop source-splice serializer. TXT and JSON use source mode and are never interpreted as Markdown.

Implemented controls include rich marks/headings/lists/tasks, table operations, quotations/code blocks, links, local images, math, Mermaid blocks, frontmatter editing, source view, find/replace and undo/redo. PDF/print uses the desktop print HTML and native paginated printing. DOCX conversion creates an independent library copy, preserving editable block equations and rasterizing rendered diagrams with the existing desktop exporter. Inline equations retain their LaTeX text, matching the desktop exporter. Image paste is embedded as a data URL; no image host is contacted.

```sh
npm run typecheck -w @genoffice/ipad-markdown
npm test -w @genoffice/ipad-markdown
npm run build -w @genoffice/ipad-markdown
node apps/ipad/scripts/markdown-smoke.mjs
```

The browser smoke covers real rich/source input, exact no-op bytes, Korean edit/save/reopen, BOM/CRLF/frontmatter and no remote requests. Native iPad tests cover the note route separately. UTF-8 inputs and saved outputs are bounded to 8 MiB; invalid UTF-8 is refused rather than rewritten with replacement characters.

Workspace-backed wiki resolution, backlinks/tag graphs, companion relative assets, cloud image hosting and desktop AI integrations are not provided by this host. Unsupported source blocks remain preserved; if a reliable block map cannot be built, rich saving refuses and the source view remains available. These are tracked in `docs/ipad-feature-parity.md`, not treated as completed desktop parity.
