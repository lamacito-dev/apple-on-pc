/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import {
  Archive,
  ArrowLeftRight,
  ClipboardPaste,
  Columns2,
  Copy,
  Download,
  Eye,
  EyeOff,
  FilePlus2,
  FolderPlus,
  FolderUp,
  HardDrive,
  Info,
  LayoutGrid,
  List,
  Menu,
  PieChart,
  RotateCcw,
  Scissors,
  Search,
  Trash2,
  Upload,
  Usb,
  X,
} from 'lucide-react';
import type {
  ClipboardState,
  FSNode,
  FileCategory,
  PaneState,
  SidebarSection,
  SortDirection,
  SortField,
  ToastMessage,
  ViewMode,
  VolumeId,
} from './types/fs';
import {
  dbClearAll,
  dbDeleteNodes,
  dbGetAllNodes,
  dbPutBlob,
  dbPutNodes,
  resolveNodeBlob,
} from './lib/fsDb';
import { seedInitialFileSystem } from './lib/seedData';
import {
  createZipFromNodes,
  downloadBlob,
  generateId,
  getDescendantIds,
  inferMimeType,
  readDroppedItems,
  resolvePosixPath,
  type ImportedFileEntry,
} from './lib/fsUtils';
import {
  createSimulatedUsbDevice,
  getAuthorizedUsbDevices,
  pickRealDirectoryHandle,
  requestAppleUsbDevice,
  subscribeUsbHotplug,
  writeBlobToDirectoryHandle,
  type ConnectedUsbDeviceInfo,
  type WritableDirectoryHandle,
} from './lib/webUsbBridge';
import { Sidebar } from './components/Sidebar';
import { FilePane } from './components/FilePane';
import { InspectorPanel } from './components/InspectorPanel';
import { FileViewerModal } from './components/FileViewerModal';
import { StorageAnalyzer } from './components/StorageAnalyzer';
import { UsbBridgeView } from './components/UsbBridgeView';
import { ConfirmDeleteDialog, InputDialog } from './components/Dialogs';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';
import { SalesLandingPage } from './components/SalesLandingPage';

const CATEGORIES: { id: FileCategory; label: string }[] = [
  { id: 'all', label: 'Tous' },
  { id: 'image', label: 'Images' },
  { id: 'document', label: 'Documents' },
  { id: 'code', label: 'Code & Plist' },
  { id: 'archive', label: 'Archives' },
  { id: 'audio', label: 'Audio' },
];

export default function App() {
  const [nodes, setNodes] = useState<FSNode[]>([]);
  const [loading, setLoading] = useState(true);

  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('openfs_theme') === 'dark';
    } catch {
      return false;
    }
  });

  const [appSurface, setAppSurface] = useState<'site' | 'app'>(() => {
    if (typeof window === 'undefined') return 'site';
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (isStandalone || window.location.hash.startsWith('#app')) return 'app';
    return 'site';
  });

  const [activeSection, setActiveSection] = useState<SidebarSection>(() => {
    if (typeof window !== 'undefined' && window.location.hash === '#app/usb') {
      return 'usb_bridge';
    }
    return 'browser';
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Real WebUSB & OS Directory Mount State
  const [usbDevice, setUsbDevice] = useState<ConnectedUsbDeviceInfo | null>(null);
  const [usbError, setUsbError] = useState<string | null>(null);
  const [mountedIphoneDirName, setMountedIphoneDirName] = useState<string | null>(null);
  const [mountedPcDirName, setMountedPcDirName] = useState<string | null>(null);
  const pcDirHandleRef = useRef<WritableDirectoryHandle | null>(null);
  const iphoneDirHandleRef = useRef<WritableDirectoryHandle | null>(null);

  // Dual-pane iPhone (USB-C) <-> Ordinateur (PC / Linux) enabled by default on desktop
  const [splitView, setSplitView] = useState(true);
  const [activePaneId, setActivePaneId] = useState<'primary' | 'secondary'>('primary');
  const [primaryPane, setPrimaryPane] = useState<PaneState>({
    id: 'primary',
    folderId: 'root_internal',
    history: ['root_internal'],
    historyIndex: 0,
    selectedIds: [],
  });
  const [secondaryPane, setSecondaryPane] = useState<PaneState>({
    id: 'secondary',
    folderId: 'root_pc',
    history: ['root_pc'],
    historyIndex: 0,
    selectedIds: [],
  });

  // View & Filtering
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<FileCategory>('all');
  const [showHidden, setShowHidden] = useState(false);

  // Inspector & Viewer
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [mobileInspectorNode, setMobileInspectorNode] = useState<FSNode | null>(null);
  const [viewerNodeId, setViewerNodeId] = useState<string | null>(null);

  // Clipboard (Copy / Cut / Paste)
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null);

  // Dialog states
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<FSNode | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<{ nodes: FSNode[]; permanent: boolean } | null>(
    null
  );

  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  // Apply dark mode class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem('openfs_theme', darkMode ? 'dark' : 'light');
    } catch {
      // ignore storage errors
    }
  }, [darkMode]);

  // Sync hash changes (#app / #app/usb / root website)
  useEffect(() => {
    const syncFromHash = () => {
      const h = window.location.hash;
      if (h.startsWith('#app')) {
        setAppSurface('app');
        if (h === '#app/usb') setActiveSection('usb_bridge');
      } else if (
        h === '' ||
        h === '#top' ||
        h === '#etapes' ||
        h === '#scripts' ||
        h === '#comparatif' ||
        h === '#faq'
      ) {
        setAppSurface('site');
      }
    };
    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  }, []);

  const handleLaunchApp = useCallback((initialSection: 'browser' | 'usb_bridge' = 'browser') => {
    setActiveSection(initialSection);
    setAppSurface('app');
    const nextHash = initialSection === 'usb_bridge' ? '#app/usb' : '#app';
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
    window.scrollTo({ top: 0 });
  }, []);

  const handleReturnToSite = useCallback(() => {
    setAppSurface('site');
    if (window.location.hash.startsWith('#app')) {
      history.pushState(null, '', window.location.pathname + window.location.search);
    }
    window.scrollTo({ top: 0 });
  }, []);

  const pushToast = useCallback((text: string, type: ToastMessage['type'] = 'info') => {
    const id = generateId('toast');
    setToasts((prev) => [...prev.slice(-2), { id, type, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3400);
  }, []);

  // Load or seed IndexedDB (plus ensure root_pc exists for returning users)
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const existing = await dbGetAllNodes();
        if (!active) return;
        if (existing.length > 0) {
          if (!existing.some((n) => n.id === 'root_pc')) {
            const now = Date.now();
            const pcMigration: FSNode[] = [
              {
                id: 'root_pc',
                parentId: null,
                volumeId: 'pc_local',
                name: 'Ordinateur (PC / Linux)',
                kind: 'folder',
                size: 0,
                mimeType: 'inode/directory',
                createdAt: now,
                updatedAt: now,
                permissions: 'rwxr-xr-x',
                hidden: false,
                starred: false,
                trashed: false,
              },
              {
                id: 'dir_pc_exports',
                parentId: 'root_pc',
                volumeId: 'pc_local',
                name: 'Exports_iPhone',
                kind: 'folder',
                size: 0,
                mimeType: 'inode/directory',
                createdAt: now,
                updatedAt: now,
                permissions: 'rwxr-xr-x',
                hidden: false,
                starred: false,
                trashed: false,
              },
            ];
            await dbPutNodes(pcMigration);
            setNodes([...existing, ...pcMigration]);
          } else {
            setNodes(existing);
          }
        } else {
          const seeded = await seedInitialFileSystem();
          if (active) setNodes(seeded);
        }
      } catch {
        const seeded = await seedInitialFileSystem();
        if (active) setNodes(seeded);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Check already-authorized WebUSB Apple devices & listen for USB-C plug/unplug events
  useEffect(() => {
    let cancelled = false;
    getAuthorizedUsbDevices().then((devices) => {
      if (cancelled) return;
      const apple = devices.find((d) => d.isApple) || devices[0];
      if (apple) setUsbDevice(apple);
    });

    const unsub = subscribeUsbHotplug(
      (connected) => {
        setUsbDevice(connected);
        setUsbError(null);
        pushToast(`Appareil USB-C connecté : ${connected.productName}`, 'success');
      },
      (disconnected) => {
        setUsbDevice((curr) =>
          curr && curr.vendorId === disconnected.vendorId && curr.productId === disconnected.productId
            ? null
            : curr
        );
        pushToast(`Appareil USB-C débranché : ${disconnected.productName}`, 'info');
      }
    );

    return () => {
      cancelled = true;
      unsub();
    };
  }, [pushToast]);

  const nodeMap = useMemo(() => {
    const map: Record<string, FSNode> = {};
    for (const n of nodes) {
      map[n.id] = n;
    }
    return map;
  }, [nodes]);

  const activePane = activePaneId === 'primary' ? primaryPane : secondaryPane;
  const setActivePane = activePaneId === 'primary' ? setPrimaryPane : setSecondaryPane;

  const selectedNodes = useMemo(
    () => activePane.selectedIds.map((id) => nodeMap[id]).filter(Boolean),
    [activePane.selectedIds, nodeMap]
  );

  const inspectedNode = useMemo(() => {
    if (selectedNodes.length === 1) return selectedNodes[0];
    return null;
  }, [selectedNodes]);

  const viewerNode = viewerNodeId ? nodeMap[viewerNodeId] || null : null;

  // Navigation helper for either pane
  const navigatePane = useCallback(
    (paneId: 'primary' | 'secondary', nextFolderId: string) => {
      if (!nodeMap[nextFolderId] || nodeMap[nextFolderId].kind !== 'folder') return;
      const setter = paneId === 'primary' ? setPrimaryPane : setSecondaryPane;
      setter((prev) => {
        if (prev.folderId === nextFolderId) return prev;
        const truncated = prev.history.slice(0, prev.historyIndex + 1);
        return {
          ...prev,
          folderId: nextFolderId,
          history: [...truncated, nextFolderId],
          historyIndex: truncated.length,
          selectedIds: [],
        };
      });
    },
    [nodeMap]
  );

  const goBackPane = (paneId: 'primary' | 'secondary') => {
    const setter = paneId === 'primary' ? setPrimaryPane : setSecondaryPane;
    setter((prev) => {
      if (prev.historyIndex <= 0) return prev;
      const idx = prev.historyIndex - 1;
      return { ...prev, folderId: prev.history[idx], historyIndex: idx, selectedIds: [] };
    });
  };

  const goForwardPane = (paneId: 'primary' | 'secondary') => {
    const setter = paneId === 'primary' ? setPrimaryPane : setSecondaryPane;
    setter((prev) => {
      if (prev.historyIndex >= prev.history.length - 1) return prev;
      const idx = prev.historyIndex + 1;
      return { ...prev, folderId: prev.history[idx], historyIndex: idx, selectedIds: [] };
    });
  };

  const goParentPane = (paneId: 'primary' | 'secondary') => {
    const pane = paneId === 'primary' ? primaryPane : secondaryPane;
    const current = nodeMap[pane.folderId];
    if (current?.parentId) {
      navigatePane(paneId, current.parentId);
    }
  };

  const handleSubmitPosixPath = (paneId: 'primary' | 'secondary', rawPath: string) => {
    const foundId = resolvePosixPath(rawPath, nodes, nodeMap);
    if (foundId) {
      navigatePane(paneId, foundId);
    } else {
      pushToast(`Chemin introuvable : ${rawPath}`, 'error');
    }
  };

  const getUniqueName = useCallback(
    (name: string, parentId: string, ignoreId?: string, existingList: FSNode[] = nodes) => {
      const siblings = new Set(
        existingList
          .filter((n) => n.parentId === parentId && !n.trashed && n.id !== ignoreId)
          .map((n) => n.name.toLowerCase())
      );
      if (!siblings.has(name.toLowerCase())) return name;
      const dotIdx = name.lastIndexOf('.');
      const hasExt = dotIdx > 0;
      const base = hasExt ? name.slice(0, dotIdx) : name;
      const ext = hasExt ? name.slice(dotIdx) : '';
      let counter = 2;
      while (siblings.has(`${base} (${counter})${ext}`.toLowerCase())) {
        counter += 1;
      }
      return `${base} (${counter})${ext}`;
    },
    [nodes]
  );

  const getVolumeForFolder = useCallback(
    (folderId: string): VolumeId => {
      return nodeMap[folderId]?.volumeId || 'internal';
    },
    [nodeMap]
  );

  // Sync a file directly to disk if target folder belongs to a mounted real OS directory
  const maybeWriteToRealDisk = useCallback(
    async (fileNode: FSNode, targetVolume: VolumeId) => {
      const handle =
        targetVolume === 'pc_local'
          ? pcDirHandleRef.current
          : targetVolume === 'local_mount'
            ? iphoneDirHandleRef.current
            : null;
      if (!handle || fileNode.kind !== 'file') return false;
      const blob = await resolveNodeBlob(fileNode);
      if (!blob) return false;
      return writeBlobToDirectoryHandle(handle, fileNode.name, blob);
    },
    []
  );

  // Connect real iPhone via WebUSB
  const handleConnectWebUsb = async (appleOnly = true) => {
    setUsbError(null);
    try {
      const device = await requestAppleUsbDevice(appleOnly);
      if (device) {
        setUsbDevice(device);
        pushToast(`Connecté en USB-C : ${device.productName}`, 'success');
      }
    } catch (err) {
      const msg = (err as Error)?.message || 'Impossible d’ouvrir le périphérique USB-C.';
      if ((err as Error)?.name === 'NotFoundError') {
        // User cancelled or no Apple device matched filter
        setActiveSection('usb_bridge');
        setUsbError(
          'Aucun iPhone sélectionné. Assurez-vous qu’il est branché en USB-C, déverrouillé et appairé, ou utilisez le pont Linux/Windows ci-dessous.'
        );
      } else {
        setActiveSection('usb_bridge');
        setUsbError(msg);
      }
    }
  };

  const handleEnableDemoUsb = () => {
    setUsbDevice(createSimulatedUsbDevice());
    setUsbError(null);
    setActiveSection('browser');
    setSplitView(true);
    pushToast('Mode aperçu USB-C activé (iPhone ↔ PC)', 'success');
  };

  const handleDisconnectUsb = () => {
    setUsbDevice(null);
    pushToast('Session USB-C déconnectée', 'info');
  };

  // Import real local files & folders into IndexedDB
  const importFileEntries = useCallback(
    async (
      entries: ImportedFileEntry[],
      targetFolderId: string,
      options?: {
        customRootName?: string;
        customVolume?: VolumeId;
        targetPane?: 'primary' | 'secondary';
        replaceRootId?: string;
      }
    ) => {
      if (entries.length === 0 && !options?.customRootName) return;

      let workingNodes = [...nodes];
      const createdNodes: FSNode[] = [];
      const now = Date.now();
      let baseParentId = targetFolderId;
      let volumeId: VolumeId = options?.customVolume || getVolumeForFolder(targetFolderId);

      if (options?.replaceRootId) {
        // Clear previous children of root_pc when linking a real PC directory
        const descIds = getDescendantIds(options.replaceRootId, workingNodes);
        if (descIds.length > 0) {
          await dbDeleteNodes(descIds);
          const delSet = new Set(descIds);
          workingNodes = workingNodes.filter((n) => !delSet.has(n.id));
        }
        baseParentId = options.replaceRootId;
      } else if (options?.customRootName) {
        const mountId = generateId('mount');
        const mountNode: FSNode = {
          id: mountId,
          parentId: null,
          volumeId: options.customVolume || 'local_mount',
          name: options.customRootName,
          kind: 'folder',
          size: 0,
          mimeType: 'inode/directory',
          createdAt: now,
          updatedAt: now,
          permissions: 'rwxr-xr-x',
          hidden: false,
          starred: false,
          trashed: false,
        };
        createdNodes.push(mountNode);
        workingNodes.push(mountNode);
        baseParentId = mountId;
        volumeId = mountNode.volumeId;
      }

      const dirCache = new Map<string, string>([['', baseParentId]]);

      const ensureDir = (dirPath: string): string => {
        const clean = dirPath.replace(/^\/|\/$/g, '');
        if (!clean) return baseParentId;
        if (dirCache.has(clean)) return dirCache.get(clean)!;
        const parts = clean.split('/');
        let currParent = baseParentId;
        let acc = '';
        for (const part of parts) {
          acc = acc ? `${acc}/${part}` : part;
          if (!dirCache.has(acc)) {
            const existing = workingNodes.find(
              (n) =>
                n.parentId === currParent &&
                n.kind === 'folder' &&
                !n.trashed &&
                n.name.toLowerCase() === part.toLowerCase()
            );
            if (existing) {
              dirCache.set(acc, existing.id);
            } else {
              const newDirId = generateId('dir');
              const dirNode: FSNode = {
                id: newDirId,
                parentId: currParent,
                volumeId,
                name: part,
                kind: 'folder',
                size: 0,
                mimeType: 'inode/directory',
                createdAt: now,
                updatedAt: now,
                permissions: 'rwxr-xr-x',
                hidden: part.startsWith('.'),
                starred: false,
                trashed: false,
              };
              createdNodes.push(dirNode);
              workingNodes.push(dirNode);
              dirCache.set(acc, newDirId);
            }
          }
          currParent = dirCache.get(acc)!;
        }
        return currParent;
      };

      let importedFilesCount = 0;
      for (const entry of entries) {
        const cleanRel = entry.relativePath.replace(/^\//, '');
        const parts = cleanRel.split('/');
        const rawFileName = parts.pop() || entry.file.name;
        const parentDirId = ensureDir(parts.join('/'));
        const finalName = getUniqueName(rawFileName, parentDirId, undefined, workingNodes);
        const mime = entry.file.type || inferMimeType(finalName);
        const fileId = generateId('file');

        let textContent: string | undefined;
        let hasBlob = true;
        if (
          entry.file.size < 512 * 1024 &&
          (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml')
        ) {
          textContent = await entry.file.text();
          hasBlob = false;
        } else {
          await dbPutBlob(fileId, entry.file);
        }

        const fileNode: FSNode = {
          id: fileId,
          parentId: parentDirId,
          volumeId,
          name: finalName,
          kind: 'file',
          size: entry.file.size,
          mimeType: mime,
          createdAt: entry.file.lastModified || now,
          updatedAt: entry.file.lastModified || now,
          permissions: 'rw-r--r--',
          hidden: finalName.startsWith('.'),
          starred: false,
          trashed: false,
          textContent,
          hasBlob,
        };
        createdNodes.push(fileNode);
        workingNodes.push(fileNode);
        importedFilesCount += 1;
      }

      await dbPutNodes(createdNodes);
      setNodes(workingNodes);

      if (options?.targetPane === 'secondary') {
        setSecondaryPane((p) => ({
          ...p,
          folderId: baseParentId,
          history: [baseParentId],
          historyIndex: 0,
          selectedIds: [],
        }));
      } else if (options?.customRootName) {
        setPrimaryPane((p) => ({
          ...p,
          folderId: baseParentId,
          history: [...p.history.slice(0, p.historyIndex + 1), baseParentId],
          historyIndex: p.historyIndex + 1,
          selectedIds: [],
        }));
      }

      pushToast(`${importedFilesCount} fichier(s) chargé(s)`, 'success');
    },
    [nodes, getVolumeForFolder, getUniqueName, pushToast]
  );

  // Read entries from a real FileSystemDirectoryHandle
  const readDirectoryHandleEntries = async (
    dirHandle: WritableDirectoryHandle,
    maxFiles = 250
  ): Promise<ImportedFileEntry[]> => {
    const entries: ImportedFileEntry[] = [];
    const walk = async (handle: FileSystemDirectoryHandle, prefix = '') => {
      const iterable = handle as unknown as {
        values: () => AsyncIterable<FileSystemHandle>;
      };
      for await (const child of iterable.values()) {
        if (entries.length >= maxFiles) break;
        if (child.kind === 'file') {
          const file = await (child as FileSystemFileHandle).getFile();
          entries.push({
            relativePath: prefix ? `${prefix}/${file.name}` : file.name,
            file,
          });
        } else if (child.kind === 'directory') {
          await walk(
            child as FileSystemDirectoryHandle,
            prefix ? `${prefix}/${child.name}` : child.name
          );
        }
      }
    };
    await walk(dirHandle);
    return entries;
  };

  // Mount real iPhone USB folder (Linux ifuse ~/iPhone-USB or Windows DCIM/Export)
  const handleMountIphoneVolume = async () => {
    const handle = await pickRealDirectoryHandle('readwrite');
    if (!handle) {
      folderInputRef.current?.click();
      return;
    }
    iphoneDirHandleRef.current = handle;
    setMountedIphoneDirName(handle.name);
    pushToast(`Lecture du volume iPhone « ${handle.name} »...`, 'info');
    const entries = await readDirectoryHandleEntries(handle);
    await importFileEntries(entries, 'root_internal', {
      customRootName: `iPhone : ${handle.name}`,
      customVolume: 'local_mount',
      targetPane: 'primary',
    });
    setActiveSection('browser');
  };

  // Mount real PC / Linux folder for direct disk write when transferring from iPhone
  const handleMountPcDirectory = async () => {
    const handle = await pickRealDirectoryHandle('readwrite');
    if (!handle) {
      pushToast(
        'Votre navigateur ne supporte pas le montage direct ; utilisez Chrome ou Edge sur PC/Linux.',
        'info'
      );
      return;
    }
    pcDirHandleRef.current = handle;
    setMountedPcDirName(handle.name);
    pushToast(`Dossier PC lié : « ${handle.name} »`, 'info');
    const entries = await readDirectoryHandleEntries(handle);
    await importFileEntries(entries, 'root_pc', {
      customVolume: 'pc_local',
      targetPane: 'secondary',
      replaceRootId: 'root_pc',
    });
    setActiveSection('browser');
    setSplitView(true);
  };

  // Create Folder
  const handleCreateFolder = async (rawName: string) => {
    const targetFolderId = activePane.folderId;
    const finalName = getUniqueName(rawName, targetFolderId);
    const now = Date.now();
    const newNode: FSNode = {
      id: generateId('dir'),
      parentId: targetFolderId,
      volumeId: getVolumeForFolder(targetFolderId),
      name: finalName,
      kind: 'folder',
      size: 0,
      mimeType: 'inode/directory',
      createdAt: now,
      updatedAt: now,
      permissions: 'rwxr-xr-x',
      hidden: finalName.startsWith('.'),
      starred: false,
      trashed: false,
    };
    await dbPutNodes([newNode]);
    setNodes((prev) => [...prev, newNode]);
    setNewFolderOpen(false);
    setActiveSection('browser');
    pushToast(`Dossier « ${finalName} » créé`, 'success');
  };

  // Create Text/Code File
  const handleCreateFile = async (rawName: string) => {
    const targetFolderId = activePane.folderId;
    const finalName = getUniqueName(rawName, targetFolderId);
    const now = Date.now();
    const ext = finalName.split('.').pop()?.toLowerCase();
    let initialText = '';
    if (ext === 'json') initialText = '{\n  "nom": "configuration",\n  "actif": true\n}\n';
    else if (ext === 'md') initialText = `# ${finalName.replace(/\.md$/i, '')}\n\n`;
    else if (ext === 'plist')
      initialText = `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n  <key>Enabled</key>\n  <true/>\n</dict>\n</plist>\n`;

    const newNode: FSNode = {
      id: generateId('file'),
      parentId: targetFolderId,
      volumeId: getVolumeForFolder(targetFolderId),
      name: finalName,
      kind: 'file',
      size: new Blob([initialText]).size,
      mimeType: inferMimeType(finalName),
      createdAt: now,
      updatedAt: now,
      permissions: 'rw-r--r--',
      hidden: finalName.startsWith('.'),
      starred: false,
      trashed: false,
      textContent: initialText,
    };
    await dbPutNodes([newNode]);
    setNodes((prev) => [...prev, newNode]);
    setNewFileOpen(false);
    setActiveSection('browser');
    setViewerNodeId(newNode.id);
    pushToast(`Fichier « ${finalName} » créé`, 'success');
  };

  // Rename Node
  const handleRenameSubmit = async (rawName: string) => {
    if (!renameTarget) return;
    const parentId = renameTarget.parentId;
    const finalName = parentId ? getUniqueName(rawName, parentId, renameTarget.id) : rawName;
    const updated: FSNode = {
      ...renameTarget,
      name: finalName,
      mimeType: renameTarget.kind === 'folder' ? 'inode/directory' : inferMimeType(finalName),
      hidden: finalName.startsWith('.'),
      updatedAt: Date.now(),
    };
    await dbPutNodes([updated]);
    setNodes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
    setRenameTarget(null);
    pushToast(`Renommé en « ${finalName} »`, 'success');
  };

  // Save edited text content
  const handleSaveText = async (node: FSNode, newText: string) => {
    const updated: FSNode = {
      ...node,
      textContent: newText,
      size: new Blob([newText]).size,
      hasBlob: false,
      updatedAt: Date.now(),
    };
    await dbPutNodes([updated]);
    setNodes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
    await maybeWriteToRealDisk(updated, updated.volumeId);
    pushToast(`« ${node.name} » enregistré`, 'success');
  };

  // Toggle Star
  const handleToggleStar = async (node: FSNode) => {
    const updated: FSNode = { ...node, starred: !node.starred };
    await dbPutNodes([updated]);
    setNodes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
  };

  // Toggle Read-Only POSIX permission
  const handleToggleReadOnly = async (node: FSNode) => {
    const isReadOnly = !node.permissions.startsWith('rw');
    const updated: FSNode = {
      ...node,
      permissions: isReadOnly ? 'rw-r--r--' : 'r--r--r--',
      updatedAt: Date.now(),
    };
    await dbPutNodes([updated]);
    setNodes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
    pushToast(
      isReadOnly
        ? `Écriture autorisée (${updated.permissions})`
        : `Verrouillé en lecture seule (${updated.permissions})`,
      'info'
    );
  };

  // Trash / Permanent Delete
  const handleConfirmDelete = async () => {
    if (!deleteTargets) return;
    const { nodes: targetList, permanent } = deleteTargets;
    const protectedRoots = targetList.filter((n) => n.parentId === null);
    if (protectedRoots.length > 0) {
      pushToast('Impossible de supprimer un volume racine', 'error');
      setDeleteTargets(null);
      return;
    }

    if (permanent) {
      const idsToRemove = new Set<string>();
      for (const n of targetList) {
        idsToRemove.add(n.id);
        if (n.kind === 'folder') {
          for (const desc of getDescendantIds(n.id, nodes)) {
            idsToRemove.add(desc);
          }
        }
      }
      const arr = Array.from(idsToRemove);
      await dbDeleteNodes(arr);
      setNodes((prev) => prev.filter((n) => !idsToRemove.has(n.id)));
      pushToast(`${targetList.length} élément(s) supprimé(s) définitivement`, 'info');
    } else {
      const now = Date.now();
      const updatedList: FSNode[] = targetList.map((n) => ({
        ...n,
        trashed: true,
        trashedFromParentId: n.parentId,
        updatedAt: now,
      }));
      await dbPutNodes(updatedList);
      const updatedMap = new Map(updatedList.map((u) => [u.id, u]));
      setNodes((prev) => prev.map((n) => updatedMap.get(n.id) || n));
      pushToast(`${targetList.length} élément(s) déplacé(s) dans la corbeille`, 'info');
    }

    setPrimaryPane((p) => ({ ...p, selectedIds: [] }));
    setSecondaryPane((p) => ({ ...p, selectedIds: [] }));
    setDeleteTargets(null);
  };

  // Restore from trash
  const handleRestoreNodes = async (targets: FSNode[]) => {
    const now = Date.now();
    const updatedList: FSNode[] = targets.map((n) => {
      const targetParent =
        n.trashedFromParentId && nodeMap[n.trashedFromParentId]
          ? n.trashedFromParentId
          : 'root_internal';
      return {
        ...n,
        parentId: targetParent,
        trashed: false,
        trashedFromParentId: undefined,
        updatedAt: now,
      };
    });
    await dbPutNodes(updatedList);
    const updatedMap = new Map(updatedList.map((u) => [u.id, u]));
    setNodes((prev) => prev.map((n) => updatedMap.get(n.id) || n));
    pushToast(`${targets.length} élément(s) restauré(s)`, 'success');
  };

  const handleEmptyTrash = () => {
    const trashed = nodes.filter((n) => n.trashed);
    if (trashed.length === 0) return;
    setDeleteTargets({ nodes: trashed, permanent: true });
  };

  // Move nodes
  const handleMoveNodesToFolder = useCallback(
    async (nodeIds: string[], targetFolderId: string) => {
      const targetFolder = nodeMap[targetFolderId];
      if (!targetFolder || targetFolder.kind !== 'folder') return;

      const updated: FSNode[] = [];
      const currentSnapshot = [...nodes];
      let diskWrittenCount = 0;

      for (const id of nodeIds) {
        const node = nodeMap[id];
        if (!node || node.parentId === null || node.id === targetFolderId) continue;
        if (node.parentId === targetFolderId) continue;
        if (node.kind === 'folder') {
          const descendants = getDescendantIds(node.id, currentSnapshot);
          if (descendants.includes(targetFolderId)) continue;
        }

        const uniqueName = getUniqueName(node.name, targetFolderId, node.id, currentSnapshot);
        const moved: FSNode = {
          ...node,
          parentId: targetFolderId,
          volumeId: targetFolder.volumeId,
          name: uniqueName,
          updatedAt: Date.now(),
        };
        updated.push(moved);
        const idx = currentSnapshot.findIndex((n) => n.id === moved.id);
        if (idx !== -1) currentSnapshot[idx] = moved;

        if (await maybeWriteToRealDisk(moved, targetFolder.volumeId)) {
          diskWrittenCount += 1;
        }
      }

      if (updated.length === 0) return;
      await dbPutNodes(updated);
      const mapUpdated = new Map(updated.map((u) => [u.id, u]));
      setNodes((prev) => prev.map((n) => mapUpdated.get(n.id) || n));
      setPrimaryPane((p) => ({ ...p, selectedIds: [] }));
      setSecondaryPane((p) => ({ ...p, selectedIds: [] }));
      pushToast(
        diskWrittenCount > 0
          ? `${updated.length} élément(s) déplacé(s) et écrit(s) sur le disque (${targetFolder.name})`
          : `${updated.length} élément(s) déplacé(s) vers « ${targetFolder.name} »`,
        'success'
      );
    },
    [nodes, nodeMap, getUniqueName, maybeWriteToRealDisk, pushToast]
  );

  // Copy nodes recursively (with real disk write if PC/iPhone handle mounted)
  const handleCopyNodesToFolder = useCallback(
    async (nodeIds: string[], targetFolderId: string) => {
      const targetFolder = nodeMap[targetFolderId];
      if (!targetFolder || targetFolder.kind !== 'folder') return;

      const createdNodes: FSNode[] = [];
      const workingList = [...nodes];
      let diskWrittenCount = 0;

      const cloneRecursive = async (source: FSNode, destParentId: string) => {
        const newId = generateId(source.kind === 'folder' ? 'dir' : 'file');
        const newName = getUniqueName(source.name, destParentId, undefined, workingList);
        const now = Date.now();

        if (source.kind === 'file' && source.hasBlob) {
          const blob = await resolveNodeBlob(source);
          if (blob) await dbPutBlob(newId, blob);
        }

        const clone: FSNode = {
          ...source,
          id: newId,
          parentId: destParentId,
          volumeId: targetFolder.volumeId,
          name: newName,
          createdAt: now,
          updatedAt: now,
        };
        createdNodes.push(clone);
        workingList.push(clone);

        if (clone.kind === 'file' && (await maybeWriteToRealDisk(clone, targetFolder.volumeId))) {
          diskWrittenCount += 1;
        }

        if (source.kind === 'folder') {
          const children = nodes.filter((n) => n.parentId === source.id && !n.trashed);
          for (const child of children) {
            await cloneRecursive(child, newId);
          }
        }
      };

      for (const id of nodeIds) {
        const src = nodeMap[id];
        if (!src || src.parentId === null) continue;
        await cloneRecursive(src, targetFolderId);
      }

      if (createdNodes.length === 0) return;
      await dbPutNodes(createdNodes);
      setNodes((prev) => [...prev, ...createdNodes]);
      pushToast(
        diskWrittenCount > 0
          ? `Copié et écrit sur votre disque (${diskWrittenCount} fichier(s))`
          : `Copié dans « ${targetFolder.name} »`,
        'success'
      );
    },
    [nodes, nodeMap, getUniqueName, maybeWriteToRealDisk, pushToast]
  );

  // Paste from clipboard
  const handlePaste = useCallback(async () => {
    if (!clipboard) return;
    const targetFolderId = activePane.folderId;
    if (clipboard.mode === 'cut') {
      await handleMoveNodesToFolder(clipboard.nodeIds, targetFolderId);
      setClipboard(null);
    } else {
      await handleCopyNodesToFolder(clipboard.nodeIds, targetFolderId);
    }
  }, [clipboard, activePane.folderId, handleMoveNodesToFolder, handleCopyNodesToFolder]);

  // Download single file or zip folder to PC
  const handleDownloadNode = async (node: FSNode) => {
    if (node.kind === 'folder') {
      const zipBlob = await createZipFromNodes([node], nodes, resolveNodeBlob);
      downloadBlob(zipBlob, `${node.name}.zip`);
      pushToast(`Dossier « ${node.name} » téléchargé (.zip)`, 'success');
      return;
    }
    const blob = await resolveNodeBlob(node);
    if (!blob) {
      pushToast('Impossible de récupérer le contenu du fichier', 'error');
      return;
    }
    downloadBlob(blob, node.name);
  };

  // Compress selected nodes into a real ZIP archive
  const handleCompressNodes = async (targets: FSNode[]) => {
    if (targets.length === 0) return;
    const targetFolderId = targets[0].parentId || activePane.folderId;
    const baseName =
      targets.length === 1 ? targets[0].name.replace(/\.[^.]+$/, '') : 'Archive_iPhone';
    const zipName = getUniqueName(`${baseName}.zip`, targetFolderId);

    pushToast('Compression en cours...', 'info');
    const zipBlob = await createZipFromNodes(targets, nodes, resolveNodeBlob);
    const id = generateId('zip');
    const now = Date.now();
    const zipNode: FSNode = {
      id,
      parentId: targetFolderId,
      volumeId: getVolumeForFolder(targetFolderId),
      name: zipName,
      kind: 'file',
      size: zipBlob.size,
      mimeType: 'application/zip',
      createdAt: now,
      updatedAt: now,
      permissions: 'rw-r--r--',
      hidden: false,
      starred: false,
      trashed: false,
      hasBlob: true,
    };

    await dbPutBlob(id, zipBlob);
    await dbPutNodes([zipNode]);
    setNodes((prev) => [...prev, zipNode]);
    pushToast(`Archive « ${zipName} » créée`, 'success');
  };

  // Extract a real ZIP archive
  const handleExtractZip = async (zipNode: FSNode) => {
    const blob = await resolveNodeBlob(zipNode);
    if (!blob) {
      pushToast('Archive introuvable', 'error');
      return;
    }
    try {
      const zip = await JSZip.loadAsync(blob);
      const targetParentId = zipNode.parentId || activePane.folderId;
      const volumeId = getVolumeForFolder(targetParentId);
      const extractDirName = getUniqueName(
        zipNode.name.replace(/\.zip$/i, '') || 'Extrait',
        targetParentId
      );

      const now = Date.now();
      const rootExtractDir: FSNode = {
        id: generateId('dir'),
        parentId: targetParentId,
        volumeId,
        name: extractDirName,
        kind: 'folder',
        size: 0,
        mimeType: 'inode/directory',
        createdAt: now,
        updatedAt: now,
        permissions: 'rwxr-xr-x',
        hidden: false,
        starred: false,
        trashed: false,
      };

      const created: FSNode[] = [rootExtractDir];
      const folderPathToId = new Map<string, string>([['', rootExtractDir.id]]);

      const ensureSubfolder = (relDirPath: string): string => {
        const clean = relDirPath.replace(/^\/|\/$/g, '');
        if (!clean) return rootExtractDir.id;
        if (folderPathToId.has(clean)) return folderPathToId.get(clean)!;
        const parts = clean.split('/');
        let parent = rootExtractDir.id;
        let acc = '';
        for (const part of parts) {
          acc = acc ? `${acc}/${part}` : part;
          if (!folderPathToId.has(acc)) {
            const subId = generateId('dir');
            created.push({
              id: subId,
              parentId: parent,
              volumeId,
              name: part,
              kind: 'folder',
              size: 0,
              mimeType: 'inode/directory',
              createdAt: now,
              updatedAt: now,
              permissions: 'rwxr-xr-x',
              hidden: part.startsWith('.'),
              starred: false,
              trashed: false,
            });
            folderPathToId.set(acc, subId);
          }
          parent = folderPathToId.get(acc)!;
        }
        return parent;
      };

      for (const entry of Object.values(zip.files)) {
        if (entry.name.startsWith('__MACOSX/')) continue;
        if (entry.dir) {
          ensureSubfolder(entry.name);
        } else {
          const cleanPath = entry.name.replace(/^\//, '');
          const segments = cleanPath.split('/');
          const fileName = segments.pop()!;
          const parentId = ensureSubfolder(segments.join('/'));
          const fileBlob = await entry.async('blob');
          const mime = inferMimeType(fileName);
          const fileId = generateId('file');

          let textContent: string | undefined;
          let hasBlob = true;
          if (
            fileBlob.size < 512 * 1024 &&
            (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml')
          ) {
            textContent = await fileBlob.text();
            hasBlob = false;
          } else {
            await dbPutBlob(fileId, fileBlob);
          }

          created.push({
            id: fileId,
            parentId,
            volumeId,
            name: fileName,
            kind: 'file',
            size: fileBlob.size,
            mimeType: mime,
            createdAt: now,
            updatedAt: now,
            permissions: 'rw-r--r--',
            hidden: fileName.startsWith('.'),
            starred: false,
            trashed: false,
            textContent,
            hasBlob,
          });
        }
      }

      await dbPutNodes(created);
      setNodes((prev) => [...prev, ...created]);
      pushToast(`Extrait dans « ${extractDirName} » (${created.length - 1} éléments)`, 'success');
    } catch {
      pushToast('Erreur lors de l’extraction de l’archive', 'error');
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const entries: ImportedFileEntry[] = Array.from(files).map((file) => ({
      relativePath: file.webkitRelativePath || file.name,
      file,
    }));
    await importFileEntries(entries, activePane.folderId);
    e.target.value = '';
  };

  const handleDropExternalFiles = async (dataTransfer: DataTransfer, targetFolderId: string) => {
    const entries = await readDroppedItems(dataTransfer.items);
    if (entries.length > 0) {
      await importFileEntries(entries, targetFolderId);
    }
  };

  // Export full backup ZIP
  const handleExportFullBackup = async () => {
    const roots = nodes.filter(
      (n) => n.parentId === null && !n.trashed && n.volumeId !== 'pc_local'
    );
    pushToast('Création de la sauvegarde iPhone...', 'info');
    const blob = await createZipFromNodes(roots, nodes, resolveNodeBlob);
    const dateStamp = new Date().toISOString().slice(0, 10);
    downloadBlob(blob, `iPhone_USB_Sauvegarde_${dateStamp}.zip`);
    pushToast('Sauvegarde .zip téléchargée sur votre PC', 'success');
  };

  // Reset demo file system
  const handleResetFileSystem = async () => {
    setLoading(true);
    await dbClearAll();
    const seeded = await seedInitialFileSystem();
    pcDirHandleRef.current = null;
    iphoneDirHandleRef.current = null;
    setMountedPcDirName(null);
    setMountedIphoneDirName(null);
    setNodes(seeded);
    setPrimaryPane({
      id: 'primary',
      folderId: 'root_internal',
      history: ['root_internal'],
      historyIndex: 0,
      selectedIds: [],
    });
    setSecondaryPane({
      id: 'secondary',
      folderId: 'root_pc',
      history: ['root_pc'],
      historyIndex: 0,
      selectedIds: [],
    });
    setClipboard(null);
    setActiveSection('browser');
    setLoading(false);
    pushToast('Arborescence réinitialisée', 'info');
  };

  const handleOpenNode = (paneId: 'primary' | 'secondary', node: FSNode) => {
    if (node.kind === 'folder') {
      setActiveSection('browser');
      navigatePane(paneId, node.id);
    } else {
      setViewerNodeId(node.id);
    }
  };

  const handleNavigateToFile = (file: FSNode) => {
    setActiveSection('browser');
    if (file.parentId && nodeMap[file.parentId]) {
      navigatePane('primary', file.parentId);
    }
    setActivePaneId('primary');
    setPrimaryPane((p) => ({ ...p, selectedIds: [file.id] }));
  };

  const handleSortChange = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      if (viewerNodeId || newFolderOpen || newFileOpen || renameTarget || deleteTargets) {
        if (e.key === 'Escape') {
          setViewerNodeId(null);
          setNewFolderOpen(false);
          setNewFileOpen(false);
          setRenameTarget(null);
          setDeleteTargets(null);
        }
        return;
      }

      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'c' && selectedNodes.length > 0) {
        e.preventDefault();
        setClipboard({
          mode: 'copy',
          nodeIds: selectedNodes.map((n) => n.id),
          sourceFolderId: activePane.folderId,
        });
        pushToast(`${selectedNodes.length} élément(s) copié(s)`, 'info');
      } else if (mod && e.key.toLowerCase() === 'x' && selectedNodes.length > 0) {
        e.preventDefault();
        setClipboard({
          mode: 'cut',
          nodeIds: selectedNodes.map((n) => n.id),
          sourceFolderId: activePane.folderId,
        });
        pushToast(`${selectedNodes.length} élément(s) coupé(s)`, 'info');
      } else if (mod && e.key.toLowerCase() === 'v' && clipboard) {
        e.preventDefault();
        handlePaste();
      } else if (e.key === 'F2' && selectedNodes.length === 1) {
        e.preventDefault();
        setRenameTarget(selectedNodes[0]);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodes.length > 0) {
        e.preventDefault();
        setDeleteTargets({ nodes: selectedNodes, permanent: activeSection === 'trash' });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    selectedNodes,
    clipboard,
    activePane.folderId,
    activeSection,
    viewerNodeId,
    newFolderOpen,
    newFileOpen,
    renameTarget,
    deleteTargets,
    handlePaste,
    pushToast,
  ]);

  // Transfer selected files between iPhone pane and PC pane
  const handleSendToOtherPane = async (move: boolean) => {
    if (!splitView || selectedNodes.length === 0) return;
    const otherFolderId =
      activePaneId === 'primary' ? secondaryPane.folderId : primaryPane.folderId;
    const ids = selectedNodes.map((n) => n.id);
    if (move) {
      await handleMoveNodesToFolder(ids, otherFolderId);
    } else {
      await handleCopyNodesToFolder(ids, otherFolderId);
    }
  };

  const transferCopyLabel =
    activePaneId === 'primary' ? 'Copier vers PC' : 'Envoyer vers iPhone';

  if (appSurface === 'site') {
    return (
      <SalesLandingPage
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((d) => !d)}
      />
    );
  }

  return (
    <div className="h-screen w-full flex overflow-hidden bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileInputChange}
        className="hidden"
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        // @ts-expect-error webkitdirectory is supported across Chromium, Edge, and Safari
        webkitdirectory=""
        directory=""
        onChange={handleFileInputChange}
        className="hidden"
      />

      {/* Left Sidebar */}
      <Sidebar
        activeSection={activeSection}
        activeFolderId={activePane.folderId}
        nodes={nodes}
        darkMode={darkMode}
        mobileOpen={mobileMenuOpen}
        usbDevice={usbDevice}
        mountedPcDirName={mountedPcDirName}
        onCloseMobile={() => setMobileMenuOpen(false)}
        onToggleDarkMode={() => setDarkMode((d) => !d)}
        onSelectFolder={(folderId, targetPane = 'primary') => {
          if (targetPane === 'secondary' && splitView) {
            setActivePaneId('secondary');
            navigatePane('secondary', folderId);
          } else {
            setActivePaneId('primary');
            navigatePane('primary', folderId);
          }
        }}
        onSelectSection={(sec) => {
          setActiveSection(sec);
          setSearchQuery('');
        }}
        onConnectUsbClick={() => handleConnectWebUsb(true)}
        onMountIphoneClick={handleMountIphoneVolume}
        onMountPcClick={handleMountPcDirectory}
        onReturnToSite={handleReturnToSite}
      />

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Top Workspace Header */}
        <header className="h-14 px-3 sm:px-5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 flex items-center justify-between gap-4 shrink-0">
          {/* Left: Mobile Menu + Live Search */}
          <div className="flex items-center gap-2.5 flex-1 max-w-md min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Ouvrir le menu des volumes"
              className="md:hidden w-10 h-10 flex items-center justify-center rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
            >
              <Menu size={20} />
            </button>

            <div className="relative flex-1 min-w-0">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (activeSection === 'storage' || activeSection === 'usb_bridge') {
                    setActiveSection('browser');
                  }
                }}
                placeholder="Rechercher dans l'iPhone ou le PC..."
                className="w-full pl-9 pr-8 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:bg-white dark:focus:bg-slate-950 focus:border-blue-600 transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Effacer la recherche"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Right: Primary Actions */}
          <div className="flex items-center gap-2 shrink-0 relative">
            <div className="relative">
              <button
                type="button"
                onClick={() => setCreateMenuOpen((o) => !o)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                <FolderPlus size={15} />
                <span className="hidden sm:inline">Nouveau</span>
              </button>

              {createMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setCreateMenuOpen(false)}
                  />
                  <div className="absolute right-0 mt-1.5 w-56 z-40 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-lg py-1.5 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setCreateMenuOpen(false);
                        setNewFolderOpen(true);
                      }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <FolderPlus size={15} className="text-blue-600 dark:text-blue-400" />
                      Nouveau dossier
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCreateMenuOpen(false);
                        setNewFileOpen(true);
                      }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <FilePlus2 size={15} className="text-slate-500" />
                      Nouveau fichier texte / code
                    </button>
                    <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                    <button
                      type="button"
                      onClick={() => {
                        setCreateMenuOpen(false);
                        fileInputRef.current?.click();
                      }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Upload size={15} className="text-slate-500" />
                      Importer des fichiers
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCreateMenuOpen(false);
                        handleMountIphoneVolume();
                      }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <FolderUp size={15} className="text-slate-500" />
                      Monter un volume iPhone (ifuse)
                    </button>
                  </div>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() =>
                usbDevice ? setActiveSection('usb_bridge') : handleConnectWebUsb(true)
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0"
            >
              <Usb size={14} />
              {usbDevice ? 'Pont USB-C' : 'Connecter USB-C'}
            </button>
          </div>
        </header>

        {/* Secondary Workspace Toolbar */}
        {activeSection !== 'storage' && activeSection !== 'usb_bridge' && (
          <div className="px-3 sm:px-5 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 flex items-center justify-between gap-3 overflow-x-auto shrink-0">
            {/* Category segmented filter */}
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-200/70 dark:bg-slate-800/80 shrink-0">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategoryFilter(cat.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    categoryFilter === cat.id
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Power-user toggles */}
            <div className="flex items-center gap-1.5 shrink-0">
              <div className="md:hidden">
                <PWAInstallButton variant="compact" />
              </div>

              <button
                type="button"
                onClick={() => setShowHidden((h) => !h)}
                title="Afficher ou masquer les fichiers cachés (.env, .nomedia, .system_cache)"
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  showHidden
                    ? 'border-blue-600/40 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {showHidden ? <Eye size={14} /> : <EyeOff size={14} />}
                <span className="hidden lg:inline">Fichiers cachés</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSplitView((s) => !s);
                  setActiveSection('browser');
                }}
                title="Afficher iPhone USB-C et PC / Linux côte à côte"
                className={`hidden xl:inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  splitView
                    ? 'border-blue-600/40 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Columns2 size={14} />
                iPhone ↔ PC
              </button>

              <div className="flex items-center p-0.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  title="Vue liste détaillée"
                  aria-label="Vue liste"
                  className={`p-1.5 rounded-md transition-colors ${
                    viewMode === 'list'
                      ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  <List size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  title="Vue grille"
                  aria-label="Vue grille"
                  className={`p-1.5 rounded-md transition-colors ${
                    viewMode === 'grid'
                      ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  <LayoutGrid size={14} />
                </button>
              </div>

              <button
                type="button"
                onClick={() => setInspectorOpen((o) => !o)}
                title="Panneau Propriétés"
                aria-label="Afficher ou masquer les propriétés"
                className={`hidden lg:inline-flex items-center justify-center w-8 h-8 rounded-lg border transition-colors ${
                  inspectorOpen
                    ? 'border-blue-600/40 bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Info size={15} />
              </button>
            </div>
          </div>
        )}

        {/* Contextual Selection & Clipboard Action Bar */}
        {activeSection !== 'storage' &&
          activeSection !== 'usb_bridge' &&
          (selectedNodes.length > 0 || clipboard) && (
            <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-blue-50/70 dark:bg-blue-950/25 flex items-center justify-between gap-3 flex-wrap shrink-0">
              {selectedNodes.length > 0 ? (
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="font-semibold text-blue-900 dark:text-blue-200 font-mono tabular-nums mr-1">
                    {selectedNodes.length} sélectionné{selectedNodes.length > 1 ? 's' : ''}
                  </span>

                  {activeSection === 'trash' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => handleRestoreNodes(selectedNodes)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 transition-colors"
                      >
                        <RotateCcw size={13} />
                        Restaurer
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTargets({ nodes: selectedNodes, permanent: true })}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-red-600 dark:text-red-400 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 size={13} />
                        Supprimer définitivement
                      </button>
                    </>
                  ) : (
                    <>
                      {splitView && (
                        <button
                          type="button"
                          onClick={() => handleSendToOtherPane(false)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 font-medium transition-colors"
                        >
                          <ArrowLeftRight size={13} />
                          {transferCopyLabel}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setClipboard({
                            mode: 'copy',
                            nodeIds: selectedNodes.map((n) => n.id),
                            sourceFolderId: activePane.folderId,
                          });
                          pushToast(`${selectedNodes.length} élément(s) copié(s)`, 'info');
                        }}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                      >
                        <Copy size={13} />
                        Copier
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setClipboard({
                            mode: 'cut',
                            nodeIds: selectedNodes.map((n) => n.id),
                            sourceFolderId: activePane.folderId,
                          });
                          pushToast(`${selectedNodes.length} élément(s) coupé(s)`, 'info');
                        }}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                      >
                        <Scissors size={13} />
                        Couper
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCompressNodes(selectedNodes)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                      >
                        <Archive size={13} />
                        Compresser .zip
                      </button>
                      {selectedNodes.length === 1 && (
                        <button
                          type="button"
                          onClick={() => handleDownloadNode(selectedNodes[0])}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                        >
                          <Download size={13} />
                          Enregistrer sur PC
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setDeleteTargets({ nodes: selectedNodes, permanent: false })}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                      >
                        <Trash2 size={13} />
                        Supprimer
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    onClick={() => setActivePane((p) => ({ ...p, selectedIds: [] }))}
                    className="ml-1 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 px-1.5 py-1"
                  >
                    Désélectionner
                  </button>
                </div>
              ) : (
                <div />
              )}

              {clipboard && activeSection === 'browser' && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-600 dark:text-slate-300 font-mono tabular-nums">
                    Presse-papiers ({clipboard.nodeIds.length} ·{' '}
                    {clipboard.mode === 'cut' ? 'déplacer' : 'copier'})
                  </span>
                  <button
                    type="button"
                    onClick={handlePaste}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 font-medium transition-colors whitespace-nowrap"
                  >
                    <ClipboardPaste size={13} />
                    Coller ici
                  </button>
                  <button
                    type="button"
                    onClick={() => setClipboard(null)}
                    aria-label="Vider le presse-papiers"
                    className="p-1 rounded text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>
          )}

        {/* Main Workspace Body */}
        <main className="flex-1 flex min-h-0 overflow-hidden pb-14 md:pb-0">
          {activeSection === 'usb_bridge' ? (
            <UsbBridgeView
              usbDevice={usbDevice}
              usbError={usbError}
              mountedIphoneDirName={mountedIphoneDirName}
              mountedPcDirName={mountedPcDirName}
              onConnectWebUsb={handleConnectWebUsb}
              onDisconnectUsb={handleDisconnectUsb}
              onEnableDemoUsb={handleEnableDemoUsb}
              onMountIphoneVolume={handleMountIphoneVolume}
              onMountPcDirectory={handleMountPcDirectory}
              onOpenDualPaneExplorer={() => {
                setSplitView(true);
                setActiveSection('browser');
              }}
            />
          ) : activeSection === 'storage' ? (
            <StorageAnalyzer
              nodes={nodes}
              nodeMap={nodeMap}
              onNavigateToFile={handleNavigateToFile}
              onDeleteNodes={(targets) => setDeleteTargets({ nodes: targets, permanent: false })}
              onExportFullBackup={handleExportFullBackup}
              onImportFiles={() => fileInputRef.current?.click()}
              onImportFolder={handleMountIphoneVolume}
              onResetFileSystem={handleResetFileSystem}
            />
          ) : (
            <>
              <div className="flex-1 flex min-w-0 h-full overflow-hidden">
                <FilePane
                  paneId="primary"
                  paneLabel={mountedIphoneDirName ? `iPhone (${mountedIphoneDirName})` : 'iPhone USB-C'}
                  isActivePane={activePaneId === 'primary'}
                  isSplitMode={splitView}
                  section={activeSection}
                  folderId={primaryPane.folderId}
                  canGoBack={primaryPane.historyIndex > 0}
                  canGoForward={primaryPane.historyIndex < primaryPane.history.length - 1}
                  allNodes={nodes}
                  nodeMap={nodeMap}
                  selectedIds={primaryPane.selectedIds}
                  cutNodeIds={clipboard?.mode === 'cut' ? clipboard.nodeIds : []}
                  viewMode={viewMode}
                  sortField={sortField}
                  sortDirection={sortDirection}
                  searchQuery={searchQuery}
                  categoryFilter={categoryFilter}
                  showHidden={showHidden}
                  loading={loading}
                  onFocusPane={() => setActivePaneId('primary')}
                  onNavigateFolder={(id) => navigatePane('primary', id)}
                  onGoBack={() => goBackPane('primary')}
                  onGoForward={() => goForwardPane('primary')}
                  onGoParent={() => goParentPane('primary')}
                  onSubmitPosixPath={(raw) => handleSubmitPosixPath('primary', raw)}
                  onSelectIds={(ids) => setPrimaryPane((p) => ({ ...p, selectedIds: ids }))}
                  onOpenNode={(n) => handleOpenNode('primary', n)}
                  onInspectNode={(n) => {
                    setActivePaneId('primary');
                    setPrimaryPane((p) => ({ ...p, selectedIds: [n.id] }));
                    if (window.innerWidth < 1024) {
                      setMobileInspectorNode(n);
                    } else {
                      setInspectorOpen(true);
                    }
                  }}
                  onRenameNode={(n) => setRenameTarget(n)}
                  onDownloadNode={handleDownloadNode}
                  onDeleteNodes={(targets) =>
                    setDeleteTargets({ nodes: targets, permanent: activeSection === 'trash' })
                  }
                  onRestoreNodes={handleRestoreNodes}
                  onEmptyTrash={handleEmptyTrash}
                  onToggleStar={handleToggleStar}
                  onDropExternalFiles={handleDropExternalFiles}
                  onMoveNodesToFolder={handleMoveNodesToFolder}
                  onSortChange={handleSortChange}
                  onTriggerImport={() => fileInputRef.current?.click()}
                  onTriggerNewFolder={() => {
                    setActivePaneId('primary');
                    setNewFolderOpen(true);
                  }}
                />

                {splitView && activeSection === 'browser' && (
                  <div className="hidden xl:flex flex-1 min-w-0 h-full">
                    <FilePane
                      paneId="secondary"
                      paneLabel={mountedPcDirName ? `PC (${mountedPcDirName})` : 'PC / Linux'}
                      isActivePane={activePaneId === 'secondary'}
                      isSplitMode={true}
                      section="browser"
                      folderId={secondaryPane.folderId}
                      canGoBack={secondaryPane.historyIndex > 0}
                      canGoForward={secondaryPane.historyIndex < secondaryPane.history.length - 1}
                      allNodes={nodes}
                      nodeMap={nodeMap}
                      selectedIds={secondaryPane.selectedIds}
                      cutNodeIds={clipboard?.mode === 'cut' ? clipboard.nodeIds : []}
                      viewMode={viewMode}
                      sortField={sortField}
                      sortDirection={sortDirection}
                      searchQuery=""
                      categoryFilter="all"
                      showHidden={showHidden}
                      loading={loading}
                      onFocusPane={() => setActivePaneId('secondary')}
                      onNavigateFolder={(id) => navigatePane('secondary', id)}
                      onGoBack={() => goBackPane('secondary')}
                      onGoForward={() => goForwardPane('secondary')}
                      onGoParent={() => goParentPane('secondary')}
                      onSubmitPosixPath={(raw) => handleSubmitPosixPath('secondary', raw)}
                      onSelectIds={(ids) => setSecondaryPane((p) => ({ ...p, selectedIds: ids }))}
                      onOpenNode={(n) => handleOpenNode('secondary', n)}
                      onInspectNode={(n) => {
                        setActivePaneId('secondary');
                        setSecondaryPane((p) => ({ ...p, selectedIds: [n.id] }));
                        setInspectorOpen(true);
                      }}
                      onRenameNode={(n) => setRenameTarget(n)}
                      onDownloadNode={handleDownloadNode}
                      onDeleteNodes={(targets) =>
                        setDeleteTargets({ nodes: targets, permanent: false })
                      }
                      onRestoreNodes={handleRestoreNodes}
                      onEmptyTrash={handleEmptyTrash}
                      onToggleStar={handleToggleStar}
                      onDropExternalFiles={handleDropExternalFiles}
                      onMoveNodesToFolder={handleMoveNodesToFolder}
                      onSortChange={handleSortChange}
                      onTriggerImport={() => {
                        setActivePaneId('secondary');
                        fileInputRef.current?.click();
                      }}
                      onTriggerNewFolder={() => {
                        setActivePaneId('secondary');
                        setNewFolderOpen(true);
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Desktop Right Properties Inspector */}
              {inspectorOpen && inspectedNode && (
                <div className="hidden lg:flex shrink-0 h-full">
                  <InspectorPanel
                    node={inspectedNode}
                    allNodes={nodes}
                    nodeMap={nodeMap}
                    onClose={() => setInspectorOpen(false)}
                    onOpen={(n) => handleOpenNode(activePaneId, n)}
                    onDownload={handleDownloadNode}
                    onRename={(n) => setRenameTarget(n)}
                    onToggleStar={handleToggleStar}
                    onToggleReadOnly={handleToggleReadOnly}
                    onCompress={handleCompressNodes}
                    onDelete={(targets) =>
                      setDeleteTargets({ nodes: targets, permanent: activeSection === 'trash' })
                    }
                  />
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* Mobile Bottom Thumb Navigation */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 h-14 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 grid grid-cols-4 items-center">
        <button
          type="button"
          onClick={() => setActiveSection('browser')}
          className={`flex flex-col items-center justify-center h-full gap-0.5 text-[10px] font-medium ${
            activeSection === 'browser'
              ? 'text-blue-600 dark:text-blue-400'
              : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          <HardDrive size={19} />
          Fichiers
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('usb_bridge')}
          className={`flex flex-col items-center justify-center h-full gap-0.5 text-[10px] font-medium ${
            activeSection === 'usb_bridge'
              ? 'text-blue-600 dark:text-blue-400'
              : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          <Usb size={19} />
          USB-C
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('storage')}
          className={`flex flex-col items-center justify-center h-full gap-0.5 text-[10px] font-medium ${
            activeSection === 'storage'
              ? 'text-blue-600 dark:text-blue-400'
              : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          <PieChart size={19} />
          Stockage
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex flex-col items-center justify-center h-full gap-0.5 text-[10px] font-medium text-slate-500 dark:text-slate-400"
        >
          <Upload size={19} />
          Importer
        </button>
      </nav>

      {/* Mobile Inspector Sheet */}
      {mobileInspectorNode && (
        <div
          className="fixed inset-0 z-50 flex justify-end lg:hidden bg-slate-950/50 backdrop-blur-xs"
          onClick={() => setMobileInspectorNode(null)}
        >
          <div className="w-full max-w-sm h-full" onClick={(e) => e.stopPropagation()}>
            <InspectorPanel
              node={nodeMap[mobileInspectorNode.id] || mobileInspectorNode}
              allNodes={nodes}
              nodeMap={nodeMap}
              onClose={() => setMobileInspectorNode(null)}
              onOpen={(n) => {
                setMobileInspectorNode(null);
                handleOpenNode(activePaneId, n);
              }}
              onDownload={handleDownloadNode}
              onRename={(n) => {
                setMobileInspectorNode(null);
                setRenameTarget(n);
              }}
              onToggleStar={handleToggleStar}
              onToggleReadOnly={handleToggleReadOnly}
              onCompress={handleCompressNodes}
              onDelete={(targets) => {
                setMobileInspectorNode(null);
                setDeleteTargets({ nodes: targets, permanent: activeSection === 'trash' });
              }}
            />
          </div>
        </div>
      )}

      {/* File Viewer & Editor Modal */}
      <FileViewerModal
        node={viewerNode}
        nodeMap={nodeMap}
        onClose={() => setViewerNodeId(null)}
        onSaveText={handleSaveText}
        onDownload={handleDownloadNode}
        onExtractZip={handleExtractZip}
      />

      {/* Dialogs */}
      <InputDialog
        open={newFolderOpen}
        title="Nouveau dossier"
        description="Les noms commençant par un point (ex. .archives) seront créés comme dossiers cachés."
        label="Nom du dossier"
        initialValue=""
        placeholder="Nouveau_Dossier"
        submitLabel="Créer le dossier"
        onClose={() => setNewFolderOpen(false)}
        onSubmit={handleCreateFolder}
      />

      <InputDialog
        open={newFileOpen}
        title="Nouveau fichier"
        description="Choisissez librement le nom et l’extension de votre fichier."
        label="Nom du fichier"
        initialValue="notes.md"
        placeholder="config.json"
        submitLabel="Créer et ouvrir"
        presets={[
          { label: 'Texte', ext: 'txt' },
          { label: 'Markdown', ext: 'md' },
          { label: 'JSON', ext: 'json' },
          { label: 'Plist', ext: 'plist' },
          { label: 'Script', ext: 'sh' },
        ]}
        onClose={() => setNewFileOpen(false)}
        onSubmit={handleCreateFile}
      />

      <InputDialog
        open={Boolean(renameTarget)}
        title="Renommer"
        description="Vous pouvez modifier le nom ainsi que l’extension du fichier librement."
        label="Nouveau nom"
        initialValue={renameTarget?.name || ''}
        submitLabel="Renommer"
        onClose={() => setRenameTarget(null)}
        onSubmit={handleRenameSubmit}
      />

      <ConfirmDeleteDialog
        open={Boolean(deleteTargets)}
        nodes={deleteTargets?.nodes || []}
        permanent={Boolean(deleteTargets?.permanent)}
        onClose={() => setDeleteTargets(null)}
        onConfirm={handleConfirmDelete}
      />

      {/* Real Offline Connectivity Indicator */}
      <OfflineIndicator />

      {/* Quiet Toast Feedback */}
      {toasts.length > 0 && (
        <div className="fixed bottom-16 md:bottom-5 right-4 z-50 flex flex-col gap-2 pointer-events-none">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`px-3.5 py-2.5 rounded-lg text-xs font-medium shadow-lg border backdrop-blur-md ${
                toast.type === 'error'
                  ? 'bg-red-600 text-white border-red-500'
                  : toast.type === 'success'
                    ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-800 dark:border-slate-200'
                    : 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border-slate-200 dark:border-slate-800'
              }`}
            >
              {toast.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
