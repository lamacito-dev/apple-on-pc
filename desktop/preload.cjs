const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('openfsDesktop', {
  isDesktop: true,
  platform: process.platform,

  // WPD & Combined iPhone detection / media
  listIphoneDevices: () => ipcRenderer.invoke('openfs:list-iphone-devices'),
  listIphoneDirectory: (deviceId, relativePath = '') =>
    ipcRenderer.invoke('openfs:list-iphone-directory', deviceId, relativePath),
  scanIphoneMedia: (deviceId, deviceName) =>
    ipcRenderer.invoke('openfs:scan-iphone-media', deviceId, deviceName),
  getCachedIphoneMedia: (deviceId, deviceName) =>
    ipcRenderer.invoke('openfs:get-cached-iphone-media', deviceId, deviceName),
  getQuickPreview: (name, size, key = '') => ipcRenderer.invoke('openfs:get-quick-preview', name, size, key),
  prefetchIphonePreview: (deviceId, relativePath, displayName, shellPath = '', afcOptions = {}) =>
    ipcRenderer.invoke(
      'openfs:prefetch-iphone-preview',
      deviceId,
      relativePath,
      displayName,
      shellPath,
      afcOptions
    ),
  onLateThumbnails: (callback) => {
    const listener = (_event, urls) => callback(urls);
    ipcRenderer.on('openfs:thumbnails-late', listener);
    return () => ipcRenderer.removeListener('openfs:thumbnails-late', listener);
  },
  getThumbnailsBatch: (items, maxSize = 360) =>
    ipcRenderer.invoke('openfs:get-thumbnails-batch', items, maxSize),
  prepareIphonePreview: (deviceId, relativePath, displayName, shellPath = '', afcOptions = {}) =>
    ipcRenderer.invoke(
      'openfs:prepare-iphone-preview',
      deviceId,
      relativePath,
      displayName,
      shellPath,
      afcOptions
    ),
  preparePcPreview: (filePath) => ipcRenderer.invoke('openfs:prepare-pc-preview', filePath),
  copyFromIphoneToPc: (deviceId, relativePath, destPcDir, shellPath = '', preferredName = '') =>
    ipcRenderer.invoke(
      'openfs:copy-from-iphone-to-pc',
      deviceId,
      relativePath,
      destPcDir,
      shellPath,
      preferredName
    ),

  // PC disk operations
  pickPcDirectory: () => ipcRenderer.invoke('openfs:pick-pc-directory'),
  pickPcFiles: () => ipcRenderer.invoke('openfs:pick-pc-files'),
  listPcDirectory: (dirPath) => ipcRenderer.invoke('openfs:list-pc-directory', dirPath),
  getDefaultSyncDir: () => ipcRenderer.invoke('openfs:get-default-sync-dir'),
  getSystemFolder: (kind) => ipcRenderer.invoke('openfs:get-system-folder', kind),
  openInExplorer: (targetPath) => ipcRenderer.invoke('openfs:open-in-explorer', targetPath),
  pcCreateFolder: (parentDir, folderName) =>
    ipcRenderer.invoke('openfs:pc-create-folder', parentDir, folderName),
  pcRenameItem: (targetPath, newName) =>
    ipcRenderer.invoke('openfs:pc-rename-item', targetPath, newName),
  pcTrashItem: (targetPath) => ipcRenderer.invoke('openfs:pc-trash-item', targetPath),
  pcSaveTextFile: (filePath, textContent, options = {}) =>
    ipcRenderer.invoke('openfs:pc-save-text-file', filePath, textContent, options),
  pcCompressZip: (sourcePaths, destZipName) =>
    ipcRenderer.invoke('openfs:pc-compress-zip', sourcePaths, destZipName),
  chooseZipDestination: (defaultName, defaultDir) =>
    ipcRenderer.invoke('openfs:choose-zip-destination', defaultName, defaultDir),
  zipIphoneItems: (options) => ipcRenderer.invoke('openfs:zip-iphone-items', options),
  onZipProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('openfs:zip-progress', listener);
    return () => ipcRenderer.removeListener('openfs:zip-progress', listener);
  },
  pcExtractZip: (zipPath) => ipcRenderer.invoke('openfs:pc-extract-zip', zipPath),
  computeSha256: (filePath) => ipcRenderer.invoke('openfs:compute-sha256', filePath),

  // AFC (libimobiledevice) + Windows AMDS + Apps + In-place edit
  getAfcCapabilities: () => ipcRenderer.invoke('openfs:get-afc-capabilities'),
  openAppleDevicesStore: () => ipcRenderer.invoke('openfs:open-apple-devices-store'),
  pairIphone: (udid) => ipcRenderer.invoke('openfs:pair-iphone', udid),
  afcListDirectory: (udid, remotePath = '/', options = {}) =>
    ipcRenderer.invoke('openfs:afc-list-directory', udid, remotePath, options),
  afcListApps: (udid) => ipcRenderer.invoke('openfs:afc-list-apps', udid),
  afcDownloadFile: (udid, remotePath, destDir, options = {}) =>
    ipcRenderer.invoke('openfs:afc-download-file', udid, remotePath, destDir, options),
  afcUploadFile: (udid, localFilePath, remoteDir, options = {}) =>
    ipcRenderer.invoke('openfs:afc-upload-file', udid, localFilePath, remoteDir, options),
  afcMkdir: (udid, parentRemotePath, folderName, options = {}) =>
    ipcRenderer.invoke('openfs:afc-mkdir', udid, parentRemotePath, folderName, options),
  afcRename: (udid, oldRemotePath, newName, options = {}) =>
    ipcRenderer.invoke('openfs:afc-rename', udid, oldRemotePath, newName, options),
  afcDelete: (udid, remotePath, options = {}) =>
    ipcRenderer.invoke('openfs:afc-delete', udid, remotePath, options),
  afcReadEditable: (udid, remotePath, options = {}) =>
    ipcRenderer.invoke('openfs:afc-read-editable', udid, remotePath, options),
  afcSaveEditable: (udid, remotePath, textContent, options = {}) =>
    ipcRenderer.invoke('openfs:afc-save-editable', udid, remotePath, textContent, options),

  // Linux support
  linuxGetStatus: () => ipcRenderer.invoke('openfs:linux-get-status'),
  linuxInstallDeps: () => ipcRenderer.invoke('openfs:linux-install-deps'),
  linuxMountIphone: (udid) => ipcRenderer.invoke('openfs:linux-mount-iphone', udid),
  linuxUnmountIphone: () => ipcRenderer.invoke('openfs:linux-unmount-iphone'),

  // Local diagnostic logs
  getLogs: () => ipcRenderer.invoke('openfs:get-logs'),
});
