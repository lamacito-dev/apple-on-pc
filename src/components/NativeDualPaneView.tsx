import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  File as FileIcon,
  FileArchive,
  Film,
  Folder,
  Image as ImageIcon,
  RefreshCw,
} from 'lucide-react';
import {
  getDesktopBridge,
  type DesktopFsEntry,
  type DesktopIphoneDevice,
} from '../lib/desktopBridge';
import { formatBytes } from '../lib/fsUtils';

interface NativeDualPaneViewProps {
  device: DesktopIphoneDevice;
  pcDir: string;
  searchQuery: string;
  onChangePcDir: () => Promise<void>;
  onToast: (text: string, type?: 'info' | 'success' | 'error') => void;
}

function getFileIcon(name: string) {
  const lower = name.toLowerCase();
  if (/\.(jpg|jpeg|png|heic|heif|webp|gif|dng|raw)$/.test(lower)) {
    return <ImageIcon size={20} className="text-[#1A65C7] dark:text-blue-400 shrink-0" />;
  }
  if (/\.(mov|mp4|m4v|avi|mkv)$/.test(lower)) {
    return <Film size={20} className="text-indigo-500 dark:text-indigo-400 shrink-0" />;
  }
  if (/\.(zip|rar|7z|tar|gz)$/.test(lower)) {
    return <FileArchive size={20} className="text-[#1A65C7] dark:text-blue-400 shrink-0" />;
  }
  return <FileIcon size={19} className="text-slate-400 dark:text-slate-500 shrink-0" />;
}

export function NativeDualPaneView({
  device,
  pcDir,
  searchQuery,
  onChangePcDir,
  onToast,
}: NativeDualPaneViewProps) {
  const bridge = getDesktopBridge();

  const [iphonePath, setIphonePath] = useState<string>('');
  const [iphoneEntries, setIphoneEntries] = useState<DesktopFsEntry[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [iphoneLoading, setIphoneLoading] = useState(false);
  const [iphoneError, setIphoneError] = useState<string | null>(null);

  const [pcEntries, setPcEntries] = useState<DesktopFsEntry[]>([]);
  const [pcLoading, setPcLoading] = useState(false);
  const [copying, setCopying] = useState(false);

  const loadIphoneDir = useCallback(
    async (targetPath: string, autoEnterSingleRoot = false) => {
      if (!bridge) return;
      setIphoneLoading(true);
      setIphoneError(null);
      try {
        let entries = await bridge.listIphoneDirectory(device.id, targetPath);
        let resolvedPath = targetPath;

        // If at device root and there is a single storage container (e.g. "Internal Storage" / "Stockage interne"),
        // automatically open it so the user immediately sees DCIM & folders.
        if (
          autoEnterSingleRoot &&
          !targetPath &&
          entries.length === 1 &&
          entries[0].kind === 'folder'
        ) {
          resolvedPath = entries[0].path;
          entries = await bridge.listIphoneDirectory(device.id, resolvedPath);
        }

        entries.sort((a, b) => {
          if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
          return a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' });
        });

        setIphonePath(resolvedPath);
        setIphoneEntries(entries);
        setSelectedPaths([]);
      } catch (err) {
        setIphoneError(
          err instanceof Error ? err.message : 'Impossible de lire ce dossier sur l’iPhone.'
        );
      } finally {
        setIphoneLoading(false);
      }
    },
    [bridge, device.id]
  );

  const loadPcDir = useCallback(async () => {
    if (!bridge) return;
    setPcLoading(true);
    try {
      const entries = await bridge.listPcDirectory(pcDir || undefined);
      setPcEntries(entries);
    } catch {
      setPcEntries([]);
    } finally {
      setPcLoading(false);
    }
  }, [bridge, pcDir]);

  useEffect(() => {
    loadIphoneDir('', true);
  }, [loadIphoneDir]);

  useEffect(() => {
    loadPcDir();
  }, [loadPcDir]);

  const handleGoUp = () => {
    if (!iphonePath) return;
    const parts = iphonePath.split('/').filter(Boolean);
    parts.pop();
    loadIphoneDir(parts.join('/'));
  };

  const toggleSelect = (entryPath: string, multi: boolean) => {
    setSelectedPaths((prev) => {
      if (multi) {
        return prev.includes(entryPath)
          ? prev.filter((p) => p !== entryPath)
          : [...prev, entryPath];
      }
      return prev.length === 1 && prev[0] === entryPath ? [] : [entryPath];
    });
  };

  const handleCopySelectedToPc = async () => {
    if (!bridge || copying) return;
    const targets =
      selectedPaths.length > 0
        ? iphoneEntries.filter((e) => selectedPaths.includes(e.path))
        : iphoneEntries.filter((e) => e.kind === 'file');

    if (targets.length === 0) {
      onToast('Sélectionnez un fichier ou un dossier iPhone à copier vers votre PC.', 'info');
      return;
    }

    setCopying(true);
    let copiedCount = 0;
    try {
      for (const item of targets) {
        await bridge.copyFromIphoneToPc(device.id, item.path, pcDir || undefined);
        copiedCount += 1;
      }
      await loadPcDir();
      onToast(
        copiedCount === 1
          ? `« ${targets[0].name} » copié sur votre PC.`
          : `${copiedCount} éléments copiés sur votre PC.`,
        'success'
      );
    } catch (err) {
      onToast(
        err instanceof Error ? err.message : 'Erreur lors de la copie vers le PC.',
        'error'
      );
    } finally {
      setCopying(false);
    }
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visibleIphoneEntries = normalizedQuery
    ? iphoneEntries.filter((e) => e.name.toLowerCase().includes(normalizedQuery))
    : iphoneEntries;

  const pcFolderShort =
    pcDir.split(/[\\/]/).filter(Boolean).pop() || 'OpenFS-iPhone-Sync';

  return (
    <div className="flex-1 flex flex-col lg:flex-row min-w-0 h-full overflow-hidden">
      {/* Left Pane: Real iPhone WPD */}
      <section className="flex-1 flex flex-col min-w-0 h-full lg:border-r border-slate-200/80 dark:border-slate-800/80">
        <div className="px-6 pt-5 pb-3.5 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {iphonePath && (
              <button
                type="button"
                disabled={iphoneLoading}
                onClick={handleGoUp}
                title="Dossier parent"
                className="p-1.5 -ml-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <ArrowLeft size={15} />
              </button>
            )}
            <h2 className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-slate-100 truncate">
              {device.name}
              {iphonePath ? ` · /${iphonePath}` : ''}
            </h2>
          </div>

          <button
            type="button"
            disabled={iphoneLoading}
            onClick={() => loadIphoneDir(iphonePath)}
            title="Actualiser"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100 dark:hover:text-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
          >
            <RefreshCw size={14} className={iphoneLoading ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {iphoneError ? (
            <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50/60 dark:bg-red-950/20 p-5 text-sm text-red-700 dark:text-red-300 space-y-2">
              <p>{iphoneError}</p>
              <button
                type="button"
                onClick={() => loadIphoneDir(iphonePath)}
                className="text-xs font-medium underline"
              >
                Réessayer
              </button>
            </div>
          ) : iphoneLoading && visibleIphoneEntries.length === 0 ? (
            <div className="space-y-2.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="h-[68px] rounded-xl bg-slate-100/80 dark:bg-slate-900 animate-pulse"
                />
              ))}
            </div>
          ) : visibleIphoneEntries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-10 text-center text-sm text-slate-500 dark:text-slate-400">
              Ce dossier iPhone est vide.
            </div>
          ) : (
            <div className="space-y-2.5">
              {visibleIphoneEntries.map((entry) => {
                const isSelected = selectedPaths.includes(entry.path);
                return (
                  <div
                    key={entry.path}
                    onClick={(e) => toggleSelect(entry.path, e.ctrlKey || e.metaKey)}
                    onDoubleClick={() => {
                      if (entry.kind === 'folder') {
                        loadIphoneDir(entry.path);
                      }
                    }}
                    className={`group flex items-center gap-3.5 px-4 py-3.5 rounded-xl border cursor-pointer select-none transition-all ${
                      isSelected
                        ? 'border-[#1A65C7] bg-blue-50/45 dark:bg-blue-950/25'
                        : 'border-slate-200/85 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-lg bg-slate-50 dark:bg-slate-800/70 flex items-center justify-center shrink-0">
                      {entry.kind === 'folder' ? (
                        <Folder
                          size={22}
                          className="text-[#1A65C7] fill-[#1A65C7]/90 dark:text-blue-400 dark:fill-blue-400/80"
                        />
                      ) : (
                        getFileIcon(entry.name)
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-medium text-slate-900 dark:text-slate-100 truncate">
                        {entry.name}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                        {entry.kind === 'folder'
                          ? 'Dossier iPhone · double-cliquez pour ouvrir'
                          : entry.size > 0
                            ? formatBytes(entry.size)
                            : 'Fichier iPhone'}
                      </div>
                    </div>

                    {entry.kind === 'folder' && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          loadIphoneDir(entry.path);
                        }}
                        className="opacity-0 group-hover:opacity-100 px-2.5 py-1 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all shrink-0"
                      >
                        Ouvrir
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Right Pane: Real Windows PC Folder */}
      <section className="flex-1 flex flex-col min-w-0 h-full">
        <div className="px-6 pt-5 pb-3.5 flex items-center justify-between gap-2 shrink-0">
          <h2 className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-slate-100 truncate">
            PC · {pcFolderShort}
          </h2>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onChangePcDir}
              className="text-xs font-medium text-[#1A65C7] dark:text-blue-400 hover:underline"
            >
              Changer
            </button>
            {bridge && pcDir && (
              <button
                type="button"
                onClick={() => bridge.openInExplorer(pcDir)}
                className="text-xs font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              >
                Explorateur
              </button>
            )}
          </div>
        </div>

        <div className="px-6 pb-3.5 shrink-0">
          <button
            type="button"
            disabled={copying || iphoneLoading}
            onClick={handleCopySelectedToPc}
            className="w-full py-2.5 px-4 rounded-xl bg-[#1A65C7] hover:bg-[#1557B0] disabled:opacity-60 text-white text-sm font-medium transition-colors inline-flex items-center justify-center gap-2"
          >
            {copying && <RefreshCw size={14} className="animate-spin" />}
            {copying
              ? 'Copie en cours vers le PC...'
              : selectedPaths.length > 0
                ? `Copier vers PC (${selectedPaths.length})`
                : 'Copier vers PC'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {pcLoading && pcEntries.length === 0 ? (
            <div className="space-y-2.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-[64px] rounded-xl bg-slate-100/80 dark:bg-slate-900 animate-pulse"
                />
              ))}
            </div>
          ) : pcEntries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-10 text-center text-sm text-slate-500 dark:text-slate-400">
              Dossier PC vide. Sélectionnez des fichiers iPhone à gauche et cliquez sur « Copier vers PC ».
            </div>
          ) : (
            <div className="space-y-2.5">
              {pcEntries.map((entry) => (
                <div
                  key={entry.path}
                  onDoubleClick={() => bridge?.openInExplorer(entry.path)}
                  className="flex items-center gap-3.5 px-4 py-3.5 rounded-xl border border-slate-200/85 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 cursor-pointer transition-colors"
                >
                  <div className="w-10 h-10 rounded-lg bg-slate-50 dark:bg-slate-800/70 flex items-center justify-center shrink-0">
                    {entry.kind === 'folder' ? (
                      <Folder
                        size={22}
                        className="text-[#1A65C7] fill-[#1A65C7]/90 dark:text-blue-400 dark:fill-blue-400/80"
                      />
                    ) : (
                      getFileIcon(entry.name)
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-medium text-slate-900 dark:text-slate-100 truncate">
                      {entry.name}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                      {entry.kind === 'folder' ? 'Dossier PC' : formatBytes(entry.size)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
