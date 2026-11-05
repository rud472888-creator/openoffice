import { createRoot, type Root } from 'react-dom/client'
import { normalizeLang } from '@genoffice/i18n'
import { DocCheckPanel } from '../../hwp/src/renderer/check/DocCheckPanel'
import { LocaleProvider } from '../../hwp/src/renderer/i18n/locale'
import type { AgentBridge } from '../../hwp/src/renderer/ai/agent-bridge'
import type { HwpApi, HwpFormat } from '../../hwp/src/shared/ipc'
import '../../hwp/src/renderer/styles.css'

declare global {
  interface Window {
    hwpApi: HwpApi
  }
}

/** Only the locale subscription used by the shared panel is exposed by this host. */
const listeners = new Set<(language: ReturnType<typeof normalizeLang>) => void>()
Object.defineProperty(window, 'hwpApi', {
  configurable: true,
  value: {
    onLanguageChanged(listener: (language: ReturnType<typeof normalizeLang>) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  },
})
let root: Root | undefined
let container: HTMLElement | undefined
export function closeDocumentCheck() {
  root?.unmount()
  root = undefined
  container?.remove()
  container = undefined
}
export function toggleDocumentCheck(bridge: AgentBridge, format: HwpFormat, language: string) {
  if (root) return closeDocumentCheck()
  container = document.createElement('div')
  container.id = 'document-check-host'
  document.body.append(container)
  root = createRoot(container)
  root.render(
    <LocaleProvider initial={normalizeLang(language)}>
      <DocCheckPanel bridge={bridge} format={format} onClose={closeDocumentCheck} />
    </LocaleProvider>,
  )
}
