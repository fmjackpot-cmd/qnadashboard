(function (root) {
  'use strict';

  class MeetingSession {
    constructor({ request, getDocument, showTarget, onStatus = () => {} }) {
      Object.assign(this, { request, getDocument, showTarget, onStatus });
      this.generation = 0;
      this.active = false;
      this.lastRevision = null;
      this.sendQueue = Promise.resolve();
    }

    async join(room, key = '') {
      this.leave();
      const generation = this.generation;
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(room)) throw new Error('회의 코드는 영문·숫자·밑줄·하이픈 1~64자로 입력해주세요.');
      if (key) await this.request(room, { action: 'authenticate' }, key);
      else await this.request(room);
      if (generation !== this.generation) return;
      Object.assign(this, { active: true, room, key, role: key ? 'admin' : 'viewer', lastRevision: null,
        lastState: null, browsing: false, connectionLost: false });
      this.onStatus(key ? 'admin' : 'waiting');
    }

    leave() {
      this.generation++;
      this.active = false;
      this.key = '';
      this.onStatus('offline');
    }

    async poll() {
      if (!this.active || this.polling) return;
      const generation = this.generation;
      this.polling = true;
      try {
        const { state } = await this.request(this.room);
        if (generation !== this.generation) return;
        if (this.role === 'admin') {
          if (this.connectionLost) this.onStatus('admin');
          this.connectionLost = false;
          return;
        }
        if (!state) { this.onStatus('waiting'); return; }
        // The revision is an event, not a selected question. Unchanged events must
        // never interrupt a viewer who has chosen to browse independently.
        if (state.revision === this.lastRevision) {
          if (this.connectionLost) this.onStatus(this.browsing ? 'browsing' : 'following');
          this.connectionLost = false;
          return;
        }
        const doc = this.getDocument();
        if (!doc.ready) { this.onStatus('loading'); return; }
        this.onStatus('switching');
        await this.showTarget(state);
        if (generation !== this.generation) return;
        this.lastRevision = state.revision;
        this.lastState = state;
        this.browsing = false;
        this.connectionLost = false;
        this.onStatus('following');
      } catch (error) {
        if (generation === this.generation) {
          this.connectionLost = true;
          this.onStatus('error', error.message);
        }
      } finally { this.polling = false; }
    }

    navigate(target) {
      if (!this.active) return Promise.resolve();
      if (this.role !== 'admin') {
        this.browsing = true;
        this.onStatus('browsing');
        return Promise.resolve();
      }
      const generation = this.generation;
      const doc = this.getDocument();
      if (!doc.ready || !doc.hosted || !doc.id) {
        this.onStatus('error', '전체 전송은 배포된 공통 PDF에서 가능합니다. 기본 문서로 돌아가주세요.');
        return Promise.resolve();
      }
      // Serialize writes so a slow earlier request cannot overwrite a later move.
      this.sendQueue = this.sendQueue.catch(() => {}).then(async () => {
        if (generation !== this.generation) return;
        this.onStatus('sending');
        try {
          const { state } = await this.request(this.room, { ...target, documentId: doc.id }, this.key);
          if (generation !== this.generation) return;
          this.lastRevision = state.revision;
          this.connectionLost = false;
          this.onStatus('admin');
        } catch (error) {
          if (generation === this.generation) this.onStatus('error', `${error.message} ‘현재 화면 전송’으로 다시 시도해주세요.`);
        }
      });
      return this.sendQueue;
    }

    async returnToAdmin() {
      if (this.lastState) {
        await this.showTarget(this.lastState);
        this.browsing = false;
        this.onStatus('following');
      }
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { MeetingSession };
  root.MeetingSession = MeetingSession;
  if (!root.document) return;

  document.addEventListener('DOMContentLoaded', () => {
    const el = id => document.getElementById(id);
    const dialog = el('meeting-dialog');
    const status = el('meeting-status');
    const form = el('meeting-form');
    const endpoint = root.DASHBOARD_CONFIG?.meetingEndpoint;
    const labels = {
      offline: '개별 열람 · 회의에 연결하면 관리자 이동이 우선 표시됩니다',
      waiting: '회의 연결됨 · 관리자 전송 대기 중',
      loading: '회의 연결됨 · 문서를 불러오는 중',
      switching: '관리자 화면으로 이동 중…',
      following: '관리자 화면 표시 중 · 자유롭게 열람할 수 있습니다',
      browsing: '자유 열람 중 · 관리자 이동 시 자동 전환됩니다',
      admin: '관리자 제어 중 · 문항을 선택하면 모든 이용자에게 전송됩니다',
      sending: '전체 이용자에게 전송 중…'
    };
    const session = new MeetingSession({
      getDocument: () => root.DashboardMeeting.getDocument(),
      showTarget: state => root.DashboardMeeting.showTarget(state),
      onStatus: (kind, message) => {
        status.textContent = message || labels[kind];
        status.dataset.state = kind;
        el('meeting-send').hidden = !session?.active || session.role !== 'admin';
        el('meeting-return').hidden = !session?.active || session.role !== 'viewer' || !session.browsing;
        el('meeting-open').textContent = session?.active ? `회의 ${session.room}` : '회의 연결';
        el('meeting-leave').hidden = !session?.active;
      },
      request: async (room, body, key) => {
        if (!endpoint) throw new Error('실시간 회의는 서버 설정 후 Netlify에서 사용할 수 있습니다. 배포 안내를 확인해주세요.');
        const url = new URL(endpoint, location.href);
        url.searchParams.set('room', room);
        const response = await fetch(url, {
          method: body ? 'POST' : 'GET', cache: 'no-store',
          headers: body ? { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` } : {},
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(10000)
        });
        let result;
        try { result = await response.json(); } catch { throw new Error('회의 서버가 없습니다. Functions를 포함해 Netlify에 배포해주세요.'); }
        if (!response.ok) throw new Error(result.error || '회의 서버 연결에 실패했습니다.');
        return result;
      }
    });
    let timer;
    let ticking = false;
    const tick = async () => {
      if (ticking) return;
      ticking = true;
      clearTimeout(timer);
      try { await session.poll(); } finally { ticking = false; }
      if (session.active) timer = setTimeout(tick, session.connectionLost ? 4000 : 1500);
    };
    const shareLink = room => {
      const url = new URL(location.href);
      url.search = '';
      url.hash = '';
      url.searchParams.set('room', room);
      return url.href;
    };
    const join = async (room, key) => {
      await session.join(room, key);
      if (!session.active) return;
      el('meeting-link').value = shareLink(room);
      const url = new URL(location.href);
      url.searchParams.set('room', room);
      history.replaceState(null, '', url);
      if (key) await session.navigate(root.DashboardMeeting.getTarget());
      tick();
    };
    el('meeting-open').onclick = () => {
      el('meeting-error').textContent = '';
      el('meeting-room').value = session.room || new URL(location.href).searchParams.get('room') || 'meeting';
      dialog.showModal();
    };
    el('meeting-close').onclick = () => dialog.close();
    dialog.addEventListener('close', () => { el('meeting-key').value = ''; });
    form.onsubmit = async event => {
      event.preventDefault();
      const room = el('meeting-room').value.trim();
      const admin = event.submitter?.id === 'meeting-admin';
      const key = admin ? el('meeting-key').value.trim() : '';
      if (admin && !key) { el('meeting-error').textContent = '관리자 인증키를 입력해주세요.'; return; }
      const buttons = form.querySelectorAll('button[type="submit"]');
      buttons.forEach(button => { button.disabled = true; });
      try {
        await join(room, key);
        dialog.close();
      } catch (error) { el('meeting-error').textContent = error.message; }
      finally { buttons.forEach(button => { button.disabled = false; }); }
    };
    el('meeting-send').onclick = () => session.navigate(root.DashboardMeeting.getTarget());
    el('meeting-return').onclick = () => session.returnToAdmin().catch(error => session.onStatus('error', error.message));
    el('meeting-leave').onclick = () => {
      clearTimeout(timer);
      session.leave();
      const url = new URL(location.href);
      url.searchParams.delete('room');
      history.replaceState(null, '', url);
      el('meeting-link').value = '';
      dialog.close();
    };
    el('meeting-copy').onclick = async () => {
      const input = el('meeting-link');
      if (!input.value) { el('meeting-error').textContent = '회의에 연결한 뒤 주소를 복사해주세요.'; return; }
      try { await navigator.clipboard.writeText(input.value); el('meeting-error').textContent = '이용자 접속 주소를 복사했습니다.'; }
      catch { input.focus(); input.select(); el('meeting-error').textContent = '선택된 주소를 복사해주세요.'; }
    };
    root.addEventListener('dashboard-navigation', event => session.navigate(event.detail));
    root.addEventListener('dashboard-document-ready', () => {
      // A newly opened local document must not suppress the next admin move.
      if (session.active && session.role === 'viewer') session.browsing = true;
      if (session.active && session.role === 'admin') session.navigate(root.DashboardMeeting.getTarget());
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && session.active) tick(); });
    root.addEventListener('online', () => { if (session.active) tick(); });
    root.addEventListener('pagehide', () => { clearTimeout(timer); });
    root.addEventListener('pageshow', () => { if (session.active) tick(); });
    session.onStatus('offline');
    const room = new URL(location.href).searchParams.get('room');
    if (room) join(room, '').catch(error => session.onStatus('error', error.message));
  });
})(typeof window === 'undefined' ? globalThis : window);
