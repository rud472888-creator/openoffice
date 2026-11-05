import JSZip from 'jszip'
import { createBlankPptx } from '../../../packages/pptx-engine/src/blank'

/** Reuse the engine's valid master/layout/theme package and add two ordinary text boxes. */
export async function createPresentationTemplate(): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(await createBlankPptx())
  const slide = await zip.file('ppt/slides/slide1.xml')!.async('string')
  const shape = (
    id: number,
    name: string,
    text: string,
    y: number,
    size: number,
    color: string,
  ): string =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="914400" y="${y}"/><a:ext cx="10363200" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="${size}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Calibri"/></a:rPr><a:t>${text}</a:t></a:r><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`
  zip.file(
    'ppt/slides/slide1.xml',
    slide.replace(
      '</p:spTree>',
      shape(2, 'Title', 'Title', 2057400, 4000, 'C43E1C') +
        shape(3, 'Subtitle', 'Subtitle', 3200400, 2200, '606366') +
        '</p:spTree>',
    ),
  )
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
