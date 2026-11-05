import { defineConfig } from 'vite'
import { mkdir, writeFile } from 'node:fs/promises'
import { createPresentationTemplate } from './scripts/template'
import { portablePptxXml } from './scripts/portable-pptx'

export default defineConfig({
  base: './',
  plugins: [
    portablePptxXml(),
    {
      name: 'presentation-template',
      async closeBundle() {
        const destination = new URL('../ipad/EveryOffice/Resources/Templates/', import.meta.url)
        await mkdir(destination, { recursive: true })
        await writeFile(new URL('Blank.pptx', destination), await createPresentationTemplate())
      },
    },
  ],
  build: {
    target: 'safari17',
    lib: {
      entry: 'src/main.ts',
      name: 'EveryOfficePresentationEditor',
      formats: ['iife'],
      fileName: () => 'editor.js',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
    cssCodeSplit: false,
    sourcemap: false,
  },
})
