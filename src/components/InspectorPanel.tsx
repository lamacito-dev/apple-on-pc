import { useEffect, useState } from 'react';
import {
  Archive,
  Check,
  Copy,
  Download,
  ExternalLink,
  Lock,
  Pencil,
  Star,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';
import type { FSNode } from '../types/fs';
import { FileIcon } from './FileIcon';
import {
  computeFolderSize,
  computeSha256,
  formatBytes,
  formatDate,
  getFileCategory,
  getPosixPath,
  getTypeLabel,
} from '../lib/fsUtils';
import { resolveNodeBlob } from '../lib/fsDb';

interface InspectorPanelProps {
  node: FSNode | null;
  allNodes: FSNode[];
  nodeMap: Record<string, FSNode>;
  onClose: () => void;
  onOpen: (node: FSNode) => void;
  onDownload: (node: FSNode) => void;
  onRename: (node: FSNode) => void;
  onToggleStar: (node: FSNode) => void;
  onToggleReadOnly: (node: FSNode) => void;
  onCompress: (nodes: FSNode[]) => void;
  onDelete: (nodes: FSNode[]) => void;
}

export function InspectorPanel({
  node,
  allNodes,
  nodeMap,
  onClose,
  onOpen,
  onDownload,
  onRename,
  onToggleStar,
  onToggleReadOnly,
  onCompress,
  onDelete,
}: InspectorPanelProps) {
  const [sha256, setSha256] = useState<string | null>(null);
  const [loadingHash, setLoadingHash] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);
  const [copiedField, setCopiedField] = useState<'path' | 'hash' | null>(null);

  useEffect(() => {
    setSha256(null);
    setImgError(false);
    let revokedUrl: string | null = null;
    let cancelled = false;

    if (!node || node.kind === 'folder') {
      setPreviewUrl(null);
      return;
    }

    const loadPreviewAndHash = async () => {
      setLoadingHash(true);
      const blob = await resolveNodeBlob(node);
      if (cancelled) return;

      if (getFileCategory(node) === 'image') {
        if (node.assetUrl) {
          setPreviewUrl(node.assetUrl);
        } else if (blob) {
          revokedUrl = URL.createObjectURL(blob);
          setPreviewUrl(revokedUrl);
        }
      } else {
        setPreviewUrl(null);
      }

      if (blob) {
        try {
          const buf = await blob.arrayBuffer();
          const hash = await computeSha256(buf);
          if (!cancelled) setSha256(hash);
        } catch {
          if (!cancelled) setSha256(null);
        }
      }
      if (!cancelled) setLoadingHash(false);
    };

    loadPreviewAndHash();

    return () => {
      cancelled = true;
      if (revokedUrl) URL.revokeObjectURL(revokedUrl);
    };
  }, [node]);

  if (!node) return null;

  const fullPath = getPosixPath(node.id, nodeMap);
  const isFolder = node.kind === 'folder';
  const childCount = isFolder
    ? allNodes.filter((n) => n.parentId === node.id && !n.trashed).length
    : 0;
  const displaySize = isFolder ? computeFolderSize(node.id, allNodes) : node.size;
  const isReadOnly = !node.permissions.startsWith('rw');

  const copyText = (text: string, field: 'path' | 'hash') => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1500);
  };

  return (
    <aside className="w-full lg:w-80 xl:w-84 shrink-0 h-full flex flex-col border-l border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/80 overflow-y-auto">
      <div className="flex items-center justify-between h-14 px-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">Propriétés</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer les propriétés"
          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 dark:hover:text-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <X size={17} />
        </button>
      </div>

      <div className="p-4 space-y-5 flex-1">
        {/* Visual Preview Slot */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden">
          {previewUrl && !imgError ? (
            <button
              type="button"
              onClick={() => onOpen(node)}
              className="block w-full aspect-4/3 bg-slate-100 dark:bg-slate-900 overflow-hidden group relative"
            >
              <img
                src={previewUrl}
                alt={node.name}
                referrerPolicy="no-referrer"
                onError={() => setImgError(true)}
                className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
              />
            </button>
          ) : typeof node.textContent === 'string' && !isFolder ? (
            <button
              type="button"
              onClick={() => onOpen(node)}
              className="block w-full text-left p-3.5 bg-slate-950 text-slate-300 font-mono text-[11px] leading-relaxed h-36 overflow-hidden relative"
            >
              <pre className="whitespace-pre-wrap break-all opacity-90">
                {node.textContent.slice(0, 340)}
              </pre>
              <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-slate-950 to-transparent" />
            </button>
          ) : (
            <div className="h-32 flex flex-col items-center justify-center gap-2 bg-slate-100/70 dark:bg-slate-900/60">
              <FileIcon node={node} size={36} />
              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                {getTypeLabel(node)}
              </span>
            </div>
          )}
        </div>

        {/* Name & Quick Metadata */}
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 break-all leading-snug">
              {node.name}
            </h3>
            <button
              type="button"
              onClick={() => onToggleStar(node)}
              aria-label={node.starred ? 'Retirer des favoris' : 'Ajouter aux favoris'}
              className={`p-1 rounded-md transition-colors shrink-0 ${
                node.starred
                  ? 'text-amber-500 hover:bg-amber-500/10'
                  : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-800'
              }`}
            >
              <Star size={16} className={node.starred ? 'fill-amber-500' : ''} />
            </button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {getTypeLabel(node)} · {isFolder ? `${childCount} éléments` : formatBytes(displaySize)}
            {node.hidden ? ' · Caché' : ''}
          </p>
        </div>

        {/* Action Grid */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onOpen(node)}
            className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors whitespace-nowrap"
          >
            <ExternalLink size={14} />
            {isFolder ? 'Ouvrir' : 'Ouvrir / Éditer'}
          </button>
          <button
            type="button"
            onClick={() => onDownload(node)}
            className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors whitespace-nowrap"
          >
            <Download size={14} />
            Télécharger
          </button>
          <button
            type="button"
            onClick={() => onRename(node)}
            className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors whitespace-nowrap"
          >
            <Pencil size={14} />
            Renommer
          </button>
          <button
            type="button"
            onClick={() => onCompress([node])}
            className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors whitespace-nowrap"
          >
            <Archive size={14} />
            Compresser
          </button>
        </div>

        {/* Detailed POSIX Properties */}
        <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-3 text-xs">
          <div>
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
              <span>Chemin complet</span>
              <button
                type="button"
                onClick={() => copyText(fullPath, 'path')}
                className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
              >
                {copiedField === 'path' ? <Check size={12} /> : <Copy size={12} />}
                {copiedField === 'path' ? 'Copié' : 'Copier'}
              </button>
            </div>
            <div className="font-mono text-[11px] text-slate-800 dark:text-slate-200 break-all bg-white dark:bg-slate-950 px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-800">
              {fullPath}
            </div>
          </div>

          <dl className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Permissions POSIX</dt>
              <dd className="flex items-center gap-2">
                <span className="font-mono text-slate-800 dark:text-slate-200">{node.permissions}</span>
                {!isFolder && (
                  <button
                    type="button"
                    onClick={() => onToggleReadOnly(node)}
                    title={isReadOnly ? 'Autoriser l’écriture' : 'Verrouiller en lecture seule'}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-[11px] text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    {isReadOnly ? <Lock size={11} /> : <Unlock size={11} />}
                    {isReadOnly ? 'Lecture seule' : 'Écriture'}
                  </button>
                )}
              </dd>
            </div>

            <div className="flex items-center justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Taille exacte</dt>
              <dd className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                {formatBytes(displaySize)} ({displaySize.toLocaleString('fr-FR')} o)
              </dd>
            </div>

            <div className="flex items-center justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Type MIME</dt>
              <dd className="font-mono text-slate-800 dark:text-slate-200 truncate max-w-[170px]">
                {node.mimeType}
              </dd>
            </div>

            <div className="flex items-center justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Modifié</dt>
              <dd className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                {formatDate(node.updatedAt)}
              </dd>
            </div>

            <div className="flex items-center justify-between gap-2">
              <dt className="text-slate-500 dark:text-slate-400">Créé</dt>
              <dd className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                {formatDate(node.createdAt)}
              </dd>
            </div>

            {node.meta?.width && node.meta?.height && (
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-500 dark:text-slate-400">Dimensions</dt>
                <dd className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                  {node.meta.width} × {node.meta.height} px
                </dd>
              </div>
            )}

            {node.meta?.camera && (
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-500 dark:text-slate-400">Appareil</dt>
                <dd className="text-slate-800 dark:text-slate-200 text-right">{node.meta.camera}</dd>
              </div>
            )}

            {node.meta?.appBundle && (
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-500 dark:text-slate-400">Identifiant iOS</dt>
                <dd className="font-mono text-slate-800 dark:text-slate-200 truncate max-w-[165px]">
                  {node.meta.appBundle}
                </dd>
              </div>
            )}
          </dl>

          {!isFolder && (
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
                <span>Empreinte SHA-256</span>
                {sha256 && (
                  <button
                    type="button"
                    onClick={() => copyText(sha256, 'hash')}
                    className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {copiedField === 'hash' ? <Check size={12} /> : <Copy size={12} />}
                    {copiedField === 'hash' ? 'Copié' : 'Copier'}
                  </button>
                )}
              </div>
              <div className="font-mono text-[10px] leading-relaxed text-slate-600 dark:text-slate-400 break-all bg-white dark:bg-slate-950 px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-800">
                {loadingHash ? 'Calcul en cours...' : sha256 || 'Non disponible'}
              </div>
            </div>
          )}
        </div>

        {/* Destructive zone */}
        {node.parentId !== null && (
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => onDelete([node])}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
            >
              <Trash2 size={14} />
              {node.trashed ? 'Supprimer définitivement' : 'Déplacer dans la corbeille'}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
