import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const root = path.resolve('dist');
const manifest = JSON.parse(fs.readFileSync(path.join(root, '.vite/manifest.json'), 'utf8'));
const files = new Set();
function visit(key) {
  const chunk = manifest[key];
  if (!chunk || files.has(chunk.file)) return;
  if (chunk.file.endsWith('.js')) files.add(chunk.file);
  (chunk.imports || []).forEach(visit);
}
Object.entries(manifest).filter(([, chunk]) => chunk.isEntry).forEach(([key]) => visit(key));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const match of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) {
  if (!/^https?:/.test(match[1])) files.add(match[1].replace(/^\.\//, '').replace(/^\//, ''));
}
const startup = [...files].map(file => {
  const data = fs.readFileSync(path.join(root, file));
  return { file, bytes: data.length, gzipBytes: gzipSync(data).length };
});
const report = {
  startupJavaScriptBytes: startup.reduce((total, item) => total + item.bytes, 0),
  startupJavaScriptGzipBytes: startup.reduce((total, item) => total + item.gzipBytes, 0),
  files: startup,
};
console.log(JSON.stringify(report, null, 2));
// Leave room for normal editor development while catching accidental eager tools.
if (report.startupJavaScriptBytes > 1_000_000 || report.startupJavaScriptGzipBytes > 300_000) {
  console.error('Startup JavaScript exceeds the 1 MB raw / 300 kB gzip budget. See PERFORMANCE.md.');
  process.exitCode = 1;
}
