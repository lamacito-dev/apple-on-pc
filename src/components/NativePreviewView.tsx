import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileArchive,
  File as FileIcon,
  Film,
  FolderOpen,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ShieldAlert,
  ShieldCheck,
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
  afcUdid?: string;
  afcAppId?: string;
  deviceLabel?: string;
  entry: DesktopFsEntry;
  siblings?: DesktopFsEntry[];
  onSelectSibling?: (next: DesktopFsEntry) => void;
  onClose: () => void;
  onExportToPc?: (entry: DesktopFsEntry) => Promise<void>;
  /** PC folder where « Compresser .zip » saves the archive of an iPhone file. */
  zipDestDir?: string;
  onSaved?: () => void;
  onPreviewImageReady?: (entryKey: string, url: string) => void;
  onToast?: (text: string, type?: 'info' | 'success' | 'error') => void;
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
  if (ext === 'PLIST') return 'Propriétés Apple (.plist)';
  return ext ? `Fichier ${ext}` : 'Fichier';
}

function getEntryKey(e: DesktopFsEntry): string {
  return e.shellPath || e.path;
}

export function NativePreviewView({
  source,
  deviceId,
  afcUdid,
  afcAppId,
  deviceLabel,
  entry,
  siblings = [],
  onSelectSibling,
  onClose,
  onExportToPc,
  zipDestDir,
  onSaved,
  onPreviewImageReady,
  onToast,
}: NativePreviewViewProps) {
  const bridge = getDesktopBridge();
  const [preview, setPreview] = useState<DesktopPreviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  // Low-resolution JPEG made by iOS, shown instantly while the full-quality preview loads
  const [quickUrl, setQuickUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const [naturalDims, setNaturalDims] = useState<{ w: number; h: number } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [compressing, setCompressing] = useState(false);

  // In-place editing state
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveVerification, setSaveVerification] = useState<{
    verified: boolean;
    sha256: string;
    binaryPlist?: boolean;
  } | null>(null);
  const [copiedHash, setCopiedHash] = useState(false);

  const fileSiblings = siblings.filter((s) => s.kind === 'file');
  const entryKey = getEntryKey(entry);
  const currentIndex = fileSiblings.findIndex((s) => getEntryKey(s) === entryKey);
  const prevItem = currentIndex > 0 ? fileSiblings[currentIndex - 1] : null;
  const nextItem =
    currentIndex >= 0 && currentIndex < fileSiblings.length - 1
      ? fileSiblings[currentIndex + 1]
      : null;

  const canEditInPlace = Boolean(
    preview?.previewKind === 'text' &&
      (source === 'pc' || (source === 'iphone' && (afcUdid || deviceId?.startsWith('afc:'))))
  );

  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPreview(null);
    setQuickUrl(null);
    setZoom(100);
    setNaturalDims(null);
    setEditing(false);
    setSaveVerification(null);

    const effectiveDeviceId = afcUdid ? `afc:${afcUdid}` : deviceId;
    const isCameraRollItem = source === 'iphone' && !afcUdid && Boolean(effectiveDeviceId);
    if (isCameraRollItem && bridge.getQuickPreview) {
      bridge
        .getQuickPreview(entry.name, entry.size, entryKey)
        .then((url) => {
          if (!cancelled && url) setQuickUrl(url);
        })
        .catch(() => {});
    }
    const req =
      source === 'iphone' && effectiveDeviceId
        ? bridge.prepareIphonePreview(
            effectiveDeviceId,
            entry.path,
            entry.name,
            entry.shellPath || '',
            afcAppId ? { appId: afcAppId } : { size: entry.size }
          )
        : bridge.preparePcPreview(entry.path);

    req
      .then((res) => {
        if (!cancelled) {
          setPreview(res);
          setDraftText(res.textContent ?? '');
          // Prepare the neighbouring photos in the background so the next one opens instantly
          if (isCameraRollItem && bridge.prefetchIphonePreview && effectiveDeviceId) {
            for (const n of [nextItem, prevItem]) {
              if (n && /\.(heic|heif|jpe?g|png)$/i.test(n.name)) {
                bridge
                  .prefetchIphonePreview(effectiveDeviceId, n.path, n.name, n.shellPath || '', { size: n.size })
                  .catch(() => {});
              }
            }
          }
          if (res.previewKind === 'image' && res.url && onPreviewImageReady) {
            onPreviewImageReady(entryKey, res.url);
          }
        }
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
  }, [bridge, source, deviceId, afcUdid, afcAppId, entry.path, entry.name, entry.shellPath]);

  // Keyboard navigation (disabled while typing inside editor)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (editing) return;
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
  }, [editing, onClose, prevItem, nextItem, onSelectSibling]);

  const handleExport = async () => {
    if (!onExportToPc || exporting) return;
    setExporting(true);
    try {
      await onExportToPc(entry);
    } finally {
      setExporting(false);
    }
  };

  const canCompress =
    Boolean(bridge) &&
    (source === 'pc' || (Boolean(bridge?.compressIphoneItemToPc) && Boolean(onExportToPc)));

  const handleCompressZip = async () => {
    if (!bridge || compressing) return;
    setCompressing(true);
    try {
      if (source === 'pc') {
        const res = await bridge.pcCompressZip([entry.path]);
        onSaved?.();
        onToast?.(`« ${res.name} » créé à côté du fichier (${formatBytes(res.size)}).`, 'success');
      } else if (bridge.compressIphoneItemToPc) {
        const res = await bridge.compressIphoneItemToPc({
          deviceId,
          afcUdid,
          appId: afcAppId,
          relativePath: entry.path,
          name: entry.name,
          shellPath: entry.shellPath,
          size: entry.size,
          destDir: zipDestDir,
        });
        onToast?.(`« ${res.name} » créé dans ${res.destDir} (${formatBytes(res.size)}).`, 'success');
      }
    } catch (err) {
      onToast?.(
        err instanceof Error ? err.message : 'Impossible de créer l’archive .zip.',
        'error'
      );
    } finally {
      setCompressing(false);
    }
  };

  const handleSaveEditedFile = async () => {
    if (!bridge || saving || !preview) return;
    setSaving(true);
    setSaveVerification(null);
    try {
      if (source === 'pc') {
        const res = await bridge.pcSaveTextFile(entry.path, draftText, {
          convertToBinaryPlist: Boolean(preview.isBinaryPlist),
        });
        setPreview((prev) =>
          prev
            ? { ...prev, textContent: draftText, size: res.size, sha256: res.sha256 }
            : prev
        );
        setSaveVerification({
          verified: res.verified,
          sha256: res.sha256,
          binaryPlist: res.savedAsBinaryPlist,
        });
        setEditing(false);
        onSaved?.();
        onToast?.(`« ${entry.name} » enregistré sur le PC (SHA-256 vérifié).`, 'success');
      } else {
        const udid = afcUdid || (deviceId?.startsWith('afc:') ? deviceId.slice(4) : '');
        if (!udid) {
          throw new Error('Connexion AFC requise pour enregistrer directement sur l’iPhone.');
        }
        const res = await bridge.afcSaveEditable(udid, entry.path, draftText, {
          appId: afcAppId,
          convertToBinaryPlist: Boolean(preview.isBinaryPlist),
        });
        setPreview((prev) =>
          prev
            ? {
                ...prev,
                textContent: draftText,
                size: res.size,
                sha256: res.destSha256 || res.sourceSha256,
              }
            : prev
        );
        setSaveVerification({
          verified: res.verified,
          sha256: res.destSha256 || res.sourceSha256,
          binaryPlist: res.savedAsBinaryPlist,
        });
        setEditing(false);
        onSaved?.();
        onToast?.(
          res.verified
            ? `« ${entry.name} » réécrit sur l’iPhone — SHA-256 vérifié ✓`
            : `« ${entry.name} » écrit sur l’iPhone, mais la vérification SHA-256 diffère.`,
          res.verified ? 'success' : 'error'
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur lors de l’enregistrement.';
      onToast?.(msg, 'error');
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleCopySha = async () => {
    if (!preview?.sha256) return;
    try {
      await navigator.clipboard.writeText(preview.sha256);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 1800);
    } catch {
      onToast?.('Impossible de copier le hash dans le presse-papiers.', 'error');
    }
  };

  return (
    <div className="flex-1 flex flex-col lg:flex-row min-w-0 min-h-0 h-full overflow-hidden">
      {/* Center Preview / Editor Canvas */}
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

          <div className="flex items-center gap-2">
            {canEditInPlace && !editing && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              >
                <Pencil size={13} />
                Éditer sur place
              </button>
            )}

            {editing && (
              <>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setDraftText(preview?.textContent ?? '');
                    setEditing(false);
                  }}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSaveEditedFile}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#1A65C7] hover:bg-[#1557B0] disabled:opacity-50 text-white text-xs font-medium transition-colors"
                >
                  {saving ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
                  {saving
                    ? 'Écriture + SHA-256...'
                    : source === 'iphone'
                      ? 'Enregistrer sur l’iPhone'
                      : 'Enregistrer sur PC'}
                </button>
              </>
            )}

            {fileSiblings.length > 1 && onSelectSibling && !editing && (
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
        </div>

        {/* White Framed Preview Card */}
        <div className="flex-1 min-h-0 rounded-2xl border border-slate-200/85 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col overflow-hidden">
          <div className="px-6 pt-4 pb-3 flex items-center justify-between gap-3 shrink-0 border-b border-slate-100 dark:border-slate-800/80">
            <h2 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100 truncate">
              {entry.name}
            </h2>
            {preview?.isBinaryPlist && (
              <span className="text-[11px] font-mono text-[#1A65C7] dark:text-blue-400 shrink-0">
                Plist binaire · converti en XML (reconverti à l’enregistrement)
              </span>
            )}
          </div>

          <div className="flex-1 min-h-0 p-5 flex items-center justify-center overflow-auto">
            {loading && quickUrl ? (
              <div className="relative max-h-full max-w-full flex items-center justify-center">
                <img
                  src={quickUrl}
                  alt={entry.name}
                  className="max-h-full max-w-full object-contain rounded-xl select-none"
                />
                <span className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-[11px] text-white">
                  <RefreshCw size={11} className="animate-spin" />
                  Pleine qualité…
                </span>
              </div>
            ) : loading ? (
              <div className="flex flex-col items-center gap-3 text-slate-500 dark:text-slate-400 text-sm">
                <RefreshCw size={22} className="animate-spin text-[#1A65C7]" />
                <span>Chargement et calcul SHA-256...</span>
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
              editing ? (
                <textarea
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  spellCheck={false}
                  className="w-full h-full min-h-[360px] resize-none rounded-xl border border-[#1A65C7]/50 bg-slate-50 dark:bg-slate-950 p-4 text-xs font-mono text-slate-900 dark:text-slate-100 leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#1A65C7]/30"
                />
              ) : (
                <pre className="w-full h-full overflow-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4 text-xs font-mono text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap break-words">
                  {preview.textContent || '(Fichier vide)'}
                </pre>
              )
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
                    Ouvrir avec le système
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

      {/* Right Inspecteur Column with Real Streaming SHA-256 */}
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
                {formatBytes(preview?.size ?? entry.size ?? 0)}
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
                {source === 'iphone'
                  ? afcAppId
                    ? `${deviceLabel || 'iPhone'} · App ${afcAppId}`
                    : deviceLabel || 'Apple iPhone'
                  : 'Disque local'}
              </dd>
            </div>

            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">Chemin</dt>
              <dd className="text-slate-700 dark:text-slate-300 text-xs font-mono break-all mt-0.5 leading-relaxed">
                {entry.path}
              </dd>
            </div>

            {/* Real Streaming SHA-256 Digest */}
            <div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-xs text-slate-500 dark:text-slate-400">Empreinte SHA-256</dt>
                {preview?.sha256 && (
                  <button
                    type="button"
                    onClick={handleCopySha}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-[#1A65C7] dark:text-blue-400 hover:underline"
                  >
                    {copiedHash ? <Check size={11} /> : <Copy size={11} />}
                    {copiedHash ? 'Copié' : 'Copier'}
                  </button>
                )}
              </div>
              <dd className="mt-1 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800 px-2.5 py-2 text-[11px] font-mono text-slate-700 dark:text-slate-300 break-all leading-relaxed">
                {loading ? 'Calcul en streaming...' : preview?.sha256 || 'Non disponible'}
              </dd>
            </div>

            {saveVerification && (
              <div
                className={`rounded-xl border px-3 py-2.5 text-xs flex items-start gap-2 ${
                  saveVerification.verified
                    ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300'
                    : 'border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/30 text-red-700 dark:text-red-300'
                }`}
              >
                {saveVerification.verified ? (
                  <ShieldCheck size={15} className="shrink-0 mt-0.5" />
                ) : (
                  <ShieldAlert size={15} className="shrink-0 mt-0.5" />
                )}
                <div className="space-y-0.5">
                  <div className="font-semibold">
                    {saveVerification.verified
                      ? 'Écriture vérifiée (SHA-256 identique ✓)'
                      : 'Attention : SHA-256 différent après écriture ✗'}
                  </div>
                  {saveVerification.binaryPlist && (
                    <div className="text-[11px] opacity-85">Reconverti au format plist binaire.</div>
                  )}
                </div>
              </div>
            )}
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
              {exporting ? 'Export + SHA-256...' : 'Exporter vers PC'}
            </button>
          )}

          {canCompress && (
            <button
              type="button"
              disabled={compressing}
              onClick={handleCompressZip}
              className="w-full py-2.5 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60 text-slate-800 dark:text-slate-100 text-sm font-medium transition-colors inline-flex items-center justify-center gap-2"
            >
              {compressing ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <FileArchive size={15} />
              )}
              {compressing ? 'Compression .zip...' : 'Compresser .zip'}
            </button>
          )}

          {source === 'pc' && bridge && (
            <button
              type="button"
              onClick={() => bridge.openInExplorer(entry.path)}
              className="w-full py-2.5 px-4 rounded-xl bg-[#1A65C7] hover:bg-[#1557B0] text-white text-sm font-medium transition-colors inline-flex items-center justify-center gap-2"
            >
              <FolderOpen size={15} />
              Ouvrir dans l’explorateur
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
