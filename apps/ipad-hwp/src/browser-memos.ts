import init, { HwpDocument } from '@rhwp/core'
import wasmUrl from '../../../vendor/rhwp-core/rhwp_bg.wasm?url'
import { assertZipInflatesWithinLimits } from '@genoffice/docx-engine'

let ready: Promise<unknown> | undefined
export async function initializeHwpCore() {
  await (ready ??= init({ module_or_path: wasmUrl }))
}
export async function hwpMemosOf(bytes: Uint8Array) {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) await assertZipInflatesWithinLimits(bytes)
  await initializeHwpCore()
  const document = new HwpDocument(new Uint8Array(bytes))
  try {
    const memos: unknown = JSON.parse(document.getMemoList())
    if (!Array.isArray(memos)) throw new Error('Invalid HWP memo list')
    return memos
  } finally {
    document.free()
  }
}
