/** Réduction d'un signal en paires min/max par colonne, pour le tracé waveform. */

/**
 * @param samples signal source
 * @param columns nombre de colonnes voulues (typiquement la largeur en pixels)
 * @param out tableau réutilisable de `columns * 2` valeurs (min, max, min, max…)
 */
export function computePeaks(
  samples: Float32Array,
  columns: number,
  out?: Float32Array,
): Float32Array {
  const result = out && out.length >= columns * 2 ? out : new Float32Array(columns * 2);
  const n = samples.length;
  if (n === 0 || columns === 0) return result;

  const perColumn = n / columns;
  for (let c = 0; c < columns; c++) {
    const start = Math.floor(c * perColumn);
    const end = Math.min(n, Math.max(start + 1, Math.floor((c + 1) * perColumn)));
    let min = samples[start];
    let max = min;
    for (let i = start + 1; i < end; i++) {
      const v = samples[i];
      if (v < min) min = v;
      else if (v > max) max = v;
    }
    result[c * 2] = min;
    result[c * 2 + 1] = max;
  }
  return result;
}

/** Valeur absolue maximale — utile pour caler l'échelle verticale d'un tracé. */
export function peakAmplitude(peaks: Float32Array): number {
  let max = 0;
  for (let i = 0; i < peaks.length; i++) {
    const v = Math.abs(peaks[i]);
    if (v > max) max = v;
  }
  return max;
}
