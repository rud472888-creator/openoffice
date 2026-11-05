import { describe, expect, it } from 'vitest'
import {
  deflateRawSync as nodeDeflate,
  inflateRawSync as nodeInflate,
  crc32 as nodeCrc,
} from 'node:zlib'
import { createHash as nodeHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { deflateRawSync, inflateRawSync, crc32 } from '../src/browser-zlib'
import { createHash } from '../src/browser-crypto'
import { HwpSession } from '../src/session'
import type { SaveEditorPort } from '../../hwp/src/renderer/save-flow'

describe('browser preservation primitives', () => {
  const bytes = new TextEncoder().encode('한글 메모와 바탕쪽\t漢字\n'.repeat(4096))
  it('interoperates with desktop raw deflate in both directions', () => {
    expect(new Uint8Array(inflateRawSync(nodeDeflate(bytes)))).toEqual(bytes)
    expect(new Uint8Array(nodeInflate(deflateRawSync(bytes)))).toEqual(bytes)
  })
  it('produces the same stream CRC and record identity hashes', () => {
    expect(crc32(bytes)).toBe(nodeCrc(bytes))
    expect(crc32(bytes, 1234)).toBe(nodeCrc(bytes, 1234))
    expect(
      createHash('sha1').update(bytes.subarray(0, 11)).update(bytes.subarray(11)).digest('hex'),
    ).toBe(nodeHash('sha1').update(bytes).digest('hex'))
  })
  it('rejects corrupt compressed streams', () => {
    expect(() => inflateRawSync(new Uint8Array([255, 255, 255]))).toThrow()
  })
})

describe('HWP mobile save gate', () => {
  const original = new Uint8Array(
    readFileSync(new URL('../../hwp/src/renderer/assets/blank.hwp', import.meta.url)),
  )
  const port = (overrides: Partial<SaveEditorPort> = {}): SaveEditorPort => ({
    isPasswordProtected: async () => false,
    exportHwp: async () => original,
    exportHwpx: async () => original,
    exportHwpVerify: async () => ({ recovered: true, pageCountBefore: 1, pageCountAfter: 1 }),
    listMemos: async () => [],
    setMemoLock: async () => undefined,
    measureTabs: async () => [],
    notifySaved: async () => undefined,
    ...overrides,
  })
  it('returns the exact original without calling export when unchanged', async () => {
    const session = await HwpSession.open(original, 'hwp')
    expect(
      await session.save(
        port({
          exportHwp: async () => {
            throw new Error('must not export')
          },
        }),
        false,
      ),
    ).toEqual(original)
  })
  it('refuses to remove password protection', async () => {
    const session = await HwpSession.open(original, 'hwp')
    await expect(
      session.save(port({ isPasswordProtected: async () => true }), true),
    ).rejects.toThrow('saveProtected')
  })
  it('refuses an engine export which failed to reopen with the same page count', async () => {
    const session = await HwpSession.open(original, 'hwp')
    await expect(
      session.save(
        port({
          exportHwpVerify: async () => ({ recovered: true, pageCountBefore: 2, pageCountAfter: 1 }),
        }),
        true,
      ),
    ).rejects.toThrow('saveVerifyFailed')
  })
  it('releases the editor lock after a failed export', async () => {
    const calls: boolean[] = []
    const session = await HwpSession.open(original, 'hwp')
    await expect(
      session.save(
        port({
          setMemoLock: async (locked) => {
            calls.push(locked)
          },
          exportHwp: async () => {
            throw new Error('export failed')
          },
        }),
        true,
      ),
    ).rejects.toThrow('export failed')
    expect(calls).toEqual([true, false])
  })
  it('requires the file container to match the requested format', async () => {
    await expect(HwpSession.open(original, 'hwpx')).rejects.toThrow('Invalid HWP document')
  })
})
