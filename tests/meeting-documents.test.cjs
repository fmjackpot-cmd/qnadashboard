const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { MeetingSession } = require('../live-session.js');
const adminKey = 'test06';
const pdf = name => new File([`%PDF-1.7\n${name}\n%%EOF`], `${name}.pdf`, { type: 'application/pdf' });

async function fixture() {
  const { createDocumentHandler, MAX_PDF_BYTES } = await import('../netlify/lib/meeting-documents.mjs');
  const { createHandler } = await import('../netlify/functions/meeting.mjs');
  const files = new Map(), states = new Map(), subscribers = new Set(), published = [], order = [];
  const documents = {
    set: async (id, data, { metadata }) => { files.set(id, { data, metadata }); },
    getWithMetadata: async id => files.get(id) || null,
    getMetadata: async id => files.has(id) ? { metadata: files.get(id).metadata } : null
  };
  const fileHandler = createDocumentHandler({ documents, adminKey });
  const meeting = createHandler({ adminKey, documents,
    store: { get: async room => states.get(room) || null, setJSON: async (room, state) => { states.set(room, state); } },
    broker: { publish: async (room, state) => { published.push(state); for (const callback of subscribers) callback(state); } }
  });
  const parse = async response => {
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  };
  const uploadFile = async (room, file, key) => {
    order.push('upload');
    return parse(await fileHandler(new Request(`https://dashboard.test/.netlify/functions/meeting-document?room=${room}`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'X-Pdf-Name': encodeURIComponent(file.name) }, body: file
    })));
  };
  const request = async (room, body, key) => {
    if (body?.action === 'set-document') order.push('commit');
    return parse(await meeting(new Request(`https://dashboard.test/.netlify/functions/meeting?room=${room}`, {
      method: body ? 'POST' : 'GET', headers: body ? { Authorization: `Bearer ${key}` } : {}, body: body ? JSON.stringify(body) : undefined
    })));
  };
  const download = async descriptor => {
    order.push('download');
    const response = await fileHandler(new Request(new URL(descriptor.url, 'https://dashboard.test')));
    assert.equal(response.status, 200);
    return response.arrayBuffer();
  };
  return { files, states, documents, fileHandler, meeting, uploadFile, request, download, subscribers, published, order, MAX_PDF_BYTES };
}

test('admin uploads then downloads the exact object before publishing; participants and late joins switch PDFs automatically', async () => {
  const f = await fixture();
  let adminDoc = { ready: true, hosted: false, id: '0'.repeat(64) };
  const shown = [];
  const viewer = new MeetingSession({
    request: f.request, getDocument: () => ({ ready: false }),
    subscribe: async (_, handlers) => { f.subscribers.add(handlers.onState); return () => f.subscribers.delete(handlers.onState); },
    showTarget: async state => { const bytes = await f.download(state.document); shown.push({ id: state.documentId, bytes: Buffer.from(bytes).toString(), question: state.questionId }); }
  });
  const admin = new MeetingSession({ request: f.request, uploadFile: f.uploadFile, getDocument: () => adminDoc,
    getTarget: () => ({ mode: 'question', questionId: 1 }),
    showDocument: async descriptor => {
      const bytes = await f.download(descriptor);
      assert.equal(createHash('sha256').update(Buffer.from(bytes)).digest('hex'), descriptor.id);
      adminDoc = { ready: true, hosted: true, id: descriptor.id, shared: descriptor };
    }
  });
  await admin.join('room', adminKey);
  await viewer.join('room');
  await admin.shareFile(pdf('first'));
  await viewer.applyQueue;
  assert.deepEqual(f.order.slice(0, 3), ['upload', 'download', 'commit']);
  assert.match(shown[0].bytes, /first/);
  assert.equal(shown[0].question, 1);
  assert.equal(f.published.length, 1, 'PDF bytes are uploaded separately from the event');
  assert.ok(!JSON.stringify(f.published[0]).includes('%PDF'));
  await viewer.navigate({ mode: 'question', questionId: 7 });
  await admin.shareFile(pdf('second'));
  await viewer.applyQueue;
  assert.match(shown[1].bytes, /second/);
  assert.notEqual(shown[0].id, shown[1].id);
  await admin.navigate({ mode: 'question', questionId: 4 });
  await viewer.applyQueue;
  assert.equal(shown.at(-1).question, 4);
  assert.equal(f.states.get('room').document.id, adminDoc.id);
  const late = new MeetingSession({ request: f.request, subscribe: async () => () => {}, getDocument: () => ({ ready: false }), showTarget: async state => { assert.equal(state.document.id, adminDoc.id); assert.equal(state.questionId, 4); } });
  await late.join('room');
  assert.equal(late.lastRevision, f.states.get('room').revision);
});

test('upload failure or parse failure leaves the active meeting document unchanged', async () => {
  const f = await fixture();
  let current = null;
  const admin = new MeetingSession({ request: f.request, uploadFile: f.uploadFile, getTarget: () => ({ mode: 'question', questionId: 1 }), getDocument: () => ({ ready: true }), showDocument: async descriptor => { current = descriptor; } });
  await admin.join('room', adminKey);
  await admin.shareFile(pdf('working'));
  const saved = f.states.get('room'), displayed = current;
  admin.uploadFile = async () => { throw new Error('upload failed'); };
  await assert.rejects(admin.shareFile(pdf('broken')), /upload failed/);
  assert.equal(current, displayed);
  assert.equal(f.states.get('room'), saved);
  admin.uploadFile = f.uploadFile;
  admin.showDocument = async () => { throw new Error('parse failed'); };
  await assert.rejects(admin.shareFile(pdf('broken')), /parse failed/);
  assert.equal(f.states.get('room'), saved);
  assert.equal(f.published.length, 1);
  assert.equal(admin.documentBusy, false);
});

test('PDF upload validates credentials, size, content, and room; a stored object alone does not change meeting state', async () => {
  const f = await fixture();
  const upload = (body, extra = {}, room = 'room') => f.fileHandler(new Request(`https://dashboard.test/.netlify/functions/meeting-document?room=${room}`, {
    method: 'POST', headers: { Authorization: `Bearer ${adminKey}`, ...extra }, body
  }));
  assert.equal((await upload('%PDF-valid', { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await upload('%PDF-valid', { Origin: 'https://other.test' })).status, 403);
  assert.equal((await upload('not PDF')).status, 400);
  assert.equal((await upload('')).status, 400);
  assert.equal((await upload('%PDF-valid', { 'Content-Length': String(f.MAX_PDF_BYTES + 1) })).status, 413);
  assert.equal((await upload(Buffer.alloc(f.MAX_PDF_BYTES + 1))).status, 413);
  const { document } = await f.uploadFile('room', pdf('한글 자료'), adminKey);
  assert.equal(document.name, '한글 자료.pdf');
  assert.equal(f.states.size, 0);
  const stored = await f.fileHandler(new Request('https://dashboard.test' + document.url));
  assert.equal(stored.headers.get('content-type'), 'application/pdf');
  assert.equal(stored.headers.get('cache-control'), 'no-store');
  assert.equal((await f.fileHandler(new Request(`https://dashboard.test/.netlify/functions/meeting-document?room=other&file=${document.fileId}`))).status, 404);
  assert.equal((await f.fileHandler(new Request('https://dashboard.test/.netlify/functions/meeting-document?room=room&file=../../.env'))).status, 404);
  await assert.rejects(f.request('other', { action: 'set-document', fileId: document.fileId, documentId: document.id, mode: 'question', questionId: 1 }, adminKey), /일치/);
  await f.request('room', { action: 'set-document', fileId: document.fileId, documentId: document.id, mode: 'question', questionId: 1 }, adminKey);
  await assert.rejects(f.request('room', { documentId: 'b'.repeat(64), mode: 'question', questionId: 1 }, adminKey), /업로드/);
});

test('oversize files and concurrent file changes are rejected before replacing the document', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const admin = new MeetingSession({ request: async () => ({ state: { revision: 'ok' } }), getDocument() {},
    getTarget: () => ({ mode: 'question', questionId: 1 }), uploadFile: async () => { await pending; return { document: { id: 'a'.repeat(64), fileId: 'test' } }; }, showDocument: async () => {} });
  await admin.join('room', adminKey);
  await assert.rejects(admin.shareFile({ name: 'big.pdf', size: 4500001 }), /4.5MB/);
  const first = admin.shareFile(pdf('one'));
  await assert.rejects(admin.shareFile(pdf('two')), /처리하는 중/);
  release();
  await first;
});
