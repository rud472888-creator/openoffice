import { paginateHtml, printActions } from './export'
import { parseDocText, serializeDocText } from '../../html/src/renderer/document/envelope'
import { buildParseMap, type ParseMap } from '../../html/src/renderer/document/parse-map'
import { instrumentForPreview } from '../../html/src/renderer/preview/instrument'
import { applyPatches } from '../../html/src/renderer/document/patch'
import { ask, assertText, button, element, type EditorHost, type EditorView } from './common'

export class HtmlDocument {
  readonly envelope
  text: string
  private history: string[] = []
  private future: string[] = []
  constructor(readonly original: Uint8Array) {
    this.envelope = parseDocText(
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(original),
    )
    this.text = this.envelope.text
    assertText(this.text)
  }
  setText(text: string): void {
    assertText(text)
    if (text === this.text) return
    this.history.push(this.text)
    while (
      this.history.length > 30 ||
      this.history.reduce((n, s) => n + s.length, 0) > 16 * 1024 * 1024
    )
      this.history.shift()
    this.future = []
    this.text = text
  }
  undo(): void {
    const previous = this.history.pop()
    if (previous !== undefined) {
      this.future.push(this.text)
      this.text = previous
    }
  }
  redo(): void {
    const next = this.future.pop()
    if (next !== undefined) {
      this.history.push(this.text)
      this.text = next
    }
  }
  save(): Uint8Array {
    if (this.text === this.envelope.text) return this.original
    return new TextEncoder().encode(serializeDocText({ ...this.envelope, text: this.text }))
  }
}

const PREVIEW_CSP =
  "default-src 'none';script-src 'none';style-src 'unsafe-inline';img-src data: blob:;font-src data:;connect-src 'none';object-src 'none';frame-src 'none';base-uri 'none';form-action 'none'"

/** Author HTML never receives scripting privileges or the native bridge. */
export function safeHtmlPreview(text: string, map: ParseMap): string {
  const doc = new DOMParser().parseFromString(instrumentForPreview(text, map, ''), 'text/html')
  for (const node of doc.querySelectorAll(
    'script,iframe,object,embed,base,meta[http-equiv],link[rel="stylesheet"],form',
  ))
    node.remove()
  for (const node of doc.querySelectorAll('*'))
    for (const attr of [...node.attributes]) {
      if (
        /^on/i.test(attr.name) ||
        (/^(?:href|src|srcset|action|formaction|xlink:href)$/i.test(attr.name) &&
          !attr.value.startsWith('data:image/'))
      )
        node.removeAttribute(attr.name)
    }
  const csp = doc.createElement('meta')
  csp.httpEquiv = 'Content-Security-Policy'
  csp.content = PREVIEW_CSP
  doc.head.prepend(csp)
  return '<!doctype html>' + doc.documentElement.outerHTML
}

export function htmlView(bytes: Uint8Array, host: EditorHost): EditorView {
  const model = new HtmlDocument(bytes)
  const toolbar = element('div')
  toolbar.className = 'toolbar'
  const source = element('textarea')
  source.className = 'source'
  source.value = model.text
  source.setAttribute('aria-label', 'HTML source')
  source.spellcheck = false
  const frame = element('iframe')
  frame.title = 'HTML preview'
  frame.setAttribute('sandbox', 'allow-same-origin')
  const panes = element('div')
  panes.className = 'html-panes'
  panes.append(source, frame)
  let map: ParseMap
  let previewText = ''
  let selected: number | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const preview = () => {
    previewText = model.text
    selected = null
    map = buildParseMap(model.text, (map?.version ?? 0) + 1, map ?? null)
    frame.srcdoc = safeHtmlPreview(model.text, map)
  }
  const sync = () => {
    source.value = model.text
    preview()
    host.changed()
  }
  source.addEventListener('input', () => {
    try {
      model.setText(source.value)
      host.changed()
      clearTimeout(timer)
      timer = setTimeout(preview, 350)
    } catch (error) {
      source.value = model.text
      host.error(error)
    }
  })
  frame.addEventListener('load', () => {
    frame.contentDocument?.addEventListener('click', (event) => {
      event.preventDefault()
      const node = (event.target as Element).closest?.('[data-gx-sid]')
      selected = Number(node?.getAttribute('data-gx-sid')) || null
      for (const old of frame.contentDocument!.querySelectorAll('[data-selected]'))
        old.removeAttribute('data-selected')
      node?.setAttribute('data-selected', '')
      if (node) (node as HTMLElement).style.outline = '2px solid #2864df'
    })
  })
  toolbar.append(
    button(
      'Undo',
      () => {
        model.undo()
        sync()
      },
      host,
    ),
    button(
      'Redo',
      () => {
        model.redo()
        sync()
      },
      host,
    ),
    button(
      'Source / Preview',
      () => {
        panes.classList.toggle('preview-only')
      },
      host,
    ),
    button(
      'Edit selected text',
      async () => {
        if (previewText !== model.text) {
          preview()
          throw new Error('The source changed. Select the text again.')
        }
        const editSource = model.text
        const entry = selected === null ? undefined : map.bySid.get(selected)
        if (
          !entry?.endTag ||
          map.elements.some((e) => e.parentSid === entry.sid) ||
          ['script', 'style', 'textarea'].includes(entry.tag)
        )
          throw new Error('Choose a text element without nested content, or edit its HTML source.')
        const old =
          new DOMParser().parseFromString(model.text.slice(...entry.range), 'text/html').body
            .textContent ?? ''
        const value = await ask('Edit text', old, host)
        if (value === null) return
        if (model.text !== editSource) throw new Error('The source changed. Retry the edit.')
        const text = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        model.setText(
          applyPatches(model.text, [{ from: entry.inner[0], to: entry.inner[1], text }]),
        )
        sync()
      },
      host,
    ),
    button(
      'Insert paragraph',
      () => {
        const at = model.text.search(/<\/body\s*>/i)
        model.setText(
          applyPatches(model.text, [
            {
              from: at < 0 ? model.text.length : at,
              to: at < 0 ? model.text.length : at,
              text: '<p>New paragraph</p>',
            },
          ]),
        )
        sync()
      },
      host,
    ),
  )
  const actions = printActions(host, () => paginateHtml(model.text))
  toolbar.append(
    button('Export PDF', actions.pdf, host),
    button('Print', actions.print, host),
    button('Export HTML', () => host.exportFile('html', model.save()), host),
  )
  host.root.append(toolbar, panes)
  preview()
  return {
    save: async () => model.save(),
    dispose: () => {
      clearTimeout(timer)
      frame.srcdoc = ''
      host.root.replaceChildren()
    },
  }
}
