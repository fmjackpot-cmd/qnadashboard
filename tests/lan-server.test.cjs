const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomBytes } = require('node:crypto');
const { digest } = require('../sha256.js');
const { createLanSubscriber } = require('../lan/live-session.js');

test('LAN HTTP clients receive room-scoped events without Ably and restore PDF/messages after restart', async t => {
  const { createLocalServer } = await import('../lan/scripts/local-server.mjs');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-lan-'));
  const dataDirectory = path.join(directory, 'private');
  const publishDirectory = path.join(directory, 'public');
  await fs.mkdir(publishDirectory);
  await fs.writeFile(path.join(publishDirectory, 'index.html'), 'LAN dashboard');
  let running;
  const start = async () => {
    running = createLocalServer({ lan: true, env: { MEETING_ADMIN_KEY: 'lan-secret' }, dataDirectory, publishDirectory });
    await new Promise(resolve => running.server.listen(0, '0.0.0.0', resolve));
    return `http://127.0.0.1:${running.server.address().port}`;
  };
  const stop = async () => { running.closeConnections(); running.server.closeAllConnections(); await new Promise(resolve => running.server.close(resolve)); };
  t.after(async () => { if (running.server.listening) await stop(); await fs.rm(directory, { recursive: true, force: true }); });
  let base = await start();
  assert.equal(running.server.address().address, '0.0.0.0');
  const health = await (await fetch(base + '/__local/health')).json();
  assert.deepEqual(health.missing, []);
  assert.equal(health.persistent, true);
  assert.match(await (await fetch(base + '/dashboard-config.js')).text(), /"meetingTransport":"sse"/);
  assert.equal((await fetch(base + '/__local/events?room=bad!')).status, 403);
  assert.equal((await fetch(base + '/__local/events?room=room', { headers: { Origin: 'http://another-site' } })).status, 403);
  const connections = [];
  const connect = async room => {
    const controller = new AbortController(); connections.push(controller);
    const response = await fetch(`${base}/__local/events?room=${room}`, { signal: controller.signal });
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    const reader = response.body.getReader();
    assert.match(Buffer.from((await reader.read()).value).toString(), /connected/);
    return reader;
  };
  const viewer = await connect('room');
  const otherRoom = await connect('other');
  let otherReceived = false;
  const otherRead = otherRoom.read().then(() => { otherReceived = true; }).catch(() => {});
  const headers = { Authorization: 'Bearer lan-secret', Origin: base };
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), randomBytes(18000)]);
  const upload = await fetch(base + '/.netlify/functions/meeting-document?room=room', { method: 'POST', headers, body: pdf });
  assert.equal(upload.status, 201);
  const document = (await upload.json()).document;
  const endpoint = '/.netlify/functions/meeting?room=room';
  const move = { action: 'set-document', fileId: document.fileId, documentId: document.id, mode: 'question', questionId: 2 };
  assert.equal((await fetch(base + endpoint, { method: 'POST', body: JSON.stringify(move) })).status, 401);
  assert.equal((await fetch(base + endpoint, { method: 'POST', headers: { ...headers, Origin: 'http://another-site' }, body: JSON.stringify(move) })).status, 403);
  assert.equal((await fetch(base + endpoint, { method: 'POST', headers, body: JSON.stringify(move) })).status, 200);
  const event = Buffer.from((await viewer.read()).value).toString();
  assert.match(event, /"questionId":2/);
  assert.equal(otherReceived, false, 'events stay in their own meeting');
  assert.equal((await fetch(base + endpoint, { method: 'POST', headers, body: JSON.stringify({ action: 'send-message', text: 'Saved message' }) })).status, 200);
  assert.match(Buffer.from((await viewer.read()).value).toString(), /Saved message/);
  connections.forEach(controller => controller.abort());
  await otherRead;
  await stop();
  base = await start();
  const restored = await (await fetch(base + endpoint)).json();
  assert.equal(restored.state.questionId, 2);
  assert.equal(restored.state.document.fileId, document.fileId);
  assert.equal(restored.messages[0].text, 'Saved message');
  assert.deepEqual(Buffer.from(await (await fetch(base + document.url)).arrayBuffer()), pdf);
  for (const url of ['/server-data/meetings', '/.env', '/scripts/server-storage.mjs']) assert.equal((await fetch(base + url)).status, 404);
});

test('disk conditional writes allow only one competing administrator to win', async t => {
  const { createDiskStorage } = await import('../lan/scripts/server-storage.mjs');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-store-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const { store } = createDiskStorage(directory);
  const created = await store.setJSON('room', { sequence: 1 }, { onlyIfNew: true });
  const results = await Promise.all([2, 3].map(sequence => store.setJSON('room', { sequence }, { onlyIfMatch: created.etag })));
  assert.equal(results.filter(result => result.modified).length, 1);
  assert.equal((await store.get('room')).sequence, 2);
  assert.equal((await createDiskStorage(directory).store.get('room')).sequence, 2);
});

test('SHA-256 verifies bytes over plain LAN HTTP without Web Crypto', async () => {
  for (const size of [0, 3, 55, 56, 63, 64, 65, 1000, 3_000_000]) {
    const bytes = randomBytes(size);
    assert.equal(Buffer.from(await digest(bytes, {})).toString('hex'), createHash('sha256').update(bytes).digest('hex'), `length ${size}`);
  }
});

test('LAN browser subscription catches up after reconnect and closes on leave', async () => {
  let source;
  class FakeSource {
    constructor(url) { this.url = url; source = this; }
    close() { this.closed = true; }
  }
  let reconnects = 0;
  const states = [], connections = [];
  const pending = createLanSubscriber({ endpoint: '/__local/events', EventSourceClass: FakeSource })('office', {
    onState: state => states.push(state), onReconnect: () => reconnects++, onConnection: connected => connections.push(connected)
  });
  source.onopen();
  const close = await pending;
  assert.equal(source.url.searchParams.get('room'), 'office');
  source.onmessage({ data: '{"sequence":1}' });
  source.onerror(); source.onopen();
  assert.deepEqual(states, [{ sequence: 1 }]);
  assert.deepEqual(connections, [true, false, true]);
  assert.equal(reconnects, 1);
  close(); assert.equal(source.closed, true);
});
