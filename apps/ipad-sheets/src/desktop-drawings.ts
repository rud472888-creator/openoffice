import type { WorkbookVisualObject } from '../../sheets/src/shared/desktop-api'
import { child, children, content, type XmlNode } from './xml'

export interface PartRelationship {
  path: string
  type: string
  external: boolean
}
interface DrawingReader {
  root(path: string): Promise<XmlNode>
  text(path: string): Promise<string>
  rels(path: string): Promise<Map<string, PartRelationship>>
  color(node?: XmlNode): string | undefined
}
const descendants = (node: XmlNode, local: string): XmlNode[] => [
  ...children(node, local),
  ...node.children.flatMap((n) => descendants(n, local)),
]
const id = (node?: XmlNode): string | undefined =>
  node &&
  Object.entries(node.attrs).find(([key]) => key.endsWith(':id') || key.endsWith(':embed'))?.[1]
const first = (node: XmlNode, local: string): XmlNode | undefined => descendants(node, local)[0]
const mediaType = (path: string): string =>
  ({
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    emf: 'image/x-emf',
    wmf: 'image/x-wmf',
  })[path.split('.').pop()!.toLowerCase()] ?? 'image/png'

async function chart(
  path: string,
  reader: DrawingReader,
): Promise<NonNullable<WorkbookVisualObject['chart']>> {
  const xml = await reader.text(path),
    root = await reader.root(path),
    plot = first(root, 'plotArea')
  if (!plot) throw new Error(`Chart ${path} has no plot area.`)
  const plots = plot.children.filter((node) => /Chart$/.test(node.local))
  const labelText = (node?: XmlNode): string =>
    node
      ? descendants(node, 't')
          .map((n) => content(xml, n))
          .join('')
      : ''
  const cached = (node?: XmlNode): string[] => {
    if (!node) return []
    const cache =
      first(node, 'strCache') ??
      first(node, 'numCache') ??
      first(node, 'strLit') ??
      first(node, 'numLit')
    if (!cache) return []
    const points = children(cache, 'pt').map((p) => ({
      index: Number(p.attrs.idx),
      value: content(xml, child(p, 'v')),
    }))
    const count = Math.min(20000, Number(child(cache, 'ptCount')?.attrs.val ?? points.length))
    const values = Array.from({ length: count }, () => '')
    for (const point of points) if (point.index < count) values[point.index] = point.value
    return values
  }
  const series: NonNullable<WorkbookVisualObject['chart']>['series'] = []
  for (const group of plots)
    for (const ser of children(group, 'ser')) {
      const values = child(ser, 'val') ?? child(ser, 'yVal'),
        categories = child(ser, 'cat') ?? child(ser, 'xVal'),
        tx = child(ser, 'tx')
      const raw = cached(values),
        shape = child(ser, 'spPr'),
        line = shape && child(shape, 'ln')
      series.push({
        name: tx ? content(xml, child(tx, 'v')) || cached(tx)[0] || '' : '',
        nameRef: tx ? content(xml, first(tx, 'f')) || undefined : undefined,
        categories: cached(categories),
        values: raw.map((n) => Number(n) || 0),
        blanks: raw.flatMap((n, index) => (n === '' ? [index] : [])),
        valuesRef: values ? content(xml, first(values, 'f')) || undefined : undefined,
        categoriesRef: categories ? content(xml, first(categories, 'f')) || undefined : undefined,
        numberFormat: values ? content(xml, first(values, 'formatCode')) || undefined : undefined,
        categoryFormat: categories
          ? content(xml, first(categories, 'formatCode')) || undefined
          : undefined,
        color: shape ? reader.color(child(shape, 'solidFill')?.children[0]) : undefined,
        lineColor: line
          ? child(line, 'noFill')
            ? 'none'
            : reader.color(child(line, 'solidFill')?.children[0])
          : undefined,
        lineWidth: line?.attrs.w ? Number(line.attrs.w) / 9525 : undefined,
        smooth: child(ser, 'smooth')?.attrs.val === '1',
        marker: child(child(ser, 'marker') ?? ser, 'symbol')?.attrs.val,
        plot: group.local,
        pointColors: children(ser, 'dPt').flatMap((point) => {
          const color = reader.color(first(point, 'solidFill')?.children[0])
          return color ? [{ index: Number(child(point, 'idx')?.attrs.val ?? 0), color }] : []
        }),
      })
    }
  const chartRoot = child(root, 'chart') ?? root,
    legend = child(chartRoot, 'legend'),
    legendPosition = legend && child(legend, 'legendPos')?.attrs.val
  const position: Record<string, 'right' | 'left' | 'top' | 'bottom'> = {
    r: 'right',
    l: 'left',
    t: 'top',
    b: 'bottom',
  }
  const labels = plots.flatMap((p) => children(p, 'dLbls'))[0]
  const showValue = labels && child(labels, 'showVal')?.attrs.val === '1',
    showPercent = labels && child(labels, 'showPercent')?.attrs.val === '1'
  const valueAxis = children(plot, 'valAx')[0],
    scaling = valueAxis && child(valueAxis, 'scaling')
  return {
    chartTypes: plots.map((p) => p.local),
    title: labelText(child(chartRoot, 'title')),
    series,
    legend: legend ? (position[legendPosition ?? 'r'] ?? 'right') : 'none',
    barDirection: plots
      .find((p) => p.local === 'barChart' || p.local === 'bar3DChart')
      ?.children.find((p) => p.local === 'barDir')?.attrs.val,
    dataLabels: showPercent ? 'percent' : showValue ? 'value' : 'none',
    grouping:
      plots[0] &&
      (child(plots[0], 'grouping')?.attrs.val as
        'clustered' | 'stacked' | 'percentStacked' | 'standard' | undefined),
    gridlines: !!valueAxis && !!child(valueAxis, 'majorGridlines'),
    valueAxis: scaling
      ? {
          min:
            child(scaling, 'min')?.attrs.val === undefined
              ? undefined
              : Number(child(scaling, 'min')!.attrs.val),
          max:
            child(scaling, 'max')?.attrs.val === undefined
              ? undefined
              : Number(child(scaling, 'max')!.attrs.val),
        }
      : undefined,
    gapWidthPct:
      plots[0] && child(plots[0], 'gapWidth')?.attrs.val
        ? Number(child(plots[0], 'gapWidth')!.attrs.val)
        : undefined,
    holeSizePct:
      plots[0] && child(plots[0], 'holeSize')?.attrs.val
        ? Number(child(plots[0], 'holeSize')!.attrs.val)
        : undefined,
    dispBlanksAs: child(chartRoot, 'dispBlanksAs')?.attrs.val as
      'gap' | 'zero' | 'span' | undefined,
  }
}

export async function drawingVisuals(
  sheetId: string,
  path: string,
  reader: DrawingReader,
): Promise<WorkbookVisualObject[]> {
  const xml = await reader.text(path),
    root = await reader.root(path),
    rels = await reader.rels(path),
    visuals: WorkbookVisualObject[] = []
  for (const [drawingIndex, anchorNode] of root.children.entries()) {
    if (!['twoCellAnchor', 'oneCellAnchor', 'absoluteAnchor'].includes(anchorNode.local)) continue
    const from = child(anchorNode, 'from'),
      to = child(anchorNode, 'to'),
      pos = child(anchorNode, 'pos'),
      extent = child(anchorNode, 'ext')
    const marker = (node: XmlNode | undefined, local: string): number =>
      node ? Number(content(xml, child(node, local)) || 0) : 0
    const fromRow = marker(from, 'row'),
      fromColumn = marker(from, 'col'),
      fromRowOffset = from ? marker(from, 'rowOff') : Number(pos?.attrs.y ?? 0),
      fromColumnOffset = from ? marker(from, 'colOff') : Number(pos?.attrs.x ?? 0)
    const anchor = {
      fromRow,
      fromColumn,
      fromRowOffset,
      fromColumnOffset,
      toRow: to ? marker(to, 'row') : fromRow,
      toColumn: to ? marker(to, 'col') : fromColumn,
      toRowOffset: to ? marker(to, 'rowOff') : fromRowOffset + Number(extent?.attrs.cy ?? 0),
      toColumnOffset: to ? marker(to, 'colOff') : fromColumnOffset + Number(extent?.attrs.cx ?? 0),
      explicitTo: !!to,
    }
    const object = anchorNode.children.find((n) =>
      ['pic', 'sp', 'cxnSp', 'graphicFrame'].includes(n.local),
    )
    if (!object) continue
    const properties = first(object, 'cNvPr'),
      shape = child(object, 'spPr'),
      transform = shape && child(shape, 'xfrm')
    const common = {
      id: `${sheetId}-drawing-${drawingIndex}`,
      sheetId,
      anchor,
      drawingPath: path,
      drawingIndex,
      name: properties?.attrs.name,
      altText: properties?.attrs.descr,
      editAs: anchorNode.attrs.editAs as 'twoCell' | 'oneCell' | 'absolute' | undefined,
      rotation: transform?.attrs.rot ? Number(transform.attrs.rot) / 60000 : undefined,
      flipH: transform?.attrs.flipH === '1',
      flipV: transform?.attrs.flipV === '1',
    }
    const chartNode = first(object, 'chart')
    if (chartNode) {
      const relation = rels.get(id(chartNode) ?? '')
      if (!relation || relation.external) continue
      visuals.push({
        ...common,
        kind: 'chart',
        chartPath: relation.path,
        chart: await chart(relation.path, reader),
      })
      continue
    }
    const blip = first(object, 'blip'),
      relation = blip && rels.get(id(blip) ?? ''),
      crop = first(object, 'srcRect')
    if (object.local === 'pic') {
      if (!relation || relation.external) continue
      visuals.push({
        ...common,
        kind: 'image',
        mediaPath: relation.path,
        mediaType: mediaType(relation.path),
        crop: crop
          ? {
              left: Number(crop.attrs.l ?? 0) / 100000,
              right: Number(crop.attrs.r ?? 0) / 100000,
              top: Number(crop.attrs.t ?? 0) / 100000,
              bottom: Number(crop.attrs.b ?? 0) / 100000,
            }
          : undefined,
        opacity:
          blip && child(blip, 'alphaModFix')?.attrs.amt
            ? Number(child(blip, 'alphaModFix')!.attrs.amt) / 100000
            : undefined,
      })
      continue
    }
    const text = descendants(object, 't')
        .map((n) => content(xml, n))
        .join(''),
      line = shape && child(shape, 'ln'),
      body = first(object, 'bodyPr')
    visuals.push({
      ...common,
      kind: 'shape',
      shapeType: (shape && child(shape, 'prstGeom')?.attrs.prst) ?? 'rect',
      fillColor: shape
        ? child(shape, 'noFill')
          ? 'none'
          : reader.color(child(shape, 'solidFill')?.children[0])
        : undefined,
      lineColor: line
        ? child(line, 'noFill')
          ? 'none'
          : reader.color(child(line, 'solidFill')?.children[0])
        : undefined,
      lineWidth: line?.attrs.w ? Number(line.attrs.w) / 12700 : undefined,
      lineDash: line && child(line, 'prstDash')?.attrs.val,
      text,
      textAnchor: body?.attrs.anchor,
      textColor: reader.color(first(object, 'fontRef')?.children[0]),
      fillMediaPath: relation && !relation.external ? relation.path : undefined,
      fillMediaType: relation && !relation.external ? mediaType(relation.path) : undefined,
    })
  }
  return visuals
}
