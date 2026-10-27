// Serveur local de test : sert public/ et les fonctions api/ (mode démo par défaut).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = new URL('../public/', import.meta.url).pathname;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/[^a-z-]/g, '');
      try {
        const mod = await import(`../api/${name}.js`);
        return mod.default(req, res);
      } catch (e) {
        res.statusCode = 404;
        return res.end(JSON.stringify({ error: e.message }));
      }
    }
    const file = normalize(join(root, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(root)) { res.statusCode = 403; return res.end(); }
    try {
      const body = await readFile(file);
      res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.end('Not found');
    }
  })
  .listen(process.env.PORT || 3000, () => console.log(`http://localhost:${process.env.PORT || 3000}`));
