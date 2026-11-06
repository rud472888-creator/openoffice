import { t, type StringKey } from '../../docs/src/renderer/i18n/locale'

/** Keep the desktop command groups accessible without covering the tablet canvas. */
export function installTouchTabs(toolbar: HTMLElement): void {
  const groups: Array<{ key: StringKey; commands: StringKey[] }> = [
    { key: 'ribbonTabHome', commands: [] },
    {
      key: 'ribbonTabInsert',
      commands: [
        'ribbonTable',
        'ribbonTableRowsLabel',
        'ribbonTableColsLabel',
        'ribbonPicture',
        'ribbonPageBreak',
        'ribbonLink',
        'ribbonHeader',
        'ribbonFooter',
        'ribbonEquation',
      ],
    },
    { key: 'ribbonTabLayout', commands: ['ribbonMargins', 'ribbonOrientation'] },
    {
      key: 'ribbonTabReferences',
      commands: ['ribbonFootnote', 'ribbonEndnote', 'ribbonToc', 'ribbonTocUpdate'],
    },
    {
      key: 'ribbonTabReview',
      commands: [
        'ribbonTrackChanges',
        'ribbonAcceptOne',
        'ribbonRejectOne',
        'ribbonAcceptAll',
        'ribbonRejectAll',
        'ribbonComment',
      ],
    },
    {
      key: 'ribbonTabTableLayout',
      commands: [
        'ribbonInsertBelow',
        'ribbonInsertRight',
        'ribbonDeleteRow',
        'ribbonDeleteColumn',
        'ribbonMergeCells',
        'ribbonSplitCells',
        'ribbonTableProperties',
      ],
    },
    {
      key: 'ribbonTabPictureFormat',
      commands: [
        'ribbonTabPictureFormat',
        'ribbonRotateRight',
        'ribbonFlipH',
        'ribbonFlipV',
        'ribbonCrop',
        'ribbonRemoveBg',
      ],
    },
    { key: 'ribbonTabDesign', commands: ['ribbonStyleNew', 'ribbonStyleModify'] },
    { key: 'ribbonTabView', commands: ['ribbonPageWidth'] },
  ]
  const labels = new Map<string, StringKey>()
  for (const group of groups) for (const key of group.commands) labels.set(t(key), group.key)
  const always = new Set(
    ['ribbonPagePreview', 'appExportPdf', 'appPrintTitle'].map((key) => t(key as StringKey)),
  )
  const controls = [...toolbar.children].filter(
    (element) => !(element as HTMLElement).hidden,
  ) as HTMLElement[]
  for (const control of controls) {
    const label = control.getAttribute('aria-label') ?? control.textContent ?? ''
    control.dataset.ribbonTab = always.has(label)
      ? 'always'
      : (labels.get(label) ?? 'ribbonTabHome')
  }
  const navigation = document.createElement('select')
  navigation.className = 'ribbon-category'
  const select = (key: StringKey) => {
    for (const control of controls)
      control.hidden = control.dataset.ribbonTab !== key && control.dataset.ribbonTab !== 'always'
    navigation.value = key
    navigation.setAttribute('aria-label', t(key))
  }
  for (const group of groups) {
    if (!controls.some((control) => control.dataset.ribbonTab === group.key)) continue
    const option = document.createElement('option')
    option.value = group.key
    option.textContent = t(group.key)
    navigation.append(option)
  }
  navigation.addEventListener('change', () => {
    select(navigation.value as StringKey)
    toolbar.scrollLeft = 0
  })
  toolbar.prepend(navigation)
  select('ribbonTabHome')
}
