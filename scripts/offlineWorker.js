const { cacheName, files } = self.rectoOfflineBuild;
const cachePrefix = 'recto-editor-v1-';
const scope = new URL(self.registration.scope);
const shell = new URL('index.html', scope);
const resources = new Set(files.map(file => new URL(file, scope).href));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    try {
      const queue = [...resources];
      // A deployment can contain many lazy editor tools. Keep network
      // concurrency bounded without starting up a half-cached installation.
      const store = async () => {
        while (queue.length) {
          const url = queue.pop();
          const response = await fetch(url, { cache: 'reload', redirect: 'error' });
          if (!response.ok) throw new Error('Could not cache the Recto editor.');
          await cache.put(url, response);
        }
      };
      const results = await Promise.allSettled(Array.from({ length: 6 }, store));
      if (results.some(result => result.status === 'rejected')) throw new Error('Offline installation is incomplete.');
    } catch (error) {
      await caches.delete(cacheName);
      throw error;
    }
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(cachePrefix + scope.pathname + '|') && name !== cacheName) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== scope.origin) return;
  const navigation = event.request.mode === 'navigate' &&
    (url.pathname === scope.pathname || url.pathname === shell.pathname);
  const resource = navigation ? shell.href : url.href;
  if (!resources.has(resource)) return;
  // The active worker serves one coherent build. A newer build waits until
  // every editor window using the previous build has closed.
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    return (await cache.match(resource)) || fetch(event.request);
  })());
});
