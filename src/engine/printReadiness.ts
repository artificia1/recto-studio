import type { ProjectState } from '../types';
import { masterDependencies } from './masterInheritance';

export interface PrintReadinessItem {
  code: 'transparency' | 'shadow' | 'spot' | 'font';
  elementId: string;
  message: string;
  severity: 'error' | 'review';
}

/** Reports actual exporter boundaries. A report is never a PDF/X validation result. */
export function printReadiness(state: ProjectState) {
  const usedMasters = masterDependencies(state.masterSpreads, state.spreads.map(spread => spread.masterSpreadId));
  const elements = [...state.spreads.flatMap(spread => spread.elements),
    ...state.masterSpreads.filter(master => usedMasters.has(master.id)).flatMap(master => master.elements)];
  const items: PrintReadinessItem[] = [];
  const seen = new Set<string>();
  for (const element of elements) {
    if (seen.has(element.id) || element.pasteboard || element.editorialOnly || state.layers?.find(layer => layer.id === element.layerId)?.visible === false) continue;
    seen.add(element.id);
    const add = (code: PrintReadinessItem['code'], message: string, severity: PrintReadinessItem['severity'] = 'review') => items.push({ code, elementId: element.id, message, severity });
    if (element.opacity < 1) add('transparency', 'Live object opacity requires a transparency-capable printer workflow. No flattening is performed.');
    if (element.blendMode && element.blendMode !== 'normal') add('transparency', 'Live PDF blending is preserved. Review the printer blending colour space and separations; this is not PDF/X certification.');
    if (element.shadow) add('shadow', 'Object shadows are not reproduced by this PDF exporter. Remove the effect or supply flattened artwork.', 'error');
    if (element.spotColor) add('spot', 'Confirm spot ink, overprint and trapping settings with the printer. Automatic choke/spread trapping is not implemented.');
    if (element.type === 'text') {
      const family = element.fontFamily.split(',')[0].trim().replace(/['"]/g, '');
      const embedded = state.embeddedFonts?.some(font => font.family === family);
      if (!embedded) add('font', `The font “${element.fontFamily}” has no matching embedded source file. Check PDF substitution and non-Latin glyphs.`, /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(element.text) ? 'error' : 'review');
    }
  }
  return {
    format: 'Ordinary PDF', certifiedPdfX: false, iccConversion: !!state.settings.colorManagement?.convertPdf,
    automaticTrapping: false, transparencyFlattening: false, items,
    requirements: [
      'PDF/X-4 needs a supported colour-managed PDF pipeline, an appropriate ICC output intent, complete font handling and independent conformance validation.',
      state.settings.colorManagement?.convertPdf ? 'Vector RGB colours and supported sRGB raster assets are converted through LittleCMS using the embedded output profile. Explicit CMYK values remain unchanged.' : 'A profile name is not ICC conversion. Import a CMYK output ICC profile and enable PDF conversion for managed output.',
      'Trap widths depend on the press, substrate, ink and object geometry. No universal automatic trap width is applied.',
    ],
  };
}
