import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('dist');
const base = '/kadr-video-lab/';
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.webmanifest':'application/manifest+json', '.svg':'image/svg+xml', '.png':'image/png', '.md':'text/plain; charset=utf-8' };
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/') { response.writeHead(302, { Location: base }); response.end(); return; }
    if (!url.pathname.startsWith(base)) throw new Error('outside base');
    const relative = decodeURIComponent(url.pathname.slice(base.length)) || 'index.html';
    const filename = path.resolve(root, relative);
    if (!filename.startsWith(root + path.sep)) throw new Error('outside root');
    const data = await readFile(filename);
    response.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'text/plain', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' }); response.end(data);
  } catch { response.writeHead(404, { 'Content-Type':'text/plain' }); response.end('Not found'); }
});
server.listen(4173, '127.0.0.1', () => console.log('Local QA: http://127.0.0.1:4173/kadr-video-lab/'));
