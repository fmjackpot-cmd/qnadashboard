const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { MeetingSession, uploadPdfParts } = require('../live-session.js');
const adminKey = 'test06';
const pdf = name => new File([`%PDF-1.7\n${name}\n%%EOF`], `${name}.pdf`, { type: 'application/pdf' });

test('25MB PDF transfers in bounded requests, preserves its mode, and verifies the reconstructed bytes', async () => {
  const f = await fixture();
  const bytes = Buffer.alloc(25_000_000, 42);
  bytes.write('%PDF-1.7\n');
  const file = new File([bytes], '수감자료.pdf', { type: 'application/pdf' });
  const sizes = [], progress = [];
  const { document } = await uploadPdfParts({ room: 'receipt', file, key: adminKey, documentType: 'receipt',
    endpoint: 'https://dashboard.test/.netlify/functions/meeting-document', crypto: require('node:crypto').webcrypto,
    onProgress: value => progress.push(value), fetcher: async (url, options) => {
      const request = new Request(url, options);
      const size = (await request.clone().arrayBuffer()).byteLength;
      sizes.push(size);
      return f.fileHandler(request);
    } });
  assert.equal(document.parts, 9);
  assert.equal(document.documentType, 'receipt');
  assert.equal(document.size, file.size);
  assert(sizes.every(size => size <= 3_000_000));
  assert.equal(f.published.length, 0);
  const chunks = [];
  for (let part = 0; part < document.parts; part++) {
    const url = new URL(document.url, 'https://dashboard.test');
    url.searchParams.set('part', part);
    const response = await f.fileHandler(new Request(url));
    assert.equal(response.status, 200);
    chunks.push(Buffer.from(await response.arrayBuffer()));
    url.searchParams.set('room', 'other');
    assert.equal((await f.fileHandler(new Request(url))).status, 404);
  }
  assert.deepEqual(Buffer.concat(chunks), bytes);
  assert.equal(createHash('sha256').update(Buffer.concat(chunks)).digest('hex'), document.id);
  await f.request('receipt', { action: 'set-document', fileId: document.fileId, documentId: document.id, mode: 'question', questionId: 70 }, adminKey);
  assert.equal(f.published[0].document.documentType, 'receipt');
  assert.equal(f.published[0].document.parts, 9);
  assert(progress.length >= 9);
});

test('incomplete, corrupt, expired, and unauthorized chunk uploads cannot become active documents', async () => {
  const f = await fixture();
  const base = 'https://dashboard.test/.netlify/functions/meeting-document?room=room';
  const post = (url, body, key = adminKey) => f.fileHandler(new Request(url, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body }));
  const payload = JSON.stringify({ size: 6, id: 'a'.repeat(64), name: 'test.pdf', documentType: 'receipt' });
  assert.equal((await post(base + '&action=init', payload, 'bad')).status, 401);
  const init = await (await post(base + '&action=init', payload)).json();
  const url = `${base}&upload=${init.uploadId}`;
  assert.equal((await post(url + '&action=complete', '')).status, 409);
  assert.equal((await post(url + '&action=part&part=1', '%PDF-a')).status, 400);
  assert.equal((await post(url + '&action=part&part=0', 'broken')).status, 400);
  assert.equal((await post(url + '&action=part&part=0', '%PDF-a')).status, 200);
  assert.equal((await post(url + '&action=complete', '')).status, 409);
  assert.equal(f.files.has(init.uploadId), false);
  const metadata = f.files.get(`${init.uploadId}/pending`).metadata;
  metadata.createdAt -= 3600001;
  assert.equal((await post(url + '&action=complete', '')).status, 404);
  assert.equal(f.published.length, 0);
});

async function fixture() {
  const { createDocumentHandler, MAX_PDF_BYTES } = await import('../netlify/lib/meeting-documents.mjs');
  const { createHandler } = await import('../netlify/functions/meeting.mjs');
  const files = new Map(), states = new Map(), subscribers = new Set(), published = [], order = [];
  let clock = Date.now();
  const subscribe = async (_, handlers) => { subscribers.add(handlers.onState); return () => subscribers.delete(handlers.onState); };
  const documents = {
    set: async (id, data, { metadata }) => { files.set(id, { data, metadata }); },
    getWithMetadata: async id => files.get(id) || null,
    getMetadata: async id => files.has(id) ? { metadata: files.get(id).metadata } : null
  };
  const fileHandler = createDocumentHandler({ documents, adminKey });
  const meeting = createHandler({ adminKey, documents, now: () => clock,
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
  return { files, states, documents, fileHandler, meeting, uploadFile, request, download, subscribers, published, order, MAX_PDF_BYTES,
    subscribe, now: () => clock, advance: ms => { clock += ms; } };
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
  const admin = new MeetingSession({ request: f.request, subscribe: f.subscribe, uploadFile: f.uploadFile, getDocument: () => adminDoc,
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

test('two admins take turns controlling one participant without uploading the shared PDF again', async () => {
  const f = await fixture();
  const makeAdmin = () => {
    let doc = { ready: false };
    return new MeetingSession({ request: f.request, subscribe: f.subscribe, now: f.now, uploadFile: f.uploadFile,
      getDocument: () => doc, getTarget: () => ({ mode: 'question', questionId: 1 }),
      showDocument: async descriptor => { await f.download(descriptor); doc = { ready: true, hosted: true, id: descriptor.id, shared: descriptor }; },
      showTarget: async state => { await f.download(state.document); doc = { ready: true, hosted: true, id: state.documentId, shared: state.document }; }
    });
  };
  const first = makeAdmin(), second = makeAdmin(), shown = [];
  const viewer = new MeetingSession({ request: f.request, getDocument: () => ({ ready: false }),
    subscribe: async (_, handlers) => { f.subscribers.add(handlers.onState); return () => f.subscribers.delete(handlers.onState); },
    showTarget: async state => shown.push(state.questionId) });
  await first.join('room', adminKey);
  await first.shareFile(pdf('shared'));
  await viewer.join('room');
  const publishedBeforeJoin = f.published.length;
  await second.join('room', adminKey);
  await second.loadSharedDocument();
  assert.equal(f.published.length, publishedBeforeJoin, 'joining cannot change the participant screen');
  assert.equal(f.order.filter(x=>x==='upload').length, 1);
  await first.navigate({ mode: 'question', questionId: 3 });
  await viewer.applyQueue;
  f.advance(2000);
  await second.navigate({ mode: 'question', questionId: 7 });
  await viewer.applyQueue;
  f.advance(2000);
  await first.navigate({ mode: 'question', questionId: 2 });
  await viewer.applyQueue;
  assert.deepEqual(shown, [1,3,7,2]);
  assert.equal(f.order.filter(x=>x==='commit').length, 1, 'taking turns keeps the existing document');
  await second.join('empty', adminKey);
  await assert.rejects(second.loadSharedDocument(), /첫 관리자는 PDF/);
  viewer.leave(); first.leave(); second.leave();
});

test('upload failure or parse failure leaves the active meeting document unchanged', async () => {
  const f = await fixture();
  let current = null;
  const admin = new MeetingSession({ request: f.request, subscribe: f.subscribe, uploadFile: f.uploadFile, getTarget: () => ({ mode: 'question', questionId: 1 }), getDocument: () => ({ ready: true }), showDocument: async descriptor => { current = descriptor; } });
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
  const admin = new MeetingSession({ request: async () => ({ state: { revision: 'ok' } }), subscribe: async () => () => {}, getDocument() {},
    getTarget: () => ({ mode: 'question', questionId: 1 }), uploadFile: async () => { await pending; return { document: { id: 'a'.repeat(64), fileId: 'test' } }; }, showDocument: async () => {} });
  await admin.join('room', adminKey);
  await assert.rejects(admin.shareFile({ name: 'big.pdf', size: 50000001 }), /50MB/);
  const first = admin.shareFile(pdf('one'));
  await assert.rejects(admin.shareFile(pdf('two')), /처리하는 중/);
  release();
  await first;
});
