// Optional real-document test. The private source PDF stays outside Git.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const pdfjs = require(path.resolve(process.argv[2]));
pdfjs.GlobalWorkerOptions.workerSrc = path.resolve(process.argv[3]);
(async () => {
  const ctx = { window: {}, console: { log() {}, warn() {} }, document: { getElementById: () => null }, setTimeout };
  vm.createContext(ctx);
  const source = fs.readFileSync('app.js', 'utf8');
  vm.runInContext(source.slice(0, source.indexOf('// 4. SIDEBAR RENDERING')), ctx);
  vm.runInContext("currentDocumentType = 'receipt'; geminiApiKey = 'must-not-call-ai'", ctx);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(process.argv[4])) }).promise;
  if (process.env.RECEIPT_TEXT_CACHE) {
    const extract = ctx.extractAllPagesText;
    ctx.extractAllPagesText = async doc => {
      const pages = await extract(doc);
      fs.writeFileSync(process.env.RECEIPT_TEXT_CACHE, JSON.stringify(pages));
      return pages;
    };
  }
  await ctx.parseUploadedPdf(doc, '수감자료.pdf');
  const rows = vm.runInContext('currentItems', ctx);
  const toc = vm.runInContext('tocPages', ctx);
  assert.equal(rows.length, 145, `Missing: ${Array.from({ length: 145 }, (_, i) => i + 1).filter(id => !rows.some(r => r.id === id)).join(', ')}`);
  assert.deepEqual(Array.from(rows, r => r.id), Array.from({ length: 145 }, (_, i) => i + 1));
  assert.equal(rows[0].startPdfPage, 13);
  assert.equal(rows[69].startPdfPage, 1089);
  assert(toc.includes(3) && toc.includes(1077));
  for (const row of rows) {
    const page = await doc.getPage(row.startPdfPage);
    const text = (await page.getTextContent()).items.map(i => i.str).join('').replace(/\s/g, '');
    // The original TOC and body use different date wording and punctuation.
    // Verify the printed footer and requirement heading independently instead.
    const printed = row.docPage.split('~')[0];
    assert(text.startsWith(`-${printed}-`), `footer mismatch: ${row.id} @ ${row.startPdfPage}`);
    assert(text.slice(0, 250).includes(`${row.id}.`), `heading mismatch: ${row.id} @ ${row.startPdfPage}`);
    assert(row.endPdfPage >= row.startPdfPage);
    assert(row.title && !/소관부서|쪽번호/.test(row.title));
  }
  console.log(`PASS ${doc.numPages} pages, ${rows.length} requirements, ${toc.length} TOC pages; every printed page and requirement number verified against its body`);
  console.log(JSON.stringify(rows.filter(r => [3, 47, 69, 70, 76, 95, 145].includes(r.id)), null, 2));
  const { createLocalServer } = await import('../scripts/local-server.mjs');
  const { uploadPdfParts } = require('../live-session.js');
  const { webcrypto, createHash } = require('node:crypto');
  const { server } = createLocalServer({ env: { ABLY_API_KEY: 'test.key:dummy', MEETING_ADMIN_KEY: 'test06' },
    broker: { publish: async () => {}, issueToken: async () => ({}) } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const original = fs.readFileSync(process.argv[4]);
    const { document } = await uploadPdfParts({ room: 'receipt-integration', key: 'test06', documentType: 'receipt',
      file: new File([original], '수감자료.pdf', { type: 'application/pdf' }),
      endpoint: base + '/.netlify/functions/meeting-document', fetcher: fetch, crypto: webcrypto });
    const chunks = [];
    for (let part = 0; part < document.parts; part++) {
      const response = await fetch(base + document.url + `&part=${part}`);
      assert.equal(response.status, 200);
      chunks.push(Buffer.from(await response.arrayBuffer()));
    }
    const restored = Buffer.concat(chunks);
    assert.deepEqual(restored, original);
    assert.equal(document.id, createHash('sha256').update(original).digest('hex'));
    const endpoint = base + '/.netlify/functions/meeting?room=receipt-integration';
    const commit = await fetch(endpoint, { method: 'POST', headers: { Authorization: 'Bearer test06' },
      body: JSON.stringify({ action: 'set-document', documentId: document.id, fileId: document.fileId, mode: 'question', questionId: 70 }) });
    assert.equal(commit.status, 200);
    const viewer = await (await fetch(endpoint)).json();
    assert.equal(viewer.state.document.documentType, 'receipt');
    assert.equal(viewer.state.questionId, 70);
    console.log(`PASS real PDF HTTP upload/download: ${original.length} bytes, ${document.parts} parts, exact bytes restored; viewer receives receipt mode and requirement 70`);
  } finally { await new Promise(resolve => server.close(resolve)); }
  if (process.env.RECEIPT_CACHE) fs.writeFileSync(process.env.RECEIPT_CACHE, JSON.stringify({ rows, toc }));
})().catch(error => { console.error(error); process.exitCode = 1; });
