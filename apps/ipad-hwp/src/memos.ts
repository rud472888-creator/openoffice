import type { AgentBridge } from '../../hwp/src/renderer/ai/agent-bridge'
import type { AgentMemo, AgentMemoAnchor } from '../../hwp/studio-plugin/agent-plugin.mjs'

export function mountMemos(options: {
  bridge: AgentBridge
  text(key: string): string
  changed(): void
  report(error: unknown): void
  draft(active: boolean): void
}) {
  const { bridge, text } = options
  const panel = document.createElement('aside')
  panel.className = 'memo-panel'
  panel.hidden = true
  const list = document.createElement('div')
  const button = (key: string, action: () => unknown) => {
    const item = document.createElement('button')
    item.textContent = text(key)
    item.addEventListener('click', () => {
      void Promise.resolve(action()).catch(options.report)
    })
    return item
  }
  let editing = false
  async function reload() {
    if (editing || panel.hidden) return
    const result = await bridge.listMemos()
    list.replaceChildren()
    if (!result.supported) {
      list.textContent = text('memoUnsupportedBuild')
      return
    }
    if (!result.memos.length) list.textContent = text('memoEmpty')
    for (const memo of result.memos) {
      const card = document.createElement('article')
      const heading = document.createElement('strong')
      heading.textContent = memo.author || text('memoUnknownAuthor')
      const body = document.createElement('p')
      body.textContent = memo.text || text('memoNoBody')
      card.append(heading, body)
      card.addEventListener('click', () => {
        void bridge.selectMemo(memo.id)
      })
      if (memo.editable) card.append(button('memoEdit', () => edit(memo)))
      if (memo.readOnlyReason !== 'protected' && memo.readOnlyReason !== 'unsupported_place') {
        card.append(
          button('memoDelete', async () => {
            const result = await bridge.removeMemo(memo.id)
            if (!result.ok) throw new Error(text('memoErrDelete'))
            options.changed()
            await reload()
          }),
        )
      }
      list.append(card)
    }
  }
  async function edit(memo?: AgentMemo) {
    if (editing) return
    let anchor: AgentMemoAnchor | undefined
    if (!memo) {
      const selection = await bridge.memoSelection()
      if (!selection.ok) throw new Error(text('memoErrNone'))
      anchor = selection.anchor
    }
    await bridge.setMemoLock(true)
    editing = true
    options.draft(true)
    const dialog = document.createElement('dialog')
    const title = document.createElement('h2')
    title.textContent = text(memo ? 'memoEditTitle' : 'memoNewTitle')
    const author = document.createElement('input')
    author.setAttribute('aria-label', text('memoAuthor'))
    author.value = memo?.author ?? ''
    author.disabled = Boolean(memo)
    const body = document.createElement('textarea')
    body.setAttribute('aria-label', text('memoBody'))
    body.placeholder = text('memoBodyPlaceholder')
    body.maxLength = 100000
    body.value = memo?.text ?? ''
    const error = document.createElement('p')
    error.setAttribute('role', 'alert')
    const close = async () => {
      dialog.close()
      dialog.remove()
      editing = false
      await bridge.setMemoLock(false)
      options.draft(false)
      await reload()
    }
    const save = button('fileSave', async () => {
      if (!body.value.trim()) {
        error.textContent = text('memoErrEmpty')
        return
      }
      const result = memo
        ? await bridge.setMemo(memo.id, body.value)
        : await bridge.insertMemo(anchor!, author.value, body.value)
      if (!result.ok) {
        error.textContent = text('memoErrSave')
        return
      }
      await close()
      options.changed()
    })
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault()
      void close()
    })
    dialog.append(title, author, body, error, save, button('memoCancel', close))
    document.body.append(dialog)
    dialog.showModal()
    body.focus()
  }
  const add = button('memoAdd', () => edit())
  // Keep the studio selection when the toolbar is touched.
  add.addEventListener('pointerdown', (event) => event.preventDefault())
  panel.append(
    add,
    button('dismiss', () => toggle(false)),
    list,
  )
  document.body.append(panel)
  async function toggle(shown = panel.hidden) {
    panel.hidden = !shown
    await bridge.showMemoAnchors(shown)
    await reload()
  }
  return {
    toggle,
    add: () => edit(),
    destroy() {
      panel.remove()
    },
    get editing() {
      return editing
    },
  }
}
