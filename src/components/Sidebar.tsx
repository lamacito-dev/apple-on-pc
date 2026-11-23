import {
  Clock,
  Cloud,
  Download,
  FileText,
  FolderOpen,
  HardDrive,
  Image as ImageIcon,
  Laptop,
  Layers,
  Moon,
  PieChart,
  Smartphone,
  Star,
  Sun,
  Trash2,
  Usb,
  X,
} from 'lucide-react';
import type { FSNode, SidebarSection } from '../types/fs';
import type { ConnectedUsbDeviceInfo } from '../lib/webUsbBridge';
import { formatBytes } from '../lib/fsUtils';
import { PWAInstallButton } from './PWAInstallButton';

interface SidebarProps {
  activeSection: SidebarSection;
  activeFolderId: string;
  nodes: FSNode[];
  darkMode: boolean;
  mobileOpen: boolean;
  usbDevice: ConnectedUsbDeviceInfo | null;
  mountedPcDirName: string | null;
  onCloseMobile: () => void;
  onToggleDarkMode: () => void;
  onSelectFolder: (folderId: string, targetPane?: 'primary' | 'secondary') => void;
  onSelectSection: (section: SidebarSection) => void;
  onConnectUsbClick: () => void;
  onMountIphoneClick: () => void;
  onMountPcClick: () => void;
  onReturnToSite?: () => void;
}

export function Sidebar({
  activeSection,
  activeFolderId,
  nodes,
  darkMode,
  mobileOpen,
  usbDevice,
  mountedPcDirName,
  onCloseMobile,
  onToggleDarkMode,
  onSelectFolder,
  onSelectSection,
  onConnectUsbClick,
  onMountIphoneClick,
  onMountPcClick,
  onReturnToSite,
}: SidebarProps) {
  const activeNodes = nodes.filter((n) => !n.trashed);
  const trashedCount = nodes.filter((n) => n.trashed).length;
  const starredCount = activeNodes.filter((n) => n.starred).length;
  const totalBytes = activeNodes
    .filter((n) => n.kind === 'file' && n.volumeId !== 'pc_local')
    .reduce((sum, n) => sum + n.size, 0);

  const capacityBytes = 64 * 1024 * 1024 * 1024;
  const usedPercent = Math.min(100, Math.max(2, (totalBytes / capacityBytes) * 100));

  const customMounts = activeNodes.filter((n) => n.parentId === null && n.volumeId === 'local_mount');

  const iphoneVolumes = [
    { id: 'root_internal', label: 'Stockage iPhone', sub: '/var/mobile', icon: Smartphone },
    { id: 'dir_100apple', label: 'Photos (DCIM)', sub: 'DCIM/100APPLE', icon: ImageIcon },
    { id: 'root_containers', label: "Documents d'apps", sub: 'Containers/Data', icon: Layers },
    { id: 'dir_downloads', label: 'Téléchargements', sub: '/Downloads', icon: Download },
    { id: 'dir_documents', label: 'Documents', sub: '/Documents', icon: FileText },
    { id: 'root_icloud', label: 'iCloud Drive', sub: '/iCloud Drive', icon: Cloud },
  ];

  const handleFolderClick = (id: string, targetPane: 'primary' | 'secondary' = 'primary') => {
    onSelectSection('browser');
    onSelectFolder(id, targetPane);
    onCloseMobile();
  };

  const handleSectionClick = (section: SidebarSection) => {
    onSelectSection(section);
    onCloseMobile();
  };

  const content = (
    <aside className="flex flex-col h-full w-64 bg-slate-50 dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 select-none">
      {/* Brand header */}
      <div className="flex items-center justify-between h-14 px-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
        <button
          type="button"
          onClick={() => handleFolderClick('root_internal', 'primary')}
          className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0"
        >
          OpenFS
        </button>

        <div className="flex items-center gap-1">
          {onReturnToSite && (
            <button
              type="button"
              onClick={onReturnToSite}
              title="Retourner au site de présentation"
              className="px-2 py-1 text-[11px] font-medium rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              Site
            </button>
          )}
          <button
            type="button"
            onClick={onToggleDarkMode}
            title={darkMode ? 'Passer en mode clair' : 'Passer en mode sombre'}
            aria-label={darkMode ? 'Passer en mode clair' : 'Passer en mode sombre'}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
          >
            {darkMode ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Fermer le menu"
            className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Real USB-C Device Status Block */}
      <div className="p-3 border-b border-slate-200 dark:border-slate-800 shrink-0">
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-3 space-y-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                {usbDevice ? usbDevice.productName : 'iPhone USB-C'}
              </div>
              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate mt-0.5">
                {usbDevice
                  ? `${usbDevice.vendorHex}:${usbDevice.productHex} · USB ${usbDevice.usbVersion}`
                  : 'Aucun appareil détecté'}
              </div>
            </div>
            <Usb
              size={15}
              className={`shrink-0 mt-0.5 ${
                usbDevice ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'
              }`}
            />
          </div>

          <button
            type="button"
            onClick={() => {
              if (usbDevice) {
                handleSectionClick('usb_bridge');
              } else {
                onConnectUsbClick();
                onCloseMobile();
              }
            }}
            className={`w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              usbDevice
                ? 'border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            <Usb size={13} />
            {usbDevice ? 'Gérer le pont USB-C' : 'Connecter en USB-C'}
          </button>
        </div>
      </div>

      {/* Scrollable navigation */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {/* iPhone USB-C Volumes */}
        <div>
          <p className="px-2.5 mb-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            iPhone (USB-C)
          </p>
          <nav className="space-y-0.5">
            {iphoneVolumes.map((vol) => {
              const Icon = vol.icon;
              const exists = activeNodes.some((n) => n.id === vol.id);
              if (!exists) return null;
              const isActive = activeSection === 'browser' && activeFolderId === vol.id;
              return (
                <button
                  key={vol.id}
                  type="button"
                  onClick={() => handleFolderClick(vol.id, 'primary')}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                    isActive
                      ? 'bg-blue-600/10 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300 font-medium'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/70'
                  }`}
                >
                  <Icon size={16} className="shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{vol.label}</div>
                    <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                      {vol.sub}
                    </div>
                  </div>
                </button>
              );
            })}

            {customMounts.map((mount) => {
              const isActive = activeSection === 'browser' && activeFolderId === mount.id;
              return (
                <button
                  key={mount.id}
                  type="button"
                  onClick={() => handleFolderClick(mount.id, 'primary')}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                    isActive
                      ? 'bg-blue-600/10 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300 font-medium'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/70'
                  }`}
                >
                  <FolderOpen size={16} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{mount.name}</div>
                    <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                      Volume USB monté
                    </div>
                  </div>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Non-Apple PC / Linux Destination */}
        <div>
          <p className="px-2.5 mb-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            Ordinateur (PC / Linux)
          </p>
          <nav className="space-y-0.5">
            {activeNodes.some((n) => n.id === 'root_pc') && (
              <button
                type="button"
                onClick={() => handleFolderClick('root_pc', 'secondary')}
                className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors ${
                  activeSection === 'browser' && activeFolderId === 'root_pc'
                    ? 'bg-blue-600/10 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300 font-medium'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/70'
                }`}
              >
                <Laptop size={16} className="shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate">
                    {mountedPcDirName || 'Dossier PC local'}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                    {mountedPcDirName ? 'Écriture disque directe' : '/PC/Exports_iPhone'}
                  </div>
                </div>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                onMountPcClick();
                onCloseMobile();
              }}
              className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
            >
              <HardDrive size={15} className="shrink-0" />
              <span className="truncate">
                {mountedPcDirName ? 'Changer le dossier PC' : 'Lier un dossier Windows/Linux'}
              </span>
            </button>
          </nav>
        </div>

        {/* Tools & Views */}
        <div>
          <p className="px-2.5 mb-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            Outils
          </p>
          <nav className="space-y-0.5">
            <button
              type="button"
              onClick={() => handleSectionClick('usb_bridge')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm transition-colors ${
                activeSection === 'usb_bridge'
                  ? 'bg-blue-600/10 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300 font-medium'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/70'
              }`}
            >
              <span className="flex items-center gap-2.5 truncate">
                <Usb size={16} className="shrink-0" />
                Pont USB-C (Win/Linux)
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleSectionClick('recents')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm transition-colors ${
                activeSection === 'recents'
                  ? 'bg-blue-600/10 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300 font-medium'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/70'
              }`}
            >
              <span className="flex items-center gap-2.5 truncate">
                <Clock size={16} className="shrink-0" />
                Récents
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleSectionClick('favorites')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm transition-colors ${
                activeSection === 'favorites'
                  ? 'bg-blue-600/10 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300 font-medium'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/70'
              }`}
            >
              <span className="flex items-center gap-2.5 truncate">
                <Star size={16} className="shrink-0" />
                Favoris
              </span>
              {starredCount > 0 && (
                <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  {starredCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => handleSectionClick('storage')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm transition-colors ${
                activeSection === 'storage'
                  ? 'bg-blue-600/10 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300 font-medium'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/70'
              }`}
            >
              <span className="flex items-center gap-2.5 truncate">
                <PieChart size={16} className="shrink-0" />
                Stockage
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleSectionClick('trash')}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm transition-colors ${
                activeSection === 'trash'
                  ? 'bg-blue-600/10 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300 font-medium'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/70'
              }`}
            >
              <span className="flex items-center gap-2.5 truncate">
                <Trash2 size={16} className="shrink-0" />
                Corbeille
              </span>
              {trashedCount > 0 && (
                <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  {trashedCount}
                </span>
              )}
            </button>
          </nav>
        </div>
      </div>

      {/* Bottom local import & storage summary */}
      <div className="p-3.5 border-t border-slate-200 dark:border-slate-800 space-y-2.5 shrink-0">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-700 dark:text-slate-300">Volume iPhone</span>
            <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
              {formatBytes(totalBytes)}
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-blue-600 dark:bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${usedPercent}%` }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => {
              onMountIphoneClick();
              onCloseMobile();
            }}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors whitespace-nowrap"
          >
            <FolderOpen size={15} />
            Monter le volume iPhone
          </button>

          <PWAInstallButton variant="sidebar" onActionComplete={onCloseMobile} />
        </div>
      </div>
    </aside>
  );

  return (
    <>
      <div className="hidden md:flex shrink-0 h-full">{content}</div>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 flex md:hidden bg-slate-950/50 backdrop-blur-xs"
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
