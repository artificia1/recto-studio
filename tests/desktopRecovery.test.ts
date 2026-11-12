import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Autosave } from '../src/state/autosave';
import { INITIAL_STATE } from '../src/state/defaults';
import * as recovery from '../src/state/desktopRecovery';
import { RectoDB } from '../src/state/persistence';
import type { ProjectState } from '../src/types';

describe('Desktop project recovery', () => {
  let state: ProjectState;
  let autosave: Autosave;
  let checkpoints: Map<string, { state: ProjectState; fileName?: string }>;

  beforeEach(() => {
    vi.stubGlobal('window', {});
    checkpoints = new Map();
    vi.spyOn(recovery, 'saveRecoveryCheckpoint').mockImplementation(async (id, snapshot, _, fileName, recoverable) => {
      if (recoverable) checkpoints.set(id, { state: snapshot, fileName });
      else checkpoints.delete(id);
    });
    vi.spyOn(recovery, 'loadActiveDesktopProject').mockResolvedValue(undefined);
    vi.spyOn(RectoDB, 'loadProjectRecord').mockResolvedValue(null);
    state = structuredClone(INITIAL_STATE);
    autosave = new Autosave(() => state);
    autosave.beginDesktopDocument();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps the outgoing project when switching before its debounce finishes', async () => {
    autosave.beginDesktopDocument('magazine.recto');
    state.settings.title = 'Magazine';
    autosave.schedule();
    autosave.beginDesktopDocument();
    state.settings.title = 'Book';
    autosave.schedule();
    await autosave.flush();

    expect([...checkpoints.values()].map(entry => [entry.state.settings.title, entry.fileName])).toEqual([
      ['Magazine', 'magazine.recto'],
      ['Book', undefined],
    ]);
  });

  it('cleans only the current session after a successful save and serializes pending writes', async () => {
    state.settings.title = 'Earlier project';
    autosave.schedule();
    autosave.beginDesktopDocument();
    state.settings.title = 'Saved project';
    autosave.schedule();
    void autosave.flush();
    autosave.markDesktopSaved('saved.recto', true);
    await autosave.flush();

    expect([...checkpoints.values()].map(entry => entry.state.settings.title)).toEqual(['Earlier project']);
  });

  it('keeps edits made during a native save under the updated file name', async () => {
    state.settings.title = 'Manuscript';
    autosave.schedule();
    await autosave.flush();
    state.settings.title = 'Updated after save started';
    autosave.markDesktopSaved('book.recto', false);
    await autosave.flush();

    expect(checkpoints.size).toBe(1);
    expect([...checkpoints.values()][0]).toMatchObject({
      fileName: 'book.recto',
      state: { settings: { title: 'Updated after save started' } },
    });
  });

  it('reuses the resumed checkpoint on later edits without duplicating it', async () => {
    const resumed = structuredClone(INITIAL_STATE);
    resumed.settings.title = 'Resumed manuscript';
    vi.mocked(recovery.loadActiveDesktopProject).mockResolvedValue({ sessionId: 'original-session', state: resumed, fileName: 'manuscript.recto' });
    expect(await autosave.recover(false)).toBe(resumed);
    autosave.beginDesktopDocument();
    state = structuredClone(resumed);
    autosave.schedule();
    autosave.finishDesktopRestore(resumed);
    await autosave.flush();
    expect(recovery.saveRecoveryCheckpoint).not.toHaveBeenCalled();

    state.settings.title = 'Resumed edits';
    autosave.schedule();
    await autosave.flush();
    expect(checkpoints.get('original-session')).toMatchObject({
      state: { settings: { title: 'Resumed edits' } },
      fileName: 'manuscript.recto',
    });
  });

  it('migrates a legacy desktop autosave through the normal restore checkpoint', async () => {
    const legacy = structuredClone(INITIAL_STATE);
    legacy.settings.title = 'Pre-upgrade project';
    autosave.beginDesktopDocument(undefined, legacy);
    expect(await autosave.recover()).toBe(legacy);
    autosave.beginDesktopDocument();
    state = structuredClone(legacy);
    autosave.schedule();
    autosave.finishDesktopRestore(legacy);
    await autosave.flush();
    expect([...checkpoints.values()].map(entry => entry.state.settings.title)).toEqual(['Pre-upgrade project']);
  });

  it('retries a failed checkpoint and reports when it is durable', async () => {
    vi.mocked(recovery.saveRecoveryCheckpoint).mockRejectedValueOnce(new Error('Quota exceeded'));
    const statuses: string[] = [];
    autosave.subscribe(status => statuses.push(status));
    autosave.schedule();
    await autosave.flush();
    expect(statuses.at(-1)).toBe('error');
    expect(checkpoints.size).toBe(0);
    await autosave.flush();
    expect(statuses.at(-1)).toBe('saved');
    expect(checkpoints.size).toBe(1);
  });
});
