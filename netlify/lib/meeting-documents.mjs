import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

export const MAX_PDF_BYTES = 4_500_000;
export const MAX_DOCUMENT_BYTES = 50_000_000;
export const PART_BYTES = 3_000_000;
export const validFileId = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const json = (value, status = 200) => new Response(JSON.stringify(value), { status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const digest = value => createHash('sha256').update(value).digest();
export const documentInfo = (room, fileId, metadata) => ({ id: metadata.id, fileId, name: metadata.name,
  documentType: metadata.documentType || 'questions', ...(metadata.parts ? { parts: metadata.parts, size: metadata.size } : {}),
  url: `/.netlify/functions/meeting-document?room=${encodeURIComponent(room)}&file=${fileId}` });

export function createDocumentHandler({ documents, adminKey, now = Date.now, createId = randomUUID }) {
  return async request => {
    const url = new URL(request.url);
    const room = url.searchParams.get('room') || '';
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(room)) return json({ error: '회의 코드가 올바르지 않습니다.' }, 400);
    if (!['GET', 'POST'].includes(request.method)) return json({ error: '허용되지 않은 요청입니다.' }, 405);
    try {
      if (request.method === 'GET') {
        const fileId = url.searchParams.get('file');
        if (!validFileId(fileId)) return json({ error: '자료를 찾을 수 없습니다.' }, 404);
        const entry = await documents.getWithMetadata(fileId, { type: 'arrayBuffer', consistency: 'strong' });
        if (!entry || entry.metadata.room !== room) return json({ error: '자료를 찾을 수 없습니다.' }, 404);
        if (entry.metadata.parts) {
          const part = Number(url.searchParams.get('part'));
          if (!url.searchParams.has('part') || !Number.isInteger(part) || part < 0 || part >= entry.metadata.parts) return json({ error: '조각 번호가 올바르지 않습니다.' }, 400);
          const chunk = await documents.getWithMetadata(`${fileId}/part/${part}`, { type: 'arrayBuffer', consistency: 'strong' });
          if (!chunk || chunk.metadata.room !== room) return json({ error: '자료 조각을 찾을 수 없습니다.' }, 404);
          return new Response(chunk.data, { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' } });
        }
        return new Response(entry.data, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `inline; filename="meeting.pdf"; filename*=UTF-8''${encodeURIComponent(entry.metadata.name)}` } });
      }
      if (!adminKey || adminKey.length < 6) return json({ error: '서버의 관리자 인증키를 설정해주세요.' }, 503);
      if (!timingSafeEqual(digest(request.headers.get('authorization') || ''), digest(`Bearer ${adminKey}`))) return json({ error: '관리자 인증키를 확인해주세요.' }, 401);
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) return json({ error: '다른 사이트에서 업로드할 수 없습니다.' }, 403);
      if (Number(request.headers.get('content-length')) > MAX_PDF_BYTES) return json({ error: 'PDF는 4.5MB 이하만 업로드할 수 있습니다.' }, 413);
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength > MAX_PDF_BYTES) return json({ error: 'PDF는 4.5MB 이하만 업로드할 수 있습니다.' }, 413);
      const action = url.searchParams.get('action');
      if (action === 'init') {
        let body;
        try { body = JSON.parse(Buffer.from(bytes).toString()); } catch { return json({ error: '업로드 정보가 올바르지 않습니다.' }, 400); }
        if (!Number.isSafeInteger(body.size) || body.size < 1 || body.size > MAX_DOCUMENT_BYTES || !/^[a-f0-9]{64}$/.test(body.id || '') || !['questions', 'receipt'].includes(body.documentType)) return json({ error: 'PDF는 최대 50MB이며 올바른 자료구분을 선택해야 합니다.' }, 400);
        const uploadId = createId();
        const name = Array.from(String(body.name || 'meeting.pdf').replace(/[\x00-\x1f\x7f/\\]/g, '_')).slice(0, 180).join('').trim() || 'meeting.pdf';
        const metadata = { room, name, id: body.id, size: body.size, parts: Math.ceil(body.size / PART_BYTES), documentType: body.documentType, createdAt: now() };
        await documents.set(`${uploadId}/pending`, new Uint8Array(), { metadata });
        return json({ uploadId, parts: metadata.parts, partBytes: PART_BYTES }, 201);
      }
      if (action === 'part' || action === 'complete') {
        const uploadId = url.searchParams.get('upload');
        if (!validFileId(uploadId)) return json({ error: '업로드 정보가 올바르지 않습니다.' }, 400);
        const pending = await documents.getMetadata(`${uploadId}/pending`, { consistency: 'strong' });
        if (!pending || pending.metadata.room !== room || now() - pending.metadata.createdAt > 60 * 60 * 1000) return json({ error: '업로드가 만료되었습니다. 다시 선택해주세요.' }, 404);
        const metadata = pending.metadata;
        if (action === 'part') {
          const part = Number(url.searchParams.get('part'));
          if (!url.searchParams.has('part') || !Number.isInteger(part) || part < 0 || part >= metadata.parts) return json({ error: '조각 번호가 올바르지 않습니다.' }, 400);
          const expected = Math.min(PART_BYTES, metadata.size - part * PART_BYTES);
          if (bytes.byteLength !== expected) return json({ error: '자료 조각 크기가 일치하지 않습니다.' }, 400);
          if (part === 0 && !Buffer.from(bytes).subarray(0, 1024).includes(Buffer.from('%PDF-'))) return json({ error: '올바른 PDF 파일을 선택해주세요.' }, 400);
          await documents.set(`${uploadId}/part/${part}`, bytes, { metadata: { room } });
          return json({ received: part });
        }
        const hash = createHash('sha256');
        for (let part = 0; part < metadata.parts; part++) {
          const chunk = await documents.getWithMetadata(`${uploadId}/part/${part}`, { type: 'arrayBuffer', consistency: 'strong' });
          if (!chunk || chunk.metadata.room !== room || chunk.data.byteLength !== Math.min(PART_BYTES, metadata.size - part * PART_BYTES)) return json({ error: '자료 조각이 누락되었습니다. 다시 업로드해주세요.' }, 409);
          hash.update(Buffer.from(chunk.data));
        }
        if (hash.digest('hex') !== metadata.id) return json({ error: 'PDF 검증에 실패했습니다. 다시 업로드해주세요.' }, 409);
        // Only verified manifests can be committed as the active meeting document.
        await documents.set(uploadId, new Uint8Array(), { metadata });
        return json({ document: documentInfo(room, uploadId, metadata) }, 201);
      }
      if (action) return json({ error: '알 수 없는 업로드 요청입니다.' }, 400);
      if (!bytes.byteLength || !Buffer.from(bytes).subarray(0, 1024).includes(Buffer.from('%PDF-'))) return json({ error: '올바른 PDF 파일을 선택해주세요.' }, 400);
      let name;
      try { name = decodeURIComponent(request.headers.get('x-pdf-name') || 'meeting.pdf'); }
      catch { return json({ error: '파일 이름이 올바르지 않습니다.' }, 400); }
      name = Array.from(name.replace(/[\x00-\x1f\x7f/\\]/g, '_')).slice(0, 180).join('').trim() || 'meeting.pdf';
      const fileId = createId();
      const documentType = request.headers.get('x-document-type') || 'questions';
      if (!['questions', 'receipt'].includes(documentType)) return json({ error: '자료구분이 올바르지 않습니다.' }, 400);
      const metadata = { room, name, documentType, id: createHash('sha256').update(Buffer.from(bytes)).digest('hex'), createdAt: now() };
      await documents.set(fileId, bytes, { metadata });
      // Upload alone never changes the active meeting. The presenter downloads
      // and parses this exact object before committing the document switch.
      return json({ document: documentInfo(room, fileId, metadata) }, 201);
    } catch {
      return json({ error: '자료 저장소에 연결하지 못했습니다. 기존 회의 자료는 유지됩니다.' }, 503);
    }
  };
}
