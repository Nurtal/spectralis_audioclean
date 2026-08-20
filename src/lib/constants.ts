/** RNNoise est figé à cette fréquence : tout le pipeline s'y aligne. */
export const SAMPLE_RATE = 48_000;

/** RNNoise traite par trames de 480 échantillons (10 ms à 48 kHz). */
export const RNNOISE_FRAME = 480;

/** Démo plafonnée : au-delà on tronque, et on le dit. */
export const MAX_DURATION_S = 90;

/** Rejet propre au-delà, avant même de décoder. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** Cible de normalisation : plateformes de podcast / voix parlée. */
export const TARGET_LUFS = -16;

/** Plafond crête vraie, marge de sécurité pour l'encodage lossy aval. */
export const TRUE_PEAK_CEILING_DBTP = -1;

/** Analyse spectrale : Hann 2048, recouvrement 75 %. */
export const FFT_SIZE = 2048;
export const HOP_SIZE = 512;

/** Passe-haut de nettoyage : rumble, plosives, bruit de table. */
export const HIGHPASS_HZ = 80;

/** Bande de sifflantes travaillée par le de-esser. */
export const DEESSER_LOW_HZ = 5_000;
export const DEESSER_HIGH_HZ = 9_000;

/** Crossfade de la bascule A/B. Plus court : ça claque. Plus long : ça flotte. */
export const AB_CROSSFADE_S = 0.012;

/** Plancher de gain du masque spectral (évite le « musical noise »). */
export const SPECTRAL_FLOOR_DB = -18;

/** Sur-soustraction du gate spectral. */
export const SPECTRAL_BETA = 1.5;

/** Formats que decodeAudioData couvre de façon fiable. */
export const ACCEPTED_EXTENSIONS = ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'webm'] as const;
