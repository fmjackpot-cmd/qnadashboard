const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('browser management opens without a password, copies addresses, closes meetings and stops the server', async () => {
  const elements = new Map(), listeners = {}, writes = [], copies = [];
  const make = () => ({ value: '', hidden: false, dataset: {}, children: [],
    append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; } });
  for (const [, id] of fs.readFileSync('lan/server-manager.html', 'utf8').matchAll(/id="([^"]+)"/g)) elements.set(id, make());
  let closed = false;
  const context = { document: { getElementById: id => elements.get(id), createElement: make, addEventListener: (name, fn) => listeners[name] = fn },
    AbortSignal, confirm: () => true, navigator: { clipboard: { writeText: async text => copies.push(text) } },
    fetch: async (url, options) => {
      writes.push({ url, options });
      const route = url.split('/').pop();
      if (options.body && route === 'meetings') closed = true;
      const value = route === 'info' ? { urls: ['http://192.168.0.10:8888'], adminKey: 'generated-admin', shutdownAvailable: true, firewallAvailable: true, keyChangeAvailable: true }
        : route === 'meetings' ? { role: 'super', rooms: [{ room: '한글 회의', documentName: '자료.pdf', closedAt: closed ? 1 : null }] } : {};
      return { ok: true, status: 200, json: async () => value };
    } };
  context.window = context;
  vm.runInNewContext(fs.readFileSync('lan/server-manager.js', 'utf8'), context);
  listeners.DOMContentLoaded();
  await new Promise(resolve => setImmediate(resolve));
  const el = id => elements.get(id);
  assert.equal(el('management').hidden, false);
  assert.equal(el('admin-key').value, 'generated-admin');
  await el('addresses').children[0].children[1].onclick();
  assert.equal(copies[0], 'http://192.168.0.10:8888');
  await el('copy-key').onclick(); assert.equal(copies[1], 'generated-admin');
  el('new-admin-key').value = 'updated-admin'; el('confirm-admin-key').value = 'mismatch';
  const before = writes.length;
  await el('change-key-form').onsubmit({ preventDefault() {} });
  assert.equal(writes.length, before, 'mismatched confirmation is not submitted');
  el('confirm-admin-key').value = 'updated-admin';
  await el('change-key-form').onsubmit({ preventDefault() {} });
  assert.equal(el('admin-key').value, 'updated-admin');
  assert.equal(el('new-admin-key').value, '');
  assert.equal(el('confirm-admin-key').value, '');
  assert.ok(writes.some(call => call.url.endsWith('/admin-key') && JSON.parse(call.options.body).newKey === 'updated-admin'));
  await el('rooms').children[0].children[3].children[0].onclick();
  assert.equal(el('rooms').children[0].children[1].textContent, '종료');
  await el('firewall').onclick();
  assert.ok(writes.some(call => call.url.endsWith('/firewall') && call.options.method === 'POST'));
  await el('shutdown').onclick();
  assert.equal(el('management').hidden, true);
  assert.equal(el('admin-key').value, '');
  assert.match(el('feedback').textContent, /서버를 종료/);
  assert.ok(writes.every(call => !call.options.headers.Authorization));
});

test('owner APIs reject remote hosts, cross-site requests and spoofed forwarding headers', async t => {
  const { createLocalServer } = await import('../lan/scripts/local-server.mjs');
  let stopped = false, firewallPort;
  const running = createLocalServer({ lan: true, env: { MEETING_ADMIN_KEY: 'admin-secret' },
    onShutdown: () => { stopped = true; }, onFirewall: port => { firewallPort = port; } });
  await new Promise(resolve => running.server.listen(0, '0.0.0.0', resolve));
  t.after(async () => { running.closeConnections(); running.server.closeAllConnections(); await new Promise(resolve => running.server.close(resolve)); });
  const port = running.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const info = await (await fetch(base + '/__local/owner/info')).json();
  assert.equal(info.adminKey, 'admin-secret');
  assert.equal(info.shutdownAvailable, true);
  assert.equal((await (await fetch(base + '/__local/owner/meetings')).json()).role, 'super');
  const rawStatus = (url, method, headers) => new Promise((resolve, reject) => {
    const request = require('node:http').request(url, { method, headers }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.end();
  });
  for (const route of ['info', 'meetings', 'shutdown', 'firewall', 'admin-key']) {
    const method = ['shutdown', 'firewall', 'admin-key'].includes(route) ? 'POST' : 'GET';
    for (const headers of [{ Host: `attacker.example:${port}` }, { Origin: 'http://other-site' },
      { Host: `192.168.0.10:${port}`, 'X-Forwarded-For': '127.0.0.1', 'X-Forwarded-Host': 'localhost' }]) {
      assert.equal(await rawStatus(base + '/__local/owner/' + route, method, headers), 403, route + JSON.stringify(headers));
    }
  }
  const network = Object.values(require('node:os').networkInterfaces()).flat().find(address => address?.family === 'IPv4' && !address.internal);
  if (network) {
    // Even a caller forging Host: 127.0.0.1 must originate from loopback.
    const remote = `http://${network.address}:${port}`;
    assert.equal(await rawStatus(remote + '/__local/owner/info', 'GET', { Host: `127.0.0.1:${port}` }), 403);
    assert.doesNotMatch(await (await fetch(remote + '/dashboard-config.js')).text(), /meetingOwnerEndpoint/);
  }
  assert.equal(stopped, false); assert.equal(firewallPort, undefined);
  assert.equal((await fetch(base + '/__local/owner/firewall', { method: 'POST' })).status, 200);
  assert.equal(firewallPort, port);
  assert.equal((await fetch(base + '/__local/owner/shutdown', { method: 'POST' })).status, 200);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(stopped, true);
});

test('invalid keys and failed persistence leave the current administrator key active', async t => {
  const { createLocalServer } = await import('../lan/scripts/local-server.mjs');
  let saved, fail = true;
  const running = createLocalServer({ lan: true, env: { MEETING_ADMIN_KEY: 'old-admin' },
    saveAdminKey: async key => { if (fail) throw new Error('not writable'); saved = key; } });
  await new Promise(resolve => running.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { running.closeConnections(); running.server.closeAllConnections(); await new Promise(resolve => running.server.close(resolve)); });
  const base = `http://127.0.0.1:${running.server.address().port}`;
  const change = key => fetch(base + '/__local/owner/admin-key', { method: 'POST', body: JSON.stringify({ newKey: key }) });
  const auth = key => fetch(base + '/.netlify/functions/meeting?room=test', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: JSON.stringify({ action: 'authenticate' }) });
  for (const key of ['', 'short', '12345\n', '한글인증키입니다', 'has space', 'double"quote', 'back\\slash', 'a'.repeat(129)]) {
    assert.equal((await change(key)).status, 400);
  }
  assert.equal(saved, undefined);
  assert.equal((await change('new-admin')).status, 503);
  assert.equal((await auth('old-admin')).status, 200);
  assert.equal((await auth('new-admin')).status, 401);
  fail = false;
  assert.equal((await change('new-admin')).status, 200);
  assert.equal(saved, 'new-admin');
  assert.equal((await auth('old-admin')).status, 401);
  assert.equal((await auth('new-admin')).status, 200);
});
