/* global window, document, innerWidth */
import { chromium } from 'playwright-core'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { createServer } from 'node:http'

const root = new URL('../', import.meta.url)
const output = new URL('build/browser-smoke/', root)
await mkdir(output, { recursive: true })
const editor = new URL(
  '../../ipad/EveryOffice/Resources/PresentationEditor/index.html',
  import.meta.url,
)
const template = new URL('../../ipad/EveryOffice/Resources/Templates/Blank.pptx', import.meta.url)
const html = await readFile(editor)
const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end(html)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--allow-file-access-from-files'],
})
try {
  const page = await browser.newPage({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
    locale: 'en-US',
  })
  const exceptions = [],
    remoteRequests = []
  page.on('pageerror', (error) => exceptions.push(error.message))
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith(address))
      remoteRequests.push(request.url())
  })
  await page.addInitScript(() => {
    window.nativeMessages = []
    window.webkit = {
      messageHandlers: {
        everyOffice: { postMessage: (message) => window.nativeMessages.push(message) },
      },
    }
  })
  await page.goto(address)
  await page.waitForFunction(() =>
    window.nativeMessages.some((message) => message.type === 'ready'),
  )
  await page.evaluate(
    (base64) =>
      window.everyOffice.openDocument({
        name: 'Visual editing.pptx',
        kind: 'pptx',
        language: 'en',
        base64,
      }),
    (await readFile(template)).toString('base64'),
  )
  await page.waitForFunction(() =>
    window.nativeMessages.some((message) => message.type === 'opened'),
  )
  await page.locator('.slide-canvas').waitFor()
  await page.getByRole('combobox', { name: 'Selection', exact: true }).selectOption('0')
  await page.locator('.run-editor textarea').first().fill('Visual layout on iPad 한글')
  await page.waitForFunction(
    () => Number(document.querySelector('.slide-canvas')?.dataset.revision) > 0,
  )
  const client = await page.context().newCDPSession(page)
  async function touchDrag(x, y, dx, dy) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    for (let step = 1; step <= 5; step++)
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + (dx * step) / 5, y: y + (dy * step) / 5 }],
      })
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  const revision = () =>
    page.evaluate(
      () =>
        window.nativeMessages.filter((message) => message.type === 'changed').at(-1)?.revision ?? 0,
    )
  let prior = await revision()
  await page.locator('.slide-canvas').scrollIntoViewIfNeeded()
  let box = await page.locator('.slide-canvas').boundingBox()
  await touchDrag(box.x + box.width * 0.5, box.y + (box.width / 960) * 198, 42, 24)
  await page.waitForFunction(
    (revision) =>
      window.nativeMessages.some(
        (message) => message.type === 'changed' && message.revision > revision,
      ),
    prior,
  )
  await page.waitForFunction(
    (revision) => Number(document.querySelector('.slide-canvas')?.dataset.revision) > revision,
    prior,
  )
  prior = await revision()
  let handle = await page.locator('[data-action="resize-se"]').boundingBox()
  await touchDrag(handle.x + handle.width / 2, handle.y + handle.height / 2, 35, 18)
  await page.waitForFunction(
    (revision) =>
      window.nativeMessages.some(
        (message) => message.type === 'changed' && message.revision > revision,
      ),
    prior,
  )
  await page.waitForFunction(
    (revision) => Number(document.querySelector('.slide-canvas')?.dataset.revision) > revision,
    prior,
  )
  prior = await revision()
  handle = await page.locator('[data-action="rotate"]').boundingBox()
  await touchDrag(handle.x + handle.width / 2, handle.y + handle.height / 2, 30, 15)
  await page.waitForFunction(
    (revision) =>
      window.nativeMessages.some(
        (message) => message.type === 'changed' && message.revision > revision,
      ),
    prior,
  )
  await page.waitForFunction(
    (revision) => Number(document.querySelector('.slide-canvas')?.dataset.revision) > revision,
    prior,
  )
  await page.getByRole('button', { name: 'Bold', exact: true }).click()
  await page.getByRole('combobox', { name: 'Insert', exact: true }).selectOption('ellipse')
  await page.locator('.slide-canvas [data-element="2"]').waitFor()
  await page.locator('.slide-canvas').scrollIntoViewIfNeeded()
  await page.screenshot({
    path: fileURLToPath(new URL('visual-tablet.png', output)),
    fullPage: true,
  })
  await page.evaluate(() => window.everyOffice.saveDocument())
  let saved = await page.evaluate(() =>
    window.nativeMessages.filter((message) => message.type === 'save').at(-1),
  )
  assert.ok(saved?.base64)
  const editedZip = await JSZip.loadAsync(Buffer.from(saved.base64, 'base64'))
  const xml = await editedZip.file('ppt/slides/slide1.xml').async('string')
  assert.match(xml, /Visual layout on iPad 한글/)
  assert.match(xml, /prst="ellipse"/)
  assert.match(xml, /b="1"/)
  assert.match(xml, /<a:xfrm\b[^>]*rot="[1-9]\d*"/)
  assert.doesNotMatch(xml, /<a:off x="914400" y="2057400"\/>/)
  await page.evaluate(
    (base64) =>
      window.everyOffice.openDocument({
        name: 'Saved layout.pptx',
        kind: 'pptx',
        language: 'en',
        base64,
      }),
    saved.base64,
  )
  await page.getByRole('combobox', { name: 'Selection', exact: true }).selectOption('0')
  assert.equal(
    await page.locator('.run-editor textarea').first().inputValue(),
    'Visual layout on iPad 한글',
  )
  await page.locator('.slide-actions summary').click()
  await page.getByRole('button', { name: 'New Slide', exact: true }).click()
  await page.getByRole('button', { name: 'Text Box', exact: true }).click()
  await page.locator('.run-editor textarea').first().fill('A new editable slide')
  await page.evaluate(() => window.everyOffice.saveDocument())
  saved = await page.evaluate(() =>
    window.nativeMessages.filter((message) => message.type === 'save').at(-1),
  )
  const zip = await JSZip.loadAsync(Buffer.from(saved.base64, 'base64'))
  assert.match(await zip.file('ppt/presentation.xml').async('string'), /id="257"/)
  assert.match(await zip.file('ppt/slides/slide2.xml').async('string'), /A new editable slide/)
  await page.locator('.feature-panel > summary').filter({ hasText: 'Review' }).click()
  await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('Tablet speaker notes 한글')
  await page.evaluate(() => window.everyOffice.saveDocument())
  let featureSave = await page.evaluate(() =>
    window.nativeMessages.filter((message) => message.type === 'save').at(-1),
  )
  let featureZip = await JSZip.loadAsync(Buffer.from(featureSave.base64, 'base64'))
  assert.match(
    await featureZip.file('ppt/notesSlides/notesSlide1.xml').async('string'),
    /Tablet speaker notes 한글/,
  )
  await page.getByRole('textbox', { name: 'Author', exact: true }).fill('Tablet reviewer')
  await page.locator('.feature-panel textarea[placeholder]').fill('Local document comment')
  await page.getByRole('button', { name: 'Post', exact: true }).click()
  await page.locator('.feature-panel label').filter({ hasText: 'Tablet reviewer' }).waitFor()
  await page.getByRole('button', { name: 'Animations', exact: true }).click()
  await page.getByRole('combobox', { name: 'Insert', exact: true }).selectOption('chart-bar')
  await page.locator('.slide-canvas [data-element="1"]').waitFor()
  const chartPanel = page.locator('details.feature-panel').filter({ hasText: 'Edit Chart Data' })
  await chartPanel.locator('summary').click()
  await chartPanel.locator('input[type="number"]').first().fill('25')
  await chartPanel.getByRole('button', { name: 'Apply', exact: true }).click()
  await page.evaluate(() => window.everyOffice.saveDocument())
  featureSave = await page.evaluate(() =>
    window.nativeMessages.filter((message) => message.type === 'save').at(-1),
  )
  featureZip = await JSZip.loadAsync(Buffer.from(featureSave.base64, 'base64'))
  assert.match(
    await featureZip.file('ppt/charts/chart_ipad2.xml').async('string'),
    /<c:v>25<\/c:v>/,
  )
  assert.match(await featureZip.file('ppt/slides/slide2.xml').async('string'), /<p:timing>/)
  saved = featureSave
  await page.evaluate(() => window.everyOffice.exportPDF())
  const exported = await page.evaluate(() =>
    window.nativeMessages.filter((message) => message.type === 'exportPDF').at(-1),
  )
  assert.equal(exported.pages.length, 2)
  assert.ok(
    exported.pages.every(
      (page) =>
        page.width > 0 &&
        page.height > 0 &&
        page.svg.includes('<svg') &&
        !/<script|foreignObject|https?:[^" ]*href=/i.test(page.svg),
    ),
  )
  await page.evaluate(() => window.everyOffice.printPages())
  assert.equal(
    await page.evaluate(
      () =>
        window.nativeMessages.filter((message) => message.type === 'printPages').at(-1).pages
          .length,
    ),
    2,
  )
  await page.getByRole('button', { name: 'From Current Slide', exact: true }).click()
  await page.locator('dialog.presentation-view[open] .slide-canvas').waitFor()
  await page.getByRole('button', { name: 'End Show', exact: true }).click()
  await page.locator('dialog.presentation-view').waitFor({ state: 'detached' })
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 768 })
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      `No outer horizontal overflow at ${width}px`,
    )
    await page.locator('.slide-canvas').scrollIntoViewIfNeeded()
    await page.screenshot({
      path: fileURLToPath(new URL(`canvas-${width}.png`, output)),
      fullPage: true,
    })
  }
  assert.deepEqual(exceptions, [])
  assert.deepEqual(remoteRequests, [])
  const errors = await page.evaluate(() =>
    window.nativeMessages.filter((message) => message.type === 'error'),
  )
  assert.deepEqual(errors, [])
  await writeFile(new URL('edited.pptx', output), Buffer.from(saved.base64, 'base64'))
  console.log(
    'PPTX touch canvas: text, move, resize, rotate, font, shape, new slide, save/reopen, tablet/narrow layouts, zero requests/errors passed.',
  )
} finally {
  await browser.close()
  server.close()
}
