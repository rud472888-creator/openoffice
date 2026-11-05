import { sha256 } from '@noble/hashes/sha2.js'
import { Buffer } from 'buffer'

export function createHash(algorithm: string) {
  if (algorithm !== 'sha256') throw new Error(`Unsupported digest: ${algorithm}`)
  const digest = sha256.create()
  return {
    update(value: string | Uint8Array) {
      digest.update(typeof value === 'string' ? new TextEncoder().encode(value) : value)
      return this
    },
    digest(encoding?: string) {
      const result = Buffer.from(digest.digest())
      return encoding === 'hex' ? result.toString('hex') : result
    },
  }
}
export const randomUUID = (): string => crypto.randomUUID()
export const webcrypto = globalThis.crypto
const forbidden = (): never => {
  throw new Error('Filesystem access is unavailable in the offline iPad editor.')
}
export const closeSync = forbidden,
  fsyncSync = forbidden,
  openSync = forbidden,
  readFileSync = forbidden,
  writeFileSync = forbidden,
  writeSync = forbidden,
  copyFile = forbidden,
  mkdir = forbidden,
  mkdtemp = forbidden,
  rename = forbidden,
  rm = forbidden,
  stat = forbidden,
  unlink = forbidden
export const tmpdir = (): string => '/tmp'
export const dirname = (path: string): string => path.slice(0, path.lastIndexOf('/')) || '/'
export const basename = (path: string): string => path.split('/').pop() ?? ''
export const extname = (path: string): string => {
  const name = basename(path)
  return name.includes('.') ? name.slice(name.lastIndexOf('.')) : ''
}
export const join = (...parts: string[]): string => parts.join('/').replace(/\/+/g, '/')
