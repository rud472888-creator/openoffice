// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import JSZip from 'jszip'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import {
  buildBlankDocx,
  parseDocx,
  readSections,
  generateTocFieldXml,
} from '@genoffice/docx-engine'
import { openRichDocument } from '../src/formats'
import { buildOdt } from '../../../packages/odt-engine/tests/helpers/build-odt'
import { convertLegacyDocToDocx } from '@genoffice/doc2docx'
import { upsertNote, removeNote, insertOrUpdateToc } from '../src/reference-tools'
import { queueStyleUpsert } from '../src/desktop-dialogs'
import {
  applyTableValue,
  tableValueOf,
} from '../../docs/src/renderer/components/TablePropertiesDialog'
import { mountRichEditor } from '../src/rich-editor'
import { tableModelToPmNode, type PmNode } from '../../docs/src/renderer/editor/convert'
import { addCommentToRange } from '../../docs/src/renderer/editor/comments'
import { acceptAllRevisions, rejectAllRevisions } from '../../docs/src/renderer/editor/revisions'
import { mountHfEditor } from '../../docs/src/renderer/editor/hf-editor'
import { insertPictureAtSelection } from '../../docs/src/renderer/editor/insert-picture'

beforeAll(() => {
  vi.stubGlobal('CSS', { escape: (value: string) => value })
})

const editors: Editor[] = []
afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy())
  document.body.replaceChildren()
})

async function open(bytes?: Uint8Array, kind = 'docx') {
  const model = await openRichDocument(bytes ?? (await buildBlankDocx()), 'test.docx', kind)
  const element = document.createElement('div')
  const toolbar = document.createElement('div')
  document.body.append(toolbar, element)
  const errors: unknown[] = []
  const options = {
    element,
    toolbar,
    language: 'en' as const,
    model,
    changed() {},
    error(error: unknown) {
      errors.push(error)
    },
  }
  const editor = mountRichEditor(options)
  editors.push(editor)
  return { model, editor, errors, toolbar, options }
}

async function makeDocx(body: string) {
  const zip = await JSZip.loadAsync(await buildBlankDocx())
  const xml = await zip.file('word/document.xml')!.async('string')
  zip.file('word/document.xml', xml.replace('<w:p/>', body))
  return zip.generateAsync({ type: 'uint8array' })
}

const json = (editor: Editor) => editor.getJSON() as PmNode

describe('shared desktop rich editor on iPad', () => {
  it.each(['simple', 'kitchen-sink'])(
    'renders the %s fixture with the desktop schema and saves unchanged bytes',
    async (fixture) => {
      const bytes = new Uint8Array(
        await readFile(resolve(process.cwd(), '../../fixtures/generated', `${fixture}.docx`)),
      )
      const { model, editor } = await open(bytes)
      expect(await model.save(json(editor))).toBe(bytes)
      expect(editor.view.dom.classList.contains('ipad-rich-page')).toBe(true)
    },
  )

  it('roundtrips selected rich marks, font size, color, paragraph alignment and split paragraphs', async () => {
    const { model, editor } = await open()
    editor.commands.insertContent('Rich document')
    editor.commands.setTextSelection({ from: 1, to: 5 })
    editor
      .chain()
      .toggleMark('bold')
      .toggleMark('italic')
      .toggleMark('underline')
      .setMark('docTextStyle', { color: 'AA2255', sizeHalfPoints: 32 })
      .run()
    editor.commands.updateAttributes('docParagraph', { align: 'center' })
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    editor.commands.splitBlock()
    editor.commands.insertContent('Second paragraph')
    const saved = await model.save(json(editor))
    const reopened = await parseDocx(saved)
    const visible = reopened.blocks.filter((block) => !block.hidden)
    expect(visible).toHaveLength(2)
    expect(visible[0].runs?.find((run) => run.text.includes('Rich'))).toMatchObject({
      bold: true,
      italic: true,
      underline: true,
      color: 'AA2255',
      sizeHalfPoints: 32,
    })
    expect(visible[0].format?.align).toBe('center')
    expect(visible[1].runs?.map((run) => run.text).join('')).toBe('Second paragraph')
  })

  it('supports headings and preserves unrelated original archive entries during formatted edits', async () => {
    const bytes = await makeDocx(
      '<w:p><w:r><w:t>Editable title</w:t></w:r></w:p><w:p><w:r><w:t>Untouched body</w:t></w:r></w:p>',
    )
    const { model, editor } = await open(bytes)
    editor.commands.setTextSelection(1)
    editor.commands.setNode('docHeading', { level: 2 })
    const saved = await model.save(json(editor))
    const before = await JSZip.loadAsync(bytes)
    const after = await JSZip.loadAsync(saved)
    // Heading creation may add a supported style; untouched document parts stay byte-identical.
    for (const [name, file] of Object.entries(before.files)) {
      if (
        file.dir ||
        name === 'word/document.xml' ||
        name === 'word/styles.xml' ||
        name === 'docProps/core.xml'
      )
        continue
      expect(await after.file(name)!.async('uint8array'), name).toEqual(
        await file.async('uint8array'),
      )
    }
    const reopened = await parseDocx(saved)
    expect(reopened.blocks[0].level).toBe(2)
    expect(reopened.internal.documentXml).toContain(
      '<w:p><w:r><w:t>Untouched body</w:t></w:r></w:p>',
    )
  })

  it('inserts editable tables and roundtrips rich table cell content', async () => {
    const { model, editor } = await open()
    const table = tableModelToPmNode({
      rows: [[{ paras: ['First cell'] }, { paras: ['Second cell'] }]],
      colWidthsPct: [50, 50],
      widthPct: 100,
    })
    editor.commands.insertContent([table, { type: 'docParagraph' }])
    let cellTextAt = -1
    editor.state.doc.descendants((node, position) => {
      if (node.isText && node.text === 'First cell') cellTextAt = position
    })
    expect(cellTextAt).toBeGreaterThan(0)
    editor
      .chain()
      .setTextSelection({ from: cellTextAt, to: cellTextAt + 5 })
      .toggleMark('bold')
      .run()
    const reopened = await parseDocx(await model.save(json(editor)))
    const tableBlock = reopened.blocks.find((block) => block.type === 'table')!
    expect(tableBlock.originalXml).toContain('<w:b')
    expect(tableBlock.originalXml).toContain('First')
    expect(tableBlock.originalXml).toContain('Second cell')
  })

  it('inserts a packaged picture using the desktop image model and reopens its archive', async () => {
    const { model, editor } = await open()
    const base64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
    expect(
      insertPictureAtSelection(editor, {
        dataUrl: `data:image/png;base64,${base64}`,
        base64,
        mime: 'image/png',
        label: 'pixel.png',
        widthPx: 1,
        heightPx: 1,
      }),
    ).toBe(true)
    const saved = await model.save(json(editor))
    const reopened = await parseDocx(saved)
    expect(reopened.blocks.some((block) => block.type === 'image')).toBe(true)
    const zip = await JSZip.loadAsync(saved)
    expect(Object.keys(zip.files).some((name) => name.startsWith('word/media/aidocs'))).toBe(true)
  })

  it('rejects edits or deletion of protected field blocks while allowing adjacent text edits', async () => {
    const field = '<w:p><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>'
    const bytes = await makeDocx(field + '<w:p><w:r><w:t>Body</w:t></w:r></w:p>')
    const { model, editor } = await open(bytes)
    const before = json(editor)
    editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'docParagraph', content: [{ type: 'text', text: 'replacement' }] }],
    })
    expect(json(editor)).toEqual(before)
    const last = editor.state.doc.content.size - 1
    editor.commands.setTextSelection(last)
    editor.commands.insertContent(' edited')
    const saved = await model.save(json(editor))
    const reopened = await parseDocx(saved)
    expect(reopened.internal.documentXml).toContain(field)
    expect(reopened.blocks[1].runs?.map((run) => run.text).join('')).toBe('Body edited')
  })

  it('edits margins independently across sections and keeps the untouched section settings', async () => {
    const first =
      '<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:pPr><w:r><w:t>Section one</w:t></w:r></w:p>'
    const { model, editor } = await open(
      await makeDocx(first + '<w:p><w:r><w:t>Section two</w:t></w:r></w:p>'),
    )
    const sections = readSections(model.parsed)
    expect(sections).toHaveLength(2)
    model.sectionChanges.set(0, { ...sections[0].settings, marginLeft: 720, marginRight: 720 })
    const reopened = await parseDocx(await model.save(json(editor)))
    const result = readSections(reopened)
    expect(result[0].settings.marginLeft).toBe(720)
    expect(result[0].settings.marginRight).toBe(720)
    expect(result[1].settings).toEqual(sections[1].settings)
  })

  it('creates rich default headers and footers through the existing subeditor/save pipeline', async () => {
    const { model, editor } = await open()
    const host = document.createElement('div')
    document.body.append(host)
    const handle = mountHfEditor(host, {
      value: { text: '' },
      pageNo: '1',
      pageTotal: '1',
      spellcheck: true,
      onCommit(value) {
        model.options.header = value
      },
      onExit() {},
    })
    handle.editor.commands.insertContent('Header content')
    handle.editor.commands.setTextSelection({ from: 1, to: 7 })
    handle.editor.commands.toggleMark('bold')
    handle.exit()
    model.options.footer = { text: 'Footer content' }
    const reopened = await parseDocx(await model.save(json(editor)))
    expect(reopened.headerText).toContain('Header content')
    expect(reopened.headerParas?.[0].runs.some((run) => run.bold)).toBe(true)
    expect(reopened.footerText).toContain('Footer content')
  })

  it('saves anchored comments and newly inserted hyperlinks', async () => {
    const { model, editor } = await open()
    editor.commands.insertContent('Annotated text')
    expect(addCommentToRange(editor, 1, 10, '1')).toBe(true)
    model.options.comments = [{ id: '1', author: 'Reviewer', text: 'Comment saved in DOCX' }]
    editor.commands.setTextSelection({ from: 11, to: 15 })
    editor.commands.setMark('link', { href: 'https://example.com/docs' })
    const reopened = await parseDocx(await model.save(json(editor)))
    expect(reopened.comments).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: '1', text: 'Comment saved in DOCX' })]),
    )
    expect(reopened.internal.documentXml).toContain('w:commentRangeStart')
    expect(
      reopened.blocks[0].runs?.some((run) => run.link?.href === 'https://example.com/docs'),
    ).toBe(true)
  })

  it('records inserted text as tracked changes and can accept or reject it with desktop commands', async () => {
    const { model, editor } = await open()
    editor.storage.trackChanges.enabled = true
    model.options.trackRevisions = true
    editor.commands.insertContent('Tracked words')
    let reopened = await parseDocx(await model.save(json(editor)))
    expect(reopened.trackRevisions).toBe(true)
    expect(reopened.internal.documentXml).toContain('<w:ins')
    acceptAllRevisions(editor)
    reopened = await parseDocx(await model.save(json(editor)))
    expect(reopened.internal.documentXml).not.toContain('<w:ins')
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    editor.commands.insertContent(' rejected')
    rejectAllRevisions(editor)
    expect(editor.getText()).toBe('Tracked words')
  })

  it('supports review of an existing tracked document while preserving document protection', async () => {
    const zip = await JSZip.loadAsync(
      await makeDocx(
        '<w:p><w:ins w:id="1" w:author="Editor"><w:r><w:t>Pending revision</w:t></w:r></w:ins></w:p>',
      ),
    )
    zip.file(
      'word/settings.xml',
      '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:trackRevisions/></w:settings>',
    )
    const { model, editor } = await open(await zip.generateAsync({ type: 'uint8array' }))
    expect(model.readOnly).toBe(false)
    acceptAllRevisions(editor)
    const reopened = await parseDocx(await model.save(json(editor)))
    expect(reopened.internal.documentXml).not.toContain('<w:ins')
    expect(reopened.blocks[0].runs?.map((run) => run.text).join('')).toBe('Pending revision')
  })

  it('opens ODT through the shared bridge and preserves original bytes without edits', async () => {
    const bytes = await buildOdt({ body: '<text:p>Original ODT text</text:p>' })
    const { model, editor } = await open(bytes, 'odt')
    expect(editor.getText()).toContain('Original ODT text')
    expect(await model.save(json(editor))).toBe(bytes)
  })

  it('writes rich ODT edits back to ODT while preserving unrelated original entries', async () => {
    const bytes = await buildOdt({
      body: '<text:p>First ODT paragraph</text:p><text:p>Keep this paragraph</text:p>',
    })
    const { model, editor } = await open(bytes, 'odt')
    editor.commands.setTextSelection({ from: 1, to: 6 })
    editor.commands.insertContent('Edited')
    editor.commands.setTextSelection({ from: 1, to: 7 })
    editor.commands.toggleMark('bold')
    const saved = await model.save(json(editor))
    const before = await JSZip.loadAsync(bytes)
    const after = await JSZip.loadAsync(saved)
    expect(await after.file('mimetype')!.async('string')).toBe(
      'application/vnd.oasis.opendocument.text',
    )
    for (const [name, file] of Object.entries(before.files)) {
      if (file.dir || ['content.xml', 'styles.xml', 'META-INF/manifest.xml'].includes(name))
        continue
      expect(await after.file(name)!.async('uint8array'), name).toEqual(
        await file.async('uint8array'),
      )
    }
    expect(await after.file('content.xml')!.async('string')).toContain('Keep this paragraph')
    const reopened = await openRichDocument(saved, 'saved.odt', 'odt')
    expect(reopened.parsed.blocks[0].runs?.map((run) => run.text).join('')).toContain('Edited')
    expect(reopened.parsed.blocks[0].runs?.some((run) => run.bold)).toBe(true)
  })

  it('enforces existing ODT protected-cell and feature gates from the desktop editor', async () => {
    const bytes = await buildOdt({
      body: '<table:table><table:table-column/><table:table-row><table:table-cell table:protected="true"><text:p>Locked</text:p></table:table-cell></table:table-row></table:table>',
    })
    const { editor, toolbar } = await open(bytes, 'odt')
    let at = -1
    editor.state.doc.descendants((node, position) => {
      if (node.isText && node.text === 'Locked') at = position
    })
    expect(at).toBeGreaterThan(0)
    const before = editor.getText()
    editor.commands.setTextSelection(at)
    editor.commands.insertContent('forbidden')
    expect(editor.getText()).toBe(before)
    expect(
      (toolbar.querySelector('button[aria-label="Track Changes"]') as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('keeps signed ODT read-only and rejects encrypted ODT', async () => {
    const bytes = await buildOdt({
      body: '<text:p>Signed</text:p>',
      extraEntries: [{ name: 'META-INF/documentsignatures.xml', data: '<Signature/>' }],
    })
    const model = await openRichDocument(bytes, 'signed.odt', 'odt')
    expect(model.readOnly).toBe(true)
    const encrypted = await buildOdt({ encrypted: true })
    await expect(openRichDocument(encrypted, 'encrypted.odt', 'odt')).rejects.toThrow()
  })

  it.each(['word97-sample', 'formatting', 'table'])(
    'uses the unchanged legacy converter for %s DOC and never saves over DOC',
    async (name) => {
      const bytes = new Uint8Array(
        await readFile(
          resolve(process.cwd(), '../../packages/doc2docx/tests/fixtures', `${name}.doc`),
        ),
      )
      const { model, editor } = await open(bytes, 'doc')
      expect(model.readOnly).toBe(true)
      expect(model.legacy).toBeDefined()
      await expect(model.save(json(editor))).rejects.toThrow('cannotSave')
      const reference = await convertLegacyDocToDocx(bytes)
      const before = await JSZip.loadAsync(reference.docx)
      const after = await JSZip.loadAsync(model.legacy!.docx)
      for (const [path, file] of Object.entries(before.files)) {
        if (file.dir || path === 'docProps/core.xml') continue
        expect(await after.file(path)!.async('uint8array'), path).toEqual(
          await file.async('uint8array'),
        )
      }
      expect(model.legacy!.warnings).toEqual(reference.warnings)
    },
  )

  it('inserts, edits and removes real footnotes/endnotes with shared note commands', async () => {
    const { model, editor, options } = await open()
    editor.commands.insertContent('Referenced text')
    editor.commands.setTextSelection(5)
    upsertNote(editor, options, 'footnote', 'Original note')
    upsertNote(editor, options, 'endnote', 'Endnote body')
    let reopened = await parseDocx(await model.save(json(editor)))
    expect(reopened.footnotes[0].text).toBe('Original note')
    expect(reopened.endnotes[0].text).toBe('Endnote body')
    const id = model.options.footnotes![0].id
    upsertNote(editor, options, 'footnote', 'Edited note\nSecond paragraph', id)
    reopened = await parseDocx(await model.save(json(editor)))
    expect(reopened.footnotes[0].text).toBe('Edited note\nSecond paragraph')
    removeNote(editor, options, 'footnote', id)
    reopened = await parseDocx(await model.save(json(editor)))
    expect(reopened.footnotes).toHaveLength(0)
    expect(reopened.endnotes).toHaveLength(1)
  })

  it('creates and updates actual TOC field XML while preserving other locked fields', async () => {
    const other = '<w:p><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>'
    const { model, editor, options } = await open(
      await makeDocx(
        '<w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:r><w:t>Chapter One</w:t></w:r></w:p>' +
          other,
      ),
    )
    editor.commands.setTextSelection(1)
    insertOrUpdateToc(editor, options, false)
    let saved = await model.save(json(editor))
    let reopened = await parseDocx(saved)
    expect(reopened.internal.documentXml).toContain('TOC ')
    expect(reopened.internal.documentXml).toContain(other)
    insertOrUpdateToc(editor, options, true)
    saved = await model.save(json(editor))
    reopened = await parseDocx(saved)
    expect(reopened.internal.documentXml.match(/TOC /g)).toHaveLength(1)
    expect(reopened.internal.documentXml).toContain(other)
  })

  it('updates an original TOC without dropping its terminal explicit page break', async () => {
    const fields = generateTocFieldXml([{ level: 1, text: 'Old entry', pageNo: 1 }])
    fields[fields.length - 1] = fields[fields.length - 1].replace(
      /<\/w:p>$/,
      '<w:r><w:br w:type="page"/></w:r></w:p>',
    )
    const body =
      fields.join('') +
      '<w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:r><w:t>Fresh heading</w:t></w:r></w:p>'
    const { model, editor, options } = await open(await makeDocx(body))
    insertOrUpdateToc(editor, options, true)
    const reopened = await parseDocx(await model.save(json(editor)))
    expect(reopened.internal.documentXml).toContain('Fresh heading')
    expect(reopened.internal.documentXml).toContain('<w:br w:type="page"/>')
    expect(reopened.internal.documentXml.match(/TOC /g)).toHaveLength(1)
  })

  it('writes queued styles using the original desktop style dialog/save APIs', async () => {
    const { model, editor, options } = await open()
    editor.commands.insertContent('Custom style text')
    await queueStyleUpsert(
      {
        styleId: 'TabletStyle',
        name: 'Tablet Style',
        type: 'paragraph',
        rPr: { bold: true, color: '3355AA', sizeHalfPoints: 30 },
        pPr: { align: 'center' },
      },
      editor,
      options,
    )
    const reopened = await parseDocx(await model.save(json(editor)))
    expect(reopened.styles.get('TabletStyle')?.display).toMatchObject({
      bold: true,
      color: '3355AA',
      sizeHalfPoints: 30,
      align: 'center',
    })
    expect(reopened.blocks[0].styleId).toBe('TabletStyle')
  })

  it('uses desktop table properties and preserves its changed alignment on reopen', async () => {
    const { model, editor } = await open()
    editor.commands.insertContent([
      tableModelToPmNode({ rows: [[{ paras: ['Cell'] }]], colWidthsPct: [100], widthPct: 100 }),
      { type: 'docParagraph' },
    ])
    let at = 0
    editor.state.doc.descendants((node, position) => {
      if (node.isText && node.text === 'Cell') at = position
    })
    editor.commands.setTextSelection(at)
    const value = { ...tableValueOf(editor.getAttributes('docTable')), align: 'center' as const }
    applyTableValue(editor, value, new Set(['align']), 600)
    const reopened = await parseDocx(await model.save(json(editor)))
    expect(reopened.blocks.find((block) => block.type === 'table')?.originalXml).toContain(
      '<w:jc w:val="center"',
    )
  })

  it('edits original picture geometry through the shared image patch without replacing media bytes', async () => {
    const bytes = new Uint8Array(
      await readFile(resolve(process.cwd(), '../../fixtures/generated/kitchen-sink.docx')),
    )
    const { model, editor } = await open(bytes)
    let at = -1
    editor.state.doc.forEach((node, position) => {
      if (at < 0 && node.type.name === 'docProtected' && node.attrs.blockType === 'image')
        at = position
    })
    expect(at).toBeGreaterThanOrEqual(0)
    editor.commands.setNodeSelection(at)
    editor.commands.updateAttributes('docProtected', {
      imageWidthPx: 200,
      imageHeightPx: 120,
      imageRotDeg: 90,
    })
    const saved = await model.save(json(editor))
    const reopened = await parseDocx(saved)
    const image = reopened.blocks.find((block) => block.type === 'image')!
    expect(image.imageWidthPx).toBeCloseTo(200)
    expect(image.imageHeightPx).toBeCloseTo(120)
    const before = await JSZip.loadAsync(bytes),
      after = await JSZip.loadAsync(saved)
    for (const [name, file] of Object.entries(before.files))
      if (name.startsWith('word/media/') && !file.dir)
        expect(await after.file(name)!.async('uint8array')).toEqual(await file.async('uint8array'))
  })

  it('retains undo/redo history with the shared desktop extension', async () => {
    const { editor } = await open()
    editor.commands.insertContent('Undo me')
    expect(editor.getText()).toContain('Undo me')
    editor.commands.undo()
    expect(editor.getText()).not.toContain('Undo me')
    editor.commands.redo()
    expect(editor.getText()).toContain('Undo me')
  })
})
