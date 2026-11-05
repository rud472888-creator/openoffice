/* global window, document, location */
import { chromium } from 'playwright-core'
import { readFile, mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { createServer } from 'node:http'
import { extname } from 'node:path'

const root = new URL('../', import.meta.url)
const resources = new URL('../../ipad/EveryOffice/Resources/', import.meta.url)
await mkdir(new URL('build/', root), { recursive: true })
const folder = new URL('FormatsEditor/', resources)
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname
    const file = new URL('.' + decodeURIComponent(path === '/' ? '/index.html' : path), folder)
    if (!file.href.startsWith(folder.href)) throw new Error('bad path')
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.json': 'application/json',
      '.woff2': 'font/woff2',
      '.woff': 'font/woff',
      '.xml': 'application/xml',
    }
    const bytes = await readFile(file)
    response.writeHead(200, {
      'Content-Type': types[extname(file.pathname)] || 'application/octet-stream',
    })
    response.end(bytes)
  } catch {
    response.writeHead(404)
    response.end('Not found')
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  args: ['--no-sandbox'],
  headless: true,
})
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true })
  const exceptions = []
  const requests = []
  page.on('pageerror', (error) => {
    exceptions.push(error.message)
    console.error('PAGE ERROR', error.message)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') console.error('CONSOLE', message.text())
  })
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith(address))
      requests.push(request.url())
  })
  await page.addInitScript(() => {
    window.nativeMessages = []
    window.webkit = {
      messageHandlers: {
        everyOffice: {
          postMessage: (message) => {
            window.nativeMessages.push(message)
            if (message.requestId)
              setTimeout(
                () => window.everyOffice.didExport(message.requestId, { completed: true }),
                0,
              )
          },
        },
      },
    }
  })
  const open = async (kind) => {
    await page.goto(address)
    await page.waitForFunction(() => window.nativeMessages.some((m) => m.type === 'ready'))
    const base64 = (await readFile(new URL(`Templates/Blank.${kind}`, resources))).toString(
      'base64',
    )
    await page.evaluate(
      ({ kind, base64 }) =>
        window.everyOffice.openDocument({ name: `Test.${kind}`, kind, base64, language: 'en' }),
      { kind, base64 },
    )
    await page.waitForFunction(() => window.nativeMessages.some((m) => m.type === 'opened'))
  }
  const save = async () => {
    await page.evaluate(() => window.everyOffice.saveDocument())
    const result = await page.evaluate(() =>
      window.nativeMessages.filter((m) => m.type === 'save').at(-1),
    )
    assert.ok(result, JSON.stringify(await page.evaluate(() => window.nativeMessages)))
    return Buffer.from(result.base64, 'base64')
  }
  const exportPage = async () => {
    const before = await page.evaluate(
      () => window.nativeMessages.filter((m) => m.type === 'exportPDF').length,
    )
    await page.getByRole('button', { name: 'Export as PDF…', exact: true }).click()
    await page.waitForFunction(
      (count) => window.nativeMessages.filter((m) => m.type === 'exportPDF').length > count,
      before,
    )
    const output = await page.evaluate(() =>
      window.nativeMessages.filter((m) => m.type === 'exportPDF').at(-1),
    )
    assert.ok(output.pages.length >= 1)
    assert.ok(output.requestId)
    for (const value of output.pages) {
      assert.ok(value.width > 0 && value.height > 0 && value.width <= 4000 && value.height <= 4000)
      assert.doesNotMatch(
        value.html ?? value.svg,
        /<\s*(script|iframe|frame|frameset|object|embed|base|meta)\b|<!\s*(doctype|entity)\b|\s+on[a-z0-9_:-]+\s*=/i,
      )
      assert.doesNotMatch(value.html ?? value.svg, /(?:src|href)=["'](?:blob:|https?:)/i)
    }
    return output.pages
  }
  const exportFile = async (label, extension) => {
    const before = await page.evaluate(
      () => window.nativeMessages.filter((m) => m.type === 'exportFile').length,
    )
    await page.getByRole('button', { name: label, exact: true }).click()
    await page.waitForFunction(
      (count) => window.nativeMessages.filter((m) => m.type === 'exportFile').length > count,
      before,
    )
    const output = await page.evaluate(() =>
      window.nativeMessages.filter((m) => m.type === 'exportFile').at(-1),
    )
    assert.ok(output.name.endsWith(extension))
    assert.ok(Buffer.from(output.base64, 'base64').length > 0)
  }
  await open('html')
  await page.frameLocator('iframe').locator('p').click()
  await page.getByRole('button', { name: 'Edit text', exact: true }).click()
  await page.locator('dialog textarea').fill('HTML edited on iPad')
  await page.locator('dialog').getByRole('button', { name: 'Apply', exact: true }).click()
  assert.match((await save()).toString('utf8'), /HTML edited on iPad/)
  const htmlPages = await exportPage()
  assert.match(htmlPages[0].html, /HTML edited on iPad/)
  await exportFile('Save As…', '.html')
  await page.screenshot({ path: new URL('build/html.png', root).pathname })

  const longSource =
    '<html><body>' +
    Array.from(
      { length: 60 },
      (_, i) => `<p style="margin:0;height:70px">Page paragraph ${i}</p>`,
    ).join('') +
    '</body></html>'
  await page.locator('textarea.source').fill(longSource)
  const longPages = await exportPage()
  assert.ok(longPages.length > 2, `Expected multiple pages, got ${longPages.length}`)
  const lastPosition = await page.evaluate(async (value) => {
    const frame = document.createElement('iframe')
    frame.style.cssText = `position:fixed;width:${value.width}px;height:${value.height}px;left:0;top:0`
    const ready = new Promise((resolve) => {
      frame.onload = resolve
    })
    frame.srcdoc = `<html><body style="margin:0">${value.html}</body></html>`
    document.body.append(frame)
    await ready
    const rect = frame.contentDocument.querySelector('p:last-child').getBoundingClientRect()
    frame.remove()
    return { top: rect.top, bottom: rect.bottom }
  }, longPages.at(-1))
  assert.ok(lastPosition.top >= -1 && lastPosition.top < 842.25, JSON.stringify(lastPosition))
  await open('xmind')
  await page.locator('me-tpc').first().click()
  await page.getByRole('button', { name: 'Subtopic', exact: true }).click()
  await page.locator('#input-box').fill('Graphical branch')
  await page.locator('#input-box').press('Enter')
  const map = await JSZip.loadAsync(await save())
  assert.match(await map.file('content.json').async('string'), /Graphical branch/)
  await exportPage()
  await exportFile('Export as Image (SVG)…', '.svg')
  await exportFile('Export as Image (PNG)…', '.png')
  await exportFile('Export as Markdown Outline…', '.md')
  await page.screenshot({ path: new URL('build/xmind.png', root).pathname })

  await open('epub')
  const paragraph = page.frameLocator('iframe').locator('p[contenteditable="true"]').first()
  await paragraph.fill('EPUB edited on iPad')
  const epub = await JSZip.loadAsync(await save())
  assert.match(await epub.file('EPUB/chapter.xhtml').async('string'), /EPUB edited on iPad/)
  const bookPages = await exportPage()
  assert.match(bookPages[0].html, /EPUB edited on iPad/)
  await page.screenshot({ path: new URL('build/epub.png', root).pathname })
  await open('drawio')
  const reply = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const frame = document.querySelector('iframe')
        const id = 'smoke-create-shape'
        const timeout = setTimeout(() => reject(new Error('Bridge timeout')), 15000)
        const receive = (event) => {
          if (
            event.source !== frame.contentWindow ||
            event.origin !== location.origin ||
            event.data?.id !== id
          )
            return
          clearTimeout(timeout)
          window.removeEventListener('message', receive)
          resolve(event.data)
        }
        window.addEventListener('message', receive)
        frame.contentWindow.postMessage(
          {
            ieum: 1,
            kind: 'request',
            id,
            op: 'applyPrimitives',
            args: {
              primitives: [
                {
                  kind: 'add_cell',
                  page: 'page-1',
                  cell: {
                    id: 'ipad-shape',
                    parent: '1',
                    value: 'Graphical diagram',
                    kind: 'vertex',
                    style: 'rounded=1;whiteSpace=wrap;html=1;',
                    geometry: { x: 100, y: 100, width: 180, height: 80 },
                  },
                },
              ],
            },
          },
          location.origin,
        )
      }),
  )
  assert.equal(reply.ok, true, JSON.stringify(reply))
  assert.match((await save()).toString('utf8'), /Graphical diagram/)
  await exportPage()
  await exportFile('Export as Image (SVG)…', '.svg')
  await exportFile('Export as Image (PNG)…', '.png')
  await page.screenshot({ path: new URL('build/drawio.png', root).pathname })
  assert.deepEqual(exceptions, [])
  assert.deepEqual(requests, [])
  console.log(
    'HTML, graphical XMind, EPUB and full draw.io browser edit/save/export smoke passed; no external requests.',
  )
} finally {
  await browser.close()
  server.close()
}
