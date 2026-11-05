// A module-local UTF-8 writer for the desktop notes/comments XML mutations.
// No Node global is installed, and binary Buffer APIs are deliberately absent.
export const Buffer = {
  from(value: string, encoding = 'utf8'): Uint8Array {
    if (typeof value !== 'string' || encoding !== 'utf8')
      throw new Error('Unsupported XML byte conversion')
    return new TextEncoder().encode(value)
  },
}
