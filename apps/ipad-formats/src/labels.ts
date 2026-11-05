import { createI18n, LANGS, type Lang } from '@genoffice/i18n'
import { strings as htmlStrings } from '../../html/src/renderer/i18n/strings'
import { strings as epubStrings } from '../../epub/src/renderer/i18n/strings'
import { translateIn } from '../../mindmap/src/renderer/i18n/locale'

const html = createI18n(htmlStrings)
const epub = createI18n(epubStrings)

export function editorLanguage(language: string): Lang {
  const normalized = /^zh-(?:hant|tw)/i.test(language)
    ? 'zh-TW'
    : language.split('-')[0]!.toLowerCase()
  return LANGS.find((lang) => lang === normalized) ?? 'en'
}

/** Reuse the desktop's complete 21-language dictionaries for shared controls. */
export function label(text: string, language: string): string {
  const lang = editorLanguage(language)
  const labels: Record<string, () => string> = {
    'Export PDF': () => translateIn(lang, 'exportPdf'),
    'Export PNG': () => translateIn(lang, 'exportPng'),
    'Export SVG': () => translateIn(lang, 'exportSvg'),
    'Export Markdown': () => translateIn(lang, 'exportMarkdown'),
    Print: () =>
      ({
        en: 'Print',
        ko: '인쇄',
        ja: '印刷',
        zh: '打印',
        'zh-TW': '列印',
        ar: 'طباعة',
        cs: 'Tisk',
        de: 'Drucken',
        es: 'Imprimir',
        fr: 'Imprimer',
        he: 'הדפסה',
        hi: 'प्रिंट करें',
        id: 'Cetak',
        it: 'Stampa',
        ms: 'Cetak',
        nl: 'Afdrukken',
        pl: 'Drukuj',
        pt: 'Imprimir',
        ru: 'Печать',
        th: 'พิมพ์',
        vi: 'In',
      })[lang],
    'Export HTML': () => html(lang, 'saveAs'),
    Save: () => html(lang, 'save'),
    Undo: () => html(lang, 'undo'),
    Redo: () => html(lang, 'redo'),
    Apply: () => html(lang, 'imageApply'),
    Cancel: () => html(lang, 'cancel'),
    'Source / Preview': () => `${html(lang, 'viewSource')} / ${html(lang, 'viewPreview')}`,
    'HTML source': () => html(lang, 'viewSource'),
    'HTML preview': () => html(lang, 'viewPreview'),
    'Edit selected text': () => html(lang, 'editText'),
    'Edit text': () => html(lang, 'editText'),
    'Insert paragraph': () => html(lang, 'insertParagraph'),
    Previous: () => epub(lang, 'prevChapter'),
    Next: () => epub(lang, 'nextChapter'),
    Bold: () => epub(lang, 'editBold'),
    Italic: () => epub(lang, 'editItalic'),
    Chapters: () => epub(lang, 'toc'),
    'Add sheet': () => translateIn(lang, 'sheetAdd'),
    'Rename sheet': () => translateIn(lang, 'sheetRename'),
    'Mind map sheets': () => translateIn(lang, 'sheetTabs'),
    'Sheet title': () => translateIn(lang, 'sheetRename'),
    Fit: () => translateIn(lang, 'zoomFit'),
  }
  return labels[text]?.() ?? text
}
