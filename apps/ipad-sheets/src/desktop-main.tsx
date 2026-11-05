import './buffer-globals'
import type {} from '../../sheets/src/renderer/embedded-runtime'
import ReactDOM from 'react-dom/client'
import { App } from '@ipad/desktop-app'
import { LocaleProvider, setModuleLang } from '../../sheets/src/renderer/i18n/locale'
import { installCanvasFontFallback } from '../../sheets/src/renderer/cell-font-fallback'
import { DesktopHost } from './desktop-host'
import { initializeCalculation } from './calculation'
import { initializeLegacyImporter } from './legacy-import'
import legacyWasmUrl from '../vendor/legacy-import/legacy-import.wasm?url'
import { applyAiPanelPrefs } from '@genoffice/ui'
import wasmUrl from '../vendor/ironcalc-xlsx/wasm_bg.wasm?url'
import '../../../packages/ui/src/tokens.css'
import '@univerjs/preset-sheets-core/lib/index.css'
import '../../sheets/src/renderer/styles.css'
import './desktop.css'

const wasm = atob(wasmUrl.slice(wasmUrl.indexOf(',') + 1))
initializeCalculation(Uint8Array.from(wasm, (c) => c.charCodeAt(0)))
initializeLegacyImporter(
  Uint8Array.from(atob(legacyWasmUrl.slice(legacyWasmUrl.indexOf(',') + 1)), (c) =>
    c.charCodeAt(0),
  ),
)
const host = new DesktopHost()
window.everyOfficeDesktopRuntimeReady = (runtime) => host.bindRuntime(runtime)
window.everyOfficeDesktopWorkbookReady = (id) => host.workbookReady(id)
window.everyOfficeDesktopSaveStarted = (mode) => host.saveStarted(mode)
window.everyOfficeDesktopSaveCompleted = (mode, outcome) => host.saveCompleted(mode, outcome)
Object.defineProperty(window, 'desktopApi', { value: host.api })
window.everyOffice = {
  openDocument: (document) => host.open(document),
  saveDocument: () => host.requestSave(),
  didExport: (id, result) => host.nativeActions.complete(id, result),
}
setModuleLang('en')
installCanvasFontFallback()
applyAiPanelPrefs({
  side: 'left',
  fontSize: 'default',
  customFontSize: 14,
  spellcheck: true,
  openInNewDocs: false,
  showAiSidebar: false,
})
ReactDOM.createRoot(document.querySelector('#app')!).render(
  <LocaleProvider initial="en">
    <App queuedWorkbookAtBoot={false} />
  </LocaleProvider>,
)
