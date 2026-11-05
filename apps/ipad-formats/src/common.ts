import type { PrintPage } from './export'
import { label as localLabel } from './labels'
import { assertZipInflatesWithinLimits } from '@genoffice/zip-gate'

export const LIMITS = {
  maxParts: 5000,
  maxPartBytes: 16 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
}
export const MAX_INPUT = 32 * 1024 * 1024
export interface EditorView {
  save(): Promise<Uint8Array>
  dispose(): void
}
export interface EditorHost {
  root: HTMLElement
  language: string
  name: string
  readingState?: unknown
  updateReadingState(state: unknown): void
  exportFile(extension: string, bytes: Uint8Array): Promise<void>
  exportPages(type: 'exportPDF' | 'printPages', pages: PrintPage[]): Promise<void>
  changed(draft?: boolean): void
  error(error: unknown): void
}

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (text !== undefined) node.textContent = text
  return node
}

export function button(
  label: string,
  action: () => unknown | Promise<unknown>,
  host: EditorHost,
): HTMLButtonElement {
  const node = element('button', localLabel(label, host.language))
  node.type = 'button'
  node.addEventListener('click', () => {
    try {
      void Promise.resolve(action()).catch(host.error)
    } catch (error) {
      host.error(error)
    }
  })
  return node
}

export function assertText(text: string): void {
  if (text.length > 8 * 1024 * 1024) throw new Error('Text exceeds the 8 MB editing limit.')
  for (const character of text) {
    const code = character.codePointAt(0)!
    if (
      (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
      code === 0xfffe ||
      code === 0xffff ||
      (code >= 0xd800 && code <= 0xdfff)
    )
      throw new Error('This text contains an invalid document character.')
  }
}

export async function boundedArchive(bytes: Uint8Array): Promise<void> {
  if (bytes.length > MAX_INPUT) throw new Error('The document exceeds the 32 MB iPad limit.')
  await assertZipInflatesWithinLimits(bytes, LIMITS)
}

/** Native WKWebView has no default JavaScript prompt delegate. Use a real modal. */
export function ask(title: string, value: string, host: EditorHost): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = element('dialog')
    const label = element('label', localLabel(title, host.language))
    const input = element('textarea')
    input.value = value
    label.append(input)
    const finish = (answer: string | null) => {
      dialog.close()
      dialog.remove()
      resolve(answer)
    }
    dialog.append(
      label,
      button('Apply', () => finish(input.value), host),
      button('Cancel', () => finish(null), host),
    )
    dialog.addEventListener(
      'cancel',
      () => {
        dialog.remove()
        resolve(null)
      },
      { once: true },
    )
    document.body.append(dialog)
    dialog.showModal()
    input.focus()
  })
}
