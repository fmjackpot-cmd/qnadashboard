const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MeetingSession } = require('../live-session.js');

const key = 'test-only-admin-key-not-a-real-secret';
const documentId = 'a'.repeat(64);
const target = questionId => ({ documentId, mode: 'question', questionId });

async function setup() {
  const { createHandler } = await import('../netlify/functions/meeting.mjs');
  const records = new Map();
  let clock = 1000;
  let version = 0;
  const subscriptions = new Map();
  const publications = [];
  const broker = {
    issueToken: async room => ({ channel: `test:${room}`, tokenRequest: { capability: JSON.stringify({ [`test:${room}`]: ['subscribe'] }) } }),
    publish: async (room, state) => {
      publications.push({ room, state });
      for (const listener of subscriptions.get(room) || []) listener.onState(state);
    }
  };
  const store = {
    get: async room => records.get(room) || null,
    setJSON: async (room, state) => records.set(room, state)
  };
  const handler = createHandler({ store, broker, adminKey: key, now: () => clock, revision: () => `event-${++version}` });
  const request = async (room, body, token) => {
    const response = await handler(new Request(`https://meeting.example/.netlify/functions/meeting?room=${encodeURIComponent(room)}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    }));
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error), { state: result.state });
    return result;
  };
  const makeClient = (custom = {}) => {
    const shown = [], statuses = [];
    const client = new MeetingSession({ request,
      subscribe: async (room, callbacks) => {
        if (!subscriptions.has(room)) subscriptions.set(room, new Set());
        subscriptions.get(room).add(callbacks);
        return () => subscriptions.get(room).delete(callbacks);
      },
      getDocument: () => ({ ready: true, hosted: true, id: documentId }),
      showTarget: async state => shown.push(state.questionId ?? 'toc'),
      onStatus: (status, message) => statuses.push({ status, message }), now: () => clock, ...custom });
    return { client, shown, statuses };
  };
  return { createHandler, handler, request, records, store, broker, publications, subscriptions, makeClient, advance: ms => { clock += ms; } };
}

test('two viewers browse independently until the next admin move; same-question resend also takes priority', async () => {
  const { makeClient } = await setup();
  const admin = makeClient(), one = makeClient(), two = makeClient();
  await admin.client.join('room', key);
  await one.client.join('room');
  await two.client.join('room');
  await admin.client.navigate(target(3));
  await Promise.all([one.client.applyQueue, two.client.applyQueue]);
  assert.deepEqual(one.shown, [3]);
  assert.deepEqual(two.shown, [3]);
  await one.client.navigate(target(9));
  await one.client.applyQueue;
  await two.client.applyQueue;
  assert.deepEqual(one.shown, [3], 'unchanged admin state must not repeatedly reset independent reading');
  assert.equal(one.client.browsing, true);
  assert.equal(two.client.browsing, false);
  await admin.client.navigate(target(3));
  await Promise.all([one.client.applyQueue, two.client.applyQueue]);
  assert.deepEqual(one.shown, [3, 3]);
  assert.equal(one.client.browsing, false);
  await admin.client.navigate({ mode: 'toc' });
  await one.client.applyQueue;
  assert.deepEqual(one.shown, [3, 3, 'toc']);
});

test('late join, reconnect, and explicit return show the latest admin event', async () => {
  const { makeClient, request } = await setup();
  let unavailable = false;
  const admin = makeClient(), viewer = makeClient({ request: (...args) => {
    if (unavailable) return Promise.reject(new Error('offline'));
    return request(...args);
  } });
  await admin.client.join('meeting', key);
  await admin.client.navigate(target(7));
  await viewer.client.join('meeting');
  await viewer.client.sync();
  await viewer.client.navigate(target(2));
  unavailable = true;
  await viewer.client.sync();
  assert.equal(viewer.statuses.at(-1).status, 'error');
  unavailable = false;
  await viewer.client.sync();
  assert.equal(viewer.statuses.at(-1).status, 'browsing');
  assert.deepEqual(viewer.shown, [7]);
  unavailable = true;
  await admin.client.navigate(target(8));
  await viewer.client.sync();
  unavailable = false;
  await viewer.client.sync();
  await viewer.client.navigate(target(2));
  await viewer.client.returnToAdmin();
  assert.deepEqual(viewer.shown, [7, 8, 8]);
});

test('loading and document errors retry without marking an admin move as consumed', async () => {
  const { makeClient } = await setup();
  let ready = false, mismatched = true;
  const admin = makeClient(), viewer = makeClient({
    getDocument: () => ({ ready }),
    showTarget: async () => { if (mismatched) throw new Error('PDF version mismatch'); }
  });
  await admin.client.join('room', key);
  await viewer.client.join('room');
  await admin.client.navigate(target(2));
  await viewer.client.applyQueue;
  assert.equal(viewer.statuses.at(-1).status, 'loading');
  ready = true;
  await viewer.client.applyPending();
  assert.equal(viewer.client.lastRevision, null);
  assert.equal(viewer.statuses.at(-1).status, 'error');
  mismatched = false;
  await viewer.client.applyPending();
  assert.equal(viewer.client.lastRevision, 'event-1');
});

test('ordered admin writes cannot let a slow older move overwrite the latest move', async () => {
  const { makeClient, request, records } = await setup();
  let release;
  const firstWrite = new Promise(resolve => { release = resolve; });
  const admin = makeClient({ request: async (room, body, token) => {
    if (body?.questionId === 1) await firstWrite;
    return request(room, body, token);
  } });
  await admin.client.join('room', key);
  const first = admin.client.navigate(target(1));
  const second = admin.client.navigate(target(2));
  await Promise.resolve();
  release();
  await Promise.all([first, second]);
  assert.equal(records.get('room').questionId, 2);
  assert.equal(records.get('room').revision, 'event-2');
});

test('leave ignores in-flight state; rooms are isolated and old return targets are cleared', async () => {
  const { makeClient, request } = await setup();
  await request('one', target(4), key);
  const viewer = makeClient();
  await viewer.client.join('one');
  await viewer.client.sync();
  await viewer.client.join('two');
  await viewer.client.returnToAdmin();
  await viewer.client.sync();
  assert.deepEqual(viewer.shown, [4]);
  let resolveRead;
  viewer.client.request = () => new Promise(resolve => { resolveRead = resolve; });
  const syncing = viewer.client.sync();
  viewer.client.leave();
  resolveRead({ state: { revision: 'late', ...target(9) } });
  await syncing;
  assert.deepEqual(viewer.shown, [4]);
  assert.equal(viewer.client.key, '');
});

test('viewers cannot publish, and admins cannot transmit unshared local PDFs', async () => {
  const { makeClient, records, request } = await setup();
  const viewer = makeClient();
  await viewer.client.join('room');
  await viewer.client.navigate(target(9));
  assert.equal(records.size, 0);
  await assert.rejects(request('room', target(9)), /인증키/);
  const admin = makeClient({ getDocument: () => ({ ready: true, hosted: false, id: documentId }) });
  await admin.client.join('room', key);
  await admin.client.navigate(target(2));
  assert.equal(records.size, 0);
  assert.match(admin.statuses.at(-1).message, /업로드/);
});

test('server rejects invalid credentials, cross-site writes, malformed input, and missing configuration', async () => {
  const { handler, records, createHandler, store } = await setup();
  const send = (body, headers = {}, room = 'room') => handler(new Request(`https://meeting.example/?room=${room}`, {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, ...headers }, body
  }));
  assert.equal((await send(JSON.stringify(target(1)), { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await send(JSON.stringify(target(1)), { Origin: 'https://other.example' })).status, 403);
  assert.equal((await send('{')).status, 400);
  assert.equal((await send('null')).status, 400);
  assert.equal((await send(JSON.stringify(target(-1)))).status, 400);
  assert.equal((await send(JSON.stringify({ ...target(1), documentId: 'wrong' }))).status, 400);
  assert.equal((await send(JSON.stringify(target(1)), {}, '../other')).status, 400);
  assert.equal((await send('x'.repeat(2050))).status, 413);
  assert.equal((await handler(new Request('https://meeting.example/?room=room', { method: 'DELETE' }))).status, 405);
  const unconfigured = createHandler({ store, adminKey: '' });
  assert.equal((await unconfigured(new Request('https://meeting.example/?room=room'))).status, 503);
  assert.equal(records.size, 0);
});

test('state reads use strong consistency, do not cache, and expire after 12 hours', async () => {
  const { request, handler, advance } = await setup();
  await request('room', target(1), key);
  const response = await handler(new Request('https://meeting.example/?room=room'));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).state.questionId, 1);
  advance(12 * 60 * 60 * 1000);
  assert.equal((await request('room')).state, null);
  let options;
  const { createHandler } = await import('../netlify/functions/meeting.mjs');
  const handler2 = createHandler({ adminKey: key, broker: {}, store: { get: async (_, opts) => { options = opts; return null; } } });
  await handler2(new Request('https://meeting.example/?room=room'));
  assert.equal(options.consistency, 'strong');
});

test('admin keys of exactly six characters authenticate; shorter keys are rejected', async () => {
  const { createHandler, store, broker } = await setup();
  const authenticate = (handler, key) => handler(new Request('https://meeting.example/?room=room', {
    method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: JSON.stringify({ action: 'authenticate' })
  }));
  const six = createHandler({ store, broker, adminKey: 'test06' });
  assert.equal((await authenticate(six, 'test06')).status, 200);
  assert.equal((await authenticate(six, 'wrong6')).status, 401);
  const five = createHandler({ store, broker, adminKey: 'test5' });
  const rejected = await authenticate(five, 'test5');
  assert.equal(rejected.status, 503);
  assert.match((await rejected.json()).error, /6자 이상/);
});

test('admins follow each other without echoing and the other admin can take over at exactly two seconds', async () => {
  const { makeClient, advance, publications, request, records } = await setup();
  const first = makeClient(), second = makeClient(), viewer = makeClient();
  await first.client.join('room', key);
  await second.client.join('room', key);
  await viewer.client.join('room');
  await first.client.navigate(target(3));
  await Promise.all([second.client.applyQueue, viewer.client.applyQueue]);
  assert.deepEqual(first.shown, [], 'the sender does not render its own broadcast again');
  assert.deepEqual(second.shown, [3]);
  assert.deepEqual(viewer.shown, [3]);
  assert.equal(second.client.canNavigate(false), false);
  assert.equal(second.statuses.at(-1).status, 'cooldown');
  advance(1999);
  await second.client.navigate(target(7));
  assert.equal(publications.length, 1, 'blocked clicks are discarded, not delayed in a queue');
  await assert.rejects(request('room', { ...target(7), controllerId: second.client.controllerId }, key), /2초/);
  assert.equal(records.get('room').questionId, 3);
  advance(1);
  await second.client.navigate(target(7));
  await Promise.all([first.client.applyQueue, viewer.client.applyQueue]);
  assert.deepEqual(first.shown, [7]);
  assert.deepEqual(second.shown, [3]);
  assert.deepEqual(viewer.shown, [3, 7]);
  assert.equal(publications.length, 2);
  assert.equal(first.client.canNavigate(false), false);
  assert.equal(second.client.canNavigate(false), true);
  await second.client.navigate(target(8));
  await first.client.applyQueue;
  assert.deepEqual(first.shown, [7, 8], 'the current controller can continue navigating');
  first.client.leave(); second.client.leave(); viewer.client.leave();
});

test('administrator reconnect receives the latest missed move and leaving clears the lock', async () => {
  const { makeClient, request, advance } = await setup();
  const admin = makeClient();
  await admin.client.join('room', key);
  await request('room', { ...target(4), controllerId: 'another-admin' }, key);
  await admin.client.applyQueue;
  assert.equal(admin.client.canNavigate(false), false);
  advance(2000);
  admin.client.stopSubscription();
  await request('room', { ...target(9), controllerId: 'another-admin' }, key);
  await admin.client.sync();
  assert.deepEqual(admin.shown, [4, 9]);
  assert.equal(admin.statuses.at(-1).status, 'cooldown');
  admin.client.leave();
  assert.equal(admin.client.canNavigate(false), true);
  await admin.client.join('another-room', key);
  assert.equal(admin.client.canNavigate(false), true);
  admin.client.leave();
});

test('conditional writes reject simultaneous admins without overwriting or broadcasting the losing move', async () => {
  const { createHandler } = await import('../netlify/functions/meeting.mjs');
  let stored = null, etag = 0, published = 0, reads = 0, release, clock = 1000;
  let bothRead = new Promise(resolve => { release = resolve; });
  const handler = createHandler({ adminKey: key, now: () => clock, broker: { publish: async () => { published++; } },
    store: {
      get: async () => stored,
      getWithMetadata: async () => {
        const snapshot = stored && { data: stored, etag: String(etag) };
        if (++reads === 2) release();
        await bothRead;
        return snapshot;
      },
      setJSON: async (_, state, options) => {
        if ((options.onlyIfNew && stored) || (options.onlyIfMatch && options.onlyIfMatch !== String(etag))) return { modified: false };
        stored = state; etag++;
        return { modified: true };
      }
    }
  });
  const send = controllerId => handler(new Request('https://meeting.example/?room=room', {
    method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: JSON.stringify({ ...target(1), controllerId })
  }));
  const responses = await Promise.all([send('admin-one'), send('admin-two')]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal(published, 1);
  assert.equal(stored.sequence, 1);
  const conflict = await responses.find(r => r.status === 409).json();
  assert.equal(conflict.state.controllerId, stored.controllerId);
  clock += 2000;
  reads = 0;
  bothRead = new Promise(resolve => { release = resolve; });
  const updates = await Promise.all([send('admin-one'), send('admin-two')]);
  assert.deepEqual(updates.map(r => r.status).sort(), [200, 409], 'an existing room also requires a matching ETag');
  assert.equal(published, 2);
  assert.equal(stored.sequence, 2);
});
