import type { Editor, JSONContent } from '@tiptap/core'
import { generateTocFieldXml, nextNoteId, readSections } from '@genoffice/docx-engine'
import { renumber, type NoteKind } from '../../docs/src/renderer/ai/note-ops'
import { collectHeadings } from '../../docs/src/renderer/editor/headings'
import { inlineEquationNodeJson, equationBlockJson } from '../../docs/src/renderer/editor/equation'
import {
  measureBlocks,
  assignSections,
  sectionGeoms,
  sliceWithLineSplit,
  pageAt,
} from '../../docs/src/renderer/pagination'
import { t } from '../../docs/src/renderer/i18n/locale'
import type { PmNode } from '../../docs/src/renderer/editor/convert'
import type { EditorOptions } from './rich-editor'
import { modal, commitButton } from './review-tools'

export function upsertNote(
  editor: Editor,
  options: EditorOptions,
  kind: NoteKind,
  text: string,
  id?: string,
): void {
  const key = kind === 'footnote' ? 'footnotes' : 'endnotes'
  const notes = options.model.options[key] ?? options.model.parsed[key]
  if (id)
    options.model.options[key] = notes.map((note) =>
      note.id === id ? { ...note, text, richParas: undefined } : note,
    )
  else {
    const nextId = nextNoteId(notes)
    editor
      .chain()
      .focus()
      .insertContent({ type: 'docNoteRef', attrs: { kind, id: nextId, num: notes.length + 1 } })
      .run()
    let inserted = false
    editor.state.doc.descendants((node) => {
      if (
        node.type.name === 'docNoteRef' &&
        node.attrs.kind === kind &&
        String(node.attrs.id) === nextId
      )
        inserted = true
    })
    if (!inserted) throw new Error('protectedBlock')
    options.model.options[key] = [...notes, { id: nextId, text }]
    const transaction = editor.state.tr
    renumber(transaction, kind)
    if (transaction.docChanged) editor.view.dispatch(transaction)
  }
  options.changed()
}

export function removeNote(
  editor: Editor,
  options: EditorOptions,
  kind: NoteKind,
  id: string,
): void {
  const key = kind === 'footnote' ? 'footnotes' : 'endnotes'
  const positions: Array<{ at: number; size: number }> = []
  editor.state.doc.descendants((node, at) => {
    if (node.type.name === 'docNoteRef' && node.attrs.kind === kind && String(node.attrs.id) === id)
      positions.push({ at, size: node.nodeSize })
  })
  const transaction = editor.state.tr
  for (const item of positions.reverse()) transaction.delete(item.at, item.at + item.size)
  renumber(transaction, kind)
  editor.view.dispatch(transaction)
  let remains = false
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'docNoteRef' && node.attrs.kind === kind && String(node.attrs.id) === id)
      remains = true
  })
  if (remains) throw new Error('protectedBlock')
  options.model.options[key] = (options.model.options[key] ?? options.model.parsed[key]).filter(
    (note) => note.id !== id,
  )
  options.changed()
}

function headingPages(editor: Editor, options: EditorOptions): number[] {
  const host = options.element
  const fit = host.classList.contains('fit-width')
  host.classList.remove('fit-width')
  try {
    const page = editor.view.dom
    const origin =
      page.getBoundingClientRect().top + parseFloat(getComputedStyle(page).paddingTop || '0')
    const { blocks, totalHeight } = measureBlocks(page, origin, 1)
    const sections = readSections(options.model.parsed).map((section, index) => ({
      ...section,
      settings: options.model.sectionChanges.get(index) ?? section.settings,
    }))
    assignSections(blocks, sections)
    const slices = sliceWithLineSplit(blocks, sectionGeoms(sections), totalHeight, 1)
    return collectHeadings(editor.state.doc, options.model.parsed.styles).map((heading) => {
      const dom = editor.view.nodeDOM(heading.pos) as HTMLElement | null
      return dom ? pageAt(slices, dom.getBoundingClientRect().top - origin + 0.5) : 1
    })
  } finally {
    host.classList.toggle('fit-width', fit)
  }
}

/** Generate TOC fields with the exact engine API and desktop field-node representation. */
export function insertOrUpdateToc(editor: Editor, options: EditorOptions, update: boolean): void {
  if (options.model.odt) throw new Error('protectedBlock')
  const headings = collectHeadings(editor.state.doc, options.model.parsed.styles)
  if (!headings.length) throw new Error('cannotSave')
  const pages = headingPages(editor, options)
  const entries = headings.map((heading, index) => ({
    level: heading.level,
    text: heading.text,
    pageNo: pages[index],
  }))
  const nodes: JSONContent[] = generateTocFieldXml(entries).map((xml, index) => ({
    type: 'docProtected',
    attrs: {
      docxIndex: null,
      blockType: 'passthrough',
      label: t('ribbonTocFieldLabel'),
      genXml: xml,
      fieldDisplay: {
        kind: 'tocLine',
        left: entries[index].text,
        right: String(entries[index].pageNo),
        level: entries[index].level,
      },
    },
  }))
  if (!update) {
    editor
      .chain()
      .focus()
      .insertContent(nodes as JSONContent[])
      .run()
    return
  }
  let from = -1,
    to = -1,
    depth = 0,
    finished = false,
    keepPageBreak = false
  const indexes: number[] = []
  editor.state.doc.forEach((node, position) => {
    if (finished) return
    const index = node.attrs.docxIndex
    const block =
      typeof index === 'number'
        ? options.model.parsed.blocks.find((block) => block.docxIndex === index)
        : undefined
    const xml = String(node.attrs.genXml ?? block?.originalXml ?? '')
    if (from === -1) {
      if (!/<w:instrText[^>]*>\s*TOC[\s\\]/.test(xml)) return
      from = position
    }
    if (block?.sdtShell || /<w:sectPr(?=[\s>])/.test(xml)) throw new Error('protectedBlock')
    if (typeof index === 'number') indexes.push(index)
    depth += (xml.match(/w:fldCharType=["']begin["']/g) ?? []).length
    depth -= (xml.match(/w:fldCharType=["']end["']/g) ?? []).length
    if (depth <= 0) {
      to = position + node.nodeSize
      finished = true
      keepPageBreak = /<w:br\s[^>]*w:type=["']page["']/.test(xml)
    }
  })
  if (from < 0 || !finished) throw new Error('cannotSave')
  if (keepPageBreak)
    nodes.push({
      type: 'docProtected',
      attrs: {
        docxIndex: null,
        blockType: 'passthrough',
        label: t('ribbonPageBreak'),
        genXml: '<w:p><w:r><w:br w:type="page"/></w:r></w:p>',
        fieldDisplay: { kind: 'pageBreak' },
      },
    })
  options.model.replaceProtectedBlocks(
    indexes,
    () =>
      editor
        .chain()
        .focus()
        .deleteRange({ from, to })
        .insertContentAt(from, nodes as JSONContent[])
        .run(),
    () => editor.getJSON() as PmNode,
  )
}

export function addReferenceTools(editor: Editor, options: EditorOptions): void {
  const button = (label: string, action: () => void, off = false) => {
    const element = document.createElement('button')
    element.type = 'button'
    element.textContent = label
    element.disabled = options.model.readOnly || off
    element.addEventListener('pointerdown', (event) => event.preventDefault())
    element.addEventListener('click', () => {
      try {
        action()
      } catch (error) {
        options.error(error)
      }
    })
    options.toolbar.append(element)
  }
  for (const kind of ['footnote', 'endnote'] as const)
    button(t(kind === 'footnote' ? 'ribbonFootnote' : 'ribbonEndnote'), () => {
      const box = modal(t(kind === 'footnote' ? 'ribbonFootnote' : 'ribbonEndnote'))
      const key = kind === 'footnote' ? 'footnotes' : 'endnotes'
      const notes = options.model.options[key] ?? options.model.parsed[key]
      for (const note of notes) {
        const item = document.createElement('article')
        item.className = 'ipad-comment'
        const label = document.createElement('strong')
        label.textContent = note.id
        item.append(label)
        const text = document.createElement('textarea')
        text.value = note.text
        item.append(text)
        const save = document.createElement('button')
        save.type = 'button'
        save.textContent = t('appSave')
        save.addEventListener('click', () => upsertNote(editor, options, kind, text.value, note.id))
        item.append(save)
        const remove = document.createElement('button')
        remove.type = 'button'
        remove.textContent = t(kind === 'footnote' ? 'appDeleteFootnote' : 'appDeleteEndnote')
        remove.addEventListener('click', () => {
          try {
            removeNote(editor, options, kind, note.id)
            item.remove()
          } catch (error) {
            options.error(error)
          }
        })
        item.append(remove)
        box.body.append(item)
      }
      const text = document.createElement('textarea')
      text.placeholder = t('appFootnotePlaceholder')
      text.setAttribute('aria-label', t('appFootnotePlaceholder'))
      box.body.append(text)
      commitButton(box.actions, () => {
        try {
          if (text.value.trim()) upsertNote(editor, options, kind, text.value)
          box.close()
        } catch (error) {
          options.error(error)
        }
      })
    })
  button(t('ribbonToc'), () => insertOrUpdateToc(editor, options, false), !!options.model.odt)
  button(t('ribbonTocUpdate'), () => insertOrUpdateToc(editor, options, true), !!options.model.odt)
  button(
    t('ribbonEquation'),
    () => {
      const box = modal(t('ribbonEquation'))
      const latex = document.createElement('textarea')
      latex.placeholder = 'x^2 + y^2 = z^2'
      latex.setAttribute('aria-label', 'LaTeX')
      box.body.append(latex)
      const inline = document.createElement('input')
      inline.type = 'checkbox'
      inline.checked = true
      const label = document.createElement('label')
      label.textContent = t('appInlineEquationToggle')
      label.append(inline)
      box.body.append(label)
      commitButton(box.actions, () => {
        try {
          const node = inline.checked
            ? inlineEquationNodeJson(latex.value)
            : equationBlockJson(latex.value)
          editor
            .chain()
            .focus()
            .insertContent(node as JSONContent)
            .run()
          box.close()
        } catch (error) {
          options.error(error)
        }
      })
    },
    !!options.model.odt,
  )
}
