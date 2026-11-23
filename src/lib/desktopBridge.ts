export interface DesktopIphoneDevice {
  id: string;
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
  mediaType?: 'photo' | 'video' | 'audio' | 'document' | 'sidecar';
}

export interface DesktopThumbnailRequest {
  key: string;
  shellPath: string;
}

export interface DesktopPreviewResult {
  previewKind: 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'unsupported';
  url: string;
  mimeType: string;
  size: number;
  textContent?: string;
}

export interface OpenFSDesktopAPI {
  isDesktop: boolean;
  platform: string;
  listIphoneDevices: () => Promise<DesktopIphoneDevice[]>;
  listIphoneDirectory: (deviceId: string, relativePath?: string) => Promise<DesktopFsEntry[]>;
  scanIphoneMedia: (deviceId: string) => Promise<DesktopFsEntry[]>;
  getThumbnailsBatch: (
    items: DesktopThumbnailRequest[],
    maxSize?: number
  ) => Promise<Record<string, string>>;
  prepareIphonePreview: (
    deviceId: string,
    relativePath: string,
    displayName?: string
  ) => Promise<DesktopPreviewResult>;
  preparePcPreview: (filePath: string) => Promise<DesktopPreviewResult>;
  copyFromIphoneToPc: (
    deviceId: string,
    relativePath: string,
    destPcDir?: string
  ) => Promise<string>;
  pickPcDirectory: () => Promise<string | null>;
  listPcDirectory: (dirPath?: string) => Promise<DesktopFsEntry[]>;
  getDefaultSyncDir: () => Promise<string>;
  getSystemFolder: (kind: 'documents' | 'downloads' | 'sync') => Promise<string>;
  openInExplorer: (targetPath?: string) => Promise<boolean>;
}

declare global {
  interface Window {
    openfsDesktop?: OpenFSDesktopAPI;
  }
}

export const DEFAULT_WINDOWS_EXE_URL =
  'https://github.com/lamacito-dev/apple-on-pc/releases/latest/download/OpenFS-Setup-1.0.0.exe';

export function getWindowsExeUrl(): string {
  const configured = (import.meta.env.VITE_WINDOWS_EXE_URL || '').trim();
  return configured || DEFAULT_WINDOWS_EXE_URL;
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
