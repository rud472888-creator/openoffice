import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const root = new URL('../', import.meta.url)
const script = await readFile(new URL('dist/editor.js', root), 'utf8')
let style = await readFile(new URL('dist/ipad-web.css', root), 'utf8')
const fonts = []
const seen = new Map()
// Desktop font aliases reuse the same faces. Store each face once in the offline
// page, then resolve the aliases to local Blob URLs before installing its CSS.
style = style.replace(/data:(font\/[^;]+);base64,([A-Za-z0-9+/=]+)/g, (_match, mime, base64) => {
  const hash = createHash('sha256').update(base64).digest('hex')
  let index = seen.get(hash)
  if (index === undefined) {
    index = fonts.length
    seen.set(hash, index)
    fonts.push([mime, base64])
  }
  return `eo-bundled-font-${index}`
})
const bootstrap = `window.__eoFontData={};let eoCss=${JSON.stringify(style)};for(const [i,[mime,base64]] of ${JSON.stringify(fonts)}.entries()){const raw=atob(base64);const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));const url=URL.createObjectURL(new Blob([bytes],{type:mime}));window.__eoFontData[url]='data:'+mime+';base64,'+base64;eoCss=eoCss.replaceAll('eo-bundled-font-'+i+'"',url+'"').replaceAll('eo-bundled-font-'+i+')',url+')');}const eoStyle=document.createElement('style');eoStyle.textContent=eoCss;document.head.append(eoStyle);`
const bundledScript = (bootstrap + '\n' + script).replace(/<\/script/gi, '<\\/script')
const output = new URL('../../ipad/EveryOffice/Resources/DocumentEditor/', import.meta.url)
await mkdir(output, { recursive: true })
await writeFile(
  new URL('index.html', output),
  `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; font-src data: blob:; base-uri 'none'; form-action 'none'"><title>Document</title></head><body><div id="app"></div><script>${bundledScript}</script></body></html>`,
)
console.log(
  `Bundled offline editor (${fonts.length} unique local fonts): ${fileURLToPath(new URL('index.html', output))}`,
)
