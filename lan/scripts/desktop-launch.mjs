import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { saveAdminKey } from './server-settings.mjs';
import { createLocalServer } from './local-server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
try { process.loadEnvFile(envFile); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const port = Number(process.env.DASHBOARD_PORT ?? 8888);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid DASHBOARD_PORT');
async function reopenExistingServer() {
  if (!port) return;
  try {
    const base = `http://127.0.0.1:${port}`;
    const response = await fetch(base + '/__local/health', { signal: AbortSignal.timeout(3000) });
    const health = response.ok ? await response.json() : null;
    if (!health?.ok || health.application !== 'question-dashboard' || !health.lan) return;
    const page = await fetch(base + '/server-manager.html', { signal: AbortSignal.timeout(3000) });
    if (!page.ok || !page.headers.get('content-type')?.includes('text/html')) return;
    console.log(JSON.stringify({ ready: true, reused: true, url: base + '/server-manager.html' }));
    process.exit(0);
  } catch { /* Another application, an unavailable server, or an older unsupported build. */ }
}
// Reopen before generating settings or touching this installation's data.
await reopenExistingServer();
if (!process.env.MEETING_ADMIN_KEY || process.env.MEETING_ADMIN_KEY.length < 6 || process.env.MEETING_ADMIN_KEY.startsWith('replace_with_')) {
  const key = randomBytes(12).toString('base64url');
  let text = '';
  try { text = await fs.readFile(envFile, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const line = `MEETING_ADMIN_KEY="${key}"`;
  text = /^\s*MEETING_ADMIN_KEY\s*=/m.test(text) ? text.replace(/^\s*MEETING_ADMIN_KEY\s*=.*$/m, line) : `${text}\n${line}\n`;
  await fs.writeFile(envFile, text, 'utf8');
  process.env.MEETING_ADMIN_KEY = key;
}

let stopping = false;
const running = createLocalServer({ lan: true, saveAdminKey: async key => { await saveAdminKey(envFile, key); process.env.MEETING_ADMIN_KEY = key; }, dataDirectory: process.env.DASHBOARD_DATA_DIRECTORY || path.join(root, 'server-data'),
  onFirewall: actualPort => new Promise((resolve, reject) => {
    const command = "$ErrorActionPreference = 'Stop'; $taskArgs = @('-NoProfile','-ExecutionPolicy','Bypass','-File', ('\"{0}\"' -f $env:DASHBOARD_FIREWALL_SCRIPT), '-Port', $env:DASHBOARD_FIREWALL_PORT); $taskProcess = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList $taskArgs; exit $taskProcess.ExitCode";
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true, stdio: 'ignore',
      env: { ...process.env, DASHBOARD_FIREWALL_SCRIPT: path.join(root, 'scripts/allow-server-firewall.ps1'), DASHBOARD_FIREWALL_PORT: String(actualPort) } });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error('Firewall setup incomplete')));
  }),
  onShutdown: () => {
    if (stopping) return;
    stopping = true;
    running.closeConnections();
    running.server.closeAllConnections();
    running.server.close(() => process.exit(0));
  } });
running.server.on('error', async error => {
  // Another launcher may have started the server after the initial check.
  if (error.code === 'EADDRINUSE') await reopenExistingServer();
  console.log(JSON.stringify({ error: error.code === 'EADDRINUSE' ? 'Port is already in use. Set DASHBOARD_PORT in .env.' : 'Could not start server. Check folder permissions and port.' }));
  process.exit(1);
});
running.server.listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({ ready: true, url: `http://127.0.0.1:${running.server.address().port}/server-manager.html` }));
});
