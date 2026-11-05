import { defineConfig } from 'vite'
export default defineConfig({
  base: './',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    target: 'safari17',
    reportCompressedSize: false,
    lib: {
      entry: 'src/main.tsx',
      name: 'MarkdownEditor',
      formats: ['iife'],
      fileName: () => 'editor.js',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
    cssCodeSplit: false,
  },
})
