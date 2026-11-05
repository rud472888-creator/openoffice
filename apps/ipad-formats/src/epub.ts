import { readingState } from './reading-state'
import { label, bookLabel } from './labels'
import { buildTextIndex, rangeOf, searchBook } from '../../epub/src/renderer/reader/book-search'
import { applyViewCss, showHit, topBlockId } from '../../epub/src/renderer/reader/frame-dom'
import {
  frameColors,
  viewPrefsCss,
  stepFontScale,
  LINE_HEIGHTS,
} from '../../epub/src/renderer/reader/view-prefs'
import { paginateHtml, printActions, type PrintPage } from './export'
import {
  openEpub,
  openChapter,
  applyBlockEdits,
  applyReplacements,
  composeReplacements,
  remapChapter,
  saveEpub,
  resolveHref,
  validateReplacements,
  type EpubBook,
  type ChapterMap,
  type OpenChapter,
  type RangeReplacement,
  type BlockEdit,
} from '@genoffice/epub-engine/core'
import { EpubEditController } from '../../epub/src/renderer/edit/controller'
import { buildChapterHtml } from '../../epub/src/renderer/reader/chapter-html'
import type { EpubChapterResult, EpubEditResult } from '../../epub/src/shared/ipc'
import {
  assertText,
  boundedArchive,
  button,
  element,
  LIMITS,
  type EditorHost,
  type EditorView,
} from './common'

interface ChapterState {
  path: string
  stored: string
  map: ChapterMap
  version: number
  replacements: RangeReplacement[]
  seen: Set<string>
  readOnly: boolean
}
const failed = (message: string): EpubEditResult => ({ ok: false, error: 'refused', message })
const blocksOf = (map: OpenChapter) =>
  map.blocks.map(({ id, tag, kind, flowing, outer, inner }) => ({
    id,
    tag,
    kind,
    flowing,
    outer,
    inner,
  }))

/** Browser counterpart of the desktop book session, using the identical core edits. */
export class BrowserBook {
  private chapters = new Map<string, ChapterState>()
  private constructor(
    readonly original: Uint8Array,
    readonly book: EpubBook,
  ) {}
  static async open(bytes: Uint8Array): Promise<BrowserBook> {
    await boundedArchive(bytes)
    const opened = await openEpub(bytes, { limits: LIMITS })
    if (!opened.ok) throw new Error(`Cannot open this EPUB: ${opened.reason}`)
    return new BrowserBook(bytes, opened.book)
  }
  async state(index: number): Promise<ChapterState> {
    const item = this.book.spine.items[index]
    if (!item) throw new Error('No such chapter.')
    let state = this.chapters.get(item.path)
    if (!state) {
      const source = await this.book.readText(item.path)
      if (!source) throw new Error('The chapter is missing.')
      const map = openChapter(source.text)
      state = {
        path: item.path,
        stored: source.text,
        map,
        version: 0,
        replacements: [],
        seen: new Set([source.text]),
        readOnly: this.book.fixedLayout || item.fixedLayout || !source.valid || map.broken,
      }
      this.chapters.set(item.path, state)
    }
    return state
  }
  async readChapter(index: number): Promise<EpubChapterResult> {
    const state = await this.state(index)
    const base = {
      ok: true as const,
      path: state.path,
      source: state.map.source,
      version: state.version,
      spineIndex: index,
    }
    if (state.map.broken)
      return { ...base, broken: true, error: state.map.error, readOnly: 'broken-chapter' }
    return {
      ...base,
      broken: false,
      blocks: blocksOf(state.map),
      readOnly: state.readOnly
        ? this.book.fixedLayout
          ? 'fixed-layout-book'
          : 'fixed-layout-chapter'
        : null,
    }
  }
  private commit(
    index: number,
    state: ChapterState,
    map: OpenChapter,
    replacements: RangeReplacement[],
    created: string[],
  ): EpubEditResult {
    assertText(map.source)
    const before = state.map.source
    const inverse: RangeReplacement[] = []
    let delta = 0
    for (const replacement of [...replacements].sort((a, b) => a.start - b.start)) {
      const start = replacement.start + delta
      inverse.push({
        start,
        end: start + replacement.text.length,
        text: before.slice(replacement.start, replacement.end),
      })
      delta += replacement.text.length - replacement.end + replacement.start
    }
    const composed = composeReplacements(state.stored, state.replacements, replacements)
    state.map = map
    state.replacements = composed
    if (before !== map.source) state.version++
    state.seen.add(map.source)
    if (state.seen.size > 300) state.seen.delete(state.seen.values().next().value!)
    return {
      ok: true,
      spineIndex: index,
      path: state.path,
      source: map.source,
      version: state.version,
      blocks: blocksOf(map),
      created,
      replacements,
      inverse,
      dirty: true,
    }
  }
  async apply(index: number, edits: BlockEdit[]): Promise<EpubEditResult> {
    const state = await this.state(index)
    if (state.readOnly || state.map.broken) return failed('This chapter is read-only.')
    const result = applyBlockEdits(state.map, edits)
    return result.ok
      ? this.commit(index, state, result.map, result.replacements, result.created)
      : failed(result.refusal.message)
  }
  async replace(
    index: number,
    version: number,
    replacements: RangeReplacement[],
  ): Promise<EpubEditResult> {
    const state = await this.state(index)
    if (state.readOnly || state.map.broken || state.version !== version)
      return failed('The chapter changed. Retry the edit.')
    const invalid = validateReplacements(replacements, state.map.source.length)
    if (invalid) return failed(invalid)
    const source = applyReplacements(state.map.source, replacements)
    const inside = replacements.every(
      (r) =>
        state.map.broken === false &&
        state.map.blocks.some((b) => r.start >= b.inner.start && r.end <= b.inner.end),
    )
    if (!inside && !state.seen.has(source)) return failed('The edit reaches outside editable text.')
    const map = remapChapter(state.map, source, replacements)
    return map.broken ? failed(map.error) : this.commit(index, state, map, replacements, [])
  }
  async save(): Promise<Uint8Array> {
    const edits = new Map(
      [...this.chapters.values()].map((state) => [
        state.path,
        state.replacements.map((r) => ({ ...r })),
      ]),
    )
    const result = await saveEpub(this.book, edits, { limits: LIMITS })
    if (!result.ok) throw new Error(result.detail)
    const bytes = result.changed ? result.bytes : this.original
    await boundedArchive(bytes)
    return bytes
  }
}

const CSP =
  "default-src 'none';script-src 'none';style-src 'unsafe-inline' blob: data:;font-src blob: data:;img-src blob: data:;object-src 'none';frame-src 'none';connect-src 'none';base-uri 'none';form-action 'none'"

export async function epubView(bytes: Uint8Array, host: EditorHost): Promise<EditorView> {
  const model = await BrowserBook.open(bytes)
  const state = readingState(host.readingState, model.book.spine.items.length)
  const prefs = state.viewPrefs
  let position = state.position
  let index = position?.spineIndex ?? 0
  let frameReady = false
  let readingTimer: ReturnType<typeof setTimeout> | undefined
  let searching = 0
  let lastState = ''
  let disposed = false
  let loading = 0
  let draft = false
  const urls = new Set<string>()
  const assets = new Map<string, Promise<string>>()
  const toolbar = element('div')
  toolbar.className = 'toolbar'
  const chapters = element('select')
  chapters.setAttribute('aria-label', 'Chapters')
  for (const item of model.book.spine.items) {
    const title =
      model.book.toc.entries.find((entry) => entry.spineIndex === item.index)?.title ??
      `Chapter ${item.index + 1}`
    const option = element('option', title)
    option.value = String(item.index)
    chapters.append(option)
  }
  const frame = element('iframe')
  frame.title = model.book.metadata.title
  frame.setAttribute('sandbox', 'allow-same-origin')
  const notice = element(
    'p',
    model.book.fixedLayout
      ? 'Fixed-layout book · read-only'
      : 'Click the text to edit. Original book styles and illustrations are retained.',
  )
  notice.className = 'notice'
  const remember = () => {
    if (frameReady && frame.contentDocument)
      position = { spineIndex: index, blockId: topBlockId(frame.contentDocument) }
    const serialized = JSON.stringify({ position, viewPrefs: prefs })
    if (serialized !== lastState) {
      lastState = serialized
      host.updateReadingState({ position, viewPrefs: { ...prefs } })
    }
  }
  const updateView = () => {
    if (
      frame.contentDocument &&
      !model.book.fixedLayout &&
      !model.book.spine.items[index]?.fixedLayout
    )
      applyViewCss(frame.contentDocument, viewPrefsCss(prefs, frameColors()))
    remember()
  }
  const resolvedAssets = new Map<string, string>()
  const chapterHtml = (
    chapter: {
      source: string
      path: string
      blocks: readonly { id: string; tag: string; outer: { start: number } }[]
    },
    reading = true,
  ) => {
    // Rendering after each edit is synchronous; all referenced assets were resolved on chapter open.
    let html = buildChapterHtml({
      ...chapter,
      broken: false,
      baseUrl: `epub-asset://book/${chapter.path}`,
      viewCss:
        reading &&
        !model.book.fixedLayout &&
        !model.book.spine.items.some((item) => item.path === chapter.path && item.fixedLayout)
          ? viewPrefsCss(prefs, frameColors())
          : '',
    })
    html = html
      .replace(
        /<meta[^>]+http-equiv="Content-Security-Policy"[^>]*>/i,
        `<meta http-equiv="Content-Security-Policy" content="${CSP}">`,
      )
      .replace(/<base\b[^>]*>/gi, '')
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const localUrl = (value: string) => {
      if (value.startsWith('data:image/')) return value
      const target = resolveHref(chapter.path, value.replace(/^epub-asset:\/\/book\//, '/'))
      return target ? (resolvedAssets.get(target.path) ?? '') : ''
    }
    const cssUrls = (css: string) =>
      css
        .replace(/@import\s+[^;]+;/gi, '')
        .replace(
          /url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/gi,
          (_whole, value: string) => `url("${localUrl(value)}")`,
        )
    for (const node of doc.querySelectorAll('[src],link[rel="stylesheet"]')) {
      const attr = node.hasAttribute('src') ? 'src' : 'href'
      node.setAttribute(attr, localUrl(node.getAttribute(attr)!))
    }
    for (const node of doc.querySelectorAll('style'))
      node.textContent = cssUrls(node.textContent ?? '')
    for (const node of doc.querySelectorAll('[style]'))
      node.setAttribute('style', cssUrls(node.getAttribute('style')!))
    return '<!doctype html>' + doc.documentElement.outerHTML
  }
  const changed = () => {
    if (!disposed && controller.dirty) host.changed(draft)
  }
  const controller = new EpubEditController({
    api: {
      readChapter: (chapter) => model.readChapter(chapter),
      applyEdits: async (request) => {
        const result = await model.apply(request.spineIndex, request.edits)
        if (result.ok) {
          draft = false
          host.changed()
        }
        return result
      },
      replaceRanges: async (request) => {
        const result = await model.replace(
          request.spineIndex,
          request.version,
          request.replacements,
        )
        if (result.ok) {
          draft = false
          host.changed()
        }
        return result
      },
      setTranslationLock: async () => false,
      setDirty: (dirty) => {
        if (dirty) {
          draft = true
          host.changed(true)
        }
      },
    },
    chapterHtml,
    readingText: (chapter) =>
      new DOMParser().parseFromString(chapter.source, 'text/html').body.textContent ?? '',
    showChapter: (chapter, id) => {
      void show(chapter, id).catch(host.error)
    },
    notify: (notice) => host.error(new Error(notice.key)),
    changed,
  })
  controller.setBookReadOnly(model.book.fixedLayout)
  const asset = (
    path: string,
    depth = 0,
    ancestors: ReadonlySet<string> = new Set(),
  ): Promise<string> => {
    if (depth > 5 || ancestors.has(path)) return Promise.resolve('')
    const cached = assets.get(path)
    if (cached) return cached
    const visiting = new Set([...ancestors, path])
    const promise = (async () => {
      const bytes = await model.book.readForRendering(path)
      if (!bytes) return ''
      const type =
        model.book.manifest.find((entry) => entry.path === path)?.mediaType ??
        'application/octet-stream'
      let contents: Uint8Array | string = bytes
      if (type === 'text/css') {
        let css = new TextDecoder().decode(bytes).replace(/@import\s+[^;]+;/gi, '')
        const matches = [...css.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/gi)]
        for (const match of matches) {
          const target = resolveHref(path, match[1])
          css = css.replace(
            match[0],
            `url("${target ? await asset(target.path, depth + 1, visiting) : ''}")`,
          )
        }
        contents = css
      }
      const url = URL.createObjectURL(
        new Blob(
          [typeof contents === 'string' ? contents : (contents.slice().buffer as ArrayBuffer)],
          { type },
        ),
      )
      urls.add(url)
      resolvedAssets.set(path, url)
      return url
    })()
    assets.set(path, promise)
    return promise
  }
  async function prepareAssets(chapter: { source: string; path: string }): Promise<void> {
    const doc = new DOMParser().parseFromString(chapter.source, 'text/html')
    for (const node of doc.querySelectorAll('[src],link[rel="stylesheet"]')) {
      const attr = node.hasAttribute('src') ? 'src' : 'href'
      const value = node.getAttribute(attr)!
      const target = resolveHref(chapter.path, value)
      if (target) await asset(target.path)
    }
    for (const style of doc.querySelectorAll('style,[style]')) {
      const css =
        style.localName === 'style'
          ? (style.textContent ?? '')
          : (style.getAttribute('style') ?? '')
      for (const match of css.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/gi)) {
        const target = resolveHref(chapter.path, match[1])
        if (target) await asset(target.path)
      }
    }
  }
  async function show(
    next: number,
    blockId: string | null = null,
    hit?: { start: number; length: number },
  ): Promise<void> {
    remember()
    const request = ++loading
    await controller.flush()
    const chapter = await model.readChapter(next)
    if (!chapter.ok) throw new Error(chapter.message)
    await prepareAssets(chapter)
    if (disposed || request !== loading) return
    frameReady = false
    index = next
    chapters.value = String(index)
    const html = chapterHtml({ ...chapter, blocks: chapter.broken ? [] : chapter.blocks })
    frame.onload = () => {
      if (disposed || request !== loading || !frame.contentDocument) return
      controller.attach(frame.contentDocument, chapter)
      frameReady = true
      frame.contentDocument.addEventListener(
        'scroll',
        () => {
          clearTimeout(readingTimer)
          readingTimer = setTimeout(remember, 200)
        },
        true,
      )
      frame.contentDocument.addEventListener('click', (event) => {
        const anchor = (event.target as Element).closest?.('a[href]')
        if (!anchor) return
        event.preventDefault()
        const href = anchor.getAttribute('href')!
        const target = resolveHref(chapter.path, href.replace(/^epub-asset:\/\/book\//, '/'))
        const item = target && model.book.spine.items.find((entry) => entry.path === target.path)
        if (item) void show(item.index).catch(host.error)
      })
      if (blockId)
        for (const node of frame.contentDocument.querySelectorAll('[data-epub-block]'))
          if (node.getAttribute('data-epub-block') === blockId) node.scrollIntoView()
      if (hit) {
        const range = rangeOf(
          frame.contentDocument,
          buildTextIndex(frame.contentDocument.body),
          hit.start,
          hit.length,
        )
        if (range) showHit(frame.contentDocument, range)
      }
      remember()
    }
    frame.srcdoc = html
  }
  chapters.addEventListener('change', () => {
    void show(Number(chapters.value)).catch(host.error)
  })
  toolbar.append(
    chapters,
    button('Previous', () => show(Math.max(0, index - 1)), host),
    button('Next', () => show(Math.min(model.book.spine.items.length - 1, index + 1)), host),
    button('Bold', () => controller.toggleMark('bold'), host),
    button('Italic', () => controller.toggleMark('italic'), host),
    button('Undo', () => controller.undo(), host),
    button('Redo', () => controller.redo(), host),
  )
  const exports = printActions(host, async () => {
    if (controller.composing) throw new Error('Finish typing before exporting.')
    await controller.flush()
    const pages: PrintPage[] = []
    for (const item of model.book.spine.items) {
      if (disposed) throw new Error('The book is closed.')
      const chapter = await model.readChapter(item.index)
      if (!chapter.ok) throw new Error(chapter.message)
      await prepareAssets(chapter)
      pages.push(
        ...(await paginateHtml(
          chapterHtml({ ...chapter, blocks: chapter.broken ? [] : chapter.blocks }, false),
          model.book.fixedLayout || item.fixedLayout,
        )),
      )
      if (pages.length > 250) throw new Error('Export supports at most 250 pages.')
    }
    return pages
  })
  toolbar.append(button('Export PDF', exports.pdf, host), button('Print', exports.print, host))
  const font = element('output')
  font.setAttribute('aria-label', label('Text size', host.language))
  const setFont = (dir: 1 | -1) => {
    prefs.fontScale = stepFontScale(prefs.fontScale, dir)
    font.textContent = `${Math.round(prefs.fontScale * 100)}%`
    updateView()
  }
  font.textContent = `${Math.round(prefs.fontScale * 100)}%`
  const spacing = element('select')
  spacing.setAttribute('aria-label', label('Line spacing', host.language))
  for (const value of LINE_HEIGHTS) {
    const option = element(
      'option',
      value === null ? label("Book's own", host.language) : String(value),
    )
    option.value = String(value)
    option.selected = value === prefs.lineHeight
    spacing.append(option)
  }
  spacing.addEventListener('change', () => {
    prefs.lineHeight = spacing.value === 'null' ? null : Number(spacing.value)
    updateView()
  })
  const dark = button(
    'Dark view',
    () => {
      prefs.dark = !prefs.dark
      dark.setAttribute('aria-pressed', String(prefs.dark))
      updateView()
    },
    host,
  )
  dark.setAttribute('aria-pressed', String(prefs.dark))
  toolbar.append(
    button('Smaller text', () => setFont(-1), host),
    font,
    button('Larger text', () => setFont(1), host),
    spacing,
    dark,
  )
  const findbar = element('div')
  findbar.className = 'toolbar search-bar'
  const query = element('input')
  query.type = 'search'
  query.maxLength = 2048
  query.placeholder = label('Text to find in the book', host.language)
  query.setAttribute('aria-label', label('Find in book', host.language))
  const replacement = element('input')
  replacement.maxLength = 65536
  replacement.placeholder = label('Replace with', host.language)
  replacement.setAttribute('aria-label', label('Replace with', host.language))
  const results = element('div')
  results.className = 'book-search-results'
  results.setAttribute('aria-live', 'polite')
  const status = element('p')
  status.className = 'notice'
  const runSearch = async () => {
    const token = ++searching
    await controller.flush()
    const found = await searchBook({
      query: query.value,
      chapterCount: model.book.spine.items.length,
      isCancelled: () => disposed || token !== searching,
      chapterText: async (chapter) => {
        try {
          const read = await model.readChapter(chapter)
          return read.ok
            ? buildTextIndex(
                new DOMParser().parseFromString(
                  chapterHtml({ ...read, blocks: read.broken ? [] : read.blocks }),
                  'text/html',
                ).body,
              ).text
            : null
        } catch {
          return null
        }
      },
    })
    if (disposed || token !== searching) return
    results.replaceChildren()
    status.textContent = found.hits.length
      ? bookLabel(found.truncated ? 'findTruncated' : 'findCount', host.language, {
          count: found.hits.length,
        })
      : label('No matches', host.language)
    for (const hit of found.hits) {
      const title = chapters.options[hit.spineIndex]?.textContent ?? String(hit.spineIndex + 1)
      results.append(
        button(
          `${title}: ${hit.before}【${hit.match}】${hit.after}`,
          () => show(hit.spineIndex, null, hit),
          host,
        ),
      )
    }
    if (found.unreadable.length)
      status.textContent +=
        ' · ' + bookLabel('findUnreadable', host.language, { count: found.unreadable.length })
  }
  query.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void runSearch().catch(host.error)
    }
  })
  findbar.append(
    query,
    button('Find', runSearch, host),
    replacement,
    button(
      'Replace all',
      async () => {
        assertText(replacement.value)
        const outcome = await controller.replaceAll(
          query.value,
          replacement.value,
          model.book.spine.items.length,
        )
        if (!outcome) return
        await runSearch()
        status.textContent = [
          bookLabel('editReplaceDone', host.language, { count: outcome.replaced }),
          bookLabel('editReplaceSkipped', host.language, { count: outcome.skipped }),
          bookLabel('editReplaceFailed', host.language, { count: outcome.failed }),
        ].join(' · ')
      },
      host,
    ),
  )
  host.root.append(toolbar, findbar, status, results, notice, frame)
  await show(index, position?.blockId ?? null)
  return {
    save: async () => {
      if (controller.composing) throw new Error('Finish typing before saving.')
      await controller.flush()
      return model.save()
    },
    dispose: () => {
      remember()
      clearTimeout(readingTimer)
      searching++
      disposed = true
      loading++
      controller.detach()
      for (const url of urls) URL.revokeObjectURL(url)
      host.root.replaceChildren()
    },
  }
}
