import JSZip from 'jszip'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { readSheetProtection } from '../../../packages/xlsx-gateway/src/gateway/xlsx-protection'
import {
  workbookFileSchema,
  workbookRangeResultSchema,
  type WorkbookFile,
  type WorkbookCellStyle,
  type WorkbookRangeResult,
  type WorkbookRangeRequest,
} from '../../sheets/src/shared/desktop-api'
import { Workbook, coordinates } from './workbook'
import { drawingVisuals } from './desktop-drawings'
import { child, children, content, parseXml, type XmlNode } from './xml'

type Area = { startRow: number; startColumn: number; endRow: number; endColumn: number }
export function rangeArea(ref: string): Area {
  const [start, end = start] = ref.split(':').map(coordinates)
  return {
    startRow: start.row - 1,
    startColumn: start.column - 1,
    endRow: end.row - 1,
    endColumn: end.column - 1,
  }
}
const on = (value: string | undefined): boolean => value === '1' || value === 'true'
const off = (value: string | undefined): boolean => value === '0' || value === 'false'
const number = (value: string | undefined): number | undefined =>
  value === undefined ? undefined : Number(value)
const descend = (node: XmlNode, local: string): XmlNode[] => [
  ...children(node, local),
  ...node.children.flatMap((n) => descend(n, local)),
]
const attributeId = (node: XmlNode): string | undefined =>
  Object.entries(node.attrs).find(([name]) => name.endsWith(':id'))?.[1]

export class DesktopWorkbook {
  file!: WorkbookFile
  sheetPaths = new Map<string, string>()
  private roots = new Map<string, XmlNode>()
  private xmls = new Map<string, string>()
  private ranges = new Map<string, WorkbookRangeResult>()
  private themeColors: string[] = []
  readonly unsupported: string[] = []
  readonly unsafeSections = new Map<string, Set<string>>()
  private constructor(
    readonly bytes: Uint8Array,
    readonly book: Workbook,
    readonly zip: JSZip,
  ) {}

  static async open(bytes: Uint8Array, name: string): Promise<DesktopWorkbook> {
    const book = await Workbook.open(bytes)
    const zip = await JSZip.loadAsync(bytes)
    const result = new DesktopWorkbook(bytes, book, zip)
    await result.initialize(name)
    return result
  }

  private async text(path: string): Promise<string> {
    return (await this.zip.file(path)?.async('string')) ?? ''
  }
  private async root(path: string): Promise<XmlNode> {
    return parseXml(await this.text(path)).children[0]
  }
  private async rels(
    path: string,
  ): Promise<Map<string, { path: string; type: string; external: boolean }>> {
    const relPath = path.replace(/([^/]+)$/, '_rels/$1.rels')
    const xml = await this.text(relPath)
    if (!xml) return new Map()
    const result = new Map<string, { path: string; type: string; external: boolean }>()
    for (const rel of children(parseXml(xml).children[0], 'Relationship')) {
      const external = rel.attrs.TargetMode === 'External'
      const segments = rel.attrs.Target.startsWith('/') ? [] : path.split('/').slice(0, -1)
      for (const segment of rel.attrs.Target.split('/')) {
        if (segment === '..') segments.pop()
        else if (segment && segment !== '.') segments.push(segment)
      }
      result.set(rel.attrs.Id, {
        path: external ? rel.attrs.Target : segments.join('/'),
        type: rel.attrs.Type,
        external,
      })
    }
    return result
  }

  private color(node?: XmlNode): string | undefined {
    if (!node) return undefined
    let value = node.attrs.rgb ?? (node.local === 'srgbClr' ? node.attrs.val : undefined)
    if (value) return `#${value.slice(-6)}`
    if (node.attrs.theme !== undefined) value = this.themeColors[Number(node.attrs.theme)]?.slice(1)
    if (node.local === 'schemeClr') {
      const index = [
        'lt1',
        'dk1',
        'lt2',
        'dk2',
        'accent1',
        'accent2',
        'accent3',
        'accent4',
        'accent5',
        'accent6',
        'hlink',
        'folHlink',
      ].indexOf(node.attrs.val)
      value = this.themeColors[index]?.slice(1)
    }
    if (node.local === 'sysClr') value = node.attrs.lastClr
    if (!value && node.attrs.indexed !== undefined)
      value = ['000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF'][
        Number(node.attrs.indexed) % 8
      ]
    if (!value) return undefined
    const tint = Number(node.attrs.tint ?? 0)
    if (tint)
      value = value
        .match(/../g)!
        .map((hex) => {
          const channel = parseInt(hex, 16)
          return Math.round(tint < 0 ? channel * (1 + tint) : channel + (255 - channel) * tint)
            .toString(16)
            .padStart(2, '0')
        })
        .join('')
    return `#${value}`
  }

  private style(
    font: XmlNode | undefined,
    fill: XmlNode | undefined,
    border: XmlNode | undefined,
    alignment: XmlNode | undefined,
    numFmt?: string,
  ): WorkbookCellStyle {
    const present = (local: string): boolean =>
      !!font && !!child(font, local) && !off(child(font, local)!.attrs.val)
    const edge = (local: string) => {
      const node = border && child(border, local)
      return node?.attrs.style
        ? { style: node.attrs.style, color: this.color(child(node, 'color')) }
        : undefined
    }
    return {
      fontFamily: font && child(font, 'name')?.attrs.val,
      fontSize: number(font && child(font, 'sz')?.attrs.val),
      bold: present('b'),
      italic: present('i'),
      underline: present('u'),
      strikethrough: present('strike'),
      wrapText: on(alignment?.attrs.wrapText),
      fontColor: font && this.color(child(font, 'color')),
      fillColor: fill && this.color(child(child(fill, 'patternFill') ?? fill, 'fgColor')),
      horizontalAlignment: alignment?.attrs.horizontal,
      verticalAlignment: alignment?.attrs.vertical,
      indent: number(alignment?.attrs.indent),
      numberFormat: numFmt,
      borderTop: edge('top'),
      borderBottom: edge('bottom'),
      borderLeft: edge('left'),
      borderRight: edge('right'),
      borderDiagonal: edge('diagonal'),
      diagonalUp: on(border?.attrs.diagonalUp),
      diagonalDown: on(border?.attrs.diagonalDown),
    }
  }

  private async styles(
    path: string,
  ): Promise<{ styles: WorkbookCellStyle[]; dxfStyles: WorkbookCellStyle[] }> {
    const xml = await this.text(path)
    const blank = this.style(undefined, undefined, undefined, undefined)
    if (!xml) return { styles: [blank], dxfStyles: [] }
    const root = parseXml(xml).children[0]
    const fonts = children(child(root, 'fonts') ?? root, 'font'),
      fills = children(child(root, 'fills') ?? root, 'fill'),
      borders = children(child(root, 'borders') ?? root, 'border')
    const formats = new Map(
      children(child(root, 'numFmts') ?? root, 'numFmt').map((n) => [
        Number(n.attrs.numFmtId),
        n.attrs.formatCode,
      ]),
    )
    const builtins: Record<number, string> = {
      0: 'General',
      1: '0',
      2: '0.00',
      3: '#,##0',
      4: '#,##0.00',
      9: '0%',
      10: '0.00%',
      11: '0.00E+00',
      12: '# ?/?',
      13: '# ??/??',
      14: 'm/d/yy',
      15: 'd-mmm-yy',
      16: 'd-mmm',
      17: 'mmm-yy',
      18: 'h:mm AM/PM',
      19: 'h:mm:ss AM/PM',
      20: 'h:mm',
      21: 'h:mm:ss',
      22: 'm/d/yy h:mm',
      37: '#,##0 ;(#,##0)',
      38: '#,##0 ;[Red](#,##0)',
      39: '#,##0.00;(#,##0.00)',
      40: '#,##0.00;[Red](#,##0.00)',
      45: 'mm:ss',
      46: '[h]:mm:ss',
      47: 'mmss.0',
      48: '##0.0E+0',
      49: '@',
    }
    const styles = children(child(root, 'cellXfs') ?? root, 'xf').map((xf) =>
      this.style(
        fonts[Number(xf.attrs.fontId ?? 0)],
        fills[Number(xf.attrs.fillId ?? 0)],
        borders[Number(xf.attrs.borderId ?? 0)],
        child(xf, 'alignment'),
        formats.get(Number(xf.attrs.numFmtId ?? 0)) ?? builtins[Number(xf.attrs.numFmtId ?? 0)],
      ),
    )
    const dxfStyles = children(child(root, 'dxfs') ?? root, 'dxf').map((dxf) =>
      this.style(
        child(dxf, 'font'),
        child(dxf, 'fill'),
        child(dxf, 'border'),
        child(dxf, 'alignment'),
        child(dxf, 'numFmt')?.attrs.formatCode,
      ),
    )
    return { styles: styles.length ? styles : [blank], dxfStyles }
  }

  private async initialize(name: string): Promise<void> {
    const workbookPath =
      Object.keys(this.zip.files).find((p) => p.endsWith('/workbook.xml')) ?? 'xl/workbook.xml'
    const workbookXml = await this.text(workbookPath),
      root = parseXml(workbookXml).children[0]
    const rels = await this.rels(workbookPath)
    const themeRel = [...rels.values()].find((r) => r.type.endsWith('/theme'))
    let themeFonts: WorkbookFile['themeFonts']
    if (themeRel) {
      const theme = await this.root(themeRel.path)
      const colors = descend(theme, 'clrScheme')[0]
      this.themeColors = colors
        ? [
            'lt1',
            'dk1',
            'lt2',
            'dk2',
            'accent1',
            'accent2',
            'accent3',
            'accent4',
            'accent5',
            'accent6',
            'hlink',
            'folHlink',
          ].map((key) => {
            const color = child(colors, key)?.children[0]
            return `#${color?.attrs.lastClr ?? color?.attrs.val ?? '000000'}`
          })
        : []
      const major = descend(theme, 'majorFont')[0],
        minor = descend(theme, 'minorFont')[0]
      themeFonts = {
        major: (major && child(major, 'latin')?.attrs.typeface) || 'Arial',
        minor: (minor && child(minor, 'latin')?.attrs.typeface) || 'Arial',
      }
    }
    const styleRel = [...rels.values()].find((r) => r.type.endsWith('/styles'))
    const styles = await this.styles(styleRel?.path ?? 'xl/styles.xml')
    const definedNames = children(child(root, 'definedNames') ?? root, 'definedName').map((n) => ({
      name: n.attrs.name,
      formula: content(workbookXml, n),
      sheetIndex: number(n.attrs.localSheetId),
    }))
    const sheets: WorkbookFile['sheets'] = []
    const visuals: WorkbookFile['visuals'] = []
    const pivotCaches = new Map(
      children(child(root, 'pivotCaches') ?? root, 'pivotCache').map((node) => [
        node.attrs.cacheId,
        rels.get(attributeId(node) ?? '')?.path,
      ]),
    )
    const sharedRel = [...rels.values()].find((r) => r.type.endsWith('/sharedStrings'))
    const sharedXml = sharedRel ? await this.text(sharedRel.path) : ''
    const sharedNodes = sharedXml ? children(parseXml(sharedXml).children[0], 'si') : []
    const richRuns = (textXml: string, node: XmlNode | undefined) =>
      node?.children.some((n) => n.local === 'r')
        ? children(node, 'r').map((r) => {
            const properties = child(r, 'rPr')
            return {
              text: content(textXml, child(r, 't')),
              bold: !!properties && !!child(properties, 'b'),
              italic: !!properties && !!child(properties, 'i'),
              underline: !!properties && !!child(properties, 'u'),
              strikethrough: !!properties && !!child(properties, 'strike'),
              fontFamily: properties && child(properties, 'rFont')?.attrs.val,
              fontSize: number(properties && child(properties, 'sz')?.attrs.val),
              color: properties && this.color(child(properties, 'color')),
            }
          })
        : undefined
    for (const node of children(child(root, 'sheets') ?? root, 'sheet')) {
      const rel = rels.get(attributeId(node) ?? '')
      if (!rel || !rel.type.endsWith('/worksheet')) continue
      const index = sheets.length,
        bookSheet = this.book.sheets[index],
        worksheet = await this.book.worksheet(bookSheet)
      const id = `sheet-${node.attrs.sheetId}`,
        xml = worksheet.xml,
        sheetRoot = parseXml(xml).children[0]
      this.sheetPaths.set(id, rel.path)
      this.xmls.set(id, xml)
      this.roots.set(id, sheetRoot)
      const view = children(child(sheetRoot, 'sheetViews') ?? sheetRoot, 'sheetView')[0],
        format = child(sheetRoot, 'sheetFormatPr'),
        pane = view && child(view, 'pane')
      const sheetRels = await this.rels(rel.path)
      for (const drawing of children(sheetRoot, 'drawing')) {
        const drawingRel = sheetRels.get(attributeId(drawing) ?? '')
        if (!drawingRel || drawingRel.external) continue
        const drawingRoot = await this.root(drawingRel.path)
        if (descend(drawingRoot, 'grpSp').length)
          this.unsupported.push(
            `${node.attrs.name}: grouped drawing geometry is preserved but not displayed.`,
          )
        visuals.push(
          ...(await drawingVisuals(id, drawingRel.path, {
            root: (path) => this.root(path),
            text: (path) => this.text(path),
            rels: (path) => this.rels(path),
            color: (node) => this.color(node),
          })),
        )
      }
      const tables: WorkbookFile['sheets'][number]['tables'] = []
      for (const part of children(child(sheetRoot, 'tableParts') ?? sheetRoot, 'tablePart')) {
        const relation = sheetRels.get(attributeId(part) ?? '')
        if (!relation) continue
        const table = await this.root(relation.path),
          style = child(table, 'tableStyleInfo')
        tables.push({
          range: rangeArea(table.attrs.ref),
          headerRowCount: Number(table.attrs.headerRowCount ?? 1),
          showRowStripes: on(style?.attrs.showRowStripes),
          showColumnStripes: on(style?.attrs.showColumnStripes),
          name: table.attrs.displayName ?? table.attrs.name,
          columns: children(child(table, 'tableColumns') ?? table, 'tableColumn').map(
            (c) => c.attrs.name,
          ),
          styleName: style?.attrs.name,
          totalsRowCount: number(table.attrs.totalsRowCount),
        })
      }
      const comments: WorkbookFile['sheets'][number]['comments'] = []
      const commentRel = [...sheetRels.values()].find((r) => r.type.endsWith('/comments'))
      if (commentRel) {
        const commentXml = await this.text(commentRel.path),
          commentsRoot = parseXml(commentXml).children[0]
        const authors = children(child(commentsRoot, 'authors') ?? commentsRoot, 'author').map(
          (n) => content(commentXml, n),
        )
        for (const comment of children(
          child(commentsRoot, 'commentList') ?? commentsRoot,
          'comment',
        )) {
          const point = coordinates(comment.attrs.ref)
          comments.push({
            row: point.row - 1,
            column: point.column - 1,
            author: authors[Number(comment.attrs.authorId)] ?? '',
            text: descend(comment, 't')
              .map((n) => content(commentXml, n))
              .join(''),
          })
        }
      }
      const pivotTables: WorkbookFile['sheets'][number]['pivotTables'] = []
      for (const part of children(
        child(sheetRoot, 'pivotTableParts') ?? sheetRoot,
        'pivotTablePart',
      )) {
        const relation = sheetRels.get(attributeId(part) ?? '')
        if (!relation) continue
        const pivot = await this.root(relation.path),
          location = child(pivot, 'location')
        if (location)
          pivotTables.push({
            path: relation.path,
            cachePath: pivotCaches.get(pivot.attrs.cacheId) ?? null,
            outputRef: location.attrs.ref,
          })
      }
      const columns = children(child(sheetRoot, 'cols') ?? sheetRoot, 'col').map((c) => ({
        startColumn: Number(c.attrs.min) - 1,
        endColumn: Number(c.attrs.max) - 1,
        width: number(c.attrs.width),
        hidden: on(c.attrs.hidden),
        outlineLevel: number(c.attrs.outlineLevel) || undefined,
        collapsed: on(c.attrs.collapsed),
        styleIndex: number(c.attrs.style) || undefined,
      }))
      const protection = readSheetProtection(xml)
      const result: WorkbookRangeResult = {
        cells: [],
        rows: children(child(sheetRoot, 'sheetData') ?? sheetRoot, 'row').map((r) => ({
          row: Number(r.attrs.r) - 1,
          height: number(r.attrs.ht),
          customHeight: on(r.attrs.customHeight),
          hidden: on(r.attrs.hidden),
          outlineLevel: number(r.attrs.outlineLevel) || undefined,
          collapsed: on(r.attrs.collapsed),
          styleIndex: number(r.attrs.s) || undefined,
        })),
        merges: children(child(sheetRoot, 'mergeCells') ?? sheetRoot, 'mergeCell').map((m) =>
          rangeArea(m.attrs.ref),
        ),
        hyperlinks: [],
        conditionalRules: [],
        autoFilter: child(sheetRoot, 'autoFilter')?.attrs.ref
          ? rangeArea(child(sheetRoot, 'autoFilter')!.attrs.ref)
          : null,
        autoFilterColumns: [],
        dataValidations: [],
        pageSetup: null,
        protectedRanges: children(
          child(sheetRoot, 'protectedRanges') ?? sheetRoot,
          'protectedRange',
        ).map((n) => ({
          name: n.attrs.name,
          sqref: n.attrs.sqref,
          hasPassword: !!n.attrs.password || !!n.attrs.hashValue,
        })),
        sheetProtection: protection
          ? {
              protected: protection.protected,
              allow: protection.allow,
              hasPassword: !!protection.password,
              password: protection.password ?? undefined,
            }
          : null,
        rowBreaks: children(child(sheetRoot, 'rowBreaks') ?? sheetRoot, 'brk').map((n) =>
          Number(n.attrs.id),
        ),
        colBreaks: children(child(sheetRoot, 'colBreaks') ?? sheetRoot, 'brk').map((n) =>
          Number(n.attrs.id),
        ),
        indexedThroughRow: worksheet.maxRow - 1,
        indexingComplete: true,
      }
      for (const [ref, cell] of worksheet.cells) {
        const point = coordinates(ref),
          value = worksheet.cell(ref)
        const cached =
          cell.attrs.t === 'b'
            ? value.value === 'TRUE'
            : (!cell.attrs.t || cell.attrs.t === 'n') && value.value !== ''
              ? Number(value.value)
              : value.value || null
        let formula = value.formula === undefined ? undefined : `=${value.formula}`
        if (formula === '=')
          formula =
            this.book.calculationModel?.getCellContent(index, point.row, point.column) || formula
        result.cells.push({
          row: point.row - 1,
          column: point.column - 1,
          value: cached,
          formula,
          styleIndex: number(cell.attrs.s),
          arrayRef: child(cell, 'f')?.attrs.ref,
          rich:
            cell.attrs.t === 's'
              ? richRuns(sharedXml, sharedNodes[Number(content(xml, child(cell, 'v')))])
              : richRuns(xml, child(cell, 'is')),
        })
      }
      for (const link of children(child(sheetRoot, 'hyperlinks') ?? sheetRoot, 'hyperlink')) {
        const target = sheetRels.get(attributeId(link) ?? '')?.path ?? link.attrs.location
        if (!target) continue
        const area = rangeArea(link.attrs.ref)
        result.hyperlinks.push({ row: area.startRow, column: area.startColumn, target })
      }
      for (const validation of children(
        child(sheetRoot, 'dataValidations') ?? sheetRoot,
        'dataValidation',
      ))
        result.dataValidations.push({
          ranges: validation.attrs.sqref.split(/\s+/).map(rangeArea),
          ruleType: validation.attrs.type ?? 'none',
          operator: validation.attrs.operator,
          formulas: validation.children
            .filter((n) => n.local === 'formula1' || n.local === 'formula2')
            .map((n) => content(xml, n)),
          allowBlank: on(validation.attrs.allowBlank),
          suppressDropdown: on(validation.attrs.showDropDown),
          showInputMessage: on(validation.attrs.showInputMessage),
          showErrorMessage: on(validation.attrs.showErrorMessage),
          errorStyle: validation.attrs.errorStyle,
          errorTitle: validation.attrs.errorTitle,
          error: validation.attrs.error,
          promptTitle: validation.attrs.promptTitle,
          prompt: validation.attrs.prompt,
        })
      for (const cf of children(sheetRoot, 'conditionalFormatting'))
        for (const rule of children(cf, 'cfRule')) {
          const details = rule.children.find((n) =>
            ['colorScale', 'dataBar', 'iconSet'].includes(n.local),
          )
          result.conditionalRules.push({
            ranges: cf.attrs.sqref.split(/\s+/).map(rangeArea),
            ruleType: rule.attrs.type,
            operator: rule.attrs.operator,
            formulas: children(rule, 'formula').map((n) => content(xml, n)),
            text: rule.attrs.text,
            dxfIndex: number(rule.attrs.dxfId),
            priority: Number(rule.attrs.priority ?? 1),
            stopIfTrue: on(rule.attrs.stopIfTrue),
            rank: number(rule.attrs.rank),
            percent: on(rule.attrs.percent),
            bottom: on(rule.attrs.bottom),
            cfvos: details
              ? children(details, 'cfvo').map((n) => ({
                  kind: n.attrs.type,
                  value: n.attrs.val,
                  gte: !off(n.attrs.gte),
                }))
              : [],
            colors: details
              ? children(details, 'color').map((n) => this.color(n) ?? '#000000')
              : [],
            iconSetName: details?.attrs.iconSet,
            iconReverse: on(details?.attrs.reverse),
            showValue: !off(details?.attrs.showValue),
          })
        }
      const unsafe = new Set<string>()
      if (descend(sheetRoot, 'cfRule').length > result.conditionalRules.length) unsafe.add('cf')
      if (descend(sheetRoot, 'dataValidation').length > result.dataValidations.length)
        unsafe.add('dv')
      if (unsafe.size) {
        this.unsafeSections.set(id, unsafe)
        this.unsupported.push(
          `${node.attrs.name}: extension ${[...unsafe].join('/')} rules are preserved; editing those rule sections is disabled.`,
        )
      }
      const pageSetup = child(sheetRoot, 'pageSetup'),
        margins = child(sheetRoot, 'pageMargins'),
        printOptions = child(sheetRoot, 'printOptions'),
        headers = child(sheetRoot, 'headerFooter')
      if (pageSetup || margins || headers || printOptions)
        result.pageSetup = {
          orientation: pageSetup?.attrs.orientation as 'portrait' | 'landscape' | undefined,
          paperSize: number(pageSetup?.attrs.paperSize),
          scale: number(pageSetup?.attrs.scale),
          fitToWidth: number(pageSetup?.attrs.fitToWidth),
          fitToHeight: number(pageSetup?.attrs.fitToHeight),
          printGridlines: on(printOptions?.attrs.gridLines),
          printHeadings: on(printOptions?.attrs.headings),
          ...(margins
            ? {
                margins: {
                  left: Number(margins.attrs.left),
                  right: Number(margins.attrs.right),
                  top: Number(margins.attrs.top),
                  bottom: Number(margins.attrs.bottom),
                  header: Number(margins.attrs.header),
                  footer: Number(margins.attrs.footer),
                },
              }
            : {}),
          ...(headers
            ? Object.fromEntries(
                [
                  'oddHeader',
                  'oddFooter',
                  'evenHeader',
                  'evenFooter',
                  'firstHeader',
                  'firstFooter',
                ].flatMap((key) => {
                  const node = child(headers, key)
                  return node ? [[key, content(xml, node)]] : []
                }),
              )
            : {}),
          differentOddEven: on(headers?.attrs.differentOddEven),
          differentFirst: on(headers?.attrs.differentFirst),
        }
      this.ranges.set(id, workbookRangeResultSchema.parse(result))
      sheets.push({
        id,
        name: node.attrs.name,
        rowCount: Math.max(1, worksheet.maxRow),
        columnCount: Math.max(1, worksheet.maxColumn),
        storedCellCount: worksheet.cells.size,
        valueCellCount: result.cells.filter((c) => c.value !== null || c.formula).length,
        valueRowCount: worksheet.maxRow,
        valueColumnCount: worksheet.maxColumn,
        sourceXmlBytes: new TextEncoder().encode(xml).length,
        columnWidths: columns,
        defaultRowHeight: number(format?.attrs.defaultRowHeight) ?? null,
        defaultColumnWidth: number(format?.attrs.defaultColWidth) ?? null,
        baseColumnWidth: number(format?.attrs.baseColWidth) ?? null,
        freeze:
          pane && (pane.attrs.state === 'frozen' || pane.attrs.state === 'frozenSplit')
            ? {
                frozenColumns: Number(pane.attrs.xSplit ?? 0),
                frozenRows: Number(pane.attrs.ySplit ?? 0),
              }
            : null,
        hidden: node.attrs.state === 'hidden' || node.attrs.state === 'veryHidden',
        veryHidden: node.attrs.state === 'veryHidden',
        tabColor: this.color(child(child(sheetRoot, 'sheetPr') ?? sheetRoot, 'tabColor')) ?? null,
        showGridLines: !off(view?.attrs.showGridLines),
        showRowColHeaders: !off(view?.attrs.showRowColHeaders),
        showFormulas: on(view?.attrs.showFormulas),
        rightToLeft: on(view?.attrs.rightToLeft),
        tables,
        comments,
        pivotTables,
        sparklines: [],
        cellImages: [],
        pivotRanges: pivotTables.map((p) => rangeArea(p.outputRef)),
        hasScopedDefinedNames: definedNames.some((n) => n.sheetIndex === index),
      })
    }
    this.file = workbookFileSchema.parse({
      sessionId: crypto.randomUUID(),
      name,
      path: `/Documents/${name}`,
      sha256: bytesToHex(sha256(this.bytes)),
      fileBytes: this.bytes.length,
      entryCount: Object.keys(this.zip.files).length,
      sheets,
      ...styles,
      visuals,
      definedNames: definedNames.filter((n) => !n.name.startsWith('_xlnm.')),
      readOnly: false,
      activeTab: Number(
        child(child(root, 'bookViews') ?? root, 'workbookView')?.attrs.activeTab ?? 0,
      ),
      themeColors: this.themeColors.length === 12 ? this.themeColors : undefined,
      themeFonts,
      date1904: on(child(root, 'workbookPr')?.attrs.date1904),
    })
  }

  read(request: WorkbookRangeRequest): WorkbookRangeResult {
    const result = this.ranges.get(request.sheetId)
    if (!result) throw new Error(`Unknown worksheet: ${request.sheetId}`)
    const range = request.range
    return {
      ...result,
      cells: result.cells.filter(
        (c) =>
          c.row >= range.startRow &&
          c.row <= range.endRow &&
          c.column >= range.startColumn &&
          c.column <= range.endColumn,
      ),
      rows: result.rows.filter((r) => r.row >= range.startRow && r.row <= range.endRow),
    }
  }
  fullRange(id: string): WorkbookRangeResult {
    const result = this.ranges.get(id)
    if (!result) throw new Error(`Unknown worksheet: ${id}`)
    return result
  }
  async readMedia(id: string): Promise<{ base64: string; mediaType: string }> {
    const visual = this.file.visuals.find((v) => v.id === id),
      path = visual?.mediaPath ?? visual?.fillMediaPath
    if (!path) throw new Error('Workbook image is unavailable.')
    const part = this.zip.file(path)
    if (!part) throw new Error('Workbook image part is missing.')
    return {
      base64: await part.async('base64'),
      mediaType: visual?.mediaType ?? visual?.fillMediaType ?? 'image/png',
    }
  }
}
