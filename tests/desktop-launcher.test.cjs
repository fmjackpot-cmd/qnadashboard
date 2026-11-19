const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

test('packaged EXE starts invisibly, reuses its server, persists data and shuts down from HTTP', {
  skip: !require('node:fs').existsSync('server-package/DashboardServer.exe'), timeout: 45000
}, async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-exe-'));
  await fs.cp(path.resolve('server-package'), folder, { recursive: true });
  const children = [];
  t.after(async () => {
    for (const child of children) if (child.exitCode === null) child.kill();
    // Never delete data outside this test's newly created temporary folder.
    await fs.rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const launch = async (port = 0, installation = folder) => {
    const report = path.join(folder, `ready-${children.length}.json`);
    const env = { ...process.env, DASHBOARD_PORT: String(port), DASHBOARD_LAUNCH_REPORT: report,
      DASHBOARD_DATA_DIRECTORY: path.join(folder, 'test-data') };
    delete env.MEETING_ADMIN_KEY;
    const child = spawn(path.join(installation, 'DashboardServer.exe'), ['--check'], { cwd: installation, windowsHide: true, stdio: 'ignore', env });
    children.push(child);
    child.on('error', () => {});
    for (let count = 0; count < 150; count++) {
      try { return { child, ready: JSON.parse((await fs.readFile(report, 'utf8')).replace(/^\uFEFF/, '')) }; }
      catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
      if (child.exitCode !== null) throw new Error(`Launcher exited before readiness: ${child.exitCode}`);
      await pause(100);
    }
    throw new Error('Launcher readiness timeout');
  };
  const waitExit = async child => {
    for (let count = 0; count < 100 && child.exitCode === null; count++) await pause(50);
    assert.equal(child.exitCode, 0);
  };
  await fs.writeFile(path.join(folder, '.env'), '# preserve test configuration\nSERVER_ADMIN_KEY=obsolete-key\n');
  let launched = await launch();
  let base = new URL(launched.ready.url).origin;
  assert.match(launched.ready.url, /\/server-manager\.html$/);
  assert.match(await (await fetch(launched.ready.url)).text(), /예상질의 서버 관리/);
  const info = await (await fetch(base + '/__local/owner/info')).json();
  assert.match(info.adminKey, /^[a-zA-Z0-9_-]{16}$/);
  const savedEnv = await fs.readFile(path.join(folder, '.env'), 'utf8');
  assert.ok(savedEnv.includes(info.adminKey)); assert.ok(savedEnv.includes('# preserve test configuration'));
  assert.equal(info.shutdownAvailable, true);
  await fs.appendFile(path.join(folder, 'scripts/local-server.mjs'), '\n// Simulate a newer installed build while the existing server keeps running.\n');
  const duplicate = await launch(new URL(base).port);
  assert.equal(duplicate.ready.reused, true);
  await waitExit(duplicate.child);
  assert.equal(launched.child.exitCode, null, 'reopening management does not stop the server');
  const otherFolder = path.join(folder, 'second-install');
  await fs.cp(path.resolve('server-package'), otherFolder, { recursive: true });
  const other = await launch(new URL(base).port, otherFolder);
  assert.equal(other.ready.reused, true, 'another installation opens the running server management page');
  await waitExit(other.child);
  await assert.rejects(fs.access(path.join(otherFolder, '.env')), { code: 'ENOENT' });
  const headers = { Authorization: `Bearer ${info.adminKey}` };
  const query = '?room=' + encodeURIComponent('실행기 회의');
  const upload = await fetch(base + '/.netlify/functions/meeting-document' + query, { method: 'POST', headers, body: '%PDF-1.7\nfixture' });
  const document = (await upload.json()).document;
  assert.ok(document?.id);
  const move = await fetch(base + '/.netlify/functions/meeting' + query, { method: 'POST', headers,
    body: JSON.stringify({ action: 'create-document', documentId: document.id, fileId: document.fileId, mode: 'toc' }) });
  assert.equal(move.status, 200);
  const changedKey = 'updated$Key#2026!';
  assert.equal((await fetch(base + '/__local/owner/admin-key', { method: 'POST', body: JSON.stringify({ newKey: changedKey }) })).status, 200);
  const authenticate = key => fetch(base + '/.netlify/functions/meeting' + query, { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: JSON.stringify({ action: 'authenticate' }) });
  assert.equal((await authenticate(info.adminKey)).status, 401);
  assert.equal((await authenticate(changedKey)).status, 200);
  assert.equal((await fetch(base + '/.netlify/functions/meeting-document' + query, { method: 'POST', headers, body: '%PDF-1.7' })).status, 401);
  assert.equal((await fetch(base + '/__local/meetings', { headers })).status, 401);
  assert.equal((await fetch(base + '/__local/meetings', { headers: { Authorization: 'Bearer ' + changedKey } })).status, 200);
  assert.equal((await (await fetch(base + '/.netlify/functions/meeting' + query)).json()).state.document.id, document.id, 'participants keep reading the existing meeting');

  assert.equal((await fetch(base + '/__local/owner/shutdown', { method: 'POST' })).status, 200);
  await waitExit(launched.child);
  launched = await launch(); base = new URL(launched.ready.url).origin;
  assert.equal((await (await fetch(base + '/__local/owner/info')).json()).adminKey, changedKey, 'restarting preserves the changed admin key');
  const rooms = await (await fetch(base + '/__local/owner/meetings')).json();
  assert.equal(rooms.rooms[0].room, '실행기 회의');
  assert.equal((await fetch(base + '/__local/owner/shutdown', { method: 'POST' })).status, 200);
  await waitExit(launched.child);
});
