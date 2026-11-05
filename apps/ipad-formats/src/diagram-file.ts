import pako from 'pako'
import {
  extractDiagramXml,
  decodeCompressedPage,
  type DiagramFormat,
  type PageCodec,
} from '@genoffice/drawio-model'
import { assertText, MAX_INPUT } from './common'

export const diagramCodec: PageCodec = {
  inflateRaw(bytes) {
    const chunks: Uint8Array[] = []
    let total = 0
    const inflate = new pako.Inflate({ raw: true, chunkSize: 32768 })
    inflate.onData = (chunk) => {
      total += chunk.length
      if (total > 16 * 1024 * 1024) throw new Error('The embedded diagram exceeds 16 MB.')
      chunks.push(chunk.slice())
    }
    inflate.push(bytes, true)
    if (inflate.err) throw new Error(inflate.msg || 'Invalid compressed diagram.')
    const output = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      output.set(chunk, offset)
      offset += chunk.length
    }
    return output
  },
  deflateRaw() {
    throw new Error('Diagram serialization belongs to the offline draw.io editor.')
  },
}
/** The same desktop extraction rules, with mobile limits before the vendor editor loads. */
export function openDiagramFile(
  name: string,
  bytes: Uint8Array,
): { xml: string; format: DiagramFormat; compressed: boolean } {
  if (bytes.length > MAX_INPUT) throw new Error('The diagram exceeds 32 MB.')
  const extracted = extractDiagramXml(name, bytes, diagramCodec)
  if (!extracted.ok) throw new Error(extracted.message)
  const xml = extracted.xml
  assertText(xml)
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Unsupported diagram XML.')
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (
    doc.querySelector('parsererror') ||
    !['mxfile', 'mxGraphModel'].includes(doc.documentElement.localName)
  )
    throw new Error('This is not a draw.io diagram.')
  const pages = [...doc.querySelectorAll('diagram')]
  if (pages.length > 5000) throw new Error('The diagram exceeds 5,000 pages.')
  let total = xml.length
  let compressed = false
  for (const page of pages)
    if (!page.querySelector('mxGraphModel') && page.textContent?.trim()) {
      compressed = true
      const decoded = decodeCompressedPage(page.textContent.trim(), diagramCodec)
      assertText(decoded)
      if (/<!DOCTYPE|<!ENTITY/i.test(decoded))
        throw new Error('Unsupported compressed diagram XML.')
      total += decoded.length
      if (total > 128 * 1024 * 1024)
        throw new Error('The diagram exceeds the expanded mobile limit.')
    }
  return { xml, format: extracted.format, compressed }
}
