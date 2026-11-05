import { cpSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
const target = resolve('../ipad/EveryOffice/Resources/HwpEditor')
rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
cpSync('dist', target, { recursive: true })
cpSync('../hwp/public/studio', resolve(target, 'studio'), { recursive: true })
const pin = JSON.parse(readFileSync('../../vendor/rhwp-core/package.json', 'utf8')).rhwp
const checkout = resolve('../hwp/node_modules/.cache/rhwp-studio', pin.tag)
const commit = '7d06d5c706f1d89f1662e739abf2b1b25d2a98e4'
if (
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim() !== commit
)
  throw new Error('Unexpected HWP studio source')
const fontDirectory = resolve(target, 'studio/fonts')
mkdirSync(fontDirectory, { recursive: true })
for (const [source, name] of [
  ['assets/fonts/RHWPOldHangul-Regular.woff2', 'RHWPOldHangul-Regular.woff2'],
  ['assets/fonts/licenses/SourceHanSerifK-OFL.txt', 'SourceHanSerifK-OFL.txt'],
]) {
  writeFileSync(
    resolve(fontDirectory, name),
    execFileSync('git', ['show', `${commit}:${source}`], {
      cwd: checkout,
      maxBuffer: 16 * 1024 * 1024,
    }),
  )
}
const policy =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; connect-src 'self' data: blob:; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'"
for (const path of ['index.html', 'studio/index.html']) {
  const file = resolve(target, path)
  writeFileSync(
    file,
    readFileSync(file, 'utf8').replace(
      '<head>',
      `<head><meta http-equiv="Content-Security-Policy" content="${policy}">`,
    ),
  )
}
mkdirSync('../ipad/EveryOffice/Resources/Templates', { recursive: true })
copyFileSync(
  '../hwp/src/renderer/assets/blank.hwp',
  '../ipad/EveryOffice/Resources/Templates/Blank.hwp',
)
console.log(`Bundled offline HWP studio at ${target}`)
