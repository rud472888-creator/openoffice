import JSZip from 'jszip'
import {
  assertZipInflatesWithinLimits,
  decodeEntities,
  parseDocx,
  saveDocx,
  type ParsedDocFull,
  type SaveBlock,
} from '@genoffice/docx-engine'
import { patchParagraphTexts } from '../../../packages/docx-engine/src/text-patch'

export const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024
export const DOCUMENT_ZIP_LIMITS = {
  maxParts: 5000,
  maxPartBytes: 16 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
}

export interface EditableParagraph {
  originalXml: string
  originalText: string
  text: string
  editable: boolean
}

export interface DocumentPart {
  docxIndex: number
  originalXml: string
  table: boolean
  heading: boolean
  paragraphs: EditableParagraph[]
}

/** Keep structural, field and revision content opaque; its text is never rewritten. */
const COMPLEX_CONTENT =
  /<(?:w:(?:fldChar|fldSimple|instrText|delInstrText|delText|ins|del|moveFrom|moveTo|sdt|drawing|pict|object|txbxContent|tab|br|cr|sym|footnoteReference|endnoteReference|ruby|altChunk|hyperlink)|m:[\w]+)(?=[\s/>])/i
const TEXT = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g
const PARAGRAPH = /<w:p(?=[\s/>])[^>]*\/>|<w:p(?=[\s>])[^>]*>[\s\S]*?<\/w:p>/g

export function textOf(xml: string): string {
  return [...xml.matchAll(TEXT)].map((m) => decodeEntities(m[1])).join('')
}

function isPlainParagraph(xml: string): boolean {
  return !COMPLEX_CONTENT.test(xml) && !/<!|<\?/.test(xml)
}

function patchPlainParagraph(xml: string, text: string): string | null {
  const patched = patchParagraphTexts(xml, text)
  if (patched !== null) return patched
  // A genuinely empty paragraph has no w:t for the engine's surgical patch to anchor to.
  if (textOf(xml) !== '' || !isPlainParagraph(xml)) return null
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const run = `<w:r><w:t xml:space="preserve">${escaped}</w:t></w:r>`
  if (/^<w:p\s*\/>$/.test(xml)) return `<w:p>${run}</w:p>`
  return xml.endsWith('</w:p>') ? xml.slice(0, -6) + run + '</w:p>' : null
}

function validateParagraphText(text: string): void {
  for (const character of text) {
    const code = character.codePointAt(0)!
    if (code < 32) throw new Error('oneParagraph')
    if (code === 0xfffe || code === 0xffff || (code >= 0xd800 && code <= 0xdfff))
      throw new Error('cannotSave')
  }
}

/** Reject names JSZip would collapse or normalize during a changed save. */
function assertArchivePaths(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = bytes.length - 22
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--
  if (end < 0) throw new Error('failed')
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const names = new Set<string>()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) throw new Error('failed')
    const length = view.getUint16(at + 28, true)
    if (at + 46 + length > bytes.length) throw new Error('failed')
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + length))
    if (
      names.has(name) ||
      name.startsWith('/') ||
      name.includes('\\') ||
      name.split('/').some((segment) => segment === '..' || segment === '.') ||
      name.includes('\0')
    )
      throw new Error('failed')
    names.add(name)
    at += 46 + length + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
  }
}

export class WordDocument {
  readonly parts: DocumentPart[]
  readonly addedParagraphs: string[] = []
  readonly readOnly: boolean

  private constructor(
    readonly parsed: ParsedDocFull,
    readonly name: string,
    readonly signed: boolean,
  ) {
    this.readOnly = !!(
      signed ||
      parsed.protection?.enforced ||
      parsed.writeProtection?.hash ||
      parsed.trackRevisions
    )
    let fieldDepth = 0
    this.parts = parsed.blocks
      .filter((b) => !b.hidden && b.docxIndex !== null)
      .map((block) => {
        const xml = block.originalXml ?? ''
        const startsInsideField = fieldDepth > 0
        for (const match of xml.matchAll(
          /<w:fldChar\b[^>]*w:fldCharType\s*=\s*["'](begin|end)["'][^>]*>/g,
        )) {
          fieldDepth = match[1] === 'begin' ? fieldDepth + 1 : Math.max(0, fieldDepth - 1)
        }
        const safeContainer =
          !startsInsideField &&
          !block.sdtShell &&
          !/<w:(?:txbxContent|sdt|ins|del|moveFrom|moveTo)(?=[\s/>])/.test(xml) &&
          !/<!|<\?/.test(xml)
        const paragraphs = [...xml.matchAll(PARAGRAPH)].map((m) => {
          const text = textOf(m[0])
          return {
            originalXml: m[0],
            originalText: text,
            text,
            editable: !this.readOnly && safeContainer && isPlainParagraph(m[0]),
          }
        })
        return {
          docxIndex: block.docxIndex!,
          originalXml: xml,
          table: block.type === 'table',
          heading: block.type === 'heading',
          paragraphs,
        }
      })
  }

  static async open(bytes: Uint8Array, name: string): Promise<WordDocument> {
    if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error('documentTooLarge')
    await assertZipInflatesWithinLimits(bytes, DOCUMENT_ZIP_LIMITS)
    assertArchivePaths(bytes)
    const zip = await JSZip.loadAsync(bytes)
    for (const file of Object.values(zip.files)) {
      const originalName = (file as typeof file & { unsafeOriginalName?: string })
        .unsafeOriginalName
      if (originalName && originalName !== file.name) throw new Error('failed')
    }
    const signed = Object.keys(zip.files).some((path) =>
      path.toLowerCase().startsWith('_xmlsignatures/'),
    )
    return new WordDocument(await parseDocx(bytes, { expandAltChunks: false }), name, signed)
  }

  get dirty(): boolean {
    return (
      this.addedParagraphs.length > 0 ||
      this.parts.some((p) => p.paragraphs.some((r) => r.text !== r.originalText))
    )
  }

  setText(part: number, paragraph: number, text: string): void {
    const entry = this.parts[part]?.paragraphs[paragraph]
    if (!entry?.editable) throw new Error('readOnly')
    validateParagraphText(text)
    entry.text = text
  }

  appendParagraph(): number {
    if (this.readOnly) throw new Error('readOnly')
    return this.addedParagraphs.push('') - 1
  }

  setAddedText(index: number, text: string): void {
    if (this.readOnly || index < 0 || index >= this.addedParagraphs.length)
      throw new Error('readOnly')
    validateParagraphText(text)
    this.addedParagraphs[index] = text
  }

  async save(): Promise<Uint8Array> {
    // Keeping the original object also guarantees byte identity for an untouched document.
    if (!this.dirty) return this.parsed.internal.originalBytes
    if (this.readOnly) throw new Error('readOnly')
    const blocks: SaveBlock[] = this.parts.map((part) => {
      const changed = part.paragraphs.filter((p) => p.text !== p.originalText)
      if (!changed.length) return { kind: 'original', docxIndex: part.docxIndex }
      let xml = part.originalXml
      // Resolve locations from the original, then splice backwards so repeated text stays distinct.
      const patches = changed.map((p) => {
        if (!p.editable) throw new Error('readOnly')
        const paragraphIndex = part.paragraphs.indexOf(p)
        const match = [...part.originalXml.matchAll(PARAGRAPH)][paragraphIndex]
        const replacement = patchPlainParagraph(p.originalXml, p.text)
        if (!replacement || !match) throw new Error('cannotSave')
        return { start: match.index!, end: match.index! + match[0].length, replacement }
      })
      for (const patch of patches.sort((a, b) => b.start - a.start)) {
        xml = xml.slice(0, patch.start) + patch.replacement + xml.slice(patch.end)
      }
      return { kind: 'xml', docxIndex: part.docxIndex, xml }
    })
    for (const text of this.addedParagraphs)
      blocks.push({ kind: 'generated', block: { type: 'paragraph', runs: [{ text }] } })
    const saved = await saveDocx(this.parsed, blocks)
    if (saved.byteLength > MAX_DOCUMENT_BYTES) throw new Error('documentTooLarge')
    await assertZipInflatesWithinLimits(saved, DOCUMENT_ZIP_LIMITS)
    return saved
  }
}

export function decodeBase64(value: string): Uint8Array {
  if (value.length > Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4) throw new Error('documentTooLarge')
  const binary = atob(value)
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
  return btoa(binary)
}
