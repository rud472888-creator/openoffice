import { createRoot } from 'react-dom/client'
import { PaginationPreview } from '../../docs/src/renderer/components/PaginationPreview'
import { LocaleProvider, t } from '../../docs/src/renderer/i18n/locale'
import {
  readSections,
  type Block,
  type NoteInfo,
  type SectionSettings,
} from '@genoffice/docx-engine'
import { hfFromPart } from '../../docs/src/renderer/doc-state'
import { resolveHf, editKey, type HfSectionState } from '../../docs/src/renderer/hf-sections'
import { paraPaginationMeta } from '../../docs/src/renderer/editor/para-flags'
import {
  tableRowFlags,
  pageAt,
  type BlockMetaOf,
  type BlockBox,
  type PageSlice,
  type PageNoteItem,
} from '../../docs/src/renderer/pagination'
import {
  cssFontFamily,
  estimateFootnoteHeight,
  resolveNoteStyle,
  noteLineHeightPx,
  noteRunStyle,
} from '../../docs/src/renderer/line-metrics'
import { snapshotHTMLPage } from './print-snapshot'
import type { EditorOptions } from './rich-editor'

const completions = new Map<string, (result: { completed: boolean; error?: string }) => void>()
export function completeNativeExport(
  id: string,
  result: { completed: boolean; error?: string },
): void {
  completions.get(id)?.(result)
  completions.delete(id)
}

const previews = new Map<HTMLElement, () => void>()
export function closePrintPreview(host: HTMLElement): void {
  previews.get(host)?.()
}

function noteItem(
  note: NoteInfo,
  index: number,
  section: SectionSettings,
  options: EditorOptions,
  kind: 'footnote' | 'endnote' = 'footnote',
): PageNoteItem {
  const parsed = options.model.parsed
  const no = parsed.noteNumbers?.[`${kind}:${note.id}`] ?? index + 1
  const style = {
    ...resolveNoteStyle(parsed, note.styleId, note.spacing),
    ...noteRunStyle(note.richParas),
  }
  return {
    id: note.id,
    no,
    text: note.text,
    ...(note.richParas ? { richParas: note.richParas } : {}),
    ...(note.noRefMark ? { noRefMark: true } : {}),
    height: estimateFootnoteHeight(
      note.text,
      (section.pageWidth - section.marginLeft - section.marginRight) / 15,
      section.docGrid,
      undefined,
      style,
      note.richParas,
    ),
    lineHeightPx: noteLineHeightPx(section.docGrid, style),
    fontSizePt: (style.sizeHalfPoints ?? 20) / 2,
    ...(style.fontFamily ? { fontFamily: cssFontFamily(style.fontFamily) } : {}),
  }
}

export async function showPrintPreview(
  options: EditorOptions,
  action?: 'exportPDF' | 'printPages',
): Promise<void> {
  await document.fonts.ready
  const host = options.element
  closePrintPreview(host)
  const wasFit = host.classList.contains('fit-width')
  host.classList.remove('fit-width')
  const rootElement = document.createElement('div')
  rootElement.className = 'ipad-print-root'
  document.body.append(rootElement)
  const root = createRoot(rootElement)
  let disposed = false
  const close = () => {
    if (disposed) return
    disposed = true
    observer?.disconnect()
    root.unmount()
    rootElement.remove()
    host.classList.toggle('fit-width', wasFit)
    previews.delete(host)
  }
  previews.set(host, close)
  const parsed = options.model.parsed
  const sections = readSections(parsed).map((section, index) => ({
    ...section,
    settings: options.model.sectionChanges.get(index) ?? section.settings,
  }))
  const section = sections[0].settings
  const hfState: HfSectionState = {
    sections,
    edits: {},
    links: {},
    parsed,
    docStrips: {
      header: options.model.options.header ?? {
        text: parsed.headerText ?? '',
        paras: parsed.headerParas ?? undefined,
      },
      footer: options.model.options.footer ?? {
        text: parsed.footerText ?? '',
        paras: parsed.footerParas ?? undefined,
      },
      variants: {
        headerFirst: options.model.options.headerFirst ?? hfFromPart(parsed.headerFirst),
        footerFirst: options.model.options.footerFirst ?? hfFromPart(parsed.footerFirst),
        headerEven: options.model.options.headerEven ?? hfFromPart(parsed.headerEven),
        footerEven: options.model.options.footerEven ?? hfFromPart(parsed.footerEven),
      },
    },
  }
  for (const edit of options.model.options.sectionHf ?? [])
    hfState.edits[editKey(edit.lastBlockIndex, edit.kind, edit.variant ?? 'default')] = edit.hf
  const lastEnd = sections.at(-1)!.lastBlockIndex
  for (const kind of ['header', 'footer'] as const) {
    if (options.model.options[kind])
      hfState.edits[editKey(lastEnd, kind, 'default')] = options.model.options[kind]!
  }
  const byIndex = new Map(
    parsed.blocks.filter((b) => b.docxIndex !== null).map((b) => [b.docxIndex!, b]),
  )
  const noteLists = {
    footnote: options.model.options.footnotes ?? parsed.footnotes,
    endnote: options.model.options.endnotes ?? parsed.endnotes,
  }
  const notesFor = (block: Block, sec: SectionSettings) => {
    const refs = new Set(
      (block.runs ?? [])
        .filter((run) => run.noteRef?.kind === 'footnote')
        .map((run) => run.noteRef!.id),
    )
    for (const note of block.table?.rows.flatMap((row) =>
      row.flatMap((cell) => (cell.richParas ?? []).flatMap((paragraph) => paragraph.runs)),
    ) ?? [])
      if (note.noteRef?.kind === 'footnote') refs.add(note.noteRef.id)
    return noteLists.footnote
      .filter((note) => refs.has(note.id))
      .map((note, index) => noteItem(note, index, sec, options))
  }
  const pageFootnotesOf = (blocks: BlockBox[], slices: PageSlice[]) => {
    const result: PageNoteItem[][] = slices.map(() => [])
    for (const block of blocks) {
      const source = block.docxIndex === undefined ? undefined : byIndex.get(block.docxIndex)
      if (!source) continue
      const sec = sections[block.section ?? 0]?.settings ?? section
      const at = pageAt(slices, block.top + 0.5) - 1
      result[at]?.push(...notesFor(source, sec))
    }
    return result
  }
  const send = (kind: 'exportPDF' | 'printPages') => {
    try {
      const elements = [...rootElement.querySelectorAll<HTMLElement>('.pv-page')]
      if (!elements.length || elements.length > 250) throw new Error('documentTooLarge')
      const pages = elements.map((page) => snapshotHTMLPage(page, parsed.embeddedFonts))
      if (
        pages.reduce((sum, page) => sum + new TextEncoder().encode(page.html).length, 0) >
        64 * 1024 * 1024
      )
        throw new Error('documentTooLarge')
      const requestId = crypto.randomUUID()
      completions.set(requestId, (result) => {
        if (result.error) options.error(new Error(result.error))
      })
      window.webkit?.messageHandlers?.everyOffice?.postMessage({
        type: kind,
        requestId,
        name: options.model.source.name.replace(/\.(?:docx?|odt)$/i, '.pdf'),
        pages,
      })
    } catch (error) {
      options.error(error)
    }
  }
  const blockMetaOf: BlockMetaOf = (index) => {
    const block = byIndex.get(index)
    if (!block) return undefined
    const sec = sections.find((section) => index <= section.lastBlockIndex)?.settings ?? section
    const notes = notesFor(block, sec)
    const flags =
      block.type === 'table'
        ? {
            tableRowFlags: tableRowFlags(block.originalXml ?? ''),
            modernTableHeaders: (parsed.compatibilityMode ?? 0) >= 15,
          }
        : paraPaginationMeta(
            block.format,
            block.styleId ? parsed.styles.get(block.styleId)?.display : undefined,
            parsed.docDefaults,
          )
    return {
      ...flags,
      ...(notes.length
        ? {
            footnoteExtraPx: notes.reduce((sum, n) => sum + n.height, 0),
            footnoteBands: notes.map((note) => ({ heightPx: note.height })),
          }
        : {}),
    }
  }
  root.render(
    <LocaleProvider initial={options.language}>
      <PaginationPreview
        section={section}
        canvasTop={parseFloat(getComputedStyle(host.querySelector('.ProseMirror')!).paddingTop)}
        sections={sections}
        mirrorMargins={parsed.mirrorMargins}
        hfParts={parsed.hfParts ?? {}}
        colFlow={null}
        colMode="none"
        hf={{
          header: hfState.docStrips!.header,
          footer: hfState.docStrips!.footer,
          ...hfState.docStrips!.variants,
          titlePg: sections[0].titlePg,
          evenOddHf: parsed.evenAndOddHeaders === true,
          images: {
            header: parsed.headerImages ?? undefined,
            footer: parsed.footerImages ?? undefined,
          },
        }}
        watermark={null}
        blockMetaOf={blockMetaOf}
        pageFootnotesOf={pageFootnotesOf}
        endnoteItems={noteLists.endnote.map((note, index) =>
          noteItem(note, index, sections.at(-1)!.settings, options, 'endnote'),
        )}
        resolveHf={(_sections, index, kind, variant) => resolveHf(hfState, index, kind, variant)}
        comments={options.model.options.comments ?? parsed.comments}
        onExportPdf={() => send('exportPDF')}
        onClose={close}
      />
    </LocaleProvider>,
  )
  const observer = new MutationObserver(() => {
    const pageCount = rootElement.querySelectorAll('.pv-page').length
    if (pageCount) options.model.previewPageCount = pageCount
    const toolbar = rootElement.querySelector('.pv-toolbar')
    if (toolbar && !toolbar.querySelector('[data-ipad-print]')) {
      const print = document.createElement('button')
      print.type = 'button'
      print.dataset.ipadPrint = 'true'
      print.textContent = t('appPrintTitle')
      print.addEventListener('click', () => send('printPages'))
      toolbar.append(print)
    }
    if (action && rootElement.querySelector('.pv-page')) {
      const next = action
      action = undefined
      requestAnimationFrame(() => send(next))
    }
  })
  observer.observe(rootElement, { childList: true, subtree: true })
}
