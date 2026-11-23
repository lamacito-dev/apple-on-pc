const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const desktopDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(desktopDir, '..');
const rootDist = path.join(rootDir, 'dist');
const localWebDist = path.join(desktopDir, 'web-dist');

console.log('[OpenFS Desktop] Building React web bundle with relative desktop paths...');
execSync('npm run build', {
  cwd: rootDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    DESKTOP_BUILD: 'true',
  },
});

if (!fs.existsSync(rootDist)) {
  throw new Error(`Build failed: dist directory not found at ${rootDist}`);
}

fs.rmSync(localWebDist, { recursive: true, force: true });
fs.cpSync(rootDist, localWebDist, { recursive: true });
console.log(`[OpenFS Desktop] Copied web bundle to ${localWebDist}.`);
