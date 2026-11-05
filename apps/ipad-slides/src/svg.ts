import type {
  RenderSlide,
  RenderNode,
  RenderFill,
  RenderTextLayout,
  RenderStroke,
} from '@genoffice/pptx-render'

const NS = 'http://www.w3.org/2000/svg'
let sequence = 0
export function svgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | undefined> = {},
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(NS, tag)
  for (const [name, value] of Object.entries(attrs))
    if (value !== undefined) element.setAttribute(name, String(value))
  return element
}

export interface SvgOptions {
  elementIndex?: (sourceId: string) => number
  selected?: number
  handleRadius?: number
  label?: string
  readonlyLabel?: string
}

/** Thin SVG adapter over the same RenderTree used by the desktop Konva canvas. */
export function renderSlideSvg(slide: RenderSlide, options: SvgOptions = {}): SVGSVGElement {
  const root = svgElement('svg', {
    viewBox: `0 0 ${slide.widthPx} ${slide.heightPx}`,
    role: 'img',
    'aria-label': options.label ?? '',
    preserveAspectRatio: 'xMidYMid meet',
  })
  root.classList.add('slide-canvas')
  const defs = svgElement('defs')
  root.append(defs)
  const prefix = `slide-${++sequence}`
  let next = 0
  const id = () => `${prefix}-${++next}`
  const fill = (value: RenderFill, w: number, h: number): string => {
    if (value.kind === 'none') return 'none'
    if (value.kind === 'solid') return value.color
    if (value.kind === 'gradient') {
      const key = id()
      const gradient =
        value.radial || value.path
          ? svgElement('radialGradient', {
              id: key,
              cx: value.center?.x ?? 0.5,
              cy: value.center?.y ?? 0.5,
            })
          : svgElement('linearGradient', {
              id: key,
              x1: 0,
              y1: 0,
              x2: 1,
              y2: 0,
              gradientTransform: `rotate(${value.angleDeg} .5 .5)`,
            })
      for (const stop of value.stops)
        gradient.append(
          svgElement('stop', { offset: `${stop.pos * 100}%`, 'stop-color': stop.color }),
        )
      defs.append(gradient)
      return `url(#${key})`
    }
    if (value.kind === 'image') {
      if (!value.dataUrl) return 'none'
      const key = id()
      const pattern = svgElement('pattern', {
        id: key,
        patternUnits: 'objectBoundingBox',
        width: 1,
        height: 1,
        viewBox: `0 0 ${w} ${h}`,
        preserveAspectRatio: 'none',
      })
      pattern.append(
        svgElement('image', {
          href: value.dataUrl,
          width: w,
          height: h,
          preserveAspectRatio: value.mode === 'stretch' ? 'none' : 'xMidYMid slice',
          opacity: value.alpha ?? 1,
        }),
      )
      defs.append(pattern)
      return `url(#${key})`
    }
    const key = id()
    const size = value.cellPx || 8
    const pattern = svgElement('pattern', {
      id: key,
      width: size,
      height: size,
      patternUnits: 'userSpaceOnUse',
    })
    pattern.append(
      svgElement('rect', { width: size, height: size, fill: value.bg }),
      svgElement('path', {
        d: `M0 ${size}L${size} 0`,
        stroke: value.fg,
        'stroke-width': Math.max(1, size / 5),
      }),
    )
    defs.append(pattern)
    return `url(#${key})`
  }
  const stroke = (node: SVGElement, value?: RenderStroke): void => {
    if (!value) {
      node.setAttribute('stroke', 'none')
      return
    }
    node.setAttribute('stroke', value.color)
    node.setAttribute('stroke-width', String(value.widthPx))
    if (value.dash) node.setAttribute('stroke-dasharray', value.dash.join(' '))
    if (value.cap) node.setAttribute('stroke-linecap', value.cap)
    if (value.join) node.setAttribute('stroke-linejoin', value.join)
  }
  const text = (layout: RenderTextLayout | undefined, parent: SVGElement): void => {
    for (const line of layout?.lines ?? [])
      for (const run of line.runs) {
        if (run.highlight)
          parent.append(
            svgElement('rect', {
              x: run.x,
              y: run.baselineY - run.fontSizePx,
              width: run.widthPx,
              height: run.fontSizePx * 1.2,
              fill: run.highlight,
            }),
          )
        const node = svgElement('text', {
          x: run.x,
          y: run.baselineY,
          fill: run.color,
          'font-family': `${run.fontFamily}, Arial, sans-serif`,
          'font-size': run.fontSizePx,
          'font-weight': run.bold ? 700 : 400,
          'font-style': run.italic ? 'italic' : 'normal',
          'text-decoration':
            [run.underline ? 'underline' : '', run.strike ? 'line-through' : '']
              .filter(Boolean)
              .join(' ') || undefined,
          'letter-spacing': run.letterSpacingPx,
          'xml:space': 'preserve',
          transform: run.rotate90
            ? `rotate(90 ${run.x} ${run.baselineY})`
            : run.rotate270
              ? `rotate(-90 ${run.x} ${run.baselineY})`
              : undefined,
        })
        node.textContent = run.text
        if (run.widthPx > 0 && run.text.trim()) {
          node.setAttribute('textLength', String(run.widthPx))
          node.setAttribute('lengthAdjust', 'spacingAndGlyphs')
        }
        parent.append(node)
      }
  }
  const points = (values: number[]): string =>
    values.reduce((list, value, index) => list + (index % 2 ? ',' : index ? ' ' : '') + value, '')
  const draw = (node: RenderNode, parent: SVGElement, selectable = true): void => {
    const b = node.box
    const group = svgElement('g', {
      transform: `translate(${b.x} ${b.y}) rotate(${b.rotationDeg} ${b.w / 2} ${b.h / 2})${b.flipH || b.flipV ? ` translate(${b.flipH ? b.w : 0} ${b.flipV ? b.h : 0}) scale(${b.flipH ? -1 : 1} ${b.flipV ? -1 : 1})` : ''}`,
    })
    const index =
      node.decoration || !selectable ? -1 : (options.elementIndex?.(node.sourceId) ?? -1)
    if (index >= 0) {
      group.dataset.element = String(index)
      group.classList.add('canvas-object')
      const hit = svgElement('rect', {
        width: Math.max(b.w, 8),
        height: Math.max(b.h, 8),
        fill: 'transparent',
      })
      hit.classList.add('object-hit')
      group.append(hit)
    }
    if (node.type === 'shape' || node.type === 'text') {
      let shape: SVGElement
      if (node.line)
        shape = svgElement('polyline', { points: points(node.line.points), fill: 'none' })
      else if (node.pathData)
        shape = svgElement('path', { d: node.pathData, fill: fill(node.fill, b.w, b.h) })
      else if (node.polygonPoints)
        shape = svgElement('polygon', {
          points: points(node.polygonPoints),
          fill: fill(node.fill, b.w, b.h),
        })
      else if (node.presetGeometry === 'ellipse')
        shape = svgElement('ellipse', {
          cx: b.w / 2,
          cy: b.h / 2,
          rx: b.w / 2,
          ry: b.h / 2,
          fill: fill(node.fill, b.w, b.h),
        })
      else
        shape = svgElement('rect', {
          width: b.w,
          height: b.h,
          rx: node.cornerRadiusPx ?? 0,
          fill: fill(node.fill, b.w, b.h),
        })
      stroke(shape, node.stroke)
      group.append(shape)
      if (node.fillPathData)
        group.append(svgElement('path', { d: node.fillPathData, fill: fill(node.fill, b.w, b.h) }))
      if (node.strokePathData) {
        const path = svgElement('path', { d: node.strokePathData, fill: 'none' })
        stroke(path, node.stroke)
        group.append(path)
      }
      text(node.text, group)
    } else if (node.type === 'picture') {
      if (node.bgColor)
        group.append(svgElement('rect', { width: b.w, height: b.h, fill: node.bgColor }))
      if (node.fill)
        group.append(
          svgElement('rect', { width: b.w, height: b.h, fill: fill(node.fill, b.w, b.h) }),
        )
      const clipId = id()
      const clip = svgElement('clipPath', { id: clipId })
      clip.append(
        node.clip?.pathData
          ? svgElement('path', { d: node.clip.pathData })
          : node.clip?.polygonPoints
            ? svgElement('polygon', { points: points(node.clip.polygonPoints) })
            : svgElement('rect', { width: b.w, height: b.h, rx: node.clip?.cornerRadiusPx ?? 0 }),
      )
      defs.append(clip)
      const crop = node.srcRect ?? { l: 0, t: 0, r: 0, b: 0 }
      const w = b.w / Math.max(0.001, 1 - crop.l - crop.r),
        h = b.h / Math.max(0.001, 1 - crop.t - crop.b)
      if (node.dataUrl)
        group.append(
          svgElement('image', {
            href: node.dataUrl,
            x: -crop.l * w,
            y: -crop.t * h,
            width: w,
            height: h,
            preserveAspectRatio: 'none',
            opacity: node.opacity ?? 1,
            'clip-path': `url(#${clipId})`,
          }),
        )
      else {
        const placeholder = svgElement('rect', {
          width: b.w,
          height: b.h,
          fill: 'none',
          stroke: 'currentColor',
          'stroke-dasharray': '5 4',
        })
        group.append(placeholder)
      }
      if (node.stroke) {
        const border = svgElement('rect', { width: b.w, height: b.h, fill: 'none' })
        stroke(border, node.stroke)
        group.append(border)
      }
    } else if (node.type === 'group') {
      for (const child of node.children) draw(child, group, false)
    } else if (node.type === 'table') {
      if (node.bgFill)
        group.append(
          svgElement('rect', { width: b.w, height: b.h, fill: fill(node.bgFill, b.w, b.h) }),
        )
      for (const cell of node.cells) {
        const content = svgElement('g', { transform: `translate(${cell.x} ${cell.y})` })
        content.append(
          svgElement('rect', {
            width: cell.w,
            height: cell.h,
            fill: fill(cell.fill, cell.w, cell.h),
          }),
        )
        for (const [side, border] of Object.entries(cell.borders ?? {})) {
          const line = svgElement('line', {
            x1: side === 'r' ? cell.w : 0,
            y1: side === 'b' ? cell.h : 0,
            x2: side === 'l' ? 0 : cell.w,
            y2: side === 't' ? 0 : cell.h,
          })
          stroke(line, border)
          content.append(line)
        }
        text(cell.text, content)
        group.append(content)
      }
    } else if (node.type === 'chart') {
      if (node.bgFill)
        group.append(
          svgElement('rect', { width: b.w, height: b.h, fill: fill(node.bgFill, b.w, b.h) }),
        )
      if (node.plotRect) {
        const p = node.plotRect
        group.append(
          svgElement('rect', {
            x: p.x,
            y: p.y,
            width: p.w,
            height: p.h,
            fill: p.fill ? fill(p.fill, p.w, p.h) : 'none',
            stroke: p.borderColor,
            'stroke-width': p.borderWidthPx,
          }),
        )
      }
      for (const line of [...node.gridLines, ...node.axisLines])
        group.append(
          svgElement('line', {
            x1: line.x1,
            y1: line.y1,
            x2: line.x2,
            y2: line.y2,
            stroke: line.color,
            'stroke-width': line.widthPx ?? 1,
          }),
        )
      for (const bar of node.bars)
        group.append(
          svgElement('rect', {
            x: bar.x,
            y: bar.y,
            width: bar.w,
            height: bar.h,
            fill: bar.fill ? fill(bar.fill, bar.w, bar.h) : bar.color,
          }),
        )
      for (const line of node.polylines)
        group.append(
          svgElement(line.closed ? 'polygon' : 'polyline', {
            points: points(line.points),
            fill: line.fill ?? 'none',
            stroke: line.color,
            'stroke-width': line.widthPx,
          }),
        )
      for (const path of node.paths ?? [])
        group.append(
          svgElement('path', {
            d: path.d,
            fill: path.fill,
            stroke: path.stroke,
            'stroke-width': path.strokeWidthPx,
            transform: path.dy ? `translate(0 ${path.dy})` : undefined,
          }),
        )
      for (const wedge of node.wedges ?? []) {
        const start = (wedge.startDeg * Math.PI) / 180,
          sweep = (Math.min(359.99, wedge.sweepDeg) * Math.PI) / 180,
          end = start + sweep
        const outer = (angle: number) =>
          `${wedge.cx + Math.cos(angle) * wedge.outerR} ${wedge.cy + Math.sin(angle) * wedge.outerR}`
        const inner = (angle: number) =>
          `${wedge.cx + Math.cos(angle) * wedge.innerR} ${wedge.cy + Math.sin(angle) * wedge.innerR}`
        const large = sweep > Math.PI ? 1 : 0
        const d = `M${outer(start)}A${wedge.outerR} ${wedge.outerR} 0 ${large} 1 ${outer(end)}${wedge.innerR ? `L${inner(end)}A${wedge.innerR} ${wedge.innerR} 0 ${large} 0 ${inner(start)}` : `L${wedge.cx} ${wedge.cy}`}Z`
        group.append(
          svgElement('path', {
            d,
            fill: wedge.noFill ? 'none' : wedge.color,
            stroke: wedge.stroke,
            'stroke-width': wedge.strokeWidthPx,
          }),
        )
      }
      for (const marker of node.markers)
        group.append(
          svgElement('circle', { cx: marker.x, cy: marker.y, r: marker.r, fill: marker.color }),
        )
      for (const swatch of node.swatches)
        group.append(
          svgElement('rect', {
            x: swatch.x,
            y: swatch.y,
            width: swatch.w,
            height: swatch.h,
            fill: swatch.color,
          }),
        )
      for (const label of node.labels) {
        const item = svgElement('text', {
          x: label.x,
          y: label.y + label.fontSizePx,
          fill: label.color,
          'font-size': label.fontSizePx,
          'font-family': label.fontFamily ?? 'Arial, sans-serif',
          'font-weight': label.bold ? 700 : 400,
          transform: label.rotationDeg
            ? `rotate(${label.rotationDeg} ${label.x} ${label.y})`
            : undefined,
        })
        item.textContent = label.text
        group.append(item)
      }
    } else if (node.type === 'placeholder-chip') {
      const placeholder = svgElement('rect', {
        width: b.w,
        height: b.h,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-dasharray': '6 4',
      })
      const label = svgElement('text', { x: 8, y: 22, 'font-size': 14, fill: 'currentColor' })
      label.textContent = `${node.label} · ${options.readonlyLabel ?? ''}`
      group.append(placeholder, label)
    }
    parent.append(group)
  }
  root.append(
    svgElement('rect', {
      width: slide.widthPx,
      height: slide.heightPx,
      fill: fill(slide.background, slide.widthPx, slide.heightPx),
      'data-background': 'true',
    }),
  )
  for (const node of slide.nodes) draw(node, root)
  const selected = slide.nodes.find(
    (node) => !node.decoration && options.elementIndex?.(node.sourceId) === options.selected,
  )
  if (selected && options.selected !== undefined) {
    const box = selected.box
    const overlay = svgElement('g', {
      transform: `translate(${box.x} ${box.y}) rotate(${box.rotationDeg} ${box.w / 2} ${box.h / 2})`,
      'data-selection': String(options.selected),
    })
    overlay.classList.add('selection-overlay')
    overlay.append(
      svgElement('rect', {
        width: box.w,
        height: box.h,
        fill: 'none',
        'vector-effect': 'non-scaling-stroke',
        'stroke-width': 1.5,
        'data-action': 'move',
      }),
    )
    const radius = options.handleRadius ?? 32
    for (const [action, x, y] of [
      ['resize-nw', 0, 0],
      ['resize-ne', box.w, 0],
      ['resize-sw', 0, box.h],
      ['resize-se', box.w, box.h],
      ['rotate', box.w / 2, -radius * 1.8],
    ] as const) {
      const handle = svgElement('g', { 'data-action': action, transform: `translate(${x} ${y})` })
      handle.append(
        svgElement('circle', { r: radius, fill: 'transparent', stroke: 'none' }),
        svgElement('circle', {
          r: radius / 4,
          fill: 'var(--surface)',
          'vector-effect': 'non-scaling-stroke',
          'stroke-width': 2,
        }),
      )
      overlay.append(handle)
    }
    root.append(overlay)
  }
  return root
}
