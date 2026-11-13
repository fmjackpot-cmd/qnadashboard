const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MeetingSession } = require('../live-session.js');

async function fixture() {
  const { createHandler } = await import('../netlify/functions/meeting.mjs');
  const records = new Map(), versions = new Map(), listeners = new Map(), published = [];
  const key = 'message-test-admin-key';
  let clock = Date.now();
  const handler = createHandler({ adminKey: key, now: () => clock,
    store: {
      get: async id => records.get(id) || null,
      getWithMetadata: async id => records.has(id) ? { data: records.get(id), etag: String(versions.get(id)) } : null,
      setJSON: async (id, data, options = {}) => {
        if ((options.onlyIfNew && records.has(id)) || (options.onlyIfMatch && String(versions.get(id)) !== options.onlyIfMatch)) return { modified: false };
        records.set(id, data); versions.set(id, (versions.get(id) || 0) + 1);
        return { modified: true };
      }
    },
    broker: { publish: async (room, event) => {
      published.push(event);
      for (const listener of listeners.get(room) || []) listener.onState(event);
    } }
  });
  const send = (room, body, token = key, origin) => handler(new Request(`https://dashboard.test/?room=${room}`, {
    method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(origin ? { Origin: origin } : {}) },
    body: body ? JSON.stringify(body) : undefined
  }));
  const request = async (room, body, token) => {
    const response = await send(room, body, token);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  };
  const storage = new Map();
  const messageStorage = { getItem: id => storage.get(id), setItem: (id, value) => storage.set(id, value) };
  const client = (custom = {}) => {
    const displayed = [], shown = [];
    const session = new MeetingSession({ request, now: () => clock,
      subscribe: async (room, callbacks) => {
        if (!listeners.has(room)) listeners.set(room, new Set());
        listeners.get(room).add(callbacks);
        return () => listeners.get(room).delete(callbacks);
      },
      getDocument: () => ({ ready: true, hosted: true, id: 'a'.repeat(64) }),
      showTarget: async state => shown.push(state.questionId), onMessage: message => displayed.push(message), ...custom });
    return { session, displayed, shown };
  };
  return { key, send, request, records, published, client, messageStorage, advance: ms => { clock += ms; } };
}

test('messages reach all participants, remain during navigation, queue in order, and dismiss independently', async () => {
  const f = await fixture();
  const admin = f.client(), one = f.client({ messageStorage: f.messageStorage }), two = f.client(), otherRoom = f.client();
  await admin.session.join('room', f.key);
  await one.session.join('room'); await two.session.join('room'); await otherRoom.session.join('other');
  const message = await admin.session.sendMessage('첫 번째 메시지\n줄바꿈');
  assert.equal(one.displayed.at(-1).text, message.text);
  assert.equal(two.displayed.at(-1).text, message.text);
  assert.equal(otherRoom.displayed.at(-1), null);
  assert.equal(admin.displayed.at(-1), null, 'admins send without receiving participant popups');
  await admin.session.navigate({ mode: 'question', questionId: 2 });
  await one.session.applyQueue;
  assert.deepEqual(one.shown, [2]);
  assert.equal(one.session.messages[0].id, message.id);
  await admin.session.sendMessage('두 번째 메시지');
  await one.session.sync();
  assert.equal(one.session.messages.length, 2, 'snapshot replay does not duplicate messages');
  one.session.dismissMessage();
  assert.equal(one.displayed.at(-1).text, '두 번째 메시지');
  assert.equal(two.session.messages[0].id, message.id);
  one.session.dismissMessage();
  assert.equal(one.displayed.at(-1), null);
  const refreshed = f.client({ messageStorage: f.messageStorage });
  await refreshed.session.join('room');
  assert.equal(refreshed.session.messages.length, 0, 'dismissals survive a refresh in the same browser');
  const late = f.client();
  await late.session.join('room');
  assert.equal(late.session.messages.length, 2, 'a new participant receives retained messages');
  assert.equal(f.records.get('room').sequence, 1, 'message writes do not change navigation or its lock');
  for (const c of [admin, one, two, otherRoom, refreshed, late]) c.session.leave();
});

test('missed messages arrive on reconnect and closing still works when local storage is restricted', async () => {
  const f = await fixture();
  const admin = f.client(), viewer = f.client({ messageStorage: { getItem() { throw new Error('restricted'); }, setItem() { throw new Error('restricted'); } } });
  await admin.session.join('room', f.key); await viewer.session.join('room');
  viewer.session.stopSubscription();
  await admin.session.sendMessage('재연결 메시지');
  assert.equal(viewer.session.messages.length, 0);
  await viewer.session.sync();
  assert.equal(viewer.displayed.at(-1).text, '재연결 메시지');
  viewer.session.dismissMessage();
  await viewer.session.sync();
  assert.equal(viewer.session.messages.length, 0);
  await viewer.session.join('other');
  assert.equal(viewer.displayed.at(-1), null);
  admin.session.leave(); viewer.session.leave();
});

test('only authorized same-origin admins can send nonempty messages of at most 1,000 characters', async () => {
  const f = await fixture();
  const body = { action: 'send-message', text: '<img src=x onerror=alert(1)>' };
  assert.equal((await f.send('room', body, 'wrong')).status, 401);
  assert.equal((await f.send('room', body, f.key, 'https://other.test')).status, 403);
  for (const text of ['', '   ', 123, '가'.repeat(1001)]) assert.equal((await f.send('room', { ...body, text })).status, 400);
  assert.equal(f.published.length, 0);
  assert.equal((await f.send('room', { ...body, text: '가'.repeat(1000) })).status, 200);
  const accepted = await (await f.send('room', body)).json();
  assert.equal(accepted.message.text, body.text, 'HTML is delivered as text for the UI to display safely');
  const viewer = f.client(); await viewer.session.join('room');
  await assert.rejects(viewer.session.sendMessage('blocked'), /관리자/);
  assert.equal((await f.request('other')).messages.length, 0);
  viewer.session.leave();
});

test('retained messages expire after 12 hours and are capped at the latest 50', async () => {
  const f = await fixture();
  for (let index = 0; index < 51; index++) await f.request('room', { action: 'send-message', text: String(index) }, f.key);
  const snapshot = await f.request('room');
  assert.equal(snapshot.messages.length, 50);
  assert.equal(snapshot.messages[0].text, '1');
  f.advance(12 * 60 * 60 * 1000);
  assert.deepEqual((await f.request('room')).messages, []);
});

test('simultaneous message sends keep the winner and report a conflict to the other admin', async () => {
  const f = await fixture();
  const responses = await Promise.all(['one', 'two'].map(text => f.send('room', { action: 'send-message', text })));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal(f.published.length, 1);
  assert.equal((await f.request('room')).messages.length, 1);
});
