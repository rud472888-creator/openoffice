import '../../../packages/ui/src/tokens.css'
import './styles.css'
import {
  Workbook,
  address,
  coordinates,
  type Sheet,
  type Worksheet,
  type ValueKind,
} from './workbook'
import { strings } from './strings'
import { initializeCalculation } from './calculation'
import wasmUrl from '../vendor/ironcalc-xlsx/wasm_bg.wasm?url'

const wasmBinary = atob(wasmUrl.slice(wasmUrl.indexOf(',') + 1))
initializeCalculation(Uint8Array.from(wasmBinary, (char) => char.charCodeAt(0)))

interface BridgeDocument {
  name: string
  base64: string
  kind: string
  locale?: string
}
interface HostMessage {
  type: string
  [key: string]: unknown
}
declare global {
  interface Window {
    everyOffice: {
      openDocument(document: BridgeDocument): Promise<void>
      saveDocument(): Promise<void>
      didExport?(requestId: string, result: { completed: boolean; error?: string }): void
    }
    webkit?: { messageHandlers?: { everyOffice?: { postMessage(message: HostMessage): void } } }
  }
}

const app = document.querySelector<HTMLElement>('#app')!
let t = strings(navigator.language)
let book: Workbook | undefined
let sheet: Sheet | undefined
let worksheet: Worksheet | undefined
let name = ''
let selected = 'A1'
let firstRow = 1
let firstColumn = 1
let loading = false
let generation = 0
let saving: Promise<void> = Promise.resolve()
let draft = false
let revision = 0
const post = (message: HostMessage): void =>
  window.webkit?.messageHandlers?.everyOffice?.postMessage(message)

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag)
  if (text !== undefined) result.textContent = text
  return result
}

function report(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  const status = document.querySelector<HTMLElement>('#status')
  if (status) {
    status.textContent = message
    status.setAttribute('role', 'alert')
  }
  post({ type: 'error', message })
}

function changed(pendingDraft = false): void {
  revision++
  post({ type: 'changed', dirty: true, draft: pendingDraft, revision })
  const status = document.querySelector<HTMLElement>('#status')
  if (status) status.textContent = t[19]
}

function commit(): boolean {
  if (!draft || !book || !sheet || !worksheet) return true
  const value = document.querySelector<HTMLTextAreaElement>('#value')!
  const kind = document.querySelector<HTMLSelectElement>('#kind')!
  try {
    const edited = book.edit(sheet, selected, value.value, kind.value as ValueKind)
    draft = false
    if (edited) {
      renderGrid()
      changed()
      showCalculation()
    }
    return true
  } catch (error) {
    report(error instanceof Error ? error : new Error(t[21]))
    return false
  }
}

function button(text: string, action: () => void): HTMLButtonElement {
  const result = element('button', text)
  result.type = 'button'
  result.addEventListener('click', action)
  return result
}

function showSelection(focus = false): void {
  if (!worksheet) return
  const cell = worksheet.cell(selected)
  const editor = document.querySelector<HTMLElement>('#editor')!
  editor.replaceChildren()
  const label = element('label', `${selected} · ${cell.readOnly ? t[13] : t[10]}`)
  label.htmlFor = 'value'
  const value = element('textarea')
  value.id = 'value'
  value.value = cell.formula !== undefined ? `=${cell.formula}` : cell.value
  value.readOnly = cell.readOnly
  value.rows = 2
  value.spellcheck = false
  value.maxLength = 32767
  value.addEventListener('input', () => {
    draft = true
    changed(true)
  })
  value.addEventListener('change', () => {
    commit()
  })
  const kind = element('select')
  kind.id = 'kind'
  kind.setAttribute('aria-label', t[10])
  for (const [type, title] of [
    ['text', t[7]],
    ['number', t[8]],
    ['boolean', t[9]],
    ['formula', 'Formula'],
  ]) {
    const option = element('option', title)
    option.value = type
    option.selected = type === (cell.formula !== undefined ? 'formula' : cell.kind)
    kind.append(option)
  }
  kind.disabled = cell.readOnly
  kind.addEventListener('change', () => {
    draft = true
    changed(true)
  })
  const apply = button(t[11], () => {
    if (commit()) showSelection()
  })
  apply.disabled = cell.readOnly
  const undo = button(t[12], () => {
    if (!commit() || !book?.undo()) return
    void book
      .worksheet(sheet!)
      .then((result) => {
        worksheet = result
        renderGrid()
        showSelection()
        changed()
      })
      .catch(report)
  })
  undo.disabled = !book?.canUndo
  const actions = element('div')
  actions.className = 'editor-actions'
  actions.append(kind, apply, undo)
  editor.append(label, value, actions)
  if (cell.formula !== undefined) {
    const formula = element('p', `${t[14]} · =${cell.formula || '…'}`)
    formula.className = 'formula'
    editor.append(formula)
  }
  document.querySelector<HTMLInputElement>('#address')!.value = selected
  if (focus) value.focus()
}

function showCalculation(): void {
  const note = document.querySelector<HTMLElement>('.notice')
  if (note && book)
    note.textContent = book.calculationIssues.length
      ? `Calculation incomplete: ${book.calculationIssues.join(' · ')}`
      : 'IronCalc 0.9.1 calculates formulas offline. Changes update dependent cells on all sheets.'
}

function select(ref: string, focus = false): void {
  if (!commit()) return
  selected = ref
  draft = false
  showSelection(focus)
  renderGrid()
}

function renderGrid(): void {
  if (!worksheet) return
  const container = document.querySelector<HTMLElement>('#grid')!
  const table = element('table')
  table.setAttribute('aria-label', sheet!.name)
  const caption = element(
    'caption',
    `${sheet!.name} · ${address(firstColumn, firstRow)}–${address(Math.min(16384, firstColumn + 11), Math.min(1048576, firstRow + 39))}`,
  )
  table.append(caption)
  const head = element('thead')
  const header = element('tr')
  header.append(element('th'))
  for (let column = firstColumn; column <= Math.min(16384, firstColumn + 11); column++) {
    const th = element('th', address(column, 1).replace(/1$/, ''))
    th.scope = 'col'
    header.append(th)
  }
  head.append(header)
  table.append(head)
  const body = element('tbody')
  for (let row = firstRow; row <= Math.min(1048576, firstRow + 39); row++) {
    const tr = element('tr')
    const th = element('th', String(row))
    th.scope = 'row'
    tr.append(th)
    for (let column = firstColumn; column <= Math.min(16384, firstColumn + 11); column++) {
      const ref = address(column, row)
      const cell = worksheet.cell(ref)
      const td = element('td')
      const control = button(cell.value || '\u00a0', () => select(ref))
      control.setAttribute(
        'aria-label',
        `${ref}: ${cell.value}${cell.formula !== undefined ? ` · ${t[14]}` : ''}${cell.readOnly ? ` · ${t[13]}` : ''}`,
      )
      control.setAttribute('aria-pressed', String(ref === selected))
      control.dataset.address = ref
      control.className = `${cell.kind === 'number' ? 'numeric ' : ''}${cell.formula !== undefined ? 'cached ' : ''}${ref === selected ? 'selected' : ''}`
      control.addEventListener('keydown', (event) => {
        const move = {
          ArrowDown: [0, 1],
          ArrowUp: [0, -1],
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
        }[event.key]
        if (move) {
          event.preventDefault()
          const nextColumn = Math.max(1, Math.min(16384, column + move[0]))
          const nextRow = Math.max(1, Math.min(1048576, row + move[1]))
          if (nextRow < firstRow || nextRow > firstRow + 39) firstRow = nextRow
          if (nextColumn < firstColumn || nextColumn > firstColumn + 11) firstColumn = nextColumn
          const next = address(nextColumn, nextRow)
          select(next)
          document.querySelector<HTMLButtonElement>(`[data-address="${next}"]`)?.focus()
        } else if (event.key === 'Enter') {
          event.preventDefault()
          select(ref, true)
        }
      })
      td.append(control)
      tr.append(td)
    }
    body.append(tr)
  }
  table.append(body)
  container.replaceChildren(table)
}

function render(): void {
  app.replaceChildren()
  if (!book || !worksheet) {
    app.append(element('p', loading ? t[18] : t[17]))
    return
  }
  const toolbar = element('div')
  toolbar.className = 'toolbar'
  const selectLabel = element('label', t[0])
  selectLabel.htmlFor = 'sheets'
  const sheets = element('select')
  sheets.id = 'sheets'
  for (const item of book.sheets.filter((n) => !n.hidden)) {
    const option = element('option', item.name)
    option.value = item.path
    option.selected = item.path === sheet!.path
    sheets.append(option)
  }
  sheets.addEventListener('change', () => {
    if (!commit()) {
      sheets.value = sheet!.path
      return
    }
    const next = book!.sheets.find((n) => n.path === sheets.value)!
    const currentGeneration = generation
    sheets.disabled = true
    void book!
      .worksheet(next)
      .then((result) => {
        if (generation !== currentGeneration) return
        sheet = next
        worksheet = result
        selected = 'A1'
        firstRow = 1
        firstColumn = 1
        render()
      })
      .catch((error) => {
        sheets.value = sheet!.path
        sheets.disabled = false
        report(error)
      })
  })
  const cellLabel = element('label', t[1])
  cellLabel.htmlFor = 'address'
  const cellAddress = element('input')
  cellAddress.id = 'address'
  cellAddress.value = selected
  cellAddress.autocapitalize = 'characters'
  cellAddress.spellcheck = false
  const go = (): void => {
    try {
      const point = coordinates(cellAddress.value)
      if (!commit()) return
      firstRow = point.row
      firstColumn = point.column
      select(address(point.column, point.row))
    } catch (error) {
      report(error)
    }
  }
  cellAddress.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') go()
  })
  toolbar.append(selectLabel, sheets, cellLabel, cellAddress, button(t[2], go))
  const note = element('p', t[15])
  note.className = 'notice'
  const editor = element('section')
  editor.id = 'editor'
  editor.setAttribute('aria-label', t[16])
  const grid = element('div')
  grid.id = 'grid'
  grid.tabIndex = 0
  const navigation = element('nav')
  const move = (rows: number, columns: number): void => {
    if (!commit()) return
    firstRow = Math.max(1, Math.min(1048576, firstRow + rows))
    firstColumn = Math.max(1, Math.min(16384, firstColumn + columns))
    renderGrid()
  }
  navigation.append(
    button(t[3], () => move(-40, 0)),
    button(t[4], () => move(40, 0)),
    button(t[5], () => move(0, -12)),
    button(t[6], () => move(0, 12)),
  )
  const status = element('p')
  status.id = 'status'
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  app.append(toolbar, note, editor, grid, navigation, status)
  showSelection()
  renderGrid()
  showCalculation()
}

window.everyOffice = {
  async openDocument(document): Promise<void> {
    const currentGeneration = ++generation
    book?.close()
    book = undefined
    sheet = undefined
    worksheet = undefined
    draft = false
    revision = 0
    t = strings(document.locale ?? navigator.language)
    window.document.documentElement.lang = document.locale ?? navigator.language
    window.document.documentElement.dir = /^(ar|he)(-|$)/.test(
      document.locale ?? navigator.language,
    )
      ? 'rtl'
      : 'ltr'
    loading = true
    render()
    try {
      if (document.kind !== 'xlsx') throw new Error('This editor opens XLSX documents only.')
      if (document.base64.length > Math.ceil((32 * 1024 * 1024) / 3) * 4)
        throw new Error('The workbook exceeds the 32 MB iPad limit.')
      const raw = atob(document.base64)
      const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0))
      const opened = await Workbook.open(bytes)
      const next = opened.sheets.find((n) => !n.hidden)!
      const nextWorksheet = await opened.worksheet(next)
      if (generation !== currentGeneration) return
      book = opened
      sheet = next
      worksheet = nextWorksheet
      name = document.name
      selected = 'A1'
      firstRow = 1
      firstColumn = 1
      loading = false
      render()
      post({ type: 'opened', name, revision: 0 })
    } catch (error) {
      if (generation === currentGeneration) {
        loading = false
        render()
        report(error)
      }
    }
  },
  async saveDocument(): Promise<void> {
    if (!commit() || !book) {
      if (!book) report(new Error('No workbook is open.'))
      return
    }
    const currentBook = book
    const currentGeneration = generation
    const currentName = name
    const snapshotRevision = revision
    const snapshot = currentBook.save()
    saving = saving
      .catch(() => {})
      .then(async () => {
        try {
          const { bytes } = await snapshot
          if (generation !== currentGeneration) return
          let binary = ''
          for (let offset = 0; offset < bytes.length; offset += 32768)
            binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
          post({
            type: 'save',
            base64: btoa(binary),
            name: currentName,
            kind: 'xlsx',
            revision: snapshotRevision,
          })
          if (snapshotRevision === revision)
            document.querySelector<HTMLElement>('#status')!.textContent = t[20]
        } catch (error) {
          report(error)
        }
      })
    await saving
  },
}
render()
post({ type: 'ready', kind: 'xlsx' })
