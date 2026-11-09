// Optional private-document check: node tests/grouped-audit-integration.cjs pdf.cjs pdf.worker.cjs source.pdf
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const pdfjs = require(path.resolve(process.argv[2]));
pdfjs.GlobalWorkerOptions.workerSrc = path.resolve(process.argv[3]);
(async () => {
  const ctx = { window: {}, console: { log() {}, warn() {} }, document: { getElementById: () => null }, setTimeout,
    fetch: () => { throw new Error('Explicit TOC must not call AI'); } };
  vm.createContext(ctx);
  const source = fs.readFileSync('app.js', 'utf8');
  vm.runInContext(source.slice(0, source.indexOf('// 4. SIDEBAR RENDERING')), ctx);
  vm.runInContext("geminiApiKey = 'must-not-call-ai'", ctx);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(process.argv[4])) }).promise;
  await ctx.parseUploadedPdf(doc, 'grouped-audit.pdf');
  const rows = vm.runInContext('currentItems', ctx);
  const finalEdition = doc.numPages === 144;
  assert.equal(rows.length, finalEdition ? 59 : 49);
  const starts = finalEdition
    ? [3,6,8,11,14,16,19,21,28,31,33,35,36,38,40,41,43,46,51,53,62,63,65,67,68,71,73,75,77,78,80,82,85,86,87,91,92,94,96,98,99,102,103,104,107,115,116,119,120,121,122,125,127,129,131,136,138,141,143]
    : [3,5,7,10,13,15,18,20,27,30,32,34,35,37,39,40,42,45,50,52,61,62,63,65,66,68,69,71,73,76,77,78,82,84,86,87,90,91,92,95,103,104,107,108,110,112,117,119,122];
  const groups = [['학생배치',8],['적정규모학교육성',12],['통학버스',finalEdition ? 16 : 12],['조직관리팀',finalEdition ? 8 : 7],['법무팀',finalEdition ? 15 : 10]];
  assert.deepEqual(Array.from(rows, r => r.category), groups.flatMap(([name,count]) => Array(count).fill(name)));
  assert.deepEqual(Array.from(rows, r => r.categoryNumber), groups.flatMap(([,count]) => Array.from({length:count},(_,i)=>i+1)));
  assert.deepEqual(Array.from(vm.runInContext('tocPages', ctx)), [1,2]);
  for (let i=0;i<rows.length;i++) {
    assert.equal(rows[i].id, i+1);
    assert.equal(rows[i].startPdfPage, starts[i]);
    assert.equal(rows[i].endPdfPage, i+1 < rows.length ? starts[i+1]-1 : doc.numPages);
    const page = await doc.getPage(starts[i]);
    const text = (await page.getTextContent()).items.map(it=>it.str).join(' ');
    assert.equal(Number(text.match(/【\s*(\d+)\s*】/)[1]), rows[i].categoryNumber);
  }
  assert.match(rows[3].title, /제천산업고/);
  assert.match(rows[4].title, /동성고/);
  assert(rows.every(r=>!r.title.includes('요구자료')), 'status labels must not enter titles');
  assert(rows.every(r=>!r.title.includes('박진희') && !r.title.includes('김꽃임')), 'officer names must stay in the status column');
  vm.runInContext("currentListOrder = 'number'",ctx);
  assert.deepEqual(Array.from(rows,ctx.sidebarButtonLabel), Array.from({length:rows.length},(_,i)=>i+1));
  vm.runInContext("currentListOrder = 'category'",ctx);
  assert.deepEqual(Array.from(rows,ctx.sidebarButtonLabel), Array.from(rows,r=>r.categoryNumber));
  console.log(`PASS: ${rows.length} questions, 5 left-column categories, all bracket numbers, body ranges and both numbering modes; no AI call`);
})().catch(error=> { console.error(error); process.exitCode=1; });
