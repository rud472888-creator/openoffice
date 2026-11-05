import JSZip from 'jszip'
import { XMLValidator } from 'fast-xml-parser'
import { assertZipInflatesWithinLimits } from '@genoffice/zip-gate'

// Mobile budgets apply before JSZip or any XML parser receives the archive.
export const MAX_PRESENTATION_BYTES = 32 * 1024 * 1024
export const PRESENTATION_ZIP_LIMITS = {
  maxParts: 5000,
  maxPartBytes: 16 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
}
const DRAWING = new Set([
  'http://schemas.openxmlformats.org/drawingml/2006/main',
  'http://purl.oclc.org/ooxml/drawingml/main',
])
const PRESENTATION = new Set([
  'http://schemas.openxmlformats.org/presentationml/2006/main',
  'http://purl.oclc.org/ooxml/presentationml/main',
])
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'
const decoder = new TextDecoder('utf-8', { fatal: true })
const encoder = new TextEncoder()

export function assertValidText(value: string): void {
  if (value.length > 100000) throw new Error('presentationTooLarge')
  for (const character of value) {
    const point = character.codePointAt(0)!
    if (
      (point < 0x20 && point !== 9 && point !== 10 && point !== 13) ||
      point === 0xfffe ||
      point === 0xffff ||
      (point >= 0xd800 && point <= 0xdfff)
    )
      throw new Error('invalidText')
  }
}

export interface TextRun {
  originalText: string
  text: string
  start: number
  end: number
  editable: boolean
}

export interface TextParagraph {
  runs: TextRun[]
}
export interface PresentationSlide {
  path: string
  originalXml: string
  paragraphs: TextParagraph[]
}
interface XmlTag {
  local: string
  uri: string
  attrs: Record<string, string>
  namespaces: Record<string, string>
  start: number
  contentStart: number
  selfClosing: boolean
  paragraph?: TextParagraph
}

function decodeText(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, entity: string) => {
    if (entity[0] === '#')
      return String.fromCodePoint(
        entity[1].toLowerCase() === 'x'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10),
      )
    return (
      ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[entity] ??
      whole
    )
  })
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r/g, '&#13;')
}

/** Scan original XML offsets; never serialize slide shapes, formatting, or relationships. */
export function scanXml(
  xml: string,
  visit: (tag: XmlTag, ancestors: XmlTag[], contentEnd: number) => void,
): void {
  if (xml.length > 8 * 1024 * 1024) throw new Error('presentationTooLarge')
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
    throw new Error('invalidPresentation')
  const tokens =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?[\w:.-]+(?:[^<>"']|"[^"]*"|'[^']*')*?>/g
  const stack: XmlTag[] = []
  let count = 0
  for (const match of xml.matchAll(tokens)) {
    const token = match[0]
    if (token.startsWith('<?') || token.startsWith('<!')) continue
    if (token.startsWith('</')) {
      const tag = stack.pop()
      if (!tag) throw new Error('invalidPresentation')
      visit(tag, stack, match.index!)
      continue
    }
    if (++count > 100000 || stack.length >= 128) throw new Error('presentationTooLarge')
    const qname = /^<([\w:.-]+)/.exec(token)![1]
    const attrs: Record<string, string> = {}
    const namespaces = { ...(stack.at(-1)?.namespaces ?? {}) }
    let attributeCount = 0
    for (const attr of token.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      if (++attributeCount > 256) throw new Error('presentationTooLarge')
      const value = decodeText(attr[2] ?? attr[3])
      attrs[attr[1]] = value
      if (attr[1] === 'xmlns') namespaces[''] = value
      else if (attr[1].startsWith('xmlns:')) namespaces[attr[1].slice(6)] = value
    }
    if (Object.keys(namespaces).length > 128) throw new Error('presentationTooLarge')
    const split = qname.indexOf(':')
    const local = split < 0 ? qname : qname.slice(split + 1)
    const uri = namespaces[split < 0 ? '' : qname.slice(0, split)] ?? ''
    const tag: XmlTag = {
      local,
      uri,
      attrs,
      namespaces,
      start: match.index!,
      contentStart: match.index! + token.length,
      selfClosing: token.endsWith('/>'),
    }
    if (DRAWING.has(uri) && local === 'p') tag.paragraph = { runs: [] }
    if (token.endsWith('/>')) visit(tag, stack, tag.contentStart)
    else stack.push(tag)
  }
  if (stack.length) throw new Error('invalidPresentation')
}

function textPart(bytes: Uint8Array | undefined): string {
  if (!bytes) throw new Error('invalidPresentation')
  try {
    return decoder.decode(bytes)
  } catch {
    throw new Error('invalidPresentation')
  }
}

// Same safe relationship resolution policy as the desktop PPTX package reader.
export function resolveTarget(base: string, target: string): string {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) return ''
  let normalized: string
  try {
    normalized = decodeURIComponent(target).replace(/\\/g, '/')
  } catch {
    return ''
  }
  const parts = normalized.startsWith('/') ? [] : base.split('/').slice(0, -1)
  for (const part of normalized.split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  return parts.join('/')
}

export function relsPath(path: string): string {
  const pieces = path.split('/')
  return [...pieces.slice(0, -1), '_rels', `${pieces.at(-1)}.rels`].join('/')
}

export function relationships(
  xml: string,
): Map<string, { type: string; target: string; external: boolean }> {
  const result = new Map<string, { type: string; target: string; external: boolean }>()
  scanXml(xml, (tag) => {
    if (tag.local === 'Relationship')
      result.set(tag.attrs.Id, {
        type: tag.attrs.Type ?? '',
        target: tag.attrs.Target ?? '',
        external: tag.attrs.TargetMode === 'External',
      })
  })
  return result
}

/** JSZip merges duplicate names; reject ambiguous packages before that information is lost. */
function assertUniqueEntries(bytes: Uint8Array): { total: number; sizes: Map<string, number> } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = bytes.length - 22
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--
  if (end < 0) throw new Error('invalidPresentation')
  const count = view.getUint16(end + 10, true)
  let offset = view.getUint32(end + 16, true)
  const names = new Set<string>()
  let total = 0
  const sizes = new Map<string, number>()
  for (let i = 0; i < count; i++) {
    const nameLength = view.getUint16(offset + 28, true)
    const raw = bytes.subarray(offset + 46, offset + 46 + nameLength)
    const key = Array.from(raw, (byte) => String.fromCharCode(byte)).join('')
    if (names.has(key)) throw new Error('invalidPresentation')
    names.add(key)
    const size = view.getUint32(offset + 24, true)
    total += size
    sizes.set(new TextDecoder().decode(raw), size)
    const local = view.getUint32(offset + 42, true)
    if (view.getUint16(local + 6, true) & 1) throw new Error('encryptedPresentation')
    const localLength = view.getUint16(local + 26, true)
    if (
      localLength !== nameLength ||
      !raw.every((value, index) => value === bytes[local + 30 + index])
    )
      throw new Error('invalidPresentation')
    offset +=
      46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true)
  }
  return { total, sizes }
}

function parseSlide(path: string, xml: string, readOnly: boolean): PresentationSlide {
  const paragraphs: TextParagraph[] = []
  let runs = 0
  scanXml(xml, (tag, ancestors, contentEnd) => {
    if (tag.paragraph && tag.paragraph.runs.length) paragraphs.push(tag.paragraph)
    if (!DRAWING.has(tag.uri) || tag.local !== 't') return
    const paragraph = [...ancestors].reverse().find((a) => a.paragraph)?.paragraph
    if (!paragraph) return
    const raw = xml.slice(tag.contentStart, contentEnd)
    if (raw.length > 100000 || ++runs > 2000) throw new Error('presentationTooLarge')
    const run = ancestors.at(-1)
    const body = ancestors.some(
      (a) => a.local === 'txBody' && (DRAWING.has(a.uri) || PRESENTATION.has(a.uri)),
    )
    const alternate = ancestors.some((a) => a.uri === MC && a.local === 'AlternateContent')
    // Fields, AlternateContent, CDATA and unsupported text containers stay opaque.
    const editable =
      !readOnly &&
      body &&
      !!run &&
      DRAWING.has(run.uri) &&
      run.local === 'r' &&
      !alternate &&
      !raw.includes('<') &&
      !tag.selfClosing
    const text = raw.startsWith('<![CDATA[') ? raw.slice(9, -3) : decodeText(raw)
    paragraph.runs.push({
      originalText: text,
      text,
      start: tag.contentStart,
      end: contentEnd,
      editable,
    })
  })
  return { path, originalXml: xml, paragraphs }
}

export class PresentationDocument {
  revision = 0
  private overrides = new Map<string, Uint8Array>()
  private originalSlides = new Map<string, PresentationSlide>()
  private constructor(
    readonly name: string,
    readonly originalBytes: Uint8Array,
    readonly archive: JSZip,
    readonly slides: PresentationSlide[],
    readonly readOnly: boolean,
    private readonly totalInflatedBytes: number,
    private readonly originalSizes: Map<string, number>,
    readonly presentationPath: string,
  ) {
    this.originalSlides = new Map(slides.map((slide) => [slide.path, slide]))
  }

  static async open(bytes: Uint8Array, name: string): Promise<PresentationDocument> {
    if (bytes.byteLength > MAX_PRESENTATION_BYTES) throw new Error('presentationTooLarge')
    if (bytes[0] === 0xd0 && bytes[1] === 0xcf) throw new Error('encryptedPresentation')
    try {
      await assertZipInflatesWithinLimits(bytes, PRESENTATION_ZIP_LIMITS)
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message.includes('encrypted')) throw new Error('encryptedPresentation', { cause: error })
      if (
        message.includes('exceeds') ||
        message.includes('inflates past') ||
        message.includes('(limit ')
      )
        throw new Error('presentationTooLarge', { cause: error })
      throw new Error('invalidPresentation', { cause: error })
    }
    const { total: totalInflatedBytes, sizes } = assertUniqueEntries(bytes)
    const archive = await JSZip.loadAsync(bytes, { checkCRC32: true })
    for (const file of Object.values(archive.files)) {
      if (
        (file as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName &&
        (file as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName !==
          file.name
      )
        throw new Error('invalidPresentation')
    }
    const read = async (path: string): Promise<string> =>
      textPart(await archive.file(path)?.async('uint8array'))
    const rootRels = relationships(await read('_rels/.rels'))
    const officeRel = [...rootRels.values()].find(
      (r) => r.type.endsWith('/officeDocument') && !r.external,
    )
    if (!officeRel) throw new Error('invalidPresentation')
    const presentationPath = resolveTarget('', officeRel.target)
    const presentationXml = await read(presentationPath)
    const presentationRels = relationships(await read(relsPath(presentationPath)))
    const ids: string[] = []
    let readOnly = Object.keys(archive.files).some((path) => path.startsWith('_xmlsignatures/'))
    scanXml(presentationXml, (tag) => {
      if (!PRESENTATION.has(tag.uri)) return
      if (tag.local === 'modifyVerifier') readOnly = true
      if (tag.local === 'sldId') {
        const id = Object.entries(tag.attrs).find(([name]) => name.endsWith(':id'))?.[1]
        if (id) ids.push(id)
      }
    })
    if (ids.length > 1000) throw new Error('presentationTooLarge')
    const slides: PresentationSlide[] = []
    const paths = new Set<string>()
    let runCount = 0
    for (const id of ids) {
      const rel = presentationRels.get(id)
      if (!rel || rel.external || !rel.type.endsWith('/slide'))
        throw new Error('invalidPresentation')
      const path = resolveTarget(presentationPath, rel.target)
      if (!path || paths.has(path)) throw new Error('invalidPresentation')
      paths.add(path)
      const slide = parseSlide(path, await read(path), readOnly)
      runCount += slide.paragraphs.reduce((sum, p) => sum + p.runs.length, 0)
      if (runCount > 20000) throw new Error('presentationTooLarge')
      slides.push(slide)
    }
    return new PresentationDocument(
      name,
      bytes,
      archive,
      slides,
      readOnly,
      totalInflatedBytes,
      sizes,
      presentationPath,
    )
  }

  get dirty(): boolean {
    return (
      this.overrides.size > 0 ||
      this.slides.some((slide) =>
        slide.paragraphs.some((p) => p.runs.some((r) => r.text !== r.originalText)),
      )
    )
  }

  currentSlideXml(index: number): string {
    const slide = this.slides[index]
    if (!slide) throw new Error('invalidPresentation')
    let xml = slide.originalXml
    const changed = slide.paragraphs.flatMap((p) => p.runs).filter((r) => r.text !== r.originalText)
    for (const run of changed.sort((a, b) => b.start - a.start)) {
      if (!run.editable) throw new Error('readOnly')
      xml = xml.slice(0, run.start) + escapeText(run.text) + xml.slice(run.end)
    }
    return xml
  }

  async readPart(path: string): Promise<Uint8Array | undefined> {
    return this.overrides.get(path) ?? this.archive.file(path)?.async('uint8array')
  }

  async readXml(path: string): Promise<string | undefined> {
    const bytes = await this.readPart(path)
    return bytes ? textPart(bytes) : undefined
  }

  hasPart(path: string): boolean {
    return this.overrides.has(path) || !!this.archive.file(path)
  }

  partPaths(): string[] {
    return [
      ...new Set([
        ...Object.keys(this.archive.files).filter((path) => !this.archive.files[path].dir),
        ...this.overrides.keys(),
      ]),
    ]
  }

  snapshot(): PresentationSnapshot {
    const parts = new Map(this.overrides)
    this.slides.forEach((slide, index) => {
      const xml = this.currentSlideXml(index)
      if (xml !== slide.originalXml) parts.set(slide.path, encoder.encode(xml))
    })
    return { parts, slidePaths: this.slides.map((slide) => slide.path) }
  }

  /** One validated, reversible package transaction; original archive buffers are never mutated. */
  editPackage(updates: Map<string, string | Uint8Array>, slidePaths?: string[]): void {
    const state = this.snapshot()
    for (const [path, value] of updates)
      state.parts.set(path, typeof value === 'string' ? encoder.encode(value) : value.slice())
    if (slidePaths) state.slidePaths = [...slidePaths]
    this.restore(state)
  }

  restore(state: PresentationSnapshot): void {
    if (this.readOnly) throw new Error('readOnly')
    if (
      !state.slidePaths.length ||
      state.slidePaths.length > 1000 ||
      new Set(state.slidePaths).size !== state.slidePaths.length
    )
      throw new Error('invalidPresentation')
    let total = this.totalInflatedBytes
    for (const [path, bytes] of state.parts) {
      if (
        !path ||
        path.split('/').some((piece) => piece === '..') ||
        bytes.byteLength > PRESENTATION_ZIP_LIMITS.maxPartBytes
      )
        throw new Error('presentationTooLarge')
      total += bytes.byteLength - (this.originalSizes.get(path) ?? 0)
      if (path.endsWith('.xml') || path.endsWith('.rels')) scanXml(textPart(bytes), () => {})
    }
    if (
      total > PRESENTATION_ZIP_LIMITS.maxTotalBytes ||
      new Set([...Object.keys(this.archive.files), ...state.parts.keys()]).size >
        PRESENTATION_ZIP_LIMITS.maxParts
    )
      throw new Error('presentationTooLarge')
    let runs = 0
    const slides = state.slidePaths.map((path) => {
      const original = this.originalSlides.get(path)
      const xml = state.parts.get(path)
      if (!xml && !original) throw new Error('invalidPresentation')
      const slide = parseSlide(path, xml ? textPart(xml) : original!.originalXml, this.readOnly)
      runs += slide.paragraphs.reduce((sum, p) => sum + p.runs.length, 0)
      return slide
    })
    if (runs > 20000) throw new Error('presentationTooLarge')
    this.overrides = new Map(state.parts)
    this.slides.splice(0, this.slides.length, ...slides)
    this.revision++
  }

  setText(slide: number, paragraph: number, run: number, value: string): boolean {
    const entry = this.slides[slide]?.paragraphs[paragraph]?.runs[run]
    if (!entry?.editable) throw new Error('readOnly')
    // Paragraph structure remains in the original XML; each control edits exactly one run.
    assertValidText(value)
    if (entry.text === value) return false
    entry.text = value
    this.revision++
    return true
  }

  /** Snapshot XML before awaiting compression, so native receives the matching revision. */
  async save(): Promise<{ bytes: Uint8Array; revision: number }> {
    const revision = this.revision
    if (!this.dirty) return { bytes: this.originalBytes, revision }
    if (this.readOnly) throw new Error('readOnly')
    const replacements = new Map(this.snapshot().parts)
    let totalBytes = this.totalInflatedBytes
    for (const [index, slide] of this.slides.entries()) {
      const changed = slide.paragraphs
        .flatMap((p) => p.runs)
        .filter((r) => r.text !== r.originalText)
      if (!changed.length) continue
      const xml = this.currentSlideXml(index)
      const bytes = encoder.encode(xml)
      if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('presentationTooLarge')
      replacements.set(slide.path, bytes)
    }
    for (const [path, bytes] of replacements)
      totalBytes += bytes.byteLength - (this.originalSizes.get(path) ?? 0)
    if (totalBytes > PRESENTATION_ZIP_LIMITS.maxTotalBytes) throw new Error('presentationTooLarge')
    const output = new JSZip()
    for (const file of Object.values(this.archive.files)) {
      output.file(
        file.name,
        replacements.get(file.name) ?? (file.dir ? new Uint8Array() : file.async('uint8array')),
        {
          dir: file.dir,
          date: file.date,
          comment: file.comment,
          unixPermissions: file.unixPermissions,
          dosPermissions: file.dosPermissions,
          createFolders: false,
        },
      )
    }
    for (const [path, bytes] of replacements)
      if (!this.archive.file(path)) output.file(path, bytes, { createFolders: false })
    const bytes = await output.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
      comment: (this.archive as JSZip & { comment?: string }).comment,
    })
    if (bytes.byteLength > MAX_PRESENTATION_BYTES) throw new Error('presentationTooLarge')
    return { bytes, revision }
  }
}

export interface PresentationSnapshot {
  parts: Map<string, Uint8Array>
  slidePaths: string[]
}

export function decodeBase64(value: string): Uint8Array {
  if (value.length > Math.ceil(MAX_PRESENTATION_BYTES / 3) * 4)
    throw new Error('presentationTooLarge')
  try {
    return Uint8Array.from(atob(value), (c) => c.charCodeAt(0))
  } catch {
    throw new Error('invalidPresentation')
  }
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
  return btoa(binary)
}
