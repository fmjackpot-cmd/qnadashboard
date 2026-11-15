const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash, webcrypto } = require('node:crypto');
const { prepareMessageFile, downloadAttachment, popupGeometry, popupVerticalGeometry, positionMessageDialog, createAttachmentView } = require('../message-media.js');

test('photo preparation scales without upscaling, selects a smaller encoded image and releases its bitmap', async () => {
  const drawn = [], dimensions = [];
  let closed = 0;
  const environment = { File, createImageBitmap: async () => ({ width: 6000, height: 4000, close() { closed++; } }),
    document: { createElement: () => ({ getContext: () => ({ drawImage: (...args) => drawn.push(args.slice(1)) }),
      toBlob(callback, type, quality) { dimensions.push([this.width, this.height, quality]); callback(new Blob([Buffer.alloc(200000)], { type })); } }) } };
  const original = new File([Buffer.alloc(8_000_000)], 'camera.jpg', { type: 'image/jpeg' });
  const result = await prepareMessageFile(original, { environment });
  assert.equal(result.file.size, 200000); assert.equal(result.file.type, 'image/webp');
  assert.equal(result.originalSize, 8_000_000);
  assert.deepEqual(dimensions, [[2560, 1707, .86]]);
  assert.deepEqual(drawn, [[0, 0, 2560, 1707]]);
  assert.equal(closed, 1);
  environment.createImageBitmap = async () => ({ width: 300, height: 200, close() { closed++; } });
  const small = new File(['small'], 'small.png', { type: 'image/png' });
  assert.equal((await prepareMessageFile(small, { environment })).file, small);
  assert.deepEqual(dimensions.at(-1), [300, 200, .86]);
});

test('PDF passes through unchanged; image encode failure can keep a bounded supported original', async () => {
  const pdf = new File(['%PDF-test'], 'test.pdf', { type: 'application/pdf' });
  assert.equal((await prepareMessageFile(pdf)).file, pdf);
  const environment = { createImageBitmap: async () => { throw new Error('decoder unavailable'); } };
  const small = new File(['jpeg'], 'small.jpg', { type: 'image/jpeg' });
  assert.equal((await prepareMessageFile(small, { environment })).file, small);
  await assert.rejects(prepareMessageFile(new File(['svg'], 'active.svg', { type: 'image/svg+xml' })), /이미지 또는 PDF/);
  await assert.rejects(prepareMessageFile({ size: 50_000_001 }), /50MB/);
  await assert.rejects(prepareMessageFile(new File(['heic'], 'photo.heic', { type: 'image/heic' }), { environment }), /JPG/);
});

test('attachment downloader rejects untrusted URLs, wrong sizes and corrupt bytes while allowing the HTTP cache', async () => {
  const bytes = Buffer.from('%PDF-1.7\ntest');
  const descriptor = { id: createHash('sha256').update(bytes).digest('hex'), mediaType: 'application/pdf', size: bytes.length,
    url: '/.netlify/functions/meeting-document?room=test&file=test' };
  const options = { endpoint: 'https://dashboard.test/.netlify/functions/meeting-document', crypto: webcrypto,
    fetcher: async (_, request) => { assert.equal(request.cache, 'default'); return new Response(bytes); } };
  assert.deepEqual(Buffer.from(await downloadAttachment(descriptor, options)), bytes);
  await assert.rejects(downloadAttachment({ ...descriptor, url: 'https://other.test/file' }, options), /주소/);
  await assert.rejects(downloadAttachment({ ...descriptor, size: bytes.length + 1 }, options), /크기/);
  await assert.rejects(downloadAttachment({ ...descriptor, id: 'b'.repeat(64) }, options), /검증/);
  await assert.rejects(downloadAttachment({ ...descriptor, mediaType: 'image/svg+xml' }, options), /정보/);
});

test('popup follows the PDF body center and stays within narrow or horizontally scrolled viewports', () => {
  assert.deepEqual(popupGeometry({ left: 400, width: 1200 }, 1920), { width: 1056, center: 1000 });
  for (const [page, viewport] of [[{ left: 0, width: 390 }, 390], [{ left: -500, width: 2500 }, 1920]]) {
    const { width, center } = popupGeometry(page, viewport);
    assert(width <= viewport - 24);
    assert(center - width / 2 >= 12);
    assert(center + width / 2 <= viewport - 12);
  }
});

function dom() {
  const nodes = [];
  const createElement = tag => {
    const classes = new Set();
    const node = { tag, children: [], attributes: {}, style: {}, classList: {
      add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)),
      toggle: name => { if (classes.has(name)) { classes.delete(name); return false; } classes.add(name); return true; }, contains: name => classes.has(name)
    }, setAttribute(name, value) { this.attributes[name] = value; }, append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = items; }, getContext: () => ({}) };
    nodes.push(node); return node;
  };
  return { nodes, createElement };
}

test('image starts at popup width and buttons adjust in bounded steps without image-click enlargement', async () => {
  const { nodes, createElement } = dom();
  const bytes = Buffer.from('image bytes');
  const revoked = [];
  const environment = { document: { createElement }, crypto: webcrypto, AbortController, AbortSignal, Blob,
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL: url => revoked.push(url) }, fetch: async () => new Response(bytes) };
  const dialog = createElement('dialog'), container = createElement('div');
  const view = createAttachmentView({ dialog, container, environment, endpoint: 'https://test.example/media' });
  await view.show({ id: createHash('sha256').update(bytes).digest('hex'), size: bytes.length,
    mediaType: 'image/png', name: 'photo.png', url: 'https://test.example/media?file=test' });
  const surface = nodes.find(node => node.className === 'message-media-surface');
  const smaller = nodes.find(node => node.attributes['aria-label'] === '첨부 축소');
  const larger = nodes.find(node => node.attributes['aria-label'] === '첨부 확대');
  const fit = nodes.find(node => node.textContent === '너비 맞춤');
  const stage = nodes.find(node => node.className === 'message-media-stage');
  assert.equal(surface.style.width, '100%');
  larger.onclick(); assert.equal(surface.style.width, '125%');
  for (let i = 0; i < 10; i++) larger.onclick();
  assert.equal(surface.style.width, '200%'); assert.equal(larger.disabled, true);
  smaller.onclick(); assert.equal(surface.style.width, '175%');
  for (let i = 0; i < 10; i++) smaller.onclick();
  assert.equal(surface.style.width, '50%'); assert.equal(smaller.disabled, true);
  stage.scrollTop = 500; stage.scrollLeft = 100;
  fit.onclick(); assert.equal(surface.style.width, '100%');
  assert.equal(stage.scrollTop, 0); assert.equal(stage.scrollLeft, 0);
  assert.equal(nodes.find(node => node.tag === 'img').onclick, undefined);
  assert.equal(nodes.find(node => node.tag === 'img').src, 'blob:test');
  view.clear(); assert.equal(container.hidden, true); assert.deepEqual(revoked, ['blob:test']);
});

test('PDF popup renders only the selected page, supports page navigation and destroys its own PDF on close', async () => {
  const { nodes, createElement } = dom();
  const bytes = Buffer.from('%PDF-test');
  const rendered = []; let destroyed = 0;
  const environment = { document: { createElement }, crypto: webcrypto, AbortController, AbortSignal, Blob,
    URL: { createObjectURL: () => 'blob:pdf', revokeObjectURL() {} }, fetch: async () => new Response(bytes),
    pdfjsLib: { getDocument: () => ({ destroy: async () => { destroyed++; }, promise: Promise.resolve({ numPages: 3,
      getPage: async number => ({ getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }),
        render: () => { rendered.push(number); return { promise: Promise.resolve(), cancel() {} }; } }) }) }) } };
  const dialog = createElement('dialog'), container = createElement('div');
  const view = createAttachmentView({ dialog, container, environment, endpoint: 'https://test.example/media' });
  await view.show({ id: createHash('sha256').update(bytes).digest('hex'), size: bytes.length,
    mediaType: 'application/pdf', name: 'test.pdf', url: 'https://test.example/media?file=test' });
  assert.deepEqual(rendered, [1]);
  const next = nodes.find(node => node.textContent === '다음 쪽');
  const surface = nodes.find(node => node.className === 'message-media-surface');
  nodes.find(node => node.attributes['aria-label'] === '첨부 확대').onclick();
  await next.onclick(); assert.deepEqual(rendered, [1, 2]);
  assert.equal(surface.style.width, '125%', 'page changes retain the selected width scale');
  view.clear(); assert.equal(destroyed, 1);
});

test('popup top stays anchored below the PDF toolbar and its maximum height leaves a bottom margin', () => {
  assert.deepEqual(popupVerticalGeometry(1080, 58), { top: 70, maxHeight: 998 });
  for (const [height, contentTop] of [[844, 60], [360, 58], [240, 180]]) {
    const { top, maxHeight } = popupVerticalGeometry(height, contentTop);
    assert(top >= 12);
    assert.equal(top + maxHeight, height - 12);
  }
  const properties = {};
  const dialog = { style: { setProperty: (name, value) => { properties[name] = value; } } };
  const environment = { innerWidth: 1920, innerHeight: 1080, document: {
    querySelectorAll: () => [{ getBoundingClientRect: () => ({ left: 400, width: 1200, top: 70, bottom: 1600 }) }],
    querySelector: selector => selector === '.pdf-viewport' ? { getBoundingClientRect: () => ({ top: 58 }) } : null
  } };
  positionMessageDialog(dialog, environment);
  assert.equal(properties['--message-top'], '70px');
  assert.equal(properties['--message-max-height'], '998px');
  assert.equal(properties['--message-width'], '1056px');
  assert.equal(properties['--message-center'], '1000px');
});

test('closing during download prevents an old attachment from appearing after the next message', async () => {
  const { createElement } = dom();
  const bytes = Buffer.from('image bytes');
  let release, created = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const environment = { document: { createElement }, crypto: webcrypto, AbortController, AbortSignal, Blob,
    URL: { createObjectURL: () => { created++; return 'blob:old'; }, revokeObjectURL() {} }, fetch: async () => { await pending; return new Response(bytes); } };
  const dialog = createElement('dialog'), container = createElement('div');
  const view = createAttachmentView({ dialog, container, environment, endpoint: 'https://test.example/media' });
  const loading = view.show({ id: createHash('sha256').update(bytes).digest('hex'), size: bytes.length,
    mediaType: 'image/png', url: 'https://test.example/media?file=old' });
  view.clear(); release(); await loading;
  assert.equal(created, 0);
  assert.equal(container.hidden, true);
});
