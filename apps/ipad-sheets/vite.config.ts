import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { Script } from 'node:vm'

export default defineConfig({
  base: './',
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.platform': JSON.stringify('darwin'),
  },
  resolve: {
    alias: [
      {
        find: '@ipad/desktop-app',
        replacement: fileURLToPath(new URL('../sheets/src/renderer/App.tsx', import.meta.url)),
      },
      {
        find: /^node:(?:crypto|fs(?:\/promises)?|path|os)$/,
        replacement: fileURLToPath(new URL('src/browser-node.ts', import.meta.url)),
      },
    ],
  },
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
          .replace(
            '</head>',
            () => `<style>${css?.type === 'asset' ? css.source : ''}</style></head>`,
          )
          .replace("script-src 'self'", "script-src 'unsafe-inline'")
          .replace("script-src 'unsafe-inline'", "script-src 'unsafe-inline' 'wasm-unsafe-eval'")
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
      entry: fileURLToPath(
        new URL(
          process.env.SHEETS_DESKTOP === '0' ? 'src/main.ts' : 'src/desktop-main.tsx',
          import.meta.url,
        ),
      ),
      name: 'SpreadsheetEditor',
      formats: ['iife'],
      fileName: 'editor',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
})
