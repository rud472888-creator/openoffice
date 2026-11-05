import JSZip from 'jszip'
import { describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createXmindDocument, openXmind } from '@genoffice/xmind-engine'
import { DocumentSession } from '../../mindmap/src/renderer/document/session'
import { HtmlDocument, safeHtmlPreview } from '../src/html'
import { BrowserBook } from '../src/epub'
import { boundedArchive } from '../src/common'
import { buildParseMap } from '../../html/src/renderer/document/parse-map'

async function book(fixed = false): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  )
  zip.file(
    'book.opf',
    `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:test</dc:identifier><dc:title>Book</dc:title><dc:language>en</dc:language>${fixed ? '<meta property="rendition:layout">pre-paginated</meta>' : ''}<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata><manifest><item id="c" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c"/></spine></package>`,
  )
  zip.file(
    'chapter.xhtml',
    '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Book</title></head><body><p id="a">Hello <strong>world</strong>.</p><p id="b">Second.</p></body></html>',
  )
  zip.file('unknown.bin', new Uint8Array([0, 2, 255]))
  return zip.generateAsync({ type: 'uint8array' })
}

describe('iPad additional-format editors', () => {
  it('keeps unchanged HTML bytes and original BOM/CRLF after source editing', () => {
    const bytes = new TextEncoder().encode('\ufeff<!doctype html>\r\n<p>Hello</p>\r\n')
    const document = new HtmlDocument(bytes)
    expect(document.save()).toBe(bytes)
    document.setText(document.text.replace('Hello', '안녕 😀'))
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(document.save())).toBe(
      '\ufeff<!doctype html>\r\n<p>안녕 😀</p>\r\n',
    )
    document.undo()
    expect(document.save()).toBe(bytes)
    document.redo()
    expect(document.text).toContain('안녕')
  })
  it('renders author HTML without scripts, event handlers, external assets or native privileges', () => {
    vi.stubGlobal('DOMParser', new JSDOM().window.DOMParser)
    const source =
      '<script>window.webkit.messageHandlers.everyOffice.postMessage({type:"save"})</script><p onclick="alert(1)">Safe</p><iframe src="file:///etc/passwd"></iframe><img src="https://example.com/tracker"><style>body{color:red}</style>'
    const html = safeHtmlPreview(source, buildParseMap(source, 1))
    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect(doc.querySelector('script,iframe,[onclick]')).toBeNull()
    expect(doc.querySelector('img')?.getAttribute('src')).toBeNull()
    expect(doc.querySelector('meta[http-equiv]')?.getAttribute('content')).toContain(
      "script-src 'none'",
    )
    expect(doc.body.textContent).toContain('Safe')
  })
  it('rejects invalid Unicode before changing HTML history', () => {
    const document = new HtmlDocument(new TextEncoder().encode('<p>Safe</p>'))
    expect(() => document.setText('<p>bad\ufffe</p>')).toThrow()
    expect(document.text).toBe('<p>Safe</p>')
  })
  it('reuses XMind preservation/history and saves map edits without dropping opaque entries', async () => {
    const original = await (
      await createXmindDocument({ sheetTitle: 'Map', rootTitle: 'Root' })
    ).save()
    const zip = await JSZip.loadAsync(original)
    zip.file('opaque.bin', new Uint8Array([8, 9, 255]))
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const opened = await openXmind(bytes)
    expect(opened.status).toBe('ok')
    if (opened.status !== 'ok') return
    const session = new DocumentSession(opened.document, bytes)
    expect(await session.recoveryBytes()).toEqual(bytes)
    const key = session.tabs()[0]!.key
    const view = session.view(key)
    view.root.title = 'Changed'
    expect(session.apply(key, view, { step: true }).ok).toBe(true)
    const saved = await session.recoveryBytes()
    const archive = await JSZip.loadAsync(saved)
    expect(await archive.file('opaque.bin')!.async('uint8array')).toEqual(
      new Uint8Array([8, 9, 255]),
    )
    const reopened = await openXmind(saved)
    if (reopened.status !== 'ok') throw new Error('Save did not reopen')
    expect(reopened.document.sheets[0]!.rootTopic.title).toBe('Changed')
  })
  it('edits EPUB blocks through desktop core, preserves inline formatting and unrelated parts', async () => {
    const bytes = await book()
    const document = await BrowserBook.open(bytes)
    expect(await document.save()).toBe(bytes)
    const chapter = await document.readChapter(0)
    if (!chapter.ok || chapter.broken) throw new Error('Bad fixture')
    const result = await document.apply(0, [
      { op: 'replace', blockId: chapter.blocks[1]!.id, text: 'Changed & safe' },
    ])
    expect(result.ok).toBe(true)
    const saved = await document.save()
    const zip = await JSZip.loadAsync(saved)
    expect(await zip.file('unknown.bin')!.async('uint8array')).toEqual(new Uint8Array([0, 2, 255]))
    const source = await zip.file('chapter.xhtml')!.async('string')
    expect(source).toContain('<p id="a">Hello <strong>world</strong>.</p>')
    expect(source).toContain('Changed &amp; safe')
    expect((await BrowserBook.open(saved)).book.metadata.title).toBe('Book')
  })
  it('keeps EPUB save snapshots separate and supports desktop inverse edits', async () => {
    const document = await BrowserBook.open(await book())
    const chapter = await document.readChapter(0)
    if (!chapter.ok || chapter.broken) throw new Error('Bad fixture')
    const result = await document.apply(0, [
      { op: 'replace', blockId: chapter.blocks[1]!.id, text: 'First' },
    ])
    if (!result.ok) throw new Error(result.message)
    const pending = document.save()
    await document.apply(0, [{ op: 'replace', blockId: result.blocks[1]!.id, text: 'Second' }])
    expect(
      await (await JSZip.loadAsync(await pending)).file('chapter.xhtml')!.async('string'),
    ).toContain('First')
    const inverse = await document.replace(0, 2, [
      { start: 0, end: (await document.state(0)).map.source.length, text: result.source },
    ])
    expect(inverse.ok).toBe(true)
  })
  it('refuses fixed-layout EPUB edits and stale range versions', async () => {
    const fixed = await BrowserBook.open(await book(true))
    const chapter = await fixed.readChapter(0)
    if (!chapter.ok || chapter.broken) throw new Error('Bad fixture')
    expect(chapter.readOnly).toBe('fixed-layout-book')
    expect((await fixed.apply(0, [{ op: 'delete', blockId: chapter.blocks[0]!.id }])).ok).toBe(
      false,
    )
    const editable = await BrowserBook.open(await book())
    expect((await editable.replace(0, 100, [])).ok).toBe(false)
  })
  it('bounds compressed documents before inflation', async () => {
    const zip = new JSZip()
    zip.file('oversized.bin', 'x'.repeat(16 * 1024 * 1024 + 1))
    await expect(
      boundedArchive(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })),
    ).rejects.toThrow()
  })
})

it('sanitizes native print fragments and enforces physical/page output bounds', async () => {
  const { printDocument, checkPages, singleHtmlPage } = await import('../src/export')
  vi.stubGlobal('DOMParser', new JSDOM().window.DOMParser)
  const doc = await printDocument(
    '<!doctype html><meta charset="utf-8"><script>bad()</script><p onclick="bad()">Printable</p><img src="https://example.com/a"><svg><use href="#local"/></svg><style>p{background:url(https://example.com/track)}</style>',
  )
  expect(doc.querySelector('script,meta,[onclick]')).toBeNull()
  expect(doc.querySelector('img')?.hasAttribute('src')).toBe(false)
  expect(doc.querySelector('use')?.getAttribute('href')).toBe('#local')
  expect(doc.querySelector('style')?.textContent).not.toContain('example.com')
  const page = await singleHtmlPage('<p>Printable</p>', 800, 1000)
  expect(page.width).toBe(600)
  expect(page.height).toBe(750)
  expect('html' in page && page.html).not.toMatch(/<!doctype|<meta|<script/i)
  expect(() => checkPages([page])).not.toThrow()
  expect(() => checkPages([])).toThrow()
  expect(() => checkPages(Array(251).fill(page))).toThrow()
  expect(() => checkPages([{ ...page, width: Infinity }])).toThrow()
  expect(() =>
    checkPages([{ width: 600, height: 800, html: 'x'.repeat(20 * 1024 * 1024 + 1) }]),
  ).toThrow()
})

it('opens real desktop embedded SVG/PNG diagrams without treating ordinary pictures as editable', async () => {
  const { readFile } = await import('node:fs/promises')
  const { openDiagramFile } = await import('../src/diagram-file')
  vi.stubGlobal('DOMParser', new JSDOM().window.DOMParser)
  for (const extension of ['drawio', 'drawio.svg', 'drawio.png']) {
    const bytes = new Uint8Array(
      await readFile(
        new URL(`../../../packages/drawio-model/tests/fixtures/out.${extension}`, import.meta.url),
      ),
    )
    const opened = openDiagramFile(`Example.${extension}`, bytes)
    expect(opened.format).toBe(extension)
    expect(opened.xml).toContain('<mxfile')
  }
  expect(() =>
    openDiagramFile(
      'Empty.drawio.svg',
      new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    ),
  ).toThrow(/no draw.io/)
  expect(() => openDiagramFile('Plain.png', new Uint8Array([1, 2]))).toThrow(/only/)
})

it('rejects compressed diagram bombs before the full vendor editor loads', async () => {
  const { openDiagramFile } = await import('../src/diagram-file')
  const { deflateRawSync } = await import('node:zlib')
  vi.stubGlobal('DOMParser', new JSDOM().window.DOMParser)
  const compressed = deflateRawSync(Buffer.from('x'.repeat(16 * 1024 * 1024 + 1))).toString(
    'base64',
  )
  expect(() =>
    openDiagramFile(
      'Unsafe.drawio',
      new TextEncoder().encode(`<mxfile><diagram>${compressed}</diagram></mxfile>`),
    ),
  ).toThrow(/16 MB/)
})

it('validates native persisted EPUB state without changing the book', async () => {
  const { readingState } = await import('../src/reading-state')
  expect(
    readingState(
      {
        position: { spineIndex: 1, blockId: 'p1' },
        viewPrefs: { fontScale: 1.5, lineHeight: 2, dark: true },
      },
      2,
    ),
  ).toEqual({
    position: { spineIndex: 1, blockId: 'p1' },
    viewPrefs: { fontScale: 1.5, lineHeight: 2, dark: true },
  })
  expect(
    readingState(
      {
        position: { spineIndex: -1 },
        viewPrefs: { fontScale: Infinity, lineHeight: 99, dark: 'true' },
      },
      2,
    ),
  ).toEqual({ position: null, viewPrefs: { fontScale: 1, lineHeight: 1.5, dark: false } })
  expect(readingState(null, 0).position).toBeNull()
  expect(
    readingState({ position: { spineIndex: 0, blockId: 'x'.repeat(513) } }, 1).position?.blockId,
  ).toBeNull()
})

it('whole-book search indexes rendered reading text and excludes scripts and ruby annotations', async () => {
  const { searchBook, buildTextIndex, rangeOf } =
    await import('../../epub/src/renderer/reader/book-search')
  vi.stubGlobal('DOMParser', new JSDOM().window.DOMParser)
  const docs = [
    '<p>First needle</p><script>needle</script>',
    '<p>Second <strong>Needle</strong><ruby>字<rt>needle</rt></ruby></p>',
  ].map((text) => new DOMParser().parseFromString(text, 'text/html'))
  const result = await searchBook({
    query: 'needle',
    chapterCount: docs.length,
    chapterText: async (index) => buildTextIndex(docs[index]!.body).text,
  })
  expect(result.hits).toHaveLength(2)
  expect(result.hits.map((hit) => hit.spineIndex)).toEqual([0, 1])
  const hit = result.hits[1]!
  expect(rangeOf(docs[1]!, buildTextIndex(docs[1]!.body), hit.start, hit.length)?.toString()).toBe(
    'Needle',
  )
  expect(
    (
      await searchBook({
        query: 'needle',
        chapterCount: 2,
        chapterText: async () => 'needle needle',
        limit: 1,
      })
    ).truncated,
  ).toBe(true)
})
