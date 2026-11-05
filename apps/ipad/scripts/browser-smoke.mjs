/* global window, document, innerWidth */
import { chromium } from 'playwright-core'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { createServer } from 'node:http'

const root = new URL('../../../', import.meta.url)
const output = new URL('apps/ipad/build/browser-smoke/', root)
await mkdir(output, { recursive: true })
let html = await readFile(
  new URL('apps/ipad/EveryOffice/Resources/DocumentEditor/index.html', root),
)
const server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end(html)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox'],
})
try {
  const page = await browser.newPage({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
    locale: 'ko-KR',
  })
  const exceptions = []
  const remoteRequests = []
  page.on('pageerror', (error) => {
    exceptions.push(error.message)
    console.error('BROWSER:', error.message)
  })
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
  const base64 = (await readFile(new URL('fixtures/generated/simple.docx', root))).toString(
    'base64',
  )
  assert.equal(
    await page.evaluate(
      (base64) =>
        window.everyOffice.openDocument({
          name: '검증 문서.docx',
          kind: 'docx',
          language: 'ko',
          base64,
        }),
      base64,
    ),
    true,
  )
  const editable = page.locator('.ipad-rich-page[contenteditable="true"]')
  await editable.fill('every office 한글 편집 검증')
  assert.equal(await page.evaluate(() => window.everyOffice.saveDocument()), true)
  const saved = await page.evaluate(() =>
    window.nativeMessages.filter((message) => message.type === 'save').at(-1),
  )
  const zip = await JSZip.loadAsync(Buffer.from(saved.base64, 'base64'))
  assert.match(await zip.file('word/document.xml').async('string'), /every office 한글 편집 검증/)
  assert.equal(
    await page.evaluate(
      (base64) =>
        window.everyOffice.openDocument({
          name: '다시 연 문서.docx',
          kind: 'docx',
          language: 'ko',
          base64,
        }),
      saved.base64,
    ),
    true,
  )
  assert.equal(await editable.innerText(), 'every office 한글 편집 검증')
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 768 })
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      `No outer horizontal overflow at ${width}px`,
    )
    await page.screenshot({
      path: fileURLToPath(new URL(`docx-${width}.png`, output)),
      fullPage: true,
    })
  }
  for (const [kind, resource, part, selector] of [
    ['pptx', 'PresentationEditor', 'ppt/slides/slide1.xml', '.run-editor textarea:not([readonly])'],
  ]) {
    console.log('Testing', kind)
    html = await readFile(new URL(`apps/ipad/EveryOffice/Resources/${resource}/index.html`, root))
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto(address)
    await page.waitForFunction(() =>
      window.nativeMessages.some((message) => message.type === 'ready'),
    )
    const base64 = (
      await readFile(new URL(`apps/ipad/EveryOffice/Resources/Templates/Blank.${kind}`, root))
    ).toString('base64')
    await page.evaluate(
      async ({ kind, base64 }) => {
        await window.everyOffice.openDocument({
          name: `한글 문서.${kind}`,
          kind,
          language: 'ko',
          locale: 'ko',
          base64,
        })
      },
      { kind, base64 },
    )
    if (kind === 'pptx') await page.locator('.slide-canvas [data-element="0"]').click()
    await page.locator(selector).first().fill(`every office ${kind} 한글 검증`)
    await page.evaluate(async () => {
      await window.everyOffice.saveDocument()
    })
    await page.waitForFunction(() =>
      window.nativeMessages.some((message) => message.type === 'save'),
    )
    const saved = await page.evaluate(() =>
      window.nativeMessages.filter((message) => message.type === 'save').at(-1),
    )
    const archive = await JSZip.loadAsync(Buffer.from(saved.base64, 'base64'))
    assert.ok((await archive.file(part).async('string')).includes(`every office ${kind} 한글 검증`))
    await page.evaluate(
      async ({ kind, base64 }) => {
        await window.everyOffice.openDocument({
          name: `다시 열기.${kind}`,
          kind,
          language: 'ko',
          locale: 'ko',
          base64,
        })
      },
      { kind, base64: saved.base64 },
    )
    if (kind === 'pptx') await page.locator('.slide-canvas [data-element="0"]').click()
    assert.equal(
      await page.locator(selector).first().inputValue(),
      `every office ${kind} 한글 검증`,
    )
    for (const width of [1024, 390]) {
      await page.setViewportSize({ width, height: 768 })
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
        `${kind}: no outer overflow at ${width}px`,
      )
      await page.screenshot({
        path: fileURLToPath(new URL(`${kind}-${width}.png`, output)),
        fullPage: true,
      })
    }
  }
  assert.deepEqual(exceptions, [])
  assert.deepEqual(remoteRequests, [])
  await writeFile(
    new URL('result.json', output),
    JSON.stringify(
      {
        passed: true,
        browser: 'Chromium (not iPad Simulator)',
        widths: [1024, 390],
        checks: [
          'offline bundles',
          'native bridges',
          'Korean text edit',
          'DOCX/PPTX save and reopen',
          'responsive overflow',
          'no network requests',
          'no page exceptions',
        ],
      },
      null,
      2,
    ),
  )
  console.log(
    'PASS: offline DOCX/PPTX bridges, edit/save/reopen, tablet and narrow layout; no browser errors or network requests.',
  )
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
