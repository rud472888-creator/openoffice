import JSZip from 'jszip'
import { assertZipInflatesWithinLimits } from '../../../packages/zip-gate/src/index'
import { xlsxBufferFromSheets } from '../../../packages/xlsx-gateway/src/gateway/csv-import'
import { MINIMAL_STYLESHEET_XML } from '../../../packages/xlsx-gateway/src/gateway/xlsx-default-styles'
import { parseXml, children, type XmlNode } from './xml'

let module: WebAssembly.Module | undefined
export function initializeLegacyImporter(bytes: Uint8Array): void {
  module = new WebAssembly.Module(bytes as BufferSource)
}
interface LegacySheet {
  name: string
  xml: string
}
interface LegacyAbi {
  memory: WebAssembly.Memory
  alloc(length: number): number
  release(pointer: number, length: number): void
  convert_workbook(pointer: number, length: number): bigint
}

function decodeLegacy(bytes: Uint8Array): LegacySheet[] {
  if (!module) throw new Error('The legacy spreadsheet importer is not initialized.')
  const blocked = (): never => {
    throw new Error('The legacy importer requested an unsupported JavaScript binding.')
  }
  const instance = new WebAssembly.Instance(module, {
    __wbindgen_externref_xform__: {
      __wbindgen_externref_statics_end: blocked,
      __wbindgen_externref_table_grow: blocked,
      __wbindgen_externref_table_set_null: blocked,
    },
    __wbindgen_placeholder__: { __wbindgen_describe: blocked },
  })
  const abi = instance.exports as unknown as LegacyAbi
  let input = 0,
    output = 0,
    length = 0
  try {
    input = abi.alloc(bytes.length)
    new Uint8Array(abi.memory.buffer, input, bytes.length).set(bytes)
    const result = abi.convert_workbook(input, bytes.length)
    output = Number(result >> 32n)
    length = Number(result & 0xffffffffn)
    if (length > 24 * 1024 * 1024)
      throw new Error('Legacy conversion output exceeds the iPad limit.')
    const decoded = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        new Uint8Array(abi.memory.buffer, output, length),
      ),
    ) as { Ok?: LegacySheet[]; Err?: string }
    if (decoded.Err) throw new Error(decoded.Err)
    if (!decoded.Ok?.length) throw new Error('The legacy workbook has no readable sheets.')
    return decoded.Ok
  } catch (error) {
    if (error instanceof WebAssembly.RuntimeError)
      throw new Error(
        'The legacy workbook exceeded the bounded parser memory/stack limit or could not be decoded.',
        { cause: error },
      )
    throw error
  } finally {
    if (output) abi.release(output, length)
    if (input) abi.release(input, bytes.length)
  }
}

const descendants = (node: XmlNode, local: string): XmlNode[] => [
  ...children(node, local),
  ...node.children.flatMap((n) => descendants(n, local)),
]
async function preflightOds(bytes: Uint8Array): Promise<void> {
  await assertZipInflatesWithinLimits(bytes, {
    maxParts: 4000,
    maxPartBytes: 16 * 1024 * 1024,
    maxTotalBytes: 64 * 1024 * 1024,
  })
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true }),
    content = zip.file('content.xml')
  if (!content) throw new Error('The ODS content part is missing.')
  const root = parseXml(await content.async('string')).children[0]
  let cells = 0
  const attr = (node: XmlNode, name: string): string | undefined =>
    Object.entries(node.attrs).find(([key]) => key.split(':').pop() === name)?.[1]
  for (const row of descendants(root, 'table-row')) {
    const rows = Number(attr(row, 'number-rows-repeated') ?? 1)
    if (!Number.isInteger(rows) || rows < 1 || rows > 1048576)
      throw new Error('ODS row repetition is outside spreadsheet bounds.')
    for (const cell of children(row, 'table-cell')) {
      const columns = Number(attr(cell, 'number-columns-repeated') ?? 1)
      if (!Number.isInteger(columns) || columns < 1 || columns > 16384)
        throw new Error('ODS column repetition is outside spreadsheet bounds.')
      if (attr(cell, 'value-type') || attr(cell, 'formula') || cell.children.length)
        cells += rows * columns
      if (cells > 100000)
        throw new Error('ODS repeated cell data exceeds the 100,000-cell iPad limit.')
    }
  }
}

export async function legacyToXlsx(bytes: Uint8Array, kind: string): Promise<Uint8Array> {
  if (kind === 'ods') await preflightOds(bytes)
  else if (bytes[0] === 0x50 && bytes[1] === 0x4b)
    await assertZipInflatesWithinLimits(bytes, {
      maxParts: 4000,
      maxPartBytes: 16 * 1024 * 1024,
      maxTotalBytes: 64 * 1024 * 1024,
    })
  const sheets = decodeLegacy(bytes)
  const zip = await JSZip.loadAsync(
    await xlsxBufferFromSheets(sheets.map((sheet) => ({ name: sheet.name, rows: [] }))),
  )
  for (const [index, sheet] of sheets.entries()) {
    parseXml(sheet.xml)
    if (/<f>(?:of:|oooc:)/.test(sheet.xml))
      throw new Error(
        'This ODS uses formula syntax that cannot yet be safely translated to XLSX. The original is unchanged.',
      )
    zip.file(`xl/worksheets/sheet${index + 1}.xml`, sheet.xml)
  }
  const dateStyles =
    '<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="22" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  zip.file(
    'xl/styles.xml',
    MINIMAL_STYLESHEET_XML.replace('<cellXfs count="1">', '<cellXfs count="3">').replace(
      '</cellXfs>',
      `${dateStyles}</cellXfs>`,
    ),
  )
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
