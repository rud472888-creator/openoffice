import { defineConfig } from 'vitest/config'
import { portablePptxXml } from './scripts/portable-pptx'
export default defineConfig({
  plugins: [portablePptxXml()],
  test: { include: ['tests/**/*.test.ts'], testTimeout: 20000 },
})
