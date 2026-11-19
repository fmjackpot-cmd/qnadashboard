const form = document.getElementById('login');
const password = document.getElementById('password');
const management = document.getElementById('management');
const list = document.getElementById('meetings');
const feedback = document.getElementById('feedback');
const endpoint = '/.netlify/functions/meeting-supervisor';

async function request({ action, room, key } = {}) {
  const url = new URL(endpoint, location.origin);
  if (action) url.searchParams.set('action', action);
  if (room) url.searchParams.set('room', room);
  const response = await fetch(url, {
    method: action ? 'POST' : 'GET',
    headers: key ? { 'Content-Type': 'application/json' } : {},
    body: key ? JSON.stringify({ password: key }) : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(15000)
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) {
      management.hidden = true;
      form.hidden = false;
      list.replaceChildren();
    }
    throw new Error(result.error);
  }
  return result;
}

function render(meetings) {
  list.replaceChildren();
  management.hidden = false;
  form.hidden = true;
  for (const { room, name, updatedAt } of meetings) {
    const item = document.createElement('li');
    const detail = document.createElement('div');
    const heading = document.createElement('strong');
    heading.textContent = room;
    const subtitle = document.createElement('div');
    subtitle.textContent = name + ' · ' + new Date(updatedAt).toLocaleString('ko-KR');
    detail.append(heading, subtitle);
    const button = document.createElement('button');
    button.className = 'danger';
    button.textContent = '강제종료';
    button.onclick = async () => {
      if (!confirm('“' + room + '” 회의를 종료할까요?')) return;
      button.disabled = true;
      try {
        const { notified } = await request({ action: 'close', room });
        item.remove();
        feedback.textContent = notified === false
          ? '회의를 종료했습니다. 접속 중인 참여자에게 즉시 알리지 못했습니다.'
          : '회의를 종료했습니다.';
        if (!list.children.length) emptyList();
      } catch (error) {
        feedback.textContent = error.message;
        button.disabled = false;
      }
    };
    item.append(detail, button);
    list.append(item);
  }
  if (!meetings.length) emptyList();
}

function emptyList() {
  const item = document.createElement('li');
  item.textContent = '열려 있는 회의가 없습니다.';
  list.append(item);
}

async function refresh() {
  try {
    render((await request()).meetings);
    feedback.textContent = '';
  } catch (error) { feedback.textContent = error.message; }
}

form.onsubmit = async event => {
  event.preventDefault();
  const key = password.value;
  password.value = '';
  try {
    await request({ action: 'login', key });
    await refresh();
  } catch (error) { feedback.textContent = error.message; }
};
document.getElementById('refresh').onclick = refresh;
document.getElementById('logout').onclick = async () => {
  try {
    await request({ action: 'logout' });
    management.hidden = true;
    list.replaceChildren();
    form.hidden = false;
    feedback.textContent = '로그아웃했습니다.';
  } catch (error) { feedback.textContent = error.message; }
};
refresh();
