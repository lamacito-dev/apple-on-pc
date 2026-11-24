// Server-side entry used at build time only (scripts/prerender.mjs): renders the public landing
// page to static HTML so search engines and link previews see the full text without JavaScript.
// It must render exactly what <App /> renders on first load of "/" (light theme), so the browser
// can hydrate it without redrawing anything.
import { renderToString } from 'react-dom/server';
import { SalesLandingPage } from './components/SalesLandingPage';

export function renderLanding(): string {
  return renderToString(<SalesLandingPage darkMode={false} onToggleDarkMode={() => {}} />);
}
