import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import type { Plugin } from 'vite';

export function offlineBuild(): Plugin {
  let root: string;
  let output: string;
  return {
    name: 'recto-offline-build',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      output = resolve(root, config.build.outDir);
    },
    closeBundle() {
      const assets = readdirSync(resolve(output, 'assets'), { recursive: true, withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => relative(output, resolve(entry.parentPath, entry.name)).split(sep).join('/'));
      const files = ['index.html', 'manifest.webmanifest', 'logo-192.png', 'logo.png', 'logo.svg', 'toolbar-icons.svg', ...assets].sort();
      const hash = createHash('sha256');
      for (const file of files) hash.update(file + '\0').update(readFileSync(resolve(output, file)));
      const worker = readFileSync(resolve(root, 'scripts/offlineWorker.js'), 'utf8');
      const digest = hash.update(worker).digest('hex').slice(0, 20);
      const config = `{cacheName:'recto-editor-v1-'+new URL(self.registration.scope).pathname+'|'+${JSON.stringify(digest)},files:${JSON.stringify(files)}}`;
      writeFileSync(resolve(output, 'offline-sw.js'), `self.rectoOfflineBuild=${config};\n${worker}`);
    },
  };
}
