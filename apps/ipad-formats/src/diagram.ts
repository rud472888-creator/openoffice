import { printActions, singleHtmlPage, utf8, type PrintPage } from './export'
import { parseBridgeMessage } from '../../diagram/src/shared/bridge-protocol'
import { assertText, button, element, type EditorHost, type EditorView } from './common'

/** Full offline draw.io UI, with the desktop bridge over the native local HTTP origin. */
export async function diagramView(bytes: Uint8Array, host: EditorHost): Promise<EditorView> {
  if (!/^https?:$/.test(location.protocol))
    throw new Error('Diagram editing requires the app’s local document host.')
  const xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  assertText(xml)
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Unsupported diagram XML.')
  const parsed = new DOMParser().parseFromString(xml, 'application/xml')
  if (
    parsed.querySelector('parsererror') ||
    !['mxfile', 'mxGraphModel'].includes(parsed.documentElement.localName)
  )
    throw new Error('This is not a draw.io diagram.')
  const compressed = [...parsed.querySelectorAll('diagram')].some(
    (node) => !node.querySelector('mxGraphModel') && !!node.textContent?.trim(),
  )
  const frame = element('iframe')
  frame.title = 'Diagram editor'
  frame.className = 'diagram-frame'
  frame.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-downloads')
  const origin = location.origin
  let dirty = false
  let loaded = false
  let disposed = false
  let next = 0
  const pending = new Map<
    string,
    {
      resolve(value: unknown): void
      reject(error: Error): void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  const exports = new Map<
    string,
    {
      resolve(value: Record<string, unknown>): void
      reject(error: Error): void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  const send = (message: unknown) => {
    if (!frame.contentWindow || disposed) throw new Error('The diagram editor is closed.')
    frame.contentWindow.postMessage(message, origin)
  }
  const request = (op: string, args: unknown): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = `ipad-${++next}`
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`The diagram editor did not answer ${op}.`))
      }, 30000)
      pending.set(id, { resolve, reject, timer })
      send({ ieum: 1, kind: 'request', id, op, args })
    })
  let resolveLoaded: () => void
  let rejectLoaded: (error: Error) => void
  const ready = new Promise<void>((resolve, reject) => {
    resolveLoaded = resolve
    rejectLoaded = reject
  })
  const loadTimer = setTimeout(
    () => rejectLoaded(new Error('The local diagram editor did not load.')),
    45000,
  )
  const receive = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || event.origin !== origin || disposed) return
    const bridge = parseBridgeMessage(event.data)
    if (bridge?.kind === 'reply') {
      const item = pending.get(bridge.id)
      if (!item) return
      pending.delete(bridge.id)
      clearTimeout(item.timer)
      if (bridge.ok) item.resolve(bridge.value)
      else item.reject(new Error(bridge.error))
      return
    }
    if (bridge?.kind === 'event') {
      if (bridge.name === 'dirty') dirty = bridge.dirty
      if (bridge.name === 'changed' && loaded) {
        dirty = true
        host.changed()
      }
      if (bridge.name === 'shortcut' && (bridge.key === 'save' || bridge.key === 'saveAs'))
        void window.everyOffice.saveDocument()
      if (bridge.name === 'command' && bridge.command === 'save')
        window.everyOffice.saveDocument().catch(host.error)
      return
    }
    if (typeof event.data !== 'string') return
    let message: Record<string, unknown>
    try {
      message = JSON.parse(event.data) as Record<string, unknown>
    } catch {
      return
    }
    if (message.event === 'init') send(JSON.stringify({ action: 'load', xml, autosave: 1 }))
    else if (message.event === 'load') {
      loaded = true
      dirty = false
      clearTimeout(loadTimer)
      void request('setCompressed', { compressed })
        .then(() => resolveLoaded())
        .catch(rejectLoaded)
    } else if (message.event === 'export') {
      const id = (message.message as { ieumId?: string } | undefined)?.ieumId
      const item = id ? exports.get(id) : undefined
      if (!item || !id) return
      exports.delete(id)
      clearTimeout(item.timer)
      item.resolve(message)
    } else if (message.event === 'save') void window.everyOffice.saveDocument()
  }
  window.addEventListener('message', receive)
  const toolbar = element('div')
  toolbar.className = 'toolbar'
  toolbar.append(
    button('Undo', () => request('runAction', { action: 'undo' }), host),
    button('Redo', () => request('runAction', { action: 'redo' }), host),
    button('Fit', () => request('runAction', { action: 'fitWindow' }), host),
  )
  const pages = async () => ((await request('pageInfo', {})) as { pages: { id: string }[] }).pages
  const svgPage = async (pageId: string) =>
    (await request('pageSvg', { pageId, theme: 'light' })) as {
      svg: string
      width: number
      height: number
    }
  const exportPages = printActions(host, async () => {
    const result: PrintPage[] = []
    for (const page of await pages()) {
      const value = await svgPage(page.id)
      // Draw.io units are hundredths of an inch; the native renderer uses PDF points.
      result.push(await singleHtmlPage(value.svg, value.width * 0.96, value.height * 0.96))
    }
    return result
  })
  toolbar.append(
    button('Export PDF', exportPages.pdf, host),
    button('Print', exportPages.print, host),
    button(
      'Export SVG',
      async () => {
        const info = (await request('pageInfo', {})) as { currentPage: string }
        await host.exportFile('svg', utf8((await svgPage(info.currentPage)).svg))
      },
      host,
    ),
    button(
      'Export PNG',
      async () => {
        const info = (await request('pageInfo', {})) as { currentPage: string }
        const value = (await request('pagePng', { pageId: info.currentPage })) as {
          bytes: Uint8Array
        }
        await host.exportFile('png', new Uint8Array(value.bytes))
      },
      host,
    ),
  )
  host.root.append(toolbar, frame)
  const params = new URLSearchParams({
    embed: '1',
    proto: 'json',
    offline: '1',
    stealth: '1',
    lockdown: '1',
    noExitBtn: '1',
    saveAndExit: '0',
    browser: '0',
    spin: '1',
    lang: host.language,
  })
  frame.src = `./drawio/index.html?${params}`
  try {
    await ready
  } catch (error) {
    window.removeEventListener('message', receive)
    frame.remove()
    clearTimeout(loadTimer)
    throw error
  }
  return {
    async save() {
      if (!dirty) return bytes
      const id = `export-${++next}`
      const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => {
          exports.delete(id)
          reject(new Error('Diagram export timed out.'))
        }, 30000)
        exports.set(id, { resolve, reject, timer })
        send(JSON.stringify({ action: 'export', format: 'xml', ieumId: id }))
      })
      if (typeof result.xml !== 'string' || !result.xml.trim())
        throw new Error('The diagram editor returned no XML.')
      assertText(result.xml)
      return new TextEncoder().encode(result.xml)
    },
    dispose() {
      disposed = true
      clearTimeout(loadTimer)
      window.removeEventListener('message', receive)
      for (const item of [...pending.values(), ...exports.values()]) {
        clearTimeout(item.timer)
        item.reject(new Error('Diagram editor closed.'))
      }
      pending.clear()
      exports.clear()
      frame.remove()
      host.root.replaceChildren()
    },
  }
}
