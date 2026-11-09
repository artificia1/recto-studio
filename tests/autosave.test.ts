import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOSAVE_KEY } from '../src/state/autosave';
import { RectoDB } from '../src/state/persistence';
import { StateManager } from '../src/state/stateManager';

describe('Autosave scheduling and recovery', () => {
  let storage: Map<string, string>;
  beforeEach(() => {
    vi.useFakeTimers();
    storage = new Map();
    vi.stubGlobal('window', {});
    vi.stubGlobal('indexedDB', {});
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    vi.spyOn(RectoDB, 'saveProject').mockResolvedValue();
    vi.spyOn(RectoDB, 'loadProjectRecord').mockResolvedValue(null);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('batches rapid edits and saves the latest document', async () => {
    const manager = new StateManager();
    manager.updateSettings({ title: 'First' });
    manager.updateSettings({ title: 'Latest' });
    expect(RectoDB.saveProject).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(RectoDB.saveProject).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.get(AUTOSAVE_KEY)!).settings.title).toBe('Latest');
  });

  it('keeps viewport navigation out of the save queue', async () => {
    const manager = new StateManager();
    manager.setPan(20, 40);
    manager.setZoom(2);
    manager.setZoomAndPan(1, 0, 0);
    manager.setTool('text');
    manager.selectElement(null);
    manager.selectElements([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(RectoDB.saveProject).not.toHaveBeenCalled();
  });

  it('flushes pending edits immediately and preserves undo/redo saves', async () => {
    const manager = new StateManager();
    manager.updateSettings({ title: 'Changed' });
    manager.undo();
    manager.redo();
    await manager.autosave.flush();
    expect(JSON.parse(storage.get(AUTOSAVE_KEY)!).settings.title).toBe('Changed');
  });

  it('recovers newer database content without replacing a newer local save', async () => {
    const manager = new StateManager();
    const saved = structuredClone(manager.getState());
    saved.settings.title = 'Recovered';
    vi.mocked(RectoDB.loadProjectRecord).mockResolvedValue({ state: saved, updatedAt: 20 });
    await manager.recoverAutosave();
    expect(manager.getState().settings.title).toBe('Recovered');
    storage.set(AUTOSAVE_KEY, JSON.stringify(saved));
    storage.set(`${AUTOSAVE_KEY}_timestamp`, '30');
    expect(await manager.autosave.recover()).toBeNull();
  });

  it('uses IndexedDB when localStorage is full and reports total failure', async () => {
    vi.stubGlobal('localStorage', { setItem: () => { throw new Error('Quota'); } });
    const manager = new StateManager();
    const statuses: string[] = [];
    manager.autosave.subscribe(status => statuses.push(status));
    manager.updateSettings({ title: 'Large document' });
    await manager.autosave.flush();
    expect(statuses.at(-1)).toBe('saved');
    vi.mocked(RectoDB.saveProject).mockRejectedValue(new Error('Database unavailable'));
    manager.updateSettings({ title: 'Still editing' });
    await manager.autosave.flush();
    expect(statuses.at(-1)).toBe('error');
  });

  it('serializes overlapping saves and snapshots state before writing', async () => {
    const manager = new StateManager();
    let finish!: () => void;
    vi.mocked(RectoDB.saveProject).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    manager.updateSettings({ title: 'One' });
    const first = manager.autosave.flush();
    await Promise.resolve();
    manager.updateSettings({ title: 'Two' });
    const second = manager.autosave.flush();
    expect(RectoDB.saveProject).toHaveBeenCalledTimes(1);
    expect(vi.mocked(RectoDB.saveProject).mock.calls[0][0].settings.title).toBe('One');
    finish();
    await Promise.all([first, second]);
    expect(vi.mocked(RectoDB.saveProject).mock.calls[1][0].settings.title).toBe('Two');
  });

  it('retries a failed save on the next flush without requiring another edit', async () => {
    vi.stubGlobal('localStorage', { setItem: () => { throw new Error('Quota'); } });
    vi.mocked(RectoDB.saveProject).mockRejectedValueOnce(new Error('Database unavailable'));
    const manager = new StateManager();
    const statuses: string[] = [];
    manager.autosave.subscribe(status => statuses.push(status));
    manager.updateSettings({ title: 'Still unsaved' });
    await manager.autosave.flush();
    expect(statuses.at(-1)).toBe('error');
    await manager.autosave.flush();
    expect(statuses.at(-1)).toBe('saved');
    expect(RectoDB.saveProject).toHaveBeenCalledTimes(2);
    expect(vi.mocked(RectoDB.saveProject).mock.lastCall?.[0].settings.title).toBe('Still unsaved');
  });

  it('recovers past an invalid local save but never replaces intervening edits', async () => {
    const saved = structuredClone(new StateManager().getState());
    saved.settings.title = 'Backup';
    storage.set(AUTOSAVE_KEY, 'invalid JSON');
    storage.set(`${AUTOSAVE_KEY}_timestamp`, '30');
    vi.mocked(RectoDB.loadProjectRecord).mockResolvedValue({ state: saved, updatedAt: 20 });
    const recovered = new StateManager();
    await recovered.recoverAutosave();
    expect(recovered.getState().settings.title).toBe('Backup');

    let finish!: (value: { state: typeof saved; updatedAt: number }) => void;
    vi.mocked(RectoDB.loadProjectRecord).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const editing = new StateManager();
    const recovery = editing.recoverAutosave();
    editing.updateSettings({ title: 'Live edit' });
    finish({ state: saved, updatedAt: 20 });
    await recovery;
    expect(editing.getState().settings.title).toBe('Live edit');
  });

  it('restores artwork that intentionally crosses the trim edge', async () => {
    const manager = new StateManager();
    manager.createBlankProject('A4', 'Bleed artwork', false);
    const pageId = manager.getActiveSpread().pages[0].id;
    manager.addElement({
      id: 'bleed-photo', pageId, type: 'image', x: 10, y: 285, width: 50, height: 18, rotation: 0,
      opacity: 1, zIndex: 1, locked: false, src: '', fitMode: 'fit', borderColor: 'transparent', borderWidthMm: 0,
    });
    await manager.autosave.flush();
    expect(new StateManager().getElementById('bleed-photo')).toMatchObject({ y: 285, height: 18 });
  });
});
