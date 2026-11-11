const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture() {
  const ctx = { window: {}, console: { log() {}, warn() {} } };
  vm.createContext(ctx);
  const source = fs.readFileSync('app.js', 'utf8');
  vm.runInContext(source.slice(0, source.indexOf('// 3. AI-BASED PARSER')), ctx);
  const cell = (text,x,y) => ({text,x,y});
  const layout = [cell('구분',.08,750),cell('순',.15,750),cell('제 목',.4,750),cell('구분',.7,750),cell('쪽수',.8,750),cell('책자',.88,750),
    cell('학생',.08,690),cell('배치',.08,680),cell('법무',.08,600),cell('팀',.08,590)];
  [[1,720,'첫 질문은?', '3'],[2,660,'집행률이 50% 이하인 사업 사유는?', '5'],[1,600,'1 년간 운영 현황', '']].forEach(([n,y,title,p])=> {
    layout.push(cell(String(n),.155,y),cell('○ '+title,.2,y),cell('요구자료',.7,y),cell(p,.81,y),cell('28',.89,y));
  });
  const pages = [{pageNum:1,text:'구분 순 제 목 구분 쪽수 책자',layout},
    {pageNum:2,text:'【1】 첫 질문은? < 행정과 학생배치팀 > 【답변】 다른 질문은? 추가 질문은? 확인은?'},
    {pageNum:3,text:'첨부표'},
    {pageNum:4,text:'【2】 4. 집행률이 50% 이하인 사업 사유는? < 행정과 학생배치팀 > 【답변】 답변'},
    {pageNum:5,text:'[1] 76. 1 년간 운영 현황 < 행정과 법무팀 > 【답변】 답변'}];
  return {ctx,pages};
}

test('uses left merged categories, keeps local numbers and trusts body brackets over stale/missing pages',()=>{
  const {ctx,pages}=fixture();
  const structure=ctx.analyzeDocumentStructure(pages);
  assert.deepEqual(Array.from(structure.tocPages),[1]);
  const rows=ctx.parseQuestionsHeuristic(pages,structure);
  assert.deepEqual(Array.from(rows,r=>r.id),[1,2,3]);
  assert.deepEqual(Array.from(rows,r=>r.categoryNumber),[1,2,1]);
  assert.deepEqual(Array.from(rows,r=>r.category),['학생배치','학생배치','법무팀']);
  assert.deepEqual(Array.from(rows,r=>r.startPdfPage),[2,4,5]);
  assert.equal(rows[2].title,'1 년간 운영 현황');
  assert.equal(rows[2].docPage,''); // Book column 28 is not a question start page.
  vm.runInContext("currentListOrder = 'number'",ctx);
  assert.deepEqual(Array.from(rows,ctx.sidebarButtonLabel),[1,2,3]);
  vm.runInContext("currentListOrder = 'category'",ctx);
  assert.deepEqual(Array.from(rows,ctx.sidebarButtonLabel),[1,2,1]);
  vm.runInContext('currentItems = []',ctx);
  ctx.inputRows=rows;
  vm.runInContext('currentItems = inputRows',ctx);
  assert.deepEqual(Array.from(ctx.getSidebarItems(),r=>r.id),[1,2,3]);
});

test('rejects incomplete bracket sequences instead of silently returning a partial TOC',()=>{
  const {ctx,pages}=fixture();
  pages[3].text='【3】 잘못된 번호 < 행정과 학생배치팀 > 【답변】 답변';
  assert.throws(()=>ctx.parseGroupedAuditToc(pages,{tocPages:[1]}),/대괄호 문항 번호가 일치하지/);
});

test('recognizes numbered answers without department or officer lines',()=>{
  const {ctx,pages}=fixture();
  pages[1].text='- 2 - ▣ 구분: 기타 【1】 첫 질문은? 【 답 변 】 답변 내용';
  pages[3].text='- 4 - ▣ 구분: 기타 【2】 4. 집행률이 50% 이하인 사업 사유는 【답변】 답변 내용';
  const rows=ctx.parseGroupedAuditToc(pages,{tocPages:[1]});
  assert.deepEqual(Array.from(rows,r=>r.startPdfPage),[2,4,5]);
  assert.deepEqual(Array.from(rows,r=>r.categoryNumber),[1,2,1]);
});

test('requires an answer marker even when a page contains a bracketed number',()=>{
  const {ctx,pages}=fixture();
  pages[3].text='【2】 참고자료에 등장하는 번호이며 문항 시작이 아님';
  assert.throws(()=>ctx.parseGroupedAuditToc(pages,{tocPages:[1]}),/대괄호 문항 번호가 일치하지/);
});

test('carries a category across TOC pages and separates centered long status labels',()=>{
  const {ctx,pages}=fixture();
  const original=pages[0];
  const first={...original,layout:original.layout.filter(c=>c.y>=720 || c.x<.125 && c.y>=680)};
  first.layout=first.layout.map(c=>c.text==='학생'?{...c,y:714}:c.text==='배치'?{...c,y:706}:c);
  const second={...original,pageNum:2,layout:original.layout.filter(c=>c.y!==720 && !(c.x<.125 && c.y>=680))};
  second.layout.find(c=>c.text==='요구자료' && c.y===660).x=.665;
  const input=[first,second,...pages.slice(1).map(p=>({...p,pageNum:p.pageNum+1}))];
  const rows=ctx.parseGroupedAuditToc(input,{tocPages:[1,2]});
  assert.deepEqual(Array.from(rows,r=>r.category),['학생배치','학생배치','법무팀']);
  assert.deepEqual(Array.from(rows,r=>r.startPdfPage),[3,5,6]);
  assert.equal(rows[1].title,'집행률이 50% 이하인 사업 사유는?');
  assert.equal(rows[1].officer,'요구자료');
});

test('grid and title lists keep distinct click targets when local category numbers repeat',()=>{
  function element() {
    return {children:[],dataset:{},classList:{add(){},remove(){},toggle(){}},
      set innerHTML(value){this.children=[];this.html=value;},
      appendChild(child){this.children.push(child);},setAttribute(){},addEventListener(name,fn){this[name]=fn;}};
  }
  const elements=Object.fromEntries(['q-list','sidebar'].map(id=>[id,element()]));
  const ctx={window:{addEventListener(){}},console,document:{addEventListener(){},getElementById:id=>elements[id]||null,createElement:element}};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('app.js','utf8'),ctx);
  vm.runInContext(`currentPdfDoc = {}; currentListOrder = 'category';
    currentItems = [{id:1,categoryNumber:1,category:'학생배치',title:'첫 질문'}, {id:2,categoryNumber:1,category:'법무팀',title:'다음 질문'}];
    window.opened=[]; openQuestion=id=>window.opened.push(id); closeMobileSidebar=()=>{};
    renderQuestionList();`,ctx);
  const groups=elements['q-list'].children;
  assert.deepEqual(groups.map(g=>g.children[0].children[0].textContent),['학생배치','법무팀']);
  const buttons=groups.map(g=>g.children[1].children[0]);
  assert.deepEqual(buttons.map(b=>b.innerText),[1,1]);
  buttons[1].click();
  vm.runInContext("currentListOrder='number'; renderQuestionList();",ctx);
  const numberButtons=elements['q-list'].children[0].children[0].children;
  assert.deepEqual(numberButtons.map(b=>b.innerText),[1,2]);
  numberButtons[1].click();
  vm.runInContext("currentListOrder='category'; currentListViewMode='list'; renderQuestionList();",ctx);
  const card=elements['q-list'].children[1].children[1];
  assert.match(card.html,/q-title-badge">1</);
  card.click();
  assert.deepEqual(Array.from(ctx.window.opened),[2,2,2]);
});
