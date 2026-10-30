import { beforeEach, describe, expect, it } from 'vitest';
import { evaluateScript } from '../src/state/scriptRunner';
import { StateManager, INITIAL_STATE } from '../src/state/stateManager';

describe('Restricted publishing scripts', () => {
  let manager: StateManager;
  beforeEach(() => {
    manager = new StateManager();
    manager.loadFromJson(JSON.stringify(INITIAL_STATE));
  });
  it('supports the existing document summary example without executing browser alerts', () => {
    const result = evaluateScript('const state = stateManager.getState(); alert("Spreads: " + state.spreads.length);', manager.getState());
    expect(result.messages).toEqual([`Spreads: ${manager.getState().spreads.length}`]);
    expect(result.updates).toEqual([]);
  });
  it('updates text across spreads in one undoable transaction', () => {
    const original = structuredClone(manager.getState());
    const result = evaluateScript(`
      const state = stateManager.getState();
      for (const spread of state.spreads) {
        for (const element of spread.elements) {
          if (element.type === "text") {
            stateManager.updateElement(element.id, { text: element.text.toUpperCase() });
          }
        }
      }
    `, manager.getState());
    const target = original.spreads[0].elements.find(element => element.type === 'text')!;
    manager.applyScriptUpdates(result.updates);
    const updated = manager.getState().spreads[0].elements.find(element => element.id === target.id);
    expect(updated?.type === 'text' && updated.text).toBe(target.type === 'text' && target.text.toUpperCase());
    manager.undo();
    expect(manager.getState()).toEqual(original);
  });
  it.each([
    'fetch("https://example.com")',
    'window.localStorage.clear()',
    'globalThis.fetch("https://example.com")',
    'stateManager.constructor.constructor("return globalThis")()',
    '({})["__proto__"]',
    'new Function("return 1")()',
    'eval("alert(1)")',
    'import("https://example.com/script.js")',
    'while (true) {}',
    'const state = stateManager.getState(); state.settings.title = "changed";',
    'const x = { get secret() { return 1; } };',
    'const expression = /(a+)+$/;',
  ])('rejects unavailable capabilities: %s', code => {
    const original = structuredClone(manager.getState());
    expect(() => evaluateScript(code, manager.getState())).toThrow();
    expect(manager.getState()).toEqual(original);
  });
  it('rejects invalid updates atomically', () => {
    const original = structuredClone(manager.getState());
    const id = manager.getActiveSpread().elements[0].id;
    expect(() => manager.applyScriptUpdates([{ id, updates: { width: 50 } }, { id, updates: { width: -1 } }])).toThrow();
    expect(manager.getState()).toEqual(original);
  });
  it('respects element locks', () => {
    const id = manager.getActiveSpread().elements[0].id;
    manager.updateElement(id, { locked: true });
    expect(() => manager.applyScriptUpdates([{ id, updates: { width: 50 } }])).toThrow('locked');
  });
  it('bounds computational work', () => {
    const state = manager.getState();
    const code = 'const items = [1,2,3,4,5,6,7,8,9,10]; for (const a of items) { for (const b of items) { for (const c of items) { for (const d of items) { let x = a + b + c + d; } } } }';
    expect(() => evaluateScript(code, state)).toThrow('operation limit');
  });
});
