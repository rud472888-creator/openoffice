import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { EditorContent, useEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { buildExtensions } from '../../markdown/src/renderer/editor/extensions'
import {
  PlainTextEditor,
  type PlainTextEditorHandle,
} from '../../markdown/src/renderer/source/PlainTextEditor'
import { LocaleProvider, useI18n, type StringKey } from '../../markdown/src/renderer/i18n/locale'
import { normalizeLang } from '@genoffice/i18n'
import { readSourceText } from '../../markdown/src/shared/source-text'
import { tiptapFindTarget } from '../../markdown/src/renderer/editor/findTarget'
import { ToastHost } from '../../markdown/src/renderer/components/toast'
import { NoteDocument } from './document'
import { insertFootnote } from '../../markdown/src/renderer/editor/footnote'
import { openMathCreate } from '../../markdown/src/renderer/editor/mathEdit'
import { buildPrintHtml } from '../../markdown/src/renderer/export/printHtml'
import { diagramSvgToPng, renderDiagram } from '../../markdown/src/renderer/editor/diagrams'
import { exportDocxBytes } from '../../markdown/src/renderer/export/docxExport'
import { decodeImageDataUrl, toDocxImage } from '../../markdown/src/renderer/export/exportImage'
import { frontmatterInner, buildFrontmatterRaw } from '../../markdown/src/renderer/markdown/docText'
import './style.css'

type Payload = { name: string; kind: string; base64: string; language?: string; locale?: string }
type HostMessage = { type: string; [key: string]: unknown }
const send = (message: HostMessage) =>
  (
    window as unknown as {
      webkit?: { messageHandlers: { everyOffice: { postMessage(message: HostMessage): void } } }
    }
  ).webkit?.messageHandlers.everyOffice.postMessage(message)
function encode(bytes: Uint8Array) {
  let binary = ''
  for (let at = 0; at < bytes.length; at += 32768)
    binary += String.fromCharCode(...bytes.subarray(at, at + 32768))
  return btoa(binary)
}
let revision = 0
let generation = 0
let saveCurrent: (() => Promise<boolean>) | undefined
const root = createRoot(document.querySelector('#app')!)
const languageListeners = new Set<(language: ReturnType<typeof normalizeLang>) => void>()
// This adapter implements only the desktop extension services used by this host.
Object.assign(window, {
  markdownApi: {
    onLanguageChanged(listener: (language: ReturnType<typeof normalizeLang>) => void) {
      languageListeners.add(listener)
      return () => languageListeners.delete(listener)
    },
    getImageHost: async () => null,
    saveImage: async ({ base64, ext }: { base64: string; ext: string }) => {
      const mime = (
        {
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          gif: 'image/gif',
          webp: 'image/webp',
        } as Record<string, string>
      )[ext]
      if (!mime || base64.length > 12 * 1024 * 1024) throw new Error('Unsupported image')
      return `data:${mime};base64,${base64}`
    },
  },
})

function NoteEditor({ payload, opened }: { payload: Payload; opened(): void }) {
  const { t } = useI18n()
  const saveFailedText = t('saveFailed')
  const [model, setModel] = useState(
    () =>
      new NoteDocument(
        Uint8Array.from(atob(payload.base64), (char) => char.charCodeAt(0)),
        payload.kind,
      ),
  )
  const [source, setSource] = useState(!model.markdown)
  const [sourceText, setSourceText] = useState(readSourceText(model.raw).text)
  const sourceValue = useRef(sourceText)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [replacement, setReplacement] = useState('')
  const [dialog, setDialog] = useState<'link' | 'diagram' | 'frontmatter' | null>(null)
  const [dialogText, setDialogText] = useState('')
  const imageInput = useRef<HTMLInputElement>(null)
  const sourceRef = useRef<PlainTextEditorHandle>(null)
  const loaded = useRef(false)
  const changed = () => {
    if (!loaded.current) return
    revision++
    send({ type: 'changed', revision })
  }
  const editor = useEditor(
    {
      extensions: buildExtensions({
        slashController: { onOpen() {}, onUpdate() {}, onKeyDown: () => false, onClose() {} },
        slashItems: () => [],
        wikiLink: { resolve: async () => ({}) },
      }),
      content: '',
      editorProps: {
        attributes: {
          class: 'tiptap ipad-markdown-content',
          role: 'textbox',
          'aria-label': payload.name,
          'aria-multiline': 'true',
        },
      },
      onUpdate: changed,
      onCreate({ editor }) {
        if (model.markdown) model.bind(editor)
        loaded.current = true
        opened()
      },
    },
    [],
  )
  useEffect(() => {
    if (!model.markdown) {
      loaded.current = true
      opened()
    }
  }, [model.markdown, opened])
  useEffect(() => {
    const content = document.querySelector('.cm-content')
    content?.setAttribute('role', 'textbox')
    content?.setAttribute('aria-label', payload.name)
    content?.setAttribute('aria-multiline', 'true')
  }, [source, payload.name])
  useEffect(() => {
    saveCurrent = async () => {
      try {
        if (!editor && !source) return false
        const bytes = source ? model.saveSource(sourceValue.current) : model.saveRich(editor!)
        send({ type: 'save', revision, base64: encode(bytes) })
        setError('')
        return true
      } catch (error) {
        const message = error instanceof Error ? error.message : saveFailedText
        setError(message)
        send({ type: 'error', message })
        return false
      }
    }
    return () => {
      saveCurrent = undefined
    }
  }, [model, editor, source, saveFailedText])
  const run = (action: (editor: Editor) => unknown) => {
    if (editor) action(editor)
  }
  const button = (key: StringKey, action: () => unknown) => (
    <button
      key={key}
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => {
        try {
          action()
        } catch (error) {
          setError(error instanceof Error ? error.message : t('saveFailed'))
        }
      }}
    >
      {t(key)}
    </button>
  )
  function toggleSource() {
    if (!editor) return
    if (!source) {
      const value = readSourceText(model.richText(editor)).text
      sourceValue.current = value
      setSourceText(value)
      setSource(true)
    } else {
      const next = new NoteDocument(model.saveSource(sourceValue.current), model.kind)
      loaded.current = false
      next.bind(editor)
      loaded.current = true
      setModel(next)
      setSource(false)
    }
  }
  function find(replace = false) {
    const target = source
      ? sourceRef.current?.findTarget()
      : editor
        ? tiptapFindTarget(editor)
        : null
    if (!target) return
    target.search(search, { matchCase: false, wholeWord: false }, 0)
    if (replace) target.replaceAll(replacement)
    else target.activate(0)
  }
  function exportPDF(type: 'exportPDF' | 'printPages') {
    if (!editor) return
    const parsed = new DOMParser().parseFromString(
      buildPrintHtml(editor.view.dom, payload.name),
      'text/html',
    )
    for (const element of parsed.querySelectorAll('script,iframe,object,embed,base,meta'))
      element.remove()
    for (const element of parsed.querySelectorAll('*')) {
      for (const attribute of [...element.attributes])
        if (attribute.name.toLowerCase().startsWith('on')) element.removeAttribute(attribute.name)
      if (element.hasAttribute('src') && !/^data:image\//.test(element.getAttribute('src') ?? ''))
        element.remove()
    }
    const html =
      [...parsed.querySelectorAll('style')].map((style) => style.outerHTML).join('') +
      parsed.body.innerHTML
    send({
      type,
      name: payload.name.replace(/\.[^.]+$/, '.pdf'),
      pages: [{ html, width: 595.28, height: 841.89, paginate: true }],
    })
  }
  async function exportWord() {
    if (!editor) return
    try {
      const bytes = await exportDocxBytes(
        editor.getJSON(),
        async (src) => {
          const data = decodeImageDataUrl(src)
          return data ? await toDocxImage(data, 620) : null
        },
        async (source, language) => {
          const result = await renderDiagram(language, source)
          return result.ok ? diagramSvgToPng(result.svg, 620) : null
        },
      )
      send({
        type: 'importCopy',
        name: payload.name.replace(/\.[^.]+$/, '.docx'),
        kind: 'docx',
        base64: encode(bytes),
      })
    } catch (error) {
      setError(error instanceof Error ? error.message : t('saveFailed'))
    }
  }
  function applyDialog() {
    if (!editor) return
    if (dialog === 'link') {
      if (!/^(https?:|mailto:|#)/i.test(dialogText)) return
      editor.chain().focus().extendMarkRange('link').setLink({ href: dialogText }).run()
    } else if (dialog === 'diagram') {
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'codeBlock',
          attrs: { language: 'mermaid' },
          content: [{ type: 'text', text: dialogText }],
        })
        .run()
    } else if (dialog === 'frontmatter') {
      model.envelope.frontmatter = buildFrontmatterRaw(dialogText)
      changed()
    }
    setDialog(null)
  }
  return (
    <div className="ipad-note">
      <nav className="ipad-note-tools">
        {button('save', () => void saveCurrent?.())}
        {model.markdown && button('sourceView', toggleSource)}
        {button('undo', () => (source ? sourceRef.current?.undo() : editor?.commands.undo()))}
        {button('redo', () => (source ? sourceRef.current?.redo() : editor?.commands.redo()))}
        {!source && (
          <>
            {button('bold', () => run((editor) => editor.chain().focus().toggleBold().run()))}
            {button('italic', () => run((editor) => editor.chain().focus().toggleItalic().run()))}
            {button('strike', () => run((editor) => editor.chain().focus().toggleStrike().run()))}
            {button('highlight', () =>
              run((editor) => editor.chain().focus().toggleMark('highlight').run()),
            )}
            {button('inlineCode', () => run((editor) => editor.chain().focus().toggleCode().run()))}
            <select
              aria-label={t('styleParagraph')}
              defaultValue="0"
              onChange={(event) =>
                run((editor) =>
                  event.target.value === '0'
                    ? editor.chain().focus().setParagraph().run()
                    : editor
                        .chain()
                        .focus()
                        .toggleHeading({ level: Number(event.target.value) as 1 | 2 | 3 })
                        .run(),
                )
              }
            >
              <option value="0">{t('styleParagraph')}</option>
              {[1, 2, 3].map((level) => (
                <option key={level} value={level}>
                  {t(`styleH${level}` as StringKey)}
                </option>
              ))}
            </select>
            {button('bulletList', () =>
              run((editor) => editor.chain().focus().toggleBulletList().run()),
            )}
            {button('orderedList', () =>
              run((editor) => editor.chain().focus().toggleOrderedList().run()),
            )}
            {button('taskList', () =>
              run((editor) => editor.chain().focus().toggleTaskList().run()),
            )}
            {button('styleQuote', () =>
              run((editor) => editor.chain().focus().toggleBlockquote().run()),
            )}
            {button('styleCodeBlock', () =>
              run((editor) => editor.chain().focus().toggleCodeBlock().run()),
            )}
            {button('insertTable', () =>
              run((editor) =>
                editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
              ),
            )}
            {button('tableRowBelow', () =>
              run((editor) => editor.chain().focus().addRowAfter().run()),
            )}
            {button('tableColRight', () =>
              run((editor) => editor.chain().focus().addColumnAfter().run()),
            )}
            {button('tableDeleteRow', () =>
              run((editor) => editor.chain().focus().deleteRow().run()),
            )}
            {button('insertHr', () =>
              run((editor) => editor.chain().focus().setHorizontalRule().run()),
            )}
            {button('link', () => {
              setDialogText('https://')
              setDialog('link')
            })}
            {button('insertMath', () => run(openMathCreate))}
            {button('insertFootnote', () => run(insertFootnote))}
            {button('insertDiagram', () => {
              setDialogText('graph LR\n  A --> B')
              setDialog('diagram')
            })}
            {button('fmProperties', () => {
              setDialogText(frontmatterInner(model.envelope.frontmatter))
              setDialog('frontmatter')
            })}
            {button('insertImage', () => imageInput.current?.click())}
            <input
              ref={imageInput}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              hidden
              onChange={async (event) => {
                const file = event.target.files?.[0]
                if (!file || file.size > 4 * 1024 * 1024) return
                const base64 = encode(new Uint8Array(await file.arrayBuffer()))
                editor
                  ?.chain()
                  .focus()
                  .setImage({ src: `data:${file.type};base64,${base64}`, alt: file.name })
                  .run()
                event.target.value = ''
              }}
            />
            <button onClick={() => exportPDF('exportPDF')}>PDF</button>
            {button('appPrintPreviewPrint', () => exportPDF('printPages'))}
            <button onClick={() => void exportWord()}>DOCX</button>
          </>
        )}
        <input
          aria-label={t('findPlaceholder')}
          placeholder={t('findPlaceholder')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {button('nextMatch', () => find())}
        <input
          aria-label={t('replacePlaceholder')}
          placeholder={t('replacePlaceholder')}
          value={replacement}
          onChange={(event) => setReplacement(event.target.value)}
        />
        {button('replaceAll', () => find(true))}
      </nav>
      {error && (
        <p role="alert" className="ipad-note-error">
          {error}
        </p>
      )}
      {dialog && (
        <div className="ipad-note-dialog" role="dialog" aria-modal="true">
          <textarea
            aria-label={t(
              dialog === 'frontmatter'
                ? 'fmProperties'
                : dialog === 'diagram'
                  ? 'insertDiagram'
                  : 'link',
            )}
            value={dialogText}
            onChange={(event) => setDialogText(event.target.value)}
          />
          {button('linkApply', applyDialog)}
          {button('redactCancel', () => setDialog(null))}
        </div>
      )}
      {source ? (
        <PlainTextEditor
          ref={sourceRef}
          key={String(source)}
          initialText={sourceText}
          mode={payload.kind === 'json' ? 'json' : 'plain'}
          onChange={(value) => {
            sourceValue.current = value
            setSourceText(value)
            changed()
          }}
          className="ipad-source"
          spellcheck={payload.kind !== 'json'}
        />
      ) : (
        <main className="ipad-note-body">
          <EditorContent editor={editor} />
        </main>
      )}
      <ToastHost />
    </div>
  )
}

Object.assign(window, {
  everyOffice: {
    async openDocument(payload: Payload) {
      revision = 0
      const current = ++generation
      const language = normalizeLang(payload.language ?? payload.locale ?? 'en')
      try {
        new NoteDocument(
          Uint8Array.from(atob(payload.base64), (char) => char.charCodeAt(0)),
          payload.kind,
        )
        await new Promise<void>((resolve) => {
          flushSync(() =>
            root.render(
              <LocaleProvider key={current} initial={language}>
                <NoteEditor
                  payload={payload}
                  opened={() => {
                    send({ type: 'opened', name: payload.name, revision: 0 })
                    resolve()
                  }}
                />
              </LocaleProvider>,
            ),
          )
        })
        return true
      } catch (error) {
        send({ type: 'error', message: error instanceof Error ? error.message : String(error) })
        return false
      }
    },
    async saveDocument() {
      return (await saveCurrent?.()) ?? false
    },
  },
})
send({ type: 'ready' })
