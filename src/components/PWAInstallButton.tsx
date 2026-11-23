import { useState } from 'react';
import { Download, PlusSquare, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'sidebar' | 'compact';
  onActionComplete?: () => void;
}

export function PWAInstallButton({
  variant = 'sidebar',
  onActionComplete,
}: PWAInstallButtonProps) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      await install();
      onActionComplete?.();
      return;
    }
    setShowGuide(true);
  };

  const label = isInstallable
    ? "Installer l'application"
    : isIOS
      ? 'Installer sur iPhone'
      : 'Installer sur iOS / App';

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={
          variant === 'compact'
            ? 'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0'
            : 'w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white transition-colors whitespace-nowrap'
        }
      >
        {isInstallable ? <Download size={14} /> : <Smartphone size={14} />}
        {label}
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 backdrop-blur-xs p-4"
          onClick={() => setShowGuide(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <img
                  src="/apple-touch-icon.png"
                  alt="Icône OpenFS"
                  className="w-8 h-8 rounded-lg border border-slate-200 dark:border-slate-700"
                />
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Installer OpenFS sur iPhone / iPad
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Mode plein écran et accès hors-ligne
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Fermer le guide d'installation"
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:hover:text-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4 text-sm text-slate-700 dark:text-slate-300">
              <ol className="space-y-3.5">
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-mono font-semibold flex items-center justify-center shrink-0 mt-0.5">
                    1
                  </span>
                  <p className="text-xs sm:text-sm leading-relaxed">
                    Ouvre cette page dans <strong className="font-semibold text-slate-900 dark:text-slate-100">Safari</strong> sur ton iPhone ou iPad.
                  </p>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-mono font-semibold flex items-center justify-center shrink-0 mt-0.5">
                    2
                  </span>
                  <p className="text-xs sm:text-sm leading-relaxed">
                    Appuie sur le bouton <strong className="font-semibold text-slate-900 dark:text-slate-100 inline-flex items-center gap-1 align-middle"><Share size={14} className="text-blue-600 dark:text-blue-400" /> Partager</strong> dans la barre inférieure de Safari.
                  </p>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-mono font-semibold flex items-center justify-center shrink-0 mt-0.5">
                    3
                  </span>
                  <p className="text-xs sm:text-sm leading-relaxed">
                    Fais défiler le menu et choisis <strong className="font-semibold text-slate-900 dark:text-slate-100 inline-flex items-center gap-1 align-middle"><PlusSquare size={14} className="text-blue-600 dark:text-blue-400" /> Sur l’écran d’accueil</strong>, puis confirme avec <strong className="font-semibold text-slate-900 dark:text-slate-100">Ajouter</strong>.
                  </p>
                </li>
              </ol>

              <p className="text-xs text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-200 dark:border-slate-800 leading-relaxed">
                OpenFS s’ouvrira ensuite depuis ton écran d’accueil sans barre de navigation et restera disponible même en mode avion.
              </p>

              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowGuide(false);
                    onActionComplete?.();
                  }}
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                >
                  Compris
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
