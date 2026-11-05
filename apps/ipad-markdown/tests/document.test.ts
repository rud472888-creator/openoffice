import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../../markdown/src/renderer/editor/extensions'
import { NoteDocument } from '../src/document'

const editors: Editor[] = []
const encode = (text: string) => new TextEncoder().encode(text)
const decode = (bytes: Uint8Array) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
const make = (source: string) => {
  const model = new NoteDocument(encode(source), 'md')
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: buildExtensions({
      slashController: { onOpen() {}, onUpdate() {}, onClose() {}, onKeyDown: () => false },
      slashItems: () => [],
      wikiLink: { resolve: async () => ({}) },
    }),
  })
  model.bind(editor)
  editors.push(editor)
  return { model, editor }
}
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
})

describe('shared Markdown round trips', () => {
  it('retains exact BOM, CRLF, frontmatter, reference syntax and trailing blanks without edits', () => {
    const source =
      '\uFEFF---\r\ntitle: 원문\r\n---\r\n\r\n# 제목\r\n\r\n*강조* [링크][ref]\r\n\r\n[ref]: https://example.org\r\n\r\n'
    const { model, editor } = make(source)
    expect(decode(model.saveRich(editor))).toBe(source)
  })
  it('changes the edited block while retaining untouched syntax and references', () => {
    const source = 'original\n\n*untouched*\n\n[ref]: https://example.org\n'
    const { model, editor } = make(source)
    editor.commands.insertContentAt({ from: 1, to: 9 }, 'changed')
    const saved = decode(model.saveRich(editor))
    expect(saved).toContain('changed')
    expect(saved).toContain('*untouched*')
    expect(saved).toContain('[ref]: https://example.org')
  })
  it('roundtrips edited GFM table cells through the desktop serializer', () => {
    const { model, editor } = make('| A | B |\n| --- | --- |\n| one | two |\n')
    let target = -1
    editor.state.doc.descendants((node, position) => {
      if (node.isText && node.text === 'one') target = position
    })
    expect(target).toBeGreaterThan(-1)
    editor.commands.insertContentAt({ from: target, to: target + 3 }, '한글')
    const saved = decode(model.saveRich(editor))
    const reopened = make(saved)
    expect(reopened.editor.state.doc.textContent).toContain('한글')
    expect(reopened.editor.state.doc.firstChild?.type.name).toBe('table')
  })
  it('retains UTF-8 source bytes and line endings for TXT and JSON', () => {
    for (const kind of ['txt', 'json']) {
      const source = '\uFEFF{\r\n  "name": "원문"\r\n}\r\n'
      const model = new NoteDocument(encode(source), kind)
      expect(decode(model.saveSource('{\n  "name": "원문"\n}\n'))).toBe(source)
      expect(decode(model.saveSource('{\n  "name": "수정"\n}\n'))).toBe(
        source.replace('원문', '수정'),
      )
    }
  })
  it('rejects invalid UTF-8 rather than silently replacing bytes', () => {
    expect(() => new NoteDocument(new Uint8Array([255, 254, 0]), 'txt')).toThrow()
  })
  it('saves frontmatter-only edits without rewriting unchanged body', () => {
    const { model, editor } = make('---\ntitle: old\n---\n\n*original*\n')
    model.envelope.frontmatter = '---\ntitle: new\n---\n\n'
    expect(decode(model.saveRich(editor))).toBe('---\ntitle: new\n---\n\n*original*\n')
  })
})
