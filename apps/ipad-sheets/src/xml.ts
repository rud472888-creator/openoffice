import { XMLValidator } from 'fast-xml-parser'

/** Source spans let us change a value without serializing unrelated XML. */
export interface XmlNode {
  name: string
  local: string
  attrs: Record<string, string>
  start: number
  openEnd: number
  closeStart: number
  end: number
  children: XmlNode[]
}

export const decodeXml = (text: string): string =>
  text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    if (entity[0] === '#') {
      const number =
        entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1))
      return String.fromCodePoint(number)
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[entity]
  })

export const escapeXml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\r/g, '&#13;')

export function parseXml(xml: string): XmlNode {
  if (xml.length > 12 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error('Unsupported or oversized XML part.')
  if (XMLValidator.validate(xml) !== true) throw new Error('The workbook contains damaged XML.')
  const root: XmlNode = {
    name: '',
    local: '',
    attrs: {},
    start: 0,
    openEnd: 0,
    closeStart: xml.length,
    end: xml.length,
    children: [],
  }
  const stack = [root]
  const tags =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(?:[^>"']|"[^"]*"|'[^']*')*>/g
  let count = 0
  for (const match of xml.matchAll(tags)) {
    const tag = match[0]
    if (tag.startsWith('<!') || tag.startsWith('<?')) continue
    if (tag.startsWith('</')) {
      const node = stack.pop()!
      node.closeStart = match.index!
      node.end = match.index! + tag.length
      continue
    }
    if (++count > 300000) throw new Error('The worksheet is too complex for this device.')
    const name = /^<([^\s/>]+)/.exec(tag)![1]
    const attrs: Record<string, string> = {}
    for (const attr of tag.matchAll(/([^\s=<>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
      attrs[attr[1]] = decodeXml(attr[2] ?? attr[3])
    const end = match.index! + tag.length
    const node: XmlNode = {
      name,
      local: name.split(':').pop()!,
      attrs,
      start: match.index!,
      openEnd: end,
      closeStart: end,
      end,
      children: [],
    }
    stack[stack.length - 1].children.push(node)
    if (!tag.endsWith('/>')) {
      if (stack.length >= 128) throw new Error('The XML part is nested too deeply.')
      stack.push(node)
    }
  }
  return root
}

export const child = (node: XmlNode, local: string): XmlNode | undefined =>
  node.children.find((n) => n.local === local)
export const children = (node: XmlNode, local: string): XmlNode[] =>
  node.children.filter((n) => n.local === local)
export const content = (xml: string, node?: XmlNode): string =>
  node ? decodeXml(xml.slice(node.openEnd, node.closeStart)) : ''
export const prefix = (node: XmlNode): string =>
  node.name.includes(':') ? `${node.name.split(':')[0]}:` : ''

export function insertChild(
  xml: string,
  node: XmlNode,
  value: string,
  at = node.closeStart,
): string {
  if (xml.slice(node.start, node.openEnd).endsWith('/>')) {
    return xml.slice(0, node.openEnd - 2) + '>' + value + `</${node.name}>` + xml.slice(node.end)
  }
  return xml.slice(0, at) + value + xml.slice(at)
}
