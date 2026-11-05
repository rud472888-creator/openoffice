import type { Editor } from '@tiptap/core'
import { readSections, type HeaderFooter, type SectionSettings } from '@genoffice/docx-engine'
import { t, type StringKey } from '../../docs/src/renderer/i18n/locale'
import {
  addCommentToRange,
  commentAnchors,
  nextCommentId,
  removeCommentsFromDoc,
  wordRangeAtCaret,
} from '../../docs/src/renderer/editor/comments'
import {
  acceptAllRevisions,
  rejectAllRevisions,
  acceptCurrentRevision,
  rejectCurrentRevision,
} from '../../docs/src/renderer/editor/revisions'
import { authorName } from '../../docs/src/renderer/author-name'
import { mountHfEditor, insertHfField } from '../../docs/src/renderer/editor/hf-editor'
import {
  resolveHf,
  withHfEdit,
  hfSaveOptions,
  type HfSectionState,
} from '../../docs/src/renderer/hf-sections'
import { hfFromPart } from '../../docs/src/renderer/doc-state'
import type { EditorOptions } from './rich-editor'

export function modal(title: string): {
  dialog: HTMLDialogElement
  body: HTMLElement
  actions: HTMLElement
  close(): void
} {
  const dialog = document.createElement('dialog')
  dialog.className = 'ipad-dialog modal'
  const heading = document.createElement('h2')
  heading.textContent = title
  const body = document.createElement('div')
  body.className = 'ipad-dialog-body'
  const actions = document.createElement('div')
  actions.className = 'ipad-dialog-actions'
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.textContent = t('appCancel')
  cancel.addEventListener('click', () => dialog.close())
  actions.append(cancel)
  dialog.append(heading, body, actions)
  document.body.append(dialog)
  dialog.addEventListener('close', () => dialog.remove())
  dialog.showModal()
  return { dialog, body, actions, close: () => dialog.close() }
}

export function field(
  parent: HTMLElement,
  label: string,
  value: string,
  type = 'text',
): HTMLInputElement {
  const row = document.createElement('label')
  row.className = 'ipad-field'
  row.append(document.createTextNode(label))
  const input = document.createElement('input')
  input.type = type
  input.value = value
  row.append(input)
  parent.append(row)
  return input
}

export function commitButton(parent: HTMLElement, action: () => void): void {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = t('appOk')
  button.addEventListener('click', action)
  parent.append(button)
}

export function addReviewTools(editor: Editor, options: EditorOptions): void {
  const { model } = options
  function command(key: StringKey, action: () => void, active?: () => boolean): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = t(key)
    button.setAttribute('aria-label', t(key))
    button.disabled =
      model.readOnly ||
      (!!model.odt &&
        [
          'ribbonComment',
          'ribbonTrackChanges',
          'ribbonAcceptOne',
          'ribbonRejectOne',
          'ribbonAcceptAll',
          'ribbonRejectAll',
        ].includes(key))
    button.addEventListener('pointerdown', (event) => event.preventDefault())
    button.addEventListener('click', () => {
      try {
        action()
      } catch (error) {
        options.error(error)
      }
    })
    if (active) {
      const refresh = () => button.setAttribute('aria-pressed', String(active()))
      editor.on('transaction', refresh)
      refresh()
    }
    options.toolbar.append(button)
    return button
  }
  const sections = readSections(model.parsed)
  const hfState: HfSectionState = {
    sections,
    edits: {},
    links: {},
    parsed: model.parsed,
    docStrips: {
      header: { text: model.parsed.headerText ?? '', paras: model.parsed.headerParas ?? undefined },
      footer: { text: model.parsed.footerText ?? '', paras: model.parsed.footerParas ?? undefined },
      variants: {
        headerFirst: hfFromPart(model.parsed.headerFirst),
        footerFirst: hfFromPart(model.parsed.footerFirst),
        headerEven: hfFromPart(model.parsed.headerEven),
        footerEven: hfFromPart(model.parsed.footerEven),
      },
    },
  }
  const styles = document.createElement('select')
  styles.setAttribute('aria-label', t('appParagraphStyles'))
  styles.disabled = model.readOnly
  const empty = document.createElement('option')
  empty.value = ''
  empty.textContent = t('appParagraphStyles')
  styles.append(empty)
  for (const style of model.parsed.styles.values()) {
    if (style.type !== 'paragraph') continue
    const option = document.createElement('option')
    option.value = style.styleId
    option.textContent = style.name
    styles.append(option)
  }
  styles.addEventListener('change', () => {
    const style = model.parsed.styles.get(styles.value)
    if (!style) return
    const type = style.headingLevel ? 'docHeading' : 'docParagraph'
    editor
      .chain()
      .focus()
      .setNode(type, {
        styleId: style.styleId,
        ...(style.headingLevel ? { level: style.headingLevel } : {}),
      })
      .run()
  })
  options.toolbar.append(styles)

  command('ribbonMargins', () => {
    const box = modal(t('ribbonMarginDialogTitle'))
    const scope = document.createElement('select')
    scope.setAttribute('aria-label', t('ribbonPaperApplyTo'))
    const all = document.createElement('option')
    all.value = 'all'
    all.textContent = t('ribbonPaperApplyDocument')
    scope.append(all)
    sections.forEach((_section, i) => {
      const option = document.createElement('option')
      option.value = String(i)
      option.textContent = `${t('ribbonPaperApplySection')} ${i + 1}`
      scope.append(option)
    })
    box.body.append(scope)
    const initial = model.sectionChanges.get(sections.length - 1) ?? sections.at(-1)!.settings
    const inputs = new Map<keyof SectionSettings, HTMLInputElement>()
    for (const [key, label] of [
      ['marginTop', 'ribbonMarginTop'],
      ['marginBottom', 'ribbonMarginBottom'],
      ['marginLeft', 'ribbonMarginLeft'],
      ['marginRight', 'ribbonMarginRight'],
      ['pageWidth', 'ribbonPaperWidth'],
      ['pageHeight', 'ribbonPaperHeight'],
    ] as const) {
      const input = field(
        box.body,
        `${t(label)} (mm)`,
        String(Math.round(((initial[key] * 25.4) / 1440) * 10) / 10),
        'number',
      )
      input.min = '0'
      input.step = '0.1'
      inputs.set(key, input)
    }
    commitButton(box.actions, () => {
      try {
        const patch = Object.fromEntries(
          [...inputs].map(([key, input]) => [key, Math.round((Number(input.value) * 1440) / 25.4)]),
        ) as Partial<SectionSettings>
        const indexes =
          scope.value === 'all' ? sections.map((_section, i) => i) : [Number(scope.value)]
        for (const index of indexes) {
          const next = { ...sections[index].settings, ...patch }
          if (
            !Object.values(patch).every(
              (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0,
            ) ||
            next.pageWidth < 1440 ||
            next.pageHeight < 1440 ||
            next.marginLeft + next.marginRight >= next.pageWidth ||
            next.marginTop + next.marginBottom >= next.pageHeight
          )
            throw new Error('cannotSave')
          next.orientation = next.pageWidth > next.pageHeight ? 'landscape' : 'portrait'
          model.sectionChanges.set(index, next)
        }
        const selected = model.sectionChanges.get(indexes[0])!
        editor.view.dom.style.setProperty('--page-w', `${selected.pageWidth / 15}px`)
        editor.view.dom.style.setProperty('--page-h', `${selected.pageHeight / 15}px`)
        editor.view.dom.style.setProperty(
          '--page-pad',
          `${selected.marginTop / 15}px ${selected.marginRight / 15}px ${selected.marginBottom / 15}px ${selected.marginLeft / 15}px`,
        )
        options.changed()
        box.close()
      } catch (error) {
        options.error(error)
      }
    })
  })
  command('ribbonOrientation', () => {
    for (let i = 0; i < sections.length; i++) {
      const current = model.sectionChanges.get(i) ?? sections[i].settings
      model.sectionChanges.set(i, {
        ...current,
        pageWidth: current.pageHeight,
        pageHeight: current.pageWidth,
        orientation: current.orientation === 'portrait' ? 'landscape' : 'portrait',
      })
    }
    const first = model.sectionChanges.get(0)!
    editor.view.dom.style.setProperty('--page-w', `${first.pageWidth / 15}px`)
    editor.view.dom.style.setProperty('--page-h', `${first.pageHeight / 15}px`)
    options.changed()
  })
  command('ribbonLink', () => {
    const selection = editor.state.selection
    const box = modal(t('ribbonLinkInsertTitle'))
    const address = field(
      box.body,
      t('ribbonLinkAddress'),
      String(editor.getAttributes('link').href ?? 'https://'),
    )
    commitButton(box.actions, () => {
      try {
        const href = address.value.trim()
        if (!/^(https?:\/\/|mailto:|#)/i.test(href)) throw new Error('cannotSave')
        editor.commands.setTextSelection({ from: selection.from, to: selection.to })
        if (selection.empty)
          editor
            .chain()
            .focus()
            .insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] })
            .run()
        else editor.chain().focus().setMark('link', { href }).run()
        box.close()
      } catch (error) {
        options.error(error)
      }
    })
  })
  command(
    'ribbonTrackChanges',
    () => {
      editor.storage.trackChanges.enabled = !editor.storage.trackChanges.enabled
      model.options.trackRevisions = editor.storage.trackChanges.enabled
      options.changed()
    },
    () => editor.storage.trackChanges.enabled,
  )
  command('ribbonAcceptOne', () => {
    acceptCurrentRevision(editor)
  })
  command('ribbonRejectOne', () => {
    rejectCurrentRevision(editor)
  })
  command('ribbonAcceptAll', () => acceptAllRevisions(editor))
  command('ribbonRejectAll', () => rejectAllRevisions(editor))
  command('ribbonComment', () => {
    const comments = model.options.comments ?? model.parsed.comments
    const range = editor.state.selection.empty ? wordRangeAtCaret(editor) : editor.state.selection
    const box = modal(t('appCommentsTitle', { n: comments.length }))
    for (const comment of comments) {
      const item = document.createElement('article')
      item.className = 'ipad-comment'
      const label = document.createElement('strong')
      label.textContent = comment.author
      item.append(label)
      const body = document.createElement('textarea')
      body.value = comment.text
      body.setAttribute('aria-label', t('appCommentPlaceholder'))
      item.append(body)
      const update = document.createElement('button')
      update.type = 'button'
      update.textContent = t('appSave')
      update.addEventListener('click', () => {
        model.options.comments = (model.options.comments ?? model.parsed.comments).map((c) =>
          c.id === comment.id ? { ...c, text: body.value } : c,
        )
        options.changed()
      })
      item.append(update)
      const resolve = document.createElement('button')
      resolve.type = 'button'
      resolve.textContent = t(comment.done ? 'appReopen' : 'appResolve')
      resolve.addEventListener('click', () => {
        const current = (model.options.comments ?? model.parsed.comments).find(
          (c) => c.id === comment.id,
        )!
        model.options.comments = (model.options.comments ?? model.parsed.comments).map((c) =>
          c.id === comment.id ? { ...c, done: !current.done } : c,
        )
        resolve.textContent = t(current.done ? 'appResolve' : 'appReopen')
        options.changed()
      })
      item.append(resolve)
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.textContent = t('ribbonDeleteComment')
      remove.addEventListener('click', () => {
        const victims = new Set(
          (model.options.comments ?? model.parsed.comments)
            .filter((c) => c.id === comment.id || c.parentId === comment.id)
            .map((c) => c.id),
        )
        removeCommentsFromDoc(editor, victims)
        if (commentAnchors(editor.state.doc).some((anchor) => victims.has(anchor.id))) {
          options.error(new Error('protectedBlock'))
          return
        }
        model.options.comments = (model.options.comments ?? model.parsed.comments).filter(
          (c) => c.id !== comment.id && c.parentId !== comment.id,
        )
        options.changed()
        item.remove()
      })
      item.append(remove)
      box.body.append(item)
    }
    const text = document.createElement('textarea')
    text.placeholder = t('appCommentPlaceholder')
    text.setAttribute('aria-label', t('appCommentPlaceholder'))
    box.body.append(text)
    commitButton(box.actions, () => {
      if (!text.value.trim()) {
        box.close()
        return
      }
      if (!range || range.from === range.to) {
        options.error(new Error('protectedBlock'))
        return
      }
      const current = model.options.comments ?? model.parsed.comments
      const id = nextCommentId(current)
      addCommentToRange(editor, range.from, range.to, id)
      if (!commentAnchors(editor.state.doc).some((anchor) => anchor.id === id)) {
        options.error(new Error('protectedBlock'))
        return
      }
      model.options.comments = [
        ...current,
        { id, author: authorName(), date: new Date().toISOString(), text: text.value },
      ]
      options.changed()
      box.close()
    })
  })
  for (const kind of ['header', 'footer'] as const)
    command(kind === 'header' ? 'ribbonHeader' : 'ribbonFooter', () => {
      const box = modal(t(kind === 'header' ? 'ribbonHeader' : 'ribbonFooter'))
      box.actions.querySelector('button')!.textContent = t('appClose')
      const select = document.createElement('select')
      select.setAttribute('aria-label', t('ribbonPaperApplySection'))
      sections.forEach((_section, i) => {
        const item = document.createElement('option')
        item.value = String(i)
        item.textContent = `${i + 1}`
        select.append(item)
      })
      box.body.append(select)
      const host = document.createElement('div')
      host.className = 'ipad-hf-host'
      box.body.append(host)
      let current = 0
      let handle: ReturnType<typeof mountHfEditor> | undefined
      const mount = () => {
        handle?.discard()
        const value = resolveHf(hfState, current, kind, 'default').value ?? { text: '' }
        const commit = (next: HeaderFooter) => {
          const previous = resolveHf(hfState, current, kind, 'default').value
          if (JSON.stringify(previous) === JSON.stringify(next)) return
          const changed = withHfEdit(hfState, current, kind, 'default', next)
          if (changed) {
            Object.assign(hfState, changed)
            Object.assign(model.options, hfSaveOptions(hfState))
            options.changed()
          }
        }
        handle = mountHfEditor(host, {
          value,
          pageNo: '1',
          pageTotal: '1',
          spellcheck: true,
          onCommit: commit,
          onExit() {},
        })
        handle.editor.on('update', () => {
          const next = handle?.changed()
          if (next) commit(next)
        })
      }
      select.addEventListener('change', () => {
        handle?.exit()
        current = Number(select.value)
        mount()
      })
      mount()
      const format = document.createElement('div')
      format.className = 'ipad-dialog-actions'
      box.body.prepend(format)
      for (const [key, mark] of [
        ['ribbonBoldTip', 'bold'],
        ['ribbonItalicTip', 'italic'],
        ['ribbonUnderlineTip', 'underline'],
      ] as const) {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = t(key)
        button.addEventListener('pointerdown', (event) => event.preventDefault())
        button.addEventListener('click', () =>
          handle?.editor.chain().focus().toggleMark(mark).run(),
        )
        format.append(button)
      }
      const page = document.createElement('button')
      page.type = 'button'
      page.textContent = t('ribbonPageNumber')
      page.addEventListener('pointerdown', (event) => event.preventDefault())
      page.addEventListener('click', () => {
        if (handle) insertHfField(handle.editor, 'PAGE')
      })
      format.append(page)
      commitButton(box.actions, () => {
        handle?.exit()
        box.close()
      })
      box.dialog.addEventListener('close', () => handle?.discard())
    })
}
