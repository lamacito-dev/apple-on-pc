import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  File as FileIcon,
  Film,
  FolderOpen,
  Minus,
  Plus,
  RefreshCw,
} from 'lucide-react';
import {
  getDesktopBridge,
  type DesktopFsEntry,
  type DesktopPreviewResult,
} from '../lib/desktopBridge';
import { formatBytes } from '../lib/fsUtils';

interface NativePreviewViewProps {
  source: 'iphone' | 'pc';
  deviceId?: string;
  deviceLabel?: string;
  entry: DesktopFsEntry;
  siblings?: DesktopFsEntry[];
  onSelectSibling?: (next: DesktopFsEntry) => void;
  onClose: () => void;
  onExportToPc?: (entry: DesktopFsEntry) => Promise<void>;
}

function formatFrenchDate(iso?: string): string {
  if (!iso) return '—';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ts));
}

function getFriendlyType(name: string, mime?: string): string {
  const ext = name.split('.').pop()?.toUpperCase();
  if (mime?.startsWith('image/') || ['JPG', 'JPEG', 'PNG', 'HEIC', 'HEIF', 'WEBP', 'GIF'].includes(ext || '')) {
    return `Image ${ext || ''}`.trim();
  }
  if (mime?.startsWith('video/') || ['MOV', 'MP4', 'M4V', 'AVI', 'MKV'].includes(ext || '')) {
    return `Vidéo ${ext || ''}`.trim();
  }
  if (mime === 'application/pdf' || ext === 'PDF') return 'Document PDF';
  if (mime?.startsWith('audio/')) return `Audio ${ext || ''}`.trim();
  return ext ? `Fichier ${ext}` : 'Fichier';
}

export function NativePreviewView({
  source,
  deviceId,
  deviceLabel,
  entry,
  siblings = [],
  onSelectSibling,
  onClose,
  onExportToPc,
}: NativePreviewViewProps) {
  const bridge = getDesktopBridge();
  const [preview, setPreview] = useState<DesktopPreviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const [naturalDims, setNaturalDims] = useState<{ w: number; h: number } | null>(null);
  const [exporting, setExporting] = useState(false);

  const fileSiblings = siblings.filter((s) => s.kind === 'file');
  const currentIndex = fileSiblings.findIndex((s) => s.path === entry.path);
  const prevItem = currentIndex > 0 ? fileSiblings[currentIndex - 1] : null;
  const nextItem =
    currentIndex >= 0 && currentIndex < fileSiblings.length - 1
      ? fileSiblings[currentIndex + 1]
      : null;

  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPreview(null);
    setZoom(100);
    setNaturalDims(null);

    const req =
      source === 'iphone' && deviceId
        ? bridge.prepareIphonePreview(deviceId, entry.path, entry.name)
        : bridge.preparePcPreview(entry.path);

    req
      .then((res) => {
        if (!cancelled) setPreview(res);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Impossible de charger la prévisualisation.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [bridge, source, deviceId, entry.path, entry.name]);

  // Keyboard navigation (Escape, Left, Right)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowLeft' && prevItem && onSelectSibling) {
        e.preventDefault();
        onSelectSibling(prevItem);
      } else if (e.key === 'ArrowRight' && nextItem && onSelectSibling) {
        e.preventDefault();
        onSelectSibling(nextItem);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, prevItem, nextItem, onSelectSibling]);

  const handleExport = async () => {
    if (!onExportToPc || exporting) return;
    setExporting(true);
    try {
      await onExportToPc(entry);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col lg:flex-row min-w-0 min-h-0 h-full overflow-hidden">
      {/* Center Preview Canvas (Matching Reference 03) */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 px-6 sm:px-8 py-5 overflow-hidden">
        {/* Top back + prev/next strip */}
        <div className="flex items-center justify-between gap-3 mb-4 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
          >
            <ArrowLeft size={14} />
            Retour aux fichiers
          </button>

          {fileSiblings.length > 1 && onSelectSibling && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums mr-1">
                {currentIndex + 1} / {fileSiblings.length}
              </span>
              <button
                type="button"
                disabled={!prevItem}
                onClick={() => prevItem && onSelectSibling(prevItem)}
                aria-label="Fichier précédent"
                className="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-35 flex items-center justify-center transition-colors"
              >
                <ChevronLeft size={15} />
              </button>
              <button
                type="button"
                disabled={!nextItem}
                onClick={() => nextItem && onSelectSibling(nextItem)}
                aria-label="Fichier suivant"
                className="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-35 flex items-center justify-center transition-colors"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          )}
        </div>

        {/* White Framed Preview Card */}
        <div className="flex-1 min-h-0 rounded-2xl border border-slate-200/85 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col overflow-hidden">
          <div className="px-6 pt-5 pb-3 text-center shrink-0">
            <h2 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100 truncate">
              {entry.name}
            </h2>
          </div>

          <div className="flex-1 min-h-0 px-5 pb-5 flex items-center justify-center overflow-auto">
            {loading ? (
              <div className="flex flex-col items-center gap-3 text-slate-500 dark:text-slate-400 text-sm">
                <RefreshCw size={22} className="animate-spin text-[#1A65C7]" />
                <span>Chargement de la prévisualisation...</span>
              </div>
            ) : error ? (
              <div className="max-w-md text-center space-y-2.5 p-6">
                <FileIcon size={32} className="mx-auto text-slate-400" />
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            ) : preview?.previewKind === 'image' && preview.url ? (
              <img
                src={preview.url}
                alt={entry.name}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  if (img.naturalWidth && img.naturalHeight) {
                    setNaturalDims({ w: img.naturalWidth, h: img.naturalHeight });
                  }
                }}
                style={{
                  transform: `scale(${zoom / 100})`,
                  transformOrigin: 'center center',
                }}
                className="max-h-full max-w-full object-contain rounded-xl transition-transform duration-150 select-none"
              />
            ) : preview?.previewKind === 'video' && preview.url ? (
              <video
                key={preview.url}
                src={preview.url}
                controls
                playsInline
                className="max-h-full max-w-full rounded-xl bg-black"
              />
            ) : preview?.previewKind === 'audio' && preview.url ? (
              <div className="w-full max-w-md p-6 rounded-xl bg-slate-50 dark:bg-slate-800/60 space-y-3 text-center">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                  {entry.name}
                </p>
                <audio src={preview.url} controls className="w-full" />
              </div>
            ) : preview?.previewKind === 'pdf' && preview.url ? (
              <iframe
                src={preview.url}
                title={entry.name}
                className="w-full h-full min-h-[420px] rounded-xl border border-slate-200 dark:border-slate-800 bg-white"
              />
            ) : preview?.previewKind === 'text' ? (
              <pre className="w-full h-full overflow-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4 text-xs font-mono text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap break-words">
                {preview.textContent || '(Fichier vide)'}
              </pre>
            ) : (
              <div className="text-center space-y-3 p-6 max-w-sm">
                {entry.mediaType === 'video' ? (
                  <Film size={36} className="mx-auto text-slate-400" />
                ) : (
                  <FileIcon size={36} className="mx-auto text-slate-400" />
                )}
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Aperçu direct non disponible pour ce format.
                </p>
                {source === 'pc' && bridge && (
                  <button
                    type="button"
                    onClick={() => bridge.openInExplorer(entry.path)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-[#1A65C7] text-white hover:bg-[#1557B0] transition-colors"
                  >
                    <ExternalLink size={13} />
                    Ouvrir avec Windows
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Floating Zoom Controls below card for images */}
        {preview?.previewKind === 'image' && (
          <div className="pt-4 flex justify-center shrink-0">
            <div className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(25, z - 25))}
                aria-label="Zoom arrière"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <Minus size={14} />
              </button>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(300, z + 25))}
                aria-label="Zoom avant"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <Plus size={14} />
              </button>
              <button
                type="button"
                onClick={() => setZoom(100)}
                className="px-2 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 tabular-nums hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              >
                {zoom}%
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Right Inspecteur Column (Matching Reference 03) */}
      <aside className="w-full lg:w-80 shrink-0 border-t lg:border-t-0 lg:border-l border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-6 flex flex-col justify-between overflow-y-auto">
        <div className="space-y-5">
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Inspecteur
          </h3>

          <dl className="space-y-4 text-sm">
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">Type</dt>
              <dd className="text-slate-900 dark:text-slate-100 font-medium mt-0.5">
                {getFriendlyType(entry.name, preview?.mimeType)}
              </dd>
            </div>

            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">Date</dt>
              <dd className="text-slate-900 dark:text-slate-100 mt-0.5 tabular-nums">
                {formatFrenchDate(entry.modifiedAt)}
              </dd>
            </div>

            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">Taille</dt>
              <dd className="text-slate-900 dark:text-slate-100 mt-0.5 tabular-nums">
                {formatBytes(preview?.size || entry.size || 0)}
              </dd>
            </div>

            {naturalDims && (
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400">Dimensions</dt>
                <dd className="text-slate-900 dark:text-slate-100 mt-0.5 tabular-nums">
                  {naturalDims.w} × {naturalDims.h} px
                </dd>
              </div>
            )}

            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">
                {source === 'iphone' ? 'Appareil' : 'Emplacement'}
              </dt>
              <dd className="text-slate-900 dark:text-slate-100 mt-0.5">
                {source === 'iphone' ? deviceLabel || 'Apple iPhone' : 'Ordinateur Windows'}
              </dd>
            </div>

            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">Chemin</dt>
              <dd className="text-slate-700 dark:text-slate-300 text-xs font-mono break-all mt-0.5 leading-relaxed">
                {entry.path}
              </dd>
            </div>
          </dl>
        </div>

        <div className="pt-6 space-y-2.5">
          {source === 'iphone' && onExportToPc && (
            <button
              type="button"
              disabled={exporting}
              onClick={handleExport}
              className="w-full py-2.5 px-4 rounded-xl bg-[#1A65C7] hover:bg-[#1557B0] disabled:opacity-60 text-white text-sm font-medium transition-colors inline-flex items-center justify-center gap-2"
            >
              {exporting ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Download size={15} />
              )}
              {exporting ? 'Export vers PC...' : 'Exporter vers PC'}
            </button>
          )}

          {source === 'pc' && bridge && (
            <button
              type="button"
              onClick={() => bridge.openInExplorer(entry.path)}
              className="w-full py-2.5 px-4 rounded-xl bg-[#1A65C7] hover:bg-[#1557B0] text-white text-sm font-medium transition-colors inline-flex items-center justify-center gap-2"
            >
              <FolderOpen size={15} />
              Ouvrir avec Windows
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
