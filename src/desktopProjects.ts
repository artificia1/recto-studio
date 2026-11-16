import { desktopProjectFiles, isDesktop, maxDesktopBytes, openDesktopDocument, saveDesktopProject, savePublicationFile, type DesktopProjectFile } from './desktop';
import { projectSnapshotBlob } from './projectSnapshot';
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
    const handle = !saveAs && binding?.session === session ? binding.handle : null;
    const snapshot = projectSnapshotBlob(stateManager.getState(), maxDesktopBytes);
    const project = await saveDesktopProject(handle, suggestedName, snapshot);
    if (!project || stateManager.getDocumentSession() !== session) return;
    binding = { ...project, session };
    stateManager.autosave.markDesktopSaved(project.name, stateManager.getDocumentRevision() === revision);
  });
}
