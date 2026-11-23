import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  Check,
  Download,
  File as FileIcon,
  Film,
  Folder,
  FolderOpen,
  Grid2x2,
  Image as ImageIcon,
  List,
  Play,
  RefreshCw,
} from 'lucide-react';
import {
  getDesktopBridge,
  type DesktopFsEntry,
  type DesktopIphoneDevice,
} from '../lib/desktopBridge';
import { formatBytes } from '../lib/fsUtils';
import { NativePreviewView } from './NativePreviewView';

interface NativeMediaWorkspaceProps {
  device: DesktopIphoneDevice;
  pcDir: string;
  searchQuery: string;
  onChangePcDir: () => Promise<void>;
  onToast: (text: string, type?: 'info' | 'success' | 'error') => void;
}

type MediaFilter = 'all' | 'photo' | 'video';
type DisplayLayout = 'grid' | 'list' | 'folders';
type GroupGranularity = 'month' | 'day';

interface DateGroup {
  key: string;
  label: string;
  items: DesktopFsEntry[];
  photoCount: number;
  videoCount: number;
}

function capitalizeFirst(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatGroupKeyAndLabel(
  iso: string | undefined,
  granularity: GroupGranularity
): { key: string; label: string } {
  const ts = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(ts)) {
    return { key: '0000-00', label: 'Date inconnue' };
  }
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');

  if (granularity === 'day') {
    const label = new Intl.DateTimeFormat('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(d);
    return { key: `${year}-${month}-${day}`, label };
  }

  const label = new Intl.DateTimeFormat('fr-FR', {
    month: 'long',
    year: 'numeric',
  }).format(d);
  return { key: `${year}-${month}`, label: capitalizeFirst(label) };
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

export function NativeMediaWorkspace({
  device,
  pcDir,
  searchQuery,
  onChangePcDir,
  onToast,
}: NativeMediaWorkspaceProps) {
  const bridge = getDesktopBridge();

  const [allMedia, setAllMedia] = useState<DesktopFsEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
  const [layout, setLayout] = useState<DisplayLayout>('grid');
  const [granularity, setGranularity] = useState<GroupGranularity>('month');
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [copying, setCopying] = useState(false);

  // Thumbnail URL cache keyed by entry.path
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const requestedThumbsRef = useRef<Set<string>>(new Set());

  // Inline Preview state
  const [previewEntry, setPreviewEntry] = useState<DesktopFsEntry | null>(null);

  // Raw Folder view state (only when user switches to 'Dossiers')
  const [rawPath, setRawPath] = useState('');
  const [rawEntries, setRawEntries] = useState<DesktopFsEntry[]>([]);
  const [rawLoading, setRawLoading] = useState(false);

  const loadAllMedia = useCallback(async () => {
    if (!bridge) return;
    setLoading(true);
    setError(null);
    try {
      const scanned = await bridge.scanIphoneMedia(device.id);
      const mediaOnly = scanned.filter(
        (e) => e.mediaType === 'photo' || e.mediaType === 'video' || e.mediaType === 'document'
      );
      setAllMedia(mediaOnly);
      setSelectedPaths([]);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Impossible d’analyser la bibliothèque de votre iPhone.'
      );
    } finally {
      setLoading(false);
    }
  }, [bridge, device.id]);

  useEffect(() => {
    requestedThumbsRef.current.clear();
    setThumbs({});
    setPreviewEntry(null);
    loadAllMedia();
  }, [loadAllMedia]);

  const loadRawFolder = useCallback(
    async (targetPath: string) => {
      if (!bridge) return;
      setRawLoading(true);
      try {
        const list = await bridge.listIphoneDirectory(device.id, targetPath);
        list.sort((a, b) => {
          if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
          return a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' });
        });
        setRawPath(targetPath);
        setRawEntries(list);
      } catch (err) {
        onToast(
          err instanceof Error ? err.message : 'Impossible d’ouvrir ce dossier.',
          'error'
        );
      } finally {
        setRawLoading(false);
      }
    },
    [bridge, device.id, onToast]
  );

  useEffect(() => {
    if (layout === 'folders' && rawEntries.length === 0 && !rawLoading) {
      loadRawFolder('');
    }
  }, [layout, rawEntries.length, rawLoading, loadRawFolder]);

  // Filtered media items
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allMedia.filter((item) => {
      if (mediaFilter === 'photo' && item.mediaType !== 'photo') return false;
      if (mediaFilter === 'video' && item.mediaType !== 'video') return false;
      if (mediaFilter === 'all' && item.mediaType !== 'photo' && item.mediaType !== 'video') {
        return false;
      }
      if (q && !item.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allMedia, mediaFilter, searchQuery]);

  // Group filtered items chronologically by date (newest first)
  const dateGroups = useMemo<DateGroup[]>(() => {
    const map = new Map<string, DateGroup>();
    for (const item of filteredItems) {
      const { key, label } = formatGroupKeyAndLabel(item.modifiedAt, granularity);
      let group = map.get(key);
      if (!group) {
        group = { key, label, items: [], photoCount: 0, videoCount: 0 };
        map.set(key, group);
      }
      group.items.push(item);
      if (item.mediaType === 'video') group.videoCount += 1;
      else group.photoCount += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.key.localeCompare(a.key));
  }, [filteredItems, granularity]);

  // Progressive batch thumbnail loading (non-blocking, 16 items per batch for snappy startup!)
  useEffect(() => {
    if (!bridge || layout === 'folders') return;
    const pending = filteredItems
      .filter((item) => item.shellPath && !requestedThumbsRef.current.has(item.path))
      .slice(0, 160);

    if (pending.length === 0) return;

    let cancelled = false;
    const runBatches = async () => {
      const BATCH_SIZE = 16;
      for (let i = 0; i < pending.length; i += BATCH_SIZE) {
        if (cancelled) return;
        const batch = pending.slice(i, i + BATCH_SIZE);
        batch.forEach((b) => requestedThumbsRef.current.add(b.path));
        try {
          const urls = await bridge.getThumbnailsBatch(
            batch.map((b) => ({ key: b.path, shellPath: b.shellPath! })),
            360
          );
          if (!cancelled && urls && Object.keys(urls).length > 0) {
            setThumbs((prev) => ({ ...prev, ...urls }));
          }
        } catch {
          // Continue cleanly to next batch
        }
      }
    };

    runBatches();
    return () => {
      cancelled = true;
    };
  }, [bridge, filteredItems, layout]);

  const totalSize = useMemo(
    () => filteredItems.reduce((acc, item) => acc + (item.size || 0), 0),
    [filteredItems]
  );

  const toggleSelect = (itemPath: string) => {
    setSelectedPaths((prev) =>
      prev.includes(itemPath) ? prev.filter((p) => p !== itemPath) : [...prev, itemPath]
    );
  };

  const toggleSelectGroup = (group: DateGroup) => {
    const groupPaths = group.items.map((i) => i.path);
    const allSelected = groupPaths.every((p) => selectedPaths.includes(p));
    if (allSelected) {
      const removeSet = new Set(groupPaths);
      setSelectedPaths((prev) => prev.filter((p) => !removeSet.has(p)));
    } else {
      setSelectedPaths((prev) => Array.from(new Set([...prev, ...groupPaths])));
    }
  };

  const handleCopyItemsToPc = async (itemsToCopy: DesktopFsEntry[]) => {
    if (!bridge || copying) return;
    if (itemsToCopy.length === 0) {
      onToast('Sélectionnez une ou plusieurs photos/vidéos à copier vers votre PC.', 'info');
      return;
    }

    setCopying(true);
    let copied = 0;
    try {
      for (const item of itemsToCopy) {
        await bridge.copyFromIphoneToPc(device.id, item.path, pcDir || undefined);
        copied += 1;
      }
      onToast(
        copied === 1
          ? `« ${itemsToCopy[0].name} » copié sur votre PC.`
          : `${copied} fichiers copiés dans votre dossier PC.`,
        'success'
      );
      setSelectedPaths([]);
    } catch (err) {
      onToast(
        err instanceof Error ? err.message : 'Erreur lors de la copie vers le PC.',
        'error'
      );
    } finally {
      setCopying(false);
    }
  };

  const handlePrimaryCopy = () => {
    const targets =
      selectedPaths.length > 0
        ? filteredItems.filter((i) => selectedPaths.includes(i.path))
        : [];
    if (targets.length === 0) {
      onToast('Cochez les photos ou vidéos à copier, ou cliquez sur « Sélectionner ce mois ».', 'info');
      return;
    }
    handleCopyItemsToPc(targets);
  };

  // Inline Preview View (Screen 03)
  if (previewEntry) {
    return (
      <NativePreviewView
        source="iphone"
        deviceId={device.id}
        deviceLabel={device.name}
        entry={previewEntry}
        siblings={layout === 'folders' ? rawEntries : filteredItems}
        onSelectSibling={(next) => setPreviewEntry(next)}
        onClose={() => setPreviewEntry(null)}
        onExportToPc={async (entry) => {
          await handleCopyItemsToPc([entry]);
        }}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 h-full overflow-hidden">
      {/* Clean Single-Row Header Toolbar */}
      <div className="px-6 py-4 border-b border-slate-200/75 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex flex-wrap items-center gap-4 min-w-0">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100 leading-tight">
              Photos et vidéos · {device.name}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
              {loading
                ? 'Regroupement chronologique en cours...'
                : `${filteredItems.length} élément${filteredItems.length > 1 ? 's' : ''} · ${formatBytes(totalSize)} · Classés par date`}
            </p>
          </div>

          {/* Segmented Media Type Filter */}
          {layout !== 'folders' && (
            <div className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800/90">
              {(
                [
                  { id: 'all', label: 'Tout' },
                  { id: 'photo', label: 'Photos' },
                  { id: 'video', label: 'Vidéos' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setMediaFilter(tab.id)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    mediaFilter === tab.id
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right Controls: Grouping, Display Mode, Primary Action */}
        <div className="flex items-center gap-2 shrink-0">
          {layout !== 'folders' && (
            <button
              type="button"
              onClick={() => setGranularity((g) => (g === 'month' ? 'day' : 'month'))}
              title="Basculer entre classement par mois ou par jour"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              <Calendar size={13} />
              {granularity === 'month' ? 'Par mois' : 'Par jour'}
            </button>
          )}

          {/* Layout Switcher: Grille / Liste / Dossiers */}
          <div className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800/90">
            <button
              type="button"
              onClick={() => setLayout('grid')}
              title="Affichage en grille avec aperçus"
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
              title="Affichage en liste"
              className={`p-1.5 rounded-md transition-colors ${
                layout === 'list'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
              }`}
            >
              <List size={14} />
            </button>
            <button
              type="button"
              onClick={() => setLayout('folders')}
              title="Affichage par dossiers bruts iPhone"
              className={`p-1.5 rounded-md transition-colors ${
                layout === 'folders'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400'
              }`}
            >
              <Folder size={14} />
            </button>
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={loadAllMedia}
            title="Actualiser l’iPhone"
            className="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center transition-colors"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>

          {layout !== 'folders' && (
            <button
              type="button"
              disabled={copying || selectedPaths.length === 0}
              onClick={handlePrimaryCopy}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#1A65C7] hover:bg-[#1557B0] disabled:opacity-45 text-white text-xs font-medium transition-colors whitespace-nowrap"
            >
              {copying ? <RefreshCw size={13} className="animate-spin" /> : <Download size={13} />}
              {copying
                ? 'Copie...'
                : selectedPaths.length > 0
                  ? `Copier vers PC (${selectedPaths.length})`
                  : 'Copier vers PC'}
            </button>
          )}
        </div>
      </div>

      {/* Main Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {layout === 'folders' ? (
          /* Optional Raw Folder Tree View */
          <div className="max-w-4xl space-y-3">
            <div className="flex items-center gap-2.5">
              {rawPath && (
                <button
                  type="button"
                  disabled={rawLoading}
                  onClick={() => {
                    const parts = rawPath.split('/').filter(Boolean);
                    parts.pop();
                    loadRawFolder(parts.join('/'));
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <ArrowLeft size={13} />
                  Retour
                </button>
              )}
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate">
                {device.name}
                {rawPath ? ` / ${rawPath}` : ' / Racine'}
              </span>
            </div>

            {rawLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-14 rounded-xl bg-slate-100 dark:bg-slate-900 animate-pulse"
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {rawEntries.map((entry) => (
                  <div
                    key={entry.path}
                    onClick={() => {
                      if (entry.kind === 'folder') {
                        loadRawFolder(entry.path);
                      } else {
                        setPreviewEntry(entry);
                      }
                    }}
                    className="rounded-xl border border-slate-200/85 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 flex items-center justify-between gap-3 hover:border-slate-300 dark:hover:border-slate-700 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {entry.kind === 'folder' ? (
                        <Folder
                          size={20}
                          className="text-[#1A65C7] fill-[#1A65C7]/90 dark:text-blue-400 dark:fill-blue-400/80 shrink-0"
                        />
                      ) : entry.mediaType === 'video' ? (
                        <Film size={18} className="text-indigo-500 shrink-0" />
                      ) : entry.mediaType === 'photo' ? (
                        <ImageIcon size={18} className="text-[#1A65C7] shrink-0" />
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
                    </div>

                    {entry.kind === 'file' && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyItemsToPc([entry]);
                        }}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 shrink-0"
                      >
                        Copier
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : loading ? (
          /* Clean Skeleton Grid while scanning all iPhone folders once */
          <div className="space-y-6">
            <div className="h-5 w-40 rounded bg-slate-200/80 dark:bg-slate-800 animate-pulse" />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden"
                >
                  <div className="aspect-[4/3] bg-slate-100 dark:bg-slate-800 animate-pulse" />
                  <div className="p-3 space-y-1.5">
                    <div className="h-3.5 w-2/3 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
                    <div className="h-3 w-1/2 rounded bg-slate-100 dark:bg-slate-800 animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : error ? (
          <div className="max-w-lg mx-auto mt-10 rounded-2xl border border-red-200 dark:border-red-900/50 bg-white dark:bg-slate-900 p-6 text-center space-y-3">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <button
              type="button"
              onClick={loadAllMedia}
              className="px-4 py-2 rounded-lg bg-[#1A65C7] text-white text-xs font-medium hover:bg-[#1557B0] transition-colors"
            >
              Réessayer
            </button>
          </div>
        ) : dateGroups.length === 0 ? (
          <div className="max-w-md mx-auto mt-12 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 p-10 text-center space-y-2">
            <ImageIcon size={28} className="mx-auto text-slate-400" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Aucune photo ou vidéo trouvée
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Vérifiez que votre iPhone est déverrouillé ou essayez un autre filtre.
            </p>
          </div>
        ) : (
          /* Chronological Date-Grouped Media Feed (No more 202607_a / 202608_a chaos!) */
          <div className="space-y-9">
            {dateGroups.map((group) => {
              const allGroupSelected = group.items.every((item) =>
                selectedPaths.includes(item.path)
              );
              const metaParts: string[] = [];
              if (group.photoCount > 0) {
                metaParts.push(`${group.photoCount} photo${group.photoCount > 1 ? 's' : ''}`);
              }
              if (group.videoCount > 0) {
                metaParts.push(`${group.videoCount} vidéo${group.videoCount > 1 ? 's' : ''}`);
              }

              return (
                <section key={group.key} className="space-y-3.5">
                  {/* Date Section Header */}
                  <div className="flex items-baseline justify-between gap-4 pb-2 border-b border-slate-200/70 dark:border-slate-800/80">
                    <div className="flex items-baseline gap-2.5 min-w-0">
                      <h2 className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                        {group.label}
                      </h2>
                      <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                        {metaParts.join(' · ')}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleSelectGroup(group)}
                      className="text-xs font-medium text-[#1A65C7] dark:text-blue-400 hover:underline whitespace-nowrap shrink-0"
                    >
                      {allGroupSelected ? 'Tout désélectionner' : 'Sélectionner tout'}
                    </button>
                  </div>

                  {layout === 'grid' ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                      {group.items.map((item) => {
                        const isSelected = selectedPaths.includes(item.path);
                        const thumbUrl = thumbs[item.path];
                        const isVideo = item.mediaType === 'video';

                        return (
                          <div
                            key={item.path}
                            onClick={() => setPreviewEntry(item)}
                            className={`group relative rounded-xl border bg-white dark:bg-slate-900 overflow-hidden cursor-pointer transition-all ${
                              isSelected
                                ? 'border-[#1A65C7] ring-2 ring-[#1A65C7]/25'
                                : 'border-slate-200/85 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                            }`}
                          >
                            {/* Media Thumbnail Frame */}
                            <div className="relative aspect-[4/3] bg-slate-100 dark:bg-slate-800/70 overflow-hidden flex items-center justify-center">
                              {thumbUrl ? (
                                <img
                                  src={thumbUrl}
                                  alt={item.name}
                                  loading="lazy"
                                  className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                                />
                              ) : isVideo ? (
                                <Film size={26} className="text-slate-400 dark:text-slate-500" />
                              ) : (
                                <ImageIcon
                                  size={26}
                                  className="text-slate-400 dark:text-slate-500"
                                />
                              )}

                              {/* Video scrim indicator */}
                              {isVideo && (
                                <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/75 via-black/30 to-transparent flex items-end justify-between px-2.5 pb-2 pointer-events-none">
                                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-white">
                                    <Play size={11} className="fill-white" />
                                    Vidéo
                                  </span>
                                </div>
                              )}

                              {/* Selection checkbox button */}
                              <button
                                type="button"
                                aria-label={`Sélectionner ${item.name}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleSelect(item.path);
                                }}
                                className={`absolute top-2 left-2 w-6 h-6 rounded-md flex items-center justify-center transition-all ${
                                  isSelected
                                    ? 'bg-[#1A65C7] text-white opacity-100 shadow-xs'
                                    : 'bg-white/90 dark:bg-slate-900/90 border border-slate-300 dark:border-slate-600 text-transparent opacity-0 group-hover:opacity-100'
                                }`}
                              >
                                <Check size={13} strokeWidth={2.5} />
                              </button>
                            </div>

                            {/* Clean 2-Line Caption */}
                            <div className="px-3 py-2.5">
                              <div className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                                {item.name}
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums truncate">
                                {formatShortDate(item.modifiedAt)}
                                {item.size > 0 ? ` · ${formatBytes(item.size)}` : ''}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    /* Clean Chronological List View */
                    <div className="space-y-2">
                      {group.items.map((item) => {
                        const isSelected = selectedPaths.includes(item.path);
                        const thumbUrl = thumbs[item.path];
                        const isVideo = item.mediaType === 'video';

                        return (
                          <div
                            key={item.path}
                            onClick={() => setPreviewEntry(item)}
                            className={`group flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl border cursor-pointer transition-all ${
                              isSelected
                                ? 'border-[#1A65C7] bg-blue-50/45 dark:bg-blue-950/25'
                                : 'border-slate-200/85 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                            }`}
                          >
                            <button
                              type="button"
                              aria-label={`Sélectionner ${item.name}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleSelect(item.path);
                              }}
                              className={`w-5 h-5 rounded flex items-center justify-center shrink-0 transition-colors ${
                                isSelected
                                  ? 'bg-[#1A65C7] text-white'
                                  : 'border border-slate-300 dark:border-slate-600 text-transparent hover:border-[#1A65C7]'
                              }`}
                            >
                              <Check size={12} strokeWidth={2.5} />
                            </button>

                            <div className="w-16 h-12 rounded-lg bg-slate-100 dark:bg-slate-800 overflow-hidden flex items-center justify-center shrink-0 relative">
                              {thumbUrl ? (
                                <img
                                  src={thumbUrl}
                                  alt={item.name}
                                  loading="lazy"
                                  className="w-full h-full object-cover"
                                />
                              ) : isVideo ? (
                                <Film size={18} className="text-slate-400" />
                              ) : (
                                <ImageIcon size={18} className="text-slate-400" />
                              )}
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                                {item.name}
                              </div>
                              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                                {formatShortDate(item.modifiedAt)}
                                {item.size > 0 ? ` · ${formatBytes(item.size)}` : ''}
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopyItemsToPc([item]);
                              }}
                              className="opacity-0 group-hover:opacity-100 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all shrink-0"
                            >
                              Copier vers PC
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>

      {/* Quiet Bottom Destination Strip */}
      <div className="px-6 py-2.5 border-t border-slate-200/75 dark:border-slate-800/80 bg-white/80 dark:bg-slate-900/60 flex items-center justify-between gap-4 text-xs shrink-0">
        <div className="flex items-center gap-2 min-w-0 text-slate-600 dark:text-slate-400">
          <FolderOpen size={14} className="text-[#1A65C7] dark:text-blue-400 shrink-0" />
          <span className="shrink-0">Destination PC :</span>
          <span className="font-mono text-slate-800 dark:text-slate-200 truncate">
            {pcDir || 'OpenFS-iPhone-Sync'}
          </span>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onChangePcDir}
            className="font-medium text-[#1A65C7] dark:text-blue-400 hover:underline whitespace-nowrap"
          >
            Changer
          </button>
          {bridge && pcDir && (
            <button
              type="button"
              onClick={() => bridge.openInExplorer(pcDir)}
              className="font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white whitespace-nowrap"
            >
              Ouvrir
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
