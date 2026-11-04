const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture() {
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  const source = fs.readFileSync('app.js', 'utf8');
  vm.runInContext(source.slice(0, source.indexOf('// 3. AI-BASED PARSER')), ctx);
  const header = '소관부서 요구자료 쪽번호';
  const row = (id, title, printed, departments = ['행', '정', '과']) => [
    ...departments.map((text, i) => ({ text, x: .12, y: 700 - i * 12 })),
    { text: `${id}. ${title}`, x: .25, y: 700 },
    { text: `${id}-1. 세부자료`, x: .27, y: 650 },
    { text: String(printed), x: .84, y: 700 }
  ];
  const pages = [
    { pageNum: 1, text: header + ' 공통 요구자료(2건)', printedPage: null, layout: row(1, '첫 자료', 1) },
    { pageNum: 2, text: '2. 다음 자료', printedPage: null, layout: row(2, '다음 자료', 2) },
    { pageNum: 3, text: '- 1 - 1. 첫 자료', printedPage: 1 },
    { pageNum: 4, text: '- 2 - 2. 다음 자료', printedPage: 2 },
    { pageNum: 5, text: header + ' 소관 요구자료(1건)', printedPage: null, layout: row(3, '개별 자료', 3, ['중등교육과', '행정과']) },
    { pageNum: 6, text: '- 3 - 3. 개별 자료', printedPage: 3 }
  ];
  return { ctx, pages };
}

test('receipt parser reads continuation and middle TOCs, preserves shared departments, and excludes TOCs from body spans', () => {
  const { ctx, pages } = fixture();
  const result = ctx.parseReceiptToc(pages);
  assert.deepEqual(Array.from(result.tocPages), [1, 2, 5]);
  assert.deepEqual(Array.from(result.items, r => r.startPdfPage), [3, 4, 6]);
  assert.deepEqual(Array.from(result.items, r => r.endPdfPage), [3, 4, 6]);
  assert.equal(result.items[0].category, '행정과');
  assert.equal(result.items[2].category, '중등교육과 · 행정과');
  assert.equal(result.items[0].title, '첫 자료');
});

test('receipt parser refuses partial TOCs and missing printed-page matches instead of inventing navigation', () => {
  const { ctx, pages } = fixture();
  assert.throws(() => ctx.parseReceiptToc(pages.filter(p => p.pageNum !== 4)), /본문 2쪽/);
  pages[1].layout = [];
  assert.throws(() => ctx.parseReceiptToc(pages), /3건 중 2건/);
});
