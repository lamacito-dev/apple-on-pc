export interface DesktopIphoneDevice {
  id: string;
  udid?: string;
  afcUdid?: string;
  afcAvailable?: boolean;
  afcPaired?: boolean;
  name: string;
  model: string;
  serialNumber: string;
  vendorId?: string;
  productId?: string;
  backend: 'wpd' | 'usb_pnp' | 'afc';
  status: 'ready' | 'locked';
  accessible: boolean;
  storageCount?: number;
  hint?: string;
}

export interface DesktopFsEntry {
  name: string;
  wpdName?: string;
  shellPath?: string;
  kind: 'folder' | 'file';
  size: number;
  modifiedAt: string;
  path: string;
  sourceFolder?: string;
  permissions?: string;
  hidden?: boolean;
  mediaType?: 'photo' | 'video' | 'audio' | 'document' | 'sidecar';
}

export interface DesktopThumbnailRequest {
  key: string;
  shellPath: string;
  /** File name and size let the app use the JPEG previews iOS already generated (fast path). */
  name?: string;
  size?: number;
}

export interface DesktopPreviewResult {
  previewKind: 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'unsupported';
  url: string;
  mimeType: string;
  size: number;
  sha256?: string;
  textContent?: string;
  isBinaryPlist?: boolean;
  editable?: boolean;
  /** True when a video is streamed from the iPhone instead of copied first (no SHA-256 then). */
  streamed?: boolean;
}

export interface DesktopTransferResult {
  copiedPath?: string;
  remotePath?: string;
  sourceSha256: string;
  destSha256: string;
  verified: boolean;
  size: number;
  savedAsBinaryPlist?: boolean;
}

export interface DesktopSharedApp {
  bundleId: string;
  name: string;
  version?: string;
  fileSharingEnabled: boolean;
}

export interface DesktopWindowsAmdsStatus {
  platform: string;
  applicable: boolean;
  installed: boolean;
  running: boolean;
  serviceName: string | null;
  status: string;
  error?: string;
  storeUrl: string;
}

export interface DesktopLinuxStatus {
  applicable: boolean;
  distro: {
    id: string;
    prettyName: string;
    family: 'debian' | 'fedora' | 'arch' | 'other';
  };
  tools: Record<string, boolean>;
  missingTools: string[];
  usbmuxdRunning: boolean;
  mountPoint: string;
  mounted: boolean;
  installCommand: string;
  hasPkexec: boolean;
}

export interface DesktopAfcCapabilities {
  platform: string;
  binaries: Record<string, { found: boolean; bundled: boolean }>;
  hasCoreAfc: boolean;
  hasAppsSupport: boolean;
  hasPlistSupport: boolean;
  ready: boolean;
  amds: DesktopWindowsAmdsStatus;
  linux: DesktopLinuxStatus;
  storeUrl: string;
}

export interface DesktopLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  scope: string;
  message: string;
  detail?: string;
}

export interface DesktopLogsResult {
  logFilePath: string;
  entries: DesktopLogEntry[];
}

export interface OpenFSDesktopAPI {
  isDesktop: boolean;
  platform: string;
  listIphoneDevices: () => Promise<DesktopIphoneDevice[]>;
  listIphoneDirectory: (deviceId: string, relativePath?: string) => Promise<DesktopFsEntry[]>;
  scanIphoneMedia: (deviceId: string, deviceName?: string) => Promise<DesktopFsEntry[]>;
  /** Last photo-library list saved for this iPhone (shown instantly while a fresh scan runs), or null. */
  getCachedIphoneMedia?: (deviceId: string, deviceName?: string) => Promise<DesktopFsEntry[] | null>;
  /** Thumbnails produced late by Windows (cold iPhone connection); returns an unsubscribe function. */
  onLateThumbnails?: (callback: (urls: Record<string, string>) => void) => () => void;
  getThumbnailsBatch: (
    items: DesktopThumbnailRequest[],
    maxSize?: number
  ) => Promise<Record<string, string>>;
  prepareIphonePreview: (
    deviceId: string,
    relativePath: string,
    displayName?: string,
    shellPath?: string,
    afcOptions?: { appId?: string; size?: number }
  ) => Promise<DesktopPreviewResult>;
  /** Instant low-resolution JPEG made by iOS for a camera-roll item; '' when unavailable. */
  getQuickPreview?: (name: string, size?: number, key?: string) => Promise<string>;
  /** Prepares a preview in the background so opening it next is instant. */
  prefetchIphonePreview?: (
    deviceId: string,
    relativePath: string,
    displayName?: string,
    shellPath?: string,
    afcOptions?: { appId?: string; size?: number }
  ) => Promise<boolean>;
  preparePcPreview: (filePath: string) => Promise<DesktopPreviewResult>;
  copyFromIphoneToPc: (
    deviceId: string,
    relativePath: string,
    destPcDir?: string,
    shellPath?: string,
    preferredName?: string
  ) => Promise<DesktopTransferResult>;
  pickPcDirectory: () => Promise<string | null>;
  pickPcFiles: () => Promise<string[]>;
  listPcDirectory: (dirPath?: string) => Promise<DesktopFsEntry[]>;
  getDefaultSyncDir: () => Promise<string>;
  getSystemFolder: (kind: 'documents' | 'downloads' | 'sync') => Promise<string>;
  openInExplorer: (targetPath?: string) => Promise<boolean>;

  // PC disk ops
  pcCreateFolder: (parentDir: string, folderName: string) => Promise<{ path: string; name: string }>;
  pcRenameItem: (
    targetPath: string,
    newName: string
  ) => Promise<{ oldPath: string; newPath: string; name: string }>;
  pcTrashItem: (targetPath: string) => Promise<{ trashedPath: string }>;
  pcSaveTextFile: (
    filePath: string,
    textContent: string,
    options?: { convertToBinaryPlist?: boolean }
  ) => Promise<{
    path: string;
    size: number;
    sha256: string;
    verified: boolean;
    savedAsBinaryPlist?: boolean;
  }>;
  pcCompressZip: (
    sourcePaths: string[],
    destZipName?: string
  ) => Promise<{ zipPath: string; name: string; size: number; sha256: string; fileCount: number }>;
  /** Opens a « Enregistrer sous » dialog for a .zip; resolves to the chosen path, or null if cancelled. */
  chooseZipDestination?: (defaultName: string, defaultDir?: string) => Promise<string | null>;
  /** Streams several iPhone (or PC) files into one .zip saved at destPath. */
  zipIphoneItems?: (options: {
    deviceId?: string;
    afcUdid?: string;
    appId?: string;
    destPath: string;
    items: Array<{ relativePath?: string; name: string; shellPath?: string; size?: number; localPath?: string }>;
  }) => Promise<{ zipPath: string; name: string; destDir: string; size: number; sha256: string; fileCount: number }>;
  /** Progress of the running zipIphoneItems call; returns an unsubscribe function. */
  onZipProgress?: (callback: (progress: { done: number; total: number; name: string }) => void) => () => void;
  pcExtractZip: (
    zipPath: string
  ) => Promise<{ extractDir: string; name: string; fileCount: number }>;
  computeSha256: (filePath: string) => Promise<string>;

  // AFC + Windows AMDS + App Documents + In-place editing
  getAfcCapabilities: () => Promise<DesktopAfcCapabilities>;
  openAppleDevicesStore: () => Promise<boolean>;
  pairIphone: (
    udid?: string
  ) => Promise<{ paired: boolean; needsTrust?: boolean; needsUnlock?: boolean; message: string }>;
  afcListDirectory: (
    udid: string,
    remotePath?: string,
    options?: { appId?: string; showHidden?: boolean }
  ) => Promise<DesktopFsEntry[]>;
  afcListApps: (udid: string) => Promise<DesktopSharedApp[]>;
  afcDownloadFile: (
    udid: string,
    remotePath: string,
    destDir?: string,
    options?: { appId?: string }
  ) => Promise<DesktopTransferResult>;
  afcUploadFile: (
    udid: string,
    localFilePath: string,
    remoteDir: string,
    options?: { appId?: string }
  ) => Promise<DesktopTransferResult>;
  afcMkdir: (
    udid: string,
    parentRemotePath: string,
    folderName: string,
    options?: { appId?: string }
  ) => Promise<{ remotePath: string }>;
  afcRename: (
    udid: string,
    oldRemotePath: string,
    newName: string,
    options?: { appId?: string }
  ) => Promise<{ oldPath: string; newPath: string }>;
  afcDelete: (
    udid: string,
    remotePath: string,
    options?: { appId?: string; recursive?: boolean }
  ) => Promise<{ deletedPath: string }>;
  afcReadEditable: (
    udid: string,
    remotePath: string,
    options?: { appId?: string }
  ) => Promise<{
    remotePath: string;
    textContent: string;
    isBinaryPlist: boolean;
    sha256: string;
    size: number;
  }>;
  afcSaveEditable: (
    udid: string,
    remotePath: string,
    textContent: string,
    options?: { appId?: string; convertToBinaryPlist?: boolean }
  ) => Promise<DesktopTransferResult>;

  // Linux helpers
  linuxGetStatus: () => Promise<DesktopLinuxStatus>;
  linuxInstallDeps: () => Promise<DesktopLinuxStatus>;
  linuxMountIphone: (
    udid?: string
  ) => Promise<{ mounted: boolean; mountPoint: string; message: string }>;
  linuxUnmountIphone: () => Promise<{ mounted: boolean; mountPoint: string; message: string }>;

  // Diagnostic logs
  getLogs: () => Promise<DesktopLogsResult>;
}

declare global {
  interface Window {
    openfsDesktop?: OpenFSDesktopAPI;
  }
}

export const DEFAULT_WINDOWS_EXE_URL =
  'https://github.com/lamacito-dev/apple-on-pc/releases/latest/download/OpenFS-Setup-1.0.0.exe';

export const DEFAULT_LINUX_APPIMAGE_URL =
  'https://github.com/lamacito-dev/apple-on-pc/releases/latest/download/OpenFS-1.0.0.AppImage';

export const DEFAULT_LINUX_DEB_URL =
  'https://github.com/lamacito-dev/apple-on-pc/releases/latest/download/OpenFS-1.0.0.deb';

export function getWindowsExeUrl(): string {
  const configured = (import.meta.env.VITE_WINDOWS_EXE_URL || '').trim();
  return configured || DEFAULT_WINDOWS_EXE_URL;
}

export function getLinuxAppImageUrl(): string {
  const configured = (import.meta.env.VITE_LINUX_APPIMAGE_URL || '').trim();
  return configured || DEFAULT_LINUX_APPIMAGE_URL;
}

export function getWindowsExeFilename(url: string = getWindowsExeUrl()): string {
  return url.split('/').pop()?.split('?')[0] || 'OpenFS-Setup-1.0.0.exe';
}

export function getDesktopBridge(): OpenFSDesktopAPI | null {
  if (typeof window !== 'undefined' && window.openfsDesktop?.isDesktop) {
    return window.openfsDesktop;
  }
  return null;
}

export function isNativeDesktopApp(): boolean {
  return getDesktopBridge() !== null;
}
