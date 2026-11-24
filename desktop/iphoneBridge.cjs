const crypto = require('crypto');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const { logError, logInfo, logWarn } = require('./logger.cjs');
const {
  afcDownloadFile,
  computeFileSha256,
  convertBinaryPlistToXml,
  convertXmlTextToBinaryPlist,
  isBinaryPlistFile,
  listAfcDevices,
} = require('./afcBridge.cjs');
const afcNative = require('./afcNative.cjs');

// --- Fast media access through Apple Devices / usbmuxd (AFC) ---
// Windows' WPD copy is slow (1.3 s per photo, 28 s for an 800 Mo video) and cannot seek.
// When usbmuxd is reachable, camera-roll items are matched to their AFC path by name + size,
// which gives instant iOS-made JPEG previews, 30 Mo/s downloads and seekable video streaming.
let nativeUdidCache = { at: 0, udids: null };
async function getFastMediaUdid() {
  if (Date.now() - nativeUdidCache.at > 5000) {
    nativeUdidCache = { at: Date.now(), udids: await afcNative.getNativeUdids(1500) };
  }
  const udids = nativeUdidCache.udids;
  return udids && udids.length > 0 ? udids[0] : null;
}

async function resolveFastMedia(name, size) {
  try {
    const udid = await getFastMediaUdid();
    if (!udid) return null;
    const hit = await afcNative.findDcimFile(udid, name, size);
    return hit ? { udid, ...hit } : null;
  } catch (err) {
    logWarn('preview', `Accès rapide AFC indisponible pour ${name}`, err);
    return null;
  }
}

function isVideoName(name) {
  return /\.(mov|mp4|m4v)$/i.test(String(name || ''));
}

async function getIosThumbnailPath(key, name, size) {
  const outPath = path.join(THUMB_CACHE_ROOT, `${hashKey(`${key}|ios|v1`)}.jpg`);
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) return outPath;
  const hit = await resolveFastMedia(name, size);
  if (!hit) return null;
  let jpg = await afcNative.readIosThumbnail(hit.udid, hit);
  if (!jpg && isVideoName(name)) {
    // The video half of a Live Photo has no thumbnail of its own: use its photo's one.
    const base = String(name).replace(/\.[^.]+$/, '');
    for (const ext of ['.HEIC', '.JPG']) {
      const photo = await afcNative.findDcimFile(hit.udid, base + ext);
      if (photo && photo.folder === hit.folder) {
        jpg = await afcNative.readIosThumbnail(hit.udid, photo);
        if (jpg) break;
      }
    }
  }
  if (!jpg) return null;
  await fs.promises.writeFile(outPath, jpg);
  return outPath;
}

/** Instant preview: the JPEG iOS already generated for this photo/video (about 360x480), or null. */
async function getQuickIphonePreview(name, size, key = '') {
  if (!name || !/\.(heic|heif|jpe?g|png|mov|mp4|m4v)$/i.test(name)) return null;
  ensureCacheDirs();
  try {
    return await getIosThumbnailPath(key || `${name}|${size}`, name, size);
  } catch (err) {
    logWarn('preview', `Aperçu instantané iOS indisponible pour ${name}`, err);
    return null;
  }
}

const JSON_START_MARKER = '<<<OPENFS_JSON_START>>>';
const JSON_END_MARKER = '<<<OPENFS_JSON_END>>>';

let activeScanPromise = null;

const PREVIEW_CACHE_ROOT = path.join(os.tmpdir(), 'openfs-preview-cache');
const THUMB_CACHE_ROOT = path.join(os.tmpdir(), 'openfs-thumb-cache');
const STAGE_ROOT = path.join(os.tmpdir(), 'openfs-wpd-stage');

function ensureCacheDirs() {
  fs.mkdirSync(PREVIEW_CACHE_ROOT, { recursive: true });
  fs.mkdirSync(THUMB_CACHE_ROOT, { recursive: true });
  fs.mkdirSync(STAGE_ROOT, { recursive: true });
}

function hashKey(input) {
  return crypto.createHash('sha1').update(String(input || '')).digest('hex');
}

function cleanPowerShellError(rawStderr, fallbackMessage) {
  const raw = String(rawStderr || '').trim();
  if (!raw) return String(fallbackMessage || 'Erreur PowerShell inconnue.');

  if (raw.startsWith('#< CLIXML') || raw.includes('<Objs Version=')) {
    const errorLines = [];
    const errRegex = /<S S="Error">([\s\S]*?)<\/S>/g;
    let match;
    while ((match = errRegex.exec(raw)) !== null) {
      const decoded = match[1]
        .replace(/_x000D__x000A_/g, '\n')
        .replace(/_x000A_/g, '\n')
        .replace(/_x0009_/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .trim();
      if (decoded) errorLines.push(decoded);
    }
    if (errorLines.length > 0) {
      return errorLines.join('\n').trim();
    }
    // Fallback: strip XML tags if stderr only contained non-Error CLIXML records
    const stripped = raw
      .replace(/^#< CLIXML\s*/i, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/_x000D__x000A_/g, '\n')
      .replace(/\s+/g, ' ')
      .trim();
    return stripped || String(fallbackMessage || 'Erreur PowerShell.');
  }

  return raw;
}

function runCommand(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      {
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        timeout: options.timeout ?? 30000,
        env: options.env ? { ...process.env, ...options.env } : process.env,
      },
      (error, stdout, stderr) => {
        if (error) {
          const msg = cleanPowerShellError(stderr, error.message);
          reject(new Error(msg));
          return;
        }
        resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
      }
    );
  });
}

// Bulletproof PowerShell 5.1 JSON serializer:
// Uses .NET JavaScriptSerializer with MaxJsonLength = MaxValue on hashtables/ArrayLists
// to completely avoid BOTH PS 5.1 ConvertTo-Json ArgumentException AND the 2 MB truncation limit.
const PS_JSON_HELPER = `
function ConvertTo-OpenFsJson($obj) {
  try {
    Add-Type -AssemblyName System.Web.Extensions -ErrorAction Stop
    $ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $ser.MaxJsonLength = [int]::MaxValue
    $ser.RecursionLimit = 64
    return $ser.Serialize($obj)
  } catch {
    return (ConvertTo-Json -InputObject $obj -Depth 5 -Compress)
  }
}
`;

function runPowerShellEncoded(script, payload = null, options = {}) {
  const preamble = [
    '$ProgressPreference = "SilentlyContinue"',
    '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '$OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '$ErrorActionPreference = "Stop"',
    PS_JSON_HELPER,
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
    plist: 'application/xml',
    csv: 'text/csv',
    log: 'text/plain',
    html: 'text/html',
    css: 'text/css',
    js: 'text/javascript',
    ts: 'text/typescript',
    tsx: 'text/typescript',
    py: 'text/x-python',
    sh: 'text/x-shellscript',
    ini: 'text/plain',
    cfg: 'text/plain',
    yaml: 'text/yaml',
    yml: 'text/yaml',
    zip: 'application/zip',
  };
  return map[ext] || 'application/octet-stream';
}

function inferDateFromFolderName(folderName) {
  const match = String(folderName || '').match(/(20\d{2})(0[1-9]|1[0-2])/);
  if (!match) return '';
  return `${match[1]}-${match[2]}-01T12:00:00.000Z`;
}

// Shared C# helper using Windows Shell IShellItemImageFactory (works on WPD Shell paths AND local PC files, including HEIC & MOV/MP4).
// Renders HBITMAP onto a clean 24bpp RGB canvas before JPEG encoding (fixes 32bpp premultiplied ARGB issues)
// and returns exact HRESULT diagnostics if extraction fails.
const CSHARP_THUMB_HELPER = `
$thumbCode = @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
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
    [Out, MarshalAs(UnmanagedType.IUnknown)] out object ppv
  );

  [DllImport("gdi32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool DeleteObject(IntPtr hObject);

  private static ImageCodecInfo GetJpegCodec() {
    ImageCodecInfo[] codecs = ImageCodecInfo.GetImageEncoders();
    for (int i = 0; i < codecs.Length; i++) {
      if (codecs[i].FormatID == ImageFormat.Jpeg.Guid) return codecs[i];
    }
    return null;
  }

  private static void SaveHBitmapAsJpeg(IntPtr hBitmap, string outJpgPath, long quality) {
    string tmpPath = outJpgPath + ".tmp";
    using (Bitmap raw = Image.FromHbitmap(hBitmap)) {
      int w = Math.Max(1, raw.Width);
      int h = Math.Max(1, raw.Height);
      using (Bitmap rgb = new Bitmap(w, h, PixelFormat.Format24bppRgb)) {
        using (Graphics g = Graphics.FromImage(rgb)) {
          g.Clear(Color.White);
          g.CompositingQuality = CompositingQuality.HighQuality;
          g.InterpolationMode = InterpolationMode.HighQualityBicubic;
          g.SmoothingMode = SmoothingMode.HighQuality;
          g.DrawImage(raw, 0, 0, w, h);
        }
        ImageCodecInfo jpegCodec = GetJpegCodec();
        if (jpegCodec != null) {
          using (EncoderParameters ep = new EncoderParameters(1)) {
            ep.Param[0] = new EncoderParameter(Encoder.Quality, quality);
            rgb.Save(tmpPath, jpegCodec, ep);
          }
        } else {
          rgb.Save(tmpPath, ImageFormat.Jpeg);
        }
      }
    }
    if (File.Exists(outJpgPath)) {
      File.Delete(outJpgPath);
    }
    File.Move(tmpPath, outJpgPath);
  }

  public static string SaveThumbnailWithFallback(string parsingPath, string outJpgPath, int maxSize, int[] flagList, long quality) {
    Guid iid = new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b");
    object rawFactory = null;
    IShellItemImageFactory factory = null;
    try {
      int hr = SHCreateItemFromParsingName(parsingPath, IntPtr.Zero, ref iid, out rawFactory);
      if (hr != 0 || rawFactory == null) {
        return string.Format("SHCreateItemFromParsingName failed: 0x{0:X8}", hr);
      }
      factory = rawFactory as IShellItemImageFactory;
      if (factory == null) {
        return "Cast IShellItemImageFactory returned null";
      }

      string lastErr = "No flags provided";
      for (int i = 0; i < flagList.Length; i++) {
        IntPtr hBitmap = IntPtr.Zero;
        try {
          int f = flagList[i];
          int ghr = factory.GetImage(new SIZE(maxSize, maxSize), f, out hBitmap);
          if (ghr == 0 && hBitmap != IntPtr.Zero) {
            SaveHBitmapAsJpeg(hBitmap, outJpgPath, quality);
            return "";
          }
          lastErr = string.Format("GetImage(flags=0x{0:X}) failed: 0x{1:X8}", f, ghr);
        } catch (Exception ex) {
          lastErr = "GetImage/Save exception: " + ex.Message;
        } finally {
          if (hBitmap != IntPtr.Zero) {
            DeleteObject(hBitmap);
          }
        }
      }
      return lastErr;
    } catch (Exception ex) {
      return "Extractor exception: " + ex.Message;
    } finally {
      if (rawFactory != null && Marshal.IsComObject(rawFactory)) {
        Marshal.ReleaseComObject(rawFactory);
      }
    }
  }
}
'@
if (-not ('OpenFsThumbExtractor' -as [type])) {
  # Compiling the C# helper costs ~1 s per PowerShell call: compile it once into a cached DLL
  # (named after a hash of its source) and load that DLL on every later call.
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $codeHash = -join ($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($thumbCode))[0..7] | ForEach-Object { $_.ToString('x2') })
  $dllDir = Join-Path ([System.IO.Path]::GetTempPath()) 'openfs-helper-cache'
  $dllPath = Join-Path $dllDir ('OpenFsThumbExtractor_' + $codeHash + '.dll')
  $loaded = $false
  if (Test-Path -LiteralPath $dllPath) {
    try { Add-Type -Path $dllPath -ErrorAction Stop; $loaded = $true } catch { $loaded = $false }
  }
  if (-not $loaded) {
    try {
      New-Item -ItemType Directory -Force -Path $dllDir | Out-Null
      $tmpDll = $dllPath + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
      Add-Type -TypeDefinition $thumbCode -ReferencedAssemblies System.Drawing -OutputAssembly $tmpDll -OutputType Library -ErrorAction Stop
      Move-Item -LiteralPath $tmpDll -Destination $dllPath -Force -ErrorAction SilentlyContinue
      if (Test-Path -LiteralPath $dllPath) { Add-Type -Path $dllPath -ErrorAction Stop } else { Add-Type -Path $tmpDll -ErrorAction Stop }
    } catch {
      Add-Type -TypeDefinition $thumbCode -ReferencedAssemblies System.Drawing
    }
  }
}
`;

async function detectWindowsDevices() {
  if (process.platform !== 'win32') return [];

  const ps = `
$wpdDevices = New-Object System.Collections.ArrayList
$pnpDevices = New-Object System.Collections.ArrayList
$warnings = New-Object System.Collections.ArrayList

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
          } catch {
            [void]$warnings.Add("WPD GetFolder: " + $_.Exception.Message)
          }

          $vendId = '0x05AC'
          $prodId = ''
          if ($itemPath -match 'vid_([0-9a-fA-F]{4})') {
            $vendId = '0x' + $Matches[1].ToUpper()
          }
          if ($itemPath -match 'pid_([0-9a-fA-F]{4})') {
            $prodId = '0x' + $Matches[1].ToUpper()
          }

          [void]$wpdDevices.Add([ordered]@{
            wpdPath = $itemPath
            name = $itemName
            type = $itemType
            vendorId = $vendId
            productId = $prodId
            storageCount = $storageCount
            firstStorageName = $firstStorageName
          })
        }
      } catch {
        [void]$warnings.Add("WPD item: " + $_.Exception.Message)
      }
    }
  }
} catch {
  [void]$warnings.Add("WPD shell: " + $_.Exception.Message)
}

try {
  $pnpList = Get-CimInstance -ClassName Win32_PnPEntity -Filter "PNPDeviceID LIKE '%VID_05AC%'" -ErrorAction SilentlyContinue
  if ($null -eq $pnpList) {
    $pnpList = Get-WmiObject -Class Win32_PnPEntity -Filter "PNPDeviceID LIKE '%VID_05AC%'" -ErrorAction SilentlyContinue
  }
  foreach ($pnp in @($pnpList)) {
    if ($null -eq $pnp) { continue }
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
        [void]$pnpDevices.Add([ordered]@{
          pnpId = $devId
          name = $pnpName
          pnpClass = $pnpClass
          status = $pnpStatus
          vendorId = '0x05AC'
          productId = $(if ($pidHex) { '0x' + $pidHex } else { '0x12A8' })
          serialNumber = $serial
        })
      }
    } catch {
      [void]$warnings.Add("PnP item: " + $_.Exception.Message)
    }
  }
} catch {
  [void]$warnings.Add("PnP query: " + $_.Exception.Message)
}

$output = [ordered]@{
  wpd = $wpdDevices
  pnp = $pnpDevices
  warnings = $warnings
}

Write-Output '${JSON_START_MARKER}'
Write-Output (ConvertTo-OpenFsJson $output)
Write-Output '${JSON_END_MARKER}'
`;

  try {
    const { stdout } = await runPowerShellEncoded(ps, null, { timeout: 15000 });
    const parsed = parseMarkedJson(stdout, { wpd: [], pnp: [], warnings: [] });
    if (Array.isArray(parsed.warnings) && parsed.warnings.length > 0) {
      logWarn('wpd', `Avertissements détection Windows (${parsed.warnings.length})`, parsed.warnings[0]);
    }
    const wpdList = Array.isArray(parsed.wpd) ? parsed.wpd : parsed.wpd ? [parsed.wpd] : [];
    const pnpList = Array.isArray(parsed.pnp) ? parsed.pnp : parsed.pnp ? [parsed.pnp] : [];

    const primaryPnp =
      pnpList.find((p) => p.serialNumber && p.serialNumber.length >= 8) || pnpList[0] || null;

    const results = [];

    for (const dev of wpdList) {
      const storageCount = Number(dev.storageCount || 0);
      const accessible = storageCount > 0;
      const pidHex = dev.productId || primaryPnp?.productId || '0x12A8';
      const serial = primaryPnp?.serialNumber || 'USB-WPD';
      const key = dev.wpdPath || dev.name;

      results.push({
        id: `wpd:${key}`,
        name: dev.name || 'Apple iPhone',
        model: describeApplePid(pidHex),
        serialNumber: serial,
        vendorId: dev.vendorId || '0x05AC',
        productId: pidHex,
        backend: 'wpd',
        status: accessible ? 'ready' : 'locked',
        accessible,
        storageCount,
        hint: accessible
          ? undefined
          : 'iPhone détecté dans Windows, mais son stockage est verrouillé. Déverrouillez votre iPhone et appuyez sur « Autoriser » ou « Se fier ».',
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
            'iPhone détecté sur le port USB de votre PC ! Déverrouillez son écran et appuyez sur « Autoriser » ou « Se fier à cet ordinateur ».',
        });
      }
    }

    return results;
  } catch (err) {
    logError('wpd', 'Erreur detectWindowsDevices', err);
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
        listAfcDevices(),
      ]);

      if (winDevices.length > 0) {
        const primaryAfc = afcDevices.find((d) => d.accessible) || afcDevices[0] || null;
        const mergedWin = winDevices.map((winDev) => {
          const matchedAfc =
            afcDevices.find(
              (a) =>
                a.serialNumber &&
                winDev.serialNumber &&
                a.serialNumber.replace(/-/g, '').toLowerCase() ===
                  winDev.serialNumber.replace(/-/g, '').toLowerCase()
            ) || (winDevices.length === 1 ? primaryAfc : null);

          if (!matchedAfc) {
            return {
              ...winDev,
              afcAvailable: false,
              afcPaired: false,
            };
          }

          return {
            ...winDev,
            name: matchedAfc.accessible && matchedAfc.name ? matchedAfc.name : winDev.name,
            model: matchedAfc.accessible && matchedAfc.model ? matchedAfc.model : winDev.model,
            afcUdid: matchedAfc.udid || matchedAfc.serialNumber,
            afcAvailable: true,
            afcPaired: Boolean(matchedAfc.accessible),
            status: winDev.accessible || matchedAfc.accessible ? 'ready' : 'locked',
            accessible: Boolean(winDev.accessible || matchedAfc.accessible),
            hint: winDev.accessible ? undefined : matchedAfc.hint || winDev.hint,
          };
        });

        const usedUdids = new Set(
          mergedWin.map((d) => d.afcUdid).filter(Boolean)
        );
        const extraAfc = afcDevices
          .filter((a) => !usedUdids.has(a.udid || a.serialNumber))
          .map((a) => ({
            ...a,
            afcUdid: a.udid || a.serialNumber,
            afcAvailable: true,
            afcPaired: Boolean(a.accessible),
          }));

        return [...mergedWin, ...extraAfc];
      }

      return afcDevices.map((a) => ({
        ...a,
        afcUdid: a.udid || a.serialNumber,
        afcAvailable: true,
        afcPaired: Boolean(a.accessible),
      }));
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
$segments = @($payload.segments | Where-Object { $null -ne $_ -and ([string]$_).Length -gt 0 })
$warnings = New-Object System.Collections.Generic.List[string]

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
  $found = $null
  foreach ($child in $folder.Items()) {
    $childName = [string]$child.Name
    $extName = ''
    try { $extName = [string]$child.ExtendedProperty("System.FileName") } catch { $warnings.Add("ExtFileName: " + $_.Exception.Message) }
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

$entries = New-Object System.Collections.ArrayList
foreach ($entry in $folder.Items()) {
  $wpdName = [string]$entry.Name
  $displayName = $wpdName
  try {
    $extName = [string]$entry.ExtendedProperty("System.FileName")
    if ($extName -and $extName.Trim().Length -gt 0) {
      $displayName = $extName.Trim()
    }
  } catch {
    $warnings.Add("FileName: " + $_.Exception.Message)
  }

  $itemSize = [int64]0
  if (-not $entry.IsFolder) {
    try {
      $extSize = $entry.ExtendedProperty("System.Size")
      if ($null -ne $extSize -and [int64]$extSize -gt 0) {
        $itemSize = [int64]$extSize
      }
    } catch {
      $warnings.Add("Size: " + $_.Exception.Message)
    }
    if ($itemSize -le 0) {
      try { $itemSize = [int64]$entry.Size } catch { $warnings.Add("FallbackSize: " + $_.Exception.Message) }
    }
  }

  $modIso = ''
  foreach ($prop in @("System.Photo.DateTaken", "System.Media.DateEncoded", "System.ItemDate", "System.DateCreated", "System.DateModified")) {
    if ($modIso) { break }
    try {
      $dt = $entry.ExtendedProperty($prop)
      if ($null -ne $dt) {
        $dtVal = [datetime]$dt
        if ($dtVal.Year -ge 2000 -and $dtVal.Year -le 2100) {
          $modIso = $dtVal.ToString('o')
        }
      }
    } catch {
      # Property may not exist for non-media items
    }
  }
  if (-not $modIso) {
    try {
      if ($null -ne $entry.ModifyDate) {
        $mdVal = [datetime]$entry.ModifyDate
        if ($mdVal.Year -ge 2000 -and $mdVal.Year -le 2100) {
          $modIso = $mdVal.ToString('o')
        }
      }
    } catch {
      $warnings.Add("ModifyDate: " + $_.Exception.Message)
    }
  }

  $entryPath = $(if ($segments.Count -gt 0) { ($segments -join '/') + '/' + $displayName } else { $displayName })

  [void]$entries.Add([ordered]@{
    name = $displayName
    wpdName = $wpdName
    shellPath = [string]$entry.Path
    kind = $(if ($entry.IsFolder) { 'folder' } else { 'file' })
    size = $itemSize
    modifiedAt = $modIso
    path = $entryPath
    sourceFolder = $(if ($segments.Count -gt 0) { $segments[$segments.Count - 1] } else { '' })
  })
}

Write-Output '${JSON_START_MARKER}'
Write-Output (ConvertTo-OpenFsJson $entries)
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
 * Recursively scans ALL subfolders on the connected iPhone (Internal Storage, DCIM, 202607_a, 100APPLE, etc.)
 * Fixed for PowerShell 5.1: uses ([object[]]$results.ToArray()) and preserves unique shellPath for Live Photos!
 */
async function scanIphoneMedia(deviceId) {
  if (typeof deviceId !== 'string' || !deviceId.includes(':')) {
    throw new Error('Identifiant de périphérique iPhone invalide.');
  }
  const sepIndex = deviceId.indexOf(':');
  const backend = deviceId.slice(0, sepIndex);
  const deviceKey = deviceId.slice(sepIndex + 1);

  if (backend !== 'wpd') {
    throw new Error('Déverrouillez votre iPhone et validez « Autoriser » pour charger la bibliothèque WPD.');
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

$results = New-Object System.Collections.ArrayList
$warnings = New-Object System.Collections.ArrayList

function Scan-WpdFolder($folderObj, [string]$prefix, [string]$parentFolderName, [int]$depth) {
  if ($null -eq $folderObj -or $depth -gt 4) { return }
  $items = $null
  try {
    $items = $folderObj.Items()
  } catch {
    [void]$warnings.Add("Items($prefix): " + $_.Exception.Message)
    return
  }
  if ($null -eq $items) { return }

  foreach ($entry in $items) {
    try {
      $wpdName = [string]$entry.Name
      $entryShellPath = [string]$entry.Path

      if ($entry.IsFolder) {
        $nextFolderPath = $(if ($prefix) { $prefix + '/' + $wpdName } else { $wpdName })
        $sub = $null
        try {
          $sub = $entry.GetFolder
        } catch {
          [void]$warnings.Add("GetFolder($nextFolderPath): " + $_.Exception.Message)
        }
        if ($null -ne $sub) {
          Scan-WpdFolder $sub $nextFolderPath $wpdName ($depth + 1)
        }
      } else {
        $displayName = $wpdName
        try {
          $extName = [string]$entry.ExtendedProperty("System.FileName")
          if ($extName -and $extName.Trim().Length -gt 0) {
            $displayName = $extName.Trim()
          }
        } catch {
          [void]$warnings.Add("FileName($wpdName): " + $_.Exception.Message)
        }

        # Skip Apple .AAE sidecar edit metadata files
        if ($displayName -match '\\.aae$') { continue }

        # Use displayName (includes .HEIC / .MOV) in logical path; shellPath stays the unique WPD key!
        $nextFilePath = $(if ($prefix) { $prefix + '/' + $displayName } else { $displayName })

        $itemSize = [int64]0
        try {
          $extSize = $entry.ExtendedProperty("System.Size")
          if ($null -ne $extSize -and [int64]$extSize -gt 0) {
            $itemSize = [int64]$extSize
          }
        } catch {
          # Fallback below
        }
        if ($itemSize -le 0) {
          try { $itemSize = [int64]$entry.Size } catch { [void]$warnings.Add("Size($displayName): " + $_.Exception.Message) }
        }

        # Extract true capture/creation date in priority order, rejecting invalid COM epoch dates (1601 / 1899)
        $dateIso = ''
        foreach ($prop in @("System.Photo.DateTaken", "System.Media.DateEncoded", "System.ItemDate", "System.DateCreated", "System.DateModified")) {
          if ($dateIso) { break }
          try {
            $dt = $entry.ExtendedProperty($prop)
            if ($null -ne $dt) {
              $dtVal = [datetime]$dt
              if ($dtVal.Year -ge 2000 -and $dtVal.Year -le 2100) {
                $dateIso = $dtVal.ToString('o')
              }
            }
          } catch {
            # Optional property
          }
        }
        if (-not $dateIso) {
          try {
            $md = $entry.ModifyDate
            if ($null -ne $md) {
              $mdVal = [datetime]$md
              if ($mdVal.Year -ge 2000 -and $mdVal.Year -le 2100) {
                $dateIso = $mdVal.ToString('o')
              }
            }
          } catch {
            [void]$warnings.Add("Date($displayName): " + $_.Exception.Message)
          }
        }

        [void]$results.Add([ordered]@{
          name = $displayName
          wpdName = $wpdName
          shellPath = $entryShellPath
          kind = 'file'
          size = $itemSize
          modifiedAt = $dateIso
          path = $nextFilePath
          sourceFolder = $parentFolderName
        })
      }
    } catch {
      [void]$warnings.Add("Entry: " + $_.Exception.Message)
    }
  }
}

Scan-WpdFolder $rootFolder '' '' 0

$envelope = [ordered]@{
  items = $results
  warnings = $warnings
}

Write-Output '${JSON_START_MARKER}'
Write-Output (ConvertTo-OpenFsJson $envelope)
Write-Output '${JSON_END_MARKER}'
`;

  const { stdout } = await runPowerShellEncoded(
    ps,
    { deviceKey },
    { timeout: 90000 }
  );

  const parsed = parseMarkedJson(stdout, { items: [], warnings: [] });
  if (Array.isArray(parsed.warnings) && parsed.warnings.length > 0) {
    logWarn('wpd', `scanIphoneMedia avertissements (${parsed.warnings.length})`, parsed.warnings[0]);
  }
  const rawList = Array.isArray(parsed.items)
    ? parsed.items
    : parsed.items
      ? [parsed.items]
      : [];

  const maxValidTs = Date.now() + 365 * 24 * 3600 * 1000;
  const enriched = rawList.map((item) => {
    const mediaType = classifyMediaType(item.name);
    let dateStr = item.modifiedAt || '';
    const parsedTime = dateStr ? Date.parse(dateStr) : NaN;
    if (!dateStr || Number.isNaN(parsedTime) || parsedTime < Date.UTC(2000, 0, 1) || parsedTime > maxValidTs) {
      dateStr = inferDateFromFolderName(item.sourceFolder) || new Date().toISOString();
    }
    return {
      ...item,
      modifiedAt: dateStr,
      mediaType,
    };
  });

  // Strict chronological ordering (newest first), keeping Live Photo pairs (.HEIC right next to .MOV) cleanly grouped
  enriched.sort((a, b) => {
    const ta = Date.parse(a.modifiedAt || '') || 0;
    const tb = Date.parse(b.modifiedAt || '') || 0;
    if (tb !== ta) return tb - ta;
    const baseA = String(a.name || '').replace(/\.[^.]+$/, '');
    const baseB = String(b.name || '').replace(/\.[^.]+$/, '');
    const baseCmp = baseB.localeCompare(baseA, 'fr', { numeric: true, sensitivity: 'base' });
    if (baseCmp !== 0) return baseCmp;
    // Place photo (.HEIC/.JPG) before companion video (.MOV)
    if (a.mediaType !== b.mediaType) {
      if (a.mediaType === 'photo') return -1;
      if (b.mediaType === 'photo') return 1;
    }
    return String(a.name || '').localeCompare(String(b.name || ''), 'fr', { numeric: true });
  });

  logInfo('wpd', `scanIphoneMedia terminé : ${enriched.length} fichiers classés chronologiquement`);
  return enriched;
}

/**
 * Generates Windows Shell thumbnails (JPEG) keyed strictly by unique item.key (shellPath).
 * Uses safe 24bpp JPEG rendering, SIIGBF flag cascade (0x09 -> 0x08 -> 0x01 -> 0x00),
 * logs exact HRESULT failures, and recovers partial disk output even on MTP slowdowns.
 */
async function generateThumbnailsBatch(items, maxSize = 360) {
  if (!Array.isArray(items) || items.length === 0) return {};
  ensureCacheDirs();
  const result = {};
  const named = items.filter((it) => it && it.key && it.name && /\.(heic|heif|jpe?g|png|mov|mp4|m4v)$/i.test(it.name));
  if (named.length > 0 && (await getFastMediaUdid())) {
    let next = 0;
    const worker = async () => {
      while (next < named.length) {
        const it = named[next++];
        try {
          const p = await getIosThumbnailPath(it.key, it.name, it.size);
          if (p) result[it.key] = p;
        } catch (err) {
          logWarn('thumbs', `Miniature iOS indisponible pour ${it.name}`, err);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, named.length) }, worker));
  }
  const remaining = items.filter((it) => it && it.key && !result[it.key]);
  if (remaining.length === 0) return result;
  return { ...(await generateShellThumbnailsBatch(remaining, maxSize)), ...result };
}

async function generateShellThumbnailsBatch(items, maxSize = 360) {
  if (process.platform !== 'win32' || !Array.isArray(items) || items.length === 0) {
    return {};
  }

  ensureCacheDirs();

  const result = {};
  const toGenerate = [];

  for (const item of items) {
    if (!item || !item.key || !item.shellPath) continue;
    const outPath = path.join(THUMB_CACHE_ROOT, `${hashKey(`${item.key}|${maxSize}|v2`)}.jpg`);
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
$items = @($payload.items | Where-Object { $null -ne $_ })
$maxSize = [int]$payload.maxSize
$generated = @{}
$errors = New-Object System.Collections.ArrayList
[int[]]$flagsOrder = @(9, 8, 1, 0)

foreach ($item in $items) {
  try {
    $sp = [string]$item.shellPath
    $outFile = [string]$item.outPath
    $errMsg = [OpenFsThumbExtractor]::SaveThumbnailWithFallback($sp, $outFile, $maxSize, $flagsOrder, 82L)
    if ([string]::IsNullOrEmpty($errMsg) -and (Test-Path -LiteralPath $outFile)) {
      $generated[[string]$item.key] = $outFile
    } elseif ($errors.Count -lt 5) {
      [void]$errors.Add(([string]$item.key) + " => " + $errMsg)
    }
  } catch {
    if ($errors.Count -lt 5) {
      [void]$errors.Add("PS exception: " + $_.Exception.Message)
    }
  }
}

$envelope = [ordered]@{
  generated = $generated
  errors = $errors
}

Write-Output '${JSON_START_MARKER}'
Write-Output (ConvertTo-OpenFsJson $envelope)
Write-Output '${JSON_END_MARKER}'
`;

  try {
    const { stdout } = await runPowerShellEncoded(
      ps,
      { items: toGenerate, maxSize },
      { timeout: 60000 }
    );
    const parsed = parseMarkedJson(stdout, { generated: {}, errors: [] });
    if (parsed && typeof parsed.generated === 'object') {
      for (const [k, v] of Object.entries(parsed.generated)) {
        if (typeof v === 'string' && fs.existsSync(v) && fs.statSync(v).size > 200) {
          result[k] = v;
        }
      }
    }
    if (Array.isArray(parsed?.errors) && parsed.errors.length > 0) {
      logWarn(
        'thumbs',
        `${parsed.errors.length} miniature(s) non extraite(s) sur ce lot`,
        parsed.errors[0]
      );
    }
  } catch (err) {
    logWarn('thumbs', 'Lot de vignettes partiellement échoué ou lent sur MTP', err);
  } finally {
    // Always salvage any JPEGs already written to disk even if MTP timed out mid-batch!
    for (const item of toGenerate) {
      if (!result[item.key] && fs.existsSync(item.outPath)) {
        try {
          if (fs.statSync(item.outPath).size > 200) {
            result[item.key] = item.outPath;
          }
        } catch (statErr) {
          logWarn('thumbs', `Vérification cache miniature ignorée : ${item.outPath}`, statErr);
        }
      }
    }
  }

  return result;
}

async function convertLocalHeicToJpg(localPath) {
  if (process.platform !== 'win32') return null;
  ensureCacheDirs();
  const stat = fs.statSync(localPath);
  const outJpg = path.join(
    PREVIEW_CACHE_ROOT,
    `heic_${hashKey(`${localPath}|${stat.size}|${stat.mtimeMs}|v2`)}.jpg`
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
[int[]]$flagsOrder = @(1, 0, 9, 8)
$errMsg = [OpenFsThumbExtractor]::SaveThumbnailWithFallback($src, $dst, 1920, $flagsOrder, 88L)
$ok = [string]::IsNullOrEmpty($errMsg) -and (Test-Path -LiteralPath $dst)
$res = [ordered]@{ ok = $ok; path = $dst; error = $errMsg }
Write-Output '${JSON_START_MARKER}'
Write-Output (ConvertTo-OpenFsJson $res)
Write-Output '${JSON_END_MARKER}'
`;

  try {
    const { stdout } = await runPowerShellEncoded(ps, { src: localPath, dst: outJpg }, { timeout: 30000 });
    const parsed = parseMarkedJson(stdout, { ok: false, error: '' });
    if (parsed?.ok && fs.existsSync(outJpg)) {
      return outJpg;
    }
    if (parsed?.error) {
      logWarn('preview', `Conversion HEIC→JPG refusée (${path.basename(localPath)})`, parsed.error);
    }
  } catch (err) {
    logWarn('preview', `Conversion HEIC→JPG échouée pour ${localPath}`, err);
  }
  return null;
}

/**
 * Copies a single WPD item from iPhone to PC, matching strictly by its unique `shellPath` (fixes Live Photos HEIC/MOV collision!),
 * stages it in an isolated folder to read its exact filename & compute streaming SHA-256, then copies to destPcDir and verifies SHA-256.
 */
async function copyWpdItemToPc(deviceKey, relativePath, destPcDir, shellPath = '', preferredName = '') {
  const segments = sanitizeSegments(relativePath);
  if (segments.length === 0 && !shellPath) {
    throw new Error('Chemin source iPhone vide.');
  }

  ensureCacheDirs();
  const resolvedDest = path.resolve(destPcDir);
  fs.mkdirSync(resolvedDest, { recursive: true });

  const stageDir = path.join(STAGE_ROOT, `job_${crypto.randomBytes(8).toString('hex')}`);
  fs.mkdirSync(stageDir, { recursive: true });

  const parentSegments = segments.slice(0, -1);
  const targetName = segments[segments.length - 1] || preferredName || '';

  const ps = `
$payloadJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($env:OPENFS_PAYLOAD_B64))
$payload = $payloadJson | ConvertFrom-Json
$devKey = [string]$payload.deviceKey
$parentSegs = @($payload.parentSegments | Where-Object { $null -ne $_ -and ([string]$_).Length -gt 0 })
$targetName = [string]$payload.targetName
$targetShellPath = [string]$payload.shellPath
$stageDir = [string]$payload.stageDir

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
  throw "iPhone déconnecté ou introuvable dans Windows WPD."
}

$folder = $deviceItem.GetFolder
if ($null -eq $folder) {
  throw "Stockage iPhone inaccessible. Déverrouillez votre iPhone."
}

$copyWarnings = New-Object System.Collections.Generic.List[string]
foreach ($seg in $parentSegs) {
  $found = $null
  foreach ($child in $folder.Items()) {
    $childName = [string]$child.Name
    $extName = ''
    try { $extName = [string]$child.ExtendedProperty("System.FileName") } catch { $copyWarnings.Add("ParentFileName($childName): " + $_.Exception.Message) }
    if (($childName -eq $seg) -or ($extName -and $extName -eq $seg)) {
      $found = $child
      break
    }
  }
  if (-not $found) { throw "Dossier iPhone introuvable : $seg" }
  $folder = $found.GetFolder
  if ($null -eq $folder) { throw "Dossier iPhone verrouillé : $seg" }
}

$sourceItem = $null
$realFileName = $targetName

# 1. Exact match by unique WPD shellPath (100% safe for Live Photos HEIC vs MOV!)
if ($targetShellPath) {
  foreach ($child in $folder.Items()) {
    if ([string]$child.Path -eq $targetShellPath) {
      $sourceItem = $child
      $extName = ''
      try { $extName = [string]$child.ExtendedProperty("System.FileName") } catch { $copyWarnings.Add("ShellMatchFileName: " + $_.Exception.Message) }
      if ($extName -and $extName.Trim().Length -gt 0) {
        $realFileName = $extName.Trim()
      } else {
        $realFileName = [string]$child.Name
      }
      break
    }
  }
}

# 2. Fallback match by full System.FileName (with extension), then WPD Name
if (-not $sourceItem) {
  foreach ($child in $folder.Items()) {
    $childName = [string]$child.Name
    $extName = ''
    try { $extName = [string]$child.ExtendedProperty("System.FileName") } catch { $copyWarnings.Add("FallbackFileName($childName): " + $_.Exception.Message) }
    if (($extName -and $extName -eq $targetName) -or ($childName -eq $targetName)) {
      $sourceItem = $child
      if ($extName -and $extName.Trim().Length -gt 0) {
        $realFileName = $extName.Trim()
      } else {
        $realFileName = $childName
      }
      break
    }
  }
}

if (-not $sourceItem) {
  throw "Fichier iPhone introuvable (peut-être déconnecté) : $targetName"
}

$destFolder = $shell.Namespace($stageDir)
if (-not $destFolder) { throw "Dossier temporaire introuvable : $stageDir" }

# 16 = Yes to all, 4 = No progress dialog, 1024 = No error dialog
$destFolder.CopyHere($sourceItem, 1044)

$maxWaitMs = 90000
$waited = 0
$lastSize = -1
$stableTicks = 0
$stagedFile = ''

while ($waited -lt $maxWaitMs) {
  $foundFiles = @(Get-ChildItem -LiteralPath $stageDir -Force -ErrorAction SilentlyContinue)
  if ($foundFiles.Count -gt 0) {
    $first = $foundFiles[0]
    $stagedFile = $first.FullName
    if ($first.PSIsContainer) {
      Start-Sleep -Milliseconds 500
      break
    }
    if ($first.Length -gt 0 -and $first.Length -eq $lastSize) {
      $stableTicks++
      if ($stableTicks -ge 2) { break }
    } else {
      $lastSize = $first.Length
      $stableTicks = 0
    }
  }
  Start-Sleep -Milliseconds 250
  $waited += 250
}

if (-not $stagedFile -or -not (Test-Path -LiteralPath $stagedFile)) {
  throw "Transfert interrompu : aucun fichier reçu de l'iPhone (câble débranché ou appareil verrouillé)."
}

Write-Output '${JSON_START_MARKER}'
Write-Output (ConvertTo-OpenFsJson ([ordered]@{ stagedPath = $stagedFile; realFileName = $realFileName }))
Write-Output '${JSON_END_MARKER}'
`;

  try {
    const { stdout } = await runPowerShellEncoded(
      ps,
      {
        deviceKey,
        parentSegments,
        targetName,
        shellPath: String(shellPath || ''),
        stageDir,
      },
      { timeout: 130000 }
    );

    const parsed = parseMarkedJson(stdout, null);
    const stagedPath = parsed?.stagedPath;
    if (!stagedPath || !fs.existsSync(stagedPath)) {
      throw new Error('Le fichier copié depuis l’iPhone est introuvable après transfert.');
    }

    const stat = fs.statSync(stagedPath);
    const fileName = path.basename(stagedPath) || preferredName || targetName || 'fichier_iphone';
    const finalDestPath = path.join(resolvedDest, fileName);

    if (stat.isDirectory()) {
      fs.cpSync(stagedPath, finalDestPath, { recursive: true });
      return {
        copiedPath: finalDestPath,
        sourceSha256: '',
        destSha256: '',
        verified: true,
        size: 0,
      };
    }

    // Compute SHA-256 of the staged source copy from iPhone
    const sourceSha256 = await computeFileSha256(stagedPath);
    // Stream-copy into the user's destination PC directory
    await fs.promises.copyFile(stagedPath, finalDestPath);
    // Independently re-hash the final destination file to verify byte-for-byte integrity!
    const destSha256 = await computeFileSha256(finalDestPath);
    const verified = sourceSha256 === destSha256;

    if (!verified) {
      logError('wpd', `Empreinte SHA-256 différente après copie : ${fileName}`, {
        sourceSha256,
        destSha256,
      });
    }

    return {
      copiedPath: finalDestPath,
      sourceSha256,
      destSha256,
      verified,
      size: stat.size,
    };
  } finally {
    try {
      fs.rmSync(stageDir, { recursive: true, force: true });
    } catch (cleanErr) {
      logWarn('wpd', `Nettoyage stageDir échoué : ${stageDir}`, cleanErr);
    }
  }
}

/**
 * Builds preview descriptor + computes real streaming SHA-256 on the ORIGINAL file (before any HEIC->JPG conversion).
 * Handles binary .plist conversion to XML for inspection & in-place editing.
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

  // Compute streaming SHA-256 on the exact original file
  const sha256 = await computeFileSha256(safePath);

  // Binary .plist detection -> convert to XML using bundled plistutil!
  if (lower.endsWith('.plist') && isBinaryPlistFile(safePath)) {
    try {
      const xmlText = await convertBinaryPlistToXml(safePath);
      return {
        previewKind: 'text',
        localPath: safePath,
        mimeType: 'application/xml',
        size: stat.size,
        sha256,
        textContent: xmlText,
        isBinaryPlist: true,
        editable: true,
      };
    } catch (plistErr) {
      logWarn('preview', `Conversion plist binaire échouée pour ${name}`, plistErr);
    }
  }

  const isText =
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    /\.(txt|md|json|csv|log|xml|plist|ini|cfg|conf|env|js|ts|tsx|jsx|py|sh|bat|yaml|yml|css|html|sql|gitignore)$/i.test(
      lower
    );

  if (isText && stat.size <= 3 * 1024 * 1024) {
    const textContent = await fs.promises.readFile(safePath, 'utf8');
    return {
      previewKind: 'text',
      localPath: safePath,
      mimeType,
      size: stat.size,
      sha256,
      textContent,
      isBinaryPlist: false,
      editable: true,
    };
  }

  // HEIC / HEIF -> convert to crisp HD JPEG via Windows Shell / WIC so Electron <img> renders it natively
  if (/\.(heic|heif)$/i.test(lower)) {
    const convertedJpg = await convertLocalHeicToJpg(safePath);
    if (convertedJpg) {
      return {
        previewKind: 'image',
        localPath: convertedJpg,
        originalPath: safePath,
        mimeType: 'image/jpeg',
        size: stat.size,
        sha256,
      };
    }
  }

  if (mimeType.startsWith('image/')) {
    return {
      previewKind: 'image',
      localPath: safePath,
      mimeType,
      size: stat.size,
      sha256,
    };
  }

  if (mimeType.startsWith('video/')) {
    return {
      previewKind: 'video',
      localPath: safePath,
      mimeType,
      size: stat.size,
      sha256,
    };
  }

  if (mimeType.startsWith('audio/')) {
    return {
      previewKind: 'audio',
      localPath: safePath,
      mimeType,
      size: stat.size,
      sha256,
    };
  }

  if (mimeType === 'application/pdf') {
    return {
      previewKind: 'pdf',
      localPath: safePath,
      mimeType,
      size: stat.size,
      sha256,
    };
  }

  return {
    previewKind: 'unsupported',
    localPath: safePath,
    mimeType,
    size: stat.size,
    sha256,
  };
}

async function prepareIphonePreview(deviceId, relativePath, displayName, shellPath = '', afcOptions = {}) {
  if (typeof deviceId !== 'string' || !deviceId.includes(':')) {
    throw new Error('Identifiant iPhone invalide.');
  }
  const sepIndex = deviceId.indexOf(':');
  const backend = deviceId.slice(0, sepIndex);
  const deviceKey = deviceId.slice(sepIndex + 1);

  ensureCacheDirs();

  if (backend === 'afc') {
    const appTag = afcOptions?.appId || 'root';
    const cacheSubdir = path.join(PREVIEW_CACHE_ROOT, `afc_${hashKey(`${deviceKey}|${appTag}|${relativePath}`)}`);
    fs.mkdirSync(cacheSubdir, { recursive: true });
    const safeFileName = path.basename(displayName || relativePath || 'file.bin').replace(/[<>:"/\\|?*]/g, '_');
    const localTarget = path.join(cacheSubdir, safeFileName);
    // Always fetch fresh for editable files so re-reading after edit shows the real saved file from iPhone!
    await afcDownloadFile(deviceKey, relativePath, localTarget, { appId: afcOptions?.appId });
    return buildLocalPreviewDescriptor(localTarget, displayName || safeFileName);
  }

  if (backend !== 'wpd') {
    throw new Error('Prévisualisation disponible une fois l’iPhone déverrouillé.');
  }

  // Unique cache key based on shellPath so Live Photos (IMG_0289.HEIC vs IMG_0289.MOV) NEVER collide!
  const uniqueKey = shellPath ? `${deviceId}|${shellPath}` : `${deviceId}|${relativePath}|${displayName || ''}`;
  const cacheSubdir = path.join(PREVIEW_CACHE_ROOT, hashKey(uniqueKey));
  fs.mkdirSync(cacheSubdir, { recursive: true });

  const existingFiles = fs.readdirSync(cacheSubdir).filter((f) => !f.startsWith('heic_'));
  let cachedFilePath = existingFiles.length > 0 ? path.join(cacheSubdir, existingFiles[0]) : null;

  if (!cachedFilePath || !fs.existsSync(cachedFilePath) || fs.statSync(cachedFilePath).size === 0) {
    const fast = await resolveFastMedia(displayName, afcOptions && afcOptions.size);
    if (fast && isVideoName(displayName)) {
      // Stream the video straight from the iPhone (seekable) instead of copying it first.
      return {
        previewKind: 'video',
        streamSource: { udid: fast.udid, path: fast.path, size: fast.size, name: displayName },
        mimeType: 'video/mp4',
        size: fast.size,
        sha256: '',
      };
    }
    if (fast) {
      const target = path.join(cacheSubdir, path.basename(displayName).replace(/[<>:"/\\|?*]/g, '_'));
      try {
        await afcNative.nativeDownloadShared(fast.udid, fast.path, target);
        if (fs.existsSync(target) && fs.statSync(target).size === fast.size) {
          return buildLocalPreviewDescriptor(target, displayName);
        }
        fs.rmSync(target, { force: true });
      } catch (err) {
        logWarn('preview', `Téléchargement AFC échoué pour ${displayName}, repli sur WPD`, err);
        fs.rmSync(target, { force: true });
      }
    }
    const copied = await copyWpdItemToPc(deviceKey, relativePath, cacheSubdir, shellPath, displayName);
    cachedFilePath = copied.copiedPath;
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
      'Votre iPhone est branché mais encore verrouillé. Déverrouillez-le et appuyez sur « Autoriser » ou « Se fier ».'
    );
  }

  throw new Error(
    'Utilisez l’explorateur AFC pour parcourir ce périphérique.'
  );
}

async function copyFromIphoneToPc(deviceId, relativePath, destPcDir, shellPath = '', preferredName = '') {
  if (typeof deviceId !== 'string' || !deviceId.includes(':')) {
    throw new Error('Identifiant de périphérique iPhone invalide.');
  }
  const sepIndex = deviceId.indexOf(':');
  const backend = deviceId.slice(0, sepIndex);
  const rawId = deviceId.slice(sepIndex + 1);

  if (backend === 'wpd') {
    return copyWpdItemToPc(rawId, relativePath, destPcDir || getDefaultSyncDir(), shellPath, preferredName);
  }

  if (backend === 'afc') {
    const targetDir = path.resolve(destPcDir || getDefaultSyncDir());
    fs.mkdirSync(targetDir, { recursive: true });
    const fileName = preferredName || path.posix.basename(relativePath) || 'fichier_iphone';
    const destFile = path.join(targetDir, fileName);
    return afcDownloadFile(rawId, relativePath, destFile);
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
    } catch (statErr) {
      logWarn('pc', `Entrée PC ignorée (accès refusé) : ${fullPath}`, statErr);
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

function validateSimpleEntryName(rawName) {
  const name = String(rawName || '').trim();
  if (!name || name === '.' || name === '..' || /[\\/:*?"<>|\0]/.test(name)) {
    throw new Error('Nom invalide (caractères interdits : \\ / : * ? " < > |).');
  }
  return name;
}

async function pcCreateFolder(parentDir, folderName) {
  const safeParent = path.resolve(parentDir || getDefaultSyncDir());
  const cleanName = validateSimpleEntryName(folderName);
  const newPath = path.join(safeParent, cleanName);
  if (path.dirname(newPath) !== safeParent) {
    throw new Error('Chemin de dossier non autorisé.');
  }
  if (fs.existsSync(newPath)) {
    throw new Error(`Un élément nommé « ${cleanName} » existe déjà.`);
  }
  await fs.promises.mkdir(newPath, { recursive: false });
  logInfo('pc', `Dossier créé : ${newPath}`);
  return { path: newPath, name: cleanName };
}

async function pcRenameItem(targetPath, newName) {
  const safeTarget = path.resolve(targetPath);
  if (!fs.existsSync(safeTarget)) {
    throw new Error('Élément introuvable sur le disque.');
  }
  const cleanName = validateSimpleEntryName(newName);
  const parentDir = path.dirname(safeTarget);
  const destPath = path.join(parentDir, cleanName);
  if (path.dirname(destPath) !== parentDir) {
    throw new Error('Renommage hors du dossier parent interdit.');
  }
  if (destPath.toLowerCase() !== safeTarget.toLowerCase() && fs.existsSync(destPath)) {
    throw new Error(`Un élément nommé « ${cleanName} » existe déjà.`);
  }
  await fs.promises.rename(safeTarget, destPath);
  logInfo('pc', `Renommé : ${safeTarget} -> ${destPath}`);
  return { oldPath: safeTarget, newPath: destPath, name: cleanName };
}

async function pcSaveTextFile(filePath, textContent, options = {}) {
  const safePath = path.resolve(filePath);
  if (options.convertToBinaryPlist) {
    await convertXmlTextToBinaryPlist(String(textContent ?? ''), safePath);
  } else {
    await fs.promises.writeFile(safePath, String(textContent ?? ''), 'utf8');
  }
  const stat = fs.statSync(safePath);
  const sha256 = await computeFileSha256(safePath);
  return {
    path: safePath,
    size: stat.size,
    sha256,
    verified: true,
    savedAsBinaryPlist: Boolean(options.convertToBinaryPlist),
  };
}

async function addPathToZip(zipFolder, diskPath, entryName) {
  const stat = await fs.promises.stat(diskPath);
  if (stat.isDirectory()) {
    const sub = zipFolder.folder(entryName);
    const children = await fs.promises.readdir(diskPath);
    let count = 0;
    for (const child of children) {
      count += await addPathToZip(sub, path.join(diskPath, child), child);
    }
    return count;
  }
  const data = await fs.promises.readFile(diskPath);
  zipFolder.file(entryName, data);
  return 1;
}

async function pcCompressZip(sourcePaths, destZipName) {
  if (!Array.isArray(sourcePaths) || sourcePaths.length === 0) {
    throw new Error('Sélectionnez au moins un fichier ou dossier à compresser.');
  }
  const resolvedSources = sourcePaths.map((p) => path.resolve(p));
  for (const p of resolvedSources) {
    if (!fs.existsSync(p)) {
      throw new Error(`Élément introuvable : ${p}`);
    }
  }

  const parentDir = path.dirname(resolvedSources[0]);
  const rawName = destZipName
    ? validateSimpleEntryName(destZipName)
    : resolvedSources.length === 1
      ? `${path.basename(resolvedSources[0], path.extname(resolvedSources[0]))}.zip`
      : `Archive_${new Date().toISOString().slice(0, 10)}.zip`;
  const finalZipName = rawName.toLowerCase().endsWith('.zip') ? rawName : `${rawName}.zip`;
  const destZipPath = path.join(parentDir, finalZipName);

  const zip = new JSZip();
  let fileCount = 0;
  for (const src of resolvedSources) {
    fileCount += await addPathToZip(zip, src, path.basename(src));
  }

  const zipBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  await fs.promises.writeFile(destZipPath, zipBuffer);
  const sha256 = await computeFileSha256(destZipPath);
  logInfo('pc', `Archive ZIP créée : ${destZipPath} (${fileCount} fichier(s))`);

  return {
    zipPath: destZipPath,
    name: finalZipName,
    size: zipBuffer.length,
    sha256,
    fileCount,
  };
}

/**
 * Builds one .zip from several files (iPhone camera roll, iPhone AFC storage / app documents, or PC
 * files) and writes it to destPath, chosen by the user in a « Enregistrer sous » dialog.
 * The archive is streamed to disk (archiver, ZIP64 when needed), so many large videos never sit in
 * memory and archives over 4 GB stay valid. Photos/videos are stored without recompression (they are
 * already compressed). Camera-roll files are streamed straight from the iPhone over AFC when
 * Apple Devices is available, otherwise copied one at a time through Windows (WPD).
 */
async function zipIphoneItems(options = {}, onProgress = () => {}) {
  const archiver = require('archiver');
  const { Readable } = require('stream');
  const { deviceId, afcUdid, appId, items, destPath } = options;
  if (!Array.isArray(items) || items.length === 0) throw new Error('Aucun fichier à compresser.');
  if (!destPath) throw new Error('Choisissez où enregistrer l’archive .zip.');

  const finalPath = path.resolve(destPath.toLowerCase().endsWith('.zip') ? destPath : `${destPath}.zip`);
  await fs.promises.mkdir(path.dirname(finalPath), { recursive: true });
  const partPath = `${finalPath}.part`;
  const stageDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'openfs-zip-'));
  const output = fs.createWriteStream(partPath);
  const archive = archiver('zip', { zlib: { level: 6 }, forceZip64: false });
  let streamError = null;
  archive.on('warning', (err) => logWarn('zip', 'Avertissement pendant la compression', err));
  archive.on('error', (err) => { streamError = err; });
  output.on('error', (err) => { streamError = err; });
  archive.pipe(output);
  const outputClosed = new Promise((resolve) => output.on('close', resolve));

  const usedNames = new Set();
  const uniqueEntryName = (name) => {
    const clean = path.basename(String(name || 'fichier')).replace(/[<>:"/\\|?*]/g, '_');
    const ext = path.extname(clean);
    const base = clean.slice(0, clean.length - ext.length);
    let candidate = clean;
    for (let n = 2; usedNames.has(candidate.toLowerCase()); n++) candidate = `${base} (${n})${ext}`;
    usedNames.add(candidate.toLowerCase());
    return candidate;
  };
  const isAlreadyCompressed = (name) =>
    /\.(heic|heif|jpe?g|png|gif|webp|mov|mp4|m4v|avi|mkv|mp3|m4a|aac|zip|7z|rar|gz|pdf)$/i.test(name);

  try {
    for (let i = 0; i < items.length; i++) {
      if (streamError) throw streamError;
      const item = items[i];
      const entryName = uniqueEntryName(item.name);
      let source = null;
      let stagedFile = null;

      if (item.localPath) {
        source = fs.createReadStream(path.resolve(item.localPath));
      } else if (afcUdid) {
        stagedFile = path.join(stageDir, `${i}_${entryName}`);
        await afcDownloadFile(afcUdid, item.relativePath, stagedFile, { appId: appId || undefined });
      } else {
        const fast = await resolveFastMedia(item.name, item.size);
        if (fast) {
          source = Readable.fromWeb(afcNative.createRangeStream(fast.udid, fast.path, 0, Math.max(0, fast.size - 1)));
        } else {
          const itemStage = path.join(stageDir, String(i));
          await fs.promises.mkdir(itemStage, { recursive: true });
          const copied = await copyFromIphoneToPc(deviceId, item.relativePath, itemStage, item.shellPath || '', item.name);
          stagedFile = copied && copied.copiedPath ? copied.copiedPath : null;
        }
      }
      if (!source) {
        if (!stagedFile || !fs.existsSync(stagedFile)) throw new Error(`Impossible de récupérer « ${item.name} ».`);
        source = fs.createReadStream(stagedFile);
      }

      const entryDone = new Promise((resolve, reject) => {
        const onEntry = () => { cleanup(); resolve(); };
        const onErr = (err) => { cleanup(); reject(err); };
        const cleanup = () => { archive.off('entry', onEntry); archive.off('error', onErr); source.off?.('error', onErr); };
        archive.on('entry', onEntry);
        archive.on('error', onErr);
        source.on?.('error', onErr);
      });
      archive.append(source, { name: entryName, store: isAlreadyCompressed(entryName) });
      await entryDone;
      if (stagedFile) await fs.promises.rm(stagedFile, { force: true }).catch(() => {});
      onProgress({ done: i + 1, total: items.length, name: entryName });
    }

    await archive.finalize();
    await outputClosed;
    if (streamError) throw streamError;
    for (let n = 0; n < 5; n++) {
      try { await fs.promises.rename(partPath, finalPath); break; } catch (err) {
        if (n === 4) throw err;
        if (err.code === 'EEXIST' || err.code === 'EPERM') await fs.promises.rm(finalPath, { force: true }).catch(() => {});
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    const stat = await fs.promises.stat(finalPath);
    const sha256 = await computeFileSha256(finalPath);
    logInfo('zip', `Archive créée : ${finalPath} (${items.length} fichier(s), ${stat.size} octets)`);
    return {
      zipPath: finalPath,
      name: path.basename(finalPath),
      destDir: path.dirname(finalPath),
      size: stat.size,
      sha256,
      fileCount: items.length,
    };
  } catch (err) {
    archive.abort();
    output.destroy();
    await fs.promises.rm(partPath, { force: true }).catch(() => {});
    throw err;
  } finally {
    await fs.promises.rm(stageDir, { recursive: true, force: true }).catch((err) =>
      logWarn('zip', 'Nettoyage du dossier temporaire de compression échoué', err)
    );
  }
}

async function pcExtractZip(zipPath) {
  const safeZip = path.resolve(zipPath);
  if (!fs.existsSync(safeZip)) {
    throw new Error('Archive ZIP introuvable.');
  }
  const parentDir = path.dirname(safeZip);
  const baseName = path.basename(safeZip, path.extname(safeZip)) || 'Extrait';

  let extractRoot = path.join(parentDir, baseName);
  let counter = 2;
  while (fs.existsSync(extractRoot)) {
    extractRoot = path.join(parentDir, `${baseName} (${counter})`);
    counter += 1;
  }
  const resolvedRoot = path.resolve(extractRoot);
  fs.mkdirSync(resolvedRoot, { recursive: true });

  const zipData = await fs.promises.readFile(safeZip);
  const zip = await JSZip.loadAsync(zipData);

  let fileCount = 0;
  const entries = Object.values(zip.files);
  for (const entry of entries) {
    const cleanRel = entry.name.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!cleanRel || cleanRel.includes('__MACOSX/')) continue;
    const outPath = path.resolve(resolvedRoot, cleanRel);
    // Strict Zip-Slip protection
    if (outPath !== resolvedRoot && !outPath.startsWith(resolvedRoot + path.sep)) {
      throw new Error(`Archive bloquée par sécurité (chemin dangereux détecté : ${entry.name}).`);
    }
    if (entry.dir) {
      fs.mkdirSync(outPath, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      const content = await entry.async('nodebuffer');
      await fs.promises.writeFile(outPath, content);
      fileCount += 1;
    }
  }

  logInfo('pc', `Archive ZIP extraite : ${resolvedRoot} (${fileCount} fichier(s))`);
  return {
    extractDir: resolvedRoot,
    name: path.basename(resolvedRoot),
    fileCount,
  };
}

module.exports = {
  getQuickIphonePreview,
  getDefaultSyncDir,
  getSystemFolder,
  computeFileSha256,
  listIphoneDevices,
  listIphoneDirectory,
  scanIphoneMedia,
  generateThumbnailsBatch,
  prepareIphonePreview,
  preparePcPreview,
  copyFromIphoneToPc,
  listPcDirectory,
  pcCreateFolder,
  pcRenameItem,
  pcSaveTextFile,
  pcCompressZip,
  zipIphoneItems,
  pcExtractZip,
};
