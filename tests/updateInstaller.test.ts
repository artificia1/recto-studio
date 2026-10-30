import { describe, expect, it, vi } from 'vitest';
import { installSavedUpdate } from '../src/updateInstaller';

describe('Safe desktop update installation', () => {
  it('downloads, saves edits, and only then installs with restart enabled', async () => {
    const order: string[] = [];
    const update = { download: vi.fn(async () => { order.push('download'); }), install: vi.fn(async () => { order.push('install'); }) };
    const autosave = { flush: async () => { order.push('save'); }, subscribe: (listener: (status: 'saved') => void) => { listener('saved'); return () => {}; } };
    await installSavedUpdate(update, autosave, () => {}, () => {});
    expect(order).toEqual(['download', 'save', 'install']);
    expect(update.install).toHaveBeenCalledWith({ restartAfterInstall: true });
  });

  it('leaves the app open when persistence fails or the download is rejected', async () => {
    const update = { download: vi.fn(async () => {}), install: vi.fn(async () => {}) };
    const autosave = { flush: vi.fn(async () => {}), subscribe: (listener: (status: 'error') => void) => { listener('error'); return () => {}; } };
    await expect(installSavedUpdate(update, autosave, () => {}, () => {})).rejects.toThrow('Autosave');
    expect(update.install).not.toHaveBeenCalled();
    update.download.mockRejectedValueOnce(new Error('Invalid signature'));
    autosave.flush.mockClear();
    await expect(installSavedUpdate(update, autosave, () => {}, () => {})).rejects.toThrow('signature');
    expect(autosave.flush).not.toHaveBeenCalled();
    expect(update.install).not.toHaveBeenCalled();
  });
});
