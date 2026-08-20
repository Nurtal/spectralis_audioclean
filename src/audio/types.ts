/** Types partagés de la chaîne audio. Aucun import React, aucun accès DOM. */

export type DenoiseMode = 'neural' | 'soft' | 'off';

export interface PipelineOptions {
  denoise: DenoiseMode;
  /** 0..1 — dosage du débruitage (mélange sec/traité pour RNNoise, β pour le gate). */
  strength: number;
  highpass: boolean;
  deesser: boolean;
  gate: boolean;
  loudness: boolean;
}

export const DEFAULT_OPTIONS: PipelineOptions = {
  denoise: 'neural',
  strength: 0.85,
  highpass: true,
  deesser: true,
  gate: true,
  loudness: true,
};

export type StageName =
  | 'analyse-source'
  | 'passe-haut'
  | 'debruitage'
  | 'de-esser'
  | 'gate'
  | 'normalisation'
  | 'analyse-resultat';

export const STAGE_LABELS: Record<StageName, string> = {
  'analyse-source': 'Mesure du fichier d’origine',
  'passe-haut': 'Coupe des infra-graves',
  debruitage: 'Retrait du bruit de fond',
  'de-esser': 'Adoucissement des sifflantes',
  gate: 'Fermeture des silences',
  normalisation: 'Mise à niveau',
  'analyse-resultat': 'Mesure du résultat',
};

export interface Metrics {
  /** Loudness intégré, BS.1770-4, mono G = 1.0. */
  lufs: number;
  /** Crête vraie, sur-échantillonnage ×4. */
  truePeakDb: number;
  /** Crête échantillon. */
  peakDb: number;
  rmsDb: number;
  /** Percentile 10 de l'énergie par trame : ce qu'on entend « entre les mots ». */
  noiseFloorDb: number;
  /** Parole vs. silences, en dB. Estimation, pas une mesure normalisée. */
  snrDb: number;
  /** Crête / RMS : la dynamique restante. */
  crestFactorDb: number;
  dcOffset: number;
}

export interface SpectrogramData {
  /** Magnitudes normalisées 0..255, ligne 0 = fréquence haute. width × height. */
  data: Uint8Array;
  width: number;
  height: number;
  minDb: number;
  maxDb: number;
  minHz: number;
  maxHz: number;
}

export interface VadSegment {
  /** Secondes. */
  start: number;
  end: number;
}

export interface AudioAnalysis {
  /** Paires [min, max] par colonne : 2 × peakCount valeurs. */
  peaks: Float32Array;
  peakCount: number;
  spectrogram: SpectrogramData;
  metrics: Metrics;
  vad: VadSegment[];
  /** Part de la durée classée « parole ». */
  speechRatio: number;
  durationS: number;
  sampleRate: number;
}

export interface ProcessResult {
  processed: Float32Array;
  before: AudioAnalysis;
  after: AudioAnalysis;
  /** Mode réellement appliqué (RNNoise peut retomber sur le gate spectral). */
  appliedDenoise: DenoiseMode;
  /** Renseigné si le mode demandé n'a pas pu être honoré. */
  denoiseNotice?: string;
  /** Gain d'égalisation de niveau pour la comparaison A/B, en dB. */
  loudnessMatchDb: number;
  elapsedMs: number;
}

export interface DecodedAudio {
  samples: Float32Array;
  sampleRate: number;
  durationS: number;
  /** Durée du fichier d'origine avant troncature. */
  originalDurationS: number;
  truncated: boolean;
  name: string;
  bytes: number;
}
