export interface DesktopIphoneDevice {
  id: string;
  name: string;
  model: string;
  serialNumber: string;
  backend: 'wpd' | 'afc';
}

export interface DesktopFsEntry {
  name: string;
  kind: 'folder' | 'file';
  size: number;
  modifiedAt: string;
  path: string;
}

export interface OpenFSDesktopAPI {
  isDesktop: boolean;
  platform: string;
  listIphoneDevices: () => Promise<DesktopIphoneDevice[]>;
  listIphoneDirectory: (deviceId: string, relativePath?: string) => Promise<DesktopFsEntry[]>;
  copyFromIphoneToPc: (
    deviceId: string,
    relativePath: string,
    destPcDir?: string
  ) => Promise<string>;
  pickPcDirectory: () => Promise<string | null>;
  listPcDirectory: (dirPath?: string) => Promise<DesktopFsEntry[]>;
  getDefaultSyncDir: () => Promise<string>;
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
