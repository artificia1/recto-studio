/// <reference types="vite/client" />

export interface BrowserInstallPrompt extends Event {
  prompt(): Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let promptEvent: BrowserInstallPrompt | undefined;

export function listenForWebInstall() {
  if (!import.meta.env.PROD) return;
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    if ('prompt' in event && typeof event.prompt === 'function') promptEvent = event as BrowserInstallPrompt;
  });
  window.addEventListener('appinstalled', () => { promptEvent = undefined; });
}

export function takeInstallPrompt() {
  const event = promptEvent;
  promptEvent = undefined;
  return event;
}

export function hasInstallPrompt() {
  return promptEvent !== undefined;
}

export function offlineSupported() {
  return import.meta.env.PROD && 'serviceWorker' in navigator;
}

export async function offlineRegistration() {
  if (!offlineSupported()) return undefined;
  return navigator.serviceWorker.getRegistration(new URL('./', document.baseURI));
}

export async function enableOffline() {
  if (!offlineSupported()) throw new Error('Offline setup requires the hosted editor in a browser that supports service workers.');
  return navigator.serviceWorker.register(new URL('./offline-sw.js', document.baseURI));
}
