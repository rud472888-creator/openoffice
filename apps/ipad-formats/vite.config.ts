import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  base: './',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    target: 'safari17',
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    lib: {
      entry: fileURLToPath(new URL('src/main.ts', import.meta.url)),
      name: 'FormatsEditor',
      formats: ['iife'],
      fileName: 'editor',
    },
  },
})
