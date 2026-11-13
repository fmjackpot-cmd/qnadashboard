import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { documentInfo, validFileId } from '../lib/meeting-documents.mjs';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
});
const digest = value => createHash('sha256').update(value).digest();
const roomPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const maxAge = 12 * 60 * 60 * 1000;

// Dependencies are injectable so authorization and persistence can be checked locally.
export function createHandler({ store, documents, adminKey, broker, now = Date.now, revision = randomUUID }) {
  return async request => {
    if (!['GET', 'POST'].includes(request.method)) return json({ error: '허용되지 않은 요청입니다.' }, 405);
    if (!adminKey || adminKey.length < 6) return json({ error: '서버에 MEETING_ADMIN_KEY(6자 이상)를 설정하고 다시 배포해주세요.' }, 503);
    if (!broker) return json({ error: '서버에 ABLY_API_KEY를 설정하고 다시 배포해주세요.' }, 503);
    const url = new URL(request.url);
    const room = url.searchParams.get('room') || '';
    if (!roomPattern.test(room)) return json({ error: '회의 코드는 영문·숫자·밑줄·하이픈 1~64자로 입력해주세요.' }, 400);
    try {
      if (request.method === 'GET') {
        if (url.searchParams.get('action') === 'token') return json(await broker.issueToken(room));
        const state = await store.get(room, { type: 'json', consistency: 'strong' });
        return json({ state: state && now() - state.updatedAt < maxAge ? state : null });
      }
      const token = request.headers.get('authorization') || '';
      if (!timingSafeEqual(digest(token), digest(`Bearer ${adminKey}`))) return json({ error: '관리자 인증키를 확인해주세요.' }, 401);
      // No cross-origin writes, including browser requests made with stolen room links.
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) return json({ error: '다른 사이트에서 제어할 수 없습니다.' }, 403);
      const bodyText = await request.text();
      if (bodyText.length > 2048) return json({ error: '요청이 너무 큽니다.' }, 413);
      let body;
      try { body = JSON.parse(bodyText); } catch { return json({ error: '올바른 JSON 요청이 아닙니다.' }, 400); }
      if (body?.action === 'authenticate') return json({ authenticated: true });
      if (body?.controllerId !== undefined && !/^[a-zA-Z0-9_-]{1,80}$/.test(body.controllerId)) {
        return json({ error: '관리자 세션 정보가 올바르지 않습니다.' }, 400);
      }
      if (!body || !/^[a-f0-9]{64}$/.test(body.documentId || '') ||
          !['question', 'toc'].includes(body.mode) ||
          (body.mode === 'question' && (!Number.isSafeInteger(body.questionId) || body.questionId < 1))) {
        return json({ error: '문서 또는 문항 정보가 올바르지 않습니다.' }, 400);
      }
      const snapshot = store.getWithMetadata
        ? await store.getWithMetadata(room, { type: 'json', consistency: 'strong' }) : null;
      const previous = store.getWithMetadata ? snapshot?.data : await store.get(room, { type: 'json', consistency: 'strong' });
      if (previous?.controllerId && previous.controllerId !== body.controllerId && now() - previous.updatedAt < 2000) {
        return json({ error: '다른 관리자가 화면을 변경했습니다. 변경 후 2초가 지나면 다시 선택해주세요.', state: previous }, 409);
      }
      let document = previous?.document;
      if (body.action === 'set-document') {
        if (!documents || !validFileId(body.fileId)) return json({ error: '먼저 회의 자료를 업로드해주세요.' }, 400);
        const entry = await documents.getMetadata(body.fileId, { consistency: 'strong' });
        if (!entry || entry.metadata.room !== room || entry.metadata.id !== body.documentId) return json({ error: '업로드한 회의 자료가 일치하지 않습니다.' }, 400);
        document = documentInfo(room, body.fileId, entry.metadata);
      } else if (document && document.id !== body.documentId) {
        return json({ error: '회의 자료로 업로드한 PDF에서 문항을 선택해주세요.' }, 409);
      }
      const state = { revision: revision(), sequence: (previous?.sequence || 0) + 1, updatedAt: now(), documentId: body.documentId,
        mode: body.mode, questionId: body.mode === 'question' ? body.questionId : null };
      if (document) state.document = document;
      if (body.controllerId) state.controllerId = body.controllerId;
      const written = await store.setJSON(room, state, store.getWithMetadata
        ? (snapshot ? { onlyIfMatch: snapshot.etag } : { onlyIfNew: true }) : undefined);
      if (written?.modified === false) {
        return json({ error: '다른 관리자가 먼저 화면을 변경했습니다. 최신 화면을 확인하고 다시 선택해주세요.',
          state: await store.get(room, { type: 'json', consistency: 'strong' }) }, 409);
      }
      await broker.publish(room, state);
      return json({ state });
    } catch (error) {
      console.error('Meeting state unavailable:', error.name);
      return json({ error: '회의 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.' }, 503);
    }
  };
}

export default async request => {
  try {
    const { getStore } = await import('@netlify/blobs');
    const { createBroker } = await import('../lib/meeting-ably.mjs');
    // Use a deployment ID outside production so previews never control a live meeting.
    const namespace = process.env.CONTEXT === 'production' ? 'production' : (process.env.DEPLOY_ID || 'local');
    const store = getStore({ name: `dashboard-meetings-${namespace}`, consistency: 'strong' });
    const broker = process.env.ABLY_API_KEY ? createBroker({ apiKey: process.env.ABLY_API_KEY, namespace }) : null;
    const documents = getStore({ name: `dashboard-documents-${namespace}`, consistency: 'strong' });
    return await createHandler({ store, documents, adminKey: process.env.MEETING_ADMIN_KEY, broker })(request);
  } catch {
    return json({ error: 'Netlify 회의 저장소를 사용할 수 없습니다. 서버 설정을 확인해주세요.' }, 503);
  }
};
