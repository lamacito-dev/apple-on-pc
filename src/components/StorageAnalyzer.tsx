import {
  Archive,
  Copy,
  FolderOpen,
  FolderUp,
  HardDrive,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import type { FSNode } from '../types/fs';
import { formatBytes, getFileCategory, getPosixPath } from '../lib/fsUtils';
import { FileIcon } from './FileIcon';

interface StorageAnalyzerProps {
  nodes: FSNode[];
  nodeMap: Record<string, FSNode>;
  onNavigateToFile: (node: FSNode) => void;
  onDeleteNodes: (nodes: FSNode[]) => void;
  onExportFullBackup: () => void;
  onImportFiles: () => void;
  onImportFolder: () => void;
  onResetFileSystem: () => void;
}

const CATEGORY_META: Record<
  string,
  { label: string; colorClass: string; barClass: string }
> = {
  image: { label: 'Photos & Images', colorClass: 'text-sky-600 dark:text-sky-400', barClass: 'bg-sky-500' },
  video: { label: 'Vidéos', colorClass: 'text-indigo-600 dark:text-indigo-400', barClass: 'bg-indigo-500' },
  document: { label: 'Documents', colorClass: 'text-blue-600 dark:text-blue-400', barClass: 'bg-blue-600' },
  code: { label: 'Code & Config (.plist)', colorClass: 'text-slate-700 dark:text-slate-300', barClass: 'bg-slate-600 dark:bg-slate-400' },
  archive: { label: 'Archives (.zip)', colorClass: 'text-orange-600 dark:text-orange-400', barClass: 'bg-orange-500' },
  audio: { label: 'Audio & Mémos', colorClass: 'text-amber-600 dark:text-amber-400', barClass: 'bg-amber-500' },
  other: { label: 'Autres fichiers', colorClass: 'text-emerald-600 dark:text-emerald-400', barClass: 'bg-emerald-500' },
};

export function StorageAnalyzer({
  nodes,
  nodeMap,
  onNavigateToFile,
  onDeleteNodes,
  onExportFullBackup,
  onImportFiles,
  onImportFolder,
  onResetFileSystem,
}: StorageAnalyzerProps) {
  const activeFiles = nodes.filter((n) => n.kind === 'file' && !n.trashed);
  const trashedFiles = nodes.filter((n) => n.kind === 'file' && n.trashed);
  const totalBytes = activeFiles.reduce((sum, f) => sum + f.size, 0);
  const trashedBytes = trashedFiles.reduce((sum, f) => sum + f.size, 0);

  // Breakdown by category
  const breakdownMap = new Map<string, { bytes: number; count: number }>();
  for (const file of activeFiles) {
    const cat = getFileCategory(file);
    const curr = breakdownMap.get(cat) || { bytes: 0, count: 0 };
    curr.bytes += file.size;
    curr.count += 1;
    breakdownMap.set(cat, curr);
  }

  const breakdown = Array.from(breakdownMap.entries())
    .map(([key, val]) => ({
      key,
      ...CATEGORY_META[key],
      bytes: val.bytes,
      count: val.count,
      percent: totalBytes > 0 ? (val.bytes / totalBytes) * 100 : 0,
    }))
    .sort((a, b) => b.bytes - a.bytes);

  const largestFiles = [...activeFiles].sort((a, b) => b.size - a.size).slice(0, 8);

  // Detect potential duplicates (same exact size > 0 and same mimeType)
  const sizeGroups = new Map<string, FSNode[]>();
  for (const file of activeFiles) {
    if (file.size === 0) continue;
    const key = `${file.size}_${file.mimeType}`;
    const list = sizeGroups.get(key) || [];
    list.push(file);
    sizeGroups.set(key, list);
  }
  const duplicateGroups = Array.from(sizeGroups.values()).filter((g) => g.length > 1);

  return (
    <div className="flex-1 overflow-y-auto bg-white dark:bg-slate-950 p-5 md:p-8">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
          <div className="space-y-1">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Analyseur de stockage
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Répartition en temps réel des fichiers enregistrés dans votre espace local OpenFS.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={onExportFullBackup}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors whitespace-nowrap"
            >
              <Archive size={14} />
              Sauvegarder en .zip
            </button>
            <button
              type="button"
              onClick={onResetFileSystem}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              <RotateCcw size={14} />
              Réinitialiser l’exemple
            </button>
          </div>
        </div>

        {/* Summary KPI Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/50">
            <div className="text-xs text-slate-500 dark:text-slate-400">Espace utilisé</div>
            <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {formatBytes(totalBytes)}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {activeFiles.length} fichiers actifs
            </div>
          </div>

          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/50">
            <div className="text-xs text-slate-500 dark:text-slate-400">Dossiers</div>
            <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {nodes.filter((n) => n.kind === 'folder' && !n.trashed).length}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              3 volumes montés
            </div>
          </div>

          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/50">
            <div className="text-xs text-slate-500 dark:text-slate-400">Doublons détectés</div>
            <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {duplicateGroups.length}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Même taille et format
            </div>
          </div>

          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/50">
            <div className="text-xs text-slate-500 dark:text-slate-400">Corbeille</div>
            <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {formatBytes(trashedBytes)}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {trashedFiles.length} élément(s)
            </div>
          </div>
        </div>

        {/* Category Segmented Bar */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Répartition par catégorie
            </h2>
            <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
              Total : {formatBytes(totalBytes)}
            </span>
          </div>

          <div className="h-3.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex">
            {breakdown.map((cat) => (
              <div
                key={cat.key}
                style={{ width: `${Math.max(cat.percent, 1.5)}%` }}
                title={`${cat.label} : ${formatBytes(cat.bytes)}`}
                className={`${cat.barClass} h-full border-r border-white/40 dark:border-slate-950/40 last:border-0`}
              />
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2.5 pt-1">
            {breakdown.map((cat) => (
              <div
                key={cat.key}
                className="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/80 text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-2.5 h-2.5 rounded-xs shrink-0 ${cat.barClass}`} />
                  <span className="text-slate-800 dark:text-slate-200 truncate">{cat.label}</span>
                  <span className="text-slate-400 dark:text-slate-500 font-mono tabular-nums">
                    ({cat.count})
                  </span>
                </div>
                <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300 shrink-0">
                  {formatBytes(cat.bytes)}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Largest Files + Duplicates Split */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Largest files */}
          <section className="lg:col-span-2 space-y-3">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Fichiers les plus volumineux
            </h2>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 text-xs font-medium text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 px-4">Fichier</th>
                    <th className="py-2.5 px-4 text-right">Taille</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 text-xs">
                  {largestFiles.map((file) => (
                    <tr
                      key={file.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors"
                    >
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <FileIcon node={file} size={16} />
                          <div className="min-w-0">
                            <div className="font-medium text-slate-900 dark:text-slate-100 truncate max-w-[240px]">
                              {file.name}
                            </div>
                            <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[260px]">
                              {getPosixPath(file.parentId || 'root_internal', nodeMap)}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {formatBytes(file.size)}
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => onNavigateToFile(file)}
                            title="Localiser dans le dossier"
                            className="p-1.5 rounded-md text-slate-600 dark:text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors"
                          >
                            <FolderOpen size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteNodes([file])}
                            title="Mettre à la corbeille"
                            className="p-1.5 rounded-md text-slate-600 dark:text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Duplicates & iOS Import Box */}
          <div className="space-y-6">
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Copy size={15} className="text-slate-500" />
                Doublons potentiels
              </h2>
              {duplicateGroups.length === 0 ? (
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                  Aucun doublon détecté dans vos fichiers actifs.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {duplicateGroups.map((group, idx) => (
                    <div
                      key={idx}
                      className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 space-y-2"
                    >
                      <div className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-400">
                        {group.length} copies · {formatBytes(group[0].size)} chacune
                      </div>
                      <ul className="space-y-1.5">
                        {group.map((item) => (
                          <li
                            key={item.id}
                            className="flex items-center justify-between gap-2 text-xs"
                          >
                            <button
                              type="button"
                              onClick={() => onNavigateToFile(item)}
                              className="text-slate-800 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 truncate text-left"
                            >
                              {item.name}
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteNodes([item])}
                              aria-label={`Supprimer ${item.name}`}
                              className="p-1 rounded text-slate-400 hover:text-red-600 transition-colors shrink-0"
                            >
                              <Trash2 size={13} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <HardDrive size={16} className="text-blue-600 dark:text-blue-400" />
                Importer vos vrais fichiers iOS
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Depuis Safari sur iPhone/iPad ou votre ordinateur, importez vos photos, dossiers iCloud Drive ou archives locales : tout reste stocké hors-ligne sur votre appareil.
              </p>
              <div className="flex flex-col gap-2 pt-1">
                <button
                  type="button"
                  onClick={onImportFiles}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white transition-colors"
                >
                  <Upload size={14} />
                  Sélectionner des fichiers
                </button>
                <button
                  type="button"
                  onClick={onImportFolder}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                >
                  <FolderUp size={14} />
                  Importer une arborescence entière
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
