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

export async function openDesktopDocument(): Promise<File | null> {
  const { invoke } = await import('@tauri-apps/api/core');
  const result = await invoke<{ name: string; bytes: number[]; project?: DesktopProjectFile | null } | null>('desktop_open_document');
  if (!result) return null;
  const file = new File([new Uint8Array(result.bytes)], result.name);
  if (result.project) desktopProjectFiles.set(file, result.project);
  return file;
}

export async function savePublicationFile(name: string, data: Blob | Uint8Array | ArrayBuffer | string, mimeType = 'application/octet-stream'): Promise<boolean> {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: mimeType });
  if (isDesktop()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<boolean>('desktop_save_file', { suggestedName: name, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) });
  }
  if (typeof document === 'undefined') {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(name, new Uint8Array(await blob.arrayBuffer()));
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
