import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  base: './',
  resolve: {
    alias: { 'node:zlib': fileURLToPath(new URL('src/browser-inflate.ts', import.meta.url)) },
  },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    target: 'safari17',
    lib: {
      entry: 'src/main.ts',
      name: 'EveryOfficeEditor',
      formats: ['iife'],
      fileName: () => 'editor.js',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
    cssCodeSplit: false,
    sourcemap: false,
    reportCompressedSize: false,
  },
})
