import { useEffect, useState } from 'react';
import {
  Archive,
  ArrowLeft,
  Check,
  FileArchive,
  FolderOutput,
  Minus,
  Plus,
  Save,
} from 'lucide-react';
import type { FSNode } from '../types/fs';
import {
  computeSha256,
  formatBytes,
  getExtension,
  getFileCategory,
  getPosixPath,
  getTypeLabel,
  inspectZipBlob,
  isTextEditable,
  type ZipEntryPreview,
} from '../lib/fsUtils';
import { resolveNodeBlob } from '../lib/fsDb';
import { FileIcon } from './FileIcon';

interface FileViewerModalProps {
  node: FSNode | null;
  nodeMap: Record<string, FSNode>;
  deviceLabel?: string | null;
  onClose: () => void;
  onSaveText: (node: FSNode, newText: string) => Promise<void>;
  onDownload: (node: FSNode) => void;
  onCompress: (nodes: FSNode[]) => void;
  onExtractZip: (node: FSNode) => Promise<void>;
}

function getFriendlyTypeLabel(node: FSNode): string {
  const ext = getExtension(node.name).toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'Image JPEG';
  if (ext === 'png') return 'Image PNG';
  if (ext === 'heic') return 'Image HEIC';
  if (ext === 'webp') return 'Image WebP';
  if (ext === 'mov' || ext === 'mp4') return 'Vidéo ' + ext.toUpperCase();
  if (ext === 'zip') return 'Archive ZIP';
  if (ext === 'pdf') return 'Document PDF';
  if (ext === 'json') return 'Fichier JSON';
  if (ext === 'plist') return 'Apple Plist';
  return getTypeLabel(node);
}

function formatShortHash(hash: string): string {
  if (hash.length <= 24) return hash;
  return `${hash.slice(0, 13)}...${hash.slice(-8)}`;
}

export function FileViewerModal({
  node,
  nodeMap,
  deviceLabel,
  onClose,
  onSaveText,
  onDownload,
  onCompress,
  onExtractZip,
}: FileViewerModalProps) {
  const [textDraft, setTextDraft] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);
  const [naturalDims, setNaturalDims] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(100);

  const [sha256, setSha256] = useState<string | null>(null);
  const [copiedHash, setCopiedHash] = useState(false);

  const [zipEntries, setZipEntries] = useState<ZipEntryPreview[] | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!node) return;
    setZoom(100);
    setImgError(false);
    setNaturalDims(null);
    setIsDirty(false);
    setSavedNotice(false);
    setZipEntries(null);
    setSha256(null);

    let revokedUrl: string | null = null;
    let cancelled = false;

    const loadContent = async () => {
      setLoading(true);
      const category = getFileCategory(node);
      const ext = getExtension(node.name);
      const blob = await resolveNodeBlob(node);
      if (cancelled) return;

      if (blob) {
        try {
          const buf = await blob.arrayBuffer();
          const hash = await computeSha256(buf);
          if (!cancelled) setSha256(hash);
        } catch {
          if (!cancelled) setSha256(null);
        }
      }

      if (isTextEditable(node)) {
        if (typeof node.textContent === 'string') {
          setTextDraft(node.textContent);
        } else if (blob) {
          setTextDraft(await blob.text());
        }
        setMediaUrl(null);
      } else if (category === 'image') {
        if (node.assetUrl) {
          setMediaUrl(node.assetUrl);
        } else if (blob) {
          revokedUrl = URL.createObjectURL(blob);
          setMediaUrl(revokedUrl);
        }
      } else if (category === 'audio' || category === 'video' || ext === 'pdf') {
        if (blob) {
          revokedUrl = URL.createObjectURL(blob);
          setMediaUrl(revokedUrl);
        }
      } else if (ext === 'zip' || node.mimeType.includes('zip')) {
        if (blob) {
          try {
            const list = await inspectZipBlob(blob);
            if (!cancelled) setZipEntries(list);
          } catch {
            if (!cancelled) setZipEntries([]);
          }
        }
      } else {
        setMediaUrl(null);
      }

      if (!cancelled) setLoading(false);
    };

    loadContent();

    return () => {
      cancelled = true;
      if (revokedUrl) URL.revokeObjectURL(revokedUrl);
    };
  }, [node]);

  if (!node) return null;

  const category = getFileCategory(node);
  const ext = getExtension(node.name);
  const editable = isTextEditable(node);
  const isReadOnly = !node.permissions.startsWith('rw');
  const fullPath = getPosixPath(node.id, nodeMap);

  const dimsWidth = node.meta?.width || naturalDims?.w;
  const dimsHeight = node.meta?.height || naturalDims?.h;
  const cameraOrDevice = node.meta?.camera || deviceLabel || 'iPhone USB-C';

  const handleSave = async () => {
    if (isReadOnly || !isDirty) return;
    setSaving(true);
    await onSaveText(node, textDraft);
    setSaving(false);
    setIsDirty(false);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 1800);
  };

  const handleExtract = async () => {
    setExtracting(true);
    await onExtractZip(node);
    setExtracting(false);
    onClose();
  };

  const handleCopyHash = () => {
    if (!sha256) return;
    navigator.clipboard?.writeText(sha256).catch(() => {});
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 1500);
  };

  return (
    <div className="flex-1 flex flex-col lg:flex-row min-w-0 h-full overflow-hidden">
      {/* Center Preview Canvas matching Reference 03 */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 p-5 sm:p-7 overflow-hidden">
        {/* Minimal Back Action */}
        <div className="flex items-center justify-between gap-3 pb-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
          >
            <ArrowLeft size={15} />
            Retour aux fichiers
          </button>

          {editable && !isReadOnly && (
            <button
              type="button"
              onClick={handleSave}
              disabled={!isDirty || saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-[#1A65C7] text-white hover:bg-[#1557B0] disabled:opacity-45 transition-colors"
            >
              {savedNotice ? <Check size={13} /> : <Save size={13} />}
              {savedNotice ? 'Enregistré' : saving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          )}
        </div>

        {/* Crisp White Framed Preview Card */}
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-4">
          <div className="w-full max-w-3xl flex-1 min-h-0 max-h-[620px] rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 flex flex-col overflow-hidden">
            <h2 className="text-center text-base font-semibold text-slate-900 dark:text-slate-100 pb-3.5 truncate shrink-0">
              {node.name}
            </h2>

            <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center rounded-xl bg-slate-50/70 dark:bg-slate-950/60">
              {loading ? (
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Chargement...
                </span>
              ) : category === 'image' && mediaUrl && !imgError ? (
                <div className="w-full h-full flex items-center justify-center overflow-auto">
                  <img
                    src={mediaUrl}
                    alt={node.name}
                    referrerPolicy="no-referrer"
                    onError={() => setImgError(true)}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      if (img.naturalWidth && img.naturalHeight) {
                        setNaturalDims({ w: img.naturalWidth, h: img.naturalHeight });
                      }
                    }}
                    style={{
                      width: zoom === 100 ? '100%' : `${zoom}%`,
                      maxWidth: zoom === 100 ? '100%' : 'none',
                    }}
                    className="max-h-full object-contain rounded-lg transition-all duration-150"
                  />
                </div>
              ) : editable ? (
                <textarea
                  value={textDraft}
                  readOnly={isReadOnly}
                  onChange={(e) => {
                    setTextDraft(e.target.value);
                    setIsDirty(true);
                  }}
                  spellCheck={false}
                  className="w-full h-full p-4 font-mono text-xs sm:text-[13px] leading-6 bg-transparent text-slate-900 dark:text-slate-100 resize-none focus:outline-none"
                />
              ) : category === 'audio' && mediaUrl ? (
                <div className="flex flex-col items-center justify-center gap-4 p-6 w-full">
                  <FileIcon node={node} size={40} />
                  <audio controls src={mediaUrl} className="w-full max-w-md" />
                </div>
              ) : category === 'video' && mediaUrl ? (
                <video
                  controls
                  src={mediaUrl}
                  className="max-h-full max-w-full rounded-lg bg-black"
                />
              ) : ext === 'pdf' && mediaUrl ? (
                <iframe
                  src={mediaUrl}
                  title={node.name}
                  className="w-full h-full border-0 bg-white rounded-lg"
                />
              ) : zipEntries !== null ? (
                <div className="w-full h-full overflow-y-auto p-4 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 text-sm font-medium text-slate-900 dark:text-slate-100">
                      <FileArchive size={18} className="text-[#1A65C7]" />
                      <span>{zipEntries.length} fichiers dans l’archive</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleExtract}
                      disabled={extracting || zipEntries.length === 0}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-[#1A65C7] text-white hover:bg-[#1557B0] disabled:opacity-50"
                    >
                      <FolderOutput size={13} />
                      {extracting ? 'Extraction...' : 'Extraire ici'}
                    </button>
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs font-mono">
                    {zipEntries.map((entry) => (
                      <div key={entry.path} className="py-2 flex items-center justify-between gap-3">
                        <span className="text-slate-800 dark:text-slate-200 truncate">
                          {entry.path}
                        </span>
                        <span className="text-slate-500 tabular-nums shrink-0">
                          {entry.isDir ? 'Dossier' : entry.size > 0 ? formatBytes(entry.size) : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
                  <Archive size={30} className="text-slate-400" />
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Aperçu binaire non pris en charge — utilisez « Exporter vers PC ».
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Floating Centered Zoom Bar matching Reference 03 */}
          {category === 'image' && mediaUrl && !imgError && (
            <div className="inline-flex items-center gap-4 px-4 py-2 rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs text-sm text-slate-800 dark:text-slate-200 shrink-0">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(50, z - 25))}
                aria-label="Dézoomer"
                className="p-0.5 text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white transition-colors"
              >
                <Minus size={15} />
              </button>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(200, z + 25))}
                aria-label="Zoomer"
                className="p-0.5 text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white transition-colors"
              >
                <Plus size={15} />
              </button>
              <span className="tabular-nums font-medium min-w-[3.2ch] text-right">{zoom}%</span>
            </div>
          )}
        </div>
      </div>

      {/* Right Inspecteur Column matching Reference 03 */}
      <aside className="w-full lg:w-72 xl:w-80 shrink-0 border-t lg:border-t-0 lg:border-l border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-900/50 p-6 flex flex-col justify-between gap-6 overflow-y-auto">
        <div className="space-y-6">
          <h3 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Inspecteur
          </h3>

          <dl className="space-y-4 text-sm">
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">Type</dt>
              <dd className="mt-0.5 font-medium text-slate-900 dark:text-slate-100">
                {getFriendlyTypeLabel(node)}
              </dd>
            </div>

            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">Taille</dt>
              <dd className="mt-0.5 font-medium tabular-nums text-slate-900 dark:text-slate-100">
                {formatBytes(node.size)}
              </dd>
            </div>

            {dimsWidth && dimsHeight && (
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400">Dimensions</dt>
                <dd className="mt-0.5 font-medium tabular-nums text-slate-900 dark:text-slate-100">
                  {dimsWidth} x {dimsHeight} px
                </dd>
              </div>
            )}

            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">Appareil</dt>
              <dd className="mt-0.5 font-medium text-slate-900 dark:text-slate-100">
                {cameraOrDevice}
              </dd>
            </div>

            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">Chemin</dt>
              <dd className="mt-0.5 font-medium text-slate-900 dark:text-slate-100 break-all">
                {fullPath}
              </dd>
            </div>

            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">SHA-256</dt>
              <dd className="mt-0.5">
                {sha256 ? (
                  <button
                    type="button"
                    onClick={handleCopyHash}
                    title="Cliquer pour copier l’empreinte SHA-256 complète"
                    className="font-mono text-xs text-slate-900 dark:text-slate-100 hover:text-[#1A65C7] dark:hover:text-blue-400 transition-colors text-left break-all"
                  >
                    {copiedHash ? 'Empreinte copiée' : formatShortHash(sha256)}
                  </button>
                ) : (
                  <span className="text-xs text-slate-500 dark:text-slate-400">Calcul...</span>
                )}
              </dd>
            </div>
          </dl>
        </div>

        {/* Bottom 2 Full-Width Actions matching Reference 03 */}
        <div className="space-y-2.5 pt-2 shrink-0">
          <button
            type="button"
            onClick={() => onDownload(node)}
            className="w-full py-2.5 px-4 rounded-lg bg-[#1A65C7] hover:bg-[#1557B0] text-white text-sm font-medium transition-colors"
          >
            Exporter vers PC
          </button>

          <button
            type="button"
            onClick={() => onCompress([node])}
            className="w-full py-2.5 px-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium transition-colors"
          >
            Compresser .zip
          </button>
        </div>
      </aside>
    </div>
  );
}
