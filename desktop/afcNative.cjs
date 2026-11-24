// Native AFC access to the iPhone without external binaries.
//
// Uses appium-ios-device (pure JavaScript, Apache-2.0) to talk to Apple's usbmuxd:
//   - Windows: the "Apple Devices" app (Microsoft Store) listens on 127.0.0.1:27015
//   - Linux:   the usbmuxd daemon socket (/var/run/usbmuxd)
// This replaces afcclient / idevice_id / ideviceinstaller, which are not available on Windows
// (MSYS2's libimobiledevice 1.3.0 does not ship afcclient).
const fs = require('fs');
const { pipeline } = require('stream/promises');
const { logWarn } = require('./logger.cjs');

let iosDevice = null;
function lib() {
  if (!iosDevice) iosDevice = require('appium-ios-device');
  return iosDevice;
}

// AFC operation codes not exposed by appium-ios-device's AfcService
const AFC_OP_RENAME_PATH = 0x18;
const AFC_OP_FILE_SEEK = 0x11;
const AFC_FOPEN_RDONLY = 1;
// Largest read per AFC request: the library rejects frames above 1 MB, and big reads
// are ~3x faster than its 64 KB read stream (30 Mo/s vs 11 Mo/s measured on an iPhone).
const AFC_READ_CHUNK = 960 * 1024;
const LIST_INFO_CONCURRENCY = 8;

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} : délai dépassé (${ms} ms)`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Returns the UDIDs seen by Apple's usbmuxd, or null when usbmuxd is unreachable. */
async function getNativeUdids(timeoutMs = 4000) {
  try {
    return await withTimeout(lib().utilities.getConnectedDevices(), timeoutMs, 'usbmuxd');
  } catch (err) {
    logWarn('afc-native', 'usbmuxd injoignable (Apple Devices absent ou arrêté ?)', err);
    return null;
  }
}

async function isNativeAvailable() {
  return (await getNativeUdids()) !== null;
}

async function listNativeDevices() {
  const udids = await getNativeUdids();
  if (!udids || udids.length === 0) return [];
  const { utilities } = lib();
  const devices = [];
  for (const udid of udids) {
    let info = null;
    let lockdownError = '';
    try {
      info = await withTimeout(utilities.getDeviceInfo(udid), 8000, 'Lecture des infos iPhone');
    } catch (err) {
      lockdownError = String(err && err.message ? err.message : err);
      logWarn('afc-native', `Infos iPhone indisponibles pour ${udid}`, lockdownError);
    }
    const paired = Boolean(info);
    const model = info ? info.ProductType || 'iPhone' : 'iPhone';
    const iosVersion = info ? info.ProductVersion || '' : '';
    devices.push({
      id: `afc:${udid}`,
      udid,
      name: (info && info.DeviceName) || 'Apple iPhone',
      model: iosVersion ? `${model} · iOS ${iosVersion}` : model,
      serialNumber: udid,
      vendorId: '0x05AC',
      productId: '0x12A8',
      backend: 'afc',
      status: paired ? 'ready' : 'locked',
      accessible: paired,
      paired,
      hint: paired
        ? undefined
        : 'Déverrouillez votre iPhone et touchez « Se fier à cet ordinateur », puis réessayez.',
    });
  }
  return devices;
}

/**
 * Pairing is handled by Apple Devices / usbmuxd itself: when the iPhone shows « Se fier à cet
 * ordinateur » and the user accepts, the pair record becomes available. We only re-check it.
 */
async function nativePair(udid) {
  const devices = await listNativeDevices();
  const dev = devices.find((d) => !udid || d.udid === udid) || devices[0];
  if (!dev) {
    return { paired: false, message: 'Aucun iPhone détecté. Branchez-le et déverrouillez-le.' };
  }
  if (dev.paired) {
    return { paired: true, message: 'iPhone appairé : accès complet activé.' };
  }
  return {
    paired: false,
    needsTrust: true,
    message:
      'Déverrouillez votre iPhone et touchez « Se fier à cet ordinateur », puis cliquez de nouveau sur « Appairer ».',
  };
}

/**
 * appium-ios-device emits socket/decoder errors as 'error' events; without listeners Node
 * crashes the whole process. Log them and mark the client dead instead.
 */
function guardAfcClient(afc, onDead) {
  if (!afc || afc.__openfsGuarded) return afc;
  afc.__openfsGuarded = true;
  afc.__openfsDead = false;
  const markDead = (err) => {
    if (afc.__openfsDead) return;
    afc.__openfsDead = true;
    if (err) logWarn('afc-native', 'Connexion AFC interrompue', err);
    if (onDead) onDead();
  };
  for (const stream of [afc._socketClient, afc._splitter, afc._decoder, afc._encoder]) {
    if (stream && typeof stream.on === 'function') stream.on('error', markDead);
  }
  if (afc._socketClient) {
    afc._socketClient.once('close', () => markDead());
    afc._socketClient.once('end', () => markDead());
  }
  return afc;
}

function isAfcAlive(afc) {
  const sock = afc && afc._socketClient;
  return Boolean(afc && !afc.__openfsDead && sock && !sock.destroyed && sock.writable !== false);
}

/** Opens an AFC client on the media storage, or on an app's Documents (house_arrest) when appId is set. */
async function openAfc(udid, appId) {
  const { services } = lib();
  if (appId) {
    const houseArrest = await services.startHouseArrestService(udid);
    try {
      const afc = guardAfcClient(await houseArrest.vendDocuments(appId));
      return {
        afc,
        close: () => {
          try { afc.close(); } catch (err) { logWarn('afc-native', 'Fermeture AFC (app) échouée', err); }
          try { houseArrest.close(); } catch (err) { logWarn('afc-native', 'Fermeture house_arrest échouée', err); }
        },
      };
    } catch (err) {
      try { houseArrest.close(); } catch (closeErr) { logWarn('afc-native', 'Fermeture house_arrest échouée', closeErr); }
      throw new Error(`Accès aux documents de l’app ${appId} refusé : ${err.message}`);
    }
  }
  const afc = guardAfcClient(await services.startAfcService(udid));
  return {
    afc,
    close: () => {
      try { afc.close(); } catch (err) { logWarn('afc-native', 'Fermeture AFC échouée', err); }
    },
  };
}

async function withAfc(udid, appId, fn) {
  const session = await openAfc(udid, appId);
  try {
    return await fn(session.afc);
  } finally {
    session.close();
  }
}

function joinRemote(dir, name) {
  return dir === '/' ? `/${name}` : `${dir}/${name}`;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function nativeListDirectory(udid, remotePath, { appId = null, showHidden = true } = {}) {
  return withAfc(udid, appId, async (afc) => {
    const names = (await afc.listDirectory(remotePath)).filter((n) => n && n !== '.' && n !== '..');
    const visible = showHidden ? names : names.filter((n) => !n.startsWith('.'));
    const entries = await mapLimit(visible, LIST_INFO_CONCURRENCY, async (name) => {
      const fullPath = joinRemote(remotePath, name);
      let info = null;
      try {
        info = await afc.getFileInfo(fullPath);
      } catch (err) {
        logWarn('afc-native', `Infos indisponibles pour ${fullPath}`, err);
      }
      const isFolder = info ? info.isDirectory() : false;
      const mtime = info && info.mtimeMs ? new Date(info.mtimeMs) : null;
      return {
        name,
        kind: isFolder ? 'folder' : 'file',
        size: isFolder || !info ? 0 : info.size,
        modifiedAt: mtime && !Number.isNaN(mtime.getTime()) ? mtime.toISOString() : new Date().toISOString(),
        path: fullPath,
        permissions: isFolder ? 'drwxr-xr-x' : '-rw-r--r--',
        hidden: name.startsWith('.'),
      };
    });
    entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' });
    });
    return entries;
  });
}

async function nativeListSharedApps(udid) {
  const { services } = lib();
  const proxy = await services.startInstallationProxyService(udid);
  let apps;
  try {
    apps = await proxy.listApplications({
      applicationType: 'User',
      returnAttributes: [
        'CFBundleIdentifier',
        'CFBundleDisplayName',
        'CFBundleName',
        'CFBundleShortVersionString',
        'CFBundleVersion',
        'UIFileSharingEnabled',
        'LSSupportsOpeningDocumentsInPlace',
      ],
    });
  } finally {
    try { proxy.close(); } catch (err) { logWarn('afc-native', 'Fermeture installation_proxy échouée', err); }
  }
  const list = Object.values(apps || {}).map((a) => ({
    bundleId: a.CFBundleIdentifier,
    name: a.CFBundleDisplayName || a.CFBundleName || a.CFBundleIdentifier,
    version: a.CFBundleShortVersionString || a.CFBundleVersion || '',
    // Only UIFileSharingEnabled apps can be opened through house_arrest "VendDocuments";
    // LSSupportsOpeningDocumentsInPlace alone (e.g. WhatsApp) fails with InstallationLookupFailed.
    fileSharingEnabled: Boolean(a.UIFileSharingEnabled),
  }));
  list.sort((a, b) => {
    if (a.fileSharingEnabled !== b.fileSharingEnabled) return a.fileSharingEnabled ? -1 : 1;
    return String(a.name).localeCompare(String(b.name), 'fr', { sensitivity: 'base' });
  });
  return list;
}

async function afcSeek(afc, handle, offset) {
  const { packetNumber, response } = afc._createPacketPromise(`Seek ${handle} -> ${offset}`);
  const payload = Buffer.alloc(24);
  payload.writeBigUInt64LE(BigInt(handle), 0);
  payload.writeBigUInt64LE(0n, 8); // SEEK_SET
  payload.writeBigUInt64LE(BigInt(offset), 16);
  afc._encoder.write({ opCode: AFC_OP_FILE_SEEK, packetNumber, headerPayload: payload });
  afc._checkStatus(await response);
}

/** Copies a whole iPhone file to disk with large AFC reads. */
async function readWholeFileTo(afc, remotePath, destLocalPath) {
  const handle = await afc.openFile(remotePath, AFC_FOPEN_RDONLY);
  const out = fs.createWriteStream(destLocalPath);
  try {
    for (;;) {
      const chunk = await afc.readFile(handle, AFC_READ_CHUNK);
      if (!chunk || chunk.length === 0) break;
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    }
  } finally {
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
    await afc.closeFileHandle(handle).catch((err) => logWarn('afc-native', 'Fermeture fichier AFC échouée', err));
  }
}

async function nativeDownload(udid, remotePath, destLocalPath, { appId = null } = {}) {
  await withAfc(udid, appId, async (afc) => {
    const info = await afc.getFileInfo(remotePath);
    if (info.isDirectory()) throw new Error(`« ${remotePath} » est un dossier, pas un fichier.`);
    await readWholeFileTo(afc, remotePath, destLocalPath);
  });
}

// --- Long-lived media session (thumbnails, previews, video streaming) ---
// Opening an AFC service costs a lockdown handshake; previews reuse one session per iPhone.
const mediaSessions = new Map();

async function getMediaSession(udid) {
  let entry = mediaSessions.get(udid);
  if (entry && entry.afc && !isAfcAlive(entry.afc)) {
    mediaSessions.delete(udid);
    entry = null;
  }
  if (!entry) {
    const created = { afc: null, promise: null };
    created.promise = lib()
      .services.startAfcService(udid)
      .then((afc) => {
        created.afc = guardAfcClient(afc, () => {
          if (mediaSessions.get(udid) === created) mediaSessions.delete(udid);
        });
        return afc;
      });
    created.promise.catch(() => {
      if (mediaSessions.get(udid) === created) mediaSessions.delete(udid);
    });
    mediaSessions.set(udid, created);
    entry = created;
  }
  return entry.promise;
}

/**
 * Forgets the shared session after a transport error. Other requests may still be using it,
 * so it is closed later instead of immediately (closing it under them crashed the process).
 */
function dropMediaSession(udid) {
  const entry = mediaSessions.get(udid);
  if (!entry) return;
  mediaSessions.delete(udid);
  entry.promise.then(
    (afc) => {
      setTimeout(() => {
        try { afc.close(); } catch (err) { logWarn('afc-native', 'Fermeture session média échouée', err); }
      }, 30000).unref?.();
    },
    () => {}
  );
}

function isNotFoundError(err) {
  return /not found|ObjectNotFound|No such file/i.test(String(err && err.message));
}

/** Runs fn with the shared media session, reconnecting once if the session went stale. */
async function withMediaSession(udid, fn) {
  try {
    return await fn(await getMediaSession(udid));
  } catch (err) {
    if (isNotFoundError(err)) throw err;
    logWarn('afc-native', 'Requête AFC échouée, nouvelle connexion', err);
    dropMediaSession(udid);
    return fn(await getMediaSession(udid));
  }
}

async function readSmallFile(udid, remotePath) {
  return withMediaSession(udid, async (afc) => {
    const handle = await afc.openFile(remotePath, AFC_FOPEN_RDONLY);
    const parts = [];
    try {
      for (;;) {
        const chunk = await afc.readFile(handle, AFC_READ_CHUNK);
        if (!chunk || chunk.length === 0) break;
        parts.push(chunk);
      }
    } finally {
      await afc.closeFileHandle(handle).catch(() => {});
    }
    return Buffer.concat(parts);
  });
}

async function nativeDownloadShared(udid, remotePath, destLocalPath) {
  return withMediaSession(udid, (afc) => readWholeFileTo(afc, remotePath, destLocalPath));
}

/**
 * Index of the camera roll as seen by AFC: lower-case file name -> [{ path, size, folder, name }].
 * Lets Windows (WPD) media items be matched to their AFC path by name + size.
 */
const dcimIndexCache = new Map();
const DCIM_INDEX_TTL_MS = 2 * 60 * 1000;

async function getDcimIndex(udid, { refresh = false } = {}) {
  const cached = dcimIndexCache.get(udid);
  if (!refresh && cached && Date.now() - cached.at < DCIM_INDEX_TTL_MS) return cached.index;
  if (!refresh && cached && cached.pending) return cached.pending;
  const pending = withMediaSession(udid, async (afc) => {
    const map = new Map();
    const folders = (await afc.listDirectory('/DCIM')).filter((n) => n && !n.startsWith('.'));
    for (const folder of folders) {
      const names = (await afc.listDirectory(`/DCIM/${folder}`)).filter((n) => n && n !== '.' && n !== '..');
      const infos = await mapLimit(names, LIST_INFO_CONCURRENCY, async (name) => {
        try { return await afc.getFileInfo(`/DCIM/${folder}/${name}`); } catch { return null; }
      });
      names.forEach((name, i) => {
        if (!infos[i] || infos[i].isDirectory()) return;
        const key = name.toLowerCase();
        if (!map.has(key)) map.set(key, []);
        map.get(key).push({ path: `/DCIM/${folder}/${name}`, size: infos[i].size, folder, name });
      });
    }
    return map;
  });
  dcimIndexCache.set(udid, { ...(cached || {}), pending });
  try {
    const index = await pending;
    dcimIndexCache.set(udid, { at: Date.now(), index });
    return index;
  } catch (err) {
    dcimIndexCache.delete(udid);
    throw err;
  }
}

/** Finds the AFC path of a camera-roll file from its name (and size when known). */
async function findDcimFile(udid, name, size) {
  if (!name) return null;
  const pick = (index) => {
    const matches = index.get(String(name).toLowerCase()) || [];
    if (size) return matches.find((m) => m.size === Number(size)) || null;
    return matches.length === 1 ? matches[0] : null;
  };
  const hit = pick(await getDcimIndex(udid));
  if (hit) return hit;
  return pick(await getDcimIndex(udid, { refresh: true }));
}

/** JPEG preview that iOS already generated for a camera-roll item (about 360x480), or null. */
async function readIosThumbnail(udid, dcimEntry) {
  const dir = `/PhotoData/Thumbnails/V2/DCIM/${dcimEntry.folder}/${dcimEntry.name}`;
  try {
    const buf = await readSmallFile(udid, `${dir}/5005.JPG`);
    return buf.length > 0 ? buf : null;
  } catch (err) {
    if (!isNotFoundError(err)) logWarn('afc-native', `Miniature iOS illisible (${dir})`, err);
    return null;
  }
}

/**
 * Web ReadableStream over bytes [start, end] of an iPhone file, read lazily in AFC chunks.
 * Feeds the <video> element with HTTP Range semantics, so playback starts without a full copy.
 */
function createRangeStream(udid, remotePath, start, end) {
  let afc = null;
  let handle = null;
  let position = start;
  const close = async () => {
    if (afc && handle !== null) {
      const h = handle;
      handle = null;
      await afc.closeFileHandle(h).catch(() => {});
    }
  };
  return new ReadableStream(
    {
      async start() {
        afc = await getMediaSession(udid);
        handle = await afc.openFile(remotePath, AFC_FOPEN_RDONLY);
        if (start > 0) await afcSeek(afc, handle, start);
      },
      async pull(controller) {
        try {
          if (position > end) {
            await close();
            controller.close();
            return;
          }
          const want = Math.min(AFC_READ_CHUNK, end - position + 1);
          const chunk = await afc.readFile(handle, want);
          if (!chunk || chunk.length === 0) {
            await close();
            controller.close();
            return;
          }
          position += chunk.length;
          controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.length));
        } catch (err) {
          logWarn('afc-native', `Lecture vidéo interrompue (${remotePath})`, err);
          await close();
          dropMediaSession(udid);
          controller.error(err);
        }
      },
      async cancel() {
        await close();
      },
    },
    { highWaterMark: 2 }
  );
}

async function nativeUpload(udid, localFilePath, remoteFilePath, { appId = null } = {}) {
  await withAfc(udid, appId, async (afc) => {
    const writeStream = await afc.createWriteStream(remoteFilePath, { autoDestroy: true });
    await pipeline(fs.createReadStream(localFilePath), writeStream);
  });
}

async function nativeMkdir(udid, remotePath, { appId = null } = {}) {
  await withAfc(udid, appId, (afc) => afc.createDirectory(remotePath));
}

async function nativeDelete(udid, remotePath, { appId = null } = {}) {
  // REMOVE_PATH_AND_CONTENTS: works for files and (recursively) for folders.
  await withAfc(udid, appId, (afc) => afc.deleteDirectory(remotePath));
}

async function nativeRename(udid, oldPath, newPath, { appId = null } = {}) {
  await withAfc(udid, appId, async (afc) => {
    // AfcService has no rename(): send the AFC RenamePath operation through its own encoder,
    // with the same packet/response handling it uses for deleteDirectory().
    if (typeof afc._createPacketPromise !== 'function' || !afc._encoder) {
      throw new Error('Renommage iPhone non pris en charge par cette version de la bibliothèque AFC.');
    }
    const { packetNumber, response } = afc._createPacketPromise(`Rename '${oldPath}' -> '${newPath}'`);
    afc._encoder.write({
      opCode: AFC_OP_RENAME_PATH,
      packetNumber,
      headerPayload: Buffer.concat([Buffer.from(oldPath), Buffer.from([0]), Buffer.from(newPath), Buffer.from([0])]),
    });
    afc._checkStatus(await response);
  });
}

// --- Property lists (replaces plistutil) ---
function binaryPlistToXml(buffer) {
  const bplistParser = require('bplist-parser');
  const plist = require('plist');
  const parsed = bplistParser.parseBuffer(buffer);
  return plist.build(parsed.length === 1 ? parsed[0] : parsed);
}

function xmlToBinaryPlist(xmlText) {
  const bplistCreator = require('bplist-creator');
  const plist = require('plist');
  return bplistCreator(plist.parse(xmlText));
}

module.exports = {
  nativeDownloadShared,
  getDcimIndex,
  findDcimFile,
  readIosThumbnail,
  createRangeStream,
  getNativeUdids,
  isNativeAvailable,
  listNativeDevices,
  nativePair,
  nativeListDirectory,
  nativeListSharedApps,
  nativeDownload,
  nativeUpload,
  nativeMkdir,
  nativeDelete,
  nativeRename,
  binaryPlistToXml,
  xmlToBinaryPlist,
};
