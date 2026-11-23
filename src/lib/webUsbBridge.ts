import JSZip from 'jszip';
import { downloadBlob } from './fsUtils';

export interface UsbInterfaceInfo {
  interfaceNumber: number;
  classCode: number;
  subclassCode: number;
  protocolCode: number;
  label: string;
}

export interface ConnectedUsbDeviceInfo {
  vendorId: number;
  productId: number;
  vendorHex: string;
  productHex: string;
  manufacturerName: string;
  productName: string;
  serialNumber: string;
  usbVersion: string;
  opened: boolean;
  isApple: boolean;
  interfaces: UsbInterfaceInfo[];
  mode: 'webusb' | 'simulated';
}

interface WebUSBEndpoint {
  endpointNumber: number;
  direction: 'in' | 'out';
  type: 'bulk' | 'interrupt' | 'isochronous';
}

interface WebUSBAlternateInterface {
  alternateSetting: number;
  interfaceClass: number;
  interfaceSubclass: number;
  interfaceProtocol: number;
  interfaceName?: string;
  endpoints: WebUSBEndpoint[];
}

interface WebUSBInterface {
  interfaceNumber: number;
  alternate: WebUSBAlternateInterface;
  alternates: WebUSBAlternateInterface[];
  claimed: boolean;
}

interface WebUSBConfiguration {
  configurationValue: number;
  configurationName?: string;
  interfaces: WebUSBInterface[];
}

export interface WebUSBDevice {
  vendorId: number;
  productId: number;
  usbVersionMajor: number;
  usbVersionMinor: number;
  usbVersionSubminor: number;
  manufacturerName?: string;
  productName?: string;
  serialNumber?: string;
  opened: boolean;
  configuration?: WebUSBConfiguration | null;
  configurations: WebUSBConfiguration[];
  open: () => Promise<void>;
  close: () => Promise<void>;
  selectConfiguration: (configurationValue: number) => Promise<void>;
}

interface WebUSBManager {
  getDevices: () => Promise<WebUSBDevice[]>;
  requestDevice: (options: { filters: Array<{ vendorId?: number; productId?: number }> }) => Promise<WebUSBDevice>;
  addEventListener: (type: 'connect' | 'disconnect', listener: (ev: { device: WebUSBDevice }) => void) => void;
  removeEventListener: (type: 'connect' | 'disconnect', listener: (ev: { device: WebUSBDevice }) => void) => void;
}

function getUsbManager(): WebUSBManager | null {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as unknown as { usb?: WebUSBManager };
  return nav.usb ?? null;
}

export function isWebUsbSupported(): boolean {
  return getUsbManager() !== null;
}

export function isDirectoryPickerSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

function hex4(val: number): string {
  return `0x${val.toString(16).toUpperCase().padStart(4, '0')}`;
}

function decodeUsbClass(classCode: number, subclass: number, protocol: number): string {
  if (classCode === 0x06 && subclass === 0x01) return 'PTP / MTP (Photos DCIM)';
  if (classCode === 0xff && subclass === 0xfe && protocol === 0x02) return 'Apple usbmux / AFC';
  if (classCode === 0xff && subclass === 0x2a) return 'Apple Mobile Device (lockdownd)';
  if (classCode === 0xff) return 'Interface propriétaire Apple';
  if (classCode === 0x01) return 'Audio USB';
  if (classCode === 0x03) return 'HID (Contrôle)';
  if (classCode === 0x08) return 'Stockage de masse';
  if (classCode === 0x02 || classCode === 0x0a) return 'Réseau USB (CDC / NCM)';
  return `Classe 0x${classCode.toString(16).toUpperCase().padStart(2, '0')}`;
}

export function formatUsbDevice(device: WebUSBDevice): ConnectedUsbDeviceInfo {
  const interfaces: UsbInterfaceInfo[] = [];
  const activeConfig = device.configuration || device.configurations[0];
  if (activeConfig) {
    for (const iface of activeConfig.interfaces) {
      const alt = iface.alternate || iface.alternates[0];
      if (alt) {
        interfaces.push({
          interfaceNumber: iface.interfaceNumber,
          classCode: alt.interfaceClass,
          subclassCode: alt.interfaceSubclass,
          protocolCode: alt.interfaceProtocol,
          label:
            alt.interfaceName ||
            decodeUsbClass(alt.interfaceClass, alt.interfaceSubclass, alt.interfaceProtocol),
        });
      }
    }
  }

  return {
    vendorId: device.vendorId,
    productId: device.productId,
    vendorHex: hex4(device.vendorId),
    productHex: hex4(device.productId),
    manufacturerName: device.manufacturerName || (device.vendorId === 0x05ac ? 'Apple Inc.' : 'Périphérique USB'),
    productName: device.productName || (device.vendorId === 0x05ac ? 'iPhone (USB-C)' : 'Périphérique inconnu'),
    serialNumber: device.serialNumber || 'Masqué par le pilote OS',
    usbVersion: `${device.usbVersionMajor}.${device.usbVersionMinor}`,
    opened: device.opened,
    isApple: device.vendorId === 0x05ac,
    interfaces,
    mode: 'webusb',
  };
}

export async function getAuthorizedUsbDevices(): Promise<ConnectedUsbDeviceInfo[]> {
  const usb = getUsbManager();
  if (!usb) return [];
  try {
    const devices = await usb.getDevices();
    return devices.map(formatUsbDevice);
  } catch {
    return [];
  }
}

export async function requestAppleUsbDevice(appleOnly = true): Promise<ConnectedUsbDeviceInfo | null> {
  const usb = getUsbManager();
  if (!usb) {
    throw new Error('WebUSB n’est pas pris en charge par ce navigateur (utilisez Chrome, Edge ou Brave sur PC/Linux).');
  }
  const device = await usb.requestDevice({
    filters: appleOnly ? [{ vendorId: 0x05ac }] : [],
  });
  try {
    if (!device.opened) {
      await device.open();
    }
  } catch {
    // On Windows/Linux, OS drivers (Apple Mobile Device / usbmuxd) may hold an exclusive lock.
    // Even without open(), descriptor metadata is already readable and the device is detected!
  }
  return formatUsbDevice(device);
}

export function subscribeUsbHotplug(
  onConnect: (info: ConnectedUsbDeviceInfo) => void,
  onDisconnect: (info: ConnectedUsbDeviceInfo) => void
): () => void {
  const usb = getUsbManager();
  if (!usb) return () => {};
  const handleConnect = (ev: { device: WebUSBDevice }) => onConnect(formatUsbDevice(ev.device));
  const handleDisconnect = (ev: { device: WebUSBDevice }) => onDisconnect(formatUsbDevice(ev.device));
  usb.addEventListener('connect', handleConnect);
  usb.addEventListener('disconnect', handleDisconnect);
  return () => {
    usb.removeEventListener('connect', handleConnect);
    usb.removeEventListener('disconnect', handleDisconnect);
  };
}

export function createSimulatedUsbDevice(): ConnectedUsbDeviceInfo {
  return {
    vendorId: 0x05ac,
    productId: 0x12a8,
    vendorHex: '0x05AC',
    productHex: '0x12A8',
    manufacturerName: 'Apple Inc.',
    productName: 'iPhone 15 Pro (Mode Aperçu USB-C)',
    serialNumber: '00008130-001425A10C80001E',
    usbVersion: '3.2',
    opened: true,
    isApple: true,
    interfaces: [
      { interfaceNumber: 0, classCode: 0x06, subclassCode: 0x01, protocolCode: 0x01, label: 'PTP / MTP (Photos DCIM)' },
      { interfaceNumber: 1, classCode: 0xff, subclassCode: 0xfe, protocolCode: 0x02, label: 'Apple usbmux / AFC' },
      { interfaceNumber: 2, classCode: 0x02, subclassCode: 0x0d, protocolCode: 0x00, label: 'Réseau USB (CDC / NCM)' },
    ],
    mode: 'simulated',
  };
}

export interface WritableDirectoryHandle extends FileSystemDirectoryHandle {
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<
    FileSystemFileHandle & {
      createWritable: () => Promise<{
        write: (data: Blob | string | ArrayBuffer) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }
  >;
  getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<WritableDirectoryHandle>;
}

export async function pickRealDirectoryHandle(
  mode: 'read' | 'readwrite' = 'readwrite'
): Promise<WritableDirectoryHandle | null> {
  const picker = (window as unknown as {
    showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<WritableDirectoryHandle>;
  }).showDirectoryPicker;
  if (!picker) return null;
  try {
    return await picker({ mode });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return null;
    if (mode === 'readwrite') {
      try {
        return await picker({ mode: 'read' });
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function writeBlobToDirectoryHandle(
  dirHandle: WritableDirectoryHandle,
  filename: string,
  blob: Blob
): Promise<boolean> {
  try {
    const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

export function generateLinuxUsbBridgeScript(): string {
  return `#!/usr/bin/env bash
# ==============================================================================
# OpenFS — Script de montage USB-C iPhone pour Linux (Ubuntu/Debian/Arch/Fedora)
# Monte le stockage AFC de votre iPhone (DCIM, Media, Downloads, Apps)
# dans ~/iPhone-USB pour un accès direct depuis OpenFS.
# ==============================================================================

set -e

MOUNT_DIR="$HOME/iPhone-USB"

echo "=== OpenFS : Montage USB-C iPhone sur Linux ==="

# 1. Vérification des outils libimobiledevice & ifuse
if ! command -v ifuse >/dev/null 2>&1 || ! command -v idevicepair >/dev/null 2>&1; then
  echo "Installation de libimobiledevice, usbmuxd et ifuse requise :"
  echo "  Ubuntu / Debian : sudo apt update && sudo apt install -y usbmuxd libimobiledevice-utils ifuse"
  echo "  Arch Linux      : sudo pacman -S usbmuxd libimobiledevice ifuse"
  echo "  Fedora          : sudo dnf install -y usbmuxd libimobiledevice-utils ifuse"
  exit 1
fi

# 2. Démarrage du démon usbmuxd si inactif
if command -v systemctl >/dev/null 2>&1; then
  sudo systemctl start usbmuxd || true
fi

# 3. Appairage avec l'iPhone (déverrouillez l'iPhone et appuyez sur 'Faire confiance')
echo "Appairage USB-C en cours... Déverrouillez votre iPhone et validez 'Faire confiance'."
idevicepair pair || true
idevicepair validate

# 4. Création du point de montage et montage AFC complet
mkdir -p "$MOUNT_DIR"
if mountpoint -q "$MOUNT_DIR"; then
  echo "L'iPhone est déjà monté dans : $MOUNT_DIR"
else
  ifuse "$MOUNT_DIR"
  echo "Succès ! iPhone monté dans : $MOUNT_DIR"
fi

echo ""
echo "Étape suivante :"
echo "  1. Dans OpenFS, cliquez sur 'Monter le volume USB (iPhone)'"
echo "  2. Sélectionnez le dossier : $MOUNT_DIR"
echo "  3. Pour démonter proprement plus tard : fusermount -u \"$MOUNT_DIR\""
`;
}

export function detectDesktopOS(): 'windows' | 'linux' {
  if (typeof navigator === 'undefined') return 'windows';
  const ua = `${navigator.userAgent} ${navigator.platform || ''}`.toLowerCase();
  if (ua.includes('linux') && !ua.includes('android')) return 'linux';
  return 'windows';
}

function generateWindowsDesktopLauncherBat(appUrl: string): string {
  const safeUrl = appUrl.replace(/["'`&|<>^]/g, '');
  return [
    '@echo off',
    'setlocal',
    `set "APP_URL=${safeUrl}"`,
    'if not exist "%USERPROFILE%\\OpenFS-iPhone-Sync" mkdir "%USERPROFILE%\\OpenFS-iPhone-Sync"',
    'if exist "%USERPROFILE%\\Desktop" if /I not "%~dp0"=="%USERPROFILE%\\Desktop\\" copy /Y "%~f0" "%USERPROFILE%\\Desktop\\OpenFS.bat" >nul 2>&1',
    'if exist "%USERPROFILE%\\OneDrive\\Desktop" if /I not "%~dp0"=="%USERPROFILE%\\OneDrive\\Desktop\\" copy /Y "%~f0" "%USERPROFILE%\\OneDrive\\Desktop\\OpenFS.bat" >nul 2>&1',
    'if exist "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" (',
    '  start "" "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" --app="%APP_URL%"',
    '  exit /b 0',
    ')',
    'if exist "%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe" (',
    '  start "" "%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe" --app="%APP_URL%"',
    '  exit /b 0',
    ')',
    'if exist "%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe" (',
    '  start "" "%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe" --app="%APP_URL%"',
    '  exit /b 0',
    ')',
    'if exist "%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe" (',
    '  start "" "%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe" --app="%APP_URL%"',
    '  exit /b 0',
    ')',
    'if exist "%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe" (',
    '  start "" "%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe" --app="%APP_URL%"',
    '  exit /b 0',
    ')',
    'if exist "%ProgramFiles%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe" (',
    '  start "" "%ProgramFiles%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe" --app="%APP_URL%"',
    '  exit /b 0',
    ')',
    'start "" "%APP_URL%"',
    'exit /b 0',
    '',
  ].join('\r\n');
}

function generateWindowsUrlShortcut(appUrl: string): string {
  const safeUrl = appUrl.replace(/[\r\n]/g, '');
  return [
    '[InternetShortcut]',
    `URL=${safeUrl}`,
    '',
  ].join('\r\n');
}

function generateLinuxDesktopInstallerSh(appUrl: string): string {
  const safeUrl = appUrl.replace(/"/g, '');
  return `#!/usr/bin/env bash
set -e

APP_URL="${safeUrl}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ICON_DIR="$HOME/.local/share/icons"
APP_DIR="$HOME/.local/share/applications"
DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"
[ -d "$HOME/Bureau" ] && [ ! -d "$DESKTOP_DIR" ] && DESKTOP_DIR="$HOME/Bureau"

echo "=== OpenFS — Installation sur votre Bureau Linux ==="

mkdir -p "$ICON_DIR" "$APP_DIR" "$HOME/OpenFS-iPhone-Sync"
if [ -f "$SCRIPT_DIR/openfs.svg" ]; then
  cp "$SCRIPT_DIR/openfs.svg" "$ICON_DIR/openfs.svg"
fi

BROWSER=""
for candidate in google-chrome chromium chromium-browser brave-browser microsoft-edge; do
  if command -v "$candidate" >/dev/null 2>&1; then
    BROWSER="$(command -v "$candidate")"
    break
  fi
done

if [ -n "$BROWSER" ]; then
  EXEC_LINE="$BROWSER --app=$APP_URL"
else
  EXEC_LINE="xdg-open $APP_URL"
fi

DESKTOP_CONTENT="[Desktop Entry]
Version=1.0
Type=Application
Name=OpenFS
Comment=Explorateur USB-C iPhone pour Linux
Exec=$EXEC_LINE
Icon=$ICON_DIR/openfs.svg
Terminal=false
Categories=Utility;FileManager;
StartupNotify=true
"

printf "%s" "$DESKTOP_CONTENT" > "$APP_DIR/openfs.desktop"
chmod +x "$APP_DIR/openfs.desktop"

if [ -d "$DESKTOP_DIR" ]; then
  printf "%s" "$DESKTOP_CONTENT" > "$DESKTOP_DIR/OpenFS.desktop"
  chmod +x "$DESKTOP_DIR/OpenFS.desktop"
  echo "Raccourci cree sur votre Bureau : $DESKTOP_DIR/OpenFS.desktop"
fi

chmod +x "$SCRIPT_DIR/openfs-usb-linux.sh" 2>/dev/null || true

echo "Lanceur installe dans le menu Applications."
echo "Pour monter votre iPhone en USB-C via ifuse, executez : ./openfs-usb-linux.sh"
echo "Ouverture d'OpenFS..."
nohup $EXEC_LINE >/dev/null 2>&1 &
`;
}

const OPENFS_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">
  <rect width="512" height="512" rx="112" fill="#0F172A"/>
  <path d="M116 176C116 156.118 132.118 140 152 140H220.4C231.2 140 241.4 144.8 248.2 153.2L264.6 173.4C268.4 178.1 274.1 180.8 280.1 180.8H360C379.882 180.8 396 196.918 396 216.8V344C396 363.882 379.882 380 360 380H152C132.118 380 116 363.882 116 344V176Z" fill="#2563EB"/>
  <path d="M116 226C116 210.536 128.536 198 144 198H368C383.464 198 396 210.536 396 226V344C396 363.882 379.882 380 360 380H152C132.118 380 116 363.882 116 344V226Z" fill="#3B82F6"/>
  <rect x="156" y="246" width="128" height="20" rx="10" fill="#EFF6FF"/>
  <rect x="156" y="284" width="200" height="16" rx="8" fill="#DBEAFE" fill-opacity="0.78"/>
  <rect x="156" y="316" width="152" height="16" rx="8" fill="#DBEAFE" fill-opacity="0.56"/>
</svg>
`;

export async function downloadDesktopInstallerZip(os: 'windows' | 'linux'): Promise<string> {
  const appUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/#app` : 'http://localhost:3000/#app';

  const zip = new JSZip();

  if (os === 'windows') {
    zip.file('OpenFS.bat', generateWindowsDesktopLauncherBat(appUrl));
    zip.file('OpenFS.url', generateWindowsUrlShortcut(appUrl));
    zip.file(
      'LISEZ-MOI.txt',
      `OpenFS - Pack Bureau pour Windows 10 / 11\r\n` +
        `=========================================\r\n\r\n` +
        `1. Decompressez OpenFS-Desktop-Windows.zip dans un dossier.\r\n` +
        `2. Double-cliquez sur "OpenFS.bat" :\r\n` +
        `   - Copie automatiquement le lanceur OpenFS sur votre Bureau,\r\n` +
        `   - Cree le dossier de transfert PC (OpenFS-iPhone-Sync),\r\n` +
        `   - Ouvre OpenFS dans sa propre fenetre dediee (Chrome / Edge / Brave).\r\n` +
        `3. Branchez votre iPhone en USB-C, deverrouillez-le et appuyez sur "Faire confiance".\r\n`
    );
    const filename = 'OpenFS-Desktop-Windows.zip';
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    downloadBlob(blob, filename);
    return filename;
  }

  zip.file('installer-openfs-bureau.sh', generateLinuxDesktopInstallerSh(appUrl), {
    unixPermissions: '755',
  });
  zip.file('openfs-usb-linux.sh', generateLinuxUsbBridgeScript(), {
    unixPermissions: '755',
  });
  zip.file('openfs.svg', OPENFS_ICON_SVG);
  zip.file(
    'LISEZ-MOI.txt',
    `OpenFS — Pack d'installation Bureau pour Linux\n` +
      `============================================\n\n` +
      `1. Decompressez cette archive (.zip).\n` +
      `2. Dans un terminal, lancez :\n` +
      `   chmod +x installer-openfs-bureau.sh openfs-usb-linux.sh\n` +
      `   ./installer-openfs-bureau.sh\n` +
      `   -> Cree le lanceur OpenFS sur votre Bureau et dans vos Applications.\n` +
      `3. Branchez votre iPhone en USB-C et lancez ./openfs-usb-linux.sh pour monter ~/iPhone-USB.\n`
  );
  const filename = 'OpenFS-Desktop-Linux.zip';
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  downloadBlob(blob, filename);
  return filename;
}

