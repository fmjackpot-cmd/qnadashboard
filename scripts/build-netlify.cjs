const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'netlify-deploy');
const pdfName = '[제출] 2026년 행정사무감사 예상질의 답변서(행정과).pdf';
const pdfSource = path.join(root, 'example', pdfName);
if (!fs.existsSync(pdfSource)) throw new Error(`PDF 파일을 찾을 수 없습니다: ${pdfSource}`);
const ablyRoot = path.resolve(path.dirname(require.resolve('ably')), '..');
for (const file of ['build/ably.min.js', 'LICENSE']) fs.accessSync(path.join(ablyRoot, file));
// Recreate only the known generated directory; never copy secrets or repository files.
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'docs'), { recursive: true });
fs.mkdirSync(path.join(out, 'vendor'), { recursive: true });
fs.copyFileSync(path.join(ablyRoot, 'build/ably.min.js'), path.join(out, 'vendor/ably.min.js'));
fs.copyFileSync(path.join(ablyRoot, 'LICENSE'), path.join(out, 'vendor/ABLY-LICENSE'));
for (const asset of ['index.html', 'app.js', 'style.css', 'manifest.json', 'live-session.js']) {
  fs.copyFileSync(path.join(root, asset), path.join(out, asset));
}
fs.copyFileSync(pdfSource, path.join(out, 'docs/audit-2026.pdf'));
fs.writeFileSync(path.join(out, 'dashboard-config.js'), `window.DASHBOARD_CONFIG = ${JSON.stringify({
  defaultPdf: { url: './docs/audit-2026.pdf', name: pdfName }, meetingEndpoint: '/.netlify/functions/meeting', meetingDocumentEndpoint: '/.netlify/functions/meeting-document', meetingSdk: './vendor/ably.min.js'
})};\n`);
fs.writeFileSync(path.join(out, '_headers'), `/*
  X-Content-Type-Options: nosniff
/*.html
  Cache-Control: public, max-age=0, must-revalidate
/app.js
  Cache-Control: public, max-age=0, must-revalidate
/live-session.js
  Cache-Control: public, max-age=0, must-revalidate
/dashboard-config.js
  Cache-Control: public, max-age=0, must-revalidate
/docs/*
  Cache-Control: public, max-age=0, must-revalidate
`);
console.log(`배포 폴더 생성 완료: ${out}`);
