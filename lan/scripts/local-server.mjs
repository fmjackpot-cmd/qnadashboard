import http from 'node:http';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { createRequire } from 'node:module';
import { saveAdminKey as writeAdminKey, validAdminKey } from './server-settings.mjs';
import { createDiskStorage } from './server-storage.mjs';
import { createLanDirectory } from './lan-directory.mjs';
import { createLanBroker } from './lan-broker.mjs';
import { createHandler } from '../netlify/functions/meeting.mjs';
import { createBrokerWithClient } from '../netlify/lib/meeting-broker.mjs';
import { createDocumentHandler, MAX_PDF_BYTES } from '../netlify/lib/meeting-documents.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const launcherId = createHash('sha256').update(root).digest('hex');
// Identify the code loaded by this process, not the static files served from disk.
// A rebuild can update the UI while an existing process still holds old handlers.
const serverVersion = createHash('sha256');
for (const file of ['scripts/local-server.mjs', 'netlify/functions/meeting.mjs', 'netlify/functions/meeting-document.mjs',
  'netlify/lib/meeting-documents.mjs', 'netlify/lib/meeting-ably.mjs', 'netlify/lib/meeting-broker.mjs', 'scripts/server-storage.mjs', 'scripts/lan-broker.mjs', 'scripts/lan-directory.mjs', 'scripts/server-settings.mjs']) {
  serverVersion.update(file).update(readFileSync(path.join(root, file)));
}
const loadedServerVersion = serverVersion.digest('hex');
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.pdf': 'application/pdf', '.woff2': 'font/woff2' };

export function createLocalServer({ publishDirectory = path.join(root, 'netlify-deploy'),
  env = process.env, broker, lan = false, dataDirectory, onShutdown, onFirewall, saveAdminKey, namespace = `local-test-${randomUUID()}` } = {}) {
  const records = new Map();
  const recordVersions = new Map();
  const files = new Map();
  let documents = {
    list: async () => ({ blobs: [...files.keys()].map(key => ({ key })) }),
    delete: async id => { files.delete(id); },
    set: async (id, data, { metadata }) => { files.set(id, { data, metadata }); },
    getWithMetadata: async id => files.get(id) || null,
    getMetadata: async id => files.has(id) ? { metadata: files.get(id).metadata } : null
  };
  const missing = [];
  if (lan) broker = createLanBroker();
  if (!lan && (!env.ABLY_API_KEY || env.ABLY_API_KEY === 'your_ably_api_key_here')) missing.push('ABLY_API_KEY');
  if (!env.MEETING_ADMIN_KEY || env.MEETING_ADMIN_KEY.length < 6 || env.MEETING_ADMIN_KEY.startsWith('replace_with_')) missing.push('MEETING_ADMIN_KEY');
  if (!broker && !missing.includes('ABLY_API_KEY')) {
    try { broker = createBrokerWithClient({ apiKey: env.ABLY_API_KEY, namespace, RestClient: require('ably').Rest }); }
    catch { missing.push('ABLY_API_KEY'); }
  }
  let adminKey = missing.includes('MEETING_ADMIN_KEY') ? '' : env.MEETING_ADMIN_KEY;
  let store = {
      get: async room => records.get(room) || null,
      getWithMetadata: async room => records.has(room) ? { data: records.get(room), etag: String(recordVersions.get(room)) } : null,
      setJSON: async (room, state, options = {}) => {
        if ((options.onlyIfNew && records.has(room)) ||
            (options.onlyIfMatch && String(recordVersions.get(room)) !== options.onlyIfMatch)) return { modified: false };
        records.set(room, state);
        recordVersions.set(room, (recordVersions.get(room) || 0) + 1);
        return { modified: true, etag: String(recordVersions.get(room)) };
      }
    };
  if (dataDirectory) ({ store, documents } = createDiskStorage(dataDirectory));
  const documentHandler = createDocumentHandler({ documents, adminKey: () => adminKey, meetings: store });
  const handler = createHandler({ documents, adminKey: () => adminKey, broker: missing.includes('ABLY_API_KEY') ? null : broker, store, ...(lan ? { retentionMs: Infinity } : {}) });
  const directory = lan ? createLanDirectory({ store, documents, broker, adminKey: () => adminKey }) : null;
  const publicRoot = path.resolve(publishDirectory);
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const localOwner = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress) &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
      if (lan && ['/__local/owner/info', '/__local/owner/shutdown', '/__local/owner/firewall', '/__local/owner/admin-key'].includes(url.pathname)) {
        const origin = request.headers.origin;
        if (!localOwner || (origin && origin !== url.origin)) { response.writeHead(403); response.end(JSON.stringify({ error: '서버 PC에서 로컬 주소로 접속해주세요.' })); return; }
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        if (url.pathname.endsWith('/info') && request.method === 'GET') {
          const port = server.address().port;
          const urls = [...new Set(Object.values(networkInterfaces()).flat().filter(address => address?.family === 'IPv4' && !address.internal).map(address => `http://${address.address}:${port}`))];
          response.end(JSON.stringify({ urls, adminKey, port, shutdownAvailable: Boolean(onShutdown), firewallAvailable: Boolean(onFirewall), keyChangeAvailable: Boolean(saveAdminKey) })); return;
        }
        if (url.pathname.endsWith('/admin-key') && request.method === 'POST' && saveAdminKey) {
          let text = '';
          for await (const chunk of request) {
            text += chunk.toString('utf8');
            if (text.length > 1024) { response.writeHead(413); response.end(JSON.stringify({ error: '요청이 너무 큽니다.' })); return; }
          }
          let key;
          try { key = JSON.parse(text).newKey; } catch { response.writeHead(400); response.end(JSON.stringify({ error: '올바른 요청이 아닙니다.' })); return; }
          if (!validAdminKey(key)) { response.writeHead(400); response.end(JSON.stringify({ error: '6~128자의 영문·숫자·특수문자를 사용하세요. 공백·따옴표·역슬래시는 제외합니다.' })); return; }
          try {
            await directory.serial(async () => { await saveAdminKey(key); adminKey = key; });
            response.end(JSON.stringify({ changed: true }));
          } catch { response.writeHead(503); response.end(JSON.stringify({ error: '인증키를 저장하지 못했습니다. 폴더 쓰기 권한을 확인해주세요. 기존 키는 유지됩니다.' })); }
          return;
        }
        if (url.pathname.endsWith('/firewall') && request.method === 'POST' && onFirewall) {
          try { await onFirewall(server.address().port); response.end(JSON.stringify({ allowed: true })); }
          catch { response.writeHead(503); response.end(JSON.stringify({ error: '접속 허용이 완료되지 않았습니다. Windows 관리자 권한 확인에서 허용하거나 전산 담당자에게 문의해주세요.' })); }
          return;
        }
        if (url.pathname.endsWith('/shutdown') && request.method === 'POST' && onShutdown) {
          response.once('finish', () => { const timer = setTimeout(onShutdown, 100); timer.unref(); });
          response.end(JSON.stringify({ shutdown: true })); return;
        }
        response.writeHead(405); response.end(JSON.stringify({ error: '허용되지 않은 요청입니다.' })); return;
      }
      if (lan && url.pathname === '/__local/events') {
        const origin = request.headers.origin;
        const room = url.searchParams.get('room') || '';
        if (request.method !== 'GET' || (origin && origin !== url.origin) || !/^[a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ _-]{1,64}$/.test(room) || missing.length) {
          response.writeHead(403); response.end(); return;
        }
        await directory.serial(async () => {
          if (await directory.closed(room)) { response.writeHead(410); response.end(); return; }
          broker.attach(request, response, room);
        }); return;
      }
      if (lan && url.pathname === '/dashboard-config.js') {
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        response.end(`window.DASHBOARD_CONFIG = ${JSON.stringify({ meetingEndpoint: '/.netlify/functions/meeting',
          meetingDocumentEndpoint: '/.netlify/functions/meeting-document', meetingTransport: 'sse', meetingEvents: '/__local/events', meetingDirectory: '/__local/meetings', ...(localOwner ? { meetingOwnerEndpoint: '/__local/owner/meetings' } : {}) })};`);
        return;
      }
      if (url.pathname === '/__local/health') {
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.end(JSON.stringify({ ok: true, application: 'question-dashboard', launcherId, serverVersion: loadedServerVersion,
          realtimeConfigured: missing.length === 0, lan, persistent: Boolean(dataDirectory), missing }));
        return;
      }
      if ((lan && ['/__local/meetings', '/__local/owner/meetings'].includes(url.pathname)) || ['/.netlify/functions/meeting', '/.netlify/functions/meeting-document'].includes(url.pathname)) {
        const isDocument = url.pathname === '/.netlify/functions/meeting-document';
        const chunks = [];
        let length = 0;
        for await (const chunk of request) {
          length += chunk.length;
          if (length > (isDocument ? MAX_PDF_BYTES : 8192)) { response.writeHead(413, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: '파일 또는 요청이 너무 큽니다.' })); return; }
          chunks.push(chunk);
        }
        const webRequest = new Request(url, { method: request.method, headers: request.headers,
          body: ['GET', 'HEAD'].includes(request.method) ? undefined : Buffer.concat(chunks) });
        const dispatch = async () => {
          if (url.pathname === '/__local/owner/meetings') {
            const origin = request.headers.origin;
            if (!localOwner || (origin && origin !== url.origin)) return new Response(JSON.stringify({ error: '서버 PC의 로컬 관리 화면에서만 사용할 수 있습니다.' }), { status: 403 });
            return directory.handle(webRequest, { owner: true });
          }
          if (url.pathname === '/__local/meetings') return directory.handle(webRequest);
          const room = url.searchParams.get('room') || '';
          if (directory && await directory.closed(room)) return new Response(JSON.stringify({ error: '종료된 회의입니다. 새 회의 이름으로 개설해주세요.', closed: true }),
            { status: 410, headers: { 'Content-Type': 'application/json' } });
          const result = await (isDocument ? documentHandler : handler)(webRequest);
          if (directory && !isDocument && request.method === 'POST' && result.ok) {
            const state = await store.get(room);
            if (state?.document) await directory.register(room);
          }
          return result;
        };
        const result = directory ? await directory.serial(dispatch) : await dispatch();
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
  return { server, missing, serverVersion: loadedServerVersion, closeConnections: () => { if (lan) broker.close(); } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile(path.join(root, '.env')); }
  catch (error) {
    if (error.code !== 'ENOENT') { console.error('Could not load .env. Check its format without sharing secret values.'); process.exit(1); }
  }
  const portArg = process.argv.indexOf('--port');
  const port = portArg === -1 ? 8888 : Number(process.argv[portArg + 1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error('Port must be between 1 and 65535.'); process.exit(1); }
  const lan = process.argv.includes('--lan');
  const dataArg = process.argv.indexOf('--data-dir');
  const dataDirectory = lan ? path.resolve(dataArg === -1 ? path.join(root, 'server-data') : process.argv[dataArg + 1]) : undefined;
  const { server, missing, closeConnections } = createLocalServer({ lan, dataDirectory, ...(lan ? {
    saveAdminKey: key => writeAdminKey(path.join(root, '.env'), key),
    onShutdown: () => {
      server.close();
      closeConnections();
      server.closeAllConnections();
    }
  } : {}) });
  if (lan && missing.length) { console.error('Set MEETING_ADMIN_KEY (at least 6 characters) in .env before starting the server.'); process.exit(1); }
  const openAppWindow = () => {
    const appBrowserArg = process.argv.indexOf('--app-browser');
    if (appBrowserArg === -1) return;
    const browser = process.argv[appBrowserArg + 1];
    if (!browser) return;
    const app = spawn(browser, [`--app=http://localhost:${port}`, '--window-size=1280,800'], {
      detached: true, stdio: 'ignore', windowsHide: false
    });
    app.on('error', () => console.error('Could not open the app window. Open the local address manually.'));
    app.on('exit', code => {
      if (code) console.error('The browser could not start in app mode. Try installing the site as an app from the browser menu.');
    });
    app.unref();
  };
  server.on('error', async error => {
    if (error.code === 'EADDRINUSE') {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/__local/health`, { signal: AbortSignal.timeout(2000) });
        const health = response.ok ? await response.json() : null;
        if (health?.ok && health.application === 'question-dashboard' && health.launcherId === launcherId) {
          if (health.serverVersion !== loadedServerVersion || Boolean(health.lan) !== lan) {
            console.error('The running dashboard uses outdated server code. Stop its terminal (Ctrl+C), then run run-app.bat again.');
            console.error(lan ? 'Server data remains in the server-data folder.' : 'Local meeting data is in memory. Upload the meeting PDF again after restarting.');
            process.exitCode = 1;
            return;
          }
          console.log(`Reusing the running dashboard: http://localhost:${port}`);
          console.log('The existing server keeps the current meeting state. Close its terminal to stop it.');
          openAppWindow();
          return;
        }
      } catch { /* Another application or an unresponsive server owns this port. */ }
    }
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Close the existing test server first.` : 'Could not start the local test server.');
    process.exitCode = 1;
  });
  server.listen(port, lan ? '0.0.0.0' : '127.0.0.1', () => {
    openAppWindow();
    console.log(`Local dashboard: http://localhost:${port}`);
    console.log('Open this address in a normal window (admin) and a private window (viewer).');
    console.log('Keep this terminal open. Press Ctrl+C to stop. No deployment or Git push is performed.');
    if (lan) {
      console.log(`Data folder: ${dataDirectory}`);
      console.log('LAN server: no Ably account or API key required.');
      for (const addresses of Object.values(networkInterfaces())) for (const address of addresses || []) {
        if (address.family === 'IPv4' && !address.internal) console.log(`Other computers: http://${address.address}:${port}`);
      }
    } else console.log('Local meeting state is kept in memory and resets when this server stops.');
    if (missing.length) {
      console.log(`Add or correct these values in the local .env, then restart: ${missing.join(', ')}`);
      console.log('Keys saved only in the Netlify account are not automatically loaded by this local launcher.');
    } else console.log('Local keys are configured. Ably network connectivity still needs the two-window test.');
  });
}
