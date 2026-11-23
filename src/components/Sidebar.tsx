import {
  AppWindow,
  Camera,
  Download,
  FileText,
  Folder,
  FolderTree,
  Globe,
  HardDrive,
  Moon,
  Smartphone,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import type { FSNode, SidebarSection } from '../types/fs';
import { isNativeDesktopApp } from '../lib/desktopBridge';

interface SidebarProps {
  activeSection: SidebarSection;
  activeFolderId: string;
  activePaneId: 'primary' | 'secondary';
  nodes: FSNode[];
  darkMode: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onToggleDarkMode: () => void;
  onSelectFolder: (folderId: string, targetPane?: 'primary' | 'secondary') => void;
  onSelectSection: (section: SidebarSection) => void;
  onReturnToSite?: () => void;
}

export function Sidebar({
  activeSection,
  activeFolderId,
  activePaneId,
  nodes,
  darkMode,
  mobileOpen,
  onCloseMobile,
  onToggleDarkMode,
  onSelectFolder,
  onSelectSection,
  onReturnToSite,
}: SidebarProps) {
  const isDesktopExe = isNativeDesktopApp();
  const trashedCount = nodes.filter((n) => n.trashed).length;

  const navItems = isDesktopExe
    ? [
        {
          id: 'iphone_usb',
          label: 'iPhone USB-C',
          icon: Smartphone,
          active: activeSection === 'usb_bridge',
          onClick: () => {
            onSelectSection('usb_bridge');
            onCloseMobile();
          },
        },
        {
          id: 'photos',
          label: 'Photos & Vidéos',
          icon: Camera,
          active: activeSection === 'photos' || activeSection === 'browser',
          onClick: () => {
            onSelectSection('photos');
            onCloseMobile();
          },
        },
        {
          id: 'iphone_files',
          label: 'Stockage iPhone',
          icon: FolderTree,
          active: activeSection === 'iphone_files',
          onClick: () => {
            onSelectSection('iphone_files');
            onCloseMobile();
          },
        },
        {
          id: 'iphone_apps',
          label: 'Documents d’apps',
          icon: AppWindow,
          active: activeSection === 'iphone_apps',
          onClick: () => {
            onSelectSection('iphone_apps');
            onCloseMobile();
          },
        },
        {
          id: 'documents',
          label: 'Documents PC',
          icon: FileText,
          active: activeSection === 'documents',
          onClick: () => {
            onSelectSection('documents');
            onCloseMobile();
          },
        },
        {
          id: 'downloads',
          label: 'Téléchargements',
          icon: Download,
          active: activeSection === 'downloads',
          onClick: () => {
            onSelectSection('downloads');
            onCloseMobile();
          },
        },
        {
          id: 'pc_storage',
          label: 'Stockage PC',
          icon: HardDrive,
          active: activeSection === 'pc_storage',
          onClick: () => {
            onSelectSection('pc_storage');
            onCloseMobile();
          },
        },
      ]
    : [
        {
          id: 'iphone_usb',
          label: 'iPhone USB-C',
          icon: Smartphone,
          active: activeSection === 'usb_bridge',
          onClick: () => {
            onSelectSection('usb_bridge');
            onCloseMobile();
          },
        },
        {
          id: 'photos',
          label: 'Photos & Vidéos',
          icon: Camera,
          active:
            activeSection === 'photos' ||
            (activeSection === 'browser' &&
              activePaneId === 'primary' &&
              (activeFolderId === 'dir_100apple' ||
                activeFolderId === 'dir_dcim' ||
                activeFolderId === 'dir_media' ||
                activeFolderId === 'root_internal')),
          onClick: () => {
            onSelectSection('browser');
            onSelectFolder('dir_100apple', 'primary');
            onCloseMobile();
          },
        },
        {
          id: 'documents',
          label: 'Documents',
          icon: FileText,
          active:
            activeSection === 'documents' ||
            (activeSection === 'browser' &&
              activePaneId === 'primary' &&
              (activeFolderId === 'dir_documents' || activeFolderId === 'root_containers')),
          onClick: () => {
            onSelectSection('browser');
            onSelectFolder('dir_documents', 'primary');
            onCloseMobile();
          },
        },
        {
          id: 'downloads',
          label: 'Téléchargements',
          icon: Download,
          active:
            activeSection === 'downloads' ||
            (activeSection === 'browser' &&
              activePaneId === 'primary' &&
              activeFolderId === 'dir_downloads'),
          onClick: () => {
            onSelectSection('browser');
            onSelectFolder('dir_downloads', 'primary');
            onCloseMobile();
          },
        },
        {
          id: 'pc_storage',
          label: 'Stockage PC',
          icon: HardDrive,
          active:
            activeSection === 'pc_storage' ||
            (activeSection === 'browser' &&
              (activePaneId === 'secondary' || activeFolderId === 'root_pc')),
          onClick: () => {
            onSelectSection('browser');
            onSelectFolder('root_pc', 'secondary');
            onCloseMobile();
          },
        },
      ];

  const content = (
    <aside className="flex flex-col h-full w-56 bg-[#F3F6FA] dark:bg-slate-950 select-none shrink-0">
      {/* Brand header */}
      <div className="flex items-center justify-between h-14 px-4 shrink-0">
        <button
          type="button"
          onClick={() => {
            onSelectSection('usb_bridge');
            onCloseMobile();
          }}
          className="inline-flex items-center gap-2.5 text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0"
        >
          <Folder
            size={18}
            className="text-[#1A65C7] fill-[#1A65C7]/90 dark:text-blue-400 dark:fill-blue-400/80 shrink-0"
          />
          <span>OpenFS</span>
        </button>

        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Fermer le menu"
          className="md:hidden w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200/70 dark:hover:bg-slate-800"
        >
          <X size={17} />
        </button>
      </div>

      {/* Primary 5 Navigation Items */}
      <nav className="flex-1 px-2.5 pt-2 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={item.onClick}
              className={`relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13.5px] transition-colors text-left ${
                item.active
                  ? 'bg-[#E5EBF3] dark:bg-slate-800/90 text-slate-950 dark:text-white font-medium'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/50'
              }`}
            >
              {item.active && (
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full bg-[#1A65C7] dark:bg-blue-400"
                />
              )}
              <Icon
                size={17}
                strokeWidth={1.75}
                className={`shrink-0 ${
                  item.active
                    ? 'text-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Quiet bottom utilities */}
      <div className="px-3 py-3 flex items-center justify-between gap-1 shrink-0">
        <div className="flex items-center gap-1">
          {!isDesktopExe && (
            <button
              type="button"
              onClick={() => {
                onSelectSection('trash');
                onCloseMobile();
              }}
              title="Corbeille"
              aria-label="Corbeille"
              className={`inline-flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs transition-colors ${
                activeSection === 'trash'
                  ? 'bg-[#E5EBF3] dark:bg-slate-800 text-slate-900 dark:text-white font-medium'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800/50'
              }`}
            >
              <Trash2 size={15} />
              {trashedCount > 0 && (
                <span className="font-mono tabular-nums text-[11px]">{trashedCount}</span>
              )}
            </button>
          )}

          {onReturnToSite && !isDesktopExe && (
            <button
              type="button"
              onClick={onReturnToSite}
              title="Retourner au site de présentation"
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800/50 transition-colors"
            >
              <Globe size={14} />
              <span>Site</span>
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onToggleDarkMode}
          title={darkMode ? 'Mode clair' : 'Mode sombre'}
          aria-label={darkMode ? 'Passer en mode clair' : 'Passer en mode sombre'}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-800/60 transition-colors"
        >
          {darkMode ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>
    </aside>
  );

  return (
    <>
      <div className="hidden md:flex shrink-0 h-full">{content}</div>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 flex md:hidden bg-slate-950/45 backdrop-blur-xs"
          onClick={onCloseMobile}
        >
          <div className="h-full" onClick={(e) => e.stopPropagation()}>
            {content}
          </div>
        </div>
      )}
    </>
  );
}
