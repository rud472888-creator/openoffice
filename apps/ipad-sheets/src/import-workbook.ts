import {
  decodeCsvBuffer,
  parseCsv,
  resolveImportDelimiter,
  xlsxBufferFromSheets,
} from '../../../packages/xlsx-gateway/src/gateway/csv-import'
import { legacyToXlsx } from './legacy-import'

export interface ImportedWorkbook {
  bytes: Uint8Array
  name: string
  sourceKind: string
  converted: boolean
}

export async function importWorkbook(
  bytes: Uint8Array,
  name: string,
  kind: string,
): Promise<ImportedWorkbook> {
  kind = kind.toLowerCase()
  if (bytes.length > 32 * 1024 * 1024) throw new Error('The workbook exceeds the 32 MB iPad limit.')
  if (kind === 'xlsx') return { bytes, name, sourceKind: kind, converted: false }
  if (kind === 'csv' || kind === 'tsv') {
    const text = decodeCsvBuffer(bytes)
    const rows = parseCsv(text, kind === 'tsv' ? '\t' : resolveImportDelimiter(text))
    if (rows.reduce((count, row) => count + row.length, 0) > 100000)
      throw new Error('CSV/TSV import exceeds the 100,000-cell iPad limit.')
    if (rows.some((row) => row.some((value) => value.length > 32767)))
      throw new Error('A CSV/TSV cell exceeds the spreadsheet text limit.')
    const buffer = await xlsxBufferFromSheets([{ name: 'Sheet1', rows }])
    return {
      bytes: buffer,
      name: name.replace(/\.[^.]*$/, '') + '.xlsx',
      sourceKind: kind,
      converted: true,
    }
  }
  if (kind === 'xls' || kind === 'ods')
    return {
      bytes: await legacyToXlsx(bytes, kind),
      name: name.replace(/\.[^.]*$/, '') + '.xlsx',
      sourceKind: kind,
      converted: true,
    }
  throw new Error(`Spreadsheet import for .${kind} is unavailable.`)
}
