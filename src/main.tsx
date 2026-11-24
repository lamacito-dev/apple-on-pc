import {createRoot, hydrateRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import App from './App.tsx';
import './index.css';

if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      updateSW(true);
    },
  });
}

const rootEl = document.getElementById('root')!;

// The public landing page is pre-rendered to HTML at build time (scripts/prerender.mjs) for search
// engines. Hydrate it when App will render that same landing page (light theme, no #app route);
// otherwise discard the static markup and render normally.
function canHydrateLanding(): boolean {
  if (rootEl.getAttribute('data-prerendered') !== 'landing') return false;
  if (window.location.hash.startsWith('#app')) return false;
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  if (standalone) return false;
  try {
    if (localStorage.getItem('openfs_theme') === 'dark') return false;
  } catch {
    // localStorage unavailable: the app defaults to the light theme, same as the static markup
  }
  return true;
}

if (canHydrateLanding()) {
  hydrateRoot(rootEl, <App />);
} else {
  rootEl.removeAttribute('data-prerendered');
  rootEl.replaceChildren();
  createRoot(rootEl).render(<App />);
}
