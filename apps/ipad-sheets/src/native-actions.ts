export interface NativeCompletion {
  completed: boolean
  error?: string
}
export interface HtmlPage {
  html: string
  width: number
  height: number
}

/** The desktop print builder already paginates; the native host prints each fixed-size page. */
export function nativePrintPages(html: string): HtmlPage[] {
  const document = new DOMParser().parseFromString(html, 'text/html')
  if (document.querySelector('script,iframe,frame,object,embed,base'))
    throw new Error('Unsupported active content in print output.')
  for (const node of document.querySelectorAll('*'))
    for (const attribute of [...node.attributes]) {
      if (attribute.name.toLowerCase().startsWith('on'))
        throw new Error('Unsupported event handler in print output.')
      if (
        ['src', 'href', 'xlink:href'].includes(attribute.name.toLowerCase()) &&
        !/^(data:|#|$)/i.test(attribute.value)
      )
        throw new Error('Print resources must be embedded in the document.')
    }
  const styles = [...document.querySelectorAll('style')].map((node) => node.outerHTML).join('')
  if (
    /@import/i.test(styles) ||
    [...styles.matchAll(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/gi)].some(
      (match) => !/^(data:|#)/i.test(match[1]),
    )
  )
    throw new Error('Print fonts and images must be embedded offline.')
  const pages = [...document.querySelectorAll<HTMLElement>('.page')].map((page) => {
    const width = parseFloat(page.style.width) * 72,
      height = parseFloat(page.style.height) * 72
    if (
      !page.style.width.endsWith('in') ||
      !page.style.height.endsWith('in') ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0 ||
      width > 4000 ||
      height > 4000
    )
      throw new Error('Unsupported print page dimensions.')
    return { html: styles + page.outerHTML, width, height }
  })
  if (!pages.length || pages.length > 250)
    throw new Error('Print output must contain between 1 and 250 pages.')
  return pages
}

export class NativeActions {
  private pending = new Map<
    string,
    { resolve: (completed: boolean) => void; reject: (error: unknown) => void }
  >()
  complete(id: string, result: NativeCompletion): void {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    if (result.error) pending.reject(new Error(result.error))
    else pending.resolve(result.completed)
  }
  request(type: string, payload: Record<string, unknown>): Promise<boolean> {
    const bridge = window.webkit?.messageHandlers?.everyOffice
    if (!bridge) return Promise.reject(new Error('This action requires the native iPad host.'))
    const requestId = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject })
      bridge.postMessage({ type, ...payload, requestId })
    })
  }
}
