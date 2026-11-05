import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { readFile } from 'node:fs/promises'
import { createPresentationTemplate } from '../scripts/template'
import {
  PresentationDocument,
  MAX_PRESENTATION_BYTES,
  PRESENTATION_ZIP_LIMITS,
  decodeBase64,
  encodeBase64,
} from '../src/presentation'
import { LANGS } from '@genoffice/i18n'
import { localeCopy } from '../src/i18n'

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const richParagraph =
  '<a:p><a:pPr algn="ctr" marL="457200"/><a:r><a:rPr b="1" sz="2400"><a:solidFill><a:srgbClr val="C43E1C"/></a:solidFill><a:hlinkClick r:id="rIdLink"/></a:rPr><a:t xml:space="preserve">Same &amp; first</a:t></a:r><a:r><a:rPr i="1" lang="ko-KR"/><a:t>Same &amp; first</a:t></a:r><a:br/><a:r><a:rPr u="sng"/><a:t>終わり 😀</a:t></a:r><a:endParaRPr sz="1600"/></a:p>'

async function fixture(paragraph = richParagraph): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(await createPresentationTemplate())
  const original = await zip.file('ppt/slides/slide1.xml')!.async('string')
  const slide = original.replace(/<a:p>.*?<\/a:p>/, paragraph)
  zip.file('ppt/slides/slide1.xml', slide)
  zip.file('ppt/slides/slide2.xml', slide.replace('Title', 'Second slide'))
  const presentation = await zip.file('ppt/presentation.xml')!.async('string')
  zip.file(
    'ppt/presentation.xml',
    presentation.replace('</p:sldIdLst>', '<p:sldId id="257" r:id="rIdSecond"/></p:sldIdLst>'),
  )
  const rels = await zip.file('ppt/_rels/presentation.xml.rels')!.async('string')
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    rels.replace(
      '</Relationships>',
      '<Relationship Id="rIdSecond" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>',
    ),
  )
  const slideRels = await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string')
  zip.file(
    'ppt/slides/_rels/slide1.xml.rels',
    slideRels.replace(
      '</Relationships>',
      '<Relationship Id="rIdLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.org" TargetMode="External"/></Relationships>',
    ),
  )
  zip.file('ppt/media/image1.png', new Uint8Array([137, 80, 78, 71, 0, 17, 255]))
  zip.file(
    'customXml/item1.xml',
    '<custom:unknown xmlns:custom="urn:example" a="untouched">Keep exactly</custom:unknown>',
  )
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

async function mapParts(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const zip = await JSZip.loadAsync(bytes)
  return new Map(
    await Promise.all(
      Object.values(zip.files)
        .filter((f) => !f.dir)
        .map(async (f) => [f.name, await f.async('uint8array')] as const),
    ),
  )
}

describe('iPad presentation text adapter', () => {
  it('returns the exact source bytes when unchanged and uses presentation relationship order', async () => {
    const bytes = await fixture()
    const doc = await PresentationDocument.open(bytes, 'deck.pptx')
    expect(doc.slides.map((s) => s.path)).toEqual([
      'ppt/slides/slide1.xml',
      'ppt/slides/slide2.xml',
    ])
    expect(doc.slides[0].paragraphs[0].runs.map((r) => r.text)).toEqual([
      'Same & first',
      'Same & first',
      '終わり 😀',
    ])
    expect((await doc.save()).bytes).toBe(bytes)
  })

  it('patches only the selected text body, preserving rich runs and every other ZIP part', async () => {
    const bytes = await fixture()
    const before = await mapParts(bytes)
    const doc = await PresentationDocument.open(bytes, 'deck.pptx')
    doc.setText(0, 0, 1, '  Edited <&> 한글 😀  ')
    const snapshot = await doc.save()
    expect(snapshot.revision).toBe(1)
    const after = await mapParts(snapshot.bytes)
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort())
    for (const [path, original] of before)
      if (path !== 'ppt/slides/slide1.xml') expect(after.get(path), path).toEqual(original)
    const originalXml = new TextDecoder().decode(before.get('ppt/slides/slide1.xml'))
    const expectedXml = originalXml.replace(
      '<a:t>Same &amp; first</a:t>',
      '<a:t>  Edited &lt;&amp;&gt; 한글 😀  </a:t>',
    )
    expect(new TextDecoder().decode(after.get('ppt/slides/slide1.xml'))).toBe(expectedXml)
    const reopened = await PresentationDocument.open(snapshot.bytes, 'edited.pptx')
    expect(reopened.slides[0].paragraphs[0].runs[1].text).toBe('  Edited <&> 한글 😀  ')
    expect(reopened.slides[0].paragraphs[0].runs[0].text).toBe('Same & first')
    doc.setText(0, 0, 1, 'Same & first')
    expect((await doc.save()).bytes).toBe(bytes)
  })

  it('captures a stable revision before asynchronous ZIP generation', async () => {
    const doc = await PresentationDocument.open(await fixture(), 'deck.pptx')
    doc.setText(0, 0, 0, 'Snapshot')
    const saving = doc.save()
    doc.setText(0, 0, 0, 'Newer typing')
    const snapshot = await saving
    expect(snapshot.revision).toBe(1)
    expect(doc.revision).toBe(2)
    const reopened = await PresentationDocument.open(snapshot.bytes, 'saved.pptx')
    expect(reopened.slides[0].paragraphs[0].runs[0].text).toBe('Snapshot')
  })

  it('does not insert text outside a self-closing a:t or change fields', async () => {
    const doc = await PresentationDocument.open(
      await fixture(
        '<a:p><a:r><a:t/></a:r><a:fld id="{1}" type="slidenum"><a:t>1</a:t></a:fld><a:r><a:t></a:t></a:r></a:p>',
      ),
      'deck.pptx',
    )
    expect(doc.slides[0].paragraphs[0].runs.map((r) => r.editable)).toEqual([false, false, true])
    expect(() => doc.setText(0, 0, 0, 'bad')).toThrow('readOnly')
    expect(() => doc.setText(0, 0, 1, 'bad')).toThrow('readOnly')
    doc.setText(0, 0, 2, 'Safe empty run')
    expect(
      (await PresentationDocument.open((await doc.save()).bytes, 'saved.pptx')).slides[0]
        .paragraphs[0].runs[2].text,
    ).toBe('Safe empty run')
  })

  it('supports alternate namespace prefixes and preserves XML comments', async () => {
    const zip = await JSZip.loadAsync(await fixture())
    let xml = await zip.file('ppt/slides/slide1.xml')!.async('string')
    xml = xml
      .replaceAll('xmlns:a=', 'xmlns:draw=')
      .replaceAll('<a:', '<draw:')
      .replaceAll('</a:', '</draw:')
    xml = xml.replace('<p:cSld>', '<p:cSld><!-- <draw:t>not a run</draw:t> -->')
    zip.file('ppt/slides/slide1.xml', xml)
    const doc = await PresentationDocument.open(
      await zip.generateAsync({ type: 'uint8array' }),
      'deck.pptx',
    )
    expect(doc.slides[0].paragraphs[0].runs.length).toBe(3)
    doc.setText(0, 0, 0, 'Changed')
    const saved = await JSZip.loadAsync((await doc.save()).bytes)
    expect(await saved.file('ppt/slides/slide1.xml')!.async('string')).toBe(
      xml.replace('Same &amp; first', 'Changed'),
    )
  })

  it('keeps protected presentations read only', async () => {
    const zip = await JSZip.loadAsync(await fixture())
    const xml = await zip.file('ppt/presentation.xml')!.async('string')
    zip.file(
      'ppt/presentation.xml',
      xml.replace(
        '</p:presentation>',
        '<p:modifyVerifier cryptProviderType="rsaAES"/></p:presentation>',
      ),
    )
    const doc = await PresentationDocument.open(
      await zip.generateAsync({ type: 'uint8array' }),
      'protected.pptx',
    )
    expect(doc.readOnly).toBe(true)
    expect(() => doc.setText(0, 0, 0, 'bad')).toThrow('readOnly')
  })

  it('opens and roundtrips the bundled title/subtitle template with valid master and theme parts', async () => {
    const bytes = await createPresentationTemplate()
    const doc = await PresentationDocument.open(bytes, 'Blank.pptx')
    expect(doc.slides[0].paragraphs.map((p) => p.runs[0].text)).toEqual(['Title', 'Subtitle'])
    doc.setText(0, 0, 0, 'Quarterly update')
    doc.setText(0, 1, 0, 'Offline on iPad')
    const saved = (await doc.save()).bytes
    const reopened = await PresentationDocument.open(saved, 'new.pptx')
    expect(reopened.slides[0].paragraphs.map((p) => p.runs[0].text)).toEqual([
      'Quarterly update',
      'Offline on iPad',
    ])
    const before = await mapParts(bytes)
    const after = await mapParts(saved)
    for (const path of [
      'ppt/theme/theme1.xml',
      'ppt/slideMasters/slideMaster1.xml',
      'ppt/slideLayouts/slideLayout1.xml',
    ])
      expect(after.get(path)).toEqual(before.get(path))
  })

  it.each(['01_standard_business.pptx', '05_unicode_cjk_emoji.pptx'])(
    'opens, edits and reopens upstream fixture %s',
    async (name) => {
      const bytes = new Uint8Array(
        await readFile(
          new URL(`../../../packages/pptx-engine/tests/fixtures/${name}`, import.meta.url),
        ),
      )
      const doc = await PresentationDocument.open(bytes, name)
      const slideIndex = doc.slides.findIndex((s) =>
        s.paragraphs.some((p) => p.runs.some((r) => r.editable)),
      )
      const paragraphIndex = doc.slides[slideIndex].paragraphs.findIndex((p) =>
        p.runs.some((r) => r.editable),
      )
      const runIndex = doc.slides[slideIndex].paragraphs[paragraphIndex].runs.findIndex(
        (r) => r.editable,
      )
      doc.setText(slideIndex, paragraphIndex, runIndex, 'Updated 한글 😀')
      const saved = (await doc.save()).bytes
      const reopened = await PresentationDocument.open(saved, name)
      expect(reopened.slides[slideIndex].paragraphs[paragraphIndex].runs[runIndex].text).toBe(
        'Updated 한글 😀',
      )
      const before = await mapParts(bytes)
      const after = await mapParts(saved)
      for (const [path, original] of before)
        if (path !== doc.slides[slideIndex].path) expect(after.get(path), path).toEqual(original)
    },
  )

  it('contains complete translated copy for all 21 supported locales', () => {
    for (const lang of LANGS) {
      const copy = localeCopy(lang)
      expect(Object.values(copy)).toHaveLength(21)
      expect(
        Object.values(copy).every((value) => typeof value === 'string' && value.length > 0),
      ).toBe(true)
      if (lang !== 'en') expect(copy.hint).not.toBe(localeCopy('en').hint)
    }
  })

  it('encodes and decodes bytes without changing them', () => {
    const bytes = Uint8Array.from({ length: 100000 }, (_, i) => i % 256)
    expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes)
    expect(() => decodeBase64('%%%')).toThrow('invalidPresentation')
  })
})

describe('mobile safety boundaries', () => {
  it('rejects encrypted and oversized input before parsing', async () => {
    await expect(
      PresentationDocument.open(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]), 'encrypted.pptx'),
    ).rejects.toThrow('encryptedPresentation')
    await expect(
      PresentationDocument.open(new Uint8Array(MAX_PRESENTATION_BYTES + 1), 'big.pptx'),
    ).rejects.toThrow('presentationTooLarge')
    const bytes = await fixture()
    const encrypted = bytes.slice()
    const e = new DataView(encrypted.buffer)
    const directory = e.getUint32(encrypted.length - 22 + 16, true)
    e.setUint16(directory + 8, e.getUint16(directory + 8, true) | 1, true)
    await expect(PresentationDocument.open(encrypted, 'encrypted.pptx')).rejects.toThrow(
      'encryptedPresentation',
    )
  })

  it('rejects declared-size and forged-size ZIP bombs through the shared metered gate', async () => {
    const zip = new JSZip()
    zip.file('bomb.xml', 'x'.repeat(30000))
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
    const view = new DataView(bytes.buffer)
    const directory = view.getUint32(bytes.length - 22 + 16, true)
    view.setUint32(directory + 24, PRESENTATION_ZIP_LIMITS.maxPartBytes + 1, true)
    await expect(PresentationDocument.open(bytes, 'big.pptx')).rejects.toThrow(
      'presentationTooLarge',
    )
    view.setUint32(directory + 24, 1, true)
    await expect(PresentationDocument.open(bytes, 'liar.pptx')).rejects.toThrow(
      'presentationTooLarge',
    )
  })

  it('rejects duplicate central-directory names before JSZip can collapse them', async () => {
    const zip = new JSZip()
    zip.file('duplicate', 'one')
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const original = new DataView(bytes.buffer)
    const end = bytes.length - 22
    const directory = original.getUint32(end + 16, true)
    const central = bytes.subarray(directory, end)
    const duplicate = new Uint8Array(bytes.length + central.length)
    duplicate.set(bytes.subarray(0, end))
    duplicate.set(central, end)
    duplicate.set(bytes.subarray(end), end + central.length)
    const view = new DataView(duplicate.buffer)
    const newEnd = end + central.length
    view.setUint16(newEnd + 8, 2, true)
    view.setUint16(newEnd + 10, 2, true)
    view.setUint32(newEnd + 12, central.length * 2, true)
    await expect(PresentationDocument.open(duplicate, 'ambiguous.pptx')).rejects.toThrow(
      'invalidPresentation',
    )
  })

  it('rejects excessive XML nesting and namespace growth without recursive processing', async () => {
    const zip = await JSZip.loadAsync(await fixture())
    const deep =
      Array.from({ length: 200 }, (_, i) => `<x:n xmlns:x="urn:test" xmlns:n${i}="urn:${i}">`).join(
        '',
      ) + '</x:n>'.repeat(200)
    zip.file('ppt/slides/slide1.xml', `<p:sld xmlns:p="${P}" xmlns:a="${A}">${deep}</p:sld>`)
    await expect(
      PresentationDocument.open(await zip.generateAsync({ type: 'uint8array' }), 'deep.pptx'),
    ).rejects.toThrow('presentationTooLarge')
  })

  it('rejects XML-invalid text and keeps the original run unchanged', async () => {
    const doc = await PresentationDocument.open(await fixture(), 'deck.pptx')
    expect(() => doc.setText(0, 0, 0, 'bad\u0001')).toThrow('invalidText')
    expect(() => doc.setText(0, 0, 0, 'bad\ud800')).toThrow('invalidText')
    expect(doc.dirty).toBe(false)
  })

  it('refuses edited output that would exceed the XML reopening budget', async () => {
    const paragraph = '<a:p>' + '<a:r><a:t>Text</a:t></a:r>'.repeat(20) + '</a:p>'
    const doc = await PresentationDocument.open(await fixture(paragraph), 'deck.pptx')
    for (let run = 0; run < 20; run++) doc.setText(0, 0, run, '&'.repeat(100000))
    await expect(doc.save()).rejects.toThrow('presentationTooLarge')
  })
})
