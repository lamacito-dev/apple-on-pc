import { useEffect, useState } from 'react';
import {
  Archive,
  Check,
  Code2,
  Download,
  FileArchive,
  FolderOutput,
  Lock,
  Save,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { FSNode } from '../types/fs';
import {
  formatBytes,
  getExtension,
  getFileCategory,
  getPosixPath,
  inspectZipBlob,
  isTextEditable,
  type ZipEntryPreview,
} from '../lib/fsUtils';
import { resolveNodeBlob } from '../lib/fsDb';
import { FileIcon } from './FileIcon';

interface FileViewerModalProps {
  node: FSNode | null;
  nodeMap: Record<string, FSNode>;
  onClose: () => void;
  onSaveText: (node: FSNode, newText: string) => Promise<void>;
  onDownload: (node: FSNode) => void;
  onExtractZip: (node: FSNode) => Promise<void>;
}

export function FileViewerModal({
  node,
  nodeMap,
  onClose,
  onSaveText,
  onDownload,
  onExtractZip,
}: FileViewerModalProps) {
  const [textDraft, setTextDraft] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);
  const [zoom, setZoom] = useState(100);

  const [zipEntries, setZipEntries] = useState<ZipEntryPreview[] | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!node) return;
    setZoom(100);
    setImgError(false);
    setIsDirty(false);
    setSavedNotice(false);
    setZipEntries(null);

    let revokedUrl: string | null = null;
    let cancelled = false;

    const loadContent = async () => {
      setLoading(true);
      const category = getFileCategory(node);
      const ext = getExtension(node.name);

      if (isTextEditable(node)) {
        if (typeof node.textContent === 'string') {
          setTextDraft(node.textContent);
        } else {
          const blob = await resolveNodeBlob(node);
          if (blob && !cancelled) {
            setTextDraft(await blob.text());
          }
        }
        setMediaUrl(null);
      } else if (category === 'image') {
        if (node.assetUrl) {
          setMediaUrl(node.assetUrl);
        } else {
          const blob = await resolveNodeBlob(node);
          if (blob && !cancelled) {
            revokedUrl = URL.createObjectURL(blob);
            setMediaUrl(revokedUrl);
          }
        }
      } else if (category === 'audio' || category === 'video' || ext === 'pdf') {
        const blob = await resolveNodeBlob(node);
        if (blob && !cancelled) {
          revokedUrl = URL.createObjectURL(blob);
          setMediaUrl(revokedUrl);
        }
      } else if (ext === 'zip' || node.mimeType.includes('zip')) {
        const blob = await resolveNodeBlob(node);
        if (blob && !cancelled) {
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

  const handleSave = async () => {
    if (isReadOnly || !isDirty) return;
    setSaving(true);
    await onSaveText(node, textDraft);
    setSaving(false);
    setIsDirty(false);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 1800);
  };

  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(textDraft);
      setTextDraft(JSON.stringify(parsed, null, 2));
      setIsDirty(true);
    } catch {
      // Keep raw content if JSON is invalid
    }
  };

  const handleExtract = async () => {
    setExtracting(true);
    await onExtractZip(node);
    setExtracting(false);
    onClose();
  };

  const lineCount = textDraft.split('\n').length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-3 md:p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl h-[88vh] flex flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top bar */}
        <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <FileIcon node={node} size={20} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {node.name}
                </h2>
                {isReadOnly && (
                  <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 shrink-0">
                    <Lock size={12} /> Lecture seule
                  </span>
                )}
              </div>
              <p className="text-xs font-mono text-slate-500 dark:text-slate-400 truncate">
                {fullPath} · {formatBytes(node.size)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {editable && ext === 'json' && !isReadOnly && (
              <button
                type="button"
                onClick={handleFormatJson}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
              >
                <Code2 size={14} />
                Formater JSON
              </button>
            )}

            {editable && !isReadOnly && (
              <button
                type="button"
                onClick={handleSave}
                disabled={!isDirty || saving}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-45 transition-colors whitespace-nowrap"
              >
                {savedNotice ? <Check size={14} /> : <Save size={14} />}
                {savedNotice ? 'Enregistré' : saving ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            )}

            {category === 'image' && (
              <div className="hidden sm:flex items-center gap-1 mr-1">
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(50, z - 25))}
                  aria-label="Dézoomer"
                  className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800"
                >
                  <ZoomOut size={16} />
                </button>
                <span className="text-xs font-mono tabular-nums w-11 text-center text-slate-600 dark:text-slate-300">
                  {zoom}%
                </span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(200, z + 25))}
                  aria-label="Zoomer"
                  className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800"
                >
                  <ZoomIn size={16} />
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => onDownload(node)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              <Download size={14} />
              <span className="hidden sm:inline">Télécharger</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer l’aperçu"
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 dark:hover:text-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Viewer Body */}
        <div className="flex-1 overflow-auto bg-slate-100/70 dark:bg-slate-950 relative">
          {loading ? (
            <div className="h-full flex items-center justify-center text-sm text-slate-500 dark:text-slate-400">
              Chargement du fichier...
            </div>
          ) : editable ? (
            <div className="flex flex-col h-full bg-white dark:bg-slate-950">
              <div className="flex flex-1 min-h-0 overflow-auto">
                {/* Line numbers gutter */}
                <div
                  aria-hidden="true"
                  className="select-none py-4 px-3 text-right font-mono text-xs leading-6 text-slate-400 dark:text-slate-600 bg-slate-50 dark:bg-slate-900/60 border-r border-slate-200 dark:border-slate-800 shrink-0 tabular-nums"
                >
                  {Array.from({ length: lineCount }, (_, idx) => (
                    <div key={idx}>{idx + 1}</div>
                  ))}
                </div>
                <textarea
                  value={textDraft}
                  readOnly={isReadOnly}
                  onChange={(e) => {
                    setTextDraft(e.target.value);
                    setIsDirty(true);
                  }}
                  spellCheck={false}
                  className="flex-1 w-full p-4 font-mono text-xs sm:text-[13px] leading-6 bg-transparent text-slate-900 dark:text-slate-100 resize-none focus:outline-none"
                />
              </div>
              <div className="flex items-center justify-between px-4 py-2 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
                <span>
                  {lineCount} lignes · {textDraft.length} caractères · UTF-8
                </span>
                <span>{isDirty ? 'Modifications non enregistrées' : 'Synchronisé en local'}</span>
              </div>
            </div>
          ) : category === 'image' && mediaUrl && !imgError ? (
            <div className="h-full flex items-center justify-center p-6 overflow-auto">
              <img
                src={mediaUrl}
                alt={node.name}
                referrerPolicy="no-referrer"
                onError={() => setImgError(true)}
                style={{ width: `${zoom}%`, maxWidth: zoom === 100 ? '100%' : 'none' }}
                className="max-h-full object-contain rounded-lg shadow-lg transition-all duration-150"
              />
            </div>
          ) : category === 'audio' && mediaUrl ? (
            <div className="h-full flex flex-col items-center justify-center p-8 gap-6">
              <div className="w-20 h-20 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                <FileIcon node={node} size={38} />
              </div>
              <div className="text-center space-y-1">
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  {node.name}
                </h3>
                <p className="text-xs font-mono text-slate-500 dark:text-slate-400">
                  {node.mimeType} · {formatBytes(node.size)}
                  {node.meta?.duration ? ` · ${node.meta.duration}` : ''}
                </p>
              </div>
              <audio controls src={mediaUrl} className="w-full max-w-md" />
            </div>
          ) : category === 'video' && mediaUrl ? (
            <div className="h-full flex items-center justify-center p-4 bg-black">
              <video controls src={mediaUrl} className="max-h-full max-w-full rounded-lg" />
            </div>
          ) : ext === 'pdf' && mediaUrl ? (
            <iframe
              src={mediaUrl}
              title={node.name}
              className="w-full h-full border-0 bg-white"
            />
          ) : zipEntries !== null ? (
            <div className="p-6 max-w-3xl mx-auto space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-orange-500/10 flex items-center justify-center">
                    <FileArchive size={22} className="text-orange-600 dark:text-orange-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Contenu de l’archive ZIP
                    </h3>
                    <p className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {zipEntries.length} entrées détectées · {formatBytes(node.size)} compressés
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleExtract}
                  disabled={extracting || zipEntries.length === 0}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  <FolderOutput size={15} />
                  {extracting ? 'Extraction...' : 'Extraire dans le dossier courant'}
                </button>
              </div>

              {zipEntries.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Cette archive est vide ou son format ne peut pas être lu.
                </p>
              ) : (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/50">
                        <th className="py-2.5 px-4">Chemin interne</th>
                        <th className="py-2.5 px-4 text-right">Taille</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
                      {zipEntries.map((entry) => (
                        <tr key={entry.path} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 px-4 font-mono text-slate-800 dark:text-slate-200">
                            {entry.path}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                            {entry.isDir ? 'Dossier' : entry.size > 0 ? formatBytes(entry.size) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-slate-200/70 dark:bg-slate-800 flex items-center justify-center">
                <Archive size={28} className="text-slate-500 dark:text-slate-400" />
              </div>
              <div className="space-y-1 max-w-sm">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Aperçu binaire non pris en charge
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Téléchargez ce fichier sur votre appareil pour l’ouvrir avec une application native.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onDownload(node)}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                <Download size={14} />
                Télécharger ({formatBytes(node.size)})
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
