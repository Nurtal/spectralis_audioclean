import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Précharge les polices émises par le build.
 *
 * Sans ça, le navigateur ne découvre les `@font-face` qu'après avoir analysé la
 * feuille de styles, et le titre du hero se redessine quand Archivo arrive :
 * 0.36 de décalage cumulé au compteur Lighthouse. Les cinq fichiers sont tous
 * utilisés au-dessus de la ligne de flottaison, il n'y a rien à trier.
 *
 * Les chemins restent relatifs (`./assets/…`) pour survivre à un déploiement
 * dans un sous-dossier.
 */
function preloadFonts(): Plugin {
  return {
    name: 'preload-fonts',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(_html, ctx) {
      const fonts = Object.keys(ctx.bundle ?? {}).filter((name) => name.endsWith('.woff2'));
      return fonts.map((href) => ({
        tag: 'link',
        attrs: {
          rel: 'preload',
          as: 'font',
          type: 'font/woff2',
          href: `./${href}`,
          crossorigin: '',
        },
        injectTo: 'head-prepend' as const,
      }));
    },
  };
}

// base: './' → le site marche aussi bien à la racine d'un domaine que dans un
// sous-chemin GitHub Pages, sans reconfiguration.
export default defineConfig({
  base: './',
  plugins: [react(), preloadFonts()],
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: { react: ['react', 'react-dom'] },
      },
    },
  },
  // Worker en module ES : import dynamique du chargeur RNNoise possible depuis
  // le worker, sans bundler le WASM dans le chunk d'entrée.
  worker: { format: 'es' },
});
