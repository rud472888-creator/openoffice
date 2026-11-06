import JSZip from 'jszip'
import { assertZipInflatesWithinLimits } from '@genoffice/zip-gate'

export const maxPptxBytes = 32 * 1024 * 1024
const limits = { maxParts: 5000, maxPartBytes: 16 * 1024 * 1024, maxTotalBytes: 128 * 1024 * 1024 }
/** JSZip merges duplicate names; reject ambiguous packages before that information is lost. */
function assertUniqueEntries(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = bytes.length - 22
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--
  if (end < 0) throw new Error('invalidPresentation')
  const count = view.getUint16(end + 10, true)
  let offset = view.getUint32(end + 16, true)
  const names = new Set<string>()
  for (let i = 0; i < count; i++) {
    const nameLength = view.getUint16(offset + 28, true)
    const raw = bytes.subarray(offset + 46, offset + 46 + nameLength)
    const key = Array.from(raw, (byte) => String.fromCharCode(byte)).join('')
    if (names.has(key)) throw new Error('invalidPresentation')
    names.add(key)
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
}

export async function inspectPptx(bytes: Uint8Array): Promise<{ protected: boolean }> {
  if (bytes.length > maxPptxBytes) throw new Error('presentationTooLarge')
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) throw new Error('encryptedPresentation')
  await assertZipInflatesWithinLimits(bytes, limits)
  assertUniqueEntries(bytes)
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true })
  for (const entry of Object.values(zip.files)) {
    if (entry.unsafeOriginalName && entry.unsafeOriginalName !== entry.name)
      throw new Error('invalidPresentation')
  }
  const xml = async (path: string) => {
    const file = zip.file(path)
    if (!file) throw new Error('invalidPresentation')
    const text = await file.async('string')
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('invalidPresentation')
    const doc = new DOMParser().parseFromString(text, 'application/xml')
    if (doc.getElementsByTagName('parsererror').length) throw new Error('invalidPresentation')
    return doc
  }
  const relationships = await xml('_rels/.rels')
  const office = Array.from(relationships.getElementsByTagNameNS('*', 'Relationship')).find(
    (r) =>
      r.getAttribute('Type')?.endsWith('/officeDocument') &&
      r.getAttribute('TargetMode') !== 'External',
  )
  const target = office?.getAttribute('Target')
  if (!target || /^([a-z]+:|\/\/)/i.test(target) || target.includes('..'))
    throw new Error('invalidPresentation')
  const main = await xml(target.replace(/^\//, ''))
  return {
    protected:
      Object.keys(zip.files).some((path) => path.toLowerCase().startsWith('_xmlsignatures/')) ||
      main.getElementsByTagNameNS('*', 'modifyVerifier').length > 0,
  }
}
