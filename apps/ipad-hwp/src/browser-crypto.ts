import { sha1 } from '@noble/hashes/legacy.js'
import { bytesToHex, concatBytes } from '@noble/hashes/utils.js'

/** Only the desktop preservation adapters' SHA-1 identity operation is exposed. */
export function createHash(algorithm: string) {
  if (algorithm !== 'sha1') throw new Error('Unsupported preservation digest')
  const chunks: Uint8Array[] = []
  return {
    update(bytes: Uint8Array) {
      chunks.push(new Uint8Array(bytes))
      return this
    },
    digest(encoding: string) {
      if (encoding !== 'hex') throw new Error('Unsupported digest encoding')
      return bytesToHex(sha1(concatBytes(...chunks)))
    },
  }
}
