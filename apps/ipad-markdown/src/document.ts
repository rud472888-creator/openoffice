import type { Editor } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import {
  parseDocText,
  serializeDocText,
  type DocEnvelope,
} from '../../markdown/src/renderer/markdown/docText'
import {
  buildSourceMap,
  spliceMarkdown,
  type SourceMap,
} from '../../markdown/src/renderer/markdown/sourceSplice'
import {
  readSourceText,
  writeSourceText,
  type SourceTextFormat,
} from '../../markdown/src/shared/source-text'

export class NoteDocument {
  readonly original: Uint8Array
  readonly raw: string
  envelope: DocEnvelope
  sourceFormat: SourceTextFormat
  private initial?: PmNode
  private readonly originalFrontmatter: string
  private map: SourceMap | null = null

  constructor(
    bytes: Uint8Array,
    readonly kind: string,
  ) {
    if (bytes.length > 8 * 1024 * 1024) throw new Error('Document exceeds the mobile text limit')
    this.original = new Uint8Array(bytes)
    this.raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    this.envelope = parseDocText(this.raw)
    this.originalFrontmatter = this.envelope.frontmatter
    this.sourceFormat = readSourceText(this.raw).format
  }
  get markdown() {
    return ['md', 'markdown'].includes(this.kind)
  }
  bind(editor: Editor) {
    editor.commands.setContent(this.envelope.body, { contentType: 'markdown', emitUpdate: false })
    this.initial = editor.state.doc
    this.map = buildSourceMap(editor, editor.state.doc, this.envelope.body)
  }
  richText(editor: Editor): string {
    if (
      this.initial?.eq(editor.state.doc) &&
      this.envelope.frontmatter === this.originalFrontmatter
    )
      return this.raw
    // Unknown blocks must not disappear through a fallback whole-document serializer.
    if (!this.map)
      throw new Error('Use source view to edit this document without losing unsupported blocks')
    return serializeDocText(this.envelope, spliceMarkdown(editor, editor.state.doc, this.map))
  }
  saveSource(value: string): Uint8Array {
    if (value === readSourceText(this.raw).text) return new Uint8Array(this.original)
    return this.checked(writeSourceText(value, this.sourceFormat))
  }
  private checked(value: string): Uint8Array {
    const bytes = new TextEncoder().encode(value)
    if (bytes.length > 8 * 1024 * 1024) throw new Error('Document exceeds the mobile text limit')
    return bytes
  }
  saveRich(editor: Editor): Uint8Array {
    return this.checked(this.richText(editor))
  }
}
