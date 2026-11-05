import { Editor, Extension, type JSONContent } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import {
  addRowAfter,
  addColumnAfter,
  deleteRow,
  deleteColumn,
  mergeCells,
  splitCell,
} from '@tiptap/pm/tables'
import { editorExtensions } from '../../docs/src/renderer/editor/extensions'
import { tableModelToPmNode, type PmNode } from '../../docs/src/renderer/editor/convert'
import { docStyleCss } from '../../docs/src/renderer/doc-style-css'
import { insertPictureAtSelection } from '../../docs/src/renderer/editor/insert-picture'
import { setModuleLang, t, type StringKey } from '../../docs/src/renderer/i18n/locale'
import { readSections, BLANK_BULLET_NUM_ID, BLANK_ORDERED_NUM_ID } from '@genoffice/docx-engine'
import { RichWordDocument } from './rich-document'
import { encodeBase64 } from './document'
import { stringsFor } from './strings'
import { insertPageBreak } from '../../docs/src/renderer/editor/page-break'
import type { Lang } from '@genoffice/i18n'
import { beginOdtSession, endOdtSession } from '../../docs/src/renderer/odt-gate'
import { showPrintPreview, closePrintPreview } from './print-preview'
import { addReviewTools } from './review-tools'

export interface EditorOptions {
  element: HTMLElement
  toolbar: HTMLElement
  language: Lang
  model: RichWordDocument
  changed(): void
  error(error: unknown): void
}

export function mountRichEditor(options: EditorOptions): Editor {
  const { model } = options
  setModuleLang(options.language)
  beginOdtSession(model.odt, model.parsed)
  const guard = Extension.create({
    name: 'ipadPreservationGuard',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            decorations(state) {
              const decorations: Decoration[] = []
              state.doc.forEach((node, position) => {
                if (
                  model.lockedIndexes.has(Number(node.attrs.docxIndex)) &&
                  node.attrs.docxIndex != null
                )
                  decorations.push(
                    Decoration.node(position, position + node.nodeSize, {
                      contenteditable: 'false',
                      'aria-readonly': 'true',
                      class: 'ipad-preserved-block',
                      title: stringsFor(options.language).text.protectedBlock,
                    }),
                  )
              })
              return DecorationSet.create(state.doc, decorations)
            },
          },
          filterTransaction(transaction) {
            if (!transaction.docChanged) return true
            const allowed = !model.readOnly && model.canEdit(transaction.doc.toJSON() as PmNode)
            if (!allowed)
              queueMicrotask(() =>
                options.error(new Error(model.readOnly ? 'readOnly' : 'protectedBlock')),
              )
            return allowed
          },
        }),
      ]
    },
  })
  const editor = new Editor({
    element: options.element,
    extensions: [...editorExtensions, guard],
    content: model.initialContent as JSONContent,
    editable: !model.readOnly,
    enableContentCheck: true,
    editorProps: {
      attributes: {
        class: 'doc-page ipad-rich-page',
        spellcheck: 'true',
        role: 'textbox',
        'aria-multiline': 'true',
        'data-testid': 'document-editor',
        'aria-label': model.source.name,
      },
      // Offline paste accepts plain text; external HTML cannot inject remote assets or schema controls.
      handlePaste(view, event) {
        const text = event.clipboardData?.getData('text/plain')
        if (text === undefined) return false
        event.preventDefault()
        const paragraphs = text
          .replace(/\r\n?/g, '\n')
          .split('\n')
          .map((line) => ({
            type: 'docParagraph',
            ...(line ? { content: [{ type: 'text', text: line }] } : {}),
          }))
        editor.commands.insertContent(paragraphs)
        return true
      },
      handleDOMEvents: {
        click: (_view, event) => {
          if ((event.target as HTMLElement)?.closest('a')) {
            event.preventDefault()
            return true
          }
          return false
        },
      },
    },
    onUpdate() {
      model.previewPageCount = undefined
      options.changed()
    },
  })
  model.setBaseline(editor.getJSON() as PmNode)
  const parsed = model.parsed
  Object.assign(editor.storage.listNumbering, {
    defs: parsed.numbering,
    styles: parsed.styles,
    docDefaults: parsed.docDefaults,
    defaultTabTwips: parsed.defaultTabStopTwips ?? 720,
    indentNotTabStop: parsed.indentNotNumberingTabStop === true,
  })
  editor.storage.tabStops.defaultTabStopTwips = parsed.defaultTabStopTwips ?? null
  editor.storage.justifyShrink.enabled = (parsed.compatibilityMode ?? 0) >= 15
  editor.storage.cjkPunctShrink.enabled = parsed.compressPunctuation === true
  editor.storage.cjkPunctShrink.hangPunct = parsed.compressPunctuation !== true
  editor.storage.cjkPunctShrink.legacyLayout = (parsed.compatibilityMode ?? 0) < 15
  editor.storage.cjkPunctShrink.docEastAsiaLang = parsed.docDefaults?.eastAsiaLang ?? null
  const style = document.createElement('style')
  style.textContent = docStyleCss(parsed)
  options.element.before(style)
  editor.on('destroy', () => {
    style.remove()
    closePrintPreview(options.element)
    endOdtSession()
  })
  const section = readSections(parsed)[0]?.settings
  if (section) {
    const page = editor.view.dom
    page.style.setProperty('--page-w', `${section.pageWidth / 15}px`)
    page.style.setProperty('--page-h', `${section.pageHeight / 15}px`)
    page.style.setProperty(
      '--page-pad',
      `${section.marginTop / 15}px ${section.marginRight / 15}px ${section.marginBottom / 15}px ${section.marginLeft / 15}px`,
    )
  }
  editor.storage.trackChanges.enabled = parsed.trackRevisions === true
  buildToolbar(editor, options)
  addReviewTools(editor, options)
  for (const [key, action] of [
    ['ribbonPagePreview', undefined],
    ['appExportPdf', 'exportPDF'],
    ['appPrintTitle', 'printPages'],
  ] as const) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = t(key)
    button.addEventListener('click', () => {
      void showPrintPreview(options, action).catch(options.error)
    })
    options.toolbar.append(button)
  }
  return editor
}

function buildToolbar(editor: Editor, options: EditorOptions): void {
  const toolbar = options.toolbar
  toolbar.replaceChildren()
  toolbar.setAttribute('role', 'toolbar')
  toolbar.setAttribute('aria-label', t('ribbonTabHome'))
  function button(
    key: StringKey,
    action: () => void,
    short?: string,
    active?: () => boolean,
  ): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.title = t(key)
    button.setAttribute('aria-label', t(key))
    button.textContent = short ?? t(key)
    button.disabled = options.model.readOnly
    button.addEventListener('pointerdown', (event) => event.preventDefault())
    button.addEventListener('click', () => {
      action()
      update()
    })
    toolbar.append(button)
    const update = () => {
      if (active) button.setAttribute('aria-pressed', String(active()))
    }
    if (active) editor.on('selectionUpdate', update).on('transaction', update)
    update()
    return button
  }
  button('appUndo', () => editor.chain().focus().undo().run(), '↶')
  button('appRedo', () => editor.chain().focus().redo().run(), '↷')
  for (const [mark, key, label] of [
    ['bold', 'ribbonBoldTip', 'B'],
    ['italic', 'ribbonItalicTip', 'I'],
    ['underline', 'ribbonUnderlineTip', 'U'],
    ['strike', 'ribbonStrikethrough', 'S'],
  ] as const) {
    button(
      key,
      () => editor.chain().focus().toggleMark(mark).run(),
      label,
      () => editor.isActive(mark),
    )
  }
  const style = document.createElement('select')
  style.setAttribute('aria-label', t('appStylesTitle'))
  for (const [name, label] of [
    ['docParagraph', t('ribbonStyleNormal')],
    ['docHeading:1', 'H1'],
    ['docHeading:2', 'H2'],
    ['docHeading:3', 'H3'],
  ]) {
    const option = document.createElement('option')
    option.value = name
    option.textContent = label
    style.append(option)
  }
  style.disabled = options.model.readOnly
  style.addEventListener('change', () => {
    const [type, level] = style.value.split(':')
    editor
      .chain()
      .focus()
      .setNode(
        type,
        type === 'docHeading'
          ? {
              level: Number(level),
              styleId: options.model.parsed.headingStyleIds.get(Number(level)) ?? null,
            }
          : { styleId: null },
      )
      .run()
  })
  toolbar.append(style)
  const family = document.createElement('select')
  family.setAttribute('aria-label', t('ribbonFontFamilyTip'))
  for (const name of ['Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Helvetica']) {
    const option = document.createElement('option')
    option.value = name
    option.textContent = name
    family.append(option)
  }
  family.disabled = options.model.readOnly
  family.addEventListener('change', () =>
    editor
      .chain()
      .focus()
      .setMark('docTextStyle', { font: family.value, fontAscii: family.value })
      .run(),
  )
  toolbar.append(family)
  const size = document.createElement('select')
  size.setAttribute('aria-label', t('ribbonFontSizeTip'))
  for (const value of [8, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72]) {
    const option = document.createElement('option')
    option.value = String(value)
    option.textContent = `${value}`
    size.append(option)
  }
  size.value = '11'
  size.disabled = options.model.readOnly
  size.addEventListener('change', () =>
    editor
      .chain()
      .focus()
      .setMark('docTextStyle', { sizeHalfPoints: Number(size.value) * 2 })
      .run(),
  )
  toolbar.append(size)
  const color = document.createElement('input')
  color.type = 'color'
  color.value = '#222222'
  color.setAttribute('aria-label', t('ribbonFontColor'))
  color.title = t('ribbonFontColor')
  color.disabled = options.model.readOnly
  color.addEventListener('input', () =>
    editor
      .chain()
      .focus()
      .setMark('docTextStyle', { color: color.value.slice(1) })
      .run(),
  )
  toolbar.append(color)
  for (const [align, key, symbol] of [
    ['left', 'ribbonAlignLeftTip', '≡←'],
    ['center', 'ribbonAlignCenterTip', '≡'],
    ['right', 'ribbonAlignRightTip', '→≡'],
    ['justify', 'ribbonJustifyTip', '☰'],
  ] as const) {
    button(
      key,
      () => {
        const type =
          ['docHeading', 'docListItem', 'docParagraph'].find((name) => editor.isActive(name)) ??
          'docParagraph'
        editor.chain().focus().updateAttributes(type, { align }).run()
      },
      symbol,
    )
  }
  for (const [kind, key, id] of [
    ['bullet', 'ribbonBullets', BLANK_BULLET_NUM_ID],
    ['ordered', 'ribbonNumbering', BLANK_ORDERED_NUM_ID],
  ] as const) {
    const available = options.model.parsed.numbering.has(id)
    const control = button(
      key,
      () => editor.chain().focus().setNode('docListItem', { kind, numId: id, ilvl: 0 }).run(),
      kind === 'bullet' ? '•' : '1.',
    )
    control.disabled ||= !available
  }
  button('ribbonClearFormatting', () => editor.chain().focus().unsetAllMarks().run(), 'A×')
  button('ribbonPageBreak', () => insertPageBreak(editor))
  const dimensions: HTMLInputElement[] = []
  for (const key of ['ribbonTableRowsLabel', 'ribbonTableColsLabel'] as const) {
    const input = document.createElement('input')
    input.type = 'number'
    input.min = '1'
    input.max = '20'
    input.value = '3'
    input.setAttribute('aria-label', t(key))
    input.title = t(key)
    input.disabled = options.model.readOnly
    dimensions.push(input)
    toolbar.append(input)
  }
  button('ribbonTable', () => {
    if (editor.isActive('docTable')) {
      options.error(new Error('protectedBlock'))
      return
    }
    const [rows, cols] = dimensions.map((input) =>
      Math.max(1, Math.min(20, Number(input.value) || 3)),
    )
    const line = { style: 'single', szEighths: 4, color: 'auto' }
    const table = tableModelToPmNode({
      rows: Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => ({ paras: [''] })),
      ),
      colWidthsPct: Array.from({ length: cols }, () => 100 / cols),
      widthPct: 100,
      autoFit: 'window',
      borders: { top: line, bottom: line, left: line, right: line, insideH: line, insideV: line },
    })
    editor
      .chain()
      .focus()
      .insertContent([table as JSONContent, { type: 'docParagraph' }])
      .run()
  })
  for (const [key, command] of [
    ['ribbonInsertBelow', addRowAfter],
    ['ribbonInsertRight', addColumnAfter],
    ['ribbonDeleteRow', deleteRow],
    ['ribbonDeleteColumn', deleteColumn],
    ['ribbonMergeCells', mergeCells],
    ['ribbonSplitCells', splitCell],
  ] as const) {
    const control = button(key, () => command(editor.state, editor.view.dispatch))
    const updateEnabled = () => {
      control.disabled = options.model.readOnly || !editor.isActive('docTable')
    }
    editor.on('selectionUpdate', updateEnabled).on('transaction', updateEnabled)
    updateEnabled()
  }
  const file = document.createElement('input')
  file.type = 'file'
  file.accept = 'image/png,image/jpeg,image/gif'
  file.hidden = true
  toolbar.append(file)
  file.addEventListener('change', async () => {
    const imageFile = file.files?.[0]
    if (!imageFile) return
    try {
      if (imageFile.size > 8 * 1024 * 1024) throw new Error('documentTooLarge')
      const base64 = encodeBase64(new Uint8Array(await imageFile.arrayBuffer()))
      const dataUrl = `data:${imageFile.type};base64,${base64}`
      const image = new Image()
      image.src = dataUrl
      await image.decode()
      if (
        !image.naturalWidth ||
        !image.naturalHeight ||
        image.naturalWidth * image.naturalHeight > 20_000_000
      )
        throw new Error('documentTooLarge')
      // Body picture insertion shares desktop's protected-image model; table inline images are not yet bridged.
      if (editor.isActive('docTable')) throw new Error('readOnly')
      const scale = Math.min(1, 600 / image.naturalWidth)
      insertPictureAtSelection(editor, {
        dataUrl,
        base64,
        mime: imageFile.type,
        label: imageFile.name,
        widthPx: Math.round(image.naturalWidth * scale),
        heightPx: Math.round(image.naturalHeight * scale),
      })
    } catch (error) {
      options.error(error)
    }
    file.value = ''
  })
  button('ribbonPicture', () => file.click())
  const view = button('ribbonPageWidth', () => options.element.classList.toggle('fit-width'))
  view.disabled = false
  const find = document.createElement('input')
  find.type = 'search'
  find.placeholder = t('appFindPlaceholder')
  find.setAttribute('aria-label', t('appFindPlaceholder'))
  toolbar.append(find)
  find.addEventListener('input', () => {
    const term = find.value
    if (!term) return
    let found = false
    editor.state.doc.descendants((node, position) => {
      if (found || !node.isText || !node.text) return !found
      const at = node.text.toLocaleLowerCase().indexOf(term.toLocaleLowerCase())
      if (at >= 0) {
        editor.commands.setTextSelection({ from: position + at, to: position + at + term.length })
        found = true
      }
      return !found
    })
  })
}
