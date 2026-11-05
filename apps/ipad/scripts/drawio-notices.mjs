/** Strict iPad notice for the exact pinned, trimmed offline draw.io bundle. */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  loadDrawio,
  loadInventory,
  checkInventory,
  VENDOR_DIR,
} from '../../../vendor/drawio/bundle.mjs'

import { isAllowed } from '../../../tools/license-allowlist.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const desktop = readFileSync(join(root, 'tools/gen-third-party-notices.mjs'), 'utf8')
/** Read only the desktop generator's plain literal terms; never evaluate its code. */
function literal(name) {
  const match = new RegExp('^const ' + name + ' = `([^`]+)`', 'm').exec(desktop)
  if (!match || match[1].includes('${') || match[1].includes('\\'))
    throw new Error(
      `Desktop ${name} is no longer a plain license literal; review the iPad notice adapter.`,
    )
  return match[1]
}
const terms = {
  MIT: literal('MIT_PERMISSION'),
  Zlib: literal('ZLIB_LICENSE'),
  'BSD-3-Clause': literal('BSD_3_CLAUSE'),
  'Apache-2.0': readFileSync(join(VENDOR_DIR, 'LICENSE'), 'utf8').replace(/^\n+/, '').trimEnd(),
  'OFL-1.1': readFileSync(
    join(root, 'apps/docs/src/renderer/fonts/LICENSE-OFL.txt'),
    'utf8',
  ).trim(),
}
const heading = (title) => `\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}\n`

export async function drawioNotices() {
  // loadDrawio validates both the release SHA-256 and every approved cut.
  const drawio = await loadDrawio()
  const inventory = loadInventory()
  if (inventory.drawio !== drawio.config.version)
    throw new Error('draw.io license inventory version differs from the pinned bundle.')
  const problems = checkInventory({ ...drawio, inventory, isAllowed })
  if (problems.length) throw new Error(`draw.io license inventory failed: ${problems.join('; ')}`)
  const { config } = drawio
  const self = inventory.components.find((component) => component.id === 'drawio')
  if (!self) throw new Error('draw.io inventory has no application component.')
  let text = heading(`draw.io ${config.version} — offline diagram editor`)
  text += `${self.copyright}\n${self.url}\n${self.note}\n\nRelease: ${config.url}\nSHA-256: ${config.sha256}\n\n`
  text += `The app ships ${drawio.shippedFiles.length} release files under Resources/FormatsEditor/drawio.\n`
  text += `${drawio.removedFiles.length} release files are excluded: server/development files, cloud integrations, service workers, PlantUML, ELK, libavoid and Glyphicons sharing icons. Removal patterns:\n`
  text += config.remove.map((pattern) => `  ${pattern}`).join('\n') + '\n'
  for (const cut of config.cut) {
    const derived = drawio.derived.get(cut.file)
    if (!derived) throw new Error(`Missing verified draw.io cut: ${cut.file}`)
    text += `\n${cut.file}: ${derived.originalLength} original bytes, ${derived.bytes.length} shipped bytes, SHA-256 ${cut.sha256}.\n`
    text +=
      'Only the following verbatim release byte ranges were removed, each found exactly once (inclusive offsets):\n'
    text +=
      derived.ranges
        .map((range) => `  ${range.name}: ${range.offset}-${range.offset + range.length - 1}`)
        .join('\n') + '\n'
    text +=
      'These are ELK (EPL-2.0) and libavoid plus its routing core (LGPL-2.1); they are not shipped.\n'
  }
  text +=
    '\nEvery other vendor file is byte-identical to the verified trimmed desktop bundle. The iPad build adds a content-security policy and its bridge script to the serving copy of index.html only; original vendor sources stay unchanged.\n'
  text += heading('Apache License 2.0 — draw.io full license') + terms['Apache-2.0'] + '\n'
  for (const component of inventory.components) {
    const offered = component.offered
      ? ` (dual ${component.offered}, used under ${component.license})`
      : ''
    text += heading(
      `${component.name}${component.version ? ` ${component.version}` : ''} — ${component.license}${offered}`,
    )
    text += `${component.copyright}\n${component.url}\nShipped in: ${component.files.join(', ')}\n`
    if (component.note) text += component.note + '\n'
    const restrictions = new Map()
    for (const file of component.restrictionFiles ?? []) {
      const restriction = (await drawio.read(file)).toString('utf8').trim()
      restrictions.set(restriction, [...(restrictions.get(restriction) ?? []), file])
    }
    for (const [restriction, files] of restrictions)
      text += `\nRestriction, verbatim from ${files.join(', ')}:\n\n${restriction}\n`
    const licenseFiles = [
      ...new Set([
        ...(component.licenseFiles ?? []),
        ...(component.licenseFile ? [component.licenseFile] : []),
      ]),
    ]
    if (licenseFiles.length) {
      for (const file of licenseFiles)
        text += `\n[${file}]\n${(await drawio.read(file)).toString('utf8').trim()}\n`
    } else if (component.license === 'MIT AND Zlib')
      text += `\n${terms.MIT}\n\nzlib License (the parts ported from zlib):\n\n${terms.Zlib}\n`
    else if (terms[component.license]) text += `\n${terms[component.license]}\n`
    else throw new Error(`No draw.io license terms for ${component.name}: ${component.license}`)
  }
  return text
}
