import './styles.css'
import { inspectPptx, maxPptxBytes } from './input'
import { localeCopy, errorText } from './i18n'

type OpenFile = { kind: string; name: string; base64: string; language?: string }
type DeckWindow = Window & { wasmBindings?: { everyoffice_request_save(): void } }
declare global {
  interface Window {
    everyOffice: { openDocument(file: OpenFile): void; saveDocument(): void }
    webkit?: {
      messageHandlers: { everyOffice: { postMessage(message: Record<string, unknown>): void } }
    }
  }
}

const post = (message: Record<string, unknown>) =>
  window.webkit?.messageHandlers.everyOffice.postMessage(message)
const limit = 100 * 1024 * 1024
let frame: HTMLIFrameElement | undefined
let source: OpenFile | undefined
let generation = 0
let protectedFile = false
let copy = localeCopy(navigator.language)
let ready = false
let modified = false
let revision = 0
let timeout: ReturnType<typeof setTimeout> | undefined
const fail = (message: string) => {
  clearTimeout(timeout)
  document.getElementById('error')!.textContent = message
  post({ type: 'error', message })
}

function encode(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
  return btoa(binary)
}

window.addEventListener('message', (event) => {
  const child = frame?.contentWindow as DeckWindow | undefined
  if (!child || event.origin !== location.origin || event.source !== child || !source) return
  const data = event.data
  if (!data || typeof data !== 'object') return
  switch (data.type) {
    case 'deckcraft:ready': {
      child.addEventListener(
        'everyoffice-opened',
        () => {
          if (child !== frame?.contentWindow) return
          clearTimeout(timeout)
          ready = true
          post({ type: 'opened', name: source!.name, revision })
        },
        { once: true },
      )
      const bytes = Uint8Array.from(atob(source.base64), (character) => character.charCodeAt(0))
      child.postMessage({ type: 'deckcraft:open', name: source.name, bytes }, location.origin, [
        bytes.buffer,
      ])
      break
    }
    case 'deckcraft:failed':
      fail(String(data.error || 'Unable to open the presentation.'))
      break
    case 'deckcraft:dirty':
      if (ready && data.dirty === true && protectedFile) {
        fail(copy.readOnly)
        return
      }
      if (ready && data.dirty === true && !modified) {
        modified = true
        post({ type: 'changed', revision: ++revision })
      }
      break
    case 'deckcraft:save': {
      if (
        !ready ||
        typeof data.name !== 'string' ||
        !(data.bytes instanceof ArrayBuffer) ||
        data.bytes.byteLength > limit ||
        !data.bytes.byteLength
      ) {
        fail('Invalid DeckCraft save.')
        return
      }
      if (data.name.toLowerCase().endsWith('.pptx') && data.bytes.byteLength > maxPptxBytes) {
        fail(copy.tooLarge)
        return
      }
      const base64 = encode(new Uint8Array(data.bytes))
      if (data.saveAs || data.name !== source.name) {
        const copy = data.saveAs && data.name.toLowerCase().endsWith('.pptx')
        post({ type: copy ? 'importCopy' : 'exportFile', name: data.name, kind: 'pptx', base64 })
        return
      }
      if (protectedFile) {
        fail(copy.readOnly)
        return
      }
      clearTimeout(timeout)
      source.base64 = base64
      modified = false
      post({ type: 'save', revision, name: source.name, kind: 'pptx', base64 })
      break
    }
  }
})

window.everyOffice = {
  async openDocument(file) {
    const opening = ++generation
    copy = localeCopy(file.language ?? navigator.language)
    clearTimeout(timeout)
    frame?.remove()
    frame = undefined
    source = undefined
    ready = modified = false
    revision = 0
    document.getElementById('error')!.textContent = ''
    if (
      file.kind !== 'pptx' ||
      !file.base64 ||
      file.base64.length > Math.ceil(maxPptxBytes / 3) * 4
    ) {
      fail('Invalid PPTX file.')
      return
    }
    try {
      const inspection = await inspectPptx(
        Uint8Array.from(atob(file.base64), (character) => character.charCodeAt(0)),
      )
      if (opening !== generation) return
      protectedFile = inspection.protected
    } catch (error) {
      if (opening === generation) fail(errorText(copy, error))
      return
    }
    source = { ...file }
    frame = document.createElement('iframe')
    frame.title = 'DeckCraft'
    frame.src = './deckcraft/index.html?host=parent&webgl' + (protectedFile ? '&readonly' : '')
    if (protectedFile) document.getElementById('error')!.textContent = copy.readOnly
    document.getElementById('app')!.append(frame)
    timeout = setTimeout(() => fail('DeckCraft could not open the presentation.'), 45000)
  },
  saveDocument() {
    if (!ready || !source) return
    if (!modified) {
      post({ type: 'save', name: source.name, kind: 'pptx', revision, base64: source.base64 })
      return
    }
    const bindings = (frame?.contentWindow as DeckWindow | undefined)?.wasmBindings
    if (!bindings) {
      fail('DeckCraft is unavailable.')
      return
    }
    clearTimeout(timeout)
    timeout = setTimeout(() => fail('DeckCraft did not finish saving.'), 15000)
    bindings.everyoffice_request_save()
  },
}
post({ type: 'ready' })
