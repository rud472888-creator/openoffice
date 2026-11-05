import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { blankWorkbook } from '../src/template'

const directory = new URL('../../ipad/EveryOffice/Resources/Templates/', import.meta.url)
await mkdir(fileURLToPath(directory), { recursive: true })
await writeFile(new URL('Blank.xlsx', directory), await blankWorkbook())
