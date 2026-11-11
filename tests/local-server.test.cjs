const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('local launcher serves only the built dashboard and runs the real meeting handler without Netlify login', async t => {
  const { createLocalServer } = await import('../scripts/local-server.mjs');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-local-test-'));
  const publishDirectory = path.join(directory, 'public');
  await fs.mkdir(publishDirectory);
  await fs.writeFile(path.join(publishDirectory, 'index.html'), '<title>Dashboard local test</title>');
  await fs.writeFile(path.join(directory, '.env'), 'PRIVATE_VALUE=must-not-be-served');
  await fs.writeFile(path.join(publishDirectory, '_headers'), 'internal config');
  const adminKey = 'test06';
  const sent = [];
  const { server } = createLocalServer({ publishDirectory,
    env: { ABLY_API_KEY: 'test.key:fake-secret', MEETING_ADMIN_KEY: adminKey },
    broker: { issueToken: async room => ({ channel: `local:${room}`, tokenRequest: { capability: 'subscribe' } }),
      publish: async (room, state) => { sent.push({ room, state }); } }
  });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await (await fetch(base)).text()), '<title>Dashboard local test</title>');
  assert.equal((await fetch(`${base}/index.html`, { method: 'HEAD' })).status, 200);
  for (const url of ['/.env', '/%2e%2e%5c.env', '/scripts/local-server.mjs', '/_headers']) {
    assert.equal((await fetch(base + url)).status, 404, url);
  }
  const health = await (await fetch(base + '/__local/health')).json();
  assert.equal(health.ok, true);
  assert.equal(health.application, 'question-dashboard');
  assert.match(health.launcherId, /^[a-f0-9]{64}$/);
  assert.equal(health.realtimeConfigured, true);
  assert.deepEqual(health.missing, []);
  assert.ok(!JSON.stringify(health).includes('fake-secret'));
  const endpoint = base + '/.netlify/functions/meeting?room=local-room';
  const token = await (await fetch(endpoint + '&action=token')).json();
  assert.equal(token.channel, 'local:local-room');
  const move = { mode: 'question', questionId: 4, documentId: 'a'.repeat(64) };
  const denied = await fetch(endpoint, { method: 'POST', body: JSON.stringify(move) });
  assert.equal(denied.status, 401);
  const posted = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${adminKey}`, Origin: base }, body: JSON.stringify(move) });
  assert.equal(posted.status, 200);
  assert.equal(sent[0].state.questionId, 4);
  const snapshot = await (await fetch(endpoint)).json();
  assert.equal(snapshot.state.revision, sent[0].state.revision);
  const bytes = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(17000, 65)]);
  const uploadResponse = await fetch(base + '/.netlify/functions/meeting-document?room=local-room', {
    method: 'POST', headers: { Authorization: `Bearer ${adminKey}`, 'X-Pdf-Name': encodeURIComponent('local-upload.pdf') }, body: bytes
  });
  assert.equal(uploadResponse.status, 201, 'local binary uploads are not limited to the old 8KB JSON body limit');
  const { document } = await uploadResponse.json();
  const downloaded = await fetch(base + document.url);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
  const switchResponse = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${adminKey}` },
    body: JSON.stringify({ ...move, documentId: document.id, fileId: document.fileId, action: 'set-document' }) });
  assert.equal(switchResponse.status, 200);
  assert.equal((await switchResponse.json()).state.document.fileId, document.fileId);
});

test('missing local keys are reported by name without exposing values', async t => {
  const { createLocalServer } = await import('../scripts/local-server.mjs');
  const { server, missing } = createLocalServer({ env: {} });
  assert.deepEqual(missing, ['ABLY_API_KEY', 'MEETING_ADMIN_KEY']);
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/.netlify/functions/meeting?room=test`);
  assert.equal(response.status, 503);
});

async function runLauncher(port) {
  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, [path.resolve('scripts/local-server.mjs'), '--port', String(port)], {
    env: { ...process.env, ABLY_API_KEY: 'your_ably_api_key_here', MEETING_ADMIN_KEY: 'replace_with_test_key' },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Launcher did not exit')); }, 10000);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', code => { clearTimeout(timeout); resolve({ code, output }); });
  });
}

test('repeated launches reuse the same dashboard without stopping its server', async t => {
  const { createLocalServer } = await import('../scripts/local-server.mjs');
  const { server } = createLocalServer({ env: {} });
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  for (let i = 0; i < 2; i++) {
    const result = await runLauncher(port);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /Reusing the running dashboard/);
    assert.equal((await fetch(`http://127.0.0.1:${port}/__local/health`)).status, 200);
  }
});

test('launcher refuses a port owned by another application or another checkout', async t => {
  const http = require('node:http');
  let health = { ok: true };
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(health));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  for (const candidate of [{ ok: true }, { ok: true, application: 'question-dashboard', launcherId: 'different-checkout' }]) {
    health = candidate;
    const result = await runLauncher(port);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /already in use/);
    assert.equal((await fetch(`http://127.0.0.1:${port}`)).status, 200);
  }
});
