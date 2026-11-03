import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createHandler } from '../netlify/functions/meeting.mjs';
import { createBroker } from '../netlify/lib/meeting-ably.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.pdf': 'application/pdf' };

export function createLocalServer({ publishDirectory = path.join(root, 'netlify-deploy'),
  env = process.env, broker, namespace = `local-test-${randomUUID()}` } = {}) {
  const records = new Map();
  const missing = [];
  if (!env.ABLY_API_KEY || env.ABLY_API_KEY === 'your_ably_api_key_here') missing.push('ABLY_API_KEY');
  if (!env.MEETING_ADMIN_KEY || env.MEETING_ADMIN_KEY.length < 24 || env.MEETING_ADMIN_KEY.startsWith('replace_with_')) missing.push('MEETING_ADMIN_KEY');
  if (!broker && !missing.includes('ABLY_API_KEY')) {
    try { broker = createBroker({ apiKey: env.ABLY_API_KEY, namespace }); }
    catch { missing.push('ABLY_API_KEY'); }
  }
  const handler = createHandler({ adminKey: missing.includes('MEETING_ADMIN_KEY') ? '' : env.MEETING_ADMIN_KEY,
    broker: missing.includes('ABLY_API_KEY') ? null : broker,
    store: { get: async room => records.get(room) || null, setJSON: async (room, state) => { records.set(room, state); } } });
  const publicRoot = path.resolve(publishDirectory);
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (url.pathname === '/__local/health') {
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.end(JSON.stringify({ ok: true, realtimeConfigured: missing.length === 0, missing }));
        return;
      }
      if (url.pathname === '/.netlify/functions/meeting') {
        const chunks = [];
        let length = 0;
        for await (const chunk of request) {
          length += chunk.length;
          if (length > 8192) { response.writeHead(413); response.end('Request too large'); return; }
          chunks.push(chunk);
        }
        const result = await handler(new Request(url, { method: request.method, headers: request.headers,
          body: ['GET', 'HEAD'].includes(request.method) ? undefined : Buffer.concat(chunks) }));
        response.statusCode = result.status;
        result.headers.forEach((value, name) => response.setHeader(name, value));
        response.end(Buffer.from(await result.arrayBuffer()));
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      const file = path.resolve(publicRoot, relative);
      if (!file.startsWith(publicRoot + path.sep) || path.basename(file).startsWith('.') || path.basename(file) === '_headers') {
        response.writeHead(404); response.end('Not found'); return;
      }
      const bytes = await fs.readFile(file);
      response.setHeader('Content-Type', contentTypes[path.extname(file)] || 'application/octet-stream');
      response.setHeader('Content-Length', bytes.length);
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      response.statusCode = error.code === 'ENOENT' || error.code === 'EISDIR' ? 404 : 500;
      // Never print request bodies, environment values, or credential-bearing errors.
      response.end(response.statusCode === 404 ? 'Not found' : 'Local test server request failed');
    }
  });
  return { server, missing };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile(path.join(root, '.env')); }
  catch (error) {
    if (error.code !== 'ENOENT') { console.error('Could not load .env. Check its format without sharing secret values.'); process.exit(1); }
  }
  const portArg = process.argv.indexOf('--port');
  const port = portArg === -1 ? 8888 : Number(process.argv[portArg + 1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error('Port must be between 1 and 65535.'); process.exit(1); }
  const { server, missing } = createLocalServer();
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Close the existing test server first.` : 'Could not start the local test server.');
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Local dashboard: http://localhost:${port}`);
    console.log('Open this address in a normal window (admin) and a private window (viewer).');
    console.log('Keep this terminal open. Press Ctrl+C to stop. No deployment or Git push is performed.');
    console.log('Local meeting state is kept in memory and resets when this server stops.');
    if (missing.length) {
      console.log(`Add or correct these values in the local .env, then restart: ${missing.join(', ')}`);
      console.log('Keys saved only in the Netlify account are not automatically loaded by this local launcher.');
    } else console.log('Local keys are configured. Ably network connectivity still needs the two-window test.');
  });
}
