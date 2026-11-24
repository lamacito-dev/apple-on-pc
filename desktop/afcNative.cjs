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

// AFC operation code for RenamePath (not exposed by appium-ios-device's AfcService)
const AFC_OP_RENAME_PATH = 0x18;
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

/** Opens an AFC client on the media storage, or on an app's Documents (house_arrest) when appId is set. */
async function openAfc(udid, appId) {
  const { services } = lib();
  if (appId) {
    const houseArrest = await services.startHouseArrestService(udid);
    try {
      const afc = await houseArrest.vendDocuments(appId);
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
  const afc = await services.startAfcService(udid);
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

async function nativeDownload(udid, remotePath, destLocalPath, { appId = null } = {}) {
  await withAfc(udid, appId, async (afc) => {
    const info = await afc.getFileInfo(remotePath);
    if (info.isDirectory()) throw new Error(`« ${remotePath} » est un dossier, pas un fichier.`);
    const readStream = await afc.createReadStream(remotePath, { autoDestroy: true });
    await pipeline(readStream, fs.createWriteStream(destLocalPath));
  });
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
