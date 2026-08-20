import type { SpectrogramData } from '../types';
import { getRealFFT } from './fft';
import { hann } from './window';

const MAX_COLUMNS = 1400;
const ROWS = 192;
const MIN_HZ = 40;
const MAX_HZ = 16_000;
const MIN_DB = -95;
const MAX_DB = -5;

/**
 * STFT → image de magnitudes en dB, prête pour un seul `putImageData`.
 *
 * L'axe des fréquences est logarithmique : c'est la seule échelle où la voix
 * occupe une place lisible. Les lignes sont rangées haut → bas en fréquence
 * décroissante, comme sur un analyseur.
 *
 * Le nombre de colonnes est plafonné : au-delà d'environ 1400, on transfère
 * des mégaoctets pour des pixels que personne ne verra.
 */
export function computeSpectrogram(
  samples: Float32Array,
  sampleRate: number,
  fftSize = 2048,
): SpectrogramData {
  const fft = getRealFFT(fftSize);
  const window = hann(fftSize);
  const bins = fft.bins;

  const naturalHop = fftSize >> 2;
  const frameCount = Math.max(1, Math.floor((samples.length - fftSize) / naturalHop) + 1);
  const stride = Math.max(1, Math.ceil(frameCount / MAX_COLUMNS));
  const width = Math.max(1, Math.ceil(frameCount / stride));
  const hop = naturalHop * stride;

  const data = new Uint8Array(width * ROWS);

  // Table de correspondance ligne → bin, calculée une fois.
  const rowBin = new Float32Array(ROWS);
  const nyquist = sampleRate / 2;
  const topHz = Math.min(MAX_HZ, nyquist);
  for (let r = 0; r < ROWS; r++) {
    // r = 0 en haut de l'image = fréquence la plus haute.
    const t = 1 - r / (ROWS - 1);
    const hz = MIN_HZ * Math.pow(topHz / MIN_HZ, t);
    rowBin[r] = (hz / nyquist) * (bins - 1);
  }

  const frame = new Float32Array(fftSize);
  const re = new Float32Array(bins);
  const im = new Float32Array(bins);
  const mag = new Float32Array(bins);
  const range = MAX_DB - MIN_DB;
  // Normalisation : une sinusoïde pleine échelle doit tomber près de 0 dB.
  const scale = 2 / (fftSize * 0.5);

  for (let c = 0; c < width; c++) {
    const start = c * hop;
    for (let i = 0; i < fftSize; i++) {
      const idx = start + i;
      frame[i] = idx < samples.length ? samples[idx] * window[i] : 0;
    }
    fft.forward(frame, re, im);
    fft.magnitudes(re, im, mag);

    for (let r = 0; r < ROWS; r++) {
      const pos = rowBin[r];
      const i0 = Math.floor(pos);
      const i1 = Math.min(bins - 1, i0 + 1);
      const frac = pos - i0;
      // Au-dessus de ~4 kHz une ligne couvre plusieurs bins : on prend le
      // maximum de l'intervalle, sinon les harmoniques disparaissent.
      let value: number;
      const nextPos = r > 0 ? rowBin[r - 1] : pos;
      if (nextPos - pos > 1.5) {
        let m = 0;
        const end = Math.min(bins - 1, Math.floor(nextPos));
        for (let b = i0; b <= end; b++) if (mag[b] > m) m = mag[b];
        value = m;
      } else {
        value = mag[i0] * (1 - frac) + mag[i1] * frac;
      }

      const db = value > 0 ? 20 * Math.log10(value * scale) : MIN_DB;
      const norm = (db - MIN_DB) / range;
      data[r * width + c] = norm <= 0 ? 0 : norm >= 1 ? 255 : (norm * 255) | 0;
    }
  }

  return {
    data,
    width,
    height: ROWS,
    minDb: MIN_DB,
    maxDb: MAX_DB,
    minHz: MIN_HZ,
    maxHz: topHz,
  };
}
