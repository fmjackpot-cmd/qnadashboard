(function (root) {
  'use strict';
  const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];
  const hash = async (bytes, crypto) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');

  function popupGeometry(page, viewportWidth) {
    const width = Math.min(viewportWidth - 24, Math.max(280, page.width * .88));
    const center = Math.max(width / 2 + 12, Math.min(viewportWidth - width / 2 - 12, page.left + page.width / 2));
    return { width, center };
  }

  function positionMessageDialog(dialog, environment = root) {
    const viewportWidth = environment.innerWidth;
    const pages = Array.from(environment.document.querySelectorAll('.pdf-page-card canvas'));
    const page = pages.map(canvas => canvas.getBoundingClientRect()).find(rect => rect.width && rect.bottom > 80 && rect.top < environment.innerHeight)
      || environment.document.querySelector('.viewer-container')?.getBoundingClientRect()
      || { width: viewportWidth, left: 0 };
    const geometry = popupGeometry(page, viewportWidth);
    dialog.style.setProperty('--message-width', `${geometry.width}px`);
    dialog.style.setProperty('--message-center', `${geometry.center}px`);
  }

  async function prepareMessageFile(file, { environment = root } = {}) {
    if (!file?.size || file.size > 50000000) throw new Error('첨부는 한 번에 1개, 최대 50MB까지 선택해주세요.');
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return { file, originalSize: file.size };
    if (!/^image\/(jpeg|png|webp|gif|heic|heif)$/.test(file.type)) throw new Error('이미지 또는 PDF 파일을 선택해주세요.');
    let bitmap;
    let sourceUrl;
    try {
      if (environment.createImageBitmap) bitmap = await environment.createImageBitmap(file, { imageOrientation: 'from-image' });
      else {
        sourceUrl = environment.URL.createObjectURL(file);
        bitmap = new environment.Image();
        bitmap.src = sourceUrl;
        await bitmap.decode();
      }
      const canvas = environment.document.createElement('canvas');
      const width = bitmap.naturalWidth || bitmap.width, height = bitmap.naturalHeight || bitmap.height;
      if (!width || !height) throw new Error('empty image');
      let result;
      for (const edge of [2560, 2048, 1600]) {
        const scale = Math.min(1, edge / Math.max(width, height));
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext('2d');
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        result = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .86));
        if (!result) throw new Error('encode failed');
        if (result.size <= 2000000) break;
      }
      // Keep a smaller original when no resizing is needed. Never upscale an image.
      if (Math.max(width, height) <= 2560 && imageTypes.includes(file.type) && file.size < result.size) result = file;
      if (result.size > 4500000) throw new Error('image too large');
      const extension = result.type === 'image/webp' ? 'webp' : result.type === 'image/jpeg' ? 'jpg' : 'png';
      return { file: result === file ? file : new environment.File([result], file.name.replace(/\.[^.]+$/, '') + '.' + extension, { type: result.type }), originalSize: file.size };
    } catch {
      if (imageTypes.includes(file.type) && file.size <= 4500000) return { file, originalSize: file.size };
      throw new Error('이미지를 처리하지 못했습니다. JPG·PNG로 저장하거나 4.5MB 이하 이미지를 선택해주세요.');
    } finally {
      bitmap?.close?.();
      if (sourceUrl) environment.URL.revokeObjectURL(sourceUrl);
    }
  }

  async function downloadAttachment(descriptor, { endpoint, fetcher = root.fetch.bind(root), crypto = root.crypto, signal } = {}) {
    if (!descriptor || !/^[a-f0-9]{64}$/.test(descriptor.id || '') ||
        !['application/pdf', ...imageTypes].includes(descriptor.mediaType)) throw new Error('첨부 정보가 올바르지 않습니다.');
    const base = new URL(endpoint, root.location?.href);
    const url = new URL(descriptor.url, base);
    if (url.origin !== base.origin || url.pathname !== base.pathname) throw new Error('허용되지 않은 첨부 주소입니다.');
    const parts = descriptor.parts || 1;
    if (!Number.isSafeInteger(descriptor.size) || descriptor.size < 1 || descriptor.size > 50000000 ||
        !Number.isSafeInteger(parts) || parts < 1 || parts > 17 ||
        (descriptor.parts ? parts !== Math.ceil(descriptor.size / 3000000) || descriptor.mediaType !== 'application/pdf' : descriptor.size > 4500000)) throw new Error('첨부 크기가 올바르지 않습니다.');
    const bytes = new Uint8Array(descriptor.size);
    let offset = 0;
    for (let part = 0; part < parts; part++) {
      if (descriptor.parts) url.searchParams.set('part', part);
      const response = await fetcher(url, { cache: 'default', signal });
      if (!response.ok) throw new Error('첨부를 불러오지 못했습니다. 아래 다시 불러오기를 눌러주세요.');
      const chunk = new Uint8Array(await response.arrayBuffer());
      if (chunk.length !== Math.min(descriptor.parts ? 3000000 : descriptor.size, descriptor.size - offset)) throw new Error('첨부 파일 크기가 일치하지 않습니다.');
      bytes.set(chunk, offset); offset += chunk.length;
    }
    if (await hash(bytes, crypto) !== descriptor.id) throw new Error('첨부 파일 검증에 실패했습니다. 다시 불러와주세요.');
    return bytes;
  }

  function createAttachmentView({ container, dialog, endpoint, environment = root }) {
    let generation = 0, abort, objectUrl, pdfTask, renderTask;
    const clear = () => {
      generation++; abort?.abort(); renderTask?.cancel(); renderTask = null;
      pdfTask?.destroy()?.catch?.(() => {}); pdfTask = null;
      if (objectUrl) environment.URL.revokeObjectURL(objectUrl);
      objectUrl = null;
      container.replaceChildren();
      container.hidden = true;
      dialog.classList.remove('has-attachment', 'media-expanded');
    };
    const show = async attachment => {
      clear();
      if (!attachment) return;
      const current = generation;
      container.hidden = false;
      dialog.classList.add('has-attachment');
      const make = (tag, text, className) => {
        const node = environment.document.createElement(tag);
        if (text) node.textContent = text;
        if (className) node.className = className;
        return node;
      };
      const status = make('p', '첨부를 불러오는 중…', 'message-media-status');
      status.setAttribute('role', 'status');
      container.append(status);
      const retry = make('button', '다시 불러오기');
      retry.type = 'button'; retry.onclick = () => show(attachment);
      try {
        abort = new environment.AbortController();
        const timeoutSignal = environment.AbortSignal.timeout(60000);
        // Timeout and dismiss both stop a multipart download.
        const controller = abort;
        const timeout = () => controller.abort();
        timeoutSignal.addEventListener('abort', timeout, { once: true });
        let bytes;
        try { bytes = await downloadAttachment(attachment, { endpoint, fetcher: environment.fetch.bind(environment), crypto: environment.crypto, signal: controller.signal }); }
        finally { timeoutSignal.removeEventListener('abort', timeout); }
        if (current !== generation) return;
        objectUrl = environment.URL.createObjectURL(new environment.Blob([bytes], { type: attachment.mediaType }));
        const controls = make('div', null, 'message-media-controls');
        const link = make('a', attachment.name || '첨부 다운로드');
        link.href = objectUrl; link.download = attachment.name || 'attachment';
        controls.append(link);
        const zoom = make('button', '확대'); zoom.type = 'button';
        zoom.setAttribute('aria-pressed', 'false');
        const toggle = () => {
          const expanded = dialog.classList.toggle('media-expanded');
          zoom.textContent = expanded ? '축소' : '확대';
          zoom.setAttribute('aria-pressed', String(expanded));
        };
        zoom.onclick = toggle; controls.append(zoom);
        const stage = make('div', null, 'message-media-stage');
        container.replaceChildren(controls, stage);
        if (attachment.mediaType.startsWith('image/')) {
          const image = make('img');
          image.alt = attachment.name || '관리자가 보낸 이미지';
          image.src = objectUrl;
          const button = make('button', null, 'message-image-toggle');
          button.type = 'button'; button.setAttribute('aria-label', '이미지 확대 또는 축소');
          button.onclick = toggle; button.append(image); stage.append(button);
          image.onerror = () => { if (current === generation) { status.textContent = '이미지를 표시하지 못했습니다.'; stage.replaceChildren(status, retry); } };
        } else {
          if (!environment.pdfjsLib) throw new Error('PDF 뷰어를 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.');
          pdfTask = environment.pdfjsLib.getDocument({ data: bytes, isEvalSupported: false, enableXfa: false });
          const pdf = await pdfTask.promise;
          if (current !== generation) return;
          let pageNumber = 1, rendering = false;
          const previous = make('button', '이전 쪽'), next = make('button', '다음 쪽'), label = make('span');
          previous.type = next.type = 'button';
          controls.append(previous, label, next);
          const canvas = make('canvas'); stage.append(canvas);
          const render = async number => {
            if (rendering || current !== generation) return;
            rendering = true; previous.disabled = next.disabled = true;
            try {
              const page = await pdf.getPage(number);
              if (current !== generation) return;
              const natural = page.getViewport({ scale: 1 });
              const viewport = page.getViewport({ scale: Math.min(2, 1600 / natural.width, 2200 / natural.height) });
              canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
              renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport });
              await renderTask.promise;
              if (current !== generation) return;
              pageNumber = number; label.textContent = `${pageNumber} / ${pdf.numPages}쪽`;
            } catch (error) {
              if (current === generation) { status.textContent = 'PDF 쪽을 표시하지 못했습니다. 다시 불러와주세요.'; stage.replaceChildren(status, retry); }
            } finally {
              rendering = false; previous.disabled = pageNumber === 1; next.disabled = pageNumber === pdf.numPages;
            }
          };
          previous.onclick = () => render(pageNumber - 1); next.onclick = () => render(pageNumber + 1);
          canvas.onclick = toggle;
          await render(1);
        }
      } catch (error) {
        if (current !== generation) return;
        status.textContent = error.message || '첨부를 표시하지 못했습니다.';
        container.replaceChildren(status, retry);
      }
    };
    return { show, clear };
  }

  const api = { prepareMessageFile, downloadAttachment, createAttachmentView, popupGeometry, positionMessageDialog };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MessageMedia = api;
})(typeof window !== 'undefined' ? window : globalThis);
