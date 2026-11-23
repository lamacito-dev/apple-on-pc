export type NodeKind = 'folder' | 'file';

export type FileCategory =
  | 'all'
  | 'image'
  | 'document'
  | 'code'
  | 'archive'
  | 'audio'
  | 'video'
  | 'other';

export type VolumeId = 'internal' | 'containers' | 'icloud' | 'local_mount' | 'pc_local';

export type SidebarSection =
  | 'browser'
  | 'usb_bridge'
  | 'photos'
  | 'documents'
  | 'downloads'
  | 'pc_storage'
  | 'recents'
  | 'favorites'
  | 'trash'
  | 'storage';

export type SortField = 'name' | 'size' | 'updatedAt' | 'type';
export type SortDirection = 'asc' | 'desc';
export type ViewMode = 'list' | 'grid';

export interface FSNode {
  id: string;
  parentId: string | null;
  volumeId: VolumeId;
  name: string;
  kind: NodeKind;
  size: number;
  mimeType: string;
  createdAt: number;
  updatedAt: number;
  permissions: string; // e.g., 'rw-r--r--' or 'rwxr-xr-x'
  hidden: boolean;
  starred: boolean;
  trashed: boolean;
  trashedFromParentId?: string | null;
  /** Optional static asset URL for pre-seeded sample media */
  assetUrl?: string;
  /** Inline UTF-8 text content for text/code/config files */
  textContent?: string;
  /** Whether binary content is stored in IndexedDB blobs store */
  hasBlob?: boolean;
  /** Optional descriptive metadata (e.g. EXIF or app container note) */
  meta?: {
    width?: number;
    height?: number;
    camera?: string;
    appBundle?: string;
    duration?: string;
  };
}

export interface ClipboardState {
  mode: 'copy' | 'cut';
  nodeIds: string[];
  sourceFolderId: string;
}

export interface ToastMessage {
  id: string;
  type: 'info' | 'success' | 'error';
  text: string;
}

export interface PaneState {
  id: 'primary' | 'secondary';
  folderId: string;
  history: string[];
  historyIndex: number;
  selectedIds: string[];
}
