import { encodeBase64 } from './document'

export interface PrintableHTMLPage {
  html: string
  width: number
  height: number
}
export interface PrintableFont {
  family: string
  data: Uint8Array
  bold?: boolean
  italic?: boolean
}

declare global {
  interface Window {
    __eoFontData?: Record<string, string>
  }
}

const VISUAL_PROPERTY =
  /^(?:display|position|inset|top|bottom|left|right|width|height|min-|max-|margin|padding|border|background|box-|color|font|line-|text-|letter-|word-|white-|vertical-|overflow|opacity|transform|translate|rotate|scale|float|clear|z-index|direction|unicode-bidi|writing-mode|grid|flex|gap|align-|justify-|place-|object-|visibility|fill|stroke|clip|break-|column|isolation|aspect-ratio)/
function copyStyle(source: Element, target: HTMLElement | SVGElement, pseudo?: string): void {
  const style = getComputedStyle(source, pseudo)
  for (const property of Array.from(style)) {
    if (!VISUAL_PROPERTY.test(property)) continue
    const value = style.getPropertyValue(property)
    if (value.includes('url(') && /url\(["']?(?:https?:|file:|\/\/)/i.test(value)) continue
    target.style.setProperty(property, value)
  }
}

function familyName(value: string): string {
  return value
    .trim()
    .replace(/^["']|["']$/g, '')
    .toLowerCase()
}

/** Capture an already paginated browser page for the native JavaScript-free renderer. */
export function snapshotHTMLPage(
  page: HTMLElement,
  extraFonts: readonly PrintableFont[] = [],
): PrintableHTMLPage {
  const computed = getComputedStyle(page)
  const width = parseFloat(computed.width)
  const height = parseFloat(computed.height)
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width * 0.75 > 4000 ||
    height * 0.75 > 4000
  )
    throw new Error('cannotSave')
  const clone = page.cloneNode(true) as HTMLElement
  const originals = [page, ...page.querySelectorAll('*')]
  const copies = [clone, ...clone.querySelectorAll('*')]
  const families = new Set<string>()
  originals.forEach((original, index) => {
    const copy = copies[index] as HTMLElement | SVGElement
    if (!copy?.style) return
    copyStyle(original, copy)
    getComputedStyle(original)
      .fontFamily.split(',')
      .forEach((name) => families.add(familyName(name)))
    for (const attribute of [...copy.attributes]) {
      const name = attribute.name.toLowerCase()
      if (
        name.startsWith('on') ||
        ['contenteditable', 'inert', 'autofocus', 'tabindex', 'srcset', 'formaction'].includes(name)
      )
        copy.removeAttribute(attribute.name)
      if (['src', 'href', 'xlink:href'].includes(name) && !/^(data:|#)/i.test(attribute.value))
        copy.removeAttribute(attribute.name)
    }
    for (const pseudo of ['::before', '::after']) {
      const content = getComputedStyle(original, pseudo).content
      if (!content || ['none', 'normal', '""', "''"].includes(content)) continue
      const marker = document.createElement('span')
      // Computed generated text is a CSS string; never interpret it as HTML.
      try {
        marker.textContent = JSON.parse(content)
      } catch {
        continue
      }
      copyStyle(original, marker, pseudo)
      if (pseudo === '::before') copy.prepend(marker)
      else copy.append(marker)
    }
  })
  clone
    .querySelectorAll('script,iframe,object,embed,meta,base,link,audio,video')
    .forEach((element) => element.remove())
  clone
    .querySelectorAll(
      '.img-resize-handle,.doc-image-anchor-marker,.doc-move-handle,.page-margin-annotations,.pv-pageno',
    )
    .forEach((element) => element.remove())
  clone.querySelectorAll<HTMLElement>('.page-hf-header,.page-hf-footer').forEach((element) => {
    element.style.borderColor = 'transparent'
  })
  clone.style.margin = '0'
  clone.style.transform = 'none'
  clone.style.boxShadow = 'none'
  clone.style.width = `${width}px`
  clone.style.height = `${height}px`
  const fontRules: string[] = []
  const loaded = [...document.fonts].filter((font) => font.status === 'loaded')
  for (const sheet of [...document.styleSheets]) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    for (const rule of [...rules]) {
      if (!(rule instanceof CSSFontFaceRule)) continue
      const name = familyName(rule.style.getPropertyValue('font-family'))
      if (
        !families.has(name) ||
        !loaded.some(
          (font) =>
            familyName(font.family) === name &&
            (font.style || 'normal') === (rule.style.fontStyle || 'normal') &&
            (font.weight === (rule.style.fontWeight || 'normal') ||
              (font.weight === '400' && rule.style.fontWeight === 'normal')),
        )
      )
        continue
      const css = rule.cssText.replace(/blob:[^\s"')]+/g, (url) => window.__eoFontData?.[url] ?? '')
      if (css.includes('url("")') || css.includes('url()')) continue
      fontRules.push(css)
    }
  }
  for (const font of extraFonts) {
    if (!families.has(familyName(font.family))) continue
    fontRules.push(
      `@font-face{font-family:${JSON.stringify(font.family)};src:url(data:font/ttf;base64,${encodeBase64(font.data)});font-weight:${font.bold ? '700' : '400'};font-style:${font.italic ? 'italic' : 'normal'}}`,
    )
  }
  // Native WKWebView uses CSS pixels as PDF points; convert the 96-dpi canvas
  // to 72-point paper explicitly so the right and bottom edges are not clipped.
  const result = {
    width: width * 0.75,
    height: height * 0.75,
    html: `<style>${fontRules.join('\n')}</style><div style="width:${width * 0.75}px;height:${height * 0.75}px;overflow:hidden"><div style="transform:scale(0.75);transform-origin:top left;width:${width}px;height:${height}px">${clone.outerHTML}</div></div>`,
  }
  if (new TextEncoder().encode(result.html).length > 20 * 1024 * 1024)
    throw new Error('documentTooLarge')
  return result
}
