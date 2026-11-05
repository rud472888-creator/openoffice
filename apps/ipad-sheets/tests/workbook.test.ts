import assert from 'node:assert/strict'
import { test } from 'node:test'
import JSZip from 'jszip'
import { XMLValidator } from 'fast-xml-parser'
import { Workbook, Worksheet, address, coordinates } from '../src/workbook'
import { blankWorkbook } from '../src/template'
import { parseXml } from '../src/xml'
import { strings } from '../src/strings'

const sheetXml =
  '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:D4"/><sheetData><row r="1" customHeight="1" ht="22"><c r="A1" s="3" t="s"><v>0</v><extLst><ext uri="retained"/></extLst></c><c r="B1" s="7"><f>A1*2</f><v>42</v></c><c r="D1"><v>7</v></c></row><row r="3"/><row r="4"><c r="A4" t="inlineStr"><is><t>unchanged</t></is></c></row></sheetData><mergeCells count="1"><mergeCell ref="C3:D3"/></mergeCells><drawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="image"/></worksheet>'
async function fixture(xml = sheetXml): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(await blankWorkbook())
  zip.file('xl/worksheets/sheet1.xml', xml)
  zip.file(
    'xl/sharedStrings.xml',
    '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Original &amp; value</t></si></sst>',
  )
  const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
  zip.file(
    'xl/_rels/workbook.xml.rels',
    rels.replace(
      '</Relationships>',
      '<Relationship Id="strings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>',
    ),
  )
  zip.file('customXml/item1.xml', '<opaque>Keep &amp; preserve all bytes</opaque>')
  zip.file('xl/media/image1.bin', Uint8Array.from([0, 12, 243, 255, 128]))
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

test('unmodified save returns exactly the original bytes', async () => {
  const bytes = await fixture()
  const book = await Workbook.open(bytes)
  await book.worksheet(book.sheets[0])
  assert.deepEqual((await book.save()).bytes, bytes)
})

test('edits preserve styles, formula XML, extension data and all other ZIP entries', async () => {
  const bytes = await fixture()
  const book = await Workbook.open(bytes)
  const sheet = book.sheets[0]
  const worksheet = await book.worksheet(sheet)
  assert.equal(worksheet.cell('A1').value, 'Original & value')
  assert.deepEqual(worksheet.cell('B1'), {
    value: '42',
    kind: 'number',
    formula: 'A1*2',
    readOnly: false,
  })
  book.edit(sheet, 'A1', 'Hello 한글 🌱 & <text>', 'text')
  const result = await book.save()
  const original = await JSZip.loadAsync(bytes)
  const saved = await JSZip.loadAsync(result.bytes)
  assert.deepEqual(Object.keys(saved.files).sort(), Object.keys(original.files).sort())
  for (const path of Object.keys(original.files)) {
    if (['xl/worksheets/sheet1.xml', 'xl/workbook.xml'].includes(path)) continue
    assert.deepEqual(
      await saved.files[path].async('uint8array'),
      await original.files[path].async('uint8array'),
      path,
    )
  }
  const xml = await saved.file(sheet.path)!.async('string')
  assert.match(xml, /<c r="A1" s="3" t="inlineStr">/)
  assert.match(xml, /<extLst><ext uri="retained"\/><\/extLst>/)
  assert.ok(xml.includes('<c r="B1" s="7"><f>A1*2</f><v>42</v></c>'))
  assert.match(await saved.file('xl/workbook.xml')!.async('string'), /forceFullCalc="1"/)
  const reopened = await Workbook.open(result.bytes)
  assert.equal(
    (await reopened.worksheet(reopened.sheets[0])).cell('A1').value,
    'Hello 한글 🌱 & <text>',
  )
})

test('new cells and rows are inserted in order and dimension expands', async () => {
  const worksheet = new Worksheet(sheetXml, ['Original'])
  worksheet.setCell('C1', '123.50', 'number')
  worksheet.setCell('B2', 'TRUE', 'boolean')
  worksheet.setCell('A3', 'new row', 'text')
  worksheet.setCell('Z100', 'far away', 'text')
  assert.equal(XMLValidator.validate(worksheet.xml), true)
  assert.match(worksheet.xml, /dimension ref="A1:Z100"/)
  assert.ok(worksheet.xml.indexOf('r="B1"') < worksheet.xml.indexOf('r="C1"'))
  assert.ok(worksheet.xml.indexOf('r="C1"') < worksheet.xml.indexOf('r="D1"'))
  assert.ok(worksheet.xml.indexOf('row r="2"') < worksheet.xml.indexOf('row r="3"'))
  assert.equal(worksheet.cell('B2').value, 'TRUE')
})

test('blank template supports first cell creation and roundtrip', async () => {
  const book = await Workbook.open(await blankWorkbook())
  const sheet = book.sheets[0]
  assert.equal(sheet.name, 'Sheet1')
  await book.worksheet(sheet)
  book.edit(sheet, 'A1', 'New workbook', 'text')
  const reopened = await Workbook.open((await book.save()).bytes)
  assert.equal((await reopened.worksheet(reopened.sheets[0])).cell('A1').value, 'New workbook')
})

test('text OOXML escapes remain literal; whitespace, CRLF and Unicode roundtrip', () => {
  const worksheet = new Worksheet(sheetXml, [])
  const value = '  _x0041_ / _x005F_\r\n\t 한글 日本語 😀  '
  worksheet.setCell('A1', value, 'text')
  assert.equal(new Worksheet(worksheet.xml, []).cell('A1').value, value)
  assert.throws(() => worksheet.setCell('A1', '\ud800', 'text'), /unsupported/)
  assert.throws(() => worksheet.setCell('A1', '\u0000', 'text'), /unsupported/)
})

test('numeric and boolean input validation avoids accidental type conversion', () => {
  const worksheet = new Worksheet(sheetXml, [])
  assert.throws(() => worksheet.setCell('A1', '12 cats', 'number'), /valid number/)
  assert.throws(() => worksheet.setCell('A1', '1e1000', 'number'), /valid number/)
  assert.throws(() => worksheet.setCell('A1', 'yes', 'boolean'), /TRUE or FALSE/)
  worksheet.setCell('A1', '00123', 'text')
  assert.equal(worksheet.cell('A1').value, '00123')
  worksheet.setCell('A1', '=SUM(B1)', 'text')
  assert.equal(worksheet.cell('A1').formula, undefined)
  assert.equal(worksheet.cell('A1').value, '=SUM(B1)')
})

test('merged followers, protected sheets, rich text and array formulas are read-only', async () => {
  const worksheet = new Worksheet(sheetXml, [])
  assert.equal(worksheet.cell('D3').readOnly, true)
  assert.equal(worksheet.cell('C3').readOnly, false)
  const protectedSheet = new Worksheet(
    sheetXml.replace('</worksheet>', '<sheetProtection sheet="1"/></worksheet>'),
    [],
  )
  assert.throws(() => protectedSheet.setCell('A1', 'x', 'text'), /read-only/)
  const richSheet = new Worksheet(
    sheetXml
      .replace('<v>0</v>', '<is><r><rPr><b/></rPr><t>Bold</t></r></is>')
      .replace('t="s"', 't="inlineStr"'),
    [],
  )
  assert.equal(richSheet.cell('A1').value, 'Bold')
  assert.throws(() => richSheet.setCell('A1', 'x', 'text'), /read-only/)
  const array = new Worksheet(
    sheetXml.replace('<f>A1*2</f>', '<f t="array" ref="B1:B3">A1*2</f>'),
    [],
  )
  assert.throws(() => array.setCell('B2', '8', 'number'), /read-only/)
  const zip = await JSZip.loadAsync(await fixture())
  zip.file('xl/sharedStrings.xml', '<sst><si><r><rPr><b/></rPr><t>Rich</t></r></si></sst>')
  const book = await Workbook.open(await zip.generateAsync({ type: 'uint8array' }))
  assert.equal((await book.worksheet(book.sheets[0])).cell('A1').readOnly, true)
})

test('save snapshots do not mix revisions and undo restores original cell XML', async () => {
  const book = await Workbook.open(await fixture())
  const sheet = book.sheets[0]
  const original = (await book.worksheet(sheet)).xml
  book.edit(sheet, 'A1', 'First', 'text')
  const first = book.save()
  book.edit(sheet, 'A1', 'Second', 'text')
  const second = book.save()
  for (const [save, value, revision] of [
    [first, 'First', 1],
    [second, 'Second', 2],
  ] as const) {
    const result = await save
    const opened = await Workbook.open(result.bytes)
    assert.equal((await opened.worksheet(opened.sheets[0])).cell('A1').value, value)
    assert.equal(result.revision, revision)
  }
  assert.equal(book.undo(), true)
  assert.equal(book.undo(), true)
  assert.equal((await book.worksheet(sheet)).xml, original)
})

test('ZIP encrypted flags, forged size and normalized paths are rejected', async () => {
  const original = await fixture()
  const encrypted = original.slice()
  const encryptedView = new DataView(encrypted.buffer)
  for (let at = 0; at < encrypted.length - 46; at++) {
    if (encryptedView.getUint32(at, true) === 0x02014b50) {
      encryptedView.setUint16(at + 8, 1, true)
      break
    }
  }
  await assert.rejects(Workbook.open(encrypted), /encrypted/)
  const bomb = original.slice()
  const bombView = new DataView(bomb.buffer)
  for (let at = 0; at < bomb.length - 46; at++) {
    if (bombView.getUint32(at, true) === 0x02014b50 && bombView.getUint32(at + 24, true) > 0) {
      bombView.setUint32(at + 24, 1, true)
      break
    }
  }
  await assert.rejects(Workbook.open(bomb), /zip rejected:/)
  const zip = await JSZip.loadAsync(original)
  zip.file('../aliased.xml', 'unsafe')
  await assert.rejects(
    Workbook.open(await zip.generateAsync({ type: 'uint8array' })),
    /archive entry path/,
  )
})

test('XML complexity and external entities are bounded', () => {
  assert.throws(
    () => parseXml('<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///etc/passwd">]><x/>'),
    /Unsupported/,
  )
  assert.throws(() => parseXml('<a>'.repeat(129) + '</a>'.repeat(129)), /deeply/)
})

test('failed post-edit validation rolls back XML and cell values', () => {
  const original =
    '<worksheet><dimension ref="bad"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>old</t></is></c></row></sheetData></worksheet>'
  const worksheet = new Worksheet(original, [])
  assert.throws(() => worksheet.setCell('A1', 'new', 'text'))
  assert.equal(worksheet.xml, original)
  assert.equal(worksheet.cell('A1').value, 'old')
})

test('addresses cover the complete worksheet and every locale has complete labels', () => {
  assert.deepEqual(coordinates('XFD1048576'), { column: 16384, row: 1048576 })
  assert.equal(address(16384, 1048576), 'XFD1048576')
  assert.throws(() => coordinates('XFE1'), /outside/)
  for (const locale of [
    'en',
    'ko',
    'ja',
    'zh',
    'zh-TW',
    'fr',
    'de',
    'es',
    'it',
    'pt',
    'ru',
    'ar',
    'he',
    'hi',
    'id',
    'ms',
    'nl',
    'pl',
    'th',
    'vi',
    'cs',
  ]) {
    assert.equal(strings(locale).length, 22)
    if (locale !== 'en') assert.notEqual(strings(locale)[0], strings('en')[0])
  }
})
