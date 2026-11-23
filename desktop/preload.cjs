const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('openfsDesktop', {
  isDesktop: true,
  platform: process.platform,
  listIphoneDevices: () => ipcRenderer.invoke('openfs:list-iphone-devices'),
  listIphoneDirectory: (deviceId, relativePath = '') =>
    ipcRenderer.invoke('openfs:list-iphone-directory', deviceId, relativePath),
  copyFromIphoneToPc: (deviceId, relativePath, destPcDir) =>
    ipcRenderer.invoke('openfs:copy-from-iphone-to-pc', deviceId, relativePath, destPcDir),
  pickPcDirectory: () => ipcRenderer.invoke('openfs:pick-pc-directory'),
  listPcDirectory: (dirPath) => ipcRenderer.invoke('openfs:list-pc-directory', dirPath),
  getDefaultSyncDir: () => ipcRenderer.invoke('openfs:get-default-sync-dir'),
  openInExplorer: (targetPath) => ipcRenderer.invoke('openfs:open-in-explorer', targetPath),
});
