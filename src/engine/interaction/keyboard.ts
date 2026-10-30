import type { StateManager } from '../../state/stateManager';

type KeyboardCommands = Pick<StateManager,
  | 'getState' | 'nudgeSelectedElements' | 'deleteSelectedElements' | 'deleteElement'
  | 'applyImageFitMode' | 'setTool' | 'undo' | 'redo'
>;

export interface CanvasKeyboardInteraction {
  beginSpacePan(): boolean;
  finishPenPath(): void;
}

/** Canvas shortcuts, independent of the renderer and DOM listener lifecycle. */
export function handleCanvasKeyDown(
  e: KeyboardEvent,
  commands: KeyboardCommands,
  interaction: CanvasKeyboardInteraction,
): void {
  const target = e.target as HTMLElement | null;
  if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return;
  const isMod = e.ctrlKey || e.metaKey;

  if (e.code === 'Space' && interaction.beginSpacePan()) {
    e.preventDefault();
    return;
  }

  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    const state = commands.getState();
    const hasSelection = (state.selectedElementIds && state.selectedElementIds.length > 0) || !!state.selectedElementId;
    if (hasSelection) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : (e.altKey ? 0.1 : 1);
      let dx = 0;
      let dy = 0;
      if (e.key === 'ArrowLeft') dx = -step;
      else if (e.key === 'ArrowRight') dx = step;
      else if (e.key === 'ArrowUp') dy = -step;
      else if (e.key === 'ArrowDown') dy = step;
      commands.nudgeSelectedElements(dx, dy);
      return;
    }
  }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    const state = commands.getState();
    if (state.selectedElementIds && state.selectedElementIds.length > 0) {
      commands.deleteSelectedElements();
    } else if (state.selectedElementId) {
      commands.deleteElement(state.selectedElementId);
    }
  } else if (isMod && e.altKey && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
    e.preventDefault();
    commands.applyImageFitMode('fill');
  } else if (isMod && e.altKey && e.shiftKey && (e.key === 'e' || e.key === 'E')) {
    e.preventDefault();
    commands.applyImageFitMode('fit');
  } else if (isMod && e.altKey && !e.shiftKey && (e.key === 'e' || e.key === 'E')) {
    e.preventDefault();
    commands.applyImageFitMode('contentToFrame');
  } else if (isMod && !e.altKey && e.shiftKey && (e.key === 'e' || e.key === 'E')) {
    e.preventDefault();
    commands.applyImageFitMode('center');
  } else if (!isMod && !e.altKey && (e.key === 'v' || e.key === 'V')) {
    commands.setTool('select');
  } else if (!isMod && !e.altKey && (e.key === 't' || e.key === 'T')) {
    commands.setTool('text');
  } else if (!isMod && !e.altKey && (e.key === 'p' || e.key === 'P')) {
    commands.setTool('pen');
  } else if (!isMod && !e.altKey && (e.key === 'n' || e.key === 'N')) {
    commands.setTool('pencil');
  } else if (!isMod && !e.altKey && (e.key === 'b' || e.key === 'B')) {
    commands.setTool('table');
  } else if (e.key === 'Escape' || e.key === 'Enter') {
    interaction.finishPenPath();
  } else if (!isMod && !e.altKey && (e.key === 'f' || e.key === 'F')) {
    commands.setTool('frame');
  } else if (!isMod && !e.altKey && (e.key === 'm' || e.key === 'M')) {
    commands.setTool('shape-rect');
  } else if (!isMod && !e.altKey && (e.key === 'h' || e.key === 'H')) {
    commands.setTool('hand');
  } else if (isMod && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    if (e.shiftKey) commands.redo();
    else commands.undo();
  } else if (isMod && !e.altKey && (e.key === 'y' || e.key === 'Y')) {
    e.preventDefault();
    commands.redo();
  }
}

