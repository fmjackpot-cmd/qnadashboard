(function (root) {
  'use strict';

  class MeetingSession {
    constructor({ request, subscribe, getDocument, showTarget, onStatus = () => {} }) {
      Object.assign(this, { request, subscribe, getDocument, showTarget, onStatus });
      this.generation = 0;
      this.active = false;
      this.lastRevision = null;
      this.sendQueue = Promise.resolve();
      this.applyQueue = Promise.resolve();
    }

    async join(room, key = '') {
      this.leave();
      const generation = this.generation;
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(room)) throw new Error('회의 코드는 영문·숫자·밑줄·하이픈 1~64자로 입력해주세요.');
      if (key) await this.request(room, { action: 'authenticate' }, key);
      if (generation !== this.generation) return;
      Object.assign(this, { active: true, room, key, role: key ? 'admin' : 'viewer', lastRevision: null,
        lastState: null, pendingState: null, latestSequence: 0, browsing: false, connectionLost: false });
      this.onStatus(key ? 'admin' : 'waiting');
      if (key) return; // Presenters publish over HTTP; no subscription or heartbeat needed.
      try {
        const stop = await this.subscribe(room, {
          onState: state => { if (generation === this.generation) this.receive(state); },
          onReconnect: () => { if (generation === this.generation) return this.sync(); },
          onConnection: (connected, state) => {
            if (generation !== this.generation) return;
            this.connectionLost = !connected;
            if (!connected) this.onStatus('error', state === 'failed'
              ? '실시간 연결에 실패했습니다. 회의 연결에서 다시 접속해주세요.'
              : '실시간 연결이 끊겼습니다. 자동으로 다시 연결하는 중입니다.');
          }
        });
        if (generation !== this.generation) { stop(); return; }
        this.stopSubscription = stop;
        // Subscribe first, then fetch once: a move during this read is protected
        // by its increasing sequence, so an older snapshot cannot rewind viewers.
        await this.sync();
      } catch (error) {
        if (generation === this.generation) { this.leave(); throw error; }
      }
    }

    leave() {
      this.generation++;
      if (this.stopSubscription) this.stopSubscription();
      this.stopSubscription = null;
      this.active = false;
      this.key = '';
      this.onStatus('offline');
    }

    async sync() {
      if (!this.active || this.role !== 'viewer') return;
      const generation = this.generation;
      try {
        const { state } = await this.request(this.room);
        if (generation !== this.generation) return;
        if (state) await this.receive(state);
        else if (!this.lastState) this.onStatus('waiting');
        this.connectionLost = false;
      } catch (error) {
        if (generation === this.generation) {
          this.connectionLost = true;
          this.onStatus('error', error.message);
        }
      }
    }

    receive(state) {
      if (!this.active || this.role !== 'viewer' || !state ||
          !Number.isSafeInteger(state.sequence) || state.sequence < 1 ||
          typeof state.revision !== 'string' || !/^[a-f0-9]{64}$/.test(state.documentId || '') ||
          !['question', 'toc'].includes(state.mode) ||
          (state.mode === 'question' && (!Number.isSafeInteger(state.questionId) || state.questionId < 1))) return Promise.resolve();
      if (state.sequence <= this.latestSequence) {
        if (state.sequence === this.latestSequence && this.pendingState?.revision === state.revision && this.lastRevision !== state.revision) return this.applyPending();
        if (this.connectionLost && this.lastRevision === state.revision) this.onStatus(this.browsing ? 'browsing' : 'following');
        return Promise.resolve();
      }
      this.latestSequence = state.sequence;
      this.pendingState = state;
      return this.applyPending();
    }

    applyPending(force = false) {
      const generation = this.generation;
      this.applyQueue = this.applyQueue.catch(() => {}).then(async () => {
        if (!this.active || generation !== this.generation || !this.pendingState) return;
        const state = this.pendingState;
        if (!force && state.revision === this.lastRevision) return;
        if (!this.getDocument().ready) { this.onStatus('loading'); return; }
        try {
          this.onStatus('switching');
          await this.showTarget(state);
          if (generation !== this.generation) return;
          this.lastRevision = state.revision;
          this.lastState = state;
          this.browsing = false;
          this.connectionLost = false;
          this.onStatus('following');
        } catch (error) {
          if (generation === this.generation) this.onStatus('error', error.message);
        }
      });
      return this.applyQueue;
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
      await this.applyPending(true);
    }
  }

  function createAblySubscriber({ loadSdk, getToken }) {
    return async (room, { onState, onReconnect, onConnection }) => {
      const { channel: channelName, tokenRequest } = await getToken(room);
      const Ably = await loadSdk();
      let firstToken = tokenRequest;
      const realtime = new Ably.Realtime({
        authCallback: (_, callback) => {
          if (firstToken) { const token = firstToken; firstToken = null; callback(null, token); return; }
          getToken(room).then(result => {
            if (result.channel !== channelName) throw new Error('회의 배포가 변경되었습니다. 새로고침 후 연결해주세요.');
            callback(null, result.tokenRequest);
          }).catch(error => callback(error, null));
        },
        autoConnect: false
      });
      const channel = realtime.channels.get(channelName);
      let stopped = false, connectedBefore = false, attachedBefore = false;
      const stop = () => {
        if (stopped) return;
        stopped = true;
        channel.unsubscribe();
        channel.off();
        realtime.connection.off();
        realtime.close();
      };
      realtime.connection.on('connected', () => {
        if (stopped) return;
        onConnection(true);
        if (connectedBefore) onReconnect();
        connectedBefore = true;
      });
      for (const state of ['disconnected', 'suspended', 'failed']) {
        realtime.connection.on(state, () => { if (!stopped) onConnection(false, state); });
      }
      channel.on('attached', change => {
        if (!stopped && attachedBefore && !change.resumed) onReconnect();
        attachedBefore = true;
      });
      channel.on('failed', () => { if (!stopped) onConnection(false, 'failed'); });
      let connectTimeout;
      try {
        const subscribed = channel.subscribe('navigate', message => { if (!stopped) onState(message.data); });
        const deadline = new Promise((_, reject) => {
          connectTimeout = setTimeout(() => reject(new Error('실시간 연결 시간이 초과되었습니다. 네트워크를 확인하고 다시 연결해주세요.')), 20000);
        });
        realtime.connect();
        await Promise.race([subscribed, deadline]);
        return stop;
      } catch (error) { stop(); throw error; }
      finally { clearTimeout(connectTimeout); }
    };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { MeetingSession, createAblySubscriber };
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
    const request = async (room, body, key, action) => {
      if (!endpoint) throw new Error('실시간 회의는 서버 설정 후 Netlify에서 사용할 수 있습니다. 배포 안내를 확인해주세요.');
      const url = new URL(endpoint, location.href);
      url.searchParams.set('room', room);
      if (action) url.searchParams.set('action', action);
      const response = await fetch(url, {
        method: body ? 'POST' : 'GET', cache: 'no-store',
        headers: body ? { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` } : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000)
      });
      let result;
      try { result = await response.json(); } catch { throw new Error('회의 서버가 없습니다. Functions를 포함해 Netlify에 배포해주세요.'); }
      if (!response.ok) throw new Error(result.error || '회의 서버 연결에 실패했습니다.');
      return result;
    };
    let sdkLoading;
    const loadSdk = () => {
      if (root.Ably) return Promise.resolve(root.Ably);
      if (!sdkLoading) sdkLoading = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = root.DASHBOARD_CONFIG?.meetingSdk || './vendor/ably.min.js';
        script.onload = () => root.Ably ? resolve(root.Ably) : reject(new Error('Ably SDK를 불러오지 못했습니다.'));
        script.onerror = () => { script.remove(); sdkLoading = null; reject(new Error('실시간 연결 모듈을 불러오지 못했습니다. 새로고침 후 다시 연결해주세요.')); };
        document.head.appendChild(script);
      });
      return sdkLoading;
    };
    const session = new MeetingSession({
      request,
      subscribe: createAblySubscriber({ loadSdk, getToken: room => request(room, null, null, 'token') }),
      getDocument: () => root.DashboardMeeting.getDocument(),
      showTarget: state => root.DashboardMeeting.showTarget(state),
      onStatus: (kind, message) => {
        status.textContent = message || labels[kind];
        status.dataset.state = kind;
        el('meeting-send').hidden = !session?.active || session.role !== 'admin';
        el('meeting-return').hidden = !session?.active || session.role !== 'viewer' || !session.browsing;
        el('meeting-open').textContent = session?.active ? `회의 ${session.room}` : '회의 연결';
        el('meeting-leave').hidden = !session?.active;
      }
    });
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
      if (session.active && session.role === 'viewer') session.applyPending();
      if (session.active && session.role === 'admin') session.navigate(root.DashboardMeeting.getTarget());
    });
    // Ably handles transport reconnection; only a restored page needs a catch-up
    // read. No polling loop, heartbeat fetch, or visibility timer hits Netlify.
    root.addEventListener('pagehide', () => {
      if (session.stopSubscription) session.stopSubscription();
      session.stopSubscription = null;
    });
    root.addEventListener('pageshow', event => {
      if (event.persisted && session.active) join(session.room, session.key).catch(error => session.onStatus('error', error.message));
    });
    session.onStatus('offline');
    const room = new URL(location.href).searchParams.get('room');
    if (room) join(room, '').catch(error => session.onStatus('error', error.message));
  });
})(typeof window === 'undefined' ? globalThis : window);
