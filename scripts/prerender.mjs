// Injects the server-rendered landing page into dist/index.html after `vite build`.
// Skipped for the desktop (Electron) build, which opens the app screen directly.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

if (process.env.DESKTOP_BUILD === 'true') {
  console.log('[prerender] Build bureau : pré-rendu ignoré.');
  process.exit(0);
}

const root = process.cwd();
const distIndex = path.join(root, 'dist', 'index.html');
const ssrEntry = path.join(root, 'dist-ssr', 'entry-server.js');

await build({
  logLevel: 'warn',
  build: { ssr: 'src/entry-server.tsx', outDir: 'dist-ssr', emptyOutDir: true },
});
const { renderLanding } = await import(pathToFileURL(ssrEntry).href);
const appHtml = renderLanding();

const marker = '<div id="root"></div>';
const html = fs.readFileSync(distIndex, 'utf8');
if (!html.includes(marker)) {
  throw new Error('[prerender] <div id="root"></div> introuvable dans dist/index.html');
}
// With pre-rendered text, the page paints before the web fonts arrive, so visitors briefly saw a
// fallback font (~170 ms on a 4G-like connection) before Plus Jakarta Sans swapped in.
// Preload the Latin font files used by the page so they download alongside the stylesheet.
const fontFiles = fs
  .readdirSync(path.join(root, 'dist', 'assets'))
  .filter((f) => /^(plus-jakarta-sans-latin-(400|500|600|700)|jetbrains-mono-latin-(400|500))-normal-.*\.woff2$/.test(f))
  .sort();
const fontPreloads = fontFiles
  .map((f) => `    <link rel="preload" href="/assets/${f}" as="font" type="font/woff2" crossorigin />`)
  .join('\n');
const withPreloads = fontPreloads
  ? html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n${fontPreloads}`)
  : html;
fs.writeFileSync(
  distIndex,
  withPreloads.replace(marker, `<div id="root" data-prerendered="landing">${appHtml}</div>`)
);
console.log(`[prerender] ${fontFiles.length} polices préchargées.`);
fs.rmSync(path.join(root, 'dist-ssr'), { recursive: true, force: true });

const words = appHtml.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
console.log(`[prerender] Page d'accueil pré-rendue (${words} mots de texte dans le HTML).`);
