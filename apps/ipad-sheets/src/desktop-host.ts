import { DesktopWorkbook } from './desktop-metadata'
import '@univerjs/sheets/facade'
import '@univerjs/sheets-ui/facade'
import { saveDesktopWorkbook } from './desktop-save'
import { FormulaEngine } from './calculation'
import { importWorkbook } from './import-workbook'
import { address } from './workbook'
import { NativeActions, nativePrintPages } from './native-actions'
import {
  journalSuppression,
  commitActiveCellEditor,
  type ActiveCellEditor,
  type UniverRuntime,
} from '../../sheets/src/renderer/univer-state'
import { listWorkbookQueries } from '../../../packages/xlsx-gateway/src/gateway/xlsx-connections'
import { parsePivotDefinition } from '../../../packages/xlsx-gateway/src/gateway/xlsx-pivot'
import { normalizeAiSettings, checkingSubscriptionStatuses } from '@genoffice/ai-provider/browser'
import type {
  DesktopApi,
  MenuAction,
  WorkbookRecalcRequest,
  WorkbookFindCellsRequest,
  WorkbookSaveRequest,
  WorkbookSaveEditsBegin,
  WorkbookSaveEditsChunk,
  WorkbookSaveEditsAbort,
} from '../../sheets/src/shared/desktop-api'

type Callback = (...values: unknown[]) => unknown
interface HostMessage {
  type: string
  [key: string]: unknown
}
const post = (message: HostMessage): void =>
  window.webkit?.messageHandlers?.everyOffice?.postMessage(message)
const base64 = (bytes: Uint8Array): string => {
  let value = ''
  for (let at = 0; at < bytes.length; at += 32768)
    value += String.fromCharCode(...bytes.subarray(at, at + 32768))
  return btoa(value)
}

export class DesktopHost {
  readonly nativeActions = new NativeActions()
  readonly api: DesktopApi
  private sessions = new Map<string, DesktopWorkbook>()
  private active?: DesktopWorkbook
  private queued?: DesktopWorkbook
  private listeners = new Map<string, Set<Callback>>()
  private transfers = new Map<string, WorkbookSaveRequest['edits']>()
  private ready = false
  private revision = 0
  private pending = 0
  private locale = 'en'
  private importedSource?: { name: string; kind: string }
  private savingRevision?: number
  private opening?: Promise<void>
  private openResolvers = new Map<string, () => void>()
  private runtime?: UniverRuntime
  private runtimeListeners: { dispose(): void }[] = []
  private saveWaiters: { resolve: () => void; reject: (error: unknown) => void }[] = []

  constructor() {
    const methods: Record<string, unknown> = {
      getLanguage: async () => this.locale,
      getTheme: async () => 'system',
      getDocumentTheme: async () => 'follow',
      getAutoSaveDefault: async () => ({ on: false, updatedAt: 0 }),
      getAiPanelPrefs: async () => ({
        side: 'left',
        fontSize: 'default',
        customFontSize: 14,
        spellcheck: true,
        openInNewDocs: false,
        showAiSidebar: false,
      }),
      fontFamilyInfo: async () => [],
      getUserDisplayName: async () => '',
      getAiSettings: async () => normalizeAiSettings(undefined),
      aiToolCapabilities: async () =>
        Object.fromEntries(
          ['webSearch', 'imageSearch', 'imageGeneration', 'imageAnalysis', 'videoAnalysis'].map(
            (key) => [
              key,
              {
                available: false,
                route: null,
                provider: null,
                message: 'Unavailable offline on iPad.',
              },
            ],
          ),
        ),
      aiSubscription: {
        statuses: async () => checkingSubscriptionStatuses(),
        recheck: async () => checkingSubscriptionStatuses(),
        onChanged: () => () => {},
        login: async () => {
          throw new Error('Claude/Codex process execution is not available on iPad.')
        },
      },
      hasQueuedWorkbook: async () => !!this.queued,
      consumeNewBlankWorkbook: async () => false,
      consumeHeadlessExport: async () => null,
      selectWorkbook: async () => {
        const selected = this.queued
        if (!selected) throw new Error('Open a workbook from the document library.')
        this.queued = undefined
        this.active = selected
        return selected.file
      },
      reopenWorkbook: async () => this.active?.file ?? null,
      closeWorkbook: async (sessionId: string) => {
        const session = this.sessions.get(sessionId)
        if (session && session !== this.active && session !== this.queued) {
          session.book.close()
          this.sessions.delete(sessionId)
        }
      },
      readWorkbookRange: async (request: Parameters<DesktopApi['readWorkbookRange']>[0]) =>
        this.session(request.sessionId).read(request),
      readWorkbookMedia: async (request: Parameters<DesktopApi['readWorkbookMedia']>[0]) =>
        this.session(request.sessionId).readMedia(request.visualId),
      readWorkbookQueries: async (request: Parameters<DesktopApi['readWorkbookQueries']>[0]) =>
        listWorkbookQueries(
          (path) =>
            this.session(request.sessionId).zip.file(path)?.async('string') ??
            Promise.resolve(undefined),
        ),
      readPivotDefinition: async (request: Parameters<DesktopApi['readPivotDefinition']>[0]) => {
        const zip = this.session(request.sessionId).zip
        const [pivot, cache] = await Promise.all([
          zip.file(request.path)?.async('string'),
          zip.file(request.cachePath)?.async('string'),
        ])
        if (!pivot || !cache) throw new Error('The pivot definition or cache is missing.')
        return parsePivotDefinition(pivot, cache)
      },
      readWorkbookFormulas: async (request: Parameters<DesktopApi['readWorkbookFormulas']>[0]) => ({
        cells: this.session(request.sessionId)
          .fullRange(request.sheetId)
          .cells.filter((cell) => cell.formula),
        sharedGroups: [],
        indexingComplete: true,
        truncated: false,
      }),
      readWorkbookRowOutline: async (
        request: Parameters<DesktopApi['readWorkbookRowOutline']>[0],
      ) => ({
        rows: this.session(request.sessionId)
          .fullRange(request.sheetId)
          .rows.filter((row) => row.outlineLevel || row.collapsed)
          .map((row) => ({
            row: row.row,
            level: row.outlineLevel ?? 0,
            collapsed: row.collapsed,
            hidden: row.hidden,
          })),
        indexingComplete: true,
      }),
      findWorkbookCells: async (request: WorkbookFindCellsRequest) => this.find(request),
      recalcWorkbook: async (request: WorkbookRecalcRequest) => this.recalculate(request),
      saveWorkbookEdits: async (request: WorkbookSaveRequest) => this.save(request),
      workbookTemplateBytes: async (request: WorkbookSaveRequest) => ({
        ok: true,
        bytes: await saveDesktopWorkbook(this.session(request.sessionId), request),
      }),
      beginSaveEditsTransfer: async (request: WorkbookSaveEditsBegin) => {
        this.transfers.set(request.transferId, [])
      },
      sendSaveEditsChunk: async (request: WorkbookSaveEditsChunk) => {
        const transfer = this.transfers.get(request.transferId)
        if (!transfer) throw new Error('Unknown save transfer.')
        transfer.push(...JSON.parse(request.editsJson))
      },
      abortSaveEditsTransfer: async (request: WorkbookSaveEditsAbort) => {
        this.transfers.delete(request.transferId)
      },
      notifyPendingEdits: (count: number) => {
        const previous = this.pending
        this.pending = count
        if (count > 0 && count !== previous) this.dirty(this.editing())
      },
      signalMcpReady: () => {},
      reportMcpResult: () => {},
      onMenuAction: (callback: Callback) => {
        const off = this.on('onMenuAction', callback)
        if (!this.ready) {
          this.ready = true
          setTimeout(() => post({ type: 'ready', kind: 'xlsx', renderer: 'desktop-univer' }), 0)
        }
        return off
      },
      openExternal: async (url: string) => {
        post({ type: 'openExternal', url })
      },
      listPrinters: async () => [],
      printWorkbook: async (request: Parameters<DesktopApi['printWorkbook']>[0]) => ({
        ok: await this.nativeActions.request('printPages', {
          name: request.fileName,
          pages: nativePrintPages(request.html),
        }),
      }),
      exportPdf: async (request: Parameters<DesktopApi['exportPdf']>[0]) =>
        (await this.nativeActions.request('exportPDF', {
          name: request.fileName,
          pages: nativePrintPages(request.html),
        }))
          ? { canceled: false, path: request.fileName }
          : { canceled: true },
      exportCsv: async (request: Parameters<DesktopApi['exportCsv']>[0]) =>
        (await this.nativeActions.request('exportFile', {
          name: request.fileName,
          base64: base64(new TextEncoder().encode(request.content)),
          mimeType: 'text/csv',
        }))
          ? { canceled: false, path: request.fileName }
          : { canceled: true },
      getPathForFile: (file: File) => {
        throw new Error(`Import ${file.name} through the document library.`)
      },
    }
    this.api = new Proxy(methods, {
      get: (target, name: string) => {
        if (name in target) return target[name]
        if (name.startsWith('on')) return (callback: Callback) => this.on(name, callback)
        return async () => {
          throw new Error(`The iPad host has not implemented ${name}. Your workbook is unchanged.`)
        }
      },
    }) as unknown as DesktopApi
    document.addEventListener(
      'input',
      (event) => {
        const target = event.target
        if (target instanceof HTMLElement && target.closest('#univer-container')) this.dirty(true)
      },
      true,
    )
  }

  private on(name: string, callback: Callback): () => void {
    const list = this.listeners.get(name) ?? new Set()
    list.add(callback)
    this.listeners.set(name, list)
    return () => {
      list.delete(callback)
    }
  }
  private emit(name: string, ...values: unknown[]): void {
    for (const callback of this.listeners.get(name) ?? []) callback(...values)
  }
  private session(id: string): DesktopWorkbook {
    const result = this.sessions.get(id)
    if (!result) throw new Error('Unknown workbook session.')
    return result
  }
  private dirty(draft: boolean): void {
    this.revision++
    post({ type: 'changed', dirty: true, draft, revision: this.revision })
  }
  private showIssues(workbook: DesktopWorkbook): void {
    const issues = [
      ...(this.importedSource
        ? [
            `${this.importedSource.name} was imported as a spreadsheet. Saving creates a separate XLSX copy; the original file stays unchanged. Values, supported formulas and dates are imported; advanced legacy formatting and drawings remain in the original.`,
          ]
        : []),
      ...workbook.book.calculationIssues,
      ...workbook.unsupported,
    ]
    let banner = document.querySelector<HTMLElement>('#ipad-compatibility')
    if (!banner) {
      banner = document.createElement('div')
      banner.id = 'ipad-compatibility'
      banner.setAttribute('role', 'status')
      document.body.append(banner)
    }
    banner.hidden = !issues.length
    banner.textContent = issues.length
      ? `Some workbook features could not be fully loaded or recalculated. Cached results may be stale. ${issues.join(' · ')}`
      : ''
    document.body.classList.toggle('ipad-has-issues', !!issues.length)
  }
  private editing(): boolean {
    return (
      (
        this.runtime?.univerAPI.getActiveWorkbook() as ActiveCellEditor | undefined
      )?.isCellEditing() ?? false
    )
  }

  bindRuntime(runtime: UniverRuntime | null): void {
    for (const listener of this.runtimeListeners) listener.dispose()
    this.runtimeListeners = []
    this.runtime = runtime ?? undefined
    if (!runtime) return
    this.runtimeListeners.push(
      runtime.univerAPI.addEvent(runtime.univerAPI.Event.CommandExecuted, (event) => {
        if (
          !this.active ||
          journalSuppression.active ||
          !event.id.includes('mutation') ||
          /formula-calculation|set-formula/.test(event.id)
        )
          return
        this.dirty(this.editing())
      }),
    )
    this.runtimeListeners.push(
      runtime.univerAPI.addEvent(runtime.univerAPI.Event.SheetEditStarted, () => {
        if (this.active) this.dirty(true)
      }),
    )
    this.runtimeListeners.push(
      runtime.univerAPI.addEvent(runtime.univerAPI.Event.SheetEditEnded, () => {
        if (this.active && this.pending > 0) this.dirty(false)
      }),
    )
  }

  workbookReady(sessionId: string): void {
    this.openResolvers.get(sessionId)?.()
    this.openResolvers.delete(sessionId)
  }

  saveStarted(mode: string): void {
    if (mode === 'save' || mode === 'save-as') this.savingRevision = this.revision
  }

  saveCompleted(mode: string, outcome: { ok: boolean; error?: string }): void {
    if (mode !== 'save' && mode !== 'save-as') return
    if (!outcome.ok || !this.active) {
      const error = new Error(outcome.error ?? 'The workbook could not be saved.')
      post({ type: 'error', message: error.message })
      for (const waiter of this.saveWaiters.splice(0)) waiter.reject(error)
    } else {
      void this.persist(this.active, this.savingRevision ?? this.revision)
    }
    this.savingRevision = undefined
  }

  private async persist(workbook: DesktopWorkbook, revision: number): Promise<void> {
    try {
      if (this.importedSource) {
        const created = await this.nativeActions.request('importCopy', {
          name: workbook.file.name,
          kind: 'xlsx',
          base64: base64(workbook.bytes),
          revision,
          conversionSave: true,
        })
        if (!created) {
          if (this.revision > revision) return
          throw new Error('The converted XLSX copy could not be saved.')
        }
      } else
        post({
          type: 'save',
          name: workbook.file.name,
          kind: 'xlsx',
          base64: base64(workbook.bytes),
          revision,
        })
      for (const waiter of this.saveWaiters.splice(0)) waiter.resolve()
    } catch (error) {
      post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
      for (const waiter of this.saveWaiters.splice(0)) waiter.reject(error)
    }
  }

  async open(document: {
    name: string
    base64: string
    kind: string
    locale?: string
  }): Promise<void> {
    try {
      if (document.base64.length > Math.ceil((32 * 1024 * 1024) / 3) * 4)
        throw new Error('The workbook exceeds the 32 MB iPad limit.')
      this.locale = document.locale ?? 'en'
      const raw = atob(document.base64)
      const imported = await importWorkbook(
        Uint8Array.from(raw, (c) => c.charCodeAt(0)),
        document.name,
        document.kind,
      )
      this.importedSource = imported.converted
        ? { name: document.name, kind: imported.sourceKind }
        : undefined
      const selected = await DesktopWorkbook.open(imported.bytes, imported.name)
      this.sessions.set(selected.file.sessionId, selected)
      this.showIssues(selected)
      this.queued = selected
      this.pending = 0
      this.revision = 0
      this.emit('onLanguageChanged', this.locale)
      this.opening = new Promise<void>((resolve) =>
        this.openResolvers.set(selected.file.sessionId, resolve),
      )
      this.emit('onMenuAction', 'open' satisfies MenuAction)
      await this.opening
      post({ type: 'opened', name: document.name, revision: 0 })
    } catch (error) {
      post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  async requestSave(): Promise<void> {
    await this.opening
    if (!this.active) throw new Error('No workbook is open.')
    if (
      !(await commitActiveCellEditor(
        this.runtime?.univerAPI.getActiveWorkbook() as ActiveCellEditor | undefined,
      ))
    ) {
      post({ type: 'error', message: 'Finish or correct the active cell before saving.' })
      return
    }
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
    if (!this.pending && !this.editing()) {
      await this.persist(this.active, this.revision)
      return
    }
    const promise = new Promise<void>((resolve, reject) =>
      this.saveWaiters.push({ resolve, reject }),
    )
    this.emit('onMenuAction', 'save' satisfies MenuAction)
    return promise
  }

  private async save(
    request: WorkbookSaveRequest,
  ): Promise<Awaited<ReturnType<DesktopApi['saveWorkbookEdits']>>> {
    if (request.editsTransferId) {
      const edits = this.transfers.get(request.editsTransferId)
      if (!edits) throw new Error('Missing save edits transfer.')
      request = { ...request, edits }
      this.transfers.delete(request.editsTransferId!)
    }
    const source = this.session(request.sessionId)
    const bytes = await saveDesktopWorkbook(source, request)
    const reopened = await DesktopWorkbook.open(bytes, source.file.name)
    this.sessions.set(reopened.file.sessionId, reopened)
    this.active = reopened
    this.showIssues(reopened)
    return { canceled: false, file: reopened.file, touchedEntries: [] }
  }

  private recalculate(
    request: WorkbookRecalcRequest,
  ): Awaited<ReturnType<DesktopApi['recalcWorkbook']>> {
    const source = this.session(request.sessionId),
      engine = FormulaEngine.open(source.bytes)
    if (!engine) throw new Error('IronCalc is unavailable.')
    try {
      for (const edit of request.edits) {
        const index = source.file.sheets.findIndex((s) => s.id === edit.sheetId)
        if (index < 0) throw new Error(`Unknown worksheet ${edit.sheetId}`)
        engine.model.setUserInput(index, edit.row + 1, edit.column + 1, edit.input)
      }
      const calculated = engine.calculate(true),
        cells: Awaited<ReturnType<DesktopApi['recalcWorkbook']>>['cells'] = []
      for (const read of request.reads) {
        const index = source.file.sheets.findIndex((s) => s.id === read.sheetId)
        const values = new Map(calculated.get(index)?.map((c) => [c.ref, c]))
        for (let row = read.range.startRow; row <= read.range.endRow; row++)
          for (let column = read.range.startColumn; column <= read.range.endColumn; column++) {
            const point = source
              .fullRange(read.sheetId)
              .cells.find((c) => c.row === row && c.column === column)
            const input = engine.model.getCellContent(index, row + 1, column + 1)
            const formatted = engine.model.getFormattedCellValue(index, row + 1, column + 1)
            const calculatedCell = values.get(address(column + 1, row + 1))
            const type = engine.model.getCellType(index, row + 1, column + 1)
            cells.push({
              sheetId: read.sheetId,
              row,
              column,
              formatted,
              isFormula: input.startsWith('='),
              isError: type === 16,
              ...(type === 1
                ? { number: Number(calculatedCell?.value ?? point?.value ?? formatted) }
                : {}),
            })
          }
      }
      return { cells }
    } finally {
      engine.close()
    }
  }

  private find(
    request: WorkbookFindCellsRequest,
  ): Awaited<ReturnType<DesktopApi['findWorkbookCells']>> {
    const source = this.session(request.sessionId),
      matches: Awaited<ReturnType<DesktopApi['findWorkbookCells']>>['matches'] = []
    const query = request.matchCase ? request.query : request.query.toLocaleLowerCase()
    for (const sheet of source.file.sheets) {
      if (request.sheetId && sheet.id !== request.sheetId) continue
      for (const cell of source.fullRange(sheet.id).cells) {
        const value =
          request.lookIn === 'formulas' || request.lookIn === 'formulas_only'
            ? (cell.formula ?? '')
            : String(cell.value ?? '')
        const text = request.matchCase ? value : value.toLocaleLowerCase()
        if (request.matchEntireCell ? text === query : text.includes(query))
          matches.push({
            sheetId: sheet.id,
            row: cell.row,
            column: cell.column,
            value: cell.value,
            valueText: String(cell.value ?? ''),
            formulaText: cell.formula,
          })
      }
    }
    return {
      matches: matches.slice(0, request.limit),
      complete: matches.length <= request.limit,
      indexingComplete: true,
    }
  }
}
