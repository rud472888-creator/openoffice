import { build } from 'esbuild'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drawioNotices } from './drawio-notices.mjs'
import { licenseText } from '../../../tools/license-text.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const bundled = await build({
  absWorkingDir: root,
  entryPoints: [
    'apps/ipad-web/src/main.ts',
    'apps/ipad-web/src/browser-inflate.ts',
    'apps/ipad-sheets/src/main.ts',
    'apps/ipad-sheets/src/desktop-main.tsx',
    'apps/ipad-slides/src/main.ts',
    'apps/ipad-hwp/src/main.ts',
    'apps/ipad-formats/src/main.ts',
    'apps/ipad-markdown/src/main.tsx',
    'apps/ipad-hwp/src/browser-memos.ts',
    'apps/ipad-hwp/src/browser-zlib.ts',
    'apps/ipad-hwp/src/browser-crypto.ts',
    'apps/ipad-sheets/src/browser-node.ts',
  ],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  write: false,
  metafile: true,
  outdir: '/tmp/every-office-license-probe',
  logLevel: 'silent',
  loader: {
    '.css': 'empty',
    '.wasm': 'binary',
    '.ttf': 'binary',
    '.woff': 'binary',
    '.woff2': 'binary',
    '.otf': 'binary',
    '.svg': 'text',
    '.png': 'binary',
    '.jpg': 'binary',
    '.jpeg': 'binary',
    '.gif': 'binary',
    '.webp': 'binary',
    '.md': 'text',
    '.txt': 'text',
  },
  external: ['node:*', '@genoffice/file-parse'],
  alias: {
    '@ipad/desktop-app': resolve(root, 'apps/sheets/src/renderer/App.tsx'),
  },
  plugins: [
    {
      name: 'raw-assets',
      setup(build) {
        build.onLoad({ filter: /\?raw$/ }, (args) => ({
          contents: readFileSync(args.path.replace(/\?raw$/, ''), 'utf8'),
          loader: 'text',
        }))
      },
    },
  ],
})
const supplements = {
  'ot-json1@1.0.2': 'ot-json1-1.0.2-LICENSE.txt',
  'unicount@1.1.0': 'unicount-1.1.0-LICENSE.txt',
  'ot-text-unicode@4.0.0': 'ot-text-unicode-4.0.0-LICENSE.txt',
  'react-remove-scroll-bar@2.3.8': 'react-remove-scroll-bar-2.3.8-LICENSE.txt',
  'franc-min@6.2.0': 'franc-min-6.2.0-LICENSE.txt',
  '@fluentui/react-icons@2.0.333': 'fluentui-react-icons-2.0.333-LICENSE.txt',
  'fastdom@1.0.12': 'fastdom-1.0.12-LICENSE.txt',
}
const packages = new Map()
for (const file of Object.keys(bundled.metafile.inputs)) {
  if (!file.includes('node_modules/')) continue
  let directory = dirname(resolve(root, file))
  let metadata
  while (directory !== root) {
    if (existsSync(join(directory, 'package.json'))) {
      const candidate = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
      // Subpath module markers such as numfmt/lib/package.json are not package identities.
      if (typeof candidate.name === 'string' && typeof candidate.version === 'string') {
        metadata = candidate
        break
      }
    }
    directory = dirname(directory)
  }
  if (!metadata) throw new Error(`Missing package metadata for ${file}`)
  const key = `${metadata.name}@${metadata.version}`
  if (packages.has(key)) continue
  const license =
    licenseText(metadata.name, directory) ??
    (supplements[key]
      ? readFileSync(join(root, 'apps/ipad/licenses', supplements[key]), 'utf8').trim()
      : null) ??
    (metadata.name === '@nodable/entities'
      ? readFileSync(join(root, 'apps/ipad/licenses/nodable-MIT.txt'), 'utf8').trim()
      : metadata.name === '@rhwp/editor'
        ? readFileSync(join(root, 'vendor/rhwp-core/LICENSE'), 'utf8').trim()
        : metadata.name === 'saxes' && metadata.version === '6.0.0'
          ? readFileSync(join(root, 'apps/ipad/licenses/saxes-6.0.0-LICENSE.txt'), 'utf8').trim()
          : metadata.name === '@univerjs/protocol' && metadata.license === 'Apache-2.0'
            ? `Copyright DreamNum Co., Ltd.\n${readFileSync(join(root, 'node_modules/@univerjs/core/LICENSE'), 'utf8')}`
            : null)
  if (!license) throw new Error(`Missing license text for ${key}`)
  const note =
    key === 'ot-text-unicode@4.0.0'
      ? 'Published npm metadata names ISC; the author-published release README grants the MIT terms reproduced below. No license wording has been repaired or replaced.\n\n'
      : ''
  packages.set(key, note + license)
}
const notice = [
  readFileSync(join(root, 'NOTICE'), 'utf8'),
  '\nBrowser editor third-party licenses\n',
  ...[...packages]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, license]) => `\n${name}\n${'='.repeat(name.length)}\n${license}\n`),
  await drawioNotices(),
  '\nHWP engine and studio\n',
  readFileSync(join(root, 'vendor/rhwp-core/LICENSE'), 'utf8'),
  readFileSync(join(root, 'vendor/rhwp-core/THIRD_PARTY_LICENSES.md'), 'utf8'),
  readFileSync(join(root, 'apps/hwp/public/studio/THIRD-PARTY-LICENSES-rhwp.md'), 'utf8'),
  '\nRHWP Old Hangul (Adobe/Google, SIL OFL)\n',
  readFileSync(
    join(root, 'apps/ipad/EveryOffice/Resources/HwpEditor/studio/fonts/SourceHanSerifK-OFL.txt'),
    'utf8',
  ),
  '\nIronCalc WASM 0.9.1\n',
  ...['LICENSE-MIT', 'LICENSE-Apache-2.0', 'THIRD-PARTY-NOTICES.md'].map((name) =>
    readFileSync(join(root, 'apps/ipad-sheets/vendor/ironcalc-xlsx', name), 'utf8'),
  ),
  '\nLegacy spreadsheet import: Calamine 0.37.0 and its locked Rust dependencies\n',
  readFileSync(join(root, 'apps/ipad-sheets/vendor/legacy-import/THIRD-PARTY-NOTICES.txt'), 'utf8'),
  '\nBundled document fonts\n',
  'KaTeX webfonts — SIL OFL 1.1\nCopyright (c) 2009-2010, Design Science, Inc. (<www.mathjax.org>)\nCopyright (c) 2014-2018 Khan Academy (<www.khanacademy.org>),\nwith Reserved Font Names KaTeX_AMS, KaTeX_Caligraphic, KaTeX_Fraktur, KaTeX_Main, KaTeX_Math, KaTeX_SansSerif, KaTeX_Script, KaTeX_Size1, KaTeX_Size2, KaTeX_Size3, KaTeX_Size4, and KaTeX_Typewriter.\nThe SIL OFL 1.1 text follows with the other document fonts.',
  readFileSync(join(root, 'apps/docs/src/renderer/fonts/README.md'), 'utf8'),
  readFileSync(join(root, 'packages/ui/src/fonts/README.md'), 'utf8'),
  ...[
    'apps/docs/src/renderer/fonts',
    'packages/ui/src/fonts',
    'packages/ui/template-fonts',
  ].flatMap((directory) =>
    readdirSync(join(root, directory))
      .filter((name) => /(?:LICENSE|OFL|COPYING)/i.test(name))
      .map(
        (name) => `\n${directory}/${name}\n${readFileSync(join(root, directory, name), 'utf8')}`,
      ),
  ),
].join('\n')
const target = join(root, 'apps/ipad/EveryOffice/Resources/Notices')
mkdirSync(target, { recursive: true })
writeFileSync(join(target, 'NOTICE'), notice)
console.log(`Included license text for ${packages.size} bundled dependencies.`)
