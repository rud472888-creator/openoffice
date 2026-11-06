import { snapshotSheet } from '../../mindmap/src/renderer/export/snapshot'
import {
  snapshotSvg,
  snapshotPng,
  snapshotPage,
  pictureScale,
} from '../../mindmap/src/renderer/export/render'
import { printActions, singleHtmlPage, utf8 } from './export'
import { openXmind, THEME_IDS, VIEW_LAYOUTS, type ViewLayout } from '@genoffice/xmind-engine'
import { type Lang } from '@genoffice/i18n'
import { editorLanguage } from './labels'
import { DocumentSession } from '../../mindmap/src/renderer/document/session'
import { MapController } from '../../mindmap/src/renderer/map/controller'
import { setTopicImage } from '../../mindmap/src/renderer/ai/map-tools'
import { mapStrings } from '../../mindmap/src/renderer/i18n/map-strings'
import { translateIn } from '../../mindmap/src/renderer/i18n/locale'
import 'mind-elixir/style.css'
import '../../mindmap/src/renderer/map.css'
import {
  ask,
  boundedArchive,
  button,
  element,
  LIMITS,
  type EditorHost,
  type EditorView,
} from './common'

export async function mindmapView(bytes: Uint8Array, host: EditorHost): Promise<EditorView> {
  await boundedArchive(bytes)
  const opened = await openXmind(bytes, { limits: LIMITS })
  if (opened.status !== 'ok') throw new Error(`Cannot open this mind map: ${opened.status}`)
  const session = new DocumentSession(opened.document, bytes)
  const lang = editorLanguage(host.language)
  const t = (key: Parameters<typeof translateIn>[1]) => translateIn(lang as Lang, key)
  let controller: MapController | undefined
  let key = session.tabs()[0]!.key
  const toolbar = element('div')
  toolbar.className = 'toolbar mindmap-tools'
  const tabs = element('select')
  tabs.setAttribute('aria-label', 'Mind map sheets')
  const card = element('div')
  card.className = 'mm-card map-card'
  const map = element('div')
  map.className = 'map-container'
  card.append(map)
  let disposed = false
  const mark = () => {
    if (!disposed && session.dirty) host.changed(controller?.editingText ?? false)
  }
  const unsubscribe = session.subscribe(mark)
  const refreshTabs = () => {
    tabs.hidden = session.tabs().length < 2
    tabs.replaceChildren()
    for (const tab of session.tabs()) {
      const option = element('option', tab.title)
      option.value = tab.key
      option.selected = tab.key === key
      tabs.append(option)
    }
  }
  const show = () => {
    controller?.commitEdit()
    controller?.flush()
    controller?.destroy()
    map.replaceChildren()
    controller = new MapController({
      el: map,
      session,
      sheetKey: key,
      strings: mapStrings(lang as Lang),
      host: {
        confirmDelete: async (count) =>
          (await ask(
            `${count} preserved elements would also be deleted. Type DELETE to continue.`,
            '',
            host,
          )) === 'DELETE',
        openLink: (url) => {
          host.error(new Error(`Link: ${url}`))
        },
        onRequest: (kind, id) => {
          void (async () => {
            const topic = controller!.topic(id)
            if (!topic) return
            if (kind === 'picture') {
              pickPicture(id)
              return
            }
            const old =
              kind === 'note'
                ? (topic.note ?? '')
                : kind === 'link'
                  ? (topic.link ?? '')
                  : topic.labels.join(', ')
            const value = await ask(kind, old, host)
            if (value === null) return
            if (kind === 'note') controller!.setNote(id, value || null)
            else if (kind === 'link') controller!.setLink(id, value || null)
            else
              controller!.setLabels(
                id,
                value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            mark()
          })().catch(host.error)
        },
        onStateChange: mark,
        onNotice: (notice) => host.error(new Error(notice.code)),
      },
    })
    requestAnimationFrame(() => controller?.zoomFit())
    refreshTabs()
  }
  const pickPicture = (id: string) => {
    const input = element('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/gif'
    input.addEventListener(
      'change',
      () => {
        void (async () => {
          const file = input.files?.[0]
          if (!file) return
          if (file.size > 8 * 1024 * 1024) throw new Error('Choose an image smaller than 8 MB.')
          const ext = file.type === 'image/png' ? 'png' : file.type === 'image/gif' ? 'gif' : 'jpg'
          const result = await setTopicImage(
            {
              session: () => session,
              activeSheetKey: () => key,
              controllerOf: () => controller ?? null,
              showSheet: () => {},
              flush: () => {
                controller?.commitEdit()
                controller?.flush()
              },
              isUntitled: () => false,
              newSheetNames: () => ({ title: 'Sheet', rootTitle: 'Topic' }),
            },
            { topicId: id },
            { bytes: new Uint8Array(await file.arrayBuffer()), ext },
            null,
          )
          if (result.isError) throw new Error(result.output)
          mark()
        })().catch(host.error)
      },
      { once: true },
    )
    input.click()
  }
  const selected = () => {
    const id = controller?.selectedTopicIds()[0]
    if (!id) throw new Error('Select a topic first.')
    return id
  }
  const action = (label: string, fn: () => unknown | Promise<unknown>) => button(label, fn, host)
  tabs.addEventListener('change', () => {
    key = tabs.value
    show()
  })
  toolbar.append(
    tabs,
    action(t('tbAddChild'), () => controller?.addChild()),
    action(t('tbAddSibling'), () => controller?.addSibling()),
    action(t('meRemoveNode'), () => controller?.removeTopics(controller.selectedTopicIds())),
    action(t('undo'), () => {
      controller?.undo()
      mark()
    }),
    action(t('redo'), () => {
      controller?.redo()
      mark()
    }),
  )
  for (const [label, toggle] of [
    ['B', 'bold'],
    ['I', 'italic'],
    ['U', 'underline'],
    ['S', 'strike'],
  ] as const)
    toolbar.append(
      action(label, () => {
        controller?.toggleTextFormat(toggle)
        mark()
      }),
    )
  toolbar.append(
    action(t('tbNote'), async () => {
      const id = selected()
      const value = await ask(t('tbNote'), controller!.topic(id)!.note ?? '', host)
      if (value !== null) {
        controller!.setNote(id, value)
        mark()
      }
    }),
    action(t('tbPicture'), () => pickPicture(selected())),
    action(t('tbRelationship'), () => controller?.pickRelationshipTarget()),
    action(t('tbSummary'), () => {
      controller?.addSummary()
      mark()
    }),
    action(t('tbBoundary'), () => {
      controller?.addBoundary()
      mark()
    }),
    action(t('tbFoldAll'), () => {
      controller?.setAllFolded(true)
      mark()
    }),
    action(t('tbUnfoldAll'), () => {
      controller?.setAllFolded(false)
      mark()
    }),
    action('−', () => controller?.zoomOut()),
    action('+', () => controller?.zoomIn()),
    action(t('zoomFit'), () => controller?.zoomFit()),
  )
  const layout = element('select')
  layout.setAttribute('aria-label', t('tbLayout'))
  for (const value of VIEW_LAYOUTS) {
    const option = element('option', value)
    option.value = value
    layout.append(option)
  }
  layout.value = session.view(key).layout
  layout.addEventListener('change', () => {
    controller?.setLayout(layout.value as ViewLayout)
    mark()
  })
  const theme = element('select')
  theme.setAttribute('aria-label', t('tbTheme'))
  for (const value of THEME_IDS) {
    const option = element('option', value)
    option.value = value
    theme.append(option)
  }
  theme.addEventListener('change', () => {
    controller?.setTheme(theme.value as (typeof THEME_IDS)[number])
    mark()
  })
  toolbar.append(
    layout,
    theme,
    action('Add sheet', async () => {
      const title = await ask('Sheet title', 'Sheet', host)
      if (title !== null) {
        const tab = session.addSheet({ title, rootTitle: title })
        key = tab.key
        show()
        host.changed()
      }
    }),
    action('Rename sheet', async () => {
      const title = await ask(
        'Sheet title',
        session.tabs().find((tab) => tab.key === key)!.title,
        host,
      )
      if (title !== null) {
        session.renameSheet(key, title)
        refreshTabs()
        host.changed()
      }
    }),
  )
  const snapshot = async () => {
    controller?.commitEdit()
    controller?.flush()
    const value = await snapshotSheet({
      mind: controller!.mind,
      readEntry: (name) => session.document.readEntry(name),
    })
    if (!value) throw new Error('The map cannot be exported.')
    return value
  }
  const exports = printActions(host, async () => [
    await singleHtmlPage(snapshotPage(await snapshot()), (297 * 96) / 25.4, (209.5 * 96) / 25.4),
  ])
  toolbar.append(
    action('Export PDF', exports.pdf),
    action('Print', exports.print),
    action('Export SVG', async () =>
      host.exportFile('svg', utf8(snapshotSvg(await snapshot(), 1))),
    ),
    action('Export PNG', async () => {
      const value = await snapshot()
      await host.exportFile(
        'png',
        await snapshotPng(value, pictureScale(value.width, value.height)),
      )
    }),
    action('Export Markdown', async () => {
      controller?.commitEdit()
      controller?.flush()
      await host.exportFile('md', utf8(session.outline()))
    }),
  )
  card.addEventListener('input', () => host.changed(true), true)
  host.root.append(toolbar, card)
  show()
  return {
    save: async () => {
      controller?.commitEdit()
      controller?.flush()
      const snapshot = await session.recoveryBytes()
      await boundedArchive(snapshot)
      return snapshot
    },
    dispose: () => {
      disposed = true
      unsubscribe()
      controller?.destroy()
      host.root.replaceChildren()
    },
  }
}
