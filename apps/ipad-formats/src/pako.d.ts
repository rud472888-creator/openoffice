declare module 'pako' {
  class _Inflate {
    constructor(options?: { raw?: boolean; chunkSize?: number })
    err: number
    msg: string
    onData(chunk: Uint8Array): void
    push(bytes: Uint8Array, final: boolean): boolean
  }
  const pako: { Inflate: typeof _Inflate }
  export default pako
}
