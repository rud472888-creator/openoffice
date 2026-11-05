import { getSlideNotes, setSlideNotes } from '../../../packages/pptx-engine/src/notes'
import {
  getSlideComments,
  addSlideComment,
  type SlideComment,
} from '../../../packages/pptx-engine/src/comments'
import { listSlideLayouts } from '../../../packages/pptx-engine/src/layout'
import { listMasterParts } from '../../../packages/pptx-engine/src/master-edit'
import {
  readSlideTimingXml,
  patchSlideTimingIncrementalXml,
  patchSlideTimingXml,
  buildTimingXml,
  elementSpid,
  type SlideAnimation,
} from '../../../packages/pptx-engine/src/animation'
import {
  patchSlideTransitionXml,
  readSlideTransitionXml,
  type SlideTransitionKind,
} from '../../../packages/pptx-engine/src/generate'
import {
  buildChartSpaceXml,
  type NewChartOptions,
} from '../../../packages/pptx-engine/src/chart-insert'
import {
  chartWorkbookXlsx,
  chartWorkbookParts,
} from '../../../packages/pptx-engine/src/chart-workbook'
import JSZip from 'jszip'
import { assertZipInflatesWithinLimits } from '@genoffice/zip-gate'
import { desktopXmlArchive } from './desktop-archive'
import { assertValidText, relsPath, resolveTarget } from './presentation'
import { VisualPresentation } from './visual'

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PACKAGE = 'http://schemas.openxmlformats.org/package/2006/relationships'
const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export interface ChartData {
  categories: string[]
  series: Array<{ name: string; values: number[] }>
}

export class PresentationFeatures {
  private cached?: { revision: number; value: ReturnType<typeof desktopXmlArchive> }
  constructor(readonly visual: VisualPresentation) {}
  private archive() {
    const document = this.visual.document
    if (this.cached?.revision !== document.revision)
      this.cached = { revision: document.revision, value: desktopXmlArchive(document) }
    return this.cached!.value
  }

  async notes(index: number): Promise<string> {
    const { opened } = await this.archive()
    return getSlideNotes(opened.archive, opened.deck.slides[index].path)
  }

  async setNotes(index: number, text: string): Promise<void> {
    assertValidText(text)
    if (this.visual.document.presentationPath !== 'ppt/presentation.xml')
      throw new Error('readOnly')
    const state = await desktopXmlArchive(this.visual.document)
    if (!setSlideNotes(state.opened, index, text)) throw new Error('readOnly')
    this.visual.apply(state.changes())
  }

  async comments(index: number): Promise<SlideComment[]> {
    const { opened } = await this.archive()
    return getSlideComments(opened.archive, opened.deck.slides[index].path)
  }

  private async commentArchive(index: number) {
    const state = await desktopXmlArchive(this.visual.document)
    const rels = state.opened.archive.readRels(state.opened.deck.slides[index].path)
    if ([...rels.values()].some((rel) => /comment/i.test(rel.type) && rel.type !== `${R}/comments`))
      throw new Error('readOnly')
    return state
  }

  async addComment(index: number, author: string, text: string): Promise<void> {
    assertValidText(author)
    assertValidText(text)
    if (!author.trim() || !text.trim() || author.length > 100) throw new Error('invalidText')
    const state = await this.commentArchive(index)
    if (!addSlideComment(state.opened, index, { author, text })) throw new Error('readOnly')
    this.visual.apply(state.changes())
  }

  async editComment(
    index: number,
    ref: Pick<SlideComment, 'authorId' | 'idx'>,
    text: string | null,
  ): Promise<void> {
    if (text !== null) assertValidText(text)
    const state = await this.commentArchive(index)
    const slide = state.opened.deck.slides[index]
    const rel = [...state.opened.archive.readRels(slide.path).values()].find(
      (rel) => rel.type === `${R}/comments`,
    )
    if (!rel) throw new Error('readOnly')
    const path = resolveTarget(slide.path, rel.target)
    const xml = state.opened.archive.readText(path)
    if (!xml) throw new Error('readOnly')
    let found = false
    const next = xml.replace(/<p:cm\b[^>]*>[\s\S]*?<\/p:cm>/g, (comment) => {
      if (
        Number(/\bauthorId="(\d+)"/.exec(comment)?.[1]) !== ref.authorId ||
        Number(/\bidx="(\d+)"/.exec(comment)?.[1]) !== ref.idx
      )
        return comment
      found = true
      return text === null
        ? ''
        : comment.replace(
            /(<p:text>)[\s\S]*?(<\/p:text>)/,
            (_all, a: string, b: string) => a + escape(text) + b,
          )
    })
    if (!found) throw new Error('readOnly')
    this.visual.apply(new Map([[path, next]]))
  }

  async layouts() {
    const { opened } = await this.archive()
    return {
      layouts: listSlideLayouts(opened.archive),
      masters: listMasterParts(opened.archive).filter((part) => part.kind === 'master'),
    }
  }

  async assignLayout(index: number, path: string): Promise<void> {
    const state = await this.archive()
    if (!listSlideLayouts(state.opened.archive).some((layout) => layout.path === path))
      throw new Error('readOnly')
    const slide = this.visual.document.slides[index]
    const part = relsPath(slide.path)
    let xml =
      (await this.visual.document.readXml(part)) ??
      `<Relationships xmlns="${PACKAGE}"></Relationships>`
    let found = false
    xml = xml.replace(/<Relationship\b[^>]*\/>/g, (rel) => {
      if (!/Type="[^"]*\/slideLayout"/.test(rel)) return rel
      found = true
      return rel.replace(/\bTarget="[^"]*"/, () => `Target="../${escape(path.slice(4))}"`)
    })
    if (!found) {
      const ids = new Set([...state.opened.archive.readRels(slide.path).keys()])
      let n = 1
      while (ids.has(`rId${n}`)) n++
      xml = xml.replace(
        '</Relationships>',
        () =>
          `<Relationship Id="rId${n}" Type="${R}/slideLayout" Target="../${escape(path.slice(4))}"/></Relationships>`,
      )
    }
    this.visual.apply(new Map([[part, xml]]))
  }

  async animationState(index: number) {
    const { model } = await this.visual.slide(index)
    return {
      animations: readSlideTimingXml(model.bodySuffix),
      transition: readSlideTransitionXml(model.bodySuffix),
    }
  }

  async setAnimations(index: number, animations: SlideAnimation[]): Promise<void> {
    const { model } = await this.visual.slide(index)
    if (animations.length > 100) throw new Error('presentationTooLarge')
    const ids = new Set(model.elements.map(elementSpid).filter((id) => id !== null))
    for (const animation of animations)
      if (
        !ids.has(animation.spid) ||
        !Number.isFinite(animation.durationMs) ||
        !Number.isFinite(animation.delayMs) ||
        animation.durationMs < 0 ||
        animation.durationMs > 600000 ||
        animation.delayMs < 0 ||
        animation.delayMs > 600000 ||
        !['onClick', 'withPrev', 'afterPrev'].includes(animation.trigger)
      )
        throw new Error('invalidText')
    const old = readSlideTimingXml(model.bodySuffix)
    const incremental = patchSlideTimingIncrementalXml(model.bodySuffix, animations)
    const original = /<p:timing\b[\s\S]*?<\/p:timing>/.exec(model.bodySuffix)?.[0]
    if (!incremental && original && buildTimingXml(old) !== original) throw new Error('readOnly')
    const suffix = incremental ?? patchSlideTimingXml(model.bodySuffix, animations)
    this.visual.apply(
      new Map([
        [
          model.path,
          model.bodyPrefix +
            model.elements
              .map((element) => element.anchor.originalXml + (element.anchor.gapAfter ?? ''))
              .join('') +
            suffix,
        ],
      ]),
    )
  }

  async transition(index: number, kind: SlideTransitionKind): Promise<void> {
    const { model } = await this.visual.slide(index)
    this.visual.apply(
      new Map([
        [
          model.path,
          model.bodyPrefix +
            model.elements
              .map((element) => element.anchor.originalXml + (element.anchor.gapAfter ?? ''))
              .join('') +
            patchSlideTransitionXml(model.bodySuffix, kind),
        ],
      ]),
    )
  }

  private validateChart(data: ChartData): void {
    if (
      !data.categories.length ||
      data.categories.length > 200 ||
      !data.series.length ||
      data.series.length > 32
    )
      throw new Error('presentationTooLarge')
    for (const category of data.categories) assertValidText(category)
    for (const series of data.series) {
      assertValidText(series.name)
      if (
        series.values.length !== data.categories.length ||
        series.values.some((value) => !Number.isFinite(value))
      )
        throw new Error('invalidText')
    }
  }

  async chartData(index: number, elementIndex: number): Promise<ChartData> {
    const { model } = await this.visual.slide(index)
    const element = model.elements[elementIndex]
    if (element.type !== 'chart') throw new Error('readOnly')
    const data = {
      categories: [...element.chart.categories],
      series: element.chart.series.map((series) => ({
        name: series.name ?? '',
        values: series.values.map((value) => value ?? 0),
      })),
    }
    this.validateChart(data)
    return data
  }

  async newChart(index: number, kind: 'bar' | 'line' | 'pie', data: ChartData): Promise<number> {
    this.validateChart(data)
    const { model, size } = await this.visual.slide(index)
    const number = this.freePart('ppt/charts/chart_ipad', '.xml')
    const chartPath = `ppt/charts/chart_ipad${number}.xml`,
      workbook = `ppt/embeddings/chart_ipad${number}.xlsx`
    const opts: NewChartOptions = {
      ...data,
      kind,
      offset: {
        x: Math.round(size.cx * 0.15),
        y: Math.round(size.cy * 0.15),
        cx: Math.round(size.cx * 0.7),
        cy: Math.round(size.cy * 0.65),
      },
    }
    const chartXml = buildChartSpaceXml(opts, 'rId1')
    const slideRelsPath = relsPath(model.path),
      slideRels =
        (await this.visual.document.readXml(slideRelsPath)) ??
        `<Relationships xmlns="${PACKAGE}"></Relationships>`
    const ids = [...slideRels.matchAll(/\bId="rId(\d+)"/g)].map((m) => Number(m[1]))
    const rid = Math.max(0, ...ids) + 1
    const id =
      Math.max(
        1,
        ...[...model.originalXml.matchAll(/<p:cNvPr\b[^>]*\bid="(\d+)"/g)].map((m) => Number(m[1])),
      ) + 1
    const o = opts.offset
    const shape = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Chart ${id}" descr="aislides-chart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${o.x}" y="${o.y}"/><a:ext cx="${o.cx}" cy="${o.cy}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId${rid}"/></a:graphicData></a:graphic></p:graphicFrame>`
    const types = await this.visual.document.readXml('[Content_Types].xml')
    if (!types) throw new Error('invalidPresentation')
    const updatedTypes = types.replace(
      '</Types>',
      () =>
        `<Override PartName="/${chartPath}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>${types.includes('Extension="xlsx"') ? '' : '<Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>'}</Types>`,
    )
    this.visual.apply(
      new Map<string, string | Uint8Array>([
        [
          model.path,
          this.visual.document
            .currentSlideXml(index)
            .replace('</p:spTree>', () => shape + '</p:spTree>'),
        ],
        [
          slideRelsPath,
          slideRels.replace(
            '</Relationships>',
            () =>
              `<Relationship Id="rId${rid}" Type="${R}/chart" Target="../charts/chart_ipad${number}.xml"/></Relationships>`,
          ),
        ],
        [chartPath, chartXml],
        [
          relsPath(chartPath),
          `<Relationships xmlns="${PACKAGE}"><Relationship Id="rId1" Type="${R}/package" Target="../embeddings/chart_ipad${number}.xlsx"/></Relationships>`,
        ],
        [workbook, chartWorkbookXlsx(data)],
        ['[Content_Types].xml', updatedTypes],
      ]),
    )
    return model.elements.length
  }

  private freePart(prefix: string, extension: string): number {
    let number = 1
    while (this.visual.document.hasPart(`${prefix}${number}${extension}`)) number++
    return number
  }

  async editChart(index: number, elementIndex: number, data: ChartData): Promise<void> {
    this.validateChart(data)
    const { model } = await this.visual.slide(index)
    const element = model.elements[elementIndex]
    if (element.type !== 'chart' || !element.anchor.originalXml.includes('descr="aislides-chart"'))
      throw new Error('readOnly')
    const state = await this.archive()
    const rid = /<c:chart\b[^>]*\br:id="([^"]+)"/.exec(element.anchor.originalXml)?.[1]
    const rel = rid ? state.opened.archive.readRels(model.path).get(rid) : undefined
    if (!rel) throw new Error('readOnly')
    const path = resolveTarget(model.path, rel.target)
    const bookRel = [...state.opened.archive.readRels(path).values()].find(
      (rel) => rel.type === `${R}/package`,
    )
    if (!bookRel) throw new Error('readOnly')
    const bookPath = resolveTarget(path, bookRel.target)
    const original = await this.visual.document.readPart(bookPath)
    if (!original) throw new Error('readOnly')
    await assertZipInflatesWithinLimits(original, {
      maxParts: 100,
      maxPartBytes: 8 * 1024 * 1024,
      maxTotalBytes: 16 * 1024 * 1024,
    })
    const zip = await JSZip.loadAsync(original, { checkCRC32: true })
    const oldData = await this.chartData(index, elementIndex),
      expected = chartWorkbookParts(oldData)
    const names = Object.values(zip.files)
      .filter((file) => !file.dir)
      .map((file) => file.name)
    if (names.length !== Object.keys(expected).length) throw new Error('readOnly')
    for (const [name, content] of Object.entries(expected))
      if ((await zip.file(name)?.async('string')) !== content) throw new Error('readOnly')
    const chart = element.chart
    if (!['bar', 'line', 'pie'].includes(chart.kind)) throw new Error('readOnly')
    const originalOptions: NewChartOptions = {
      ...oldData,
      kind: chart.kind as 'bar' | 'line' | 'pie',
      title: chart.title,
      offset: element.transform.offset,
    }
    if (
      state.opened.archive.readText(path) !== buildChartSpaceXml(originalOptions, bookRel.id) ||
      state.opened.archive.readRels(path).size !== 1
    )
      throw new Error('readOnly')
    // Clone known chart/workbook parts so shared charts on other slides never change.
    let number = this.freePart('ppt/charts/chart_ipad', '.xml')
    while (this.visual.document.hasPart(`ppt/embeddings/chart_ipad${number}.xlsx`)) number++
    const nextChart = `ppt/charts/chart_ipad${number}.xml`,
      nextBook = `ppt/embeddings/chart_ipad${number}.xlsx`
    const slideRelsPath = relsPath(model.path),
      slideRels = state.opened.archive.readText(slideRelsPath)
    const types = state.opened.archive.readText('[Content_Types].xml')
    if (!slideRels || !types) throw new Error('invalidPresentation')
    const nextId =
      Math.max(0, ...[...slideRels.matchAll(/\bId="rId(\d+)"/g)].map((m) => Number(m[1]))) + 1
    const shape = element.anchor.originalXml.replace(
      /(<c:chart\b[^>]*\br:id=")[^"]*(")/,
      (_all, a: string, b: string) => `${a}rId${nextId}${b}`,
    )
    const [start, end] = element.anchor.range,
      slideXml = this.visual.document.currentSlideXml(index)
    const opts: NewChartOptions = { ...originalOptions, ...data }
    this.visual.apply(
      new Map<string, string | Uint8Array>([
        [model.path, slideXml.slice(0, start) + shape + slideXml.slice(end)],
        [
          slideRelsPath,
          slideRels.replace(
            '</Relationships>',
            () =>
              `<Relationship Id="rId${nextId}" Type="${R}/chart" Target="../charts/chart_ipad${number}.xml"/></Relationships>`,
          ),
        ],
        [nextChart, buildChartSpaceXml(opts, 'rId1')],
        [nextBook, chartWorkbookXlsx(data)],
        [
          relsPath(nextChart),
          `<Relationships xmlns="${PACKAGE}"><Relationship Id="rId1" Type="${R}/package" Target="../embeddings/chart_ipad${number}.xlsx"/></Relationships>`,
        ],
        [
          '[Content_Types].xml',
          types.replace(
            '</Types>',
            () =>
              `<Override PartName="/${nextChart}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>`,
          ),
        ],
      ]),
    )
  }
}
