import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises'
import JSZip from 'jszip'

const vendor = new URL('../../../vendor/deckcraft/', import.meta.url)
const root = new URL('../../ipad/EveryOffice/Resources/PresentationEditor/', import.meta.url)
const archive = await readFile(new URL('runtime.zip', vendor))
if (
  createHash('sha256').update(archive).digest('hex') !==
  (await readFile(new URL('runtime.sha256', vendor), 'utf8')).trim()
)
  throw new Error('Unexpected DeckCraft runtime')
const files = await JSZip.loadAsync(archive, { checkCRC32: true })
await rm(root, { recursive: true, force: true })
const runtime = new URL('deckcraft/', root)
await mkdir(runtime, { recursive: true })
for (const entry of Object.values(files.files)) {
  if (entry.dir) continue
  const target = new URL(entry.name, runtime)
  if (!target.href.startsWith(runtime.href)) throw new Error('Invalid DeckCraft asset path')
  await mkdir(new URL('.', target), { recursive: true })
  await writeFile(target, await entry.async('nodebuffer'))
}
for (const file of ['index.html', 'NOTICE', 'ATTRIBUTION.md', 'LICENSE-APACHE', 'LICENSE-MIT'])
  await cp(new URL(file, vendor), new URL(file, runtime))
await cp(new URL('../dist/editor.js', import.meta.url), new URL('editor.js', root))
await cp(new URL('../dist/ipad-slides.css', import.meta.url), new URL('editor.css', root))
await writeFile(
  new URL('index.html', root),
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'"><link rel="stylesheet" href="editor.css"><title>DeckCraft</title></head><body><div id="app"></div><p role="alert" id="error"></p><script src="editor.js"></script></body></html>`,
)
