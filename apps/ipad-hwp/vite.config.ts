import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const local = (name: string) => fileURLToPath(new URL(`./src/${name}`, import.meta.url))
export default defineConfig({
  base: './',
  resolve: {
    alias: {
      'node:zlib': local('browser-zlib.ts'),
      'node:crypto': local('browser-crypto.ts'),
      '@genoffice/file-parse': local('browser-memos.ts'),
    },
  },
  esbuild: { jsx: 'automatic' },
  build: { target: 'safari17', sourcemap: false },
  plugins: [
    {
      name: 'hwp-buffer-global',
      transform(code, id) {
        if (id.includes('/apps/hwp/src/main/') && /\bBuffer\b/.test(code)) {
          return `import { Buffer } from 'buffer';\n${code}`
        }
      },
    },
  ],
})
