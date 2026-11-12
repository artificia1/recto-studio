import type { Update } from '@tauri-apps/plugin-updater';
import type { Autosave, SaveStatus } from './state/autosave';

/** Save the latest publication before handing control to the native installer. */
export async function installSavedUpdate(
  update: Pick<Update, 'install'>,
  autosave: Pick<Autosave, 'flush' | 'subscribe'>,
  onInstalling: () => void,
) {
  const current: { status: SaveStatus } = { status: 'pending' };
  const unsubscribe = autosave.subscribe(status => { current.status = status; });
  try {
    await autosave.flush();
    // An edit or another save can arrive while the first checkpoint is being written.
    if (current.status === 'pending' || current.status === 'saving') await autosave.flush();
    if (current.status !== 'saved') {
      throw new Error('Autosave could not finish. Save your publication and try again.');
    }
  } finally {
    unsubscribe();
  }
  onInstalling();
  await update.install({ restartAfterInstall: true });
}
