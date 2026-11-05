import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { buildBlankDocx } from '@genoffice/docx-engine'

const output = new URL('../../ipad/EveryOffice/Resources/Templates/', import.meta.url)
await mkdir(output, { recursive: true })
const template = new URL('Blank.docx', output)
const createdAt = new Date('2000-01-01T00:00:00.000Z')
const zip = await JSZip.loadAsync(await buildBlankDocx({ createdAt }))
// Keep the bundled template reproducible across rebuilds.
for (const file of Object.values(zip.files)) file.date = createdAt
await writeFile(template, await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }))
console.log(`Generated document template: ${fileURLToPath(template)}`)
