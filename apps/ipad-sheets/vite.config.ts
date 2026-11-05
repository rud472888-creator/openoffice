import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { Script } from 'node:vm'

export default defineConfig({
  base: './',
  plugins: [
    {
      name: 'offline-editor-html',
      enforce: 'post',
      generateBundle(_, bundle) {
        const script = Object.values(bundle).find((asset) => asset.type === 'chunk')
        const css = Object.values(bundle).find(
          (asset) => asset.type === 'asset' && asset.fileName.endsWith('.css'),
        )
        if (!script || script.type !== 'chunk') throw new Error('Missing editor script.')
        if (!css) throw new Error('Missing editor styles.')
        const html = readFileSync(fileURLToPath(new URL('index.html', import.meta.url)), 'utf8')
          .replace(
            '<script type="module" src="./src/main.ts"></script>',
            () => `<script>${script.code.replace(/<\/script/gi, '<\\/script')}</script>`,
          )
          .replace('</head>', () => `<style>${css?.type === 'asset' ? css.source : ''}</style></head>`)
          .replace("script-src 'self'", "script-src 'unsafe-inline'")
          .replace("style-src 'self'", "style-src 'unsafe-inline'")
        const embeddedScript = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1]
        if (!embeddedScript) throw new Error('Missing inline editor script.')
        // Parse the actual emitted HTML script to catch replacement metacharacter corruption.
        new Script(embeddedScript, { filename: 'SpreadsheetEditor/index.html' })
        for (const key of Object.keys(bundle)) delete bundle[key]
        this.emitFile({ type: 'asset', fileName: 'index.html', source: html })
      },
    },
  ],
  build: {
    target: 'safari17',
    outDir: fileURLToPath(
      new URL('../ipad/EveryOffice/Resources/SpreadsheetEditor', import.meta.url),
    ),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    lib: {
      entry: fileURLToPath(new URL('src/main.ts', import.meta.url)),
      name: 'SpreadsheetEditor',
      formats: ['iife'],
      fileName: 'editor',
    },
  },
})
