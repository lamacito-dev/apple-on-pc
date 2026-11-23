import JSZip from 'jszip';
import type { FSNode } from '../types/fs';
import { dbPutBlob, dbPutNodes } from './fsDb';
import { createSampleVoiceMemoWav } from './fsUtils';

const NOW = Date.now();
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

const IMG_COAST = '/src/assets/images/dcim_coastal_cliff_1795345224530.jpg';
const IMG_CAFE = '/src/assets/images/dcim_cafe_espresso_1795345223707.jpg';
const IMG_ALPINE = '/src/assets/images/dcim_alpine_trail_1795345224533.jpg';
const IMG_MUSEUM = '/src/assets/images/dcim_architecture_museum_1795345224648.jpg';

const SAMPLE_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>com.apple.mobile.preferences</string>
  <key>DeviceModel</key>
  <string>iPhone16,2</string>
  <key>FileSystemAccessMode</key>
  <string>OpenHierarchy</string>
  <key>ShowHiddenDotfiles</key>
  <true/>
  <key>DefaultDownloadDirectory</key>
  <string>/var/mobile/Downloads</string>
  <key>SyncOverWiFi</key>
  <true/>
</dict>
</plist>
`;

const SAMPLE_README = `# Guide OpenFS — Accès fichiers iOS façon Android

Bienvenue dans votre espace de fichiers local. Contrairement à l'application Fichiers d'origine sur iOS, OpenFS vous permet de parcourir, modifier et organiser vos fichiers avec une arborescence complète :

## Fonctionnalités disponibles
- **Arborescence complète** : naviguez directement dans \`/var/mobile\`, \`DCIM/100APPLE\`, \`Downloads\`, les conteneurs d'apps et \`iCloud Drive\`.
- **Fichiers cachés** : affichez ou masquez les fichiers commençant par un point (\`.nomedia\`, \`.env\`, \`.DS_Store\`).
- **Couper / Copier / Coller** : sélectionnez plusieurs fichiers et déplacez-les librement entre dossiers, y compris en mode **Double panneau**.
- **Archives ZIP réelles** : compressez une sélection en \`.zip\` ou inspectez et extrayez n'importe quelle archive directement sur place.
- **Éditeur intégré** : ouvrez et modifiez vos fichiers \`.plist\`, \`.json\`, \`.md\`, \`.csv\` ou scripts, et changez les extensions sans restriction.
- **Persistance locale** : importez vos vrais fichiers et dossiers depuis votre iPhone, iPad ou ordinateur ; tout est enregistré localement dans le navigateur (IndexedDB).
`;

const SAMPLE_BUDGET_CSV = `Date,Catégorie,Libellé,Montant_EUR,Moyen_Paiement
2026-11-04,Transport,Billet TGV Paris-Marseille,78.50,Apple Pay
2026-11-06,Restauration,Café de Flore — Petit déjeuner,14.80,Apple Pay
2026-11-09,Matériel,Câble USB-C vers Lightning 2m,24.90,Carte Bancaire
2026-11-12,Stockage,Forfait iCloud+ 200 Go,2.99,Prélèvement
2026-11-18,Culture,Entrée Musée d'Art Contemporain,16.00,Apple Pay
`;

const SAMPLE_WHATSAPP_JSON = `{
  "container": "group.net.whatsapp.WhatsApp.shared",
  "mediaAutoDownload": {
    "photos": "wifi+cellular",
    "videos": "wifi",
    "documents": "wifi+cellular"
  },
  "lastLocalBackup": "2026-11-21T22:15:00Z",
  "exportFormat": "standard"
}
`;

const SAMPLE_ENV = `# Variables de raccourci iOS (fichier caché)
EXPORT_DIR=/var/mobile/Downloads
CAMERA_RAW_KEEP=true
AUTO_COMPRESS_THRESHOLD_MB=25
`;

const SAMPLE_SHORTCUT_SCRIPT = `#!/bin/sh
# Script d'archivage rapide DCIM -> iCloud Drive
SRC="/var/mobile/Media/DCIM/100APPLE"
DEST="/iCloud Drive/Sauvegardes"

echo "Synchronisation de $SRC vers $DEST..."
ls -la "$SRC"
`;

export async function seedInitialFileSystem(): Promise<FSNode[]> {
  // Build a real inspectable & extractable ZIP archive
  const archiveZip = new JSZip();
  archiveZip.file(
    'notes_voyage.md',
    '# Carnet de route — Calanques & Alpes\n\n- Jour 1 : Cassis, sentier des crêtes\n- Jour 2 : Lac Blanc, Chamonix\n- Penser à sauvegarder les photos RAW dans DCIM.\n'
  );
  archiveZip.file(
    'coordonnees_gps.json',
    JSON.stringify(
      {
        spots: [
          { nom: 'Calanque de Port-Pin', lat: 43.2041, lng: 5.5108 },
          { nom: 'Lac Blanc Chamonix', lat: 45.9806, lng: 6.8926 },
        ],
      },
      null,
      2
    )
  );
  archiveZip.file('manifest.txt', 'Archive générée localement par OpenFS.\nContient 3 fichiers prêts à être extraits.\n');
  const sampleZipBlob = await archiveZip.generateAsync({ type: 'blob', compression: 'DEFLATE' });

  // Build a real playable WAV voice memo
  const voiceMemoBlob = createSampleVoiceMemoWav();

  const nodes: FSNode[] = [
    // --- VOLUMES ROOTS ---
    {
      id: 'root_internal',
      parentId: null,
      volumeId: 'internal',
      name: 'Stockage interne',
      kind: 'folder',
      size: 0,
      mimeType: 'inode/directory',
      createdAt: NOW - 45 * DAY,
      updatedAt: NOW - 2 * HOUR,
      permissions: 'rwxr-xr-x',
      hidden: false,
      starred: false,
      trashed: false,
    },
    {
      id: 'root_containers',
      parentId: null,
      volumeId: 'containers',
      name: "Conteneurs d'apps",
      kind: 'folder',
      size: 0,
      mimeType: 'inode/directory',
      createdAt: NOW - 45 * DAY,
      updatedAt: NOW - 4 * HOUR,
      permissions: 'rwxr-xr-x',
      hidden: false,
      starred: false,
      trashed: false,
    },
    {
      id: 'root_icloud',
      parentId: null,
      volumeId: 'icloud',
      name: 'iCloud Drive',
      kind: 'folder',
      size: 0,
      mimeType: 'inode/directory',
      createdAt: NOW - 45 * DAY,
      updatedAt: NOW - 6 * HOUR,
      permissions: 'rwxr-xr-x',
      hidden: false,
      starred: false,
      trashed: false,
    },
    {
      id: 'root_pc',
      parentId: null,
      volumeId: 'pc_local',
      name: 'Ordinateur (PC / Linux)',
      kind: 'folder',
      size: 0,
      mimeType: 'inode/directory',
      createdAt: NOW - 45 * DAY,
      updatedAt: NOW - 1 * HOUR,
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
      createdAt: NOW - 10 * DAY,
      updatedAt: NOW - 1 * HOUR,
      permissions: 'rwxr-xr-x',
      hidden: false,
      starred: false,
      trashed: false,
    },
    {
      id: 'file_pc_guide',
      parentId: 'root_pc',
      volumeId: 'pc_local',
      name: 'Transfert_USB-C_PC.txt',
      kind: 'file',
      size: 318,
      mimeType: 'text/plain',
      createdAt: NOW - 2 * DAY,
      updatedAt: NOW - 1 * HOUR,
      permissions: 'rw-r--r--',
      hidden: false,
      starred: false,
      trashed: false,
      textContent:
        'Dossier de réception PC / Linux.\n\n- Glissez des fichiers depuis votre iPhone (panneau gauche) ici ou cliquez sur « Copier vers PC ».\n- Cliquez sur « Monter un dossier PC » pour lier un vrai dossier de votre disque dur Windows ou Linux en lecture/écriture directe.\n',
    },

    // --- INTERNAL STORAGE STRUCTURE (/var/mobile) ---
    {
      id: 'dir_media',
      parentId: 'root_internal',
      volumeId: 'internal',
      name: 'Media',
      kind: 'folder',
      size: 0,
      mimeType: 'inode/directory',
      createdAt: NOW - 40 * DAY,
      updatedAt: NOW - 1 * HOUR,
      permissions: 'rwxr-xr-x',
      hidden: false,
      starred: false,
      trashed: false,
    },
    {
      id: 'dir_dcim',
      parentId: 'dir_media',
      volumeId: 'internal',
      name: 'DCIM',
      kind: 'folder',
      size: 0,
      mimeType: 'inode/directory',
      createdAt: NOW - 40 * DAY,
      updatedAt: NOW - 1 * HOUR,
      permissions: 'rwxr-xr-x',
      hidden: false,
      starred: true,
      trashed: false,
    },
    {
      id: 'dir_100apple',
      parentId: 'dir_dcim',
      volumeId: 'internal',
      name: '100APPLE',
      kind: 'folder',
      size: 0,
      mimeType: 'inode/directory',
      createdAt: NOW - 30 * DAY,
      updatedAt: NOW - 1 * HOUR,
      permissions: 'rwxr-xr-x',
      hidden: false,
      starred: true,
      trashed: false,
    },
    {
      id: 'dir_recordings',
      parentId: 'dir_media',
      volumeId: 'internal',
      name: 'Recordings',
      kind: 'folder',
      size: 0,
      mimeType: 'inode/directory',
      createdAt: NOW - 25 * DAY,
      updatedAt: NOW - 18 * HOUR,
      permissions: 'rwxr-xr-x',
      hidden: false,
      starred: false,
      trashed: false,
    },
    {
      id: 'dir_downloads',
      parentId: 'root_internal',
      volumeId: 'internal',
      name: 'Downloads',
      kind: 'folder',
      size: 0,
      mimeType: 'inode/directory',
      createdAt: NOW - 40 * DAY,
      updatedAt: NOW - 3 * HOUR,
      permissions: 'rwxr-xr-x',
      hidden: false,
      starred: true,
      trashed: false,
    },
    {
      id: 'dir_documents',
      parentId: 'root_internal',
      volumeId: 'internal',
      name: 'Documents',
      kind: 'folder',
      size: 0,
      mimeType: 'inode/directory',
      createdAt: NOW - 40 * DAY,
      updatedAt: NOW - 5 * HOUR,
      permissions: 'rwxr-xr-x',
      hidden: false,
      starred: false,
      trashed: false,
    },
    {
      id: 'dir_library',
      parentId: 'root_internal',
      volumeId: 'internal',
      name: 'Library',
      kind: 'folder',
      size: 0,
      mimeType: 'inode/directory',
      createdAt: NOW - 45 * DAY,
      updatedAt: NOW - 2 * DAY,
      permissions: 'rwxr-xr-x',
      hidden: false,
      starred: false,
      trashed: false,
    },
    {
      id: 'dir_preferences',
      parentId: 'dir_library',
      volumeId: 'internal',
      name: 'Preferences',
      kind: 'folder',
      size: 0,
      mimeType: 'inode/directory',
      createdAt: NOW - 45 * DAY,
      updatedAt: NOW - 2 * DAY,
      permissions: 'rwxr-xr-x',
      hidden: false,
      starred: false,
      trashed: false,
    },
    {
      id: 'dir_hidden_cache',
      parentId: 'root_internal',
      volumeId: 'internal',
      name: '.system_cache',
      kind: 'folder',
      size: 0,
      mimeType: 'inode/directory',
      createdAt: NOW - 20 * DAY,
      updatedAt: NOW - 12 * HOUR,
      permissions: 'rwx------',
      hidden: true,
      starred: false,
      trashed: false,
    },

    // --- DCIM/100APPLE REAL GENERATED PHOTOS ---
    {
      id: 'file_img_4821',
      parentId: 'dir_100apple',
      volumeId: 'internal',
      name: 'IMG_4821_Cassis.jpg',
      kind: 'file',
      size: 3842190,
      mimeType: 'image/jpeg',
      createdAt: NOW - 3 * DAY,
      updatedAt: NOW - 3 * DAY,
      permissions: 'rw-r--r--',
      hidden: false,
      starred: true,
      trashed: false,
      assetUrl: IMG_COAST,
      meta: { width: 4032, height: 3024, camera: 'iPhone 15 Pro — 24 mm f/1.78' },
    },
    {
      id: 'file_img_4822',
      parentId: 'dir_100apple',
      volumeId: 'internal',
      name: 'IMG_4822_Cafe_Paris.jpg',
      kind: 'file',
      size: 2918440,
      mimeType: 'image/jpeg',
      createdAt: NOW - 2 * DAY,
      updatedAt: NOW - 2 * DAY,
      permissions: 'rw-r--r--',
      hidden: false,
      starred: false,
      trashed: false,
      assetUrl: IMG_CAFE,
      meta: { width: 4032, height: 3024, camera: 'iPhone 15 Pro — 24 mm f/1.78' },
    },
    {
      id: 'file_img_4823',
      parentId: 'dir_100apple',
      volumeId: 'internal',
      name: 'IMG_4823_Lac_Blanc.jpg',
      kind: 'file',
      size: 4215900,
      mimeType: 'image/jpeg',
      createdAt: NOW - 1 * DAY,
      updatedAt: NOW - 1 * DAY,
      permissions: 'rw-r--r--',
      hidden: false,
      starred: true,
      trashed: false,
      assetUrl: IMG_ALPINE,
      meta: { width: 4032, height: 3024, camera: 'iPhone 15 Pro — 13 mm f/2.2' },
    },
    {
      id: 'file_img_4824',
      parentId: 'dir_100apple',
      volumeId: 'internal',
      name: 'IMG_4824_Architecture.jpg',
      kind: 'file',
      size: 3129800,
      mimeType: 'image/jpeg',
      createdAt: NOW - 5 * HOUR,
      updatedAt: NOW - 5 * HOUR,
      permissions: 'rw-r--r--',
      hidden: false,
      starred: false,
      trashed: false,
      assetUrl: IMG_MUSEUM,
      meta: { width: 4032, height: 3024, camera: 'iPhone 15 Pro — 24 mm f/1.78' },
    },
    {
      id: 'file_nomedia',
      parentId: 'dir_100apple',
      volumeId: 'internal',
      name: '.nomedia',
      kind: 'file',
      size: 48,
      mimeType: 'text/plain',
      createdAt: NOW - 10 * DAY,
      updatedAt: NOW - 10 * DAY,
      permissions: 'rw-r--r--',
      hidden: true,
      starred: false,
      trashed: false,
      textContent: '# Marqueur compatible Android pour exclure de l’indexation\n',
    },

    // --- RECORDINGS ---
    {
      id: 'file_memo_01',
      parentId: 'dir_recordings',
      volumeId: 'internal',
      name: 'Memo_Vocal_Idee_App.wav',
      kind: 'file',
      size: voiceMemoBlob.size,
      mimeType: 'audio/wav',
      createdAt: NOW - 18 * HOUR,
      updatedAt: NOW - 18 * HOUR,
      permissions: 'rw-r--r--',
      hidden: false,
      starred: false,
      trashed: false,
      hasBlob: true,
      meta: { duration: '00:03' },
    },

    // --- DOWNLOADS ---
    {
      id: 'file_zip_voyage',
      parentId: 'dir_downloads',
      volumeId: 'internal',
      name: 'Carnet_Voyage_2026.zip',
      kind: 'file',
      size: sampleZipBlob.size,
      mimeType: 'application/zip',
      createdAt: NOW - 8 * HOUR,
      updatedAt: NOW - 8 * HOUR,
      permissions: 'rw-r--r--',
      hidden: false,
      starred: false,
      trashed: false,
      hasBlob: true,
    },
    {
      id: 'file_budget_csv',
      parentId: 'dir_downloads',
      volumeId: 'internal',
      name: 'Depenses_Novembre_2026.csv',
      kind: 'file',
      size: new Blob([SAMPLE_BUDGET_CSV]).size,
      mimeType: 'text/csv',
      createdAt: NOW - 14 * HOUR,
      updatedAt: NOW - 4 * HOUR,
      permissions: 'rw-r--r--',
      hidden: false,
      starred: false,
      trashed: false,
      textContent: SAMPLE_BUDGET_CSV,
    },
    {
      id: 'file_sync_sh',
      parentId: 'dir_downloads',
      volumeId: 'internal',
      name: 'backup_dcim.sh',
      kind: 'file',
      size: new Blob([SAMPLE_SHORTCUT_SCRIPT]).size,
      mimeType: 'text/x-shellscript',
      createdAt: NOW - 3 * DAY,
      updatedAt: NOW - 3 * DAY,
      permissions: 'rwxr-xr-x',
      hidden: false,
      starred: false,
      trashed: false,
      textContent: SAMPLE_SHORTCUT_SCRIPT,
    },

    // --- DOCUMENTS ---
    {
      id: 'file_readme_md',
      parentId: 'dir_documents',
      volumeId: 'internal',
      name: 'Lisez-moi_OpenFS.md',
      kind: 'file',
      size: new Blob([SAMPLE_README]).size,
      mimeType: 'text/markdown',
      createdAt: NOW - 6 * DAY,
      updatedAt: NOW - 2 * HOUR,
      permissions: 'rw-r--r--',
      hidden: false,
      starred: true,
      trashed: false,
      textContent: SAMPLE_README,
    },
    {
      id: 'file_hidden_env',
      parentId: 'dir_documents',
      volumeId: 'internal',
      name: '.env.shortcuts',
      kind: 'file',
      size: new Blob([SAMPLE_ENV]).size,
      mimeType: 'text/plain',
      createdAt: NOW - 9 * DAY,
      updatedAt: NOW - 2 * DAY,
      permissions: 'rw-------',
      hidden: true,
      starred: false,
      trashed: false,
      textContent: SAMPLE_ENV,
    },

    // --- LIBRARY/PREFERENCES ---
    {
      id: 'file_plist_pref',
      parentId: 'dir_preferences',
      volumeId: 'internal',
      name: 'com.apple.mobile.preferences.plist',
      kind: 'file',
      size: new Blob([SAMPLE_PLIST]).size,
      mimeType: 'application/xml',
      createdAt: NOW - 30 * DAY,
      updatedAt: NOW - 2 * DAY,
      permissions: 'rw-r--r--',
      hidden: false,
      starred: false,
      trashed: false,
      textContent: SAMPLE_PLIST,
    },

    // --- HIDDEN SYSTEM CACHE ---
    {
      id: 'file_cache_log',
      parentId: 'dir_hidden_cache',
      volumeId: 'internal',
      name: 'fs_index.log',
      kind: 'file',
      size: 214,
      mimeType: 'text/plain',
      createdAt: NOW - 5 * DAY,
      updatedAt: NOW - 12 * HOUR,
      permissions: 'r--r--r--',
      hidden: false,
      starred: false,
      trashed: false,
      textContent:
        '[2026-11-21 08:14:02] Indexation /var/mobile terminée\n[2026-11-21 08:14:03] Volumes montés : Stockage interne, Conteneurs, iCloud Drive\n[2026-11-22 02:10:19] Vérification intégrité IndexedDB OK\n',
    },

    // --- APP CONTAINERS (/var/mobile/Containers/Data) ---
    {
      id: 'dir_app_whatsapp',
      parentId: 'root_containers',
      volumeId: 'containers',
      name: 'WhatsApp',
      kind: 'folder',
      size: 0,
      mimeType: 'inode/directory',
      createdAt: NOW - 35 * DAY,
      updatedAt: NOW - 4 * HOUR,
      permissions: 'rwxr-xr-x',
      hidden: false,
      starred: false,
      trashed: false,
      meta: { appBundle: 'net.whatsapp.WhatsApp' },
    },
    {
      id: 'dir_app_whatsapp_media',
      parentId: 'dir_app_whatsapp',
      volumeId: 'containers',
      name: 'Media',
      kind: 'folder',
      size: 0,
      mimeType: 'inode/directory',
      createdAt: NOW - 35 * DAY,
      updatedAt: NOW - 4 * HOUR,
      permissions: 'rwxr-xr-x',
      hidden: false,
      starred: false,
      trashed: false,
    },
    {
      id: 'file_whatsapp_cfg',
      parentId: 'dir_app_whatsapp',
      volumeId: 'containers',
      name: 'settings.json',
      kind: 'file',
      size: new Blob([SAMPLE_WHATSAPP_JSON]).size,
      mimeType: 'application/json',
      createdAt: NOW - 15 * DAY,
      updatedAt: NOW - 4 * HOUR,
      permissions: 'rw-r--r--',
      hidden: false,
      starred: false,
      trashed: false,
      textContent: SAMPLE_WHATSAPP_JSON,
    },
    {
      id: 'file_whatsapp_photo',
      parentId: 'dir_app_whatsapp_media',
      volumeId: 'containers',
      name: 'WA_20261119_Cassis.jpg',
      kind: 'file',
      size: 3842190,
      mimeType: 'image/jpeg',
      createdAt: NOW - 3 * DAY,
      updatedAt: NOW - 3 * DAY,
      permissions: 'rw-r--r--',
      hidden: false,
      starred: false,
      trashed: false,
      assetUrl: IMG_COAST,
      meta: { width: 4032, height: 3024, camera: 'Partagé via WhatsApp' },
    },
    {
      id: 'dir_app_telegram',
      parentId: 'root_containers',
      volumeId: 'containers',
      name: 'Telegram',
      kind: 'folder',
      size: 0,
      mimeType: 'inode/directory',
      createdAt: NOW - 28 * DAY,
      updatedAt: NOW - 2 * DAY,
      permissions: 'rwxr-xr-x',
      hidden: false,
      starred: false,
      trashed: false,
      meta: { appBundle: 'ph.telegra.Telegraph' },
    },
    {
      id: 'file_tg_notes',
      parentId: 'dir_app_telegram',
      volumeId: 'containers',
      name: 'Messages_Enregistres.txt',
      kind: 'file',
      size: 178,
      mimeType: 'text/plain',
      createdAt: NOW - 7 * DAY,
      updatedAt: NOW - 2 * DAY,
      permissions: 'rw-r--r--',
      hidden: false,
      starred: false,
      trashed: false,
      textContent:
        'Liens à garder :\n- Documentation raccourcis iOS\n- Liste matériel randonnée Alpes\n- Recette espresso extraction 18g / 36g en 28s\n',
    },
    {
      id: 'dir_app_safari',
      parentId: 'root_containers',
      volumeId: 'containers',
      name: 'Safari',
      kind: 'folder',
      size: 0,
      mimeType: 'inode/directory',
      createdAt: NOW - 40 * DAY,
      updatedAt: NOW - 9 * HOUR,
      permissions: 'rwxr-xr-x',
      hidden: false,
      starred: false,
      trashed: false,
      meta: { appBundle: 'com.apple.mobilesafari' },
    },
    {
      id: 'file_safari_bookmarks',
      parentId: 'dir_app_safari',
      volumeId: 'containers',
      name: 'Favoris_Export.json',
      kind: 'file',
      size: 294,
      mimeType: 'application/json',
      createdAt: NOW - 11 * DAY,
      updatedAt: NOW - 9 * HOUR,
      permissions: 'rw-r--r--',
      hidden: false,
      starred: false,
      trashed: false,
      textContent: JSON.stringify(
        {
          browser: 'Safari iOS',
          bookmarks: [
            { title: 'Météo Montagne Chamonix', folder: 'Voyages' },
            { title: 'Guide format PLIST Apple', folder: 'Dev' },
          ],
        },
        null,
        2
      ),
    },

    // --- ICLOUD DRIVE (/iCloud Drive) ---
    {
      id: 'dir_icloud_docs',
      parentId: 'root_icloud',
      volumeId: 'icloud',
      name: 'Documents synchronisés',
      kind: 'folder',
      size: 0,
      mimeType: 'inode/directory',
      createdAt: NOW - 38 * DAY,
      updatedAt: NOW - 6 * HOUR,
      permissions: 'rwxr-xr-x',
      hidden: false,
      starred: false,
      trashed: false,
    },
    {
      id: 'dir_icloud_backups',
      parentId: 'root_icloud',
      volumeId: 'icloud',
      name: 'Sauvegardes',
      kind: 'folder',
      size: 0,
      mimeType: 'inode/directory',
      createdAt: NOW - 38 * DAY,
      updatedAt: NOW - 1 * DAY,
      permissions: 'rwxr-xr-x',
      hidden: false,
      starred: false,
      trashed: false,
    },
    {
      id: 'file_icloud_checklist',
      parentId: 'dir_icloud_docs',
      volumeId: 'icloud',
      name: 'Checklist_Migration_Android_iOS.md',
      kind: 'file',
      size: 465,
      mimeType: 'text/markdown',
      createdAt: NOW - 5 * DAY,
      updatedAt: NOW - 6 * HOUR,
      permissions: 'rw-r--r--',
      hidden: false,
      starred: false,
      trashed: false,
      textContent: `# Migration fichiers Android → iOS

1. Importer le dossier \`DCIM\` complet depuis le stockage local.
2. Ranger les téléchargements dans \`/var/mobile/Downloads\`.
3. Vérifier les fichiers cachés (\`.nomedia\`, \`.env\`) avant archivage.
4. Exporter une sauvegarde \`.zip\` dans \`/iCloud Drive/Sauvegardes\`.
`,
    },

    // --- TRASHED SAMPLE ITEM ---
    {
      id: 'file_trashed_draft',
      parentId: 'dir_documents',
      volumeId: 'internal',
      name: 'Brouillon_Ancien_Export.txt',
      kind: 'file',
      size: 94,
      mimeType: 'text/plain',
      createdAt: NOW - 12 * DAY,
      updatedAt: NOW - 4 * DAY,
      permissions: 'rw-r--r--',
      hidden: false,
      starred: false,
      trashed: true,
      trashedFromParentId: 'dir_documents',
      textContent: 'Ancien brouillon déplacé dans la corbeille. Vous pouvez le restaurer à tout moment.\n',
    },
  ];

  await dbPutBlob('file_zip_voyage', sampleZipBlob);
  await dbPutBlob('file_memo_01', voiceMemoBlob);
  await dbPutNodes(nodes);

  return nodes;
}
