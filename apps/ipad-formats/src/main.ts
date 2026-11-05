import { checkPages, exportName } from './export'
import '@genoffice/ui/tokens.css'
import './styles.css'
import { htmlView } from './html'
import { mindmapView } from './mindmap'
import { epubView } from './epub'
import { diagramView } from './diagram'
import { button, element, MAX_INPUT, type EditorView, type EditorHost } from './common'

interface OpenRequest {
  name: string
  kind: string
  base64: string
  language?: string
  locale?: string
  readingState?: unknown
}
declare global {
  interface Window {
    everyOffice: {
      openDocument(request: OpenRequest): Promise<void>
      saveDocument(): Promise<void>
      didExport(requestId: string, result: { completed: boolean; error?: string }): void
    }
    webkit?: {
      messageHandlers?: { everyOffice?: { postMessage(message: Record<string, unknown>): void } }
    }
  }
}
const root = document.getElementById('app')!
let view: EditorView | undefined
let generation = 0
let revision = 0
let name = ''
let kind = ''
let exportId = 0
const pendingExports = new Map<string, { resolve(): void; reject(error: Error): void }>()
const base64 = (bytes: Uint8Array) => {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 32768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
  return btoa(binary)
}
const exportNative = (message: Record<string, unknown>) =>
  new Promise<void>((resolve, reject) => {
    if (!window.webkit?.messageHandlers?.everyOffice) {
      reject(new Error('Native sharing is unavailable.'))
      return
    }
    const requestId = `formats-${++exportId}`
    pendingExports.set(requestId, { resolve, reject })
    post({ ...message, requestId })
  })
const post = (message: Record<string, unknown>) =>
  window.webkit?.messageHandlers?.everyOffice?.postMessage(message)
const report = (error: unknown) => {
  const text = error instanceof Error ? error.message : String(error)
  let notice = document.getElementById('editor-error')
  if (!notice) {
    notice = element('p')
    notice.id = 'editor-error'
    notice.setAttribute('role', 'alert')
    root.prepend(notice)
  }
  notice.textContent = text
  post({ type: 'error', message: text, revision })
}
window.everyOffice = {
  didExport(requestId, result) {
    const item = pendingExports.get(requestId)
    if (!item) return
    pendingExports.delete(requestId)
    if (result.error) item.reject(new Error(result.error))
    else item.resolve()
  },
  async openDocument(request) {
    const current = ++generation
    view?.dispose()
    view = undefined
    root.replaceChildren()
    revision = 0
    try {
      if (
        typeof request.base64 !== 'string' ||
        request.base64.length > Math.ceil(MAX_INPUT / 3) * 4
      )
        throw new Error('The document exceeds the 32 MB iPad limit.')
      name = request.name
      kind = request.kind.toLowerCase()
      const language = request.language ?? request.locale ?? navigator.language
      document.documentElement.lang = language
      document.documentElement.dir = /^(ar|he)(-|$)/.test(language) ? 'rtl' : 'ltr'
      const header = element('header')
      header.append(element('h1', name))
      const editor = element('div')
      editor.className = 'editor-root'
      const host: EditorHost = {
        root: editor,
        language,
        name,
        readingState: request.readingState,
        updateReadingState(state) {
          if (generation === current) post({ type: 'readingState', ...(state as object) })
        },
        changed(draft = false) {
          if (generation !== current) return
          revision++
          post({ type: 'changed', dirty: true, draft, revision })
          document.getElementById('editor-error')?.remove()
        },
        error(error) {
          if (generation === current) report(error)
        },
        async exportFile(extension, bytes) {
          if (generation !== current) return
          if (bytes.length > 64 * 1024 * 1024) throw new Error('The export exceeds 64 MB.')
          await exportNative({
            type: 'exportFile',
            name: exportName(request.name, extension),
            base64: base64(bytes),
          })
        },
        async exportPages(type, pages) {
          if (generation !== current) return
          checkPages(pages)
          await exportNative({ type, pages, name: exportName(request.name, 'pdf') })
        },
      }
      header.append(button('Save', () => window.everyOffice.saveDocument(), host))
      root.append(header, editor)
      const bytes = Uint8Array.from(atob(request.base64), (character) => character.charCodeAt(0))
      if (bytes.length > MAX_INPUT) throw new Error('The document exceeds the 32 MB iPad limit.')
      let opened: EditorView
      if (kind === 'html' || kind === 'htm') opened = htmlView(bytes, host)
      else if (kind === 'xmind') opened = await mindmapView(bytes, host)
      else if (kind === 'epub') opened = await epubView(bytes, host)
      else if (kind === 'drawio' || kind === 'dio' || /\.drawio\.(svg|png)$/i.test(request.name))
        opened = await diagramView(bytes, host)
      else throw new Error('This editor opens HTML, XMind, EPUB and draw.io files.')
      if (generation !== current) {
        opened.dispose()
        return
      }
      view = opened
      post({ type: 'opened', name, kind, revision })
    } catch (error) {
      if (generation === current) report(error)
    }
  },
  async saveDocument() {
    const currentView = view
    const current = generation
    if (!currentView) {
      report(new Error('No editable document is open.'))
      return
    }
    try {
      // Model save methods freeze their ranges/tree before awaiting archive compression.
      const saving = currentView.save()
      const savedRevision = revision
      const bytes = await saving
      if (current !== generation) return
      if (bytes.length > MAX_INPUT)
        throw new Error('The saved document exceeds the 32 MB iPad limit.')
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 32768)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
      post({ type: 'save', name, kind, base64: btoa(binary), revision: savedRevision })
    } catch (error) {
      if (generation === current) report(error)
    }
  },
}
post({ type: 'ready' })
