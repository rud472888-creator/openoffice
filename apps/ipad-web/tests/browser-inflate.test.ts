import { deflateSync, inflateSync as nativeInflate } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { inflateSync } from '../src/browser-inflate'

describe('browser metafile inflater for the existing DOC importer', () => {
  it('matches the desktop zlib result exactly for valid compressed bytes', () => {
    const original = Uint8Array.from({ length: 100000 }, (_, index) => index % 256)
    const compressed = deflateSync(original)
    expect(inflateSync(compressed)).toEqual(new Uint8Array(nativeInflate(compressed)))
  })
  it('rejects invalid data and bounds expanded metafiles', () => {
    expect(() => inflateSync(new Uint8Array([1, 2, 3]))).toThrow()
    const compressed = deflateSync(new Uint8Array(16 * 1024 * 1024 + 1))
    expect(() => inflateSync(compressed)).toThrow('mobile expanded-image limit')
  })
})
