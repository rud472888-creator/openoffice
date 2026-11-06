import { createEditor, type RhwpEditor } from '@rhwp/editor'
import { createAgentBridge } from '../../hwp/src/renderer/ai/agent-bridge'
import { seededStudioSettings } from '../../hwp/src/renderer/studio-settings'
import type { SaveEditorPort } from '../../hwp/src/renderer/save-flow'
import { HwpSession, SaveRefused } from './session'
import { initializeHwpCore } from './browser-memos'
import { convertHwpSnapshot } from './convert'
import { gatherPrintJob } from '../../hwp/src/renderer/print-flow'
import './style.css'

type Payload = { name: string; base64: string; kind: string; language?: string; locale?: string }
declare global {
  interface Window {
    webkit?: { messageHandlers: { everyOffice: { postMessage(message: unknown): void } } }
    everyOffice: {
      openDocument(payload: Payload): Promise<void>
      saveDocument(): Promise<void>
      performAction(action: 'pdf' | 'print' | 'convert'): Promise<void>
      didSave(revision: number): Promise<void>
    }
  }
}
const dictionaries = import.meta.glob<{ [name: string]: Record<string, string> }>(
  '../../hwp/src/renderer/i18n/app/*.ts',
  { eager: true },
)
let locale = 'en'
function text(key: string): string {
  const module =
    dictionaries[`../../hwp/src/renderer/i18n/app/${locale}.ts`] ??
    dictionaries['../../hwp/src/renderer/i18n/app/en.ts']!
  const dictionary = Object.values(module)[0]!
  return dictionary[key] ?? key
}
const send = (message: unknown) => window.webkit?.messageHandlers.everyOffice.postMessage(message)
const report = (error: unknown) => {
  const message =
    error instanceof SaveRefused
      ? text(error.reason)
      : `${text('saveFailed')} ${error instanceof Error ? error.message : String(error)}`
  const element = document.querySelector<HTMLElement>('#error')!
  element.textContent = message
  element.hidden = false
  send({ type: 'error', message })
}
let editor: RhwpEditor | undefined
let session: HwpSession | undefined
let revision = 0
let acknowledged = 0
let fileName = ''
let saving = false
let loading = false
let acknowledging: Promise<void> = Promise.resolve()
let timer: ReturnType<typeof setTimeout> | undefined
let saveJobs: Promise<void> = Promise.resolve()
function serializeSave(job: () => Promise<void>): Promise<void> {
  const next = saveJobs.then(job)
  saveJobs = next.catch(() => {})
  return next
}
const pending = new Map<number, Uint8Array>()
const bridge = createAgentBridge(() => editor ?? null)

function changed() {
  if (loading || !session) return
  revision++
  send({ type: 'changed', revision, draft: true })
  clearTimeout(timer)
  timer = setTimeout(() => send({ type: 'changed', revision, draft: false }), 1200)
}

async function print(mode: 'exportPDF' | 'printPages') {
  await bridge.setMemoLock(true)
  try {
    const job = await gatherPrintJob(bridge, 'pdf', (_done, total) => {
      if (total > 250) throw new Error(text('pdfFailed'))
    })
    const pages = job.pages.map((page) => ({
      svg: page.svg.replace(
        /href="ieum-image:(\d+)"/g,
        (_match, index: string) => `href="${job.images[Number(index)] ?? ''}"`,
      ),
      width: page.width * 0.75,
      height: page.height * 0.75,
    }))
    send({ type: mode, pages, name: fileName.replace(/\.hwpx?$/i, '.pdf') })
  } finally {
    await bridge.setMemoLock(false)
  }
}

async function exportCopy() {
  return serializeSave(async () => {
    await acknowledging
    if (!session || !editor) return
    if (session.tracked) throw new SaveRefused('saveTracked')
    const port = savePort()
    if (await port.isPasswordProtected()) throw new SaveRefused('saveProtected')
    clearTimeout(timer)
    saving = true
    try {
      const context = await editor.commands.context()
      const snapshot = await session.save(
        port,
        revision !== acknowledged || context.isDirty === true,
      )
      await initializeHwpCore()
      const format = session.format === 'hwp' ? 'hwpx' : 'hwp'
      const bytes = await convertHwpSnapshot(snapshot, format)
      send({
        type: 'saveAsFile',
        name: fileName.replace(/\.hwpx?$/i, `.${format}`),
        kind: format,
        base64: encode(bytes),
      })
    } finally {
      saving = false
    }
  })
}

function savePort(): SaveEditorPort {
  const current = editor!
  return {
    isPasswordProtected: async () => {
      const flag = (await current.commands.context()).passwordProtected
      if (typeof flag !== 'boolean') throw new Error('Missing protection status')
      return flag
    },
    exportHwp: () => current.exportHwp(),
    exportHwpx: () => current.exportHwpx(),
    exportHwpVerify: () => current.exportHwpVerify(),
    listMemos: async () => (await bridge.listMemos()).memos,
    setMemoLock: (locked) => bridge.setMemoLock(locked),
    measureTabs: async (spots) => (await bridge.measureTabs(spots)).tabs,
    notifySaved: (name) => current.notifySaved(name),
  }
}

function encode(bytes: Uint8Array): string {
  let binary = ''
  for (let at = 0; at < bytes.length; at += 32768)
    binary += String.fromCharCode(...bytes.subarray(at, at + 32768))
  return btoa(binary)
}

window.everyOffice = {
  async performAction(action) {
    if (action === 'pdf') await print('exportPDF')
    else if (action === 'print') await print('printPages')
    else if (action === 'convert') await exportCopy()
  },
  async openDocument(payload) {
    try {
      loading = true
      locale = payload.language ?? payload.locale ?? 'en'
      fileName = payload.name
      if (payload.kind !== 'hwp' && payload.kind !== 'hwpx') throw new Error('Invalid HWP format')
      const bytes = Uint8Array.from(atob(payload.base64), (char) => char.charCodeAt(0))
      session = await HwpSession.open(bytes, payload.kind)
      localStorage.setItem('rhwp-settings', seededStudioSettings(null, 'system'))
      editor?.destroy()
      const studioUrl = new URL(
        `./studio/index.html?chrome=embed&lang=${locale === 'ko' ? 'ko' : 'en'}`,
        location.href,
      ).href
      editor = await createEditor(document.querySelector<HTMLElement>('#editor')!, {
        studioUrl,
        renderer: 'canvas2d',
        requestTimeoutMs: 60000,
      })
      await editor.loadFile(bytes, payload.name, { skipUnsavedGuard: true })
      await bridge.listMemos()
      await editor.chrome.set({ menu: true, toolbar: true })
      const frame = editor.element.contentWindow!
      const style = frame.document.createElement('style')
      style.textContent = '#style-bar, [data-cmd="insert:comment"] { display: none !important }'
      frame.document.head.append(style)
      frame.addEventListener('ieum:dirty-changed', (event) => {
        if ((event as CustomEvent).detail === true) changed()
      })
      frame.document.addEventListener('input', changed, true)
      frame.document.addEventListener('paste', changed, true)
      frame.document.addEventListener('cut', changed, true)
      editor.onDocumentChanged(changed)
      revision = acknowledged = 0
      pending.clear()
      document.querySelector<HTMLElement>('#error')!.hidden = true
      send({ type: 'opened', name: payload.name, revision: 0 })
    } catch (error) {
      report(error)
    } finally {
      loading = false
    }
  },
  async saveDocument() {
    return serializeSave(async () => {
      await acknowledging
      if (!session || !editor) return
      clearTimeout(timer)
      saving = true
      const savedRevision = revision
      try {
        const context = await editor.commands.context()
        const bytes = await session.save(
          savePort(),
          savedRevision !== acknowledged || context.isDirty === true,
        )
        pending.set(savedRevision, bytes)
        send({ type: 'save', revision: savedRevision, base64: encode(bytes) })
      } catch (error) {
        report(error)
      } finally {
        saving = false
      }
    })
  },
  async didSave(savedRevision) {
    const previous = acknowledging
    acknowledging = (async () => {
      await previous
      const bytes = pending.get(savedRevision)
      if (!bytes || !session || !editor || savedRevision < acknowledged) return
      acknowledged = savedRevision
      session = await HwpSession.open(bytes, session.format)
      for (const key of pending.keys()) if (key <= savedRevision) pending.delete(key)
      if (savedRevision === revision) await editor.notifySaved(fileName)
    })().catch(report)
    await acknowledging
  },
}

// Some toolbar commands do not emit DOM input. Poll the cheap dirty flag, not a document hash.
setInterval(() => {
  if (!editor || loading || saving || revision !== acknowledged) return
  void editor.commands
    .context()
    .then((context) => {
      if (context.isDirty === true) changed()
    })
    .catch(report)
}, 2000)
send({ type: 'ready' })
