// Tiny static server plus the /api/edit endpoint the demo page calls.
// No dependencies: node:http and node:fs only.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { editOnce } from './agent.js';
import { appRoutes, mcpRoute } from './app/routes.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEMO = path.join(HERE, '..', 'demo', 'app.html');
const UI = path.join(HERE, '..', 'public', 'index.html');
const STUDIO = path.join(HERE, '..', 'public', 'studio.html');
const PORT = Number(process.env.PORT || 8787);

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 2_000_000) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/studio') {
      const html = await readFile(STUDIO, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }
    if (await mcpRoute(req, res, url, readBody, json)) return;
    if (await appRoutes(req, res, url, readBody, json)) return;
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      const html = await readFile(UI, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }

    if (req.method === 'GET' && req.url === '/app') {
      const html = await readFile(DEMO, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }

    if (req.method === 'GET' && req.url === '/api/health') {
      json(res, 200, { ok: true, model: process.env.META_MODEL || 'muse-spark-1.3' });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/edit') {
      const body = await readBody(req);
      if (typeof body.html !== 'string' || typeof body.request !== 'string') {
        json(res, 400, { error: 'html and request are required' });
        return;
      }
      const computed = body.computed && typeof body.computed === 'object' ? body.computed : {};
      const result = await editOnce({ html: body.html, request: body.request.slice(0, 500), computed });
      json(res, 200, result);
      return;
    }

    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 500, { error: String((e && e.message) || e) });
  }
});

// Local only: the server holds API keys in its environment.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`muse-talk-to-edit on http://localhost:${PORT}`);
});
