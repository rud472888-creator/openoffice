import { mkdir, writeFile } from 'node:fs/promises'
import { LANGS } from '@genoffice/i18n'
import { appStrings } from '../../slides/src/renderer/i18n/strings-app'
import { ribbonStrings } from '../../slides/src/renderer/i18n/strings-ribbon'
import { paneStrings } from '../../slides/src/renderer/i18n/strings-panes'

// Copy only the strings used on iPad from the existing 21 desktop translations.
const keys = {
  layout: 'ribbonLayout',
  select: 'paneFormatEmpty',
  objects: 'paneSelTitle',
  text: 'ribbonTextBox',
  rectangle: 'ribbonShapeRect',
  ellipse: 'ribbonShapeEllipse',
  image: 'ribbonPicture',
  insert: 'ribbonTabInsert',
  undo: 'ribbonUndo',
  redo: 'ribbonRedo',
  addSlide: 'ribbonNewSlide',
  duplicateSlide: 'appCtxDuplicateSlide',
  deleteSlide: 'appCtxDeleteSlide',
  up: 'paneMoveUp',
  down: 'paneMoveDown',
  deleteObject: 'appCtxDelete',
  front: 'appCtxBringForward',
  back: 'appCtxSendBackward',
  position: 'panePosSection',
  width: 'paneSizeWidth',
  height: 'paneSizeHeight',
  rotation: 'paneSizeRotation',
  bold: 'ribbonBold',
  italic: 'ribbonItalic',
  underline: 'ribbonUnderline',
  font: 'ribbonGroupFont',
  fontSize: 'ribbonFontSizeTip',
  textColor: 'ribbonFontColor',
  fill: 'paneFormatFill',
  stroke: 'paneFormatOutline',
  background: 'ribbonGroupBackground',
  none: 'paneFormatNoFill',
  alignLeft: 'ribbonAlignLeft',
  alignCenter: 'ribbonAlignCenter',
  alignRight: 'ribbonAlignRight',
  flipH: 'ribbonFlipH',
  flipV: 'ribbonFlipV',
  horizontal: 'panePosH',
  vertical: 'panePosV',
  point: 'paneFormatPt',
  shape: 'paneFormatShape',
  group: 'paneFormatGroup',
  table: 'ribbonGroupTable',
  chart: 'ribbonTabChartDesign',
  zoom: 'ribbonGroupZoom',
  present: 'ribbonFromCurrent',
  endShow: 'panePresenterEndShow',
  review: 'ribbonTabReview',
  notes: 'ribbonNotes',
  comments: 'paneCommentsTitle',
  newComment: 'paneCommentsPlaceholder',
  postComment: 'paneCommentsPost',
  apply: 'ribbonApply',
  animation: 'ribbonTabAnimations',
  effectFade: 'paneAnimEffFade',
  effectAppear: 'paneAnimEffAppear',
  effectFly: 'paneAnimEffFlyIn',
  effectSpin: 'paneAnimEffSpin',
  triggerClick: 'paneAnimTrigOnClick',
  triggerWith: 'paneAnimTrigWithPrev',
  triggerAfter: 'paneAnimTrigAfterPrev',
  duration: 'ribbonAnimDuration',
  delay: 'ribbonAnimDelay',
  transitions: 'ribbonTabTransitions',
  transitionNone: 'ribbonNone',
  transitionFade: 'ribbonTransFade',
  transitionPush: 'ribbonTransPush',
  transitionWipe: 'ribbonTransWipe',
  chartData: 'paneChartEditTitle',
  category: 'paneChartCategoryN',
  series: 'paneChartSeriesN',
  chartBar: 'ribbonChartKindBar',
  chartLine: 'ribbonChartKindLine',
  chartPie: 'ribbonChartKindPie',
}

export async function generateVisualCopy(): Promise<void> {
  const output: Record<string, Record<string, string>> = {}
  for (const lang of LANGS) {
    const dictionary: Record<string, string> = {
      ...appStrings[lang],
      ...ribbonStrings[lang],
      ...paneStrings[lang],
    }
    output[lang] = Object.fromEntries(
      Object.entries(keys).map(([key, source]) => {
        if (!dictionary[source]) throw new Error(`Missing desktop translation: ${lang}/${source}`)
        return [key, dictionary[source]]
      }),
    )
  }
  const directory = new URL('../src/i18n/', import.meta.url)
  await mkdir(directory, { recursive: true })
  await writeFile(new URL('visual-copy.json', directory), JSON.stringify(output, null, 2) + '\n')
}

await generateVisualCopy()
