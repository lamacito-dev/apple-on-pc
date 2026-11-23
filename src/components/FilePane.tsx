import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  Download,
  FolderInput,
  FolderPlus,
  Info,
  Pencil,
  RotateCcw,
  Star,
  Terminal,
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
  buildPathNodes,
  computeFolderSize,
  formatBytes,
  formatShortDate,
  getFileCategory,
  getPosixPath,
  getTypeLabel,
} from '../lib/fsUtils';
import { resolveNodeBlob } from '../lib/fsDb';
import { FileIcon } from './FileIcon';

interface GridThumbnailProps {
  node: FSNode;
}

function GridThumbnail({ node }: GridThumbnailProps) {
  const [url, setUrl] = useState<string | null>(node.assetUrl || null);
  const [failed, setFailed] = useState(false);
  const isImage = node.kind === 'file' && getFileCategory(node) === 'image';

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

  if (isImage && url && !failed) {
    return (
      <div className="aspect-4/3 w-full rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800 border border-slate-200/70 dark:border-slate-700/60">
        <img
          src={url}
          alt={node.name}
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setFailed(true)}
          className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
        />
      </div>
    );
  }

  return (
    <div className="aspect-4/3 w-full rounded-lg flex flex-col items-center justify-center gap-1.5 bg-slate-100/80 dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800">
      <FileIcon node={node} size={32} />
      <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500">
        {getTypeLabel(node)}
      </span>
    </div>
  );
}

interface FilePaneProps {
  paneId: 'primary' | 'secondary';
  paneLabel?: string;
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
  paneLabel,
  isActivePane,
  isSplitMode,
  section,
  folderId,
  canGoBack,
  canGoForward,
  allNodes,
  nodeMap,
  selectedIds,
  cutNodeIds,
  viewMode,
  sortField,
  sortDirection,
  searchQuery,
  categoryFilter,
  showHidden,
  loading,
  onFocusPane,
  onNavigateFolder,
  onGoBack,
  onGoForward,
  onGoParent,
  onSubmitPosixPath,
  onSelectIds,
  onOpenNode,
  onInspectNode,
  onRenameNode,
  onDownloadNode,
  onDeleteNodes,
  onRestoreNodes,
  onEmptyTrash,
  onToggleStar,
  onDropExternalFiles,
  onMoveNodesToFolder,
  onSortChange,
  onTriggerImport,
  onTriggerNewFolder,
}: FilePaneProps) {
  const [editingPath, setEditingPath] = useState(false);
  const [pathDraft, setPathDraft] = useState('');
  const [isDragOverPane, setIsDragOverPane] = useState(false);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);

  const currentFolder = nodeMap[folderId];
  const breadcrumbs = useMemo(() => buildPathNodes(folderId, nodeMap), [folderId, nodeMap]);
  const posixPath = useMemo(() => getPosixPath(folderId, nodeMap), [folderId, nodeMap]);

  const isGlobalBrowse = section !== 'browser' && paneId === 'primary';
  const query = searchQuery.trim().toLowerCase();

  const visibleNodes = useMemo(() => {
    let list: FSNode[];

    if (isGlobalBrowse) {
      if (section === 'trash') {
        list = allNodes.filter((n) => n.trashed);
      } else if (section === 'favorites') {
        list = allNodes.filter((n) => !n.trashed && n.starred);
      } else {
        // recents
        list = allNodes
          .filter((n) => !n.trashed && n.kind === 'file')
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 30);
      }
    } else if (query && paneId === 'primary') {
      // Global live search across all non-trashed nodes
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

    const sorted = [...list].sort((a, b) => {
      // Folders always stay grouped above files unless in recents
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

    return sorted;
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
  const allVisibleSelected =
    visibleNodes.length > 0 && visibleNodes.every((n) => selectedSet.has(n.id));

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      onSelectIds([]);
    } else {
      onSelectIds(visibleNodes.map((n) => n.id));
    }
  };

  const handleRowClick = (node: FSNode, e: React.MouseEvent) => {
    onFocusPane();
    if (e.metaKey || e.ctrlKey) {
      if (selectedSet.has(node.id)) {
        onSelectIds(selectedIds.filter((id) => id !== node.id));
      } else {
        onSelectIds([...selectedIds, node.id]);
      }
    } else if (e.shiftKey && selectedIds.length > 0) {
      const lastId = selectedIds[selectedIds.length - 1];
      const idxA = visibleNodes.findIndex((n) => n.id === lastId);
      const idxB = visibleNodes.findIndex((n) => n.id === node.id);
      if (idxA !== -1 && idxB !== -1) {
        const [start, end] = idxA < idxB ? [idxA, idxB] : [idxB, idxA];
        onSelectIds(visibleNodes.slice(start, end + 1).map((n) => n.id));
        return;
      }
      onSelectIds([node.id]);
    } else {
      onSelectIds([node.id]);
    }
  };

  const toggleCheckbox = (nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onFocusPane();
    if (selectedSet.has(nodeId)) {
      onSelectIds(selectedIds.filter((id) => id !== nodeId));
    } else {
      onSelectIds([...selectedIds, nodeId]);
    }
  };

  const handleStartEditPath = () => {
    setPathDraft(posixPath);
    setEditingPath(true);
  };

  const handlePathFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setEditingPath(false);
    onSubmitPosixPath(pathDraft);
  };

  // Drag & drop handlers
  const handleDragStartNode = (node: FSNode, e: React.DragEvent) => {
    const idsToDrag = selectedSet.has(node.id) ? selectedIds : [node.id];
    e.dataTransfer.setData('application/x-openfs-nodes', JSON.stringify(idsToDrag));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handlePaneDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (section === 'trash') return;
    if (!isDragOverPane) setIsDragOverPane(true);
  };

  const handlePaneDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOverPane(false);
      setDragOverFolderId(null);
    }
  };

  const handlePaneDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverPane(false);
    setDragOverFolderId(null);
    if (section === 'trash') return;

    const internalRaw = e.dataTransfer.getData('application/x-openfs-nodes');
    if (internalRaw) {
      try {
        const ids = JSON.parse(internalRaw) as string[];
        if (ids.length > 0) {
          onMoveNodesToFolder(ids, folderId);
        }
      } catch {
        // ignore
      }
      return;
    }

    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      onDropExternalFiles(e.dataTransfer, folderId);
    }
  };

  const handleFolderRowDrop = (targetFolder: FSNode, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOverPane(false);
    setDragOverFolderId(null);
    if (targetFolder.kind !== 'folder') return;

    const internalRaw = e.dataTransfer.getData('application/x-openfs-nodes');
    if (internalRaw) {
      try {
        const ids = JSON.parse(internalRaw) as string[];
        if (ids.length > 0 && !ids.includes(targetFolder.id)) {
          onMoveNodesToFolder(ids, targetFolder.id);
        }
      } catch {
        // ignore
      }
      return;
    }

    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      onDropExternalFiles(e.dataTransfer, targetFolder.id);
    }
  };

  const sectionTitle =
    section === 'recents'
      ? 'Fichiers récents'
      : section === 'favorites'
        ? 'Favoris'
        : section === 'trash'
          ? 'Corbeille'
          : '';

  return (
    <div
      onClick={onFocusPane}
      onDragOver={handlePaneDragOver}
      onDragLeave={handlePaneDragLeave}
      onDrop={handlePaneDrop}
      className={`flex-1 flex flex-col min-w-0 h-full relative bg-white dark:bg-slate-950 ${
        isSplitMode && paneId === 'secondary'
          ? 'border-l border-slate-200 dark:border-slate-800'
          : ''
      }`}
    >
      {/* Pane Navigation & Breadcrumb / Editable POSIX Path Bar */}
      <div
        className={`flex items-center gap-2 px-3 sm:px-4 h-12 border-b shrink-0 transition-colors ${
          isSplitMode && isActivePane
            ? 'border-blue-600/40 dark:border-blue-500/40 bg-blue-50/30 dark:bg-blue-950/15'
            : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950'
        }`}
      >
        {!isGlobalBrowse ? (
          <>
            {paneLabel && isSplitMode && (
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 pr-2 border-r border-slate-200 dark:border-slate-800 whitespace-nowrap shrink-0">
                {paneLabel}
              </span>
            )}
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={onGoBack}
                disabled={!canGoBack}
                title="Précédent"
                aria-label="Dossier précédent"
                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors"
              >
                <ArrowLeft size={16} />
              </button>
              <button
                type="button"
                onClick={onGoForward}
                disabled={!canGoForward}
                title="Suivant"
                aria-label="Dossier suivant"
                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors"
              >
                <ArrowRight size={16} />
              </button>
              <button
                type="button"
                onClick={onGoParent}
                disabled={!currentFolder?.parentId}
                title="Dossier parent (..)"
                aria-label="Remonter au dossier parent"
                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors"
              >
                <ArrowUp size={16} />
              </button>
            </div>

            {editingPath ? (
              <form onSubmit={handlePathFormSubmit} className="flex-1 min-w-0">
                <input
                  type="text"
                  value={pathDraft}
                  onChange={(e) => setPathDraft(e.target.value)}
                  onBlur={() => setEditingPath(false)}
                  autoFocus
                  aria-label="Saisir un chemin POSIX"
                  className="w-full px-2.5 py-1 text-xs font-mono rounded-md border border-blue-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none"
                />
              </form>
            ) : (
              <div className="flex-1 flex items-center gap-1 min-w-0 overflow-x-auto no-scrollbar py-1">
                {breadcrumbs.map((crumb, index) => {
                  const isLast = index === breadcrumbs.length - 1;
                  return (
                    <React.Fragment key={crumb.id}>
                      {index > 0 && (
                        <ChevronRight size={13} className="shrink-0 text-slate-400 dark:text-slate-600" />
                      )}
                      <button
                        type="button"
                        onClick={() => onNavigateFolder(crumb.id)}
                        className={`px-1.5 py-0.5 text-xs rounded-md transition-colors whitespace-nowrap shrink-0 ${
                          isLast
                            ? 'font-semibold text-slate-900 dark:text-slate-100'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        {crumb.name}
                      </button>
                    </React.Fragment>
                  );
                })}
              </div>
            )}

            <button
              type="button"
              onClick={handleStartEditPath}
              title="Saisir un chemin POSIX (/var/mobile/...)"
              aria-label="Éditer le chemin POSIX"
              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
            >
              <Terminal size={14} />
            </button>
          </>
        ) : (
          <div className="flex items-center justify-between w-full gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                {sectionTitle}
              </span>
              <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                · {visibleNodes.length} élément{visibleNodes.length > 1 ? 's' : ''}
              </span>
            </div>
            {section === 'trash' && visibleNodes.length > 0 && (
              <button
                type="button"
                onClick={onEmptyTrash}
                className="px-3 py-1.5 text-xs font-medium rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors whitespace-nowrap shrink-0"
              >
                Vider la corbeille
              </button>
            )}
          </div>
        )}
      </div>

      {/* Global Search context hint */}
      {query && paneId === 'primary' && !isGlobalBrowse && (
        <div className="px-4 py-2 text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <span>
            Résultats dans toute l’arborescence pour «{' '}
            <strong className="font-semibold text-slate-900 dark:text-slate-100">{searchQuery}</strong> »
          </span>
          <span className="font-mono tabular-nums">{visibleNodes.length} trouvé(s)</span>
        </div>
      )}

      {/* Main Scrollable File Area */}
      <div className="flex-1 overflow-y-auto relative">
        {loading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <div
                key={i}
                className="h-10 rounded-lg bg-slate-100 dark:bg-slate-900 animate-pulse"
              />
            ))}
          </div>
        ) : visibleNodes.length === 0 ? (
          <div className="h-full min-h-[280px] flex flex-col items-center justify-center p-8 text-center">
            <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-center mb-3 text-slate-400 dark:text-slate-500">
              <FolderInput size={22} />
            </div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {section === 'trash'
                ? 'La corbeille est vide'
                : query
                  ? 'Aucun fichier correspondant'
                  : 'Ce dossier est vide'}
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-xs leading-relaxed">
              {section === 'trash'
                ? 'Les fichiers supprimés apparaîtront ici avant effacement définitif.'
                : query
                  ? 'Essayez une autre extension (.jpg, .plist, .zip) ou activez les fichiers cachés.'
                  : 'Glissez-déposez des fichiers depuis votre appareil ou créez un nouveau dossier.'}
            </p>
            {section === 'browser' && !query && (
              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={onTriggerImport}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors whitespace-nowrap"
                >
                  <Upload size={14} />
                  Importer des fichiers
                </button>
                <button
                  type="button"
                  onClick={onTriggerNewFolder}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
                >
                  <FolderPlus size={14} />
                  Nouveau dossier
                </button>
              </div>
            )}
          </div>
        ) : viewMode === 'list' ? (
          <table className="w-full text-left border-collapse select-none">
            <thead className="sticky top-0 z-10 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur-xs border-b border-slate-200 dark:border-slate-800">
              <tr className="text-xs font-medium text-slate-500 dark:text-slate-400">
                <th className="w-10 py-2.5 pl-4 pr-1">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleSelectAll}
                    aria-label="Tout sélectionner"
                    className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-600 cursor-pointer"
                  />
                </th>
                <th className="py-2.5 px-2">
                  <button
                    type="button"
                    onClick={() => onSortChange('name')}
                    className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
                  >
                    Nom
                    {sortField === 'name' && (
                      <span className="font-mono text-[10px]">
                        {sortDirection === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </button>
                </th>
                <th className="hidden sm:table-cell py-2.5 px-2 w-24">
                  <button
                    type="button"
                    onClick={() => onSortChange('type')}
                    className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
                  >
                    Type
                    {sortField === 'type' && (
                      <span className="font-mono text-[10px]">
                        {sortDirection === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </button>
                </th>
                <th className="py-2.5 px-2 w-24 text-right">
                  <button
                    type="button"
                    onClick={() => onSortChange('size')}
                    className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
                  >
                    Taille
                    {sortField === 'size' && (
                      <span className="font-mono text-[10px]">
                        {sortDirection === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </button>
                </th>
                <th className="hidden md:table-cell py-2.5 px-2 w-36 text-right">
                  <button
                    type="button"
                    onClick={() => onSortChange('updatedAt')}
                    className="inline-flex items-center gap-1 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
                  >
                    Modifié
                    {sortField === 'updatedAt' && (
                      <span className="font-mono text-[10px]">
                        {sortDirection === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </button>
                </th>
                {!isSplitMode && (
                  <th className="hidden xl:table-cell py-2.5 px-2 w-28 text-right">Droits</th>
                )}
                <th className="py-2.5 pl-2 pr-4 w-28 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 text-sm">
              {visibleNodes.map((node) => {
                const isSelected = selectedSet.has(node.id);
                const isCut = cutSet.has(node.id);
                const isFolder = node.kind === 'folder';
                const folderChildCount = isFolder
                  ? allNodes.filter((n) => n.parentId === node.id && !n.trashed).length
                  : 0;
                const isDropTarget = dragOverFolderId === node.id;

                return (
                  <tr
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
                    className={`group h-11 transition-colors cursor-pointer ${
                      isDropTarget
                        ? 'bg-blue-600/15 dark:bg-blue-500/20'
                        : isSelected
                          ? 'bg-blue-50/90 dark:bg-blue-950/35'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-900/60'
                    } ${isCut ? 'opacity-45' : ''}`}
                  >
                    <td className="pl-4 pr-1" onClick={(e) => toggleCheckbox(node.id, e)}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        aria-label={`Sélectionner ${node.name}`}
                        className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-600 cursor-pointer"
                      />
                    </td>

                    <td className="px-2 py-2 max-w-[200px] sm:max-w-[320px]">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileIcon node={node} size={18} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`truncate text-sm ${
                                isFolder
                                  ? 'font-medium text-slate-900 dark:text-slate-100'
                                  : 'text-slate-800 dark:text-slate-200'
                              } ${node.hidden ? 'text-slate-500 dark:text-slate-400' : ''}`}
                            >
                              {node.name}
                            </span>
                            {node.starred && (
                              <Star
                                size={12}
                                className="shrink-0 text-amber-500 fill-amber-500"
                              />
                            )}
                          </div>
                          {(query || isGlobalBrowse) && node.parentId && (
                            <div className="text-[11px] font-mono text-slate-400 dark:text-slate-500 truncate">
                              {getPosixPath(node.parentId, nodeMap)}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="hidden sm:table-cell px-2 py-2 text-xs font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {getTypeLabel(node)}
                    </td>

                    <td className="px-2 py-2 text-xs font-mono tabular-nums text-right text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {isFolder ? `${folderChildCount} élém.` : formatBytes(node.size)}
                    </td>

                    <td className="hidden md:table-cell px-2 py-2 text-xs font-mono tabular-nums text-right text-slate-500 dark:text-slate-400 whitespace-nowrap">
                      {formatShortDate(node.updatedAt)}
                    </td>

                    {!isSplitMode && (
                      <td className="hidden xl:table-cell px-2 py-2 text-xs font-mono text-right text-slate-400 dark:text-slate-500 whitespace-nowrap">
                        {node.permissions}
                      </td>
                    )}

                    <td
                      className="pl-2 pr-4 py-1 text-right whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="inline-flex items-center gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity">
                        {section === 'trash' ? (
                          <>
                            <button
                              type="button"
                              onClick={() => onRestoreNodes([node])}
                              title="Restaurer"
                              aria-label={`Restaurer ${node.name}`}
                              className="p-1.5 rounded-md text-slate-600 dark:text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                            >
                              <RotateCcw size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteNodes([node])}
                              title="Supprimer définitivement"
                              aria-label={`Supprimer définitivement ${node.name}`}
                              className="p-1.5 rounded-md text-slate-600 dark:text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => onInspectNode(node)}
                              title="Propriétés"
                              aria-label={`Propriétés de ${node.name}`}
                              className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200/70 dark:hover:bg-slate-800"
                            >
                              <Info size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => onRenameNode(node)}
                              title="Renommer"
                              aria-label={`Renommer ${node.name}`}
                              className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200/70 dark:hover:bg-slate-800"
                            >
                              <Pencil size={14} />
                            </button>
                            {!isFolder && (
                              <button
                                type="button"
                                onClick={() => onDownloadNode(node)}
                                title="Télécharger"
                                aria-label={`Télécharger ${node.name}`}
                                className="p-1.5 rounded-md text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                              >
                                <Download size={14} />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          /* Grid View */
          <div
            className={`p-4 grid gap-3.5 ${
              isSplitMode
                ? 'grid-cols-2 lg:grid-cols-3'
                : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
            }`}
          >
            {visibleNodes.map((node) => {
              const isSelected = selectedSet.has(node.id);
              const isCut = cutSet.has(node.id);
              const isFolder = node.kind === 'folder';
              const folderChildCount = isFolder
                ? allNodes.filter((n) => n.parentId === node.id && !n.trashed).length
                : 0;

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
                  className={`group relative rounded-xl p-2.5 border transition-colors cursor-pointer select-none ${
                    dragOverFolderId === node.id
                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/35'
                      : isSelected
                        ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/30'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 hover:border-slate-300 dark:hover:border-slate-700'
                  } ${isCut ? 'opacity-45' : ''}`}
                >
                  {/* Selection checkbox top-left */}
                  <div
                    onClick={(e) => toggleCheckbox(node.id, e)}
                    className={`absolute top-4 left-4 z-10 transition-opacity ${
                      isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {}}
                      aria-label={`Sélectionner ${node.name}`}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 bg-white/90 shadow-xs cursor-pointer"
                    />
                  </div>

                  {/* Favorite toggle top-right */}
                  {section !== 'trash' && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleStar(node);
                      }}
                      aria-label="Favori"
                      className={`absolute top-3.5 right-3.5 z-10 p-1 rounded-md bg-white/85 dark:bg-slate-900/85 backdrop-blur-xs transition-opacity ${
                        node.starred
                          ? 'opacity-100 text-amber-500'
                          : 'opacity-0 group-hover:opacity-100 text-slate-400 hover:text-amber-500'
                      }`}
                    >
                      <Star size={13} className={node.starred ? 'fill-amber-500' : ''} />
                    </button>
                  )}

                  <GridThumbnail node={node} />

                  <div className="mt-2.5 px-0.5 space-y-0.5">
                    <div className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                      {node.name}
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate">
                      {isFolder ? `${folderChildCount} élém.` : formatBytes(node.size)} ·{' '}
                      {getTypeLabel(node)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Drag & Drop Overlay */}
        {isDragOverPane && section !== 'trash' && (
          <div className="pointer-events-none absolute inset-3 z-20 rounded-xl border-2 border-dashed border-blue-600 bg-blue-600/5 dark:bg-blue-500/10 flex flex-col items-center justify-center gap-2 backdrop-blur-[1px]">
            <Upload size={26} className="text-blue-600 dark:text-blue-400" />
            <p className="text-sm font-semibold text-blue-700 dark:text-blue-300">
              Déposer ici pour importer dans {currentFolder?.name || 'ce dossier'}
            </p>
          </div>
        )}
      </div>

      {/* Subtle pane footer summary */}
      <div className="h-8 px-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
        <span>
          {visibleNodes.length} élément{visibleNodes.length > 1 ? 's' : ''}
          {selectedIds.length > 0 ? ` · ${selectedIds.length} sélectionné(s)` : ''}
        </span>
        {!isGlobalBrowse && <span className="truncate max-w-[55%]">{posixPath}</span>}
      </div>
    </div>
  );
}
