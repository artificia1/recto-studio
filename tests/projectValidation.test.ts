import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StateManager } from '../src/state/stateManager';
import { parseProject, ProjectValidationError } from '../src/state/projectValidation';
import { RectoDB } from '../src/state/persistence';
import type { ProjectState, TextElement } from '../src/types';
import { TEMPLATES } from '../src/templates';

describe('Project import validation and legacy defaults', () => {
  let manager: StateManager;
  let original: ProjectState;
  beforeEach(() => {
    manager = new StateManager();
    original = structuredClone(manager.getState());
  });
  afterEach(() => vi.restoreAllMocks());

  it('round-trips an existing document without losing publishing data', () => {
    const imported = parseProject(JSON.stringify(original), original);
    expect(imported.settings).toEqual(original.settings);
    expect(imported.spreads).toEqual(original.spreads);
    expect(imported.masterSpreads).toEqual(original.masterSpreads);
    expect(imported.paragraphStyles).toEqual(original.paragraphStyles);
  });

  it.each(TEMPLATES)('round-trips the $name template', template => {
    vi.spyOn(Date, 'now').mockReturnValue(123456789);
    const spread = template.createSpread(0, 1);
    original.spreads = [spread];
    original.activeSpreadIndex = 0;
    const imported = parseProject(JSON.stringify(original), original).spreads[0];
    expect(imported.pages).toEqual(spread.pages);
    expect(imported.elements).toHaveLength(spread.elements.length);
    spread.elements.forEach((item, index) => {
      expect(imported.elements[index]).toMatchObject(item);
    });
  });

  it('fills missing legacy settings without borrowing current document content', () => {
    const legacy = { settings: { title: 'Old document', widthMm: 100, heightMm: 150 }, spreads: original.spreads };
    manager.loadFromJson(JSON.stringify(legacy));
    expect(manager.getState().settings.title).toBe('Old document');
    expect(manager.getState().settings.widthMm).toBe(100);
    expect(manager.getState().settings.baselineGrid.enabled).toBe(true);
    expect(manager.getState().layers.length).toBeGreaterThan(0);
  });

  it.each(['{', 'null', '[]', '{}', '{"settings":{},"spreads":[]}'])('rejects invalid document %s without changing state or history', input => {
    const notify = vi.fn();
    manager.subscribe(notify);
    expect(() => manager.loadFromJson(input)).toThrow(ProjectValidationError);
    expect(manager.getState()).toEqual(original);
    manager.undo();
    expect(manager.getState()).toEqual(original);
    expect(notify).not.toHaveBeenCalled();
  });

  it.each([
    (doc: ProjectState) => { doc.settings.widthMm = -1; },
    (doc: ProjectState) => { doc.spreads = []; },
    (doc: ProjectState) => { doc.spreads[0].elements[0].width = -20; },
    (doc: ProjectState) => { doc.spreads[1].elements[0].pageId = 'missing'; },
    (doc: ProjectState) => { doc.spreads[0].elements.push(structuredClone(doc.spreads[0].elements[0])); },
    (doc: ProjectState) => { Object.assign(doc.spreads[0].elements[0], { type: 'unknown' }); },
    (doc: ProjectState) => { Object.assign(doc.settings, { margins: null }); },
    (doc: ProjectState) => { Object.assign(doc, { layers: 'bad' }); },
    (doc: ProjectState) => { Object.assign(doc, { objectStyles: 'bad' }); },
    (doc: ProjectState) => { Object.assign(doc, { comments: [null] }); },
  ])('rejects malformed fields atomically', mutate => {
    const invalid = structuredClone(original);
    mutate(invalid);
    expect(() => manager.loadFromJson(JSON.stringify(invalid))).toThrow(ProjectValidationError);
    expect(manager.getState()).toEqual(original);
  });

  it('reports the invalid field in a useful error message', () => {
    original.spreads[0].elements[0].width = -1;
    expect(() => parseProject(JSON.stringify(original), manager.getState()))
      .toThrow('Project.spreads[0].elements[0].width');
  });

  it('rejects malformed table cells and vector control points', () => {
    const base = original.spreads[0].elements[0];
    const table = {
      ...base, type: 'table', rows: 1, cols: 2, cells: [[{ text: 'Only one cell' }]],
      headerRowCount: 0, headerFillColor: '#fff', headerTextColor: '#000',
      borderColor: '#000', borderWidthMm: 0, cellPaddingMm: 1,
      fontFamily: 'Inter', fontSizePt: 10,
    };
    original.spreads[0].elements = [table as unknown as typeof base];
    expect(() => parseProject(JSON.stringify(original), manager.getState())).toThrow('cell dimensions');
    const vector = {
      ...base, type: 'path', nodes: [{ x: 1, y: 2, handleIn: { x: 'bad', y: 0 } }],
      closed: false, fillColor: 'transparent', strokeColor: '#000', strokeWidthMm: 1,
      strokeDash: 'solid', strokeCap: 'butt', strokeJoin: 'miter',
    };
    original.spreads[0].elements = [vector as unknown as typeof base];
    expect(() => parseProject(JSON.stringify(original), manager.getState())).toThrow('handleIn.x');
  });

  it('repairs stale selection and spread position', () => {
    original.activeSpreadIndex = 999;
    original.selectedElementIds = ['missing'];
    original.zoom = 10;
    const imported = parseProject(JSON.stringify(original), original);
    expect(imported.activeSpreadIndex).toBe(original.spreads.length - 1);
    expect(imported.selectedElementIds).toEqual([]);
    expect(imported.selectedElementId).toBeNull();
    expect(imported.zoom).toBe(3);
  });

  it('repairs a legacy page reference when its spread has exactly one page', () => {
    original.spreads[0].elements[0].pageId = 'obsolete-page-id';
    const imported = parseProject(JSON.stringify(original), original);
    expect(imported.spreads[0].elements[0].pageId).toBe(original.spreads[0].pages[0].id);
  });

  it('preserves intentionally empty styles and masters', () => {
    original.masterSpreads = [];
    original.paragraphStyles = [];
    expect(parseProject(JSON.stringify(original), original).masterSpreads).toEqual([]);
    manager.loadFromJson(JSON.stringify(original));
    expect(manager.getState().masterSpreads).toEqual([]);
    expect(manager.getState().paragraphStyles).toEqual([]);
  });

  it('validates a long thread in reverse spread order and rejects circular or broken links', () => {
    const spread = original.spreads[0];
    const base = original.spreads.flatMap(spread => spread.elements).find(element => element.type === 'text')!;
    const frames: TextElement[] = Array.from({ length: 1200 }, (_, index) => ({
      ...base, id: `thread-${index}`, pageId: spread.pages[0].id,
      prevFrameId: index > 0 ? `thread-${index - 1}` : undefined,
      nextFrameId: index < 1199 ? `thread-${index + 1}` : undefined,
      storyContent: index === 0 ? { version: 1, paragraphs: [{ runs: [{ text: 'Manuscript' }] }] } : undefined,
      textContent: { version: 1, paragraphs: [{ runs: [{ text: '' }] }] },
    }));
    original.spreads = [{ ...spread, elements: frames.slice().reverse() }];
    expect(parseProject(JSON.stringify(original), manager.getState()).spreads[0].elements).toHaveLength(1200);
    frames[0].prevFrameId = frames.at(-1)!.id;
    frames.at(-1)!.nextFrameId = frames[0].id;
    expect(() => parseProject(JSON.stringify(original), manager.getState())).toThrow('circular text-frame link');
    frames[0].prevFrameId = undefined;
    expect(() => parseProject(JSON.stringify(original), manager.getState())).toThrow('broken text-frame link');
  });

  it('validates the file API and rejects before replacing the open project', async () => {
    const file = new File(['{"settings":{}}'], 'invalid.recto');
    await expect(manager.importProjectFile(file)).rejects.toThrow(ProjectValidationError);
    expect(manager.getState()).toEqual(original);
    await expect(RectoDB.importProjectFile(file, original)).rejects.toThrow(ProjectValidationError);
  });

  it('keeps intervening edits when a large project is staged across task boundaries', async () => {
    const spread = original.spreads[0];
    const head = original.spreads.flatMap(spread => spread.elements).find(element => element.type === 'text')!;
    const draft: ProjectState = { ...original, spreads: Array.from({ length: 24 }, (_, index) => ({
      ...spread, id: `staged-${index}`, pages: [{ ...spread.pages[0], id: `staged-page-${index}` }],
      elements: index === 0 ? [{ ...head, pageId: 'staged-page-0',
        storyContent: { version: 1 as const, paragraphs: [{ runs: [{ text: 'Staged manuscript' }] }] } }] : [],
    })) };
    vi.spyOn(RectoDB, 'importProjectFile').mockResolvedValue(draft);
    vi.useFakeTimers();
    try {
      let now = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => now += 10);
      const opening = manager.importProjectFile(new File(['{}'], 'large.recto'));
      const rejected = expect(opening).rejects.toThrow('document changed while this file was opening');
      for (let turn = 0; turn < 20 && vi.getTimerCount() === 0; turn++) await Promise.resolve();
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      manager.updateSettings({ title: 'Kept edit' });
      await vi.runAllTimersAsync();
      await rejected;
      expect(manager.getState().settings.title).toBe('Kept edit');
      expect(manager.getState().spreads).toEqual(original.spreads);
    } finally { vi.useRealTimers(); }
  });
});
