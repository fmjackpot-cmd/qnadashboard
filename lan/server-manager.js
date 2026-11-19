(function (root) {
  'use strict';
  root.document.addEventListener('DOMContentLoaded', () => {
    const el = id => root.document.getElementById(id);
    let stopped = false, refreshing = false;
    const status = (message, error = false) => { el('feedback').textContent = message; el('feedback').dataset.error = String(error); };
    const api = async (route, body) => {
      const response = await root.fetch('/__local/owner/' + route, { method: body ? 'POST' : 'GET',
        cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(route === 'firewall' ? 120000 : 10000) });
      if (response.status === 403) throw new Error('서버 PC에서 DashboardServer.exe를 실행해 관리 화면을 열어주세요.');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '서버에 연결하지 못했습니다.');
      return result;
    };
    const copy = async value => {
      try { await root.navigator.clipboard.writeText(value); status('복사했습니다.'); }
      catch { status('자동 복사가 지원되지 않습니다. 표시된 값을 선택해 복사해주세요.', true); }
    };
    const refresh = async () => {
      if (stopped || refreshing) return;
      refreshing = true;
      try {
        const result = await api('meetings');
        if (result.role !== 'super') throw new Error('서버 PC의 로컬 관리 화면에서만 사용할 수 있습니다.');
        el('rooms').replaceChildren();
        el('room-count').textContent = `개설 중 ${result.rooms.filter(room => !room.closedAt).length}개 · 전체 ${result.rooms.length}개`;
        for (const room of result.rooms) {
          const row = root.document.createElement('tr');
          for (const text of [room.room, room.closedAt ? '종료' : '개설 중', room.documentName || '']) {
            const cell = root.document.createElement('td'); cell.textContent = text; row.append(cell);
          }
          const action = root.document.createElement('td');
          if (!room.closedAt) {
            const button = root.document.createElement('button'); button.type = 'button'; button.className = 'danger'; button.textContent = '강제종료';
            button.onclick = async () => {
              if (!root.confirm(`“${room.room}” 회의를 종료할까요? 참가자가 퇴장하며 같은 이름으로 다시 개설할 수 없습니다.`)) return;
              button.disabled = true;
              try { await api('meetings', { action: 'close', room: room.room }); await refresh(); status('회의를 종료했습니다.'); }
              catch (error) { status(error.message, true); button.disabled = false; }
            };
            action.append(button);
          }
          row.append(action); el('rooms').append(row);
        }
      } catch (error) { status(error.message, true); }
      finally { refreshing = false; }
    };
    el('refresh').onclick = refresh;
    el('show-key').onchange = () => { el('admin-key').type = el('show-key').checked ? 'text' : 'password'; };
    el('copy-key').onclick = () => copy(el('admin-key').value);
    el('change-key-form').onsubmit = async event => {
      event.preventDefault();
      const key = el('new-admin-key').value;
      if (key !== el('confirm-admin-key').value) { status('새 인증키와 확인 값이 일치하지 않습니다.', true); return; }
      el('change-key').disabled = true;
      try {
        await api('admin-key', { newKey: key }); el('admin-key').value = key;
        el('new-admin-key').value = el('confirm-admin-key').value = '';
        status('관리자 인증키를 변경했습니다. 회의 관리자에게 새 키를 전달해주세요.');
      } catch (error) { status(error.message, true); }
      finally { el('change-key').disabled = false; }
    };
    el('firewall').onclick = async () => {
      el('firewall').disabled = true;
      try { await api('firewall', {}); status('접속 허용을 설정했습니다. 다른 PC에서 다시 접속해주세요.'); }
      catch (error) { status(error.message, true); }
      finally { el('firewall').disabled = false; }
    };
    el('shutdown').onclick = async () => {
      if (!root.confirm('서버를 종료할까요? 모든 참가자의 연결이 끊깁니다.')) return;
      el('shutdown').disabled = true;
      try {
        await api('shutdown', {}); stopped = true; el('management').hidden = true;
        el('admin-key').value = ''; status('서버를 종료했습니다. 다시 시작하려면 DashboardServer.exe를 실행하세요.');
      } catch (error) { status(error.message, true); el('shutdown').disabled = false; }
    };
    (async () => {
      try {
        const info = await api('info');
        el('admin-key').value = info.adminKey;
        el('change-key-form').hidden = !info.keyChangeAvailable;
        el('shutdown').disabled = !info.shutdownAvailable;
        el('firewall').disabled = !info.firewallAvailable;
        el('addresses').replaceChildren();
        for (const url of info.urls) {
          const row = root.document.createElement('div'); row.className = 'row';
          const address = root.document.createElement('span'); address.className = 'address'; address.textContent = url;
          const button = root.document.createElement('button'); button.textContent = '주소 복사'; button.type = 'button'; button.className = 'secondary'; button.onclick = () => copy(url);
          row.append(address, button); el('addresses').append(row);
        }
        if (!info.urls.length) el('addresses').textContent = '네트워크 연결을 확인해주세요. 현재 다른 PC에 전달할 주소가 없습니다.';
        el('management').hidden = false; status('서버 실행 중 · 브라우저를 닫아도 계속 실행됩니다.');
        await refresh();
      } catch (error) { status(error.message, true); }
    })();
  });
})(typeof window === 'undefined' ? globalThis : window);
