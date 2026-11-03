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
  const pdf = new File(['%PDF-1.7\nfixture'], 'meeting.pdf', { type: 'application/pdf' });
  const descriptor = { id: 'a'.repeat(64), fileId: '12345678-1234-1234-1234-123456789abc', name: 'meeting.pdf', url: '/.netlify/functions/meeting-document?room=audit-2026&file=12345678-1234-1234-1234-123456789abc' };
  let copied;
  const context = {
    document: doc, location, URL, AbortSignal,
    history: { replaceState: (_, __, url) => { location.href = String(url); } },
    navigator: { clipboard: { writeText: async text => { copied = text; } } },
    setTimeout: () => 1, clearTimeout() {},
    addEventListener: (name, fn) => { listeners[name] = fn; },
    DASHBOARD_CONFIG: { meetingEndpoint: '/.netlify/functions/meeting' },
    DashboardMeeting: { getDocument: () => ({ ready: true, hosted: true, id: 'a'.repeat(64) }), getTarget: () => ({ mode: 'question', questionId: 3 }), getFile: () => pdf, showDocument: async () => {} },
    fetch: async (url, options) => {
      if (options.headers['Content-Type'] === 'application/pdf') {
        writes.push({ url: String(url), body: options.body, headers: options.headers });
        return { ok: true, json: async () => ({ document: descriptor }) };
      }
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
  assert.equal(elements.get('meeting-open').dataset.state, 'admin');
  assert.match(elements.get('meeting-open').title, /관리자 제어 중/);
  assert.equal(writes[0].body.action, 'authenticate');
  assert.equal(writes[1].body, pdf);
  assert.equal(writes[2].body.action, 'set-document');
  assert.equal(writes[2].body.questionId, 3);
  await elements.get('meeting-copy').onclick();
  assert.equal(copied, 'https://dashboard.example/index.html?room=audit-2026');
  assert.ok(!copied.includes('key'));
  elements.get('meeting-leave').onclick();
  assert.equal(elements.get('meeting-send').hidden, true);
  assert.equal(elements.get('meeting-open').dataset.state, 'offline');
  assert.ok(!location.href.includes('room='));
});

function appContext() {
  const events = [];
  const context = {
    console, crypto: webcrypto,
    window: { addEventListener() {}, dispatchEvent: event => events.push(event) },
    document: { addEventListener() {} },
    CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } }
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

test('shared PDF loader checks downloaded bytes before replacing a document and restores the old document after parse failure', async () => {
  const { context } = appContext();
  const { createHash } = require('node:crypto');
  const first = Buffer.from('%PDF-1.7\nfirst');
  const second = Buffer.from('%PDF-1.7\nsecond');
  const id = bytes => createHash('sha256').update(bytes).digest('hex');
  context.window.crypto = webcrypto;
  context.window.location = { href: 'https://dashboard.example/index.html' };
  context.URL = URL;
  context.AbortSignal = AbortSignal;
  context.document.getElementById = () => null;
  context.alert = () => {};
  context.console = { error() {} };
  context.pdfjsLib = { getDocument: () => ({ promise: Promise.resolve({}) }) };
  vm.runInContext(`
    renderQuestionList = () => {};
    parseUploadedPdf = async (_, name) => {
      if (name === 'broken.pdf') throw new Error('parse failure');
      currentItems = [{ id: 1 }, { id: 2 }];
    };
  `, context);
  context.initialBytes = first.buffer.slice(first.byteOffset, first.byteOffset + first.byteLength);
  await vm.runInContext('loadPdfBuffer(initialBytes, "first.pdf", true)', context);
  assert.equal(context.window.DashboardMeeting.getDocument().id, id(first));
  context.fetch = async () => ({ ok: true, arrayBuffer: async () => second.buffer.slice(second.byteOffset, second.byteOffset + second.byteLength) });
  const descriptor = { id: id(second), fileId: '12345678-1234-1234-1234-123456789abc', name: 'second.pdf', url: '/.netlify/functions/meeting-document?room=test&file=12345678-1234-1234-1234-123456789abc' };
  await assert.rejects(context.window.DashboardMeeting.showDocument({ ...descriptor, id: 'b'.repeat(64) }), /검증/);
  assert.equal(context.window.DashboardMeeting.getDocument().id, id(first));
  await assert.rejects(context.window.DashboardMeeting.showDocument({ ...descriptor, name: 'broken.pdf' }), /분석/);
  assert.equal(context.window.DashboardMeeting.getDocument().id, id(first));
  await context.window.DashboardMeeting.showDocument(descriptor);
  assert.equal(context.window.DashboardMeeting.getDocument().shared.fileId, descriptor.fileId);
  let downloads = 0;
  context.fetch = async () => { downloads++; throw new Error('same PDF must not be downloaded again'); };
  await context.window.DashboardMeeting.showTarget({ document: descriptor, documentId: descriptor.id, mode: 'question', questionId: 2 });
  assert.equal(downloads, 0);
  assert.equal(context.window.DashboardMeeting.getTarget().questionId, 2);
});
