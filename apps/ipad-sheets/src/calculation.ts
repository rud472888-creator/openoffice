import pako from 'pako'
import { initSync, Model, getTokens } from '../vendor/ironcalc-xlsx/wasm.js'
import registeredFunctions from '../vendor/ironcalc-xlsx/function-registry.json'
import { child, children, content, parseXml } from './xml'

let initialized = false
const registered = new Set(registeredFunctions)
// These functions are registered by IronCalc 0.9.1 but unconditionally return NIMPL.
const unavailable = new Set([
  'FORECAST.ETS',
  'FORECAST.ETS.CONFINT',
  'FORECAST.ETS.SEASONALITY',
  'FORECAST.ETS.STAT',
])
export interface CalculatedCell {
  ref: string
  value: string
  type: 'n' | 'str' | 'b' | 'e'
  formula?: string
  array: boolean
}

export function initializeCalculation(bytes: Uint8Array): void {
  initSync({ module: bytes })
  initialized = true
}

export function unsupportedFunctions(formula: string, definedNames: string[] = []): string[] {
  const tokens = getTokens(formula.replace(/^=/, ''))
  const localNames = new Set(definedNames.map((name) => name.toUpperCase()))
  // LET/LAMBDA parameters precede commas rather than a call parenthesis.
  if (
    tokens.some(
      (token) =>
        typeof token.token === 'object' &&
        'Ident' in token.token &&
        /^(LET|LAMBDA)$/i.test(token.token.Ident),
    )
  ) {
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i].token
      if (typeof token === 'object' && 'Ident' in token && tokens[i + 1]?.token === 'Comma')
        localNames.add(token.Ident.toUpperCase())
    }
  }
  const unsupported = new Set<string>()
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i].token
    if (
      typeof token !== 'object' ||
      !('Ident' in token) ||
      tokens[i + 1]?.token !== 'LeftParenthesis'
    )
      continue
    const name = token.Ident.toUpperCase()
      .replace(/^_XLFN\./, '')
      .replace(/^_XLWS\./, '')
    if ((!registered.has(name) && !localNames.has(name)) || unavailable.has(name))
      unsupported.add(name)
  }
  return [...unsupported].sort()
}

/** Reads only trusted, size-bounded engine output; input archives use the shared ZIP gate. */
function engineXmlParts(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = bytes.length - 22
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--
  if (end < 0) throw new Error('IronCalc returned an invalid archive.')
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const decoder = new TextDecoder()
  const result = new Map<string, string>()
  let total = 0
  for (let i = 0; i < count; i++) {
    const nameLength = view.getUint16(at + 28, true)
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength))
    const size = view.getUint32(at + 24, true)
    const compressed = view.getUint32(at + 20, true)
    const method = view.getUint16(at + 10, true)
    const local = view.getUint32(at + 42, true)
    if (name.startsWith('xl/worksheets/') && name.endsWith('.xml')) {
      total += size
      if (size > 12 * 1024 * 1024 || total > 64 * 1024 * 1024)
        throw new Error('Calculation output exceeds the iPad memory limit.')
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
      const raw = bytes.subarray(start, start + compressed)
      const data = method === 0 ? raw : method === 8 ? pako.inflateRaw(raw) : undefined
      if (!data || data.length !== size) throw new Error('IronCalc returned an invalid worksheet.')
      result.set(name, decoder.decode(data))
    }
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
  }
  return result
}

export class FormulaEngine {
  private constructor(readonly model: Model) {}

  static open(bytes: Uint8Array): FormulaEngine | undefined {
    if (!initialized) return undefined
    return new FormulaEngine(Model.fromXlsx(bytes, 'Workbook', 'en', 'UTC', 'en'))
  }

  static restore(bytes: Uint8Array): FormulaEngine {
    return new FormulaEngine(Model.fromBytes(bytes, 'en'))
  }

  setInput(sheet: number, row: number, column: number, value: string, kind: string): void {
    this.model.setUserInput(sheet, row, column, kind === 'text' && value ? `'${value}` : value)
  }

  calculate(includeLiterals = false): Map<number, CalculatedCell[]> {
    this.model.evaluate()
    const exported = engineXmlParts(this.model.toXlsx())
    const result = new Map<number, CalculatedCell[]>()
    const sheets = this.model.getWorksheetsProperties()
    for (let index = 0; index < sheets.length; index++) {
      const xml = exported.get(`xl/worksheets/sheet${index + 1}.xml`)
      if (!xml) throw new Error('IronCalc did not export every worksheet.')
      const root = parseXml(xml).children[0]
      const data = child(root, 'sheetData')
      const cells: CalculatedCell[] = []
      if (!data) continue
      for (const row of children(data, 'row')) {
        for (const cell of children(row, 'c')) {
          const formula = child(cell, 'f')
          const ref = cell.attrs.r
          const match = /^([A-Z]+)(\d+)$/.exec(ref)!
          let column = 0
          for (const char of match[1]) column = column * 26 + char.charCodeAt(0) - 64
          const structure = this.model.getCellArrayStructure(index, Number(match[2]), column)
          const scalarAnchor =
            typeof structure === 'object' &&
            (('DynamicAnchor' in structure && structure.DynamicAnchor.every((n) => n === 1)) ||
              ('ArrayAnchor' in structure && structure.ArrayAnchor.every((n) => n === 1)))
          const array = structure !== 'SingleCell' && !scalarAnchor
          if (!formula && !array && !includeLiterals) continue
          const type = cell.attrs.t ?? 'n'
          if (!['n', 'str', 'b', 'e'].includes(type))
            throw new Error(`Unsupported calculated result type: ${type}`)
          cells.push({
            ref,
            type: type as CalculatedCell['type'],
            value: content(xml, child(cell, 'v')),
            formula: formula ? content(xml, formula) : undefined,
            array,
          })
        }
      }
      result.set(index, cells)
    }
    return result
  }

  snapshot(): Uint8Array {
    return this.model.toBytes()
  }
  close(): void {
    this.model.free()
  }
}
