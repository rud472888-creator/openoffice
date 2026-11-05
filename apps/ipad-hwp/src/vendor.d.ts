declare module 'pako' {
  const pako: {
    deflateRaw(bytes: Uint8Array): Uint8Array
    Inflate: new (options: { raw: boolean; chunkSize: number }) => {
      onData: (bytes: Uint8Array) => void
      push(bytes: Uint8Array, final: boolean): void
      err: number
      msg: string
    }
  }
  export default pako
}
