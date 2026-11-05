import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { initializeCalculation } from '../src/calculation'
import { DesktopWorkbook } from '../src/desktop-metadata'
import { saveDesktopWorkbook } from '../src/desktop-save'
import { blankWorkbook } from '../src/template'
import {
  workbookSaveRequestSchema,
  type WorkbookSaveRequest,
} from '../../sheets/src/shared/desktop-api'

initializeCalculation(
  readFileSync(new URL('../vendor/ironcalc-xlsx/wasm_bg.wasm', import.meta.url)),
)
function request(book: DesktopWorkbook, patch: Partial<WorkbookSaveRequest>): WorkbookSaveRequest {
  return workbookSaveRequestSchema.parse({
    sessionId: book.file.sessionId,
    mode: 'save',
    edits: [],
    structuralOps: [],
    chartEdits: [],
    visualEdits: [],
    visualAdditions: [],
    tableAdditions: [],
    pivotAdditions: [],
    sheetOps: [],
    sheetOrder: book.file.sheets.map((s) => s.id),
    filterStates: [],
    hyperlinkEdits: [],
    cfStates: [],
    dvStates: [],
    pageSetupStates: [],
    noteStates: [],
    formulaValues: [],
    pivotCacheRefreshPaths: [],
    pivotRefreshUpdates: [],
    sheetProtections: [],
    definedNamesState: null,
    themeState: null,
    workbookProtectionState: null,
    protectedRangeStates: [],
    ...patch,
  })
}

test('desktop metadata satisfies unchanged renderer contracts and gateway saves styles/formulas', async () => {
  const book = await DesktopWorkbook.open(await blankWorkbook(), 'Desktop.xlsx')
  const sheet = book.file.sheets[0]
  assert.equal(sheet.name, 'Sheet1')
  assert.equal(book.file.styles[0].fontFamily, 'Arial')
  const saved = await saveDesktopWorkbook(
    book,
    request(book, {
      edits: [
        {
          sheetId: sheet.id,
          row: 0,
          column: 0,
          writeValue: true,
          value: 10,
          style: { bold: true, fontSize: 18 },
        },
        { sheetId: sheet.id, row: 1, column: 0, writeValue: true, value: 20 },
        {
          sheetId: sheet.id,
          row: 2,
          column: 0,
          writeValue: true,
          value: null,
          formula: '=SUM(A1:A2)',
        },
      ],
    }),
  )
  const reopened = await DesktopWorkbook.open(saved, 'Desktop.xlsx')
  const read = reopened.fullRange(reopened.file.sheets[0].id)
  assert.equal(read.cells.find((c) => c.row === 2)?.formula, '=SUM(A1:A2)')
  assert.equal(read.cells.find((c) => c.row === 2)?.value, 30)
  const first = read.cells.find((c) => c.row === 0)!
  assert.equal(first.value, 10)
  assert.equal(reopened.file.styles[first.styleIndex!].bold, true)
  assert.equal(reopened.file.styles[first.styleIndex!].fontSize, 18)
  book.book.close()
  reopened.book.close()
})

test('desktop gateway persists sheet management, merges, row layout and print settings', async () => {
  const book = await DesktopWorkbook.open(await blankWorkbook(), 'Layout.xlsx'),
    sheet = book.file.sheets[0]
  const saved = await saveDesktopWorkbook(
    book,
    request(book, {
      sheetOps: [
        { kind: 'rename-sheet', sheetId: sheet.id, newName: '분석' },
        { kind: 'add-sheet', sheetId: 'new-sheet', name: 'Second' },
      ],
      sheetOrder: [sheet.id, 'new-sheet'],
      edits: [
        { sheetId: 'new-sheet', row: 0, column: 0, value: 'New sheet data', writeValue: true },
      ],
      structuralOps: [
        {
          kind: 'merge-cells',
          sheetId: sheet.id,
          range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 },
        },
      ],
    }),
  )
  const reopened = await DesktopWorkbook.open(saved, 'Layout.xlsx')
  assert.deepEqual(
    reopened.file.sheets.map((s) => s.name),
    ['분석', 'Second'],
  )
  assert.equal(reopened.fullRange(reopened.file.sheets[1].id).cells[0].value, 'New sheet data')
  assert.equal(reopened.fullRange(reopened.file.sheets[0].id).merges.length, 1)
  book.book.close()
  reopened.book.close()
})

test('styles, CF, validations, hyperlinks and frozen panes are read into desktop state', async () => {
  const zip = await JSZip.loadAsync(await blankWorkbook())
  zip.file(
    'xl/worksheets/sheet1.xml',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane state="frozen" xSplit="1" ySplit="2"/></sheetView></sheetViews><sheetData><row r="1"><c r="A1"><v>5</v></c></row></sheetData><conditionalFormatting sqref="A1:A3"><cfRule type="cellIs" operator="greaterThan" priority="1"><formula>3</formula></cfRule></conditionalFormatting><dataValidations count="1"><dataValidation type="whole" operator="between" sqref="A1:A3"><formula1>1</formula1><formula2>10</formula2></dataValidation></dataValidations><hyperlinks><hyperlink ref="A1" location="Sheet1!A2"/></hyperlinks></worksheet>',
  )
  const book = await DesktopWorkbook.open(
    await zip.generateAsync({ type: 'uint8array' }),
    'Metadata.xlsx',
  )
  const sheet = book.file.sheets[0],
    range = book.fullRange(sheet.id)
  assert.deepEqual(sheet.freeze, { frozenColumns: 1, frozenRows: 2 })
  assert.equal(range.conditionalRules[0].formulas[0], '3')
  assert.equal(range.dataValidations[0].ruleType, 'whole')
  assert.equal(range.hyperlinks[0].target, 'Sheet1!A2')
  book.book.close()
})
