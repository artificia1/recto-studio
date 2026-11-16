import { afterEach, describe, expect, it, vi } from 'vitest';
import { desktopProjectFiles, isDesktop, openDesktopDocument, saveDesktopProject, savePublicationFile } from '../src/desktop';
import { projectSnapshotBlob } from '../src/projectSnapshot';
import type { ProjectState } from '../src/types';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
afterEach(() => { vi.unstubAllGlobals(); invoke.mockReset(); });

describe('Desktop publication file bridge', () => {
  it('preserves JSON values while serializing the project in parts', async () => {
    const state = { settings: { title: '日本語 \\ "', legacy: undefined }, spreads: [undefined, { text: 'x' + '𐐷'.repeat(40000) + '\ud800' }] } as unknown as ProjectState;
    const expected = JSON.stringify(state);
    const blob = projectSnapshotBlob(state, 1024 * 1024);
    expect(await blob.text()).toBe(expected);
    expect(() => projectSnapshotBlob(state, blob.size - 1)).toThrow('128 MB');
  });

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
    invoke.mockResolvedValueOnce(0).mockResolvedValueOnce(null).mockResolvedValueOnce(false);
    expect(await openDesktopDocument()).toBeNull();
    expect(await savePublicationFile('novel.recto', '{}')).toBe(false);
  });

  it('passes exact export bytes and the suggested filename to the save dialog', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    invoke.mockResolvedValue(true);
    expect(await savePublicationFile('book.pdf', new Uint8Array([37, 80, 68, 70]))).toBe(true);
    expect(invoke).toHaveBeenCalledWith('desktop_save_file', { suggestedName: 'book.pdf', bytes: [37, 80, 68, 70] });
  });

  it('opens a document in ordered binary chunks and binds only the completed file', async () => {
    const project = { handle: '8', name: 'novel.recto' };
    invoke.mockResolvedValueOnce(3).mockResolvedValueOnce({ token: '2', name: project.name, length: 5 })
      .mockResolvedValueOnce(Uint8Array.of(123, 34, 97).buffer).mockResolvedValueOnce([34, 125])
      .mockResolvedValueOnce(project);
    const file = await openDesktopDocument();
    expect(await file?.text()).toBe('{"a"}');
    expect(desktopProjectFiles.get(file!)).toEqual(project);
    expect(invoke).toHaveBeenCalledWith('desktop_read_document_chunk', { token: '2', offset: 3 });
    expect(invoke).toHaveBeenLastCalledWith('desktop_finish_document_read', { token: '2' });
  });

  it('aborts a truncated desktop read', async () => {
    invoke.mockResolvedValueOnce(3).mockResolvedValueOnce({ token: '2', name: 'book.recto', length: 3 })
      .mockResolvedValueOnce(Uint8Array.of(1, 2).buffer).mockResolvedValue(undefined);
    await expect(openDesktopDocument()).rejects.toThrow('incomplete');
    expect(invoke).toHaveBeenLastCalledWith('desktop_abort_document_read', { token: '2' });
  });

  it('streams a UTF-8 project snapshot with the existing save handle', async () => {
    const project = { handle: '8', name: 'novel.recto' };
    const json = JSON.stringify({ title: '日本語' });
    const expected = new TextEncoder().encode(json);
    invoke.mockImplementation(async (command: string) => {
      if (command === 'desktop_document_chunk_size') return 4;
      if (command === 'desktop_begin_project_write') return '2';
      if (command === 'desktop_finish_project_write') return project;
    });
    expect(await saveDesktopProject(project.handle, project.name, new Blob([json]))).toEqual(project);
    expect(invoke).toHaveBeenCalledWith('desktop_begin_project_write', { handle: '8', suggestedName: project.name, byteLength: expected.length });
    const chunks = invoke.mock.calls.filter(([command]) => command === 'desktop_write_export_chunk');
    expect(chunks.flatMap(([, chunk]) => [...chunk])).toEqual([...expected]);
    expect(invoke).toHaveBeenLastCalledWith('desktop_finish_project_write', { token: '2' });
  });

  it('reports native write failures instead of silently falling back to a download', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    invoke.mockRejectedValue(new Error('Disk is full'));
    await expect(savePublicationFile('book.recto', '{}')).rejects.toThrow('Disk is full');
  });

  it('streams bounded binary chunks to the native saver and finishes once', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    const limit = 1024 * 1024;
    const bytes = new Uint8Array(limit + 6);
    bytes.set([11, 12, 13, 14, 15, 16], limit);
    invoke.mockResolvedValueOnce(limit).mockResolvedValueOnce('14').mockResolvedValue(undefined);
    expect(await savePublicationFile('book.pdf', bytes.subarray(2))).toBe(true);
    expect(invoke.mock.calls.map(call => call[0])).toEqual([
      'desktop_export_chunk_size', 'desktop_begin_export', 'desktop_write_export_chunk',
      'desktop_write_export_chunk', 'desktop_finish_export',
    ]);
    expect(invoke.mock.calls[2][1].byteLength).toBe(limit);
    expect(invoke.mock.calls[3][1]).toEqual(Uint8Array.of(13, 14, 15, 16));
    expect(invoke.mock.calls[3][2].headers).toEqual({ 'x-recto-export-id': '14', 'x-recto-export-offset': String(limit) });
    expect(invoke.mock.calls[4][1]).toEqual({ token: '14' });
  });

  it('aborts a streamed export on a write failure and does not reopen a dialog', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    invoke.mockResolvedValueOnce(1024 * 1024).mockResolvedValueOnce('14')
      .mockRejectedValueOnce(new Error('Disk is full')).mockResolvedValue(undefined);
    await expect(savePublicationFile('book.pdf', new Blob([new Uint8Array(1024 * 1024)]))).rejects.toThrow('Disk is full');
    expect(invoke).toHaveBeenLastCalledWith('desktop_abort_export', { token: '14' });
    expect(invoke).toHaveBeenCalledTimes(4);
  });

  it('checks the desktop limit before building an IPC payload', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    const megabyte = new Blob([new Uint8Array(1024 * 1024)]);
    const oversized = new Blob(Array<Blob>(129).fill(megabyte));
    await expect(savePublicationFile('book.pdf', oversized)).rejects.toThrow('128 MB');
    expect(invoke).not.toHaveBeenCalled();
  });
});
