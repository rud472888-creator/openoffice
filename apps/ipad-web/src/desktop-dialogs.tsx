import type { Editor } from '@tiptap/core'
import { createRoot } from 'react-dom/client'
import type { ReactNode } from 'react'
import { FontDialog } from '../../docs/src/renderer/components/FontDialog'
import { ParagraphDialog } from '../../docs/src/renderer/components/ParagraphDialog'
import { TablePropertiesDialog } from '../../docs/src/renderer/components/TablePropertiesDialog'
import { StyleDialog, formValuesOf } from '../../docs/src/renderer/components/StyleDialog'
import { LocaleProvider, t } from '../../docs/src/renderer/i18n/locale'
import { applyParagraphStyleId } from '../../docs/src/renderer/components/ribbon-tabs'
import {
  parseDocx,
  saveDocx,
  readSections,
  type SaveBlock,
  type StyleInfo,
  type StyleUpsert,
} from '@genoffice/docx-engine'
import { docStyleCss } from '../../docs/src/renderer/doc-style-css'
import type { EditorOptions } from './rich-editor'

export function mountDesktopDialog(
  editor: Editor,
  options: EditorOptions,
  render: (close: () => void) => ReactNode,
): void {
  const element = document.createElement('div')
  element.className = 'ipad-desktop-dialog-root'
  document.body.append(element)
  const root = createRoot(element)
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    root.unmount()
    element.remove()
    editor.off('destroy', close)
  }
  editor.on('destroy', close)
  root.render(<LocaleProvider initial={options.language}>{render(close)}</LocaleProvider>)
}

export async function queueStyleUpsert(
  up: StyleUpsert,
  editor: Editor,
  options: EditorOptions,
): Promise<void> {
  const pending = new Map(
    (options.model.options.styleUpserts ?? []).map((style) => [style.styleId, style]),
  )
  const previous = pending.get(up.styleId)
  pending.set(
    up.styleId,
    previous
      ? {
          ...previous,
          ...up,
          pPr: { ...previous.pPr, ...up.pPr },
          rPr: { ...previous.rPr, ...up.rPr },
        }
      : up,
  )
  const original: SaveBlock[] = options.model.parsed.blocks
    .filter((block) => !block.hidden && block.docxIndex !== null)
    .map((block) => ({ kind: 'original', docxIndex: block.docxIndex! }))
  const bytes = await saveDocx(options.model.parsed, original, {
    styleUpserts: [...pending.values()],
  })
  const preview = await parseDocx(bytes)
  if (editor.isDestroyed) return
  options.model.options.styleUpserts = [...pending.values()]
  editor.storage.listNumbering.styles = preview.styles
  const style = options.model.parsed.styles.get(up.styleId) ?? preview.styles.get(up.styleId)
  if (style) options.model.parsed.styles.set(up.styleId, preview.styles.get(up.styleId)!)
  let sheet = options.element.parentElement?.querySelector<HTMLStyleElement>(
    'style[data-ipad-pending-styles]',
  )
  if (!sheet) {
    sheet = document.createElement('style')
    sheet.dataset.ipadPendingStyles = 'true'
    options.element.before(sheet)
  }
  sheet.textContent = docStyleCss(preview)
  editor.once('destroy', () => sheet?.remove())
  if (up.type === 'character')
    editor.chain().focus().setMark('docTextStyle', { styleId: up.styleId }).run()
  else
    applyParagraphStyleId(editor, up.styleId, preview.styles.get(up.styleId)?.headingLevel ?? null)
  options.changed()
}

export function addDesktopDialogs(editor: Editor, options: EditorOptions): void {
  const button = (label: string, action: () => void, enabled = () => true) => {
    const element = document.createElement('button')
    element.type = 'button'
    element.textContent = label
    element.addEventListener('pointerdown', (event) => event.preventDefault())
    element.addEventListener('click', () => {
      try {
        action()
      } catch (error) {
        options.error(error)
      }
    })
    const refresh = () => {
      element.disabled = options.model.readOnly || !enabled()
    }
    editor.on('selectionUpdate', refresh)
    refresh()
    options.toolbar.append(element)
  }
  button(t('appFontDialogTitle'), () =>
    mountDesktopDialog(editor, options, (close) => <FontDialog editor={editor} onClose={close} />),
  )
  button(t('appParagraphMenu'), () =>
    mountDesktopDialog(editor, options, (close) => (
      <ParagraphDialog
        editor={editor}
        styles={options.model.parsed.styles}
        pageWidth={readSections(options.model.parsed)[0].settings.pageWidth}
        onClose={close}
      />
    )),
  )
  button(
    t('ribbonTableProperties'),
    () =>
      mountDesktopDialog(editor, options, (close) => {
        const section = readSections(options.model.parsed)[0].settings
        return (
          <TablePropertiesDialog
            editor={editor}
            sectionContentWidthPx={
              (section.pageWidth - section.marginLeft - section.marginRight) / 15
            }
            onClose={close}
          />
        )
      }),
    () => editor.isActive('docTable'),
  )
  for (const create of [false, true])
    button(t(create ? 'ribbonStyleNew' : 'ribbonStyleModify'), () => {
      const attrs = editor.getAttributes(
        editor.isActive('docHeading') ? 'docHeading' : 'docParagraph',
      )
      const target: StyleInfo | null = create
        ? null
        : (options.model.parsed.styles.get(String(attrs.styleId ?? 'Normal')) ?? null)
      const initial = formValuesOf(target ?? { styleId: '', name: '', type: 'paragraph' })
      mountDesktopDialog(editor, options, (close) => (
        <StyleDialog
          target={target}
          initial={initial}
          styles={options.model.parsed.styles}
          pending={Object.fromEntries(
            (options.model.options.styleUpserts ?? []).map((style) => [style.styleId, style]),
          )}
          onClose={close}
          onSubmit={(up) => {
            void queueStyleUpsert(up, editor, options).then(close).catch(options.error)
          }}
        />
      ))
    })
}
