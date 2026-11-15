import type { ProjectState } from '../types';
import { fullImageSource } from './publicationAssets';

export function idmlHandoffFindings(state: ProjectState) {
  return [...state.spreads, ...state.masterSpreads].flatMap(spread => spread.elements.flatMap(element => {
    if (element.pasteboard || element.editorialOnly) return [];
    const findings: { severity: 'error' | 'warning'; spreadId: string; elementId: string; message: string }[] = [];
    const add = (severity: 'error' | 'warning', message: string) => findings.push({ severity, spreadId: spread.id, elementId: element.id, message });
    if ((element.type === 'image' && element.adjustments) ||
      ((element.type === 'shape' || element.type === 'path') && (element.decoration || element.strokePattern))) {
      add('error', 'Image adjustments or vector effects need to be prepared as artwork before IDML handoff.');
    }
    if (element.type === 'image' && !fullImageSource(element).startsWith('data:')) {
      add('warning', 'The original image bytes are outside the IDML package. Embed or relink this artwork for a portable handoff.');
    }
    if (element.groupId) add('warning', 'The objects remain editable as separate items. Rebuild the group in InDesign.');
    if (element.rotation && element.type !== 'path' && !(element.type === 'shape' && element.shapeKind === 'line')) {
      add('warning', 'Review the rotation in InDesign. This frame exports using unrotated geometry.');
    }
    if (element.shadow || (element.blendMode && element.blendMode !== 'normal')) {
      add('warning', 'Proof the appearance in PDF. IDML handoff does not preserve this shadow or blend mode.');
    }
    return findings;
  }));
}
