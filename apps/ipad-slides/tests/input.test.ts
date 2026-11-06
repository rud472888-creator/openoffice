import JSZip from 'jszip'
import { describe, it, expect } from 'vitest'
import { inspectPptx } from '../src/input'

async function deck(xml: string, signed = false) {
  const zip = new JSZip()
  zip.file(
    '_rels/.rels',
    '<Relationships><Relationship Type="test/officeDocument" Target="ppt/main.xml"/></Relationships>',
  )
  zip.file('ppt/main.xml', xml)
  if (signed) zip.file('_xmlsignatures/sig1.xml', '<Signature/>')
  return zip.generateAsync({ type: 'uint8array' })
}
describe('DeckCraft input', () => {
  it('recognizes edit restrictions for alternate presentation paths and signed packages', async () => {
    expect(await inspectPptx(await deck('<presentation/>'))).toEqual({ protected: false })
    expect(await inspectPptx(await deck('<presentation><modifyVerifier/></presentation>'))).toEqual(
      { protected: true },
    )
    expect(await inspectPptx(await deck('<presentation/>', true))).toEqual({ protected: true })
  })
  it('rejects encrypted, broken and entity-bearing input before opening it', async () => {
    await expect(inspectPptx(Uint8Array.from([0xd0, 0xcf]))).rejects.toThrow(
      'encryptedPresentation',
    )
    await expect(inspectPptx(Uint8Array.of(1, 2, 3))).rejects.toThrow()
    await expect(inspectPptx(await deck('<!DOCTYPE doc><presentation/>'))).rejects.toThrow(
      'invalidPresentation',
    )
  })
})
