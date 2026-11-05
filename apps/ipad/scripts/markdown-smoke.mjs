/* global window */
import { chromium } from 'playwright-core'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
const root = new URL('../../../', import.meta.url)
const html = await readFile(
  new URL('apps/ipad/EveryOffice/Resources/MarkdownEditor/index.html', root),
)
const out = new URL('apps/ipad/build/browser-smoke/', root)
await mkdir(out, { recursive: true })
const server = createServer((_request, response) =>
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html),
)
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox'],
})
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true })
  const errors = [],
    remote = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.message)
  })
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith(address))
      remote.push(request.url())
  })
  await page.addInitScript(() => {
    window.nativeMessages = []
    window.webkit = {
      messageHandlers: {
        everyOffice: {
          postMessage(message) {
            window.nativeMessages.push(message)
          },
        },
      },
    }
  })
  await page.goto(address)
  await page.waitForFunction(() =>
    window.nativeMessages.some((message) => message.type === 'ready'),
  )
  for (const [kind, text] of [
    ['md', '\uFEFF---\r\ntitle: 원문\r\n---\r\n\r\n# 제목\r\n\r\n본문\r\n'],
    ['txt', 'plain text\r\n'],
    ['json', '{"name":"원문"}\r\n'],
  ]) {
    await page.evaluate(
      ({ kind, base64 }) =>
        window.everyOffice.openDocument({ name: `검증.${kind}`, kind, language: 'ko', base64 }),
      { kind, base64: Buffer.from(text).toString('base64') },
    )
    await page.evaluate(() => {
      window.nativeMessages = []
    })
    assert.equal(await page.evaluate(() => window.everyOffice.saveDocument()), true)
    const initial = await page.evaluate(() =>
      window.nativeMessages.filter((message) => message.type === 'save').at(-1),
    )
    assert.equal(Buffer.from(initial.base64, 'base64').toString('utf8'), text)
    const target = page.locator(kind === 'md' ? '.ipad-markdown-content' : '.cm-content')
    await target.click()
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText(kind === 'json' ? ' ' : ' 한글 추가')
    await page.waitForFunction(() =>
      window.nativeMessages.some((message) => message.type === 'changed'),
    )
    assert.equal(await page.evaluate(() => window.everyOffice.saveDocument()), true)
    const changed = await page.evaluate(() =>
      window.nativeMessages.filter((message) => message.type === 'save').at(-1),
    )
    const written = Buffer.from(changed.base64, 'base64').toString('utf8')
    if (kind !== 'json') assert.ok(written.includes('한글 추가'))
    if (kind === 'md') assert.ok(written.startsWith('\uFEFF---\r\ntitle: 원문\r\n---\r\n'))
    await page.evaluate(
      ({ kind, base64 }) =>
        window.everyOffice.openDocument({ name: `재열기.${kind}`, kind, language: 'ko', base64 }),
      { kind, base64: changed.base64 },
    )
    if (kind === 'md') {
      await page.getByRole('button', { name: 'PDF', exact: true }).click()
      const pdf = await page.evaluate(() =>
        window.nativeMessages.filter((message) => message.type === 'exportPDF').at(-1),
      )
      assert.equal(pdf.pages[0].paginate, true)
      assert.ok(pdf.pages[0].html.includes('한글 추가'))
      assert.ok(!/<(?:script|iframe|object|embed|meta|base)\b/i.test(pdf.pages[0].html))
      await page.getByRole('button', { name: 'DOCX', exact: true }).click()
      await page.waitForFunction(() =>
        window.nativeMessages.some((message) => message.type === 'importCopy'),
      )
      const copy = await page.evaluate(() =>
        window.nativeMessages.filter((message) => message.type === 'importCopy').at(-1),
      )
      const archive = await JSZip.loadAsync(Buffer.from(copy.base64, 'base64'))
      assert.ok((await archive.file('word/document.xml').async('string')).includes('한글 추가'))
    }
    await page.screenshot({ path: fileURLToPath(new URL(`markdown-${kind}.png`, out)) })
  }
  await page.evaluate(
    (base64) =>
      window.everyOffice.openDocument({
        name: 'Diagrams.md',
        kind: 'md',
        language: 'en',
        base64,
      }),
    Buffer.from(
      '# Diagrams\n\n```mermaid\ngraph TD\n A[Start] --> B[Finish]\n```\n\n$$\nx^2\n$$\n\nInline $y^2$\n',
    ).toString('base64'),
  )
  await page.locator('[data-diagram="rendered"]').waitFor()
  await page.evaluate(() => {
    window.nativeMessages = []
  })
  await page.getByRole('button', { name: 'DOCX', exact: true }).click()
  await page.waitForFunction(() =>
    window.nativeMessages.some((message) => message.type === 'importCopy'),
  )
  const diagramCopy = await page.evaluate(() =>
    window.nativeMessages.find((message) => message.type === 'importCopy'),
  )
  const diagramArchive = await JSZip.loadAsync(Buffer.from(diagramCopy.base64, 'base64'))
  assert.ok(
    Object.keys(diagramArchive.files).some(
      (name) => name.startsWith('word/media/') && !diagramArchive.files[name].dir,
    ),
  )
  const mathXML = await diagramArchive.file('word/document.xml').async('string')
  assert.ok(mathXML.includes('m:oMath'))
  assert.ok(mathXML.includes('$y^2$'))
  await page.locator('.ipad-markdown-content').click()
  await page.keyboard.press('Control+End')
  await page.getByRole('button', { name: 'Footnote', exact: true }).click()
  await page.keyboard.insertText('Footnote roundtrip')
  await page.evaluate(() => {
    window.nativeMessages = []
  })
  assert.equal(await page.evaluate(() => window.everyOffice.saveDocument()), true)
  const footnote = await page.evaluate(() =>
    window.nativeMessages.find((message) => message.type === 'save'),
  )
  assert.ok(
    Buffer.from(footnote.base64, 'base64').toString('utf8').includes('[^1]: Footnote roundtrip'),
  )
  assert.deepEqual(errors, [])
  assert.deepEqual(remote, [])
  await writeFile(
    new URL('markdown-result.json', out),
    JSON.stringify(
      {
        passed: true,
        checks: [
          'Markdown blocks',
          'TXT/JSON CodeMirror',
          'BOM/CRLF/frontmatter',
          'Korean edit/save/reopen',
          'offline',
          'PDF pagination payload and DOCX export',
          'Mermaid PNG and editable math DOCX output',
        ],
      },
      null,
      2,
    ),
  )
  console.log('PASS Markdown/TXT/JSON desktop editors, preservation and save/reopen')
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
