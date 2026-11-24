const crypto = require('crypto');
const { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { getLogFilePath, getRecentLogs, logError, logInfo, logWarn } = require('./logger.cjs');
const {
  APPLE_DEVICES_STORE_URL,
  afcDelete,
  afcDownloadFile,
  afcListDirectory,
  afcMkdir,
  afcReadEditableFile,
  afcRename,
  afcSaveEditableFile,
  afcUploadFile,
  getAfcCapabilities,
  getLinuxStatus,
  installLinuxDeps,
  listSharedApps,
  mountLinuxIphone,
  pairIphone,
  unmountLinuxIphone,
} = require('./afcBridge.cjs');
const {
  computeFileSha256,
  copyFromIphoneToPc,
  generateThumbnailsBatch,
  getDefaultSyncDir,
  getSystemFolder,
  listIphoneDevices,
  listIphoneDirectory,
  listPcDirectory,
  pcCompressZip,
  pcCreateFolder,
  pcExtractZip,
  pcRenameItem,
  pcSaveTextFile,
  prepareIphonePreview,
  preparePcPreview,
  scanIphoneMedia,
  getQuickIphonePreview,
} = require('./iphoneBridge.cjs');
const { createRangeStream } = require('./afcNative.cjs');

let mainWindow = null;

// Secure session-scoped token map for streaming local preview images, HEIC conversions, videos, and PDFs
const mediaTokenToPath = new Map();
const pathToMediaToken = new Map();

function registerMediaUrl(localFilePath) {
  const resolved = path.resolve(localFilePath);
  const existing = pathToMediaToken.get(resolved);
  if (existing) {
    return `openfs-local://media/${existing}`;
  }
  const token = crypto.randomBytes(16).toString('hex') + path.extname(resolved).toLowerCase();
  mediaTokenToPath.set(token, resolved);
  pathToMediaToken.set(resolved, token);
  return `openfs-local://media/${token}`;
}

// Videos streamed straight from the iPhone over AFC: token -> { udid, path, size, name }
const streamTokenToSource = new Map();
const streamKeyToToken = new Map();

function registerStreamUrl(source) {
  const key = `${source.udid}|${source.path}`;
  let token = streamKeyToToken.get(key);
  if (!token) {
    token = crypto.randomBytes(16).toString('hex') + path.extname(source.name || source.path).toLowerCase();
    streamTokenToSource.set(token, source);
    streamKeyToToken.set(key, token);
  }
  return `openfs-local://stream/${token}`;
}

function serveStream(request, token) {
  const source = streamTokenToSource.get(token);
  if (!source) return new Response('Not found', { status: 404 });
  const size = Number(source.size) || 0;
  const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') || '');
  let start = 0;
  let end = size - 1;
  if (range) {
    if (range[1] === '' && range[2] !== '') {
      start = Math.max(0, size - Number(range[2]));
    } else {
      start = Number(range[1] || 0);
      if (range[2] !== '') end = Math.min(Number(range[2]), size - 1);
    }
  }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  const headers = {
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Content-Length': String(end - start + 1),
    'Cache-Control': 'no-store',
  };
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  return new Response(createRangeStream(source.udid, source.path, start, end), {
    status: range ? 206 : 200,
    headers,
  });
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'openfs-local',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);

function enforceOfflineNetworkPolicy() {
  const isDevServer = Boolean(process.env.OPENFS_DEV_URL);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url || '';
    if (
      url.startsWith('file://') ||
      url.startsWith('openfs-local://') ||
      url.startsWith('data:') ||
      url.startsWith('blob:') ||
      url.startsWith('devtools://') ||
      url.startsWith('chrome-extension://')
    ) {
      callback({ cancel: false });
      return;
    }
    if (isDevServer && (url.startsWith('http://localhost:') || url.startsWith('http://127.0.0.1:'))) {
      callback({ cancel: false });
      return;
    }
    logWarn('offline', `Requête réseau bloquée (mode 100% hors-ligne) : ${url}`);
    callback({ cancel: true });
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 980,
    minHeight: 640,
    title: 'OpenFS — Explorateur USB-C iPhone',
    autoHideMenuBar: true,
    backgroundColor: '#F3F6FA',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Prevent unintended popup windows
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  const bundledHtml = path.join(__dirname, 'web-dist', 'index.html');
  const devUrl = process.env.OPENFS_DEV_URL;

  if (devUrl) {
    mainWindow.loadURL(`${devUrl.replace(/\/$/, '')}/#app/usb`);
  } else if (fs.existsSync(bundledHtml)) {
    mainWindow.loadFile(bundledHtml, { hash: 'app/usb' });
  } else {
    mainWindow.loadURL('http://localhost:3000/#app/usb');
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// === WPD + Combined Device Detection & Media ===
ipcMain.handle('openfs:list-iphone-devices', async () => {
  return listIphoneDevices();
});

ipcMain.handle('openfs:list-iphone-directory', async (_event, deviceId, relativePath) => {
  return listIphoneDirectory(deviceId, relativePath);
});

ipcMain.handle('openfs:scan-iphone-media', async (_event, deviceId) => {
  return scanIphoneMedia(deviceId);
});

ipcMain.handle('openfs:get-thumbnails-batch', async (_event, items, maxSize) => {
  const map = await generateThumbnailsBatch(items, maxSize || 360);
  const urlMap = {};
  for (const [key, localJpgPath] of Object.entries(map)) {
    urlMap[key] = registerMediaUrl(localJpgPath);
  }
  return urlMap;
});

ipcMain.handle('openfs:get-quick-preview', async (_event, name, size, key) => {
  const localJpg = await getQuickIphonePreview(name, size, key);
  return localJpg ? registerMediaUrl(localJpg) : '';
});

// Warms the preview cache for the next/previous item so navigation feels instant.
ipcMain.handle(
  'openfs:prefetch-iphone-preview',
  async (_event, deviceId, relativePath, displayName, shellPath, afcOptions) => {
    try {
      await prepareIphonePreview(deviceId, relativePath, displayName, shellPath, afcOptions);
      return true;
    } catch (err) {
      logWarn('preview', `Préchargement échoué pour ${displayName}`, err);
      return false;
    }
  }
);

ipcMain.handle(
  'openfs:prepare-iphone-preview',
  async (_event, deviceId, relativePath, displayName, shellPath, afcOptions) => {
    const desc = await prepareIphonePreview(deviceId, relativePath, displayName, shellPath, afcOptions);
    return {
      previewKind: desc.previewKind,
      url: desc.streamSource
        ? registerStreamUrl(desc.streamSource)
        : desc.localPath
          ? registerMediaUrl(desc.localPath)
          : '',
      streamed: Boolean(desc.streamSource),
      mimeType: desc.mimeType,
      size: desc.size,
      sha256: desc.sha256 || '',
      textContent: desc.textContent,
      isBinaryPlist: Boolean(desc.isBinaryPlist),
      editable: Boolean(desc.editable),
    };
  }
);

ipcMain.handle('openfs:prepare-pc-preview', async (_event, filePath) => {
  const desc = await preparePcPreview(filePath);
  return {
    previewKind: desc.previewKind,
    url: desc.localPath ? registerMediaUrl(desc.localPath) : '',
    mimeType: desc.mimeType,
    size: desc.size,
    sha256: desc.sha256 || '',
    textContent: desc.textContent,
    isBinaryPlist: Boolean(desc.isBinaryPlist),
    editable: Boolean(desc.editable),
  };
});

ipcMain.handle(
  'openfs:copy-from-iphone-to-pc',
  async (_event, deviceId, relativePath, destPcDir, shellPath, preferredName) => {
    return copyFromIphoneToPc(deviceId, relativePath, destPcDir, shellPath, preferredName);
  }
);

// === PC Disk Operations ===
ipcMain.handle('openfs:pick-pc-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choisir un dossier sur votre PC',
    defaultPath: getDefaultSyncDir(),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('openfs:pick-pc-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choisir des fichiers à envoyer vers l’iPhone',
    defaultPath: getDefaultSyncDir(),
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled || result.filePaths.length === 0) return [];
  return result.filePaths;
});

ipcMain.handle('openfs:list-pc-directory', async (_event, dirPath) => {
  return listPcDirectory(dirPath);
});

ipcMain.handle('openfs:get-default-sync-dir', async () => {
  return getDefaultSyncDir();
});

ipcMain.handle('openfs:get-system-folder', async (_event, kind) => {
  return getSystemFolder(kind);
});

ipcMain.handle('openfs:open-in-explorer', async (_event, targetPath) => {
  const safePath = path.resolve(targetPath || getDefaultSyncDir());
  if (!fs.existsSync(safePath)) return false;
  await shell.openPath(safePath);
  return true;
});

ipcMain.handle('openfs:pc-create-folder', async (_event, parentDir, folderName) => {
  return pcCreateFolder(parentDir, folderName);
});

ipcMain.handle('openfs:pc-rename-item', async (_event, targetPath, newName) => {
  return pcRenameItem(targetPath, newName);
});

ipcMain.handle('openfs:pc-trash-item', async (_event, targetPath) => {
  const safePath = path.resolve(targetPath);
  if (!fs.existsSync(safePath)) {
    throw new Error('Élément introuvable sur le disque.');
  }
  await shell.trashItem(safePath);
  logInfo('pc', `Déplacé dans la Corbeille : ${safePath}`);
  return { trashedPath: safePath };
});

ipcMain.handle('openfs:pc-save-text-file', async (_event, filePath, textContent, options) => {
  return pcSaveTextFile(filePath, textContent, options || {});
});

ipcMain.handle('openfs:pc-compress-zip', async (_event, sourcePaths, destZipName) => {
  return pcCompressZip(sourcePaths, destZipName);
});

ipcMain.handle('openfs:pc-extract-zip', async (_event, zipPath) => {
  return pcExtractZip(zipPath);
});

ipcMain.handle('openfs:compute-sha256', async (_event, filePath) => {
  const safePath = path.resolve(filePath);
  if (!fs.existsSync(safePath)) {
    throw new Error('Fichier introuvable pour le calcul SHA-256.');
  }
  return computeFileSha256(safePath);
});

// === AFC Full iPhone Access (libimobiledevice) + Windows AMDS + Linux ===
ipcMain.handle('openfs:get-afc-capabilities', async () => {
  return getAfcCapabilities();
});

ipcMain.handle('openfs:open-apple-devices-store', async () => {
  // Explicitly restricted to the official Microsoft Store URI for Apple Devices (NOT iTunes)
  await shell.openExternal(APPLE_DEVICES_STORE_URL);
  return true;
});

ipcMain.handle('openfs:pair-iphone', async (_event, udid) => {
  return pairIphone(udid);
});

ipcMain.handle('openfs:afc-list-directory', async (_event, udid, remotePath, options) => {
  return afcListDirectory(udid, remotePath, options || {});
});

ipcMain.handle('openfs:afc-list-apps', async (_event, udid) => {
  return listSharedApps(udid);
});

ipcMain.handle('openfs:afc-download-file', async (_event, udid, remotePath, destDir, options) => {
  const targetDir = path.resolve(destDir || getDefaultSyncDir());
  fs.mkdirSync(targetDir, { recursive: true });
  const fileName = path.posix.basename(remotePath) || 'fichier_iphone';
  const destFile = path.join(targetDir, fileName);
  return afcDownloadFile(udid, remotePath, destFile, options || {});
});

ipcMain.handle('openfs:afc-upload-file', async (_event, udid, localFilePath, remoteDir, options) => {
  return afcUploadFile(udid, localFilePath, remoteDir, {
    ...(options || {}),
    isTargetDirectory: true,
  });
});

ipcMain.handle('openfs:afc-mkdir', async (_event, udid, parentRemotePath, folderName, options) => {
  return afcMkdir(udid, parentRemotePath, folderName, options || {});
});

ipcMain.handle('openfs:afc-rename', async (_event, udid, oldRemotePath, newName, options) => {
  return afcRename(udid, oldRemotePath, newName, options || {});
});

ipcMain.handle('openfs:afc-delete', async (_event, udid, remotePath, options) => {
  return afcDelete(udid, remotePath, options || {});
});

ipcMain.handle('openfs:afc-read-editable', async (_event, udid, remotePath, options) => {
  return afcReadEditableFile(udid, remotePath, options || {});
});

ipcMain.handle('openfs:afc-save-editable', async (_event, udid, remotePath, textContent, options) => {
  return afcSaveEditableFile(udid, remotePath, textContent, options || {});
});

// === Linux Dependencies & Mount ===
ipcMain.handle('openfs:linux-get-status', async () => {
  return getLinuxStatus();
});

ipcMain.handle('openfs:linux-install-deps', async () => {
  return installLinuxDeps();
});

ipcMain.handle('openfs:linux-mount-iphone', async (_event, udid) => {
  return mountLinuxIphone(udid);
});

ipcMain.handle('openfs:linux-unmount-iphone', async () => {
  return unmountLinuxIphone();
});

// === Local Diagnostics Logs ===
ipcMain.handle('openfs:get-logs', async () => {
  return {
    logFilePath: getLogFilePath(),
    entries: getRecentLogs(),
  };
});

app.whenReady().then(() => {
  logInfo('app', `OpenFS démarré (${process.platform} ${process.arch})`);
  enforceOfflineNetworkPolicy();

  protocol.handle('openfs-local', (request) => {
    try {
      const url = new URL(request.url);
      const token = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      if (url.hostname === 'stream') {
        return serveStream(request, token);
      }
      const filePath = mediaTokenToPath.get(token);
      if (!filePath || !fs.existsSync(filePath)) {
        return new Response('Not found', { status: 404 });
      }
      const rangeHeader = request.headers.get('range');
      return net.fetch(
        pathToFileURL(filePath).toString(),
        rangeHeader ? { headers: { range: rangeHeader } } : undefined
      );
    } catch (err) {
      logError('protocol', 'Erreur openfs-local', err);
      return new Response('Bad request', { status: 400 });
    }
  });

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
