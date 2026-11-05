import { normalizeLang, type Lang } from '@genoffice/i18n'
import labels from './i18n/visual-copy.json'

const notices: Record<Lang, readonly [string, string]> = {
  en: [
    'Select an object, then drag or use its handles. Fonts and effects may look different. Unsupported content is read only and preserved.',
    'This content is read only and preserved.',
  ],
  ko: [
    '개체를 선택한 다음 끌거나 조절점을 사용하세요. 글꼴과 효과는 다르게 보일 수 있습니다. 지원하지 않는 내용은 읽기 전용으로 보존됩니다.',
    '이 내용은 읽기 전용으로 보존됩니다.',
  ],
  zh: [
    '选择对象后拖动或使用控制点。字体和效果可能有所不同。不支持的内容以只读方式保留。',
    '此内容以只读方式保留。',
  ],
  'zh-TW': [
    '選取物件後拖曳或使用控制點。字型與效果可能有所不同。不支援的內容以唯讀方式保留。',
    '此內容以唯讀方式保留。',
  ],
  ja: [
    'オブジェクトを選択してドラッグするか、ハンドルを使ってください。フォントや効果の表示が異なる場合があります。未対応の内容は読み取り専用で保持されます。',
    'この内容は読み取り専用で保持されます。',
  ],
  fr: [
    'Sélectionnez un objet, puis faites-le glisser ou utilisez ses poignées. Les polices et les effets peuvent différer. Le contenu non pris en charge reste en lecture seule et est conservé.',
    'Ce contenu est conservé en lecture seule.',
  ],
  de: [
    'Wählen Sie ein Objekt und ziehen Sie es oder verwenden Sie seine Griffe. Schriften und Effekte können anders aussehen. Nicht unterstützte Inhalte bleiben schreibgeschützt erhalten.',
    'Dieser Inhalt bleibt schreibgeschützt erhalten.',
  ],
  es: [
    'Selecciona un objeto y arrástralo o usa sus controles. Las fuentes y los efectos pueden verse distintos. El contenido no compatible se conserva como solo lectura.',
    'Este contenido se conserva como solo lectura.',
  ],
  th: [
    'เลือกวัตถุแล้วลากหรือใช้จุดควบคุม แบบอักษรและเอฟเฟกต์อาจแสดงต่างกัน เนื้อหาที่ไม่รองรับจะคงอยู่แบบอ่านอย่างเดียว',
    'เนื้อหานี้คงอยู่แบบอ่านอย่างเดียว',
  ],
  id: [
    'Pilih objek, lalu seret atau gunakan pegangannya. Font dan efek mungkin tampak berbeda. Konten yang tidak didukung dipertahankan sebagai hanya baca.',
    'Konten ini dipertahankan sebagai hanya baca.',
  ],
  ru: [
    'Выберите объект и перетащите его или используйте маркеры. Шрифты и эффекты могут выглядеть иначе. Неподдерживаемое содержимое сохраняется только для чтения.',
    'Это содержимое сохраняется только для чтения.',
  ],
  ar: [
    'حدد كائنًا ثم اسحبه أو استخدم مقابضه. قد تبدو الخطوط والتأثيرات مختلفة. يُحفظ المحتوى غير المدعوم للقراءة فقط.',
    'يُحفظ هذا المحتوى للقراءة فقط.',
  ],
  pt: [
    'Selecione um objeto e arraste-o ou utilize as alças. Os tipos de letra e os efeitos podem parecer diferentes. O conteúdo não suportado é preservado só de leitura.',
    'Este conteúdo é preservado só de leitura.',
  ],
  it: [
    'Seleziona un oggetto e trascinalo o usa le maniglie. Caratteri ed effetti potrebbero apparire diversi. I contenuti non supportati vengono conservati in sola lettura.',
    'Questo contenuto è conservato in sola lettura.',
  ],
  pl: [
    'Wybierz obiekt, a następnie przeciągnij go lub użyj uchwytów. Czcionki i efekty mogą wyglądać inaczej. Nieobsługiwana zawartość pozostaje zachowana tylko do odczytu.',
    'Ta zawartość pozostaje zachowana tylko do odczytu.',
  ],
  cs: [
    'Vyberte objekt a přetáhněte jej nebo použijte úchyty. Písma a efekty mohou vypadat jinak. Nepodporovaný obsah zůstává zachován jen pro čtení.',
    'Tento obsah zůstává zachován jen pro čtení.',
  ],
  nl: [
    'Selecteer een object en versleep het of gebruik de grepen. Lettertypen en effecten kunnen afwijken. Niet-ondersteunde inhoud blijft alleen-lezen behouden.',
    'Deze inhoud blijft alleen-lezen behouden.',
  ],
  ms: [
    'Pilih objek, kemudian seret atau gunakan pemegangnya. Fon dan kesan mungkin kelihatan berbeza. Kandungan yang tidak disokong dikekalkan sebagai baca sahaja.',
    'Kandungan ini dikekalkan sebagai baca sahaja.',
  ],
  he: [
    'בחרו אובייקט וגררו אותו או השתמשו בידיות שלו. גופנים ואפקטים עשויים להיראות אחרת. תוכן שאינו נתמך נשמר לקריאה בלבד.',
    'תוכן זה נשמר לקריאה בלבד.',
  ],
  hi: [
    'ऑब्जेक्ट चुनें, फिर खींचें या उसके हैंडल का उपयोग करें। फ़ॉन्ट और प्रभाव अलग दिख सकते हैं। असमर्थित सामग्री केवल पढ़ने के लिए सुरक्षित रहती है।',
    'यह सामग्री केवल पढ़ने के लिए सुरक्षित रहती है।',
  ],
  vi: [
    'Chọn đối tượng rồi kéo hoặc dùng các tay nắm. Phông chữ và hiệu ứng có thể hiển thị khác. Nội dung không được hỗ trợ được giữ nguyên ở chế độ chỉ đọc.',
    'Nội dung này được giữ nguyên ở chế độ chỉ đọc.',
  ],
}

export function visualCopy(language?: string) {
  const lang = normalizeLang(language)
  return { ...labels[lang], hint: notices[lang][0], readOnly: notices[lang][1] }
}
export type VisualCopy = ReturnType<typeof visualCopy>
