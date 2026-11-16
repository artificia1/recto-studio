/** Desktop commands expose file pickers, never arbitrary file paths. */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function probeDesktopRaster(bytes: Uint8Array, mediaType: string) {
  if (!isDesktop()) return null;
  // Send enough for ordinary image headers without copying the full raster across IPC.
  const header = bytes.slice(0, mediaType === 'image/jpeg' ? 16 * 1024 : 30);
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<{ width: number; height: number; cmyk: boolean } | null>('desktop_probe_raster', header, {
      headers: { 'x-recto-raster-type': mediaType },
    });
  } catch {
    // Older desktop builds and WebViews without binary IPC use the existing reader.
    return null;
  }
}

export async function adjustDesktopRaster(pixels: Uint8Array, table: Uint8Array, grayscale: boolean): Promise<boolean> {
  if (!isDesktop() || !pixels.length || pixels.length > 1024 * 1024 || pixels.length % 4 || table.length !== 256) return false;
  // Binary layout shared with raster_adjustments.rs: flag, lookup table, RGBA pixels.
  const packet = new Uint8Array(1 + table.length + pixels.length);
  packet[0] = grayscale ? 1 : 0;
  packet.set(table, 1);
  packet.set(pixels, 1 + table.length);
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke<ArrayBuffer>('desktop_adjust_raster', packet);
    if (!(result instanceof ArrayBuffer) || result.byteLength !== pixels.byteLength) return false;
    pixels.set(new Uint8Array(result));
    return true;
  } catch {
    return false;
  }
}

export interface DesktopProjectFile {
  handle: string;
  name: string;
}

export const desktopProjectFiles = new WeakMap<File, DesktopProjectFile>();

type DesktopInvoke = typeof import('@tauri-apps/api/core').invoke;
export const maxDesktopBytes = 128 * 1024 * 1024;
async function desktopChunkSize(invoke: DesktopInvoke, command: string) {
  const size = await invoke<number>(command).catch(() => 0);
  return Number.isSafeInteger(size) && size > 0 && size <= 1024 * 1024 ? size : 0;
}

export async function openDesktopDocument(): Promise<File | null> {
  const { invoke } = await import('@tauri-apps/api/core');
  const size = await desktopChunkSize(invoke, 'desktop_document_chunk_size');
  if (size) {
    const result = await invoke<{ token: string; name: string; length: number } | null>('desktop_begin_document_read');
    if (!result) return null;
    const { token, name, length } = result;
    try {
      if (!Number.isSafeInteger(length) || length < 0 || length > maxDesktopBytes) throw new Error('Invalid desktop document size.');
      const parts: Blob[] = [];
      for (let offset = 0; offset < length; offset += size) {
        const data = await invoke<ArrayBuffer | number[]>('desktop_read_document_chunk', { token, offset });
        const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : Array.isArray(data) ? Uint8Array.from(data) : null;
        if (bytes?.length !== Math.min(size, length - offset)) throw new Error('The desktop document read was incomplete.');
        parts.push(new Blob([bytes]));
      }
      const file = new File(parts, name);
      const project = await invoke<DesktopProjectFile | null>('desktop_finish_document_read', { token });
      if (project) desktopProjectFiles.set(file, project);
      return file;
    } catch (error) {
      await invoke('desktop_abort_document_read', { token }).catch(() => {});
      throw error;
    }
  }
  const result = await invoke<{ name: string; bytes: number[]; project?: DesktopProjectFile | null } | null>('desktop_open_document');
  if (!result) return null;
  const file = new File([new Uint8Array(result.bytes)], result.name);
  if (result.project) desktopProjectFiles.set(file, result.project);
  return file;
}

async function writeDesktopChunks<T>(invoke: DesktopInvoke, blob: Blob, chunkSize: number, token: string, finish: string) {
  try {
    for (let offset = 0; offset < blob.size; offset += chunkSize) {
      const chunk = new Uint8Array(await blob.slice(offset, offset + chunkSize).arrayBuffer());
      await invoke('desktop_write_export_chunk', chunk, {
        headers: { 'x-recto-export-id': token, 'x-recto-export-offset': String(offset) },
      });
    }
    return await invoke<T>(finish, { token });
  } catch (error) {
    await invoke('desktop_abort_export', { token }).catch(() => {});
    throw error;
  }
}

export async function saveDesktopProject(handle: string | null, suggestedName: string, blob: Blob) {
  if (blob.size > maxDesktopBytes) throw new Error('This project exceeds the 128 MB desktop save limit.');
  const { invoke } = await import('@tauri-apps/api/core');
  const chunkSize = await desktopChunkSize(invoke, 'desktop_document_chunk_size');
  if (chunkSize) {
    const token = await invoke<string | null>('desktop_begin_project_write', { handle, suggestedName, byteLength: blob.size });
    if (token === null) return null;
    return writeDesktopChunks<DesktopProjectFile>(invoke, blob, chunkSize, token, 'desktop_finish_project_write');
  }
  return invoke<DesktopProjectFile | null>('desktop_save_project', {
    handle, suggestedName, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
  });
}

export async function savePublicationFile(name: string, data: Blob | Uint8Array | ArrayBuffer | string, mimeType = 'application/octet-stream'): Promise<boolean> {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: mimeType });
  if (isDesktop()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const size = blob.size;
    if (size > maxDesktopBytes) throw new Error('This export exceeds the 128 MB desktop save limit.');
    if (size >= 1024 * 1024) {
      const chunkSize = await desktopChunkSize(invoke, 'desktop_export_chunk_size');
      if (chunkSize) {
        const token = await invoke<string | null>('desktop_begin_export', { suggestedName: name, byteLength: size });
        if (token === null) return false;
        await writeDesktopChunks(invoke, blob, chunkSize, token, 'desktop_finish_export');
        return true;
      }
    }
    return invoke<boolean>('desktop_save_file', { suggestedName: name, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) });
  }
  if (typeof document === 'undefined') {
    const { writeFile } = await import('node:fs/promises');
    const { Readable } = await import('node:stream');
    await writeFile(name, Readable.fromWeb(blob.stream() as import('node:stream/web').ReadableStream<Uint8Array>));
    return true;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
