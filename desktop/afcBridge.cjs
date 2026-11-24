const crypto = require('crypto');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { logError, logInfo, logWarn } = require('./logger.cjs');
const native = require('./afcNative.cjs');

// The afcclient CLI is not available on Windows (not shipped by MSYS2's libimobiledevice 1.3.0).
// Without it, every AFC operation goes through the built-in native client (afcNative.cjs).
function hasAfcCli() {
  return resolveBinary('afcclient').found;
}

const APPLE_DEVICES_STORE_URL = 'ms-windows-store://pdp/?ProductId=9NP83LWLPZ9K';
const AFC_WORK_ROOT = path.join(os.tmpdir(), 'openfs-afc-work');

function ensureAfcWorkDir() {
  fs.mkdirSync(AFC_WORK_ROOT, { recursive: true });
}

function computeFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', (err) => reject(err));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function getBundledBinDirs() {
  const candidates = [];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'libimobiledevice'));
  }
  candidates.push(path.join(__dirname, 'resources', 'libimobiledevice'));
  return candidates.filter((dir) => {
    try {
      return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
    } catch (err) {
      logWarn('afc', `Impossible d'inspecter le dossier binaire ${dir}`, err);
      return false;
    }
  });
}

function resolveBinary(toolName) {
  const exeName = process.platform === 'win32' ? `${toolName}.exe` : toolName;
  const bundledDirs = getBundledBinDirs();

  for (const dir of bundledDirs) {
    const candidate = path.join(dir, exeName);
    if (fs.existsSync(candidate)) {
      return { cmd: candidate, dir, bundled: true, found: true };
    }
  }

  // Fallback to system PATH (standard on Linux or developer setups)
  const pathEnv = process.env.PATH || '';
  const sep = process.platform === 'win32' ? ';' : ':';
  for (const dir of pathEnv.split(sep).filter(Boolean)) {
    const candidate = path.join(dir, exeName);
    if (fs.existsSync(candidate)) {
      return { cmd: candidate, dir, bundled: false, found: true };
    }
  }

  return { cmd: exeName, dir: null, bundled: false, found: false };
}

function execTool(toolName, args, options = {}) {
  const resolved = resolveBinary(toolName);
  const env = { ...process.env, ...(options.env || {}) };
  if (resolved.dir) {
    const sep = process.platform === 'win32' ? ';' : ':';
    env.PATH = `${resolved.dir}${sep}${env.PATH || ''}`;
  }

  return new Promise((resolve, reject) => {
    execFile(
      resolved.cmd,
      args,
      {
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 40 * 1024 * 1024,
        timeout: options.timeout ?? 30000,
        env,
      },
      (error, stdout, stderr) => {
        const out = String(stdout || '');
        const errOut = String(stderr || '');
        if (error) {
          const msg = errOut.trim() || out.trim() || error.message;
          const wrapped = new Error(msg);
          wrapped.stdout = out;
          wrapped.stderr = errOut;
          wrapped.code = error.code;
          reject(wrapped);
          return;
        }
        resolve({ stdout: out, stderr: errOut });
      }
    );
  });
}

function normalizeRemotePath(remotePath) {
  let raw = String(remotePath || '/').replace(/\\/g, '/').trim();
  if (!raw || raw === '.') return '/';
  if (!raw.startsWith('/')) raw = '/' + raw;
  const parts = raw.split('/').filter((seg) => seg.length > 0 && seg !== '.');
  for (const seg of parts) {
    if (seg === '..') {
      throw new Error('Chemin iPhone invalide (traversée de répertoire interdite).');
    }
  }
  return parts.length === 0 ? '/' : '/' + parts.join('/');
}

function buildAfcBaseArgs(udid, appId) {
  const args = [];
  if (udid && String(udid).trim()) {
    args.push('-u', String(udid).trim());
  }
  if (appId && String(appId).trim()) {
    args.push('--documents', String(appId).trim());
  }
  return args;
}

async function checkWindowsAmds() {
  if (process.platform !== 'win32') {
    return {
      platform: process.platform,
      applicable: false,
      installed: true,
      running: true,
      serviceName: null,
      status: 'not-applicable',
      storeUrl: APPLE_DEVICES_STORE_URL,
    };
  }

  const psScript = `
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$svc = Get-Service -ErrorAction SilentlyContinue | Where-Object {
  $_.Name -like '*Apple Mobile Device*' -or
  $_.DisplayName -like '*Apple Mobile Device*' -or
  $_.Name -eq 'AMDS'
} | Select-Object -First 1
if ($null -eq $svc) {
  Write-Output '{"installed":false,"running":false,"serviceName":"","status":"Missing"}'
} else {
  $obj = [PSCustomObject]@{
    installed = $true
    running = ($svc.Status -eq 'Running')
    serviceName = [string]$svc.DisplayName
    status = [string]$svc.Status
  }
  ConvertTo-Json -InputObject $obj -Compress
}
`;
  const encoded = Buffer.from(psScript, 'utf16le').toString('base64');

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, encoding: 'utf8', timeout: 8000 },
      (error, stdout, stderr) => {
        if (error) {
          logWarn('afc', 'Vérification Apple Mobile Device Service échouée', stderr || error.message);
          resolve({
            platform: 'win32',
            applicable: true,
            installed: false,
            running: false,
            serviceName: '',
            status: 'Unknown',
            error: String(stderr || error.message).trim(),
            storeUrl: APPLE_DEVICES_STORE_URL,
          });
          return;
        }
        try {
          const parsed = JSON.parse(String(stdout || '').trim() || '{}');
          resolve({
            platform: 'win32',
            applicable: true,
            installed: Boolean(parsed.installed),
            running: Boolean(parsed.running),
            serviceName: parsed.serviceName || 'Apple Mobile Device Service',
            status: parsed.status || 'Missing',
            storeUrl: APPLE_DEVICES_STORE_URL,
          });
        } catch (parseErr) {
          logWarn('afc', 'Réponse AMDS illisible', parseErr);
          resolve({
            platform: 'win32',
            applicable: true,
            installed: false,
            running: false,
            serviceName: '',
            status: 'ParseError',
            storeUrl: APPLE_DEVICES_STORE_URL,
          });
        }
      }
    );
  });
}

function getLinuxMountPoint() {
  return path.join(os.homedir(), 'iPhone-USB');
}

function detectLinuxDistro() {
  if (process.platform !== 'linux') {
    return { id: process.platform, prettyName: process.platform, family: 'other' };
  }
  try {
    const raw = fs.readFileSync('/etc/os-release', 'utf8');
    const map = {};
    for (const line of raw.split(/\r?\n/)) {
      const idx = line.indexOf('=');
      if (idx > 0) {
        const key = line.slice(0, idx).trim();
        const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
        map[key] = val;
      }
    }
    const id = (map.ID || '').toLowerCase();
    const idLike = (map.ID_LIKE || '').toLowerCase();
    let family = 'other';
    if (
      ['ubuntu', 'debian', 'linuxmint', 'pop', 'elementary', 'zorin', 'kali'].includes(id) ||
      idLike.includes('debian') ||
      idLike.includes('ubuntu')
    ) {
      family = 'debian';
    } else if (
      ['fedora', 'rhel', 'centos', 'rocky', 'almalinux'].includes(id) ||
      idLike.includes('fedora') ||
      idLike.includes('rhel')
    ) {
      family = 'fedora';
    } else if (
      ['arch', 'manjaro', 'endeavouros', 'garuda'].includes(id) ||
      idLike.includes('arch')
    ) {
      family = 'arch';
    }
    return {
      id: id || 'linux',
      prettyName: map.PRETTY_NAME || 'Linux',
      family,
    };
  } catch (err) {
    logWarn('linux', 'Impossible de lire /etc/os-release', err);
    return { id: 'linux', prettyName: 'Linux', family: 'other' };
  }
}

function getLinuxInstallCommand(family) {
  if (family === 'debian') {
    return 'sudo apt update && sudo apt install -y usbmuxd libimobiledevice-utils ifuse ideviceinstaller libplist-utils';
  }
  if (family === 'fedora') {
    return 'sudo dnf install -y usbmuxd libimobiledevice-utils ifuse ideviceinstaller libplist';
  }
  if (family === 'arch') {
    return 'sudo pacman -S --noconfirm usbmuxd libimobiledevice ifuse ideviceinstaller libplist';
  }
  return 'sudo apt update && sudo apt install -y usbmuxd libimobiledevice-utils ifuse ideviceinstaller libplist-utils';
}

function isLinuxIphoneMounted(mountPoint = getLinuxMountPoint()) {
  if (process.platform !== 'linux') return false;
  try {
    const mounts = fs.readFileSync('/proc/mounts', 'utf8');
    const normalized = path.resolve(mountPoint);
    return mounts.split(/\r?\n/).some((line) => {
      const parts = line.split(' ');
      return parts.length >= 2 && parts[1] === normalized;
    });
  } catch (err) {
    logWarn('linux', 'Impossible de lire /proc/mounts', err);
    return false;
  }
}

async function getLinuxStatus() {
  if (process.platform !== 'linux') {
    return {
      applicable: false,
      distro: { id: process.platform, prettyName: process.platform, family: 'other' },
      tools: {},
      missingTools: [],
      usbmuxdRunning: false,
      mountPoint: getLinuxMountPoint(),
      mounted: false,
      installCommand: '',
      hasPkexec: false,
    };
  }

  const distro = detectLinuxDistro();
  const required = [
    'usbmuxd',
    'idevice_id',
    'idevicepair',
    'afcclient',
    'ifuse',
    'ideviceinstaller',
    'plistutil',
  ];

  const tools = {};
  const missingTools = [];
  for (const name of required) {
    const res = resolveBinary(name);
    // Also check /usr/sbin for usbmuxd on Debian/Ubuntu
    let found = res.found;
    if (!found && name === 'usbmuxd') {
      found = fs.existsSync('/usr/sbin/usbmuxd') || fs.existsSync('/sbin/usbmuxd');
    }
    tools[name] = found;
    if (!found) missingTools.push(name);
  }

  let usbmuxdRunning = false;
  try {
    await new Promise((resolve, reject) => {
      execFile('pgrep', ['-x', 'usbmuxd'], { timeout: 3000 }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    usbmuxdRunning = true;
  } catch {
    usbmuxdRunning = fs.existsSync('/var/run/usbmuxd');
  }

  const mountPoint = getLinuxMountPoint();
  const mounted = isLinuxIphoneMounted(mountPoint);
  const hasPkexec = resolveBinary('pkexec').found;

  return {
    applicable: true,
    distro,
    tools,
    missingTools,
    usbmuxdRunning,
    mountPoint,
    mounted,
    installCommand: getLinuxInstallCommand(distro.family),
    hasPkexec,
  };
}

async function installLinuxDeps() {
  if (process.platform !== 'linux') {
    throw new Error('Installation automatique des paquets disponible uniquement sous Linux.');
  }
  const status = await getLinuxStatus();
  if (!status.hasPkexec) {
    throw new Error(
      `pkexec est introuvable. Exécutez cette commande dans un terminal : ${status.installCommand}`
    );
  }

  let script = '';
  if (status.distro.family === 'debian') {
    script =
      'apt-get update && apt-get install -y usbmuxd libimobiledevice-utils ifuse ideviceinstaller libplist-utils && (systemctl enable --now usbmuxd || true)';
  } else if (status.distro.family === 'fedora') {
    script =
      'dnf install -y usbmuxd libimobiledevice-utils ifuse ideviceinstaller libplist && (systemctl enable --now usbmuxd || true)';
  } else if (status.distro.family === 'arch') {
    script =
      'pacman -S --noconfirm usbmuxd libimobiledevice ifuse ideviceinstaller libplist && (systemctl enable --now usbmuxd || true)';
  } else {
    throw new Error(
      `Distribution non reconnue (${status.distro.prettyName}). Installez usbmuxd, libimobiledevice, ifuse, ideviceinstaller et libplist manuellement.`
    );
  }

  logInfo('linux', `Lancement pkexec pour ${status.distro.prettyName}`);
  await new Promise((resolve, reject) => {
    execFile(
      'pkexec',
      ['/bin/sh', '-c', script],
      { timeout: 180000, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const msg = String(stderr || stdout || error.message).trim();
          logError('linux', 'Échec installation dépendances via pkexec', msg);
          reject(new Error(`Installation annulée ou échouée : ${msg}`));
          return;
        }
        resolve();
      }
    );
  });

  return getLinuxStatus();
}

async function mountLinuxIphone(udid) {
  if (process.platform !== 'linux') {
    throw new Error('Montage ifuse réservé à Linux.');
  }
  const mountPoint = getLinuxMountPoint();
  fs.mkdirSync(mountPoint, { recursive: true });

  if (isLinuxIphoneMounted(mountPoint)) {
    return { mounted: true, mountPoint, message: `Déjà monté dans ${mountPoint}` };
  }

  // Try pairing first so the Trust prompt appears cleanly if needed
  try {
    await pairIphone(udid);
  } catch (pairErr) {
    logWarn('linux', 'Appairage préalable avant ifuse', pairErr);
  }

  const args = [];
  if (udid && String(udid).trim()) {
    args.push('-u', String(udid).trim());
  }
  args.push(mountPoint);

  try {
    await execTool('ifuse', args, { timeout: 20000 });
    logInfo('linux', `iPhone monté avec succès dans ${mountPoint}`);
    return { mounted: true, mountPoint, message: `iPhone monté dans ${mountPoint}` };
  } catch (err) {
    logError('linux', 'Échec du montage ifuse', err);
    throw new Error(
      `Impossible de monter l'iPhone dans ${mountPoint}. Déverrouillez votre iPhone et touchez « Se fier ». Détail : ${err.message}`
    );
  }
}

async function unmountLinuxIphone() {
  if (process.platform !== 'linux') {
    throw new Error('Démontage ifuse réservé à Linux.');
  }
  const mountPoint = getLinuxMountPoint();
  if (!isLinuxIphoneMounted(mountPoint)) {
    return { mounted: false, mountPoint, message: 'L’iPhone n’est pas monté.' };
  }

  try {
    await execTool('fusermount', ['-u', mountPoint], { timeout: 10000 });
  } catch (firstErr) {
    logWarn('linux', 'fusermount -u échoué, tentative umount', firstErr);
    await execTool('umount', [mountPoint], { timeout: 10000 });
  }

  logInfo('linux', `iPhone démonté proprement (${mountPoint})`);
  return { mounted: false, mountPoint, message: `iPhone démonté proprement (${mountPoint})` };
}

async function getAfcCapabilities() {
  const toolNames = [
    'idevice_id',
    'ideviceinfo',
    'idevicepair',
    'afcclient',
    'ideviceinstaller',
    'plistutil',
  ];
  const binaries = {};
  for (const t of toolNames) {
    const res = resolveBinary(t);
    binaries[t] = { found: res.found, bundled: res.bundled };
  }

  const amds = await checkWindowsAmds();
  const linux = await getLinuxStatus();
  const nativeUdids = await native.getNativeUdids();
  const nativeAvailable = nativeUdids !== null;

  // With the "Apple Devices" app, AppleMobileDeviceProcess.exe serves usbmuxd on 127.0.0.1:27015
  // but is not a classic Windows service: trust the live connection over the service lookup.
  if (process.platform === 'win32' && nativeAvailable) {
    amds.installed = true;
    amds.running = true;
    amds.status = 'Running';
    amds.serviceName = amds.serviceName || 'Apple Devices (usbmuxd 127.0.0.1:27015)';
  }

  const cliCoreAfc =
    binaries.idevice_id.found &&
    binaries.idevicepair.found &&
    binaries.afcclient.found;
  const hasCoreAfc = cliCoreAfc || nativeAvailable;

  if (nativeAvailable && !cliCoreAfc) {
    const ready = true;
    return {
      platform: process.platform,
      binaries,
      engine: 'native',
      hasCoreAfc,
      hasAppsSupport: true,
      hasPlistSupport: true,
      ready,
      amds,
      linux,
      storeUrl: APPLE_DEVICES_STORE_URL,
    };
  }

  const ready =
    cliCoreAfc &&
    (process.platform === 'win32'
      ? amds.installed && amds.running
      : process.platform === 'linux'
        ? linux.missingTools.length === 0
        : true);

  return {
    platform: process.platform,
    binaries,
    engine: cliCoreAfc ? 'cli' : 'none',
    hasCoreAfc,
    hasAppsSupport: binaries.ideviceinstaller.found && binaries.afcclient.found,
    hasPlistSupport: binaries.plistutil.found,
    ready,
    amds,
    linux,
    storeUrl: APPLE_DEVICES_STORE_URL,
  };
}

async function listAfcDevices() {
  const idBin = resolveBinary('idevice_id');
  if (!idBin.found || !hasAfcCli()) {
    return native.listNativeDevices();
  }

  try {
    const { stdout } = await execTool('idevice_id', ['-l'], { timeout: 4500 });
    const udids = Array.from(
      new Set(
        stdout
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
      )
    );
    if (udids.length === 0) return [];

    const devices = [];
    for (const udid of udids) {
      let name = 'Apple iPhone';
      let model = 'iPhone';
      let iosVersion = '';
      let paired = false;
      let pairHint = '';

      try {
        const val = await execTool('idevicepair', ['-u', udid, 'validate'], { timeout: 4500 });
        if (/SUCCESS/i.test(val.stdout)) {
          paired = true;
        }
      } catch (valErr) {
        const msg = String(valErr.message || '');
        if (/passcode|locked|trust|pair/i.test(msg)) {
          pairHint = 'Déverrouillez votre iPhone et touchez « Se fier à cet ordinateur ».';
        } else {
          pairHint = 'Appairage requis : déverrouillez votre iPhone et touchez « Se fier ».';
        }
        logWarn('afc', `Validation appairage non confirmée pour ${udid}`, msg);
      }

      if (paired) {
        try {
          const info = await execTool('ideviceinfo', ['-u', udid, '-k', 'DeviceName'], {
            timeout: 4500,
          });
          if (info.stdout.trim()) name = info.stdout.trim();
        } catch (err) {
          logWarn('afc', `ideviceinfo DeviceName échoué pour ${udid}`, err);
        }
        try {
          const prod = await execTool('ideviceinfo', ['-u', udid, '-k', 'ProductType'], {
            timeout: 4500,
          });
          if (prod.stdout.trim()) model = prod.stdout.trim();
        } catch (err) {
          logWarn('afc', `ideviceinfo ProductType échoué pour ${udid}`, err);
        }
        try {
          const ver = await execTool('ideviceinfo', ['-u', udid, '-k', 'ProductVersion'], {
            timeout: 4500,
          });
          if (ver.stdout.trim()) iosVersion = ver.stdout.trim();
        } catch (err) {
          logWarn('afc', `ideviceinfo ProductVersion échoué pour ${udid}`, err);
        }
      }

      devices.push({
        id: `afc:${udid}`,
        udid,
        name,
        model: iosVersion ? `${model} · iOS ${iosVersion}` : model,
        serialNumber: udid,
        vendorId: '0x05AC',
        productId: '0x12A8',
        backend: 'afc',
        status: paired ? 'ready' : 'locked',
        accessible: paired,
        paired,
        hint: paired ? undefined : pairHint || 'Déverrouillez votre iPhone et touchez « Se fier ».',
      });
    }

    return devices;
  } catch (err) {
    const msg = String(err.message || '');
    if (!/Unable to retrieve device list|No device found/i.test(msg)) {
      logWarn('afc', 'idevice_id -l a retourné une erreur', msg);
    }
    return [];
  }
}

async function pairIphone(udid) {
  if (!resolveBinary('idevicepair').found || !hasAfcCli()) {
    return native.nativePair(udid ? String(udid).trim() : '');
  }
  const args = udid && String(udid).trim() ? ['-u', String(udid).trim(), 'pair'] : ['pair'];
  try {
    const { stdout } = await execTool('idevicepair', args, { timeout: 15000 });
    const out = stdout.trim();
    if (/SUCCESS/i.test(out)) {
      logInfo('afc', `Appairage réussi pour ${udid || 'default'}`);
      return {
        paired: true,
        message: 'iPhone appairé avec succès ! Accès AFC complet activé.',
      };
    }
    return {
      paired: false,
      message: out || 'Déverrouillez votre iPhone et touchez « Se fier à cet ordinateur ».',
    };
  } catch (err) {
    const msg = String(err.message || '');
    logWarn('afc', `idevicepair pair non terminé pour ${udid || 'default'}`, msg);
    if (/trust|accept|dialog/i.test(msg)) {
      return {
        paired: false,
        needsTrust: true,
        message:
          'Déverrouillez votre iPhone et touchez « Se fier à cet ordinateur », puis cliquez de nouveau sur « Appairer ».',
      };
    }
    if (/passcode|locked/i.test(msg)) {
      return {
        paired: false,
        needsUnlock: true,
        message: 'Votre iPhone est verrouillé par code. Déverrouillez son écran puis réessayez.',
      };
    }
    throw new Error(`Échec de l’appairage AFC : ${msg}`);
  }
}

function parseAfcLsLine(line, parentRemotePath) {
  const trimmed = line.replace(/\r$/, '');
  if (!trimmed) return null;

  // Format: drwxr-xr-x 2 68 15 May 2024 14:22:10 Folder Name
  // or:     -rw-r--r-- 1 12345 2024-05-15 14:22:10 File Name.txt
  const longMatch = trimmed.match(
    /^([d\-lcbps][rwxstST\-]{9})\s+\d+\s+(\d+)\s+(.+?)\s{1,}(.+)$/
  );

  // Better explicit parser for afcclient ls -l:
  // afcclient prints: "%s %2llu %9llu %s %s\n" where date is e.g. "2024-05-15 14:22:10" or "May 15 14:22" or "15 May 2024 14:22:10"
  const isoDateMatch = trimmed.match(
    /^([d\-lcbps][rwxstST\-]{9})\s+\d+\s+(\d+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?)\s+(.+)$/
  );
  const dmyDateMatch = trimmed.match(
    /^([d\-lcbps][rwxstST\-]{9})\s+\d+\s+(\d+)\s+(\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\s+\d{2}:\d{2}:\d{2})\s+(.+)$/
  );
  const mdyDateMatch = trimmed.match(
    /^([d\-lcbps][rwxstST\-]{9})\s+\d+\s+(\d+)\s+([A-Za-z]{3}\s+\d{1,2}\s+(?:\d{4}|\d{2}:\d{2}))\s+(.+)$/
  );

  let mode = '-rw-r--r--';
  let size = 0;
  let dateRaw = '';
  let name = '';

  const matched = isoDateMatch || dmyDateMatch || mdyDateMatch;
  if (matched) {
    mode = matched[1];
    size = Number(matched[2]) || 0;
    dateRaw = matched[3];
    name = matched[4];
  } else if (longMatch) {
    mode = longMatch[1];
    size = Number(longMatch[2]) || 0;
    dateRaw = longMatch[3];
    name = longMatch[4];
  } else {
    // Plain name fallback
    name = trimmed.trim();
  }

  name = name.replace(/\/$/, '');
  if (!name || name === '.' || name === '..') return null;

  const isFolder = mode.startsWith('d');
  let modifiedAt = '';
  if (dateRaw) {
    const parsedTime = Date.parse(dateRaw);
    if (!Number.isNaN(parsedTime)) {
      modifiedAt = new Date(parsedTime).toISOString();
    }
  }

  const fullPath = parentRemotePath === '/' ? `/${name}` : `${parentRemotePath}/${name}`;
  return {
    name,
    kind: isFolder ? 'folder' : 'file',
    size: isFolder ? 0 : size,
    modifiedAt: modifiedAt || new Date().toISOString(),
    path: fullPath,
    permissions: mode,
    hidden: name.startsWith('.'),
  };
}

async function afcListDirectory(udid, remotePath = '/', options = {}) {
  const safeRemote = normalizeRemotePath(remotePath);
  const appId = options.appId || null;
  const showHidden = options.showHidden !== false;
  if (!hasAfcCli()) {
    return native.nativeListDirectory(udid, safeRemote, { appId, showHidden });
  }
  const baseArgs = buildAfcBaseArgs(udid, appId);

  const { stdout } = await execTool('afcclient', [...baseArgs, 'ls', '-l', safeRemote], {
    timeout: 25000,
  });

  const lines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const entries = [];
  for (const line of lines) {
    const parsed = parseAfcLsLine(line, safeRemote);
    if (!parsed) continue;
    if (!showHidden && parsed.hidden) continue;
    entries.push(parsed);
  }

  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' });
  });

  return entries;
}

function decodeXmlEntities(str) {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseAppsFromXml(xmlText) {
  const apps = [];
  const topArrayIdx = xmlText.indexOf('<array>');
  const body = topArrayIdx !== -1 ? xmlText.slice(topArrayIdx) : xmlText;

  // Extract each top-level <dict>...</dict> block cleanly by tracking nesting depth
  const dicts = [];
  let depth = 0;
  let startIdx = -1;
  const tagRegex = /<\/?dict\b[^>]*>/g;
  let m;
  while ((m = tagRegex.exec(body)) !== null) {
    if (m[0].startsWith('</')) {
      depth -= 1;
      if (depth === 0 && startIdx !== -1) {
        dicts.push(body.slice(startIdx, m.index + m[0].length));
        startIdx = -1;
      }
    } else {
      if (depth === 0) startIdx = m.index;
      depth += 1;
    }
  }

  for (const dictBlock of dicts) {
    const getStringKey = (key) => {
      const re = new RegExp(`<key>${key}</key>\\s*<string>([\\s\\S]*?)</string>`, 'i');
      const match = dictBlock.match(re);
      return match ? decodeXmlEntities(match[1].trim()) : '';
    };
    const getBoolKey = (key) => {
      const re = new RegExp(`<key>${key}</key>\\s*<(true|false)\\s*/>`, 'i');
      const match = dictBlock.match(re);
      return match ? match[1].toLowerCase() === 'true' : false;
    };

    const bundleId = getStringKey('CFBundleIdentifier');
    if (!bundleId) continue;
    const displayName =
      getStringKey('CFBundleDisplayName') || getStringKey('CFBundleName') || bundleId;
    const version = getStringKey('CFBundleShortVersionString') || getStringKey('CFBundleVersion');
    const fileSharingEnabled =
      getBoolKey('UIFileSharingEnabled') || getBoolKey('LSSupportsOpeningDocumentsInPlace');

    apps.push({
      bundleId,
      name: displayName,
      version,
      fileSharingEnabled,
    });
  }

  return apps;
}

async function listSharedApps(udid) {
  if (!udid) throw new Error('UDID iPhone requis pour lister les applications.');
  if (!resolveBinary('ideviceinstaller').found || !hasAfcCli()) {
    return native.nativeListSharedApps(udid);
  }

  let xmlOut = '';
  let plainOut = '';

  // Modern ideviceinstaller (>= 1.2.0) syntax
  try {
    const res = await execTool('ideviceinstaller', ['-u', udid, 'list', '--user', '--xml'], {
      timeout: 30000,
    });
    xmlOut = res.stdout;
  } catch (modernErr) {
    logWarn('afc', 'ideviceinstaller list --user --xml échoué, tentative syntaxe legacy', modernErr);
    // Legacy ideviceinstaller (< 1.2.0, common on Ubuntu 22.04/24.04) syntax
    try {
      const res = await execTool(
        'ideviceinstaller',
        ['-u', udid, '-l', '-o', 'list_user', '-o', 'xml'],
        { timeout: 30000 }
      );
      xmlOut = res.stdout;
    } catch (legacyXmlErr) {
      logWarn('afc', 'ideviceinstaller legacy xml échoué, tentative liste texte', legacyXmlErr);
      const res = await execTool('ideviceinstaller', ['-u', udid, '-l'], { timeout: 30000 });
      plainOut = res.stdout;
    }
  }

  let apps = [];
  if (xmlOut && xmlOut.includes('<plist')) {
    apps = parseAppsFromXml(xmlOut);
  } else if (plainOut) {
    // Plain lines like: com.videolan.vlc-ios, "3.5.0", "VLC" or com.foo.bar - Name 1.0
    for (const line of plainOut.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || /^Total:|^CFBundleIdentifier/i.test(trimmed)) continue;
      const csvMatch = trimmed.match(/^([^,\s]+),\s*"([^"]*)",\s*"([^"]*)"/);
      if (csvMatch) {
        apps.push({
          bundleId: csvMatch[1],
          version: csvMatch[2],
          name: csvMatch[3] || csvMatch[1],
          fileSharingEnabled: true,
        });
      } else {
        const dashMatch = trimmed.match(/^([^\s]+)\s+-\s+(.+)$/);
        if (dashMatch) {
          apps.push({
            bundleId: dashMatch[1],
            version: '',
            name: dashMatch[2].trim(),
            fileSharingEnabled: true,
          });
        }
      }
    }
  }

  // Sort: File-Sharing enabled apps first, then alphabetically
  apps.sort((a, b) => {
    if (a.fileSharingEnabled !== b.fileSharingEnabled) {
      return a.fileSharingEnabled ? -1 : 1;
    }
    return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
  });

  return apps;
}

async function afcDownloadFile(udid, remotePath, destLocalPath, options = {}) {
  const safeRemote = normalizeRemotePath(remotePath);
  const resolvedDest = path.resolve(destLocalPath);
  fs.mkdirSync(path.dirname(resolvedDest), { recursive: true });

  if (hasAfcCli()) {
    const baseArgs = buildAfcBaseArgs(udid, options.appId);
    await execTool('afcclient', [...baseArgs, 'get', safeRemote, resolvedDest], {
      timeout: 180000,
    });
  } else {
    await native.nativeDownload(udid, safeRemote, resolvedDest, { appId: options.appId });
  }

  if (!fs.existsSync(resolvedDest)) {
    throw new Error(`Le téléchargement AFC n’a pas créé le fichier attendu : ${resolvedDest}`);
  }

  const stat = fs.statSync(resolvedDest);
  const sha256 = await computeFileSha256(resolvedDest);

  return {
    copiedPath: resolvedDest,
    sourceSha256: sha256,
    destSha256: sha256,
    verified: true,
    size: stat.size,
  };
}

async function afcUploadFile(udid, localFilePath, remoteTargetDirOrFile, options = {}) {
  const safeLocal = path.resolve(localFilePath);
  if (!fs.existsSync(safeLocal)) {
    throw new Error(`Fichier PC introuvable : ${safeLocal}`);
  }
  const stat = fs.statSync(safeLocal);
  if (stat.isDirectory()) {
    throw new Error('Envoi de fichier uniquement ; créez un dossier puis transférez son contenu.');
  }

  let targetRemote = normalizeRemotePath(remoteTargetDirOrFile);
  if (options.isTargetDirectory) {
    const fileName = path.basename(safeLocal);
    targetRemote = targetRemote === '/' ? `/${fileName}` : `${targetRemote}/${fileName}`;
  }

  const sourceSha256 = await computeFileSha256(safeLocal);
  const baseArgs = buildAfcBaseArgs(udid, options.appId);
  const useCli = hasAfcCli();

  if (useCli) {
    await execTool('afcclient', [...baseArgs, 'put', safeLocal, targetRemote], {
      timeout: 180000,
    });
  } else {
    await native.nativeUpload(udid, safeLocal, targetRemote, { appId: options.appId });
  }

  // Verify integrity by reading back the uploaded file and comparing SHA-256
  ensureAfcWorkDir();
  const verifyPath = path.join(
    AFC_WORK_ROOT,
    `verify_${crypto.randomBytes(8).toString('hex')}_${path.basename(safeLocal)}`
  );
  let destSha256 = '';
  let verified = false;
  try {
    if (useCli) {
      await execTool('afcclient', [...baseArgs, 'get', targetRemote, verifyPath], {
        timeout: 180000,
      });
    } else {
      await native.nativeDownload(udid, targetRemote, verifyPath, { appId: options.appId });
    }
    destSha256 = await computeFileSha256(verifyPath);
    verified = destSha256 === sourceSha256;
  } catch (verifyErr) {
    logWarn('afc', `Relecture de contrôle SHA-256 échouée pour ${targetRemote}`, verifyErr);
  } finally {
    try {
      if (fs.existsSync(verifyPath)) fs.unlinkSync(verifyPath);
    } catch (cleanErr) {
      logWarn('afc', 'Nettoyage fichier temporaire de vérification échoué', cleanErr);
    }
  }

  return {
    remotePath: targetRemote,
    sourceSha256,
    destSha256,
    verified,
    size: stat.size,
  };
}

async function afcMkdir(udid, parentRemotePath, folderName, options = {}) {
  const cleanName = String(folderName || '').trim();
  if (!cleanName || /[\\/]/.test(cleanName) || cleanName === '.' || cleanName === '..') {
    throw new Error('Nom de dossier invalide.');
  }
  const parent = normalizeRemotePath(parentRemotePath);
  const newPath = parent === '/' ? `/${cleanName}` : `${parent}/${cleanName}`;
  if (!hasAfcCli()) {
    await native.nativeMkdir(udid, newPath, { appId: options.appId });
    return { remotePath: newPath };
  }
  const baseArgs = buildAfcBaseArgs(udid, options.appId);

  await execTool('afcclient', [...baseArgs, 'mkdir', newPath], { timeout: 15000 });
  return { remotePath: newPath };
}

async function afcRename(udid, oldRemotePath, newName, options = {}) {
  const cleanName = String(newName || '').trim();
  if (!cleanName || /[\\/]/.test(cleanName) || cleanName === '.' || cleanName === '..') {
    throw new Error('Nouveau nom invalide.');
  }
  const oldPath = normalizeRemotePath(oldRemotePath);
  if (oldPath === '/') {
    throw new Error('Impossible de renommer la racine.');
  }
  const parentDir = path.posix.dirname(oldPath);
  const newPath = parentDir === '/' ? `/${cleanName}` : `${parentDir}/${cleanName}`;
  if (!hasAfcCli()) {
    await native.nativeRename(udid, oldPath, newPath, { appId: options.appId });
    return { oldPath, newPath };
  }
  const baseArgs = buildAfcBaseArgs(udid, options.appId);

  await execTool('afcclient', [...baseArgs, 'rename', oldPath, newPath], { timeout: 15000 });
  return { oldPath, newPath };
}

async function afcDelete(udid, remotePath, options = {}) {
  const safeRemote = normalizeRemotePath(remotePath);
  if (safeRemote === '/' || safeRemote.length <= 1) {
    throw new Error('Suppression de la racine interdite par sécurité.');
  }
  if (!hasAfcCli()) {
    await native.nativeDelete(udid, safeRemote, { appId: options.appId });
    return { deletedPath: safeRemote };
  }
  const baseArgs = buildAfcBaseArgs(udid, options.appId);
  const rmArgs = options.recursive ? ['rm', '-rf', safeRemote] : ['rm', safeRemote];
  await execTool('afcclient', [...baseArgs, ...rmArgs], { timeout: 30000 });
  return { deletedPath: safeRemote };
}

function isBinaryPlistFile(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(8);
    const bytesRead = fs.readSync(fd, buf, 0, 8, 0);
    fs.closeSync(fd);
    return bytesRead >= 6 && buf.toString('ascii', 0, 6) === 'bplist';
  } catch (err) {
    logWarn('plist', `Impossible de lire l'en-tête de ${filePath}`, err);
    return false;
  }
}

async function convertBinaryPlistToXml(inputPath) {
  if (!resolveBinary('plistutil').found) {
    return native.binaryPlistToXml(await fs.promises.readFile(inputPath));
  }
  ensureAfcWorkDir();
  const outXml = path.join(
    AFC_WORK_ROOT,
    `plist_xml_${crypto.randomBytes(8).toString('hex')}.xml`
  );
  await execTool('plistutil', ['-i', inputPath, '-f', 'xml', '-o', outXml], { timeout: 15000 });
  const xmlText = await fs.promises.readFile(outXml, 'utf8');
  try {
    fs.unlinkSync(outXml);
  } catch (err) {
    logWarn('plist', 'Nettoyage plist XML temporaire échoué', err);
  }
  return xmlText;
}

async function convertXmlTextToBinaryPlist(xmlText, outBinaryPath) {
  if (!resolveBinary('plistutil').found) {
    await fs.promises.writeFile(outBinaryPath, native.xmlToBinaryPlist(String(xmlText)));
    return;
  }
  ensureAfcWorkDir();
  const tmpXml = path.join(
    AFC_WORK_ROOT,
    `plist_in_${crypto.randomBytes(8).toString('hex')}.xml`
  );
  await fs.promises.writeFile(tmpXml, xmlText, 'utf8');
  try {
    await execTool('plistutil', ['-i', tmpXml, '-f', 'bin', '-o', outBinaryPath], {
      timeout: 15000,
    });
  } finally {
    try {
      if (fs.existsSync(tmpXml)) fs.unlinkSync(tmpXml);
    } catch (err) {
      logWarn('plist', 'Nettoyage plist tmpXml échoué', err);
    }
  }
}

async function afcReadEditableFile(udid, remotePath, options = {}) {
  ensureAfcWorkDir();
  const safeRemote = normalizeRemotePath(remotePath);
  const ext = path.posix.extname(safeRemote) || '.txt';
  const tempFile = path.join(
    AFC_WORK_ROOT,
    `edit_read_${crypto.randomBytes(8).toString('hex')}${ext}`
  );

  try {
    const dl = await afcDownloadFile(udid, safeRemote, tempFile, options);
    const binaryPlist = isBinaryPlistFile(tempFile);
    let textContent = '';
    if (binaryPlist) {
      textContent = await convertBinaryPlistToXml(tempFile);
    } else {
      textContent = await fs.promises.readFile(tempFile, 'utf8');
    }

    return {
      remotePath: safeRemote,
      textContent,
      isBinaryPlist: binaryPlist,
      sha256: dl.destSha256,
      size: dl.size,
    };
  } finally {
    try {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    } catch (err) {
      logWarn('afc', 'Nettoyage fichier temporaire d’édition échoué', err);
    }
  }
}

async function afcSaveEditableFile(udid, remotePath, textContent, options = {}) {
  ensureAfcWorkDir();
  const safeRemote = normalizeRemotePath(remotePath);
  const ext = path.posix.extname(safeRemote) || '.txt';
  const tempUpload = path.join(
    AFC_WORK_ROOT,
    `edit_save_${crypto.randomBytes(8).toString('hex')}${ext}`
  );

  try {
    if (options.convertToBinaryPlist) {
      await convertXmlTextToBinaryPlist(String(textContent ?? ''), tempUpload);
    } else {
      await fs.promises.writeFile(tempUpload, String(textContent ?? ''), 'utf8');
    }

    const res = await afcUploadFile(udid, tempUpload, safeRemote, {
      appId: options.appId,
      isTargetDirectory: false,
    });

    return {
      ...res,
      savedAsBinaryPlist: Boolean(options.convertToBinaryPlist),
    };
  } finally {
    try {
      if (fs.existsSync(tempUpload)) fs.unlinkSync(tempUpload);
    } catch (err) {
      logWarn('afc', 'Nettoyage fichier temporaire de sauvegarde échoué', err);
    }
  }
}

module.exports = {
  APPLE_DEVICES_STORE_URL,
  computeFileSha256,
  resolveBinary,
  checkWindowsAmds,
  getLinuxStatus,
  installLinuxDeps,
  mountLinuxIphone,
  unmountLinuxIphone,
  getAfcCapabilities,
  listAfcDevices,
  pairIphone,
  afcListDirectory,
  listSharedApps,
  afcDownloadFile,
  afcUploadFile,
  afcMkdir,
  afcRename,
  afcDelete,
  isBinaryPlistFile,
  convertBinaryPlistToXml,
  convertXmlTextToBinaryPlist,
  afcReadEditableFile,
  afcSaveEditableFile,
};
