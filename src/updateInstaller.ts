import type { DownloadEvent, Update } from '@tauri-apps/plugin-updater';
import type { Autosave } from './state/autosave';

/** Saving after download includes edits made while the package was in transit. */
export async function installSavedUpdate(
  update: Pick<Update, 'download' | 'install'>,
  autosave: Pick<Autosave, 'flush' | 'subscribe'>,
  onProgress: (event: DownloadEvent) => void,
  onSaving: () => void,
) {
  await update.download(onProgress, { timeout: 120000 });
  onSaving();
  await autosave.flush();
  let saved = false;
  const unsubscribe = autosave.subscribe(value => { saved = value === 'saved'; });
  unsubscribe();
  if (!saved) throw new Error('Autosave could not finish. Save your publication and try again.');
  await update.install({ restartAfterInstall: true });
}
