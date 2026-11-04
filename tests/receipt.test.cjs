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

test('department selection includes exact and shared departments plus every headquarters-common item, ordered by printed page', () => {
  const { ctx } = fixture();
  assert.equal(ctx.receiptDepartmentInfo('재정복지과 (본청 각과)').commonToAllDepartments, true);
  assert.equal(ctx.receiptDepartmentInfo('행정과').commonToAllDepartments, false);
  const shared = ctx.receiptDepartmentInfo('중등교육과 행 정 과');
  assert.deepEqual(Array.from(shared.departments), ['중등교육과', '행정과']);
  vm.runInContext(`
    currentDocumentType = 'receipt'; currentListOrder = 'category'; currentDepartment = '행정과';
    currentItems = [
      { id: 1, docPage: '90~99', startPdfPage: 102, departments: ['행정과'] },
      { id: 2, docPage: '10~20', startPdfPage: 22, departments: ['예산과'], commonToAllDepartments: true },
      { id: 3, docPage: '50', startPdfPage: 62, departments: ['중등교육과', '행정과'] },
      { id: 4, docPage: '1', startPdfPage: 13, departments: ['예산과'] }
    ];
  `, ctx);
  assert.deepEqual(Array.from(ctx.getSidebarItems(), r => r.id), [2, 3, 1]);
  assert.deepEqual(Array.from(ctx.getSidebarItems(), ctx.sidebarButtonLabel), [10, 50, 90]);
  vm.runInContext("currentDepartment = '';", ctx);
  assert.equal(ctx.getSidebarItems().length, 4);
  vm.runInContext("currentDocumentType = 'questions'; currentDepartment = '행정과'; currentListOrder = 'number';", ctx);
  assert.deepEqual(Array.from(ctx.getSidebarItems(), r => r.id), [1, 2, 3, 4]);
  assert.equal(ctx.sidebarButtonLabel({ id: 3, docPage: '21~26' }), 3);
});

test('sidebar renders page buttons and department controls; filtered navigation still opens original requirement IDs', () => {
  function element() {
    return { children: [], dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
      set innerHTML(value) { this.children = []; this.html = value; },
      appendChild(child) { this.children.push(child); },
      setAttribute(name, value) { this[name] = value; },
      addEventListener(name, fn) { this[name] = fn; } };
  }
  const elements = Object.fromEntries(['q-list', 'sidebar', 'receipt-department-filter', 'receipt-department',
    'receipt-filter-count', 'grid-button-label', 'tab-btn-grid', 'btn-order-category', 'btn-order-number'].map(id => [id, element()]));
  const ctx = { window: { addEventListener() {} }, console, document: { addEventListener() {}, getElementById: id => elements[id] || null, createElement: element } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), ctx);
  vm.runInContext(`
    currentDocumentType = 'receipt'; currentPdfDoc = {}; currentListOrder = 'category';
    currentItems = [
      { id: 7, title: '직접 소관', docPage: '21~26', startPdfPage: 33, departments: ['행정과'] },
      { id: 8, title: '다른 부서', docPage: '30', startPdfPage: 42, departments: ['예산과'] },
      { id: 9, title: '공통 소관', docPage: '1~9', startPdfPage: 13, departments: [], commonToAllDepartments: true }
    ];
    window.opened = []; openQuestion = id => window.opened.push(id); closeMobileSidebar = () => {};
    renderQuestionList();
  `, ctx);
  assert.equal(elements['receipt-department-filter'].hidden, false);
  assert.equal(elements['btn-order-category'].hidden, true);
  assert.equal(elements['btn-order-number'].textContent, '페이지순');
  assert.equal(elements['grid-button-label'].textContent, '쪽번호 버튼');
  assert.deepEqual(elements['receipt-department'].children.map(o => o.value), ['', '예산과', '행정과']);
  elements['receipt-department'].value = '행정과';
  elements['receipt-department'].onchange();
  const buttons = elements['q-list'].children[0].children[0].children;
  assert.deepEqual(buttons.map(button => button.innerText), [1, 21]);
  assert.equal(elements['receipt-filter-count'].textContent, '2건 · 본청 공통 포함');
  buttons[1].click();
  assert.deepEqual(Array.from(ctx.window.opened), [7]);
  vm.runInContext('selectedQuestionId = 9; goToNextQuestion(); selectedQuestionId = 7; goToPrevQuestion();', ctx);
  assert.deepEqual(Array.from(ctx.window.opened), [7, 7, 9]);
  vm.runInContext("currentDocumentType = 'questions'; renderQuestionList();", ctx);
  assert.equal(elements['receipt-department-filter'].hidden, true);
  assert.equal(elements['btn-order-category'].hidden, false);
  assert.equal(elements['btn-order-number'].disabled, false);
});
