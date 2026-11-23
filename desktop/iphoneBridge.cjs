const crypto = require('crypto');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const JSON_START_MARKER = '<<<OPENFS_JSON_START>>>';
const JSON_END_MARKER = '<<<OPENFS_JSON_END>>>';

let activeScanPromise = null;

const PREVIEW_CACHE_ROOT = path.join(os.tmpdir(), 'openfs-preview-cache');
const THUMB_CACHE_ROOT = path.join(os.tmpdir(), 'openfs-thumb-cache');

function ensureCacheDirs() {
  fs.mkdirSync(PREVIEW_CACHE_ROOT, { recursive: true });
  fs.mkdirSync(THUMB_CACHE_ROOT, { recursive: true });
}

function hashKey(input) {
  return crypto.createHash('sha1').update(String(input || '')).digest('hex');
}

function runCommand(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      {
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 40 * 1024 * 1024,
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
  return JSON.parse(jsonText);
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

function getSystemFolder(kind) {
  const home = os.homedir();
  if (kind === 'documents') {
    const candidates = [
      path.join(home, 'Documents'),
      path.join(home, 'OneDrive', 'Documents'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    const fallback = path.join(home, 'Documents');
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }

  if (kind === 'downloads') {
    const candidates = [
      path.join(home, 'Downloads'),
      path.join(home, 'Téléchargements'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    const fallback = path.join(home, 'Downloads');
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }

  return getDefaultSyncDir();
}

function describeApplePid(pidHex) {
  const upper = String(pidHex || '').toUpperCase();
  if (upper === '0X12A8' || upper === '12A8') return 'Apple iPhone (USB-C / Lightning)';
  if (upper === '0X12AB' || upper === '12AB') return 'Apple iPad';
  if (upper === '0X1281' || upper === '1281') return 'Apple iPhone (Mode Récupération)';
  if (upper === '0X1227' || upper === '1227') return 'Apple iPhone (Mode DFU)';
  return 'Apple iPhone (USB)';
}

function classifyMediaType(fileName) {
  const lower = String(fileName || '').toLowerCase();
  if (lower.endsWith('.aae')) return 'sidecar';
  if (/\.(jpg|jpeg|png|heic|heif|webp|gif|bmp|dng|raw|tif|tiff)$/.test(lower)) return 'photo';
  if (/\.(mov|mp4|m4v|avi|mkv|3gp|webm)$/.test(lower)) return 'video';
  if (/\.(m4a|mp3|wav|flac|aac|ogg)$/.test(lower)) return 'audio';
  return 'document';
}

function inferMimeFromExt(fileName) {
  const ext = path.extname(String(fileName || '')).toLowerCase().replace(/^\./, '');
  const map = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
    heic: 'image/heic',
    heif: 'image/heif',
    mov: 'video/quicktime',
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    webm: 'video/webm',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    json: 'application/json',
    xml: 'application/xml',
    csv: 'text/csv',
    log: 'text/plain',
    html: 'text/html',
    css: 'text/css',
    js: 'text/javascript',
    ts: 'text/typescript',
    zip: 'application/zip',
  };
  return map[ext] || 'application/octet-stream';
}

function inferDateFromFolderName(folderName) {
  const match = String(folderName || '').match(/(20\d{2})(0[1-9]|1[0-2])/);
  if (!match) return '';
  return `${match[1]}-${match[2]}-01T12:00:00.000Z`;
}

// Shared C# helper using Windows Shell IShellItemImageFactory (works on WPD Shell paths AND local PC files, including HEIC & MOV/MP4!)
const CSHARP_THUMB_HELPER = `
$thumbCode = @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class OpenFsThumbExtractor {
  [StructLayout(LayoutKind.Sequential)]
  public struct SIZE {
    public int cx;
    public int cy;
    public SIZE(int x, int y) { cx = x; cy = y; }
  }

  [ComImport]
  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  [Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b")]
  public interface IShellItemImageFactory {
    [PreserveSig]
    int GetImage([In, MarshalAs(UnmanagedType.Struct)] SIZE size, [In] int flags, [Out] out IntPtr phbm);
  }

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
  private static extern int SHCreateItemFromParsingName(
    [MarshalAs(UnmanagedType.LPWStr)] string pszPath,
    IntPtr pbc,
    [In] ref Guid riid,
    [Out, MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory ppv
  );

  [DllImport("gdi32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool DeleteObject(IntPtr hObject);

  public static bool SaveThumbnail(string parsingPath, string outJpgPath, int maxSize, int flags) {
    Guid iid = new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b");
    IShellItemImageFactory factory = null;
    IntPtr hBitmap = IntPtr.Zero;
    try {
      int hr = SHCreateItemFromParsingName(parsingPath, IntPtr.Zero, ref iid, out factory);
      if (hr != 0 || factory == null) return false;
      hr = factory.GetImage(new SIZE(maxSize, maxSize), flags, out hBitmap);
      if (hr != 0 || hBitmap == IntPtr.Zero) return false;
      using (Bitmap bmp = Image.FromHbitmap(hBitmap)) {
        bmp.Save(outJpgPath, ImageFormat.Jpeg);
      }
      return true;
    } catch {
      return false;
    } finally {
      if (hBitmap != IntPtr.Zero) DeleteObject(hBitmap);
      if (factory != null) Marshal.ReleaseComObject(factory);
    }
  }
}
'@
if (-not ('OpenFsThumbExtractor' -as [type])) {
  Add-Type -TypeDefinition $thumbCode -ReferencedAssemblies System.Drawing
}
`;

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
    $dt = $entry.ExtendedProperty("System.Photo.DateTaken")
    if ($null -ne $dt) { $modIso = ([datetime]$dt).ToString('o') }
  } catch {}
  if (-not $modIso) {
    try {
      $dt = $entry.ExtendedProperty("System.Media.DateEncoded")
      if ($null -ne $dt) { $modIso = ([datetime]$dt).ToString('o') }
    } catch {}
  }
  if (-not $modIso) {
    try {
      $dt = $entry.ExtendedProperty("System.DateModified")
      if ($null -ne $dt) { $modIso = ([datetime]$dt).ToString('o') }
    } catch {}
  }
  if (-not $modIso) {
    try { $modIso = [string]$entry.ModifyDate } catch {}
  }

  $entryPath = $(if ($segments.Count -gt 0) { ($segments -join '/') + '/' + $wpdName } else { $wpdName })

  $entries += [PSCustomObject]@{
    name = $displayName
    wpdName = $wpdName
    shellPath = [string]$entry.Path
    kind = $(if ($entry.IsFolder) { 'folder' } else { 'file' })
    size = $itemSize
    modifiedAt = $modIso
    path = $entryPath
    sourceFolder = $(if ($segments.Count -gt 0) { $segments[$segments.Count - 1] } else { '' })
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
  const list = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  return list.map((item) => ({
    ...item,
    mediaType: item.kind === 'file' ? classifyMediaType(item.name) : undefined,
  }));
}

/**
 * Recursively scans ALL subfolders on the connected iPhone (Internal Storage, DCIM, 202607_a, 202608_a, 100APPLE, etc.)
 * and returns a flat, date-sorted unified list so photos & videos are never fragmented across Apple's internal folders!
 */
async function scanIphoneMedia(deviceId) {
  if (typeof deviceId !== 'string' || !deviceId.includes(':')) {
    throw new Error('Identifiant de périphérique iPhone invalide.');
  }
  const sepIndex = deviceId.indexOf(':');
  const backend = deviceId.slice(0, sepIndex);
  const deviceKey = deviceId.slice(sepIndex + 1);

  if (backend !== 'wpd') {
    throw new Error('Déverrouillez votre iPhone et validez « Autoriser » pour charger la bibliothèque.');
  }

  const ps = `
$payloadJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($env:OPENFS_PAYLOAD_B64))
$payload = $payloadJson | ConvertFrom-Json
$devKey = [string]$payload.deviceKey

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
  throw "iPhone introuvable dans Windows WPD."
}

$rootFolder = $deviceItem.GetFolder
if ($null -eq $rootFolder) {
  throw "Stockage iPhone verrouillé. Déverrouillez votre iPhone et validez Autoriser."
}

$results = New-Object System.Collections.Generic.List[object]

function Scan-WpdFolder($folderObj, [string]$prefix, [string]$parentFolderName, [int]$depth) {
  if ($null -eq $folderObj -or $depth -gt 4) { return }
  $items = $null
  try { $items = $folderObj.Items() } catch { return }
  if ($null -eq $items) { return }

  foreach ($entry in $items) {
    try {
      $wpdName = [string]$entry.Name
      $nextPath = $(if ($prefix) { $prefix + '/' + $wpdName } else { $wpdName })

      if ($entry.IsFolder) {
        $sub = $null
        try { $sub = $entry.GetFolder } catch {}
        if ($null -ne $sub) {
          Scan-WpdFolder $sub $nextPath $wpdName ($depth + 1)
        }
      } else {
        $displayName = $wpdName
        try {
          $extName = [string]$entry.ExtendedProperty("System.FileName")
          if ($extName -and $extName.Trim().Length -gt 0) {
            $displayName = $extName.Trim()
          }
        } catch {}

        # Skip Apple .AAE sidecar edit metadata files
        if ($displayName -match '\\.aae$') { continue }

        $itemSize = [int64]0
        try {
          $extSize = $entry.ExtendedProperty("System.Size")
          if ($null -ne $extSize -and [int64]$extSize -gt 0) {
            $itemSize = [int64]$extSize
          }
        } catch {}
        if ($itemSize -le 0) {
          try { $itemSize = [int64]$entry.Size } catch {}
        }

        $dateIso = ''
        try {
          $dt = $entry.ExtendedProperty("System.Photo.DateTaken")
          if ($null -ne $dt) { $dateIso = ([datetime]$dt).ToString('o') }
        } catch {}
        if (-not $dateIso) {
          try {
            $dt = $entry.ExtendedProperty("System.Media.DateEncoded")
            if ($null -ne $dt) { $dateIso = ([datetime]$dt).ToString('o') }
          } catch {}
        }
        if (-not $dateIso) {
          try {
            $dt = $entry.ExtendedProperty("System.DateModified")
            if ($null -ne $dt) { $dateIso = ([datetime]$dt).ToString('o') }
          } catch {}
        }
        if (-not $dateIso) {
          try {
            $md = $entry.ModifyDate
            if ($null -ne $md) { $dateIso = ([datetime]$md).ToString('o') }
          } catch {}
        }

        $results.Add([PSCustomObject]@{
          name = $displayName
          wpdName = $wpdName
          shellPath = [string]$entry.Path
          kind = 'file'
          size = $itemSize
          modifiedAt = $dateIso
          path = $nextPath
          sourceFolder = $parentFolderName
        })
      }
    } catch {}
  }
}

Scan-WpdFolder $rootFolder '' '' 0

Write-Output '${JSON_START_MARKER}'
ConvertTo-Json -InputObject @($results) -Depth 4 -Compress
Write-Output '${JSON_END_MARKER}'
`;

  const { stdout } = await runPowerShellEncoded(
    ps,
    { deviceKey },
    { timeout: 60000 }
  );

  const parsed = parseMarkedJson(stdout, []);
  const rawList = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];

  const enriched = rawList.map((item) => {
    const mediaType = classifyMediaType(item.name);
    let dateStr = item.modifiedAt || '';
    const parsedTime = dateStr ? Date.parse(dateStr) : NaN;
    if (!dateStr || Number.isNaN(parsedTime) || parsedTime < Date.UTC(2000, 0, 1)) {
      dateStr = inferDateFromFolderName(item.sourceFolder) || new Date().toISOString();
    }
    return {
      ...item,
      modifiedAt: dateStr,
      mediaType,
    };
  });

  // Sort newest first by publication/capture date
  enriched.sort((a, b) => {
    const ta = Date.parse(a.modifiedAt || '') || 0;
    const tb = Date.parse(b.modifiedAt || '') || 0;
    if (tb !== ta) return tb - ta;
    return String(b.name || '').localeCompare(String(a.name || ''), 'fr', { numeric: true });
  });

  return enriched;
}

/**
 * Generates Windows Shell thumbnails (JPEG) for a batch of WPD shellPaths or local PC file paths.
 * Uses IShellItemImageFactory so JPG, PNG, HEIC, MOV, MP4, and PDF all produce crisp real thumbnails!
 * Returns a map: { [itemKey]: localJpgFilePath }
 */
async function generateThumbnailsBatch(items, maxSize = 360) {
  if (process.platform !== 'win32' || !Array.isArray(items) || items.length === 0) {
    return {};
  }

  ensureCacheDirs();

  const result = {};
  const toGenerate = [];

  for (const item of items) {
    if (!item || !item.key || !item.shellPath) continue;
    const outPath = path.join(THUMB_CACHE_ROOT, `${hashKey(`${item.key}|${maxSize}`)}.jpg`);
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 200) {
      result[item.key] = outPath;
    } else {
      toGenerate.push({
        key: String(item.key),
        shellPath: String(item.shellPath),
        outPath,
      });
    }
  }

  if (toGenerate.length === 0) {
    return result;
  }

  const ps = `
${CSHARP_THUMB_HELPER}
$payloadJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($env:OPENFS_PAYLOAD_B64))
$payload = $payloadJson | ConvertFrom-Json
$items = @($payload.items)
$maxSize = [int]$payload.maxSize
$generated = @{}

foreach ($item in $items) {
  try {
    $sp = [string]$item.shellPath
    $outFile = [string]$item.outPath
    # 0x09 = SIIGBF_BIGGERSIZEOK | SIIGBF_THUMBNAILONLY (real thumbnail, avoids generic icon)
    $ok = [OpenFsThumbExtractor]::SaveThumbnail($sp, $outFile, $maxSize, 9)
    if (-not $ok) {
      # Retry with SIIGBF_RESIZETOFIT | SIIGBF_THUMBNAILONLY (0x08)
      $ok = [OpenFsThumbExtractor]::SaveThumbnail($sp, $outFile, $maxSize, 8)
    }
    if ($ok -and (Test-Path -LiteralPath $outFile)) {
      $generated[[string]$item.key] = $outFile
    }
  } catch {}
}

Write-Output '${JSON_START_MARKER}'
ConvertTo-Json -InputObject $generated -Depth 3 -Compress
Write-Output '${JSON_END_MARKER}'
`;

  try {
    const { stdout } = await runPowerShellEncoded(
      ps,
      { items: toGenerate, maxSize },
      { timeout: 30000 }
    );
    const parsed = parseMarkedJson(stdout, {});
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string' && fs.existsSync(v)) {
          result[k] = v;
        }
      }
    }
  } catch {
    // Gracefully return whatever cached thumbs we already have
  }

  return result;
}

async function convertLocalHeicToJpg(localPath) {
  ensureCacheDirs();
  const stat = fs.statSync(localPath);
  const outJpg = path.join(
    PREVIEW_CACHE_ROOT,
    `heic_${hashKey(`${localPath}|${stat.size}|${stat.mtimeMs}`)}.jpg`
  );
  if (fs.existsSync(outJpg) && fs.statSync(outJpg).size > 500) {
    return outJpg;
  }

  const ps = `
${CSHARP_THUMB_HELPER}
$payloadJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($env:OPENFS_PAYLOAD_B64))
$payload = $payloadJson | ConvertFrom-Json
$src = [string]$payload.src
$dst = [string]$payload.dst
# 0x01 = SIIGBF_BIGGERSIZEOK (asks Windows HEIF/WIC codec for high-res rendered image)
$ok = [OpenFsThumbExtractor]::SaveThumbnail($src, $dst, 1920, 1)
if (-not $ok) {
  $ok = [OpenFsThumbExtractor]::SaveThumbnail($src, $dst, 1280, 0)
}
Write-Output '${JSON_START_MARKER}'
ConvertTo-Json -InputObject ([PSCustomObject]@{ ok = $ok; path = $dst }) -Compress
Write-Output '${JSON_END_MARKER}'
`;

  try {
    const { stdout } = await runPowerShellEncoded(ps, { src: localPath, dst: outJpg }, { timeout: 25000 });
    const parsed = parseMarkedJson(stdout, { ok: false });
    if (parsed?.ok && fs.existsSync(outJpg)) {
      return outJpg;
    }
  } catch {
    // Fall through
  }
  return null;
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

$expectedPath = Join-Path $destDir $realFileName
$fallbackPath = Join-Path $destDir $targetName
$maxWaitMs = 45000
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
ConvertTo-Json -InputObject ([PSCustomObject]@{ copiedPath = $finalOut }) -Compress
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

/**
 * Prepares a local file (either on PC or cached from iPhone WPD) for high-quality inline preview inside Electron.
 */
async function buildLocalPreviewDescriptor(localPath, displayName) {
  const safePath = path.resolve(localPath);
  if (!fs.existsSync(safePath)) {
    throw new Error('Fichier introuvable pour la prévisualisation.');
  }
  const stat = fs.statSync(safePath);
  const name = displayName || path.basename(safePath);
  const mimeType = inferMimeFromExt(name);
  const lower = name.toLowerCase();

  // Text / code / JSON / Markdown files -> return UTF-8 text directly
  const isText =
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    /\.(txt|md|json|csv|log|xml|plist|ini|cfg|env|js|ts|tsx|py|sh|bat)$/i.test(lower);

  if (isText && stat.size <= 2 * 1024 * 1024) {
    const textContent = await fs.promises.readFile(safePath, 'utf8');
    return {
      previewKind: 'text',
      localPath: safePath,
      mimeType,
      size: stat.size,
      textContent,
    };
  }

  // HEIC / HEIF -> convert to crisp HD JPEG via Windows Shell / WIC so Electron <img> renders it natively!
  if (/\.(heic|heif)$/i.test(lower)) {
    const convertedJpg = await convertLocalHeicToJpg(safePath);
    if (convertedJpg) {
      return {
        previewKind: 'image',
        localPath: convertedJpg,
        originalPath: safePath,
        mimeType: 'image/jpeg',
        size: stat.size,
      };
    }
  }

  if (mimeType.startsWith('image/')) {
    return {
      previewKind: 'image',
      localPath: safePath,
      mimeType,
      size: stat.size,
    };
  }

  if (mimeType.startsWith('video/')) {
    return {
      previewKind: 'video',
      localPath: safePath,
      mimeType,
      size: stat.size,
    };
  }

  if (mimeType.startsWith('audio/')) {
    return {
      previewKind: 'audio',
      localPath: safePath,
      mimeType,
      size: stat.size,
    };
  }

  if (mimeType === 'application/pdf') {
    return {
      previewKind: 'pdf',
      localPath: safePath,
      mimeType,
      size: stat.size,
    };
  }

  return {
    previewKind: 'unsupported',
    localPath: safePath,
    mimeType,
    size: stat.size,
  };
}

async function prepareIphonePreview(deviceId, relativePath, displayName) {
  if (typeof deviceId !== 'string' || !deviceId.includes(':')) {
    throw new Error('Identifiant iPhone invalide.');
  }
  const sepIndex = deviceId.indexOf(':');
  const backend = deviceId.slice(0, sepIndex);
  const deviceKey = deviceId.slice(sepIndex + 1);

  if (backend !== 'wpd') {
    throw new Error('Prévisualisation disponible une fois l’iPhone déverrouillé.');
  }

  ensureCacheDirs();
  const cacheSubdir = path.join(PREVIEW_CACHE_ROOT, hashKey(`${deviceId}|${relativePath}`));
  fs.mkdirSync(cacheSubdir, { recursive: true });

  // Check if we already cached this exact iPhone file
  const existingFiles = fs.readdirSync(cacheSubdir).filter((f) => !f.startsWith('heic_'));
  let cachedFilePath = existingFiles.length > 0 ? path.join(cacheSubdir, existingFiles[0]) : null;

  if (!cachedFilePath || !fs.existsSync(cachedFilePath) || fs.statSync(cachedFilePath).size === 0) {
    cachedFilePath = await copyWpdItemToPc(deviceKey, relativePath, cacheSubdir);
  }

  return buildLocalPreviewDescriptor(cachedFilePath, displayName);
}

async function preparePcPreview(filePath) {
  return buildLocalPreviewDescriptor(filePath);
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
    if (dirent.name.toLowerCase() === 'desktop.ini' || dirent.name.startsWith('~$')) continue;
    const fullPath = path.join(targetDir, dirent.name);
    try {
      const stat = await fs.promises.stat(fullPath);
      const isDir = dirent.isDirectory();
      results.push({
        name: dirent.name,
        shellPath: fullPath,
        kind: isDir ? 'folder' : 'file',
        size: isDir ? 0 : stat.size,
        modifiedAt: stat.mtime.toISOString(),
        path: fullPath,
        mediaType: isDir ? undefined : classifyMediaType(dirent.name),
      });
    } catch {
      // Skip unreadable OS system entries
    }
  }

  results.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    if (a.kind === 'file') {
      const ta = Date.parse(a.modifiedAt || '') || 0;
      const tb = Date.parse(b.modifiedAt || '') || 0;
      if (tb !== ta) return tb - ta;
    }
    return a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' });
  });

  return results;
}

module.exports = {
  getDefaultSyncDir,
  getSystemFolder,
  listIphoneDevices,
  listIphoneDirectory,
  scanIphoneMedia,
  generateThumbnailsBatch,
  prepareIphonePreview,
  preparePcPreview,
  copyFromIphoneToPc,
  listPcDirectory,
};
