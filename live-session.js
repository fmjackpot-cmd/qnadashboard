(function (root) {
  'use strict';

  async function uploadPdfParts({ room, file, key, endpoint, documentType = 'questions', fetcher = root.fetch.bind(root), crypto = root.crypto, onProgress = () => {} }) {
    const url = new URL(endpoint);
    url.searchParams.set('room', room);
    const send = async (target, body, headers = {}) => {
      const response = await fetcher(target, { method: 'POST', body, signal: AbortSignal.timeout(60000),
        headers: { Authorization: `Bearer ${key}`, ...headers } });
      let result;
      try { result = await response.json(); } catch { throw new Error('업로드 응답을 확인하지 못했습니다. 다시 시도해주세요.'); }
      if (!response.ok) throw new Error(result.error || 'PDF 업로드에 실패했습니다.');
      return result;
    };
    if (file.size <= 4500000) return send(url, file, { 'Content-Type': 'application/pdf', 'X-Pdf-Name': encodeURIComponent(file.name), 'X-Document-Type': documentType });
    if (file.size > 50000000) throw new Error('PDF는 최대 50MB까지 업로드할 수 있습니다.');
    const bytes = await file.arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    const id = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
    url.searchParams.set('action', 'init');
    const init = await send(url, JSON.stringify({ name: file.name, size: file.size, id, documentType }), { 'Content-Type': 'application/json' });
    url.searchParams.set('upload', init.uploadId);
    for (let part = 0; part < init.parts; part++) {
      url.searchParams.set('action', 'part');
      url.searchParams.set('part', part);
      onProgress(`PDF 업로드 중 · ${part + 1}/${init.parts}`);
      await send(url, file.slice(part * init.partBytes, (part + 1) * init.partBytes), { 'Content-Type': 'application/octet-stream' });
    }
    url.searchParams.set('action', 'complete');
    url.searchParams.delete('part');
    onProgress('PDF 원본 검증 중...');
    return send(url, '');
  }

  class MeetingSession {
    constructor({ request, subscribe, uploadFile, showDocument, getTarget, getDocument, showTarget, onStatus = () => {} }) {
      Object.assign(this, { request, subscribe, uploadFile, showDocument, getTarget, getDocument, showTarget, onStatus });
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
        lastState: null, pendingState: null, sharedDocument: null, latestSequence: 0, browsing: false, connectionLost: false });
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
        if (!this.getDocument().ready && !state.document) { this.onStatus('loading'); return; }
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
      if (this.documentBusy) return Promise.resolve();
      const generation = this.generation;
      const doc = this.getDocument();
      if (!doc.ready || !doc.hosted || !doc.id) {
        this.onStatus('error', '먼저 PDF를 회의 자료로 업로드해주세요.');
        return Promise.resolve();
      }
      // Serialize writes so a slow earlier request cannot overwrite a later move.
      this.sendQueue = this.sendQueue.catch(() => {}).then(async () => {
        if (generation !== this.generation) return;
        this.onStatus('sending');
        try {
          const newDocument = doc.shared && this.sharedDocument?.fileId !== doc.shared.fileId;
          const { state } = await this.request(this.room, { ...target, documentId: doc.id,
            ...(newDocument ? { action: 'set-document', fileId: doc.shared.fileId } : {}) }, this.key);
          if (generation !== this.generation) return;
          this.lastRevision = state.revision;
          if (doc.shared) this.sharedDocument = doc.shared;
          this.connectionLost = false;
          this.onStatus('admin');
        } catch (error) {
          if (generation === this.generation) this.onStatus('error', `${error.message} ‘현재 화면 전송’으로 다시 시도해주세요.`);
        }
      });
      return this.sendQueue;
    }

    async shareFile(file) {
      if (!this.active || this.role !== 'admin') throw new Error('관리자로 회의에 연결해주세요.');
      if (this.documentBusy) throw new Error('자료를 처리하는 중입니다. 완료 후 다시 선택해주세요.');
      if (!file || !file.size || (!file.name?.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf')) throw new Error('회의에 사용할 PDF 파일을 선택해주세요.');
      if (file.size > 50000000) throw new Error('PDF는 최대 50MB까지 업로드할 수 있습니다.');
      const generation = this.generation;
      const room = this.room, key = this.key;
      this.documentBusy = true;
      this.onStatus('uploading');
      try {
        await this.sendQueue;
        if (generation !== this.generation) return;
        const { document } = await this.uploadFile(room, file, key);
        if (generation !== this.generation) return;
        await this.showDocument(document);
        if (generation !== this.generation) return;
        const { state } = await this.request(room, { ...this.getTarget(), action: 'set-document', fileId: document.fileId, documentId: document.id }, key);
        if (generation !== this.generation) return;
        this.lastRevision = state.revision;
        this.sharedDocument = document;
        this.onStatus('admin');
        return state;
      } catch (error) {
        if (generation === this.generation) this.onStatus('error', error.message);
        throw error;
      } finally { this.documentBusy = false; }
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

  if (typeof module !== 'undefined' && module.exports) module.exports = { MeetingSession, createAblySubscriber, uploadPdfParts };
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
      uploading: '회의 PDF 업로드·확인 중 · 완료되면 참여자에게 적용됩니다',
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
    let roleMode = 'viewer';
    let pendingStartFile = null;
    const session = new MeetingSession({
      request,
      getTarget: () => root.DashboardMeeting.getTarget(),
      showDocument: descriptor => root.DashboardMeeting.showDocument(descriptor),
      uploadFile: async (room, file, key) => {
        const url = new URL(root.DASHBOARD_CONFIG?.meetingDocumentEndpoint || '/.netlify/functions/meeting-document', location.href);
        return uploadPdfParts({ room, file, key, endpoint: url, documentType: el('meeting-type-receipt').checked ? 'receipt' : 'questions',
          onProgress: message => session.onStatus('uploading', message) });
      },
      subscribe: createAblySubscriber({ loadSdk, getToken: room => request(room, null, null, 'token') }),
      getDocument: () => root.DashboardMeeting.getDocument(),
      showTarget: state => root.DashboardMeeting.showTarget(state),
      onStatus: (kind, message) => {
        status.textContent = message || labels[kind];
        status.dataset.state = kind;
        el('meeting-send').hidden = !session?.active || session.role !== 'admin';
        el('meeting-return').hidden = !session?.active || session.role !== 'viewer' || !session.browsing;
        const button = el('meeting-open');
        button.dataset.state = kind;
        button.title = `${session?.active ? `회의 ${session.room} · ` : ''}${status.textContent} · 클릭하여 회의 설정`;
        button.ariaLabel = button.title;
        el('meeting-leave').hidden = !session?.active;
        el('meeting-sharing').hidden = !session?.active || session.role !== 'admin' || roleMode !== 'admin';
        el('start-status').dataset.state = kind;
        el('start-status').textContent = kind === 'offline'
          ? '참여자는 별도의 PDF 파일이나 관리자 키가 필요하지 않습니다.' : status.textContent;
      }
    });
    const shareLink = room => {
      const url = new URL(location.href);
      url.search = '';
      url.hash = '';
      url.searchParams.set('room', room);
      return url.href;
    };
    const join = async (room, key, file) => {
      if (key && !file) throw new Error('회의 PDF를 선택하거나 PDF를 먼저 열어주세요.');
      await session.join(room, key);
      if (!session.active) return;
      if (key) {
        try { await session.shareFile(file); }
        catch (error) { session.leave(); throw error; }
      }
      el('meeting-link').value = shareLink(room);
      const url = new URL(location.href);
      url.searchParams.set('room', room);
      history.replaceState(null, '', url);
    };
    const setRole = role => {
      roleMode = role === 'admin' ? 'admin' : 'viewer';
      el('meeting-heading').textContent = roleMode === 'admin' ? '관리자로 시작하기' : '회의 참여하기';
      el('meeting-admin-fields').hidden = roleMode !== 'admin';
      el('meeting-admin-fields').disabled = roleMode !== 'admin';
      el('meeting-viewer').hidden = roleMode === 'admin';
      el('meeting-key').required = roleMode === 'admin';
      el('meeting-role-admin').ariaPressed = String(roleMode === 'admin');
      el('meeting-role-viewer').ariaPressed = String(roleMode === 'viewer');
      el('meeting-sharing').hidden = !session.active || session.role !== 'admin' || roleMode !== 'admin';
    };
    const openMeeting = (role, file = null) => {
      setRole(role);
      const type = root.DashboardMeeting.getDocument().documentType;
      if (type) {
        el('meeting-type-receipt').checked = type === 'receipt';
        el('meeting-type-questions').checked = type !== 'receipt';
      }
      pendingStartFile = file;
      el('meeting-pdf').value = '';
      el('meeting-pdf-hint').textContent = file ? `선택한 자료: ${file.name} · 관리자 인증 후 업로드합니다.`
        : 'PDF를 선택하면 업로드 후 회의가 시작됩니다. 이미 문서가 열려 있다면 해당 PDF를 사용할 수 있습니다.';
      el('meeting-error').textContent = '';
      el('meeting-room').value = session.room || new URL(location.href).searchParams.get('room') || (roleMode === 'admin' ? 'meeting' : '');
      dialog.showModal();
      el('meeting-room').focus?.();
    };
    el('meeting-open').onclick = () => openMeeting(session.active ? session.role : roleMode);
    el('start-admin').onclick = () => openMeeting('admin');
    el('start-viewer').onclick = () => openMeeting('viewer');
    el('meeting-role-admin').onclick = () => setRole('admin');
    el('meeting-role-viewer').onclick = () => setRole('viewer');
    el('meeting-close').onclick = () => dialog.close();
    dialog.addEventListener('close', () => { el('meeting-key').value = ''; });
    form.onsubmit = async event => {
      event.preventDefault();
      const room = el('meeting-room').value.trim();
      const admin = roleMode === 'admin';
      const key = admin ? el('meeting-key').value.trim() : '';
      if (admin && !key) { el('meeting-error').textContent = '관리자 인증키를 입력해주세요.'; return; }
      const buttons = form.querySelectorAll('button[type="submit"]');
      buttons.forEach(button => { button.disabled = true; });
      try {
        const file = admin ? el('meeting-pdf').files?.[0] || pendingStartFile || root.DashboardMeeting.getFile() : null;
        await join(room, key, file);
        el('meeting-pdf').value = '';
        pendingStartFile = null;
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
      const shell = el('dashboard-shell');
      shell.dataset.starting = 'false';
      shell.inert = false;
      shell.ariaHidden = 'false';
      // A newly opened local document must not suppress the next admin move.
      if (session.active && session.role === 'viewer') session.browsing = true;
      if (session.active && session.role === 'viewer') session.applyPending();
    });
    root.MeetingFiles = {
      startWithFile(file) {
        if (root.DashboardMeeting.getDocument().ready || session.active) return false;
        openMeeting('admin', file);
        return true;
      },
      isAdmin: () => session.active && session.role === 'admin',
      async share(file) {
        try { return await session.shareFile(file); }
        catch (error) {
          setRole('admin');
          el('meeting-error').textContent = error.message;
          if (!dialog.open) dialog.showModal();
          throw error;
        }
      }
    };
    // Ably handles transport reconnection; only a restored page needs a catch-up
    // read. No polling loop, heartbeat fetch, or visibility timer hits Netlify.
    root.addEventListener('pagehide', () => {
      if (session.stopSubscription) session.stopSubscription();
      session.stopSubscription = null;
    });
    root.addEventListener('pageshow', event => {
      if (event.persisted && session.active && session.role === 'viewer') join(session.room, '').catch(error => session.onStatus('error', error.message));
    });
    setRole('viewer');
    session.onStatus('offline');
    const room = new URL(location.href).searchParams.get('room');
    if (room) join(room, '').catch(error => session.onStatus('error', error.message));
  });
})(typeof window === 'undefined' ? globalThis : window);
