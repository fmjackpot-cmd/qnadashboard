import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { roomPattern, isOpenMeeting } from './meeting.mjs';

export const config = {
  path: '/.netlify/functions/meeting-supervisor',
  rateLimit: { windowLimit: 25, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};

const cookieName = '__Host-meeting-supervisor';
const ttl = 15 * 60;
const readOptions = { type: 'json', consistency: 'strong' };
const matches = (left, right) => timingSafeEqual(
  createHash('sha256').update(left).digest(), createHash('sha256').update(right).digest()
);
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
});

export function createSupervisorHandler({ store, broker, key, scope = '', now = Date.now }) {
  const sign = value => createHmac('sha256', key).update('meeting-supervisor:' + scope + ':' + value).digest('base64url');
  const cookie = (value, seconds) => cookieName + '=' + value +
    '; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=' + seconds;
  const open = state => isOpenMeeting(state, now());

  return async request => {
    if (!key || key.length < 6) return json({ error: '서버에 6자 이상의 MEETING_SUPERVISOR_KEY를 설정해주세요.' }, 503);
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || '';
    if (!['GET', 'POST'].includes(request.method)) return json({ error: '허용되지 않은 요청입니다.' }, 405);
    if (request.method === 'POST' && request.headers.get('origin') !== url.origin) {
      return json({ error: '이 사이트에서 다시 요청해주세요.' }, 403);
    }

    try {
      if (request.method === 'POST' && action === 'login') {
        const body = await request.text();
        if (body.length > 4096) return json({ error: '요청이 너무 큽니다.' }, 413);
        let password;
        try { password = JSON.parse(body)?.password; } catch { return json({ error: '올바르지 않은 로그인 요청입니다.' }, 400); }
        if (typeof password !== 'string' || !matches(password, key)) return json({ error: '슈퍼바이저 암호를 확인해주세요.' }, 401);
        const value = String(now() + ttl * 1000);
        return json({ authenticated: true }, 200, { 'Set-Cookie': cookie(value + '.' + sign(value), ttl) });
      }
      if (request.method === 'POST' && action === 'logout') {
        return json({ authenticated: false }, 200, { 'Set-Cookie': cookie('', 0) });
      }
      const session = (request.headers.get('cookie') || '').split(/;\s*/).find(part => part.startsWith(cookieName + '='));
      const [expiry, signature] = session?.slice(cookieName.length + 1).split('.') || [];
      if (!/^\d{13}$/.test(expiry) || Number(expiry) <= now() || !signature || !matches(signature, sign(expiry))) {
        return json({ error: '슈퍼바이저 로그인이 필요합니다.' }, 401);
      }

      if (request.method === 'GET' && !action) {
        const meetings = [];
        for await (const page of store.list({ paginate: true })) {
          const keys = page.blobs.map(blob => blob.key).filter(room => roomPattern.test(room));
          for (let i = 0; i < keys.length; i += 16) {
            const rooms = keys.slice(i, i + 16);
            const states = await Promise.all(rooms.map(room => store.get(room, readOptions)));
            states.forEach((state, index) => {
              if (open(state)) meetings.push({ room: rooms[index], name: state.document.name, updatedAt: state.updatedAt });
            });
          }
        }
        meetings.sort((a, b) => b.updatedAt - a.updatedAt);
        return json({ meetings });
      }

      if (request.method === 'POST' && action === 'close') {
        const room = url.searchParams.get('room') || '';
        if (!roomPattern.test(room)) return json({ error: '회의 이름이 올바르지 않습니다.' }, 400);
        for (let attempt = 0; attempt < 4; attempt++) {
          const snapshot = await store.getWithMetadata(room, readOptions);
          if (snapshot?.data?.closed) return json({ closed: true });
          if (!open(snapshot?.data)) return json({ error: '열려 있는 회의를 찾을 수 없습니다.' }, 404);
          const event = { type: 'closed', revision: randomUUID(), closed: true, closedAt: now() };
          const written = await store.setJSON(room, { ...snapshot.data, ...event }, { onlyIfMatch: snapshot.etag });
          if (written?.modified === false) continue;
          try {
            if (!broker) throw new Error('Missing broker');
            await broker.publish(room, event);
            return json({ closed: true, notified: true });
          } catch {
            return json({ closed: true, notified: false });
          }
        }
        return json({ error: '회의 상태가 갱신 중입니다. 다시 시도해주세요.' }, 409);
      }
      return json({ error: '지원하지 않는 요청입니다.' }, 405);
    } catch {
      return json({ error: '회의 관리 요청을 처리하지 못했습니다.' }, 503);
    }
  };
}

export default async request => {
  try {
    const { getStore } = await import('@netlify/blobs');
    const { createBroker } = await import('../lib/meeting-ably.mjs');
    const namespace = process.env.CONTEXT === 'production' ? 'production' : (process.env.DEPLOY_ID || 'local');
    const store = getStore({ name: 'dashboard-meetings-' + namespace, consistency: 'strong' });
    const broker = process.env.ABLY_API_KEY ? createBroker({ apiKey: process.env.ABLY_API_KEY, namespace }) : null;
    return await createSupervisorHandler({ store, broker, key: process.env.MEETING_SUPERVISOR_KEY, scope: namespace })(request);
  } catch {
    return json({ error: '회의 저장소를 사용할 수 없습니다.' }, 503);
  }
};
