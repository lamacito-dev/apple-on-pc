import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowLeft,
  Check,
  File as FileIcon,
  FileArchive,
  FileText,
  Film,
  Folder,
  FolderOpen,
  FolderPlus,
  Grid2x2,
  Image as ImageIcon,
  List,
  Pencil,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { getDesktopBridge, type DesktopFsEntry } from '../lib/desktopBridge';
import { formatBytes } from '../lib/fsUtils';
import { useExplorerSelection } from '../lib/useExplorerSelection';
import { InputDialog } from './Dialogs';
import { NativePreviewView } from './NativePreviewView';

interface NativePcBrowserViewProps {
  title: string;
  rootPath: string;
  searchQuery: string;
  allowChangeRoot?: boolean;
  onChangeRoot?: () => Promise<void>;
  onToast?: (text: string, type?: 'info' | 'success' | 'error') => void;
}

function formatShortDate(iso?: string): string {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(ts));
}

export function NativePcBrowserView({
  title,
  rootPath,
  searchQuery,
  allowChangeRoot = false,
  onChangeRoot,
  onToast,
}: NativePcBrowserViewProps) {
  const bridge = getDesktopBridge();

  const [currentPath, setCurrentPath] = useState(rootPath);
  const [entries, setEntries] = useState<DesktopFsEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useState<'list' | 'grid'>('list');
  const [previewEntry, setPreviewEntry] = useState<DesktopFsEntry | null>(null);

  // Selection & real PC disk action states
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [busyOp, setBusyOp] = useState<string | null>(null);
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<DesktopFsEntry | null>(null);
  const [trashTargets, setTrashTargets] = useState<DesktopFsEntry[] | null>(null);

  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const requestedThumbsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setCurrentPath(rootPath);
    setPreviewEntry(null);
    setSelectedPaths([]);
  }, [rootPath]);

  const loadDirectory = useCallback(
    async (targetDir: string) => {
      if (!bridge || !targetDir) return;
      setLoading(true);
      setError(null);
      try {
        const list = await bridge.listPcDirectory(targetDir);
        setEntries(list);
        setSelectedPaths([]);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Impossible de lire ce dossier sur votre PC.'
        );
      } finally {
        setLoading(false);
      }
    },
    [bridge]
  );

  useEffect(() => {
    requestedThumbsRef.current.clear();
    setThumbs({});
    if (currentPath) {
      loadDirectory(currentPath);
    }
  }, [currentPath, loadDirectory]);

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.name.toLowerCase().includes(q));
  }, [entries, searchQuery]);

  const selectedEntries = useMemo(() => {
    const set = new Set(selectedPaths);
    return filteredEntries.filter((e) => set.has(e.path));
  }, [filteredEntries, selectedPaths]);

  // Explorer-style Ctrl/Shift multi-selection over the listed files and folders
  const orderedPaths = useMemo(() => filteredEntries.map((e) => e.path), [filteredEntries]);
  const explorerSelection = useExplorerSelection(orderedPaths, setSelectedPaths, !previewEntry);

  // Progressive thumbnails for images, videos, and PDFs
  useEffect(() => {
    if (!bridge) return;
    const mediaFiles = filteredEntries
      .filter(
        (e) =>
          e.kind === 'file' &&
          e.shellPath &&
          (e.mediaType === 'photo' ||
            e.mediaType === 'video' ||
            e.name.toLowerCase().endsWith('.pdf')) &&
          !requestedThumbsRef.current.has(e.path)
      )
      .slice(0, 64);

    if (mediaFiles.length === 0) return;

    let cancelled = false;
    (async () => {
      const BATCH_SIZE = 16;
      for (let i = 0; i < mediaFiles.length; i += BATCH_SIZE) {
        if (cancelled) return;
        const batch = mediaFiles.slice(i, i + BATCH_SIZE);
        batch.forEach((b) => requestedThumbsRef.current.add(b.path));
        try {
          const urls = await bridge.getThumbnailsBatch(
            batch.map((b) => ({ key: b.path, shellPath: b.shellPath! })),
            320
          );
          if (!cancelled && urls && Object.keys(urls).length > 0) {
            setThumbs((prev) => ({ ...prev, ...urls }));
          }
        } catch (err) {
          console.warn('[OpenFS] Vignettes PC partielles:', err);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bridge, filteredEntries]);

  const normalizedRoot = rootPath.replace(/[\\/]+$/, '').toLowerCase();
  const normalizedCurr = currentPath.replace(/[\\/]+$/, '').toLowerCase();
  const canGoUp = Boolean(rootPath && normalizedCurr && normalizedCurr !== normalizedRoot);

  const handleGoUp = () => {
    if (!canGoUp) return;
    const sep = currentPath.includes('\\') ? '\\' : '/';
    const parts = currentPath.split(/[\\/]/).filter(Boolean);
    if (parts.length <= 1) return;
    parts.pop();
    const next = currentPath.startsWith('/') ? '/' + parts.join('/') : parts.join(sep);
    setCurrentPath(next);
  };

  const handleCreateFolder = async (folderName: string) => {
    if (!bridge || !currentPath) return;
    setBusyOp('Création...');
    try {
      await bridge.pcCreateFolder(currentPath, folderName);
      setMkdirOpen(false);
      onToast?.(`Dossier « ${folderName} » créé sur le disque.`, 'success');
      await loadDirectory(currentPath);
    } catch (err) {
      onToast?.(err instanceof Error ? err.message : 'Erreur création dossier.', 'error');
    } finally {
      setBusyOp(null);
    }
  };

  const handleRename = async (newName: string) => {
    if (!bridge || !renameTarget) return;
    setBusyOp('Renommage...');
    try {
      await bridge.pcRenameItem(renameTarget.path, newName);
      setRenameTarget(null);
      onToast?.(`Renommé en « ${newName} » sur le disque.`, 'success');
      await loadDirectory(currentPath);
    } catch (err) {
      onToast?.(err instanceof Error ? err.message : 'Erreur lors du renommage.', 'error');
    } finally {
      setBusyOp(null);
    }
  };

  const handleConfirmTrash = async () => {
    if (!bridge || !trashTargets || trashTargets.length === 0) return;
    setBusyOp('Corbeille...');
    try {
      for (const target of trashTargets) {
        await bridge.pcTrashItem(target.path);
      }
      const count = trashTargets.length;
      setTrashTargets(null);
      onToast?.(`${count} élément(s) déplacé(s) dans la Corbeille.`, 'info');
      await loadDirectory(currentPath);
    } catch (err) {
      onToast?.(
        err instanceof Error ? err.message : 'Erreur lors de la mise à la Corbeille.',
        'error'
      );
    } finally {
      setBusyOp(null);
    }
  };

  const handleCompressSelection = async () => {
    if (!bridge || selectedEntries.length === 0) return;
    setBusyOp('Compression .zip...');
    try {
      const res = await bridge.pcCompressZip(selectedEntries.map((e) => e.path));
      onToast?.(
        `Archive « ${res.name} » créée (${res.fileCount} fichier(s), SHA-256 ${res.sha256.slice(0, 12)}…).`,
        'success'
      );
      await loadDirectory(currentPath);
    } catch (err) {
      onToast?.(err instanceof Error ? err.message : 'Erreur compression ZIP.', 'error');
    } finally {
      setBusyOp(null);
    }
  };

  const handleExtractZip = async (zipEntry: DesktopFsEntry) => {
    if (!bridge) return;
    setBusyOp(`Extraction ${zipEntry.name}...`);
    try {
      const res = await bridge.pcExtractZip(zipEntry.path);
      onToast?.(
        `« ${zipEntry.name} » extrait dans « ${res.name} » (${res.fileCount} fichier(s)).`,
        'success'
      );
      await loadDirectory(currentPath);
    } catch (err) {
      onToast?.(err instanceof Error ? err.message : 'Erreur extraction ZIP.', 'error');
    } finally {
      setBusyOp(null);
    }
  };

  const singleZipSelected =
    selectedEntries.length === 1 &&
    selectedEntries[0].kind === 'file' &&
    selectedEntries[0].name.toLowerCase().endsWith('.zip')
      ? selectedEntries[0]
      : null;

  if (previewEntry) {
    return (
      <NativePreviewView
        source="pc"
        entry={previewEntry}
        siblings={filteredEntries}
        onSelectSibling={(next) => setPreviewEntry(next)}
        onClose={() => setPreviewEntry(null)}
        onSaved={() => loadDirectory(currentPath)}
        onToast={onToast}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 h-full overflow-hidden">
      {/* Header Toolbar */}
      <div className="px-6 py-4 border-b border-slate-200/75 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          {canGoUp && (
            <button
              type="button"
              onClick={handleGoUp}
              title="Dossier parent"
              className="p-1.5 -ml-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <ArrowLeft size={16} />
            </button>
          )}
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100 truncate">
              {title}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate mt-0.5">
              {currentPath || 'Chargement...'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={Boolean(busyOp)}
            onClick={() => setMkdirOpen(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            <FolderPlus size={13} />
            Nouveau dossier
          </button>

          {selectedEntries.length > 0 && (
            <>
              {selectedEntries.length === 1 && (
                <button
                  type="button"
                  disabled={Boolean(busyOp)}
                  onClick={() => setRenameTarget(selectedEntries[0])}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                >
                  <Pencil size={13} />
                  Renommer
                </button>
              )}

              <button
                type="button"
                disabled={Boolean(busyOp)}
                onClick={handleCompressSelection}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                <Archive size={13} />
                Compresser .zip ({selectedEntries.length})
              </button>

              {singleZipSelected && (
                <button
                  type="button"
                  disabled={Boolean(busyOp)}
                  onClick={() => handleExtractZip(singleZipSelected)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-[#1A65C7]/40 bg-blue-50/70 dark:bg-blue-950/35 text-[#1A65C7] dark:text-blue-400 hover:bg-blue-100/70 whitespace-nowrap"
                >
                  <FileArchive size={13} />
                  Extraire .zip
                </button>
              )}

              <button
                type="button"
                disabled={Boolean(busyOp)}
                onClick={() => setTrashTargets(selectedEntries)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-red-200 dark:border-red-900/50 bg-white dark:bg-slate-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 whitespace-nowrap"
              >
                <Trash2 size={13} />
                Corbeille
              </button>
            </>
          )}

          {allowChangeRoot && onChangeRoot && (
            <button
              type="button"
              onClick={onChangeRoot}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              Changer de dossier
            </button>
          )}

          <div className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800/90">
            <button
              type="button"
              onClick={() => setLayout('grid')}
              title="Vue grille"
              className={`p-1.5 rounded-md transition-colors ${
                layout === 'grid'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
              }`}
            >
              <Grid2x2 size={14} />
            </button>
            <button
              type="button"
              onClick={() => setLayout('list')}
              title="Vue liste"
              className={`p-1.5 rounded-md transition-colors ${
                layout === 'list'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
              }`}
            >
              <List size={14} />
            </button>
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={() => loadDirectory(currentPath)}
            title="Actualiser"
            className="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center transition-colors"
          >
            <RefreshCw size={13} className={loading || Boolean(busyOp) ? 'animate-spin' : ''} />
          </button>

          {bridge && currentPath && (
            <button
              type="button"
              onClick={() => bridge.openInExplorer(currentPath)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-[#1A65C7] hover:bg-[#1557B0] text-white transition-colors whitespace-nowrap"
            >
              <FolderOpen size={13} />
              Explorateur
            </button>
          )}
        </div>
      </div>

      {/* Directory Entries */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading && entries.length === 0 ? (
          <div className="space-y-2.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-16 rounded-xl bg-slate-100 dark:bg-slate-900 animate-pulse"
              />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-white dark:bg-slate-900 p-6 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="max-w-md mx-auto mt-12 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 p-10 text-center space-y-1.5">
            <Folder size={28} className="mx-auto text-slate-400" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Ce dossier est vide
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Les fichiers copiés depuis votre iPhone ou créés ici apparaîtront automatiquement.
            </p>
          </div>
        ) : layout === 'grid' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filteredEntries.map((entry) => {
              const thumbUrl = thumbs[entry.path];
              const isSelected = selectedPaths.includes(entry.path);
              const isZip = entry.kind === 'file' && entry.name.toLowerCase().endsWith('.zip');
              return (
                <div
                  key={entry.path}
                  onClick={(e) =>
                    explorerSelection.handleItemClick(e, entry.path, () => {
                      if (entry.kind === 'folder') {
                        setCurrentPath(entry.path);
                      } else {
                        setPreviewEntry(entry);
                      }
                    })
                  }
                  onMouseDown={explorerSelection.preventShiftTextSelection}
                  className={`group relative rounded-xl border bg-white dark:bg-slate-900 overflow-hidden cursor-pointer transition-all ${
                    isSelected
                      ? 'border-[#1A65C7] ring-2 ring-[#1A65C7]/25'
                      : 'border-slate-200/85 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="relative aspect-[4/3] bg-slate-50 dark:bg-slate-800/60 flex items-center justify-center overflow-hidden">
                    {thumbUrl ? (
                      <img
                        src={thumbUrl}
                        alt={entry.name}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
                      />
                    ) : entry.kind === 'folder' ? (
                      <Folder
                        size={32}
                        className="text-[#1A65C7] fill-[#1A65C7]/90 dark:text-blue-400 dark:fill-blue-400/80"
                      />
                    ) : isZip ? (
                      <FileArchive size={28} className="text-amber-500" />
                    ) : entry.mediaType === 'video' ? (
                      <Film size={28} className="text-indigo-500" />
                    ) : entry.mediaType === 'photo' ? (
                      <ImageIcon size={28} className="text-[#1A65C7]" />
                    ) : (
                      <FileText size={26} className="text-slate-400" />
                    )}

                    <button
                      type="button"
                      aria-label={`Sélectionner ${entry.name}`}
                      onClick={(e) => explorerSelection.handleCheckboxClick(e, entry.path)}
                      className={`absolute top-2 left-2 w-6 h-6 rounded-md flex items-center justify-center transition-all ${
                        isSelected
                          ? 'bg-[#1A65C7] text-white opacity-100 shadow-xs'
                          : 'bg-white/90 dark:bg-slate-900/90 border border-slate-300 dark:border-slate-600 text-transparent opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      <Check size={13} strokeWidth={2.5} />
                    </button>
                  </div>
                  <div className="px-3 py-2.5">
                    <div className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                      {entry.name}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums truncate">
                      {entry.kind === 'folder'
                        ? 'Dossier'
                        : `${formatShortDate(entry.modifiedAt)}${entry.size > 0 ? ` · ${formatBytes(entry.size)}` : ''}`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-2 max-w-5xl">
            {filteredEntries.map((entry) => {
              const thumbUrl = thumbs[entry.path];
              const isSelected = selectedPaths.includes(entry.path);
              const isZip = entry.kind === 'file' && entry.name.toLowerCase().endsWith('.zip');
              return (
                <div
                  key={entry.path}
                  onClick={(e) =>
                    explorerSelection.handleItemClick(e, entry.path, () => {
                      if (entry.kind === 'folder') {
                        setCurrentPath(entry.path);
                      } else {
                        setPreviewEntry(entry);
                      }
                    })
                  }
                  onMouseDown={explorerSelection.preventShiftTextSelection}
                  className={`group flex items-center gap-3.5 px-4 py-3 rounded-xl border cursor-pointer transition-colors ${
                    isSelected
                      ? 'border-[#1A65C7] bg-blue-50/40 dark:bg-blue-950/20'
                      : 'border-slate-200/85 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <button
                    type="button"
                    aria-label={`Sélectionner ${entry.name}`}
                    onClick={(e) => explorerSelection.handleCheckboxClick(e, entry.path)}
                    className={`w-5 h-5 rounded flex items-center justify-center shrink-0 transition-colors ${
                      isSelected
                        ? 'bg-[#1A65C7] text-white'
                        : 'border border-slate-300 dark:border-slate-600 text-transparent hover:border-[#1A65C7]'
                    }`}
                  >
                    <Check size={12} strokeWidth={2.5} />
                  </button>

                  <div className="w-12 h-10 rounded-lg bg-slate-50 dark:bg-slate-800/70 overflow-hidden flex items-center justify-center shrink-0">
                    {thumbUrl ? (
                      <img
                        src={thumbUrl}
                        alt={entry.name}
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />
                    ) : entry.kind === 'folder' ? (
                      <Folder
                        size={20}
                        className="text-[#1A65C7] fill-[#1A65C7]/90 dark:text-blue-400 dark:fill-blue-400/80"
                      />
                    ) : isZip ? (
                      <FileArchive size={18} className="text-amber-500" />
                    ) : entry.mediaType === 'video' ? (
                      <Film size={18} className="text-indigo-500" />
                    ) : entry.mediaType === 'photo' ? (
                      <ImageIcon size={18} className="text-[#1A65C7]" />
                    ) : (
                      <FileIcon size={18} className="text-slate-400" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {entry.name}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                      {entry.kind === 'folder'
                        ? 'Dossier'
                        : `${formatShortDate(entry.modifiedAt)}${entry.size > 0 ? ` · ${formatBytes(entry.size)}` : ''}`}
                    </div>
                  </div>

                  <div
                    className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {isZip && (
                      <button
                        type="button"
                        title="Extraire l’archive ZIP ici"
                        onClick={() => handleExtractZip(entry)}
                        className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-[#1A65C7] dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                      >
                        Extraire
                      </button>
                    )}
                    <button
                      type="button"
                      title="Renommer (extension modifiable)"
                      onClick={() => setRenameTarget(entry)}
                      className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      title="Déplacer dans la Corbeille"
                      onClick={() => setTrashTargets([entry])}
                      className="p-1.5 rounded-lg text-slate-500 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Inline Dialogs */}
      <InputDialog
        open={mkdirOpen}
        title="Nouveau dossier sur le PC"
        description="Crée un vrai dossier directement sur votre disque dur."
        label="Nom du dossier"
        initialValue=""
        placeholder="Exports_Vacances"
        submitLabel="Créer"
        onClose={() => setMkdirOpen(false)}
        onSubmit={handleCreateFolder}
      />

      <InputDialog
        open={Boolean(renameTarget)}
        title="Renommer sur le PC"
        description="Vous pouvez librement modifier le nom et l’extension du fichier (ex. .txt → .md)."
        label="Nouveau nom"
        initialValue={renameTarget?.name || ''}
        submitLabel="Renommer"
        onClose={() => setRenameTarget(null)}
        onSubmit={handleRename}
      />

      {trashTargets && trashTargets.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-4"
          onClick={() => setTrashTargets(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Déplacer dans la Corbeille ?
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              {trashTargets.length === 1 ? (
                <>
                  L’élément{' '}
                  <strong className="font-mono text-slate-900 dark:text-slate-100">
                    {trashTargets[0].name}
                  </strong>{' '}
                  sera envoyé vers la Corbeille de votre système.
                </>
              ) : (
                `${trashTargets.length} éléments seront déplacés vers la Corbeille de votre système.`
              )}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setTrashTargets(null)}
                className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleConfirmTrash}
                className="px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium"
              >
                Mettre à la Corbeille
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
