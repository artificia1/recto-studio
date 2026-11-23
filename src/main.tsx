import { render } from 'preact';
import { App } from './components/App';
import './style.css';
import './appearance.css';
import { stateManager } from './state';
import { fontManager } from './fontManager';
import { initializeAppearance } from './appearance';
import { isDesktop } from './desktop';
import { listenForWebInstall } from './webInstall';
import { warmLayout } from './engine/layoutRuntime';

initializeAppearance();
if (!isDesktop()) listenForWebInstall();
const mountPoint = document.getElementById('root');

function loadWorkspaceFonts() {
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Merriweather:ital,wght@0,300;0,400;0,700;1,300&family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&family=Space+Grotesk:wght@500;700&display=swap';
  // Paint with local fallbacks while the optional stylesheet downloads.
  stylesheet.media = 'print';
  stylesheet.onload = () => { stylesheet.media = 'all'; };
  stylesheet.onerror = () => stylesheet.remove();
  document.head.appendChild(stylesheet);
}

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
    loadWorkspaceFonts();
    void warmLayout();
    const counter = import.meta.env.VITE_VISIT_COUNTER_URL;
    if (counter && !isDesktop() && location.origin === 'https://artificia1.github.io' && location.pathname.startsWith('/recto-studio/')) {
      void import('./siteVisits').then(({ recordWebsiteVisit }) => recordWebsiteVisit(counter)).catch(() => {});
    }
  }
}
void start();
