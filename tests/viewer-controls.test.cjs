const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function viewer() {
  const elements = new Map();
  for (const id of ['sidebar', 'sidebar-backdrop', 'btn-toggle-sidebar', 'pdf-viewport', 'zoom-level']) {
    const classes = new Set();
    elements.set(id, {
      attributes: {}, label: {},
      classList: {
        contains: name => classes.has(name),
        add: name => classes.add(name),
        remove: name => classes.delete(name),
        toggle(name, force = !classes.has(name)) { if (force) classes.add(name); else classes.delete(name); }
      },
      setAttribute(name, value) { this.attributes[name] = value; },
      querySelector() { return this.label; }
    });
  }
  const events = [];
  const context = {
    window: { innerWidth: 1366, addEventListener() {}, dispatchEvent: event => events.push(event) },
    document: { addEventListener() {}, getElementById: id => elements.get(id) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    console
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), context);
  vm.runInContext(`
    renderQuestionList = () => {};
    renderQuestionAnswerPage = async () => {};
    renderTocPage = async () => {};
    calcFitScale = async () => 1.8;
    currentPdfDoc = {};
    currentItems = [
      { id: 1, title: 'First', startPdfPage: 1, endPdfPage: 1 },
      { id: 2, title: 'Second', startPdfPage: 2, endPdfPage: 2 }
    ];
    tocPages = [3];
  `, context);
  return { context, elements, events };
}

test('desktop sidebar can hide and reopen; mobile drawer and accessibility follow the viewport', () => {
  const { context, elements } = viewer();
  const sidebar = elements.get('sidebar');
  const button = elements.get('btn-toggle-sidebar');
  context.updateSidebarToggle();
  assert.equal(button.attributes['aria-expanded'], 'true');
  context.toggleSidebar();
  assert.equal(sidebar.classList.contains('collapsed'), true);
  assert.equal(sidebar.inert, true);
  assert.equal(button.label.textContent, '목록 보이기');
  context.toggleSidebar();
  assert.equal(sidebar.inert, false);
  assert.equal(button.attributes['aria-expanded'], 'true');
  context.window.innerWidth = 390;
  context.updateSidebarToggle();
  assert.equal(sidebar.inert, true);
  context.toggleSidebar();
  assert.equal(sidebar.classList.contains('mobile-open'), true);
  assert.equal(elements.get('sidebar-backdrop').classList.contains('active'), true);
  context.closeMobileSidebar();
  assert.equal(sidebar.inert, true);
  context.window.innerWidth = 1366;
  context.updateSidebarToggle();
  assert.equal(sidebar.inert, false);
  assert.equal(button.attributes['aria-expanded'], 'true');
});

test('PDF starts at 140%, preserves manual zoom across navigation, and still supports fit mode', async () => {
  const { context, elements, events } = viewer();
  const scale = () => vm.runInContext('currentScale', context);
  await context.openQuestion(1);
  assert.equal(scale(), 1.4);
  assert.equal(elements.get('zoom-level').innerText, '140%');
  context.applyZoom(1.55);
  await context.openQuestion(2);
  assert.equal(scale(), 1.55);
  await context.openTocView(true, false);
  assert.equal(scale(), 1.55);
  vm.runInContext("zoomMode = 'fit'", context);
  await context.openQuestion(1, true, false);
  assert.equal(scale(), 1.8);
  await context.openTocView(true, false);
  const before = events.length;
  context.applyZoom(1.4);
  assert.equal(events.length, before, 'local TOC zoom does not broadcast navigation');
  await context.openQuestion(2, true, false);
  assert.equal(scale(), 1.4);
});
