import { describe, expect, it } from 'vitest';
import { StateHistory } from '../src/state/history';
import { INITIAL_STATE } from '../src/state/stateManager';
import { INITIAL_STATE as defaults } from '../src/state/defaults';

describe('Document history', () => {
  it('preserves the existing public defaults export', () => {
    expect(INITIAL_STATE).toBe(defaults);
  });
  it('respects the configured capacity and both navigation boundaries', () => {
    const history = new StateHistory<{ value: number }>(3);
    for (let value = 0; value < 5; value++) history.push({ value });
    expect(history.undo()).toEqual({ value: 3 });
    expect(history.undo()).toEqual({ value: 2 });
    expect(history.undo()).toBeNull();
    expect(history.redo()).toEqual({ value: 3 });
    expect(history.redo()).toEqual({ value: 4 });
    expect(history.redo()).toBeNull();
  });
  it('discards the old redo branch when editing after undo', () => {
    const history = new StateHistory<string>();
    history.push('A'); history.push('B'); history.push('C');
    expect(history.undo()).toBe('B');
    history.push('D');
    expect(history.redo()).toBeNull();
    expect(history.undo()).toBe('B');
    expect(history.redo()).toBe('D');
  });
  it('isolates stored snapshots from input and restored-state mutations', () => {
    const history = new StateHistory<{ nested: { value: number } }>();
    const first = { nested: { value: 1 } };
    history.push(first);
    first.nested.value = 99;
    history.push({ nested: { value: 2 } });
    const restored = history.undo()!;
    expect(restored.nested.value).toBe(1);
    restored.nested.value = 88;
    history.redo();
    expect(history.undo()?.nested.value).toBe(1);
  });
  it('resets completely when starting a new document', () => {
    const history = new StateHistory<number>();
    history.push(1); history.push(2); history.clear();
    expect(history.undo()).toBeNull();
    expect(history.redo()).toBeNull();
    history.push(3);
    expect(history.undo()).toBeNull();
  });
});
