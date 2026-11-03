const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

test('meeting form authenticates, clears the key field, and shares a viewer URL without credentials', async () => {
  const listeners = {}, elements = new Map(), writes = [];
  const html = fs.readFileSync('index.html', 'utf8');
  for (const [, id] of html.matchAll(/id="([^"]+)"/g)) elements.set(id, {
    value: '', dataset: {}, hidden: false, textContent: '',
    addEventListener(name, listener) { this[name] = listener; },
    querySelectorAll() { return []; },
    showModal() { this.open = true; },
    close() { this.open = false; if (this.closeListener) this.closeListener(); }
  });
  const dialog = elements.get('meeting-dialog');
  dialog.addEventListener = (name, listener) => { if (name === 'close') dialog.closeListener = listener; };
  const doc = { getElementById: id => elements.get(id), addEventListener: (name, fn) => { listeners[name] = fn; } };
  const location = { href: 'https://dashboard.example/index.html?old=1#section' };
  let copied;
  const context = {
    document: doc, location, URL, AbortSignal,
    history: { replaceState: (_, __, url) => { location.href = String(url); } },
    navigator: { clipboard: { writeText: async text => { copied = text; } } },
    setTimeout: () => 1, clearTimeout() {},
    addEventListener: (name, fn) => { listeners[name] = fn; },
    DASHBOARD_CONFIG: { meetingEndpoint: '/.netlify/functions/meeting' },
    DashboardMeeting: { getDocument: () => ({ ready: true, hosted: true, id: 'a'.repeat(64) }), getTarget: () => ({ mode: 'question', questionId: 3 }) },
    fetch: async (url, options) => {
      const body = options.body ? JSON.parse(options.body) : null;
      writes.push({ url: String(url), body, headers: options.headers });
      return { ok: true, json: async () => body?.action === 'authenticate' ? { authenticated: true } : { state: { revision: 'one' } } };
    }
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync('live-session.js', 'utf8'), context);
  listeners.DOMContentLoaded();
  elements.get('meeting-open').onclick();
  elements.get('meeting-room').value = 'audit-2026';
  elements.get('meeting-key').value = 'test-only-key-never-share-this';
  await elements.get('meeting-form').onsubmit({ preventDefault() {}, submitter: { id: 'meeting-admin' } });
  assert.equal(elements.get('meeting-key').value, '');
  assert.equal(elements.get('meeting-send').hidden, false);
  assert.equal(writes[0].body.action, 'authenticate');
  assert.equal(writes[1].body.questionId, 3);
  await elements.get('meeting-copy').onclick();
  assert.equal(copied, 'https://dashboard.example/index.html?room=audit-2026');
  assert.ok(!copied.includes('key'));
  elements.get('meeting-leave').onclick();
  assert.equal(elements.get('meeting-send').hidden, true);
  assert.ok(!location.href.includes('room='));
});

function appContext() {
  const events = [];
  const context = {
    console, crypto: webcrypto,
    window: { addEventListener() {}, dispatchEvent: event => events.push(event) },
    document: { addEventListener() {} },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), context);
  vm.runInContext(`
    currentItems = [{ id: 1 }, { id: 2 }];
    meetingDocument = { ready: true, hosted: true, id: '${'a'.repeat(64)}' };
    renderCurrentView = async () => { selectedQuestionId = currentQuestion.id; currentViewMode = 'question'; };
    closeMobileSidebar = () => {};
  `, context);
  return { context, events };
}

test('actual dashboard navigation broadcasts local moves and never echoes remote moves', async () => {
  const { context, events } = appContext();
  await context.openQuestion(1);
  assert.equal(events.length, 1);
  await context.window.DashboardMeeting.showTarget({ documentId: 'a'.repeat(64), mode: 'question', questionId: 2 });
  assert.equal(events.length, 1);
  assert.equal(context.window.DashboardMeeting.getTarget().questionId, 2);
  await context.openQuestion(1);
  assert.equal(events.length, 2);
  assert.equal(context.window.DashboardMeeting.getTarget().questionId, 1);
});

test('dashboard refuses mismatched PDFs and missing questions; a local PDF returns to the hosted document', async () => {
  const { context } = appContext();
  await assert.rejects(context.window.DashboardMeeting.showTarget({ documentId: 'b'.repeat(64), mode: 'question', questionId: 1 }), /PDF.*다릅니다/);
  await assert.rejects(context.window.DashboardMeeting.showTarget({ documentId: 'a'.repeat(64), mode: 'question', questionId: 99 }), /문항/);
  context.window.DASHBOARD_CONFIG = { defaultPdf: { url: './docs/audit-2026.pdf' } };
  vm.runInContext(`
    meetingDocument.hosted = false;
    loadHostedPdf = async () => { meetingDocument.hosted = true; };
  `, context);
  await context.window.DashboardMeeting.showTarget({ documentId: 'a'.repeat(64), mode: 'question', questionId: 2 });
  assert.equal(context.window.DashboardMeeting.getDocument().hosted, true);
  assert.equal(context.window.DashboardMeeting.getTarget().questionId, 2);
});
