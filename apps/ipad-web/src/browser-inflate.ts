import pako from 'pako'

/** The one Node-only operation in doc2docx: bounded zlib metafile inflation. */
export function inflateSync(bytes: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = []
  let total = 0
  const inflater = new pako.Inflate({ windowBits: 15, chunkSize: 32768 })
  inflater.onData = (chunk: Uint8Array) => {
    total += chunk.length
    if (total > 16 * 1024 * 1024)
      throw new Error('Metafile exceeds the mobile expanded-image limit')
    chunks.push(chunk.slice())
  }
  inflater.push(bytes, true)
  if (inflater.err) throw new Error(inflater.msg || 'Invalid compressed metafile')
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}
