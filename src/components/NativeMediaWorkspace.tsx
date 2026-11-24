import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownUp,
  ArrowLeft,
  Calendar,
  Check,
  Download,
  FileArchive,
  File as FileIcon,
  Film,
  Folder,
  FolderOpen,
  Grid2x2,
  Image as ImageIcon,
  List,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  X,
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
type SortDirection = 'desc' | 'asc';

interface DateGroup {
  key: string;
  label: string;
  items: DesktopFsEntry[];
  photoCount: number;
  videoCount: number;
}

interface BatchItemOutcome {
  item: DesktopFsEntry;
  status: 'pending' | 'running' | 'verified' | 'mismatch' | 'failed';
  sha256?: string;
  copiedPath?: string;
  error?: string;
}

/**
 * Every WPD entry MUST be identified by its unique `shellPath` so Live Photos
 * (e.g. IMG_0289.HEIC + IMG_0289.MOV sharing the same WPD Name "IMG_0289") NEVER collide!
 */
function getEntryKey(entry: DesktopFsEntry): string {
  return entry.shellPath || entry.path;
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
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  // Selection keyed strictly by unique entryKey (shellPath || path)
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  // Batch export state with progress, SHA-256 verification & disconnect resume
  const [batchOutcomes, setBatchOutcomes] = useState<BatchItemOutcome[]>([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchCurrentName, setBatchCurrentName] = useState('');
  const cancelBatchRef = useRef(false);

  // Thumbnail URL cache keyed strictly by unique entryKey (shellPath || path)
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [brokenThumbs, setBrokenThumbs] = useState<Record<string, boolean>>({});
  const [thumbProgress, setThumbProgress] = useState<{ active: boolean; done: number; total: number }>({
    active: false,
    done: 0,
    total: 0,
  });
  const [thumbReloadNonce, setThumbReloadNonce] = useState(0);
  const requestedThumbsRef = useRef<Set<string>>(new Set());

  // Inline Preview state
  const [previewEntry, setPreviewEntry] = useState<DesktopFsEntry | null>(null);

  // Raw Folder view state
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
      setSelectedKeys([]);
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
    setBrokenThumbs({});
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

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = allMedia.filter((item) => {
      if (mediaFilter === 'photo' && item.mediaType !== 'photo') return false;
      if (mediaFilter === 'video' && item.mediaType !== 'video') return false;
      if (mediaFilter === 'all' && item.mediaType !== 'photo' && item.mediaType !== 'video') {
        return false;
      }
      if (q && !item.name.toLowerCase().includes(q)) return false;
      return true;
    });
    return sortDirection === 'desc' ? list : [...list].reverse();
  }, [allMedia, mediaFilter, searchQuery, sortDirection]);

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
    return Array.from(map.values()).sort((a, b) =>
      sortDirection === 'desc' ? b.key.localeCompare(a.key) : a.key.localeCompare(b.key)
    );
  }, [filteredItems, granularity, sortDirection]);

  const handleRetryMissingThumbs = useCallback(() => {
    const nextRequested = new Set<string>();
    for (const [k, url] of Object.entries(thumbs)) {
      if (url && !brokenThumbs[k]) {
        nextRequested.add(k);
      }
    }
    requestedThumbsRef.current = nextRequested;
    setBrokenThumbs({});
    setThumbReloadNonce((n) => n + 1);
  }, [thumbs, brokenThumbs]);

  // Progressive batch thumbnail loading keyed strictly by unique shellPath (8 items/batch for instant first-row paint)
  useEffect(() => {
    if (!bridge || layout === 'folders') return;
    const pending = filteredItems.filter((item) => {
      const k = getEntryKey(item);
      return Boolean(item.shellPath) && !requestedThumbsRef.current.has(k);
    });

    if (pending.length === 0) return;

    let cancelled = false;
    const runBatches = async () => {
      const BATCH_SIZE = 8;
      setThumbProgress({ active: true, done: 0, total: pending.length });
      let processed = 0;

      for (let i = 0; i < pending.length; i += BATCH_SIZE) {
        if (cancelled) return;
        const batch = pending.slice(i, i + BATCH_SIZE);
        batch.forEach((b) => requestedThumbsRef.current.add(getEntryKey(b)));
        try {
          const urls = await bridge.getThumbnailsBatch(
            batch.map((b) => ({ key: getEntryKey(b), shellPath: b.shellPath!, name: b.name, size: b.size })),
            360
          );
          if (!cancelled && urls && Object.keys(urls).length > 0) {
            setThumbs((prev) => ({ ...prev, ...urls }));
          }
        } catch (err) {
          console.warn('[OpenFS] Lot vignettes partiel:', err);
        } finally {
          processed += batch.length;
          if (!cancelled) {
            setThumbProgress({ active: true, done: processed, total: pending.length });
          }
        }
      }

      if (!cancelled) {
        setThumbProgress({ active: false, done: pending.length, total: pending.length });
      }
    };

    runBatches();
    return () => {
      cancelled = true;
    };
  }, [bridge, filteredItems, layout, thumbReloadNonce]);

  const totalSize = useMemo(
    () => filteredItems.reduce((acc, item) => acc + (item.size || 0), 0),
    [filteredItems]
  );

  const toggleSelect = (entryKey: string) => {
    setSelectedKeys((prev) =>
      prev.includes(entryKey) ? prev.filter((k) => k !== entryKey) : [...prev, entryKey]
    );
  };

  const toggleSelectGroup = (group: DateGroup) => {
    const groupKeys = group.items.map((i) => getEntryKey(i));
    const allSelected = groupKeys.every((k) => selectedKeys.includes(k));
    if (allSelected) {
      const removeSet = new Set(groupKeys);
      setSelectedKeys((prev) => prev.filter((k) => !removeSet.has(k)));
    } else {
      setSelectedKeys((prev) => Array.from(new Set([...prev, ...groupKeys])));
    }
  };

  const runBatchExport = async (initialOutcomes: BatchItemOutcome[]) => {
    if (!bridge || batchRunning || initialOutcomes.length === 0) return;
    cancelBatchRef.current = false;
    setBatchRunning(true);
    setBatchOutcomes(initialOutcomes);

    const working = initialOutcomes.map((o) => ({ ...o }));
    let verifiedCount = working.filter((o) => o.status === 'verified').length;
    let failedCount = 0;

    for (let i = 0; i < working.length; i++) {
      const current = working[i];
      if (current.status === 'verified') continue;
      if (cancelBatchRef.current) break;

      working[i] = { ...current, status: 'running', error: undefined };
      setBatchCurrentName(current.item.name);
      setBatchOutcomes([...working]);

      try {
        const res = await bridge.copyFromIphoneToPc(
          device.id,
          current.item.path,
          pcDir || undefined,
          current.item.shellPath || '',
          current.item.name
        );

        if (res.verified) {
          working[i] = {
            ...current,
            status: 'verified',
            sha256: res.destSha256 || res.sourceSha256,
            copiedPath: res.copiedPath,
          };
          verifiedCount += 1;
        } else {
          working[i] = {
            ...current,
            status: 'mismatch',
            sha256: res.destSha256,
            copiedPath: res.copiedPath,
            error: 'Empreinte SHA-256 différente après copie.',
          };
          failedCount += 1;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Échec de copie (iPhone déconnecté ?)';
        working[i] = {
          ...current,
          status: 'failed',
          error: msg,
        };
        failedCount += 1;

        // If iPhone clearly disconnected, mark remaining as pending so user can reconnect & resume in 1 click!
        if (/déconnecté|introuvable|verrouillé|interrompu/i.test(msg)) {
          setBatchOutcomes([...working]);
          onToast(
            `Transfert interrompu sur « ${current.item.name} ». Rebranchez l’iPhone puis cliquez sur « Reprendre ».`,
            'error'
          );
          break;
        }
      }
      setBatchOutcomes([...working]);
    }

    setBatchRunning(false);
    setBatchCurrentName('');

    const remainingPending = working.filter((o) => o.status === 'pending').length;
    if (failedCount === 0 && remainingPending === 0) {
      setSelectedKeys([]);
      onToast(
        verifiedCount === 1
          ? `« ${working[0].item.name} » copié — SHA-256 vérifié ✓`
          : `${verifiedCount} fichiers copiés sur le PC — empreintes SHA-256 vérifiées ✓`,
        'success'
      );
    } else if (failedCount > 0) {
      onToast(
        `${verifiedCount} vérifié(s), ${failedCount} échec(s). Vous pouvez reprendre les fichiers restants.`,
        'error'
      );
    }
  };

  const handleCopyItemsToPc = async (itemsToCopy: DesktopFsEntry[]) => {
    if (itemsToCopy.length === 0) {
      onToast('Sélectionnez une ou plusieurs photos/vidéos à copier vers votre PC.', 'info');
      return;
    }
    const queue: BatchItemOutcome[] = itemsToCopy.map((item) => ({
      item,
      status: 'pending',
    }));
    await runBatchExport(queue);
  };

  const handleResumeBatch = async () => {
    const nextQueue = batchOutcomes.map((o) =>
      o.status === 'verified' ? o : { ...o, status: 'pending' as const, error: undefined }
    );
    await runBatchExport(nextQueue);
  };

  const [zipping, setZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState<{ done: number; total: number } | null>(null);

  // Several selected photos/videos -> one .zip, saved where the user chooses (« Enregistrer sous »)
  const handleZipSelection = async () => {
    if (!bridge?.zipIphoneItems || !bridge.chooseZipDestination || zipping) return;
    const keySet = new Set(selectedKeys);
    const targets = filteredItems.filter((i) => keySet.has(getEntryKey(i)));
    if (targets.length === 0) {
      onToast('Cochez les photos ou vidéos à mettre dans le .zip, ou cliquez sur « Sélectionner tout ».', 'info');
      return;
    }
    const today = new Date().toLocaleDateString('fr-FR').replace(/\//g, '-');
    const defaultName =
      targets.length === 1
        ? `${targets[0].name.replace(/\.[^.]+$/, '')}.zip`
        : `Photos iPhone ${today} (${targets.length} fichiers).zip`;
    const destPath = await bridge.chooseZipDestination(defaultName, pcDir);
    if (!destPath) return;
    setZipping(true);
    setZipProgress({ done: 0, total: targets.length });
    const unsubscribe = bridge.onZipProgress?.((p) => setZipProgress({ done: p.done, total: p.total }));
    try {
      const res = await bridge.zipIphoneItems({
        deviceId: device.id,
        destPath,
        items: targets.map((t) => ({ relativePath: t.path, name: t.name, shellPath: t.shellPath, size: t.size })),
      });
      onToast(
        `« ${res.name} » enregistré dans ${res.destDir} — ${res.fileCount} fichier${res.fileCount > 1 ? 's' : ''}, ${formatBytes(res.size)}.`,
        'success'
      );
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Impossible de créer l’archive .zip.', 'error');
    } finally {
      unsubscribe?.();
      setZipping(false);
      setZipProgress(null);
    }
  };

  const handlePrimaryCopy = () => {
    const keySet = new Set(selectedKeys);
    const targets = filteredItems.filter((i) => keySet.has(getEntryKey(i)));
    if (targets.length === 0) {
      onToast('Cochez les photos ou vidéos à copier, ou cliquez sur « Sélectionner tout ».', 'info');
      return;
    }
    handleCopyItemsToPc(targets);
  };

  const batchStats = useMemo(() => {
    const total = batchOutcomes.length;
    const verified = batchOutcomes.filter((o) => o.status === 'verified').length;
    const failed = batchOutcomes.filter(
      (o) => o.status === 'failed' || o.status === 'mismatch'
    ).length;
    const pending = batchOutcomes.filter((o) => o.status === 'pending').length;
    const done = verified + failed;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return { total, verified, failed, pending, done, pct };
  }, [batchOutcomes]);

  // Inline Preview View
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
        zipDestDir={pcDir}
        onPreviewImageReady={(key, url) => {
          setThumbs((prev) => (prev[key] ? prev : { ...prev, [key]: url }));
        }}
        onToast={onToast}
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
                ? 'Analyse de la photothèque réelle...'
                : `${filteredItems.length} élément${filteredItems.length > 1 ? 's' : ''} · ${formatBytes(totalSize)} · Ordre chronologique${
                    thumbProgress.active
                      ? ` · Miniatures ${thumbProgress.done}/${thumbProgress.total}...`
                      : ''
                  }`}
            </p>
          </div>

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

        <div className="flex items-center gap-2 shrink-0">
          {layout !== 'folders' && (
            <>
              <button
                type="button"
                onClick={() => setSortDirection((d) => (d === 'desc' ? 'asc' : 'desc'))}
                title="Inverser l’ordre chronologique (plus récent / plus ancien)"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
              >
                <ArrowDownUp size={13} />
                {sortDirection === 'desc' ? 'Plus récent' : 'Plus ancien'}
              </button>

              <button
                type="button"
                onClick={() => setGranularity((g) => (g === 'month' ? 'day' : 'month'))}
                title="Basculer entre classement par mois ou par jour"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
              >
                <Calendar size={13} />
                {granularity === 'month' ? 'Par mois' : 'Par jour'}
              </button>

              {!thumbProgress.active &&
                filteredItems.length > 0 &&
                filteredItems.some((item) => item.shellPath && (!thumbs[getEntryKey(item)] || brokenThumbs[getEntryKey(item)])) && (
                  <button
                    type="button"
                    onClick={handleRetryMissingThumbs}
                    title="Relancer l’extraction des miniatures manquantes"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
                  >
                    <ImageIcon size={13} />
                    Miniatures
                  </button>
                )}
            </>
          )}

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

          {layout !== 'folders' && bridge?.zipIphoneItems && (
            <button
              type="button"
              disabled={zipping || batchRunning || selectedKeys.length === 0}
              onClick={handleZipSelection}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-45 text-slate-700 dark:text-slate-200 text-xs font-medium transition-colors whitespace-nowrap"
            >
              {zipping ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : (
                <FileArchive size={13} />
              )}
              {zipping && zipProgress
                ? `Compression ${zipProgress.done}/${zipProgress.total}...`
                : selectedKeys.length > 0
                  ? `Compresser en .zip (${selectedKeys.length})`
                  : 'Compresser en .zip'}
            </button>
          )}

          {layout !== 'folders' && (
            <button
              type="button"
              disabled={zipping || batchRunning || selectedKeys.length === 0}
              onClick={handlePrimaryCopy}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#1A65C7] hover:bg-[#1557B0] disabled:opacity-45 text-white text-xs font-medium transition-colors whitespace-nowrap"
            >
              {batchRunning ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : (
                <Download size={13} />
              )}
              {batchRunning
                ? `Export ${batchStats.done}/${batchStats.total}...`
                : selectedKeys.length > 0
                  ? `Exporter vers PC (${selectedKeys.length})`
                  : 'Exporter vers PC'}
            </button>
          )}
        </div>
      </div>

      {/* Batch Export Progress & SHA-256 Verification Banner */}
      {batchOutcomes.length > 0 && (
        <div className="px-6 py-3 border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-900/70 space-y-2.5 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5 min-w-0">
              {batchRunning ? (
                <RefreshCw size={14} className="animate-spin text-[#1A65C7] shrink-0" />
              ) : batchStats.failed > 0 || batchStats.pending > 0 ? (
                <AlertTriangle size={14} className="text-amber-500 shrink-0" />
              ) : (
                <ShieldCheck size={15} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
              )}
              <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                {batchRunning
                  ? `Export + vérification SHA-256 : ${batchCurrentName} (${batchStats.done}/${batchStats.total})`
                  : batchStats.failed === 0 && batchStats.pending === 0
                    ? `Export terminé : ${batchStats.verified}/${batchStats.total} vérifié(s) par SHA-256 ✓`
                    : `Export partiel : ${batchStats.verified} vérifié(s), ${batchStats.failed} échec(s)${
                        batchStats.pending > 0 ? `, ${batchStats.pending} en attente` : ''
                      }`}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {batchRunning ? (
                <button
                  type="button"
                  onClick={() => {
                    cancelBatchRef.current = true;
                  }}
                  className="px-2.5 py-1 rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Interrompre
                </button>
              ) : (
                <>
                  {(batchStats.failed > 0 || batchStats.pending > 0) && (
                    <button
                      type="button"
                      onClick={handleResumeBatch}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#1A65C7] hover:bg-[#1557B0] text-white font-medium"
                    >
                      <RotateCcw size={12} />
                      Reprendre / Réessayer ({batchStats.failed + batchStats.pending})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setBatchOutcomes([])}
                    aria-label="Fermer le rapport d’export"
                    className="p-1 rounded-md text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                  >
                    <X size={14} />
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
            <div
              className={`h-full transition-all duration-200 ${
                batchStats.failed > 0 ? 'bg-amber-500' : 'bg-[#1A65C7]'
              }`}
              style={{ width: `${batchStats.pct}%` }}
            />
          </div>

          {/* Failed or Mismatched Items Detail */}
          {batchStats.failed > 0 && (
            <div className="max-h-28 overflow-y-auto space-y-1 pt-0.5">
              {batchOutcomes
                .filter((o) => o.status === 'failed' || o.status === 'mismatch')
                .map((o) => (
                  <div
                    key={getEntryKey(o.item)}
                    className="flex items-center gap-2 text-[11px] text-red-600 dark:text-red-400"
                  >
                    <ShieldAlert size={12} className="shrink-0" />
                    <span className="font-mono font-medium shrink-0">{o.item.name}</span>
                    <span className="truncate">— {o.error}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Main Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {layout === 'folders' ? (
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
                    key={getEntryKey(entry)}
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
          <div className="max-w-xl mx-auto mt-10 rounded-2xl border border-red-200 dark:border-red-900/50 bg-white dark:bg-slate-900 p-6 text-center space-y-4 overflow-hidden">
            <p className="text-sm text-red-600 dark:text-red-400 whitespace-pre-wrap break-words text-left max-h-60 overflow-y-auto">
              {error}
            </p>
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
          <div className="space-y-9">
            {dateGroups.map((group) => {
              const allGroupSelected = group.items.every((item) =>
                selectedKeys.includes(getEntryKey(item))
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
                        const key = getEntryKey(item);
                        const isSelected = selectedKeys.includes(key);
                        const thumbUrl = thumbs[key];
                        const isVideo = item.mediaType === 'video';

                        return (
                          <div
                            key={key}
                            onClick={() => setPreviewEntry(item)}
                            className={`group relative rounded-xl border bg-white dark:bg-slate-900 overflow-hidden cursor-pointer transition-all ${
                              isSelected
                                ? 'border-[#1A65C7] ring-2 ring-[#1A65C7]/25'
                                : 'border-slate-200/85 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                            }`}
                          >
                            <div className="relative aspect-[4/3] bg-slate-100 dark:bg-slate-800/70 overflow-hidden flex items-center justify-center">
                              {thumbUrl && !brokenThumbs[key] ? (
                                <img
                                  src={thumbUrl}
                                  alt={item.name}
                                  loading="lazy"
                                  onError={() =>
                                    setBrokenThumbs((prev) => ({ ...prev, [key]: true }))
                                  }
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

                              {isVideo && (
                                <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/75 via-black/30 to-transparent flex items-end justify-between px-2.5 pb-2 pointer-events-none">
                                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-white">
                                    <Play size={11} className="fill-white" />
                                    Vidéo
                                  </span>
                                </div>
                              )}

                              <button
                                type="button"
                                aria-label={`Sélectionner ${item.name}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleSelect(key);
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
                    <div className="space-y-2">
                      {group.items.map((item) => {
                        const key = getEntryKey(item);
                        const isSelected = selectedKeys.includes(key);
                        const thumbUrl = thumbs[key];
                        const isVideo = item.mediaType === 'video';

                        return (
                          <div
                            key={key}
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
                                toggleSelect(key);
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
                              {thumbUrl && !brokenThumbs[key] ? (
                                <img
                                  src={thumbUrl}
                                  alt={item.name}
                                  loading="lazy"
                                  onError={() =>
                                    setBrokenThumbs((prev) => ({ ...prev, [key]: true }))
                                  }
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
