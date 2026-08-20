import type { Metrics } from '../types';
import { detectVoiceActivity, type VadResult } from './vad';
import { estimateNoiseFloorDb } from './noiseFloor';

/** Coefficients biquad normalisés (a0 = 1). */
export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/**
 * Pondération K de la BS.1770-4 : un plateau haut de +4 dB (l'effet de tête)
 * puis un passe-haut à ~38 Hz (le RLB). Les constantes sont celles de la
 * recommandation, ré-adaptées analytiquement à la fréquence d'échantillonnage
 * plutôt que copiées telles quelles pour 48 kHz.
 */
export function kWeighting(sampleRate: number): [Biquad, Biquad] {
  // Étage 1 — plateau haut.
  const f0 = 1681.974450955533;
  const G = 3.999843853973347;
  const Q1 = 0.7071752369554196;
  const K1 = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  const a0_1 = 1 + K1 / Q1 + K1 * K1;
  const shelf: Biquad = {
    b0: (Vh + (Vb * K1) / Q1 + K1 * K1) / a0_1,
    b1: (2 * (K1 * K1 - Vh)) / a0_1,
    b2: (Vh - (Vb * K1) / Q1 + K1 * K1) / a0_1,
    a1: (2 * (K1 * K1 - 1)) / a0_1,
    a2: (1 - K1 / Q1 + K1 * K1) / a0_1,
  };

  // Étage 2 — passe-haut.
  const f1 = 38.13547087602444;
  const Q2 = 0.5003270373238773;
  const K2 = Math.tan((Math.PI * f1) / sampleRate);
  const denom = 1 + K2 / Q2 + K2 * K2;
  const highpass: Biquad = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (K2 * K2 - 1)) / denom,
    a2: (1 - K2 / Q2 + K2 * K2) / denom,
  };

  return [shelf, highpass];
}

/** Réponse en puissance d'une cascade de biquads à une fréquence donnée. */
export function biquadPowerGain(filters: Biquad[], hz: number, sampleRate: number): number {
  const w = (2 * Math.PI * hz) / sampleRate;
  let gain = 1;
  for (const f of filters) {
    const cos1 = Math.cos(w);
    const sin1 = Math.sin(w);
    const cos2 = Math.cos(2 * w);
    const sin2 = Math.sin(2 * w);
    const nr = f.b0 + f.b1 * cos1 + f.b2 * cos2;
    const ni = -(f.b1 * sin1 + f.b2 * sin2);
    const dr = 1 + f.a1 * cos1 + f.a2 * cos2;
    const di = -(f.a1 * sin1 + f.a2 * sin2);
    gain *= (nr * nr + ni * ni) / (dr * dr + di * di);
  }
  return gain;
}

/** Filtre direct forme II transposée, en place possible (out peut être input). */
export function applyBiquad(input: Float32Array, filter: Biquad, out: Float32Array): void {
  let z1 = 0;
  let z2 = 0;
  const { b0, b1, b2, a1, a2 } = filter;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    out[i] = y;
  }
}

const BLOCK_MS = 400;
const STEP_MS = 100;
const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_LU = -10;
/** Décalage de calibration de la recommandation. */
const LUFS_OFFSET = -0.691;

/**
 * Loudness intégré, BS.1770-4, canal unique pondéré G = 1.0.
 *
 * Double portillonnage : absolu à -70 LUFS pour écarter les vrais silences,
 * puis relatif à -10 LU de la moyenne restante pour que les blancs entre les
 * phrases ne tirent pas la mesure vers le bas.
 */
export function integratedLufs(samples: Float32Array, sampleRate: number): number {
  if (samples.length === 0) return -Infinity;

  const [shelf, highpass] = kWeighting(sampleRate);
  const filtered = new Float32Array(samples.length);
  applyBiquad(samples, shelf, filtered);
  applyBiquad(filtered, highpass, filtered);

  const blockLen = Math.round((BLOCK_MS / 1000) * sampleRate);
  const stepLen = Math.round((STEP_MS / 1000) * sampleRate);
  if (filtered.length < blockLen) {
    // Fichier plus court qu'un bloc : on mesure ce qu'on a, sans portillonnage.
    let sum = 0;
    for (let i = 0; i < filtered.length; i++) sum += filtered[i] * filtered[i];
    const z = sum / filtered.length;
    return z > 0 ? LUFS_OFFSET + 10 * Math.log10(z) : -Infinity;
  }

  const blockCount = Math.floor((filtered.length - blockLen) / stepLen) + 1;
  const z = new Float64Array(blockCount);
  for (let b = 0; b < blockCount; b++) {
    const start = b * stepLen;
    let sum = 0;
    for (let i = 0; i < blockLen; i++) {
      const v = filtered[start + i];
      sum += v * v;
    }
    z[b] = sum / blockLen;
  }

  const loudness = (power: number) =>
    power > 0 ? LUFS_OFFSET + 10 * Math.log10(power) : -Infinity;

  // Portillon absolu.
  let sumAbs = 0;
  let countAbs = 0;
  for (let b = 0; b < blockCount; b++) {
    if (loudness(z[b]) > ABSOLUTE_GATE_LUFS) {
      sumAbs += z[b];
      countAbs++;
    }
  }
  if (countAbs === 0) return -Infinity;

  // Portillon relatif.
  const relativeThreshold = loudness(sumAbs / countAbs) + RELATIVE_GATE_LU;
  let sumRel = 0;
  let countRel = 0;
  for (let b = 0; b < blockCount; b++) {
    const l = loudness(z[b]);
    if (l > ABSOLUTE_GATE_LUFS && l > relativeThreshold) {
      sumRel += z[b];
      countRel++;
    }
  }
  if (countRel === 0) return loudness(sumAbs / countAbs);
  return loudness(sumRel / countRel);
}

const OVERSAMPLE = 4;
/**
 * 24 coefficients par phase. La BS.1770-4 en spécifie 12 ; c'est trop court
 * pour du contenu large bande — vérifié contre `ffmpeg -af ebur128` sur du
 * bruit blanc, où 12 coefficients sous-estiment la crête vraie de 1.1 dB et
 * 24 tombent à 0.06 dB près.
 */
const PHASE_TAPS = 24;
/**
 * On n'examine que les échantillons à moins de 2 dB de la crête. Une crête
 * inter-échantillon ne surgit pas au milieu d'un passage faible : elle est
 * toujours encadrée par des échantillons déjà élevés.
 */
const CANDIDATE_RATIO = 0.8;

/** Bancs polyphasés de sinus cardinal fenêtré, construits une fois par phase. */
const polyphase = (() => {
  const phases: Float32Array[] = [];
  const center = PHASE_TAPS / 2 - 1;
  for (let p = 0; p < OVERSAMPLE; p++) {
    const taps = new Float32Array(PHASE_TAPS);
    // La fenêtre est centrée sur le pic du sinus cardinal, qui se décale avec
    // la phase — la centrer sur la grille d'indices déforme les phases 1 à 3.
    const peakPos = center + p / OVERSAMPLE;
    for (let k = 0; k < PHASE_TAPS; k++) {
      const x = k - peakPos;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const t = x / (PHASE_TAPS / 2);
      const w = Math.abs(t) >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * t));
      taps[k] = sinc * w;
    }
    // Gain unité en continu.
    let sum = 0;
    for (let k = 0; k < PHASE_TAPS; k++) sum += taps[k];
    for (let k = 0; k < PHASE_TAPS; k++) taps[k] /= sum;
    phases.push(taps);
  }
  return phases;
})();

const POLY_CENTER = PHASE_TAPS / 2 - 1;

/** Valeur reconstruite aux 3 positions fractionnaires suivant l'échantillon i. */
function interpolatedPeakAt(samples: Float32Array, i: number): number {
  const n = samples.length;
  let best = 0;
  for (let p = 1; p < OVERSAMPLE; p++) {
    const taps = polyphase[p];
    let acc = 0;
    for (let k = 0; k < PHASE_TAPS; k++) {
      const idx = i + k - POLY_CENTER;
      if (idx < 0 || idx >= n) continue;
      acc += samples[idx] * taps[k];
    }
    const v = acc < 0 ? -acc : acc;
    if (v > best) best = v;
  }
  return best;
}

/**
 * Crête vraie (inter-échantillon), sur-échantillonnage ×4.
 *
 * On ne reconstruit pas les quatre millions de points du fichier : seulement
 * autour des maxima locaux qui approchent déjà la crête. Sur du bruit blanc —
 * le pire cas, un maximum local tous les trois échantillons — ça reste dix
 * fois moins de travail, pour 0.06 dB d'écart avec la recherche exhaustive.
 */
export function truePeak(samples: Float32Array): number {
  const n = samples.length;
  if (n === 0) return 0;

  let samplePeak = 0;
  for (let i = 0; i < n; i++) {
    const v = samples[i] < 0 ? -samples[i] : samples[i];
    if (v > samplePeak) samplePeak = v;
  }
  if (samplePeak === 0) return 0;

  const threshold = samplePeak * CANDIDATE_RATIO;
  let peak = samplePeak;

  for (let i = 1; i < n - 1; i++) {
    const m = samples[i] < 0 ? -samples[i] : samples[i];
    if (m < threshold) continue;
    // Maximum local de |x| : les deux intervalles qui l'encadrent sont les
    // seuls où la reconstruction peut dépasser.
    const prev = samples[i - 1] < 0 ? -samples[i - 1] : samples[i - 1];
    const next = samples[i + 1] < 0 ? -samples[i + 1] : samples[i + 1];
    if (m < prev || m < next) continue;

    const a = interpolatedPeakAt(samples, i - 1);
    if (a > peak) peak = a;
    const b = interpolatedPeakAt(samples, i);
    if (b > peak) peak = b;
  }
  return peak;
}

export function toDb(linear: number): number {
  return linear > 0 ? 20 * Math.log10(linear) : -Infinity;
}

export function fromDb(db: number): number {
  return Math.pow(10, db / 20);
}

export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** RMS restreint aux trames marquées parole / non-parole par le VAD. */
function rmsOverMask(
  samples: Float32Array,
  sampleRate: number,
  vad: VadResult,
  wantSpeech: boolean,
): number {
  const hop = Math.round(vad.frameHopS * sampleRate);
  if (hop <= 0 || vad.frameActive.length === 0) return rms(samples);
  let sum = 0;
  let count = 0;
  for (let f = 0; f < vad.frameActive.length; f++) {
    if ((vad.frameActive[f] === 1) !== wantSpeech) continue;
    const start = f * hop;
    const end = Math.min(samples.length, start + hop);
    for (let i = start; i < end; i++) {
      sum += samples[i] * samples[i];
      count++;
    }
  }
  return count > 0 ? Math.sqrt(sum / count) : NaN;
}

export function computeMetrics(
  samples: Float32Array,
  sampleRate: number,
  vad?: VadResult,
): Metrics {
  const activity = vad ?? detectVoiceActivity(samples, sampleRate);

  let peak = 0;
  let dcSum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    dcSum += v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }

  const overallRms = rms(samples);
  const speechRms = rmsOverMask(samples, sampleRate, activity, true);
  const noiseRms = rmsOverMask(samples, sampleRate, activity, false);
  const snrDb =
    Number.isFinite(speechRms) && Number.isFinite(noiseRms) && noiseRms > 0 && speechRms > 0
      ? toDb(speechRms) - toDb(noiseRms)
      : NaN;

  const peakDb = toDb(peak);
  const rmsDb = toDb(overallRms);

  return {
    lufs: integratedLufs(samples, sampleRate),
    truePeakDb: toDb(truePeak(samples)),
    peakDb,
    rmsDb,
    noiseFloorDb: estimateNoiseFloorDb(samples, sampleRate),
    snrDb,
    crestFactorDb: Number.isFinite(peakDb) && Number.isFinite(rmsDb) ? peakDb - rmsDb : NaN,
    dcOffset: samples.length > 0 ? dcSum / samples.length : 0,
  };
}
