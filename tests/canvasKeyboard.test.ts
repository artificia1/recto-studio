import { describe, expect, it, vi } from 'vitest';
import { handleCanvasKeyDown } from '../src/engine/interaction/keyboard';
import { INITIAL_STATE } from '../src/state/defaults';

function harness() {
  const state = structuredClone(INITIAL_STATE);
  state.selectedElementId = 'selected';
  state.selectedElementIds = ['selected'];
  const commands = {
    getState: () => state,
    nudgeSelectedElements: vi.fn(), deleteSelectedElements: vi.fn(), deleteElement: vi.fn(),
    applyImageFitMode: vi.fn(), setTool: vi.fn(), undo: vi.fn(), redo: vi.fn(),
  };
  const interaction = { beginSpacePan: vi.fn(() => true), finishPenPath: vi.fn() };
  const dispatch = (key: string, overrides: Partial<KeyboardEvent> = {}) => {
    const event = { key, code: '', target: null, ctrlKey: false, metaKey: false,
      altKey: false, shiftKey: false, preventDefault: vi.fn(), ...overrides } as unknown as KeyboardEvent;
    handleCanvasKeyDown(event, commands, interaction);
    return event;
  };
  return { commands, interaction, dispatch, state };
}

describe('Canvas keyboard commands', () => {
  it.each(['INPUT', 'TEXTAREA', 'editable'])('does not intercept typing in %s', tag => {
    const { dispatch, commands } = harness();
    dispatch('z', { ctrlKey: true, target: { tagName: tag, isContentEditable: tag === 'editable' } as unknown as EventTarget });
    expect(commands.undo).not.toHaveBeenCalled();
  });
  it('preserves undo/redo and leaves Alt+Y available for Story Focus', () => {
    const { dispatch, commands } = harness();
    dispatch('z', { ctrlKey: true });
    dispatch('z', { metaKey: true, shiftKey: true });
    dispatch('y', { ctrlKey: true });
    dispatch('y', { ctrlKey: true, altKey: true });
    expect(commands.undo).toHaveBeenCalledTimes(1);
    expect(commands.redo).toHaveBeenCalledTimes(2);
  });
  it('retains normal, coarse and fine arrow nudges', () => {
    const { dispatch, commands } = harness();
    dispatch('ArrowRight'); dispatch('ArrowDown', { shiftKey: true }); dispatch('ArrowLeft', { altKey: true });
    expect(commands.nudgeSelectedElements.mock.calls).toEqual([[1, 0], [0, 10], [-0.1, 0]]);
  });
  it('routes selection deletion and image fitting', () => {
    const { dispatch, commands } = harness();
    dispatch('Delete');
    dispatch('c', { ctrlKey: true, altKey: true, shiftKey: true });
    expect(commands.deleteSelectedElements).toHaveBeenCalledOnce();
    expect(commands.applyImageFitMode).toHaveBeenCalledWith('fill');
  });
  it('delegates renderer-specific space-pan and pen completion', () => {
    const { dispatch, interaction } = harness();
    const event = dispatch(' ', { code: 'Space' });
    dispatch('Escape');
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(interaction.beginSpacePan).toHaveBeenCalledOnce();
    expect(interaction.finishPenPath).toHaveBeenCalledOnce();
  });
});
