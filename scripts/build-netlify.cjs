const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = process.argv[2] || 'web';
if (!['web', 'lan'].includes(target)) throw new Error('Expected build target web or lan');
const lan = target === 'lan';
const lanRoot = path.join(root, 'lan');
const out = path.join(lan ? lanRoot : root, 'netlify-deploy');
const ablyRoot = lan ? null : path.resolve(path.dirname(require.resolve('ably')), '..');
if (ablyRoot) for (const file of ['build/ably.min.js', 'LICENSE']) fs.accessSync(path.join(ablyRoot, file));
if (fs.lstatSync(out, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('Build directory must not be a symbolic link');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'vendor'), { recursive: true });
if (ablyRoot) {
  fs.copyFileSync(path.join(ablyRoot, 'build/ably.min.js'), path.join(out, 'vendor/ably.min.js'));
  fs.copyFileSync(path.join(ablyRoot, 'LICENSE'), path.join(out, 'vendor/ABLY-LICENSE'));
}
for (const asset of ['app.js', 'style.css', 'manifest.json', 'message-media.js', 'sha256.js']) {
  fs.copyFileSync(path.join(root, asset), path.join(out, asset));
}
fs.copyFileSync(path.join(lan ? lanRoot : root, 'live-session.js'), path.join(out, 'live-session.js'));
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
if (lan) {
  html = html.replace('<body>', '<body class="lan">')
    .replace('회의 이름을 입력하면', '열려 있는 회의를 선택하면');
  for (const asset of ['server-manager.html', 'server-manager.js']) {
    fs.copyFileSync(path.join(lanRoot, asset), path.join(out, asset));
  }
}
if (!lan) {
  const link = '<a href="meeting-supervisor.html">회의 관리</a>';
  html = html.replace('<!-- web-supervisor-start -->', link)
    .replace('<!-- web-supervisor-info -->', '<a href="meeting-supervisor.html" target="_blank" rel="noopener">회의 관리</a>');
  for (const asset of ['meeting-supervisor.html', 'meeting-supervisor.js', 'meeting-supervisor.css']) {
    fs.copyFileSync(path.join(root, asset), path.join(out, asset));
  }
}
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, 'dashboard-config.js'), `window.DASHBOARD_CONFIG = ${JSON.stringify({
  meetingEndpoint: '/.netlify/functions/meeting', meetingDocumentEndpoint: '/.netlify/functions/meeting-document', ...(!lan && { meetingSdk: './vendor/ably.min.js' })
})};\n`);
fs.writeFileSync(path.join(out, '_headers'), `/*
  X-Content-Type-Options: nosniff
/*.html
  Cache-Control: public, max-age=0, must-revalidate
/app.js
  Cache-Control: public, max-age=0, must-revalidate
/live-session.js
  Cache-Control: public, max-age=0, must-revalidate
/message-media.js
  Cache-Control: public, max-age=0, must-revalidate
/dashboard-config.js
  Cache-Control: public, max-age=0, must-revalidate
`);
console.log(`배포 폴더 생성 완료: ${out}`);
