import { mkdir, writeFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { createXmindDocument } from '@genoffice/xmind-engine'

const output = new URL('../../ipad/EveryOffice/Resources/Templates/', import.meta.url)
await mkdir(output, { recursive: true })
await writeFile(
  new URL('Blank.html', output),
  '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Untitled</title></head><body><h1>Untitled</h1><p>Start writing here.</p></body></html>\n',
)
const mind = await createXmindDocument({ sheetTitle: 'Mind Map', rootTitle: 'Central topic' })
await writeFile(new URL('Blank.xmind', output), await mind.save())
const epub = new JSZip()
epub.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
epub.file(
  'META-INF/container.xml',
  '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
)
epub.file(
  'EPUB/package.opf',
  '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:every-office-blank</dc:identifier><dc:title>Untitled</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-11-05T00:00:00Z</meta></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>',
)
epub.file(
  'EPUB/chapter.xhtml',
  '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Untitled</title></head><body><h1>Untitled</h1><p>Start writing here.</p></body></html>',
)
await writeFile(
  new URL('Blank.epub', output),
  await epub.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }),
)

await writeFile(
  new URL('Blank.drawio', output),
  '<mxfile host="every office"><diagram id="page-1" name="Page 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>',
)
