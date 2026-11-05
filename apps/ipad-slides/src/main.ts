import { PresentationDocument, decodeBase64, encodeBase64 } from './presentation'
import { localeCopy, errorText } from './i18n'
import { SlideWorkspace } from './workspace'
import { visualCopy } from './visual-copy'
import { renderSlideSvg } from './svg'
import './styles.css'

interface OpenRequest {
  name: string
  base64: string
  kind: 'pptx'
  language?: string
}
interface BridgeMessage {
  type: 'ready' | 'opened' | 'save' | 'error' | 'changed' | 'exportPDF' | 'printPages'
  base64?: string
  message?: string
  name?: string
  kind?: 'pptx'
  revision?: number
  dirty?: boolean
  pages?: Array<{ svg: string; width: number; height: number }>
}
declare global {
  interface Window {
    everyOffice: {
      openDocument(request: OpenRequest): Promise<void>
      saveDocument(): Promise<void>
      exportPDF(): Promise<void>
      printPages(): Promise<void>
    }
    webkit?: { messageHandlers?: { everyOffice?: { postMessage(message: BridgeMessage): void } } }
  }
}

let copy = localeCopy(navigator.language)
let presentation: PresentationDocument | undefined
let selected = 0
let canvas: SlideWorkspace | undefined
let generation = 0
let busy = false
const app = document.querySelector<HTMLDivElement>('#app')!

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (text !== undefined) node.textContent = text
  if (className) node.className = className
  return node
}

function post(message: BridgeMessage): void {
  window.webkit?.messageHandlers?.everyOffice?.postMessage(message)
}

const header = element('header', undefined, 'toolbar')
const heading = element('div', undefined, 'document-heading')
const name = element('h1', visualCopy(navigator.language).layout)
const status = element('p', '', 'status')
status.setAttribute('role', 'status')
status.setAttribute('aria-live', 'polite')
heading.append(name, status)
const save = element('button', copy.save, 'save')
save.type = 'button'
save.disabled = true
header.append(heading, save)
const notice = element('div', undefined, 'notice')
const mode = element('strong', visualCopy(navigator.language).layout)
const hint = element('p', visualCopy(navigator.language).hint)
notice.append(mode, hint)
const error = element('p', '', 'error')
error.setAttribute('role', 'alert')
error.hidden = true
const workspace = element('div', undefined, 'workspace')
const sidebar = element('nav', undefined, 'outline')
const outlineTitle = element('h2', copy.outline)
const outlineList = element('ol')
sidebar.append(outlineTitle, outlineList)
const main = element('main')
main.id = 'slide-text'
workspace.append(sidebar, main)
app.append(header, notice, error, workspace)

function fail(reason: unknown): void {
  const message = errorText(copy, reason)
  error.textContent = message
  error.hidden = false
  post({ type: 'error', message })
}

function updateStatus(): void {
  status.textContent = presentation && presentation.revision > 0 ? copy.changed : copy.clean
  save.disabled = !presentation || busy
}

function slideLabel(index: number): string {
  return `${copy.slide} ${index + 1}`
}

function slideTitle(index: number): string {
  const first = presentation?.slides[index]?.paragraphs.find((p) =>
    p.runs.some((r) => r.text.trim()),
  )
  return (
    first?.runs
      .map((r) => r.text)
      .join('')
      .trim() || slideLabel(index)
  )
}

function selectSlide(index: number, focus = false): void {
  selected = index
  for (const button of outlineList.querySelectorAll<HTMLButtonElement>('button')) {
    const active = Number(button.dataset.slide) === index
    button.setAttribute('aria-current', active ? 'true' : 'false')
  }
  renderSlide()
  if (focus) main.querySelector<HTMLElement>('h2')?.focus()
}

function renderOutline(): void {
  outlineTitle.textContent = copy.outline
  sidebar.setAttribute('aria-label', copy.outline)
  outlineList.replaceChildren()
  presentation?.slides.forEach((_slide, index) => {
    const item = element('li')
    const button = element('button')
    button.type = 'button'
    button.dataset.slide = String(index)
    button.setAttribute('aria-controls', main.id)
    button.append(
      element('span', slideLabel(index), 'slide-number'),
      element('span', slideTitle(index), 'preview'),
    )
    button.title = slideTitle(index)
    button.addEventListener('click', () => selectSlide(index, true))
    item.append(button)
    outlineList.append(item)
  })
}

function renderSlide(): void {
  if (presentation && canvas) {
    void canvas.render(selected)
    return
  }
  main.replaceChildren(element('p', copy.welcome, 'empty'))
}

function changed(): void {
  error.hidden = true
  updateStatus()
  renderOutline()
  for (const button of outlineList.querySelectorAll<HTMLButtonElement>('button'))
    button.setAttribute('aria-current', String(Number(button.dataset.slide) === selected))
  if (presentation) post({ type: 'changed', revision: presentation.revision })
}

async function openDocument(request: OpenRequest): Promise<void> {
  const current = ++generation
  presentation = undefined
  canvas = undefined
  selected = 0
  name.textContent = visualCopy(navigator.language).layout
  renderOutline()
  renderSlide()
  try {
    if (
      !request ||
      request.kind !== 'pptx' ||
      typeof request.name !== 'string' ||
      typeof request.base64 !== 'string'
    )
      throw new Error('invalidPresentation')
    copy = localeCopy(request.language ?? navigator.language)
    save.textContent = copy.save
    mode.textContent = visualCopy(request.language ?? navigator.language).layout
    hint.textContent = visualCopy(request.language ?? navigator.language).hint
    status.textContent = copy.loading
    error.hidden = true
    save.disabled = true
    const opened = await PresentationDocument.open(decodeBase64(request.base64), request.name)
    if (generation !== current) return
    presentation = opened
    canvas = new SlideWorkspace(main, opened, {
      language: request.language ?? navigator.language,
      changed,
      navigate(index) {
        selected = index
      },
      error: fail,
    })
    name.textContent = request.name
    name.title = request.name
    selected = 0
    renderOutline()
    const rendered = await canvas.render(0)
    outlineList.querySelector('button')?.setAttribute('aria-current', 'true')
    updateStatus()
    if (rendered) post({ type: 'opened', name: opened.name, revision: opened.revision })
  } catch (reason) {
    if (generation !== current) return
    updateStatus()
    fail(reason)
  }
}

async function saveDocument(): Promise<void> {
  if (!presentation || busy) return
  const saving = presentation
  const current = generation
  busy = true
  save.disabled = true
  status.textContent = copy.saving
  try {
    await canvas?.flushDrafts()
    const snapshot = await saving.save()
    if (current !== generation) return
    post({
      type: 'save',
      name: saving.name,
      kind: 'pptx',
      base64: encodeBase64(snapshot.bytes),
      revision: snapshot.revision,
    })
    // The native document owns the actual write; edits stay marked until it succeeds.
    status.textContent = presentation.revision === snapshot.revision ? copy.prepared : copy.changed
    error.hidden = true
  } catch (reason) {
    if (current === generation) fail(reason)
  } finally {
    busy = false
    save.disabled = !presentation
  }
}

save.addEventListener('click', () => {
  void saveDocument()
})
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    void saveDocument()
  }
})
async function exportPages(type: 'exportPDF' | 'printPages'): Promise<void> {
  if (!canvas || !presentation) return
  try {
    await canvas.flushDrafts()
    if (presentation.slides.length > 250) throw new Error('presentationTooLarge')
    const pages: Array<{ svg: string; width: number; height: number }> = []
    let total = 0
    for (let i = 0; i < presentation.slides.length; i++) {
      const { tree, size } = await canvas.visual.slide(i)
      const width = size.cx / 12700,
        height = size.cy / 12700
      if (width > 4000 || height > 4000) throw new Error('presentationTooLarge')
      const svg = new XMLSerializer().serializeToString(renderSlideSvg(tree))
      const bytes = new TextEncoder().encode(svg).byteLength
      total += bytes
      if (bytes > 20 * 1024 * 1024 || total > 64 * 1024 * 1024)
        throw new Error('presentationTooLarge')
      pages.push({ svg, width, height })
    }
    post({ type, name: presentation.name, pages })
  } catch (reason) {
    fail(reason)
  }
}

window.everyOffice = {
  openDocument,
  saveDocument,
  exportPDF: () => exportPages('exportPDF'),
  printPages: () => exportPages('printPages'),
}
renderSlide()
post({ type: 'ready' })
