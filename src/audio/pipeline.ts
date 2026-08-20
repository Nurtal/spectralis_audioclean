import type { AudioAnalysis, PipelineOptions, ProcessResult, StageName } from './types';
import { computePeaks } from './analysis/peaks';
import { computeSpectrogram } from './analysis/spectrogram';
import { computeMetrics } from './analysis/metrics';
import { detectVoiceActivity, type VadResult } from './analysis/vad';
import { highpass } from './stages/highpass';
import { denoise } from './stages/denoise';
import { deesser } from './stages/deesser';
import { gate } from './stages/gate';
import { normalizeLoudness } from './stages/loudness';

/** Colonnes de waveform pré-calculées : au-delà, l'écran ne suit plus. */
const PEAK_COLUMNS = 2000;

export interface PipelineContext {
  rnnoiseUrl?: string;
  onProgress?: (stage: StageName, progress: number) => void;
}

export function analyze(
  samples: Float32Array,
  sampleRate: number,
  precomputedVad?: VadResult,
): AudioAnalysis {
  const vad = precomputedVad ?? detectVoiceActivity(samples, sampleRate);
  return {
    peaks: computePeaks(samples, PEAK_COLUMNS),
    peakCount: PEAK_COLUMNS,
    spectrogram: computeSpectrogram(samples, sampleRate),
    metrics: computeMetrics(samples, sampleRate, vad),
    vad: vad.segments,
    speechRatio: vad.speechRatio,
    durationS: samples.length / sampleRate,
    sampleRate,
  };
}

/**
 * Poids relatifs des étapes dans la barre de progression.
 *
 * Ce ne sont pas des parts égales : mesurer coûte cher (FFT sur toute la
 * durée), le passe-haut ne coûte rien. Une barre qui avance vite puis se fige
 * ment plus qu'elle n'informe.
 */
const STAGE_WEIGHTS: Record<StageName, number> = {
  'analyse-source': 22,
  'passe-haut': 2,
  debruitage: 30,
  'de-esser': 4,
  gate: 3,
  normalisation: 17,
  'analyse-resultat': 22,
};

const TOTAL_WEIGHT = Object.values(STAGE_WEIGHTS).reduce((a, b) => a + b, 0);

/**
 * Enchaîne les étapes et émet la progression.
 *
 * L'ordre n'est pas négociable : on coupe l'inaudible avant de débruiter (le
 * débruiteur n'a pas à dépenser son budget sur du rumble), on débruite avant
 * de comprimer (sinon le de-esser réagit au souffle), et on normalise en
 * dernier — c'est la seule étape qui doit voir le signal final.
 */
export async function runPipeline(
  samples: Float32Array,
  sampleRate: number,
  options: PipelineOptions,
  context: PipelineContext = {},
): Promise<ProcessResult> {
  const startedAt = Date.now();
  const { onProgress, rnnoiseUrl } = context;

  let completedWeight = 0;
  const report = (stage: StageName, local: number) => {
    if (!onProgress) return;
    const total = (completedWeight + STAGE_WEIGHTS[stage] * local) / TOTAL_WEIGHT;
    onProgress(stage, Math.min(1, Math.max(0, total)));
  };
  const finish = (stage: StageName) => {
    completedWeight += STAGE_WEIGHTS[stage];
  };

  report('analyse-source', 0);
  // Le VAD sert deux fois : à l'analyse affichée, et au débruiteur pour savoir
  // où écouter le bruit. On ne le calcule qu'une fois.
  const sourceVad = detectVoiceActivity(samples, sampleRate);
  const before = analyze(samples, sampleRate, sourceVad);
  finish('analyse-source');
  report('passe-haut', 0);

  let current = samples;

  if (options.highpass) {
    current = highpass(current, sampleRate);
  }
  finish('passe-haut');

  report('debruitage', 0);
  const denoised = await denoise(current, {
    mode: options.denoise,
    strength: options.strength,
    sampleRate,
    vad: sourceVad,
    rnnoiseUrl,
    onProgress: (p) => report('debruitage', p),
  });
  current = denoised.samples;
  finish('debruitage');

  report('de-esser', 0);
  if (options.deesser) {
    current = deesser(current, sampleRate);
  }
  finish('de-esser');

  report('gate', 0);
  if (options.gate) {
    current = gate(current, sampleRate);
  }
  finish('gate');

  report('normalisation', 0);
  if (options.loudness) {
    current = normalizeLoudness(current, sampleRate).samples;
  }
  finish('normalisation');

  report('analyse-resultat', 0);
  const after = analyze(current, sampleRate);
  finish('analyse-resultat');
  report('analyse-resultat', 1);

  // Compensation A/B : de combien il faut baisser le traité pour qu'il arrive
  // à l'oreille au même niveau que l'original. Sans ça, « plus fort » se
  // confond avec « meilleur », et la démo ment.
  const loudnessMatchDb =
    Number.isFinite(before.metrics.lufs) && Number.isFinite(after.metrics.lufs)
      ? before.metrics.lufs - after.metrics.lufs
      : 0;

  return {
    processed: current,
    before,
    after,
    appliedDenoise: denoised.applied,
    denoiseNotice: denoised.notice,
    loudnessMatchDb,
    elapsedMs: Date.now() - startedAt,
  };
}
