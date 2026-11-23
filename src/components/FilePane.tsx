import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowUp,
  Eye,
  File as FileOutlineIcon,
  FileArchive,
  Folder,
  FolderPlus,
  Pencil,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  FSNode,
  FileCategory,
  SidebarSection,
  SortDirection,
  SortField,
  ViewMode,
} from '../types/fs';
import {
  computeFolderSize,
  formatBytes,
  getExtension,
  getFileCategory,
  getPosixPath,
  getTypeLabel,
} from '../lib/fsUtils';
import { resolveNodeBlob } from '../lib/fsDb';

interface RowThumbProps {
  node: FSNode;
  compact?: boolean;
}

function RowThumb({ node, compact = false }: RowThumbProps) {
  const [url, setUrl] = useState<string | null>(node.assetUrl || null);
  const [failed, setFailed] = useState(false);
  const isImage = node.kind === 'file' && getFileCategory(node) === 'image';
  const ext = getExtension(node.name);
  const isZip = ext === 'zip' || node.mimeType.includes('zip');

  useEffect(() => {
    setFailed(false);
    if (!isImage) {
      setUrl(null);
      return;
    }
    if (node.assetUrl) {
      setUrl(node.assetUrl);
      return;
    }
    let revoked: string | null = null;
    let cancelled = false;
    resolveNodeBlob(node).then((blob) => {
      if (!blob || cancelled) return;
      revoked = URL.createObjectURL(blob);
      setUrl(revoked);
    });
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [node, isImage]);

  if (node.kind === 'folder') {
    return (
      <div
        className={`${compact ? 'w-10 h-10' : 'w-14 h-11'} flex items-center justify-center shrink-0`}
      >
        <Folder
          size={compact ? 26 : 28}
          strokeWidth={1.6}
          className="text-[#1A65C7] fill-[#1A65C7]/90 dark:text-blue-400 dark:fill-blue-400/85"
        />
      </div>
    );
  }

  if (isImage && url && !failed) {
    return (
      <div
        className={`${compact ? 'w-11 h-9' : 'w-16 h-12'} rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800 shrink-0`}
      >
        <img
          src={url}
          alt={node.name}
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setFailed(true)}
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  if (isZip) {
    return (
      <div
        className={`${compact ? 'w-10 h-10' : 'w-14 h-11'} flex items-center justify-center shrink-0`}
      >
        <FileArchive
          size={compact ? 24 : 26}
          strokeWidth={1.6}
          className="text-[#1A65C7] fill-[#1A65C7]/15 dark:text-blue-400"
        />
      </div>
    );
  }

  return (
    <div
      className={`${compact ? 'w-10 h-10' : 'w-16 h-12'} flex items-center justify-center shrink-0`}
    >
      <FileOutlineIcon
        size={compact ? 22 : 28}
        strokeWidth={1.4}
        className="text-slate-400 dark:text-slate-500"
      />
    </div>
  );
}

interface FilePaneProps {
  paneId: 'primary' | 'secondary';
  panePrefix: string;
  paneTitlePath: string;
  isActivePane: boolean;
  isSplitMode: boolean;
  section: SidebarSection;
  folderId: string;
  canGoBack: boolean;
  canGoForward: boolean;
  allNodes: FSNode[];
  nodeMap: Record<string, FSNode>;
  selectedIds: string[];
  cutNodeIds: string[];
  viewMode: ViewMode;
  sortField: SortField;
  sortDirection: SortDirection;
  searchQuery: string;
  categoryFilter: FileCategory;
  showHidden: boolean;
  loading: boolean;
  primaryActionLabel?: string;
  primaryActionDisabled?: boolean;
  onPrimaryAction?: () => void;
  headerActionLabel?: string;
  onHeaderAction?: () => void;
  onFocusPane: () => void;
  onNavigateFolder: (folderId: string) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onGoParent: () => void;
  onSubmitPosixPath: (rawPath: string) => void;
  onSelectIds: (ids: string[]) => void;
  onOpenNode: (node: FSNode) => void;
  onInspectNode: (node: FSNode) => void;
  onRenameNode: (node: FSNode) => void;
  onDownloadNode: (node: FSNode) => void;
  onDeleteNodes: (nodes: FSNode[]) => void;
  onRestoreNodes: (nodes: FSNode[]) => void;
  onEmptyTrash: () => void;
  onToggleStar: (node: FSNode) => void;
  onDropExternalFiles: (dataTransfer: DataTransfer, targetFolderId: string) => void;
  onMoveNodesToFolder: (nodeIds: string[], targetFolderId: string) => void;
  onSortChange: (field: SortField) => void;
  onTriggerImport: () => void;
  onTriggerNewFolder: () => void;
}

export function FilePane({
  paneId,
  panePrefix,
  paneTitlePath,
  isSplitMode,
  section,
  folderId,
  canGoBack,
  allNodes,
  nodeMap,
  selectedIds,
  cutNodeIds,
  sortField,
  sortDirection,
  searchQuery,
  categoryFilter,
  showHidden,
  loading,
  primaryActionLabel,
  primaryActionDisabled,
  onPrimaryAction,
  headerActionLabel,
  onHeaderAction,
  onFocusPane,
  onGoBack,
  onGoParent,
  onSelectIds,
  onOpenNode,
  onRenameNode,
  onDeleteNodes,
  onRestoreNodes,
  onEmptyTrash,
  onDropExternalFiles,
  onMoveNodesToFolder,
  onTriggerImport,
  onTriggerNewFolder,
}: FilePaneProps) {
  const [isDragOverPane, setIsDragOverPane] = useState(false);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);

  const currentFolder = nodeMap[folderId];
  const isGlobalBrowse = section !== 'browser' && paneId === 'primary';
  const query = searchQuery.trim().toLowerCase();
  const isPcPane = paneId === 'secondary';

  const visibleNodes = useMemo(() => {
    let list: FSNode[];

    if (isGlobalBrowse) {
      if (section === 'trash') {
        list = allNodes.filter((n) => n.trashed);
      } else if (section === 'favorites') {
        list = allNodes.filter((n) => !n.trashed && n.starred);
      } else {
        list = allNodes
          .filter((n) => !n.trashed && n.kind === 'file')
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 30);
      }
    } else if (query && paneId === 'primary') {
      list = allNodes.filter(
        (n) => !n.trashed && n.parentId !== null && n.name.toLowerCase().includes(query)
      );
    } else {
      list = allNodes.filter((n) => !n.trashed && n.parentId === folderId);
    }

    if (!showHidden && section !== 'trash') {
      list = list.filter((n) => !n.hidden && !n.name.startsWith('.'));
    }

    if (query && isGlobalBrowse) {
      list = list.filter((n) => n.name.toLowerCase().includes(query));
    }

    if (categoryFilter !== 'all' && paneId === 'primary') {
      list = list.filter((n) => n.kind === 'file' && getFileCategory(n) === categoryFilter);
    }

    return [...list].sort((a, b) => {
      if (section !== 'recents' && a.kind !== b.kind) {
        return a.kind === 'folder' ? -1 : 1;
      }

      let cmp = 0;
      if (sortField === 'name') {
        cmp = a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' });
      } else if (sortField === 'size') {
        const sizeA = a.kind === 'folder' ? computeFolderSize(a.id, allNodes) : a.size;
        const sizeB = b.kind === 'folder' ? computeFolderSize(b.id, allNodes) : b.size;
        cmp = sizeA - sizeB;
      } else if (sortField === 'updatedAt') {
        cmp = a.updatedAt - b.updatedAt;
      } else if (sortField === 'type') {
        cmp = getTypeLabel(a).localeCompare(getTypeLabel(b));
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [
    allNodes,
    folderId,
    isGlobalBrowse,
    section,
    query,
    paneId,
    showHidden,
    categoryFilter,
    sortField,
    sortDirection,
  ]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const cutSet = useMemo(() => new Set(cutNodeIds), [cutNodeIds]);

  const handleRowClick = (node: FSNode, e: React.MouseEvent) => {
    onFocusPane();
    if (e.metaKey || e.ctrlKey) {
      if (selectedSet.has(node.id)) {
        onSelectIds(selectedIds.filter((id) => id !== node.id));
      } else {
        onSelectIds([...selectedIds, node.id]);
      }
      return;
    }
    if (e.shiftKey && selectedIds.length > 0) {
      const lastId = selectedIds[selectedIds.length - 1];
      const idxA = visibleNodes.findIndex((n) => n.id === lastId);
      const idxB = visibleNodes.findIndex((n) => n.id === node.id);
      if (idxA !== -1 && idxB !== -1) {
        const [start, end] = idxA < idxB ? [idxA, idxB] : [idxB, idxA];
        onSelectIds(visibleNodes.slice(start, end + 1).map((n) => n.id));
        return;
      }
    }
    onSelectIds([node.id]);
  };

  const handleDragStartNode = (node: FSNode, e: React.DragEvent) => {
    const idsToMove = selectedSet.has(node.id) ? selectedIds : [node.id];
    e.dataTransfer.setData('application/x-openfs-nodes', JSON.stringify(idsToMove));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handlePaneDragOver = (e: React.DragEvent) => {
    if (section === 'trash') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes('application/x-openfs-nodes')
      ? 'move'
      : 'copy';
    setIsDragOverPane(true);
  };

  const handlePaneDrop = (e: React.DragEvent) => {
    if (section === 'trash') return;
    e.preventDefault();
    setIsDragOverPane(false);
    setDragOverFolderId(null);

    const internalPayload = e.dataTransfer.getData('application/x-openfs-nodes');
    if (internalPayload) {
      try {
        const nodeIds = JSON.parse(internalPayload) as string[];
        if (Array.isArray(nodeIds) && nodeIds.length > 0) {
          onMoveNodesToFolder(nodeIds, folderId);
        }
      } catch {
        // Ignore malformed drag payload
      }
      return;
    }

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onDropExternalFiles(e.dataTransfer, folderId);
    }
  };

  const handleFolderRowDrop = (targetFolder: FSNode, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOverPane(false);
    setDragOverFolderId(null);

    const internalPayload = e.dataTransfer.getData('application/x-openfs-nodes');
    if (internalPayload) {
      try {
        const nodeIds = JSON.parse(internalPayload) as string[];
        if (Array.isArray(nodeIds) && nodeIds.length > 0) {
          onMoveNodesToFolder(nodeIds, targetFolder.id);
        }
      } catch {
        // Ignore malformed payload
      }
      return;
    }
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onDropExternalFiles(e.dataTransfer, targetFolder.id);
    }
  };

  const sectionTitle =
    section === 'trash'
      ? 'Corbeille'
      : section === 'favorites'
        ? 'Favoris'
        : section === 'recents'
          ? 'Récents'
          : '';

  return (
    <div
      onClick={onFocusPane}
      onDragOver={handlePaneDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setIsDragOverPane(false);
        }
      }}
      onDrop={handlePaneDrop}
      className={`flex flex-col flex-1 min-w-0 h-full relative ${
        isSplitMode && paneId === 'primary'
          ? 'border-r border-slate-200/80 dark:border-slate-800'
          : ''
      }`}
    >
      {/* Clean Column Header matching Reference 02 */}
      <div className="px-6 pt-5 pb-3.5 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {!isGlobalBrowse && currentFolder?.parentId !== null && (
            <button
              type="button"
              onClick={canGoBack ? onGoBack : onGoParent}
              title="Dossier précédent"
              aria-label="Dossier précédent"
              className="p-1 -ml-1 rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
            >
              {canGoBack ? <ArrowLeft size={15} /> : <ArrowUp size={15} />}
            </button>
          )}

          {isGlobalBrowse ? (
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
              {sectionTitle}
            </h2>
          ) : (
            <h2 className="text-base tracking-tight truncate">
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {panePrefix}
              </span>
              <span className="mx-2 text-slate-400">·</span>
              <span className="font-normal text-slate-700 dark:text-slate-300">
                {paneTitlePath}
              </span>
            </h2>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {headerActionLabel && onHeaderAction && (
            <button
              type="button"
              onClick={onHeaderAction}
              className="text-xs font-medium text-[#1A65C7] dark:text-blue-400 hover:underline whitespace-nowrap"
            >
              {headerActionLabel}
            </button>
          )}

          {section === 'trash' && visibleNodes.length > 0 && (
            <button
              type="button"
              onClick={onEmptyTrash}
              className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline whitespace-nowrap"
            >
              Vider la corbeille
            </button>
          )}
        </div>
      </div>

      {/* Primary Right-Pane Action Button ("Copier vers PC") matching Reference 02 */}
      {primaryActionLabel && onPrimaryAction && (
        <div className="px-6 pb-3.5 shrink-0">
          <button
            type="button"
            disabled={primaryActionDisabled}
            onClick={onPrimaryAction}
            className="w-full py-2.5 px-4 rounded-lg bg-[#1A65C7] hover:bg-[#1557B0] disabled:opacity-50 text-white text-sm font-medium transition-colors"
          >
            {primaryActionLabel}
          </button>
        </div>
      )}

      {/* Clean Scrollable Card-Row List matching Reference 02 */}
      <div className="flex-1 overflow-y-auto px-6 pb-6 relative">
        {loading ? (
          <div className="space-y-2.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-16 rounded-xl bg-slate-100 dark:bg-slate-900 animate-pulse"
              />
            ))}
          </div>
        ) : visibleNodes.length === 0 ? (
          <div className="h-full min-h-[240px] flex flex-col items-center justify-center p-6 text-center">
            <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {section === 'trash'
                ? 'La corbeille est vide'
                : query
                  ? 'Aucun fichier trouvé'
                  : 'Ce dossier est vide'}
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-xs">
              {section === 'trash'
                ? 'Les éléments supprimés apparaîtront ici.'
                : query
                  ? 'Essayez un autre nom de fichier.'
                  : 'Glissez des fichiers ici ou créez un nouveau dossier.'}
            </p>
            {section === 'browser' && !query && (
              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={onTriggerImport}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-[#1A65C7] text-white hover:bg-[#1557B0] transition-colors"
                >
                  <Upload size={13} />
                  Importer
                </button>
                <button
                  type="button"
                  onClick={onTriggerNewFolder}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                  <FolderPlus size={13} />
                  Nouveau dossier
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2.5">
            {visibleNodes.map((node) => {
              const isSelected = selectedSet.has(node.id);
              const isCut = cutSet.has(node.id);
              const isFolder = node.kind === 'folder';
              const isDropTarget = dragOverFolderId === node.id;

              return (
                <div
                  key={node.id}
                  draggable={section !== 'trash'}
                  onDragStart={(e) => handleDragStartNode(node, e)}
                  onDragOver={(e) => {
                    if (isFolder && section !== 'trash') {
                      e.preventDefault();
                      e.stopPropagation();
                      setDragOverFolderId(node.id);
                    }
                  }}
                  onDragLeave={() => {
                    if (dragOverFolderId === node.id) setDragOverFolderId(null);
                  }}
                  onDrop={(e) => isFolder && handleFolderRowDrop(node, e)}
                  onClick={(e) => handleRowClick(node, e)}
                  onDoubleClick={() => onOpenNode(node)}
                  className={`group rounded-xl border px-3.5 ${
                    isPcPane ? 'py-3' : 'py-2.5'
                  } flex items-center justify-between gap-3.5 transition-colors cursor-pointer select-none ${
                    isDropTarget
                      ? 'border-[#1A65C7] bg-blue-50/70 dark:bg-blue-950/35'
                      : isSelected
                        ? 'border-[#1A65C7] bg-blue-50/40 dark:bg-blue-950/25 ring-1 ring-[#1A65C7]/15'
                        : 'border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                  } ${isCut ? 'opacity-45' : ''}`}
                >
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    <RowThumb node={node} compact={isPcPane} />

                    <div className="min-w-0 flex-1">
                      <div
                        className={`text-sm font-medium truncate ${
                          node.hidden
                            ? 'text-slate-600 dark:text-slate-400'
                            : 'text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {node.name}
                      </div>

                      {!isFolder && (
                        <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
                          {formatBytes(node.size)}
                        </div>
                      )}

                      {(query || isGlobalBrowse) && node.parentId && (
                        <div className="text-[11px] font-mono text-slate-400 dark:text-slate-500 truncate mt-0.5">
                          {getPosixPath(node.parentId, nodeMap)}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Subtle hover actions */}
                  <div
                    className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {section === 'trash' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => onRestoreNodes([node])}
                          title="Restaurer"
                          aria-label={`Restaurer ${node.name}`}
                          className="p-1.5 rounded-md text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                        >
                          <RotateCcw size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteNodes([node])}
                          title="Supprimer définitivement"
                          aria-label={`Supprimer définitivement ${node.name}`}
                          className="p-1.5 rounded-md text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    ) : (
                      <>
                        {!isFolder && (
                          <button
                            type="button"
                            onClick={() => onOpenNode(node)}
                            title="Aperçu et inspecteur"
                            aria-label={`Ouvrir ${node.name}`}
                            className="p-1.5 rounded-md text-slate-500 hover:text-[#1A65C7] hover:bg-blue-50 dark:hover:bg-blue-950/40"
                          >
                            <Eye size={14} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onRenameNode(node)}
                          title="Renommer"
                          aria-label={`Renommer ${node.name}`}
                          className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteNodes([node])}
                          title="Supprimer"
                          aria-label={`Supprimer ${node.name}`}
                          className="p-1.5 rounded-md text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Drag & Drop Overlay */}
        {isDragOverPane && section !== 'trash' && (
          <div className="pointer-events-none absolute inset-4 z-20 rounded-xl border-2 border-dashed border-[#1A65C7] bg-blue-500/5 flex flex-col items-center justify-center gap-2 backdrop-blur-[1px]">
            <Upload size={24} className="text-[#1A65C7] dark:text-blue-400" />
            <p className="text-sm font-medium text-[#1A65C7] dark:text-blue-300">
              Déposer dans {currentFolder?.name || 'ce dossier'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
