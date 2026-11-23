const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const {
  copyFromIphoneToPc,
  getDefaultSyncDir,
  listIphoneDevices,
  listIphoneDirectory,
  listPcDirectory,
} = require('./iphoneBridge.cjs');

let mainWindow = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    title: 'OpenFS — Explorateur USB-C iPhone',
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
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

ipcMain.handle('openfs:open-in-explorer', async (_event, targetPath) => {
  const safePath = path.resolve(targetPath || getDefaultSyncDir());
  if (!fs.existsSync(safePath)) return false;
  await shell.openPath(safePath);
  return true;
});

app.whenReady().then(() => {
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
