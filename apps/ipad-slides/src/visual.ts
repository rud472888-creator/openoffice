import {
  parseSlide,
  parseDecorations,
  type ParseContext,
} from '../../../packages/pptx-engine/src/parse'
import { parseTheme, parseClrMap } from '../../../packages/pptx-engine/src/theme'
import {
  parsePlaceholderMap,
  parseMasterTextStyles,
  parseDefaultTextStyle,
} from '../../../packages/pptx-engine/src/placeholder'
import {
  patchElementXfrm,
  patchElementFill,
  patchElementStroke,
  patchTextElementXml,
  patchElementPPr,
  patchSlideBackgroundXml,
  generateParagraphXml,
  generateXfrmXml,
} from '../../../packages/pptx-engine/src/generate'
import type {
  Slide,
  SlideElement,
  Transform,
  SlideSize,
} from '../../../packages/pptx-engine/src/types'
import { buildRenderSlide, type RenderSlide } from '@genoffice/pptx-render'
import { scanSlide } from '../../../packages/pptx-engine/src/scan'
import {
  PresentationDocument,
  relationships,
  resolveTarget,
  relsPath,
  scanXml,
  encodeBase64,
  type PresentationSnapshot,
} from './presentation'

const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PACKAGE_R = 'http://schemas.openxmlformats.org/package/2006/relationships'
function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
export interface VisualSlide {
  model: Slide
  tree: RenderSlide
  size: SlideSize
  editable: Set<number>
}
export interface FontChange {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  fontSize?: number
  color?: string
  fontFamily?: string
}
export type BoxChange = Partial<{
  x: number
  y: number
  width: number
  height: number
  rotation: number
  flipH: boolean
  flipV: boolean
}>

/** Mobile adapter over the desktop's pure parser, inheritance, renderer and XML patch functions. */
export class VisualPresentation {
  private contexts = new Map<string, ParseContext>()
  private media = new Map<string, string>()
  private cache = new Map<string, VisualSlide>()
  private undoStates: PresentationSnapshot[] = []
  private redoStates: PresentationSnapshot[] = []
  private size: SlideSize = { cx: 12192000, cy: 6858000 }
  constructor(readonly document: PresentationDocument) {}

  private canonical(xml: string): boolean {
    let valid = false
    scanXml(xml, (tag) => {
      if (tag.local === 'sld')
        valid =
          /^http:\/\/(?:schemas\.openxmlformats\.org\/presentationml\/2006|purl\.oclc\.org\/ooxml\/presentationml)\/main$/.test(
            tag.namespaces.p ?? '',
          ) &&
          /^http:\/\/(?:schemas\.openxmlformats\.org\/drawingml\/2006|purl\.oclc\.org\/ooxml\/drawingml)\/main$/.test(
            tag.namespaces.a ?? '',
          )
    })
    return valid
  }

  get canUndo(): boolean {
    return this.undoStates.length > 0
  }
  get canRedo(): boolean {
    return this.redoStates.length > 0
  }

  private async xml(path: string): Promise<string | undefined> {
    const xml = await this.document.readXml(path)
    if (xml) scanXml(xml, () => {})
    return xml
  }

  private async rels(path: string): Promise<ReturnType<typeof relationships>> {
    const xml = await this.xml(relsPath(path))
    return xml ? relationships(xml) : new Map()
  }

  private async mediaRels(path: string): Promise<Map<string, string>> {
    const map = new Map<string, string>()
    for (const [id, rel] of await this.rels(path)) {
      if (rel.external || !rel.type.endsWith('/image')) continue
      const target = resolveTarget(path, rel.target)
      if (target) map.set(id, target)
    }
    return map
  }

  private async image(path: string): Promise<void> {
    if (this.media.has(path)) return
    const extension = path.split('.').at(-1)?.toLowerCase()
    const mime = (
      {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        svg: 'image/svg+xml',
        webp: 'image/webp',
        bmp: 'image/bmp',
      } as Record<string, string>
    )[extension ?? '']
    if (!mime) return
    const bytes = await this.document.readPart(path)
    if (bytes) this.media.set(path, `data:${mime};base64,${encodeBase64(bytes)}`)
  }

  private async context(path: string): Promise<ParseContext> {
    const cached = this.contexts.get(path)
    if (cached) return cached
    const rels = await this.rels(path)
    const find = (items: typeof rels, base: string, kind: string): string | undefined => {
      const rel = [...items.values()].find((r) => !r.external && r.type.endsWith(`/${kind}`))
      return rel ? resolveTarget(base, rel.target) || undefined : undefined
    }
    const layoutPath = find(rels, path, 'slideLayout')
    const layoutRels = layoutPath ? await this.rels(layoutPath) : new Map()
    const masterPath = layoutPath ? find(layoutRels, layoutPath, 'slideMaster') : undefined
    const masterRels = masterPath ? await this.rels(masterPath) : new Map()
    const themePath = masterPath ? find(masterRels, masterPath, 'theme') : undefined
    const layout = layoutPath ? await this.xml(layoutPath) : undefined
    const master = masterPath ? await this.xml(masterPath) : undefined
    const themeXml = themePath ? await this.xml(themePath) : undefined
    const ctx: ParseContext = {
      mediaRels: await this.mediaRels(path),
      chartXmls: new Map(),
      chartMediaRels: new Map(),
      hlinkRels: new Map(),
    }
    if (themeXml) {
      ctx.theme = parseTheme(themeXml)
      ctx.theme.clrMap = parseClrMap(
        master,
        layout,
        this.document.currentSlideXml(this.document.slides.findIndex((s) => s.path === path)),
      )
    }
    if (themePath) ctx.themeMediaRels = await this.mediaRels(themePath)
    if (layout && layoutPath) {
      ctx.layoutBg = layout
      ctx.layoutMediaRels = await this.mediaRels(layoutPath)
      ctx.layoutPlaceholders = parsePlaceholderMap(layout, ctx.theme, ctx.layoutMediaRels)
    }
    if (master && masterPath) {
      ctx.masterBg = master
      ctx.masterMediaRels = await this.mediaRels(masterPath)
      ctx.masterPlaceholders = parsePlaceholderMap(master, ctx.theme, ctx.masterMediaRels)
      ctx.masterTextStyles = parseMasterTextStyles(master, ctx.theme, ctx.masterMediaRels)
    }
    const presentation = await this.xml(this.document.presentationPath)
    if (presentation) {
      ctx.defaultTextStyle = parseDefaultTextStyle(presentation, ctx.theme)
      const size = /<p:sldSz\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/.exec(presentation)
      if (size && Number(size[1]) > 0 && Number(size[2]) > 0)
        this.size = { cx: Number(size[1]), cy: Number(size[2]) }
    }
    ctx.tableStyles = await this.xml('ppt/tableStyles.xml')
    for (const [id, rel] of rels) {
      if (rel.type.endsWith('/hyperlink')) ctx.hlinkRels!.set(id, rel.target)
      if (rel.external) continue
      const target = resolveTarget(path, rel.target)
      if (rel.type.endsWith('/chart') || rel.type.endsWith('/chartEx')) {
        const xml = await this.xml(target)
        if (xml) ctx.chartXmls!.set(id, xml)
        ctx.chartMediaRels!.set(id, await this.mediaRels(target))
      }
      if (rel.type.endsWith('/diagramData')) {
        ctx.diagramDatas ??= new Map()
        const xml = await this.xml(target)
        if (xml) ctx.diagramDatas.set(id, xml)
      }
    }
    const imageMaps = [
      ctx.mediaRels,
      ctx.layoutMediaRels,
      ctx.masterMediaRels,
      ctx.themeMediaRels,
      ...ctx.chartMediaRels!.values(),
    ]
    for (const map of imageMaps)
      if (map) for (const target of new Set(map.values())) await this.image(target)
    this.contexts.set(path, ctx)
    return ctx
  }

  async slide(index: number): Promise<VisualSlide> {
    const source = this.document.slides[index]
    if (!source) throw new Error('invalidPresentation')
    const key = `${source.path}:${this.document.revision}`
    const cached = this.cache.get(key)
    if (cached) return cached
    const ctx = await this.context(source.path)
    const xml = this.document.currentSlideXml(index)
    const model = parseSlide({ path: source.path, slideXml: xml, ctx })
    if (!model.masterSpHidden) {
      model.decorations = [
        ...(ctx.masterBg
          ? parseDecorations(ctx.masterBg, {
              ...ctx,
              mediaRels: ctx.masterMediaRels,
              layoutPlaceholders: undefined,
            })
          : []),
        ...(ctx.layoutBg
          ? parseDecorations(ctx.layoutBg, { ...ctx, mediaRels: ctx.layoutMediaRels })
          : []),
      ]
    }
    const canonical = this.canonical(xml)
    const editable = new Set(
      model.elements.flatMap((element, i) => (this.isEditable(element) ? [i] : [])),
    )
    if (!canonical) editable.clear()
    const tree = buildRenderSlide(model, this.size, {
      fitWidthPx: 960,
      slideNo: index + 1,
      media: (ref) => this.media.get(ref),
    })
    const result = { model, tree, size: this.size, editable }
    this.cache.clear()
    this.cache.set(key, result)
    return result
  }

  isEditable(element: SlideElement): boolean {
    return (
      !this.document.readOnly &&
      element.type !== 'passthrough' &&
      !/<mc:AlternateContent\b/.test(element.anchor.originalXml) &&
      !/<(?:a:fld|p:oleObj|am3d:model3d)\b/.test(element.anchor.originalXml)
    )
  }

  private remember(before: PresentationSnapshot): void {
    this.undoStates.push(before)
    const bytes = () =>
      this.undoStates.reduce(
        (sum, state) => sum + [...state.parts.values()].reduce((n, part) => n + part.length, 0),
        0,
      )
    while (
      this.undoStates.length > 20 ||
      (this.undoStates.length > 1 && bytes() > 32 * 1024 * 1024)
    )
      this.undoStates.shift()
    this.redoStates = []
    this.invalidate()
  }

  private invalidate(resources = false): void {
    this.cache.clear()
    if (resources) {
      this.contexts.clear()
      this.media.clear()
    }
  }

  private commit(updates: Map<string, string | Uint8Array>, paths?: string[]): void {
    const before = this.document.snapshot()
    this.document.editPackage(updates, paths)
    this.remember(before)
    if ([...updates.keys()].some((path) => path.endsWith('.rels') || /\/media\//.test(path)))
      this.invalidate(true)
  }

  apply(updates: Map<string, string | Uint8Array>): void {
    this.commit(updates)
  }

  undo(): void {
    const previous = this.undoStates.at(-1)
    if (!previous) return
    const current = this.document.snapshot()
    this.document.restore(previous)
    this.undoStates.pop()
    this.redoStates.push(current)
    this.invalidate(true)
  }

  redo(): void {
    const next = this.redoStates.at(-1)
    if (!next) return
    const current = this.document.snapshot()
    this.document.restore(next)
    this.redoStates.pop()
    this.undoStates.push(current)
    this.invalidate(true)
  }

  setRunText(slide: number, paragraph: number, run: number, text: string): void {
    const before = this.document.snapshot()
    if (this.document.setText(slide, paragraph, run, text)) this.remember(before)
  }

  runLocations(index: number, elementIndex: number): Array<{ paragraph: number; run: number }> {
    const slide = this.document.slides[index]
    const range = scanSlide(slide.originalXml).elements[elementIndex]
    if (!range) return []
    return slide.paragraphs.flatMap((p, paragraph) =>
      p.runs.flatMap((r, run) =>
        r.start >= range.start && r.end <= range.end ? [{ paragraph, run }] : [],
      ),
    )
  }

  private async element(
    index: number,
    elementIndex: number,
  ): Promise<{ visual: VisualSlide; element: SlideElement }> {
    const visual = await this.slide(index)
    const element = visual.model.elements[elementIndex]
    if (!element || !visual.editable.has(elementIndex)) throw new Error('readOnly')
    return { visual, element }
  }

  private patch(index: number, element: SlideElement, xml: string): void {
    const source = this.document.slides[index]
    const original = this.document.currentSlideXml(index)
    const [start, end] = element.anchor.range
    this.commit(new Map([[source.path, original.slice(0, start) + xml + original.slice(end)]]))
  }

  async transform(index: number, elementIndex: number, change: BoxChange): Promise<void> {
    const { element } = await this.element(index, elementIndex)
    const t: Transform = structuredClone(element.transform)
    for (const [key, value] of Object.entries(change)) {
      if (key === 'flipH' || key === 'flipV') continue
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 2147483647)
        throw new Error('invalidText')
    }
    const o = t.offset
    if (change.x !== undefined) o.x = Math.round(change.x)
    if (change.y !== undefined) o.y = Math.round(change.y)
    if (change.width !== undefined) o.cx = Math.max(12700, Math.round(change.width))
    if (change.height !== undefined) o.cy = Math.max(12700, Math.round(change.height))
    if (change.rotation !== undefined)
      t.rot = Math.round((((change.rotation % 360) + 360) % 360) * 60000)
    if (change.flipH !== undefined) t.flipH = change.flipH
    if (change.flipV !== undefined) t.flipV = change.flipV
    let xml = patchElementXfrm({ ...element, transform: t }, element.anchor.originalXml)
    if (element.type === 'table') {
      const width = element.colWidths.reduce((sum, value) => sum + value, 0)
      const height = element.rowHeights.reduce((sum, value) => sum + value, 0)
      if (change.width !== undefined && width > 0)
        xml = xml.replace(
          /(<a:gridCol\b[^>]*\bw=")(\d+)(")/g,
          (_all, start: string, value: string, end: string) =>
            `${start}${Math.max(1, Math.round((Number(value) * t.offset.cx) / width))}${end}`,
        )
      if (change.height !== undefined && height > 0)
        xml = xml.replace(
          /(<a:tr\b[^>]*\bh=")(\d+)(")/g,
          (_all, start: string, value: string, end: string) =>
            `${start}${Math.max(1, Math.round((Number(value) * t.offset.cy) / height))}${end}`,
        )
    }
    this.patch(index, element, xml)
  }

  async font(index: number, elementIndex: number, change: FontChange): Promise<void> {
    const { element } = await this.element(index, elementIndex)
    if (element.type !== 'text' && element.type !== 'shape') throw new Error('readOnly')
    if (
      change.fontSize !== undefined &&
      (!Number.isFinite(change.fontSize) || change.fontSize < 1 || change.fontSize > 4000)
    )
      throw new Error('invalidText')
    if (change.color !== undefined && !/^#[\da-f]{6}$/i.test(change.color))
      throw new Error('invalidText')
    if (
      change.fontFamily !== undefined &&
      (!change.fontFamily.trim() ||
        change.fontFamily.length > 100 ||
        /[<>"]/.test(change.fontFamily) ||
        [...change.fontFamily].some((char) => char.codePointAt(0)! < 32))
    )
      throw new Error('invalidText')
    const updated = structuredClone(element)
    for (const p of updated.text?.paragraphs ?? [])
      for (const run of p.runs) {
        if (change.bold !== undefined) {
          run.bold = change.bold
          run.boldImplicit = false
        }
        if (change.italic !== undefined) {
          run.italic = change.italic
          run.italicImplicit = false
        }
        if (change.underline !== undefined) {
          run.underline = change.underline
          run.underlineImplicit = false
          run.underlineStyle = 'sng'
          run.underlineExplicitNone = !change.underline
        }
        if (change.fontSize !== undefined) {
          run.fontSize = change.fontSize
          run.fontSizeImplicit = false
        }
        if (change.color !== undefined) {
          run.color = change.color
          delete run.colorInherited
          delete run.colorFollowsTheme
          delete run.colorNodeXml
        }
        if (change.fontFamily !== undefined) {
          run.fontFamily = change.fontFamily
          delete run.fontImplicit
          delete run.latinFont
          delete run.eaFont
          delete run.csFont
          delete run.latinFamily
        }
      }
    this.patch(index, element, patchTextElementXml(updated, element.anchor.originalXml))
  }

  async align(
    index: number,
    elementIndex: number,
    align: 'left' | 'center' | 'right',
  ): Promise<void> {
    const { element } = await this.element(index, elementIndex)
    if (element.type !== 'text' && element.type !== 'shape') throw new Error('readOnly')
    const updated = structuredClone(element)
    for (const p of updated.text?.paragraphs ?? []) p.align = align
    const xml = patchElementPPr(updated, element.anchor.originalXml, { align: true })
    if (!xml) throw new Error('readOnly')
    this.patch(index, element, xml)
  }

  async fill(index: number, elementIndex: number, color: string): Promise<void> {
    if (!/^#[\da-f]{6}$/i.test(color) && color !== 'none') throw new Error('invalidText')
    const { element } = await this.element(index, elementIndex)
    if (element.type !== 'text' && element.type !== 'shape') throw new Error('readOnly')
    this.patch(index, element, patchElementFill(element.anchor.originalXml, color))
  }

  async stroke(index: number, elementIndex: number, color: string, width: number): Promise<void> {
    if (!/^#[\da-f]{6}$/i.test(color) || !Number.isFinite(width) || width < 0 || width > 100)
      throw new Error('invalidText')
    const { element } = await this.element(index, elementIndex)
    if (element.type !== 'text' && element.type !== 'shape' && element.type !== 'picture')
      throw new Error('readOnly')
    this.patch(
      index,
      element,
      patchElementStroke(
        element.anchor.originalXml,
        width === 0 ? null : { color, widthEmu: Math.round(width * 12700) },
      ),
    )
  }

  async background(index: number, color: string): Promise<void> {
    if (!/^#[\da-f]{6}$/i.test(color)) throw new Error('invalidText')
    const { model } = await this.slide(index)
    if (!this.canonical(model.originalXml)) throw new Error('readOnly')
    const xml =
      patchSlideBackgroundXml(model.bodyPrefix, color) +
      model.elements.map((e) => e.anchor.originalXml + (e.anchor.gapAfter ?? '')).join('') +
      model.bodySuffix
    this.commit(new Map([[model.path, xml]]))
  }

  async removeElement(index: number, elementIndex: number): Promise<void> {
    const { element } = await this.element(index, elementIndex)
    // Timing/connector references cannot safely be removed without the full desktop graph editor.
    const xml = this.document.currentSlideXml(index)
    if (/<p:timing\b|<a:(?:stCxn|endCxn)\b/.test(xml)) throw new Error('readOnly')
    this.patch(index, element, '')
  }

  async zOrder(index: number, elementIndex: number, direction: -1 | 1): Promise<void> {
    const { visual } = await this.element(index, elementIndex)
    const elements = [...visual.model.elements]
    const target = elementIndex + direction
    if (target < 0 || target >= elements.length) return
    ;[elements[elementIndex], elements[target]] = [elements[target], elements[elementIndex]]
    const xml =
      visual.model.bodyPrefix +
      elements.map((e) => e.anchor.originalXml + (e.anchor.gapAfter ?? '')).join('') +
      visual.model.bodySuffix
    this.commit(new Map([[visual.model.path, xml]]))
  }

  private nextShapeId(model: Slide): number {
    return (
      Math.max(
        1,
        ...[...model.originalXml.matchAll(/<p:cNvPr\b[^>]*\bid="(\d+)"/g)].map((m) => Number(m[1])),
      ) + 1
    )
  }

  async insert(index: number, kind: 'text' | 'rect' | 'ellipse', text = ''): Promise<number> {
    const { model } = await this.slide(index)
    if (!this.canonical(model.originalXml)) throw new Error('readOnly')
    const id = this.nextShapeId(model)
    const x = Math.round(this.size.cx * 0.12),
      y = Math.round(this.size.cy * 0.15)
    const width = Math.round(this.size.cx * (kind === 'text' ? 0.65 : 0.3)),
      height = Math.round(this.size.cy * 0.22)
    const shape = `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${kind} ${id}"/><p:cNvSpPr${kind === 'text' ? ' txBox="1"' : ''}/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="${kind === 'text' ? 'rect' : kind}"><a:avLst/></a:prstGeom>${kind === 'text' ? '<a:noFill/>' : '<a:solidFill><a:srgbClr val="C43E1C"/></a:solidFill>'}<a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/><a:p><a:r><a:rPr sz="2400"><a:solidFill><a:srgbClr val="242424"/></a:solidFill></a:rPr><a:t>${escape(text)}</a:t></a:r></a:p></p:txBody></p:sp>`
    this.commit(
      new Map([
        [
          model.path,
          this.document.currentSlideXml(index).replace('</p:spTree>', shape + '</p:spTree>'),
        ],
      ]),
    )
    return model.elements.length
  }

  async insertTable(index: number, rows = 3, cols = 3): Promise<number> {
    if (
      !Number.isInteger(rows) ||
      !Number.isInteger(cols) ||
      rows < 1 ||
      cols < 1 ||
      rows > 20 ||
      cols > 20
    )
      throw new Error('presentationTooLarge')
    const { model } = await this.slide(index)
    if (!this.canonical(model.originalXml)) throw new Error('readOnly')
    const id = this.nextShapeId(model)
    const width = Math.round(this.size.cx * 0.7),
      height = Math.round(this.size.cy * 0.4)
    const offset = {
      x: Math.round(this.size.cx * 0.15),
      y: Math.round(this.size.cy * 0.2),
      cx: width,
      cy: height,
    }
    const grid = Array.from(
      { length: cols },
      () => `<a:gridCol w="${Math.round(width / cols)}"/>`,
    ).join('')
    const rowXml = Array.from(
      { length: rows },
      (_, row) =>
        `<a:tr h="${Math.round(height / rows)}">${Array.from({ length: cols }, () => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${generateParagraphXml({ runs: [{ text: '', fontSize: 20, color: row === 0 ? '#FFFFFF' : '#242424', bold: row === 0 }] })}</a:txBody><a:tcPr><a:solidFill><a:srgbClr val="${row === 0 ? 'C43E1C' : row % 2 ? 'F6F7F9' : 'FFFFFF'}"/></a:solidFill></a:tcPr></a:tc>`).join('')}</a:tr>`,
    ).join('')
    const table = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>${generateXfrmXml({ offset, rot: 0, flipH: false, flipV: false }, 'p:xfrm')}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${grid}</a:tblGrid>${rowXml}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
    this.commit(
      new Map([
        [
          model.path,
          this.document.currentSlideXml(index).replace('</p:spTree>', table + '</p:spTree>'),
        ],
      ]),
    )
    return model.elements.length
  }

  async insertImage(
    index: number,
    bytes: Uint8Array,
    extension: 'png' | 'jpg' | 'gif' | 'webp',
    pixelWidth: number,
    pixelHeight: number,
  ): Promise<number> {
    if (
      bytes.length > 8 * 1024 * 1024 ||
      bytes.length < 12 ||
      !Number.isFinite(pixelWidth) ||
      !Number.isFinite(pixelHeight) ||
      pixelWidth <= 0 ||
      pixelHeight <= 0
    )
      throw new Error('presentationTooLarge')
    const { model } = await this.slide(index)
    if (!this.canonical(model.originalXml)) throw new Error('readOnly')
    let number = 1
    while (this.document.hasPart(`ppt/media/ipadImage${number}.${extension}`)) number++
    const mediaPath = `ppt/media/ipadImage${number}.${extension}`
    const rels = await this.rels(model.path)
    let relId = 1
    while (rels.has(`rId${relId}`)) relId++
    const relationship = `<Relationship Id="rId${relId}" Type="${R}/image" Target="../media/ipadImage${number}.${extension}"/>`
    const originalRels =
      (await this.xml(relsPath(model.path))) ??
      `<Relationships xmlns="${PACKAGE_R}"></Relationships>`
    const width = Math.round(this.size.cx * 0.45)
    const height = Math.min(
      Math.round((width * pixelHeight) / pixelWidth),
      Math.round(this.size.cy * 0.7),
    )
    const adjustedWidth = Math.round((height * pixelWidth) / pixelHeight)
    const id = this.nextShapeId(model)
    const picture = `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Image ${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId${relId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${Math.round((this.size.cx - adjustedWidth) / 2)}" y="${Math.round((this.size.cy - height) / 2)}"/><a:ext cx="${adjustedWidth}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
    const contentTypes = await this.xml('[Content_Types].xml')
    if (!contentTypes) throw new Error('invalidPresentation')
    const mime = extension === 'jpg' ? 'image/jpeg' : `image/${extension}`
    const updatedTypes = contentTypes.includes(`Extension="${extension}"`)
      ? contentTypes
      : contentTypes.replace(
          '</Types>',
          `<Default Extension="${extension}" ContentType="${mime}"/></Types>`,
        )
    this.commit(
      new Map<string, string | Uint8Array>([
        [
          model.path,
          this.document.currentSlideXml(index).replace('</p:spTree>', picture + '</p:spTree>'),
        ],
        [
          relsPath(model.path),
          originalRels.replace('</Relationships>', relationship + '</Relationships>'),
        ],
        [mediaPath, bytes],
        ['[Content_Types].xml', updatedTypes],
      ]),
    )
    return model.elements.length
  }

  private async slideRecords(): Promise<{
    xml: string
    records: Array<{ xml: string; path: string; rid: string }>
  }> {
    const xml = await this.xml(this.document.presentationPath)
    if (!xml) throw new Error('invalidPresentation')
    const rels = await this.rels(this.document.presentationPath)
    const records = [...xml.matchAll(/<p:sldId\b[^>]*\/>/g)].map((m) => {
      const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1] ?? ''
      const rel = rels.get(rid)
      return {
        xml: m[0],
        rid,
        path: rel ? resolveTarget(this.document.presentationPath, rel.target) : '',
      }
    })
    if (records.length !== this.document.slides.length || records.some((r) => !r.path))
      throw new Error('readOnly')
    return { xml, records }
  }

  async reorder(index: number, target: number): Promise<void> {
    const { xml, records } = await this.slideRecords()
    if (/<p14:sectionLst\b/.test(xml)) throw new Error('readOnly')
    if (target < 0 || target >= records.length || index === target) return
    const [record] = records.splice(index, 1)
    records.splice(target, 0, record)
    const content = records.map((r) => r.xml).join('')
    this.commit(
      new Map([
        [
          this.document.presentationPath,
          xml.replace(/(<p:sldIdLst\b[^>]*>)[\s\S]*?(<\/p:sldIdLst>)/, `$1${content}$2`),
        ],
      ]),
      records.map((r) => r.path),
    )
  }

  async deleteSlide(index: number): Promise<void> {
    const { xml, records } = await this.slideRecords()
    if (records.length < 2) throw new Error('readOnly')
    const removed = records[index]
    // Internal slide jumps and sections need desktop graph cleanup; keep that deck read only for deletion.
    for (const slide of this.document.slides)
      for (const rel of (await this.rels(slide.path)).values())
        if (rel.type.endsWith('/slide') && resolveTarget(slide.path, rel.target) === removed.path)
          throw new Error('readOnly')
    if (/<p14:sectionLst\b|<p:custShowLst\b/.test(xml)) throw new Error('readOnly')
    records.splice(index, 1)
    const originalRels = await this.xml(relsPath(this.document.presentationPath))
    const updatedRels = originalRels?.replace(/<Relationship\b[^>]*\/>/g, (match) =>
      new RegExp(`\\bId="${removed.rid}"`).test(match) ? '' : match,
    )
    if (!updatedRels) throw new Error('invalidPresentation')
    this.commit(
      new Map([
        [this.document.presentationPath, xml.replace(removed.xml, '')],
        [relsPath(this.document.presentationPath), updatedRels],
      ]),
      records.map((r) => r.path),
    )
  }

  async addSlide(index: number, duplicate = false): Promise<number> {
    const { xml, records } = await this.slideRecords()
    if (/<p14:sectionLst\b/.test(xml)) throw new Error('readOnly')
    const source = this.document.slides[index]
    if (!source) throw new Error('invalidPresentation')
    const sourceXml = this.document.currentSlideXml(index)
    if (!this.canonical(sourceXml)) throw new Error('readOnly')
    if (duplicate && /<p:(?:timing|cmLst)\b|<a:videoFile\b|<p:oleObj\b/.test(sourceXml))
      throw new Error('readOnly')
    let number = 1
    while (this.document.hasPart(`ppt/slides/slide${number}.xml`)) number++
    const path = `ppt/slides/slide${number}.xml`
    const rels = await this.rels(this.document.presentationPath)
    let rid = 1
    while (rels.has(`rId${rid}`)) rid++
    const maxId = Math.max(
      255,
      ...records.map((r) => Number(/\bid="(\d+)"/.exec(r.xml)?.[1] ?? 255)),
    )
    if (maxId >= 2147483647) throw new Error('presentationTooLarge')
    const record = { path, rid: `rId${rid}`, xml: `<p:sldId id="${maxId + 1}" r:id="rId${rid}"/>` }
    records.splice(index + 1, 0, record)
    let root = '',
      background = '',
      clrMap = ''
    scanXml(sourceXml, (tag, ancestors, contentEnd) => {
      const fragment = () =>
        sourceXml.slice(
          tag.start,
          tag.selfClosing ? tag.contentStart : sourceXml.indexOf('>', contentEnd) + 1,
        )
      if (tag.local === 'sld' && ancestors.length === 0)
        root = sourceXml
          .slice(tag.start, tag.contentStart)
          .replace(/\sshow=(?:"[^"]*"|'[^']*')/, '')
      if (tag.local === 'bg' && ancestors.at(-1)?.local === 'cSld') background = fragment()
      if (tag.local === 'clrMapOvr' && ancestors.at(-1)?.local === 'sld') clrMap = fragment()
    })
    if (!root) throw new Error('invalidPresentation')
    const blank = `${root}<p:cSld>${background}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>${clrMap}</p:sld>`
    const slideXml = duplicate ? sourceXml : blank
    const sourceRels =
      (await this.xml(relsPath(source.path))) ??
      `<Relationships xmlns="${PACKAGE_R}"></Relationships>`
    if (duplicate && /Type="[^"]*\/(?:notesSlide|comments|commentAuthors)"/.test(sourceRels))
      throw new Error('readOnly')
    // Shared resources keep their paths. Notes/comments are slide-owned and cannot be shared.
    const newRels = sourceRels.replace(/<Relationship\b[^>]*\/>/g, (match) =>
      /Type="[^"]*\/(?:notesSlide|comments|commentAuthors)"/.test(match) ? '' : match,
    )
    const presRels = await this.xml(relsPath(this.document.presentationPath))
    const types = await this.xml('[Content_Types].xml')
    if (!presRels || !types) throw new Error('invalidPresentation')
    const relationship = `<Relationship Id="rId${rid}" Type="${R}/slide" Target="slides/slide${number}.xml"/>`
    const nextPresentation = xml.replace(
      /(<p:sldIdLst\b[^>]*>)[\s\S]*?(<\/p:sldIdLst>)/,
      `$1${records.map((r) => r.xml).join('')}$2`,
    )
    this.commit(
      new Map([
        [path, slideXml],
        [relsPath(path), newRels],
        [this.document.presentationPath, nextPresentation],
        [
          relsPath(this.document.presentationPath),
          presRels.replace('</Relationships>', relationship + '</Relationships>'),
        ],
        [
          '[Content_Types].xml',
          types.replace(
            '</Types>',
            `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`,
          ),
        ],
      ]),
      records.map((r) => r.path),
    )
    return index + 1
  }
}
