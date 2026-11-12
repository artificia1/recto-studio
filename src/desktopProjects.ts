import { desktopProjectFiles, isDesktop, openDesktopDocument, savePublicationFile, type DesktopProjectFile } from './desktop';
import { stateManager } from './state';

let binding: (DesktopProjectFile & { session: number }) | undefined;
let busy = false;

async function runDesktopFileOperation(action: () => Promise<void>): Promise<void> {
  if (busy) throw new Error('Wait for the current file operation to finish.');
  busy = true;
  try {
    await action();
  } finally {
    busy = false;
  }
}

export async function openCurrentDesktopProject(install: (file: File) => Promise<void>): Promise<void> {
  await runDesktopFileOperation(async () => {
    const session = stateManager.getDocumentSession();
    const revision = stateManager.getDocumentRevision();
    const file = await openDesktopDocument();
    if (!file) return;
    if (stateManager.getDocumentSession() !== session || stateManager.getDocumentRevision() !== revision) {
      throw new Error('The current project changed while choosing a file. Open the file again.');
    }
    await install(file);
    const project = desktopProjectFiles.get(file);
    const installedSession = stateManager.getDocumentSession();
    if (!project || installedSession !== session + 1) return;
    binding = { ...project, session: installedSession };
    stateManager.autosave.markDesktopSaved(project.name, stateManager.getDocumentRevision() === revision + 1);
  });
}

export async function saveCurrentProject(saveAs: boolean): Promise<void> {
  const { title } = stateManager.getState().settings;
  const suggestedName = (title.toLowerCase().replace(/[^a-z0-9_-]/g, '-') || 'publication') + '.recto';
  if (!isDesktop()) {
    await savePublicationFile(suggestedName, stateManager.exportJson(), 'application/json');
    return;
  }
  await runDesktopFileOperation(async () => {
    const session = stateManager.getDocumentSession();
    const revision = stateManager.getDocumentRevision();
    const bytes = new TextEncoder().encode(stateManager.exportJson());
    if (bytes.byteLength > 128 * 1024 * 1024) throw new Error('This project exceeds the 128 MB desktop save limit.');
    const handle = !saveAs && binding?.session === session ? binding.handle : null;
    const { invoke } = await import('@tauri-apps/api/core');
    const project = await invoke<DesktopProjectFile | null>('desktop_save_project', {
      handle, suggestedName, bytes: Array.from(bytes),
    });
    if (!project || stateManager.getDocumentSession() !== session) return;
    binding = { ...project, session };
    stateManager.autosave.markDesktopSaved(project.name, stateManager.getDocumentRevision() === revision);
  });
}
