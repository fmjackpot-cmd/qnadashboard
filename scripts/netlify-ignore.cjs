const { spawnSync } = require('node:child_process');

const { CACHED_COMMIT_REF: previous, COMMIT_REF: current } = process.env;
const isCommitHash = value => /^[0-9a-f]{40,64}$/i.test(value || '');

// Netlify also passes identical refs for uncached builds. Build in that case.
if (!isCommitHash(previous) || !isCommitHash(current) || previous === current) {
  process.exitCode = 1;
} else {
  // Disable rename detection so moves into or out of LAN are checked at both paths.
  const diff = spawnSync('git', [
    'diff', '--quiet', '--no-renames', previous, current, '--', '.',
    ':(exclude,top)lan/', ':(exclude,top)scripts/build-server-package.ps1'
  ], { stdio: 'inherit' });
  process.exitCode = diff.status === 0 ? 0 : 1;
}
