import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

/** Keep desktop files untouched; only the XML helper import boundary is adapted. */
export function portablePptxXml(): Plugin {
  const engine = fileURLToPath(new URL('../../../packages/pptx-engine/src/', import.meta.url))
  const zip = fileURLToPath(new URL('../src/desktop-zip.ts', import.meta.url))
  const bytes = fileURLToPath(new URL('../src/xml-bytes.ts', import.meta.url))
  return {
    name: 'portable-pptx-xml-helpers',
    enforce: 'pre',
    resolveId(source, importer) {
      if (
        source === './zip' &&
        importer?.startsWith(engine) &&
        /\/(?:notes|comments|resource-cleanup|layout|master-edit)\.ts$/.test(importer)
      )
        return zip
    },
    transform(code, id) {
      if (id.startsWith(engine) && id.endsWith('/chart-insert.ts')) {
        const prefix = code.slice(0, code.indexOf('export function writeChartWorkbook('))
        return {
          code: prefix.replace(
            /import\s+(?:type\s+)?[\s\S]*?\sfrom\s+'([^']+)'/g,
            (statement, path: string) =>
              ['./types', './xml-utils', './chart-workbook'].includes(path) ? statement : '',
          ),
          map: null,
        }
      }
      if (id.startsWith(engine) && /\/(?:notes|comments)\.ts$/.test(id))
        return { code: `import { Buffer } from ${JSON.stringify(bytes)};\n${code}`, map: null }
    },
  }
}
