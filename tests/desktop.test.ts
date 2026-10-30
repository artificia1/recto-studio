import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDesktop, openDesktopDocument, savePublicationFile } from '../src/desktop';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
afterEach(() => { vi.unstubAllGlobals(); invoke.mockReset(); });

describe('Desktop publication file bridge', () => {
  it('does not activate native commands in the browser edition', () => {
    vi.stubGlobal('window', {});
    expect(isDesktop()).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('opens the user-selected document without exposing a filesystem path', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    invoke.mockResolvedValue({ name: 'novel.recto', bytes: [123, 125] });
    const file = await openDesktopDocument();
    expect(file?.name).toBe('novel.recto');
    expect(await file?.text()).toBe('{}');
    expect(invoke).toHaveBeenCalledWith('desktop_open_document');
  });

  it('treats cancellation as cancellation without opening browser downloads', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    invoke.mockResolvedValueOnce(null).mockResolvedValueOnce(false);
    expect(await openDesktopDocument()).toBeNull();
    expect(await savePublicationFile('novel.recto', '{}')).toBe(false);
  });

  it('passes exact export bytes and the suggested filename to the save dialog', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    invoke.mockResolvedValue(true);
    expect(await savePublicationFile('book.pdf', new Uint8Array([37, 80, 68, 70]))).toBe(true);
    expect(invoke).toHaveBeenCalledWith('desktop_save_file', { suggestedName: 'book.pdf', bytes: [37, 80, 68, 70] });
  });

  it('reports native write failures instead of silently falling back to a download', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    invoke.mockRejectedValue(new Error('Disk is full'));
    await expect(savePublicationFile('book.recto', '{}')).rejects.toThrow('Disk is full');
  });
});
