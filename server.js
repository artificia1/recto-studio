import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
};

export function createStaticServer(rootDirectory = path.join(__dirname, 'dist')) {
const root = path.resolve(rootDirectory);
const isInside = (base, target) => {
  const relative = path.relative(base, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
return http.createServer(async (req, res) => {
  const reply = (status, message) => {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(message);
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    reply(405, 'Method Not Allowed');
    return;
  }
  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch {
    reply(400, 'Bad Request');
    return;
  }
  if (urlPath.includes('\0') || urlPath.includes(':') || urlPath.split(/[/\\]/).some(segment => segment.startsWith('.'))) {
    reply(403, 'Forbidden');
    return;
  }
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
  
  const relativePath = urlPath.replace(/^[/\\]+/, '');
  
  const filePath = path.resolve(root, relativePath);
  if (!isInside(root, filePath)) {
    reply(403, 'Forbidden');
    return;
  }
  try {
    const [realRoot, realFile] = await Promise.all([fs.promises.realpath(root), fs.promises.realpath(filePath)]);
    if (!isInside(realRoot, realFile)) {
      reply(403, 'Forbidden');
      return;
    }
    if (!(await fs.promises.stat(realFile)).isFile()) {
      reply(404, 'Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = fs.createReadStream(realFile);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  } catch {
    reply(404, 'Not Found');
  }
});
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!fs.existsSync(path.join(__dirname, 'dist', 'index.html'))) {
    console.error('Built app not found. Run npm run build before npm run desktop.');
    process.exitCode = 1;
  } else {
    const server = createStaticServer();
    server.listen(PORT, '127.0.0.1', () => {
      console.log(`Recto Studio is live at http://127.0.0.1:${server.address().port}`);
    });
  }
}
