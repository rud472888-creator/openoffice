import type { Editor } from '@tiptap/core'
import { CropDialog, CutoutDialog } from '../../docs/src/renderer/components/PictureDialogs'
import { t, type StringKey } from '../../docs/src/renderer/i18n/locale'
import { modal, field, commitButton } from './review-tools'
import { mountDesktopDialog } from './desktop-dialogs'
import type { EditorOptions } from './rich-editor'

export function replacePicture(editor: Editor, dataUrl: string): void {
  const attrs = editor.getAttributes('docProtected')
  if (attrs.blockType !== 'image') throw new Error('protectedBlock')
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!match || match[2].length > 12 * 1024 * 1024) throw new Error('documentTooLarge')
  editor
    .chain()
    .focus()
    .updateAttributes('docProtected', {
      imageDataUrl: dataUrl,
      imageCrop: { l: 0, t: 0, r: 0, b: 0 },
      imageFillRect: null,
      ...(attrs.genImage
        ? { genImage: { ...attrs.genImage, base64: match[2], mime: match[1] } }
        : { imageReplace: { base64: match[2], mime: match[1] } }),
    })
    .run()
}

export function addPictureTools(editor: Editor, options: EditorOptions): void {
  function button(key: StringKey, action: () => void): void {
    const control = document.createElement('button')
    control.type = 'button'
    control.textContent = t(key)
    control.addEventListener('pointerdown', (event) => event.preventDefault())
    control.addEventListener('click', () => {
      try {
        action()
      } catch (error) {
        options.error(error)
      }
    })
    const refresh = () => {
      const attrs = editor.getAttributes('docProtected')
      control.disabled =
        options.model.readOnly ||
        attrs.blockType !== 'image' ||
        (typeof attrs.docxIndex === 'number' && options.model.lockedIndexes.has(attrs.docxIndex))
    }
    editor.on('selectionUpdate', refresh).on('transaction', refresh)
    refresh()
    options.toolbar.append(control)
  }
  button('ribbonTabPictureFormat', () => {
    const box = modal(t('ribbonTabPictureFormat'))
    const attrs = editor.getAttributes('docProtected')
    const width = field(
      box.body,
      `${t('ribbonPicWidth')} (mm)`,
      String(Math.round(((Number(attrs.imageWidthPx) * 25.4) / 96) * 10) / 10),
      'number',
    )
    const height = field(
      box.body,
      `${t('ribbonPicHeight')} (mm)`,
      String(Math.round(((Number(attrs.imageHeightPx) * 25.4) / 96) * 10) / 10),
      'number',
    )
    const wrap = document.createElement('select')
    wrap.setAttribute('aria-label', t('appWrapTextMenu'))
    for (const [value, key] of [
      ['', 'appWrapInline'],
      ['square-left', 'appWrapSquareLeft'],
      ['square-right', 'appWrapSquareRight'],
      ['topBottom', 'appWrapTopBottom'],
      ['behind', 'appWrapBehind'],
      ['front', 'appWrapFront'],
    ] as const) {
      const option = document.createElement('option')
      option.value = value
      option.textContent = t(key)
      wrap.append(option)
    }
    wrap.value = String(attrs.imageWrap ?? '')
    box.body.append(wrap)
    commitButton(box.actions, () => {
      const w = (Number(width.value) * 96) / 25.4,
        h = (Number(height.value) * 96) / 25.4
      if (
        !Number.isFinite(w) ||
        !Number.isFinite(h) ||
        w <= 0 ||
        h <= 0 ||
        w > 10000 ||
        h > 10000
      ) {
        options.error(new Error('cannotSave'))
        return
      }
      editor
        .chain()
        .focus()
        .updateAttributes('docProtected', {
          imageWidthPx: w,
          imageHeightPx: h,
          imageWrap: wrap.value || null,
        })
        .run()
      box.close()
    })
  })
  button('ribbonRotateRight', () =>
    editor
      .chain()
      .focus()
      .updateAttributes('docProtected', {
        imageRotDeg: (Number(editor.getAttributes('docProtected').imageRotDeg ?? 0) + 90) % 360,
      })
      .run(),
  )
  button('ribbonFlipH', () =>
    editor
      .chain()
      .focus()
      .updateAttributes('docProtected', {
        imageFlipH: !editor.getAttributes('docProtected').imageFlipH,
      })
      .run(),
  )
  button('ribbonFlipV', () =>
    editor
      .chain()
      .focus()
      .updateAttributes('docProtected', {
        imageFlipV: !editor.getAttributes('docProtected').imageFlipV,
      })
      .run(),
  )
  for (const cutout of [false, true])
    button(cutout ? 'ribbonRemoveBg' : 'ribbonCrop', () => {
      const dataUrl = String(editor.getAttributes('docProtected').imageDataUrl ?? '')
      if (!/^data:image\//.test(dataUrl)) throw new Error('protectedBlock')
      mountDesktopDialog(editor, options, (close) =>
        cutout ? (
          <CutoutDialog
            dataUrl={dataUrl}
            onCancel={close}
            onApply={(next) => {
              replacePicture(editor, next)
              close()
            }}
          />
        ) : (
          <CropDialog
            dataUrl={dataUrl}
            onCancel={close}
            onApply={(next) => {
              replacePicture(editor, next)
              close()
            }}
          />
        ),
      )
    })
}
