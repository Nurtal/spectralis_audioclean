/**
 * Chargement paresseux du module RNNoise.
 *
 * Le binaire (~110 Ko) n'est demandé qu'au premier traitement en mode neural :
 * il ne pèse rien sur le premier rendu. Le module est un ESM compilé par
 * Emscripten, chargé par import dynamique depuis une URL publique — il ne
 * traverse jamais le bundler, donc aucune surprise de découpage de chunks.
 *
 * L'URL vient du thread principal : c'est lui qui connaît `document.baseURI`,
 * et donc le sous-chemin réel du déploiement (racine de domaine ou GitHub Pages).
 */

export interface RnnoiseModule {
  _rnnoise_create(model?: number): number;
  _rnnoise_destroy(state: number): void;
  _rnnoise_process_frame(state: number, output: number, input: number): number;
  _malloc(bytes: number): number;
  _free(ptr: number): void;
  HEAPF32: Float32Array;
}

type GlueModule = {
  default: (options: { locateFile?: (path: string) => string }) => Promise<RnnoiseModule>;
};

let pending: Promise<RnnoiseModule> | null = null;
let loadedFrom: string | null = null;

export function loadRnnoise(glueUrl: string): Promise<RnnoiseModule> {
  if (pending && loadedFrom === glueUrl) return pending;
  loadedFrom = glueUrl;
  pending = (async () => {
    const glue = (await import(/* @vite-ignore */ glueUrl)) as GlueModule;
    if (typeof glue.default !== 'function') {
      throw new Error('module RNNoise inattendu : pas de fabrique par défaut');
    }
    return glue.default({
      locateFile: (path: string) => new URL(path, glueUrl).href,
    });
  })();
  pending.catch(() => {
    // Un échec ne doit pas rester mémorisé : l'utilisateur peut relancer.
    pending = null;
    loadedFrom = null;
  });
  return pending;
}

/** Le module a-t-il déjà été chargé ? Sert à ne pas annoncer un téléchargement qui n'aura pas lieu. */
export function isRnnoiseLoaded(): boolean {
  return pending !== null;
}
