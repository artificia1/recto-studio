import { describe, expect, it, vi } from 'vitest';
import { installSavedUpdate } from '../src/updateInstaller';
import type { SaveStatus } from '../src/state/autosave';

describe('Safe desktop update installation', () => {
  it('saves edits and only then installs with restart enabled', async () => {
    const order: string[] = [];
    const update = { install: vi.fn(async () => { order.push('install'); }) };
    const autosave = { flush: async () => { order.push('save'); }, subscribe: (listener: (status: 'saved') => void) => { listener('saved'); return () => {}; } };
    await installSavedUpdate(update, autosave, () => { order.push('installer status'); });
    expect(order).toEqual(['save', 'installer status', 'install']);
    expect(update.install).toHaveBeenCalledWith({ restartAfterInstall: true });
  });

  it('flushes again when an edit arrived during the first save', async () => {
    const update = { install: vi.fn(async () => {}) };
    const unsubscribe = vi.fn();
    let notify: (status: SaveStatus) => void = () => {};
    const flush = vi.fn(async () => {})
      .mockImplementationOnce(async () => { notify('pending'); })
      .mockImplementationOnce(async () => { notify('saved'); });
    const autosave = { flush, subscribe: (listener: typeof notify) => { notify = listener; return unsubscribe; } };
    await installSavedUpdate(update, autosave, () => {});
    expect(flush).toHaveBeenCalledTimes(2);
    expect(update.install).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it.each(['error', 'pending'] as const)('keeps the app open when autosave remains %s', async status => {
    const update = { install: vi.fn(async () => {}) };
    const unsubscribe = vi.fn();
    const autosave = { flush: vi.fn(async () => {}), subscribe: (listener: (status: SaveStatus) => void) => {
      listener(status);
      return unsubscribe;
    } };
    await expect(installSavedUpdate(update, autosave, () => {})).rejects.toThrow('Autosave');
    expect(update.install).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
