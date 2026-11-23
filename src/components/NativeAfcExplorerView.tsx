import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  AppWindow,
  ArrowLeft,
  ArrowRight,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  File as FileIcon,
  Folder,
  FolderPlus,
  HardDrive,
  Info,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  getDesktopBridge,
  type DesktopAfcCapabilities,
  type DesktopFsEntry,
  type DesktopIphoneDevice,
  type DesktopSharedApp,
} from '../lib/desktopBridge';
import { formatBytes } from '../lib/fsUtils';
import { InputDialog } from './Dialogs';
import { NativePreviewView } from './NativePreviewView';

interface NativeAfcExplorerViewProps {
  initialMode: 'storage' | 'apps';
  device: DesktopIphoneDevice | null;
  pcDir: string;
  searchQuery: string;
  onChangePcDir: () => Promise<void>;
  onFallbackToPhotos: () => void;
  onOpenUsbBridge: () => void;
  onRefreshDevices: () => Promise<void>;
  onToast: (text: string, type?: 'info' | 'success' | 'error') => void;
}

export function NativeAfcExplorerView({
  initialMode,
  device,
  pcDir,
  searchQuery,
  onChangePcDir,
  onFallbackToPhotos,
  onOpenUsbBridge,
  onRefreshDevices,
  onToast,
}: NativeAfcExplorerViewProps) {
  const bridge = getDesktopBridge();

  const [mode, setMode] = useState<'storage' | 'apps'>(initialMode);
  const [caps, setCaps] = useState<DesktopAfcCapabilities | null>(null);
  const [showHidden, setShowHidden] = useState(true);

  // iPhone AFC left pane state
  const [remotePath, setRemotePath] = useState('/');
  const [afcEntries, setAfcEntries] = useState<DesktopFsEntry[]>([]);
  const [afcLoading, setAfcLoading] = useState(false);
  const [afcError, setAfcError] = useState<string | null>(null);

  // App Documents state
  const [apps, setApps] = useState<DesktopSharedApp[]>([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [selectedApp, setSelectedApp] = useState<DesktopSharedApp | null>(null);
  const [showAllApps, setShowAllApps] = useState(false);

  // PC right pane state (for bidirectional drag & drop / transfers)
  const [pcCurrentDir, setPcCurrentDir] = useState(pcDir);
  const [pcEntries, setPcEntries] = useState<DesktopFsEntry[]>([]);
  const [pcLoading, setPcLoading] = useState(false);
  const [dropActive, setDropActive] = useState(false);

  // Action busy + dialogs
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<DesktopFsEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DesktopFsEntry | null>(null);
  const [previewEntry, setPreviewEntry] = useState<DesktopFsEntry | null>(null);

  useEffect(() => {
    setMode(initialMode);
    if (initialMode === 'storage') {
      setSelectedApp(null);
      setRemotePath('/');
    }
  }, [initialMode]);

  useEffect(() => {
    setPcCurrentDir(pcDir);
  }, [pcDir]);

  const afcUdid = device?.afcUdid || (device?.backend === 'afc' ? device.serialNumber : '');
  const afcPaired = Boolean(device?.afcPaired || (device?.backend === 'afc' && device?.accessible));

  const loadCapabilities = useCallback(async () => {
    if (!bridge) return;
    try {
      const c = await bridge.getAfcCapabilities();
      setCaps(c);
    } catch (err) {
      console.warn('[OpenFS] Erreur capacités AFC:', err);
    }
  }, [bridge]);

  useEffect(() => {
    loadCapabilities();
  }, [loadCapabilities]);

  const loadPcDir = useCallback(
    async (dir: string) => {
      if (!bridge || !dir) return;
      setPcLoading(true);
      try {
        const list = await bridge.listPcDirectory(dir);
        setPcEntries(list);
      } catch (err) {
        onToast(err instanceof Error ? err.message : 'Erreur lecture dossier PC.', 'error');
      } finally {
        setPcLoading(false);
      }
    },
    [bridge, onToast]
  );

  useEffect(() => {
    if (pcCurrentDir) loadPcDir(pcCurrentDir);
  }, [pcCurrentDir, loadPcDir]);

  const loadAfcDir = useCallback(
    async (targetRemote: string, appId?: string) => {
      if (!bridge || !afcUdid || !afcPaired) return;
      setAfcLoading(true);
      setAfcError(null);
      try {
        const list = await bridge.afcListDirectory(afcUdid, targetRemote, {
          appId,
          showHidden,
        });
        setRemotePath(targetRemote);
        setAfcEntries(list);
      } catch (err) {
        setAfcError(
          err instanceof Error ? err.message : 'Impossible de lire ce dossier via AFC.'
        );
      } finally {
        setAfcLoading(false);
      }
    },
    [bridge, afcUdid, afcPaired, showHidden]
  );

  const loadApps = useCallback(async () => {
    if (!bridge || !afcUdid || !afcPaired) return;
    setAppsLoading(true);
    setAfcError(null);
    try {
      const list = await bridge.afcListApps(afcUdid);
      setApps(list);
    } catch (err) {
      setAfcError(
        err instanceof Error ? err.message : 'Impossible de lister les applications iPhone.'
      );
    } finally {
      setAppsLoading(false);
    }
  }, [bridge, afcUdid, afcPaired]);

  useEffect(() => {
    if (!afcUdid || !afcPaired) return;
    if (mode === 'storage') {
      loadAfcDir(remotePath, undefined);
    } else if (selectedApp) {
      loadAfcDir(remotePath, selectedApp.bundleId);
    } else {
      loadApps();
    }
  }, [mode, afcUdid, afcPaired, selectedApp, showHidden, loadAfcDir, loadApps, remotePath]);

  const handlePair = async () => {
    if (!bridge) return;
    setBusyAction('Appairage...');
    try {
      const res = await bridge.pairIphone(afcUdid || undefined);
      onToast(res.message, res.paired ? 'success' : 'info');
      await onRefreshDevices();
      await loadCapabilities();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Échec de l’appairage.', 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDownloadToPc = async (entry: DesktopFsEntry) => {
    if (!bridge || !afcUdid || entry.kind === 'folder') return;
    setBusyAction(`Copie ${entry.name}...`);
    try {
      const res = await bridge.afcDownloadFile(afcUdid, entry.path, pcCurrentDir || undefined, {
        appId: selectedApp?.bundleId,
      });
      onToast(
        res.verified
          ? `« ${entry.name} » copié sur le PC — SHA-256 vérifié ✓`
          : `« ${entry.name} » copié (SHA-256 à vérifier)`,
        res.verified ? 'success' : 'info'
      );
      if (pcCurrentDir) await loadPcDir(pcCurrentDir);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erreur copie iPhone → PC.', 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const handleUploadLocalFiles = async (localPaths: string[]) => {
    if (!bridge || !afcUdid || localPaths.length === 0) return;
    setBusyAction(`Envoi vers iPhone (${localPaths.length})...`);
    let okCount = 0;
    let verifiedCount = 0;
    try {
      for (const localPath of localPaths) {
        const res = await bridge.afcUploadFile(afcUdid, localPath, remotePath, {
          appId: selectedApp?.bundleId,
        });
        okCount += 1;
        if (res.verified) verifiedCount += 1;
      }
      onToast(
        verifiedCount === okCount
          ? `${okCount} fichier(s) envoyé(s) sur l’iPhone — SHA-256 vérifié ✓`
          : `${okCount} fichier(s) envoyé(s) (${verifiedCount} vérifié(s) SHA-256).`,
        verifiedCount === okCount ? 'success' : 'info'
      );
      await loadAfcDir(remotePath, selectedApp?.bundleId);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erreur envoi PC → iPhone.', 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const handlePickAndUpload = async () => {
    if (!bridge) return;
    const files = await bridge.pickPcFiles();
    if (files.length > 0) {
      await handleUploadLocalFiles(files);
    }
  };

  const handleCreateRemoteFolder = async (folderName: string) => {
    if (!bridge || !afcUdid) return;
    setBusyAction('Création du dossier...');
    try {
      await bridge.afcMkdir(afcUdid, remotePath, folderName, {
        appId: selectedApp?.bundleId,
      });
      setMkdirOpen(false);
      onToast(`Dossier « ${folderName} » créé sur l’iPhone.`, 'success');
      await loadAfcDir(remotePath, selectedApp?.bundleId);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erreur création dossier.', 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const handleRenameRemote = async (newName: string) => {
    if (!bridge || !afcUdid || !renameTarget) return;
    setBusyAction('Renommage...');
    try {
      await bridge.afcRename(afcUdid, renameTarget.path, newName, {
        appId: selectedApp?.bundleId,
      });
      setRenameTarget(null);
      onToast(`Renommé en « ${newName} » sur l’iPhone.`, 'success');
      await loadAfcDir(remotePath, selectedApp?.bundleId);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erreur renommage.', 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteRemote = async () => {
    if (!bridge || !afcUdid || !deleteTarget) return;
    setBusyAction('Suppression...');
    try {
      await bridge.afcDelete(afcUdid, deleteTarget.path, {
        appId: selectedApp?.bundleId,
        recursive: deleteTarget.kind === 'folder',
      });
      const deletedName = deleteTarget.name;
      setDeleteTarget(null);
      onToast(`« ${deletedName} » supprimé de l’iPhone.`, 'info');
      await loadAfcDir(remotePath, selectedApp?.bundleId);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Erreur suppression sur l’iPhone.', 'error');
    } finally {
      setBusyAction(null);
    }
  };

  const filteredAfcEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return afcEntries;
    return afcEntries.filter((e) => e.name.toLowerCase().includes(q));
  }, [afcEntries, searchQuery]);

  const visibleApps = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return apps.filter((a) => {
      if (!showAllApps && !a.fileSharingEnabled) return false;
      if (q && !a.name.toLowerCase().includes(q) && !a.bundleId.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [apps, showAllApps, searchQuery]);

  const isInDcim = mode === 'storage' && /^\/DCIM(\/|$)/i.test(remotePath);

  const handleDropOnIphonePane = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDropActive(false);
    const pcPathPayload = e.dataTransfer.getData('application/x-openfs-pc-path');
    if (pcPathPayload) {
      await handleUploadLocalFiles([pcPathPayload]);
      return;
    }
    const droppedFiles = Array.from(e.dataTransfer.files || [])
      .map((f) => (f as File & { path?: string }).path)
      .filter((p): p is string => Boolean(p));
    if (droppedFiles.length > 0) {
      await handleUploadLocalFiles(droppedFiles);
    }
  };

  // Inline Preview & In-Place Editor for AFC files
  if (previewEntry && afcUdid) {
    return (
      <NativePreviewView
        source="iphone"
        afcUdid={afcUdid}
        afcAppId={selectedApp?.bundleId}
        deviceLabel={device?.name || 'iPhone'}
        entry={previewEntry}
        siblings={filteredAfcEntries}
        onSelectSibling={(next) => setPreviewEntry(next)}
        onClose={() => setPreviewEntry(null)}
        onExportToPc={handleDownloadToPc}
        onSaved={() => loadAfcDir(remotePath, selectedApp?.bundleId)}
        onToast={onToast}
      />
    );
  }

  // Graceful WPD Fallback Screen when AFC is not ready yet
  if (!afcUdid || !afcPaired) {
    const isWin = caps?.platform === 'win32';
    const isLinux = caps?.platform === 'linux';
    const amdsMissing = isWin && caps && (!caps.amds.installed || !caps.amds.running);
    const binsMissing = caps && !caps.hasCoreAfc;

    return (
      <div className="flex-1 overflow-y-auto px-6 sm:px-10 py-10">
        <div className="max-w-2xl mx-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-7 space-y-5">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <AlertTriangle size={20} />
            </div>
            <div className="space-y-1">
              <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Accès complet iPhone (AFC) non activé
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                Windows WPD ne donne accès qu’aux photos en lecture seule. Pour parcourir les
                fichiers cachés (.), les documents d’apps, éditer des fichiers .plist/.txt sur place
                et transférer du PC vers l’iPhone, OpenFS utilise le protocole AFC (libimobiledevice).
              </p>
            </div>
          </div>

          {amdsMissing && (
            <div className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/60 dark:bg-blue-950/30 p-4 space-y-3">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Prérequis Windows : Apple Mobile Device Service absent
              </div>
              <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                Installez gratuitement l’application officielle{' '}
                <strong>Appareils Apple (Apple Devices)</strong> sur le Microsoft Store — pas besoin
                d’installer iTunes. Une fois installée, rebranchez votre iPhone.
              </p>
              <button
                type="button"
                onClick={() => bridge?.openAppleDevicesStore()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1A65C7] hover:bg-[#1557B0] text-white text-xs font-medium transition-colors"
              >
                <ExternalLink size={13} />
                Installer Appareils Apple (Microsoft Store)
              </button>
            </div>
          )}

          {afcUdid && !afcPaired && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-950/30 p-4 space-y-3">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                iPhone détecté via AFC — Appairage requis
              </div>
              <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                Déverrouillez votre iPhone et touchez <strong>« Se fier à cet ordinateur »</strong>,
                puis cliquez sur le bouton ci-dessous.
              </p>
              <button
                type="button"
                disabled={Boolean(busyAction)}
                onClick={handlePair}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0F7659] hover:bg-[#0B5F47] text-white text-xs font-medium transition-colors"
              >
                <ShieldCheck size={14} />
                {busyAction || 'Appairer l’iPhone (Se fier)'}
              </button>
            </div>
          )}

          {isLinux && caps && caps.linux.missingTools.length > 0 && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4 space-y-2.5">
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Dépendances Linux manquantes ({caps.linux.distro.prettyName}) :{' '}
                <span className="font-mono">{caps.linux.missingTools.join(', ')}</span>
              </div>
              <pre className="text-[11px] font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 overflow-x-auto text-slate-800 dark:text-slate-200">
                {caps.linux.installCommand}
              </pre>
              <button
                type="button"
                onClick={onOpenUsbBridge}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1A65C7] hover:bg-[#1557B0] text-white text-xs font-medium"
              >
                Ouvrir l’assistant Linux (pkexec + montage)
              </button>
            </div>
          )}

          {binsMissing && isWin && (
            <div className="text-xs text-slate-600 dark:text-slate-400">
              Les binaires embarqués libimobiledevice (<span className="font-mono">afcclient.exe</span>)
              sont inclus dans l’installeur officiel Windows généré par GitHub Actions.
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onFallbackToPhotos}
              className="px-4 py-2 rounded-lg bg-[#1A65C7] hover:bg-[#1557B0] text-white text-xs font-medium transition-colors"
            >
              Continuer en mode Photos (WPD lecture seule)
            </button>
            <button
              type="button"
              onClick={async () => {
                await onRefreshDevices();
                await loadCapabilities();
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <RefreshCw size={13} />
              Vérifier à nouveau
            </button>
          </div>
        </div>
      </div>
    );
  }

  const showingAppList = mode === 'apps' && !selectedApp;

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 h-full overflow-hidden">
      {/* Top AFC Toolbar */}
      <div className="px-6 py-3.5 border-b border-slate-200/75 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <div className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800/90">
            <button
              type="button"
              onClick={() => {
                setMode('storage');
                setSelectedApp(null);
                setRemotePath('/');
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                mode === 'storage'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <Smartphone size={13} />
              Stockage iPhone (AFC)
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('apps');
                setSelectedApp(null);
                setRemotePath('/');
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                mode === 'apps'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <AppWindow size={13} />
              Documents d’apps
            </button>
          </div>

          <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
            {device?.name || 'iPhone'} · AFC bidirectionnel
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!showingAppList && (
            <>
              <button
                type="button"
                onClick={() => setShowHidden((h) => !h)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                  showHidden
                    ? 'border-[#1A65C7]/40 bg-blue-50/70 dark:bg-blue-950/35 text-[#1A65C7] dark:text-blue-400'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400'
                }`}
              >
                {showHidden ? <Eye size={13} /> : <EyeOff size={13} />}
                Fichiers cachés
              </button>

              <button
                type="button"
                disabled={Boolean(busyAction)}
                onClick={() => setMkdirOpen(true)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <FolderPlus size={13} />
                Nouveau dossier
              </button>

              <button
                type="button"
                disabled={Boolean(busyAction)}
                onClick={handlePickAndUpload}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-[#1A65C7] hover:bg-[#1557B0] disabled:opacity-50 text-white transition-colors"
              >
                <Upload size={13} />
                {busyAction || 'Envoyer PC → iPhone'}
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() =>
              showingAppList ? loadApps() : loadAfcDir(remotePath, selectedApp?.bundleId)
            }
            title="Actualiser"
            className="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center"
          >
            <RefreshCw size={13} className={afcLoading || appsLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Honest Apple iOS DCIM Notice */}
      {isInDcim && (
        <div className="px-6 py-2.5 border-b border-amber-200/80 dark:border-amber-900/50 bg-amber-50/75 dark:bg-amber-950/25 flex items-center gap-2.5 text-xs text-amber-900 dark:text-amber-200 shrink-0">
          <Info size={14} className="shrink-0 text-amber-600 dark:text-amber-400" />
          <span>
            Note iOS : une photo copiée manuellement dans <code className="font-mono">/DCIM</code>{' '}
            est bien écrite sur le stockage, mais n’apparaîtra pas dans l’application Photos d’Apple.
            Pour transférer des fichiers vers votre iPhone, privilégiez l’onglet « Documents d’apps »
            (VLC, Documents, etc.).
          </span>
        </div>
      )}

      {/* Dual-Pane Workspace: Left = iPhone (AFC), Right = PC */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 overflow-hidden">
        {/* Left Pane: iPhone AFC / App Documents */}
        <div
          onDragOver={(e) => {
            if (showingAppList) return;
            e.preventDefault();
            setDropActive(true);
          }}
          onDragLeave={() => setDropActive(false)}
          onDrop={handleDropOnIphonePane}
          className={`lg:col-span-7 flex flex-col min-h-0 border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-slate-800 transition-colors ${
            dropActive ? 'bg-blue-50/60 dark:bg-blue-950/25' : ''
          }`}
        >
          {/* Breadcrumb / Context Strip */}
          <div className="px-5 py-2.5 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-2 text-xs shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              {selectedApp && (
                <button
                  type="button"
                  onClick={() => {
                    if (remotePath !== '/') {
                      const parts = remotePath.split('/').filter(Boolean);
                      parts.pop();
                      setRemotePath(parts.length ? '/' + parts.join('/') : '/');
                    } else {
                      setSelectedApp(null);
                    }
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <ArrowLeft size={12} />
                  {remotePath !== '/' ? 'Parent' : 'Apps'}
                </button>
              )}
              {mode === 'storage' && remotePath !== '/' && (
                <button
                  type="button"
                  onClick={() => {
                    const parts = remotePath.split('/').filter(Boolean);
                    parts.pop();
                    setRemotePath(parts.length ? '/' + parts.join('/') : '/');
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <ArrowLeft size={12} />
                  Parent
                </button>
              )}

              <span className="font-mono text-slate-700 dark:text-slate-300 truncate">
                {showingAppList
                  ? 'Applications partageant leurs Documents'
                  : selectedApp
                    ? `${selectedApp.name} /Documents${remotePath === '/' ? '' : remotePath}`
                    : `iPhone:${remotePath}`}
              </span>
            </div>

            {showingAppList && (
              <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={showAllApps}
                  onChange={(e) => setShowAllApps(e.target.checked)}
                  className="rounded border-slate-300"
                />
                Toutes les apps ({apps.length})
              </label>
            )}
          </div>

          {/* Left Pane Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {afcError && (
              <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50/70 dark:bg-red-950/30 p-3.5 text-xs text-red-700 dark:text-red-300">
                {afcError}
              </div>
            )}

            {showingAppList ? (
              appsLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-14 rounded-xl bg-slate-100 dark:bg-slate-900 animate-pulse"
                    />
                  ))}
                </div>
              ) : visibleApps.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 p-8 text-center space-y-2">
                  <AppWindow size={26} className="mx-auto text-slate-400" />
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Aucune application avec partage de fichiers détectée
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Installez une app compatible Partage de fichiers iTunes/USB (ex. VLC, Documents,
                    Pages) ou cochez « Toutes les apps ».
                  </p>
                </div>
              ) : (
                visibleApps.map((app) => (
                  <button
                    key={app.bundleId}
                    type="button"
                    onClick={() => {
                      setSelectedApp(app);
                      setRemotePath('/');
                    }}
                    className="w-full text-left rounded-xl border border-slate-200/85 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-[#1A65C7]/60 px-4 py-3 flex items-center justify-between gap-3 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <AppWindow size={18} className="text-[#1A65C7] dark:text-blue-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                          {app.name}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                          {app.bundleId}
                          {app.version ? ` · v${app.version}` : ''}
                        </div>
                      </div>
                    </div>
                    <span className="text-xs font-medium text-[#1A65C7] dark:text-blue-400 shrink-0">
                      Ouvrir /Documents →
                    </span>
                  </button>
                ))
              )
            ) : afcLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-12 rounded-xl bg-slate-100 dark:bg-slate-900 animate-pulse"
                  />
                ))}
              </div>
            ) : filteredAfcEntries.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 p-8 text-center space-y-2">
                <Folder size={26} className="mx-auto text-slate-400" />
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Dossier vide
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Glissez des fichiers depuis le panneau PC à droite ou cliquez sur « Envoyer PC →
                  iPhone ».
                </p>
              </div>
            ) : (
              filteredAfcEntries.map((entry) => (
                <div
                  key={entry.path}
                  onClick={() => {
                    if (entry.kind === 'folder') {
                      setRemotePath(entry.path);
                    } else {
                      setPreviewEntry(entry);
                    }
                  }}
                  className="group rounded-xl border border-slate-200/85 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 px-3.5 py-2.5 flex items-center justify-between gap-3 cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {entry.kind === 'folder' ? (
                      <Folder
                        size={18}
                        className={`shrink-0 ${
                          entry.hidden
                            ? 'text-slate-400 fill-slate-400/30'
                            : 'text-[#1A65C7] fill-[#1A65C7]/85 dark:text-blue-400'
                        }`}
                      />
                    ) : (
                      <FileIcon
                        size={17}
                        className={entry.hidden ? 'text-slate-400 shrink-0' : 'text-slate-500 shrink-0'}
                      />
                    )}
                    <div className="min-w-0">
                      <div
                        className={`text-sm font-medium truncate ${
                          entry.hidden
                            ? 'text-slate-500 dark:text-slate-400 italic'
                            : 'text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {entry.name}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                        {entry.kind === 'folder' ? 'Dossier' : formatBytes(entry.size)}
                        {entry.permissions ? ` · ${entry.permissions}` : ''}
                        {entry.hidden ? ' · caché' : ''}
                      </div>
                    </div>
                  </div>

                  <div
                    className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {entry.kind === 'file' && (
                      <button
                        type="button"
                        title="Copier vers PC"
                        onClick={() => handleDownloadToPc(entry)}
                        className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-[#1A65C7]"
                      >
                        <Download size={14} />
                      </button>
                    )}
                    <button
                      type="button"
                      title="Renommer"
                      onClick={() => setRenameTarget(entry)}
                      className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      title="Supprimer de l’iPhone"
                      onClick={() => setDeleteTarget(entry)}
                      className="p-1.5 rounded-lg text-slate-500 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Pane: Local PC Folder for Drag-and-Drop / 1-Click PC -> iPhone */}
        <div className="lg:col-span-5 flex flex-col min-h-0 bg-slate-50/45 dark:bg-slate-950/35">
          <div className="px-4 py-2.5 border-b border-slate-200/75 dark:border-slate-800 flex items-center justify-between gap-2 text-xs shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <HardDrive size={14} className="text-[#1A65C7] dark:text-blue-400 shrink-0" />
              <span className="font-mono text-slate-700 dark:text-slate-300 truncate">
                {pcCurrentDir || 'Dossier PC'}
              </span>
            </div>
            <button
              type="button"
              onClick={onChangePcDir}
              className="text-[#1A65C7] dark:text-blue-400 font-medium hover:underline shrink-0"
            >
              Changer
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
            {pcLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-11 rounded-xl bg-slate-200/60 dark:bg-slate-900 animate-pulse"
                  />
                ))}
              </div>
            ) : pcEntries.length === 0 ? (
              <div className="text-center py-10 text-xs text-slate-500 dark:text-slate-400">
                Dossier PC vide.
              </div>
            ) : (
              pcEntries.map((pcItem) => (
                <div
                  key={pcItem.path}
                  draggable={pcItem.kind === 'file' && !showingAppList}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/x-openfs-pc-path', pcItem.path);
                  }}
                  onClick={() => {
                    if (pcItem.kind === 'folder') {
                      setPcCurrentDir(pcItem.path);
                    }
                  }}
                  className="group rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 flex items-center justify-between gap-2 cursor-pointer hover:border-slate-300 dark:hover:border-slate-700"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {pcItem.kind === 'folder' ? (
                      <Folder size={16} className="text-[#1A65C7] shrink-0" />
                    ) : (
                      <FileIcon size={15} className="text-slate-400 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                        {pcItem.name}
                      </div>
                      {pcItem.kind === 'file' && (
                        <div className="text-[11px] text-slate-500 tabular-nums">
                          {formatBytes(pcItem.size)}
                        </div>
                      )}
                    </div>
                  </div>

                  {pcItem.kind === 'file' && !showingAppList && (
                    <button
                      type="button"
                      disabled={Boolean(busyAction)}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleUploadLocalFiles([pcItem.path]);
                      }}
                      title="Envoyer ce fichier sur l’iPhone"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-[#1A65C7] dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 shrink-0"
                    >
                      <ArrowRight size={11} className="rotate-180" />
                      Envoyer
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Inline Dialogs */}
      <InputDialog
        open={mkdirOpen}
        title="Nouveau dossier sur l’iPhone"
        description="Les noms commençant par un point (ex. .cache) créent un dossier caché."
        label="Nom du dossier"
        initialValue=""
        placeholder="Mon_Dossier"
        submitLabel="Créer"
        onClose={() => setMkdirOpen(false)}
        onSubmit={handleCreateRemoteFolder}
      />

      <InputDialog
        open={Boolean(renameTarget)}
        title="Renommer sur l’iPhone"
        description="Vous pouvez modifier le nom et l’extension du fichier."
        label="Nouveau nom"
        initialValue={renameTarget?.name || ''}
        submitLabel="Renommer"
        onClose={() => setRenameTarget(null)}
        onSubmit={handleRenameRemote}
      />

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-4"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Supprimer de l’iPhone ?
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Voulez-vous supprimer définitivement{' '}
              <strong className="font-mono text-slate-900 dark:text-slate-100">
                {deleteTarget.name}
              </strong>{' '}
              de votre iPhone ? Cette action est irréversible.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleDeleteRemote}
                className="px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium"
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
