import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  File as FileIcon,
  FileText,
  Film,
  Folder,
  FolderOpen,
  Grid2x2,
  Image as ImageIcon,
  List,
  RefreshCw,
} from 'lucide-react';
import { getDesktopBridge, type DesktopFsEntry } from '../lib/desktopBridge';
import { formatBytes } from '../lib/fsUtils';
import { NativePreviewView } from './NativePreviewView';

interface NativePcBrowserViewProps {
  title: string;
  rootPath: string;
  searchQuery: string;
  allowChangeRoot?: boolean;
  onChangeRoot?: () => Promise<void>;
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
}: NativePcBrowserViewProps) {
  const bridge = getDesktopBridge();

  const [currentPath, setCurrentPath] = useState(rootPath);
  const [entries, setEntries] = useState<DesktopFsEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useState<'list' | 'grid'>('list');
  const [previewEntry, setPreviewEntry] = useState<DesktopFsEntry | null>(null);

  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const requestedThumbsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setCurrentPath(rootPath);
    setPreviewEntry(null);
  }, [rootPath]);

  const loadDirectory = useCallback(
    async (targetDir: string) => {
      if (!bridge || !targetDir) return;
      setLoading(true);
      setError(null);
      try {
        const list = await bridge.listPcDirectory(targetDir);
        setEntries(list);
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

  // Progressive thumbnails for images, videos, and PDFs in the PC folder
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
        } catch {
          // ignore single batch failure
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

  if (previewEntry) {
    return (
      <NativePreviewView
        source="pc"
        entry={previewEntry}
        siblings={filteredEntries}
        onSelectSibling={(next) => setPreviewEntry(next)}
        onClose={() => setPreviewEntry(null)}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 h-full overflow-hidden">
      {/* Header */}
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

        <div className="flex items-center gap-2 shrink-0">
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
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
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
              Les fichiers copiés depuis votre iPhone ou enregistrés ici apparaîtront automatiquement.
            </p>
          </div>
        ) : layout === 'grid' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filteredEntries.map((entry) => {
              const thumbUrl = thumbs[entry.path];
              return (
                <div
                  key={entry.path}
                  onClick={() => {
                    if (entry.kind === 'folder') {
                      setCurrentPath(entry.path);
                    } else {
                      setPreviewEntry(entry);
                    }
                  }}
                  className="group rounded-xl border border-slate-200/85 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 overflow-hidden cursor-pointer transition-colors"
                >
                  <div className="aspect-[4/3] bg-slate-50 dark:bg-slate-800/60 flex items-center justify-center overflow-hidden">
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
                    ) : entry.mediaType === 'video' ? (
                      <Film size={28} className="text-indigo-500" />
                    ) : entry.mediaType === 'photo' ? (
                      <ImageIcon size={28} className="text-[#1A65C7]" />
                    ) : (
                      <FileText size={26} className="text-slate-400" />
                    )}
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
              return (
                <div
                  key={entry.path}
                  onClick={() => {
                    if (entry.kind === 'folder') {
                      setCurrentPath(entry.path);
                    } else {
                      setPreviewEntry(entry);
                    }
                  }}
                  className="flex items-center gap-3.5 px-4 py-3 rounded-xl border border-slate-200/85 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 cursor-pointer transition-colors"
                >
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
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
