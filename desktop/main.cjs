const crypto = require('crypto');
const { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  copyFromIphoneToPc,
  generateThumbnailsBatch,
  getDefaultSyncDir,
  getSystemFolder,
  listIphoneDevices,
  listIphoneDirectory,
  listPcDirectory,
  prepareIphonePreview,
  preparePcPreview,
  scanIphoneMedia,
} = require('./iphoneBridge.cjs');

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

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 860,
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

ipcMain.handle('openfs:prepare-iphone-preview', async (_event, deviceId, relativePath, displayName) => {
  const desc = await prepareIphonePreview(deviceId, relativePath, displayName);
  return {
    previewKind: desc.previewKind,
    url: desc.localPath ? registerMediaUrl(desc.localPath) : '',
    mimeType: desc.mimeType,
    size: desc.size,
    textContent: desc.textContent,
  };
});

ipcMain.handle('openfs:prepare-pc-preview', async (_event, filePath) => {
  const desc = await preparePcPreview(filePath);
  return {
    previewKind: desc.previewKind,
    url: desc.localPath ? registerMediaUrl(desc.localPath) : '',
    mimeType: desc.mimeType,
    size: desc.size,
    textContent: desc.textContent,
  };
});

ipcMain.handle(
  'openfs:copy-from-iphone-to-pc',
  async (_event, deviceId, relativePath, destPcDir) => {
    return copyFromIphoneToPc(deviceId, relativePath, destPcDir);
  }
);

ipcMain.handle('openfs:pick-pc-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choisir le dossier de destination sur votre PC',
    defaultPath: getDefaultSyncDir(),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
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

app.whenReady().then(() => {
  protocol.handle('openfs-local', (request) => {
    try {
      const url = new URL(request.url);
      const token = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      const filePath = mediaTokenToPath.get(token);
      if (!filePath || !fs.existsSync(filePath)) {
        return new Response('Not found', { status: 404 });
      }
      return net.fetch(pathToFileURL(filePath).toString(), {
        headers: request.headers,
      });
    } catch {
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
