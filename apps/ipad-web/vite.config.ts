import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
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
  },
})
