import { beforeAll, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import init, { HwpDocument } from '@rhwp/core'
import { convertHwpSnapshot } from '../src/convert'

beforeAll(async () => {
  await init({
    module_or_path: readFileSync(
      new URL('../../../vendor/rhwp-core/rhwp_bg.wasm', import.meta.url),
    ),
  })
})
it('converts a separate HWPX copy and reopens it as HWP without changing the original snapshot', async () => {
  const original = new Uint8Array(
    readFileSync(new URL('../../hwp/src/renderer/assets/blank.hwp', import.meta.url)),
  )
  const before = original.slice()
  const hwpx = await convertHwpSnapshot(original, 'hwpx')
  expect(Array.from(hwpx.slice(0, 2))).toEqual([0x50, 0x4b])
  const hwp = await convertHwpSnapshot(hwpx, 'hwp')
  expect(Array.from(hwp.slice(0, 4))).toEqual([0xd0, 0xcf, 0x11, 0xe0])
  expect(original).toEqual(before)
  const restored = new HwpDocument(hwp)
  try {
    expect(restored.pageCount()).toBe(1)
  } finally {
    restored.free()
  }
})
