import { decodeBase64, encodeBase64 } from './document'
import { openRichDocument } from './formats'
import type { RichWordDocument } from './rich-document'
import { completeNativeExport } from './print-preview'
import { mountRichEditor } from './rich-editor'
import { stringsFor } from './strings'
import type { Editor } from '@tiptap/core'
import { t } from '../../docs/src/renderer/i18n/locale'
import type { PmNode } from '../../docs/src/renderer/editor/convert'
import '@genoffice/ui/tokens.css'
import '../../docs/src/renderer/styles.css'
import '../../docs/src/renderer/fonts/fonts.css'
import { adoptEmbeddedFonts } from '../../docs/src/renderer/embedded-fonts'
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
      didExport(id: string, result: { completed: boolean; error?: string }): void
    }
  }
}

let documentModel: RichWordDocument | undefined
let editor: Editor | undefined
let revision = 0
let opening = 0
let strings = stringsFor(navigator.language)
const root = document.getElementById('app')!
const notice = document.createElement('p')
notice.className = 'notice'
notice.setAttribute('role', 'status')
const viewport = document.createElement('main')
viewport.className = 'editor-viewport editor-scroll'
const toolbar = document.createElement('div')
toolbar.className = 'touch-ribbon'
const conversionNotice = document.createElement('p')
conversionNotice.className = 'notice'
const errorNotice = document.createElement('p')
errorNotice.className = 'error'
errorNotice.setAttribute('role', 'alert')
errorNotice.hidden = true
root.append(toolbar, notice, errorNotice, conversionNotice, viewport)
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

window.everyOffice = {
  didExport: completeNativeExport,
  async openDocument(request) {
    const generation = ++opening
    editor?.destroy()
    editor = undefined
    documentModel = undefined
    revision = 0
    strings = stringsFor(request.language ?? navigator.language)
    document.documentElement.lang = strings.lang
    document.documentElement.dir = ['ar', 'he'].includes(strings.lang) ? 'rtl' : 'ltr'
    viewport.replaceChildren()
    toolbar.replaceChildren()
    errorNotice.hidden = true
    notice.textContent = strings.text.loading
    conversionNotice.textContent = ''
    try {
      const model = await openRichDocument(decodeBase64(request.base64), request.name, request.kind)
      const source = model.source
      if (generation !== opening) return false
      await adoptEmbeddedFonts(source.parsed.embeddedFonts)
      if (generation !== opening) return false
      documentModel = model
      const host = document.createElement('div')
      host.className = 'rich-editor-host fit-width'
      viewport.append(host)
      editor = mountRichEditor({
        element: host,
        toolbar,
        language: strings.lang,
        model,
        changed() {
          revision += 1
          errorNotice.hidden = true
          send({ type: 'changed', dirty: true, revision })
        },
        error(error) {
          showError(error, 'cannotSave')
        },
      })
      if (model.legacy) {
        const copy = document.createElement('button')
        copy.type = 'button'
        copy.textContent = `${t('ribbonSaveAs')} .docx`
        copy.addEventListener('click', () =>
          send({
            type: 'importCopy',
            name: request.name.replace(/\.doc$/i, '') + '.docx',
            base64: encodeBase64(model.legacy!.docx),
            kind: 'docx',
          }),
        )
        toolbar.prepend(copy)
        if (model.legacy.warnings.length)
          conversionNotice.textContent = model.legacy.warnings.join(' ')
      }
      notice.textContent = model.legacy
        ? `${t('ribbonSaveAs')} .docx`
        : source.signed || model.odt?.signed
          ? strings.text.protectedBlock
          : model.readOnly
            ? strings.text.readOnly
            : ''
      viewport.setAttribute('aria-description', notice.textContent || strings.text.mode)
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
    if (!model || !editor) {
      showError(new Error('cannotSave'), 'cannotSave')
      return false
    }
    try {
      const content = editor.getJSON() as PmNode
      const bytes = await model.save(content)
      if (generation !== opening) return false
      send({
        type: 'save',
        name: model.source.name,
        base64: encodeBase64(bytes),
        revision: saveRevision,
      })
      return true
    } catch (error) {
      showError(error, 'cannotSave')
      return false
    }
  },
}

send({ type: 'ready' })
