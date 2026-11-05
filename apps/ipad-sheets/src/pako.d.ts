declare module 'pako' {
  const pako: { inflateRaw(bytes: Uint8Array): Uint8Array }
  export default pako
}
