import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { createPresentationTemplate } from '../scripts/template'
import { PresentationDocument } from '../src/presentation'
import { VisualPresentation } from '../src/visual'
import { PresentationFeatures } from '../src/features'

async function open(bytes?: Uint8Array) {
  const document = await PresentationDocument.open(
    bytes ?? (await createPresentationTemplate()),
    'features.pptx',
  )
  const visual = new VisualPresentation(document)
  return { document, visual, features: new PresentationFeatures(visual) }
}

describe('desktop feature adapters', () => {
  it('creates and edits notes through the real desktop helper, preserving slide content', async () => {
    const { document, features } = await open()
    const slide = document.currentSlideXml(0)
    await features.setNotes(0, 'Speaker notes 한글 😀\nSecond line <&> $&')
    expect(await features.notes(0)).toBe('Speaker notes 한글 😀\nSecond line <&> $&')
    const reopened = await open((await document.save()).bytes)
    expect(await reopened.features.notes(0)).toBe('Speaker notes 한글 😀\nSecond line <&> $&')
    expect(reopened.document.currentSlideXml(0)).toBe(slide)
    expect(reopened.document.archive.file('ppt/notesMasters/notesMaster1.xml')).not.toBeNull()
    await reopened.features.setNotes(0, 'Replacement')
    expect(await reopened.features.notes(0)).toBe('Replacement')
  })

  it('adds, edits, and deletes classic comments without dropping author or other package parts', async () => {
    const { document, features } = await open()
    await features.addComment(0, 'A <&> "Author"', 'Review this 한글')
    let comments = await features.comments(0)
    expect(comments[0].author).toBe('A <&> "Author"')
    await features.editComment(0, comments[0], 'Changed $& <&>')
    comments = await features.comments(0)
    expect(comments[0].text).toBe('Changed $& <&>')
    const reopened = await open((await document.save()).bytes)
    expect((await reopened.features.comments(0))[0].text).toBe('Changed $& <&>')
    await reopened.features.editComment(0, comments[0], null)
    expect(await reopened.features.comments(0)).toEqual([])
    expect(reopened.document.hasPart('ppt/commentAuthors.xml')).toBe(true)
  })

  it('enumerates real desktop layout/master models and assigns layout relationships only', async () => {
    const { document, features } = await open()
    const parts = await features.layouts()
    expect(parts.layouts).toHaveLength(1)
    expect(parts.masters).toHaveLength(1)
    const slide = document.currentSlideXml(0)
    await features.assignLayout(0, parts.layouts[0].path)
    expect(document.currentSlideXml(0)).toBe(slide)
    expect((await open((await document.save()).bytes)).document.slides).toHaveLength(1)
  })

  it('writes desktop animation and transition XML and preserves content through reopen', async () => {
    const { document, features } = await open()
    await features.setAnimations(0, [
      { spid: 2, effect: 'fade', trigger: 'onClick', durationMs: 700, delayMs: 100 },
    ])
    let state = await features.animationState(0)
    expect(state.animations[0].durationMs).toBe(700)
    await features.transition(0, 'fade')
    const reopened = await open((await document.save()).bytes)
    state = await reopened.features.animationState(0)
    expect(state.transition).toBe('fade')
    expect(state.animations[0].effect).toBe('fade')
    await reopened.features.setAnimations(0, [])
    expect((await reopened.features.animationState(0)).animations).toEqual([])
  })

  it('inserts desktop-generated charts and clones data edits while preserving old chart/workbook parts', async () => {
    const { document, features, visual } = await open()
    const index = await features.newChart(0, 'bar', {
      categories: ['A', 'B'],
      series: [{ name: 'Revenue', values: [10, 20] }],
    })
    expect((await visual.slide(0)).model.elements[index].type).toBe('chart')
    const originalChart = await document.readPart('ppt/charts/chart_ipad1.xml')
    const originalBook = await document.readPart('ppt/embeddings/chart_ipad1.xlsx')
    await features.editChart(0, index, {
      categories: ['Edited <&>', 'B'],
      series: [{ name: 'Revenue', values: [30, 40] }],
    })
    expect(await document.readPart('ppt/charts/chart_ipad1.xml')).toEqual(originalChart)
    expect(await document.readPart('ppt/embeddings/chart_ipad1.xlsx')).toEqual(originalBook)
    const reopened = await open((await document.save()).bytes)
    expect(await reopened.features.chartData(0, index)).toEqual({
      categories: ['Edited <&>', 'B'],
      series: [{ name: 'Revenue', values: [30, 40] }],
    })
    const workbook = await JSZip.loadAsync(
      (await reopened.document.readPart('ppt/embeddings/chart_ipad2.xlsx'))!,
    )
    expect(await workbook.file('xl/worksheets/sheet1.xml')!.async('string')).toContain('<v>30</v>')
  })
})
