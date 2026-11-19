const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

test('existing active PDFs restore the directory without republishing the meeting', async () => {
  const { createLanDirectory } = await import('../lan/scripts/lan-directory.mjs');
  const state = { document: { fileId: 'a'.repeat(36) }, updatedAt: 100 };
  const records = new Map([['기존 회의', state]]);
  const directory = createLanDirectory({
    store: { get: async key => records.get(key), setJSON: async (key, value) => records.set(key, value) },
    documents: { list: async () => ({ blobs: [{ key: 'a'.repeat(36) }] }),
      getMetadata: async () => ({ metadata: { room: '기존 회의' } }) }
  });
  const result = await directory.serial(() => directory.handle(new Request('http://localhost/__local/meetings')));
  assert.equal((await result.json()).rooms[0].room, '기존 회의');
  assert.equal(records.get('directory:rooms')[0].openedAt, 100);
});

test('Korean meetings list publicly; only the owner closes them and closure survives restart', async t => {
  const { createLocalServer } = await import('../lan/scripts/local-server.mjs');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-directory-'));
  let running, base;
  const start = async () => {
    running = createLocalServer({ lan: true, dataDirectory: directory,
      env: { MEETING_ADMIN_KEY: 'admin-secret' } });
    await new Promise(resolve => running.server.listen(0, '0.0.0.0', resolve));
    base = `http://127.0.0.1:${running.server.address().port}`;
  };
  const stop = async () => {
    running.closeConnections(); running.server.closeAllConnections();
    await new Promise(resolve => running.server.close(resolve));
  };
  t.after(async () => { if (running?.server.listening) await stop(); await fs.rm(directory, { recursive: true, force: true }); });
  await start();
  const call = (url, key, body) => fetch(base + url, { method: body ? 'POST' : 'GET',
    headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), Origin: base },
    body: body ? JSON.stringify(body) : undefined });
  const name = '2026 행정사무감사';
  const endpoint = '/.netlify/functions/meeting?room=' + encodeURIComponent(name);
  const documentEndpoint = '/.netlify/functions/meeting-document?room=' + encodeURIComponent(name);
  const upload = await fetch(base + documentEndpoint, { method: 'POST', body: '%PDF-1.7\nfixture', headers: { Authorization: 'Bearer admin-secret' } });
  assert.equal(upload.status, 201);
  const document = (await upload.json()).document;
  const move = { action: 'set-document', documentId: document.id, fileId: document.fileId, mode: 'toc' };
  assert.equal((await call(endpoint, 'owner-secret', move)).status, 401, 'owner key cannot impersonate meeting admins');
  assert.equal((await call(endpoint, 'admin-secret', { ...move, action: 'create-document' })).status, 200);
  assert.equal((await call(endpoint, 'admin-secret', { ...move, action: 'create-document' })).status, 409,
    'creating a meeting cannot replace an existing meeting');
  const list = await (await call('/__local/meetings')).json();
  assert.equal(list.role, 'viewer'); assert.equal(list.rooms[0].room, name);
  assert.equal(list.rooms[0].closedAt, null);
  assert.equal((await (await call('/__local/meetings', 'admin-secret')).json()).role, 'admin');
  assert.equal((await (await call('/__local/owner/meetings')).json()).role, 'super');
  assert.equal((await call('/__local/meetings', 'owner-secret')).status, 401, 'legacy owner passwords no longer grant access');
  assert.equal((await call('/__local/meetings', 'wrong-key')).status, 401);
  for (const key of [null, 'admin-secret']) assert.equal((await call('/__local/meetings', key, { action: 'close', room: name })).status, 403);
  const csrf = await fetch(base + '/__local/owner/meetings', { method: 'POST', headers: { Origin: 'http://other' }, body: JSON.stringify({ action: 'close', room: name }) });
  assert.equal(csrf.status, 403);
  const controller = new AbortController(); t.after(() => controller.abort());
  const events = await fetch(base + '/__local/events?room=' + encodeURIComponent(name), { signal: controller.signal });
  const reader = events.body.getReader(); await reader.read();
  assert.equal((await call('/__local/owner/meetings', null, { action: 'close', room: name })).status, 200);
  assert.match(Buffer.from((await reader.read()).value).toString(), /"type":"closed"/);
  controller.abort();
  for (const url of [endpoint, document.url, '/__local/events?room=' + encodeURIComponent(name)]) assert.equal((await call(url)).status, 410);
  assert.equal((await call(endpoint, 'admin-secret', move)).status, 410);
  assert.equal((await call(documentEndpoint, 'admin-secret', {})).status, 410);
  assert.deepEqual((await (await call('/__local/meetings')).json()).rooms, []);
  assert.ok((await (await call('/__local/owner/meetings')).json()).rooms[0].closedAt);
  await stop(); await start();
  assert.equal((await call(endpoint)).status, 410);
  assert.deepEqual((await (await call('/__local/meetings')).json()).rooms, []);
  assert.equal((await call(endpoint, 'admin-secret', move)).status, 410);
  // A different Korean name can still open, and it is isolated from the closed room.
  const second = endpoint.replace(encodeURIComponent(name), encodeURIComponent('예산 심의'));
  assert.equal((await call(second, 'admin-secret', { action: 'authenticate' })).status, 200);
});

test('browser listing supports anonymous entry, admin authentication, owner closure and return to list', async () => {
  const vm = require('node:vm');
  const syncFs = require('node:fs');
  const elements = new Map(), listeners = {}, calls = [];
  const make = () => ({ value: '', style: {}, dataset: {}, hidden: false, children: [],
    addEventListener(name, fn) { this['on' + name] = fn; },
    querySelectorAll() { return []; }, append(...items) { this.children.push(...items); },
    replaceChildren() { this.children = []; }, focus() {},
    showModal() { this.open = true; }, close() { this.open = false; this.onclose?.(); } });
  for (const [, id] of syncFs.readFileSync('index.html', 'utf8').matchAll(/id="([^"]+)"/g)) elements.set(id, make());
  const location = { href: 'http://dashboard.local/' };
  let source, closed = false;
  const context = { document: { getElementById: id => elements.get(id), createElement: make, addEventListener: (name, fn) => listeners[name] = fn },
    location, history: { replaceState: (_, __, url) => location.href = String(url) }, URL, AbortSignal, setTimeout, clearTimeout,
    confirm: () => true, addEventListener() {},
    DASHBOARD_CONFIG: { meetingEndpoint: '/.netlify/functions/meeting', meetingTransport: 'sse', meetingEvents: '/__local/events', meetingDirectory: '/__local/meetings', meetingOwnerEndpoint: '/__local/owner/meetings' },
    EventSource: class { constructor() { source = this; queueMicrotask(() => this.onopen()); } close() { this.closed = true; } },
    DashboardMeeting: { getDocument: () => ({}), getTarget: () => ({ mode: 'toc' }) },
    fetch: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url) === '/__local/meetings') {
        const key = options.headers?.Authorization;
        const role = key === 'Bearer owner-secret' ? 'super' : key === 'Bearer admin-secret' ? 'admin' : 'viewer';
        if (options.method === 'POST') { assert.equal(role, 'super'); closed = true; }
        return { ok: true, json: async () => ({ role, rooms: closed && role !== 'super' ? [] : [{ room: '한글 회의', closedAt: closed ? 123 : null }] }) };
      }
      return { ok: true, json: async () => ({ state: null, messages: [] }) };
    } };
  context.window = context;
  vm.runInNewContext(syncFs.readFileSync('lan/live-session.js', 'utf8'), context);
  listeners.DOMContentLoaded();
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await flush();
  const el = id => elements.get(id);
  assert.ok(!el('meeting-dialog').open, 'the initial screen leaves the create and participate choices visible');
  el('start-admin').onclick();
  assert.equal(el('meeting-heading').textContent, '회의 개설하기');
  assert.equal(el('meeting-form').hidden, false);
  assert.equal(el('meeting-directory').hidden, true);
  assert.equal(el('meeting-pdf').required, true);
  await el('meeting-form').onsubmit({ preventDefault() {} });
  assert.match(el('meeting-error').textContent, /인증키/);
  el('meeting-key').value = 'admin-secret';
  await el('meeting-form').onsubmit({ preventDefault() {} });
  assert.match(el('meeting-error').textContent, /PDF/);
  assert.equal(el('meeting-role-switch').hidden, true);
  el('start-viewer').onclick(); await flush();
  assert.equal(el('meeting-directory-login').hidden, true);
  assert.equal(el('meeting-directory-key').disabled, true);
  el('meeting-role-admin').onclick(); await flush();
  assert.equal(el('meeting-directory-login').hidden, false);
  assert.equal(el('meeting-directory-key').disabled, false);
  assert.equal(el('meeting-heading').textContent, '관리자로 참여하기');
  assert.equal(el('meeting-form').hidden, true);
  assert.equal(el('meeting-list').children[0].children[1].disabled, true, 'admin entry requires authentication');
  el('meeting-role-viewer').onclick(); await flush();
  assert.equal(el('meeting-directory-login').hidden, true);
  assert.equal(el('meeting-list').children.length, 1, el('meeting-directory-status').textContent);
  assert.match(el('meeting-list').children[0].children[0].textContent, /한글 회의/);
  await el('meeting-list').children[0].children[1].onclick();
  assert.equal(el('meeting-dialog').open, false);
  assert.ok(calls.filter(call => call.url.includes('room=')).every(call => !call.options.headers?.Authorization));
  el('meeting-open').onclick();
  assert.equal(el('meeting-heading').textContent, '회의 정보');
  assert.equal(el('meeting-info-role').textContent, '참여자');
  assert.equal(el('meeting-directory').hidden, true);
  assert.equal(el('meeting-role-switch').hidden, true);
  assert.equal(el('meeting-sharing').hidden, false);
  source.onmessage({ data: JSON.stringify({ type: 'closed' }) });
  await flush();
  assert.equal(source.closed, true);
  assert.equal(el('meeting-dialog').open, true);
  assert.equal(el('dashboard-shell').inert, true);
  assert.match(el('meeting-status').textContent, /회의를 종료/);
  el('meeting-role-admin').onclick(); await flush();
  el('meeting-directory-key').value = 'admin-secret';
  await el('meeting-directory-login').onsubmit({ preventDefault() {} });
  assert.equal(el('meeting-directory-key').value, '');
  assert.equal(el('meeting-admin-fields').hidden, false);
  assert.equal(el('meeting-key').value, 'admin-secret');
  el('meeting-directory-key').value = 'owner-secret';
  await el('meeting-directory-login').onsubmit({ preventDefault() {} });
  assert.match(el('meeting-directory-status').textContent, /인증키를 확인/);
  assert.equal(el('meeting-key').value, '');
  assert.ok(el('meeting-list').children.every(row => row.children.every(child => child.textContent !== '강제종료')));
  assert.equal(el('start-owner').hidden, false);
  assert.equal(el('meeting-owner').hidden, false);
  el('meeting-owner').onclick();
  assert.equal(location.href, 'http://dashboard.local/server-manager.html');
  assert.ok(calls.every(call => !call.url.includes('secret')));
});
