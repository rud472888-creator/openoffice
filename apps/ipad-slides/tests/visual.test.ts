import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { readFile } from 'node:fs/promises'
import { createPresentationTemplate } from '../scripts/template'
import { PresentationDocument } from '../src/presentation'
import { VisualPresentation } from '../src/visual'
import { LANGS } from '@genoffice/i18n'
import { visualCopy } from '../src/visual-copy'

async function open(bytes?: Uint8Array) {
  const document = await PresentationDocument.open(
    bytes ?? (await createPresentationTemplate()),
    'deck.pptx',
  )
  return new VisualPresentation(document)
}

describe('visual presentation adapter', () => {
  it('uses the desktop renderer to lay out title/subtitle with inherited theme and colors', async () => {
    const visual = await open()
    const slide = await visual.slide(0)
    expect(slide.model.elements.map((e) => e.type)).toEqual(['text', 'text'])
    expect(slide.tree.widthPx).toBe(960)
    expect(slide.tree.heightPx).toBe(540)
    expect(slide.tree.nodes[0].type).toBe('text')
    expect(slide.editable.has(0)).toBe(true)
  })

  it('moves/resizes/rotates an object using engine patches and preserves every other shape and ZIP part', async () => {
    const bytes = await createPresentationTemplate()
    const visual = await open(bytes)
    const before = await visual.slide(0)
    const subtitle = before.model.elements[1].anchor.originalXml
    await visual.transform(0, 0, {
      x: 1000000,
      y: 900000,
      width: 6000000,
      height: 1200000,
      rotation: 25,
    })
    const changed = await visual.slide(0)
    expect(changed.model.elements[0].transform.offset).toEqual({
      x: 1000000,
      y: 900000,
      cx: 6000000,
      cy: 1200000,
    })
    expect(changed.model.elements[0].transform.rot).toBe(25 * 60000)
    expect(changed.model.elements[1].anchor.originalXml).toBe(subtitle)
    const saved = (await visual.document.save()).bytes
    const originalZip = await JSZip.loadAsync(bytes)
    const savedZip = await JSZip.loadAsync(saved)
    for (const file of Object.values(originalZip.files))
      if (!file.dir && file.name !== 'ppt/slides/slide1.xml')
        expect(await savedZip.file(file.name)!.async('uint8array'), file.name).toEqual(
          await file.async('uint8array'),
        )
    const reopened = await open(saved)
    expect((await reopened.slide(0)).model.elements[0].transform.rot).toBe(1500000)
  })

  it('combines text editing with geometry, font, alignment, fill and background changes', async () => {
    const visual = await open()
    visual.setRunText(0, 0, 0, 'Updated 한글 😀')
    await visual.transform(0, 0, { x: 1100000 })
    await visual.font(0, 0, {
      bold: true,
      italic: true,
      fontSize: 32,
      color: '#006699',
      fontFamily: 'Arial',
    })
    await visual.align(0, 0, 'left')
    await visual.fill(0, 0, '#ffeecc')
    await visual.background(0, '#f6f7f9')
    const reopened = await open((await visual.document.save()).bytes)
    const slide = await reopened.slide(0)
    const element = slide.model.elements[0]
    expect(element.transform.offset.x).toBe(1100000)
    if (element.type !== 'text' && element.type !== 'shape')
      throw new Error('Expected text element')
    const run = element.text!.paragraphs[0].runs[0]
    expect(run.text).toBe('Updated 한글 😀')
    expect(run.bold).toBe(true)
    expect(run.italic).toBe(true)
    expect(run.fontSize).toBe(32)
    expect(run.color?.toLowerCase()).toBe('#006699')
    expect(element.text!.paragraphs[0].align).toBe('left')
    expect(element.fill).toEqual({ type: 'solid', color: '#FFEECC' })
  })

  it('adds and reorders slides, duplicates editable content, and removes a slide without losing original parts', async () => {
    const visual = await open()
    const duplicate = await visual.addSlide(0, true)
    expect(duplicate).toBe(1)
    expect((await visual.slide(1)).model.elements).toHaveLength(2)
    const blank = await visual.addSlide(1)
    expect(blank).toBe(2)
    expect((await visual.slide(2)).model.elements).toHaveLength(0)
    await visual.insert(2, 'text', 'New third slide')
    const thirdPath = visual.document.slides[2].path
    await visual.reorder(2, 0)
    expect(visual.document.slides[0].path).toBe(thirdPath)
    await visual.deleteSlide(1)
    const reopened = await open((await visual.document.save()).bytes)
    expect(reopened.document.slides).toHaveLength(2)
    expect(reopened.document.slides[0].paragraphs[0].runs[0].text).toBe('New third slide')
    expect(reopened.document.archive.file('ppt/slides/slide1.xml')).not.toBeNull()
  })

  it('embeds images and inserts vector shapes without flattening the package', async () => {
    const visual = await open()
    const rectangle = await visual.insert(0, 'rect')
    const ellipse = await visual.insert(0, 'ellipse')
    expect(rectangle).toBe(2)
    expect(ellipse).toBe(3)
    const png = new Uint8Array(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=',
        'base64',
      ),
    )
    await visual.insertImage(0, png, 'png', 1, 1)
    const saved = (await visual.document.save()).bytes
    const reopened = await open(saved)
    const slide = await reopened.slide(0)
    expect(slide.model.elements).toHaveLength(5)
    expect(slide.model.elements[4].type).toBe('picture')
    const picture = slide.tree.nodes.find((node) => node.type === 'picture')
    expect(
      picture?.type === 'picture' && picture.dataUrl?.startsWith('data:image/png;base64,'),
    ).toBe(true)
    expect(
      await reopened.document.archive.file('ppt/media/ipadImage1.png')!.async('uint8array'),
    ).toEqual(png)
  })

  it('undoes and redoes compound package edits with monotonically increasing revisions', async () => {
    const visual = await open()
    await visual.insert(0, 'text', 'Reversible')
    await visual.addSlide(0, true)
    const revision = visual.document.revision
    visual.undo()
    expect(visual.document.slides).toHaveLength(1)
    visual.undo()
    expect((await visual.slide(0)).model.elements).toHaveLength(2)
    visual.redo()
    visual.redo()
    expect(visual.document.slides).toHaveLength(2)
    expect(visual.document.revision).toBe(revision + 4)
    expect((await open((await visual.document.save()).bytes)).document.slides).toHaveLength(2)
  })

  it.each(['01_standard_business.pptx', '05_unicode_cjk_emoji.pptx'])(
    'renders upstream fixture %s with desktop geometry',
    async (file) => {
      const bytes = new Uint8Array(
        await readFile(
          new URL(`../../../packages/pptx-engine/tests/fixtures/${file}`, import.meta.url),
        ),
      )
      const visual = await open(bytes)
      for (let i = 0; i < visual.document.slides.length; i++) {
        const slide = await visual.slide(i)
        expect(slide.tree.widthPx).toBe(960)
        expect(slide.tree.nodes.length).toBeGreaterThan(0)
      }
    },
  )

  it('preserves rich run/hyperlink XML when transforming another property', async () => {
    const zip = await JSZip.loadAsync(await createPresentationTemplate())
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string')
    const rich =
      '<a:rPr b="1" lang="en-US" sz="4000"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:latin typeface="Calibri"/><a:hlinkClick r:id="rIdCustom"/></a:rPr>'
    const replacement = xml.replace(/<a:rPr\b[\s\S]*?<\/a:rPr>/, rich)
    zip.file('ppt/slides/slide1.xml', replacement)
    const visual = await open(await zip.generateAsync({ type: 'uint8array' }))
    await visual.transform(0, 0, { rotation: 15 })
    const saved = await JSZip.loadAsync((await visual.document.save()).bytes)
    expect(await saved.file('ppt/slides/slide1.xml')!.async('string')).toContain(rich)
  })

  it('has translated visual controls and capability notices in all 21 locales', () => {
    for (const lang of LANGS) {
      const copy = visualCopy(lang)
      expect(Object.values(copy).every((s) => typeof s === 'string' && s.length > 0)).toBe(true)
      if (lang !== 'en') expect(copy.hint).not.toBe(visualCopy('en').hint)
    }
  })

  it('inserts an editable table and resizes its actual OOXML grid', async () => {
    const visual = await open()
    const table = await visual.insertTable(0, 3, 3)
    const cells = visual.runLocations(0, table)
    expect(cells).toHaveLength(9)
    visual.setRunText(0, cells[0].paragraph, cells[0].run, 'Editable cell')
    await visual.transform(0, table, { width: 6000000, height: 2500000 })
    const reopened = await open((await visual.document.save()).bytes)
    const element = (await reopened.slide(0)).model.elements[table]
    if (element.type !== 'table') throw new Error('Expected table')
    expect(element.rows[0][0].text?.paragraphs[0].runs[0].text).toBe('Editable cell')
    expect(element.colWidths.reduce((a, b) => a + b, 0)).toBeCloseTo(6000000, -1)
    expect(element.rowHeights.reduce((a, b) => a + b, 0)).toBeCloseTo(2500000, -1)
  })

  it('keeps namespace-alias structures read only for geometry instead of introducing unbound prefixes', async () => {
    const zip = await JSZip.loadAsync(await createPresentationTemplate())
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string')
    zip.file(
      'ppt/slides/slide1.xml',
      xml
        .replaceAll('xmlns:a=', 'xmlns:draw=')
        .replaceAll('<a:', '<draw:')
        .replaceAll('</a:', '</draw:'),
    )
    const visual = await open(await zip.generateAsync({ type: 'uint8array' }))
    expect((await visual.slide(0)).editable.size).toBe(0)
    await expect(visual.transform(0, 0, { x: 1 })).rejects.toThrow('readOnly')
    await expect(visual.insert(0, 'rect')).rejects.toThrow('readOnly')
    expect(visual.document.dirty).toBe(false)
  })

  it('does not carry animation references into a new blank slide', async () => {
    const zip = await JSZip.loadAsync(await createPresentationTemplate())
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string')
    zip.file(
      'ppt/slides/slide1.xml',
      xml.replace(
        '</p:sld>',
        '<p:timing><p:tnLst><p:par><p:cTn id="1"/></p:par></p:tnLst></p:timing></p:sld>',
      ),
    )
    const visual = await open(await zip.generateAsync({ type: 'uint8array' }))
    await visual.addSlide(0)
    expect(visual.document.currentSlideXml(1)).not.toContain('p:timing')
    expect((await visual.slide(1)).model.elements).toHaveLength(0)
    expect(visual.document.currentSlideXml(0)).toContain('p:timing')
  })
})
