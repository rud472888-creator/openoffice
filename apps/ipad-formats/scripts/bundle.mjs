import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { Script } from 'node:vm'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const script = await readFile(new URL('dist/editor.iife.js', root), 'utf8')
const style = await readFile(new URL('dist/editor.css', root), 'utf8')
new Script(script)
const output = new URL('../../ipad/EveryOffice/Resources/FormatsEditor/', import.meta.url)
await mkdir(output, { recursive: true })
await writeFile(
  new URL('index.html', output),
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'unsafe-inline';style-src 'unsafe-inline';img-src data: blob:;font-src data: blob:;frame-src 'self' about: blob: data:;connect-src blob:;base-uri 'none';form-action 'none'"><title>Formats</title><style>${style}</style></head><body><div id="app"></div><script>${script.replace(/<\/script/gi, '<\\/script')}</script></body></html>`,
)
console.log('Bundled offline FormatsEditor')

const vendor = new URL('../../diagram/out/drawio/', import.meta.url)
await cp(vendor, new URL('drawio/', output), { recursive: true })
const bridgeSource = (
  await readFile(new URL('../../diagram/src/bridge/bridge.ts', import.meta.url), 'utf8')
).replace(
  "location.ancestorOrigins?.[0] ?? ''",
  'new URL(document.referrer || location.href).origin',
)
const bridge = await build({
  stdin: {
    contents: bridgeSource,
    sourcefile: 'bridge.ts',
    resolveDir: fileURLToPath(new URL('../../diagram/src/bridge/', import.meta.url)),
    loader: 'ts',
  },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'safari17',
  write: false,
  minify: true,
})
await writeFile(new URL('drawio/every-office-bridge.js', output), bridge.outputFiles[0].contents)
const policy =
  "default-src 'self' data: blob:;script-src 'self' 'unsafe-inline';style-src 'self' 'unsafe-inline';img-src 'self' data: blob:;font-src 'self' data: blob:;connect-src 'self';worker-src 'self' blob:;frame-src 'self' blob: data:;base-uri 'self';object-src 'none';form-action 'none'"
const index = (await readFile(new URL('drawio/index.html', output), 'utf8')).replace(
  '<head>',
  `<head><meta http-equiv="Content-Security-Policy" content="${policy}"><script src="every-office-bridge.js"></script>`,
)
await writeFile(new URL('drawio/index.html', output), index)
console.log(
  'Included verified offline draw.io assets and desktop bridge under the local HTTP origin',
)
