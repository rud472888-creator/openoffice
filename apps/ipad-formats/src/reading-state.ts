import type { EpubReadingState, EpubReadPosition, EpubViewPrefs } from '../../epub/src/shared/ipc'

export function readingState(value: unknown, chapters: number): EpubReadingState {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const rawPrefs =
    record.viewPrefs && typeof record.viewPrefs === 'object'
      ? (record.viewPrefs as Record<string, unknown>)
      : {}
  const number = (value: unknown, low: number, high: number, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high
      ? value
      : fallback
  const viewPrefs: EpubViewPrefs = {
    fontScale: number(rawPrefs.fontScale, 0.5, 3, 1),
    lineHeight: rawPrefs.lineHeight == null ? null : number(rawPrefs.lineHeight, 1, 3, 1.5),
    dark: rawPrefs.dark === true,
  }
  const raw =
    record.position && typeof record.position === 'object'
      ? (record.position as Record<string, unknown>)
      : {}
  const position: EpubReadPosition | null =
    typeof raw.spineIndex === 'number' &&
    Number.isInteger(raw.spineIndex) &&
    raw.spineIndex >= 0 &&
    raw.spineIndex < chapters
      ? {
          spineIndex: raw.spineIndex,
          blockId:
            typeof raw.blockId === 'string' && raw.blockId.length <= 512 ? raw.blockId : null,
        }
      : null
  return { position, viewPrefs }
}
