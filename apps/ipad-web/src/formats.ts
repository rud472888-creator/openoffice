import { odtToDocx } from '@genoffice/odt-engine'
import { convertLegacyDocToDocx, openCompoundFile } from '@genoffice/doc2docx'
import { inspectOfficeArchive, WordDocument, MAX_DOCUMENT_BYTES } from './document'
import { RichWordDocument } from './rich-document'

export async function openRichDocument(
  bytes: Uint8Array,
  name: string,
  kind: string,
): Promise<RichWordDocument> {
  if (kind === 'docx') return new RichWordDocument(await WordDocument.open(bytes, name))
  if (kind === 'doc') {
    if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error('documentTooLarge')
    const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b
    if (!isZip)
      openCompoundFile(bytes, { maxBytes: MAX_DOCUMENT_BYTES, maxStreamBytes: 16 * 1024 * 1024 })
    const converted = await convertLegacyDocToDocx(bytes)
    const source = await WordDocument.open(converted.docx, name)
    return new RichWordDocument(source, undefined, converted)
  }
  if (kind !== 'odt') throw new Error('unsupported')
  const zip = await inspectOfficeArchive(bytes)
  const signed = Object.keys(zip.files).some((name) =>
    /^META-INF\/(?:documentsignatures|macrosignatures)\.xml$/i.test(name),
  )
  const bridge = await odtToDocx(bytes)
  const source = await WordDocument.open(bridge.docxBytes, name)
  return new RichWordDocument(source, {
    original: bytes,
    bridge: bridge.bridge,
    report: bridge.report,
    signed,
  })
}
