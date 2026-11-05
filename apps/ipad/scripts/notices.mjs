import { build } from 'esbuild'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { licenseText } from '../../../tools/license-text.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const bundled = await build({
  absWorkingDir: root,
  entryPoints: [
    'apps/ipad-web/src/main.ts',
    'apps/ipad-sheets/src/main.ts',
    'apps/ipad-slides/src/main.ts',
  ],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  write: false,
  metafile: true,
  outdir: '/tmp/every-office-license-probe',
  logLevel: 'silent',
})
const packages = new Map()
for (const file of Object.keys(bundled.metafile.inputs)) {
  if (!file.includes('node_modules/')) continue
  let directory = dirname(resolve(root, file))
  while (directory !== root && !existsSync(join(directory, 'package.json')))
    directory = dirname(directory)
  if (directory === root) throw new Error(`Missing package metadata for ${file}`)
  const metadata = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  const key = `${metadata.name}@${metadata.version}`
  if (packages.has(key)) continue
  const license =
    licenseText(metadata.name, directory) ??
    (metadata.name === '@nodable/entities'
      ? readFileSync(join(root, 'apps/ipad/licenses/nodable-MIT.txt'), 'utf8').trim()
      : null)
  if (!license) throw new Error(`Missing license text for ${key}`)
  packages.set(key, license)
}
const notice = [
  readFileSync(join(root, 'NOTICE'), 'utf8'),
  '\nBrowser editor third-party licenses\n',
  ...[...packages]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, license]) => `\n${name}\n${'='.repeat(name.length)}\n${license}\n`),
].join('\n')
const target = join(root, 'apps/ipad/EveryOffice/Resources/Notices')
mkdirSync(target, { recursive: true })
writeFileSync(join(target, 'NOTICE'), notice)
console.log(`Included license text for ${packages.size} bundled dependencies.`)
