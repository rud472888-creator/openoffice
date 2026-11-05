import {
  pageGeometry,
  pageCount,
  viewOffset,
  previewCss,
  PREVIEW_DEFAULTS,
  fixedViewport,
  fixedPageCss,
} from '../../epub/src/renderer/reader/preview-pages'
import type { EditorHost } from './common'

export type PrintPage =
  { width: number; height: number; html: string } | { width: number; height: number; svg: string }
const encode = new TextEncoder()
export function checkPages(pages: PrintPage[]): void {
  if (!pages.length || pages.length > 250) throw new Error('Export supports 1–250 pages.')
  let total = 0
  for (const page of pages) {
    if (![page.width, page.height].every((n) => Number.isFinite(n) && n > 0 && n <= 4000))
      throw new Error('The page exceeds the supported print dimensions.')
    const size = encode.encode('html' in page ? page.html : page.svg).length
    if (size > 20 * 1024 * 1024 || (total += size) > 64 * 1024 * 1024)
      throw new Error('The export exceeds the 64 MB document or 20 MB page limit.')
  }
}
export function exportName(name: string, extension: string): string {
  return `${name.replace(/\.[^.]+$/, '')}.${extension}`
}
export function utf8(text: string): Uint8Array {
  return encode.encode(text)
}
const CSP =
  "default-src 'none';style-src 'unsafe-inline';img-src data:;font-src data:;script-src 'none';connect-src 'none';base-uri 'none'"

async function dataUrl(url: string): Promise<string> {
  if (url.startsWith('data:')) return url
  if (!url.startsWith('blob:')) return ''
  const blob = await (await fetch(url)).blob()
  if (blob.size > 16 * 1024 * 1024) throw new Error('A print asset exceeds 16 MB.')
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
async function cssData(css: string): Promise<string> {
  css = css.replace(/@import\s+[^;]+;?/gi, '')
  const matches = [...css.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/gi)]
  for (const match of matches) css = css.replace(match[0], `url("${await dataUrl(match[1]!)}")`)
  return css
}
/** Produce inert, self-contained fragments accepted by the native print renderer. */
export async function printDocument(source: string): Promise<Document> {
  const doc = new DOMParser().parseFromString(source, 'text/html')
  for (const link of doc.querySelectorAll('link[rel="stylesheet"]')) {
    const href = link.getAttribute('href') ?? ''
    if (href.startsWith('blob:')) {
      const style = doc.createElement('style')
      style.textContent = await cssData(await (await fetch(href)).text())
      link.replaceWith(style)
    }
  }
  for (const node of doc.querySelectorAll(
    'script,iframe,frame,frameset,object,embed,base,meta,form,link',
  ))
    node.remove()
  for (const node of doc.querySelectorAll('*')) {
    node.removeAttribute('contenteditable')
    node.removeAttribute('spellcheck')
    for (const attr of [...node.attributes]) {
      if (/^on/i.test(attr.name) || /^(srcset|action|formaction|poster)$/i.test(attr.name))
        node.removeAttribute(attr.name)
      else if (/^(src|href|xlink:href)$/i.test(attr.name)) {
        if (attr.value.startsWith('#')) continue
        const allowed =
          /^data:(?:image\/|font\/|application\/(?:font|x-font))/i.test(attr.value) ||
          attr.value.startsWith('blob:')
        const value = allowed ? await dataUrl(attr.value) : ''
        if (value) node.setAttribute(attr.name, value)
        else node.removeAttribute(attr.name)
      } else if (attr.name === 'style') node.setAttribute('style', await cssData(attr.value))
    }
  }
  for (const style of doc.querySelectorAll('style'))
    style.textContent = await cssData(style.textContent ?? '')
  return doc
}
function scopedStyles(doc: Document): string {
  return [...doc.querySelectorAll('style')]
    .map((node) => node.textContent ?? '')
    .join('\n')
    .replace(/(^|[\s,>+~({])(?:html|:root)(?=[\s.#:[>,+~{]|$)/gi, '$1.eo-print-root')
    .replace(/(^|[\s,>+~({])body(?=[\s.#:[>,+~{]|$)/gi, '$1.eo-print-body')
}
function fragment(doc: Document, extra = ''): string {
  const body = doc.createElement('div')
  for (const attr of [...doc.body.attributes]) body.setAttribute(attr.name, attr.value)
  body.classList.add('eo-print-body')
  body.innerHTML = doc.body.innerHTML
  for (const style of body.querySelectorAll('style')) style.remove()
  return `<style>${scopedStyles(doc)}${extra}</style><div class="eo-print-root">${body.outerHTML}</div>`
}
/** The desktop snapshot already lays out a single page at CSS 96dpi. */
export async function singleHtmlPage(
  source: string,
  width: number,
  height: number,
): Promise<PrintPage> {
  const doc = await printDocument(source)
  const svg = doc.body.firstElementChild
  if (svg?.localName === 'svg') {
    svg.setAttribute('width', String(width))
    svg.setAttribute('height', String(height))
  }
  return {
    width: width * 0.75,
    height: height * 0.75,
    html: `<div style="width:${width}px;height:${height}px;transform:scale(.75);transform-origin:0 0;overflow:hidden">${fragment(doc)}</div>`,
  }
}
const colors = {
  paper: '#fff',
  ink: '#111',
  nightPaper: '#111',
  nightInk: '#eee',
  nightLink: '#8af',
  sepiaPaper: '#f5edda',
  sepiaInk: '#342e24',
  hitBg: '#ffe66d',
  hitInk: '#111',
}
/** Reuse the desktop EPUB column pagination, then freeze each view as a native page. */
export async function paginateHtml(source: string, fixed = false): Promise<PrintPage[]> {
  const viewport = fixed
    ? (fixedViewport(source) ?? { width: 768, height: 1024 })
    : { width: 794, height: 1123 }
  if (![viewport.width, viewport.height].every((n) => Number.isFinite(n) && n > 0 && n <= 16000))
    throw new Error('Unsupported chapter viewport.')
  const doc = await printDocument(source)
  const frame = document.createElement('iframe')
  frame.sandbox.add('allow-same-origin')
  frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${viewport.width}px;height:${viewport.height}px;visibility:hidden`
  const meta = doc.createElement('meta')
  meta.httpEquiv = 'Content-Security-Policy'
  meta.content = CSP
  doc.head.prepend(meta)
  const loaded = new Promise<void>((resolve, reject) => {
    frame.onload = () => resolve()
    frame.onerror = () => reject(new Error('Print layout failed.'))
  })
  frame.srcdoc = '<!doctype html>' + doc.documentElement.outerHTML
  document.body.append(frame)
  try {
    await loaded
    const laid = frame.contentDocument!
    const win = frame.contentWindow!
    await laid.fonts.ready
    await Promise.all([...laid.images].map((img) => img.decode().catch(() => {})))
    const style = win.getComputedStyle(laid.body)
    const flow = {
      axis: /vertical/.test(style.writingMode) ? ('vertical' as const) : ('horizontal' as const),
      rtl: style.direction === 'rtl' || /-rl/.test(style.writingMode),
    }
    const geom = pageGeometry(viewport, flow.axis)
    const layout = laid.createElement('style')
    layout.textContent = fixed ? fixedPageCss(viewport) : previewCss(geom, PREVIEW_DEFAULTS, colors)
    laid.head.append(layout)
    // Force final column layout before measuring its extent.
    void laid.body.offsetWidth
    const count = fixed
      ? 1
      : pageCount(geom, {
          scrollWidth: Math.max(laid.body.scrollWidth, laid.documentElement.scrollWidth),
          scrollHeight: Math.max(laid.body.scrollHeight, laid.documentElement.scrollHeight),
        })
    if (count > 250) throw new Error('Export supports at most 250 pages.')
    const scale = fixed ? Math.min(794 / viewport.width, 1123 / viewport.height) * 0.75 : 0.75
    const content = fragment(laid)
    const pages = Array.from({ length: count }, (_, n): PrintPage => {
      const offset = viewOffset(geom, flow, n)
      return {
        width: 595.5,
        height: 842.25,
        html: `<div style="position:relative;width:595.5px;height:842.25px;overflow:hidden"><div style="width:${viewport.width}px;height:${viewport.height}px;transform:scale(${scale});transform-origin:0 0"><div style="transform:translate(${-offset.left}px,${-offset.top}px)">${content}</div></div></div>`,
      }
    })
    checkPages(pages)
    return pages
  } finally {
    frame.remove()
  }
}
export function printActions(
  host: EditorHost,
  pages: () => Promise<PrintPage[]>,
): { pdf(): Promise<void>; print(): Promise<void> } {
  return {
    pdf: async () => host.exportPages('exportPDF', await pages()),
    print: async () => host.exportPages('printPages', await pages()),
  }
}
