import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { importWorkbook } from '../src/import-workbook'
import { initializeLegacyImporter } from '../src/legacy-import'
import { Workbook } from '../src/workbook'

initializeLegacyImporter(
  readFileSync(new URL('../vendor/legacy-import/legacy-import.wasm', import.meta.url)),
)
const utf8 = (text: string) => new TextEncoder().encode(text)

test('CSV/TSV reuse desktop parsing, preserve quoted Unicode/zeros and leave original bytes unchanged', async () => {
  for (const [kind, text, expected] of [
    ['csv', 'Name,Code,Note\r\n한글,00123,"quoted, value"\r\n', ['한글', '00123', 'quoted, value']],
    [
      'tsv',
      'Name\tCode\tNote\n한글\t00123\tcommas, commas, commas\n',
      ['한글', '00123', 'commas, commas, commas'],
    ],
  ] as const) {
    const original = utf8(text),
      before = original.slice(),
      result = await importWorkbook(original, `Original.${kind}`, kind)
    assert.equal(result.name, 'Original.xlsx')
    assert.equal(result.converted, true)
    assert.deepEqual(original, before)
    const book = await Workbook.open(result.bytes),
      sheet = await book.worksheet(book.sheets[0])
    assert.deepEqual(
      ['A2', 'B2', 'C2'].map((ref) => sheet.cell(ref).value),
      expected,
    )
    book.close()
  }
})

test('real Calamine XLS and ODS fixtures convert offline with formula/date cells', async () => {
  for (const [fixture, kind] of [
    ['formulas.xls', 'xls'],
    ['dates.ods', 'ods'],
  ]) {
    const original = readFileSync(new URL(`fixtures/${fixture}`, import.meta.url)),
      before = original.slice()
    const imported = await importWorkbook(original, fixture, kind)
    assert.deepEqual(original, before)
    const zip = await JSZip.loadAsync(imported.bytes)
    const sheets = await Promise.all(
      Object.keys(zip.files)
        .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path))
        .map((path) => zip.file(path)!.async('string')),
    )
    if (kind === 'xls') assert.ok(sheets.some((xml) => xml.includes('<f>')))
    else assert.ok(sheets.some((xml) => / s="[12]"/.test(xml)))
    const book = await Workbook.open(imported.bytes)
    assert.ok(book.sheets.length)
    book.close()
  }
})

test('legacy importer rejects corrupt input and ODS repeated-data bombs before conversion', async () => {
  await assert.rejects(
    importWorkbook(utf8('invalid XLS'), 'bad.xls', 'xls'),
    /detect file format|read|decode/i,
  )
  const zip = new JSZip()
  zip.file(
    'content.xml',
    '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"><table:table><table:table-row table:number-rows-repeated="100001"><table:table-cell office:value-type="float" office:value="1"/></table:table-row></table:table></office:document-content>',
  )
  await assert.rejects(
    importWorkbook(await zip.generateAsync({ type: 'uint8array' }), 'bomb.ods', 'ods'),
    /100,000-cell/,
  )
})

test('1904-epoch XLS dates are normalized into the new XLSX 1900 epoch', async () => {
  const bytes = readFileSync(new URL('fixtures/dates-1904.xls', import.meta.url))
  const imported = await importWorkbook(bytes, 'Mac dates.xls', 'xls')
  const workbook = await Workbook.open(imported.bytes),
    sheet = await workbook.worksheet(workbook.sheets[0])
  assert.equal(sheet.cell('A1').value, '44197')
  assert.equal(sheet.cell('A2').value, '44198')
  workbook.close()
})

test('raw importer module cannot grow beyond its configured 256 MiB memory ceiling', () => {
  const module = new WebAssembly.Module(
    readFileSync(new URL('../vendor/legacy-import/legacy-import.wasm', import.meta.url)),
  )
  const blocked = () => {
    throw new Error('Blocked unused binding')
  }
  const imports = Object.fromEntries(
    [...new Set(WebAssembly.Module.imports(module).map((entry) => entry.module))].map((name) => [
      name,
      Object.fromEntries(
        WebAssembly.Module.imports(module)
          .filter((entry) => entry.module === name)
          .map((entry) => [entry.name, blocked]),
      ),
    ]),
  )
  const instance = new WebAssembly.Instance(module, imports)
  assert.throws(() => (instance.exports.memory as WebAssembly.Memory).grow(4096), RangeError)
})
