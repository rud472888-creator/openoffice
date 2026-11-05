import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { Script } from 'node:vm'
const script = await readFile('dist/editor.js', 'utf8')
new Script(script)
const css = await readFile('dist/ipad-markdown.css', 'utf8')
const output = '../ipad/EveryOffice/Resources/MarkdownEditor'
await mkdir(output, { recursive: true })
await writeFile(
  `${output}/index.html`,
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'unsafe-inline';style-src 'unsafe-inline';img-src data: blob:;font-src data: blob:;connect-src 'none';base-uri 'none';form-action 'none'"><title>Markdown</title><style>${css}</style></head><body><div id="app"></div><script>${script.replace(/<\/script/gi, '<\\/script')}</script></body></html>`,
)
