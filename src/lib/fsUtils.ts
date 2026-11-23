import JSZip from 'jszip';
import type { FSNode, FileCategory } from '../types/fs';

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 o';
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  const k = 1024;
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
  const value = bytes / Math.pow(k, i);
  const formatted = i === 0 ? Math.round(value).toString() : value.toFixed(value >= 100 ? 0 : 1);
  return `${formatted.replace('.', ',')} ${units[i]}`;
}

export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatShortDate(timestamp: number): string {
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function getExtension(filename: string): string {
  const clean = filename.startsWith('.') ? filename.slice(1) : filename;
  const idx = clean.lastIndexOf('.');
  if (idx <= 0) return '';
  return clean.slice(idx + 1).toLowerCase();
}

export function inferMimeType(filename: string): string {
  const ext = getExtension(filename);
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    heic: 'image/heic',
    svg: 'image/svg+xml',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
    pdf: 'application/pdf',
    zip: 'application/zip',
    tar: 'application/x-tar',
    gz: 'application/gzip',
    ipa: 'application/octet-stream',
    json: 'application/json',
    plist: 'application/xml',
    xml: 'application/xml',
    md: 'text/markdown',
    txt: 'text/plain',
    csv: 'text/csv',
    log: 'text/plain',
    env: 'text/plain',
    ini: 'text/plain',
    sh: 'text/x-shellscript',
    js: 'text/javascript',
    ts: 'text/typescript',
    tsx: 'text/typescript',
    css: 'text/css',
    html: 'text/html',
    py: 'text/x-python',
    swift: 'text/x-swift',
    sql: 'application/sql',
    sqlite: 'application/x-sqlite3',
    db: 'application/x-sqlite3',
  };
  return map[ext] || 'application/octet-stream';
}

export function getFileCategory(node: FSNode): Exclude<FileCategory, 'all'> {
  if (node.kind === 'folder') return 'other';
  const ext = getExtension(node.name);
  const mime = node.mimeType.toLowerCase();

  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'svg'].includes(ext)) {
    return 'image';
  }
  if (mime.startsWith('video/') || ['mp4', 'mov', 'mkv', 'webm', 'avi'].includes(ext)) {
    return 'video';
  }
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'].includes(ext)) {
    return 'audio';
  }
  if (['zip', 'rar', '7z', 'tar', 'gz', 'ipa', 'apk'].includes(ext) || mime.includes('zip')) {
    return 'archive';
  }
  if (
    ['json', 'plist', 'xml', 'js', 'ts', 'tsx', 'jsx', 'css', 'html', 'py', 'swift', 'sh', 'sql', 'env', 'ini', 'yaml', 'yml', 'toml'].includes(
      ext
    ) ||
    node.name.startsWith('.')
  ) {
    return 'code';
  }
  if (
    ['pdf', 'md', 'txt', 'csv', 'doc', 'docx', 'xls', 'xlsx', 'pages', 'numbers', 'rtf', 'log'].includes(ext) ||
    mime.startsWith('text/') ||
    mime === 'application/pdf'
  ) {
    return 'document';
  }
  return 'other';
}

export function isTextEditable(node: FSNode): boolean {
  if (node.kind !== 'file') return false;
  if (typeof node.textContent === 'string') return true;
  const ext = getExtension(node.name);
  const editableExts = new Set([
    'txt', 'md', 'json', 'plist', 'xml', 'csv', 'log', 'env', 'ini', 'cfg', 'conf',
    'js', 'ts', 'tsx', 'jsx', 'css', 'html', 'py', 'swift', 'sh', 'sql', 'yaml', 'yml',
    'nomedia', 'gitignore',
  ]);
  return (
    editableExts.has(ext) ||
    node.mimeType.startsWith('text/') ||
    node.mimeType === 'application/json' ||
    node.mimeType === 'application/xml'
  );
}

export function getTypeLabel(node: FSNode): string {
  if (node.kind === 'folder') return 'Dossier';
  const ext = getExtension(node.name);
  if (ext) return ext.toUpperCase();
  if (node.name.startsWith('.')) return 'Système';
  return 'Fichier';
}

export function buildPathNodes(nodeId: string, nodeMap: Record<string, FSNode>): FSNode[] {
  const trail: FSNode[] = [];
  let current: FSNode | undefined = nodeMap[nodeId];
  const guard = new Set<string>();
  while (current && !guard.has(current.id)) {
    guard.add(current.id);
    trail.unshift(current);
    current = current.parentId ? nodeMap[current.parentId] : undefined;
  }
  return trail;
}

export function getPosixPath(nodeId: string, nodeMap: Record<string, FSNode>): string {
  const trail = buildPathNodes(nodeId, nodeMap);
  if (trail.length === 0) return '/';
  const root = trail[0];
  let prefix = '';
  if (root.id === 'root_internal') prefix = '/var/mobile';
  else if (root.id === 'root_containers') prefix = '/var/mobile/Containers/Data';
  else if (root.id === 'root_icloud') prefix = '/iCloud Drive';
  else if (root.id === 'root_pc') prefix = '/PC';
  else prefix = `/${root.name}`;

  const rest = trail.slice(1).map((n) => n.name);
  return rest.length === 0 ? prefix : `${prefix}/${rest.join('/')}`;
}

export function resolvePosixPath(pathInput: string, nodes: FSNode[], nodeMap: Record<string, FSNode>): string | null {
  const normalized = pathInput.trim().replace(/\/+/g, '/').replace(/\/$/, '') || '/var/mobile';

  // Exact match via getPosixPath
  for (const node of nodes) {
    if (node.kind === 'folder' && !node.trashed) {
      if (getPosixPath(node.id, nodeMap).toLowerCase() === normalized.toLowerCase()) {
        return node.id;
      }
    }
  }
  return null;
}

export function getDescendantIds(folderId: string, nodes: FSNode[]): string[] {
  const childrenByParent = new Map<string, FSNode[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const list = childrenByParent.get(node.parentId) || [];
    list.push(node);
    childrenByParent.set(node.parentId, list);
  }

  const result: string[] = [];
  const stack = [...(childrenByParent.get(folderId) || [])];
  while (stack.length > 0) {
    const next = stack.pop()!;
    result.push(next.id);
    if (next.kind === 'folder') {
      const sub = childrenByParent.get(next.id);
      if (sub) stack.push(...sub);
    }
  }
  return result;
}

export function computeFolderSize(folderId: string, nodes: FSNode[]): number {
  const descendants = getDescendantIds(folderId, nodes);
  const set = new Set(descendants);
  let total = 0;
  for (const n of nodes) {
    if (set.has(n.id) && n.kind === 'file' && !n.trashed) {
      total += n.size;
    }
  }
  return total;
}

export async function computeSha256(data: ArrayBuffer): Promise<string> {
  if (!crypto?.subtle) return 'indisponible';
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function generateId(prefix = 'node'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function createZipFromNodes(
  selectedNodes: FSNode[],
  allNodes: FSNode[],
  getNodeBlob: (node: FSNode) => Promise<Blob | null>
): Promise<Blob> {
  const zip = new JSZip();

  const addNodeToZip = async (node: FSNode, baseFolder: JSZip) => {
    if (node.kind === 'folder') {
      const subZip = baseFolder.folder(node.name);
      if (!subZip) return;
      const children = allNodes.filter((n) => n.parentId === node.id && !n.trashed);
      for (const child of children) {
        await addNodeToZip(child, subZip);
      }
    } else {
      const blob = await getNodeBlob(node);
      if (blob) {
        baseFolder.file(node.name, blob);
      } else if (typeof node.textContent === 'string') {
        baseFolder.file(node.name, node.textContent);
      } else {
        baseFolder.file(node.name, '');
      }
    }
  };

  for (const node of selectedNodes) {
    await addNodeToZip(node, zip);
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export interface ZipEntryPreview {
  path: string;
  name: string;
  isDir: boolean;
  size: number;
}

export async function inspectZipBlob(blob: Blob): Promise<ZipEntryPreview[]> {
  const zip = await JSZip.loadAsync(blob);
  const entries: ZipEntryPreview[] = [];
  zip.forEach((relativePath, entry) => {
    const clean = relativePath.replace(/\/$/, '');
    const parts = clean.split('/');
    const name = parts[parts.length - 1] || relativePath;
    // _data may contain uncompressedSize internally
    const rawData = (entry as unknown as { _data?: { uncompressedSize?: number } })._data;
    entries.push({
      path: relativePath,
      name,
      isDir: entry.dir,
      size: rawData?.uncompressedSize ?? 0,
    });
  });
  return entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
}

export interface ImportedFileEntry {
  relativePath: string;
  file: File;
}

/** Recursively reads dropped files and folders via DataTransferItemList */
export async function readDroppedItems(items: DataTransferItemList): Promise<ImportedFileEntry[]> {
  const results: ImportedFileEntry[] = [];

  const readEntry = async (entry: FileSystemEntry, prefix = ''): Promise<void> => {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry;
      await new Promise<void>((resolve) => {
        fileEntry.file(
          (file) => {
            results.push({
              relativePath: prefix ? `${prefix}/${file.name}` : file.name,
              file,
            });
            resolve();
          },
          () => resolve()
        );
      });
    } else if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry;
      const reader = dirEntry.createReader();
      const readAll = async (): Promise<FileSystemEntry[]> => {
        const all: FileSystemEntry[] = [];
        while (true) {
          const batch = await new Promise<FileSystemEntry[]>((resolve) => {
            reader.readEntries(
              (entries) => resolve(entries),
              () => resolve([])
            );
          });
          if (batch.length === 0) break;
          all.push(...batch);
        }
        return all;
      };
      const entries = await readAll();
      const nextPrefix = prefix ? `${prefix}/${dirEntry.name}` : dirEntry.name;
      for (const child of entries) {
        await readEntry(child, nextPrefix);
      }
    }
  };

  const promises: Promise<void>[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const webkitEntry = item.webkitGetAsEntry?.();
    if (webkitEntry) {
      promises.push(readEntry(webkitEntry));
    } else {
      const f = item.getAsFile();
      if (f) {
        results.push({ relativePath: f.name, file: f });
      }
    }
  }
  await Promise.all(promises);
  return results;
}

/** Creates a short, gentle synthesized WAV audio blob so the pre-seeded voice memo actually plays */
export function createSampleVoiceMemoWav(): Blob {
  const sampleRate = 22050;
  const durationSeconds = 3.2;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  // Pleasant warm chord chime progression
  const notes = [261.63, 329.63, 392.0, 523.25];
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const noteIndex = Math.min(Math.floor(t / 0.75), notes.length - 1);
    const localT = t - noteIndex * 0.75;
    const env = Math.min(1, localT * 18) * Math.exp(-localT * 3.2);
    const freq = notes[noteIndex];
    const sample =
      (Math.sin(2 * Math.PI * freq * t) * 0.5 +
        Math.sin(2 * Math.PI * freq * 2 * t) * 0.18 +
        Math.sin(2 * Math.PI * (freq / 2) * t) * 0.15) *
      env *
      0.45;
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}
