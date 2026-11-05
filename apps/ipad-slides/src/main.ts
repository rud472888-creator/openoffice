import { PresentationDocument, decodeBase64, encodeBase64 } from './presentation'
import { localeCopy, errorText } from './i18n'
import './styles.css'

interface OpenRequest {
  name: string
  base64: string
  kind: 'pptx'
  language?: string
}
interface BridgeMessage {
  type: 'ready' | 'save' | 'error' | 'changed'
  base64?: string
  message?: string
  name?: string
  kind?: 'pptx'
  revision?: number
  dirty?: boolean
}
declare global {
  interface Window {
    everyOffice: {
      openDocument(request: OpenRequest): Promise<void>
      saveDocument(): Promise<void>
    }
    webkit?: { messageHandlers?: { everyOffice?: { postMessage(message: BridgeMessage): void } } }
  }
}

let copy = localeCopy(navigator.language)
let presentation: PresentationDocument | undefined
let selected = 0
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
const name = element('h1', copy.textView)
const status = element('p', '', 'status')
status.setAttribute('role', 'status')
status.setAttribute('aria-live', 'polite')
heading.append(name, status)
const save = element('button', copy.save, 'save')
save.type = 'button'
save.disabled = true
header.append(heading, save)
const notice = element('div', undefined, 'notice')
const mode = element('strong', copy.textView)
const hint = element('p', copy.hint)
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

function updateOutlineTitle(index: number): void {
  const button = outlineList.querySelector<HTMLButtonElement>(`button[data-slide="${index}"]`)
  if (!button) return
  button.title = slideTitle(index)
  const preview = button.querySelector('.preview')
  if (preview) preview.textContent = slideTitle(index)
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
  main.replaceChildren()
  const slide = presentation?.slides[selected]
  if (!slide) {
    main.append(element('p', presentation ? copy.empty : copy.welcome, 'empty'))
    return
  }
  const top = element('div', undefined, 'slide-heading')
  const title = element('h2', slideLabel(selected))
  title.tabIndex = -1
  const position = element('span', `${selected + 1} / ${presentation!.slides.length}`, 'position')
  top.append(title, position)
  main.append(top)
  if (!slide.paragraphs.length) main.append(element('p', copy.empty, 'empty'))
  slide.paragraphs.forEach((paragraph, paragraphIndex) => {
    const block = element('section', undefined, 'paragraph')
    const paragraphHeading = element('h3', `${copy.paragraph} ${paragraphIndex + 1}`)
    block.append(paragraphHeading)
    paragraph.runs.forEach((run, runIndex) => {
      const id = `text-${selected}-${paragraphIndex}-${runIndex}`
      const label = element('label', `${copy.run} ${runIndex + 1}`)
      label.htmlFor = id
      const textarea = element('textarea')
      textarea.id = id
      textarea.value = run.text
      textarea.dir = 'auto'
      textarea.rows = Math.max(
        2,
        Math.min(8, run.text.split('\n').length + Math.ceil(run.text.length / 75)),
      )
      textarea.readOnly = !run.editable
      textarea.spellcheck = true
      textarea.setAttribute(
        'aria-label',
        `${slideLabel(selected)}, ${copy.paragraph} ${paragraphIndex + 1}, ${copy.run} ${runIndex + 1}`,
      )
      if (!run.editable) {
        const readOnlyNote = element('p', copy.readOnly, 'read-only')
        readOnlyNote.id = `${id}-note`
        textarea.setAttribute('aria-describedby', readOnlyNote.id)
        block.append(readOnlyNote)
      }
      const slideIndex = selected
      textarea.addEventListener('input', () => {
        try {
          if (!presentation?.setText(slideIndex, paragraphIndex, runIndex, textarea.value)) return
          error.hidden = true
          updateStatus()
          updateOutlineTitle(slideIndex)
          post({ type: 'changed', revision: presentation.revision })
        } catch (reason) {
          textarea.value = run.text
          fail(reason)
        }
      })
      block.append(label, textarea)
    })
    main.append(block)
  })
  const paging = element('div', undefined, 'paging')
  for (const [label, index] of [
    [copy.previous, selected - 1],
    [copy.next, selected + 1],
  ] as const) {
    const button = element('button', label)
    button.type = 'button'
    button.disabled = index < 0 || index >= presentation!.slides.length
    button.addEventListener('click', () => selectSlide(index, true))
    paging.append(button)
  }
  main.append(paging)
}

async function openDocument(request: OpenRequest): Promise<void> {
  const current = ++generation
  presentation = undefined
  selected = 0
  name.textContent = copy.textView
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
    mode.textContent = copy.textView
    hint.textContent = copy.hint
    status.textContent = copy.loading
    error.hidden = true
    save.disabled = true
    const opened = await PresentationDocument.open(decodeBase64(request.base64), request.name)
    if (generation !== current) return
    presentation = opened
    name.textContent = request.name
    name.title = request.name
    selected = 0
    renderOutline()
    selectSlide(0)
    updateStatus()
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
window.everyOffice = { openDocument, saveDocument }
renderSlide()
post({ type: 'ready' })
