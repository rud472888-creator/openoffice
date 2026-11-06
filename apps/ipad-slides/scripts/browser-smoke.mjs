/* global window */
import { chromium } from 'playwright-core'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import JSZip from 'jszip'

const assets = fileURLToPath(
  new URL('../../ipad/EveryOffice/Resources/PresentationEditor/', import.meta.url),
)
const output = fileURLToPath(new URL('../../ipad/build/deckcraft-smoke/', import.meta.url))
await mkdir(output, { recursive: true })
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname
    const body = await readFile(join(assets, path === '/' ? 'index.html' : path))
    const type = path.endsWith('.wasm')
      ? 'application/wasm'
      : path.endsWith('.js')
        ? 'text/javascript'
        : path.endsWith('.css')
          ? 'text/css'
          : 'text/html'
    res.writeHead(200, { 'Content-Type': type }).end(body)
  } catch {
    res.writeHead(404).end()
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = 'http://127.0.0.1:' + server.address().port
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
})
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.on('pageerror', (e) => console.error('page:', e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(m.text())
  })
  await page.addInitScript(() => {
    window.messages = []
    window.webkit = {
      messageHandlers: {
        everyOffice: {
          postMessage: (m) => {
            window.messages.push(m)
            if (m.type === 'error') console.error(m.message)
          },
        },
      },
    }
  })
  await page.goto(address)
  const fixture = await JSZip.loadAsync(await readFile(join(assets, '../Templates/Blank.pptx')))
  const slidePart = 'ppt/slides/slide1.xml'
  const firstSlide = await fixture.file(slidePart).async('string')
  fixture.file(slidePart, firstSlide.replace('>Title<', '>한글 발표<'))
  const original = await fixture.generateAsync({ type: 'nodebuffer' })
  const open = async (bytes) => {
    await page.evaluate((base64) => {
      window.messages = []
      window.everyOffice.openDocument({ name: 'Slides.pptx', kind: 'pptx', base64 })
    }, bytes.toString('base64'))
    await page.waitForFunction(
      () => window.messages.some((m) => m.type === 'opened'),
      {},
      { timeout: 55000 },
    )
  }
  await open(original)
  await page.evaluate(() => window.everyOffice.saveDocument())
  const saved = async () =>
    Buffer.from(
      await page.evaluate(() => window.messages.filter((m) => m.type === 'save').at(-1).base64),
      'base64',
    )
  assert.deepEqual(await saved(), original)
  await page.screenshot({ path: join(output, 'open.png') })
  const canvas = page.frameLocator('iframe').locator('canvas')
  await canvas.click({ position: { x: 192, y: 92 } })
  await page.waitForFunction(() => window.messages.some((m) => m.type === 'changed'))
  await page.evaluate(() => window.everyOffice.saveDocument())
  await page.waitForFunction(() => window.messages.filter((m) => m.type === 'save').length === 2)
  const edited = await saved()
  const slideCount = async (bytes) =>
    Object.keys((await JSZip.loadAsync(bytes)).files).filter((n) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(n),
    ).length
  assert.equal(await slideCount(edited), (await slideCount(original)) + 1)
  assert.match(await (await JSZip.loadAsync(edited)).file(slidePart).async('string'), /한글 발표/)
  await open(edited)
  await page.screenshot({ path: join(output, 'reopened.png') })
  console.log(
    'PASS DeckCraft opened PPTX, preserved unedited bytes, added a slide, saved and reopened the edited deck.',
  )
} finally {
  await browser.close()
  server.close()
}
