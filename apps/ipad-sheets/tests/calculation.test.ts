import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { Model } from '../vendor/ironcalc-xlsx/wasm.js'
import { initializeCalculation, unsupportedFunctions } from '../src/calculation'
import { Workbook } from '../src/workbook'

initializeCalculation(
  readFileSync(new URL('../vendor/ironcalc-xlsx/wasm_bg.wasm', import.meta.url)),
)

async function formulaBook(): Promise<Workbook> {
  const model = new Model('Tests', 'en', 'UTC', 'en')
  model.renameSheet(0, 'Inputs')
  model.newSheet()
  model.renameSheet(1, '분석 Sheet')
  model.setUserInput(0, 1, 1, '10')
  model.setUserInput(0, 2, 1, '20')
  model.setUserInput(1, 1, 1, '=SUM(Inputs!A1:A2)')
  model.setUserInput(1, 2, 1, '=A1*2')
  model.setUserInput(1, 3, 1, '=IF(A2>50,"한글 결과","small")')
  model.setUserInput(1, 4, 1, '=A2>50')
  model.evaluate()
  const zip = await JSZip.loadAsync(model.toXlsx())
  zip.file('customXml/unknown.xml', '<preserve unknown="yes"/>')
  model.free()
  return Workbook.open(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }))
}

test('same-engine multisheet dependency recalculation patches typed OOXML caches', async () => {
  const book = await formulaBook()
  const inputs = book.sheets[0]
  const results = await book.worksheet(book.sheets[1])
  assert.deepEqual(book.calculationIssues, [])
  assert.equal(results.cell('A1').value, '30')
  book.edit(inputs, 'A1', '40', 'number')
  assert.deepEqual(book.calculationIssues, [])
  assert.equal(results.cell('A1').value, '60')
  assert.equal(results.cell('A2').value, '120')
  assert.equal(results.cell('A3').value, '한글 결과')
  assert.equal(results.cell('A4').value, 'TRUE')
  const zip = await JSZip.loadAsync((await book.save()).bytes)
  const xml = await zip.file(book.sheets[1].path)!.async('string')
  assert.match(xml, /<f>SUM\(Inputs!A1:A2\)<\/f><v>60<\/v>/)
  assert.match(
    xml,
    /t="str"><f>IF\(A2&gt;50,&quot;한글 결과&quot;,&quot;small&quot;\)<\/f><v>한글 결과<\/v>/,
  )
  assert.match(xml, /t="b"><f>A2&gt;50<\/f><v>1<\/v>/)
  assert.equal(
    await zip.file('customXml/unknown.xml')!.async('string'),
    '<preserve unknown="yes"/>',
  )
  const reopened = await Workbook.open((await book.save()).bytes)
  assert.equal((await reopened.worksheet(reopened.sheets[1])).cell('A2').value, '120')
  book.close()
  reopened.close()
})

test('formula entry, replacement, typed errors and undo preserve formulas', async () => {
  const book = await formulaBook()
  const sheet = book.sheets[0]
  const worksheet = await book.worksheet(sheet)
  book.edit(sheet, 'B1', '=AVERAGE(A1:A2)', 'formula')
  assert.equal(worksheet.cell('B1').formula, 'AVERAGE(A1:A2)')
  assert.equal(worksheet.cell('B1').value, '15')
  book.edit(sheet, 'B2', '=1/0', 'formula')
  assert.equal(worksheet.cell('B2').value, '#DIV/0!')
  book.edit(sheet, 'B1', '=COUNTIF(A1:A2,">15")', 'formula')
  assert.equal(worksheet.cell('B1').value, '1')
  book.undo()
  assert.equal(worksheet.cell('B1').formula, 'AVERAGE(A1:A2)')
  assert.equal(worksheet.cell('B1').value, '15')
  book.edit(sheet, 'B1', '=literal', 'text')
  assert.equal(worksheet.cell('B1').formula, undefined)
  assert.equal(worksheet.cell('B1').value, '=literal')
  book.close()
})

test('common desktop functions calculate through IronCalc rather than custom approximations', async () => {
  const book = await formulaBook()
  const sheet = book.sheets[0]
  const worksheet = await book.worksheet(sheet)
  const cases = [
    ['SUM(A1:A2)', '30'],
    ['MIN(A1:A2)', '10'],
    ['MAX(A1:A2)', '20'],
    ['COUNTA(A1:A2)', '2'],
    ['SUMIF(A1:A2,">15")', '20'],
    ['ROUND(1.234,2)', '1.23'],
    ['IFERROR(1/0,9)', '9'],
    ['VLOOKUP(20,A1:A2,1,FALSE)', '20'],
    ['XLOOKUP(10,A1:A2,A1:A2)', '10'],
    ['CONCAT("한글"," ","text")', '한글 text'],
    ['DATE(2024,1,1)', '45292'],
    ['LET(x,3,x*2)', '6'],
  ]
  for (const [formula, value] of cases) {
    book.edit(sheet, 'B1', `=${formula}`, 'formula')
    assert.deepEqual(book.calculationIssues, [], formula)
    assert.equal(worksheet.cell('B1').value, value, formula)
  }
  book.close()
})

test('unsupported function diagnostics are exact and failed formula edits are atomic', async () => {
  const book = await formulaBook()
  const sheet = book.sheets[0]
  const worksheet = await book.worksheet(sheet)
  const before = worksheet.xml
  assert.throws(
    () => book.edit(sheet, 'B1', '=UNSUPPORTED_FN(1)', 'formula'),
    /Unsupported functions: UNSUPPORTED_FN/,
  )
  assert.throws(
    () => book.edit(sheet, 'B1', '=FORECAST.ETS(1,A1:A2,A1:A2)', 'formula'),
    /FORECAST\.ETS/,
  )
  assert.equal(worksheet.xml, before)
  assert.deepEqual(unsupportedFunctions('IF(TRUE,"UNKNOWN(",SUM(1,2))'), [])
  assert.deepEqual(unsupportedFunctions('_xlfn.XLOOKUP(1,A1:A2,A1:A2)'), [])
  book.close()
})
