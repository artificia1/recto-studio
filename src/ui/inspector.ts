// Recto Studio Multi-Tab Inspector & Properties Controller
import { stateManager } from '../state/stateManager';
import { ProjectState, CanvasElement } from '../types/index';

export type InspectorTabId = 'properties' | 'styles' | 'layers' | 'links' | 'pages' | 'templates' | 'setup';

export interface InspectorTabDefinition {
  id: InspectorTabId;
  label: string;
  icon: string;
}

export const INSPECTOR_TABS: InspectorTabDefinition[] = [
  { id: 'properties', label: 'Properties', icon: '◧' },
  { id: 'styles', label: 'Styles', icon: '¶' },
  { id: 'layers', label: 'Layers', icon: '≡' },
  { id: 'links', label: 'Links', icon: '☍' },
  { id: 'pages', label: 'Pages', icon: '▥' },
  { id: 'templates', label: 'Templates', icon: '⊞' },
  { id: 'setup', label: 'Doc Setup', icon: '◫' },
];

/** Retrieves the currently active selection elements for inspection. */
export function getSelectedElements(state: ProjectState): CanvasElement[] {
  const activeSpread = state.spreads[state.activeSpreadIndex] || state.spreads[0];
  if (!activeSpread) return [];

  const selectedIds = state.selectedElementIds && state.selectedElementIds.length > 0
    ? state.selectedElementIds
    : state.selectedElementId ? [state.selectedElementId] : [];

  return activeSpread.elements.filter((el) => selectedIds.includes(el.id));
}

/** Updates geometric transform of the selected element. */
export function updateElementGeometry(
  elementId: string,
  geometry: Partial<{ x: number; y: number; width: number; height: number; rotation: number }>
): void {
  stateManager.updateElement(elementId, geometry);
}

/** Toggles lock protection for selected elements. */
export function toggleElementLocks(elementIds: string[]): void {
  stateManager.toggleLock(elementIds);
}
