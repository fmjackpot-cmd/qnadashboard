import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

export const MAX_PDF_BYTES = 4_500_000;
export const validFileId = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const json = (value, status = 200) => new Response(JSON.stringify(value), { status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const digest = value => createHash('sha256').update(value).digest();
export const documentInfo = (room, fileId, metadata) => ({ id: metadata.id, fileId, name: metadata.name,
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
      if (!bytes.byteLength || !Buffer.from(bytes).subarray(0, 1024).includes(Buffer.from('%PDF-'))) return json({ error: '올바른 PDF 파일을 선택해주세요.' }, 400);
      let name;
      try { name = decodeURIComponent(request.headers.get('x-pdf-name') || 'meeting.pdf'); }
      catch { return json({ error: '파일 이름이 올바르지 않습니다.' }, 400); }
      name = Array.from(name.replace(/[\x00-\x1f\x7f/\\]/g, '_')).slice(0, 180).join('').trim() || 'meeting.pdf';
      const fileId = createId();
      const metadata = { room, name, id: createHash('sha256').update(Buffer.from(bytes)).digest('hex'), createdAt: now() };
      await documents.set(fileId, bytes, { metadata });
      // Upload alone never changes the active meeting. The presenter downloads
      // and parses this exact object before committing the document switch.
      return json({ document: documentInfo(room, fileId, metadata) }, 201);
    } catch {
      return json({ error: '자료 저장소에 연결하지 못했습니다. 기존 회의 자료는 유지됩니다.' }, 503);
    }
  };
}
