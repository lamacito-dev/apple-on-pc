const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const JSON_START_MARKER = '<<<OPENFS_JSON_START>>>';
const JSON_END_MARKER = '<<<OPENFS_JSON_END>>>';

let activeScanPromise = null;

function runCommand(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      {
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 25 * 1024 * 1024,
        timeout: options.timeout ?? 30000,
        env: options.env ? { ...process.env, ...options.env } : process.env,
      },
      (error, stdout, stderr) => {
        if (error) {
          const msg = String(stderr || '').trim() || error.message;
          reject(new Error(msg));
          return;
        }
        resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
      }
    );
  });
}

function runPowerShellEncoded(script, payload = null, options = {}) {
  const preamble = [
    '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '$OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '$ErrorActionPreference = "Stop"',
  ].join('\n');

  const fullScript = `${preamble}\n${script}`;
  const utf16le = Buffer.from(fullScript, 'utf16le').toString('base64');

  const env = {};
  if (payload !== null && payload !== undefined) {
    env.OPENFS_PAYLOAD_B64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  }

  return runCommand(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-STA',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      utf16le,
    ],
    {
      timeout: options.timeout ?? 30000,
      env,
    }
  );
}

function parseMarkedJson(stdout, fallback = []) {
  const startIdx = stdout.lastIndexOf(JSON_START_MARKER);
  const endIdx = stdout.lastIndexOf(JSON_END_MARKER);
  let jsonText = '';

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    jsonText = stdout.slice(startIdx + JSON_START_MARKER.length, endIdx).trim();
  } else {
    jsonText = stdout.trim();
  }

  if (!jsonText || jsonText === 'null') return fallback;
  const parsed = JSON.parse(jsonText);
  return parsed;
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

function describeApplePid(pidHex) {
  const upper = String(pidHex || '').toUpperCase();
  if (upper === '0X12A8' || upper === '12A8') return 'Apple iPhone (USB-C / Lightning)';
  if (upper === '0X12AB' || upper === '12AB') return 'Apple iPad';
  if (upper === '0X1281' || upper === '1281') return 'Apple iPhone (Mode Récupération)';
  if (upper === '0X1227' || upper === '1227') return 'Apple iPhone (Mode DFU)';
  return 'Apple iPhone (USB)';
}

async function detectLibimobiledevice() {
  try {
    const { stdout } = await runCommand('idevice_id', ['-l'], { timeout: 3500 });
    const udids = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (udids.length === 0) return [];

    const devices = [];
    for (const udid of udids) {
      let name = 'Apple iPhone';
      let model = 'iPhone';
      let accessible = false;
      try {
        const info = await runCommand('ideviceinfo', ['-u', udid, '-k', 'DeviceName'], {
          timeout: 3500,
        });
        if (info.stdout.trim()) {
          name = info.stdout.trim();
          accessible = true;
        }
        const prod = await runCommand('ideviceinfo', ['-u', udid, '-k', 'ProductType'], {
          timeout: 3500,
        });
        if (prod.stdout.trim()) model = prod.stdout.trim();
      } catch {
        // Device is connected via usbmuxd but not paired/trusted yet
      }
      devices.push({
        id: `afc:${udid}`,
        name,
        model,
        serialNumber: udid,
        vendorId: '0x05AC',
        productId: '0x12A8',
        backend: 'afc',
        status: accessible ? 'ready' : 'locked',
        accessible,
        hint: accessible
          ? undefined
          : 'Déverrouillez votre iPhone et validez « Faire confiance à cet ordinateur ».',
      });
    }
    return devices;
  } catch {
    return [];
  }
}

async function detectWindowsDevices() {
  if (process.platform !== 'win32') return [];

  const ps = `
$wpdDevices = @()
$pnpDevices = @()

# Layer 1: Windows Shell WPD (Namespace 17 = "Ce PC" / "This PC")
# Matches ANY Apple device by VID_05AC in its WPD path OR by Apple/iPhone/iPad in its display name.
try {
  $shell = New-Object -ComObject Shell.Application
  $computer = $shell.Namespace(17)
  if ($null -ne $computer) {
    foreach ($item in $computer.Items()) {
      try {
        $itemName = [string]$item.Name
        $itemPath = [string]$item.Path
        $itemType = [string]$item.Type

        $isAppleByPath = ($itemPath -match 'vid_05ac') -or ($itemPath -match 'ven_apple')
        $isAppleByName = ($itemName -match 'iPhone|iPad|Apple')
        $isPortable = $itemPath.StartsWith('::{20D04FE0-3AEA-1069-A2D8-08002B30309D}\\') -or
                      ($itemType -match 'Portable|Périphérique mobile|Appareil photo|Digital Camera|Image')

        if ($isAppleByPath -or ($isAppleByName -and ($isPortable -or -not ($itemPath -match '^[A-Za-z]:\\\\')))) {
          $storageCount = 0
          $firstStorageName = ''
          try {
            $folder = $item.GetFolder
            if ($null -ne $folder) {
              $children = $folder.Items()
              if ($null -ne $children) {
                foreach ($childItem in $children) {
                  $storageCount++
                  if (-not $firstStorageName) {
                    $firstStorageName = [string]$childItem.Name
                  }
                }
              }
            }
          } catch {}

          $vendId = '0x05AC'
          $prodId = ''
          if ($itemPath -match 'vid_([0-9a-fA-F]{4})') {
            $vendId = '0x' + $Matches[1].ToUpper()
          }
          if ($itemPath -match 'pid_([0-9a-fA-F]{4})') {
            $prodId = '0x' + $Matches[1].ToUpper()
          }

          $wpdDevices += [PSCustomObject]@{
            wpdPath = $itemPath
            name = $itemName
            type = $itemType
            vendorId = $vendId
            productId = $prodId
            storageCount = $storageCount
            firstStorageName = $firstStorageName
          }
        }
      } catch {}
    }
  }
} catch {}

# Layer 2: Windows PnP USB Devices (VID_05AC)
# Detects plugged-in iPhones even when locked, untrusted, or not yet mounted in Explorer WPD.
try {
  $pnpList = Get-CimInstance -ClassName Win32_PnPEntity -Filter "PNPDeviceID LIKE '%VID_05AC%'" -ErrorAction SilentlyContinue
  if ($null -eq $pnpList) {
    $pnpList = Get-WmiObject -Class Win32_PnPEntity -Filter "PNPDeviceID LIKE '%VID_05AC%'" -ErrorAction SilentlyContinue
  }
  foreach ($pnp in $pnpList) {
    try {
      $devId = [string]$pnp.PNPDeviceID
      $pnpName = [string]$pnp.Name
      $pnpClass = [string]$pnp.PNPClass
      $pnpStatus = [string]$pnp.Status

      $pidHex = ''
      if ($devId -match 'PID_([0-9a-fA-F]{4})') {
        $pidHex = $Matches[1].ToUpper()
      }

      # Filter specifically for iOS / iPadOS devices (PIDs 1290..12AF, 1281, 1227) or Apple Mobile Device / iPhone / iPad names
      $isIosPid = ($pidHex -match '^12(9[0-9A-F]|A[0-9A-F]|81|27)$')
      $isIosName = ($pnpName -match 'iPhone|iPad|Apple Mobile Device')
      if ($isIosPid -or $isIosName) {
        $serial = ''
        $parts = $devId -split '\\\\'
        if ($parts.Length -ge 3) {
          $candidate = $parts[$parts.Length - 1]
          if ($candidate -and ($candidate -notmatch '^&')) {
            $serial = $candidate
          }
        }
        $pnpDevices += [PSCustomObject]@{
          pnpId = $devId
          name = $pnpName
          pnpClass = $pnpClass
          status = $pnpStatus
          vendorId = '0x05AC'
          productId = $(if ($pidHex) { '0x' + $pidHex } else { '0x12A8' })
          serialNumber = $serial
        }
      }
    } catch {}
  }
} catch {}

$output = [PSCustomObject]@{
  wpd = @($wpdDevices)
  pnp = @($pnpDevices)
}

Write-Output '${JSON_START_MARKER}'
ConvertTo-Json -InputObject $output -Depth 5 -Compress
Write-Output '${JSON_END_MARKER}'
`;

  try {
    const { stdout } = await runPowerShellEncoded(ps, null, { timeout: 15000 });
    const parsed = parseMarkedJson(stdout, { wpd: [], pnp: [] });
    const wpdList = Array.isArray(parsed.wpd) ? parsed.wpd : parsed.wpd ? [parsed.wpd] : [];
    const pnpList = Array.isArray(parsed.pnp) ? parsed.pnp : parsed.pnp ? [parsed.pnp] : [];

    // Extract best hardware serial & PID from PnP entries to enrich WPD entries
    const primaryPnp =
      pnpList.find((p) => p.serialNumber && p.serialNumber.length >= 8) || pnpList[0] || null;

    const results = [];

    for (const dev of wpdList) {
      const storageCount = Number(dev.storageCount || 0);
      const accessible = storageCount > 0;
      const pid = dev.productId || primaryPnp?.productId || '0x12A8';
      const serial = primaryPnp?.serialNumber || 'USB-WPD';
      const key = dev.wpdPath || dev.name;

      results.push({
        id: `wpd:${key}`,
        name: dev.name || 'Apple iPhone',
        model: describeApplePid(pid),
        serialNumber: serial,
        vendorId: dev.vendorId || '0x05AC',
        productId: pid,
        backend: 'wpd',
        status: accessible ? 'ready' : 'locked',
        accessible,
        storageCount,
        hint: accessible
          ? undefined
          : 'iPhone détecté dans Windows, mais son stockage est verrouillé. Déverrouillez votre iPhone et appuyez sur « Autoriser » ou « Faire confiance ».',
      });
    }

    // If WPD didn't mount anything yet, but Windows USB PnP sees an Apple iPhone/iPad plugged in:
    if (results.length === 0 && pnpList.length > 0) {
      const seenSerials = new Set();
      for (const pnp of pnpList) {
        const dedupeKey = (pnp.serialNumber || pnp.productId || 'apple-usb').toLowerCase();
        if (seenSerials.has(dedupeKey)) continue;
        seenSerials.add(dedupeKey);

        const friendlyName =
          pnp.name && !/USB Composite|Apple Mobile Device USB Driver/i.test(pnp.name)
            ? pnp.name
            : pnp.productId === '0x12AB'
              ? 'Apple iPad'
              : 'Apple iPhone';

        results.push({
          id: `usb_pnp:${pnp.serialNumber || pnp.pnpId}`,
          name: friendlyName,
          model: describeApplePid(pnp.productId),
          serialNumber: pnp.serialNumber || 'USB-C',
          vendorId: pnp.vendorId || '0x05AC',
          productId: pnp.productId || '0x12A8',
          backend: 'usb_pnp',
          status: 'locked',
          accessible: false,
          storageCount: 0,
          hint:
            'iPhone détecté sur le port USB de votre PC ! Déverrouillez son écran et appuyez sur « Autoriser » ou « Faire confiance à cet ordinateur » pour afficher ses fichiers.',
        });
      }
    }

    return results;
  } catch {
    return [];
  }
}

async function listIphoneDevices() {
  if (activeScanPromise) {
    return activeScanPromise;
  }

  activeScanPromise = (async () => {
    try {
      const [winDevices, afcDevices] = await Promise.all([
        detectWindowsDevices(),
        detectLibimobiledevice(),
      ]);

      if (winDevices.length > 0) {
        // Avoid duplicating the same iPhone if both Windows WPD/PnP and libimobiledevice see it
        const knownSerials = new Set(
          winDevices
            .map((d) => String(d.serialNumber || '').toLowerCase())
            .filter((s) => s && s !== 'usb-wpd' && s !== 'usb-c')
        );
        const extraAfc = afcDevices.filter(
          (d) => !knownSerials.has(String(d.serialNumber || '').toLowerCase())
        );
        return [...winDevices, ...extraAfc];
      }

      return afcDevices;
    } finally {
      activeScanPromise = null;
    }
  })();

  return activeScanPromise;
}

async function listWpdDirectory(deviceKey, relativePath) {
  const segments = sanitizeSegments(relativePath);

  const ps = `
$payloadJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($env:OPENFS_PAYLOAD_B64))
$payload = $payloadJson | ConvertFrom-Json
$devKey = [string]$payload.deviceKey
$segments = @($payload.segments)

$shell = New-Object -ComObject Shell.Application
$computer = $shell.Namespace(17)
$deviceItem = $null

foreach ($it in $computer.Items()) {
  if (([string]$it.Path -eq $devKey) -or ([string]$it.Name -eq $devKey)) {
    $deviceItem = $it
    break
  }
}

# Fallback: if WPD path changed slightly on reconnect, match first Apple WPD device
if (-not $deviceItem) {
  foreach ($it in $computer.Items()) {
    if (([string]$it.Path -match 'vid_05ac') -or ([string]$it.Name -match 'iPhone|iPad|Apple')) {
      $deviceItem = $it
      break
    }
  }
}

if (-not $deviceItem) {
  throw "iPhone introuvable dans Windows WPD. Vérifiez le câble USB-C et que l'iPhone est déverrouillé."
}

$folder = $deviceItem.GetFolder
if ($null -eq $folder) {
  throw "Impossible d'ouvrir le stockage de l'iPhone. Déverrouillez-le et appuyez sur Autoriser."
}

foreach ($seg in $segments) {
  if (-not $seg) { continue }
  $found = $null
  foreach ($child in $folder.Items()) {
    $childName = [string]$child.Name
    $extName = ''
    try { $extName = [string]$child.ExtendedProperty("System.FileName") } catch {}
    if (($childName -eq $seg) -or ($extName -and $extName -eq $seg)) {
      $found = $child
      break
    }
  }
  if (-not $found) {
    throw "Dossier iPhone introuvable : $seg"
  }
  $folder = $found.GetFolder
  if ($null -eq $folder) {
    throw "Impossible d'ouvrir le dossier : $seg"
  }
}

$entries = @()
foreach ($entry in $folder.Items()) {
  $wpdName = [string]$entry.Name
  $displayName = $wpdName
  try {
    $extName = [string]$entry.ExtendedProperty("System.FileName")
    if ($extName -and $extName.Trim().Length -gt 0) {
      $displayName = $extName.Trim()
    }
  } catch {}

  $itemSize = [int64]0
  if (-not $entry.IsFolder) {
    try {
      $extSize = $entry.ExtendedProperty("System.Size")
      if ($null -ne $extSize -and [int64]$extSize -gt 0) {
        $itemSize = [int64]$extSize
      }
    } catch {}
    if ($itemSize -le 0) {
      try { $itemSize = [int64]$entry.Size } catch {}
    }
  }

  $modIso = ''
  try {
    $dt = $entry.ExtendedProperty("System.DateModified")
    if ($null -ne $dt) {
      $modIso = ([datetime]$dt).ToString('o')
    }
  } catch {}
  if (-not $modIso) {
    try { $modIso = [string]$entry.ModifyDate } catch {}
  }

  $entryPath = $(if ($segments.Count -gt 0) { ($segments -join '/') + '/' + $wpdName } else { $wpdName })

  $entries += [PSCustomObject]@{
    name = $displayName
    wpdName = $wpdName
    kind = $(if ($entry.IsFolder) { 'folder' } else { 'file' })
    size = $itemSize
    modifiedAt = $modIso
    path = $entryPath
  }
}

Write-Output '${JSON_START_MARKER}'
ConvertTo-Json -InputObject @($entries) -Depth 4 -Compress
Write-Output '${JSON_END_MARKER}'
`;

  const { stdout } = await runPowerShellEncoded(
    ps,
    { deviceKey, segments },
    { timeout: 30000 }
  );
  const parsed = parseMarkedJson(stdout, []);
  return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
}

async function copyWpdItemToPc(deviceKey, relativePath, destPcDir) {
  const segments = sanitizeSegments(relativePath);
  if (segments.length === 0) {
    throw new Error('Chemin source iPhone vide.');
  }

  const resolvedDest = path.resolve(destPcDir);
  fs.mkdirSync(resolvedDest, { recursive: true });

  const parentSegments = segments.slice(0, -1);
  const targetName = segments[segments.length - 1];

  const ps = `
$payloadJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($env:OPENFS_PAYLOAD_B64))
$payload = $payloadJson | ConvertFrom-Json
$devKey = [string]$payload.deviceKey
$parentSegs = @($payload.parentSegments)
$targetName = [string]$payload.targetName
$destDir = [string]$payload.destDir

$shell = New-Object -ComObject Shell.Application
$computer = $shell.Namespace(17)
$deviceItem = $null

foreach ($it in $computer.Items()) {
  if (([string]$it.Path -eq $devKey) -or ([string]$it.Name -eq $devKey)) {
    $deviceItem = $it
    break
  }
}

if (-not $deviceItem) {
  foreach ($it in $computer.Items()) {
    if (([string]$it.Path -match 'vid_05ac') -or ([string]$it.Name -match 'iPhone|iPad|Apple')) {
      $deviceItem = $it
      break
    }
  }
}

if (-not $deviceItem) {
  throw "iPhone introuvable pour la copie."
}

$folder = $deviceItem.GetFolder
foreach ($seg in $parentSegs) {
  if (-not $seg) { continue }
  $found = $null
  foreach ($child in $folder.Items()) {
    $childName = [string]$child.Name
    $extName = ''
    try { $extName = [string]$child.ExtendedProperty("System.FileName") } catch {}
    if (($childName -eq $seg) -or ($extName -and $extName -eq $seg)) {
      $found = $child
      break
    }
  }
  if (-not $found) { throw "Dossier iPhone introuvable : $seg" }
  $folder = $found.GetFolder
}

$sourceItem = $null
$realFileName = $targetName
foreach ($child in $folder.Items()) {
  $childName = [string]$child.Name
  $extName = ''
  try { $extName = [string]$child.ExtendedProperty("System.FileName") } catch {}
  if (($childName -eq $targetName) -or ($extName -and $extName -eq $targetName)) {
    $sourceItem = $child
    if ($extName -and $extName.Trim().Length -gt 0) {
      $realFileName = $extName.Trim()
    } else {
      $realFileName = $childName
    }
    break
  }
}

if (-not $sourceItem) { throw "Fichier iPhone introuvable : $targetName" }

$destFolder = $shell.Namespace($destDir)
if (-not $destFolder) { throw "Dossier destination PC introuvable : $destDir" }

# 16 = Yes to all, 4 = No progress dialog, 1024 = No error dialog
$destFolder.CopyHere($sourceItem, 1044)

# Wait briefly for Windows Shell async transfer completion
$expectedPath = Join-Path $destDir $realFileName
$fallbackPath = Join-Path $destDir $targetName
$maxWaitMs = 20000
$waited = 0
$lastSize = -1
$stableTicks = 0

while ($waited -lt $maxWaitMs) {
  $checkPath = $null
  if (Test-Path -LiteralPath $expectedPath) { $checkPath = $expectedPath }
  elseif (Test-Path -LiteralPath $fallbackPath) { $checkPath = $fallbackPath }

  if ($checkPath) {
    $info = Get-Item -LiteralPath $checkPath -ErrorAction SilentlyContinue
    if ($info -and $info.PSIsContainer) {
      Start-Sleep -Milliseconds 500
      break
    }
    if ($info) {
      if ($info.Length -gt 0 -and $info.Length -eq $lastSize) {
        $stableTicks++
        if ($stableTicks -ge 2) { break }
      } else {
        $lastSize = $info.Length
        $stableTicks = 0
      }
    }
  }
  Start-Sleep -Milliseconds 300
  $waited += 300
}

$finalOut = $(if (Test-Path -LiteralPath $expectedPath) { $expectedPath } elseif (Test-Path -LiteralPath $fallbackPath) { $fallbackPath } else { $expectedPath })
Write-Output '${JSON_START_MARKER}'
[PSCustomObject]@{ copiedPath = $finalOut } | ConvertTo-Json -Compress
Write-Output '${JSON_END_MARKER}'
`;

  const { stdout } = await runPowerShellEncoded(
    ps,
    {
      deviceKey,
      parentSegments,
      targetName,
      destDir: resolvedDest,
    },
    { timeout: 120000 }
  );

  const parsed = parseMarkedJson(stdout, { copiedPath: path.join(resolvedDest, targetName) });
  return parsed?.copiedPath || path.join(resolvedDest, targetName);
}

async function listIphoneDirectory(deviceId, relativePath = '') {
  if (typeof deviceId !== 'string' || !deviceId.includes(':')) {
    throw new Error('Identifiant de périphérique iPhone invalide.');
  }
  const sepIndex = deviceId.indexOf(':');
  const backend = deviceId.slice(0, sepIndex);
  const rawId = deviceId.slice(sepIndex + 1);

  if (backend === 'wpd') {
    return listWpdDirectory(rawId, relativePath);
  }

  if (backend === 'usb_pnp') {
    throw new Error(
      'Votre iPhone est branché mais encore verrouillé. Déverrouillez-le et appuyez sur « Autoriser » ou « Faire confiance ».'
    );
  }

  throw new Error(
    'Backend AFC détecté. Sous Linux, montez ~/iPhone-USB avec ifuse ; sous Windows, déverrouillez votre iPhone pour activer l’accès WPD.'
  );
}

async function copyFromIphoneToPc(deviceId, relativePath, destPcDir) {
  if (typeof deviceId !== 'string' || !deviceId.includes(':')) {
    throw new Error('Identifiant de périphérique iPhone invalide.');
  }
  const sepIndex = deviceId.indexOf(':');
  const backend = deviceId.slice(0, sepIndex);
  const rawId = deviceId.slice(sepIndex + 1);

  if (backend === 'wpd') {
    return copyWpdItemToPc(rawId, relativePath, destPcDir || getDefaultSyncDir());
  }

  throw new Error(
    'Déverrouillez votre iPhone et validez « Autoriser » sur son écran pour copier ses fichiers.'
  );
}

async function listPcDirectory(dirPath) {
  const targetDir = path.resolve(dirPath || getDefaultSyncDir());
  fs.mkdirSync(targetDir, { recursive: true });
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

  results.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' });
  });

  return results;
}

module.exports = {
  getDefaultSyncDir,
  listIphoneDevices,
  listIphoneDirectory,
  copyFromIphoneToPc,
  listPcDirectory,
};
