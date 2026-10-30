import { render } from 'preact';
import { App } from './components/App';
import './style.css';
import { stateManager } from './state';
import { fontManager } from './fontManager';

const mountPoint = document.getElementById('root');
async function start() {
  await stateManager.recoverAutosave();
  try {
    await fontManager.restoreFonts(stateManager.getState().embeddedFonts);
  } catch (error) {
    alert(`Some project fonts could not be restored. ${error instanceof Error ? error.message : ''}`);
  }
  window.addEventListener('pagehide', () => { void stateManager.autosave.flush(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void stateManager.autosave.flush();
  });
  if (mountPoint) {
    render(<App />, mountPoint);
    console.log('Recto Publishing Studio (TypeScript + Preact TSX) loaded.');
  }
}
void start();
