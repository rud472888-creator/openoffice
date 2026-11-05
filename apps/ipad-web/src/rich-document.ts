import {
  assertZipInflatesWithinLimits,
  saveDocx,
  readSections,
  applySectionSettings,
  type SaveOptions,
  type SectionSettings,
  type ParsedDocFull,
} from '@genoffice/docx-engine'
import {
  blocksToPmDoc,
  pmDocOptions,
  pmDocToSavePlan,
  type PmNode,
} from '../../docs/src/renderer/editor/convert'
import { applySectPrRewrites, type SectPrRewrite } from '../../docs/src/renderer/sectpr-rewrite'
import { saveOdt, type BridgeMap, type ConversionReport } from '@genoffice/odt-engine'
import { WordDocument, MAX_DOCUMENT_BYTES, DOCUMENT_ZIP_LIMITS } from './document'

function signature(node: PmNode): string {
  return JSON.stringify(node)
}

function assertXmlScalars(value: unknown): void {
  if (typeof value === 'string') {
    for (const character of value) {
      const code = character.codePointAt(0)!
      if (
        (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
        code === 0xfffe ||
        code === 0xffff ||
        (code >= 0xd800 && code <= 0xdfff)
      )
        throw new Error('cannotSave')
    }
  } else if (Array.isArray(value)) value.forEach(assertXmlScalars)
  else if (value && typeof value === 'object') Object.values(value).forEach(assertXmlScalars)
}

export interface OdtBaseline {
  original: Uint8Array
  bridge: BridgeMap
  report: ConversionReport
  signed: boolean
}

/** Shares the desktop editor's schema conversion and original-block save planner. */
export class RichWordDocument {
  readonly parsed: ParsedDocFull
  readonly initialContent: PmNode
  readonly lockedIndexes: Set<number>
  readonly readOnly: boolean
  readonly options: SaveOptions = {}
  previewPageCount?: number
  readonly sectionChanges = new Map<number, SectionSettings>()
  private temporarilyUnlocked = new Set<number>()
  private locked = new Map<number, string>()
  private baseline: string

  constructor(
    readonly source: WordDocument,
    readonly odt?: OdtBaseline,
    readonly legacy?: { docx: Uint8Array; warnings: string[] },
  ) {
    this.parsed = source.parsed
    this.initialContent = blocksToPmDoc(
      this.parsed.blocks,
      readSections(this.parsed),
      pmDocOptions(this.parsed),
    )
    this.baseline = signature(this.initialContent)
    this.readOnly = !!(
      legacy ||
      source.signed ||
      odt?.signed ||
      this.parsed.protection?.enforced ||
      this.parsed.writeProtection?.hash
    )
    this.lockedIndexes = new Set()
    let fieldDepth = 0
    for (const block of this.parsed.blocks) {
      if (block.hidden || block.docxIndex === null) continue
      const xml = block.originalXml ?? ''
      const insideField = fieldDepth > 0
      for (const match of xml.matchAll(
        /<w:fldChar\b[^>]*w:fldCharType\s*=\s*["'](begin|end)["'][^>]*>/g,
      ))
        fieldDepth = match[1] === 'begin' ? fieldDepth + 1 : Math.max(0, fieldDepth - 1)
      if (block.type === 'image') continue
      if (
        insideField ||
        block.sdtShell ||
        !['paragraph', 'heading', 'listItem', 'table', 'image'].includes(block.type) ||
        /<(?:w:(?:fldChar|fldSimple|instrText|delInstrText|sdt|drawing|pict|object|txbxContent|ruby|altChunk)|m:[\w]+)(?=[\s/>])/.test(
          xml,
        ) ||
        /<!|<\?/.test(xml)
      )
        this.lockedIndexes.add(block.docxIndex)
    }
    this.setBaseline(this.initialContent)
  }

  /** TipTap fills schema defaults; compare against its normalized initial representation. */
  setBaseline(doc: PmNode): void {
    this.baseline = signature(doc)
    this.locked.clear()
    for (const node of doc.content ?? []) {
      const index = node.attrs?.docxIndex
      if (typeof index === 'number' && this.lockedIndexes.has(index))
        this.locked.set(index, signature(node))
    }
  }

  canEdit(doc: PmNode): boolean {
    const current = new Map<number, string>()
    let validText = true
    const scan = (node: PmNode): void => {
      if (node.text) {
        for (const character of node.text) {
          const code = character.codePointAt(0)!
          if (
            (code < 32 && code !== 9) ||
            code === 0xfffe ||
            code === 0xffff ||
            (code >= 0xd800 && code <= 0xdfff)
          )
            validText = false
        }
      }
      node.content?.forEach(scan)
    }
    scan(doc)
    if (!validText) return false
    for (const node of doc.content ?? []) {
      const index = node.attrs?.docxIndex
      if (typeof index !== 'number' || !this.locked.has(index)) continue
      if (current.has(index)) return false
      current.set(index, signature(node))
    }
    return [...this.locked].every(
      ([index, original]) => this.temporarilyUnlocked.has(index) || current.get(index) === original,
    )
  }

  /** A dedicated field operation may replace only its explicitly selected originals. */
  replaceProtectedBlocks(indexes: number[], action: () => boolean, current: () => PmNode): boolean {
    this.temporarilyUnlocked = new Set(indexes)
    try {
      const changed = action()
      const retained = new Set((current().content ?? []).map((node) => node.attrs?.docxIndex))
      for (const index of indexes)
        if (!retained.has(index)) {
          this.locked.delete(index)
          this.lockedIndexes.delete(index)
        }
      return changed
    } finally {
      this.temporarilyUnlocked.clear()
    }
  }

  isDirty(doc: PmNode): boolean {
    return (
      signature(doc) !== this.baseline ||
      Object.keys(this.options).length > 0 ||
      this.sectionChanges.size > 0
    )
  }

  async save(doc: PmNode): Promise<Uint8Array> {
    if (this.legacy) throw new Error('cannotSave')
    if (!this.isDirty(doc)) return this.odt?.original ?? this.parsed.internal.originalBytes
    if (this.readOnly || !this.canEdit(doc)) throw new Error('readOnly')
    assertXmlScalars(doc)
    assertXmlScalars(this.options)
    const plan = pmDocToSavePlan(doc, this.parsed.blocks)
    // Charts stay protected until their dedicated editing/save-options path is ported.
    if (plan.chartPatches.length) throw new Error('readOnly')
    const sections = readSections(this.parsed)
    const rewrites = new Map<number, SectPrRewrite>()
    const options = structuredClone(this.options)
    if (this.previewPageCount) options.pageCount = this.previewPageCount
    for (const [index, settings] of this.sectionChanges) {
      const section = sections[index]
      if (!section) continue
      if (index === sections.length - 1) options.section = settings
      else {
        const block = this.parsed.blocks.find((block) => block.docxIndex === section.lastBlockIndex)
        if (block?.originalXml)
          rewrites.set(section.lastBlockIndex, {
            from: section.sectPrXml,
            to: applySectionSettings(section.sectPrXml, settings),
            originalXml: block.originalXml,
          })
      }
    }
    const saveBlocks = applySectPrRewrites(plan.saveBlocks, plan.saveBlockIndexByDocx, rewrites)
    const docx = await saveDocx(this.parsed, saveBlocks, options)
    if (docx.byteLength > MAX_DOCUMENT_BYTES) throw new Error('documentTooLarge')
    await assertZipInflatesWithinLimits(docx, DOCUMENT_ZIP_LIMITS)
    const saved = this.odt
      ? await saveOdt({ originalOdt: this.odt.original, bridge: this.odt.bridge, editedDocx: docx })
      : docx
    if (saved.byteLength > MAX_DOCUMENT_BYTES) throw new Error('documentTooLarge')
    await assertZipInflatesWithinLimits(saved, DOCUMENT_ZIP_LIMITS)
    return saved
  }
}
