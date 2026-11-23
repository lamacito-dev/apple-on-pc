import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Download,
  File as FileIcon,
  Folder,
  RefreshCw,
} from 'lucide-react';
import {
  isWebUsbSupported,
  type ConnectedUsbDeviceInfo,
} from '../lib/webUsbBridge';
import {
  getDesktopBridge,
  type DesktopFsEntry,
  type DesktopIphoneDevice,
} from '../lib/desktopBridge';
import { formatBytes } from '../lib/fsUtils';

interface UsbBridgeViewProps {
  usbDevice: ConnectedUsbDeviceInfo | null;
  usbError: string | null;
  nativeDevices: DesktopIphoneDevice[];
  activeNativeDevice: DesktopIphoneDevice | null;
  nativeDestDir: string;
  nativeBusy: boolean;
  nativeError: string | null;
  mountedIphoneDirName: string | null;
  mountedPcDirName: string | null;
  onScanNativeIphone: (silent?: boolean) => Promise<void>;
  onSelectNativeDevice: (device: DesktopIphoneDevice) => void;
  onPickNativePcDir: () => Promise<void>;
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
  nativeDevices,
  activeNativeDevice,
  nativeDestDir,
  nativeBusy,
  nativeError,
  mountedIphoneDirName,
  mountedPcDirName,
  onScanNativeIphone,
  onSelectNativeDevice,
  onPickNativePcDir,
  onConnectWebUsb,
  onDisconnectUsb,
  onEnableDemoUsb,
  onMountPcDirectory,
  onOpenDualPaneExplorer,
}: UsbBridgeViewProps) {
  const desktopBridge = getDesktopBridge();
  const webUsbOk = isWebUsbSupported();

  // Optional quick folder browser on Pont USB-C when a native WPD device is ready
  const [nativePath, setNativePath] = useState<string>('');
  const [nativeEntries, setNativeEntries] = useState<DesktopFsEntry[]>([]);
  const [browseBusy, setBrowseBusy] = useState(false);
  const [browseStatus, setBrowseStatus] = useState<string | null>(null);
  const [browseError, setBrowseError] = useState<string | null>(null);

  useEffect(() => {
    if (!desktopBridge || !activeNativeDevice || activeNativeDevice.status !== 'ready') {
      setNativeEntries([]);
      setNativePath('');
      return;
    }

    let cancelled = false;
    setBrowseBusy(true);
    setBrowseError(null);
    desktopBridge
      .listIphoneDirectory(activeNativeDevice.id, '')
      .then((entries) => {
        if (cancelled) return;
        setNativePath('');
        setNativeEntries(entries);
      })
      .catch((err) => {
        if (cancelled) return;
        setBrowseError(
          err instanceof Error ? err.message : 'Impossible de lire le stockage iPhone.'
        );
      })
      .finally(() => {
        if (!cancelled) setBrowseBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [desktopBridge, activeNativeDevice?.id, activeNativeDevice?.status]);

  const openNativePath = async (device: DesktopIphoneDevice, nextPath: string) => {
    if (!desktopBridge) return;
    setBrowseBusy(true);
    setBrowseError(null);
    try {
      const entries = await desktopBridge.listIphoneDirectory(device.id, nextPath);
      setNativePath(nextPath);
      setNativeEntries(entries);
    } catch (err) {
      setBrowseError(
        err instanceof Error ? err.message : 'Impossible d’ouvrir ce dossier iPhone.'
      );
    } finally {
      setBrowseBusy(false);
    }
  };

  const handleCopyNativeItem = async (entry: DesktopFsEntry) => {
    if (!desktopBridge || !activeNativeDevice) return;
    setBrowseBusy(true);
    setBrowseError(null);
    setBrowseStatus(`Copie de « ${entry.name} » vers votre PC...`);
    try {
      const outPath = await desktopBridge.copyFromIphoneToPc(
        activeNativeDevice.id,
        entry.path,
        nativeDestDir || undefined
      );
      setBrowseStatus(`Copié : ${outPath}`);
    } catch (err) {
      setBrowseError(err instanceof Error ? err.message : 'Échec de la copie vers le PC.');
      setBrowseStatus(null);
    } finally {
      setBrowseBusy(false);
    }
  };

  const handlePickPcFolder = async () => {
    if (desktopBridge) {
      await onPickNativePcDir();
      return;
    }
    await onMountPcDirectory();
  };

  const isNativeReady = Boolean(activeNativeDevice && activeNativeDevice.status === 'ready');
  const isNativeLocked = Boolean(activeNativeDevice && activeNativeDevice.status === 'locked');
  const isIphoneDetected = Boolean(activeNativeDevice || usbDevice || mountedIphoneDirName);
  const isIphoneReady = Boolean(isNativeReady || usbDevice || mountedIphoneDirName);
  const isPcLinked = Boolean(nativeDestDir || mountedPcDirName);
  const isReadyToTransfer = isIphoneReady && isPcLinked;

  const displayDeviceName =
    activeNativeDevice?.name || usbDevice?.productName || mountedIphoneDirName || null;
  const displayVidPid = activeNativeDevice
    ? `Apple Inc. · VID ${activeNativeDevice.vendorId || '0x05AC'}${
        activeNativeDevice.productId ? ` · PID ${activeNativeDevice.productId}` : ''
      }`
    : usbDevice
      ? `${usbDevice.manufacturerName} · VID ${usbDevice.vendorHex} · PID ${usbDevice.productHex}`
      : 'Apple Inc. · VID 0x05AC';
  const displayDeviceProtocol = activeNativeDevice
    ? activeNativeDevice.backend === 'wpd'
      ? 'USB-C · Windows WPD natif'
      : activeNativeDevice.backend === 'usb_pnp'
        ? 'USB-C · En attente d’autorisation iOS'
        : 'USB-C · AFC natif'
    : usbDevice
      ? `USB ${usbDevice.usbVersion}`
      : 'USB 3.2';
  const displayPcPath =
    nativeDestDir ||
    (mountedPcDirName ? `PC\\${mountedPcDirName}` : 'OpenFS-iPhone-Sync');

  const steps = [
    { num: 1, label: '1. iPhone détecté', done: isIphoneDetected },
    { num: 2, label: '2. Dossier PC monté', done: isPcLinked },
    { num: 3, label: '3. Prêt à transférer', done: isReadyToTransfer },
  ];

  return (
    <div className="flex-1 overflow-y-auto px-6 sm:px-10 py-8 sm:py-10">
      <div className="max-w-4xl mx-auto space-y-9">
        {/* Clean Page Title */}
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Pont USB-C
        </h1>

        {/* Two Equal Minimal Cards matching Reference 01 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Card 1: iPhone Status */}
          <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 flex flex-col justify-between min-h-[248px]">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {isIphoneReady
                    ? 'iPhone connecté'
                    : isNativeLocked
                      ? 'iPhone détecté'
                      : 'iPhone USB-C'}
                </h2>
                {isIphoneDetected && (
                  <button
                    type="button"
                    disabled={nativeBusy}
                    onClick={() => (desktopBridge ? onScanNativeIphone(false) : onDisconnectUsb())}
                    className="text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 transition-colors inline-flex items-center gap-1"
                  >
                    {desktopBridge && nativeBusy && <RefreshCw size={11} className="animate-spin" />}
                    {desktopBridge ? 'Actualiser' : 'Déconnecter'}
                  </button>
                )}
              </div>

              {isIphoneDetected ? (
                <div className="space-y-3">
                  {isNativeLocked ? (
                    <div className="inline-flex items-center px-3 py-1 rounded-md bg-amber-500 text-white text-xs font-medium">
                      Déverrouillez l’iPhone
                    </div>
                  ) : (
                    <div className="inline-flex items-center px-3 py-1 rounded-md bg-[#0F7659] text-white text-xs font-medium">
                      USB-C actif
                    </div>
                  )}

                  <div className="space-y-1.5 pt-1 text-sm text-slate-800 dark:text-slate-200">
                    <div className="font-medium">{displayDeviceName || 'Apple iPhone'}</div>
                    <div className="text-slate-600 dark:text-slate-400">{displayVidPid}</div>
                    <div className="text-slate-600 dark:text-slate-400 tabular-nums">
                      {displayDeviceProtocol}
                    </div>
                  </div>

                  {isNativeLocked && activeNativeDevice?.hint && (
                    <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed pt-1">
                      {activeNativeDevice.hint}
                    </p>
                  )}

                  {nativeDevices.length > 1 && (
                    <div className="pt-1 flex flex-wrap gap-1.5">
                      {nativeDevices.map((dev) => (
                        <button
                          key={dev.id}
                          type="button"
                          onClick={() => onSelectNativeDevice(dev)}
                          className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                            activeNativeDevice?.id === dev.id
                              ? 'border-[#1A65C7] bg-blue-50 text-[#1A65C7] dark:bg-blue-950/40 dark:text-blue-300'
                              : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          {dev.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2.5 text-sm text-slate-600 dark:text-slate-400">
                  <p className="leading-relaxed">
                    Branchez votre iPhone en USB-C, déverrouillez l’écran et validez « Faire
                    confiance à cet ordinateur ».
                  </p>
                  {(nativeError || usbError) && (
                    <p className="text-xs text-red-600 dark:text-red-400 leading-relaxed">
                      {nativeError || usbError}
                    </p>
                  )}
                </div>
              )}
            </div>

            {!isIphoneDetected && (
              <div className="pt-5 space-y-2">
                <button
                  type="button"
                  disabled={nativeBusy || (!desktopBridge && !webUsbOk)}
                  onClick={() => (desktopBridge ? onScanNativeIphone(false) : onConnectWebUsb(true))}
                  className="w-full py-2.5 px-4 rounded-lg bg-[#1A65C7] hover:bg-[#1557B0] disabled:opacity-50 text-white text-sm font-medium transition-colors inline-flex items-center justify-center gap-2"
                >
                  {nativeBusy && <RefreshCw size={14} className="animate-spin" />}
                  {nativeBusy ? 'Recherche en cours...' : 'Détecter l’iPhone'}
                </button>
                {!desktopBridge && (
                  <div className="flex items-center justify-between gap-2 pt-0.5">
                    {webUsbOk && (
                      <button
                        type="button"
                        onClick={() => onConnectWebUsb(false)}
                        className="text-xs text-[#1A65C7] dark:text-blue-400 hover:underline py-1"
                      >
                        Tous les ports USB
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={onEnableDemoUsb}
                      className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors py-1 ml-auto"
                    >
                      Aperçu sans iPhone
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Card 2: Linked PC Folder */}
          <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 flex flex-col justify-between min-h-[248px]">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  Dossier PC lié
                </h2>
                <button
                  type="button"
                  onClick={handlePickPcFolder}
                  className="text-xs font-medium text-[#1A65C7] dark:text-blue-400 hover:underline shrink-0"
                >
                  {isPcLinked ? 'Changer' : 'Choisir'}
                </button>
              </div>

              <div className="text-sm text-slate-800 dark:text-slate-200 break-all leading-relaxed">
                {displayPcPath}
              </div>
            </div>

            <div className="pt-6 space-y-3.5">
              <div className="flex items-center justify-between gap-2 text-sm text-slate-700 dark:text-slate-300">
                <span>
                  {isPcLinked
                    ? 'Écriture directe sur le disque activée'
                    : 'Dossier local prêt pour les transferts'}
                </span>
                {desktopBridge && nativeDestDir && (
                  <button
                    type="button"
                    onClick={() => desktopBridge.openInExplorer(nativeDestDir)}
                    className="text-xs font-medium text-[#1A65C7] dark:text-blue-400 hover:underline shrink-0"
                  >
                    Ouvrir
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={onOpenDualPaneExplorer}
                className="w-full py-2.5 px-4 rounded-lg bg-[#1A65C7] hover:bg-[#1557B0] text-white text-sm font-medium transition-colors"
              >
                Ouvrir le double panneau
              </button>
            </div>
          </div>
        </div>

        {/* Clean Horizontal 3-Step Status Stepper matching Reference 01 */}
        <div className="pt-2 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-3">
          {steps.map((step, index) => (
            <div
              key={step.num}
              className={`flex items-center gap-3 ${index < steps.length - 1 ? 'sm:flex-1' : ''}`}
            >
              <div className="flex items-center gap-2.5 shrink-0">
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors shrink-0 ${
                    step.done
                      ? 'bg-[#1A65C7] text-white'
                      : 'border border-slate-300 dark:border-slate-700 text-slate-400 dark:text-slate-500'
                  }`}
                >
                  <Check size={13} strokeWidth={2.5} />
                </span>
                <span
                  className={`text-sm whitespace-nowrap ${
                    step.done
                      ? 'text-slate-900 dark:text-slate-100 font-medium'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {step.label}
                </span>
              </div>

              {index < steps.length - 1 && (
                <div
                  aria-hidden="true"
                  className={`hidden sm:block h-[2px] flex-1 rounded-full transition-colors ${
                    step.done
                      ? 'bg-[#1A65C7]'
                      : 'bg-slate-200 dark:bg-slate-800'
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Native Windows WPD Live iPhone Quick Browser (shown inside .exe once unlocked) */}
        {desktopBridge && activeNativeDevice && activeNativeDevice.status === 'ready' && (
          <section className="pt-2 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                {nativePath && (
                  <button
                    type="button"
                    disabled={browseBusy}
                    onClick={() => {
                      const parts = nativePath.split('/').filter(Boolean);
                      parts.pop();
                      openNativePath(activeNativeDevice, parts.join('/'));
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <ArrowLeft size={13} />
                    Retour
                  </button>
                )}
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {activeNativeDevice.name}
                  {nativePath ? ` · /${nativePath}` : ''}
                </h3>
              </div>

              {browseBusy && <RefreshCw size={13} className="animate-spin text-slate-400 shrink-0" />}
            </div>

            {browseStatus && (
              <p className="text-xs text-emerald-700 dark:text-emerald-400">{browseStatus}</p>
            )}
            {browseError && (
              <p className="text-xs text-red-600 dark:text-red-400">{browseError}</p>
            )}

            {nativeEntries.length === 0 && !browseBusy ? (
              <div className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
                Ce dossier iPhone est vide.
              </div>
            ) : (
              <div className="space-y-2">
                {nativeEntries.map((entry) => (
                  <div
                    key={entry.path}
                    className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 flex items-center justify-between gap-3 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
                  >
                    <button
                      type="button"
                      disabled={entry.kind !== 'folder' || browseBusy}
                      onClick={() => {
                        if (entry.kind === 'folder') {
                          openNativePath(activeNativeDevice, entry.path);
                        }
                      }}
                      className="flex items-center gap-3 min-w-0 flex-1 text-left disabled:cursor-default"
                    >
                      {entry.kind === 'folder' ? (
                        <Folder
                          size={20}
                          className="text-[#1A65C7] fill-[#1A65C7]/90 dark:text-blue-400 dark:fill-blue-400/80 shrink-0"
                        />
                      ) : (
                        <FileIcon size={18} className="text-slate-400 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                          {entry.name}
                        </div>
                        {entry.kind === 'file' && entry.size > 0 && (
                          <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                            {formatBytes(entry.size)}
                          </div>
                        )}
                      </div>
                    </button>

                    <button
                      type="button"
                      disabled={browseBusy}
                      onClick={() => handleCopyNativeItem(entry)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-[#1A65C7] text-white hover:bg-[#1557B0] disabled:opacity-50 transition-colors shrink-0"
                    >
                      <Download size={13} />
                      Copier vers PC
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
