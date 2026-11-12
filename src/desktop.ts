/** Desktop commands expose file pickers, never arbitrary file paths. */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
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
