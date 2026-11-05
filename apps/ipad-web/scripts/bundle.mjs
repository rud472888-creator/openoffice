import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const script = (await readFile(new URL('dist/editor.js', root), 'utf8')).replace(
  /<\/script/gi,
  '<\\/script',
)
const style = await readFile(new URL('dist/ipad-web.css', root), 'utf8')
const output = new URL('../../ipad/EveryOffice/Resources/DocumentEditor/', import.meta.url)
await mkdir(output, { recursive: true })
await writeFile(
  new URL('index.html', output),
  `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; font-src data:; base-uri 'none'; form-action 'none'"><title>Document</title><style>${style}</style></head><body><div id="app"></div><script>${script}</script></body></html>`,
)
console.log(`Bundled offline editor: ${fileURLToPath(new URL('index.html', output))}`)
