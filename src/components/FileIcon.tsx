import {
  File,
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  FolderLock,
} from 'lucide-react';
import type { FSNode } from '../types/fs';
import { getExtension, getFileCategory } from '../lib/fsUtils';

interface FileIconProps {
  node: FSNode;
  size?: number;
  className?: string;
}

export function FileIcon({ node, size = 18, className = '' }: FileIconProps) {
  if (node.kind === 'folder') {
    if (node.hidden) {
      return (
        <FolderLock
          size={size}
          className={`shrink-0 text-slate-400 dark:text-slate-500 ${className}`}
        />
      );
    }
    return (
      <Folder
        size={size}
        className={`shrink-0 text-blue-600 dark:text-blue-400 fill-blue-600/15 dark:fill-blue-400/15 ${className}`}
      />
    );
  }

  const ext = getExtension(node.name);
  const category = getFileCategory(node);

  if (ext === 'csv' || ext === 'xls' || ext === 'xlsx') {
    return <FileSpreadsheet size={size} className={`shrink-0 text-emerald-600 dark:text-emerald-400 ${className}`} />;
  }

  switch (category) {
    case 'image':
      return <FileImage size={size} className={`shrink-0 text-sky-600 dark:text-sky-400 ${className}`} />;
    case 'video':
      return <FileVideo size={size} className={`shrink-0 text-indigo-600 dark:text-indigo-400 ${className}`} />;
    case 'audio':
      return <FileAudio size={size} className={`shrink-0 text-amber-600 dark:text-amber-400 ${className}`} />;
    case 'archive':
      return <FileArchive size={size} className={`shrink-0 text-orange-600 dark:text-orange-400 ${className}`} />;
    case 'code':
      return <FileCode2 size={size} className={`shrink-0 text-slate-700 dark:text-slate-300 ${className}`} />;
    case 'document':
      return <FileText size={size} className={`shrink-0 text-blue-600 dark:text-blue-400 ${className}`} />;
    default:
      return <File size={size} className={`shrink-0 text-slate-500 dark:text-slate-400 ${className}`} />;
  }
}
