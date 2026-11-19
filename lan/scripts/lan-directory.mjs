import { createHash, timingSafeEqual } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest();
const matches = (request, key) => Boolean(key && key.length >= 6) && timingSafeEqual(
  digest(request.headers.get('authorization') || ''), digest(`Bearer ${key}`));
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

// Share this queue with meeting writes, so a concurrent update cannot undo closure.
export function createLanDirectory({ store, documents, broker, adminKey }) {
  let queue = Promise.resolve();
  const serial = operation => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  const entries = async () => {
    const saved = await store.get('directory:rooms');
    if (saved) return saved;
    // Recover rooms created by the previous package from their active PDFs.
    const rooms = new Map();
    for (const { key } of (await documents.list()).blobs) {
      if (!/^[a-f0-9-]{36}$/.test(key)) continue;
      const metadata = (await documents.getMetadata(key))?.metadata;
      if (!metadata?.room || metadata.purpose === 'message') continue;
      const state = await store.get(metadata.room);
      if (state?.document?.fileId === key) rooms.set(metadata.room,
        { room: metadata.room, openedAt: state.updatedAt, closedAt: null });
    }
    const result = [...rooms.values()];
    await store.setJSON('directory:rooms', result);
    return result;
  };
  const closed = async room => (await entries()).some(item => item.room === room && item.closedAt);
  return {
    serial, closed,
    async register(room) {
      const rooms = await entries();
      if (!rooms.some(item => item.room === room)) {
        await store.setJSON('directory:rooms', [...rooms, { room, openedAt: Date.now(), closedAt: null }]);
      }
    },
    async handle(request, { owner = false } = {}) {
      const url = new URL(request.url);
      const superAdmin = owner;
      const admin = superAdmin || matches(request, typeof adminKey === 'function' ? adminKey() : adminKey);
      if (request.method === 'GET') {
        if (request.headers.has('authorization') && !admin) return json({ error: '인증키를 확인해주세요.' }, 401);
        const rooms = await entries();
        return json({ role: superAdmin ? 'super' : admin ? 'admin' : 'viewer',
          rooms: await Promise.all(rooms.filter(room => superAdmin || !room.closedAt).map(async room => {
            const state = await store.get(room.room);
            return { ...room, documentName: state?.document?.name || '', updatedAt: state?.updatedAt || room.openedAt };
          })) });
      }
      if (request.method !== 'POST') return json({ error: '허용되지 않은 요청입니다.' }, 405);
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) return json({ error: '다른 사이트에서 제어할 수 없습니다.' }, 403);
      if (!superAdmin) return json({ error: '서버 PC의 로컬 관리 화면에서만 종료할 수 있습니다.' }, 403);
      let body;
      try { body = await request.json(); } catch { return json({ error: '올바른 요청이 아닙니다.' }, 400); }
      if (body?.action !== 'close') return json({ error: '허용되지 않은 작업입니다.' }, 400);
      const rooms = await entries();
      const room = rooms.find(item => item.room === body.room);
      if (!room) return json({ error: '회의를 찾을 수 없습니다.' }, 404);
      if (!room.closedAt) {
        room.closedAt = Date.now();
        await store.setJSON('directory:rooms', rooms);
      }
      await broker.publish(room.room, { type: 'closed' });
      return json({ closed: true });
    }
  };
}
