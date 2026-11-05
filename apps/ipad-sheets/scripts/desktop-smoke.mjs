import { chromium } from 'playwright-core'
/* global window, document, innerWidth */
import { readFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
const root = new URL('../../../', import.meta.url)
const html = await readFile(
  new URL('apps/ipad/EveryOffice/Resources/SpreadsheetEditor/index.html', root),
)
const server = createServer((_, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end(html)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({
  executablePath: '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox'],
})
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true })
  const exceptions = []
  page.on('pageerror', (error) => {
    exceptions.push(error.message)
    console.log('PAGE ERROR:', error.message)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') console.log('CONSOLE:', message.text().slice(0, 1000))
  })
  await page.addInitScript(() => {
    window.__genofficeDebugHooks = true
    window.nativeMessages = []
    window.webkit = {
      messageHandlers: {
        everyOffice: {
          postMessage: (message) => {
            window.nativeMessages.push(message)
            console.log('HOST:', message.type, message.message ?? '')
            if (message.type === 'importCopy' && message.requestId)
              setTimeout(
                () => window.everyOffice.didExport(message.requestId, { completed: true }),
                0,
              )
          },
        },
      },
    }
  })
  await page.goto(`http://127.0.0.1:${server.address().port}`, { timeout: 60000 })
  await page.waitForFunction(
    () => window.nativeMessages.some((message) => message.type === 'ready'),
    { timeout: 60000 },
  )
  const base64 = (
    await readFile(new URL('apps/ipad/EveryOffice/Resources/Templates/Blank.xlsx', root))
  ).toString('base64')
  await page.evaluate(async (base64) => {
    await window.everyOffice.openDocument({
      name: 'Full grid.xlsx',
      base64,
      kind: 'xlsx',
      locale: 'en',
    })
  }, base64)
  await page.waitForTimeout(3000)
  await page.waitForFunction(() => window.__genofficeDebug?.univerAPI?.getActiveWorkbook())
  await page.evaluate(() => {
    const sheet = window.__genofficeDebug.univerAPI.getActiveWorkbook().getActiveSheet()
    sheet.getRange('A1').setValue(10)
    sheet.getRange('A2').setValue(20)
    sheet.getRange('A3').setValue('=SUM(A1:A2)')
    sheet.getRange('B1').setValue('Desktop 한글 edit')
  })
  await page.waitForFunction(() =>
    window.nativeMessages.some((message) => message.type === 'changed'),
  )
  await page.evaluate(async () => {
    await window.everyOffice.saveDocument()
  })
  await page.waitForFunction(() => window.nativeMessages.some((message) => message.type === 'save'))
  const saved = await page.evaluate(() =>
    window.nativeMessages.filter((message) => message.type === 'save').at(-1),
  )
  const archive = await JSZip.loadAsync(Buffer.from(saved.base64, 'base64'))
  const xml = await archive.file('xl/worksheets/sheet1.xml').async('string')
  assert.ok(xml.includes('Desktop 한글 edit'))
  assert.match(xml, /<f[^>]*>SUM\(A1:A2\)<\/f>/)
  assert.match(xml, /<c[^>]*r="A3"[^>]*>[\s\S]*?<v>30<\/v>/)
  await page.evaluate(async (base64) => {
    await window.everyOffice.openDocument({
      name: 'Reopened.xlsx',
      kind: 'xlsx',
      base64,
      locale: 'en',
    })
  }, saved.base64)
  assert.equal(
    await page.evaluate(() =>
      window.__genofficeDebug.univerAPI
        .getActiveWorkbook()
        .getActiveSheet()
        .getRange('B1')
        .getValue(),
    ),
    'Desktop 한글 edit',
  )
  assert.ok((await page.locator('canvas').count()) > 0)
  assert.deepEqual(exceptions, [])
  await mkdir(new URL('../build/', import.meta.url), { recursive: true })
  await page.screenshot({
    path: fileURLToPath(new URL('../build/desktop-tablet.png', import.meta.url)),
  })
  await page.setViewportSize({ width: 390, height: 768 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({
    path: fileURLToPath(new URL('../build/desktop-narrow.png', import.meta.url)),
  })
  await page.setViewportSize({ width: 1024, height: 768 })
  for (const [kind, input] of [
    ['csv', Buffer.from('Name,Code\r\n한글,00123\r\n')],
    ['tsv', Buffer.from('Name\tCode\r\n한글\t00123\r\n')],
    ['xls', await readFile(new URL('../tests/fixtures/formulas.xls', import.meta.url))],
    ['ods', await readFile(new URL('../tests/fixtures/dates.ods', import.meta.url))],
  ]) {
    await page.evaluate(
      async ({ kind, base64 }) => {
        window.nativeMessages = []
        await window.everyOffice.openDocument({
          name: `Import.${kind}`,
          base64,
          kind,
          locale: 'en',
        })
        window.__genofficeDebug.univerAPI
          .getActiveWorkbook()
          .getActiveSheet()
          .getRange('Z10')
          .setValue('Imported 한글')
      },
      { kind, base64: input.toString('base64') },
    )
    await page.waitForFunction(() =>
      window.nativeMessages.some((message) => message.type === 'changed'),
    )
    await page.evaluate(async () => window.everyOffice.saveDocument())
    const messages = await page.evaluate(() => window.nativeMessages)
    const copied = messages.find((message) => message.type === 'importCopy')
    assert.equal(copied?.kind, 'xlsx', `${kind} creates XLSX copy`)
    assert.equal(copied.conversionSave, true)
    assert.ok(Number.isInteger(copied.revision))
    assert.equal(
      messages.some((message) => message.type === 'save'),
      false,
      `${kind} original is never overwritten`,
    )
    const converted = await JSZip.loadAsync(Buffer.from(copied.base64, 'base64'))
    assert.ok(
      (await converted.file('xl/worksheets/sheet1.xml').async('string')).includes('Imported 한글'),
    )
  }
  assert.deepEqual(exceptions, [])
  console.log(
    'PASS: desktop grid/formulas/Korean/cache/save/reopen/tablet/narrow; CSV/TSV/XLS/ODS import-copy saves preserve originals.',
  )
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
