import { decodeBase64, encodeBase64, WordDocument } from './document'
import { stringsFor } from './strings'
import './styles.css'

interface OpenRequest {
  name: string
  base64: string
  kind: string
  language?: string
}
interface NativeMessage {
  type: string
  [key: string]: unknown
}

declare global {
  interface Window {
    webkit?: { messageHandlers?: { everyOffice?: { postMessage(message: NativeMessage): void } } }
    everyOffice: {
      openDocument(request: OpenRequest): Promise<boolean>
      saveDocument(): Promise<boolean>
    }
  }
}

let documentModel: WordDocument | undefined
let revision = 0
let opening = 0
let strings = stringsFor(navigator.language)
const root = document.getElementById('app')!
const notice = document.createElement('p')
notice.className = 'notice'
notice.setAttribute('role', 'status')
const page = document.createElement('main')
page.className = 'page'
const errorNotice = document.createElement('p')
errorNotice.className = 'error'
errorNotice.setAttribute('role', 'alert')
errorNotice.hidden = true
root.append(notice, errorNotice, page)
notice.textContent = strings.text.empty

function send(message: NativeMessage): void {
  window.webkit?.messageHandlers?.everyOffice?.postMessage(message)
}

function showError(error: unknown, fallback: 'failed' | 'cannotSave'): void {
  const key = error instanceof Error ? error.message : ''
  const localized = Object.hasOwn(strings.text, key)
    ? strings.text[key as keyof typeof strings.text]
    : strings.text[fallback]
  errorNotice.textContent = localized
  errorNotice.hidden = false
  send({ type: 'error', message: localized, revision })
}

function changed(): void {
  revision += 1
  errorNotice.hidden = true
  send({ type: 'changed', dirty: true, revision })
}

function autoSize(area: HTMLTextAreaElement): void {
  area.style.height = 'auto'
  area.style.height = `${Math.max(44, area.scrollHeight)}px`
}

function textEditor(
  text: string,
  editable: boolean,
  label: string,
  update: (value: string) => void,
): HTMLTextAreaElement {
  const area = document.createElement('textarea')
  area.value = text
  area.readOnly = !editable
  area.rows = 1
  area.dir = 'auto'
  area.spellcheck = true
  area.setAttribute('aria-label', label)
  area.addEventListener('input', () => {
    try {
      update(area.value)
      changed()
    } catch (error) {
      area.value = text
      showError(error, 'cannotSave')
    }
    text = area.value
    autoSize(area)
  })
  requestAnimationFrame(() => autoSize(area))
  return area
}

function render(): void {
  const model = documentModel!
  page.replaceChildren()
  notice.textContent = model.signed
    ? strings.text.protectedBlock
    : model.readOnly
      ? strings.text.readOnly
      : strings.text.mode
  const title = document.createElement('h1')
  title.textContent = model.name
  page.append(title)
  model.parts.forEach((part, partIndex) => {
    const section = document.createElement('section')
    section.className = part.table ? 'table-text' : part.heading ? 'heading-text' : 'paragraph-text'
    if (part.table) {
      const label = document.createElement('p')
      label.className = 'part-label'
      label.textContent = strings.text.table
      section.append(label)
    }
    if (!part.paragraphs.length || part.paragraphs.some((p) => !p.editable)) {
      const label = document.createElement('p')
      label.className = 'part-label'
      label.textContent = strings.text.protectedBlock
      section.append(label)
    }
    part.paragraphs.forEach((paragraph, index) => {
      section.append(
        textEditor(
          paragraph.text,
          paragraph.editable,
          `${strings.text.paragraph} ${partIndex + 1}.${index + 1}`,
          (text) => model.setText(partIndex, index, text),
        ),
      )
    })
    page.append(section)
  })
  if (!model.readOnly) {
    const added = document.createElement('section')
    const add = document.createElement('button')
    add.type = 'button'
    add.textContent = strings.text.add
    add.addEventListener('click', () => {
      const index = model.appendParagraph()
      const area = textEditor('', true, `${strings.text.paragraph} +${index + 1}`, (text) =>
        model.setAddedText(index, text),
      )
      added.append(area)
      changed()
      area.focus()
    })
    page.append(added, add)
  }
}

window.everyOffice = {
  async openDocument(request) {
    const generation = ++opening
    documentModel = undefined
    revision = 0
    strings = stringsFor(request.language ?? navigator.language)
    document.documentElement.lang = strings.lang
    document.documentElement.dir = ['ar', 'he'].includes(strings.lang) ? 'rtl' : 'ltr'
    page.replaceChildren()
    errorNotice.hidden = true
    notice.textContent = strings.text.loading
    try {
      if (request.kind !== 'docx') throw new Error('unsupported')
      const model = await WordDocument.open(decodeBase64(request.base64), request.name)
      if (generation !== opening) return false
      documentModel = model
      render()
      send({ type: 'opened', name: request.name, revision: 0, readOnly: model.readOnly })
      return true
    } catch (error) {
      if (generation !== opening) return false
      notice.textContent = strings.text.empty
      showError(error, 'failed')
      return false
    }
  },
  async saveDocument() {
    const model = documentModel
    const saveRevision = revision
    const generation = opening
    if (!model) {
      showError(new Error('cannotSave'), 'cannotSave')
      return false
    }
    try {
      const bytes = await model.save()
      if (generation !== opening) return false
      send({ type: 'save', name: model.name, base64: encodeBase64(bytes), revision: saveRevision })
      return true
    } catch (error) {
      showError(error, 'cannotSave')
      return false
    }
  },
}

window.addEventListener('resize', () => page.querySelectorAll('textarea').forEach(autoSize))
send({ type: 'ready' })
