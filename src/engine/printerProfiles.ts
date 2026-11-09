import type { CanvasElement, ProjectState } from '../types';
import { explicitCmyk } from './inkColors';
import { resolveMaster } from './masterInheritance';
import { masterTargetPage } from './pageLabels';

export interface PrinterProfile {
  name: string;
  bleedMm: number;
  minDpi: number;
  maxInk: number;
  iccId?: string;
  iccName?: string;
}
export interface PrinterIssue { message: string; page?: number; spread?: number; severity: 'error' | 'review' }

export function parsePrinterProfile(value: unknown): PrinterProfile {
  if (!value || typeof value !== 'object') throw new Error('Choose a valid printer profile.');
  const { name, bleedMm, minDpi, maxInk, iccId, iccName } = value as Partial<PrinterProfile>;
  if (typeof name !== 'string' || !name.trim() || name.length > 80 ||
    typeof bleedMm !== 'number' || !Number.isFinite(bleedMm) || bleedMm < 0 || bleedMm > 50 ||
    typeof minDpi !== 'number' || !Number.isFinite(minDpi) || minDpi < 0 || minDpi > 2400 ||
    typeof maxInk !== 'number' || !Number.isFinite(maxInk) || maxInk < 100 || maxInk > 400 ||
    (iccId !== undefined && (typeof iccId !== 'string' || !/^[a-f0-9]{64}$/i.test(iccId))) ||
    (iccName !== undefined && (typeof iccName !== 'string' || iccName.length > 500))) throw new Error('Check the printer name, bleed, image resolution and ink limit.');
  return { name: name.trim(), bleedMm, minDpi, maxInk, iccId, iccName };
}

const visible = (state: ProjectState, element: CanvasElement) => element.opacity > 0 && !element.pasteboard && !element.editorialOnly &&
  state.layers.find(layer => layer.id === element.layerId)?.visible !== false;

export function checkPrinterProfile(profile: PrinterProfile, state: ProjectState, includeBleed: boolean): PrinterIssue[] {
  const issues: PrinterIssue[] = [];
  const bleed = includeBleed ? state.settings.bleedMm || 0 : 0;
  if (bleed < profile.bleedMm) issues.push({ severity: 'error', message: `${profile.name} requires ${profile.bleedMm} mm bleed. This export has ${bleed} mm.` });
  const managed = state.settings.colorManagement;
  if (profile.iccId && (!managed?.convertPdf || managed.outputProfile.id !== profile.iccId)) issues.push({ severity: 'error', message: `Enable PDF conversion with the required ICC profile (${profile.iccName || profile.iccId}).` });
  let unsampledInk = false;
  for (const [spreadIndex, spread] of state.spreads.entries()) {
    const master = resolveMaster(state.masterSpreads, spread.masterSpreadId);
    for (const page of spread.pages) {
      const inherited = master?.elements.filter(element => masterTargetPage(master.pages, spread.pages, element.pageId)?.id === page.id &&
        !spread.detachedMasterElementIds?.includes(element.id) && !spread.elements.some(local => local.pageId === page.id && local.masterSourceId === element.id)) || [];
      for (const element of [...inherited, ...spread.elements.filter(item => item.pageId === page.id)]) {
        if (!visible(state, element)) continue;
        const label = element.name || element.type;
        const add = (severity: PrinterIssue['severity'], message: string) => issues.push({ severity, message, page: page.pageNumber, spread: spreadIndex });
        if (element.type === 'image' && !element.equation && !element.src.startsWith('data:image/svg+xml')) {
          unsampledInk = true;
          let dpi: number | undefined;
          if (element.originalWidth && element.originalHeight && element.width > 0 && element.height > 0) {
            const x = element.originalWidth * 25.4 / element.width;
            const y = element.originalHeight * 25.4 / element.height;
            dpi = element.fitMode === 'fit' ? Math.max(x, y) : element.fitMode === 'center' ? 96 : Math.min(x, y);
          } else dpi = element.actualDpi;
          if (profile.minDpi && !dpi) add('review', `Resolution is unknown for ${label}.`);
          else if (dpi && dpi < profile.minDpi) add('error', `${label} is approximately ${Math.round(dpi)} dpi. ${profile.name} requires ${profile.minDpi} dpi.`);
        }
        const inks = element.type === 'shape' || element.type === 'path' ? [...(element.fillGradient?.stops.map(stop => stop.color) || [element.fillColor]), element.strokeColor] :
          element.type === 'text' ? [element.color, element.backgroundColor, element.borderColor,
            ...element.textContent?.paragraphs.flatMap(paragraph => paragraph.runs.map(run => run.color)) || []] : [];
        for (const color of inks) {
          if (!color || color === 'transparent' || color === 'none') continue;
          const process = explicitCmyk(color);
          if (!process) { unsampledInk = true; continue; }
          const total = process.reduce((sum, channel) => sum + channel, 0);
          if (total > profile.maxInk) add('error', `${label} uses ${total}% explicit process ink. ${profile.name} allows ${profile.maxInk}%.`);
        }
      }
    }
  }
  if (unsampledInk) issues.push({ severity: 'review', message: `Check converted colours, blends and raster artwork against the ${profile.maxInk}% ink limit in the final printer proof.` });
  return issues;
}
