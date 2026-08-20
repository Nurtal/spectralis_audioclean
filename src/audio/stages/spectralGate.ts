import { getRealFFT } from '../analysis/fft';
import { hann } from '../analysis/window';
import { noiseProfileFromFrames } from '../analysis/noiseFloor';
import { detectVoiceActivity, silenceMaskForHop, type VadResult } from '../analysis/vad';
import { FFT_SIZE, HOP_SIZE, SPECTRAL_BETA, SPECTRAL_FLOOR_DB } from '../../lib/constants';

/**
 * Le percentile 10 est robuste — il ne peut pas être contaminé par de la voix —
 * mais il ne mesure pas le bruit, il mesure son creux. Pour un bruit stationnaire,
 * la magnitude d'un bin suit une loi de Rayleigh : son percentile 10 vaut
 * 0.459·σ quand sa moyenne vaut 1.253·σ. Le rapport est constant, donc
 * corrigeable. Sans cette correction, β perd son sens habituel et il faudrait
 * le monter à 4 pour obtenir l'effet que la littérature obtient à 1.5.
 */
const P10_TO_MEAN = 1.2533 / 0.4590;

export interface SpectralGateOptions {
  /** 0..1 — pilote β et le plancher de gain. */
  strength?: number;
  fftSize?: number;
  hopSize?: number;
  vad?: VadResult;
  onProgress?: (progress: number) => void;
}

/**
 * Soustraction spectrale, écrite à la main.
 *
 * C'est le chemin qui ne dépend de rien : pas de WASM, pas de réseau, pas de
 * chargement paresseux. Il débloque le reste du site, et il reste en
 * production comme mode « doux » — moins agressif que RNNoise, il conserve
 * mieux les réverbérations naturelles d'une pièce.
 *
 * 1. STFT Hann 2048 / hop 512
 * 2. profil de bruit : percentile 10 par bin, sur les trames sans parole
 * 3. masque `gain = max(plancher, (mag − β·bruit) / mag)`
 * 4. lissage 3 trames × 3 bins — c'est ce lissage qui évite le « musical
 *    noise », ces petites cloches aléatoires que produit un masque nu
 * 5. ISTFT, overlap-add avec fenêtre de synthèse
 */
export function spectralGate(
  samples: Float32Array,
  sampleRate: number,
  options: SpectralGateOptions = {},
): Float32Array {
  const fftSize = options.fftSize ?? FFT_SIZE;
  const hopSize = options.hopSize ?? HOP_SIZE;
  const strength = Math.min(1, Math.max(0, options.strength ?? 0.85));
  const onProgress = options.onProgress;

  const n = samples.length;
  if (n < fftSize) return Float32Array.from(samples);

  const fft = getRealFFT(fftSize);
  const window = hann(fftSize);
  const bins = fft.bins;
  const frameCount = Math.floor((n - fftSize) / hopSize) + 1;

  // β vaut SPECTRAL_BETA au dosage médian, et monte avec lui ; le plancher descend. Un plancher trop bas rend le
  // fond « creux » et fait ressortir les artefacts : on ne descend pas sous -18 dB.
  const beta = SPECTRAL_BETA * (0.6 + 0.8 * strength);
  const floorGain = Math.pow(10, (-6 + (SPECTRAL_FLOOR_DB + 6) * strength) / 20);

  const frame = new Float32Array(fftSize);
  const re = new Float32Array(bins);
  const im = new Float32Array(bins);
  const mag = new Float32Array(bins);

  // ---- Passe 1 : profil de bruit -----------------------------------------
  // On sous-échantillonne les trames : un percentile n'a pas besoin de les voir
  // toutes, et stocker 8000 trames × 1025 bins coûterait 35 Mo pour rien.
  const profileStride = Math.max(1, Math.ceil(frameCount / 1500));
  const profileFrames = Math.floor((frameCount - 1) / profileStride) + 1;
  const profileMags = new Float32Array(profileFrames * bins);

  for (let p = 0; p < profileFrames; p++) {
    const start = p * profileStride * hopSize;
    for (let i = 0; i < fftSize; i++) {
      const idx = start + i;
      frame[i] = idx < n ? samples[idx] * window[i] : 0;
    }
    fft.forward(frame, re, im);
    fft.magnitudes(re, im, mag);
    profileMags.set(mag, p * bins);
  }
  onProgress?.(0.25);

  const vad = options.vad ?? detectVoiceActivity(samples, sampleRate);
  const silence = silenceMaskForHop(
    vad,
    profileFrames,
    (profileStride * hopSize) / sampleRate,
  );
  const noise = noiseProfileFromFrames(profileMags, profileFrames, bins, silence, 10);
  for (let b = 0; b < bins; b++) noise[b] *= P10_TO_MEAN;

  // ---- Passe 2 : masque, lissage, resynthèse -----------------------------
  const output = new Float32Array(n);
  const normalization = new Float32Array(n);

  // Le lissage temporel est centré sur 3 trames : il faut donc garder la trame
  // précédente sous la main. On retarde la resynthèse d'une trame.
  const maskRing = [new Float32Array(bins), new Float32Array(bins), new Float32Array(bins)];
  const specRe = [new Float32Array(bins), new Float32Array(bins)];
  const specIm = [new Float32Array(bins), new Float32Array(bins)];
  const smoothed = new Float32Array(bins);
  const raw = new Float32Array(bins);
  const resynth = new Float32Array(fftSize);

  const emit = (frameIndex: number, slot: number) => {
    const r = specRe[slot];
    const i2 = specIm[slot];
    for (let b = 0; b < bins; b++) {
      const g = smoothed[b];
      r[b] *= g;
      i2[b] *= g;
    }
    fft.inverse(r, i2, resynth);
    const start = frameIndex * hopSize;
    for (let k = 0; k < fftSize; k++) {
      const idx = start + k;
      if (idx >= n) break;
      const w = window[k];
      output[idx] += resynth[k] * w;
      normalization[idx] += w * w;
    }
  };

  let progressTick = 0;
  for (let f = 0; f < frameCount + 1; f++) {
    const slot = f % 2;
    if (f < frameCount) {
      const start = f * hopSize;
      const r = specRe[slot];
      const i2 = specIm[slot];
      for (let i = 0; i < fftSize; i++) {
        const idx = start + i;
        frame[i] = idx < n ? samples[idx] * window[i] : 0;
      }
      fft.forward(frame, r, i2);

      // Masque brut, puis lissage sur 3 bins.
      const ring = maskRing[f % 3];
      for (let b = 0; b < bins; b++) {
        const rb = r[b];
        const ib = i2[b];
        const m = Math.sqrt(rb * rb + ib * ib);
        const g = m > 1e-12 ? (m - beta * noise[b]) / m : 0;
        raw[b] = g < floorGain ? floorGain : g > 1 ? 1 : g;
      }
      for (let b = 0; b < bins; b++) {
        const lo = b === 0 ? 0 : b - 1;
        const hi = b === bins - 1 ? bins - 1 : b + 1;
        ring[b] = (raw[lo] + raw[b] + raw[hi]) / 3;
      }
    }

    // Trame f-1 : on dispose de f-2, f-1 et f → lissage temporel centré.
    const target = f - 1;
    if (target >= 0) {
      const cur = maskRing[target % 3];
      const prev = maskRing[(target + 2) % 3];
      const next = maskRing[(target + 1) % 3];
      const hasPrev = target > 0;
      const hasNext = target < frameCount - 1;
      for (let b = 0; b < bins; b++) {
        let sum = cur[b];
        let count = 1;
        if (hasPrev) {
          sum += prev[b];
          count++;
        }
        if (hasNext) {
          sum += next[b];
          count++;
        }
        smoothed[b] = sum / count;
      }
      emit(target, target % 2);
    }

    if (onProgress && f - progressTick > 256) {
      progressTick = f;
      onProgress(0.25 + 0.75 * (f / frameCount));
    }
  }

  for (let i = 0; i < n; i++) {
    const norm = normalization[i];
    if (norm > 1e-6) output[i] /= norm;
    else output[i] = samples[i];
  }

  onProgress?.(1);
  return output;
}
