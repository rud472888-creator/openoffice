import { assertZipInflatesWithinLimits } from '@genoffice/docx-engine'
import { sectionTailsOf } from '../../hwp/src/main/section-tails'
import { fieldKindsOf } from '../../hwp/src/main/field-kinds'
import { applySaveFixes } from '../../hwp/src/main/save-fixes'
import { hasTrackedChanges } from '../../hwp/src/main/tracked-changes'
import { bytesMatchFormat } from '../../hwp/src/main/save-plan'
import { newTabsOf, hwpxMemoCountOf } from '../../hwp/src/main/tab-widths'
import { lostMemoCountOf } from '../../hwp/src/main/memos'
import type { SaveBase } from '../../hwp/src/main/save-fixes'
import type { SaveEditorPort } from '../../hwp/src/renderer/save-flow'
import type { HwpFormat } from '../../hwp/src/shared/ipc'

export class SaveRefused extends Error {
  constructor(public readonly reason: 'saveProtected' | 'saveTracked' | 'saveVerifyFailed') {
    super(reason)
  }
}

/** Runs the same desktop repairs before releasing any bytes to the native writer. */
export class HwpSession {
  private constructor(
    readonly original: Uint8Array,
    readonly format: HwpFormat,
    private readonly base: SaveBase,
    readonly tracked: boolean,
  ) {}

  static async open(bytes: Uint8Array, format: HwpFormat) {
    if (bytes.length > 32 * 1024 * 1024 || !bytesMatchFormat(bytes, format)) {
      throw new Error('Invalid HWP document')
    }
    if (format === 'hwpx') await assertZipInflatesWithinLimits(bytes)
    const tails = format === 'hwp' ? sectionTailsOf(bytes) : null
    const kinds = format === 'hwp' ? fieldKindsOf(bytes) : null
    return new HwpSession(
      new Uint8Array(bytes),
      format,
      {
        ...(tails ? { tails } : {}),
        ...(kinds ? { kinds } : {}),
      },
      format === 'hwp' && hasTrackedChanges(bytes),
    )
  }

  async save(editor: SaveEditorPort, changed: boolean): Promise<Uint8Array> {
    if (!changed) return new Uint8Array(this.original)
    if (this.tracked) throw new SaveRefused('saveTracked')
    if (await editor.isPasswordProtected()) throw new SaveRefused('saveProtected')
    await editor.setMemoLock(true)
    try {
      if (this.format === 'hwp') {
        const verified = await editor.exportHwpVerify()
        if (!verified.recovered || verified.pageCountBefore !== verified.pageCountAfter) {
          throw new SaveRefused('saveVerifyFailed')
        }
      }
      const memos = this.format === 'hwpx' ? await editor.listMemos() : null
      const bytes = this.format === 'hwp' ? await editor.exportHwp() : await editor.exportHwpx()
      if (!bytesMatchFormat(bytes, this.format) || bytes.length > 32 * 1024 * 1024) {
        throw new SaveRefused('saveVerifyFailed')
      }
      if (this.format === 'hwpx') await assertZipInflatesWithinLimits(bytes)
      const spots = newTabsOf(bytes, this.format)
      const measures = spots.length ? await editor.measureTabs(spots) : []
      const tabs = spots.flatMap((spot, index) =>
        measures[index] ? [{ ...spot, ...measures[index]! }] : [],
      )
      const fixed = applySaveFixes(bytes, this.format, tabs, this.base)
      if (fixed.tailsSkipped) throw new SaveRefused('saveVerifyFailed')
      if (this.format === 'hwpx') {
        // Unlike desktop's warning-after-save, automatic mobile writes refuse known loss.
        const before = hwpxMemoCountOf(this.original)
        const after = hwpxMemoCountOf(fixed.bytes)
        if (before === null || after === null || (before > after && !memos)) {
          throw new SaveRefused('saveVerifyFailed')
        }
        const lost = await lostMemoCountOf({ saved: fixed.bytes, original: this.original, memos })
        if (lost) throw new SaveRefused('saveVerifyFailed')
      }
      return fixed.bytes
    } finally {
      await editor.setMemoLock(false)
    }
  }
}
