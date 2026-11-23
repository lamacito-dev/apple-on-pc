const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function runCommand(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      {
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024,
        timeout: options.timeout ?? 30000,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.trim() || error.message));
          return;
        }
        resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
      }
    );
  });
}

function runPowerShellEncoded(script) {
  const utf16le = Buffer.from(script, 'utf16le').toString('base64');
  return runCommand('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    utf16le,
  ]);
}

function sanitizeSegments(relativePath) {
  if (!relativePath || typeof relativePath !== 'string') return [];
  return relativePath
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== '.' && s !== '..');
}

function getDefaultSyncDir() {
  const dir = path.join(os.homedir(), 'OpenFS-iPhone-Sync');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function detectLibimobiledevice() {
  try {
    const { stdout } = await runCommand('idevice_id', ['-l'], { timeout: 4000 });
    const udids = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (udids.length === 0) return [];

    const devices = [];
    for (const udid of udids) {
      let name = 'Apple iPhone';
      let model = 'iPhone';
      try {
        const info = await runCommand('ideviceinfo', ['-u', udid, '-k', 'DeviceName'], {
          timeout: 4000,
        });
        if (info.stdout.trim()) name = info.stdout.trim();
        const prod = await runCommand('ideviceinfo', ['-u', udid, '-k', 'ProductType'], {
          timeout: 4000,
        });
        if (prod.stdout.trim()) model = prod.stdout.trim();
      } catch {
        // Device might not be trusted yet
      }
      devices.push({
        id: `afc:${udid}`,
        name,
        model,
        serialNumber: udid,
        backend: 'afc',
      });
    }
    return devices;
  } catch {
    return [];
  }
}

async function detectWindowsWpdDevices() {
  if (process.platform !== 'win32') return [];
  const ps = `
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject Shell.Application
$computer = $shell.Namespace(17)
$results = @()
foreach ($item in $computer.Items()) {
  if ($item.Name -match 'iPhone|iPad|Apple') {
    $results += [PSCustomObject]@{
      id = 'wpd:' + $item.Name
      name = $item.Name
      model = 'Apple iPhone (Windows WPD / MTP)'
      serialNumber = 'WPD-USB'
      backend = 'wpd'
    }
  }
}
$results | ConvertTo-Json -Depth 3 -Compress
`;

  try {
    const { stdout } = await runPowerShellEncoded(ps);
    const trimmed = stdout.trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

async function listIphoneDevices() {
  const [afcDevices, wpdDevices] = await Promise.all([
    detectLibimobiledevice(),
    detectWindowsWpdDevices(),
  ]);

  if (wpdDevices.length > 0) {
    return [...wpdDevices, ...afcDevices];
  }
  return afcDevices;
}

async function listWpdDirectory(deviceName, relativePath) {
  const segments = sanitizeSegments(relativePath);
  const segJson = JSON.stringify(segments);
  const devJson = JSON.stringify(deviceName);

  const ps = `
$ErrorActionPreference = 'Stop'
$devName = ${devJson} | ConvertFrom-Json
$segments = ${segJson} | ConvertFrom-Json
$shell = New-Object -ComObject Shell.Application
$computer = $shell.Namespace(17)
$deviceItem = $null
foreach ($it in $computer.Items()) {
  if ($it.Name -eq $devName) { $deviceItem = $it; break }
}
if (-not $deviceItem) { throw "iPhone introuvable dans Windows WPD : $devName" }
$folder = $deviceItem.GetFolder
foreach ($seg in $segments) {
  $found = $null
  foreach ($child in $folder.Items()) {
    if ($child.Name -eq $seg) { $found = $child; break }
  }
  if (-not $found) { throw "Dossier iPhone introuvable : $seg" }
  $folder = $found.GetFolder
}
$entries = @()
foreach ($entry in $folder.Items()) {
  $entries += [PSCustomObject]@{
    name = [string]$entry.Name
    kind = $(if ($entry.IsFolder) { 'folder' } else { 'file' })
    size = [int64]$entry.Size
    modifiedAt = [string]$entry.ModifyDate
    path = ($(if ($segments.Count -gt 0) { ($segments -join '/') + '/' + $entry.Name } else { $entry.Name }))
  }
}
$entries | ConvertTo-Json -Depth 3 -Compress
`;

  const { stdout } = await runPowerShellEncoded(ps);
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function copyWpdItemToPc(deviceName, relativePath, destPcDir) {
  const segments = sanitizeSegments(relativePath);
  if (segments.length === 0) {
    throw new Error('Chemin source iPhone vide.');
  }

  const resolvedDest = path.resolve(destPcDir);
  fs.mkdirSync(resolvedDest, { recursive: true });

  const parentSegments = segments.slice(0, -1);
  const targetName = segments[segments.length - 1];

  const ps = `
$ErrorActionPreference = 'Stop'
$devName = ${JSON.stringify(deviceName)} | ConvertFrom-Json
$parentSegs = ${JSON.stringify(parentSegments)} | ConvertFrom-Json
$targetName = ${JSON.stringify(targetName)} | ConvertFrom-Json
$destDir = ${JSON.stringify(resolvedDest)} | ConvertFrom-Json

$shell = New-Object -ComObject Shell.Application
$computer = $shell.Namespace(17)
$deviceItem = $null
foreach ($it in $computer.Items()) {
  if ($it.Name -eq $devName) { $deviceItem = $it; break }
}
if (-not $deviceItem) { throw "iPhone introuvable : $devName" }

$folder = $deviceItem.GetFolder
foreach ($seg in $parentSegs) {
  $found = $null
  foreach ($child in $folder.Items()) {
    if ($child.Name -eq $seg) { $found = $child; break }
  }
  if (-not $found) { throw "Dossier iPhone introuvable : $seg" }
  $folder = $found.GetFolder
}

$sourceItem = $null
foreach ($child in $folder.Items()) {
  if ($child.Name -eq $targetName) { $sourceItem = $child; break }
}
if (-not $sourceItem) { throw "Fichier iPhone introuvable : $targetName" }

$destFolder = $shell.Namespace($destDir)
if (-not $destFolder) { throw "Dossier destination introuvable : $destDir" }
# 16 = Respond Yes to All, 4 = No progress dialog
$destFolder.CopyHere($sourceItem, 20)
Write-Output (Join-Path $destDir $targetName)
`;

  const { stdout } = await runPowerShellEncoded(ps);
  return stdout.trim() || path.join(resolvedDest, targetName);
}

async function listIphoneDirectory(deviceId, relativePath = '') {
  if (typeof deviceId !== 'string' || !deviceId.includes(':')) {
    throw new Error('Identifiant de périphérique iPhone invalide.');
  }
  const [backend, ...rest] = deviceId.split(':');
  const rawId = rest.join(':');

  if (backend === 'wpd') {
    return listWpdDirectory(rawId, relativePath);
  }

  throw new Error(
    'Backend AFC détecté. Sous Linux, montez ~/iPhone-USB avec ifuse ; sous Windows, utilisez le périphérique WPD détecté.'
  );
}

async function copyFromIphoneToPc(deviceId, relativePath, destPcDir) {
  if (typeof deviceId !== 'string' || !deviceId.includes(':')) {
    throw new Error('Identifiant de périphérique iPhone invalide.');
  }
  const [backend, ...rest] = deviceId.split(':');
  const rawId = rest.join(':');

  if (backend === 'wpd') {
    return copyWpdItemToPc(rawId, relativePath, destPcDir || getDefaultSyncDir());
  }

  throw new Error('Copie directe disponible via Windows WPD natif.');
}

async function listPcDirectory(dirPath) {
  const targetDir = path.resolve(dirPath || getDefaultSyncDir());
  const dirents = await fs.promises.readdir(targetDir, { withFileTypes: true });
  const results = [];

  for (const dirent of dirents) {
    const fullPath = path.join(targetDir, dirent.name);
    try {
      const stat = await fs.promises.stat(fullPath);
      results.push({
        name: dirent.name,
        kind: dirent.isDirectory() ? 'folder' : 'file',
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        path: fullPath,
      });
    } catch {
      // Skip unreadable OS system entries
    }
  }
  return results;
}

module.exports = {
  getDefaultSyncDir,
  listIphoneDevices,
  listIphoneDirectory,
  copyFromIphoneToPc,
  listPcDirectory,
};
