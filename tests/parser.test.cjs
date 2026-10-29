const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
function parser() {
  const ctx = { window: {}, console: { log() {}, warn() {} } };
  vm.createContext(ctx);
  vm.runInContext(source.slice(0, source.indexOf('// 3. AI-BASED PARSER')), ctx);
  return ctx;
}

// Text order and spacing from the 20261026 PDF's three-column TOC.
const titles = [
  '( 가칭 ) 내곡 4 초 설립 사유 및 계획은 ?',
  '( 가칭 ) 내곡 4 초 재원 확보 계획은 ?',
  '( 가칭 ) 내곡 4 초 기부채납 용지 취득금액 산출은 ?',
  '( 가칭 ) 내곡 4 초 신설전 임시배치계획은 ?',
  '현재 석성초 통학구역 학생들 통학구역은 ?',
  '투자심사 승인 여부는 ?',
  '( 중기 ) ( 가칭 ) 송절초 설립 사유 및 계획은 ?',
  '( 중기 ) ( 가칭 ) 송산초 설립 사유 및 계획은 ?',
  '( 중기 ) ( 가칭 ) 복대유 설립 사유 및 계획은 ?',
  '( 중기 ) ( 가칭 ) 중부권 공립 특수학교 신설 제출 사유는 ?'
];
const officers = [...Array(8).fill('김남희'), '강은해', '구영모'];
const toc = '예상질의 ․ 답변 목록 번호 예 상 질 의 · 답 변 담당자 ' +
  titles.map((title, i) => `${i + 1} ${title} ${officers[i]}`).join(' ');

test('extracts titles and officers without inventing page numbers', () => {
  const ctx = parser();
  const pages = [{ pageNum: 1, text: '표지' }, { pageNum: 2, text: toc }];
  const rows = ctx.parseQuestionsHeuristic(pages, ctx.analyzeDocumentStructure(pages));
  assert.equal(rows.length, 10);
  rows.forEach((row, i) => {
    assert.equal(row.id, i + 1);
    assert.equal(row.title, titles[i]);
    assert.equal(row.officer, officers[i]);
    assert.equal(row.docPage, '');
    assert.equal(row.startPdfPage, null);
  });
});

test('maps first question including continuation and matches 중기 body headings', () => {
  const ctx = parser();
  const starts = [3, 5, 6, 7, 8, 9, 10, 11, 12, 13];
  const pages = Array.from({ length: 14 }, (_, i) => ({ pageNum: i + 1, text: '※ 향후 추진 일정 및 학생배치계획 자료' }));
  pages[0].text = '공유재산심의회 예상질의';
  pages[1].text = toc;
  starts.forEach((p, i) => {
    const title = i === 1 ? '재원 확보 계획은?' : titles[i].replace('( 중기 ) ', '');
    pages[p - 1].text = `질의요지 ${title} 답변내용 ○ 학교 설립 사업을 추진함`;
  });
  vm.runInContext('pdfToPrintedMap = Object.fromEntries(Array.from({length:12}, (_,i)=>[i+3,i+2]))', ctx);
  const rows = ctx.locateQuestionsByContent(ctx.parseOfficerToc(pages, { tocPages: [2] }), { numPages: 14 }, pages, [2]);
  rows.forEach((row, i) => assert.equal(row.startPdfPage, starts[i]));
  assert.equal(rows[0].endPdfPage, 4);
  assert.equal(rows[0].docPage, '2~3');
  assert.equal(rows[9].endPdfPage, 14);
});

test('leaves other layouts and incomplete officer tables to existing parsers', () => {
  const ctx = parser();
  for (const text of ['순 질의 목록 페이지 비고 1 설립 계획은? 2', toc + ' 알 수 없는 행']) {
    assert.equal(ctx.parseOfficerToc([{ pageNum: 1, text }], { tocPages: [1] }).length, 0);
  }
});

test('parses all 47 audit rows with multiple or missing question marks and original numbering', () => {
  const ctx = parser();
  const tocPages = require('./fixtures/audit-2026-toc.json');
  const starts = [4,7,10,12,14,17,19,20,22,25,27,29,30,32,34,39,41,50,51,52,54,55,57,58,60,62,65,66,67,71,74,76,83,85,87,88,91,92,93,102,103,106,107,109,111,116,118];
  vm.runInContext('printedToPdfMap = Object.fromEntries(Array.from({length:120}, (_,i)=>[i+1,i+1])); pdfToPrintedMap = {...printedToPdfMap}', ctx);
  const rows = ctx.parseQuestionsHeuristic(tocPages, ctx.analyzeDocumentStructure(tocPages));
  assert.equal(rows.length, 47);
  const pages = Array.from({ length: 120 }, (_, i) => tocPages[i] || { pageNum: i + 1, text: '본문 자료' });
  const located = ctx.locateQuestionsByContent(rows, {numPages:120}, pages, [1,2,3]);
  located.forEach((row, i) => {
    assert.equal(row.id, i + 1);
    assert.equal(row.startPdfPage, starts[i]);
    assert.equal(row.endPdfPage, i < 46 ? starts[i + 1] - 1 : 120);
  });
  assert.match(located[5].title, /^2028/);
  assert.match(located[8].title, /^9 월/);
  assert.match(located[17].title, /^2025\. 12/);
  assert.equal((located[24].title.match(/\?/g) || []).length, 2);
  assert.match(located[31].title, /관련$/);
  assert.match(located[32].title, /^1 년간/);
  assert.match(located[34].title, /^위촉위원의/);
  assert.equal(located[0].officer, '박진희 의원');
  assert.equal(located[0].category, '서면질의');
  assert.equal(located[32].team, '조직관리팀');
});

test('recovers a leading printed footer when PDF coordinates are misplaced', async () => {
  const ctx = parser();
  const page = {
    getViewport: () => ({height:840}),
    getTextContent: async () => ({items: ['-', '25', '-', '본문'].map(str => ({str, transform:[1,0,0,1,200,238]}))})
  };
  const pages = await ctx.extractAllPagesText({numPages:1, getPage:async () => page});
  assert.equal(pages[0].printedPage, 25);
});
