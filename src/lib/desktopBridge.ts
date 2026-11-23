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

export function getDesktopBridge(): OpenFSDesktopAPI | null {
  if (typeof window !== 'undefined' && window.openfsDesktop?.isDesktop) {
    return window.openfsDesktop;
  }
  return null;
}

export function isNativeDesktopApp(): boolean {
  return getDesktopBridge() !== null;
}
