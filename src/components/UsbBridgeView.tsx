import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  FolderOpen,
  HardDrive,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Unplug,
} from 'lucide-react';
import {
  isWebUsbSupported,
  type ConnectedUsbDeviceInfo,
} from '../lib/webUsbBridge';
import {
  getDesktopBridge,
  type DesktopAfcCapabilities,
  type DesktopIphoneDevice,
  type DesktopLogsResult,
} from '../lib/desktopBridge';

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
  onOpenAfcStorage?: () => void;
  onOpenAfcApps?: () => void;
  onToast?: (text: string, type?: 'info' | 'success' | 'error') => void;
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
  onOpenAfcStorage,
  onOpenAfcApps,
  onToast,
}: UsbBridgeViewProps) {
  const desktopBridge = getDesktopBridge();
  const webUsbOk = isWebUsbSupported();

  const [caps, setCaps] = useState<DesktopAfcCapabilities | null>(null);
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairNotice, setPairNotice] = useState<string | null>(null);
  const [linuxBusy, setLinuxBusy] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsData, setLogsData] = useState<DesktopLogsResult | null>(null);

  const refreshCapabilities = useCallback(async () => {
    if (!desktopBridge) return;
    try {
      const c = await desktopBridge.getAfcCapabilities();
      setCaps(c);
    } catch (err) {
      console.warn('[OpenFS] Erreur getAfcCapabilities:', err);
    }
  }, [desktopBridge]);

  useEffect(() => {
    refreshCapabilities();
  }, [refreshCapabilities, nativeDevices.length]);

  const handlePickPcFolder = async () => {
    if (desktopBridge) {
      await onPickNativePcDir();
      return;
    }
    await onMountPcDirectory();
  };

  const handlePairIphone = async () => {
    if (!desktopBridge || pairingBusy) return;
    setPairingBusy(true);
    setPairNotice(null);
    try {
      const udid = activeNativeDevice?.afcUdid || activeNativeDevice?.udid || '';
      const res = await desktopBridge.pairIphone(udid || undefined);
      setPairNotice(res.message);
      onToast?.(res.message, res.paired ? 'success' : 'info');
      await onScanNativeIphone(false);
      await refreshCapabilities();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Échec de l’appairage AFC.';
      setPairNotice(msg);
      onToast?.(msg, 'error');
    } finally {
      setPairingBusy(false);
    }
  };

  const handleInstallLinuxDeps = async () => {
    if (!desktopBridge || linuxBusy) return;
    setLinuxBusy('Installation via pkexec...');
    try {
      await desktopBridge.linuxInstallDeps();
      await refreshCapabilities();
      await onScanNativeIphone(false);
      onToast?.('Dépendances Linux installées avec succès.', 'success');
    } catch (err) {
      onToast?.(
        err instanceof Error ? err.message : 'Installation annulée ou échouée.',
        'error'
      );
    } finally {
      setLinuxBusy(null);
    }
  };

  const handleLinuxMount = async () => {
    if (!desktopBridge || linuxBusy) return;
    setLinuxBusy('Montage ~/iPhone-USB...');
    try {
      const udid = activeNativeDevice?.afcUdid || activeNativeDevice?.udid || '';
      const res = await desktopBridge.linuxMountIphone(udid || undefined);
      await refreshCapabilities();
      onToast?.(res.message, 'success');
    } catch (err) {
      onToast?.(err instanceof Error ? err.message : 'Impossible de monter l’iPhone.', 'error');
    } finally {
      setLinuxBusy(null);
    }
  };

  const handleLinuxUnmount = async () => {
    if (!desktopBridge || linuxBusy) return;
    setLinuxBusy('Démontage...');
    try {
      const res = await desktopBridge.linuxUnmountIphone();
      await refreshCapabilities();
      onToast?.(res.message, 'info');
    } catch (err) {
      onToast?.(err instanceof Error ? err.message : 'Erreur lors du démontage.', 'error');
    } finally {
      setLinuxBusy(null);
    }
  };

  const handleToggleLogs = async () => {
    const next = !logsOpen;
    setLogsOpen(next);
    if (next && desktopBridge) {
      try {
        const l = await desktopBridge.getLogs();
        setLogsData(l);
      } catch (err) {
        onToast?.(err instanceof Error ? err.message : 'Impossible de charger les logs.', 'error');
      }
    }
  };

  const isNativeReady = Boolean(activeNativeDevice && activeNativeDevice.status === 'ready');
  const isNativeLocked = Boolean(activeNativeDevice && activeNativeDevice.status === 'locked');
  const isIphoneDetected = Boolean(activeNativeDevice || usbDevice || mountedIphoneDirName);
  const isIphoneReady = Boolean(isNativeReady || usbDevice || mountedIphoneDirName);
  const isPcLinked = Boolean(nativeDestDir || mountedPcDirName);
  const isReadyToTransfer = isIphoneReady && isPcLinked;

  const afcReady = Boolean(activeNativeDevice?.afcPaired);
  const isWin = caps?.platform === 'win32';
  const isLinux = caps?.platform === 'linux';
  const amdsMissing = Boolean(desktopBridge && isWin && caps && (!caps.amds.installed || !caps.amds.running));

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
    ? activeNativeDevice.afcPaired
      ? 'USB-C · AFC complet + Photos WPD'
      : activeNativeDevice.backend === 'wpd'
        ? 'USB-C · Windows WPD (Photos lecture seule)'
        : activeNativeDevice.backend === 'usb_pnp'
          ? 'USB-C · En attente d’autorisation iOS'
          : 'USB-C · AFC (appairage requis)'
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
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Pont USB-C
          </h1>
          {desktopBridge && (
            <button
              type="button"
              onClick={handleToggleLogs}
              className="text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 inline-flex items-center gap-1.5"
            >
              <Terminal size={13} />
              {logsOpen ? 'Masquer le journal' : 'Journal local'}
            </button>
          )}
        </div>

        {/* Two Equal Minimal Cards matching Reference 01 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Card 1: iPhone Status */}
          <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 flex flex-col justify-between min-h-[256px]">
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
                    onClick={() => {
                      if (desktopBridge) {
                        onScanNativeIphone(false);
                        refreshCapabilities();
                      } else {
                        onDisconnectUsb();
                      }
                    }}
                    className="text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 transition-colors inline-flex items-center gap-1"
                  >
                    {desktopBridge && nativeBusy && <RefreshCw size={11} className="animate-spin" />}
                    {desktopBridge ? 'Actualiser' : 'Déconnecter'}
                  </button>
                )}
              </div>

              {isIphoneDetected ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {isNativeLocked ? (
                      <div className="inline-flex items-center px-3 py-1 rounded-md bg-amber-500 text-white text-xs font-medium">
                        Déverrouillez l’iPhone
                      </div>
                    ) : (
                      <div className="inline-flex items-center px-3 py-1 rounded-md bg-[#0F7659] text-white text-xs font-medium">
                        USB-C actif
                      </div>
                    )}
                    {desktopBridge && afcReady && (
                      <span className="text-xs font-medium text-[#1A65C7] dark:text-blue-400">
                        AFC bidirectionnel prêt
                      </span>
                    )}
                  </div>

                  <div className="space-y-1.5 pt-1 text-sm text-slate-800 dark:text-slate-200">
                    <div className="font-medium">{displayDeviceName || 'Apple iPhone'}</div>
                    <div className="text-slate-600 dark:text-slate-400">{displayVidPid}</div>
                    <div className="text-slate-600 dark:text-slate-400 tabular-nums">
                      {displayDeviceProtocol}
                    </div>
                  </div>

                  {(pairNotice || (isNativeLocked && activeNativeDevice?.hint)) && (
                    <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed pt-1">
                      {pairNotice || activeNativeDevice?.hint}
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
                    Branchez votre iPhone en USB-C, déverrouillez l’écran et touchez « Se fier à cet
                    ordinateur ».
                  </p>
                  {(nativeError || usbError) && (
                    <p className="text-xs text-red-600 dark:text-red-400 leading-relaxed">
                      {nativeError || usbError}
                    </p>
                  )}
                </div>
              )}
            </div>

            {desktopBridge && isIphoneDetected && !afcReady && caps?.hasCoreAfc && !amdsMissing && (
              <div className="pt-4">
                <button
                  type="button"
                  disabled={pairingBusy}
                  onClick={handlePairIphone}
                  className="w-full py-2 px-3.5 rounded-lg border border-[#1A65C7]/40 bg-blue-50/70 dark:bg-blue-950/35 text-[#1A65C7] dark:text-blue-400 hover:bg-blue-100/70 text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors"
                >
                  <ShieldCheck size={14} />
                  {pairingBusy ? 'En attente de validation...' : 'Appairer en AFC (Se fier)'}
                </button>
              </div>
            )}

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
          <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 flex flex-col justify-between min-h-[256px]">
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

              <div className="text-sm text-slate-800 dark:text-slate-200 break-all leading-relaxed font-mono">
                {displayPcPath}
              </div>
            </div>

            <div className="pt-6 space-y-3">
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
                {desktopBridge && isNativeReady
                  ? 'Ouvrir mes photos et vidéos'
                  : 'Ouvrir l’explorateur'}
              </button>

              {desktopBridge && afcReady && (onOpenAfcStorage || onOpenAfcApps) && (
                <div className="grid grid-cols-2 gap-2">
                  {onOpenAfcStorage && (
                    <button
                      type="button"
                      onClick={onOpenAfcStorage}
                      className="py-2 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                    >
                      Stockage AFC
                    </button>
                  )}
                  {onOpenAfcApps && (
                    <button
                      type="button"
                      onClick={onOpenAfcApps}
                      className="py-2 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                    >
                      Documents d’apps
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Clean Horizontal 3-Step Status Stepper matching Reference 01 */}
        <div className="pt-1 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-3">
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
                    step.done ? 'bg-[#1A65C7]' : 'bg-slate-200 dark:bg-slate-800'
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Windows AMDS Prerequisite Card (only shown when missing on Windows) */}
        {amdsMissing && (
          <div className="rounded-2xl border border-blue-200 dark:border-blue-900/60 bg-white dark:bg-slate-900 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Débloquer l’accès complet iPhone (Documents d’apps, fichiers cachés, PC → iPhone)
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed max-w-2xl">
                Le service Windows <strong>Apple Mobile Device Service</strong> n’est pas installé.
                Vos photos restent accessibles en lecture seule via WPD. Pour activer le protocole
                AFC complet, installez gratuitement <strong>Appareils Apple</strong> depuis le
                Microsoft Store (pas besoin d’iTunes).
              </p>
            </div>
            <button
              type="button"
              onClick={() => desktopBridge?.openAppleDevicesStore()}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#1A65C7] hover:bg-[#1557B0] text-white text-xs font-medium shrink-0 transition-colors"
            >
              <ExternalLink size={14} />
              Installer Appareils Apple
            </button>
          </div>
        )}

        {/* Linux Dependency Check & Automatic ~/iPhone-USB Mount Card */}
        {desktopBridge && isLinux && caps?.linux.applicable && (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Pont Linux natif ({caps.linux.distro.prettyName})
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Point de montage : <code className="font-mono">{caps.linux.mountPoint}</code> ·{' '}
                  {caps.linux.mounted ? 'Monté ✓' : 'Non monté'}
                </p>
              </div>
              <button
                type="button"
                onClick={refreshCapabilities}
                className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 inline-flex items-center gap-1"
              >
                <RefreshCw size={12} />
                Vérifier
              </button>
            </div>

            {caps.linux.missingTools.length > 0 ? (
              <div className="space-y-3">
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Outils manquants :{' '}
                  <span className="font-mono font-semibold">
                    {caps.linux.missingTools.join(', ')}
                  </span>
                </p>
                <div className="flex items-center gap-2">
                  <pre className="flex-1 text-[11px] font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 overflow-x-auto text-slate-800 dark:text-slate-200">
                    {caps.linux.installCommand}
                  </pre>
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(caps.linux.installCommand);
                      setCopiedCmd(true);
                      setTimeout(() => setCopiedCmd(false), 1800);
                    }}
                    className="px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 shrink-0"
                    title="Copier la commande"
                  >
                    {copiedCmd ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
                {caps.linux.hasPkexec && (
                  <button
                    type="button"
                    disabled={Boolean(linuxBusy)}
                    onClick={handleInstallLinuxDeps}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A65C7] hover:bg-[#1557B0] disabled:opacity-50 text-white text-xs font-medium"
                  >
                    <Terminal size={13} />
                    {linuxBusy || 'Installer les dépendances (pkexec)'}
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2.5">
                {!caps.linux.mounted ? (
                  <button
                    type="button"
                    disabled={Boolean(linuxBusy)}
                    onClick={handleLinuxMount}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#1A65C7] hover:bg-[#1557B0] disabled:opacity-50 text-white text-xs font-medium"
                  >
                    <HardDrive size={14} />
                    {linuxBusy || 'Monter l’iPhone dans ~/iPhone-USB'}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => desktopBridge.openInExplorer(caps.linux.mountPoint)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0F7659] hover:bg-[#0B5F47] text-white text-xs font-medium"
                    >
                      <FolderOpen size={14} />
                      Ouvrir ~/iPhone-USB
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(linuxBusy)}
                      onClick={handleLinuxUnmount}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <Unplug size={13} />
                      {linuxBusy || 'Démonter proprement'}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Collapsible Local Diagnostic Log */}
        {logsOpen && logsData && (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-mono text-slate-500 dark:text-slate-400 truncate">
                {logsData.logFilePath}
              </span>
              <button
                type="button"
                onClick={async () => {
                  if (desktopBridge) setLogsData(await desktopBridge.getLogs());
                }}
                className="text-[#1A65C7] dark:text-blue-400 hover:underline shrink-0"
              >
                Rafraîchir
              </button>
            </div>
            <div className="max-h-48 overflow-y-auto rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800 p-3 font-mono text-[11px] space-y-1">
              {logsData.entries.length === 0 ? (
                <div className="text-slate-400">Aucune entrée enregistrée.</div>
              ) : (
                logsData.entries
                  .slice()
                  .reverse()
                  .map((entry, idx) => (
                    <div
                      key={`${entry.timestamp}-${idx}`}
                      className={
                        entry.level === 'error'
                          ? 'text-red-600 dark:text-red-400'
                          : entry.level === 'warn'
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-slate-600 dark:text-slate-400'
                      }
                    >
                      [{entry.timestamp.slice(11, 19)}] [{entry.scope}] {entry.message}
                      {entry.detail ? ` — ${entry.detail}` : ''}
                    </div>
                  ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
