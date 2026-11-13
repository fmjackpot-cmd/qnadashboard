const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MeetingSession, createAblySubscriber } = require('../live-session.js');
const state = (sequence, questionId = sequence) => ({ sequence, revision: `move-${sequence}`, updatedAt: Date.now(), documentId: 'a'.repeat(64), mode: 'question', questionId });
const getDocument = () => ({ ready: true, hosted: true, id: 'a'.repeat(64) });

test('idle viewers and presenters make no periodic HTTP requests; moves arrive through subscription', async () => {
  let requests = 0, publish;
  const shown = [];
  const viewer = new MeetingSession({ getDocument, showTarget: async s => shown.push(s.questionId),
    request: async () => { requests++; return { state: null }; },
    subscribe: async (_, handlers) => { publish = handlers.onState; return () => {}; }
  });
  await viewer.join('room');
  assert.equal(requests, 1);
  await publish(state(1));
  await viewer.applyQueue;
  await viewer.navigate({ mode: 'question', questionId: 9 });
  await Promise.resolve();
  assert.equal(requests, 1, 'free browsing and receiving do not fetch Netlify');
  assert.deepEqual(shown, [1]);
  let adminRequests = 0, subscriptions = 0;
  const admin = new MeetingSession({ getDocument, showTarget() {},
    request: async () => { adminRequests++; return { state: state(2) }; },
    subscribe: async () => { subscriptions++; return () => {}; }
  });
  await admin.join('room', 'test-admin-key');
  await admin.navigate({ mode: 'question', questionId: 2 });
  assert.equal(adminRequests, 3, 'authentication, initial snapshot, and deliberate move only');
  assert.equal(subscriptions, 1, 'admins also receive realtime moves');
  viewer.leave(); admin.leave();
});

test('a live move during initial snapshot fetch cannot be overwritten by the stale snapshot', async () => {
  let snapshot, handlers;
  const shown = [];
  const viewer = new MeetingSession({ getDocument, showTarget: async s => shown.push(s.questionId),
    request: () => new Promise(resolve => { snapshot = resolve; }),
    subscribe: async (_, callbacks) => { handlers = callbacks; return () => {}; }
  });
  const joining = viewer.join('room');
  await Promise.resolve();
  handlers.onState(state(2));
  snapshot({ state: state(1) });
  await joining;
  await viewer.applyQueue;
  assert.deepEqual(shown, [2]);
  await viewer.receive(state(1));
  assert.deepEqual(shown, [2]);
});

test('latest event survives PDF loading and reconnect catches up only once when invoked', async () => {
  let ready = false, handlers, snapshot = state(1), reads = 0;
  const shown = [];
  const viewer = new MeetingSession({ getDocument: () => ({ ready }), showTarget: async s => shown.push(s.questionId),
    request: async () => { reads++; return { state: snapshot }; },
    subscribe: async (_, callbacks) => { handlers = callbacks; return () => {}; }
  });
  await viewer.join('room');
  handlers.onState(state(2));
  await viewer.applyQueue;
  ready = true;
  await viewer.applyPending();
  assert.deepEqual(shown, [2]);
  await viewer.navigate({ mode: 'question', questionId: 99 });
  snapshot = state(3);
  handlers.onConnection(false, 'disconnected');
  await handlers.onReconnect();
  assert.deepEqual(shown, [2, 3]);
  assert.equal(reads, 2);
});

test('server generates room-scoped receive-only signed tokens using the real Ably SDK', async () => {
  const { createBroker } = await import('../netlify/lib/meeting-ably.mjs');
  const secret = 'not-a-real-secret-used-only-in-tests';
  const broker = createBroker({ apiKey: `test.app:${secret}`, namespace: 'preview-test' });
  const result = await broker.issueToken('audit');
  assert.equal(result.channel, 'dashboard:preview-test:audit');
  assert.deepEqual(JSON.parse(result.tokenRequest.capability), { 'dashboard:preview-test:audit': ['subscribe'] });
  assert.equal(result.tokenRequest.ttl, 3600000);
  assert.ok(result.tokenRequest.mac);
  assert.ok(!JSON.stringify(result).includes(secret));
});

test('token endpoint needs no admin credential and a broker failure is never reported as a successful broadcast', async t => {
  // This test deliberately breaks the broker; its expected server error should
  // not look like a real connection failure in the test launcher's output.
  t.mock.method(console, 'error', () => {});
  const { createHandler } = await import('../netlify/functions/meeting.mjs');
  const adminKey = 'test-only-administrator-key-24-chars';
  let reads = 0, writes = 0;
  const handler = createHandler({ adminKey,
    store: { get: async () => { reads++; return null; }, setJSON: async () => { writes++; } },
    broker: { issueToken: async room => ({ channel: room, tokenRequest: { capability: 'subscribe' } }), publish: async () => { throw new Error('broker down'); } }
  });
  const token = await handler(new Request('https://test.example/?room=room&action=token'));
  assert.equal(token.status, 200);
  assert.equal(reads, 0, 'token refresh must not read meeting state');
  const fail = await handler(new Request('https://test.example/?room=room', {
    method: 'POST', headers: { Authorization: `Bearer ${adminKey}` }, body: JSON.stringify(state(1))
  }));
  assert.equal(fail.status, 503);
  assert.equal(writes, 1);
  const unconfigured = createHandler({ adminKey, store: {} });
  const missing = await unconfigured(new Request('https://test.example/?room=room'));
  assert.match((await missing.json()).error, /ABLY_API_KEY/);
});

test('Ably transport subscribes, renews tokens, catches up on recovery, and closes on leave', async () => {
  let instance, tokenReads = 0, reconnects = 0;
  const received = [], connections = [];
  class Emitter {
    constructor() { this.listeners = {}; }
    on(name, callback) { this.listeners[name] = callback; }
    off() { this.listeners = {}; }
    emit(name, data) { this.listeners[name]?.(data); }
  }
  class Realtime {
    constructor(options) {
      instance = this; this.options = options; this.connection = new Emitter();
      this.channel = new Emitter();
      this.channel.subscribe = async (name, listener) => { this.event = name; this.listener = listener; };
      this.channel.unsubscribe = () => { this.unsubscribed = true; };
      this.channels = { get: name => { this.name = name; return this.channel; } };
    }
    connect() { this.connection.emit('connected'); }
    close() { this.closed = true; }
  }
  const subscribe = createAblySubscriber({ loadSdk: async () => ({ Realtime }), getToken: async () => {
    tokenReads++; return { channel: 'dashboard:test:room', tokenRequest: { nonce: `token-${tokenReads}` } };
  } });
  const stop = await subscribe('room', { onState: s => received.push(s), onReconnect: () => reconnects++, onConnection: c => connections.push(c) });
  const getAuth = () => new Promise((resolve, reject) => instance.options.authCallback({}, (error, token) => error ? reject(error) : resolve(token)));
  assert.equal((await getAuth()).nonce, 'token-1');
  assert.equal(tokenReads, 1);
  assert.equal((await getAuth()).nonce, 'token-2');
  instance.listener({ data: state(4) });
  assert.equal(received[0].questionId, 4);
  instance.connection.emit('disconnected');
  instance.connection.emit('connected');
  assert.equal(reconnects, 1);
  instance.channel.emit('attached', { resumed: false });
  instance.channel.emit('attached', { resumed: false });
  assert.equal(reconnects, 2);
  stop();
  assert.ok(instance.closed && instance.unsubscribed);
  instance.listener({ data: state(5) });
  assert.equal(received.length, 1);
  assert.deepEqual(connections, [true, false, true]);
});

test('server publishes only navigation metadata on the same channel used by receive tokens', async () => {
  const { createBroker } = await import('../netlify/lib/meeting-ably.mjs');
  let published, usedChannel;
  class RestClient {
    constructor() {
      this.channels = { get: channel => {
        usedChannel = channel;
        return { publish: async message => { published = message; } };
      } };
    }
  }
  const broker = createBroker({ apiKey: 'server-key', namespace: 'production', RestClient });
  await broker.publish('room', state(3));
  assert.equal(usedChannel, 'dashboard:production:room');
  assert.equal(published.name, 'navigate');
  assert.equal(published.id, 'move-3');
  assert.equal(published.data.questionId, 3);
  assert.ok(!JSON.stringify(published).includes('server-key'));
});

test('a failed subscription cleans up the SDK connection instead of falling back to polling', async () => {
  let closed = false, unsubscribed = false;
  class Realtime {
    constructor() {
      this.connection = { on() {}, off() {} };
      this.channels = { get: () => ({ on() {}, off() {}, subscribe: async () => { throw new Error('permission denied'); }, unsubscribe: () => { unsubscribed = true; } }) };
    }
    connect() {}
    close() { closed = true; }
  }
  const subscribe = createAblySubscriber({ loadSdk: async () => ({ Realtime }), getToken: async () => ({ channel: 'room', tokenRequest: {} }) });
  await assert.rejects(subscribe('room', { onState() {}, onReconnect() {}, onConnection() {} }), /permission denied/);
  assert.ok(closed && unsubscribed);
});
