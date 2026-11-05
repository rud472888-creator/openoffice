import type { OpenedPptx } from '../../../packages/pptx-engine/src/index'
import {
  PresentationDocument,
  relationships,
  relsPath,
  resolveTarget,
  scanXml,
} from './presentation'

/** Snapshot facade for the desktop XML mutators; media buffers remain in the original archive. */
export async function desktopXmlArchive(
  document: PresentationDocument,
): Promise<{ opened: OpenedPptx; changes(): Map<string, Uint8Array> }> {
  const entries = new Map<string, Uint8Array>()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  for (const path of document.partPaths()) {
    const xml = path.endsWith('.xml') || path.endsWith('.rels')
    const bytes = xml ? await document.readPart(path) : new Uint8Array()
    if (!bytes) continue
    if (xml) scanXml(decoder.decode(bytes), () => {})
    entries.set(path, bytes)
  }
  document.slides.forEach((slide, index) =>
    entries.set(slide.path, new TextEncoder().encode(document.currentSlideXml(index))),
  )
  const originals = new Map(entries)
  const readText = (path: string): string | null =>
    entries.has(path) ? decoder.decode(entries.get(path)!) : null
  const readRels = (path: string) =>
    new Map(
      [...relationships(readText(relsPath(path)) ?? '<Relationships/>')].map(([id, rel]) => [
        id,
        {
          id,
          type: rel.type,
          target: rel.target,
          ...(rel.external ? { targetMode: 'External' } : {}),
        },
      ]),
    )
  const archive = {
    entries,
    readText,
    readBytes: (path: string) => entries.get(path) ?? null,
    has: (path: string) => entries.has(path),
    readRels,
    originalHash: '',
    readPresentation: () => ({
      size: { cx: 12192000, cy: 6858000 },
      slidePaths: document.slides.map((slide) => slide.path),
    }),
    resolveSlideChain: (path: string) => {
      const target = (base: string, kind: string) => {
        const rel = [...readRels(base).values()].find((rel) => rel.type.endsWith(`/${kind}`))
        return rel ? resolveTarget(base, rel.target) : undefined
      }
      const layoutPath = target(path, 'slideLayout'),
        masterPath = layoutPath ? target(layoutPath, 'slideMaster') : undefined
      return {
        layoutPath,
        masterPath,
        themePath: masterPath ? target(masterPath, 'theme') : undefined,
      }
    },
  }
  const opened = {
    archive,
    deck: {
      slides: document.slides.map((slide) => ({
        path: slide.path,
        originalXml: slide.originalXml,
        bodyPrefix: '',
        bodySuffix: '',
        elements: [],
      })),
      size: { cx: 12192000, cy: 6858000 },
      originalHash: '',
    },
  } as unknown as OpenedPptx
  return {
    opened,
    changes() {
      if ([...originals.keys()].some((path) => !entries.has(path))) throw new Error('readOnly')
      return new Map([...entries].filter(([path, value]) => originals.get(path) !== value))
    },
  }
}
