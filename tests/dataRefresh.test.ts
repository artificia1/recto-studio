import { beforeEach, describe, expect, it } from 'vitest';
import { StateManager } from '../src/state/stateManager';
import { previewDataRefresh } from '../src/engine/dataRefresh';
import { storyText } from '../src/engine/storyContent';
import { ornamentalRosette } from '../src/engine/ornamentalRosette';
import { parseProject } from '../src/state/projectValidation';
import type { TextElement } from '../src/types';

const frame = (manager: StateManager, id: string): TextElement => ({ id, type: 'text', pageId: manager.getActiveSpread().pages[0].id,
  x: 20, y: 20, width: 15, height: 8, text: '$1', rotation: 0, opacity: 1, zIndex: 1, locked: false,
  fontFamily: 'Times', fontSizePt: 11, lineHeight: 1.3, letterSpacingPt: 0, color: '#111', alignment: 'left',
  columns: 1, columnGutterMm: 4, paddingMm: 0, borderWidthMm: 0, borderColor: 'transparent', backgroundColor: 'transparent' });

describe('reviewed catalog snapshot refresh', () => {
  let manager: StateManager;
  beforeEach(() => {
    manager = new StateManager(); manager.createBlankProject('A4', 'Bound data', false);
    manager.getState(); // Normalize the legacy defaults before recording the editing history.
    for (const id of ['a', 'b']) {
      manager.addElement(frame(manager, id));
      manager.bindTextData(id, { source: 'Inventory', keyField: 'sku', recordKey: id, field: 'price' });
    }
  });
  it('previews without mutation, applies all values in one undo and reports overflow', () => {
    const before = manager.exportJson();
    const changes = previewDataRefresh(manager.getState(), 'Inventory', [{ sku: 'a', price: '$129.00' }, { sku: 'b', price: 'A deliberately long price description' }]);
    expect(manager.exportJson()).toBe(before);
    manager.applyDataRefresh(changes);
    expect(storyText(manager.getStoryContent('a'))).toBe('$129.00');
    expect(manager.runPreflightCheck().some(issue => issue.code === 'OVERSET_TEXT' && issue.elementId === 'b')).toBe(true);
    expect(() => parseProject(manager.exportJson(), manager.getState())).not.toThrow();
    manager.undo(); expect(manager.exportJson()).toBe(before);
    manager.redo(); expect(storyText(manager.getStoryContent('a'))).toBe('$129.00');
  });
  it('rejects stale or locked batches without updating the other frames', () => {
    const changes = previewDataRefresh(manager.getState(), 'Inventory', [{ sku: 'a', price: '$2' }, { sku: 'b', price: '$3' }]);
    manager.getElementById('b')!.locked = true;
    const locked = manager.exportJson();
    expect(() => manager.applyDataRefresh(changes)).toThrow('Unlock'); expect(manager.exportJson()).toBe(locked);
    manager.getElementById('b')!.locked = false;
    manager.setStoryText('a', 'Manual edit');
    const edited = manager.exportJson();
    expect(() => manager.applyDataRefresh(changes)).toThrow('since preview'); expect(manager.exportJson()).toBe(edited);
  });
  it('rejects missing/duplicate records, inherited fields, non-scalars and oversized inputs', () => {
    const preview = (rows: unknown) => previewDataRefresh(manager.getState(), 'Inventory', rows);
    expect(() => preview([{ sku: 'a', price: '$2' }])).toThrow('Missing record');
    expect(() => preview([{ sku: 'a', price: '$2' }, { sku: 'a', price: '$3' }])).toThrow('Duplicate');
    expect(() => preview([Object.create({ sku: 'a', price: '$2' })])).toThrow('lacks key');
    expect(() => preview([{ sku: 'a', price: {} }, { sku: 'b', price: '$3' }])).toThrow('finite number');
    expect(() => preview(new Array(10001))).toThrow('10,000');
  });
  it('unbinds without deleting text and refuses binding a threaded manuscript', () => {
    manager.bindTextData('a', null); expect((manager.getElementById('a') as TextElement).dataBinding).toBeUndefined();
    expect(storyText(manager.getStoryContent('a'))).toBe('$1');
    manager.linkTextFrames('a', 'b');
    expect(() => manager.bindTextData('a', { source: 'Inventory', keyField: 'sku', recordKey: 'a', field: 'price' })).toThrow('independent');
  });
});

describe('bounded repeating vector rosettes', () => {
  it('generates finite editable nodes inside its frame and deterministic previews', () => {
    const result = ornamentalRosette(60, 12, 0.32);
    expect(result.nodes.length).toBeLessThanOrEqual(1536);
    for (const node of result.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0); expect(node.x).toBeLessThanOrEqual(60);
      expect(node.y).toBeGreaterThanOrEqual(0); expect(node.y).toBeLessThanOrEqual(60);
    }
    expect(result.path).toBe(ornamentalRosette(60, 12, 0.32).path);
    expect(result.path).toMatch(/ Z$/);
  });
  it('rejects unbounded complexity and invalid numeric inputs', () => {
    expect(() => ornamentalRosette(60, 100000, 0.3)).toThrow();
    expect(() => ornamentalRosette(NaN, 12, 0.3)).toThrow();
    expect(() => ornamentalRosette(60, 12, -1)).toThrow();
  });
});
