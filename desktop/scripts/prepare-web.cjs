const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const rootDist = path.join(rootDir, 'dist');
const localWebDist = path.join(__dirname, 'web-dist');

console.log('[OpenFS Desktop] Building React web bundle with relative desktop paths...');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
execFileSync(npmCmd, ['run', 'build'], {
  cwd: rootDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    DESKTOP_BUILD: 'true',
  },
});

if (!fs.existsSync(rootDist)) {
  throw new Error('Build failed: dist directory not found.');
}

fs.rmSync(localWebDist, { recursive: true, force: true });
fs.cpSync(rootDist, localWebDist, { recursive: true });
console.log('[OpenFS Desktop] Copied web bundle to desktop/web-dist.');
