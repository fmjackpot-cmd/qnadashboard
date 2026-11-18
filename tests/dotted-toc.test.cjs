const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const pages = require('./fixtures/supplementary-2026-pages.json');

function parser() {
  const ctx = { window: {}, console: { log() {}, warn() {} },
    document: { getElementById: () => null },
    fetch: () => { throw new Error('Dotted TOCs must not call AI'); } };
  vm.createContext(ctx);
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  vm.runInContext(source.slice(0, source.indexOf('// 4. SIDEBAR RENDERING')), ctx);
  return ctx;
}

test('splits the supplementary budget PDF by leader-dot TOC pages, with or without an AI key', async () => {
  for (const key of ['', 'verification-key']) {
    const ctx = parser();
    vm.runInContext(`geminiApiKey = ${JSON.stringify(key)}`, ctx);
    // Replay PDF.js text order and misplaced footer coordinates from the real PDF.
    const doc = { numPages: pages.length, getPage: async p => ({
      getViewport: () => ({ width: 595, height: 842 }),
      getTextContent: async () => ({ items: [{ str: pages[p - 1].text, transform: [1, 0, 0, 1, 100, 238] }] })
    }) };
    await ctx.parseUploadedPdf(doc, 'supplementary.pdf');
    const rows = vm.runInContext('currentItems', ctx);
    assert.deepEqual(Array.from(vm.runInContext('tocPages', ctx)), [3]);
    assert.deepEqual(Array.from(rows, r => r.startPdfPage), [4, 5, 6, 9, 11, 12, 14, 15]);
    assert.deepEqual(Array.from(rows, r => r.endPdfPage), [4, 5, 8, 10, 11, 13, 14, 15]);
    assert.deepEqual(Array.from(rows, r => r.docPage), ['1', '2', '3~5', '6~7', '8', '9~10', '11', '12']);
    assert.deepEqual(Array.from(rows, r => r.category.replace(/\s/g, '')),
      ['특수학급신증설', '특수학급신증설', '제천산업고,동성고', '제천산업고,동성고', '통학버스', '조직관리팀', '조직관리팀', '조직관리팀']);
    rows.forEach((row, i) => {
      assert.equal(row.id, i + 1);
      assert.equal(row.team, i < 5 ? '학생배치팀' : '조직관리팀');
      assert.doesNotMatch(row.title, /[·.…]{3,}|◈|□/);
      assert.equal(row.settle + row.explain + row.attach + row.opinion, '');
    });
    assert.match(rows[2].title, /^제천산업고/);
    assert.equal(rows[2].pageCount, 3); // Includes both reference pages.
    assert.match(rows[5].title, /^교육문화복합시설/);
  }
});

test('carries headings over TOC pages and accepts titles without question marks', () => {
  const ctx = parser();
  const input = [
    { pageNum: 1, text: '목차 ◈ 학생배치팀 □ 통학버스 1. 첫 사업 현황 ··· 1' },
    { pageNum: 2, text: '목차 2. 2026년 사업 계획 ... 3 ◈ 조직관리팀 3. 다음 사업 계획 …… 5' }
  ];
  const rows = ctx.parseQuestionsHeuristic(input, { tocPages: [1, 2] });
  assert.deepEqual(Array.from(rows, r => r.category), ['통학버스', '통학버스', '조직관리팀']);
  assert.deepEqual(Array.from(rows, r => r.title), ['첫 사업 현황', '2026년 사업 계획', '다음 사업 계획']);
  assert.deepEqual(Array.from(rows, r => r.docPage), ['1', '3', '5']);
});

test('leaves existing table layouts and incomplete leader rows to existing parsers', () => {
  const ctx = parser();
  for (const text of [
    '순 질의 목록 페이지 비고 1 설립 계획은? 2',
    '번호 예상질의·답변 담당자 1 설립 계획은? 김남희',
    '목차 ◈ 학생배치팀 1. 첫 질문은? ··· 1 2. 누락된 쪽수 ···',
    '목차 ◈ 학생배치팀 1. 첫 질문은? ··· 1 3. 누락된 번호 ··· 3'
  ]) {
    assert.equal(ctx.parseDottedToc([{ pageNum: 1, text }], { tocPages: [1] }).length, 0);
  }
});
