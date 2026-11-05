import { VisualPresentation, type VisualSlide, type BoxChange } from './visual'
import { renderSlideSvg } from './svg'
import { visualCopy, type VisualCopy } from './visual-copy'
import { localeCopy } from './i18n'
import type { SlideElement } from '../../../packages/pptx-engine/src/types'

type Copy = ReturnType<typeof localeCopy>
interface WorkspaceOptions {
  language?: string
  changed(): void
  navigate(index: number): void
  error(reason: unknown): void
}
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (text !== undefined) node.textContent = text
  if (className) node.className = className
  return node
}

export class SlideWorkspace {
  readonly visual: VisualPresentation
  private v: VisualCopy
  private copy: Copy
  private slideIndex = 0
  private selected: number | undefined
  private visualSlide?: VisualSlide
  private toolbar = el('div', undefined, 'visual-toolbar')
  private stage = el('div', undefined, 'canvas-stage')
  private inspector = el('section', undefined, 'visual-inspector')
  private currentSvg?: SVGSVGElement
  private renderVersion = 0
  private zoom = 1
  private pending = false
  private gesture?: {
    svg: SVGSVGElement
    action: string
    clientX: number
    clientY: number
    start: DOMPoint
    original: VisualSlide
    selected: number
    change: BoxChange
    moved: boolean
  }

  constructor(
    readonly host: HTMLElement,
    document: ConstructorParameters<typeof VisualPresentation>[0],
    private options: WorkspaceOptions,
  ) {
    this.visual = new VisualPresentation(document)
    this.v = visualCopy(options.language)
    this.copy = localeCopy(options.language ?? navigator.language)
  }

  async render(index: number, resetSelection = true): Promise<boolean> {
    const version = ++this.renderVersion
    this.slideIndex = index
    if (resetSelection) this.selected = undefined
    try {
      const visual = await this.visual.slide(index)
      if (version !== this.renderVersion) return false
      this.visualSlide = visual
      if (this.selected !== undefined && !visual.model.elements[this.selected])
        this.selected = undefined
      this.host.replaceChildren()
      const heading = el('div', undefined, 'slide-heading')
      heading.append(
        el('h2', `${this.copy.slide} ${index + 1}`),
        el('span', `${index + 1} / ${this.visual.document.slides.length}`, 'position'),
      )
      this.toolbar = el('div', undefined, 'visual-toolbar')
      this.toolbar.setAttribute('role', 'toolbar')
      this.toolbar.setAttribute('aria-label', this.v.layout)
      this.makeToolbar()
      const scroll = el('div', undefined, 'canvas-scroll')
      this.stage = el('div', undefined, 'canvas-stage')
      this.stage.style.width = `${this.zoom * 100}%`
      scroll.append(this.stage)
      this.inspector = el('section', undefined, 'visual-inspector')
      this.inspector.setAttribute('aria-label', this.v.objects)
      this.host.append(heading, this.toolbar, scroll, this.inspector)
      this.renderCanvas()
      this.renderInspector()
      return true
    } catch (reason) {
      this.options.error(reason)
      return false
    }
  }

  private button(
    label: string,
    action: () => void | Promise<void>,
    disabled = false,
    parent: HTMLElement = this.toolbar,
  ): HTMLButtonElement {
    const button = el('button', label)
    button.type = 'button'
    button.disabled = disabled || this.pending
    button.addEventListener('click', () => {
      void this.command(action)
    })
    parent.append(button)
    return button
  }

  private async command(action: () => void | Promise<void>): Promise<void> {
    if (this.pending) return
    this.pending = true
    const revision = this.visual.document.revision
    try {
      await action()
      if (revision !== this.visual.document.revision) this.options.changed()
      this.pending = false
      await this.render(this.slideIndex, false)
    } catch (reason) {
      this.options.error(reason)
      this.pending = false
      await this.render(this.slideIndex, false)
    } finally {
      this.pending = false
    }
  }

  private makeToolbar(): void {
    const locked = this.visual.document.readOnly
    const history = (direction: 'undo' | 'redo') => {
      this.visual[direction]()
      this.slideIndex = Math.min(this.slideIndex, this.visual.document.slides.length - 1)
      this.selected = undefined
      this.options.navigate(this.slideIndex)
    }
    this.button(this.v.undo, () => history('undo'), !this.visual.canUndo || locked)
    this.button(this.v.redo, () => history('redo'), !this.visual.canRedo || locked)
    this.button(
      this.v.text,
      async () => {
        this.selected = await this.visual.insert(this.slideIndex, 'text', this.v.text)
      },
      locked,
    )
    const shapes = el('select')
    shapes.setAttribute('aria-label', this.v.insert)
    for (const [value, label] of [
      ['', this.v.insert],
      ['rect', this.v.rectangle],
      ['ellipse', this.v.ellipse],
      ['table', `${this.v.table} (3 × 3)`],
    ]) {
      const option = el('option', label)
      option.value = value
      shapes.append(option)
    }
    shapes.disabled = locked
    shapes.addEventListener('change', () => {
      const kind = shapes.value
      shapes.value = ''
      if (kind === 'rect' || kind === 'ellipse')
        void this.command(async () => {
          this.selected = await this.visual.insert(this.slideIndex, kind)
        })
      if (kind === 'table')
        void this.command(async () => {
          this.selected = await this.visual.insertTable(this.slideIndex)
        })
    })
    this.toolbar.append(shapes)
    const file = el('input')
    file.type = 'file'
    file.accept = 'image/png,image/jpeg,image/gif,image/webp'
    file.hidden = true
    file.addEventListener('change', () => {
      const image = file.files?.[0]
      if (!image) return
      void this.command(async () => {
        const extension = (
          {
            'image/png': 'png',
            'image/jpeg': 'jpg',
            'image/gif': 'gif',
            'image/webp': 'webp',
          } as const
        )[image.type as 'image/png']
        if (!extension || image.size > 8 * 1024 * 1024) throw new Error('presentationTooLarge')
        const url = URL.createObjectURL(image)
        try {
          const bitmap = new Image()
          bitmap.src = url
          await bitmap.decode()
          this.selected = await this.visual.insertImage(
            this.slideIndex,
            new Uint8Array(await image.arrayBuffer()),
            extension,
            bitmap.naturalWidth,
            bitmap.naturalHeight,
          )
        } finally {
          URL.revokeObjectURL(url)
        }
      })
    })
    this.toolbar.append(file)
    this.button(this.v.image, () => file.click(), locked)
    const slides = el('details', undefined, 'slide-actions')
    slides.append(el('summary', this.copy.slide))
    const actions = el('div', undefined, 'slide-actions-menu')
    this.button(
      this.v.addSlide,
      async () => {
        const next = await this.visual.addSlide(this.slideIndex)
        this.slideIndex = next
        this.selected = undefined
        this.options.navigate(next)
      },
      locked,
      actions,
    )
    this.button(
      this.v.duplicateSlide,
      async () => {
        const next = await this.visual.addSlide(this.slideIndex, true)
        this.slideIndex = next
        this.selected = undefined
        this.options.navigate(next)
      },
      locked,
      actions,
    )
    this.button(
      this.v.deleteSlide,
      async () => {
        await this.visual.deleteSlide(this.slideIndex)
        this.slideIndex = Math.min(this.slideIndex, this.visual.document.slides.length - 1)
        this.selected = undefined
        this.options.navigate(this.slideIndex)
      },
      locked || this.visual.document.slides.length < 2,
      actions,
    )
    this.button(
      this.v.up,
      async () => {
        await this.visual.reorder(this.slideIndex, this.slideIndex - 1)
        this.slideIndex--
        this.options.navigate(this.slideIndex)
      },
      locked || this.slideIndex === 0,
      actions,
    )
    this.button(
      this.v.down,
      async () => {
        await this.visual.reorder(this.slideIndex, this.slideIndex + 1)
        this.slideIndex++
        this.options.navigate(this.slideIndex)
      },
      locked || this.slideIndex >= this.visual.document.slides.length - 1,
      actions,
    )
    slides.append(actions)
    this.toolbar.append(slides)
    const zoom = el('select')
    zoom.setAttribute('aria-label', this.v.zoom)
    for (const scale of [0.75, 1, 1.5, 2]) {
      const option = el('option', `${scale * 100}%`)
      option.value = String(scale)
      zoom.append(option)
    }
    zoom.value = String(this.zoom)
    zoom.addEventListener('change', () => {
      this.zoom = Number(zoom.value)
      this.stage.style.width = `${this.zoom * 100}%`
      this.renderCanvas()
    })
    this.toolbar.append(zoom)
    this.button(this.v.present, () => this.present())
  }

  private async present(): Promise<void> {
    const dialog = el('dialog', undefined, 'presentation-view')
    const frame = el('div', undefined, 'presentation-frame')
    const navigation = el('div', undefined, 'presentation-navigation')
    let current = this.slideIndex
    const display = async () => {
      const slide = await this.visual.slide(current)
      frame.replaceChildren(
        renderSlideSvg(slide.tree, { label: `${this.copy.slide} ${current + 1}` }),
      )
    }
    const button = (label: string, action: () => void) => {
      const node = el('button', label)
      node.type = 'button'
      node.addEventListener('click', action)
      navigation.append(node)
    }
    const next = (direction: number) => {
      current = Math.max(0, Math.min(this.visual.document.slides.length - 1, current + direction))
      void display().catch(this.options.error)
    }
    button(this.copy.previous, () => next(-1))
    button(this.copy.next, () => next(1))
    button(this.v.endShow, () => dialog.close())
    frame.addEventListener('click', () => next(1))
    dialog.addEventListener('keydown', (event) => {
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key)) {
        event.preventDefault()
        next(1)
      }
      if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) {
        event.preventDefault()
        next(-1)
      }
    })
    dialog.addEventListener('close', () => dialog.remove())
    dialog.append(frame, navigation)
    document.body.append(dialog)
    dialog.showModal()
    await display()
  }

  private kind(element: SlideElement): string {
    return {
      text: this.v.text,
      shape: this.v.shape,
      picture: this.v.image,
      group: this.v.group,
      table: this.v.table,
      chart: this.v.chart,
      passthrough: this.v.readOnly,
    }[element.type]
  }

  private renderCanvas(): void {
    const visual = this.visualSlide
    if (!visual) return
    const indexFor = (id: string) => visual.model.elements.findIndex((e) => e.id === id)
    const svg = renderSlideSvg(visual.tree, {
      elementIndex: indexFor,
      selected:
        this.selected !== undefined && visual.editable.has(this.selected)
          ? this.selected
          : undefined,
      handleRadius: (22 * 960) / Math.max(250, this.stage.clientWidth),
      label: `${this.copy.slide} ${this.slideIndex + 1}`,
      readonlyLabel: this.v.readOnly,
    })
    svg.tabIndex = 0
    svg.dataset.revision = String(this.visual.document.revision)
    svg.setAttribute('role', 'group')
    for (const object of svg.querySelectorAll<SVGGElement>('[data-element]')) {
      const index = Number(object.dataset.element)
      object.setAttribute('aria-label', `${this.kind(visual.model.elements[index])} ${index + 1}`)
      object.setAttribute('role', 'button')
      object.tabIndex = 0
    }
    svg.addEventListener('pointerdown', (event) => this.pointerDown(event))
    svg.addEventListener('pointermove', (event) => this.pointerMove(event))
    svg.addEventListener('pointerup', (event) => this.pointerUp(event))
    svg.addEventListener('pointercancel', () => {
      this.gesture = undefined
      this.renderCanvas()
    })
    svg.addEventListener('keydown', (event) => {
      const object = (event.target as Element).closest<SVGGElement>('[data-element]')
      if (object && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault()
        this.select(Number(object.dataset.element))
        return
      }
      if (this.selected === undefined) return
      if (event.key === 'Escape') {
        this.select(undefined)
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        void this.command(async () => {
          await this.visual.removeElement(this.slideIndex, this.selected!)
          this.selected = undefined
        })
        return
      }
      const direction = (
        { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<
          string,
          number[]
        >
      )[event.key]
      if (!direction) return
      event.preventDefault()
      const element = this.visualSlide!.model.elements[this.selected]
      const step = (event.shiftKey ? 10 : 1) * 9525
      void this.command(() =>
        this.visual.transform(this.slideIndex, this.selected!, {
          x: element.transform.offset.x + direction[0] * step,
          y: element.transform.offset.y + direction[1] * step,
        }),
      )
    })
    svg.addEventListener('dblclick', () => this.inspector.querySelector('textarea')?.focus())
    this.stage.replaceChildren(svg)
    this.currentSvg = svg
  }

  private select(index: number | undefined): void {
    this.selected = index
    this.renderCanvas()
    this.renderInspector()
  }

  private point(event: PointerEvent, svg: SVGSVGElement): DOMPoint {
    const matrix = svg.getScreenCTM()
    if (!matrix) return new DOMPoint()
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
  }

  private pointerDown(event: PointerEvent): void {
    if (!this.visualSlide || this.pending || !event.isPrimary) return
    const target = event.target as Element
    const handle = target.closest<SVGElement>('[data-action]')
    const object = target.closest<SVGGElement>('[data-element]')
    const index = object ? Number(object.dataset.element) : handle ? this.selected : undefined
    if (index === undefined) {
      this.select(undefined)
      return
    }
    if (index !== this.selected) {
      this.select(index)
      return
    }
    if (!this.visualSlide.editable.has(index)) return
    event.preventDefault()
    const svg = this.currentSvg!
    svg.setPointerCapture(event.pointerId)
    this.gesture = {
      svg,
      action: handle?.dataset.action ?? 'move',
      start: this.point(event, svg),
      clientX: event.clientX,
      clientY: event.clientY,
      original: this.visualSlide,
      selected: index,
      change: {},
      moved: false,
    }
  }

  private pointerMove(event: PointerEvent): void {
    const gesture = this.gesture
    if (!gesture) return
    const current = this.point(event, gesture.svg)
    const dx = current.x - gesture.start.x,
      dy = current.y - gesture.start.y
    gesture.moved ||=
      Math.hypot(event.clientX - gesture.clientX, event.clientY - gesture.clientY) > 3
    const element = gesture.original.model.elements[gesture.selected]
    const box = gesture.original.tree.nodes.find(
      (node) => !node.decoration && node.sourceId === element.id,
    )!.box
    const t = element.transform
    const scale = gesture.original.size.cx / 960
    const angle = ((t.rot / 60000) * Math.PI) / 180
    let x = box.x,
      y = box.y,
      width = box.w,
      height = box.h,
      rotation = t.rot / 60000
    if (gesture.action === 'rotate') {
      const cx = box.x + box.w / 2,
        cy = box.y + box.h / 2
      rotation +=
        ((Math.atan2(current.y - cy, current.x - cx) -
          Math.atan2(gesture.start.y - cy, gesture.start.x - cx)) *
          180) /
        Math.PI
      gesture.change = { rotation }
    } else if (gesture.action.startsWith('resize-')) {
      const left = gesture.action.endsWith('w'),
        top = gesture.action.includes('-n')
      const localX = Math.cos(angle) * dx + Math.sin(angle) * dy
      const localY = -Math.sin(angle) * dx + Math.cos(angle) * dy
      width = Math.max(8, box.w + (left ? -localX : localX))
      height = Math.max(8, box.h + (top ? -localY : localY))
      const shiftX = ((width - box.w) * (left ? -1 : 1)) / 2,
        shiftY = ((height - box.h) * (top ? -1 : 1)) / 2
      x += Math.cos(angle) * shiftX - Math.sin(angle) * shiftY - (width - box.w) / 2
      y += Math.sin(angle) * shiftX + Math.cos(angle) * shiftY - (height - box.h) / 2
      gesture.change = {
        x: Math.round(x * scale),
        y: Math.round(y * scale),
        width: Math.round(width * scale),
        height: Math.round(height * scale),
      }
    } else {
      x += dx
      y += dy
      gesture.change = { x: t.offset.x + dx * scale, y: t.offset.y + dy * scale }
    }
    const object = gesture.svg.querySelector<SVGGElement>(`[data-element="${gesture.selected}"]`)
    object?.setAttribute(
      'transform',
      `translate(${x} ${y}) rotate(${rotation} ${width / 2} ${height / 2}) scale(${width / Math.max(1, box.w)} ${height / Math.max(1, box.h)})${box.flipH || box.flipV ? ` translate(${box.flipH ? box.w : 0} ${box.flipV ? box.h : 0}) scale(${box.flipH ? -1 : 1} ${box.flipV ? -1 : 1})` : ''}`,
    )
    const overlay = gesture.svg.querySelector<SVGGElement>('[data-selection]')
    overlay?.setAttribute(
      'transform',
      `translate(${x} ${y}) rotate(${rotation} ${width / 2} ${height / 2}) scale(${width / Math.max(1, box.w)} ${height / Math.max(1, box.h)})`,
    )
  }

  private pointerUp(event: PointerEvent): void {
    const gesture = this.gesture
    if (!gesture) return
    this.gesture = undefined
    if (gesture.svg.hasPointerCapture(event.pointerId))
      gesture.svg.releasePointerCapture(event.pointerId)
    if (!gesture.moved) return
    void this.command(() =>
      this.visual.transform(this.slideIndex, gesture.selected, gesture.change),
    )
  }

  private field(
    label: string,
    value: string | number,
    action: (value: string) => Promise<void>,
    type = 'number',
    parent = this.inspector,
  ): HTMLInputElement {
    const wrapper = el('label', label, 'property-field')
    const input = el('input')
    input.type = type
    input.value = String(value)
    input.setAttribute('aria-label', label)
    if (type === 'number') input.step = '0.1'
    input.addEventListener('change', () => {
      void this.command(() => action(input.value))
    })
    wrapper.append(input)
    parent.append(wrapper)
    return input
  }

  private renderInspector(): void {
    const visual = this.visualSlide
    if (!visual) return
    this.inspector.replaceChildren()
    const list = el('select')
    list.setAttribute('aria-label', this.v.objects)
    list.append(el('option', this.v.select))
    list.options[0].value = ''
    visual.model.elements.forEach((element, index) => {
      const option = el('option', `${index + 1} · ${this.kind(element)}`)
      option.value = String(index)
      list.append(option)
    })
    list.value = this.selected === undefined ? '' : String(this.selected)
    list.addEventListener('change', () =>
      this.select(list.value === '' ? undefined : Number(list.value)),
    )
    this.inspector.append(list)
    if (this.selected === undefined) {
      this.inspector.append(el('p', this.v.select, 'empty'))
      this.field(
        this.v.background,
        visual.tree.background.kind === 'solid'
          ? visual.tree.background.color.slice(0, 7)
          : '#ffffff',
        (color) => this.visual.background(this.slideIndex, color),
        'color',
      ).disabled = this.visual.document.readOnly
      return
    }
    const selected = this.selected
    const element = visual.model.elements[selected]
    if (!visual.editable.has(selected)) this.inspector.append(el('p', this.v.readOnly, 'read-only'))
    else {
      const properties = el('div', undefined, 'property-grid')
      const box = element.transform.offset
      const position = (label: string, value: number, key: 'x' | 'y' | 'width' | 'height') =>
        this.field(
          `${label} (${this.v.point})`,
          Number((value / 12700).toFixed(1)),
          (raw) => this.visual.transform(this.slideIndex, selected, { [key]: Number(raw) * 12700 }),
          'number',
          properties,
        )
      position(this.v.horizontal, box.x, 'x')
      position(this.v.vertical, box.y, 'y')
      position(this.v.width, box.cx, 'width')
      position(this.v.height, box.cy, 'height')
      this.field(
        `${this.v.rotation} (°)`,
        Number((element.transform.rot / 60000).toFixed(1)),
        (raw) => this.visual.transform(this.slideIndex, selected, { rotation: Number(raw) }),
        'number',
        properties,
      )
      this.inspector.append(properties)
      const arrange = el('div', undefined, 'format-actions')
      this.button(
        this.v.flipH,
        () => this.visual.transform(this.slideIndex, selected, { flipH: !element.transform.flipH }),
        false,
        arrange,
      )
      this.button(
        this.v.flipV,
        () => this.visual.transform(this.slideIndex, selected, { flipV: !element.transform.flipV }),
        false,
        arrange,
      )
      this.button(
        this.v.back,
        async () => {
          await this.visual.zOrder(this.slideIndex, selected, -1)
          this.selected = Math.max(0, selected - 1)
        },
        selected === 0,
        arrange,
      )
      this.button(
        this.v.front,
        async () => {
          await this.visual.zOrder(this.slideIndex, selected, 1)
          this.selected = Math.min(visual.model.elements.length - 1, selected + 1)
        },
        selected === visual.model.elements.length - 1,
        arrange,
      )
      this.button(
        this.v.deleteObject,
        async () => {
          await this.visual.removeElement(this.slideIndex, selected)
          this.selected = undefined
        },
        false,
        arrange,
      )
      this.inspector.append(arrange)
      if (element.type === 'text' || element.type === 'shape') {
        const run = element.text?.paragraphs.flatMap((p) => p.runs).find((r) => !r.field)
        const fonts = el('div', undefined, 'format-actions')
        for (const key of ['bold', 'italic', 'underline'] as const) {
          const button = this.button(
            this.v[key],
            () => this.visual.font(this.slideIndex, selected, { [key]: !run?.[key] }),
            false,
            fonts,
          )
          button.setAttribute('aria-pressed', String(!!run?.[key]))
        }
        for (const [key, label] of [
          ['left', this.v.alignLeft],
          ['center', this.v.alignCenter],
          ['right', this.v.alignRight],
        ] as const)
          this.button(label, () => this.visual.align(this.slideIndex, selected, key), false, fonts)
        this.inspector.append(fonts)
        const fontFields = el('div', undefined, 'property-grid')
        this.field(
          this.v.font,
          run?.fontFamily ?? 'Arial',
          (value) => this.visual.font(this.slideIndex, selected, { fontFamily: value }),
          'text',
          fontFields,
        )
        this.field(
          this.v.fontSize,
          run?.fontSize ?? 24,
          (value) => this.visual.font(this.slideIndex, selected, { fontSize: Number(value) }),
          'number',
          fontFields,
        )
        this.field(
          this.v.textColor,
          run?.color?.slice(0, 7) ?? '#242424',
          (color) => this.visual.font(this.slideIndex, selected, { color }),
          'color',
          fontFields,
        )
        this.field(
          this.v.fill,
          element.fill?.type === 'solid' ? element.fill.color.slice(0, 7) : '#c43e1c',
          (color) => this.visual.fill(this.slideIndex, selected, color),
          'color',
          fontFields,
        )
        this.inspector.append(fontFields)
        this.button(
          this.v.none,
          () => this.visual.fill(this.slideIndex, selected, 'none'),
          false,
          this.inspector,
        )
        const stroke = element.stroke
        const strokeColor =
          stroke?.fill.type === 'solid' ? stroke.fill.color.slice(0, 7) : '#242424'
        this.field(
          this.v.stroke,
          strokeColor,
          (color) =>
            this.visual.stroke(this.slideIndex, selected, color, stroke ? stroke.width / 12700 : 1),
          'color',
          fontFields,
        )
      }
    }
    const text = el('div', undefined, 'run-editor')
    for (const location of this.visual.runLocations(this.slideIndex, selected)) {
      const run =
        this.visual.document.slides[this.slideIndex].paragraphs[location.paragraph].runs[
          location.run
        ]
      const label = el(
        'label',
        `${this.copy.paragraph} ${location.paragraph + 1} · ${this.copy.run} ${location.run + 1}`,
      )
      const textarea = el('textarea')
      textarea.rows = Math.max(2, Math.min(6, Math.ceil(run.text.length / 65)))
      textarea.value = run.text
      textarea.dir = 'auto'
      textarea.readOnly = !run.editable
      textarea.setAttribute('aria-label', label.textContent!)
      textarea.addEventListener('input', () => {
        try {
          this.visual.setRunText(this.slideIndex, location.paragraph, location.run, textarea.value)
          this.options.changed()
          const version = ++this.renderVersion
          void this.visual
            .slide(this.slideIndex)
            .then((slide) => {
              if (version === this.renderVersion) {
                this.visualSlide = slide
                this.renderCanvas()
              }
            })
            .catch(this.options.error)
        } catch (reason) {
          textarea.value = run.text
          this.options.error(reason)
        }
      })
      label.append(textarea)
      text.append(label)
    }
    this.inspector.append(text)
  }
}
