import JSZip from 'jszip'
import { FormulaEngine, unsupportedFunctions, type CalculatedCell } from './calculation'
import { assertZipInflatesWithinLimits } from '../../../packages/zip-gate/src/index'
import {
  child,
  children,
  content,
  escapeXml,
  insertChild,
  parseXml,
  prefix,
  type XmlNode,
} from './xml'

export type ValueKind = 'text' | 'number' | 'boolean' | 'formula'
export interface CellValue {
  value: string
  kind: ValueKind
  formula?: string
  readOnly: boolean
}
export interface Sheet {
  name: string
  path: string
  hidden: boolean
}
const MAX_INPUT = 32 * 1024 * 1024
const LIMITS = { maxParts: 4000, maxPartBytes: 16 * 1024 * 1024, maxTotalBytes: 64 * 1024 * 1024 }
const decodeSpreadsheet = (text: string): string =>
  text.replace(/_x([\da-f]{4})_/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
const encodeSpreadsheet = (text: string): string =>
  escapeXml(text.replace(/_x[\da-f]{4}_/gi, (match) => `_x005F_${match.slice(1)}`))

export function address(column: number, row: number): string {
  let result = ''
  for (let n = column; n > 0; n = Math.floor((n - 1) / 26))
    result = String.fromCharCode(65 + ((n - 1) % 26)) + result
  return `${result}${row}`
}

export function coordinates(ref: string): { column: number; row: number } {
  const match = /^\$?([A-Z]{1,3})\$?([1-9]\d{0,6})$/i.exec(ref)
  if (!match) throw new Error('Enter a cell address such as A1.')
  let column = 0
  for (const char of match[1].toUpperCase()) column = column * 26 + char.charCodeAt(0) - 64
  const row = Number(match[2])
  if (column > 16384 || row > 1048576) throw new Error('Cell address is outside the worksheet.')
  return { column, row }
}

const inside = (ref: string, range: string): boolean => {
  try {
    const point = coordinates(ref)
    const [first, last = first] = range.split(':').map(coordinates)
    return (
      point.column >= first.column &&
      point.column <= last.column &&
      point.row >= first.row &&
      point.row <= last.row
    )
  } catch {
    return false
  }
}

function richText(xml: string, node?: XmlNode): string {
  if (!node) return ''
  if (node.local === 't') return content(xml, node)
  // Phonetic annotations are not part of the displayed cell value.
  return node.children
    .filter((n) => n.local !== 'rPh' && n.local !== 'phoneticPr')
    .map((n) => richText(xml, n))
    .join('')
}

/** JSZip normalizes names and collapses duplicates, so reject those archives first. */
function assertUniqueZipPaths(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = bytes.length - 22
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const names = new Set<string>()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  for (let i = 0; i < count; i++) {
    const length = view.getUint16(at + 28, true)
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + length))
    if (
      names.has(name) ||
      name.startsWith('/') ||
      name.includes('\\') ||
      name.split('/').some((segment) => segment === '..' || segment === '.') ||
      name.includes('\0')
    )
      throw new Error('Unsupported or duplicate archive entry path.')
    names.add(name)
    at += 46 + length + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
  }
}

function requestCalculation(xml: string): string {
  const root = parseXml(xml).children[0]
  const calculation = child(root, 'calcPr')
  if (calculation) {
    let opening = xml.slice(calculation.start, calculation.openEnd)
    for (const attribute of ['fullCalcOnLoad', 'forceFullCalc']) {
      const pattern = new RegExp(`\\s+${attribute}\\s*=\\s*(?:"[^"]*"|'[^']*')`)
      opening = opening.replace(pattern, '').replace(/\/?\s*>$/, (end) => ` ${attribute}="1"${end}`)
    }
    return xml.slice(0, calculation.start) + opening + xml.slice(calculation.openEnd)
  }
  const laterElements = [
    'oleSize',
    'customWorkbookViews',
    'pivotCaches',
    'smartTagPr',
    'smartTagTypes',
    'webPublishing',
    'fileRecoveryPr',
    'webPublishObjects',
    'extLst',
  ]
  const next = root.children.find((node) => laterElements.includes(node.local))
  return insertChild(
    xml,
    root,
    `<${prefix(root)}calcPr fullCalcOnLoad="1" forceFullCalc="1"/>`,
    next?.start ?? root.closeStart,
  )
}

function partPath(base: string, target: string): string {
  if (/[\\?#]/.test(target) || /^[a-z]+:/i.test(target))
    throw new Error('Unsupported workbook relationship.')
  const result = target.startsWith('/') ? [] : base.split('/').slice(0, -1)
  for (const segment of target.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (!result.length) throw new Error('Invalid workbook relationship path.')
      result.pop()
    } else result.push(segment)
  }
  return result.join('/')
}

export class Worksheet {
  root!: XmlNode
  data!: XmlNode
  cells = new Map<string, XmlNode>()
  rows = new Map<number, XmlNode>()
  maxRow = 1
  maxColumn = 1
  protected = false
  private readOnlyRanges: string[] = []
  private merges: string[] = []

  constructor(
    public xml: string,
    private shared: string[],
    private richShared = new Set<number>(),
  ) {
    this.refresh()
  }

  private refresh(): void {
    const document = parseXml(this.xml)
    this.root = document.children.find((n) => n.local === 'worksheet')!
    this.data = this.root && child(this.root, 'sheetData')!
    if (!this.data) throw new Error('Unsupported worksheet structure.')
    this.protected = !!child(this.root, 'sheetProtection')
    this.cells.clear()
    this.rows.clear()
    this.maxRow = 1
    this.maxColumn = 1
    this.readOnlyRanges = []
    this.merges = children(child(this.root, 'mergeCells') ?? this.root, 'mergeCell').map(
      (n) => n.attrs.ref,
    )
    for (const row of children(this.data, 'row')) {
      const rowNumber = Number(row.attrs.r)
      if (
        !Number.isInteger(rowNumber) ||
        rowNumber < 1 ||
        rowNumber > 1048576 ||
        this.rows.has(rowNumber)
      )
        throw new Error('Unsupported worksheet row addresses.')
      this.rows.set(rowNumber, row)
      for (const cell of children(row, 'c')) {
        const ref = cell.attrs.r
        const point = coordinates(ref ?? '')
        if (point.row !== rowNumber || this.cells.has(ref))
          throw new Error('Unsupported worksheet cell addresses.')
        this.cells.set(ref, cell)
        this.maxRow = Math.max(this.maxRow, point.row)
        this.maxColumn = Math.max(this.maxColumn, point.column)
        const formula = child(cell, 'f')
        if (formula?.attrs.ref) this.readOnlyRanges.push(formula.attrs.ref)
      }
    }
  }

  cell(ref: string): CellValue {
    coordinates(ref)
    const node = this.cells.get(ref)
    const formula = node && child(node, 'f')
    const type = node?.attrs.t
    let value = node ? content(this.xml, child(node, 'v')) : ''
    let kind: ValueKind = 'text'
    if (type === 's') value = this.shared[Number(value)] ?? ''
    else if (type === 'inlineStr')
      value = decodeSpreadsheet(richText(this.xml, node && child(node, 'is')))
    else if (type === 'b') {
      value = value === '1' ? 'TRUE' : 'FALSE'
      kind = 'boolean'
    } else if (node && (!type || type === 'n')) kind = 'number'
    return {
      value,
      kind,
      formula: formula ? content(this.xml, formula) : undefined,
      readOnly:
        this.protected ||
        formula?.attrs.t === 'shared' ||
        formula?.attrs.t === 'array' ||
        formula?.attrs.t === 'dataTable' ||
        !!node?.attrs.cm ||
        !!node?.attrs.vm ||
        (type === 's' &&
          this.richShared.has(Number(content(this.xml, node && child(node, 'v'))))) ||
        !!(node && child(node, 'is')?.children.some((n) => n.local === 'r')) ||
        this.readOnlyRanges.some((range) => inside(ref, range)) ||
        this.merges.some((range) => inside(ref, range) && range.split(':')[0] !== ref),
    }
  }

  setCell(ref: string, value: string, kind: ValueKind): boolean {
    const original = this.xml
    try {
      return this.applyCell(ref, value, kind)
    } catch (error) {
      this.xml = original
      this.refresh()
      throw error
    }
  }

  private applyCell(ref: string, value: string, kind: ValueKind): boolean {
    const point = coordinates(ref)
    ref = address(point.column, point.row)
    const previous = this.cell(ref)
    if (previous.readOnly) throw new Error('This cell is read-only.')
    if (
      value.length > 32767 ||
      // XML 1.0 forbids these controls; the Unicode flag excludes valid surrogate pairs.
      // eslint-disable-next-line no-control-regex
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF\uD800-\uDFFF]/u.test(value)
    )
      throw new Error('The value contains unsupported characters or is too long.')
    if (
      kind === 'number' &&
      value !== '' &&
      (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(value) ||
        !Number.isFinite(Number(value)))
    )
      throw new Error('Enter a valid number, or choose Text.')
    if (kind === 'boolean' && value !== '' && !/^(TRUE|FALSE)$/i.test(value))
      throw new Error('Enter TRUE or FALSE, or choose Text.')
    if (kind === 'formula' && !value.startsWith('='))
      throw new Error('A formula must start with =.')
    if (kind === 'formula' && value.length > 8192)
      throw new Error('A formula cannot exceed 8192 characters.')
    if (
      kind === 'formula'
        ? previous.formula === value.slice(1)
        : previous.formula === undefined && previous.value === value && previous.kind === kind
    )
      return false
    const existing = this.cells.get(ref)
    const p = existing ? prefix(existing) : prefix(this.data)
    let payload = ''
    let type = ''
    if (value !== '') {
      if (kind === 'formula') {
        payload = `<${p}f>${escapeXml(value.slice(1))}</${p}f>`
      } else if (kind === 'text') {
        type = 'inlineStr'
        payload = `<${p}is><${p}t xml:space="preserve">${encodeSpreadsheet(value)}</${p}t></${p}is>`
      } else {
        type = kind === 'boolean' ? 'b' : 'n'
        payload = `<${p}v>${kind === 'boolean' ? (value.toUpperCase() === 'TRUE' ? '1' : '0') : escapeXml(value)}</${p}v>`
      }
    }
    let cell: string
    if (existing) {
      // Keep original attributes (notably style), extension data, and namespace declarations.
      const opening = this.xml
        .slice(existing.start, existing.openEnd)
        .replace(/\s+t\s*=\s*(?:"[^"]*"|'[^']*')/, '')
        .replace(/\/?\s*>$/, `${type ? ` t="${type}"` : ''}>`)
      let inner = this.xml.slice(existing.openEnd, existing.closeStart)
      for (const node of existing.children
        .filter((n) => n.local === 'v' || n.local === 'is' || n.local === 'f')
        .reverse())
        inner =
          inner.slice(0, node.start - existing.openEnd) + inner.slice(node.end - existing.openEnd)
      cell = opening + payload + inner + `</${existing.name}>`
      this.xml = this.xml.slice(0, existing.start) + cell + this.xml.slice(existing.end)
    } else {
      if (value === '') return false
      cell = `<${p}c r="${ref}"${type ? ` t="${type}"` : ''}>${payload}</${p}c>`
      const row = this.rows.get(point.row)
      if (row) {
        const next = children(row, 'c').find((n) => coordinates(n.attrs.r).column > point.column)
        this.xml = insertChild(this.xml, row, cell, next?.start ?? row.closeStart)
      } else {
        const next = children(this.data, 'row').find((n) => Number(n.attrs.r) > point.row)
        this.xml = insertChild(
          this.xml,
          this.data,
          `<${p}row r="${point.row}">${cell}</${p}row>`,
          next?.start ?? this.data.closeStart,
        )
      }
    }
    this.refresh()
    const dimension = child(this.root, 'dimension')
    if (dimension?.attrs.ref && !inside(ref, dimension.attrs.ref)) {
      const corners = dimension.attrs.ref.split(':').map(coordinates)
      const minColumn = Math.min(point.column, ...corners.map((n) => n.column))
      const minRow = Math.min(point.row, ...corners.map((n) => n.row))
      const maxColumn = Math.max(point.column, ...corners.map((n) => n.column))
      const maxRow = Math.max(point.row, ...corners.map((n) => n.row))
      const opening = this.xml
        .slice(dimension.start, dimension.end)
        .replace(
          /\bref\s*=\s*(?:"[^"]*"|'[^']*')/,
          `ref="${address(minColumn, minRow)}:${address(maxColumn, maxRow)}"`,
        )
      this.xml = this.xml.slice(0, dimension.start) + opening + this.xml.slice(dimension.end)
      this.refresh()
    }
    return true
  }

  applyCalculated(cells: CalculatedCell[]): void {
    const patches: { start: number; end: number; xml: string }[] = []
    for (const result of cells) {
      const existing = this.cells.get(result.ref)
      if (!existing || !child(existing, 'f')) continue
      const p = prefix(existing)
      const opening = this.xml
        .slice(existing.start, existing.openEnd)
        .replace(/\s+t\s*=\s*(?:"[^"]*"|'[^']*')/, '')
        .replace(/\/?\s*>$/, `${result.type !== 'n' ? ` t="${result.type}"` : ''}>`)
      let inner = this.xml.slice(existing.openEnd, existing.closeStart)
      for (const node of existing.children
        .filter((n) => n.local === 'v' || n.local === 'is')
        .reverse()) {
        inner =
          inner.slice(0, node.start - existing.openEnd) + inner.slice(node.end - existing.openEnd)
      }
      const formula = child(existing, 'f')!
      const insert = formula.end - existing.openEnd
      const value = `<${p}v>${escapeXml(result.value)}</${p}v>`
      inner = inner.slice(0, insert) + value + inner.slice(insert)
      patches.push({
        start: existing.start,
        end: existing.end,
        xml: opening + inner + `</${existing.name}>`,
      })
    }
    for (const patch of patches.sort((a, b) => b.start - a.start))
      this.xml = this.xml.slice(0, patch.start) + patch.xml + this.xml.slice(patch.end)
    this.refresh()
  }
}

export class Workbook {
  sheets: Sheet[] = []
  revision = 0
  calculationIssues: string[] = []
  private engine?: FormulaEngine
  private shared: string[] = []
  private richShared = new Set<number>()
  private workbookPath = ''
  private workbookXml = ''
  private worksheets = new Map<string, Worksheet>()
  private changed = new Set<string>()
  private history: { xmls: Map<string, string>; engine?: Uint8Array; issues: string[] }[] = []
  private constructor(
    private zip: JSZip,
    private original: Uint8Array,
  ) {}

  static async open(bytes: Uint8Array): Promise<Workbook> {
    if (bytes.length > MAX_INPUT) throw new Error('The workbook exceeds the 32 MB iPad limit.')
    await assertZipInflatesWithinLimits(bytes, LIMITS)
    assertUniqueZipPaths(bytes)
    const zip = await JSZip.loadAsync(bytes, { checkCRC32: true })
    for (const file of Object.values(zip.files)) {
      const originalName = (file as typeof file & { unsafeOriginalName?: string })
        .unsafeOriginalName
      if (originalName && originalName !== file.name)
        throw new Error('Unsupported archive entry path.')
    }
    if (Object.keys(zip.files).some((name) => name.startsWith('_xmlsignatures/')))
      throw new Error('Digitally signed workbooks cannot be edited on iPad.')
    const book = new Workbook(zip, bytes.slice())
    const read = async (path: string) => {
      const file = zip.file(path)
      if (!file) throw new Error(`Missing workbook part: ${path}`)
      return file.async('string')
    }
    const rootRels = parseXml(await read('_rels/.rels')).children[0]
    const office = children(rootRels, 'Relationship').find((n) =>
      n.attrs.Type.endsWith('/officeDocument'),
    )
    if (!office || office.attrs.TargetMode === 'External')
      throw new Error('This is not an XLSX workbook.')
    const path = partPath('', office.attrs.Target)
    const workbookXml = await read(path)
    book.workbookPath = path
    book.workbookXml = workbookXml
    const root = parseXml(workbookXml).children[0]
    if (root.local !== 'workbook') throw new Error('This is not an XLSX workbook.')
    const relPath = path.replace(/([^/]+)$/, '_rels/$1.rels')
    const rels = children(parseXml(await read(relPath)).children[0], 'Relationship')
    const sharedRel = rels.find(
      (n) => n.attrs.Type.endsWith('/sharedStrings') && n.attrs.TargetMode !== 'External',
    )
    if (sharedRel) {
      const xml = await read(partPath(path, sharedRel.attrs.Target))
      book.shared = children(parseXml(xml).children[0], 'si').map((n, index) => {
        if (n.children.some((c) => c.local === 'r')) book.richShared.add(index)
        return decodeSpreadsheet(richText(xml, n))
      })
    }
    for (const sheet of children(child(root, 'sheets') ?? root, 'sheet')) {
      const rid = Object.entries(sheet.attrs).find(([key]) => key.endsWith(':id'))?.[1]
      const rel = rels.find((n) => n.attrs.Id === rid)
      if (!rel || rel.attrs.TargetMode === 'External' || !rel.attrs.Type.endsWith('/worksheet'))
        continue
      book.sheets.push({
        name: sheet.attrs.name,
        path: partPath(path, rel.attrs.Target),
        hidden: sheet.attrs.state === 'hidden' || sheet.attrs.state === 'veryHidden',
      })
    }
    if (!book.sheets.some((sheet) => !sheet.hidden))
      throw new Error('The workbook has no visible worksheets.')
    for (const sheet of book.sheets) await book.worksheet(sheet)
    try {
      book.engine = FormulaEngine.open(bytes)
    } catch (error) {
      book.calculationIssues = [
        `IronCalc import: ${error instanceof Error ? error.message : String(error)}`,
      ]
    }
    if (!book.engine && !book.calculationIssues.length)
      book.calculationIssues = ['IronCalc calculation engine is not initialized.']
    book.inspectCalculation()
    return book
  }

  async worksheet(sheet: Sheet): Promise<Worksheet> {
    let result = this.worksheets.get(sheet.path)
    if (!result) {
      const file = this.zip.file(sheet.path)
      if (!file) throw new Error('The worksheet part is missing.')
      result = new Worksheet(await file.async('string'), this.shared, this.richShared)
      this.worksheets.set(sheet.path, result)
    }
    return result
  }

  edit(sheet: Sheet, ref: string, value: string, kind: ValueKind): boolean {
    if (kind === 'formula') {
      if (!this.engine) throw new Error(this.calculationIssues.join('\n'))
      const names = unsupportedFunctions(
        value,
        this.engine.model.getDefinedNameList().map((n) => n.name),
      )
      if (names.length) throw new Error(`Unsupported functions: ${names.join(', ')}`)
    }
    const previous = this.snapshot()
    try {
      const result = this.worksheets.get(sheet.path)?.setCell(ref, value, kind) ?? false
      if (!result) return false
      if (this.engine) {
        const point = coordinates(ref)
        this.engine.setInput(this.sheets.indexOf(sheet), point.row, point.column, value, kind)
        this.calculate()
      }
      this.history.push(previous)
      while (
        this.history.length > 20 ||
        this.history.reduce(
          (total, item) =>
            total +
            [...item.xmls.values()].reduce((n, xml) => n + xml.length * 2, 0) +
            (item.engine?.length ?? 0),
          0,
        ) >
          20 * 1024 * 1024
      )
        this.history.shift()
      for (const [path, worksheet] of this.worksheets)
        if (worksheet.xml !== previous.xmls.get(path)) this.changed.add(path)
      this.revision++
      return true
    } catch (error) {
      this.restore(previous)
      throw error
    }
  }

  private snapshot(): { xmls: Map<string, string>; engine?: Uint8Array; issues: string[] } {
    return {
      xmls: new Map([...this.worksheets].map(([path, sheet]) => [path, sheet.xml])),
      engine: this.engine?.snapshot(),
      issues: [...this.calculationIssues],
    }
  }

  private restore(previous: {
    xmls: Map<string, string>
    engine?: Uint8Array
    issues: string[]
  }): void {
    for (const [path, xml] of previous.xmls) {
      const worksheet = this.worksheets.get(path)!
      // Keep worksheet object identity so a visible grid never holds a discarded model.
      Object.assign(worksheet, new Worksheet(xml, this.shared, this.richShared))
    }
    if (previous.engine) {
      this.engine?.close()
      this.engine = FormulaEngine.restore(previous.engine)
    }
    this.calculationIssues = previous.issues
  }

  private inspectCalculation(): boolean {
    if (!this.engine) return false
    const issues: string[] = []
    const root = parseXml(this.workbookXml).children[0]
    if (['1', 'true'].includes(child(root, 'workbookPr')?.attrs.date1904 ?? ''))
      issues.push('date1904: IronCalc 0.9.1 cannot safely recalculate this date system.')
    const names = this.engine.model.getDefinedNameList().map((n) => n.name)
    for (const sheet of this.sheets) {
      const worksheet = this.worksheets.get(sheet.path)!
      for (const [ref, node] of worksheet.cells) {
        const formula = child(node, 'f')
        if (!formula) continue
        const text = content(worksheet.xml, formula)
        try {
          const unsupported = unsupportedFunctions(text, names)
          if (unsupported.length)
            issues.push(`${sheet.name}!${ref}: unsupported functions ${unsupported.join(', ')}`)
          if (/\[[^\]]+\][^!]*!/.test(text))
            issues.push(`${sheet.name}!${ref}: external workbook reference is unavailable offline.`)
        } catch {
          issues.push(`${sheet.name}!${ref}: formula cannot be parsed by IronCalc 0.9.1.`)
        }
      }
    }
    this.calculationIssues = issues
    return !issues.length
  }

  private calculate(): void {
    if (!this.inspectCalculation()) return
    const calculated = this.engine!.calculate()
    const gaps: string[] = []
    for (const [index, cells] of calculated)
      for (const cell of cells) {
        if (cell.array)
          gaps.push(
            `${this.sheets[index].name}!${cell.ref}: array/spill cache updates are not yet supported.`,
          )
        else if (cell.type === 'e' && /#N\/IMPL!|#ERROR!/.test(cell.value))
          gaps.push(`${this.sheets[index].name}!${cell.ref}: ${cell.value} (${cell.formula ?? ''})`)
      }
    if (gaps.length) {
      this.calculationIssues = gaps
      return
    }
    for (const [index, cells] of calculated)
      this.worksheets.get(this.sheets[index].path)!.applyCalculated(cells)
  }

  recalculateCaches(): boolean {
    const before = new Map([...this.worksheets].map(([path, sheet]) => [path, sheet.xml]))
    this.calculate()
    let changed = false
    for (const [path, sheet] of this.worksheets)
      if (before.get(path) !== sheet.xml) {
        this.changed.add(path)
        changed = true
      }
    if (changed) this.revision++
    return changed
  }

  get canUndo(): boolean {
    return this.history.length > 0
  }

  undo(): boolean {
    const previous = this.history.pop()
    if (!previous) return false
    this.restore(previous)
    for (const path of previous.xmls.keys()) this.changed.add(path)
    this.revision++
    return true
  }

  close(): void {
    this.engine?.close()
    this.engine = undefined
  }
  get calculationModel() {
    return this.engine?.model
  }

  async save(): Promise<{ bytes: Uint8Array; revision: number }> {
    const revision = this.revision
    if (!revision) return { bytes: this.original.slice(), revision }
    // Snapshot before the first await: later edits cannot leak into an older revision.
    const snapshot = new JSZip()
    for (const file of Object.values(this.zip.files))
      snapshot.file(file.name, file.async('uint8array'), {
        dir: file.dir,
        date: file.date,
        comment: file.comment,
        unixPermissions: file.unixPermissions,
        dosPermissions: file.dosPermissions,
        createFolders: false,
      })
    for (const path of this.changed)
      snapshot.file(path, this.worksheets.get(path)!.xml, {
        date: this.zip.file(path)!.date,
        createFolders: false,
      })
    snapshot.file(this.workbookPath, requestCalculation(this.workbookXml), {
      date: this.zip.file(this.workbookPath)!.date,
      createFolders: false,
    })
    return {
      bytes: await snapshot.generateAsync({
        type: 'uint8array',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
        comment: (this.zip as JSZip & { comment?: string }).comment,
      }),
      revision,
    }
  }
}
