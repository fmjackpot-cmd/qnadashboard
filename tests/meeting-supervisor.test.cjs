const { test } = require('node:test');
const assert = require('node:assert/strict');

test('supervisor lists current meetings and persists closure even when notification fails', async () => {
  const { createSupervisorHandler } = await import('../netlify/functions/meeting-supervisor.mjs');
  const { createHandler } = await import('../netlify/functions/meeting.mjs');
  const { createDocumentHandler } = await import('../netlify/lib/meeting-documents.mjs');
  let now = Date.UTC(2026, 10, 20);
  const rows = new Map([
    ['열린회의', { updatedAt: now, document: { name: '자료.pdf' } }],
    ['expired', { updatedAt: now - 86400000, document: {} }],
    ['empty', { updatedAt: now }],
    ['messages:열린회의', []]
  ]);
  const events = [];
  let writes = 0;
  const store = {
    async *list() { yield { blobs: [...rows.keys()].map(key => ({ key })) }; },
    get: async room => rows.get(room),
    getWithMetadata: async room => ({ etag: 'v' + writes, data: rows.get(room) }),
    setJSON: async (room, data, options) => {
      assert.equal(options.onlyIfMatch, 'v' + writes);
      if (writes++ === 0) return { modified: false };
      rows.set(room, data);
      return { modified: true };
    }
  };
  const key = 'test-supervisor-key-do-not-use';
  const supervisor = createSupervisorHandler({ store, key, now: () => now,
    broker: { publish: async (room, event) => { events.push({ room, event }); throw Error('temporarily offline'); } } });
  const url = 'https://site.example';
  const request = (query, options) => new Request(url + '/' + query, options);
  const login = { method: 'POST', headers: { Origin: url }, body: JSON.stringify({ password: key }) };
  assert.equal((await supervisor(request(''))).status, 401);
  assert.equal((await supervisor(request('?action=login', { ...login, headers: { Origin: 'https://other.example' } }))).status, 403);
  assert.equal((await supervisor(request('?action=login', { ...login, body: '{"password":"wrong"}' }))).status, 401);

  const authenticated = await supervisor(request('?action=login', login));
  const resultCookie = authenticated.headers.get('set-cookie');
  assert.match(resultCookie, /Secure; HttpOnly; SameSite=Strict; Max-Age=900/);
  const headers = { Origin: url, Cookie: resultCookie.split(';')[0] };
  const list = await supervisor(request('', { headers }));
  assert.deepEqual((await list.json()).meetings, [{ room: '열린회의', name: '자료.pdf', updatedAt: now }]);

  const query = '?room=' + encodeURIComponent('열린회의');
  const close = await supervisor(request(query + '&action=close', { method: 'POST', headers }));
  assert.deepEqual(await close.json(), { closed: true, notified: false });
  assert.equal(writes, 2);
  assert.equal(events[0].event.type, 'closed');
  assert.deepEqual(await (await supervisor(request('', { headers }))).json(), { meetings: [] });

  const handler = createHandler({ store, adminKey: 'adminkey', broker: {} });
  assert.equal((await handler(request(query))).status, 410);
  assert.equal((await handler(request(query + '&action=token'))).status, 410);
  assert.equal((await handler(request(query, { method: 'POST', headers: { Authorization: 'Bearer adminkey' },
    body: '{"action":"authenticate"}' }))).status, 410);
  const docs = createDocumentHandler({ meetings: store, adminKey: 'adminkey' });
  assert.equal((await docs(request(query))).status, 410);
  assert.equal((await docs(request(query, { method: 'POST', headers: { Authorization: 'Bearer adminkey' } }))).status, 410);
  now += 901000;
  assert.equal((await supervisor(request('', { headers }))).status, 401);
});

test('web participants leave on the close event or a closed snapshot', async () => {
  const { MeetingSession } = require('../live-session.js');
  for (const mode of ['event', 'snapshot']) {
    const statuses = [];
    let unsubscribed = false;
    const session = new MeetingSession({
      request: async () => {
        if (mode === 'snapshot') throw Object.assign(new Error('closed'), { closed: true });
        return { state: null };
      },
      subscribe: async () => () => { unsubscribed = true; },
      onStatus: kind => statuses.push(kind)
    });
    await session.join('room');
    if (mode === 'event') await session.receive({ type: 'closed' });
    assert.equal(session.active, false);
    assert.equal(unsubscribed, true);
    assert.equal(statuses.at(-1), 'closed');
  }
});
