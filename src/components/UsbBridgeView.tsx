import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Columns2,
  Copy,
  Download,
  File as FileIcon,
  Folder,
  FolderOpen,
  HardDrive,
  Laptop,
  Play,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Terminal,
  Unplug,
  Usb,
} from 'lucide-react';
import {
  isDirectoryPickerSupported,
  isWebUsbSupported,
  type ConnectedUsbDeviceInfo,
} from '../lib/webUsbBridge';
import {
  getDesktopBridge,
  getWindowsExeFilename,
  getWindowsExeUrl,
  type DesktopFsEntry,
  type DesktopIphoneDevice,
} from '../lib/desktopBridge';
import { formatBytes } from '../lib/fsUtils';

interface UsbBridgeViewProps {
  usbDevice: ConnectedUsbDeviceInfo | null;
  usbError: string | null;
  mountedIphoneDirName: string | null;
  mountedPcDirName: string | null;
  onConnectWebUsb: (appleOnly?: boolean) => Promise<void>;
  onDisconnectUsb: () => void;
  onEnableDemoUsb: () => void;
  onMountIphoneVolume: () => Promise<void>;
  onMountPcDirectory: () => Promise<void>;
  onOpenDualPaneExplorer: () => void;
}

export function UsbBridgeView({
  usbDevice,
  usbError,
  mountedIphoneDirName,
  mountedPcDirName,
  onConnectWebUsb,
  onDisconnectUsb,
  onEnableDemoUsb,
  onMountIphoneVolume,
  onMountPcDirectory,
  onOpenDualPaneExplorer,
}: UsbBridgeViewProps) {
  const desktopBridge = getDesktopBridge();
  const windowsExeUrl = getWindowsExeUrl();
  const windowsExeFilename = getWindowsExeFilename(windowsExeUrl);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Native Electron Windows WPD / AFC State
  const [nativeDevices, setNativeDevices] = useState<DesktopIphoneDevice[]>([]);
  const [activeNativeDevice, setActiveNativeDevice] = useState<DesktopIphoneDevice | null>(null);
  const [nativePath, setNativePath] = useState<string>('');
  const [nativeEntries, setNativeEntries] = useState<DesktopFsEntry[]>([]);
  const [nativeDestDir, setNativeDestDir] = useState<string>('');
  const [nativeBusy, setNativeBusy] = useState(false);
  const [nativeStatus, setNativeStatus] = useState<string | null>(null);
  const [nativeError, setNativeError] = useState<string | null>(null);

  const webUsbOk = isWebUsbSupported();
  const fsApiOk = isDirectoryPickerSupported();

  useEffect(() => {
    if (!desktopBridge) return;
    desktopBridge
      .getDefaultSyncDir()
      .then((dir) => setNativeDestDir(dir))
      .catch(() => {});
  }, [desktopBridge]);

  const scanNativeIphone = async () => {
    if (!desktopBridge) return;
    setNativeBusy(true);
    setNativeError(null);
    setNativeStatus(null);
    try {
      const devices = await desktopBridge.listIphoneDevices();
      setNativeDevices(devices);
      if (devices.length === 0) {
        setActiveNativeDevice(null);
        setNativeEntries([]);
        setNativePath('');
        setNativeError(
          'Aucun iPhone détecté. Branchez votre iPhone en USB-C, déverrouillez-le et appuyez sur « Faire confiance ».'
        );
      } else {
        const first = devices[0];
        setActiveNativeDevice(first);
        setNativePath('');
        const entries = await desktopBridge.listIphoneDirectory(first.id, '');
        setNativeEntries(entries);
        setNativeStatus(`Connecté en natif : ${first.name}`);
      }
    } catch (err) {
      setNativeError(err instanceof Error ? err.message : 'Erreur de lecture USB-C native.');
    } finally {
      setNativeBusy(false);
    }
  };

  const openNativePath = async (device: DesktopIphoneDevice, nextPath: string) => {
    if (!desktopBridge) return;
    setNativeBusy(true);
    setNativeError(null);
    try {
      const entries = await desktopBridge.listIphoneDirectory(device.id, nextPath);
      setNativePath(nextPath);
      setNativeEntries(entries);
    } catch (err) {
      setNativeError(err instanceof Error ? err.message : 'Impossible d’ouvrir ce dossier iPhone.');
    } finally {
      setNativeBusy(false);
    }
  };

  const handleCopyNativeItem = async (entry: DesktopFsEntry) => {
    if (!desktopBridge || !activeNativeDevice) return;
    setNativeBusy(true);
    setNativeError(null);
    setNativeStatus(`Copie de « ${entry.name} » vers votre PC...`);
    try {
      const outPath = await desktopBridge.copyFromIphoneToPc(
        activeNativeDevice.id,
        entry.path,
        nativeDestDir || undefined
      );
      setNativeStatus(`Copié sur votre PC : ${outPath}`);
    } catch (err) {
      setNativeError(err instanceof Error ? err.message : 'Échec de la copie vers le PC.');
      setNativeStatus(null);
    } finally {
      setNativeBusy(false);
    }
  };

  const handlePickNativeDestDir = async () => {
    if (!desktopBridge) return;
    const picked = await desktopBridge.pickPcDirectory();
    if (picked) {
      setNativeDestDir(picked);
    }
  };

  const copyCommand = (id: string, cmd: string) => {
    navigator.clipboard?.writeText(cmd).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1600);
  };

  const windowsCommands = [
    {
      id: 'win_store',
      label: '1. Installer le pilote USB-C officiel Apple (Appareils Apple via winget)',
      cmd: 'winget install --id 9NP83LWLPZ9K --source msstore',
    },
    {
      id: 'win_detect',
      label: '2. Vérifier que l’iPhone est reconnu en USB-C (VID 0x05AC)',
      cmd: 'Get-PnpDevice | Where-Object { $_.InstanceId -match "VID_05AC" } | Format-Table Status, FriendlyName',
    },
    {
      id: 'win_backup',
      label: '3. Accéder au dossier local des sauvegardes / exports Windows',
      cmd: 'explorer "$env:USERPROFILE\\Apple\\MobileSync\\Backup"',
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto bg-white dark:bg-slate-950 p-5 md:p-8">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
          <div className="space-y-1">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Pont USB-C : iPhone vers Windows & Linux
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 max-w-2xl">
              Connectez votre iPhone en USB-C sur un ordinateur non-Apple, détectez le périphérique via WebUSB et montez le stockage iPhone + votre dossier PC pour transférer librement dans les deux sens.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenDualPaneExplorer}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0"
          >
            <Columns2 size={15} />
            Ouvrir l’explorateur iPhone ↔ PC
          </button>
        </div>

        {/* Native Electron Desktop Windows WPD / AFC Direct iPhone Browser */}
        {desktopBridge && (
          <section className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/20 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Smartphone size={16} className="text-blue-600 dark:text-blue-400" />
                  Accès natif Windows WPD (Ce PC → Apple iPhone)
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  Mode logiciel bureau actif : OpenFS lit directement votre iPhone en USB-C sans les limites du navigateur.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={nativeBusy}
                  onClick={scanNativeIphone}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-colors whitespace-nowrap"
                >
                  <RefreshCw size={13} className={nativeBusy ? 'animate-spin' : ''} />
                  {activeNativeDevice ? 'Actualiser l’iPhone' : 'Détecter l’iPhone (USB-C natif)'}
                </button>
                <button
                  type="button"
                  onClick={handlePickNativeDestDir}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
                >
                  <HardDrive size={13} />
                  Dossier PC de sortie
                </button>
              </div>
            </div>

            {nativeDestDir && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2">
                <span className="truncate">
                  Destination PC : <code className="font-mono text-slate-900 dark:text-slate-100">{nativeDestDir}</code>
                </span>
                <button
                  type="button"
                  onClick={() => desktopBridge.openInExplorer(nativeDestDir)}
                  className="text-blue-600 dark:text-blue-400 font-medium hover:underline shrink-0"
                >
                  Ouvrir dans l’Explorateur
                </button>
              </div>
            )}

            {nativeStatus && (
              <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                {nativeStatus}
              </div>
            )}
            {nativeError && (
              <div className="text-xs font-medium text-red-600 dark:text-red-400">
                {nativeError}
              </div>
            )}

            {activeNativeDevice && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {nativePath && (
                      <button
                        type="button"
                        disabled={nativeBusy}
                        onClick={() => {
                          const parts = nativePath.split('/').filter(Boolean);
                          parts.pop();
                          openNativePath(activeNativeDevice, parts.join('/'));
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                      >
                        <ArrowLeft size={12} />
                        Retour
                      </button>
                    )}
                    <span className="text-xs font-mono text-slate-700 dark:text-slate-300 truncate">
                      {activeNativeDevice.name}/{nativePath}
                    </span>
                  </div>
                  {nativeDevices.length > 1 && (
                    <span className="text-xs text-slate-500">
                      {nativeDevices.length} appareils détectés
                    </span>
                  )}
                </div>

                {nativeEntries.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                    Dossier vide.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800/80 max-h-80 overflow-y-auto">
                    {nativeEntries.map((entry) => (
                      <div
                        key={entry.path}
                        className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-900/40"
                      >
                        <button
                          type="button"
                          disabled={entry.kind !== 'folder' || nativeBusy}
                          onClick={() => {
                            if (entry.kind === 'folder') {
                              openNativePath(activeNativeDevice, entry.path);
                            }
                          }}
                          className="flex items-center gap-2.5 min-w-0 text-left disabled:cursor-default"
                        >
                          {entry.kind === 'folder' ? (
                            <Folder size={16} className="text-blue-600 dark:text-blue-400 shrink-0" />
                          ) : (
                            <FileIcon size={15} className="text-slate-400 shrink-0" />
                          )}
                          <span className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                            {entry.name}
                          </span>
                          {entry.kind === 'file' && entry.size > 0 && (
                            <span className="text-[11px] font-mono text-slate-400 shrink-0">
                              {formatBytes(entry.size)}
                            </span>
                          )}
                        </button>

                        <button
                          type="button"
                          disabled={nativeBusy}
                          onClick={() => handleCopyNativeItem(entry)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 shrink-0"
                        >
                          <Download size={12} />
                          Copier vers PC
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* Live USB-C Connection & Mount Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Card 1: WebUSB Hardware Detection */}
          <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 flex flex-col justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  1. Connexion USB-C directe
                </span>
                <Usb size={16} className={usbDevice ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'} />
              </div>

              {usbDevice ? (
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {usbDevice.productName}
                  </div>
                  <div className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-400">
                    {usbDevice.manufacturerName} · {usbDevice.vendorHex}:{usbDevice.productHex} · USB {usbDevice.usbVersion}
                  </div>
                  <div className="text-xs text-emerald-700 dark:text-emerald-400 font-medium pt-0.5">
                    {usbDevice.mode === 'simulated'
                      ? 'Mode aperçu USB-C actif (démonstration)'
                      : 'Périphérique Apple détecté sur le port USB-C'}
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Aucun iPhone connecté
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Branchez votre iPhone en USB-C, déverrouillez-le et lancez la détection WebUSB (Chrome, Edge, Brave).
                  </p>
                </div>
              )}

              {usbError && (
                <p className="text-xs text-red-600 dark:text-red-400 pt-1 leading-relaxed">
                  {usbError}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              {!usbDevice ? (
                <>
                  <button
                    type="button"
                    onClick={() => onConnectWebUsb(true)}
                    disabled={!webUsbOk}
                    className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-45 transition-colors whitespace-nowrap"
                  >
                    <Usb size={14} />
                    {webUsbOk ? 'Connecter l’iPhone en USB-C' : 'WebUSB indisponible sur ce navigateur'}
                  </button>
                  <button
                    type="button"
                    onClick={onEnableDemoUsb}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors whitespace-nowrap"
                  >
                    <Play size={13} />
                    Tester sans iPhone branché
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={onDisconnectUsb}
                  className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors whitespace-nowrap"
                >
                  <Unplug size={14} />
                  Déconnecter la session USB
                </button>
              )}
            </div>
          </div>

          {/* Card 2: Mount iPhone Volume */}
          <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 flex flex-col justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  2. Volume iPhone (ifuse / DCIM)
                </span>
                <Smartphone size={16} className={mountedIphoneDirName ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400'} />
              </div>

              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {mountedIphoneDirName ? `Monté : ${mountedIphoneDirName}` : 'Monter le stockage iPhone'}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                {desktopBridge
                  ? 'Utilisez le bloc « Accès natif Windows WPD » ci-dessus pour ouvrir directement Ce PC → Apple iPhone, ou montez un dossier local.'
                  : 'Sous Linux, sélectionnez ~/iPhone-USB (ifuse). Dans un navigateur Windows, Chrome masque « Ce PC → Apple iPhone » (MTP) : glissez-déposez vos fichiers depuis l’Explorateur Windows ou utilisez la version .exe native.'}
              </p>
            </div>

            <button
              type="button"
              onClick={onMountIphoneVolume}
              className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white transition-colors whitespace-nowrap"
            >
              <FolderOpen size={14} />
              {mountedIphoneDirName ? 'Changer le dossier iPhone' : 'Monter le volume iPhone'}
            </button>
          </div>

          {/* Card 3: Mount PC Destination Folder */}
          <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 flex flex-col justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  3. Dossier PC (Windows / Linux)
                </span>
                <Laptop size={16} className={mountedPcDirName ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'} />
              </div>

              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {mountedPcDirName ? `Lié en direct : ${mountedPcDirName}` : 'Lier un dossier du disque dur'}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Choisissez un dossier réel de votre PC : les fichiers copiés depuis l’iPhone y seront écrits directement sur votre disque dur.
              </p>
            </div>

            <button
              type="button"
              onClick={onMountPcDirectory}
              className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors whitespace-nowrap"
            >
              <HardDrive size={14} />
              {mountedPcDirName ? 'Changer le dossier PC' : 'Monter un dossier PC'}
            </button>
          </div>
        </div>

        {/* Connected USB Device Hardware Descriptors Table */}
        {usbDevice && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Descripteurs matériels USB-C détectés
              </h2>
              <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                S/N : {usbDevice.serialNumber}
              </span>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 font-medium">
                    <th className="py-2.5 px-4">Interface</th>
                    <th className="py-2.5 px-4">Protocole iOS / USB</th>
                    <th className="py-2.5 px-4 text-right">Classe / Sous-classe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {usbDevice.interfaces.length > 0 ? (
                    usbDevice.interfaces.map((iface) => (
                      <tr key={iface.interfaceNumber}>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                          #{iface.interfaceNumber}
                        </td>
                        <td className="py-2.5 px-4 font-medium text-slate-900 dark:text-slate-100">
                          {iface.label}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          0x{iface.classCode.toString(16).toUpperCase().padStart(2, '0')} / 0x
                          {iface.subclassCode.toString(16).toUpperCase().padStart(2, '0')}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3} className="py-3 px-4 text-slate-500 dark:text-slate-400">
                        Périphérique détecté ({usbDevice.vendorHex}:{usbDevice.productHex}). Les interfaces bas niveau sont gérées par le pilote système (Apple Mobile Device).
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Native OS Setup Guide & Direct Windows Installer */}
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Débloquer l’accès complet sur PC Windows 10 / 11
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Contrairement à Android (MTP), iOS utilise le protocole Apple sur USB-C. Utilisez l’application Windows native gratuite ci-dessous pour parcourir tout l’iPhone en un clic.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <Terminal size={17} className="text-blue-600 dark:text-blue-400 shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Installeur natif Windows 10 / 11 (.exe)
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Gratuit · Installe OpenFS sur le Bureau avec pont USB-C Windows WPD intégré.
                  </div>
                </div>
              </div>

              <a
                href={windowsExeUrl}
                download={windowsExeFilename}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0"
              >
                <Download size={14} />
                Télécharger pour Windows (.exe)
              </a>
            </div>

            <div className="space-y-3">
              {windowsCommands.map((item) => (
                <div key={item.id} className="space-y-1.5">
                  <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    {item.label}
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2">
                    <code className="text-xs font-mono text-slate-800 dark:text-slate-200 overflow-x-auto whitespace-nowrap">
                      {item.cmd}
                    </code>
                    <button
                      type="button"
                      onClick={() => copyCommand(item.id, item.cmd)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
                    >
                      {copiedId === item.id ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                      {copiedId === item.id ? 'Copié' : 'Copier'}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Technical capabilities summary */}
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck size={14} className={webUsbOk ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500'} />
                WebUSB : {webUsbOk ? 'Actif' : 'Non supporté (utilisez Chrome / Edge)'}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck size={14} className={fsApiOk ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500'} />
                Écriture directe sur disque PC : {fsApiOk ? 'Disponible' : 'Mode import/téléchargement'}
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
