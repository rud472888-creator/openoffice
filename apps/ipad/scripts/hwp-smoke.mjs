/* global window */
import { chromium } from 'playwright-core'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import init, { HwpDocument } from '@rhwp/core'

const root = new URL('../../../', import.meta.url)
const resources = new URL('apps/ipad/EveryOffice/Resources/HwpEditor/', root)
const output = new URL('apps/ipad/build/browser-smoke/', root)
await mkdir(output, { recursive: true })
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname
  if (path.includes('..')) {
    response.writeHead(404).end()
    return
  }
  try {
    const data = await readFile(new URL(`.${path === '/' ? '/index.html' : path}`, resources))
    const mime = path.endsWith('.js')
      ? 'text/javascript'
      : path.endsWith('.wasm')
        ? 'application/wasm'
        : path.endsWith('.css')
          ? 'text/css'
          : path.endsWith('.json')
            ? 'application/json'
            : 'text/html'
    response.writeHead(200, { 'Content-Type': mime }).end(data)
  } catch {
    response.writeHead(404).end()
  }
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
  const exceptions = [],
    remote = []
  page.on('pageerror', (error) => {
    exceptions.push(error.message)
    console.error(error.message)
  })
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith(address))
      remote.push(request.url())
  })
  const failedAssets = []
  page.on('response', (response) => {
    if (response.status() >= 400) failedAssets.push(`${response.status()} ${response.url()}`)
  })
  await page.addInitScript(() => {
    window.nativeMessages = []
    window.webkit = {
      messageHandlers: {
        everyOffice: {
          postMessage(message) {
            window.nativeMessages.push(message)
            if (message.type === 'save')
              setTimeout(() => window.everyOffice.didSave(message.revision), 0)
          },
        },
      },
    }
  })
  await page.goto(address)
  await page.waitForFunction(() =>
    window.nativeMessages.some((message) => message.type === 'ready'),
  )
  const original = await readFile(new URL('apps/hwp/src/renderer/assets/blank.hwp', root))
  await page.evaluate(
    (base64) =>
      window.everyOffice.openDocument({ name: '검증.hwp', kind: 'hwp', language: 'ko', base64 }),
    original.toString('base64'),
  )
  assert.deepEqual(
    await page.evaluate(() => window.nativeMessages.filter((message) => message.type === 'error')),
    [],
  )
  await page.screenshot({ path: fileURLToPath(new URL('hwp-open.png', output)) })
  await page.evaluate(() => window.everyOffice.saveDocument())
  await page.waitForFunction(() => window.nativeMessages.some((message) => message.type === 'save'))
  const unchanged = await page.evaluate(() =>
    window.nativeMessages.filter((message) => message.type === 'save').at(-1),
  )
  assert.deepEqual(Buffer.from(unchanged.base64, 'base64'), original)
  const frame = page.frames().find((candidate) => candidate.url().includes('/studio/'))
  assert.ok(frame)
  await frame.locator('#icon-toolbar').waitFor({ state: 'visible' })
  await frame.locator('#style-bar').waitFor({ state: 'hidden' })
  assert.equal(await page.locator('#host-tools').count(), 0)
  await frame.locator('textarea[aria-label]').focus()
  await page.keyboard.insertText('한글 편집 저장 검증')
  await page.waitForFunction(() =>
    window.nativeMessages.some((message) => message.type === 'changed'),
  )
  await page.evaluate(() => window.everyOffice.saveDocument())
  await page.waitForFunction(
    () => window.nativeMessages.filter((message) => message.type === 'save').length >= 2,
  )
  const changed = await page.evaluate(() =>
    window.nativeMessages.filter((message) => message.type === 'save').at(-1),
  )
  await init({ module_or_path: await readFile(new URL('vendor/rhwp-core/rhwp_bg.wasm', root)) })
  const document = new HwpDocument(Buffer.from(changed.base64, 'base64'))
  try {
    assert.ok(document.getTextFileText().includes('한글 편집 저장 검증'))
  } finally {
    document.free()
  }
  await page.evaluate(
    (base64) =>
      window.everyOffice.openDocument({
        name: '다시 열기.hwp',
        kind: 'hwp',
        language: 'ko',
        base64,
      }),
    changed.base64,
  )
  await page.screenshot({ path: fileURLToPath(new URL('hwp-edited.png', output)) })
  const memoDocument = new HwpDocument(Buffer.from(changed.base64, 'base64'))
  let hwpx
  try {
    memoDocument.insertMemo(
      0,
      0,
      0,
      1,
      JSON.stringify({ text: '보존할 한글 메모', author: '테스트' }),
    )
    assert.ok(memoDocument.getMemoList().includes('보존할 한글 메모'))
    hwpx = memoDocument.exportHwpx()
  } finally {
    memoDocument.free()
  }
  await page.evaluate(
    (base64) =>
      window.everyOffice.openDocument({ name: '메모.hwpx', kind: 'hwpx', language: 'ko', base64 }),
    Buffer.from(hwpx).toString('base64'),
  )
  const hwpxFrame = page.frames().find((candidate) => candidate.url().includes('/studio/'))
  await hwpxFrame.locator('textarea[aria-label]').focus()
  await page.keyboard.press('Control+End')
  await page.keyboard.insertText(' HWPX 본문 추가')
  await page.evaluate(() => {
    window.nativeMessages = []
  })
  await page.evaluate(() => window.everyOffice.saveDocument())
  await page.waitForFunction(() => window.nativeMessages.some((message) => message.type === 'save'))
  const hwpxSave = await page.evaluate(() =>
    window.nativeMessages.find((message) => message.type === 'save'),
  )
  const hwpxDocument = new HwpDocument(Buffer.from(hwpxSave.base64, 'base64'))
  try {
    assert.ok(hwpxDocument.getTextFileText().includes('HWPX 본문 추가'))
    assert.ok(hwpxDocument.getMemoList().includes('보존할 한글 메모'))
  } finally {
    hwpxDocument.free()
  }
  await page.evaluate(() => window.everyOffice.performAction('convert'))
  await page.waitForFunction(() =>
    window.nativeMessages.some((message) => message.type === 'saveAsFile'),
  )
  const converted = await page.evaluate(() =>
    window.nativeMessages.filter((message) => message.type === 'saveAsFile').at(-1),
  )
  assert.equal(converted.kind, 'hwp')
  const convertedDocument = new HwpDocument(Buffer.from(converted.base64, 'base64'))
  try {
    assert.ok(convertedDocument.getTextFileText().includes('HWPX 본문 추가'))
    assert.ok(convertedDocument.getMemoList().includes('보존할 한글 메모'))
  } finally {
    convertedDocument.free()
  }
  await page.evaluate(() => window.everyOffice.performAction('pdf'))
  await page.waitForFunction(() =>
    window.nativeMessages.some((message) => message.type === 'exportPDF'),
  )
  await page.evaluate(() => window.everyOffice.performAction('print'))
  await page.waitForFunction(() =>
    window.nativeMessages.some((message) => message.type === 'printPages'),
  )
  const printJob = await page.evaluate(() =>
    window.nativeMessages.find((message) => message.type === 'exportPDF'),
  )
  assert.ok(printJob.pages.length >= 1)
  assert.ok(printJob.pages[0].svg.includes('<svg'))
  assert.ok(printJob.pages[0].width > 400 && printJob.pages[0].width < 1000)
  assert.deepEqual(
    await page.evaluate(() => window.nativeMessages.filter((message) => message.type === 'error')),
    [],
  )
  const overlap = await page.evaluate(async () => {
    const start = window.nativeMessages.length
    const first = window.everyOffice.saveDocument()
    const second = window.everyOffice.saveDocument()
    // Let the first job enter its asynchronous export before the input event.
    await new Promise((resolve) =>
      queueMicrotask(() =>
        queueMicrotask(() => {
          const input = document
            .querySelector('iframe')
            .contentDocument.querySelector('textarea[aria-label]')
          input.dispatchEvent(new Event('input', { bubbles: true }))
          resolve()
        }),
      ),
    )
    await Promise.all([first, second])
    return window.nativeMessages.slice(start)
  })
  const overlapSaves = overlap.filter((message) => message.type === 'save')
  const overlapChange = overlap.find((message) => message.type === 'changed')
  assert.equal(overlapSaves.length, 2, 'Overlapping native save requests must both complete')
  assert.ok(overlapChange, 'Input during an asynchronous save must remain tracked')
  assert.ok(overlapSaves[0].revision < overlapChange.revision)
  assert.equal(overlapSaves[1].revision, overlapChange.revision)
  await writeFile(
    new URL('hwp-result.json', output),
    JSON.stringify(
      {
        passed: true,
        checks: [
          'offline studio',
          'original-byte no-op',
          'Korean input',
          'guarded HWP save',
          'engine read-back',
          'reopen',
          'existing memo preservation',
          'HWPX edit and save',
          'PDF page bridge',
          'verified HWPX-to-HWP import copy',
          'overlapping saves and input revision preservation',
        ],
      },
      null,
      2,
    ),
  )
  assert.deepEqual(exceptions, [])
  assert.deepEqual(remote, [])
  assert.deepEqual(failedAssets, [])
  console.log('PASS HWP studio open, original-byte save, offline assets')
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
