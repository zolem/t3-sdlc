// @ts-check
// Static file server for one run's files folder. Started detached by serve.js:
//   node serveMain.js <root> <stateFile> <nonce>
// Binds 127.0.0.1 on a free port, atomically writes { pid, port, nonce } to
// stateFile (the nonce, also on its command line, proves a pid is still this
// server), and exits after 12 hours.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const [root, stateFile, nonce] = process.argv.slice(2);
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
  const file = path.resolve(root, `.${rel}`);
  if (!file.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[/** @type {keyof typeof TYPES} */ (path.extname(file).toLowerCase())] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
server.listen(0, '127.0.0.1', () => {
  const addr = server.address();
  const tmp = `${stateFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ pid: process.pid, port: typeof addr === 'object' && addr ? addr.port : 0, nonce }));
  fs.renameSync(tmp, stateFile);
});
setTimeout(() => process.exit(0), 12 * 3600 * 1000).unref();
