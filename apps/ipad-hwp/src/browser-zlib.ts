import pako from 'pako'
import CRC32 from 'crc-32'
import { Buffer } from 'buffer'

const MAX_STREAM_BYTES = 64 * 1024 * 1024

/** Bound each inflated stream before allocating the complete result. */
export function inflateRawSync(bytes: Uint8Array): Buffer {
  const chunks: Uint8Array[] = []
  let size = 0
  const inflater = new pako.Inflate({ raw: true, chunkSize: 64 * 1024 })
  inflater.onData = (chunk: Uint8Array) => {
    size += chunk.length
    if (size > MAX_STREAM_BYTES) throw new Error('HWP stream exceeds memory limit')
    chunks.push(chunk)
  }
  inflater.push(bytes, true)
  if (inflater.err) throw new Error(inflater.msg || 'Invalid compressed HWP stream')
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    size,
  )
}

export function deflateRawSync(bytes: Uint8Array): Buffer {
  return Buffer.from(pako.deflateRaw(bytes))
}

export function crc32(bytes: Uint8Array, value = 0): number {
  return CRC32.buf(bytes, value) >>> 0
}
