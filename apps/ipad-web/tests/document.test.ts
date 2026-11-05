import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { buildBlankDocx, parseDocx } from '@genoffice/docx-engine'
import { buildKitchenSinkDocx } from '../../../packages/docx-engine/tests/helpers/build-docx'
import { decodeBase64, encodeBase64, textOf, WordDocument } from '../src/document'
import { stringsFor } from '../src/strings'
import { LANGS } from '@genoffice/i18n'

async function makeDocx(body: string, settings = ''): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(await buildBlankDocx())
  const xml = await zip.file('word/document.xml')!.async('string')
  zip.file('word/document.xml', xml.replace('<w:p/>', body))
  if (settings)
    zip.file(
      'word/settings.xml',
      `<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${settings}</w:settings>`,
    )
  return zip.generateAsync({ type: 'uint8array' })
}

async function entries(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const zip = await JSZip.loadAsync(bytes)
  return new Map(
    await Promise.all(
      Object.entries(zip.files)
        .filter(([, f]) => !f.dir)
        .map(async ([name, f]) => [name, await f.async('uint8array')] as const),
    ),
  )
}

describe('iPad DOCX text editor', () => {
  it.each(['simple', 'kitchen-sink'])(
    'keeps the %s fixture byte-identical without edits',
    async (fixture) => {
      const bytes = new Uint8Array(
        await readFile(new URL(`../../../fixtures/generated/${fixture}.docx`, import.meta.url)),
      )
      const doc = await WordDocument.open(bytes, `${fixture}.docx`)
      expect(await doc.save()).toBe(bytes)
    },
  )

  it('surgically edits rich text, preserves other parts and opens the saved DOCX again', async () => {
    const original = await buildKitchenSinkDocx()
    const doc = await WordDocument.open(original, 'test.docx')
    const partIndex = doc.parts.findIndex((p) => p.docxIndex === 1)
    expect(doc.parts[partIndex].paragraphs[0].editable).toBe(true)
    const originalParagraph = doc.parts[partIndex].originalXml
    doc.setText(partIndex, 0, doc.parts[partIndex].paragraphs[0].text + ' <edited & safe>')
    const saved = await doc.save()
    const before = await entries(original)
    const after = await entries(saved)
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort())
    for (const [name, bytes] of before) {
      if (name !== 'word/document.xml') expect(after.get(name), name).toEqual(bytes)
    }
    const xml = new TextDecoder().decode(after.get('word/document.xml')!)
    expect(xml).toContain('&lt;edited &amp; safe&gt;')
    for (const part of doc.parts) {
      if (part.docxIndex !== 1) expect(xml).toContain(part.originalXml)
    }
    expect(
      originalParagraph.match(/<w:rPr>[\s\S]*?<\/w:rPr>/g)?.every((r) => xml.includes(r)),
    ).toBe(true)
    const reopened = await WordDocument.open(saved, 'saved.docx')
    expect(reopened.parts[partIndex].paragraphs[0].text).toContain('<edited & safe>')
  })

  it('opens the bundled new-document template, edits it, and adds a paragraph', async () => {
    const bytes = new Uint8Array(
      await readFile(
        new URL('../../ipad/EveryOffice/Resources/Templates/Blank.docx', import.meta.url),
      ),
    )
    const doc = await WordDocument.open(bytes, 'Untitled.docx')
    expect(doc.readOnly).toBe(false)
    expect(doc.parts[0].paragraphs[0].editable).toBe(true)
    doc.setText(0, 0, 'Created on iPad')
    doc.setAddedText(doc.appendParagraph(), 'Another paragraph')
    const reparsed = await parseDocx(await doc.save())
    expect(reparsed.blocks.filter((b) => !b.hidden).map((b) => textOf(b.originalXml!))).toEqual([
      'Created on iPad',
      'Another paragraph',
    ])
  })

  it('keeps digitally signed documents read-only and returns their original bytes', async () => {
    const zip = await JSZip.loadAsync(await buildBlankDocx())
    zip.file('_xmlsignatures/sig1.xml', '<Signature/>')
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const doc = await WordDocument.open(bytes, 'signed.docx')
    expect(doc.signed).toBe(true)
    expect(doc.readOnly).toBe(true)
    expect(() => doc.setText(0, 0, 'change')).toThrow('readOnly')
    expect(() => doc.appendParagraph()).toThrow('readOnly')
    expect(await doc.save()).toBe(bytes)
  })

  it('retains the hidden trailing section exactly once after an edit', async () => {
    const doc = await WordDocument.open(await buildBlankDocx(), 'section.docx')
    const section = doc.parsed.blocks.find((b) => b.hidden)!
    expect(section.originalXml).toContain('<w:sectPr>')
    doc.setText(0, 0, 'updated')
    const reopened = await WordDocument.open(await doc.save(), 'section.docx')
    expect(reopened.parsed.internal.documentXml.match(/<w:sectPr>/g)).toHaveLength(1)
    expect(reopened.parsed.internal.documentXml).toContain(section.originalXml)
  })

  it('does not alter field results that span separate paragraphs', async () => {
    const bytes = await makeDocx(
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>TOC</w:instrText><w:fldChar w:fldCharType="separate"/></w:r></w:p><w:p><w:r><w:t>Contents result</w:t></w:r></w:p><w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
    )
    const doc = await WordDocument.open(bytes, 'fields.docx')
    for (const part of doc.parts) expect(part.paragraphs.every((p) => !p.editable)).toBe(true)
  })

  it('edits a repeated paragraph in a table without touching the other cell or table properties', async () => {
    const paragraph = '<w:p><w:r><w:t>same</w:t></w:r></w:p>'
    const bytes = await makeDocx(
      `<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc>${paragraph}</w:tc><w:tc>${paragraph}</w:tc></w:tr></w:tbl>`,
    )
    const doc = await WordDocument.open(bytes, 'table.docx')
    doc.setText(0, 1, 'second')
    const result = await WordDocument.open(await doc.save(), 'table.docx')
    expect(result.parts[0].paragraphs.map((p) => p.text)).toEqual(['same', 'second'])
    expect(result.parts[0].originalXml).toContain('<w:tblW w:w="4000" w:type="dxa"/>')
  })

  it('can write into a new blank document and add a paragraph', async () => {
    const doc = await WordDocument.open(await buildBlankDocx(), 'new.docx')
    doc.setText(0, 0, 'Hello 😀')
    doc.setAddedText(doc.appendParagraph(), 'A second paragraph')
    const result = await parseDocx(await doc.save())
    expect(result.blocks.filter((b) => !b.hidden).map((b) => textOf(b.originalXml!))).toEqual([
      'Hello 😀',
      'A second paragraph',
    ])
  })

  it('does not rewrite fields, hyperlinks, revisions, breaks, shapes or content controls', async () => {
    const complex = [
      '<w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple>',
      '<w:r><w:fldChar w:fldCharType="begin"/><w:t>field</w:t></w:r>',
      '<w:hyperlink r:id="rId9"><w:r><w:t>link</w:t></w:r></w:hyperlink>',
      '<w:ins w:id="1"><w:r><w:t>revision</w:t></w:r></w:ins>',
      '<w:r><w:t>break</w:t><w:br/></w:r>',
      '<w:r><w:t>shape</w:t><w:drawing/></w:r>',
      '<w:sdt><w:sdtContent><w:r><w:t>control</w:t></w:r></w:sdtContent></w:sdt>',
    ]
    for (const inner of complex) {
      const bytes = await makeDocx(`<w:p>${inner}</w:p>`)
      const doc = await WordDocument.open(bytes, 'complex.docx')
      expect(doc.parts[0].paragraphs[0].editable, inner).toBe(false)
      expect(() => doc.setText(0, 0, 'changed')).toThrow('readOnly')
      expect(await doc.save()).toBe(bytes)
    }
  })

  it.each(['<w:documentProtection w:enforcement="1" w:edit="readOnly"/>', '<w:trackRevisions/>'])(
    'respects document protection and tracked changes',
    async (settings) => {
      const doc = await WordDocument.open(
        await makeDocx('<w:p><w:r><w:t>protected</w:t></w:r></w:p>', settings),
        'protected.docx',
      )
      expect(doc.readOnly).toBe(true)
      expect(() => doc.appendParagraph()).toThrow('readOnly')
      expect(() => doc.setText(0, 0, 'x')).toThrow('readOnly')
    },
  )

  it('rejects control characters and newlines without losing previous content', async () => {
    const doc = await WordDocument.open(await buildBlankDocx(), 'new.docx')
    doc.setText(0, 0, 'safe')
    expect(() => doc.setText(0, 0, 'first\nsecond')).toThrow('oneParagraph')
    expect(() => doc.setText(0, 0, '\u0001')).toThrow('oneParagraph')
    expect(doc.parts[0].paragraphs[0].text).toBe('safe')
  })

  it('rejects aliased ZIP paths instead of normalizing an edited archive', async () => {
    const zip = await JSZip.loadAsync(await buildBlankDocx())
    zip.file('word/media/../aliased.txt', 'preserve me')
    await expect(
      WordDocument.open(await zip.generateAsync({ type: 'uint8array' }), 'alias.docx'),
    ).rejects.toThrow('failed')
  })

  it('rejects duplicate ZIP central-directory names', async () => {
    const bytes = await buildBlankDocx()
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const end = bytes.length - 22
    const centralAt = view.getUint32(end + 16, true)
    const length =
      46 +
      view.getUint16(centralAt + 28, true) +
      view.getUint16(centralAt + 30, true) +
      view.getUint16(centralAt + 32, true)
    const duplicate = bytes.subarray(centralAt, centralAt + length)
    const output = new Uint8Array(bytes.length + length)
    output.set(bytes.subarray(0, end))
    output.set(duplicate, end)
    output.set(bytes.subarray(end), end + length)
    const modified = new DataView(output.buffer)
    modified.setUint16(end + length + 8, view.getUint16(end + 8, true) + 1, true)
    modified.setUint16(end + length + 10, view.getUint16(end + 10, true) + 1, true)
    modified.setUint32(end + length + 12, view.getUint32(end + 12, true) + length, true)
    await expect(WordDocument.open(output, 'duplicate.docx')).rejects.toThrow('failed')
  })

  it('rejects XML-invalid Unicode while accepting valid astral characters', async () => {
    const doc = await WordDocument.open(await buildBlankDocx(), 'unicode.docx')
    doc.setText(0, 0, 'Valid 😀')
    const added = doc.appendParagraph()
    for (const text of ['bad\ufffe', 'bad\uffff', 'bad\ud800', 'bad\udfff']) {
      expect(() => doc.setText(0, 0, text)).toThrow('cannotSave')
      expect(() => doc.setAddedText(added, text)).toThrow('cannotSave')
    }
    expect(doc.parts[0].paragraphs[0].text).toBe('Valid 😀')
  })

  it('refuses an edited output exceeding the mobile reopen budget and retains the draft', async () => {
    const doc = await WordDocument.open(await buildBlankDocx(), 'large-edit.docx')
    const draft = 'x'.repeat(16 * 1024 * 1024)
    doc.setText(0, 0, draft)
    await expect(doc.save()).rejects.toThrow()
    expect(doc.dirty).toBe(true)
    expect(doc.parts[0].paragraphs[0].text).toBe(draft)
    doc.setText(0, 0, 'A smaller draft')
    const reopened = await WordDocument.open(await doc.save(), 'smaller.docx')
    expect(reopened.parts[0].paragraphs[0].text).toBe('A smaller draft')
  })

  it('rejects compressed archives exceeding the mobile expanded-part budget', async () => {
    const zip = await JSZip.loadAsync(await buildBlankDocx())
    zip.file('large.txt', 'x'.repeat(16 * 1024 * 1024 + 1))
    const compressed = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
    expect(compressed.byteLength).toBeLessThan(100000)
    await expect(WordDocument.open(compressed, 'oversize.docx')).rejects.toThrow()
  })

  it('roundtrips binary base64 and refuses oversize bridge messages', () => {
    const bytes = Uint8Array.from({ length: 70000 }, (_, i) => i % 256)
    expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes)
    expect(() => decodeBase64('x'.repeat(45_000_000))).toThrow('documentTooLarge')
  })

  it('provides every string in all 21 languages', () => {
    const reference = stringsFor('en').text
    for (const language of LANGS) {
      const strings = stringsFor(language).text
      expect(Object.keys(strings)).toEqual(Object.keys(reference))
      expect(Object.values(strings).every((s) => typeof s === 'string' && s.length > 0)).toBe(true)
      if (language !== 'en') expect(strings.add).not.toBe(reference.add)
    }
  })
})
