import { HwpDocument } from '@rhwp/core'
import { assertZipInflatesWithinLimits } from '@genoffice/docx-engine'
import { bytesMatchFormat } from '../../hwp/src/main/save-plan'
import type { HwpFormat } from '../../hwp/src/shared/ipc'

/** Convert a verified snapshot into a separate file; never replaces the opened source. */
export async function convertHwpSnapshot(original: Uint8Array, format: HwpFormat) {
  if (original.byteLength > 32 * 1024 * 1024) throw new Error('Document too large')
  if (original[0] === 0x50 && original[1] === 0x4b) await assertZipInflatesWithinLimits(original)
  const document = new HwpDocument(new Uint8Array(original))
  try {
    const text = document.getTextFileText()
    const memos = JSON.parse(document.getMemoList()) as unknown[]
    const result =
      format === 'hwp' ? document.exportHwpWithReport() : document.exportHwpxWithReport()
    let bytes: Uint8Array
    try {
      const report = JSON.parse(result.contentLoss())
      if (
        report?.schemaVersion !== 1 ||
        report.outputFormat !== format ||
        report.count !== 0 ||
        !Array.isArray(report.losses) ||
        report.losses.length !== 0
      )
        throw new Error('The engine reported content loss during conversion')
      bytes = result.takeBytes()
    } finally {
      result.free()
    }
    if (bytes.byteLength > 32 * 1024 * 1024 || !bytesMatchFormat(bytes, format))
      throw new Error('Invalid converted document')
    if (format === 'hwpx') await assertZipInflatesWithinLimits(bytes)
    const reopened = new HwpDocument(bytes)
    try {
      const savedMemos = JSON.parse(reopened.getMemoList()) as unknown[]
      if (reopened.getTextFileText() !== text || savedMemos.length !== memos.length)
        throw new Error('Converted document did not preserve text or memos')
    } finally {
      reopened.free()
    }
    return bytes
  } finally {
    document.free()
  }
}
