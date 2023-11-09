// Papercut Studio Left InDesign Tool Rail Controller
import { ToolType } from '../types/index';
import { stateManager } from '../state/stateManager';

export interface ToolItem {
  id: ToolType;
  name: string;
  shortcut: string;
  icon: string;
}

export const TOOL_ITEMS: ToolItem[] = [
  { id: 'select', name: 'Selection Tool', shortcut: 'V', icon: '↖' },
  { id: 'text', name: 'Type Tool', shortcut: 'T', icon: 'T' },
  { id: 'frame', name: 'Rectangle Frame Tool', shortcut: 'F', icon: '☒' },
  { id: 'shape-rect', name: 'Rectangle Tool', shortcut: 'M', icon: '▭' },
  { id: 'shape-ellipse', name: 'Ellipse Tool', shortcut: 'L', icon: '○' },
  { id: 'shape-line', name: 'Line Tool', shortcut: '\\', icon: '/' },
  { id: 'pen', name: 'Pen Tool', shortcut: 'P', icon: '✒' },
  { id: 'table', name: 'Table Tool', shortcut: 'Shift+T', icon: '⊞' },
  { id: 'hand', name: 'Hand Tool', shortcut: 'H', icon: '✋' },
  { id: 'zoom', name: 'Zoom Tool', shortcut: 'Z', icon: '🔍' },
];

/** Maps a key press event to a tool selection action. */
export function handleToolKeyboardShortcut(key: string, isShift = false): ToolType | null {
  const normalizedKey = key.toUpperCase();
  if (isShift && normalizedKey === 'T') return 'table';
  const found = TOOL_ITEMS.find((t) => t.shortcut === normalizedKey);
  return found ? found.id : null;
}

/** Activates the requested tool in the global state manager. */
export function setActiveTool(tool: ToolType): void {
  stateManager.setTool(tool);
}
