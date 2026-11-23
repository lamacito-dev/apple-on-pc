import { useState } from 'react';
import {
  ArrowDown,
  Check,
  ChevronDown,
  Download,
  HardDrive,
  Laptop,
  Minus,
  Moon,
  ShieldCheck,
  Smartphone,
  Sun,
  Terminal,
  Usb,
  X,
} from 'lucide-react';
import { detectDesktopOS, downloadDesktopInstallerZip } from '../lib/webUsbBridge';

const IMG_HERO = '/src/assets/images/sales_hero_usbc_1795427199295.jpg';
const IMG_STEP_1 = '/src/assets/images/sales_step1_plug_1795427199294.jpg';
const IMG_STEP_3 = '/src/assets/images/sales_step3_browse_1795427199026.jpg';
const IMG_STEP_4 = '/src/assets/images/sales_step4_transfer_1795427199640.jpg';

const IMG_PREVIEW_DUAL_PANE = '/src/assets/images/preview_dual_pane_v2_1795439204474.jpg';
const IMG_PREVIEW_USB_BRIDGE = '/src/assets/images/preview_usb_bridge_v3_1795440324593.jpg';
const IMG_PREVIEW_INSPECTOR = '/src/assets/images/preview_inspector_viewer_v3_1795440324305.jpg';

const INTERFACE_PREVIEWS = [
  {
    id: 'usb_bridge',
    step: '01',
    title: 'Pont USB-C & dossier PC lié',
    subtitle: 'Détection matérielle Apple (VID 0x05AC) et écriture directe sur le disque dur.',
    description:
      'Vérifiez en un coup d’œil l’état de la connexion USB-C de votre iPhone, liez le dossier de destination sur votre PC et suivez l’avancement en 3 étapes claires.',
    src: IMG_PREVIEW_USB_BRIDGE,
    alt: 'Capture de l’écran Pont USB-C d’OpenFS affichant iPhone 16 Pro connecté en USB-C et le dossier PC lié avec écriture directe sur le disque',
  },
  {
    id: 'dual_pane',
    step: '02',
    title: 'Double panneau iPhone ↔ PC',
    subtitle: 'Photos DCIM, vidéos 4K et fichiers cachés à gauche ; votre dossier PC à droite.',
    description:
      'Explorez l’arborescence de votre iPhone comme un disque Android et copiez vos photos, vidéos et documents en un clic directement dans votre dossier Windows ou Linux.',
    src: IMG_PREVIEW_DUAL_PANE,
    alt: 'Capture de l’interface OpenFS en mode double panneau affichant /DCIM/100APPLE à gauche et le dossier PC OpenFS-iPhone-Sync à droite',
  },
  {
    id: 'inspector',
    step: '03',
    title: 'Visionneuse & inspecteur SHA-256',
    subtitle: 'Aperçu photo haute définition, métadonnées complètes et compression .zip.',
    description:
      'Prévisualisez vos photos avec zoom, vérifiez le chemin exact, les dimensions et l’empreinte SHA-256 de chaque fichier avant de l’exporter ou de le compresser en archive .zip.',
    src: IMG_PREVIEW_INSPECTOR,
    alt: 'Capture de la visionneuse photo et du panneau Inspecteur d’OpenFS avec aperçu de IMG_4821.JPG, empreinte SHA-256 et boutons Exporter vers PC et Compresser .zip',
  },
];

interface StudioImageProps {
  src: string;
  alt: string;
  caption: string;
  className?: string;
}

function StudioImage({ src, alt, caption, className = '' }: StudioImageProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 p-8 text-center ${className}`}
      >
        <div className="flex items-center gap-3 text-slate-400 dark:text-slate-500">
          <Smartphone size={28} />
          <Usb size={20} />
          <Laptop size={28} />
        </div>
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{caption}</span>
      </div>
    );
  }

  return (
    <div
      className={`overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 ${className}`}
    >
      <img
        src={src}
        alt={alt}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="w-full h-full object-cover"
      />
    </div>
  );
}

interface SalesLandingPageProps {
  darkMode: boolean;
  onToggleDarkMode: () => void;
}

const COMPARISON_ROWS = [
  {
    criterion: 'Photos et vidéos en USB-C',
    before: 'Dossiers DCIM mélangés, déconnexions fréquentes et aperçus lents sur PC.',
    after: 'Arborescence claire, visionneuse plein cadre avec zoom et export en lots.',
  },
  {
    criterion: 'Documents d’apps et fichiers cachés',
    before: 'Invisibles dans l’explorateur Windows par défaut, aucun accès aux fichiers .plist ou .nomedia.',
    after: 'Accès structuré aux documents partagés, fichiers cachés (.) et édition de texte/code sur place.',
  },
  {
    criterion: 'Ordinateurs Linux (Ubuntu, Debian, Arch, Fedora)',
    before: 'Aucune application officielle Apple ; configuration manuelle complexe en ligne de commande.',
    after: 'Montage usbmuxd + ifuse automatisé vers ~/iPhone-USB pour tout parcourir en 1 clic.',
  },
  {
    criterion: 'Dépendance à iTunes ou iCloud',
    before: 'Logiciels lourds obligatoires ou abonnement cloud payant pour récupérer ses propres fichiers.',
    after: 'Zéro iTunes, zéro compte cloud : liaison directe par câble USB-C sur votre ordinateur.',
  },
  {
    criterion: 'Transfert iPhone ↔ Disque dur PC',
    before: 'Copier-coller instable, impossible de compresser en .zip ou de renommer une extension.',
    after: 'Double panneau côte à côte, écriture directe sur votre disque PC et compression/extraction .zip.',
  },
  {
    criterion: 'Confidentialité et vérification',
    before: 'Synchronisation opaque sur des serveurs tiers.',
    after: '100 % local et hors-ligne, avec empreinte SHA-256 calculée sur chaque fichier.',
  },
];

const FAQ_ITEMS = [
  {
    q: 'Comment fonctionne le téléchargement sur mon PC Windows ou Linux ?',
    a: 'Lorsque vous cliquez sur Télécharger pour PC, votre ordinateur télécharge immédiatement le pack OpenFS (.zip). Il contient un lanceur bureau natif (OpenFS.bat + OpenFS.url pour Windows, sans PowerShell, ou installer-openfs-bureau.sh pour Linux) qui place OpenFS sur votre Bureau et l’ouvre dans sa propre fenêtre dédiée.',
  },
  {
    q: 'Mes photos et mes fichiers passent-ils par un serveur distant ?',
    a: 'Non. OpenFS fonctionne intégralement en local sur votre ordinateur. Aucun fichier, aucune photo et aucune métadonnée ne sont envoyés vers un serveur externe. Vous pouvez même couper Internet et continuer à transférer hors-ligne.',
  },
  {
    q: 'Ai-je besoin d’un Mac ou d’installer iTunes ?',
    a: 'Non. OpenFS est conçu précisément pour les ordinateurs Windows 10/11 et Linux. Sous Windows, seul le pilote USB officiel gratuit « Appareils Apple » (Microsoft Store) est nécessaire si Windows ne reconnaît pas encore votre iPhone. Sous Linux, le pack inclus configure automatiquement usbmuxd et ifuse.',
  },
  {
    q: 'Quelles sont les limites imposées par Apple sur un iPhone non jailbreaké ?',
    a: 'Sur un iPhone standard, iOS protège le noyau système et les données privées chiffrées des applications tierces via sa sandbox. En USB-C, vous accédez librement à vos photos et vidéos (DCIM), vos mémos et médias, vos sauvegardes locales, ainsi qu’aux dossiers « Partage de fichiers » des apps compatibles (VLC, Documents, etc.).',
  },
  {
    q: 'Quel navigateur utiliser pour la fenêtre dédiée et l’écriture disque ?',
    a: 'Nous recommandons Google Chrome, Microsoft Edge ou Brave sur PC Windows ou Linux. Le lanceur bureau détecte automatiquement votre navigateur compatible pour ouvrir OpenFS en fenêtre autonome avec accès WebUSB et écriture directe sur votre disque dur.',
  },
];

export function SalesLandingPage({
  darkMode,
  onToggleDarkMode,
}: SalesLandingPageProps) {
  const windowsExeUrl = (import.meta.env.VITE_WINDOWS_EXE_URL || '').trim();
  const linuxBinaryUrl = (import.meta.env.VITE_LINUX_APPIMAGE_URL || '').trim();

  const [osTab, setOsTab] = useState<'windows' | 'linux'>(() => detectDesktopOS());
  const [activePreviewIdx, setActivePreviewIdx] = useState<number>(0);
  const [openFaqIndex, setOpenFaqIndex] = useState<number>(0);
  const [downloading, setDownloading] = useState(false);
  const [downloadModal, setDownloadModal] = useState<{
    os: 'windows' | 'linux';
    filename: string;
    isNativeExe: boolean;
  } | null>(null);

  const osLabel = osTab === 'linux' ? 'Linux' : 'Windows';
  const activePreview = INTERFACE_PREVIEWS[activePreviewIdx] || INTERFACE_PREVIEWS[0];

  const handleDownloadDesktopApp = async (targetOs: 'windows' | 'linux' = osTab) => {
    setDownloading(true);
    try {
      const directUrl = targetOs === 'windows' ? windowsExeUrl : linuxBinaryUrl;
      if (directUrl) {
        const link = document.createElement('a');
        link.href = directUrl;
        link.rel = 'noopener noreferrer';
        const fallbackName =
          targetOs === 'windows' ? 'OpenFS-Setup-1.0.0.exe' : 'OpenFS-1.0.0.AppImage';
        const derivedName = directUrl.split('/').pop()?.split('?')[0] || fallbackName;
        link.download = derivedName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setDownloadModal({
          os: targetOs,
          filename: derivedName,
          isNativeExe: targetOs === 'windows',
        });
        return;
      }

      const filename = await downloadDesktopInstallerZip(targetOs);
      setDownloadModal({ os: targetOs, filename, isNativeExe: false });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-40 bg-white/90 dark:bg-slate-950/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Brand wordmark */}
          <a
            href="#top"
            className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0"
          >
            OpenFS
          </a>

          {/* Zone 2: 4 concise single-line text nav links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600 dark:text-slate-400">
            <a
              href="#apercu"
              className="hover:text-slate-900 dark:hover:text-slate-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Aperçu
            </a>
            <a
              href="#etapes"
              className="hover:text-slate-900 dark:hover:text-slate-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Étapes
            </a>
            <a
              href="#comparatif"
              className="hover:text-slate-900 dark:hover:text-slate-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Avant / Après
            </a>
            <a
              href="#faq"
              className="hover:text-slate-900 dark:hover:text-slate-100 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              FAQ
            </a>
          </nav>

          {/* Zone 3: 1 primary CTA */}
          <div className="shrink-0">
            <button
              type="button"
              disabled={downloading}
              onClick={() => handleDownloadDesktopApp(osTab)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
            >
              <Download size={14} />
              Télécharger pour PC
            </button>
          </div>
        </div>
      </header>

      <main id="top">
        {/* Hero Split Section */}
        <section className="max-w-6xl mx-auto px-6 pt-14 pb-16 lg:pt-20 lg:pb-24">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-2">
                <span>iPhone USB-C</span>
                <span aria-hidden="true">·</span>
                <span>Windows 10 / 11 & Linux</span>
                <span aria-hidden="true">·</span>
                <span>100 % local</span>
              </div>

              <h1
                className="font-bold tracking-tight text-slate-900 dark:text-slate-100 leading-[1.08]"
                style={{
                  fontSize: 'clamp(2.25rem, 4vw, 3.5rem)',
                  textWrap: 'balance',
                }}
              >
                Accédez aux fichiers de votre iPhone sur PC et Linux.
              </h1>

              <p className="text-base text-slate-600 dark:text-slate-400 leading-relaxed max-w-xl">
                Branchez votre iPhone en USB-C à un ordinateur non-Apple, parcourez vos photos,
                documents, archives ZIP et fichiers cachés comme sur Android, puis transférez-les
                directement sur votre disque dur — sans Mac, sans iTunes et sans cloud.
              </p>

              <div className="flex flex-wrap items-center gap-5 pt-2">
                <button
                  type="button"
                  disabled={downloading}
                  onClick={() => handleDownloadDesktopApp(osTab)}
                  className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
                >
                  <Download size={16} />
                  {downloading ? 'Préparation...' : `Télécharger pour ${osLabel}`}
                </button>

                <a
                  href="#apercu"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 underline underline-offset-4 transition-colors whitespace-nowrap"
                >
                  Voir l’interface en images
                  <ArrowDown size={14} />
                </a>
              </div>

              <div className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-3">
                <span>Autre système :</span>
                <button
                  type="button"
                  onClick={() => handleDownloadDesktopApp(osTab === 'windows' ? 'linux' : 'windows')}
                  className="font-medium text-slate-700 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 underline underline-offset-2"
                >
                  Télécharger pour {osTab === 'windows' ? 'Linux (.zip)' : 'Windows (.zip)'}
                </button>
              </div>
            </div>

            <div className="lg:col-span-6">
              <StudioImage
                src={IMG_HERO}
                alt="iPhone en titane relié par un câble USB-C tressé à un ordinateur portable Windows et Linux sur un bureau clair"
                caption="Liaison directe iPhone USB-C vers PC Windows / Linux"
                className="aspect-4/3 lg:h-full"
              />
            </div>
          </div>

          {/* 4-column Factual Proof Strip directly below the Hero split */}
          <div className="mt-14 pt-8 border-t border-slate-200 dark:border-slate-800 grid grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
            <div className="space-y-1">
              <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                0 Mo
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Envoyé sur Internet — tout reste traité localement sur votre ordinateur.
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                Windows & Linux
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Pack bureau prêt à l’emploi avec lanceur Bureau et pont USB-C inclus.
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                iPhone ↔ PC
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Double panneau côte à côte avec écriture directe dans votre dossier local.
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                SHA-256
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                Vérification d’intégrité, édition .plist/.json et archives .zip intégrées.
              </div>
            </div>
          </div>
        </section>

        {/* Interface Visual Gallery Section */}
        <section
          id="apercu"
          className="border-t border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/35 py-20 lg:py-28"
        >
          <div className="max-w-6xl mx-auto px-6 space-y-10">
            <div className="max-w-2xl space-y-3">
              <p className="text-xs font-medium text-blue-600 dark:text-blue-400">
                Aperçu de l’application
              </p>
              <h2
                className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100"
                style={{ textWrap: 'balance' }}
              >
                À quoi ressemble OpenFS sur votre ordinateur.
              </h2>
              <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 leading-relaxed">
                Parcourez les trois écrans clés du logiciel : le double panneau iPhone ↔ PC, la
                détection USB-C directe et la visionneuse avec inspecteur technique.
              </p>
            </div>

            {/* Active Large UI Preview */}
            <div className="max-w-3xl mx-auto space-y-4">
              <div className="p-2 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-[0_20px_50px_-15px_rgba(15,23,42,0.14)] dark:shadow-[0_20px_50px_-15px_rgba(0,0,0,0.55)] ring-1 ring-slate-900/5 dark:ring-white/5">
                <img
                  src={activePreview.src}
                  alt={activePreview.alt}
                  referrerPolicy="no-referrer"
                  className="w-full aspect-16/9 object-cover block rounded-xl border border-slate-200/70 dark:border-slate-800"
                />
              </div>

              <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 pt-1 px-1">
                <div className="flex items-baseline gap-2.5 shrink-0">
                  <span className="text-xs font-mono font-semibold text-blue-600 dark:text-blue-400">
                    {activePreview.step}
                  </span>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {activePreview.title}
                  </h3>
                </div>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 max-w-xl">
                  {activePreview.description}
                </p>
              </div>
            </div>

            {/* 3-Card Thumbnail Selector Strip */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {INTERFACE_PREVIEWS.map((preview, idx) => {
                const selected = idx === activePreviewIdx;
                return (
                  <button
                    key={preview.id}
                    type="button"
                    onClick={() => setActivePreviewIdx(idx)}
                    aria-pressed={selected}
                    className={`group text-left rounded-xl border p-3 transition-colors ${
                      selected
                        ? 'border-blue-600 dark:border-blue-500 bg-white dark:bg-slate-950 ring-1 ring-blue-600/20'
                        : 'border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-950/60 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="overflow-hidden rounded-lg border border-slate-200/80 dark:border-slate-800 mb-3 bg-slate-100 dark:bg-slate-900">
                      <img
                        src={preview.src}
                        alt={preview.alt}
                        referrerPolicy="no-referrer"
                        className="w-full aspect-16/9 object-cover group-hover:scale-[1.02] transition-transform duration-300"
                      />
                    </div>
                    <div className="space-y-1 px-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-xs font-mono font-semibold ${
                            selected
                              ? 'text-blue-600 dark:text-blue-400'
                              : 'text-slate-400 dark:text-slate-500'
                          }`}
                        >
                          {preview.step}
                        </span>
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {preview.title}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                        {preview.subtitle}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* 4 Illustrated Steps Section */}
        <section id="etapes" className="border-t border-slate-200 dark:border-slate-800 py-20 lg:py-28">
          <div className="max-w-6xl mx-auto px-6 space-y-20">
            <div className="max-w-2xl space-y-3">
              <p className="text-xs font-medium text-blue-600 dark:text-blue-400">
                Mode d’emploi illustré
              </p>
              <h2
                className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100"
                style={{ textWrap: 'balance' }}
              >
                Du câble USB-C au transfert sur votre disque dur en 4 étapes simples.
              </h2>
              <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 leading-relaxed">
                Suivez l’ordre ci-dessous : chaque étape correspond directement à un bouton clair
                dans l’interface d’OpenFS.
              </p>
            </div>

            {/* Step 01 */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-14 items-center">
              <div className="lg:col-span-6">
                <StudioImage
                  src={IMG_STEP_1}
                  alt="Gros plan studio sur un câble USB-C tressé branché dans le port d’un iPhone en titane"
                  caption="Étape 01 — Branchement USB-C direct"
                  className="aspect-4/3"
                />
              </div>
              <div className="lg:col-span-6 space-y-4">
                <div className="text-sm font-mono tabular-nums font-medium text-blue-600 dark:text-blue-400">
                  01. Connexion physique
                </div>
                <h3 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Branchez votre iPhone en USB-C sur votre ordinateur
                </h3>
                <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 leading-relaxed">
                  Reliez votre iPhone à un port USB-C (ou USB-A avec adaptateur) de votre PC Windows
                  ou Linux à l’aide d’un câble de données. Déverrouillez l’écran de l’iPhone et
                  appuyez sur{' '}
                  <strong className="font-semibold text-slate-900 dark:text-slate-100">
                    Faire confiance à cet ordinateur
                  </strong>{' '}
                  lorsque iOS vous le demande.
                </p>
                <div className="pt-2 text-xs font-mono text-slate-500 dark:text-slate-400">
                  Détection matérielle automatique : Apple Inc. (VID 0x05AC)
                </div>
              </div>
            </div>

            {/* Step 02 (Windows / Linux Desktop Pack) */}
            <div
              id="scripts"
              className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-14 items-center"
            >
              <div className="lg:col-span-6 order-2 lg:order-1 space-y-4">
                <div className="text-sm font-mono tabular-nums font-medium text-blue-600 dark:text-blue-400">
                  02. Installation bureau
                </div>
                <h3 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Téléchargez le pack bureau Windows ou Linux
                </h3>
                <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 leading-relaxed">
                  Téléchargez votre archive bureau dédiée : elle place le raccourci{' '}
                  <strong className="font-semibold text-slate-900 dark:text-slate-100">OpenFS</strong>{' '}
                  sur votre Bureau, ouvre l’application en fenêtre autonome et prépare votre dossier
                  de transfert local PC ↔ iPhone.
                </p>
                <div className="pt-2">
                  <button
                    type="button"
                    disabled={downloading}
                    onClick={() => handleDownloadDesktopApp(osTab)}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-colors whitespace-nowrap"
                  >
                    <Download size={14} />
                    Télécharger le pack {osLabel} (.zip)
                  </button>
                </div>
              </div>

              <div className="lg:col-span-6 order-1 lg:order-2">
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-6 space-y-5">
                  <div className="flex items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                      <Terminal size={16} className="text-blue-600 dark:text-blue-400" />
                      Choisissez votre ordinateur
                    </div>

                    <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-200/70 dark:bg-slate-800">
                      <button
                        type="button"
                        onClick={() => setOsTab('windows')}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                          osTab === 'windows'
                            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xs'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                        }`}
                      >
                        Windows 10/11
                      </button>
                      <button
                        type="button"
                        onClick={() => setOsTab('linux')}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                          osTab === 'linux'
                            ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-2xs'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                        }`}
                      >
                        Linux
                      </button>
                    </div>
                  </div>

                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {osTab === 'windows'
                      ? 'Archive OpenFS-Desktop-Windows.zip : lanceur bureau natif (sans PowerShell), création automatique du dossier OpenFS-iPhone-Sync et ouverture en fenêtre dédiée.'
                      : 'Archive OpenFS-Desktop-Linux.zip : lanceur .desktop + icône + script automatique usbmuxd / ifuse pour monter votre iPhone dans ~/iPhone-USB.'}
                  </p>

                  <ul className="space-y-2 text-xs text-slate-700 dark:text-slate-300 font-mono">
                    {osTab === 'windows' ? (
                      <>
                        <li className="flex items-center gap-2">
                          <Check size={14} className="text-blue-600 dark:text-blue-400 shrink-0" />
                          <span>OpenFS.bat — Lanceur Bureau Windows (zéro PowerShell)</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <Check size={14} className="text-blue-600 dark:text-blue-400 shrink-0" />
                          <span>OpenFS.url — Raccourci direct Bureau</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <Check size={14} className="text-blue-600 dark:text-blue-400 shrink-0" />
                          <span>LISEZ-MOI.txt — Guide rapide 3 étapes</span>
                        </li>
                      </>
                    ) : (
                      <>
                        <li className="flex items-center gap-2">
                          <Check size={14} className="text-blue-600 dark:text-blue-400 shrink-0" />
                          <span>installer-openfs-bureau.sh — Lanceur Bureau & Applications</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <Check size={14} className="text-blue-600 dark:text-blue-400 shrink-0" />
                          <span>openfs-usb-linux.sh — Montage USB-C usbmuxd / ifuse</span>
                        </li>
                        <li className="flex items-center gap-2">
                          <Check size={14} className="text-blue-600 dark:text-blue-400 shrink-0" />
                          <span>openfs.svg + LISEZ-MOI.txt</span>
                        </li>
                      </>
                    )}
                  </ul>

                  <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      Archive prête à décompresser :
                    </span>
                    <button
                      type="button"
                      disabled={downloading}
                      onClick={() => handleDownloadDesktopApp(osTab)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white disabled:opacity-60 transition-colors whitespace-nowrap"
                    >
                      <Download size={14} />
                      Télécharger {osTab === 'linux' ? 'OpenFS-Desktop-Linux.zip' : 'OpenFS-Desktop-Windows.zip'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Step 03 */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-14 items-center">
              <div className="lg:col-span-6">
                <StudioImage
                  src={IMG_STEP_3}
                  alt="Vue studio zénithale d’un iPhone relié en USB-C à un ordinateur portable en aluminium et un disque SSD externe"
                  caption="Étape 03 — Exploration complète des dossiers"
                  className="aspect-4/3"
                />
              </div>
              <div className="lg:col-span-6 space-y-4">
                <div className="text-sm font-mono tabular-nums font-medium text-blue-600 dark:text-blue-400">
                  03. Exploration libre
                </div>
                <h3 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Parcourez tous vos dossiers comme sur Android
                </h3>
                <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 leading-relaxed">
                  Retrouvez une vraie hiérarchie claire : photos{' '}
                  <code className="font-mono text-xs">/DCIM/100APPLE</code>, documents partagés des
                  apps, téléchargements, archives <code className="font-mono text-xs">.zip</code> et
                  fichiers cachés (<code className="font-mono text-xs">.nomedia</code>,{' '}
                  <code className="font-mono text-xs">.env</code>). Ouvrez vos images avec zoom,
                  lisez vos mémos vocaux ou modifiez un fichier{' '}
                  <code className="font-mono text-xs">.plist</code> et{' '}
                  <code className="font-mono text-xs">.json</code> directement dans l’éditeur
                  intégré.
                </p>
                <div className="pt-2 text-xs text-slate-500 dark:text-slate-400 flex flex-wrap gap-x-4 gap-y-1">
                  <span>Vue liste détaillée ou grille</span>
                  <span aria-hidden="true">·</span>
                  <span>Chemin POSIX éditable</span>
                  <span aria-hidden="true">·</span>
                  <span>Empreinte SHA-256</span>
                </div>
              </div>
            </div>

            {/* Step 04 */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-14 items-center">
              <div className="lg:col-span-6 order-2 lg:order-1 space-y-4">
                <div className="text-sm font-mono tabular-nums font-medium text-blue-600 dark:text-blue-400">
                  04. Transfert direct
                </div>
                <h3 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Copiez en un geste vers votre disque dur PC ou Linux
                </h3>
                <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 leading-relaxed">
                  OpenFS affiche votre{' '}
                  <strong className="font-semibold text-slate-900 dark:text-slate-100">
                    iPhone USB-C à gauche
                  </strong>{' '}
                  et votre{' '}
                  <strong className="font-semibold text-slate-900 dark:text-slate-100">
                    dossier PC / Linux à droite
                  </strong>
                  . Liez un vrai dossier de votre ordinateur (Bureau, Disque D:, SSD externe) :
                  chaque fichier glissé-déposé ou copié depuis l’iPhone est écrit immédiatement sur
                  votre disque dur, ou compressé en une archive{' '}
                  <code className="font-mono text-xs">.zip</code> complète.
                </p>
                <div className="pt-2 text-xs text-slate-500 dark:text-slate-400 flex flex-wrap gap-x-4 gap-y-1">
                  <span>Double panneau bidirectionnel</span>
                  <span aria-hidden="true">·</span>
                  <span>Écriture disque directe</span>
                  <span aria-hidden="true">·</span>
                  <span>Sauvegarde ZIP en 1 clic</span>
                </div>
              </div>

              <div className="lg:col-span-6 order-1 lg:order-2">
                <StudioImage
                  src={IMG_STEP_4}
                  alt="Ordinateur portable graphite ouvert à côté d’un iPhone relié par câble USB-C sur un bureau architectural clair"
                  caption="Étape 04 — Transfert direct iPhone vers PC"
                  className="aspect-4/3"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Before / After Comparison Table */}
        <section
          id="comparatif"
          className="border-t border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/35 py-20 lg:py-28"
        >
          <div className="max-w-6xl mx-auto px-6">
            <div className="max-w-2xl space-y-3 mb-12">
              <p className="text-xs font-medium text-blue-600 dark:text-blue-400">Avant / Après</p>
              <h2
                className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100"
                style={{ textWrap: 'balance' }}
              >
                Ce qui change quand vous branchez votre iPhone sur PC ou Linux.
              </h2>
              <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 leading-relaxed">
                Comparaison concrète entre l’expérience USB-C par défaut sur un ordinateur non-Apple
                et le flux de travail unifié d’OpenFS.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-white dark:bg-slate-950">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/70 text-xs font-semibold text-slate-600 dark:text-slate-400">
                      <th className="py-4 px-5 w-1/4">Usage quotidien</th>
                      <th className="py-4 px-5 w-[37.5%]">Sans OpenFS (comportement natif)</th>
                      <th className="py-4 px-5 w-[37.5%] text-blue-700 dark:text-blue-400">
                        Avec OpenFS (USB-C)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
                    {COMPARISON_ROWS.map((row) => (
                      <tr
                        key={row.criterion}
                        className="align-top hover:bg-slate-50/70 dark:hover:bg-slate-900/40 transition-colors"
                      >
                        <td className="py-4 px-5 font-semibold text-slate-900 dark:text-slate-100">
                          {row.criterion}
                        </td>
                        <td className="py-4 px-5 text-slate-600 dark:text-slate-400 leading-relaxed">
                          <div className="flex items-start gap-2.5">
                            <Minus
                              size={15}
                              className="shrink-0 mt-1 text-slate-400 dark:text-slate-600"
                            />
                            <span>{row.before}</span>
                          </div>
                        </td>
                        <td className="py-4 px-5 text-slate-800 dark:text-slate-200 leading-relaxed">
                          <div className="flex items-start gap-2.5">
                            <Check
                              size={16}
                              className="shrink-0 mt-0.5 text-blue-600 dark:text-blue-400"
                            />
                            <span>{row.after}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        {/* Client FAQ on Security & iOS Limits */}
        <section id="faq" className="border-t border-slate-200 dark:border-slate-800 py-20 lg:py-28">
          <div className="max-w-4xl mx-auto px-6">
            <div className="max-w-2xl space-y-3 mb-12">
              <p className="text-xs font-medium text-blue-600 dark:text-blue-400">
                Questions fréquentes
              </p>
              <h2
                className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100"
                style={{ textWrap: 'balance' }}
              >
                Sécurité, compatibilité et limites réelles d’iOS.
              </h2>
              <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400 leading-relaxed">
                Des réponses directes et transparentes avant de brancher votre téléphone.
              </p>
            </div>

            <div className="divide-y divide-slate-200 dark:divide-slate-800 border-y border-slate-200 dark:border-slate-800">
              {FAQ_ITEMS.map((item, idx) => {
                const isOpen = openFaqIndex === idx;
                return (
                  <div key={item.q}>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => setOpenFaqIndex(isOpen ? -1 : idx)}
                      className="w-full py-5 flex items-center justify-between gap-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40 rounded-md"
                    >
                      <span className="text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-100">
                        {item.q}
                      </span>
                      <ChevronDown
                        size={18}
                        className={`shrink-0 text-slate-500 transition-transform duration-200 ${
                          isOpen ? 'rotate-180 text-blue-600 dark:text-blue-400' : ''
                        }`}
                      />
                    </button>
                    {isOpen && (
                      <div className="pb-5 pr-8 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                        {item.a}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Final Conversion Block */}
        <section className="max-w-6xl mx-auto px-6 pb-20 lg:pb-24">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-900 text-white p-8 sm:p-12 lg:p-14 flex flex-col lg:flex-row lg:items-center justify-between gap-8">
            <div className="space-y-3 max-w-xl">
              <div className="flex items-center gap-2 text-xs font-medium text-blue-300">
                <ShieldCheck size={15} />
                <span>Windows & Linux · 100 % local · Hors-ligne</span>
              </div>
              <h2
                className="text-2xl sm:text-3xl font-bold tracking-tight text-white"
                style={{ textWrap: 'balance' }}
              >
                Prêt à installer OpenFS sur votre bureau ?
              </h2>
              <p className="text-sm text-slate-300 leading-relaxed">
                Téléchargez le pack bureau pour Windows ou Linux en un clic, créez votre raccourci
                en fenêtre dédiée et connectez votre câble USB-C.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
              <button
                type="button"
                disabled={downloading}
                onClick={() => handleDownloadDesktopApp(osTab)}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-60 transition-colors whitespace-nowrap"
              >
                <Download size={16} />
                Télécharger pour {osLabel}
              </button>
              <button
                type="button"
                disabled={downloading}
                onClick={() =>
                  handleDownloadDesktopApp(osTab === 'windows' ? 'linux' : 'windows')
                }
                className="inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-medium rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 disabled:opacity-60 transition-colors whitespace-nowrap"
              >
                Version {osTab === 'windows' ? 'Linux (.zip)' : 'Windows (.zip)'}
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-4">
            <span className="font-bold text-sm text-slate-900 dark:text-slate-100">OpenFS</span>
            <span>Traitement 100 % local sur votre ordinateur</span>
          </div>

          <div className="flex items-center gap-5">
            <a href="#apercu" className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors">
              Aperçu
            </a>
            <a href="#etapes" className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors">
              Étapes
            </a>
            <a href="#comparatif" className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors">
              Avant / Après
            </a>
            <a href="#faq" className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors">
              FAQ
            </a>
            <button
              type="button"
              onClick={onToggleDarkMode}
              aria-label={darkMode ? 'Passer en mode clair' : 'Passer en mode sombre'}
              className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
            >
              {darkMode ? <Sun size={14} /> : <Moon size={14} />}
              {darkMode ? 'Clair' : 'Sombre'}
            </button>
          </div>
        </div>
      </footer>

      {/* Download Confirmation & Quick Setup Modal */}
      {downloadModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          onClick={() => setDownloadModal(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                  <Check size={18} />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Téléchargement lancé
                  </h2>
                  <p className="text-xs font-mono text-slate-500 dark:text-slate-400">
                    {downloadModal.filename}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDownloadModal(null)}
                aria-label="Fermer"
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:hover:text-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-5 text-sm">
              <ol className="space-y-3 text-slate-700 dark:text-slate-300">
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-mono font-semibold flex items-center justify-center shrink-0 mt-0.5">
                    1
                  </span>
                  <p className="leading-relaxed">
                    Ouvrez votre dossier{' '}
                    <strong className="font-semibold text-slate-900 dark:text-slate-100">
                      Téléchargements
                    </strong>{' '}
                    {downloadModal.isNativeExe ? (
                      <>
                        et lancez <code className="font-mono text-xs">{downloadModal.filename}</code>.
                      </>
                    ) : (
                      <>
                        et décompressez <code className="font-mono text-xs">{downloadModal.filename}</code>.
                      </>
                    )}
                  </p>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-mono font-semibold flex items-center justify-center shrink-0 mt-0.5">
                    2
                  </span>
                  <p className="leading-relaxed">
                    {downloadModal.isNativeExe ? (
                      <>
                        Suivez l’assistant d’installation Windows : il place automatiquement{' '}
                        <strong>OpenFS</strong> sur votre Bureau et dans le menu Démarrer (100 %
                        hors-ligne, sans navigateur).
                      </>
                    ) : downloadModal.os === 'windows' ? (
                      <>
                        Double-cliquez sur{' '}
                        <code className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                          OpenFS.bat
                        </code>{' '}
                        (ou <code className="font-mono text-xs">OpenFS.url</code>) pour copier le
                        lanceur <strong>OpenFS</strong> sur votre Bureau Windows et l’ouvrir en
                        fenêtre dédiée.
                      </>
                    ) : (
                      <>
                        Exécutez{' '}
                        <code className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                          chmod +x *.sh && ./installer-openfs-bureau.sh
                        </code>{' '}
                        pour créer le lanceur <strong>OpenFS</strong> sur votre Bureau Linux.
                      </>
                    )}
                  </p>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-mono font-semibold flex items-center justify-center shrink-0 mt-0.5">
                    3
                  </span>
                  <p className="leading-relaxed">
                    {downloadModal.os === 'windows'
                      ? 'Branchez votre iPhone en USB-C, appuyez sur « Faire confiance » sur l’iPhone, puis cliquez sur Détecter l’iPhone dans OpenFS.'
                      : 'Branchez votre iPhone en USB-C et lancez ./openfs-usb-linux.sh inclus dans le dossier pour monter ~/iPhone-USB.'}
                  </p>
                </li>
              </ol>

              <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() =>
                    handleDownloadDesktopApp(downloadModal.os === 'windows' ? 'linux' : 'windows')
                  }
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 underline underline-offset-2"
                >
                  <HardDrive size={13} />
                  Télécharger plutôt pour {downloadModal.os === 'windows' ? 'Linux' : 'Windows'}
                </button>

                <button
                  type="button"
                  onClick={() => setDownloadModal(null)}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors whitespace-nowrap"
                >
                  Terminé
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
