const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('openfsDesktop', {
  isDesktop: true,
  platform: process.platform,
  listIphoneDevices: () => ipcRenderer.invoke('openfs:list-iphone-devices'),
  listIphoneDirectory: (deviceId, relativePath = '') =>
    ipcRenderer.invoke('openfs:list-iphone-directory', deviceId, relativePath),
  scanIphoneMedia: (deviceId) => ipcRenderer.invoke('openfs:scan-iphone-media', deviceId),
  getThumbnailsBatch: (items, maxSize = 360) =>
    ipcRenderer.invoke('openfs:get-thumbnails-batch', items, maxSize),
  prepareIphonePreview: (deviceId, relativePath, displayName) =>
    ipcRenderer.invoke('openfs:prepare-iphone-preview', deviceId, relativePath, displayName),
  preparePcPreview: (filePath) => ipcRenderer.invoke('openfs:prepare-pc-preview', filePath),
  copyFromIphoneToPc: (deviceId, relativePath, destPcDir) =>
    ipcRenderer.invoke('openfs:copy-from-iphone-to-pc', deviceId, relativePath, destPcDir),
  pickPcDirectory: () => ipcRenderer.invoke('openfs:pick-pc-directory'),
  listPcDirectory: (dirPath) => ipcRenderer.invoke('openfs:list-pc-directory', dirPath),
  getDefaultSyncDir: () => ipcRenderer.invoke('openfs:get-default-sync-dir'),
  getSystemFolder: (kind) => ipcRenderer.invoke('openfs:get-system-folder', kind),
  openInExplorer: (targetPath) => ipcRenderer.invoke('openfs:open-in-explorer', targetPath),
});
